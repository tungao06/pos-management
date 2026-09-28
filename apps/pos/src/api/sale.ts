import { and, desc, eq, isNotNull, max } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { OrderRowData, RECEIPT_NO_RE, Text200 } from '@dayo/contracts'
import { buildOrderRowData, CartError, cashChangeSatang, nextReceiptNo, parseReceiptNo, priceCart, promptPayPayload, type CartDraft, type PricedCart } from '@dayo/domain'
import { appendOrderEvents, type NewEvent } from '../db/events'
import { enqueuePush } from '../db/outbox'
import { readCatalog } from '../sync/catalog'
import { DAYO_KEYS, readKey } from '../sync/state'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { getSetting, PROMPTPAY_SETTING_KEY } from './setup'
import { PAYMENT_CODE, REASON_MAX_LENGTH, type DeviceDto, type RecordSaleInput, type RecordSaleResult } from './types'

export { PAYMENT_CODE }

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

/** The cart as the caller sent it, reasons trimmed, with its payment code — what a bill is priced from and stored as. */
function normalizeCart(input: RecordSaleInput): CartDraft {
  const d = input.cart.billDiscount
  return {
    ...input.cart,
    billDiscount: d === null ? null : { ...d, reason: d.reason === null ? null : d.reason.trim() },
    lines: input.cart.lines.map((l) => ({ ...l, discountReason: l.discountReason === null ? null : l.discountReason.trim() })),
    paymentCode: PAYMENT_CODE[input.payment.method],
  }
}

/** Everything that decides what a bill is — lines (in any order), channel, payment code, bill discount and promotions. */
function cartSignature(c: CartDraft): string {
  const lines = c.lines.map((l) => JSON.stringify([l.code, l.size, l.sweetness, l.milk, l.grade, l.qty, l.free, l.discountSatang, l.discountPercent, l.discountReason])).sort()
  const d = c.billDiscount
  const bill = d === null ? null : d.kind === 'satang' ? ['satang', d.satang, d.reason] : ['percent', d.percent, d.reason]
  return JSON.stringify({ channel: c.channelCode, payment: c.paymentCode, bill, promo: c.promoCode, skip: [...c.skipPromotionIds].sort(), none: c.noPromotions, lines })
}

/**
 * plan 3 M12 for block 2: the same orderId must be the same cart — lines, channel, payment and bill discount — compared
 * on the satang cart stored at payment (pricing_json.cart). A resend that differs is refused, never answered with the
 * first bill.
 */
async function existingCentralResult(db: RemoteDb, orderId: string, cart: CartDraft): Promise<RecordSaleResult | null> {
  const o = await db.select().from(s.order).where(eq(s.order.id, orderId)).get()
  if (!o) return null
  const pay = await db.select().from(s.payment).where(eq(s.payment.orderId, o.id)).get()
  const stored = (o.pricingJson as { cart?: CartDraft } | null)?.cart
  if (o.receiptNo === null || o.queueNo === null || !pay || stored === undefined) throw new PosError('BAD_INPUT', `order ${o.id} exists but is not a block-2 bill`)
  if (cartSignature(stored) !== cartSignature(cart)) throw new PosError('BAD_INPUT', `order ${o.id} already paid with a different cart`)
  return { orderId: o.id, receiptNo: o.receiptNo, queueNo: o.queueNo, businessDate: o.businessDate, totalSatang: o.totalSatang, changeSatang: pay.changeSatang, method: pay.method }
}

/**
 * Highest receipt of this device's prefix seen here or by dayo for this key (spec §6.6: a reinstalled app never reuses
 * a number). A value of another prefix or shape counts as none — it must never stop selling.
 */
export async function lastReceiptNoOverall(db: RemoteDb, device: DeviceDto): Promise<string | null> {
  const counter = (r: string | null): number => (r !== null && RECEIPT_NO_RE.test(r) && parseReceiptNo(r).prefix === device.receiptPrefix ? parseReceiptNo(r).counter : 0)
  const local = await lastReceiptNo(db, device.id)
  const central = await readKey(db, DAYO_KEYS.lastReceiptNo)
  const best = counter(central) > counter(local) ? central : local
  return counter(best) > 0 ? best : null
}

/** Every free-text reason that travels in the E2 row must pass dayo's Text200 (1–200 code points, no control character). */
function checkReason(text: string | null, what: string): void {
  if (text !== null && !Text200.safeParse(text.trim()).success) throw new PosError('BAD_INPUT', `${what} needs a reason of 1–${REASON_MAX_LENGTH} characters`)
}

/**
 * spec 04 §4.5, §5.1, §6.1: price with dayo's code at the payment instant (sold_at), refuse a total the customer did
 * not see (PRICE_CHANGED), then write order + order_item + payment (+ discount) + hash-chained events + ONE E2 row in
 * one transaction. No stock rows (D60). shift_id stays local; the E2 row sends null (block 2). Never calls dayo.
 */
export async function recordSale(db: RemoteDb, deps: ApiDeps, input: RecordSaleInput): Promise<RecordSaleResult> {
  const cart = normalizeCart(input)
  const done = await existingCentralResult(db, input.orderId, cart)
  if (done !== null) return done
  if (!Number.isSafeInteger(input.expectedTotalSatang)) throw new PosError('BAD_INPUT', 'expectedTotalSatang must be whole satang')
  const d = input.cart.billDiscount
  if (d !== null && d.reason === null) throw new PosError('BAD_INPUT', `a bill discount needs a reason of 1–${REASON_MAX_LENGTH} characters`) // D48 Q3-6
  checkReason(d?.reason ?? null, 'a bill discount')
  for (const l of input.cart.lines) checkReason(l.discountReason, 'a line discount')
  const device = await requireDevice(db)
  const actor = await db.select().from(s.user).where(eq(s.user.id, input.actorUserId)).get()
  if (!actor || !actor.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${input.actorUserId}`)
  const stored = await readCatalog(db)
  if (stored === null) throw new PosError('NO_CATALOG', 'no catalog from dayo yet')
  if (!stored.catalog.paymentMethods.some((p) => p.code === cart.paymentCode)) throw new PosError('NO_PAYMENT_METHOD', cart.paymentCode)

  const result = await db.transaction(async (tx) => {
    const shift = await currentOpenShift(tx, device.id)
    if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'open a shift before selling')
    const soldAt = deps.now()
    let priced: PricedCart
    try {
      priced = priceCart(cart, stored.catalog, soldAt)
    } catch (e) {
      if (e instanceof CartError) throw new PosError('BAD_INPUT', e.message) // inactive size, no such variant, qty, grade rule
      throw e
    }
    if (!priced.ok) throw new PosError('PRICE_NOT_OK', priced.warnings.join(' · '))
    const totalSatang = priced.totalSatang
    if (totalSatang <= 0) throw new PosError('DISCOUNT_TOO_BIG', 'the total must stay above 0') // D50 Q3-20, ruling R5
    if (totalSatang !== input.expectedTotalSatang) throw new PosError('PRICE_CHANGED', `shown ${input.expectedTotalSatang}, now ${totalSatang}`)
    let tenderedSatang: number | null = null
    let changeSatang: number | null = null
    if (input.payment.method === 'CASH') {
      if (!Number.isSafeInteger(input.payment.tenderedSatang)) throw new PosError('BAD_INPUT', 'tendered must be whole satang')
      if (input.payment.tenderedSatang < totalSatang) throw new PosError('TENDER_TOO_LOW', `tendered ${input.payment.tenderedSatang} < total ${totalSatang}`)
      tenderedSatang = input.payment.tenderedSatang
      changeSatang = cashChangeSatang(totalSatang, tenderedSatang)
    }
    const receiptNo = nextReceiptNo(device.receiptPrefix, await lastReceiptNoOverall(tx, device))
    const queueNo = (await lastQueueNo(tx, device.id, shift.businessDate)) + 1
    if (queueNo > 9999) throw new PosError('QUEUE_FULL', 'queue number 9999 reached today') // ruling R13
    // Checked before anything is written: a row dayo would refuse as INVALID fails the sale here, never the queue.
    const parsed = OrderRowData.safeParse(buildOrderRowData({ posOrderId: input.orderId, receiptNo, queueNo, staffId: actor.id, catalogVersion: stored.catalogVersion, cart, priced, note: null }))
    if (!parsed.success) throw new PosError('BAD_INPUT', `E2 order row: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join(' · ')}`)
    const discountSatang = priced.discountSatang // items + bill, computed and cross-checked in the domain (review item 18)
    const { draft, ...pricedRest } = priced
    const billReason = cart.billDiscount?.reason ?? null

    const orderRow = {
      id: input.orderId, origin: 'device', deviceId: device.id, receiptNo, queueNo, businessDate: shift.businessDate, shiftId: shift.id,
      channelId: null, channelCode: cart.channelCode, paymentCode: cart.paymentCode, customerId: null, status: 'paid',
      subtotalSatang: priced.itemsSubtotalSatang, discountSatang, totalSatang, vatSatang: 0, costSatang: 0, note: null,
      createdByType: 'user', createdById: actor.id, createdAt: soldAt, paidAt: soldAt, readyAt: null, voidedAt: null,
      // pricing_json, frozen at payment: `cart` = what the caller sent (satang — the resend check reads it) · `draft` = the
      // baht OrderDraft dayo's code priced, an audit copy only: never compute money from it (money is `priced`, in satang)
      soldAt, catalogVersion: stored.catalogVersion, pricingJson: { cart, draft, priced: pricedRest }, excludedAt: null,
      centralOrderNo: null, centralComputedTotalSatang: null, centralAmountMismatch: null, centralDuplicateOfJson: null, centralDayoEditJson: null,
    } satisfies typeof s.order.$inferInsert
    await tx.insert(s.order).values(orderRow)
    for (const [i, l] of priced.lines.entries()) {
      await tx.insert(s.orderItem).values({
        id: deps.newId(), orderId: input.orderId, lineNo: i + 1, menuCode: l.code, menuNameTh: l.nameTh, size: l.size, sweetness: l.sweetness, milk: l.milk,
        grade: l.grade, qty: l.qty, unitPriceSatang: l.unitPriceSatang, discountPerCupSatang: l.discountPerCupSatang, discountReason: l.discountReason,
        promotionId: l.promotionId, lineTotalSatang: l.lineTotalSatang,
      })
    }
    await tx.insert(s.payment).values({ id: deps.newId(), orderId: input.orderId, method: input.payment.method, amountSatang: totalSatang, tenderedSatang, changeSatang, reference: null, verifyStatus: 'manual', createdBy: actor.id, createdAt: soldAt })
    if (billReason !== null && priced.billDiscountSatang > 0) {
      await tx.insert(s.discount).values({ id: deps.newId(), orderId: input.orderId, amountSatang: priced.billDiscountSatang, reason: billReason, approvedBy: actor.id })
    }
    const events: NewEvent[] = [{ type: 'CREATED', payload: { origin: 'device', channelCode: cart.channelCode, catalogVersion: stored.catalogVersion, shiftId: shift.id, businessDate: shift.businessDate, soldAt } }]
    for (const [i, l] of priced.lines.entries()) {
      events.push({ type: 'LINE_ADDED', payload: { lineNo: i + 1, code: l.code, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty, unitPriceSatang: l.unitPriceSatang, discountPerCupSatang: l.discountPerCupSatang, promotionId: l.promotionId, lineTotalSatang: l.lineTotalSatang } })
    }
    if (billReason !== null && priced.billDiscountSatang > 0) events.push({ type: 'DISCOUNT_APPLIED', payload: { amountSatang: priced.billDiscountSatang, reason: billReason, approvedBy: actor.id } })
    events.push({ type: 'PAID', payload: { receiptNo, queueNo, method: input.payment.method, paymentCode: cart.paymentCode, subtotalSatang: priced.itemsSubtotalSatang, discountSatang, totalSatang, tenderedSatang, changeSatang, promotions: priced.promotionsApplied.map((p) => ({ id: p.promotionId, discountSatang: p.discountSatang })) } })
    await appendOrderEvents(tx, { orderId: input.orderId, deviceId: device.id, actorType: 'user', actorId: actor.id, at: soldAt, newId: deps.newId }, events)
    await enqueuePush(tx, { kind: 'order', id: input.orderId, data: parsed.data, parentKey: null }, soldAt, deps.newId)
    return { orderId: input.orderId, receiptNo, queueNo, businessDate: shift.businessDate, totalSatang, changeSatang, method: input.payment.method }
  })
  deps.afterWrite?.() // wakes the sender, which waits 2 s
  return result
}

/** EMVCo payload for the shop's PromptPay id with the bill amount (spec §5, D7 · D48 Q3-4). Built offline. */
export async function promptPayForAmount(db: RemoteDb, deps: ApiDeps, amountSatang: number): Promise<string> {
  if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0) throw new PosError('BAD_INPUT', 'amount must be a positive whole number of satang')
  const id = await getSetting(db, PROMPTPAY_SETTING_KEY, deps.now())
  if (typeof id !== 'string' || id === '') throw new PosError('NO_PROMPTPAY_ID', 'set the PromptPay id first')
  return promptPayPayload(id, amountSatang)
}
