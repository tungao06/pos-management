import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { formatReceiptNo, nextReceiptNo, parseReceiptNo } from '../src/receipt.js'

describe('receipt numbers', () => {
  it('formats with device prefix and 6-digit zero padding', () => {
    expect(formatReceiptNo('A', 1)).toBe('A-000001')
    expect(formatReceiptNo('A', 1042)).toBe('A-001042')
    expect(formatReceiptNo('B', 999999)).toBe('B-999999')
  })
  it('rejects bad prefix or counter', () => {
    expect(() => formatReceiptNo('a', 1)).toThrow(RangeError)
    expect(() => formatReceiptNo('ABCD', 1)).toThrow(RangeError)
    expect(() => formatReceiptNo('A', 0)).toThrow(RangeError)
    expect(() => formatReceiptNo('A', 1_000_000)).toThrow(RangeError)
    expect(() => formatReceiptNo('A', 1.5)).toThrow(RangeError)
  })
  it('round-trips and preserves order', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 999_999 }), fc.integer({ min: 1, max: 999_999 }), (a, b) => {
      expect(parseReceiptNo(formatReceiptNo('A', a))).toEqual({ prefix: 'A', counter: a })
      expect(formatReceiptNo('A', a) < formatReceiptNo('A', b)).toBe(a < b)
    }))
  })
})

describe('nextReceiptNo', () => {
  it('starts at 1 and increments the counter of the same prefix', () => {
    expect(nextReceiptNo('A', null)).toBe('A-000001')
    expect(nextReceiptNo('A', 'A-000041')).toBe('A-000042')
  })
  it('rejects a last receipt from another prefix', () => {
    expect(() => nextReceiptNo('A', 'B-000001')).toThrow(/prefix/)
  })
})
