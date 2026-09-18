import { describe, expect, it } from 'vitest'
import { promptPayPayload } from '@dayo/domain'
import { openReadyApi, sellSku } from './helpers/db'

describe('listOrders / getOrder', () => {
  it('lists the open shift newest first and shows a full detail with the event timeline', async () => {
    const t = await openReadyApi()
    const a = await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 5000 })
    const b = await sellSku(t, 'Latte-16oz', 2, { method: 'PROMPTPAY' }, { amountSatang: 1000, reason: 'ลูกค้าประจำ' })
    const list = await t.api.listOrders()
    expect(list.map((o) => [o.receiptNo, o.queueNo, o.status, o.method, o.totalSatang, o.cups])).toEqual([
      ['A-000002', 2, 'paid', 'PROMPTPAY', 9000, 2],
      ['A-000001', 1, 'paid', 'CASH', 4500, 1],
    ])
    const detailA = await t.api.getOrder(a.orderId)
    expect(detailA).toMatchObject({ receiptNo: 'A-000001', subtotalSatang: 4500, discountSatang: 0, discountReason: null, tenderedSatang: 5000, changeSatang: 500, voidable: true, voidedAt: null, businessDate: '2026-09-17', shiftId: t.shift.id })
    expect(detailA.lines).toEqual([{ lineNo: 1, productName: 'ชาไทยเย็น', sizeName: '16 oz', sweetnessName: '50%', qty: 1, unitPriceSatang: 4500, lineTotalSatang: 4500 }])
    expect(detailA.events.map((e) => e.type)).toEqual(['CREATED', 'LINE_ADDED', 'PAID', 'STOCK_DEDUCTED'])
    const detailB = await t.api.getOrder(b.orderId)
    expect(detailB).toMatchObject({ method: 'PROMPTPAY', discountSatang: 1000, discountReason: 'ลูกค้าประจำ', tenderedSatang: null, changeSatang: null })
  })

  it('unknown order → ORDER_NOT_FOUND', async () => {
    const t = await openReadyApi()
    await expect(t.api.getOrder('nope')).rejects.toThrow(/^ORDER_NOT_FOUND: /)
  })

  it('orders of a closed shift are not listed and not voidable (D47 ข้อ 2 · Q3-13)', async () => {
    const t = await openReadyApi()
    const a = await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 })
    t.raw.prepare("update shift set status = 'closed', closed_at = ?, closed_by = ? where id = ?").run(t.clock.now(), t.owner.id, t.shift.id)
    expect(await t.api.listOrders()).toEqual([])
    t.clock.set('2026-09-18T03:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    expect(await t.api.listOrders()).toEqual([])
    expect((await t.api.getOrder(a.orderId)).voidable).toBe(false)
  })
})

describe('promptPayForAmount', () => {
  it('builds the dynamic QR for the configured PromptPay id (D48 Q3-4)', async () => {
    const t = await openReadyApi()
    expect(await t.api.promptPayForAmount(4500)).toBe(promptPayPayload('0812345678', 4500))
  })
  it('rejects a non-positive amount and a missing id', async () => {
    const t = await openReadyApi()
    await expect(t.api.promptPayForAmount(0)).rejects.toThrow(/^BAD_INPUT: /)
    t.raw.prepare("delete from setting where key = 'promptpay.id'").run()
    await expect(t.api.promptPayForAmount(4500)).rejects.toThrow(/^NO_PROMPTPAY_ID: /)
  })
})
