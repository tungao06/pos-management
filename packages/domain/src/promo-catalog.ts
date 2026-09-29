import { bkkDay, bkkTime, PROMO_RULE_VERSIONS, saleSettingsOf, selectablePromotions, validatePromoRule, validateTimeWindows } from '@dayo/dayo-pricing'
import { skippedPromotionIds, type CartDraft, type PosOrderCatalog } from './price-cart.js'

/**
 * The rule version this app asks E1 for (`promo_rule_version`, plan 10 §0.2 · owner Q5 = 2): the highest the vendored
 * engine reads. dayo then sends every promotion whose rule.v ≤ it; a newer one it cannot price stays on dayo's side.
 */
export const TABLET_PROMO_RULE_VERSION: number = Math.max(...PROMO_RULE_VERSIONS)

/** dayo's own group every promotion without one belongs to (promoRule.ts PROMO_MAIN_GROUP) — needs no promotionGroups row. */
const MAIN_GROUP = 'main'

/**
 * What the vendored engine cannot read in an E1 catalog the contract already accepted (plan 10 §0.2 E1 · ruling R12):
 * each promotion's rule by vendor validatePromoRule, its time windows by validateTimeWindows, rule.v not above
 * TABLET_PROMO_RULE_VERSION, and its group a group of the catalog. Empty = usable. Any entry = refuse the catalog WHOLE
 * and keep the one before — never drop a promotion on its own (the tablet would price bills dayo prices otherwise).
 * A legacy promotion with no rule is read by the engine from kind/params (promoFromLegacy) and needs no check here.
 */
export function checkCatalogRules(c: PosOrderCatalog): string[] {
  const groups = new Set([MAIN_GROUP, ...(c.promotionGroups ?? []).map((g) => g.code)])
  const out: string[] = []
  for (const p of c.promotions) {
    const at = `promotion ${p.id} "${p.name}"`
    if (p.rule != null) {
      const v: unknown = (p.rule as { v?: unknown }).v
      if (typeof v !== 'number' || v > TABLET_PROMO_RULE_VERSION) out.push(`${at}: rule.v ${String(v)} is above ${TABLET_PROMO_RULE_VERSION}, the newest rule this app reads`)
      for (const problem of validatePromoRule(p.rule)) out.push(`${at}: ${problem}`)
    }
    if (p.timeWindows != null) for (const problem of validateTimeWindows(p.timeWindows)) out.push(`${at}: ${problem}`)
    // the engine reads `groupCode || main` (promotions.ts preparePromo)
    const group = p.groupCode || MAIN_GROUP
    if (!groups.has(group)) out.push(`${at}: groupCode "${group}" is not a group of the catalog`)
  }
  return out
}

/**
 * The manual promotions staff may pick for this bill at `soldAtIso` (ADR-0070 rule 3): dayo's selectablePromotions on
 * the cart's channel, sale instant and skips — manual mode only, conditions met, never one skipped (none at all when
 * noPromotions). No exhausted list: the tablet does not count uses, so the limits are passed through for display only.
 * Whether dayo takes manual promotions at all (supported_fields) is the caller's to check.
 */
export function selectableManualPromotions(cart: CartDraft, c: PosOrderCatalog, soldAtIso: string): {
  promotionId: string; code: string | null; name: string; usageLimitTotal: number | null; usageLimitPerDay: number | null
}[] {
  const channelCode = c.channels.find((x) => x.code === (cart.channelCode || saleSettingsOf(c).defaultChannelCode))?.code
  if (channelCode === undefined) return [] // the engine prices nothing on an unknown channel
  const picked = selectablePromotions(c.promotions, {
    saleDate: bkkDay(0, Date.parse(soldAtIso)), saleTime: bkkTime(soldAtIso), channelCode, skipPromotionIds: skippedPromotionIds(cart, c),
  })
  return picked.map((s) => {
    const p = c.promotions.find((x) => x.id === s.promotionId)
    return { promotionId: s.promotionId, code: s.code, name: s.name, usageLimitTotal: p?.usageLimitTotal ?? null, usageLimitPerDay: p?.usageLimitPerDay ?? null }
  })
}
