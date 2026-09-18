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
