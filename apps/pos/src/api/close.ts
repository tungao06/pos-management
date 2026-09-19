import { desc, eq, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { buildZReport, recomputeZChainLenient, tallyCashCount, varianceNeedsReason, zReportHash, type LenientZEntry, type SalesSummary, type ZChainWarning, type ZSnapshot } from '@dayo/domain'
import { enqueueOutbox } from '../db/outbox'
import { requireOwnerPin } from './auth'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { buildShiftReport, shiftReportFingerprint } from './shift-report'
import { REASON_MAX_LENGTH, type CloseShiftInput, type ZReportDto, type ZReportSummaryDto } from './types'

/** audit_log action written when an owner acknowledges a previous Z that fails its hash (Q3b-11 · D53). */
export const Z_CHAIN_ACK_ACTION = 'z_chain_broken_ack'

/** `snapshot_json` read as raw text, never through the column's own JSON decode (review I-1) — a hand-edited row
 * can hold text that is not valid JSON at all, and letting the driver's `JSON.parse` run on it would throw before
 * this module ever sees the row, crashing `listZReports` for every Z on the device, not just the broken one. */
type ZRawRow = { id: string; shiftId: string; hash: string; createdAt: string; snapshotText: string }

/** `undefined` (not a throw) when `text` is not valid JSON. */
function tryParseJson(text: string): unknown {
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
function safeIntOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null
}

/** A string read from a snapshot that may have been edited by hand — null unless it actually is one. */
function safeStrOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** A boolean read from a snapshot that may have been edited by hand — null unless it actually is one. */
function safeBoolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

/**
 * z_report.snapshot_json is written only by closeShift from buildZReport — read back as that shape, and `hashOk`
 * proves it is untouched. Review I-1: a row a person edited by hand may hold invalid JSON, or JSON missing `sales`
 * — `toZReportDto` never throws on either; it reports `hashOk: false` and `snapshot: null` instead, so a broken Z
 * shows up as a flagged row rather than crashing the whole list (or `getZReport`) for every Z on the device.
 */
function toZReportDto(row: ZRawRow): ZReportDto {
  const parsed = tryParseJson(row.snapshotText)
  if (!hasSales(parsed)) return { id: row.id, shiftId: row.shiftId, createdAt: row.createdAt, hash: row.hash, hashOk: false, snapshot: null }
  const snapshot = parsed as ZSnapshot
  return { id: row.id, shiftId: row.shiftId, createdAt: row.createdAt, hash: row.hash, hashOk: zReportHash(snapshot) === row.hash, snapshot }
}

/** Newest first by `zNo` (the frozen snapshot), never by `created_at` — a device clock can be wrong and later
 * corrected, and the grand-total chain must not depend on it (see domain `buildZReport`). Exported for backup.ts.
 * `snapshot_json` is selected as raw text (review I-1): ordering by `json_extract` still needs a `json_valid`
 * guard, because SQLite's `json_extract` raises a hard "malformed JSON" error (not just a NULL) on a row a person
 * hand-edited into invalid JSON — unguarded, that one bad row would fail the whole query, not just its own decode. */
export async function deviceZRows(db: RemoteDb, deviceId: string): Promise<ZRawRow[]> {
  const zNo = sql`case when json_valid(${s.zReport.snapshotJson}) then json_extract(${s.zReport.snapshotJson}, '$.zNo') else null end`
  return db
    .select({ id: s.zReport.id, shiftId: s.zReport.shiftId, hash: s.zReport.hash, createdAt: s.zReport.createdAt, snapshotText: sql<string>`${s.zReport.snapshotJson}` })
    .from(s.zReport)
    .innerJoin(s.shift, eq(s.shift.id, s.zReport.shiftId))
    .where(eq(s.shift.deviceId, deviceId))
    .orderBy(desc(zNo), desc(s.zReport.id))
    .all()
}

/**
 * Reads a stored snapshot's individual sales fields for `recomputeZChainLenient` — every field is `null` when it
 * is missing or not a safe integer (never a throw: this only feeds the lenient recompute, review C-1). `zNo` too
 * is read defensively here; ordering by it is `orderForLenientRecompute`'s job, not this function's.
 */
function toLenientEntry(row: ZRawRow): LenientZEntry {
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

/** Oldest first, by `zNo` when it is readable; a row whose `zNo` is not (a whole edit, or JSON gone entirely) keeps
 * its place in the device's own row order (review C-1 · Q3b-16 · D54) — `recomputeZChainLenient` never throws on
 * either. `rows` comes from `deviceZRows`, newest first; stably sorting its reverse (oldest first already) by
 * `zNo` only moves the readable rows, since `Array.prototype.sort` is stable and ties keep their relative order. */
function orderForLenientRecompute(rows: readonly ZRawRow[]): ZRawRow[] {
  return [...rows]
    .reverse()
    .map((r) => ({ r, zNo: safeIntOrNull((tryParseJson(r.snapshotText) as { zNo?: unknown } | undefined)?.zNo) }))
    .sort((a, b) => (a.zNo ?? Number.MAX_SAFE_INTEGER) - (b.zNo ?? Number.MAX_SAFE_INTEGER))
    .map((x) => x.r)
}

/**
 * spec §4.8 + D22 + D36: close the open shift. One transaction writes cash_count, the frozen z_report (snapshot +
 * hash, never recomputed) and the shift status change, each with its outbox row (spec §6.1). The drawer count is by
 * denomination (Q3b-1); a variance above `cash.variance_alert_satang` needs a reason; an owner confirms with their
 * PIN (Q3b-2). If the shift's figures moved between the screen showing them and this call — expected cash, sales,
 * QR or voids — nothing is written (SHIFT_CHANGED, Q3b-17 · D54, review m-1). The bank-app QR total is optional and
 * frozen with its difference (Q3b-12). Q3b-16 · D54 (review C-1): a previous Z that fails its hash (or whose earlier
 * chain can't be recomputed at all) always refuses with the dedicated `Z_CHAIN_BROKEN`, never `BAD_INPUT` — it must
 * never block closing forever. Once the owner acknowledges it by entering their PIN again, the new Z chains from a
 * lenient recompute that never throws (`recomputeZChainLenient`), carries `chainWarning` for good (naming every Z
 * whose net it could not trust as-is), and an audit row records the acknowledgement.
 */
export async function closeShift(db: RemoteDb, deps: ApiDeps, input: CloseShiftInput): Promise<ZReportDto> {
  let tally: ReturnType<typeof tallyCashCount>
  try {
    tally = tallyCashCount(input.countLines)
  } catch (e) {
    throw new PosError('BAD_INPUT', e instanceof Error ? e.message : String(e))
  }
  if (!Number.isSafeInteger(input.shownExpectedCashSatang)) throw new PosError('BAD_INPUT', 'shownExpectedCashSatang must be whole satang')
  if (input.bankQrTotalSatang !== null && (!Number.isSafeInteger(input.bankQrTotalSatang) || input.bankQrTotalSatang < 0)) {
    throw new PosError('BAD_INPUT', 'bankQrTotalSatang must be a whole number of satang >= 0, or null')
  }
  const reason = input.varianceReason?.trim() ?? ''
  if (reason.length > REASON_MAX_LENGTH) throw new PosError('BAD_INPUT', `a reason is at most ${REASON_MAX_LENGTH} characters`)
  const actor = await db.select().from(s.user).where(eq(s.user.id, input.actorUserId)).get()
  if (!actor || !actor.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${input.actorUserId}`)
  // argon2 is slow — check the PIN before opening the transaction (same as voidOrder).
  const approver = await requireOwnerPin(db, deps, input.approverUserId, input.approverPin)
  const device = await requireDevice(db)

  return db.transaction(async (tx) => {
    const shift = await currentOpenShift(tx, device.id)
    if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'no open shift to close')
    const at = deps.now()
    const report = await buildShiftReport(tx, shift, at)
    // Q3b-17 · D54, review m-1: expected cash alone used to be the only figure checked — a PromptPay sale or void
    // made while the screen was open left cash untouched and slipped through. The fingerprint covers every figure
    // the Z snapshot freezes (sales, cash, QR, voids); expected cash is kept only for a readable error detail.
    if (report.expectedCashSatang !== input.shownExpectedCashSatang || shiftReportFingerprint(report) !== input.shownReportFingerprint) {
      throw new PosError('SHIFT_CHANGED', `shown ${input.shownExpectedCashSatang}, now ${report.expectedCashSatang}`)
    }
    const variance = tally.totalSatang - report.expectedCashSatang
    if (varianceNeedsReason(variance, report.varianceAlertSatang) && reason === '') {
      throw new PosError('VARIANCE_REASON_REQUIRED', `variance ${variance} is above ${report.varianceAlertSatang}`)
    }

    // Q3b-16 · D54 (review C-1): the previous Z of this device, or null for the first one. A broken (unreadable or
    // hash-mismatched) last Z always refuses with Z_CHAIN_BROKEN first — never a thrown RangeError/BAD_INPUT from
    // here — and only builds `chainWarning` (from the never-throwing lenient recompute) once acknowledged.
    const rows = await deviceZRows(tx, device.id)
    const last = rows[0]
    let prev: { zNo: number; grandTotalSatang: number } | null = null
    let chainWarning: ZChainWarning | null = null
    if (last !== undefined) {
      const lastDto = toZReportDto(last)
      if (lastDto.hashOk && lastDto.snapshot !== null) {
        prev = { zNo: lastDto.snapshot.zNo, grandTotalSatang: lastDto.snapshot.grandTotalSatang }
      } else if (!input.acknowledgeZChainBroken) {
        throw new PosError('Z_CHAIN_BROKEN', last.shiftId)
      } else {
        const lenient = recomputeZChainLenient(orderForLenientRecompute(rows).map(toLenientEntry))
        const storedGrand = safeIntOrNull((tryParseJson(last.snapshotText) as { grandTotalSatang?: unknown } | undefined)?.grandTotalSatang)
        prev = { zNo: lenient.zNo, grandTotalSatang: lenient.grandTotalSatang }
        chainWarning = {
          brokenShiftId: last.shiftId,
          storedGrandTotalSatang: storedGrand,
          recomputedGrandTotalSatang: lenient.grandTotalSatang,
          acknowledgedBy: approver.id,
          unreadableZs: lenient.unreadable,
        }
      }
    }

    let z: ReturnType<typeof buildZReport>
    try {
      z = buildZReport(
        {
          shiftId: shift.id,
          businessDate: shift.businessDate,
          deviceId: device.id,
          zNo: (prev?.zNo ?? 0) + 1,
          openedAt: shift.openedAt,
          openedBy: shift.openedBy,
          openedQuick: report.shift.openedQuick,
          closedAt: at,
          closedBy: approver.id,
          countedBy: actor.id,
          sales: report.sales,
          cash: report.cash,
          countLines: tally.lines,
          countedCashSatang: tally.totalSatang,
          varianceAlertSatang: report.varianceAlertSatang,
          varianceReason: reason === '' ? null : reason,
          voids: report.voids,
          bankQrTotalSatang: input.bankQrTotalSatang,
          chainWarning,
        },
        prev,
      )
    } catch (e) {
      if (e instanceof RangeError) throw new PosError('BAD_INPUT', e.message)
      throw e
    }

    const countRow = {
      id: deps.newId(),
      shiftId: shift.id,
      countedSatang: tally.totalSatang,
      expectedSatang: report.expectedCashSatang,
      varianceSatang: variance,
      reason: z.snapshot.varianceReason,
      linesJson: tally.lines,
      countedBy: actor.id,
      createdAt: at,
    } satisfies typeof s.cashCount.$inferInsert
    await tx.insert(s.cashCount).values(countRow)
    await enqueueOutbox(tx, 'cash_count', countRow, at, deps.newId)

    // z_report is append-only (trigger) and unique per shift: a second close of the same shift cannot happen.
    const zRow = { id: deps.newId(), shiftId: shift.id, snapshotJson: z.snapshot, hash: z.hash, createdAt: at } satisfies typeof s.zReport.$inferInsert
    await tx.insert(s.zReport).values(zRow)
    await enqueueOutbox(tx, 'z_report', zRow, at, deps.newId)

    if (chainWarning !== null) {
      await tx.insert(s.auditLog).values({
        id: deps.newId(),
        entity: 'z_report',
        entityId: zRow.id,
        action: Z_CHAIN_ACK_ACTION,
        beforeJson: { brokenShiftId: chainWarning.brokenShiftId, storedGrandTotalSatang: chainWarning.storedGrandTotalSatang },
        afterJson: { zNo: z.snapshot.zNo, recomputedGrandTotalSatang: chainWarning.recomputedGrandTotalSatang },
        actorUserId: approver.id,
        at,
      })
    }

    // The only UPDATE of shift in this plan: open → closed (spec §3.5 columns closed_by/closed_at/status; no trigger on shift).
    await tx.update(s.shift).set({ status: 'closed', closedBy: approver.id, closedAt: at }).where(eq(s.shift.id, shift.id))
    const shiftRow = await tx.select().from(s.shift).where(eq(s.shift.id, shift.id)).get()
    if (!shiftRow) throw new PosError('NO_OPEN_SHIFT', shift.id)
    await enqueueOutbox(tx, 'shift', shiftRow, at, deps.newId, 'closed')

    // Built straight from `z` (just produced by `buildZReport`), not read back through `toZReportDto`: its hash is
    // correct by construction, and `snapshotText` above only exists to survive a hand-edited row from the DB.
    return { id: zRow.id, shiftId: zRow.shiftId, createdAt: zRow.createdAt, hash: zRow.hash, hashOk: true, snapshot: z.snapshot }
  })
}

/** Z reports of this device, newest first (Q3b-5: view on screen, no export). Review I-1: a Z whose snapshot cannot
 * be read (invalid JSON, or missing `sales`) still gets a row — `hashOk: false` and every snapshot-derived field
 * null — instead of one bad Z crashing the whole list. */
export async function listZReports(db: RemoteDb): Promise<ZReportSummaryDto[]> {
  const device = await requireDevice(db)
  return (await deviceZRows(db, device.id)).map((row) => {
    const z = toZReportDto(row)
    const snap = z.snapshot
    return {
      shiftId: z.shiftId,
      businessDate: safeStrOrNull(snap?.businessDate),
      zNo: safeIntOrNull(snap?.zNo),
      closedAt: safeStrOrNull(snap?.closedAt),
      netSalesSatang: safeIntOrNull(snap?.sales?.netSalesSatang),
      cashVarianceSatang: safeIntOrNull(snap?.cashVarianceSatang),
      openedQuick: safeBoolOrNull(snap?.openedQuick),
      hashOk: z.hashOk,
      chainWarning: snap?.chainWarning != null,
    }
  })
}

/** Review I-1: reads `snapshot_json` as raw text, same as `deviceZRows` — a hand-edited row that is not valid JSON
 * (or is missing `sales`) comes back as `hashOk: false` / `snapshot: null` rather than throwing. */
export async function getZReport(db: RemoteDb, shiftId: string): Promise<ZReportDto> {
  const row = await db
    .select({ id: s.zReport.id, shiftId: s.zReport.shiftId, hash: s.zReport.hash, createdAt: s.zReport.createdAt, snapshotText: sql<string>`${s.zReport.snapshotJson}` })
    .from(s.zReport)
    .where(eq(s.zReport.shiftId, shiftId))
    .get()
  if (!row) throw new PosError('Z_NOT_FOUND', shiftId)
  return toZReportDto(row)
}
