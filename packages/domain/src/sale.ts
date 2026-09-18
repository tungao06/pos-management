import { assertSafeInt } from './money.js'
import { computeTotals, priceFor, type PriceRow, type Totals, type VatConfig } from './pricing.js'
import type { BomLine, Catalog } from './stock/catalog.js'
import { explodeNeeds } from './stock/explode.js'
import { lineUnitCostSatang, saleMovements, type CostOf, type MovementDraft } from './stock/movements.js'

export type SaleCartLine = { variantId: string; sweetnessId: string; qty: number }
export type SaleRecipe = { recipeId: string; variantId: string; sweetnessId: string; lines: readonly BomLine[] }
export type SaleContext = {
  channelId: string
  atIso: string
  prices: readonly PriceRow[]
  /** Current recipes (is_current) — at least those of the cart's variants. */
  recipes: readonly SaleRecipe[]
  catalog: Catalog
  /** Current average cost per use-unit (usat) of any item that can appear in needs. */
  costOf: CostOf
  vat: VatConfig
}
export type PlannedLine = {
  lineNo: number
  variantId: string
  sweetnessId: string
  recipeId: string
  qty: number
  unitPriceSatang: number
  lineTotalSatang: number
  unitCostSatang: number
}
export type SalePlan = { lines: PlannedLine[]; totals: Totals; costSatang: number; needs: Map<string, number>; movements: MovementDraft[] }

/** spec §4.1: selling something without a price is forbidden. */
export function requirePrice(prices: readonly PriceRow[], variantId: string, channelId: string, atIso: string): PriceRow {
  const p = priceFor(prices, variantId, channelId, atIso)
  if (!p) throw new Error(`NO_PRICE: variant ${variantId} has no price on channel ${channelId} at ${atIso}`)
  return p
}

export function requireRecipe(recipes: readonly SaleRecipe[], variantId: string, sweetnessId: string): SaleRecipe {
  const matches = recipes.filter((r) => r.variantId === variantId && r.sweetnessId === sweetnessId)
  if (matches.length !== 1) throw new Error(`NO_RECIPE: expected exactly 1 current recipe for ${variantId}/${sweetnessId}, found ${matches.length}`)
  return matches[0]!
}

/**
 * Everything a PAID in-store order needs (spec §4.1, §4.2): unit prices, totals with discount, per-line recipe version
 * and per-cup cost snapshot, and SALE movements aggregated per item across the whole order.
 */
export function planSale(cart: readonly SaleCartLine[], discountSatang: number, ctx: SaleContext, orderId: string): SalePlan {
  if (cart.length === 0) throw new RangeError('EMPTY_CART: cart has no lines')
  const needs = new Map<string, number>()
  const lines: PlannedLine[] = cart.map((c, i) => {
    assertSafeInt(c.qty, `cart[${i}].qty`)
    if (c.qty < 1) throw new RangeError(`cart[${i}].qty must be >= 1`)
    const price = requirePrice(ctx.prices, c.variantId, ctx.channelId, ctx.atIso)
    const recipe = requireRecipe(ctx.recipes, c.variantId, c.sweetnessId)
    const lineNeeds = explodeNeeds(recipe.lines, c.qty, ctx.catalog)
    for (const [itemId, q] of lineNeeds) needs.set(itemId, (needs.get(itemId) ?? 0) + q)
    return {
      lineNo: i + 1,
      variantId: c.variantId,
      sweetnessId: c.sweetnessId,
      recipeId: recipe.recipeId,
      qty: c.qty,
      unitPriceSatang: price.priceSatang,
      lineTotalSatang: 0,
      unitCostSatang: lineUnitCostSatang(lineNeeds, ctx.costOf, c.qty),
    }
  })
  const totals = computeTotals(lines.map((l) => ({ qty: l.qty, unitPriceSatang: l.unitPriceSatang })), discountSatang, ctx.vat)
  lines.forEach((l, i) => {
    l.lineTotalSatang = totals.lineTotals[i]!
  })
  const costSatang = lines.reduce((a, l) => a + l.unitCostSatang * l.qty, 0)
  return { lines, totals, costSatang, needs, movements: saleMovements(needs, ctx.costOf, orderId) }
}
