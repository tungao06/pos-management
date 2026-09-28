import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import initSqlJs, { type Database } from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import { parseSeed, type Seed } from '@dayo/contracts'
import { applySeedSqlite, migrateSqlite, seedToRows, sqlite as s, SQLITE_MIGRATIONS_FOLDER } from '../src/index.js'
import { seedOpts } from './helpers.js'

const seed: Seed = parseSeed(JSON.parse(readFileSync(fileURLToPath(new URL('../../excel-import/seed/dayo-seed.json', import.meta.url)), 'utf8'))) // same seed as constraints.test.ts

export const NOW = '2026-09-20T03:00:00.000Z'
/** Every table a plan-3/4 bill writes to. */
export const BILL_TABLES = ['order', 'order_line', 'payment', 'discount', 'order_event', 'cash_movement', 'shift', 'outbox'] as const
/** The bill's child tables that no block-2 migration touches — every row must come through byte for byte. */
export const UNTOUCHED_BILL_TABLES = ['order_line', 'payment', 'discount', 'order_event', 'cash_movement', 'shift'] as const

export const one = (db: Database, q: string) => db.exec(q)[0]?.values ?? []

/** A copy of the migrations folder cut after `lastTag` — to build a device that is still on plan 4. */
export function folderUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'))
  cpSync(SQLITE_MIGRATIONS_FOLDER, dir, { recursive: true })
  const j = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  j.entries = j.entries.slice(0, j.entries.findIndex((e) => e.tag === lastTag) + 1)
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(j))
  return dir
}

/**
 * review item 7: a real plan-3/4 device — seed + one paid bill with every child row + its VOID_REFUND — built on the
 * pre-0003 schema. `order` goes in as raw SQL (the drizzle table already has the block-2 columns) with a distinct,
 * non-null value in every one of its 22 plan-3/4 columns, so an upgrade that drops or swaps a column cannot hide
 * behind two NULLs; the tables block 2 does not change go through drizzle.
 */
export async function plan4DeviceWithBills() {
  const SQL = await initSqlJs()
  const raw = new SQL.Database()
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
  raw.exec(`insert into customer (id, line_user_id, display_name, picture_url, first_seen_at, last_order_at, is_blocked, updated_at, version)
    values ('cust-1', 'U-line-1', 'ลูกค้า', null, '${NOW}', null, 0, '${NOW}', 1)`)
  raw.exec(`insert into "order" (id, origin, device_id, receipt_no, queue_no, business_date, shift_id, channel_id, customer_id, status,
      subtotal_satang, discount_satang, total_satang, vat_satang, cost_satang, note, created_by_type, created_by_id, created_at, paid_at, ready_at, voided_at)
    values ('order-1', 'device', 'dev-1', 'A-000001', 1, '2026-09-20', 'shift-1', '${channelId}', 'cust-1', 'voided',
      5000, 500, 4500, 0, 1200, 'หวานน้อย', 'user', 'u1', '2026-09-20T03:00:00.000Z', '2026-09-20T03:00:01.000Z', '2026-09-20T03:00:02.000Z', '2026-09-20T03:00:03.000Z')`)
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

/** The 22 columns of the plan-3/4 `order`, in table order. */
export const PLAN4_ORDER_COLUMNS = [
  'id', 'origin', 'device_id', 'receipt_no', 'queue_no', 'business_date', 'shift_id', 'channel_id', 'customer_id', 'status',
  'subtotal_satang', 'discount_satang', 'total_satang', 'vat_satang', 'cost_satang', 'note', 'created_by_type', 'created_by_id',
  'created_at', 'paid_at', 'ready_at', 'voided_at',
] as const
