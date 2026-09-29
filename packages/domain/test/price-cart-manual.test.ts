import { describe, expect, it } from 'vitest'
import { computeOrder, type QuoteResult } from '@dayo/dayo-pricing'
import { MAX_MANUAL_PROMOTIONS } from '@dayo/contracts'
import {
  CartError, checkCart, manualPromotionsOf, priceCart, toOrderDraft, withZeroCosts, zeroTotalVerdict,
  type CartDraft, type CartLineDraft, type PosOrderCatalog,
} from '../src/price-cart.js'
import { pricedFromQuote } from '../src/priced-from-quote.js'
import { PROMO, promoRulesCatalog } from './fixtures/promo-rules-catalog.js'

const CAT = promoRulesCatalog()
const FRI_1030 = '2026-09-25T03:30:00.000Z' // Friday 10:30 Bangkok
const FRI_1800 = '2026-09-25T11:00:00.000Z' // Friday 18:00 Bangkok (Matcha evening 10% runs 17:00–20:00)
const line = (over: Partial<CartLineDraft> = {}): CartLineDraft => ({ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null, ...over })
const matcha = (over: Partial<CartLineDraft> = {}): CartLineDraft => line({ code: 'Matcha Latte', grade: 'Excellent', ...over })
const cart = (lines: CartLineDraft[], over: Partial<CartDraft> = {}): CartDraft => ({
  channelCode: 'store', paymentCode: 'cash', lines, billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false,
  manualPromotionIds: [], manualPromotionReason: null, ...over,
})
const REFUSE = (f: () => unknown, code: CartError['code']): void => {
  try { f(); expect.unreachable() } catch (e) { expect(e).toBeInstanceOf(CartError); expect((e as CartError).code).toBe(code) }
}
const uuid = (i: number): string => `5c5c5c5c-0000-4000-8000-${String(i).padStart(12, '0')}`

describe('manual promotions (ADR-0070 · plan 10 §0.2) go to dayo\'s engine only when the cart picked them', () => {
  it('a manual promotion is used only when picked', () => {
    const none = priceCart(cart([line()]), CAT, FRI_1030)
    expect([none.totalSatang, none.promotionsApplied]).toEqual([3_500, []])
    const picked = priceCart(cart([line()], { manualPromotionIds: [PROMO.M_5] }), CAT, FRI_1030)
    expect(picked.totalSatang).toBe(3_000)
    expect(picked.promotionsApplied).toEqual([
      { promotionId: PROMO.M_5, code: null, name: 'ลดชาไทย 5 บาท (เลือกเอง)', kind: 'item_discount', mode: 'manual', discountSatang: 500, usageLimitTotal: null, usageLimitPerDay: null },
    ])
    expect(picked.lines.map((l) => [l.discountPerCupSatang, l.promotionId, l.promoBreakdown])).toEqual([[500, PROMO.M_5, null]])
  })
  it('the same id twice reaches the engine once', () => {
    const c = cart([line()], { manualPromotionIds: [PROMO.M_5, PROMO.M_5] })
    expect(toOrderDraft(c, CAT, FRI_1030).manualPromotionIds).toEqual([PROMO.M_5])
    expect(priceCart(c, CAT, FRI_1030).totalSatang).toBe(3_000)
  })
  it(`more than ${MAX_MANUAL_PROMOTIONS} after de-duplication is BAD_MANUAL_PROMOTION (dayo DY422); ${MAX_MANUAL_PROMOTIONS} with repeats is fine`, () => {
    const ids = Array.from({ length: MAX_MANUAL_PROMOTIONS + 1 }, (_, i) => uuid(100 + i))
    REFUSE(() => priceCart(cart([line()], { manualPromotionIds: ids }), CAT, FRI_1030), 'BAD_MANUAL_PROMOTION')
    const twenty = ids.slice(0, MAX_MANUAL_PROMOTIONS)
    expect(() => checkCart(cart([line()], { manualPromotionIds: [...twenty, ...twenty] }), CAT)).not.toThrow()
    expect(toOrderDraft(cart([line()], { manualPromotionIds: [...twenty, ...twenty] }), CAT, FRI_1030).manualPromotionIds).toEqual(twenty)
  })
  it('noPromotions wins over a picked manual promotion — nothing manual reaches the engine', () => {
    const c = cart([line()], { noPromotions: true, manualPromotionIds: [PROMO.M_5], manualPromotionReason: 'ลูกค้าประจำ' })
    const d = toOrderDraft(c, CAT, FRI_1030)
    expect('manualPromotionIds' in d).toBe(false)
    expect('manualPromotionReason' in d).toBe(false)
    const p = priceCart(c, CAT, FRI_1030)
    expect([p.totalSatang, p.promotionsApplied]).toEqual([3_500, []])
  })
  it('a cart frozen before plan 10 (no manual keys at all) still checks, prices and judges like an empty pick (review L2)', () => {
    const fresh = cart([line()])
    const { manualPromotionIds: _i, manualPromotionReason: _r, ...rest } = fresh
    const old = rest as unknown as CartDraft // pricing_json.cart of a bill paid before plan 10
    expect(() => checkCart(old, CAT)).not.toThrow()
    const p = priceCart(old, CAT, FRI_1030)
    expect(p).toEqual(priceCart(fresh, CAT, FRI_1030))
    expect(manualPromotionsOf(old)).toEqual({ ids: [], reason: null })
    expect(zeroTotalVerdict(old, p)).toBe('ok')
  })
  it('a cart with no manual promotion prices the same draft as before plan 10 (no new keys)', () => {
    const d = toOrderDraft(cart([line()], { manualPromotionReason: 'ไม่มีโปรเลือกเอง' }), CAT, FRI_1030)
    expect(Object.keys(d).sort()).toEqual(['billDiscountBaht', 'billDiscountPercent', 'billDiscountReason', 'channelCode', 'lines', 'paymentCode', 'promoCode', 'saleDate', 'saleTime', 'skipPromotionIds'])
  })
  it('promoCode goes to the engine in normPromoCode form (blank = none)', () => {
    expect(toOrderDraft(cart([line()], { promoCode: '  ab1 ' }), CAT, FRI_1030).promoCode).toBe('AB1')
    expect(toOrderDraft(cart([line()], { promoCode: 'ชา' }), CAT, FRI_1030).promoCode).toBe('ชา')
    expect(toOrderDraft(cart([line()], { promoCode: '   ' }), CAT, FRI_1030).promoCode).toBeNull()
  })
  it('the tablet never sends exhaustedPromotions (it cannot count uses offline — ADR-0072 rule 2)', () => {
    const d = toOrderDraft(cart([line()], { manualPromotionIds: [PROMO.M_5] }), CAT, FRI_1030)
    expect('exhaustedPromotions' in d).toBe(false)
  })
})

describe('the reason of a manual promotion (ADR-0070 rule 4 · owner Q2 = ก)', () => {
  it('a manual promotion that brings the bill to ฿0 without a reason: ok=false and the flag', () => {
    const p = priceCart(cart([matcha()], { manualPromotionIds: [PROMO.M_FREE] }), CAT, FRI_1030)
    expect([p.ok, p.manualPromotionReasonRequired, p.totalSatang]).toEqual([false, true, 0])
  })
  it('with a reason: ok=true, the flag still up (it is a pure condition, like dayo)', () => {
    const p = priceCart(cart([matcha()], { manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: 'ชงผิดสูตร ทำแก้วใหม่ให้ลูกค้า' }), CAT, FRI_1030)
    expect([p.ok, p.manualPromotionReasonRequired, p.totalSatang, p.discountSatang]).toEqual([true, true, 0, 8_500])
    expect(p.draft.manualPromotionReason).toBe('ชงผิดสูตร ทำแก้วใหม่ให้ลูกค้า')
  })
  it('a bill above ฿0 never raises the flag', () => {
    expect(priceCart(cart([line()], { manualPromotionIds: [PROMO.M_5] }), CAT, FRI_1030).manualPromotionReasonRequired).toBe(false)
  })
  it.each([
    ['blank', ''],
    ['whitespace only (dayo trims it to nothing)', ' 　'],
    ['not trimmed with trimWs', ' ชงผิด'],
    ['a zero-width character', 'ชง​ผิด'],
    ['two lines', 'ชงผิด\nทำใหม่'],
    ['201 characters', 'ก'.repeat(201)],
  ])('a reason dayo refuses is BAD_MANUAL_PROMOTION before pricing: %s', (_why, reason) => {
    REFUSE(() => priceCart(cart([matcha()], { manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: reason }), CAT, FRI_1030), 'BAD_MANUAL_PROMOTION')
  })
  it('200 characters is fine', () => {
    expect(priceCart(cart([matcha()], { manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: 'ก'.repeat(200) }), CAT, FRI_1030).ok).toBe(true)
  })
})

describe('pricedFromQuote: the new money of the engine in satang (the one baht→satang point)', () => {
  const withTarget = (c: PosOrderCatalog): PosOrderCatalog => {
    const x = structuredClone(c)
    const m5 = x.promotions.find((p) => p.id === PROMO.M_5)!
    m5.rule = { ...m5.rule!, target: {} } // −฿5 on any cup (stack group), so it stacks on the Matcha evening 10% (main)
    return x
  }
  it('a cup discounted by two promotions carries promoBreakdown in satang', () => {
    const c = withTarget(CAT)
    const p = priceCart(cart([matcha()], { manualPromotionIds: [PROMO.M_5] }), c, FRI_1800)
    expect(p.lines.map((l) => [l.unitPriceSatang, l.discountPerCupSatang, l.promoBreakdown])).toEqual([
      [8_500, 1_350, [{ promotionId: PROMO.MATCHA_EVENING, satang: 850 }, { promotionId: PROMO.M_5, satang: 500 }]],
    ])
    expect(p.promotionsApplied.map((a) => [a.promotionId, a.mode, a.discountSatang])).toEqual([[PROMO.MATCHA_EVENING, 'auto', 850], [PROMO.M_5, 'manual', 500]])
    expect(p.totalSatang).toBe(7_150)
  })
  it('mode comes from the catalog promotion (promoApplyMode), kind is the engine\'s template name', () => {
    const p = priceCart(cart([line({ qty: 3 })]), CAT, FRI_1030)
    expect(p.promotionsApplied).toEqual([
      { promotionId: PROMO.B2G1, code: null, name: 'ชาไทย ซื้อ 2 แถม 1', kind: 'buy_n_get_m', mode: 'auto', discountSatang: 3_500, usageLimitTotal: null, usageLimitPerDay: null },
    ])
    expect(p.lines.every((l) => l.promoBreakdown === null)).toBe(true)
  })
  it('carries the usage limits of the catalog promotion, for display only — auto and code ones too (gap G3)', () => {
    const sunday = '2026-09-27T05:00:00.000Z' // Sunday 12:00 Bangkok: the tiered promotion (limits 500 / 50 a day) runs all day
    const p = priceCart(cart([line({ qty: 2 })]), CAT, sunday)
    expect(p.promotionsApplied.map((a) => [a.promotionId, a.mode, a.usageLimitTotal, a.usageLimitPerDay])).toEqual([[PROMO.TIERED, 'auto', 500, 50]])
    const unlimited = priceCart(cart([line()], { manualPromotionIds: [PROMO.M_5] }), CAT, FRI_1030).promotionsApplied[0]!
    expect([unlimited.usageLimitTotal, unlimited.usageLimitPerDay]).toEqual([null, null])
  })
  it('converts synthetic engine output exactly and keeps the subtotal − discounts = total check', () => {
    const draft = toOrderDraft(cart([line()]), CAT, FRI_1030)
    const q: QuoteResult = {
      ok: true, warnings: [], manualPromotionReasonRequired: true,
      lines: [{
        lineNo: 1, menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1,
        unitPrice: 35, unitCost: 0, discountPerCup: 35, discountReason: null, promotionId: PROMO.B2G1, lineTotal: 0,
        promoBreakdown: [{ promotionId: PROMO.B2G1, amount: 12.34 }, { promotionId: PROMO.M_5, amount: 22.66 }],
      }],
      promotionsApplied: [{ promotionId: PROMO.M_5, code: null, name: 'x', kind: 'item_discount', discountAmount: 22.66 }],
      itemsSubtotal: 35, itemsDiscount: 35, billDiscountAmount: 0, totalAmount: 0, channelFeeAmount: 0, costTotal: 0, grossProfit: 0, gpPercent: null,
    }
    const p = pricedFromQuote(q, draft, FRI_1030, CAT)
    expect(p.lines[0]!.promoBreakdown).toEqual([{ promotionId: PROMO.B2G1, satang: 1_234 }, { promotionId: PROMO.M_5, satang: 2_266 }])
    expect([p.manualPromotionReasonRequired, p.promotionsApplied[0]!.mode, p.ok]).toEqual([true, 'manual', true])
    const skewed = pricedFromQuote({ ...q, totalAmount: 1 }, draft, FRI_1030, CAT)
    expect(skewed.ok).toBe(false)
    expect(skewed.warnings.at(-1)).toMatch(/^PRICED_TOTAL_MISMATCH/)
  })
  it('an applied promotion missing from the catalog is a bug, never a silent guess of its mode', () => {
    const draft = toOrderDraft(cart([line()]), CAT, FRI_1030)
    const q = computeOrder({ ...draft, manualPromotionIds: [PROMO.M_5] }, withZeroCosts(CAT))
    const without = { ...CAT, promotions: CAT.promotions.filter((x) => x.id !== PROMO.M_5) }
    expect(() => pricedFromQuote(q, draft, FRI_1030, without)).toThrow(/UNKNOWN_APPLIED_PROMOTION/)
  })
})
