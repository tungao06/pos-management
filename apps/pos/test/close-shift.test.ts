import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { zReportHash } from '@dayo/domain'
import type { CloseShiftInput } from '../src/api/types'
import { hashPin } from '../src/lib/pin'
import { openReadyApi, PINS, sellSku, TEST_PIN_COST, type ReadyApi } from './helpers/db'
import { COUNT_520, sellVoidScenario } from './helpers/shift'

/** Fetches the X report the screen would show right now and builds the close input from it — `shownExpectedCashSatang`
 * and `shownReportFingerprint` (Q3b-17 · D54) always match the live shift unless `patch` overrides them, the same way
 * a UI screen would fill them in from its own `shiftReport()` call just before submitting (review NF-6: just reading
 * `report.fingerprint`, with no separate import of the helper that computes it). */
async function closeInput(t: ReadyApi, patch: Partial<CloseShiftInput> = {}): Promise<CloseShiftInput> {
  const report = await t.api.shiftReport()
  return {
    actorUserId: t.owner.id,
    approverUserId: t.owner.id,
    approverPin: PINS.TungAo,
    countLines: COUNT_520,
    shownExpectedCashSatang: report.expectedCashSatang,
    shownReportFingerprint: report.fingerprint,
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

/** Z1 (`sellVoidScenario`, net ฿40), Z2 and Z3 (one PromptPay ฿50 sale each) — true grand ฿140, 14_000 satang.
 * Review NF-7: every C-1 probe needs **2+** earlier Zs to catch NF-1/NF-3 (a single earlier Z is always `rows[0]`
 * regardless of ordering, healthy or not, which is exactly why the fix-round-1b tests missed both). Leaves the
 * clock at 2026-09-19T02:00 with every shift closed, ready for a 4th. */
async function closeThreeZs(t: ReadyApi) {
  await sellVoidScenario(t)
  const z1 = await t.api.closeShift(await closeInput(t))
  t.clock.set('2026-09-18T02:00:00.000Z')
  await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
  await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
  const z2 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
  t.clock.set('2026-09-19T02:00:00.000Z')
  await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
  await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
  const z3 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
  return { z1, z2, z3 }
}

/** Opens a shift at `date` (02:00 UTC), sells one PromptPay ฿50 and returns the close input the screen would build. */
async function nextShift(t: ReadyApi, date: string): Promise<CloseShiftInput> {
  t.clock.set(`${date}T02:00:00.000Z`)
  await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
  await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
  return closeInput(t, { countLines: [] })
}

function ackCount(t: ReadyApi): number {
  return (t.raw.prepare(`select count(*) as c from audit_log where action = 'z_chain_broken_ack'`).get() as { c: number }).c
}

/** Z1..Z3 (฿140), Z2's row deleted, then the acknowledged close Z4 (฿190, zNoGap 1) — the D55 middle-deletion
 * sequence every R4 probe starts from (review R4-1, R4-2). The clock is left at 2026-09-20. */
async function ackMiddleDeletion(t: ReadyApi) {
  const { z1, z2, z3 } = await closeThreeZs(t)
  t.raw.exec('DROP TRIGGER z_report_no_delete')
  t.raw.prepare(`delete from z_report where shift_id = ?`).run(z2.shiftId)
  const next = await nextShift(t, '2026-09-20')
  await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z3.shiftId}$`))
  const z4 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
  return { z1, z2, z3, z4 }
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
      chainWarning: { brokenShiftId: z1.shiftId, storedGrandTotalSatang: 999, recomputedGrandTotalSatang: 4_000, acknowledgedBy: t.owner.id, unreadableZs: [], zNoGap: 0 }, // lenient: zNo = row count + 1, no gap
    })
    const ack = (await t.db.select().from(s.auditLog).all()).filter((a) => a.action === 'z_chain_broken_ack')
    expect(ack).toEqual([
      {
        id: expect.any(String),
        entity: 'z_report',
        entityId: z2.id,
        action: 'z_chain_broken_ack',
        beforeJson: { brokenShiftId: z1.shiftId, storedGrandTotalSatang: 999 },
        afterJson: { zNo: 2, recomputedGrandTotalSatang: 4_000, rowCount: 1, maxStoredZNo: 1 },
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

  it('the last Z with only its own zNo unreadable still recovers every earlier ฿, with 2+ earlier Zs (review NF-1 · NF-7)', async () => {
    // review NF-1's probe: with a single earlier Z, the old bug never even triggered (it was always rows[0]) —
    // it needs Z1..Z3 for a hand-edited Z3 to have sorted *below* the intact Z2 under the old zNo-based ordering.
    const tampers = [
      `update z_report set snapshot_json = json_remove(snapshot_json, '$.zNo') where shift_id = ?`,
      `update z_report set snapshot_json = json_set(snapshot_json, '$.zNo', 0) where shift_id = ?`,
      `update z_report set snapshot_json = json_set(snapshot_json, '$.zNo', null) where shift_id = ?`,
      `update z_report set snapshot_json = json_set(snapshot_json, '$.zNo', 1.5) where shift_id = ?`,
    ]
    for (const tamperSql of tampers) {
      const t = await openReadyApi()
      const { z3 } = await closeThreeZs(t)
      t.raw.exec('DROP TRIGGER z_report_no_update')
      t.raw.prepare(tamperSql).run(z3.shiftId)

      t.clock.set('2026-09-20T02:00:00.000Z')
      await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
      await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' }) // + ฿50
      const next = await closeInput(t, { countLines: [] })
      const before = counts(t)
      await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z3.shiftId}$`))
      expect(counts(t)).toEqual(before)

      const z4 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
      // z3's sales are still intact (only zNo was touched), so its ฿50 is recovered in full — not flagged
      expect(z4.snapshot).toMatchObject({ zNo: 4, grandTotalSatang: 19_000, chainWarning: { brokenShiftId: z3.shiftId, recomputedGrandTotalSatang: 14_000, unreadableZs: [] } })

      // a clean close afterwards needs no acknowledgement at all (review NF-1/NF-3: no perpetual warning)
      t.clock.set('2026-09-21T02:00:00.000Z')
      await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
      const z5 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
      expect(z5.snapshot).toMatchObject({ zNo: 5, chainWarning: null })
    }
  })

  it('the last Z with its whole snapshot destroyed honestly loses (and flags) only its own ฿, with 2+ earlier Zs (review NF-1 · NF-7)', async () => {
    for (const tamperSql of [`update z_report set snapshot_json = 'not json' where shift_id = ?`, `update z_report set snapshot_json = 'null' where shift_id = ?`]) {
      const t = await openReadyApi()
      const { z3 } = await closeThreeZs(t)
      t.raw.exec('DROP TRIGGER z_report_no_update')
      t.raw.prepare(tamperSql).run(z3.shiftId)

      t.clock.set('2026-09-20T02:00:00.000Z')
      await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
      await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' }) // + ฿50
      const next = await closeInput(t, { countLines: [] })
      await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z3.shiftId}$`))

      const z4 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
      // z3's own data is genuinely gone — its ฿50 cannot be recovered, but (unlike the old silent-skip bug) it is
      // honestly treated as 0 and named in chainWarning, not silently kept out of the total with no trace at all
      expect(z4.snapshot).toMatchObject({ zNo: 4, grandTotalSatang: 14_000, chainWarning: { brokenShiftId: z3.shiftId, recomputedGrandTotalSatang: 9_000, unreadableZs: [{ shiftId: z3.shiftId, zNo: null }] } })

      t.clock.set('2026-09-21T02:00:00.000Z')
      await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
      const z5 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
      expect(z5.snapshot).toMatchObject({ zNo: 5, chainWarning: null })
    }
  })

  it("a middle Z's zNo tampered to a larger number or a string no longer blocks or re-warns any future close (review NF-3 · NF-7)", async () => {
    for (const middleZNo of [99, 'x']) {
      const t = await openReadyApi()
      const { z2 } = await closeThreeZs(t)
      t.raw.exec('DROP TRIGGER z_report_no_update')
      t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.zNo', ?) where shift_id = ?`).run(middleZNo, z2.shiftId)

      t.clock.set('2026-09-20T02:00:00.000Z')
      await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
      await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
      // the true last Z (z3, found by insertion order, not by any zNo) is untouched, so this closes cleanly —
      // no Z_CHAIN_BROKEN, no chainWarning, no owner PIN re-entry, unlike the old zNo-sorted bug (review NF-3)
      const z4 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
      expect(z4.snapshot).toMatchObject({ zNo: 4, grandTotalSatang: 19_000, chainWarning: null })

      // the tampered middle Z (z2) shows up only in the list (review m-4 of fix round 1a) — it never blocks again
      expect((await t.api.listZReports()).map((z) => z.hashOk)).toEqual([true, true, false, true]) // z4, z3, z2(tampered), z1

      t.clock.set('2026-09-21T02:00:00.000Z')
      await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
      const z5 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
      expect(z5.snapshot).toMatchObject({ zNo: 5, chainWarning: null })
    }
  })

  it('a previous Z with an inconsistent triple and a negative stored net recomputes to 0, not a permanent BAD_INPUT (review NF-2 · NF-7)', async () => {
    const t = await openReadyApi()
    const { z3 } = await closeThreeZs(t)
    t.raw.exec('DROP TRIGGER z_report_no_update')
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.sales.discountSatang', 999999, '$.sales.netSalesSatang', -100000) where shift_id = ?`).run(z3.shiftId)

    t.clock.set('2026-09-20T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
    const next = await closeInput(t, { countLines: [] })
    await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z3.shiftId}$`))

    const z4 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
    // the triple is inconsistent (discount > gross) and the "fallback" net is negative — neither is trusted, so
    // z3 contributes 0 and is flagged; z1 + z2's real ฿90 plus this shift's ฿50 still go through
    expect(z4.snapshot).toMatchObject({ zNo: 4, grandTotalSatang: 14_000, chainWarning: { brokenShiftId: z3.shiftId, recomputedGrandTotalSatang: 9_000, unreadableZs: [{ shiftId: z3.shiftId, zNo: 3 }] } })

    t.clock.set('2026-09-21T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    const z5 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
    expect(z5.snapshot).toMatchObject({ zNo: 5, chainWarning: null })
  })

  it('a previous Z with a huge but self-consistent gross never overflows the grand total into a permanent BAD_INPUT (review NF-2 · NF-7)', async () => {
    const t = await openReadyApi()
    const { z3 } = await closeThreeZs(t)
    t.raw.exec('DROP TRIGGER z_report_no_update')
    t.raw
      .prepare(
        `update z_report set snapshot_json = json_set(snapshot_json, '$.sales.grossSalesSatang', 9007199254740991, '$.sales.discountSatang', 0, '$.sales.voidedSatang', 0, '$.sales.netSalesSatang', 9007199254740991) where shift_id = ?`,
      )
      .run(z3.shiftId)

    t.clock.set('2026-09-20T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
    const next = await closeInput(t, { countLines: [] })
    await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z3.shiftId}$`))

    const z4 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
    // z3's own triple is self-consistent, but folding its huge net in would overflow Number.MAX_SAFE_INTEGER —
    // it is dropped and flagged instead, so the total stays a safe integer built only from what is trustworthy
    expect(z4.snapshot).toMatchObject({ zNo: 4, grandTotalSatang: 14_000, chainWarning: { brokenShiftId: z3.shiftId, recomputedGrandTotalSatang: 9_000, unreadableZs: [{ shiftId: z3.shiftId, zNo: 3 }] } })
    expect(Number.isSafeInteger(z4.snapshot!.grandTotalSatang)).toBe(true)

    t.clock.set('2026-09-21T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    const z5 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
    expect(z5.snapshot).toMatchObject({ zNo: 5, chainWarning: null })
  })

  it('two earlier Zs claiming zNo <= 0 do not block acknowledging forever (review R2-1)', async () => {
    const t = await openReadyApi()
    const { z1, z2, z3 } = await closeThreeZs(t)
    t.raw.exec('DROP TRIGGER z_report_no_update')
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.zNo', 0) where shift_id = ?`).run(z1.shiftId)
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.zNo', -3) where shift_id = ?`).run(z2.shiftId)
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.grandTotalSatang', 999) where shift_id = ?`).run(z3.shiftId) // breaks the last Z's own hash, so the chain path actually runs

    t.clock.set('2026-09-20T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
    const next = await closeInput(t, { countLines: [] })
    await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z3.shiftId}$`))

    // before the fix, buildZReport rejected any duplicateZNos/missingZNos entry below 1 — z1/z2's edited zNo (0, -3)
    // would have made every acknowledged retry fail with a permanent BAD_INPUT, exactly what D54 forbids
    const z4 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
    expect(z4.snapshot).toMatchObject({ zNo: 4, grandTotalSatang: 19_000, chainWarning: { brokenShiftId: z3.shiftId, recomputedGrandTotalSatang: 14_000 } })
    const w = z4.snapshot!.chainWarning!
    expect(w.duplicateZNos.every((n) => n >= 1)).toBe(true)
    expect(w.missingZNos.every((n) => n >= 1)).toBe(true)

    t.clock.set('2026-09-21T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    const z5 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
    expect(z5.snapshot).toMatchObject({ zNo: 5, chainWarning: null })
  })

  it('a middle Z claiming a huge zNo (2_000_000 or ~9e15) still closes fast, with a small chainWarning (review R2-2)', async () => {
    for (const hugeZNo of [2_000_000, 9_000_000_000_000_000]) {
      const t = await openReadyApi()
      const { z2, z3 } = await closeThreeZs(t)
      t.raw.exec('DROP TRIGGER z_report_no_update')
      t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.zNo', ?) where shift_id = ?`).run(hugeZNo, z2.shiftId)
      t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.grandTotalSatang', 999) where shift_id = ?`).run(z3.shiftId) // breaks the last Z's own hash, so the chain path actually runs

      t.clock.set('2026-09-20T02:00:00.000Z')
      await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
      await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
      const next = await closeInput(t, { countLines: [] })
      await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z3.shiftId}$`))

      const started = performance.now()
      const z4 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
      expect(performance.now() - started).toBeLessThan(2_000) // would hang / allocate megabytes if the scan ran 1..hugeZNo
      expect(z4.snapshot).toMatchObject({ zNo: 4, grandTotalSatang: 19_000 })
      const w = z4.snapshot!.chainWarning!
      expect(w.missingZNos.length).toBeLessThanOrEqual(50)
      expect(w.duplicateZNos.length).toBeLessThanOrEqual(50)
      expect(JSON.stringify(w).length).toBeLessThan(10_000) // the review's own probe found a 14.9 MB chainWarning here

      t.clock.set('2026-09-21T02:00:00.000Z')
      await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
      const z5 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
      expect(z5.snapshot).toMatchObject({ zNo: 5, chainWarning: null })
    }
  })

  it('a last Z with a forged (recomputed) hash but an invalid grand total still gives Z_CHAIN_BROKEN, not a permanent BAD_INPUT (review R2-3)', async () => {
    const t = await openReadyApi()
    const { z3 } = await closeThreeZs(t)
    t.raw.exec('DROP TRIGGER z_report_no_update')
    const row = await t.db.select().from(s.zReport).where(eq(s.zReport.shiftId, z3.shiftId)).get()
    const tampered = { ...(row!.snapshotJson as Record<string, unknown>), grandTotalSatang: -1 }
    t.raw.prepare(`update z_report set snapshot_json = ?, hash = ? where shift_id = ?`).run(JSON.stringify(tampered), zReportHash(tampered), z3.shiftId)

    t.clock.set('2026-09-20T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
    const next = await closeInput(t, { countLines: [] })
    await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z3.shiftId}$`))

    // before the fix, a matching (forged) hash plus zNo === row count alone was treated as "healthy", handing -1
    // straight to buildZReport as prev.grandTotalSatang, which rejected it — forever, since the same row is read every time
    const z4 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
    expect(z4.snapshot).toMatchObject({ zNo: 4, grandTotalSatang: 19_000, chainWarning: { brokenShiftId: z3.shiftId, recomputedGrandTotalSatang: 14_000 } })

    t.clock.set('2026-09-21T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    const z5 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
    expect(z5.snapshot).toMatchObject({ zNo: 5, chainWarning: null })
  })

  it('deleting the last Z row entirely still gives Z_CHAIN_BROKEN, names the missing shift, and is clean afterwards (review R2-4)', async () => {
    const t = await openReadyApi()
    const { z3 } = await closeThreeZs(t)
    t.raw.exec('DROP TRIGGER z_report_no_delete')
    t.raw.prepare(`delete from z_report where shift_id = ?`).run(z3.shiftId)

    t.clock.set('2026-09-20T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
    const next = await closeInput(t, { countLines: [] })
    const before = counts(t)
    await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z3.shiftId}$`))
    expect(counts(t)).toEqual(before)

    const z4 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
    // z3's row is gone entirely — its ฿50 cannot be recomputed, only named; z1 + z2's real ฿90 plus this shift's ฿50 still go through
    expect(z4.snapshot).toMatchObject({
      zNo: 3, // z1 and z2 remain (row count 2) + 1 — z3's slot is reused, per Q3b-16 (ก)
      grandTotalSatang: 4_000 + 5_000 + 5_000,
      chainWarning: { brokenShiftId: z3.shiftId, recomputedGrandTotalSatang: 9_000, deletedShiftIds: [z3.shiftId], deletedShiftIdsTruncated: false },
    })

    // the next close finds nothing closed more recently than z4's own shift — clean, no re-ask, even though z3's
    // shift permanently has no Z row of its own (review R2-4: the scan is bounded to "since the last known-good Z")
    t.clock.set('2026-09-21T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    const z5 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
    expect(z5.snapshot).toMatchObject({ zNo: 4, chainWarning: null })
  })

  it("a middle Z row deleted (z2 of three) is caught by the last Z's own zNo vs the row count, and chains from that trustworthy last Z (review I-1; Q3b-18 · D55)", async () => {
    const t = await openReadyApi()
    const { z2, z3 } = await closeThreeZs(t)
    t.raw.exec('DROP TRIGGER z_report_no_delete')
    t.raw.prepare(`delete from z_report where shift_id = ?`).run(z2.shiftId) // z1 and z3 (hash-valid, untouched) remain

    t.clock.set('2026-09-20T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
    const next = await closeInput(t, { countLines: [] })
    const before = counts(t)
    // z3's own hash and grand total are fine, but its stored zNo (3) no longer equals the surviving row count (2) —
    // that mismatch is the *only* thing that catches a deleted middle row (review I-1: deletedShiftIds only covers
    // shifts closed after the last Z, never a gap in the middle of the chain).
    await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z3.shiftId}$`))
    expect(counts(t)).toEqual(before)

    const z4 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
    // Q3b-18 · D55: z3 (the last Z) is itself trustworthy, so the new Z chains from z3's OWN zNo/grand — its
    // stored ฿140 already includes z2's true ฿50, frozen truthfully before z2 was ever deleted. Re-folding just
    // the survivors (z1 + z3) instead would silently give ฿140, dropping z2's ฿50 from the total that feeds VAT
    // (D8) — the bug this decision fixes.
    expect(z4.snapshot).toMatchObject({
      zNo: 4, // z3.zNo (3) + 1 — never row count (2 survivors) + 1, which would duplicate zNo 3
      grandTotalSatang: 19_000, // z3's own stored ฿140 (already including z1 + z2) + this shift's ฿50
      chainWarning: { brokenShiftId: z3.shiftId, storedGrandTotalSatang: 14_000, recomputedGrandTotalSatang: 14_000 },
    })
    // z2's slot (zNo 2) is the only surviving trace that a row was ever deleted from the middle of the chain
    expect(z4.snapshot!.chainWarning!.missingZNos).toEqual([2])
    expect(z4.snapshot!.chainWarning!.unreadableZs).toEqual([]) // z1 and z3 are each individually fine on their own

    t.clock.set('2026-09-21T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    const z5 = await t.api.closeShift(await closeInput(t, { countLines: [] }))
    expect(z5.snapshot).toMatchObject({ zNo: 5, chainWarning: null })
  })

  it('after acknowledging a deleted middle Z, later closes never re-ask — the acknowledged gap (zNoGap) is carried forward (review R4-1 · D55, 2026-09-21)', async () => {
    const t = await openReadyApi()
    const { z4 } = await ackMiddleDeletion(t)
    expect(z4.snapshot).toMatchObject({ zNo: 4, grandTotalSatang: 19_000, chainWarning: { missingZNos: [2], zNoGap: 1 } }) // zNo 4 − (3 rows incl. itself)
    expect(ackCount(t)).toBe(1)
    // before the fix, every second close after this asked for the PIN again (Z6, Z8, …), forever
    let grand = 19_000
    for (const [i, date] of ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'].entries()) {
      const z = await t.api.closeShift(await nextShift(t, date))
      grand += 5_000
      expect(z.snapshot).toMatchObject({ zNo: 5 + i, grandTotalSatang: grand, chainWarning: null })
    }
    expect(ackCount(t)).toBe(1)
  })

  it('a row deleted while the acknowledged Z is the last row is caught at the very next close, not silently (review R4-2)', async () => {
    const t = await openReadyApi()
    const { z1, z4 } = await ackMiddleDeletion(t)
    t.raw.prepare(`delete from z_report where shift_id = ?`).run(z1.shiftId) // an older row, so deletedShiftIds cannot see it
    const next = await nextShift(t, '2026-09-21')
    await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z4.shiftId}$`))
    const z5 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
    // z4 is trustworthy, so D55 chains from its own ฿190 (which already includes z1 and z2) — no money lost
    expect(z5.snapshot).toMatchObject({ zNo: 5, grandTotalSatang: 24_000, chainWarning: { brokenShiftId: z4.shiftId, missingZNos: [1, 2], zNoGap: 2 } })
    for (const [i, date] of ['2026-09-22', '2026-09-23', '2026-09-24'].entries()) {
      const z = await t.api.closeShift(await nextShift(t, date))
      expect(z.snapshot).toMatchObject({ zNo: 6 + i, chainWarning: null })
    }
    expect(ackCount(t)).toBe(2)
  })

  it('deleting the acknowledged Z itself is caught — as the last row, and later as a middle row (review R4-2, probes C and D)', async () => {
    // probe D: the acknowledged Z4 is the last row when it is deleted
    const d = await openReadyApi()
    const dz = await ackMiddleDeletion(d)
    d.raw.prepare(`delete from z_report where shift_id = ?`).run(dz.z4.shiftId)
    const dNext = await nextShift(d, '2026-09-21')
    await expect(d.api.closeShift(dNext)).rejects.toThrow(/^Z_CHAIN_BROKEN: /)
    const dz5 = await d.api.closeShift({ ...dNext, acknowledgeZChainBroken: true })
    expect(dz5.snapshot).toMatchObject({ zNo: 4, grandTotalSatang: 19_000, chainWarning: { deletedShiftIds: [dz.z4.shiftId], zNoGap: 1 } })
    expect((await d.api.closeShift(await nextShift(d, '2026-09-22'))).snapshot).toMatchObject({ zNo: 5, chainWarning: null })

    // probe C: a clean Z5 is written on top first, so the acknowledged Z4 is a middle row when it is deleted —
    // deletedShiftIds cannot see it (Z5's shift is newer); only the lost zNoGap record does
    const c = await openReadyApi()
    const cz = await ackMiddleDeletion(c)
    const cz5 = await c.api.closeShift(await nextShift(c, '2026-09-21'))
    expect(cz5.snapshot).toMatchObject({ zNo: 5, chainWarning: null })
    c.raw.prepare(`delete from z_report where shift_id = ?`).run(cz.z4.shiftId)
    const cNext = await nextShift(c, '2026-09-22')
    await expect(c.api.closeShift(cNext)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${cz5.shiftId}$`))
    const cz6 = await c.api.closeShift({ ...cNext, acknowledgeZChainBroken: true })
    expect(cz6.snapshot).toMatchObject({ zNo: 6, grandTotalSatang: 29_000, chainWarning: { missingZNos: [2], zNoGap: 2 } })
    expect((await c.api.closeShift(await nextShift(c, '2026-09-23'))).snapshot).toMatchObject({ zNo: 7, chainWarning: null })
  })

  it('a recorded zNoGap is only trusted from a Z whose hash verifies — editing it to cover a later deletion is still caught (review R4-2)', async () => {
    const t = await openReadyApi()
    const { z1, z4 } = await ackMiddleDeletion(t)
    const z5 = await t.api.closeShift(await nextShift(t, '2026-09-21'))
    t.raw.exec('DROP TRIGGER z_report_no_update')
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.chainWarning.zNoGap', 2) where shift_id = ?`).run(z4.shiftId) // no hash recompute
    t.raw.prepare(`delete from z_report where shift_id = ?`).run(z1.shiftId) // gap now really is 2
    await expect(t.api.closeShift(await nextShift(t, '2026-09-22'))).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z5.shiftId}$`))
  })

  it('a hash-valid last Z claiming fewer Zs than there are rows goes the lenient way, never a negative zNoGap and a permanent BAD_INPUT (2026-09-21)', async () => {
    const t = await openReadyApi()
    const { z3 } = await closeThreeZs(t)
    t.raw.exec('DROP TRIGGER z_report_no_update')
    const row = await t.db.select().from(s.zReport).where(eq(s.zReport.shiftId, z3.shiftId)).get()
    const tampered = { ...(row!.snapshotJson as Record<string, unknown>), zNo: 2 } // forged, with a recomputed hash
    t.raw.prepare(`update z_report set snapshot_json = ?, hash = ? where shift_id = ?`).run(JSON.stringify(tampered), zReportHash(tampered), z3.shiftId)

    const next = await nextShift(t, '2026-09-20')
    await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z3.shiftId}$`))
    const z4 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
    // lenient: renumbered from the row count, every surviving net summed (฿140), recorded gap 0
    expect(z4.snapshot).toMatchObject({ zNo: 4, grandTotalSatang: 19_000, chainWarning: { brokenShiftId: z3.shiftId, recomputedGrandTotalSatang: 14_000, zNoGap: 0 } })
    for (const [i, date] of ['2026-09-21', '2026-09-22', '2026-09-23'].entries()) {
      expect((await t.api.closeShift(await nextShift(t, date))).snapshot).toMatchObject({ zNo: 5 + i, chainWarning: null })
    }
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

  it('an over-drawer paid-out that pushes expected cash negative still closes, with the variance it causes (review m-4 · Q3b-16 · D54)', async () => {
    const t = await openReadyApi() // float ฿500
    // a paid-out larger than the drawer (Q3b-14's over-drawer confirm is a client-side warning only — recordCashMovement
    // itself never blocks, Q3b-16): ฿500 float − ฿550 paid out → expected −฿50
    await t.api.recordCashMovement({ actorUserId: t.owner.id, kind: 'PAID_OUT', amountSatang: 55_000, reason: 'เบิกเกินลิ้นชัก' })
    const report = await t.api.shiftReport()
    expect(report.expectedCashSatang).toBe(-5_000)

    const before = counts(t)
    // ฿0 counted vs −฿50 expected → +฿50 variance, above the ฿20 alert threshold: needs a reason, same as any other close
    await expect(t.api.closeShift(await closeInput(t, { countLines: [] }))).rejects.toThrow(/^VARIANCE_REASON_REQUIRED: /)
    expect(counts(t)).toEqual(before)

    const z = await t.api.closeShift(await closeInput(t, { countLines: [], varianceReason: 'เบิกเกินลิ้นชัก' }))
    expect(z.hashOk).toBe(true)
    expect(z.hash).toBe(zReportHash(z.snapshot)) // the negative figure is still hash-frozen correctly, not merely accepted
    expect(z.snapshot).toMatchObject({
      cash: { openingFloatSatang: 50_000, paidOutSatang: 55_000 },
      countedCashSatang: 0,
      expectedCashSatang: -5_000,
      cashVarianceSatang: 5_000, // 0 − (−5,000)
      varianceReason: 'เบิกเกินลิ้นชัก',
      chainWarning: null,
    })
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
