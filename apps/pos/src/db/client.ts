import * as Comlink from 'comlink'
import type { PosApi } from '../api/types'

let remote: PosApi | null = null

/** The Worker-backed PosApi (one Worker per page). */
export function getWorkerApi(): PosApi {
  if (remote === null) {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    remote = Comlink.wrap<PosApi>(worker) as unknown as PosApi
  }
  return remote
}
