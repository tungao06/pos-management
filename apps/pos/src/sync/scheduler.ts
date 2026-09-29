import { and, eq, inArray } from 'drizzle-orm'
import * as s from '@dayo/db-schema/sqlite'
import { PUSH_KINDS } from '@dayo/contracts'
import { pullCatalog, type CatalogPullResult, type SyncContext } from './catalog'
import { clearFailureBackoff, clearScopeWait, hasClearableBackoff, hasScopeWait, MAX_ROUNDS_PER_CALL, pushOnce, type PushOutcome } from './push'
import { DAYO_KEYS, readKey, writeKey } from './state'

export type WakeReason = 'open' | 'write' | 'online' | 'timer' | 'manual' | 'before_shift' | 'before_close'
export type SyncCycleResult = { catalog: CatalogPullResult | null; push: PushOutcome }
export type Scheduler = { kick(reason: WakeReason): void; runNow(): Promise<SyncCycleResult>; start(): void; stop(): void }

export const WRITE_DEBOUNCE_MS = 2_000
export const TICK_MS = 60_000
export const CATALOG_EVERY_MS = 300_000
/**
 * ruling N4: pressing "ส่งตอนนี้" again and again while dayo is down must not hammer it — a wake clears a 5xx / timeout
 * backoff at most once per 30 s. Fix round 1 items 4–5: the 'open' and 'before_close' wakes share this window, it runs
 * on a monotonic clock within a page, and its last use is kept in sync_state so a reload does not reopen it.
 */
export const MANUAL_CLEAR_GAP_MS = 30_000

// ── pacing (task 14 item 1) ─────────────────────────────────────────────────────────────────────────────────────────
/** dayo's limit: 60 requests per minute per API key, every route together (E1, E2, E3). */
export const DAYO_REQUESTS_PER_MIN = 60
export const RATE_WINDOW_MS = 60_000
/** The most one cycle can send: one E1 + pushOnce's round cap (one request per round). */
export const CYCLE_MAX_REQUESTS = 1 + MAX_ROUNDS_PER_CALL
/**
 * What the scheduler lets its own cycles use in any 60 s. A cycle starts only when the requests of the last 60 s plus
 * CYCLE_MAX_REQUESTS fit under it, so E1 + E2 never pass it; the rest (15) is headroom for E3 (Task 15) and the setup
 * screens (capped at SETUP_CALLS_PER_MIN in pos-api.ts), which are counted too and so also delay the next cycle.
 */
export const SYNC_BUDGET_PER_MIN = 45
/** A wake that came while a cycle was running starts ONE follow-up cycle this long after it ended — never back-to-back. */
export const FOLLOW_UP_GAP_MS = 5_000

const PULL_FIRST: ReadonlySet<WakeReason> = new Set(['open', 'manual', 'before_shift'])
/** These wakes mean "the user is waiting": they may clear a 5xx / timeout / network backoff — at most once per 30 s (N4). */
const CLEARS_WITH_N4: ReadonlySet<WakeReason> = new Set(['manual', 'open', 'before_close'])

type TimeoutId = ReturnType<typeof setTimeout>
type IntervalId = ReturnType<typeof setInterval>
type Timers = {
  setTimeout(cb: () => void, ms: number): TimeoutId
  clearTimeout(id: TimeoutId): void
  setInterval(cb: () => void, ms: number): IntervalId
  clearInterval(id: IntervalId): void
}
/**
 * The real timers. Each one is CALLED as a plain function, never as a method of this object: a browser's setTimeout /
 * setInterval are WebIDL operations of Window / WorkerGlobalScope, and `timers.setInterval(...)` on an object holding the
 * bare function makes that object the receiver — "TypeError: Illegal invocation" on every app start. (Node and jsdom
 * do not check the receiver, which is why only a real browser showed it.) The globals are also looked up at call time.
 */
const globalTimers: Timers = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: (id) => clearInterval(id),
}
type Locks = { request(name: string, opts: { ifAvailable: true }, cb: (lock: unknown) => Promise<void>): Promise<void> }
const monotonic = (): number => performance.now()

/**
 * Counts every request sent to dayo through `wrap(fetch)` in a sliding 60-second window. A monotonic clock
 * (performance.now) by default: a wall clock set back or forward must neither freeze nor free the budget. The wall
 * time of each request is kept too, so the window can be saved and seeded again after a reload (fix round 1 item 4).
 */
export type DayoPacer = {
  wrap(f: typeof fetch): typeof fetch
  /** Requests sent in the last 60 s. */
  used(): number
  /** ms to wait until `n` more requests fit under `limit` in the window; 0 = now. */
  waitFor(n: number, limit: number): number
  /** The wall times (ms) of the requests still in the window. */
  snapshot(): number[]
  /** Adds requests an earlier page made (their wall times); a time in the future (a clock set back) counts as now. */
  seed(walls: readonly number[]): void
}
export function createDayoPacer(monoMs: () => number = monotonic, wallMs: () => number = Date.now): DayoPacer {
  let log: { mono: number; wall: number }[] = []
  const prune = (now: number): void => { log = log.filter((e) => e.mono > now - RATE_WINDOW_MS && e.mono <= now) } // > now: a clock that jumped — dropped
  return {
    wrap: (f) => (input, init) => { log.push({ mono: monoMs(), wall: wallMs() }); return f(input, init) },
    used: () => { prune(monoMs()); return log.length },
    waitFor(n, limit) {
      const now = monoMs()
      prune(now)
      const over = log.length + n - limit
      if (over <= 0) return 0
      const e = log[Math.min(over, log.length) - 1]! // the entry that must leave the window
      return Math.max(1, Math.ceil(e.mono + RATE_WINDOW_MS - now) + 1)
    },
    snapshot: () => { prune(monoMs()); return log.map((e) => e.wall) },
    seed(walls) {
      const mono = monoMs()
      const wall = wallMs()
      const earlier = walls.filter((w) => Number.isFinite(w)).slice(-DAYO_REQUESTS_PER_MIN * 2)
        .map((w) => ({ mono: mono - Math.max(0, wall - w), wall: Math.min(w, wall) }))
      log = [...earlier, ...log].sort((a, b) => a.mono - b.mono)
      prune(mono)
    },
  }
}

const NO_PUSH: PushOutcome = { requests: 0, sent: 0, rejected: 0, deferred: 0, held: 0, noAnswer: 0, stopped: null }
const EMPTY: SyncCycleResult = { catalog: null, push: NO_PUSH }

/**
 * The one sender of a PosApi (spec 04 §6.2). Single flight: at most one cycle (E1 pull, then pushOnce) runs at a time;
 * wakes during a cycle are merged into ONE follow-up cycle FOLLOW_UP_GAP_MS after it ends, and "ส่งตอนนี้" pressed
 * meanwhile answers with that follow-up's result. Every cycle waits until it fits the per-minute budget. The scheduler
 * never pulls E3 (Task 15 does, on the bill screens).
 *
 * `ctx.serial` must be the PosApi's own queue (task 14 item 4): every read and write of a cycle then queues behind a
 * PIN/role check and its write, never between them. `pacer`: give the one that already counts `ctx.deps.fetch`;
 * without it the scheduler counts its own requests only. `monoMs`: a test seam for the monotonic clock.
 * `onCycleDone` (Task 21 hotfix 2): called once after every cycle whose body was given the chance to run, changed or
 * not — the Worker passes notifySyncCycleDone so the screens refetch at once instead of on their 30 s poll.
 */
export function createSyncScheduler(ctx: SyncContext & { timers?: Timers; locks?: Locks | undefined; pacer?: DayoPacer; monoMs?: () => number; onCycleDone?: () => void }): Scheduler {
  const timers: Timers = ctx.timers ?? globalTimers
  const locks: Locks | undefined = ctx.locks ?? (globalThis.navigator as { locks?: Locks } | undefined)?.locks
  const monoMs = ctx.monoMs ?? monotonic
  const wallMs = (): number => Date.parse(ctx.deps.now())
  const pacer = ctx.pacer ?? createDayoPacer(monoMs, wallMs)
  const sync: SyncContext = ctx.pacer === undefined ? { db: ctx.db, deps: { ...ctx.deps, fetch: pacer.wrap(ctx.deps.fetch) }, serial: ctx.serial } : { db: ctx.db, deps: ctx.deps, serial: ctx.serial }
  let running: Promise<SyncCycleResult> | null = null
  const pending = new Set<WakeReason>()
  /** The promise handed to callers whose wake rides on the next (follow-up) cycle. */
  let next: { promise: Promise<SyncCycleResult>; resolve: (r: SyncCycleResult) => void; reject: (e: unknown) => void } | null = null
  let followUp: ReturnType<typeof setTimeout> | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let tick: ReturnType<typeof setInterval> | null = null
  let paceTimer: { timer: ReturnType<typeof setTimeout>; resolve: (go: boolean) => void } | null = null
  let stopped = false
  let seeded = false
  let lastClearMono = Number.NEGATIVE_INFINITY

  /** N4 (items 4–5): true once per 30 s — by the monotonic clock of this page AND the wall time saved by any page. */
  async function takeClearToken(): Promise<boolean> {
    const mono = monoMs()
    if (mono - lastClearMono < MANUAL_CLEAR_GAP_MS) return false
    return ctx.serial(async () => {
      const now = wallMs()
      const last = Date.parse((await readKey(ctx.db, DAYO_KEYS.manualClearAt)) ?? '')
      if (Number.isFinite(last) && now < last) { // the wall clock went back: restart the window from now, no clear
        await writeKey(ctx.db, DAYO_KEYS.manualClearAt, new Date(now).toISOString())
        return false
      }
      if (Number.isFinite(last) && now - last < MANUAL_CLEAR_GAP_MS) return false
      await writeKey(ctx.db, DAYO_KEYS.manualClearAt, new Date(now).toISOString())
      lastClearMono = mono
      return true
    })
  }
  /**
   * 'online' forgets only an offline tablet's backoff (item 4); manual / open / before_close any failure backoff,
   * under N4. Task 17 fix round 1 item 3: a manual wake ("ส่งตอนนี้") ALSO makes every scope-wait row due again —
   * sharing the very same 30 s token (never a separate budget of its own), so the two never fire independently of
   * each other's throttle.
   */
  async function clearBackoffFor(reasons: ReadonlySet<WakeReason>): Promise<void> {
    const wantsScopeClear = reasons.has('manual')
    // final review M3: the 30 s window is used only when there is something it would actually clear
    const backoffClearable = [...reasons].some((r) => CLEARS_WITH_N4.has(r)) && (await ctx.serial(() => hasClearableBackoff(ctx.db)))
    const scopeClearable = wantsScopeClear && (await ctx.serial(() => hasScopeWait(ctx.db)))
    if ((backoffClearable || scopeClearable) && (await takeClearToken())) {
      if (backoffClearable) await ctx.serial(() => clearFailureBackoff(ctx.db))
      if (scopeClearable) await ctx.serial(() => clearScopeWait(ctx.db, ctx.deps.now()))
      return
    }
    if (reasons.has('online')) await ctx.serial(() => clearFailureBackoff(ctx.db, { onlyNetwork: true }))
  }
  /** Due from the last ATTEMPT, answered or not (item 3); E1's own backoff and a 429 are checked by pullCatalog. */
  async function catalogDue(reasons: ReadonlySet<WakeReason>): Promise<boolean> {
    if ([...reasons].some((r) => PULL_FIRST.has(r))) return true
    const last = await ctx.serial(async () => (await readKey(ctx.db, DAYO_KEYS.catalogAttemptAt)) ?? (await readKey(ctx.db, DAYO_KEYS.catalogCheckedAt)))
    const since = Date.parse(ctx.deps.now()) - Date.parse(last ?? '')
    return !Number.isFinite(since) || since >= CATALOG_EVERY_MS || since < 0 // a clock set back: pull rather than wait for it
  }
  async function hasPending(): Promise<boolean> {
    const r = await ctx.serial(() => ctx.db.select({ id: s.outbox.id }).from(s.outbox).where(and(eq(s.outbox.status, 'pending'), inArray(s.outbox.tableName, [...PUSH_KINDS]))).limit(1).get())
    return r !== undefined
  }
  /** The requests an earlier page made in the last minute count here too (item 4) — read once, before the first cycle. */
  async function seedOnce(): Promise<void> {
    if (seeded) return
    seeded = true
    const raw = await ctx.serial(() => readKey(ctx.db, DAYO_KEYS.requestWindow))
    try {
      const walls: unknown = raw === null ? [] : JSON.parse(raw)
      if (Array.isArray(walls)) pacer.seed(walls.filter((w): w is number => typeof w === 'number'))
    } catch { /* an unreadable window is dropped */ }
  }
  /** Waits (inside the single flight) until one more cycle fits the budget. False = stop() came meanwhile: skip the cycle. */
  async function paced(): Promise<boolean> {
    const ms = pacer.waitFor(CYCLE_MAX_REQUESTS, SYNC_BUDGET_PER_MIN)
    if (ms === 0) return true
    return new Promise<boolean>((resolve) => { paceTimer = { timer: timers.setTimeout(() => { paceTimer = null; resolve(true) }, ms), resolve } })
  }
  async function cycle(reasons: ReadonlySet<WakeReason>): Promise<SyncCycleResult> {
    let result: SyncCycleResult = EMPTY
    await seedOnce()
    if (!(await paced())) return result
    const body = async (): Promise<void> => {
      await clearBackoffFor(reasons) // never a 429's Retry-After
      const catalog = (await catalogDue(reasons)) ? await pullCatalog(sync) : null
      result = { catalog, push: await pushOnce(sync) }
    }
    try {
      if (locks === undefined) await body()
      else await locks.request('dayo-push', { ifAvailable: true }, async (lock) => { if (lock !== null) await body() }) // one sender across tabs (spec §6.2)
    } finally {
      await ctx.serial(() => writeKey(ctx.db, DAYO_KEYS.requestWindow, JSON.stringify(pacer.snapshot()))).catch(() => undefined)
      try { ctx.onCycleDone?.() } catch { /* a signal is best-effort: never fails or masks a cycle */ }
    }
    return result
  }
  function scheduleFollowUp(): void {
    if (followUp !== null) return
    // after stop() only a caller still waiting on "ส่งตอนนี้" gets its cycle; automatic wakes are dropped
    if (stopped && next === null) { pending.clear(); return }
    followUp = timers.setTimeout(() => { followUp = null; void run(null).catch(() => undefined) }, FOLLOW_UP_GAP_MS)
  }
  function waitForNext(): Promise<SyncCycleResult> {
    if (next === null) {
      let resolve!: (r: SyncCycleResult) => void
      let reject!: (e: unknown) => void
      const promise = new Promise<SyncCycleResult>((res, rej) => { resolve = res; reject = rej })
      next = { promise, resolve, reject }
    }
    return next.promise
  }
  function run(reason: WakeReason | null): Promise<SyncCycleResult> {
    if (reason !== null) pending.add(reason)
    if (running !== null) return waitForNext() // single flight: the wake rides on the follow-up cycle (item 8)
    if (followUp !== null) { timers.clearTimeout(followUp); followUp = null } // this run takes the follow-up's wakes
    const reasons = new Set(pending)
    pending.clear()
    const waiting = next
    next = null
    const current = cycle(reasons)
    running = current.finally(() => {
      running = null
      if (pending.size > 0) scheduleFollowUp()
    })
    if (waiting !== null) current.then(waiting.resolve, waiting.reject)
    return running
  }
  return {
    kick(reason) {
      if (stopped) return
      if (reason === 'write') {
        if (debounce !== null) timers.clearTimeout(debounce)
        debounce = timers.setTimeout(() => { debounce = null; void run('write').catch(() => undefined) }, WRITE_DEBOUNCE_MS)
        return
      }
      void run(reason).catch(() => undefined)
    },
    runNow: () => run('manual'),
    start() {
      if (tick !== null) return
      stopped = false
      void run('open').catch(() => undefined)
      tick = timers.setInterval(() => {
        if (running !== null) return
        void (async () => { if ((await hasPending()) || (await catalogDue(new Set(['timer'])))) await run('timer') })().catch(() => undefined)
      }, TICK_MS)
    },
    stop() {
      stopped = true
      if (tick !== null) { timers.clearInterval(tick); tick = null }
      if (debounce !== null) { timers.clearTimeout(debounce); debounce = null }
      if (followUp !== null) { timers.clearTimeout(followUp); followUp = null }
      if (paceTimer !== null) { timers.clearTimeout(paceTimer.timer); paceTimer.resolve(false); paceTimer = null }
      pending.clear()
      if (next !== null) { next.resolve(EMPTY); next = null } // nothing will run for those wakes any more
    },
  }
}
