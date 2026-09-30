import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import initSqlJs, { type Database } from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { migrateSqlite, sqlite as s, SQLITE_MIGRATIONS_FOLDER } from '../src/index.js'
import { migrateSqliteRemote, SQLITE_MIGRATIONS, SQLITE_TRIGGERS } from '../src/browser/index.js'
import { nodeSqliteCallback, type NodeSqliteLike } from '../src/testing/node-sqlite-callback.js'
import type { CentralMismatch } from '../src/sqlite/sales.js'
import { folderUpTo, NOW, one, plan4DeviceWithBills } from './plan4-device.js'
import { sqliteRows } from './helpers.js'

// The migration under test and the one before it come from the journal — never a hardcoded number (review item 14).
const journal = JSON.parse(readFileSync(join(SQLITE_MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
const THIS = journal.entries.find((e) => e.tag.endsWith('_block3_shift_cash'))!
const BEFORE = journal.entries[journal.entries.indexOf(THIS) - 1]!.tag

/** A sql.js device database with the async `all`/`run` the tests below read like (sql.js throws synchronously). */
type TestDb = { raw: Database; all: (q: string) => Promise<Record<string, unknown>[]>; run: (q: string) => Promise<void> }
function wrap(raw: Database): TestDb {
  return { raw, all: async (q) => sqliteRows(raw, q), run: async (q) => { raw.run(q) } }
}
/** A device still on migration `tag` (foreign keys on, like the app). */
async function migratedTo(tag: string): Promise<TestDb> {
  const SQL = await initSqlJs()
  const raw = new SQL.Database()
  raw.run('PRAGMA foreign_keys = ON')
  migrateSqlite(drizzle(raw), folderUpTo(tag))
  return wrap(raw)
}
/** The app update: every migration after the one the device is on. */
async function applyRemaining(db: TestDb): Promise<void> { migrateSqlite(drizzle(db.raw), SQLITE_MIGRATIONS_FOLDER) }
async function migratedAll(): Promise<TestDb> { const db = await migratedTo(BEFORE); await applyRemaining(db); return db }

/** The parents every shift row needs (same shapes as the trigger tests). Idempotent. */
async function seedDeviceAndUser(db: TestDb): Promise<void> {
  await db.run(`insert or ignore into "user" (id, display_name, role, pin_hash, is_active, created_at, updated_at, version) values ('u1', 'Owner', 'owner', 'x', 1, '${NOW}', '${NOW}', 1)`)
  await db.run(`insert or ignore into device (id, name, receipt_prefix, is_selling_device, registered_at, updated_at, version) values ('dev-1', 'Tablet A', 'A', 1, '${NOW}', '${NOW}', 1)`)
}
/** Only the columns every schema since plan 3 has — works before and after the block-3 migration. */
async function seedOpenShift(db: TestDb, o: { shiftId: string }): Promise<void> {
  await seedDeviceAndUser(db)
  await db.run(`insert into shift (id, device_id, business_date, status, opened_by, opened_at, opening_float_satang, closed_by, closed_at)
    values ('${o.shiftId}', 'dev-1', '2026-09-20', 'open', 'u1', '${NOW}', 100000, null, null)`)
}
/** A shift closed the block-2 way (open → closed in one step) with its one count, on the pre-block-3 schema. */
async function seedClosedShiftWithCount(db: TestDb, o: { shiftId: string; countCreatedAt: string }): Promise<void> {
  await seedDeviceAndUser(db)
  await db.run(`insert into shift (id, device_id, business_date, status, opened_by, opened_at, opening_float_satang, closed_by, closed_at)
    values ('${o.shiftId}', 'dev-1', '2026-09-20', 'closed', 'u1', '${NOW}', 100000, 'u1', '${o.countCreatedAt}')`)
  await db.run(`insert into cash_count (id, shift_id, counted_satang, expected_satang, variance_satang, reason, lines_json, counted_by, created_at)
    values ('cc-${o.shiftId}', '${o.shiftId}', 100000, 100000, 0, null, '[]', 'u1', '${o.countCreatedAt}')`)
}
let seq = 0
async function insertCashMovement(db: TestDb, o: { shiftId: string; kind: 'PAID_IN' | 'PAID_OUT' | 'DROP' }): Promise<void> {
  await db.run(`insert into cash_movement (id, shift_id, kind, amount_satang, order_id, reason, created_by, created_at)
    values ('cm-${++seq}', '${o.shiftId}', '${o.kind}', 500, null, 'ทอนเงิน', 'u1', '${NOW}')`)
}
/** A paid block-2 bill (channel_code, no channel_id) on `shiftId` (null = no shift). */
async function insertOrder(db: TestDb, o: { shiftId: string | null }): Promise<string> {
  const n = ++seq
  await db.run(`insert into "order" (id, origin, device_id, receipt_no, queue_no, business_date, shift_id, channel_id, channel_code, status,
      subtotal_satang, discount_satang, total_satang, vat_satang, cost_satang, created_by_type, created_by_id, created_at, sold_at, catalog_version)
    values ('o-${n}', 'device', 'dev-1', 'A-${String(n).padStart(6, '0')}', ${n}, '2026-09-20', ${o.shiftId === null ? 'null' : `'${o.shiftId}'`}, null, 'store', 'paid',
      4500, 0, 4500, 0, 0, 'user', 'u1', '${NOW}', '${NOW}', 42)`)
  return `o-${n}`
}
async function insertCashCount(db: TestDb, o: { id: string; shiftId: string }): Promise<void> {
  await db.run(`insert into cash_count (id, shift_id, counted_satang, expected_satang, variance_satang, reason, lines_json, counted_by, created_at, counted_at, includes_bot_cash)
    values ('${o.id}', '${o.shiftId}', 100000, 100000, 0, null, '[]', 'u1', '${NOW}', '${NOW}', 0)`)
}
const toCounting = (id: string, at: string) => `update shift set status='counting', counted_at='${at}' where id='${id}'`

describe('block 3 migration (D101 · spec §4.10 ข้อ 4)', () => {
  it('is found in the journal right after the block-2 migrations', () => {
    expect(THIS.tag).toMatch(/^\d{4}_block3_shift_cash$/)
    expect(BEFORE).toBe('0005_order_central_dayo_edit')
  })
  it('every shift from before it becomes local_only; closed shifts get counted_at from their count', async () => {
    const db = await migratedTo(BEFORE)
    await seedClosedShiftWithCount(db, { shiftId: 'sh1', countCreatedAt: '2026-09-20T12:00:00.000Z' })
    await seedOpenShift(db, { shiftId: 'sh2' })
    await applyRemaining(db)
    expect(await db.all(`select id, sync_mode, counted_at, status from shift order by id`)).toEqual([
      { id: 'sh1', sync_mode: 'local_only', counted_at: '2026-09-20T12:00:00.000Z', status: 'closed' },
      { id: 'sh2', sync_mode: 'local_only', counted_at: null, status: 'open' },
    ])
    expect(await db.all(`select counted_at, includes_bot_cash from cash_count`)).toEqual([{ counted_at: '2026-09-20T12:00:00.000Z', includes_bot_cash: 0 }])
  })
  it('a closed shift with no count keeps counted_at null (nothing is guessed)', async () => {
    const db = await migratedTo(BEFORE)
    await seedDeviceAndUser(db)
    await db.run(`insert into shift (id, device_id, business_date, status, opened_by, opened_at, opening_float_satang, closed_by, closed_at)
      values ('sh0', 'dev-1', '2026-09-19', 'closed', 'u1', '${NOW}', 0, 'u1', '${NOW}')`)
    await applyRemaining(db)
    expect(await db.all(`select id, sync_mode, counted_at from shift`)).toEqual([{ id: 'sh0', sync_mode: 'local_only', counted_at: null }])
  })
  it('a real device upgrades without losing a row or a value: ADD COLUMN only, rowid order kept, old indexes and triggers unchanged', async () => {
    const { raw, db } = await plan4DeviceWithBills()
    migrateSqlite(db, folderUpTo(BEFORE))
    // every column of every bill/shift/cash table holds a value, so a dropped or swapped column cannot hide behind a NULL
    raw.exec(`update "order" set sold_at = '${NOW}', catalog_version = 42, channel_code = 'store', payment_code = 'cash', pricing_json = '{"draft":{},"priced":{}}',
      excluded_at = '${NOW}', central_order_no = 'D260920-001', central_computed_total_satang = 4500, central_amount_mismatch = 0,
      central_duplicate_of_json = '["L260920-001"]', central_dayo_edit_json = '{"kind":"cancel"}' where id = 'order-1'`)
    raw.exec(`insert into shift (id, device_id, business_date, status, opened_by, opened_at, opening_float_satang, closed_by, closed_at)
      values ('shift-0', 'dev-1', '2026-09-19', 'closed', 'u1', '2026-09-19T01:00:00.000Z', 50000, 'u1', '2026-09-19T12:00:00.000Z')`)
    raw.exec(`insert into cash_count (id, shift_id, counted_satang, expected_satang, variance_satang, reason, lines_json, counted_by, created_at)
      values ('cc-0', 'shift-0', 49000, 50000, -1000, 'ทอนผิด', '[{"denominationSatang":100000,"count":0}]', 'u1', '2026-09-19T11:59:00.000Z')`)
    raw.exec(`insert into z_report (id, shift_id, snapshot_json, hash, created_at) values ('z-0', 'shift-0', '{}', '${'a'.repeat(64)}', '2026-09-19T12:00:00.000Z')`)
    const tables = one(raw, `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name`).map((r) => String(r[0]))
    const columnsOf = (t: string) => one(raw, `select name from pragma_table_info('${t}') order by cid`).map((r) => String(r[0]))
    const oldColumns = new Map(tables.map((t) => [t, columnsOf(t)]))
    const dump = () => tables.map((t) => [t, one(raw, `select rowid, ${oldColumns.get(t)!.map((c) => `"${c}"`).join(', ')} from "${t}" order by rowid`)])
    for (const t of ['order', 'shift', 'cash_count']) {
      for (const row of one(raw, `select * from "${t}"`).filter((r) => r[0] !== 'shift-1')) expect(row.filter((v) => v === null), t).toEqual([])
    }
    const before = dump()
    const objectsBefore = one(raw, `select type, name, tbl_name, sql from sqlite_master where name not like 'sqlite_%' and type <> 'table' order by type, name`)
    const tableSqlBefore = one(raw, `select name, sql from sqlite_master where type = 'table' and name not in ('shift', 'cash_count', 'order') order by name`)

    migrateSqlite(db, folderUpTo(THIS.tag)) // up to block 3 only — 0007 (payment rebuild) is zero-bill.test.ts

    expect(dump()).toEqual(before) // same rows, same rowids, every old value
    expect(columnsOf('shift')).toEqual([...oldColumns.get('shift')!, 'counted_at', 'sync_mode'])
    expect(columnsOf('cash_count')).toEqual([...oldColumns.get('cash_count')!, 'counted_at', 'includes_bot_cash'])
    expect(columnsOf('order')).toEqual([...oldColumns.get('order')!, 'off_catalog_at', 'central_mismatch_json'])
    expect(one(raw, `select name, type, "notnull", dflt_value from pragma_table_info('shift') where name in ('counted_at', 'sync_mode') order by cid`))
      .toEqual([['counted_at', 'TEXT', 0, null], ['sync_mode', 'TEXT', 1, "'local_only'"]])
    expect(one(raw, `select name, type, "notnull", dflt_value from pragma_table_info('cash_count') where name in ('counted_at', 'includes_bot_cash') order by cid`))
      .toEqual([['counted_at', 'TEXT', 0, null], ['includes_bot_cash', 'INTEGER', 1, 'false']])
    expect(one(raw, `select id, status, sync_mode, counted_at from shift order by id`)).toEqual([
      ['shift-0', 'closed', 'local_only', '2026-09-19T11:59:00.000Z'],
      ['shift-1', 'open', 'local_only', null],
    ])
    expect(one(raw, `select id, counted_at, includes_bot_cash from cash_count`)).toEqual([['cc-0', '2026-09-19T11:59:00.000Z', 0]])
    expect(one(raw, `select off_catalog_at, central_mismatch_json from "order"`)).toEqual([[null, null]])
    const objectsAfter = one(raw, `select type, name, tbl_name, sql from sqlite_master where name not like 'sqlite_%' and type <> 'table' order by type, name`)
    expect(objectsAfter.filter((o) => objectsBefore.some((b) => b[1] === o[1]))).toEqual(objectsBefore) // nothing old changed or vanished
    expect(objectsAfter.filter((o) => !objectsBefore.some((b) => b[1] === o[1])).map((o) => `${String(o[0])} ${String(o[1])}`).sort()).toEqual([
      'index cash_count_shift_uq', 'index shift_counting_uq',
      'trigger cash_count_no_delete', 'trigger cash_count_no_update', 'trigger cash_movement_open_shift_only', 'trigger order_open_shift_only',
      'trigger outbox_row_json_frozen', 'trigger shift_counted_at_once', 'trigger shift_status_forward_only', 'trigger shift_sync_mode_one_way', 'trigger shift_sync_mode_valid',
    ])
    expect(one(raw, `select name, sql from sqlite_master where type = 'table' and name not in ('shift', 'cash_count', 'order') order by name`)).toEqual(tableSqlBefore)
    expect(one(raw, `PRAGMA foreign_key_check`)).toEqual([])
    expect(one(raw, `PRAGMA foreign_keys`)).toEqual([[1]])
  })
  it('the tablet own runner (browser bundle over sqlite-proxy) applies it to a device on the previous migration the same way', async () => {
    expect(SQLITE_MIGRATIONS.map((m) => m.tag)).toContain(THIS.tag) // the regenerated bundle carries it
    const triggersOfFresh = (await (await migratedTo(THIS.tag)).all(`select name from sqlite_master where type = 'trigger' order by name`)).map((r) => String(r['name']))
    expect(triggersOfFresh.length).toBeLessThan(SQLITE_TRIGGERS.length) // later migrations add more (0007)
    const { raw: old, db: oldDb } = await plan4DeviceWithBills()
    migrateSqlite(oldDb, folderUpTo(BEFORE))
    old.exec(`insert into shift (id, device_id, business_date, status, opened_by, opened_at, opening_float_satang, closed_by, closed_at)
      values ('shift-0', 'dev-1', '2026-09-19', 'closed', 'u1', '2026-09-19T01:00:00.000Z', 50000, 'u1', '2026-09-19T12:00:00.000Z')`)
    old.exec(`insert into cash_count (id, shift_id, counted_satang, expected_satang, variance_satang, reason, lines_json, counted_by, created_at)
      values ('cc-0', 'shift-0', 50000, 50000, 0, null, '[]', 'u1', '2026-09-19T11:59:00.000Z')`)
    const dir = mkdtempSync(join(tmpdir(), 'dayo-mig-'))
    try {
      const file = join(dir, 'b2.sqlite3')
      writeFileSync(file, old.export())
      const raw = new DatabaseSync(file)
      try {
        raw.exec('PRAGMA foreign_keys = ON')
        const rows = (q: string) => raw.prepare(q).all()
        const shiftBefore = rows(`select rowid, * from shift order by rowid`)
        const countBefore = rows(`select rowid, * from cash_count order by rowid`)
        const orderBefore = rows(`select rowid, * from "order" order by rowid`)
        const upToThis = SQLITE_MIGRATIONS.slice(0, SQLITE_MIGRATIONS.findIndex((m) => m.tag === THIS.tag) + 1) // 0007 is zero-bill.test.ts
        expect((await migrateSqliteRemote(drizzleProxy(nodeSqliteCallback(raw as unknown as NodeSqliteLike)), upToThis)).applied).toEqual([THIS.tag])
        expect(rows(`select rowid, * from shift order by rowid`)).toEqual(shiftBefore.map((r) => ({ ...r, counted_at: r['id'] === 'shift-0' ? '2026-09-19T11:59:00.000Z' : null, sync_mode: 'local_only' })))
        expect(rows(`select rowid, * from cash_count order by rowid`)).toEqual(countBefore.map((r) => ({ ...r, counted_at: '2026-09-19T11:59:00.000Z', includes_bot_cash: 0 })))
        expect(rows(`select rowid, * from "order" order by rowid`)).toEqual(orderBefore.map((r) => ({ ...r, off_catalog_at: null, central_mismatch_json: null })))
        expect((raw.prepare(`select name from sqlite_master where type = 'trigger' order by name`).all() as { name: string }[]).map((r) => r.name)).toEqual(triggersOfFresh)
        expect(rows('PRAGMA foreign_key_check')).toEqual([])
        expect(raw.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
      } finally {
        raw.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('block 3 freeze rules on the tablet (D101 · R2 · R5)', () => {
  it('shift status only moves forward; counted_at is set once', async () => {
    const db = await migratedAll(); await seedOpenShift(db, { shiftId: 's' })
    await db.run(toCounting('s', '2026-09-25T12:00:00.000Z'))
    await expect(db.run(`update shift set status='open' where id='s'`)).rejects.toThrow(/forward/)
    await expect(db.run(`update shift set counted_at='2026-09-25T13:00:00.000Z' where id='s'`)).rejects.toThrow(/once/)
    await db.run(`update shift set status='counted' where id='s'`)
    await db.run(`update shift set status='closed' where id='s'`)
    await expect(db.run(`update shift set status='counted' where id='s'`)).rejects.toThrow(/forward/)
    await expect(db.run(`update shift set status='open' where id='s'`)).rejects.toThrow(/forward/)
    expect(await db.all(`select status, counted_at from shift where id='s'`)).toEqual([{ status: 'closed', counted_at: '2026-09-25T12:00:00.000Z' }])
  })
  it('counted_at cannot be cleared; a status outside the four is refused; the same value again is fine', async () => {
    const db = await migratedAll(); await seedOpenShift(db, { shiftId: 's' })
    await expect(db.run(`update shift set status='paused' where id='s'`)).rejects.toThrow(/forward/)
    await db.run(toCounting('s', '2026-09-25T12:00:00.000Z'))
    await expect(db.run(`update shift set counted_at=null where id='s'`)).rejects.toThrow(/once/)
    await db.run(`update shift set counted_at='2026-09-25T12:00:00.000Z', status='counted' where id='s'`) // no change of counted_at
    expect(await db.all(`select status, counted_at from shift`)).toEqual([{ status: 'counted', counted_at: '2026-09-25T12:00:00.000Z' }])
  })
  it('a shift closed without a count moment is refused (final fix S3): the old open → closed step with no counted_at', async () => {
    const db = await migratedAll(); await seedOpenShift(db, { shiftId: 's' })
    await expect(db.run(`update shift set status='closed', closed_by='u1', closed_at='${NOW}' where id='s'`)).rejects.toThrow(/counted_at/)
    expect(await db.all(`select status, counted_at from shift`)).toEqual([{ status: 'open', counted_at: null }])
    await db.run(`update shift set status='closed', counted_at='${NOW}', closed_by='u1', closed_at='${NOW}' where id='s'`) // with its count moment: fine
    expect(await db.all(`select status, counted_at from shift`)).toEqual([{ status: 'closed', counted_at: NOW }])
  })
  it('an old closed shift the backfill left without counted_at stays readable and untouched (final fix S3)', async () => {
    const db = await migratedTo(BEFORE)
    await seedDeviceAndUser(db)
    await db.run(`insert into shift (id, device_id, business_date, status, opened_by, opened_at, opening_float_satang, closed_by, closed_at)
      values ('sh0', 'dev-1', '2026-09-19', 'closed', 'u1', '${NOW}', 0, 'u1', '${NOW}')`)
    await applyRemaining(db)
    await db.run(`update shift set sync_mode='local_only' where id='sh0'`) // an UPDATE that leaves status alone never meets the guard
    await expect(db.run(`update shift set status='closed' where id='sh0'`)).rejects.toThrow(/counted_at/)
    expect(await db.all(`select status, counted_at from shift`)).toEqual([{ status: 'closed', counted_at: null }])
  })
  it('a counting shift takes no bill and no cash movement (D101)', async () => {
    const db = await migratedAll(); await seedOpenShift(db, { shiftId: 's' })
    await db.run(toCounting('s', '2026-09-25T12:00:00.000Z'))
    await expect(insertCashMovement(db, { shiftId: 's', kind: 'PAID_OUT' })).rejects.toThrow(/open shift/)
    await expect(insertOrder(db, { shiftId: 's' })).rejects.toThrow(/open shift/)
  })
  it('neither does a counted or closed shift — not even a VOID_REFUND; an open shift and a bill with no shift do', async () => {
    const db = await migratedAll(); await seedOpenShift(db, { shiftId: 's' })
    const bill = await insertOrder(db, { shiftId: 's' })
    await insertCashMovement(db, { shiftId: 's', kind: 'PAID_IN' })
    await db.run(toCounting('s', '2026-09-25T12:00:00.000Z'))
    await db.run(`update shift set status='counted' where id='s'`)
    const refund = `insert into cash_movement (id, shift_id, kind, amount_satang, order_id, reason, created_by, created_at) values ('vr', 's', 'VOID_REFUND', 4500, '${bill}', 'x', 'u1', '${NOW}')`
    await expect(db.run(refund)).rejects.toThrow(/open shift/)
    await db.run(`update shift set status='closed' where id='s'`)
    await expect(db.run(refund)).rejects.toThrow(/open shift/)
    await expect(insertCashMovement(db, { shiftId: 's', kind: 'DROP' })).rejects.toThrow(/open shift/)
    await expect(insertOrder(db, { shiftId: 's' })).rejects.toThrow(/open shift/)
    await insertOrder(db, { shiftId: null }) // a bill with no shift is not a shift's bill
    await expect(insertCashMovement(db, { shiftId: 'no-such-shift', kind: 'PAID_IN' })).rejects.toThrow(/open shift/)
    expect(await db.all(`select count(*) as n from cash_movement`)).toEqual([{ n: 1 }])
  })
  it('one count per shift; cash_count is append-only', async () => {
    const db = await migratedAll(); await seedOpenShift(db, { shiftId: 's' })
    await insertCashCount(db, { id: 'c1', shiftId: 's' })
    await expect(insertCashCount(db, { id: 'c2', shiftId: 's' })).rejects.toThrow(/UNIQUE/)
    await expect(db.run(`update cash_count set counted_satang = 1`)).rejects.toThrow(/append-only/)
    await expect(db.run(`delete from cash_count`)).rejects.toThrow(/append-only/)
    expect(await db.all(`select id, counted_satang from cash_count`)).toEqual([{ id: 'c1', counted_satang: 100000 }])
  })
  it('one counting shift per device (R2)', async () => {
    const db = await migratedAll(); await seedOpenShift(db, { shiftId: 'a' })
    await db.run(toCounting('a', '2026-09-25T12:00:00.000Z'))
    await seedOpenShift(db, { shiftId: 'b' })
    await expect(db.run(toCounting('b', '2026-09-25T13:00:00.000Z'))).rejects.toThrow(/UNIQUE/)
    await db.run(`update shift set status='counted' where id='a'`)
    await db.run(toCounting('b', '2026-09-25T13:00:00.000Z')) // a counted shift no longer holds the slot
  })
  it('the new columns round-trip through drizzle: sync_mode defaults to local_only, includes_bot_cash to false', async () => {
    const db = await migratedAll(); await seedDeviceAndUser(db)
    const d = drizzle(db.raw)
    d.insert(s.shift).values({ id: 'sd', deviceId: 'dev-1', businessDate: '2026-09-25', status: 'open', openedBy: 'u1', openedAt: NOW, openingFloatSatang: 0 }).run()
    d.insert(s.shift).values({ id: 'sc', deviceId: 'dev-1', businessDate: '2026-09-25', status: 'closed', openedBy: 'u1', openedAt: NOW, openingFloatSatang: 0, syncMode: 'central' }).run()
    expect(d.select({ id: s.shift.id, m: s.shift.syncMode, c: s.shift.countedAt }).from(s.shift).orderBy(s.shift.id).all())
      .toEqual([{ id: 'sc', m: 'central', c: null }, { id: 'sd', m: 'local_only', c: null }])
    d.insert(s.cashCount).values({ id: 'cc', shiftId: 'sd', countedSatang: 0, expectedSatang: 0, varianceSatang: 0, linesJson: [], countedBy: 'u1', createdAt: NOW, countedAt: NOW }).run()
    expect(d.select({ b: s.cashCount.includesBotCash, at: s.cashCount.countedAt }).from(s.cashCount).get()).toEqual({ b: false, at: NOW })
    const bill = await insertOrder(db, { shiftId: 'sd' })
    const mismatch: CentralMismatch = { orderNo: 'D260925-001', reportedTotalSatang: 4000, paymentIsCash: false, localTotalSatang: 4500, localPaymentIsCash: true }
    d.update(s.order).set({ centralMismatchJson: mismatch, offCatalogAt: NOW }).where(eq(s.order.id, bill)).run()
    expect(d.select({ m: s.order.centralMismatchJson, at: s.order.offCatalogAt }).from(s.order).where(eq(s.order.id, bill)).get()).toEqual({ m: mismatch, at: NOW })
  })
  it('counting, counted and closed all need counted_at (D101 · final fix S3)', async () => {
    const db = await migratedAll(); await seedOpenShift(db, { shiftId: 's' })
    await expect(db.run(`update shift set status='counting' where id='s'`)).rejects.toThrow(/counted_at/)
    await expect(db.run(`update shift set status='counted' where id='s'`)).rejects.toThrow(/counted_at/)
    await expect(db.run(`update shift set status='closed', closed_by='u1', closed_at='${NOW}' where id='s'`)).rejects.toThrow(/counted_at/)
    expect(await db.all(`select status, counted_at from shift`)).toEqual([{ status: 'open', counted_at: null }])
  })
  it('sync_mode moves central → local_only only (R1 · R19); a value outside the two is refused on insert and update', async () => {
    const db = await migratedAll(); await seedDeviceAndUser(db)
    const insertShift = (id: string, status: string, mode: string) => db.run(`insert into shift (id, device_id, business_date, status, opened_by, opened_at, opening_float_satang, sync_mode)
      values ('${id}', 'dev-1', '2026-09-25', '${status}', 'u1', '${NOW}', 0, '${mode}')`)
    await expect(insertShift('bad', 'closed', 'Central')).rejects.toThrow(/sync_mode must be/)
    await expect(insertShift('bad', 'closed', '')).rejects.toThrow(/sync_mode must be/)
    await insertShift('loc', 'closed', 'local_only')
    await insertShift('cen', 'open', 'central')
    await expect(db.run(`update shift set sync_mode='central' where id='loc'`)).rejects.toThrow(/only moves central → local_only/)
    await expect(db.run(`update shift set sync_mode='other' where id='cen'`)).rejects.toThrow(/only moves central → local_only/)
    await db.run(`update shift set sync_mode='central' where id='cen'`) // same value: no move
    await db.run(`update shift set sync_mode='local_only' where id='cen'`) // R19: the owner keeps a stuck shift on the tablet
    await expect(db.run(`update shift set sync_mode='central' where id='cen'`)).rejects.toThrow(/only moves central → local_only/)
    await db.run(`update shift set status='closed', counted_at='${NOW}' where id='cen'`) // one open shift per device: close it before the next
    await seedOpenShift(db, { shiftId: 'dflt' }) // no sync_mode given: the default passes the insert guard
    expect(await db.all(`select id, sync_mode from shift order by id`)).toEqual([
      { id: 'cen', sync_mode: 'local_only' }, { id: 'dflt', sync_mode: 'local_only' }, { id: 'loc', sync_mode: 'local_only' },
    ])
  })
  it('outbox row_json is frozen once dayo stored the row or the owner closed it off-catalog (spec §6.1 · final fix S4)', async () => {
    const db = await migratedAll()
    const statuses = ['pending', 'dead', 'local_only', 'sent', 'closed_off_catalog'] as const
    for (const st of statuses) {
      await db.run(`insert into outbox (id, table_name, row_json, idempotency_key, status, created_at, attempts) values ('ob-${st}', 'order', '{"v":1}', 'order:${st}', '${st}', '${NOW}', 0)`)
    }
    for (const st of ['sent', 'closed_off_catalog']) {
      await expect(db.run(`update outbox set row_json='{"v":2}' where id='ob-${st}'`)).rejects.toThrow(/row_json is frozen/)
      await expect(db.run(`update outbox set row_json=row_json, status='pending' where id='ob-${st}'`)).rejects.toThrow(/row_json is frozen/) // naming the column is enough
      await db.run(`update outbox set result_json='{"order_no":"L260925-001"}', last_error=null where id='ob-${st}'`) // every other column stays writable
    }
    for (const st of ['pending', 'dead', 'local_only']) await db.run(`update outbox set row_json='{"v":2}' where id='ob-${st}'`) // the owner's remedies rewrite these
    await db.run(`update outbox set status='sent' where id='ob-pending'`) // a pending row still becomes sent
    expect(await db.all(`select id, row_json, status from outbox order by id`)).toEqual([
      { id: 'ob-closed_off_catalog', row_json: '{"v":1}', status: 'closed_off_catalog' },
      { id: 'ob-dead', row_json: '{"v":2}', status: 'dead' },
      { id: 'ob-local_only', row_json: '{"v":2}', status: 'local_only' },
      { id: 'ob-pending', row_json: '{"v":2}', status: 'sent' },
      { id: 'ob-sent', row_json: '{"v":1}', status: 'sent' },
    ])
  })
  it('foreign_key_check stays empty', async () => { const db = await migratedAll(); expect(await db.all('pragma foreign_key_check')).toEqual([]) })
})
