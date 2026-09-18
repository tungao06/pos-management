import { useState, type JSX } from 'react'
import { useCart } from '../app/cart-context'
import { cartSubtotalSatang } from '../state/cart'
import { parseBahtInput } from '../ui/format'
import { TH } from '../ui/th'

/** Bill-level amount discount with a mandatory reason (spec §1.2, §3.4 · D48 Q3-6). */
export function DiscountDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { state, dispatch } = useCart()
  const [amountText, setAmountText] = useState(state.discount === null ? '' : String(state.discount.amountSatang / 100))
  const [reason, setReason] = useState(state.discount?.reason ?? '')
  const [error, setError] = useState<string | null>(null)

  const apply = (): void => {
    const amountSatang = parseBahtInput(amountText)
    if (amountSatang === null || amountSatang <= 0) return setError(TH.errBadInput)
    if (amountSatang >= cartSubtotalSatang(state)) return setError(TH.errDiscountTooBig) // total stays > 0 (D50 Q3-20)
    if (reason.trim() === '') return setError(TH.errReasonRequired)
    dispatch({ type: 'setDiscount', discount: { amountSatang, reason } })
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
          <input data-testid="discount-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          {state.discount !== null && (
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
