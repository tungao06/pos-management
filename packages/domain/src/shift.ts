import { canonicalJson, sha256Hex } from './hash.js'

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
