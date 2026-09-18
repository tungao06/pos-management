import { count } from 'drizzle-orm'
import seedJson from '@dayo/excel-import/seed/dayo-seed.json'
import { parseSeed } from '@dayo/contracts'
import { applySeedSqlite, canonicalSeedOpts, migrateSqliteRemote, seedToRows, type RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'

export async function isSeeded(db: RemoteDb): Promise<boolean> {
  const row = await db.select({ c: count() }).from(s.product).get()
  return (row?.c ?? 0) > 0
}

/**
 * Opening the app: migrate (drizzle migrator, FK-safe — Task 1), then seed the catalog once with the canonical ids
 * that the server uses too (decision T6). applySeedSqlite is one transaction and not idempotent, hence isSeeded.
 */
export async function initDatabase(db: RemoteDb): Promise<{ migrated: string[]; seeded: boolean }> {
  const { applied } = await migrateSqliteRemote(db)
  if (await isSeeded(db)) return { migrated: applied, seeded: false }
  await applySeedSqlite(db, seedToRows(parseSeed(seedJson), canonicalSeedOpts()))
  return { migrated: applied, seeded: true }
}
