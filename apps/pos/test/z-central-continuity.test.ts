import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { ShiftCloseRowData } from '@dayo/contracts'
import { createMockDayo, MOCK_API_KEY } from '@dayo/dayo-mock'
import { centralZOf } from '../src/api/connect'
import { posErrorCode } from '../src/api/errors'
import { pullCatalog } from '../src/sync/catalog'
import { pushOnce } from '../src/sync/push'
import { DAYO_KEYS, readKey } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { openTestApi } from './helpers/db'

const H41 = 'ab'.repeat(32)
const H50 = 'cd'.repeat(32)
const owner2 = { approverUserId: STAFF.DCm, approverPin: '2222' }
const target = { baseUrl: 'http://localhost:8787/api/v1', apiKey: MOCK_API_KEY }
const Z41 = { zNo: 41, hash: H41, countedAt: '2026-09-24T12:00:00.000Z' }
type Api = Awaited<ReturnType<typeof openConnectedApi>>
/** "นับเสร็จ" + E4 once; the returned confirm() may be called again after a refusal (a refused Z rolls the count back — the shift stays 'counting'). */
async function countedCentral(t: Api) {
  const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
  await t.api.fetchBotCash(shiftId)
  const sum = await t.api.countSummary(shiftId)
  return (ack: boolean) => t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: [{ denominationSatang: 100, count: 500 }], shownFingerprint: sum.fingerprint, z: { varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: ack } })
}
const closeCentral = async (t: Api, ack: boolean) => (await countedCentral(t))(ack)
async function expectCode(p: Promise<unknown>, code: string): Promise<Error> {
  try { await p } catch (e) { expect(posErrorCode(e)).toBe(code); return e as Error }
  return expect.unreachable() as never
}

describe('Z numbering continues from dayo after a reinstall (spec 04 §6.6 · R4-1 · ruling R9)', () => {
  it('probe shows the last Z dayo holds; connecting needs the owner to confirm that number', async () => {
    const now = '2026-09-25T03:00:00.000Z'
    const mock = createMockDayo({ now, block3: true })
    mock.preloadZ(Z41)
    const t = await openTestApi({ fetch: mock.fetch, now })
    expect((await t.api.probeDayo(target)).lastZNo).toBe(41)
    const input = { ...target, receiptPrefix: 'A', ownerStaffId: STAFF.TungAo, ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null }
    await expectCode(t.api.connectShop({ ...input, confirmedLastZNo: null }), 'BAD_INPUT')
    await expectCode(t.api.connectShop({ ...input, confirmedLastZNo: 40 }), 'BAD_INPUT')
    expect(await readKey(t.db, DAYO_KEYS.lastZNo)).toBeNull() // a refused setup stores nothing
    await t.api.connectShop({ ...input, confirmedLastZNo: 41 })
    // stored in the tablet's own ISO form, though dayo sends …+00:00 (preflight D8)
    expect([await readKey(t.db, DAYO_KEYS.lastZNo), await readKey(t.db, DAYO_KEYS.lastZHash), await readKey(t.db, DAYO_KEYS.lastZUntil)]).toEqual(['41', H41, '2026-09-24T12:00:00.000Z'])
    expect((await t.api.bootstrap()).centralLastZNo).toBe(41)
  })
  it('the first Z after it asks the owner once (D55 path), is Z 42, chains to dayo\'s hash and window; the phase-2 mock matches it (R5-1)', async () => {
    const t = await openConnectedApi({ block3: true, block3Phase2: true, beforeConnect: (m) => m.preloadZ(Z41) })
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    t.clock.advanceMs(3_600_000)
    t.mock.setNow(t.clock.now())
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect(await t.api.fetchBotCash(shiftId)).toMatchObject({ after: '2026-09-24T12:00:00.000Z' }) // last_z_until, not 00:00 of the business date
    const sum = await t.api.countSummary(shiftId)
    const confirm = (ack: boolean) => t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: [{ denominationSatang: 100, count: 500 }], shownFingerprint: sum.fingerprint, z: { varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: ack } })
    const e = await expectCode(confirm(false), 'Z_CHAIN_BROKEN')
    expect(String(e)).toContain('central')
    const r = await confirm(true) // same shift, still 'counting': the refused Z rolled its count back
    expect(r.z?.snapshot).toMatchObject({ zNo: 42, chainWarning: { brokenShiftId: 'central', centralLastZ: { zNo: 41, hash: H41 }, zNoGap: 41, acknowledgedBy: STAFF.DCm } })
    const close = ShiftCloseRowData.parse((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'shift_close')).get())!.rowJson)
    expect(close.z_report).toMatchObject({ z_no: 42, prev_hash: H41, chain_warning: true, bot_window: { after: '2026-09-24T12:00:00.000Z' } })
    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'z_chain_broken_ack')).all()
    expect(audit).toHaveLength(1)
    expect(audit[0]!.afterJson).toMatchObject({ zNo: 42, centralLastZNo: 41, rowCount: 0 })
    await pushOnce(ctx); await pushOnce(ctx)
    expect(t.mock.zReports().find((z) => z.zNo === 42)).toMatchObject({ chainBreak: false, chainMismatch: [], recomputeStatus: 'matched' }) // rule 3 holds: after = until of Z 41
    expect(t.mock.conflicts()).toEqual([])
  })
  it('phase 1 dayo (no recompute) takes Z 42 as the next link: no chain break, not quarantined', async () => {
    const t = await openConnectedApi({ block3: true, beforeConnect: (m) => m.preloadZ(Z41) })
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    t.clock.advanceMs(3_600_000)
    t.mock.setNow(t.clock.now())
    await closeCentral(t, true)
    await pushOnce(ctx); await pushOnce(ctx)
    expect(t.mock.zReports().find((z) => z.zNo === 42)).toMatchObject({ chainBreak: false, quarantined: false, firstOfKey: false, recomputeStatus: null })
    expect(t.mock.conflicts()).toEqual([])
  })
  it('bot bills between Z 41 and this count are in this Z (nothing falls between the two Zs)', async () => {
    const t = await openConnectedApi({ block3: true, beforeConnect: (m) => m.preloadZ(Z41) })
    t.mock.seedCentralOrders([{ order_no: 'L260924-950', sale_date: '2026-09-24', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'line', payment: 'cash', totals: { items_subtotal: 70, items_discount: 0, bill_discount: 0, total: 70 }, amount_mismatch: false, updated_at: '2026-09-24T13:00:00+00:00', sold_at: '2026-09-24T13:00:00+00:00' }])
    t.clock.advanceMs(3_600_000)
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect((await t.api.fetchBotCash(shiftId)).bills.map((b) => b.orderNo)).toEqual(['L260924-950']) // 20:00 Bangkok the day before — after Z 41, before 00:00
  })
  it('the next Z is normal: 43, no question, prev_hash = hash of 42, window after = 42\'s until', async () => {
    const t = await openConnectedApi({ block3: true, beforeConnect: (m) => m.preloadZ(Z41) })
    t.clock.advanceMs(3_600_000)
    const z42 = await closeCentral(t, true)
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    t.clock.advanceMs(3_600_000)
    const z43 = await closeCentral(t, false)
    expect(z43.z?.snapshot).toMatchObject({ zNo: 43, chainWarning: null, botWindow: { after: z42.z!.snapshot!.botWindow!.until } })
    const rows = await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'shift_close')).all()
    expect(ShiftCloseRowData.parse(rows[1]!.rowJson).z_report.prev_hash).toBe(z42.z!.hash)
    expect((await t.api.listZReports()).map((z) => [z.zNo, z.hashOk])).toEqual([[43, true], [42, true]])
  })
  it('a count on a tablet whose clock is behind dayo\'s last Z is floored after it: the window never overlaps Z 41 (rounds 1–3 rule)', async () => {
    // dayo's clock and the last Z are at 12:00Z on the 24th + later; this tablet's clock says 11:00Z on the 24th
    const t = await openConnectedApi({ now: '2026-09-24T11:00:00.000Z', block3: true, beforeConnect: (m) => { m.preloadZ(Z41); m.setNow('2026-09-24T13:00:00.000Z') } })
    expect(t.shift.openedAt).toBe('2026-09-24T12:00:00.000Z') // opened at Z 41's until, never before it
    const { shiftId, countedAt } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect(countedAt).toBe('2026-09-24T12:00:00.001Z')
    expect(await t.api.fetchBotCash(shiftId)).toMatchObject({ after: '2026-09-24T12:00:00.000Z', until: countedAt })
  })
  it('the same R7 line: two counts before the first central Z — the first takes last_z_until, the second the first count', async () => {
    const t = await openConnectedApi({ block3: true, beforeConnect: (m) => m.preloadZ(Z41) })
    t.clock.advanceMs(3_600_000)
    const a = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.confirmCount({ shiftId: a.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: [{ denominationSatang: 100, count: 500 }], shownFingerprint: (await t.api.countSummary(a.shiftId)).fingerprint, z: null })
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    t.clock.advanceMs(3_600_000)
    const b = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect(await t.api.fetchBotCash(a.shiftId)).toMatchObject({ after: '2026-09-24T12:00:00.000Z', until: a.countedAt })
    expect(await t.api.fetchBotCash(b.shiftId)).toMatchObject({ after: a.countedAt, until: b.countedAt })
  })
  it.each([
    ['a missing hash', { last_z_no: 41, last_z_hash: null, last_z_until: '2026-09-24T12:00:00.000Z' }],
    ['a missing until', { last_z_no: 41, last_z_hash: H41, last_z_until: null }],
    ['an until that is not a time', { last_z_no: 41, last_z_hash: H41, last_z_until: 'yesterday' }],
    ['a missing number', { last_z_no: null, last_z_hash: H41, last_z_until: '2026-09-24T12:00:00.000Z' }],
    ['a zero number', { last_z_no: 0, last_z_hash: H41, last_z_until: '2026-09-24T12:00:00.000Z' }],
    ['a number whose next Z dayo could not hold (int4)', { last_z_no: 2_147_483_647, last_z_hash: H41, last_z_until: '2026-09-24T12:00:00.000Z' }],
    ['a hash that is not 64 hex', { last_z_no: 41, last_z_hash: 'AB'.repeat(32), last_z_until: '2026-09-24T12:00:00.000Z' }],
    ['an until later than dayo\'s own time + 5 min', { last_z_no: 41, last_z_hash: H41, last_z_until: '2026-09-25T03:05:00.001+00:00' }],
  ])('%s stops the setup with DAYO_Z_STATE_INVALID', async (_, client) => {
    const now = '2026-09-25T03:00:00.000Z'
    const mock = createMockDayo({ now, block3: true })
    mock.bumpCatalog((c) => { Object.assign(c.client as Record<string, unknown>, client) })
    const t = await openTestApi({ fetch: mock.fetch, now })
    await expectCode(t.api.probeDayo(target), 'DAYO_Z_STATE_INVALID')
    await expectCode(t.api.connectShop({ ...target, receiptPrefix: 'A', ownerStaffId: STAFF.TungAo, ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null, confirmedLastZNo: 41 }), 'DAYO_Z_STATE_INVALID')
    expect((await t.api.bootstrap()).needsSetup).toBe(true)
  })
  it('centralZOf: all null = none · dayo\'s …+00:00 and the tablet\'s …Z both read, stored as …Z (preflight D8)', () => {
    expect(centralZOf({ last_z_no: null, last_z_hash: null, last_z_until: null })).toBeNull()
    expect(centralZOf({})).toBeNull() // a block-2 dayo has no last_z_* at all
    expect(centralZOf({ last_z_no: 41, last_z_hash: H41, last_z_until: '2026-09-24T12:00:00.000+00:00' })).toEqual({ lastZNo: 41, lastZHash: H41, lastZUntil: '2026-09-24T12:00:00.000Z' })
    expect(centralZOf({ last_z_no: 41, last_z_hash: H41, last_z_until: '2026-09-24T19:00:00+07:00' })).toEqual({ lastZNo: 41, lastZHash: H41, lastZUntil: '2026-09-24T12:00:00.000Z' })
    expect(() => centralZOf({ last_z_no: 41.5, last_z_hash: H41, last_z_until: '2026-09-24T12:00:00.000Z' })).toThrow(/^DAYO_Z_STATE_INVALID/)
  })
  it('a key with no Z yet clears stale values (a new key starts its own chain — §6.6)', async () => {
    const t = await openConnectedApi({ block3: true })
    expect(await readKey(t.db, DAYO_KEYS.lastZNo)).toBeNull()
    expect((await t.api.bootstrap()).centralLastZNo).toBeNull()
  })
  it('replaceApiKey stores dayo\'s last Z in its transaction, asking nothing; the periodic E1 never does (ruling R9)', async () => {
    const t = await openConnectedApi({ block3: true })
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    // another install of this key sent Z 41 meanwhile: the running tablet's E1 does not take it
    t.mock.preloadZ(Z41)
    await pullCatalog(ctx)
    expect(await readKey(t.db, DAYO_KEYS.lastZNo)).toBeNull()
    // replacing the key reads it (no confirmation asked: the device and its Zs stay)
    await t.api.replaceApiKey({ ...target, approverUserId: STAFF.TungAo, approverPin: '1111' })
    expect([await readKey(t.db, DAYO_KEYS.lastZNo), await readKey(t.db, DAYO_KEYS.lastZHash), await readKey(t.db, DAYO_KEYS.lastZUntil)]).toEqual(['41', H41, '2026-09-24T12:00:00.000Z'])
    t.mock.preloadZ({ zNo: 50, hash: H50, countedAt: '2026-09-24T20:00:00.000Z' })
    await t.api.replaceApiKey({ ...target, approverUserId: STAFF.TungAo, approverPin: '1111' })
    expect(await readKey(t.db, DAYO_KEYS.lastZNo)).toBe('50')
    t.clock.advanceMs(3_600_000)
    const r = await closeCentral(t, true)
    expect(r.z?.snapshot).toMatchObject({ zNo: 51, chainWarning: { centralLastZ: { zNo: 50, hash: H50 } } })
  })
  it('recoverOwner stores the new key\'s last Z — none clears the old key\'s (a new key starts its own chain · §6.6); an odd one changes nothing', async () => {
    const NEW_KEY = `dayo_${'b'.repeat(64)}`
    const now = '2026-09-25T03:00:00.000Z'
    const oldKey = createMockDayo({ now, block3: true })
    const newKey = createMockDayo({ apiKey: NEW_KEY, now, block3: true })
    oldKey.preloadZ(Z41)
    const route: typeof fetch = (input, init) => (new Headers(init?.headers).get('Authorization') === `Bearer ${NEW_KEY}` ? newKey : oldKey).fetch(input, init)
    const t = await openTestApi({ fetch: route, now })
    await t.api.connectShop({ ...target, receiptPrefix: 'A', ownerStaffId: STAFF.TungAo, ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null, confirmedLastZNo: 41 })
    expect(await readKey(t.db, DAYO_KEYS.lastZNo)).toBe('41')
    oldKey.setMode('unauthorized') // revoked on the dayo web → recovery is offered (ruling N2)
    await pullCatalog({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    const rec = { baseUrl: target.baseUrl, apiKey: NEW_KEY, ownerStaffId: STAFF.DCm, ownerPin: '2468' }
    newKey.bumpCatalog((c) => { Object.assign(c.client as Record<string, unknown>, { last_z_no: 3, last_z_hash: null, last_z_until: null }) })
    await expectCode(t.api.recoverOwner(rec), 'DAYO_Z_STATE_INVALID')
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
    expect(await readKey(t.db, DAYO_KEYS.lastZNo)).toBe('41')
    newKey.bumpCatalog((c) => { Object.assign(c.client as Record<string, unknown>, { last_z_no: null, last_z_hash: null, last_z_until: null }) })
    await t.api.recoverOwner(rec)
    expect(await t.deps.secrets.getApiKey()).toBe(NEW_KEY)
    expect([await readKey(t.db, DAYO_KEYS.lastZNo), await readKey(t.db, DAYO_KEYS.lastZHash), await readKey(t.db, DAYO_KEYS.lastZUntil)]).toEqual([null, null, null])
  })
  it('a Z of this device above dayo\'s last Z: the device\'s own chain goes on (the stored value is below it — no question)', async () => {
    const t = await openConnectedApi({ block3: true })
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    t.clock.advanceMs(3_600_000)
    t.mock.setNow(t.clock.now())
    const z1 = await closeCentral(t, false)
    expect(z1.z?.snapshot?.zNo).toBe(1)
    await pushOnce(ctx); await pushOnce(ctx)
    // the key is replaced after Z 1 went out: dayo's last Z = this device's own last Z → stored, but not above it
    await t.api.replaceApiKey({ ...target, approverUserId: STAFF.TungAo, approverPin: '1111' })
    expect(await readKey(t.db, DAYO_KEYS.lastZNo)).toBe('1')
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    t.clock.advanceMs(3_600_000)
    t.mock.setNow(t.clock.now())
    const z2 = await closeCentral(t, false)
    expect(z2.z?.snapshot).toMatchObject({ zNo: 2, chainWarning: null, botWindow: { after: z1.z!.snapshot!.botWindow!.until } })
  })
})
