import type { RemoteDb } from '@dayo/db-schema/browser'
import { login } from './auth'
import { bootstrap } from './bootstrap'
import type { ApiDeps } from './deps'
import { createSerialQueue } from './serial'
import { setupShop } from './setup'
import type { PosApi } from './types'

export function createPosApi(db: RemoteDb, deps: ApiDeps): PosApi {
  const serial = createSerialQueue()
  return {
    bootstrap: () => serial(() => bootstrap(db)),
    setupShop: (input) => serial(() => setupShop(db, deps, input)),
    login: (userId, pin) => serial(() => login(db, deps, userId, pin)),
  }
}
