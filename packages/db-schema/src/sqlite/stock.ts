import { sql } from 'drizzle-orm'
import { AdjustReason, CountStatus, MovementKind } from '@dayo/contracts'
import { check, index, sqliteTable, unique } from 'drizzle-orm/sqlite-core'
import { big, id, int, json, text, textEnum } from './columns.js'
import { bom, device, item, purchaseUnit, user } from './reference.js'

export const purchase = sqliteTable('purchase', {
  id: id(),
  businessDate: text('business_date').notNull(),
  supplier: text('supplier'),
  totalSatang: int('total_satang').notNull(),
  receiptImageRef: text('receipt_image_ref'),
  note: text('note'),
  deviceId: text('device_id').references(() => device.id),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: text('created_at').notNull(),
})

export const purchaseLine = sqliteTable('purchase_line', {
  id: id(),
  purchaseId: text('purchase_id').notNull().references(() => purchase.id),
  itemId: text('item_id').notNull().references(() => item.id),
  purchaseUnitId: text('purchase_unit_id').references(() => purchaseUnit.id),
  qtyUnitsMilli: int('qty_units_milli').notNull(),
  qtyUseMilli: int('qty_use_milli').notNull(),
  lineTotalSatang: int('line_total_satang').notNull(),
}, (t) => [index('purchase_line_purchase_idx').on(t.purchaseId)])

export const productionBatch = sqliteTable('production_batch', {
  id: id(),
  bomId: text('bom_id').notNull().references(() => bom.id),
  itemId: text('item_id').notNull().references(() => item.id),
  businessDate: text('business_date').notNull(),
  scaleBp: int('scale_bp').notNull(),
  yieldActualMilli: int('yield_actual_milli').notNull(),
  unitCostUsat: big('unit_cost_usat').notNull(),
  batchCostSatang: int('batch_cost_satang').notNull(),
  expiresAt: text('expires_at'),
  deviceId: text('device_id').references(() => device.id),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: text('created_at').notNull(),
})

export const stockCount = sqliteTable('stock_count', {
  id: id(),
  businessDate: text('business_date').notNull(),
  status: textEnum('status', CountStatus).notNull(),
  deviceId: text('device_id').references(() => device.id),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: text('created_at').notNull(),
  closedBy: text('closed_by').references(() => user.id),
  closedAt: text('closed_at'),
})

export const stockCountLine = sqliteTable('stock_count_line', {
  id: id(),
  countId: text('count_id').notNull().references(() => stockCount.id),
  itemId: text('item_id').notNull().references(() => item.id),
  purchaseUnitId: text('purchase_unit_id').references(() => purchaseUnit.id),
  countedUnitsMilli: int('counted_units_milli').notNull(),
  countedUseMilli: int('counted_use_milli').notNull(),
  expectedUseMilli: int('expected_use_milli').notNull(),
  varianceUseMilli: int('variance_use_milli').notNull(),
  varianceSatang: int('variance_satang').notNull(),
}, (t) => [unique().on(t.countId, t.itemId)])

/**
 * Header of a stock-out without a sale (spec §5 ปรับสต็อก: ของเสีย / หมดอายุ / ทดลองสูตร / อื่น ๆ + เหตุผล ·
 * D50 Q3-20 แจก/ชดเชย). Its movements reference it (ref_type 'stock_adjustment'); stock_movement has no reason column.
 * detail_json keeps what was typed (items / drinks with the recipe version used) — plan 4 T4-1.
 */
export const stockAdjustment = sqliteTable('stock_adjustment', {
  id: id(),
  businessDate: text('business_date').notNull(),
  reasonCode: textEnum('reason_code', AdjustReason).notNull(),
  reason: text('reason').notNull(),
  detailJson: json('detail_json'),
  deviceId: text('device_id').references(() => device.id),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: text('created_at').notNull(),
})

export const stockMovement = sqliteTable('stock_movement', {
  id: id(),
  itemId: text('item_id').notNull().references(() => item.id),
  kind: textEnum('kind', MovementKind).notNull(),
  qtyMilli: int('qty_milli').notNull(),
  unitCostUsat: big('unit_cost_usat').notNull(),
  refType: text('ref_type').notNull(),
  refId: text('ref_id').notNull(),
  businessDate: text('business_date').notNull(),
  deviceId: text('device_id').references(() => device.id),
  createdBy: text('created_by').notNull(),      // user id or 'system'
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('stock_movement_item_created_idx').on(t.itemId, t.createdAt),
  index('stock_movement_ref_idx').on(t.refType, t.refId),
  index('stock_movement_item_date_idx').on(t.itemId, t.businessDate),
  index('stock_movement_business_date_idx').on(t.businessDate),
  // D47 item 7: a movement that moves nothing is not a movement.
  check('stock_movement_qty_nonzero_ck', sql`${t.qtyMilli} <> 0`),
])

/** Cache rebuilt from stock_movement; never the source of truth. */
export const itemCostState = sqliteTable('item_cost_state', {
  itemId: text('item_id').primaryKey().references(() => item.id),
  onHandMilli: int('on_hand_milli').notNull(),
  avgCostUsat: big('avg_cost_usat').notNull(),
  asOfMovementId: text('as_of_movement_id'),
  updatedAt: text('updated_at').notNull(),
})
