import { and, asc, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { canonicalJson, cashInputsFromMovements, DEFAULT_VARIANCE_ALERT_SATANG, expectedCashSatang, sha256Hex, summarizeShiftSales, type ShiftOrder, type ZVoid } from '@dayo/domain'
import { toCashMovementDto } from './cash'
import { countPendingSyncItems, currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { getSetting } from './setup'
import { wasQuickOpened } from './shift'
import type { NegativeBaseDto, ShiftDto, ShiftReportDto } from './types'

/** spec §3.1 setting key; not seeded — the default ฿20 applies until plan 5 syncs a value. */
export const VARIANCE_ALERT_SETTING_KEY = 'cash.variance_alert_satang'

export async function varianceAlertSatang(db: RemoteDb, atIso: string): Promise<number> {
  const v = await getSetting(db, VARIANCE_ALERT_SETTING_KEY, atIso)
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : DEFAULT_VARIANCE_ALERT_SATANG
}

/** The VOIDED event payload written by voidOrder (plan 3 Task 13) — the only place the QR refund reference lives (plan 3 notes §5). */
function voidFromEvent(order: typeof s.order.$inferSelect, method: 'CASH' | 'PROMPTPAY', payload: unknown, names: ReadonlyMap<string, string>): ZVoid {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  if (typeof p['reason'] !== 'string' || typeof p['made'] !== 'boolean' || typeof p['approvedBy'] !== 'string' || order.receiptNo === null || order.voidedAt === null) {
    throw new PosError('BAD_INPUT', `voided order ${order.id} has no readable VOIDED event`)
  }
  const ref = p['refundReference']
  return {
    orderId: order.id,
    receiptNo: order.receiptNo,
    totalSatang: order.totalSatang,
    method,
    reason: p['reason'],
    made: p['made'],
    approvedBy: p['approvedBy'],
    approvedByName: names.get(p['approvedBy']) ?? p['approvedBy'],
    refundReference: typeof ref === 'string' ? ref : null,
    voidedAt: order.voidedAt,
  }
}

async function negativeBases(db: RemoteDb): Promise<NegativeBaseDto[]> {
  const rows = await db
    .select({ itemId: s.item.id, code: s.item.code, name: s.item.name, useUnit: s.item.useUnit, onHandMilli: s.itemCostState.onHandMilli })
    .from(s.itemCostState)
    .innerJoin(s.item, eq(s.item.id, s.itemCostState.itemId))
    // D28: only tracked bases — untracked items keep a meaningless negative on-hand row (plan 3 notes §5 → plan 4)
    .where(and(eq(s.item.kind, 'prepared'), eq(s.item.isTracked, true), lt(s.itemCostState.onHandMilli, 0)))
    .orderBy(asc(s.item.code))
    .all()
  return rows
}

/**
 * Everything the X report shows and the Z report freezes, computed from the rows of one shift (spec §4.8).
 * Only receipts (paid, or paid then voided) count; money math is all in @dayo/domain.
 */
export async function buildShiftReport(db: RemoteDb, shift: ShiftDto, atIso: string): Promise<ShiftReportDto> {
  const users = await db.select({ id: s.user.id, displayName: s.user.displayName }).from(s.user).all()
  const names = new Map(users.map((u) => [u.id, u.displayName]))
  const orders = await db
    .select()
    .from(s.order)
    .where(and(eq(s.order.shiftId, shift.id), isNotNull(s.order.receiptNo), inArray(s.order.status, ['paid', 'voided'])))
    .orderBy(asc(s.order.receiptNo))
    .all()
  const ids = orders.map((o) => o.id)
  const payments = ids.length === 0 ? [] : await db.select().from(s.payment).where(inArray(s.payment.orderId, ids)).all()
  const shiftOrders: ShiftOrder[] = orders.map((o) => ({
    id: o.id,
    status: o.status === 'voided' ? 'voided' : 'paid',
    subtotalSatang: o.subtotalSatang,
    discountSatang: o.discountSatang,
    totalSatang: o.totalSatang,
    payments: payments.filter((p) => p.orderId === o.id).map((p) => ({ method: p.method, amountSatang: p.amountSatang })),
  }))
  let sales
  try {
    sales = summarizeShiftSales(shiftOrders)
  } catch (e) {
    throw new PosError('BAD_INPUT', e instanceof Error ? e.message : String(e))
  }

  const movements = await db.select().from(s.cashMovement).where(eq(s.cashMovement.shiftId, shift.id)).orderBy(asc(s.cashMovement.createdAt), asc(s.cashMovement.id)).all()
  const cash = cashInputsFromMovements(shift.openingFloatSatang, sales.cashSalesSatang, movements)

  const voided = orders.filter((o) => o.status === 'voided')
  const voidEvents =
    voided.length === 0
      ? []
      : await db.select().from(s.orderEvent).where(and(inArray(s.orderEvent.orderId, voided.map((o) => o.id)), eq(s.orderEvent.type, 'VOIDED'))).all()
  const voids = voided.map((o) => {
    const ev = voidEvents.find((e) => e.orderId === o.id)
    const method = payments.find((p) => p.orderId === o.id)?.method === 'PROMPTPAY' ? 'PROMPTPAY' : 'CASH'
    return voidFromEvent(o, method, ev?.payloadJson, names)
  })

  const core = {
    shift: { ...shift, openedByName: names.get(shift.openedBy) ?? shift.openedBy, openedQuick: await wasQuickOpened(db, shift.id) },
    generatedAt: atIso,
    sales,
    cash,
    expectedCashSatang: expectedCashSatang(cash),
    varianceAlertSatang: await varianceAlertSatang(db, atIso),
    cashMovements: movements.map(toCashMovementDto),
    voids,
    negativeBases: await negativeBases(db),
    pendingSyncItems: await countPendingSyncItems(db),
  }
  // review NF-6: computed here and handed back as `fingerprint` on the DTO itself, so the close-shift screen (Task
  // 11) just echoes `shiftReport().fingerprint` into `closeShift`'s input — it never needs to import this helper,
  // or drizzle/@dayo/db-schema through it.
  return { ...core, fingerprint: shiftReportFingerprint(core) }
}

/**
 * Q3b-17 · D54: a hash of every report figure that `closeShift`'s SHIFT_CHANGED must guard — the shift itself
 * (review NF-5: so a stale submission can never be replayed against a *different*, later shift with coincidentally
 * identical figures), sales, cash, QR (folded into `sales`) and voids — never `generatedAt`, `cashMovements`
 * (redundant with `cash`), `negativeBases` or `pendingSyncItems`, which are informational and change for reasons
 * unrelated to this shift's money. `buildShiftReport` computes this once and hands it back as `fingerprint` on the
 * DTO (review NF-6); `closeShift` recomputes it from a fresh report and refuses (SHIFT_CHANGED) on any mismatch —
 * not only when `expectedCashSatang` itself moved. Exported for tests, which read `report.fingerprint` in practice.
 */
export function shiftReportFingerprint(report: Omit<ShiftReportDto, 'fingerprint'>): string {
  return sha256Hex(
    canonicalJson({
      shiftId: report.shift.id,
      openedQuick: report.shift.openedQuick,
      sales: report.sales,
      cash: report.cash,
      expectedCashSatang: report.expectedCashSatang,
      varianceAlertSatang: report.varianceAlertSatang,
      voids: report.voids,
    }),
  )
}

/** X report of the open shift (spec §4.8: computed live, any time, nothing written). */
export async function shiftReport(db: RemoteDb, deps: ApiDeps): Promise<ShiftReportDto> {
  const device = await requireDevice(db)
  const shift = await currentOpenShift(db, device.id)
  if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'no open shift')
  return buildShiftReport(db, shift, deps.now())
}
