// D60 · Task 16 · spec §11, §12 Q44 · ruling R11: role permission table.
//
// `@dayo/contracts` UserRole is still `owner | staff` on this branch (the `manager` value lands with
// Task 5's zod change, out of scope here). This module keeps its own UserRole union so it does not
// depend on that landing — a UserDto.role value from the current contracts is always assignable into
// it, and once Task 5 adds `manager` upstream this type can be swapped for the `@dayo/contracts` one.
export type UserRole = 'staff' | 'manager' | 'owner'

export type Action =
  | 'sell'
  | 'void_own'
  | 'void_any'
  | 'open_shift'
  | 'close_shift'
  | 'cash_move'
  | 'count_cash'
  | 'central_orders'
  | 'view_shift_report'
  | 'price_diffs'
  | 'system_status'
  | 'device_setup'
  | 'set_other_pin'
  | 'sync_problems'
  | 'backup'

const STAFF_ACTIONS: readonly Action[] = ['sell', 'void_own', 'open_shift', 'close_shift', 'cash_move', 'count_cash', 'central_orders', 'system_status']

// Q44: manager gets everything staff has, plus viewing the shift report (ruling R11 — no void_any, no price_diffs).
const MANAGER_ACTIONS: readonly Action[] = [...STAFF_ACTIONS, 'view_shift_report']

// Owner: everything, including the actions Q44 does not extend to manager.
const OWNER_ACTIONS: readonly Action[] = [...MANAGER_ACTIONS, 'void_any', 'price_diffs', 'device_setup', 'set_other_pin', 'sync_problems', 'backup']

const TABLE: Record<UserRole, ReadonlySet<Action>> = {
  staff: new Set(STAFF_ACTIONS),
  manager: new Set(MANAGER_ACTIONS),
  owner: new Set(OWNER_ACTIONS),
}

export function can(role: UserRole, action: Action): boolean {
  return TABLE[role].has(action)
}
