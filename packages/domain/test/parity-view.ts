/**
 * The money a parity case is judged on (plan 10 R4 · sale-path layer): every money field in satang, the lines, the
 * applied promotions, `ok` and dayo's reason flag — not the Thai warnings (the engine layer compares those, T1).
 * One view for the tablet's PricedCart and one per expected shape (dayo's export in baht, dayo's golden files in baht),
 * so a test compares two plain objects and a mismatch prints the whole difference.
 */
import type { ParityMoney } from '@dayo/contracts'
import { computeOrder, type OrderDraft } from '@dayo/dayo-pricing'
import { edgeBahtToSatang, withZeroCosts, type PosOrderCatalog, type PricedCart } from '../src/index.js'
import { pricedFromQuote } from '../src/priced-from-quote.js'

export type LineView = {
  lineNo: number; promotionId: string | null; unitPrice: number; discountPerCup: number; lineTotal: number
  /** [promotionId, satang] per promotion — only compared where the expected side records it (rules-* files, the export). */
  promoBreakdown?: Array<[string, number]> | null
}
export type MoneyView = {
  ok: boolean; manualPromotionReasonRequired: boolean | undefined
  itemsSubtotal: number; itemsDiscount: number; billDiscountAmount: number; totalAmount: number; channelFeeAmount: number
  lines: LineView[]
  /** [promotionId, satang] in the engine's order. */
  promotionsApplied: Array<[string, number]>
}

/** The tablet's side. `breakdown` = include promoBreakdown (the expected side records it). */
export function pricedView(p: PricedCart, breakdown: boolean): MoneyView {
  return {
    ok: p.ok, manualPromotionReasonRequired: p.manualPromotionReasonRequired,
    itemsSubtotal: p.itemsSubtotalSatang, itemsDiscount: p.itemsDiscountSatang, billDiscountAmount: p.billDiscountSatang,
    totalAmount: p.totalSatang, channelFeeAmount: p.channelFeeSatang,
    lines: p.lines.map((l) => ({
      lineNo: l.lineNo, promotionId: l.promotionId, unitPrice: l.unitPriceSatang, discountPerCup: l.discountPerCupSatang, lineTotal: l.lineTotalSatang,
      ...(breakdown ? { promoBreakdown: l.promoBreakdown === null ? null : l.promoBreakdown.map((b): [string, number] => [b.promotionId, b.satang]) } : {}),
    })),
    promotionsApplied: p.promotionsApplied.map((a): [string, number] => [a.promotionId, a.discountSatang]),
  }
}

/** dayo's export (pos-parity.json `cases[]` and `rule_fixtures[].cases[]`): baht → satang through the one edge. */
export function exportExpectedView(e: ParityMoney): MoneyView {
  return {
    ok: e.ok, manualPromotionReasonRequired: e.manualPromotionReasonRequired,
    itemsSubtotal: edgeBahtToSatang(e.itemsSubtotal), itemsDiscount: edgeBahtToSatang(e.itemsDiscount),
    billDiscountAmount: edgeBahtToSatang(e.billDiscountAmount), totalAmount: edgeBahtToSatang(e.totalAmount),
    channelFeeAmount: edgeBahtToSatang(e.channelFeeAmount),
    lines: e.lines.map((l) => ({
      lineNo: l.lineNo,
      promotionId: typeof l['promotionId'] === 'string' ? l['promotionId'] : null,
      unitPrice: edgeBahtToSatang(l.unitPrice), discountPerCup: edgeBahtToSatang(l.discountPerCup), lineTotal: edgeBahtToSatang(l.lineTotal),
      promoBreakdown: l.promoBreakdown == null ? null : l.promoBreakdown.map((b): [string, number] => [b.promotionId, edgeBahtToSatang(b.amount)]),
    })),
    promotionsApplied: e.promotionsApplied.map((p): [string, number] => [p.promotionId, edgeBahtToSatang(p.discountAmount)]),
  }
}

/**
 * dayo's golden `expected` (load.ts FixtureExpected): promotions are named, ids = names in the catalog the golden cases
 * are priced on; lines carry no lineNo (the engine numbers them 1…n); promoBreakdown only in rules-* files, only when not null.
 */
export type GoldenExpected = {
  ok: boolean; manualPromotionReasonRequired: boolean
  itemsSubtotal: number; itemsDiscount: number; billDiscountAmount: number; totalAmount: number; channelFeeAmount: number
  lines: Array<{ unitPrice: number; discountPerCup: number; promotion: string | null; lineTotal: number; promoBreakdown?: Array<{ promotion: string; amount: number }> }>
  promotionsApplied: Array<{ name: string; discountAmount: number }>
  warnings: string[]
}
export function goldenExpectedView(e: GoldenExpected, breakdown: boolean): MoneyView {
  return {
    ok: e.ok, manualPromotionReasonRequired: e.manualPromotionReasonRequired,
    itemsSubtotal: edgeBahtToSatang(e.itemsSubtotal), itemsDiscount: edgeBahtToSatang(e.itemsDiscount),
    billDiscountAmount: edgeBahtToSatang(e.billDiscountAmount), totalAmount: edgeBahtToSatang(e.totalAmount),
    channelFeeAmount: edgeBahtToSatang(e.channelFeeAmount),
    lines: e.lines.map((l, i) => ({
      lineNo: i + 1, promotionId: l.promotion,
      unitPrice: edgeBahtToSatang(l.unitPrice), discountPerCup: edgeBahtToSatang(l.discountPerCup), lineTotal: edgeBahtToSatang(l.lineTotal),
      ...(breakdown ? { promoBreakdown: l.promoBreakdown === undefined ? null : l.promoBreakdown.map((b): [string, number] => [b.promotion, edgeBahtToSatang(b.amount)]) } : {}),
    })),
    promotionsApplied: e.promotionsApplied.map((p): [string, number] => [p.name, edgeBahtToSatang(p.discountAmount)]),
  }
}

/**
 * ENGINE LAYER ONLY — a draft the sale path never builds (no saleTime: the tablet always knows the instant it sells,
 * ruling R15 · gap G1). dayo's own draft goes straight into the vendored engine; the result reaches satang through the
 * same single conversion as a sale (pricedFromQuote), so the two layers share one baht → satang rule.
 */
export function engineLayer(draft: OrderDraft, catalog: PosOrderCatalog): PricedCart {
  return pricedFromQuote(computeOrder(draft, withZeroCosts(catalog)), draft, '', catalog)
}
