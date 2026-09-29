// packages/dayo-mock/src/reprice.ts — dayo's own quote of a POS bill at sold_at, with the vendored pricing code. No node:* imports.
// dayo re-quotes EVERY POS bill (dayo_impl_create_order 0074:1534-1561): the promotions active AT sold_at (ADR-0049 rule 5 ·
// ADR-0053 · dayo_promo_active_at 0050:189-203), the bill's manual promotions and reason (0069 → manual_promotions), and the
// promotions its count says are used up (0074 p_ctx.exhausted_promotions — mock.exhaust; the tablet never counts, ADR-0072
// rule 2). That quote decides the reason guard (0069:1096-1098), invalid_order: (0074:1544-1547), pos_computed_total and
// amount_mismatch = |reported total − quote total| > ฿1 (dayo_order_amounts 0008:970-1000), and its warnings are the row's.
// A test's `expected` must come from a fixture or hand calculation, never from this mock's own output.
import { bkkTime, computeOrder, type MenuOptionGradeEntry, type MenuOptionMilkEntry, type OrderCatalog, type OrderDraft, type QuoteResult, type Sweetness } from '@dayo/dayo-pricing'
import type { CatalogPromotion, MockOrderData, MockState } from './state.js'

/**
 * dayo's quote of the bill at sold_at, or null where the mock's catalog cannot reproduce dayo's price: a line, channel,
 * payment method or option the shop still has in dayo's tables (a code once served — `s.known`, never deleted, ADR-0054
 * rule 1) but that the mock's CURRENT catalog no longer lists (a variant a bumpCatalog/test dropped). The mock keeps no
 * price history of such rows, so the caller trusts the tablet there (computed = reported total, no warnings).
 */
export function dayoQuoteAt(s: MockState, o: MockOrderData, soldAt: number): QuoteResult | null {
  if (!reproducible(s, o)) return null
  const closed = [...s.closedPromotions.values()]
  const closedBefore = closed.filter((c) => c.closedAt <= soldAt).map((c) => c.promotion) // changed_at ≤ ts = the closed state counts
  const activeAt = [...s.catalog.catalog.promotions, ...closed.filter((c) => c.closedAt > soldAt).map((c) => c.promotion)]
  // dayo still loads a closed promotion the staff picked, off, so its warning can name it ("ไม่ใช้โปร <name>: ปิดอยู่" —
  // 0074:1114-1128); a closed one nobody picked is not loaded
  const off = closedBefore.filter((p) => o.manual_promotion_ids.includes(p.id))
  // 0074:87-146: 'total' counts every day · 'day' counts the bill's sale_date only
  const exhausted = s.exhausted.filter((e) => e.scope === 'total' || e.saleDate === o.sale_date).map((e) => ({ id: e.id, scope: e.scope }))
  return quote(s, o, activeAt, off, exhausted)
}

function reproducible(s: MockState, o: MockOrderData): boolean {
  const c = s.catalog.catalog
  if (!c.channels.some((x) => x.code === o.channel) || !c.paymentMethods.some((x) => x.code === o.payment)) return false
  return o.lines.every((l) => c.variants.some((v) => v.menuCode === l.code && v.size === l.size && v.sweetness === l.sweetness)
    && (l.milk === 'fresh' || c.milkOptions.some((m) => m.code === l.milk)) && (l.grade === null || c.gradeOptions.some((g) => g.code === l.grade)))
}

/** `on` = active at sold_at · `off` = loaded but closed (isActive false, as dayo_promo_active_at says) · dayo's priority order is the engine's. */
function quote(s: MockState, o: MockOrderData, on: CatalogPromotion[], off: CatalogPromotion[], exhausted: { id: string; scope: 'total' | 'day' }[]): QuoteResult {
  const active = [...on.map((p) => ({ ...p, isActive: true })), ...off.map((p) => ({ ...p, isActive: false }))]
  const c = s.catalog.catalog
  const ingredients = Object.fromEntries(Object.entries(c.ingredients).map(([id, ing]) => [id, { ...ing, costPerUseUnit: 0 }])) // cost never reaches the mock
  // E1 = OrderCatalog without cost; milk/grade ingredientId and multiplier may be null like dayo's menu_options rows — passed
  // through unchanged, dayo's pricing code runs on the same nulls
  const options = { milkOptions: c.milkOptions as MenuOptionMilkEntry[], gradeOptions: c.gradeOptions as MenuOptionGradeEntry[] }
  const catalog: OrderCatalog = { ...c, ...options, ingredients, promotions: active }
  const draft: OrderDraft = {
    saleDate: o.sale_date, saleTime: bkkTime(o.sold_at), channelCode: o.channel, paymentCode: o.payment,
    lines: o.lines.map((l) => ({
      code: l.code, size: l.size, sweetness: l.sweetness as Sweetness, milk: l.milk, grade: l.grade, qty: l.qty, ...(l.free === null ? {} : { free: l.free }),
      discountBaht: l.discount_baht, discountPercent: l.discount_percent, discountReason: l.discount_reason,
    })),
    billDiscountBaht: o.bill_discount?.baht ?? null, billDiscountPercent: o.bill_discount?.percent ?? null, billDiscountReason: o.bill_discount?.reason ?? null,
    promoCode: o.promo_code,
    skipPromotionIds: o.no_promotions ? active.map((p) => p.id) : o.skip_promotion_ids, // no_promotions = skip every promotion (dayo_quote_priced)
    manualPromotionIds: o.manual_promotion_ids, manualPromotionReason: o.manual_promotion_reason,
    exhaustedPromotions: exhausted,
  }
  return computeOrder(draft, catalog)
}
