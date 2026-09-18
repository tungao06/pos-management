import { eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT, PgTable } from 'drizzle-orm/pg-core'
import { ItemKind } from '@dayo/contracts'
import { buildCatalog, type Catalog } from '@dayo/domain'
import * as p from '../pg/index.js'
import { SEED_TABLES, type SeedRows, type SeedTable } from './rows.js'

/** Chunks stay under Postgres' parameter limit. */
const CHUNK = 500

/** pg table per SEED_TABLES entry (the compiler checks every entry has one). */
const TABLES = {
  category: p.category, item: p.item, purchase_unit: p.purchaseUnit, bom: p.bom, bom_line: p.bomLine, size: p.size,
  product: p.product, product_variant: p.productVariant, sweetness_level: p.sweetnessLevel, channel: p.channel,
  price: p.price, recipe: p.recipe, recipe_line: p.recipeLine, equipment: p.equipment,
} satisfies Record<SeedTable, PgTable>

/**
 * Insert every seed row in one transaction, in SEED_TABLES order (parents before children). Any drizzle pg driver
 * (PGlite in tests, node-postgres on the server). SeedRows are sqlite insert shapes; they fit pg because the pg-only
 * columns (server_seq) have defaults.
 * NOT idempotent: it is meant for an empty database. On a database that already holds the seed it throws on the first
 * duplicate primary key and the transaction rolls back, leaving the existing rows untouched.
 */
export async function applySeedPg<H extends PgQueryResultHKT, S extends Record<string, unknown>>(db: PgDatabase<H, S>, rows: SeedRows): Promise<void> {
  await db.transaction(async (tx) => {
    for (const { key, table } of SEED_TABLES) {
      const all = rows[key] as unknown[]
      for (let i = 0; i < all.length; i += CHUNK) await tx.insert(TABLES[table] as PgTable).values(all.slice(i, i + CHUNK) as never)
    }
  })
}

/** Domain catalog from the DB (current BOM versions only). Catalog ids are item.id (UUIDs), not item codes. */
export async function loadCatalogPg<H extends PgQueryResultHKT, S extends Record<string, unknown>>(db: PgDatabase<H, S>): Promise<Catalog> {
  const items = (await db.select().from(p.item)).map((i) => ({ id: i.id, kind: ItemKind.parse(i.kind), isTracked: i.isTracked, standardCostUsat: i.standardCostUsat }))
  const boms = await db.select().from(p.bom).where(eq(p.bom.isCurrent, true))
  const lines = await db.select().from(p.bomLine)
  return buildCatalog(items, boms.map((b) => ({ itemId: b.itemId, yieldMilli: b.yieldMilli, lines: lines.filter((l) => l.bomId === b.id).map((l) => ({ itemId: l.componentItemId, qtyMilli: l.qtyMilli })) })))
}
