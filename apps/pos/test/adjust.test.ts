import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import type { AdjustStockInput } from '../src/api/types'
import { openReadyApi, type ReadyApi } from './helpers/db'
import { defaultUnitId, itemId, movementsOf, outboxKeys, stockOf } from './helpers/stock'

async function drink(t: ReadyApi, sku: string, sweetness = 'S050'): Promise<AdjustStockInput['drinks'][number]> {
  const variant = await t.db.select().from(s.productVariant).where(eq(s.productVariant.sku, sku)).get()
  const sweet = await t.db.select().from(s.sweetnessLevel).where(eq(s.sweetnessLevel.code, sweetness)).get()
  return { variantId: variant!.id, sweetnessId: sweet!.id, qty: 1 }
}

describe('adjustStock (spec §5 ปรับสต็อก · D50 Q3-20 · Q4-8)', () => {
  it('a spilled box of fresh milk (WASTE) in its purchase unit, with the reason in a stock_adjustment header', async () => {
    const t = await openReadyApi()
    const milk = await itemId(t, 'RM-MLK-01')
    const a = await t.api.adjustStock({ actorUserId: t.owner.id, reasonCode: 'WASTE', reason: '  กล่องนมหกทั้งกล่อง ', items: [{ itemId: milk, purchaseUnitId: await defaultUnitId(t, 'RM-MLK-01'), qtyUnitsMilli: 1_000 }], drinks: [] })
    expect(a).toMatchObject({ businessDate: '2026-09-17', reasonCode: 'WASTE', reason: 'กล่องนมหกทั้งกล่อง', movements: [{ itemId: milk, code: 'RM-MLK-01', kind: 'WASTE', qtyMilli: -1_000_000 }] })
    expect(await movementsOf(t, 'stock_adjustment', a.id)).toEqual([{ code: 'RM-MLK-01', kind: 'WASTE', qtyMilli: -1_000_000, unitCostUsat: 4_800_000, businessDate: '2026-09-17' }])
    const header = await t.db.select().from(s.stockAdjustment).get()
    expect(header).toEqual({
      id: a.id,
      businessDate: '2026-09-17',
      reasonCode: 'WASTE',
      reason: 'กล่องนมหกทั้งกล่อง',
      detailJson: { items: [{ itemId: milk, purchaseUnitId: expect.any(String), qtyUnitsMilli: 1_000, qtyUseMilli: 1_000_000 }], drinks: [] },
      deviceId: t.device.id,
      createdBy: t.owner.id,
      createdAt: '2026-09-17T03:00:00.000Z',
    })
    expect(await outboxKeys(t)).toContain(`stock_adjustment:${a.id}`)
    expect(await stockOf(t, 'RM-MLK-01')).toEqual({ onHandMilli: -1_000_000, avgCostUsat: 4_800_000 })
  })

  it('a free drink (GIVEAWAY) takes out its whole recipe like a sale — as WASTE movements (D39), no bill (D50 Q3-20)', async () => {
    const t = await openReadyApi()
    const a = await t.api.adjustStock({ actorUserId: t.owner.id, reasonCode: 'GIVEAWAY', reason: 'ชดเชยลูกค้า แก้วหก', items: [], drinks: [await drink(t, 'Original-16oz')] })
    expect((await movementsOf(t, 'stock_adjustment', a.id)).map((m) => [m.code, m.kind, m.qtyMilli])).toEqual([
      ['PB-TEA-THAI', 'WASTE', -130_000],
      ['RM-MLK-02', 'WASTE', -46_000],
      ['RM-MLK-03', 'WASTE', -16_000],
      ['PB-SYRUP', 'WASTE', -16_600],
      ['RM-WTR-01', 'WASTE', -240_000], // untracked ice still costed at its standard cost (spec §4.2)
      ['PK-CUP-01', 'WASTE', -1_000],
      ['PK-LID-01', 'WASTE', -1_000],
      ['PK-STR-01', 'WASTE', -1_000],
      ['PK-LBL-01', 'WASTE', -1_000],
    ])
    const header = await t.db.select().from(s.stockAdjustment).get()
    expect(header!.detailJson).toEqual({ items: [], drinks: [{ variantId: expect.any(String), sweetnessId: expect.any(String), recipeId: expect.any(String), qty: 1 }] })
    expect(await t.db.select().from(s.order).all()).toEqual([]) // not a 0-baht sale
  })

  it('items and drinks together add up per item; TRIAL / EXPIRED keep their own movement kind', async () => {
    const t = await openReadyApi()
    const syrup = await itemId(t, 'PB-SYRUP')
    const a = await t.api.adjustStock({
      actorUserId: t.owner.id,
      reasonCode: 'TRIAL',
      reason: 'ลองสูตรหวานน้อย',
      items: [{ itemId: syrup, purchaseUnitId: null, qtyUnitsMilli: 10_000 }],
      drinks: [{ ...(await drink(t, 'Original-16oz')), qty: 2 }],
    })
    expect(a.movements.find((m) => m.code === 'PB-SYRUP')).toEqual({ itemId: syrup, code: 'PB-SYRUP', kind: 'TRIAL', qtyMilli: -(10_000 + 2 * 16_600) })
    const e = await t.api.adjustStock({ actorUserId: t.owner.id, reasonCode: 'EXPIRED', reason: 'นมเปรี้ยว', items: [{ itemId: await itemId(t, 'RM-MLK-01'), purchaseUnitId: null, qtyUnitsMilli: 200_000 }], drinks: [] })
    expect(e.movements.map((m) => m.kind)).toEqual(['EXPIRED'])
  })

  it('refuses no reason, an unknown code, nothing to take out, untracked items, bad quantities, a drink without recipe — writing nothing', async () => {
    const t = await openReadyApi()
    const milk = { itemId: await itemId(t, 'RM-MLK-01'), purchaseUnitId: null, qtyUnitsMilli: 1_000 }
    const ok: AdjustStockInput = { actorUserId: t.owner.id, reasonCode: 'WASTE', reason: 'หก', items: [milk], drinks: [] }
    const original = await drink(t, 'Original-16oz')
    for (const bad of [
      { ...ok, reason: '   ' },
      { ...ok, reason: '​​' }, // zero-width only (review M-6)
      { ...ok, reason: null as unknown as string }, // not text
      { ...ok, reason: 'ก'.repeat(201) },
      { ...ok, reasonCode: 'SALE' as AdjustStockInput['reasonCode'] },
      { ...ok, items: [] },
      { ...ok, items: [{ ...milk, itemId: await itemId(t, 'RM-WTR-01') }] },
      { ...ok, items: [{ ...milk, qtyUnitsMilli: 0 }] },
      { ...ok, items: [{ ...milk, qtyUnitsMilli: -1_000 }] },
      { ...ok, items: [], drinks: [{ ...original, qty: 0 }] },
      { ...ok, actorUserId: 'nobody' },
    ]) {
      await expect(t.api.adjustStock(bad)).rejects.toThrow(/^BAD_INPUT: /)
    }
    await expect(t.api.adjustStock({ ...ok, items: [], drinks: [{ ...original, sweetnessId: 'no-such-level' }] })).rejects.toThrow(/^NO_RECIPE: /)
    t.raw.prepare('update product_variant set is_active = 0 where id = ?').run(original.variantId) // taken off the menu (review M-11)
    await expect(t.api.adjustStock({ ...ok, items: [], drinks: [original] })).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.stockAdjustment).all()).toEqual([])
    expect(await t.db.select().from(s.stockMovement).all()).toEqual([])
  })

  it('an inactive raw item that still holds stock can still be stocked out by item, down to zero (controller ruling, Task 6)', async () => {
    const t = await openReadyApi()
    const milk = await itemId(t, 'RM-MLK-01')
    await t.db.insert(s.itemCostState).values({ itemId: milk, onHandMilli: 100_000, avgCostUsat: 4_800_000, asOfMovementId: null, updatedAt: t.deps.now() })
    t.raw.prepare('update item set is_active = 0 where id = ?').run(milk)
    const a = await t.api.adjustStock({ actorUserId: t.owner.id, reasonCode: 'WASTE', reason: 'นมหมดอายุ เลิกขายแล้ว', items: [{ itemId: milk, purchaseUnitId: null, qtyUnitsMilli: 100_000 }], drinks: [] })
    expect(a.movements).toEqual([{ itemId: milk, code: 'RM-MLK-01', kind: 'WASTE', qtyMilli: -100_000 }])
    expect(await stockOf(t, 'RM-MLK-01')).toMatchObject({ onHandMilli: 0 })
  })

  it('an inactive item already at 0 stays refused (controller ruling, Task 6: nothing left to bring to zero)', async () => {
    const t = await openReadyApi()
    const milk = await itemId(t, 'RM-MLK-01')
    t.raw.prepare('update item set is_active = 0 where id = ?').run(milk) // never had stock: on-hand is still 0
    await expect(t.api.adjustStock({ actorUserId: t.owner.id, reasonCode: 'WASTE', reason: 'หก', items: [{ itemId: milk, purchaseUnitId: null, qtyUnitsMilli: 100_000 }], drinks: [] })).rejects.toThrow(/^BAD_INPUT: /)
  })
})

describe('discardBase (spec §4.6 ปุ่ม "ทิ้ง" · Q4-9)', () => {
  it('an expired base: EXPIRED of the whole on-hand; a fresh leftover: WASTE; nothing on hand: refused', async () => {
    const t = await openReadyApi()
    const shot = await itemId(t, 'PB-MATCHA-SHOT')
    await expect(t.api.discardBase({ actorUserId: t.owner.id, itemId: shot })).rejects.toThrow(/^BAD_INPUT: /)
    await t.api.produceBatch({ actorUserId: t.owner.id, itemId: shot, scaleBp: 10_000, yieldActualMilli: 300_000 })
    const early = await t.api.discardBase({ actorUserId: t.owner.id, itemId: shot })
    expect(early).toMatchObject({ reasonCode: 'WASTE', reason: 'ทิ้งเบสที่เหลือ', movements: [{ code: 'PB-MATCHA-SHOT', kind: 'WASTE', qtyMilli: -300_000 }] })

    await t.api.produceBatch({ actorUserId: t.owner.id, itemId: shot, scaleBp: 10_000, yieldActualMilli: 300_000 })
    t.clock.advanceMs(4 * 3_600_000) // shelf life 4 h
    const late = await t.api.discardBase({ actorUserId: t.owner.id, itemId: shot })
    expect(late).toMatchObject({ reasonCode: 'EXPIRED', reason: 'ทิ้งเบสหมดอายุ', movements: [{ code: 'PB-MATCHA-SHOT', kind: 'EXPIRED', qtyMilli: -300_000 }] })
    expect(await stockOf(t, 'PB-MATCHA-SHOT')).toMatchObject({ onHandMilli: 0 })
    const o = await t.api.stockOverview()
    expect(o.items.find((i) => i.code === 'PB-MATCHA-SHOT')).toMatchObject({ status: 'out', alert: false, latestBatch: { expiry: 'none' } })
    expect(o.expiredBaseCodes).toEqual([])
    await expect(t.api.discardBase({ actorUserId: t.owner.id, itemId: await itemId(t, 'RM-MLK-01') })).rejects.toThrow(/^BAD_INPUT: /) // raw items go through adjustStock
  })

  it('an inactive base that still holds stock can still be discarded, down to zero (controller ruling, Task 6)', async () => {
    const t = await openReadyApi()
    const shot = await itemId(t, 'PB-MATCHA-SHOT')
    await t.api.produceBatch({ actorUserId: t.owner.id, itemId: shot, scaleBp: 10_000, yieldActualMilli: 300_000 })
    t.raw.prepare('update item set is_active = 0 where id = ?').run(shot) // dropped from the menu, leftover base still on hand
    const a = await t.api.discardBase({ actorUserId: t.owner.id, itemId: shot })
    expect(a).toMatchObject({ reasonCode: 'WASTE', reason: 'ทิ้งเบสที่เหลือ', movements: [{ code: 'PB-MATCHA-SHOT', kind: 'WASTE', qtyMilli: -300_000 }] })
    expect(await stockOf(t, 'PB-MATCHA-SHOT')).toMatchObject({ onHandMilli: 0 })
  })
})
