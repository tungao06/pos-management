import { sql } from 'drizzle-orm'
import { sqliteTable, unique, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { ItemKind, UseUnit, UserRole } from '@dayo/contracts'
import { big, bool, id, int, json, text, textEnum } from './columns.js'

export const user = sqliteTable('user', {
  id: id(),
  displayName: text('display_name').notNull(),
  role: textEnum('role', UserRole).notNull(),
  pinHash: text('pin_hash').notNull(),
  isActive: bool('is_active').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: int('version').notNull(),
})

export const device = sqliteTable('device', {
  id: id(),
  name: text('name').notNull(),
  receiptPrefix: text('receipt_prefix').notNull().unique(),
  isSellingDevice: bool('is_selling_device').notNull(),
  registeredAt: text('registered_at').notNull(),
})

export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  valueJson: json('value_json').notNull(),
  effectiveFrom: text('effective_from').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const category = sqliteTable('category', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  sort: int('sort').notNull(),
  isActive: bool('is_active').notNull(),
})

export const item = sqliteTable('item', {
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
})

export const purchaseUnit = sqliteTable('purchase_unit', {
  id: id(),
  itemId: text('item_id').notNull().references(() => item.id),
  name: text('name').notNull(),
  qtyPerUnitMilli: int('qty_per_unit_milli').notNull(),
  isDefault: bool('is_default').notNull(),
  barcode: text('barcode'),
})

export const bom = sqliteTable('bom', {
  id: id(),
  itemId: text('item_id').notNull().references(() => item.id),
  version: int('version').notNull(),
  yieldMilli: int('yield_milli').notNull(),
  isCurrent: bool('is_current').notNull(),
  instructions: text('instructions'),
}, (t) => [uniqueIndex('bom_current_uq').on(t.itemId).where(sql`is_current`)])

export const bomLine = sqliteTable('bom_line', {
  id: id(),
  bomId: text('bom_id').notNull().references(() => bom.id),
  componentItemId: text('component_item_id').notNull().references(() => item.id),
  qtyMilli: int('qty_milli').notNull(),
})

export const product = sqliteTable('product', {
  id: id(),
  code: text('code').notNull().unique(),
  nameTh: text('name_th').notNull(),
  nameEn: text('name_en').notNull(),
  categoryId: text('category_id').notNull().references(() => category.id),
  sort: int('sort').notNull(),
  isActive: bool('is_active').notNull(),
  prepGroup: text('prep_group'),
  soldOutUntil: text('sold_out_until'),
})

export const size = sqliteTable('size', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  sort: int('sort').notNull(),
  packagingItemId: text('packaging_item_id').notNull().references(() => item.id),
})

export const productVariant = sqliteTable('product_variant', {
  id: id(),
  productId: text('product_id').notNull().references(() => product.id),
  sizeId: text('size_id').notNull().references(() => size.id),
  sku: text('sku').notNull().unique(),
  isActive: bool('is_active').notNull(),
}, (t) => [unique().on(t.productId, t.sizeId)])

export const sweetnessLevel = sqliteTable('sweetness_level', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  sort: int('sort').notNull(),
  isDefault: bool('is_default').notNull(),
})

export const channel = sqliteTable('channel', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  commissionBp: int('commission_bp').notNull(),
  isActive: bool('is_active').notNull(),
})

export const price = sqliteTable('price', {
  id: id(),
  variantId: text('variant_id').notNull().references(() => productVariant.id),
  channelId: text('channel_id').notNull().references(() => channel.id),
  priceSatang: int('price_satang').notNull(),
  effectiveFrom: text('effective_from').notNull(),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
}, (t) => [unique().on(t.variantId, t.channelId, t.effectiveFrom)])

export const recipe = sqliteTable('recipe', {
  id: id(),
  variantId: text('variant_id').notNull().references(() => productVariant.id),
  sweetnessId: text('sweetness_id').notNull().references(() => sweetnessLevel.id),
  version: int('version').notNull(),
  effectiveFrom: text('effective_from').notNull(),
  isCurrent: bool('is_current').notNull(),
  createdBy: text('created_by'),
  note: text('note'),
}, (t) => [
  unique().on(t.variantId, t.sweetnessId, t.version),
  uniqueIndex('recipe_current_uq').on(t.variantId, t.sweetnessId).where(sql`is_current`), // one current version (M5)
])

export const recipeLine = sqliteTable('recipe_line', {
  id: id(),
  recipeId: text('recipe_id').notNull().references(() => recipe.id),
  itemId: text('item_id').notNull().references(() => item.id),
  qtyMilli: int('qty_milli').notNull(),
})

export const equipment = sqliteTable('equipment', {
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
})

export const customer = sqliteTable('customer', {
  id: id(),
  lineUserId: text('line_user_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  pictureUrl: text('picture_url'),
  firstSeenAt: text('first_seen_at').notNull(),
  lastOrderAt: text('last_order_at'),
  isBlocked: bool('is_blocked').notNull(),
})
