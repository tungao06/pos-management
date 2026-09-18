import { eq } from 'drizzle-orm'
import type { BaseSQLiteDatabase, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { ItemKind } from '@dayo/contracts'
import { buildCatalog, type Catalog } from '@dayo/domain'
import * as s from '../sqlite/index.js'
import { SEED_TABLES, type SeedRows, type SeedTable } from './rows.js'

const CHUNK = 500

/** sqlite table per SEED_TABLES entry (the compiler checks every entry has one). */
const TABLES = {
  category: s.category, item: s.item, purchase_unit: s.purchaseUnit, bom: s.bom, bom_line: s.bomLine, size: s.size,
  product: s.product, product_variant: s.productVariant, sweetness_level: s.sweetnessLevel, channel: s.channel,
  price: s.price, recipe: s.recipe, recipe_line: s.recipeLine, equipment: s.equipment,
} satisfies Record<SeedTable, SQLiteTable>

/** Every insert of the seed, in SEED_TABLES order, chunked. */
function batches(rows: SeedRows): [SQLiteTable, unknown[]][] {
  const out: [SQLiteTable, unknown[]][] = []
  for (const { key, table } of SEED_TABLES) {
    const all = rows[key] as unknown[]
    for (let i = 0; i < all.length; i += CHUNK) out.push([TABLES[table], all.slice(i, i + CHUNK)])
  }
  return out
}

/**
 * Insert every seed row in one transaction, in SEED_TABLES order (parents before children). Any drizzle SQLite
 * driver: sync ones (sql.js, better-sqlite3) and async ones (sqlite-proxy, libsql).
 * A sync driver runs the whole transaction synchronously; the promise only reports the result.
 * NOT idempotent: it is meant for an empty database. On a database that already holds the seed it throws on the first
 * duplicate primary key and the transaction rolls back, leaving the existing rows untouched.
 */
export async function applySeedSqlite<K extends 'sync' | 'async', R, S extends Record<string, unknown>>(db: BaseSQLiteDatabase<K, R, S>, rows: SeedRows): Promise<void> {
  const work = batches(rows)
  // `resultKind` is drizzle's own runtime flag. A sync transaction cannot await, so it gets a sync callback.
  if ((db as unknown as { resultKind: string }).resultKind === 'sync') {
    const sync = db as unknown as BaseSQLiteDatabase<'sync', unknown>
    sync.transaction((tx) => { for (const [t, c] of work) tx.insert(t).values(c as never).run() })
    return
  }
  const async = db as unknown as BaseSQLiteDatabase<'async', unknown>
  await async.transaction(async (tx) => { for (const [t, c] of work) await tx.insert(t).values(c as never) })
}

/** Domain catalog from the DB (current BOM versions only). Catalog ids are item.id (UUIDs), not item codes. Sync or async driver. */
export async function loadCatalogSqlite<K extends 'sync' | 'async', R, S extends Record<string, unknown>>(db: BaseSQLiteDatabase<K, R, S>): Promise<Catalog> {
  const items = (await db.select().from(s.item)).map((i) => ({ id: i.id, kind: ItemKind.parse(i.kind), isTracked: i.isTracked, standardCostUsat: i.standardCostUsat }))
  const boms = await db.select().from(s.bom).where(eq(s.bom.isCurrent, true))
  const lines = await db.select().from(s.bomLine)
  return buildCatalog(items, boms.map((b) => ({ itemId: b.itemId, yieldMilli: b.yieldMilli, lines: lines.filter((l) => l.bomId === b.id).map((l) => ({ itemId: l.componentItemId, qtyMilli: l.qtyMilli })) })))
}
