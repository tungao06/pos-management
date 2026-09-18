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

export const EventType = z.enum(['CREATED', 'LINE_ADDED', 'LINE_REMOVED', 'DISCOUNT_APPLIED', 'PAYMENT_CLAIMED', 'PAID', 'READY', 'PICKED_UP', 'CANCELLED', 'REJECTED', 'VOIDED', 'STOCK_DEDUCTED', 'STOCK_RETURNED', 'NOTE'])
export type EventType = z.infer<typeof EventType>

export const ActorType = z.enum(['user', 'customer', 'system'])
export type ActorType = z.infer<typeof ActorType>

export const UserRole = z.enum(['owner', 'staff'])
export type UserRole = z.infer<typeof UserRole>

export const ShiftStatus = z.enum(['open', 'closed'])
export type ShiftStatus = z.infer<typeof ShiftStatus>

export const CountStatus = z.enum(['open', 'closed'])
export type CountStatus = z.infer<typeof CountStatus>

/**
 * cash_movement.kind (spec §3.5, D36). PAID_IN / PAID_OUT / DROP are entered by a person;
 * VOID_REFUND is written automatically when a cash-paid order is voided (spec §4.3) and is never entered by hand.
 */
export const CashMovementKind = z.enum(['PAID_IN', 'PAID_OUT', 'DROP', 'VOID_REFUND'])
export type CashMovementKind = z.infer<typeof CashMovementKind>

/**
 * outbox.status on the device (spec §6.1). `pending` = waiting or retrying · `sent` = the server accepted it ·
 * `dead` = the server rejected it for good (dead-letter, shown on the settings screen, never retried automatically).
 */
export const OutboxStatus = z.enum(['pending', 'sent', 'dead'])
export type OutboxStatus = z.infer<typeof OutboxStatus>
