import { desc, eq, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { buildZReport, recomputeZChain, tallyCashCount, varianceNeedsReason, zReportHash, type SalesSummary, type ZChainWarning, type ZSnapshot } from '@dayo/domain'
import { enqueueOutbox } from '../db/outbox'
import { requireOwnerPin } from './auth'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { buildShiftReport } from './shift-report'
import { REASON_MAX_LENGTH, type CloseShiftInput, type ZReportDto, type ZReportSummaryDto } from './types'

/** audit_log action written when an owner acknowledges a previous Z that fails its hash (Q3b-11 · D53). */
export const Z_CHAIN_ACK_ACTION = 'z_chain_broken_ack'

type ZRow = typeof s.zReport.$inferSelect

/** z_report.snapshot_json is written only by closeShift from buildZReport — read back as that shape; hashOk proves it is untouched. */
function toZReportDto(row: ZRow): ZReportDto {
  return { id: row.id, shiftId: row.shiftId, createdAt: row.createdAt, hash: row.hash, hashOk: zReportHash(row.snapshotJson) === row.hash, snapshot: row.snapshotJson as ZSnapshot }
}

/** Newest first by `zNo` (the frozen snapshot), never by `created_at` — a device clock can be wrong and later
 * corrected, and the grand-total chain must not depend on it (see domain `buildZReport`). Exported for backup.ts. */
export async function deviceZRows(db: RemoteDb, deviceId: string): Promise<ZRow[]> {
  const rows = await db
    .select({ z: s.zReport })
    .from(s.zReport)
    .innerJoin(s.shift, eq(s.shift.id, s.zReport.shiftId))
    .where(eq(s.shift.deviceId, deviceId))
    .orderBy(desc(sql`json_extract(${s.zReport.snapshotJson}, '$.zNo')`), desc(s.zReport.id))
    .all()
  return rows.map((r) => r.z)
}

/** A number read from a snapshot that may have been edited by hand — null unless it is a safe integer. */
function safeIntOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null
}

type ZChain = { prev: { zNo: number; grandTotalSatang: number } | null; broken: { shiftId: string; storedGrandTotalSatang: number | null } | null }

/**
 * Z(n).zNo = Z(n−1).zNo + 1 and Z(n).grand = Z(n−1).grand + net (spec §4.8) — the previous Z of this device, or null
 * for the first one. Q3b-11 · D53: if that Z fails its hash, its stored numbers are not trusted — the chain is
 * recomputed from every snapshot of this device in `zNo` order (`recomputeZChain`) and `broken` says which Z it was.
 *
 * Controller ruling (task-6): `recomputeZChain` takes `{ zNo, sales }` snapshots, not a plain array of nets — it
 * re-derives net from each snapshot's own gross/discount/voided (via `assertSalesSummary`) rather than trusting a
 * stored `netSalesSatang` that a coordinated hand-edit could also have changed. A snapshot missing/malformed
 * `sales` (or an unreadable `zNo`) makes `recomputeZChain` throw a RangeError, which the caller maps to BAD_INPUT —
 * a documented known risk of this offline device.
 */
async function zChain(db: RemoteDb, deviceId: string): Promise<ZChain> {
  const rows = await deviceZRows(db, deviceId)
  const last = rows[0]
  if (last === undefined) return { prev: null, broken: null }
  const dto = toZReportDto(last)
  if (dto.hashOk) return { prev: { zNo: dto.snapshot.zNo, grandTotalSatang: dto.snapshot.grandTotalSatang }, broken: null }
  const snapshots = [...rows].reverse().map((r) => {
    const snap = r.snapshotJson as { zNo?: unknown; sales?: SalesSummary } | null
    return { zNo: typeof snap?.zNo === 'number' ? snap.zNo : Number.NaN, sales: snap?.sales as SalesSummary } // a bad zNo also fails recomputeZChain's 1..n check
  })
  const stored = (last.snapshotJson as { grandTotalSatang?: unknown } | null)?.grandTotalSatang
  return { prev: recomputeZChain(snapshots), broken: { shiftId: last.shiftId, storedGrandTotalSatang: safeIntOrNull(stored) } }
}

/**
 * spec §4.8 + D22 + D36: close the open shift. One transaction writes cash_count, the frozen z_report (snapshot +
 * hash, never recomputed) and the shift status change, each with its outbox row (spec §6.1). The drawer count is by
 * denomination (Q3b-1); a variance above `cash.variance_alert_satang` needs a reason; an owner confirms with their
 * PIN (Q3b-2); if the shift changed after the screen showed the expected cash, nothing is written (SHIFT_CHANGED).
 * The bank-app QR total is optional and frozen with its difference (Q3b-12). A previous Z that fails its hash stops the
 * close with Z_CHAIN_BROKEN until the owner acknowledges it by entering their PIN again (Q3b-11 · D53): the new Z then
 * chains from the recomputed total, carries `chainWarning` for good, and an audit row records the acknowledgement.
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
    if (report.expectedCashSatang !== input.shownExpectedCashSatang) {
      throw new PosError('SHIFT_CHANGED', `shown ${input.shownExpectedCashSatang}, now ${report.expectedCashSatang}`)
    }
    const variance = tally.totalSatang - report.expectedCashSatang
    if (varianceNeedsReason(variance, report.varianceAlertSatang) && reason === '') {
      throw new PosError('VARIANCE_REASON_REQUIRED', `variance ${variance} is above ${report.varianceAlertSatang}`)
    }

    let chain: ZChain
    try {
      chain = await zChain(tx, device.id)
    } catch (e) {
      if (e instanceof RangeError) throw new PosError('BAD_INPUT', e.message)
      throw e
    }
    if (chain.broken !== null && !input.acknowledgeZChainBroken) throw new PosError('Z_CHAIN_BROKEN', chain.broken.shiftId)
    const chainWarning: ZChainWarning | null =
      chain.broken === null
        ? null
        : {
            brokenShiftId: chain.broken.shiftId,
            storedGrandTotalSatang: chain.broken.storedGrandTotalSatang,
            recomputedGrandTotalSatang: chain.prev?.grandTotalSatang ?? 0,
            acknowledgedBy: approver.id,
          }

    let z: ReturnType<typeof buildZReport>
    try {
      z = buildZReport(
        {
          shiftId: shift.id,
          businessDate: shift.businessDate,
          deviceId: device.id,
          zNo: (chain.prev?.zNo ?? 0) + 1,
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
        chain.prev,
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

    return toZReportDto(zRow)
  })
}

/** Z reports of this device, newest first (Q3b-5: view on screen, no export). */
export async function listZReports(db: RemoteDb): Promise<ZReportSummaryDto[]> {
  const device = await requireDevice(db)
  return (await deviceZRows(db, device.id)).map((row) => {
    const z = toZReportDto(row)
    return {
      shiftId: z.shiftId,
      businessDate: z.snapshot.businessDate,
      zNo: z.snapshot.zNo,
      closedAt: z.snapshot.closedAt,
      netSalesSatang: z.snapshot.sales.netSalesSatang,
      cashVarianceSatang: z.snapshot.cashVarianceSatang,
      openedQuick: z.snapshot.openedQuick,
      hashOk: z.hashOk,
      chainWarning: z.snapshot.chainWarning != null,
    }
  })
}

export async function getZReport(db: RemoteDb, shiftId: string): Promise<ZReportDto> {
  const row = await db.select().from(s.zReport).where(eq(s.zReport.shiftId, shiftId)).get()
  if (!row) throw new PosError('Z_NOT_FOUND', shiftId)
  return toZReportDto(row)
}
