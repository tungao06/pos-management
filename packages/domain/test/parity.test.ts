/**
 * Parity layer C (spec 04 §5.2 · plan 10 §0.2 parity (4)): dayo's own `pos:parity` export — its SQL pricing
 * (api_pos_catalog + quote_order) at the pinned commit — against the tablet's sale path, 0 satang on every money
 * field. Two parts of the one file: `cases` (dayo's sample catalog) and `rule_fixtures` (dayo's golden rules-* sets,
 * each on the catalog dayo's database serves for it at the highest rule version). The POS seed runs the same checks as
 * a wrapper test only — it is the vendored engine, NOT dayo's database.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { OrderDraft } from '@dayo/dayo-pricing'
import { ParityFile, PosOrderCatalog, type ParityCase, type ParityDraft, type ParityMoney } from '@dayo/contracts'
import { CartError, checkCatalogRules, TABLET_PROMO_RULE_VERSION, toPricingCatalog, type CartErrorCode, type PosOrderCatalog as Catalog } from '../src/index.js'
import { priceParityCase } from '../src/parity-support.js'
import { engineLayer, exportExpectedView, pricedView, withDefaultedGrades, type MoneyView } from './parity-view.js'
import { appliedRuleVersions } from './rule-versions.js'

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url))
/** dayo's own export (scripts/export-pos-parity.ts), copied verbatim — the block-2 gate. */
const REAL = at('../../dayo-pricing/fixtures/pos-parity.json')
/** POS seed (scripts/gen-parity-seed.ts) on the POS test catalog — a wrapper check only. */
const SEED = at('../../dayo-pricing/fixtures/pos-parity.seed.json')
const vendor = JSON.parse(readFileSync(at('../../dayo-pricing/VENDOR.json'), 'utf8')) as { commit: string; files: Record<string, string> }
const vendoredText = (dayoPath: string): string => readFileSync(at(`../../dayo-pricing/src/vendor/${dayoPath.split('/').pop()!}`), 'utf8').replace(/\r\n/g, '\n')
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const rawOf = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))

/**
 * Cases of dayo's export whose draft the tablet never builds: dayo prices them with a warning, the tablet refuses them
 * before charging (it never prices a different bill than it sends — spec §4.5, DY422). Each entry is the refusal the
 * tablet must give, with its reason, and needs the head's OK. Keys: `spec` of `cases[]`, `<fixture> › <name>` of
 * `rule_fixtures`. None of the export's manual-promotion reasons is one dayo rejects (no BAD_MANUAL_PROMOTION entry).
 */
const TABLET_REFUSES = new Map<string, { code: CartErrorCode; why: string; dayoWarns: RegExp }>([
  ['9a', { code: 'QTY_OUT_OF_RANGE', why: 'qty 150 > maxQtyPerLine 99: dayo clamps to 99 with a warning; the tablet refuses rather than charge 99 cups for 150', dayoWarns: /จำนวน 150 ปรับเป็น 99 แก้ว/ }],
  ['9b', { code: 'CART_TOO_LARGE', why: '51 lines: dayo prices with a DY422 warning and its API then refuses the bill; the tablet refuses first', dayoWarns: /\[DY422\] too_large/ }],
])

/**
 * Gap G1: rule_fixtures cases dayo prices with no sale time ON PURPOSE (rules-windows.json: a time window with the time
 * unknown). The sale path throws a plain Error('NO_SALE_TIME') — the tablet always sells at a known instant (R15) — so they
 * cannot be TABLET_REFUSES (a CartError on a bill); dayo's draft is compared at the engine layer only. `cases[]` has none.
 */
const ENGINE_ONLY_NO_TIME: ReadonlySet<string> = new Set([
  'rules-windows.json › อาทิตย์ ไม่รู้เวลา (ช่วงทั้งวัน)',
  'rules-windows.json › พฤหัส ไม่รู้เวลา',
  'rules-windows.json › โค้ดดึก ไม่รู้เวลา',
])
/** dayo counts uses and hands the engine `exhaustedPromotions` in this set only (R3): priced with `dayoOnlyExhausted`. */
const USAGE_FIXTURE = 'rules-usage.json'
/** rule_fixtures at the pin: dayo's eight golden rules-* files, 104 cases. */
const EXPECTED_RULE_CASES: Record<string, number> = {
  'rules-bill.json': 3, 'rules-breakdown.json': 2, 'rules-buy-get.json': 11, 'rules-cup.json': 13, 'rules-groups.json': 5,
  'rules-tiers.json': 44, 'rules-usage.json': 8, 'rules-windows.json': 18,
}

/** One case of either part, as the sale path meets it. */
type Case = { key: string; draft: ParityDraft; expected: ParityMoney; catalog: Catalog; dayoOnlyExhausted: boolean }
const title = (c: ParityCase): string => (c.note === undefined ? c.spec : `${c.spec} — ${c.note}`)
const sale = (c: Case): ReturnType<typeof priceParityCase> | CartError => {
  try { return priceParityCase(c.draft, c.catalog, { dayoOnlyExhausted: c.dayoOnlyExhausted }) } catch (e) {
    if (e instanceof CartError) return e
    throw e
  }
}
/** What the sale path must give for a case: dayo's expected result, with the counted grade exception only (review L1). */
const saleExpected = (c: Case): { view: MoneyView; defaulted: number } => withDefaultedGrades(exportExpectedView(c.expected), c.draft, c.catalog)
const salePasses = (c: Case): boolean => {
  const got = sale(c)
  return !(got instanceof CartError) && isDeepStrictEqual(pricedView(got, true, c.catalog), saleExpected(c).view)
}

/** The sale-path test of one case: 0 satang, or the listed refusal. `lenient` (seed only): a CartError is fine where the seed says not ok. */
function saleTest(c: Case, label: string, lenient: boolean): void {
  const refusal = TABLET_REFUSES.get(c.key)
  if (refusal !== undefined && !lenient) {
    it(`${label}: the tablet refuses (${refusal.code}) where dayo warns — ${refusal.why}`, () => {
      // the very warning dayo gives for this refusal (review L3) — not just any warning
      expect(c.expected['warnings'], `dayo must flag this bill with ${String(refusal.dayoWarns)}`).toEqual(expect.arrayContaining([expect.stringMatching(refusal.dayoWarns)]))
      const got = sale(c)
      expect(got).toBeInstanceOf(CartError)
      expect((got as CartError).code).toBe(refusal.code)
    })
    return
  }
  it(`${label}: 0 satang difference on every money field`, () => {
    const got = sale(c)
    if (got instanceof CartError) {
      expect(lenient && !c.expected.ok, `the tablet refuses ${c.key} (${got.code}) but dayo prices it — list it in TABLET_REFUSES only if intended`).toBe(true)
      return
    }
    expect(pricedView(got, true, c.catalog)).toEqual(saleExpected(c).view)
  })
}

it('the block-2 gate runs on dayo\'s own export, not only the seed', () => {
  expect(existsSync(REAL), 'packages/dayo-pricing/fixtures/pos-parity.json (dayo pos:parity output) is missing').toBe(true)
})

const real = ParityFile.parse(rawOf(REAL))
const seed = ParityFile.parse(rawOf(SEED))

describe('one pin (plan 10 T4): VENDOR.json, the seed and dayo\'s export are the same dayo commit', () => {
  it('VENDOR.json.commit = seed.dayo_commit = export.dayo_commit', () => {
    const why = `pin ${vendor.commit.slice(0, 7)} (VENDOR.json): ask dayo's owner to run pos:parity at ${vendor.commit} and copy it to `
      + 'packages/dayo-pricing/fixtures/pos-parity.json, then `pnpm --filter @dayo/domain parity:seed`'
    expect({ seed: seed.dayo_commit, export: real.dayo_commit }, why).toEqual({ seed: vendor.commit, export: vendor.commit })
  })
  it('the export hashes exactly the 8 vendored pricing files, LF-normalized like VENDOR.json (dayo item 7)', () => {
    expect(Object.keys(vendor.files)).toHaveLength(8)
    expect(real.pricing_files_sha256, `ตัวคิดราคาในเครื่องไม่ตรงรุ่นกับ dayo — ask dayo's owner for pos:parity at ${vendor.commit}`).toEqual(vendor.files)
    expect(seed.pricing_files_sha256).toEqual(vendor.files)
  })
  it('the vendored copies are what VENDOR.json pins (LF text)', () => {
    for (const [path, lfHash] of Object.entries(vendor.files)) expect(sha256(vendoredText(path)), path).toBe(lfHash)
  })
})

/**
 * Matcha lines whose draft names no grade, on the sale path (review L1 · withDefaultedGrades): dayo records no grade, the
 * tablet the catalog default. Counted per part so a new one shows; the seed is the tablet's own path, so it has none.
 */
const GRADE_DEFAULTED_LINES = { cases: 6, seed: 0, rule_fixtures: 35 } as const
const defaultedLines = (cases: Case[]): number => cases.filter((c) => !TABLET_REFUSES.has(c.key) && c.draft.saleTime !== undefined).reduce((n, c) => n + saleExpected(c).defaulted, 0)

function casesSuite(parity: ReturnType<typeof ParityFile.parse>, isReal: boolean, expectedCases: number): void {
  const catalog = toPricingCatalog(parity.catalog)
  const cases: Case[] = parity.cases.map((c) => ({ key: c.spec, draft: c.draft, expected: c.expected, catalog, dayoOnlyExhausted: false }))
  describe(isReal
    ? `parity layer C (spec 04 §5.2) — dayo export ${parity.dayo_commit.slice(0, 7)} cases[]: the sale path vs dayo's real SQL pricing on dayo's sample catalog`
    : 'parity layer C (spec 04 §5.2) — POS SEED: wrapper check only, NOT the block-2 gate', () => {
    it(`matcha lines without a grade in the draft: exactly ${GRADE_DEFAULTED_LINES[isReal ? 'cases' : 'seed']} (dayo: none · tablet: the default grade)`, () => {
      expect(defaultedLines(cases)).toBe(GRADE_DEFAULTED_LINES[isReal ? 'cases' : 'seed'])
    })
    it(`holds all ${expectedCases} cases, uniquely named — a thinner export fails loudly`, () => {
      expect(parity.cases.length).toBe(expectedCases)
      expect(new Set(parity.cases.map((c) => c.spec)).size).toBe(parity.cases.length)
    })
    it('every case has a saleTime — the tablet never prices a bill without its instant (gap G1)', () => {
      expect(parity.cases.filter((c) => c.draft.saleTime === undefined).map((c) => c.spec)).toEqual([])
    })
    it('every expected result carries dayo\'s reason flag (manualPromotionReasonRequired)', () => {
      expect(parity.cases.filter((c) => c.expected.manualPromotionReasonRequired === undefined).map((c) => c.spec)).toEqual([])
    })
    if (isReal) {
      it('every case the tablet refuses by design is still in the file', () => {
        const specs = new Set(parity.cases.map((c) => c.spec))
        expect([...TABLET_REFUSES.keys()].filter((k) => !k.includes(' › ') && !specs.has(k))).toEqual([])
      })
    }
    for (const [i, c] of cases.entries()) saleTest(c, title(parity.cases[i]!), !isReal)
  })
}

casesSuite(real, true, 38)
casesSuite(seed, false, 30)

const rawFixtures = (rawOf(REAL) as { rule_fixtures?: Array<{ fixture: string; catalog: unknown }> }).rule_fixtures ?? []
const fixtures = real.rule_fixtures ?? []
const ruleCases: Array<Case & { fixture: string; orderDraft: OrderDraft }> = fixtures.flatMap((f) => {
  const catalog = toPricingCatalog(f.catalog)
  return f.cases.map((c) => ({
    key: `${f.fixture} › ${c.name}`, fixture: f.fixture, draft: c.draft, expected: c.expected, catalog, dayoOnlyExhausted: f.fixture === USAGE_FIXTURE,
    // dayo's own OrderDraft JSON, verbatim — for the engine layer of a timeless case only
    orderDraft: c.draft as unknown as OrderDraft,
  }))
})

describe(`parity layer C — dayo export ${real.dayo_commit.slice(0, 7)} rule_fixtures: dayo's golden rules-* sets priced by dayo's database`, () => {
  it(`holds dayo's ${Object.keys(EXPECTED_RULE_CASES).length} rules-* sets with their case counts (${Object.values(EXPECTED_RULE_CASES).reduce((a, n) => a + n, 0)} cases)`, () => {
    expect(Object.fromEntries(fixtures.map((f) => [f.fixture, f.cases.length]))).toEqual(EXPECTED_RULE_CASES)
    expect(new Set(ruleCases.map((c) => c.key)).size).toBe(ruleCases.length)
  })
  for (const f of fixtures) {
    it(`${f.fixture}: the same cases, by name, as the vendored golden ${f.fixture} at the pin (review L2 — a count alone is not enough)`, () => {
      const golden = rawOf(at(`../../dayo-pricing/golden/test/fixtures/promo-rules/${f.fixture}`)) as { cases: Array<{ name: string }> }
      expect(f.cases.map((c) => c.name).sort()).toEqual(golden.cases.map((c) => c.name).sort())
    })
  }
  it(`matcha lines without a grade in the draft: exactly ${GRADE_DEFAULTED_LINES.rule_fixtures} (dayo: none · tablet: the default grade)`, () => {
    expect(defaultedLines(ruleCases)).toBe(GRADE_DEFAULTED_LINES.rule_fixtures)
  })
  it(`the cases without a saleTime are exactly ENGINE_ONLY_NO_TIME (${ENGINE_ONLY_NO_TIME.size}) — a new one fails here, not silently`, () => {
    expect(ruleCases.filter((c) => c.draft.saleTime === undefined).map((c) => c.key).sort()).toEqual([...ENGINE_ONLY_NO_TIME].sort())
  })
  it(`only ${USAGE_FIXTURE} hands the engine exhaustedPromotions`, () => {
    const withList = ruleCases.filter((c) => (c.draft.exhaustedPromotions ?? []).length > 0)
    expect(withList.length).toBeGreaterThan(0)
    expect([...new Set(withList.map((c) => c.fixture))]).toEqual([USAGE_FIXTURE])
  })
  it('every rule_fixtures case the tablet refuses by design is still in the file', () => {
    const keys = new Set(ruleCases.map((c) => c.key))
    expect([...TABLET_REFUSES.keys()].filter((k) => k.includes(' › ') && !keys.has(k))).toEqual([])
  })
  for (const f of fixtures) {
    it(`${f.fixture}: its catalog passes the E1 contract (PosOrderCatalog) and checkCatalogRules — the tablet would accept it`, () => {
      const raw = rawFixtures.find((r) => r.fixture === f.fixture)
      expect(PosOrderCatalog.safeParse(raw?.catalog).success).toBe(true)
      expect(checkCatalogRules(toPricingCatalog(f.catalog))).toEqual([])
    })
  }
  for (const c of ruleCases) {
    if (ENGINE_ONLY_NO_TIME.has(c.key)) {
      it(`${c.key}: no saleTime — the sale path refuses to invent one; dayo's draft through the engine layer matches dayo`, () => {
        expect(() => priceParityCase(c.draft, c.catalog)).toThrow(/^NO_SALE_TIME/)
        expect(pricedView(engineLayer(c.orderDraft, c.catalog), true, c.catalog)).toEqual(exportExpectedView(c.expected))
      })
      continue
    }
    saleTest(c, c.key, false)
  }
})

describe(`dayo's export proves every promo rule version the tablet asks for (1–${TABLET_PROMO_RULE_VERSION} · gap G2)`, () => {
  const mainCatalog = toPricingCatalog(real.catalog)
  const all: Case[] = [...real.cases.map((c) => ({ key: c.spec, draft: c.draft, expected: c.expected, catalog: mainCatalog, dayoOnlyExhausted: false })), ...ruleCases]
  const onSalePath = (c: Case): boolean => !ENGINE_ONLY_NO_TIME.has(c.key) && !TABLET_REFUSES.has(c.key)
  for (let v = 1; v <= TABLET_PROMO_RULE_VERSION; v++) {
    it(`rule version ${v}: at least one export case applies a v${v} promotion and passes the sale path`, () => {
      const covering = all.filter((c) => onSalePath(c) && appliedRuleVersions(c.catalog, c.expected.promotionsApplied.map((p) => p.promotionId)).has(v))
      expect(covering.filter(salePasses).length, `no passing export case exercises a v${v} rule`).toBeGreaterThan(0)
    })
  }
})
