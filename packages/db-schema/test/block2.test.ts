import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import { describe, expect, it } from 'vitest'
import { applySeedSqlite, migrateSqlite, seedToRows, sqlite as s, SQLITE_MIGRATIONS_FOLDER } from '../src/index.js'
import { fileURLToPath } from 'node:url'
import { parseSeed, type Seed } from '@dayo/contracts'
import { seedOpts } from './helpers.js'
const seed: Seed = parseSeed(JSON.parse(readFileSync(fileURLToPath(new URL('../../excel-import/seed/dayo-seed.json', import.meta.url)), 'utf8'))) // same seed as constraints.test.ts

async function freshDb() { const SQL = await initSqlJs(); return new SQL.Database() }
const one = (db: import('sql.js').Database, q: string) => db.exec(q)[0]?.values ?? []

/** A copy of the migrations folder cut after `lastTag` — to build a device that is still on plan 4. */
function folderUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'))
  cpSync(SQLITE_MIGRATIONS_FOLDER, dir, { recursive: true })
  const j = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  j.entries = j.entries.slice(0, j.entries.findIndex((e) => e.tag === lastTag) + 1)
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(j))
  return dir
}

const NOW = '2026-09-20T03:00:00.000Z'
const BILL_TABLES = ['order', 'order_line', 'payment', 'discount', 'order_event', 'cash_movement', 'shift', 'outbox'] as const

/**
 * review item 7: a real plan-3/4 device — seed + one paid bill with every child row + its VOID_REFUND — built on the
 * pre-0003 schema. `order` goes in as raw SQL (the drizzle table already has the block-2 columns); the tables block 2
 * does not change go through drizzle.
 */
async function plan4DeviceWithBills() {
  const raw = await freshDb()
  raw.exec('PRAGMA foreign_keys = ON')
  const db = drizzle(raw)
  migrateSqlite(db, folderUpTo('0002_stock_adjustment'))
  await applySeedSqlite(db, seedToRows(seed, seedOpts()))
  const channelId = String(one(raw, `select id from channel limit 1`)[0]![0])
  const variantId = String(one(raw, `select id from product_variant limit 1`)[0]![0])
  const sweetId = String(one(raw, `select id from sweetness_level limit 1`)[0]![0])
  db.insert(s.user).values({ id: 'u1', displayName: 'Owner', role: 'owner', pinHash: 'x', isActive: true, createdAt: NOW, updatedAt: NOW, version: 1 }).run()
  db.insert(s.device).values({ id: 'dev-1', name: 'Tablet A', receiptPrefix: 'A', isSellingDevice: true, registeredAt: NOW, updatedAt: NOW }).run()
  db.insert(s.shift).values({ id: 'shift-1', deviceId: 'dev-1', businessDate: '2026-09-20', status: 'open', openedBy: 'u1', openedAt: NOW, openingFloatSatang: 0 }).run()
  raw.exec(`insert into "order" (id, origin, device_id, receipt_no, queue_no, business_date, shift_id, channel_id, status,
      subtotal_satang, discount_satang, total_satang, vat_satang, cost_satang, created_by_type, created_by_id, created_at, paid_at, voided_at)
    values ('order-1', 'device', 'dev-1', 'A-000001', 1, '2026-09-20', 'shift-1', '${channelId}', 'voided',
      5000, 500, 4500, 0, 1200, 'user', 'u1', '${NOW}', '${NOW}', '${NOW}')`)
  db.insert(s.orderLine).values({ id: 'ol-1', orderId: 'order-1', lineNo: 1, variantId, sweetnessId: sweetId, productName: 'ชาไทย', sizeName: 'M', sweetnessName: '100%', unitPriceSatang: 5000, qty: 1, lineTotalSatang: 5000, unitCostSatang: 1200 }).run()
  db.insert(s.payment).values({ id: 'pay-1', orderId: 'order-1', method: 'CASH', amountSatang: 4500, tenderedSatang: 5000, changeSatang: 500, verifyStatus: 'manual', createdBy: 'u1', createdAt: NOW }).run()
  db.insert(s.discount).values({ id: 'disc-1', orderId: 'order-1', amountSatang: 500, reason: 'ลูกค้าประจำ', approvedBy: 'u1' }).run()
  raw.exec(`insert into order_event (id, order_id, seq, device_id, chain_id, chain_seq, type, payload_json, actor_type, actor_id, at, prev_hash, hash) values
    ('ev-1', 'order-1', 1, 'dev-1', 'dev-1', 1, 'PAID', '{}', 'user', 'u1', '${NOW}', '0', 'h1'),
    ('ev-2', 'order-1', 2, 'dev-1', 'dev-1', 2, 'VOIDED', '{}', 'user', 'u1', '${NOW}', 'h1', 'h2')`)
  db.insert(s.cashMovement).values({ id: 'cm-1', shiftId: 'shift-1', kind: 'VOID_REFUND', amountSatang: 4500, orderId: 'order-1', createdBy: 'u1', createdAt: NOW }).run()
  raw.exec(`insert into outbox (id, table_name, row_json, idempotency_key, status, created_at, attempts) values
    ('o1', 'order', '{"id":"order-1"}', 'order:order-1', 'pending', '${NOW}', 0),
    ('o2', 'shift', '{"id":"shift-1"}', 'shift:shift-1', 'dead', '${NOW}', 3)`)
  return { raw, db, channelId }
}
const counts = (raw: import('sql.js').Database) => BILL_TABLES.map((t) => [t, Number(one(raw, `select count(*) from "${t}"`)[0]![0])])

describe('block 2 local schema (spec 04 §6.1)', () => {
  it('a plan-3/4 device with real bills survives 0003/0004: same rows, foreign keys intact (review item 7)', async () => {
    const { raw, db } = await plan4DeviceWithBills()
    const before = counts(raw)
    const orderBefore = one(raw, `select id, receipt_no, channel_id, total_satang, status, voided_at from "order"`)
    migrateSqlite(db, SQLITE_MIGRATIONS_FOLDER) // 0003 rebuilds "order" (channel_id becomes nullable) — must not lose children
    expect(counts(raw)).toEqual(before)
    expect(one(raw, `select id, receipt_no, channel_id, total_satang, status, voided_at from "order"`)).toEqual(orderBefore)
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
    const raw = await freshDb()
    migrateSqlite(drizzle(raw), SQLITE_MIGRATIONS_FOLDER)
    expect(one(raw, `select name from sqlite_master where type = 'trigger' and name like 'order_item_%' order by name`)).toEqual([['order_item_no_delete'], ['order_item_no_update']])
    expect(() => raw.exec(`insert into dayo_catalog (id, catalog_version, catalog_json, staff_json, fetched_at) values ('other', 1, '{}', '[]', 'x')`)).toThrow(/CHECK/)
  })
})
