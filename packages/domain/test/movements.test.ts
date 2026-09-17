import { describe, expect, it } from 'vitest'
import { costSatang } from '../src/money.js'
import { lineUnitCostSatang, needsCostSatang, saleMovements, voidReturnMovements } from '../src/stock/movements.js'

const costOf = (id: string) => ({ 'PB-TEA-THAI': 1_992_500, 'RM-MLK-02': 7_407_407 })[id] ?? 0

describe('saleMovements', () => {
  it('creates one negative SALE movement per need at current cost', () => {
    const needs = new Map([['PB-TEA-THAI', 130_000], ['RM-MLK-02', 46_000]])
    expect(saleMovements(needs, costOf, 'o1')).toEqual([
      { itemId: 'PB-TEA-THAI', kind: 'SALE', qtyMilli: -130_000, unitCostUsat: 1_992_500, refType: 'order', refId: 'o1' },
      { itemId: 'RM-MLK-02', kind: 'SALE', qtyMilli: -46_000, unitCostUsat: 7_407_407, refType: 'order', refId: 'o1' },
    ])
  })
  it('skips zero needs', () => {
    expect(saleMovements(new Map([['RM-MLK-02', 0]]), costOf, 'o1')).toEqual([])
  })
})

describe('voidReturnMovements', () => {
  it('mirrors sale movements with positive qty and the same unit cost', () => {
    const sale = saleMovements(new Map([['PB-TEA-THAI', 130_000]]), costOf, 'o1')
    expect(voidReturnMovements(sale, 'o1')).toEqual([
      { itemId: 'PB-TEA-THAI', kind: 'VOID_RETURN', qtyMilli: 130_000, unitCostUsat: 1_992_500, refType: 'order', refId: 'o1' },
    ])
  })
})

describe('needsCostSatang', () => {
  it('sums cost of needs (130 ml base + 46 ml evaporated milk = 2.59 + 3.41 baht)', () => {
    expect(needsCostSatang(new Map([['PB-TEA-THAI', 130_000], ['RM-MLK-02', 46_000]]), costOf)).toBe(259 + 341)
  })

  it('rounds once over the full-precision sum instead of per line (spec §4.2)', () => {
    // Each line alone is exactly 0.5 satang, which costSatang (half-away-from-zero) rounds up to 1.
    // Rounding per line and summing gives 2; rounding the true total (1.0 satang) once gives 1.
    const needs = new Map([['A', 1], ['B', 1]])
    const costOf2 = (id: string) => ({ A: 500_000_000, B: 500_000_000 })[id] ?? 0
    const perLineSum = [...needs].reduce((acc, [id, n]) => acc + costSatang(n, costOf2(id)), 0)
    expect(perLineSum).toBe(2) // the old, wrong behavior
    expect(needsCostSatang(needs, costOf2)).toBe(1) // the fix: round once
  })
})

describe('lineUnitCostSatang', () => {
  it('rounds once over the total, then divides by qty (spec §4.2)', () => {
    const needs = new Map([['A', 1]])
    const costOf2 = (id: string) => ({ A: 10_000_000_000 })[id] ?? 0 // total = 10 satang * 1e9
    expect(needsCostSatang(needs, costOf2)).toBe(10)
    expect(lineUnitCostSatang(needs, costOf2, 3)).toBe(3) // 10 / 3 = 3.33 -> 3, not 10 then divided-and-rerounded elsewhere
  })

  it('differs from rounding per line then dividing (per-line rounding drifts)', () => {
    // Same construction as the needsCostSatang test above: per-line rounding gives 2 satang total for qty 1,
    // but the correct single-rounded total is 1 satang.
    const needs = new Map([['A', 1], ['B', 1]])
    const costOf2 = (id: string) => ({ A: 500_000_000, B: 500_000_000 })[id] ?? 0
    expect(lineUnitCostSatang(needs, costOf2, 1)).toBe(1)
  })

  it('rejects non-positive or unsafe qty', () => {
    const needs = new Map([['A', 1]])
    const costOf2 = (id: string) => ({ A: 1_000_000 })[id] ?? 0
    expect(() => lineUnitCostSatang(needs, costOf2, 0)).toThrow(RangeError)
    expect(() => lineUnitCostSatang(needs, costOf2, -1)).toThrow(RangeError)
    expect(() => lineUnitCostSatang(needs, costOf2, 1.5)).toThrow(RangeError)
  })
})
