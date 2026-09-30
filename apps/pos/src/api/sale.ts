import { and, desc, eq, isNotNull, max } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { ManualPromotionReason, OrderRowData, RECEIPT_NO_RE, Text200, trimWs } from '@dayo/contracts'
import { buildOrderRowData, CartError, cashChangeSatang, manualPromotionsOf, nextReceiptNo, parseReceiptNo, priceCart, promptPayPayload, zeroTotalVerdict, type CartDraft, type PricedCart } from '@dayo/domain'
import { appendOrderEvents, type NewEvent } from '../db/events'
import { enqueuePush } from '../db/outbox'
import { readCatalog } from '../sync/catalog'
import { DAYO_KEYS, readKey } from '../sync/state'
import { currentOpenShift, promoSupport, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { notBefore } from './rows'
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

/**
 * The cart as the caller sent it, reasons trimmed, with its payment code — what a bill is priced from and stored as.
 * The manual-promotion reason is cut with dayo's own trim (trimWs — the text dayo stores, byte for byte); one that trims
 * to nothing is no reason at all (null), so a ฿0 bill that needs one is refused MANUAL_REASON_REQUIRED, never frozen blank.
 * A reason left over with no manual promotion leaving the tablet (none picked, or noPromotions) is dropped here (T8 fix
 * round 1 L2): it neither blocks the sale in checkCart nor is frozen in pricing_json.cart.
 * A caller of before plan 10 may send neither manual key: they read as none.
 */
function normalizeCart(input: RecordSaleInput): CartDraft {
  const d = input.cart.billDiscount
  const typed = input.cart.manualPromotionReason ?? null
  const trimmed = typed === null ? null : trimWs(typed)
  const cart: CartDraft = {
    ...input.cart,
    billDiscount: d === null ? null : { ...d, reason: d.reason === null ? null : d.reason.trim() },
    lines: input.cart.lines.map((l) => ({ ...l, discountReason: l.discountReason === null ? null : l.discountReason.trim() })),
    manualPromotionIds: [...(input.cart.manualPromotionIds ?? [])],
    manualPromotionReason: trimmed === '' ? null : trimmed,
    paymentCode: PAYMENT_CODE[input.payment.method],
  }
  return manualPromotionsOf(cart).ids.length > 0 ? cart : { ...cart, manualPromotionReason: null }
}

/**
 * Everything that decides what a bill is — lines (in any order), channel, payment code, bill discount and promotions,
 * the manual ones included AS THEY LEAVE THE TABLET (manualPromotionsOf: the ids in the order picked, each once, and the
 * reason sent with them — plan 10 T8). A cart frozen before plan 10 has no manual keys: manualPromotionsOf reads it as none.
 */
function cartSignature(c: CartDraft): string {
  const lines = c.lines.map((l) => JSON.stringify([l.code, l.size, l.sweetness, l.milk, l.grade, l.qty, l.free, l.discountSatang, l.discountPercent, l.discountReason])).sort()
  const d = c.billDiscount
  const bill = d === null ? null : d.kind === 'satang' ? ['satang', d.satang, d.reason] : ['percent', d.percent, d.reason]
  const manual = manualPromotionsOf(c)
  return JSON.stringify({ channel: c.channelCode, payment: c.paymentCode, bill, promo: c.promoCode, skip: [...c.skipPromotionIds].sort(), none: c.noPromotions, lines, manual: [manual.ids, manual.reason] })
}

/**
 * plan 3 M12 for block 2: the same orderId must be the same cart — lines, channel, payment, bill discount and the manual
 * promotions with their reason (plan 10 T8) — compared
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

/** A valid manual-promotion reason, only ever priced to ask the engine whether a missing reason is its only problem — never stored. */
const REASON_PROBE = 'probe'

/** Every free-text reason that travels in the E2 row must pass dayo's Text200 (1–200 code points, no control character). */
function checkReason(text: string | null, what: string): void {
  if (text !== null && !Text200.safeParse(text.trim()).success) throw new PosError('BAD_INPUT', `${what} needs a reason of 1–${REASON_MAX_LENGTH} characters`)
}

/**
 * spec 04 §4.5, §5.1, §6.1: price with dayo's code at the payment instant (sold_at), refuse a total the customer did
 * not see (PRICE_CHANGED), then write order + order_item + payment (+ discount) + hash-chained events + ONE E2 row in
 * one transaction. No stock rows (D60). The E2 row sends shift_id only for a central shift (ruling R1 · §4.5), else
 * null (the shift never reaches dayo). Never calls dayo.
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
  // dayo_draft_manual_reason (0069): the reason as it leaves the tablet must pass dayo's own check — before anything is written
  const manual = manualPromotionsOf(cart)
  if (cart.manualPromotionReason !== null && !ManualPromotionReason.safeParse(cart.manualPromotionReason).success) {
    throw new PosError('BAD_INPUT', `a manual promotion needs a reason of 1–${REASON_MAX_LENGTH} characters on one line`)
  }
  // plan 10 §0.2: a dayo whose supported_fields.order lacks manual_promotion_ids would hold the row UNSUPPORTED — never sell one
  if (manual.ids.length > 0 && !(await promoSupport(db)).manualSupported) throw new PosError('MANUAL_PROMO_UNSUPPORTED', 'dayo does not take manual promotions yet')
  const device = await requireDevice(db)
  const actor = await db.select().from(s.user).where(eq(s.user.id, input.actorUserId)).get()
  if (!actor || !actor.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${input.actorUserId}`)
  const stored = await readCatalog(db)
  if (stored === null) throw new PosError('NO_CATALOG', 'no catalog from dayo yet')
  if (!stored.catalog.paymentMethods.some((p) => p.code === cart.paymentCode)) throw new PosError('NO_PAYMENT_METHOD', cart.paymentCode)

  const result = await db.transaction(async (tx) => {
    const shift = await currentOpenShift(tx, device.id)
    if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'open a shift before selling')
    // fix round 2: never before the shift opened (its opening may be floored at the last count — a clock set back across
    // midnight must not give the bill a Thai day before its shift's, or its void a day after its sale: dayo 0052:512)
    const soldAt = notBefore(deps.now(), shift.openedAt)
    let priced: PricedCart
    try {
      priced = priceCart(cart, stored.catalog, soldAt)
    } catch (e) {
      if (e instanceof CartError) throw new PosError('BAD_INPUT', e.message) // inactive size, no such variant, qty, grade rule
      throw e
    }
    const totalSatang = priced.totalSatang
    if (totalSatang < 0) throw new PosError('DISCOUNT_TOO_BIG', 'the total must not go below 0') // never: the domain cross-checks the quote
    // D124 · owner Q1 = ข: a ฿0 bill only from promotions, with a reason when a manual one needs it, paid in cash — the
    // domain's ONE rule. A cart the engine refused is PRICE_NOT_OK first (an unknown channel prices to 0 too) — unless the
    // engine's ONLY problem is the missing manual reason (it sets ok=false for that alone): then the ฿0 verdict speaks, so a
    // reason typed next never meets another refusal (fix round 1 L1). "Only" = the same cart with a reason prices ok —
    // asked of the engine itself, never read from its warning text.
    const zero = zeroTotalVerdict(cart, priced)
    const onlyReasonMissing = !priced.ok && priced.manualPromotionReasonRequired && manual.reason === null
      && priceCart({ ...cart, manualPromotionReason: REASON_PROBE }, stored.catalog, soldAt).ok
    if (!priced.ok && !onlyReasonMissing) throw new PosError('PRICE_NOT_OK', priced.warnings.join(' · '))
    if (zero !== 'ok') throw new PosError(zero, `total ${totalSatang}`)
    if (!priced.ok) throw new PosError('PRICE_NOT_OK', priced.warnings.join(' · ')) // never sell a cart the engine refused
    if (totalSatang !== input.expectedTotalSatang) throw new PosError('PRICE_CHANGED', `shown ${input.expectedTotalSatang}, now ${totalSatang}`)
    let tenderedSatang: number | null = null
    let changeSatang: number | null = null
    if (input.payment.method === 'CASH') {
      // Q1 = ข: a ฿0 bill is a cash payment of 0 — nothing handed over, no change (migration 0007's ฿0 payment row)
      if (totalSatang === 0 && input.payment.tenderedSatang !== 0) throw new PosError('BAD_INPUT', 'a ฿0 bill takes no cash: tendered must be 0')
      if (!Number.isSafeInteger(input.payment.tenderedSatang)) throw new PosError('BAD_INPUT', 'tendered must be whole satang')
      if (input.payment.tenderedSatang < totalSatang) throw new PosError('TENDER_TOO_LOW', `tendered ${input.payment.tenderedSatang} < total ${totalSatang}`)
      tenderedSatang = input.payment.tenderedSatang
      changeSatang = cashChangeSatang(totalSatang, tenderedSatang)
    }
    const receiptNo = nextReceiptNo(device.receiptPrefix, await lastReceiptNoOverall(tx, device))
    const queueNo = (await lastQueueNo(tx, device.id, shift.businessDate)) + 1
    if (queueNo > 9999) throw new PosError('QUEUE_FULL', 'queue number 9999 reached today') // ruling R13
    // Checked before anything is written: a row dayo would refuse as INVALID fails the sale here, never the queue.
    const parsed = OrderRowData.safeParse(buildOrderRowData({ posOrderId: input.orderId, receiptNo, queueNo, staffId: actor.id, catalogVersion: stored.catalogVersion, shiftId: shift.syncMode === 'central' ? shift.id : null, cart, priced, note: null })) // R1: only a central shift's id reaches dayo
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
      // R2: a cup discounted by more than one promotion keeps its split under the hash (the key only then — other lines as before)
      const breakdown = l.promoBreakdown ?? null
      events.push({ type: 'LINE_ADDED', payload: { lineNo: i + 1, code: l.code, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty, unitPriceSatang: l.unitPriceSatang, discountPerCupSatang: l.discountPerCupSatang, promotionId: l.promotionId, lineTotalSatang: l.lineTotalSatang, ...(breakdown === null ? {} : { promoBreakdown: breakdown }) } })
    }
    if (billReason !== null && priced.billDiscountSatang > 0) events.push({ type: 'DISCOUNT_APPLIED', payload: { amountSatang: priced.billDiscountSatang, reason: billReason, approvedBy: actor.id } })
    events.push({ type: 'PAID', payload: { receiptNo, queueNo, method: input.payment.method, paymentCode: cart.paymentCode, subtotalSatang: priced.itemsSubtotalSatang, discountSatang, totalSatang, tenderedSatang, changeSatang, promotions: priced.promotionsApplied.map((p) => ({ id: p.promotionId, discountSatang: p.discountSatang })),
      // R2: the manual promotions and reason exactly as the E2 row sends them (manualPromotionsOf) — the keys only when picked
      ...(manual.ids.length > 0 ? { manualPromotionIds: manual.ids, manualPromotionReason: manual.reason } : {}) } })
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
