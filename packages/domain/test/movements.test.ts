import { describe, expect, it } from 'vitest'
import { needsCostSatang, saleMovements, voidReturnMovements } from '../src/stock/movements.js'

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
})
