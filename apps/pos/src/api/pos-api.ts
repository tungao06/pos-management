import type { RemoteDb } from '@dayo/db-schema/browser'
import { adjustStock, discardBase } from './adjust'
import { login } from './auth'
import { confirmBackupSaved, exportBackup } from './backup'
import { createDayoPacer, createSyncScheduler, type Scheduler } from '../sync/scheduler'
import { bootstrap, syncStatus } from './bootstrap'
import { recordCashMovement } from './cash'
import { closeShift, getZReport, listZReports } from './close'
import { connectShop, probeDayo, recoverOwner, replaceApiKey } from './connect'
import type { ApiDeps } from './deps'
import { loadMenu } from './menu'
import { getOrder, listOrders } from './orders'
import { produceBatch } from './production'
import { receivePurchase } from './purchase'
import { commitSale, promptPayForAmount, recordSale } from './sale'
import { loadSellCatalog } from './sell-catalog'
import { createSerialQueue } from './serial'
import { setupShop } from './setup'
import { openShift, quickOpenShift } from './shift'
import { shiftReport } from './shift-report'
import { setStaffPin } from './staff'
import { closeStockCount, getOpenStockCount, removeCountLine, saveCountLine, startStockCount } from './stock-count'
import { stockOverview } from './stock-overview'
import type { PosApi } from './types'
import { cancelSale, voidOrder } from './void'

export type PosApiOptions = {
  /** The Worker: start the sender (open wake + 60 s tick) and wake it on saves and shifts. Tests: off (default). */
  autoSync?: boolean
  /** Task 14 test seam: the scheduler's timers and Web Locks (defaults: the globals). */
  timers?: Parameters<typeof createSyncScheduler>[0]['timers']
  locks?: Parameters<typeof createSyncScheduler>[0]['locks']
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
  const pacer = createDayoPacer()
  let scheduler: Scheduler | null = null
  // reads through to baseDeps on every use (the Worker never swaps them; fault-injection tests do), plus the counted
  // fetch and the write wake
  const deps: ApiDeps = {
    get now() { return baseDeps.now }, get newId() { return baseDeps.newId }, get pinCost() { return baseDeps.pinCost },
    get exportDbFile() { return baseDeps.exportDbFile }, get secrets() { return baseDeps.secrets }, get random() { return baseDeps.random },
    fetch: pacer.wrap((input, init) => baseDeps.fetch(input, init)),
    afterWrite: () => { baseDeps.afterWrite?.(); if (auto) scheduler?.kick('write') },
  }
  const sch = createSyncScheduler({ db, deps, serial, pacer, ...(opts.timers === undefined ? {} : { timers: opts.timers }), ...(opts.locks === undefined ? {} : { locks: opts.locks }) })
  scheduler = sch
  const wake = (reason: 'before_shift' | 'before_close'): void => { if (auto) sch.kick(reason) }
  const api: PosApi = {
    bootstrap: () => serial(() => bootstrap(db, deps)),
    setupShop: (input) => serial(() => setupShop(db, deps, input)),
    login: (userId, pin) => serial(() => login(db, deps, userId, pin)),
    openShift: async (input) => { const r = await serial(() => openShift(db, deps, input)); wake('before_shift'); return r },
    loadMenu: () => serial(() => loadMenu(db, deps)),
    commitSale: (input) => serial(() => commitSale(db, deps, input)),
    loadSellCatalog: () => serial(() => loadSellCatalog(db, deps)),
    recordSale: (input) => serial(() => recordSale(db, deps, input)),
    listOrders: () => serial(() => listOrders(db)),
    getOrder: (orderId) => serial(() => getOrder(db, deps, orderId)),
    promptPayForAmount: (amountSatang) => serial(() => promptPayForAmount(db, deps, amountSatang)),
    voidOrder: (input) => serial(() => voidOrder(db, deps, input)),
    cancelSale: (input) => serial(() => cancelSale(db, deps, input)),
    quickOpenShift: async (input) => { const r = await serial(() => quickOpenShift(db, deps, input)); wake('before_shift'); return r },
    recordCashMovement: (input) => serial(() => recordCashMovement(db, deps, input)),
    shiftReport: () => serial(() => shiftReport(db, deps)),
    closeShift: (input) => { wake('before_close'); return serial(() => closeShift(db, deps, input)) }, // spec §6.2: push what is queued first
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
    probeDayo: (input) => probeDayo(deps, input), // not in the serial queue: it touches no table
    connectShop: (input) => serial(() => connectShop(db, deps, input)),
    setStaffPin: (input) => serial(() => setStaffPin(db, deps, input)),
    // network inside the queue is accepted here: the owner does this while the tablet cannot send anyway
    replaceApiKey: (input) => serial(() => replaceApiKey(db, deps, input)),
    recoverOwner: (input) => serial(() => recoverOwner(db, deps, input)),
    syncNow: () => sch.runNow(), // network inside: NOT in the serial queue (its reads and writes are)
    syncStatus: () => serial(() => syncStatus(db, deps)),
  }
  if (auto) sch.start()
  return { api, scheduler: sch }
}
