import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { openReadyApi, sellSku } from './helpers/db'
import { defaultUnitId, itemId, movementsOf, openingCount, outboxKeys, stockOf } from './helpers/stock'

describe('opening count (D30 · Q4-13)', () => {
  it('the first count must cover every tracked item; gains are OPENING at the standard cost; every line is marked opening', async () => {
    const t = await openReadyApi()
    const tea = await itemId(t, 'RM-TEA-01')
    const milk = await itemId(t, 'RM-MLK-02')
    expect((await t.api.stockOverview()).openingCountPending).toBe(true)
    const c = await t.api.startStockCount(t.owner.id)
    expect(c).toMatchObject({ businessDate: '2026-09-17', status: 'open', createdBy: t.owner.id, lines: [], closedAt: null })
    expect(await t.api.startStockCount(t.other.id)).toMatchObject({ id: c.id }) // one open count per device: resumed, not a second one
    await t.api.saveCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: tea, purchaseUnitId: await defaultUnitId(t, 'RM-TEA-01'), countedUnitsMilli: 2_000 })
    const two = await t.api.saveCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: milk, purchaseUnitId: await defaultUnitId(t, 'RM-MLK-02'), countedUnitsMilli: 1_000 })
    expect(two.lines).toEqual([
      { itemId: milk, code: 'RM-MLK-02', name: expect.any(String), useUnit: 'ml', purchaseUnitId: expect.any(String), unitName: 'กระป๋อง', countedUnitsMilli: 1_000, countedUseMilli: 405_000, expectedUseMilli: 0, varianceUseMilli: 405_000, varianceSatang: 3_000, opening: true },
      { itemId: tea, code: 'RM-TEA-01', name: expect.any(String), useUnit: 'g', purchaseUnitId: expect.any(String), unitName: 'ถุง', countedUnitsMilli: 2_000, countedUseMilli: 800_000, expectedUseMilli: 0, varianceUseMilli: 800_000, varianceSatang: 15_400, opening: true },
    ])
    expect((await outboxKeys(t)).filter((k) => k.startsWith('stock_count_line:'))).toEqual([]) // draft lines are not synced (T4-11)

    // two items is not an opening count: refused, nothing written, still open
    await expect(t.api.closeStockCount({ actorUserId: t.owner.id, countId: c.id })).rejects.toThrow(/^OPENING_COUNT_INCOMPLETE: .*PB-TEA-THAI.*RM-TEA-02/)
    expect(await t.db.select().from(s.stockMovement).where(eq(s.stockMovement.refType, 'stock_count')).all()).toEqual([])
    expect((await t.api.getOpenStockCount())!.id).toBe(c.id)

    for (const i of (await t.api.stockOverview()).items) {
      if (i.itemId !== tea && i.itemId !== milk) await t.api.saveCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: i.itemId, purchaseUnitId: null, countedUnitsMilli: 0 })
    }
    t.clock.advanceMs(60_000)
    const closed = await t.api.closeStockCount({ actorUserId: t.other.id, countId: c.id })
    expect(closed).toMatchObject({ status: 'closed', closedAt: '2026-09-17T03:01:00.000Z', totalVarianceSatang: 18_400 })
    expect(closed.lines).toHaveLength(38)
    expect(closed.lines.every((l) => l.opening)).toBe(true) // zero-variance lines too — for plan 7's variance report
    expect(await movementsOf(t, 'stock_count', c.id)).toEqual([
      { code: 'RM-TEA-01', kind: 'OPENING', qtyMilli: 800_000, unitCostUsat: 19_250_000, businessDate: '2026-09-17' },
      { code: 'RM-MLK-02', kind: 'OPENING', qtyMilli: 405_000, unitCostUsat: 7_407_407, businessDate: '2026-09-17' },
    ])
    expect(await t.db.select().from(s.stockCount).where(eq(s.stockCount.id, c.id)).get()).toMatchObject({ status: 'closed', closedBy: t.other.id })
    const keys = await outboxKeys(t)
    expect(keys).toContain(`stock_count:${c.id}`)
    expect(keys).toContain(`stock_count:${c.id}:closed`)
    expect(keys.filter((k) => k.startsWith('stock_count_line:'))).toHaveLength(38)
    expect(await t.api.getOpenStockCount()).toBeNull()
    expect(await t.api.stockOverview()).toMatchObject({ lastCountAt: '2026-09-17T03:01:00.000Z', countDue: false, openCountId: null, openingCountPending: false })
  })

  it('a first-count loss leaves at the moving average, not the standard cost (review I-5)', async () => {
    const t = await openReadyApi()
    const tea = { itemId: await itemId(t, 'RM-TEA-01'), purchaseUnitId: await defaultUnitId(t, 'RM-TEA-01'), qtyUnitsMilli: 2_000, lineTotalSatang: 20_000 } // ฿100 a bag
    await t.api.receivePurchase({ actorUserId: t.owner.id, supplier: '', note: '', lines: [tea], paidFromDrawer: false, acceptPriceJump: true })
    const c = await openingCount(t, { 'RM-TEA-01': 600_000 }) // 1.5 bags on the shelf
    expect(await movementsOf(t, 'stock_count', c.id)).toEqual([{ code: 'RM-TEA-01', kind: 'OPENING', qtyMilli: -200_000, unitCostUsat: 25_000_000, businessDate: '2026-09-17' }])
    expect(c.lines.find((l) => l.code === 'RM-TEA-01')).toMatchObject({ varianceUseMilli: -200_000, varianceSatang: -5_000, opening: true }) // −฿50, not −฿38.50
  })
})

describe('stock count after the opening (spec §4.5)', () => {
  it('T4-2: a sale between opening the count and counting the item is not taken off twice — the shelf count stands', async () => {
    const t = await openReadyApi()
    await openingCount(t, { 'RM-MLK-02': 405_000 })
    const c = await t.api.startStockCount(t.owner.id)
    await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4_500 }) // evaporated milk −46 ml, after the count opened
    const saved = await t.api.saveCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: await itemId(t, 'RM-MLK-02'), purchaseUnitId: await defaultUnitId(t, 'RM-MLK-02'), countedUnitsMilli: 1_000 })
    expect(saved.lines[0]).toMatchObject({ expectedUseMilli: 359_000, varianceUseMilli: 46_000, opening: false })
    await t.api.closeStockCount({ actorUserId: t.owner.id, countId: c.id })
    expect(await movementsOf(t, 'stock_count', c.id)).toEqual([{ code: 'RM-MLK-02', kind: 'COUNT_ADJ', qtyMilli: 46_000, unitCostUsat: 7_407_407, businessDate: '2026-09-17' }])
    // one can on the shelf = 405 ml (freezing at count open, spec §4.5 as written, would leave 359 ml)
    expect(await stockOf(t, 'RM-MLK-02')).toEqual({ onHandMilli: 405_000, avgCostUsat: 7_407_407 })
  })

  it('T4-2: a sale after the item was counted still comes off (not frozen at close)', async () => {
    const t = await openReadyApi()
    await openingCount(t, { 'RM-MLK-02': 405_000 })
    const c = await t.api.startStockCount(t.owner.id)
    await t.api.saveCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: await itemId(t, 'RM-MLK-02'), purchaseUnitId: null, countedUnitsMilli: 405_000 })
    await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4_500 })
    await t.api.closeStockCount({ actorUserId: t.owner.id, countId: c.id })
    expect((await stockOf(t, 'RM-MLK-02')).onHandMilli).toBe(359_000)
  })

  it('"แก้ตัวเลข" keeps the book figure frozen at the first save; only the counted quantity changes (review I-9)', async () => {
    const t = await openReadyApi()
    await openingCount(t, { 'RM-MLK-02': 405_000 })
    const milk = await itemId(t, 'RM-MLK-02')
    const can = await defaultUnitId(t, 'RM-MLK-02')
    const c = await t.api.startStockCount(t.owner.id)
    const typo = await t.api.saveCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: milk, purchaseUnitId: can, countedUnitsMilli: 4_000 }) // 4 typed for 1
    expect(typo.lines[0]).toMatchObject({ expectedUseMilli: 405_000, varianceUseMilli: 1_215_000 })
    await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4_500 }) // sold before the typo is noticed
    const fixed = await t.api.saveCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: milk, purchaseUnitId: can, countedUnitsMilli: 1_000 })
    expect(fixed.lines[0]).toMatchObject({ countedUseMilli: 405_000, expectedUseMilli: 405_000, varianceUseMilli: 0 })
    await t.api.closeStockCount({ actorUserId: t.owner.id, countId: c.id })
    expect((await stockOf(t, 'RM-MLK-02')).onHandMilli).toBe(359_000) // re-freezing would have left 405 ml and lost the sale
  })

  it('COUNT_ADJ at the moving average; a line can be taken out before closing; 0 is a valid count', async () => {
    const t = await openReadyApi()
    await openingCount(t, { 'RM-TEA-01': 800_000 })
    const c = await t.api.startStockCount(t.owner.id)
    const recount = await t.api.saveCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: await itemId(t, 'RM-TEA-01'), purchaseUnitId: await defaultUnitId(t, 'RM-TEA-01'), countedUnitsMilli: 1_500 })
    expect(recount.lines).toEqual([expect.objectContaining({ code: 'RM-TEA-01', countedUseMilli: 600_000, expectedUseMilli: 800_000, varianceUseMilli: -200_000, varianceSatang: -3_850, opening: false })])
    const withMilk = await t.api.saveCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: await itemId(t, 'RM-MLK-01'), purchaseUnitId: null, countedUnitsMilli: 0 })
    expect(withMilk.lines).toHaveLength(2)
    const removed = await t.api.removeCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: await itemId(t, 'RM-MLK-01') })
    expect(removed.lines.map((l) => l.code)).toEqual(['RM-TEA-01'])
    await t.api.closeStockCount({ actorUserId: t.owner.id, countId: c.id }) // a partial count is fine after the opening
    expect(await movementsOf(t, 'stock_count', c.id)).toEqual([{ code: 'RM-TEA-01', kind: 'COUNT_ADJ', qtyMilli: -200_000, unitCostUsat: 19_250_000, businessDate: '2026-09-17' }])
    expect((await stockOf(t, 'RM-TEA-01')).onHandMilli).toBe(600_000)
  })

  it('closing a count with no lines just ends it — no movement, and it does not count as "counted" (Q4-12)', async () => {
    const t = await openReadyApi()
    const c = await t.api.startStockCount(t.owner.id)
    const closed = await t.api.closeStockCount({ actorUserId: t.owner.id, countId: c.id })
    expect(closed).toMatchObject({ status: 'closed', lines: [], totalVarianceSatang: 0 })
    expect(await t.db.select().from(s.stockMovement).all()).toEqual([])
    expect(await t.api.stockOverview()).toMatchObject({ lastCountAt: null, countDue: true, openingCountPending: true })
  })

  it('refuses a closed count, untracked items, a negative or fractional count, a foreign unit — changing nothing', async () => {
    const t = await openReadyApi()
    const tea = await itemId(t, 'RM-TEA-01')
    const c = await t.api.startStockCount(t.owner.id)
    const line = { actorUserId: t.owner.id, countId: c.id, itemId: tea, purchaseUnitId: null, countedUnitsMilli: 1_000 }
    for (const bad of [
      { ...line, itemId: await itemId(t, 'RM-WTR-01') },
      { ...line, itemId: await itemId(t, 'PK-SET-16') },
      { ...line, countedUnitsMilli: -1 },
      { ...line, countedUnitsMilli: 0.5 },
      { ...line, countedUnitsMilli: 1_000_000_000 },
      { ...line, purchaseUnitId: await defaultUnitId(t, 'RM-MLK-02') },
      { ...line, actorUserId: 'nobody' },
    ]) {
      await expect(t.api.saveCountLine(bad)).rejects.toThrow(/^BAD_INPUT: /)
    }
    expect(await t.db.select().from(s.stockCountLine).all()).toEqual([])
    await t.api.closeStockCount({ actorUserId: t.owner.id, countId: c.id })
    await expect(t.api.saveCountLine(line)).rejects.toThrow(/^STOCK_COUNT_NOT_OPEN: /)
    await expect(t.api.removeCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: tea })).rejects.toThrow(/^STOCK_COUNT_NOT_OPEN: /)
    await expect(t.api.closeStockCount({ actorUserId: t.owner.id, countId: c.id })).rejects.toThrow(/^STOCK_COUNT_NOT_OPEN: /)
    await expect(t.api.closeStockCount({ actorUserId: t.owner.id, countId: 'no-such-count' })).rejects.toThrow(/^STOCK_COUNT_NOT_OPEN: /)
  })
})

describe('opening count vs. inactive items (controller ruling, Task 7 — overrides the brief\'s own isActive-only query)', () => {
  it('an inactive item with on-hand stock is on the count-all list and must be counted before the opening count can close', async () => {
    const t = await openReadyApi()
    const milk3 = await itemId(t, 'RM-MLK-03')
    t.raw.prepare('update item set is_active = 0 where id = ?').run(milk3)
    await t.db.insert(s.itemCostState).values({ itemId: milk3, onHandMilli: 500_000, avgCostUsat: 1_000_000, asOfMovementId: null, updatedAt: t.deps.now() })

    // the stock page (same list as count-all, stockCountableItems) still shows it
    const items = (await t.api.stockOverview()).items
    expect(items.some((i) => i.itemId === milk3)).toBe(true)

    const c = await t.api.startStockCount(t.owner.id)
    for (const i of items) {
      if (i.itemId !== milk3) await t.api.saveCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: i.itemId, purchaseUnitId: null, countedUnitsMilli: 0 })
    }
    // every countable item but the inactive-with-stock one: still incomplete
    await expect(t.api.closeStockCount({ actorUserId: t.owner.id, countId: c.id })).rejects.toThrow(/^OPENING_COUNT_INCOMPLETE: .*RM-MLK-03/)

    // an inactive item is still reachable to count out, down to zero (allowInactiveWithStock)
    await t.api.saveCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: milk3, purchaseUnitId: null, countedUnitsMilli: 0 })
    const closed = await t.api.closeStockCount({ actorUserId: t.owner.id, countId: c.id })
    expect(closed.status).toBe('closed')
  })

  it('an inactive item already at zero on-hand is off the count-all list and never required to close', async () => {
    const t = await openReadyApi()
    const milk3 = await itemId(t, 'RM-MLK-03')
    t.raw.prepare('update item set is_active = 0 where id = ?').run(milk3)
    // no item_cost_state row: on-hand is 0

    const items = (await t.api.stockOverview()).items
    expect(items.some((i) => i.itemId === milk3)).toBe(false)

    const c = await t.api.startStockCount(t.owner.id)
    for (const i of items) await t.api.saveCountLine({ actorUserId: t.owner.id, countId: c.id, itemId: i.itemId, purchaseUnitId: null, countedUnitsMilli: 0 })
    const closed = await t.api.closeStockCount({ actorUserId: t.owner.id, countId: c.id }) // not required — closes clean
    expect(closed.status).toBe('closed')

    // and it cannot be saved directly either: inactive at 0 is refused even with the count-out escape hatch
    await expect(
      t.api.saveCountLine({ actorUserId: t.owner.id, countId: (await t.api.startStockCount(t.owner.id)).id, itemId: milk3, purchaseUnitId: null, countedUnitsMilli: 0 }),
    ).rejects.toThrow(/^BAD_INPUT: /)
  })
})
