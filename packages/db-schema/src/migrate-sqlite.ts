import { fileURLToPath } from 'node:url'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import { migrate } from 'drizzle-orm/sql-js/migrator'

export const SQLITE_MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle/sqlite', import.meta.url))

/** For Node tests and scripts (sql.js). The browser app (plan 3) runs the same drizzle/sqlite/*.sql files on SQLite WASM. */
export function migrateSqlite(db: SQLJsDatabase): void {
  migrate(db, { migrationsFolder: SQLITE_MIGRATIONS_FOLDER })
}
