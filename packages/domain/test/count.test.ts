import { describe, expect, it } from 'vitest'
import { countAdjustmentMovements, countLineResult } from '../src/stock/count.js'

describe('countLineResult', () => {
  it('converts 3.5 bags of 400 g tea to 1,400 g and prices the shortage', () => {
    const r = countLineResult({ itemId: 'RM-TEA-01', expectedUseMilli: 1_500_000, countedUnitsMilli: 3_500, qtyPerUnitMilli: 400_000, avgCostUsat: 19_250_000 })
    expect(r.countedUseMilli).toBe(1_400_000)
    expect(r.varianceUseMilli).toBe(-100_000)
    expect(r.varianceSatang).toBe(-1925) // −19.25 baht
  })
  it('zero variance when counted equals expected', () => {
    const r = countLineResult({ itemId: 'x', expectedUseMilli: 50_000, countedUnitsMilli: 1_000, qtyPerUnitMilli: 50_000, avgCostUsat: 200_000_000 })
    expect(r.varianceUseMilli).toBe(0)
    expect(r.varianceSatang).toBe(0)
  })
})

describe('countAdjustmentMovements', () => {
  it('emits COUNT_ADJ only for non-zero variances at average cost', () => {
    const lines = [
      countLineResult({ itemId: 'a', expectedUseMilli: 100, countedUnitsMilli: 100_000, qtyPerUnitMilli: 1_000, avgCostUsat: 5 }),
      countLineResult({ itemId: 'b', expectedUseMilli: 100, countedUnitsMilli: 100, qtyPerUnitMilli: 1_000, avgCostUsat: 5 }),
    ]
    expect(countAdjustmentMovements(lines, 'c1')).toEqual([
      { itemId: 'a', kind: 'COUNT_ADJ', qtyMilli: 99_900, unitCostUsat: 5, refType: 'stock_count', refId: 'c1' },
    ])
  })
})

describe('countLineResult — bad input', () => {
  it('refuses a negative count and a zero unit size', () => {
    expect(() => countLineResult({ itemId: 'x', expectedUseMilli: 0, countedUnitsMilli: -1, qtyPerUnitMilli: 1_000, avgCostUsat: 1 })).toThrow(RangeError)
    expect(() => countLineResult({ itemId: 'x', expectedUseMilli: 0, countedUnitsMilli: 1_000, qtyPerUnitMilli: 0, avgCostUsat: 1 })).toThrow(RangeError)
  })
})

describe('countAdjustmentMovements — opening balance (D30)', () => {
  it('an item counted for the first time gets OPENING at the cost its line carries; the rest COUNT_ADJ', () => {
    const first = countLineResult({ itemId: 'RM-TEA-01', expectedUseMilli: -120_000, countedUnitsMilli: 2_000, qtyPerUnitMilli: 400_000, avgCostUsat: 19_250_000 })
    const again = countLineResult({ itemId: 'RM-MLK-02', expectedUseMilli: 500_000, countedUnitsMilli: 1_000, qtyPerUnitMilli: 405_000, avgCostUsat: 7_000_000 })
    expect(countAdjustmentMovements([first, again], 'c1', new Set(['RM-TEA-01']))).toEqual([
      { itemId: 'RM-TEA-01', kind: 'OPENING', qtyMilli: 920_000, unitCostUsat: 19_250_000, refType: 'stock_count', refId: 'c1' },
      { itemId: 'RM-MLK-02', kind: 'COUNT_ADJ', qtyMilli: -95_000, unitCostUsat: 7_000_000, refType: 'stock_count', refId: 'c1' },
    ])
  })
})
