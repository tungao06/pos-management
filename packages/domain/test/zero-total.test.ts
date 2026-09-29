import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CartError, priceCart, ZERO_TOTAL_PAYMENT_CODE, zeroBillNeedsReason, zeroTotalVerdict,
  type BillDiscountDraft, type CartDraft, type CartLineDraft, type PosOrderCatalog, type PricedCart,
} from '../src/price-cart.js'
import { PROMO, promoRulesCatalog } from './fixtures/promo-rules-catalog.js'

const FRI_1030 = '2026-09-25T03:30:00.000Z' // Friday 10:30 Bangkok
const REASON = 'ชงผิดสูตร ทำแก้วใหม่ให้ลูกค้า'
/** The promo-rules catalog plus a ฿0 menu ("Water"): a ฿0 bill that no promotion made (review M1). */
const CAT: PosOrderCatalog = (() => {
  const x = promoRulesCatalog()
  const tt = x.variants.find((v) => v.menuCode === 'Thai Tea')!
  x.variants.push({ ...structuredClone(tt), menuCode: 'Water', menuNameTh: 'น้ำเปล่า', price: 0 })
  return x
})()
const line = (over: Partial<CartLineDraft> = {}): CartLineDraft => ({ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null, ...over })
const matcha = (over: Partial<CartLineDraft> = {}): CartLineDraft => line({ code: 'Matcha Latte', grade: 'Excellent', ...over })
const water = (over: Partial<CartLineDraft> = {}): CartLineDraft => line({ code: 'Water', ...over })
const cart = (lines: CartLineDraft[], over: Partial<CartDraft> = {}): CartDraft => ({
  channelCode: 'store', paymentCode: 'cash', lines, billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false,
  manualPromotionIds: [], manualPromotionReason: null, ...over,
})
const priced = (c: CartDraft, catalog: PosOrderCatalog = CAT, at = FRI_1030): PricedCart => priceCart(c, catalog, at)
const verdict = (c: CartDraft, catalog: PosOrderCatalog = CAT): ReturnType<typeof zeroTotalVerdict> => zeroTotalVerdict(c, priced(c, catalog))
/** M_FREE (100% any cup) made automatic: a ฿0 bill from a promotion nobody picked. */
const autoFree = (): PosOrderCatalog => {
  const x = structuredClone(CAT)
  const p = x.promotions.find((q) => q.id === PROMO.M_FREE)!
  p.applyMode = 'auto'
  p.autoApply = true
  return x
}

describe('zeroTotalVerdict — D124 / owner Q1 = (ข): ฿0 only from promotions, only in cash', () => {
  it('a bill above ฿0 is always ok, whatever the payment', () => {
    expect(verdict(cart([line()]))).toBe('ok')
    expect(verdict(cart([line()], { paymentCode: 'qr' }))).toBe('ok')
    expect(verdict(cart([line()], { billDiscount: { kind: 'satang', satang: 100, reason: null } }))).toBe('ok')
  })
  it('฿0 from a manual promotion with its reason, in cash: ok', () => {
    expect(verdict(cart([matcha()], { manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: REASON }))).toBe('ok')
  })
  it('฿0 from a manual promotion without a reason: MANUAL_REASON_REQUIRED', () => {
    expect(verdict(cart([matcha()], { manualPromotionIds: [PROMO.M_FREE] }))).toBe('MANUAL_REASON_REQUIRED')
  })
  it('฿0 from an automatic promotion: ok, no reason asked', () => {
    const c = cart([matcha()])
    const p = priced(c, autoFree())
    expect([p.totalSatang, p.manualPromotionReasonRequired, zeroTotalVerdict(c, p)]).toEqual([0, false, 'ok'])
  })
  it(`a ฿0 bill paid other than ${ZERO_TOTAL_PAYMENT_CODE} is ZERO_TOTAL_CASH_ONLY (D124: cash only)`, () => {
    expect(ZERO_TOTAL_PAYMENT_CODE).toBe('cash')
    expect(verdict(cart([matcha()], { paymentCode: 'qr', manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: REASON }))).toBe('ZERO_TOTAL_CASH_ONLY')
    expect(verdict(cart([matcha()], { paymentCode: 'qr' }), autoFree())).toBe('ZERO_TOTAL_CASH_ONLY')
  })
  it.each<[string, CartDraft]>([
    ['a ฿0 menu alone', cart([water()])],
    ['a ฿0 menu, no promotions, paid by QR (review M1 probe)', cart([water()], { noPromotions: true, paymentCode: 'qr' })],
    ['a ฿0 menu with a manual promotion picked (it discounts nothing), reason given', cart([water()], { manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: REASON })],
    ['two ฿0 cups', cart([water({ qty: 2 })])],
  ])('a ฿0 bill no promotion discounted is ZERO_TOTAL_NOT_ALLOWED: %s', (_why, c) => {
    const p = priced(c)
    expect([p.ok, p.totalSatang]).toEqual([true, 0])
    expect(zeroTotalVerdict(c, p)).toBe('ZERO_TOTAL_NOT_ALLOWED')
  })
  it('a ฿0 menu next to a cup a promotion made free: ok (the zero came from the promotion)', () => {
    expect(verdict(cart([water(), matcha()], { manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: REASON }))).toBe('ok')
  })
  it.each<[string, CartDraft]>([
    ['a free cup', cart([line({ free: true, discountReason: 'ลูกค้าประจำ' })])],
    ['a line discount of the full price', cart([line({ discountSatang: 3_500, discountReason: 'ลูกค้าประจำ' })])],
    ['a line discount of 100%', cart([line({ discountPercent: 100, discountReason: 'ลูกค้าประจำ' })])],
    ['a bill discount of the full amount', cart([line()], { billDiscount: { kind: 'satang', satang: 3_500, reason: 'ลูกค้าประจำ' } })],
    ['a bill discount of 100%', cart([line()], { billDiscount: { kind: 'percent', percent: 100, reason: 'ลูกค้าประจำ' } })],
    ['a free cup next to a manual promotion with its reason', cart([line({ free: true, discountReason: 'ลูกค้าประจำ' }), matcha()], { manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: REASON })],
  ])('฿0 with a typed discount anywhere is ZERO_TOTAL_NOT_ALLOWED: %s', (_why, c) => {
    const p = priced(c)
    expect([p.ok, p.totalSatang]).toEqual([true, 0])
    expect(zeroTotalVerdict(c, p)).toBe('ZERO_TOTAL_NOT_ALLOWED')
  })
  it('a typed discount counts whatever its amount — the rule reads the cart, not the money (฿0 / 0% typed included)', () => {
    const zero = cart([matcha()], { manualPromotionIds: [PROMO.M_FREE], manualPromotionReason: REASON })
    const p = priced(zero)
    expect([p.totalSatang, zeroTotalVerdict(zero, p)]).toEqual([0, 'ok'])
    // a typed ฿0 line is a manual cup the engine gives no promotion, so no real bill reaches ฿0 with one — the rule alone:
    expect(zeroTotalVerdict({ ...zero, lines: [...zero.lines, line({ discountSatang: 0 })] }, p)).toBe('ZERO_TOTAL_NOT_ALLOWED')
    expect(zeroTotalVerdict({ ...zero, lines: [...zero.lines, line({ discountPercent: 0 })] }, p)).toBe('ZERO_TOTAL_NOT_ALLOWED')
  })
  it('order: ZERO_TOTAL_NOT_ALLOWED, then MANUAL_REASON_REQUIRED, then ZERO_TOTAL_CASH_ONLY', () => {
    expect(verdict(cart([line({ free: true, discountReason: 'ลูกค้าประจำ' }), matcha()], { manualPromotionIds: [PROMO.M_FREE], paymentCode: 'qr' }))).toBe('ZERO_TOTAL_NOT_ALLOWED')
    expect(verdict(cart([matcha()], { manualPromotionIds: [PROMO.M_FREE], paymentCode: 'qr' }))).toBe('MANUAL_REASON_REQUIRED')
  })
})

describe('zeroBillNeedsReason — PROVISIONAL review L1 (option ก, pending the owner)', () => {
  it('the engine flag asks for a reason', () => {
    const c = cart([matcha()], { manualPromotionIds: [PROMO.M_FREE] })
    const p = priced(c)
    expect([p.manualPromotionReasonRequired, zeroBillNeedsReason(c, p)]).toEqual([true, true])
  })
  it('฿0 with a manual promotion sent asks for a reason even when here it discounted nothing (dayo may quote it otherwise)', () => {
    // Here the AUTO promotion makes the matcha free and the picked M_5 gives nothing. dayo re-quotes with its own use
    // counts: if the auto one is exhausted there, a manual promotion may be what discounts, and dayo then rejects the
    // ฿0 row `reason_required:` (0069:406-414 reads the POS total and its own quote). So the tablet asks first.
    const c = cart([matcha()], { manualPromotionIds: [PROMO.M_5] })
    const p = priced(c, autoFree())
    expect([p.totalSatang, p.manualPromotionReasonRequired, zeroBillNeedsReason(c, p), zeroTotalVerdict(c, p)]).toEqual([0, false, true, 'MANUAL_REASON_REQUIRED'])
    const withReason = { ...c, manualPromotionReason: REASON }
    expect(zeroTotalVerdict(withReason, priced(withReason, autoFree()))).toBe('ok')
  })
  it('no reason is asked above ฿0, with no manual promotion sent, or when noPromotions drops them', () => {
    const above = cart([line()], { manualPromotionIds: [PROMO.M_5] })
    expect(zeroBillNeedsReason(above, priced(above))).toBe(false)
    const auto = cart([matcha()])
    expect(zeroBillNeedsReason(auto, priced(auto, autoFree()))).toBe(false)
    const dropped = cart([water()], { noPromotions: true, manualPromotionIds: [PROMO.M_FREE] })
    expect(zeroBillNeedsReason(dropped, priced(dropped))).toBe(false)
  })
})

describe('properties over random carts (fast-check) — consequences of D124, not the formula', () => {
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
  const catArb = fc.constantFrom(CAT, autoFree())
  const cartArb = fc.record({
    rows: fc.array(fc.record({ v: fc.integer({ min: 0, max: variants.length - 1 }), qty: fc.integer({ min: 1, max: 4 }), typed: typedArb }), { minLength: 1, maxLength: 4 }),
    picked: fc.subarray(manualIds), withReason: fc.boolean(), bill: billArb, noPromotions: fc.boolean(), payment: fc.constantFrom('cash', 'qr'),
  }).map(({ rows, picked, withReason, bill, noPromotions, payment }) => cart(
    rows.map((r) => { const v = variants[r.v]!; return line({ code: v.menuCode, size: v.size, sweetness: v.sweetness, grade: v.isMatcha ? 'Excellent' : null, qty: r.qty, ...r.typed }) }),
    { manualPromotionIds: picked, manualPromotionReason: withReason ? REASON : null, billDiscount: bill, noPromotions, paymentCode: payment },
  ))
  const tryPrice = (c: CartDraft, catalog: PosOrderCatalog, at: string): PricedCart | null => {
    try { return priceCart(c, catalog, at) } catch (e) { if (e instanceof CartError) return null; throw e }
  }

  it('money is whole satang ≥ 0 · discount ≤ subtotal · subtotal − discount = total · every sellable ฿0 bill is a promotion bill paid in cash', () => {
    const seen = { zeroOk: 0, zeroRefused: 0, water: 0, reasonRequired: 0 }
    fc.assert(fc.property(cartArb, catArb, whenArb, (c, catalog, when) => {
      const p = tryPrice(c, catalog, when)
      if (p === null) return
      const money = [p.itemsSubtotalSatang, p.itemsDiscountSatang, p.billDiscountSatang, p.discountSatang, p.totalSatang, p.channelFeeSatang,
        ...p.lines.flatMap((l) => [l.unitPriceSatang, l.discountPerCupSatang, l.lineTotalSatang, ...(l.promoBreakdown ?? []).map((b) => b.satang)]),
        ...p.promotionsApplied.map((a) => a.discountSatang)]
      for (const m of money) expect(Number.isSafeInteger(m) && m >= 0, `money ${m}`).toBe(true)
      if (p.ok) {
        expect(p.discountSatang).toBeLessThanOrEqual(p.itemsSubtotalSatang)
        expect(p.itemsSubtotalSatang - p.discountSatang).toBe(p.totalSatang)
      }
      const v = zeroTotalVerdict(c, p)
      if (c.lines.some((l) => l.code === 'Water')) seen.water++
      if (p.totalSatang > 0) { expect(v).toBe('ok'); return }
      if (v === 'MANUAL_REASON_REQUIRED') seen.reasonRequired++
      if (v !== 'ok') { seen.zeroRefused++; return }
      seen.zeroOk++
      // a ฿0 bill the tablet may sell: paid in cash, nothing typed, and every satang of the subtotal went to promotions
      expect(c.paymentCode).toBe('cash')
      expect(c.billDiscount).toBeNull()
      expect(c.lines.every((l) => !l.free && l.discountSatang === null && l.discountPercent === null)).toBe(true)
      expect(p.promotionsApplied.reduce((a, x) => a + x.discountSatang, 0)).toBeGreaterThan(0)
      if (p.ok) expect(p.promotionsApplied.reduce((a, x) => a + x.discountSatang, 0)).toBe(p.itemsSubtotalSatang)
    }), { numRuns: 800 })
    expect(seen.zeroOk).toBeGreaterThan(0)
    expect(seen.zeroRefused).toBeGreaterThan(0)
    expect(seen.reasonRequired).toBeGreaterThan(0)
    expect(seen.water).toBeGreaterThan(0)
  })
  it('a bill made only of ฿0 menus is never sellable, whatever the promotions, reason or payment', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 5 }), fc.subarray(manualIds), fc.boolean(), fc.boolean(), fc.constantFrom('cash', 'qr'), catArb, whenArb,
      (qty, picked, withReason, noPromotions, payment, catalog, when) => {
        const c = cart([water({ qty })], { manualPromotionIds: picked, manualPromotionReason: withReason ? REASON : null, noPromotions, paymentCode: payment })
        expect(zeroTotalVerdict(c, priceCart(c, catalog, when))).toBe('ZERO_TOTAL_NOT_ALLOWED')
      }), { numRuns: 200 })
  })
  it('payment and reason only ever move the verdict the way D124 says (metamorphic)', () => {
    fc.assert(fc.property(cartArb, catArb, whenArb, (c, catalog, when) => {
      const p = tryPrice(c, catalog, when)
      if (p === null || p.totalSatang > 0) return
      const v = zeroTotalVerdict(c, p)
      // paying the same ฿0 bill by QR is never sellable
      const qr = { ...c, paymentCode: 'qr' }
      expect(zeroTotalVerdict(qr, p)).not.toBe('ok')
      // giving a reason never makes a sellable bill unsellable, and always settles MANUAL_REASON_REQUIRED
      const reasoned = { ...c, manualPromotionReason: REASON }
      const pr = tryPrice(reasoned, catalog, when)
      if (pr === null) return
      const vr = zeroTotalVerdict(reasoned, pr)
      if (v === 'ok') expect(vr).toBe('ok')
      expect(vr).not.toBe('MANUAL_REASON_REQUIRED')
    }), { numRuns: 800 })
  })
  it('an unreasoned ฿0 manual bill is ok=false with the flag, and its verdict is MANUAL_REASON_REQUIRED — whatever the cups', () => {
    const drinks = variants.filter((v) => v.price > 0)
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: drinks.length - 1 }), { minLength: 1, maxLength: 2 }), (vs) => {
      const c = cart(vs.map((i) => { const v = drinks[i]!; return line({ code: v.menuCode, size: v.size, sweetness: v.sweetness, grade: v.isMatcha ? 'Excellent' : null }) }), { manualPromotionIds: [PROMO.M_FREE] })
      const p = priceCart(c, CAT, FRI_1030)
      expect([p.totalSatang, p.ok, p.manualPromotionReasonRequired, zeroTotalVerdict(c, p)]).toEqual([0, false, true, 'MANUAL_REASON_REQUIRED'])
    }), { numRuns: 100 })
  })
})
