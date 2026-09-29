import { describe, expect, it } from 'vitest'
import { BLOCK3_SUPPORTED_FIELDS, fieldsUsed, OrderOffCatalogRowData, type OrderRowData } from '@dayo/contracts'
import { buildOffCatalogRowData, OffCatalogError, type OffCatalogItem } from '../src/off-catalog-row'

const O1 = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21'
const U = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'
const order: OrderRowData = {
  pos_order_id: O1, receipt_no: 'A-000312', queue_no: 12, sale_date: '2026-09-25', sold_at: '2026-09-25T03:15:03.120Z', channel: 'store', payment: 'cash',
  staff_id: U, catalog_version: 42, shift_id: '5a5a5a5a-0000-4000-8000-000000000001',
  lines: [{ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 3 }], bill_discount: null, promo_code: null,
  skip_promotion_ids: [], no_promotions: false, totals: { items_subtotal: 105, items_discount: 35, bill_discount: 0, total: 70 }, note: null,
}
/** Fix round 1 item 5: a bill of two cups — the lines must hold as many cups as the order row. */
const twoCups: OrderRowData = { ...order, lines: [{ ...order.lines[0]!, qty: 2 }], totals: { items_subtotal: 70, items_discount: 0, bill_discount: 0, total: 70 } }
const base = { order, closedBy: U, closedAt: '2026-09-26T02:00:00.000Z', reason: 'เมนูถูกลบในระบบกลาง', originalReason: 'UNKNOWN_CODE' }

describe('order_off_catalog data (spec 04 §4.10 · D97 · ruling R10)', () => {
  it('keeps the frozen money: per-cup discount when it divides exactly', () => {
    const items: OffCatalogItem[] = [{ menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', size: '16 oz', sweetness: '50%', qty: 2, unitPriceSatang: 3_500, discountPerCupSatang: 0, lineTotalSatang: 7_000 },
      { menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', size: '16 oz', sweetness: '50%', qty: 1, unitPriceSatang: 3_500, discountPerCupSatang: 3_500, lineTotalSatang: 0 }]
    const d = OrderOffCatalogRowData.parse(buildOffCatalogRowData({ ...base, items }))
    expect(d.totals).toEqual({ items_subtotal: 105, items_discount: 35, bill_discount: 0, total: 70 })
    expect(d).toMatchObject({ sale_date: '2026-09-25', original_reason: 'UNKNOWN_CODE', closed_by: U, lines: [{ name: 'ชาไทย', line_total: 70 }, { discount_per_cup: 35, line_total: 0 }] })
  })
  it('moves a discount that does not divide per cup into the bill discount; subtotal and total never change', () => {
    const items: OffCatalogItem[] = [{ menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', size: '16 oz', sweetness: '50%', qty: 3, unitPriceSatang: 3_500, discountPerCupSatang: 1_167, lineTotalSatang: 7_000 }]
    const d = OrderOffCatalogRowData.parse(buildOffCatalogRowData({ ...base, items }))
    expect(d.lines[0]).toMatchObject({ unit_price: 35, discount_per_cup: 0, line_total: 105 })
    expect(d.totals).toEqual({ items_subtotal: 105, items_discount: 0, bill_discount: 35, total: 70 })
  })
  it('a menu code longer than 40 goes as null; an empty Thai name falls back to the code', () => {
    const long = 'X'.repeat(41)
    const d = buildOffCatalogRowData({ ...base, order: twoCups, items: [{ menuCode: long, menuNameTh: '', size: null, sweetness: null, qty: 2, unitPriceSatang: 3_500, discountPerCupSatang: 0, lineTotalSatang: 7_000 }] })
    expect(d.lines[0]).toMatchObject({ code: null, name: long.slice(0, 100) })
  })
  it('an empty size or sweetness goes as null, and the row still parses (review item 2)', () => {
    const d = buildOffCatalogRowData({ ...base, order: twoCups, items: [{ menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', size: '', sweetness: '  ', qty: 2, unitPriceSatang: 3_500, discountPerCupSatang: 0, lineTotalSatang: 7_000 }] })
    expect(d.lines[0]).toMatchObject({ size: null, sweetness: null })
    expect(OrderOffCatalogRowData.safeParse(d).success).toBe(true)
  })
  it('refuses when the frozen total is above what the lines can explain (never invents money)', () => {
    const items: OffCatalogItem[] = [{ menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', size: '16 oz', sweetness: '50%', qty: 1, unitPriceSatang: 3_500, discountPerCupSatang: 0, lineTotalSatang: 3_500 }]
    expect(() => buildOffCatalogRowData({ ...base, items })).toThrow(OffCatalogError)
  })
  it('refuses an original reason dayo could not have sent', () => {
    expect(() => buildOffCatalogRowData({ ...base, originalReason: 'STUCK?', items: [] })).toThrow(OffCatalogError)
  })
})

const cup = (o: Partial<OffCatalogItem> = {}): OffCatalogItem => ({ menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', size: '16 oz', sweetness: '50%', qty: 2, unitPriceSatang: 3_500, discountPerCupSatang: 0, lineTotalSatang: 7_000, ...o })
const plain = twoCups
const codeOf = (f: () => unknown): string | undefined => { try { f() } catch (e) { return e instanceof OffCatalogError ? e.code : `not OffCatalogError: ${String(e)}` } return undefined }

describe('order_off_catalog — the frozen bill is kept, never re-priced', () => {
  it('refuses lines whose Σ unit × qty is not the frozen items_subtotal (the subtotal never changes)', () => {
    // three cups as the order says, total 70 reachable (bill discount 50) — but the frozen subtotal was 105, not 120
    expect(codeOf(() => buildOffCatalogRowData({ ...base, items: [cup({ qty: 3, unitPriceSatang: 4_000, lineTotalSatang: 12_000 })] }))).toBe('UNREPRESENTABLE')
  })
  it('a frozen bill discount stays a bill discount', () => {
    const o = { ...plain, bill_discount: { baht: 5, reason: null }, totals: { items_subtotal: 70, items_discount: 0, bill_discount: 5, total: 65 } }
    const d = OrderOffCatalogRowData.parse(buildOffCatalogRowData({ ...base, order: o, items: [cup()] }))
    expect(d.totals).toEqual({ items_subtotal: 70, items_discount: 0, bill_discount: 5, total: 65 })
  })
  it('a free cup (discount = price, line 0) keeps its per-cup discount', () => {
    const d = buildOffCatalogRowData({ ...base, order: { ...order, totals: { items_subtotal: 105, items_discount: 35, bill_discount: 0, total: 70 } }, items: [cup(), cup({ qty: 1, discountPerCupSatang: 3_500, lineTotalSatang: 0 })] })
    expect(d.lines[1]).toMatchObject({ discount_per_cup: 35, line_total: 0 })
  })
  it('carries the order row fields as frozen, the Thai date of sold_at, and only the phase-2 fields', () => {
    const d = buildOffCatalogRowData({ ...base, order: plain, items: [cup()] })
    expect(d).toMatchObject({ pos_order_id: O1, receipt_no: 'A-000312', queue_no: 12, sold_at: order.sold_at, sale_date: '2026-09-25', channel: 'store', payment: 'cash', staff_id: U, catalog_version: 42, shift_id: order.shift_id, note: null, reason: base.reason, closed_at: base.closedAt })
    expect(fieldsUsed(d).every((f) => (BLOCK3_SUPPORTED_FIELDS.order_off_catalog as readonly string[]).includes(f))).toBe(true)
    expect(OrderOffCatalogRowData.parse(d)).toEqual(d)
  })
  it('stray properties of the order or the items never reach the row', () => {
    const o = { ...plain, cost: 1 } as unknown as OrderRowData
    const d = buildOffCatalogRowData({ ...base, order: o, items: [{ ...cup(), costSatang: 9 } as OffCatalogItem] })
    expect(OrderOffCatalogRowData.parse(d)).toEqual(d)
    expect(JSON.stringify(d)).not.toMatch(/cost/)
  })
  it('a long Thai name is clipped to 100 code points; a size or sweetness longer than dayo takes goes as null', () => {
    const name = 'ช'.repeat(120)
    const d = buildOffCatalogRowData({ ...base, order: plain, items: [cup({ menuNameTh: name, size: 'x'.repeat(21), sweetness: 'y'.repeat(11) })] })
    expect(d.lines[0]).toMatchObject({ name: 'ช'.repeat(100), size: null, sweetness: null })
  })
  it('refuses no lines, more than 50 lines, a bad qty, and money that is not whole satang', () => {
    expect(codeOf(() => buildOffCatalogRowData({ ...base, order: plain, items: [] }))).toBe('UNREPRESENTABLE')
    expect(codeOf(() => buildOffCatalogRowData({ ...base, order: plain, items: Array.from({ length: 51 }, () => cup({ qty: 1, lineTotalSatang: 3_500 })) }))).toBe('UNREPRESENTABLE')
    for (const qty of [0, 1.5, 1000]) expect(codeOf(() => buildOffCatalogRowData({ ...base, order: plain, items: [cup({ qty })] }))).toBe('UNREPRESENTABLE')
    expect(codeOf(() => buildOffCatalogRowData({ ...base, order: plain, items: [cup({ unitPriceSatang: 3_500.5 })] }))).toBe('UNREPRESENTABLE')
    expect(codeOf(() => buildOffCatalogRowData({ ...base, order: plain, items: [cup({ discountPerCupSatang: -1 })] }))).toBe('UNREPRESENTABLE')
  })
  it('refuses a line with neither a Thai name nor a code', () => {
    expect(codeOf(() => buildOffCatalogRowData({ ...base, order: plain, items: [cup({ menuCode: ' ', menuNameTh: '' })] }))).toBe('UNREPRESENTABLE')
  })
  it('refuses a blank or over-long reason (Text200) as BAD_REASON', () => {
    expect(codeOf(() => buildOffCatalogRowData({ ...base, order: plain, items: [cup()], reason: '   ' }))).toBe('BAD_REASON')
    expect(codeOf(() => buildOffCatalogRowData({ ...base, order: plain, items: [cup()], reason: 'ก'.repeat(201) }))).toBe('BAD_REASON')
    expect(codeOf(() => buildOffCatalogRowData({ ...base, order: plain, items: [cup()], originalReason: '' }))).toBe('BAD_REASON')
  })
  it('refuses when the lines cannot reach the frozen total, with the amounts named', () => {
    const o: OrderRowData = { ...plain, totals: { items_subtotal: 70, items_discount: 0, bill_discount: 0, total: 80 } }
    expect(() => buildOffCatalogRowData({ ...base, order: o, items: [cup()] })).toThrow(/lines give 7000, the bill took 8000/)
  })
  it('OffCatalogError carries its code and the detail', () => {
    const e = new OffCatalogError('UNREPRESENTABLE', 'x')
    expect(e).toBeInstanceOf(Error)
    expect(e).toMatchObject({ name: 'OffCatalogError', code: 'UNREPRESENTABLE', message: 'UNREPRESENTABLE: x' })
  })
})

describe('order_off_catalog — Task 3 fix round 1', () => {
  const tea = '\u{1F375}' // one code point, two UTF-16 units
  it('item 1: a 100-code-point emoji name goes whole and parses; 120 is clipped to 100 code points', () => {
    const d = buildOffCatalogRowData({ ...base, order: plain, items: [cup({ menuNameTh: tea.repeat(120) })] })
    expect(d.lines[0]!.name).toBe(tea.repeat(100))
    expect(OrderOffCatalogRowData.safeParse(d).success).toBe(true)
  })
  it('item 1: a code, size or sweetness dayo would not take as text goes as null (control, lone surrogate, too many code points)', () => {
    const d = buildOffCatalogRowData({ ...base, order: plain, items: [cup({ menuCode: 'Thai\u0000Tea', menuNameTh: 'Thai Tea', size: '16\toz', sweetness: '\ud83c' })] })
    expect(d.lines[0]).toMatchObject({ code: null, name: 'Thai Tea', size: null, sweetness: null })
    const e = buildOffCatalogRowData({ ...base, order: plain, items: [cup({ menuCode: tea.repeat(41), size: tea.repeat(21), sweetness: tea.repeat(11) })] })
    expect(e.lines[0]).toMatchObject({ code: null, size: null, sweetness: null })
    const f = buildOffCatalogRowData({ ...base, order: plain, items: [cup({ menuCode: tea.repeat(40), size: tea.repeat(20), sweetness: tea.repeat(10) })] })
    expect(f.lines[0]).toMatchObject({ code: tea.repeat(40), size: tea.repeat(20), sweetness: tea.repeat(10) })
  })
  it('item 1: a name with a control character falls back to the code; neither usable = UNREPRESENTABLE', () => {
    const d = buildOffCatalogRowData({ ...base, order: plain, items: [cup({ menuNameTh: 'bad\u0007name' })] })
    expect(d.lines[0]!.name).toBe('Thai Tea')
    expect(codeOf(() => buildOffCatalogRowData({ ...base, order: plain, items: [cup({ menuNameTh: 'bad\u0007name', menuCode: '\u0001' })] }))).toBe('UNREPRESENTABLE')
  })
  it('item 1: a reason with a control character is BAD_REASON (dayo_pos_is_text)', () => {
    expect(codeOf(() => buildOffCatalogRowData({ ...base, order: plain, items: [cup()], reason: 'line1\nline2' }))).toBe('BAD_REASON')
  })
  it('item 2: closed_at leaves in the one sent form (…mmmZ); a bad instant is refused', () => {
    expect(buildOffCatalogRowData({ ...base, order: plain, items: [cup()], closedAt: '2026-09-26T02:00:00+00:00' }).closed_at).toBe('2026-09-26T02:00:00.000Z')
    expect(() => buildOffCatalogRowData({ ...base, order: plain, items: [cup()], closedAt: '2026-09-26 02:00' })).toThrow(/closedAt/)
  })
  it('item 3: the builder parses its own row — closed before the sale fails at build time, not at enqueue', () => {
    expect(() => buildOffCatalogRowData({ ...base, order: plain, items: [cup()], closedAt: '2026-09-25T00:00:00.000Z' })).toThrow(/closed_at/)
    expect(() => buildOffCatalogRowData({ ...base, order: plain, items: [cup()], closedBy: 'not-a-uuid' })).toThrow()
  })
  it('item 5: the lines must hold exactly the cups of the order row', () => {
    // same subtotal, total reachable — only the cup count is wrong (two cups at 52.50 for an order of three)
    expect(codeOf(() => buildOffCatalogRowData({ ...base, items: [cup({ qty: 2, unitPriceSatang: 5_250, lineTotalSatang: 10_500 })] }))).toBe('UNREPRESENTABLE')
    // split differently across lines is fine: 1 + 2 = the order's 3 cups
    expect(buildOffCatalogRowData({ ...base, items: [cup({ qty: 1, lineTotalSatang: 3_500 }), cup({ qty: 2, discountPerCupSatang: 1_750, lineTotalSatang: 3_500 })] }).totals).toEqual({ items_subtotal: 105, items_discount: 35, bill_discount: 0, total: 70 })
  })
})
