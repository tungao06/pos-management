// order_off_catalog on the mock (spec 04 §4.10 rules 0–3 · D91 · D97 · R3-C · R4-2) — dayo ADR-0069 PHASE 2, so a
// `block3Phase2` mock (preflight P3/D1). pos_push_rejections is dayo phase 1 already (0066:993-1002).
import { describe, expect, it } from 'vitest'
import { MOCK_API_KEY, mockControl } from '../src/index'
import { at, cashCount, cid, newMock, newMockPhase1, offCatalogRow, oid, orderRow, posBill, push, rejectOrder, row, shiftClose, shiftOpen, sid, STAFF_ONLY, voidRow } from './helpers-block3'

const ready = () => { const mock = newMock(); mock.setBlock3LiveFrom('2026-09-01'); return mock }
const offCat = (mock: ReturnType<typeof newMock>, o: Parameters<typeof offCatalogRow>[1] = {}) => push(mock, [row('order_off_catalog', oid(1), offCatalogRow(1, o))])
const prefixOf = (r: { detail?: string }) => r.detail?.split(' ')[0]

describe('order_off_catalog in the mock (spec 04 §4.10 · D91 · D97)', () => {
  it('a rejected order closed as off-catalog is accepted with an order_no from the same counter; the rejection is on record', async () => {
    const mock = ready()
    await rejectOrder(mock, 1)
    const [r] = await offCat(mock)
    expect(r).toMatchObject({ status: 'accepted', data: { version: 1 } })
    expect(String(r!.data!['order_no'])).toMatch(/^L260925-\d{3}$/)
    expect(mock.orders()).toEqual([expect.objectContaining({ posOrderId: oid(1), status: 'ok', total: 35 })])
    expect(mock.rejections()).toEqual([{ posOrderId: oid(1), reasons: ['UNKNOWN_CODE'] }])
  })
  it('no rejection on record → FORBIDDEN "rule:"', async () => {
    const [r] = await offCat(ready())
    expect(r).toMatchObject({ status: 'rejected', reason: 'FORBIDDEN' }); expect(prefixOf(r!)).toBe('rule:')
  })
  it('no block3_live_from, or sold_at before it → FORBIDDEN "rule:"', async () => {
    const mock = newMock()
    await rejectOrder(mock, 1)
    expect(prefixOf((await offCat(mock))[0]!)).toBe('rule:')
    mock.setBlock3LiveFrom('2026-09-26')
    expect(prefixOf((await offCat(mock))[0]!)).toBe('rule:')
  })
  it('a total above the cap → FORBIDDEN "rule:"; after the owner raises the cap the same key passes (D103 — default ฿3,000)', async () => {
    const mock = ready()
    await rejectOrder(mock, 1)
    expect(prefixOf((await offCat(mock, { total: 3000.01 }))[0]!)).toBe('rule:')
    mock.setOffCatalogCap(5000)
    expect((await offCat(mock, { total: 3000.01 }))[0]).toMatchObject({ status: 'accepted' })
  })
  it('closed_by not an active owner → FORBIDDEN "role:"', async () => {
    const mock = ready()
    await rejectOrder(mock, 1)
    expect(prefixOf((await offCat(mock, { closedBy: STAFF_ONLY }))[0]!)).toBe('role:')
  })
  it('the bill already in dayo as a normal bill → CONFLICT "exists:" with the data to compare (m2)', async () => {
    const mock = ready()
    const [o] = await push(mock, [row('order', oid(1), orderRow(1, { shiftId: null }))])
    const [r] = await offCat(mock)
    expect(r).toMatchObject({ status: 'rejected', reason: 'CONFLICT', data: { order_no: o!.data!['order_no'], version: 1, reported_total: 35, payment_is_cash: true, off_catalog: false } })
    expect(prefixOf(r!)).toBe('exists:')
  })
  it('an order row of a bill that is off-catalog now → CONFLICT "off_catalog_exists:" (off_catalog: true)', async () => {
    const mock = ready()
    await rejectOrder(mock, 1)
    await offCat(mock)
    const [r] = await push(mock, [row('order', oid(1), orderRow(1, { shiftId: null }))])
    expect(r).toMatchObject({ status: 'rejected', reason: 'CONFLICT', data: { off_catalog: true } }); expect(prefixOf(r!)).toBe('off_catalog_exists:')
  })
  it('order_void of an off-catalog bill cancels it', async () => {
    const mock = ready()
    await rejectOrder(mock, 1); await offCat(mock)
    expect((await push(mock, [row('order_void', oid(1), voidRow(1, at(2)))]))[0]).toMatchObject({ status: 'accepted' })
    expect(mock.orders()[0]).toMatchObject({ status: 'cancelled' })
  })
  it('the same off-catalog row again → duplicate', async () => {
    const mock = ready()
    await rejectOrder(mock, 1); await offCat(mock)
    expect((await offCat(mock))[0]).toMatchObject({ status: 'duplicate' })
  })
  it('a Z listing the off-catalog bill is matched — it is in pos_bills like any bill, no waiting_bills', async () => {
    const mock = ready()
    await push(mock, [row('shift_open', sid(1), shiftOpen(1))])
    await rejectOrder(mock, 1, sid(1))
    await offCat(mock, { shiftId: sid(1) })
    await push(mock, [row('cash_count', cid(1), cashCount(1, at(5), 535)), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 535, cash: { pos_cash_sales: 35 }, posBills: [posBill(1)] }))])
    expect(mock.zReports()[0]).toMatchObject({ recomputeStatus: 'matched' })
  })
})

describe('order_off_catalog: the rest of the dayo rules (spec 04 §4.10 rule 0 · table)', () => {
  it('original_reason must be one of the reasons dayo recorded for the bill (R3-C: every reason is kept)', async () => {
    const mock = ready()
    await rejectOrder(mock, 1)
    mock.override({ match: { key: `order:${oid(1)}` }, verdict: { status: 'rejected', reason: 'INVALID', detail: 'x' }, times: 1 })
    await push(mock, [row('order', oid(1), orderRow(1, { shiftId: null }))])
    await push(mock, [row('order', oid(1), orderRow(1, { shiftId: null }))])     // judged for real now: accepted
    expect(mock.rejections()).toEqual([{ posOrderId: oid(1), reasons: ['UNKNOWN_CODE', 'INVALID'] }])
    const other = ready()
    await rejectOrder(other, 1)
    expect(prefixOf((await offCat(other, { originalReason: 'INVALID' }))[0]!)).toBe('rule:')
    expect((await offCat(other, { originalReason: 'UNKNOWN_CODE' }))[0]).toMatchObject({ status: 'accepted' })
  })
  it('the receipt number is another bill\'s → CONFLICT "receipt_taken:"', async () => {
    const mock = ready()
    await push(mock, [row('order', oid(2), { ...orderRow(2, { shiftId: null }), receipt_no: 'A-000001' })])
    await rejectOrder(mock, 1)
    const [r] = await offCat(mock)
    expect(r).toMatchObject({ status: 'rejected', reason: 'CONFLICT' }); expect(prefixOf(r!)).toBe('receipt_taken:')
  })
  it('no 60-day limit on sold_at (a bill dayo refused as too old can be closed) · the limit is on closed_at', async () => {
    const mock = ready()
    mock.setBlock3LiveFrom('2026-06-01')
    const old = { ...offCatalogRow(1, { soldAt: '2026-07-01T03:00:00.000Z' }), sale_date: '2026-07-01' }
    mock.override({ match: { key: `order:${oid(1)}` }, verdict: { status: 'rejected', reason: 'INVALID', detail: 'เก่า' }, times: 1 })
    await push(mock, [row('order', oid(1), orderRow(1, { shiftId: null }))])
    expect((await push(mock, [row('order_off_catalog', oid(1), { ...old, original_reason: 'INVALID' })]))[0]).toMatchObject({ status: 'accepted', data: { order_no: 'L260701-001' } })
    const tooOld = { ...offCatalogRow(2), closed_at: '2026-07-01T03:00:00.000Z', sold_at: '2026-07-01T02:00:00.000Z', sale_date: '2026-07-01' }
    expect((await push(mock, [row('order_off_catalog', oid(2), tooOld)]))[0]).toMatchObject({ status: 'rejected', reason: 'INVALID' })
  })
  it('time: sold_at or closed_at in the future → deferred CLOCK_AHEAD · closed_at before sold_at → INVALID', async () => {
    const mock = ready()
    await rejectOrder(mock, 1)
    expect((await push(mock, [row('order_off_catalog', oid(1), { ...offCatalogRow(1), sold_at: '2026-09-25T12:30:00.000Z' })]))[0]).toMatchObject({ status: 'deferred', reason: 'CLOCK_AHEAD' })
    expect((await push(mock, [row('order_off_catalog', oid(1), { ...offCatalogRow(1), closed_at: '2026-09-25T12:30:00.000Z' })]))[0]).toMatchObject({ status: 'deferred', reason: 'CLOCK_AHEAD' })
    expect((await push(mock, [row('order_off_catalog', oid(1), { ...offCatalogRow(1), closed_at: '2026-09-25T00:30:00.000Z' })]))[0]).toMatchObject({ status: 'rejected', reason: 'INVALID' })
  })
  it('shapes: totals must add up (INVALID) · a line may have no code/size/sweetness · an unknown staff = UNKNOWN_STAFF · an unknown payment = UNKNOWN_CODE', async () => {
    const mock = ready()
    await rejectOrder(mock, 1)
    const base = offCatalogRow(1)
    const bad = (d: unknown) => push(mock, [row('order_off_catalog', oid(1), d)]).then((r) => r[0])
    expect(await bad({ ...base, totals: { ...base.totals, total: 30 } })).toMatchObject({ status: 'rejected', reason: 'INVALID' })
    expect(await bad({ ...base, lines: [{ ...base.lines[0], line_total: 30 }] })).toMatchObject({ status: 'rejected', reason: 'INVALID' })
    expect(await bad({ ...base, totals: { ...base.totals, bill_discount: 40, total: 0 } })).toMatchObject({ status: 'rejected', reason: 'INVALID' })
    expect(await bad({ ...base, original_reason: 'unknown code' })).toMatchObject({ status: 'rejected', reason: 'INVALID' })
    expect(await bad({ ...base, staff_id: '99999999-0000-4000-8000-000000000000' })).toMatchObject({ status: 'rejected', reason: 'UNKNOWN_STAFF' })
    expect(await bad({ ...base, payment: 'bitcoin' })).toMatchObject({ status: 'rejected', reason: 'UNKNOWN_CODE' })
    expect(await bad({ ...base, closed_by: '99999999-0000-4000-8000-000000000000' })).toMatchObject({ status: 'rejected', reason: 'UNKNOWN_STAFF' })
    expect(await bad({ ...base, lines: [{ ...base.lines[0], code: null, size: null, sweetness: null }] })).toMatchObject({ status: 'accepted' })
  })
  it('E3 lists the off-catalog bill like any POS bill (its totals are the frozen ones)', async () => {
    const mock = ready()
    await rejectOrder(mock, 1); await offCat(mock)
    const res = await mock.fetch('http://localhost:8787/api/v1/orders', { headers: { authorization: `Bearer ${MOCK_API_KEY}` } })
    const rows = ((await res.json()) as { data: { pos_order_id?: string; totals: { total: number }; source: string }[] }).data
    expect(rows).toEqual([expect.objectContaining({ pos_order_id: oid(1), source: 'pos', totals: expect.objectContaining({ total: 35 }) })])
  })
  it('phase 1 (dayo main 12885fe): order_off_catalog stays deferred UNSUPPORTED, but a rejected order row is recorded (0066:993-1002)', async () => {
    const mock = newMockPhase1()
    mock.setBlock3LiveFrom('2026-09-01')
    await rejectOrder(mock, 1)
    expect(mock.rejections()).toEqual([{ posOrderId: oid(1), reasons: ['UNKNOWN_CODE'] }])
    expect((await offCat(mock))[0]).toMatchObject({ status: 'deferred', reason: 'UNSUPPORTED' })
  })
  it('control routes: /__mock/off-catalog-cap and /__mock/block3-live-from; /__mock/state lists the rejections', async () => {
    const mock = newMock()
    expect(await mockControl(mock, '/__mock/block3-live-from', { date: '2026-09-01' })).toEqual({ status: 200, body: { ok: true } })
    expect(await mockControl(mock, '/__mock/off-catalog-cap', { baht: 10 })).toEqual({ status: 200, body: { ok: true } })
    await rejectOrder(mock, 1)
    expect(prefixOf((await offCat(mock))[0]!)).toBe('rule:')                     // ฿35 > ฿10
    await mockControl(mock, '/__mock/off-catalog-cap', { baht: 35 })
    expect((await offCat(mock))[0]).toMatchObject({ status: 'accepted' })         // = the cap passes
    expect((await mockControl(mock, '/__mock/state', null)).body).toMatchObject({ rejections: [{ posOrderId: oid(1), reasons: ['UNKNOWN_CODE'] }] })
  })
})
