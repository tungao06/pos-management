import { describe, expect, it } from 'vitest'
import { priceCart, type CartDraft, type CartLineDraft } from '../src/price-cart.js'
import { lineUnitPriceSatang } from '../src/line-unit-price.js'
import { POS_CATALOG } from './fixtures/pos-catalog.js'

const line = (over: Partial<CartLineDraft> = {}): CartLineDraft => ({
  code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, free: false,
  discountSatang: null, discountPercent: null, discountReason: null, ...over,
})
const cart = (lines: CartLineDraft[], over: Partial<CartDraft> = {}): CartDraft => ({
  channelCode: 'store', paymentCode: 'cash', lines, billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, ...over,
})
const FRI_1030 = '2026-09-25T03:30:00.000Z' // Friday 10:30 Bangkok, before Matcha's 14:00–16:00 promo window

describe('lineUnitPriceSatang (review I1) — the exact number ItemDialog shows, no manual addition', () => {
  it('the Grab channel prices Thai Tea 20 oz at ฿59.00 (45 × 1.30, ceil_baht)', () => {
    expect(lineUnitPriceSatang(POS_CATALOG, 'Thai Tea', '20 oz', '50%', 'fresh', null, 'grab')).toBe(5_900)
  })

  it('matches the PricedLine.unitPriceSatang priceCart produces for the same combo — Thai Tea 16 oz + oat milk', () => {
    const priced = priceCart(cart([line({ milk: 'oat' })]), POS_CATALOG, FRI_1030)
    const one = lineUnitPriceSatang(POS_CATALOG, 'Thai Tea', '16 oz', '50%', 'oat', null, 'store')
    expect(one).toBe(priced.lines[0]!.unitPriceSatang)
  })

  it('matches priceCart for a matcha grade too — Matcha Latte 16 oz, grade Premium', () => {
    const priced = priceCart(cart([line({ code: 'Matcha Latte', sweetness: '50%', grade: 'Premium' })]), POS_CATALOG, FRI_1030)
    const one = lineUnitPriceSatang(POS_CATALOG, 'Matcha Latte', '16 oz', '50%', 'fresh', 'Premium', 'store')
    expect(one).toBe(priced.lines[0]!.unitPriceSatang)
  })

  it('null on an unknown channel, a closed size, or an option the variant does not offer (Cocoa has no oat swap)', () => {
    expect(lineUnitPriceSatang(POS_CATALOG, 'Thai Tea', '16 oz', '50%', 'fresh', null, 'nope')).toBeNull()
    expect(lineUnitPriceSatang(POS_CATALOG, 'Thai Tea', '22 oz', '50%', 'fresh', null, 'store')).toBeNull() // 22 oz is inactive
    expect(lineUnitPriceSatang(POS_CATALOG, 'Cocoa', '16 oz', '50%', 'oat', null, 'store')).toBeNull()
    expect(lineUnitPriceSatang(POS_CATALOG, 'Nope', '16 oz', '50%', 'fresh', null, 'store')).toBeNull()
  })

  it('the +฿ label of an option button is the difference of two calls, never a hand-added satang delta', () => {
    const withoutOat = lineUnitPriceSatang(POS_CATALOG, 'Thai Tea', '16 oz', '50%', 'fresh', null, 'store')!
    const withOat = lineUnitPriceSatang(POS_CATALOG, 'Thai Tea', '16 oz', '50%', 'oat', null, 'store')!
    expect(withOat - withoutOat).toBe(1_500) // oat priceAdd 15 baht on a channel with no markup
  })
})
