import {
  applyOptions, bkkDay, bkkTime, channelPrice, computeOrder, saleSettingsOf,
  type IngredientEntry, type MenuVariantEntry, type MilkCode, type OrderCatalog, type OrderDraft, type Size, type Sweetness,
} from '@dayo/dayo-pricing'
import type { PosOrderCatalogParsed } from '@dayo/contracts'
import { edgeBahtToSatang, edgeSatangToBaht } from './money-edge.js'
import { pricedFromQuote } from './priced-from-quote.js'

/**
 * E1 catalog = dayo's OrderCatalog with one difference only: ingredients carry no cost (spec 04 §4.4 rule 1). Variants
 * (with categoryLabel/menuSortOrder) and sizes are dayo's own types.
 */
export type PosIngredient = Omit<IngredientEntry, 'costPerUseUnit'>
export type PosVariant = MenuVariantEntry
export type PosOrderCatalog = Omit<OrderCatalog, 'ingredients'> & { ingredients: Record<string, PosIngredient> }

export type CartLineDraft = {
  code: string; size: Size; sweetness: Sweetness; milk: MilkCode; grade: string | null; qty: number
  free: boolean; discountSatang: number | null; discountPercent: number | null; discountReason: string | null
}
export type BillDiscountDraft = { kind: 'satang'; satang: number; reason: string | null } | { kind: 'percent'; percent: number; reason: string | null }
export type CartDraft = {
  channelCode: string; paymentCode: string; lines: CartLineDraft[]; billDiscount: BillDiscountDraft | null
  promoCode: string | null; skipPromotionIds: string[]; noPromotions: boolean
}
export type PricedLine = {
  lineNo: number; code: string; nameTh: string; size: Size; sweetness: Sweetness; milk: MilkCode; grade: string | null; qty: number
  unitPriceSatang: number; discountPerCupSatang: number; discountReason: string | null; promotionId: string | null; lineTotalSatang: number
}
export type PricedPromotion = { promotionId: string; code: string | null; name: string; kind: string; discountSatang: number }
export type PricedCart = {
  ok: boolean; warnings: string[]; soldAt: string; saleDate: string; saleTime: string; draft: OrderDraft
  lines: PricedLine[]; promotionsApplied: PricedPromotion[]
  itemsSubtotalSatang: number; itemsDiscountSatang: number; billDiscountSatang: number; discountSatang: number; totalSatang: number; channelFeeSatang: number
}
export type MilkChoice = { code: MilkCode; priceAddSatang: number }
export type GradeChoice = { code: string; priceAddSatang: number; isDefault: boolean }

export type CartErrorCode = 'EMPTY_CART' | 'CART_TOO_LARGE' | 'QTY_OUT_OF_RANGE' | 'UNKNOWN_VARIANT' | 'GRADE_RULE' | 'BAD_DISCOUNT'
/**
 * Why a `CartErrorCode` of `UNKNOWN_VARIANT` happened — a structured field a caller switches on (review round 2 item
 * 6), never the free-text `detail`/`message` (which can be reworded later without warning). `null` for every other
 * code, which needs no sub-reason.
 */
export type CartErrorReason = 'no_such_menu' | 'size_closed'
export class CartError extends Error {
  readonly code: CartErrorCode
  readonly reason: CartErrorReason | null
  constructor(code: CartErrorCode, detail: string, reason: CartErrorReason | null = null) {
    super(`${code}: ${detail}`)
    this.name = 'CartError'
    this.code = code
    this.reason = reason
  }
}

/** DY422 limits of dayo (ADR-0039): the tablet never builds a bill dayo would refuse for size. */
export const MAX_CART_LINES = 50
export const MAX_CART_CUPS = 500

/** Cost never reaches the tablet (spec §4.4 rule 1, §5.4): 0 keeps dayo's pricing code whole and changes no price. */
export function withZeroCosts(c: PosOrderCatalog): OrderCatalog {
  const ingredients: Record<string, IngredientEntry> = {}
  for (const [id, ing] of Object.entries(c.ingredients)) ingredients[id] = { ...ing, costPerUseUnit: 0 }
  return { ...c, ingredients }
}

/**
 * The variant a line may be sold as: its size must be an ACTIVE entry of catalog.sizes (ADR-0054 — dayo stops selling a
 * closed size even if a stale variant row were still around) and the variant must exist. Exported (review I5) so a
 * caller can tell a closed size (the menu still exists, `reason: 'size_closed'`) from a menu dayo removed entirely
 * (`reason: 'no_such_menu'`) — `checkLine`/the sell screen switch on `CartError.reason`, never on the message text
 * (review round 2 item 6 — a later reword of the detail must not silently break that check).
 */
export function findSellableVariant(c: PosOrderCatalog, code: string, size: string, sweetness: string): PosVariant {
  if (!c.sizes.some((s) => s.code === size && s.isActive)) throw new CartError('UNKNOWN_VARIANT', `${code} ${size} ${sweetness}: ${size} is not an active size of the shop`, 'size_closed')
  const v = c.variants.find((x) => x.menuCode === code && x.size === size && x.sweetness === sweetness)
  if (v === undefined) {
    const menuExists = c.variants.some((x) => x.menuCode === code)
    if (menuExists) throw new CartError('UNKNOWN_VARIANT', `${code} ${size} ${sweetness}: this size/sweetness is no longer sold`, 'size_closed')
    throw new CartError('UNKNOWN_VARIANT', `${code}: this menu is no longer sold`, 'no_such_menu')
  }
  return v
}

/**
 * Every check one line must pass to be sellable (review I5) — qty range, a sellable variant, the matcha/grade rule,
 * and its own discount shape. `checkCart` runs this per line; a caller that wants to know exactly WHICH line of a
 * multi-line cart is bad (the sell screen, before the whole cart even prices) can call it directly per line.
 */
export function checkLine(catalog: PosOrderCatalog, l: CartLineDraft, i: number, maxQty: number): void {
  if (!Number.isSafeInteger(l.qty) || l.qty < 1 || l.qty > maxQty) throw new CartError('QTY_OUT_OF_RANGE', `line ${i + 1}: qty ${l.qty} (1–${maxQty})`)
  const v = findSellableVariant(catalog, l.code, l.size, l.sweetness)
  if (v.isMatcha !== (l.grade !== null)) throw new CartError('GRADE_RULE', `${l.code}: ${v.isMatcha ? 'a matcha menu needs a grade' : 'grade must be null'}`)
  if (l.discountSatang !== null && l.discountPercent !== null) throw new CartError('BAD_DISCOUNT', `line ${i + 1}: baht and percent together`)
  if (l.discountSatang !== null && (!Number.isSafeInteger(l.discountSatang) || l.discountSatang < 0)) throw new CartError('BAD_DISCOUNT', `line ${i + 1}: discount must be whole satang ≥ 0`)
  if (l.discountPercent !== null && !(l.discountPercent >= 0 && l.discountPercent <= 100)) throw new CartError('BAD_DISCOUNT', `line ${i + 1}: percent must be 0–100`)
}

/** The tablet's own `maxQtyPerLine` (spec — computeOrder silently clamps qty otherwise, and the tablet must never
 * price a different bill than it sends). Exported so a per-line check (checkLine) uses the exact same bound. */
export function maxQtyPerLineOf(catalog: PosOrderCatalog): number {
  return Math.min(saleSettingsOf(catalog).maxQtyPerLine, 999)
}

/** Everything the tablet refuses before pricing (throws CartError); priceCart runs it first. */
export function checkCart(cart: CartDraft, catalog: PosOrderCatalog): void {
  if (cart.lines.length === 0) throw new CartError('EMPTY_CART', 'cart has no lines')
  const maxQty = maxQtyPerLineOf(catalog)
  let cups = 0
  cart.lines.forEach((l, i) => {
    checkLine(catalog, l, i, maxQty)
    cups += l.qty
  })
  if (cart.lines.length > MAX_CART_LINES || cups > MAX_CART_CUPS) throw new CartError('CART_TOO_LARGE', `${cart.lines.length} lines, ${cups} cups`)
  const d = cart.billDiscount
  if (d !== null && d.kind === 'satang' && (!Number.isSafeInteger(d.satang) || d.satang <= 0)) throw new CartError('BAD_DISCOUNT', 'bill discount must be whole satang > 0')
  if (d !== null && d.kind === 'percent' && !(d.percent > 0 && d.percent <= 100)) throw new CartError('BAD_DISCOUNT', 'bill percent must be 0–100')
}

/** The exact draft dayo's pricing code sees. `soldAtIso` is the payment instant (spec §5.1: re-price at sold_at). */
export function toOrderDraft(cart: CartDraft, catalog: PosOrderCatalog, soldAtIso: string): OrderDraft {
  const d = cart.billDiscount
  return {
    saleDate: bkkDay(0, Date.parse(soldAtIso)),
    saleTime: bkkTime(soldAtIso),
    channelCode: cart.channelCode,
    paymentCode: cart.paymentCode,
    lines: cart.lines.map((l) => ({
      code: l.code, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty, free: l.free,
      discountBaht: l.discountSatang === null ? null : edgeSatangToBaht(l.discountSatang),
      discountPercent: l.discountPercent,
      discountReason: l.discountReason,
    })),
    billDiscountBaht: d !== null && d.kind === 'satang' ? edgeSatangToBaht(d.satang) : null,
    billDiscountPercent: d !== null && d.kind === 'percent' ? d.percent : null,
    billDiscountReason: d?.reason ?? null,
    promoCode: cart.promoCode,
    // spec §4.5 no_promotions: OrderDraft has no such field — skipping every promotion gives the same result
    skipPromotionIds: cart.noPromotions ? catalog.promotions.map((p) => p.id) : [...cart.skipPromotionIds],
  }
}

export function priceCart(cart: CartDraft, catalog: PosOrderCatalog, soldAtIso: string): PricedCart {
  checkCart(cart, catalog)
  const draft = toOrderDraft(cart, catalog, soldAtIso)
  return pricedFromQuote(computeOrder(draft, withZeroCosts(catalog)), draft, soldAtIso)
}

/** Sum of satang amounts (never float baht — spec §5.4). */
export function sumSatang(values: readonly number[]): number {
  return values.reduce((a, v) => {
    if (!Number.isSafeInteger(v)) throw new RangeError(`not whole satang: ${v}`)
    return a + v
  }, 0)
}

/** What dayo computed minus what the tablet charged (spec §4.3) — null until dayo answered. */
export function centralDiffSatang(computedSatang: number | null, chargedSatang: number): number | null {
  return computedSatang === null ? null : computedSatang - chargedSatang
}

/** The milk dayo picks for an unspecified line (dayo_impl_price_line): shop default oat + oat possible → oat. */
export function defaultMilkForLine(catalog: PosOrderCatalog, variant: PosVariant): MilkCode {
  if (saleSettingsOf(catalog).defaultMilk !== 'oat') return 'fresh'
  return applyOptions(variant, { milk: 'oat', grade: null }, catalog).ok ? 'oat' : 'fresh'
}

export function lineOptions(catalog: PosOrderCatalog, code: string, size: Size, sweetness: Sweetness): { milk: MilkChoice[]; grades: GradeChoice[]; defaultMilk: MilkCode; defaultGrade: string | null } {
  const v = findSellableVariant(catalog, code, size, sweetness)
  const milk: MilkChoice[] = [{ code: 'fresh', priceAddSatang: 0 }]
  const oat = applyOptions(v, { milk: 'oat', grade: null }, catalog)
  if (oat.ok) milk.push({ code: 'oat', priceAddSatang: edgeBahtToSatang(oat.priceAdd) })
  const grades: GradeChoice[] = v.isMatcha
    ? catalog.gradeOptions.flatMap((g) => {
        const r = applyOptions(v, { milk: 'fresh', grade: g.code }, catalog)
        return r.ok ? [{ code: g.code, priceAddSatang: edgeBahtToSatang(r.priceAdd), isDefault: g.isDefault }] : []
      })
    : []
  const defaultGrade = v.isMatcha ? ((grades.find((g) => g.isDefault) ?? grades[0])?.code ?? null) : null
  return { milk, grades, defaultMilk: defaultMilkForLine(catalog, v), defaultGrade }
}

/**
 * The E1 catalog after zod validation (contracts `PosOrderCatalog`) as the pricing code's type — no cast: the schema
 * infers optional keys without `| undefined` (zod exactOptional) and requires every key dayo's interfaces require, so a
 * field the schema stops checking fails to compile here (a type test pins it).
 */
export function toPricingCatalog(parsed: PosOrderCatalogParsed): PosOrderCatalog {
  return parsed
}

/** Unit price on a channel before options and promotions — for the menu grid only (dayo channelPrice, then the edge). */
export function menuUnitPriceSatang(catalog: PosOrderCatalog, variant: PosVariant, channelCode: string): number | null {
  const channel = catalog.channels.find((c) => c.code === channelCode)
  return channel === undefined ? null : edgeBahtToSatang(channelPrice(variant.price, channel))
}
