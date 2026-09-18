import type { Seed } from '@dayo/contracts'
import type * as s from '../sqlite/index.js'

type Ins<T extends { $inferInsert: unknown }> = T['$inferInsert']

export type SeedRows = {
  categories: Ins<typeof s.category>[]
  items: Ins<typeof s.item>[]
  purchaseUnits: Ins<typeof s.purchaseUnit>[]
  boms: Ins<typeof s.bom>[]
  bomLines: Ins<typeof s.bomLine>[]
  sizes: Ins<typeof s.size>[]
  products: Ins<typeof s.product>[]
  variants: Ins<typeof s.productVariant>[]
  sweetness: Ins<typeof s.sweetnessLevel>[]
  channels: Ins<typeof s.channel>[]
  prices: Ins<typeof s.price>[]
  recipes: Ins<typeof s.recipe>[]
  recipeLines: Ins<typeof s.recipeLine>[]
  equipment: Ins<typeof s.equipment>[]
}

/**
 * `newId` makes every primary key (UUIDv7 in the app, a counter in tests) · `now` fills created_at ·
 * `effectiveFrom` is the import time used for price and recipe effective_from (spec §9).
 */
export type SeedOpts = { newId: () => string; now: string; effectiveFrom: string }

function must<K, V>(m: Map<K, V>, k: K, what: string): V {
  const v = m.get(k)
  if (v === undefined) throw new Error(`seed: unknown ${what} ${String(k)}`)
  return v
}

/**
 * Turn the Excel-derived seed (codes) into database rows (ids). Pure and deterministic for a deterministic `newId`.
 * Every row is active · recipes and BOMs are version 1 and current · item.standard_cost_usat is copied as-is
 * (raw: purchase-log average per D34; prepared/packaging_set: the BOM roll-up the importer already computed).
 */
export function seedToRows(seed: Seed, o: SeedOpts): SeedRows {
  const catId = new Map(seed.categories.map((c) => [c.code, o.newId()]))
  const itemId = new Map(seed.items.map((i) => [i.code, o.newId()]))
  const sizeId = new Map(seed.sizes.map((x) => [x.code, o.newId()]))
  const productId = new Map(seed.products.map((p) => [p.code, o.newId()]))
  const variantId = new Map(seed.variants.map((v) => [`${v.productCode}|${v.sizeCode}`, o.newId()]))
  const sweetId = new Map(seed.sweetness.map((x) => [x.code, o.newId()]))
  const channelId = new Map(seed.channels.map((x) => [x.code, o.newId()]))

  const rows: SeedRows = {
    categories: seed.categories.map((c) => ({ id: must(catId, c.code, 'category'), code: c.code, name: c.name, sort: c.sort, isActive: true })),
    items: seed.items.map((i) => ({
      id: must(itemId, i.code, 'item'), code: i.code, name: i.name, kind: i.kind, category: i.category, useUnit: i.useUnit,
      isTracked: i.isTracked, reorderPointMilli: i.reorderPointMilli, standardCostUsat: i.standardCostUsat, shelfLifeHours: i.shelfLifeHours, isActive: true, note: i.note,
    })),
    purchaseUnits: seed.purchaseUnits.map((u) => ({ id: o.newId(), itemId: must(itemId, u.itemCode, 'item'), name: u.name, qtyPerUnitMilli: u.qtyPerUnitMilli, isDefault: u.isDefault, barcode: null })),
    boms: [],
    bomLines: [],
    sizes: seed.sizes.map((x) => ({ id: must(sizeId, x.code, 'size'), code: x.code, name: x.name, sort: x.sort, packagingItemId: must(itemId, x.packagingItemCode, 'item') })),
    products: seed.products.map((p) => ({ id: must(productId, p.code, 'product'), code: p.code, nameTh: p.nameTh, nameEn: p.nameEn, categoryId: must(catId, p.categoryCode, 'category'), sort: p.sort, isActive: true, prepGroup: p.prepGroup, soldOutUntil: null })),
    variants: seed.variants.map((v) => ({ id: must(variantId, `${v.productCode}|${v.sizeCode}`, 'variant'), productId: must(productId, v.productCode, 'product'), sizeId: must(sizeId, v.sizeCode, 'size'), sku: v.sku, isActive: true })),
    sweetness: seed.sweetness.map((x) => ({ id: must(sweetId, x.code, 'sweetness'), code: x.code, name: x.name, sort: x.sort, isDefault: x.isDefault })),
    channels: seed.channels.map((x) => ({ id: must(channelId, x.code, 'channel'), code: x.code, name: x.name, commissionBp: x.commissionBp, isActive: true })),
    prices: seed.prices.map((p) => ({ id: o.newId(), variantId: must(variantId, `${p.productCode}|${p.sizeCode}`, 'variant'), channelId: must(channelId, p.channelCode, 'channel'), priceSatang: p.priceSatang, effectiveFrom: o.effectiveFrom, createdBy: null, createdAt: o.now })),
    recipes: [],
    recipeLines: [],
    equipment: seed.equipment.map((e) => ({ id: o.newId(), code: e.code, name: e.name, purchasedAt: e.purchasedAt, priceSatang: e.priceSatang, qty: e.qty, supplier: e.supplier, lifeMonths: e.lifeMonths, condition: e.condition, owner: e.owner, note: e.note })),
  }
  for (const b of seed.boms) {
    const bomId = o.newId()
    rows.boms.push({ id: bomId, itemId: must(itemId, b.itemCode, 'item'), version: 1, yieldMilli: b.yieldMilli, isCurrent: true, instructions: null })
    for (const l of b.lines) rows.bomLines.push({ id: o.newId(), bomId, componentItemId: must(itemId, l.itemCode, 'item'), qtyMilli: l.qtyMilli })
  }
  for (const r of seed.recipes) {
    const recipeId = o.newId()
    rows.recipes.push({ id: recipeId, variantId: must(variantId, `${r.productCode}|${r.sizeCode}`, 'variant'), sweetnessId: must(sweetId, r.sweetnessCode, 'sweetness'), version: 1, effectiveFrom: o.effectiveFrom, isCurrent: true, createdBy: null, note: null })
    for (const l of r.lines) rows.recipeLines.push({ id: o.newId(), recipeId, itemId: must(itemId, l.itemCode, 'item'), qtyMilli: l.qtyMilli })
  }
  return rows
}
