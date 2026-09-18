import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { count, eq } from 'drizzle-orm'
import { getTableConfig as pgConfig, PgTable } from 'drizzle-orm/pg-core'
import { getTableConfig as sqliteConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { parseSeed, type Seed } from '@dayo/contracts'
import { needsCostSatang, standardUnitCostUsat, type Catalog } from '@dayo/domain'
import { migratePg } from '../src/migrate-pg.js'
import { migrateSqlite } from '../src/migrate-sqlite.js'
import * as pg from '../src/pg/index.js'
import * as sqlite from '../src/sqlite/index.js'
import { applySeedPg, loadCatalogPg } from '../src/seed/apply-pg.js'
import { applySeedSqlite, loadCatalogSqlite } from '../src/seed/apply-sqlite.js'
import { deterministicSeedId, SEED_TABLES, seedToRows, type SeedRows } from '../src/seed/rows.js'
import { openPglite, openSqliteMemory, openSqliteProxyMemory, pgErrorCode, seedOpts as opts, sqliteRows } from './helpers.js'

const seed: Seed = parseSeed(JSON.parse(readFileSync(fileURLToPath(new URL('../../excel-import/seed/dayo-seed.json', import.meta.url)), 'utf8')))

/** Expected row counts for the committed seed (plan-1 notes §1, D40). Re-check all of them whenever the fixture changes (D41). */
const EXPECTED = {
  categories: 3, items: 45, purchaseUnits: 35, boms: 10, bomLines: 33, sizes: 3, products: 24,
  variants: 72, sweetness: 5, channels: 5, prices: 72, recipes: 360, recipeLines: 2211, equipment: 32,
} as const

type RecipeRow = { id: string; variantId: string; sweetnessId: string }
type LineRow = { recipeId: string; itemId: string; qtyMilli: number }
type KeyRows = { variants: { id: string; productId: string; sizeId: string }[]; products: { id: string; code: string }[]; sizes: { id: string; code: string }[]; sweetness: { id: string; code: string }[] }

/** Cost per cup of every recipe read from the DB, keyed "product|size|sweetness" — rounded once over the sum (spec §4.2). */
function recipeCostsFromDb(catalog: Catalog, recipes: RecipeRow[], lines: LineRow[], k: KeyRows): Map<string, number> {
  const productCode = new Map(k.products.map((p) => [p.id, p.code]))
  const sizeCode = new Map(k.sizes.map((x) => [x.id, x.code]))
  const sweetCode = new Map(k.sweetness.map((x) => [x.id, x.code]))
  const variant = new Map(k.variants.map((v) => [v.id, v]))
  const linesByRecipe = new Map<string, LineRow[]>()
  for (const l of lines) linesByRecipe.set(l.recipeId, [...(linesByRecipe.get(l.recipeId) ?? []), l])
  const out = new Map<string, number>()
  for (const r of recipes) {
    const v = variant.get(r.variantId)!
    const needs = new Map<string, number>()
    for (const l of linesByRecipe.get(r.id) ?? []) needs.set(l.itemId, (needs.get(l.itemId) ?? 0) + l.qtyMilli)
    out.set(`${productCode.get(v.productId)}|${sizeCode.get(v.sizeId)}|${sweetCode.get(r.sweetnessId)}`, needsCostSatang(needs, (id) => standardUnitCostUsat(id, catalog)))
  }
  return out
}

function expectEveryRecipeMatchesExcel(costs: Map<string, number>): void {
  expect(costs.size).toBe(360)
  const failures: string[] = []
  for (const r of seed.recipes) {
    const key = `${r.productCode}|${r.sizeCode}|${r.sweetnessCode}`
    if (costs.get(key) !== r.excelCostSatang) failures.push(`${key}: db ${costs.get(key)} vs excel ${r.excelCostSatang}`)
  }
  expect(failures, failures.join('\n')).toEqual([])
}

describe('seedToRows', () => {
  it('creates the expected number of rows per table', () => {
    const rows = seedToRows(seed, opts())
    for (const [table, n] of Object.entries(EXPECTED)) expect(rows[table as keyof typeof EXPECTED], table).toHaveLength(n)
  })
  it('resolves codes to ids and keeps the importer values', () => {
    const rows = seedToRows(seed, opts())
    const original16 = rows.variants.find((v) => v.sku === 'Original-16oz')!
    expect(rows.prices.filter((p) => p.variantId === original16.id)).toHaveLength(1)
    expect(rows.recipes.filter((r) => r.variantId === original16.id)).toHaveLength(5)
    expect(rows.items.find((i) => i.code === 'PB-TEA-THAI')!.standardCostUsat).toBe(2_000_000)
    expect(rows.items.find((i) => i.code === 'PK-SET-16')!.standardCostUsat).toBe(400_000_000)
    expect(rows.equipment.find((e) => e.code === 'EQ-002')!.lifeMonths).toBe(36)
    const ids = [...rows.categories, ...rows.items, ...rows.purchaseUnits, ...rows.boms, ...rows.bomLines, ...rows.sizes, ...rows.products, ...rows.variants, ...rows.sweetness, ...rows.channels, ...rows.prices, ...rows.recipes, ...rows.recipeLines, ...rows.equipment].map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('is deterministic for a deterministic newId', () => {
    expect(JSON.stringify(seedToRows(seed, opts()))).toBe(JSON.stringify(seedToRows(seed, opts())))
  })
  it('ids depend on natural keys, not on array order (I2): a shuffled seed gives identical ids', () => {
    const rev = <T>(xs: readonly T[]): T[] => [...xs].reverse()
    const shuffled: Seed = {
      ...seed,
      categories: rev(seed.categories), sizes: rev(seed.sizes), sweetness: rev(seed.sweetness), channels: rev(seed.channels),
      items: rev(seed.items), purchaseUnits: rev(seed.purchaseUnits), products: rev(seed.products), variants: rev(seed.variants),
      prices: rev(seed.prices), equipment: rev(seed.equipment),
      boms: rev(seed.boms).map((b) => ({ ...b, lines: rev(b.lines) })),
      recipes: rev(seed.recipes).map((r) => ({ ...r, lines: rev(r.lines) })),
    }
    const a = seedToRows(seed, opts())
    const b = seedToRows(shuffled, opts())
    const byId = (rows: SeedRows) => Object.fromEntries(SEED_TABLES.map(({ key }) => [key, [...(rows[key] as { id: string }[])].sort((x, y) => x.id.localeCompare(y.id))]))
    expect(byId(b)).toEqual(byId(a))
    expect(b.items[0]!.id).not.toBe(a.items[0]!.id) // the arrays really were reordered
  })
  it('passes stable natural keys to newId', () => {
    const rows = seedToRows(seed, opts())
    const ns = (kind: string, key: string) => deterministicSeedId('test', kind, key)
    expect(rows.items.find((i) => i.code === 'RM-TEA-01')!.id).toBe(ns('item', 'RM-TEA-01'))
    const original16 = rows.variants.find((v) => v.sku === 'Original-16oz')!
    expect(original16.id).toBe(ns('product_variant', 'Original|16oz'))
    const s050 = rows.sweetness.find((x) => x.code === 'S050')!
    expect(rows.recipes.find((r) => r.variantId === original16.id && r.sweetnessId === s050.id)!.id).toBe(ns('recipe', 'Original|16oz|S050'))
    expect(rows.prices.find((p) => p.variantId === original16.id)!.id).toBe(ns('price', 'Original|16oz|STORE'))
    const thaiBase = rows.items.find((i) => i.code === 'PB-TEA-THAI')!
    expect(rows.boms.find((b) => b.itemId === thaiBase.id)!.id).toBe(ns('bom', 'PB-TEA-THAI'))
  })
  it('throws on a duplicate natural key', () => {
    expect(() => seedToRows({ ...seed, items: [...seed.items, seed.items[0]!] }, opts())).toThrow(/duplicate item /)
  })
  it('throws on a code that does not resolve', () => {
    const bad = { ...seed, prices: [{ ...seed.prices[0]!, productCode: 'NOPE' }] }
    expect(() => seedToRows(bad, opts())).toThrow(/unknown variant NOPE/)
  })
})

describe('deterministicSeedId', () => {
  it('is a UUIDv8 (RFC 9562) made from the first 16 bytes of SHA-256 over JSON [namespace, kind, key]', () => {
    const id = deterministicSeedId('dayo', 'item', 'RM-TEA-01')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    // independent re-computation with node:crypto
    const b = createHash('sha256').update(JSON.stringify(['dayo', 'item', 'RM-TEA-01']), 'utf8').digest().subarray(0, 16)
    b[6] = (b[6]! & 0x0f) | 0x80
    b[8] = (b[8]! & 0x3f) | 0x80
    const h = b.toString('hex')
    expect(id).toBe(`${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`)
  })
  it('separates namespace, kind and key unambiguously', () => {
    expect(deterministicSeedId('a', 'b|c', 'd')).not.toBe(deterministicSeedId('a', 'b', 'c|d'))
    expect(deterministicSeedId('dayo', 'item', 'X')).not.toBe(deterministicSeedId('other', 'item', 'X'))
    expect(deterministicSeedId('dayo', 'item', 'X')).not.toBe(deterministicSeedId('dayo', 'product', 'X'))
  })
})

describe('SEED_TABLES', () => {
  it('lists every SeedRows field once, with table names that exist in both dialects', () => {
    expect(SEED_TABLES.map((t) => t.key).sort()).toEqual(Object.keys(seedToRows(seed, opts())).sort())
    const sqliteNames = new Set(Object.values(sqlite).filter((v) => v instanceof SQLiteTable).map((t) => sqliteConfig(t as SQLiteTable).name))
    const pgNames = new Set(Object.values(pg).filter((v) => v instanceof PgTable).map((t) => pgConfig(t as PgTable).name))
    for (const { table } of SEED_TABLES) {
      expect(sqliteNames.has(table), table).toBe(true)
      expect(pgNames.has(table), table).toBe(true)
    }
  })
})

describe('apply seed', () => {
  it('sqlite: inserts everything, FK check clean, costs from the DB match Excel exactly', async () => {
    const { db, raw } = await openSqliteMemory()
    migrateSqlite(db)
    await applySeedSqlite(db, seedToRows(seed, opts()))
    expect(db.select({ c: count() }).from(sqlite.item).get()!.c).toBe(EXPECTED.items)
    expect(db.select({ c: count() }).from(sqlite.purchaseUnit).get()!.c).toBe(EXPECTED.purchaseUnits)
    expect(db.select({ c: count() }).from(sqlite.recipe).get()!.c).toBe(EXPECTED.recipes)
    expect(db.select({ c: count() }).from(sqlite.recipeLine).get()!.c).toBe(EXPECTED.recipeLines)
    expect(db.select({ c: count() }).from(sqlite.equipment).get()!.c).toBe(EXPECTED.equipment)
    expect(sqliteRows(raw, 'PRAGMA foreign_key_check')).toEqual([])

    const catalog = await loadCatalogSqlite(db)
    const thai = db.select().from(sqlite.item).where(eq(sqlite.item.code, 'PB-TEA-THAI')).get()!
    expect(thai.standardCostUsat).toBe(2_000_000)
    expect(standardUnitCostUsat(thai.id, catalog)).toBe(2_000_000)
    for (const i of db.select().from(sqlite.item).all()) {
      if (i.kind !== 'raw') expect(i.standardCostUsat, i.code).toBe(standardUnitCostUsat(i.id, catalog))
    }

    const costs = recipeCostsFromDb(catalog, db.select().from(sqlite.recipe).all(), db.select().from(sqlite.recipeLine).all(), {
      variants: db.select().from(sqlite.productVariant).all(),
      products: db.select().from(sqlite.product).all(),
      sizes: db.select().from(sqlite.size).all(),
      sweetness: db.select().from(sqlite.sweetnessLevel).all(),
    })
    expect(costs.get('Original|16oz|S050')).toBe(1475)
    expectEveryRecipeMatchesExcel(costs)
  })

  it('pg: inserts everything and the same costs come out', async () => {
    const { db, client } = await openPglite()
    try {
      await migratePg(db)
      await applySeedPg(db, seedToRows(seed, opts()))
      const [items] = await db.select({ c: count() }).from(pg.item)
      expect(items!.c).toBe(EXPECTED.items)
      const [lines] = await db.select({ c: count() }).from(pg.recipeLine)
      expect(lines!.c).toBe(EXPECTED.recipeLines)
      const [equipment] = await db.select({ c: count() }).from(pg.equipment)
      expect(equipment!.c).toBe(EXPECTED.equipment)

      const catalog = await loadCatalogPg(db)
      const [thai] = await db.select().from(pg.item).where(eq(pg.item.code, 'PB-TEA-THAI'))
      expect(thai!.standardCostUsat).toBe(2_000_000)
      expect(standardUnitCostUsat(thai!.id, catalog)).toBe(2_000_000)
      const [matchaShot] = await db.select().from(pg.item).where(eq(pg.item.code, 'PB-MATCHA-SHOT'))
      expect(matchaShot!.standardCostUsat).toBe(95_666_667) // bigint column read back as a JS number

      const costs = recipeCostsFromDb(catalog, await db.select().from(pg.recipe), await db.select().from(pg.recipeLine), {
        variants: await db.select().from(pg.productVariant),
        products: await db.select().from(pg.product),
        sizes: await db.select().from(pg.size),
        sweetness: await db.select().from(pg.sweetnessLevel),
      })
      expectEveryRecipeMatchesExcel(costs)
    } finally {
      await client.close()
    }
  })
})

describe('apply seed: async driver and re-apply', () => {
  it('sqlite-proxy (async driver): the same helpers insert everything and load the catalog', async () => {
    const { db, raw, syncDb } = await openSqliteProxyMemory()
    migrateSqlite(syncDb)
    await applySeedSqlite(db, seedToRows(seed, opts()))
    expect(sqliteRows(raw, 'select count(*) as n from recipe_line')[0]!['n']).toBe(EXPECTED.recipeLines)
    expect(sqliteRows(raw, 'PRAGMA foreign_key_check')).toEqual([])
    const catalog = await loadCatalogSqlite(db)
    const [thai] = await db.select().from(sqlite.item).where(eq(sqlite.item.code, 'PB-TEA-THAI'))
    expect(standardUnitCostUsat(thai!.id, catalog)).toBe(2_000_000)
  })
  it('sqlite: applying the seed twice throws and leaves the first copy intact (not idempotent)', async () => {
    const { db, raw } = await openSqliteMemory()
    migrateSqlite(db)
    const rows = seedToRows(seed, opts())
    await applySeedSqlite(db, rows)
    await expect(applySeedSqlite(db, rows)).rejects.toThrow()
    expect(sqliteRows(raw, 'select count(*) as n from item')[0]!['n']).toBe(EXPECTED.items)
    expect(sqliteRows(raw, 'select count(*) as n from recipe_line')[0]!['n']).toBe(EXPECTED.recipeLines)
  })
  it('pg: applying the seed twice throws and leaves the first copy intact (not idempotent)', async () => {
    const { db, client } = await openPglite()
    try {
      await migratePg(db)
      const rows = seedToRows(seed, opts())
      await applySeedPg(db, rows)
      expect(await pgErrorCode(applySeedPg(db, rows))).toBe('23505')
      const [items] = await db.select({ c: count() }).from(pg.item)
      expect(items!.c).toBe(EXPECTED.items)
    } finally {
      await client.close()
    }
  })
})
