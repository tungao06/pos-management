import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { MOCK_API_KEY } from '@dayo/dayo-mock'
import { createPosApi, SETUP_CALLS_PER_MIN } from '../src/api/pos-api'
import { createSyncScheduler, FOLLOW_UP_GAP_MS, MANUAL_CLEAR_GAP_MS, SYNC_BUDGET_PER_MIN } from '../src/sync/scheduler'
import { pushOnce } from '../src/sync/push'
import { DAYO_KEYS, readKey, writeKey } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

afterEach(() => { vi.useRealTimers() })
const pushes = (t: Awaited<ReturnType<typeof openConnectedApi>>) => t.mock.requests().filter((r) => r.path === '/api/v1/pos/push').length

describe('sync scheduler (spec 04 §6.2)', () => {
  it('a save wakes the sender 2 seconds later, several saves wake it once', async () => {
    const t = await openConnectedApi()
    vi.useFakeTimers()
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }); sch.kick('write')
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }); sch.kick('write')
    await vi.advanceTimersByTimeAsync(1_999)
    expect(pushes(t)).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(pushes(t)).toBe(1))
  })
  it('pulls the catalog on open and then exactly every 5 minutes (review item 21 — the test clock moves with the timers)', async () => {
    const t = await openConnectedApi()
    vi.useFakeTimers()
    const catalogCalls = () => t.mock.requests().filter((r) => r.path === '/api/v1/pos/catalog').length
    const base = catalogCalls() // connectShop's own call
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    sch.start()
    await vi.waitFor(() => expect(catalogCalls()).toBe(base + 1)) // 'open'
    for (let minute = 1; minute <= 4; minute++) { t.clock.advanceMs(60_000); await vi.advanceTimersByTimeAsync(60_000) }
    expect(catalogCalls()).toBe(base + 1) // 4 ticks, not due yet
    t.clock.advanceMs(60_000); await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(catalogCalls()).toBe(base + 2)) // 5-minute mark
    sch.stop()
  })
  it('an online wake sends at once even after network failures built up a multi-minute backoff (review item 2, N4)', async () => {
    const t = await openConnectedApi()
    let online = false
    const f: typeof fetch = async (input, init) => { if (!online) throw new TypeError('Failed to fetch'); return t.mock.fetch(input, init) }
    const ctx = { db: t.db, deps: { ...t.deps, fetch: f }, serial: <T>(fn: () => Promise<T>) => fn() }
    for (let i = 0; i < 5; i++) await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    for (let i = 1; i <= 4; i++) { // fail 4 times, waiting out each backoff (a manual runNow would clear it — so call pushOnce directly)
      const until = await readKey(t.db, DAYO_KEYS.pushBackoffUntil)
      if (until !== null) t.clock.advanceMs(Math.max(0, Date.parse(until) - Date.parse(t.clock.now())) + 1)
      await pushOnce(ctx)
    }
    expect(await readKey(t.db, DAYO_KEYS.pushFailStreak)).toBe('4')
    expect(Date.parse((await readKey(t.db, DAYO_KEYS.pushBackoffUntil))!) - Date.parse(t.clock.now())).toBeGreaterThanOrEqual(240_000)
    const sch = createSyncScheduler(ctx)
    online = true
    sch.kick('online')
    await vi.waitFor(() => expect(t.mock.orders()).toHaveLength(5))
  })
  it('"ส่งตอนนี้" clears the failure backoff at most once per 30 s (ruling N4)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setMode('server_down')
    // fix round 1 item 5: the 30 s window runs on a monotonic clock; here it moves with the test clock
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), monoMs: () => Date.parse(t.clock.now()) })
    await pushOnce({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    expect(pushes(t)).toBe(1)                // 5xx → a failure backoff to clear
    await sch.runNow()
    expect(pushes(t)).toBe(2)                // cleared, tried, 5xx → backoff again
    t.clock.advanceMs(1_000)
    await sch.runNow()
    expect(pushes(t)).toBe(2)                // pressed again 1 s later: the backoff holds, dayo is not hit
    t.clock.advanceMs(MANUAL_CLEAR_GAP_MS)
    await sch.runNow()
    expect(pushes(t)).toBe(3)                // 30 s after the last clear it may clear again
  })
  it('online wakes it at once; a second wake during a cycle runs one more cycle, never two in parallel', async () => {
    const t = await openConnectedApi()
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const a = sch.runNow()
    const b = sch.runNow()
    await Promise.all([a, b])
    expect(pushes(t)).toBe(1)
    sch.stop()
  })
  it('skips the cycle when another tab holds the dayo-push lock', async () => {
    const t = await openConnectedApi()
    const locks = { request: async (_n: string, _o: { ifAvailable: true }, cb: (lock: unknown) => Promise<void>) => cb(null) } // null = not available
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), locks })
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await sch.runNow()
    expect(pushes(t)).toBe(0)
  })
  it('a sale is not blocked while syncNow waits on a hung request', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setMode('hang')
    const sync = t.api.syncNow()
    const started = Date.now()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }) // same PosApi = same serial queue
    expect(Date.now() - started).toBeLessThan(2_000)
    void sync.catch(() => undefined)
  })
})

describe('sync scheduler — one call at a time, paced under dayo\'s 60 requests/min', () => {
  /** `n` more good bills straight into the queue: copies of the first queued bill with their own id, receipt and queue number. */
  async function queueCopies(t: Awaited<ReturnType<typeof openConnectedApi>>, n: number) {
    const from = (await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order')).get())!
    for (let i = 1; i <= n; i++) {
      const id = `eeeeeeee-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
      const data = { ...(from.rowJson as Record<string, unknown>), pos_order_id: id, receipt_no: `G-${String(i).padStart(6, '0')}`, queue_no: 1000 + i }
      await t.db.insert(s.outbox).values({ id, tableName: 'order', rowJson: data, idempotencyKey: `order:${id}`, status: 'pending', createdAt: t.clock.now(), attempts: 0, lastError: null, sentAt: null, deadAt: null, nextAttemptAt: null, parentKey: null, resultJson: null })
    }
  }

  it('a wake during a cycle runs ONE follow-up cycle, a gap after the first ended — never back-to-back, never two at once', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    vi.useFakeTimers()
    let inFlight = 0
    let maxInFlight = 0
    const calls: { path: string; start: number; end: number }[] = []
    const slow: typeof fetch = async (input, init) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      const start = Date.now()
      try {
        await new Promise((r) => setTimeout(r, 3_000)) // every answer takes 3 s
        return await t.mock.fetch(input, init)
      } finally {
        inFlight--
        calls.push({ path: new URL(String(input)).pathname, start, end: Date.now() })
      }
    }
    const sch = createSyncScheduler({ db: t.db, deps: { ...t.deps, fetch: slow }, serial: (fn) => fn() })
    sch.kick('online')                                                // cycle 1: the catalog is not due — one push
    await vi.advanceTimersByTimeAsync(1_000)
    sch.kick('online'); void sch.runNow(); sch.kick('before_shift')   // three wakes while cycle 1 is on the wire
    await vi.advanceTimersByTimeAsync(60_000)
    sch.stop()
    expect(maxInFlight).toBe(1)
    // ONE follow-up for the three wakes: it pulls the catalog (manual / before_shift) and finds nothing left to push
    expect(calls.map((c) => c.path)).toEqual(['/api/v1/pos/push', '/api/v1/pos/catalog'])
    expect(calls[1]!.start - calls[0]!.end).toBeGreaterThanOrEqual(FOLLOW_UP_GAP_MS)
    expect(t.mock.orders()).toHaveLength(1)
  })

  it('a long queue drains while E1 + E2 stay under the budget in every 60 s, however often it is woken', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await queueCopies(t, 799) // 800 bills = 40 requests of 20
    vi.useFakeTimers()
    const at: number[] = []
    const counted: typeof fetch = async (input, init) => { at.push(Date.now()); return t.mock.fetch(input, init) }
    const sch = createSyncScheduler({ db: t.db, deps: { ...t.deps, fetch: counted }, serial: (fn) => fn() })
    sch.start()
    for (let sec = 0; sec < 240; sec++) {                            // woken every second, pressed every second
      sch.kick('online'); sch.kick('write'); void sch.runNow().catch(() => undefined)
      await vi.advanceTimersByTimeAsync(1_000)
    }
    sch.stop()
    expect(t.mock.orders()).toHaveLength(800)
    const worst = Math.max(...at.map((a) => at.filter((b) => b >= a && b < a + 60_000).length))
    expect(worst).toBeLessThanOrEqual(SYNC_BUDGET_PER_MIN)
    expect(SYNC_BUDGET_PER_MIN).toBeLessThan(60) // headroom for E3 (Task 15) under dayo's limit
  })

  it('the PosApi scheduler reads and writes through the PosApi\'s own serial queue (no TOCTOU between a PIN check and a catalog write)', async () => {
    const t = await openConnectedApi()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const api = createPosApi(t.db, { ...t.deps, exportDbFile: async () => { await gate; return t.deps.exportDbFile() } })
    t.mock.bumpCatalog()
    const version = async () => (await t.db.select({ v: s.dayoCatalog.catalogVersion }).from(s.dayoCatalog).get())?.v
    const before = await version()
    const backup = api.exportBackup(STAFF.TungAo) // holds the queue (as a PIN check followed by its write would)
    let synced = false
    const sync = api.syncNow().then(() => { synced = true })
    await new Promise((r) => setTimeout(r, 100))
    expect(synced).toBe(false)
    expect(await version()).toBe(before) // nothing written while the queue is held
    release()
    await backup
    await sync
    expect(await version()).toBe(before! + 1)
  })
})

describe('sync scheduler — backoffs a wake cannot skip (fix round 1)', () => {
  const catalogCalls = (t: Awaited<ReturnType<typeof openConnectedApi>>) => t.mock.requests().filter((r) => r.path === '/api/v1/pos/catalog').length
  const failureBackoff = async (t: Awaited<ReturnType<typeof openConnectedApi>>, reason: string) => {
    await writeKey(t.db, DAYO_KEYS.pushBackoffUntil, new Date(Date.parse(t.clock.now()) + 300_000).toISOString())
    await writeKey(t.db, DAYO_KEYS.pushBackoffReason, reason)
  }

  it('a failed E1 is not retried by the minute tick before 5 minutes after that ATTEMPT (item 3)', async () => {
    const t = await openConnectedApi()
    vi.useFakeTimers()
    t.mock.setMode('server_down')
    t.clock.advanceMs(180_000) // the last GOOD pull (connectShop) is 3 minutes old when the app opens
    const base = catalogCalls(t)
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    sch.start()
    await vi.waitFor(() => expect(catalogCalls(t)).toBe(base + 1)) // 'open' — 500
    for (let minute = 1; minute <= 4; minute++) { t.clock.advanceMs(60_000); await vi.advanceTimersByTimeAsync(60_000) }
    expect(catalogCalls(t)).toBe(base + 1)
    t.clock.advanceMs(60_000); await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(catalogCalls(t)).toBe(base + 2))
    sch.stop()
  })
  it('"ส่งตอนนี้" does not get past a 429 Retry-After, for E1 or E2 (item 3)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setMode('rate_limited') // Retry-After: 30
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), monoMs: () => Date.parse(t.clock.now()) })
    await sch.runNow()
    const n = t.mock.requests().length // E1 answered 429: the push waits too
    expect(pushes(t)).toBe(0)
    t.mock.setMode('normal')
    for (let i = 0; i < 2; i++) { t.clock.advanceMs(14_000); await sch.runNow() }
    expect(t.mock.requests().length).toBe(n)
    t.clock.advanceMs(2_000)
    await sch.runNow()
    expect(pushes(t)).toBe(1)
  })
  it('"online" forgets only a backoff that a lost network caused, never a 5xx one (item 4)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    await failureBackoff(t, 'failure')
    sch.kick('online')
    await new Promise((r) => setTimeout(r, 100))
    expect(pushes(t)).toBe(0)
    await failureBackoff(t, 'network')
    sch.kick('online')
    await vi.waitFor(() => expect(pushes(t)).toBe(1))
  })
  it('the 30 s window of N4 survives a reload (sync_state) (item 4)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setMode('server_down')
    await failureBackoff(t, 'failure')
    await createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() }).runNow() // clears, tries, fails
    t.mock.setMode('normal')
    await failureBackoff(t, 'failure')
    t.clock.advanceMs(1_000)
    const reloaded = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    await reloaded.runNow()
    expect(pushes(t)).toBe(1) // the new page may not clear again within 30 s
    t.clock.advanceMs(MANUAL_CLEAR_GAP_MS)
    await reloaded.runNow()
    expect(pushes(t)).toBe(2)
  })
  it('the 30 s window of N4 runs on a monotonic clock: moving the wall clock does not reopen it (item 5)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    let mono = 0
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), monoMs: () => mono })
    t.mock.setMode('server_down')
    await failureBackoff(t, 'failure')
    await sch.runNow() // clears, tries, fails
    t.mock.setMode('normal')
    await failureBackoff(t, 'failure')
    t.clock.advanceMs(60_000) // the wall clock jumps; no real time passed
    await sch.runNow()
    expect(pushes(t)).toBe(1)
    mono += MANUAL_CLEAR_GAP_MS
    await sch.runNow()
    expect(pushes(t)).toBe(2)
  })
  it('a press with nothing to clear does not use up the 30 s window (final review M3)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setMode('server_down')
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), monoMs: () => Date.parse(t.clock.now()) })
    await sch.runNow() // no backoff yet: nothing cleared, tried, 5xx
    expect(pushes(t)).toBe(1)
    t.clock.advanceMs(1_000)
    await sch.runNow() // the window was not used: this press clears the new backoff
    expect(pushes(t)).toBe(2)
    t.clock.advanceMs(1_000)
    await sch.runNow()
    expect(pushes(t)).toBe(2)
  })
  it('the request budget survives a reload: a new page waits for the window the old one used (item 4)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const from = (await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order')).get())!
    for (let i = 1; i <= 599; i++) {
      const id = `ffffffff-0000-4000-8000-${i.toString(16).padStart(12, '0')}`
      await t.db.insert(s.outbox).values({ id, tableName: 'order', rowJson: { ...(from.rowJson as Record<string, unknown>), pos_order_id: id, receipt_no: `H-${String(i).padStart(6, '0')}`, queue_no: 2000 + i }, idempotencyKey: `order:${id}`, status: 'pending', createdAt: t.clock.now(), attempts: 0, lastError: null, sentAt: null, deadAt: null, nextAttemptAt: null, parentKey: null, resultJson: null })
    }
    vi.useFakeTimers()
    const first = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    await first.runNow()
    await first.runNow() // 32 requests in this minute
    first.stop()
    const n = t.mock.requests().length
    const reloaded = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    const run = reloaded.runNow()
    await vi.advanceTimersByTimeAsync(50_000)
    expect(t.mock.requests().length).toBe(n) // still inside the old page's minute
    await vi.advanceTimersByTimeAsync(15_000)
    await run
    expect(t.mock.requests().length).toBeGreaterThan(n)
  })
  it('"ส่งตอนนี้" pressed during a cycle answers with the follow-up cycle, not the one already running (item 8)', async () => {
    const t = await openConnectedApi()
    vi.useFakeTimers()
    const slow: typeof fetch = async (input, init) => { await new Promise((r) => setTimeout(r, 3_000)); return t.mock.fetch(input, init) }
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const sch = createSyncScheduler({ db: t.db, deps: { ...t.deps, fetch: slow }, serial: (fn) => fn() })
    sch.kick('online') // the catalog is not due: this cycle only pushes
    await vi.advanceTimersByTimeAsync(1_000)
    const pressed = sch.runNow()
    await vi.advanceTimersByTimeAsync(30_000)
    const r = await pressed
    expect(r.catalog?.outcome).toBe('unchanged') // the manual follow-up pulled E1
    expect(r.push.sent).toBe(0)
    expect(t.mock.orders()).toHaveLength(1)
    sch.stop()
  })
  it('setup calls to dayo are capped per minute so they cannot eat the shared 60/min (item 7)', async () => {
    const t = await openConnectedApi()
    const n = t.mock.requests().length
    const input = { baseUrl: 'http://localhost:8787/api/v1', apiKey: MOCK_API_KEY }
    for (let i = 0; i < SETUP_CALLS_PER_MIN - 1; i++) await t.api.probeDayo(input) // connectShop (in openConnectedApi) was the first
    await expect(t.api.probeDayo(input)).rejects.toThrow(/^DAYO_UNREACHABLE: SETUP_RATE_LIMITED/)
    expect(t.mock.requests().length).toBe(n + SETUP_CALLS_PER_MIN - 1)
  })
})
