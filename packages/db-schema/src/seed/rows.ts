import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
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
 * The one ordered list of seed tables (M11): parents before children, so inserting in this order satisfies every FK.
 * `key` is the SeedRows field, `table` the DB table name (same in both dialects). The sqlite and pg apply helpers
 * both walk this list; kept dialect-neutral so the browser bundle does not pull in the pg schema.
 */
export const SEED_TABLES = [
  { key: 'categories', table: 'category' },
  { key: 'items', table: 'item' },
  { key: 'purchaseUnits', table: 'purchase_unit' },
  { key: 'boms', table: 'bom' },
  { key: 'bomLines', table: 'bom_line' },
  { key: 'sizes', table: 'size' },
  { key: 'products', table: 'product' },
  { key: 'variants', table: 'product_variant' },
  { key: 'sweetness', table: 'sweetness_level' },
  { key: 'channels', table: 'channel' },
  { key: 'prices', table: 'price' },
  { key: 'recipes', table: 'recipe' },
  { key: 'recipeLines', table: 'recipe_line' },
  { key: 'equipment', table: 'equipment' },
] as const satisfies readonly { key: keyof SeedRows; table: string }[]

export type SeedTable = (typeof SEED_TABLES)[number]['table']

/**
 * `newId(kind, naturalKey)` makes every primary key. `kind` is the DB table name (`item`, `recipe`, …) and
 * `naturalKey` a stable key built from codes, never from array position (I2):
 * - category · item · size · product · sweetness_level · channel · equipment: `code`
 * - product_variant: `productCode|sizeCode` · purchase_unit: `itemCode|name`
 * - price: `productCode|sizeCode|channelCode` (the import's effective_from is not part of the identity)
 * - bom: `itemCode` · bom_line: `itemCode|componentItemCode`
 * - recipe: `productCode|sizeCode|sweetnessCode` · recipe_line: `productCode|sizeCode|sweetnessCode|itemCode`
 *
 * The app and the server pass `(k, key) => deterministicSeedId(namespace, k, key)` with the SAME namespace, so every
 * device and the server get identical reference ids from the same seed, whatever the array order.
 * Seeds are version 1 of every recipe/BOM; later versions are created by the back office with fresh ids.
 * `now` fills created_at · `effectiveFrom` is the import time used for price and recipe effective_from (spec §9).
 */
export type SeedOpts = { newId: (kind: SeedTable, naturalKey: string) => string; now: string; effectiveFrom: string }

/**
 * A UUID-shaped id derived from SHA-256 (I2): the first 16 bytes of
 * `sha256(utf8(JSON.stringify([namespace, kind, naturalKey])))`, laid out as an RFC 9562 **UUIDv8** (custom/vendor
 * format): version nibble = 8 (byte 6 high nibble), variant bits = 0b10 (byte 8 top two bits). The JSON array makes
 * the input unambiguous whatever characters the parts contain. Pure, so the same inputs give the same id everywhere.
 */
export function deterministicSeedId(namespace: string, kind: string, naturalKey: string): string {
  const b = sha256(utf8ToBytes(JSON.stringify([namespace, kind, naturalKey]))).slice(0, 16)
  b[6] = (b[6]! & 0x0f) | 0x80
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = bytesToHex(b)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function must<K, V>(m: Map<K, V>, k: K, what: string): V {
  const v = m.get(k)
  if (v === undefined) throw new Error(`seed: unknown ${what} ${String(k)}`)
  return v
}

/**
 * Turn the Excel-derived seed (codes) into database rows (ids). Pure; ids depend only on `newId` and natural keys,
 * never on array order. Throws on an unknown code or on two rows with the same natural key.
 * Every row is active · recipes and BOMs are version 1 and current · item.standard_cost_usat is copied as-is
 * (raw: purchase-log average per D34; prepared/packaging_set: the BOM roll-up the importer already computed).
 */
export function seedToRows(seed: Seed, o: SeedOpts): SeedRows {
  const seen = new Set<string>()
  const id = (kind: SeedTable, key: string): string => {
    const k = `${kind}:${key}`
    if (seen.has(k)) throw new Error(`seed: duplicate ${kind} ${key}`)
    seen.add(k)
    return o.newId(kind, key)
  }
  const catId = new Map(seed.categories.map((c) => [c.code, id('category', c.code)]))
  const itemId = new Map(seed.items.map((i) => [i.code, id('item', i.code)]))
  const sizeId = new Map(seed.sizes.map((x) => [x.code, id('size', x.code)]))
  const productId = new Map(seed.products.map((p) => [p.code, id('product', p.code)]))
  const variantId = new Map(seed.variants.map((v) => { const k = `${v.productCode}|${v.sizeCode}`; return [k, id('product_variant', k)] }))
  const sweetId = new Map(seed.sweetness.map((x) => [x.code, id('sweetness_level', x.code)]))
  const channelId = new Map(seed.channels.map((x) => [x.code, id('channel', x.code)]))

  const rows: SeedRows = {
    categories: seed.categories.map((c) => ({ id: must(catId, c.code, 'category'), code: c.code, name: c.name, sort: c.sort, isActive: true, updatedAt: o.now, version: 1 })),
    items: seed.items.map((i) => ({
      id: must(itemId, i.code, 'item'), code: i.code, name: i.name, kind: i.kind, category: i.category, useUnit: i.useUnit,
      isTracked: i.isTracked, reorderPointMilli: i.reorderPointMilli, standardCostUsat: i.standardCostUsat, shelfLifeHours: i.shelfLifeHours, isActive: true, note: i.note,
      updatedAt: o.now, version: 1,
    })),
    purchaseUnits: seed.purchaseUnits.map((u) => ({ id: id('purchase_unit', `${u.itemCode}|${u.name}`), itemId: must(itemId, u.itemCode, 'item'), name: u.name, qtyPerUnitMilli: u.qtyPerUnitMilli, isDefault: u.isDefault, barcode: null, updatedAt: o.now, version: 1 })),
    boms: [],
    bomLines: [],
    sizes: seed.sizes.map((x) => ({ id: must(sizeId, x.code, 'size'), code: x.code, name: x.name, sort: x.sort, packagingItemId: must(itemId, x.packagingItemCode, 'item'), updatedAt: o.now, version: 1 })),
    products: seed.products.map((p) => ({ id: must(productId, p.code, 'product'), code: p.code, nameTh: p.nameTh, nameEn: p.nameEn, categoryId: must(catId, p.categoryCode, 'category'), sort: p.sort, isActive: true, prepGroup: p.prepGroup, soldOutUntil: null, updatedAt: o.now, version: 1 })),
    variants: seed.variants.map((v) => ({ id: must(variantId, `${v.productCode}|${v.sizeCode}`, 'variant'), productId: must(productId, v.productCode, 'product'), sizeId: must(sizeId, v.sizeCode, 'size'), sku: v.sku, isActive: true, updatedAt: o.now, version: 1 })),
    sweetness: seed.sweetness.map((x) => ({ id: must(sweetId, x.code, 'sweetness'), code: x.code, name: x.name, sort: x.sort, isDefault: x.isDefault, updatedAt: o.now, version: 1 })),
    channels: seed.channels.map((x) => ({ id: must(channelId, x.code, 'channel'), code: x.code, name: x.name, commissionBp: x.commissionBp, isActive: true, updatedAt: o.now, version: 1 })),
    prices: seed.prices.map((p) => ({
      id: id('price', `${p.productCode}|${p.sizeCode}|${p.channelCode}`), variantId: must(variantId, `${p.productCode}|${p.sizeCode}`, 'variant'), channelId: must(channelId, p.channelCode, 'channel'),
      priceSatang: p.priceSatang, effectiveFrom: o.effectiveFrom, createdBy: null, createdAt: o.now, updatedAt: o.now, version: 1,
    })),
    recipes: [],
    recipeLines: [],
    equipment: seed.equipment.map((e) => ({ id: id('equipment', e.code), code: e.code, name: e.name, purchasedAt: e.purchasedAt, priceSatang: e.priceSatang, qty: e.qty, supplier: e.supplier, lifeMonths: e.lifeMonths, condition: e.condition, owner: e.owner, note: e.note, updatedAt: o.now, version: 1 })),
  }
  for (const b of seed.boms) {
    const bomId = id('bom', b.itemCode)
    rows.boms.push({ id: bomId, itemId: must(itemId, b.itemCode, 'item'), version: 1, yieldMilli: b.yieldMilli, isCurrent: true, instructions: null, updatedAt: o.now })
    for (const l of b.lines) rows.bomLines.push({ id: id('bom_line', `${b.itemCode}|${l.itemCode}`), bomId, componentItemId: must(itemId, l.itemCode, 'item'), qtyMilli: l.qtyMilli, updatedAt: o.now, version: 1 })
  }
  for (const r of seed.recipes) {
    const key = `${r.productCode}|${r.sizeCode}|${r.sweetnessCode}`
    const recipeId = id('recipe', key)
    rows.recipes.push({ id: recipeId, variantId: must(variantId, `${r.productCode}|${r.sizeCode}`, 'variant'), sweetnessId: must(sweetId, r.sweetnessCode, 'sweetness'), version: 1, effectiveFrom: o.effectiveFrom, isCurrent: true, createdBy: null, note: null, updatedAt: o.now })
    for (const l of r.lines) rows.recipeLines.push({ id: id('recipe_line', `${key}|${l.itemCode}`), recipeId, itemId: must(itemId, l.itemCode, 'item'), qtyMilli: l.qtyMilli, updatedAt: o.now, version: 1 })
  }
  return rows
}
