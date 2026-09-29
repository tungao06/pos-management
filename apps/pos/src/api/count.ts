import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { Text200 } from '@dayo/contracts'
import { buildCashCountRowData, cashVarianceSatang, sumSatang, tallyCashCount, varianceNeedsReason } from '@dayo/domain'
import { enqueueLocalOnly, enqueuePush, shiftParentKey } from '../db/outbox'
import { requireOwnerPin } from './auth'
import { botWindowFor, readBotPreview } from './bot-cash'
import { currentOpenShift, requireDevice } from './bootstrap'
import { earlierCountWithoutZ, writeZ, type CloseShiftHooks } from './close'
import type { ApiDeps } from './deps'
import { E2_CASH_COUNT_ROW, PosError } from './errors'
import { builtRow, countFloor, notBefore } from './rows'
import { requireActiveUser } from './shift'
import { buildShiftReport } from './shift-report'
import {
  REASON_MAX_LENGTH, type CloseShiftInput, type ConfirmCountInput, type ConfirmCountResult, type CountSummaryDto, type IssueZInput, type ShiftDto,
  type UserDto, type ZReportDto, type ZSettle,
} from './types'

/**
 * Block 3 count and Z (D101 · spec 04 §6.8 · §4.10): "นับเสร็จ" (finishCount) freezes the open shift at counted_at →
 * the owner confirms the count (confirmCount, PIN) — with the Z in the same transaction when E4 is in (online), or the
 * count alone (offline: no reason asked yet) → issueZ later, once online (PIN again). Status: open → counting →
 * counted → closed, in this order only (ruling R2 · trigger shift_status_forward_only). closeShift (block 2's one step)
 * runs the same three steps in ONE transaction for a local-only shift — no screen calls it any more; it stays on the PosApi
 * for that path and its API tests (final fix C4).
 */

type ShiftRow = typeof s.shift.$inferSelect
const toDto = (r: ShiftRow): ShiftDto => ({ id: r.id, businessDate: r.businessDate, openedAt: r.openedAt, openedBy: r.openedBy, openingFloatSatang: r.openingFloatSatang, syncMode: r.syncMode })

async function shiftById(db: RemoteDb, id: string): Promise<ShiftRow> {
  const r = await db.select().from(s.shift).where(eq(s.shift.id, id)).get()
  if (r === undefined) throw new PosError('SHIFT_NOT_COUNTING', id)
  return r
}

function tallied(lines: ConfirmCountInput['countLines']): ReturnType<typeof tallyCashCount> {
  try {
    return tallyCashCount(lines)
  } catch (e) {
    throw new PosError('BAD_INPUT', e instanceof Error ? e.message : String(e))
  }
}

/** The owner's typed settlement, checked before any PIN or write: a blank reason is no reason (D102). */
function checkedSettle(z: ZSettle): ZSettle {
  const reason = typeof z.varianceReason === 'string' ? z.varianceReason.trim() : ''
  if (reason.length > REASON_MAX_LENGTH) throw new PosError('BAD_INPUT', `a reason is at most ${REASON_MAX_LENGTH} characters`)
  if (reason !== '' && !Text200.safeParse(reason).success) throw new PosError('BAD_INPUT', 'a reason must be plain text (no control characters)') // dayo_pos_is_text
  if (z.bankQrTotalSatang !== null && (!Number.isSafeInteger(z.bankQrTotalSatang) || z.bankQrTotalSatang < 0)) {
    throw new PosError('BAD_INPUT', 'bankQrTotalSatang must be a whole number of satang >= 0, or null')
  }
  if (typeof z.acknowledgeZChainBroken !== 'boolean') throw new PosError('BAD_INPUT', 'acknowledgeZChainBroken must be true or false')
  return { varianceReason: reason === '' ? null : reason, bankQrTotalSatang: z.bankQrTotalSatang, acknowledgeZChainBroken: z.acknowledgeZChainBroken }
}

/**
 * Review item 1: the ONE rule the review screen and both writes use — a central shift takes the stored E4 answer of
 * exactly its window when there is one (includesBotCash); a local-only shift never has bot cash (ruling R6).
 */
async function summarize(db: RemoteDb, shift: ShiftRow): Promise<CountSummaryDto> {
  if (shift.countedAt === null || (shift.status !== 'counting' && shift.status !== 'counted')) throw new PosError('SHIFT_NOT_COUNTING', shift.id)
  const window = shift.syncMode === 'central' ? await botWindowFor(db, { id: shift.id, deviceId: shift.deviceId, businessDate: shift.businessDate, countedAt: shift.countedAt }) : null
  const bot = window === null ? null : await readBotPreview(db, shift.id, window)
  const report = await buildShiftReport(db, toDto(shift), shift.countedAt, bot)
  return { ...report, countedAt: shift.countedAt, syncMode: shift.syncMode, includesBotCash: bot !== null, bot, zBlockedBy: await earlierCountWithoutZ(db, shift), notInDayo: await notInDayoOf(db, shift.id) }
}

/**
 * Task 14 (carried item 8): the receipts of this shift dayo will never receive — the owner closed the bill "ปิดไว้ในเครื่อง"
 * (order.excluded_at), or a plan-3 bill (no sold_at) — and the cash refunds of those that were cancelled: their VOID_REFUND
 * is still sent with the shift (ruling), so dayo's Z shows a refund of a bill it does not have. Display only.
 */
async function notInDayoOf(db: RemoteDb, shiftId: string): Promise<{ bills: number; voidRefundSatang: number }> {
  const bills = await db.select({ id: s.order.id }).from(s.order)
    .where(and(eq(s.order.shiftId, shiftId), isNotNull(s.order.receiptNo), inArray(s.order.status, ['paid', 'voided']), or(isNull(s.order.soldAt), isNotNull(s.order.excludedAt)))).all()
  if (bills.length === 0) return { bills: 0, voidRefundSatang: 0 }
  const refunds = await db.select({ amount: s.cashMovement.amountSatang }).from(s.cashMovement)
    .where(and(eq(s.cashMovement.shiftId, shiftId), eq(s.cashMovement.kind, 'VOID_REFUND'), inArray(s.cashMovement.orderId, bills.map((b) => b.id)))).all()
  return { bills: bills.length, voidRefundSatang: sumSatang(refunds.map((r) => r.amount)) }
}

/**
 * D101 step 1 · R3, inside the caller's transaction: the open shift becomes 'counting' with counted_at set once — never
 * before the shift opened nor before any of its receipts, voids or cash movements (a device clock stepped back must not
 * leave a row of the shift after its count: dayo 0066:216-222, spec §4.10 pos_bills sold_at ≤ counted_at) — and always
 * at least 1 ms after every earlier count of this device (fix round 1 item 1 · security M1): the E4 window of a count
 * starts at the previous count, so a clock stepped back would otherwise open a window that overlaps one already in a
 * Z and count the same bot bill twice.
 */
async function freezeOpen(tx: RemoteDb, deps: ApiDeps, shift: ShiftDto, actorId: string): Promise<string> {
  const bills = await tx.values<[string | null, string | null]>(sql`select max(coalesce(sold_at, paid_at, created_at)), max(voided_at) from "order" where shift_id = ${shift.id} and receipt_no is not null`)
  const moves = await tx.values<[string | null]>(sql`select max(created_at) from cash_movement where shift_id = ${shift.id}`)
  const at = deps.now()
  const later = (a: string, b: string | null): string => (b !== null && Date.parse(b) > Date.parse(a) ? b : a)
  const base = [shift.openedAt, bills[0]?.[0] ?? null, bills[0]?.[1] ?? null, moves[0]?.[0] ?? null].reduce<string>(later, at)
  // fix rounds 2–3: 1 ms after this device's last count · a last count far ahead of real time refuses the count (CLOCK_AHEAD)
  const deviceId = (await tx.select({ d: s.shift.deviceId }).from(s.shift).where(eq(s.shift.id, shift.id)).get())!.d
  const lastCount = await countFloor(tx, deviceId, at)
  const countedAt = later(base, lastCount === null ? null : new Date(Date.parse(lastCount) + 1).toISOString())
  await tx.update(s.shift).set({ status: 'counting', countedAt }).where(and(eq(s.shift.id, shift.id), eq(s.shift.status, 'open')))
  await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'shift', entityId: shift.id, action: 'count_finished', beforeJson: null, afterJson: { countedAt }, actorUserId: actorId, at })
  return countedAt
}

/**
 * D101 step 2/3, inside the caller's transaction, on a 'counting' shift: the count row (+ its E2 cash_count, or its
 * local_only row) → 'counted' → with `settle`, the Z (writeZ) in the same transaction — any refusal rolls the count back.
 */
async function confirmInTx(
  tx: RemoteDb,
  deps: ApiDeps,
  a: { shift: ShiftRow; actorId: string; approver: UserDto; tally: ReturnType<typeof tallyCashCount>; settle: ZSettle | null; shownFingerprint: string; shownExpectedSatang?: number },
): Promise<ConfirmCountResult> {
  const { shift, settle } = a
  if (shift.status !== 'counting' || shift.countedAt === null) throw new PosError('SHIFT_NOT_COUNTING', shift.id)
  const countedAt = shift.countedAt
  const sum = await summarize(tx, shift)
  if (sum.fingerprint !== a.shownFingerprint || (a.shownExpectedSatang !== undefined && a.shownExpectedSatang !== sum.expectedCashSatang)) {
    throw new PosError('SHIFT_CHANGED', `shown ${a.shownExpectedSatang ?? a.shownFingerprint.slice(0, 8)}, now ${a.shownExpectedSatang !== undefined ? sum.expectedCashSatang : sum.fingerprint.slice(0, 8)}`)
  }
  if (settle !== null && shift.syncMode === 'central' && sum.bot === null) throw new PosError('BOT_CASH_REQUIRED', shift.id)
  let variance: number
  try {
    variance = cashVarianceSatang(a.tally.totalSatang, sum.expectedCashSatang)
  } catch (e) {
    throw new PosError('BAD_INPUT', e instanceof Error ? e.message : String(e))
  }
  // D102 · §6.8: the reason is asked with the Z only (offline: not yet) — refused before anything is written
  if (settle !== null && settle.varianceReason === null && varianceNeedsReason(variance, sum.varianceAlertSatang)) {
    throw new PosError('VARIANCE_REASON_REQUIRED', `variance ${variance} is at or above ${sum.varianceAlertSatang}`)
  }
  const at = notBefore(deps.now(), countedAt) // the lane is read in created_at order: never before the shift's own rows
  const countRow = {
    id: deps.newId(), shiftId: shift.id, countedSatang: a.tally.totalSatang, expectedSatang: sum.expectedCashSatang, varianceSatang: variance,
    reason: settle?.varianceReason ?? null, linesJson: a.tally.lines, countedBy: a.actorId, createdAt: at, countedAt, includesBotCash: sum.includesBotCash,
  } satisfies typeof s.cashCount.$inferInsert
  await tx.insert(s.cashCount).values(countRow)
  if (shift.syncMode === 'central') {
    const data = builtRow(E2_CASH_COUNT_ROW, () => buildCashCountRowData({ countId: countRow.id, shiftId: shift.id, lines: countRow.linesJson, countedBy: countRow.countedBy, countedAt }))
    await enqueuePush(tx, { kind: 'cash_count', id: countRow.id, data, parentKey: shiftParentKey(shift.id) }, at, deps.newId)
  } else {
    await enqueueLocalOnly(tx, 'cash_count', countRow, at, deps.newId) // the shift stays on the tablet (spec 04 §6.1 · R1)
  }
  await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'shift', entityId: shift.id, action: 'count_confirmed', beforeJson: null, afterJson: { countId: countRow.id, approvedBy: a.approver.id, includesBotCash: sum.includesBotCash }, actorUserId: a.actorId, at })
  await tx.update(s.shift).set({ status: 'counted' }).where(and(eq(s.shift.id, shift.id), eq(s.shift.status, 'counting')))
  const z = settle === null ? null : await writeZ(tx, deps, { shift: { ...shift, status: 'counted' }, count: countRow, approver: a.approver, summary: sum, settle })
  return { countId: countRow.id, z }
}

/** D101 step 1 · R3: "นับเสร็จ" — the open shift stops taking bills and cash movements (status 'counting', counted_at once). */
export async function finishCount(db: RemoteDb, deps: ApiDeps, input: { actorUserId: string }): Promise<{ shiftId: string; countedAt: string }> {
  const actor = await requireActiveUser(db, input.actorUserId)
  const device = await requireDevice(db)
  const r = await db.transaction(async (tx) => {
    const shift = await currentOpenShift(tx, device.id)
    if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'no open shift to count')
    return { shiftId: shift.id, countedAt: await freezeOpen(tx, deps, shift, actor.id) }
  })
  deps.afterWrite?.()
  return r
}

/** The count review of a counting/counted shift of this device (nothing written). */
export async function countSummary(db: RemoteDb, shiftId: string): Promise<CountSummaryDto> {
  const device = await requireDevice(db)
  const shift = await shiftById(db, shiftId)
  if (shift.deviceId !== device.id) throw new PosError('SHIFT_NOT_COUNTING', shiftId)
  return summarize(db, shift)
}

/** D101 steps 2–3: the owner confirms the count; with `z` the Z is written in the same transaction (a refused Z rolls the count back). */
export async function confirmCount(db: RemoteDb, deps: ApiDeps, i: ConfirmCountInput): Promise<ConfirmCountResult> {
  const tally = tallied(i.countLines)
  const settle = i.z === null ? null : checkedSettle(i.z)
  const actor = await requireActiveUser(db, i.actorUserId)
  const approver = await requireOwnerPin(db, deps, i.approverUserId, i.approverPin) // argon2 is slow — outside the transaction
  const device = await requireDevice(db)
  const r = await db.transaction(async (tx) => {
    const shift = await shiftById(tx, i.shiftId)
    if (shift.deviceId !== device.id) throw new PosError('SHIFT_NOT_COUNTING', shift.id)
    return confirmInTx(tx, deps, { shift, actorId: actor.id, approver, tally, settle, shownFingerprint: i.shownFingerprint })
  })
  deps.afterWrite?.()
  return r
}

/** D101 step 3: the Z of a counted shift, once online (the owner's PIN again). Zs go out in count order (R7). */
export async function issueZ(db: RemoteDb, deps: ApiDeps, i: IssueZInput): Promise<ZReportDto> {
  const settle = checkedSettle(i)
  const approver = await requireOwnerPin(db, deps, i.approverUserId, i.approverPin)
  const device = await requireDevice(db)
  const z = await db.transaction(async (tx) => {
    const shift = await shiftById(tx, i.shiftId)
    const count = await tx.select().from(s.cashCount).where(eq(s.cashCount.shiftId, shift.id)).get()
    if (shift.deviceId !== device.id || shift.status !== 'counted' || count === undefined || shift.countedAt === null) throw new PosError('Z_NOT_READY', shift.id)
    const earlier = await earlierCountWithoutZ(tx, shift)
    if (earlier !== null) throw new PosError('Z_NOT_READY', earlier) // R7, before anything else about this shift
    const sum = await summarize(tx, shift)
    if (sum.fingerprint !== i.shownFingerprint) throw new PosError('SHIFT_CHANGED', `shown ${i.shownFingerprint.slice(0, 8)}, now ${sum.fingerprint.slice(0, 8)}`)
    return writeZ(tx, deps, { shift, count, approver, summary: sum, settle })
  })
  deps.afterWrite?.()
  return z
}

/**
 * Block 2's one-step close, kept for LOCAL-ONLY shifts (spec 04 §6.1 · ruling R6) — no screen calls it since block 3 (the
 * count screens go finishCount → confirmCount → issueZ); it stays on the PosApi for that path and its API tests
 * (close-shift.test.ts), final fix C4. finishCount + confirmCount with the Z,
 * in ONE transaction — any refusal (SHIFT_CHANGED, VARIANCE_REASON_REQUIRED, Z_CHAIN_BROKEN, R7 …) leaves the shift
 * open exactly as before, so the screen can retry. A central shift needs E4 first: BOT_CASH_REQUIRED (the count screens).
 * `hooks.validated` runs once the input and the owner PIN passed, just before the transaction (task 14 fix round 1 item 4).
 */
export async function closeShift(db: RemoteDb, deps: ApiDeps, input: CloseShiftInput, hooks: CloseShiftHooks = {}): Promise<ZReportDto> {
  const tally = tallied(input.countLines)
  if (!Number.isSafeInteger(input.shownExpectedCashSatang)) throw new PosError('BAD_INPUT', 'shownExpectedCashSatang must be whole satang')
  const settle = checkedSettle({ varianceReason: input.varianceReason, bankQrTotalSatang: input.bankQrTotalSatang, acknowledgeZChainBroken: input.acknowledgeZChainBroken })
  const actor = await requireActiveUser(db, input.actorUserId)
  const approver = await requireOwnerPin(db, deps, input.approverUserId, input.approverPin) // argon2 is slow — outside the transaction
  const device = await requireDevice(db)
  hooks.validated?.()
  return db.transaction(async (tx) => {
    const open = await currentOpenShift(tx, device.id)
    if (open === null) throw new PosError('NO_OPEN_SHIFT', 'no open shift to close')
    if (open.syncMode === 'central') throw new PosError('BOT_CASH_REQUIRED', `${open.id}: a central shift is closed with finishCount → fetchBotCash → confirmCount`)
    await freezeOpen(tx, deps, open, actor.id)
    const shift = await shiftById(tx, open.id)
    const r = await confirmInTx(tx, deps, { shift, actorId: actor.id, approver, tally, settle, shownFingerprint: input.shownReportFingerprint, shownExpectedSatang: input.shownExpectedCashSatang })
    if (r.z === null) throw new PosError('Z_NOT_READY', shift.id) // unreachable: settle is always set here
    return r.z
  })
}
