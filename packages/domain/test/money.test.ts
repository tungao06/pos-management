import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { bahtToSatang, bahtToUsat, costSatang, roundDiv, roundDivBig, splitLargestRemainder } from '../src/money.js'
import { milliArb, satangArb, usatArb } from './arb.js'

describe('roundDivBig', () => {
  it('rounds half away from zero', () => {
    expect(roundDivBig(5n, 2n)).toBe(3n)
    expect(roundDivBig(-5n, 2n)).toBe(-3n)
    expect(roundDivBig(4n, 2n)).toBe(2n)
    expect(roundDivBig(7n, 3n)).toBe(2n)
    expect(roundDivBig(0n, 3n)).toBe(0n)
  })
  it('throws on zero denominator', () => {
    expect(() => roundDivBig(1n, 0n)).toThrow(RangeError)
  })
  it('matches Math.round for positive numbers', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 1, max: 1e6 }), (a, b) => {
      expect(roundDiv(a, b)).toBe(Math.round(a / b))
    }))
  })
})

describe('baht conversions', () => {
  it('converts prices from the Excel file exactly', () => {
    expect(bahtToSatang(45)).toBe(4500)
    expect(bahtToSatang(69)).toBe(6900)
    expect(bahtToUsat(0.019925)).toBe(1_992_500)
    expect(bahtToUsat(77 / 400)).toBe(19_250_000)
    expect(bahtToUsat(4.4)).toBe(440_000_000)
  })
})

describe('costSatang', () => {
  it('computes cost of 130 ml Thai tea base at 0.019925 baht/ml = 2.59 baht', () => {
    expect(costSatang(130_000, 1_992_500)).toBe(259)
  })
  it('is zero for zero quantity or zero cost', () => {
    expect(costSatang(0, 1_992_500)).toBe(0)
    expect(costSatang(130_000, 0)).toBe(0)
  })
  it('never loses precision in the product (uses BigInt)', () => {
    fc.assert(fc.property(milliArb, usatArb, (q, c) => {
      const exact = (BigInt(q) * BigInt(c))
      const expected = Number(roundDivBig(exact, 1_000_000_000n))
      expect(costSatang(q, c)).toBe(expected)
    }))
  })
  it('rejects non-integers', () => {
    expect(() => costSatang(1.5, 1)).toThrow(RangeError)
  })
})

describe('splitLargestRemainder', () => {
  it('splits exactly with sum preserved', () => {
    expect(splitLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(splitLargestRemainder(7, [50, 50])).toEqual([4, 3])
    expect(splitLargestRemainder(0, [5, 5])).toEqual([0, 0])
  })
  it('returns [] for no weights and gives all to first when weights are all zero', () => {
    expect(splitLargestRemainder(10, [])).toEqual([])
    expect(splitLargestRemainder(10, [0, 0])).toEqual([10, 0])
  })
  it('always sums to total and every part is >= 0', () => {
    fc.assert(fc.property(satangArb, fc.array(satangArb, { minLength: 1, maxLength: 20 }), (total, weights) => {
      const parts = splitLargestRemainder(total, weights)
      expect(parts.length).toBe(weights.length)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
      for (const p of parts) expect(p).toBeGreaterThanOrEqual(0)
    }))
  })
})
