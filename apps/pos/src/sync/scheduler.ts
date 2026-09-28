import { and, eq, inArray } from 'drizzle-orm'
import * as s from '@dayo/db-schema/sqlite'
import { PUSH_KINDS } from '@dayo/contracts'
import { pullCatalog, type CatalogPullResult, type SyncContext } from './catalog'
import { clearFailureBackoff, MAX_ROUNDS_PER_CALL, pushOnce, type PushOutcome } from './push'
import { DAYO_KEYS, readKey } from './state'

export type WakeReason = 'open' | 'write' | 'online' | 'timer' | 'manual' | 'before_shift' | 'before_close'
export type SyncCycleResult = { catalog: CatalogPullResult | null; push: PushOutcome }
export type Scheduler = { kick(reason: WakeReason): void; runNow(): Promise<SyncCycleResult>; start(): void; stop(): void }

export const WRITE_DEBOUNCE_MS = 2_000
export const TICK_MS = 60_000
export const CATALOG_EVERY_MS = 300_000
/** ruling N4: pressing "ส่งตอนนี้" again and again while dayo is down must not hammer it — a manual wake clears the backoff at most once per 30 s. */
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
 * screens, which are counted too (they share the PosApi's fetch) and so also delay the next cycle.
 */
export const SYNC_BUDGET_PER_MIN = 45
/** A wake that came while a cycle was running starts ONE follow-up cycle this long after it ended — never back-to-back. */
export const FOLLOW_UP_GAP_MS = 5_000

const PULL_FIRST: ReadonlySet<WakeReason> = new Set(['open', 'manual', 'before_shift'])
/** review item 2: these wakes mean "the network may be back / the user is waiting" — forget the network/5xx backoff first. */
const CLEARS_FAILURE_BACKOFF: ReadonlySet<WakeReason> = new Set(['online', 'manual', 'open', 'before_close'])

type Timers = { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; setInterval: typeof setInterval; clearInterval: typeof clearInterval }
type Locks = { request(name: string, opts: { ifAvailable: true }, cb: (lock: unknown) => Promise<void>): Promise<void> }

/**
 * Counts every request sent to dayo through `wrap(fetch)` in a sliding 60-second window. A monotonic clock
 * (performance.now) by default: a wall clock set back or forward must neither freeze nor free the budget.
 */
export type DayoPacer = {
  wrap(f: typeof fetch): typeof fetch
  /** Requests sent in the last 60 s. */
  used(): number
  /** ms to wait until `n` more requests fit under `limit` in the window; 0 = now. */
  waitFor(n: number, limit: number): number
}
export function createDayoPacer(nowMs: () => number = () => performance.now()): DayoPacer {
  let log: number[] = []
  const prune = (now: number): void => { log = log.filter((t) => t > now - RATE_WINDOW_MS && t <= now) } // t > now: a clock that jumped — dropped
  return {
    wrap: (f) => (input, init) => { log.push(nowMs()); return f(input, init) },
    used: () => { prune(nowMs()); return log.length },
    waitFor(n, limit) {
      const now = nowMs()
      prune(now)
      const over = log.length + n - limit
      if (over <= 0) return 0
      const t = log[Math.min(over, log.length) - 1]! // the entry that must leave the window
      return Math.max(1, Math.ceil(t + RATE_WINDOW_MS - now) + 1)
    },
  }
}

const NO_PUSH: PushOutcome = { requests: 0, sent: 0, rejected: 0, deferred: 0, held: 0, noAnswer: 0, stopped: null }

/**
 * The one sender of a PosApi (spec 04 §6.2). Single flight: at most one cycle (E1 pull, then pushOnce) runs at a time;
 * wakes during a cycle are merged into ONE follow-up cycle FOLLOW_UP_GAP_MS after it ends. Every cycle waits until it
 * fits the per-minute budget. The scheduler never pulls E3 (Task 15 does, on the bill screens).
 *
 * `ctx.serial` must be the PosApi's own queue (task 14 item 4): every read and write of a cycle then queues behind a
 * PIN/role check and its write, never between them. `pacer`: give the one that already counts `ctx.deps.fetch`;
 * without it the scheduler counts its own requests only.
 */
export function createSyncScheduler(ctx: SyncContext & { timers?: Timers; locks?: Locks | undefined; pacer?: DayoPacer }): Scheduler {
  const timers: Timers = ctx.timers ?? { setTimeout, clearTimeout, setInterval, clearInterval }
  const locks: Locks | undefined = ctx.locks ?? (globalThis.navigator as { locks?: Locks } | undefined)?.locks
  const pacer = ctx.pacer ?? createDayoPacer()
  const sync: SyncContext = ctx.pacer === undefined ? { db: ctx.db, deps: { ...ctx.deps, fetch: pacer.wrap(ctx.deps.fetch) }, serial: ctx.serial } : { db: ctx.db, deps: ctx.deps, serial: ctx.serial }
  let running: Promise<SyncCycleResult> | null = null
  const pending = new Set<WakeReason>()
  let followUp: ReturnType<typeof setTimeout> | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let tick: ReturnType<typeof setInterval> | null = null
  let paceTimer: { timer: ReturnType<typeof setTimeout>; resolve: (go: boolean) => void } | null = null
  let stopped = false
  let lastManualClearMs = Number.NEGATIVE_INFINITY

  function mayClearBackoff(reasons: ReadonlySet<WakeReason>): boolean {
    if ([...reasons].some((r) => r !== 'manual' && CLEARS_FAILURE_BACKOFF.has(r))) return true
    if (!reasons.has('manual')) return false
    const nowMs = Date.parse(ctx.deps.now())
    // a wall clock set back since the last clear does not lock the button for that long
    if (nowMs >= lastManualClearMs && nowMs - lastManualClearMs < MANUAL_CLEAR_GAP_MS) return false
    lastManualClearMs = nowMs
    return true
  }
  async function catalogDue(reasons: ReadonlySet<WakeReason>): Promise<boolean> {
    if ([...reasons].some((r) => PULL_FIRST.has(r))) return true
    const last = await ctx.serial(() => readKey(ctx.db, DAYO_KEYS.catalogCheckedAt))
    return last === null || Date.parse(ctx.deps.now()) - Date.parse(last) >= CATALOG_EVERY_MS
  }
  async function hasPending(): Promise<boolean> {
    const r = await ctx.serial(() => ctx.db.select({ id: s.outbox.id }).from(s.outbox).where(and(eq(s.outbox.status, 'pending'), inArray(s.outbox.tableName, [...PUSH_KINDS]))).limit(1).get())
    return r !== undefined
  }
  /** Waits (inside the single flight) until one more cycle fits the budget. False = stop() came meanwhile: skip the cycle. */
  async function paced(): Promise<boolean> {
    const ms = pacer.waitFor(CYCLE_MAX_REQUESTS, SYNC_BUDGET_PER_MIN)
    if (ms === 0) return true
    return new Promise<boolean>((resolve) => { paceTimer = { timer: timers.setTimeout(() => { paceTimer = null; resolve(true) }, ms), resolve } })
  }
  async function cycle(reasons: ReadonlySet<WakeReason>): Promise<SyncCycleResult> {
    let result: SyncCycleResult = { catalog: null, push: NO_PUSH }
    if (!(await paced())) return result
    const body = async (): Promise<void> => {
      if (mayClearBackoff(reasons)) await ctx.serial(() => clearFailureBackoff(ctx.db)) // 429's Retry-After is kept · manual ≤ once per 30 s (N4)
      const catalog = (await catalogDue(reasons)) ? await pullCatalog(sync) : null
      result = { catalog, push: await pushOnce(sync) }
    }
    if (locks === undefined) await body()
    else await locks.request('dayo-push', { ifAvailable: true }, async (lock) => { if (lock !== null) await body() }) // one sender across tabs (spec §6.2)
    return result
  }
  function scheduleFollowUp(): void {
    if (followUp !== null || stopped) return
    followUp = timers.setTimeout(() => { followUp = null; void run(null).catch(() => undefined) }, FOLLOW_UP_GAP_MS)
  }
  function run(reason: WakeReason | null): Promise<SyncCycleResult> {
    if (reason !== null) pending.add(reason)
    if (running !== null) return running // single flight: the wake rides on the follow-up cycle
    if (followUp !== null) { timers.clearTimeout(followUp); followUp = null } // this run takes the follow-up's wakes
    const reasons = new Set(pending)
    pending.clear()
    running = cycle(reasons).finally(() => {
      running = null
      if (pending.size > 0) scheduleFollowUp()
    })
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
    },
  }
}
