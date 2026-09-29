// Block 3 contract (spec 04 §4.10 · §4.4 rules 6, 10 · §4.5 rule 6 · §4.11 · C11 · C13 · D84) as dayo main 12885fe shipped it:
// ADR-0069 phase 1 = the 4 shift kinds + E4 + E1 last_z_* (0065–0067) · order_off_catalog is phase 2 (preflight rulings P1/P3).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BLOCK3_PHASE1_KINDS, BLOCK3_PHASE1_SUPPORTED_FIELDS, BLOCK3_PHASE2_KINDS, BLOCK3_PHASE2_SUPPORTED_FIELDS, BLOCK3_SUPPORTED_FIELDS, BOT_ORDER_NO_RE,
  CASH_DENOMINATIONS_BAHT, CashCountRowData, isPosText, CashMovementRowData, ClientInfo, detailPrefix, DETAIL_PREFIXES, ExistsConflictData, fieldsUsed, Hex64,
  KIND_ID_FIELD, KIND_SCOPE, KNOWN_REJECT_REASONS, laneOf, OrderOffCatalogRowData, PUSH_KINDS, PushRequest, PushRow, rowKey, SHIFT_LANE_KINDS,
  ShiftCashParityFile, ShiftCashResponse, ShiftCloseRowData, ShiftOpenRowData, ZReportData,
} from '../src/dayo-api.js'

const S = '5a5a5a5a-0000-4000-8000-000000000001'
const U = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'
const O = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21'
const M = '6b6b6b6b-0000-4000-8000-000000000001'
const C = '7c7c7c7c-0000-4000-8000-000000000001'
const H = 'ab'.repeat(32)
export const SAMPLE = {
  shift_open: { shift_id: S, business_date: '2026-09-25', opened_at: '2026-09-25T02:00:00.000Z', opened_by: U, opening_float: 500, quick_open: false },
  cash_movement: { movement_id: M, shift_id: S, kind: 'PAID_OUT', amount: 20, pos_order_id: null, reason: 'ซื้อน้ำแข็ง', created_by: U, created_at: '2026-09-25T04:00:00.000Z' },
  cash_count: { count_id: C, shift_id: S, lines: [1000, 500, 100, 50, 20, 10, 5, 2, 1].map((d) => ({ denomination: d, count: d === 500 ? 1 : d === 100 ? 1 : d === 10 ? 1 : d === 5 ? 1 : 0 })), counted: 615, counted_by: U, counted_at: '2026-09-25T12:00:00.000Z' },
  shift_close: {
    shift_id: S, count_id: C, closed_by: U, closed_at: '2026-09-25T12:05:00.000Z', variance_reason: null,
    z_report: {
      z_no: 1, hash: H, prev_hash: null, variance_alert: 20, chain_warning: false,
      cash: { opening_float: 500, pos_cash_sales: 45, void_refunds: 0, paid_in: 0, paid_out: 0, drops: 0, drawer_expenses: 0, bot_cash: 70 },
      counted: 615, bot_window: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:00.000Z' }, movement_ids: [],
      bot_bills: [{ order_no: 'L260925-901', version: 1, total: 70 }],
      pos_bills: [{ pos_order_id: O, receipt_no: 'A-000001', payment: 'cash', total: 45, sold_at: '2026-09-25T03:00:00.000Z', voided_at: null }],
    },
  },
  order_off_catalog: {
    pos_order_id: O, receipt_no: 'A-000001', queue_no: 1, sale_date: '2026-09-25', sold_at: '2026-09-25T03:00:00.000Z', channel: 'store', payment: 'cash',
    staff_id: U, catalog_version: 42, shift_id: S, note: null,
    lines: [{ code: 'Thai Tea', name: 'ชาไทย', size: '16 oz', sweetness: '50%', qty: 3, unit_price: 35, discount_per_cup: 0, line_total: 105 }],
    totals: { items_subtotal: 105, items_discount: 0, bill_discount: 35, total: 70 }, closed_by: U, closed_at: '2026-09-26T02:00:00.000Z', reason: 'เมนูถูกลบ', original_reason: 'UNKNOWN_CODE',
  },
} as const

describe('block 3 push rows (spec 04 §4.10)', () => {
  it.each(Object.entries(SAMPLE))('%s parses and uses only supported fields', (kind, data) => {
    const idField = { shift_open: 'shift_id', cash_movement: 'movement_id', cash_count: 'count_id', shift_close: 'shift_id', order_off_catalog: 'pos_order_id' }[kind]!
    const row = PushRow.parse({ key: `${kind}:${(data as unknown as Record<string, string>)[idField]}`, kind, data })
    expect(row.kind).toBe(kind)
    const allowed = BLOCK3_SUPPORTED_FIELDS[kind as keyof typeof BLOCK3_SUPPORTED_FIELDS] as readonly string[]
    expect(fieldsUsed(data as Record<string, unknown>).filter((f) => !allowed.includes(f))).toEqual([])
  })
  it('the key must carry the kind\'s own id field', () => {
    expect(PushRow.safeParse({ key: `cash_movement:${S}`, kind: 'cash_movement', data: SAMPLE.cash_movement }).success).toBe(false)
  })
  it('shift_open: business_date is the Thai date of opened_at', () => {
    expect(ShiftOpenRowData.safeParse({ ...SAMPLE.shift_open, opened_at: '2026-09-25T17:00:00.000Z' }).success).toBe(false)
  })
  it('cash_movement: VOID_REFUND ⇔ pos_order_id; a reason for the rest; amount > 0', () => {
    expect(CashMovementRowData.safeParse({ ...SAMPLE.cash_movement, kind: 'VOID_REFUND' }).success).toBe(false)
    expect(CashMovementRowData.safeParse({ ...SAMPLE.cash_movement, reason: null }).success).toBe(false)
    expect(CashMovementRowData.safeParse({ ...SAMPLE.cash_movement, kind: 'VOID_REFUND', pos_order_id: O, reason: null }).success).toBe(true)
    expect(CashMovementRowData.safeParse({ ...SAMPLE.cash_movement, amount: 0 }).success).toBe(false)
  })
  it('cash_count: nine denominations once each, counted = Σ', () => {
    expect(CashCountRowData.safeParse({ ...SAMPLE.cash_count, counted: 614 }).success).toBe(false)
    expect(CashCountRowData.safeParse({ ...SAMPLE.cash_count, lines: SAMPLE.cash_count.lines.slice(1) }).success).toBe(false)
  })
  it('shift_close: bot bills add up to bot_cash; unknown sub-keys are refused (S28)', () => {
    const z = SAMPLE.shift_close.z_report
    expect(ShiftCloseRowData.safeParse({ ...SAMPLE.shift_close, z_report: { ...z, cash: { ...z.cash, bot_cash: 71 } } }).success).toBe(false)
    expect(ShiftCloseRowData.safeParse({ ...SAMPLE.shift_close, z_report: { ...z, cash: { ...z.cash, tips: 0 } } }).success).toBe(false)
    expect(ShiftCloseRowData.safeParse({ ...SAMPLE.shift_close, z_report: { ...z, bot_window: { after: z.bot_window.until, until: z.bot_window.until } } }).success).toBe(false)
  })
  it('order_off_catalog: the totals must follow the shared formula', () => {
    const t = SAMPLE.order_off_catalog.totals
    expect(OrderOffCatalogRowData.safeParse({ ...SAMPLE.order_off_catalog, totals: { ...t, total: 71 } }).success).toBe(false)
    expect(OrderOffCatalogRowData.safeParse({ ...SAMPLE.order_off_catalog, totals: { ...t, bill_discount: 106, total: 0 } }).success).toBe(false)
    expect(OrderOffCatalogRowData.safeParse({ ...SAMPLE.order_off_catalog, lines: [{ ...SAMPLE.order_off_catalog.lines[0], line_total: 104 }] }).success).toBe(false)
  })
  it('order_off_catalog: line texts are dayo text (code points, no control, well-formed, not blank) — Task 3 fix round 1', () => {
    const l = SAMPLE.order_off_catalog.lines[0]
    const withLine = (o: Record<string, unknown>) => OrderOffCatalogRowData.safeParse({ ...SAMPLE.order_off_catalog, lines: [{ ...l, ...o }] }).success
    const tea = '\u{1F375}' // one code point, two UTF-16 units
    expect(withLine({ name: tea.repeat(100) })).toBe(true)
    expect(withLine({ name: tea.repeat(101) })).toBe(false)
    expect(withLine({ name: 'Thai\u0000Tea' })).toBe(false)
    expect(withLine({ name: '\ud83c' })).toBe(false)
    expect(withLine({ name: '   ' })).toBe(false)
    expect(withLine({ code: tea.repeat(40) })).toBe(true)
    expect(withLine({ code: tea.repeat(41) })).toBe(false)
    expect(withLine({ code: 'Thai\tTea' })).toBe(false)
    expect(withLine({ size: tea.repeat(20), sweetness: tea.repeat(10) })).toBe(true)
    expect(withLine({ size: tea.repeat(21) })).toBe(false)
    expect(withLine({ sweetness: '\u007f' })).toBe(false)
    expect(withLine({ code: null, size: null, sweetness: null })).toBe(true)
  })
  it('isPosText is the one text rule (dayo_pos_is_text)', () => {
    expect(isPosText('abcde', 5)).toBe(true)
    expect(isPosText('abcdef', 5)).toBe(false)
    expect(isPosText('', 5)).toBe(false)
    expect(isPosText(' a ', 5)).toBe(true)
    expect(isPosText('a\nb', 5)).toBe(false)
    expect(isPosText('\udc00', 5)).toBe(false)
  })
})

describe('verdicts, prefixes, lanes (spec 04 §4.10 · §6.2)', () => {
  it('reads the machine prefix only', () => {
    expect(detailPrefix('scope: API key ไม่มีสิทธิ์ shift:write')).toBe('scope:')
    expect(detailPrefix('off_catalog_exists: L260925-014 …')).toBe('off_catalog_exists:')
    expect(detailPrefix('exists: L260925-014')).toBe('exists:')
    expect(detailPrefix('data_conflict: ยอดนับในใบปิดกะไม่ตรงกับการนับในระบบกลาง')).toBe('data_conflict:')
    expect(detailPrefix('เลขใบเสร็จ A-000312 ถูกใช้แล้ว')).toBeNull()
    expect(detailPrefix(undefined)).toBeNull()
  })
  it('ALREADY_PRESENT is gone (C13)', () => {
    expect(KNOWN_REJECT_REASONS as readonly string[]).not.toContain('ALREADY_PRESENT')
  })
  it('lanes: shift kinds in one lane, bills in the other', () => {
    expect(['shift_open', 'cash_movement', 'cash_count', 'shift_close'].map(laneOf)).toEqual(['shift', 'shift', 'shift', 'shift'])
    expect(['order', 'order_void', 'order_off_catalog', 'something_new'].map(laneOf)).toEqual(['bill', 'bill', 'bill', 'bill'])
  })
  it('exists: data is read from data, never from detail', () => {
    expect(ExistsConflictData.parse({ order_no: 'L260925-014', version: 2, reported_total: 70, payment_is_cash: true, off_catalog: false })).toMatchObject({ order_no: 'L260925-014' })
  })
  it('E1 client: last_z_* optional, raw (a bad value must not throw E1 away)', () => {
    expect(ClientInfo.parse({ name: 'x', last_receipt_no: null })).toBeTruthy()
    expect(ClientInfo.parse({ name: 'x', last_receipt_no: null, last_z_no: 41, last_z_hash: H, last_z_until: '2026-09-24T12:00:00.000Z' })).toMatchObject({ last_z_no: 41, last_z_until: '2026-09-24T12:00:00.000Z' })
    expect(ClientInfo.parse({ name: 'x', last_receipt_no: null, last_z_no: 41, last_z_hash: 'garbage', last_z_until: 'not a time' }).last_z_hash).toBe('garbage')
  })
  it('E4 answer parses; created_by_name may be null', () => {
    const r = ShiftCashResponse.parse({ ok: true, data: { bills: [{ order_no: 'L260925-901', version: 1, source: 'line', sold_at: '2026-09-25T04:00:00+00:00', total: 70, created_by_name: null }], cash_total: 70 } })
    expect(r.data.cash_total).toBe(70)
  })
  it('the parity fixture parses', () => {
    const f = ShiftCashParityFile.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/parity/pos-shift-cash-parity.json', import.meta.url)), 'utf8')))
    expect(f.cases.length).toBeGreaterThanOrEqual(8)
  })
})

// ── what dayo main 12885fe actually does (preflight-dayo-delta C1–C60 · rulings P1/P3/P6/P7) ─────────────────────────────
const DAYO_SHIFT_CLOSE = 'dayo supabase/migrations/0066_pos_push_shift_kinds.sql'
const zOf = (over: Record<string, unknown>) => ({ ...SAMPLE.shift_close, z_report: { ...SAMPLE.shift_close.z_report, ...over } })

describe('kinds, id fields, scopes, supported fields vs dayo phase 1', () => {
  it('seven push kinds; the four shift kinds are the shift lane', () => {
    expect([...PUSH_KINDS]).toEqual(['order', 'order_void', 'shift_open', 'cash_movement', 'cash_count', 'shift_close', 'order_off_catalog'])
    expect([...SHIFT_LANE_KINDS]).toEqual(['shift_open', 'cash_movement', 'cash_count', 'shift_close'])
  })
  it('KIND_ID_FIELD = dayo_pos_id_field (0066:38-46)', () => {
    expect(KIND_ID_FIELD).toEqual({ order: 'pos_order_id', order_void: 'pos_order_id', shift_open: 'shift_id', cash_movement: 'movement_id', cash_count: 'count_id', shift_close: 'shift_id', order_off_catalog: 'pos_order_id' })
  })
  it('KIND_SCOPE: shift:write for exactly the shift kinds (dayo_pos_is_shift_kind 0066:48-53, 0066:672-675)', () => {
    expect(PUSH_KINDS.filter((k) => KIND_SCOPE[k] === 'shift:write')).toEqual([...SHIFT_LANE_KINDS])
    expect(PUSH_KINDS.filter((k) => KIND_SCOPE[k] === 'orders:write')).toEqual(['order', 'order_void', 'order_off_catalog'])
  })
  it('rowKey is the one block 2 already had (P6) and covers every kind', () => {
    expect(rowKey('cash_count', C)).toBe(`cash_count:${C}`)
  })
  it('phase 1 = the four shift kinds dayo_pos_supported() advertises (0066:594-608) — never order_off_catalog (P1)', () => {
    expect([...BLOCK3_PHASE1_KINDS]).toEqual([...SHIFT_LANE_KINDS])
    expect(BLOCK3_PHASE1_KINDS as readonly string[]).not.toContain('order_off_catalog')
    expect(Object.keys(BLOCK3_PHASE1_SUPPORTED_FIELDS).sort()).toEqual([...SHIFT_LANE_KINDS].sort())
    const dayo: Record<string, string[]> = {
      shift_open: ['shift_id', 'business_date', 'opened_at', 'opened_by', 'opening_float', 'quick_open'],
      cash_movement: ['movement_id', 'shift_id', 'kind', 'amount', 'pos_order_id', 'reason', 'created_by', 'created_at'],
      cash_count: ['count_id', 'shift_id', 'lines', 'lines.denomination', 'lines.count', 'counted', 'counted_by', 'counted_at'],
      shift_close: ['shift_id', 'count_id', 'closed_by', 'closed_at', 'variance_reason', 'z_report'],
    }
    for (const k of SHIFT_LANE_KINDS) expect([...BLOCK3_PHASE1_SUPPORTED_FIELDS[k]]).toEqual([...dayo[k]!].sort())
  })
  it('phase 2 = order_off_catalog alone; BLOCK3_SUPPORTED_FIELDS is both phases', () => {
    expect([...BLOCK3_PHASE2_KINDS]).toEqual(['order_off_catalog'])
    expect(Object.keys(BLOCK3_PHASE2_SUPPORTED_FIELDS)).toEqual(['order_off_catalog'])
    expect(BLOCK3_SUPPORTED_FIELDS).toEqual({ ...BLOCK3_PHASE1_SUPPORTED_FIELDS, ...BLOCK3_PHASE2_SUPPORTED_FIELDS })
  })
  it('every field list is sorted and has no duplicates', () => {
    for (const list of Object.values(BLOCK3_SUPPORTED_FIELDS)) expect([...list]).toEqual([...new Set(list)].sort())
  })
  it('a whole push request of every kind parses (the request stays ≤ 20 rows)', () => {
    const rows = Object.entries(SAMPLE).map(([kind, data]) => ({ key: rowKey(kind as keyof typeof KIND_ID_FIELD, (data as unknown as Record<string, string>)[KIND_ID_FIELD[kind as keyof typeof KIND_ID_FIELD]]!), kind, data }))
    expect(PushRequest.safeParse({ device_time: '2026-09-25T12:06:00.000Z', rows }).success).toBe(true)
  })
})

describe('shift rows follow what dayo rejects INVALID', () => {
  it('cash_count: denominations exactly 1000…1 (0066:253-272) — a foreign note or a count past 99 999 is refused', () => {
    expect([...CASH_DENOMINATIONS_BAHT]).toEqual([1000, 500, 100, 50, 20, 10, 5, 2, 1])
    const lines = SAMPLE.cash_count.lines.map((l) => (l.denomination === 2 ? { denomination: 3, count: 0 } : l))
    expect(CashCountRowData.safeParse({ ...SAMPLE.cash_count, lines }).success).toBe(false)
    const big = SAMPLE.cash_count.lines.map((l) => (l.denomination === 1 ? { denomination: 1, count: 100_000 } : l))
    expect(CashCountRowData.safeParse({ ...SAMPLE.cash_count, lines: big, counted: 615 + 100_000 }).success).toBe(false)
    const twice = SAMPLE.cash_count.lines.map((l) => (l.denomination === 2 ? { denomination: 1, count: 0 } : l))
    expect(CashCountRowData.safeParse({ ...SAMPLE.cash_count, lines: twice }).success).toBe(false)
  })
  it('cash_count: a large count still adds up exactly', () => {
    const lines = CASH_DENOMINATIONS_BAHT.map((d) => ({ denomination: d, count: 50_000 }))
    expect(CashCountRowData.safeParse({ ...SAMPLE.cash_count, lines, counted: 1688 * 50_000 }).success).toBe(true)
  })
  it('cash_movement: a non-VOID_REFUND with a pos_order_id is refused (0066:172-174)', () => {
    expect(CashMovementRowData.safeParse({ ...SAMPLE.cash_movement, pos_order_id: O }).success).toBe(false)
    expect(CashMovementRowData.safeParse({ ...SAMPLE.cash_movement, kind: 'TIP' }).success).toBe(false)
  })
  it(`shift_close: bot_bills.order_no is ^L\\d{6}-\\d{3,}$ (${DAYO_SHIFT_CLOSE}:421 · P7)`, () => {
    expect(BOT_ORDER_NO_RE.source).toBe('^L\\d{6}-\\d{3,}$')
    const bill = (order_no: string) => ShiftCloseRowData.safeParse(zOf({ bot_bills: [{ order_no, version: 1, total: 70 }] })).success
    expect(bill('L260925-1234')).toBe(true)
    expect(bill('L260925-01')).toBe(false)
    expect(bill('X260925-901')).toBe(false)
    expect(bill('A-000001')).toBe(false)
  })
  it(`shift_close: no duplicate bot bill, movement or POS bill (${DAYO_SHIFT_CLOSE}:410-414, 427-429, 448)`, () => {
    const b = { order_no: 'L260925-901', version: 1, total: 35 }
    expect(ShiftCloseRowData.safeParse(zOf({ bot_bills: [b, b] })).success).toBe(false)
    expect(ShiftCloseRowData.safeParse(zOf({ movement_ids: [M, M] })).success).toBe(false)
    const p = SAMPLE.shift_close.z_report.pos_bills[0]
    expect(ShiftCloseRowData.safeParse(zOf({ pos_bills: [p, { ...p, receipt_no: 'A-000002' }] })).success).toBe(false)
  })
  it(`shift_close: drawer_expenses must be 0 in block 3 (${DAYO_SHIFT_CLOSE}:398-400)`, () => {
    const z = SAMPLE.shift_close.z_report
    expect(ShiftCloseRowData.safeParse(zOf({ cash: { ...z.cash, drawer_expenses: 1 } })).success).toBe(false)
  })
  it('shift_close: hash lowercase hex 64, prev_hash null or the same; z_no an int ≥ 1 (0066:382-387)', () => {
    expect(Hex64.safeParse('AB'.repeat(32)).success).toBe(false)
    expect(ShiftCloseRowData.safeParse(zOf({ prev_hash: H, z_no: 2 })).success).toBe(true)
    expect(ShiftCloseRowData.safeParse(zOf({ hash: 'ab'.repeat(31) })).success).toBe(false)
    expect(ShiftCloseRowData.safeParse(zOf({ z_no: 0 })).success).toBe(false)
    expect(ShiftCloseRowData.safeParse(zOf({ z_no: 2_147_483_648 })).success).toBe(false)
  })
  it('shift_close: all eleven z_report keys are required', () => {
    const { pos_bills: _, ...z } = SAMPLE.shift_close.z_report
    expect(ShiftCloseRowData.safeParse({ ...SAMPLE.shift_close, z_report: z }).success).toBe(false)
    expect(ZReportData.safeParse(SAMPLE.shift_close.z_report).success).toBe(true)
  })
  it('garbage never throws — safeParse always answers', () => {
    const junk = [null, 7, 'x', [], {}, { opened_at: 'nope', business_date: 3 }, { lines: 'x', counted: 'y' }, { z_report: { bot_bills: 'x', cash: null, bot_window: 1 } }]
    for (const s of [ShiftOpenRowData, CashMovementRowData, CashCountRowData, ShiftCloseRowData, OrderOffCatalogRowData, ZReportData]) {
      for (const j of junk) expect(() => s.safeParse(j)).not.toThrow()
    }
    expect(() => ShiftOpenRowData.safeParse({ ...SAMPLE.shift_open, opened_at: '2026-13-45T99:00:00.000Z' })).not.toThrow()
    expect(() => OrderOffCatalogRowData.safeParse({ ...SAMPLE.order_off_catalog, sold_at: 'x', lines: [null] })).not.toThrow()
    for (const r of [{ kind: 'shift_open' }, { key: 'x', kind: 'nope', data: {} }, { key: `shift_open:${S}`, kind: 'shift_open', data: null }]) expect(() => PushRow.safeParse(r)).not.toThrow()
  })
})

describe('what the tablet receives stays tolerant', () => {
  it('E1 last_z_until in dayo\'s "+00:00" form is kept as is (0067:155 · P7)', () => {
    expect(ClientInfo.parse({ name: 'x', last_receipt_no: null, last_z_no: 3, last_z_hash: H, last_z_until: '2026-09-24T12:00:00.000+00:00' }).last_z_until).toBe('2026-09-24T12:00:00.000+00:00')
    expect(ClientInfo.parse({ name: 'x', last_receipt_no: null, last_z_no: null, last_z_hash: null, last_z_until: null })).toMatchObject({ last_z_no: null })
  })
  it('E4: a bill with sold_at null and an extra field still parses; cash_total must be ≥ 0 (0067:63-73)', () => {
    const bill = { order_no: 'L260925-902', version: 2, source: 'web', sold_at: null, total: 12.5, created_by_name: 'แอน', extra: 1 }
    expect(ShiftCashResponse.safeParse({ ok: true, data: { bills: [bill], cash_total: 12.5 } }).success).toBe(true)
    expect(ShiftCashResponse.safeParse({ ok: true, data: { bills: [], cash_total: -1 } }).success).toBe(false)
  })
})

describe('detail prefixes', () => {
  it('the ten prefixes of §4.10, in order', () => {
    expect([...DETAIL_PREFIXES]).toEqual(['scope:', 'role:', 'rule:', 'exists:', 'off_catalog_exists:', 'receipt_taken:', 'key_changed:', 'counted:', 'z_no_taken:', 'data_conflict:'])
  })
  it('only at the very start; never a longer word that merely begins alike', () => {
    expect(detailPrefix(' scope: x')).toBeNull()
    expect(detailPrefix('API key ไม่มีสิทธิ์ scope: x')).toBeNull()
    expect(detailPrefix('counted: กะนี้มีการนับเงินอีกใบแล้ว')).toBe('counted:')
    expect(detailPrefix('z_no_taken: เลขใบปิดกะนี้ถูกใช้แล้วในเครื่องนี้')).toBe('z_no_taken:')
    expect(detailPrefix('key_changed: key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว')).toBe('key_changed:')
    expect(detailPrefix('')).toBeNull()
    expect(detailPrefix(null)).toBeNull()
  })
})

describe('the expected-cash parity file (D84)', () => {
  const cash = { opening_float: 0, pos_cash_sales: 0, void_refunds: 0, paid_in: 0, paid_out: 300, drops: 0, drawer_expenses: 0, bot_cash: 0 }
  it('expected and variance may be negative; cash parts may not', () => {
    expect(ShiftCashParityFile.safeParse({ cases: [{ name: 'n', cash, counted: 0, expected: -300, variance: 300 }] }).success).toBe(true)
    expect(ShiftCashParityFile.safeParse({ cases: [{ name: 'n', cash: { ...cash, paid_out: -1 }, counted: 0, expected: 1, variance: -1 }] }).success).toBe(false)
  })
  it('drawer_expenses may be non-zero here (block 4 case) and money has at most 2 decimals', () => {
    expect(ShiftCashParityFile.safeParse({ cases: [{ name: 'n', cash: { ...cash, drawer_expenses: 120 }, counted: 0, expected: -420, variance: 420 }] }).success).toBe(true)
    expect(ShiftCashParityFile.safeParse({ cases: [{ name: 'n', cash, counted: 0, expected: -300.001, variance: 300 }] }).success).toBe(false)
    expect(ShiftCashParityFile.safeParse({ cases: [{ name: 'n', cash, counted: 0, expected: -300, variance: 300, tip: 1 }] }).success).toBe(false)
  })
})
