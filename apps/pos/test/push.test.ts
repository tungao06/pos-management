import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { clearFailureBackoff, pushOnce, REQUEST_FAILED, retryRow } from '../src/sync/push'
import { MOCK_API_KEY } from '@dayo/dayo-mock'
import { DAYO_KEYS, encodeLastError, readKey, STUCK_AFTER_ATTEMPTS, writeKey } from '../src/sync/state'
import { countSyncProblems } from '../src/api/bootstrap'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

async function ready(now?: string) {
  const t = await openConnectedApi(now === undefined ? {} : { now })
  return { t, ctx: { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() } }
}
const cocoa = (t: Awaited<ReturnType<typeof ready>>['t']) => sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
const outbox = async (t: Awaited<ReturnType<typeof ready>>['t']) => t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order')).all()

describe('pushOnce (spec 04 §6.2–6.3)', () => {
  it('sends pending bills and stores dayo order numbers', async () => {
    const { t, ctx } = await ready()
    await cocoa(t); await cocoa(t); await cocoa(t)
    expect(await pushOnce(ctx)).toMatchObject({ requests: 1, sent: 3, stopped: null })
    expect((await t.db.select().from(s.order).all()).map((o) => o.centralOrderNo).sort()).toEqual(['L260925-001', 'L260925-002', 'L260925-003'])
    expect(await t.api.bootstrap()).toMatchObject({ pendingSyncItems: 0 })
  })
  it('25 bills go in requests of 20 and 5', async () => {
    const { t, ctx } = await ready()
    for (let i = 0; i < 25; i++) await cocoa(t)
    await pushOnce(ctx)
    expect(t.mock.requests().filter((r) => r.path === '/api/v1/pos/push').map((r) => r.rows)).toEqual([20, 5])
  })
  it('a bill voided before it was sent goes out first, then its void, in one request', async () => {
    const { t, ctx } = await ready()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'กดผิด', made: false, refundReference: null })
    expect(await pushOnce(ctx)).toMatchObject({ requests: 1, sent: 2 })
    expect(t.mock.orders()).toEqual([expect.objectContaining({ receiptNo: 'A-000001', status: 'cancelled' })])
  })
  it('a void waits while its bill is deferred, then follows it', async () => {
    const { t, ctx } = await ready()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'กดผิด', made: false, refundReference: null })
    t.mock.override({ match: { key: `order:${r.orderId}` }, verdict: { status: 'deferred', reason: 'BUSY', detail: 'lock' }, times: 1 })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 0, deferred: 2 }) // same batch: bill BUSY, void PARENT_PENDING from dayo
    const voidRow = (await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_void')).get())!
    expect(voidRow).toMatchObject({ status: 'pending', attempts: 0, nextAttemptAt: null }) // not counted while its bill is not sent (review item 12)
    t.clock.advanceMs(5_000)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 2 })
  })
  it('a rejected bill goes to "ส่งไม่ผ่าน", its void follows it there, the queue keeps moving', async () => {
    const { t, ctx } = await ready()
    const bad = await cocoa(t)
    await t.api.cancelSale({ orderId: bad.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'x', made: false, refundReference: 'K1' })
    await cocoa(t)
    t.mock.override({ match: { receiptNo: 'A-000001' }, verdict: { status: 'rejected', reason: 'UNKNOWN_CODE', detail: 'ไม่พบรหัสเมนู Cocoa' }, times: 1 })
    const o = await pushOnce(ctx)
    expect(o).toMatchObject({ rejected: 1, sent: 1 })
    const rows = await t.db.select().from(s.outbox).where(eq(s.outbox.status, 'dead')).all()
    // the void was in the SAME batch and got its own PARENT_PENDING verdict — it must still end as PARENT_REJECTED (review item 3)
    expect(rows.map((r) => [r.tableName, JSON.parse(r.lastError!).reason])).toEqual([['order', 'UNKNOWN_CODE'], ['order_void', 'PARENT_REJECTED']])
    await retryRow(t.db, rows[0]!.id) // the owner fixes the bill → both go back to the queue
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.status, 'pending')).all()).map((r) => r.tableName).sort()).toEqual(['order', 'order_void'])
  })
  it('deferred rows back off 5 s, 15 s, … and become STUCK after 50 tries', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.override({ match: { receiptNo: 'A-000001' }, verdict: { status: 'deferred', reason: 'BUSY' }, times: 60 })
    await pushOnce(ctx)
    const first = (await outbox(t))[0]!
    expect(first.attempts).toBe(1)
    expect(Date.parse(first.nextAttemptAt!) - Date.parse(t.clock.now())).toBe(5_000) // random 0.5 → no jitter
    for (let i = 0; i < 49; i++) { t.clock.advanceMs(900_000); await pushOnce(ctx) }
    expect((await outbox(t))[0]).toMatchObject({ status: 'dead', attempts: 50 })
    expect(JSON.parse((await outbox(t))[0]!.lastError!).reason).toBe('STUCK')
  })
  it('CLOCK_AHEAD does not count a try and raises the clock warning (ruling R3, D80)', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.override({ match: { receiptNo: 'A-000001' }, verdict: { status: 'deferred', reason: 'CLOCK_AHEAD' }, times: 1 })
    await pushOnce(ctx)
    expect((await outbox(t))[0]!.attempts).toBe(0)
    expect(await readKey(t.db, DAYO_KEYS.clockAheadAt)).not.toBeNull()
  })
  it('a row more than 24 h ahead stays pending and is only flagged — never dead, never excluded by itself (R3, ruling N5)', async () => {
    const { t, ctx } = await ready('2026-09-27T03:00:00.000Z') // tablet clock 2 days fast
    await cocoa(t)
    t.mock.setNow('2026-09-25T03:00:00.000Z')
    await pushOnce(ctx)
    const [row] = await outbox(t)
    expect(row).toMatchObject({ status: 'pending', attempts: 0 })
    expect(JSON.parse(row!.lastError!)).toMatchObject({ reason: 'CLOCK_AHEAD', farAhead: true })
    t.clock.advanceMs(25 * 3_600_000) // a day later it is still waiting, still pending
    await pushOnce(ctx)
    expect((await outbox(t))[0]).toMatchObject({ status: 'pending' })
  })
  /** Fails `n` requests in a row, waiting out each backoff so the streak really grows (N4). */
  async function buildBackoff(t: Awaited<ReturnType<typeof ready>>['t'], ctx: Parameters<typeof pushOnce>[0], n: number) {
    for (let i = 1; i <= n; i++) {
      const until = await readKey(t.db, DAYO_KEYS.pushBackoffUntil)
      if (until !== null) t.clock.advanceMs(Math.max(0, Date.parse(until) - Date.parse(t.clock.now())) + 1)
      expect((await pushOnce(ctx)).stopped).not.toBe('backoff') // a real attempt
      expect(await readKey(t.db, DAYO_KEYS.pushFailStreak)).toBe(String(i))
    }
  }
  it('after going back online the queue is sent at once, not after the failure backoff (review item 2)', async () => {
    const { t } = await ready()
    for (let i = 0; i < 5; i++) await cocoa(t)
    let online = false
    const f: typeof fetch = async (input, init) => { if (!online) throw new TypeError('Failed to fetch'); return t.mock.fetch(input, init) }
    const ctx = { db: t.db, deps: { ...t.deps, fetch: f }, serial: <T>(fn: () => Promise<T>) => fn() }
    await buildBackoff(t, ctx, 4) // 5 s → 15 s → 1 min → 5 min (N4: a real multi-minute backoff)
    const until = (await readKey(t.db, DAYO_KEYS.pushBackoffUntil))!
    expect(Date.parse(until) - Date.parse(t.clock.now())).toBeGreaterThanOrEqual(240_000) // 5 min − 20 %
    expect((await pushOnce(ctx)).stopped).toBe('backoff')
    online = true
    await clearFailureBackoff(t.db) // what the scheduler does on 'online' (Task 14)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 5 })
  })
  it('clearFailureBackoff keeps a 429 Retry-After', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.setMode('rate_limited')
    await pushOnce(ctx)
    t.mock.setMode('normal')
    await clearFailureBackoff(t.db)
    expect((await pushOnce(ctx)).stopped).toBe('backoff')
  })
  it('rows using a field dayo does not list are held and never counted (spec §4.4 rule 10)', async () => {
    const { t, ctx } = await ready()
    t.mock.bumpCatalog((c) => { c.supported_fields.order = c.supported_fields.order!.filter((f) => f !== 'note') })
    const { pullCatalog } = await import('../src/sync/catalog')
    await pullCatalog(ctx)
    await cocoa(t)
    expect(await pushOnce(ctx)).toMatchObject({ requests: 0, held: 1 })
    t.mock.bumpCatalog((c) => { c.supported_fields.order!.push('note') })
    await pullCatalog(ctx)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('401 stops every later send until a new key (spec §6.3)', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.setMode('unauthorized')
    expect((await pushOnce(ctx)).stopped).toBe('unauthorized')
    t.mock.setMode('normal')
    const before = t.mock.requests().length // the mock logs refused requests too (status 401)
    expect(t.mock.requests().at(-1)?.status).toBe(401)
    expect((await pushOnce(ctx)).stopped).toBe('api_blocked')
    expect(t.mock.requests().length).toBe(before)
  })
  it('404 = API switched off: wait 15 minutes, then try again', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.setMode('api_disabled')
    await pushOnce(ctx)
    t.mock.setMode('normal')
    expect((await pushOnce(ctx)).stopped).toBe('api_blocked')
    t.clock.advanceMs(15 * 60_000)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('429 waits for Retry-After', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.setMode('rate_limited')
    await pushOnce(ctx)
    t.mock.setMode('normal')
    expect((await pushOnce(ctx)).stopped).toBe('backoff')
    t.clock.advanceMs(30_000)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('three 5xx in a row → one row per request until that batch is decided (ruling R4)', async () => {
    const { t, ctx } = await ready()
    for (let i = 0; i < 3; i++) await cocoa(t)
    t.mock.setMode('server_down')
    for (let i = 0; i < 3; i++) { await pushOnce(ctx); t.clock.advanceMs(900_000) }
    t.mock.setMode('normal')
    await pushOnce(ctx)
    expect(t.mock.requests().filter((r) => r.path === '/api/v1/pos/push').slice(-3).map((r) => r.rows)).toEqual([1, 1, 1])
    // fix round 1 (A): once those three are decided the sender is back to full batches
    expect(await readKey(t.db, DAYO_KEYS.pushSingleThrough)).toBeNull()
    await cocoa(t); await cocoa(t)
    await pushOnce(ctx)
    expect(t.mock.requests().filter((r) => r.path === '/api/v1/pos/push').at(-1)!.rows).toBe(2)
  })
  it('422 on a batch → one by one; the row that still fails alone goes to ENVELOPE', async () => {
    const { t } = await ready()
    for (let i = 0; i < 3; i++) await cocoa(t)
    const fetch422: typeof fetch = async (input, init) => (String(init?.body).includes('A-000002') ? new Response(JSON.stringify({ ok: false, error: { code: 'DY422', message: 'invalid' } }), { status: 422 }) : t.mock.fetch(input, init))
    const ctx = { db: t.db, deps: { ...t.deps, fetch: fetch422 }, serial: <T>(fn: () => Promise<T>) => fn() }
    await pushOnce(ctx)
    for (let i = 0; i < 3; i++) await pushOnce(ctx)
    const rows = await outbox(t)
    expect(rows.map((r) => [r.status, r.lastError === null ? null : JSON.parse(r.lastError).reason])).toEqual([['sent', null], ['dead', 'ENVELOPE'], ['sent', null]])
  })
  it('a row without a verdict (or with an unknown status) is retried without spending a try (plan 5 H-2/M-2)', async () => {
    const { t } = await ready()
    await cocoa(t)
    const silent: typeof fetch = async (input, init) => { const r = await t.mock.fetch(input, init); const b = await r.json() as { data: { results: unknown[] } }; b.data.results = []; return new Response(JSON.stringify(b), { status: 200 }) }
    const ctx = { db: t.db, deps: { ...t.deps, fetch: silent }, serial: <T>(fn: () => Promise<T>) => fn() }
    expect(await pushOnce(ctx)).toMatchObject({ noAnswer: 1 })
    expect((await outbox(t))[0]).toMatchObject({ status: 'pending', attempts: 0 })
  })
})

/** Rewrites every E2 answer the mock gives (the request still reaches the mock, so dayo really stored what it accepted). */
function rewriting(t: Awaited<ReturnType<typeof ready>>['t'], edit: (results: { key: string | null; status: string }[]) => void): typeof fetch {
  return async (input, init) => {
    const r = await t.mock.fetch(input, init)
    if (r.status !== 200) return r
    const b = await r.json() as { data: { results: { key: string | null; status: string }[] } }
    edit(b.data.results)
    return new Response(JSON.stringify(b), { status: 200 })
  }
}
const pushRequests = (t: Awaited<ReturnType<typeof ready>>['t']) => t.mock.requests().filter((r) => r.path === '/api/v1/pos/push')
const cancel = (t: Awaited<ReturnType<typeof ready>>['t'], orderId: string) =>
  t.api.cancelSale({ orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'กดผิด', made: false, refundReference: 'K1' })

describe('pushOnce — row order, verdict matching and refusals', () => {
  it('a void with the SAME created_at as its bill goes after it in one request — the tiebreak is insertion order, not the outbox id', async () => {
    const { t, ctx } = await ready()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    await cancel(t, r.orderId)
    const [bill, voidRow] = await t.db.select().from(s.outbox).where(eq(s.outbox.status, 'pending')).all()
    expect([bill!.tableName, voidRow!.tableName]).toEqual(['order', 'order_void'])
    expect(bill!.createdAt).toBe(voidRow!.createdAt) // the test clock did not move: the void time equals sold_at
    // UUIDv7 ids of one millisecond are not ordered: give the void the SMALLER id so an id tiebreak would put it first
    await t.db.update(s.outbox).set({ id: 'ffffffff-ffff-4fff-bfff-ffffffffffff' }).where(eq(s.outbox.id, bill!.id))
    await t.db.update(s.outbox).set({ id: '00000000-0000-4000-8000-000000000000' }).where(eq(s.outbox.id, voidRow!.id))
    const keys: string[][] = []
    const spy: typeof fetch = async (input, init) => { keys.push((JSON.parse(String(init?.body)) as { rows: { key: string }[] }).rows.map((x) => x.key)); return t.mock.fetch(input, init) }
    expect(await pushOnce({ ...ctx, deps: { ...t.deps, fetch: spy } })).toMatchObject({ requests: 1, sent: 2 })
    expect(keys).toEqual([[`order:${r.orderId}`, `order_void:${r.orderId}`]])
    expect(t.mock.orders()).toEqual([expect.objectContaining({ status: 'cancelled' })])
  })
  it('a void is never sent while its bill is not sent and not earlier in the same request', async () => {
    const { t, ctx } = await ready()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    await cancel(t, r.orderId)
    await t.db.update(s.outbox).set({ nextAttemptAt: '2026-09-25T04:00:00.000Z' }).where(eq(s.outbox.tableName, 'order')) // the bill waits out a backoff
    expect(await pushOnce(ctx)).toMatchObject({ requests: 0, sent: 0 })
    expect(pushRequests(t)).toEqual([])
    t.clock.advanceMs(3_600_000)
    expect(await pushOnce(ctx)).toMatchObject({ requests: 1, sent: 2 })
  })
  it('a result whose key is null matches no row: the row stays pending and no try is spent (A6)', async () => {
    const { t } = await ready()
    await cocoa(t)
    const ctx = { db: t.db, deps: { ...t.deps, fetch: rewriting(t, (rs) => { for (const x of rs) x.key = null }) }, serial: <T>(fn: () => Promise<T>) => fn() }
    expect(await pushOnce(ctx)).toMatchObject({ requests: 1, sent: 0, noAnswer: 1 })
    const [row] = await outbox(t)
    expect(row).toMatchObject({ status: 'pending', attempts: 0, nextAttemptAt: '2026-09-25T03:01:00.000Z' })
    expect(JSON.parse(row!.lastError!).reason).toBe('NO_ANSWER')
  })
  it('two verdicts for one key = no verdict: pending, no try spent', async () => {
    const { t } = await ready()
    await cocoa(t)
    const ctx = { db: t.db, deps: { ...t.deps, fetch: rewriting(t, (rs) => { rs.push({ ...rs[0]!, status: 'rejected' }) }) }, serial: <T>(fn: () => Promise<T>) => fn() }
    expect(await pushOnce(ctx)).toMatchObject({ noAnswer: 1 })
    const [row] = await outbox(t)
    expect(row).toMatchObject({ status: 'pending', attempts: 0 })
    expect(JSON.parse(row!.lastError!).reason).toBe('DUPLICATE_VERDICT')
  })
  it('403 for the whole request (key without orders:write) stops every send — no row is judged FORBIDDEN', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.setScopes(['catalog:read', 'staff:read', 'orders:read'])
    expect((await pushOnce(ctx)).stopped).toBe('forbidden')
    expect(t.mock.requests().at(-1)).toMatchObject({ path: '/api/v1/pos/push', status: 403 })
    expect(await readKey(t.db, DAYO_KEYS.apiState)).toBe('forbidden')
    expect((await outbox(t))[0]).toMatchObject({ status: 'pending', attempts: 0, lastError: null })
    const before = t.mock.requests().length
    t.clock.advanceMs(3_600_000)
    expect((await pushOnce(ctx)).stopped).toBe('api_blocked')
    expect(t.mock.requests().length).toBe(before)
  })
  it('a proxy or WAF 403 without dayo\'s error body is a server failure: backoff and retry, never a stop (task 14 item 3)', async () => {
    const { t } = await ready()
    await cocoa(t)
    let waf = true
    const f: typeof fetch = async (input, init) => (waf ? new Response('<html>403 Forbidden</html>', { status: 403 }) : t.mock.fetch(input, init))
    const ctx = { db: t.db, deps: { ...t.deps, fetch: f }, serial: <T>(fn: () => Promise<T>) => fn() }
    expect((await pushOnce(ctx)).stopped).toBe('server')
    expect(await readKey(t.db, DAYO_KEYS.apiState)).toBe('ok')
    expect(await readKey(t.db, DAYO_KEYS.pushBackoffReason)).toBe('failure')
    waf = false
    t.clock.advanceMs(60_000)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('sale_date = the server\'s tomorrow is deferred CLOCK_AHEAD: no try, not dead, retried after 60 s (R3)', async () => {
    const { t, ctx } = await ready('2026-09-25T17:02:00.000Z') // 00:02 on the 26th in Thailand
    await cocoa(t)
    t.mock.setNow('2026-09-25T16:58:30.000Z') // the server is still at 23:58 on the 25th — within 5 min, but the date is tomorrow
    expect(await pushOnce(ctx)).toMatchObject({ requests: 1, deferred: 1 })
    const [row] = await outbox(t)
    expect(row).toMatchObject({ status: 'pending', attempts: 0, nextAttemptAt: '2026-09-25T17:03:00.000Z' })
    expect(JSON.parse(row!.lastError!)).toEqual({ reason: 'CLOCK_AHEAD', detail: expect.stringContaining('วันพรุ่งนี้') })
    expect(await readKey(t.db, DAYO_KEYS.clockAheadAt)).toBe('2026-09-25T17:02:00.000Z')
    t.mock.setNow('2026-09-25T17:03:00.000Z')
    t.clock.advanceMs(60_000)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('a void older than 60 days on the server is rejected INVALID and goes to "ส่งไม่ผ่าน"; its sent bill stays sent', async () => {
    const { t, ctx } = await ready()
    const r = await cocoa(t)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
    await cancel(t, r.orderId)
    t.mock.setNow('2026-11-25T03:00:00.000Z') // the tablet was offline for two months
    expect(await pushOnce(ctx)).toMatchObject({ rejected: 1 })
    const rows = await t.db.select().from(s.outbox).where(inArray(s.outbox.tableName, ['order', 'order_void'])).all()
    expect(rows.map((x) => [x.tableName, x.status])).toEqual([['order', 'sent'], ['order_void', 'dead']])
    expect(JSON.parse(rows[1]!.lastError!)).toMatchObject({ reason: 'INVALID', detail: expect.stringContaining('60 วัน') })
  })
  it('a promotion dayo closed before sold_at: accepted, and dayo\'s own total is stored beside ours (Task 15 shows the difference)', async () => {
    const { t, ctx } = await ready()
    const r = await sellCode(t, [{ code: 'Thai Tea', qty: 3 }], { method: 'PROMPTPAY' })
    t.mock.closePromotion('9f8e0000-0000-4000-8000-000000000001', '2026-09-25T02:00:00.000Z') // Thai Tea buy 2 get 1
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1, rejected: 0 })
    const o = (await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())!
    expect(o.centralAmountMismatch).toBe(true)
    expect(o.centralComputedTotalSatang).toBeGreaterThan(o.totalSatang)
    expect(o.centralOrderNo).toBe('L260925-001')
  })
  it('an answer lost on the way back: the same key is sent again and dayo answers duplicate — one bill in dayo, same order number', async () => {
    const { t } = await ready()
    await cocoa(t)
    let lose = true
    const f: typeof fetch = async (input, init) => { const res = await t.mock.fetch(input, init); if (lose) { lose = false; throw new TypeError('connection reset') } return res }
    const ctx = { db: t.db, deps: { ...t.deps, fetch: f }, serial: <T>(fn: () => Promise<T>) => fn() }
    expect((await pushOnce(ctx)).stopped).toBe('network')
    expect((await outbox(t))[0]).toMatchObject({ status: 'pending', attempts: 0 })
    await clearFailureBackoff(t.db)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
    expect(t.mock.orders()).toHaveLength(1)
    expect((await t.db.select().from(s.order).all()).map((o) => o.centralOrderNo)).toEqual(['L260925-001'])
    expect((await outbox(t))[0]).toMatchObject({ status: 'sent', attempts: 1 })
  })
  it('a row dayo deferred as UNSUPPORTED is held without a request until the supported list changes', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.override({ match: { receiptNo: 'A-000001' }, verdict: { status: 'deferred', reason: 'UNSUPPORTED', detail: 'x' }, times: 1 })
    expect(await pushOnce(ctx)).toMatchObject({ requests: 1, deferred: 1 })
    t.clock.advanceMs(3_600_000)
    expect(await pushOnce(ctx)).toMatchObject({ requests: 0, held: 1 })
    expect((await outbox(t))[0]!.attempts).toBe(0)
    t.mock.bumpCatalog((c) => { c.supported_fields.order!.push('tip') })
    const { pullCatalog } = await import('../src/sync/catalog')
    await pullCatalog(ctx)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('a parent that is dead takes its waiting void with it; retryRow brings both back', async () => {
    const { t, ctx } = await ready()
    const r = await cocoa(t)
    t.mock.override({ match: { receiptNo: 'A-000001' }, verdict: { status: 'rejected', reason: 'UNKNOWN_CODE', detail: 'x' }, times: 1 })
    expect(await pushOnce(ctx)).toMatchObject({ rejected: 1 })
    await cancel(t, r.orderId)
    expect(await pushOnce(ctx)).toMatchObject({ requests: 0 })
    const v = (await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_void')).get())!
    expect([v.status, JSON.parse(v.lastError!).reason]).toEqual(['dead', 'PARENT_REJECTED'])
    await retryRow(t.db, (await outbox(t))[0]!.id)
    expect(await pushOnce(ctx)).toMatchObject({ requests: 1, sent: 2 })
  })
  it('a bad stored base URL (a restored backup) stops the sender with no request and no backoff retry', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    await writeKey(t.db, DAYO_KEYS.baseUrl, 'http://evil.example/api/v1')
    let calls = 0
    const f: typeof fetch = async (input, init) => { calls++; return t.mock.fetch(input, init) }
    const c = { ...ctx, deps: { ...t.deps, fetch: f } }
    expect((await pushOnce(c)).stopped).toBe('bad_base_url')
    expect(await readKey(t.db, DAYO_KEYS.apiState)).toBe('bad_base_url')
    expect([await readKey(t.db, DAYO_KEYS.pushBackoffUntil), await readKey(t.db, DAYO_KEYS.pushFailStreak)]).toEqual([null, null])
    t.clock.advanceMs(3_600_000)
    expect((await pushOnce(c)).stopped).toBe('api_blocked')
    expect(calls).toBe(0)
    expect((await outbox(t))[0]).toMatchObject({ status: 'pending', attempts: 0 })
  })
  it('the API key is never written to SQLite, whatever the sender went through', async () => {
    const { t, ctx } = await ready()
    await cocoa(t); await cocoa(t)
    t.mock.override({ match: { receiptNo: 'A-000002' }, verdict: { status: 'rejected', reason: 'INVALID', detail: 'bad' }, times: 1 })
    await pushOnce(ctx)
    await cocoa(t)
    t.mock.setMode('unauthorized')
    await pushOnce(ctx)
    const tables = t.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    const dump = tables.map((x) => JSON.stringify(t.raw.prepare(`SELECT * FROM "${x.name}"`).all())).join('\n')
    expect(dump).not.toContain(MOCK_API_KEY)
    expect(dump).not.toContain(MOCK_API_KEY.slice(5, 25))
  })
})

/** A fetch that answers 422 to the first request carrying more than one row (puts the sender in R4 one-row mode). */
function refuseFirstBatch(t: Awaited<ReturnType<typeof ready>>['t']): typeof fetch {
  let refused = false
  return async (input, init) => {
    const rows = init?.method === 'POST' ? (JSON.parse(String(init.body)) as { rows: unknown[] }).rows.length : 0
    if (!refused && rows > 1) { refused = true; return new Response(JSON.stringify({ ok: false, error: { code: 'DY422', message: 'invalid' } }), { status: 422 }) }
    return t.mock.fetch(input, init)
  }
}
const withFetch = (t: Awaited<ReturnType<typeof ready>>['t'], f: typeof fetch) => ({ db: t.db, deps: { ...t.deps, fetch: f }, serial: <T>(fn: () => Promise<T>) => fn() })
const lastPushRows = (t: Awaited<ReturnType<typeof ready>>['t']) => pushRequests(t).at(-1)!.rows
const answer429 = (value: string): typeof fetch => async () => new Response(JSON.stringify({ ok: false, error: { code: 'DY429', message: 'rate_limited' } }), { status: 429, headers: { 'Retry-After': value } })
/** Waits out the whole-request backoff (and any row backoff up to 15 min) so the next call really sends. */
async function waitOut(t: Awaited<ReturnType<typeof ready>>['t']) {
  const until = await readKey(t.db, DAYO_KEYS.pushBackoffUntil)
  t.clock.advanceMs(Math.max(900_000, until === null ? 0 : Date.parse(until) - Date.parse(t.clock.now())) + 1)
}
/** Every request that carries one of these receipts fails with 500; the keys of every request are recorded. */
function poisonFetch(t: Awaited<ReturnType<typeof ready>>['t'], poison: string[], sent: string[][] = []): typeof fetch {
  return async (input, init) => {
    const body = String(init?.body ?? '')
    if (init?.method === 'POST') sent.push((JSON.parse(body) as { rows: { key: string }[] }).rows.map((r) => r.key))
    return poison.some((p) => body.includes(`"${p}"`)) ? new Response('boom', { status: 500 }) : t.mock.fetch(input, init)
  }
}
/** A new good bill straight into the queue (a copy of bill `from` with its own id, receipt and queue number). */
let seq = 0
async function queueGoodBill(t: Awaited<ReturnType<typeof ready>>['t'], from: typeof s.outbox.$inferSelect) {
  seq++
  const id = `dddddddd-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`
  const data = { ...(from.rowJson as Record<string, unknown>), pos_order_id: id, receipt_no: `G-${String(seq).padStart(6, '0')}`, queue_no: 5000 + seq }
  await t.db.insert(s.outbox).values({ id, tableName: 'order', rowJson: data, idempotencyKey: `order:${id}`, status: 'pending', createdAt: t.clock.now(), attempts: 0, lastError: null, sentAt: null, deadAt: null, nextAttemptAt: null, parentKey: null, resultJson: null })
}
const receipt = (r: typeof s.outbox.$inferSelect) => (r.rowJson as { receipt_no: string }).receipt_no
async function intoOneRowMode(t: Awaited<ReturnType<typeof ready>>['t'], ctx: Parameters<typeof pushOnce>[0]) {
  for (let i = 0; i < 3; i++) { expect((await pushOnce(ctx)).stopped).toBe('server'); await waitOut(t) }
  expect(await readKey(t.db, DAYO_KEYS.pushSingleThrough)).not.toBeNull()
}

describe('pushOnce — hardening', () => {
  describe('R4 one-row mode counts only the rows of the failed batch that are still undecided', () => {
    it('a row of that batch that got CLOCK_AHEAD does not keep one-row mode on', async () => {
      const { t } = await ready()
      for (let i = 0; i < 3; i++) await cocoa(t)
      const ctx = withFetch(t, refuseFirstBatch(t))
      t.mock.override({ match: { receiptNo: 'A-000002' }, verdict: { status: 'deferred', reason: 'CLOCK_AHEAD', detail: 'x' }, times: 5 })
      expect((await pushOnce(ctx)).stopped).toBe('bad_envelope')
      expect(JSON.parse((await readKey(t.db, DAYO_KEYS.pushSingleThrough))!).ids).toHaveLength(3)
      expect(await pushOnce(ctx)).toMatchObject({ requests: 3, sent: 2, deferred: 1 })
      expect(pushRequests(t).map((r) => r.rows)).toEqual([1, 1, 1])
      expect(await readKey(t.db, DAYO_KEYS.pushSingleThrough)).toBeNull()
      await cocoa(t); await cocoa(t)
      await pushOnce(ctx) // A-000002 still waits its 60 s; the two new bills go together
      expect(lastPushRows(t)).toBe(2)
    })
    it('a row of that batch that became held (dayo stopped listing a field it uses) does not keep one-row mode on', async () => {
      const { t } = await ready()
      const ctx = withFetch(t, refuseFirstBatch(t))
      const { pullCatalog } = await import('../src/sync/catalog')
      t.mock.bumpCatalog((c) => { c.supported_fields.order!.push('tip') })
      await pullCatalog(ctx)
      for (let i = 0; i < 3; i++) await cocoa(t)
      const head = (await outbox(t))[0]!
      await t.db.update(s.outbox).set({ rowJson: { ...(head.rowJson as Record<string, unknown>), tip: 5 } }).where(eq(s.outbox.id, head.id))
      expect((await pushOnce(ctx)).stopped).toBe('bad_envelope')
      t.mock.bumpCatalog((c) => { c.supported_fields.order = c.supported_fields.order!.filter((f) => f !== 'tip') })
      await pullCatalog(ctx)
      expect(await pushOnce(ctx)).toMatchObject({ sent: 2, held: 1 })
      expect(await readKey(t.db, DAYO_KEYS.pushSingleThrough)).toBeNull()
      await cocoa(t); await cocoa(t)
      await pushOnce(ctx)
      expect(lastPushRows(t)).toBe(2)
    })
    it('an old-format or unreadable mark is dropped', async () => {
      const { t, ctx } = await ready()
      await cocoa(t); await cocoa(t)
      await writeKey(t.db, DAYO_KEYS.pushSingleThrough, JSON.stringify({ createdAt: '2026-09-25T03:00:00.000Z', rid: 99 }))
      await pushOnce(ctx)
      expect(pushRequests(t).map((r) => r.rows)).toEqual([2])
      expect(await readKey(t.db, DAYO_KEYS.pushSingleThrough)).toBeNull()
    })
  })

  describe('Retry-After and a stored backoff are bounded', () => {
    it.each(['1e9', '1e20'])('Retry-After %s waits at most 15 minutes', async (value) => {
      const { t } = await ready()
      await cocoa(t)
      expect((await pushOnce(withFetch(t, answer429(value)))).stopped).toBe('rate_limited')
      const until = (await readKey(t.db, DAYO_KEYS.pushBackoffUntil))!
      expect(Date.parse(until) - Date.parse(t.clock.now())).toBe(900_000)
      t.clock.advanceMs(900_000)
      expect(await pushOnce({ db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() })).toMatchObject({ sent: 1 })
    })
    it.each(['garbage', '9999-12-31T00:00:00.000Z', '+275760-09-13T00:00:00.000Z'])('a stored backoff %s is not trusted: the default 60 s applies', async (stored) => {
      const { t, ctx } = await ready()
      await cocoa(t)
      await writeKey(t.db, DAYO_KEYS.pushBackoffUntil, stored)
      expect((await pushOnce(ctx)).stopped).toBe('backoff')
      expect(await readKey(t.db, DAYO_KEYS.pushBackoffUntil)).toBe('2026-09-25T03:01:00.000Z')
      t.clock.advanceMs(60_000)
      expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
    })
  })

  describe('one row cannot stall the queue', () => {
    it('when every row fails in one-row mode the whole-request backoff still holds', async () => {
      const { t, ctx } = await ready()
      for (let i = 0; i < 3; i++) await cocoa(t)
      t.mock.setMode('server_down')
      for (let i = 0; i < 3; i++) { await pushOnce(ctx); t.clock.advanceMs(900_000) }
      expect(await pushOnce(ctx)).toMatchObject({ requests: 3, sent: 0, stopped: 'server' })
      expect((await outbox(t)).map((r) => r.attempts)).toEqual([0, 0, 0]) // fix rounds 2–3: K = 3 failures in a row = dayo is down, every provisional charge is refunded
      expect((await pushOnce(ctx)).stopped).toBe('backoff')
    })
    it('network failures do not count toward the 5xx streak that starts one-row mode (m3)', async () => {
      const { t } = await ready()
      for (let i = 0; i < 3; i++) await cocoa(t)
      let n = 0
      const f: typeof fetch = async (input, init) => { n++; if (n === 1 || n === 4) return new Response('boom', { status: 500 }); if (n <= 3) throw new TypeError('Failed to fetch'); return t.mock.fetch(input, init) }
      const ctx = withFetch(t, f)
      for (let i = 0; i < 4; i++) { await pushOnce(ctx); t.clock.advanceMs(900_000) }
      expect(await readKey(t.db, DAYO_KEYS.pushSingleThrough)).toBeNull()
      expect(await pushOnce(ctx)).toMatchObject({ requests: 1, sent: 3 })
    })
  })

  describe('dayo answers are bounded and never undo a refusal', () => {
    it('a 200 does not undo a refused key recorded meanwhile (M4)', async () => {
      const { t } = await ready()
      await cocoa(t)
      const f: typeof fetch = async (input, init) => { const r = await t.mock.fetch(input, init); await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized'); return r }
      expect(await pushOnce(withFetch(t, f))).toMatchObject({ sent: 1 })
      expect(await readKey(t.db, DAYO_KEYS.apiState)).toBe('unauthorized')
    })
    it('ten answers in a row without a verdict raise an owner-visible warning; the row stays pending (M5)', async () => {
      const { t } = await ready()
      await cocoa(t)
      const ctx = withFetch(t, rewriting(t, (rs) => { rs.length = 0 }))
      for (let i = 1; i <= 10; i++) {
        await pushOnce(ctx)
        const row = (await outbox(t))[0]!
        expect(row).toMatchObject({ status: 'pending', attempts: 0 })
        expect(JSON.parse(row.lastError!)).toMatchObject({ reason: i < 10 ? 'NO_ANSWER' : 'NO_VERDICT_REPEATED', noVerdict: i })
        t.clock.advanceMs(60_000)
      }
    })
    it('a void whose bill is not on this tablet spends a try on PARENT_PENDING (M5)', async () => {
      const { t, ctx } = await ready()
      const ghost = 'bbbbbbbb-0000-4000-8000-000000000001'
      await t.db.insert(s.outbox).values({ id: 'cccccccc-0000-4000-8000-000000000001', tableName: 'order_void', rowJson: { pos_order_id: ghost, voided_at: '2026-09-25T03:00:00.000Z', staff_id: STAFF.TungAo, approved_by: STAFF.DCm, reason: 'x' }, idempotencyKey: `order_void:${ghost}`, status: 'pending', createdAt: '2026-09-25T03:00:00.000Z', attempts: 0, lastError: null, sentAt: null, deadAt: null, nextAttemptAt: null, parentKey: `order:${ghost}`, resultJson: null })
      expect(await pushOnce(ctx)).toMatchObject({ deferred: 1 })
      const row = (await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_void')).get())!
      expect(row).toMatchObject({ status: 'pending', attempts: 1, nextAttemptAt: '2026-09-25T03:00:05.000Z' })
    })
    it('order_no, duplicate_of and result_json are bounded and keep only known fields (M6)', async () => {
      const { t } = await ready()
      const r = await cocoa(t)
      const ctx = withFetch(t, rewriting(t, (rs) => {
        const d = (rs[0] as unknown as { data: Record<string, unknown> }).data
        Object.assign(d, { order_no: 'ล'.repeat(300), duplicate_of: Array.from({ length: 50 }, (_, i) => `B-${i}`), warnings: Array.from({ length: 50 }, () => 'w'.repeat(500)), evil: 'x'.repeat(10_000) })
      }))
      expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
      const o = (await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())!
      expect([...o.centralOrderNo!]).toHaveLength(100)
      expect(o.centralDuplicateOfJson).toHaveLength(20)
      const stored = (await outbox(t))[0]!.resultJson as Record<string, unknown>
      expect(Object.keys(stored).sort()).toEqual(['amount_mismatch', 'computed_total', 'duplicate_of', 'order_no', 'version', 'warnings'])
      expect(stored['warnings']).toHaveLength(20)
      expect([...(stored['warnings'] as string[])[0]!]).toHaveLength(200)
    })
  })
})

describe('pushOnce — a failed row is charged only when dayo shows it is up', () => {
  it('a dayo outage in one-row mode never spends a good row\'s tries, and the whole-request backoff holds every time', async () => {
    const { t, ctx } = await ready()
    for (let i = 0; i < 5; i++) await cocoa(t)
    t.mock.setMode('server_down')
    for (let i = 0; i < 3; i++) { await pushOnce(ctx); await waitOut(t) } // three 5xx → one-row mode
    expect(await readKey(t.db, DAYO_KEYS.pushSingleThrough)).not.toBeNull()
    for (let call = 0; call < 30; call++) {
      expect(await pushOnce(ctx)).toMatchObject({ requests: 3, sent: 0, stopped: 'server' })
      expect((await outbox(t)).map((r) => [r.status, r.attempts])).toEqual(Array.from({ length: 5 }, () => ['pending', 0]))
      expect(Date.parse((await readKey(t.db, DAYO_KEYS.pushBackoffUntil))!)).toBeGreaterThan(Date.parse(t.clock.now()))
      expect((await pushOnce(ctx)).stopped).toBe('backoff')
      await waitOut(t)
    }
    t.mock.setMode('normal')
    expect(await pushOnce(ctx)).toMatchObject({ sent: 5 })
  })
  it('a network failure right after a provisional charge refunds it too (nothing shows the row was the cause)', async () => {
    const { t } = await ready()
    for (let i = 0; i < 3; i++) await cocoa(t)
    let n = 0
    const f: typeof fetch = async (input, init) => { n++; if (n <= 4) return new Response('boom', { status: 500 }); if (n === 5) throw new TypeError('Failed to fetch'); return t.mock.fetch(input, init) }
    const ctx = withFetch(t, f)
    for (let i = 0; i < 3; i++) { await pushOnce(ctx); await waitOut(t) }
    expect(await pushOnce(ctx)).toMatchObject({ requests: 2, stopped: 'network' })
    expect((await outbox(t)).map((r) => r.attempts)).toEqual([0, 0, 0])
  })
  it('a poison row followed by good rows: the good rows are sent, and while the shop keeps selling the poison row reaches STUCK at 50', async () => {
    const { t } = await ready()
    for (let i = 0; i < 4; i++) await cocoa(t)
    const ctx = withFetch(t, poisonFetch(t, ['A-000001']))
    await intoOneRowMode(t, ctx)
    expect(await pushOnce(ctx)).toMatchObject({ requests: 4, sent: 3 }) // the poison's charge is confirmed by the next row's 200
    expect((await outbox(t)).map((r) => [r.status, r.attempts])).toEqual([['pending', 1], ['sent', 1], ['sent', 1], ['sent', 1]])
    const template = (await outbox(t))[1]!
    for (let i = 0; i < 60 && (await outbox(t))[0]!.status === 'pending'; i++) { await waitOut(t); await queueGoodBill(t, template); await pushOnce(ctx) }
    const [poison] = await outbox(t)
    expect(poison).toMatchObject({ status: 'dead', attempts: 50 })
    expect(JSON.parse(poison!.lastError!).reason).toBe('STUCK')
  })
  it('a poison row left alone is not charged — nothing since its failures began shows dayo is up — until a good row follows it', async () => {
    const { t } = await ready()
    await cocoa(t); await cocoa(t)
    const ctx = withFetch(t, poisonFetch(t, ['A-000001']))
    await intoOneRowMode(t, ctx)
    await pushOnce(ctx) // poison charged (1), confirmed by A-000002's 200
    expect((await outbox(t)).map((r) => [r.status, r.attempts])).toEqual([['pending', 1], ['sent', 1]])
    for (let i = 0; i < 3; i++) {
      await waitOut(t)
      expect(await pushOnce(ctx)).toMatchObject({ requests: 1, stopped: 'server' })
      expect((await outbox(t))[0]).toMatchObject({ status: 'pending', attempts: 1 }) // refunded: the queue ran out before K
      expect(Date.parse((await readKey(t.db, DAYO_KEYS.pushBackoffUntil))!)).toBeGreaterThan(Date.parse(t.clock.now())) // the backoff holds
    }
    await waitOut(t)
    await queueGoodBill(t, (await outbox(t))[1]!)
    expect(await pushOnce(ctx)).toMatchObject({ requests: 2, sent: 1 })
    expect((await outbox(t))[0]).toMatchObject({ status: 'pending', attempts: 2 })
  })
  it('dayo down for hours with two rows in one-row mode: no charge is ever kept, yet each row\'s OWN 50th failure ends it STUCK (fix round 2 ruling)', async () => {
    const { t, ctx } = await ready()
    await cocoa(t); await cocoa(t)
    t.mock.setMode('server_down')
    await intoOneRowMode(t, ctx) // batch requests: no row's own failure yet
    for (let call = 1; call < STUCK_AFTER_ATTEMPTS; call++) {
      expect(await pushOnce(ctx)).toMatchObject({ requests: 2, sent: 0, stopped: 'server' })
      expect((await outbox(t)).map((r) => [r.status, r.attempts])).toEqual([['pending', 0], ['pending', 0]]) // refunded every time (Path A)
      await waitOut(t)
    }
    await pushOnce(ctx)
    const rows = await outbox(t)
    expect(rows.map((r) => [r.status, JSON.parse(r.lastError!).reason])).toEqual([['dead', 'STUCK'], ['dead', 'STUCK']])
    t.mock.setMode('normal') // the owner's "ลองใหม่" sends them once dayo is back
    for (const r of rows) await retryRow(t.db, r.id)
    await waitOut(t)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 2 })
  })
  it('a lone row failing every call reaches STUCK after 50 of its own failures with no other bill ever arriving — no neighbour\'s 200 needed (fix round 2 ruling)', async () => {
    const { t } = await ready()
    await cocoa(t)
    const ctx = withFetch(t, poisonFetch(t, ['A-000001']))
    for (let call = 1; call < STUCK_AFTER_ATTEMPTS; call++) {
      expect(await pushOnce(ctx)).toMatchObject({ requests: 1, stopped: 'server' })
      const row = (await outbox(t))[0]!
      expect(row).toMatchObject({ status: 'pending', attempts: 0 }) // never charged: nothing confirmed a charge
      expect(JSON.parse(row.lastError!)).toMatchObject({ ownFailures: call, requestFailed: true })
      await waitOut(t)
    }
    await pushOnce(ctx)
    const dead = (await outbox(t))[0]!
    expect(dead).toMatchObject({ status: 'dead', attempts: STUCK_AFTER_ATTEMPTS })
    expect(JSON.parse(dead.lastError!).reason).toBe('STUCK')
    expect(await countSyncProblems(t.db)).toBe(1) // on the "ส่งไม่ผ่าน" page
    await retryRow(t.db, dead.id) // "ลองใหม่" starts its own count again
    await waitOut(t)
    await pushOnce(ctx)
    const again = (await outbox(t))[0]!
    expect(again.status).toBe('pending')
    expect(JSON.parse(again.lastError!)).toMatchObject({ ownFailures: 1 })
  })
  it('a charge and its refund keep the farAhead flag and the noVerdict count (the owner banner and M5 survive)', async () => {
    const { t, ctx } = await ready()
    for (let i = 0; i < 3; i++) await cocoa(t)
    t.mock.setMode('server_down')
    await intoOneRowMode(t, ctx)
    const head = (await outbox(t))[0]!
    await t.db.update(s.outbox).set({ lastError: encodeLastError('CLOCK_AHEAD', 'เวลาในแถวล้ำระบบกลางเกิน 24 ชม.', { farAhead: true, noVerdict: 4 }) }).where(eq(s.outbox.id, head.id))
    const seen: { attempts: number; lastError: unknown }[] = []
    const f: typeof fetch = async (input, init) => {
      const r = (await t.db.select().from(s.outbox).where(eq(s.outbox.id, head.id)).get())!
      seen.push({ attempts: r.attempts, lastError: JSON.parse(r.lastError!) })
      return t.mock.fetch(input, init)
    }
    expect(await pushOnce(withFetch(t, f))).toMatchObject({ requests: 3, stopped: 'server' })
    expect(seen[1]).toEqual({ attempts: 1, lastError: expect.objectContaining({ reason: REQUEST_FAILED, farAhead: true, noVerdict: 4, requestFailed: true }) }) // charged
    const after = (await outbox(t))[0]!
    expect(after.attempts).toBe(0) // refunded: K failures in a row
    expect(JSON.parse(after.lastError!)).toMatchObject({ farAhead: true, noVerdict: 4, requestFailed: true })
    expect((await t.api.bootstrap()).sync.clockFarAheadBills).toBe(1)
  })
  it('a row refunded by an older build (REQUEST_FAILED, no flag) is not taken as a trusted probe (fix round 1 item 9)', async () => {
    const { t } = await ready()
    for (let i = 0; i < 3; i++) await cocoa(t)
    const sent: string[][] = []
    const ctx = withFetch(t, poisonFetch(t, ['A-000001'], sent))
    await intoOneRowMode(t, ctx)
    const [poison, legacy, fresh] = await outbox(t)
    await t.db.update(s.outbox).set({ lastError: JSON.stringify({ reason: REQUEST_FAILED, detail: 'HTTP 500' }) }).where(eq(s.outbox.id, legacy!.id))
    const before = sent.length
    await pushOnce(ctx)
    expect(sent.slice(before, before + 2)).toEqual([[poison!.idempotencyKey], [fresh!.idempotencyKey]]) // the probe skips the legacy row
  })
  it('a row\'s own failures count at most once per 5 minutes, however often the backoff is cleared (final review I2)', async () => {
    const { t } = await ready()
    await cocoa(t)
    const ctx = withFetch(t, poisonFetch(t, ['A-000001']))
    const own = async () => JSON.parse((await outbox(t))[0]!.lastError!).ownFailures as number
    await pushOnce(ctx)
    expect(await own()).toBe(1)
    for (let i = 0; i < 10; i++) { // "ส่งตอนนี้" / reopening the app over and over: every press clears the backoff
      t.clock.advanceMs(20_000)
      await clearFailureBackoff(t.db)
      expect(await pushOnce(ctx)).toMatchObject({ requests: 1, stopped: 'server' })
    }
    expect(await own()).toBe(1) // 200 s of failures = still one
    t.clock.advanceMs(100_000) // 5 minutes since the counted one
    await clearFailureBackoff(t.db)
    await pushOnce(ctx)
    expect(await own()).toBe(2)
  })
  describe('only the row\'s own kind of failure counts, and any verdict from dayo starts the count again (final review M2)', () => {
    const withOwn = async (t: Awaited<ReturnType<typeof ready>>['t'], n: number) => {
      const row = (await outbox(t))[0]!
      await t.db.update(s.outbox).set({ lastError: encodeLastError(REQUEST_FAILED, 'HTTP 500', { requestFailed: true, ownFailures: n, ownFailedAt: '2026-09-25T02:00:00.000Z' }) }).where(eq(s.outbox.id, row.id))
    }
    const dayoError = (status: number, code: string): typeof fetch => async () => new Response(JSON.stringify({ ok: false, error: { code, message: 'x' } }), { status })
    it.each([
      ['offline', (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch, 'network'],
      ['429', answer429('30'), 'rate_limited'],
      ['401', dayoError(401, 'DY401'), 'unauthorized'],
      ['404', dayoError(404, 'DY404'), 'api_disabled'],
    ] as const)('a solo row that meets %s keeps its own count', async (_, f, stopped) => {
      const { t } = await ready()
      await cocoa(t)
      await withOwn(t, 3)
      expect((await pushOnce(withFetch(t, f))).stopped).toBe(stopped)
      expect(JSON.parse((await outbox(t))[0]!.lastError!)).toMatchObject({ ownFailures: 3 })
    })
    it('a deferred verdict clears it', async () => {
      const { t, ctx } = await ready()
      const r = await cocoa(t)
      await withOwn(t, 3)
      t.mock.override({ match: { receiptNo: r.receiptNo }, verdict: { status: 'deferred', reason: 'SERVER_ERROR', detail: 'x' }, times: 1 })
      expect(await pushOnce(ctx)).toMatchObject({ deferred: 1 })
      expect(JSON.parse((await outbox(t))[0]!.lastError!).ownFailures).toBeUndefined()
    })
    it('an answer with no verdict for it clears it', async () => {
      const { t } = await ready()
      await cocoa(t)
      await withOwn(t, 3)
      expect(await pushOnce(withFetch(t, rewriting(t, (rs) => { rs.length = 0 })))).toMatchObject({ noAnswer: 1 })
      expect(JSON.parse((await outbox(t))[0]!.lastError!).ownFailures).toBeUndefined()
    })
  })
})

describe('pushOnce — good rows pass a run of failing rows', () => {
  it('2 poison rows at the head, then good rows: the good rows reach dayo, and while the shop keeps selling both poison rows end STUCK', async () => {
    const { t } = await ready()
    for (let i = 0; i < 5; i++) await cocoa(t)
    const ctx = withFetch(t, poisonFetch(t, ['A-000001', 'A-000002']))
    await intoOneRowMode(t, ctx)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 3 })
    expect(t.mock.orders().map((o) => o.receiptNo).sort()).toEqual(['A-000003', 'A-000004', 'A-000005'])
    const template = (await outbox(t))[2]!
    for (let i = 0; i < 200 && (await outbox(t)).slice(0, 2).some((r) => r.status === 'pending'); i++) { await waitOut(t); await queueGoodBill(t, template); await pushOnce(ctx) } // the shop keeps selling
    const rows = await outbox(t)
    expect(rows.slice(0, 2).map((r) => [r.status, r.attempts, JSON.parse(r.lastError!).reason])).toEqual([['dead', 50, 'STUCK'], ['dead', 50, 'STUCK']])
  })
  it('5 poison rows at the head (more than K): the good rows still reach dayo, and while the shop keeps selling the poison rows end STUCK', async () => {
    const { t } = await ready()
    for (let i = 0; i < 8; i++) await cocoa(t)
    const poison = ['A-000001', 'A-000002', 'A-000003', 'A-000004', 'A-000005']
    const sent: string[][] = []
    const ctx = withFetch(t, poisonFetch(t, poison, sent))
    await intoOneRowMode(t, ctx)
    for (let i = 0; i < 3 && t.mock.orders().length < 3; i++) { await pushOnce(ctx); await waitOut(t) }
    expect(t.mock.orders().map((o) => o.receiptNo).sort()).toEqual(['A-000006', 'A-000007', 'A-000008'])
    const template = (await outbox(t)).find((r) => receipt(r) === 'A-000006')!
    let calls = 0
    for (; calls < 200 && (await outbox(t)).some((r) => poison.includes(receipt(r)) && r.status === 'pending'); calls++) {
      for (let k = 0; k < 5; k++) await queueGoodBill(t, template) // the shop keeps selling
      const before = sent.length
      await pushOnce(ctx)
      expect(sent.slice(before).filter((keys) => keys.length === 1).length).toBeGreaterThan(0)
      await waitOut(t)
    }
    const rows = await outbox(t)
    expect(rows.filter((r) => poison.includes(receipt(r))).map((r) => [r.status, r.attempts])).toEqual(poison.map(() => ['dead', 50]))
    expect(rows.filter((r) => !poison.includes(receipt(r))).every((r) => r.status === 'sent')).toBe(true)
  })
  it('a real outage: no row\'s attempts ever rises, at most K = 3 requests per call, every row is tried in turn, all are sent once dayo is back', async () => {
    const { t } = await ready()
    for (let i = 0; i < 7; i++) await cocoa(t)
    const tried = new Set<string>()
    let down = true
    const f: typeof fetch = async (input, init) => {
      if (init?.method === 'POST') for (const r of (JSON.parse(String(init.body)) as { rows: { key: string }[] }).rows) tried.add(r.key)
      return down ? new Response('boom', { status: 503 }) : t.mock.fetch(input, init)
    }
    const ctx = withFetch(t, f)
    await intoOneRowMode(t, ctx)
    tried.clear()
    for (let call = 0; call < 20; call++) {
      const o = await pushOnce(ctx)
      expect(o.requests).toBeLessThanOrEqual(3)
      expect((await outbox(t)).every((r) => r.status === 'pending' && r.attempts === 0)).toBe(true)
      expect((await pushOnce(ctx)).stopped).toBe('backoff')
      await waitOut(t)
    }
    expect(tried.size).toBe(7) // rotation: the three that failed go to the back, the next call starts at other rows
    down = false
    for (let i = 0; i < 3 && (await outbox(t)).some((r) => r.status === 'pending'); i++) { await pushOnce(ctx); await waitOut(t) }
    expect((await outbox(t)).map((r) => r.status)).toEqual(Array.from({ length: 7 }, () => 'sent'))
  })
  it('a charge that made a row STUCK is undone when the next rows fail too (m2: the refund matches that death only)', async () => {
    const { t } = await ready()
    for (let i = 0; i < 3; i++) await cocoa(t)
    t.mock.setMode('server_down')
    await intoOneRowMode(t, { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() })
    const first = (await outbox(t))[0]!
    await t.db.update(s.outbox).set({ attempts: 49 }).where(eq(s.outbox.id, first.id))
    await pushOnce({ db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() })
    expect((await outbox(t))[0]).toMatchObject({ status: 'pending', attempts: 49, deadAt: null })
  })
  it('a timeout is not offline: it counts toward one-row mode and is charged to the row (m1)', async () => {
    const { t } = await ready()
    for (let i = 0; i < 3; i++) await cocoa(t)
    const f: typeof fetch = (input, init) => (String(init?.body ?? '').includes('"A-000001"')
      ? new Promise<Response>((_, reject) => { init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)) })
      : t.mock.fetch(input, init))
    const ctx = withFetch(t, f)
    vi.useFakeTimers()
    try {
      const run = async () => { let done = false; const p = pushOnce(ctx).finally(() => { done = true }); for (let i = 0; i < 200 && !done; i++) await vi.advanceTimersByTimeAsync(1_000); return p }
      for (let i = 0; i < 3; i++) { expect((await run()).stopped).toBe('timeout'); await waitOut(t) }
      expect(await readKey(t.db, DAYO_KEYS.pushServerStreak)).toBe('3')
      expect(await readKey(t.db, DAYO_KEYS.pushSingleThrough)).not.toBeNull()
      expect(await run()).toMatchObject({ sent: 2 })
      expect((await outbox(t)).map((r) => [r.status, r.attempts])).toEqual([['pending', 1], ['sent', 1], ['sent', 1]])
    } finally {
      vi.useRealTimers()
    }
  })
  it('an offline network error stays neutral: no streak, no charge', async () => {
    const { t } = await ready()
    for (let i = 0; i < 3; i++) await cocoa(t)
    const ctx = withFetch(t, async () => { throw new TypeError('Failed to fetch') })
    for (let i = 0; i < 5; i++) { expect((await pushOnce(ctx)).stopped).toBe('network'); await waitOut(t) }
    expect(await readKey(t.db, DAYO_KEYS.pushServerStreak)).toBeNull()
    expect((await outbox(t)).map((r) => r.attempts)).toEqual([0, 0, 0])
  })
})
