import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import { migrate } from 'drizzle-orm/sql-js/migrator'

export const SQLITE_MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle/sqlite', import.meta.url))

/**
 * Run the device migrations (sql.js in Node tests and scripts; the browser app runs the same drizzle/sqlite/*.sql files).
 *
 * Ownership: this migrator — drizzle's own bookkeeping table `__drizzle_migrations` — is the ONLY owner of device
 * database migrations. Any other runner (e.g. a browser/sqlite-proxy wrapper in plan 3) must follow the same steps
 * and the same `__drizzle_migrations` table, never a second bookkeeping table for the same files.
 *
 * Foreign keys (M12): drizzle-kit emits `PRAGMA foreign_keys=OFF … DROP TABLE … PRAGMA foreign_keys=ON` for ALTERs that
 * recreate a table, but that PRAGMA is a no-op inside the migration transaction, so dropping a referenced table (item,
 * order, …) would fail or cascade. So: turn FKs off OUTSIDE the transaction, run the migrations, run
 * `PRAGMA foreign_key_check` and throw on any violation, then turn FKs back on (always, also on failure).
 * The check runs after drizzle has committed, so a violation means a broken migration that shipped — tests on a
 * seeded DB must catch that before release.
 */
export function migrateSqlite(db: SQLJsDatabase, migrationsFolder: string = SQLITE_MIGRATIONS_FOLDER): void {
  db.run(sql`PRAGMA foreign_keys = OFF`)
  try {
    migrate(db, { migrationsFolder })
    const violations = db.all<Record<string, unknown>>(sql`PRAGMA foreign_key_check`)
    if (violations.length > 0) {
      throw new Error(`migrateSqlite: foreign_key_check found ${violations.length} violation(s), e.g. ${JSON.stringify(violations.slice(0, 3))}`)
    }
  } finally {
    db.run(sql`PRAGMA foreign_keys = ON`)
  }
}
