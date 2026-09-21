import { describe, expect, it } from 'vitest'
import { batchExpiresAt, expiryState, stockStatus, stockValueSatang } from '../src/stock/levels.js'

describe('stockStatus (spec §5: ปกติ / ใกล้หมด / หมด / ติดลบ)', () => {
  it('negative, out, low at or below the reorder point, ok above it', () => {
    expect(stockStatus(-1, 400_000)).toBe('negative')
    expect(stockStatus(0, 400_000)).toBe('out')
    expect(stockStatus(400_000, 400_000)).toBe('low')
    expect(stockStatus(1, 400_000)).toBe('low')
    expect(stockStatus(400_001, 400_000)).toBe('ok')
  })
  it('an item without a reorder point (bases: 0) is never "low"', () => {
    expect(stockStatus(1, 0)).toBe('ok')
    expect(stockStatus(0, 0)).toBe('out')
  })
})

describe('stockValueSatang', () => {
  it('on hand × average cost; nothing or negative on hand is worth 0', () => {
    expect(stockValueSatang(1_400_000, 19_250_000)).toBe(26_950)
    expect(stockValueSatang(0, 19_250_000)).toBe(0)
    expect(stockValueSatang(-130_000, 2_000_000)).toBe(0)
  })
})

describe('batchExpiresAt / expiryState (spec §4.6)', () => {
  it('created_at + shelf_life_hours; no shelf life = never expires', () => {
    expect(batchExpiresAt('2026-09-17T03:00:00.000Z', 4)).toBe('2026-09-17T07:00:00.000Z')
    expect(batchExpiresAt('2026-09-17T03:00:00.000Z', null)).toBeNull()
    expect(() => batchExpiresAt('2026-09-17T03:00:00.000Z', 0)).toThrow(RangeError)
  })
  it('expired from the expiry instant on, "soon" within 60 minutes, none when nothing is on hand', () => {
    const exp = '2026-09-17T07:00:00.000Z'
    expect(expiryState(exp, '2026-09-17T05:59:59.000Z', 1_000)).toBe('fresh')
    expect(expiryState(exp, '2026-09-17T06:00:00.000Z', 1_000)).toBe('soon')
    expect(expiryState(exp, '2026-09-17T07:00:00.000Z', 1_000)).toBe('expired')
    expect(expiryState(exp, '2026-09-18T07:00:00.000Z', 0)).toBe('none')
    expect(expiryState(exp, '2026-09-18T07:00:00.000Z', -5)).toBe('none')
    expect(expiryState(null, '2026-09-18T07:00:00.000Z', 1_000)).toBe('none')
  })
})
