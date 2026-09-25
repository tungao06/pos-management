import { describe, expect, it } from 'vitest'
import { can, type PosRole } from './permissions'

describe('Q44 role table', () => {
  it.each([
    ['staff', 'sell', true], ['staff', 'void_own', true], ['staff', 'void_any', false], ['staff', 'sync_problems', false], ['staff', 'central_orders', true],
    ['manager', 'void_own', true], ['manager', 'void_any', false], ['manager', 'price_diffs', false], ['manager', 'view_shift_report', true], ['manager', 'device_setup', false], ['manager', 'set_other_pin', false],
    ['owner', 'void_any', true], ['owner', 'price_diffs', true],
    ['owner', 'device_setup', true], ['owner', 'set_other_pin', true], ['owner', 'sync_problems', true], ['owner', 'backup', true],
  ] as const)('%s may %s: %s', (role, action, ok) => { expect(can(role, action)).toBe(ok) })
})

describe('fix round 1 [Important]: an unrecognized role is denied, not thrown', () => {
  it.each([['sell'], ['backup']] as const)('an unknown role may not %s', (action) => {
    expect(can('unknown' as PosRole, action)).toBe(false)
  })
})
