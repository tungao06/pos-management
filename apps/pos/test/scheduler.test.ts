import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { createPosApi } from '../src/api/pos-api'
import { createSyncScheduler, FOLLOW_UP_GAP_MS, MANUAL_CLEAR_GAP_MS, SYNC_BUDGET_PER_MIN } from '../src/sync/scheduler'
import { pushOnce } from '../src/sync/push'
import { DAYO_KEYS, readKey } from '../src/sync/state'
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
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    await sch.runNow()
    expect(pushes(t)).toBe(1)                // cleared (nothing to clear), tried, 5xx → backoff
    t.clock.advanceMs(1_000)
    await sch.runNow()
    expect(pushes(t)).toBe(1)                // pressed again 1 s later: the backoff holds, dayo is not hit
    t.clock.advanceMs(MANUAL_CLEAR_GAP_MS)
    await sch.runNow()
    expect(pushes(t)).toBe(2)                // 30 s after the last clear it may clear again
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
