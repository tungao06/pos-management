import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { count, eq } from 'drizzle-orm'
import { parseSeed, type Seed } from '@dayo/contracts'
import { needsCostSatang, standardUnitCostUsat, type Catalog } from '@dayo/domain'
import { migratePg } from '../src/migrate-pg.js'
import { migrateSqlite } from '../src/migrate-sqlite.js'
import * as pg from '../src/pg/index.js'
import * as sqlite from '../src/sqlite/index.js'
import { applySeedPg, loadCatalogPg } from '../src/seed/apply-pg.js'
import { applySeedSqlite, loadCatalogSqlite } from '../src/seed/apply-sqlite.js'
import { seedToRows, type SeedOpts } from '../src/seed/rows.js'
import { openPglite, openSqliteMemory, sqliteRows } from './helpers.js'

const seed: Seed = parseSeed(JSON.parse(readFileSync(fileURLToPath(new URL('../../excel-import/seed/dayo-seed.json', import.meta.url)), 'utf8')))

function opts(): SeedOpts {
  let n = 0
  return { newId: () => `id-${String(++n).padStart(5, '0')}`, now: '2026-09-17T00:00:00.000Z', effectiveFrom: '2026-09-17T00:00:00.000Z' }
}

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
  it('throws on a code that does not resolve', () => {
    const bad = { ...seed, prices: [{ ...seed.prices[0]!, productCode: 'NOPE' }] }
    expect(() => seedToRows(bad, opts())).toThrow(/unknown variant NOPE/)
  })
})

describe('apply seed', () => {
  it('sqlite: inserts everything, FK check clean, costs from the DB match Excel exactly', async () => {
    const { db, raw } = await openSqliteMemory()
    migrateSqlite(db)
    applySeedSqlite(db, seedToRows(seed, opts()))
    expect(db.select({ c: count() }).from(sqlite.item).get()!.c).toBe(EXPECTED.items)
    expect(db.select({ c: count() }).from(sqlite.purchaseUnit).get()!.c).toBe(EXPECTED.purchaseUnits)
    expect(db.select({ c: count() }).from(sqlite.recipe).get()!.c).toBe(EXPECTED.recipes)
    expect(db.select({ c: count() }).from(sqlite.recipeLine).get()!.c).toBe(EXPECTED.recipeLines)
    expect(db.select({ c: count() }).from(sqlite.equipment).get()!.c).toBe(EXPECTED.equipment)
    expect(sqliteRows(raw, 'PRAGMA foreign_key_check')).toEqual([])

    const catalog = loadCatalogSqlite(db)
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
