import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { CashMovementRowData, OrderRowData, ShiftOpenRowData } from '@dayo/contracts'
import { PosError } from '../src/api/errors'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

const approve = { approverUserId: STAFF.DCm, approverPin: '2222' }
// Pick<…, 'db'>: the brief's `Awaited<ReturnType<…>>` is the shift-present overload, which a `openShift: false` api is not
const outboxOf = async (t: Pick<Awaited<ReturnType<typeof openConnectedApi>>, 'db'>, kind: string) => t.db.select().from(s.outbox).where(eq(s.outbox.tableName, kind)).all()

describe('central shifts (spec 04 §4.10 ข้อ 4 · ruling R1)', () => {
  it('a shift opened while dayo supports the shift kinds is central and queues shift_open', async () => {
    const t = await openConnectedApi({ block3: true })
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, t.shift.id)).get())?.syncMode).toBe('central')
    const [row] = await outboxOf(t, 'shift_open')
    expect(row).toMatchObject({ status: 'pending', idempotencyKey: `shift_open:${t.shift.id}`, parentKey: null })
    expect(ShiftOpenRowData.parse(row!.rowJson)).toMatchObject({ shift_id: t.shift.id, opening_float: 500, quick_open: false, opened_by: STAFF.TungAo, business_date: '2026-09-25' })
  })
  it('without the shift kinds the shift stays local_only; its rows never queue for push and its bills carry shift_id null', async () => {
    const t = await openConnectedApi({ block3: false })
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, t.shift.id)).get())?.syncMode).toBe('local_only')
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'shift')).get())?.status).toBe('local_only')
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    expect(OrderRowData.parse((await outboxOf(t, 'order')).find((x) => x.idempotencyKey === `order:${r.orderId}`)!.rowJson).shift_id).toBeNull()
  })
  it('a bill of a central shift carries its shift_id', async () => {
    const t = await openConnectedApi({ block3: true })
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    expect(OrderRowData.parse((await outboxOf(t, 'order')).find((x) => x.idempotencyKey === `order:${r.orderId}`)!.rowJson).shift_id).toBe(t.shift.id)
  })
  it('a paid-out goes into the shift lane under its shift_open', async () => {
    const t = await openConnectedApi({ block3: true })
    const m = await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'ซื้อน้ำแข็ง' })
    const [row] = await outboxOf(t, 'cash_movement')
    expect(row).toMatchObject({ status: 'pending', idempotencyKey: `cash_movement:${m.id}`, parentKey: `shift_open:${t.shift.id}` })
    expect(CashMovementRowData.parse(row!.rowJson)).toMatchObject({ kind: 'PAID_OUT', amount: 20, reason: 'ซื้อน้ำแข็ง', pos_order_id: null })
  })
  it('voiding a cash bill queues VOID_REFUND with the bill id and no reason (D36)', async () => {
    const t = await openConnectedApi({ block3: true })
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'กดผิด', made: false, refundReference: null })
    const [row] = await outboxOf(t, 'cash_movement')
    expect(CashMovementRowData.parse(row!.rowJson)).toMatchObject({ kind: 'VOID_REFUND', amount: 45, pos_order_id: r.orderId, reason: null })
  })
  it('quick open queues quick_open: true (D52 Q3b-10)', async () => {
    const t = await openConnectedApi({ block3: true, openShift: false })                     // helper option from Task 6
    const sh = await t.api.quickOpenShift({ userId: STAFF.TungAo })
    const row = (await outboxOf(t, 'shift_open')).find((x) => x.idempotencyKey === `shift_open:${sh.id}`)!
    expect(ShiftOpenRowData.parse(row.rowJson)).toMatchObject({ quick_open: true, opening_float: 0 })
  })
  it('the "ยังไม่ส่ง" badge counts one per shift-lane row (D50 Q3-26)', async () => {
    const t = await openConnectedApi({ block3: true })
    await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_IN', amountSatang: 1_000, reason: 'แลกเหรียญ' })
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    expect(await t.api.bootstrap()).toMatchObject({ pendingSyncItems: 3 })                    // shift_open + cash_movement + 1 bill
  })
  it('R1: opening a shift pulls E1 first, so a dayo that just started supporting shifts is seen (§6.5 "ก่อนเปิดกะ")', async () => {
    const t = await openConnectedApi({ block3: false, openShift: false })   // linked while dayo had no shift kinds
    t.mock.setBlock3(true)                                                  // dayo deploys block 3; the tablet has not pulled E1 since
    const sh = await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, sh.id)).get())?.syncMode).toBe('central')
  })
  it('R1: offline at opening → decided from the last stored E1, never blocked', async () => {
    const t = await openConnectedApi({ block3: false, openShift: false })
    t.mock.setBlock3(true)
    t.mock.setMode('offline')
    const sh = await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, sh.id)).get())?.syncMode).toBe('local_only')
  })
})

describe('central shifts — beyond the plan (Task 11)', () => {
  it('currentOpenShift / bootstrap report the shift sync mode', async () => {
    const central = await openConnectedApi({ block3: true })
    expect(central.shift.syncMode).toBe('central')
    expect((await central.api.bootstrap()).openShift?.syncMode).toBe('central')
    const local = await openConnectedApi({ block3: false })
    expect(local.shift.syncMode).toBe('local_only')
    expect((await local.api.bootstrap()).openShift?.syncMode).toBe('local_only')
  })

  it('local_only shift: paid-out and VOID_REFUND stay local_only rows, never pending', async () => {
    const t = await openConnectedApi({ block3: false })
    await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'ซื้อน้ำแข็ง' })
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'กดผิด', made: false, refundReference: null })
    const rows = await outboxOf(t, 'cash_movement')
    expect(rows).toHaveLength(2)
    expect(rows.every((x) => x.status === 'local_only' && x.parentKey === null)).toBe(true)
    expect(await outboxOf(t, 'shift_open')).toHaveLength(0)
    expect((await t.api.bootstrap()).pendingSyncItems).toBe(1) // the bill only (its void counts with it)
  })

  it('offline: a central shift keeps working — rows are written first and wait in the queue', async () => {
    const t = await openConnectedApi({ block3: true })
    t.mock.setMode('offline')
    const m = await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'DROP', amountSatang: 100_000, reason: 'นำเงินเข้าตู้เซฟ' })
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    await t.api.syncNow()
    expect((await t.db.select().from(s.cashMovement).where(eq(s.cashMovement.id, m.id)).get())?.kind).toBe('DROP')
    const keys = [`shift_open:${t.shift.id}`, `cash_movement:${m.id}`, `order:${r.orderId}`]
    const rows = await t.db.select().from(s.outbox).where(inArray(s.outbox.idempotencyKey, keys)).all()
    expect(rows.map((x) => x.status)).toEqual(['pending', 'pending', 'pending'])
    expect((await t.api.bootstrap()).pendingSyncItems).toBe(3)
  })

  it('back online: shift_open and its paid-out reach dayo; a resend of the same keys is answered the same (idempotent)', async () => {
    const t = await openConnectedApi({ block3: true })
    const m = await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'ซื้อน้ำแข็ง' })
    const keys = [`shift_open:${t.shift.id}`, `cash_movement:${m.id}`]
    const statuses = async () => (await t.db.select().from(s.outbox).where(inArray(s.outbox.idempotencyKey, keys)).all()).map((x) => x.status)
    await t.api.syncNow()
    expect(await statuses()).toEqual(['sent', 'sent'])
    expect((await t.api.bootstrap()).pendingSyncItems).toBe(0)
    // the tablet lost its "sent" marks (e.g. a crash before the answer was written) and sends the same rows again
    await t.db.update(s.outbox).set({ status: 'pending', sentAt: null, resultJson: null }).where(inArray(s.outbox.idempotencyKey, keys))
    await t.api.syncNow()
    expect(await statuses()).toEqual(['sent', 'sent'])
  })

  it('R2: a shift of this device still counting refuses a new shift (COUNT_PENDING) — nothing written', async () => {
    const t = await openConnectedApi({ block3: true })
    await t.db.update(s.shift).set({ status: 'counting', countedAt: '2026-09-25T03:30:00.000Z' }).where(eq(s.shift.id, t.shift.id))
    const before = (await t.db.select().from(s.outbox).all()).length
    await expect(t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 0 })).rejects.toMatchObject({ code: 'COUNT_PENDING', message: expect.stringContaining(t.shift.id) })
    await expect(t.api.quickOpenShift({ userId: STAFF.TungAo })).rejects.toBeInstanceOf(PosError)
    expect((await t.db.select().from(s.shift).all()).length).toBe(1)
    expect((await t.db.select().from(s.outbox).all()).length).toBe(before)
  })

  it('a bad paid-out never leaves half a write behind (builder refusal rolls back the movement)', async () => {
    const t = await openConnectedApi({ block3: true })
    await expect(t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'ซื้อ\u0007น้ำแข็ง' })).rejects.toMatchObject({ code: 'BAD_INPUT' })
    expect(await t.db.select().from(s.cashMovement).all()).toHaveLength(0)
    expect(await outboxOf(t, 'cash_movement')).toHaveLength(0)
  })
})
