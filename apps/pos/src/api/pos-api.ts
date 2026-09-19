import type { RemoteDb } from '@dayo/db-schema/browser'
import { login } from './auth'
import { bootstrap } from './bootstrap'
import { recordCashMovement } from './cash'
import { closeShift, getZReport, listZReports } from './close'
import type { ApiDeps } from './deps'
import { loadMenu } from './menu'
import { getOrder, listOrders } from './orders'
import { commitSale, promptPayForAmount } from './sale'
import { createSerialQueue } from './serial'
import { setupShop } from './setup'
import { openShift, quickOpenShift } from './shift'
import { shiftReport } from './shift-report'
import type { PosApi } from './types'
import { voidOrder } from './void'

export function createPosApi(db: RemoteDb, deps: ApiDeps): PosApi {
  const serial = createSerialQueue()
  return {
    bootstrap: () => serial(() => bootstrap(db)),
    setupShop: (input) => serial(() => setupShop(db, deps, input)),
    login: (userId, pin) => serial(() => login(db, deps, userId, pin)),
    openShift: (input) => serial(() => openShift(db, deps, input)),
    loadMenu: () => serial(() => loadMenu(db, deps)),
    commitSale: (input) => serial(() => commitSale(db, deps, input)),
    listOrders: () => serial(() => listOrders(db)),
    getOrder: (orderId) => serial(() => getOrder(db, orderId)),
    promptPayForAmount: (amountSatang) => serial(() => promptPayForAmount(db, deps, amountSatang)),
    voidOrder: (input) => serial(() => voidOrder(db, deps, input)),
    quickOpenShift: (input) => serial(() => quickOpenShift(db, deps, input)),
    recordCashMovement: (input) => serial(() => recordCashMovement(db, deps, input)),
    shiftReport: () => serial(() => shiftReport(db, deps)),
    closeShift: (input) => serial(() => closeShift(db, deps, input)),
    listZReports: () => serial(() => listZReports(db)),
    getZReport: (shiftId) => serial(() => getZReport(db, shiftId)),
  }
}
