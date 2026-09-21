import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { bangkokDate } from '../lib/clock'
import { currentOpenShift } from './bootstrap'
import { PosError } from './errors'
import { REASON_MAX_LENGTH } from './types'

/**
 * Q4-2: "ชุดนับหลัก" — the ~10 high-value raw items counted every week (D20). Plan 5 may move this list to a synced
 * setting; until then it is this constant (an unknown code is simply not shown).
 */
export const KEY_COUNT_ITEM_CODES: readonly string[] = [
  'RM-MAT-01',
  'RM-MAT-02',
  'RM-TEA-01',
  'RM-TEA-02',
  'RM-TEA-03',
  'RM-TEA-04',
  'RM-MLK-01',
  'RM-MLK-02',
  'RM-MLK-03',
  'RM-CRM-01',
]

/**
 * A quantity is at most 999,999.999 of its unit (typo guard, like MAX_CASH_MOVEMENT_SATANG) — room for a whole shelf
 * counted in the use unit (20 kg of sugar = 20,000,000 g-milli, Q4-14).
 */
export const MAX_UNITS_MILLI = 999_999_999
/** A purchase line costs at most ฿100,000 (same guard as a cash movement). */
export const MAX_LINE_SATANG = 10_000_000
/** Lines per purchase / adjustment. */
export const MAX_STOCK_LINES = 50

/**
 * Q4-1: stock work does not need an open shift. Its business_date is the open shift's (so after-midnight work stays on
 * the same day, spec §4.7) or, with no shift open, today's Thai calendar date.
 *
 * m-3 (Task 3 fix round 1, controller ruling): deliberately ignores the 05:00 stale-shift cutoff (`isShiftStale`,
 * Q3b-8 · D52) — a shift left open well into the next day still dates stock work to the shift's own day, exactly
 * like a sale (SellScreen only shows a "close this shift" banner, spec §4.7; it never changes the business date).
 * Stock work and sales must agree on the date, so this stays a plain lookup of the open shift, not a stale-aware one.
 */
export async function stockBusinessDate(db: RemoteDb, deviceId: string, atIso: string): Promise<string> {
  const shift = await currentOpenShift(db, deviceId)
  return shift?.businessDate ?? bangkokDate(atIso)
}

export type StockItemKind = 'raw' | 'prepared'

async function hasNonZeroStock(db: RemoteDb, itemId: string): Promise<boolean> {
  const row = await db.select({ onHandMilli: s.itemCostState.onHandMilli }).from(s.itemCostState).where(eq(s.itemCostState.itemId, itemId)).get()
  return (row?.onHandMilli ?? 0) !== 0
}

/**
 * A tracked item of one of `kinds` (D29: untracked items — ice, water, salt, packaging sets — are never received,
 * counted or adjusted by hand; plan 3 hand-off I-2b M-4).
 *
 * Active by default. Controller ruling I-2 (Task 3 fix round 1): an item turned off while it still holds stock
 * (on-hand ≠ 0) must still be reachable so it can be brought to zero — pass `{ allowInactiveWithStock: true }` for
 * that. Receiving (`receivePurchase`) and producing (`produceBase`) never set this: an inactive item cannot be
 * bought or made, only counted or written off by Tasks 6–7.
 */
export async function requireStockItem(
  db: RemoteDb,
  itemId: string,
  kinds: readonly StockItemKind[],
  opts: { allowInactiveWithStock?: boolean } = {},
): Promise<typeof s.item.$inferSelect> {
  const item = await db.select().from(s.item).where(eq(s.item.id, itemId)).get()
  const kindOk = item !== undefined && item.isTracked && (kinds as readonly string[]).includes(item.kind)
  const activeOk = item !== undefined && (item.isActive || (opts.allowInactiveWithStock === true && (await hasNonZeroStock(db, itemId))))
  if (!item || !kindOk || !activeOk) {
    throw new PosError('BAD_INPUT', `item ${itemId} is not a tracked ${kinds.join('/')} item`)
  }
  return item
}

/**
 * Tracked raw items and bases that belong on the stock page and in a full ("ทั้งหมด") count (Q4-13 · D30 ·
 * controller ruling I-2, Task 3 fix round 1): active items, plus an inactive item whose on-hand is not exactly 0
 * (M-11) — visible because it still holds stock, so it can be counted (and, with `requireStockItem`'s
 * `allowInactiveWithStock`, written off) down to zero. An inactive item already at 0 is gone for good. `states` is
 * the caller's `loadCostStates(db)` map, so this never re-reads it. Shared by `stockOverview` and, from Task 7 on,
 * by the opening-count completeness check and the "ทั้งหมด" count screen — call this instead of re-deriving the
 * filter so the stock page and a full count always agree on which items are in scope.
 */
export async function stockCountableItems(db: RemoteDb, states: ReadonlyMap<string, { onHandMilli: number }>): Promise<(typeof s.item.$inferSelect)[]> {
  const items = await db
    .select()
    .from(s.item)
    .where(and(eq(s.item.isTracked, true), inArray(s.item.kind, ['raw', 'prepared'])))
    .orderBy(asc(s.item.kind), asc(s.item.code))
    .all()
  return items.filter((i) => i.isActive || (states.get(i.id)?.onHandMilli ?? 0) !== 0)
}

/** Use-unit milli in one of `purchaseUnitId` of the item · `null` = the use unit itself (g / ml / ชิ้น) = 1,000. */
export async function qtyPerUnitMilli(db: RemoteDb, itemId: string, purchaseUnitId: string | null): Promise<number> {
  if (purchaseUnitId === null) return 1_000
  const unit = await db.select().from(s.purchaseUnit).where(and(eq(s.purchaseUnit.id, purchaseUnitId), eq(s.purchaseUnit.itemId, itemId))).get()
  if (!unit || unit.qtyPerUnitMilli <= 0) throw new PosError('BAD_INPUT', `unit ${purchaseUnitId} does not belong to item ${itemId}`)
  return unit.qtyPerUnitMilli
}

/** A count/quantity typed by a person: whole milli-units from 1 to MAX_UNITS_MILLI. */
export function assertUnitsMilli(unitsMilli: number, name: string): void {
  if (!Number.isSafeInteger(unitsMilli) || unitsMilli <= 0 || unitsMilli > MAX_UNITS_MILLI) {
    throw new PosError('BAD_INPUT', `${name} must be a whole number of milli-units from 1 to ${MAX_UNITS_MILLI}`)
  }
}

/** Domain rules throw RangeError on bad numbers; on this side of the API that is the user's input → BAD_INPUT. */
export function badInputOnRange<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    if (e instanceof RangeError) throw new PosError('BAD_INPUT', e.message)
    throw e
  }
}

/**
 * Every Unicode format character (`\p{Cf}`) that `trim()` keeps — ZWSP/ZWNJ/ZWJ U+200B–U+200D, WORD JOINER U+2060,
 * LRM/RLM U+200E/U+200F, the BOM U+FEFF, soft hyphen, bidi overrides and the rest of the category — not just the
 * handful the 3b parked minor m-1 first listed (Task 3 fix round 1, review I-1 · m-1): a reason made only of these
 * is empty.
 */
const ZERO_WIDTH = /\p{Cf}/gu

/**
 * Free text typed by a person (a reason, a supplier, a note — plan 4 M-6): must be a string; zero-width characters
 * are dropped and the rest trimmed; at most REASON_MAX_LENGTH (the 3b cap). `required` refuses an empty result.
 * Everything wrong is BAD_INPUT — never a raw TypeError (3b parked minor m-2).
 */
export function cleanText(value: unknown, name: string, required: boolean): string {
  if (typeof value !== 'string') throw new PosError('BAD_INPUT', `${name} must be text`)
  const text = value.replace(ZERO_WIDTH, '').trim()
  if (required && text === '') throw new PosError('BAD_INPUT', `${name} is required`)
  if (text.length > REASON_MAX_LENGTH) throw new PosError('BAD_INPUT', `${name} is at most ${REASON_MAX_LENGTH} characters`)
  return text
}

/**
 * Q4-15: the unit cost (usat) of each item's latest non-free PURCHASE, by insert order — what a new receipt's price
 * is compared with (D47 item 3). Items never bought are absent: the caller falls back to the standard cost.
 */
export async function lastPurchaseCosts(db: RemoteDb): Promise<Map<string, number>> {
  const rows = await db
    .select({ itemId: s.stockMovement.itemId, unitCostUsat: s.stockMovement.unitCostUsat })
    .from(s.stockMovement)
    .where(and(eq(s.stockMovement.kind, 'PURCHASE'), gt(s.stockMovement.unitCostUsat, 0)))
    .orderBy(asc(sql`rowid`))
    .all()
  return new Map(rows.map((r) => [r.itemId, r.unitCostUsat])) // later rows overwrite earlier ones
}
