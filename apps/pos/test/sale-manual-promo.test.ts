import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { OrderRowData, OrderVoidRowData } from '@dayo/contracts'
import { loadContractFixture } from '@dayo/contracts/fixture-files'
import type { CatalogPromotion, PromotionGroup } from '@dayo/dayo-mock'
import { priceCart, selectableManualPromotions, verifyChain } from '@dayo/domain'
import { countSyncProblems } from '../src/api/bootstrap'
import { posErrorCode } from '../src/api/errors'
import { PAYMENT_CODE, type RecordSaleInput } from '../src/api/types'
import { loadDeviceChain } from '../src/db/events'
import { pushOnce } from '../src/sync/push'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { countAndClose } from './helpers/shift'

/**
 * plan 10 T8: recordSale with manual promotions (ADR-0070 rule 3), ฿0 promotion bills (D124 · owner Q1 = ข) and their void,
 * against the T5 mock playing dayo f4cda56 (promotion rules [1, 2] + manual fields). The two manual promotions are those of
 * the T2 fixture e1-catalog-changed-promo-rules (dayo 0074:163-202): "ชงผิด ฟรีแก้วใหม่" 100% on any cup (group main) and
 * "ลดชาไทย 5 บาท" (rule-only, group stack). Expected money is hand-computed from the test catalog (e1-catalog-rich):
 * Cocoa 16 oz ฿45 · Thai Tea 16 oz ฿35.
 */

type T = Awaited<ReturnType<typeof openConnectedApi>>
type Line = RecordSaleInput['cart']['lines'][number]
type Cart = RecordSaleInput['cart']

const RULES = { versions: [1, 2], manualFields: true }
const E1 = loadContractFixture('e1-catalog-changed-promo-rules').response.body as { data: { catalog: { promotions: CatalogPromotion[]; promotionGroups: PromotionGroup[] } } }
const FREE = '5c5c5c5c-0000-4000-8000-000000000004' // ชงผิด ฟรีแก้วใหม่ (เลือกเอง) — 100% any cup
const FIVE = '5c5c5c5c-0000-4000-8000-000000000005' // ลดชาไทย 5 บาท (เลือกเอง) — group stack
const THREE = '5c5c5c5c-0000-4000-8000-000000000006' // made here from FIVE: ฿3 off Thai Tea in group main — FIVE's group stack stacks on it
const REASON = 'ชงผิดสูตร ทำแก้วใหม่ให้ลูกค้า'
const owner = { approverUserId: STAFF.TungAo, approverPin: '1111', reason: 'แก้ตามหน้าส่งไม่ผ่าน' }

const promo = (id: string): CatalogPromotion => structuredClone(E1.data.catalog.promotions.find((p) => p.id === id)!)
/** An AUTO promotion made here from FREE: 100% off Cocoa, applied without being picked. */
const AUTO_COCOA = '5c5c5c5c-0000-4000-8000-000000000007'
function autoFreeCocoa(): CatalogPromotion {
  const p = promo(FREE)
  return { ...p, id: AUTO_COCOA, name: 'โกโก้ฟรี (อัตโนมัติ)', applyMode: 'auto', autoApply: true, priority: 5, rule: { ...p.rule!, target: { menus: ['Cocoa'] } } } as CatalogPromotion
}
function threeBaht(): CatalogPromotion {
  const p = promo(FIVE)
  return { ...p, id: THREE, name: 'ลดชาไทย 3 บาท (เลือกเอง)', groupCode: 'main', rule: { ...p.rule!, reward: { type: 'amount', baht: 3 } } } as CatalogPromotion
}

/** A tablet linked to a mock dayo f4cda56 (or, rules: false, a dayo before 0069) whose active promotions are `promos`. */
async function open(opts: { rules?: boolean; now?: string; promos?: CatalogPromotion[] } = {}): Promise<T> {
  const promos = opts.promos ?? [promo(FREE), promo(FIVE)]
  return openConnectedApi({
    ...(opts.now === undefined ? {} : { now: opts.now }),
    ...(opts.rules === false ? {} : { promoRules: RULES }),
    beforeConnect: (m) => { m.setPromotions(promos, E1.data.catalog.promotionGroups) },
  })
}

const line = (code: string, patch: Partial<Line> = {}): Line => ({ code, size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null, ...patch })
const cartOf = (lines: Line[], manualPromotionIds: string[] = [], manualPromotionReason: string | null = null, extra: Partial<Cart> = {}): Cart => ({
  channelCode: 'store', lines, billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, manualPromotionIds, manualPromotionReason, ...extra,
})

/** What the pay screen shows for this cart right now: priceCart at "now" on the stored catalog (money from the domain only). */
async function shown(t: T, cart: Cart, method: 'CASH' | 'PROMPTPAY'): Promise<number> {
  const cat = await t.api.loadSellCatalog()
  return priceCart({ ...cart, paymentCode: PAYMENT_CODE[method] }, cat.catalog, t.clock.now()).totalSatang
}
async function sell(t: T, cart: Cart, payment: RecordSaleInput['payment'], opts: { orderId?: string; expected?: number } = {}) {
  const expectedTotalSatang = opts.expected ?? await shown(t, cart, payment.method)
  return t.api.recordSale({ orderId: opts.orderId ?? t.deps.newId(), actorUserId: STAFF.TungAo, cart, payment, expectedTotalSatang })
}
const CASH0 = { method: 'CASH', tenderedSatang: 0 } as const
async function refusal(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null } catch (e) { return posErrorCode(e) }
}
async function nothingWritten(t: T): Promise<void> {
  expect(await t.db.select().from(s.order).all()).toEqual([])
  expect(await t.db.select().from(s.payment).all()).toEqual([])
  expect(await t.db.select().from(s.orderEvent).all()).toEqual([])
  expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order')).all()).toEqual([])
}
const rowOf = async (t: T, orderId: string) => (await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order:${orderId}`)).get())!
const eventsOf = async (t: T, orderId: string) => t.db.select().from(s.orderEvent).where(eq(s.orderEvent.orderId, orderId)).orderBy(s.orderEvent.seq).all()
const ctxOf = (t: T) => ({ db: t.db, deps: t.deps, serial: <R>(fn: () => Promise<R>) => fn() })

/** The E2 order keys of before plan 10, in the order buildOrderRowData writes them (spec 04 §4.5). */
const ROW_KEYS_BEFORE_PLAN_10 = ['pos_order_id', 'receipt_no', 'queue_no', 'sale_date', 'sold_at', 'channel', 'payment', 'staff_id', 'catalog_version', 'shift_id', 'lines', 'bill_discount', 'promo_code', 'skip_promotion_ids', 'no_promotions', 'totals', 'note']

describe('recordSale with manual promotions (plan 10 T8 · §0.2 E2 order)', () => {
  it('the picked manual promotion reaches the E2 row, the PAID event and pricing_json — and dayo accepts it at the same total', async () => {
    const t = await open()
    const r = await sell(t, cartOf([line('Thai Tea')], [FIVE, FIVE]), { method: 'CASH', tenderedSatang: 5_000 }) // picked twice = once
    expect(r).toMatchObject({ totalSatang: 3_000, changeSatang: 2_000 })
    const row = await rowOf(t, r.orderId)
    const data = OrderRowData.parse(row.rowJson)
    expect(data.manual_promotion_ids).toEqual([FIVE])
    expect(data.manual_promotion_reason).toBeNull()
    expect(data.totals).toEqual({ items_subtotal: 35, items_discount: 5, bill_discount: 0, total: 30 })
    // the same bill as row 1 of the T2 fixture e2-order-manual-promo-accepted, apart from the ids, numbers, times and staff of this sale
    const fixture = (loadContractFixture('e2-order-manual-promo-accepted').request.body as { rows: { data: Record<string, unknown> }[] }).rows[0]!.data
    const own = ['pos_order_id', 'receipt_no', 'queue_no', 'sale_date', 'sold_at', 'staff_id', 'catalog_version', 'shift_id']
    const strip = (d: Record<string, unknown>) => Object.fromEntries(Object.entries(d).filter(([k]) => !own.includes(k)))
    expect(strip(row.rowJson as Record<string, unknown>)).toEqual({ ...strip(fixture), manual_promotion_reason: null })
    const paid = (await eventsOf(t, r.orderId)).find((e) => e.type === 'PAID')!
    expect(paid.payloadJson).toMatchObject({ manualPromotionIds: [FIVE], manualPromotionReason: null, totalSatang: 3_000 })
    const o = (await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())!
    expect((o.pricingJson as { cart: Cart }).cart).toMatchObject({ manualPromotionIds: [FIVE, FIVE], manualPromotionReason: null })
    expect(await pushOnce(ctxOf(t))).toMatchObject({ sent: 1 })
    expect((await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())).toMatchObject({ centralComputedTotalSatang: 3_000, centralAmountMismatch: false })
  })

  it('a row without a manual promotion is the row of before plan 10, byte for byte — no manual key, not even an empty one', async () => {
    const t = await open()
    const plain = await sell(t, cartOf([line('Thai Tea')]), { method: 'CASH', tenderedSatang: 3_500 })
    // a reason typed with no promotion picked, and a picked promotion under "ไม่ใช้โปร", both leave nothing manual behind
    const reasonOnly = await sell(t, cartOf([line('Thai Tea')], [], REASON), { method: 'CASH', tenderedSatang: 3_500 })
    const none = await sell(t, cartOf([line('Thai Tea')], [FIVE], REASON, { noPromotions: true }), { method: 'CASH', tenderedSatang: 3_500 })
    for (const r of [plain, reasonOnly, none]) {
      // fix round 1 L2: a reason with no manual promotion leaving the tablet is not frozen either
      expect(((await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())!.pricingJson as { cart: Cart }).cart.manualPromotionReason).toBeNull()
      const row = await rowOf(t, r.orderId)
      expect(Object.keys(row.rowJson as object)).toEqual(ROW_KEYS_BEFORE_PLAN_10)
      expect(JSON.stringify(row.rowJson)).not.toContain('manual')
      expect(r.totalSatang).toBe(3_500)
      for (const e of await eventsOf(t, r.orderId)) expect(Object.keys(e.payloadJson as object).filter((k) => k.startsWith('manual') || k === 'promoBreakdown')).toEqual([])
    }
    // …and dayo takes them as before
    expect(await pushOnce(ctxOf(t))).toMatchObject({ sent: 3 })
  })

  it('MANUAL_PROMO_UNSUPPORTED on a dayo whose E1 does not list manual_promotion_ids — nothing is written', async () => {
    const t = await open({ rules: false })
    expect((await t.api.bootstrap()).promo.manualSupported).toBe(false)
    expect(await refusal(sell(t, cartOf([line('Cocoa')], [FREE], REASON), CASH0, { expected: 0 }))).toBe('MANUAL_PROMO_UNSUPPORTED')
    await nothingWritten(t)
    // the same cart without the manual promotion sells as before
    expect(await sell(t, cartOf([line('Cocoa')]), { method: 'CASH', tenderedSatang: 4_500 })).toMatchObject({ totalSatang: 4_500 })
  })

  it('PRICE_CHANGED still works when the picked manual promotion leaves its time window during payment', async () => {
    const five = { ...promo(FIVE), timeWindows: [{ days: [], from: '09:00', to: '13:59' }] } as CatalogPromotion
    const t = await open({ now: '2026-09-25T06:59:30.000Z', promos: [promo(FREE), five] }) // 13:59:30 Bangkok
    const cart = cartOf([line('Thai Tea')], [FIVE])
    const screen = await shown(t, cart, 'PROMPTPAY')
    expect(screen).toBe(3_000)
    t.clock.set('2026-09-25T07:00:00.000Z') // 14:00 — the window ended (to 13:59 includes that whole minute only)
    const code = await refusal(sell(t, cart, { method: 'PROMPTPAY' }, { expected: screen }))
    expect(code).toBe('PRICE_CHANGED')
    await nothingWritten(t)
    expect(await shown(t, cart, 'PROMPTPAY')).toBe(3_500)
  })

  it('a reason that is not one clean line of 1–200 characters is refused before anything is written', async () => {
    const t = await open()
    for (const bad of ['เหตุผล\nสองบรรทัด', 'ก'.repeat(201), 'ซ่อน\u200bอักษร']) {
      expect(await refusal(sell(t, cartOf([line('Thai Tea')], [FIVE], bad), { method: 'PROMPTPAY' }, { expected: 3_000 }))).toBe('BAD_INPUT')
    }
    await nothingWritten(t)
    // …but the same text left over with no manual promotion sent is dropped, never a refusal (fix round 1 L2)
    for (const cart of [cartOf([line('Thai Tea')], [], 'เหตุผล\nสองบรรทัด'), cartOf([line('Thai Tea')], [FIVE], 'ซ่อน\u200bอักษร', { noPromotions: true })]) {
      const r = await sell(t, cart, { method: 'PROMPTPAY' }, { expected: 3_500 })
      const o = (await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())!
      expect((o.pricingJson as { cart: Cart }).cart.manualPromotionReason).toBeNull()
      expect(JSON.stringify((await rowOf(t, r.orderId)).rowJson)).not.toContain('manual')
    }
  })
})

describe('a ฿0 bill (D124 · owner Q1 = ข)', () => {
  it('only from a promotion, with the reason the engine asks for, paid cash 0 — MANUAL_REASON_REQUIRED writes nothing', async () => {
    const t = await open()
    const cart = cartOf([line('Cocoa')], [FREE])
    expect(await shown(t, cart, 'CASH')).toBe(0)
    expect(await refusal(sell(t, cart, CASH0))).toBe('MANUAL_REASON_REQUIRED')
    expect(await refusal(sell(t, cartOf([line('Cocoa')], [FREE], ' 　 '), CASH0, { expected: 0 }))).toBe('MANUAL_REASON_REQUIRED') // trims to nothing = no reason
    await nothingWritten(t)
    const r = await sell(t, cartOf([line('Cocoa')], [FREE], `  ${REASON} `), CASH0, { expected: 0 })
    expect(r).toMatchObject({ totalSatang: 0, changeSatang: 0, method: 'CASH' })
    const pay = await t.db.select().from(s.payment).where(eq(s.payment.orderId, r.orderId)).all()
    expect(pay.map((p) => [p.method, p.amountSatang, p.tenderedSatang, p.changeSatang])).toEqual([['CASH', 0, 0, 0]])
    const o = (await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())!
    expect([o.subtotalSatang, o.discountSatang, o.totalSatang, o.status]).toEqual([4_500, 4_500, 0, 'paid'])
    const data = OrderRowData.parse((await rowOf(t, r.orderId)).rowJson)
    expect([data.manual_promotion_ids, data.manual_promotion_reason, data.payment, data.totals.total]).toEqual([[FREE], REASON, 'cash', 0]) // dayo's trim, byte for byte
    expect((await eventsOf(t, r.orderId)).find((e) => e.type === 'PAID')!.payloadJson).toMatchObject({ manualPromotionIds: [FREE], manualPromotionReason: REASON, totalSatang: 0, tenderedSatang: 0, changeSatang: 0 })
    expect(await t.api.getOrder(r.orderId)).toMatchObject({ totalSatang: 0, manualPromotionReason: REASON, promotions: [{ discountSatang: 4_500 }] })
    // dayo re-quotes it to ฿0 with the same reason: accepted, no mismatch
    expect(await pushOnce(ctxOf(t))).toMatchObject({ sent: 1 })
    expect((await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())).toMatchObject({ centralComputedTotalSatang: 0, centralAmountMismatch: false })
  })

  it('ZERO_TOTAL_CASH_ONLY by PromptPay · BAD_INPUT with cash handed over — nothing written', async () => {
    const t = await open()
    const cart = cartOf([line('Cocoa')], [FREE], REASON)
    expect(await refusal(sell(t, cart, { method: 'PROMPTPAY' }, { expected: 0 }))).toBe('ZERO_TOTAL_CASH_ONLY')
    expect(await refusal(sell(t, cart, { method: 'CASH', tenderedSatang: 10_000 }, { expected: 0 }))).toBe('BAD_INPUT')
    await nothingWritten(t)
  })

  it('never from a typed discount: a free cup, a line discount or a bill discount to ฿0 is ZERO_TOTAL_NOT_ALLOWED, with or without a promotion', async () => {
    const t = await open()
    const carts = [
      cartOf([line('Cocoa', { free: true, discountReason: 'แถม' })]),
      cartOf([line('Cocoa', { discountSatang: 4_500, discountReason: 'ลดให้' })]),
      cartOf([line('Cocoa')], [], null, { billDiscount: { kind: 'satang', satang: 4_500, reason: 'ลดให้' } }),
      cartOf([line('Cocoa'), line('Thai Tea', { free: true, discountReason: 'แถม' })], [FREE], REASON), // the promotion zeroes one cup, a typed free cup the other
      // fix round 1 L1: the same with no reason — the engine's only problem is that reason, so the ฿0 rule speaks first
      // (never PRICE_NOT_OK, which would change to ZERO_TOTAL_NOT_ALLOWED once a reason is typed)
      cartOf([line('Cocoa'), line('Thai Tea', { free: true, discountReason: 'แถม' })], [FREE]),
    ]
    for (const cart of carts) {
      expect(await shown(t, cart, 'CASH')).toBe(0)
      expect(await refusal(sell(t, cart, CASH0))).toBe('ZERO_TOTAL_NOT_ALLOWED')
    }
    await nothingWritten(t)
  })

  it('owner Q7 = ก (D133): ฿0 from an AUTO promotion with a manual one picked that gives nothing still needs the reason', async () => {
    const t = await open({ promos: [autoFreeCocoa(), promo(FIVE)] })
    const cart = cartOf([line('Cocoa')], [FIVE]) // FIVE is Thai Tea only: no discount on this bill, and the engine asks nothing
    const cat = await t.api.loadSellCatalog()
    const priced = priceCart({ ...cart, paymentCode: 'cash' }, cat.catalog, t.clock.now())
    expect([priced.totalSatang, priced.ok, priced.manualPromotionReasonRequired]).toEqual([0, true, false])
    expect(await refusal(sell(t, cart, CASH0))).toBe('MANUAL_REASON_REQUIRED')
    await nothingWritten(t)
    const r = await sell(t, cartOf([line('Cocoa')], [FIVE], REASON), CASH0)
    expect(r).toMatchObject({ totalSatang: 0, changeSatang: 0 })
    const data = OrderRowData.parse((await rowOf(t, r.orderId)).rowJson)
    expect([data.manual_promotion_ids, data.manual_promotion_reason, data.totals.total]).toEqual([[FIVE], REASON, 0])
  })

  it('counts in the X report and the Z as one bill of ฿0 (the formulas do not change)', async () => {
    const t = await open()
    await sell(t, cartOf([line('Cocoa')], [FREE], REASON), CASH0)
    const x = await t.api.shiftReport()
    expect(x.sales).toEqual({ orderCount: 1, voidCount: 0, grossSalesSatang: 4_500, discountSatang: 4_500, voidedSatang: 0, netSalesSatang: 0, cashSalesSatang: 0, qrSalesSatang: 0, qrRefundedSatang: 0, qrNetSatang: 0 })
    expect(x.expectedCashSatang).toBe(50_000)
    const { z } = await countAndClose(t, [{ denominationSatang: 50_000, count: 1 }], { approverUserId: STAFF.DCm, approverPin: '2222' })
    expect(z?.snapshot?.sales).toMatchObject({ orderCount: 1, grossSalesSatang: 4_500, discountSatang: 4_500, netSalesSatang: 0, cashSalesSatang: 0 })
  })
})

describe('voiding a ฿0 bill (plan 10 T8 step 3)', () => {
  it('queues its order_void but no VOID_REFUND (nothing was paid — cash_movement amount must be > 0)', async () => {
    const t = await open()
    const r = await sell(t, cartOf([line('Cocoa')], [FREE], REASON), CASH0)
    t.clock.advanceMs(60_000)
    const d = await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'ลูกค้าไม่เอา', made: false, refundReference: null })
    expect(d.status).toBe('voided')
    expect(await t.db.select().from(s.cashMovement).all()).toEqual([])
    const v = (await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_void')).get())!
    expect(v).toMatchObject({ status: 'pending', parentKey: `order:${r.orderId}` })
    expect(OrderVoidRowData.parse(v.rowJson)).toMatchObject({ pos_order_id: r.orderId, reason: 'ลูกค้าไม่เอา' })
    expect((await eventsOf(t, r.orderId)).find((e) => e.type === 'VOIDED')!.payloadJson).toMatchObject({ cashRefundSatang: 0, cashMovementId: null, qrRefundSatang: 0 })
    expect((await t.api.shiftReport()).sales).toMatchObject({ orderCount: 1, voidCount: 1, voidedSatang: 0, netSalesSatang: 0 })
    expect(verifyChain(await loadDeviceChain(t.db, t.device.id))).toEqual({ ok: true }) // fix round 1 L3a: the ฿0 sale and its void
    expect(await pushOnce(ctxOf(t))).toMatchObject({ sent: 2 })
  })

  it('dayo rejects it `reason_required:` (a tablet bug): the INVALID remedies; kept local, its void sends nothing at all (dayo item 12)', async () => {
    const t = await open()
    const r = await sell(t, cartOf([line('Cocoa')], [FREE], REASON), CASH0)
    t.mock.override({ match: { receiptNo: r.receiptNo }, verdict: { status: 'rejected', reason: 'INVALID', detail: 'reason_required: โปรที่เลือกเองทำให้บิลเหลือ ฿0 ต้องใส่เหตุผลค่ะ' }, times: 1 })
    await pushOnce(ctxOf(t))
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ kind: 'order', receiptNo: r.receiptNo, reason: 'INVALID', prefix: 'reason_required:', remedies: ['RETRY', 'EXCLUDE'] })
    await t.api.excludeFromSync({ ...owner, outboxId: p!.outboxId })
    t.clock.advanceMs(60_000)
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'ลูกค้าไม่เอา', made: false, refundReference: null })
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_void')).all()).toEqual([])
    expect(await t.db.select().from(s.cashMovement).all()).toEqual([])
    expect(await t.db.select().from(s.outbox).where(and(eq(s.outbox.status, 'pending'))).all()).toEqual([])
  })
})

describe('the same orderId again (plan 3 M12 · T8 carried item)', () => {
  it('with other manual promotions or another reason is refused, never answered with the first bill', async () => {
    const t = await open({ promos: [promo(FREE), promo(FIVE), threeBaht()] })
    const orderId = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21'
    const first = await sell(t, cartOf([line('Thai Tea')], [FIVE], 'ลูกค้าประจำ'), { method: 'PROMPTPAY' }, { orderId })
    for (const cart of [
      cartOf([line('Thai Tea')]), // none
      cartOf([line('Thai Tea')], [THREE], 'ลูกค้าประจำ'), // another promotion
      cartOf([line('Thai Tea')], [FIVE, THREE], 'ลูกค้าประจำ'), // one more
      cartOf([line('Thai Tea')], [FIVE], 'อีกเหตุผล'), // another reason
      cartOf([line('Thai Tea')], [FIVE]), // no reason
    ]) {
      expect(await refusal(sell(t, cart, { method: 'PROMPTPAY' }, { orderId }))).toBe('BAD_INPUT')
    }
    // the same promotions and reason (picked twice, typed with spaces) is the same bill
    expect(await sell(t, cartOf([line('Thai Tea')], [FIVE, FIVE], '  ลูกค้าประจำ '), { method: 'PROMPTPAY' }, { orderId, expected: 3_000 })).toMatchObject({ receiptNo: first.receiptNo, totalSatang: 3_000 })
    expect(await t.db.select().from(s.order).all()).toHaveLength(1)
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order')).all()).toHaveLength(1)
  })

  it('a bill frozen before plan 10 (pricing_json without any manual key or promoBreakdown) still reads and still answers its resend', async () => {
    const t = await open()
    const orderId = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f22'
    const first = await sell(t, cartOf([line('Cocoa')]), { method: 'PROMPTPAY' }, { orderId })
    // rewrite pricing_json to its block-2 shape: cart without manualPromotionIds/manualPromotionReason, priced lines
    // without promoBreakdown, priced without manualPromotionReasonRequired, promotions without mode/limits
    const o = (await t.db.select().from(s.order).where(eq(s.order.id, orderId)).get())!
    const pj = structuredClone(o.pricingJson) as { cart: Record<string, unknown>; priced: { lines: Record<string, unknown>[]; promotionsApplied: Record<string, unknown>[]; manualPromotionReasonRequired?: unknown } }
    delete pj.cart['manualPromotionIds']
    delete pj.cart['manualPromotionReason']
    for (const l of pj.priced.lines) delete l['promoBreakdown']
    for (const p of pj.priced.promotionsApplied) { delete p['mode']; delete p['usageLimitTotal']; delete p['usageLimitPerDay'] }
    delete pj.priced.manualPromotionReasonRequired
    await t.db.update(s.order).set({ pricingJson: pj as never }).where(eq(s.order.id, orderId))
    expect(await sell(t, cartOf([line('Cocoa')]), { method: 'PROMPTPAY' }, { orderId })).toMatchObject({ receiptNo: first.receiptNo, totalSatang: 4_500 })
    expect(await refusal(sell(t, cartOf([line('Cocoa')], [FREE], REASON), { method: 'PROMPTPAY' }, { orderId, expected: 0 }))).toBe('BAD_INPUT')
    const d = await t.api.getOrder(orderId)
    expect(d.manualPromotionReason).toBeNull()
    expect(d.lines.map((l) => l.promoBreakdown)).toEqual([null])
  })
})

describe('the split of a cup discounted by two promotions (R2 · OrderDetailDto.lines[].promoBreakdown)', () => {
  it('is frozen in pricing_json and the LINE_ADDED event, and read back in satang with the promotion names', async () => {
    const t = await open({ promos: [promo(FREE), promo(FIVE), threeBaht()] })
    const r = await sell(t, cartOf([line('Thai Tea')], [FIVE, THREE]), { method: 'PROMPTPAY' })
    expect(r.totalSatang).toBe(2_700) // 35 − 3 (group main) − 5 (group stack, which stacks on a cup another group discounted)
    const want = [{ promotionId: THREE, satang: 300 }, { promotionId: FIVE, satang: 500 }]
    const added = (await eventsOf(t, r.orderId)).find((e) => e.type === 'LINE_ADDED')!
    expect((added.payloadJson as { promoBreakdown: unknown }).promoBreakdown).toEqual(want)
    const d = await t.api.getOrder(r.orderId)
    expect(d.lines[0]!.promoBreakdown).toEqual([
      { promotionId: THREE, name: 'ลดชาไทย 3 บาท (เลือกเอง)', satang: 300 },
      { promotionId: FIVE, name: 'ลดชาไทย 5 บาท (เลือกเอง)', satang: 500 },
    ])
    expect(d.manualPromotionReason).toBeNull()
    // fix round 1 L3a: the chain holds with promoBreakdown and the manual keys under the hash
    const paid = (await eventsOf(t, r.orderId)).find((e) => e.type === 'PAID')!
    expect(paid.payloadJson).toMatchObject({ manualPromotionIds: [FIVE, THREE], manualPromotionReason: null })
    expect(verifyChain(await loadDeviceChain(t.db, t.device.id))).toEqual({ ok: true })
  })
})

describe('gap G4: a manual promotion over its usage limit on dayo', () => {
  it('the tablet does not count: it still offers and prices it; dayo accepts the bill with amount_mismatch and a warning — not a sync problem', async () => {
    const five = { ...promo(FIVE), usageLimitTotal: 1 } as CatalogPromotion
    const t = await open({ promos: [promo(FREE), five] })
    const first = await sell(t, cartOf([line('Thai Tea')], [FIVE]), { method: 'PROMPTPAY' })
    expect(await pushOnce(ctxOf(t))).toMatchObject({ sent: 1 })
    t.mock.exhaust(FIVE, 'total') // dayo's count: used up from now on
    const cat = await t.api.loadSellCatalog()
    const offered = selectableManualPromotions({ ...cartOf([line('Thai Tea')]), paymentCode: 'qr' }, cat.catalog, t.clock.now())
    expect(offered.find((p) => p.promotionId === FIVE)).toMatchObject({ usageLimitTotal: 1 }) // shown with its limit, never counted here
    const second = await sell(t, cartOf([line('Thai Tea')], [FIVE]), { method: 'PROMPTPAY' })
    expect(second.totalSatang).toBe(3_000)
    expect(await pushOnce(ctxOf(t))).toMatchObject({ sent: 1, rejected: 0 })
    const row = await rowOf(t, second.orderId)
    expect(row.status).toBe('sent')
    expect((row.resultJson as { warnings: string[] }).warnings.length).toBeGreaterThan(0)
    expect(await t.db.select().from(s.order).where(eq(s.order.id, second.orderId)).get()).toMatchObject({ centralComputedTotalSatang: 3_500, centralAmountMismatch: true })
    expect(await t.db.select().from(s.order).where(eq(s.order.id, first.orderId)).get()).toMatchObject({ centralComputedTotalSatang: 3_000, centralAmountMismatch: false })
    // an accepted row with warnings is no sync problem — it is a price difference for the owner
    expect(await countSyncProblems(t.db)).toBe(0)
    expect(await t.api.listSyncProblems(STAFF.TungAo)).toEqual([])
    expect((await t.api.bootstrap()).sync.problemSyncRows).toBe(0)
    expect(await t.api.listPriceDiffs(STAFF.TungAo)).toMatchObject([{ kind: 'amount', orderId: second.orderId, totalSatang: 3_000, computedTotalSatang: 3_500, diffSatang: 500, amountMismatch: true }])
  })
})
