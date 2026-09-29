import { eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { buildCashMovementRowData } from '@dayo/domain'
import { enqueueLocalOnly, enqueuePush, shiftParentKey } from '../db/outbox'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { builtRow, notBefore } from './rows'
import { REASON_MAX_LENGTH, type CashMovementDto, type CashMovementInput } from './types'

const MANUAL_KINDS: readonly string[] = ['PAID_IN', 'PAID_OUT', 'DROP']
/** ฿100,000 — far above any drawer movement of the shop; catches a typo of extra zeros. */
export const MAX_CASH_MOVEMENT_SATANG = 10_000_000

export function toCashMovementDto(r: typeof s.cashMovement.$inferSelect): CashMovementDto {
  return { id: r.id, kind: r.kind, amountSatang: r.amountSatang, orderId: r.orderId, reason: r.reason, createdBy: r.createdBy, createdAt: r.createdAt }
}

/**
 * The outbox row of one cash movement, in the caller's transaction, by the shift's sync mode (ruling R1 · spec 04
 * §4.10 · §6.1): central → the E2 `cash_movement` row in the shift lane, waiting for its `shift_open` · local_only →
 * the block-2 local_only row. The E2 reason of a VOID_REFUND is null (D36: the void itself carries the reason).
 * The builder refuses a row dayo would reject forever → BAD_INPUT, and the caller's transaction rolls back.
 */
export async function enqueueCashMovement(tx: RemoteDb, deps: ApiDeps, row: typeof s.cashMovement.$inferSelect): Promise<void> {
  const shift = await tx.select({ syncMode: s.shift.syncMode }).from(s.shift).where(eq(s.shift.id, row.shiftId)).get()
  if (shift === undefined) throw new PosError('NO_OPEN_SHIFT', `shift ${row.shiftId} not found`)
  if (shift.syncMode !== 'central') {
    await enqueueLocalOnly(tx, 'cash_movement', row, row.createdAt, deps.newId)
    return
  }
  const isRefund = row.kind === 'VOID_REFUND'
  const data = builtRow('E2 cash_movement row', () =>
    buildCashMovementRowData({
      movementId: row.id, shiftId: row.shiftId, kind: row.kind, amountSatang: row.amountSatang, posOrderId: isRefund ? row.orderId : null,
      reason: isRefund ? null : row.reason, createdBy: row.createdBy, createdAt: row.createdAt,
    }),
  )
  await enqueuePush(tx, { kind: 'cash_movement', id: row.id, data, parentKey: shiftParentKey(row.shiftId) }, row.createdAt, deps.newId)
}

/**
 * Writes one PAID_IN / PAID_OUT / DROP row of `shiftId` + its outbox row inside the caller's transaction, refusing an
 * amount outside 1…MAX_CASH_MOVEMENT_SATANG. Shared by `recordCashMovement` and a receipt paid from the drawer
 * (plan 4 `receivePurchase`, Q4-6) so both follow the same cap. The outbox row follows the shift's sync mode
 * (`enqueueCashMovement`).
 */
export async function insertManualCashMovement(
  tx: RemoteDb,
  deps: ApiDeps,
  m: { shiftId: string; kind: 'PAID_IN' | 'PAID_OUT' | 'DROP'; amountSatang: number; reason: string; actorId: string; at: string },
): Promise<CashMovementDto> {
  if (!Number.isSafeInteger(m.amountSatang) || m.amountSatang <= 0 || m.amountSatang > MAX_CASH_MOVEMENT_SATANG) {
    throw new PosError('BAD_INPUT', `amount must be a whole number of satang from 1 to ${MAX_CASH_MOVEMENT_SATANG}`)
  }
  const shift = await tx.select({ openedAt: s.shift.openedAt }).from(s.shift).where(eq(s.shift.id, m.shiftId)).get()
  if (shift === undefined) throw new PosError('NO_OPEN_SHIFT', `shift ${m.shiftId} not found`)
  const row = {
    id: deps.newId(),
    shiftId: m.shiftId,
    kind: m.kind,
    amountSatang: m.amountSatang,
    orderId: null, // only VOID_REFUND carries an order (D47 item 7 CHECK)
    reason: m.reason,
    createdBy: m.actorId,
    createdAt: notBefore(m.at, shift.openedAt), // a clock stepped back never stamps it before its shift opened (0066:216)
  } satisfies typeof s.cashMovement.$inferInsert
  await tx.insert(s.cashMovement).values(row)
  await enqueueCashMovement(tx, deps, row)
  return toCashMovementDto(row)
}

/**
 * spec §3.5: PAID_IN / PAID_OUT / DROP are typed in by a person, with a reason, into the open shift (Q3b-9 · D52).
 * VOID_REFUND is never accepted here — cancelSale writes it (D36). One transaction: cash_movement + outbox.
 */
export async function recordCashMovement(db: RemoteDb, deps: ApiDeps, input: CashMovementInput): Promise<CashMovementDto> {
  if (!MANUAL_KINDS.includes(input.kind)) throw new PosError('BAD_INPUT', `kind must be PAID_IN, PAID_OUT or DROP, got ${input.kind}`)
  if (!Number.isSafeInteger(input.amountSatang) || input.amountSatang <= 0 || input.amountSatang > MAX_CASH_MOVEMENT_SATANG) {
    throw new PosError('BAD_INPUT', `amount must be a whole number of satang from 1 to ${MAX_CASH_MOVEMENT_SATANG}`)
  }
  const reason = input.reason.trim()
  if (reason === '') throw new PosError('BAD_INPUT', 'a paid-in / paid-out / drop needs a reason')
  if (reason.length > REASON_MAX_LENGTH) throw new PosError('BAD_INPUT', `a reason is at most ${REASON_MAX_LENGTH} characters`)
  const actor = await db.select().from(s.user).where(eq(s.user.id, input.actorUserId)).get()
  if (!actor || !actor.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${input.actorUserId}`)
  const device = await requireDevice(db)

  const moved = await db.transaction(async (tx) => {
    const shift = await currentOpenShift(tx, device.id)
    if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'open a shift first')
    return insertManualCashMovement(tx, deps, { shiftId: shift.id, kind: input.kind, amountSatang: input.amountSatang, reason, actorId: actor.id, at: deps.now() })
  })
  deps.afterWrite?.() // a central shift's row waits in the queue: wake the sender
  return moved
}
