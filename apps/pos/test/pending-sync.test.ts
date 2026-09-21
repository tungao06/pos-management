import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { countPendingSyncItems } from '../src/api/bootstrap'
import { enqueueOutbox } from '../src/db/outbox'
import { openTestDb, sequentialIds } from './helpers/db'

const AT = '2026-09-17T03:00:00.000Z'

describe('countPendingSyncItems (D50 Q3-26: bills, not outbox rows)', () => {
  it('counts one per bill however many rows the bill queued, and one per non-order record', async () => {
    const { db } = await openTestDb()
    const newId = sequentialIds('ob')
    expect(await countPendingSyncItems(db)).toBe(0)

    // An open shift: one record (open and close rows of the same shift still count once).
    await enqueueOutbox(db, 'shift', { id: 'sh-1', status: 'open' }, AT, newId)
    await enqueueOutbox(db, 'shift', { id: 'sh-1', status: 'closed' }, AT, newId, 'closed')
    expect(await countPendingSyncItems(db)).toBe(1)

    // Bill o-1: every row that belongs to it counts as the same bill.
    await enqueueOutbox(db, 'order', { id: 'o-1' }, AT, newId)
    await enqueueOutbox(db, 'order_line', { id: 'ol-1', orderId: 'o-1' }, AT, newId)
    await enqueueOutbox(db, 'order_line', { id: 'ol-2', orderId: 'o-1' }, AT, newId)
    await enqueueOutbox(db, 'discount', { id: 'd-1', orderId: 'o-1' }, AT, newId)
    await enqueueOutbox(db, 'payment', { id: 'p-1', orderId: 'o-1' }, AT, newId)
    await enqueueOutbox(db, 'order_event', { id: 'e-1', orderId: 'o-1' }, AT, newId)
    await enqueueOutbox(db, 'order_event', { id: 'e-2', orderId: 'o-1' }, AT, newId)
    await enqueueOutbox(db, 'stock_movement', { id: 'm-1', refType: 'order', refId: 'o-1' }, AT, newId)
    await enqueueOutbox(db, 'stock_movement', { id: 'm-2', refType: 'order', refId: 'o-1' }, AT, newId)
    expect(await countPendingSyncItems(db)).toBe(2)

    // Voiding o-1 queues more rows for the same bill (order re-sent, refund, return movements).
    await enqueueOutbox(db, 'order', { id: 'o-1', status: 'voided' }, AT, newId, 'voided')
    await enqueueOutbox(db, 'cash_movement', { id: 'c-1', kind: 'VOID_REFUND', orderId: 'o-1' }, AT, newId)
    expect(await countPendingSyncItems(db)).toBe(2)

    // A second bill and a stand-alone cash movement / stock movement are one item each.
    await enqueueOutbox(db, 'order_event', { id: 'e-3', orderId: 'o-2' }, AT, newId)
    await enqueueOutbox(db, 'cash_movement', { id: 'c-2', kind: 'PAID_IN', orderId: null }, AT, newId)
    await enqueueOutbox(db, 'stock_movement', { id: 'm-3', refType: 'test', refId: 'batch-1' }, AT, newId)
    expect(await countPendingSyncItems(db)).toBe(5)
  })

  it('ignores rows that are no longer pending', async () => {
    const { db } = await openTestDb()
    const newId = sequentialIds('ob')
    await enqueueOutbox(db, 'order', { id: 'o-1' }, AT, newId)
    await enqueueOutbox(db, 'order_line', { id: 'ol-1', orderId: 'o-1' }, AT, newId)
    await enqueueOutbox(db, 'shift', { id: 'sh-1' }, AT, newId)
    await db.update(s.outbox).set({ status: 'sent', sentAt: AT }).where(eq(s.outbox.tableName, 'shift'))
    expect(await countPendingSyncItems(db)).toBe(1)
    await db.update(s.outbox).set({ status: 'dead', deadAt: AT, lastError: 'x' }).where(eq(s.outbox.idempotencyKey, 'order:o-1'))
    expect(await countPendingSyncItems(db)).toBe(1) // o-1 still has a pending line
    await db.update(s.outbox).set({ status: 'sent', sentAt: AT }).where(eq(s.outbox.tableName, 'order_line'))
    expect(await countPendingSyncItems(db)).toBe(0)
  })
})

describe('countPendingSyncItems — stock documents (plan 4 T4-8)', () => {
  it('a purchase, a production batch, a stock count and an adjustment are one item each with their lines and movements', async () => {
    const { db } = await openTestDb()
    const newId = sequentialIds('ob')
    await enqueueOutbox(db, 'purchase', { id: 'pu-1' }, AT, newId)
    await enqueueOutbox(db, 'purchase_line', { id: 'pl-1', purchaseId: 'pu-1' }, AT, newId)
    await enqueueOutbox(db, 'purchase_line', { id: 'pl-2', purchaseId: 'pu-1' }, AT, newId)
    await enqueueOutbox(db, 'stock_movement', { id: 'm-1', refType: 'purchase', refId: 'pu-1' }, AT, newId)
    await enqueueOutbox(db, 'stock_movement', { id: 'm-2', refType: 'purchase', refId: 'pu-1' }, AT, newId)
    expect(await countPendingSyncItems(db)).toBe(1)

    await enqueueOutbox(db, 'production_batch', { id: 'pb-1' }, AT, newId)
    await enqueueOutbox(db, 'stock_movement', { id: 'm-3', refType: 'production_batch', refId: 'pb-1' }, AT, newId)
    await enqueueOutbox(db, 'stock_movement', { id: 'm-4', refType: 'production_batch', refId: 'pb-1' }, AT, newId)
    expect(await countPendingSyncItems(db)).toBe(2)

    await enqueueOutbox(db, 'stock_count', { id: 'sc-1', status: 'open' }, AT, newId)
    await enqueueOutbox(db, 'stock_count_line', { id: 'scl-1', countId: 'sc-1' }, AT, newId)
    await enqueueOutbox(db, 'stock_movement', { id: 'm-5', refType: 'stock_count', refId: 'sc-1' }, AT, newId)
    await enqueueOutbox(db, 'stock_count', { id: 'sc-1', status: 'closed' }, AT, newId, 'closed')
    expect(await countPendingSyncItems(db)).toBe(3)

    await enqueueOutbox(db, 'stock_adjustment', { id: 'sa-1' }, AT, newId)
    await enqueueOutbox(db, 'stock_movement', { id: 'm-6', refType: 'stock_adjustment', refId: 'sa-1' }, AT, newId)
    expect(await countPendingSyncItems(db)).toBe(4)
  })

  it('a receipt paid from the drawer is 2 items: the purchase (with its lines and movements) and the paid-out cash record (Task 4 · m-4)', async () => {
    const { db } = await openTestDb()
    const newId = sequentialIds('ob')
    await enqueueOutbox(db, 'purchase', { id: 'pu-2' }, AT, newId)
    await enqueueOutbox(db, 'purchase_line', { id: 'pl-3', purchaseId: 'pu-2' }, AT, newId)
    await enqueueOutbox(db, 'stock_movement', { id: 'm-7', refType: 'purchase', refId: 'pu-2' }, AT, newId)
    await enqueueOutbox(db, 'cash_movement', { id: 'c-3', kind: 'PAID_OUT', orderId: null }, AT, newId)
    expect(await countPendingSyncItems(db)).toBe(2)
  })

  it('m-2: a row missing the field its branch reads still counts once, instead of vanishing into a NULL group key', async () => {
    const { db } = await openTestDb()
    const newId = sequentialIds('ob')
    // a hypothetical trimmed purchase_line row without purchaseId, the field that branch reads — every real writer
    // today sends the full row (purchaseId is NOT NULL in the schema), but the badge must never silently undercount
    // if that ever changes.
    await enqueueOutbox(db, 'purchase_line', { id: 'pl-9' }, AT, newId)
    expect(await countPendingSyncItems(db)).toBe(1)
  })
})
