import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { openReadyApi, sellSku } from './helpers/db'
import { itemId, movementsOf, outboxKeys, stockOf } from './helpers/stock'

describe('produceBatch (spec §4.4 ทำเบส · §4.6 · D17)', () => {
  it('one standard batch of Thai tea base: components out at their cost, base in at 0.02 ฿/ml (spec §9: 2,000,000 usat/ml), expires after 72 h', async () => {
    const t = await openReadyApi()
    const base = await itemId(t, 'PB-TEA-THAI')
    const b = await t.api.produceBatch({ actorUserId: t.owner.id, itemId: base, scaleBp: 10_000, yieldActualMilli: 3_000_000 })
    // before any purchase the components are at their standard cost (spec §4.4, D34): the Excel "ต้นทุนเบส" figure
    expect(b).toMatchObject({ code: 'PB-TEA-THAI', businessDate: '2026-09-17', scaleBp: 10_000, yieldActualMilli: 3_000_000, unitCostUsat: 2_000_000, batchCostSatang: 6_000, expiresAt: '2026-09-20T03:00:00.000Z' })
    expect(b.components).toEqual([
      { itemId: expect.any(String), code: 'RM-TEA-02', qtyMilli: 180_000 },
      { itemId: expect.any(String), code: 'RM-TEA-01', qtyMilli: 120_000 },
      { itemId: expect.any(String), code: 'RM-WTR-02', qtyMilli: 3_300_000 },
    ])
    expect(await movementsOf(t, 'production_batch', b.id)).toEqual([
      { code: 'RM-TEA-02', kind: 'PRODUCE_OUT', qtyMilli: -180_000, unitCostUsat: 19_125_000, businessDate: '2026-09-17' },
      { code: 'RM-TEA-01', kind: 'PRODUCE_OUT', qtyMilli: -120_000, unitCostUsat: 19_250_000, businessDate: '2026-09-17' },
      { code: 'RM-WTR-02', kind: 'PRODUCE_OUT', qtyMilli: -3_300_000, unitCostUsat: 75_000, businessDate: '2026-09-17' },
      { code: 'PB-TEA-THAI', kind: 'PRODUCE_IN', qtyMilli: 3_000_000, unitCostUsat: 2_000_000, businessDate: '2026-09-17' },
    ])
    expect(await stockOf(t, 'PB-TEA-THAI')).toEqual({ onHandMilli: 3_000_000, avgCostUsat: 2_000_000 })
    const row = await t.db.select().from(s.productionBatch).get()
    expect(row).toMatchObject({ id: b.id, bomId: expect.any(String), itemId: base, deviceId: t.device.id, createdBy: t.owner.id })
    expect(await outboxKeys(t)).toContain(`production_batch:${b.id}`)

    const o = await t.api.stockOverview()
    expect(o.items.find((i) => i.code === 'PB-TEA-THAI')).toMatchObject({ status: 'ok', alert: false, valueSatang: 6_000, latestBatch: { batchId: b.id, expiresAt: '2026-09-20T03:00:00.000Z', expiry: 'fresh' } })
  })

  it('half a batch with a lower actual yield raises the unit cost; a base sold before it was made resets its average (spec §4.4)', async () => {
    const t = await openReadyApi()
    await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4_500 }) // base −130 ml at standard cost
    const b = await t.api.produceBatch({ actorUserId: t.owner.id, itemId: await itemId(t, 'PB-TEA-THAI'), scaleBp: 5_000, yieldActualMilli: 1_250_000 })
    expect(b.components.map((c) => c.qtyMilli)).toEqual([90_000, 60_000, 1_650_000])
    expect(b.unitCostUsat).toBe(2_400_000) // ฿30 of components / 1,250 ml (instead of 1,500 ml)
    expect(await stockOf(t, 'PB-TEA-THAI')).toEqual({ onHandMilli: 1_120_000, avgCostUsat: 2_400_000 })
  })

  it('the expiry badge: "soon" within 60 minutes, then expired — still sellable, only shown (Q4-10)', async () => {
    const t = await openReadyApi()
    await t.api.produceBatch({ actorUserId: t.owner.id, itemId: await itemId(t, 'PB-MATCHA-SHOT'), scaleBp: 10_000, yieldActualMilli: 300_000 }) // 4 h shelf life
    t.clock.advanceMs(3 * 3_600_000 + 1)
    expect((await t.api.stockOverview()).items.find((i) => i.code === 'PB-MATCHA-SHOT')!.latestBatch!.expiry).toBe('soon')
    t.clock.advanceMs(3_600_000)
    const o = await t.api.stockOverview()
    expect(o.items.find((i) => i.code === 'PB-MATCHA-SHOT')).toMatchObject({ alert: true, latestBatch: { expiry: 'expired' } })
    expect(o.expiredBaseCodes).toEqual(['PB-MATCHA-SHOT'])
  })

  it('refuses a raw item, a scale outside 0.1×–5×, a yield outside ½×–2× of the standard (review I-4) — writing nothing', async () => {
    const t = await openReadyApi()
    const base = await itemId(t, 'PB-TEA-THAI')
    const ok = { actorUserId: t.owner.id, itemId: base, scaleBp: 10_000, yieldActualMilli: 3_000_000 }
    for (const bad of [
      { ...ok, itemId: await itemId(t, 'RM-TEA-01') },
      { ...ok, scaleBp: 999 },
      { ...ok, scaleBp: 50_001 },
      { ...ok, yieldActualMilli: 0 },
      { ...ok, yieldActualMilli: 1_499_999 }, // below half of 3,000 ml (e.g. 150 typed for 1500 at scale 0.5 is caught too)
      { ...ok, yieldActualMilli: 6_000_001 },
      { ...ok, actorUserId: 'nobody' },
    ]) {
      await expect(t.api.produceBatch(bad)).rejects.toThrow(/^BAD_INPUT: /)
    }
    expect(await t.db.select().from(s.productionBatch).all()).toEqual([])
    await t.api.produceBatch({ ...ok, yieldActualMilli: 6_000_000 }) // exactly twice is still accepted
    await t.api.produceBatch({ ...ok, yieldActualMilli: 1_500_000 }) // exactly half too
  })

  it('refuses producing a base that is inactive but still has stock (controller ruling I-2: only count/adjust may touch it) — writing nothing', async () => {
    const t = await openReadyApi()
    const base = await itemId(t, 'PB-TEA-THAI')
    t.raw.prepare('update item set is_active = 0 where id = ?').run(base)
    await t.db.insert(s.itemCostState).values({ itemId: base, onHandMilli: 500_000, avgCostUsat: 2_000_000, asOfMovementId: null, updatedAt: t.deps.now() })
    await expect(t.api.produceBatch({ actorUserId: t.owner.id, itemId: base, scaleBp: 10_000, yieldActualMilli: 3_000_000 })).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.productionBatch).all()).toEqual([])
  })
})
