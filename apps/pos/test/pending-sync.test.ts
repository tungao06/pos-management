import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import type { CashCountRowData, CashMovementRowData, OrderOffCatalogRowData, OrderRowData, OrderVoidRowData, ShiftCloseRowData, ShiftOpenRowData } from '@dayo/contracts'
import { countPendingSyncItems, countSyncProblems } from '../src/api/bootstrap'
import { countParentKey, enqueueLocalOnly, enqueuePush, type PushRowInput, shiftParentKey } from '../src/db/outbox'
import { openTestApi, openTestDb, sequentialIds } from './helpers/db'

const AT = '2026-09-25T03:00:00.000Z'
const O1 = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21'
const O2 = '5e4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c'
const STAFF = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'
const OWNER = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d'

function orderData(id: string, receiptNo: string): OrderRowData {
  return {
    pos_order_id: id, receipt_no: receiptNo, queue_no: 1, sale_date: '2026-09-25', sold_at: AT, channel: 'store', payment: 'cash',
    staff_id: STAFF, catalog_version: 42, shift_id: null,
    lines: [{ code: 'Cocoa', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1 }],
    bill_discount: null, promo_code: null, skip_promotion_ids: [], no_promotions: false,
    totals: { items_subtotal: 45, items_discount: 0, bill_discount: 0, total: 45 }, note: null,
  }
}
function voidData(id: string): OrderVoidRowData {
  return { pos_order_id: id, voided_at: '2026-09-25T03:05:00.000Z', staff_id: STAFF, approved_by: OWNER, reason: 'กดผิดเมนู' }
}

// block 3 rows (spec 04 §4.10) — the same shapes as the contracts samples
const SH = '5a5a5a5a-0000-4000-8000-000000000001'
const MV = '6b6b6b6b-0000-4000-8000-000000000001'
const CC = '7c7c7c7c-0000-4000-8000-000000000001'
const SAMPLE_SHIFT_OPEN: ShiftOpenRowData = { shift_id: SH, business_date: '2026-09-25', opened_at: '2026-09-25T02:00:00.000Z', opened_by: OWNER, opening_float: 500, quick_open: false }
const SAMPLE_MOVEMENT: CashMovementRowData = { movement_id: MV, shift_id: SH, kind: 'PAID_OUT', amount: 20, pos_order_id: null, reason: 'ซื้อน้ำแข็ง', created_by: STAFF, created_at: '2026-09-25T04:00:00.000Z' }
const SAMPLE_COUNT: CashCountRowData = {
  count_id: CC, shift_id: SH, counted: 615, counted_by: OWNER, counted_at: '2026-09-25T12:00:00.000Z',
  lines: [1000, 500, 100, 50, 20, 10, 5, 2, 1].map((d) => ({ denomination: d, count: [500, 100, 10, 5].includes(d) ? 1 : 0 })),
}
const SAMPLE_CLOSE: ShiftCloseRowData = {
  shift_id: SH, count_id: CC, closed_by: OWNER, closed_at: '2026-09-25T12:05:00.000Z', variance_reason: null,
  z_report: {
    z_no: 1, hash: 'ab'.repeat(32), prev_hash: null, variance_alert: 20, chain_warning: false,
    cash: { opening_float: 500, pos_cash_sales: 45, void_refunds: 0, paid_in: 0, paid_out: 0, drops: 0, drawer_expenses: 0, bot_cash: 70 },
    counted: 615, bot_window: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:00.000Z' }, movement_ids: [],
    bot_bills: [{ order_no: 'L260925-901', version: 1, total: 70 }],
    pos_bills: [{ pos_order_id: O1, receipt_no: 'A-000001', payment: 'cash', total: 45, sold_at: AT, voided_at: null }],
  },
}
const SAMPLE_OFF_CATALOG: OrderOffCatalogRowData = {
  pos_order_id: O2, receipt_no: 'A-000002', queue_no: 2, sale_date: '2026-09-25', sold_at: AT, channel: 'store', payment: 'cash',
  staff_id: STAFF, catalog_version: 42, shift_id: SH, note: null,
  lines: [{ code: 'Thai Tea', name: 'ชาไทย', size: '16 oz', sweetness: '50%', qty: 3, unit_price: 35, discount_per_cup: 0, line_total: 105 }],
  totals: { items_subtotal: 105, items_discount: 0, bill_discount: 35, total: 70 }, closed_by: OWNER, closed_at: '2026-09-26T02:00:00.000Z', reason: 'เมนูถูกลบ', original_reason: 'UNKNOWN_CODE',
}

describe('enqueueLocalOnly (spec 04 §6.1 block 2: shift/cash/count/Z stay on the tablet)', () => {
  it('keys rows as <table>:<id>[:suffix], status local_only, and never counts them as waiting to send', async () => {
    const { db } = await openTestDb()
    const newId = sequentialIds()
    await enqueueLocalOnly(db, 'shift', { id: 'sh-1', status: 'open' }, AT, newId)
    await enqueueLocalOnly(db, 'shift', { id: 'sh-1', status: 'closed' }, AT, newId, 'closed')
    await enqueueLocalOnly(db, 'cash_movement', { id: 'c-1', kind: 'VOID_REFUND', orderId: O1 }, AT, newId)
    await enqueueLocalOnly(db, 'cash_count', { id: 'cc-1' }, AT, newId)
    await enqueueLocalOnly(db, 'z_report', { id: 'z-1' }, AT, newId)
    const rows = await db.select().from(s.outbox).all()
    expect(rows.map((r) => [r.idempotencyKey, r.status, r.parentKey])).toEqual([
      ['shift:sh-1', 'local_only', null], ['shift:sh-1:closed', 'local_only', null], ['cash_movement:c-1', 'local_only', null],
      ['cash_count:cc-1', 'local_only', null], ['z_report:z-1', 'local_only', null],
    ])
    expect(rows[1]!.rowJson).toEqual({ id: 'sh-1', status: 'closed' })
    expect(await countPendingSyncItems(db)).toBe(0)
    expect(await countSyncProblems(db)).toBe(0)
    await expect(enqueueLocalOnly(db, 'shift', { id: 'sh-1' }, AT, newId)).rejects.toThrow() // the same key twice
  })
})

describe('enqueuePush (spec 04 §6.1: one E2 row per bill, one per void)', () => {
  it('stores the E2 data ready to send under <kind>:<pos_order_id>; order_void waits for its order', async () => {
    const { db } = await openTestDb()
    const newId = sequentialIds()
    await enqueuePush(db, { kind: 'order', id: O1, data: orderData(O1, 'A-000001'), parentKey: null }, AT, newId)
    await enqueuePush(db, { kind: 'order_void', id: O1, data: voidData(O1), parentKey: `order:${O1}` }, AT, newId)
    const rows = await db.select().from(s.outbox).all()
    expect(rows.map((r) => [r.tableName, r.idempotencyKey, r.status, r.parentKey, r.attempts, r.nextAttemptAt, r.resultJson])).toEqual([
      ['order', `order:${O1}`, 'pending', null, 0, null, null],
      ['order_void', `order_void:${O1}`, 'pending', `order:${O1}`, 0, null, null],
    ])
    expect(rows[0]!.rowJson).toEqual(orderData(O1, 'A-000001')) // money already baht (spec §6.1)
    expect(rows[1]!.rowJson).toEqual(voidData(O1))
  })

  it('a malformed row fails the write — never the queue — and writes nothing; a key is never reused', async () => {
    const { db } = await openTestDb()
    const newId = sequentialIds()
    await expect(enqueuePush(db, { kind: 'order', id: O1, data: { ...orderData(O1, 'A-000001'), sale_date: '2026-09-26' }, parentKey: null }, AT, newId)).rejects.toThrow()
    await expect(enqueuePush(db, { kind: 'order_void', id: O1, data: { ...voidData(O1), reason: '' }, parentKey: `order:${O1}` }, AT, newId)).rejects.toThrow()
    expect(await db.select().from(s.outbox).all()).toEqual([])
    await enqueuePush(db, { kind: 'order', id: O1, data: orderData(O1, 'A-000001'), parentKey: null }, AT, newId)
    await expect(enqueuePush(db, { kind: 'order', id: O1, data: orderData(O1, 'A-000001'), parentKey: null }, AT, newId)).rejects.toThrow()
    expect(await db.select().from(s.outbox).all()).toHaveLength(1)
  })
})

describe('enqueuePush block 3 (spec 04 §4.10 · §6.2: seven kinds, the shift lane waits on its parents)', () => {
  const rows: PushRowInput[] = [
    { kind: 'order', id: O1, data: orderData(O1, 'A-000001'), parentKey: null },
    { kind: 'shift_open', id: SH, data: SAMPLE_SHIFT_OPEN, parentKey: null },
    { kind: 'cash_movement', id: MV, data: SAMPLE_MOVEMENT, parentKey: shiftParentKey(SH) },
    { kind: 'cash_count', id: CC, data: SAMPLE_COUNT, parentKey: shiftParentKey(SH) },
    { kind: 'shift_close', id: SH, data: SAMPLE_CLOSE, parentKey: countParentKey(CC) },
    { kind: 'order_void', id: O1, data: voidData(O1), parentKey: `order:${O1}` },
    { kind: 'order_off_catalog', id: O2, data: SAMPLE_OFF_CATALOG, parentKey: null },
  ]
  it('stores every kind under <kind>:<its id field> with table_name = kind and the parent it waits for', async () => {
    const { db } = await openTestDb()
    const newId = sequentialIds()
    for (const row of rows) await enqueuePush(db, row, AT, newId)
    const stored = await db.select().from(s.outbox).all()
    expect(stored.map((r) => [r.tableName, r.idempotencyKey, r.status, r.parentKey])).toEqual([
      ['order', `order:${O1}`, 'pending', null],
      ['shift_open', `shift_open:${SH}`, 'pending', null],
      ['cash_movement', `cash_movement:${MV}`, 'pending', `shift_open:${SH}`],
      ['cash_count', `cash_count:${CC}`, 'pending', `shift_open:${SH}`],
      ['shift_close', `shift_close:${SH}`, 'pending', `cash_count:${CC}`],
      ['order_void', `order_void:${O1}`, 'pending', `order:${O1}`],
      ['order_off_catalog', `order_off_catalog:${O2}`, 'pending', null],
    ])
    expect(stored.map((r) => r.rowJson)).toEqual(rows.map((r) => r.data)) // the E2 data as built, money in baht
    // a retry of the same save never makes a second row (the key is the idempotency key)
    for (const row of rows) await expect(enqueuePush(db, row, AT, newId)).rejects.toThrow()
    expect(await db.select().from(s.outbox).all()).toHaveLength(rows.length)
  })

  it('enqueuePush refuses a row whose key does not match the kind id field (it is a tablet bug — the save fails, the queue does not)', async () => {
    const t = await openTestApi()
    const bad = { kind: 'cash_movement' as const, id: 'wrong-id', data: SAMPLE_MOVEMENT, parentKey: 'shift_open:x' }
    await expect(t.db.transaction((tx) => enqueuePush(tx, bad, t.clock.now(), t.deps.newId))).rejects.toThrow()
    expect(await t.db.select().from(s.outbox).all()).toEqual([])
  })

  it('also when the wrong id is a well-formed uuid of another row, or the data breaks its kind rules', async () => {
    const { db } = await openTestDb()
    const newId = sequentialIds()
    await expect(enqueuePush(db, { kind: 'cash_movement', id: SH, data: SAMPLE_MOVEMENT, parentKey: shiftParentKey(SH) }, AT, newId)).rejects.toThrow()
    await expect(enqueuePush(db, { kind: 'shift_close', id: CC, data: SAMPLE_CLOSE, parentKey: countParentKey(CC) }, AT, newId)).rejects.toThrow()
    await expect(enqueuePush(db, { kind: 'cash_count', id: CC, data: { ...SAMPLE_COUNT, counted: 614 }, parentKey: shiftParentKey(SH) }, AT, newId)).rejects.toThrow()
    await expect(enqueuePush(db, { kind: 'cash_movement', id: MV, data: { ...SAMPLE_MOVEMENT, reason: null }, parentKey: shiftParentKey(SH) }, AT, newId)).rejects.toThrow()
    const sneaky = { ...SAMPLE_MOVEMENT, amount_satang: 2000 } as unknown as CashMovementRowData // strict objects: no extra key
    await expect(enqueuePush(db, { kind: 'cash_movement', id: MV, data: sneaky, parentKey: shiftParentKey(SH) }, AT, newId)).rejects.toThrow()
    // the parent comes from the row's own data (spec 04 §4.10 table) — a mislinked row would wait on the wrong row forever
    await expect(enqueuePush(db, { kind: 'cash_movement', id: MV, data: SAMPLE_MOVEMENT, parentKey: shiftParentKey(O1) }, AT, newId)).rejects.toThrow(/parent/)
    await expect(enqueuePush(db, { kind: 'cash_count', id: CC, data: SAMPLE_COUNT, parentKey: countParentKey(CC) }, AT, newId)).rejects.toThrow(/parent/)
    await expect(enqueuePush(db, { kind: 'shift_close', id: SH, data: SAMPLE_CLOSE, parentKey: shiftParentKey(SH) }, AT, newId)).rejects.toThrow(/parent/)
    await expect(enqueuePush(db, { kind: 'order_void', id: O1, data: voidData(O1), parentKey: `order:${O2}` }, AT, newId)).rejects.toThrow(/parent/)
    expect(await db.select().from(s.outbox).all()).toEqual([])
    // an off-catalog bill is the parent of its void too (spec 04 §4.10)
    await enqueuePush(db, { kind: 'order_void', id: O1, data: voidData(O1), parentKey: `order_off_catalog:${O1}` }, AT, newId)
    expect((await db.select().from(s.outbox).all()).map((r) => r.parentKey)).toEqual([`order_off_catalog:${O1}`])
  })
})

describe('countPendingSyncItems / countSyncProblems (D50 Q3-26: bills, not outbox rows)', () => {
  it('an order and its order_void count once; sent rows and local_only rows never count', async () => {
    const { db } = await openTestDb()
    const newId = sequentialIds()
    await enqueueLocalOnly(db, 'shift', { id: 'sh-1' }, AT, newId)
    await enqueuePush(db, { kind: 'order', id: O1, data: orderData(O1, 'A-000001'), parentKey: null }, AT, newId)
    expect(await countPendingSyncItems(db)).toBe(1)
    await enqueuePush(db, { kind: 'order_void', id: O1, data: voidData(O1), parentKey: `order:${O1}` }, AT, newId)
    await enqueueLocalOnly(db, 'cash_movement', { id: 'c-1', kind: 'VOID_REFUND', orderId: O1 }, AT, newId)
    expect(await countPendingSyncItems(db)).toBe(1) // one bill, two E2 rows
    await enqueuePush(db, { kind: 'order', id: O2, data: orderData(O2, 'A-000002'), parentKey: null }, AT, newId)
    expect(await countPendingSyncItems(db)).toBe(2)

    await db.update(s.outbox).set({ status: 'sent', sentAt: AT }).where(eq(s.outbox.idempotencyKey, `order:${O1}`))
    expect(await countPendingSyncItems(db)).toBe(2) // O1's void is still to send
    await db.update(s.outbox).set({ status: 'sent', sentAt: AT }).where(eq(s.outbox.idempotencyKey, `order_void:${O1}`))
    expect(await countPendingSyncItems(db)).toBe(1)
    expect(await countSyncProblems(db)).toBe(0)
  })

  it('dead rows are problems, counted per bill, and no longer waiting', async () => {
    const { db } = await openTestDb()
    const newId = sequentialIds()
    await enqueuePush(db, { kind: 'order', id: O1, data: orderData(O1, 'A-000001'), parentKey: null }, AT, newId)
    await enqueuePush(db, { kind: 'order_void', id: O1, data: voidData(O1), parentKey: `order:${O1}` }, AT, newId)
    await enqueuePush(db, { kind: 'order', id: O2, data: orderData(O2, 'A-000002'), parentKey: null }, AT, newId)
    await db.update(s.outbox).set({ status: 'dead', deadAt: AT, lastError: 'x' }).where(eq(s.outbox.tableName, 'order'))
    await db.update(s.outbox).set({ status: 'dead', deadAt: AT, lastError: 'x' }).where(eq(s.outbox.tableName, 'order_void'))
    expect(await countSyncProblems(db)).toBe(2) // O1 (order + void) once, O2 once
    expect(await countPendingSyncItems(db)).toBe(0)
  })
})
