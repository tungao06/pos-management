import { describe, expect, it } from 'vitest'
import { addDaysToDate, bangkokDate } from './clock'

describe('bangkokDate (spec §4.7: business date in Thai time)', () => {
  it('switches date at 17:00 UTC', () => {
    expect(bangkokDate('2026-09-17T16:59:59.999Z')).toBe('2026-09-17')
    expect(bangkokDate('2026-09-17T17:00:00.000Z')).toBe('2026-09-18')
  })
})

describe('addDaysToDate', () => {
  it('moves across month ends', () => {
    expect(addDaysToDate('2026-09-17', -6)).toBe('2026-09-11')
    expect(addDaysToDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysToDate('2026-12-31', 1)).toBe('2027-01-01')
  })
})
