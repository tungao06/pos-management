import { describe, expect, it } from 'vitest'
import { loadContractFixture } from '@dayo/contracts/fixture-files'
import type { OrderRowData } from '@dayo/contracts'
import { createMockDayo, MOCK_API_KEY } from '../src/index.js'

const auth = { authorization: `Bearer ${MOCK_API_KEY}` }
const base = (loadContractFixture('e2-order-accepted').request.body as { rows: { data: OrderRowData }[] }).rows[0]!.data
const ID2 = '11111111-2222-4333-8444-555555555555'
const row = (data: Partial<OrderRowData> & { pos_order_id: string }) => ({ key: `order:${data.pos_order_id}`, kind: 'order', data: { ...base, ...data } })
const voidRow = (d: Record<string, unknown>) => ({ key: `order_void:${base.pos_order_id}`, kind: 'order_void', data: { pos_order_id: base.pos_order_id, voided_at: '2026-09-25T03:16:00.000Z', staff_id: base.staff_id, approved_by: null, reason: 'x', ...d } })
async function push(m: ReturnType<typeof createMockDayo>, ...rows: unknown[]) {
  const r = await m.fetch('http://mock/api/v1/pos/push', { method: 'POST', headers: auth, body: JSON.stringify({ device_time: '2026-09-25T03:15:04.000Z', rows }) })
  return ((await r.json()) as { data: { results: { status: string; reason?: string }[] } }).data.results
}

describe('mock verdict rules not covered by the contract fixtures (spec §4.5 การกันซ้ำ)', () => {
  it('after the 30-day key purge: same pos_order_id with other content = duplicate (accepted limit); same receipt + new pos_order_id = CONFLICT', async () => {
    const m = createMockDayo({ now: '2026-09-25T03:15:04.010Z' })
    m.preloadOrder({ posOrderId: base.pos_order_id, receiptNo: base.receipt_no, saleDate: '2026-09-25', soldAt: base.sold_at, orderNo: 'L260925-014', total: 155 }) // order exists, key gone
    expect((await push(m, row({ pos_order_id: base.pos_order_id, note: 'อื่น' })))[0]!.status).toBe('duplicate')
    expect((await push(m, row({ pos_order_id: ID2 })))[0]).toMatchObject({ status: 'rejected', reason: 'CONFLICT' })
  })
  it('a rejected row sent again under the same key with fixed data is accepted (rejected results are never stored)', async () => {
    const m = createMockDayo({ now: '2026-09-25T03:15:04.010Z' })
    const bad = row({ pos_order_id: base.pos_order_id, lines: [{ ...base.lines[0]!, code: 'Nope' }] })
    expect((await push(m, bad))[0]).toMatchObject({ status: 'rejected', reason: 'UNKNOWN_CODE' })
    expect((await push(m, row({ pos_order_id: base.pos_order_id })))[0]!.status).toBe('accepted')
  })
  it('check order = dayo 0052:555-620: key hash before the field shapes · unknown fields before a forced server error', async () => {
    const m = createMockDayo({ now: '2026-09-25T03:15:04.010Z' })
    expect((await push(m, row({ pos_order_id: base.pos_order_id })))[0]!.status).toBe('accepted')
    expect((await push(m, row({ pos_order_id: base.pos_order_id, queue_no: -1 })))[0]).toMatchObject({ status: 'rejected', reason: 'CONFLICT' }) // not INVALID
    m.setMode('force_row_error')
    const extra = { ...row({ pos_order_id: ID2 }), data: { ...row({ pos_order_id: ID2 }).data, receipt_no: 'A-000999', table_no: 3 } }
    expect((await push(m, extra))[0]).toMatchObject({ status: 'deferred', reason: 'UNSUPPORTED' }) // not SERVER_ERROR
    expect((await push(m, row({ pos_order_id: ID2, receipt_no: 'A-000999' })))[0]).toMatchObject({ status: 'deferred', reason: 'SERVER_ERROR' })
  })
  it('order_void: unknown approver = UNKNOWN_STAFF · voided_at before sold_at = INVALID', async () => {
    const m = createMockDayo({ now: '2026-09-25T03:15:04.010Z' })
    await push(m, row({ pos_order_id: base.pos_order_id }))
    expect((await push(m, voidRow({ approved_by: ID2 })))[0]).toMatchObject({ status: 'rejected', reason: 'UNKNOWN_STAFF' })
    expect((await push(m, voidRow({ voided_at: '2026-09-25T03:00:00.000Z' })))[0]).toMatchObject({ status: 'rejected', reason: 'INVALID' })
  })
})
