import type { RemoteDb } from '@dayo/db-schema/browser'
import { adjustStock, discardBase } from './adjust'
import { login } from './auth'
import { confirmBackupSaved, exportBackup } from './backup'
import { bootstrap } from './bootstrap'
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

export function createPosApi(db: RemoteDb, deps: ApiDeps): PosApi {
  const serial = createSerialQueue()
  return {
    bootstrap: () => serial(() => bootstrap(db, deps)),
    setupShop: (input) => serial(() => setupShop(db, deps, input)),
    login: (userId, pin) => serial(() => login(db, deps, userId, pin)),
    openShift: (input) => serial(() => openShift(db, deps, input)),
    loadMenu: () => serial(() => loadMenu(db, deps)),
    commitSale: (input) => serial(() => commitSale(db, deps, input)),
    loadSellCatalog: () => serial(() => loadSellCatalog(db, deps)),
    recordSale: (input) => serial(() => recordSale(db, deps, input)),
    listOrders: () => serial(() => listOrders(db)),
    getOrder: (orderId) => serial(() => getOrder(db, deps, orderId)),
    promptPayForAmount: (amountSatang) => serial(() => promptPayForAmount(db, deps, amountSatang)),
    voidOrder: (input) => serial(() => voidOrder(db, deps, input)),
    cancelSale: (input) => serial(() => cancelSale(db, deps, input)),
    quickOpenShift: (input) => serial(() => quickOpenShift(db, deps, input)),
    recordCashMovement: (input) => serial(() => recordCashMovement(db, deps, input)),
    shiftReport: () => serial(() => shiftReport(db, deps)),
    closeShift: (input) => serial(() => closeShift(db, deps, input)),
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
  }
}
