import { desc, eq, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import type { ShiftSyncMode } from '@dayo/contracts'
import { MAX_ZNO_LIST_LENGTH, recomputeZChainLenient, zReportHash, type LenientZEntry, type SalesSummary } from '@dayo/domain'
import { DAYO_KEYS, readKey, writeKey } from '../sync/state'
import type { StoredZSnapshot, ZReportDto } from './types'

/*
 * This device's z_report rows read back (Task 13 fix round 1: moved out of close.ts unchanged, so close.ts and
 * central-z.ts share ONE hash check and ONE gap rule without an import cycle). close.ts re-exports deviceZRows.
 */

/** `snapshot_json` read as raw text, never through the column's own JSON decode (review I-1) — a hand-edited row
 * can hold text that is not valid JSON at all, and letting the driver's `JSON.parse` run on it would throw before
 * this module ever sees the row, crashing `listZReports` for every Z on the device, not just the broken one. */
export type ZRawRow = { id: string; shiftId: string; hash: string; createdAt: string; snapshotText: string }

/** `undefined` (not a throw) when `text` is not valid JSON. */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Narrows to "parsed enough to be treated as a snapshot": an object with a `sales` object (review I-1). Other
 * missing/malformed fields of an otherwise-parseable snapshot are handled by the safe accessors below, but a
 * missing `sales` is treated the same as unreadable JSON — the shape `listZReports` most depends on. */
function hasSales(v: unknown): v is { sales: SalesSummary } {
  return typeof v === 'object' && v !== null && typeof (v as { sales?: unknown }).sales === 'object' && (v as { sales?: unknown }).sales !== null
}

/** A number read from a snapshot that may have been edited by hand — null unless it is a safe integer. */
export function safeIntOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null
}

/** A string read from a snapshot that may have been edited by hand — null unless it actually is one. */
export function safeStrOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** A boolean read from a snapshot that may have been edited by hand — null unless it actually is one. */
export function safeBoolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

/**
 * z_report.snapshot_json is written only by writeZ from buildZReport — read back as that shape, and `hashOk`
 * proves it is untouched. Review I-1: a row a person edited by hand may hold invalid JSON, or JSON missing `sales`
 * — `toZReportDto` never throws on either; it reports `hashOk: false` and `snapshot: null` instead, so a broken Z
 * shows up as a flagged row rather than crashing the whole list (or `getZReport`) for every Z on the device.
 */
export function toZReportDto(row: ZRawRow): ZReportDto {
  const parsed = tryParseJson(row.snapshotText)
  if (!hasSales(parsed)) return { id: row.id, shiftId: row.shiftId, createdAt: row.createdAt, hash: row.hash, hashOk: false, snapshot: null }
  const snapshot = parsed as StoredZSnapshot
  let hashOk: boolean
  try {
    hashOk = zReportHash(snapshot) === row.hash
  } catch {
    hashOk = false // a hand-edited number JSON.parse reads as Infinity (1e400) cannot be hashed — it is not what writeZ froze
  }
  return { id: row.id, shiftId: row.shiftId, createdAt: row.createdAt, hash: row.hash, hashOk, snapshot }
}

/** Newest first by **insertion order** (`rowid`), never by the snapshot's own `zNo` (review NF-1 · NF-3): `z_report`
 * is append-only (its `INSERT`-only trigger), so `rowid` — SQLite's own monotonic row-creation order, immune to any
 * `json_set` on `snapshot_json` — always finds the row `writeZ` really wrote last. Sorting by the *claimed*
 * `zNo` instead (the original bug) let a hand-edited last row's own `zNo` sort it out of the `rows[0]` position —
 * silently hiding the true last Z (and its money) from `zChain`'s "previous Z" check, and separately let a
 * hand-edited *middle* row's `zNo` sort it *into* that position forever, demanding the owner's PIN on every future
 * close for no reason. Exported for backup.ts. `snapshot_json` is still selected as raw text (review I-1).
 *
 * Review R2-7: this depends on `rowid` staying insertion order for `z_report`. A future migration that rebuilds
 * this table (drizzle's `INSERT INTO __new… SELECT …` has no `ORDER BY`) must copy it `ORDER BY rowid`, and any
 * restore/re-seed of a device's database from the server (Postgres has no `rowid`) must insert its Z rows back in
 * `zNo` (or `created_at`) order. Getting this wrong would misidentify the "previous Z" — but the `zNo === row
 * count` check below still catches it as a *false* `Z_CHAIN_BROKEN`, never as silent data loss. */
export async function deviceZRows(db: RemoteDb, deviceId: string): Promise<(ZRawRow & { syncMode: ShiftSyncMode })[]> {
  const rowid = sql`"z_report"."rowid"`
  return db
    .select({ id: s.zReport.id, shiftId: s.zReport.shiftId, hash: s.zReport.hash, createdAt: s.zReport.createdAt, snapshotText: sql<string>`${s.zReport.snapshotJson}`, syncMode: s.shift.syncMode })
    .from(s.zReport)
    .innerJoin(s.shift, eq(s.shift.id, s.zReport.shiftId))
    .where(eq(s.shift.deviceId, deviceId))
    .orderBy(desc(rowid))
    .all()
}

/**
 * Reads a stored snapshot's individual sales fields for `recomputeZChainLenient` — every field is `null` when it
 * is missing or not a safe integer (never a throw: this only feeds the lenient recompute, review C-1). `zNo` too
 * is read defensively here; ordering by it is `orderForLenientRecompute`'s job, not this function's.
 */
export function toLenientEntry(row: ZRawRow): LenientZEntry {
  const parsed = tryParseJson(row.snapshotText) as { zNo?: unknown; sales?: { grossSalesSatang?: unknown; discountSatang?: unknown; voidedSatang?: unknown; netSalesSatang?: unknown } } | undefined
  const sales = parsed?.sales
  return {
    shiftId: row.shiftId,
    zNo: safeIntOrNull(parsed?.zNo),
    grossSalesSatang: safeIntOrNull(sales?.grossSalesSatang),
    discountSatang: safeIntOrNull(sales?.discountSatang),
    voidedSatang: safeIntOrNull(sales?.voidedSatang),
    netSalesSatang: safeIntOrNull(sales?.netSalesSatang),
  }
}

/**
 * 2026-09-21 · D55 (review R4-1, R4-2): the Z-row gap the chain is *expected* to carry — `chainWarning.zNoGap` of
 * the most recent row (insertion order, `rows` is newest first) whose hash verifies and which records one, or 0
 * when none does. An acknowledgement records how many Z rows were known missing at that moment (its own `zNo`
 * minus the row count including itself); every clean Z after it grows both by one, so the gap is unchanged until
 * a row is deleted again. Comparing against it — never skipping the check because some Z carries a warning —
 * means an acknowledged gap is never asked about twice, while any later deletion (of any row, including the
 * acknowledging Z itself, which takes its record with it) changes the gap and is caught at the very next close.
 *
 * A row whose hash does not verify is skipped (its record cannot be trusted), so a hand-edited acknowledgement
 * falls back to an older one or to 0 — a false alarm at worst, never a silent pass. The cheap text check skips
 * parsing and hashing every row that cannot hold a recorded gap (almost all of them).
 */
export function expectedZNoGap(rows: readonly ZRawRow[]): number {
  for (const row of rows) {
    if (!row.snapshotText.includes('"zNoGap"')) continue
    const dto = toZReportDto(row)
    if (!dto.hashOk || dto.snapshot === null) continue
    const warning: unknown = dto.snapshot.chainWarning
    const gap = typeof warning === 'object' && warning !== null ? safeIntOrNull((warning as { zNoGap?: unknown }).zNoGap) : null
    if (gap !== null && gap >= 0) return gap
  }
  return 0
}

/**
 * Task 13 fix round 1 (security M): the highest Z number this device has used — never below what its rows prove, even
 * when the newest row fails its hash: the larger of every stored zNo (`recomputeZChainLenient`'s maxStoredZNo — the
 * zNo of every hash-ok row among them) and the row count plus the gap already acknowledged (D55 `expectedZNoGap`).
 * 0 = no Z yet. A hand-edited stored zNo can only raise it (the R9 path then stays off and the D53–D55 checks of
 * writeZ name the broken row) — never lower it back under dayo's last Z.
 */
export async function deviceLastZNo(db: RemoteDb, deviceId: string): Promise<number> {
  const rows = await deviceZRows(db, deviceId)
  const high = floorWithinReach(await readDeviceZHigh(db), rows) // fix round 2: never below the highest number this device issued
  if (rows.length === 0) return high
  const lenient = recomputeZChainLenient([...rows].reverse().map(toLenientEntry))
  return Math.max(high, lenient.maxStoredZNo, rows.length + expectedZNoGap(rows))
}

/**
 * Task 14 · carried item 10 (T13 ruling, R2-2 style): a stored Z-number floor (device_z_high, central_z_floor) is trusted only
 * up to what the Z rows can prove — their count + the gap already acknowledged + MAX_ZNO_LIST_LENGTH. Every real floor is
 * within that (each Z row raises both sides by one; a continuation records its jump as the gap); a hand-edited sync_state
 * pushed out of reach (to int4 max, say) is ignored (0) instead of dragging every later Z number out of range.
 */
export function floorWithinReach(floor: number, rows: readonly ZRawRow[]): number {
  return floor <= rows.length + expectedZNoGap(rows) + MAX_ZNO_LIST_LENGTH ? floor : 0
}

/** dayo z_reports.z_no is an int4: a high-water above this would push every later Z out of range (never trusted). */
const MAX_TRUSTED_Z_HIGH = 2_147_483_646

/**
 * Task 13 fix round 2 (security M): the highest zNo this device ever issued (sync_state dayo.device_z_high), or 0.
 * Unlike the Z rows it survives a hand-edit of snapshot_json and is never cleared by a new E1 read, so a Z that
 * continued dayo's numbering keeps the R9 path shut for good and floors the lenient numbering (close.ts). A value that
 * is not a whole number in 1..int4−1 (a hand-edited sync_state) is ignored — it could otherwise block every Z.
 */
export async function readDeviceZHigh(db: RemoteDb): Promise<number> {
  return readZNoKey(db, DAYO_KEYS.deviceZHigh)
}

/** Task 13 fix round 2: the zNo of the Z that continued dayo's numbering (sync_state dayo.central_z_floor), or 0 — same rules. */
export async function readCentralZFloor(db: RemoteDb): Promise<number> {
  return readZNoKey(db, DAYO_KEYS.centralZFloor)
}

async function readZNoKey(db: RemoteDb, key: string): Promise<number> {
  const raw = await readKey(db, key)
  if (raw === null || !/^[1-9][0-9]{0,9}$/.test(raw)) return 0
  const n = Number(raw)
  return n <= MAX_TRUSTED_Z_HIGH ? n : 0
}

/** In writeZ's transaction: raise the high-water to `zNo` (never lower it). */
export async function raiseDeviceZHigh(tx: RemoteDb, zNo: number): Promise<void> {
  if (zNo > (await readDeviceZHigh(tx))) await writeKey(tx, DAYO_KEYS.deviceZHigh, String(zNo))
}
