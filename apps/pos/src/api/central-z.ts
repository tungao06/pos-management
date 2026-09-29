import { and, eq, lt, ne } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { IsoReceived } from '@dayo/contracts'
import { DAYO_AHEAD_TOLERANCE_MS, DAYO_KEYS, deleteKey, readKey, writeKey } from '../sync/state'
import { PosError } from './errors'
import { deviceLastZNo, readDeviceZHigh } from './z-rows'

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
  await deleteKey(tx, DAYO_KEYS.lastZContinued) // a new read of dayo: not continued yet (fix round 1)
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
 * Task 13 fix round 1 (security M): sync_state value of the stored central Z once a Z of this device continued it (written
 * by writeZ in the Z's own transaction; cleared by storeCentralZ with every new E1 read). A continuation is used ONCE:
 * without this, a later hash failure of that Z would lower deviceLastZNo, re-open the R9 path and issue the same Z number
 * again (a fork of the chain, a bot window counted twice, the D53–D55 evidence hidden).
 */
export async function markCentralContinued(tx: RemoteDb, z: CentralZ): Promise<void> {
  await writeKey(tx, DAYO_KEYS.lastZContinued, String(z.lastZNo))
  // fix round 2: the continuing Z's own number floors any later lenient numbering — never cleared (storeCentralZ keeps it)
  await writeKey(tx, DAYO_KEYS.centralZFloor, String(z.lastZNo + 1))
}

/** Ruling R9: the central last Z stored at setup/relink/recover, when it is above this device's own last Z and no Z has
 * continued it yet (the R9 path), else null. */
export async function centralContinuation(db: RemoteDb, deviceId: string): Promise<CentralZ | null> {
  const central = await readCentralZ(db)
  if (central === null) return null
  if ((await readKey(db, DAYO_KEYS.lastZContinued)) === String(central.lastZNo)) return null
  if ((await readDeviceZHigh(db)) >= central.lastZNo) return null // fix round 2: this device already issued that number or later
  return central.lastZNo > (await deviceLastZNo(db, deviceId)) ? central : null
}

/** The shift whose Z is the first of the R9 line (R7: no earlier counted shift of this device still waits for its Z), with the central Z it continues — or null. */
async function firstOfCentralLine(db: RemoteDb, shift: { id: string; deviceId: string; countedAt: string }): Promise<CentralZ | null> {
  const c = await centralContinuation(db, shift.deviceId)
  if (c === null) return null
  const earlier = await db.select({ id: s.shift.id }).from(s.shift)
    .where(and(eq(s.shift.deviceId, shift.deviceId), eq(s.shift.status, 'counted'), lt(s.shift.countedAt, shift.countedAt), ne(s.shift.id, shift.id))).limit(1).get()
  return earlier === undefined ? c : null
}

/**
 * spec §13.8 R5-1: where the E4 window of `shift` starts on the R9 path — dayo's last_z_until — or null (the usual rule).
 * Only for the first Z of the line: R7 issues Zs in count order, so that is the shift with no earlier counted shift of
 * this device still waiting for its Z; a later one starts at the previous local count as always (so its window never
 * moves when the first one's Z is written). A count at or before last_z_until never gets here: rows.ts floors counts
 * after it, and one taken before the key swap is refused by assertCountAfterCentralZ.
 */
export async function centralWindowStart(db: RemoteDb, shift: { id: string; deviceId: string; countedAt: string }): Promise<string | null> {
  const c = await firstOfCentralLine(db, shift)
  return c !== null && Date.parse(c.lastZUntil) < Date.parse(shift.countedAt) ? c.lastZUntil : null
}

/** BAD_INPUT detail prefix of assertCountAfterCentralZ (the screen shows the Thai text after it). */
export const COUNT_BEFORE_CENTRAL_Z = 'COUNT_BEFORE_CENTRAL_Z'

/**
 * Task 13 fix round 1 (review item 2): a count taken BEFORE dayo's last Z of this key (counted, then replaceApiKey /
 * recoverOwner read a later Z from dayo) cannot be the first Z of the R9 line: its number and hash would continue dayo's
 * Z while its bot window (the usual rule) overlaps that Z — bot cash counted twice. Refused for E4 and for the Z of a
 * central shift; counted_at is frozen, so the owner's way on is Task 14's escape. A local-only shift has no bot window.
 */
export async function assertCountAfterCentralZ(db: RemoteDb, shift: { id: string; deviceId: string; countedAt: string }): Promise<void> {
  const c = await firstOfCentralLine(db, shift)
  if (c !== null && !(Date.parse(c.lastZUntil) < Date.parse(shift.countedAt))) {
    throw new PosError('BAD_INPUT', `${COUNT_BEFORE_CENTRAL_Z}: การนับนี้ (${shift.countedAt}) เกิดก่อนใบปิดกะล่าสุดในระบบกลาง (Z ${c.lastZNo} นับเมื่อ ${c.lastZUntil}) — ออกใบปิดกะต่อเลขนั้นไม่ได้ เพราะบิลบอทช่วงเดียวกันจะถูกนับซ้ำ ให้เจ้าของร้านตัดสินใจ`)
  }
}
