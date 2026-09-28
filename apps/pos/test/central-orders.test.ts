import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import type { CentralOrder } from '@dayo/contracts'
import { posErrorCode } from '../src/api/errors'
import { pushOnce } from '../src/sync/push'
import { DAYO_KEYS, readKey } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

const bill = (o: Partial<CentralOrder> & { order_no: string }): CentralOrder => ({
  sale_date: '2026-09-25', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'store', payment: 'cash',
  totals: { items_subtotal: 45, items_discount: 0, bill_discount: 0, total: 45, fee: 0 }, amount_mismatch: false, updated_at: null,
  sold_at: '2026-09-25T02:50:00+00:00', created_by_name: 'DCm', duplicate_suspect: false, ...o,
})

describe('bot/web bills of today (spec 04 §4.6, §4.7)', () => {
  it('lists today\'s bot and web bills newest first, labelled in Thai, without POS bills or other days', async () => {
    const t = await openConnectedApi()
    t.mock.seedCentralOrders([
      bill({ order_no: 'L260925-013', source: 'line', sold_at: '2026-09-25T02:50:00+00:00', duplicate_suspect: true }),
      bill({ order_no: 'L260925-015', source: 'web', sold_at: '2026-09-25T02:55:00+00:00', created_by_name: 'TungAo' }),
      bill({ order_no: 'L260924-001', sale_date: '2026-09-24', sold_at: '2026-09-24T05:00:00+00:00' }),
      bill({ order_no: 'L260925-016', source: 'pos', pos_receipt_no: 'A-000009' }),
    ])
    const got = await t.api.listCentralOrdersToday()
    expect(got.map((o) => [o.orderNo, o.sourceLabel, o.createdByName, o.totalSatang, o.duplicateSuspect])).toEqual([
      ['L260925-015', 'เว็บ', 'TungAo', 4500, false],
      ['L260925-013', 'บอท', 'DCm', 4500, true],
    ])
  })
  it('offline is a clear error, and a revoked key makes no request at all', async () => {
    const t = await openConnectedApi()
    t.mock.setMode('unauthorized')
    try { await t.api.listCentralOrdersToday(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('OFFLINE') }
    const calls = t.mock.requests().length
    try { await t.api.listCentralOrdersToday(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('OFFLINE') }
    expect(t.mock.requests().length).toBe(calls) // review item 14: 401 stops E3 too
  })
  it('the tablet being offline is OFFLINE, not a crash', async () => {
    const t = await openConnectedApi()
    t.deps.fetch = async () => { throw new TypeError('Failed to fetch') }
    try { await t.api.listCentralOrdersToday(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('OFFLINE') }
  })
  it('a sale is not blocked while the bot/web list waits on a hung request (network outside the queue)', async () => {
    const t = await openConnectedApi()
    const inner = t.deps.fetch
    let onWire!: () => void
    const wire = new Promise<void>((r) => { onWire = r })
    t.deps.fetch = (input, init) => {
      if (!String(input).includes('/api/v1/orders')) return inner(input, init)
      onWire()
      return new Promise<Response>((_, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))) })
    }
    const list = t.api.listCentralOrdersToday()
    void list.catch(() => undefined)
    await wire
    const started = Date.now()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    expect(Date.now() - started).toBeLessThan(2_000)
  })
  it('E3 has its own cap under dayo\'s 60/min: past it, no request is made', async () => {
    const t = await openConnectedApi()
    for (let i = 0; i < 3; i++) await t.api.listCentralOrdersToday()
    const calls = t.mock.requests().length
    try { await t.api.listCentralOrdersToday(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('OFFLINE') }
    expect(t.mock.requests().length).toBe(calls)
  })
})

describe('dayo_edit — the owner\'s edit/cancel of a POS bill on the dayo web, read only (spec 04 §4.6 · O1 pending)', () => {
  async function sentBill() {
    const t = await openConnectedApi()
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
    t.mock.setNow('2026-09-25T03:05:00.000Z') // the owner edits it five minutes later
    return { t, r }
  }

  it('an edit shows on the bill with its reason; the money collected here never changes', async () => {
    const { t, r } = await sentBill()
    t.mock.editPosOrder(r.orderId, { kind: 'edit', reason: 'ลูกค้าเปลี่ยนเมนู', totals: { total: 50 } })
    expect(await t.api.refreshDayoEdits()).toEqual({ updated: 1 })
    const d = await t.api.getOrder(r.orderId)
    expect(d.dayoEdit).toEqual({ kind: 'edit', editedAt: '2026-09-25T03:05:00+00:00', editedByName: 'TungAo', reason: 'ลูกค้าเปลี่ยนเมนู', version: 2 })
    expect(d).toMatchObject({ totalSatang: 4500, status: 'paid', voidable: true })
    expect((await t.api.listOrders())[0]?.dayoEdit?.kind).toBe('edit')
    const audit = await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'dayo_edit_seen')).all()
    expect(audit).toEqual([expect.objectContaining({ entity: 'order', entityId: r.orderId, beforeJson: null })])
  })
  it('a second refresh asks only for bills changed since the last one, and writes nothing new', async () => {
    const { t, r } = await sentBill()
    t.mock.editPosOrder(r.orderId, { kind: 'edit', reason: 'x' })
    const urls: string[] = []
    const inner = t.deps.fetch
    t.deps.fetch = async (input, init) => { urls.push(String(input)); return inner(input, init) }
    await t.api.refreshDayoEdits()
    expect(await readKey(t.db, DAYO_KEYS.dayoEditsSince)).toBe('2026-09-25T03:05:00+00:00')
    expect(await t.api.refreshDayoEdits()).toEqual({ updated: 0 })
    // the device's setup time, then the newest updated_at seen — each asked 5 minutes early (a later commit with an earlier
    // timestamp is not missed; an edit seen twice writes nothing)
    expect(new URL(urls[0]!).searchParams.get('updated_since')).toBe('2026-09-25T02:55:00.000Z')
    expect(new URL(urls[1]!).searchParams.get('updated_since')).toBe('2026-09-25T03:00:00.000Z')
    expect(new URL(urls[1]!).searchParams.get('from')).toBe('2026-07-27') // today − 60 days (Thai date)
    expect(await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'dayo_edit_seen')).all()).toHaveLength(1)
  })
  it('a cancel on the dayo web: not voidable here any more, but the bill stays paid on the tablet', async () => {
    const { t, r } = await sentBill()
    t.mock.editPosOrder(r.orderId, { kind: 'cancel', reason: 'ลูกค้ายกเลิก' })
    await t.api.refreshDayoEdits()
    const d = await t.api.getOrder(r.orderId)
    expect(d).toMatchObject({ status: 'paid', totalSatang: 4500, voidable: false, dayoEdit: { kind: 'cancel' } })
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order_void:${r.orderId}`)).all())).toEqual([]) // no void queued
  })
  it('a key without staff:read: the edit still shows, without the name and the reason', async () => {
    const { t, r } = await sentBill()
    t.mock.editPosOrder(r.orderId, { kind: 'edit', reason: 'ลับ' })
    t.mock.setScopes(['catalog:read', 'orders:read', 'orders:write'])
    await t.api.refreshDayoEdits()
    expect((await t.api.getOrder(r.orderId)).dayoEdit).toMatchObject({ kind: 'edit', editedByName: null, reason: null })
  })
  it('POS bills of another key (pos_order_id null) and ids not on this tablet are left alone', async () => {
    const { t, r } = await sentBill()
    const edit = { kind: 'edit' as const, edited_at: '2026-09-25T03:04:00+00:00', edited_by_name: 'TungAo', reason: 'x', version: 2 }
    t.mock.seedCentralOrders([
      bill({ order_no: 'L260925-020', source: 'pos', pos_order_id: null, updated_at: '2026-09-25T03:04:00+00:00', dayo_edit: edit }),
      bill({ order_no: 'L260925-021', source: 'pos', pos_order_id: 'abcdef01-2345-4678-89ab-cdef01234567', updated_at: '2026-09-25T03:04:00+00:00', dayo_edit: edit }),
    ])
    expect(await t.api.refreshDayoEdits()).toEqual({ updated: 0 })
    expect((await t.api.getOrder(r.orderId)).dayoEdit).toBeNull()
  })
  it('opening today\'s bot/web list also picks up edits of today\'s own bills', async () => {
    const { t, r } = await sentBill()
    t.mock.editPosOrder(r.orderId, { kind: 'edit', reason: 'x' })
    expect(await t.api.listCentralOrdersToday()).toEqual([])
    expect((await t.api.getOrder(r.orderId)).dayoEdit).toMatchObject({ kind: 'edit', reason: 'x' })
  })
  it('a full page of 500 is a warning, and the "since" mark does not move past bills that were cut off', async () => {
    const { t } = await sentBill()
    t.mock.seedCentralOrders(Array.from({ length: 500 }, (_, i) => bill({ order_no: `L260925-${String(100 + i)}`, updated_at: '2026-09-25T03:04:00+00:00' })))
    await t.api.refreshDayoEdits()
    expect((await t.api.syncStatus()).catalogError).toContain('DAYO_EDITS_TOO_MANY')
    expect(await readKey(t.db, DAYO_KEYS.dayoEditsSince)).toBeNull()
  })
  it('a revoked key: refreshDayoEdits makes no request', async () => {
    const { t } = await sentBill()
    t.mock.setMode('unauthorized')
    try { await t.api.refreshDayoEdits(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('OFFLINE') }
    const calls = t.mock.requests().length
    try { await t.api.refreshDayoEdits(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('OFFLINE') }
    expect(t.mock.requests().length).toBe(calls)
  })
})

describe('price differences (spec 04 §4.3 — every size is visible)', () => {
  it('lists bills whose dayo total differs, even by 1 satang', async () => {
    const t = await openConnectedApi()
    const a = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const b = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.db.update(s.order).set({ centralComputedTotalSatang: 4_501 }).where(eq(s.order.id, a.orderId))
    await t.db.update(s.order).set({ centralComputedTotalSatang: 4_500 }).where(eq(s.order.id, b.orderId))
    expect(await t.api.listPriceDiffs(STAFF.TungAo)).toEqual([expect.objectContaining({ kind: 'amount', orderId: a.orderId, diffSatang: 1 })])
  })
})
