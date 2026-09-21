import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { adjustMovementKind, mergeNeeds, stockOutMovements } from '../src/stock/adjust.js'
import { milliArb } from './arb.js'

const costOf = (id: string): number => ({ 'PB-TEA-THAI': 1_992_500, 'RM-WTR-01': 1_400_000 })[id] ?? 0

describe('adjustMovementKind (D39: the ledger keeps 11 kinds)', () => {
  it('maps each reason to a movement kind; giveaway and other are WASTE', () => {
    expect(adjustMovementKind('WASTE')).toBe('WASTE')
    expect(adjustMovementKind('EXPIRED')).toBe('EXPIRED')
    expect(adjustMovementKind('TRIAL')).toBe('TRIAL')
    expect(adjustMovementKind('GIVEAWAY')).toBe('WASTE')
    expect(adjustMovementKind('OTHER')).toBe('WASTE')
  })
})

describe('stockOutMovements', () => {
  it('one −qty movement per need at the current cost; zero needs skipped', () => {
    const needs = new Map([['PB-TEA-THAI', 130_000], ['RM-WTR-01', 0]])
    expect(stockOutMovements(needs, 'EXPIRED', costOf, { refType: 'stock_adjustment', refId: 'a1' })).toEqual([
      { itemId: 'PB-TEA-THAI', kind: 'EXPIRED', qtyMilli: -130_000, unitCostUsat: 1_992_500, refType: 'stock_adjustment', refId: 'a1' },
    ])
  })
  it('refuses a negative need (stock-out only — gains come from a count, T4-10)', () => {
    expect(() => stockOutMovements(new Map([['x', -1]]), 'WASTE', costOf, { refType: 'stock_adjustment', refId: 'a1' })).toThrow(RangeError)
  })
  it('property: Σ qty out = −Σ needs (nothing created or destroyed)', () => {
    fc.assert(
      fc.property(fc.array(milliArb, { maxLength: 20 }), (qtys) => {
        const needs = new Map(qtys.map((q, i) => [`i${i}`, q]))
        const out = stockOutMovements(needs, 'WASTE', costOf, { refType: 'stock_adjustment', refId: 'a' })
        expect(out.reduce((a, m) => a + m.qtyMilli, 0) + qtys.reduce((a, q) => a + q, 0)).toBe(0)
      }),
    )
  })
})

describe('mergeNeeds', () => {
  it('adds per item, keeping first-seen order', () => {
    const a = new Map([['x', 1], ['y', 2]])
    expect([...mergeNeeds(a, new Map([['y', 3], ['z', 4]]))]).toEqual([['x', 1], ['y', 5], ['z', 4]])
  })
})
