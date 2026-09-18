import { describe, expect, it } from 'vitest'
import { cashChangeSatang, quickTenderOptions } from '../src/payment.js'

describe('cashChangeSatang', () => {
  it('returns tendered − total', () => {
    expect(cashChangeSatang(4500, 10000)).toBe(5500)
    expect(cashChangeSatang(4500, 4500)).toBe(0)
  })
  it('rejects tender below total', () => {
    expect(() => cashChangeSatang(4500, 4000)).toThrow(/less than total/)
  })
})

describe('quickTenderOptions (spec §5: exact / 50 / 100 / 500 / 1000)', () => {
  it('exact first, then banknotes above the total', () => {
    expect(quickTenderOptions(4500)).toEqual([4500, 5000, 10000, 50000, 100000])
    expect(quickTenderOptions(9000)).toEqual([9000, 10000, 50000, 100000])
  })
  it('does not repeat a banknote equal to the total', () => {
    expect(quickTenderOptions(5000)).toEqual([5000, 10000, 50000, 100000])
  })
  it('keeps only exact when the total is above 1000 baht', () => {
    expect(quickTenderOptions(120000)).toEqual([120000])
  })
})
