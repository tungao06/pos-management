import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CartError, priceCart, zeroTotalVerdict, type BillDiscountDraft, type CartDraft, type CartLineDraft, type PosOrderCatalog } from '../src/price-cart.js'
import { PROMO, promoRulesCatalog } from './fixtures/promo-rules-catalog.js'

const CAT = promoRulesCatalog()
const FRI_1030 = '2026-09-25T03:30:00.000Z' // Friday 10:30 Bangkok
const REASON = 'ชงผิดสูตร ทำแก้วใหม่ให้ลูกค้า'
const line = (over: Partial<CartLineDraft> = {}): CartLineDraft => ({ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null, ...over })
const matcha = (over: Partial<CartLineDraft> = {}): CartLineDraft => line({ code: 'Matcha Latte', grade: 'Excellent', ...over })
const cart = (lines: CartLineDraft[], over: Partial<CartDraft> = {}): CartDraft => ({
  channelCode: 'store', paymentCode: 'cash', lines, billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false,
  manualPromotionIds: [], manualPromotionReason: null, ...over,
})
const verdict = (c: CartDraft, catalog: PosOrderCatalog = CAT): ReturnType<typeof zeroTotalVerdict> => zeroTotalVerdict(c, priceCart(c, catalog, FRI_1030))
/** M_FREE made automatic: a ฿0 bill from a promotion nobody picked. */
const autoFree = (): PosOrderCatalog => {
  const x = structuredClone(CAT)
  const p = x.promotions.find((q) => q.id === PROMO.M_FREE)!
  p.applyMode = 'auto'
  p.autoApply = true
  return x
}

describe('zeroTotalVerdict — owner Q1 = (ข): ฿0 only from promotions, never from a typed discount', () => {
  it('a bill above ฿0 is always ok', () => {
    expect(verdict(cart([line()]))).toBe('ok')
    expect(verdict(cart([line()], { billDiscount: { kind: 'satang', satang: 100, reason: null } }))).toBe('ok')
  })
  it('฿0 from a manual promotion with its reason: ok', () => {
    expect(verdict(cart([matcha()], { manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: REASON }))).toBe('ok')
  })
  it('฿0 from a manual promotion without a reason: MANUAL_REASON_REQUIRED', () => {
    expect(verdict(cart([matcha()], { manualPromotionIds: [PROMO.M_FREE] }))).toBe('MANUAL_REASON_REQUIRED')
  })
  it('฿0 from an automatic promotion: ok, no reason asked (dayo flags manual promotions only)', () => {
    const c = cart([matcha()])
    const p = priceCart(c, autoFree(), FRI_1030)
    expect([p.totalSatang, p.manualPromotionReasonRequired, zeroTotalVerdict(c, p)]).toEqual([0, false, 'ok'])
  })
  it.each<[string, CartDraft]>([
    ['a free cup', cart([line({ free: true, discountReason: 'ลูกค้าประจำ' })])],
    ['a line discount of the full price', cart([line({ discountSatang: 3_500, discountReason: 'ลูกค้าประจำ' })])],
    ['a line discount of 100%', cart([line({ discountPercent: 100, discountReason: 'ลูกค้าประจำ' })])],
    ['a bill discount of the full amount', cart([line()], { billDiscount: { kind: 'satang', satang: 3_500, reason: 'ลูกค้าประจำ' } })],
    ['a bill discount of 100%', cart([line()], { billDiscount: { kind: 'percent', percent: 100, reason: 'ลูกค้าประจำ' } })],
    ['a free cup next to a manual promotion with its reason', cart([line({ free: true, discountReason: 'ลูกค้าประจำ' }), matcha()], { manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: REASON })],
  ])('฿0 with a typed discount anywhere is ZERO_TOTAL_NOT_ALLOWED: %s', (_why, c) => {
    const p = priceCart(c, CAT, FRI_1030)
    expect([p.ok, p.totalSatang]).toEqual([true, 0])
    expect(zeroTotalVerdict(c, p)).toBe('ZERO_TOTAL_NOT_ALLOWED')
  })
  it('a typed discount counts whatever its amount — the rule reads the cart, not the money (฿0 / 0% typed included)', () => {
    const zero = cart([matcha()], { manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: REASON })
    const p = priceCart(zero, CAT, FRI_1030)
    expect([p.totalSatang, zeroTotalVerdict(zero, p)]).toEqual([0, 'ok'])
    // a typed ฿0 line is a manual cup the engine gives no promotion, so no real bill reaches ฿0 with one — the rule alone:
    expect(zeroTotalVerdict({ ...zero, lines: [...zero.lines, line({ discountSatang: 0 })] }, p)).toBe('ZERO_TOTAL_NOT_ALLOWED')
    expect(zeroTotalVerdict({ ...zero, lines: [...zero.lines, line({ discountPercent: 0 })] }, p)).toBe('ZERO_TOTAL_NOT_ALLOWED')
  })
  it('ZERO_TOTAL_NOT_ALLOWED wins over MANUAL_REASON_REQUIRED (a reason would not make the bill sellable)', () => {
    expect(verdict(cart([line({ free: true, discountReason: 'ลูกค้าประจำ' }), matcha()], { manualPromotionIds: [PROMO.M_FREE] }))).toBe('ZERO_TOTAL_NOT_ALLOWED')
  })
})

describe('properties over random carts of the promo-rules catalog (fast-check)', () => {
  const variants = CAT.variants
  const manualIds = [PROMO.M_FREE, PROMO.M_5]
  const typedArb = fc.oneof(
    { weight: 6, arbitrary: fc.constant({}) },
    { weight: 1, arbitrary: fc.constant({ free: true, discountReason: 'ลูกค้าประจำ' }) },
    { weight: 1, arbitrary: fc.integer({ min: 0, max: 10_000 }).map((s) => ({ discountSatang: s, discountReason: 'ลูกค้าประจำ' })) },
    { weight: 1, arbitrary: fc.integer({ min: 0, max: 100 }).map((pc) => ({ discountPercent: pc, discountReason: 'ลูกค้าประจำ' })) },
  )
  const billArb: fc.Arbitrary<BillDiscountDraft | null> = fc.oneof(
    { weight: 6, arbitrary: fc.constant(null) },
    { weight: 1, arbitrary: fc.integer({ min: 1, max: 20_000 }).map((satang) => ({ kind: 'satang' as const, satang, reason: 'ลูกค้าประจำ' })) },
    { weight: 1, arbitrary: fc.integer({ min: 1, max: 100 }).map((percent) => ({ kind: 'percent' as const, percent, reason: 'ลูกค้าประจำ' })) },
  )
  const whenArb = fc.constantFrom(FRI_1030, '2026-09-25T11:00:00.000Z', '2026-09-27T05:00:00.000Z', '2026-09-25T15:30:00.000Z') // Fri 10:30 · Fri 18:00 · Sun 12:00 · Fri 22:30
  it('money is whole satang ≥ 0 · discount ≤ subtotal · subtotal − discount = total · the verdict follows Q1', () => {
    const seen = { zeroOk: 0, zeroTyped: 0, reasonRequired: 0, manualUsed: 0 }
    fc.assert(fc.property(
      fc.array(fc.record({ v: fc.integer({ min: 0, max: variants.length - 1 }), qty: fc.integer({ min: 1, max: 4 }), typed: typedArb }), { minLength: 1, maxLength: 4 }),
      fc.subarray(manualIds), fc.boolean(), billArb, fc.boolean(), whenArb,
      (rows, picked, withReason, bill, noPromotions, when) => {
        const lines = rows.map((r) => {
          const v = variants[r.v]!
          return line({ code: v.menuCode, size: v.size, sweetness: v.sweetness, grade: v.isMatcha ? 'Excellent' : null, qty: r.qty, ...r.typed })
        })
        const c = cart(lines, { manualPromotionIds: picked, manualPromotionReason: withReason ? REASON : null, billDiscount: bill, noPromotions })
        let p
        try { p = priceCart(c, CAT, when) } catch (e) { if (e instanceof CartError) return; throw e }
        const money = [p.itemsSubtotalSatang, p.itemsDiscountSatang, p.billDiscountSatang, p.discountSatang, p.totalSatang, p.channelFeeSatang,
          ...p.lines.flatMap((l) => [l.unitPriceSatang, l.discountPerCupSatang, l.lineTotalSatang, ...(l.promoBreakdown ?? []).map((b) => b.satang)]),
          ...p.promotionsApplied.map((a) => a.discountSatang)]
        for (const m of money) expect(Number.isSafeInteger(m) && m >= 0, `money ${m}`).toBe(true)
        if (p.ok) {
          expect(p.discountSatang).toBeLessThanOrEqual(p.itemsSubtotalSatang)
          expect(p.itemsSubtotalSatang - p.discountSatang).toBe(p.totalSatang)
        }
        const typed = bill !== null || lines.some((l) => l.free || l.discountSatang !== null || l.discountPercent !== null)
        const reasonSent = withReason && !noPromotions && picked.length > 0
        const v = zeroTotalVerdict(c, p)
        if (p.promotionsApplied.some((a) => a.mode === 'manual' && a.discountSatang > 0)) seen.manualUsed++
        if (p.totalSatang > 0) { expect(v).toBe('ok'); return }
        if (typed) { expect(v).toBe('ZERO_TOTAL_NOT_ALLOWED'); seen.zeroTyped++; return }
        const expected = p.manualPromotionReasonRequired && !reasonSent ? 'MANUAL_REASON_REQUIRED' : 'ok'
        expect(v).toBe(expected)
        // dayo's own rule, seen from the tablet: the flag without a reason is exactly the ฿0 bill the engine refuses
        if (expected === 'MANUAL_REASON_REQUIRED') { expect(p.ok).toBe(false); seen.reasonRequired++ } else if (p.ok) seen.zeroOk++
      },
    ), { numRuns: 800 })
    expect(seen.zeroOk).toBeGreaterThan(0)
    expect(seen.zeroTyped).toBeGreaterThan(0)
    expect(seen.reasonRequired).toBeGreaterThan(0)
    expect(seen.manualUsed).toBeGreaterThan(0)
  })
  it('an unreasoned ฿0 manual bill is ok=false with the flag, and its verdict is MANUAL_REASON_REQUIRED — whatever the cups', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: variants.length - 1 }), { minLength: 1, maxLength: 2 }), (vs) => {
      const c = cart(vs.map((i) => { const v = variants[i]!; return line({ code: v.menuCode, size: v.size, sweetness: v.sweetness, grade: v.isMatcha ? 'Excellent' : null }) }), { manualPromotionIds: [PROMO.M_FREE] })
      const p = priceCart(c, CAT, FRI_1030)
      expect([p.totalSatang, p.ok, p.manualPromotionReasonRequired, zeroTotalVerdict(c, p)]).toEqual([0, false, true, 'MANUAL_REASON_REQUIRED'])
    }), { numRuns: 100 })
  })
})
