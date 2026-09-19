import type { RemoteDb } from '@dayo/db-schema/browser'
import { login } from './auth'
import { bootstrap } from './bootstrap'
import type { ApiDeps } from './deps'
import { loadMenu } from './menu'
import { getOrder, listOrders } from './orders'
import { commitSale, promptPayForAmount } from './sale'
import { createSerialQueue } from './serial'
import { setupShop } from './setup'
import { openShift, quickOpenShift } from './shift'
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
  }
}
