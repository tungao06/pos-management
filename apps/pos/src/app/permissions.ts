// Q44 role table (spec §11, §12 Q44 · D60 · controller ruling R11).
// `UserRole` in @dayo/contracts does not have 'manager' yet (Task 5 adds it in a parallel stream) — this stays
// local until a later task switches it to the contracts enum.
export type PosRole = 'staff' | 'manager' | 'owner'

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
const MANAGER_ONLY_ACTIONS: readonly Action[] = ['view_shift_report'] // Q44: manager "+ ดูรายงานกะ"
const OWNER_ONLY_ACTIONS: readonly Action[] = ['void_any', 'price_diffs', 'device_setup', 'set_other_pin', 'sync_problems', 'backup']

const TABLE: Record<PosRole, ReadonlySet<Action>> = {
  staff: new Set(STAFF_ACTIONS),
  manager: new Set([...STAFF_ACTIONS, ...MANAGER_ONLY_ACTIONS]),
  owner: new Set([...STAFF_ACTIONS, ...MANAGER_ONLY_ACTIONS, ...OWNER_ONLY_ACTIONS]),
}

export function can(role: PosRole, action: Action): boolean {
  return TABLE[role].has(action)
}
