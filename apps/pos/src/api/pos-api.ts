import type { RemoteDb } from '@dayo/db-schema/browser'
import { adjustStock, discardBase } from './adjust'
import { login } from './auth'
import { confirmBackupSaved, exportBackup } from './backup'
import { pullCatalog } from '../sync/catalog'
import { createDayoPacer, createSyncScheduler, DAYO_REQUESTS_PER_MIN, RATE_WINDOW_MS, SYNC_BUDGET_PER_MIN, type DayoPacer, type Scheduler } from '../sync/scheduler'
import { bootstrap, syncStatus } from './bootstrap'
import { recordCashMovement } from './cash'
import { listCentralOrdersToday, refreshDayoEdits } from './central-orders'
import { fetchBotCash } from './bot-cash'
import { getZReport, listZReports } from './close'
import { closeShift, confirmCount, countSummary, finishCount, issueZ } from './count'
import { connectShop, isDayoLinked, probeDayo, recoverOwner, replaceApiKey } from './connect'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { loadDrinkCatalog } from './drink-catalog'
import { getOrder, listOrders } from './orders'
import { produceBatch } from './production'
import { receivePurchase } from './purchase'
import { promptPayForAmount, recordSale } from './sale'
import { loadSellCatalog } from './sell-catalog'
import { createSerialQueue } from './serial'
import { openShift, quickOpenShift } from './shift'
import { shiftReport } from './shift-report'
import { setStaffPin } from './staff'
import { closeStockCount, getOpenStockCount, removeCountLine, saveCountLine, startStockCount } from './stock-count'
import { stockOverview } from './stock-overview'
import { keepShiftLocal, skipCountFloor } from './owner-escapes'
import { acknowledgeElsewhere, closeOffCatalog, excludeFromSync, exportSyncRow, listPriceDiffs, listSyncProblems, reconfirmOwner, remapCode, remapStaff, renumberReceipt, retrySyncRow } from './sync-problems'
import type { PosApi } from './types'
import { cancelSale } from './void'

export type PosApiOptions = {
  /** The Worker: start the sender (open wake + 60 s tick) and wake it on saves and shifts. Tests: off (default). */
  autoSync?: boolean
  /** Task 14 test seam: the scheduler's timers and Web Locks (defaults: the globals). */
  timers?: Parameters<typeof createSyncScheduler>[0]['timers']
  locks?: Parameters<typeof createSyncScheduler>[0]['locks']
  /** Task 21 hotfix 2: told after every scheduler cycle — the Worker passes notifySyncCycleDone (sync/cycle-signal.ts). */
  onCycleDone?: () => void
  /** Task 11 test seam: the request pacer every dayo request of this PosApi counts in (default: a new one). */
  pacer?: DayoPacer
}

/**
 * fix round 1 item 7: probeDayo / connectShop / replaceApiKey / recoverOwner (1–2 E1 requests each) together at most
 * this many times per minute, so setup screens cannot eat the 60/min dayo shares with the sender (SYNC_BUDGET_PER_MIN
 * 45 + 6 × 2 = 57). E3 (Task 15) needs its own cap under the same ceiling.
 */
export const SETUP_CALLS_PER_MIN = 6
/**
 * Task 15: E3 requests (listCentralOrdersToday, refreshDayoEdits — one request each) at most this many times per
 * minute: SYNC_BUDGET_PER_MIN 45 + setup 6 × 2 + E3 3 = 60, dayo's per-key limit. The bot/web page asks once on open
 * and every 5 minutes, so the cap only bites on a page opened again and again.
 */
export const E3_CALLS_PER_MIN = 3

/** A sliding one-minute count of calls on a monotonic clock; over the cap = refused before any request. */
function createLimiter(max: number, refuse: () => PosError, monoMs: () => number = () => performance.now()): () => void {
  let log: number[] = []
  return () => {
    const now = monoMs()
    log = log.filter((x) => x > now - RATE_WINDOW_MS && x <= now)
    if (log.length >= max) throw refuse()
    log.push(now)
  }
}

export function createPosApi(db: RemoteDb, baseDeps: ApiDeps, opts: PosApiOptions = {}): PosApi {
  return createPosRuntime(db, baseDeps, opts).api
}

/**
 * The PosApi and its one sync scheduler (the Worker also needs the scheduler, for the `online` event).
 * task 14 item 4: the scheduler gets THIS serial queue, so a catalog pull never writes between a PIN/role check and the
 * write it guards. Every dayo request of this PosApi (E1, E2, E3, setup) goes through one pacer (item 1).
 */
export function createPosRuntime(db: RemoteDb, baseDeps: ApiDeps, opts: PosApiOptions = {}): { api: PosApi; scheduler: Scheduler } {
  const serial = createSerialQueue()
  const auto = opts.autoSync === true
  const pacer = opts.pacer ?? createDayoPacer(undefined, () => Date.parse(baseDeps.now()))
  const setupCall = createLimiter(SETUP_CALLS_PER_MIN, () => new PosError('DAYO_UNREACHABLE', `SETUP_RATE_LIMITED: at most ${SETUP_CALLS_PER_MIN} tries a minute — wait a minute`))
  const e3Call = createLimiter(E3_CALLS_PER_MIN, () => new PosError('OFFLINE', `E3_RATE_LIMITED: at most ${E3_CALLS_PER_MIN} a minute — wait a minute`))
  // E4 (Task 12): a user action, once per Z — refused only when dayo's own 60/min for the key is already used up in the
  // window (every request of this PosApi is in the pacer), so it can never be the request that earns a 429
  const e4Call = (): void => {
    if (pacer.waitFor(1, DAYO_REQUESTS_PER_MIN) > 0) throw new PosError('DAYO_UNREACHABLE', `E4_RATE_LIMITED: dayo takes ${DAYO_REQUESTS_PER_MIN} requests a minute — wait a minute`)
  }
  let scheduler: Scheduler | null = null
  // reads through to baseDeps on every use (the Worker never swaps them; fault-injection tests do), plus the counted
  // fetch and the write wake
  const deps: ApiDeps = {
    get now() { return baseDeps.now }, get newId() { return baseDeps.newId }, get pinCost() { return baseDeps.pinCost },
    get exportDbFile() { return baseDeps.exportDbFile }, get secrets() { return baseDeps.secrets }, get random() { return baseDeps.random },
    // read at call time, then called as a plain function — `baseDeps.fetch(...)` would make baseDeps the receiver of a
    // native fetch: "TypeError: Illegal invocation" in a browser (follow-up item 5)
    fetch: pacer.wrap((input, init) => { const f = baseDeps.fetch; return f(input, init) }),
    afterWrite: () => { baseDeps.afterWrite?.(); if (auto) scheduler?.kick('write') },
  }
  const sch = createSyncScheduler({ db, deps, serial, pacer, ...(opts.timers === undefined ? {} : { timers: opts.timers }), ...(opts.locks === undefined ? {} : { locks: opts.locks }), ...(opts.onCycleDone === undefined ? {} : { onCycleDone: opts.onCycleDone }) })
  scheduler = sch
  const wake = (reason: 'before_shift' | 'before_close'): void => { if (auto) sch.kick(reason) }
  /**
   * Ruling R1 · spec 04 §6.5 "ก่อนเปิดกะ": a linked tablet pulls E1 before opening a shift, so a dayo that has just started
   * to support the shift kinds is seen and the new shift is central. Network OUTSIDE the serial queue (its reads and
   * writes are inside); any outcome — offline, failed, blocked, E1's own backoff or 429 wait, even a throw — only means
   * the shift is decided from the last stored E1: opening is never stopped, and never waits longer than the client's
   * own timeout. It draws on the sender's share of the per-minute budget: no room left = no pull.
   */
  const pullBeforeShift = async (): Promise<void> => {
    try {
      if (!(await serial(() => isDayoLinked(db, deps)))) return
      if (pacer.waitFor(1, SYNC_BUDGET_PER_MIN) > 0) return
      await pullCatalog({ db, deps, serial })
    } catch {
      // R1: never blocks the shift — the last stored E1 decides
    }
  }
  // Task 13 fix round 1 item 5: E4 without a fresh skew first asks E1 for dayo's time (same budget and silence as pullBeforeShift)
  const pullForClock = async (): Promise<void> => {
    try {
      if (pacer.waitFor(1, SYNC_BUDGET_PER_MIN) > 0) return
      await pullCatalog({ db, deps, serial })
    } catch {
      // the device-clock fallback stands
    }
  }
  const api: PosApi = {
    bootstrap: () => serial(() => bootstrap(db, deps)),
    login: (userId, pin) => serial(() => login(db, deps, userId, pin)),
    openShift: async (input) => { await pullBeforeShift(); const r = await serial(() => openShift(db, deps, input)); wake('before_shift'); return r },
    loadDrinkCatalog: () => serial(() => loadDrinkCatalog(db)),
    loadSellCatalog: () => serial(() => loadSellCatalog(db, deps)),
    recordSale: (input) => serial(() => recordSale(db, deps, input)),
    listOrders: () => serial(() => listOrders(db)),
    getOrder: (orderId) => serial(() => getOrder(db, deps, orderId)),
    promptPayForAmount: (amountSatang) => serial(() => promptPayForAmount(db, deps, amountSatang)),
    cancelSale: (input) => serial(() => cancelSale(db, deps, input)),
    quickOpenShift: async (input) => { await pullBeforeShift(); const r = await serial(() => quickOpenShift(db, deps, input)); wake('before_shift'); return r },
    recordCashMovement: (input) => serial(() => recordCashMovement(db, deps, input)),
    shiftReport: () => serial(() => shiftReport(db, deps)),
    // Block 2's one-step close — no screen calls it since block 3 (the count screens use finishCount → confirmCount →
    // issueZ); kept on the PosApi for a local-only shift and for the API tests of that path (close-shift.test.ts). Its
    // before_close wake comes once the input and the PIN passed (fix round 1 item 4).
    closeShift: (input) => serial(() => closeShift(db, deps, input, { validated: () => wake('before_close') })),
    // block 3 count and Z (D101): each write wakes the sender (deps.afterWrite → kick('write')) · final fix C3 — spec §6.2
    // "ก่อนปิดกะ": once "นับเสร็จ" froze the shift and once a Z was issued, the sender is also woken with before_close (sent
    // now — not after the 2 s write debounce — and a 5xx backoff may be cleared, ≤ once per 30 s): the shift's unsent bills
    // and its Z reach dayo while the owner is still at the counter. After success only — a refusal wakes nothing.
    finishCount: async (input) => { const r = await serial(() => finishCount(db, deps, input)); wake('before_close'); return r },
    countSummary: (shiftId) => serial(() => countSummary(db, shiftId)),
    // E4: network OUTSIDE the serial queue (its reads and writes are inside), like syncNow / E3
    fetchBotCash: (shiftId) => fetchBotCash({ db, deps, serial }, shiftId, { beforeRequest: e4Call, refreshClock: pullForClock }),
    confirmCount: (input) => serial(() => confirmCount(db, deps, input)),
    issueZ: async (input) => { const r = await serial(() => issueZ(db, deps, input)); wake('before_close'); return r },
    listZReports: () => serial(() => listZReports(db)),
    getZReport: (shiftId) => serial(() => getZReport(db, shiftId)),
    exportBackup: (actorUserId) => serial(() => exportBackup(db, deps, actorUserId)),
    confirmBackupSaved: (input) => serial(() => confirmBackupSaved(db, deps, input)),
    stockOverview: () => serial(() => stockOverview(db, deps)),
    receivePurchase: (input) => serial(() => receivePurchase(db, deps, input)),
    produceBatch: (input) => serial(() => produceBatch(db, deps, input)),
    adjustStock: (input) => serial(() => adjustStock(db, deps, input)),
    discardBase: (input) => serial(() => discardBase(db, deps, input)),
    startStockCount: (actorUserId) => serial(() => startStockCount(db, deps, actorUserId)),
    getOpenStockCount: () => serial(() => getOpenStockCount(db)),
    saveCountLine: (input) => serial(() => saveCountLine(db, deps, input)),
    removeCountLine: (input) => serial(() => removeCountLine(db, input)),
    closeStockCount: (input) => serial(() => closeStockCount(db, deps, input)),
    probeDayo: async (input) => { setupCall(); return probeDayo(deps, input) }, // not in the serial queue: it touches no table
    connectShop: async (input) => { setupCall(); return serial(() => connectShop(db, deps, input)) },
    setStaffPin: (input) => serial(() => setStaffPin(db, deps, input)),
    // network inside the queue is accepted here: the owner does this while the tablet cannot send anyway
    replaceApiKey: async (input) => { setupCall(); return serial(() => replaceApiKey(db, deps, input)) },
    recoverOwner: async (input) => { setupCall(); return serial(() => recoverOwner(db, deps, input)) },
    syncNow: () => sch.runNow(), // network inside: NOT in the serial queue (its reads and writes are)
    syncStatus: () => serial(() => syncStatus(db, deps)),
    // Task 15 · Iron Rule 5: every remedy runs WHOLE in this serial queue — the same one the scheduler's pushOnce reads
    // and writes the outbox through (`serial` above) — so a remedy never interleaves with a push decision on the same
    // row. A verdict of a request already on the wire meets the remedy's result, and applyVerdicts judges only rows
    // still pending (test/sync-problems.test.ts "never interleave").
    listSyncProblems: (actorUserId) => serial(() => listSyncProblems(db, deps, actorUserId)),
    retrySyncRow: (input) => serial(() => retrySyncRow(db, deps, input)),
    renumberReceipt: (input) => serial(() => renumberReceipt(db, deps, input)),
    remapCode: (input) => serial(() => remapCode(db, deps, input)),
    remapStaff: (input) => serial(() => remapStaff(db, deps, input)),
    excludeFromSync: (input) => serial(() => excludeFromSync(db, deps, input)),
    exportSyncRow: (input) => serial(() => exportSyncRow(db, input)),
    // Task 14 (block 3 · spec 04 §6.4): the same serial queue as the sender — see above
    closeOffCatalog: (input) => serial(() => closeOffCatalog(db, deps, input)),
    acknowledgeElsewhere: (input) => serial(() => acknowledgeElsewhere(db, deps, input)),
    reconfirmOwner: (input) => serial(() => reconfirmOwner(db, deps, input)),
    keepShiftLocal: (input) => serial(() => keepShiftLocal(db, deps, input)),
    skipCountFloor: (input) => serial(() => skipCountFloor(db, deps, input)),
    listPriceDiffs: (actorUserId) => serial(() => listPriceDiffs(db, actorUserId)),
    // E3: network OUTSIDE the serial queue (its reads and writes are inside) — sales keep going; own cap under 60/min
    listCentralOrdersToday: () => listCentralOrdersToday({ db, deps, serial }, { beforeRequest: e3Call }),
    refreshDayoEdits: () => refreshDayoEdits({ db, deps, serial }, { beforeRequest: e3Call }),
  }
  if (auto) sch.start()
  return { api, scheduler: sch }
}
