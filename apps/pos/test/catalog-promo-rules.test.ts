import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { MOCK_API_KEY } from '@dayo/dayo-mock'
import { loadContractFixture } from '@dayo/contracts/fixture-files'
import { PROMO_RULE_VERSIONS } from '@dayo/dayo-pricing'
import vendor from '@dayo/dayo-pricing/VENDOR.json' with { type: 'json' }
import { pullCatalog, readCatalog, readSupported } from '../src/sync/catalog'
import { createDayoClient } from '../src/sync/dayo-client'
import { isHeld } from '../src/sync/push'
import { TABLET_PROMO_RULE_VERSION } from '../src/sync/promo-rules-stub'
import { DAYO_KEYS, readKey, writeKey } from '../src/sync/state'
import { openTestApi } from './helpers/db'

/**
 * plan 10 T7 (§0.2 E1 rows · R6 · R12 · F2 · Q6): the tablet's E1 pull against the T2 contract fixtures of dayo f4cda56
 * (rule engine, [1, 2]) and of a dayo before 0071 (no promotion_rule_versions, legacy promotions only).
 */

const PIN = 'argon2id$t=1,m=64,p=1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000'
const TUNGAO = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'
const DCM = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d'

type E1Data = Record<string, unknown> & { changed: boolean; catalog_version: number; supported_fields: Record<string, unknown>; catalog?: { promotions: Record<string, unknown>[]; promotionGroups?: unknown[] }; staff?: { id: string; active: boolean; role: string; display_name: string | null }[]; pricing: { commit: string | null; files_sha256: Record<string, string> } }
const dataOf = (name: string): E1Data => structuredClone((loadContractFixture(name).response.body as { data: E1Data }).data)

/**
 * A dayo that answers E1 with `data` — `changed:false` (same supported_* / pricing) when known_version equals its version,
 * like dayo_pos_catalog. Every URL asked is kept.
 */
function e1Dayo(first: E1Data) {
  let data = first
  const urls: URL[] = []
  const serve: typeof globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    urls.push(url)
    const known = Number(url.searchParams.get('known_version'))
    const body = known === data.catalog_version
      ? { changed: false, catalog_version: data.catalog_version, server_time: data.server_time, pricing: data.pricing, supported_kinds: data.supported_kinds, supported_fields: data.supported_fields }
      : data
    return new Response(JSON.stringify({ ok: true, data: body }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { fetch: serve, urls, answer: (next: E1Data) => { data = next } }
}

async function linked(first: E1Data) {
  const dayo = e1Dayo(first)
  const t = await openTestApi({ fetch: dayo.fetch, now: '2026-09-30T03:00:00.000Z' })
  await writeKey(t.db, DAYO_KEYS.baseUrl, 'https://mock/api/v1')
  await t.deps.secrets.setApiKey(MOCK_API_KEY)
  const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
  return { dayo, t, ctx }
}

async function withPins(t: Awaited<ReturnType<typeof openTestApi>>): Promise<void> {
  const at = t.clock.now()
  await t.db.insert(s.user).values([
    { id: TUNGAO, displayName: 'TungAo', role: 'owner', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 },
    { id: DCM, displayName: 'DCm', role: 'staff', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 },
  ])
}
const userActive = async (t: Awaited<ReturnType<typeof openTestApi>>, id: string) => (await t.db.select().from(s.user).where(eq(s.user.id, id)).get())?.isActive
const asked = (u: URL | undefined) => ({ known: u?.searchParams.get('known_version'), rule: u?.searchParams.get('promo_rule_version') })

describe('TABLET_PROMO_RULE_VERSION (plan 10 §0.2 · Q5)', () => {
  it('is the highest rule version of the vendored engine (= 2 at f4cda56)', () => {
    expect(TABLET_PROMO_RULE_VERSION).toBe(Math.max(...PROMO_RULE_VERSIONS))
    expect(TABLET_PROMO_RULE_VERSION).toBe(2)
  })
})

describe('E1 request carries promo_rule_version (plan 10 §0.2)', () => {
  it('dayo-client puts both parameters on the URL', async () => {
    const dayo = e1Dayo(dataOf('e1-catalog-changed-promo-rules'))
    const c = createDayoClient({ baseUrl: 'https://mock/api/v1', apiKey: MOCK_API_KEY, fetch: dayo.fetch, nowMs: () => 0 })
    await c.getCatalog(7, 2)
    expect(dayo.urls[0]!.pathname + dayo.urls[0]!.search).toBe('/api/v1/pos/catalog?known_version=7&promo_rule_version=2')
  })
  it('pullCatalog asks with the tablet version: known_version=0 first, then the stored version', async () => {
    const { ctx, dayo } = await linked(dataOf('e1-catalog-changed-promo-rules'))
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    expect((await pullCatalog(ctx)).outcome).toBe('unchanged')
    expect(dayo.urls.map(asked)).toEqual([{ known: '0', rule: '2' }, { known: '43', rule: '2' }])
  })
})

describe('F2: an E1 answer with supported_fields.promotion_rule_versions [1, 2]', () => {
  it('updates the staff list AND the catalog (an old dayo catalog before it)', async () => {
    const { ctx, t, dayo } = await linked(dataOf('e1-catalog-changed-old-dayo'))
    await withPins(t)
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    expect((await readCatalog(t.db))?.catalogVersion).toBe(42)
    const next = dataOf('e1-catalog-changed-promo-rules')
    next.staff = next.staff!.map((x) => (x.id === DCM ? { ...x, active: false } : x)) // DCm leaves the same day
    dayo.answer(next)
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    const c = await readCatalog(t.db)
    expect(c?.catalogVersion).toBe(43)
    expect(c?.catalog.promotions).toHaveLength(5)
    expect(c?.catalog.promotions.some((p) => (p as { kind?: unknown }).kind === undefined)).toBe(true) // the rule-only shape is kept
    expect(c?.catalog.promotionGroups?.map((g) => g.code)).toEqual(['main', 'stack'])
    expect(c?.staff.find((x) => x.id === DCM)?.active).toBe(false)
    expect(await userActive(t, DCM)).toBe(false)
    expect(await userActive(t, TUNGAO)).toBe(true)
    expect(await readKey(t.db, DAYO_KEYS.catalogError)).toBeNull()
    expect(await readKey(t.db, DAYO_KEYS.catalogRuleVersion)).toBe('2')
  })
  it('stores supportedOf(...): only string[] field lists, the rule versions as numbers', async () => {
    const d = dataOf('e1-catalog-changed-promo-rules')
    d.supported_fields = { ...d.supported_fields, odd_kind: { not: 'a list' }, other: 5 }
    const { ctx, t } = await linked(d)
    await pullCatalog(ctx)
    const stored = JSON.parse((await readKey(t.db, DAYO_KEYS.supportedJson))!) as Record<string, unknown>
    expect(Object.keys(stored).sort()).toEqual(['fields', 'kinds', 'promoRuleVersions'])
    const sup = (await readSupported(t.db))!
    expect(sup.promoRuleVersions).toEqual([1, 2])
    expect(Object.keys(sup.fields)).not.toContain('promotion_rule_versions')
    expect(Object.keys(sup.fields)).not.toContain('odd_kind')
    expect(Object.keys(sup.fields)).not.toContain('other')
    expect(sup.fields.order).toContain('manual_promotion_ids')
  })
  it('an unchanged answer updates supported_* too (dayo moved to 0071+ without a new catalog version)', async () => {
    const old = dataOf('e1-catalog-changed-old-dayo')
    old.catalog_version = 43
    const { ctx, t, dayo } = await linked(old)
    await pullCatalog(ctx)
    expect((await readSupported(t.db))?.promoRuleVersions).toEqual([])
    const unchanged = dataOf('e1-catalog-unchanged-promo-rules')
    dayo.answer({ ...old, supported_fields: unchanged.supported_fields, supported_kinds: unchanged.supported_kinds })
    expect((await pullCatalog(ctx)).outcome).toBe('unchanged')
    expect((await readSupported(t.db))?.promoRuleVersions).toEqual([1, 2])
    expect((await t.api.bootstrap()).promo).toEqual({ manualSupported: true, ruleBehind: false, ruleVersions: [1, 2] })
  })
})

describe('R6: a catalog fetched with another rule version', () => {
  it('asks known_version=0 once the tablet version differs from the stored one, then the stored version again', async () => {
    const { ctx, t, dayo } = await linked(dataOf('e1-catalog-changed-promo-rules'))
    await pullCatalog(ctx)
    await writeKey(t.db, DAYO_KEYS.catalogRuleVersion, '1') // the catalog was fetched by an app that asked for rules v1
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    expect(await readKey(t.db, DAYO_KEYS.catalogRuleVersion)).toBe('2')
    expect((await pullCatalog(ctx)).outcome).toBe('unchanged')
    expect(dayo.urls.map(asked).slice(1)).toEqual([{ known: '0', rule: '2' }, { known: '43', rule: '2' }])
  })
  it('a catalog stored before plan 10 (no rule version recorded) is fetched again in full', async () => {
    const { ctx, t, dayo } = await linked(dataOf('e1-catalog-changed-promo-rules'))
    await pullCatalog(ctx)
    await t.db.delete(s.syncState).where(eq(s.syncState.key, DAYO_KEYS.catalogRuleVersion))
    await pullCatalog(ctx)
    expect(asked(dayo.urls[1])).toEqual({ known: '0', rule: '2' })
  })
  it('an unreadable stored rule version is not trusted either', async () => {
    const { ctx, t, dayo } = await linked(dataOf('e1-catalog-changed-promo-rules'))
    await pullCatalog(ctx)
    await writeKey(t.db, DAYO_KEYS.catalogRuleVersion, '2.0x')
    await pullCatalog(ctx)
    expect(asked(dayo.urls[1])).toEqual({ known: '0', rule: '2' })
  })
})

describe('R12: a catalog whose promotion rules the tablet cannot use is refused whole — staff still follow dayo', () => {
  const broken: [string, (d: E1Data) => void, RegExp][] = [
    ['a groupCode missing from promotionGroups', (d) => { d.catalog!.promotions[2]!.groupCode = 'ghost' }, /ghost/],
    ['a rule whose v is below what its reward needs (validatePromoRule)', (d) => { (d.catalog!.promotions[2]!.rule as { v: number }).v = 1 }, /v: ต้องเป็น 2/],
    ['a time window on day 7 (validateTimeWindows)', (d) => { d.catalog!.promotions[4]!.timeWindows = [{ days: [7], from: null, to: null }] }, /days/],
    ['no promotionGroups at all while a promotion names a group other than main', (d) => { delete d.catalog!.promotionGroups }, /stack/],
  ]
  it.each(broken)('%s', async (_name, breakIt, detail) => {
    const { ctx, t, dayo } = await linked(dataOf('e1-catalog-changed-old-dayo'))
    await withPins(t)
    await pullCatalog(ctx)
    await writeKey(t.db, DAYO_KEYS.catalogRuleVersion, '1')
    const bad = dataOf('e1-catalog-changed-promo-rules')
    breakIt(bad)
    bad.staff = bad.staff!.map((x) => (x.id === DCM ? { ...x, active: false } : x))
    dayo.answer(bad)
    expect((await pullCatalog(ctx)).outcome).toBe('catalog_rejected')
    const kept = await readCatalog(t.db)
    expect(kept?.catalogVersion).toBe(42) // the old copy stays for selling
    expect(kept?.catalog.promotions).toHaveLength(2)
    expect(kept?.staff.find((x) => x.id === DCM)?.active).toBe(false) // …but the staff copy follows dayo
    expect(await userActive(t, DCM)).toBe(false)
    const err = await readKey(t.db, DAYO_KEYS.catalogError)
    expect(err).toMatch(/^CATALOG_UNREADABLE/)
    expect(err).toMatch(detail)
    expect(await readKey(t.db, DAYO_KEYS.catalogRuleVersion)).toBe('1') // written only with an accepted catalog
    expect((await readSupported(t.db))?.promoRuleVersions).toEqual([1, 2]) // supported_* from every answer
    // next pull asks in full again (old version kept + rule version differs) and a good answer is accepted
    dayo.answer(dataOf('e1-catalog-changed-promo-rules'))
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    expect(asked(dayo.urls.at(-1))).toEqual({ known: '0', rule: '2' })
    expect(await readKey(t.db, DAYO_KEYS.catalogError)).toBeNull()
  })
  it('a legacy promotion with groupCode main needs no promotionGroups (dayo before 0071 has none)', async () => {
    const d = dataOf('e1-catalog-changed-old-dayo')
    d.catalog!.promotions[0]!.groupCode = 'main'
    const { ctx, t } = await linked(d)
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    expect(await readKey(t.db, DAYO_KEYS.catalogError)).toBeNull()
  })
})

describe('dayo before 0071 (ignores promo_rule_version)', () => {
  it('its legacy catalog is stored and usable · no manual promotions · no rule versions', async () => {
    const { ctx, t } = await linked(dataOf('e1-catalog-changed-old-dayo'))
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    const c = await readCatalog(t.db)
    expect(c?.catalogVersion).toBe(42)
    expect(c?.catalog.promotions.map((p) => p.kind)).toEqual(['buy_n_get_m', 'item_discount'])
    expect(await readKey(t.db, DAYO_KEYS.catalogRuleVersion)).toBe('2') // the version the tablet asked with
    expect((await readSupported(t.db))?.promoRuleVersions).toEqual([])
    expect((await t.api.bootstrap()).promo).toEqual({ manualSupported: false, ruleBehind: false, ruleVersions: [] })
  })
})

describe('BootstrapState.promo', () => {
  it('dayo f4cda56: manual promotions supported, not behind', async () => {
    const { ctx, t } = await linked(dataOf('e1-catalog-changed-promo-rules'))
    await pullCatalog(ctx)
    expect((await t.api.bootstrap()).promo).toEqual({ manualSupported: true, ruleBehind: false, ruleVersions: [1, 2] })
  })
  it('ruleBehind when dayo lists a rule version above the tablet\'s', async () => {
    const d = dataOf('e1-catalog-changed-promo-rules')
    d.supported_fields = { ...d.supported_fields, promotion_rule_versions: [1, 2, 3] }
    const { ctx, t } = await linked(d)
    await pullCatalog(ctx)
    expect((await t.api.bootstrap()).promo).toEqual({ manualSupported: true, ruleBehind: true, ruleVersions: [1, 2, 3] })
  })
  it('nothing stored yet = nothing supported', async () => {
    const t = await openTestApi()
    expect((await t.api.bootstrap()).promo).toEqual({ manualSupported: false, ruleBehind: false, ruleVersions: [] })
  })
})

describe('readSupported reads what older builds stored', () => {
  it('old JSON {kinds, fields} with promotion_rule_versions and non-list values inside fields never throws', async () => {
    const t = await openTestApi()
    await writeKey(t.db, DAYO_KEYS.supportedJson, JSON.stringify({
      kinds: ['order', 'cash_count'],
      fields: { order: ['pos_order_id'], cash_count: { bad: 1 }, promotion_rule_versions: [2, 1, 1, 'x', 2.5] },
    }))
    const sup = (await readSupported(t.db))!
    expect(sup).toEqual({ kinds: ['order', 'cash_count'], fields: { order: ['pos_order_id'] }, promoRuleVersions: [1, 2] })
    // isRowSupported (through isHeld) sees no non-array: a cash_count row is simply held, not a TypeError
    expect(isHeld({ tableName: 'cash_count', rowJson: { count_id: 'x' }, lastError: null }, sup)).toBe(true)
    expect(isHeld({ tableName: 'order', rowJson: { pos_order_id: 'x' }, lastError: null }, sup)).toBe(false)
  })
  it('unreadable stored JSON = no list (never a throw)', async () => {
    const t = await openTestApi()
    for (const raw of ['{not json', 'null', '[1,2]', '"text"', JSON.stringify({ kinds: 'order', fields: [] })]) {
      await writeKey(t.db, DAYO_KEYS.supportedJson, raw)
      const sup = await readSupported(t.db)
      if (sup !== null) expect(sup).toEqual({ kinds: [], fields: {}, promoRuleVersions: [] })
    }
  })
  it('the new stored JSON reads back as written', async () => {
    const t = await openTestApi()
    const want = { kinds: ['order'], fields: { order: ['pos_order_id', 'manual_promotion_ids'] }, promoRuleVersions: [1, 2] }
    await writeKey(t.db, DAYO_KEYS.supportedJson, JSON.stringify(want))
    expect(await readSupported(t.db)).toEqual(want)
  })
})

describe('Q6: samePricing stays strict', () => {
  it('dayo f4cda56 lists 7 files while the pin has 8 → the pricing-mismatch banner shows', async () => {
    const d = dataOf('e1-catalog-changed-promo-rules')
    expect(Object.keys(d.pricing.files_sha256)).toHaveLength(7)
    expect(Object.keys(vendor.files)).toHaveLength(8)
    const { ctx, t } = await linked(d)
    await pullCatalog(ctx)
    expect(await readKey(t.db, DAYO_KEYS.pricingMismatch)).toBe('1')
    expect((await t.api.bootstrap()).sync.pricingMismatch).toBe(true)
  })
  it('the same 7 hashes as the pin (promoRule.ts missing) still mismatch; all 8 match', async () => {
    const files = { ...(vendor.files as Record<string, string>) }
    const d = dataOf('e1-catalog-changed-promo-rules')
    d.pricing = { commit: vendor.commit, files_sha256: Object.fromEntries(Object.entries(files).filter(([k]) => !k.endsWith('promoRule.ts'))) }
    const { ctx, t, dayo } = await linked(d)
    await pullCatalog(ctx)
    expect(await readKey(t.db, DAYO_KEYS.pricingMismatch)).toBe('1')
    dayo.answer({ ...d, catalog_version: 44, pricing: { commit: vendor.commit, files_sha256: files } })
    await pullCatalog(ctx)
    expect(await readKey(t.db, DAYO_KEYS.pricingMismatch)).toBe('0')
  })
})

describe('setup / key swap ask E1 the same way', () => {
  const target = { baseUrl: 'http://localhost:8787/api/v1', apiKey: MOCK_API_KEY }
  it('probeDayo + connectShop send promo_rule_version and record the rule version of the stored catalog', async () => {
    const dayo = e1Dayo(dataOf('e1-catalog-changed-promo-rules'))
    const t = await openTestApi({ fetch: dayo.fetch, now: '2026-09-30T03:00:00.000Z' })
    const probe = await t.api.probeDayo(target)
    expect(probe.pricingMatches).toBe(false) // Q6: 7 files vs 8 pinned
    await t.api.connectShop({ ...target, receiptPrefix: 'A', ownerStaffId: TUNGAO, ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null, confirmedLastZNo: probe.lastZNo ?? null })
    expect(dayo.urls.map(asked)).toEqual([{ known: '0', rule: '2' }, { known: '0', rule: '2' }])
    expect(await readKey(t.db, DAYO_KEYS.catalogRuleVersion)).toBe('2')
    expect((await readCatalog(t.db))?.catalogVersion).toBe(43)
    expect((await t.api.bootstrap()).promo).toEqual({ manualSupported: true, ruleBehind: false, ruleVersions: [1, 2] })
  })
  it('setup refuses a catalog whose rules the tablet cannot use (it has no old one to keep)', async () => {
    const bad = dataOf('e1-catalog-changed-promo-rules')
    bad.catalog!.promotions[2]!.groupCode = 'ghost'
    const t = await openTestApi({ fetch: e1Dayo(bad).fetch, now: '2026-09-30T03:00:00.000Z' })
    await expect(t.api.probeDayo(target)).rejects.toThrow(/DAYO_BAD_RESPONSE/)
  })
})
