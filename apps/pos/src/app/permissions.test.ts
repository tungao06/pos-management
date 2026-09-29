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

it('only an owner closes a bill as off-catalog (D91 · D97 · spec §4.10 order_off_catalog)', () => {
  expect(can('owner', 'close_off_catalog')).toBe(true)
  expect(can('manager', 'close_off_catalog')).toBe(false)
  expect(can('staff', 'close_off_catalog')).toBe(false)
})

it('everyone may count the drawer and start the Z; the owner PIN is the gate (D52 Q3b-2 · D101)', () => {
  for (const r of ['staff', 'manager', 'owner'] as const) {
    expect(can(r, 'count_cash')).toBe(true)
    expect(can(r, 'close_shift')).toBe(true)
  }
})
