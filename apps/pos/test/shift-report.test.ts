import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { buildZReport } from '@dayo/domain'
import { openReadyApi, openTestApi, PINS, sellSku, TEST_SETUP } from './helpers/db'
import { COUNT_520, sellVoidScenario } from './helpers/shift'

describe('shiftReport — X report (spec §4.8: live, any time, writes nothing)', () => {
  it('sums sales, cash and voids of the open shift exactly (D36 · spec §4.3 · Q3b-4 · D52)', async () => {
    const t = await openReadyApi()
    const sc = await sellVoidScenario(t)
    const before = await t.db.select().from(s.outbox).all()
    // m-4: nothing at all is written, not only the outbox — total_changes() is sqlite's own count of every
    // insert/update/delete on this connection since it opened, so a stray write to order_event, audit_log,
    // setting or sync_state (a table the outbox check alone would miss) would move it.
    const changesBefore = (t.raw.prepare('select total_changes() as n').get() as { n: number }).n
    const x = await t.api.shiftReport()
    expect(await t.db.select().from(s.outbox).all()).toEqual(before) // an X report writes nothing
    expect((t.raw.prepare('select total_changes() as n').get() as { n: number }).n).toBe(changesBefore)

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
    // m-3: every zero, not only orderCount/expectedCashSatang/voids
    expect(x.sales).toEqual({ orderCount: 0, voidCount: 0, grossSalesSatang: 0, discountSatang: 0, voidedSatang: 0, netSalesSatang: 0, cashSalesSatang: 0, qrSalesSatang: 0, qrRefundedSatang: 0, qrNetSatang: 0 })
    expect(x.cash).toEqual({ openingFloatSatang: 50_000, cashSalesSatang: 0, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 })
    expect(x.expectedCashSatang).toBe(50_000)
    expect(x.cashMovements).toEqual([])
    expect(x.voids).toEqual([])
    expect(x.negativeBases).toEqual([])
  })

  it('a second shift excludes the first shift, handles discounted voids, and its X figures are accepted by buildZReport at zero variance (I-1)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t) // shift 1's ฿520 worth of rows — must never leak into shift 2's report
    await t.api.closeShift({
      actorUserId: t.owner.id,
      approverUserId: t.owner.id,
      approverPin: PINS.TungAo,
      countLines: COUNT_520,
      shownExpectedCashSatang: 52_000,
      shownReportFingerprint: (await t.api.shiftReport()).fingerprint,
      varianceReason: null,
      bankQrTotalSatang: null,
      acknowledgeZChainBroken: false,
    })

    const shift2 = await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 10_000 }) // ฿100 float, a fresh shift

    // (a) one plain cash sale first: if the shift filter were gone, shift 1's ฿520 would show up here too
    const firstSale = await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 5_000 }) // ฿45, no discount
    let x = await t.api.shiftReport()
    expect(x.shift.id).toBe(shift2.id)
    expect(x.sales).toEqual({ orderCount: 1, voidCount: 0, grossSalesSatang: 4_500, discountSatang: 0, voidedSatang: 0, netSalesSatang: 4_500, cashSalesSatang: 4_500, qrSalesSatang: 0, qrRefundedSatang: 0, qrNetSatang: 0 })
    expect(x.cash).toEqual({ openingFloatSatang: 10_000, cashSalesSatang: 4_500, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 })
    expect(x.expectedCashSatang).toBe(14_500) // ฿100 float + ฿45 cash — not ฿520 + ฿45

    // (b) a discounted cash bill and a discounted QR bill, both voided, plus a paid-in and a drop
    const cashVoided = await sellSku(t, 'Original-16oz', 2, { method: 'CASH', tenderedSatang: 10_000 }, { amountSatang: 1_000, reason: 'ราคาพิเศษ' }) // ฿90 − ฿10 = ฿80
    const qrVoided = await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' }, { amountSatang: 700, reason: 'ราคาพิเศษ' }) // ฿50 − ฿7 = ฿43
    t.clock.advanceMs(60_000)
    const base = { actorUserId: t.owner.id, approverUserId: t.other.id, approverPin: PINS.DCm }
    await t.api.voidOrder({ ...base, orderId: cashVoided.orderId, reason: 'ยกเลิกเบิกผิด', made: false, refundReference: null })
    await t.api.voidOrder({ ...base, orderId: qrVoided.orderId, reason: 'ทำผิดสูตร', made: true, refundReference: 'KBANK-2' })
    await t.api.recordCashMovement({ actorUserId: t.owner.id, kind: 'PAID_IN', amountSatang: 1_000, reason: 'เติมเงินทอน' })
    await t.api.recordCashMovement({ actorUserId: t.owner.id, kind: 'DROP', amountSatang: 3_000, reason: 'ฝากธนาคาร' })

    x = await t.api.shiftReport()
    // hand-computed literals: gross 4,500 + 9,000 + 5,000 = 18,500 · discount 1,000 + 700 = 1,700 ·
    // voided 8,000 (cash, discounted) + 4,300 (QR, discounted) = 12,300 · net 18,500 − 1,700 − 12,300 = 4,500
    expect(x.sales).toEqual({
      orderCount: 3,
      voidCount: 2,
      grossSalesSatang: 18_500,
      discountSatang: 1_700,
      voidedSatang: 12_300,
      netSalesSatang: 4_500,
      cashSalesSatang: 12_500, // 4,500 (kept) + 8,000 (voided, discounted total, still received in cash)
      qrSalesSatang: 4_300,
      qrRefundedSatang: 4_300, // the whole QR bill was voided
      qrNetSatang: 0,
    })
    // cash.voidRefundsSatang: only the cash bill's VOID_REFUND (its discounted total, ฿80, counted once) — D36
    expect(x.cash).toEqual({ openingFloatSatang: 10_000, cashSalesSatang: 12_500, voidRefundsSatang: 8_000, paidInSatang: 1_000, paidOutSatang: 0, dropsSatang: 3_000 })
    // expected = 10,000 + 12,500 − 8,000 + 1,000 − 0 − 3,000 = 12,500
    expect(x.expectedCashSatang).toBe(12_500)
    // clock: 03:00:00 (open) → +60s in sellVoidScenario (shift 1) → +60s just above → 03:02:00
    expect(x.generatedAt).toBe('2026-09-17T03:02:00.000Z')
    expect(x.voids).toEqual([
      { orderId: cashVoided.orderId, receiptNo: cashVoided.receiptNo, totalSatang: 8_000, method: 'CASH', reason: 'ยกเลิกเบิกผิด', made: false, approvedBy: t.other.id, approvedByName: 'DCm', refundReference: null, voidedAt: '2026-09-17T03:02:00.000Z' },
      { orderId: qrVoided.orderId, receiptNo: qrVoided.receiptNo, totalSatang: 4_300, method: 'PROMPTPAY', reason: 'ทำผิดสูตร', made: true, approvedBy: t.other.id, approvedByName: 'DCm', refundReference: 'KBANK-2', voidedAt: '2026-09-17T03:02:00.000Z' },
    ])

    // (c) the X figures are exactly what buildZReport (Task 6's contract) needs — proves the hand-off, without
    // going through closeShift itself. ฿100 (10,000) + ฿20 (2,000) + ฿5 (500) = ฿125 = the expected cash above.
    const countLines = [
      { denominationSatang: 10_000, count: 1 },
      { denominationSatang: 2_000, count: 1 },
      { denominationSatang: 500, count: 1 },
    ]
    const z = buildZReport(
      {
        shiftId: shift2.id,
        businessDate: shift2.businessDate,
        deviceId: t.device.id,
        zNo: 2,
        openedAt: shift2.openedAt,
        openedBy: shift2.openedBy,
        openedQuick: false, // shift 2 was opened with openShift, not quickOpenShift
        closedAt: '2026-09-17T03:02:00.000Z',
        closedBy: t.owner.id,
        countedBy: t.owner.id,
        sales: x.sales,
        cash: x.cash,
        countLines,
        countedCashSatang: 12_500,
        varianceAlertSatang: 2_000, // spec §3.1 default — no setting row in this test
        varianceReason: null,
        voids: x.voids,
        bankQrTotalSatang: null,
        chainWarning: null,
      },
      { zNo: 1, grandTotalSatang: 4_000 }, // shift 1's own net, from the real closeShift above
    )
    expect(z.snapshot.cashVarianceSatang).toBe(0)
    expect(z.snapshot.expectedCashSatang).toBe(12_500)
    expect(z.snapshot.grandTotalSatang).toBe(4_000 + 4_500)
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
