import { and, asc, eq } from 'drizzle-orm'
import * as s from '@dayo/db-schema/sqlite'
import type { TestApi } from './db'

/** Seed item id by its code (ids are deterministic seed ids, plan 2). */
export async function itemId(t: TestApi, code: string): Promise<string> {
  const row = await t.db.select({ id: s.item.id }).from(s.item).where(eq(s.item.code, code)).get()
  if (!row) throw new Error(`no item ${code}`)
  return row.id
}

/** The item's default purchase unit id (e.g. RM-TEA-01 "ถุง" = 400 g). */
export async function defaultUnitId(t: TestApi, code: string): Promise<string> {
  const id = await itemId(t, code)
  const row = await t.db.select({ id: s.purchaseUnit.id }).from(s.purchaseUnit).where(and(eq(s.purchaseUnit.itemId, id), eq(s.purchaseUnit.isDefault, true))).get()
  if (!row) throw new Error(`no default unit for ${code}`)
  return row.id
}

/** Book on-hand (item_cost_state cache) and average cost of an item; 0 / null before any movement. */
export async function stockOf(t: TestApi, code: string): Promise<{ onHandMilli: number; avgCostUsat: number | null }> {
  const row = await t.db.select().from(s.itemCostState).where(eq(s.itemCostState.itemId, await itemId(t, code))).get()
  return { onHandMilli: row?.onHandMilli ?? 0, avgCostUsat: row?.avgCostUsat ?? null }
}

/** Movements written for one document (refType/refId), in insert order, with the item code. */
export async function movementsOf(t: TestApi, refType: string, refId: string): Promise<{ code: string; kind: string; qtyMilli: number; unitCostUsat: number; businessDate: string }[]> {
  const rows = await t.db
    .select({ code: s.item.code, kind: s.stockMovement.kind, qtyMilli: s.stockMovement.qtyMilli, unitCostUsat: s.stockMovement.unitCostUsat, businessDate: s.stockMovement.businessDate })
    .from(s.stockMovement)
    .innerJoin(s.item, eq(s.item.id, s.stockMovement.itemId))
    .where(and(eq(s.stockMovement.refType, refType), eq(s.stockMovement.refId, refId)))
    .orderBy(asc(s.stockMovement.id)) // test ids are sequential = insert order
    .all()
  return rows
}

/** Outbox idempotency keys, in insert order. */
export async function outboxKeys(t: TestApi): Promise<string[]> {
  return (await t.db.select({ k: s.outbox.idempotencyKey }).from(s.outbox).all()).map((r) => r.k)
}
