// Plan 10 Task 2 — the E1/E2/parity shapes of dayo's promotion engine (ADR-0070/0071/0072 · dayo main f4cda56).
// Every case names the dayo line it mirrors. F2 first: since migration 0071 every E1 answer carries
// supported_fields.promotion_rule_versions as NUMBERS, which the old record<string, string[]> refused — the whole E1
// (catalog AND staff list) was a BAD_RESPONSE.
import { describe, expect, it } from 'vitest'
import {
  DETAIL_PREFIXES, detailPrefix, fieldsUsed, isRowSupported, OrderRowData, ParityDraft, ParityFile, ParityMoney, PosCatalogLooseResponse,
  ManualPromotionReason, PosCatalogResponse, PosOrderCatalog, PromoRuleSchema, PromotionGroupSchema, PushRequest, PushResponse, supportedOf, TimeWindowSchema,
  trimWs,
} from '../src/dayo-api.js'
import { PROMO_RULES_FIXTURE_NAMES } from '../src/dayo-fixture.js'
import { loadContractFixture } from '../src/dayo-fixture-files.js'

type Json = Record<string, unknown>
const clone = <T>(v: T): T => structuredClone(v)
const bodyOf = (name: string): { ok: true; data: Json } => clone(loadContractFixture(name).response.body) as { ok: true; data: Json }

// ── F2 regression (0071_promotion_rules.sql:3414 · 0073_promo_tiers.sql:1715 · docs/API.md:97) ────────────────────────
describe('F2: E1 with supported_fields.promotion_rule_versions (numbers) parses', () => {
  const withVersions = (name: string, v: unknown = [1, 2]) => {
    const b = bodyOf(name)
    ;(b.data['supported_fields'] as Json)['promotion_rule_versions'] = v
    return b
  }
  it.each(['e1-catalog-changed', 'e1-catalog-unchanged', 'e1-catalog-changed-block3'])('%s + promotion_rule_versions [1, 2] → loose and strict parse', (name) => {
    expect(PosCatalogLooseResponse.safeParse(withVersions(name)).success).toBe(true)
    expect(PosCatalogResponse.safeParse(withVersions(name)).success).toBe(true)
  })
  it('0071 alone sends [1] — also parses', () => {
    expect(PosCatalogLooseResponse.safeParse(withVersions('e1-catalog-changed', [1])).success).toBe(true)
  })
  it('the staff list of such an answer is read (a removed employee must be locked out at once — ruling R12)', () => {
    const got = PosCatalogLooseResponse.parse(withVersions('e1-catalog-changed')).data
    if (!got.changed) throw new Error('changed:true expected')
    expect(got.staff.map((s) => [s.display_name, s.active])).toEqual([['TungAo', true], ['DCm', true], [null, false]])
  })
  it('an odd value under any other supported_fields key never fails E1 either', () => {
    for (const odd of [{ a: 1 }, 5, 'x', null, [1, 'a'], true]) {
      const b = bodyOf('e1-catalog-unchanged')
      ;(b.data['supported_fields'] as Json)['something_new'] = odd
      expect(PosCatalogLooseResponse.safeParse(b).success, JSON.stringify(odd)).toBe(true)
    }
  })
  it('supported_fields itself must still be an object', () => {
    const b = bodyOf('e1-catalog-unchanged')
    b.data['supported_fields'] = ['order']
    expect(PosCatalogLooseResponse.safeParse(b).success).toBe(false)
  })
})

// ── supportedOf (plan 10 §0.2 "E1 supported_fields") ────────────────────────────────────────────────────────────────
describe('supportedOf', () => {
  it('fields = only the string[] values · promoRuleVersions = promotion_rule_versions', () => {
    const s = supportedOf(['order'], { order: ['pos_order_id', 'lines.code'], order_void: [], promotion_rule_versions: [1, 2] })
    expect(s).toEqual({ kinds: ['order'], fields: { order: ['pos_order_id', 'lines.code'], order_void: [] }, promoRuleVersions: [1, 2] })
  })
  it('no promotion_rule_versions = [] (dayo before 0071)', () => {
    expect(supportedOf([], { order: ['note'] }).promoRuleVersions).toEqual([])
  })
  it('keeps integers ≥ 0 only, once each, ascending — anything else under the key = none', () => {
    expect(supportedOf([], { promotion_rule_versions: [2, 1, 2, 1.5, -1, '3', null, 0] }).promoRuleVersions).toEqual([0, 1, 2])
    expect(supportedOf([], { promotion_rule_versions: '1,2' }).promoRuleVersions).toEqual([])
    expect(supportedOf([], { promotion_rule_versions: { v: 1 } }).promoRuleVersions).toEqual([])
  })
  it('odd values of other keys are dropped from fields; promotion_rule_versions is never a field list', () => {
    const s = supportedOf(['order'], { order: ['note'], mixed: ['a', 1], obj: { a: 1 }, n: 5, s: 'x', nul: null, promotion_rule_versions: [] })
    expect(s.fields).toEqual({ order: ['note'] })
  })
  it('does not share arrays with its input', () => {
    const raw = { order: ['note'] }
    const kinds = ['order']
    const s = supportedOf(kinds, raw)
    raw.order.push('tip')
    kinds.push('order_void')
    expect(s).toEqual({ kinds: ['order'], fields: { order: ['note'] }, promoRuleVersions: [] })
  })
  it('isRowSupported reads `fields` exactly as before', () => {
    const data = { pos_order_id: 'x', note: 'n' }
    expect(isRowSupported('order', data, supportedOf(['order'], { order: ['pos_order_id', 'note'], promotion_rule_versions: [1, 2] }))).toBe(true)
    expect(isRowSupported('order', data, supportedOf(['order'], { order: ['pos_order_id'] }))).toBe(false)
    expect(isRowSupported('promotion_rule_versions', {}, supportedOf(['order'], { promotion_rule_versions: [1] }))).toBe(false)
  })
})

// ── E1 promotions: two shapes (0074_promo_usage_limits.sql:163-202 · types.ts:199-340 at f4cda56) ──────────────────────
const LEGACY = {
  id: '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f', code: null, name: 'ชาไทย ซื้อ 2 แถม 1', kind: 'buy_n_get_m', startsOn: null, endsOn: null,
  daysOfWeek: null, timeFrom: null, timeTo: null, channelCodes: [], requiresCode: false, autoApply: true, applyMode: 'auto', priority: 10,
  stackable: false, isActive: true, params: { buy_qty: 2, get_qty: 1, menu_codes: ['Thai Tea'] },
}
const LEGACY_RULE = {
  ...LEGACY, template: 'buy_n_get_m',
  rule: { v: 1, scope: 'cup', target: { menus: ['Thai Tea'] }, reward: { type: 'buy_get', buy: 2, get: 1, get_target: null, get_discount: { percent: 100 }, get_pick: 'cheapest', max_sets: null }, stop_group: true },
  timeWindows: [], groupCode: 'main', summaryTh: null, usageLimitTotal: null, usageLimitPerDay: null,
}
/** A rule dayo cannot turn back into the old shape: 0074:199 strips kind/params/daysOfWeek/timeFrom/timeTo/stackable. */
const RULE_ONLY = {
  id: '7f616277-72c0-46ef-87b3-aad44b652cff', code: null, name: 'ชาไทยครบ 2 ลด 10% ครบ 3 ลด 15%', startsOn: null, endsOn: null, channelCodes: [],
  requiresCode: false, autoApply: true, applyMode: 'auto', priority: 10, isActive: true, template: 'tiered_item',
  rule: { v: 2, scope: 'cup', target: { menus: ['Thai Tea'] }, reward: { type: 'tiered', basis: 'qty', tiers: [{ min: 2, percent: 10 }, { min: 3, percent: 15 }] } },
  timeWindows: [], groupCode: 'main', summaryTh: null, usageLimitTotal: null, usageLimitPerDay: null,
}
const GROUPS = [{ code: 'main', name: 'ทั่วไป', sortOrder: 0, stackMode: 'separate', isActive: true }, { code: 'stack', name: 'ซ้อนได้', sortOrder: 1, stackMode: 'stack', isActive: true }]
const baseCatalog = (): Json => clone((bodyOf('e1-catalog-changed').data['catalog']) as Json)
const withPromos = (promotions: unknown[], extra: Json = {}): Json => ({ ...baseCatalog(), promotions, ...extra })
const ok = (promotions: unknown[], extra: Json = {}): boolean => PosOrderCatalog.safeParse(withPromos(promotions, extra)).success
const omit = (o: Json, ...keys: string[]): Json => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))

describe('E1 promotions — legacy and rule shapes', () => {
  it('a rule-only promotion (no kind, params, stackable, daysOfWeek, timeFrom, timeTo) parses', () => {
    expect(ok([RULE_ONLY])).toBe(true)
    const got = PosOrderCatalog.parse(withPromos([RULE_ONLY]))
    expect(got.promotions[0]).toEqual(RULE_ONLY)
  })
  it('a legacy promotion that also carries the rule fields parses', () => {
    expect(ok([LEGACY_RULE])).toBe(true)
    expect(PosOrderCatalog.parse(withPromos([LEGACY_RULE])).promotions[0]).toEqual(LEGACY_RULE)
  })
  it('the old legacy shape (dayo before 0069/0071) still parses', () => {
    expect(ok([omit(LEGACY, 'applyMode')])).toBe(true)
  })
  it.each(['template', 'rule', 'timeWindows', 'groupCode'])('a rule-only promotion without %s is refused', (k) => {
    expect(ok([omit(RULE_ONLY, k)])).toBe(false)
  })
  it('a legacy promotion still needs params and a boolean stackable', () => {
    expect(ok([omit(LEGACY_RULE, 'params')])).toBe(false)
    expect(ok([omit(LEGACY_RULE, 'stackable')])).toBe(false)
    expect(ok([{ ...LEGACY_RULE, stackable: null }])).toBe(false)
  })
  it('a kind the tablet does not know is refused (whole catalog — ruling R12)', () => {
    expect(ok([{ ...LEGACY_RULE, kind: 'mystery' }])).toBe(false)
    expect(ok([{ ...RULE_ONLY, kind: 'mystery' }])).toBe(false)
    expect(ok([{ ...RULE_ONLY, kind: null }])).toBe(false) // dayo strips a null kind (0074:199) — never sent
  })
  it('an unknown rule.reward.type is refused', () => {
    expect(ok([{ ...RULE_ONLY, rule: { ...RULE_ONLY.rule, reward: { type: 'lucky_draw', percent: 5 } } }])).toBe(false)
  })
  it('a rule of a version above 2 is refused (the tablet asks promo_rule_version=2)', () => {
    expect(ok([{ ...RULE_ONLY, rule: { ...RULE_ONLY.rule, v: 3 } }])).toBe(false)
  })
  it('timeWindows with from/to null (all day) parse · a window crossing midnight parses', () => {
    expect(ok([{ ...RULE_ONLY, timeWindows: [{ days: [0], from: null, to: null }, { days: [5, 6], from: '22:00', to: '02:00' }] }])).toBe(true)
  })
  it('summaryTh null or text · applyMode manual/code/auto · usage limits (number or null) parse', () => {
    expect(ok([{ ...RULE_ONLY, summaryTh: 'ชาไทยครบ 2 แก้วลด 10%' }, { ...LEGACY_RULE, summaryTh: null }])).toBe(true)
    for (const m of ['auto', 'code', 'manual']) expect(ok([{ ...RULE_ONLY, applyMode: m }]), m).toBe(true)
    expect(ok([{ ...RULE_ONLY, applyMode: 'sometimes' }])).toBe(false)
    expect(ok([{ ...RULE_ONLY, usageLimitTotal: 100, usageLimitPerDay: 20 }])).toBe(true)
    expect(ok([omit(RULE_ONLY, 'usageLimitTotal', 'usageLimitPerDay', 'summaryTh')])).toBe(true) // promo_rule_version < 2 strips the limits (0074:201)
    expect(ok([{ ...RULE_ONLY, usageLimitTotal: '100' }])).toBe(false)
  })
  it('promotionGroups parse and are optional (dayo before 0071)', () => {
    expect(ok([RULE_ONLY], { promotionGroups: GROUPS })).toBe(true)
    expect(PosOrderCatalog.parse(withPromos([RULE_ONLY], { promotionGroups: GROUPS })).promotionGroups).toEqual(GROUPS)
    expect(PosOrderCatalog.parse(withPromos([])).promotionGroups).toBeUndefined()
    expect(PromotionGroupSchema.safeParse(omit(GROUPS[0]!, 'isActive')).success).toBe(true)
    expect(PromotionGroupSchema.safeParse({ ...GROUPS[0], stackMode: 'merge' }).success).toBe(false)
    expect(ok([RULE_ONLY], { promotionGroups: [{ ...GROUPS[0], sortOrder: '0' }] })).toBe(false)
  })
  it('the catalogs of the older fixtures still parse', () => {
    for (const name of ['e1-catalog-changed', 'e1-catalog-changed-block3']) expect(PosCatalogResponse.safeParse(bodyOf(name)).success, name).toBe(true)
  })
})

// types.ts:199-282 — every reward of rule versions 1–2, with every optional key
const T = { menus: ['Thai Tea'], categories: ['ชาไทย'], variants: [{ menu: 'Thai Tea', size: '16 oz', sweetness: '50%' }, { menu: 'Thai Tea', size: '20 oz' }], sizes: ['16 oz'], options: { milk: ['oat'], grade: ['Excellent'] }, exclude_menus: ['Fresh Milk'] }
const cup = (reward: Json, extra: Json = {}): Json => ({ v: 1, scope: 'cup', target: T, reward, ...extra })
const bill = (reward: Json, extra: Json = {}): Json => ({ v: 1, scope: 'bill', reward, ...extra })
const REWARDS: [string, Json][] = [
  ['percent', cup({ type: 'percent', percent: 10, apply_to: 'option' })],
  ['amount', cup({ type: 'amount', baht: 5, apply_to: 'cup' })],
  ['fixed_price', cup({ type: 'fixed_price', price: 30 })],
  ['buy_get percent', cup({ type: 'buy_get', buy: 1, get: 1, get_target: T, get_discount: { percent: 50 }, get_pick: 'most_expensive', max_sets: 2 })],
  ['buy_get baht', cup({ type: 'buy_get', buy: 2, get: 1, get_discount: { baht: 10 } })],
  ['buy_get fixed_price', cup({ type: 'buy_get', buy: 2, get: 1, get_target: null, get_discount: { fixed_price: 20 }, max_sets: null })],
  ['bundle', cup({ type: 'bundle', items: [{ target: { menus: ['Thai Tea'] }, qty: 1 }, { target: {}, qty: 2 }], price: 99, max_sets: null })],
  ['bill_percent', bill({ type: 'bill_percent', percent: 10 }, { min_subtotal: 200, cap_baht: 30, rounding: 'floor_baht', manual_bill: 'combine', stop_group: true })],
  ['bill_amount', bill({ type: 'bill_amount', baht: 25 }, { min_subtotal: null, cap_baht: null, rounding: 'round2', manual_bill: 'yield' })],
  ['tiered qty', { ...cup({ type: 'tiered', basis: 'qty', apply_to: 'option', tiers: [{ min: 2, percent: 50 }, { min: 3, baht: 20 }, { min: 4, fixed_price: 10 }] }), v: 2 }],
  ['tiered amount', { ...cup({ type: 'tiered', basis: 'amount', tiers: [{ min: 100, baht: 5 }, { min: 200, baht: 10 }] }, { cap_baht: 25 }), v: 2 }],
  ['bill_tiers subtotal', { ...bill({ type: 'bill_tiers', basis: 'subtotal', tiers: [{ min: 200, baht: 20 }, { min: 300, percent: 10 }] }), v: 2 }],
  ['bill_tiers qty with target', { ...bill({ type: 'bill_tiers', basis: 'qty', tiers: [{ min: 2, percent: 5 }, { min: 4, percent: 10 }] }), target: { categories: ['ชาไทย'] }, v: 2 }],
]

describe('PromoRuleSchema — every reward of rule versions 1–2', () => {
  it.each(REWARDS)('%s parses, unchanged', (_, rule) => {
    expect(PromoRuleSchema.parse(rule)).toEqual(rule)
    expect(ok([{ ...RULE_ONLY, rule }])).toBe(true)
  })
  it.each([
    ['percent not a number', cup({ type: 'percent', percent: '10' })],
    ['apply_to unknown', cup({ type: 'amount', baht: 5, apply_to: 'bill' })],
    ['get_discount missing', cup({ type: 'buy_get', buy: 1, get: 1 })],
    ['get_discount of an unknown key only', cup({ type: 'buy_get', buy: 1, get: 1, get_discount: { half: true } })],
    ['get_pick unknown', cup({ type: 'buy_get', buy: 1, get: 1, get_discount: { percent: 100 }, get_pick: 'random' })],
    ['bundle item without qty', cup({ type: 'bundle', items: [{ target: {} }], price: 10 })],
    ['tier without min', { ...cup({ type: 'tiered', basis: 'qty', tiers: [{ percent: 5 }, { min: 3, percent: 10 }] }), v: 2 }],
    ['tiered basis unknown', { ...cup({ type: 'tiered', basis: 'weight', tiers: [{ min: 1, percent: 5 }, { min: 3, percent: 10 }] }), v: 2 }],
    ['bill tier with fixed_price only', { ...bill({ type: 'bill_tiers', basis: 'subtotal', tiers: [{ min: 1, fixed_price: 5 }, { min: 3, fixed_price: 1 }] }), v: 2 }],
    ['scope unknown', { v: 1, scope: 'line', reward: { type: 'percent', percent: 5 } }],
    ['rounding unknown', cup({ type: 'percent', percent: 5 }, { rounding: 'ceil' })],
    ['manual_bill unknown', bill({ type: 'bill_percent', percent: 5 }, { manual_bill: 'merge' })],
    ['target.variants sweetness unknown', cup({ type: 'percent', percent: 5 }, { target: { variants: [{ menu: 'Thai Tea', size: '16 oz', sweetness: '33%' }] } })],
    ['target.menus not a list', cup({ type: 'percent', percent: 5 }, { target: { menus: 'Thai Tea' } })],
    ['v missing', omit(cup({ type: 'percent', percent: 5 }), 'v')],
  ])('%s → refused', (_, rule) => {
    expect(PromoRuleSchema.safeParse(rule).success).toBe(false)
  })
  it('an unknown key is KEPT (not stripped) so vendor validatePromoRule sees it and refuses the catalog (T3)', () => {
    const rule = { ...cup({ type: 'percent', percent: 5, bonus: 1 }), extra: true, target: { ...T, weather: ['rain'] } }
    expect(PromoRuleSchema.parse(rule)).toEqual(rule)
  })
  it('TimeWindowSchema: days list + from/to (text or null)', () => {
    expect(TimeWindowSchema.safeParse({ days: [], from: null, to: null }).success).toBe(true)
    expect(TimeWindowSchema.safeParse({ days: [1], from: '22:00', to: '02:00' }).success).toBe(true)
    expect(TimeWindowSchema.safeParse({ days: [1], from: 22, to: null }).success).toBe(false)
    expect(TimeWindowSchema.safeParse({ from: null, to: null }).success).toBe(false)
  })
})

// ── E2 order row: manual promotions (0069_promotion_apply_modes.sql:1484-1632 · docs/API.md:308,356) ──────────────────
const ORDER = (clone(loadContractFixture('e2-order-accepted').request.body) as { rows: { data: Json }[] }).rows[0]!.data
const P1 = '5c5c5c5c-0000-4000-8000-000000000001'
const ids = (n: number) => Array.from({ length: n }, (_, i) => `5c5c5c5c-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
const orderOk = (over: Json): boolean => OrderRowData.safeParse({ ...ORDER, ...over }).success
/** A character by code point — no invisible character is ever written literally in this file. */
const cp = (n: number): string => String.fromCodePoint(n)

describe('E2 order row — manual_promotion_ids / manual_promotion_reason', () => {
  it('a row without manual promotions has no new key (byte-identical to the row of before)', () => {
    const got = OrderRowData.parse(ORDER)
    expect(Object.keys(got)).not.toContain('manual_promotion_ids')
    expect(Object.keys(got)).not.toContain('manual_promotion_reason')
    expect(JSON.stringify(got)).toBe(JSON.stringify(OrderRowData.parse(clone(ORDER))))
    expect(fieldsUsed(got).filter((f) => f.startsWith('manual_'))).toEqual([])
  })
  it('ids alone · ids + reason · ids + null reason parse', () => {
    expect(orderOk({ manual_promotion_ids: [P1] })).toBe(true)
    expect(orderOk({ manual_promotion_ids: [P1], manual_promotion_reason: 'ชงผิดสูตร ทำแก้วใหม่ให้' })).toBe(true)
    expect(orderOk({ manual_promotion_ids: [P1], manual_promotion_reason: null })).toBe(true)
  })
  it('1–20 ids: 20 parse, 21 and [] do not', () => {
    expect(orderOk({ manual_promotion_ids: ids(20) })).toBe(true)
    expect(orderOk({ manual_promotion_ids: ids(21) })).toBe(false)
    expect(orderOk({ manual_promotion_ids: [] })).toBe(false)
  })
  it('ids are lowercase uuids, each once (the tablet removes duplicates before sending — ruling R5)', () => {
    expect(orderOk({ manual_promotion_ids: [P1, P1] })).toBe(false)
    expect(orderOk({ manual_promotion_ids: [P1.toUpperCase()] })).toBe(false)
    expect(orderOk({ manual_promotion_ids: ['not-a-uuid'] })).toBe(false)
    expect(orderOk({ manual_promotion_ids: null })).toBe(false)
  })
  it('a reason needs ids — also a null one (neither key when the cart has no manual promotion)', () => {
    expect(orderOk({ manual_promotion_reason: 'ชงผิด' })).toBe(false)
    expect(orderOk({ manual_promotion_reason: null })).toBe(false)
  })
  it('reason = 1–200 code points (Thai counts per code point) · 201 is refused', () => {
    expect(orderOk({ manual_promotion_ids: [P1], manual_promotion_reason: 'ก'.repeat(200) })).toBe(true)
    expect(orderOk({ manual_promotion_ids: [P1], manual_promotion_reason: 'ก'.repeat(201) })).toBe(false)
    expect(orderOk({ manual_promotion_ids: [P1], manual_promotion_reason: '😀'.repeat(200) })).toBe(true)
    expect(orderOk({ manual_promotion_ids: [P1], manual_promotion_reason: '' })).toBe(false)
    expect(orderOk({ manual_promotion_ids: [P1], manual_promotion_reason: '   ' })).toBe(false)
  })
  it.each([
    ['C0 newline', `ชงผิด${cp(0x0a)}แก้วใหม่`], ['DEL', `ชงผิด${cp(0x7f)}`], ['C1', `ชงผิด${cp(0x85)}`], ['zero-width space', `ชง${cp(0x200b)}ผิด`], ['RLM', `ชงผิด${cp(0x200f)}`],
    ['bidi override', `${cp(0x202e)}ชงผิด`], ['line separator', `ชงผิด${cp(0x2028)}`], ['paragraph separator', `ชงผิด${cp(0x2029)}`], ['bidi isolate', `${cp(0x2066)}ชงผิด${cp(0x2069)}`],
  ])('reason with %s → refused (dayo 0069: stricter than other reasons)', (_, reason) => {
    expect(orderOk({ manual_promotion_ids: [P1], manual_promotion_reason: reason })).toBe(false)
  })
  it('a row with the new fields is held on a dayo that does not list them (old dayo), sent on one that does', () => {
    const data = OrderRowData.parse({ ...ORDER, manual_promotion_ids: [P1], manual_promotion_reason: 'ชงผิด' })
    const old = bodyOf('e1-catalog-changed-old-dayo').data
    const now = bodyOf('e1-catalog-changed-promo-rules').data
    expect(isRowSupported('order', data, supportedOf(old['supported_kinds'] as string[], old['supported_fields'] as Json))).toBe(false)
    expect(isRowSupported('order', data, supportedOf(now['supported_kinds'] as string[], now['supported_fields'] as Json))).toBe(true)
    expect(isRowSupported('order', ORDER, supportedOf(old['supported_kinds'] as string[], old['supported_fields'] as Json))).toBe(true)
  })
  it('detail prefix reason_required: (dayo 0069:1098 → dayo_pos_map_error 0074:2555-2560 = rejected INVALID)', () => {
    expect(DETAIL_PREFIXES).toContain('reason_required:')
    expect(detailPrefix('reason_required: โปรที่เลือกเองทำให้บิลเหลือ ฿0 ต้องใส่เหตุผลค่ะ')).toBe('reason_required:')
  })
})

// ── fix round 1: the reason must be exactly what dayo stores (dayo_draft_manual_reason 0069:322-345 → dayo_trim_ws 0069:28-38) ──
/** dayo_trim_ws's set, written out from 0069:34-35: \t\n\v\f\r, space, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. */
const DAYO_WS = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]

describe('trimWs = dayo_trim_ws', () => {
  it.each(DAYO_WS.map((n) => [n.toString(16), n]))('U+%s is trimmed at both ends, never in the middle', (_, n) => {
    expect(trimWs(`${cp(n)}${cp(n)}ชง${cp(n)}ผิด${cp(n)}`)).toBe(`ชง${cp(n)}ผิด`)
    expect(trimWs(cp(n).repeat(3))).toBe('')
  })
  it.each([['zero-width space', 0x200b], ['NEL', 0x85], ['Mongolian vowel separator', 0x180e], ['word joiner', 0x2060], ['ideographic period', 0x3002]])('%s is not whitespace to dayo — kept', (_, n) => {
    expect(trimWs(`${cp(n)}x${cp(n)}`)).toBe(`${cp(n)}x${cp(n)}`)
  })
  it('is the same set as JS String.prototype.trim over the BMP (the SQL comment says so)', () => {
    for (let n = 0; n <= 0xffff; n++) {
      if (n >= 0xd800 && n <= 0xdfff) continue
      expect(trimWs(cp(n)) === '', n.toString(16)).toBe(cp(n).trim() === '')
    }
  })
  it('leaves text without edge whitespace alone · empty stays empty · a lone surrogate is not whitespace', () => {
    expect(trimWs('ชงผิดสูตร')).toBe('ชงผิดสูตร')
    expect(trimWs('')).toBe('')
    expect(trimWs(` ${String.fromCharCode(0xd800)} `)).toBe(String.fromCharCode(0xd800))
  })
})

describe('manual_promotion_reason must be what dayo stores (fix round 1)', () => {
  const reasonOk = (r: string): boolean => orderOk({ manual_promotion_ids: [P1], manual_promotion_reason: r })
  it.each([
    ['NBSP only', cp(0xa0)], ['U+3000 only', cp(0x3000)], ['U+FEFF only', cp(0xfeff)], ['U+2028 only', cp(0x2028)], ['em spaces only', cp(0x2003).repeat(3)],
    ['tabs only', '\t\t'],
  ])('%s → dayo trims it to empty (→ reason_required on a ฿0 bill) → refused', (_, r) => {
    expect(ManualPromotionReason.safeParse(r).success).toBe(false)
    expect(reasonOk(r)).toBe(false)
  })
  it.each([
    ['a leading space', ' ชงผิด'], ['a trailing space', 'ชงผิด '], ['a leading tab', '\tชงผิด'], ['a trailing tab', 'ชงผิด\t'],
    ['a trailing U+3000', `ชงผิด${cp(0x3000)}`], ['a leading NBSP', `${cp(0xa0)}ชงผิด`], ['a leading U+FEFF', `${cp(0xfeff)}ชงผิด`], ['a trailing U+202F', `ชงผิด${cp(0x202f)}`],
  ])('with %s → refused: callers send trimWs(reason), so the frozen text = dayo\'s byte for byte', (_, r) => {
    expect(ManualPromotionReason.safeParse(r).success).toBe(false)
    expect(reasonOk(r)).toBe(false)
    expect(reasonOk(trimWs(r))).toBe(true)
  })
  it('a trimmed reason parses, inner spaces kept (a plain space, NBSP and U+3000 inside are fine)', () => {
    for (const r of ['ชงผิดสูตร ทำแก้วใหม่ให้ลูกค้า', `ชงผิด${cp(0xa0)}สูตร`, `ชงผิด${cp(0x3000)}สูตร`, 'x']) {
      expect(ManualPromotionReason.safeParse(r).success, r).toBe(true)
      expect(reasonOk(r), r).toBe(true)
    }
  })
})

// ── the contract fixtures of plan 10 (§1) ───────────────────────────────────────────────────────────────────────────
describe('plan 10 contract fixtures', () => {
  it('are listed, sorted', () => {
    expect([...PROMO_RULES_FIXTURE_NAMES]).toEqual([
      'e1-catalog-changed-old-dayo', 'e1-catalog-changed-promo-rules', 'e1-catalog-unchanged-promo-rules', 'e2-order-manual-promo-accepted', 'e2-order-manual-reason-required',
    ])
  })
  it('every E1 asks promo_rule_version=2 — dayo before 0071 ignores the parameter', () => {
    for (const name of PROMO_RULES_FIXTURE_NAMES.filter((n) => n.startsWith('e1-'))) {
      expect(new URL(`http://x${loadContractFixture(name).request.path}`).searchParams.get('promo_rule_version'), name).toBe('2')
    }
  })
  it('e1-catalog-changed-promo-rules: [1, 2] · manual fields · both promotion shapes · promotionGroups · every groupCode is a group', () => {
    const d = PosCatalogResponse.parse(bodyOf('e1-catalog-changed-promo-rules')).data
    if (!d.changed) throw new Error('changed:true expected')
    const s = supportedOf(d.supported_kinds, d.supported_fields)
    expect(s.promoRuleVersions).toEqual([1, 2])
    expect(s.fields['order']).toEqual(expect.arrayContaining(['manual_promotion_ids', 'manual_promotion_reason']))
    const promos = d.catalog.promotions as Json[]
    expect(promos.some((p) => !('kind' in p))).toBe(true)
    expect(promos.some((p) => 'kind' in p && 'rule' in p)).toBe(true)
    expect(promos.some((p) => (p['rule'] as { v: number }).v === 2)).toBe(true)
    expect(promos.some((p) => p['applyMode'] === 'manual')).toBe(true)
    const groups = new Set((d.catalog.promotionGroups ?? []).map((g) => g.code))
    expect(promos.every((p) => groups.has(p['groupCode'] as string))).toBe(true)
    expect(d.staff.length).toBeGreaterThan(0)
  })
  it('e1-catalog-unchanged-promo-rules: changed:false still carries [1, 2]', () => {
    const d = PosCatalogLooseResponse.parse(bodyOf('e1-catalog-unchanged-promo-rules')).data
    expect(d.changed).toBe(false)
    expect(supportedOf(d.supported_kinds, d.supported_fields).promoRuleVersions).toEqual([1, 2])
  })
  it('e1-catalog-changed-old-dayo: no promotion_rule_versions, no manual fields, legacy promotions only', () => {
    const d = PosCatalogResponse.parse(bodyOf('e1-catalog-changed-old-dayo')).data
    if (!d.changed) throw new Error('changed:true expected')
    const s = supportedOf(d.supported_kinds, d.supported_fields)
    expect(s.promoRuleVersions).toEqual([])
    expect(s.fields['order']!.filter((f) => f.startsWith('manual_'))).toEqual([])
    expect((d.catalog.promotions as Json[]).every((p) => typeof p['kind'] === 'string' && !('rule' in p))).toBe(true)
    expect(d.catalog.promotionGroups).toBeUndefined()
  })
  it('e2-order-manual-promo-accepted: rows with manual ids (one with a reason, a ฿0 bill) are accepted', () => {
    const fx = loadContractFixture('e2-order-manual-promo-accepted')
    const rows = PushRequest.parse(fx.request.body).rows
    expect(rows.every((r) => r.kind === 'order' && (r.data as OrderRowData).manual_promotion_ids !== undefined)).toBe(true)
    expect(rows.some((r) => (r.data as OrderRowData).manual_promotion_reason != null && (r.data as OrderRowData).totals.total === 0)).toBe(true)
    expect(PushResponse.parse(fx.response.body).data.results.map((r) => r.status)).toEqual(rows.map(() => 'accepted'))
  })
  it('e2-order-manual-reason-required: the ฿0 bill without a reason is rejected INVALID reason_required:', () => {
    const fx = loadContractFixture('e2-order-manual-reason-required')
    const row = PushRequest.parse(fx.request.body).rows[0]!
    expect(row.data).toMatchObject({ totals: { total: 0 } })
    expect('manual_promotion_reason' in row.data).toBe(false)
    const r = PushResponse.parse(fx.response.body).data.results[0]!
    expect([r.status, r.reason, detailPrefix(r.detail)]).toEqual(['rejected', 'INVALID', 'reason_required:'])
  })
  it('the manual promotions the E2 fixtures send are manual promotions of the E1 fixture', () => {
    const d = PosCatalogResponse.parse(bodyOf('e1-catalog-changed-promo-rules')).data
    if (!d.changed) throw new Error('changed:true expected')
    const manual = new Set((d.catalog.promotions as Json[]).filter((p) => p['applyMode'] === 'manual').map((p) => p['id']))
    for (const name of ['e2-order-manual-promo-accepted', 'e2-order-manual-reason-required']) {
      for (const r of PushRequest.parse(loadContractFixture(name).request.body).rows) {
        for (const id of (r.data as OrderRowData).manual_promotion_ids ?? []) expect(manual.has(id), `${name} ${id}`).toBe(true)
      }
    }
  })
})

// ── parity file (dayo scripts/export-pos-parity.ts:433-496 at f4cda56 · F8) ─────────────────────────────────────────────
const EXPECTED = {
  ok: true, lines: [{ lineNo: 1, unitPrice: 35, discountPerCup: 0, lineTotal: 35, optionAdds: null, promoBreakdown: null }], promotionsApplied: [],
  itemsSubtotal: 35, itemsDiscount: 0, billDiscountAmount: 0, totalAmount: 35, channelFeeAmount: 0, costTotal: 15, grossProfit: 20, gpPercent: 57.14,
  manualPromotionReasonRequired: false, warnings: [],
}
const DRAFT = { saleDate: '2026-09-25', channelCode: 'store', lines: [{ code: 'Thai Tea', size: '16 oz', sweetness: '50%', qty: 1 }], skipPromotionIds: [], manualPromotionIds: [], manualPromotionReason: null }

describe('parity file with rule_fixtures', () => {
  it('a draft carries manual promotions, a reason and exhausted promotions (dayo only — the tablet never counts)', () => {
    expect(ParityDraft.safeParse({ ...DRAFT, manualPromotionIds: [P1], manualPromotionReason: 'ชงผิด', exhaustedPromotions: [{ id: P1, scope: 'total' }, { id: P1, scope: 'day' }] }).success).toBe(true)
    expect(ParityDraft.safeParse({ ...DRAFT, exhaustedPromotions: [{ id: P1, scope: 'week' }] }).success).toBe(false)
  })
  it('expected money carries manualPromotionReasonRequired and per-line promoBreakdown/optionAdds', () => {
    const lines = [{ ...EXPECTED.lines[0], optionAdds: { milk: { code: 'oat', add: 15, paid: 15 } }, promoBreakdown: [{ promotionId: P1, amount: 5 }, { promotionId: ids(2)[1], amount: 2.5 }] }]
    const got = ParityMoney.parse({ ...EXPECTED, lines })
    expect(got.manualPromotionReasonRequired).toBe(false)
    expect(got.lines[0]!.promoBreakdown).toEqual(lines[0]!.promoBreakdown)
    expect(ParityMoney.safeParse({ ...EXPECTED, manualPromotionReasonRequired: 'no' }).success).toBe(false)
    expect(ParityMoney.safeParse({ ...EXPECTED, lines: [{ ...EXPECTED.lines[0], promoBreakdown: [{ promotionId: P1 }] }] }).success).toBe(false)
  })
  it('an export from before 0069 (no manualPromotionReasonRequired, no optionAdds) still parses', () => {
    const { manualPromotionReasonRequired: _m, ...old } = EXPECTED
    expect(ParityMoney.safeParse({ ...old, lines: [{ lineNo: 1, unitPrice: 35, discountPerCup: 0, lineTotal: 35 }] }).success).toBe(true)
  })
  const catalog = () => withPromos([LEGACY_RULE, RULE_ONLY], { promotionGroups: GROUPS })
  const FILE = () => ({
    dayo_commit: 'f4cda56f7b3515cbb3ea3f301e8461f6c720b7f4', generated_at: '2026-09-30T00:00:00.000Z', pricing_files_sha256: {}, catalog_version: 31, catalog: catalog(),
    cases: [{ spec: '7a', draft: DRAFT, expected: EXPECTED }],
    rule_fixtures: [{ fixture: 'rules-tiers.json', description: 'ขั้นบันได', catalog_version: 31, catalog: catalog(), cases: [{ name: 'ครบ 2 แก้ว', draft: DRAFT, expected: EXPECTED }] }],
  })
  it('ParityFile reads rule_fixtures {fixture, description, catalog_version, catalog, cases:[{name, draft, expected}]}', () => {
    const got = ParityFile.parse(FILE())
    expect(got.rule_fixtures?.[0]?.cases[0]?.name).toBe('ครบ 2 แก้ว')
  })
  it('rule_fixtures is optional (older exports) · a fixture catalog the tablet cannot read is refused', () => {
    const { rule_fixtures: _r, ...old } = FILE()
    expect(ParityFile.safeParse(old).success).toBe(true)
    const bad = FILE()
    ;(bad.rule_fixtures[0]!.catalog as { promotions: unknown[] }).promotions = [{ ...RULE_ONLY, rule: { ...RULE_ONLY.rule, reward: { type: 'lucky_draw' } } }]
    expect(ParityFile.safeParse(bad).success).toBe(false)
    const noName = FILE()
    ;(noName.rule_fixtures[0]!.cases[0] as Json)['name'] = ''
    expect(ParityFile.safeParse(noName).success).toBe(false)
  })
})
