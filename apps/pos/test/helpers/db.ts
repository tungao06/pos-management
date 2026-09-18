import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import type { RemoteDb } from '@dayo/db-schema/browser'
import { nodeSqliteCallback, type NodeSqliteLike } from '@dayo/db-schema/testing'
import type { ApiDeps } from '../../src/api/deps'
import { createPosApi } from '../../src/api/pos-api'
import type { PosApi } from '../../src/api/types'
import { initDatabase } from '../../src/db/init'

/** Tiny argon2 cost so tests stay fast (production uses PROD_PIN_COST). */
export const TEST_PIN_COST = { t: 1, m: 64 } as const

export type TestClock = { now: () => string; set: (iso: string) => void; advanceMs: (ms: number) => void }

export function testClock(startIso = '2026-09-17T03:00:00.000Z'): TestClock {
  let t = Date.parse(startIso)
  return {
    now: () => new Date(t).toISOString(),
    set: (iso) => {
      t = Date.parse(iso)
    },
    advanceMs: (ms) => {
      t += ms
    },
  }
}

export function sequentialIds(prefix = 'id'): () => string {
  let n = 0
  return () => `${prefix}-${String(++n).padStart(6, '0')}`
}

export async function openTestDb(): Promise<{ raw: DatabaseSync; db: RemoteDb; init: { migrated: string[]; seeded: boolean } }> {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  const db = drizzle(nodeSqliteCallback(raw as unknown as NodeSqliteLike))
  const init = await initDatabase(db)
  return { raw, db, init }
}

export type TestApi = { api: PosApi; db: RemoteDb; raw: DatabaseSync; clock: TestClock; deps: ApiDeps }

export async function openTestApi(): Promise<TestApi> {
  const { raw, db } = await openTestDb()
  const clock = testClock()
  const deps: ApiDeps = { now: clock.now, newId: sequentialIds(), pinCost: { ...TEST_PIN_COST } }
  return { api: createPosApi(db, deps), db, raw, clock, deps }
}
