import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import type { OrderRowData, OrderVoidRowData } from '@dayo/contracts'
import { countPendingSyncItems, countSyncProblems } from '../src/api/bootstrap'
import { enqueueLocalOnly, enqueuePush } from '../src/db/outbox'
import { openTestDb, sequentialIds } from './helpers/db'

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
