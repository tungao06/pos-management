import { assertSafeInt } from '../money.js'
import type { CostOf, MovementDraft, MovementKind } from './movements.js'

/**
 * Why stock left without a sale (spec §5 ปรับสต็อก: ของเสีย / หมดอายุ / ทดลองสูตร / อื่น ๆ · D50 Q3-20 แจก/ชดเชย).
 * Same values as contracts `AdjustReason`; domain stays free of the contracts package.
 */
export type AdjustReasonCode = 'WASTE' | 'EXPIRED' | 'TRIAL' | 'GIVEAWAY' | 'OTHER'

/**
 * Movement kind for each reason. The ledger keeps its 11 kinds (D39): a giveaway and "other" are WASTE movements —
 * `stock_adjustment.reason_code` keeps them apart for reports (T4-1 · Q4-8).
 */
export function adjustMovementKind(code: AdjustReasonCode): MovementKind {
  switch (code) {
    case 'WASTE':
    case 'GIVEAWAY':
    case 'OTHER':
      return 'WASTE'
    case 'EXPIRED':
      return 'EXPIRED'
    case 'TRIAL':
      return 'TRIAL'
  }
}

/**
 * Stock-out movements (−qty) of `needs` (itemId → milli > 0) at `costOf` — the same shape as `saleMovements`, for a
 * kind other than SALE. Zero needs are skipped (DB CHECK qty <> 0 · D47 item 7); a negative need is refused.
 */
export function stockOutMovements(needs: ReadonlyMap<string, number>, kind: MovementKind, costOf: CostOf, ref: { refType: string; refId: string }): MovementDraft[] {
  const out: MovementDraft[] = []
  for (const [itemId, need] of needs) {
    assertSafeInt(need, 'need')
    if (need < 0) throw new RangeError(`need of ${itemId} must be >= 0`)
    if (need === 0) continue
    out.push({ itemId, kind, qtyMilli: -need, unitCostUsat: costOf(itemId), refType: ref.refType, refId: ref.refId })
  }
  return out
}

/** Adds `b` into `a` (itemId → milli), keeping insertion order; returns `a`. */
export function mergeNeeds(a: Map<string, number>, b: ReadonlyMap<string, number>): Map<string, number> {
  for (const [itemId, milli] of b) {
    assertSafeInt(milli, 'milli')
    a.set(itemId, (a.get(itemId) ?? 0) + milli)
  }
  return a
}
