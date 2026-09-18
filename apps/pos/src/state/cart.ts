import { computeTotals, VAT_OFF, type Totals } from '@dayo/domain'

export type CartLine = {
  key: string
  variantId: string
  sweetnessId: string
  productName: string
  sizeName: string
  sweetnessName: string
  unitPriceSatang: number
  qty: number
}
export type NewCartLine = Omit<CartLine, 'key' | 'qty'>
export type CartDiscount = { amountSatang: number; reason: string }
/** In-memory cart; written to the database only when paid (D48 Q3-7). `orderId` makes commitSale idempotent. */
export type CartState = { orderId: string; lines: CartLine[]; discount: CartDiscount | null }

export type CartAction =
  | { type: 'add'; line: NewCartLine }
  | { type: 'inc'; key: string }
  | { type: 'dec'; key: string }
  | { type: 'remove'; key: string }
  | { type: 'setDiscount'; discount: CartDiscount }
  | { type: 'clearDiscount' }
  /** D50 Q3-27: after PRICE_CHANGED, take the fresh menu prices (variantId → price; null/missing keeps the line as is). */
  | { type: 'reprice'; prices: ReadonlyMap<string, number | null> }
  | { type: 'reset'; orderId: string }

export const lineKey = (variantId: string, sweetnessId: string): string => `${variantId}|${sweetnessId}`

export function emptyCart(orderId: string): CartState {
  return { orderId, lines: [], discount: null }
}

// M4: goes through the domain (Global Constraint "ห้ามคำนวณซ้ำในแอป") instead of hand-summing qty * unitPriceSatang.
export function cartSubtotalSatang(state: CartState): number {
  return computeTotals(
    state.lines.map((l) => ({ qty: l.qty, unitPriceSatang: l.unitPriceSatang })),
    0,
    VAT_OFF,
  ).subtotalSatang
}

/** Totals via the domain (spec §4.1) — the UI never adds money itself. */
export function cartTotals(state: CartState): Totals {
  return computeTotals(
    state.lines.map((l) => ({ qty: l.qty, unitPriceSatang: l.unitPriceSatang })),
    state.discount?.amountSatang ?? 0,
    VAT_OFF,
  )
}

export function toSaleLines(state: CartState): { variantId: string; sweetnessId: string; qty: number }[] {
  return state.lines.map((l) => ({ variantId: l.variantId, sweetnessId: l.sweetnessId, qty: l.qty }))
}

// A discount larger than the remaining subtotal is dropped; the cashier re-enters it (D48 Q3-6).
function dropOversizedDiscount(state: CartState): CartState {
  return state.discount !== null && state.discount.amountSatang >= cartSubtotalSatang(state) ? { ...state, discount: null } : state
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const key = lineKey(action.line.variantId, action.line.sweetnessId) // same variant + sweetness → one line (D48 Q3-8)
      if (state.lines.some((l) => l.key === key)) {
        return { ...state, lines: state.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) }
      }
      return { ...state, lines: [...state.lines, { ...action.line, key, qty: 1 }] }
    }
    case 'inc':
      return { ...state, lines: state.lines.map((l) => (l.key === action.key ? { ...l, qty: l.qty + 1 } : l)) }
    case 'dec':
      return dropOversizedDiscount({
        ...state,
        lines: state.lines.flatMap((l) => (l.key !== action.key ? [l] : l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : [])),
      })
    case 'remove':
      return dropOversizedDiscount({ ...state, lines: state.lines.filter((l) => l.key !== action.key) })
    case 'setDiscount': {
      const amountSatang = action.discount.amountSatang
      const reason = action.discount.reason.trim()
      if (!Number.isSafeInteger(amountSatang) || amountSatang <= 0 || amountSatang >= cartSubtotalSatang(state) || reason === '') return state // total stays > 0 (D50 Q3-20)
      return { ...state, discount: { amountSatang, reason } }
    }
    case 'clearDiscount':
      return { ...state, discount: null }
    case 'reprice':
      return dropOversizedDiscount({
        ...state,
        lines: state.lines.map((l) => {
          const price = action.prices.get(l.variantId)
          return price === undefined || price === null ? l : { ...l, unitPriceSatang: price }
        }),
      })
    case 'reset':
      return emptyCart(action.orderId)
  }
}
