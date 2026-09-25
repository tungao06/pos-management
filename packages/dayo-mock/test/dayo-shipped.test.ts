// The mock against dayo main as shipped (A3 · delta M5): every rule cites dayo supabase/migrations/0052_pos_push.sql.
import { describe, expect, it } from 'vitest'
import { OrdersListResponse, PosCatalogResponse, type OrderRowData } from '@dayo/contracts'
import { loadContractFixture } from '@dayo/contracts/fixture-files'
import { createMockDayo, mockControl, MOCK_API_KEY, type MockDayo } from '../src/index.js'

const NOW = '2026-09-25T03:15:04.010Z'
const auth = { authorization: `Bearer ${MOCK_API_KEY}` }
const base = (loadContractFixture('e2-order-accepted').request.body as { rows: { data: OrderRowData }[] }).rows[0]!.data
const ID = base.pos_order_id
const ID2 = '11111111-2222-4333-8444-555555555555'
const GHOST = '99999999-8888-4777-8666-555555555555' // not a staff of the shop
type Row = { key: string; kind: string; data: Record<string, unknown> }
const order = (d: Record<string, unknown> = {}, id = ID): Row => ({ key: `order:${id}`, kind: 'order', data: { ...base, pos_order_id: id, ...d } })
const line = (d: Record<string, unknown>) => ({ ...base.lines[0]!, ...d })
const voidRow = (d: Record<string, unknown> = {}, id = ID): Row => ({ key: `order_void:${id}`, kind: 'order_void', data: { pos_order_id: id, voided_at: '2026-09-25T03:16:00.000Z', staff_id: base.staff_id, approved_by: null, reason: 'ลูกค้ายกเลิก', ...d } })
type Result = { key: string; status: string; reason?: string; detail?: string; data?: Record<string, unknown> }
async function push(m: MockDayo, rows: unknown[], headers: Record<string, string> = {}): Promise<Result[]> {
  const r = await m.fetch('http://mock/api/v1/pos/push', { method: 'POST', headers: { ...auth, ...headers }, body: JSON.stringify({ device_time: NOW, rows }) })
  expect(r.status).toBe(200)
  return ((await r.json()) as { data: { results: Result[] } }).data.results
}
const one = async (m: MockDayo, row: unknown): Promise<Result> => (await push(m, [row]))[0]!
const e3 = async (m: MockDayo) => OrdersListResponse.parse(await (await m.fetch('http://mock/api/v1/orders?from=2026-09-25&to=2026-09-25', { headers: auth })).json()).data

describe('dayo_pos_order: codes are looked up as dayo does (0052:364-399)', () => {
  it('a size with no variant of the menu = rejected UNKNOWN_CODE (22 oz is a closed size without variants)', async () => {
    const m = createMockDayo({ now: NOW })
    expect(await one(m, order({ lines: [line({ size: '22 oz' })] }))).toEqual({ key: `order:${ID}`, status: 'rejected', reason: 'UNKNOWN_CODE', detail: 'ไม่พบ "Thai Tea 22 oz 50%"' })
  })
  it('size and sweetness are only text ≤ 20 / ≤ 10 to dayo — an unknown one is UNKNOWN_CODE, not INVALID', async () => {
    const m = createMockDayo({ now: NOW })
    expect(await one(m, order({ lines: [line({ size: 'L' })] }))).toMatchObject({ status: 'rejected', reason: 'UNKNOWN_CODE', detail: 'ไม่พบ "Thai Tea L 50%"' })
    expect(await one(m, order({ lines: [line({ sweetness: '30%' })] }))).toMatchObject({ status: 'rejected', reason: 'UNKNOWN_CODE' })
    expect(await one(m, order({ lines: [line({ size: 'x'.repeat(21) })] }))).toMatchObject({ status: 'rejected', reason: 'INVALID', detail: 'รายการที่ 1 ข้อมูลไม่ครบหรือผิดรูป (code/size/sweetness/milk/grade/qty/ส่วนลด)' })
  })
  it('a variant that left the E1 catalog (size closed later) is still in dayo menu_variants — accepted', async () => {
    const m = createMockDayo({ now: NOW })
    m.bumpCatalog((c) => {
      c.catalog.sizes = c.catalog.sizes.map((s) => (s.code === '20 oz' ? { ...s, isActive: false } : s))
      c.catalog.variants = c.catalog.variants.filter((v) => v.size !== '20 oz')
    })
    expect((await one(m, order({ lines: [line({ size: '20 oz' })], totals: { items_subtotal: 45, items_discount: 0, bill_discount: 0, total: 45 } }))).status).toBe('accepted')
  })
  it('grade rules: matcha without grade = INVALID · grade on a non-matcha = INVALID · unknown grade = UNKNOWN_CODE', async () => {
    const m = createMockDayo({ now: NOW })
    const matcha = base.lines[1]!
    expect(await one(m, order({ lines: [{ ...matcha, grade: null }] }))).toMatchObject({ reason: 'INVALID', detail: 'เมนูมัตจะ "Matcha Latte" ต้องระบุเกรด' })
    expect(await one(m, order({ lines: [line({ grade: 'Excellent' })] }))).toMatchObject({ reason: 'INVALID', detail: 'เมนู "Thai Tea" ไม่ใช่มัตจะ — grade ต้องเป็น null' })
    expect(await one(m, order({ lines: [{ ...matcha, grade: 'Gold' }] }))).toMatchObject({ reason: 'UNKNOWN_CODE', detail: 'ไม่พบเกรด "Gold"' })
  })
  it('optional keys may be absent, as dayo_pos_has reads them (shift_id, note, grade, promo fields, bill_discount)', async () => {
    const m = createMockDayo({ now: NOW })
    const { shift_id: _s, note: _n, promo_code: _p, skip_promotion_ids: _k, no_promotions: _x, bill_discount: _b, ...rest } = order().data
    const lines = base.lines.map(({ grade, ...l }) => (grade === null ? l : { ...l, grade }))
    expect((await one(m, { key: `order:${ID}`, kind: 'order', data: { ...rest, lines } })).status).toBe('accepted')
  })
})

describe('dates and clock (0052:348-362, 481-495)', () => {
  it('sale_date = tomorrow (Thai) of the server = deferred CLOCK_AHEAD with dayo\'s detail', async () => {
    const m = createMockDayo({ now: '2026-09-25T16:58:00.000Z' })
    expect(await one(m, order({ sold_at: '2026-09-25T17:01:00.000Z', sale_date: '2026-09-26' }))).toEqual({ key: `order:${ID}`, status: 'deferred', reason: 'CLOCK_AHEAD', detail: 'sale_date 2026-09-26 เป็นวันพรุ่งนี้ของเซิร์ฟเวอร์' })
  })
  it('sold_at more than 5 minutes ahead = CLOCK_AHEAD before the sale_date / Thai date check', async () => {
    const m = createMockDayo({ now: NOW })
    expect(await one(m, order({ sold_at: '2026-09-25T20:00:00.500Z', sale_date: '2026-09-25' }))).toEqual({ key: `order:${ID}`, status: 'deferred', reason: 'CLOCK_AHEAD', detail: 'sold_at 2026-09-25T20:00:00Z เกินเวลาเซิร์ฟเวอร์' })
  })
  it('an order_void older than 60 days = rejected INVALID even when its bill never arrived (not PARENT_PENDING)', async () => {
    const m = createMockDayo({ now: NOW })
    expect(await one(m, voidRow({ voided_at: '2026-07-26T03:15:03.000Z' }))).toEqual({ key: `order_void:${ID}`, status: 'rejected', reason: 'INVALID', detail: 'voided_at 2026-07-26T03:15:03Z ย้อนหลังเกิน 60 วัน' })
    expect(await one(m, voidRow({ voided_at: '2026-07-27T03:15:05.000Z' }))).toMatchObject({ status: 'deferred', reason: 'PARENT_PENDING' }) // just inside 60 × 24 h
  })
})

describe('scopes: a key without the route\'s scope is a 403 of the whole request (dayo auth.ts + api_authenticate 0049:207-214)', () => {
  it('push without orders:write = HTTP 403 DY403, no row judged', async () => {
    const m = createMockDayo({ now: NOW, scopes: ['catalog:read', 'staff:read', 'orders:read'] })
    const r = await m.fetch('http://mock/api/v1/pos/push', { method: 'POST', headers: auth, body: JSON.stringify({ device_time: NOW, rows: [order()] }) })
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ ok: false, error: { code: 'DY403', message: 'forbidden: API key ไม่มีสิทธิ์ orders:write' } })
    expect(m.orders()).toEqual([])
    m.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write'])
    expect((await one(m, order())).status).toBe('accepted')
  })
  it('E1 needs catalog:read and staff:read (missing ones named in order) · E3 needs orders:read', async () => {
    const m = createMockDayo({ now: NOW, scopes: ['orders:read', 'orders:write'] })
    const e1 = await m.fetch('http://mock/api/v1/pos/catalog', { headers: auth })
    expect([e1.status, await e1.json()]).toEqual([403, { ok: false, error: { code: 'DY403', message: 'forbidden: API key ไม่มีสิทธิ์ catalog:read, staff:read' } }])
    m.setScopes(['catalog:read', 'staff:read'])
    const list = await m.fetch('http://mock/api/v1/orders', { headers: auth })
    expect([list.status, await list.json()]).toEqual([403, { ok: false, error: { code: 'DY403', message: 'forbidden: API key ไม่มีสิทธิ์ orders:read' } }])
  })
})

describe('route order: Content-Length 422 → 401 → 403 → 429 (dayo main auth.ts + api_authenticate)', () => {
  it('the legacy forbidden mode answers 403 even with rate_limited\'s retryAfterSec also configured, never 429', async () => {
    const m = createMockDayo({ now: NOW, mode: 'forbidden', retryAfterSec: 5 }) // both rate_limited's and forbidden's settings present at once
    const r = await m.fetch('http://mock/api/v1/orders', { headers: auth })
    expect([r.status, await r.json(), r.headers.get('retry-after')]).toEqual([403, { ok: false, error: { code: 'DY403', message: 'forbidden: API key ไม่มีสิทธิ์ staff:read' } }, null])
  })
  it('rate_limited alone still answers 429 with Retry-After (order swap does not break it)', async () => {
    const m = createMockDayo({ now: NOW, mode: 'rate_limited', retryAfterSec: 5 })
    const r = await m.fetch('http://mock/api/v1/orders', { headers: auth })
    expect([r.status, r.headers.get('retry-after')]).toEqual([429, '5'])
  })
})

describe('promotions closed before sold_at are not applied (ADR-0049 rule 5 · ADR-0053 · dayo_promo_active_at)', () => {
  it('the bill is accepted, computed_total is dayo\'s price without the promotion, amount_mismatch when it differs by more than ฿1', async () => {
    const m = createMockDayo({ now: NOW })
    const v = m.closePromotion('9f8e0000-0000-4000-8000-000000000001', '2026-09-25T03:00:00.000Z') // Thai Tea buy 2 get 1
    expect(v).toBe(43) // closing a promotion changes the catalog like dayo's trigger does…
    const cat = PosCatalogResponse.parse(await (await m.fetch('http://mock/api/v1/pos/catalog', { headers: auth })).json()).data
    expect(cat.changed && cat.catalog.promotions.some((p) => p.id === '9f8e0000-0000-4000-8000-000000000001')).toBe(false) // …and E1 sends active ones only
    const r = await one(m, order()) // the tablet still priced it with the promotion: 155
    expect(r).toMatchObject({ status: 'accepted', data: { computed_total: 190, amount_mismatch: true } })
  })
  it('a promotion closed AFTER sold_at still counts: computed_total = total', async () => {
    const m = createMockDayo({ now: NOW })
    m.closePromotion('9f8e0000-0000-4000-8000-000000000001', '2026-09-25T03:15:04.000Z')
    expect(await one(m, order())).toMatchObject({ status: 'accepted', data: { computed_total: 155, amount_mismatch: false } })
  })
})

describe('check order = dayo_pos_push_row then dayo_pos_order / dayo_pos_void (0052:555-620, 228-447, 452-534)', () => {
  const m0 = () => createMockDayo({ now: NOW })
  it('row level: not an object = INVALID · bad key = BAD_KEY · kind not text = INVALID · kind ≠ key = BAD_KEY', async () => {
    const m = m0()
    expect(await one(m, 7)).toMatchObject({ status: 'rejected', reason: 'INVALID', detail: 'แถวต้องเป็นออบเจกต์ {key, kind, data}' })
    expect(await one(m, { ...order(), key: `Order:${ID}`, kind: 3 })).toMatchObject({ reason: 'BAD_KEY', detail: 'key ต้องเป็นรูป <kind>:<uuid>' })
    expect(await one(m, { ...order(), kind: 3 })).toMatchObject({ reason: 'INVALID', detail: 'kind ต้องเป็นข้อความ' })
    expect(await one(m, { ...order(), kind: 'order_void' })).toMatchObject({ reason: 'BAD_KEY', detail: 'ชนิดใน key ไม่ตรงกับ kind' })
  })
  it('when the sent key is not a string the result key is null, like dayo (0052_pos_push.sql:748), never ""', async () => {
    const m = m0()
    expect(await one(m, 7)).toMatchObject({ key: null, status: 'rejected', reason: 'INVALID' }) // raw itself is not an object
    expect(await one(m, { kind: 'order', data: order().data })).toEqual({ key: null, status: 'rejected', reason: 'BAD_KEY', detail: 'key ต้องเป็นรูป <kind>:<uuid>' }) // key absent
    expect(await one(m, { key: 5, kind: 'order', data: order().data })).toEqual({ key: null, status: 'rejected', reason: 'BAD_KEY', detail: 'key ต้องเป็นรูป <kind>:<uuid>' }) // key not a string
  })
  it('unknown field comes before a bad pos_order_id and before a key/pos_order_id mismatch', async () => {
    const m = m0()
    const extra = { ...order(), data: { ...order().data, tip: 5 } }
    expect(await one(m, { ...extra, data: { ...extra.data, pos_order_id: 'nope' } })).toMatchObject({ status: 'deferred', reason: 'UNSUPPORTED', detail: 'มีฟิลด์ที่ระบบกลางยังไม่รองรับ' })
    expect(await one(m, { ...extra, data: { ...extra.data, pos_order_id: ID2 } })).toMatchObject({ status: 'deferred', reason: 'UNSUPPORTED' })
    expect(await one(m, { ...order(), data: { ...order().data, pos_order_id: ID2 } })).toMatchObject({ status: 'rejected', reason: 'BAD_KEY', detail: 'uuid ใน key ไม่ตรงกับ pos_order_id' })
  })
  it('an unknown sub-key of totals or bill_discount is INVALID (checked in dayo_pos_order, not the field list)', async () => {
    const m = m0()
    expect(await one(m, order({ totals: { ...base.totals, service: 0 } }))).toMatchObject({ reason: 'INVALID', detail: 'totals ต้องมี items_subtotal, items_discount, bill_discount, total เป็นบาท ≥ 0 ทศนิยม ≤ 2 ตำแหน่ง' })
    expect(await one(m, order({ bill_discount: { baht: 5, coupon: 'x' } }))).toMatchObject({ reason: 'INVALID', detail: 'bill_discount ต้องมี baht หรือ percent อย่างเดียว (+ reason)' })
  })
  it('order: staff before codes · channel and payment before menus · dates before the duplicate check', async () => {
    const m = m0()
    expect(await one(m, order({ staff_id: GHOST, channel: 'nope', lines: [line({ code: 'Nope' })] }))).toMatchObject({ reason: 'UNKNOWN_STAFF', detail: 'ไม่พบพนักงานผู้ขายของร้านนี้' })
    expect(await one(m, order({ channel: 'nope', lines: [line({ code: 'Nope' })] }))).toMatchObject({ reason: 'UNKNOWN_CODE', detail: 'ไม่พบช่องทางขาย "nope"' })
    expect(await one(m, order({ payment: 'card', lines: [line({ code: 'Nope' })] }))).toMatchObject({ reason: 'UNKNOWN_CODE', detail: 'ไม่พบวิธีชำระ "card"' })
    m.preloadOrder({ posOrderId: ID, receiptNo: base.receipt_no, saleDate: '2026-07-01', soldAt: '2026-07-01T03:00:00.000Z', orderNo: 'L260701-001', total: 155 })
    expect(await one(m, order({ sale_date: '2026-07-01', sold_at: '2026-07-01T03:00:00.000Z' }))).toMatchObject({ reason: 'INVALID', detail: 'วันขาย 2026-07-01 ย้อนหลังเกิน 60 วัน' })
  })
  it('order_void: staff before the clock · an already cancelled bill is duplicate before the same-day rule', async () => {
    const m = m0()
    expect(await one(m, voidRow({ staff_id: GHOST, voided_at: '2026-09-25T09:00:00.000Z' }))).toMatchObject({ reason: 'UNKNOWN_STAFF', detail: 'ไม่พบพนักงานผู้ยกเลิก/ผู้อนุมัติของร้านนี้' })
    expect((await one(m, order())).status).toBe('accepted')
    m.editPosOrder(ID, { kind: 'cancel', reason: 'ลูกค้ายกเลิก' }) // cancelled on the web (version 2)
    m.setNow('2026-09-26T03:00:00.000Z')
    expect(await one(m, voidRow({ voided_at: '2026-09-26T02:00:00.000Z' }))).toEqual({ key: `order_void:${ID}`, status: 'duplicate', data: { order_no: 'L260925-001', version: 2 } }) // not FORBIDDEN (other day)
  })
})

describe('a row that throws is that row\'s deferred SERVER_ERROR (Task 7 deferred minor · dayo savepoint per row)', () => {
  it('x-dayo-test-raise: XX000:<key> makes only that row fail; the other row is judged normally', async () => {
    const m = createMockDayo({ now: NOW })
    const rows = await push(m, [order(), order({ receipt_no: 'A-000313' }, ID2)], { 'x-dayo-test-raise': `XX000:order:${ID}` })
    expect(rows[0]).toEqual({ key: `order:${ID}`, status: 'deferred', reason: 'SERVER_ERROR', detail: 'SQLSTATE XX000' })
    expect(rows[1]!.status).toBe('accepted')
    expect(m.orders().map((o) => o.posOrderId)).toEqual([ID2]) // the failed row left nothing behind
  })
  it('an unexpected exception inside the judge never fails the whole push', async () => {
    const m = createMockDayo({ now: NOW })
    m.bumpCatalog((c) => { (c as { staff: unknown }).staff = null }) // any row that reaches the staff lookup throws a TypeError
    const rows = await push(m, [order(), voidRow({}, ID2), { key: 'bad' }])
    expect(rows).toEqual([
      { key: `order:${ID}`, status: 'deferred', reason: 'SERVER_ERROR', detail: 'SQLSTATE XX000' },
      { key: `order_void:${ID2}`, status: 'deferred', reason: 'SERVER_ERROR', detail: 'SQLSTATE XX000' },
      { key: 'bad', status: 'rejected', reason: 'BAD_KEY', detail: 'key ต้องเป็นรูป <kind>:<uuid>' },
    ])
  })
})

describe('E3 as list_api_orders ships it (0052:785-846)', () => {
  it('own POS bills carry pos_order_id, dayo_edit null and a non-null updated_at; the tablet\'s own void is not a dayo_edit', async () => {
    const m = createMockDayo({ now: NOW })
    await one(m, order())
    await one(m, voidRow())
    const [o] = await e3(m)
    expect(o).toMatchObject({ order_no: 'L260925-001', status: 'cancelled', version: 2, pos_order_id: ID, dayo_edit: null, updated_at: '2026-09-25T03:15:04.01+00:00', sold_at: '2026-09-25T03:15:03.12+00:00', created_by_name: 'DCm' })
  })
  it('editPosOrder sets dayo_edit (edit then cancel) and bumps the version; without staff:read name and reason are null', async () => {
    const m = createMockDayo({ now: NOW })
    await one(m, order())
    m.editPosOrder(ID, { kind: 'edit', reason: 'ลูกค้าเปลี่ยนเมนู', editedAt: '2026-09-25T04:00:00.000Z', totals: { total: 150 } })
    let [o] = await e3(m)
    expect(o).toMatchObject({ status: 'ok', version: 2, totals: { total: 150 }, updated_at: '2026-09-25T04:00:00+00:00', dayo_edit: { kind: 'edit', edited_at: '2026-09-25T04:00:00+00:00', edited_by_name: 'TungAo', reason: 'ลูกค้าเปลี่ยนเมนู', version: 2 } })
    m.editPosOrder(ID, { kind: 'cancel', reason: 'ลูกค้ายกเลิก', editedByName: 'DCm' })
    ;[o] = await e3(m)
    expect(o).toMatchObject({ status: 'cancelled', version: 3, dayo_edit: { kind: 'cancel', edited_by_name: 'DCm', reason: 'ลูกค้ายกเลิก', version: 3 } })
    expect(await one(m, voidRow())).toMatchObject({ status: 'duplicate', data: { version: 3 } }) // already cancelled on the web
    m.setScopes(['orders:read', 'orders:write'])
    ;[o] = await e3(m)
    expect(o).toMatchObject({ created_by_name: null, dayo_edit: { kind: 'cancel', edited_by_name: null, reason: null, version: 3 } })
  })
  it('updated_since keeps rows touched after it; rows come sale_date desc, order_no desc', async () => {
    const m = createMockDayo({ now: NOW })
    await one(m, order())
    m.setNow('2026-09-25T05:00:00.000Z')
    await one(m, order({ receipt_no: 'A-000313', sold_at: '2026-09-25T04:59:00.000Z' }, ID2))
    expect((await e3(m)).map((o) => o.order_no)).toEqual(['L260925-002', 'L260925-001'])
    const r = OrdersListResponse.parse(await (await m.fetch('http://mock/api/v1/orders?updated_since=2026-09-25T04:00:00%2B00:00', { headers: auth })).json()).data
    expect(r.map((o) => o.order_no)).toEqual(['L260925-002'])
  })
})

describe('HTTP control routes for e2e (server.ts)', () => {
  it('edit-pos-order edits the latest POS bill when no id is given · bump-catalog may replace sizes · scopes · close-promotion', async () => {
    const m = createMockDayo({ now: NOW })
    await one(m, order())
    expect(await mockControl(m, '/__mock/edit-pos-order', { kind: 'cancel', reason: 'ลูกค้ายกเลิก' })).toEqual({ status: 200, body: { ok: true } })
    expect((await e3(m))[0]!.dayo_edit).toMatchObject({ kind: 'cancel', reason: 'ลูกค้ายกเลิก' })
    const sizes = [{ code: '16 oz', label: 'เล็ก', sortOrder: 0, isActive: true }]
    expect(await mockControl(m, '/__mock/bump-catalog', { sizes })).toEqual({ status: 200, body: { catalog_version: 43 } })
    const cat = PosCatalogResponse.parse(await (await m.fetch('http://mock/api/v1/pos/catalog', { headers: auth })).json()).data
    expect(cat.changed && cat.catalog.sizes).toEqual(sizes)
    expect(await mockControl(m, '/__mock/close-promotion', { id: '9f8e0000-0000-4000-8000-000000000004', at: NOW })).toEqual({ status: 200, body: { catalog_version: 44 } })
    expect(await mockControl(m, '/__mock/scopes', { scopes: ['catalog:read'] })).toEqual({ status: 200, body: { ok: true } })
    expect((await m.fetch('http://mock/api/v1/orders', { headers: auth })).status).toBe(403)
    expect(await mockControl(m, '/__mock/nope', null)).toEqual({ status: 404, body: { ok: false } })
  })
})
