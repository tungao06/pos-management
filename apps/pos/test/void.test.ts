import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { verifyChain } from '@dayo/domain'
import type { VoidOrderInput } from '../src/api/types'
import { loadDeviceChain } from '../src/db/events'
import { hashPin } from '../src/lib/pin'
import { openReadyApi, PINS, sellSku, TEST_PIN_COST, type ReadyApi } from './helpers/db'

function voidInput(t: ReadyApi, orderId: string, patch: Partial<VoidOrderInput> = {}): VoidOrderInput {
  return { orderId, actorUserId: t.owner.id, approverUserId: t.other.id, approverPin: PINS.DCm, reason: 'กดผิดเมนู', made: false, refundReference: null, ...patch }
}

function counts(t: ReadyApi): Record<string, number> {
  const out: Record<string, number> = {}
  for (const table of ['order', 'stock_movement', 'item_cost_state', 'cash_movement', 'order_event', 'outbox']) {
    out[table] = (t.raw.prepare(`select count(*) as c from "${table}"`).get() as { c: number }).c
  }
  return out
}

describe('voidOrder', () => {
  it('cash, not made yet: returns every ingredient at the original cost, refunds cash as VOID_REFUND, chains VOIDED + STOCK_RETURNED', async () => {
    const t = await openReadyApi()
    const sale = await sellSku(t, 'Original-16oz', 2, { method: 'CASH', tenderedSatang: 10_000 })
    t.clock.advanceMs(60_000)
    const detail = await t.api.voidOrder(voidInput(t, sale.orderId))
    expect(detail).toMatchObject({ status: 'voided', voidable: false, voidedAt: '2026-09-17T03:01:00.000Z' })
    expect(detail.events.map((e) => e.type)).toEqual(['CREATED', 'LINE_ADDED', 'PAID', 'STOCK_DEDUCTED', 'VOIDED', 'STOCK_RETURNED'])
    expect(detail.events[4]!.payload).toMatchObject({ reason: 'กดผิดเมนู', made: false, waste: false, approvedBy: t.other.id, cashRefundSatang: 9000, refundReference: null })

    const moves = await t.db.select().from(s.stockMovement).where(and(eq(s.stockMovement.refType, 'order'), eq(s.stockMovement.refId, sale.orderId))).all()
    const sales = moves.filter((m) => m.kind === 'SALE')
    const returns = moves.filter((m) => m.kind === 'VOID_RETURN')
    expect(returns.map((m) => [m.itemId, m.qtyMilli, m.unitCostUsat])).toEqual(sales.map((m) => [m.itemId, -m.qtyMilli, m.unitCostUsat]))
    for (const st of await t.db.select().from(s.itemCostState).all()) expect(st.onHandMilli).toBe(0)

    const cash = await t.db.select().from(s.cashMovement).all()
    expect(cash).toHaveLength(1)
    expect(cash[0]).toMatchObject({ shiftId: t.shift.id, kind: 'VOID_REFUND', amountSatang: 9000, orderId: sale.orderId, createdBy: t.owner.id })
    expect(cash[0]!.reason).toContain('A-000001')

    const keys = (await t.db.select().from(s.outbox).all()).map((r) => r.idempotencyKey)
    expect(keys).toContain(`order:${sale.orderId}:voided`)
    expect(keys).toContain(`cash_movement:${cash[0]!.id}`)
    expect(verifyChain(await loadDeviceChain(t.db, t.device.id))).toEqual({ ok: true })
  })

  it('already made: no stock comes back, the VOIDED event carries the waste marker (D39)', async () => {
    const t = await openReadyApi()
    const sale = await sellSku(t, 'Latte-16oz', 1, { method: 'CASH', tenderedSatang: 5000 })
    const before = await t.db.select().from(s.stockMovement).all()
    const detail = await t.api.voidOrder(voidInput(t, sale.orderId, { made: true, reason: 'ทำผิดสูตร' }))
    expect(detail.events.map((e) => e.type).slice(-1)).toEqual(['VOIDED'])
    expect(detail.events.at(-1)!.payload).toMatchObject({ made: true, waste: true })
    expect(await t.db.select().from(s.stockMovement).all()).toEqual(before)
    expect((await t.db.select().from(s.cashMovement).all()).map((c) => c.amountSatang)).toEqual([5000])
  })

  it('PromptPay needs a refund transfer reference and records no cash movement (D48 Q3-15)', async () => {
    const t = await openReadyApi()
    const sale = await sellSku(t, 'Original-16oz', 1, { method: 'PROMPTPAY' })
    await expect(t.api.voidOrder(voidInput(t, sale.orderId))).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.voidOrder(voidInput(t, sale.orderId, { refundReference: '   ' }))).rejects.toThrow(/^BAD_INPUT: /)
    const detail = await t.api.voidOrder(voidInput(t, sale.orderId, { refundReference: ' KBANK-123 ' }))
    expect(detail.events.find((e) => e.type === 'VOIDED')!.payload).toMatchObject({ cashRefundSatang: 0, qrRefundSatang: 4500, refundReference: 'KBANK-123' })
    expect(await t.db.select().from(s.cashMovement).all()).toEqual([])
  })

  it('wrong PIN, a non-owner approver, no reason, unknown order and double void change nothing', async () => {
    const t = await openReadyApi()
    const sale = await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 })
    t.raw
      .prepare('insert into "user" (id, display_name, role, pin_hash, is_active, created_at, updated_at, version) values (?, ?, ?, ?, 1, ?, ?, 1)')
      .run('staff-1', 'พนักงาน', 'staff', await hashPin('3333', TEST_PIN_COST), t.clock.now(), t.clock.now())
    const before = counts(t)
    await expect(t.api.voidOrder(voidInput(t, sale.orderId, { approverPin: '9999' }))).rejects.toThrow(/^PIN_WRONG: /)
    await expect(t.api.voidOrder(voidInput(t, sale.orderId, { approverUserId: 'staff-1', approverPin: '3333' }))).rejects.toThrow(/^NOT_OWNER: /)
    await expect(t.api.voidOrder(voidInput(t, sale.orderId, { reason: '  ' }))).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.voidOrder(voidInput(t, 'nope'))).rejects.toThrow(/^ORDER_NOT_FOUND: /)
    expect(counts(t)).toEqual(before)
    await t.api.voidOrder(voidInput(t, sale.orderId))
    await expect(t.api.voidOrder(voidInput(t, sale.orderId))).rejects.toThrow(/^VOID_NOT_ALLOWED: /)
  })

  it('the signed-in owner may approve their own void, but only by typing their own PIN again (D50 Q3-22)', async () => {
    const t = await openReadyApi()
    const sale = await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 })
    const self = { approverUserId: t.owner.id } // actorUserId is t.owner.id too (voidInput)
    await expect(t.api.voidOrder(voidInput(t, sale.orderId, { ...self, approverPin: '' }))).rejects.toThrow(/^PIN_WRONG: /)
    await expect(t.api.voidOrder(voidInput(t, sale.orderId, { ...self, approverPin: PINS.DCm }))).rejects.toThrow(/^PIN_WRONG: /)
    const detail = await t.api.voidOrder(voidInput(t, sale.orderId, { ...self, approverPin: PINS.TungAo }))
    expect(detail.events.find((e) => e.type === 'VOIDED')!.payload).toMatchObject({ approvedBy: t.owner.id, reason: 'กดผิดเมนู' })
  })

  it('cannot void an order of a closed shift (D47 ข้อ 2 · Q3-13)', async () => {
    const t = await openReadyApi()
    const sale = await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 })
    t.raw.prepare("update shift set status = 'closed', closed_at = ?, closed_by = ? where id = ?").run(t.clock.now(), t.owner.id, t.shift.id)
    t.clock.set('2026-09-18T03:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await expect(t.api.voidOrder(voidInput(t, sale.orderId))).rejects.toThrow(/^VOID_NOT_ALLOWED: /)
  })

  it('a void keeps the order and its receipt number; the next sale takes the next number (spec §4.3, §4.7)', async () => {
    const t = await openReadyApi()
    const first = await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 })
    await t.api.voidOrder(voidInput(t, first.orderId))
    const next = await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 })
    expect(next.receiptNo).toBe('A-000002')
    expect((await t.api.listOrders()).map((o) => [o.receiptNo, o.status])).toEqual([['A-000002', 'paid'], ['A-000001', 'voided']])
  })
})
