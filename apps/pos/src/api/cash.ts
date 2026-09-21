import { eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { enqueueOutbox } from '../db/outbox'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { REASON_MAX_LENGTH, type CashMovementDto, type CashMovementInput } from './types'

const MANUAL_KINDS: readonly string[] = ['PAID_IN', 'PAID_OUT', 'DROP']
/** ฿100,000 — far above any drawer movement of the shop; catches a typo of extra zeros. */
export const MAX_CASH_MOVEMENT_SATANG = 10_000_000

export function toCashMovementDto(r: typeof s.cashMovement.$inferSelect): CashMovementDto {
  return { id: r.id, kind: r.kind, amountSatang: r.amountSatang, orderId: r.orderId, reason: r.reason, createdBy: r.createdBy, createdAt: r.createdAt }
}

/**
 * Writes one PAID_IN / PAID_OUT / DROP row of `shiftId` + its outbox row inside the caller's transaction, refusing an
 * amount outside 1…MAX_CASH_MOVEMENT_SATANG. Shared by `recordCashMovement` and a receipt paid from the drawer
 * (plan 4 `receivePurchase`, Q4-6) so both follow the same cap.
 */
export async function insertManualCashMovement(
  tx: RemoteDb,
  deps: ApiDeps,
  m: { shiftId: string; kind: 'PAID_IN' | 'PAID_OUT' | 'DROP'; amountSatang: number; reason: string; actorId: string; at: string },
): Promise<CashMovementDto> {
  if (!Number.isSafeInteger(m.amountSatang) || m.amountSatang <= 0 || m.amountSatang > MAX_CASH_MOVEMENT_SATANG) {
    throw new PosError('BAD_INPUT', `amount must be a whole number of satang from 1 to ${MAX_CASH_MOVEMENT_SATANG}`)
  }
  const row = {
    id: deps.newId(),
    shiftId: m.shiftId,
    kind: m.kind,
    amountSatang: m.amountSatang,
    orderId: null, // only VOID_REFUND carries an order (D47 item 7 CHECK)
    reason: m.reason,
    createdBy: m.actorId,
    createdAt: m.at,
  } satisfies typeof s.cashMovement.$inferInsert
  await tx.insert(s.cashMovement).values(row)
  await enqueueOutbox(tx, 'cash_movement', row, m.at, deps.newId)
  return toCashMovementDto(row)
}

/**
 * spec §3.5: PAID_IN / PAID_OUT / DROP are typed in by a person, with a reason, into the open shift (Q3b-9 · D52).
 * VOID_REFUND is never accepted here — voidOrder writes it (D36). One transaction: cash_movement + outbox.
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

  return db.transaction(async (tx) => {
    const shift = await currentOpenShift(tx, device.id)
    if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'open a shift first')
    return insertManualCashMovement(tx, deps, { shiftId: shift.id, kind: input.kind, amountSatang: input.amountSatang, reason, actorId: actor.id, at: deps.now() })
  })
}
