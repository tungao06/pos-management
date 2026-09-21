import { and, eq } from 'drizzle-orm'
import { loadCatalogSqlite, type RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { batchExpiresAt, productionMovements, requireBom, scaleQtyMilli } from '@dayo/domain'
import { enqueueOutbox } from '../db/outbox'
import { insertMovements, loadCostStates, makeCostOf } from '../db/stock'
import { requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { requireActiveUser } from './shift'
import { badInputOnRange, requireStockItem, stockBusinessDate } from './stock-common'
import type { ProduceBatchInput, ProductionBatchDto } from './types'

/** T4-12: a batch is 0.1× to 5× the BOM (10000 bp = 1 batch, spec §3.3 scale_bp). */
export const MIN_SCALE_BP = 1_000
export const MAX_SCALE_BP = 50_000
/**
 * T4-12 (review I-4): the actual yield must be between half and twice the standard yield of the chosen scale — a typo
 * either way (150 for 1500 ml) would set the base's average cost wholesale, because a base is empty (≤ 0) before
 * most batches, and every cup would carry that cost until the next batch.
 */
export const MAX_YIELD_FACTOR = 2

/**
 * ทำเบส (spec §4.4, §4.6, §5 · D17): PRODUCE_OUT of every BOM component at its current cost → batch cost →
 * PRODUCE_IN of the base at batch cost / actual yield (moving average of the base) + production_batch with expires_at
 * = created_at + shelf_life_hours + outbox — one transaction. Domain math only (`productionMovements`).
 *
 * `requireStockItem` is called with no options (controller ruling I-2, Task 3 fix round 1): an inactive base is
 * refused whatever its stock, the same as `receivePurchase` — only count and adjust may reach an inactive item that
 * still holds stock.
 */
export async function produceBatch(db: RemoteDb, deps: ApiDeps, input: ProduceBatchInput): Promise<ProductionBatchDto> {
  const actor = await requireActiveUser(db, input.actorUserId)
  if (!Number.isSafeInteger(input.scaleBp) || input.scaleBp < MIN_SCALE_BP || input.scaleBp > MAX_SCALE_BP) {
    throw new PosError('BAD_INPUT', `scale must be ${MIN_SCALE_BP}–${MAX_SCALE_BP} bp`)
  }
  if (!Number.isSafeInteger(input.yieldActualMilli) || input.yieldActualMilli <= 0) throw new PosError('BAD_INPUT', 'actual yield must be a whole number of milli > 0')
  const device = await requireDevice(db)

  return db.transaction(async (tx) => {
    const item = await requireStockItem(tx, input.itemId, ['prepared'])
    const bomRow = await tx.select().from(s.bom).where(and(eq(s.bom.itemId, item.id), eq(s.bom.isCurrent, true))).get()
    if (!bomRow) throw new PosError('BAD_INPUT', `${item.code} has no current BOM`)
    const catalog = await loadCatalogSqlite(tx)
    const bom = requireBom(catalog, item.id)
    const standardYield = scaleQtyMilli(bom.yieldMilli, input.scaleBp)
    if (input.yieldActualMilli > standardYield * MAX_YIELD_FACTOR || input.yieldActualMilli * MAX_YIELD_FACTOR < standardYield) {
      throw new PosError('BAD_INPUT', `actual yield ${input.yieldActualMilli} is outside ½×–${MAX_YIELD_FACTOR}× of the standard ${standardYield}`)
    }
    const costOf = makeCostOf(catalog, await loadCostStates(tx))
    const batchId = deps.newId()
    const plan = badInputOnRange(() => productionMovements(bom, input.scaleBp, input.yieldActualMilli, costOf, batchId))
    const at = deps.now()
    const businessDate = await stockBusinessDate(tx, device.id, at)
    const row = {
      id: batchId,
      bomId: bomRow.id,
      itemId: item.id,
      businessDate,
      scaleBp: input.scaleBp,
      yieldActualMilli: input.yieldActualMilli,
      unitCostUsat: plan.unitCostUsat,
      batchCostSatang: plan.batchCostSatang,
      expiresAt: batchExpiresAt(at, item.shelfLifeHours),
      deviceId: device.id,
      createdBy: actor.id,
      createdAt: at,
    } satisfies typeof s.productionBatch.$inferInsert
    await tx.insert(s.productionBatch).values(row)
    await enqueueOutbox(tx, 'production_batch', row, at, deps.newId)
    await insertMovements(tx, deps, [...plan.outs, plan.inn], { businessDate, deviceId: device.id, createdBy: actor.id, at }, catalog)
    const codes = new Map((await tx.select({ id: s.item.id, code: s.item.code }).from(s.item).all()).map((i) => [i.id, i.code]))
    return {
      id: batchId,
      itemId: item.id,
      code: item.code,
      name: item.name,
      businessDate,
      scaleBp: input.scaleBp,
      yieldActualMilli: input.yieldActualMilli,
      unitCostUsat: plan.unitCostUsat,
      batchCostSatang: plan.batchCostSatang,
      expiresAt: row.expiresAt,
      createdAt: at,
      components: plan.outs.map((m) => ({ itemId: m.itemId, code: codes.get(m.itemId) ?? m.itemId, qtyMilli: -m.qtyMilli })),
    }
  })
}
