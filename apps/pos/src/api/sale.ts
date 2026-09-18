import { and, desc, eq, isNotNull, max } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { cashChangeSatang, nextReceiptNo, planSale, promptPayPayload, type SaleCartLine, type SaleContext, type SalePlan } from '@dayo/domain'
import { appendOrderEvents, type NewEvent } from '../db/events'
import { enqueueOutbox } from '../db/outbox'
import { insertMovements, loadSaleContext } from '../db/stock'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { getSetting, PROMPTPAY_SETTING_KEY } from './setup'
import type { CommitSaleInput, CommitSaleResult } from './types'

async function lastReceiptNo(db: RemoteDb, deviceId: string): Promise<string | null> {
  const row = await db
    .select({ receiptNo: s.order.receiptNo })
    .from(s.order)
    .where(and(eq(s.order.deviceId, deviceId), isNotNull(s.order.receiptNo)))
    .orderBy(desc(s.order.receiptNo))
    .limit(1)
    .get()
  return row?.receiptNo ?? null
}

async function lastQueueNo(db: RemoteDb, deviceId: string, businessDate: string): Promise<number> {
  const row = await db
    .select({ q: max(s.order.queueNo) })
    .from(s.order)
    .where(and(eq(s.order.deviceId, deviceId), eq(s.order.businessDate, businessDate)))
    .get()
  return row?.q ?? 0
}

// M12: an idempotent replay must be the same bill, not just the same orderId — otherwise a cart edited after a
// successful commit (the UI failing to clear it) would silently drop the new lines and hand back the old receipt.
function sameLines(input: CommitSaleInput['lines'], stored: readonly { variantId: string; sweetnessId: string; qty: number }[]): boolean {
  const norm = (rows: readonly { variantId: string; sweetnessId: string; qty: number }[]) =>
    rows.map((r) => `${r.variantId}|${r.sweetnessId}|${r.qty}`).sort()
  const a = norm(input.map((l) => ({ variantId: l.variantId, sweetnessId: l.sweetnessId, qty: l.qty })))
  const b = norm(stored)
  return a.length === b.length && a.every((x, i) => x === b[i])
}

async function existingResult(db: RemoteDb, orderId: string, lines: CommitSaleInput['lines']): Promise<CommitSaleResult | null> {
  const order = await db.select().from(s.order).where(eq(s.order.id, orderId)).get()
  if (!order) return null
  const payment = await db.select().from(s.payment).where(eq(s.payment.orderId, orderId)).get()
  if (order.receiptNo === null || order.queueNo === null || !payment) throw new PosError('BAD_INPUT', `order ${orderId} exists but is not a paid in-store order`)
  const storedLines = await db.select({ variantId: s.orderLine.variantId, sweetnessId: s.orderLine.sweetnessId, qty: s.orderLine.qty }).from(s.orderLine).where(eq(s.orderLine.orderId, orderId)).all()
  if (!sameLines(lines, storedLines)) throw new PosError('BAD_INPUT', `order ${orderId} already paid with different lines`)
  return {
    orderId,
    receiptNo: order.receiptNo,
    queueNo: order.queueNo,
    businessDate: order.businessDate,
    totalSatang: order.totalSatang,
    changeSatang: payment.changeSatang,
    method: payment.method,
  }
}

function planOrThrow(lines: readonly SaleCartLine[], discountSatang: number, ctx: SaleContext, orderId: string): SalePlan {
  try {
    return planSale(lines, discountSatang, ctx, orderId)
  } catch (e) {
    if (e instanceof RangeError && e.message === 'discount exceeds subtotal') throw new PosError('DISCOUNT_TOO_BIG', e.message)
    throw e
  }
}

/**
 * spec §4.1, §4.2, §4.7, §4.9, §6.1: one transaction writes order + lines + discount + payment + SALE movements
 * (average cost) + item_cost_state + hash-chained events + outbox. Any error rolls everything back, so a failed
 * sale never consumes a receipt or queue number.
 */
export async function commitSale(db: RemoteDb, deps: ApiDeps, input: CommitSaleInput): Promise<CommitSaleResult> {
  const done = await existingResult(db, input.orderId, input.lines)
  if (done !== null) return done
  if (input.lines.length === 0) throw new PosError('EMPTY_CART', 'cart has no lines')
  const discount = input.discount === null ? null : { amountSatang: input.discount.amountSatang, reason: input.discount.reason.trim() }
  if (discount !== null && (!Number.isSafeInteger(discount.amountSatang) || discount.amountSatang <= 0 || discount.reason === '')) {
    throw new PosError('BAD_INPUT', 'a discount needs a positive whole satang amount and a reason')
  }
  const device = await requireDevice(db)
  const actor = await db.select().from(s.user).where(eq(s.user.id, input.actorUserId)).get()
  if (!actor || !actor.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${input.actorUserId}`)

  return db.transaction(async (tx) => {
    const shift = await currentOpenShift(tx, device.id)
    if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'open a shift before selling')
    const at = deps.now()
    const ctx = await loadSaleContext(tx, at, input.lines.map((l) => l.variantId))
    const plan = planOrThrow(input.lines, discount?.amountSatang ?? 0, ctx.sale, input.orderId)
    const { subtotalSatang, discountSatang, totalSatang, vatSatang } = plan.totals
    // No 0-baht bills: payment.amount_satang > 0 is a DB CHECK (D47 item 7). Free/compensation drinks are a stock-out
    // with a reason in plan 4, never a 0-baht sale (D50 Q3-20).
    if (totalSatang <= 0) throw new PosError('DISCOUNT_TOO_BIG', 'the discount must leave a total above 0')
    // I-7 / D50 Q3-27: what the customer is charged must be what the cart/QR showed — never silently re-priced.
    if (totalSatang !== input.expectedTotalSatang) throw new PosError('PRICE_CHANGED', `shown ${input.expectedTotalSatang}, now ${totalSatang}`)

    let tenderedSatang: number | null = null
    let changeSatang: number | null = null
    if (input.payment.method === 'CASH') {
      // M14: a NaN/fractional tender must fail as BAD_INPUT, not reach cashChangeSatang's assertSafeInt as a plain RangeError.
      if (!Number.isSafeInteger(input.payment.tenderedSatang)) throw new PosError('BAD_INPUT', 'tendered must be whole satang')
      if (input.payment.tenderedSatang < totalSatang) throw new PosError('TENDER_TOO_LOW', `tendered ${input.payment.tenderedSatang} < total ${totalSatang}`)
      tenderedSatang = input.payment.tenderedSatang
      changeSatang = cashChangeSatang(totalSatang, tenderedSatang)
    }

    const receiptNo = nextReceiptNo(device.receiptPrefix, await lastReceiptNo(tx, device.id))
    // Same transaction as the insert, behind the serial queue: unique(device_id, business_date, queue_no) (D47 item 5) never trips.
    const queueNo = (await lastQueueNo(tx, device.id, shift.businessDate)) + 1

    const orderRow = {
      id: input.orderId,
      origin: 'device',
      deviceId: device.id,
      receiptNo,
      queueNo,
      businessDate: shift.businessDate,
      shiftId: shift.id,
      channelId: ctx.sale.channelId,
      customerId: null,
      status: 'paid',
      subtotalSatang,
      discountSatang,
      totalSatang,
      vatSatang,
      costSatang: plan.costSatang,
      note: null,
      createdByType: 'user',
      createdById: actor.id,
      createdAt: at,
      paidAt: at,
      readyAt: null,
      voidedAt: null,
    } satisfies typeof s.order.$inferInsert
    await tx.insert(s.order).values(orderRow)
    await enqueueOutbox(tx, 'order', orderRow, at, deps.newId)

    for (const l of plan.lines) {
      const names = ctx.variantNames.get(l.variantId)
      const sweetnessName = ctx.sweetnessNames.get(l.sweetnessId)
      if (names === undefined || sweetnessName === undefined) throw new PosError('BAD_INPUT', `unknown variant or sweetness ${l.variantId}/${l.sweetnessId}`)
      const lineRow = {
        id: deps.newId(),
        orderId: input.orderId,
        lineNo: l.lineNo,
        variantId: l.variantId,
        sweetnessId: l.sweetnessId,
        recipeId: l.recipeId,
        productName: names.productName,
        sizeName: names.sizeName,
        sweetnessName,
        unitPriceSatang: l.unitPriceSatang,
        qty: l.qty,
        lineTotalSatang: l.lineTotalSatang,
        unitCostSatang: l.unitCostSatang,
      } satisfies typeof s.orderLine.$inferInsert
      await tx.insert(s.orderLine).values(lineRow)
      await enqueueOutbox(tx, 'order_line', lineRow, at, deps.newId)
    }

    if (discount !== null) {
      // Amount only, reason required, approved_by = the signed-in user; only written when > 0 (D48 Q3-6, D47 item 7)
      const discountRow = { id: deps.newId(), orderId: input.orderId, amountSatang: discount.amountSatang, reason: discount.reason, approvedBy: actor.id } satisfies typeof s.discount.$inferInsert
      await tx.insert(s.discount).values(discountRow)
      await enqueueOutbox(tx, 'discount', discountRow, at, deps.newId)
    }

    const paymentRow = {
      id: deps.newId(),
      orderId: input.orderId,
      method: input.payment.method,
      amountSatang: totalSatang,
      tenderedSatang,
      changeSatang,
      reference: null,
      verifyStatus: 'manual',
      createdBy: actor.id,
      createdAt: at,
    } satisfies typeof s.payment.$inferInsert
    await tx.insert(s.payment).values(paymentRow)
    await enqueueOutbox(tx, 'payment', paymentRow, at, deps.newId)

    const movementIds = await insertMovements(tx, deps, plan.movements, { businessDate: shift.businessDate, deviceId: device.id, createdBy: actor.id, at }, ctx.catalog)

    const events: NewEvent[] = [{ type: 'CREATED', payload: { origin: 'device', channelId: ctx.sale.channelId, shiftId: shift.id, businessDate: shift.businessDate } }]
    for (const l of plan.lines) {
      events.push({ type: 'LINE_ADDED', payload: { lineNo: l.lineNo, variantId: l.variantId, sweetnessId: l.sweetnessId, recipeId: l.recipeId, qty: l.qty, unitPriceSatang: l.unitPriceSatang, lineTotalSatang: l.lineTotalSatang } })
    }
    if (discount !== null) events.push({ type: 'DISCOUNT_APPLIED', payload: { amountSatang: discount.amountSatang, reason: discount.reason, approvedBy: actor.id } })
    events.push({ type: 'PAID', payload: { receiptNo, queueNo, method: input.payment.method, subtotalSatang, discountSatang, totalSatang, tenderedSatang, changeSatang } })
    events.push({ type: 'STOCK_DEDUCTED', payload: { movementIds, costSatang: plan.costSatang } })
    await appendOrderEvents(tx, { orderId: input.orderId, deviceId: device.id, actorType: 'user', actorId: actor.id, at, newId: deps.newId }, events)

    return { orderId: input.orderId, receiptNo, queueNo, businessDate: shift.businessDate, totalSatang, changeSatang, method: input.payment.method }
  })
}

/** EMVCo payload for the shop's PromptPay id with the bill amount (spec §5, D7 · D48 Q3-4). Built offline. */
export async function promptPayForAmount(db: RemoteDb, deps: ApiDeps, amountSatang: number): Promise<string> {
  if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0) throw new PosError('BAD_INPUT', 'amount must be a positive whole number of satang')
  const id = await getSetting(db, PROMPTPAY_SETTING_KEY, deps.now())
  if (typeof id !== 'string' || id === '') throw new PosError('NO_PROMPTPAY_ID', 'set the PromptPay id first')
  return promptPayPayload(id, amountSatang)
}
