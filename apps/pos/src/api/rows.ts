import { sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import { CLOCK_AHEAD_FAR_MS } from '../sync/push'
import { DAYO_KEYS, readKey } from '../sync/state'
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

/** BAD_INPUT detail prefix of a refusal by `countFloor` (the screen shows the Thai text after it). */
export const CLOCK_AHEAD_COUNT = 'CLOCK_AHEAD'

/**
 * Fix round 1 (security M1) floors a new shift's opening and a new count at this device's last counted_at, so E4 windows
 * never overlap. Fix round 2: that floor has no ceiling of its own — ONE count taken while the tablet clock was far ahead
 * (say a year) would drag every later shift a year into the future (shift_open CLOCK_AHEAD for a year, 1 ms bot windows).
 * So the floor is applied only while the last count is not ahead of the estimated server time (device clock + the last
 * skew dayo reported, or the device clock when none was ever measured) by more than CLOCK_AHEAD_FAR_MS (24 h — the
 * sender's own "far ahead" line). Further ahead = refused (BAD_INPUT `CLOCK_AHEAD:` + Thai text) and nothing is written:
 * the owner decides. Returns the last counted_at (null = no count yet) when it may floor `candidate`.
 */
export async function countFloor(db: RemoteDb, deviceId: string, candidate: string): Promise<string | null> {
  const last = (await db.values<[string | null]>(sql`select max(counted_at) from shift where device_id = ${deviceId} and counted_at is not null`))[0]?.[0] ?? null
  if (last === null || Date.parse(last) < Date.parse(candidate)) return last // no floor needed: nothing to check
  const skew = Number((await readKey(db, DAYO_KEYS.clockSkewMs)) ?? Number.NaN)
  const server = Date.parse(candidate) + (Number.isFinite(skew) ? skew : 0)
  if (Date.parse(last) - server > CLOCK_AHEAD_FAR_MS) {
    throw new PosError('BAD_INPUT', `${CLOCK_AHEAD_COUNT}: การนับเงินครั้งล่าสุดของเครื่องนี้ (${last}) ล้ำเวลาจริงเกิน 24 ชม. — นาฬิกาแท็บเล็ตเคยตั้งผิด ตั้งนาฬิกาให้ตรงแล้วให้เจ้าของร้านตัดสินใจก่อนเปิดหรือนับกะ`)
  }
  return last
}
