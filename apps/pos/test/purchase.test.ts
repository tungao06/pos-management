import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import type { ReceivePurchaseInput } from '../src/api/types'
import { openReadyApi, openTestApi, TEST_SETUP, type ReadyApi } from './helpers/db'
import { defaultUnitId, itemId, movementsOf, outboxKeys, stockOf } from './helpers/stock'

async function teaBags(t: ReadyApi, bagsMilli: number, totalSatang: number): Promise<ReceivePurchaseInput['lines'][number]> {
  return { itemId: await itemId(t, 'RM-TEA-01'), purchaseUnitId: await defaultUnitId(t, 'RM-TEA-01'), qtyUnitsMilli: bagsMilli, lineTotalSatang: totalSatang }
}

function input(t: ReadyApi, lines: ReceivePurchaseInput['lines'], patch: Partial<ReceivePurchaseInput> = {}): ReceivePurchaseInput {
  return { actorUserId: t.owner.id, supplier: '  แม็คโคร  ', note: '', lines, paidFromDrawer: false, acceptPriceJump: false, ...patch }
}

describe('receivePurchase (spec §5 รับของเข้า · D19 · §4.4)', () => {
  it('2 bags of Thai tea at ฿154 and 1 can of evaporated milk: purchase + lines + PURCHASE movements + moving average + outbox', async () => {
    const t = await openReadyApi()
    const milk = { itemId: await itemId(t, 'RM-MLK-02'), purchaseUnitId: await defaultUnitId(t, 'RM-MLK-02'), qtyUnitsMilli: 1_000, lineTotalSatang: 3_000 }
    const p = await t.api.receivePurchase(input(t, [await teaBags(t, 2_000, 15_400), milk]))
    expect(p).toMatchObject({ businessDate: '2026-09-17', supplier: 'แม็คโคร', totalSatang: 18_400, cashMovementId: null, createdAt: '2026-09-17T03:00:00.000Z' })
    expect(p.lines).toEqual([
      { itemId: expect.any(String), code: 'RM-TEA-01', name: expect.any(String), qtyUseMilli: 800_000, lineTotalSatang: 15_400, unitCostUsat: 19_250_000 },
      { itemId: expect.any(String), code: 'RM-MLK-02', name: expect.any(String), qtyUseMilli: 405_000, lineTotalSatang: 3_000, unitCostUsat: 7_407_407 },
    ])
    expect(await movementsOf(t, 'purchase', p.id)).toEqual([
      { code: 'RM-TEA-01', kind: 'PURCHASE', qtyMilli: 800_000, unitCostUsat: 19_250_000, businessDate: '2026-09-17' },
      { code: 'RM-MLK-02', kind: 'PURCHASE', qtyMilli: 405_000, unitCostUsat: 7_407_407, businessDate: '2026-09-17' },
    ])
    expect(await stockOf(t, 'RM-TEA-01')).toEqual({ onHandMilli: 800_000, avgCostUsat: 19_250_000 })
    const keys = await outboxKeys(t)
    expect(keys).toContain(`purchase:${p.id}`)
    expect(keys.filter((k) => k.startsWith('purchase_line:'))).toHaveLength(2)
    expect(keys.filter((k) => k.startsWith('stock_movement:'))).toHaveLength(2)
    expect((await t.api.bootstrap()).pendingSyncItems).toBe(2) // the shift + the purchase as one document (T4-8)
    // a second receipt at a price within 10% averages in (spec §4.4): 800 g at 0.1925 + 400 g at 0.2 → 0.195 ฿/g
    await t.api.receivePurchase(input(t, [await teaBags(t, 1_000, 8_000)]))
    expect(await stockOf(t, 'RM-TEA-01')).toEqual({ onHandMilli: 1_200_000, avgCostUsat: 19_500_000 })
  })

  it('a price more than 10% off the last purchase price (standard cost before any) is refused with PRICE_JUMP until confirmed (D47 item 3 · Q4-15)', async () => {
    const t = await openReadyApi()
    const line = await teaBags(t, 1_000, 8_500) // 0.2125 ฿/g vs 0.1925 standard = +10.4%
    await expect(t.api.receivePurchase(input(t, [line]))).rejects.toThrow(/^PRICE_JUMP: RM-TEA-01$/)
    expect(await t.db.select().from(s.purchase).all()).toEqual([])
    expect(await t.db.select().from(s.stockMovement).all()).toEqual([])
    const p = await t.api.receivePurchase(input(t, [line], { acceptPriceJump: true }))
    expect(p.lines[0]!.unitCostUsat).toBe(21_250_000)
    // exactly +10% of the last price is not a jump
    await t.api.receivePurchase(input(t, [await teaBags(t, 1_000, 9_350)])) // 0.23375 vs last 0.2125 = +10.0%
  })

  it('after a real price rise is confirmed, the same new price is not flagged again (review I-7 · Q4-15)', async () => {
    const t = await openReadyApi()
    await t.api.receivePurchase(input(t, [await teaBags(t, 5_000, 38_500)])) // 5 bags at ฿77 (standard)
    await t.api.receivePurchase(input(t, [await teaBags(t, 1_000, 9_000)], { acceptPriceJump: true })) // ฿90: +16.9%, confirmed once
    expect((await stockOf(t, 'RM-TEA-01')).avgCostUsat).toBe(19_791_667) // the average is only ≈ ฿79.17 a bag (+13.7% to ฿90) …
    await t.api.receivePurchase(input(t, [await teaBags(t, 1_000, 9_000)])) // … but ฿90 again is the last price: no alarm
    expect((await t.api.stockOverview()).items.find((i) => i.code === 'RM-TEA-01')!.priceCheckUsat).toBe(22_500_000)
    // a free line (฿0) is not a price to compare with: the next receipt still compares with ฿90
    await t.api.receivePurchase(input(t, [await teaBags(t, 1_000, 0)], { acceptPriceJump: true }))
    await t.api.receivePurchase(input(t, [await teaBags(t, 1_000, 9_000)]))
  })

  it('paid from the drawer (Q4-6): a PAID_OUT of the open shift in the same transaction; needs an open shift', async () => {
    const t = await openReadyApi()
    const p = await t.api.receivePurchase(input(t, [await teaBags(t, 1_000, 7_700)], { paidFromDrawer: true }))
    const cash = await t.db.select().from(s.cashMovement).all()
    expect(cash).toEqual([{ id: p.cashMovementId, shiftId: t.shift.id, kind: 'PAID_OUT', amountSatang: 7_700, orderId: null, reason: 'รับของ แม็คโคร', createdBy: t.owner.id, createdAt: p.createdAt }])
    expect((await t.api.shiftReport()).cash.paidOutSatang).toBe(7_700)
    expect((await t.api.bootstrap()).pendingSyncItems).toBe(3) // the shift, the purchase, and its paid-out as a cash record (T4-8)
    // the same cap as a manual paid-out (review I-3): at most ฿100,000 leaves the drawer in one go — nothing written
    const big = await teaBags(t, 1_000, 10_000_000)
    await expect(t.api.receivePurchase(input(t, [big, big], { paidFromDrawer: true, acceptPriceJump: true }))).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.purchase).all()).toHaveLength(1)

    const u = await openTestApi()
    await u.api.setupShop(TEST_SETUP)
    const owner = (await u.api.bootstrap()).users[0]!
    const tea = { itemId: await itemId(u, 'RM-TEA-01'), purchaseUnitId: null, qtyUnitsMilli: 400_000, lineTotalSatang: 7_700 } // 400 g typed in the use unit
    await expect(u.api.receivePurchase({ actorUserId: owner.id, supplier: '', note: '', lines: [tea], paidFromDrawer: true, acceptPriceJump: false })).rejects.toThrow(/^NO_OPEN_SHIFT: /)
    expect(await u.db.select().from(s.purchase).all()).toEqual([])
    // without the drawer, no shift is needed (Q4-1) and the business date is today in Thailand
    const p2 = await u.api.receivePurchase({ actorUserId: owner.id, supplier: '', note: '', lines: [tea], paidFromDrawer: false, acceptPriceJump: false })
    expect(p2).toMatchObject({ businessDate: '2026-09-17', supplier: null, totalSatang: 7_700 })
    expect(p2.lines[0]!.qtyUseMilli).toBe(400_000)
  })

  it('refuses untracked items, bases, bad quantities and totals, a foreign unit, too long a supplier — writing nothing', async () => {
    const t = await openReadyApi()
    const tea = await teaBags(t, 1_000, 7_700)
    const bad: ReceivePurchaseInput['lines'][number][] = [
      { ...tea, itemId: await itemId(t, 'RM-WTR-01'), purchaseUnitId: null }, // untracked ice (D29)
      { ...tea, itemId: await itemId(t, 'PB-TEA-THAI'), purchaseUnitId: null }, // a base is made, not bought
      { ...tea, qtyUnitsMilli: 0 },
      { ...tea, qtyUnitsMilli: 1_000_000_000 },
      { ...tea, qtyUnitsMilli: 1.5 },
      { ...tea, lineTotalSatang: -1 },
      { ...tea, lineTotalSatang: 10_000_001 },
      { ...tea, purchaseUnitId: await defaultUnitId(t, 'RM-MLK-02') }, // a unit of another item
    ]
    for (const line of bad) await expect(t.api.receivePurchase(input(t, [line], { acceptPriceJump: true }))).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.receivePurchase(input(t, []))).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.receivePurchase(input(t, [tea], { supplier: 'ก'.repeat(201) }))).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.receivePurchase(input(t, [tea], { note: 42 as unknown as string }))).rejects.toThrow(/^BAD_INPUT: /) // not text (review M-6)
    await expect(t.api.receivePurchase(input(t, [tea], { actorUserId: 'nobody' }))).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.purchase).all()).toEqual([])
    expect(await t.db.select().from(s.stockMovement).all()).toEqual([])
  })
})
