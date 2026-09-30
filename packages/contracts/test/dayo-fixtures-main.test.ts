// Task 19 step A round 2: the E1/E2/E3 fixtures against what dayo main really emits (docs/pos-task19-replay-report.md, dayo repo,
// "รอบ 2" R2-1..R2-7). The old-shape E1 files stay on purpose (older dayo); `e1-catalog-changed-main` is the one that is main.
import { describe, expect, it } from 'vitest'
import {
  BLOCK3_PHASE1_KINDS, BLOCK3_PHASE1_SUPPORTED_FIELDS, CentralOrder, OrdersListResponse, PosCatalogLooseResponse, PosCatalogResponse, PosOrderCatalog, PushResponse,
  supportedOf, type PosCatalogData,
} from '../src/dayo-api.js'
import { CONTRACT_FIXTURE_NAMES, DAYO_MAIN_FIXTURE_NAMES, OLDER_DAYO_FIXTURE_NAMES } from '../src/dayo-fixture.js'
import { loadContractFixture } from '../src/dayo-fixture-files.js'

type Json = Record<string, unknown>
const E1_CHANGED = CONTRACT_FIXTURE_NAMES.filter((n) => n.startsWith('e1-catalog-changed'))
const changedOf = (name: string): Extract<PosCatalogData, { changed: true }> => {
  const d = PosCatalogResponse.parse(loadContractFixture(name).response.body).data
  if (!d.changed) throw new Error(`${name}: changed:true expected`)
  return d
}
/** menu_items.family check of dayo 0002_catalog.sql:72 — the only four values dayo can emit. */
const DAYO_FAMILIES = ['ชาไทย', 'ชาเขียว', 'มัตจะ', 'อื่นๆ']

describe('R2-4: variants[].family is one dayo can emit (0002_catalog.sql:72)', () => {
  it('covers all five e1-catalog-changed* files', () => {
    expect(E1_CHANGED).toEqual(['e1-catalog-changed', 'e1-catalog-changed-block3', 'e1-catalog-changed-main', 'e1-catalog-changed-old-dayo', 'e1-catalog-changed-promo-rules'])
  })
  it.each(E1_CHANGED)('%s', (name) => {
    for (const v of changedOf(name).catalog.variants) expect(DAYO_FAMILIES, `${name} ${v.menuCode}`).toContain(v.family)
  })
})

describe('R2-5: a promotion converted from the old shape carries rule.stop_group = !stackable (0071:622,637-669)', () => {
  it.each(['e1-catalog-changed-promo-rules', 'e1-catalog-changed-main'])('%s', (name) => {
    const promos = changedOf(name).catalog.promotions as Json[]
    const converted = promos.filter((p) => typeof p['kind'] === 'string' && p['rule'] !== undefined)
    expect(converted.length).toBeGreaterThan(0)
    for (const p of converted) {
      const stop = (p['rule'] as Json)['stop_group']
      expect(stop, `${name} ${String(p['name'])}`).toBe(p['stackable'] === false)
    }
  })
  it('a rule-only promotion keeps the rule exactly as the owner saved it (no stop_group invented)', () => {
    const promos = changedOf('e1-catalog-changed-promo-rules').catalog.promotions as Json[]
    for (const p of promos.filter((x) => !('kind' in x))) expect('stop_group' in (p['rule'] as Json), String(p['name'])).toBe(false)
  })
})

describe('R2-6: e2-unsupported-kind-and-field — dayo main knows shift_open, so its `id` field is the unsupported one', () => {
  it('both rows are deferred UNSUPPORTED with the detail of an unsupported FIELD', () => {
    const results = PushResponse.parse(loadContractFixture('e2-unsupported-kind-and-field').response.body).data.results
    expect(results.map((r) => [r.status, r.status === 'accepted' ? null : r.reason, r.status === 'accepted' ? null : r.detail])).toEqual([
      ['deferred', 'UNSUPPORTED', 'มีฟิลด์ที่ระบบกลางยังไม่รองรับ'],
      ['deferred', 'UNSUPPORTED', 'มีฟิลด์ที่ระบบกลางยังไม่รองรับ'],
    ])
  })
})

describe('E1 fixtures of older dayo vs dayo main (report R2-1..R2-3)', () => {
  it('are listed, sorted, and part of CONTRACT_FIXTURE_NAMES', () => {
    expect([...OLDER_DAYO_FIXTURE_NAMES]).toEqual([...OLDER_DAYO_FIXTURE_NAMES].sort())
    expect([...DAYO_MAIN_FIXTURE_NAMES]).toEqual([...DAYO_MAIN_FIXTURE_NAMES].sort())
    for (const n of [...OLDER_DAYO_FIXTURE_NAMES, ...DAYO_MAIN_FIXTURE_NAMES]) expect(CONTRACT_FIXTURE_NAMES as readonly string[]).toContain(n)
    expect(OLDER_DAYO_FIXTURE_NAMES.filter((n) => (DAYO_MAIN_FIXTURE_NAMES as readonly string[]).includes(n))).toEqual([])
    expect([...OLDER_DAYO_FIXTURE_NAMES]).toEqual(['e1-catalog-changed', 'e1-catalog-changed-block3', 'e1-catalog-changed-old-dayo', 'e1-catalog-unchanged'])
    expect([...DAYO_MAIN_FIXTURE_NAMES]).toContain('e1-catalog-changed-main')
  })
  it('the older ones really are the older shape (kept on purpose to test older dayo): no promotion_rule_versions', () => {
    for (const name of OLDER_DAYO_FIXTURE_NAMES) {
      const body = loadContractFixture(name).response.body as { data: Json }
      const s = supportedOf(body.data['supported_kinds'] as string[], body.data['supported_fields'] as Json)
      expect(s.promoRuleVersions, name).toEqual([]) // dayo main sends [1, 2] in changed AND unchanged answers
    }
  })
  it('every other E1 answer of the contract is dayo main\'s (promotion_rule_versions [1, 2])', () => {
    const e1 = CONTRACT_FIXTURE_NAMES.filter((n) => n.startsWith('e1-catalog-') && !(OLDER_DAYO_FIXTURE_NAMES as readonly string[]).includes(n))
    expect(e1).toEqual(['e1-catalog-changed-main', 'e1-catalog-changed-promo-rules', 'e1-catalog-unchanged-promo-rules'])
    for (const name of e1) {
      const d = PosCatalogLooseResponse.parse(loadContractFixture(name).response.body).data
      expect(supportedOf(d.supported_kinds, d.supported_fields).promoRuleVersions, name).toEqual([1, 2])
    }
  })
})

describe('e1-catalog-changed-main = the E1 shape of dayo main (0066:594-606 · 0067:134-155 · 0069:1486-1508 · 0071 · 0073:1713-1715 · 0074:163-202)', () => {
  const fx = () => loadContractFixture('e1-catalog-changed-main')
  it('asks known_version=0 with promo_rule_version=1 (a tablet not doing tiers yet — docs/API.md:190)', () => {
    const u = new URL(`http://x${fx().request.path}`)
    expect([u.pathname, u.searchParams.get('known_version'), u.searchParams.get('promo_rule_version')]).toEqual(['/api/v1/pos/catalog', '0', '1'])
  })
  it('has the 4 shift kinds + order/order_void, their fields, manual_promotion_* and promotion_rule_versions [1, 2] — and no phase-2 kind', () => {
    const d = changedOf('e1-catalog-changed-main')
    expect(d.supported_kinds).toEqual(['order', 'order_void', ...BLOCK3_PHASE1_KINDS])
    const s = supportedOf(d.supported_kinds, d.supported_fields)
    expect(s.promoRuleVersions).toEqual([1, 2])
    expect(s.fields['order']).toEqual(expect.arrayContaining(['manual_promotion_ids', 'manual_promotion_reason']))
    const sorted = (f: Readonly<Record<string, readonly string[]>>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, [...v].sort()]))
    for (const [kind, fields] of Object.entries(BLOCK3_PHASE1_SUPPORTED_FIELDS)) expect(sorted(s.fields)[kind], kind).toEqual([...fields].sort())
    expect(Object.keys(s.fields)).not.toContain('order_off_catalog')
  })
  it('client.last_z_* are filled (an earlier Z of this key) — last_z_until in dayo\'s …mmm+00:00 form', () => {
    const c = changedOf('e1-catalog-changed-main').client
    expect(c.last_z_no).toBe(41)
    expect(c.last_z_hash).toBe('ab'.repeat(32))
    expect(c.last_z_until).toBe('2026-09-24T12:00:00.000+00:00')
  })
  it('promotions: applyMode on every one, times HH:MM, groups sent, no usage limits and no v2 promotion at promo_rule_version=1', () => {
    const d = changedOf('e1-catalog-changed-main')
    const promos = d.catalog.promotions as Json[]
    expect(promos.length).toBeGreaterThan(0)
    for (const p of promos) {
      expect(['auto', 'code', 'manual'], String(p['name'])).toContain(p['applyMode'])
      for (const k of ['timeFrom', 'timeTo']) if (typeof p[k] === 'string') expect(p[k], `${String(p['name'])} ${k}`).toMatch(/^\d{2}:\d{2}$/)
      for (const w of (p['timeWindows'] as { from: string | null; to: string | null }[] | undefined) ?? []) for (const t of [w.from, w.to]) if (t !== null) expect(t).toMatch(/^\d{2}:\d{2}$/)
      expect('usageLimitTotal' in p || 'usageLimitPerDay' in p, String(p['name'])).toBe(false) // 0074:198: dropped below version 2
      expect((p['rule'] as { v?: number } | undefined)?.v ?? 1, String(p['name'])).toBeLessThanOrEqual(1) // 0074:194-201: v2 rules are not shown
    }
    expect(promos.some((p) => typeof p['timeFrom'] === 'string')).toBe(true)
    expect(promos.some((p) => p['applyMode'] === 'manual')).toBe(true)
    expect(promos.some((p) => !('kind' in p))).toBe(true) // a rule-only promotion of v1 is still sent
    const groups = new Set((d.catalog.promotionGroups ?? []).map((g) => g.code))
    expect(groups.size).toBeGreaterThan(0)
    expect(promos.every((p) => groups.has(p['groupCode'] as string))).toBe(true)
  })
  it('the staff list and the rest of the catalog are those of e1-catalog-changed-promo-rules', () => {
    const main = changedOf('e1-catalog-changed-main')
    const rules = changedOf('e1-catalog-changed-promo-rules')
    expect(main.staff).toEqual(rules.staff)
    expect(main.pricing).toEqual(rules.pricing)
    expect({ ...main.catalog, promotions: null }).toEqual({ ...rules.catalog, promotions: null })
  })
})

describe('promotion times: HH:MM (dayo main) and HH:MM:SS (older dayo, the Postgres time as is) both parse', () => {
  const PROMO = { id: 'p1', code: null, name: 'x', kind: 'item_discount', requiresCode: false, autoApply: true, priority: 1, isActive: true, stackable: true, params: { menu_codes: [], percent: 10 } }
  const catalog = (timeFrom: string, timeTo: string) => ({ ...changedOf('e1-catalog-changed-main').catalog, promotions: [{ ...PROMO, timeFrom, timeTo }] })
  it.each([['17:00', '20:00'], ['17:00:00', '20:00:00'], ['17:00:00.5', '20:00']])('%s – %s passes through unchanged', (a, b) => {
    const got = PosOrderCatalog.parse(catalog(a, b)).promotions[0]!
    expect([got.timeFrom, got.timeTo]).toEqual([a, b])
  })
  it.each([['5:00', '20:00'], ['17', '20:00'], ['17:00:0', '20:00']])('%s – %s is refused', (a, b) => {
    expect(PosOrderCatalog.safeParse(catalog(a, b)).success).toBe(false)
  })
  it('e1-catalog-changed (older dayo) has HH:MM:SS; e1-catalog-changed-main has HH:MM — both files parse', () => {
    const times = (name: string) => (changedOf(name).catalog.promotions as Json[]).flatMap((p) => [p['timeFrom'], p['timeTo']]).filter((t): t is string => typeof t === 'string')
    expect(times('e1-catalog-changed').length).toBeGreaterThan(0)
    expect(times('e1-catalog-changed').every((t) => /^\d{2}:\d{2}:\d{2}$/.test(t))).toBe(true)
    expect(times('e1-catalog-changed-main').length).toBeGreaterThan(0)
    expect(times('e1-catalog-changed-main').every((t) => /^\d{2}:\d{2}$/.test(t))).toBe(true)
  })
})

describe('R2-7: E3 timestamps with 6 fractional digits (Postgres timestamptz → …01.615815+00:00) parse', () => {
  const base = (loadContractFixture('e3-orders-today').response.body as { data: Json[] }).data
  const edited = base.find((r) => r['dayo_edit'] !== null)!
  it('updated_at and dayo_edit.edited_at with 6 digits (and 0–6 digits in general)', () => {
    for (const frac of ['', '.6', '.615', '.615815', '.000001']) {
      const ts = `2026-09-25T04:02:11${frac}+00:00`
      const row = { ...edited, updated_at: ts, sold_at: ts, dayo_edit: { ...(edited['dayo_edit'] as Json), edited_at: ts } }
      const got = CentralOrder.parse(row)
      expect(got.updated_at, frac).toBe(ts)
      expect(got.dayo_edit?.edited_at, frac).toBe(ts)
      expect(OrdersListResponse.safeParse({ ok: true, data: [row] }).success, frac).toBe(true)
    }
  })
  it('a 6-digit instant is a real instant (Date.parse keeps the millisecond part)', () => {
    expect(Date.parse('2026-09-25T04:02:11.615815+00:00')).toBe(Date.parse('2026-09-25T04:02:11.615+00:00'))
  })
  it('a timestamp that is not an instant is still refused', () => {
    expect(CentralOrder.safeParse({ ...edited, updated_at: '2026-13-25T04:02:11.615815+00:00' }).success).toBe(false)
    expect(CentralOrder.safeParse({ ...edited, updated_at: '2026-09-25 04:02:11.615815' }).success).toBe(false)
  })
})
