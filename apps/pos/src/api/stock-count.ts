import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { loadCatalogSqlite, type RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { countAdjustmentMovements, countLineResult, requireItem, type Catalog, type CountLineResult } from '@dayo/domain'
import { enqueueOutbox } from '../db/outbox'
import { insertMovements, loadCostStates, makeCostOf } from '../db/stock'
import { requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { requireActiveUser } from './shift'
import { assertUnitsMilli, badInputOnRange, qtyPerUnitMilli, requireStockItem, stockBusinessDate, stockCountableItems } from './stock-common'
import { openCountId, openingCountPending } from './stock-overview'
import type { CloseStockCountInput, RemoveCountLineInput, SaveCountLineInput, StockCountDto, StockCountLineDto } from './types'

/** Counting 0 of something is allowed (it ran out) — unlike a purchase or an adjustment. */
function assertCountedUnitsMilli(unitsMilli: number): void {
  if (unitsMilli === 0) return
  assertUnitsMilli(unitsMilli, 'countedUnitsMilli')
}

/**
 * Items that were in a count closed before `countId` (insert order, never the device clock) — any other item is being
 * counted for the first time, and its movement is its opening balance (D30 · Q4-13).
 */
async function countedBefore(db: RemoteDb, itemIds: readonly string[], countId: string): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set()
  const rows = await db
    .selectDistinct({ itemId: s.stockCountLine.itemId })
    .from(s.stockCountLine)
    .innerJoin(s.stockCount, eq(s.stockCount.id, s.stockCountLine.countId))
    .where(
      and(
        eq(s.stockCount.status, 'closed'),
        inArray(s.stockCountLine.itemId, [...itemIds]),
        sql`${s.stockCount}.rowid < (select c.rowid from stock_count c where c.id = ${countId})`,
      ),
    )
    .all()
  return new Set(rows.map((r) => r.itemId))
}

async function requireOpenCount(db: RemoteDb, countId: string, deviceId: string): Promise<typeof s.stockCount.$inferSelect> {
  const row = await db.select().from(s.stockCount).where(eq(s.stockCount.id, countId)).get()
  if (!row || row.status !== 'open' || row.deviceId !== deviceId) throw new PosError('STOCK_COUNT_NOT_OPEN', countId)
  return row
}

/**
 * One counted line (spec §4.5) at the moving average. A first count's gain is the opening balance at the standard cost
 * (D30); a first-count loss leaves at the average, like any stock-out (review I-5).
 */
function countLine(
  catalog: Catalog,
  costOf: (id: string) => number,
  i: { itemId: string; expectedUseMilli: number; countedUnitsMilli: number; qtyPerUnitMilli: number },
  opening: boolean,
): CountLineResult {
  const atAverage = badInputOnRange(() => countLineResult({ ...i, avgCostUsat: costOf(i.itemId) }))
  if (!opening || atAverage.varianceUseMilli <= 0) return atAverage
  return badInputOnRange(() => countLineResult({ ...i, avgCostUsat: requireItem(catalog, i.itemId).standardCostUsat }))
}

export async function loadStockCount(db: RemoteDb, countId: string): Promise<StockCountDto> {
  const count = await db.select().from(s.stockCount).where(eq(s.stockCount.id, countId)).get()
  if (!count) throw new PosError('STOCK_COUNT_NOT_OPEN', countId)
  const rows = await db
    .select({ line: s.stockCountLine, code: s.item.code, name: s.item.name, useUnit: s.item.useUnit, unitName: s.purchaseUnit.name })
    .from(s.stockCountLine)
    .innerJoin(s.item, eq(s.item.id, s.stockCountLine.itemId))
    .leftJoin(s.purchaseUnit, eq(s.purchaseUnit.id, s.stockCountLine.purchaseUnitId))
    .where(eq(s.stockCountLine.countId, countId))
    .orderBy(asc(s.item.code))
    .all()
  const before = await countedBefore(db, rows.map((r) => r.line.itemId), countId)
  const lines: StockCountLineDto[] = rows.map((r) => ({
    itemId: r.line.itemId,
    code: r.code,
    name: r.name,
    useUnit: r.useUnit,
    purchaseUnitId: r.line.purchaseUnitId,
    unitName: r.unitName ?? r.useUnit,
    countedUnitsMilli: r.line.countedUnitsMilli,
    countedUseMilli: r.line.countedUseMilli,
    expectedUseMilli: r.line.expectedUseMilli,
    varianceUseMilli: r.line.varianceUseMilli,
    varianceSatang: r.line.varianceSatang,
    opening: !before.has(r.line.itemId),
  }))
  return {
    id: count.id,
    businessDate: count.businessDate,
    status: count.status,
    createdBy: count.createdBy,
    createdAt: count.createdAt,
    closedAt: count.closedAt,
    lines,
    totalVarianceSatang: lines.reduce((a, l) => a + l.varianceSatang, 0),
  }
}

/** นับสต็อก (spec §4.5, §5): opens a count — or returns this device's open one, so a reload resumes it. */
export async function startStockCount(db: RemoteDb, deps: ApiDeps, actorUserId: string): Promise<StockCountDto> {
  const actor = await requireActiveUser(db, actorUserId)
  const device = await requireDevice(db)
  const id = await db.transaction(async (tx) => {
    const open = await openCountId(tx, device.id)
    if (open !== null) return open
    const at = deps.now()
    const row = {
      id: deps.newId(),
      businessDate: await stockBusinessDate(tx, device.id, at),
      status: 'open',
      deviceId: device.id,
      createdBy: actor.id,
      createdAt: at,
      closedBy: null,
      closedAt: null,
    } satisfies typeof s.stockCount.$inferInsert
    await tx.insert(s.stockCount).values(row)
    await enqueueOutbox(tx, 'stock_count', row, at, deps.newId)
    return row.id
  })
  return loadStockCount(db, id)
}

export async function getOpenStockCount(db: RemoteDb): Promise<StockCountDto | null> {
  const device = await requireDevice(db)
  const id = await openCountId(db, device.id)
  return id === null ? null : loadStockCount(db, id)
}

/**
 * Saves one counted line of the open count. expected = the book on-hand at the moment the item is FIRST saved — frozen
 * per line (spec §3.3 "ณ เวลานับ", T4-2), so sales between counting it and closing the count are not double-counted.
 * "นับใหม่" (saving the same item again) only replaces the counted quantity: the expected stays as first frozen, so a
 * typo fixed an hour later does not swallow what sold in that hour (review I-9). Draft lines are not synced until the
 * count closes (T4-11).
 *
 * Controller ruling (Task 7): looked up with `{ allowInactiveWithStock: true }` — an item turned off while it still
 * holds stock (on-hand ≠ 0) must still be countable (down to zero), the same escape hatch Task 3/6 already use; an
 * inactive item already at 0 stays refused.
 */
export async function saveCountLine(db: RemoteDb, deps: ApiDeps, input: SaveCountLineInput): Promise<StockCountDto> {
  await requireActiveUser(db, input.actorUserId)
  assertCountedUnitsMilli(input.countedUnitsMilli)
  const device = await requireDevice(db)
  await db.transaction(async (tx) => {
    await requireOpenCount(tx, input.countId, device.id)
    const item = await requireStockItem(tx, input.itemId, ['raw', 'prepared'], { allowInactiveWithStock: true })
    const perUnit = await qtyPerUnitMilli(tx, item.id, input.purchaseUnitId)
    const catalog = await loadCatalogSqlite(tx)
    const states = await loadCostStates(tx)
    const existing = await tx.select().from(s.stockCountLine).where(and(eq(s.stockCountLine.countId, input.countId), eq(s.stockCountLine.itemId, item.id))).get()
    const opening = !(await countedBefore(tx, [item.id], input.countId)).has(item.id)
    const r = countLine(
      catalog,
      makeCostOf(catalog, states),
      { itemId: item.id, expectedUseMilli: existing?.expectedUseMilli ?? states.get(item.id)?.onHandMilli ?? 0, countedUnitsMilli: input.countedUnitsMilli, qtyPerUnitMilli: perUnit },
      opening,
    )
    const values = {
      purchaseUnitId: input.purchaseUnitId,
      countedUnitsMilli: r.countedUnitsMilli,
      countedUseMilli: r.countedUseMilli,
      expectedUseMilli: r.expectedUseMilli,
      varianceUseMilli: r.varianceUseMilli,
      varianceSatang: r.varianceSatang,
    }
    await tx
      .insert(s.stockCountLine)
      .values({ id: deps.newId(), countId: input.countId, itemId: item.id, ...values })
      .onConflictDoUpdate({ target: [s.stockCountLine.countId, s.stockCountLine.itemId], set: values })
  })
  return loadStockCount(db, input.countId)
}

/** Takes a draft line out of the open count ("ไม่นับรายการนี้"). Never synced, so nothing to undo on the server (T4-11). */
export async function removeCountLine(db: RemoteDb, input: RemoveCountLineInput): Promise<StockCountDto> {
  await requireActiveUser(db, input.actorUserId)
  const device = await requireDevice(db)
  await db.transaction(async (tx) => {
    await requireOpenCount(tx, input.countId, device.id)
    await tx.delete(s.stockCountLine).where(and(eq(s.stockCountLine.countId, input.countId), eq(s.stockCountLine.itemId, input.itemId)))
  })
  return loadStockCount(db, input.countId)
}

/**
 * ปิดใบนับ (spec §4.5): per line, counted − expected (frozen when counted) becomes COUNT_ADJ at the moving average —
 * or OPENING for an item's first count ever (D30) — then the count is closed, and every line, the closed count and the
 * movements are queued for sync, in one transaction. Until the shop's opening count has closed, a count with lines
 * must cover every countable item (Q4-13) — OPENING_COUNT_INCOMPLETE lists what is missing. A count closed with no lines
 * just ends it.
 *
 * Controller ruling (Task 7): the completeness list is `stockCountableItems` (Task 3 controller ruling I-2) — active
 * tracked raw/prepared items plus inactive ones still holding stock (on-hand ≠ 0) — not a plain `isActive = true`
 * query, so a count cannot close as the opening count while an inactive item with stock has never been counted, and
 * an inactive item already at 0 is never required.
 */
export async function closeStockCount(db: RemoteDb, deps: ApiDeps, input: CloseStockCountInput): Promise<StockCountDto> {
  const actor = await requireActiveUser(db, input.actorUserId)
  const device = await requireDevice(db)
  await db.transaction(async (tx) => {
    const count = await requireOpenCount(tx, input.countId, device.id)
    const at = deps.now()
    const lines = await tx.select().from(s.stockCountLine).where(eq(s.stockCountLine.countId, count.id)).orderBy(asc(sql`rowid`)).all()
    const states = await loadCostStates(tx)
    if (lines.length > 0 && (await openingCountPending(tx))) {
      const tracked = await stockCountableItems(tx, states)
      const missing = tracked.filter((i) => !lines.some((l) => l.itemId === i.id)).map((i) => i.code)
      if (missing.length > 0) throw new PosError('OPENING_COUNT_INCOMPLETE', missing.join(','))
    }
    const catalog = await loadCatalogSqlite(tx)
    const costOf = makeCostOf(catalog, states)
    const before = await countedBefore(tx, lines.map((l) => l.itemId), count.id)
    const opening = new Set(lines.map((l) => l.itemId).filter((id) => !before.has(id)))
    const results: CountLineResult[] = []
    for (const l of lines) {
      const perUnit = await qtyPerUnitMilli(tx, l.itemId, l.purchaseUnitId)
      // expected stays as frozen when the line was counted (T4-2); the cost is taken now, when the movement is written
      const r = countLine(catalog, costOf, { itemId: l.itemId, expectedUseMilli: l.expectedUseMilli, countedUnitsMilli: l.countedUnitsMilli, qtyPerUnitMilli: perUnit }, opening.has(l.itemId))
      results.push(r)
      const final = { ...l, countedUseMilli: r.countedUseMilli, varianceUseMilli: r.varianceUseMilli, varianceSatang: r.varianceSatang }
      await tx.update(s.stockCountLine).set({ countedUseMilli: final.countedUseMilli, varianceUseMilli: final.varianceUseMilli, varianceSatang: final.varianceSatang }).where(eq(s.stockCountLine.id, l.id))
      await enqueueOutbox(tx, 'stock_count_line', final, at, deps.newId)
    }
    await insertMovements(tx, deps, countAdjustmentMovements(results, count.id, opening), { businessDate: count.businessDate, deviceId: device.id, createdBy: actor.id, at }, catalog)
    await tx.update(s.stockCount).set({ status: 'closed', closedBy: actor.id, closedAt: at }).where(eq(s.stockCount.id, count.id))
    // the status change travels as its own outbox row, like shift:<id>:closed (T3b-4)
    await enqueueOutbox(tx, 'stock_count', { ...count, status: 'closed', closedBy: actor.id, closedAt: at }, at, deps.newId, 'closed')
  })
  return loadStockCount(db, input.countId)
}
