import { sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import { CLOCK_AHEAD_FAR_MS } from '../sync/push'
import { estimatedServerMs, readKey } from '../sync/state'
import { centralContinuation } from './central-z'
import { CLOCK_AHEAD, PosError } from './errors'

/**
 * A builder of @dayo/domain refuses (throws) a row dayo would reject forever: inside the caller's transaction that
 * rolls the whole write back — surfaced as BAD_INPUT, never as a raw RangeError/ZodError.
 */
export function builtRow<T>(what: string, build: () => T): T {
  try {
    return build()
  } catch (e) {
    if (e instanceof PosError) throw e
    throw new PosError('BAD_INPUT', `${what}: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`)
  }
}

/**
 * The later of two ISO instants. A shift's rows are stamped no earlier than its opening (dayo 0066:216-222 refuses a
 * cash row with created_at < opened_at for good): a device clock stepped back after opening moves the stamp up to the
 * opening instant instead of making the row unsendable.
 */
export function notBefore(at: string, floor: string): string {
  return Date.parse(at) < Date.parse(floor) ? floor : at
}


/**
 * Fix rounds 1–3 (security M1 · rule 5 offline-first): E4 windows start at the device's previous count, so a new shift
 * and a new count are floored at this device's last counted_at — a clock stepped back must not reopen a window already
 * in a Z. But ONE count taken while the tablet clock was far ahead (say a year) must not drag everything after it:
 * the last count is "far ahead" when it is more than CLOCK_AHEAD_FAR_MS (24 h — the sender's own line) ahead of the
 * estimated server time = the device clock + the last skew dayo reported, while fresh (D106 — the device clock alone otherwise).
 * - opening a shift (`openFloor`): never refused — selling is never blocked. Floored only when the last count is not far
 *   ahead; far ahead = opened at the device clock.
 * - counting (`countFloor`) and issuing a Z (`assertNoFarAheadCount`): refused while the last count is far ahead (its E4
 *   window would be inverted or overlap) — BAD_INPUT `CLOCK_AHEAD:` + Thai text, nothing written. The owner's way past
 *   it (PIN + reason + audit) is Task 14's.
 */
async function lastCountOf(db: RemoteDb, deviceId: string): Promise<string | null> {
  // Task 14 · carried item 9b: the far-ahead counts the owner chose to skip (skipCountFloor) floor nothing any more
  const skipped = JSON.stringify(await skippedCounts(db))
  const local = (await db.values<[string | null]>(sql`select max(counted_at) from shift where device_id = ${deviceId} and counted_at is not null and counted_at not in (select value from json_each(${skipped}))`))[0]?.[0] ?? null
  // Task 13 (ruling R9 · spec §13.8 R5-1): on the R9 path dayo's last Z (until = its count) is this key's last count too —
  // the first central Z's window starts there (bot-cash.ts centralWindowStart), so no count may land at or before it
  const central = await centralContinuation(db, deviceId)
  if (central === null) return local
  return local !== null && Date.parse(local) >= Date.parse(central.lastZUntil) ? local : central.lastZUntil
}

/** Only a last count AFTER the device clock (the clock went back since) can floor anything or overlap an E4 window: one
 * at or before it is never "far ahead" here — so a stale or odd skew can never refuse an ordinary count or Z whose clock simply moved on.
 * Task 12 carried (L): the skew counts only while fresh (D106 `estimatedServerMs`, as the same-day void rule) — a stale one
 * falls back to the device clock. */
async function farAhead(db: RemoteDb, iso: string, deviceNow: string): Promise<boolean> {
  if (Date.parse(iso) <= Date.parse(deviceNow)) return false
  const server = (await estimatedServerMs(db, deviceNow)) ?? Date.parse(deviceNow)
  return Date.parse(iso) - server > CLOCK_AHEAD_FAR_MS
}

function clockAheadError(last: string): PosError {
  return new PosError('BAD_INPUT', `${CLOCK_AHEAD}: การนับเงินครั้งล่าสุดของเครื่องนี้ (${last}) ล้ำเวลาจริงเกิน 24 ชม. — นาฬิกาแท็บเล็ตเคยตั้งผิด ขายต่อได้ แต่นับเงินและออกใบปิดกะไม่ได้จนกว่าเจ้าของร้านจะตัดสินใจ`)
}

/** Opening a shift: the floor (this device's last counted_at), or null = open at the device clock (no count yet, or it is far ahead). */
export async function openFloor(db: RemoteDb, deviceId: string, deviceNow: string): Promise<string | null> {
  const last = await lastCountOf(db, deviceId)
  return last === null || (await farAhead(db, last, deviceNow)) ? null : last
}

/** Counting: the floor (this device's last counted_at; the count goes 1 ms after it), or null · far ahead = refused. */
export async function countFloor(db: RemoteDb, deviceId: string, deviceNow: string): Promise<string | null> {
  const last = await lastCountOf(db, deviceId)
  if (last !== null && (await farAhead(db, last, deviceNow))) throw clockAheadError(last)
  return last
}

/** Issuing a Z: refused while this device's last count is far ahead. */
export async function assertNoFarAheadCount(db: RemoteDb, deviceId: string, deviceNow: string): Promise<void> {
  await countFloor(db, deviceId, deviceNow)
}

/**
 * sync_state key (local only, never sent): a JSON array of the counted_at values the owner skipped as floors (Task 14 · carried
 * item 9b · skipCountFloor) — each floors nothing any more; a count that becomes far ahead later asks again.
 */
export const COUNT_FLOOR_SKIP_KEY = 'local.count_floor_skip'

/** The skipped counted_at values (an unreadable value = none; a bare value = that one). */
export async function skippedCounts(db: RemoteDb): Promise<string[]> {
  const raw = await readKey(db, COUNT_FLOOR_SKIP_KEY)
  if (raw === null) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  } catch { /* a bare value below */ }
  return [raw]
}

/**
 * fix round 1 item 1: EVERY count of this device still floored that is far ahead (> CLOCK_AHEAD_FAR_MS past the estimated
 * server time) — skipped all at once, so two counts taken while the clock was ahead never leave the owner skipping one only
 * to meet the other. Oldest first. A floor from dayo's last Z (R9) is never far ahead (centralZOfAnswer).
 */
export async function farAheadCounts(db: RemoteDb, deviceId: string, deviceNow: string): Promise<{ countedAt: string; shiftId: string }[]> {
  const skipped = JSON.stringify(await skippedCounts(db))
  const rows = await db.values<[string, string]>(sql`select id, counted_at from shift where device_id = ${deviceId} and counted_at is not null and counted_at not in (select value from json_each(${skipped})) order by counted_at, id`)
  const out: { countedAt: string; shiftId: string }[] = []
  for (const [shiftId, countedAt] of rows) if (await farAhead(db, countedAt, deviceNow)) out.push({ countedAt, shiftId })
  return out
}
