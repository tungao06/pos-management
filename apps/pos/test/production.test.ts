import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { openReadyApi, sellSku, type ReadyApi } from './helpers/db'
import { defaultUnitId, itemId, movementsOf, outboxKeys, stockOf } from './helpers/stock'

/** Receives 1 bag (400 g) of RM-TEA-01 at ฿90 (standard ฿77, a +16.9% price jump) — pushes its avg to 22,500,000 usat. */
async function receiveTeaAt90(t: ReadyApi): Promise<void> {
  const line = { itemId: await itemId(t, 'RM-TEA-01'), purchaseUnitId: await defaultUnitId(t, 'RM-TEA-01'), qtyUnitsMilli: 1_000, lineTotalSatang: 9_000 }
  await t.api.receivePurchase({ actorUserId: t.owner.id, supplier: '', note: '', lines: [line], paidFromDrawer: false, acceptPriceJump: true })
}

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

  it('refuses a raw item, a scale outside 0.1×–5×, a yield outside ½×–2× of the standard, and an unknown user, each with its own message (review I-4 · m-1) — writing nothing', async () => {
    const t = await openReadyApi()
    const base = await itemId(t, 'PB-TEA-THAI')
    const rawId = await itemId(t, 'RM-TEA-01')
    const ok = { actorUserId: t.owner.id, itemId: base, scaleBp: 10_000, yieldActualMilli: 3_000_000 }
    // m-1: a specific message per case — a widened kind guard (mutation M7: kinds ['prepared','raw']) must still fail
    // this one, because a passed kind check would instead throw "RM-TEA-01 has no current BOM", not this message.
    await expect(t.api.produceBatch({ ...ok, itemId: rawId })).rejects.toThrow(new RegExp(`^BAD_INPUT: item ${rawId} is not a tracked prepared item$`))
    await expect(t.api.produceBatch({ ...ok, scaleBp: 999 })).rejects.toThrow(/^BAD_INPUT: scale must be 1000–50000 bp$/)
    await expect(t.api.produceBatch({ ...ok, scaleBp: 50_001 })).rejects.toThrow(/^BAD_INPUT: scale must be 1000–50000 bp$/)
    await expect(t.api.produceBatch({ ...ok, yieldActualMilli: 0 })).rejects.toThrow(/^BAD_INPUT: actual yield must be a whole number of milli > 0$/)
    // below half of 3,000 ml (e.g. 150 typed for 1500 at scale 0.5 is caught too)
    await expect(t.api.produceBatch({ ...ok, yieldActualMilli: 1_499_999 })).rejects.toThrow(/^BAD_INPUT: actual yield 1499999 is outside ½×–2× of the standard 3000000$/)
    await expect(t.api.produceBatch({ ...ok, yieldActualMilli: 6_000_001 })).rejects.toThrow(/^BAD_INPUT: actual yield 6000001 is outside ½×–2× of the standard 3000000$/)
    await expect(t.api.produceBatch({ ...ok, actorUserId: 'nobody' })).rejects.toThrow(/^BAD_INPUT: unknown or inactive user nobody$/)
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

  it('I-1: components are consumed at their current moving average, not the standard cost (review I-1)', async () => {
    const t = await openReadyApi()
    await receiveTeaAt90(t) // RM-TEA-01 avg → 22,500,000 usat (was 19,250,000 standard)
    const base = await itemId(t, 'PB-TEA-THAI')
    const b = await t.api.produceBatch({ actorUserId: t.owner.id, itemId: base, scaleBp: 10_000, yieldActualMilli: 3_000_000 })
    expect(b).toMatchObject({ unitCostUsat: 2_130_000, batchCostSatang: 6_390 })
    expect(await movementsOf(t, 'production_batch', b.id)).toEqual([
      { code: 'RM-TEA-02', kind: 'PRODUCE_OUT', qtyMilli: -180_000, unitCostUsat: 19_125_000, businessDate: '2026-09-17' }, // never purchased: still standard
      { code: 'RM-TEA-01', kind: 'PRODUCE_OUT', qtyMilli: -120_000, unitCostUsat: 22_500_000, businessDate: '2026-09-17' }, // at its new average
      { code: 'RM-WTR-02', kind: 'PRODUCE_OUT', qtyMilli: -3_300_000, unitCostUsat: 75_000, businessDate: '2026-09-17' },
      { code: 'PB-TEA-THAI', kind: 'PRODUCE_IN', qtyMilli: 3_000_000, unitCostUsat: 2_130_000, businessDate: '2026-09-17' },
    ])
  })

  it('m-2: a second batch over the leftover base merges to the weighted average; the latest batch sets the shown expiry (spec §4.6, Q4-9)', async () => {
    const t = await openReadyApi()
    await receiveTeaAt90(t) // RM-TEA-01 avg → 22,500,000 usat
    const base = await itemId(t, 'PB-TEA-THAI')
    const b1 = await t.api.produceBatch({ actorUserId: t.owner.id, itemId: base, scaleBp: 10_000, yieldActualMilli: 3_000_000 })
    expect(b1.unitCostUsat).toBe(2_130_000) // 3,000 ml at 2,130,000 (I-1)
    t.clock.advanceMs(3_600_000) // batch 2 is later — its own expiry, not batch 1's, must be what stockOverview shows
    const b2 = await t.api.produceBatch({ actorUserId: t.owner.id, itemId: base, scaleBp: 5_000, yieldActualMilli: 1_000_000 })
    expect(b2.unitCostUsat).toBe(3_195_000) // half a batch at a lower actual yield, still at the raised RM-TEA-01 cost
    // weighted merge: (3,000,000 × 2,130,000 + 1,000,000 × 3,195,000) / 4,000,000 = 2,396,250
    expect(await stockOf(t, 'PB-TEA-THAI')).toEqual({ onHandMilli: 4_000_000, avgCostUsat: 2_396_250 })
    const o = await t.api.stockOverview()
    expect(o.items.find((i) => i.code === 'PB-TEA-THAI')).toMatchObject({ latestBatch: { batchId: b2.id, expiresAt: b2.expiresAt, expiry: 'fresh' } })
    expect(b2.expiresAt).not.toBe(b1.expiresAt) // the clock moved between the two batches: the badge really did pick the later one
  })

  it('m-3: producing consumes an inactive ingredient without refusing it — only producing an inactive base is blocked (controller ruling m-3, same as a sale)', async () => {
    const t = await openReadyApi()
    const rawId = await itemId(t, 'RM-TEA-01')
    t.raw.prepare('update item set is_active = 0 where id = ?').run(rawId)
    const b = await t.api.produceBatch({ actorUserId: t.owner.id, itemId: await itemId(t, 'PB-TEA-THAI'), scaleBp: 10_000, yieldActualMilli: 3_000_000 })
    expect(b.components).toContainEqual({ itemId: rawId, code: 'RM-TEA-01', qtyMilli: 120_000 })
    expect(await movementsOf(t, 'production_batch', b.id)).toContainEqual({ code: 'RM-TEA-01', kind: 'PRODUCE_OUT', qtyMilli: -120_000, unitCostUsat: 19_250_000, businessDate: '2026-09-17' })
    expect(await stockOf(t, 'RM-TEA-01')).toEqual({ onHandMilli: -120_000, avgCostUsat: 19_250_000 })
  })
})
