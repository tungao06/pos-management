import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { OrderRowData } from '@dayo/contracts'
import { posErrorCode } from '../src/api/errors'
import { pullCatalog } from '../src/sync/catalog'
import { DAYO_KEYS, writeKey } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

describe('recordSale (spec 04 §4.5, §5.1, §6.1)', () => {
  it('writes the bill, its lines and ONE pending E2 row in one transaction', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Thai Tea', qty: 3 }, { code: 'Matcha Latte', grade: 'Excellent', qty: 1 }], { method: 'CASH', tenderedSatang: 20_000 })
    expect(r).toMatchObject({ receiptNo: 'A-000001', queueNo: 1, totalSatang: 15_500 })
    const rows = await t.db.select().from(s.outbox).where(eq(s.outbox.status, 'pending')).all()
    expect(rows.map((x) => [x.tableName, x.idempotencyKey])).toEqual([['order', `order:${r.orderId}`]])
    const data = OrderRowData.parse(rows[0]!.rowJson)
    expect(data).toMatchObject({ receipt_no: 'A-000001', queue_no: 1, shift_id: null, staff_id: STAFF.TungAo, catalog_version: 42, channel: 'store', payment: 'cash', totals: { total: 155 } })
    const items = await t.db.select().from(s.orderItem).where(eq(s.orderItem.orderId, r.orderId)).all()
    expect(items.map((i) => [i.menuCode, i.qty, i.lineTotalSatang])).toEqual(expect.arrayContaining([['Matcha Latte', 1, 8500]]))
    expect(await t.api.bootstrap()).toMatchObject({ pendingSyncItems: 1 })
  })
  it('writes no stock movement and no plan-3 outbox row (D60, spec §6.1)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    expect(await t.db.select().from(s.stockMovement).all()).toEqual([])
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.status, 'pending')).all()).map((x) => x.tableName)).toEqual(['order'])
  })
  it('re-prices at the payment instant and refuses a changed total (D50 Q3-27)', async () => {
    const t = await openConnectedApi({ now: '2026-09-25T06:59:30.000Z' }) // 13:59:30 Bangkok, Friday
    const cart = { channelCode: 'store', lines: [{ code: 'Matcha Latte', size: '16 oz' as const, sweetness: '50%' as const, milk: 'fresh' as const, grade: 'Excellent', qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null }], billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false }
    // 14:01:00 — the 15% afternoon promotion (timeFrom '14:00:00') has started before payment. Not 14:00:30: dayo's
    // shared code compares bkkTime 'HH:MM' with the stored 'HH:MM:SS' as text, so '14:00' < '14:00:00' and the
    // promotion only applies from 14:01 — the tablet runs the same code, so it agrees with dayo either way.
    t.clock.set('2026-09-25T07:01:00.000Z')
    try {
      await t.api.recordSale({ orderId: t.deps.newId(), actorUserId: STAFF.TungAo, cart, payment: { method: 'PROMPTPAY' }, expectedTotalSatang: 8_500 })
      expect.unreachable()
    } catch (e) { expect(posErrorCode(e)).toBe('PRICE_CHANGED') }
    expect(await t.db.select().from(s.order).all()).toEqual([])
  })
  it('the same orderId twice returns the first bill; with other lines it is refused (plan 3 M12)', async () => {
    const t = await openConnectedApi()
    const orderId = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21'
    const first = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }, { orderId })
    const again = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }, { orderId })
    expect(again.receiptNo).toBe(first.receiptNo)
    try { await sellCode(t, [{ code: 'Cocoa', qty: 2 }], { method: 'PROMPTPAY' }, { orderId }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
    // the replay queued nothing new: still one bill, one E2 row
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order')).all()).map((x) => x.idempotencyKey)).toEqual([`order:${orderId}`])
    expect(await t.db.select().from(s.order).all()).toHaveLength(1)
  })
  it('continues after the receipt number dayo last saw for this key (spec §6.6)', async () => {
    const t = await openConnectedApi()
    await writeKey(t.db, DAYO_KEYS.lastReceiptNo, 'A-000311')
    expect((await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })).receiptNo).toBe('A-000312')
  })
  it.each([
    ['a total of 0 (D50 Q3-20)', { billDiscountSatang: 4_500, reason: 'ฟรี' }, 'DISCOUNT_TOO_BIG'],
    ['a code dayo does not know', { channelCode: 'foodpanda' }, 'PRICE_NOT_OK'],
  ] as const)('refuses %s', async (_, extra, code) => {
    const t = await openConnectedApi()
    try { await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 10_000 }, extra); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe(code) }
  })

  it('a closed size (22 oz, isActive false) is refused before anything is written (ADR-0054)', async () => {
    const t = await openConnectedApi()
    try { await sellCode(t, [{ code: 'Pink Milk', size: '22 oz', sweetness: '100%', qty: 1 }], { method: 'PROMPTPAY' }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
    expect(await t.db.select().from(s.order).all()).toEqual([])
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.status, 'pending')).all()).toEqual([])
  })
  it('sells with dayo down and never calls dayo while selling (write locally first)', async () => {
    const t = await openConnectedApi()
    t.mock.setMode('server_down')
    const calls = t.mock.requests().length
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    expect(r).toMatchObject({ receiptNo: 'A-000001', totalSatang: 4_500, changeSatang: 500 })
    expect(t.mock.requests()).toHaveLength(calls)
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`)).get())?.status).toBe('pending')
  })
  it('queue number 9999 is the last of the day (ruling R13)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.raw.prepare('update "order" set queue_no = 9999 where id = ?').run(r.orderId)
    try { await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('QUEUE_FULL') }
    expect(await t.db.select().from(s.order).all()).toHaveLength(1)
  })
  it('a payment method dayo no longer offers is refused (NO_PAYMENT_METHOD)', async () => {
    const t = await openConnectedApi()
    t.mock.bumpCatalog((c) => { c.catalog.paymentMethods = c.catalog.paymentMethods.filter((p) => p.code !== 'qr') })
    expect((await pullCatalog({ db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() })).outcome).toBe('changed')
    const cart = { channelCode: 'store', lines: [{ code: 'Cocoa', size: '16 oz', sweetness: '50%' as const, milk: 'fresh' as const, grade: null, qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null }], billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false }
    try { await t.api.recordSale({ orderId: t.deps.newId(), actorUserId: STAFF.TungAo, cart, payment: { method: 'PROMPTPAY' }, expectedTotalSatang: 4_500 }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('NO_PAYMENT_METHOD') }
    expect(await t.db.select().from(s.order).all()).toEqual([])
  })
})
