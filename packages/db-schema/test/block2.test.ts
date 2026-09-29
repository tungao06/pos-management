import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { migrateSqlite, sqlite as s, SQLITE_MIGRATIONS_FOLDER } from '../src/index.js'
import type { DayoEdit } from '@dayo/contracts'
import { BILL_TABLES, folderUpTo, NOW, one, PLAN4_ORDER_COLUMNS, plan4DeviceWithBills, UNTOUCHED_BILL_TABLES } from './plan4-device.js'

async function freshDb() { const SQL = await initSqlJs(); return new SQL.Database() }
const orderColumns = (raw: import('sql.js').Database) => one(raw, `select name from pragma_table_info('order') order by cid`).map((r) => String(r[0]))
const selectList = (cols: string[]) => cols.map((c) => `"${c}"`).join(', ')
const orderItemCount = (raw: import('sql.js').Database) => Number(one(raw, `select count(*) from order_item`)[0]![0])
/** Every table, index and trigger with its SQL, for "nothing else changed" checks. */
const schemaObjects = (raw: import('sql.js').Database) => one(raw, `select type, name, sql from sqlite_master where name not like 'sqlite_%' order by type, name`)
/** A paid block-2 bill (channel_code, no channel_id) with one order_item line, on a schema at 0003 or later. */
const insertBlock2Bill = (id: string, queueNo: number) => `insert into "order" (id, origin, device_id, receipt_no, queue_no, business_date, shift_id, channel_id, channel_code, payment_code, status,
    subtotal_satang, discount_satang, total_satang, vat_satang, cost_satang, created_by_type, created_by_id, created_at, paid_at, sold_at, catalog_version, central_order_no)
  values ('${id}', 'device', 'dev-1', 'A-00000${queueNo}', ${queueNo}, '2026-09-25', 'shift-1', null, 'store', 'cash', 'paid',
    4500, 0, 4500, 0, 0, 'user', 'u1', '${NOW}', '${NOW}', '${NOW}', 42, 'D260925-001');
  insert into order_item (id, order_id, line_no, menu_code, menu_name_th, size, sweetness, milk, grade, qty, unit_price_satang, discount_per_cup_satang, discount_reason, promotion_id, line_total_satang)
  values ('oi-${id}', '${id}', 1, 'TT01', 'ชาไทย', '16 oz', '100%', 'fresh', null, 1, 4500, 0, null, null, 4500);`
const counts = (raw: import('sql.js').Database) => BILL_TABLES.map((t) => [t, Number(one(raw, `select count(*) from "${t}"`)[0]![0])])

describe('block 2 local schema (spec 04 §6.1)', () => {
  it('a plan-3/4 device with real bills survives 0003/0004: same rows, foreign keys intact (review item 7)', async () => {
    const { raw, db } = await plan4DeviceWithBills()
    const before = counts(raw)
    const oldCols = orderColumns(raw)
    expect(oldCols).toEqual([...PLAN4_ORDER_COLUMNS]) // the plan-3/4 `order` — every one of them must survive with its value
    const orderBefore = one(raw, `select ${selectList(oldCols)} from "order"`)
    expect(orderBefore[0]!.filter((v) => v === null)).toEqual([]) // a value in every column, so no column can hide behind a NULL
    const childrenBefore = UNTOUCHED_BILL_TABLES.map((t) => one(raw, `select * from "${t}" order by id`))
    const outboxCols = selectList(one(raw, `select name from pragma_table_info('outbox') where name <> 'status' order by cid`).map((r) => String(r[0])))
    const outboxBefore = one(raw, `select ${outboxCols} from outbox order by id`)
    migrateSqlite(db, folderUpTo('0005_order_central_dayo_edit')) // 0003 rebuilds "order" (channel_id becomes nullable) — must not lose children; block 3 is block3.test.ts
    expect(counts(raw)).toEqual(before)
    expect(one(raw, `select ${selectList(oldCols)} from "order"`)).toEqual(orderBefore)
    expect(one(raw, `select ${selectList(orderColumns(raw).filter((c) => !oldCols.includes(c)))} from "order"`)[0]!.every((v) => v === null)).toBe(true) // block-2 columns start empty
    expect(UNTOUCHED_BILL_TABLES.map((t) => one(raw, `select * from "${t}" order by id`))).toEqual(childrenBefore)
    expect(one(raw, `select ${outboxCols} from outbox order by id`)).toEqual(outboxBefore) // only status changes (below)
    expect(one(raw, `PRAGMA foreign_key_check`)).toEqual([])
    expect(one(raw, `PRAGMA foreign_keys`)).toEqual([[1]]) // the migrator turns enforcement back on
    expect(one(raw, `select status from outbox order by id`)).toEqual([['local_only'], ['local_only']])
  })
  it('after 0003 a block-2 bill with only channel_code inserts; a bill with neither channel is rejected', async () => {
    const { raw, db } = await plan4DeviceWithBills()
    migrateSqlite(db, SQLITE_MIGRATIONS_FOLDER)
    const block2 = (id: string, queueNo: number, channelCode: string | null) => `insert into "order" (id, origin, device_id, receipt_no, queue_no, business_date, shift_id, channel_id, channel_code, status,
        subtotal_satang, discount_satang, total_satang, vat_satang, cost_satang, created_by_type, created_by_id, created_at, sold_at, catalog_version)
      values ('${id}', 'device', 'dev-1', 'A-00000${queueNo}', ${queueNo}, '2026-09-25', 'shift-1', null, ${channelCode === null ? 'null' : `'${channelCode}'`}, 'paid',
        4500, 0, 4500, 0, 0, 'user', 'u1', '${NOW}', '${NOW}', 42)`
    expect(() => raw.exec(block2('order-b2', 2, 'store'))).not.toThrow()
    expect(() => raw.exec(block2('order-bad', 3, null))).toThrow(/CHECK/)
  })
  it('a plan-4 device with only queued rows turns every queued row local_only', async () => {
    const raw = await freshDb()
    raw.exec('PRAGMA foreign_keys = OFF')
    migrateSqlite(drizzle(raw), folderUpTo('0002_stock_adjustment'))
    raw.exec(`insert into outbox (id, table_name, row_json, idempotency_key, status, created_at, attempts) values
      ('o1', 'order', '{"id":"x"}', 'order:x', 'pending', '2026-09-20T00:00:00.000Z', 0),
      ('o2', 'shift', '{"id":"y"}', 'shift:y', 'dead', '2026-09-20T00:00:00.000Z', 3)`)
    migrateSqlite(drizzle(raw), SQLITE_MIGRATIONS_FOLDER)
    expect(one(raw, `select status from outbox order by id`)).toEqual([['local_only'], ['local_only']])
  })
  it('order.channel_id may be null when channel_code is set, never both null', async () => {
    const raw = await freshDb()
    migrateSqlite(drizzle(raw), SQLITE_MIGRATIONS_FOLDER)
    const cols = one(raw, `select name, "notnull" from pragma_table_info('order') where name in ('channel_id','sold_at','central_order_no') order by name`)
    expect(cols).toEqual([['central_order_no', 0], ['channel_id', 0], ['sold_at', 0]])
    const sqlText = String(one(raw, `select sql from sqlite_master where name = 'order'`)[0]?.[0])
    expect(sqlText).toMatch(/channel_id.+is not null or .+channel_code.+is not null/is)
  })
  it('order_item is append-only and dayo_catalog holds one row', async () => {
    const { raw, db } = await plan4DeviceWithBills()
    migrateSqlite(db, SQLITE_MIGRATIONS_FOLDER)
    expect(one(raw, `select name from sqlite_master where type = 'trigger' and name like 'order_item_%' order by name`)).toEqual([['order_item_no_delete'], ['order_item_no_update']])
    raw.exec(insertBlock2Bill('order-b2', 2))
    expect(() => raw.exec(`update order_item set qty = 2 where id = 'oi-order-b2'`)).toThrow(/order_item is append-only: UPDATE rejected/)
    expect(() => raw.exec(`delete from order_item where id = 'oi-order-b2'`)).toThrow(/order_item is append-only: DELETE rejected/)
    expect(one(raw, `select qty from order_item where id = 'oi-order-b2'`)).toEqual([[1]])
    expect(() => raw.exec(`insert into dayo_catalog (id, catalog_version, catalog_json, staff_json, fetched_at) values ('other', 1, '{}', '[]', 'x')`)).toThrow(/CHECK/)
  })
  it('0005: a device with block-2 bills gains order.central_dayo_edit_json — same rows, every column kept, new column null (A4 · M6)', async () => {
    const { raw, db } = await plan4DeviceWithBills()
    migrateSqlite(db, folderUpTo('0004_block2_outbox_local_only'))
    raw.exec(insertBlock2Bill('order-b2', 2))
    const before = [...counts(raw), ['order_item', orderItemCount(raw)]]
    const oldCols = orderColumns(raw)
    expect(oldCols).not.toContain('central_dayo_edit_json')
    const rowsBefore = one(raw, `select ${selectList(oldCols)} from "order" order by id`)
    const nonTablesBefore = schemaObjects(raw).filter(([type]) => type !== 'table')
    migrateSqlite(db, folderUpTo('0005_order_central_dayo_edit')) // up to 0005 only — block 3 (0006) is block3.test.ts
    expect([...counts(raw), ['order_item', orderItemCount(raw)]]).toEqual(before)
    expect(one(raw, `select ${selectList(oldCols)} from "order" order by id`)).toEqual(rowsBefore)
    expect(orderColumns(raw)).toEqual([...oldCols, 'central_dayo_edit_json']) // appended by ADD COLUMN — no table rebuild
    expect(one(raw, `select type, "notnull", dflt_value from pragma_table_info('order') where name = 'central_dayo_edit_json'`)).toEqual([['TEXT', 0, null]])
    expect(one(raw, `select id, central_dayo_edit_json from "order" order by id`)).toEqual([['order-1', null], ['order-b2', null]])
    expect(schemaObjects(raw).filter(([type]) => type !== 'table')).toEqual(nonTablesBefore) // every index and trigger unchanged
    expect(one(raw, `PRAGMA foreign_key_check`)).toEqual([])
  })
  it('0005: dayo_edit of a paid bill is writable (order has no append-only trigger) and round-trips through drizzle as the E3 object', async () => {
    const { raw, db } = await plan4DeviceWithBills()
    migrateSqlite(db, SQLITE_MIGRATIONS_FOLDER)
    raw.exec(insertBlock2Bill('order-b2', 2))
    const edit: DayoEdit = { kind: 'cancel', edited_at: '2026-09-25T08:15:00.000Z', edited_by_name: null, reason: null, version: 3 }
    expect(() => db.update(s.order).set({ centralDayoEditJson: edit }).where(eq(s.order.id, 'order-b2')).run()).not.toThrow()
    const row = db.select({ e: s.order.centralDayoEditJson, total: s.order.totalSatang, status: s.order.status }).from(s.order).where(eq(s.order.id, 'order-b2')).get()
    expect(row).toEqual({ e: edit, total: 4500, status: 'paid' }) // stored as sent; local money and status untouched
    db.update(s.order).set({ centralDayoEditJson: null }).where(eq(s.order.id, 'order-b2')).run()
    expect(one(raw, `select central_dayo_edit_json from "order" where id = 'order-b2'`)).toEqual([[null]])
    expect(one(raw, `PRAGMA foreign_key_check`)).toEqual([])
  })
})
