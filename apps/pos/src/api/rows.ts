import { sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import { CLOCK_AHEAD_FAR_MS } from '../sync/push'
import { estimatedServerMs } from '../sync/state'
import { PosError } from './errors'

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

/** BAD_INPUT detail prefix of a refusal by `countFloor` / `assertNoFarAheadCount` (the screen shows the Thai text after it). */
export const CLOCK_AHEAD_COUNT = 'CLOCK_AHEAD'

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
  return (await db.values<[string | null]>(sql`select max(counted_at) from shift where device_id = ${deviceId} and counted_at is not null`))[0]?.[0] ?? null
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
  return new PosError('BAD_INPUT', `${CLOCK_AHEAD_COUNT}: การนับเงินครั้งล่าสุดของเครื่องนี้ (${last}) ล้ำเวลาจริงเกิน 24 ชม. — นาฬิกาแท็บเล็ตเคยตั้งผิด ขายต่อได้ แต่นับเงินและออกใบปิดกะไม่ได้จนกว่าเจ้าของร้านจะตัดสินใจ`)
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
