import { z } from 'zod'

export const ItemKind = z.enum(['raw', 'prepared', 'packaging_set'])
export type ItemKind = z.infer<typeof ItemKind>

export const UseUnit = z.enum(['g', 'ml', 'ชิ้น', 'ชุด'])
export type UseUnit = z.infer<typeof UseUnit>

export const MovementKind = z.enum(['OPENING', 'PURCHASE', 'SALE', 'VOID_RETURN', 'PRODUCE_OUT', 'PRODUCE_IN', 'WASTE', 'EXPIRED', 'COUNT_ADJ', 'TRIAL', 'TRANSFER'])
export type MovementKind = z.infer<typeof MovementKind>

export const OrderStatus = z.enum(['open', 'pending_payment', 'pending_verify', 'paid', 'ready', 'picked_up', 'cancelled', 'rejected', 'voided'])
export type OrderStatus = z.infer<typeof OrderStatus>

export const OrderOrigin = z.enum(['device', 'server'])
export type OrderOrigin = z.infer<typeof OrderOrigin>

export const PaymentMethod = z.enum(['CASH', 'PROMPTPAY'])
export type PaymentMethod = z.infer<typeof PaymentMethod>

export const VerifyStatus = z.enum(['manual', 'verified', 'pending'])
export type VerifyStatus = z.infer<typeof VerifyStatus>

// plan 3 events + block-2 owner remedies of the "ส่งไม่ผ่าน" page (spec 04 §6.4) — all go into the device hash chain.
// Block 3 (spec 04 §6.4): CLOSED_OFF_CATALOG = the owner closed the bill as an off-catalog bill (order_off_catalog) ·
// DELIVERED_ELSEWHERE = dayo already has this bill from another key/device (the row is done, nothing more to send).
export const EventType = z.enum(['CREATED', 'LINE_ADDED', 'LINE_REMOVED', 'DISCOUNT_APPLIED', 'PAYMENT_CLAIMED', 'PAID', 'READY', 'PICKED_UP', 'CANCELLED', 'REJECTED', 'VOIDED', 'STOCK_DEDUCTED', 'STOCK_RETURNED', 'NOTE', 'RECEIPT_RENUMBERED', 'CODE_REMAPPED', 'STAFF_REMAPPED', 'EXCLUDED_FROM_SYNC', 'CLOSED_OFF_CATALOG', 'DELIVERED_ELSEWHERE'])
export type EventType = z.infer<typeof EventType>

export const ActorType = z.enum(['user', 'customer', 'system'])
export type ActorType = z.infer<typeof ActorType>

// spec 04 §7 ข้อ 6: roles come from dayo staff.role
export const UserRole = z.enum(['owner', 'manager', 'staff'])
export type UserRole = z.infer<typeof UserRole>

/**
 * stock_adjustment.reason_code (spec §5 ปรับสต็อก · D50 Q3-20 · plan 4 T4-1): why stock left without a sale.
 * The stock_movement rows keep the 11 kinds of D39 — GIVEAWAY and OTHER are WASTE movements.
 */
export const AdjustReason = z.enum(['WASTE', 'EXPIRED', 'TRIAL', 'GIVEAWAY', 'OTHER'])
export type AdjustReason = z.infer<typeof AdjustReason>

/**
 * shift.status (ruling R2 · D101): open → counting → counted → closed, forward only (DB trigger on the tablet).
 * `counting` = the drawer count has started: no more bills or cash movements · `counted` = the count is saved
 * (shift.counted_at set once) · `closed` = the Z is written.
 */
export const ShiftStatus = z.enum(['open', 'counting', 'counted', 'closed'])
export type ShiftStatus = z.infer<typeof ShiftStatus>

/**
 * shift.sync_mode (ruling R1): `central` = the shift and its cash rows go to dayo (shift lane) · `local_only` = never
 * sent — every shift that existed before block 3, and shifts opened while dayo could not take shift kinds.
 */
export const ShiftSyncMode = z.enum(['central', 'local_only'])
export type ShiftSyncMode = z.infer<typeof ShiftSyncMode>

export const CountStatus = z.enum(['open', 'closed'])
export type CountStatus = z.infer<typeof CountStatus>

/**
 * cash_movement.kind (spec §3.5, D36). PAID_IN / PAID_OUT / DROP are entered by a person;
 * VOID_REFUND is written automatically when a cash-paid order is voided (spec §4.3) and is never entered by hand.
 */
export const CashMovementKind = z.enum(['PAID_IN', 'PAID_OUT', 'DROP', 'VOID_REFUND'])
export type CashMovementKind = z.infer<typeof CashMovementKind>

/**
 * outbox.status on the device (spec 04 §6.1). `pending` = waiting or retrying · `sent` = dayo accepted it (or answered
 * duplicate) · `dead` = on the "ส่งไม่ผ่าน" page (rejected, STUCK, ENVELOPE, PARENT_REJECTED) — never retried
 * automatically, the owner presses "ลองใหม่" · `local_only` = never sent: rows of the plan-3/4 format, shift/cash rows
 * of block 2, and rows the owner closed as "นอกระบบกลาง" · `closed_off_catalog` (block 3, spec 04 §6.1) = the order row
 * the owner closed as an off-catalog bill — its `order_off_catalog` row carries it now, this one is never sent again.
 */
export const OutboxStatus = z.enum(['pending', 'sent', 'dead', 'local_only', 'closed_off_catalog'])
export type OutboxStatus = z.infer<typeof OutboxStatus>
