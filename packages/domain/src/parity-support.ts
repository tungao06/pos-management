import { computeOrder } from '@dayo/dayo-pricing'
import type { ParityDraft } from '@dayo/contracts'
import { cartFromOrderDraft } from './order-draft.js'
import { checkCart, toOrderDraft, withZeroCosts, type PosOrderCatalog, type PricedCart } from './price-cart.js'
import { pricedFromQuote } from './priced-from-quote.js'

/**
 * PARITY ONLY — not re-exported from the package index; the sale path never imports it (a test guards that).
 * `dayoOnlyExhausted` is for dayo's usage cases (rules-usage.json · plan 10 ruling R3): dayo counts uses and hands the
 * engine `exhaustedPromotions`; the tablet cannot (it sells offline), so the sale path never sends it. With the option the
 * case's list reaches the engine, to prove the engine still agrees; without it the list is ignored, as on a sale.
 * There is no way to price a case without a sale time (R15 · plan 10 gap G1): dayo's export gives every `cases[]` entry a
 * time, and the few golden/rule cases dayo prices timeless on purpose are compared at the engine layer only.
 */
export type ParityCaseOptions = { dayoOnlyExhausted?: boolean }

/** A case of pos-parity.json (or a golden case) priced exactly as the tablet prices a sale. No saleTime = Error('NO_SALE_TIME'). */
export function priceParityCase(draft: ParityDraft, catalog: PosOrderCatalog, opts: ParityCaseOptions = {}): PricedCart {
  const { cart, soldAt } = cartFromOrderDraft(draft, catalog)
  checkCart(cart, catalog)
  const sale = toOrderDraft(cart, catalog, soldAt)
  const exhausted = opts.dayoOnlyExhausted === true && draft.exhaustedPromotions !== undefined ? draft.exhaustedPromotions : null
  const orderDraft = exhausted === null ? sale : { ...sale, exhaustedPromotions: exhausted.map((e) => ({ id: e.id, scope: e.scope })) }
  return pricedFromQuote(computeOrder(orderDraft, withZeroCosts(catalog)), orderDraft, soldAt, catalog)
}
