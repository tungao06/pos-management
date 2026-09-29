/**
 * Parity layer (2) of plan 10: dayo's golden promo-rule cases (packages/shared/test/fixtures/promo-rules, vendored
 * byte for byte with its own load.ts — R1) must come out of the VENDORED engine exactly as dayo recorded them: money,
 * lines, optionAdds, promoBreakdown, tiers, Thai warnings and flags (R4). Mirrors dayo's promoRulesGolden.test.ts.
 * rules-usage.json feeds exhaustedPromotions straight into the engine (R3) — the tablet never counts uses; this only
 * proves the engine is the same.
 */
import { describe, expect, it } from 'vitest'
import {
  assertNoIdTies, catalogFromPayload, fixtureFileNames, legacyPromotion, readJson, rulePromotion, sqlPromoOrder, toExpected,
  toOrderDraft, toPromotionContext, type FixtureCase, type FixtureFile, type LegacyFixturePromo, type RuleFixtureFile,
} from '../golden/test/fixtures/promo-rules/load.js'
import { computeOrder } from '../src/vendor/money.js'
import { selectablePromotions } from '../src/vendor/promotions.js'
import {
  promoFromLegacy, promoNeedsOwner, promoRuleMinVersion, promoTemplateFits, promoToLegacy, promoWindowMatch, validatePromoRule,
  validateTimeWindows, windowsFromLegacy,
} from '../src/vendor/promoRule.js'
import type { ImportPayload, PromoRule, PromoTemplate, Promotion, PromotionKind, PromotionParams, TimeWindow } from '../src/vendor/types.js'

/**
 * Cases per file at the pinned commit. A re-vendor that drops cases fails here loudly; one that adds cases updates
 * this table on purpose. `skipped` = cases without `expected` (none at the pin) — counted, never skipped silently.
 */
const EXPECTED_CASES: Record<string, { cases: number; skipped: number }> = {
  'legacy-bill.json': { cases: 18, skipped: 0 },
  'legacy-bundle.json': { cases: 11, skipped: 0 },
  'legacy-buy-get.json': { cases: 12, skipped: 0 },
  'legacy-item.json': { cases: 23, skipped: 0 },
  'legacy-mixed.json': { cases: 4, skipped: 0 },
  'legacy-modes.json': { cases: 18, skipped: 0 },
  'rules-bill.json': { cases: 3, skipped: 0 },
  'rules-breakdown.json': { cases: 2, skipped: 0 },
  'rules-buy-get.json': { cases: 11, skipped: 0 },
  'rules-cup.json': { cases: 13, skipped: 0 },
  'rules-groups.json': { cases: 5, skipped: 0 },
  'rules-tiers.json': { cases: 44, skipped: 0 },
  'rules-usage.json': { cases: 8, skipped: 0 },
  'rules-windows.json': { cases: 18, skipped: 0 },
}

const base = catalogFromPayload(readJson<ImportPayload>('catalog.json'))
const legacyFiles = fixtureFileNames('legacy-')
const ruleFiles = fixtureFileNames('rules-')
const withExpected = (cases: FixtureCase[]): Array<FixtureCase & { expected: NonNullable<FixtureCase['expected']> }> =>
  cases.filter((c): c is FixtureCase & { expected: NonNullable<FixtureCase['expected']> } => c.expected !== undefined)

/** Legacy row → rule-only promotion (no kind/params/stackable/days/time), so the engine must read `rule` — as dayo's test does. */
function ruleOnly(row: LegacyFixturePromo): Promotion {
  const { kind: _k, params: _p, stackable: _s, daysOfWeek: _d, timeFrom: _f, timeTo: _t, ...rest } = legacyPromotion(row)
  const { template, rule } = promoFromLegacy(row.kind, row.params, row.stackable)
  return { ...rest, template, rule, timeWindows: windowsFromLegacy(row.daysOfWeek, row.timeFrom, row.timeTo), groupCode: 'main' }
}

describe('golden case inventory (plan 10 T1)', () => {
  it('the vendored files are exactly the counted set', () => {
    expect([...legacyFiles, ...ruleFiles].sort()).toEqual(Object.keys(EXPECTED_CASES).sort())
  })
  for (const f of [...legacyFiles, ...ruleFiles]) {
    it(`${f}: case count and skipped count`, () => {
      const cases = readJson<{ cases: FixtureCase[] }>(f).cases
      const skipped = cases.length - withExpected(cases).length
      expect({ cases: cases.length, skipped }).toEqual(EXPECTED_CASES[f])
    })
  }
})

describe('golden: legacy promotions (legacy-*.json) = dayo\'s engine after 0070', () => {
  for (const fileName of legacyFiles) {
    const file = readJson<FixtureFile>(fileName)
    describe(fileName, () => {
      it('promotion order does not depend on ids', () => assertNoIdTies(file.promotions))
      const ordered = sqlPromoOrder(file.promotions)
      const viaLegacy = { ...base, promotions: ordered.map(legacyPromotion) }
      const viaRule = { ...base, promotions: ordered.map(ruleOnly) }
      for (const cs of withExpected(file.cases)) {
        it(`${cs.name} (old catalog: kind+params)`, () => {
          expect(toExpected(computeOrder(toOrderDraft(cs.draft), viaLegacy))).toEqual(cs.expected)
        })
        it(`${cs.name} (rule decoded with promoFromLegacy)`, () => {
          expect(toExpected(computeOrder(toOrderDraft(cs.draft), viaRule))).toEqual(cs.expected)
        })
      }
      // copied from dayo's promoRulesGolden.test.ts at f4cda56 (T1 review · carried item 3)
      it('promoToLegacy(promoFromLegacy(x)) = x · the rule passes validatePromoRule', () => {
        for (const row of file.promotions) {
          const { template, rule } = promoFromLegacy(row.kind, row.params, row.stackable)
          const windows = windowsFromLegacy(row.daysOfWeek, row.timeFrom, row.timeTo)
          expect(validatePromoRule(rule)).toEqual([])
          expect(validateTimeWindows(windows)).toEqual([])
          const back = promoToLegacy(template, rule, windows, 'main')
          // item_discount with both percent and amount_baht: the old engine used baht (percent had no effect) → the normal form drops percent
          const params =
            row.kind === 'item_discount' && 'amount_baht' in row.params && row.params.amount_baht != null && 'percent' in row.params
              ? (({ percent: _x, ...p }) => p)(row.params as { percent?: number })
              : row.params
          expect(back).toEqual({
            kind: row.kind,
            params,
            stackable: row.stackable,
            daysOfWeek: row.daysOfWeek && row.daysOfWeek.length > 0 ? row.daysOfWeek : null,
            timeFrom: row.timeFrom,
            timeTo: row.timeTo,
          })
        }
      })
    })
  }
})

describe('golden: rule promotions (rules-*.json)', () => {
  for (const fileName of ruleFiles) {
    const file = readJson<RuleFixtureFile>(fileName)
    describe(fileName, () => {
      it('every rule passes validatePromoRule / validateTimeWindows; order does not depend on ids', () => {
        assertNoIdTies(file.promotions)
        for (const p of file.promotions) {
          expect([p.name, validatePromoRule(p.rule)]).toEqual([p.name, []])
          expect([p.name, validateTimeWindows(p.timeWindows)]).toEqual([p.name, []])
        }
      })
      const catalog = { ...base, promotions: sqlPromoOrder(file.promotions).map(rulePromotion), promotionGroups: file.groups }
      for (const cs of withExpected(file.cases)) {
        it(cs.name, () => {
          const got = toExpected(computeOrder(toOrderDraft(cs.draft), catalog), true)
          if (cs.expected.selectable) got.selectable = selectablePromotions(catalog.promotions, toPromotionContext(cs.draft)).map((p) => p.name)
          expect(got).toEqual(cs.expected)
        })
      }
    })
  }
})

interface Fns {
  validatePromoRule: Array<{ name: string; rule: unknown; problems: string[] }>
  validateTimeWindows: Array<{ name: string; windows: unknown; problems: string[] }>
  promoWindowMatch: Array<{ name: string; windows: TimeWindow[]; saleDate: string; saleTime: string | null; startsOn: string | null; endsOn: string | null; match: boolean }>
  promoFromLegacy: Array<{ name: string; kind: PromotionKind; params: PromotionParams; stackable: boolean; template: PromoTemplate; rule: PromoRule }>
  promoToLegacy: Array<{ name: string; template: PromoTemplate; rule: PromoRule; timeWindows: TimeWindow[]; groupCode: string | null; legacy: unknown }>
  promoNeedsOwner: Array<{ name: string; rule: PromoRule; channelCodes: string[] | null; needsOwner: boolean }>
  promoTemplateFits: Array<{ name: string; template: string; rule: unknown; fits: boolean }>
  promoRuleMinVersion: Array<{ name: string; rule: unknown; version: number }>
}

describe('golden: pure rule functions (functions.json) — the validators the tablet uses on E1 (T2)', () => {
  const fns = readJson<Fns>('functions.json')
  it('every section has cases', () => {
    for (const k of ['validatePromoRule', 'validateTimeWindows', 'promoWindowMatch', 'promoFromLegacy', 'promoToLegacy', 'promoNeedsOwner', 'promoTemplateFits', 'promoRuleMinVersion'] as const) {
      expect(fns[k].length, k).toBeGreaterThan(0)
    }
  })
  for (const c of fns.validatePromoRule) it(`validatePromoRule: ${c.name}`, () => expect(validatePromoRule(c.rule)).toEqual(c.problems))
  for (const c of fns.validateTimeWindows) it(`validateTimeWindows: ${c.name}`, () => expect(validateTimeWindows(c.windows)).toEqual(c.problems))
  for (const c of fns.promoWindowMatch) {
    it(`promoWindowMatch: ${c.name}`, () => expect(promoWindowMatch(c.windows, c.saleDate, c.saleTime, { startsOn: c.startsOn, endsOn: c.endsOn })).toBe(c.match))
  }
  for (const c of fns.promoFromLegacy) {
    it(`promoFromLegacy: ${c.name}`, () => expect(promoFromLegacy(c.kind, c.params, c.stackable)).toEqual({ template: c.template, rule: c.rule }))
  }
  for (const c of fns.promoToLegacy) it(`promoToLegacy: ${c.name}`, () => expect(promoToLegacy(c.template, c.rule, c.timeWindows, c.groupCode)).toEqual(c.legacy))
  for (const c of fns.promoNeedsOwner) {
    it(`promoNeedsOwner: ${c.name}`, () => expect(promoNeedsOwner(c.rule, { variants: base.variants, channels: base.channels, channelCodes: c.channelCodes })).toBe(c.needsOwner))
  }
  for (const c of fns.promoTemplateFits) it(`promoTemplateFits: ${c.name}`, () => expect(promoTemplateFits(c.template, c.rule)).toBe(c.fits))
  for (const c of fns.promoRuleMinVersion) it(`promoRuleMinVersion: ${c.name}`, () => expect(promoRuleMinVersion(c.rule)).toBe(c.version))
})
