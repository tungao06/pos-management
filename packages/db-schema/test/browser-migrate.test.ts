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
