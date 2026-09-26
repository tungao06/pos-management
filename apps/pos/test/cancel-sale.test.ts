import { and, eq } from 'drizzle-orm'
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
    // the queue row itself is not older than its bill's row either (the sender reads rows in created_at order)
    const o = (await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`)).get())!
    expect(v.createdAt).toBe('2026-09-25T03:07:00.000Z')
    expect(v.createdAt >= o.createdAt).toBe(true)
    // one void time everywhere: the bill's own voided_at is the one sent to dayo, never before sold_at
    const bill = (await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())!
    expect(bill.voidedAt).toBe(OrderVoidRowData.parse(v.rowJson).voided_at)
    expect(bill.voidedAt! >= bill.soldAt!).toBe(true)
  })
  it(`a clock set back to yesterday cannot cancel yesterday's bill: "now" is never before the latest sale (same-day rule)`, async () => {
    const t = await openConnectedApi({ now: '2026-09-25T16:50:00.000Z' }) // 23:50 Bangkok, 25 Sep
    const yesterday = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.clock.set('2026-09-25T17:10:00.000Z') // 00:10, 26 Sep — same open shift
    const today = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.clock.set('2026-09-25T16:59:00.000Z') // the clock is set back to 23:59, 25 Sep
    const before = await t.db.select().from(s.outbox).all()
    try { await t.api.cancelSale({ orderId: yesterday.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'x', made: false, refundReference: 'K' }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('VOID_NOT_ALLOWED') }
    expect(await t.db.select().from(s.outbox).all()).toEqual(before)
    // today's bill can still be cancelled, stamped at the latest sale, not at the set-back clock
    await t.api.cancelSale({ orderId: today.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'x', made: false, refundReference: 'K' })
    const bill = (await t.db.select().from(s.order).where(eq(s.order.id, today.orderId)).get())!
    expect(bill.voidedAt).toBe('2026-09-25T17:10:00.000Z')
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
  it('a plan-3 bill (no sold_at) goes the stock way: not made returns every ingredient, made returns none — no order_void', async () => {
    const t = await openReadyApi()
    const notMade = await sellSku(t, 'Original-16oz', 2, { method: 'CASH', tenderedSatang: 10_000 })
    const made = await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
    const moves = async (orderId: string, kind: 'SALE' | 'VOID_RETURN') => (await t.db.select().from(s.stockMovement).where(and(eq(s.stockMovement.refType, 'order'), eq(s.stockMovement.refId, orderId), eq(s.stockMovement.kind, kind))).all())
      .map((m) => [m.itemId, Math.abs(m.qtyMilli), m.unitCostUsat]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    const base = { actorUserId: t.owner.id, approverUserId: t.other.id, approverPin: '2222', reason: 'กดผิดเมนู' }
    const d1 = await t.api.cancelSale({ ...base, orderId: notMade.orderId, made: false, refundReference: null })
    expect(d1.events.map((e) => e.type).slice(-2)).toEqual(['VOIDED', 'STOCK_RETURNED'])
    expect(await moves(notMade.orderId, 'VOID_RETURN')).toEqual(await moves(notMade.orderId, 'SALE')) // same items, qty and cost
    expect((await t.db.select().from(s.cashMovement).all()).map((c) => [c.kind, c.amountSatang])).toEqual([['VOID_REFUND', 9_000]])
    const d2 = await t.api.cancelSale({ ...base, orderId: made.orderId, made: true, refundReference: 'KBANK-1' })
    expect(d2.events.at(-1)).toMatchObject({ type: 'VOIDED', payload: { made: true, waste: true, refundReference: 'KBANK-1' } })
    expect(await moves(made.orderId, 'VOID_RETURN')).toEqual([])
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_void')).all()).toEqual([])
    expect(verifyChain(await loadDeviceChain(t.db, t.device.id))).toEqual({ ok: true })
  })
  it("a plan-3 bill keeps the same permission rule: staff cannot cancel an owner's bill, and it stays paid with its stock", async () => {
    const t = await openReadyApi()
    await t.api.setStaffPin({ staffId: STAFF.Mint, pin: '4321', approverUserId: t.owner.id, approverPin: '1111' })
    const legacy = await sellSku(t, 'Original-16oz', 1, { method: 'PROMPTPAY' }) // sold by the owner
    try { await t.api.cancelSale({ orderId: legacy.orderId, actorUserId: STAFF.Mint, approverUserId: t.other.id, approverPin: '2222', reason: 'x', made: false, refundReference: 'K' }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('VOID_NOT_ALLOWED') }
    expect((await t.db.select().from(s.order).where(eq(s.order.id, legacy.orderId)).get())?.status).toBe('paid')
    expect(await t.db.select().from(s.stockMovement).where(eq(s.stockMovement.kind, 'VOID_RETURN')).all()).toEqual([])
  })
  it('a bill closed as outside dayo queues no order_void', async () => {
    const t = await openConnectedApi()
    const excluded = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.db.update(s.order).set({ excludedAt: '2026-09-25T03:00:00.000Z' }).where(eq(s.order.id, excluded.orderId))
    await t.api.cancelSale({ orderId: excluded.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'x', made: true, refundReference: 'K' })
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_void')).all()).toEqual([])
  })
})
