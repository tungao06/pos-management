import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { OrderVoidRowData } from '@dayo/contracts'
import { verifyChain } from '@dayo/domain'
import { posErrorCode } from '../src/api/errors'
import { loadDeviceChain } from '../src/db/events'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { openReadyApi, sellCode, sellSku } from './helpers/db'

const approve = { approverUserId: STAFF.DCm, approverPin: '2222' }

describe('cancelSale (spec 04 §4.5 order_void, §4.7, D36)', () => {
  it('queues order_void after its order, and the cash refund stays on the tablet (local_only)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 2 }], { method: 'CASH', tenderedSatang: 10_000 })
    t.clock.advanceMs(60_000)
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'กดผิดเมนู', made: false, refundReference: null })
    const rows = await t.db.select().from(s.outbox).all()
    const v = rows.find((x) => x.tableName === 'order_void')!
    expect(v).toMatchObject({ status: 'pending', idempotencyKey: `order_void:${r.orderId}`, parentKey: `order:${r.orderId}` })
    expect(OrderVoidRowData.parse(v.rowJson)).toMatchObject({ staff_id: STAFF.TungAo, approved_by: STAFF.DCm, reason: 'กดผิดเมนู' })
    expect(rows.find((x) => x.tableName === 'cash_movement')?.status).toBe('local_only')
    expect(await t.api.bootstrap()).toMatchObject({ pendingSyncItems: 1 }) // one bill, two rows (D50 Q3-26)
  })
  it('is refused on another Thai day than the sale (spec §4.7)', async () => {
    const t = await openConnectedApi({ now: '2026-09-25T16:50:00.000Z' }) // 23:50 Bangkok
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.clock.set('2026-09-25T17:10:00.000Z') // 00:10 next day, same open shift
    try { await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'ช้า', made: false, refundReference: 'KBANK-9' }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('VOID_NOT_ALLOWED') }
  })
  it.each([['staff', 'Mint', '4321'], ['manager', 'Beam', '5555']] as const)('a %s may cancel only their own bill (Q44, ruling R11)', async (_, who, pin) => {
    const t = await openConnectedApi()
    await t.api.setStaffPin({ staffId: STAFF[who], pin, approverUserId: STAFF.TungAo, approverPin: '1111' })
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }) // sold by TungAo
    try { await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF[who], ...approve, reason: 'x', made: false, refundReference: 'K' }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('VOID_NOT_ALLOWED') }
    const own = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }, { actorUserId: STAFF[who] })
    await t.api.cancelSale({ orderId: own.orderId, actorUserId: STAFF[who], ...approve, reason: 'x', made: false, refundReference: 'K' })
  })
  it('voided_at is never before sold_at, even after the clock was set back (review item 5 — dayo answers INVALID otherwise)', async () => {
    const t = await openConnectedApi({ now: '2026-09-25T03:07:00.000Z' }) // clock 7 minutes fast
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.clock.set('2026-09-25T03:01:00.000Z') // the shop fixed the clock after the D80 banner
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'x', made: false, refundReference: 'K' })
    const v = (await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_void')).get())!
    expect(OrderVoidRowData.parse(v.rowJson).voided_at).toBe('2026-09-25T03:07:00.000Z')
  })
  it('records "made" in the event for the Z void list and writes no stock row (ruling R6)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'ทำผิดสูตร', made: true, refundReference: 'KBANK-1' })
    const ev = await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'VOIDED')).get()
    expect(ev?.payloadJson).toMatchObject({ made: true, waste: true })
    expect(await t.db.select().from(s.stockMovement).all()).toEqual([])
  })

  it('a second cancel of the same bill is refused and queues no second order_void (resend-safe)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    const input = { orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'กดผิดเมนู', made: false, refundReference: null }
    const detail = await t.api.cancelSale(input)
    expect(detail).toMatchObject({ status: 'voided', voidable: false })
    try { await t.api.cancelSale(input); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('VOID_NOT_ALLOWED') }
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_void')).all())).toHaveLength(1)
    expect(await t.db.select().from(s.cashMovement).all()).toHaveLength(1)
    expect(verifyChain(await loadDeviceChain(t.db, t.device.id))).toEqual({ ok: true })
  })
  it('works with dayo down and never calls dayo (write locally first)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setMode('server_down')
    const calls = t.mock.requests().length
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'x', made: false, refundReference: 'K' })
    expect(t.mock.requests()).toHaveLength(calls)
    expect((await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())?.status).toBe('voided')
  })
  it('a PromptPay bill needs the refund reference; a bad reason is refused — nothing written either way', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const before = await t.db.select().from(s.outbox).all()
    for (const bad of [{ reason: 'x', refundReference: null }, { reason: '   ', refundReference: 'K' }, { reason: 'ก'.repeat(201), refundReference: 'K' }]) {
      try { await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, made: false, ...bad }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
    }
    expect(await t.db.select().from(s.outbox).all()).toEqual(before)
    expect((await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())?.status).toBe('paid')
  })
  it('a plan-3 bill (no sold_at) and a bill closed as outside dayo queue no order_void', async () => {
    const t = await openReadyApi()
    const legacy = await sellSku(t, 'Original-16oz', 1, { method: 'PROMPTPAY' })
    const excluded = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.db.update(s.order).set({ excludedAt: '2026-09-17T03:00:00.000Z' }).where(eq(s.order.id, excluded.orderId))
    for (const id of [legacy.orderId, excluded.orderId]) {
      await t.api.cancelSale({ orderId: id, actorUserId: t.owner.id, approverUserId: t.other.id, approverPin: '2222', reason: 'x', made: true, refundReference: 'K' })
    }
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_void')).all()).toEqual([])
  })
})
