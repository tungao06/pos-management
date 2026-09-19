import { canonicalJson, sha256Hex } from './hash.js'
import { assertSafeInt } from './money.js'

/**
 * Inputs to `expectedCashSatang`, one field per source of shift / order / cash_movement rows (spec §4.3, §4.8, D36).
 * Every cash_movement kind maps to exactly one field, so no row is ever counted twice.
 *
 * - `openingFloatSatang` — `shift.opening_float_satang`, recorded when the shift opens.
 * - `cashSalesSatang` — sum of CASH `payment.amount_satang` for orders paid during the shift, including orders
 *   voided later (the money came in; handing it back is a separate VOID_REFUND row).
 * - `voidRefundsSatang` — sum of `cash_movement` rows of kind VOID_REFUND. The system writes one automatically
 *   when a cash-paid order is voided (the cash handed back from the drawer); a person never enters it.
 * - `paidInSatang` — sum of `cash_movement` rows of kind PAID_IN (entered by a person, e.g. topping up the drawer).
 * - `paidOutSatang` — sum of `cash_movement` rows of kind PAID_OUT (entered by a person, e.g. buying ice).
 *   Void refunds are never PAID_OUT rows (D36), so this is simply every PAID_OUT row of the shift.
 * - `dropsSatang` — sum of `cash_movement` rows of kind DROP (cash removed to the safe).
 *
 * expected = opening + cash_sales − void_refunds + paid_in − paid_out − drops
 */
export type CashInputs = {
  openingFloatSatang: number
  cashSalesSatang: number
  voidRefundsSatang: number
  paidInSatang: number
  paidOutSatang: number
  dropsSatang: number
}

export function expectedCashSatang(x: CashInputs): number {
  return x.openingFloatSatang + x.cashSalesSatang - x.voidRefundsSatang + x.paidInSatang - x.paidOutSatang - x.dropsSatang
}

function assertNonNegInt(n: number, name: string): void {
  assertSafeInt(n, name)
  if (n < 0) throw new RangeError(`${name} must be >= 0, got ${n}`)
}

/** Same values as contracts `CashMovementKind` (spec §3.5, D36) — domain stays free of the contracts package. */
export type CashKind = 'PAID_IN' | 'PAID_OUT' | 'DROP' | 'VOID_REFUND'

/** Sums the shift's cash_movement rows into `CashInputs`; each row lands in exactly one field (D36). */
export function cashInputsFromMovements(
  openingFloatSatang: number,
  cashSalesSatang: number,
  movements: readonly { kind: CashKind; amountSatang: number }[],
): CashInputs {
  assertNonNegInt(openingFloatSatang, 'openingFloatSatang')
  assertNonNegInt(cashSalesSatang, 'cashSalesSatang')
  const x: CashInputs = { openingFloatSatang, cashSalesSatang, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 }
  for (const m of movements) {
    assertSafeInt(m.amountSatang, 'amountSatang')
    if (m.amountSatang <= 0) throw new RangeError(`cash movement amount must be > 0, got ${m.amountSatang}`)
    if (m.kind === 'VOID_REFUND') x.voidRefundsSatang += m.amountSatang
    else if (m.kind === 'PAID_IN') x.paidInSatang += m.amountSatang
    else if (m.kind === 'PAID_OUT') x.paidOutSatang += m.amountSatang
    else x.dropsSatang += m.amountSatang
  }
  return x
}

/** One order of the shift that got a receipt number: paid, or paid and voided later (spec §4.3 keeps it in gross). */
export type ShiftOrder = {
  id: string
  status: 'paid' | 'voided'
  subtotalSatang: number
  discountSatang: number
  totalSatang: number
  payments: readonly { method: 'CASH' | 'PROMPTPAY'; amountSatang: number }[]
}

/**
 * Sales of one shift (spec §4.3, §4.8).
 * - `orderCount` — every receipt of the shift, voided ones included · `voidCount` — the voided ones.
 * - `grossSalesSatang` — Σ subtotal of every receipt (voided included, spec §4.3) · `discountSatang` — Σ discount of the same.
 * - `voidedSatang` — Σ total of the voided receipts.
 * - `netSalesSatang` = gross − discount − voided = Σ total of the receipts still paid (Q3b-4 · D52).
 * - `cashSalesSatang` / `qrSalesSatang` — money received by method, voided receipts included (the refund is a
 *   separate VOID_REFUND / transfer back), so cash + qr = gross − discount.
 * - `qrRefundedSatang` — PromptPay money of the voided receipts, transferred back to the customer (D48 Q3-15) ·
 *   `qrNetSatang` = qr − qr refunded: what the bank app should show for the shift (Q3b-12 · D53).
 */
export type SalesSummary = {
  orderCount: number
  voidCount: number
  grossSalesSatang: number
  discountSatang: number
  voidedSatang: number
  netSalesSatang: number
  cashSalesSatang: number
  qrSalesSatang: number
  qrRefundedSatang: number
  qrNetSatang: number
}

export function summarizeShiftSales(orders: readonly ShiftOrder[]): SalesSummary {
  const s: SalesSummary = {
    orderCount: 0,
    voidCount: 0,
    grossSalesSatang: 0,
    discountSatang: 0,
    voidedSatang: 0,
    netSalesSatang: 0,
    cashSalesSatang: 0,
    qrSalesSatang: 0,
    qrRefundedSatang: 0,
    qrNetSatang: 0,
  }
  for (const o of orders) {
    assertNonNegInt(o.subtotalSatang, 'subtotalSatang')
    assertNonNegInt(o.discountSatang, 'discountSatang')
    assertNonNegInt(o.totalSatang, 'totalSatang')
    if (o.totalSatang !== o.subtotalSatang - o.discountSatang) throw new RangeError(`order ${o.id}: total ≠ subtotal − discount`)
    let paid = 0
    for (const p of o.payments) {
      assertNonNegInt(p.amountSatang, 'payment amountSatang')
      paid += p.amountSatang
      if (p.method === 'CASH') s.cashSalesSatang += p.amountSatang
      else {
        s.qrSalesSatang += p.amountSatang
        if (o.status === 'voided') s.qrRefundedSatang += p.amountSatang
      }
    }
    if (paid !== o.totalSatang) throw new RangeError(`order ${o.id}: payments ${paid} ≠ total ${o.totalSatang} (spec §4.1)`)
    s.orderCount += 1
    s.grossSalesSatang += o.subtotalSatang
    s.discountSatang += o.discountSatang
    if (o.status === 'voided') {
      s.voidCount += 1
      s.voidedSatang += o.totalSatang
    }
  }
  s.netSalesSatang = s.grossSalesSatang - s.discountSatang - s.voidedSatang // Q3b-4 · D52
  s.qrNetSatang = s.qrSalesSatang - s.qrRefundedSatang // Q3b-12 · D53
  return s
}

/** Throws unless the summary is internally consistent — the relations `summarizeShiftSales` guarantees (Plan 1 notes §4). */
export function assertSalesSummary(s: SalesSummary): void {
  for (const [k, v] of Object.entries(s)) assertNonNegInt(v, k)
  if (s.voidCount > s.orderCount) throw new RangeError('voidCount > orderCount')
  if (s.discountSatang > s.grossSalesSatang) throw new RangeError('discount > gross')
  if (s.netSalesSatang !== s.grossSalesSatang - s.discountSatang - s.voidedSatang) throw new RangeError('net ≠ gross − discount − voided') // Q3b-4 · D52
  if (s.cashSalesSatang + s.qrSalesSatang !== s.grossSalesSatang - s.discountSatang) throw new RangeError('cash + qr ≠ gross − discount')
  if (s.qrRefundedSatang > s.qrSalesSatang || s.qrRefundedSatang > s.voidedSatang) throw new RangeError('qr refunded > qr sales or > voided')
  if (s.qrNetSatang !== s.qrSalesSatang - s.qrRefundedSatang) throw new RangeError('qr net ≠ qr − qr refunded') // Q3b-12 · D53
}

/** Notes and coins counted at shift close, largest first, in satang — spec §5 table 1000/500/100/50/20/10/5/2/1, no satang coins (Q3b-1 · D52). */
export const CASH_DENOMINATIONS_SATANG: readonly number[] = [100_000, 50_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100]
export const MAX_PIECES_PER_DENOMINATION = 99_999

export type CashCountLine = { denominationSatang: number; count: number }

/** Normalizes a drawer count to one line per denomination (largest first, missing = 0) and sums it exactly. */
export function tallyCashCount(lines: readonly CashCountLine[]): { lines: CashCountLine[]; totalSatang: number } {
  const counts = new Map<number, number>()
  for (const l of lines) {
    if (!CASH_DENOMINATIONS_SATANG.includes(l.denominationSatang)) throw new RangeError(`unknown denomination ${l.denominationSatang}`)
    if (counts.has(l.denominationSatang)) throw new RangeError(`denomination ${l.denominationSatang} counted twice`)
    if (!Number.isSafeInteger(l.count) || l.count < 0 || l.count > MAX_PIECES_PER_DENOMINATION) {
      throw new RangeError(`count of ${l.denominationSatang} must be a whole number 0–${MAX_PIECES_PER_DENOMINATION}, got ${l.count}`)
    }
    counts.set(l.denominationSatang, l.count)
  }
  const out = CASH_DENOMINATIONS_SATANG.map((d) => ({ denominationSatang: d, count: counts.get(d) ?? 0 }))
  return { lines: out, totalSatang: out.reduce((a, l) => a + l.denominationSatang * l.count, 0) }
}

/** spec §3.1 setting `cash.variance_alert_satang` default (฿20). */
export const DEFAULT_VARIANCE_ALERT_SATANG = 2_000

/** spec §4.8: a shortage or overage strictly greater than the alert threshold needs a reason. */
export function varianceNeedsReason(varianceSatang: number, alertSatang: number): boolean {
  assertSafeInt(varianceSatang, 'varianceSatang')
  assertNonNegInt(alertSatang, 'alertSatang')
  return Math.abs(varianceSatang) > alertSatang
}

/** A voided receipt as frozen into the Z report — the daily void report (D50 Q3-22). Names are frozen too. */
export type ZVoid = {
  orderId: string
  receiptNo: string
  totalSatang: number
  method: 'CASH' | 'PROMPTPAY'
  reason: string
  made: boolean
  approvedBy: string
  approvedByName: string
  refundReference: string | null
  voidedAt: string
}

/**
 * Q3b-11 · D53: the previous Z of this device failed its hash check, and an owner acknowledged it with their PIN.
 * Frozen into the new Z for good (it is part of the hashed snapshot) and shown wherever that Z is shown.
 */
export type ZChainWarning = {
  /** Shift of the previous Z whose snapshot no longer matches its hash. */
  brokenShiftId: string
  /** The grand total that broken snapshot claims (not trusted — null if it is not even a whole number). */
  storedGrandTotalSatang: number | null
  /** Σ net of every earlier Z snapshot of this device, in `zNo` order (`recomputeZChain`) — what this Z chains from. */
  recomputedGrandTotalSatang: number
  /** The owner who acknowledged the broken chain with their PIN. */
  acknowledgedBy: string
}

export type ZInput = {
  shiftId: string
  businessDate: string
  deviceId: string
  /** Z number of this device: previous Z's zNo + 1, starting at 1 — the grand-total chain follows this, never the clock. */
  zNo: number
  openedAt: string
  openedBy: string
  /** "เปิดกะด่วน" (spec §4.8 · Q3b-10 · D52). */
  openedQuick: boolean
  closedAt: string
  /** The owner who confirmed the close with their PIN (Q3b-2 · D52). */
  closedBy: string
  /** The signed-in user who counted the drawer. */
  countedBy: string
  sales: SalesSummary
  cash: CashInputs
  countLines: CashCountLine[]
  countedCashSatang: number
  varianceAlertSatang: number
  varianceReason: string | null
  voids: ZVoid[]
  /** PromptPay total the owner read from the bank app for this shift, or null when not entered (Q3b-12 · D53). */
  bankQrTotalSatang: number | null
  /** Set when the previous Z failed its hash check (Q3b-11 · D53); null otherwise. */
  chainWarning: ZChainWarning | null
}

export type ZSnapshot = ZInput & {
  expectedCashSatang: number
  cashVarianceSatang: number
  /** bank − net QR (Q3b-12 · D53) · null when no bank total was entered. */
  qrDifferenceSatang: number | null
  grandTotalSatang: number
}

/** Hash of a Z snapshot (or of any JSON read back from `z_report.snapshot_json`) — invariant 6 of spec §7. */
export function zReportHash(snapshot: unknown): string {
  return sha256Hex(canonicalJson(snapshot))
}

/**
 * Q3b-11 · D53: when the previous Z fails its hash, the chain is rebuilt from every earlier Z snapshot of the device
 * (in `zNo` order): the Z count and Σ net. A healthy chain gives exactly the stored values of the last Z
 * (Z(n).grand = Σ net of Z1…Zn, Z(n).zNo = n), so this only differs where a snapshot's stored total was edited.
 */
export function recomputeZChain(netSalesSatang: readonly number[]): { zNo: number; grandTotalSatang: number } {
  let grand = 0
  for (const [i, net] of netSalesSatang.entries()) {
    assertNonNegInt(net, `net of Z #${i + 1}`)
    grand += net
  }
  assertSafeInt(grand, 'grandTotalSatang')
  return { zNo: netSalesSatang.length, grandTotalSatang: grand }
}

/**
 * Frozen Z report: computed once at shift close, never recomputed (spec §4.8). Refuses an inconsistent input
 * (Plan 1 notes §4): sales relations, cash sales on both sides, the count total, the void list (count, total, cash
 * voids = VOID_REFUND rows, QR voids = QR refunded), and a missing reason when the variance is above the alert
 * threshold. Z(n).grand = Z(n−1).grand + net of this shift, chained on `zNo` (the previous Z's snapshot), never on the
 * clock — a device clock can be wrong and later corrected. With a `chainWarning`, `prev` is the recomputed chain.
 */
export function buildZReport(input: ZInput, prev: { zNo: number; grandTotalSatang: number } | null): { snapshot: ZSnapshot; hash: string } {
  const prevZNo = prev?.zNo ?? 0
  const prevGrand = prev?.grandTotalSatang ?? 0
  assertNonNegInt(prevZNo, 'prev.zNo')
  assertNonNegInt(prevGrand, 'prev.grandTotalSatang')
  if (input.zNo !== prevZNo + 1) throw new RangeError(`zNo must be ${prevZNo + 1}, got ${input.zNo}`)
  assertSalesSummary(input.sales)
  for (const [k, v] of Object.entries(input.cash)) assertNonNegInt(v, `cash.${k}`)
  if (input.cash.cashSalesSatang !== input.sales.cashSalesSatang) throw new RangeError('cash.cashSalesSatang must equal sales.cashSalesSatang')
  const tally = tallyCashCount(input.countLines)
  if (tally.totalSatang !== input.countedCashSatang) throw new RangeError('countedCashSatang must equal the sum of countLines')
  if (input.voids.length !== input.sales.voidCount) throw new RangeError('voids must list every voided receipt')
  if (input.voids.reduce((a, v) => a + v.totalSatang, 0) !== input.sales.voidedSatang) throw new RangeError('Σ voids.totalSatang must equal sales.voidedSatang')
  const voidSum = (method: ZVoid['method']): number => input.voids.filter((v) => v.method === method).reduce((a, v) => a + v.totalSatang, 0)
  if (voidSum('CASH') !== input.cash.voidRefundsSatang) throw new RangeError('Σ cash voids must equal cash.voidRefundsSatang (D36)')
  if (voidSum('PROMPTPAY') !== input.sales.qrRefundedSatang) throw new RangeError('Σ PromptPay voids must equal sales.qrRefundedSatang')
  if (input.bankQrTotalSatang !== null) assertNonNegInt(input.bankQrTotalSatang, 'bankQrTotalSatang')
  const w = input.chainWarning
  if (w !== null) {
    if (w.brokenShiftId === '' || w.acknowledgedBy === '') throw new RangeError('chainWarning needs the broken shift and the acknowledging owner')
    if (w.storedGrandTotalSatang !== null) assertSafeInt(w.storedGrandTotalSatang, 'chainWarning.storedGrandTotalSatang')
    if (prev === null || w.recomputedGrandTotalSatang !== prevGrand) throw new RangeError('with a chainWarning, prev must be the recomputed chain')
  }
  const expected = expectedCashSatang(input.cash)
  const variance = input.countedCashSatang - expected
  const reason = input.varianceReason?.trim() ?? ''
  if (varianceNeedsReason(variance, input.varianceAlertSatang) && reason === '') {
    throw new RangeError('a cash variance above the alert threshold needs a reason (spec §4.8)')
  }
  const snapshot: ZSnapshot = {
    ...input,
    countLines: tally.lines,
    varianceReason: reason === '' ? null : reason,
    expectedCashSatang: expected,
    cashVarianceSatang: variance,
    qrDifferenceSatang: input.bankQrTotalSatang === null ? null : input.bankQrTotalSatang - input.sales.qrNetSatang,
    grandTotalSatang: prevGrand + input.sales.netSalesSatang,
  }
  return { snapshot, hash: zReportHash(snapshot) }
}
