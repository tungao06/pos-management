import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import type { PGlite } from '@electric-sql/pglite'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import type { Database } from 'sql.js'
import { parseSeed, type Seed } from '@dayo/contracts'
import { migratePg } from '../src/migrate-pg.js'
import { migrateSqlite } from '../src/migrate-sqlite.js'
import * as pg from '../src/pg/index.js'
import * as sqlite from '../src/sqlite/index.js'
import { applySeedPg } from '../src/seed/apply-pg.js'
import { applySeedSqlite } from '../src/seed/apply-sqlite.js'
import { seedToRows } from '../src/seed/rows.js'
import { openPglite, openSqliteMemory, pgErrorCode, seedOpts, sqliteRows } from './helpers.js'

const seed: Seed = parseSeed(JSON.parse(readFileSync(fileURLToPath(new URL('../../excel-import/seed/dayo-seed.json', import.meta.url)), 'utf8')))
const NOW = '2026-09-18T00:00:00.000Z'

/** Indexes added for reports and server-side FK joins (M3), plus the partial "one current version" uniques (M5, D47 item 6). */
const EXPECTED_INDEXES = [
  'stock_movement_item_date_idx', 'stock_movement_business_date_idx', 'order_shift_idx', 'order_business_date_status_idx',
  'payment_order_idx', 'discount_order_idx', 'cash_movement_shift_idx', 'cash_movement_order_idx', 'cash_count_shift_idx',
  'purchase_line_purchase_idx', 'order_payment_intent_order_idx', 'recipe_current_uq', 'bom_current_uq', 'shift_open_uq',
]

const user = { id: 'u1', displayName: 'Owner', role: 'owner' as const, pinHash: 'x', isActive: true, createdAt: NOW, updatedAt: NOW, version: 1 }
const count = { id: 'sc1', businessDate: '2026-09-18', status: 'open' as const, createdBy: 'u1', createdAt: NOW }

describe('sqlite constraints (M3, M5)', () => {
  let db: SQLJsDatabase
  let raw: Database
  beforeAll(async () => {
    ;({ db, raw } = await openSqliteMemory())
    migrateSqlite(db)
    await applySeedSqlite(db, seedToRows(seed, seedOpts()))
  })

  it('has the report and FK indexes', () => {
    const names = sqliteRows(raw, `select name from sqlite_master where type = 'index'`).map((r) => r['name'])
    for (const n of EXPECTED_INDEXES) expect(names, n).toContain(n)
  })
  it('allows only one current recipe per (variant, sweetness)', () => {
    const r = db.select().from(sqlite.recipe).limit(1).get()!
    expect(() => db.insert(sqlite.recipe).values({ ...r, id: 'r-v2', version: 2 }).run()).toThrow(/UNIQUE/)
    db.insert(sqlite.recipe).values({ ...r, id: 'r-v2', version: 2, isCurrent: false }).run()
  })
  it('allows only one current BOM per item', () => {
    const b = db.select().from(sqlite.bom).limit(1).get()!
    expect(() => db.insert(sqlite.bom).values({ ...b, id: 'b-v2', version: 2 }).run()).toThrow(/UNIQUE/)
    db.insert(sqlite.bom).values({ ...b, id: 'b-v2', version: 2, isCurrent: false }).run()
  })
  it('rejects a second price for the same (variant, channel, effective_from)', () => {
    const p = db.select().from(sqlite.price).limit(1).get()!
    expect(() => db.insert(sqlite.price).values({ ...p, id: 'p-dup' }).run()).toThrow(/UNIQUE/)
  })
  it('rejects a second count line for the same item in one count', () => {
    const item = db.select().from(sqlite.item).where(eq(sqlite.item.code, 'PB-TEA-THAI')).get()!
    db.insert(sqlite.user).values(user).run()
    db.insert(sqlite.stockCount).values(count).run()
    const line = { id: 'l1', countId: 'sc1', itemId: item.id, countedUnitsMilli: 0, countedUseMilli: 0, expectedUseMilli: 0, varianceUseMilli: 0, varianceSatang: 0 }
    db.insert(sqlite.stockCountLine).values(line).run()
    expect(() => db.insert(sqlite.stockCountLine).values({ ...line, id: 'l2' }).run()).toThrow(/UNIQUE/)
  })
  it('outbox rows start pending; the pending index covers only pending rows (M8)', () => {
    db.insert(sqlite.outbox).values({ id: 'o1', tableName: 'order', rowJson: {}, idempotencyKey: 'k1', createdAt: NOW, attempts: 0 }).run()
    expect(db.select().from(sqlite.outbox).get()!.status).toBe('pending')
    const [idx] = sqliteRows(raw, `select sql from sqlite_master where name = 'outbox_pending_idx'`)
    expect(idx!['sql']).toMatch(/WHERE status = 'pending'/)
  })
  it('every reference table has version and updated_at (D47 item 8)', () => {
    const REF_TABLES = ['user', 'device', 'setting', 'category', 'product', 'size', 'product_variant', 'sweetness_level', 'channel', 'price', 'recipe', 'recipe_line', 'item', 'purchase_unit', 'bom', 'bom_line', 'equipment', 'customer'] as const
    const names = sqliteRows(raw, `select name from sqlite_master where type = 'table' and name not like '__drizzle%' and name not like 'sqlite_%'`).map((r) => r['name'])
    for (const t of REF_TABLES) {
      expect(names, t).toContain(t)
      const cols = sqliteRows(raw, `select name from pragma_table_info('${t}')`).map((r) => r['name'])
      expect(cols, `${t}.version`).toContain('version')
      expect(cols, `${t}.updated_at`).toContain('updated_at')
    }
  })
})

/** Fixtures shared by the D47 item 5–9 tests below (both dialects insert the same shapes). */
function d47Fixture(channelId: string) {
  return {
    device1: { id: 'dev-1', name: 'Tablet A', receiptPrefix: 'A', isSellingDevice: true, registeredAt: NOW, updatedAt: NOW },
    device2: { id: 'dev-2', name: 'Tablet B', receiptPrefix: 'B', isSellingDevice: true, registeredAt: NOW, updatedAt: NOW },
    shift1: { id: 'shift-1', deviceId: 'dev-1', businessDate: '2026-09-18', status: 'open' as const, openedBy: 'u1', openedAt: NOW, openingFloatSatang: 0 },
    order1: {
      id: 'order-1', origin: 'device' as const, deviceId: 'dev-1', businessDate: '2026-09-18', channelId, status: 'open' as const,
      subtotalSatang: 100, discountSatang: 0, totalSatang: 100, vatSatang: 0, costSatang: 0, queueNo: 1,
      createdByType: 'user' as const, createdById: 'u1', createdAt: NOW,
    },
  }
}

describe('sqlite: D47 items 5–9 (order/shift uniques, CHECK constraints, setting PK)', () => {
  let db: SQLJsDatabase
  let f: ReturnType<typeof d47Fixture>
  beforeAll(async () => {
    ;({ db } = await openSqliteMemory())
    migrateSqlite(db)
    await applySeedSqlite(db, seedToRows(seed, seedOpts()))
    const channel = db.select().from(sqlite.channel).limit(1).get()!
    f = d47Fixture(channel.id)
    db.insert(sqlite.user).values(user).run()
    db.insert(sqlite.device).values(f.device1).run()
    db.insert(sqlite.device).values(f.device2).run()
    db.insert(sqlite.shift).values(f.shift1).run()
    db.insert(sqlite.order).values(f.order1).run()
  })

  it('item 5: rejects a duplicate queue number on the same device and day, accepts it on a different device', () => {
    expect(() => db.insert(sqlite.order).values({ ...f.order1, id: 'order-1b' }).run()).toThrow(/UNIQUE/)
    expect(() => db.insert(sqlite.order).values({ ...f.order1, id: 'order-2', deviceId: 'dev-2' }).run()).not.toThrow()
  })

  it('item 6: rejects a second open shift on the same device, accepts one on a different device', () => {
    expect(() => db.insert(sqlite.shift).values({ ...f.shift1, id: 'shift-1b' }).run()).toThrow(/UNIQUE/)
    expect(() => db.insert(sqlite.shift).values({ ...f.shift1, id: 'shift-2', deviceId: 'dev-2' }).run()).not.toThrow()
    db.insert(sqlite.shift).values({ ...f.shift1, id: 'shift-1c', status: 'closed', closedBy: 'u1', closedAt: NOW }).run()
  })

  it('item 7: cash_movement — VOID_REFUND without order_id is rejected, PAID_IN with order_id is rejected', () => {
    const base = { shiftId: 'shift-1', amountSatang: 500, createdBy: 'u1', createdAt: NOW }
    expect(() => db.insert(sqlite.cashMovement).values({ ...base, id: 'cm-1', kind: 'VOID_REFUND', orderId: null }).run()).toThrow(/CHECK/)
    expect(() => db.insert(sqlite.cashMovement).values({ ...base, id: 'cm-2', kind: 'PAID_IN', orderId: 'order-1' }).run()).toThrow(/CHECK/)
    expect(() => db.insert(sqlite.cashMovement).values({ ...base, id: 'cm-3', kind: 'VOID_REFUND', orderId: 'order-1' }).run()).not.toThrow()
    expect(() => db.insert(sqlite.cashMovement).values({ ...base, id: 'cm-4', kind: 'PAID_IN', orderId: null }).run()).not.toThrow()
    expect(() => db.insert(sqlite.cashMovement).values({ ...base, id: 'cm-5', kind: 'PAID_OUT', orderId: null, amountSatang: 0 }).run()).toThrow(/CHECK/)
  })

  it('item 7: order — negative totals and discount over subtotal are rejected', () => {
    const base = { ...f.order1, deviceId: 'dev-2', queueNo: 2 }
    expect(() => db.insert(sqlite.order).values({ ...base, id: 'order-neg-1', subtotalSatang: -1 }).run()).toThrow(/CHECK/)
    expect(() => db.insert(sqlite.order).values({ ...base, id: 'order-neg-2', discountSatang: -1 }).run()).toThrow(/CHECK/)
    expect(() => db.insert(sqlite.order).values({ ...base, id: 'order-neg-3', totalSatang: -1 }).run()).toThrow(/CHECK/)
    expect(() => db.insert(sqlite.order).values({ ...base, id: 'order-neg-4', subtotalSatang: 100, discountSatang: 101, totalSatang: -1 }).run()).toThrow(/CHECK/)
  })

  it('item 7: payment.amount_satang must be > 0', () => {
    const base = { orderId: 'order-1', method: 'CASH' as const, verifyStatus: 'manual' as const, createdBy: 'u1', createdAt: NOW }
    expect(() => db.insert(sqlite.payment).values({ ...base, id: 'pay-1', amountSatang: 0 }).run()).toThrow(/CHECK/)
    expect(() => db.insert(sqlite.payment).values({ ...base, id: 'pay-2', amountSatang: 100 }).run()).not.toThrow()
  })

  it('item 7: stock_movement.qty_milli cannot be zero', () => {
    const itemRow = db.select().from(sqlite.item).limit(1).get()!
    const base = { itemId: itemRow.id, kind: 'COUNT_ADJ' as const, unitCostUsat: 1, refType: 'test', refId: 'x', businessDate: '2026-09-18', createdBy: 'u1', createdAt: NOW }
    expect(() => db.insert(sqlite.stockMovement).values({ ...base, id: 'sm-1', qtyMilli: 0 }).run()).toThrow(/CHECK/)
    expect(() => db.insert(sqlite.stockMovement).values({ ...base, id: 'sm-2', qtyMilli: -1 }).run()).not.toThrow()
  })

  it('item 7: order_line.qty must be > 0', () => {
    const variant = db.select().from(sqlite.productVariant).limit(1).get()!
    const sweet = db.select().from(sqlite.sweetnessLevel).limit(1).get()!
    const base = {
      orderId: 'order-1', variantId: variant.id, sweetnessId: sweet.id, productName: 'x', sizeName: 'x', sweetnessName: 'x',
      unitPriceSatang: 10, lineTotalSatang: 10, unitCostSatang: 5,
    }
    expect(() => db.insert(sqlite.orderLine).values({ ...base, id: 'ol-1', lineNo: 1, qty: 0 }).run()).toThrow(/CHECK/)
    expect(() => db.insert(sqlite.orderLine).values({ ...base, id: 'ol-2', lineNo: 2, qty: 1 }).run()).not.toThrow()
  })

  it('item 9: setting primary key is (key, effective_from) — same key, different effective_from is allowed; exact duplicate is rejected', () => {
    db.insert(sqlite.setting).values({ key: 'vat.enabled', valueJson: false, effectiveFrom: '2026-01-01', updatedAt: NOW }).run()
    expect(() => db.insert(sqlite.setting).values({ key: 'vat.enabled', valueJson: true, effectiveFrom: '2026-06-01', updatedAt: NOW }).run()).not.toThrow()
    expect(() => db.insert(sqlite.setting).values({ key: 'vat.enabled', valueJson: true, effectiveFrom: '2026-01-01', updatedAt: NOW }).run()).toThrow(/UNIQUE|PRIMARY KEY/)
  })
})

describe('pg: D47 items 5–9 (order/shift uniques, CHECK constraints, setting PK)', () => {
  let db: PgliteDatabase
  let client: PGlite
  let f: ReturnType<typeof d47Fixture>
  beforeAll(async () => {
    ;({ db, client } = await openPglite())
    await migratePg(db)
    await applySeedPg(db, seedToRows(seed, seedOpts()))
    const [channel] = await db.select().from(pg.channel).limit(1)
    f = d47Fixture(channel!.id)
    await db.insert(pg.user).values(user)
    await db.insert(pg.device).values(f.device1)
    await db.insert(pg.device).values(f.device2)
    await db.insert(pg.shift).values(f.shift1)
    await db.insert(pg.order).values(f.order1)
  })
  afterAll(async () => { await client.close() })

  it('item 5: rejects a duplicate queue number on the same device and day, accepts it on a different device', async () => {
    expect(await pgErrorCode(db.insert(pg.order).values({ ...f.order1, id: 'order-1b', serverSeq: undefined }))).toBe('23505')
    expect(await pgErrorCode(db.insert(pg.order).values({ ...f.order1, id: 'order-2', deviceId: 'dev-2', serverSeq: undefined }))).toBe('no error')
  })

  it('item 6: rejects a second open shift on the same device, accepts one on a different device', async () => {
    expect(await pgErrorCode(db.insert(pg.shift).values({ ...f.shift1, id: 'shift-1b' }))).toBe('23505')
    expect(await pgErrorCode(db.insert(pg.shift).values({ ...f.shift1, id: 'shift-2', deviceId: 'dev-2' }))).toBe('no error')
    await db.insert(pg.shift).values({ ...f.shift1, id: 'shift-1c', status: 'closed', closedBy: 'u1', closedAt: NOW })
  })

  it('item 7: cash_movement — VOID_REFUND without order_id is rejected, PAID_IN with order_id is rejected', async () => {
    const base = { shiftId: 'shift-1', amountSatang: 500, createdBy: 'u1', createdAt: NOW }
    expect(await pgErrorCode(db.insert(pg.cashMovement).values({ ...base, id: 'cm-1', kind: 'VOID_REFUND', orderId: null }))).toBe('23514')
    expect(await pgErrorCode(db.insert(pg.cashMovement).values({ ...base, id: 'cm-2', kind: 'PAID_IN', orderId: 'order-1' }))).toBe('23514')
    expect(await pgErrorCode(db.insert(pg.cashMovement).values({ ...base, id: 'cm-3', kind: 'VOID_REFUND', orderId: 'order-1' }))).toBe('no error')
    expect(await pgErrorCode(db.insert(pg.cashMovement).values({ ...base, id: 'cm-4', kind: 'PAID_IN', orderId: null }))).toBe('no error')
    expect(await pgErrorCode(db.insert(pg.cashMovement).values({ ...base, id: 'cm-5', kind: 'PAID_OUT', orderId: null, amountSatang: 0 }))).toBe('23514')
  })

  it('item 7: order — negative totals and discount over subtotal are rejected', async () => {
    const base = { ...f.order1, deviceId: 'dev-2', queueNo: 2, serverSeq: undefined }
    expect(await pgErrorCode(db.insert(pg.order).values({ ...base, id: 'order-neg-1', subtotalSatang: -1 }))).toBe('23514')
    expect(await pgErrorCode(db.insert(pg.order).values({ ...base, id: 'order-neg-2', discountSatang: -1 }))).toBe('23514')
    expect(await pgErrorCode(db.insert(pg.order).values({ ...base, id: 'order-neg-3', totalSatang: -1 }))).toBe('23514')
    expect(await pgErrorCode(db.insert(pg.order).values({ ...base, id: 'order-neg-4', subtotalSatang: 100, discountSatang: 101, totalSatang: -1 }))).toBe('23514')
  })

  it('item 7: payment.amount_satang must be > 0', async () => {
    const base = { orderId: 'order-1', method: 'CASH' as const, verifyStatus: 'manual' as const, createdBy: 'u1', createdAt: NOW }
    expect(await pgErrorCode(db.insert(pg.payment).values({ ...base, id: 'pay-1', amountSatang: 0 }))).toBe('23514')
    expect(await pgErrorCode(db.insert(pg.payment).values({ ...base, id: 'pay-2', amountSatang: 100 }))).toBe('no error')
  })

  it('item 7: stock_movement.qty_milli cannot be zero', async () => {
    const [itemRow] = await db.select().from(pg.item).limit(1)
    const base = { itemId: itemRow!.id, kind: 'COUNT_ADJ' as const, unitCostUsat: 1, refType: 'test', refId: 'x', businessDate: '2026-09-18', createdBy: 'u1', createdAt: NOW }
    expect(await pgErrorCode(db.insert(pg.stockMovement).values({ ...base, id: 'sm-1', qtyMilli: 0 }))).toBe('23514')
    expect(await pgErrorCode(db.insert(pg.stockMovement).values({ ...base, id: 'sm-2', qtyMilli: -1 }))).toBe('no error')
  })

  it('item 7: order_line.qty must be > 0', async () => {
    const [variant] = await db.select().from(pg.productVariant).limit(1)
    const [sweet] = await db.select().from(pg.sweetnessLevel).limit(1)
    const base = {
      orderId: 'order-1', variantId: variant!.id, sweetnessId: sweet!.id, productName: 'x', sizeName: 'x', sweetnessName: 'x',
      unitPriceSatang: 10, lineTotalSatang: 10, unitCostSatang: 5,
    }
    expect(await pgErrorCode(db.insert(pg.orderLine).values({ ...base, id: 'ol-1', lineNo: 1, qty: 0 }))).toBe('23514')
    expect(await pgErrorCode(db.insert(pg.orderLine).values({ ...base, id: 'ol-2', lineNo: 2, qty: 1 }))).toBe('no error')
  })

  it('item 9: setting primary key is (key, effective_from) — same key, different effective_from is allowed; exact duplicate is rejected', async () => {
    await db.insert(pg.setting).values({ key: 'vat.enabled', valueJson: false, effectiveFrom: '2026-01-01', updatedAt: NOW })
    expect(await pgErrorCode(db.insert(pg.setting).values({ key: 'vat.enabled', valueJson: true, effectiveFrom: '2026-06-01', updatedAt: NOW }))).toBe('no error')
    expect(await pgErrorCode(db.insert(pg.setting).values({ key: 'vat.enabled', valueJson: true, effectiveFrom: '2026-01-01', updatedAt: NOW }))).toBe('23505')
  })

  it('every pg reference table has version and updated_at (D47 item 8)', async () => {
    const REF_TABLES = ['user', 'device', 'setting', 'category', 'product', 'size', 'product_variant', 'sweetness_level', 'channel', 'price', 'recipe', 'recipe_line', 'item', 'purchase_unit', 'bom', 'bom_line', 'equipment', 'customer']
    const r = await db.execute<{ table_name: string; column_name: string }>(sql`select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name in ('version', 'updated_at')`)
    const byTable = new Map<string, Set<string>>()
    for (const row of r.rows) byTable.set(row.table_name, (byTable.get(row.table_name) ?? new Set()).add(row.column_name))
    for (const t of REF_TABLES) {
      expect(byTable.get(t), t).toBeDefined()
      expect([...(byTable.get(t) ?? [])].sort(), t).toEqual(['updated_at', 'version'])
    }
  })
})

describe('pg constraints (M3, M5)', () => {
  let db: PgliteDatabase
  let client: PGlite
  beforeAll(async () => {
    ;({ db, client } = await openPglite())
    await migratePg(db)
    await applySeedPg(db, seedToRows(seed, seedOpts()))
  })
  afterAll(async () => { await client.close() })

  it('has the report and FK indexes', async () => {
    const r = await db.execute<{ indexname: string }>(sql`select indexname from pg_indexes where schemaname = 'public'`)
    const names = r.rows.map((x) => x.indexname)
    for (const n of EXPECTED_INDEXES) expect(names, n).toContain(n)
  })
  it('allows only one current recipe per (variant, sweetness)', async () => {
    const [r] = await db.select().from(pg.recipe).limit(1)
    expect(await pgErrorCode(db.insert(pg.recipe).values({ ...r!, id: 'r-v2', version: 2, serverSeq: undefined }))).toBe('23505')
    await db.insert(pg.recipe).values({ ...r!, id: 'r-v2', version: 2, isCurrent: false, serverSeq: undefined })
  })
  it('allows only one current BOM per item', async () => {
    const [b] = await db.select().from(pg.bom).limit(1)
    expect(await pgErrorCode(db.insert(pg.bom).values({ ...b!, id: 'b-v2', version: 2, serverSeq: undefined }))).toBe('23505')
    await db.insert(pg.bom).values({ ...b!, id: 'b-v2', version: 2, isCurrent: false, serverSeq: undefined })
  })
  it('rejects a second price for the same (variant, channel, effective_from)', async () => {
    const [p] = await db.select().from(pg.price).limit(1)
    expect(await pgErrorCode(db.insert(pg.price).values({ ...p!, id: 'p-dup', serverSeq: undefined }))).toBe('23505')
  })
  it('rejects a second count line for the same item in one count', async () => {
    const [item] = await db.select().from(pg.item).where(eq(pg.item.code, 'PB-TEA-THAI'))
    await db.insert(pg.user).values(user)
    await db.insert(pg.stockCount).values(count)
    const line = { id: 'l1', countId: 'sc1', itemId: item!.id, countedUnitsMilli: 0, countedUseMilli: 0, expectedUseMilli: 0, varianceUseMilli: 0, varianceSatang: 0 }
    await db.insert(pg.stockCountLine).values(line)
    expect(await pgErrorCode(db.insert(pg.stockCountLine).values({ ...line, id: 'l2' }))).toBe('23505')
  })
})
