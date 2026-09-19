import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  assertSalesSummary,
  buildZReport,
  CASH_DENOMINATIONS_SATANG,
  cashInputsFromMovements,
  expectedCashSatang,
  recomputeZChain,
  summarizeShiftSales,
  tallyCashCount,
  varianceNeedsReason,
  zReportHash,
  type CashInputs,
  type SalesSummary,
  type ShiftOrder,
  type ZChainWarning,
  type ZInput,
} from '../src/shift.js'

const cash: CashInputs = { openingFloatSatang: 100_000, cashSalesSatang: 523_000, voidRefundsSatang: 4_500, paidInSatang: 0, paidOutSatang: 20_000, dropsSatang: 300_000 }

describe('expectedCashSatang', () => {
  it('opening + cash sales − void refunds + paid in − paid out − drops (D36)', () => {
    expect(expectedCashSatang(cash)).toBe(100_000 + 523_000 - 4_500 - 20_000 - 300_000)
  })

  it('each input moves expected cash by exactly its own amount, in its own direction', () => {
    const base: CashInputs = { openingFloatSatang: 0, cashSalesSatang: 0, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 }
    expect(expectedCashSatang({ ...base, openingFloatSatang: 1 })).toBe(1)
    expect(expectedCashSatang({ ...base, cashSalesSatang: 1 })).toBe(1)
    expect(expectedCashSatang({ ...base, voidRefundsSatang: 1 })).toBe(-1)
    expect(expectedCashSatang({ ...base, paidInSatang: 1 })).toBe(1)
    expect(expectedCashSatang({ ...base, paidOutSatang: 1 })).toBe(-1)
    expect(expectedCashSatang({ ...base, dropsSatang: 1 })).toBe(-1)
  })

  it('a voided 45-baht cash bill: sale counted in cash sales, refund counted once as VOID_REFUND', () => {
    const x: CashInputs = { openingFloatSatang: 100_000, cashSalesSatang: 4_500, voidRefundsSatang: 4_500, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 }
    expect(expectedCashSatang(x)).toBe(100_000)
  })
})

describe('cashInputsFromMovements', () => {
  it('puts every kind in its own field, each row once (D36)', () => {
    const x = cashInputsFromMovements(50_000, 9_000, [
      { kind: 'VOID_REFUND', amountSatang: 4_500 },
      { kind: 'PAID_IN', amountSatang: 10_000 },
      { kind: 'PAID_OUT', amountSatang: 2_000 },
      { kind: 'PAID_OUT', amountSatang: 500 },
      { kind: 'DROP', amountSatang: 30_000 },
    ])
    expect(x).toEqual({ openingFloatSatang: 50_000, cashSalesSatang: 9_000, voidRefundsSatang: 4_500, paidInSatang: 10_000, paidOutSatang: 2_500, dropsSatang: 30_000 })
  })

  it('refuses a zero, negative or fractional amount', () => {
    expect(() => cashInputsFromMovements(0, 0, [{ kind: 'PAID_IN', amountSatang: 0 }])).toThrow(RangeError)
    expect(() => cashInputsFromMovements(0, 0, [{ kind: 'DROP', amountSatang: -1 }])).toThrow(RangeError)
    expect(() => cashInputsFromMovements(0, 0, [{ kind: 'PAID_OUT', amountSatang: 1.5 }])).toThrow(RangeError)
  })
})

const paid = (id: string, subtotal: number, discount: number, method: 'CASH' | 'PROMPTPAY'): ShiftOrder => ({
  id, status: 'paid', subtotalSatang: subtotal, discountSatang: discount, totalSatang: subtotal - discount, payments: [{ method, amountSatang: subtotal - discount }],
})

describe('summarizeShiftSales', () => {
  it('keeps voided receipts in gross and separates them (spec §4.3); net = gross − discount − voided (Q3b-4 · D52)', () => {
    const s = summarizeShiftSales([
      paid('o1', 10_500, 500, 'CASH'),
      paid('o2', 4_500, 0, 'PROMPTPAY'),
      { ...paid('o3', 9_000, 0, 'CASH'), status: 'voided' },
    ])
    expect(s).toEqual({
      orderCount: 3, voidCount: 1, grossSalesSatang: 24_000, discountSatang: 500, voidedSatang: 9_000, netSalesSatang: 14_500,
      cashSalesSatang: 19_000, qrSalesSatang: 4_500, qrRefundedSatang: 0, qrNetSatang: 4_500,
    })
  })

  it('QR received / refunded / net: a voided PromptPay receipt was transferred back (Q3b-12 · D53)', () => {
    const s = summarizeShiftSales([paid('o1', 4_500, 0, 'PROMPTPAY'), { ...paid('o2', 5_000, 0, 'PROMPTPAY'), status: 'voided' }, { ...paid('o3', 4_000, 0, 'CASH'), status: 'voided' }])
    expect(s).toMatchObject({ qrSalesSatang: 9_500, qrRefundedSatang: 5_000, qrNetSatang: 4_500, voidedSatang: 9_000 })
    expect(() => assertSalesSummary({ ...s, qrNetSatang: 4_501 })).toThrow(RangeError)
    expect(() => assertSalesSummary({ ...s, qrRefundedSatang: 9_501, qrNetSatang: -1 })).toThrow(RangeError)
  })

  it('refuses an order whose payments or totals do not add up (spec §4.1)', () => {
    expect(() => summarizeShiftSales([{ ...paid('o1', 4_500, 0, 'CASH'), payments: [{ method: 'CASH', amountSatang: 4_000 }] }])).toThrow(/payments/)
    expect(() => summarizeShiftSales([{ ...paid('o1', 4_500, 0, 'CASH'), totalSatang: 4_400 }])).toThrow(/total/)
  })

  it('an empty shift is all zeros', () => {
    expect(summarizeShiftSales([])).toEqual({
      orderCount: 0, voidCount: 0, grossSalesSatang: 0, discountSatang: 0, voidedSatang: 0, netSalesSatang: 0,
      cashSalesSatang: 0, qrSalesSatang: 0, qrRefundedSatang: 0, qrNetSatang: 0,
    })
  })

  it('property: the summary always satisfies assertSalesSummary; net and QR net = Σ of the receipts still paid', () => {
    const orderArb = fc
      .record({ subtotal: fc.integer({ min: 1, max: 1_000_000 }), discountPct: fc.integer({ min: 0, max: 99 }), voided: fc.boolean(), cash: fc.boolean(), n: fc.nat() })
      .map(({ subtotal, discountPct, voided, cash, n }): ShiftOrder => {
        const discount = Math.floor((subtotal * discountPct) / 100)
        return { ...paid(`o${n}`, subtotal, discount, cash ? 'CASH' : 'PROMPTPAY'), status: voided ? 'voided' : 'paid' }
      })
    fc.assert(
      fc.property(fc.array(orderArb, { maxLength: 60 }), (orders) => {
        const s = summarizeShiftSales(orders)
        assertSalesSummary(s)
        const kept = orders.filter((o) => o.status === 'paid')
        expect(s.netSalesSatang).toBe(kept.reduce((a, o) => a + o.totalSatang, 0))
        expect(s.qrNetSatang).toBe(kept.filter((o) => o.payments[0]!.method === 'PROMPTPAY').reduce((a, o) => a + o.totalSatang, 0))
      }),
    )
  })
})

describe('tallyCashCount / varianceNeedsReason', () => {
  it('uses the 9 denominations of spec §5, no satang coins (Q3b-1 · D52), largest first, missing = 0', () => {
    expect(CASH_DENOMINATIONS_SATANG).toEqual([100_000, 50_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100])
    const t = tallyCashCount([{ denominationSatang: 100, count: 3 }, { denominationSatang: 100_000, count: 2 }])
    expect(t.totalSatang).toBe(200_300)
    expect(t.lines.map((l) => l.count)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 3])
  })

  it('refuses unknown or repeated denominations and bad counts', () => {
    expect(() => tallyCashCount([{ denominationSatang: 50, count: 1 }])).toThrow(RangeError)
    expect(() => tallyCashCount([{ denominationSatang: 100, count: 1 }, { denominationSatang: 100, count: 2 }])).toThrow(RangeError)
    expect(() => tallyCashCount([{ denominationSatang: 100, count: -1 }])).toThrow(RangeError)
    expect(() => tallyCashCount([{ denominationSatang: 100, count: 1.5 }])).toThrow(RangeError)
    expect(() => tallyCashCount([{ denominationSatang: 100, count: 100_000 }])).toThrow(RangeError)
  })

  it('needs a reason only when the shortage or overage is strictly above the threshold (spec §4.8)', () => {
    expect(varianceNeedsReason(2_000, 2_000)).toBe(false)
    expect(varianceNeedsReason(-2_000, 2_000)).toBe(false)
    expect(varianceNeedsReason(2_001, 2_000)).toBe(true)
    expect(varianceNeedsReason(-2_001, 2_000)).toBe(true)
    expect(varianceNeedsReason(0, 0)).toBe(false)
    expect(varianceNeedsReason(1, 0)).toBe(true)
  })
})

describe('recomputeZChain (Q3b-11 · D53)', () => {
  it('Z count and Σ net of every earlier snapshot', () => {
    expect(recomputeZChain([])).toEqual({ zNo: 0, grandTotalSatang: 0 })
    expect(recomputeZChain([4_000, 0, 10_000])).toEqual({ zNo: 3, grandTotalSatang: 14_000 })
  })

  it('refuses a net that is not a whole, non-negative number', () => {
    expect(() => recomputeZChain([4_000, -1])).toThrow(RangeError)
    expect(() => recomputeZChain([Number.NaN])).toThrow(RangeError)
  })
})

describe('buildZReport', () => {
  const sales: SalesSummary = {
    orderCount: 3, voidCount: 1, grossSalesSatang: 24_000, discountSatang: 500, voidedSatang: 9_000, netSalesSatang: 14_500,
    cashSalesSatang: 19_000, qrSalesSatang: 4_500, qrRefundedSatang: 0, qrNetSatang: 4_500,
  }
  const zCash: CashInputs = { openingFloatSatang: 50_000, cashSalesSatang: 19_000, voidRefundsSatang: 9_000, paidInSatang: 0, paidOutSatang: 2_000, dropsSatang: 0 }
  // expected = 50_000 + 19_000 − 9_000 − 2_000 = 58_000
  const input: ZInput = {
    shiftId: 's1', businessDate: '2026-09-17', deviceId: 'dev-A', zNo: 1, openedAt: '2026-09-17T01:00:00.000Z', openedBy: 'u1', openedQuick: false,
    closedAt: '2026-09-17T13:05:00.000Z', closedBy: 'u1', countedBy: 'u2',
    sales, cash: zCash,
    countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 5_000, count: 1 }, { denominationSatang: 1_000, count: 3 }],
    countedCashSatang: 58_000,
    varianceAlertSatang: 2_000,
    varianceReason: null,
    voids: [{ orderId: 'o3', receiptNo: 'A-000003', totalSatang: 9_000, method: 'CASH', reason: 'กดผิดเมนู', made: false, approvedBy: 'u1', approvedByName: 'TungAo', refundReference: null, voidedAt: '2026-09-17T05:00:00.000Z' }],
    bankQrTotalSatang: null,
    chainWarning: null,
  }

  it('computes expected cash, variance and running grand total; normalizes the count lines', () => {
    const z = buildZReport(input, { zNo: 0, grandTotalSatang: 10_000_000 })
    expect(z.snapshot.expectedCashSatang).toBe(58_000)
    expect(z.snapshot.cashVarianceSatang).toBe(0)
    expect(z.snapshot.grandTotalSatang).toBe(10_014_500)
    expect(z.snapshot.qrDifferenceSatang).toBeNull()
    expect(z.snapshot.countLines).toHaveLength(9)
    expect(z.hash).toBe(zReportHash(z.snapshot))
    expect(z.hash).toHaveLength(64)
  })

  it('hash changes when any number changes, and is stable', () => {
    const a = buildZReport(input, null).hash
    expect(buildZReport({ ...input, cash: { ...zCash, paidOutSatang: 2_001 } }, null).hash).not.toBe(a)
    expect(buildZReport(input, { zNo: 0, grandTotalSatang: 1 }).hash).not.toBe(a)
    expect(buildZReport(input, null).hash).toBe(a)
  })

  it('a variance above the threshold needs a reason; the reason is trimmed (spec §4.8)', () => {
    const short: ZInput = { ...input, countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 5_000, count: 1 }], countedCashSatang: 55_000 }
    expect(() => buildZReport(short, null)).toThrow(/reason/)
    expect(() => buildZReport({ ...short, varianceReason: '   ' }, null)).toThrow(/reason/)
    const z = buildZReport({ ...short, varianceReason: '  ทอนผิด  ' }, null)
    expect(z.snapshot).toMatchObject({ cashVarianceSatang: -3_000, varianceReason: 'ทอนผิด' })
  })

  it('freezes the bank-app QR total and the QR difference = bank − QR net (Q3b-12 · D53)', () => {
    expect(buildZReport({ ...input, bankQrTotalSatang: 4_000 }, null).snapshot).toMatchObject({ bankQrTotalSatang: 4_000, qrDifferenceSatang: -500 })
    expect(buildZReport({ ...input, bankQrTotalSatang: 4_500 }, null).snapshot.qrDifferenceSatang).toBe(0)
    expect(() => buildZReport({ ...input, bankQrTotalSatang: -1 }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, bankQrTotalSatang: 0.5 }, null)).toThrow(RangeError)
  })

  it('a chain warning is frozen into the Z and must match the recomputed chain it chains from (Q3b-11 · D53)', () => {
    const w: ZChainWarning = { brokenShiftId: 's0', storedGrandTotalSatang: 999, recomputedGrandTotalSatang: 4_000, acknowledgedBy: 'u1' }
    const z = buildZReport({ ...input, zNo: 2, chainWarning: w }, { zNo: 1, grandTotalSatang: 4_000 })
    expect(z.snapshot).toMatchObject({ chainWarning: w, grandTotalSatang: 18_500 })
    expect(z.hash).toBe(zReportHash(z.snapshot))
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: w }, { zNo: 1, grandTotalSatang: 999 })).toThrow(RangeError)
    expect(() => buildZReport({ ...input, chainWarning: w }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: { ...w, acknowledgedBy: '' } }, { zNo: 1, grandTotalSatang: 4_000 })).toThrow(RangeError)
  })

  it('refuses inconsistent inputs (Plan 1 notes §4)', () => {
    expect(() => buildZReport({ ...input, sales: { ...sales, netSalesSatang: 14_501 } }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, sales: { ...sales, qrSalesSatang: 4_501 } }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, cash: { ...zCash, cashSalesSatang: 19_001 } }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, countedCashSatang: 58_001 }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, voids: [] }, null)).toThrow(RangeError)
    expect(() => buildZReport(input, { zNo: 0, grandTotalSatang: -1 })).toThrow(RangeError)
    expect(() => buildZReport({ ...input, zNo: 3 }, { zNo: 1, grandTotalSatang: 0 })).toThrow(RangeError)
    // the void list ties to the cash drawer (VOID_REFUND rows) and to the QR refunds
    expect(() => buildZReport({ ...input, cash: { ...zCash, voidRefundsSatang: 8_999 } }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, voids: [{ ...input.voids[0]!, method: 'PROMPTPAY' }] }, null)).toThrow(RangeError)
  })
})
