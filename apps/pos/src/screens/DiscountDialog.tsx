import { useState, type JSX } from 'react'
import type { PosOrderCatalog } from '@dayo/domain'
import { REASON_MAX_LENGTH } from '../api/types'
import { useCart } from '../app/cart-context'
import { usePricedCart } from '../app/use-priced-cart'
import { parseBahtInput } from '../ui/format'
import { TH } from '../ui/th'

/** Bill-level amount discount with a mandatory reason (spec §1.2, §3.4 · D48 Q3-6). The bound is dayo's own
 * `itemsSubtotalSatang` (after item-level discounts/promotions), never a hand-summed one. */
export function DiscountDialog({ catalog, onClose }: { catalog: PosOrderCatalog | undefined; onClose: () => void }): JSX.Element {
  const { state, dispatch } = useCart()
  const { priced } = usePricedCart(state, catalog)
  const [amountText, setAmountText] = useState(state.billDiscount === null ? '' : String(state.billDiscount.satang / 100))
  const [reason, setReason] = useState(state.billDiscount?.reason ?? '')
  const [error, setError] = useState<string | null>(null)

  const apply = (): void => {
    const satang = parseBahtInput(amountText)
    if (satang === null || satang <= 0) return setError(TH.errBadInput)
    // minor (review round 1): a null priced cart (no catalog yet, or the cart itself refuses to price) is a
    // different problem from a discount that is simply too big — say so instead of reusing errDiscountTooBig.
    if (priced === null) return setError(TH.errCartNotPriced)
    if (satang >= priced.itemsSubtotalSatang) return setError(TH.errDiscountTooBig) // total stays > 0 (D50 Q3-20)
    if (reason.trim() === '') return setError(TH.errReasonRequired)
    dispatch({ type: 'setDiscount', satang, reason })
    onClose()
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-label={TH.discountTitle}>
      <div className="dialog">
        <h2>{TH.discountTitle}</h2>
        <label>
          {TH.discountAmount}
          <input data-testid="discount-amount" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </label>
        <label>
          {TH.discountReason}
          <input data-testid="discount-reason" maxLength={REASON_MAX_LENGTH} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          {state.billDiscount !== null && (
            <button
              type="button"
              data-testid="discount-remove"
              onClick={() => {
                dispatch({ type: 'clearDiscount' })
                onClose()
              }}
            >
              {TH.discountRemove}
            </button>
          )}
          <button type="button" onClick={onClose}>
            {TH.cancel}
          </button>
          <button type="button" className="primary" data-testid="discount-apply" onClick={apply}>
            {TH.discountApply}
          </button>
        </div>
      </div>
    </div>
  )
}
