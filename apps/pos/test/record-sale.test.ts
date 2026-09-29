import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { OrderRowData } from '@dayo/contracts'
import { posErrorCode } from '../src/api/errors'
import type { RecordSaleInput } from '../src/api/types'
import { pullCatalog } from '../src/sync/catalog'
import { DAYO_KEYS, writeKey } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

type Line = RecordSaleInput['cart']['lines'][number]
const line = (patch: Partial<Line> & { code: string }): Line => ({ size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null, ...patch })
const cartOf = (lines: Line[]): RecordSaleInput['cart'] => ({ channelCode: 'store', lines, billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, manualPromotionIds: [], manualPromotionReason: null })
const matchaCart = (): RecordSaleInput['cart'] => cartOf([line({ code: 'Matcha Latte', grade: 'Excellent' })])

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
    const sell = (expectedTotalSatang: number) => t.api.recordSale({ orderId: t.deps.newId(), actorUserId: STAFF.TungAo, cart: matchaCart(), payment: { method: 'PROMPTPAY' }, expectedTotalSatang })
    expect(await sell(8_500)).toMatchObject({ totalSatang: 8_500 }) // before the 15% afternoon promotion (timeFrom '14:00:00')
    t.clock.set('2026-09-25T06:59:59.000Z') // 13:59:59 — still ฿85
    expect(await sell(8_500)).toMatchObject({ totalSatang: 8_500 })
    // 14:00:00 — dayo's engine (f4cda56) reads the window from HH:MM inclusive (the stored '14:00:00' is cut to '14:00'),
    // so the promotion starts at 14:00 sharp; the tablet runs the same code and agrees with dayo (plan 10 T1 ruling)
    t.clock.set('2026-09-25T07:00:00.000Z')
    try { await sell(8_500); expect.unreachable() } catch (e) {
      expect(posErrorCode(e)).toBe('PRICE_CHANGED')
      expect((e as Error).message).toContain('shown 8500, now 7225')
    }
    expect(await t.db.select().from(s.order).all()).toHaveLength(2) // the refused sale wrote nothing
    // the new price is sold as is: ฿72.25 goes to dayo with its satang (spec §4.5 totals, money converted once at the edge)
    const r = await sell(7_225)
    const row = (await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`)).get())!
    expect(OrderRowData.parse(row.rowJson).totals).toEqual({ items_subtotal: 85, items_discount: 12.75, bill_discount: 0, total: 72.25 })
  })
  it('a bill discount in satang reaches E2 as bill_discount { baht } with its reason', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 }, { billDiscountSatang: 500, reason: '  ลูกค้าประจำ  ' })
    const row = (await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`)).get())!
    const data = OrderRowData.parse(row.rowJson)
    expect([data.bill_discount, data.totals]).toEqual([{ baht: 5, reason: 'ลูกค้าประจำ' }, { items_subtotal: 45, items_discount: 0, bill_discount: 5, total: 40 }])
    expect(r).toMatchObject({ totalSatang: 4_000, changeSatang: 1_000 })
  })
  it('a resend with the same lines but another payment, bill discount or channel is refused, never answered with the first bill', async () => {
    const t = await openConnectedApi()
    const orderId = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21'
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 }, { orderId, billDiscountSatang: 500, reason: 'ลูกค้าประจำ' })
    const variants = [
      () => sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }, { orderId, billDiscountSatang: 500, reason: 'ลูกค้าประจำ' }),
      () => sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 }, { orderId, billDiscountSatang: 1_000, reason: 'ลูกค้าประจำ' }),
      () => sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 }, { orderId }),
      () => sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 }, { orderId, billDiscountSatang: 500, reason: 'ลูกค้าประจำ', channelCode: 'grab' }),
    ]
    for (const resend of variants) {
      try { await resend(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
    }
    // the identical resend (reason typed with spaces is the same reason) still returns the first bill
    expect(await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 }, { orderId, billDiscountSatang: 500, reason: ' ลูกค้าประจำ ' })).toMatchObject({ receiptNo: 'A-000001', totalSatang: 4_000 })
    expect(await t.db.select().from(s.order).all()).toHaveLength(1)
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
    ['a total of 0 from a typed bill discount (D124 · Q1 = ข: ฿0 only from promotions)', { billDiscountSatang: 4_500, reason: 'ฟรี' }, 'ZERO_TOTAL_NOT_ALLOWED'],
    ['a code dayo does not know', { channelCode: 'foodpanda' }, 'PRICE_NOT_OK'],
  ] as const)('refuses %s', async (_, extra, code) => {
    const t = await openConnectedApi()
    try { await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 10_000 }, extra); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe(code) }
  })

  it('a closed size (22 oz, isActive false) is refused before anything is written (ADR-0054)', async () => {
    const t = await openConnectedApi()
    const cart = cartOf([line({ code: 'Pink Milk', size: '22 oz', sweetness: '100%' })])
    try { await t.api.recordSale({ orderId: t.deps.newId(), actorUserId: STAFF.TungAo, cart, payment: { method: 'PROMPTPAY' }, expectedTotalSatang: 7_500 }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
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
    const cart = cartOf([line({ code: 'Cocoa' })])
    try { await t.api.recordSale({ orderId: t.deps.newId(), actorUserId: STAFF.TungAo, cart, payment: { method: 'PROMPTPAY' }, expectedTotalSatang: 4_500 }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('NO_PAYMENT_METHOD') }
    expect(await t.db.select().from(s.order).all()).toEqual([])
  })
})
