import initSqlJs, { type Database } from 'sql.js'
import { drizzle as drizzleSqlJs, type SQLJsDatabase } from 'drizzle-orm/sql-js'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite'
import { drizzle as drizzleProxy, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { deterministicSeedId, type SeedOpts } from '../src/seed/rows.js'

/** In-memory SQLite (sql.js, pure WASM — no native build) with foreign keys enforced. */
export async function openSqliteMemory(): Promise<{ db: SQLJsDatabase; raw: Database }> {
  const SQL = await initSqlJs()
  const raw = new SQL.Database()
  raw.run('PRAGMA foreign_keys = ON')
  return { db: drizzleSqlJs(raw), raw }
}

/**
 * An ASYNC drizzle SQLite database (sqlite-proxy, the driver plan 3 uses in the browser) backed by an in-memory sql.js
 * database — proves the seed helpers work on async drivers without casts.
 */
export async function openSqliteProxyMemory(): Promise<{ db: SqliteRemoteDatabase; raw: Database; syncDb: SQLJsDatabase }> {
  const SQL = await initSqlJs()
  const raw = new SQL.Database()
  raw.run('PRAGMA foreign_keys = ON')
  const db = drizzleProxy(async (query, params, method) => {
    if (method === 'run') { raw.run(query, params as never); return { rows: [] } }
    const stmt = raw.prepare(query)
    try {
      stmt.bind(params as never)
      const rows: unknown[][] = []
      while (stmt.step()) rows.push(stmt.get())
      return { rows: method === 'get' ? (rows[0] ?? []) : rows } as { rows: unknown[] }
    } finally {
      stmt.free()
    }
  })
  return { db, raw, syncDb: drizzleSqlJs(raw) }
}

/** Rows of a raw SQLite query as plain objects. */
export function sqliteRows(raw: Database, query: string): Record<string, unknown>[] {
  const [result] = raw.exec(query)
  if (!result) return []
  return result.values.map((row) => Object.fromEntries(result.columns.map((c, i) => [c, row[i]])))
}

export async function openPglite(): Promise<{ db: PgliteDatabase; client: PGlite }> {
  const client = new PGlite()
  await client.waitReady
  return { db: drizzlePglite(client), client }
}

/** Seed options for tests: the same keyed, deterministic ids the app uses (namespace 'test'). */
export function seedOpts(): SeedOpts {
  return { newId: (kind, key) => deterministicSeedId('test', kind, key), now: '2026-09-17T00:00:00.000Z', effectiveFrom: '2026-09-17T00:00:00.000Z' }
}

/** SQLSTATE of a rejected Postgres query (drizzle wraps the driver error in `cause`), or 'no error'. */
export async function pgErrorCode(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p
    return 'no error'
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } }
    return err.cause?.code ?? err.code ?? String(e)
  }
}
