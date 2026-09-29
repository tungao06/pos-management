import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { MOCK_API_KEY } from '@dayo/dayo-mock'
import { createPosApi, createPosRuntime, SETUP_CALLS_PER_MIN } from '../src/api/pos-api'
import { createSyncScheduler, FOLLOW_UP_GAP_MS, MANUAL_CLEAR_GAP_MS, SYNC_BUDGET_PER_MIN, type DayoPacer } from '../src/sync/scheduler'
import { pushOnce } from '../src/sync/push'
import { DAYO_KEYS, readKey, writeKey } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'
import { createTestLocks } from './helpers/locks'

afterEach(() => { vi.useRealTimers() })
/**
 * Follow-up item 4: every scheduler here gets its own Web Locks stand-in — never the host's navigator.locks (Node 24
 * has one, Node 22 none; a hung request of one test held 'dayo-push' there for every later test of the file). A test
 * that passes its own `locks` keeps it; the default lookup itself is tested at the end of the file.
 */
const scheduler: typeof createSyncScheduler = (ctx) => createSyncScheduler({ locks: createTestLocks(), ...ctx })
const pushes = (t: Awaited<ReturnType<typeof openConnectedApi>>) => t.mock.requests().filter((r) => r.path === '/api/v1/pos/push').length

describe('sync scheduler (spec 04 §6.2)', () => {
  it('a save wakes the sender 2 seconds later, several saves wake it once', async () => {
    const t = await openConnectedApi()
    vi.useFakeTimers()
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
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
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
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
    const sch = scheduler(ctx)
    online = true
    sch.kick('online')
    await vi.waitFor(() => expect(t.mock.orders()).toHaveLength(5))
  })
  it('"ส่งตอนนี้" clears the failure backoff at most once per 30 s (ruling N4)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setMode('server_down')
    // fix round 1 item 5: the 30 s window runs on a monotonic clock; here it moves with the test clock
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), monoMs: () => Date.parse(t.clock.now()) })
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
  // Task 17 fix round 1 item 3 (ruling): a manual wake shares the failure-backoff clear's own 30 s throttle, but
  // ALSO makes every scope-wait row (markScopeWait, FORBIDDEN "scope:") due again right away — never just letting
  // its own SCOPE_RETRY_MS (15 real minutes) run out. An automatic wake (the minute tick) still waits the full time.
  it('manual "ส่งตอนนี้" clears a scope-wait row\'s own 15-minute retry at once; an automatic wake still waits (Task 17 fix round 1 item 3)', async () => {
    const t = await openConnectedApi({ block3: true, openShift: false })
    t.mock.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write']) // no shift:write
    const shift = await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    const key = `shift_open:${shift.id}`
    const outboxRow = async () => (await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, key)).get())!
    const pushCalls = () => t.mock.requests().filter((r) => r.path === '/api/v1/pos/push').length
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })

    await sch.runNow() // first attempt: FORBIDDEN scope: — parked as a scope-wait row, 15 min out
    expect(pushCalls()).toBe(1)
    expect((await outboxRow()).status).toBe('pending') // still waiting — never accepted yet

    await sch.kick('timer') // an automatic wake must not resend it a moment early
    await new Promise((r) => setTimeout(r, 0))
    expect(pushCalls()).toBe(1) // still not due — no new push request at all

    t.mock.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write', 'shift:write']) // owner adds it back
    await sch.runNow() // manual — sent in this very cycle, never waiting out SCOPE_RETRY_MS
    expect(pushCalls()).toBe(2)
    expect((await outboxRow()).status).toBe('sent')
  })
  // Task 17 fix round 2 item 2a (L): the scope-wait clear shares the exact same 30 s token as the ordinary
  // failure-backoff clear (fix round 1 item 3) — a second manual press right after the first must not clear it
  // again either, same as the pre-existing "ส่งตอนนี้ clears the failure backoff at most once per 30 s" test above.
  it('a second manual press within 30 s does not clear a scope-wait row again (shared N4 token, Task 17 fix round 2 item 2a)', async () => {
    const t = await openConnectedApi({ block3: true, openShift: false })
    t.mock.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write']) // no shift:write, kept missing throughout
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    const pushCalls = () => t.mock.requests().filter((r) => r.path === '/api/v1/pos/push').length
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), monoMs: () => Date.parse(t.clock.now()) })

    await sch.runNow() // first attempt: nothing to clear yet — parked as scope-wait, no token spent
    expect(pushCalls()).toBe(1)
    await sch.runNow() // manual again, immediately: the FIRST real clear (token spent) — resent, FORBIDDEN scope: again
    expect(pushCalls()).toBe(2)
    await sch.runNow() // manual again within 30 s: the token is on cooldown — not cleared, no new request
    expect(pushCalls()).toBe(2)

    t.clock.advanceMs(MANUAL_CLEAR_GAP_MS)
    await sch.runNow() // 30 s later: the token is available again
    expect(pushCalls()).toBe(3)
  })
  // Task 17 fix round 2 item 2b (L): `clearScopeWait` only ever touches rows whose `lastError.prefix` is literally
  // `scope:` (apps/pos/src/sync/push.ts) — a manual wake that DOES have a real scope-wait row to clear (so
  // `clearScopeWait` actually runs) must still leave a CLOCK_AHEAD row and an ordinary deferred/backoff row
  // exactly where they were, never resending either early.
  it('a manual wake that clears a real scope-wait row still leaves a CLOCK_AHEAD row and an ordinary deferred/backoff row untouched (Task 17 fix round 2 item 2b)', async () => {
    const t = await openConnectedApi({ block3: true, openShift: false })
    t.mock.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write']) // no shift:write — the shift row becomes a real scope-wait
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    // sellCode never reads t.shift — same cast as push-block3.test.ts's own sellOne (t here has shift: null
    // statically, since openShift:false, even though `t.api.openShift` above opened one for real).
    const clockAhead = await sellCode(t as unknown as Parameters<typeof sellCode>[0], [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const busy = await sellCode(t as unknown as Parameters<typeof sellCode>[0], [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.override({ match: { key: `order:${clockAhead.orderId}` }, verdict: { status: 'deferred', reason: 'CLOCK_AHEAD', detail: 'x' }, times: 1 })
    t.mock.override({ match: { key: `order:${busy.orderId}` }, verdict: { status: 'deferred', reason: 'BUSY', detail: 'lock' }, times: 1 })
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })

    await sch.runNow() // first attempt: shift row parked as scope-wait; both bills deferred with their own backoff
    const rowOf = async (key: string) => (await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, key)).get())!
    const before = { clockAhead: (await rowOf(`order:${clockAhead.orderId}`)).nextAttemptAt, busy: (await rowOf(`order:${busy.orderId}`)).nextAttemptAt }
    expect(before.clockAhead).not.toBeNull()
    expect(before.busy).not.toBeNull()

    await sch.runNow() // manual again: a REAL scope-wait row exists now — clearScopeWait runs — but only for it
    const after = { clockAhead: (await rowOf(`order:${clockAhead.orderId}`)).nextAttemptAt, busy: (await rowOf(`order:${busy.orderId}`)).nextAttemptAt }
    expect(after).toEqual(before) // neither bill's own wait was touched
  })
  it('online wakes it at once; a second wake during a cycle runs one more cycle, never two in parallel', async () => {
    const t = await openConnectedApi()
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
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
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), locks })
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
    const sch = scheduler({ db: t.db, deps: { ...t.deps, fetch: slow }, serial: (fn) => fn() })
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
    const sch = scheduler({ db: t.db, deps: { ...t.deps, fetch: counted }, serial: (fn) => fn() })
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
    const api = createPosApi(t.db, { ...t.deps, exportDbFile: async () => { await gate; return t.deps.exportDbFile() } }, { locks: createTestLocks() })
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
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
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
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), monoMs: () => Date.parse(t.clock.now()) })
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
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
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
    await scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() }).runNow() // clears, tries, fails
    t.mock.setMode('normal')
    await failureBackoff(t, 'failure')
    t.clock.advanceMs(1_000)
    const reloaded = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
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
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), monoMs: () => mono })
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
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), monoMs: () => Date.parse(t.clock.now()) })
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
    const first = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    await first.runNow()
    await first.runNow() // 32 requests in this minute
    first.stop()
    const n = t.mock.requests().length
    const reloaded = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
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
    const sch = scheduler({ db: t.db, deps: { ...t.deps, fetch: slow }, serial: (fn) => fn() })
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
    // probeDayo + connectShop (in openConnectedApi, as the setup screen does — Task 13) were the first two
    for (let i = 0; i < SETUP_CALLS_PER_MIN - 2; i++) await t.api.probeDayo(input)
    await expect(t.api.probeDayo(input)).rejects.toThrow(/^DAYO_UNREACHABLE: SETUP_RATE_LIMITED/)
    expect(t.mock.requests().length).toBe(n + SETUP_CALLS_PER_MIN - 2)
  })
})

describe('sync scheduler — the real timers (hotfix: "TypeError: Illegal invocation" on every app start)', () => {
  /**
   * A browser's setTimeout / setInterval / clearTimeout / clearInterval are WebIDL operations of Window /
   * WorkerGlobalScope: called with any receiver other than the global object (or undefined → the global object) they
   * throw "TypeError: Illegal invocation". Node and jsdom do not check this, so the check is put back in here, around
   * the (fake) global timers — the same rule the browser applies.
   */
  function branded<F extends (...args: never[]) => unknown>(real: F): F {
    return function (this: unknown, ...args: Parameters<F>) {
      if (this !== undefined && this !== null && this !== globalThis) throw new TypeError('Illegal invocation')
      return real.apply(globalThis, args)
    } as unknown as F
  }
  function brandTheGlobalTimers(): void {
    vi.stubGlobal('setTimeout', branded(globalThis.setTimeout))
    vi.stubGlobal('clearTimeout', branded(globalThis.clearTimeout))
    vi.stubGlobal('setInterval', branded(globalThis.setInterval))
    vi.stubGlobal('clearInterval', branded(globalThis.clearInterval))
  }

  it('the brand check behaves like the browser: a timer held on a plain object and called as its method throws', () => {
    vi.useFakeTimers()
    try {
      brandTheGlobalTimers()
      const held = { setInterval: globalThis.setInterval }
      expect(() => held.setInterval(() => undefined, 1_000)).toThrow(new TypeError('Illegal invocation'))
      const id = setInterval(() => undefined, 1_000) // a plain call: fine
      clearInterval(id)
    } finally { vi.unstubAllGlobals() }
  })
  it('without ctx.timers (as worker.ts runs it): start() does not throw, the minute tick and the write debounce fire, stop() clears them', async () => {
    const t = await openConnectedApi()
    vi.useFakeTimers()
    try {
      brandTheGlobalTimers()
      const catalogCalls = () => t.mock.requests().filter((r) => r.path === '/api/v1/pos/catalog').length
      const base = catalogCalls()
      const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() }) // no timers: the default branch
      expect(() => sch.start()).not.toThrow()
      await vi.waitFor(() => expect(catalogCalls()).toBe(base + 1)) // the 'open' cycle ran
      await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
      expect(pushes(t)).toBe(0)
      t.clock.advanceMs(60_000); await vi.advanceTimersByTimeAsync(60_000) // setInterval's tick: a bill is waiting
      await vi.waitFor(() => expect(pushes(t)).toBe(1))
      await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
      expect(() => { sch.kick('write'); sch.kick('write') }).not.toThrow() // setTimeout + clearTimeout
      await vi.advanceTimersByTimeAsync(2_000)
      await vi.waitFor(() => expect(pushes(t)).toBe(2))
      expect(() => sch.stop()).not.toThrow() // clearInterval
      expect(t.mock.orders()).toHaveLength(2)
    } finally { vi.unstubAllGlobals() }
  })
})

describe('sync scheduler — onCycleDone, the "a cycle ran" signal to the screens (Task 21 hotfix 2)', () => {
  it('a background online wake signals once, after its push has landed — the screens need not wait for their 30 s poll', async () => {
    const t = await openConnectedApi()
    for (let i = 0; i < 3; i++) await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const seen: number[] = []
    const pendingRows = async () => (await t.db.select({ id: s.outbox.id }).from(s.outbox).where(eq(s.outbox.status, 'pending')).all()).length
    let pendingAtSignal = -1
    const sch = scheduler({
      db: t.db, deps: t.deps, serial: (fn) => fn(),
      onCycleDone: () => { seen.push(t.mock.orders().length); void pendingRows().then((n) => { pendingAtSignal = n }) },
    })
    sch.kick('online') // no runNow, nobody waiting on the result: the worker's own wake
    await vi.waitFor(() => expect(seen).toEqual([3]))
    await vi.waitFor(() => expect(pendingAtSignal).toBe(0)) // what the refetch reads is already the sent state
    sch.stop()
  })
  it('signals once per cycle — the follow-up cycle signals again; a cycle that found nothing to send still signals', async () => {
    const t = await openConnectedApi()
    vi.useFakeTimers()
    let calls = 0
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), onCycleDone: () => { calls += 1 } })
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const a = sch.runNow()
    const b = sch.runNow() // rides on the follow-up
    await a
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(FOLLOW_UP_GAP_MS)
    await b
    expect(calls).toBe(2) // the follow-up had nothing left to send — an extra harmless refetch beats a missed one
    sch.stop()
  })
  it('signals even when another tab holds the dayo-push lock (the cycle was given its chance; the other tab may have sent)', async () => {
    const t = await openConnectedApi()
    const locks = { request: async (_n: string, _o: { ifAvailable: true }, cb: (lock: unknown) => Promise<void>) => cb(null) }
    let calls = 0
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), locks, onCycleDone: () => { calls += 1 } })
    await sch.runNow()
    expect(calls).toBe(1)
  })
  it('does not signal when stop() comes while the cycle still waits for the request budget (no cycle ran)', async () => {
    const t = await openConnectedApi()
    vi.useFakeTimers()
    const pacer: DayoPacer = { wrap: (f) => f, used: () => SYNC_BUDGET_PER_MIN, waitFor: () => 10_000, snapshot: () => [], seed: () => undefined }
    let calls = 0
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), pacer, onCycleDone: () => { calls += 1 } })
    const run = sch.runNow()
    await vi.advanceTimersByTimeAsync(1_000) // still waiting on the budget
    sch.stop()
    await run
    expect(calls).toBe(0)
  })
  it('a throwing signal never fails the cycle', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const sch = scheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), onCycleDone: () => { throw new Error('channel gone') } })
    await expect(sch.runNow()).resolves.toMatchObject({ push: { sent: 1 } })
  })
  it('the PosApi passes its onCycleDone option to its scheduler (worker.ts gives notifySyncCycleDone)', async () => {
    const t = await openConnectedApi()
    let calls = 0
    const api = createPosApi(t.db, t.deps, { locks: createTestLocks(), onCycleDone: () => { calls += 1 } })
    await api.syncNow()
    expect(calls).toBe(1)
  })
})

describe('sync scheduler — the Web Locks it uses without ctx.locks (follow-up item 4: tests never lean on the host\'s)', () => {
  /**
   * A browser's LockManager.request is a WebIDL operation: called with any receiver other than the LockManager itself
   * (a destructured `request`, a copy on another object) it throws "TypeError: Illegal invocation". Node does not check
   * it — this stand-in does, like brandedFetch / the branded timers.
   */
  function brandedLockManager(inner: ReturnType<typeof createTestLocks>, asked: string[] = []) {
    const manager = {
      request(this: unknown, name: string, o: { ifAvailable: true }, cb: (lock: unknown) => Promise<void>): Promise<void> {
        if (this !== manager) throw new TypeError('Illegal invocation')
        asked.push(name)
        return inner.request(name, o, cb)
      },
    }
    return manager
  }
  it('the LockManager stand-in checks its receiver like the browser: a request detached from it throws', () => {
    const manager = brandedLockManager(createTestLocks())
    const { request } = manager
    expect(() => request('dayo-push', { ifAvailable: true }, async () => undefined)).toThrow(new TypeError('Illegal invocation'))
    const copy = { request: manager.request }
    expect(() => copy.request('dayo-push', { ifAvailable: true }, async () => undefined)).toThrow(new TypeError('Illegal invocation'))
  })
  it('takes navigator.locks when the host has it (a browser; Node 24): the cycle runs inside the \'dayo-push\' lock', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const locks = createTestLocks()
    const asked: string[] = []
    let heldDuringPush: string[] = []
    const fetchSeen: typeof fetch = async (input, init) => { if (String(input).endsWith('/pos/push')) heldDuringPush = locks.held(); return t.mock.fetch(input, init) }
    vi.stubGlobal('navigator', { locks: brandedLockManager(locks, asked) })
    try {
      const sch = createSyncScheduler({ db: t.db, deps: { ...t.deps, fetch: fetchSeen }, serial: (fn) => fn() }) // no ctx.locks
      await sch.runNow()
      expect(asked).toEqual(['dayo-push'])
      expect(heldDuringPush).toEqual(['dayo-push'])
      expect(pushes(t)).toBe(1)
      expect(locks.held()).toEqual([]) // released after the cycle
    } finally { vi.unstubAllGlobals() }
  })
  it('runs unlocked when the host has no navigator.locks (Node 22; an old browser)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    vi.stubGlobal('navigator', {})
    try {
      await createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() }).runNow()
      expect(pushes(t)).toBe(1)
    } finally { vi.unstubAllGlobals() }
  })
  it('the stand-in answers like the browser\'s ifAvailable: a name already held gets null at once, and is free again after', async () => {
    const locks = createTestLocks()
    let release!: () => void
    const first = locks.request('dayo-push', { ifAvailable: true }, () => new Promise<void>((r) => { release = r }))
    const seen: unknown[] = []
    await locks.request('dayo-push', { ifAvailable: true }, async (lock) => { seen.push(lock) })
    release()
    await first
    await locks.request('dayo-push', { ifAvailable: true }, async (lock) => { seen.push(lock) })
    expect(seen[0]).toBeNull()
    expect(seen[1]).not.toBeNull()
  })
})

describe('the before_close wake (spec 04 §6.2 "ก่อนปิดกะ" · final fix C3)', () => {
  /** A Worker-like PosApi (autoSync) whose scheduler wakes are only recorded — no cycle, no timer, no request from them. */
  async function recorded() {
    const t = await openConnectedApi({ block3: true })
    const noTimers = { setTimeout: () => 0, clearTimeout: () => undefined, setInterval: () => 0, clearInterval: () => undefined } as unknown as NonNullable<Parameters<typeof createPosRuntime>[2]>['timers']
    const rt = createPosRuntime(t.db, t.deps, { autoSync: true, locks: createTestLocks(), timers: noTimers })
    const kick = vi.spyOn(rt.scheduler, 'kick').mockImplementation(() => undefined)
    const closeWakes = () => kick.mock.calls.filter(([r]) => r === 'before_close').length
    t.clock.advanceMs(3_600_000); t.mock.setNow(t.clock.now())
    return { t, rt, closeWakes }
  }
  const owner2 = { approverUserId: STAFF.DCm, approverPin: '2222' }
  const settle = { varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: false }

  it('finishCount and issueZ wake the sender with before_close once they succeed', async () => {
    const { rt, closeWakes } = await recorded()
    const { shiftId } = await rt.api.finishCount({ actorUserId: STAFF.TungAo })
    expect(closeWakes()).toBe(1) // the count moment is fixed: unsent bills of the shift should go now
    await rt.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: [{ denominationSatang: 100, count: 500 }], shownFingerprint: (await rt.api.countSummary(shiftId)).fingerprint, z: null })
    await rt.api.fetchBotCash(shiftId)
    await rt.api.issueZ({ shiftId, ...owner2, shownFingerprint: (await rt.api.countSummary(shiftId)).fingerprint, ...settle })
    expect(closeWakes()).toBe(2) // the Z (shift_close) is queued: send it now, not after the 2 s write debounce
    rt.scheduler.stop()
  })
  it('a refused finishCount or issueZ does not wake it', async () => {
    const { rt, closeWakes } = await recorded()
    const { shiftId } = await rt.api.finishCount({ actorUserId: STAFF.TungAo })
    await expect(rt.api.finishCount({ actorUserId: STAFF.TungAo })).rejects.toThrow(/NO_OPEN_SHIFT/)
    await rt.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: [{ denominationSatang: 100, count: 500 }], shownFingerprint: (await rt.api.countSummary(shiftId)).fingerprint, z: null })
    await expect(rt.api.issueZ({ shiftId, approverUserId: STAFF.DCm, approverPin: '9999', shownFingerprint: 'x', ...settle })).rejects.toThrow()
    expect(closeWakes()).toBe(1)
    rt.scheduler.stop()
  })
})
