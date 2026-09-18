import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import type { PGlite } from '@electric-sql/pglite'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { parseSeed, type Seed } from '@dayo/contracts'
import { migratePg } from '../src/migrate-pg.js'
import * as pg from '../src/pg/index.js'
import { applySeedPg } from '../src/seed/apply-pg.js'
import { seedToRows } from '../src/seed/rows.js'
import { openPglite, seedOpts } from './helpers.js'

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
