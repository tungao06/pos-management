import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { CashMovementRowData, OrderRowData, ShiftOpenRowData } from '@dayo/contracts'
import { PosError } from '../src/api/errors'
import { createPosApi } from '../src/api/pos-api'
import { createDayoPacer, SYNC_BUDGET_PER_MIN } from '../src/sync/scheduler'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'
import { createTestLocks } from './helpers/locks'
import { defaultUnitId, itemId } from './helpers/stock'

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
    // dayo keeps ONE shift and ONE movement: the second send of the same keys added nothing
    expect(t.mock.shifts()).toHaveLength(1)
    expect(t.mock.movements()).toHaveLength(1)
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

describe('Task 11 fix round 1', () => {
  type Api = Awaited<ReturnType<typeof openConnectedApi>>
  const receiveFromDrawer = async (t: Api, supplier: string) =>
    t.api.receivePurchase({
      actorUserId: STAFF.TungAo, supplier, note: '', paidFromDrawer: true, acceptPriceJump: true,
      lines: [{ itemId: await itemId(t, 'RM-TEA-01'), purchaseUnitId: await defaultUnitId(t, 'RM-TEA-01'), qtyUnitsMilli: 1_000, lineTotalSatang: 7_700 }],
    })

  it('receivePurchase paid from the drawer of a central shift queues its PAID_OUT under the shift_open', async () => {
    const t = await openConnectedApi({ block3: true })
    const p = await receiveFromDrawer(t, 'แม็คโคร')
    const [row] = await outboxOf(t, 'cash_movement')
    expect(row).toMatchObject({ status: 'pending', idempotencyKey: `cash_movement:${p.cashMovementId}`, parentKey: `shift_open:${t.shift.id}` })
    const data = CashMovementRowData.parse(row!.rowJson)
    expect(data).toMatchObject({ kind: 'PAID_OUT', amount: 77, pos_order_id: null, shift_id: t.shift.id })
    expect(data.reason).toMatch(/^รับของ/)
  })

  it('receivePurchase paid from the drawer of a local_only shift stays local_only', async () => {
    const t = await openConnectedApi({ block3: false })
    const p = await receiveFromDrawer(t, 'แม็คโคร')
    const [row] = await outboxOf(t, 'cash_movement')
    expect(row).toMatchObject({ status: 'local_only', idempotencyKey: `cash_movement:${p.cashMovementId}`, parentKey: null })
  })

  it('a supplier dayo would refuse (control character) is BAD_INPUT in both modes, before anything is written', async () => {
    for (const block3 of [true, false]) {
      const t = await openConnectedApi({ block3 })
      await expect(receiveFromDrawer(t, 'แม็ค\u0007โคร')).rejects.toMatchObject({ code: 'BAD_INPUT' })
      expect(await t.db.select().from(s.purchase).all()).toHaveLength(0)
      expect(await t.db.select().from(s.cashMovement).all()).toHaveLength(0)
    }
  })

  it('receivePurchase and cancelSale wake the sender after they commit', async () => {
    const t = await openConnectedApi({ block3: true })
    let wakes = 0
    const api = createPosApi(t.db, { ...t.deps, afterWrite: () => { wakes++ } }, { locks: createTestLocks() })
    const r = await sellCode({ ...t, api }, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    wakes = 0
    await api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'กดผิด', made: false, refundReference: null })
    expect(wakes).toBe(1)
    await receiveFromDrawer({ ...t, api }, 'แม็คโคร')
    expect(wakes).toBe(2)
  })

  it('E1 pull before opening: the per-minute budget is full → no E1 request, the shift opens from the stored E1 (local_only)', async () => {
    const t = await openConnectedApi({ block3: false, openShift: false })
    t.mock.setBlock3(true)                                      // dayo now supports shifts, but the tablet has no room to ask
    const pacer = createDayoPacer()
    const filler = pacer.wrap(async () => new Response(null))
    for (let i = 0; i < SYNC_BUDGET_PER_MIN; i++) await filler('http://budget.test/')
    const api = createPosApi(t.db, t.deps, { locks: createTestLocks(), pacer })
    const before = t.mock.requests().length
    const sh = await api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    expect(t.mock.requests().length).toBe(before)
    expect(sh.syncMode).toBe('local_only')
  })

  it('E1 pull before opening throws → swallowed, the shift still opens from the stored E1', async () => {
    const t = await openConnectedApi({ block3: false, openShift: false })
    t.mock.setBlock3(true)
    const base = t.deps.secrets
    let calls = 0
    // call 1 = isDayoLinked of the pre-pull · call 2 = pullCatalog's own config read (throws) · call 3+ = opening itself
    const secrets = { ...base, getApiKey: async () => { if (++calls === 2) throw new Error('secret store hiccup'); return base.getApiKey() } }
    const api = createPosApi(t.db, { ...t.deps, secrets }, { locks: createTestLocks() })
    const before = t.mock.requests().length
    const sh = await api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    expect(calls).toBeGreaterThanOrEqual(3)
    expect(t.mock.requests().length).toBe(before)
    expect(sh.syncMode).toBe('local_only')
  })

  describe('a clock stepped back after opening never stamps a cash row before its shift opened (dayo 0066:216)', () => {
    it('PAID_OUT', async () => {
      const t = await openConnectedApi({ block3: true })
      t.clock.set('2026-09-25T02:50:00.000Z')                   // 10 minutes before the shift opened
      const m = await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'ซื้อน้ำแข็ง' })
      expect(m.createdAt).toBe(t.shift.openedAt)
      expect(CashMovementRowData.parse((await outboxOf(t, 'cash_movement'))[0]!.rowJson).created_at).toBe(t.shift.openedAt)
    })
    it('receivePurchase PAID_OUT', async () => {
      const t = await openConnectedApi({ block3: true })
      t.clock.set('2026-09-25T02:50:00.000Z')
      await receiveFromDrawer(t, 'แม็คโคร')
      expect(CashMovementRowData.parse((await outboxOf(t, 'cash_movement'))[0]!.rowJson).created_at).toBe(t.shift.openedAt)
    })
    it('VOID_REFUND', async () => {
      const t = await openConnectedApi({ block3: true })
      t.clock.set('2026-09-25T02:50:00.000Z')
      const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
      await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'กดผิด', made: false, refundReference: null })
      const data = CashMovementRowData.parse((await outboxOf(t, 'cash_movement'))[0]!.rowJson)
      expect(data).toMatchObject({ kind: 'VOID_REFUND', created_at: t.shift.openedAt })
      expect(await t.db.select().from(s.cashMovement).all()).toEqual([expect.objectContaining({ createdAt: t.shift.openedAt })])
    })
    it('a clock that did not step back keeps its own time', async () => {
      const t = await openConnectedApi({ block3: true })
      t.clock.set('2026-09-25T04:00:00.000Z')
      const m = await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_IN', amountSatang: 1_000, reason: 'แลกเหรียญ' })
      expect(m.createdAt).toBe('2026-09-25T04:00:00.000Z')
    })
  })
})
