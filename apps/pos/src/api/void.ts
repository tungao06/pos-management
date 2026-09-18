import { and, eq } from 'drizzle-orm'
import { loadCatalogSqlite, type RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { voidReturnMovements, type MovementDraft } from '@dayo/domain'
import { appendOrderEvents, type NewEvent } from '../db/events'
import { enqueueOutbox } from '../db/outbox'
import { insertMovements } from '../db/stock'
import { requireOwnerPin } from './auth'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { getOrder } from './orders'
import type { OrderDetailDto, VoidOrderInput } from './types'

/**
 * spec §4.3 + D18/D36/D39: void a paid order of the open shift with a reason and an owner's PIN.
 * Not made yet → VOID_RETURN of the exact SALE movements (same cost) · made → no movement, waste marker only.
 * Cash → automatic cash_movement VOID_REFUND · PromptPay → the refund transfer reference is recorded.
 */
export async function voidOrder(db: RemoteDb, deps: ApiDeps, input: VoidOrderInput): Promise<OrderDetailDto> {
  const reason = input.reason.trim()
  if (reason === '') throw new PosError('BAD_INPUT', 'a void needs a reason')
  const actor = await db.select().from(s.user).where(eq(s.user.id, input.actorUserId)).get()
  if (!actor || !actor.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${input.actorUserId}`)
  // argon2 is slow — check the PIN before opening the transaction.
  const approver = await requireOwnerPin(db, deps, input.approverUserId, input.approverPin) // PIN lockout shared with login (D50 Q3-21)
  const device = await requireDevice(db)

  await db.transaction(async (tx) => {
    const order = await tx.select().from(s.order).where(eq(s.order.id, input.orderId)).get()
    if (!order) throw new PosError('ORDER_NOT_FOUND', input.orderId)
    const shift = await currentOpenShift(tx, device.id)
    // Only paid orders of this device's open shift (D47 ข้อ 2 · Q3-13)
    if (order.status !== 'paid' || shift === null || order.shiftId !== shift.id || order.deviceId !== device.id) {
      throw new PosError('VOID_NOT_ALLOWED', `order ${order.receiptNo ?? order.id} is ${order.status} or not in the open shift`)
    }
    const payments = await tx.select().from(s.payment).where(eq(s.payment.orderId, order.id)).all()
    // M4: a plain sum over one method's payment rows, not a repeat of domain pricing math — there is no domain helper for this shape yet (M4 suggests sumPaymentsSatang for later plans).
    const cashRefundSatang = payments.filter((p) => p.method === 'CASH').reduce((a, p) => a + p.amountSatang, 0)
    const qrRefundSatang = payments.filter((p) => p.method === 'PROMPTPAY').reduce((a, p) => a + p.amountSatang, 0)
    const refundReference = input.refundReference?.trim() ?? ''
    if (qrRefundSatang > 0 && refundReference === '') throw new PosError('BAD_INPUT', 'a PromptPay void needs the refund transfer reference') // (D48 Q3-15)

    const at = deps.now()
    await tx.update(s.order).set({ status: 'voided', voidedAt: at }).where(eq(s.order.id, order.id))
    // The status change travels as its own outbox row (decision T14/T15).
    await enqueueOutbox(tx, 'order', { ...order, status: 'voided', voidedAt: at }, at, deps.newId, 'voided')

    let returnedMovementIds: string[] = []
    if (!input.made) {
      const saleRows = await tx
        .select()
        .from(s.stockMovement)
        .where(and(eq(s.stockMovement.refType, 'order'), eq(s.stockMovement.refId, order.id), eq(s.stockMovement.kind, 'SALE')))
        .all()
      const saleDrafts: MovementDraft[] = saleRows.map((m) => ({ itemId: m.itemId, kind: 'SALE', qtyMilli: m.qtyMilli, unitCostUsat: m.unitCostUsat, refType: m.refType, refId: m.refId }))
      returnedMovementIds = await insertMovements(
        tx,
        deps,
        voidReturnMovements(saleDrafts, order.id),
        { businessDate: shift.businessDate, deviceId: device.id, createdBy: actor.id, at },
        await loadCatalogSqlite(tx),
      )
    }

    let cashMovementId: string | null = null
    if (cashRefundSatang > 0) {
      // VOID_REFUND always carries the voided order and a positive amount (D36, D47 item 7 CHECK).
      const row = {
        id: deps.newId(),
        shiftId: shift.id,
        kind: 'VOID_REFUND',
        amountSatang: cashRefundSatang,
        orderId: order.id,
        reason: `${order.receiptNo ?? order.id}: ${reason}`,
        createdBy: actor.id,
        createdAt: at,
      } satisfies typeof s.cashMovement.$inferInsert
      await tx.insert(s.cashMovement).values(row)
      await enqueueOutbox(tx, 'cash_movement', row, at, deps.newId)
      cashMovementId = row.id
    }

    const events: NewEvent[] = [
      {
        type: 'VOIDED',
        payload: {
          reason,
          made: input.made,
          waste: input.made,
          approvedBy: approver.id,
          cashRefundSatang,
          cashMovementId,
          qrRefundSatang,
          refundReference: qrRefundSatang > 0 ? refundReference : null,
        },
      },
    ]
    if (!input.made) events.push({ type: 'STOCK_RETURNED', payload: { movementIds: returnedMovementIds } })
    await appendOrderEvents(tx, { orderId: order.id, deviceId: device.id, actorType: 'user', actorId: actor.id, at, newId: deps.newId }, events)
  })
  return getOrder(db, input.orderId)
}
