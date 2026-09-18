import type { RemoteDb } from '@dayo/db-schema/browser'
import { bootstrap } from './bootstrap'
import type { ApiDeps } from './deps'
import { createSerialQueue } from './serial'
import type { PosApi } from './types'

export function createPosApi(db: RemoteDb, deps: ApiDeps): PosApi {
  const serial = createSerialQueue()
  void deps
  return {
    bootstrap: () => serial(() => bootstrap(db)),
  }
}
