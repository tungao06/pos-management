import { eq } from 'drizzle-orm'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { ItemKind } from '@dayo/contracts'
import { buildCatalog, type Catalog } from '@dayo/domain'
import * as p from '../pg/index.js'
import type { SeedRows } from './rows.js'

const CHUNK = 500

function chunks<T>(rows: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK))
  return out
}

/** Insert every seed row in one transaction, parents before children. Chunks stay under Postgres' parameter limit. */
export async function applySeedPg(db: PgliteDatabase, rows: SeedRows): Promise<void> {
  await db.transaction(async (tx) => {
    for (const c of chunks(rows.categories)) await tx.insert(p.category).values(c)
    for (const c of chunks(rows.items)) await tx.insert(p.item).values(c)
    for (const c of chunks(rows.purchaseUnits)) await tx.insert(p.purchaseUnit).values(c)
    for (const c of chunks(rows.boms)) await tx.insert(p.bom).values(c)
    for (const c of chunks(rows.bomLines)) await tx.insert(p.bomLine).values(c)
    for (const c of chunks(rows.sizes)) await tx.insert(p.size).values(c)
    for (const c of chunks(rows.products)) await tx.insert(p.product).values(c)
    for (const c of chunks(rows.variants)) await tx.insert(p.productVariant).values(c)
    for (const c of chunks(rows.sweetness)) await tx.insert(p.sweetnessLevel).values(c)
    for (const c of chunks(rows.channels)) await tx.insert(p.channel).values(c)
    for (const c of chunks(rows.prices)) await tx.insert(p.price).values(c)
    for (const c of chunks(rows.recipes)) await tx.insert(p.recipe).values(c)
    for (const c of chunks(rows.recipeLines)) await tx.insert(p.recipeLine).values(c)
    for (const c of chunks(rows.equipment)) await tx.insert(p.equipment).values(c)
  })
}

/** Domain catalog from the DB (current BOM versions only). Catalog ids are item.id (UUIDs), not item codes. */
export async function loadCatalogPg(db: PgliteDatabase): Promise<Catalog> {
  const items = (await db.select().from(p.item)).map((i) => ({ id: i.id, kind: ItemKind.parse(i.kind), isTracked: i.isTracked, standardCostUsat: i.standardCostUsat }))
  const boms = await db.select().from(p.bom).where(eq(p.bom.isCurrent, true))
  const lines = await db.select().from(p.bomLine)
  return buildCatalog(items, boms.map((b) => ({ itemId: b.itemId, yieldMilli: b.yieldMilli, lines: lines.filter((l) => l.bomId === b.id).map((l) => ({ itemId: l.componentItemId, qtyMilli: l.qtyMilli })) })))
}
