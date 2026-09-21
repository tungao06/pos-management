import { assertSafeInt, costSatang } from '../money.js'

/** spec §5 หน้าสต็อก: ปกติ / ใกล้หมด / หมด / ติดลบ. */
export type StockStatus = 'ok' | 'low' | 'out' | 'negative'

/**
 * negative < 0 (allowed — a sale is never blocked, spec §4.2 · D28) · out = 0 · low = at or below the reorder point
 * (only when the item has one, `reorder_point_milli > 0`) · ok otherwise.
 */
export function stockStatus(onHandMilli: number, reorderPointMilli: number): StockStatus {
  assertSafeInt(onHandMilli, 'onHandMilli')
  assertSafeInt(reorderPointMilli, 'reorderPointMilli')
  if (onHandMilli < 0) return 'negative'
  if (onHandMilli === 0) return 'out'
  if (reorderPointMilli > 0 && onHandMilli <= reorderPointMilli) return 'low'
  return 'ok'
}

/** Stock value in satang at the moving average (spec §5 มูลค่า) — stock at or below zero is worth 0, never negative. */
export function stockValueSatang(onHandMilli: number, avgCostUsat: number): number {
  assertSafeInt(onHandMilli, 'onHandMilli')
  return onHandMilli > 0 ? costSatang(onHandMilli, avgCostUsat) : 0
}

/** spec §4.6: production_batch.expires_at = created_at + shelf_life_hours · a base without a shelf life never expires. */
export function batchExpiresAt(createdAtIso: string, shelfLifeHours: number | null): string | null {
  if (shelfLifeHours === null) return null
  assertSafeInt(shelfLifeHours, 'shelfLifeHours')
  if (shelfLifeHours <= 0) throw new RangeError('shelfLifeHours must be > 0')
  const t = Date.parse(createdAtIso)
  if (Number.isNaN(t)) throw new RangeError(`bad createdAt ${createdAtIso}`)
  return new Date(t + shelfLifeHours * 3_600_000).toISOString()
}

/** Minutes before expiry at which a base shows "ใกล้หมดอายุ" (Q4-10). */
export const EXPIRY_SOON_MINUTES = 60

export type ExpiryState = 'none' | 'fresh' | 'soon' | 'expired'

/**
 * Expiry of a base's stock, one lump per base (spec §4.6: no FIFO per batch in phase 1) judged by its latest batch:
 * `none` when nothing is on hand or the base never expires · `expired` from `expiresAt` on · `soon` within
 * `soonMinutes` of it · `fresh` otherwise.
 */
export function expiryState(expiresAtIso: string | null, nowIso: string, onHandMilli: number, soonMinutes: number = EXPIRY_SOON_MINUTES): ExpiryState {
  assertSafeInt(onHandMilli, 'onHandMilli')
  if (expiresAtIso === null || onHandMilli <= 0) return 'none'
  const left = Date.parse(expiresAtIso) - Date.parse(nowIso)
  if (Number.isNaN(left)) throw new RangeError('bad timestamp')
  if (left <= 0) return 'expired'
  return left <= soonMinutes * 60_000 ? 'soon' : 'fresh'
}
