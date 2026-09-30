// The four shift kinds, `scope:` and E4 against dayo main 12885fe (ADR-0069 phase 1 · 0066_pos_push_shift_kinds.sql ·
// 0067_pos_shift_cash_catalog.sql) — preflight rulings P1, P3, P7.
import { describe, expect, it } from 'vitest'
import { BLOCK3_PHASE1_SUPPORTED_FIELDS, BLOCK3_PHASE2_SUPPORTED_FIELDS, ShiftCashResponse } from '@dayo/contracts'
import { createMockDayo, mockControl, MOCK_API_KEY, type MockDayo } from '../src/index'
import { at, botBill, cashCount, cid, mid, movementRow, orderRow, pg, row as rowOf, shiftClose, shiftOpen, sid } from './helpers-block3'

const NOW = '2026-09-25T12:10:00.000Z'
const S = '5a5a5a5a-0000-4000-8000-000000000001'
const U = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'   // TungAo, owner (rich fixture)
const STAFF_ONLY = '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0' // Mint, staff
const M = '6b6b6b6b-0000-4000-8000-000000000001'
const C = '7c7c7c7c-0000-4000-8000-000000000001'
const open = { shift_id: S, business_date: '2026-09-25', opened_at: '2026-09-25T02:00:00.000Z', opened_by: U, opening_float: 500, quick_open: false }
const lines = [1000, 500, 100, 50, 20, 10, 5, 2, 1].map((d) => ({ denomination: d, count: d === 500 ? 1 : 0 }))
const count = { count_id: C, shift_id: S, lines, counted: 500, counted_by: U, counted_at: '2026-09-25T12:00:00.000Z' }
const auth = { authorization: `Bearer ${MOCK_API_KEY}` }

type Result = { key: string; status: string; reason?: string; detail?: string; data?: unknown }
async function push(mock: ReturnType<typeof createMockDayo>, rows: unknown[]) {
  const r = await mock.fetch('http://localhost:8787/api/v1/pos/push', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ device_time: NOW, rows }) })
  return ((await r.json()) as { data: { results: Result[] } }).data.results
}
const row = (kind: string, id: string, data: unknown) => ({ key: `${kind}:${id}`, kind, data })
const e1 = async (mock: MockDayo) => ((await (await mock.fetch('http://localhost:8787/api/v1/pos/catalog?known_version=0', { headers: auth })).json()) as {
  data: { catalog_version: number; supported_kinds: string[]; supported_fields: Record<string, string[]>; client: Record<string, unknown> }
}).data

describe('mock shift kinds (spec 04 §4.10)', () => {
  it('without block3 the kinds are UNSUPPORTED (deferred) — block-2 behaviour kept (R15)', async () => {
    const mock = createMockDayo({ now: NOW })
    expect((await push(mock, [row('shift_open', S, open)]))[0]).toMatchObject({ status: 'deferred', reason: 'UNSUPPORTED' })
  })
  it('shift_open → cash_count in one request are accepted in order; the result data is just the id', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    const r = await push(mock, [row('shift_open', S, open), row('cash_count', C, count)])
    expect(r.map((x) => [x.status, x.data])).toEqual([['accepted', { shift_id: S }], ['accepted', { count_id: C }]])
    expect(mock.shifts()[0]).toMatchObject({ status: 'counted' })
  })
  it('a child before its shift waits (PARENT_PENDING)', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    expect((await push(mock, [row('cash_count', C, count)]))[0]).toMatchObject({ status: 'deferred', reason: 'PARENT_PENDING' })
  })
  it('a key without shift:write: shift rows FORBIDDEN "scope:", a bill in the same request still passes', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    mock.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write'])
    const r = await push(mock, [row('shift_open', S, open)])
    expect(r[0]).toMatchObject({ status: 'rejected', reason: 'FORBIDDEN' })
    expect(r[0]!.detail!.startsWith('scope:')).toBe(true)
    const both = await push(mock, [rowOf('shift_open', sid(2), shiftOpen(2)), rowOf('order', orderRow(1, { shiftId: sid(2) }).pos_order_id, orderRow(1, { shiftId: sid(2) }))])
    expect(both.map((x) => [x.status, x.reason ?? null])).toEqual([['rejected', 'FORBIDDEN'], ['accepted', null]])
    expect(both[0]!.detail).toBe('scope: API key ไม่มีสิทธิ์ shift:write')
  })
  it('a second count of the shift = CONFLICT "counted:" and a data-conflict flag (S5)', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    await push(mock, [row('shift_open', S, open), row('cash_count', C, count)])
    const other = '7c7c7c7c-0000-4000-8000-000000000002'
    const r = await push(mock, [row('cash_count', other, { ...count, count_id: other })])
    expect(r[0]).toMatchObject({ status: 'rejected', reason: 'CONFLICT' })
    expect(r[0]!.detail!.startsWith('counted:')).toBe(true)
    expect(mock.conflicts()).toContain(`counted:${S}`)
    expect(mock.shifts()[0]).toMatchObject({ dataConflict: true })
  })
  it('the same key with other content = CONFLICT "key_changed:"', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    await push(mock, [row('shift_open', S, open)])
    expect((await push(mock, [row('shift_open', S, { ...open, opening_float: 400 })]))[0]!.detail!.startsWith('key_changed:')).toBe(true)
    expect(mock.conflicts()).toEqual([`key_changed:${S}`])
  })
  it('quick_open by a staff member = FORBIDDEN "role:"; a movement after counted_at = INVALID', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    expect((await push(mock, [row('shift_open', S, { ...open, opened_by: STAFF_ONLY, quick_open: true })]))[0]!.detail!.startsWith('role:')).toBe(true)
    await push(mock, [row('shift_open', S, open), row('cash_count', C, count)])
    const late = { movement_id: M, shift_id: S, kind: 'PAID_OUT', amount: 20, pos_order_id: null, reason: 'x', created_by: U, created_at: '2026-09-25T12:00:00.001Z' }
    expect((await push(mock, [row('cash_movement', M, late)]))[0]).toMatchObject({ status: 'rejected', reason: 'INVALID' })
  })
  it('E4 returns bot/web cash bills in (after, until] only', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    const bot = (no: string, total: number, at: string) => ({ order_no: no, sale_date: '2026-09-25', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'line', payment: 'cash', totals: { items_subtotal: total, items_discount: 0, bill_discount: 0, total }, amount_mismatch: false, updated_at: at, sold_at: at })
    mock.seedCentralOrders([bot('L260925-901', 70, '2026-09-25T04:00:00+00:00'), bot('L260925-902', 35, '2026-09-25T12:00:00+00:00'), bot('L260925-903', 50, '2026-09-25T12:00:01+00:00'), { ...bot('L260925-904', 45, '2026-09-25T05:00:00+00:00'), payment: 'qr' }])
    const r = await mock.fetch(`http://localhost:8787/api/v1/pos/shift-cash?after=${encodeURIComponent('2026-09-24T17:00:00.000Z')}&until=${encodeURIComponent('2026-09-25T12:00:00.000Z')}`, { headers: { authorization: `Bearer ${MOCK_API_KEY}` } })
    expect(await r.json()).toMatchObject({ ok: true, data: { cash_total: 105, bills: [{ order_no: 'L260925-901' }, { order_no: 'L260925-902' }] } })
  })
})

describe('dayo phase 1 exactly (preflight P1/P3) and the phase-2 flag', () => {
  it('block3: E1 advertises order, order_void + the four shift kinds with dayo 0066 fields; order_off_catalog = deferred UNSUPPORTED', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    const d = await e1(mock)
    expect(d.supported_kinds).toEqual(['order', 'order_void', 'shift_open', 'cash_movement', 'cash_count', 'shift_close'])
    for (const [k, f] of Object.entries(BLOCK3_PHASE1_SUPPORTED_FIELDS)) expect(new Set(d.supported_fields[k])).toEqual(new Set(f))
    expect(d.supported_fields['order_off_catalog']).toBeUndefined()
    const id = '0b0b0b0b-0000-4000-8000-000000000009'
    expect((await push(mock, [row('order_off_catalog', id, { pos_order_id: id })]))[0]).toEqual({ key: `order_off_catalog:${id}`, status: 'deferred', reason: 'UNSUPPORTED', detail: 'ชนิดแถวนี้ระบบกลางยังไม่รองรับ' })
  })
  it('the block-2 mock is untouched: 2 kinds, 4 scopes, no last_z_* in E1', async () => {
    const d = await e1(createMockDayo({ now: NOW }))
    expect(d.supported_kinds).toEqual(['order', 'order_void'])
    expect(Object.keys(d.supported_fields)).toEqual(['order', 'order_void'])
    expect(d.client).not.toHaveProperty('last_z_no')
  })
  it('block3 with no Z: E1 client names last_z_* as null, like dayo (0067:134-155)', async () => {
    expect((await e1(createMockDayo({ now: NOW, block3: true }))).client).toMatchObject({ last_z_no: null, last_z_hash: null, last_z_until: null })
  })
  it('a bill row keeps its block-2 CONFLICT texts in phase 1 (no receipt_taken:/key_changed: — dayo phase 2)', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    const a = orderRow(1, { shiftId: null })
    await push(mock, [rowOf('order', a.pos_order_id, a)])
    const b = { ...orderRow(2, { shiftId: null }), receipt_no: a.receipt_no }
    expect((await push(mock, [rowOf('order', b.pos_order_id, b)]))[0]!.detail).toBe('เลขใบเสร็จ A-000001 ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว')
    expect((await push(mock, [rowOf('order', a.pos_order_id, { ...a, note: 'อื่น' })]))[0]!.detail).toBe('key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว')
  })
  it('block3Phase2: + order_off_catalog in E1, receipt_taken: / key_changed: on bill rows', async () => {
    const mock = createMockDayo({ now: NOW, block3Phase2: true })
    const d = await e1(mock)
    expect(d.supported_kinds).toEqual(['order', 'order_void', 'shift_open', 'cash_movement', 'cash_count', 'shift_close', 'order_off_catalog'])
    expect(new Set(d.supported_fields['order_off_catalog'])).toEqual(new Set(BLOCK3_PHASE2_SUPPORTED_FIELDS.order_off_catalog))
    const a = orderRow(1, { shiftId: null })
    await push(mock, [rowOf('order', a.pos_order_id, a)])
    const b = { ...orderRow(2, { shiftId: null }), receipt_no: a.receipt_no }
    expect((await push(mock, [rowOf('order', b.pos_order_id, b)]))[0]!.detail!.startsWith('receipt_taken:')).toBe(true)
    expect((await push(mock, [rowOf('order', a.pos_order_id, { ...a, note: 'อื่น' })]))[0]!.detail!.startsWith('key_changed:')).toBe(true)
    expect(mock.conflicts()).toEqual([]) // a bill row is never a shift data conflict
  })
  it('setBlock3 / setBlock3Phase2 switch kinds, fields and shift:write and bump catalog_version; /__mock/block3 drives them', async () => {
    const mock = createMockDayo({ now: NOW })
    const v0 = (await e1(mock)).catalog_version
    expect(mock.setBlock3(true)).toBe(v0 + 1)
    expect((await e1(mock)).supported_kinds).toHaveLength(6)
    expect((await push(mock, [row('shift_open', S, open)]))[0]).toMatchObject({ status: 'accepted' })
    expect(mock.setBlock3Phase2(true)).toBe(v0 + 2)
    expect((await e1(mock)).supported_kinds).toContain('order_off_catalog')
    expect(mock.setBlock3(false)).toBe(v0 + 3) // phase 1 off = phase 2 off too
    expect((await e1(mock)).supported_kinds).toEqual(['order', 'order_void'])
    expect((await push(mock, [row('shift_open', sid(2), shiftOpen(2))]))[0]).toMatchObject({ status: 'deferred', reason: 'UNSUPPORTED' })
    expect(await mockControl(mock, '/__mock/block3', { on: true, phase2: true })).toEqual({ status: 200, body: { catalog_version: v0 + 5 } })
    expect((await e1(mock)).supported_kinds).toHaveLength(7)
    await mockControl(mock, '/__mock/block3', { on: true, phase2: false })
    expect((await e1(mock)).supported_kinds).toHaveLength(6)
  })
})

describe('re-sending is idempotent (spec §4.5 · dayo 0066 id checks)', () => {
  it('the same four rows sent twice: every row duplicate with the same data, state unchanged', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    const rows = [rowOf('shift_open', sid(1), shiftOpen(1)), rowOf('cash_movement', mid(1), movementRow(1, 1, 'PAID_IN', 100, at(1))), rowOf('cash_count', cid(1), cashCount(1, at(2), 600)),
      rowOf('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(2), counted: 600, cash: { paid_in: 100 }, movementIds: [mid(1)] }))]
    const first = await push(mock, rows)
    expect(first.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted', 'accepted'])
    const again = await push(mock, rows)
    expect(again.map((r) => r.status)).toEqual(['duplicate', 'duplicate', 'duplicate', 'duplicate'])
    expect(again.map((r) => r.data)).toEqual(first.map((r) => r.data))
    expect([mock.shifts().length, mock.movements().length, mock.counts().length, mock.zReports().length]).toEqual([1, 1, 1, 1])
    expect(mock.shifts()[0]).toMatchObject({ status: 'closed', closedBy: U, dataConflict: false })
    expect(mock.conflicts()).toEqual([])
  })
  it('one bad row never holds the others: a rejected Z between two good rows', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    const r = await push(mock, [rowOf('shift_open', sid(1), shiftOpen(1)), rowOf('cash_count', cid(1), cashCount(1, at(2), 500)),
      rowOf('shift_close', sid(1), { ...shiftClose(1, { zNo: 1, countedAt: at(2), counted: 500 }), closed_by: STAFF_ONLY }), rowOf('shift_open', sid(2), shiftOpen(2))])
    expect(r.map((x) => [x.status, x.reason ?? null])).toEqual([['accepted', null], ['accepted', null], ['rejected', 'FORBIDDEN'], ['accepted', null]])
  })
})

describe('dayo 0066 order of checks (preflight D6) and detail texts', () => {
  it('shift_close: owner (role:) is checked before the parent shift (PARENT_PENDING)', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    const r = await push(mock, [rowOf('shift_close', sid(1), { ...shiftClose(1, { zNo: 1, countedAt: at(2), counted: 500 }), closed_by: STAFF_ONLY })])
    expect(r[0]).toMatchObject({ status: 'rejected', reason: 'FORBIDDEN', detail: 'role: ผู้ปิดกะต้องเป็นเจ้าของที่ใช้งานอยู่ ณ เวลาปิดกะ' })
    expect((await push(mock, [rowOf('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(2), counted: 500 }))]))[0])
      .toMatchObject({ status: 'deferred', reason: 'PARENT_PENDING', detail: 'กะที่อ้างยังมาไม่ถึง' })
    await push(mock, [rowOf('shift_open', sid(1), shiftOpen(1))])
    expect((await push(mock, [rowOf('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(2), counted: 500 }))]))[0])
      .toMatchObject({ status: 'deferred', reason: 'PARENT_PENDING', detail: 'การนับเงินของกะยังมาไม่ถึง' })
  })
  it('shift_close: the z_report shape is INVALID before time and staff (unknown key · drawer_expenses · Σ bot_bills · bot order_no)', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    const base = shiftClose(1, { zNo: 1, countedAt: at(2), counted: 500 })
    const zr = base.z_report
    const bad = async (z: unknown, detail: string) => {
      expect((await push(mock, [rowOf('shift_close', sid(1), { ...base, closed_by: STAFF_ONLY, z_report: z })]))[0]).toMatchObject({ status: 'rejected', reason: 'INVALID', detail })
    }
    await bad({ ...zr, extra: 1 }, 'z_report ต้องมีคีย์ครบและไม่มีคีย์ที่ไม่รู้จัก')
    await bad({ ...zr, cash: { ...zr.cash, drawer_expenses: 5 } }, 'drawer_expenses ต้องเป็น 0 (ค่าใช้จ่ายจากลิ้นชักยังไม่รองรับ — ADR-0057)')
    await bad({ ...zr, bot_bills: [{ order_no: 'L260925-001', version: 1, total: 35 }] }, 'Σ bot_bills.total ไม่เท่ากับ cash.bot_cash')
    await bad({ ...zr, cash: { ...zr.cash, bot_cash: 35 }, bot_bills: [{ order_no: 'W-1', version: 1, total: 35 }] }, 'bot_bills ต้องเป็น {order_no, version, total}')
    await bad({ ...zr, pos_bills: [{ pos_order_id: sid(9), receipt_no: 'A-000001', payment: 'cash', total: 35, sold_at: at(1) }] },
      'pos_bills ต้องเป็น {pos_order_id, receipt_no, payment, total, sold_at, voided_at} ไม่ซ้ำ') // voided_at missing ≠ null (dayo_jt 'missing')
  })
  it('cash_count and shift_close: count_id / until / closed_at rules', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    await push(mock, [rowOf('shift_open', sid(1), shiftOpen(1)), rowOf('cash_count', cid(1), cashCount(1, at(2), 500))])
    const z = shiftClose(1, { zNo: 1, countedAt: at(2), counted: 500 })
    expect((await push(mock, [rowOf('shift_close', sid(1), { ...z, count_id: cid(7) })]))[0]).toMatchObject({ reason: 'INVALID', detail: 'count_id ไม่ตรงกับการนับของกะนี้' })
    expect((await push(mock, [rowOf('shift_close', sid(1), { ...z, closed_at: at(1) })]))[0]).toMatchObject({ reason: 'INVALID', detail: 'closed_at ต้องไม่ก่อน counted_at' })
    expect((await push(mock, [rowOf('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(3), counted: 500 }))]))[0])
      .toMatchObject({ reason: 'INVALID', detail: 'bot_window.until ต้องเท่ากับ counted_at ของการนับ' })
    expect((await push(mock, [rowOf('shift_close', sid(1), z)]))[0]).toMatchObject({ status: 'accepted', data: { shift_id: sid(1) } })
    expect(mock.zReports()).toHaveLength(1)
    expect(mock.conflicts()).toEqual([]) // none of the rejections above is a shift data conflict
  })
  it('cash_count: lines must sum to counted; cash_movement: VOID_REFUND needs pos_order_id, others a reason', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    await push(mock, [rowOf('shift_open', sid(1), shiftOpen(1))])
    expect((await push(mock, [rowOf('cash_count', cid(1), { ...cashCount(1, at(2), 500), counted: 499 })]))[0]).toMatchObject({ reason: 'INVALID', detail: 'counted ไม่เท่ากับผลรวมธนบัตร/เหรียญ' })
    expect((await push(mock, [rowOf('cash_movement', mid(1), { ...movementRow(1, 1, 'VOID_REFUND', 35, at(1)), pos_order_id: null })]))[0]).toMatchObject({ reason: 'INVALID', detail: 'VOID_REFUND ต้องมี pos_order_id' })
    expect((await push(mock, [rowOf('cash_movement', mid(1), { ...movementRow(1, 1, 'DROP', 35, at(1)), reason: null })]))[0]).toMatchObject({ reason: 'INVALID', detail: 'reason ต้องมี 1–200 ตัวอักษร (PAID_IN/PAID_OUT/DROP)' })
    expect((await push(mock, [rowOf('cash_movement', mid(1), movementRow(1, 1, 'PAID_OUT', 35, at(0)))]))[0]).toMatchObject({ reason: 'INVALID', detail: 'created_at ต้องไม่ก่อนเวลาเปิดกะ' })
    expect((await push(mock, [rowOf('cash_movement', mid(1), movementRow(1, 1, 'PAID_OUT', 35, '2026-09-25T12:16:00.000Z'))]))[0])
      .toMatchObject({ status: 'deferred', reason: 'CLOCK_AHEAD', detail: 'created_at 2026-09-25T12:16:00Z เกินเวลาเซิร์ฟเวอร์' })
    expect((await push(mock, [rowOf('cash_movement', mid(2), movementRow(2, 1, 'VOID_REFUND', 35, at(1), 1))]))[0]).toMatchObject({ status: 'accepted', data: { movement_id: mid(2) } })
  })
  it('shift_open: business_date must be the Thai date of opened_at; a shift of today sets block3_live_from once', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    expect((await push(mock, [rowOf('shift_open', sid(1), { ...shiftOpen(1), business_date: '2026-09-24' })]))[0])
      .toMatchObject({ reason: 'INVALID', detail: 'business_date 2026-09-24 ไม่ตรงกับวันที่ไทยของ opened_at (2026-09-25)' })
    expect((await push(mock, [rowOf('shift_open', sid(1), shiftOpen(1))]))[0]).toMatchObject({ status: 'accepted' })
    expect((await mockControl(mock, '/__mock/state', null)).body).toMatchObject({ shifts: [{ id: sid(1), businessDate: '2026-09-25', status: 'open' }], conflicts: [] })
  })
})

describe('E4 GET /v1/pos/shift-cash (0067:31-75)', () => {
  const get = (mock: MockDayo, q: string) => mock.fetch(`http://localhost:8787/api/v1/pos/shift-cash${q}`, { headers: auth })
  it('answers in dayo form: sold_at …+00:00, created_by_name only with staff:read; the tablet schema reads it', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    mock.seedCentralOrders([{ ...botBill('L260925-901', 70, '2026-09-25T04:00:00Z'), created_by_name: 'บอท' }, { ...botBill('L260925-902', 10.5, '2026-09-25T04:00:00Z'), source: 'web' }])
    const r = await get(mock, `?after=${encodeURIComponent(at(0))}&until=${encodeURIComponent(at(5))}`)
    const body = ShiftCashResponse.parse(await r.json())
    expect(body.data).toEqual({ cash_total: 80.5, server_time: '2026-09-25T12:10:00.000+00:00', bills: [
      { order_no: 'L260925-901', version: 1, source: 'line', sold_at: pg(at(4)), total: 70, created_by_name: 'บอท' },
      { order_no: 'L260925-902', version: 1, source: 'web', sold_at: pg(at(4)), total: 10.5, created_by_name: null },
    ] })
    mock.setScopes(['catalog:read', 'orders:read', 'orders:write', 'shift:write'])
    expect(((await (await get(mock, `?after=${encodeURIComponent(at(0))}&until=${encodeURIComponent(at(5))}`)).json()) as { data: { bills: { created_by_name: unknown }[] } }).data.bills[0]!.created_by_name).toBeNull()
  })
  it('bad or reversed window = 422 DY422 · no orders:read = 403 · no bills = [] and 0', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    const bad = await get(mock, '?after=yesterday&until=2026-09-25T05:00:00Z')
    expect([bad.status, await bad.json()]).toEqual([422, { ok: false, error: { code: 'DY422', message: 'invalid: after และ until ต้องเป็นเวลา ISO-8601 ที่มีเขตเวลา' } }])
    const rev = await get(mock, `?after=${encodeURIComponent(at(5))}&until=${encodeURIComponent(at(5))}`)
    expect([rev.status, await rev.json()]).toEqual([422, { ok: false, error: { code: 'DY422', message: 'invalid: after ต้องน้อยกว่า until' } }])
    expect(await (await get(mock, `?after=${encodeURIComponent(at(0))}&until=${encodeURIComponent(at(5))}`)).json()).toEqual({ ok: true, data: { bills: [], cash_total: 0, server_time: '2026-09-25T12:10:00.000+00:00' } })
    mock.setScopes(['catalog:read', 'staff:read', 'orders:write', 'shift:write'])
    expect((await get(mock, `?after=${encodeURIComponent(at(0))}&until=${encodeURIComponent(at(5))}`)).status).toBe(403)
  })
})

describe("mode 'offline' (review item 9)", () => {
  it('mock.fetch rejects with TypeError("Failed to fetch") and logs nothing; normal mode answers again', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    mock.setMode('offline')
    await expect(push(mock, [row('shift_open', S, open)])).rejects.toThrow(new TypeError('Failed to fetch'))
    expect(mock.requests()).toEqual([])
    expect(mock.shifts()).toEqual([])
    mock.setMode('normal')
    expect((await push(mock, [row('shift_open', S, open)]))[0]).toMatchObject({ status: 'accepted' })
  })
})
