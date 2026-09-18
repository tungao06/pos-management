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

describe('pg server_seq bump on UPDATE (I1, M7)', () => {
  let db: PgliteDatabase
  let client: PGlite
  beforeAll(async () => {
    ;({ db, client } = await openPglite())
    await migratePg(db)
    await applySeedPg(db, seedToRows(seed, seedOpts()))
  })
  afterAll(async () => { await client.close() })

  it('every table with a server_seq column has the bump trigger', async () => {
    const cols = await db.execute<{ table_name: string }>(sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'server_seq' order by table_name`)
    const trg = await db.execute<{ event_object_table: string }>(sql`select event_object_table from information_schema.triggers where trigger_schema = 'public' and event_manipulation = 'UPDATE' and action_statement = 'EXECUTE FUNCTION bump_server_seq()' order by event_object_table`)
    const withSeq = cols.rows.map((r) => r.table_name)
    expect(withSeq).toHaveLength(23) // 18 reference + order, order_line, order_event, payment, item_cost_state
    expect(trg.rows.map((r) => r.event_object_table)).toEqual(withSeq)
  })

  it('an UPDATE gives the row a server_seq above every existing value', async () => {
    const [recipe] = await db.select().from(pg.recipe).limit(1)
    const [{ max }] = (await db.execute<{ max: string }>(sql`select max(server_seq) as max from recipe`)).rows as [{ max: string }]
    await db.update(pg.recipe).set({ isCurrent: false }).where(eq(pg.recipe.id, recipe!.id))
    const [after] = await db.select().from(pg.recipe).where(eq(pg.recipe.id, recipe!.id))
    expect(after!.serverSeq).toBeGreaterThan(Number(max))
    expect(after!.serverSeq).toBeGreaterThan(recipe!.serverSeq)
  })

  it('an explicit server_seq in the UPDATE cannot move the cursor backwards', async () => {
    const [item] = await db.select().from(pg.item).limit(1)
    await db.update(pg.item).set({ isActive: false, serverSeq: 1 }).where(eq(pg.item.id, item!.id))
    const [after] = await db.select().from(pg.item).where(eq(pg.item.id, item!.id))
    expect(after!.serverSeq).toBeGreaterThan(item!.serverSeq)
  })

  it('"user" and "order" (reserved words) bump too, and T rows get server_received_at from the default', async () => {
    const [channel] = await db.select().from(pg.channel).limit(1)
    await db.insert(pg.user).values({ id: 'u1', displayName: 'Owner', role: 'owner', pinHash: 'x', isActive: true, createdAt: NOW, updatedAt: NOW, version: 1 })
    await db.insert(pg.order).values({
      id: 'o1', origin: 'server', businessDate: '2026-09-18', channelId: channel!.id, status: 'pending_payment', subtotalSatang: 0, discountSatang: 0,
      totalSatang: 0, vatSatang: 0, costSatang: 0, createdByType: 'system', createdById: 'server', createdAt: NOW,
    })
    const [u0] = await db.select().from(pg.user).where(eq(pg.user.id, 'u1'))
    const [o0] = await db.select().from(pg.order).where(eq(pg.order.id, 'o1'))
    expect(o0!.serverReceivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    await db.update(pg.user).set({ isActive: false }).where(eq(pg.user.id, 'u1'))
    await db.update(pg.order).set({ status: 'cancelled' }).where(eq(pg.order.id, 'o1'))
    const [u1] = await db.select().from(pg.user).where(eq(pg.user.id, 'u1'))
    const [o1] = await db.select().from(pg.order).where(eq(pg.order.id, 'o1'))
    expect(u1!.serverSeq).toBeGreaterThan(u0!.serverSeq)
    expect(o1!.serverSeq).toBeGreaterThan(o0!.serverSeq)
  })
})

const APPEND_ONLY = ['cash_movement', 'order_event', 'stock_movement', 'z_report'] as const

/** One row in each append-only table (plus the parents they need). Same shapes insert into both dialects. */
function ledgerFixture(itemId: string, channelId: string) {
  return {
    user: { id: 'u1', displayName: 'Owner', role: 'owner' as const, pinHash: 'x', isActive: true, createdAt: NOW, updatedAt: NOW, version: 1 },
    device: { id: 'd1', name: 'Tablet', receiptPrefix: 'A', isSellingDevice: true, registeredAt: NOW, updatedAt: NOW },
    shift: { id: 's1', deviceId: 'd1', businessDate: '2026-09-18', status: 'open' as const, openedBy: 'u1', openedAt: NOW, openingFloatSatang: 100_000 },
    order: {
      id: 'o1', origin: 'device' as const, deviceId: 'd1', businessDate: '2026-09-18', shiftId: 's1', channelId, status: 'open' as const, subtotalSatang: 0,
      discountSatang: 0, totalSatang: 0, vatSatang: 0, costSatang: 0, createdByType: 'user' as const, createdById: 'u1', createdAt: NOW,
    },
    stockMovement: { id: 'm1', itemId, kind: 'OPENING' as const, qtyMilli: 1000, unitCostUsat: 2_000_000, refType: 'opening', refId: 'x', businessDate: '2026-09-18', createdBy: 'u1', createdAt: NOW },
    orderEvent: {
      id: 'e1', orderId: 'o1', seq: 1, deviceId: 'd1', chainId: 'd1', chainSeq: 1, type: 'CREATED' as const, payloadJson: {}, actorType: 'user' as const,
      actorId: 'u1', at: NOW, prevHash: '0'.repeat(64), hash: '1'.repeat(64),
    },
    cashMovement: { id: 'c1', shiftId: 's1', kind: 'PAID_IN' as const, amountSatang: 500, reason: 'change', createdBy: 'u1', createdAt: NOW },
    zReport: { id: 'z1', shiftId: 's1', snapshotJson: {}, hash: '2'.repeat(64), createdAt: NOW },
  }
}

describe('append-only ledger tables (M6)', () => {
  describe('sqlite', () => {
    let db: SQLJsDatabase
    let raw: Database
    beforeAll(async () => {
      ;({ db, raw } = await openSqliteMemory())
      migrateSqlite(db)
      await applySeedSqlite(db, seedToRows(seed, seedOpts()))
      const f = ledgerFixture(db.select().from(sqlite.item).limit(1).get()!.id, db.select().from(sqlite.channel).limit(1).get()!.id)
      db.insert(sqlite.user).values(f.user).run()
      db.insert(sqlite.device).values(f.device).run()
      db.insert(sqlite.shift).values(f.shift).run()
      db.insert(sqlite.order).values(f.order).run()
      db.insert(sqlite.stockMovement).values(f.stockMovement).run()
      db.insert(sqlite.orderEvent).values(f.orderEvent).run()
      db.insert(sqlite.cashMovement).values(f.cashMovement).run()
      db.insert(sqlite.zReport).values(f.zReport).run()
    })

    it('has an update and a delete trigger on every append-only table after all migrations', () => {
      const names = sqliteRows(raw, `select name from sqlite_master where type = 'trigger' order by name`).map((r) => r['name'])
      expect(names).toEqual(APPEND_ONLY.flatMap((t) => [`${t}_no_delete`, `${t}_no_update`]))
    })
    for (const t of APPEND_ONLY) {
      it(`${t}: UPDATE and DELETE are rejected`, () => {
        expect(() => raw.run(`update "${t}" set id = id`)).toThrow(/append-only: UPDATE rejected/)
        expect(() => raw.run(`delete from "${t}"`)).toThrow(/append-only: DELETE rejected/)
        expect(sqliteRows(raw, `select count(*) as n from "${t}"`)[0]!['n']).toBe(1)
      })
    }
    it('the order row itself stays mutable (status changes are UPDATEs)', () => {
      db.update(sqlite.order).set({ status: 'paid' }).where(eq(sqlite.order.id, 'o1')).run()
      expect(db.select().from(sqlite.order).get()!.status).toBe('paid')
    })
  })

  describe('pg', () => {
    let db: PgliteDatabase
    let client: PGlite
    beforeAll(async () => {
      ;({ db, client } = await openPglite())
      await migratePg(db)
      await applySeedPg(db, seedToRows(seed, seedOpts()))
      const [item] = await db.select().from(pg.item).limit(1)
      const [channel] = await db.select().from(pg.channel).limit(1)
      const f = ledgerFixture(item!.id, channel!.id)
      await db.insert(pg.user).values(f.user)
      await db.insert(pg.device).values(f.device)
      await db.insert(pg.shift).values(f.shift)
      await db.insert(pg.order).values(f.order)
      await db.insert(pg.stockMovement).values(f.stockMovement)
      await db.insert(pg.orderEvent).values(f.orderEvent)
      await db.insert(pg.cashMovement).values(f.cashMovement)
      await db.insert(pg.zReport).values(f.zReport)
    })
    afterAll(async () => { await client.close() })

    it('has the append-only trigger on exactly the four ledger tables', async () => {
      const r = await db.execute<{ t: string }>(sql`select distinct event_object_table as t from information_schema.triggers where trigger_schema = 'public' and action_statement = 'EXECUTE FUNCTION reject_append_only_change()' order by 1`)
      expect(r.rows.map((x) => x.t)).toEqual([...APPEND_ONLY])
    })
    for (const t of APPEND_ONLY) {
      it(`${t}: UPDATE and DELETE are rejected (SQLSTATE 23001)`, async () => {
        expect(await pgErrorCode(db.execute(sql.raw(`update "${t}" set id = id`)))).toBe('23001')
        expect(await pgErrorCode(db.execute(sql.raw(`delete from "${t}"`)))).toBe('23001')
        const r = await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from "${t}"`))
        expect(r.rows[0]!.n).toBe(1)
      })
    }
  })
})
