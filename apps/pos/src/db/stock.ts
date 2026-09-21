import { and, eq, inArray } from 'drizzle-orm'
import { loadCatalogSqlite, type RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { applyInboundGroup, applyMovement, initialCostState, requireItem, VAT_OFF, type Catalog, type CostOf, type CostState, type MovementDraft, type SaleContext, type SaleRecipe } from '@dayo/domain'
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

/**
 * Writes movements, keeps the item_cost_state cache in step (spec §4.4), and queues each movement for sync.
 * Audit rows stay one per draft with their own unit cost, but a run of positive drafts of one item from one
 * document (same refType + refId, no other draft of that item between them) is folded into the cost state as a
 * single receipt (Q4-17 ก · D57): its average never depends on which line was typed last.
 */
export async function insertMovements(db: RemoteDb, deps: ApiDeps, drafts: readonly MovementDraft[], meta: MovementMeta, catalog: Catalog): Promise<string[]> {
  const states = await loadCostStates(db)
  const ids: string[] = []
  const stateOf = (itemId: string): CostState => states.get(itemId) ?? initialCostState(requireItem(catalog, itemId).standardCostUsat)
  /** Per item: the open inbound run of one document, and the item's last inserted row. */
  const runs = new Map<string, { key: string | null; lines: MovementDraft[]; lastRowId: string }>()
  const flush = (itemId: string): void => {
    const run = runs.get(itemId)
    if (run && run.lines.length > 0) states.set(itemId, applyInboundGroup(stateOf(itemId), run.lines))
    if (run) {
      run.lines = []
      run.key = null
    }
  }
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
    ids.push(row.id)
    const key = d.qtyMilli > 0 ? JSON.stringify([d.refType, d.refId]) : null
    const run = runs.get(d.itemId)
    if (run && key !== null && run.key === key) {
      run.lines.push(d)
      run.lastRowId = row.id
      continue
    }
    flush(d.itemId)
    if (key === null) states.set(d.itemId, applyMovement(stateOf(d.itemId), d))
    runs.set(d.itemId, { key, lines: key === null ? [] : [d], lastRowId: row.id })
  }
  for (const [itemId, run] of runs) {
    flush(itemId)
    const next = stateOf(itemId)
    const cache = { onHandMilli: next.onHandMilli, avgCostUsat: next.avgCostUsat, asOfMovementId: run.lastRowId, updatedAt: meta.at }
    await db.insert(s.itemCostState).values({ itemId, ...cache }).onConflictDoUpdate({ target: s.itemCostState.itemId, set: cache })
  }
  return ids
}
