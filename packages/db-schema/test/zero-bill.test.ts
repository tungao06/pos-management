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
import { folderUpTo, NOW, one, plan4DeviceWithBills } from './plan4-device.js'

// plan 10 T6 (owner answer Q1 = ข): a bill a promotion brings down to ฿0 is still a paid bill with a ฿0 payment row.
// The migration under test and the one before it come from the journal — never a hardcoded number (review item 14).
const journal = JSON.parse(readFileSync(join(SQLITE_MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
const THIS = journal.entries.find((e) => e.tag.endsWith('_zero_total_promo_bill'))!
const BEFORE = journal.entries[journal.entries.indexOf(THIS) - 1]!.tag
const NEW_TRIGGERS = ['order_total_keeps_zero_payment', 'payment_zero_only_zero_bill', 'payment_zero_only_zero_bill_on_update']
const ZERO_REFUSED = /฿0 payment only for a bill whose total is 0/

/** Every table, index and trigger except `payment` and its own objects — the migration must leave these byte for byte. */
const nonTableObjects = (raw: Database) => one(raw, `select type, name, tbl_name, sql from sqlite_master where name not like 'sqlite_%' and type <> 'table' order by type, name`)
const tableNames = (raw: Database) => one(raw, `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name`).map((r) => String(r[0]))
const columnsOf = (raw: Database, t: string) => one(raw, `select name from pragma_table_info('${t}') order by cid`).map((r) => String(r[0]))
/** Every row of every table with its rowid and every column value, in rowid order. */
const dump = (raw: Database) => tableNames(raw).map((t) => [t, one(raw, `select rowid, ${columnsOf(raw, t).map((c) => `"${c}"`).join(', ')} from "${t}" order by rowid`)])
/** Tables with a foreign key that points at `payment` (none today — kept as a check so a later one is not dropped silently). */
const referencesToPayment = (raw: Database) => one(raw, `select m.name, f."from", f."to" from sqlite_master m join pragma_foreign_key_list(m.name) f where m.type = 'table' and f."table" = 'payment' order by m.name`)
const paymentShape = (raw: Database) => ({
  columns: one(raw, `select cid, name, type, "notnull", dflt_value, pk from pragma_table_info('payment') order by cid`),
  fks: one(raw, `select "table", "from", "to", on_update, on_delete, "match" from pragma_foreign_key_list('payment')`),
  indexes: one(raw, `select name, "unique", origin, partial from pragma_index_list('payment') where origin <> 'pk' order by name`),
  pk: one(raw, `select count(*) from pragma_index_list('payment') where origin = 'pk'`),
})

/** A device database on migration `tag` (foreign keys on, like the app) with a user, a device and an open shift. */
async function deviceOn(tag: string = THIS.tag): Promise<Database> {
  const SQL = await initSqlJs()
  const raw = new SQL.Database()
  raw.run('PRAGMA foreign_keys = ON')
  migrateSqlite(drizzle(raw), folderUpTo(tag))
  raw.run(`insert into "user" (id, display_name, role, pin_hash, is_active, created_at, updated_at, version) values ('u1', 'Owner', 'owner', 'x', 1, '${NOW}', '${NOW}', 1)`)
  raw.run(`insert into device (id, name, receipt_prefix, is_selling_device, registered_at, updated_at, version) values ('dev-1', 'Tablet A', 'A', 1, '${NOW}', '${NOW}', 1)`)
  raw.run(`insert into shift (id, device_id, business_date, status, opened_by, opened_at, opening_float_satang, closed_by, closed_at)
    values ('shift-1', 'dev-1', '2026-09-30', 'open', 'u1', '${NOW}', 0, null, null)`)
  return raw
}
let seq = 0
/** A paid block-2 bill on shift-1. `total` = what the customer paid; a ฿0 bill is a full promotion discount. */
function insertBill(raw: Database, o: { subtotal: number; discount: number }): string {
  const n = ++seq
  raw.run(`insert into "order" (id, origin, device_id, receipt_no, queue_no, business_date, shift_id, channel_id, channel_code, payment_code, status,
      subtotal_satang, discount_satang, total_satang, vat_satang, cost_satang, created_by_type, created_by_id, created_at, paid_at, sold_at, catalog_version)
    values ('o-${n}', 'device', 'dev-1', 'A-${String(n).padStart(6, '0')}', ${n}, '2026-09-30', 'shift-1', null, 'store', 'cash', 'paid',
      ${o.subtotal}, ${o.discount}, ${o.subtotal - o.discount}, 0, 0, 'user', 'u1', '${NOW}', '${NOW}', '${NOW}', 31)`)
  return `o-${n}`
}
const insertPayment = (raw: Database, o: { id: string; orderId: string; amount: number }) =>
  raw.run(`insert into payment (id, order_id, method, amount_satang, tendered_satang, change_satang, reference, verify_status, created_by, created_at)
    values ('${o.id}', '${o.orderId}', 'CASH', ${o.amount}, ${o.amount}, 0, null, 'manual', 'u1', '${NOW}')`)
const paymentIds = (raw: Database) => one(raw, `select id, amount_satang from payment order by id`)

describe('0007 migration: a ฿0 payment for a ฿0 bill (plan 10 T6 · Q1 = ข)', () => {
  it('is found in the journal right after block 3', () => {
    expect(THIS.tag).toMatch(/^\d{4}_zero_total_promo_bill$/)
    expect(BEFORE).toBe('0006_block3_shift_cash')
  })

  it('a real device on block 3 upgrades without losing a row or a value: payment rebuilt with the same columns, rowids, foreign key and index; nothing else changes', async () => {
    const { raw, db } = await plan4DeviceWithBills()
    migrateSqlite(db, folderUpTo(BEFORE))
    // more rows on the block-3 schema: a block-2 bill paid by PromptPay, a payment with a rowid gap before it, a closed
    // shift with its count and Z, a sent outbox row (D120 freezes its row_json) — every payment column holds a value somewhere
    raw.exec(`update payment set reference = 'ref-cash-1' where id = 'pay-1'`)
    raw.exec(`update shift set status = 'counting', counted_at = '${NOW}' where id = 'shift-1'`)
    raw.exec(`update shift set status = 'counted' where id = 'shift-1'`)
    raw.exec(`update shift set status = 'closed', closed_by = 'u1', closed_at = '${NOW}' where id = 'shift-1'`)
    raw.exec(`insert into cash_count (id, shift_id, counted_satang, expected_satang, variance_satang, reason, lines_json, counted_by, created_at, counted_at, includes_bot_cash)
      values ('cc-1', 'shift-1', 0, 0, 0, null, '[]', 'u1', '${NOW}', '${NOW}', 0)`)
    raw.exec(`insert into z_report (id, shift_id, snapshot_json, hash, created_at) values ('z-1', 'shift-1', '{}', '${'a'.repeat(64)}', '${NOW}')`)
    raw.exec(`insert into shift (id, device_id, business_date, status, opened_by, opened_at, opening_float_satang, sync_mode)
      values ('shift-2', 'dev-1', '2026-09-30', 'open', 'u1', '${NOW}', 50000, 'central')`)
    raw.exec(`insert into "order" (id, origin, device_id, receipt_no, queue_no, business_date, shift_id, channel_id, channel_code, payment_code, status,
        subtotal_satang, discount_satang, total_satang, vat_satang, cost_satang, created_by_type, created_by_id, created_at, paid_at, sold_at, catalog_version)
      values ('order-b3', 'device', 'dev-1', 'A-000002', 1, '2026-09-30', 'shift-2', null, 'store', 'qr', 'paid', 9000, 1000, 8000, 0, 0, 'user', 'u1', '${NOW}', '${NOW}', '${NOW}', 31)`)
    raw.exec(`insert into payment (rowid, id, order_id, method, amount_satang, tendered_satang, change_satang, reference, verify_status, created_by, created_at)
      values (40, 'pay-b3', 'order-b3', 'PROMPTPAY', 8000, null, null, 'slip-7', 'manual', 'u1', '${NOW}')`)
    raw.exec(`insert into outbox (id, table_name, row_json, idempotency_key, status, created_at, attempts) values ('o3', 'order', '{"id":"order-b3"}', 'order:order-b3', 'sent', '${NOW}', 1)`)

    expect(one(raw, `select count(*) from payment`)).toEqual([[2]])
    expect(one(raw, `select rowid, id from payment order by rowid`)).toEqual([[1, 'pay-1'], [40, 'pay-b3']])
    expect(one(raw, `select * from payment where id = 'pay-1'`)[0]!.filter((v) => v === null)).toEqual([]) // no column can hide behind a NULL
    const before = dump(raw)
    const tablesBefore = tableNames(raw)
    const objectsBefore = nonTableObjects(raw)
    const tableSqlBefore = one(raw, `select name, sql from sqlite_master where type = 'table' and name <> 'payment' order by name`)
    const shapeBefore = paymentShape(raw)
    expect(shapeBefore.fks).toEqual([['order', 'order_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE']])
    expect(referencesToPayment(raw)).toEqual([])

    migrateSqlite(db, folderUpTo(THIS.tag))

    expect(tableNames(raw)).toEqual(tablesBefore) // no __new_payment left behind
    expect(dump(raw)).toEqual(before) // same rows, same rowids (40 stays 40), every old value, in every table
    expect(paymentShape(raw)).toEqual(shapeBefore) // same columns in the same order, same foreign key, same index, still a text primary key
    expect(referencesToPayment(raw)).toEqual([])
    const objectsAfter = nonTableObjects(raw)
    expect(objectsAfter.filter((o) => objectsBefore.some((b) => b[1] === o[1]))).toEqual(objectsBefore) // payment_order_idx and every old trigger, same SQL
    expect(objectsAfter.filter((o) => !objectsBefore.some((b) => b[1] === o[1])).map((o) => `${String(o[0])} ${String(o[1])} on ${String(o[2])}`)).toEqual([
      'trigger order_total_keeps_zero_payment on order', 'trigger payment_zero_only_zero_bill on payment', 'trigger payment_zero_only_zero_bill_on_update on payment',
    ])
    expect(one(raw, `select name, sql from sqlite_master where type = 'table' and name <> 'payment' order by name`)).toEqual(tableSqlBefore)
    const paymentSql = String(one(raw, `select sql from sqlite_master where name = 'payment'`)[0]![0])
    expect(paymentSql).toMatch(/CONSTRAINT "payment_amount_nonneg_ck" CHECK\("payment"\."amount_satang" >= 0\)/)
    expect(paymentSql).not.toMatch(/payment_amount_positive_ck/)
    expect(one(raw, `PRAGMA foreign_key_check`)).toEqual([])
    expect(one(raw, `PRAGMA foreign_keys`)).toEqual([[1]])
    expect(one(raw, `PRAGMA integrity_check`)).toEqual([['ok']])
    // the foreign key to order is still enforced on the rebuilt table
    expect(() => raw.exec(`insert into payment (id, order_id, method, amount_satang, tendered_satang, change_satang, reference, verify_status, created_by, created_at)
      values ('pay-x', 'no-such-order', 'CASH', 100, 100, 0, null, 'manual', 'u1', '${NOW}')`)).toThrow(/FOREIGN KEY/)
    // and the freeze rules of earlier migrations still bite (D120 · append-only)
    expect(() => raw.exec(`update outbox set row_json = '{}' where id = 'o3'`)).toThrow(/row_json is frozen/)
    expect(() => raw.exec(`update order_event set seq = seq`)).toThrow(/order_event is append-only/)
    expect(() => raw.exec(`delete from cash_count`)).toThrow(/cash_count is append-only/)
    expect(() => raw.exec(`update shift set status = 'open' where id = 'shift-1'`)).toThrow(/forward/)
  })

  it('the tablet own runner (browser bundle over sqlite-proxy) applies it to a block-3 device the same way', async () => {
    expect(SQLITE_MIGRATIONS.map((m) => m.tag)).toContain(THIS.tag) // the regenerated bundle carries it
    for (const t of NEW_TRIGGERS) expect(SQLITE_TRIGGERS).toContain(t)
    const { raw: old, db: oldDb } = await plan4DeviceWithBills()
    migrateSqlite(oldDb, folderUpTo(BEFORE))
    old.exec(`insert into payment (rowid, id, order_id, method, amount_satang, tendered_satang, change_satang, reference, verify_status, created_by, created_at)
      values (9, 'pay-2', 'order-1', 'PROMPTPAY', 100, null, null, 'slip-1', 'manual', 'u1', '${NOW}')`)
    const dir = mkdtempSync(join(tmpdir(), 'dayo-mig-'))
    try {
      const file = join(dir, 'b3.sqlite3')
      writeFileSync(file, old.export())
      const raw = new DatabaseSync(file)
      try {
        raw.exec('PRAGMA foreign_keys = ON')
        const rows = (q: string) => raw.prepare(q).all()
        const paymentBefore = rows(`select rowid, * from payment order by rowid`)
        const triggersBefore = rows(`select name, sql from sqlite_master where type = 'trigger' order by name`)
        const bundle = SQLITE_MIGRATIONS.slice(0, SQLITE_MIGRATIONS.findIndex((m) => m.tag === THIS.tag) + 1)
        expect((await migrateSqliteRemote(drizzleProxy(nodeSqliteCallback(raw as unknown as NodeSqliteLike)), bundle)).applied).toEqual([THIS.tag])
        expect(paymentBefore.map((r) => r['rowid'])).toEqual([1, 9])
        expect(rows(`select rowid, * from payment order by rowid`)).toEqual(paymentBefore)
        const triggersAfter = rows(`select name, sql from sqlite_master where type = 'trigger' order by name`)
        expect(triggersAfter.filter((t) => !NEW_TRIGGERS.includes(String(t['name'])))).toEqual(triggersBefore)
        expect(triggersAfter.map((t) => String(t['name'])).filter((n) => NEW_TRIGGERS.includes(n))).toEqual(NEW_TRIGGERS)
        expect(rows(`select name from sqlite_master where type = 'table' and name like '%new_payment%'`)).toEqual([])
        expect(rows('PRAGMA foreign_key_check')).toEqual([])
        expect(raw.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
        expect(() => raw.exec(`insert into payment (id, order_id, method, amount_satang, tendered_satang, change_satang, reference, verify_status, created_by, created_at)
          values ('pay-0', 'order-1', 'CASH', 0, 0, 0, null, 'manual', 'u1', '${NOW}')`)).toThrow(ZERO_REFUSED) // order-1 was 4500
      } finally {
        raw.close() // also when an expectation fails — Windows cannot delete an open file (EBUSY)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('฿0 payment only for a ฿0 bill (plan 10 T6 · Q1 = ข)', () => {
  it('a ฿0 payment of a bill a promotion brought to ฿0 is accepted — raw SQL and through drizzle', async () => {
    const raw = await deviceOn()
    const free = insertBill(raw, { subtotal: 4500, discount: 4500 })
    insertPayment(raw, { id: 'p0', orderId: free, amount: 0 })
    const free2 = insertBill(raw, { subtotal: 0, discount: 0 })
    drizzle(raw).insert(s.payment).values({ id: 'p0d', orderId: free2, method: 'PROMPTPAY', amountSatang: 0, tenderedSatang: null, changeSatang: null, reference: null, verifyStatus: 'manual', createdBy: 'u1', createdAt: NOW }).run()
    expect(drizzle(raw).select({ id: s.payment.id, a: s.payment.amountSatang }).from(s.payment).orderBy(s.payment.id).all()).toEqual([{ id: 'p0', a: 0 }, { id: 'p0d', a: 0 }])
  })

  it('a ฿0 payment of a bill above ฿0 is refused, and nothing is written', async () => {
    const raw = await deviceOn()
    const bill = insertBill(raw, { subtotal: 4500, discount: 500 })
    expect(() => insertPayment(raw, { id: 'p0', orderId: bill, amount: 0 })).toThrow(ZERO_REFUSED)
    const oneSatang = insertBill(raw, { subtotal: 1, discount: 0 })
    expect(() => insertPayment(raw, { id: 'p1', orderId: oneSatang, amount: 0 })).toThrow(ZERO_REFUSED) // the smallest bill above 0
    expect(() => drizzle(raw).insert(s.payment).values({ id: 'p2', orderId: bill, method: 'CASH', amountSatang: 0, verifyStatus: 'manual', createdBy: 'u1', createdAt: NOW }).run()).toThrow(ZERO_REFUSED)
    expect(paymentIds(raw)).toEqual([])
  })

  it('a ฿0 payment of a bill that does not exist is refused (no total to compare against)', async () => {
    const raw = await deviceOn()
    raw.run('PRAGMA foreign_keys = OFF') // even with the foreign key off, the guard does not read a missing bill as ฿0
    expect(() => insertPayment(raw, { id: 'p0', orderId: 'no-such-order', amount: 0 })).toThrow(ZERO_REFUSED)
    expect(paymentIds(raw)).toEqual([])
  })

  it('a negative payment is refused on any bill', async () => {
    const raw = await deviceOn()
    const free = insertBill(raw, { subtotal: 4500, discount: 4500 })
    const bill = insertBill(raw, { subtotal: 4500, discount: 0 })
    expect(() => insertPayment(raw, { id: 'n1', orderId: free, amount: -1 })).toThrow(/CHECK constraint failed: payment_amount_nonneg_ck/)
    expect(() => insertPayment(raw, { id: 'n2', orderId: bill, amount: -4500 })).toThrow(/CHECK constraint failed: payment_amount_nonneg_ck/)
    insertPayment(raw, { id: 'p', orderId: bill, amount: 4500 })
    expect(() => raw.run(`update payment set amount_satang = -1 where id = 'p'`)).toThrow(/CHECK constraint failed: payment_amount_nonneg_ck/)
    expect(paymentIds(raw)).toEqual([['p', 4500]])
  })

  it('a positive payment still works as before', async () => {
    const raw = await deviceOn()
    const bill = insertBill(raw, { subtotal: 4500, discount: 500 })
    insertPayment(raw, { id: 'p', orderId: bill, amount: 4000 })
    raw.run(`update payment set verify_status = 'verified', reference = 'r1' where id = 'p'`) // other columns stay writable
    expect(one(raw, `select id, amount_satang, verify_status, reference from payment`)).toEqual([['p', 4000, 'verified', 'r1']])
  })

  it('an UPDATE cannot make a ฿0 payment on a bill above ฿0 — not by amount, not by moving it to another bill', async () => {
    const raw = await deviceOn()
    const free = insertBill(raw, { subtotal: 4500, discount: 4500 })
    const bill = insertBill(raw, { subtotal: 4500, discount: 0 })
    insertPayment(raw, { id: 'p0', orderId: free, amount: 0 })
    insertPayment(raw, { id: 'p', orderId: bill, amount: 4500 })
    expect(() => raw.run(`update payment set amount_satang = 0 where id = 'p'`)).toThrow(ZERO_REFUSED)
    expect(() => raw.run(`update payment set order_id = '${bill}' where id = 'p0'`)).toThrow(ZERO_REFUSED)
    raw.run(`update payment set verify_status = 'verified' where id = 'p0'`) // a ฿0 payment of a ฿0 bill is otherwise an ordinary row
    raw.run(`update payment set amount_satang = 0 where id = 'p0'`) // same value: fine
    expect(one(raw, `select id, order_id, amount_satang, verify_status from payment order by id`)).toEqual([['p', bill, 4500, 'manual'], ['p0', free, 0, 'verified']])
  })

  it('the total of a bill with a ฿0 payment cannot move off ฿0; the bill itself stays writable (void, dayo answers)', async () => {
    const raw = await deviceOn()
    const free = insertBill(raw, { subtotal: 4500, discount: 4500 })
    insertPayment(raw, { id: 'p0', orderId: free, amount: 0 })
    expect(() => raw.run(`update "order" set discount_satang = 0, total_satang = 4500 where id = '${free}'`)).toThrow(ZERO_REFUSED)
    raw.run(`update "order" set status = 'voided', voided_at = '${NOW}', central_order_no = 'D260930-001' where id = '${free}'`)
    raw.run(`update "order" set total_satang = 0 where id = '${free}'`) // same value: fine
    const bill = insertBill(raw, { subtotal: 4500, discount: 0 }) // a bill with no ฿0 payment is not guarded (as before)
    raw.run(`update "order" set total_satang = 4000, discount_satang = 500 where id = '${bill}'`)
    expect(one(raw, `select id, status, total_satang from "order" order by id`)).toEqual([[free, 'voided', 0], [bill, 'paid', 4000]])
  })

  it('the bundle lists the new triggers next to every earlier one', () => {
    for (const t of NEW_TRIGGERS) expect(SQLITE_TRIGGERS).toContain(t)
    for (const t of ['outbox_row_json_frozen', 'shift_status_forward_only', 'order_event_no_update', 'cash_count_no_delete']) expect(SQLITE_TRIGGERS).toContain(t)
  })

  it('a drizzle update of the bill keeps working (order has no append-only trigger)', async () => {
    const raw = await deviceOn()
    const free = insertBill(raw, { subtotal: 4500, discount: 4500 })
    insertPayment(raw, { id: 'p0', orderId: free, amount: 0 })
    drizzle(raw).update(s.order).set({ offCatalogAt: NOW }).where(eq(s.order.id, free)).run()
    expect(one(raw, `select off_catalog_at from "order" where id = '${free}'`)).toEqual([[NOW]])
  })
})
