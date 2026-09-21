import { assertSafeInt, costSatang } from '../money.js'
import type { MovementDraft } from './movements.js'
import { unitsToUseMilli } from './purchase.js'

export type CountLineInput = {
  itemId: string
  expectedUseMilli: number
  countedUnitsMilli: number   // e.g. 3.5 bags → 3_500
  qtyPerUnitMilli: number     // e.g. 400 g per bag → 400_000
  avgCostUsat: number
}
export type CountLineResult = CountLineInput & { countedUseMilli: number; varianceUseMilli: number; varianceSatang: number }

export function countLineResult(i: CountLineInput): CountLineResult {
  assertSafeInt(i.expectedUseMilli, 'expectedUseMilli')
  assertSafeInt(i.countedUnitsMilli, 'countedUnitsMilli')
  if (i.countedUnitsMilli < 0) throw new RangeError('countedUnitsMilli must be >= 0')
  const countedUseMilli = unitsToUseMilli(i.countedUnitsMilli, i.qtyPerUnitMilli)
  const varianceUseMilli = countedUseMilli - i.expectedUseMilli
  return { ...i, countedUseMilli, varianceUseMilli, varianceSatang: costSatang(varianceUseMilli, i.avgCostUsat) }
}

/**
 * COUNT_ADJ = counted − expected per line at the line's cost (spec §4.5), only for non-zero variances.
 * Items in `openingItemIds` are counted for the first time: their movement is the opening balance, kind OPENING
 * (D30) — the caller prices those lines at the standard cost (their `avgCostUsat` = standard_cost_usat).
 */
export function countAdjustmentMovements(lines: readonly CountLineResult[], countId: string, openingItemIds: ReadonlySet<string> = new Set()): MovementDraft[] {
  return lines
    .filter((l) => l.varianceUseMilli !== 0)
    .map((l) => ({
      itemId: l.itemId,
      kind: openingItemIds.has(l.itemId) ? ('OPENING' as const) : ('COUNT_ADJ' as const),
      qtyMilli: l.varianceUseMilli,
      unitCostUsat: l.avgCostUsat,
      refType: 'stock_count',
      refId: countId,
    }))
}
