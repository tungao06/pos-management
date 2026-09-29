// Plan 10 Task 5: the mock plays a dayo of a given promotion-rule release (spec 04 §4.4 · plan 10 §0.2).
// Expected values come from the contract fixture e1-catalog-changed-promo-rules (dayo f4cda56 shapes) or by hand from dayo's
// handoff table (docs/pos-handoff-promo-rules.md §1) and SQL (0074:188-202, 0069:1484-1632, 0069:1096-1098) — never from
// the mock's own output.
import { describe, expect, it } from 'vitest'
import { PosCatalogResponse } from '@dayo/contracts'
import { loadContractFixture } from '@dayo/contracts/fixture-files'
import { createMockDayo, MOCK_API_KEY, mockControl, promotionRow, promotionsFor, type CatalogPromotion, type MockDayo, type MockOptions, type PosCatalogChangedData } from '../src/index.js'

const auth = { authorization: `Bearer ${MOCK_API_KEY}`, origin: 'http://localhost:4173' }
const FX = loadContractFixture('e1-catalog-changed-promo-rules')
const fxData = (): PosCatalogChangedData => structuredClone((FX.response.body as { data: PosCatalogChangedData }).data)
type P = Record<string, unknown>
/** The five promotions exactly as dayo f4cda56 sends them at promo_rule_version=2. */
const fxPromos = (): P[] => fxData().catalog.promotions as unknown as P[]
const LEGACY = ['kind', 'params', 'daysOfWeek', 'timeFrom', 'timeTo', 'stackable']
const RULE = ['template', 'rule', 'timeWindows', 'groupCode', 'summaryTh']
const USAGE = ['usageLimitTotal', 'usageLimitPerDay']
const without = (o: P, keys: readonly string[]): P => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
/** What the owner saves on dayo's web: the rule only — dayo derives kind/params/daysOfWeek/timeFrom/timeTo/stackable itself. */
const asSaved = (): CatalogPromotion[] => fxPromos().map((p) => without(p, LEGACY)) as unknown as CatalogPromotion[]
const byId = (id: string): P => fxPromos().find((p) => p['id'] === id)!
const P1 = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f' // buy 2 get 1 · convertible · v1
const P2 = '2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091' // matcha 10% 17–20 · convertible · v1
const P3 = '3a3a3a3a-0000-4000-8000-000000000003' // tiered · v2 · group stack · never convertible
const P4 = '5c5c5c5c-0000-4000-8000-000000000004' // manual 100% · convertible · v1
const P5 = '5c5c5c5c-0000-4000-8000-000000000005' // manual −5 · group stack · not convertible · v1

/** A f4cda56 dayo holding the fixture's promotions (saved as rules) and groups, catalog_version 43. */
function rulesMock(promoRules: MockOptions['promoRules'] = { versions: [1, 2], manualFields: true }, now = '2026-09-25T03:30:01.410Z'): MockDayo {
  const d = fxData()
  return createMockDayo({ now, promoRules, catalog: { ...d, catalog: { ...d.catalog, promotions: asSaved() } } })
}
async function e1(m: MockDayo, query: string): Promise<{ status: number; body: { ok: boolean; data?: Record<string, unknown> & { catalog?: { promotions: P[]; promotionGroups?: unknown }; supported_fields: Record<string, unknown> }; error?: unknown } }> {
  const r = await m.fetch(`http://mock/api/v1/pos/catalog?${query}`, { headers: auth })
  return { status: r.status, body: await r.json() as never }
}

describe('promotionRow = dayo deriving the old shape on save (promoToLegacy · 0071 promotions trigger)', () => {
  it('a convertible rule gets kind/params/daysOfWeek/timeFrom/timeTo/stackable exactly as dayo stores them; a non-convertible one gets none', () => {
    expect(asSaved().map(promotionRow)).toEqual(fxPromos())
  })
  it('a promotion without a rule (a catalog of dayo before 0071) is kept as it is', () => {
    const legacy = without(byId(P1), RULE) as unknown as CatalogPromotion
    expect(promotionRow(legacy)).toEqual(legacy)
  })
})

describe('promotionsFor = dayo_pos_promotions_for (0074:188-202 · handoff §1 table)', () => {
  const rows = () => fxPromos() as unknown as CatalogPromotion[]
  it('version 0 (the parameter not sent): convertible ones in the old shape only, the rest left out, no usage limits', () => {
    expect(promotionsFor(rows(), 0)).toEqual([P1, P2, P4].map((id) => without(byId(id), [...RULE, ...USAGE])))
  })
  it('version 1: v1 rules with both shapes, a non-convertible v1 rule without kind, the v2 rule left out, no usage limits (ADR-0072 rule 7)', () => {
    expect(promotionsFor(rows(), 1)).toEqual([P1, P2, P4, P5].map((id) => without(byId(id), USAGE)))
  })
  it('version 2 and above: every promotion exactly as the fixture (usage limits included)', () => {
    expect(promotionsFor(rows(), 2)).toEqual(fxPromos())
    expect(promotionsFor(rows(), 9999)).toEqual(fxPromos())
  })
  it('keeps dayo\'s order and never changes its input', () => {
    const input = rows()
    const before = structuredClone(input)
    promotionsFor(input, 0)
    expect(input).toEqual(before)
  })
})

describe('E1 of a dayo with promotion rules (versions [1, 2])', () => {
  it.each([
    ['known_version=0', [P1, P2, P4].map((id) => without(byId(id), [...RULE, ...USAGE]))],
    ['known_version=0&promo_rule_version=0', [P1, P2, P4].map((id) => without(byId(id), [...RULE, ...USAGE]))],
    ['known_version=0&promo_rule_version=', [P1, P2, P4].map((id) => without(byId(id), [...RULE, ...USAGE]))],
    ['known_version=0&promo_rule_version=1', [P1, P2, P4, P5].map((id) => without(byId(id), USAGE))],
    ['known_version=0&promo_rule_version=2', fxPromos()],
    ['known_version=0&promo_rule_version=0002', fxPromos()],
    ['known_version=0&promo_rule_version=9999', fxPromos()],
  ])('%s → the promotions of the handoff table', async (query, promotions) => {
    const { status, body } = await e1(rulesMock(), query)
    expect(status).toBe(200)
    expect(body.data!.catalog!.promotions).toEqual(promotions)
    expect(() => PosCatalogResponse.parse(body)).not.toThrow() // the contract (T2) reads every answer
  })
  it('promotionGroups come with every changed answer, whatever the version (0071:4163 · docs/API.md:182)', async () => {
    const groups = fxData().catalog.promotionGroups
    for (const q of ['known_version=0', 'known_version=0&promo_rule_version=1', 'known_version=0&promo_rule_version=2']) {
      expect((await e1(rulesMock(), q)).body.data!.catalog!.promotionGroups, q).toEqual(groups)
    }
  })
  it('a shop that never made a group still has `main` (0071:1186-1188 seed · dayo_promo_groups_json 0071:1532-1542)', async () => {
    const { body } = await e1(createMockDayo({ promoRules: { versions: [1, 2], manualFields: true } }), 'known_version=0&promo_rule_version=2')
    expect(body.data!.catalog!.promotionGroups).toEqual([{ code: 'main', name: 'ทั่วไป', sortOrder: 0, stackMode: 'separate', isActive: true }])
  })
  it('supported_fields.promotion_rule_versions in the changed and the unchanged answer (0073:1715)', async () => {
    const m = rulesMock()
    expect((await e1(m, 'known_version=0&promo_rule_version=2')).body.data!.supported_fields['promotion_rule_versions']).toEqual([1, 2])
    const unchanged = await e1(m, 'known_version=43&promo_rule_version=2')
    expect(unchanged.body.data).toMatchObject({ changed: false, catalog_version: 43 })
    expect(unchanged.body.data!.supported_fields['promotion_rule_versions']).toEqual([1, 2])
    expect(() => PosCatalogResponse.parse(unchanged.body)).not.toThrow()
  })
  it('a dayo of 0071 only (versions [1]) says [1]', async () => {
    const { body } = await e1(rulesMock({ versions: [1], manualFields: true }), 'known_version=0&promo_rule_version=1')
    expect(body.data!.supported_fields['promotion_rule_versions']).toEqual([1])
  })
  it.each(['abc', '10000', '-1', '1.5', '+1', ' 1'])('promo_rule_version=%j is a 422 (apps/web/src/lib/api/pos.ts:28-33)', async (v) => {
    const { status, body } = await e1(rulesMock(), `known_version=0&promo_rule_version=${encodeURIComponent(v)}`)
    expect(status).toBe(422)
    expect(body).toEqual({ ok: false, error: { code: 'DY422', message: 'invalid: promo_rule_version ต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง 9999' } })
  })
  it('the key is checked before the parameter (authenticate first — route.ts)', async () => {
    const r = await rulesMock().fetch('http://mock/api/v1/pos/catalog?promo_rule_version=abc', { headers: { ...auth, authorization: 'Bearer dayo_wrong' } })
    expect(r.status).toBe(401)
  })
  it('manual promotion fields are advertised with the order row fields (0069 dayo_pos_supported)', async () => {
    const order = (await e1(rulesMock(), 'known_version=0')).body.data!.supported_fields['order'] as string[]
    expect(order.slice(-2)).toEqual(['manual_promotion_ids', 'manual_promotion_reason'])
  })
})

describe('E1 of a dayo before 0071 (default: versions null, manualFields false)', () => {
  it('no promotion_rule_versions, no promotionGroups, no manual fields, the parameter ignored (even abc)', async () => {
    const m = createMockDayo()
    for (const q of ['known_version=0', 'known_version=0&promo_rule_version=2', 'known_version=0&promo_rule_version=abc']) {
      const { status, body } = await e1(m, q)
      expect(status, q).toBe(200)
      expect(body.data!.supported_fields, q).not.toHaveProperty('promotion_rule_versions')
      expect(body.data!.catalog, q).not.toHaveProperty('promotionGroups')
      expect(body.data!.supported_fields['order'], q).not.toContain('manual_promotion_ids')
    }
  })
  it('a catalog handed in with rule-era keys is served the old way: groups and rule versions dropped', async () => {
    const d = fxData()
    const { body } = await e1(createMockDayo({ catalog: { ...d, catalog: { ...d.catalog, promotions: asSaved() } } }), 'known_version=0&promo_rule_version=2')
    expect(body.data!.catalog).not.toHaveProperty('promotionGroups')
    expect(body.data!.supported_fields).not.toHaveProperty('promotion_rule_versions')
  })
  it('a dayo of 0069/0070 (manual fields, no rule versions) advertises the manual fields only', async () => {
    const { body } = await e1(createMockDayo({ promoRules: { versions: null, manualFields: true } }), 'known_version=0')
    expect(body.data!.supported_fields['order']).toContain('manual_promotion_reason')
    expect(body.data!.supported_fields).not.toHaveProperty('promotion_rule_versions')
  })
})

describe('switching the dayo release at run time', () => {
  it('setPromoRules bumps catalog_version (0071 seeds `main` → its catalog_versions trigger, 0071:1103-1108,1186)', async () => {
    const m = createMockDayo()
    const v = m.setPromoRules({ versions: [1, 2], manualFields: true })
    expect(v).toBe(43)
    const { body } = await e1(m, 'known_version=42&promo_rule_version=2')
    expect(body.data).toMatchObject({ changed: true, catalog_version: 43 })
    expect(body.data!.supported_fields['promotion_rule_versions']).toEqual([1, 2])
  })
  it('setPromotions stores what the owner saves (derived the dayo way) and bumps catalog_version', async () => {
    const m = createMockDayo({ promoRules: { versions: [1, 2], manualFields: true } })
    const groups = fxData().catalog.promotionGroups!
    const v = m.setPromotions(asSaved(), groups)
    expect(v).toBe(43)
    const { body } = await e1(m, 'known_version=0&promo_rule_version=2')
    expect(body.data!.catalog!.promotions).toEqual(fxPromos())
    expect(body.data!.catalog!.promotionGroups).toEqual(groups)
  })
})

describe('e2e control routes (server.ts /__mock/*)', () => {
  it('/__mock/promo-rules then /__mock/promotions: each bumps and answers the new catalog_version', async () => {
    const m = createMockDayo()
    expect(await mockControl(m, '/__mock/promo-rules', { versions: [1, 2], manualFields: true })).toEqual({ status: 200, body: { catalog_version: 43 } })
    const groups = fxData().catalog.promotionGroups
    expect(await mockControl(m, '/__mock/promotions', { promotions: asSaved(), groups })).toEqual({ status: 200, body: { catalog_version: 44 } })
    const { body } = await e1(m, 'known_version=43&promo_rule_version=1')
    expect(body.data!.catalog!.promotions).toEqual([P1, P2, P4, P5].map((id) => without(byId(id), USAGE)))
    expect(body.data!.catalog!.promotionGroups).toEqual(groups)
  })
})

// ── E2: manual_promotion_ids / manual_promotion_reason (dayo 0069:1484-1632 · 0069:288-345 · 0069:1096-1098) ──
type Row = { key: string; kind: 'order'; data: Record<string, unknown> }
const accepted = loadContractFixture('e2-order-manual-promo-accepted')
const fxRows = (): Row[] => structuredClone((accepted.request.body as { rows: Row[] }).rows)
/** Row 1: Thai Tea 16 oz ฿35 with P5 (−5) → ฿30 · row 2: Matcha ฿85 with P4 (100%) → ฿0 + reason. */
const thaiRow = (): Row => fxRows()[0]!
const matchaRow = (): Row => fxRows()[1]!
async function push(m: MockDayo, rows: Row[]): Promise<{ key: string; status: string; reason?: string; detail?: string; data?: Record<string, unknown> }[]> {
  const r = await m.fetch('http://mock/api/v1/pos/push', { method: 'POST', headers: auth, body: JSON.stringify({ device_time: '2026-09-25T03:30:00.000Z', rows }) })
  return ((await r.json()) as { data: { results: never[] } }).data.results
}
const REASON_REQUIRED = 'reason_required: โปรที่เลือกเองทำให้บิลเหลือ ฿0 ต้องใส่เหตุผลค่ะ'
const uuidN = (n: number): string => `6e6e6e6e-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('E2 manual promotion fields', () => {
  it('a dayo without them (manualFields false) defers the row UNSUPPORTED — the rule for any unknown field', async () => {
    const [r] = await push(rulesMock({ versions: [1, 2], manualFields: false }), [thaiRow()])
    expect(r).toEqual({ key: thaiRow().key, status: 'deferred', reason: 'UNSUPPORTED', detail: 'มีฟิลด์ที่ระบบกลางยังไม่รองรับ' })
  })
  it('a dayo of 0069 (manual fields, no rule versions) takes them', async () => {
    const [r] = await push(rulesMock({ versions: null, manualFields: true }), [thaiRow()])
    expect(r).toMatchObject({ status: 'accepted', data: { computed_total: 30, amount_mismatch: false } })
  })
  it.each([
    ['a string', 'x'], ['an upper-case uuid', [P5.toUpperCase()]], ['a number', [1]], ['an object', { id: P5 }],
  ])('manual_promotion_ids as %s is rejected INVALID (0069:1620-1627)', async (_, v) => {
    const row = thaiRow()
    row.data['manual_promotion_ids'] = v
    expect((await push(rulesMock(), [row]))[0]).toMatchObject({ status: 'rejected', reason: 'INVALID', detail: 'manual_promotion_ids ต้องเป็น array ของ uuid' })
  })
  it.each([
    ['empty', ''], ['spaces only', '   '], ['201 characters', 'ก'.repeat(201)], ['a zero-width space', 'ชง\u200bผิด'], ['a C1 control', 'ชง\u0085ผิด'],
    ['a bidi override', 'ชง\u202eผิด'], ['a line separator', 'ชง\u2028ผิด'], ['a tab', 'ชง\tผิด'], ['a number', 5],
  ])('manual_promotion_reason with %s is rejected INVALID (0069:1628-1633)', async (_, v) => {
    const row = matchaRow()
    row.data['manual_promotion_reason'] = v
    expect((await push(rulesMock(), [row]))[0]).toMatchObject({ status: 'rejected', reason: 'INVALID', detail: 'manual_promotion_reason ต้องเป็นข้อความ 1–200 ตัวอักษร หรือ null' })
  })
  it('more than 20 after de-duplication is rejected INVALID too_large: (dayo_draft_manual_promotions 0069:288-318 → dayo_pos_map_error)', async () => {
    const row = thaiRow()
    row.data['manual_promotion_ids'] = [P5, ...Array.from({ length: 20 }, (_, i) => uuidN(i + 1))]
    expect((await push(rulesMock(), [row]))[0]).toEqual({ key: row.key, status: 'rejected', reason: 'INVALID', detail: 'too_large: เลือกโปรเองได้ไม่เกิน 20 ตัวต่อบิล' })
  })
  it('21 ids with one repeated are 20 after de-duplication → accepted', async () => {
    const row = thaiRow()
    row.data['manual_promotion_ids'] = [P5, ...Array.from({ length: 19 }, (_, i) => uuidN(i + 1)), P5]
    expect((await push(rulesMock(), [row]))[0]).toMatchObject({ status: 'accepted', data: { computed_total: 30 } })
  })
  it('null or [] = no manual promotions (dayo_pos_has / dayo_draft_manual_promotions → null)', async () => {
    const a = thaiRow()
    a.data['manual_promotion_ids'] = null
    const b = { ...thaiRow(), key: 'order:5d5d5d5d-0000-4000-8000-00000000000b' }
    b.data = { ...b.data, pos_order_id: '5d5d5d5d-0000-4000-8000-00000000000b', receipt_no: 'A-000399', manual_promotion_ids: [] }
    const res = await push(rulesMock(), [a, b])
    expect(res.map((r) => r.status)).toEqual(['accepted', 'accepted'])
  })
})

describe('E2 reason_required: (ADR-0070 rule 4 · 0069:1096-1098 — judged on dayo\'s own quote at sold_at)', () => {
  it('฿0 from a manual promotion without a reason → rejected INVALID reason_required:', async () => {
    const row = matchaRow()
    delete row.data['manual_promotion_reason']
    expect((await push(rulesMock(), [row]))[0]).toEqual({ key: row.key, status: 'rejected', reason: 'INVALID', detail: REASON_REQUIRED })
  })
  it('a reason dayo trims to nothing (U+3000, NBSP) counts as none (dayo_trim_ws → null)', async () => {
    for (const reason of ['\u3000', '\u00a0\u3000']) {
      const row = matchaRow()
      row.data['manual_promotion_reason'] = reason
      expect((await push(rulesMock(), [row]))[0], JSON.stringify(reason)).toMatchObject({ status: 'rejected', reason: 'INVALID', detail: REASON_REQUIRED })
    }
  })
  it('a reason with a space around it is fine (trimmed like dayo)', async () => {
    const row = matchaRow()
    row.data['manual_promotion_reason'] = '  ชงผิดสูตร  '
    expect((await push(rulesMock(), [row]))[0]).toMatchObject({ status: 'accepted', data: { computed_total: 0 } })
  })
  it('฿0 where the manual promotion gives nothing (Thai Tea promo on a free Matcha) → no reason needed', async () => {
    const row = matchaRow()
    delete row.data['manual_promotion_reason']
    row.data['manual_promotion_ids'] = [P5]
    row.data['lines'] = [{ ...(row.data['lines'] as P[])[0], free: true }]
    expect((await push(rulesMock(), [row]))[0]).toMatchObject({ status: 'accepted' })
  })
  it('the manual promotion closed before sold_at: dayo prices ฿85, no reason needed, amount_mismatch (hand: Matcha ฿85, no promotion active 10:25)', async () => {
    const m = rulesMock()
    m.closePromotion(P4, '2026-09-25T03:00:00.000Z')
    const row = matchaRow()
    delete row.data['manual_promotion_reason']
    expect((await push(m, [row]))[0]).toMatchObject({ status: 'accepted', data: { computed_total: 85, amount_mismatch: true } })
  })
  it('the re-price sends the manual promotions too: P5 closed before sold_at → dayo ฿35 (hand: ฿35 − nothing)', async () => {
    // computed = total + quote(active at sold_at) − quote(+ closed) = 30 + 35 − 30; without the manual ids in the draft
    // the tablet-side quote would be 35 and computed 30 (no mismatch) — wrong
    const m = rulesMock()
    m.closePromotion(P5, '2026-09-25T03:00:00.000Z')
    expect((await push(m, [thaiRow()]))[0]).toMatchObject({ status: 'accepted', data: { computed_total: 35, amount_mismatch: true } })
  })
  it('a duplicate of an accepted bill is still a duplicate (the key check comes first)', async () => {
    const m = rulesMock()
    const row = matchaRow()
    expect((await push(m, [row]))[0]!.status).toBe('accepted')
    expect((await push(m, [row]))[0]!.status).toBe('duplicate')
  })
})
