import { and, eq } from 'drizzle-orm'
import { loadCatalogSqlite, type RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { bangkokDateOf, rowKey, Text200 } from '@dayo/contracts'
import { sumSatang, voidReturnMovements, type MovementDraft } from '@dayo/domain'
import { can } from '../app/permissions'
import { appendOrderEvents, type NewEvent } from '../db/events'
import { enqueueLocalOnly, enqueuePush } from '../db/outbox'
import { insertMovements } from '../db/stock'
import { requireOwnerPin } from './auth'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { getOrder } from './orders'
import { REASON_MAX_LENGTH, type CancelSaleInput, type OrderDetailDto, type VoidOrderInput } from './types'

/**
 * spec §4.3 + D18/D36/D39: void a paid order of the open shift with a reason and an owner's PIN.
 * Not made yet → VOID_RETURN of the exact SALE movements (same cost) · made → no movement, waste marker only.
 * Cash → automatic cash_movement VOID_REFUND · PromptPay → the refund transfer reference is recorded.
 */
export async function voidOrder(db: RemoteDb, deps: ApiDeps, input: VoidOrderInput): Promise<OrderDetailDto> {
  const reason = input.reason.trim()
  if (reason === '') throw new PosError('BAD_INPUT', 'a void needs a reason')
  if (reason.length > REASON_MAX_LENGTH) throw new PosError('BAD_INPUT', `a reason is at most ${REASON_MAX_LENGTH} characters`)
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
      await enqueueLocalOnly(tx, 'cash_movement', row, at, deps.newId) // block 2: local_only (spec 04 §6.1)
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
  return getOrder(db, deps, input.orderId)
}

/**
 * spec 04 §4.5 order_void + §4.7: same Thai day as the sale only; owner PIN (D50); staff and managers cancel their own
 * bills only (Q44, ruling R11 — `void_any` is the owner's). Cash back = local VOID_REFUND (D36 — local_only in block 2).
 * "made" is recorded for the Z void list only (ruling R6); no stock rows. Plan-3 bills (no sold_at) and excluded bills
 * queue no order_void. Never calls dayo.
 */
export async function cancelSale(db: RemoteDb, deps: ApiDeps, input: CancelSaleInput): Promise<OrderDetailDto> {
  const reason = input.reason.trim()
  if (!Text200.safeParse(reason).success) throw new PosError('BAD_INPUT', `a void needs a reason of 1–${REASON_MAX_LENGTH} characters`)
  const actor = await db.select().from(s.user).where(eq(s.user.id, input.actorUserId)).get()
  if (!actor || !actor.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${input.actorUserId}`)
  // argon2 is slow — check the PIN before opening the transaction (same lockout as login, D50 Q3-21)
  const approver = await requireOwnerPin(db, deps, input.approverUserId, input.approverPin)
  const device = await requireDevice(db)
  await db.transaction(async (tx) => {
    const order = await tx.select().from(s.order).where(eq(s.order.id, input.orderId)).get()
    if (!order) throw new PosError('ORDER_NOT_FOUND', input.orderId)
    const shift = await currentOpenShift(tx, device.id)
    if (order.status !== 'paid' || shift === null || order.shiftId !== shift.id || order.deviceId !== device.id) {
      throw new PosError('VOID_NOT_ALLOWED', `order ${order.receiptNo ?? order.id} is ${order.status} or not in the open shift`)
    }
    const at = deps.now()
    if (order.soldAt !== null && bangkokDateOf(at) !== bangkokDateOf(order.soldAt)) throw new PosError('VOID_NOT_ALLOWED', 'SAME_DAY_ONLY: ยกเลิกได้เฉพาะวันเดียวกับวันขาย')
    const mayVoid = can(actor.role, 'void_any') || (can(actor.role, 'void_own') && order.createdById === actor.id)
    if (!mayVoid) throw new PosError('VOID_NOT_ALLOWED', 'OWN_BILLS_ONLY: staff และ manager ยกเลิกได้เฉพาะบิลที่ตัวเองขาย') // Q44, ruling R11
    const payments = await tx.select().from(s.payment).where(eq(s.payment.orderId, order.id)).all()
    const cashRefundSatang = sumSatang(payments.filter((p) => p.method === 'CASH').map((p) => p.amountSatang))
    const qrRefundSatang = sumSatang(payments.filter((p) => p.method === 'PROMPTPAY').map((p) => p.amountSatang))
    const refundReference = input.refundReference?.trim() ?? ''
    if (qrRefundSatang > 0 && refundReference === '') throw new PosError('BAD_INPUT', 'a PromptPay void needs the refund transfer reference') // D48 Q3-15
    await tx.update(s.order).set({ status: 'voided', voidedAt: at }).where(eq(s.order.id, order.id))
    let cashMovementId: string | null = null
    if (cashRefundSatang > 0) {
      const row = { id: deps.newId(), shiftId: shift.id, kind: 'VOID_REFUND', amountSatang: cashRefundSatang, orderId: order.id, reason: `${order.receiptNo ?? order.id}: ${reason}`, createdBy: actor.id, createdAt: at } satisfies typeof s.cashMovement.$inferInsert
      await tx.insert(s.cashMovement).values(row)
      await enqueueLocalOnly(tx, 'cash_movement', row, at, deps.newId)
      cashMovementId = row.id
    }
    await appendOrderEvents(tx, { orderId: order.id, deviceId: device.id, actorType: 'user', actorId: actor.id, at, newId: deps.newId }, [
      { type: 'VOIDED', payload: { reason, made: input.made, waste: input.made, approvedBy: approver.id, cashRefundSatang, cashMovementId, qrRefundSatang, refundReference: qrRefundSatang > 0 ? refundReference : null } },
    ])
    if (order.soldAt !== null && order.excludedAt === null) {
      // review item 5: dayo refuses voided_at < sold_at (INVALID). A clock set back after the D80 banner must not turn a
      // real cancellation into a row only EXCLUDE can clear — the same Thai day is already guaranteed by the check above.
      const voidedAt = Date.parse(at) < Date.parse(order.soldAt) ? order.soldAt : at
      const data = { pos_order_id: order.id, voided_at: voidedAt, staff_id: actor.id, approved_by: approver.id, reason }
      await enqueuePush(tx, { kind: 'order_void', id: order.id, data, parentKey: rowKey('order', order.id) }, at, deps.newId)
    }
  })
  deps.afterWrite?.()
  return getOrder(db, deps, input.orderId)
}
