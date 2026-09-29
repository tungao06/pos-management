// packages/dayo-mock/src/promo-rules.ts — how a dayo of a given promotion-rule release stores and serves promotions
// (plan 10 Task 5 · spec 04 §4.4 · dayo f4cda56 docs/pos-handoff-promo-rules.md §1). No node:* imports.
import { promoToLegacy } from '@dayo/dayo-pricing'
import type { CatalogPromotion, PromotionGroup } from './state.js'

/** The derived old-shape columns (ADR-0071 R4: read-only, dayo fills them from the rule on every save). */
const LEGACY_KEYS: readonly string[] = ['kind', 'params', 'daysOfWeek', 'timeFrom', 'timeTo', 'stackable']
/** What a tablet asking a lower promo_rule_version never sees (0074:197). */
const RULE_KEYS: readonly string[] = ['template', 'rule', 'timeWindows', 'groupCode', 'summaryTh']
/** ADR-0072 rule 2/7: display-only limits, sent when promo_rule_version ≥ 2 (0074:198). */
const USAGE_KEYS: readonly string[] = ['usageLimitTotal', 'usageLimitPerDay']

/**
 * The release of dayo the mock plays for promotions:
 * - `versions` = supported_fields.promotion_rule_versions — null = dayo before 0071 (no rule engine: the key is absent, the
 *   E1 parameter is not read, no promotionGroups) · [1] = 0071 · [1, 2] = 0073 onward (f4cda56).
 * - `manualFields` = supported_fields.order carries manual_promotion_ids / manual_promotion_reason (0069 onward).
 * Off by default (versions null, manualFields false) = dayo main 12885fe, what the block 2/3 tests were written against.
 */
export type PromoRulesOption = { versions: number[] | null; manualFields: boolean }
export const PROMO_RULES_OFF: PromoRulesOption = { versions: null, manualFields: false }
export const MANUAL_PROMOTION_FIELDS = ['manual_promotion_ids', 'manual_promotion_reason'] as const

/** Every shop has the `main` group (0071:1163-1165, 1186-1188) in dayo_promo_groups_json's shape (0071:1532-1542). */
export const MAIN_GROUP: PromotionGroup = { code: 'main', name: 'ทั่วไป', sortOrder: 0, stackMode: 'separate', isActive: true }

const without = (o: object, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))

/**
 * A promotion as dayo's table holds it after a save: with a rule, the old-shape columns are dayo's own promoToLegacy of
 * that rule (whatever the caller passed for them) — kind absent when the rule cannot go back to the old shape (dayo keeps
 * kind NULL; dayo_pos_promotions_for treats both alike). Without a rule (a catalog of dayo before 0071) it is kept as it is.
 */
export function promotionRow(p: CatalogPromotion): CatalogPromotion {
  if (p.rule === undefined || p.rule === null) return structuredClone(p)
  const legacy = promoToLegacy(p.template ?? null, p.rule, p.timeWindows ?? null, p.groupCode ?? null)
  const base = without(structuredClone(p), LEGACY_KEYS)
  return (legacy === null ? base : { ...base, ...legacy }) as CatalogPromotion
}

/** coalesce((rule ->> 'v')::integer, 1) */
const ruleVersionOf = (p: CatalogPromotion): number => (p.rule !== undefined && p.rule !== null && typeof p.rule.v === 'number' ? p.rule.v : 1)

/**
 * dayo_pos_promotions_for (0074:188-202), a line-for-line port: rule.v ≤ version → the whole row (without the old-shape
 * keys when kind is null) · else the old shape only, and a row without kind is left out · usage limits dropped below 2 ·
 * dayo's order kept. Never changes its input.
 */
export function promotionsFor(promos: readonly CatalogPromotion[], version: number): CatalogPromotion[] {
  const out: CatalogPromotion[] = []
  for (const p of promos) {
    const fits = ruleVersionOf(p) <= version
    const hasKind = typeof p.kind === 'string'
    if (!fits && !hasKind) continue
    let row = fits ? (hasKind ? structuredClone(p) as Record<string, unknown> : without(structuredClone(p), LEGACY_KEYS)) : without(structuredClone(p), RULE_KEYS)
    if (version < 2) row = without(row, USAGE_KEYS)
    out.push(row as CatalogPromotion)
  }
  return out
}

const PROMO_RULE_VERSION_RE = /^\d{1,4}$/
/**
 * The E1 parameter as dayo's route reads it (apps/web/src/lib/api/pos.ts:28-33 at f4cda56): absent or '' = 0 · 0–9999
 * written with 1–4 digits · anything else = a DY422 of the request (null here).
 */
export function readPromoRuleVersion(raw: string | null): number | null {
  if (raw === null || raw === '') return 0
  return PROMO_RULE_VERSION_RE.test(raw) ? Number(raw) : null
}
export const PROMO_RULE_VERSION_INVALID = 'invalid: promo_rule_version ต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง 9999'

/** dayo_pos_supported of the release: the manual fields last in the order list, as 0069:1500-1504 lists them. */
export function applyManualFields(fields: Record<string, string[]>, on: boolean): void {
  if (fields['order'] === undefined) return // a hand-made catalog without the order list: nothing to add to
  const order = fields['order'].filter((f) => !(MANUAL_PROMOTION_FIELDS as readonly string[]).includes(f))
  fields['order'] = on ? [...order, ...MANUAL_PROMOTION_FIELDS] : order
}
