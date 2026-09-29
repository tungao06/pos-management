/**
 * Gap G2 (plan 10 · handoff §9): which promo rule versions a parity case exercises — the declared `rule.v` of every
 * promotion the case's expected result applied (the version E1 filters on: dayo sends a promotion only when rule.v ≤ the
 * tablet's promo_rule_version). A legacy promotion without a rule counts as 1: the engine decodes kind + params with
 * promoFromLegacy, which only ever produces version-1 rules (ADR-0071 · rule versions 2+ are new rewards).
 */
import type { PosOrderCatalog } from '../src/index.js'

export function appliedRuleVersions(catalog: PosOrderCatalog, appliedIds: readonly string[]): Set<number> {
  const out = new Set<number>()
  for (const id of appliedIds) {
    const p = catalog.promotions.find((x) => x.id === id)
    if (p === undefined) throw new Error(`${id} is applied but not a promotion of the case's catalog`)
    const v: unknown = p.rule == null ? 1 : (p.rule as { v?: unknown }).v
    if (typeof v !== 'number') throw new Error(`${id}: rule.v ${String(v)} is not a number`)
    out.add(v)
  }
  return out
}
