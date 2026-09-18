import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { parseSeed, type Seed } from '@dayo/contracts'
import { migratePg } from '../src/migrate-pg.js'
import { migrateSqlite, SQLITE_MIGRATIONS_FOLDER } from '../src/migrate-sqlite.js'
import * as pg from '../src/pg/index.js'
import * as sqlite from '../src/sqlite/index.js'
import { applySeedSqlite } from '../src/seed/apply-sqlite.js'
import { seedToRows } from '../src/seed/rows.js'
import { openPglite, openSqliteMemory, seedOpts, sqliteRows } from './helpers.js'

// 36 shared tables (18 reference + 7 stock + 10 sales/shift + audit_log) + 2 dialect-only tables per side.
const TABLES_PER_DIALECT = 38
/** Largest usat value in the shop's file (Global Constraints) — above 2^31, so it needs a 64-bit column. */
const BIG_USAT = 2_499_000_000

const seed: Seed = parseSeed(JSON.parse(readFileSync(fileURLToPath(new URL('../../excel-import/seed/dayo-seed.json', import.meta.url)), 'utf8')))
const bigItem = {
  id: 'big', code: 'RM-BIG', name: 'big', kind: 'raw' as const, category: 'x', useUnit: 'g' as const, isTracked: true,
  reorderPointMilli: 0, standardCostUsat: BIG_USAT, shelfLifeHours: null, isActive: true, note: null,
}

describe('migrations', () => {
  it('sqlite: creates all 38 tables and the FK from cash_movement to order', async () => {
    const { db, raw } = await openSqliteMemory()
    migrateSqlite(db)
    const names = sqliteRows(raw, `select name from sqlite_master where type = 'table' and name not like '__drizzle%' and name not like 'sqlite_%' order by name`).map((r) => r['name'] as string)
    expect(names).toContain('order')
    expect(names).toContain('outbox')
    expect(names).not.toContain('invariant_run')
    expect(names).toHaveLength(TABLES_PER_DIALECT)
    const fks = sqliteRows(raw, `select "table", "from" from pragma_foreign_key_list('cash_movement')`)
    expect(fks).toContainEqual({ table: 'order', from: 'order_id' })
  })
  it('pg: creates all 38 tables', async () => {
    const { db, client } = await openPglite()
    await migratePg(db)
    const r = await db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`)
    const names = r.rows.map((x) => x.table_name)
    expect(names).toContain('order')
    expect(names).toContain('invariant_run')
    expect(names).not.toContain('outbox')
    expect(names).toHaveLength(TABLES_PER_DIALECT)
    await client.close()
  })

  it('sqlite: running migrate twice is a no-op', async () => {
    const { db, raw } = await openSqliteMemory()
    migrateSqlite(db)
    const before = sqliteRows(raw, 'select count(*) as n from __drizzle_migrations')[0]!['n']
    migrateSqlite(db)
    expect(sqliteRows(raw, 'select count(*) as n from __drizzle_migrations')[0]!['n']).toBe(before)
    expect(sqliteRows(raw, `select count(*) as n from sqlite_master where type = 'table' and name not like '__drizzle%' and name not like 'sqlite_%'`)[0]!['n']).toBe(TABLES_PER_DIALECT)
  })
  it('pg: running migrate twice is a no-op', async () => {
    const { db, client } = await openPglite()
    try {
      await migratePg(db)
      const count = async () => (await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows[0]!.n
      const before = await count()
      await migratePg(db)
      expect(await count()).toBe(before)
    } finally {
      await client.close()
    }
  })

  it('sqlite: a usat value above 2^31 round-trips exactly', async () => {
    const { db } = await openSqliteMemory()
    migrateSqlite(db)
    db.insert(sqlite.item).values(bigItem).run()
    expect(db.select().from(sqlite.item).where(eq(sqlite.item.id, 'big')).get()!.standardCostUsat).toBe(BIG_USAT)
  })
  it('pg: a usat value above 2^31 round-trips exactly (bigint column, JS number)', async () => {
    const { db, client } = await openPglite()
    try {
      await migratePg(db)
      await db.insert(pg.item).values(bigItem)
      const [row] = await db.select().from(pg.item).where(eq(pg.item.id, 'big'))
      expect(row!.standardCostUsat).toBe(BIG_USAT)
    } finally {
      await client.close()
    }
  })
})

describe('migrateSqlite: table-recreate migrations with foreign keys (M12)', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  /** The committed migrations plus one extra hand-written migration, in a temp folder. */
  function folderWithExtra(tag: string, statements: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'dayo-mig-'))
    dirs.push(dir)
    cpSync(SQLITE_MIGRATIONS_FOLDER, dir, { recursive: true })
    const journalPath = join(dir, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] }
    const last = journal.entries[journal.entries.length - 1]!
    journal.entries.push({ idx: last.idx + 1, version: last.version, when: last.when + 1000, tag, breakpoints: true })
    writeFileSync(journalPath, JSON.stringify(journal, null, 2))
    writeFileSync(join(dir, `${tag}.sql`), statements.join('\n--> statement-breakpoint\n'))
    return dir
  }

  async function seededDb() {
    const { db, raw } = await openSqliteMemory() // foreign_keys = ON, like the app
    migrateSqlite(db)
    await applySeedSqlite(db, seedToRows(seed, seedOpts()))
    return { db, raw }
  }

  it('recreates a referenced table (the way drizzle-kit does) on a DB with data', async () => {
    const { db, raw } = await seededDb()
    const dir = folderWithExtra('0099_recreate_item', [
      'PRAGMA foreign_keys=OFF;',
      "CREATE TABLE `__new_item` (`id` text PRIMARY KEY NOT NULL, `code` text NOT NULL, `name` text NOT NULL, `kind` text NOT NULL, `category` text NOT NULL, `use_unit` text NOT NULL, `is_tracked` integer NOT NULL, `reorder_point_milli` integer NOT NULL, `standard_cost_usat` integer NOT NULL, `shelf_life_hours` integer, `is_active` integer NOT NULL, `note` text);",
      'INSERT INTO `__new_item` SELECT * FROM `item`;',
      'DROP TABLE `item`;',
      'ALTER TABLE `__new_item` RENAME TO `item`;',
      'CREATE UNIQUE INDEX `item_code_unique` ON `item` (`code`);',
      'PRAGMA foreign_keys=ON;',
    ])
    migrateSqlite(db, dir)
    expect(sqliteRows(raw, 'select count(*) as n from item')[0]!['n']).toBe(45)
    expect(sqliteRows(raw, 'PRAGMA foreign_key_check')).toEqual([])
    expect(sqliteRows(raw, 'PRAGMA foreign_keys')[0]!['foreign_keys']).toBe(1)
  })

  it('throws when a migration leaves dangling foreign keys, and turns foreign keys back on', async () => {
    const { db, raw } = await seededDb()
    const dir = folderWithExtra('0099_break_fk', ['DELETE FROM `category`;'])
    expect(() => migrateSqlite(db, dir)).toThrow(/foreign_key_check/)
    expect(sqliteRows(raw, 'PRAGMA foreign_keys')[0]!['foreign_keys']).toBe(1)
  })
})
