import { laneOf } from '@dayo/contracts'

/** One queued E2 row as the lane picker sees it. `bytes` = the UTF-8 size of the row in the request body. */
export type QueueRow = { id: string; kind: string; key: string; createdAt: string; nextAttemptAt: string | null; parentKey: string | null; supported: boolean; bytes: number }
/** The outbox status of a row's local parent (`missing` = no outbox row under that key on this tablet). */
export type ParentState = 'sent' | 'pending' | 'dead' | 'local_only' | 'closed_off_catalog' | 'missing'
/** pushOnce passes { 20 (1 in R4 one-row mode), 262,144 − envelope bytes }. */
export type BatchBudget = { maxRows: number; maxBytes: number }

/**
 * spec 04 §6.2 · §4.10: rows are offered oldest first (created_at, rowid). `offer` returns true only when the row is PLACED
 * in this batch. The shift lane is strict: the first shift-lane row that cannot go now — not due, unsupported, parent
 * neither sent nor placed, or no room left (rows/bytes, review item 6) — closes the lane for every later shift-lane row of
 * this batch. The bill lane keeps block 2's rule; a bill with no room is skipped. `taken` holds placed rows only.
 *
 * A parent with no outbox row at all (`missing`) does not hold its child (Task 10 Step 0 — block 2 push.test.ts M5): nothing
 * on this tablet will ever send it, so dayo judges the child (PARENT_PENDING, counted → STUCK at 50 → the problems page)
 * instead of the child — and in the shift lane every row after it — waiting for ever without a sign. `dead` and
 * `local_only` parents never reach here as such: pushOnce moves their children first (PARENT_REJECTED / local_only).
 */
export function createLanePicker(parentState: (key: string) => ParentState, nowIso: string, budget: BatchBudget): { offer(r: QueueRow): boolean; full(): boolean; oversized(): QueueRow[] } {
  const taken = new Set<string>()
  const tooBig: QueueRow[] = []
  let shiftClosed = false
  let rows = 0
  let bytes = 0
  const parentOk = (key: string | null): boolean => {
    if (key === null || taken.has(key)) return true
    const st = parentState(key)
    return st === 'sent' || st === 'missing'
  }
  return {
    offer(r) {
      const shift = laneOf(r.kind) === 'shift'
      if (shift && shiftClosed) return false
      const due = r.nextAttemptAt === null || r.nextAttemptAt <= nowIso
      const ready = due && r.supported && parentOk(r.parentKey)
      if (ready && r.bytes > budget.maxBytes) {
        // bigger than an empty batch: it can never go — pushOnce turns it into dead ENVELOPE (the owner can then
        // "ปิดไว้ในเครื่อง") instead of it holding the shift lane forever (round 2 item 4)
        tooBig.push(r)
        if (shift) shiftClosed = true
        return false
      }
      const fits = rows + 1 <= budget.maxRows && bytes + r.bytes <= budget.maxBytes
      if (!(ready && fits)) {
        if (shift) shiftClosed = true
        return false
      }
      taken.add(r.key)
      rows += 1
      bytes += r.bytes
      return true
    },
    full: () => rows >= budget.maxRows,
    oversized: () => [...tooBig],
  }
}
