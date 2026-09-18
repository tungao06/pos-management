import { eq } from 'drizzle-orm'
import type { SQLJsDatabase } from 'drizzle-orm/sql-js'
import { ItemKind } from '@dayo/contracts'
import { buildCatalog, type Catalog } from '@dayo/domain'
import * as s from '../sqlite/index.js'
import type { SeedRows } from './rows.js'

const CHUNK = 500

function chunks<T>(rows: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK))
  return out
}

/** Insert every seed row in one transaction, parents before children. */
export function applySeedSqlite(db: SQLJsDatabase, rows: SeedRows): void {
  db.transaction((tx) => {
    for (const c of chunks(rows.categories)) tx.insert(s.category).values(c).run()
    for (const c of chunks(rows.items)) tx.insert(s.item).values(c).run()
    for (const c of chunks(rows.purchaseUnits)) tx.insert(s.purchaseUnit).values(c).run()
    for (const c of chunks(rows.boms)) tx.insert(s.bom).values(c).run()
    for (const c of chunks(rows.bomLines)) tx.insert(s.bomLine).values(c).run()
    for (const c of chunks(rows.sizes)) tx.insert(s.size).values(c).run()
    for (const c of chunks(rows.products)) tx.insert(s.product).values(c).run()
    for (const c of chunks(rows.variants)) tx.insert(s.productVariant).values(c).run()
    for (const c of chunks(rows.sweetness)) tx.insert(s.sweetnessLevel).values(c).run()
    for (const c of chunks(rows.channels)) tx.insert(s.channel).values(c).run()
    for (const c of chunks(rows.prices)) tx.insert(s.price).values(c).run()
    for (const c of chunks(rows.recipes)) tx.insert(s.recipe).values(c).run()
    for (const c of chunks(rows.recipeLines)) tx.insert(s.recipeLine).values(c).run()
    for (const c of chunks(rows.equipment)) tx.insert(s.equipment).values(c).run()
  })
}

/** Domain catalog from the DB (current BOM versions only). Catalog ids are item.id (UUIDs), not item codes. */
export function loadCatalogSqlite(db: SQLJsDatabase): Catalog {
  const items = db.select().from(s.item).all().map((i) => ({ id: i.id, kind: ItemKind.parse(i.kind), isTracked: i.isTracked, standardCostUsat: i.standardCostUsat }))
  const boms = db.select().from(s.bom).where(eq(s.bom.isCurrent, true)).all()
  const lines = db.select().from(s.bomLine).all()
  return buildCatalog(items, boms.map((b) => ({ itemId: b.itemId, yieldMilli: b.yieldMilli, lines: lines.filter((l) => l.bomId === b.id).map((l) => ({ itemId: l.componentItemId, qtyMilli: l.qtyMilli })) })))
}
