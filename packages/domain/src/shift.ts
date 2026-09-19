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
    else if (m.kind === 'DROP') x.dropsSatang += m.amountSatang
    else throw new RangeError(`unknown cash movement kind ${String(m.kind)}`) // M-4
  }
  for (const [k, v] of Object.entries(x)) assertSafeInt(v, k) // M-1
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
    if (o.status !== 'paid' && o.status !== 'voided') throw new RangeError(`order ${o.id}: unknown status ${String(o.status)}`) // M-4
    assertNonNegInt(o.subtotalSatang, 'subtotalSatang')
    assertNonNegInt(o.discountSatang, 'discountSatang')
    assertNonNegInt(o.totalSatang, 'totalSatang')
    if (o.totalSatang !== o.subtotalSatang - o.discountSatang) throw new RangeError(`order ${o.id}: total ≠ subtotal − discount`)
    let paid = 0
    for (const p of o.payments) {
      if (p.method !== 'CASH' && p.method !== 'PROMPTPAY') throw new RangeError(`order ${o.id}: unknown payment method ${String(p.method)}`) // M-4
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
  for (const [k, v] of Object.entries(s)) assertSafeInt(v, k) // M-1
  return s
}

/** Throws unless the summary is internally consistent — the relations `summarizeShiftSales` guarantees (Plan 1 notes §4). */
export function assertSalesSummary(s: SalesSummary): void {
  for (const [k, v] of Object.entries(s)) assertNonNegInt(v, k)
  if (s.orderCount === 0 && s.grossSalesSatang !== 0) throw new RangeError('zero orders must mean zero gross') // M-3(b)
  if (s.voidCount > s.orderCount) throw new RangeError('voidCount > orderCount')
  if (s.discountSatang > s.grossSalesSatang) throw new RangeError('discount > gross')
  if (s.netSalesSatang !== s.grossSalesSatang - s.discountSatang - s.voidedSatang) throw new RangeError('net ≠ gross − discount − voided') // Q3b-4 · D52
  if (s.cashSalesSatang + s.qrSalesSatang !== s.grossSalesSatang - s.discountSatang) throw new RangeError('cash + qr ≠ gross − discount')
  if (s.qrRefundedSatang > s.qrSalesSatang || s.qrRefundedSatang > s.voidedSatang) throw new RangeError('qr refunded > qr sales or > voided')
  if (s.voidedSatang - s.qrRefundedSatang > s.cashSalesSatang) throw new RangeError('cash refunded > cash sales') // M-3(a)
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
  /** Σ net of every earlier Z snapshot of this device, in `zNo` order (`recomputeZChainLenient`) — what this Z chains from. */
  recomputedGrandTotalSatang: number
  /** The owner who acknowledged the broken chain with their PIN. */
  acknowledgedBy: string
  /**
   * Q3b-16 · D54: every earlier Z (of any Z, not only the one that failed its hash) whose net could not be taken
   * as gross − discount − voided — `recomputeZChainLenient`'s `unreadable` list. `zNo` is the value that Z's own
   * snapshot claims, or null when that too could not be read. Empty when every earlier Z's net was usable as-is.
   */
  unreadableZs: { shiftId: string; zNo: number | null }[]
  /** zNo values two or more earlier Z's claim (review NF-4) — cheap to name alongside the recompute; empty when every readable zNo is unique. */
  duplicateZNos: number[]
  /** Integers between 1 and the highest zNo any earlier Z claims that none of them claim — a deleted/missing row leaves a gap here (review NF-4). */
  missingZNos: number[]
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
 * (in `zNo` order): the Z count and Σ net, net recomputed from each snapshot's own gross/discount/voided rather than
 * trusted from its stored `netSalesSatang` (a coordinated edit of gross, discount, voided and net together still
 * cannot be detected — an accepted limitation; the frozen `chainWarning` records that the chain was broken).
 * A healthy chain gives exactly the stored values of the last Z (Z(n).grand = Σ net of Z1…Zn, Z(n).zNo = n), so this
 * only differs where a snapshot was edited, a Z row was removed (a zNo gap) or duplicated (a duplicate zNo).
 */
export function recomputeZChain(snapshots: readonly { zNo: number; sales: SalesSummary }[]): { zNo: number; grandTotalSatang: number } {
  let grand = 0
  for (const [i, snap] of snapshots.entries()) {
    if (snap.zNo !== i + 1) throw new RangeError(`zNo must run 1..n with no gaps or duplicates; expected ${i + 1}, got ${snap.zNo}`)
    assertSalesSummary(snap.sales)
    const net = snap.sales.grossSalesSatang - snap.sales.discountSatang - snap.sales.voidedSatang
    grand += net
    assertSafeInt(grand, 'grandTotalSatang')
  }
  return { zNo: snapshots.length, grandTotalSatang: grand }
}

/**
 * One earlier Z as read off a (possibly hand-edited) stored snapshot, field by field — every field is `null` when
 * that field is missing or is not a safe integer. Parsing the raw `snapshot_json` is an app-layer concern (it may
 * not even be valid JSON); this module only ever sees the individual candidate values, so it stays pure and never
 * throws on bad input, unlike `recomputeZChain`.
 */
export type LenientZEntry = {
  shiftId: string
  /** The stored `zNo`, or null when it is missing or not a safe integer — ordering by it is the caller's job. */
  zNo: number | null
  grossSalesSatang: number | null
  discountSatang: number | null
  voidedSatang: number | null
  /** The stored `sales.netSalesSatang`, used only as a fallback when gross/discount/voided are not usable. */
  netSalesSatang: number | null
}

export type LenientZChain = {
  zNo: number
  /** Always a safe, non-negative integer (review NF-2) — every net folded in is itself safe and non-negative, and
   * an entry is skipped (and flagged) rather than added if doing so would push this past `Number.MAX_SAFE_INTEGER`.
   * `buildZReport` can never reject this as `prev.grandTotalSatang`. */
  grandTotalSatang: number
  /** Every entry whose net came from the fallback (path 2 or 3 below), in the order given. */
  unreadable: { shiftId: string; zNo: number | null }[]
  /** zNo values two or more entries claim (review NF-4) — empty when every readable zNo is unique. */
  duplicateZNos: number[]
  /** Integers between 1 and the highest zNo any entry claims that none of them claim (review NF-4) — empty when there is no gap. */
  missingZNos: number[]
  /** Highest zNo any entry claims, or 0 when none of them have a readable zNo (review NF-4). */
  maxStoredZNo: number
}

/**
 * Q3b-16 · D54: the fallback once an owner has acknowledged a broken chain (`Z_CHAIN_BROKEN`) — closing must go
 * through no matter how bad the earlier data is, so unlike `recomputeZChain` this **never throws**. Callers give
 * entries oldest first by insertion order (review NF-1/NF-3: never by the tamperable, self-reported `zNo` — see
 * `close.ts`'s `deviceZRows`); `zNo` in the result is simply `entries.length` — the new Z always numbers itself
 * `count of existing Z rows + 1`; the caller is responsible for supplying every existing row.
 *
 * Each entry's net is:
 * 1. gross − discount − voided, when those three are non-negative safe integers with `discount ≤ gross` and
 *    `voided ≤ gross − discount` (a self-consistent triple, spec §4.3's own relation, and — because of that
 *    relation — itself always a safe, non-negative integer) — the true net regardless of what `netSalesSatang`
 *    claims, since gross/discount/voided are what it is derived from;
 * 2. otherwise the stored `netSalesSatang`, when that alone is a safe integer ≥ 0 (review NF-2: a negative stored
 *    net is refused too, same as path 1's result always being ≥ 0 — the running total must never go negative);
 * 3. otherwise 0.
 * An entry that took path 2 or 3 is added to `unreadable`. Review NF-2: an otherwise-usable net (path 1 or 2) that
 * would push the running total past `Number.MAX_SAFE_INTEGER` is *also* treated as unreadable (net 0) instead —
 * the total only ever grows by amounts that keep it representable, so it can never come out unsafe.
 */
export function recomputeZChainLenient(entries: readonly LenientZEntry[]): LenientZChain {
  let grand = 0
  const unreadable: { shiftId: string; zNo: number | null }[] = []
  const zNoCounts = new Map<number, number>()
  for (const e of entries) {
    const { grossSalesSatang: gross, discountSatang: discount, voidedSatang: voided, netSalesSatang: storedNet } = e
    const consistent =
      gross !== null &&
      discount !== null &&
      voided !== null &&
      Number.isSafeInteger(gross) &&
      Number.isSafeInteger(discount) &&
      Number.isSafeInteger(voided) &&
      gross >= 0 &&
      discount >= 0 &&
      voided >= 0 &&
      discount <= gross &&
      voided <= gross - discount
    const storedNetUsable = storedNet !== null && Number.isSafeInteger(storedNet) && storedNet >= 0
    // path 1's net (gross − discount − voided, when self-consistent) is always a safe, non-negative integer by
    // construction; an unusable triple falls back to the stored net when that alone is usable, else 0.
    const net = consistent ? gross - discount - voided : storedNetUsable ? storedNet : 0
    const overflow = grand + net > Number.MAX_SAFE_INTEGER
    if (!overflow) grand += net // an overflowing entry contributes nothing, same as an unusable one
    if (!consistent || overflow) unreadable.push({ shiftId: e.shiftId, zNo: e.zNo }) // path 1 only is ever left unflagged
    if (e.zNo !== null) zNoCounts.set(e.zNo, (zNoCounts.get(e.zNo) ?? 0) + 1)
  }
  const duplicateZNos = [...zNoCounts.entries()].filter(([, count]) => count > 1).map(([zNo]) => zNo).sort((a, b) => a - b)
  const maxStoredZNo = zNoCounts.size === 0 ? 0 : Math.max(...zNoCounts.keys())
  const missingZNos: number[] = []
  for (let n = 1; n <= maxStoredZNo; n++) if (!zNoCounts.has(n)) missingZNos.push(n)
  return { zNo: entries.length, grandTotalSatang: grand, unreadable, duplicateZNos, missingZNos, maxStoredZNo }
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
  const seenVoidOrderIds = new Set<string>()
  for (const v of input.voids) {
    // M-2: each void entry checked individually — the frozen daily void report (D50 Q3-22) must not carry garbage.
    if (!Number.isSafeInteger(v.totalSatang) || v.totalSatang <= 0) throw new RangeError(`void ${v.orderId}: totalSatang must be a positive integer`)
    if (seenVoidOrderIds.has(v.orderId)) throw new RangeError(`void ${v.orderId}: duplicate orderId`)
    seenVoidOrderIds.add(v.orderId)
    if (v.reason.trim() === '') throw new RangeError(`void ${v.orderId}: reason must not be blank`)
  }
  if (input.voids.reduce((a, v) => a + v.totalSatang, 0) !== input.sales.voidedSatang) throw new RangeError('Σ voids.totalSatang must equal sales.voidedSatang')
  const voidSum = (method: ZVoid['method']): number => input.voids.filter((v) => v.method === method).reduce((a, v) => a + v.totalSatang, 0)
  if (voidSum('CASH') !== input.cash.voidRefundsSatang) throw new RangeError('Σ cash voids must equal cash.voidRefundsSatang (D36)')
  if (voidSum('PROMPTPAY') !== input.sales.qrRefundedSatang) throw new RangeError('Σ PromptPay voids must equal sales.qrRefundedSatang')
  if (input.bankQrTotalSatang !== null) assertNonNegInt(input.bankQrTotalSatang, 'bankQrTotalSatang')
  const w = input.chainWarning
  if (w !== null) {
    // M-6: trim before checking for blank, and there must be an earlier Z (prevZNo >= 1) for the chain to have broken.
    if (w.brokenShiftId.trim() === '' || w.acknowledgedBy.trim() === '') throw new RangeError('chainWarning needs the broken shift and the acknowledging owner')
    if (w.storedGrandTotalSatang !== null) assertSafeInt(w.storedGrandTotalSatang, 'chainWarning.storedGrandTotalSatang')
    if (prevZNo < 1 || w.recomputedGrandTotalSatang !== prevGrand) throw new RangeError('with a chainWarning, prev must be the recomputed chain of at least one earlier Z')
    if (!Array.isArray(w.unreadableZs)) throw new RangeError('chainWarning.unreadableZs must be an array')
    for (const u of w.unreadableZs) {
      if (typeof u.shiftId !== 'string' || u.shiftId.trim() === '') throw new RangeError('chainWarning.unreadableZs entries need a shiftId')
      if (u.zNo !== null) assertSafeInt(u.zNo, 'chainWarning.unreadableZs[].zNo')
    }
    // review NF-4: both are cosmetic (named for the audit trail), so only shape/positivity is checked.
    if (!Array.isArray(w.duplicateZNos) || !Array.isArray(w.missingZNos)) throw new RangeError('chainWarning.duplicateZNos/missingZNos must be arrays')
    for (const n of [...w.duplicateZNos, ...w.missingZNos]) {
      assertSafeInt(n, 'chainWarning zNo list entry')
      if (n < 1) throw new RangeError('chainWarning.duplicateZNos/missingZNos entries must be >= 1')
    }
  }
  const expected = expectedCashSatang(input.cash)
  assertSafeInt(expected, 'expectedCashSatang') // M-1
  const variance = input.countedCashSatang - expected
  assertSafeInt(variance, 'cashVarianceSatang') // M-1
  const reason = input.varianceReason?.trim() ?? ''
  if (varianceNeedsReason(variance, input.varianceAlertSatang) && reason === '') {
    throw new RangeError('a cash variance above the alert threshold needs a reason (spec §4.8)')
  }
  const qrDifference = input.bankQrTotalSatang === null ? null : input.bankQrTotalSatang - input.sales.qrNetSatang
  if (qrDifference !== null) assertSafeInt(qrDifference, 'qrDifferenceSatang') // M-1
  const grandTotal = prevGrand + input.sales.netSalesSatang
  assertSafeInt(grandTotal, 'grandTotalSatang') // M-1
  // M-5: an explicit field list, not `...input` — the stored/hashed shape is exactly `ZSnapshot`, never a stray extra property.
  const snapshot: ZSnapshot = {
    shiftId: input.shiftId,
    businessDate: input.businessDate,
    deviceId: input.deviceId,
    zNo: input.zNo,
    openedAt: input.openedAt,
    openedBy: input.openedBy,
    openedQuick: input.openedQuick,
    closedAt: input.closedAt,
    closedBy: input.closedBy,
    countedBy: input.countedBy,
    sales: input.sales,
    cash: input.cash,
    countLines: tally.lines,
    countedCashSatang: input.countedCashSatang,
    varianceAlertSatang: input.varianceAlertSatang,
    varianceReason: reason === '' ? null : reason,
    voids: input.voids,
    bankQrTotalSatang: input.bankQrTotalSatang,
    chainWarning: input.chainWarning,
    expectedCashSatang: expected,
    cashVarianceSatang: variance,
    qrDifferenceSatang: qrDifference,
    grandTotalSatang: grandTotal,
  }
  return { snapshot, hash: zReportHash(snapshot) }
}
