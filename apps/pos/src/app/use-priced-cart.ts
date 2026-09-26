import { useEffect, useMemo, useState } from 'react'
import { CartError, priceCart, type PosOrderCatalog, type PricedCart } from '@dayo/domain'
import { toCartDraft, type CartState } from '../state/cart'

/** dayo compares a promotion's time window as a string (spec §4.4 rule 4) — a promotion starting at 14:00 must start
 * applying on its own, without the cashier touching the cart, so the cart is re-priced on this timer too. */
const REPRICE_INTERVAL_MS = 30_000

/**
 * `paymentCode` never changes `totalSatang` (only `channelFeeSatang`, which is per channel, not per payment method) —
 * 'cash' is a safe placeholder for a preview total before the cashier picks how the customer pays; `recordSale` always
 * sends the real payment code.
 */
const PREVIEW_PAYMENT_CODE = 'cash'

/** Prices the cart with dayo's own code (`priceCart`) — the screen never adds money itself. Re-prices on every cart
 * change, on every catalog change (the caller passes a fresh `catalog` reference after a refetch), and every 30 s
 * (spec §6.5, §4.4 rule 4). */
export function usePricedCart(state: CartState, catalog: PosOrderCatalog | undefined): { priced: PricedCart | null; error: string | null } {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), REPRICE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])
  return useMemo(() => {
    if (catalog === undefined || state.lines.length === 0) return { priced: null, error: null }
    try {
      const priced = priceCart({ ...toCartDraft(state), paymentCode: PREVIEW_PAYMENT_CODE }, catalog, new Date().toISOString())
      return { priced, error: null }
    } catch (e) {
      if (e instanceof CartError) return { priced: null, error: e.message }
      throw e
    }
  }, [state, catalog, tick])
}
