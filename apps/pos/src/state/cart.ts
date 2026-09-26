import type { MilkCode, Sweetness } from '@dayo/dayo-pricing'
import type { CartDraft, CartLineDraft } from '@dayo/domain'

/**
 * In-memory cart; written to the database only when paid (D48 Q3-7). `orderId` makes commitSale idempotent.
 * ADR-0054: `size` is a plain string that always comes from the catalog (`sizes` of `SellCatalogDto`), never a
 * fixed literal size — dayo's own `Size` type is itself just `string` (any "<n> oz", checked by the shop's
 * `catalog.sizes`, not by a fixed TS union), so no cast is needed to build the domain's `CartLineDraft`.
 */
export type CartLine = { key: string; code: string; nameTh: string; size: string; sweetness: Sweetness; milk: MilkCode; grade: string | null; qty: number }
export type CartState = {
  orderId: string
  lines: CartLine[]
  channelCode: string
  billDiscount: { satang: number; reason: string } | null
  promoCode: string | null
  skipPromotionIds: string[]
  noPromotions: boolean
}

export type CartAction =
  // same code|size|sweetness|milk|grade → one line (D48 Q3-8); qty never above maxQty (dayo's computeOrder would clamp silently).
  | { type: 'add'; line: Omit<CartLine, 'key' | 'qty'>; maxQty: number }
  | { type: 'inc'; key: string; maxQty: number }
  | { type: 'dec'; key: string }
  | { type: 'remove'; key: string }
  | { type: 'setChannel'; channelCode: string }
  | { type: 'setDiscount'; satang: number; reason: string }
  | { type: 'clearDiscount' }
  | { type: 'skipPromotion'; id: string }
  | { type: 'unskipPromotion'; id: string }
  | { type: 'setNoPromotions'; value: boolean }
  | { type: 'setPromoCode'; code: string | null }
  | { type: 'reset'; orderId: string; channelCode: string }

export const lineKey = (code: string, size: string, sweetness: string, milk: string, grade: string | null): string => `${code}|${size}|${sweetness}|${milk}|${grade ?? ''}`

export function emptyCart(orderId: string, channelCode: string): CartState {
  return { orderId, lines: [], channelCode, billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false }
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const key = lineKey(action.line.code, action.line.size, action.line.sweetness, action.line.milk, action.line.grade)
      const existing = state.lines.find((l) => l.key === key)
      if (existing !== undefined) {
        return { ...state, lines: state.lines.map((l) => (l.key === key ? { ...l, qty: Math.min(l.qty + 1, action.maxQty) } : l)) }
      }
      return { ...state, lines: [...state.lines, { ...action.line, key, qty: Math.min(1, action.maxQty) }] }
    }
    case 'inc':
      return { ...state, lines: state.lines.map((l) => (l.key === action.key ? { ...l, qty: Math.min(l.qty + 1, action.maxQty) } : l)) }
    case 'dec':
      return { ...state, lines: state.lines.flatMap((l) => (l.key !== action.key ? [l] : l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : [])) }
    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.key !== action.key) }
    case 'setChannel':
      return { ...state, channelCode: action.channelCode }
    case 'setDiscount':
      return { ...state, billDiscount: { satang: action.satang, reason: action.reason.trim() } }
    case 'clearDiscount':
      return { ...state, billDiscount: null }
    case 'skipPromotion':
      return state.skipPromotionIds.includes(action.id) ? state : { ...state, skipPromotionIds: [...state.skipPromotionIds, action.id] }
    case 'unskipPromotion':
      return { ...state, skipPromotionIds: state.skipPromotionIds.filter((id) => id !== action.id) }
    case 'setNoPromotions':
      return { ...state, noPromotions: action.value }
    case 'setPromoCode':
      return { ...state, promoCode: action.code }
    case 'reset':
      return emptyCart(action.orderId, action.channelCode)
  }
}

/** The exact draft `priceCart`/`recordSale` price. */
export function toCartDraft(state: CartState): Omit<CartDraft, 'paymentCode'> {
  return {
    channelCode: state.channelCode,
    lines: state.lines.map(
      (l): CartLineDraft => ({
        code: l.code,
        size: l.size,
        sweetness: l.sweetness,
        milk: l.milk,
        grade: l.grade,
        qty: l.qty,
        free: false,
        discountSatang: null,
        discountPercent: null,
        discountReason: null,
      }),
    ),
    billDiscount: state.billDiscount === null ? null : { kind: 'satang', satang: state.billDiscount.satang, reason: state.billDiscount.reason },
    promoCode: state.promoCode,
    skipPromotionIds: [...state.skipPromotionIds],
    noPromotions: state.noPromotions,
  }
}
