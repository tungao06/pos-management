import { describe, expect, it } from 'vitest'
import { buildZReport, expectedCashSatang, type ZInput } from '../src/shift.js'

const cash = { openingFloatSatang: 100_000, cashSalesSatang: 523_000, cashRefundsSatang: 4_500, paidInSatang: 0, paidOutSatang: 20_000, dropsSatang: 300_000 }

describe('expectedCashSatang', () => {
  it('opening + sales − refunds + paid in − paid out − drops', () => {
    expect(expectedCashSatang(cash)).toBe(100_000 + 523_000 - 4_500 - 20_000 - 300_000)
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
    expect(z.hash).toHaveLength(64)
  })
  it('hash changes when any number changes', () => {
    const a = buildZReport(input, 0).hash
    const b = buildZReport({ ...input, netSalesSatang: 695_001 }, 0).hash
    expect(a).not.toBe(b)
    expect(buildZReport(input, 0).hash).toBe(a)
  })
})
