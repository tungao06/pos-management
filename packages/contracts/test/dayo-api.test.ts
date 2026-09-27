import { describe, expect, it } from 'vitest'
import parityFile from './fixtures/pos-parity.dayo-33c3f7a.json'
import {
  Baht, bangkokDateOf, CentralOrder, clipCodePoints, ClientInfo, fieldsUsed, IsoReceived, isRowSupported, KNOWN_DEFER_REASONS,
  KNOWN_REJECT_REASONS, OrderAcceptedData, OrderLineData, OrderRowData, OrderVoidRowData, OrdersListResponse, ParityFile,
  PosCatalogChanged, PosCatalogLooseData, PosCatalogResponse, PosCatalogUnchanged, PosOrderCatalog, PricingInfo, PushRequest,
  PushResponse, ReceivedRowResult, rowKey, SizeCode, Text200, TimeOfDay,
} from '../src/dayo-api.js'
import { EventType, OutboxStatus, UserRole } from '../src/enums.js'

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
const DEVICE_TIME = '2026-09-25T03:15:03.120Z'

describe('E2 request (spec §4.5 · dayo 0052 dayo_pos_order)', () => {
  it('the spec example is a valid request', () => {
    expect(PushRequest.safeParse({ device_time: DEVICE_TIME, rows: [row()] }).success).toBe(true)
  })
  it('key must be <kind>:<pos_order_id>', () => {
    expect(PushRequest.safeParse({ device_time: DEVICE_TIME, rows: [{ ...row(), key: 'order:11111111-1111-4111-8111-111111111111' }] }).success).toBe(false)
    expect(rowKey('order_void', SPEC_ORDER.pos_order_id)).toBe(`order_void:${SPEC_ORDER.pos_order_id}`)
  })
  it.each([
    ['sale_date not the Thai date of sold_at', { sale_date: '2026-09-24' }],
    ['milk null', { lines: [{ ...SPEC_ORDER.lines[0], milk: null }] }],
    ['bill discount baht and percent', { bill_discount: { baht: 5, percent: 10, reason: null } }],
    ['bill discount with neither', { bill_discount: { reason: 'x' } }],
    ['sold_at without milliseconds', { sold_at: '2026-09-25T03:15:03Z' }],
    ['more than 2 decimals', { totals: { ...SPEC_ORDER.totals, total: 155.001 } }],
    ['unknown field', { tip: 5 }],
    ['unknown totals key', { totals: { ...SPEC_ORDER.totals, fee: 0 } }],
    ['21 lines is fine but 51 is not', { lines: Array.from({ length: 51 }, () => SPEC_ORDER.lines[0]) }],
    ['more than 500 cups', { lines: Array.from({ length: 6 }, () => ({ ...SPEC_ORDER.lines[0], qty: 99 })) }],
    ['size outside the <n> oz format', { lines: [{ ...SPEC_ORDER.lines[0], size: 'big' }] }],
    ['line with discount baht and percent', { lines: [{ ...SPEC_ORDER.lines[0], discount_baht: 5, discount_percent: 10 }] }],
    ['blank note (dayo btrim)', { note: '   ' }],
    ['receipt_no of the wrong shape', { receipt_no: 'L260924-014' }],
  ])('%s → invalid', (_, over) => {
    expect(OrderRowData.safeParse({ ...SPEC_ORDER, ...over }).success).toBe(false)
  })
  it('any configurable cup size in the dayo format is sendable (ADR-0054)', () => {
    expect(OrderRowData.safeParse({ ...SPEC_ORDER, lines: [{ ...SPEC_ORDER.lines[0], size: '22 oz' }] }).success).toBe(true)
  })
  it('21 rows is an envelope error', () => {
    expect(PushRequest.safeParse({ device_time: DEVICE_TIME, rows: Array.from({ length: 21 }, () => row()) }).success).toBe(false)
  })
  it('order_void needs a reason of 1–200 code points without control characters', () => {
    const v = { pos_order_id: SPEC_ORDER.pos_order_id, voided_at: '2026-09-25T03:20:00.000Z', staff_id: SPEC_ORDER.staff_id, approved_by: null, reason: 'ลูกค้าเปลี่ยนใจ' }
    expect(OrderVoidRowData.safeParse(v).success).toBe(true)
    expect(OrderVoidRowData.safeParse({ ...v, reason: '' }).success).toBe(false)
    expect(OrderVoidRowData.safeParse({ ...v, reason: '  ' }).success).toBe(false)
    expect(OrderVoidRowData.safeParse({ ...v, reason: 'a\u0007b' }).success).toBe(false)
    expect(Text200.safeParse('ก'.repeat(200)).success).toBe(true)
    expect(Text200.safeParse('ก'.repeat(201)).success).toBe(false)
    expect(Text200.safeParse('😀'.repeat(200)).success).toBe(true)
  })
  it('Baht = what dayo_pos_is_money accepts: the JSON text has at most 2 decimals', () => {
    for (let s = 0; s <= 100_000; s += 7) expect(Baht.safeParse(s / 100).success).toBe(true)
    expect(Baht.safeParse(99_999_999.99).success).toBe(true)
    expect(Baht.safeParse(Math.round((0.1 + 0.2) * 100) / 100).success).toBe(true)
    // JSON.stringify(0.1 + 0.2) = "0.30000000000000004" → dayo: numeric*100 ≠ trunc → rejected INVALID
    expect(Baht.safeParse(0.1 + 0.2).success).toBe(false)
    expect(Baht.safeParse(36.675).success).toBe(false)
    expect(Baht.safeParse(-1).success).toBe(false)
    expect(Baht.safeParse(100_000_000).success).toBe(false)
  })
  it('OrderLineData grade may be up to 100 characters like dayo', () => {
    expect(OrderLineData.safeParse({ ...SPEC_ORDER.lines[1], grade: 'g'.repeat(100) }).success).toBe(true)
    expect(OrderLineData.safeParse({ ...SPEC_ORDER.lines[1], grade: 'g'.repeat(101) }).success).toBe(false)
  })
})

describe('E2 response is tolerant (spec §4.1 · dayo 0052 api_pos_push)', () => {
  it('accepts a status, reason and fields this build does not know', () => {
    const body = { ok: true, data: { server_time: '2026-09-25T03:15:04.010+00:00', extra: 1, results: [{ key: 'order:x', status: 'quarantined', reason: 'NEW_REASON', detail: 'x'.repeat(900), data: { anything: true }, more: 2 }] } }
    expect(PushResponse.safeParse(body).success).toBe(true)
    expect(ReceivedRowResult.safeParse({ key: 'k', status: 'accepted' }).success).toBe(true)
  })
  it('key is null when the sent row had no string key (0052:748)', () => {
    expect(ReceivedRowResult.safeParse({ key: null, status: 'rejected', reason: 'INVALID', detail: 'แถวต้องเป็นออบเจกต์ {key, kind, data}' }).success).toBe(true)
  })
  it('accepted order data may carry null computed_total / amount_mismatch', () => {
    expect(OrderAcceptedData.safeParse({ order_no: 'S-1', version: 1, computed_total: null, amount_mismatch: null, duplicate_of: [], warnings: [] }).success).toBe(true)
  })
  it('reasons match what dayo emits', () => {
    expect([...KNOWN_REJECT_REASONS].sort()).toEqual(['BAD_KEY', 'CONFLICT', 'FORBIDDEN', 'INVALID', 'UNKNOWN_CODE', 'UNKNOWN_STAFF'])
    expect([...KNOWN_DEFER_REASONS].sort()).toEqual(['BUSY', 'CLOCK_AHEAD', 'PARENT_PENDING', 'SERVER_ERROR', 'UNSUPPORTED'])
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
  it('the lists dayo_pos_supported() returns today accept every field the tablet can send', () => {
    const dayo = {
      kinds: ['order', 'order_void'],
      fields: {
        order: ['pos_order_id', 'receipt_no', 'queue_no', 'sale_date', 'sold_at', 'channel', 'payment', 'staff_id', 'catalog_version', 'shift_id', 'lines', 'lines.code', 'lines.size', 'lines.sweetness', 'lines.milk', 'lines.grade', 'lines.qty', 'lines.free', 'lines.discount_baht', 'lines.discount_percent', 'lines.discount_reason', 'bill_discount', 'promo_code', 'skip_promotion_ids', 'no_promotions', 'totals', 'note'],
        order_void: ['pos_order_id', 'voided_at', 'staff_id', 'approved_by', 'reason'],
      },
    }
    const full = { ...SPEC_ORDER, lines: [{ ...SPEC_ORDER.lines[0], free: false, discount_baht: 1, discount_percent: null, discount_reason: 'x' }] }
    expect(OrderRowData.safeParse(full).success).toBe(true)
    expect(isRowSupported('order', full, dayo)).toBe(true)
  })
})

// ── E1 (dayo 0049 api_pos_catalog + 0048 dayo_impl_get_full_catalog) ────────────────────────────────────────────────
const STAFF_ID = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d'
const variant = (over: object = {}) => ({
  menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', family: 'ชาไทย', categoryLabel: 'ชาไทย', menuSortOrder: 0, size: '16 oz', sweetness: '50%', price: 35,
  allowOatMilk: false, isMatcha: false, recipeLines: [{ ingredientId: 'i1', baseId: null, qty: 150, unit: 'ml' }], ...over,
})
const catalog = (over: object = {}) => ({
  settings: { shopName: 'DA-YO', defaultSize: '16 oz', defaultSweetness: '100%', defaultChannelCode: 'store', defaultMilk: 'fresh', maxQtyPerLine: 99, backdateDays: 7, recentOrdersCount: 5 },
  sizes: [
    { code: '16 oz', label: '16 oz', sortOrder: 0, isActive: true },
    { code: '20 oz', label: '20 oz', sortOrder: 1, isActive: true },
    { code: '22 oz', label: '22 oz', sortOrder: 2, isActive: false },
  ],
  variants: [variant(), variant({ menuCode: 'Other', categoryLabel: null })],
  ingredients: { i1: { id: 'i1', code: 'RM-1', name: 'ชาไทยเบส', useUnit: 'ml' } },
  bases: {},
  milkOptions: [{ code: 'fresh', ingredientId: null, priceAdd: 0, aliases: [] }],
  gradeOptions: [{ code: 'Excellent', ingredientId: 'i1', multiplier: null, priceAdd: 0, isDefault: true, aliases: [] }],
  channels: [{ code: 'store', name: 'หน้าร้าน', aliases: [], priceMarkupPct: 0, priceAddBaht: 0, rounding: 'ceil_baht', feePct: 0, defaultPaymentMethodCode: null }],
  paymentMethods: [{ code: 'cash', name: 'เงินสด', aliases: [] }],
  promotions: [{
    id: 'p1', code: null, name: 'บ่าย', kind: 'item_discount', startsOn: null, endsOn: null, daysOfWeek: null, timeFrom: '14:00:00', timeTo: '17:00:00',
    channelCodes: [], requiresCode: false, autoApply: true, priority: 1, stackable: true, isActive: true, params: { menu_codes: ['Thai Tea'], amount_baht: 5 },
  }],
  ...over,
})
const head = {
  catalog_version: 42, server_time: '2026-09-25T02:00:00.120+00:00', pricing: { commit: null, files_sha256: {} },
  supported_kinds: ['order', 'order_void'], supported_fields: { order: [], order_void: [] },
}
const changed = (cat: unknown = catalog()) => ({
  changed: true, ...head, client: { name: 'DA-YO', last_receipt_no: 'L260924-014' },
  staff: [{ id: STAFF_ID, display_name: null, role: 'manager', active: true }], catalog: cat,
})

describe('E1 and time', () => {
  it('parses Postgres timestamps with +00:00 and Z, any fraction length', () => {
    expect(IsoReceived.safeParse('2026-09-25T02:00:00.120+00:00').success).toBe(true)
    expect(IsoReceived.safeParse('2026-09-25T03:15:03.12+00:00').success).toBe(true)
    expect(IsoReceived.safeParse('2026-09-24T21:00:00+07:00').success).toBe(true)
    expect(IsoReceived.safeParse('2026-09-25T02:00:00Z').success).toBe(true)
    expect(IsoReceived.safeParse('2026-09-25 02:00:00+00').success).toBe(false)
  })
  it('the unchanged answer of the spec parses', () => {
    expect(PosCatalogUnchanged.safeParse({ changed: false, ...head, pricing: { commit: 'abc', files_sha256: {} } }).success).toBe(true)
  })
  it('the changed answer with sizes, categoryLabel null, HH:MM:SS, commit null and a raw last_receipt_no parses', () => {
    const r = PosCatalogResponse.safeParse({ ok: true, data: changed() })
    expect(r.success).toBe(true)
  })
  it('SizeCode = the cup_sizes CHECK ^[1-9][0-9]{0,2} oz$', () => {
    for (const ok of ['16 oz', '20 oz', '22 oz', '1 oz', '999 oz']) expect(SizeCode.safeParse(ok).success).toBe(true)
    for (const bad of ['big', '0 oz', '16oz', '1000 oz', '016 oz', '16 OZ', ' 16 oz']) expect(SizeCode.safeParse(bad).success).toBe(false)
    expect(PosOrderCatalog.safeParse(catalog({ variants: [variant({ size: 'big' })] })).success).toBe(false)
    expect(PosOrderCatalog.safeParse(catalog({ variants: [variant({ size: '0 oz' })] })).success).toBe(false)
  })
  it('a catalog without sizes is refused', () => {
    const { sizes: _drop, ...noSizes } = catalog()
    expect(PosOrderCatalog.safeParse(noSizes).success).toBe(false)
    expect(PosCatalogChanged.safeParse(changed(noSizes)).success).toBe(false)
  })
  it('the loose parse keeps staff when the catalog is unreadable (ruling R12)', () => {
    const r = PosCatalogLooseData.safeParse(changed({ nonsense: true }))
    expect(r.success).toBe(true)
    expect(PosCatalogChanged.safeParse(changed({ nonsense: true })).success).toBe(false)
  })
  it('TimeOfDay accepts HH:MM and Postgres time text', () => {
    for (const ok of ['17:00', '17:00:00', '17:00:00.5']) expect(TimeOfDay.safeParse(ok).success).toBe(true)
    for (const bad of ['1700', '7:00', '17:00:0']) expect(TimeOfDay.safeParse(bad).success).toBe(false)
  })
  it('pricing.commit and client.last_receipt_no are taken as dayo sends them', () => {
    expect(PricingInfo.safeParse({ commit: 'v1.3.0 (a8e3ff0)', files_sha256: {} }).success).toBe(true)
    expect(PricingInfo.safeParse({ commit: null, files_sha256: {} }).success).toBe(true)
    expect(ClientInfo.safeParse({ name: 'x', last_receipt_no: null }).success).toBe(true)
    expect(ClientInfo.safeParse({ name: 'x', last_receipt_no: 'anything-else' }).success).toBe(true)
  })
})

// ── E3 (dayo 0052 list_api_orders + 0051 dayo_order_dayo_edit) ─────────────────────────────────────────────────────
const central = (over: object = {}) => ({
  order_no: 'S-260925-001', sale_date: '2026-09-25', status: 'paid', source: 'pos', external_ref: 'A-000312', version: 2,
  channel: 'store', payment: 'cash', totals: { items_subtotal: 190, items_discount: 35, bill_discount: 0, total: 155, fee: 0 },
  amount_mismatch: false, updated_at: '2026-09-25T03:15:04.01+00:00', sold_at: '2026-09-25T03:15:03.12+00:00', created_by_name: null,
  pos_receipt_no: 'A-000312', pos_queue_no: 12, pos_order_id: SPEC_ORDER.pos_order_id, catalog_version: 42, duplicate_suspect: false, dayo_edit: null,
  ...over,
})

describe('E3 orders list', () => {
  it('an order with and without dayo_edit both parse', () => {
    const edit = { kind: 'edit', edited_at: '2026-09-25T14:00:00.5+00:00', edited_by_name: 'เจ้าของร้าน', reason: 'แก้ช่องทาง', version: 2 }
    const cancel = { kind: 'cancel', edited_at: '2026-09-25T14:00:00+00:00', edited_by_name: null, reason: null, version: 3 }
    expect(CentralOrder.safeParse(central({ dayo_edit: edit })).success).toBe(true)
    expect(CentralOrder.safeParse(central({ dayo_edit: cancel })).success).toBe(true)
    expect(CentralOrder.safeParse(central()).success).toBe(true)
    const { dayo_edit: _e, pos_order_id: _p, ...bare } = central()
    expect(CentralOrder.safeParse(bare).success).toBe(true)
    expect(CentralOrder.safeParse(central({ pos_order_id: null, source: 'bot', pos_receipt_no: null, pos_queue_no: null })).success).toBe(true)
    expect(OrdersListResponse.safeParse({ ok: true, data: [central({ dayo_edit: edit }), central({ order_no: 'S-2' })] }).success).toBe(true)
  })
  it('a malformed dayo_edit is refused', () => {
    expect(CentralOrder.safeParse(central({ dayo_edit: { kind: 'edit' } })).success).toBe(false)
  })
})

describe('parity file (dayo scripts/export-pos-parity.ts)', () => {
  it('the real pos-parity.json of dayo parses, and so does its catalog on its own', () => {
    const parsed = ParityFile.parse(parityFile)
    expect(parsed.cases.length).toBeGreaterThan(0)
    expect(parsed.cases.every((c) => c.spec.length > 0)).toBe(true)
    expect(PosOrderCatalog.safeParse(parityFile.catalog).success).toBe(true)
  })
})

describe('enums for block 2', () => {
  it('knows manager and local_only', () => {
    expect(UserRole.options).toEqual(['owner', 'manager', 'staff'])
    expect(OutboxStatus.options).toEqual(['pending', 'sent', 'dead', 'local_only'])
  })
  it('has the owner-remedy events of the "ส่งไม่ผ่าน" page', () => {
    for (const e of ['RECEIPT_RENUMBERED', 'CODE_REMAPPED', 'STAFF_REMAPPED', 'EXCLUDED_FROM_SYNC']) expect(EventType.options).toContain(e)
  })
})

describe('helpers', () => {
  it('clipCodePoints never splits a surrogate pair', () => {
    expect(clipCodePoints('😀😀😀', 2)).toBe('😀😀')
    expect(clipCodePoints('abc', 5)).toBe('abc')
  })
  it('bangkokDateOf is the Thai date', () => {
    expect(bangkokDateOf('2026-09-24T16:59:59.999Z')).toBe('2026-09-24')
    expect(bangkokDateOf('2026-09-24T17:00:00.000Z')).toBe('2026-09-25')
    expect(bangkokDateOf('2026-09-25T00:30:00+07:00')).toBe('2026-09-25')
  })
})
