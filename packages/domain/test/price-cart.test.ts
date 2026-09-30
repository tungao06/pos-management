import fc from 'fast-check'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { computeOrder, normPromoCode, type CupSizeEntry, type OrderCatalog, type OrderDraft } from '@dayo/dayo-pricing'
import { PosOrderCatalog as PosOrderCatalogSchema, type PosOrderCatalogParsed } from '@dayo/contracts'
import { loadRichCatalog } from '@dayo/contracts/fixture-files'
import { edgeBahtToSatang } from '../src/money-edge.js'
import {
  CartError, centralDiffSatang, lineOptions, priceCart, sumSatang, toOrderDraft, toPricingCatalog, withZeroCosts,
  type CartDraft, type CartLineDraft, type PosOrderCatalog, type PosVariant,
} from '../src/price-cart.js'
import { POS_CATALOG } from './fixtures/pos-catalog.js'

const line = (over: Partial<CartLineDraft> = {}): CartLineDraft => ({ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null, ...over })
const cart = (lines: CartLineDraft[], over: Partial<CartDraft> = {}): CartDraft => ({ channelCode: 'store', paymentCode: 'cash', lines, billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, manualPromotionIds: [], manualPromotionReason: null, ...over })
const FRI_1030 = '2026-09-25T03:30:00.000Z' // Friday 10:30 Bangkok
const REFUSE = (f: () => unknown, code: CartError['code']): void => {
  try { f(); expect.unreachable() } catch (e) { expect(e).toBeInstanceOf(CartError); expect((e as CartError).code).toBe(code) }
}

describe('toPricingCatalog (the E1 catalog as dayo\'s OrderCatalog)', () => {
  it('the parsed contract type satisfies the POS catalog type with no cast, sizes included', () => {
    // both promotion shapes (legacy kind + params, and rule-only) assign to f4cda56's Promotion with no cast (plan 10 T3)
    expectTypeOf<PosOrderCatalogParsed>().toExtend<PosOrderCatalog>()
    expectTypeOf<PosOrderCatalogParsed['promotions'][number]>().toExtend<OrderCatalog['promotions'][number]>()
    expectTypeOf<NonNullable<PosOrderCatalogParsed['promotionGroups']>[number]>().toExtend<NonNullable<OrderCatalog['promotionGroups']>[number]>()
    expectTypeOf<PosOrderCatalog>().toExtend<Omit<OrderCatalog, 'ingredients' | 'milkOptions' | 'gradeOptions'>>()
    // the only other widening: an option's ingredientId/multiplier may be null (dayo menu_options columns are nullable)
    expectTypeOf<PosOrderCatalog['milkOptions'][number]['ingredientId']>().toEqualTypeOf<string | null>()
    expectTypeOf<PosOrderCatalog['gradeOptions'][number]['multiplier']>().toEqualTypeOf<number | null>()
    expectTypeOf<PosOrderCatalog['sizes']>().toEqualTypeOf<CupSizeEntry[]>()
  })
  it('keeps every size, inactive ones too, exactly as E1 sent them', () => {
    expect(toPricingCatalog(loadRichCatalog().catalog).sizes).toEqual([
      { code: '16 oz', label: '16 oz', sortOrder: 0, isActive: true },
      { code: '20 oz', label: '20 oz', sortOrder: 1, isActive: true },
      { code: '22 oz', label: '22 oz', sortOrder: 2, isActive: false },
    ])
  })
  it('passes promotion times through unchanged — HH:MM:SS is never cut to HH:MM on the POS side', () => {
    expect(POS_CATALOG.promotions.filter((p) => p.timeFrom != null).map((p) => [p.timeFrom, p.timeTo])).toEqual([['14:00:00', '16:00:00']])
  })
  it('the contracts schema refuses a catalog missing a field the pricing code reads', () => {
    const broken = structuredClone(POS_CATALOG) as unknown as { promotions: { params: Record<string, unknown> }[] }
    delete broken.promotions[0]!.params['buy_qty']
    expect(PosOrderCatalogSchema.safeParse(broken).success).toBe(false)
  })
})

describe('sizes (ADR-0054): a line is priced only on an ACTIVE size of catalog.sizes that has the variant', () => {
  const tt16 = POS_CATALOG.variants.find((v) => v.menuCode === 'Thai Tea' && v.size === '16 oz' && v.sweetness === '50%')!
  const withSize = (size: string, entry: CupSizeEntry | null, variant: boolean): PosOrderCatalog => ({
    ...POS_CATALOG,
    sizes: entry === null ? POS_CATALOG.sizes : [...POS_CATALOG.sizes.filter((s) => s.code !== size), entry],
    variants: variant ? [...POS_CATALOG.variants, { ...tt16, size, price: 55 } satisfies PosVariant] : POS_CATALOG.variants,
  })
  it('an inactive size with no variant (22 oz of the test catalog) is refused before pricing', () => {
    REFUSE(() => priceCart(cart([line({ size: '22 oz' })]), POS_CATALOG, FRI_1030), 'UNKNOWN_VARIANT')
  })
  it('an inactive size is refused even when a variant for it is present', () => {
    const c = withSize('22 oz', null, true)
    REFUSE(() => priceCart(cart([line({ size: '22 oz' })]), c, FRI_1030), 'UNKNOWN_VARIANT')
    REFUSE(() => lineOptions(c, 'Thai Tea', '22 oz', '50%'), 'UNKNOWN_VARIANT')
  })
  it('a size missing from catalog.sizes is refused even when a variant for it is present', () => {
    const c = withSize('24 oz', null, true)
    REFUSE(() => priceCart(cart([line({ size: '24 oz' })]), c, FRI_1030), 'UNKNOWN_VARIANT')
    REFUSE(() => lineOptions(c, 'Thai Tea', '24 oz', '50%'), 'UNKNOWN_VARIANT')
  })
  it('an active size without a variant for this menu is refused', () => {
    const c = withSize('24 oz', { code: '24 oz', label: 'จัมโบ้', sortOrder: 3, isActive: true }, false)
    REFUSE(() => priceCart(cart([line({ size: '24 oz' })]), c, FRI_1030), 'UNKNOWN_VARIANT')
  })
  it('a new active size the shop added with its variant is priced like any other', () => {
    const c = withSize('24 oz', { code: '24 oz', label: 'จัมโบ้', sortOrder: 3, isActive: true }, true)
    const p = priceCart(cart([line({ size: '24 oz' })]), c, FRI_1030)
    expect([p.ok, p.lines[0]!.size, p.lines[0]!.unitPriceSatang, p.totalSatang]).toEqual([true, '24 oz', 5500, 5500])
  })
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
  /**
   * Random carts over every input a sale can carry — line baht/percent discounts, free cups (with and without the
   * reason dayo requires), oat on menus that allow it and on menus that do not, matcha grades, bill baht/percent
   * discounts, promo codes (right, wrong case, unknown), skipped promotions, "no promotions", both payment methods and
   * sale instants in and out of the weekday 14:00–16:00 matcha promotion. The expected numbers never come from the
   * code under test: the dayo draft is built here by hand from the generated inputs (satang / 100, Bangkok date and
   * time written out per instant) and priced by dayo's vendored computeOrder on a zero-cost copy of the catalog.
   */
  it('every money field equals the vendored computeOrder on a hand-built draft (random carts)', () => {
    const variants = POS_CATALOG.variants
    // oat where dayo's option rules allow it (spec §5.3 case 6) is the common case; 'oat-any' also sends oat where they do not
    const oatOk = variants.map((v) => lineOptions(POS_CATALOG, v.menuCode, v.size, v.sweetness).milk.some((m) => m.code === 'oat'))
    const grades = POS_CATALOG.gradeOptions.map((g) => g.code)
    const promotionIds = POS_CATALOG.promotions.map((p) => p.id)
    /** dayo's pricing code needs a cost per ingredient; the tablet has none (spec §4.4 rule 1) and cost never moves a price. */
    const dayoCatalog = { ...POS_CATALOG, ingredients: Object.fromEntries(Object.entries(POS_CATALOG.ingredients).map(([k, v]) => [k, { ...v, costPerUseUnit: 0 }])) } as unknown as OrderCatalog
    /** Sale instants with their Bangkok date and HH:MM written out by hand (UTC+7, no DST). */
    const instants = [
      { iso: FRI_1030, saleDate: '2026-09-25', saleTime: '10:30' },
      { iso: '2026-09-25T07:00:00.000Z', saleDate: '2026-09-25', saleTime: '14:00' }, // Friday, the matcha promotion opens
      { iso: '2026-09-25T08:15:42.000Z', saleDate: '2026-09-25', saleTime: '15:15' }, // Friday, inside it (seconds cut)
      { iso: '2026-09-25T09:00:00.000Z', saleDate: '2026-09-25', saleTime: '16:00' }, // Friday, its last minute
      { iso: '2026-09-26T08:00:00.000Z', saleDate: '2026-09-26', saleTime: '15:00' }, // Saturday, not a promotion day
      { iso: '2026-09-25T17:30:00.000Z', saleDate: '2026-09-26', saleTime: '00:30' }, // Friday in UTC, already Saturday in Bangkok
    ] as const
    // weighted towards bills dayo accepts, so every promotion is reached in every run (the refusals still come up often)
    const lineDiscount = fc.oneof(
      { weight: 4, arbitrary: fc.constant({ discountSatang: null, discountPercent: null }) },
      { weight: 1, arbitrary: fc.integer({ min: 1, max: 100 }).map((p) => ({ discountSatang: null, discountPercent: p })) },
      { weight: 1, arbitrary: fc.integer({ min: 1, max: 12_000 }).map((s) => ({ discountSatang: s, discountPercent: null })) },
    )
    const billDiscount = fc.oneof(
      fc.constant(null),
      fc.integer({ min: 1, max: 20_000 }).map((satang) => ({ kind: 'satang' as const, satang, reason: 'ลูกค้าประจำ' as string | null })),
      fc.integer({ min: 1, max: 100 }).map((percent) => ({ kind: 'percent' as const, percent, reason: null as string | null })),
    )
    const row = fc.record({
      v: fc.integer({ min: 0, max: variants.length - 1 }), qty: fc.integer({ min: 1, max: 5 }), milk: fc.oneof({ weight: 4, arbitrary: fc.constant('fresh') }, { weight: 3, arbitrary: fc.constant('oat') }, { weight: 1, arbitrary: fc.constant('oat-any') }), g: fc.nat(),
      d: lineDiscount, free: fc.integer({ min: 0, max: 7 }).map((n) => n === 0), reason: fc.oneof({ weight: 1, arbitrary: fc.constant(null) }, { weight: 2, arbitrary: fc.constant('ลูกค้าประจำ') }, { weight: 1, arbitrary: fc.constant('   ') }),
    })
    const seen = {
      freeOk: 0, freeRefused: 0, oat: 0, notOk: 0, billSatang: 0, billPercent: 0, lineBaht: 0, linePercent: 0,
      qr: 0, promoLowercase: 0, promoUnknown: 0, noPromotions: 0, promos: new Set<string>(),
    }

    fc.assert(fc.property(
      fc.array(row, { minLength: 1, maxLength: 6 }), fc.constantFrom('store', 'grab', 'lineman'), fc.constantFrom('cash', 'qr'), billDiscount,
      fc.constantFrom(null, 'DAYO10', 'dayo10', 'NOPE'), fc.subarray(promotionIds), fc.integer({ min: 0, max: 5 }).map((n) => n === 0), fc.constantFrom(...instants),
      (rows, channelCode, paymentCode, bill, promoCode, skip, noPromotions, when) => {
        const lines = rows.map((r) => {
          const v = variants[r.v]!
          return line({
            code: v.menuCode, size: v.size, sweetness: v.sweetness, qty: r.qty, milk: r.milk === 'oat-any' || (r.milk === 'oat' && oatOk[r.v]) ? 'oat' : 'fresh',
            grade: v.isMatcha ? grades[r.g % grades.length]! : null, free: r.free, discountReason: r.reason, ...r.d,
          })
        })
        const c = cart(lines, { channelCode, paymentCode, billDiscount: bill, promoCode, skipPromotionIds: skip, noPromotions })
        const draft: OrderDraft = {
          saleDate: when.saleDate, saleTime: when.saleTime, channelCode, paymentCode,
          lines: lines.map((l) => ({
            code: l.code, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty, free: l.free,
            discountBaht: l.discountSatang === null ? null : l.discountSatang / 100, discountPercent: l.discountPercent, discountReason: l.discountReason,
          })),
          billDiscountBaht: bill?.kind === 'satang' ? bill.satang / 100 : null,
          billDiscountPercent: bill?.kind === 'percent' ? bill.percent : null,
          billDiscountReason: bill?.reason ?? null,
          promoCode: promoCode === null ? null : normPromoCode(promoCode), // plan 10 §0.2: the engine gets the normPromoCode form
          skipPromotionIds: noPromotions ? promotionIds : skip, // spec §4.5: no_promotions = skip every promotion of the catalog
        }

        const p = priceCart(c, POS_CATALOG, when.iso)
        const q = computeOrder(draft, dayoCatalog)
        expect(p.draft).toEqual(draft)
        expect(p.ok).toBe(q.ok)
        expect(p.totalSatang).toBe(edgeBahtToSatang(q.totalAmount))
        expect(p.itemsSubtotalSatang).toBe(edgeBahtToSatang(q.itemsSubtotal))
        expect(p.itemsDiscountSatang).toBe(edgeBahtToSatang(q.itemsDiscount))
        expect(p.billDiscountSatang).toBe(edgeBahtToSatang(q.billDiscountAmount))
        expect(p.channelFeeSatang).toBe(edgeBahtToSatang(q.channelFeeAmount))
        expect(p.lines.map((l) => [l.code, l.milk, l.qty, l.unitPriceSatang, l.discountPerCupSatang, l.promotionId, l.lineTotalSatang]))
          .toEqual(q.lines.map((l) => [l.menuCode, l.milk, l.qty, edgeBahtToSatang(l.unitPrice), edgeBahtToSatang(l.discountPerCup), l.promotionId, edgeBahtToSatang(l.lineTotal)]))
        expect(p.promotionsApplied.map((x) => [x.promotionId, x.discountSatang])).toEqual(q.promotionsApplied.map((x) => [x.promotionId, edgeBahtToSatang(x.discountAmount)]))

        if (noPromotions) expect(q.promotionsApplied).toEqual([]) // spec §4.5: "no promotions" really applies none

        if (!q.ok) seen.notOk++
        if (q.ok && lines.some((l) => l.free)) seen.freeOk++
        // refused BECAUSE of the free cup: a one-line bill whose only line is an unreasoned free cup on a milk it may
        // have (oat is refused on its own otherwise), and dayo's own free-needs-a-reason warning (ADR-0023) is there
        const onlyFreeUnreasoned = rows.length === 1 && rows[0]!.free && (rows[0]!.reason === null || rows[0]!.reason.trim() === '') && (rows[0]!.milk !== 'oat-any' || oatOk[rows[0]!.v])
        if (!q.ok && onlyFreeUnreasoned && q.warnings.some((w) => w.includes('ให้ฟรีต้องมีหมายเหตุ'))) seen.freeRefused++
        if (q.ok && q.lines.some((l) => l.milk === 'oat')) seen.oat++
        if (q.ok && q.billDiscountAmount > 0) seen[bill?.kind === 'percent' ? 'billPercent' : 'billSatang']++
        if (q.ok && lines.some((l) => l.discountSatang !== null && !l.free)) seen.lineBaht++
        if (q.ok && lines.some((l) => l.discountPercent !== null && !l.free)) seen.linePercent++
        if (q.ok && paymentCode === 'qr') seen.qr++
        if (q.ok && promoCode === 'dayo10') seen.promoLowercase++
        if (q.ok && promoCode === 'NOPE') seen.promoUnknown++
        if (q.ok && noPromotions) seen.noPromotions++
        if (q.ok) for (const x of q.promotionsApplied) seen.promos.add(x.promotionId)
      },
    ), { numRuns: 1000 })

    // the generator really reached every kind of input (a narrowed generator fails here, not silently)
    expect(seen.freeOk).toBeGreaterThan(0)
    expect(seen.freeRefused).toBeGreaterThan(0)
    expect(seen.oat).toBeGreaterThan(0)
    expect(seen.notOk).toBeGreaterThan(0)
    expect(seen.billSatang).toBeGreaterThan(0)
    expect(seen.billPercent).toBeGreaterThan(0)
    expect(seen.lineBaht).toBeGreaterThan(0)
    expect(seen.linePercent).toBeGreaterThan(0)
    expect(seen.qr).toBeGreaterThan(0)
    expect(seen.promoLowercase).toBeGreaterThan(0)
    expect(seen.promoUnknown).toBeGreaterThan(0)
    expect(seen.noPromotions).toBeGreaterThan(0)
    expect([...seen.promos].sort()).toEqual([...promotionIds].sort()) // every promotion of the test catalog, DAYO10 and the matcha hour included
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

describe('a milk or grade option with no ingredient (dayo menu_options.ingredient_id/multiplier are nullable)', () => {
  const raw = (): Record<string, unknown> => structuredClone(loadRichCatalog().catalog) as unknown as Record<string, unknown>
  /** E1 JSON with nulls where dayo's web lets the owner leave them empty — parsed like any E1, never refused whole (R12). */
  const withNulls = (edit: (c: { milkOptions: Record<string, unknown>[]; gradeOptions: Record<string, unknown>[] }) => void): PosOrderCatalog => {
    const c = raw()
    edit(c as never)
    return toPricingCatalog(PosOrderCatalogSchema.parse(c))
  }
  const matcha = POS_CATALOG.variants.find((v) => v.isMatcha && v.size === '16 oz')!
  const premium = POS_CATALOG.gradeOptions.find((g) => !g.isDefault)!
  /** Parity: the POS result equals dayo's own computeOrder run on the SAME nulls (dayo reads menu_options as stored). */
  const expectParity = (catalog: PosOrderCatalog, c: CartDraft): void => {
    const got = priceCart(c, catalog, FRI_1030)
    const q = computeOrder(toOrderDraft(c, catalog, FRI_1030), { ...catalog, ingredients: withZeroCosts(catalog).ingredients } as unknown as OrderCatalog)
    expect(got.ok).toBe(q.ok)
    expect(got.totalSatang).toBe(edgeBahtToSatang(q.totalAmount))
    expect(got.lines.map((l) => l.unitPriceSatang)).toEqual(q.lines.map((l) => edgeBahtToSatang(l.unitPrice)))
  }

  it('a grade with null ingredientId and null multiplier parses and prices like dayo — the grade price still applies', () => {
    const catalog = withNulls((c) => { const g = c.gradeOptions.find((x) => x['code'] === premium.code)!; g['ingredientId'] = null; g['multiplier'] = null })
    expect(catalog.gradeOptions.find((g) => g.code === premium.code)).toMatchObject({ ingredientId: null, multiplier: null })
    const c = cart([line({ code: matcha.menuCode, size: matcha.size, sweetness: matcha.sweetness, grade: premium.code })])
    expectParity(catalog, c)
    // cost-only fields: the price is the same as with the ingredient filled in
    expect(priceCart(c, catalog, FRI_1030).totalSatang).toBe(priceCart(c, POS_CATALOG, FRI_1030).totalSatang)
    expect(lineOptions(catalog, matcha.menuCode, matcha.size, matcha.sweetness).grades.map((g) => g.code)).toContain(premium.code)
  })
  it('an oat option with a null ingredientId parses and prices like dayo', () => {
    const catalog = withNulls((c) => { c.milkOptions.find((x) => x['code'] === 'oat')!['ingredientId'] = null })
    const oatable = POS_CATALOG.variants.find((v) => lineOptions(POS_CATALOG, v.menuCode, v.size, v.sweetness).milk.some((m) => m.code === 'oat'))!
    expectParity(catalog, cart([line({ code: oatable.menuCode, size: oatable.size, sweetness: oatable.sweetness, milk: 'oat' })]))
  })
  it('a fresh-milk option with a null ingredientId parses, and every line prices exactly like dayo on the same null', () => {
    const catalog = withNulls((c) => { c.milkOptions.find((x) => x['code'] === 'fresh')!['ingredientId'] = null })
    const variants = catalog.variants.filter((x) => x.size === '16 oz')
    expect(variants.length).toBeGreaterThan(1)
    for (const v of variants) {
      const opts = lineOptions(catalog, v.menuCode, v.size, v.sweetness)
      for (const m of opts.milk) expectParity(catalog, cart([line({ code: v.menuCode, size: v.size, sweetness: v.sweetness, milk: m.code, grade: opts.defaultGrade })]))
    }
  })
})
