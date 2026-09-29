import { and, asc, desc, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { rowKey } from '@dayo/contracts'
import {
  buildShiftCloseRowData, buildZReport, cashVarianceSatang, MAX_ZNO_LIST_LENGTH, recomputeZChainLenient, varianceNeedsReason, zReportHash, ZTooLargeError,
  type CashCountLine, type LenientZEntry, type SalesSummary, type ZChainWarning, type ZPosBill,
} from '@dayo/domain'
import { countParentKey, enqueueLocalOnly, enqueuePush } from '../db/outbox'
import { deleteKey } from '../sync/state'
import { botPreviewKey } from './bot-cash'
import { requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { builtRow, notBefore } from './rows'
import { PAYMENT_CODE, type CountSummaryDto, type StoredZSnapshot, type UserDto, type ZReportDto, type ZReportSummaryDto, type ZSettle } from './types'

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
 * z_report.snapshot_json is written only by writeZ from buildZReport — read back as that shape, and `hashOk`
 * proves it is untouched. Review I-1: a row a person edited by hand may hold invalid JSON, or JSON missing `sales`
 * — `toZReportDto` never throws on either; it reports `hashOk: false` and `snapshot: null` instead, so a broken Z
 * shows up as a flagged row rather than crashing the whole list (or `getZReport`) for every Z on the device.
 */
function toZReportDto(row: ZRawRow): ZReportDto {
  const parsed = tryParseJson(row.snapshotText)
  if (!hasSales(parsed)) return { id: row.id, shiftId: row.shiftId, createdAt: row.createdAt, hash: row.hash, hashOk: false, snapshot: null }
  const snapshot = parsed as StoredZSnapshot
  return { id: row.id, shiftId: row.shiftId, createdAt: row.createdAt, hash: row.hash, hashOk: zReportHash(snapshot) === row.hash, snapshot }
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
 * `z_report` row at all (review R2-4) — a whole Z row deleted, not merely edited. `writeZ` writes exactly one
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

/**
 * The zNo the lenient path chains from (review R5-1, 2026-09-21; the new Z is this + 1). Not simply the row count
 * (`recomputeZChainLenient`'s own `zNo`, D54's original rule): that threw away the gap the chain already carries
 * (`expectedGap`), recording `zNoGap: 0` — so after a D55 gap acknowledgement, a later lenient acknowledgement wrote
 * a duplicate zNo, and deleting *that* Z afterwards went silent (the deletion raised the real gap by one while
 * dropping the newest record back to the older, one-higher gap: the two cancelled out). Instead it is the larger of
 *   - the row count plus the gap already acknowledged, which keeps the recorded gap from ever shrinking, and
 *   - the last row's own stored zNo, when it is a safe integer at most `MAX_ZNO_LIST_LENGTH` above the row count —
 *     so the new Z never repeats the (untrustworthy) last Z's number (review R4-3), while a hand-edited huge zNo
 *     cannot push the numbering out of range (review R2-2) and is simply ignored.
 * `writeZ` records `zNoGap` = the new Z's zNo − (row count + 1) = this − row count, which is >= `expectedGap`.
 * Falls back to the row count if the sum is not a safe integer (only a forged `zNoGap` near 2^53 gets there).
 */
function lenientPrevZNo(rows: readonly ZRawRow[], expectedGap: number): number {
  const carried = rows.length + expectedGap
  const base = Number.isSafeInteger(carried + 1) ? carried : rows.length
  const stored = rows[0] !== undefined ? toLenientEntry(rows[0]).zNo : null
  return stored !== null && stored <= rows.length + MAX_ZNO_LIST_LENGTH ? Math.max(base, stored) : base
}

/** Oldest first — simply `deviceZRows`' own insertion order, reversed (review NF-1 · NF-3): never the snapshot's own
 * `zNo`, which is exactly what a hand-edit can move around. `recomputeZChainLenient` never throws on any input, so
 * this needs no fallback logic of its own; it is not exported because insertion order is a `close.ts` concern
 * (`deviceZRows` already establishes it), not a rule the domain layer should know about. */
function orderForLenientRecompute(rows: readonly ZRawRow[]): ZRawRow[] {
  return [...rows].reverse()
}

/** task 14 fix round 1 item 4: `validated` runs once the input and the owner PIN passed, just before the transaction. */
export type CloseShiftHooks = { validated?: () => void }

/** Ruling R7: the earliest counted shift of the same device, counted before this one, that still has no Z — or null. */
export async function earlierCountWithoutZ(tx: RemoteDb, shift: { id: string; deviceId: string; countedAt: string | null }): Promise<string | null> {
  if (shift.countedAt === null) return null
  const r = await tx.select({ id: s.shift.id }).from(s.shift)
    .where(and(eq(s.shift.deviceId, shift.deviceId), eq(s.shift.status, 'counted'), lt(s.shift.countedAt, shift.countedAt), ne(s.shift.id, shift.id)))
    .orderBy(asc(s.shift.countedAt)).limit(1).get()
  return r?.id ?? null
}

/** The count row a Z is issued from — the saved `cash_count` (carried: counted and counted_at of the Z = this row's). */
export type ZCount = { id: string; countedSatang: number; countedBy: string; countedAt: string | null; linesJson: unknown }

/** A shift_close row dayo would refuse forever is refused at save time (R20 caps → Z_TOO_LARGE, anything else BAD_INPUT). */
function builtClose(build: () => ReturnType<typeof buildShiftCloseRowData>): ReturnType<typeof buildShiftCloseRowData> {
  return builtRow('E2 shift_close row', () => {
    try {
      return build()
    } catch (e) {
      if (e instanceof ZTooLargeError) throw new PosError('Z_TOO_LARGE', e.message)
      throw e
    }
  })
}

/**
 * spec 04 §4.10 pos_bills: every receipt of the shift (voided and excluded ones too), `payment` = the dayo code its
 * `order` / `order_off_catalog` row carries (a remap may have changed a non-cash code — R-m4), else the sale's own code.
 * Cash stays cash: the kind of money is always the local payment's (the Z's cash sum is checked against it).
 */
async function zPosBills(tx: RemoteDb, shiftId: string): Promise<ZPosBill[]> {
  const orders = await tx.select().from(s.order)
    .where(and(eq(s.order.shiftId, shiftId), isNotNull(s.order.receiptNo), inArray(s.order.status, ['paid', 'voided'])))
    .orderBy(asc(s.order.receiptNo)).all()
  if (orders.length === 0) return []
  const ids = orders.map((o) => o.id)
  const payments = await tx.select({ orderId: s.payment.orderId, method: s.payment.method }).from(s.payment).where(inArray(s.payment.orderId, ids)).all()
  const queued = await tx.select({ key: s.outbox.idempotencyKey, rowJson: s.outbox.rowJson }).from(s.outbox)
    .where(inArray(s.outbox.idempotencyKey, ids.flatMap((id) => [rowKey('order', id), rowKey('order_off_catalog', id)]))).all()
  const sentCode = new Map<string, string>()
  for (const q of queued) {
    const d = q.rowJson as { pos_order_id?: unknown; payment?: unknown } | null
    if (typeof d?.pos_order_id === 'string' && typeof d.payment === 'string') sentCode.set(d.pos_order_id, d.payment)
  }
  return orders.map((o) => {
    const cash = payments.some((p) => p.orderId === o.id && p.method === 'CASH')
    const named = sentCode.get(o.id) ?? o.paymentCode
    const paymentCode = cash ? PAYMENT_CODE.CASH : named !== null && named !== PAYMENT_CODE.CASH ? named : PAYMENT_CODE.PROMPTPAY
    return { posOrderId: o.id, receiptNo: o.receiptNo!, paymentCode, totalSatang: o.totalSatang, soldAt: o.soldAt ?? o.paidAt ?? o.createdAt, voidedAt: o.voidedAt }
  })
}

/**
 * The Z of a counted shift (D101 · spec §4.8 + §4.10): the chain logic of D53–D55 unchanged; a central shift also queues
 * `shift_close` (parent = its cash_count) in the same transaction as the local Z — a row the builder refuses rolls the Z
 * back (carried item 3). Uses the caller's summary — the same one the screen showed (review item 1) — never builds its
 * own. counted / counted_at come from the saved count row only (dayo compares them with its cash_count: data_conflict).
 * Ruling R7: Zs of this device go out in count order — an earlier counted shift without a Z refuses (Z_NOT_READY).
 *
 * Q3b-16 · D54 (review C-1): a previous Z that fails its hash, or whose chain is otherwise broken (a Z row deleted,
 * review R2-4 · Q3b-18), always refuses with `Z_CHAIN_BROKEN`, never `BAD_INPUT` — it must never block closing forever.
 * Once the owner acknowledges it (their PIN again), the new Z chains from the last Z's own numbers when it is itself
 * trustworthy (Q3b-18 · D55), else from a lenient recompute that never throws; either way it carries `chainWarning`.
 */
export async function writeZ(tx: RemoteDb, deps: ApiDeps, a: { shift: typeof s.shift.$inferSelect; count: ZCount; approver: UserDto; summary: CountSummaryDto; settle: ZSettle }): Promise<ZReportDto> {
  const { shift, count, approver, summary, settle } = a
  // D101 · carried item 3: one counted_at for the shift, its count, the summary (bot window) and the Z
  if (shift.status !== 'counted' || shift.countedAt === null || count.countedAt !== shift.countedAt || summary.countedAt !== shift.countedAt) {
    throw new PosError('Z_NOT_READY', `${shift.id}: the count is not confirmed`)
  }
  const countedAt = shift.countedAt
  const deviceId = shift.deviceId
  const earlier = await earlierCountWithoutZ(tx, shift)
  if (earlier !== null) throw new PosError('Z_NOT_READY', earlier) // R7
  if (shift.syncMode === 'central' && summary.bot === null) throw new PosError('BOT_CASH_REQUIRED', shift.id)

  let variance: number
  try {
    variance = cashVarianceSatang(count.countedSatang, summary.expectedCashSatang) // domain — review item 8
  } catch (e) {
    throw new PosError('BAD_INPUT', e instanceof Error ? e.message : String(e))
  }
  if (varianceNeedsReason(variance, summary.varianceAlertSatang) && settle.varianceReason === null) {
    throw new PosError('VARIANCE_REASON_REQUIRED', `variance ${variance} is at or above ${summary.varianceAlertSatang}`) // D102
  }
  // closed_at ≥ counted_at (buildZReport · dayo 0066): a device clock stepped back after the count stamps the count instant
  const at = notBefore(deps.now(), countedAt)

  // Q3b-16 · D54 (review C-1, NF-1, NF-3, R2-3, R2-4; Q3b-18 · D55): the previous Z of this device — by insertion order
  // (`deviceZRows`), never the snapshot's own `zNo` — or null for the first one. The chain is broken (Z_CHAIN_BROKEN
  // first) when the last row is not trustworthy (hash, readable snapshot, safe grand ≥ 0), when this device's own last Z
  // row was deleted (`deletedShiftIds` — a closed shift more recent than the last Z's), or when a middle Z row was
  // deleted (`unacknowledgedZNoGap` against `expectedZNoGap`). A middle row's own hash failing is not checked here
  // (D53 "the previous Z"): `listZReports` shows it as hashOk false without blocking every future close.
  const rows = await deviceZRows(tx, deviceId)
  const last = rows[0]
  const deletedIds = await deletedShiftIds(tx, deviceId, rows)
  const lastDto = last !== undefined ? toZReportDto(last) : null
  const lastSnapshot = lastDto?.snapshot ?? null
  const lastGrand = lastSnapshot !== null ? safeIntOrNull(lastSnapshot.grandTotalSatang) : null
  const lastHealthy = last !== undefined && lastDto !== null && lastDto.hashOk && lastSnapshot !== null && lastGrand !== null && lastGrand >= 0
  const lastZNo = lastSnapshot !== null ? safeIntOrNull(lastSnapshot.zNo) : null
  const expectedGap = expectedZNoGap(rows)
  const unacknowledgedZNoGap = lastHealthy && (lastZNo === null || lastZNo - rows.length !== expectedGap)

  let prev: { zNo: number; grandTotalSatang: number } | null = null
  let chainWarning: ZChainWarning | null = null
  let maxStoredZNo = 0 // review NF-4: named in the audit row alongside rowCount; 0 when the chain is healthy
  if (last !== undefined || deletedIds.length > 0) {
    if (lastHealthy && deletedIds.length === 0 && !unacknowledgedZNoGap && lastSnapshot !== null) {
      prev = { zNo: lastSnapshot.zNo, grandTotalSatang: lastSnapshot.grandTotalSatang }
    } else if (!settle.acknowledgeZChainBroken) {
      throw new PosError('Z_CHAIN_BROKEN', deletedIds[0] ?? last!.shiftId)
    } else {
      const lenient = recomputeZChainLenient(orderForLenientRecompute(rows).map(toLenientEntry))
      maxStoredZNo = lenient.maxStoredZNo
      // Q3b-18 · D55: a trustworthy last Z chains from ITS OWN zNo/grand (frozen truthfully, the missing Z's net
      // included); only an untrustworthy one falls back to the lenient recompute (Q3b-16 · D54). A last Z claiming fewer
      // Zs than there are rows (review R4-1) goes the lenient way too — its gap would be negative forever.
      const trustLast = lastHealthy && lastSnapshot !== null && lastZNo !== null && lastZNo >= rows.length
      prev = trustLast ? { zNo: lastZNo, grandTotalSatang: lastSnapshot.grandTotalSatang } : { zNo: lenientPrevZNo(rows, expectedGap), grandTotalSatang: lenient.grandTotalSatang }
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
        // 2026-09-21 (review R4-1, R4-2, R5-1): the new Z's zNo minus the row count including it (see expectedZNoGap)
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
        deviceId,
        zNo: (prev?.zNo ?? 0) + 1,
        openedAt: shift.openedAt,
        openedBy: shift.openedBy,
        openedQuick: summary.shift.openedQuick,
        closedAt: at,
        closedBy: approver.id,
        countedBy: count.countedBy,
        countedAt,
        botWindow: summary.bot === null ? null : { after: summary.bot.after, until: summary.bot.until },
        botBills: summary.bot?.bills ?? [],
        sales: summary.sales,
        cash: summary.cash,
        countLines: count.linesJson as CashCountLine[],
        countedCashSatang: count.countedSatang,
        varianceAlertSatang: summary.varianceAlertSatang,
        varianceReason: settle.varianceReason,
        voids: summary.voids,
        bankQrTotalSatang: settle.bankQrTotalSatang,
        chainWarning,
      },
      prev,
    )
  } catch (e) {
    if (e instanceof RangeError) throw new PosError('BAD_INPUT', e.message)
    throw e
  }

  // z_report is append-only (trigger) and unique per shift: a second Z of the same shift cannot happen.
  const zRow = { id: deps.newId(), shiftId: shift.id, snapshotJson: z.snapshot, hash: z.hash, createdAt: at } satisfies typeof s.zReport.$inferInsert
  await tx.insert(s.zReport).values(zRow)
  if (shift.syncMode === 'central') {
    // R-m2: prev_hash = the hash column of this device's previous Z row (Task 13 adds the continuation from dayo's E1)
    const prevHash = last?.hash ?? null
    const posBills = await zPosBills(tx, shift.id)
    const movementIds = (await tx.select({ id: s.cashMovement.id }).from(s.cashMovement).where(eq(s.cashMovement.shiftId, shift.id)).orderBy(asc(s.cashMovement.createdAt), asc(s.cashMovement.id)).all()).map((m) => m.id)
    const data = builtClose(() => buildShiftCloseRowData({ snapshot: z.snapshot, hash: z.hash, prevHash, countId: count.id, posBills, movementIds }))
    await enqueuePush(tx, { kind: 'shift_close', id: shift.id, data, parentKey: countParentKey(count.id) }, at, deps.newId)
  } else {
    await enqueueLocalOnly(tx, 'z_report', zRow, at, deps.newId) // ruling R6: a local-only Z stays on the tablet
  }

  if (chainWarning !== null) {
    // review NF-4: rowCount/maxStoredZNo let a later audit reader see a duplicate/missing zNo happened.
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

  // counted → closed (ruling R2: forward only — trigger shift_status_forward_only)
  await tx.update(s.shift).set({ status: 'closed', closedBy: approver.id, closedAt: at }).where(eq(s.shift.id, shift.id))
  if (shift.syncMode !== 'central') {
    const shiftRow = await tx.select().from(s.shift).where(eq(s.shift.id, shift.id)).get()
    if (!shiftRow) throw new PosError('NO_OPEN_SHIFT', shift.id)
    await enqueueLocalOnly(tx, 'shift', shiftRow, at, deps.newId, 'closed')
  }
  await deleteKey(tx, botPreviewKey(shift.id))

  // Built straight from `z` (just produced by `buildZReport`): its hash is correct by construction.
  return { id: zRow.id, shiftId: zRow.shiftId, createdAt: zRow.createdAt, hash: zRow.hash, hashOk: true, snapshot: z.snapshot }
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
