// packages/dayo-mock/src/reprice.ts — computed_total when a promotion was closed before sold_at. No node:* imports.
// dayo re-quotes every POS bill with the promotions active AT sold_at (ADR-0049 rule 5 · ADR-0053 · dayo_promo_active_at,
// 0050_promotion_status_history.sql:189-203, used by dayo_quote_priced 0051:355,643). The mock does not re-price a bill in
// general (it trusts parity: computed_total = total); it only adds what the closed promotions were worth, priced with dayo's
// own pricing code: computed = total + quote(promotions active at sold_at) − quote(the same + those closed before sold_at).
import { bkkTime, computeOrder, round2, type MenuOptionGradeEntry, type MenuOptionMilkEntry, type OrderCatalog, type OrderDraft, type Sweetness } from '@dayo/dayo-pricing'
import type { CatalogPromotion, MockOrderData, MockState } from './state.js'

// A test's `expected` for a closed-promotion bill must come from a fixture or hand calculation, never from this mock's own output — the mock only copies the tablet's pricing deltas, so its answer can never check itself.
export function computedTotalAt(s: MockState, o: MockOrderData, soldAt: number): number {
  const closed = [...s.closedPromotions.values()]
  const closedBefore = closed.filter((c) => c.closedAt <= soldAt).map((c) => c.promotion) // changed_at ≤ ts = the closed state counts
  if (closedBefore.length === 0) return o.totals.total
  const activeAt = [...s.catalog.catalog.promotions, ...closed.filter((c) => c.closedAt > soldAt).map((c) => c.promotion)]
  const dayo = quote(s, o, activeAt)
  const tablet = quote(s, o, [...activeAt, ...closedBefore])
  if (dayo === null || tablet === null) return o.totals.total
  return Math.max(0, round2(o.totals.total + dayo - tablet))
}

function quote(s: MockState, o: MockOrderData, promotions: CatalogPromotion[]): number | null {
  const active = promotions.map((p) => ({ ...p, isActive: true }))
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
  }
  const q = computeOrder(draft, catalog)
  return q.ok ? q.totalAmount : null
}
