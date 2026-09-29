import { describe, expect, it } from 'vitest'
import { OrderRowData } from '@dayo/contracts'
import { buildOrderRowData, orderRowToCart } from '../src/order-row.js'
import { CartError, priceCart, type CartDraft } from '../src/price-cart.js'
import { loadContractFixture } from '@dayo/contracts/fixture-files'
import { POS_CATALOG } from './fixtures/pos-catalog.js'
import { PROMO, promoRulesCatalog } from './fixtures/promo-rules-catalog.js'

const SOLD_AT = '2026-09-25T03:15:03.120Z'
const CART: CartDraft = {
  channelCode: 'store', paymentCode: 'cash', promoCode: null, skipPromotionIds: [], noPromotions: false, manualPromotionIds: [], manualPromotionReason: null,
  billDiscount: { kind: 'satang', satang: 500, reason: 'ลูกค้าประจำ' },
  lines: [
    { code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 3, free: false, discountSatang: null, discountPercent: null, discountReason: null },
    { code: 'Matcha Latte', size: '16 oz', sweetness: '50%', milk: 'oat', grade: 'Premium', qty: 1, free: false, discountSatang: 525, discountPercent: null, discountReason: 'ทดลองสูตร' },
  ],
}

describe('buildOrderRowData (spec §4.5 row kind order)', () => {
  const priced = priceCart(CART, POS_CATALOG, SOLD_AT)
  const data = buildOrderRowData({ posOrderId: '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21', receiptNo: 'A-000312', queueNo: 12, staffId: '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d', catalogVersion: 42, shiftId: null, cart: CART, priced, note: null })
  it('passes the contract schema', () => { expect(OrderRowData.parse(data)).toEqual(data) })
  it('sends shift_id null for a local-only shift, and the interpreted milk/grade', () => {
    expect(data.shift_id).toBeNull()
    expect(data.lines.map((l) => [l.milk, l.grade])).toEqual([['fresh', null], ['oat', 'Premium']])
  })
  it('block 3: carries the central shift id as given (spec §4.5 shift_id · §4.10 ข้อ 4)', () => {
    const shiftId = '5a5a5a5a-0000-4000-8000-000000000001'
    const row = buildOrderRowData({ posOrderId: '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21', receiptNo: 'A-000312', queueNo: 12, staffId: '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d', catalogVersion: 42, shiftId, cart: CART, priced, note: null })
    expect(OrderRowData.parse(row).shift_id).toBe(shiftId)
    expect(row).toEqual({ ...data, shift_id: shiftId })
  })
  it('totals are the charged amounts in baht from the re-price at sold_at', () => {
    expect(Math.round(data.totals.total * 100)).toBe(priced.totalSatang)
    expect(data.sale_date).toBe('2026-09-25')
    expect(data.sold_at).toBe(SOLD_AT)
  })
  it('optional line fields appear only when set', () => {
    expect(Object.keys(data.lines[0]!)).toEqual(['code', 'size', 'sweetness', 'milk', 'grade', 'qty'])
    expect(data.lines[1]).toMatchObject({ discount_baht: 5.25, discount_reason: 'ทดลองสูตร' })
  })
  it('orderRowToCart undoes buildOrderRowData', () => {
    expect(orderRowToCart(data)).toEqual({ cart: CART, soldAt: SOLD_AT })
  })
  it('a size the shop no longer sells never reaches a row: priceCart refuses it first (ADR-0054)', () => {
    const odd: CartDraft = { ...CART, lines: [{ ...CART.lines[0]!, size: '22 oz' }] }
    try { priceCart(odd, POS_CATALOG, SOLD_AT); expect.unreachable() } catch (e) { expect(e).toBeInstanceOf(CartError); expect((e as CartError).code).toBe('UNKNOWN_VARIANT') }
  })
  it('carries any priced "<n> oz" size as is (dayo Size is free text since ADR-0054)', () => {
    const c: CartDraft = { ...CART, lines: [{ ...CART.lines[0]!, size: '20 oz' }] }
    const row = buildOrderRowData({ posOrderId: '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21', receiptNo: 'A-000312', queueNo: 12, staffId: '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d', catalogVersion: 42, shiftId: null, cart: c, priced: priceCart(c, POS_CATALOG, SOLD_AT), note: null })
    expect(OrderRowData.parse(row).lines[0]!.size).toBe('20 oz')
  })
})

describe('manual promotions in the E2 row (plan 10 §0.2 · dayo 0069)', () => {
  const CAT = promoRulesCatalog()
  const ids = { posOrderId: '5d5d5d5d-0000-4000-8000-000000000002', receiptNo: 'A-000314', queueNo: 14, staffId: '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d', catalogVersion: 43, shiftId: null, note: null }
  const matcha: CartDraft['lines'][number] = { code: 'Matcha Latte', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: 'Excellent', qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null }
  const base: CartDraft = { channelCode: 'store', paymentCode: 'cash', promoCode: null, skipPromotionIds: [], noPromotions: false, billDiscount: null, lines: [matcha], manualPromotionIds: [], manualPromotionReason: null }
  const at = '2026-09-25T03:25:00.000Z'
  const rowOf = (c: CartDraft): OrderRowData => buildOrderRowData({ ...ids, cart: c, priced: priceCart(c, CAT, at) })
  it('a row with no manual promotion has exactly the keys of before plan 10 — byte for byte', () => {
    const row = rowOf({ ...base, manualPromotionReason: 'ไม่มีโปรเลือกเอง' })
    expect(Object.keys(row)).toEqual(['pos_order_id', 'receipt_no', 'queue_no', 'sale_date', 'sold_at', 'channel', 'payment', 'staff_id', 'catalog_version', 'shift_id', 'lines', 'bill_discount', 'promo_code', 'skip_promotion_ids', 'no_promotions', 'totals', 'note'])
  })
  it('equals the row of contract fixture e2-order-manual-promo-accepted (฿0 with its reason)', () => {
    const c: CartDraft = { ...base, manualPromotionIds: [PROMO.M_FREE, PROMO.M_FREE], manualPromotionReason: 'ชงผิดสูตร ทำแก้วใหม่ให้ลูกค้า' }
    const fixture = (loadContractFixture('e2-order-manual-promo-accepted').request.body as { rows: { data: unknown }[] }).rows[1]!.data
    expect(OrderRowData.parse(rowOf(c))).toEqual(fixture)
  })
  it('both keys go together: ids de-duplicated, reason null when none', () => {
    const c: CartDraft = { ...base, lines: [{ ...matcha, code: 'Thai Tea', grade: null }], manualPromotionIds: [PROMO.M_5, PROMO.M_5] }
    const row = OrderRowData.parse(rowOf(c))
    expect([row.manual_promotion_ids, row.manual_promotion_reason, row.totals.total]).toEqual([[PROMO.M_5], null, 30])
  })
  it('noPromotions sends no manual promotion', () => {
    const row = rowOf({ ...base, noPromotions: true, manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: 'x' })
    expect(['manual_promotion_ids' in row, 'manual_promotion_reason' in row]).toEqual([false, false])
  })
  it('promo_code goes in normPromoCode form', () => {
    expect(rowOf({ ...base, promoCode: ' dayo10 ' }).promo_code).toBe('DAYO10')
    expect(rowOf({ ...base, promoCode: '  ' }).promo_code).toBeNull()
  })
  it('orderRowToCart reads the manual keys back (and none = [] / null)', () => {
    const c: CartDraft = { ...base, manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: 'ชงผิดสูตร' }
    expect(orderRowToCart(rowOf(c))).toEqual({ cart: c, soldAt: at })
    expect(orderRowToCart(rowOf(base))).toEqual({ cart: base, soldAt: at })
  })
})
