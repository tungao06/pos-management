/**
 * The money a parity case is judged on (plan 10 R4 · sale-path layer): every money field in satang, the lines (which cup
 * each is, and its price), the applied promotions (with the tier hit of a tiered promotion), `ok` and dayo's reason flag —
 * not the Thai warnings (the engine layer compares those, T1). One view for the tablet's PricedCart and one per expected
 * shape (dayo's export in baht, dayo's golden files in baht), so a test compares two plain objects and a mismatch prints
 * the whole difference. Not compared: `optionAdds` (dayo's per-cup option price split) — the tablet keeps no such field;
 * its money is already inside unitPrice.
 */
import type { ParityDraft, ParityMoney } from '@dayo/contracts'
import { computeOrder, type OrderDraft, type PromoTierHit } from '@dayo/dayo-pricing'
import { edgeBahtToSatang, withZeroCosts, type PosOrderCatalog, type PricedCart } from '../src/index.js'
import { pricedFromQuote } from '../src/priced-from-quote.js'

export type LineView = {
  lineNo: number
  /** Which cup the line is (review L1): the same price on a different cup is different stock on dayo. */
  menuCode: string; size: string; sweetness: string; milk: string; grade: string | null; qty: number
  promotionId: string | null; unitPrice: number; discountPerCup: number; lineTotal: number
  /** [promotionId, satang] per promotion — only compared where the expected side records it (rules-* files, the export). */
  promoBreakdown?: Array<[string, number]> | null
}
/** [promotionId, satang, tier hit of a tiered promotion (order_promotions.detail.tier) or null]. */
export type AppliedView = [string, number, PromoTierHit | null]
export type MoneyView = {
  ok: boolean; manualPromotionReasonRequired: boolean | undefined
  itemsSubtotal: number; itemsDiscount: number; billDiscountAmount: number; totalAmount: number; channelFeeAmount: number
  lines: LineView[]
  /** In the engine's order. */
  promotionsApplied: AppliedView[]
}

const tierOf = (detail: unknown): PromoTierHit | null => {
  const tier = (detail as { tier?: unknown } | null | undefined)?.tier
  return tier === undefined || tier === null ? null : (tier as PromoTierHit)
}

/**
 * The tablet's side. `breakdown` = include promoBreakdown (the expected side records it). `catalog` = the one the case was
 * priced on: PricedPromotion keeps no tier, so the tier hit is read by quoting `p.draft` — the very draft the sale path
 * built and priced — once more with the same engine and catalog (deterministic: the quote pricedFromQuote consumed).
 */
export function pricedView(p: PricedCart, breakdown: boolean, catalog: PosOrderCatalog): MoneyView {
  const quoted = computeOrder(p.draft, withZeroCosts(catalog)).promotionsApplied
  return {
    ok: p.ok, manualPromotionReasonRequired: p.manualPromotionReasonRequired,
    itemsSubtotal: p.itemsSubtotalSatang, itemsDiscount: p.itemsDiscountSatang, billDiscountAmount: p.billDiscountSatang,
    totalAmount: p.totalSatang, channelFeeAmount: p.channelFeeSatang,
    lines: p.lines.map((l) => ({
      lineNo: l.lineNo, menuCode: l.code, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty,
      promotionId: l.promotionId, unitPrice: l.unitPriceSatang, discountPerCup: l.discountPerCupSatang, lineTotal: l.lineTotalSatang,
      ...(breakdown ? { promoBreakdown: l.promoBreakdown === null ? null : l.promoBreakdown.map((b): [string, number] => [b.promotionId, b.satang]) } : {}),
    })),
    promotionsApplied: p.promotionsApplied.map((a, i): AppliedView => {
      const q = quoted[i]
      if (q?.promotionId !== a.promotionId) throw new Error(`re-quote of the sale draft differs at promotion ${i}: ${String(q?.promotionId)} ≠ ${a.promotionId}`)
      return [a.promotionId, a.discountSatang, tierOf(q.detail)]
    }),
  }
}

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new Error(`export line ${what} is not a string: ${String(v)}`)
  return v
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
      menuCode: str(l['menuCode'], 'menuCode'), size: str(l['size'], 'size'), sweetness: str(l['sweetness'], 'sweetness'), milk: str(l['milk'], 'milk'),
      grade: l['grade'] === null ? null : str(l['grade'], 'grade'),
      qty: typeof l['qty'] === 'number' ? l['qty'] : Number.NaN,
      promotionId: typeof l['promotionId'] === 'string' ? l['promotionId'] : null,
      unitPrice: edgeBahtToSatang(l.unitPrice), discountPerCup: edgeBahtToSatang(l.discountPerCup), lineTotal: edgeBahtToSatang(l.lineTotal),
      promoBreakdown: l.promoBreakdown == null ? null : l.promoBreakdown.map((b): [string, number] => [b.promotionId, edgeBahtToSatang(b.amount)]),
    })),
    promotionsApplied: e.promotionsApplied.map((p): AppliedView => [p.promotionId, edgeBahtToSatang(p.discountAmount), tierOf(p['detail'])]),
  }
}

/**
 * dayo's golden `expected` (load.ts FixtureExpected): promotions are named, ids = names in the catalog the golden cases
 * are priced on; lines carry no lineNo (the engine numbers them 1…n); promoBreakdown only in rules-* files, only when not
 * null; `tier` only on a tiered promotion's hit (= order_promotions.detail.tier).
 */
export type GoldenExpected = {
  ok: boolean; manualPromotionReasonRequired: boolean
  itemsSubtotal: number; itemsDiscount: number; billDiscountAmount: number; totalAmount: number; channelFeeAmount: number
  lines: Array<{
    menuCode: string; size: string; sweetness: string; milk: string; grade: string | null; qty: number
    unitPrice: number; discountPerCup: number; promotion: string | null; lineTotal: number; promoBreakdown?: Array<{ promotion: string; amount: number }>
  }>
  promotionsApplied: Array<{ name: string; discountAmount: number; tier?: PromoTierHit }>
  warnings: string[]
}
export function goldenExpectedView(e: GoldenExpected, breakdown: boolean): MoneyView {
  return {
    ok: e.ok, manualPromotionReasonRequired: e.manualPromotionReasonRequired,
    itemsSubtotal: edgeBahtToSatang(e.itemsSubtotal), itemsDiscount: edgeBahtToSatang(e.itemsDiscount),
    billDiscountAmount: edgeBahtToSatang(e.billDiscountAmount), totalAmount: edgeBahtToSatang(e.totalAmount),
    channelFeeAmount: edgeBahtToSatang(e.channelFeeAmount),
    lines: e.lines.map((l, i) => ({
      lineNo: i + 1, menuCode: l.menuCode, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty,
      promotionId: l.promotion,
      unitPrice: edgeBahtToSatang(l.unitPrice), discountPerCup: edgeBahtToSatang(l.discountPerCup), lineTotal: edgeBahtToSatang(l.lineTotal),
      ...(breakdown ? { promoBreakdown: l.promoBreakdown === undefined ? null : l.promoBreakdown.map((b): [string, number] => [b.promotion, edgeBahtToSatang(b.amount)]) } : {}),
    })),
    promotionsApplied: e.promotionsApplied.map((p): AppliedView => [p.name, edgeBahtToSatang(p.discountAmount), p.tier ?? null]),
  }
}

/**
 * The one line-identity difference the sale path has by design (review L1 — counted, never silent): a MATCHA line whose
 * draft names no grade. dayo prices it with no grade at all (vendored money.ts applyOptions: no grade → the base recipe's
 * powder, `grade: null`); the tablet cannot sell a matcha without one (checkCart GRADE_RULE) and its cart takes the
 * catalog's default grade — on a real sale it sends that grade explicitly, so dayo records the same cup the tablet sold.
 * Returns the expected view with exactly those lines' grade set to the catalog default, and how many lines it changed.
 * Every other grade — and every other line field — must match as dayo recorded it; money is compared untouched.
 */
export function withDefaultedGrades(expected: MoneyView, draft: ParityDraft, catalog: PosOrderCatalog): { view: MoneyView; defaulted: number } {
  const def = (catalog.gradeOptions.find((g) => g.isDefault) ?? catalog.gradeOptions[0])?.code ?? null
  let defaulted = 0
  const lines = expected.lines.map((l, i) => {
    const matcha = catalog.variants.some((v) => v.menuCode === l.menuCode && v.size === l.size && v.sweetness === l.sweetness && v.isMatcha)
    if (!matcha || l.grade !== null || draft.lines[i]?.grade != null || def === null) return l
    defaulted++
    return { ...l, grade: def }
  })
  return { view: { ...expected, lines }, defaulted }
}

/**
 * ENGINE LAYER ONLY — a draft the sale path never builds (no saleTime: the tablet always knows the instant it sells,
 * ruling R15 · gap G1). dayo's own draft goes straight into the vendored engine; the result reaches satang through the
 * same single conversion as a sale (pricedFromQuote), so the two layers share one baht → satang rule.
 */
export function engineLayer(draft: OrderDraft, catalog: PosOrderCatalog): PricedCart {
  return pricedFromQuote(computeOrder(draft, withZeroCosts(catalog)), draft, '', catalog)
}
