import type ExcelJS from 'exceljs'
import { parseSeed, type Seed } from '@dayo/contracts'
import { buildCatalog, standardUnitCostUsat, type Bom, type Catalog, type CatalogItem } from '@dayo/domain'
import { CATEGORIES, CHANNELS, SIZES, SWEETNESS } from './constants.js'
import { parseBoms } from './parse-boms.js'
import { parseEquipment } from './parse-equipment.js'
import { parseItems } from './parse-items.js'
import { parseProducts } from './parse-products.js'
import { parseRecipes } from './parse-recipes.js'

/**
 * Roll up each prepared and packaging_set item's standard cost through its BOM (spec §4.4), so the seed
 * carries the true standard cost instead of the placeholder 0 that `parseBoms` writes. Raw items keep
 * their own standard cost (from the purchase log); it never goes through a BOM.
 */
function withStandardCostRollup(items: readonly CatalogItem[], boms: readonly Bom[]): CatalogItem[] {
  const catalog = buildCatalog(items, boms)
  return items.map((i) => (i.kind === 'raw' ? i : { ...i, standardCostUsat: standardUnitCostUsat(i.id, catalog) }))
}

export function buildSeed(wb: ExcelJS.Workbook): Seed {
  const raw = parseItems(wb)
  const prepared = parseBoms(wb)
  const catalog = parseProducts(wb)
  const items = [...raw.items, ...prepared.items]
  const catalogItems: CatalogItem[] = items.map((i) => ({ id: i.code, kind: i.kind, isTracked: i.isTracked, standardCostUsat: i.standardCostUsat }))
  const catalogBoms: Bom[] = prepared.boms.map((b) => ({ itemId: b.itemCode, yieldMilli: b.yieldMilli, lines: b.lines.map((l) => ({ itemId: l.itemCode, qtyMilli: l.qtyMilli })) }))
  const costById = new Map(withStandardCostRollup(catalogItems, catalogBoms).map((i) => [i.id, i.standardCostUsat]))
  const itemsWithRollup = items.map((i) => ({ ...i, standardCostUsat: costById.get(i.code) ?? i.standardCostUsat }))
  return parseSeed({
    categories: CATEGORIES.map((c) => ({ ...c })),
    sizes: SIZES.map(({ code, name, sort, packagingItemCode }) => ({ code, name, sort, packagingItemCode })),
    sweetness: SWEETNESS.map((s) => ({ ...s })),
    channels: CHANNELS.map((c) => ({ ...c })),
    items: itemsWithRollup,
    purchaseUnits: raw.purchaseUnits,
    boms: prepared.boms,
    products: catalog.products,
    variants: catalog.variants,
    prices: catalog.prices,
    recipes: parseRecipes(wb),
    equipment: parseEquipment(wb),
  })
}

/** Domain catalog keyed by item code (ids are assigned only when seeding a database — plan 2). */
export function seedCatalog(seed: Seed): Catalog {
  const items: CatalogItem[] = seed.items.map((i) => ({ id: i.code, kind: i.kind, isTracked: i.isTracked, standardCostUsat: i.standardCostUsat }))
  const boms: Bom[] = seed.boms.map((b) => ({ itemId: b.itemCode, yieldMilli: b.yieldMilli, lines: b.lines.map((l) => ({ itemId: l.itemCode, qtyMilli: l.qtyMilli })) }))
  return buildCatalog(items, boms)
}
