// The contract as dayo main SHIPPED it (block 1A, ADR-0048…0054) — every case names the dayo line it mirrors.
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  CentralOrder, ClientInfo, OrderLineData, ParityFile, PosCatalogResponse, PosOrderCatalog, type PosOrderCatalogParsed, PricingInfo, SizeCode,
} from '../src/dayo-api.js'
import { loadContractFixture, loadRichCatalog } from '../src/dayo-fixture-files.js'

const SIZES = [
  { code: '16 oz', label: '16 oz', sortOrder: 0, isActive: true },
  { code: '20 oz', label: '20 oz', sortOrder: 1, isActive: true },
  { code: '22 oz', label: 'แก้วใหญ่พิเศษ', sortOrder: 2, isActive: false },
]
const VARIANT = { menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', family: 'ชาไทย', categoryLabel: 'ชาไทย', menuSortOrder: 0, size: '16 oz', sweetness: '50%', price: 35, allowOatMilk: false, isMatcha: false, recipeLines: [] }
const PROMO = { id: 'p1', code: null, name: 'เย็น', kind: 'item_discount', startsOn: null, endsOn: null, daysOfWeek: null, timeFrom: null, timeTo: null, channelCodes: [], requiresCode: false, autoApply: true, priority: 10, stackable: false, isActive: true, params: { menu_codes: ['Thai Tea'], percent: 10 } }
const catalog = (o: Record<string, unknown> = {}) => ({ settings: null, sizes: SIZES, variants: [VARIANT], ingredients: {}, bases: {}, milkOptions: [], gradeOptions: [], channels: [], paymentMethods: [], promotions: [], ...o })

describe('E1 sizes (ADR-0054 · dayo 0048_cup_sizes.sql:33, 1482-1487)', () => {
  it.each(['8 oz', '16 oz', '22 oz', '999 oz'])('size %s has the cup_sizes code shape', (s) => { expect(SizeCode.safeParse(s).success).toBe(true) })
  it.each(['0 oz', '016 oz', '1000 oz', '16oz', '16 OZ', ' 16 oz', ''])('size %j is refused', (s) => { expect(SizeCode.safeParse(s).success).toBe(false) })
  it('sizes is required and keeps inactive sizes', () => {
    const got = PosOrderCatalog.parse(catalog())
    expect(got.sizes.map((s) => [s.code, s.isActive])).toEqual([['16 oz', true], ['20 oz', true], ['22 oz', false]])
    expect(PosOrderCatalog.safeParse({ ...catalog(), sizes: undefined }).success).toBe(false)
  })
  it('a size entry follows cup_sizes (code shape · non-empty label · integer sortOrder · boolean isActive)', () => {
    const bad = (e: Record<string, unknown>) => PosOrderCatalog.safeParse(catalog({ sizes: [{ ...SIZES[0], ...e }] })).success
    expect(bad({ code: '16oz' })).toBe(false)
    expect(bad({ label: '' })).toBe(false)
    expect(bad({ sortOrder: 1.5 })).toBe(false)
    expect(bad({ isActive: 'yes' })).toBe(false)
  })
  it('a long size label never rejects the catalog: it is display-only and dayo trims and counts it its own way', () => {
    expect(PosOrderCatalog.safeParse(catalog({ sizes: [{ ...SIZES[0], label: 'แก้วใหญ่พิเศษ '.repeat(5) }] })).success).toBe(true)
  })
  it('a variant, the default size and an E2 line may use any "<n> oz" size', () => {
    expect(PosOrderCatalog.safeParse(catalog({ variants: [{ ...VARIANT, size: '22 oz' }], settings: { defaultSize: '22 oz' } })).success).toBe(true)
    expect(OrderLineData.safeParse({ code: 'Thai Tea', size: '22 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1 }).success).toBe(true)
  })
  it('the parsed type carries sizes, so the pricing bridge needs no cast to cover it', () => {
    expectTypeOf<PosOrderCatalogParsed['sizes'][number]>().toMatchTypeOf<{ code: string; label: string; sortOrder: number; isActive: boolean }>()
  })
})

describe('E1 values dayo sends as-is', () => {
  it('categoryLabel may be null (menu_items.category_label · 0048_cup_sizes.sql:1491)', () => {
    expect(PosOrderCatalog.safeParse(catalog({ variants: [{ ...VARIANT, categoryLabel: null }] })).success).toBe(true)
  })
  it('every variant carries categoryLabel and menuSortOrder: dayo always builds both keys (0048_cup_sizes.sql:1491) and its MenuVariantEntry requires them', () => {
    const { categoryLabel: _c, ...noLabel } = VARIANT
    const { menuSortOrder: _s, ...noSort } = VARIANT
    expect(PosOrderCatalog.safeParse(catalog({ variants: [noLabel] })).success).toBe(false)
    expect(PosOrderCatalog.safeParse(catalog({ variants: [noSort] })).success).toBe(false)
  })
  it('optional catalog keys infer without `| undefined`, so the parsed catalog assigns to dayo\'s interfaces under exactOptionalPropertyTypes', () => {
    type Promo = PosOrderCatalogParsed['promotions'][number]
    expectTypeOf<Promo['timeFrom']>().toEqualTypeOf<string | null | undefined>()
    expectTypeOf<{ timeFrom?: string | null }>().toExtend<Pick<Promo, 'timeFrom'>>()
    expectTypeOf<Pick<Promo, 'timeFrom'>>().toExtend<{ timeFrom?: string | null }>()
    expectTypeOf<Pick<PosOrderCatalogParsed, 'settings'>>().toExtend<{ settings?: { maxQtyPerLine?: number } | null }>()
  })
  it('timeFrom/timeTo come as Postgres time "HH:MM:SS" and pass through unchanged (0048_cup_sizes.sql:1552)', () => {
    const got = PosOrderCatalog.parse(catalog({ promotions: [{ ...PROMO, timeFrom: '17:00:00', timeTo: '20:00:00' }] }))
    expect([got.promotions[0]!.timeFrom, got.promotions[0]!.timeTo]).toEqual(['17:00:00', '20:00:00'])
    expect(PosOrderCatalog.safeParse(catalog({ promotions: [{ ...PROMO, timeFrom: '17:00', timeTo: '20:00' }] })).success).toBe(true)
    expect(PosOrderCatalog.safeParse(catalog({ promotions: [{ ...PROMO, timeFrom: '17:0' }] })).success).toBe(false)
  })
  it('a time with fractional seconds is accepted and passed through unchanged, never truncated', () => {
    const got = PosOrderCatalog.parse(catalog({ promotions: [{ ...PROMO, timeFrom: '17:00:00.5', timeTo: '20:00:00.123456' }] }))
    expect([got.promotions[0]!.timeFrom, got.promotions[0]!.timeTo]).toEqual(['17:00:00.5', '20:00:00.123456'])
    expect(PosOrderCatalog.safeParse(catalog({ promotions: [{ ...PROMO, timeFrom: '17:00.5' }] })).success).toBe(false)
  })
  it('pricing.commit is null when the build sent none (0049_pos_catalog.sql:303-305)', () => {
    expect(PricingInfo.safeParse({ commit: null, files_sha256: {} }).success).toBe(true)
  })
  it('client.last_receipt_no is the key\'s latest external_ref as stored, any text or null (0049_pos_catalog.sql:321-325)', () => {
    for (const v of ['A-000311', 'L260924-014', null]) expect(ClientInfo.safeParse({ name: 'แท็บเล็ตขาย 1', last_receipt_no: v }).success).toBe(true)
    expect(ClientInfo.safeParse({ name: 'แท็บเล็ตขาย 1', last_receipt_no: 311 }).success).toBe(false)
  })
})

describe('E3 dayo_edit and pos_order_id (ADR-0050 · 0052_pos_push.sql:826,830 · 0051_multi_source_sales.sql:1479-1497)', () => {
  const ORDER = {
    order_no: 'L260925-011', sale_date: '2026-09-25', status: 'ok', source: 'pos', external_ref: 'A-000310', version: 2, channel: 'store', payment: 'cash',
    totals: { items_subtotal: 50, items_discount: 0, bill_discount: 0, total: 50, fee: 0 }, amount_mismatch: false, updated_at: '2026-09-25T04:02:11.5+00:00',
    pos_order_id: '3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f', dayo_edit: null,
  }
  const EDIT = { kind: 'edit', edited_at: '2026-09-25T04:02:11.5+00:00', edited_by_name: 'TungAo', reason: 'ลูกค้าเปลี่ยนเป็นนมโอ๊ต', version: 2 }
  it('parses an edit, a cancel and no edit', () => {
    expect(CentralOrder.parse({ ...ORDER, dayo_edit: EDIT }).dayo_edit).toEqual(EDIT)
    expect(CentralOrder.safeParse({ ...ORDER, status: 'cancelled', dayo_edit: { ...EDIT, kind: 'cancel' } }).success).toBe(true)
    expect(CentralOrder.parse(ORDER).dayo_edit).toBeNull()
  })
  it('name and reason are null for a key without staff:read (0052_pos_push.sql:831)', () => {
    expect(CentralOrder.safeParse({ ...ORDER, dayo_edit: { ...EDIT, edited_by_name: null, reason: null } }).success).toBe(true)
  })
  it('kind is only edit or cancel (0051:1486)', () => {
    expect(CentralOrder.safeParse({ ...ORDER, dayo_edit: { ...EDIT, kind: 'void' } }).success).toBe(false)
  })
  it('pos_order_id is null on another key\'s or a LINE bill (0052:826)', () => {
    expect(CentralOrder.parse({ ...ORDER, pos_order_id: null }).pos_order_id).toBeNull()
    expect(CentralOrder.safeParse({ ...ORDER, pos_order_id: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('parity file = what dayo scripts/export-pos-parity.ts:230-238 writes', () => {
  const EXPECTED = { ok: true, lines: [{ lineNo: 1, unitPrice: 35, discountPerCup: 0, lineTotal: 35 }], promotionsApplied: [], itemsSubtotal: 35, itemsDiscount: 0, billDiscountAmount: 0, totalAmount: 35, channelFeeAmount: 0, costTotal: 15, grossProfit: 20, gpPercent: 57.14, warnings: [] }
  const FILE = {
    dayo_commit: '135679ceefc0016ade2d94508fe3de615be0da3e', generated_at: '2026-09-25T10:00:00.000Z', pricing_files_sha256: { 'packages/shared/src/money.ts': 'ab' },
    catalog: catalog({ ingredients: { i1: { id: 'i1', code: 'BASE-THAI', name: 'ชาไทยเบส', useUnit: 'ml', costPerUseUnit: 0.1 } } }),
    cases: [{ spec: '7a', note: 'ก่อนช่วงเวลา', draft: { saleDate: '2026-09-24', saleTime: '10:00', channelCode: 'store', lines: [{ code: 'Thai Tea', size: '16 oz', sweetness: '50%', qty: 1 }], skipPromotionIds: [] }, expected: EXPECTED }],
  }
  it('parses without catalog_version or case id', () => {
    const got = ParityFile.parse(FILE)
    expect(got.cases[0]!.spec).toBe('7a')
  })
  it('a case is named by spec', () => {
    expect(ParityFile.safeParse({ ...FILE, cases: [{ ...FILE.cases[0], spec: '' }] }).success).toBe(false)
  })
})

describe('contract fixtures mirror dayo main', () => {
  const changed = () => PosCatalogResponse.parse(loadContractFixture('e1-catalog-changed').response.body).data
  it('e1-catalog-changed has sizes with an inactive one, a null categoryLabel and HH:MM:SS promotion times', () => {
    const d = changed()
    if (!d.changed) throw new Error('changed:true expected')
    expect(d.catalog.sizes.some((s) => !s.isActive)).toBe(true)
    expect(d.catalog.variants.some((v) => v.categoryLabel === null)).toBe(true)
    expect(d.catalog.promotions.some((p) => /^\d{2}:\d{2}:\d{2}$/.test(p.timeFrom ?? ''))).toBe(true)
    const active = new Set(d.catalog.sizes.filter((s) => s.isActive).map((s) => s.code))
    expect(d.catalog.variants.every((v) => active.has(v.size))).toBe(true) // 0048:1503-1504 sends only active sizes' variants
  })
  it('e1-catalog-unchanged carries pricing.commit null', () => {
    expect(PosCatalogResponse.parse(loadContractFixture('e1-catalog-unchanged').response.body).data.pricing.commit).toBeNull()
  })
  it('e3-orders-today has a POS bill the owner edited and one the owner cancelled on the web, and every row has pos_order_id', () => {
    const rows = (loadContractFixture('e3-orders-today').response.body as { data: unknown[] }).data.map((r) => CentralOrder.parse(r))
    expect(rows.map((r) => r.dayo_edit?.kind ?? null).filter((k) => k !== null).sort()).toEqual(['cancel', 'edit'])
    expect(rows.every((r) => 'pos_order_id' in r && 'dayo_edit' in r)).toBe(true)
  })
  it('the POS test catalog has sizes with an inactive one and HH:MM:SS times', () => {
    const c = loadRichCatalog().catalog
    expect(c.sizes.some((s) => !s.isActive)).toBe(true)
    expect(c.promotions.filter((p) => p.timeFrom != null).every((p) => /^\d{2}:\d{2}:\d{2}$/.test(p.timeFrom!))).toBe(true)
  })
})
