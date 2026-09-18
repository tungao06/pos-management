import { ActorType, CashMovementKind, EventType, OrderOrigin, OrderStatus, PaymentMethod, ShiftStatus, VerifyStatus } from '@dayo/contracts'
import { index, pgTable, unique } from 'drizzle-orm/pg-core'
import { id, int, json, serverReceivedAt, serverSeq, text, textEnum } from './columns.js'
import { channel, customer, device, productVariant, recipe, sweetnessLevel, user } from './reference.js'

export const shift = pgTable('shift', {
  id: id(),
  deviceId: text('device_id').notNull().references(() => device.id),
  businessDate: text('business_date').notNull(),
  status: textEnum('status', ShiftStatus).notNull(),
  openedBy: text('opened_by').notNull().references(() => user.id),
  openedAt: text('opened_at').notNull(),
  openingFloatSatang: int('opening_float_satang').notNull(),
  closedBy: text('closed_by').references(() => user.id),
  closedAt: text('closed_at'),
  serverReceivedAt: serverReceivedAt(),
})

export const cashMovement = pgTable('cash_movement', {
  id: id(),
  shiftId: text('shift_id').notNull().references(() => shift.id),
  kind: textEnum('kind', CashMovementKind).notNull(),                     // CashMovementKind: PAID_IN | PAID_OUT | DROP | VOID_REFUND (D36)
  amountSatang: int('amount_satang').notNull(),     // always > 0; the kind gives the direction
  orderId: text('order_id').references(() => order.id), // the voided order for VOID_REFUND; null for the other kinds
  reason: text('reason'),
  createdBy: text('created_by').notNull().references(() => user.id),
  createdAt: text('created_at').notNull(),
  serverReceivedAt: serverReceivedAt(),
}, (t) => [index('cash_movement_shift_idx').on(t.shiftId), index('cash_movement_order_idx').on(t.orderId)])

export const cashCount = pgTable('cash_count', {
  id: id(),
  shiftId: text('shift_id').notNull().references(() => shift.id),
  countedSatang: int('counted_satang').notNull(),
  expectedSatang: int('expected_satang').notNull(),
  varianceSatang: int('variance_satang').notNull(),
  reason: text('reason'),
  linesJson: json('lines_json').notNull(),          // [{ denominationSatang, count }]
  countedBy: text('counted_by').notNull().references(() => user.id),
  createdAt: text('created_at').notNull(),
  serverReceivedAt: serverReceivedAt(),
}, (t) => [index('cash_count_shift_idx').on(t.shiftId)])

export const zReport = pgTable('z_report', {
  id: id(),
  shiftId: text('shift_id').notNull().unique().references(() => shift.id),
  snapshotJson: json('snapshot_json').notNull(),    // ZSnapshot from @dayo/domain
  hash: text('hash').notNull(),
  createdAt: text('created_at').notNull(),
  serverReceivedAt: serverReceivedAt(),
})

export const order = pgTable('order', {
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
  serverReceivedAt: serverReceivedAt(),
  serverSeq: serverSeq(),
}, (t) => [
  unique().on(t.deviceId, t.receiptNo),
  index('order_business_date_status_idx').on(t.businessDate, t.status),
  index('order_status_idx').on(t.status),
  index('order_shift_idx').on(t.shiftId),
])

export const orderLine = pgTable('order_line', {
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
  serverReceivedAt: serverReceivedAt(),
  serverSeq: serverSeq(),
}, (t) => [unique().on(t.orderId, t.lineNo)])

export const payment = pgTable('payment', {
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
  serverReceivedAt: serverReceivedAt(),
  serverSeq: serverSeq(),
}, (t) => [index('payment_order_idx').on(t.orderId)])

export const discount = pgTable('discount', {
  id: id(),
  orderId: text('order_id').notNull().references(() => order.id),
  amountSatang: int('amount_satang').notNull(),
  reason: text('reason').notNull(),
  approvedBy: text('approved_by').notNull().references(() => user.id),
  serverReceivedAt: serverReceivedAt(),
}, (t) => [index('discount_order_idx').on(t.orderId)])

/** Append-only, hash-chained (spec §3.4, §4.9, D38). Every column from order_id to at is covered by `hash`. */
export const orderEvent = pgTable('order_event', {
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
  serverReceivedAt: serverReceivedAt(),
  serverSeq: serverSeq(),
}, (t) => [unique().on(t.orderId, t.seq), unique().on(t.chainId, t.chainSeq)])

export const orderPaymentIntent = pgTable('order_payment_intent', {
  id: id(),
  orderId: text('order_id').notNull().references(() => order.id),
  promptpayPayload: text('promptpay_payload').notNull(),
  amountSatang: int('amount_satang').notNull(),
  expiresAt: text('expires_at').notNull(),
  slipImageRef: text('slip_image_ref'),
  customerClaimedAt: text('customer_claimed_at'),
  serverReceivedAt: serverReceivedAt(),
}, (t) => [index('order_payment_intent_order_idx').on(t.orderId)])
