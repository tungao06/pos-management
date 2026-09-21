import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { EXPIRY_SOON_MINUTES } from '@dayo/domain'
import { openReadyApi, openTestApi, sellSku, TEST_SETUP } from './helpers/db'
import { itemId, stockOf } from './helpers/stock'

describe('stockOverview (spec §5 หน้าสต็อก)', () => {
  it('lists tracked raw items and bases only, at the standard cost before any movement; nothing on hand = out', async () => {
    const t = await openReadyApi()
    const o = await t.api.stockOverview()
    // 35 raw − 4 untracked (D29: RM-WTR-01/02/03, RM-SEA-01) + 7 bases; no packaging sets
    expect(o.items).toHaveLength(38)
    expect(o.items.filter((i) => i.kind === 'prepared')).toHaveLength(7)
    expect(o.items.map((i) => i.code)).not.toContain('RM-WTR-01')
    expect(o.items.map((i) => i.code)).not.toContain('PK-SET-16')
    const tea = o.items.find((i) => i.code === 'RM-TEA-01')!
    expect(tea).toMatchObject({ kind: 'raw', useUnit: 'g', onHandMilli: 0, avgCostUsat: 19_250_000, priceCheckUsat: 19_250_000, valueSatang: 0, reorderPointMilli: 400_000, status: 'out', alert: true, isKeyCount: true, latestBatch: null, bom: null, isActive: true })
    expect(tea.units).toEqual([{ id: expect.any(String), name: 'ถุง', qtyPerUnitMilli: 400_000, isDefault: true }])
    const base = o.items.find((i) => i.code === 'PB-TEA-THAI')!
    // Q4-10: an empty base is "out" but not an alert (bases have no reorder point)
    expect(base).toMatchObject({ kind: 'prepared', status: 'out', alert: false, shelfLifeHours: 72, latestBatch: null, isKeyCount: false })
    expect(base.bom).toEqual({
      yieldMilli: 3_000_000,
      lines: [
        { itemId: expect.any(String), code: 'RM-TEA-02', name: expect.any(String), useUnit: 'g', qtyMilli: 180_000 },
        { itemId: expect.any(String), code: 'RM-TEA-01', name: expect.any(String), useUnit: 'g', qtyMilli: 120_000 },
        { itemId: expect.any(String), code: 'RM-WTR-02', name: expect.any(String), useUnit: 'ml', qtyMilli: 3_300_000 },
      ],
    })
    expect(o).toMatchObject({ businessDate: '2026-09-17', totalValueSatang: 0, alertCount: 31, expiredBaseCodes: [], lastCountAt: null, countDue: true, openCountId: null, openingCountPending: true })
  })

  it('a sale before any base was made turns the base negative — an alert (D28); untracked ice stays off the page (plan 3 I-2b M-4)', async () => {
    const t = await openReadyApi()
    await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4_500 })
    expect((await stockOf(t, 'RM-WTR-01')).onHandMilli).toBe(-240_000) // the cache row exists …
    const o = await t.api.stockOverview()
    expect(o.items.map((i) => i.code)).not.toContain('RM-WTR-01') // … but the page ignores it
    expect(o.items.find((i) => i.code === 'PB-TEA-THAI')).toMatchObject({ onHandMilli: -130_000, status: 'negative', alert: true, valueSatang: 0 })
    expect(o.items.find((i) => i.code === 'PB-SYRUP')).toMatchObject({ onHandMilli: -16_600, status: 'negative', alert: true })
    expect(o.alertCount).toBe(33) // 31 raw items at or below their reorder point + 2 negative bases
  })

  it('an item taken off the list stays on the page while it still has stock (review M-11), marked isActive: false (I-2 · Task 9 fix round 1)', async () => {
    const t = await openReadyApi()
    await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4_500 }) // RM-MLK-03 −16 ml; RM-POW-01 untouched
    t.raw.prepare("update item set is_active = 0 where code in ('RM-MLK-03', 'RM-POW-01')").run()
    const o = await t.api.stockOverview()
    const codes = o.items.map((i) => i.code)
    expect(codes).toContain('RM-MLK-03') // still has (negative) stock to count out
    expect(codes).not.toContain('RM-POW-01') // nothing on hand: gone
    expect(o.items.find((i) => i.code === 'RM-MLK-03')?.isActive).toBe(false) // shown, but not offered by receive/produce
    expect(o.items.find((i) => i.code === 'RM-TEA-01')?.isActive).toBe(true) // an ordinary active item, for contrast
  })

  it('business date (Q4-1): the open shift\'s date, else today in Thailand', async () => {
    const t = await openTestApi()
    await t.api.setupShop(TEST_SETUP)
    t.clock.set('2026-09-17T18:30:00.000Z') // 01:30 on the 18th in Bangkok, no shift open
    expect((await t.api.stockOverview()).businessDate).toBe('2026-09-18')

    const u = await openReadyApi() // shift of 2026-09-17 opened at 10:00
    u.clock.set('2026-09-17T18:30:00.000Z') // after midnight, shift still open (spec §4.7)
    expect((await u.api.stockOverview()).businessDate).toBe('2026-09-17')
  })

  it('business date (m-3, Task 3 fix round 1) still keeps the open shift\'s date once the shift is stale — matches sales, which only warn (spec §4.7)', async () => {
    const t = await openReadyApi() // shift of 2026-09-17
    t.clock.set('2026-09-18T07:00:00.000Z') // 14:00 on the 18th in Bangkok — well past the 05:00 stale cutoff (Q3b-8), shift still open
    expect((await t.api.stockOverview()).businessDate).toBe('2026-09-17')
  })

  it('a base "soon" to expire is not an alert — only negative or already-expired bases alert (Q4-10, m-4)', async () => {
    const t = await openReadyApi()
    const baseId = await itemId(t, 'PB-TEA-THAI')
    const bom = await t.db.select().from(s.bom).where(and(eq(s.bom.itemId, baseId), eq(s.bom.isCurrent, true))).get()
    const now = t.deps.now()
    await t.db.insert(s.productionBatch).values({
      id: t.deps.newId(),
      bomId: bom!.id,
      itemId: baseId,
      businessDate: '2026-09-17',
      scaleBp: 10_000,
      yieldActualMilli: 3_000_000,
      unitCostUsat: 0,
      batchCostSatang: 0,
      expiresAt: new Date(Date.parse(now) + (EXPIRY_SOON_MINUTES / 2) * 60_000).toISOString(), // well within the "soon" window
      deviceId: t.device.id,
      createdBy: t.owner.id,
      createdAt: now,
    })
    await t.db.insert(s.itemCostState).values({ itemId: baseId, onHandMilli: 1_000_000, avgCostUsat: 1_000, asOfMovementId: null, updatedAt: now })
    const item = (await t.api.stockOverview()).items.find((i) => i.code === 'PB-TEA-THAI')!
    expect(item.latestBatch?.expiry).toBe('soon')
    expect(item.status).toBe('ok') // on hand, no reorder point for a base
    expect(item.alert).toBe(false)
  })

  it('countDue at the exact 7-day boundary (Q4-12 · D20, m-4)', async () => {
    const t = await openReadyApi() // "now" (deps.now()) is 2026-09-17T03:00:00.000Z
    const countId = t.deps.newId()
    await t.db.insert(s.stockCount).values({
      id: countId,
      businessDate: '2026-09-10',
      status: 'closed',
      deviceId: t.device.id,
      createdBy: t.owner.id,
      createdAt: '2026-09-10T03:00:00.000Z',
      closedBy: t.owner.id,
      closedAt: '2026-09-10T03:00:00.000Z', // exactly 7 days before "now"
    })
    await t.db.insert(s.stockCountLine).values({
      id: t.deps.newId(),
      countId,
      itemId: await itemId(t, 'RM-TEA-01'),
      purchaseUnitId: null,
      countedUnitsMilli: 0,
      countedUseMilli: 0,
      expectedUseMilli: 0,
      varianceUseMilli: 0,
      varianceSatang: 0,
    })
    expect((await t.api.stockOverview()).countDue).toBe(true) // exactly 7 days since the last count with lines: due
    await t.db.update(s.stockCount).set({ closedAt: '2026-09-10T03:00:00.001Z' }).where(eq(s.stockCount.id, countId))
    expect((await t.api.stockOverview()).countDue).toBe(false) // 1 ms short of 7 days: not due yet
  })
})
