import { laneOf, type DetailPrefix, type PushKind } from '@dayo/contracts'
import { SCOPE_CLOSABLE_AFTER_MS, TABLET_OWN_REASONS } from '../sync/push'
import type { Remedy } from './types'

/*
 * The pure rules of the "ส่งไม่ผ่าน" page (spec 04 §6.4 · ruling R11/R12 · preflight P2/P4/D3/D7) — no database here, so
 * the page (sync-problems.ts) and the status bar (bootstrap.ts) share them without an import cycle.
 */

/**
 * fix round 1 item 4 of block 2 (sync-problems.ts): dayo answers CONFLICT for two different things. A receipt number another
 * bill already holds (0052_pos_push.sql:421 "เลขใบเสร็จ … ถูกใช้กับบิลอื่น…", :665 external_ref_taken…, :680 a unique
 * violation) — a new number fixes it. Or this very key already stored with other data — RENUMBER only burns numbers.
 * Phase 2 dayo says `receipt_taken:`; phase 1 (shipped) says it in these words only (preflight P4 · D3).
 */
const RECEIPT_COLLISION = [/^เลขใบเสร็จ /, /^external_ref_taken/, /^SQLSTATE 23505$/]
export const isReceiptCollision = (detail: string): boolean => RECEIPT_COLLISION.some((re) => re.test(detail))

/**
 * Reasons the TABLET wrote itself (ruling R11: "ของเครื่อง") — no verdict of dayo, so never "ปิดเป็นบิลนอกแคตตาล็อก"
 * (dayo's rule: needs a rejection it recorded). '' = an unreadable last_error.
 */
const TABLET_OWN = new Set([...TABLET_OWN_REASONS, ''])

/** spec §6.4 S5 · R5-2 · preflight D7: a shift-kind verdict that says "someone else's data is under this key". */
export function isShiftConflict(reason: string, prefix: DetailPrefix | null): boolean {
  return (reason === 'CONFLICT' && (prefix === 'key_changed:' || prefix === 'counted:' || prefix === 'z_no_taken:'))
    || (reason === 'INVALID' && prefix === 'data_conflict:')
    || (reason === 'FORBIDDEN' && prefix === 'rule:')
}

export type RemedyFacts = {
  kind: PushKind
  /** true = the row still waits in the queue (only the waiting cards of the page) · false = dead. */
  pending: boolean
  reason: string
  prefix: DetailPrefix | null
  /** dayo's detail — read only for block 2's receipt-collision words when there is no prefix (P4). */
  detail: string
  /** ruling N5: more than 24 h ahead of dayo's clock. */
  farAhead: boolean
  /** carried item 6: a shift-lane row dayo does not support (it holds every later shift-lane row). */
  held: boolean
  /** when the FORBIDDEN scope: wait began (lastError.scopeSince). */
  scopeSince: string | null
  nowIso: string
  /** preflight P2: dayo's E1 advertises order_off_catalog (phase 2) — else "ปิดเป็นบิลนอกแคตตาล็อก" is never offered. */
  offCatalog: boolean
}

/**
 * spec 04 §6.4 table (locked, plan 09 Task 14) + preflight rulings:
 * - P2: CLOSE_OFF_CATALOG only while dayo advertises order_off_catalog.
 * - P4 · D3: an order/order_void rejection with NO prefix follows block 2's rules — RENUMBER only for dayo's own
 *   receipt-collision words, any other prefix-less CONFLICT = RETRY (+ EXCLUDE): dayo already has this key.
 * - review item 2: every dead `order` row except PARENT_REJECTED ends with EXCLUDE ("ปิดไว้ในเครื่อง").
 * - D7: `FORBIDDEN rule:` of a shift kind is a shift conflict (EXCLUDE only).
 */
export function remediesFor(r: RemedyFacts): Remedy[] {
  if (r.pending) {
    if (r.farAhead) return ['EXCLUDE']
    if (r.prefix === 'scope:') {
      const since = Date.parse(r.scopeSince ?? '')
      return Number.isFinite(since) && Date.parse(r.nowIso) - since >= SCOPE_CLOSABLE_AFTER_MS ? ['EXCLUDE'] : []
    }
    return r.held && laneOf(r.kind) === 'shift' ? ['EXCLUDE'] : []
  }
  if (r.reason === 'PARENT_REJECTED') return []
  if (r.reason === 'CLOCK_AHEAD') return ['EXCLUDE'] // block 2: a far-ahead row the owner may only close
  const own = TABLET_OWN.has(r.reason)
  const collision = r.prefix === 'receipt_taken:' || (r.prefix === null && isReceiptCollision(r.detail))
  switch (r.kind) {
    case 'order': {
      const coc: Remedy[] = r.offCatalog && !own ? ['CLOSE_OFF_CATALOG'] : []
      if (own) return ['RETRY', 'EXCLUDE']
      if (r.reason === 'CONFLICT') {
        if (r.prefix === 'exists:' || r.prefix === 'off_catalog_exists:') return ['ACKNOWLEDGE_ELSEWHERE', 'EXCLUDE']
        if (r.prefix === 'key_changed:') return ['EXCLUDE']
        if (collision) return ['RETRY', 'RENUMBER', ...coc, 'EXCLUDE']
        return ['RETRY', 'EXCLUDE']
      }
      if (r.reason === 'UNKNOWN_CODE') return ['RETRY', 'REMAP_CODE', ...coc, 'EXCLUDE']
      if (r.reason === 'UNKNOWN_STAFF') return ['RETRY', 'REMAP_STAFF', ...coc, 'EXCLUDE']
      return ['RETRY', ...coc, 'EXCLUDE'] // INVALID FORBIDDEN BAD_KEY and anything dayo adds later
    }
    case 'order_off_catalog': {
      if (own) return ['RETRY', 'EXCLUDE']
      if (r.reason === 'CONFLICT') {
        if (r.prefix === 'exists:' || r.prefix === 'off_catalog_exists:') return ['ACKNOWLEDGE_ELSEWHERE']
        if (r.prefix === 'key_changed:') return ['EXCLUDE']
        return ['RETRY', 'RENUMBER'] // receipt_taken: (and no prefix — the spec treats a bare CONFLICT so)
      }
      if (r.reason === 'UNKNOWN_CODE') return ['RETRY', 'REMAP_CODE']
      if (r.reason === 'UNKNOWN_STAFF') return ['RETRY', 'REMAP_STAFF']
      if (r.reason === 'FORBIDDEN' && r.prefix === 'role:') return ['RECONFIRM_OWNER']
      if (r.reason === 'FORBIDDEN' && r.prefix === 'rule:') return ['RETRY', 'EXCLUDE'] // over the cap: the owner raises it on the web, then RETRY (D103)
      return ['EXCLUDE'] // INVALID = a tablet bug: export JSON or close locally
    }
    case 'order_void': {
      if (r.reason === 'FORBIDDEN' && r.prefix === 'rule:') return ['EXCLUDE'] // §6.4 (ค)
      if (r.reason === 'UNKNOWN_STAFF') return ['RETRY', 'REMAP_STAFF']
      return ['RETRY', 'EXCLUDE'] // P4: INVALID / a prefix-less FORBIDDEN keep block 2's buttons
    }
    case 'shift_open': case 'cash_movement': case 'cash_count': case 'shift_close': {
      if (isShiftConflict(r.reason, r.prefix)) return ['EXCLUDE']
      if (r.reason === 'UNKNOWN_STAFF') return ['RETRY', 'REMAP_STAFF']
      if (r.reason === 'FORBIDDEN' && r.prefix === 'role:') {
        if (r.kind === 'shift_close') return ['RECONFIRM_OWNER']
        if (r.kind === 'shift_open') return ['REMAP_STAFF'] // quick_open by a non-owner: only opened_by may change (§6.4)
      }
      return ['RETRY', 'EXCLUDE']
    }
  }
}

export type ProblemHint = 'void_rejected' | 'shift_conflict' | 'key_replaced' | null

/**
 * §6.4 (ค): a void dayo refused → "cancel bill <order_no> on the dayo web" · S5: someone else's data under this key →
 * "check the device key" · carried item 7: a shift opened before the owner replaced the key — dayo refuses its rows
 * (FORBIDDEN, the shift belongs to the old key): not a stranger on the key, keep the shift on the tablet.
 */
export function hintFor(r: { kind: PushKind; dead: boolean; reason: string; prefix: DetailPrefix | null; shiftOpenedBeforeKeyReplace: boolean }): ProblemHint {
  if (!r.dead) return null
  if (r.kind === 'order_void' && (r.reason === 'INVALID' || (r.reason === 'FORBIDDEN' && r.prefix !== 'role:' && r.prefix !== 'scope:'))) return 'void_rejected'
  if (laneOf(r.kind) !== 'shift') return null
  if (r.reason === 'FORBIDDEN' && (r.prefix === 'rule:' || r.prefix === null) && r.shiftOpenedBeforeKeyReplace) return 'key_replaced'
  return isShiftConflict(r.reason, r.prefix) ? 'shift_conflict' : null
}
