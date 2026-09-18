import initSqlJs, { type Database } from 'sql.js'
import { drizzle as drizzleSqlJs, type SQLJsDatabase } from 'drizzle-orm/sql-js'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite'

/** In-memory SQLite (sql.js, pure WASM — no native build) with foreign keys enforced. */
export async function openSqliteMemory(): Promise<{ db: SQLJsDatabase; raw: Database }> {
  const SQL = await initSqlJs()
  const raw = new SQL.Database()
  raw.run('PRAGMA foreign_keys = ON')
  return { db: drizzleSqlJs(raw), raw }
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

/** Seed options for tests: a plain counter id (positional; only for tests where id stability does not matter). */
export function seedOpts() {
  let n = 0
  return { newId: () => `id-${String(++n).padStart(5, '0')}`, now: '2026-09-17T00:00:00.000Z', effectiveFrom: '2026-09-17T00:00:00.000Z' }
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
