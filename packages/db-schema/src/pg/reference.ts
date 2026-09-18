import { sql } from 'drizzle-orm'
import { pgTable, primaryKey, unique, uniqueIndex } from 'drizzle-orm/pg-core'
import { ItemKind, UseUnit, UserRole } from '@dayo/contracts'
import { big, bool, id, int, json, serverSeq, text, textEnum } from './columns.js'

export const user = pgTable('user', {
  id: id(),
  displayName: text('display_name').notNull(),
  role: textEnum('role', UserRole).notNull(),
  pinHash: text('pin_hash').notNull(),
  isActive: bool('is_active').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
})

export const device = pgTable('device', {
  id: id(),
  name: text('name').notNull(),
  receiptPrefix: text('receipt_prefix').notNull().unique(),
  isSellingDevice: bool('is_selling_device').notNull(),
  registeredAt: text('registered_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
})

/** D47 item 9: PK is (key, effective_from) — settings keep history, like price and recipe. */
export const setting = pgTable('setting', {
  key: text('key').notNull(),
  valueJson: json('value_json').notNull(),
  effectiveFrom: text('effective_from').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
}, (t) => [primaryKey({ columns: [t.key, t.effectiveFrom] })])

export const category = pgTable('category', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  sort: int('sort').notNull(),
  isActive: bool('is_active').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
})

export const item = pgTable('item', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  kind: textEnum('kind', ItemKind).notNull(),
  category: text('category').notNull(),
  useUnit: textEnum('use_unit', UseUnit).notNull(),
  isTracked: bool('is_tracked').notNull(),
  reorderPointMilli: int('reorder_point_milli').notNull(),
  standardCostUsat: big('standard_cost_usat').notNull(), // raw: purchase-log average (D34) · prepared/packaging_set: BOM roll-up
  shelfLifeHours: int('shelf_life_hours'),
  isActive: bool('is_active').notNull(),
  note: text('note'),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
})

export const purchaseUnit = pgTable('purchase_unit', {
  id: id(),
  itemId: text('item_id').notNull().references(() => item.id),
  name: text('name').notNull(),
  qtyPerUnitMilli: int('qty_per_unit_milli').notNull(),
  isDefault: bool('is_default').notNull(),
  barcode: text('barcode'),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
})

/** bom.version is the BOM's own revision number (a new row per revision), not a per-row edit counter — it already
 * satisfies D47 item 8's "version int NOT NULL default 1"; only updated_at is added. */
export const bom = pgTable('bom', {
  id: id(),
  itemId: text('item_id').notNull().references(() => item.id),
  version: int('version').notNull().default(1),
  yieldMilli: int('yield_milli').notNull(),
  isCurrent: bool('is_current').notNull(),
  instructions: text('instructions'),
  updatedAt: text('updated_at').notNull(),
  serverSeq: serverSeq(),
}, (t) => [uniqueIndex('bom_current_uq').on(t.itemId).where(sql`is_current`)])

export const bomLine = pgTable('bom_line', {
  id: id(),
  bomId: text('bom_id').notNull().references(() => bom.id),
  componentItemId: text('component_item_id').notNull().references(() => item.id),
  qtyMilli: int('qty_milli').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
})

export const product = pgTable('product', {
  id: id(),
  code: text('code').notNull().unique(),
  nameTh: text('name_th').notNull(),
  nameEn: text('name_en').notNull(),
  categoryId: text('category_id').notNull().references(() => category.id),
  sort: int('sort').notNull(),
  isActive: bool('is_active').notNull(),
  prepGroup: text('prep_group'),
  soldOutUntil: text('sold_out_until'),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
})

export const size = pgTable('size', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  sort: int('sort').notNull(),
  packagingItemId: text('packaging_item_id').notNull().references(() => item.id),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
})

export const productVariant = pgTable('product_variant', {
  id: id(),
  productId: text('product_id').notNull().references(() => product.id),
  sizeId: text('size_id').notNull().references(() => size.id),
  sku: text('sku').notNull().unique(),
  isActive: bool('is_active').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
}, (t) => [unique().on(t.productId, t.sizeId)])

export const sweetnessLevel = pgTable('sweetness_level', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  sort: int('sort').notNull(),
  isDefault: bool('is_default').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
})

export const channel = pgTable('channel', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  commissionBp: int('commission_bp').notNull(),
  isActive: bool('is_active').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
})

export const price = pgTable('price', {
  id: id(),
  variantId: text('variant_id').notNull().references(() => productVariant.id),
  channelId: text('channel_id').notNull().references(() => channel.id),
  priceSatang: int('price_satang').notNull(),
  effectiveFrom: text('effective_from').notNull(),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
}, (t) => [unique().on(t.variantId, t.channelId, t.effectiveFrom)])

/** recipe.version is the recipe's own revision number (a new row per revision) — see the note on bom.version above. */
export const recipe = pgTable('recipe', {
  id: id(),
  variantId: text('variant_id').notNull().references(() => productVariant.id),
  sweetnessId: text('sweetness_id').notNull().references(() => sweetnessLevel.id),
  version: int('version').notNull().default(1),
  effectiveFrom: text('effective_from').notNull(),
  isCurrent: bool('is_current').notNull(),
  createdBy: text('created_by'),
  note: text('note'),
  updatedAt: text('updated_at').notNull(),
  serverSeq: serverSeq(),
}, (t) => [
  unique().on(t.variantId, t.sweetnessId, t.version),
  uniqueIndex('recipe_current_uq').on(t.variantId, t.sweetnessId).where(sql`is_current`), // one current version (M5)
])

export const recipeLine = pgTable('recipe_line', {
  id: id(),
  recipeId: text('recipe_id').notNull().references(() => recipe.id),
  itemId: text('item_id').notNull().references(() => item.id),
  qtyMilli: int('qty_milli').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
})

export const equipment = pgTable('equipment', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  purchasedAt: text('purchased_at'),
  priceSatang: int('price_satang').notNull(),
  qty: int('qty').notNull(),
  supplier: text('supplier'),
  lifeMonths: int('life_months'),                // D37: whole months
  condition: text('condition'),
  owner: text('owner'),
  note: text('note'),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
})

export const customer = pgTable('customer', {
  id: id(),
  lineUserId: text('line_user_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  pictureUrl: text('picture_url'),
  firstSeenAt: text('first_seen_at').notNull(),
  lastOrderAt: text('last_order_at'),
  isBlocked: bool('is_blocked').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull().default(1),
  serverSeq: serverSeq(),
})
