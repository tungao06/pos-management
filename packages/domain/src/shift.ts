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
 * - `drawerExpensesSatang` — spec 04 §4.10 `cash.drawer_expenses`: expenses paid from the drawer. Always 0 in block 3
 *   (block 4 fills it); never produced by `cashInputsFromMovements`.
 * - `botCashSatang` — Σ bot/web cash bills E4 returned for the window (after, counted_at]. 0 until the Z is issued
 *   (D68), then set once by `withBotCash`; never produced by `cashInputsFromMovements`.
 *
 * spec 04 §4.10 R-m1 — dayo's formula (`dayo_z_expected`, migration 0065), same terms in the same order:
 * expected = opening + cash_sales − void_refunds + paid_in − paid_out − drops − drawer_expenses + bot_cash
 * It may be negative (D54 Q3b-14).
 */
export type CashInputs = {
  openingFloatSatang: number
  cashSalesSatang: number
  voidRefundsSatang: number
  paidInSatang: number
  paidOutSatang: number
  dropsSatang: number
  /** spec 04 §4.10 cash.drawer_expenses — always 0 in block 3 (block 4 fills it). */
  drawerExpensesSatang: number
  /** Σ bot/web cash bills of the E4 window (after, counted_at] — 0 until the Z is issued (D68). */
  botCashSatang: number
}

export function expectedCashSatang(x: CashInputs): number {
  // Security fix round 1 (L-3): term by term, each term and each partial sum a safe integer — a sum that leaves
  // the safe range part-way (or fractions that cancel out) must throw, not come back looking exact.
  const terms: readonly [number, 1 | -1, string][] = [
    [x.openingFloatSatang, 1, 'openingFloatSatang'],
    [x.cashSalesSatang, 1, 'cashSalesSatang'],
    [x.voidRefundsSatang, -1, 'voidRefundsSatang'],
    [x.paidInSatang, 1, 'paidInSatang'],
    [x.paidOutSatang, -1, 'paidOutSatang'],
    [x.dropsSatang, -1, 'dropsSatang'],
    [x.drawerExpensesSatang, -1, 'drawerExpensesSatang'],
    [x.botCashSatang, 1, 'botCashSatang'],
  ]
  let expected = 0
  for (const [term, sign, name] of terms) {
    assertSafeInt(term, `cash.${name}`)
    expected += sign * term
    assertSafeInt(expected, 'expectedCashSatang')
  }
  return expected
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
  const x: CashInputs = {
    openingFloatSatang,
    cashSalesSatang,
    voidRefundsSatang: 0,
    paidInSatang: 0,
    paidOutSatang: 0,
    dropsSatang: 0,
    drawerExpensesSatang: 0,
    botCashSatang: 0,
  }
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

/** D68 · spec §6.8: the bot/web cash bills E4 returned for (after, counted_at] — added once, when the Z is issued. */
export function withBotCash(x: CashInputs, botCashSatang: number): CashInputs {
  assertNonNegInt(botCashSatang, 'botCashSatang')
  return { ...x, botCashSatang }
}

/** spec §4.10: variance = counted − expected (negative = short). The one formula; buildZReport uses it too. */
export function cashVarianceSatang(countedSatang: number, expectedSatang: number): number {
  assertNonNegInt(countedSatang, 'countedSatang')
  assertSafeInt(expectedSatang, 'expectedSatang') // may be negative (D54 Q3b-14)
  const v = countedSatang - expectedSatang
  assertSafeInt(v, 'cashVarianceSatang')
  return v
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

/** R4: the threshold actually used — a setting of 0 would ask for a reason (and alert dayo) on a perfect count. */
export const MIN_VARIANCE_ALERT_SATANG = 1

export function effectiveVarianceAlertSatang(settingSatang: number): number {
  assertNonNegInt(settingSatang, 'settingSatang')
  return Math.max(MIN_VARIANCE_ALERT_SATANG, settingSatang)
}

/** D102 (amends D98): one rule on the tablet and at dayo — a shortage or overage of at least the threshold needs a reason. */
export function varianceNeedsReason(varianceSatang: number, alertSatang: number): boolean {
  assertSafeInt(varianceSatang, 'varianceSatang')
  assertSafeInt(alertSatang, 'alertSatang')
  if (alertSatang < MIN_VARIANCE_ALERT_SATANG) throw new RangeError(`alertSatang must be >= ${MIN_VARIANCE_ALERT_SATANG}, got ${alertSatang}`)
  return Math.abs(varianceSatang) >= alertSatang
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
  /** The shift that made the chain acknowledgement necessary — its Z's snapshot no longer matches its hash (or is
   * unreadable, or its own claimed `zNo`/`grandTotalSatang` is not usable, review R2-3), or its Z row is missing
   * entirely (review R2-4, in which case it is also the first entry of `deletedShiftIds`). */
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
  /** zNo values two or more earlier Z's claim, each >= 1 (review NF-4, R2-1) — cheap to name alongside the
   * recompute; empty when every readable zNo is unique. Capped at `MAX_ZNO_LIST_LENGTH`; see `duplicateZNosTruncated`. */
  duplicateZNos: number[]
  /** True when `duplicateZNos` left some names out because there were more than `MAX_ZNO_LIST_LENGTH` (review R2-2). */
  duplicateZNosTruncated: boolean
  /** Integers >= 1, at most the row count, that no earlier Z claims — a deleted/missing row leaves a gap here
   * (review NF-4). Never scans past the row count even when a stray zNo is huge (review R2-2) — a claimed zNo
   * above the row count is an anomaly, not a gap, and is not named here (it still shows in `unreadableZs` or the
   * hash mismatch that got the chain here in the first place). Capped at `MAX_ZNO_LIST_LENGTH`; see `missingZNosTruncated`. */
  missingZNos: number[]
  /** True when `missingZNos` left some names out because there were more than `MAX_ZNO_LIST_LENGTH` (review R2-2). */
  missingZNosTruncated: boolean
  /** Closed shifts of this device with no Z row at all — a whole row deleted, not merely edited (review R2-4).
   * Their money cannot be recomputed (there is nothing left to read), only named; not treated as unreadable
   * because there is no zNo to report either. Capped at `MAX_ZNO_LIST_LENGTH`; see `deletedShiftIdsTruncated`. */
  deletedShiftIds: string[]
  /** True when `deletedShiftIds` left some names out because there were more than `MAX_ZNO_LIST_LENGTH` (review R2-2/R2-4). */
  deletedShiftIdsTruncated: boolean
  /**
   * 2026-09-21 · D55 (review R4-1, R4-2): how many Z rows were known missing when this warning was acknowledged —
   * this Z's own `zNo` minus the device's Z row count including this Z. `last.zNo − row count` when chaining
   * from a trustworthy last Z past a deleted middle Z; on the lenient path, never less than the gap already
   * acknowledged (review R5-1 — 0 on a chain that never had one). Every
   * clean Z afterwards grows `zNo` and the row count by one together, so the gap stays the same until another row
   * is deleted: `closeShift` compares the current gap against the most recent recorded one, instead of re-asking
   * for the same acknowledged gap forever or skipping the check. Optional so a warning frozen before this field
   * existed keeps its shape and hash; a safe integer >= 0 when present.
   */
  zNoGap?: number
  /** R9: this Z continues the key's numbering from dayo (E1 client.last_z_no/last_z_hash) after a reinstall.
   * Optional so a warning frozen before this field existed keeps its shape and hash; when present, zNo >= 1 and
   * a 64-char lowercase hex hash. */
  centralLastZ?: { zNo: number; hash: string }
}

/** dayo 0066 `bot_bills`: at most 500 per Z (the same cap dayo applies — a longer list is rejected INVALID). */
export const MAX_BOT_BILLS = 500
/** dayo 0066 `bot_bills[].order_no` `^L[0-9]{6}-[0-9]{3,}$` — same pattern as contracts `BOT_ORDER_NO_RE` (copied: domain
 * only imports types from contracts). */
export const BOT_ORDER_NO_PATTERN = /^L\d{6}-\d{3,}$/
/** dayo 0066 `bot_bills[].version` is an int4 1..2147483647. */
const BOT_BILL_VERSION_MAX = 2_147_483_647
/** Instants frozen into a Z: ISO-8601 UTC, `Z` or `+00:00` (dayo returns `…+00:00`, ruling P7), at most millisecond
 * precision so comparing them with Date.parse is exact. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|\+00:00)$/

/** Security fix round 1 (L-1): the form above, and a real calendar instant (Date.parse alone rolls 30 Feb or 24:00 over). */
function isoUtcMs(iso: unknown, name: string): number {
  const t = typeof iso === 'string' && ISO_UTC.test(iso) ? Date.parse(iso) : Number.NaN
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 19) !== (iso as string).slice(0, 19)) {
    throw new RangeError(`${name} is not an ISO UTC instant (YYYY-MM-DDTHH:MM:SS[.mmm]Z or +00:00)`)
  }
  return t
}

/** Security fix round 1 (M-1): every bill checked exactly as dayo 0066 checks it (so a Z that dayo would reject
 * INVALID forever is never frozen), duplicates looked for only after that, and each frozen bill rebuilt from an
 * explicit field list — a stray caller property never reaches the snapshot or its hash. */
function frozenBotBills(bills: unknown): ZBotBill[] {
  if (!Array.isArray(bills)) throw new RangeError('botBills must be an array')
  if (bills.length > MAX_BOT_BILLS) throw new RangeError(`at most ${MAX_BOT_BILLS} bot bills per Z (dayo 0066), got ${bills.length}`)
  const out: ZBotBill[] = []
  for (const raw of bills as unknown[]) {
    if (typeof raw !== 'object' || raw === null) throw new RangeError('each bot bill must be an object')
    const b = raw as Record<string, unknown>
    const orderNo = b['orderNo']
    if (typeof orderNo !== 'string' || !BOT_ORDER_NO_PATTERN.test(orderNo)) throw new RangeError(`bot bill orderNo must match ${BOT_ORDER_NO_PATTERN.source}, got ${JSON.stringify(orderNo)}`)
    const version = b['version']
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 || version > BOT_BILL_VERSION_MAX) {
      throw new RangeError(`bot bill ${orderNo} version must be a whole number 1..${BOT_BILL_VERSION_MAX}`)
    }
    const totalSatang = b['totalSatang']
    if (typeof totalSatang !== 'number') throw new RangeError(`bot bill ${orderNo} totalSatang must be a number`)
    assertNonNegInt(totalSatang, `bot bill ${orderNo} totalSatang`)
    const source = b['source']
    if (typeof source !== 'string') throw new RangeError(`bot bill ${orderNo} source must be a string`)
    const soldAt = b['soldAt']
    if (soldAt !== null && typeof soldAt !== 'string') throw new RangeError(`bot bill ${orderNo} soldAt must be a string or null`)
    const createdByName = b['createdByName']
    if (createdByName !== null && typeof createdByName !== 'string') throw new RangeError(`bot bill ${orderNo} createdByName must be a string or null`)
    out.push({ orderNo, version, source, soldAt, totalSatang, createdByName })
  }
  const seen = new Set<string>()
  for (const b of out) {
    if (seen.has(b.orderNo)) throw new RangeError(`bot bill ${b.orderNo} counted twice`)
    seen.add(b.orderNo)
  }
  return out
}

/** One bot/web cash bill as E4 returned it (spec §4.10 bot_bills) — frozen into the Z. */
export type ZBotBill = { orderNo: string; version: number; source: string; soldAt: string | null; totalSatang: number; createdByName: string | null }
/** spec §4.10 bot_window: the E4 window (after, until], until = the Z's countedAt. */
export type ZBotWindow = { after: string; until: string }

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
  /** D101: the instant "นับเสร็จ" was pressed — the shift took no bill or cash movement after it. */
  countedAt: string
  /** spec §4.10 E4 window (after, until = countedAt]; null for a local-only shift (ruling R6). */
  botWindow: ZBotWindow | null
  /** The bot/web cash bills of that window, frozen as E4 returned them (spec §4.10 bot_bills). */
  botBills: ZBotBill[]
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

/** `chainWarning`'s zNo/deleted-shift lists are frozen into the hash and the outbox forever — a single hand-edited
 * zNo of a few million must never balloon that payload or hang the recompute (review R2-2). Exported so `close.ts`
 * caps `deletedShiftIds` (computed at the app layer, from the `shift` table) the same way. */
export const MAX_ZNO_LIST_LENGTH = 50

export type LenientZChain = {
  zNo: number
  /** Always a safe, non-negative integer (review NF-2) — every net folded in is itself safe and non-negative, and
   * an entry is skipped (and flagged) rather than added if doing so would push this past `Number.MAX_SAFE_INTEGER`.
   * `buildZReport` can never reject this as `prev.grandTotalSatang`. */
  grandTotalSatang: number
  /** Every entry whose net came from the fallback (path 2 or 3 below), in the order given. */
  unreadable: { shiftId: string; zNo: number | null }[]
  /** zNo values two or more entries claim, each >= 1 (review NF-4, R2-1) — empty when every readable zNo is unique.
   * Capped at `MAX_ZNO_LIST_LENGTH`; see `duplicateZNosTruncated`. */
  duplicateZNos: number[]
  duplicateZNosTruncated: boolean
  /** Integers >= 1, at most `entries.length`, that no entry claims (review NF-4) — the scan never goes past the
   * entry count even when a stray zNo is huge (review R2-2), so this can never be slow or unbounded. Capped at
   * `MAX_ZNO_LIST_LENGTH`; see `missingZNosTruncated`. */
  missingZNos: number[]
  missingZNosTruncated: boolean
  /** Highest zNo any entry claims (>= 1), or 0 when none of them have a readable one >= 1 (review NF-4, R2-1). A
   * single number, however large — unlike the two lists above, it can never balloon the frozen payload on its own. */
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
    // review R2-1: a zNo of 0 or below is nonsensical (real zNos start at 1) and is already reported via
    // `unreadable`/the hash mismatch that got the chain here — counting it here too would let `buildZReport`'s own
    // "duplicateZNos/missingZNos entries must be >= 1" check reject a chainWarning the owner can never clear.
    if (e.zNo !== null && e.zNo >= 1) zNoCounts.set(e.zNo, (zNoCounts.get(e.zNo) ?? 0) + 1)
  }
  const duplicateZNosAll = [...zNoCounts.entries()].filter(([, count]) => count > 1).map(([zNo]) => zNo).sort((a, b) => a - b)
  const duplicateZNos = duplicateZNosAll.slice(0, MAX_ZNO_LIST_LENGTH)
  const duplicateZNosTruncated = duplicateZNosAll.length > MAX_ZNO_LIST_LENGTH
  const maxStoredZNo = zNoCounts.size === 0 ? 0 : Math.max(...zNoCounts.keys())
  // review R2-2: scans only 1..entries.length, never 1..maxStoredZNo — a single stray zNo of a few million (or
  // 9e15, still a safe integer) must never turn one acknowledged close into a multi-second hang or a multi-MB
  // snapshot. A claimed zNo above the row count is left unreported here; it is still visible via `unreadable` or
  // the hash mismatch that triggered this recompute in the first place.
  const missingZNos: number[] = []
  let missingZNosTruncated = false
  for (let n = 1; n <= entries.length; n++) {
    if (zNoCounts.has(n)) continue
    if (missingZNos.length >= MAX_ZNO_LIST_LENGTH) {
      missingZNosTruncated = true
      break
    }
    missingZNos.push(n)
  }
  return { zNo: entries.length, grandTotalSatang: grand, unreadable, duplicateZNos, duplicateZNosTruncated, missingZNos, missingZNosTruncated, maxStoredZNo }
}

/**
 * Frozen Z report: computed once at shift close, never recomputed (spec §4.8). Refuses an inconsistent input
 * (Plan 1 notes §4): sales relations, cash sales on both sides, the count total, the void list (count, total, cash
 * voids = VOID_REFUND rows, QR voids = QR refunded), a missing reason when the variance is at or above the alert
 * threshold (D102), times out of order (opened ≤ counted ≤ closed, D101), and bot bills that do not match the bot
 * window or `cash.botCashSatang` (spec §4.10). Z(n).grand = Z(n−1).grand + net of this shift, chained on `zNo` (the previous Z's snapshot), never on the
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
    // M-6: trim before checking for blank.
    if (w.brokenShiftId.trim() === '' || w.acknowledgedBy.trim() === '') throw new RangeError('chainWarning needs the broken shift and the acknowledging owner')
    if (w.storedGrandTotalSatang !== null) assertSafeInt(w.storedGrandTotalSatang, 'chainWarning.storedGrandTotalSatang')
    // review R2-4: prevZNo may be 0 here — every earlier Z row can be gone (deleted, not merely edited), leaving
    // nothing to chain from but still something to acknowledge and name (`deletedShiftIds`). What matters is that
    // `prev` (however small) is exactly what was recomputed, not that an earlier Z necessarily still exists.
    if (w.recomputedGrandTotalSatang !== prevGrand) throw new RangeError('with a chainWarning, prev must be the recomputed chain')
    if (!Array.isArray(w.unreadableZs)) throw new RangeError('chainWarning.unreadableZs must be an array')
    for (const u of w.unreadableZs) {
      if (typeof u.shiftId !== 'string' || u.shiftId.trim() === '') throw new RangeError('chainWarning.unreadableZs entries need a shiftId')
      if (u.zNo !== null) assertSafeInt(u.zNo, 'chainWarning.unreadableZs[].zNo')
    }
    // review NF-4/R2-1/R2-2: cosmetic (named for the audit trail) — checked only for shape, a floor of 1, and the
    // same cap `recomputeZChainLenient` itself applies, so a hand-edited list can never make this reject forever.
    for (const [list, truncated, name] of [
      [w.duplicateZNos, w.duplicateZNosTruncated, 'duplicateZNos'],
      [w.missingZNos, w.missingZNosTruncated, 'missingZNos'],
    ] as const) {
      if (!Array.isArray(list)) throw new RangeError(`chainWarning.${name} must be an array`)
      if (list.length > MAX_ZNO_LIST_LENGTH) throw new RangeError(`chainWarning.${name} must be at most ${MAX_ZNO_LIST_LENGTH} entries`)
      if (typeof truncated !== 'boolean') throw new RangeError(`chainWarning.${name}Truncated must be a boolean`)
      for (const n of list) {
        assertSafeInt(n, `chainWarning.${name}[]`)
        if (n < 1) throw new RangeError(`chainWarning.${name} entries must be >= 1`)
      }
    }
    // review R2-4: a whole Z row deleted — named, not reconstructed. Bounded the same way as the zNo lists above.
    if (!Array.isArray(w.deletedShiftIds)) throw new RangeError('chainWarning.deletedShiftIds must be an array')
    if (w.deletedShiftIds.length > MAX_ZNO_LIST_LENGTH) throw new RangeError(`chainWarning.deletedShiftIds must be at most ${MAX_ZNO_LIST_LENGTH} entries`)
    if (typeof w.deletedShiftIdsTruncated !== 'boolean') throw new RangeError('chainWarning.deletedShiftIdsTruncated must be a boolean')
    for (const id of w.deletedShiftIds) {
      if (typeof id !== 'string' || id.trim() === '') throw new RangeError('chainWarning.deletedShiftIds entries need a non-blank shiftId')
    }
    if (w.zNoGap !== undefined) assertNonNegInt(w.zNoGap, 'chainWarning.zNoGap') // 2026-09-21 · D55 (review R4-1, R4-2)
  }
  // Security fix round 1 (L-1): ISO UTC only, compared as instants.
  const openedMs = isoUtcMs(input.openedAt, 'openedAt')
  const countedMs = isoUtcMs(input.countedAt, 'countedAt')
  const closedMs = isoUtcMs(input.closedAt, 'closedAt')
  if (countedMs < openedMs) throw new RangeError('countedAt must not be before openedAt (D101)')
  if (closedMs < countedMs) throw new RangeError('closedAt must not be before countedAt (spec §4.10 shift_close)')
  const botBills = frozenBotBills(input.botBills)
  let botWindow: ZBotWindow | null = null
  if (input.botWindow === null) {
    if (botBills.length > 0 || input.cash.botCashSatang !== 0) throw new RangeError('bot bills need a bot window (ruling R6: a local-only Z has none)')
  } else {
    if (typeof input.botWindow !== 'object') throw new RangeError('botWindow must be {after, until} or null')
    const afterMs = isoUtcMs(input.botWindow.after, 'botWindow.after')
    const untilMs = isoUtcMs(input.botWindow.until, 'botWindow.until')
    if (untilMs !== countedMs) throw new RangeError('botWindow.until must equal countedAt (spec §4.10 bot_window)')
    if (afterMs >= untilMs) throw new RangeError('botWindow.after must be before until')
    botWindow = { after: input.botWindow.after, until: input.botWindow.until } // explicit fields: nothing stray is frozen
  }
  let botSum = 0
  for (const b of botBills) {
    botSum += b.totalSatang
    assertSafeInt(botSum, 'Σ botBills.totalSatang') // M-1
  }
  if (botSum !== input.cash.botCashSatang) throw new RangeError('Σ botBills.totalSatang must equal cash.botCashSatang (spec §4.10 bot_bills)')
  if (input.varianceAlertSatang < MIN_VARIANCE_ALERT_SATANG) throw new RangeError('varianceAlertSatang must be >= 1 satang (ruling R4)')
  const cz: unknown = input.chainWarning?.centralLastZ
  if (cz !== undefined) {
    // Security fix round 1 (L-2): present = a real object naming exactly the Z this one continues (prev).
    if (typeof cz !== 'object' || cz === null) throw new RangeError('chainWarning.centralLastZ must be {zNo, hash} when present')
    const { zNo, hash } = cz as { zNo: unknown; hash: unknown }
    if (typeof zNo !== 'number' || !Number.isSafeInteger(zNo) || zNo < 1 || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new RangeError('chainWarning.centralLastZ needs zNo >= 1 and a 64-hex hash')
    }
    if (zNo !== prevZNo) throw new RangeError(`chainWarning.centralLastZ.zNo must be the previous Z number ${prevZNo}, got ${zNo}`)
  }
  const expected = expectedCashSatang(input.cash)
  assertSafeInt(expected, 'expectedCashSatang') // M-1
  const variance = cashVarianceSatang(input.countedCashSatang, expected) // spec §4.10: the one formula
  const reason = input.varianceReason?.trim() ?? ''
  if (varianceNeedsReason(variance, input.varianceAlertSatang) && reason === '') {
    throw new RangeError('a cash variance at or above the alert threshold needs a reason (D102)')
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
    countedAt: input.countedAt,
    botWindow,
    botBills,
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
