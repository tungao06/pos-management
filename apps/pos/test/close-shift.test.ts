import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { zReportHash } from '@dayo/domain'
import { shiftReportFingerprint } from '../src/api/shift-report'
import type { CloseShiftInput } from '../src/api/types'
import { hashPin } from '../src/lib/pin'
import { openReadyApi, PINS, sellSku, TEST_PIN_COST, type ReadyApi } from './helpers/db'
import { COUNT_520, sellVoidScenario } from './helpers/shift'

/** Fetches the X report the screen would show right now and builds the close input from it — `shownExpectedCashSatang`
 * and `shownReportFingerprint` (Q3b-17 · D54) always match the live shift unless `patch` overrides them, the same way
 * a UI screen would fill them in from its own `shiftReport()` call just before submitting. */
async function closeInput(t: ReadyApi, patch: Partial<CloseShiftInput> = {}): Promise<CloseShiftInput> {
  const report = await t.api.shiftReport()
  return {
    actorUserId: t.owner.id,
    approverUserId: t.owner.id,
    approverPin: PINS.TungAo,
    countLines: COUNT_520,
    shownExpectedCashSatang: report.expectedCashSatang,
    shownReportFingerprint: shiftReportFingerprint(report),
    varianceReason: null,
    bankQrTotalSatang: null,
    acknowledgeZChainBroken: false,
    ...patch,
  }
}

function counts(t: ReadyApi): Record<string, number> {
  const out: Record<string, number> = {}
  for (const table of ['cash_count', 'z_report', 'outbox']) out[table] = (t.raw.prepare(`select count(*) as c from "${table}"`).get() as { c: number }).c
  out['open_shift'] = (t.raw.prepare(`select count(*) as c from shift where status = 'open'`).get() as { c: number }).c
  return out
}

describe('closeShift — count by denomination, frozen Z (spec §4.8, D22, D36)', () => {
  it('writes cash_count + z_report + shift closed in one transaction, each with its outbox row', async () => {
    const t = await openReadyApi()
    const sc = await sellVoidScenario(t)
    t.clock.set('2026-09-17T13:05:00.000Z')
    const z = await t.api.closeShift(await closeInput(t, { actorUserId: t.other.id }))

    expect(z.hashOk).toBe(true)
    expect(z.hash).toBe(zReportHash(z.snapshot))
    expect(z.snapshot).toMatchObject({
      shiftId: t.shift.id,
      businessDate: '2026-09-17',
      deviceId: t.device.id,
      zNo: 1,
      openedAt: t.shift.openedAt,
      openedBy: t.owner.id,
      openedQuick: false,
      closedAt: '2026-09-17T13:05:00.000Z',
      closedBy: t.owner.id,
      countedBy: t.other.id,
      sales: { orderCount: 3, voidCount: 2, grossSalesSatang: 18_500, discountSatang: 500, voidedSatang: 14_000, netSalesSatang: 4_000, cashSalesSatang: 13_000, qrSalesSatang: 5_000, qrRefundedSatang: 5_000, qrNetSatang: 0 },
      cash: { openingFloatSatang: 50_000, cashSalesSatang: 13_000, voidRefundsSatang: 9_000, paidInSatang: 0, paidOutSatang: 2_000, dropsSatang: 0 },
      countedCashSatang: 52_000,
      expectedCashSatang: 52_000,
      cashVarianceSatang: 0,
      varianceAlertSatang: 2_000,
      varianceReason: null,
      bankQrTotalSatang: null,
      qrDifferenceSatang: null,
      chainWarning: null,
      grandTotalSatang: 4_000,
    })
    expect(z.snapshot!.countLines).toHaveLength(9)
    expect(z.snapshot!.voids.map((v) => [v.receiptNo, v.refundReference])).toEqual([['A-000001', null], ['A-000002', 'KBANK-1']])
    expect(z.snapshot!.voids[0]!.orderId).toBe(sc.cashVoided.orderId)

    const count = await t.db.select().from(s.cashCount).get()
    expect(count).toMatchObject({ shiftId: t.shift.id, countedSatang: 52_000, expectedSatang: 52_000, varianceSatang: 0, reason: null, countedBy: t.other.id })
    const shift = await t.db.select().from(s.shift).where(eq(s.shift.id, t.shift.id)).get()
    expect(shift).toMatchObject({ status: 'closed', closedBy: t.owner.id, closedAt: '2026-09-17T13:05:00.000Z' })
    const keys = (await t.db.select().from(s.outbox).all()).map((r) => r.idempotencyKey)
    expect(keys).toContain(`cash_count:${count!.id}`)
    expect(keys).toContain(`z_report:${z.id}`)
    expect(keys).toContain(`shift:${t.shift.id}:closed`)

    const boot = await t.api.bootstrap()
    expect(boot.openShift).toBeNull()
    expect(await t.api.getZReport(t.shift.id)).toEqual(z)
    expect(await t.api.listZReports()).toEqual([{ shiftId: t.shift.id, businessDate: '2026-09-17', zNo: 1, closedAt: '2026-09-17T13:05:00.000Z', netSalesSatang: 4_000, cashVarianceSatang: 0, openedQuick: false, hashOk: true, chainWarning: false }])
    // after the close: no selling, no void, no second close (spec §4.8, D47 ข้อ 2)
    await expect(sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 })).rejects.toThrow(/^NO_OPEN_SHIFT: /)
    await expect(t.api.voidOrder({ orderId: sc.cashKept.orderId, actorUserId: t.owner.id, approverUserId: t.owner.id, approverPin: PINS.TungAo, reason: 'x', made: false, refundReference: null })).rejects.toThrow(/^VOID_NOT_ALLOWED: /)
    // no open shift left to build a fresh X report from — a bare input is enough, since closeShift fails before ever reading it
    await expect(
      t.api.closeShift({ actorUserId: t.owner.id, approverUserId: t.owner.id, approverPin: PINS.TungAo, countLines: COUNT_520, shownExpectedCashSatang: 0, shownReportFingerprint: 'x', varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: false }),
    ).rejects.toThrow(/^NO_OPEN_SHIFT: /)
  })

  it('a variance above ฿20 needs a reason — without one nothing is written; with one it is kept (spec §4.8)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    // ฿500 counted, ฿520 expected → −฿20, which is not above the ฿20 threshold: no reason needed
    const z0 = await t.api.closeShift(await closeInput(t, { countLines: [{ denominationSatang: 50_000, count: 1 }] }))
    expect(z0.snapshot).toMatchObject({ cashVarianceSatang: -2_000, varianceReason: null })

    const u = await openReadyApi()
    await sellVoidScenario(u)
    // ฿470 counted → −฿50
    const shorter = [{ denominationSatang: 10_000, count: 4 }, { denominationSatang: 5_000, count: 1 }, { denominationSatang: 2_000, count: 1 }]
    const before2 = counts(u)
    await expect(u.api.closeShift(await closeInput(u, { countLines: shorter }))).rejects.toThrow(/^VARIANCE_REASON_REQUIRED: /)
    await expect(u.api.closeShift(await closeInput(u, { countLines: shorter, varianceReason: '   ' }))).rejects.toThrow(/^VARIANCE_REASON_REQUIRED: /)
    expect(counts(u)).toEqual(before2)
    const z = await u.api.closeShift(await closeInput(u, { countLines: shorter, varianceReason: ' ทอนเงินผิด ' }))
    expect(z.snapshot).toMatchObject({ countedCashSatang: 47_000, cashVarianceSatang: -5_000, varianceReason: 'ทอนเงินผิด' })
    expect(await u.db.select().from(s.cashCount).get()).toMatchObject({ varianceSatang: -5_000, reason: 'ทอนเงินผิด' })
  })

  it('refuses a stale expected cash (SHIFT_CHANGED), bad counts, a wrong PIN and a staff approver — writing nothing', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    t.raw
      .prepare('insert into "user" (id, display_name, role, pin_hash, is_active, created_at, updated_at, version) values (?, ?, ?, ?, 1, ?, ?, 1)')
      .run('staff-1', 'พนักงาน', 'staff', await hashPin('3333', TEST_PIN_COST), t.clock.now(), t.clock.now())
    const before = counts(t)
    await expect(t.api.closeShift(await closeInput(t, { shownExpectedCashSatang: 50_000 }))).rejects.toThrow(/^SHIFT_CHANGED: /)
    await expect(t.api.closeShift(await closeInput(t, { countLines: [{ denominationSatang: 2_500, count: 1 }] }))).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.closeShift(await closeInput(t, { countLines: [{ denominationSatang: 100, count: -1 }] }))).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.closeShift(await closeInput(t, { varianceReason: 'ก'.repeat(201) }))).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.closeShift(await closeInput(t, { approverPin: '9999' }))).rejects.toThrow(/^PIN_WRONG: /)
    await expect(t.api.closeShift(await closeInput(t, { approverUserId: 'staff-1', approverPin: '3333' }))).rejects.toThrow(/^NOT_OWNER: /)
    expect(counts(t)).toEqual(before)
  })

  it('a PromptPay sale made after the screen showed the report still triggers SHIFT_CHANGED, even though cash is untouched (m-1 · Q3b-17 · D54)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    const stale = await closeInput(t) // the close screen just showed this X report
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' }) // a QR sale while the screen is open — expectedCashSatang does not move
    const fresh = await t.api.shiftReport()
    expect(fresh.expectedCashSatang).toBe(stale.shownExpectedCashSatang) // the old, cash-only check would have missed this
    const before = counts(t)
    await expect(t.api.closeShift(stale)).rejects.toThrow(/^SHIFT_CHANGED: /)
    expect(counts(t)).toEqual(before)
    // a fresh input (recomputed after the sale) closes fine
    const z = await t.api.closeShift(await closeInput(t))
    expect(z.snapshot!.sales.qrSalesSatang).toBe(10_000)
  })

  it('grand total runs across shifts: Z(n).grand = Z(n−1).grand + net (spec §4.8); a quick-opened shift is marked', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    const z1 = await t.api.closeShift(await closeInput(t))
    t.clock.set('2026-09-18T02:00:00.000Z')
    await t.api.quickOpenShift({ userId: t.owner.id })
    await sellSku(t, 'Latte-16oz', 2, { method: 'CASH', tenderedSatang: 10_000 })
    const x = await t.api.shiftReport()
    expect(x.expectedCashSatang).toBe(10_000) // float 0 + ฿100
    const z2 = await t.api.closeShift(await closeInput(t, { countLines: [{ denominationSatang: 10_000, count: 1 }] }))
    expect(z2.snapshot).toMatchObject({ businessDate: '2026-09-18', zNo: 2, openedQuick: true, grandTotalSatang: z1.snapshot!.grandTotalSatang + 10_000 })
    expect((await t.api.listZReports()).map((z) => z.businessDate)).toEqual(['2026-09-18', '2026-09-17'])
  })

  it('the grand total follows the Z number, not the clock (a clock set back cannot skip a Z)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    t.clock.set('2026-09-18T13:00:00.000Z') // tablet clock a day ahead
    const z1 = await t.api.closeShift(await closeInput(t))
    t.clock.set('2026-09-17T14:00:00.000Z') // corrected
    for (const n of [2, 3]) {
      await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
      await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
      const z = await t.api.closeShift(await closeInput(t, { countLines: [] }))
      expect(z.snapshot).toMatchObject({ zNo: n, grandTotalSatang: z1.snapshot!.grandTotalSatang + 5_000 * (n - 1) })
      t.clock.advanceMs(3_600_000)
    }
  })


  it('freezes the bank-app PromptPay total and the QR difference — optional, never blocks (Q3b-12 · D53)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t) // QR ฿50 received and ฿50 transferred back
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' }) // + ฿50 → received ฿100 · refunded ฿50 · net ฿50
    await expect(t.api.closeShift(await closeInput(t, { bankQrTotalSatang: -1 }))).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.closeShift(await closeInput(t, { bankQrTotalSatang: 10.5 }))).rejects.toThrow(/^BAD_INPUT: /)
    // acknowledging when nothing is broken changes nothing
    const z = await t.api.closeShift(await closeInput(t, { bankQrTotalSatang: 4_500, acknowledgeZChainBroken: true }))
    expect(z.snapshot!.sales).toMatchObject({ qrSalesSatang: 10_000, qrRefundedSatang: 5_000, qrNetSatang: 5_000 })
    expect(z.snapshot).toMatchObject({ bankQrTotalSatang: 4_500, qrDifferenceSatang: -500, chainWarning: null })
  })

  it('the Z report is append-only in the DB, and a tampered snapshot fails its hash (spec §7 invariant 6)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    await t.api.closeShift(await closeInput(t))
    expect(() => t.raw.prepare('update z_report set hash = ?').run('x')).toThrow(/append-only/)
    expect(() => t.raw.prepare('delete from z_report').run()).toThrow(/append-only/)
    // Simulate someone editing the file by hand (drop the guard first): the hash no longer matches.
    t.raw.exec('DROP TRIGGER z_report_no_update')
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.sales.netSalesSatang', 1)`).run()
    expect((await t.api.getZReport(t.shift.id)).hashOk).toBe(false)
    expect(await t.api.listZReports()).toMatchObject([{ hashOk: false, chainWarning: false }])
  })

  it('a previous Z that fails its hash: Z_CHAIN_BROKEN until an owner acknowledges with their PIN, then the new Z chains from the recomputed total and is flagged for good (Q3b-11 · D53)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    const z1 = await t.api.closeShift(await closeInput(t)) // net ฿40 → grand ฿40
    t.raw.exec('DROP TRIGGER z_report_no_update')
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.grandTotalSatang', 999)`).run() // the stored total is edited

    t.clock.set('2026-09-18T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' }) // net ฿50
    const next = await closeInput(t, { countLines: [] })
    const before = counts(t)
    await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z1.shiftId}$`))
    await expect(t.api.closeShift({ ...next, acknowledgeZChainBroken: true, approverPin: '9999' })).rejects.toThrow(/^PIN_WRONG: /)
    expect(counts(t)).toEqual(before) // nothing written until the owner acknowledges with a correct PIN

    const z2 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
    expect(z2.hashOk).toBe(true)
    expect(z2.snapshot).toMatchObject({
      zNo: 2,
      grandTotalSatang: 4_000 + 5_000, // recomputed Σ net of the earlier snapshots (฿40), never the edited 999
      chainWarning: { brokenShiftId: z1.shiftId, storedGrandTotalSatang: 999, recomputedGrandTotalSatang: 4_000, acknowledgedBy: t.owner.id, unreadableZs: [] },
    })
    const ack = (await t.db.select().from(s.auditLog).all()).filter((a) => a.action === 'z_chain_broken_ack')
    expect(ack).toEqual([
      {
        id: expect.any(String),
        entity: 'z_report',
        entityId: z2.id,
        action: 'z_chain_broken_ack',
        beforeJson: { brokenShiftId: z1.shiftId, storedGrandTotalSatang: 999 },
        afterJson: { zNo: 2, recomputedGrandTotalSatang: 4_000 },
        actorUserId: t.owner.id,
        at: '2026-09-18T02:00:00.000Z',
      },
    ])
    expect((await t.api.listZReports()).map((z) => [z.zNo, z.hashOk, z.chainWarning])).toEqual([
      [2, true, true],
      [1, false, false],
    ])

    // the flagged Z itself is intact, so the next close chains from it normally, without a new warning
    t.clock.set('2026-09-19T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    const z3 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
    expect(z3.snapshot).toMatchObject({ zNo: 3, grandTotalSatang: 9_000, chainWarning: null })
  })

  it('a previous Z with only its stored net tampered: the chain still recovers the true total from gross/discount/voided, unflagged (C-1 · Q3b-16 · D54)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    const z1 = await t.api.closeShift(await closeInput(t)) // gross 18_500, discount 500, voided 14_000 → true net 4_000
    t.raw.exec('DROP TRIGGER z_report_no_update')
    // only the stored net lies (4_000 → 1); gross/discount/voided are untouched and still self-consistent
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.sales.netSalesSatang', 1)`).run()

    t.clock.set('2026-09-18T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' }) // net ฿50
    const next = await closeInput(t, { countLines: [] })
    const before = counts(t)
    await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z1.shiftId}$`))
    expect(counts(t)).toEqual(before)

    const z2 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
    expect(z2.hashOk).toBe(true)
    // the recompute trusts gross − discount − voided over the lying stored net, so nothing is unreadable
    expect(z2.snapshot).toMatchObject({ zNo: 2, grandTotalSatang: 4_000 + 5_000, chainWarning: { brokenShiftId: z1.shiftId, recomputedGrandTotalSatang: 4_000, unreadableZs: [] } })
  })

  it('a previous Z whose zNo was edited: the chain still closes, numbering from the row count (C-1 · Q3b-16 · D54)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    const z1 = await t.api.closeShift(await closeInput(t)) // net ฿40
    t.raw.exec('DROP TRIGGER z_report_no_update')
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.zNo', 7)`).run() // zNo edited; sales untouched

    t.clock.set('2026-09-18T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' }) // net ฿50
    const next = await closeInput(t, { countLines: [] })
    await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z1.shiftId}$`))

    const z2 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
    expect(z2.hashOk).toBe(true)
    // exactly one earlier Z row, whatever its own claimed zNo says — the new zNo is 1 (row count) + 1
    expect(z2.snapshot).toMatchObject({ zNo: 2, grandTotalSatang: 4_000 + 5_000, chainWarning: { brokenShiftId: z1.shiftId, recomputedGrandTotalSatang: 4_000, unreadableZs: [] } })
  })

  it('a previous Z whose JSON is entirely unreadable: the chain still closes, treating its net as 0 and flagging it (C-1 · Q3b-16 · D54)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    const z1 = await t.api.closeShift(await closeInput(t)) // net ฿40, now unreadable
    t.raw.exec('DROP TRIGGER z_report_no_update')
    t.raw.prepare(`update z_report set snapshot_json = 'not json' where shift_id = ?`).run(z1.shiftId)

    t.clock.set('2026-09-18T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' }) // net ฿50
    const next = await closeInput(t, { countLines: [] })
    const before = counts(t)
    await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z1.shiftId}$`))
    expect(counts(t)).toEqual(before)

    const z2 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
    expect(z2.hashOk).toBe(true)
    // z1's net could not be read at all → treated as 0; only its own ฿50 counts, and it is listed as unreadable
    expect(z2.snapshot).toMatchObject({
      zNo: 2,
      grandTotalSatang: 5_000,
      chainWarning: { brokenShiftId: z1.shiftId, storedGrandTotalSatang: null, recomputedGrandTotalSatang: 0, unreadableZs: [{ shiftId: z1.shiftId, zNo: null }] },
    })
  })

  it('a snapshot that is not readable JSON, or is missing sales, is flagged rather than crashing list/get (review I-1)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    const z = await t.api.closeShift(await closeInput(t))
    t.raw.exec('DROP TRIGGER z_report_no_update')

    t.raw.prepare(`update z_report set snapshot_json = 'not json' where shift_id = ?`).run(t.shift.id)
    const gotInvalid = await t.api.getZReport(t.shift.id)
    expect(gotInvalid).toEqual({ id: z.id, shiftId: t.shift.id, createdAt: z.createdAt, hash: z.hash, hashOk: false, snapshot: null })
    expect(await t.api.listZReports()).toEqual([
      { shiftId: t.shift.id, businessDate: null, zNo: null, closedAt: null, netSalesSatang: null, cashVarianceSatang: null, openedQuick: null, hashOk: false, chainWarning: false },
    ])

    t.raw.prepare(`update z_report set snapshot_json = json_remove(?, '$.sales') where shift_id = ?`).run(JSON.stringify(z.snapshot), t.shift.id)
    const gotNoSales = await t.api.getZReport(t.shift.id)
    expect(gotNoSales).toEqual({ id: z.id, shiftId: t.shift.id, createdAt: z.createdAt, hash: z.hash, hashOk: false, snapshot: null })
    expect(await t.api.listZReports()).toEqual([
      { shiftId: t.shift.id, businessDate: null, zNo: null, closedAt: null, netSalesSatang: null, cashVarianceSatang: null, openedQuick: null, hashOk: false, chainWarning: false },
    ])
  })

  it('rolls back cash_count and outbox too when a later write in the same transaction fails (m-2)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    t.raw.exec(`create trigger boom_before_z_report before insert on z_report begin select raise(abort, 'boom'); end`)
    const before = counts(t)
    const failure = await t.api.closeShift(await closeInput(t)).catch((e: unknown) => e)
    expect(String((failure as { cause?: unknown })?.cause ?? failure)).toMatch(/boom/)
    expect(counts(t)).toEqual(before) // the earlier cash_count insert (and its outbox row) rolled back too

    t.raw.exec('drop trigger boom_before_z_report')
    const z = await t.api.closeShift(await closeInput(t))
    expect(z.snapshot).toMatchObject({ zNo: 1 })
  })

  it('the positive variance boundary needs no reason at +฿20 and does above it (m-3)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    // ฿520 expected, ฿540 counted → +฿20, not above the ฿20 threshold: no reason needed
    const zAt = await t.api.closeShift(await closeInput(t, { countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 2_000, count: 2 }] }))
    expect(zAt.snapshot).toMatchObject({ cashVarianceSatang: 2_000, varianceReason: null })

    const u = await openReadyApi()
    await sellVoidScenario(u)
    // ฿541 counted → +฿21
    const over = [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 2_000, count: 2 }, { denominationSatang: 100, count: 1 }]
    await expect(u.api.closeShift(await closeInput(u, { countLines: over }))).rejects.toThrow(/^VARIANCE_REASON_REQUIRED: /)
    const zOver = await u.api.closeShift(await closeInput(u, { countLines: over, varianceReason: 'เกินมา' }))
    expect(zOver.snapshot).toMatchObject({ cashVarianceSatang: 2_100, varianceReason: 'เกินมา' })
  })

  it('a tampered middle Z is flagged in the list without blocking a later close (m-4)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    await t.api.closeShift(await closeInput(t)) // Z1, net ฿40
    t.clock.set('2026-09-18T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
    const z2 = await t.api.closeShift(await closeInput(t, { countLines: [] })) // Z2, net ฿50
    t.clock.set('2026-09-19T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
    await t.api.closeShift(await closeInput(t, { countLines: [] })) // Z3, net ฿50, chains fine

    t.raw.exec('DROP TRIGGER z_report_no_update')
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.grandTotalSatang', 1) where shift_id = ?`).run(z2.shiftId)

    expect((await t.api.listZReports()).map((z) => [z.zNo, z.hashOk])).toEqual([
      [3, true],
      [2, false],
      [1, true],
    ])

    // the last Z (Z3) is intact, so closing again does not see the middle tamper at all
    t.clock.set('2026-09-20T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    const z4 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
    expect(z4.snapshot).toMatchObject({ zNo: 4, chainWarning: null })
  })
})
