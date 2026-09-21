import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import initSqlJs from 'sql.js'
import { drizzle as drizzleSqlJs } from 'drizzle-orm/sql-js'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { describe, expect, it } from 'vitest'
import { migrateSqliteRemote, SQLITE_MIGRATIONS, SQLITE_TABLES, SQLITE_TRIGGERS, type BundledMigration } from '../src/browser/index.js'
import { migrateSqlite, SQLITE_MIGRATIONS_FOLDER } from '../src/migrate-sqlite.js'
import { nodeSqliteCallback, type NodeSqliteLike } from '../src/testing/node-sqlite-callback.js'
import { renderMigrationsModule } from '../scripts/render-sqlite-migrations.js'

type Journal = { entries: { tag: string; when: number }[] }
const journal = JSON.parse(readFileSync(join(SQLITE_MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as Journal

function open(raw: DatabaseSync = new DatabaseSync(':memory:')) {
  raw.exec('PRAGMA foreign_keys = ON')
  return { raw, db: drizzle(nodeSqliteCallback(raw as unknown as NodeSqliteLike)) }
}

function names(raw: DatabaseSync, type: 'table' | 'trigger'): string[] {
  return (raw.prepare(`select name from sqlite_master where type = ? and name not like 'sqlite_%' and name not like '__drizzle%' order by name`).all(type) as { name: string }[]).map((r) => r.name)
}

function createdAts(raw: DatabaseSync): number[] {
  return (raw.prepare('select created_at from __drizzle_migrations order by created_at').all() as { created_at: number | string }[]).map((r) => Number(r.created_at))
}

describe('migrateSqliteRemote (drizzle migrator over sqlite-proxy, browser-safe)', () => {
  it('applies every bundled migration and leaves the same tables and triggers as migrateSqlite', async () => {
    const { raw, db } = open()
    const r = await migrateSqliteRemote(db)
    expect(r.applied).toEqual(journal.entries.map((e) => e.tag))
    expect(names(raw, 'table')).toEqual([...SQLITE_TABLES])
    expect(names(raw, 'trigger')).toEqual([...SQLITE_TRIGGERS])
    expect(SQLITE_TABLES).toContain('order')
    expect(SQLITE_TABLES).toContain('outbox')
    expect(SQLITE_TRIGGERS).toContain('order_event_no_update')
    expect(createdAts(raw)).toEqual(journal.entries.map((e) => e.when))
    expect(raw.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })

  it('upgrades a device that already has data: only the new migration runs, rows and append-only triggers survive (plan 4 M-5)', async () => {
    const { raw, db } = open()
    const before = SQLITE_MIGRATIONS.filter((m) => m.tag !== '0002_stock_adjustment')
    await migrateSqliteRemote(db, before) // a device installed before plan 4
    raw.exec(`insert into item (id, code, name, kind, category, use_unit, is_tracked, reorder_point_milli, standard_cost_usat, shelf_life_hours, is_active, note, updated_at)
      values ('i1', 'RM-TEA-01', 'tea', 'raw', 'x', 'g', 1, 0, 19250000, null, 1, null, '2026-09-17T00:00:00.000Z')`)
    raw.exec(`insert into stock_movement (id, item_id, kind, qty_milli, unit_cost_usat, ref_type, ref_id, business_date, device_id, created_by, created_at)
      values ('m1', 'i1', 'SALE', -1000, 19250000, 'order', 'o1', '2026-09-17', null, 'u1', '2026-09-17T03:00:00.000Z')`)
    expect(names(raw, 'table')).not.toContain('stock_adjustment')
    expect((await migrateSqliteRemote(db)).applied).toEqual(['0002_stock_adjustment'])
    expect(names(raw, 'table')).toContain('stock_adjustment')
    expect(raw.prepare('select count(*) as n from stock_movement').get()).toEqual({ n: 1 })
    expect(() => raw.exec(`delete from stock_movement where id = 'm1'`)).toThrow(/append-only/)
    expect(names(raw, 'trigger')).toEqual([...SQLITE_TRIGGERS])
  })

  it('is idempotent', async () => {
    const { db } = open()
    await migrateSqliteRemote(db)
    expect((await migrateSqliteRemote(db)).applied).toEqual([])
  })

  it('shares __drizzle_migrations with migrateSqlite in both directions (one owner of device migrations, M12)', async () => {
    const SQL = await initSqlJs()
    const dir = mkdtempSync(join(tmpdir(), 'dayo-mig-'))
    try {
      // Node migrator (sql.js) first → the browser migrator has nothing left to do.
      const sqljs = new SQL.Database()
      migrateSqlite(drizzleSqlJs(sqljs))
      const a = join(dir, 'a.sqlite3')
      writeFileSync(a, sqljs.export())
      const fromNode = open(new DatabaseSync(a))
      expect((await migrateSqliteRemote(fromNode.db)).applied).toEqual([])
      fromNode.raw.close()

      // Browser migrator first → migrateSqlite adds no row.
      const b = join(dir, 'b.sqlite3')
      const fromBrowser = open(new DatabaseSync(b))
      await migrateSqliteRemote(fromBrowser.db)
      fromBrowser.raw.close()
      const back = new SQL.Database(readFileSync(b))
      migrateSqlite(drizzleSqlJs(back))
      expect(back.exec('select count(*) from __drizzle_migrations')[0]?.values[0]?.[0]).toBe(journal.entries.length)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a failing migration rolls back, is not recorded, and foreign keys are back on', async () => {
    const { raw, db } = open()
    await migrateSqliteRemote(db)
    const bad: BundledMigration = { tag: '9999_bad', sql: ['CREATE TABLE spike_a (x integer);', 'CREATE TABLE spike_a (x integer);'], bps: true, folderMillis: 9_999_999_999_999, hash: 'bad' }
    await expect(migrateSqliteRemote(db, [...SQLITE_MIGRATIONS, bad])).rejects.toThrow()
    expect(raw.prepare("select name from sqlite_master where name = 'spike_a'").all()).toEqual([])
    expect(createdAts(raw)).toEqual(journal.entries.map((e) => e.when))
    expect(raw.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })

  it('throws when the migrations leave a foreign key violation (M12)', async () => {
    const { raw, db } = open()
    await migrateSqliteRemote(db)
    const orphan: BundledMigration = {
      tag: '9998_orphan',
      sql: ["INSERT INTO discount (id, order_id, amount_satang, reason, approved_by) VALUES ('d-x', 'no-such-order', 100, 'x', 'no-such-user')"],
      bps: true,
      folderMillis: 9_999_999_999_998,
      hash: 'orphan',
    }
    await expect(migrateSqliteRemote(db, [...SQLITE_MIGRATIONS, orphan])).rejects.toThrow(/foreign_key_check/)
    expect(raw.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })

  it('the bundled module is fresh (run `pnpm --filter @dayo/db-schema gen:browser` after `generate`)', async () => {
    const onDisk = readFileSync(fileURLToPath(new URL('../src/browser/sqlite-migrations.gen.ts', import.meta.url)), 'utf8')
    expect(onDisk.replace(/\r\n/g, '\n')).toBe(await renderMigrationsModule(SQLITE_MIGRATIONS_FOLDER))
  })
})
