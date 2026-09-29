import { describe, expect, it } from 'vitest'
import { isCentralZBlockedError, isClockAheadCountError, isRecoverableE4Error, PosError, posErrorCode } from './errors'

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

describe('isCentralZBlockedError (fix round 1 item 1a · fix round 2 item C — an ALLOWLIST)', () => {
  it('DAYO_BAD_RESPONSE and Z_TOO_LARGE are permanent central-Z blocks', () => {
    expect(isCentralZBlockedError(new PosError('DAYO_BAD_RESPONSE', 'x'))).toBe(true)
    expect(isCentralZBlockedError(new PosError('Z_TOO_LARGE', 'x'))).toBe(true)
  })
  it('every allowlisted BAD_INPUT detail prefix counts: COUNT_BEFORE_CENTRAL_Z:, E2 shift_close row:, E2 cash_count row:, Z_BUILD:', () => {
    expect(isCentralZBlockedError(new PosError('BAD_INPUT', 'COUNT_BEFORE_CENTRAL_Z: การนับนี้เกิดก่อน Z ล่าสุด'))).toBe(true)
    expect(isCentralZBlockedError(new PosError('BAD_INPUT', 'E2 shift_close row: closedAt must be after countedAt'))).toBe(true)
    expect(isCentralZBlockedError(new PosError('BAD_INPUT', 'E2 cash_count row: countedAt must be after openedAt'))).toBe(true)
    expect(isCentralZBlockedError(new PosError('BAD_INPUT', 'Z_BUILD: closedAt must be after countedAt'))).toBe(true)
  })
  it('excludes CLOCK_AHEAD (its own remedy is skipCountFloor, not keepShiftLocal)', () => {
    expect(isCentralZBlockedError(new PosError('BAD_INPUT', 'CLOCK_AHEAD: นาฬิกาล้ำเวลาจริง'))).toBe(false)
  })
  it('excludes a BAD_INPUT that is NOT one of the allowlisted prefixes (fix round 2: an ordinary input mistake)', () => {
    expect(isCentralZBlockedError(new PosError('BAD_INPUT', 'unknown or inactive user nobody'))).toBe(false)
    expect(isCentralZBlockedError(new PosError('BAD_INPUT', 'a reason must be plain text (no control characters)'))).toBe(false)
    expect(isCentralZBlockedError(new PosError('BAD_INPUT', 'shownExpectedCashSatang must be whole satang'))).toBe(false)
  })
  it('excludes every other code (Z_CHAIN_BROKEN, SHIFT_CHANGED, OFFLINE, …)', () => {
    for (const code of ['Z_CHAIN_BROKEN', 'SHIFT_CHANGED', 'OFFLINE', 'NOT_OWNER', 'PIN_WRONG'] as const) {
      expect(isCentralZBlockedError(new PosError(code, 'x'))).toBe(false)
    }
  })
})

describe('isRecoverableE4Error (fix round 2 item B)', () => {
  it('DAYO_UNREACHABLE, DAYO_BAD_KEY, DAYO_KEY_NO_SCOPE, DAYO_API_DISABLED and CLOCK_AHEAD are all recoverable', () => {
    for (const code of ['DAYO_UNREACHABLE', 'DAYO_BAD_KEY', 'DAYO_KEY_NO_SCOPE', 'DAYO_API_DISABLED'] as const) {
      expect(isRecoverableE4Error(new PosError(code, 'x'))).toBe(true)
    }
    expect(isRecoverableE4Error(new PosError('BAD_INPUT', 'CLOCK_AHEAD: เวลานับเงินยังไม่ถึงในระบบกลาง'))).toBe(true)
  })
  it('DAYO_BAD_RESPONSE and Z_TOO_LARGE (a genuinely bad/oversized E4 answer) are not recoverable', () => {
    expect(isRecoverableE4Error(new PosError('DAYO_BAD_RESPONSE', 'x'))).toBe(false)
    expect(isRecoverableE4Error(new PosError('Z_TOO_LARGE', 'x'))).toBe(false)
  })
})
