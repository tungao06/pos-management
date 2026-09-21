import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { applyMovement, rebuildCostState } from '@dayo/domain'
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

  it('an inactive item is refused with BAD_INPUT and writes nothing, whether or not it still holds stock (review I-1)', async () => {
    const t = await openReadyApi()
    const id = await itemId(t, 'RM-TEA-01')

    // no stock yet
    t.raw.prepare('update item set is_active = 0 where id = ?').run(id)
    await expect(t.api.receivePurchase(input(t, [await teaBags(t, 1_000, 7_700)]))).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.purchase).all()).toEqual([])
    expect(await t.db.select().from(s.stockMovement).all()).toEqual([])

    // reactivate, buy some stock, then deactivate again — refused just the same even though on-hand is now > 0
    t.raw.prepare('update item set is_active = 1 where id = ?').run(id)
    await t.api.receivePurchase(input(t, [await teaBags(t, 1_000, 7_700)]))
    t.raw.prepare('update item set is_active = 0 where id = ?').run(id)
    await expect(t.api.receivePurchase(input(t, [await teaBags(t, 1_000, 7_700)]))).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.purchase).all()).toHaveLength(1) // only the receipt made while active
  })

  it('a wholly free receipt paid from the drawer is a no-op: no PAID_OUT, no shift required (review m-1)', async () => {
    const u = await openTestApi()
    await u.api.setupShop(TEST_SETUP)
    const owner = (await u.api.bootstrap()).users[0]!
    const tea = { itemId: await itemId(u, 'RM-TEA-01'), purchaseUnitId: null, qtyUnitsMilli: 400_000, lineTotalSatang: 0 }
    // no shift is open, yet paidFromDrawer + a wholly free line succeeds — nothing to pay out
    const p = await u.api.receivePurchase({ actorUserId: owner.id, supplier: '', note: '', lines: [tea], paidFromDrawer: true, acceptPriceJump: true })
    expect(p.totalSatang).toBe(0)
    expect(p.cashMovementId).toBeNull()
    expect(await u.db.select().from(s.cashMovement).all()).toEqual([])
  })

  it('needs an open shift before a price jump is even considered, when paying from the drawer (review m-2)', async () => {
    const u = await openTestApi()
    await u.api.setupShop(TEST_SETUP)
    const owner = (await u.api.bootstrap()).users[0]!
    const tea = { itemId: await itemId(u, 'RM-TEA-01'), purchaseUnitId: null, qtyUnitsMilli: 400_000, lineTotalSatang: 8_500 } // +10.4% vs standard: a price jump
    // if PRICE_JUMP ran first, this would fail with PRICE_JUMP instead
    await expect(u.api.receivePurchase({ actorUserId: owner.id, supplier: '', note: '', lines: [tea], paidFromDrawer: true, acceptPriceJump: false })).rejects.toThrow(/^NO_OPEN_SHIFT: /)
    expect(await u.db.select().from(s.purchase).all()).toEqual([])
  })

  it('the PRICE_JUMP detail lists each item code once, even with two jumping lines of the same item (review m-4)', async () => {
    const t = await openReadyApi()
    const line = await teaBags(t, 1_000, 8_500) // +10.4% vs standard: a jump
    await expect(t.api.receivePurchase(input(t, [line, line]))).rejects.toThrow(/^PRICE_JUMP: RM-TEA-01$/)
  })

  it('cuts the PAID_OUT reason on code points, never inside a surrogate pair (review m-5)', async () => {
    const t = await openReadyApi()
    // 195 UTF-16 units (192 BMP chars + a 2-unit emoji + 1 BMP char), under the 200-char supplier cap; combined
    // with the "รับของ " prefix (7 units) the raw reason is 202 units, so it must be cut — right through the emoji
    // if the cut is done on UTF-16 units rather than code points.
    const supplier = `${'ก'.repeat(192)}🎉ข`
    const p = await t.api.receivePurchase(input(t, [await teaBags(t, 1_000, 7_700)], { supplier, paidFromDrawer: true }))
    const cash = await t.db.select().from(s.cashMovement).where(eq(s.cashMovement.id, p.cashMovementId!)).get()
    const expectedReason = Array.from(`รับของ ${supplier}`).slice(0, 200).join('')
    expect(cash!.reason).toBe(expectedReason)
    expect(cash!.reason!.endsWith('🎉')).toBe(true) // the emoji survives whole — never a lone surrogate
    expect(Array.from(cash!.reason!).length).toBe(200)
  })
  describe('one bill’s same-item lines are averaged as one receipt (Q4-17 ก · D57)', () => {
    // RM-TEA-01 at −500 g; one bill: 400 g for ฿77 and 400 g for ฿0 (in the use unit)
    async function negativeTea(): Promise<ReadyApi> {
      const t = await openReadyApi()
      await t.api.adjustStock({ actorUserId: t.owner.id, reasonCode: 'WASTE', reason: 'หก', items: [{ itemId: await itemId(t, 'RM-TEA-01'), purchaseUnitId: null, qtyUnitsMilli: 500_000 }], drinks: [] })
      expect(await stockOf(t, 'RM-TEA-01')).toEqual({ onHandMilli: -500_000, avgCostUsat: 19_250_000 })
      return t
    }
    async function tea(t: ReadyApi, totalSatang: number): Promise<ReceivePurchaseInput['lines'][number]> {
      return { itemId: await itemId(t, 'RM-TEA-01'), purchaseUnitId: null, qtyUnitsMilli: 400_000, lineTotalSatang: totalSatang }
    }

    it('at negative on-hand the average does not depend on which line was typed last; audit rows stay one per line', async () => {
      for (const order of [[7_700, 0], [0, 7_700]]) {
        const t = await negativeTea()
        const p = await t.api.receivePurchase(input(t, [await tea(t, order[0]!), await tea(t, order[1]!)], { acceptPriceJump: true }))
        // ฿77 over 800 g = 9_625_000 usat/g, whichever order
        expect(await stockOf(t, 'RM-TEA-01')).toEqual({ onHandMilli: 300_000, avgCostUsat: 9_625_000 })
        expect((await movementsOf(t, 'purchase', p.id)).map((m) => [m.qtyMilli, m.unitCostUsat])).toEqual(order.map((sat) => [400_000, sat === 0 ? 0 : 19_250_000]))
        // the cache points at the item's last inserted row and agrees with a rebuild over the same rows (spec §4.4)
        const id = await itemId(t, 'RM-TEA-01')
        const rows = await t.db.select().from(s.stockMovement).where(eq(s.stockMovement.itemId, id)).orderBy(asc(s.stockMovement.id)).all()
        const cache = await t.db.select().from(s.itemCostState).where(eq(s.itemCostState.itemId, id)).get()
        expect(cache!.asOfMovementId).toBe(rows.at(-1)!.id)
        expect(rebuildCostState(rows, 19_250_000)).toEqual({ onHandMilli: 300_000, avgCostUsat: 9_625_000 })
      }
    })

    it('a bill with two different items is unaffected: each item is its own one-line receipt', async () => {
      const t = await negativeTea()
      const milk = { itemId: await itemId(t, 'RM-MLK-02'), purchaseUnitId: await defaultUnitId(t, 'RM-MLK-02'), qtyUnitsMilli: 1_000, lineTotalSatang: 3_000 }
      await t.api.receivePurchase(input(t, [await tea(t, 0), milk], { acceptPriceJump: true }))
      expect(await stockOf(t, 'RM-TEA-01')).toEqual(applyMovement({ onHandMilli: -500_000, avgCostUsat: 19_250_000 }, { qtyMilli: 400_000, unitCostUsat: 0 }))
      expect(await stockOf(t, 'RM-TEA-01')).toEqual({ onHandMilli: -100_000, avgCostUsat: 0 })
      expect(await stockOf(t, 'RM-MLK-02')).toEqual({ onHandMilli: 405_000, avgCostUsat: 7_407_407 })
    })
  })
})
