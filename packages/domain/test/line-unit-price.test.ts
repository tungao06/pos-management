import { describe, expect, it } from 'vitest'
import { priceCart, type CartDraft, type CartLineDraft } from '../src/price-cart.js'
import { lineUnitPriceSatang, optionDeltaSatang } from '../src/line-unit-price.js'
import { POS_CATALOG } from './fixtures/pos-catalog.js'

const line = (over: Partial<CartLineDraft> = {}): CartLineDraft => ({
  code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, free: false,
  discountSatang: null, discountPercent: null, discountReason: null, ...over,
})
const cart = (lines: CartLineDraft[], over: Partial<CartDraft> = {}): CartDraft => ({
  channelCode: 'store', paymentCode: 'cash', lines, billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, manualPromotionIds: [], manualPromotionReason: null, ...over,
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

  it('matches priceCart on a channel with a flat priceAddBaht AND an active promotion — LINE MAN, Matcha Latte 16 oz grade Premium, inside the 14:00–16:00 promo window (review round 2 item 3)', () => {
    const DURING_PROMO = '2026-09-25T07:30:00.000Z' // Friday 14:30 Bangkok — inside มัตฉะบ่าย ลด 15%'s window
    const priced = priceCart(cart([line({ code: 'Matcha Latte', sweetness: '50%', grade: 'Premium' })], { channelCode: 'lineman', paymentCode: 'qr' }), POS_CATALOG, DURING_PROMO)
    expect(priced.promotionsApplied.length).toBeGreaterThan(0) // sanity: the promo really fired for this line
    const one = lineUnitPriceSatang(POS_CATALOG, 'Matcha Latte', '16 oz', '50%', 'fresh', 'Premium', 'lineman')
    // lineUnitPriceSatang is the pre-promotion unit price (like priced.lines[0].unitPriceSatang) — a promotion
    // changes discountPerCupSatang/lineTotalSatang, never unitPriceSatang, so this must still match exactly.
    expect(one).toBe(priced.lines[0]!.unitPriceSatang)
  })

  it('the +฿ label of an option button is the difference of two calls, never a hand-added satang delta', () => {
    const withoutOat = lineUnitPriceSatang(POS_CATALOG, 'Thai Tea', '16 oz', '50%', 'fresh', null, 'store')!
    const withOat = lineUnitPriceSatang(POS_CATALOG, 'Thai Tea', '16 oz', '50%', 'oat', null, 'store')!
    expect(withOat - withoutOat).toBe(1_500) // oat priceAdd 15 baht on a channel with no markup
  })
})

describe('optionDeltaSatang (review round 2 item 5) — no subtraction ever runs in a screen', () => {
  it('equals lineUnitPriceSatang(to) − lineUnitPriceSatang(from)', () => {
    const delta = optionDeltaSatang(POS_CATALOG, 'Thai Tea', '16 oz', '50%', 'store', { milk: 'fresh', grade: null }, { milk: 'oat', grade: null })
    const from = lineUnitPriceSatang(POS_CATALOG, 'Thai Tea', '16 oz', '50%', 'fresh', null, 'store')!
    const to = lineUnitPriceSatang(POS_CATALOG, 'Thai Tea', '16 oz', '50%', 'oat', null, 'store')!
    expect(delta).toBe(to - from)
    expect(delta).toBe(1_500)
  })

  it('a cheaper grade than the reference gives a negative delta (never hidden as 0)', () => {
    // Excellent (priceAdd 0) is cheaper than Premium (priceAdd 20) — from Premium to Excellent must be negative.
    const delta = optionDeltaSatang(POS_CATALOG, 'Matcha Latte', '16 oz', '50%', 'store', { milk: 'fresh', grade: 'Premium' }, { milk: 'fresh', grade: 'Excellent' })
    expect(delta).toBeLessThan(0)
  })

  it('null when either side cannot be priced', () => {
    expect(optionDeltaSatang(POS_CATALOG, 'Thai Tea', '16 oz', '50%', 'nope', { milk: 'fresh', grade: null }, { milk: 'oat', grade: null })).toBeNull()
  })
})
