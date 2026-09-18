import { describe, expect, it } from 'vitest'
import { PosError, posErrorCode } from './errors'

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
