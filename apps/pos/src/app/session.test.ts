import { describe, expect, it } from 'vitest'
import { IDLE_LOCK_MS, isIdleExpired } from './session'

describe('isIdleExpired (spec §5: auto lock after 10 minutes idle)', () => {
  it('locks at exactly the limit, not before', () => {
    expect(IDLE_LOCK_MS).toBe(600_000)
    expect(isIdleExpired(0, 599_999)).toBe(false)
    expect(isIdleExpired(0, 600_000)).toBe(true)
    expect(isIdleExpired(1_000, 2_000, 1_000)).toBe(true)
  })
})
