import { and, asc, desc, eq, exists, inArray, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { expiryState, stockStatus, stockValueSatang, type ExpiryState } from '@dayo/domain'
import { loadCostStates } from '../db/stock'
import { requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { KEY_COUNT_ITEM_CODES, lastPurchaseCosts, stockBusinessDate, stockCountableItems } from './stock-common'
import type { BaseBatchDto, BomLineDto, PurchaseUnitDto, StockItemDto, StockOverviewDto } from './types'

/** Q4-12 · D20: a count is due when the last one (with at least one line) closed this many days ago, or never. */
export const COUNT_DUE_DAYS = 7

/** The latest production batch of each base, by insert order (rowid) — never by the device clock (3b ruling, §6.3). */
async function latestBatches(db: RemoteDb, itemIds: readonly string[]): Promise<Map<string, typeof s.productionBatch.$inferSelect>> {
  const out = new Map<string, typeof s.productionBatch.$inferSelect>()
  if (itemIds.length === 0) return out
  const rows = await db.select().from(s.productionBatch).where(inArray(s.productionBatch.itemId, [...itemIds])).orderBy(asc(sql`rowid`)).all()
  for (const r of rows) out.set(r.itemId, r) // later rows overwrite earlier ones
  return out
}

/** The open stock count of this device, if any. */
export async function openCountId(db: RemoteDb, deviceId: string): Promise<string | null> {
  const row = await db
    .select({ id: s.stockCount.id })
    .from(s.stockCount)
    .where(and(eq(s.stockCount.deviceId, deviceId), eq(s.stockCount.status, 'open')))
    .orderBy(desc(sql`rowid`))
    .limit(1)
    .get()
  return row?.id ?? null
}

/**
 * Q4-13 · D30: until a count with at least one line has closed, the next count is the shop's opening count — it must
 * cover every tracked item (closeStockCount enforces it) and the count screen offers "ทั้งหมด" only.
 */
export async function openingCountPending(db: RemoteDb): Promise<boolean> {
  return (await lastCountAt(db)) === null
}

async function lastCountAt(db: RemoteDb): Promise<string | null> {
  const row = await db
    .select({ closedAt: s.stockCount.closedAt })
    .from(s.stockCount)
    .where(and(eq(s.stockCount.status, 'closed'), exists(db.select({ one: sql`1` }).from(s.stockCountLine).where(eq(s.stockCountLine.countId, s.stockCount.id)))))
    .orderBy(desc(sql`rowid`))
    .limit(1)
    .get()
  return row?.closedAt ?? null
}

/**
 * หน้าสต็อก (spec §5): on hand · status · value · reorder list · bases and their expiry. Tracked raw items and bases
 * only (D29 — untracked items keep a meaningless item_cost_state row, plan 3 hand-off I-2b M-4). Nothing is written.
 */
export async function stockOverview(db: RemoteDb, deps: ApiDeps): Promise<StockOverviewDto> {
  const device = await requireDevice(db)
  const at = deps.now()
  const states = await loadCostStates(db)
  // M-11 · controller ruling I-2: an item taken off the list (inactive) stays on the page while it still has stock,
  // so it can be counted out — see stockCountableItems in stock-common.ts (also Task 7's "count all" list).
  const items = await stockCountableItems(db, states)
  const lastCosts = await lastPurchaseCosts(db)
  const units = await db.select().from(s.purchaseUnit).orderBy(desc(s.purchaseUnit.isDefault), asc(s.purchaseUnit.name)).all()
  const bases = items.filter((i) => i.kind === 'prepared')
  const batches = await latestBatches(db, bases.map((b) => b.id))
  const boms = bases.length === 0 ? [] : await db.select().from(s.bom).where(and(inArray(s.bom.itemId, bases.map((b) => b.id)), eq(s.bom.isCurrent, true))).all()
  const bomLines = boms.length === 0 ? [] : await db.select().from(s.bomLine).where(inArray(s.bomLine.bomId, boms.map((b) => b.id))).orderBy(asc(sql`rowid`)).all()
  const allItems = new Map((await db.select().from(s.item).all()).map((i) => [i.id, i]))

  const out: StockItemDto[] = items.map((i) => {
    const state = states.get(i.id)
    const onHandMilli = state?.onHandMilli ?? 0
    const avgCostUsat = state?.avgCostUsat ?? i.standardCostUsat // spec §4.4: before any movement avg = standard cost
    const status = stockStatus(onHandMilli, i.reorderPointMilli)
    const kind = i.kind === 'prepared' ? 'prepared' : 'raw'
    let latestBatch: BaseBatchDto | null = null
    let bom: StockItemDto['bom'] = null
    if (kind === 'prepared') {
      const b = batches.get(i.id)
      if (b !== undefined) {
        const expiry: ExpiryState = expiryState(b.expiresAt, at, onHandMilli)
        latestBatch = { batchId: b.id, createdAt: b.createdAt, expiresAt: b.expiresAt, expiry }
      }
      const bomRow = boms.find((x) => x.itemId === i.id)
      if (bomRow !== undefined) {
        const lines: BomLineDto[] = bomLines
          .filter((l) => l.bomId === bomRow.id)
          .map((l) => {
            const c = allItems.get(l.componentItemId)
            return { itemId: l.componentItemId, code: c?.code ?? l.componentItemId, name: c?.name ?? l.componentItemId, useUnit: c?.useUnit ?? 'g', qtyMilli: l.qtyMilli }
          })
        bom = { yieldMilli: bomRow.yieldMilli, lines }
      }
    }
    const expired = latestBatch?.expiry === 'expired'
    const alert = kind === 'raw' ? status !== 'ok' : status === 'negative' || expired
    const itemUnits: PurchaseUnitDto[] = units.filter((u) => u.itemId === i.id).map((u) => ({ id: u.id, name: u.name, qtyPerUnitMilli: u.qtyPerUnitMilli, isDefault: u.isDefault }))
    return {
      itemId: i.id,
      code: i.code,
      name: i.name,
      kind,
      isActive: i.isActive,
      category: i.category,
      useUnit: i.useUnit,
      onHandMilli,
      avgCostUsat,
      priceCheckUsat: lastCosts.get(i.id) ?? i.standardCostUsat,
      valueSatang: stockValueSatang(onHandMilli, avgCostUsat),
      reorderPointMilli: i.reorderPointMilli,
      status,
      alert,
      isKeyCount: KEY_COUNT_ITEM_CODES.includes(i.code),
      units: itemUnits,
      shelfLifeHours: i.shelfLifeHours,
      latestBatch,
      bom,
    }
  })

  const last = await lastCountAt(db)
  return {
    generatedAt: at,
    businessDate: await stockBusinessDate(db, device.id, at),
    items: out,
    totalValueSatang: out.reduce((a, i) => a + i.valueSatang, 0),
    alertCount: out.filter((i) => i.alert).length,
    expiredBaseCodes: out.filter((i) => i.latestBatch?.expiry === 'expired').map((i) => i.code),
    lastCountAt: last,
    countDue: last === null || Date.parse(at) - Date.parse(last) >= COUNT_DUE_DAYS * 86_400_000,
    openCountId: await openCountId(db, device.id),
    openingCountPending: last === null,
  }
}
