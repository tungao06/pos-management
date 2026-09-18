import { fileURLToPath } from 'node:url'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

export const PG_MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle/pg', import.meta.url))

/** For tests (PGlite). The NestJS app (plan 5) uses drizzle-orm/node-postgres/migrator with the same folder. */
export async function migratePg(db: PgliteDatabase): Promise<void> {
  await migrate(db, { migrationsFolder: PG_MIGRATIONS_FOLDER })
}
