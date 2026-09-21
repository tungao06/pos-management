import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { AdjustReason } from '@dayo/contracts'
import { loadCatalogSqlite, type RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { adjustMovementKind, expiryState, explodeNeeds, mergeNeeds, stockOutMovements, unitsToUseMilli, type AdjustReasonCode, type Catalog } from '@dayo/domain'
import { enqueueOutbox } from '../db/outbox'
import { insertMovements, loadCostStates, makeCostOf } from '../db/stock'
import { requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { requireActiveUser } from './shift'
import { assertUnitsMilli, badInputOnRange, cleanText, MAX_STOCK_LINES, qtyPerUnitMilli, requireStockItem, stockBusinessDate } from './stock-common'
import type { AdjustStockInput, DiscardBaseInput, StockAdjustmentDto } from './types'

/** Drinks per adjustment line (same cap as a cart line, plan 3). */
export const MAX_ADJUST_DRINKS = 99
/** Reasons written by `discardBase` (spec §4.6) — stored data, shown back on reports. */
export const DISCARD_EXPIRED_REASON = 'ทิ้งเบสหมดอายุ'
export const DISCARD_LEFTOVER_REASON = 'ทิ้งเบสที่เหลือ'

type Detail = {
  items: { itemId: string; purchaseUnitId: string | null; qtyUnitsMilli: number; qtyUseMilli: number }[]
  drinks: { variantId: string; sweetnessId: string; recipeId: string; qty: number }[]
}

/** Writes the stock_adjustment header, its stock-out movements and outbox rows (inside the caller's transaction). */
async function writeAdjustment(
  tx: RemoteDb,
  deps: ApiDeps,
  a: { deviceId: string; actorId: string; reasonCode: AdjustReasonCode; reason: string; needs: ReadonlyMap<string, number>; detail: Detail; catalog: Catalog },
): Promise<StockAdjustmentDto> {
  const at = deps.now()
  const businessDate = await stockBusinessDate(tx, a.deviceId, at)
  const id = deps.newId()
  const costOf = makeCostOf(a.catalog, await loadCostStates(tx))
  const drafts = stockOutMovements(a.needs, adjustMovementKind(a.reasonCode), costOf, { refType: 'stock_adjustment', refId: id })
  if (drafts.length === 0) throw new PosError('BAD_INPUT', 'nothing to take out of stock')
  const row = {
    id,
    businessDate,
    reasonCode: a.reasonCode,
    reason: a.reason,
    detailJson: a.detail,
    deviceId: a.deviceId,
    createdBy: a.actorId,
    createdAt: at,
  } satisfies typeof s.stockAdjustment.$inferInsert
  await tx.insert(s.stockAdjustment).values(row)
  await enqueueOutbox(tx, 'stock_adjustment', row, at, deps.newId)
  await insertMovements(tx, deps, drafts, { businessDate, deviceId: a.deviceId, createdBy: a.actorId, at }, a.catalog)
  const codes = new Map((await tx.select({ id: s.item.id, code: s.item.code }).from(s.item).all()).map((i) => [i.id, i.code]))
  return {
    id,
    businessDate,
    reasonCode: a.reasonCode,
    reason: a.reason,
    movements: drafts.map((d) => ({ itemId: d.itemId, code: codes.get(d.itemId) ?? d.itemId, kind: d.kind, qtyMilli: d.qtyMilli })),
    createdAt: at,
  }
}

/**
 * ปรับสต็อก (spec §5 · D50 Q3-20 · Q4-8): stock-out only (gains come from a count, T4-10), with a reason code and a
 * required reason. Lines are items (tracked raw or bases, in a purchase unit or the use unit) and/or whole drinks
 * exploded through their current recipe like a sale (spec §4.2, untracked ingredients at standard cost). One
 * transaction: stock_adjustment + movements + item_cost_state + outbox.
 *
 * Controller ruling (Task 6): an item line is looked up with `{ allowInactiveWithStock: true }` — an item turned
 * off while it still holds stock (on-hand ≠ 0) can still be stocked out down to zero, the same escape hatch stock
 * counting already uses (Task 3 controller ruling I-2). A drink line still requires the variant and its product to
 * be active on the menu (M-11); a tracked ingredient its recipe explodes to is looked up the same permissive way,
 * so a base or raw item dropped from the catalog after the recipe was written does not block writing off the
 * ingredients it still holds.
 */
export async function adjustStock(db: RemoteDb, deps: ApiDeps, input: AdjustStockInput): Promise<StockAdjustmentDto> {
  const actor = await requireActiveUser(db, input.actorUserId)
  const parsed = AdjustReason.safeParse(input.reasonCode)
  if (!parsed.success) throw new PosError('BAD_INPUT', `unknown reason code ${String(input.reasonCode)}`)
  const reason = cleanText(input.reason, 'reason', true)
  if (input.items.length + input.drinks.length === 0) throw new PosError('BAD_INPUT', 'nothing to take out of stock')
  if (input.items.length > MAX_STOCK_LINES || input.drinks.length > MAX_STOCK_LINES) throw new PosError('BAD_INPUT', `at most ${MAX_STOCK_LINES} lines`)
  for (const i of input.items) assertUnitsMilli(i.qtyUnitsMilli, 'qtyUnitsMilli')
  for (const d of input.drinks) {
    if (!Number.isSafeInteger(d.qty) || d.qty < 1 || d.qty > MAX_ADJUST_DRINKS) throw new PosError('BAD_INPUT', `drinks must be 1–${MAX_ADJUST_DRINKS}`)
  }
  const device = await requireDevice(db)

  return db.transaction(async (tx) => {
    const catalog = await loadCatalogSqlite(tx)
    const needs = new Map<string, number>()
    const detail: Detail = { items: [], drinks: [] }
    for (const i of input.items) {
      const item = await requireStockItem(tx, i.itemId, ['raw', 'prepared'], { allowInactiveWithStock: true })
      const perUnit = await qtyPerUnitMilli(tx, item.id, i.purchaseUnitId)
      const qtyUseMilli = badInputOnRange(() => unitsToUseMilli(i.qtyUnitsMilli, perUnit))
      if (qtyUseMilli <= 0) throw new PosError('BAD_INPUT', `line of ${item.code} rounds to nothing`)
      mergeNeeds(needs, new Map([[item.id, qtyUseMilli]]))
      detail.items.push({ itemId: item.id, purchaseUnitId: i.purchaseUnitId, qtyUnitsMilli: i.qtyUnitsMilli, qtyUseMilli })
    }
    if (input.drinks.length > 0) {
      const recipes = await tx
        .select()
        .from(s.recipe)
        .where(and(inArray(s.recipe.variantId, input.drinks.map((d) => d.variantId)), eq(s.recipe.isCurrent, true)))
        .all()
      // M-11: only drinks still on the menu — an inactive variant or product cannot be given away
      const active = await tx
        .select({ id: s.productVariant.id })
        .from(s.productVariant)
        .innerJoin(s.product, eq(s.product.id, s.productVariant.productId))
        .where(and(inArray(s.productVariant.id, input.drinks.map((d) => d.variantId)), eq(s.productVariant.isActive, true), eq(s.product.isActive, true)))
        .all()
      const checkedIngredients = new Set<string>()
      for (const d of input.drinks) {
        if (!active.some((v) => v.id === d.variantId)) throw new PosError('BAD_INPUT', `drink ${d.variantId} is not on the menu`)
        const recipe = recipes.find((r) => r.variantId === d.variantId && r.sweetnessId === d.sweetnessId)
        if (!recipe) throw new PosError('NO_RECIPE', `${d.variantId}/${d.sweetnessId}`)
        const lines = await tx.select().from(s.recipeLine).where(eq(s.recipeLine.recipeId, recipe.id)).orderBy(asc(sql`rowid`)).all()
        const exploded = badInputOnRange(() => explodeNeeds(lines.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli })), d.qty, catalog))
        // Controller ruling: a tracked ingredient the recipe explodes to goes through the same permissive lookup as
        // a typed item line — an inactive base or raw item still holding stock can still be written off through a
        // recipe. Untracked leaves (ice, water, packaging) are not stock items at all and skip this check, same as
        // `requireStockItem` would refuse them outright by kind.
        for (const itemId of exploded.keys()) {
          if (checkedIngredients.has(itemId)) continue
          checkedIngredients.add(itemId)
          if (catalog.items.get(itemId)?.isTracked === true) await requireStockItem(tx, itemId, ['raw', 'prepared'], { allowInactiveWithStock: true })
        }
        mergeNeeds(needs, exploded)
        detail.drinks.push({ variantId: d.variantId, sweetnessId: d.sweetnessId, recipeId: recipe.id, qty: d.qty })
      }
    }
    return writeAdjustment(tx, deps, { deviceId: device.id, actorId: actor.id, reasonCode: parsed.data, reason, needs, detail, catalog })
  })
}

/**
 * spec §4.6 ปุ่ม "ทิ้ง": takes the whole on-hand stock of a base out — EXPIRED when its latest batch has expired,
 * otherwise WASTE (throwing out leftover base early, Q4-9). No FIFO per batch in phase 1.
 *
 * Controller ruling (Task 6): looked up with `{ allowInactiveWithStock: true }` — a base taken off the menu while
 * it still holds stock can still be discarded down to zero. An inactive base already at 0 stays refused.
 */
export async function discardBase(db: RemoteDb, deps: ApiDeps, input: DiscardBaseInput): Promise<StockAdjustmentDto> {
  const actor = await requireActiveUser(db, input.actorUserId)
  const device = await requireDevice(db)
  return db.transaction(async (tx) => {
    const item = await requireStockItem(tx, input.itemId, ['prepared'], { allowInactiveWithStock: true })
    const state = await tx.select().from(s.itemCostState).where(eq(s.itemCostState.itemId, item.id)).get()
    const onHandMilli = state?.onHandMilli ?? 0
    if (onHandMilli <= 0) throw new PosError('BAD_INPUT', `${item.code} has nothing on hand to discard`)
    const latest = await tx.select().from(s.productionBatch).where(eq(s.productionBatch.itemId, item.id)).orderBy(sql`rowid desc`).limit(1).get()
    const expired = latest !== undefined && expiryState(latest.expiresAt, deps.now(), onHandMilli) === 'expired'
    const catalog = await loadCatalogSqlite(tx)
    return writeAdjustment(tx, deps, {
      deviceId: device.id,
      actorId: actor.id,
      reasonCode: expired ? 'EXPIRED' : 'WASTE',
      reason: expired ? DISCARD_EXPIRED_REASON : DISCARD_LEFTOVER_REASON,
      needs: new Map([[item.id, onHandMilli]]),
      detail: { items: [{ itemId: item.id, purchaseUnitId: null, qtyUnitsMilli: onHandMilli, qtyUseMilli: onHandMilli }], drinks: [] },
      catalog,
    })
  })
}
