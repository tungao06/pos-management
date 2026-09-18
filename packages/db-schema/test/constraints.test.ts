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

/** Indexes added for reports and server-side FK joins (M3), plus the partial "one current version" uniques (M5). */
const EXPECTED_INDEXES = [
  'stock_movement_item_date_idx', 'stock_movement_business_date_idx', 'order_shift_idx', 'order_business_date_status_idx',
  'payment_order_idx', 'discount_order_idx', 'cash_movement_shift_idx', 'cash_movement_order_idx', 'cash_count_shift_idx',
  'purchase_line_purchase_idx', 'order_payment_intent_order_idx', 'recipe_current_uq', 'bom_current_uq',
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
