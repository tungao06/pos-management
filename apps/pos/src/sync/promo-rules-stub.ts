/**
 * TEMPORARY (plan 10 T7) — stands in for plan 10 T3's `TABLET_PROMO_RULE_VERSION` and `checkCatalogRules` from
 * @dayo/domain until T3 merges. After T3: delete this file and import both names from '@dayo/domain' in
 * sync/catalog.ts, api/connect.ts, api/bootstrap.ts and test/catalog-promo-rules.test.ts. Nothing else may import it.
 */
import { PROMO_RULE_VERSIONS, validatePromoRule, validateTimeWindows } from '@dayo/dayo-pricing'
import type { PosOrderCatalog } from '@dayo/domain'

/** plan 10 §0.2 · Q5: the rule version the tablet asks E1 for = the highest one the vendored engine knows. */
export const TABLET_PROMO_RULE_VERSION: number = Math.max(...PROMO_RULE_VERSIONS)

/** The group every promotion is in on a dayo before 0071, which sends no promotionGroups (vendor PROMO_MAIN_GROUP). */
const MAIN_GROUP = 'main'

/**
 * What makes a catalog unusable for the tablet's pricing engine (ruling R12 of block 2 · plan 10 §0.2): every problem
 * of every promotion — dayo's own rule / time-window checks, a rule version above the tablet's, a group the catalog
 * does not list (except `main`). Empty = usable. Never drops a promotion on its own: the caller refuses the whole catalog.
 */
export function checkCatalogRules(c: PosOrderCatalog): string[] {
  const groups = new Set((c.promotionGroups ?? []).map((g) => g.code))
  const out: string[] = []
  c.promotions.forEach((p, i) => {
    const at = `promotions[${i}] ${p.id}`
    if (p.rule !== undefined && p.rule !== null) {
      for (const e of validatePromoRule(p.rule)) out.push(`${at}: ${e}`)
      const v = (p.rule as { v?: unknown }).v
      if (typeof v !== 'number' || v > TABLET_PROMO_RULE_VERSION) out.push(`${at}: rule.v ${String(v)} > ${TABLET_PROMO_RULE_VERSION}`)
    }
    if (p.timeWindows !== undefined && p.timeWindows !== null) for (const e of validateTimeWindows(p.timeWindows)) out.push(`${at}: ${e}`)
    const g = p.groupCode
    if (typeof g === 'string' && g !== MAIN_GROUP && !groups.has(g)) out.push(`${at}: groupCode ${g} is not in promotionGroups`)
  })
  return out
}
