import { and, desc, eq, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { buildZReport, MAX_ZNO_LIST_LENGTH, recomputeZChainLenient, tallyCashCount, varianceNeedsReason, zReportHash, type LenientZEntry, type SalesSummary, type ZChainWarning, type ZSnapshot } from '@dayo/domain'
import { enqueueOutbox } from '../db/outbox'
import { requireOwnerPin } from './auth'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { buildShiftReport } from './shift-report'
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

/** Newest first by **insertion order** (`rowid`), never by the snapshot's own `zNo` (review NF-1 · NF-3): `z_report`
 * is append-only (its `INSERT`-only trigger), so `rowid` — SQLite's own monotonic row-creation order, immune to any
 * `json_set` on `snapshot_json` — always finds the row `closeShift` really wrote last. Sorting by the *claimed*
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
export async function deviceZRows(db: RemoteDb, deviceId: string): Promise<ZRawRow[]> {
  const rowid = sql`"z_report"."rowid"`
  return db
    .select({ id: s.zReport.id, shiftId: s.zReport.shiftId, hash: s.zReport.hash, createdAt: s.zReport.createdAt, snapshotText: sql<string>`${s.zReport.snapshotJson}` })
    .from(s.zReport)
    .innerJoin(s.shift, eq(s.shift.id, s.zReport.shiftId))
    .where(eq(s.shift.deviceId, deviceId))
    .orderBy(desc(rowid))
    .all()
}

/**
 * Closed shifts of this device, more recently closed than the last surviving Z's own shift, that have no
 * `z_report` row at all (review R2-4) — a whole Z row deleted, not merely edited. `closeShift` writes exactly one
 * closed `shift` and one `z_report` row per close, in the same transaction, so in the healthy case there is never
 * a closed shift more recent than the last Z's; any that turn up here had their Z deleted, and their money cannot
 * be recomputed, only named.
 *
 * Deliberately bounded to *after* the last surviving Z (never a full-history scan): once a gap like this has been
 * acknowledged and named in some later Z's `chainWarning`, that shift's own closed row permanently has no Z of its
 * own to match — a full-history "closed count == Z count" check would flag it forever, which is exactly the
 * perpetual block Q3b-16 · D54 forbids. Bounding the scan to "since the last known-good Z" means the very next
 * close, once it has written its own Z for the shift it just closed, finds nothing after *that* Z and is clean.
 */
async function deletedShiftIds(db: RemoteDb, deviceId: string, rows: readonly ZRawRow[]): Promise<string[]> {
  const rowid = sql<number>`"shift"."rowid"`
  const closed = await db
    .select({ id: s.shift.id, rowid })
    .from(s.shift)
    .where(and(eq(s.shift.deviceId, deviceId), eq(s.shift.status, 'closed')))
    .orderBy(desc(rowid))
    .all()
  const last = rows[0]
  if (last === undefined) return closed.map((c) => c.id) // closed shifts exist, but this device has no Z row at all
  const lastShift = closed.find((c) => c.id === last.shiftId)
  if (lastShift === undefined) return closed.map((c) => c.id) // defensive: the last Z's own shift is not even closed — treat everything as suspect
  return closed.filter((c) => c.rowid > lastShift.rowid).map((c) => c.id)
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
function expectedZNoGap(rows: readonly ZRawRow[]): number {
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

/** Oldest first — simply `deviceZRows`' own insertion order, reversed (review NF-1 · NF-3): never the snapshot's own
 * `zNo`, which is exactly what a hand-edit can move around. `recomputeZChainLenient` never throws on any input, so
 * this needs no fallback logic of its own; it is not exported because insertion order is a `close.ts` concern
 * (`deviceZRows` already establishes it), not a rule the domain layer should know about. */
function orderForLenientRecompute(rows: readonly ZRawRow[]): ZRawRow[] {
  return [...rows].reverse()
}

/**
 * spec §4.8 + D22 + D36: close the open shift. One transaction writes cash_count, the frozen z_report (snapshot +
 * hash, never recomputed) and the shift status change, each with its outbox row (spec §6.1). The drawer count is by
 * denomination (Q3b-1); a variance above `cash.variance_alert_satang` needs a reason; an owner confirms with their
 * PIN (Q3b-2). If the shift's figures moved between the screen showing them and this call — expected cash, sales,
 * QR or voids — nothing is written (SHIFT_CHANGED, Q3b-17 · D54, review m-1). The bank-app QR total is optional and
 * frozen with its difference (Q3b-12). Q3b-16 · D54 (review C-1): a previous Z that fails its hash, or whose chain
 * is otherwise broken (a Z row deleted, review R2-4 · Q3b-18), always refuses with the dedicated `Z_CHAIN_BROKEN`,
 * never `BAD_INPUT` — it must never block closing forever. Once the owner acknowledges it by entering their PIN
 * again, the new Z chains from the last Z's own numbers when it is itself trustworthy (Q3b-18 · D55), or otherwise
 * from a lenient recompute that never throws (`recomputeZChainLenient`); either way it carries `chainWarning` for
 * good (naming what it can), and an audit row records the acknowledgement.
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
    // made while the screen was open left cash untouched and slipped through. `report.fingerprint` (review NF-6)
    // covers every figure the Z snapshot freezes (the shift itself, sales, cash, QR, voids); expected cash is kept
    // only for a readable error detail.
    if (report.expectedCashSatang !== input.shownExpectedCashSatang || report.fingerprint !== input.shownReportFingerprint) {
      throw new PosError('SHIFT_CHANGED', `shown ${input.shownExpectedCashSatang}, now ${report.expectedCashSatang}`)
    }
    const variance = tally.totalSatang - report.expectedCashSatang
    if (varianceNeedsReason(variance, report.varianceAlertSatang) && reason === '') {
      throw new PosError('VARIANCE_REASON_REQUIRED', `variance ${variance} is above ${report.varianceAlertSatang}`)
    }

    // Q3b-16 · D54 (review C-1, NF-1, NF-3, R2-3, R2-4; Q3b-18 · D55): the previous Z of this device — by
    // insertion order (`deviceZRows`), never the snapshot's own `zNo` — or null for the first one. "Trustworthy"
    // (`lastHealthy`, below) means the last row's hash verifies, its snapshot is readable, and its own claimed
    // `grandTotalSatang` is a safe integer >= 0 — deliberately *not* "its `zNo` equals the Z row count" (that used
    // to be part of "healthy" too, but a middle Z deleted permanently leaves the row count one short forever, so
    // checking it on every future close would demand the owner's PIN forever once acknowledged — see
    // `unacknowledgedZNoGap`, below).
    //
    // The chain is broken (refuses with `Z_CHAIN_BROKEN` first, never a thrown RangeError/BAD_INPUT) when:
    //   - the last row is not trustworthy by the above (review NF-1/R2-3: catches a hand-edit even where the hash
    //     was also recomputed to match it — the hash has no secret key — whether that targets `grandTotalSatang`
    //     directly or corrupts the snapshot some other way);
    //   - a whole Z row was deleted rather than merely edited, and it was this device's own *last* Z (review
    //     R2-4): no closed shift of this device may be more recent than the last surviving Z's own shift
    //     (`deletedShiftIds`) — trustworthiness above cannot see this, because both the last row's own `zNo` and
    //     the physical row count shrink by one together;
    //   - a *middle* Z row was deleted (Q3b-18 · D55): the last row is otherwise perfectly trustworthy, but its
    //     own `zNo` minus the row count is not the gap the chain already acknowledged (`expectedZNoGap`, 2026-09-21,
    //     review R4-1/R4-2; see `unacknowledgedZNoGap`).
    // Once acknowledged: if the last row is trustworthy, the new Z chains from *its own* `zNo`/`grandTotalSatang`
    // (Q3b-18 · D55) — never a lenient recompute over the survivors, which would silently drop the missing Z's own
    // net from the running total that feeds VAT (D8). Only when the last row is itself untrustworthy is there
    // nothing left to chain from but the never-throwing lenient recompute (Q3b-16 · D54). Either way,
    // `chainWarning` names what it can (`missingZNos`, `deletedShiftIds`, …) and an audit row records the
    // acknowledgement; a deleted Z's own money is never reconstructed, only made visible.
    //
    // A *middle* row's own hash failing (without a row being deleted) is deliberately not checked here (no
    // full-chain verify): D53's Q3b-11 wording is "the previous Z" (ใบก่อน), singular, and `listZReports` already
    // surfaces any such row as `hashOk: false` on its own (review m-4 of fix round 1a) without demanding the
    // owner's PIN on every future close for a shift it has no bearing on. Nothing is silently hidden — it just
    // does not block closing.
    const rows = await deviceZRows(tx, device.id)
    const last = rows[0]
    const deletedIds = await deletedShiftIds(tx, device.id, rows)
    const lastDto = last !== undefined ? toZReportDto(last) : null
    const lastSnapshot = lastDto?.snapshot ?? null
    const lastGrand = lastSnapshot !== null ? safeIntOrNull(lastSnapshot.grandTotalSatang) : null
    // Q3b-18 · D55: "trustworthy" no longer requires `zNo === rows.length` — that check exists only to catch a
    // *middle* Z row deleted (below), not to decide whether the last Z's own numbers can be trusted.
    const lastHealthy = last !== undefined && lastDto !== null && lastDto.hashOk && lastSnapshot !== null && lastGrand !== null && lastGrand >= 0
    // The last Z's own claimed zNo minus the row count — how many Z rows are gone (a middle Z deleted leaves the
    // physical count short for good; the missing row never comes back). 2026-09-21 (review R4-1, R4-2): compared
    // against the gap already acknowledged (`expectedZNoGap`), on every close. The earlier guard skipped the check
    // whenever the last Z carried a `chainWarning`, which re-asked for the same gap every second close forever
    // (the perpetual ask Q3b-16 · D54 forbids) and hid a new deletion made while that Z was last. `deletedShiftIds`
    // is a separate check, bounded to "since the last surviving Z" (review R2-4).
    const lastZNo = lastSnapshot !== null ? safeIntOrNull(lastSnapshot.zNo) : null
    const unacknowledgedZNoGap = lastHealthy && (lastZNo === null || lastZNo - rows.length !== expectedZNoGap(rows))

    let prev: { zNo: number; grandTotalSatang: number } | null = null
    let chainWarning: ZChainWarning | null = null
    let maxStoredZNo = 0 // review NF-4: named in the audit row alongside rowCount; 0 when the chain is healthy (nothing to name)
    if (last !== undefined || deletedIds.length > 0) {
      if (lastHealthy && deletedIds.length === 0 && !unacknowledgedZNoGap && lastSnapshot !== null) {
        prev = { zNo: lastSnapshot.zNo, grandTotalSatang: lastSnapshot.grandTotalSatang }
      } else if (!input.acknowledgeZChainBroken) {
        throw new PosError('Z_CHAIN_BROKEN', deletedIds[0] ?? last!.shiftId)
      } else {
        // Naming only (`unreadableZs`/duplicate·missingZNos) — never its own `zNo`/`grandTotalSatang` once the
        // last Z is itself trustworthy; see below.
        const lenient = recomputeZChainLenient(orderForLenientRecompute(rows).map(toLenientEntry))
        maxStoredZNo = lenient.maxStoredZNo
        // Q3b-18 · D55: when the last Z is itself trustworthy, chain from ITS OWN zNo/grand, never the lenient
        // recompute over the survivors. Its numbers were frozen truthfully at its own close time — before
        // whatever happened since (a middle Z deleted, this device's own last Z's shift deleted) — so they
        // already include every earlier Z's true contribution. Re-folding just the survivors instead (the
        // pre-D55 behaviour) silently dropped the missing Z's own net from the running total that feeds VAT
        // (D8): deleting the middle Z of three gave ฿140 instead of the true ฿190. Only when the last Z is
        // itself unreadable/hash-broken/invalid is there nothing trustworthy left to chain from but the lenient
        // recompute (Q3b-16 · D54, unchanged).
        //
        // 2026-09-21 (review R4-1): a last Z claiming fewer Zs than there are rows (`lastZNo < rows.length` — only
        // a forged hash or a Z table restored out of order, review R2-7, gets here) cannot be the head of the chain
        // it sits on: its gap would be negative, which `buildZReport` rightly rejects — forever, since the same row
        // is read every time. It goes the lenient way instead, which renumbers from the row count and sums every
        // surviving row's net.
        const trustLast = lastHealthy && lastSnapshot !== null && lastZNo !== null && lastZNo >= rows.length
        prev = trustLast ? { zNo: lastZNo, grandTotalSatang: lastSnapshot.grandTotalSatang } : { zNo: lenient.zNo, grandTotalSatang: lenient.grandTotalSatang }
        const storedGrand = trustLast ? lastGrand : last !== undefined ? safeIntOrNull((tryParseJson(last.snapshotText) as { grandTotalSatang?: unknown } | undefined)?.grandTotalSatang) : null
        chainWarning = {
          brokenShiftId: deletedIds[0] ?? last!.shiftId,
          storedGrandTotalSatang: storedGrand,
          recomputedGrandTotalSatang: prev.grandTotalSatang,
          acknowledgedBy: approver.id,
          unreadableZs: lenient.unreadable,
          duplicateZNos: lenient.duplicateZNos,
          duplicateZNosTruncated: lenient.duplicateZNosTruncated,
          missingZNos: lenient.missingZNos,
          missingZNosTruncated: lenient.missingZNosTruncated,
          deletedShiftIds: deletedIds.slice(0, MAX_ZNO_LIST_LENGTH),
          deletedShiftIdsTruncated: deletedIds.length > MAX_ZNO_LIST_LENGTH,
          // 2026-09-21 (review R4-1, R4-2): the new Z's zNo minus the row count including it — the Z rows known
          // missing right now, carried forward by `expectedZNoGap`. 0 on the lenient path (zNo = row count + 1);
          // `lastZNo − rows.length` (>= 0 by `trustLast`) when chaining from a trustworthy last Z.
          zNoGap: prev.zNo + 1 - (rows.length + 1),
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
      // review NF-4: rowCount/maxStoredZNo let a later audit reader see a duplicate/missing zNo happened, even
      // though chainWarning itself only carries the cosmetic duplicateZNos/missingZNos lists, not this raw pair.
      await tx.insert(s.auditLog).values({
        id: deps.newId(),
        entity: 'z_report',
        entityId: zRow.id,
        action: Z_CHAIN_ACK_ACTION,
        beforeJson: { brokenShiftId: chainWarning.brokenShiftId, storedGrandTotalSatang: chainWarning.storedGrandTotalSatang },
        afterJson: { zNo: z.snapshot.zNo, recomputedGrandTotalSatang: chainWarning.recomputedGrandTotalSatang, rowCount: rows.length, maxStoredZNo },
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
