import { canonicalJson, sha256Hex } from './hash.js'

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
