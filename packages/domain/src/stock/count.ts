import { assertSafeInt, costSatang, roundDiv } from '../money.js'
import type { MovementDraft } from './movements.js'

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
  assertSafeInt(i.qtyPerUnitMilli, 'qtyPerUnitMilli')
  const countedUseMilli = roundDiv(i.countedUnitsMilli * i.qtyPerUnitMilli, 1_000)
  const varianceUseMilli = countedUseMilli - i.expectedUseMilli
  return { ...i, countedUseMilli, varianceUseMilli, varianceSatang: costSatang(varianceUseMilli, i.avgCostUsat) }
}

export function countAdjustmentMovements(lines: readonly CountLineResult[], countId: string): MovementDraft[] {
  return lines
    .filter((l) => l.varianceUseMilli !== 0)
    .map((l) => ({ itemId: l.itemId, kind: 'COUNT_ADJ' as const, qtyMilli: l.varianceUseMilli, unitCostUsat: l.avgCostUsat, refType: 'stock_count', refId: countId }))
}
