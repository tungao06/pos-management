import {
  applyOptions, bkkDay, bkkTime, channelPrice, computeOrder, normPromoCode, saleSettingsOf,
  type ApplyMode, type IngredientEntry, type MenuOptionGradeEntry, type MenuOptionMilkEntry, type MenuVariantEntry, type MilkCode, type OrderCatalog,
  type OrderDraft, type PromoTemplate, type Size, type Sweetness,
} from '@dayo/dayo-pricing'
import { ManualPromotionReason, MAX_MANUAL_PROMOTIONS, type PosOrderCatalogParsed } from '@dayo/contracts'
import { edgeBahtToSatang, edgeSatangToBaht } from './money-edge.js'
import { pricedFromQuote } from './priced-from-quote.js'

/**
 * E1 catalog = dayo's OrderCatalog with two differences: ingredients carry no cost (spec 04 §4.4 rule 1), and a milk or
 * grade option may have a null ingredientId/multiplier — dayo's menu_options columns are nullable (0002_catalog.sql) and
 * E1 passes them through, although dayo's types.ts says string/number. Variants and sizes are dayo's own types.
 */
export type PosIngredient = Omit<IngredientEntry, 'costPerUseUnit'>
export type PosVariant = MenuVariantEntry
export type PosMilkOption = Omit<MenuOptionMilkEntry, 'ingredientId'> & { ingredientId: string | null }
export type PosGradeOption = Omit<MenuOptionGradeEntry, 'ingredientId' | 'multiplier'> & { ingredientId: string | null; multiplier: number | null }
export type PosOrderCatalog = Omit<OrderCatalog, 'ingredients' | 'milkOptions' | 'gradeOptions'> & {
  ingredients: Record<string, PosIngredient>; milkOptions: PosMilkOption[]; gradeOptions: PosGradeOption[]
}

export type CartLineDraft = {
  code: string; size: Size; sweetness: Sweetness; milk: MilkCode; grade: string | null; qty: number
  free: boolean; discountSatang: number | null; discountPercent: number | null; discountReason: string | null
}
export type BillDiscountDraft = { kind: 'satang'; satang: number; reason: string | null } | { kind: 'percent'; percent: number; reason: string | null }
export type CartDraft = {
  channelCode: string; paymentCode: string; lines: CartLineDraft[]; billDiscount: BillDiscountDraft | null
  promoCode: string | null; skipPromotionIds: string[]; noPromotions: boolean
  /**
   * Manual promotions (apply_mode 'manual', ADR-0070 rule 3) the staff picked for this bill — ids as picked; de-duplicated
   * where the cart leaves the tablet (manualPromotionsOf). Ignored when noPromotions.
   */
  manualPromotionIds: string[]
  /** The reason typed for them, already `trimWs(typed)` (@dayo/contracts), or null — asked only when the engine flags it (owner Q2 = ก). */
  manualPromotionReason: string | null
}
export type PricedLine = {
  lineNo: number; code: string; nameTh: string; size: Size; sweetness: Sweetness; milk: MilkCode; grade: string | null; qty: number
  unitPriceSatang: number; discountPerCupSatang: number; discountReason: string | null; promotionId: string | null; lineTotalSatang: number
  /** dayo order_items.promo_breakdown in satang — only on cups discounted by more than one promotion, else null. Frozen with the bill. */
  promoBreakdown: { promotionId: string; satang: number }[] | null
}
/**
 * kind = the engine's template name (order_promotions.kind) · mode = promoApplyMode of the catalog promotion ·
 * usageLimitTotal/PerDay = the catalog promotion's limits (null = none), for the "จำกัด n ครั้ง" badge only — never a
 * discount rule (ADR-0072 rule 2 · D126 · gap G3). Optional: a bill frozen before plan 10 has none; priceCart always sets them.
 */
export type PricedPromotion = {
  promotionId: string; code: string | null; name: string; kind: PromoTemplate; mode: ApplyMode; discountSatang: number
  usageLimitTotal?: number | null; usageLimitPerDay?: number | null
}
export type PricedCart = {
  ok: boolean; warnings: string[]; soldAt: string; saleDate: string; saleTime: string; draft: OrderDraft
  lines: PricedLine[]; promotionsApplied: PricedPromotion[]
  itemsSubtotalSatang: number; itemsDiscountSatang: number; billDiscountSatang: number; discountSatang: number; totalSatang: number; channelFeeSatang: number
  /**
   * dayo's pure condition (ADR-0070 rule 4 · dayo_manual_reason_guard): the bill is ฿0 and a manual promotion gave a
   * discount — true whether or not a reason is there; `ok` is false only while the reason is missing.
   */
  manualPromotionReasonRequired: boolean
}
export type MilkChoice = { code: MilkCode; priceAddSatang: number }
export type GradeChoice = { code: string; priceAddSatang: number; isDefault: boolean }

export type CartErrorCode = 'EMPTY_CART' | 'CART_TOO_LARGE' | 'QTY_OUT_OF_RANGE' | 'UNKNOWN_VARIANT' | 'GRADE_RULE' | 'BAD_DISCOUNT' | 'BAD_MANUAL_PROMOTION'
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

/**
 * The options exactly as E1 sent them, typed as dayo's pricing code declares them. dayo runs the same code on the same
 * nulls (it reads menu_options as stored), so passing them through unchanged is parity — never replace a null with a
 * default here. The only type widening of the catalog, in one place. Exported so other domain code that calls dayo's
 * `applyOptions` directly (e.g. `lineUnitPriceSatang`) reuses this same cast instead of adding a second one.
 */
export function dayoOptions(c: PosOrderCatalog): Pick<OrderCatalog, 'milkOptions' | 'gradeOptions'> {
  return { milkOptions: c.milkOptions as MenuOptionMilkEntry[], gradeOptions: c.gradeOptions as MenuOptionGradeEntry[] }
}

/** Cost never reaches the tablet (spec §4.4 rule 1, §5.4): 0 keeps dayo's pricing code whole and changes no price. */
export function withZeroCosts(c: PosOrderCatalog): OrderCatalog {
  const ingredients: Record<string, IngredientEntry> = {}
  for (const [id, ing] of Object.entries(c.ingredients)) ingredients[id] = { ...ing, costPerUseUnit: 0 }
  return { ...c, ...dayoOptions(c), ingredients }
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
  // `?? []` / `!= null`: a cart frozen before plan 10 (pricing_json.cart) has neither key (review L2)
  const unique = new Set(cart.manualPromotionIds ?? []).size
  if (unique > MAX_MANUAL_PROMOTIONS) throw new CartError('BAD_MANUAL_PROMOTION', `${unique} manual promotions (dayo takes at most ${MAX_MANUAL_PROMOTIONS} — DY422)`)
  // dayo_draft_manual_reason (0069): a reason dayo refuses must never reach a paid bill — the same rule the E2 row is checked with
  if (cart.manualPromotionReason != null && !ManualPromotionReason.safeParse(cart.manualPromotionReason).success) {
    throw new CartError('BAD_MANUAL_PROMOTION', 'the reason must be trimWs(typed): 1–200 characters, one line, no invisible characters')
  }
}

/**
 * What of the cart's manual promotions leaves the tablet — to the engine (toOrderDraft) and to dayo (E2 row): ids in the
 * order picked, each once; none when noPromotions (it skips every promotion); the reason only alongside ids. One place,
 * so the price and the row can never disagree.
 */
export function manualPromotionsOf(cart: CartDraft): { ids: string[]; reason: string | null } {
  // `?? []` / `?? null`: a cart frozen before plan 10 has neither key (review L2)
  const ids = cart.noPromotions ? [] : [...new Set(cart.manualPromotionIds ?? [])]
  return { ids, reason: ids.length > 0 ? (cart.manualPromotionReason ?? null) : null }
}

/** The ids every promotion-condition check skips: all of the catalog when noPromotions (spec §4.5 — OrderDraft has no such field). */
export function skippedPromotionIds(cart: CartDraft, catalog: PosOrderCatalog): string[] {
  return cart.noPromotions ? catalog.promotions.map((p) => p.id) : [...cart.skipPromotionIds]
}

/** The exact draft dayo's pricing code sees. `soldAtIso` is the payment instant (spec §5.1: re-price at sold_at). */
export function toOrderDraft(cart: CartDraft, catalog: PosOrderCatalog, soldAtIso: string): OrderDraft {
  const d = cart.billDiscount
  const manual = manualPromotionsOf(cart)
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
    // plan 10 §0.2: the engine and dayo see the code in dayo_norm_promo_code form (blank = none)
    promoCode: cart.promoCode === null ? null : normPromoCode(cart.promoCode),
    skipPromotionIds: skippedPromotionIds(cart, catalog),
    // manual keys only when picked, so a cart without one prices the very draft of before plan 10 · never
    // the exhausted-promotions list: the tablet sells offline and cannot count uses (ADR-0072 rule 2 · owner Q3 = ก)
    ...(manual.ids.length > 0 ? { manualPromotionIds: manual.ids, manualPromotionReason: manual.reason } : {}),
  }
}

export function priceCart(cart: CartDraft, catalog: PosOrderCatalog, soldAtIso: string): PricedCart {
  checkCart(cart, catalog)
  const draft = toOrderDraft(cart, catalog, soldAtIso)
  return pricedFromQuote(computeOrder(draft, withZeroCosts(catalog)), draft, soldAtIso, catalog)
}

/** D124: a ฿0 bill is paid in cash only (the payment row of ฿0 — migration 0007). The tablet's cash payment code. */
export const ZERO_TOTAL_PAYMENT_CODE = 'cash'

export type ZeroTotalVerdict = 'ok' | 'MANUAL_REASON_REQUIRED' | 'ZERO_TOTAL_NOT_ALLOWED' | 'ZERO_TOTAL_CASH_ONLY'

/**
 * Whether a ฿0 bill must carry a manual-promotion reason — the ONE place of this rule (T3 review L1).
 * - dayo's engine flag (ADR-0070 rule 4): ฿0 and a manual promotion gave a discount here;
 * - PROVISIONAL (review L1 option ก, pending the owner): ฿0 and any manual promotion is sent. dayo judges the reason on
 *   the POS total AND its own quote (0069:406-414), which counts uses the tablet cannot: a promotion exhausted on dayo can
 *   leave a manual one discounting there, and the row is rejected `reason_required:`. If the owner picks (ข), drop the
 *   second clause.
 */
export function zeroBillNeedsReason(cart: CartDraft, priced: PricedCart): boolean {
  return priced.manualPromotionReasonRequired || (priced.totalSatang === 0 && manualPromotionsOf(cart).ids.length > 0)
}

/**
 * Whether a bill may be sold at its total (D124 · owner Q1 = ข). A bill above ฿0 is always 'ok'. At ฿0, in this order —
 * - a typed discount anywhere in the cart (a free cup, a line discount, a bill discount — whatever its amount), or no
 *   applied promotion that discounted anything (e.g. a ฿0 menu) → 'ZERO_TOTAL_NOT_ALLOWED': ฿0 only from promotions;
 * - zeroBillNeedsReason and no reason sent → 'MANUAL_REASON_REQUIRED' (dayo would reject it `reason_required:`);
 * - paid other than ZERO_TOTAL_PAYMENT_CODE → 'ZERO_TOTAL_CASH_ONLY';
 * - else 'ok'.
 * It judges the zero only; `priced.ok` is still the caller's to check.
 */
export function zeroTotalVerdict(cart: CartDraft, priced: PricedCart): ZeroTotalVerdict {
  if (priced.totalSatang > 0) return 'ok'
  const typed = cart.billDiscount !== null || cart.lines.some((l) => l.free || l.discountSatang !== null || l.discountPercent !== null)
  if (typed) return 'ZERO_TOTAL_NOT_ALLOWED'
  if (!priced.promotionsApplied.some((p) => p.discountSatang > 0)) return 'ZERO_TOTAL_NOT_ALLOWED'
  if (zeroBillNeedsReason(cart, priced) && manualPromotionsOf(cart).reason === null) return 'MANUAL_REASON_REQUIRED'
  if (cart.paymentCode !== ZERO_TOTAL_PAYMENT_CODE) return 'ZERO_TOTAL_CASH_ONLY'
  return 'ok'
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
  return applyOptions(variant, { milk: 'oat', grade: null }, dayoOptions(catalog)).ok ? 'oat' : 'fresh'
}

export function lineOptions(catalog: PosOrderCatalog, code: string, size: Size, sweetness: Sweetness): { milk: MilkChoice[]; grades: GradeChoice[]; defaultMilk: MilkCode; defaultGrade: string | null } {
  const v = findSellableVariant(catalog, code, size, sweetness)
  const milk: MilkChoice[] = [{ code: 'fresh', priceAddSatang: 0 }]
  const oat = applyOptions(v, { milk: 'oat', grade: null }, dayoOptions(catalog))
  if (oat.ok) milk.push({ code: 'oat', priceAddSatang: edgeBahtToSatang(oat.priceAdd) })
  const grades: GradeChoice[] = v.isMatcha
    ? catalog.gradeOptions.flatMap((g) => {
        const r = applyOptions(v, { milk: 'fresh', grade: g.code }, dayoOptions(catalog))
        return r.ok ? [{ code: g.code, priceAddSatang: edgeBahtToSatang(r.priceAdd), isDefault: g.isDefault }] : []
      })
    : []
  const defaultGrade = v.isMatcha ? ((grades.find((g) => g.isDefault) ?? grades[0])?.code ?? null) : null
  return { milk, grades, defaultMilk: defaultMilkForLine(catalog, v), defaultGrade }
}

/**
 * The E1 catalog after zod validation (contracts `PosOrderCatalog`) as the pricing code's type — no cast: the schema
 * infers optional keys without `| undefined` (zod exactOptional) and requires every key dayo's interfaces require, so a
 * field the schema stops checking fails to compile here (a type test pins it). Both promotion shapes of E1 (legacy
 * kind + params, rule-only) are f4cda56's Promotion as they are. The SHAPE is the schema's; what a rule MEANS is
 * checkCatalogRules' (promo-catalog.ts) — run it before a catalog is accepted.
 */
export function toPricingCatalog(parsed: PosOrderCatalogParsed): PosOrderCatalog {
  return parsed
}

/** Unit price on a channel before options and promotions — for the menu grid only (dayo channelPrice, then the edge). */
export function menuUnitPriceSatang(catalog: PosOrderCatalog, variant: PosVariant, channelCode: string): number | null {
  const channel = catalog.channels.find((c) => c.code === channelCode)
  return channel === undefined ? null : edgeBahtToSatang(channelPrice(variant.price, channel))
}
