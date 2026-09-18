import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { loadCatalogSqlite, type RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { explodeNeeds, requireItem, verifyChain } from '@dayo/domain'
import type { CommitSaleInput, CommitSaleResult } from '../src/api/types'
import { loadDeviceChain } from '../src/db/events'
import { insertMovements } from '../src/db/stock'
import { openReadyApi, shownTotalSatang, type ReadyApi } from './helpers/db'

async function variantId(db: RemoteDb, sku: string): Promise<string> {
  const row = await db.select().from(s.productVariant).where(eq(s.productVariant.sku, sku)).get()
  if (!row) throw new Error(`no variant ${sku}`)
  return row.id
}

async function sweetnessId(db: RemoteDb, code: string): Promise<string> {
  const row = await db.select().from(s.sweetnessLevel).where(eq(s.sweetnessLevel.code, code)).get()
  if (!row) throw new Error(`no sweetness ${code}`)
  return row.id
}

async function cashSale(t: ReadyApi, sku: string, qty: number, tenderedSatang: number, extra: Partial<CommitSaleInput> = {}): Promise<CommitSaleResult> {
  const input: Omit<CommitSaleInput, 'expectedTotalSatang'> = {
    orderId: t.deps.newId(),
    actorUserId: t.owner.id,
    lines: [{ variantId: await variantId(t.db, sku), sweetnessId: await sweetnessId(t.db, 'S050'), qty }],
    discount: null,
    payment: { method: 'CASH', tenderedSatang },
    ...extra,
  }
  // D50 Q3-27: the total the customer was shown, read from the menu the way the cart does.
  return t.api.commitSale({ ...input, expectedTotalSatang: extra.expectedTotalSatang ?? (await shownTotalSatang(t, input.lines, input.discount)) })
}

function tableCounts(t: ReadyApi): Record<string, number> {
  const out: Record<string, number> = {}
  for (const table of ['order', 'order_line', 'payment', 'discount', 'stock_movement', 'item_cost_state', 'order_event', 'outbox']) {
    out[table] = (t.raw.prepare(`select count(*) as c from "${table}"`).get() as { c: number }).c
  }
  return out
}

describe('commitSale', () => {
  it('cash: A-000001, queue 1, change, line snapshot, SALE movements = recipe needs at average cost, chained events, outbox', async () => {
    const t = await openReadyApi()
    const r = await cashSale(t, 'Original-16oz', 1, 10_000)
    expect(r).toMatchObject({ receiptNo: 'A-000001', queueNo: 1, businessDate: '2026-09-17', totalSatang: 4500, changeSatang: 5500, method: 'CASH' })

    const order = await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get()
    expect(order).toMatchObject({ status: 'paid', origin: 'device', deviceId: t.device.id, shiftId: t.shift.id, subtotalSatang: 4500, discountSatang: 0, totalSatang: 4500, vatSatang: 0, createdByType: 'user', createdById: t.owner.id, paidAt: '2026-09-17T03:00:00.000Z' })

    const lines = await t.db.select().from(s.orderLine).where(eq(s.orderLine.orderId, r.orderId)).all()
    expect(lines).toHaveLength(1)
    const line = lines[0]!
    expect(line).toMatchObject({ lineNo: 1, productName: 'ชาไทยเย็น', sizeName: '16 oz', sweetnessName: '50%', unitPriceSatang: 4500, qty: 1, lineTotalSatang: 4500 })

    // Expected needs and per-cup cost straight from the domain at standard cost (no purchases recorded yet).
    const catalog = await loadCatalogSqlite(t.db)
    const recipe = await t.db.select().from(s.recipe).where(eq(s.recipe.id, line.recipeId!)).get()
    expect(recipe?.isCurrent).toBe(true)
    const recipeLines = await t.db.select().from(s.recipeLine).where(eq(s.recipeLine.recipeId, recipe!.id)).all()
    const needs = explodeNeeds(recipeLines.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli })), 1, catalog)
    const standard = (id: string) => requireItem(catalog, id).standardCostUsat
    // I-2: pinned golden value (verified by the review's probe), not re-derived with the same production functions.
    expect(line.unitCostSatang).toBe(1475)
    expect(order!.costSatang).toBe(line.unitCostSatang)

    const moves = await t.db.select().from(s.stockMovement).where(and(eq(s.stockMovement.refType, 'order'), eq(s.stockMovement.refId, r.orderId))).all()
    expect(moves.every((m) => m.kind === 'SALE' && m.businessDate === '2026-09-17' && m.deviceId === t.device.id)).toBe(true)
    expect(new Map(moves.map((m) => [m.itemId, -m.qtyMilli]))).toEqual(needs)
    for (const m of moves) expect(m.unitCostUsat).toBe(standard(m.itemId))
    const states = await t.db.select().from(s.itemCostState).all()
    for (const [itemId, need] of needs) expect(states.find((x) => x.itemId === itemId)).toMatchObject({ onHandMilli: -need, avgCostUsat: standard(itemId) })

    expect(await t.db.select().from(s.payment).where(eq(s.payment.orderId, r.orderId)).get()).toMatchObject({ method: 'CASH', amountSatang: 4500, tenderedSatang: 10_000, changeSatang: 5500, verifyStatus: 'manual', createdBy: t.owner.id })

    const chain = await loadDeviceChain(t.db, t.device.id)
    expect(chain.map((e) => [e.type, e.seq])).toEqual([['CREATED', 1], ['LINE_ADDED', 2], ['PAID', 3], ['STOCK_DEDUCTED', 4]])
    expect(chain[2]!.payload).toMatchObject({ receiptNo: 'A-000001', queueNo: 1, method: 'CASH', totalSatang: 4500, tenderedSatang: 10_000, changeSatang: 5500 })
    expect(verifyChain(chain)).toEqual({ ok: true })

    const byTable = Object.fromEntries(await t.db.values<[string, number]>(sql`select table_name, count(*) from outbox group by table_name`))
    expect(byTable).toEqual({ shift: 1, order: 1, order_line: 1, payment: 1, stock_movement: needs.size, order_event: 4 })
    expect((await t.api.bootstrap()).pendingSyncItems).toBe(2) // the open shift + this one bill, not 8 + needs.size outbox rows (D50 Q3-26)
  })

  it('PromptPay with a discount: next receipt and queue, discount row + event, no tender', async () => {
    const t = await openReadyApi()
    await cashSale(t, 'Original-16oz', 1, 4500)
    const r = await t.api.commitSale({
      orderId: t.deps.newId(),
      actorUserId: t.other.id,
      lines: [{ variantId: await variantId(t.db, 'Original-16oz'), sweetnessId: await sweetnessId(t.db, 'S050'), qty: 2 }],
      discount: { amountSatang: 500, reason: ' ลูกค้าประจำ ' },
      payment: { method: 'PROMPTPAY' },
      expectedTotalSatang: 8500,
    })
    expect(r).toMatchObject({ receiptNo: 'A-000002', queueNo: 2, totalSatang: 8500, changeSatang: null, method: 'PROMPTPAY' })
    expect(await t.db.select().from(s.discount).where(eq(s.discount.orderId, r.orderId)).get()).toMatchObject({ amountSatang: 500, reason: 'ลูกค้าประจำ', approvedBy: t.other.id })
    expect(await t.db.select().from(s.payment).where(eq(s.payment.orderId, r.orderId)).get()).toMatchObject({ method: 'PROMPTPAY', amountSatang: 8500, tenderedSatang: null, changeSatang: null })
    const chain = await loadDeviceChain(t.db, t.device.id)
    expect(chain.filter((e) => e.orderId === r.orderId).map((e) => e.type)).toEqual(['CREATED', 'LINE_ADDED', 'DISCOUNT_APPLIED', 'PAID', 'STOCK_DEDUCTED'])
    expect(verifyChain(chain)).toEqual({ ok: true })
  })

  it('queue restarts on the next business date while the receipt counter continues', async () => {
    const t = await openReadyApi()
    await cashSale(t, 'Original-16oz', 1, 4500)
    await cashSale(t, 'Original-16oz', 1, 4500)
    // Closing a shift is plan 3b; close it directly in SQL for this test only.
    t.raw.prepare("update shift set status = 'closed', closed_at = ?, closed_by = ? where id = ?").run(t.clock.now(), t.owner.id, t.shift.id)
    t.clock.set('2026-09-18T03:00:00.000Z')
    const shift2 = await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    expect(shift2.businessDate).toBe('2026-09-18')
    const r = await cashSale(t, 'Original-16oz', 1, 4500)
    expect([r.receiptNo, r.queueNo, r.businessDate]).toEqual(['A-000003', 1, '2026-09-18'])
  })

  it('is idempotent on orderId (double tap / retry)', async () => {
    const t = await openReadyApi()
    const input: CommitSaleInput = {
      orderId: 'order-fixed',
      actorUserId: t.owner.id,
      lines: [{ variantId: await variantId(t.db, 'Latte-16oz'), sweetnessId: await sweetnessId(t.db, 'S050'), qty: 1 }],
      discount: null,
      payment: { method: 'CASH', tenderedSatang: 10_000 },
      expectedTotalSatang: 5000,
    }
    const first = await t.api.commitSale(input)
    const counts = tableCounts(t)
    expect(await t.api.commitSale(input)).toEqual(first)
    expect(tableCounts(t)).toEqual(counts)
  })

  it('concurrent sales get consecutive receipt numbers', async () => {
    const t = await openReadyApi()
    const results = await Promise.all([cashSale(t, 'Original-16oz', 1, 4500), cashSale(t, 'Latte-16oz', 1, 5000), cashSale(t, 'Original-16oz', 2, 9000)])
    expect(results.map((r) => r.receiptNo).sort()).toEqual(['A-000001', 'A-000002', 'A-000003'])
    expect(results.map((r) => r.queueNo).sort()).toEqual([1, 2, 3])
  })

  it('failures roll back everything and do not consume a receipt number', async () => {
    const t = await openReadyApi()
    const before = tableCounts(t)
    t.raw.prepare('delete from price where variant_id = ?').run(await variantId(t.db, 'Original-16oz'))
    await expect(cashSale(t, 'Original-16oz', 1, 10_000)).rejects.toThrow(/^NO_PRICE: /)
    await expect(cashSale(t, 'Latte-16oz', 1, 100)).rejects.toThrow(/^TENDER_TOO_LOW: /)
    await expect(cashSale(t, 'Latte-16oz', 1, 10_000, { discount: { amountSatang: 6000, reason: 'x' } })).rejects.toThrow(/^DISCOUNT_TOO_BIG: /)
    await expect(cashSale(t, 'Latte-16oz', 1, 10_000, { discount: { amountSatang: 5000, reason: 'ฟรี' } })).rejects.toThrow(/^DISCOUNT_TOO_BIG: /) // 0-baht bill (D50 Q3-20)
    await expect(cashSale(t, 'Latte-16oz', 1, 10_000, { discount: { amountSatang: 100, reason: '   ' } })).rejects.toThrow(/^BAD_INPUT: /)
    await expect(cashSale(t, 'Latte-16oz', 1, 10_000, { lines: [] })).rejects.toThrow(/^EMPTY_CART: /)
    await expect(cashSale(t, 'Latte-16oz', 1, 10_000, { actorUserId: 'nobody' })).rejects.toThrow(/^BAD_INPUT: /)
    // M-2: a bad qty or a non-finite expectedTotalSatang must fail as BAD_INPUT, not as a raw RangeError / a
    // bogus PRICE_CHANGED (review probe 4: qty 0/1.5 threw a raw RangeError; expectedTotalSatang NaN threw
    // "PRICE_CHANGED: shown NaN, now …", both of which the UI shows as errUnexpected).
    await expect(cashSale(t, 'Latte-16oz', 0, 10_000)).rejects.toThrow(/^BAD_INPUT: /)
    await expect(cashSale(t, 'Latte-16oz', 1.5, 10_000)).rejects.toThrow(/^BAD_INPUT: /)
    await expect(cashSale(t, 'Latte-16oz', 1000, 10_000_000)).rejects.toThrow(/^BAD_INPUT: /)
    await expect(cashSale(t, 'Latte-16oz', 1, 10_000, { expectedTotalSatang: NaN })).rejects.toThrow(/^BAD_INPUT: /)
    expect(tableCounts(t)).toEqual(before)
    const ok = await cashSale(t, 'Latte-16oz', 1, 5000)
    expect([ok.receiptNo, ok.queueNo]).toEqual(['A-000001', 1])
  })

  // I-1: every failure above is thrown before the first insert, so tableCounts staying the same would pass even
  // without a transaction. Force a failure after order/line/discount/payment/movement/item_cost_state/order_event
  // rows are already written, and prove the whole thing rolls back — including the item_cost_state cache — and
  // that the receipt/queue counters are not consumed.
  it('a failure after rows are written rolls back everything, including item_cost_state, and keeps the receipt number', async () => {
    const t = await openReadyApi()
    await cashSale(t, 'Original-16oz', 1, 4500)
    const before = tableCounts(t)
    const ics = t.raw.prepare('select * from item_cost_state order by item_id').all()
    t.raw.exec("CREATE TRIGGER boom BEFORE INSERT ON order_event WHEN new.type = 'STOCK_DEDUCTED' BEGIN SELECT RAISE(ABORT, 'boom'); END;")
    // drizzle-orm's sqlite-proxy wraps the driver error as DrizzleQueryError("Failed query: …") and keeps the
    // original ("boom") on .cause — assert on the cause, not the wrapper's own message.
    const err: unknown = await cashSale(t, 'Original-16oz', 1, 10_000, { discount: { amountSatang: 100, reason: 'r' } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error & { cause?: unknown }).cause).toMatchObject({ message: expect.stringContaining('boom') })
    expect(tableCounts(t)).toEqual(before)
    expect(t.raw.prepare('select * from item_cost_state order by item_id').all()).toEqual(ics)
    t.raw.exec('DROP TRIGGER boom')
    expect((await cashSale(t, 'Original-16oz', 1, 4500)).receiptNo).toBe('A-000002')
  })

  // I-7 / D50 Q3-27: the cart and QR total must be the total recorded — a price that took effect after the cart was
  // priced makes commitSale refuse; the cashier re-checks the new total and confirms with the same orderId.
  it('refuses with PRICE_CHANGED when a price took effect after the cart was priced, and writes nothing (D50 Q3-27)', async () => {
    const t = await openReadyApi()
    const v = await variantId(t.db, 'Original-16oz')
    const menu = await t.api.loadMenu()
    const at = t.clock.now()
    await t.db.insert(s.price).values({ id: 'p-new', variantId: v, channelId: menu.storeChannelId, priceSatang: 4900, effectiveFrom: '2026-09-17T03:30:00.000Z', createdBy: null, createdAt: at, version: 1, updatedAt: at })
    const lines = [{ variantId: v, sweetnessId: await sweetnessId(t.db, 'S050'), qty: 2 }]
    const shown = await shownTotalSatang(t, lines, null)
    expect(shown).toBe(9000) // 2 × 4500, the price in force when the cart was priced
    const input: CommitSaleInput = { orderId: t.deps.newId(), actorUserId: t.owner.id, lines, discount: null, payment: { method: 'PROMPTPAY' }, expectedTotalSatang: shown }
    t.clock.advanceMs(30 * 60_000) // 03:30 — the new price is now in force
    const before = tableCounts(t)
    await expect(t.api.commitSale(input)).rejects.toThrow(/^PRICE_CHANGED: shown 9000, now 9800$/)
    expect(tableCounts(t)).toEqual(before)
    const confirmed = await t.api.commitSale({ ...input, expectedTotalSatang: await shownTotalSatang(t, lines, null) })
    expect(confirmed).toMatchObject({ receiptNo: 'A-000001', queueNo: 1, totalSatang: 9800 })
  })

  it('refuses to sell without an open shift', async () => {
    const t = await openReadyApi()
    t.raw.prepare("update shift set status = 'closed', closed_at = ?, closed_by = ? where id = ?").run(t.clock.now(), t.owner.id, t.shift.id)
    await expect(cashSale(t, 'Original-16oz', 1, 4500)).rejects.toThrow(/^NO_OPEN_SHIFT: /)
  })

  it('bases may go negative and keep their cost (D28)', async () => {
    const t = await openReadyApi()
    await cashSale(t, 'Original-16oz', 1, 4500)
    await cashSale(t, 'Original-16oz', 1, 4500)
    const thai = await t.db.select().from(s.item).where(eq(s.item.code, 'PB-TEA-THAI')).get()
    const state = await t.db.select().from(s.itemCostState).where(eq(s.itemCostState.itemId, thai!.id)).get()
    expect(state!.onHandMilli).toBeLessThan(0)
    expect(state!.avgCostUsat).toBe(thai!.standardCostUsat)
  })

  // I-9: no inbound movement ran above, so avg always equalled standard — this exercises the real moving-average path.
  it('after an inbound at a different cost, the next sale uses the moving average (spec §4.4)', async () => {
    const t = await openReadyApi()
    const thai = (await t.db.select().from(s.item).where(eq(s.item.code, 'PB-TEA-THAI')).get())!
    await t.db.transaction(async (tx) => {
      await insertMovements(
        tx, t.deps,
        [{ itemId: thai.id, kind: 'PRODUCE_IN', qtyMilli: 3_000_000, unitCostUsat: thai.standardCostUsat * 2, refType: 'test', refId: 'batch-1' }],
        { businessDate: t.shift.businessDate, deviceId: t.device.id, createdBy: t.owner.id, at: t.clock.now() },
        await loadCatalogSqlite(tx),
      )
    })
    // I-2: on hand was 0, so applyMovement sets avg = the inbound cost outright.
    const stateAfterInbound = (await t.db.select().from(s.itemCostState).where(eq(s.itemCostState.itemId, thai.id)).get())!
    expect(stateAfterInbound.avgCostUsat).toBe(thai.standardCostUsat * 2)
    const r = await cashSale(t, 'Original-16oz', 1, 4500)
    const m = (await t.db.select().from(s.stockMovement).where(and(eq(s.stockMovement.refId, r.orderId), eq(s.stockMovement.itemId, thai.id))).get())!
    expect(m.unitCostUsat).toBe(thai.standardCostUsat * 2) // on hand was 0 → avg = inbound cost
    const line = (await t.db.select().from(s.orderLine).where(eq(s.orderLine.orderId, r.orderId)).get())!
    // I-2: pinned golden value (1475 + 130 000 milli × 2 000 000 usat / 1e9 = 1475 + 260), not a loose bound.
    expect(line.unitCostSatang).toBe(1735)
  })

  // I-2: a multi-line order, with two lines sharing a variant (different sweetness), to cover "SALE movements
  // aggregated per item across the whole order" and "order cost = Σ line snapshots" at the app level.
  it('a 3-line order aggregates SALE movements per item and sums line costs into the order cost', async () => {
    const t = await openReadyApi()
    const original = await variantId(t.db, 'Original-16oz')
    const latte = await variantId(t.db, 'Latte-16oz')
    const lines = [
      { variantId: original, sweetnessId: await sweetnessId(t.db, 'S050'), qty: 1 },
      { variantId: original, sweetnessId: await sweetnessId(t.db, 'S100'), qty: 3 },
      { variantId: latte, sweetnessId: await sweetnessId(t.db, 'S050'), qty: 2 },
    ]
    const expectedTotalSatang = await shownTotalSatang(t, lines, null)
    const r = await t.api.commitSale({ orderId: t.deps.newId(), actorUserId: t.owner.id, lines, discount: null, payment: { method: 'PROMPTPAY' }, expectedTotalSatang })
    expect(r.totalSatang).toBe(28_000)

    const order = (await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())!
    expect(order.subtotalSatang).toBe(28_000)
    expect(order.totalSatang).toBe(28_000)
    expect(order.costSatang).toBe(8620)

    const orderLines = await t.db.select().from(s.orderLine).where(eq(s.orderLine.orderId, r.orderId)).orderBy(s.orderLine.lineNo).all()
    expect(orderLines.map((l) => l.unitCostSatang)).toEqual([1475, 1497, 1327])
    expect(orderLines.reduce((sum, l) => sum + l.unitCostSatang * l.qty, 0)).toBe(8620)

    const thai = (await t.db.select().from(s.item).where(eq(s.item.code, 'PB-TEA-THAI')).get())!
    const cup = (await t.db.select().from(s.item).where(eq(s.item.code, 'PK-CUP-01')).get())!
    const moves = await t.db.select().from(s.stockMovement).where(and(eq(s.stockMovement.refType, 'order'), eq(s.stockMovement.refId, r.orderId))).all()
    // Lines 1 and 2 share the Original variant across two sweetness levels — exactly one SALE movement per item,
    // not one per line, so no item is duplicated.
    const itemIds = moves.map((m) => m.itemId)
    expect(new Set(itemIds).size).toBe(itemIds.length)
    expect(moves.find((m) => m.itemId === thai.id)?.qtyMilli).toBe(-780_000)
    expect(moves.find((m) => m.itemId === cup.id)?.qtyMilli).toBe(-6_000)
  })

  // I-6: untracked raw items must always cost at standard_cost, never the cached average.
  it('untracked raw items (ice) are always costed at standard cost, not at a cached average (spec §4.2, D29)', async () => {
    const t = await openReadyApi()
    const ice = (await t.db.select().from(s.item).where(eq(s.item.code, 'RM-WTR-01')).get())!
    expect(ice.isTracked).toBe(false)
    await cashSale(t, 'Original-16oz', 1, 4500) // creates item_cost_state for ice
    t.raw.prepare('update item set standard_cost_usat = ? where id = ?').run(ice.standardCostUsat * 3, ice.id)
    const r = await cashSale(t, 'Original-16oz', 1, 4500)
    const m = (await t.db.select().from(s.stockMovement).where(and(eq(s.stockMovement.refId, r.orderId), eq(s.stockMovement.itemId, ice.id))).get())!
    expect(m.unitCostUsat).toBe(ice.standardCostUsat * 3)
  })

  // M6: window is the last 7 calendar days anchored on the open shift's business date (D50 Q3-25)
  it('best sellers rank products by cups sold in the last 7 calendar days, anchored on the open shift (D48 Q3-9, D50 Q3-25)', async () => {
    const t = await openReadyApi()
    await cashSale(t, 'Latte-16oz', 3, 15_000)
    await cashSale(t, 'Original-16oz', 1, 4500)
    const menu = await t.api.loadMenu()
    const code = (id: string) => menu.products.find((p) => p.id === id)!.code
    expect(menu.bestSellerProductIds.map(code)).toEqual(['Latte', 'Original'])
    // Advancing the wall clock alone must not move the window while this shift stays open (M6 anchors on shift.businessDate).
    t.clock.set('2026-09-24T03:00:00.000Z')
    expect((await t.api.loadMenu()).bestSellerProductIds.map(code)).toEqual(['Latte', 'Original'])
    // Closing this shift and opening the next one moves business_date, which moves the window to 18–24 Sep.
    t.raw.prepare("update shift set status = 'closed', closed_at = ?, closed_by = ? where id = ?").run(t.clock.now(), t.owner.id, t.shift.id)
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    expect((await t.api.loadMenu()).bestSellerProductIds).toEqual([])
  })

  // Controller review (Task 8): a voided/non-paid order must never count toward best sellers.
  it('a non-paid (e.g. voided) order does not count toward best sellers', async () => {
    const t = await openReadyApi()
    const r = await cashSale(t, 'Original-16oz', 1, 4500)
    // voidOrder does not exist yet (plan 3b) — mark this order voided directly to exercise loadMenu's status filter.
    t.raw.prepare("update \"order\" set status = 'voided', voided_at = ? where id = ?").run(t.clock.now(), r.orderId)
    const menu = await t.api.loadMenu()
    expect(menu.bestSellerProductIds).toEqual([])
  })

  // Controller review (Task 8): the 7-day window counts back from the open shift's business date and includes
  // day 7 while excluding day 8.
  it('the best-seller window includes day 7 and excludes day 8 counting back from the open shift business date', async () => {
    const t = await openReadyApi()
    // Shift opened on 2026-09-17 (see testClock's default start). Day 7 back is 2026-09-11; day 8 back is 2026-09-10.
    const original = await variantId(t.db, 'Original-16oz')
    const sweetness = await sweetnessId(t.db, 'S050')
    const day7 = {
      id: t.deps.newId(), origin: 'device', deviceId: t.device.id, receiptNo: null, queueNo: null,
      businessDate: '2026-09-11', shiftId: t.shift.id, channelId: (await t.api.loadMenu()).storeChannelId,
      customerId: null, status: 'paid', subtotalSatang: 4500, discountSatang: 0, totalSatang: 4500, vatSatang: 0,
      costSatang: 0, note: null, createdByType: 'user', createdById: t.owner.id, createdAt: t.clock.now(), paidAt: t.clock.now(), readyAt: null, voidedAt: null,
    } satisfies typeof s.order.$inferInsert
    const day8 = { ...day7, id: t.deps.newId(), businessDate: '2026-09-10' } satisfies typeof s.order.$inferInsert
    await t.db.insert(s.order).values(day7)
    await t.db.insert(s.order).values(day8)
    await t.db.insert(s.orderLine).values({
      id: t.deps.newId(), orderId: day7.id, lineNo: 1, variantId: original, sweetnessId: sweetness, recipeId: null,
      productName: 'x', sizeName: 'x', sweetnessName: 'x', unitPriceSatang: 4500, qty: 1, lineTotalSatang: 4500, unitCostSatang: 0,
    })
    await t.db.insert(s.orderLine).values({
      id: t.deps.newId(), orderId: day8.id, lineNo: 1, variantId: original, sweetnessId: sweetness, recipeId: null,
      productName: 'x', sizeName: 'x', sweetnessName: 'x', unitPriceSatang: 4500, qty: 1, lineTotalSatang: 4500, unitCostSatang: 0,
    })
    const menu = await t.api.loadMenu()
    const code = (id: string) => menu.products.find((p) => p.id === id)!.code
    // Only day 7's cup counts; day 8's does not extend the window, so Original still ranks by its single in-window cup.
    expect(menu.bestSellerProductIds.map(code)).toEqual(['Original'])
  })
})
