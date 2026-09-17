import { describe, expect, it } from 'vitest'
import { buildZReport, expectedCashSatang, type CashInputs, type ZInput } from '../src/shift.js'

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
    // The bill was paid in cash (45 baht in the drawer), then voided (VOID_REFUND 45 baht out of the drawer).
    // PAID_OUT holds only manual paid-outs, so the refund cannot be counted a second time.
    const x: CashInputs = { openingFloatSatang: 100_000, cashSalesSatang: 4_500, voidRefundsSatang: 4_500, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 }
    expect(expectedCashSatang(x)).toBe(100_000)
  })
})

describe('buildZReport', () => {
  const input: ZInput = {
    shiftId: 's1', businessDate: '2026-09-17', deviceId: 'dev-A', closedAt: '2026-09-17T13:05:00.000Z', closedBy: 'u1',
    orderCount: 120, voidCount: 2, grossSalesSatang: 700_000, discountSatang: 5_000, netSalesSatang: 695_000, voidedSatang: 9_000,
    cashSalesSatang: 523_000, qrSalesSatang: 172_000, cash, countedCashSatang: 298_000, varianceReason: null,
  }
  it('computes expected cash, variance and running grand total', () => {
    const z = buildZReport(input, 10_000_000)
    expect(z.snapshot.expectedCashSatang).toBe(298_500)
    expect(z.snapshot.cashVarianceSatang).toBe(-500)
    expect(z.snapshot.grandTotalSatang).toBe(10_695_000)
    expect(z.snapshot.cash.voidRefundsSatang).toBe(4_500)
    expect(z.hash).toHaveLength(64)
  })
  it('hash changes when any number changes', () => {
    const a = buildZReport(input, 0).hash
    const b = buildZReport({ ...input, netSalesSatang: 695_001 }, 0).hash
    const c = buildZReport({ ...input, cash: { ...cash, voidRefundsSatang: 4_501 } }, 0).hash
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
    expect(buildZReport(input, 0).hash).toBe(a)
  })
})
