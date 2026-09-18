import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { describe, expect, it } from 'vitest'
import { parseSeed } from '@dayo/contracts'
import { needsCostSatang, standardUnitCostUsat } from '@dayo/domain'
import {
  applySeedSqlite,
  canonicalSeedOpts,
  deterministicSeedId,
  loadCatalogSqlite,
  migrateSqliteRemote,
  SEED_EFFECTIVE_FROM,
  SEED_ID_NAMESPACE,
  seedToRows,
} from '../src/browser/index.js'
import * as s from '../src/sqlite/index.js'
import { nodeSqliteCallback, type NodeSqliteLike } from '../src/testing/node-sqlite-callback.js'

const seed = parseSeed(JSON.parse(readFileSync(fileURLToPath(new URL('../../excel-import/seed/dayo-seed.json', import.meta.url)), 'utf8')))

describe('canonicalSeedOpts (the device ↔ server id contract)', () => {
  it('pins the namespace, the effective time and two ids — changing any of them breaks sync with the server', () => {
    expect(SEED_ID_NAMESPACE).toBe('dayo-seed-v1')
    expect(SEED_EFFECTIVE_FROM).toBe('2026-01-01T00:00:00.000Z')
    const o = canonicalSeedOpts()
    expect(o.now).toBe(SEED_EFFECTIVE_FROM)
    expect(o.effectiveFrom).toBe(SEED_EFFECTIVE_FROM)
    expect(o.newId('item', 'RM-TEA-01')).toBe('0b01d559-70d6-8fac-9afd-8421542b7b08')
    expect(o.newId('recipe', 'Original|16oz|S050')).toBe('779dab3a-c8bd-89ec-b290-844f2992e035')
    expect(o.newId('item', 'RM-TEA-01')).toBe(deterministicSeedId(SEED_ID_NAMESPACE, 'item', 'RM-TEA-01'))
  })
})

describe('plan-2 seed helpers through the browser entry, over sqlite-proxy + node:sqlite', () => {
  it('seeds reference data with canonical ids, clean FKs, and Original 16oz 50% costs 14.75 baht from the DB', async () => {
    const raw = new DatabaseSync(':memory:')
    raw.exec('PRAGMA foreign_keys = ON')
    const db = drizzle(nodeSqliteCallback(raw as unknown as NodeSqliteLike))
    await migrateSqliteRemote(db)

    const rows = seedToRows(seed, canonicalSeedOpts())
    await applySeedSqlite(db, rows)
    expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])

    const countOf = async (table: string) => (await db.values<[number]>(sql.raw(`select count(*) from "${table}"`)))[0]?.[0]
    expect(await countOf('recipe')).toBe(360)
    expect(await countOf('product_variant')).toBe(72)
    expect(await countOf('item')).toBe(rows.items.length)
    const tea = await db.select().from(s.item).where(eq(s.item.code, 'RM-TEA-01')).get()
    expect(tea?.id).toBe('0b01d559-70d6-8fac-9afd-8421542b7b08')

    const catalog = await loadCatalogSqlite(db)
    const variant = await db.select().from(s.productVariant).where(eq(s.productVariant.sku, 'Original-16oz')).get()
    const s050 = await db.select().from(s.sweetnessLevel).where(eq(s.sweetnessLevel.code, 'S050')).get()
    const recipe = await db.select().from(s.recipe).where(and(eq(s.recipe.variantId, variant!.id), eq(s.recipe.sweetnessId, s050!.id))).get()
    expect(recipe?.id).toBe('779dab3a-c8bd-89ec-b290-844f2992e035')
    const lines = await db.select().from(s.recipeLine).where(eq(s.recipeLine.recipeId, recipe!.id)).all()
    const needs = new Map<string, number>()
    for (const l of lines) needs.set(l.itemId, (needs.get(l.itemId) ?? 0) + l.qtyMilli)
    expect(needsCostSatang(needs, (id) => standardUnitCostUsat(id, catalog))).toBe(1475)
  })
})
