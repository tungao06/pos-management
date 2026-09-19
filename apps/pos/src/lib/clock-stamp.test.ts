import { describe, expect, it } from 'vitest'
import { bangkokStamp, isShiftStale, STALE_SHIFT_CUTOFF_HOURS } from './clock'

describe('bangkokStamp', () => {
  it('formats the Thai local date and time for file names', () => {
    expect(bangkokStamp('2026-09-17T03:00:00.000Z')).toBe('20260917-100000')
    expect(bangkokStamp('2026-09-17T17:00:00.000Z')).toBe('20260918-000000') // midnight is 00, not 24
  })
})

describe('isShiftStale (Q3b-8 · D52)', () => {
  it('after-midnight sales stay on the same business day until 05:00 Thai time (spec §4.7)', () => {
    expect(STALE_SHIFT_CUTOFF_HOURS).toBe(5)
    expect(isShiftStale('2026-09-17', '2026-09-17T16:59:00.000Z')).toBe(false) // 23:59 on the 17th
    expect(isShiftStale('2026-09-17', '2026-09-17T21:59:00.000Z')).toBe(false) // 04:59 on the 18th
    expect(isShiftStale('2026-09-17', '2026-09-17T22:00:00.000Z')).toBe(true) // 05:00 on the 18th
    expect(isShiftStale('2026-09-17', '2026-09-20T03:00:00.000Z')).toBe(true)
  })
})
