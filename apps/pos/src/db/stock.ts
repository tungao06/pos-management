import { and, eq, inArray } from 'drizzle-orm'
import { loadCatalogSqlite, type RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { applyMovement, initialCostState, requireItem, VAT_OFF, type Catalog, type CostOf, type CostState, type MovementDraft, type SaleContext, type SaleRecipe } from '@dayo/domain'
import type { ApiDeps } from '../api/deps'
import { requireStoreChannelId } from '../api/menu'
import { enqueueOutbox } from './outbox'

export async function loadCostStates(db: RemoteDb): Promise<Map<string, CostState>> {
  const rows = await db.select().from(s.itemCostState).all()
  return new Map(rows.map((r) => [r.itemId, { onHandMilli: r.onHandMilli, avgCostUsat: r.avgCostUsat }]))
}

/**
 * Cost per use-unit for SALE/VOID (spec §4.2, §4.4, D29, D34): untracked raw items always at standard_cost;
 * tracked items at the moving average, or standard_cost before their first movement.
 */
export function makeCostOf(catalog: Catalog, states: ReadonlyMap<string, CostState>): CostOf {
  return (itemId) => {
    const item = requireItem(catalog, itemId)
    if (!item.isTracked) return item.standardCostUsat
    return states.get(itemId)?.avgCostUsat ?? item.standardCostUsat
  }
}

export type LoadedSaleContext = {
  sale: SaleContext
  catalog: Catalog
  variantNames: Map<string, { productName: string; sizeName: string }>
  sweetnessNames: Map<string, string>
}

/** Everything planSale needs for the given variants, read inside the sale transaction. */
export async function loadSaleContext(db: RemoteDb, atIso: string, variantIds: readonly string[]): Promise<LoadedSaleContext> {
  const channelId = await requireStoreChannelId(db)
  const ids = [...new Set(variantIds)]
  const prices = (await db.select().from(s.price).where(inArray(s.price.variantId, ids)).all()).map((p) => ({ variantId: p.variantId, channelId: p.channelId, priceSatang: p.priceSatang, effectiveFrom: p.effectiveFrom }))
  const recipeRows = await db.select().from(s.recipe).where(and(inArray(s.recipe.variantId, ids), eq(s.recipe.isCurrent, true))).all()
  const lineRows = recipeRows.length === 0 ? [] : await db.select().from(s.recipeLine).where(inArray(s.recipeLine.recipeId, recipeRows.map((r) => r.id))).all()
  const recipes: SaleRecipe[] = recipeRows.map((r) => ({
    recipeId: r.id,
    variantId: r.variantId,
    sweetnessId: r.sweetnessId,
    lines: lineRows.filter((l) => l.recipeId === r.id).map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli })),
  }))
  const catalog = await loadCatalogSqlite(db)
  const states = await loadCostStates(db)
  const nameRows = await db
    .select({ variantId: s.productVariant.id, productName: s.product.nameTh, sizeName: s.size.name })
    .from(s.productVariant)
    .innerJoin(s.product, eq(s.productVariant.productId, s.product.id))
    .innerJoin(s.size, eq(s.productVariant.sizeId, s.size.id))
    .where(inArray(s.productVariant.id, ids))
    .all()
  const sweetRows = await db.select().from(s.sweetnessLevel).all()
  return {
    sale: { channelId, atIso, prices, recipes, catalog, costOf: makeCostOf(catalog, states), vat: VAT_OFF },
    catalog,
    variantNames: new Map(nameRows.map((r) => [r.variantId, { productName: r.productName, sizeName: r.sizeName }])),
    sweetnessNames: new Map(sweetRows.map((r) => [r.id, r.name])),
  }
}

export type MovementMeta = { businessDate: string; deviceId: string; createdBy: string; at: string }

/** Writes movements, keeps the item_cost_state cache in step (spec §4.4), and queues each movement for sync. */
export async function insertMovements(db: RemoteDb, deps: ApiDeps, drafts: readonly MovementDraft[], meta: MovementMeta, catalog: Catalog): Promise<string[]> {
  const states = await loadCostStates(db)
  const ids: string[] = []
  for (const d of drafts) {
    const row = {
      id: deps.newId(),
      itemId: d.itemId,
      kind: d.kind,
      qtyMilli: d.qtyMilli,
      unitCostUsat: d.unitCostUsat,
      refType: d.refType,
      refId: d.refId,
      businessDate: meta.businessDate,
      deviceId: meta.deviceId,
      createdBy: meta.createdBy,
      createdAt: meta.at,
    } satisfies typeof s.stockMovement.$inferInsert
    await db.insert(s.stockMovement).values(row)
    await enqueueOutbox(db, 'stock_movement', row, meta.at, deps.newId)
    const next = applyMovement(states.get(d.itemId) ?? initialCostState(requireItem(catalog, d.itemId).standardCostUsat), d)
    states.set(d.itemId, next)
    const cache = { onHandMilli: next.onHandMilli, avgCostUsat: next.avgCostUsat, asOfMovementId: row.id, updatedAt: meta.at }
    await db.insert(s.itemCostState).values({ itemId: d.itemId, ...cache }).onConflictDoUpdate({ target: s.itemCostState.itemId, set: cache })
    ids.push(row.id)
  }
  return ids
}
