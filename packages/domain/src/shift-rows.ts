import { bangkokDateOf, TEXT_MAX_CODE_POINTS, type CashCountRowData, type CashMovementRowData, type ShiftCloseRowData, type ShiftOpenRowData } from '@dayo/contracts'
import { edgeSatangToBaht as b } from './money-edge.js'
import { assertSafeInt } from './money.js'
import { isoUtcMs, MAX_BOT_BILLS, tallyCashCount, zReportHash, type CashCountLine, type CashKind, type ZSnapshot } from './shift.js'

/**
 * `data` of the four E2 shift kinds (spec 04 §4.10 · dayo 0066). Money leaves as baht through `edgeSatangToBaht` only —
 * which also refuses anything above numeric(10,2) (99,999,999.99) — and every object is rebuilt from an explicit field
 * list, so nothing a caller or a stored snapshot carries besides the contract's fields ever reaches dayo.
 * Each builder refuses what dayo would reject INVALID forever and the tablet can already see.
 */

export const MAX_Z_POS_BILLS = 2000
/** Same cap as shift.ts `MAX_BOT_BILLS` (dayo 0066:415-417) — one value, two names. */
export const MAX_Z_BOT_BILLS = MAX_BOT_BILLS
export const MAX_Z_MOVEMENTS = 500
/** dayo's cash payment code — the only cash side of `pos_bills` (spec §4.10 การคิดซ้ำ ข้อ 2). */
export const CASH_PAYMENT_CODE = 'cash'

const HEX64 = /^[0-9a-f]{64}$/

/** Ruling R20 · spec §4.10 m4: dayo refuses a Z over these caps (INVALID) — the tablet refuses first. */
export class ZTooLargeError extends RangeError {
  constructor(what: string, n: number, max: number) {
    super(`Z_TOO_LARGE: ${what} ${n} > ${max}`)
    this.name = 'ZTooLargeError'
  }
}

/** The one form the contract takes for a sent instant (`…mmmZ`): the same instant, checked by `isoUtcMs`. */
const sentIso = (iso: string, name: string): string => new Date(isoUtcMs(iso, name)).toISOString()

export type ShiftOpenRowInput = { shiftId: string; businessDate: string; openedAt: string; openedBy: string; openingFloatSatang: number; quickOpen: boolean }

/** shift_open (dayo 0066:58-132): business_date is the Thai date of opened_at (0066:96-99). */
export function buildShiftOpenRowData(i: ShiftOpenRowInput): ShiftOpenRowData {
  const openedAt = sentIso(i.openedAt, 'openedAt')
  if (bangkokDateOf(openedAt) !== i.businessDate) throw new RangeError(`businessDate ${i.businessDate} is not the Thai date of openedAt ${openedAt} (dayo 0066:96-99)`)
  return { shift_id: i.shiftId, business_date: i.businessDate, opened_at: openedAt, opened_by: i.openedBy, opening_float: b(i.openingFloatSatang), quick_open: i.quickOpen }
}

export type CashMovementRowInput = { movementId: string; shiftId: string; kind: CashKind; amountSatang: number; posOrderId: string | null; reason: string | null; createdBy: string; createdAt: string }

/** cash_movement (dayo 0066:137-226): amount > 0 · pos_order_id with (and only with) VOID_REFUND · a reason for the other kinds. */
export function buildCashMovementRowData(i: CashMovementRowInput): CashMovementRowData {
  if (!Number.isSafeInteger(i.amountSatang) || i.amountSatang <= 0) throw new RangeError(`cash movement amount must be whole satang > 0, got ${i.amountSatang}`)
  if (i.kind !== 'PAID_IN' && i.kind !== 'PAID_OUT' && i.kind !== 'DROP' && i.kind !== 'VOID_REFUND') throw new RangeError(`unknown cash movement kind ${String(i.kind)}`)
  if ((i.kind === 'VOID_REFUND') !== (i.posOrderId !== null)) throw new RangeError('only VOID_REFUND carries pos_order_id, and it always does (spec §4.10)')
  // dayo_pos_is_text: a reason, when there is one, is never blank — for VOID_REFUND too (0066:171-173)
  if (i.reason !== null && (i.reason.trim() === '' || [...i.reason].length > TEXT_MAX_CODE_POINTS)) {
    throw new RangeError(`a reason is 1–${TEXT_MAX_CODE_POINTS} code points, never blank (dayo_pos_is_text)`)
  }
  if (i.kind !== 'VOID_REFUND' && i.reason === null) throw new RangeError(`${i.kind} needs a reason (D52 Q3b-9)`)
  return {
    movement_id: i.movementId, shift_id: i.shiftId, kind: i.kind, amount: b(i.amountSatang), pos_order_id: i.posOrderId, reason: i.reason,
    created_by: i.createdBy, created_at: sentIso(i.createdAt, 'createdAt'),
  }
}

export type CashCountRowInput = { countId: string; shiftId: string; lines: readonly CashCountLine[]; countedBy: string; countedAt: string }

/** cash_count (dayo 0066:231-320): nine lines, largest first, counted = Σ (0066:253-272). */
export function buildCashCountRowData(i: CashCountRowInput): CashCountRowData {
  const t = tallyCashCount(i.lines)
  return {
    count_id: i.countId, shift_id: i.shiftId,
    lines: t.lines.map((l) => ({ denomination: b(l.denominationSatang), count: l.count })), // satang → baht only at the edge (review item 8) · whole-baht notes/coins (D52 Q3b-1)
    counted: b(t.totalSatang), counted_by: i.countedBy, counted_at: sentIso(i.countedAt, 'countedAt'),
  }
}

export type ZPosBill = { posOrderId: string; receiptNo: string; paymentCode: string; totalSatang: number; soldAt: string; voidedAt: string | null }
export type ShiftCloseRowInput = { snapshot: ZSnapshot; hash: string; prevHash: string | null; countId: string; posBills: readonly ZPosBill[]; movementIds: readonly string[] }

function assertUnique(values: readonly string[], what: string): void {
  const seen = new Set<string>()
  for (const v of values) {
    if (seen.has(v)) throw new RangeError(`${what} ${v} listed twice (dayo 0066 — INVALID)`)
    seen.add(v)
  }
}

/**
 * spec 04 §4.10 shift_close + z_report — built from the frozen snapshot only; the lists are the shift's rows at Z time.
 * Never recomputes the Z: it only refuses a snapshot/list pair dayo would reject INVALID forever (0066:325-561).
 */
export function buildShiftCloseRowData(i: ShiftCloseRowInput): ShiftCloseRowData {
  const z = i.snapshot
  if (z.botWindow === null) throw new RangeError('a Z sent to dayo needs its bot window (ruling R6: local-only Zs are never sent)')
  if (i.posBills.length > MAX_Z_POS_BILLS) throw new ZTooLargeError('pos_bills', i.posBills.length, MAX_Z_POS_BILLS)
  if (z.botBills.length > MAX_Z_BOT_BILLS) throw new ZTooLargeError('bot_bills', z.botBills.length, MAX_Z_BOT_BILLS)
  if (i.movementIds.length > MAX_Z_MOVEMENTS) throw new ZTooLargeError('movement_ids', i.movementIds.length, MAX_Z_MOVEMENTS)
  if (typeof i.hash !== 'string' || !HEX64.test(i.hash)) throw new RangeError('hash must be 64 lowercase hex')
  if (i.prevHash !== null && (typeof i.prevHash !== 'string' || !HEX64.test(i.prevHash))) throw new RangeError('prevHash must be 64 lowercase hex or null')
  // the hash dayo keeps must be the one the tablet's chain verifies — a caller passing another Z's hash is a bug, not a Z
  if (zReportHash(z) !== i.hash) throw new RangeError('hash is not the hash of this snapshot')
  const c = z.cash
  if (c.drawerExpensesSatang !== 0) throw new RangeError('drawer expenses must be 0 in block 3 (dayo 0066:398-400 · ADR-0057)')
  if (z.varianceReason !== null && [...z.varianceReason].length > TEXT_MAX_CODE_POINTS) {
    throw new RangeError(`varianceReason must be at most ${TEXT_MAX_CODE_POINTS} code points (dayo 0066:370-373)`)
  }
  assertUnique(i.movementIds, 'movement id')
  assertUnique(i.posBills.map((p) => p.posOrderId), 'pos bill')
  const until = isoUtcMs(z.countedAt, 'countedAt')
  let posCash = 0
  const posBills = i.posBills.map((p) => {
    const soldAt = sentIso(p.soldAt, `pos bill ${p.receiptNo} soldAt`)
    if (Date.parse(soldAt) > until) throw new RangeError(`bill ${p.receiptNo} sold after countedAt — the shift was frozen (D101)`)
    const voidedAt = p.voidedAt === null ? null : sentIso(p.voidedAt, `pos bill ${p.receiptNo} voidedAt`)
    const total = b(p.totalSatang)
    if (p.paymentCode === CASH_PAYMENT_CODE) {
      posCash += p.totalSatang
      assertSafeInt(posCash, 'Σ pos_bills cash')
    }
    return { pos_order_id: p.posOrderId, receipt_no: p.receiptNo, payment: p.paymentCode, total, sold_at: soldAt, voided_at: voidedAt }
  })
  if (posCash !== c.cashSalesSatang) throw new RangeError(`pos_bills cash ${posCash} ≠ cash.cashSalesSatang ${c.cashSalesSatang}`)
  return {
    shift_id: z.shiftId, count_id: i.countId, closed_by: z.closedBy, closed_at: sentIso(z.closedAt, 'closedAt'), variance_reason: z.varianceReason,
    z_report: {
      z_no: z.zNo, hash: i.hash, prev_hash: i.prevHash, variance_alert: b(z.varianceAlertSatang), chain_warning: z.chainWarning !== null,
      cash: {
        opening_float: b(c.openingFloatSatang), pos_cash_sales: b(c.cashSalesSatang), void_refunds: b(c.voidRefundsSatang), paid_in: b(c.paidInSatang),
        paid_out: b(c.paidOutSatang), drops: b(c.dropsSatang), drawer_expenses: b(c.drawerExpensesSatang), bot_cash: b(c.botCashSatang),
      },
      counted: b(z.countedCashSatang),
      bot_window: { after: sentIso(z.botWindow.after, 'botWindow.after'), until: sentIso(z.botWindow.until, 'botWindow.until') },
      movement_ids: [...i.movementIds],
      bot_bills: z.botBills.map((x) => ({ order_no: x.orderNo, version: x.version, total: b(x.totalSatang) })),
      pos_bills: posBills,
    },
  }
}
