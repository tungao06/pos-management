import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import type { CentralOrder } from '@dayo/contracts'
import { posErrorCode } from '../src/api/errors'
import { centralContinuation } from '../src/api/central-z'
import { createPosApi } from '../src/api/pos-api'
import { deviceLastZNo } from '../src/api/z-rows'
import { pushOnce, SENT_AFTER_LOCAL_ACTION } from '../src/sync/push'
import { DAYO_KEYS, writeKey } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

/**
 * Carried items 9a/9b (release gate) and 10: the owner's ways past a Z that can never be issued (R7 would hold every later
 * Z behind it) and past a count floor poisoned by a clock that was far ahead — each with the owner's PIN, a reason and an
 * audit_log row — plus the cheap hardening of the central Z floor.
 */
const owner = { approverUserId: STAFF.TungAo, approverPin: '1111', reason: 'ระบบกลางดึงบิลบอทไม่ได้หลายวัน' }
const owner2 = { approverUserId: STAFF.DCm, approverPin: '2222' }
const settle = { varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: false }
const lines = (baht: number) => [{ denominationSatang: 100, count: baht }]
const bot = (no: string, total: number, at: string): CentralOrder => ({ order_no: no, sale_date: at.slice(0, 10), status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'line', payment: 'cash', totals: { items_subtotal: total, items_discount: 0, bill_discount: 0, total }, amount_mismatch: false, updated_at: at, sold_at: at })
async function code(p: Promise<unknown>): Promise<string | null> {
  try { await p } catch (e) { return posErrorCode(e) }
  throw new Error('expected a refusal')
}

describe('9a — keepShiftLocal: a central shift whose Z can never be issued is kept on the tablet (R19)', () => {
  it('E4 keeps failing for shift A: the owner keeps A local, A\'s Z issues without dayo, and B\'s Z is no longer held by R7', async () => {
    const t = await openConnectedApi({ block3: true })
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    await pushOnce(ctx) // A's shift_open reaches dayo
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    t.mock.seedCentralOrders([bot('L260925-901', 70, '2026-09-25T03:10:00+00:00')])
    t.clock.advanceMs(3_600_000); t.mock.setNow(t.clock.now())
    const a = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.confirmCount({ shiftId: a.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(615), shownFingerprint: (await t.api.countSummary(a.shiftId)).fingerprint, z: null })
    t.mock.setMode('server_down')
    expect(await code(t.api.fetchBotCash(a.shiftId))).toBe('DAYO_UNREACHABLE')
    t.mock.setMode('normal')
    const b = await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    t.clock.advanceMs(3_600_000); t.mock.setNow(t.clock.now())
    await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.fetchBotCash(b.id)
    const sb = await t.api.countSummary(b.id)
    expect(sb.zBlockedBy).toBe(a.shiftId)
    expect(await code(t.api.confirmCount({ shiftId: b.id, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: sb.fingerprint, z: settle }))).toBe('Z_NOT_READY')
    // A's Z needs E4 (central) — refused while dayo cannot answer it
    expect(await code(t.api.issueZ({ shiftId: a.shiftId, ...owner2, shownFingerprint: (await t.api.countSummary(a.shiftId)).fingerprint, ...settle }))).toBe('BOT_CASH_REQUIRED')

    // refusals first: nothing written
    const audit = await t.db.select().from(s.auditLog).all()
    expect(await code(t.api.keepShiftLocal({ ...owner, reason: '  ', shiftId: a.shiftId }))).toBe('BAD_INPUT')
    expect(await code(t.api.keepShiftLocal({ ...owner, approverPin: '0000', shiftId: a.shiftId }))).toBe('PIN_WRONG')
    await t.api.setStaffPin({ staffId: STAFF.Beam, pin: '5555', approverUserId: STAFF.TungAo, approverPin: '1111' })
    expect(await code(t.api.keepShiftLocal({ ...owner, approverUserId: STAFF.Beam, approverPin: '5555', shiftId: a.shiftId }))).toBe('NOT_OWNER')
    expect((await t.db.select().from(s.auditLog).all()).filter((x) => x.action === 'shift_kept_local')).toEqual([])
    expect(audit.length).toBeGreaterThan(0)

    const kept = await t.api.keepShiftLocal({ ...owner, shiftId: a.shiftId })
    expect(kept).toMatchObject({ shiftId: a.shiftId, sentKeys: [`shift_open:${a.shiftId}`], botWindow: { until: a.countedAt } })
    expect(kept.closedKeys).toEqual(expect.arrayContaining([expect.stringMatching(/^cash_count:/)]))
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, a.shiftId)).get())?.syncMode).toBe('local_only')
    expect((await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'shift_kept_local')).get())).toMatchObject({ entityId: a.shiftId, actorUserId: STAFF.TungAo, afterJson: { reason: owner.reason, syncMode: 'local_only' } })
    expect(await code(t.api.keepShiftLocal({ ...owner, shiftId: a.shiftId }))).toBe('REMEDY_NOT_ALLOWED') // once only

    // A's Z now needs no dayo: a local Z (no shift_close row), then B's central Z (R7 satisfied)
    t.mock.setMode('server_down')
    const za = await t.api.issueZ({ shiftId: a.shiftId, ...owner2, shownFingerprint: (await t.api.countSummary(a.shiftId)).fingerprint, ...settle, varianceReason: 'บิลบอทไม่อยู่ในใบนี้' })
    expect(za.snapshot).toMatchObject({ zNo: 1, botBills: [] })
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `shift_close:${a.shiftId}`)).all()).toEqual([])
    t.mock.setMode('normal')
    const zb = await t.api.confirmCount({ shiftId: b.id, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: (await t.api.countSummary(b.id)).fingerprint, z: settle })
    expect(zb.z?.snapshot).toMatchObject({ zNo: 2, botWindow: { after: a.countedAt } })
  })
  it('only a shift of this device that is central and not closed; the bills of the shift still go to dayo', async () => {
    const t = await openConnectedApi({ block3: false }) // a local-only shift
    expect(await code(t.api.keepShiftLocal({ ...owner, shiftId: t.shift!.id }))).toBe('REMEDY_NOT_ALLOWED')
    expect(await code(t.api.keepShiftLocal({ ...owner, shiftId: '00000000-0000-4000-8000-000000000000' }))).toBe('REMEDY_NOT_ALLOWED')
    const c = await openConnectedApi({ block3: true })
    const kept = await c.api.keepShiftLocal({ ...owner, shiftId: c.shift!.id }) // an OPEN central shift (e.g. the key was replaced — carried item 7)
    expect(kept).toMatchObject({ sentKeys: [], closedKeys: [`shift_open:${c.shift!.id}`], botWindow: null })
    const sale = await sellCode(c, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    expect((await c.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order:${sale.orderId}`)).get())).toMatchObject({ status: 'pending', rowJson: { shift_id: null } })
    const m = await c.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 1_000, reason: 'x' })
    expect((await c.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `cash_movement:${m.id}`)).get())?.status).toBe('local_only')
  })
})

describe('fix round 1 item 2 — a row closed local while its request is on the wire, and dayo stores it', () => {
  function onTheWire(t: Awaited<ReturnType<typeof openConnectedApi>>) {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let onWire!: () => void
    const wire = new Promise<void>((r) => { onWire = r })
    const gated: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/pos/push')) { onWire(); await gate }
      return t.mock.fetch(input, init)
    }
    const api = createPosApi(t.db, { ...t.deps, fetch: gated })
    return { api, sync: api.syncNow(), wire, release }
  }
  it('keepShiftLocal during the push of its shift_open: dayo accepted it, so the row ends sent and an audit row says it reached dayo after the keep', async () => {
    const t = await openConnectedApi({ block3: true })
    const { api, sync, wire, release } = onTheWire(t)
    await wire
    const kept = await api.keepShiftLocal({ ...owner, shiftId: t.shift!.id })
    expect(kept.closedKeys).toEqual([`shift_open:${t.shift!.id}`])
    release()
    await sync
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `shift_open:${t.shift!.id}`)).get()).toMatchObject({ status: 'sent', resultJson: { shift_id: t.shift!.id } })
    expect(t.mock.shifts().map((x) => x.id)).toEqual([t.shift!.id])
    expect(await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, SENT_AFTER_LOCAL_ACTION)).all()).toEqual([expect.objectContaining({ entityId: `shift_open:${t.shift!.id}`, afterJson: { status: 'sent', verdict: 'accepted' } })])
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, t.shift!.id)).get())?.syncMode).toBe('local_only') // the owner's choice stands for the rows after it
  })
  it('EXCLUDE of a far-ahead bill during its push, dayo accepts: the bill is shown as in dayo, never "outside dayo"', async () => {
    const t = await openConnectedApi({ now: '2026-09-27T03:00:00.000Z' })
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setNow('2026-09-25T03:00:00.000Z')
    await pushOnce(ctx) // CLOCK_AHEAD, far ahead: a clock card
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    t.clock.advanceMs(120_000)
    const { api, sync, wire, release } = onTheWire(t)
    await wire
    t.mock.setNow(t.clock.now())                                      // dayo's clock has caught up: it will accept
    await api.excludeFromSync({ ...owner, outboxId: p!.outboxId })
    release()
    await sync
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.id, p!.outboxId)).get()).toMatchObject({ status: 'sent' })
    expect((await t.api.getOrder(r.orderId)).central).toMatchObject({ state: 'sent' })
    expect(t.mock.orders()).toEqual([expect.objectContaining({ posOrderId: r.orderId, status: 'ok' })])
  })
})

describe('9b — skipCountFloor: a count floor poisoned by a far-ahead clock', () => {
  it('the owner skips the far-ahead floor once (PIN + reason + audit, the bot-bill risk named); counting works again', async () => {
    const t = await openConnectedApi({ block3: false })
    t.clock.set('2026-09-28T03:00:00.000Z')              // the tablet clock jumps three days ahead and A is counted then
    const a = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.confirmCount({ shiftId: a.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: (await t.api.countSummary(a.shiftId)).fingerprint, z: null })
    t.clock.set('2026-09-25T04:00:00.000Z')              // set right again
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    expect(await code(t.api.finishCount({ actorUserId: STAFF.TungAo }))).toBe('BAD_INPUT') // CLOCK_AHEAD
    expect(await code(t.api.skipCountFloor({ ...owner, approverPin: '0000' }))).toBe('PIN_WRONG')
    expect(await code(t.api.skipCountFloor({ ...owner, reason: '' }))).toBe('BAD_INPUT')
    const r = await t.api.skipCountFloor(owner)
    expect(r).toEqual({ skipped: [{ countedAt: a.countedAt, shiftId: a.shiftId }], botBillsRisk: 'double_or_missed' })
    expect((await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'count_floor_skipped')).get())).toMatchObject({ entityId: t.device.id, actorUserId: STAFF.TungAo, afterJson: { skipped: [{ countedAt: a.countedAt }], reason: owner.reason, botBillsRisk: 'double_or_missed' } })
    const b = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect(b.countedAt).toBe('2026-09-25T04:00:00.000Z')
    expect(await code(t.api.skipCountFloor(owner))).toBe('REMEDY_NOT_ALLOWED') // nothing far ahead left to skip
    // B's Z first (counted earlier than A), then A's — nothing is refused for the clock any more
    const zb = await t.api.confirmCount({ shiftId: b.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: (await t.api.countSummary(b.shiftId)).fingerprint, z: settle })
    expect(zb.z?.snapshot?.zNo).toBe(1)
    const za = await t.api.issueZ({ shiftId: a.shiftId, ...owner2, shownFingerprint: (await t.api.countSummary(a.shiftId)).fingerprint, ...settle })
    expect(za.snapshot?.zNo).toBe(2)
  })
  it('fix round 1 item 1: two counts taken while the clock was ahead are skipped by ONE owner action — never one left behind', async () => {
    const t = await openConnectedApi({ block3: false })
    t.clock.set('2026-09-28T03:00:00.000Z')
    const a = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.confirmCount({ shiftId: a.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: (await t.api.countSummary(a.shiftId)).fingerprint, z: null })
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    t.clock.advanceMs(60_000)
    const b = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.confirmCount({ shiftId: b.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: (await t.api.countSummary(b.shiftId)).fingerprint, z: null })
    t.clock.set('2026-09-25T04:00:00.000Z')
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    expect(await code(t.api.finishCount({ actorUserId: STAFF.TungAo }))).toBe('BAD_INPUT')
    expect(await t.api.skipCountFloor(owner)).toEqual({ skipped: [{ countedAt: a.countedAt, shiftId: a.shiftId }, { countedAt: b.countedAt, shiftId: b.shiftId }], botBillsRisk: 'double_or_missed' })
    expect(await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'count_floor_skipped')).all()).toHaveLength(1)
    const c = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect(c.countedAt).toBe('2026-09-25T04:00:00.000Z')
    expect(await code(t.api.skipCountFloor(owner))).toBe('REMEDY_NOT_ALLOWED')
    const zc = await t.api.confirmCount({ shiftId: c.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: (await t.api.countSummary(c.shiftId)).fingerprint, z: settle })
    const za = await t.api.issueZ({ shiftId: a.shiftId, ...owner2, shownFingerprint: (await t.api.countSummary(a.shiftId)).fingerprint, ...settle })
    const zb = await t.api.issueZ({ shiftId: b.shiftId, ...owner2, shownFingerprint: (await t.api.countSummary(b.shiftId)).fingerprint, ...settle })
    expect([zc.z?.snapshot?.zNo, za.snapshot?.zNo, zb.snapshot?.zNo]).toEqual([1, 2, 3])
  })
  it('fix round 1 item 1 (central): the far-ahead rows wait as clock cards; one skip lets a new shift count; once real time passes the counts, both Zs go to dayo', async () => {
    const t = await openConnectedApi({ block3: true })                 // shift A, 2026-09-25T03:00Z, dayo too
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    t.clock.set('2026-09-28T03:00:00.000Z')                            // the tablet clock jumps 3 days; A and B are counted then
    const a = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.confirmCount({ shiftId: a.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: (await t.api.countSummary(a.shiftId)).fingerprint, z: null })
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    t.clock.advanceMs(60_000)
    const b = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.confirmCount({ shiftId: b.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: (await t.api.countSummary(b.shiftId)).fingerprint, z: null })
    t.clock.set('2026-09-25T04:00:00.000Z')                            // set right
    t.mock.setNow(t.clock.now())
    await pushOnce(ctx)
    const cards = await t.api.listSyncProblems(STAFF.TungAo)
    // every row stamped while the clock was ahead is a clock card (A's count, B's shift_open and count) — A's count holds the lane
    expect(cards.map((x) => [x.pushKind, x.shiftId, x.waiting, x.remedies])).toEqual([['cash_count', a.shiftId, 'clock', ['EXCLUDE']], ['shift_open', b.shiftId, 'clock', ['EXCLUDE']], ['cash_count', b.shiftId, 'clock', ['EXCLUDE']]])
    expect((await t.api.syncStatus()).shiftLaneHeld).toMatchObject({ blockingKey: cards[0]!.key, reason: 'clock' })
    const c = await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    expect(await code(t.api.finishCount({ actorUserId: STAFF.TungAo }))).toBe('BAD_INPUT')
    expect((await t.api.skipCountFloor(owner)).skipped.map((x) => x.shiftId)).toEqual([a.shiftId, b.shiftId])
    await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.fetchBotCash(c.id)
    const zc = await t.api.confirmCount({ shiftId: c.id, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: (await t.api.countSummary(c.id)).fingerprint, z: settle })
    expect(zc.z?.snapshot?.zNo).toBe(1)
    // A's E4 window ends 3 days ahead: not closed in dayo yet — asked again once real time has passed it
    expect(await code(t.api.fetchBotCash(a.shiftId))).toBe('BAD_INPUT')
    t.clock.set('2026-09-28T05:00:00.000Z')
    t.mock.setNow(t.clock.now())
    await t.api.fetchBotCash(a.shiftId)
    const za = await t.api.issueZ({ shiftId: a.shiftId, ...owner2, shownFingerprint: (await t.api.countSummary(a.shiftId)).fingerprint, ...settle })
    await t.api.fetchBotCash(b.shiftId)
    const zb = await t.api.issueZ({ shiftId: b.shiftId, ...owner2, shownFingerprint: (await t.api.countSummary(b.shiftId)).fingerprint, ...settle })
    expect([za.snapshot?.zNo, zb.snapshot?.zNo]).toEqual([2, 3])
    for (let i = 0; i < 4; i++) { await pushOnce(ctx); t.clock.advanceMs(61_000); t.mock.setNow(t.clock.now()) }
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.status, 'dead')).all()).toEqual([])
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.status, 'pending')).all()).toEqual([])
    expect(t.mock.zReports().map((z) => z.zNo)).toEqual([1, 2, 3])
    expect(await t.api.listSyncProblems(STAFF.TungAo)).toEqual([])
  })
  it('nothing to skip while no count is far ahead', async () => {
    const t = await openConnectedApi({ block3: false })
    expect(await code(t.api.skipCountFloor(owner))).toBe('REMEDY_NOT_ALLOWED')
    expect(await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'count_floor_skipped')).all()).toEqual([])
  })
})

describe('10 — central Z floor hardening (T13 ruling)', () => {
  const HASH = 'a'.repeat(64)
  it('no continuation once this device already continued at or past dayo\'s last Z (central_z_floor > last_z_no)', async () => {
    const t = await openConnectedApi({ block3: true, openShift: false })
    await writeKey(t.db, DAYO_KEYS.lastZNo, '5'); await writeKey(t.db, DAYO_KEYS.lastZHash, HASH); await writeKey(t.db, DAYO_KEYS.lastZUntil, '2026-09-24T12:00:00.000Z')
    expect(await centralContinuation(t.db, t.device.id)).toMatchObject({ lastZNo: 5 })
    await writeKey(t.db, DAYO_KEYS.centralZFloor, '6')
    expect(await centralContinuation(t.db, t.device.id)).toBeNull()
  })
  it('a high-water far above what the Z rows can prove is not trusted (rows + gap + 50)', async () => {
    const t = await openConnectedApi({ block3: false, openShift: false })
    await writeKey(t.db, DAYO_KEYS.deviceZHigh, '50')
    expect(await deviceLastZNo(t.db, t.device.id)).toBe(50)
    await writeKey(t.db, DAYO_KEYS.deviceZHigh, '51')
    expect(await deviceLastZNo(t.db, t.device.id)).toBe(0)
  })
  it('a central_z_floor pushed out of reach does not drag the lenient numbering (acknowledged broken chain)', async () => {
    const t = await openConnectedApi({ block3: false })
    const report = await t.api.shiftReport()
    await t.api.closeShift({ actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownExpectedCashSatang: report.expectedCashSatang, shownReportFingerprint: report.fingerprint, varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: false })
    t.raw.exec('DROP TRIGGER z_report_no_update')                     // a hand edit of the file: the Z fails its hash
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.grandTotalSatang', 1)`).run()
    await writeKey(t.db, DAYO_KEYS.centralZFloor, '2000000000')
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    const r2 = await t.api.shiftReport()
    const z = await t.api.closeShift({ actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownExpectedCashSatang: r2.expectedCashSatang, shownReportFingerprint: r2.fingerprint, varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: true })
    expect(z.snapshot?.zNo).toBe(2)
  })
})
