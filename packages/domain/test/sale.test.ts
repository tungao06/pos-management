import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildCatalog } from '../src/stock/catalog.js'
import { VAT_OFF } from '../src/pricing.js'
import { planSale, requirePrice, requireRecipe, type SaleContext } from '../src/sale.js'

// raw tracked RM-A: 1 satang per unit (1_000_000 usat) · prepared tracked PB-X: 2 satang per unit
// packaging_set PK-SET (untracked) → 1 PK-CUP per set · PK-CUP: 1.50 baht per piece
const catalog = buildCatalog(
  [
    { id: 'RM-A', kind: 'raw', isTracked: true, standardCostUsat: 1_000_000 },
    { id: 'PB-X', kind: 'prepared', isTracked: true, standardCostUsat: 2_000_000 },
    { id: 'PK-SET', kind: 'packaging_set', isTracked: false, standardCostUsat: 150_000_000 },
    { id: 'PK-CUP', kind: 'raw', isTracked: true, standardCostUsat: 150_000_000 },
  ],
  [{ itemId: 'PK-SET', yieldMilli: 1000, lines: [{ itemId: 'PK-CUP', qtyMilli: 1000 }] }],
)

const ctx: SaleContext = {
  channelId: 'STORE',
  atIso: '2026-09-17T03:00:00.000Z',
  prices: [
    { variantId: 'V1', channelId: 'STORE', priceSatang: 4500, effectiveFrom: '2026-01-01T00:00:00.000Z' },
    { variantId: 'V1', channelId: 'STORE', priceSatang: 9900, effectiveFrom: '2026-12-01T00:00:00.000Z' },
    { variantId: 'V2', channelId: 'LINE_OA', priceSatang: 5000, effectiveFrom: '2026-01-01T00:00:00.000Z' },
  ],
  recipes: [
    { recipeId: 'R1', variantId: 'V1', sweetnessId: 'S50', lines: [{ itemId: 'RM-A', qtyMilli: 20_000 }, { itemId: 'PB-X', qtyMilli: 50_000 }, { itemId: 'PK-SET', qtyMilli: 1000 }] },
  ],
  catalog,
  costOf: (id) => catalog.items.get(id)!.standardCostUsat,
  vat: VAT_OFF,
}

describe('requirePrice / requireRecipe', () => {
  it('uses the latest effective price at the sale time', () => {
    expect(requirePrice(ctx.prices, 'V1', 'STORE', ctx.atIso).priceSatang).toBe(4500)
  })
  it('refuses to sell without a price on the channel', () => {
    expect(() => requirePrice(ctx.prices, 'V2', 'STORE', ctx.atIso)).toThrow(/^NO_PRICE: /)
  })
  it('requires exactly one current recipe', () => {
    expect(requireRecipe(ctx.recipes, 'V1', 'S50').recipeId).toBe('R1')
    expect(() => requireRecipe(ctx.recipes, 'V1', 'S100')).toThrow(/^NO_RECIPE: /)
  })
})

describe('planSale', () => {
  it('prices, totals, costs and deducts stock for a 2-cup line with a discount', () => {
    const plan = planSale([{ variantId: 'V1', sweetnessId: 'S50', qty: 2 }], 500, ctx, 'ORDER-1')
    expect(plan.lines).toEqual([
      { lineNo: 1, variantId: 'V1', sweetnessId: 'S50', recipeId: 'R1', qty: 2, unitPriceSatang: 4500, lineTotalSatang: 9000, unitCostSatang: 270 },
    ])
    expect(plan.totals.subtotalSatang).toBe(9000)
    expect(plan.totals.totalSatang).toBe(8500)
    expect(plan.costSatang).toBe(540)
    expect([...plan.needs]).toEqual([['RM-A', 40_000], ['PB-X', 100_000], ['PK-CUP', 2000]])
    expect(plan.movements).toEqual([
      { itemId: 'RM-A', kind: 'SALE', qtyMilli: -40_000, unitCostUsat: 1_000_000, refType: 'order', refId: 'ORDER-1' },
      { itemId: 'PB-X', kind: 'SALE', qtyMilli: -100_000, unitCostUsat: 2_000_000, refType: 'order', refId: 'ORDER-1' },
      { itemId: 'PK-CUP', kind: 'SALE', qtyMilli: -2000, unitCostUsat: 150_000_000, refType: 'order', refId: 'ORDER-1' },
    ])
  })
  it('aggregates the same item across lines into one movement', () => {
    const plan = planSale([{ variantId: 'V1', sweetnessId: 'S50', qty: 1 }, { variantId: 'V1', sweetnessId: 'S50', qty: 3 }], 0, ctx, 'O')
    expect(plan.lines.map((l) => l.lineNo)).toEqual([1, 2])
    expect(plan.movements.find((m) => m.itemId === 'RM-A')!.qtyMilli).toBe(-80_000)
    expect(plan.movements).toHaveLength(3)
  })
  it('rejects an empty cart, a discount above subtotal, and qty < 1', () => {
    expect(() => planSale([], 0, ctx, 'O')).toThrow(/^EMPTY_CART: /)
    expect(() => planSale([{ variantId: 'V1', sweetnessId: 'S50', qty: 1 }], 4501, ctx, 'O')).toThrow('discount exceeds subtotal')
    expect(() => planSale([{ variantId: 'V1', sweetnessId: 'S50', qty: 0 }], 0, ctx, 'O')).toThrow(RangeError)
  })
  it('property: stock out equals total needs and Σ line totals − discount = total', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 6 }), fc.integer({ min: 0, max: 100 }), (qtys, discountPct) => {
        const cart = qtys.map((qty) => ({ variantId: 'V1', sweetnessId: 'S50', qty }))
        const subtotal = qtys.reduce((a, q) => a + q * 4500, 0)
        const discount = Math.floor((subtotal * discountPct) / 100)
        const plan = planSale(cart, discount, ctx, 'O')
        const out = plan.movements.reduce((a, m) => a + m.qtyMilli, 0)
        const needs = [...plan.needs.values()].reduce((a, q) => a + q, 0)
        expect(out).toBe(-needs)
        expect(plan.lines.reduce((a, l) => a + l.lineTotalSatang, 0) - discount).toBe(plan.totals.totalSatang)
        expect(plan.costSatang).toBe(plan.lines.reduce((a, l) => a + l.unitCostSatang * l.qty, 0))
      }),
    )
  })
})
