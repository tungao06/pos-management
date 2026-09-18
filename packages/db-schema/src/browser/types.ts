import type { MigrationMeta } from 'drizzle-orm/migrator'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { SqliteRemoteResult } from 'drizzle-orm/sqlite-proxy'

/** A sqlite-proxy database or a transaction on it (both run the same query builders). */
export type RemoteDb = BaseSQLiteDatabase<'async', SqliteRemoteResult, Record<string, never>>

/** drizzle's migration record (sql statements, journal `when`, hash) plus the file tag, bundled at build time. */
export type BundledMigration = MigrationMeta & { tag: string }
