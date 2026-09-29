import { and, eq, inArray, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { SHIFT_LANE_KINDS, Text200 } from '@dayo/contracts'
import { can } from '../app/permissions'
import { writeKey, readKey } from '../sync/state'
import { requireOwnerPin } from './auth'
import { botWindowFor } from './bot-cash'
import { requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { COUNT_FLOOR_SKIP_KEY, farAheadLastCount } from './rows'
import type { KeepShiftLocalResult, OwnerApproval, SkipCountFloorResult, UserDto } from './types'

/*
 * Task 14 · carried item 9 (release gate): the owner's ways out of the two dead ends block 3 can reach on the shift side.
 * Each needs the owner's PIN and a reason, runs whole in the PosApi serial queue, writes one audit_log row, and deletes
 * nothing (rule 4).
 */

async function ownerWithReason(db: RemoteDb, deps: ApiDeps, i: OwnerApproval): Promise<{ approver: UserDto; reason: string }> {
  const reason = typeof i.reason === 'string' ? i.reason.trim() : ''
  if (!Text200.safeParse(reason).success) throw new PosError('BAD_INPUT', 'a reason of 1–200 characters is required')
  const approver = await requireOwnerPin(db, deps, i.approverUserId, i.approverPin) // argon2 is slow — outside the transaction
  if (!can(approver.role, 'sync_problems')) throw new PosError('NOT_OWNER', approver.displayName)
  return { approver, reason }
}

/**
 * 9a · R19 "เก็บกะนี้ไว้ในเครื่อง": a CENTRAL shift of this device that is not closed yet (open, counting or counted) becomes
 * local-only for good (trigger shift_sync_mode_one_way). In one transaction: shift.sync_mode → local_only · every shift-lane
 * row of the shift still pending or dead → local_only (rows dayo already has stay sent — dayo keeps that shift open) ·
 * audit_log `shift_kept_local`.
 *
 * Why it frees the chain: R7 issues this device's Zs in count order, so a counted central shift whose Z can never be issued
 * with dayo (E4 keeps failing, Z_TOO_LARGE, a shift_close the builder refuses, COUNT_BEFORE_CENTRAL_Z) holds every later Z.
 * A local-only shift's Z needs no E4, queues no shift_close and skips the central-Z checks — the owner issues it on the
 * usual screen (issueZ / confirmCount) and R7 moves on. Its bills still go to dayo (orders:write — later bills carry
 * shift_id null, R1). The bot cash of its E4 window (`botWindow`) is then in no Z: the local Z's variance shows it.
 */
export async function keepShiftLocal(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { shiftId: string }): Promise<KeepShiftLocalResult> {
  const { approver, reason } = await ownerWithReason(db, deps, i)
  const device = await requireDevice(db)
  const out = await db.transaction(async (tx) => {
    const shift = await tx.select().from(s.shift).where(eq(s.shift.id, i.shiftId)).get()
    if (shift === undefined || shift.deviceId !== device.id || shift.syncMode !== 'central' || shift.status === 'closed') {
      throw new PosError('REMEDY_NOT_ALLOWED', 'only a central shift of this device that has no Z yet can be kept on the tablet')
    }
    const rows = await tx.select({ id: s.outbox.id, key: s.outbox.idempotencyKey, status: s.outbox.status }).from(s.outbox)
      .where(and(inArray(s.outbox.tableName, [...SHIFT_LANE_KINDS]), sql`json_extract(${s.outbox.rowJson}, '$.shift_id') = ${shift.id}`)).all()
    const open = rows.filter((r) => r.status === 'pending' || r.status === 'dead')
    if (open.length > 0) await tx.update(s.outbox).set({ status: 'local_only', nextAttemptAt: null }).where(and(inArray(s.outbox.id, open.map((r) => r.id)), inArray(s.outbox.status, ['pending', 'dead'])))
    const botWindow = shift.countedAt === null ? null : await botWindowFor(tx, { id: shift.id, deviceId: shift.deviceId, businessDate: shift.businessDate, countedAt: shift.countedAt })
    const done = await tx.update(s.shift).set({ syncMode: 'local_only' }).where(and(eq(s.shift.id, shift.id), eq(s.shift.syncMode, 'central'))).returning({ id: s.shift.id })
    if (done.length !== 1) throw new PosError('REMEDY_NOT_ALLOWED', 'the shift changed meanwhile — reload')
    const result: KeepShiftLocalResult = { shiftId: shift.id, closedKeys: open.map((r) => r.key), sentKeys: rows.filter((r) => r.status === 'sent').map((r) => r.key), botWindow }
    await tx.insert(s.auditLog).values({
      id: deps.newId(), entity: 'shift', entityId: shift.id, action: 'shift_kept_local',
      beforeJson: { syncMode: 'central', status: shift.status, rows: rows.map((r) => ({ key: r.key, status: r.status })) },
      afterJson: { syncMode: 'local_only', reason, approvedBy: approver.id, closedKeys: result.closedKeys, sentKeys: result.sentKeys, botWindow },
      actorUserId: approver.id, at: deps.now(),
    })
    return result
  })
  deps.afterWrite?.()
  return out
}

/**
 * 9b: a count taken while the tablet clock was far ahead (> 24 h past dayo's time — rows.ts) floors every later count and
 * blocks counting and issuing a Z (BAD_INPUT CLOCK_AHEAD). The owner skips THAT count as a floor, once: sync_state
 * local.count_floor_skip = its counted_at (a different far-ahead count asks again) · audit_log `count_floor_skipped`.
 * The price (botBillsRisk): the E4 windows around the skipped count no longer line up — a bot bill may be counted in two
 * Zs, or in none; the screen says so before the PIN.
 */
export async function skipCountFloor(db: RemoteDb, deps: ApiDeps, i: OwnerApproval): Promise<SkipCountFloorResult> {
  const { approver, reason } = await ownerWithReason(db, deps, i)
  const device = await requireDevice(db)
  const out = await db.transaction(async (tx) => {
    const far = await farAheadLastCount(tx, device.id, deps.now())
    if (far === null) throw new PosError('REMEDY_NOT_ALLOWED', 'no count of this device is far ahead of the real time')
    const previous = await readKey(tx, COUNT_FLOOR_SKIP_KEY)
    await writeKey(tx, COUNT_FLOOR_SKIP_KEY, far.countedAt)
    const result: SkipCountFloorResult = { skippedCountedAt: far.countedAt, shiftId: far.shiftId, botBillsRisk: 'double_or_missed' }
    await tx.insert(s.auditLog).values({
      id: deps.newId(), entity: 'shift', entityId: far.shiftId, action: 'count_floor_skipped',
      beforeJson: { countedAt: far.countedAt, previousSkip: previous }, afterJson: { ...result, reason, approvedBy: approver.id }, actorUserId: approver.id, at: deps.now(),
    })
    return result
  })
  deps.afterWrite?.()
  return out
}
