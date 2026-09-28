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
import { NOW, PLAN4_ORDER_COLUMNS, plan4DeviceWithBills, UNTOUCHED_BILL_TABLES } from './plan4-device.js'

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

  it('upgrades a device that already has data: only the pending migrations run, rows and append-only triggers survive (plan 4 M-5)', async () => {
    const { raw, db } = open()
    // a device installed before plan 4: migrations up to 0001 (drizzle applies by journal time, so a later file cannot stay behind)
    const before = SQLITE_MIGRATIONS.slice(0, SQLITE_MIGRATIONS.findIndex((m) => m.tag === '0002_stock_adjustment'))
    await migrateSqliteRemote(db, before)
    raw.exec(`insert into item (id, code, name, kind, category, use_unit, is_tracked, reorder_point_milli, standard_cost_usat, shelf_life_hours, is_active, note, updated_at)
      values ('i1', 'RM-TEA-01', 'tea', 'raw', 'x', 'g', 1, 0, 19250000, null, 1, null, '2026-09-17T00:00:00.000Z')`)
    raw.exec(`insert into stock_movement (id, item_id, kind, qty_milli, unit_cost_usat, ref_type, ref_id, business_date, device_id, created_by, created_at)
      values ('m1', 'i1', 'SALE', -1000, 19250000, 'order', 'o1', '2026-09-17', null, 'u1', '2026-09-17T03:00:00.000Z')`)
    expect(names(raw, 'table')).not.toContain('stock_adjustment')
    expect((await migrateSqliteRemote(db)).applied).toEqual(SQLITE_MIGRATIONS.slice(before.length).map((m) => m.tag))
    expect((await migrateSqliteRemote(db)).applied).toEqual([])
    expect(names(raw, 'table')).toContain('stock_adjustment')
    expect(raw.prepare('select count(*) as n from stock_movement').get()).toEqual({ n: 1 })
    expect(() => raw.exec(`delete from stock_movement where id = 'm1'`)).toThrow(/append-only/)
    expect(names(raw, 'trigger')).toEqual([...SQLITE_TRIGGERS])
  })

  // The tablet upgrades with this runner, not migrateSqlite: block2.test.ts proves 0003's `order` rebuild on the Node
  // runner; this runs the same plan-3/4 bill through the browser runner (its own foreign_keys OFF/ON handling).
  it('upgrades a plan-3/4 device with a paid bill through block 2: every old order column and child row survives, order_item is append-only', async () => {
    const plan4 = await plan4DeviceWithBills()
    const dir = mkdtempSync(join(tmpdir(), 'dayo-mig-'))
    try {
      const file = join(dir, 'plan4.sqlite3')
      writeFileSync(file, plan4.raw.export())
      const { raw, db } = open(new DatabaseSync(file))
      const rows = (q: string) => raw.prepare(q).all()
      const orderCols = PLAN4_ORDER_COLUMNS.map((c) => `"${c}"`).join(', ')
      const orderBefore = rows(`select ${orderCols} from "order"`)
      expect(Object.values(orderBefore[0]!).filter((v) => v === null)).toEqual([]) // a value in every old column
      const childrenBefore = UNTOUCHED_BILL_TABLES.map((t) => rows(`select * from "${t}" order by id`))
      const outboxBefore = rows(`select * from outbox order by id`)

      const pending = SQLITE_MIGRATIONS.slice(SQLITE_MIGRATIONS.findIndex((m) => m.tag === '0003_block2_central_catalog'))
      expect((await migrateSqliteRemote(db)).applied).toEqual(pending.map((m) => m.tag))
      expect(rows(`select ${orderCols} from "order"`)).toEqual(orderBefore)
      expect(UNTOUCHED_BILL_TABLES.map((t) => rows(`select * from "${t}" order by id`))).toEqual(childrenBefore)
      expect(rows(`select * from outbox order by id`)).toEqual(outboxBefore.map((r) => ({ ...r, status: 'local_only', next_attempt_at: null, parent_key: null, result_json: null })))
      expect(rows('PRAGMA foreign_key_check')).toEqual([])
      expect(raw.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
      expect(names(raw, 'trigger')).toEqual([...SQLITE_TRIGGERS])

      raw.exec(`insert into "order" (id, origin, device_id, receipt_no, queue_no, business_date, shift_id, channel_code, status,
          subtotal_satang, discount_satang, total_satang, vat_satang, cost_satang, created_by_type, created_by_id, created_at, sold_at)
        values ('order-b2', 'device', 'dev-1', 'A-000002', 2, '2026-09-25', 'shift-1', 'store', 'paid', 4500, 0, 4500, 0, 0, 'user', 'u1', '${NOW}', '${NOW}');
        insert into order_item (id, order_id, line_no, menu_code, menu_name_th, size, sweetness, milk, grade, qty, unit_price_satang, discount_per_cup_satang, discount_reason, promotion_id, line_total_satang)
        values ('oi-1', 'order-b2', 1, 'TT01', 'ชาไทย', '16 oz', '100%', 'fresh', null, 1, 4500, 0, null, null, 4500)`)
      expect(() => raw.exec(`update order_item set qty = 2 where id = 'oi-1'`)).toThrow(/order_item is append-only: UPDATE rejected/)
      expect(() => raw.exec(`delete from order_item where id = 'oi-1'`)).toThrow(/order_item is append-only: DELETE rejected/)
      expect(rows(`select qty from order_item`)).toEqual([{ qty: 1 }])
      raw.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
