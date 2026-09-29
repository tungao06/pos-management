import { describe, expect, it } from 'vitest'
import { isCentralZBlockedError, isClockAheadCountError, PosError, posErrorCode } from './errors'

describe('PosError', () => {
  it('prefixes the message with the code so it survives the Worker boundary', () => {
    const e = new PosError('NO_OPEN_SHIFT', 'open a shift first')
    expect(e.message).toBe('NO_OPEN_SHIFT: open a shift first')
    expect(posErrorCode(e)).toBe('NO_OPEN_SHIFT')
    expect(posErrorCode(new Error(e.message))).toBe('NO_OPEN_SHIFT')
    expect(posErrorCode(new Error('NO_PRICE: variant x'))).toBe('NO_PRICE')
    expect(posErrorCode(new Error('discount exceeds subtotal'))).toBeNull()
    expect(posErrorCode('nope')).toBeNull()
  })
})

describe('isClockAheadCountError', () => {
  it('matches only BAD_INPUT CLOCK_AHEAD:, never a lookalike or another BAD_INPUT', () => {
    expect(isClockAheadCountError(new PosError('BAD_INPUT', 'CLOCK_AHEAD: นาฬิกาล้ำเวลาจริง'))).toBe(true)
    expect(isClockAheadCountError(new PosError('BAD_INPUT', 'COUNT_BEFORE_CENTRAL_Z: x'))).toBe(false)
    expect(isClockAheadCountError(new PosError('Z_TOO_LARGE', 'x'))).toBe(false)
    expect(isClockAheadCountError(new Error('nope'))).toBe(false)
  })
})

describe('isCentralZBlockedError (fix round 1 item 1a)', () => {
  it('DAYO_BAD_RESPONSE and Z_TOO_LARGE are permanent central-Z blocks', () => {
    expect(isCentralZBlockedError(new PosError('DAYO_BAD_RESPONSE', 'x'))).toBe(true)
    expect(isCentralZBlockedError(new PosError('Z_TOO_LARGE', 'x'))).toBe(true)
  })
  it('BAD_INPUT COUNT_BEFORE_CENTRAL_Z: and an unprefixed builder RangeError message both count', () => {
    expect(isCentralZBlockedError(new PosError('BAD_INPUT', 'COUNT_BEFORE_CENTRAL_Z: การนับนี้เกิดก่อน Z ล่าสุด'))).toBe(true)
    expect(isCentralZBlockedError(new PosError('BAD_INPUT', 'closedAt must be after countedAt'))).toBe(true)
  })
  it('excludes CLOCK_AHEAD (its own remedy is skipCountFloor, not keepShiftLocal)', () => {
    expect(isCentralZBlockedError(new PosError('BAD_INPUT', 'CLOCK_AHEAD: นาฬิกาล้ำเวลาจริง'))).toBe(false)
  })
  it('excludes every other code (Z_CHAIN_BROKEN, SHIFT_CHANGED, OFFLINE, …)', () => {
    for (const code of ['Z_CHAIN_BROKEN', 'SHIFT_CHANGED', 'OFFLINE', 'NOT_OWNER', 'PIN_WRONG'] as const) {
      expect(isCentralZBlockedError(new PosError(code, 'x'))).toBe(false)
    }
  })
})
