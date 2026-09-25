import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { computeOrder } from '@dayo/dayo-pricing'
import { PosOrderCatalog as PosOrderCatalogSchema } from '@dayo/contracts'
import { edgeBahtToSatang } from '../src/money-edge.js'
import { CartError, centralDiffSatang, lineOptions, priceCart, sumSatang, toOrderDraft, withZeroCosts, type CartDraft, type CartLineDraft } from '../src/price-cart.js'
import { POS_CATALOG } from './fixtures/pos-catalog.js'

const line = (over: Partial<CartLineDraft> = {}): CartLineDraft => ({ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null, ...over })
const cart = (lines: CartLineDraft[], over: Partial<CartDraft> = {}): CartDraft => ({ channelCode: 'store', paymentCode: 'cash', lines, billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, ...over })
const FRI_1030 = '2026-09-25T03:30:00.000Z' // Friday 10:30 Bangkok

it('the contracts schema refuses a catalog missing a field the pricing code reads (why toPricingCatalog may cast)', () => {
  const broken = structuredClone(POS_CATALOG) as unknown as { promotions: { params: Record<string, unknown> }[] }
  delete broken.promotions[0]!.params['buy_qty']
  expect(PosOrderCatalogSchema.safeParse(broken).success).toBe(false)
})

describe('toOrderDraft', () => {
  it('sale_time is the Bangkok HH:MM with seconds cut, not rounded (spec §4.5)', () => {
    expect(toOrderDraft(cart([line()]), POS_CATALOG, '2026-09-25T07:00:59.999Z').saleTime).toBe('14:00')
  })
  it('sale_date is the Thai calendar date of sold_at', () => {
    expect(toOrderDraft(cart([line()]), POS_CATALOG, '2026-09-24T17:30:00.000Z').saleDate).toBe('2026-09-25')
  })
  it('no_promotions skips every promotion of the catalog (same result as SQL no_promotions — spec §4.5)', () => {
    expect(toOrderDraft(cart([line()], { noPromotions: true }), POS_CATALOG, FRI_1030).skipPromotionIds).toEqual(POS_CATALOG.promotions.map((p) => p.id))
  })
  it('money inputs cross the edge in baht', () => {
    const d = toOrderDraft(cart([line({ discountSatang: 525 })], { billDiscount: { kind: 'satang', satang: 1000, reason: 'ลูกค้าประจำ' } }), POS_CATALOG, FRI_1030)
    expect(d.lines[0]!.discountBaht).toBe(5.25)
    expect(d.billDiscountBaht).toBe(10)
    expect(d.billDiscountPercent).toBeNull()
  })
})

describe('priceCart', () => {
  it('Thai Tea ×3 with "buy 2 get 1": 105.00 − 35.00 = 70.00', () => {
    const p = priceCart(cart([line({ qty: 3 })]), POS_CATALOG, FRI_1030)
    expect(p.ok).toBe(true)
    expect([p.itemsSubtotalSatang, p.itemsDiscountSatang, p.discountSatang, p.totalSatang]).toEqual([10500, 3500, 3500, 7000])
    expect(p.promotionsApplied.map((x) => x.discountSatang)).toEqual([3500])
  })
  it('sumSatang / centralDiffSatang keep money math in the domain', () => {
    expect(sumSatang([9000, 5000])).toBe(14_000)
    expect(() => sumSatang([1.5])).toThrow(RangeError)
    expect(centralDiffSatang(15_501, 15_500)).toBe(1)
    expect(centralDiffSatang(null, 15_500)).toBeNull()
  })
  it('every money field equals edgeBahtToSatang of the vendored computeOrder (random carts)', () => {
    const variants = POS_CATALOG.variants.filter((v) => !v.isMatcha)
    fc.assert(fc.property(
      fc.array(fc.record({ v: fc.integer({ min: 0, max: variants.length - 1 }), qty: fc.integer({ min: 1, max: 5 }), pct: fc.option(fc.integer({ min: 1, max: 50 }), { nil: null }) }), { minLength: 1, maxLength: 6 }),
      fc.constantFrom('store', 'grab', 'lineman'),
      (rows, channelCode) => {
        const c = cart(rows.map((r) => { const v = variants[r.v]!; return line({ code: v.menuCode, size: v.size, sweetness: v.sweetness, qty: r.qty, discountPercent: r.pct }) }), { channelCode })
        const p = priceCart(c, POS_CATALOG, FRI_1030)
        const q = computeOrder(toOrderDraft(c, POS_CATALOG, FRI_1030), withZeroCosts(POS_CATALOG))
        expect(p.totalSatang).toBe(edgeBahtToSatang(q.totalAmount))
        expect(p.itemsSubtotalSatang).toBe(edgeBahtToSatang(q.itemsSubtotal))
        expect(p.itemsDiscountSatang).toBe(edgeBahtToSatang(q.itemsDiscount))
        expect(p.billDiscountSatang).toBe(edgeBahtToSatang(q.billDiscountAmount))
        expect(p.channelFeeSatang).toBe(edgeBahtToSatang(q.channelFeeAmount))
        expect(p.lines.map((l) => l.lineTotalSatang)).toEqual(q.lines.map((l) => edgeBahtToSatang(l.lineTotal)))
      },
    ), { numRuns: 300 })
  })
  it.each<[string, CartDraft, CartError['code']]>([
    ['empty', cart([]), 'EMPTY_CART'],
    ['qty 0', cart([line({ qty: 0 })]), 'QTY_OUT_OF_RANGE'],
    ['qty above maxQtyPerLine (99)', cart([line({ qty: 100 })]), 'QTY_OUT_OF_RANGE'],
    ['unknown variant', cart([line({ code: 'Nope' })]), 'UNKNOWN_VARIANT'],
    ['matcha without a grade', cart([line({ code: 'Matcha Latte', grade: null })]), 'GRADE_RULE'],
    ['grade on a non-matcha menu', cart([line({ grade: 'Excellent' })]), 'GRADE_RULE'],
    ['line baht and percent together', cart([line({ discountSatang: 100, discountPercent: 10 })]), 'BAD_DISCOUNT'],
    ['51 lines', cart(Array.from({ length: 51 }, () => line())), 'CART_TOO_LARGE'],
  ])('%s → CartError %s', (_, c, code) => {
    try { priceCart(c, POS_CATALOG, FRI_1030); expect.unreachable() } catch (e) { expect(e).toBeInstanceOf(CartError); expect((e as CartError).code).toBe(code) }
  })
  it('oat on a menu without fresh milk in its recipe is not ok (spec §5.3 case 6)', () => {
    expect(priceCart(cart([line({ code: 'Cocoa', sweetness: '50%', milk: 'oat' })]), POS_CATALOG, FRI_1030).ok).toBe(false)
  })
})

describe('lineOptions', () => {
  it('offers oat only where the recipe has fresh milk and the menu allows it', () => {
    expect(lineOptions(POS_CATALOG, 'Thai Tea', '16 oz', '50%').milk.map((m) => m.code)).toEqual(['fresh', 'oat'])
    expect(lineOptions(POS_CATALOG, 'Cocoa', '16 oz', '50%').milk.map((m) => m.code)).toEqual(['fresh'])
    expect(lineOptions(POS_CATALOG, 'Pink Milk', '16 oz', '100%').milk.map((m) => m.code)).toEqual(['fresh'])
  })
  it('matcha lists its grades and picks the default', () => {
    const o = lineOptions(POS_CATALOG, 'Matcha Latte', '16 oz', '50%')
    expect(o.grades.map((g) => [g.code, g.priceAddSatang])).toEqual([['Excellent', 0], ['Premium', 2000]])
    expect(o.defaultGrade).toBe('Excellent')
  })
})
