import { computeOrder } from '@dayo/dayo-pricing'
import type { ParityDraft } from '@dayo/contracts'
import { cartFromOrderDraft } from './order-draft.js'
import { checkCart, toOrderDraft, withZeroCosts, type PosOrderCatalog, type PricedCart } from './price-cart.js'
import { pricedFromQuote } from './priced-from-quote.js'

/**
 * PARITY ONLY — not re-exported from the package index; the sale path never imports it (a test guards that).
 * `allowMissingSaleTime` is for dayo's real parity export: dayo priced some cases with no saleTime, so they are priced
 * the same way instead of inventing a time. Without it a missing saleTime stays an error (ruling R15).
 */
export type ParityCaseOptions = { allowMissingSaleTime?: boolean }

/** A case of pos-parity.json priced exactly as the tablet prices a sale, except that an absent saleTime stays absent. */
export function priceParityCase(draft: ParityDraft, catalog: PosOrderCatalog, opts: ParityCaseOptions = {}): PricedCart {
  const omitSaleTime = draft.saleTime === undefined && opts.allowMissingSaleTime === true
  // noon Bangkok only fixes sold_at's Thai date; the time is removed from the draft below
  const { cart, soldAt } = cartFromOrderDraft(omitSaleTime ? { ...draft, saleTime: '12:00' } : draft, catalog)
  checkCart(cart, catalog)
  const full = toOrderDraft(cart, catalog, soldAt)
  const { saleTime: _dropped, ...noTime } = full
  const orderDraft = omitSaleTime ? noTime : full
  return pricedFromQuote(computeOrder(orderDraft, withZeroCosts(catalog)), orderDraft, soldAt)
}
