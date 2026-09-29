import { and, eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { SHIFT_LANE_KINDS, type ShiftSyncMode } from '@dayo/contracts'
import { buildShiftOpenRowData } from '@dayo/domain'
import { enqueueLocalOnly, enqueuePush } from '../db/outbox'
import { bangkokDate } from '../lib/clock'
import { readSupported } from '../sync/catalog'
import { currentOpenShift, requireDevice } from './bootstrap'
import { isDayoLinked } from './connect'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import type { OpenShiftInput, QuickOpenShiftInput, ShiftDto } from './types'

/** audit_log action that marks a "เปิดกะด่วน" (spec §4.8 · plan 3 M18 · Q3b-10 · D52). */
export const QUICK_OPEN_ACTION = 'quick_open'

export async function requireActiveUser(db: RemoteDb, userId: string): Promise<typeof s.user.$inferSelect> {
  const user = await db.select().from(s.user).where(eq(s.user.id, userId)).get()
  if (!user || !user.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${userId}`)
  return user
}

/**
 * Ruling R1 (spec 04 §4.10 ข้อ 4): a shift reaches dayo only if, when it opens, the tablet is linked and dayo's last
 * stored E1 lists every shift kind. Decided once, at opening, and kept for the shift's life (it may only fall back to
 * local_only later — trigger shift_sync_mode_one_way). Offline = the last stored E1 decides; opening is never blocked.
 */
export async function shiftSyncMode(db: RemoteDb, deps: ApiDeps): Promise<ShiftSyncMode> {
  if (!(await isDayoLinked(db, deps))) return 'local_only'
  const sup = await readSupported(db)
  return sup !== null && SHIFT_LANE_KINDS.every((k) => sup.kinds.includes(k)) ? 'central' : 'local_only'
}

/**
 * A builder of @dayo/domain refuses (throws) a row dayo would reject forever: inside the caller's transaction that
 * rolls the whole write back — surfaced as BAD_INPUT, never as a raw RangeError/ZodError.
 */
export function builtRow<T>(what: string, build: () => T): T {
  try {
    return build()
  } catch (e) {
    if (e instanceof PosError) throw e
    throw new PosError('BAD_INPUT', `${what}: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`)
  }
}

/**
 * Inserts the open shift row + its outbox row inside the caller's transaction. spec §4.8: one open shift per
 * device — checked here for a clear error, and enforced by the DB's partial unique index (D47 item 6) as the last
 * line · business_date = Thai calendar date at opening (decision T11) · R2: while a shift of this device is being
 * counted (status 'counting') no new shift opens (COUNT_PENDING) — confirm the count first.
 * central → the E2 `shift_open` row (spec 04 §4.10, parent of the shift's other rows) · local_only → the block-2
 * local_only `shift` row (spec 04 §6.1).
 */
async function insertOpenShift(tx: RemoteDb, deps: ApiDeps, deviceId: string, userId: string, openingFloatSatang: number, syncMode: ShiftSyncMode, quickOpen: boolean): Promise<ShiftDto> {
  const counting = await tx.select({ id: s.shift.id }).from(s.shift).where(and(eq(s.shift.deviceId, deviceId), eq(s.shift.status, 'counting'))).get()
  if (counting !== undefined) throw new PosError('COUNT_PENDING', counting.id)
  if ((await currentOpenShift(tx, deviceId)) !== null) throw new PosError('SHIFT_ALREADY_OPEN', 'close the current shift first')
  const at = deps.now()
  const row = {
    id: deps.newId(),
    deviceId,
    businessDate: bangkokDate(at),
    status: 'open',
    openedBy: userId,
    openedAt: at,
    openingFloatSatang,
    closedBy: null,
    closedAt: null,
    syncMode,
  } satisfies typeof s.shift.$inferInsert
  await tx.insert(s.shift).values(row)
  if (syncMode === 'central') {
    const data = builtRow('E2 shift_open row', () => buildShiftOpenRowData({ shiftId: row.id, businessDate: row.businessDate, openedAt: at, openedBy: userId, openingFloatSatang, quickOpen }))
    await enqueuePush(tx, { kind: 'shift_open', id: row.id, data, parentKey: null }, at, deps.newId)
  } else {
    await enqueueLocalOnly(tx, 'shift', row, at, deps.newId) // the shift stays on the tablet (spec 04 §6.1 · R1)
  }
  return { id: row.id, businessDate: row.businessDate, openedAt: at, openedBy: userId, openingFloatSatang, syncMode }
}

export async function openShift(db: RemoteDb, deps: ApiDeps, input: OpenShiftInput): Promise<ShiftDto> {
  const device = await requireDevice(db)
  if (!Number.isSafeInteger(input.openingFloatSatang) || input.openingFloatSatang < 0) {
    throw new PosError('BAD_INPUT', 'opening float must be a whole number of satang >= 0')
  }
  const user = await requireActiveUser(db, input.userId)
  const syncMode = await shiftSyncMode(db, deps) // reads the secret store: before the transaction
  return db.transaction((tx) => insertOpenShift(tx, deps, device.id, user.id, input.openingFloatSatang, syncMode, false)) // PosApi wakes the sender (before_shift)
}

/**
 * spec §4.8 "เปิดกะด่วน": an owner opens the shift with a 0 float without counting the drawer. The shift row is the
 * same as a normal one; the separate record is an audit_log row `shift / quick_open` in the same transaction, and the
 * Z report of this shift carries `openedQuick: true` (Q3b-10 · D52) — a central shift sends `quick_open: true`.
 */
export async function quickOpenShift(db: RemoteDb, deps: ApiDeps, input: QuickOpenShiftInput): Promise<ShiftDto> {
  const device = await requireDevice(db)
  const user = await requireActiveUser(db, input.userId)
  if (user.role !== 'owner') throw new PosError('NOT_OWNER', `${user.displayName} is not an owner`)
  const syncMode = await shiftSyncMode(db, deps) // reads the secret store: before the transaction
  return db.transaction(async (tx) => {
    const shift = await insertOpenShift(tx, deps, device.id, user.id, 0, syncMode, true)
    await tx.insert(s.auditLog).values({
      id: deps.newId(),
      entity: 'shift',
      entityId: shift.id,
      action: QUICK_OPEN_ACTION,
      beforeJson: null,
      afterJson: { openingFloatSatang: 0, openedBy: user.id },
      actorUserId: user.id,
      at: shift.openedAt,
    })
    return shift
  })
}

/** True when the shift was opened with "เปิดกะด่วน". */
export async function wasQuickOpened(db: RemoteDb, shiftId: string): Promise<boolean> {
  const row = await db
    .select({ id: s.auditLog.id })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.entity, 'shift'), eq(s.auditLog.entityId, shiftId), eq(s.auditLog.action, QUICK_OPEN_ACTION)))
    .get()
  return row !== undefined
}
