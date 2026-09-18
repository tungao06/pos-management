import type { JSX } from 'react'
import { useCart } from '../app/cart-context'
import { cartTotals } from '../state/cart'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'

export function CartPanel({ onPay, onOpenDiscount }: { onPay: (method: 'CASH' | 'PROMPTPAY') => void; onOpenDiscount: () => void }): JSX.Element {
  const { state, dispatch, clear } = useCart()
  const totals = cartTotals(state)
  const empty = state.lines.length === 0
  return (
    <aside className="cart" data-testid="cart">
      <h2>{TH.cart}</h2>
      {empty && <p>{TH.cartEmpty}</p>}
      {state.lines.map((l, i) => (
        <div key={l.key} className="cart-line" data-testid={`cart-line-${i}`}>
          <div>
            <strong>{l.productName}</strong>
            <div>
              {l.sizeName} · {TH.sweetShort} {l.sweetnessName}
            </div>
          </div>
          <div>{formatBaht(totals.lineTotals[i]!)}</div> {/* M4: domain total, not a hand-multiplied one */}
          <div className="qty">
            <button type="button" data-testid={`cart-dec-${i}`} onClick={() => dispatch({ type: 'dec', key: l.key })}>
              −
            </button>
            <span data-testid={`cart-qty-${i}`}>{l.qty}</span>
            <button type="button" data-testid={`cart-inc-${i}`} onClick={() => dispatch({ type: 'inc', key: l.key })}>
              +
            </button>
          </div>
        </div>
      ))}
      <div className="totals">
        <div>
          {TH.subtotal} <span data-testid="cart-subtotal">{formatBaht(totals.subtotalSatang)}</span>
        </div>
        {state.discount !== null && (
          <div>
            {TH.discount} ({state.discount.reason}) <span data-testid="cart-discount">−{formatBaht(state.discount.amountSatang)}</span>
          </div>
        )}
        <div className="total">
          {TH.total} <span data-testid="cart-total">{formatBaht(totals.totalSatang)}</span>
        </div>
      </div>
      <div className="choices">
        <button type="button" data-testid="discount-open" disabled={empty} onClick={onOpenDiscount}>
          {TH.discount}
        </button>
        <button type="button" data-testid="cart-clear" disabled={empty} onClick={clear}>
          {TH.clearCart}
        </button>
      </div>
      <div className="pay">
        <button type="button" className="primary" data-testid="pay-cash" disabled={empty} onClick={() => onPay('CASH')}>
          {TH.payCash}
        </button>
        <button type="button" className="primary" data-testid="pay-qr" disabled={empty || totals.totalSatang === 0} onClick={() => onPay('PROMPTPAY')}>
          {TH.payQr}
        </button>
      </div>
    </aside>
  )
}
