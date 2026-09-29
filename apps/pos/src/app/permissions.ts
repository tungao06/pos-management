// Q44 role table (spec §11, §12 Q44 · D60 · ruling R11).
import type { UserRole } from '@dayo/contracts'

// The roles are the contracts enum (dayo staff.role, spec 04 §7 item 6): a role added or renamed there stops
// TABLE below from compiling instead of drifting silently.
export type PosRole = UserRole

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
  | 'close_off_catalog' // D97: only an owner closes a rejected bill as off-catalog (PIN + reason at the API too)

const STAFF_ACTIONS: readonly Action[] = ['sell', 'void_own', 'open_shift', 'close_shift', 'cash_move', 'count_cash', 'central_orders', 'system_status']
const MANAGER_ONLY_ACTIONS: readonly Action[] = ['view_shift_report'] // Q44: manager "+ ดูรายงานกะ"
const OWNER_ONLY_ACTIONS: readonly Action[] = ['void_any', 'price_diffs', 'device_setup', 'set_other_pin', 'sync_problems', 'backup', 'close_off_catalog']

const TABLE: Record<PosRole, ReadonlySet<Action>> = {
  staff: new Set(STAFF_ACTIONS),
  manager: new Set([...STAFF_ACTIONS, ...MANAGER_ONLY_ACTIONS]),
  owner: new Set([...STAFF_ACTIONS, ...MANAGER_ONLY_ACTIONS, ...OWNER_ONLY_ACTIONS]),
}

export function can(role: PosRole, action: Action): boolean {
  return TABLE[role]?.has(action) ?? false
}
