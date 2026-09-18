import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import * as Comlink from 'comlink'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { oo1Callback, type Oo1Database } from '@dayo/db-schema/browser'
import { PROD_PIN_COST } from '../api/deps'
import { PosError } from '../api/errors'
import { createPosApi } from '../api/pos-api'
import { POS_API_METHODS, type PosApi } from '../api/types'
import { newId } from '../lib/ids'
import { initDatabase } from './init'

const DB_FILE = '/dayo-pos.sqlite3'

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>
type PoolOpts = Parameters<Sqlite3['installOpfsSAHPoolVfs']>[0]

/** A reload can race the previous page's worker for the OPFS access handles: retry with backoff, forcing re-init. */
async function openPool(sqlite3: Sqlite3) {
  let last: unknown
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      // forceReinitIfPreviouslyFailed exists at runtime but not in the .d.ts, hence the assertion.
      return await sqlite3.installOpfsSAHPoolVfs({ name: 'dayo-pos', forceReinitIfPreviouslyFailed: true } as PoolOpts)
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 250 * attempt))
    }
  }
  throw last
}

async function start(): Promise<PosApi> {
  try {
    const sqlite3 = await sqlite3InitModule()
    const pool = await openPool(sqlite3)
    const raw = new pool.OpfsSAHPoolDb(DB_FILE)
    raw.exec('PRAGMA foreign_keys = ON')
    const db = drizzle(oo1Callback(raw as unknown as Oo1Database))
    await initDatabase(db)
    return createPosApi(db, { now: () => new Date().toISOString(), newId, pinCost: PROD_PIN_COST })
  } catch (e) {
    throw new PosError('DB_OPEN_FAILED', e instanceof Error ? `${e.name}: ${e.message}` : String(e))
  }
}

const ready = start()
ready.catch(() => undefined) // the rejection is delivered to every caller below

const exposed: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
for (const method of POS_API_METHODS) {
  exposed[method] = async (...args: unknown[]) => {
    const api = await ready
    return (api[method] as (...a: unknown[]) => Promise<unknown>)(...args)
  }
}
Comlink.expose(exposed)
