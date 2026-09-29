import { describe, expect, it } from 'vitest'
import { OrderRowData } from '@dayo/contracts'
import { buildOrderRowData, orderRowToCart } from '../src/order-row.js'
import { CartError, priceCart, type CartDraft } from '../src/price-cart.js'
import { POS_CATALOG } from './fixtures/pos-catalog.js'

const SOLD_AT = '2026-09-25T03:15:03.120Z'
const CART: CartDraft = {
  channelCode: 'store', paymentCode: 'cash', promoCode: null, skipPromotionIds: [], noPromotions: false,
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
