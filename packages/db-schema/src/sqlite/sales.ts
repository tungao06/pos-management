import { sql } from 'drizzle-orm'
import { ActorType, CashMovementKind, EventType, OrderOrigin, OrderStatus, PaymentMethod, ShiftStatus, VerifyStatus } from '@dayo/contracts'
import { check, index, sqliteTable, unique, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { id, int, json, text, textEnum } from './columns.js'
import { channel, customer, device, productVariant, recipe, sweetnessLevel, user } from './reference.js'

export const shift = sqliteTable('shift', {
  id: id(),
  deviceId: text('device_id').notNull().references(() => device.id),
  businessDate: text('business_date').notNull(),
  status: textEnum('status', ShiftStatus).notNull(),
  openedBy: text('opened_by').notNull().references(() => user.id),
  openedAt: text('opened_at').notNull(),
  openingFloatSatang: int('opening_float_satang').notNull(),
  closedBy: text('closed_by').references(() => user.id),
  closedAt: text('closed_at'),
}, (t) => [
  // D47 item 6: at most one open shift per device.
  uniqueIndex('shift_open_uq').on(t.deviceId).where(sql`status = 'open'`),
])

export const cashMovement = sqliteTable('cash_movement', {
  id: id(),
  shiftId: text('shift_id').notNull().references(() => shift.id),
  kind: textEnum('kind', CashMovementKind).notNull(),                     // CashMovementKind: PAID_IN | PAID_OUT | DROP | VOID_REFUND (D36)
  amountSatang: int('amount_satang').notNull(),     // always > 0; the kind gives the direction
  orderId: text('order_id').references(() => order.id), // the voided order for VOID_REFUND; null for the other kinds
  reason: text('reason'),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('cash_movement_shift_idx').on(t.shiftId),
  index('cash_movement_order_idx').on(t.orderId),
  // D47 item 7: VOID_REFUND always carries the voided order_id; no other kind does.
  check('cash_movement_void_refund_order_ck', sql`(${t.kind} = 'VOID_REFUND') = (${t.orderId} is not null)`),
  check('cash_movement_amount_positive_ck', sql`${t.amountSatang} > 0`),
])

export const cashCount = sqliteTable('cash_count', {
  id: id(),
  shiftId: text('shift_id').notNull().references(() => shift.id),
  countedSatang: int('counted_satang').notNull(),
  expectedSatang: int('expected_satang').notNull(),
  varianceSatang: int('variance_satang').notNull(),
  reason: text('reason'),
  linesJson: json('lines_json').notNull(),          // [{ denominationSatang, count }]
  countedBy: text('counted_by').notNull().references(() => user.id),
  createdAt: text('created_at').notNull(),
}, (t) => [index('cash_count_shift_idx').on(t.shiftId)])

export const zReport = sqliteTable('z_report', {
  id: id(),
  shiftId: text('shift_id').notNull().unique().references(() => shift.id),
  snapshotJson: json('snapshot_json').notNull(),    // ZSnapshot from @dayo/domain
  hash: text('hash').notNull(),
  createdAt: text('created_at').notNull(),
})

export const order = sqliteTable('order', {
  id: id(),
  origin: textEnum('origin', OrderOrigin).notNull(),
  deviceId: text('device_id').references(() => device.id),
  receiptNo: text('receipt_no'),
  queueNo: int('queue_no'),
  businessDate: text('business_date').notNull(),
  shiftId: text('shift_id').references(() => shift.id),
  channelId: text('channel_id').notNull().references(() => channel.id),
  customerId: text('customer_id').references(() => customer.id),
  status: textEnum('status', OrderStatus).notNull(),
  subtotalSatang: int('subtotal_satang').notNull(),
  discountSatang: int('discount_satang').notNull(),
  totalSatang: int('total_satang').notNull(),
  vatSatang: int('vat_satang').notNull(),
  costSatang: int('cost_satang').notNull(),
  note: text('note'),
  createdByType: textEnum('created_by_type', ActorType).notNull(),
  createdById: text('created_by_id').notNull(),
  createdAt: text('created_at').notNull(),
  paidAt: text('paid_at'),
  readyAt: text('ready_at'),
  voidedAt: text('voided_at'),
}, (t) => [
  unique().on(t.deviceId, t.receiptNo),
  // D47 item 5: the queue number is unique per device per business day (not globally).
  unique().on(t.deviceId, t.businessDate, t.queueNo),
  index('order_business_date_status_idx').on(t.businessDate, t.status),
  index('order_status_idx').on(t.status),
  index('order_shift_idx').on(t.shiftId),
  // D47 item 7: totals are never negative, and the discount never exceeds the subtotal it applies to.
  check('order_subtotal_nonneg_ck', sql`${t.subtotalSatang} >= 0`),
  check('order_discount_nonneg_ck', sql`${t.discountSatang} >= 0`),
  check('order_total_nonneg_ck', sql`${t.totalSatang} >= 0`),
  check('order_discount_le_subtotal_ck', sql`${t.discountSatang} <= ${t.subtotalSatang}`),
])

export const orderLine = sqliteTable('order_line', {
  id: id(),
  orderId: text('order_id').notNull().references(() => order.id),
  lineNo: int('line_no').notNull(),
  variantId: text('variant_id').notNull().references(() => productVariant.id),
  sweetnessId: text('sweetness_id').notNull().references(() => sweetnessLevel.id),
  recipeId: text('recipe_id').references(() => recipe.id),
  productName: text('product_name').notNull(),
  sizeName: text('size_name').notNull(),
  sweetnessName: text('sweetness_name').notNull(),
  unitPriceSatang: int('unit_price_satang').notNull(),
  qty: int('qty').notNull(),
  lineTotalSatang: int('line_total_satang').notNull(),
  unitCostSatang: int('unit_cost_satang').notNull(),
}, (t) => [
  unique().on(t.orderId, t.lineNo),
  check('order_line_qty_positive_ck', sql`${t.qty} > 0`),
])

export const payment = sqliteTable('payment', {
  id: id(),
  orderId: text('order_id').notNull().references(() => order.id),
  method: textEnum('method', PaymentMethod).notNull(),
  amountSatang: int('amount_satang').notNull(),
  tenderedSatang: int('tendered_satang'),
  changeSatang: int('change_satang'),
  reference: text('reference'),
  verifyStatus: textEnum('verify_status', VerifyStatus).notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('payment_order_idx').on(t.orderId),
  check('payment_amount_positive_ck', sql`${t.amountSatang} > 0`),
])

export const discount = sqliteTable('discount', {
  id: id(),
  orderId: text('order_id').notNull().references(() => order.id),
  amountSatang: int('amount_satang').notNull(),
  reason: text('reason').notNull(),
  approvedBy: text('approved_by').notNull().references(() => user.id),
}, (t) => [index('discount_order_idx').on(t.orderId)])

/** Append-only, hash-chained (spec §3.4, §4.9, D38). Every column from order_id to at is covered by `hash`. */
export const orderEvent = sqliteTable('order_event', {
  id: id(),
  orderId: text('order_id').notNull().references(() => order.id),
  seq: int('seq').notNull(),                        // 1, 2, 3, … per order (EventCore.seq)
  deviceId: text('device_id').references(() => device.id), // null when the server wrote the event (EventCore.deviceId)
  chainId: text('chain_id').notNull(),              // device id or 'server' (EventCore.chainId)
  chainSeq: int('chain_seq').notNull(),             // 1, 2, 3, … per chain, gap-free (EventCore.chainSeq)
  type: textEnum('type', EventType).notNull(),
  payloadJson: json('payload_json').notNull(),
  actorType: textEnum('actor_type', ActorType).notNull(),
  actorId: text('actor_id').notNull(),
  at: text('at').notNull(),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),
}, (t) => [unique().on(t.orderId, t.seq), unique().on(t.chainId, t.chainSeq)])

export const orderPaymentIntent = sqliteTable('order_payment_intent', {
  id: id(),
  orderId: text('order_id').notNull().references(() => order.id),
  promptpayPayload: text('promptpay_payload').notNull(),
  amountSatang: int('amount_satang').notNull(),
  expiresAt: text('expires_at').notNull(),
  slipImageRef: text('slip_image_ref'),
  customerClaimedAt: text('customer_claimed_at'),
}, (t) => [index('order_payment_intent_order_idx').on(t.orderId)])
