import { sql } from 'drizzle-orm'
import type { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core'
import { SQLITE_MIGRATIONS } from './sqlite-migrations.gen.js'
import type { BundledMigration, RemoteDb } from './types.js'

/**
 * drizzle keeps `dialect`/`session` internal. Its own file-based migrators (sql-js, better-sqlite3) run
 * `db.dialect.migrate(readMigrationFiles(config), db.session, config)`; we do the same with the bundled files.
 */
type DrizzleInternals = { dialect: SQLiteAsyncDialect; session: Parameters<SQLiteAsyncDialect['migrate']>[1] }

/**
 * The browser twin of `migrateSqlite` (plan 2, M12): drizzle's migrator and its `__drizzle_migrations` table are the
 * ONLY owner of device migrations. Foreign keys go OFF outside the transaction (the PRAGMA is a no-op inside one, and
 * table-recreate migrations drop referenced tables), every pending migration runs in one transaction, then
 * `PRAGMA foreign_key_check` must be empty, and foreign keys always go back ON. Never call inside a transaction.
 * Returns the tags that were pending (same rule as drizzle: journal `when` > last `created_at`).
 */
export async function migrateSqliteRemote(db: RemoteDb, migrations: readonly BundledMigration[] = SQLITE_MIGRATIONS): Promise<{ applied: string[] }> {
  await db.run(sql`PRAGMA foreign_keys = OFF`)
  try {
    const hasTable = (await db.values(sql`select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'`)).length > 0
    const last = hasTable ? (await db.values<[unknown]>(sql`select created_at from __drizzle_migrations order by created_at desc limit 1`))[0]?.[0] : undefined
    const pending = migrations.filter((m) => last === undefined || last === null || Number(last) < m.folderMillis)
    const { dialect, session } = db as unknown as DrizzleInternals
    await dialect.migrate([...migrations], session)
    const violations = await db.values(sql`PRAGMA foreign_key_check`)
    if (violations.length > 0) {
      throw new Error(`migrateSqliteRemote: foreign_key_check found ${violations.length} violation(s), e.g. ${JSON.stringify(violations.slice(0, 3))}`)
    }
    return { applied: pending.map((m) => m.tag) }
  } finally {
    await db.run(sql`PRAGMA foreign_keys = ON`)
  }
}
