import type { RemoteDb } from '@dayo/db-schema/browser'
import { adjustStock, discardBase } from './adjust'
import { login } from './auth'
import { confirmBackupSaved, exportBackup } from './backup'
import { createDayoPacer, createSyncScheduler, RATE_WINDOW_MS, type Scheduler } from '../sync/scheduler'
import { bootstrap, syncStatus } from './bootstrap'
import { recordCashMovement } from './cash'
import { listCentralOrdersToday, refreshDayoEdits } from './central-orders'
import { closeShift, getZReport, listZReports } from './close'
import { connectShop, probeDayo, recoverOwner, replaceApiKey } from './connect'
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
import { excludeFromSync, exportSyncRow, listPriceDiffs, listSyncProblems, remapCode, remapStaff, renumberReceipt, retrySyncRow } from './sync-problems'
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
  const pacer = createDayoPacer(undefined, () => Date.parse(baseDeps.now()))
  const setupCall = createLimiter(SETUP_CALLS_PER_MIN, () => new PosError('DAYO_UNREACHABLE', `SETUP_RATE_LIMITED: at most ${SETUP_CALLS_PER_MIN} tries a minute — wait a minute`))
  const e3Call = createLimiter(E3_CALLS_PER_MIN, () => new PosError('OFFLINE', `E3_RATE_LIMITED: at most ${E3_CALLS_PER_MIN} a minute — wait a minute`))
  let scheduler: Scheduler | null = null
  // reads through to baseDeps on every use (the Worker never swaps them; fault-injection tests do), plus the counted
  // fetch and the write wake
  const deps: ApiDeps = {
    get now() { return baseDeps.now }, get newId() { return baseDeps.newId }, get pinCost() { return baseDeps.pinCost },
    get exportDbFile() { return baseDeps.exportDbFile }, get secrets() { return baseDeps.secrets }, get random() { return baseDeps.random },
    fetch: pacer.wrap((input, init) => baseDeps.fetch(input, init)),
    afterWrite: () => { baseDeps.afterWrite?.(); if (auto) scheduler?.kick('write') },
  }
  const sch = createSyncScheduler({ db, deps, serial, pacer, ...(opts.timers === undefined ? {} : { timers: opts.timers }), ...(opts.locks === undefined ? {} : { locks: opts.locks }), ...(opts.onCycleDone === undefined ? {} : { onCycleDone: opts.onCycleDone }) })
  scheduler = sch
  const wake = (reason: 'before_shift' | 'before_close'): void => { if (auto) sch.kick(reason) }
  const api: PosApi = {
    bootstrap: () => serial(() => bootstrap(db, deps)),
    login: (userId, pin) => serial(() => login(db, deps, userId, pin)),
    openShift: async (input) => { const r = await serial(() => openShift(db, deps, input)); wake('before_shift'); return r },
    loadDrinkCatalog: () => serial(() => loadDrinkCatalog(db)),
    loadSellCatalog: () => serial(() => loadSellCatalog(db, deps)),
    recordSale: (input) => serial(() => recordSale(db, deps, input)),
    listOrders: () => serial(() => listOrders(db)),
    getOrder: (orderId) => serial(() => getOrder(db, deps, orderId)),
    promptPayForAmount: (amountSatang) => serial(() => promptPayForAmount(db, deps, amountSatang)),
    cancelSale: (input) => serial(() => cancelSale(db, deps, input)),
    quickOpenShift: async (input) => { const r = await serial(() => quickOpenShift(db, deps, input)); wake('before_shift'); return r },
    recordCashMovement: (input) => serial(() => recordCashMovement(db, deps, input)),
    shiftReport: () => serial(() => shiftReport(db, deps)),
    // spec §6.2 "ก่อนปิดกะ": the wake comes only once the input and the PIN passed (fix round 1 item 4). Its reads and
    // writes queue behind this closeShift in the serial queue, so the send itself happens AFTER the close commits —
    // no effect in block 2 (the Z does not count unsent bills yet); block 3 must revisit this (fix round 1 item 11).
    closeShift: (input) => serial(() => closeShift(db, deps, input, { validated: () => wake('before_close') })),
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
    listSyncProblems: (actorUserId) => serial(() => listSyncProblems(db, actorUserId)),
    retrySyncRow: (input) => serial(() => retrySyncRow(db, deps, input)),
    renumberReceipt: (input) => serial(() => renumberReceipt(db, deps, input)),
    remapCode: (input) => serial(() => remapCode(db, deps, input)),
    remapStaff: (input) => serial(() => remapStaff(db, deps, input)),
    excludeFromSync: (input) => serial(() => excludeFromSync(db, deps, input)),
    exportSyncRow: (input) => serial(() => exportSyncRow(db, input)),
    listPriceDiffs: (actorUserId) => serial(() => listPriceDiffs(db, actorUserId)),
    // E3: network OUTSIDE the serial queue (its reads and writes are inside) — sales keep going; own cap under 60/min
    listCentralOrdersToday: () => listCentralOrdersToday({ db, deps, serial }, { beforeRequest: e3Call }),
    refreshDayoEdits: () => refreshDayoEdits({ db, deps, serial }, { beforeRequest: e3Call }),
  }
  if (auto) sch.start()
  return { api, scheduler: sch }
}
