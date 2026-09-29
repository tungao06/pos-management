/**
 * Parity layer (3) of plan 10 §0.2: dayo's golden promo-rule cases (legacy-* and rules-*, vendored with the engine — T1)
 * through the tablet's SALE PATH — cartFromOrderDraft → checkCart → toOrderDraft → vendored engine → satang — must give
 * dayo's recorded money to the satang: every money field, every line (unit price, discount per cup, line total, the
 * line's promotion, promoBreakdown on rules-* files), the applied promotions, `ok` and the reason flag (R4 — the Thai
 * warnings are compared at the engine layer, dayo-pricing/test/golden.test.ts).
 * - rules-usage.json: dayo counts uses and hands the engine `exhaustedPromotions`; the tablet never does (ADR-0072 rule 2),
 *   so these cases pass it through priceParityCase's parity-only `dayoOnlyExhausted` (R3).
 * - ENGINE_ONLY_NO_TIME: cases dayo prices without a sale time on purpose; the tablet always sells at a known instant.
 * - TABLET_REFUSES: cases the tablet refuses before charging, each with its reason (head's OK).
 */
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { CartError, checkCatalogRules, TABLET_PROMO_RULE_VERSION, type CartErrorCode } from '../src/index.js'
import { priceParityCase } from '../src/parity-support.js'
import { GOLDEN_FILES, goldenCases, type GoldenCase } from './golden-cases.js'
import { appliedRuleVersions } from './rule-versions.js'
import { engineLayer, goldenExpectedView, pricedView } from './parity-view.js'

/** Cases per golden file at the pin — the same table as dayo-pricing's golden.test.ts (a thinner re-vendor fails here too). */
const EXPECTED_CASES: Record<string, number> = {
  'legacy-bill.json': 18, 'legacy-bundle.json': 11, 'legacy-buy-get.json': 12, 'legacy-item.json': 23, 'legacy-mixed.json': 4, 'legacy-modes.json': 18,
  'rules-bill.json': 3, 'rules-breakdown.json': 2, 'rules-buy-get.json': 11, 'rules-cup.json': 13, 'rules-groups.json': 5, 'rules-tiers.json': 44,
  'rules-usage.json': 8, 'rules-windows.json': 18,
}

/**
 * Gap G1: cases dayo prices with no sale time ON PURPOSE (a promotion window with the time unknown). The tablet always
 * sells at a known instant (R15): the sale path throws a plain Error('NO_SALE_TIME') — not a CartError, so these are not
 * refusals of a bill but drafts the tablet never builds. Compared at the engine layer only. The three rules-windows
 * cases are the ones dayo's export carries too (parity.test.ts); legacy-item's is golden-only (the export has no legacy files).
 */
const ENGINE_ONLY_NO_TIME: ReadonlySet<string> = new Set([
  'legacy-item.json › ไม่รู้เวลาขาย → ไม่ให้โปรจำกัดเวลา',
  'rules-windows.json › อาทิตย์ ไม่รู้เวลา (ช่วงทั้งวัน)',
  'rules-windows.json › พฤหัส ไม่รู้เวลา',
  'rules-windows.json › โค้ดดึก ไม่รู้เวลา',
])

/**
 * Golden cases the tablet refuses before charging (a CartError where dayo prices, e.g. a manual-promotion reason dayo's
 * database rejects → BAD_MANUAL_PROMOTION). None at the pin: every golden reason is one dayo takes. An entry needs the head's OK.
 */
const TABLET_REFUSES = new Map<string, { code: CartErrorCode; why: string }>()

const USAGE_FILE = 'rules-usage.json'
const CASES = goldenCases()

/** The sale path of one case, or the CartError the tablet refuses it with. Anything else thrown is a bug and propagates. */
function sale(c: GoldenCase): ReturnType<typeof priceParityCase> | CartError {
  try {
    return priceParityCase(c.draft, c.catalog, { dayoOnlyExhausted: c.file === USAGE_FILE })
  } catch (e) {
    if (e instanceof CartError) return e
    throw e
  }
}
const salePasses = (c: GoldenCase): boolean => {
  const got = sale(c)
  return !(got instanceof CartError) && isDeepStrictEqual(pricedView(got, c.form === 'rule'), goldenExpectedView(c.expected, c.form === 'rule'))
}
const onSalePath = (c: GoldenCase): boolean => !ENGINE_ONLY_NO_TIME.has(c.key) && !TABLET_REFUSES.has(c.key)

describe('golden sale path — inventory (plan 10 T4)', () => {
  it('the golden files are exactly the counted set, each with its case count', () => {
    const got: Record<string, number> = {}
    for (const f of GOLDEN_FILES) got[f] = CASES.filter((c) => c.file === f).length
    expect(got).toEqual(EXPECTED_CASES)
  })
  it('every case is uniquely named within its file', () => {
    expect(new Set(CASES.map((c) => c.key)).size).toBe(CASES.length)
  })
  it(`the cases without a sale time are exactly ENGINE_ONLY_NO_TIME (${ENGINE_ONLY_NO_TIME.size}) — a new one fails here, not silently`, () => {
    expect(CASES.filter((c) => c.draft.saleTime === undefined).map((c) => c.key).sort()).toEqual([...ENGINE_ONLY_NO_TIME].sort())
  })
  it('every case the tablet refuses by design is still in the set', () => {
    const keys = new Set(CASES.map((c) => c.key))
    expect([...TABLET_REFUSES.keys()].filter((k) => !keys.has(k))).toEqual([])
  })
  it(`only ${USAGE_FILE} hands the engine exhaustedPromotions (the only file priced with dayoOnlyExhausted)`, () => {
    const withList = CASES.filter((c) => (c.draft.exhaustedPromotions ?? []).length > 0)
    expect(withList.length).toBeGreaterThan(0)
    expect([...new Set(withList.map((c) => c.file))]).toEqual([USAGE_FILE])
  })
  for (const f of GOLDEN_FILES) {
    it(`${f}: the catalog passes checkCatalogRules — the tablet would accept it`, () => {
      expect(checkCatalogRules(CASES.find((c) => c.file === f)!.catalog)).toEqual([])
    })
  }
})

describe('golden sale path — 0 satang difference (plan 10 §0.2 parity (3))', () => {
  for (const c of CASES) {
    const breakdown = c.form === 'rule'
    if (ENGINE_ONLY_NO_TIME.has(c.key)) {
      it(`${c.key}: no sale time — the sale path refuses to invent one; the engine layer matches dayo`, () => {
        expect(() => priceParityCase(c.draft, c.catalog)).toThrow(/^NO_SALE_TIME/)
        expect(pricedView(engineLayer(c.orderDraft, c.catalog), breakdown)).toEqual(goldenExpectedView(c.expected, breakdown))
      })
      continue
    }
    const refusal = TABLET_REFUSES.get(c.key)
    if (refusal !== undefined) {
      it(`${c.key}: the tablet refuses (${refusal.code}) — ${refusal.why}`, () => {
        const got = sale(c)
        expect(got).toBeInstanceOf(CartError)
        expect((got as CartError).code).toBe(refusal.code)
      })
      continue
    }
    it(`${c.key}: 0 satang difference`, () => {
      const got = sale(c)
      if (got instanceof CartError) expect.unreachable(`the tablet refuses ${c.key} (${got.code}) but dayo prices it — add it to TABLET_REFUSES with a reason only if that is intended`)
      else expect(pricedView(got, breakdown)).toEqual(goldenExpectedView(c.expected, breakdown))
    })
  }
})

describe(`golden sale path — every promo rule version the tablet asks for (1–${TABLET_PROMO_RULE_VERSION}) is proven (gap G2)`, () => {
  for (let v = 1; v <= TABLET_PROMO_RULE_VERSION; v++) {
    it(`rule version ${v}: at least one golden case applies a v${v} promotion and passes the sale path`, () => {
      const covering = CASES.filter((c) => onSalePath(c) && appliedRuleVersions(c.catalog, c.expected.promotionsApplied.map((p) => p.name)).has(v))
      expect(covering.filter(salePasses).length, `no passing golden case exercises a v${v} rule`).toBeGreaterThan(0)
    })
  }
})
