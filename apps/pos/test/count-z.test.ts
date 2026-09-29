import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { CashCountRowData, ShiftCloseRowData, type CentralOrder } from '@dayo/contracts'
import { posErrorCode } from '../src/api/errors'
import { pushOnce } from '../src/sync/push'
import { LOCAL_DEVICE_KEY } from '../src/api/bootstrap'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'
import { countAndClose } from './helpers/shift'

const owner2 = { approverUserId: STAFF.DCm, approverPin: '2222' }
const settle = { varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: false }
const lines = (baht: number) => [{ denominationSatang: 100, count: baht }] // ฿1 coins — any whole amount
const bot = (no: string, total: number, at: string): CentralOrder => ({ order_no: no, sale_date: at.slice(0, 10), status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'line', payment: 'cash', totals: { items_subtotal: total, items_discount: 0, bill_discount: 0, total }, amount_mismatch: false, updated_at: at, sold_at: at })

async function centralShift(botTotal = 70) {
  const t = await openConnectedApi({ block3: true })                  // 10:00 Bangkok, float ฿500
  const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
  await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 }) // ฿45 cash
  t.mock.seedCentralOrders([bot('L260925-901', botTotal, '2026-09-25T04:00:00+00:00')])
  t.clock.advanceMs(2 * 3_600_000)                                    // 12:00 Bangkok
  t.mock.setNow(t.clock.now())                                        // dayo's clock moves too (else every row is CLOCK_AHEAD)
  return { t, ctx }
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  try { await p; expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe(code) }
}

describe('count and Z (D101 · spec 04 §6.8 · §4.10)', () => {
  it('"นับเสร็จ" freezes the shift: no sale, no cash movement, no second press (D101 step 1)', async () => {
    const { t } = await centralShift()
    const { countedAt } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect(countedAt).toBe(t.clock.now())
    for (const f of [() => sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }), () => t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_IN', amountSatang: 100, reason: 'x' }), () => t.api.finishCount({ actorUserId: STAFF.TungAo })]) {
      try { await f(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('NO_OPEN_SHIFT') }
    }
    try { await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 0 }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('COUNT_PENDING') } // R2
  })
  it('online: E4 bot cash is in the expected cash; count and Z are written together (D101 step 2)', async () => {
    const { t, ctx } = await centralShift()
    const { shiftId, countedAt } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect(await t.api.fetchBotCash(shiftId)).toMatchObject({ after: '2026-09-24T17:00:00.000Z', until: countedAt, cashTotalSatang: 7_000 })
    const sum = await t.api.countSummary(shiftId)
    expect(sum).toMatchObject({ includesBotCash: true, expectedCashSatang: 61_500, cash: { botCashSatang: 7_000 } })
    const r = await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(615), shownFingerprint: sum.fingerprint, z: settle })
    expect(r.z?.snapshot).toMatchObject({ zNo: 1, countedAt, cashVarianceSatang: 0, botWindow: { until: countedAt }, closedBy: STAFF.DCm, countedBy: STAFF.TungAo })
    const rows = await t.db.select().from(s.outbox).where(inArray(s.outbox.tableName, ['cash_count', 'shift_close'])).all()
    expect(rows.map((x) => [x.tableName, x.parentKey])).toEqual([['cash_count', `shift_open:${shiftId}`], ['shift_close', `cash_count:${r.countId}`]])
    expect(CashCountRowData.parse(rows[0]!.rowJson)).toMatchObject({ counted: 615, counted_at: countedAt, counted_by: STAFF.TungAo })
    const close = ShiftCloseRowData.parse(rows[1]!.rowJson)
    expect(close.z_report).toMatchObject({ z_no: 1, prev_hash: null, hash: r.z!.hash, variance_alert: 20, counted: 615, cash: { opening_float: 500, pos_cash_sales: 45, bot_cash: 70, drawer_expenses: 0 }, bot_bills: [{ order_no: 'L260925-901', version: 1, total: 70 }] })
    expect(close.z_report.pos_bills).toHaveLength(1)
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, shiftId)).get())?.status).toBe('closed')
    await pushOnce(ctx)
    expect(await t.db.select().from(s.outbox).where(inArray(s.outbox.status, ['pending', 'dead'])).all()).toEqual([])
  })
  it('offline: the count is saved without bot cash, the next shift opens, the Z comes when online (D101 step 3 · D68)', async () => {
    const { t, ctx } = await centralShift()
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    t.mock.setMode('offline')                                            // a real network failure (mock.fetch rejects)
    try { await t.api.fetchBotCash(shiftId); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('OFFLINE') }
    const sum = await t.api.countSummary(shiftId)
    expect(sum).toMatchObject({ includesBotCash: false, expectedCashSatang: 54_500 })
    await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(615), shownFingerprint: sum.fingerprint, z: null }) // no reason asked yet
    expect((await t.db.select().from(s.cashCount).get())).toMatchObject({ includesBotCash: false, expectedSatang: 54_500, varianceSatang: 7_000, reason: null })
    expect((await t.api.bootstrap()).zWaiting).toEqual([expect.objectContaining({ shiftId, syncMode: 'central' })])
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    t.mock.setMode('normal')
    await t.api.fetchBotCash(shiftId)
    const s2 = await t.api.countSummary(shiftId)
    const z = await t.api.issueZ({ shiftId, ...owner2, shownFingerprint: s2.fingerprint, ...settle })
    expect(z.snapshot).toMatchObject({ cash: { botCashSatang: 7_000 }, cashVarianceSatang: 0 })
    expect((await t.api.bootstrap()).zWaiting).toEqual([])
    await pushOnce(ctx); await pushOnce(ctx)
    expect(await t.db.select().from(s.outbox).where(inArray(s.outbox.status, ['pending', 'dead'])).all()).toEqual([]) // both shifts' rows accepted, no CONFLICT (§9)
  })
  it('short exactly ฿20.00 needs a reason; ฿19.99 does not (D102)', async () => {
    for (const [botTotal, want] of [[70, 'VARIANCE_REASON_REQUIRED'], [69.99, null]] as const) {
      const { t } = await centralShift(botTotal)
      const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
      await t.api.fetchBotCash(shiftId)
      const sum = await t.api.countSummary(shiftId)
      const call = t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(595), shownFingerprint: sum.fingerprint, z: settle })
      if (want === null) await call
      else { try { await call; expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe(want) } ; expect(await t.db.select().from(s.cashCount).all()).toEqual([]) } // nothing written
    }
  })
  it('E4 fetched, then the app reloads in "counting" and the network drops: confirm uses the stored bot cash — no SHIFT_CHANGED, no offline label (review item 1)', async () => {
    const { t } = await centralShift()
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.fetchBotCash(shiftId)
    t.mock.setMode('offline')
    expect((await t.api.bootstrap()).countingShift).toMatchObject({ shiftId })   // what a reload sees → the screen goes back to the review step
    const sum = await t.api.countSummary(shiftId)
    expect(sum).toMatchObject({ includesBotCash: true, expectedCashSatang: 61_500 }) // the screen shows the online path: bot line, no "ยังไม่รวมบิลเงินสดจากบอท"
    const r = await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(615), shownFingerprint: sum.fingerprint, z: settle })
    expect(r.z?.snapshot).toMatchObject({ cash: { botCashSatang: 7_000 }, cashVarianceSatang: 0 })
    expect(await t.db.select().from(s.cashCount).get()).toMatchObject({ includesBotCash: true })
  })
  it('fetchBotCash maps failures: network = OFFLINE · 401 = DAYO_BAD_KEY · 5xx = DAYO_UNREACHABLE · > 500 bot bills = Z_TOO_LARGE (review item 9)', async () => {
    for (const [mode, code] of [['offline', 'OFFLINE'], ['unauthorized', 'DAYO_BAD_KEY'], ['server_down', 'DAYO_UNREACHABLE']] as const) {
      const { t } = await centralShift()
      const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
      t.mock.setMode(mode)
      try { await t.api.fetchBotCash(shiftId); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe(code) }
    }
    const { t } = await centralShift()
    t.mock.seedCentralOrders(Array.from({ length: 501 }, (_, i) => bot(`L260925-${String(100 + i)}`, 1, '2026-09-25T04:00:00+00:00')))
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    try { await t.api.fetchBotCash(shiftId); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('Z_TOO_LARGE') }
  })
  it('a non-default threshold (฿50) is the one frozen in the Z and sent as z_report.variance_alert (D102 · review item 13)', async () => {
    const { t } = await centralShift()
    await t.db.insert(s.setting).values({ key: 'cash.variance_alert_satang', valueJson: 5_000, effectiveFrom: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', version: 1 })
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.fetchBotCash(shiftId)
    const sum = await t.api.countSummary(shiftId)
    expect(sum.varianceAlertSatang).toBe(5_000)
    const r = await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(585), shownFingerprint: sum.fingerprint, z: settle }) // short ฿30 < ฿50: no reason
    expect(r.z?.snapshot).toMatchObject({ varianceAlertSatang: 5_000, cashVarianceSatang: -3_000 })
    const close = ShiftCloseRowData.parse((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'shift_close')).get())!.rowJson)
    expect(close.z_report.variance_alert).toBe(50)
  })
  it('the Z of a central shift needs the bot cash first (BOT_CASH_REQUIRED)', async () => {
    const { t } = await centralShift()
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    const sum = await t.api.countSummary(shiftId)
    try { await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(615), shownFingerprint: sum.fingerprint, z: settle }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BOT_CASH_REQUIRED') }
  })
  it('a bot bill that appears after the screen was shown → SHIFT_CHANGED (ruling R8)', async () => {
    const { t } = await centralShift()
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.fetchBotCash(shiftId)
    const shown = await t.api.countSummary(shiftId)
    t.mock.seedCentralOrders([bot('L260925-902', 35, '2026-09-25T04:30:00+00:00')])
    await t.api.fetchBotCash(shiftId)
    try { await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(650), shownFingerprint: shown.fingerprint, z: settle }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('SHIFT_CHANGED') }
  })
  it('Zs are issued in count order (ruling R7); the second Z chains to the first (R-m2 · E4 after = previous count)', async () => {
    const { t } = await centralShift()
    const a = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    let sum = await t.api.countSummary(a.shiftId)
    await t.api.confirmCount({ shiftId: a.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(545), shownFingerprint: sum.fingerprint, z: null })
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    t.clock.advanceMs(3_600_000)
    const b = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    sum = await t.api.countSummary(b.shiftId)
    expect(sum.zBlockedBy).toBe(a.shiftId) // R7: the screen knows a Z of b would be refused now
    expect((await t.api.countSummary(a.shiftId)).zBlockedBy).toBeNull()
    await t.api.confirmCount({ shiftId: b.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: sum.fingerprint, z: null })
    await t.api.fetchBotCash(b.shiftId)
    const sb = await t.api.countSummary(b.shiftId)
    try { await t.api.issueZ({ shiftId: b.shiftId, ...owner2, shownFingerprint: sb.fingerprint, ...settle }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('Z_NOT_READY') }
    await t.api.fetchBotCash(a.shiftId)
    const za = await t.api.issueZ({ shiftId: a.shiftId, ...owner2, shownFingerprint: (await t.api.countSummary(a.shiftId)).fingerprint, ...settle, varianceReason: 'บิลบอทรวมแล้ว' })
    expect(await t.api.fetchBotCash(b.shiftId)).toMatchObject({ after: a.countedAt, until: b.countedAt })
    expect((await t.api.countSummary(b.shiftId)).zBlockedBy).toBeNull()
    const zb = await t.api.issueZ({ shiftId: b.shiftId, ...owner2, shownFingerprint: (await t.api.countSummary(b.shiftId)).fingerprint, ...settle })
    const close = ShiftCloseRowData.parse((await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `shift_close:${b.shiftId}`)).get())!.rowJson)
    expect(close.z_report).toMatchObject({ z_no: 2, prev_hash: za.hash, bot_window: { after: a.countedAt } })
    expect(zb.snapshot?.zNo).toBe(2)
  })
  it('a local-only shift: no E4, the Z right after the count, every row local_only (ruling R6)', async () => {
    const t = await openConnectedApi({ block3: false })
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    const sum = await t.api.countSummary(shiftId)
    const r = await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: sum.fingerprint, z: settle })
    expect(r.z?.snapshot).toMatchObject({ botWindow: null, botBills: [] })
    expect((await t.db.select().from(s.outbox).where(inArray(s.outbox.tableName, ['cash_count', 'z_report', 'shift_close'])).all()).map((x) => [x.tableName, x.status])).toEqual([['cash_count', 'local_only'], ['z_report', 'local_only']])
  })
})

/** E4 answered by hand (the mock only ever answers well): `body` replaces the data of the next shift-cash answers. */
function fakeE4(t: Awaited<ReturnType<typeof centralShift>>['t'], data: (after: string, until: string) => unknown): void {
  const real = t.deps.fetch
  t.deps.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (!url.pathname.endsWith('/pos/shift-cash')) return real(input, init)
    const body = { ok: true, data: data(url.searchParams.get('after')!, url.searchParams.get('until')!) }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}
const e4Bill = (no: string, total: number, soldAt: string | null) => ({ order_no: no, version: 1, source: 'line', sold_at: soldAt, total, created_by_name: null })

describe('E4 answers are checked before they count (carried: never trust cash_total)', () => {
  it('cash_total ≠ Σ bills, a bill number dayo would refuse, a duplicate, a sold_at outside (after, until] → DAYO_BAD_RESPONSE, nothing stored', async () => {
    const cases: [string, (after: string, until: string) => unknown][] = [
      ['total', () => ({ bills: [e4Bill('L260925-901', 70, '2026-09-25T04:00:00.000+00:00')], cash_total: 700 })],
      ['order_no', () => ({ bills: [e4Bill('X-1', 70, '2026-09-25T04:00:00.000+00:00')], cash_total: 70 })],
      ['duplicate', () => ({ bills: [e4Bill('L260925-901', 35, '2026-09-25T04:00:00.000+00:00'), e4Bill('L260925-901', 35, '2026-09-25T04:00:00.000+00:00')], cash_total: 70 })],
      ['after', (after) => ({ bills: [e4Bill('L260925-901', 70, new Date(Date.parse(after) - 1).toISOString())], cash_total: 70 })], // before after
      ['until', (_a, until) => ({ bills: [e4Bill('L260925-901', 70, new Date(Date.parse(until) + 1).toISOString())], cash_total: 70 })],
      ['decimals', () => ({ bills: [e4Bill('L260925-901', 70.001, '2026-09-25T04:00:00.000+00:00')], cash_total: 70.001 })],
      ['version', () => ({ bills: [{ ...e4Bill('L260925-901', 70, '2026-09-25T04:00:00.000+00:00'), version: 0 }], cash_total: 70 })],
    ]
    for (const [, data] of cases) {
      const { t } = await centralShift()
      const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
      fakeE4(t, data)
      await expectCode(t.api.fetchBotCash(shiftId), 'DAYO_BAD_RESPONSE')
      expect(await t.api.countSummary(shiftId)).toMatchObject({ includesBotCash: false, bot: null }) // the screen goes the offline way
    }
  })
  it('a bill sold exactly at until counts, and one printed exactly at after (dayo prints sold_at in ms, filters created_at in µs — 0067:65); a web bill dayo gave no sold_at (a back-dated entry) counts too', async () => {
    const { t } = await centralShift()
    const { shiftId, countedAt } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    fakeE4(t, (after, until) => ({ bills: [e4Bill('L260925-901', 70, until.replace('Z', '+00:00')), e4Bill('L260924-900', 5, after.replace('Z', '+00:00')), e4Bill('L260924-777', 30.5, null)], cash_total: 105.5 }))
    const dto = await t.api.fetchBotCash(shiftId)
    expect(dto).toMatchObject({ until: countedAt, cashTotalSatang: 10_550, bills: [{ orderNo: 'L260925-901', totalSatang: 7_000 }, { orderNo: 'L260924-900', totalSatang: 500 }, { orderNo: 'L260924-777', soldAt: null, totalSatang: 3_050 }] })
  })
  it("E4 of another device's shift (a restored file) is refused — SHIFT_NOT_COUNTING, no request", async () => {
    const { t } = await centralShift()
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    const at = t.clock.now()
    await t.db.insert(s.device).values({ id: 'other-device', name: 'อีกเครื่อง', receiptPrefix: 'B', isSellingDevice: true, registeredAt: at, version: 1, updatedAt: at })
    await t.db.update(s.syncState).set({ value: 'other-device' }).where(eq(s.syncState.key, LOCAL_DEVICE_KEY))
    const before = t.mock.requests().length
    await expectCode(t.api.fetchBotCash(shiftId), 'SHIFT_NOT_COUNTING')
    expect(t.mock.requests()).toHaveLength(before)
  })
  it('a stored preview that is unreadable or for another window is ignored (never trusted over a fresh E4)', async () => {
    const { t } = await centralShift()
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.fetchBotCash(shiftId)
    const key = `z.bot_cash.${shiftId}`
    const raw = (await t.db.select().from(s.syncState).where(eq(s.syncState.key, key)).get())!.value
    await t.db.update(s.syncState).set({ value: JSON.stringify({ ...JSON.parse(raw), cashTotalSatang: 1 }) }).where(eq(s.syncState.key, key))
    expect(await t.api.countSummary(shiftId)).toMatchObject({ includesBotCash: false })
    await t.db.update(s.syncState).set({ value: JSON.stringify({ ...JSON.parse(raw), after: '2026-09-25T00:00:00.000Z' }) }).where(eq(s.syncState.key, key))
    expect(await t.api.countSummary(shiftId)).toMatchObject({ includesBotCash: false })
    await t.db.update(s.syncState).set({ value: '{not json' }).where(eq(s.syncState.key, key))
    expect(await t.api.countSummary(shiftId)).toMatchObject({ includesBotCash: false })
  })
})

describe('count and Z — states, PINs, resend (D101 · R2 · R7)', () => {
  it('counted_at is set once on the shift and on the count; the shift goes open → counting → counted → closed', async () => {
    const { t } = await centralShift()
    const shiftOf = async (id: string) => t.db.select().from(s.shift).where(eq(s.shift.id, id)).get()
    const { shiftId, countedAt } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect(await shiftOf(shiftId)).toMatchObject({ status: 'counting', countedAt })
    t.clock.advanceMs(600_000) // the owner takes 10 minutes to count: counted_at stays the "นับเสร็จ" instant
    const sum = await t.api.countSummary(shiftId)
    const r = await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(545), shownFingerprint: sum.fingerprint, z: null })
    expect(await shiftOf(shiftId)).toMatchObject({ status: 'counted', countedAt })
    expect(await t.db.select().from(s.cashCount).where(eq(s.cashCount.id, r.countId)).get()).toMatchObject({ countedAt, countedSatang: 54_500 })
    await expectCode(t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(545), shownFingerprint: sum.fingerprint, z: null }), 'SHIFT_NOT_COUNTING') // no second count
    await t.api.fetchBotCash(shiftId)
    await t.api.issueZ({ shiftId, ...owner2, shownFingerprint: (await t.api.countSummary(shiftId)).fingerprint, ...settle, varianceReason: 'บอท' })
    expect(await shiftOf(shiftId)).toMatchObject({ status: 'closed', countedAt, closedBy: STAFF.DCm })
    await expectCode(t.api.issueZ({ shiftId, ...owner2, shownFingerprint: 'x', ...settle }), 'Z_NOT_READY') // one Z per shift
  })
  it('confirmCount and issueZ each need an owner PIN (D101: twice when offline) — a wrong PIN or a staff approver writes nothing', async () => {
    const { t } = await centralShift()
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    const sum = await t.api.countSummary(shiftId)
    const input = { shiftId, actorUserId: STAFF.TungAo, countLines: lines(545), shownFingerprint: sum.fingerprint, z: null }
    await expectCode(t.api.confirmCount({ ...input, approverUserId: STAFF.DCm, approverPin: '9999' }), 'PIN_WRONG')
    expect(await t.db.select().from(s.cashCount).all()).toEqual([])
    await t.api.confirmCount({ ...input, ...owner2 })
    await t.api.fetchBotCash(shiftId)
    const fp = (await t.api.countSummary(shiftId)).fingerprint
    await expectCode(t.api.issueZ({ shiftId, approverUserId: STAFF.DCm, approverPin: '9999', shownFingerprint: fp, ...settle, varianceReason: 'บอท' }), 'PIN_WRONG')
    // a manager/staff is never an approver
    await t.db.update(s.user).set({ role: 'manager' }).where(eq(s.user.id, STAFF.DCm))
    await expectCode(t.api.issueZ({ shiftId, ...owner2, shownFingerprint: fp, ...settle, varianceReason: 'บอท' }), 'NOT_OWNER')
    expect(await t.db.select().from(s.zReport).all()).toEqual([])
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'shift_close')).all()).toEqual([])
  })
  it('a refused Z rolls the count back with it (one transaction): SHIFT_CHANGED, VARIANCE_REASON_REQUIRED leave the shift counting', async () => {
    const { t } = await centralShift()
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.fetchBotCash(shiftId)
    const sum = await t.api.countSummary(shiftId)
    await expectCode(t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: sum.fingerprint, z: settle }), 'VARIANCE_REASON_REQUIRED')
    await expectCode(t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(615), shownFingerprint: 'stale', z: settle }), 'SHIFT_CHANGED')
    expect(await t.db.select().from(s.cashCount).all()).toEqual([])
    expect(await t.db.select().from(s.outbox).where(inArray(s.outbox.tableName, ['cash_count', 'shift_close'])).all()).toEqual([])
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, shiftId)).get())?.status).toBe('counting')
    expect((await t.api.bootstrap()).countingShift).toMatchObject({ shiftId })
    const r = await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: sum.fingerprint, z: { ...settle, varianceReason: 'ทอนผิด' } })
    expect(r.z?.snapshot).toMatchObject({ cashVarianceSatang: -11_500, varianceReason: 'ทอนผิด' })
  })
  it('the Z sends every bill of the shift (voided and QR too) and every cash movement; the counted/counted_at of the Z are the saved count', async () => {
    const t = await openConnectedApi({ block3: true })
    const cashVoided = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.clock.advanceMs(60_000)
    await t.api.cancelSale({ orderId: cashVoided.orderId, actorUserId: STAFF.TungAo, ...owner2, reason: 'กดผิด', made: false, refundReference: null })
    const out = await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'น้ำแข็ง' })
    t.clock.advanceMs(60_000)
    const r = await countAndClose(t, lines(480), owner2)
    const close = ShiftCloseRowData.parse((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'shift_close')).get())!.rowJson)
    const count = CashCountRowData.parse((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'cash_count')).get())!.rowJson)
    expect(close.z_report.pos_bills.map((b) => [b.payment, b.total, b.voided_at !== null])).toEqual([['cash', 45, true], ['qr', 45, false]])
    const refund = await t.db.select().from(s.cashMovement).where(eq(s.cashMovement.kind, 'VOID_REFUND')).get()
    expect([...close.z_report.movement_ids].sort()).toEqual([refund!.id, out.id].sort())
    expect(close.z_report.counted).toBe(count.counted)
    expect(close.z_report.bot_window.until).toBe(count.counted_at)
    expect(close.z_report.cash).toMatchObject({ pos_cash_sales: 45, void_refunds: 45, paid_out: 20, bot_cash: 0 })
    expect(r.z?.snapshot?.cashVarianceSatang).toBe(0)
  })
  it('resend: the same rows sent again get the same answers (duplicate) — dayo keeps one count and one Z', async () => {
    const { t, ctx } = await centralShift()
    await countAndClose(t, lines(615), owner2)
    await pushOnce(ctx)
    expect(await t.db.select().from(s.outbox).where(inArray(s.outbox.status, ['pending', 'dead'])).all()).toEqual([])
    // the tablet lost its "sent" marks (a crash between the answer and the write): every shift row goes again
    await t.db.update(s.outbox).set({ status: 'pending', sentAt: null }).where(inArray(s.outbox.tableName, ['shift_open', 'cash_count', 'shift_close']))
    await pushOnce(ctx)
    expect(await t.db.select().from(s.outbox).where(inArray(s.outbox.status, ['pending', 'dead'])).all()).toEqual([])
    expect(t.mock.counts()).toHaveLength(1)
    expect(t.mock.zReports()).toHaveLength(1)
    expect(t.mock.shifts()).toHaveLength(1)
  })
  it('the device clock steps back after "นับเสร็จ": the count and the Z are stamped at counted_at, never before it (dayo 0066)', async () => {
    const { t, ctx } = await centralShift()
    const { shiftId, countedAt } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.fetchBotCash(shiftId)
    t.clock.set('2026-09-25T04:30:00.000Z') // 30 minutes before counted_at
    const sum = await t.api.countSummary(shiftId)
    const r = await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(615), shownFingerprint: sum.fingerprint, z: settle })
    expect(r.z?.snapshot).toMatchObject({ countedAt, closedAt: countedAt })
    const rows = await t.db.select().from(s.outbox).where(inArray(s.outbox.tableName, ['cash_count', 'shift_close'])).all()
    expect(rows.every((x) => x.createdAt === countedAt)).toBe(true)
    t.clock.set(countedAt)
    await pushOnce(ctx)
    expect(await t.db.select().from(s.outbox).where(inArray(s.outbox.status, ['pending', 'dead'])).all()).toEqual([])
  })
  it("the clock steps back after a Z: the next shift opens and counts after it, so its E4 window starts at the first Z's until and no bot bill is counted twice (fix round 1 · security M1)", async () => {
    const { t, ctx } = await centralShift() // bot bill L260925-901 at 04:00Z · clock 05:00Z
    const a = await countAndClose(t, lines(615), owner2)
    const aUntil = a.z!.snapshot!.botWindow!.until
    expect(a.z!.snapshot!.botBills!.map((b) => b.orderNo)).toEqual(['L260925-901'])
    t.clock.set('2026-09-25T04:30:00.000Z') // 30 minutes back: after the bot bill, before a's count — without the fix b's window would be (00:00, 04:30] and hold it again
    const b = await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    expect(b.openedAt).toBe(aUntil) // never before the last count
    const { shiftId, countedAt } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect(countedAt).toBe(new Date(Date.parse(aUntil) + 1).toISOString())
    const bot2 = await t.api.fetchBotCash(shiftId)
    expect(bot2).toMatchObject({ after: aUntil, until: countedAt, bills: [], cashTotalSatang: 0 })
    const sum = await t.api.countSummary(shiftId)
    const r = await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: sum.fingerprint, z: settle })
    expect(r.z!.snapshot!.botBills).toEqual([])
    const sent = (await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'shift_close')).all()).map((x) => ShiftCloseRowData.parse(x.rowJson).z_report.bot_bills.map((bb) => bb.order_no))
    expect(sent.flat()).toEqual(['L260925-901'])
    await pushOnce(ctx); await pushOnce(ctx)
    expect(await t.db.select().from(s.outbox).where(inArray(s.outbox.status, ['pending', 'dead'])).all()).toEqual([])
  })
  it('closeShift (one step) stays for local-only shifts; a central shift must go the count way (BOT_CASH_REQUIRED, nothing written)', async () => {
    const { t } = await centralShift()
    const report = await t.api.shiftReport()
    const input = { actorUserId: STAFF.TungAo, ...owner2, countLines: lines(545), shownExpectedCashSatang: report.expectedCashSatang, shownReportFingerprint: report.fingerprint, varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: false }
    await expectCode(t.api.closeShift(input), 'BOT_CASH_REQUIRED')
    expect((await t.api.bootstrap()).openShift).toMatchObject({ syncMode: 'central' })
    expect(await t.db.select().from(s.cashCount).all()).toEqual([])
  })
  it('a local-only shift cannot jump ahead of an earlier counted shift waiting for its Z (ruling R7) — closeShift too', async () => {
    const { t } = await centralShift()
    const a = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.confirmCount({ shiftId: a.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(545), shownFingerprint: (await t.api.countSummary(a.shiftId)).fingerprint, z: null })
    t.mock.setBlock3(false)
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 0 }) // dayo stopped advertising the shift kinds → local_only
    expect((await t.api.bootstrap()).openShift?.syncMode).toBe('local_only')
    t.clock.advanceMs(60_000)
    const report = await t.api.shiftReport()
    await expectCode(t.api.closeShift({ actorUserId: STAFF.TungAo, ...owner2, countLines: [], shownExpectedCashSatang: report.expectedCashSatang, shownReportFingerprint: report.fingerprint, varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: false }), 'Z_NOT_READY')
    expect((await t.api.bootstrap()).openShift?.syncMode).toBe('local_only') // rolled back: still open
    expect(await t.db.select().from(s.zReport).where(eq(s.zReport.shiftId, a.shiftId)).all()).toEqual([])
  })
})
