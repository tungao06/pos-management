import { and, desc, eq, lt, ne, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { IsoReceived } from '@dayo/contracts'
import { zReportHash } from '@dayo/domain'
import { DAYO_AHEAD_TOLERANCE_MS, DAYO_KEYS, deleteKey, readKey, writeKey } from '../sync/state'
import { PosError } from './errors'

/**
 * Task 13 · spec 04 §4.4 ข้อ 6 · §6.6 · §13.8 R5-1 · ruling R9 · D55: the key's last Z as dayo holds it (E1 client.last_z_no /
 * last_z_hash / last_z_until) — read ONLY when the device is set up, its key replaced or its owner recovered, never by the
 * periodic E1 (R9). A reinstalled tablet continues the key's Z numbers, hash chain and bot window from it.
 * Its own module (connect.ts and close.ts re-export it) so rows.ts, bot-cash.ts and close.ts can all use it without an import cycle.
 */
export type CentralZ = { lastZNo: number; lastZHash: string; lastZUntil: string } // lastZUntil stored as the tablet's own ISO form (toISOString)

/** dayo z_reports.z_no is an int4 (0065:149) — the next Z (last + 1) must still fit, else every continuation Z would be unbuildable. */
const MAX_CENTRAL_Z_NO = 2_147_483_646

/** spec §4.4 ข้อ 6 (R4-1 · R5-1): dayo's raw client.last_z_* — checked here, like last_receipt_no; odd values stop the setup, nothing is guessed. */
export function centralZOf(c: { last_z_no?: number | null | undefined; last_z_hash?: string | null | undefined; last_z_until?: string | null | undefined }): CentralZ | null {
  const n = c.last_z_no ?? null
  const h = c.last_z_hash ?? null
  const u = c.last_z_until ?? null
  if (n === null && h === null && u === null) return null
  const ok = n !== null && h !== null && u !== null && Number.isSafeInteger(n) && n >= 1 && n <= MAX_CENTRAL_Z_NO && /^[0-9a-f]{64}$/.test(h) && IsoReceived.safeParse(u).success
  if (!ok) throw new PosError('DAYO_Z_STATE_INVALID', String(n))
  return { lastZNo: n, lastZHash: h, lastZUntil: new Date(Date.parse(u)).toISOString() } // the tablet sends times as …sssZ (§4.1)
}

/**
 * centralZOf of a full E1 answer, plus one check against the answer's own server_time: dayo accepted that Z's count only
 * when it was at most 5 min ahead of its clock, so an until later than server_time + 5 min is not a real dayo state —
 * it would floor this device's counts (rows.ts) past real time. Refused like any other odd value (DAYO_Z_STATE_INVALID).
 */
export function centralZOfAnswer(v: { server_time: string; client: Parameters<typeof centralZOf>[0] }): CentralZ | null {
  const cz = centralZOf(v.client)
  if (cz !== null && Date.parse(cz.lastZUntil) > Date.parse(v.server_time) + DAYO_AHEAD_TOLERANCE_MS) throw new PosError('DAYO_Z_STATE_INVALID', `${cz.lastZNo} until ${cz.lastZUntil} is after dayo's time ${v.server_time}`)
  return cz
}

const CENTRAL_Z_KEYS = [DAYO_KEYS.lastZNo, DAYO_KEYS.lastZHash, DAYO_KEYS.lastZUntil] as const

/** Inside the setup / key-swap / recovery transaction: the three keys, or none (a key without a Z starts its own chain — §6.6). */
export async function storeCentralZ(tx: RemoteDb, z: CentralZ | null): Promise<void> {
  if (z === null) {
    for (const k of CENTRAL_Z_KEYS) await deleteKey(tx, k)
    return
  }
  await writeKey(tx, DAYO_KEYS.lastZNo, String(z.lastZNo))
  await writeKey(tx, DAYO_KEYS.lastZHash, z.lastZHash)
  await writeKey(tx, DAYO_KEYS.lastZUntil, z.lastZUntil)
}

/**
 * The three stored keys read back — all of them valid, or null. sync_state is a plain table (a restored or hand-edited file
 * can hold anything): a partial or odd value is treated as no central Z — the device then chains from its own Zs (dayo
 * answers a repeated number with z_no_taken, visible on the problems page) — never a throw that would block every close.
 */
export async function readCentralZ(db: RemoteDb): Promise<CentralZ | null> {
  const n = await readKey(db, DAYO_KEYS.lastZNo)
  const h = await readKey(db, DAYO_KEYS.lastZHash)
  const u = await readKey(db, DAYO_KEYS.lastZUntil)
  if (n === null || h === null || u === null || !/^[1-9][0-9]{0,15}$/.test(n)) return null
  try {
    const z = centralZOf({ last_z_no: Number(n), last_z_hash: h, last_z_until: u })
    return z !== null && z.lastZUntil === u ? z : null
  } catch {
    return null
  }
}

/**
 * This device's own last Z number: the zNo of its newest z_report row (insertion order — close.ts deviceZRows) when that
 * row's hash verifies, else its Z row count (close.ts's rule for an untrustworthy last row). 0 = no Z yet.
 */
async function deviceLastZNo(db: RemoteDb, deviceId: string): Promise<number> {
  const rows = (await db.values<[number]>(sql`select count(*) from z_report z join shift sh on sh.id = z.shift_id where sh.device_id = ${deviceId}`))[0]?.[0] ?? 0
  if (rows === 0) return 0
  const last = await db.select({ hash: s.zReport.hash, text: sql<string>`${s.zReport.snapshotJson}` }).from(s.zReport)
    .innerJoin(s.shift, eq(s.shift.id, s.zReport.shiftId)).where(eq(s.shift.deviceId, deviceId))
    .orderBy(desc(sql`"z_report"."rowid"`)).limit(1).get()
  try {
    const snap: unknown = JSON.parse(last!.text)
    const zNo = (snap as { zNo?: unknown } | null)?.zNo
    if (typeof snap === 'object' && snap !== null && typeof zNo === 'number' && Number.isSafeInteger(zNo) && zReportHash(snap) === last!.hash) return zNo
  } catch {
    // unreadable: the row count stands for it
  }
  return rows
}

/** Ruling R9: the central last Z stored at setup/relink/recover, when it is above this device's own last Z (the R9 path), else null. */
export async function centralContinuation(db: RemoteDb, deviceId: string): Promise<CentralZ | null> {
  const central = await readCentralZ(db)
  if (central === null) return null
  return central.lastZNo > (await deviceLastZNo(db, deviceId)) ? central : null
}

/**
 * spec §13.8 R5-1: where the E4 window of `shift` starts on the R9 path — dayo's last_z_until — or null (the usual rule).
 * Only for the first Z of the line: R7 issues Zs in count order, so that is the shift with no earlier counted shift of
 * this device still waiting for its Z; a later one starts at the previous local count as always (so its window never
 * moves when the first one's Z is written). A last_z_until at or after this count (a clock that was wrong) is not used:
 * the usual rule stands and dayo shows the mismatch — nothing is guessed.
 */
export async function centralWindowStart(db: RemoteDb, shift: { id: string; deviceId: string; countedAt: string }): Promise<string | null> {
  const c = await centralContinuation(db, shift.deviceId)
  if (c === null || !(Date.parse(c.lastZUntil) < Date.parse(shift.countedAt))) return null
  const earlier = await db.select({ id: s.shift.id }).from(s.shift)
    .where(and(eq(s.shift.deviceId, shift.deviceId), eq(s.shift.status, 'counted'), lt(s.shift.countedAt, shift.countedAt), ne(s.shift.id, shift.id))).limit(1).get()
  return earlier === undefined ? c.lastZUntil : null
}
