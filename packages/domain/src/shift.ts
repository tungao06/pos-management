import { canonicalJson, sha256Hex } from './hash.js'

/**
 * Inputs to `expectedCashSatang`, one field per source of cash_movement / order rows (spec §4.3, §4.8).
 *
 * - `openingFloatSatang` — `shift.opening_float_satang`, recorded when the shift opens.
 * - `cashSalesSatang` — sum of `order.paid_amount_satang` for orders paid by CASH during the shift.
 * - `cashRefundsSatang` — sum of the **automatic** `cash_movement` rows of kind PAID_OUT that a cash-paid
 *   order void creates (spec §4.3: a cash void records a PAID_OUT automatically). These auto-void refunds
 *   are counted HERE, and ONLY here.
 * - `paidInSatang` — sum of **manual** `cash_movement` rows of kind PAID_IN (e.g. owner tops up the drawer).
 * - `paidOutSatang` — sum of **manual** `cash_movement` rows of kind PAID_OUT only (e.g. buying ice, petty
 *   cash). The caller MUST exclude the automatic void PAID_OUT rows already counted in `cashRefundsSatang`
 *   when summing this field — including them here as well double-counts every cash void and understates
 *   expected cash by the voided amount (decision: I3 in the plan-1 final review).
 * - `dropsSatang` — sum of `cash_movement` rows of kind DROP (cash removed to the safe).
 */
export type CashInputs = {
  openingFloatSatang: number
  cashSalesSatang: number
  cashRefundsSatang: number
  paidInSatang: number
  paidOutSatang: number
  dropsSatang: number
}

export function expectedCashSatang(x: CashInputs): number {
  return x.openingFloatSatang + x.cashSalesSatang - x.cashRefundsSatang + x.paidInSatang - x.paidOutSatang - x.dropsSatang
}

export type ZInput = {
  shiftId: string
  businessDate: string
  deviceId: string
  closedAt: string
  closedBy: string
  orderCount: number
  voidCount: number
  grossSalesSatang: number
  discountSatang: number
  netSalesSatang: number
  voidedSatang: number
  cashSalesSatang: number
  qrSalesSatang: number
  cash: CashInputs
  countedCashSatang: number
  varianceReason: string | null
}

export type ZSnapshot = ZInput & { expectedCashSatang: number; cashVarianceSatang: number; grandTotalSatang: number }

/** Frozen Z report: computed once at shift close, never recomputed (spec §4.8). */
export function buildZReport(input: ZInput, prevGrandTotalSatang: number): { snapshot: ZSnapshot; hash: string } {
  const expected = expectedCashSatang(input.cash)
  const snapshot: ZSnapshot = {
    ...input,
    expectedCashSatang: expected,
    cashVarianceSatang: input.countedCashSatang - expected,
    grandTotalSatang: prevGrandTotalSatang + input.netSalesSatang,
  }
  return { snapshot, hash: sha256Hex(canonicalJson(snapshot)) }
}
