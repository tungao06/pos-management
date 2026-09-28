import type { OrderDraft, QuoteResult } from '@dayo/dayo-pricing'
import { edgeBahtToSatang } from './money-edge.js'
import type { PricedCart } from './price-cart.js'

/**
 * dayo's QuoteResult of `draft` → the tablet's PricedCart in satang. Internal: not re-exported from the package index, so
 * a PricedCart only comes from priceCart (sale path) or parity-support (dayo's parity export).
 */
export function pricedFromQuote(q: QuoteResult, draft: OrderDraft, soldAtIso: string): PricedCart {
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
    })),
    promotionsApplied: q.promotionsApplied.map((p) => ({ promotionId: p.promotionId, code: p.code, name: p.name, kind: p.kind, discountSatang: edgeBahtToSatang(p.discountAmount) })),
    itemsSubtotalSatang: edgeBahtToSatang(q.itemsSubtotal),
    itemsDiscountSatang: edgeBahtToSatang(q.itemsDiscount),
    billDiscountSatang: edgeBahtToSatang(q.billDiscountAmount),
    totalSatang: edgeBahtToSatang(q.totalAmount),
    channelFeeSatang: edgeBahtToSatang(q.channelFeeAmount),
  }
  // The Z report stores subtotal − discount = total (plan 3b). If dayo ever adds another amount to totalAmount this
  // stops the sale loudly instead of skewing the Z's discount silently (review item 18 — money rules stay in the domain).
  const discountSatang = priced.itemsDiscountSatang + priced.billDiscountSatang
  if (priced.itemsSubtotalSatang - discountSatang !== priced.totalSatang) {
    return { ...priced, ok: false, discountSatang, warnings: [...priced.warnings, 'PRICED_TOTAL_MISMATCH: subtotal − discounts ≠ total'] }
  }
  return { ...priced, discountSatang }
}
