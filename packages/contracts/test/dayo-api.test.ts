import { describe, expect, it } from 'vitest'
import {
  Baht, clipCodePoints, fieldsUsed, IsoReceived, isRowSupported, OrderRowData, OrderVoidRowData, PosCatalogUnchanged,
  PushRequest, PushResponse, ReceivedRowResult, rowKey, Text200,
} from '../src/dayo-api.js'
import { OutboxStatus, UserRole } from '../src/enums.js'

/** spec 04 §4.5 example, verbatim. */
export const SPEC_ORDER = {
  pos_order_id: '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21', receipt_no: 'A-000312', queue_no: 12,
  sale_date: '2026-09-25', sold_at: '2026-09-25T03:15:03.120Z', channel: 'store', payment: 'cash',
  staff_id: '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d', catalog_version: 42, shift_id: null,
  lines: [
    { code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 3 },
    { code: 'Matcha Latte', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: 'Excellent', qty: 1 },
  ],
  bill_discount: null, promo_code: null, skip_promotion_ids: [], no_promotions: false,
  totals: { items_subtotal: 190, items_discount: 35, bill_discount: 0, total: 155 }, note: null,
}
const row = (data: object = SPEC_ORDER) => ({ key: `order:${SPEC_ORDER.pos_order_id}`, kind: 'order', data })

describe('E2 request (spec §4.5)', () => {
  it('the spec example is a valid request', () => {
    expect(PushRequest.safeParse({ device_time: '2026-09-25T03:15:03.120Z', rows: [row()] }).success).toBe(true)
  })
  it('key must be <kind>:<pos_order_id>', () => {
    expect(PushRequest.safeParse({ device_time: '2026-09-25T03:15:03.120Z', rows: [{ ...row(), key: 'order:11111111-1111-4111-8111-111111111111' }] }).success).toBe(false)
    expect(rowKey('order_void', SPEC_ORDER.pos_order_id)).toBe(`order_void:${SPEC_ORDER.pos_order_id}`)
  })
  it.each([
    ['sale_date not the Thai date of sold_at', { sale_date: '2026-09-24' }],
    ['milk null', { lines: [{ ...SPEC_ORDER.lines[0], milk: null }] }],
    ['bill discount baht and percent', { bill_discount: { baht: 5, percent: 10, reason: null } }],
    ['line discount baht and percent', { lines: [{ ...SPEC_ORDER.lines[0], discount_baht: 5, discount_percent: 10 }] }],
    ['sold_at without milliseconds', { sold_at: '2026-09-25T03:15:03Z' }],
    ['more than 2 decimals', { totals: { ...SPEC_ORDER.totals, total: 155.001 } }],
    ['unknown field', { tip: 5 }],
    ['21 lines is fine but 51 is not', { lines: Array.from({ length: 51 }, () => SPEC_ORDER.lines[0]) }],
  ])('%s → invalid', (_, over) => {
    expect(OrderRowData.safeParse({ ...SPEC_ORDER, ...over }).success).toBe(false)
  })
  it('a line discount in baht or percent alone is valid', () => {
    expect(OrderRowData.safeParse({ ...SPEC_ORDER, lines: [{ ...SPEC_ORDER.lines[0], discount_baht: 5, discount_percent: null }] }).success).toBe(true)
    expect(OrderRowData.safeParse({ ...SPEC_ORDER, lines: [{ ...SPEC_ORDER.lines[0], discount_percent: 10 }] }).success).toBe(true)
  })
  it('21 lines is a valid order', () => {
    expect(OrderRowData.safeParse({ ...SPEC_ORDER, lines: Array.from({ length: 21 }, () => SPEC_ORDER.lines[0]) }).success).toBe(true)
  })
  it('21 rows is an envelope error', () => {
    expect(PushRequest.safeParse({ device_time: '2026-09-25T03:15:03.120Z', rows: Array.from({ length: 21 }, () => row()) }).success).toBe(false)
  })
  it('order_void needs a reason of 1–200 code points without control characters', () => {
    const v = { pos_order_id: SPEC_ORDER.pos_order_id, voided_at: '2026-09-25T03:20:00.000Z', staff_id: SPEC_ORDER.staff_id, approved_by: null, reason: 'ลูกค้าเปลี่ยนใจ' }
    expect(OrderVoidRowData.safeParse(v).success).toBe(true)
    expect(OrderVoidRowData.safeParse({ ...v, reason: '' }).success).toBe(false)
    expect(OrderVoidRowData.safeParse({ ...v, reason: 'a\u0007b' }).success).toBe(false)
    expect(Text200.safeParse('ก'.repeat(200)).success).toBe(true)
    expect(Text200.safeParse('ก'.repeat(201)).success).toBe(false)
  })
  it('Baht accepts dayo round2 results and refuses 3 decimals', () => {
    expect(Baht.safeParse(0.1 + 0.2).success).toBe(true)
    expect(Baht.safeParse(36.675).success).toBe(false)
  })
})

describe('E2 response is tolerant (spec §4.1 ความเข้ากันได้ · plan-5 ReceivedRowResult)', () => {
  it('accepts a status, reason and fields this build does not know', () => {
    const body = { ok: true, data: { server_time: '2026-09-25T03:15:04.010+00:00', extra: 1, results: [{ key: 'order:x', status: 'quarantined', reason: 'NEW_REASON', detail: 'x'.repeat(900), data: { anything: true }, more: 2 }] } }
    expect(PushResponse.safeParse(body).success).toBe(true)
    expect(ReceivedRowResult.safeParse({ key: 'k', status: 'accepted' }).success).toBe(true)
  })
  it('accepts a null key — dayo sets it null when the sent key was not a string (0052_pos_push.sql:748)', () => {
    const body = { ok: true, data: { server_time: '2026-09-25T03:15:04.010+00:00', results: [{ key: null, status: 'rejected', reason: 'BAD_KEY', detail: 'key ต้องเป็นรูป <kind>:<uuid>' }] } }
    expect(PushResponse.safeParse(body).success).toBe(true)
    expect(ReceivedRowResult.safeParse({ key: null, status: 'rejected' }).success).toBe(true)
  })
})

describe('supported kinds and fields (spec §4.4 rule 10)', () => {
  it('fieldsUsed names nested array keys with a dot, objects by their top key', () => {
    expect(fieldsUsed({ ...SPEC_ORDER, lines: [{ code: 'x', qty: 1, discount_baht: 5 }] })).toEqual([
      'bill_discount', 'catalog_version', 'channel', 'lines', 'lines.code', 'lines.discount_baht', 'lines.qty', 'no_promotions', 'note', 'payment',
      'pos_order_id', 'promo_code', 'queue_no', 'receipt_no', 'sale_date', 'shift_id', 'skip_promotion_ids', 'sold_at', 'staff_id', 'totals',
    ])
  })
  it('a row is held when its kind or any field is missing from the lists', () => {
    const supported = { kinds: ['order'], fields: { order: fieldsUsed(SPEC_ORDER) } }
    expect(isRowSupported('order', SPEC_ORDER, supported)).toBe(true)
    expect(isRowSupported('order', { ...SPEC_ORDER, lines: [{ ...SPEC_ORDER.lines[0], free: true }] }, supported)).toBe(false)
    expect(isRowSupported('order_void', {}, supported)).toBe(false)
  })
})

describe('E1 and time', () => {
  it('parses Postgres timestamps with +00:00 and Z', () => {
    expect(IsoReceived.safeParse('2026-09-25T02:00:00.120+00:00').success).toBe(true)
    expect(IsoReceived.safeParse('2026-09-25T02:00:00Z').success).toBe(true)
  })
  it('the unchanged answer of the spec parses', () => {
    expect(PosCatalogUnchanged.safeParse({ changed: false, catalog_version: 42, server_time: '2026-09-25T02:00:00.120+00:00', pricing: { commit: 'abc', files_sha256: {} }, supported_kinds: ['order', 'order_void'], supported_fields: { order: [], order_void: [] } }).success).toBe(true)
  })
})

describe('enums for block 2', () => {
  it('knows manager and local_only', () => {
    expect(UserRole.options).toEqual(['owner', 'manager', 'staff'])
    expect(OutboxStatus.options).toContain('local_only')
  })
  it('clipCodePoints never splits a surrogate pair', () => {
    expect(clipCodePoints('😀😀😀', 2)).toBe('😀😀')
  })
})
