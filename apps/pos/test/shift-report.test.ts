import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { openReadyApi, openTestApi, TEST_SETUP } from './helpers/db'
import { sellVoidScenario } from './helpers/shift'

describe('shiftReport — X report (spec §4.8: live, any time, writes nothing)', () => {
  it('sums sales, cash and voids of the open shift exactly (D36 · spec §4.3 · Q3b-4 · D52)', async () => {
    const t = await openReadyApi()
    const sc = await sellVoidScenario(t)
    const before = await t.db.select().from(s.outbox).all()
    const x = await t.api.shiftReport()
    expect(await t.db.select().from(s.outbox).all()).toEqual(before) // an X report writes nothing

    expect(x.shift).toMatchObject({ id: t.shift.id, openedByName: 'TungAo', openedQuick: false, openingFloatSatang: 50_000 })
    expect(x.generatedAt).toBe('2026-09-17T03:01:00.000Z')
    expect(x.sales).toEqual({ orderCount: 3, voidCount: 2, grossSalesSatang: 18_500, discountSatang: 500, voidedSatang: 14_000, netSalesSatang: 4_000, cashSalesSatang: 13_000, qrSalesSatang: 5_000, qrRefundedSatang: 5_000, qrNetSatang: 0 })
    expect(x.cash).toEqual({ openingFloatSatang: 50_000, cashSalesSatang: 13_000, voidRefundsSatang: 9_000, paidInSatang: 0, paidOutSatang: 2_000, dropsSatang: 0 })
    expect(x.expectedCashSatang).toBe(52_000)
    expect(x.varianceAlertSatang).toBe(2_000) // spec §3.1 default — no setting row yet
    expect(x.cashMovements.map((m) => [m.kind, m.amountSatang])).toEqual([
      ['VOID_REFUND', 9_000],
      ['PAID_OUT', 2_000],
    ])
    // the daily void report (D50 Q3-22): reason, approver, made/waste, QR refund reference read from the VOIDED event (plan 3 notes §5)
    expect(x.voids).toEqual([
      { orderId: sc.cashVoided.orderId, receiptNo: 'A-000001', totalSatang: 9_000, method: 'CASH', reason: 'กดผิดเมนู', made: false, approvedBy: t.other.id, approvedByName: 'DCm', refundReference: null, voidedAt: '2026-09-17T03:01:00.000Z' },
      { orderId: sc.qrVoided.orderId, receiptNo: 'A-000002', totalSatang: 5_000, method: 'PROMPTPAY', reason: 'ทำผิดสูตร', made: true, approvedBy: t.other.id, approvedByName: 'DCm', refundReference: 'KBANK-1', voidedAt: '2026-09-17T03:01:00.000Z' },
    ])
    // D28: tracked bases below zero only (ice and other untracked items never show)
    expect(x.negativeBases.map((b) => [b.code, b.onHandMilli])).toEqual([
      ['PB-SYRUP', -47_200],
      ['PB-TEA-THAI', -260_000],
    ])
    expect(x.pendingSyncItems).toBe(5) // shift + 3 bills + the PAID_OUT (D50 Q3-26)
  })

  it('an empty shift is all zeros; expected cash = the float', async () => {
    const t = await openReadyApi()
    const x = await t.api.shiftReport()
    expect(x.sales.orderCount).toBe(0)
    expect(x.expectedCashSatang).toBe(50_000)
    expect(x.voids).toEqual([])
  })

  it('shows a quick-opened shift (Q3b-10 · D52) and needs an open shift', async () => {
    const t = await openTestApi()
    await t.api.setupShop(TEST_SETUP)
    const { users } = await t.api.bootstrap()
    await expect(t.api.shiftReport()).rejects.toThrow(/^NO_OPEN_SHIFT: /)
    await t.api.quickOpenShift({ userId: users[0]!.id })
    expect((await t.api.shiftReport()).shift.openedQuick).toBe(true)
  })

  it('uses the cash.variance_alert_satang setting when one is in force (spec §3.1)', async () => {
    const t = await openReadyApi()
    await t.db.insert(s.setting).values({ key: 'cash.variance_alert_satang', valueJson: 5_000, effectiveFrom: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', version: 1 })
    expect((await t.api.shiftReport()).varianceAlertSatang).toBe(5_000)
  })
})
