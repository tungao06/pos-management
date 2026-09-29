import { promoApplyMode, type ApplyMode, type OrderDraft, type QuoteResult } from '@dayo/dayo-pricing'
import { edgeBahtToSatang } from './money-edge.js'
import type { PosOrderCatalog, PricedCart } from './price-cart.js'

/**
 * dayo's QuoteResult of `draft` → the tablet's PricedCart in satang: the ONE place the engine's baht becomes satang
 * (plan 10 §0 · spec §5.1). Internal: not re-exported from the package index, so a PricedCart only comes from priceCart
 * (sale path) or parity-support (dayo's parity export). `catalog` = the one `draft` was priced with — it gives each
 * applied promotion its apply mode.
 */
export function pricedFromQuote(q: QuoteResult, draft: OrderDraft, soldAtIso: string, catalog: PosOrderCatalog): PricedCart {
  const modeOf = (promotionId: string): ApplyMode => {
    const p = catalog.promotions.find((x) => x.id === promotionId)
    // the engine only applies promotions of the catalog it was given: anything else is a bug, never a guessed mode
    if (p === undefined) throw new Error(`UNKNOWN_APPLIED_PROMOTION: ${promotionId} is not a promotion of the priced catalog`)
    return promoApplyMode(p)
  }
  // spec §5.1: only these fields are money; costTotal/grossProfit/gpPercent/unitCost are not converted
  const priced: Omit<PricedCart, 'discountSatang'> = {
    ok: q.ok,
    warnings: q.warnings,
    soldAt: soldAtIso,
    saleDate: draft.saleDate,
    saleTime: draft.saleTime ?? '',
    draft,
    lines: q.lines.map((l) => ({
      lineNo: l.lineNo, code: l.menuCode, nameTh: l.menuNameTh, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty,
      unitPriceSatang: edgeBahtToSatang(l.unitPrice),
      discountPerCupSatang: edgeBahtToSatang(l.discountPerCup),
      discountReason: l.discountReason,
      promotionId: l.promotionId,
      lineTotalSatang: edgeBahtToSatang(l.lineTotal),
      promoBreakdown: l.promoBreakdown == null ? null : l.promoBreakdown.map((b) => ({ promotionId: b.promotionId, satang: edgeBahtToSatang(b.amount) })),
    })),
    promotionsApplied: q.promotionsApplied.map((p) => ({
      promotionId: p.promotionId, code: p.code, name: p.name, kind: p.kind, mode: modeOf(p.promotionId), discountSatang: edgeBahtToSatang(p.discountAmount),
    })),
    itemsSubtotalSatang: edgeBahtToSatang(q.itemsSubtotal),
    itemsDiscountSatang: edgeBahtToSatang(q.itemsDiscount),
    billDiscountSatang: edgeBahtToSatang(q.billDiscountAmount),
    totalSatang: edgeBahtToSatang(q.totalAmount),
    channelFeeSatang: edgeBahtToSatang(q.channelFeeAmount),
    manualPromotionReasonRequired: q.manualPromotionReasonRequired,
  }
  // The Z report stores subtotal − discount = total (plan 3b). If dayo ever adds another amount to totalAmount this
  // stops the sale loudly instead of skewing the Z's discount silently (review item 18 — money rules stay in the domain).
  const discountSatang = priced.itemsDiscountSatang + priced.billDiscountSatang
  if (priced.itemsSubtotalSatang - discountSatang !== priced.totalSatang) {
    return { ...priced, ok: false, discountSatang, warnings: [...priced.warnings, 'PRICED_TOTAL_MISMATCH: subtotal − discounts ≠ total'] }
  }
  return { ...priced, discountSatang }
}
