import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { encodeLastError } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { openReadyApi, sellCode, legacySale } from './helpers/db'

describe('order history for block-2 bills', () => {
  it('counts cups from order_item and names the seller (review item 19, D61)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 2 }, { code: 'Thai Tea', qty: 1 }], { method: 'PROMPTPAY' })
    const [o] = await t.api.listOrders()
    expect(o).toMatchObject({ cups: 3, soldById: STAFF.TungAo, soldByName: 'TungAo', central: { state: 'pending', voidState: 'none', diffSatang: null } })
  })
  it('shows what dayo computed and the difference to the satang (spec §4.3)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.db.update(s.order).set({ centralOrderNo: 'L260925-001', centralComputedTotalSatang: 4_501, centralDuplicateOfJson: ['L260925-000'] }).where(eq(s.order.id, r.orderId))
    await t.db.update(s.outbox).set({ status: 'sent' }).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`))
    expect((await t.api.getOrder(r.orderId)).central).toMatchObject({ state: 'sent', orderNo: 'L260925-001', diffSatang: 1, duplicateOf: ['L260925-000'] })
  })
  it('a sent bill voided only on the tablet is flagged (review item 23)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.db.update(s.outbox).set({ status: 'sent' }).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`))
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'x', made: false, refundReference: 'K' })
    await t.db.update(s.outbox).set({ status: 'local_only' }).where(eq(s.outbox.idempotencyKey, `order_void:${r.orderId}`))
    expect((await t.api.getOrder(r.orderId)).central.voidState).toBe('local_only')
  })

  it('a bill closed as outside dayo and then voided has no central void to wait for (voidState none, not local_only)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.db.update(s.order).set({ excludedAt: '2026-09-25T03:00:00.000Z' }).where(eq(s.order.id, r.orderId))
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'x', made: false, refundReference: 'K' })
    expect((await t.api.getOrder(r.orderId)).central).toMatchObject({ state: 'excluded', voidState: 'none' })
  })
  it('the detail shows order_item lines with milk and grade, when/where it was sold, and the promotions', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Thai Tea', qty: 3 }, { code: 'Matcha Latte', grade: 'Premium', milk: 'oat', qty: 1 }], { method: 'CASH', tenderedSatang: 20_000 })
    const d = await t.api.getOrder(r.orderId)
    expect(d).toMatchObject({ cups: 4, soldAt: '2026-09-25T03:00:00.000Z', channelCode: 'store', catalogVersion: 42, voidable: true })
    // the lines as dayo's pricing code quoted them: buy 2 get 1 splits the 3 Thai teas into the free cup and the paid two
    expect(d.lines.map((l) => [l.productName, l.sizeName, l.sweetnessName, l.milk, l.grade, l.qty, l.lineTotalSatang])).toEqual([
      ['ชาไทย', '16 oz', '50%', 'fresh', null, 1, 0],
      ['ชาไทย', '16 oz', '50%', 'fresh', null, 2, 7_000],
      ['มัตฉะลาเต้', '16 oz', '50%', 'oat', 'Premium', 1, 12_000],
    ])
    expect(d.promotions).toEqual([{ name: 'ชาไทย ซื้อ 2 แถม 1', discountSatang: 3_500 }])
    expect(d.subtotalSatang - d.discountSatang).toBe(d.totalSatang)
  })
  it('central state: problem with dayo\'s reason, excluded, a pending void — and the next Thai day it is no longer voidable', async () => {
    const t = await openConnectedApi({ now: '2026-09-25T16:00:00.000Z' }) // 23:00 Bangkok
    const dead = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const excluded = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const voided = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.db.update(s.outbox).set({ status: 'dead', lastError: encodeLastError('UNKNOWN_CODE', 'Cocoa') }).where(eq(s.outbox.idempotencyKey, `order:${dead.orderId}`))
    await t.db.update(s.order).set({ excludedAt: '2026-09-25T16:00:00.000Z' }).where(eq(s.order.id, excluded.orderId))
    await t.api.cancelSale({ orderId: voided.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'x', made: false, refundReference: 'K' })
    const byId = new Map((await t.api.listOrders()).map((o) => [o.id, o.central]))
    expect(byId.get(dead.orderId)).toMatchObject({ state: 'problem', reason: 'UNKNOWN_CODE', voidState: 'none' })
    expect(byId.get(excluded.orderId)).toMatchObject({ state: 'excluded' })
    expect(byId.get(voided.orderId)).toMatchObject({ state: 'pending', voidState: 'pending' })
    expect((await t.api.getOrder(dead.orderId)).voidable).toBe(true)
    t.clock.set('2026-09-25T17:30:00.000Z') // 00:30 the next Thai day, same open shift (spec §4.7)
    expect((await t.api.getOrder(dead.orderId)).voidable).toBe(false)
  })
  it('a plan-3 bill is legacy, keeps its order_line names and has no milk/grade', async () => {
    const t = await openReadyApi()
    const r = await legacySale(t, 'Original-16oz', 2, { method: 'CASH', tenderedSatang: 10_000 })
    const d = await t.api.getOrder(r.orderId)
    expect(d).toMatchObject({ cups: 2, soldAt: null, channelCode: null, catalogVersion: null, promotions: [], soldById: t.owner.id, soldByName: 'TungAo', central: { state: 'legacy', voidState: 'none', orderNo: null } })
    expect(d.lines.map((l) => [l.productName, l.sizeName, l.milk, l.grade])).toEqual([['ชาไทยเย็น', '16 oz', null, null]])
  })
  it('a seller who has no PIN on this tablet is named from dayo\'s staff list', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.raw.prepare('update "order" set created_by_id = ? where id = ?').run(STAFF.Unnamed, r.orderId)
    expect(await t.api.getOrder(r.orderId)).toMatchObject({ soldById: STAFF.Unnamed, soldByName: `พนักงาน ${STAFF.Unnamed.slice(-4)}` })
  })
})
