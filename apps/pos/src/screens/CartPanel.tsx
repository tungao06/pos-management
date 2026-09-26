import type { JSX } from 'react'
import { sumSatang, type PosOrderCatalog, type PricedLine } from '@dayo/domain'
import { usePricedCart } from '../app/use-priced-cart'
import { useCart } from '../app/cart-context'
import type { CartLine } from '../state/cart'
import { cartErrorMessage } from '../ui/errors'
import { formatBaht, formatBahtFull } from '../ui/format'
import { TH } from '../ui/th'
import { PromoPanel } from './PromoPanel'

const sameCombo = (p: PricedLine, l: CartLine): boolean => p.code === l.code && p.size === l.size && p.sweetness === l.sweetness && p.milk === l.milk && p.grade === l.grade

export function CartPanel({
  catalog,
  channels,
  payments,
  maxQtyPerLine,
  onOpenDiscount,
  onPay,
}: {
  catalog: PosOrderCatalog | undefined
  channels: { code: string; name: string }[]
  payments: { cash: boolean; qr: boolean }
  maxQtyPerLine: number
  onOpenDiscount: () => void
  onPay: (method: 'CASH' | 'PROMPTPAY') => void
}): JSX.Element {
  const { state, dispatch, clear } = useCart()
  const { priced, error } = usePricedCart(state, catalog)
  const empty = state.lines.length === 0
  const canPay = priced !== null && priced.ok

  return (
    <aside className="cart" data-testid="cart">
      <h2>{TH.cart}</h2>
      <label>
        {TH.channel}
        <select data-testid="channel-select" value={state.channelCode} onChange={(e) => dispatch({ type: 'setChannel', channelCode: e.target.value })}>
          {channels.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {empty && <p>{TH.cartEmpty}</p>}
      {state.lines.map((l, i) => {
        // A promotion (e.g. buy-2-get-1) can split one cart line into a free priced line and a paid one — both share
        // this line's code/size/sweetness/milk/grade (only qty splits), so summing them back is exact, never a
        // hand-computed price (spec: "bills priced by dayo can split a line — display them as stored").
        const matched = priced?.lines.filter((p) => sameCombo(p, l)) ?? []
        const lineTotal = sumSatang(matched.map((p) => p.lineTotalSatang))
        return (
          <div key={l.key} className="cart-line" data-testid={`cart-line-${i}`}>
            <div>
              <strong>{l.nameTh}</strong>
              <div>
                {l.size} · {TH.sweetShort} {l.sweetness}
                {l.milk === 'oat' ? ` · ${TH.milkOat}` : ''}
                {l.grade !== null ? ` · ${l.grade}` : ''}
              </div>
            </div>
            <div>{matched.length > 0 ? formatBahtFull(lineTotal) : TH.noPrice}</div>
            <div className="qty">
              <button type="button" data-testid={`cart-dec-${i}`} onClick={() => dispatch({ type: 'dec', key: l.key })}>
                −
              </button>
              <span data-testid={`cart-qty-${i}`}>{l.qty}</span>
              <button type="button" data-testid={`cart-inc-${i}`} onClick={() => dispatch({ type: 'inc', key: l.key, maxQty: maxQtyPerLine })}>
                +
              </button>
              <button type="button" data-testid={`cart-remove-${i}`} onClick={() => dispatch({ type: 'remove', key: l.key })}>
                {TH.remove}
              </button>
            </div>
          </div>
        )
      })}
      <PromoPanel priced={priced} />
      {error !== null && (
        <p role="alert" className="error" data-testid="cart-error">
          {cartErrorMessage(error)}
        </p>
      )}
      {priced !== null && !priced.ok && (
        <p role="alert" className="error" data-testid="cart-warnings">
          {priced.warnings.join(' · ')}
        </p>
      )}
      <div className="totals">
        {priced !== null && (
          <>
            <div>
              {TH.subtotal} <span data-testid="cart-subtotal">{formatBahtFull(priced.itemsSubtotalSatang)}</span>
            </div>
            {state.billDiscount !== null && (
              <div>
                {TH.discount} ({state.billDiscount.reason}) <span data-testid="cart-discount">−{formatBahtFull(priced.billDiscountSatang)}</span>
              </div>
            )}
          </>
        )}
        <div className="total">
          {TH.total} <span data-testid="cart-total">{formatBahtFull(priced?.totalSatang ?? 0)}</span>
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
        {payments.cash && (
          <button type="button" className="primary" data-testid="pay-cash" disabled={!canPay} onClick={() => onPay('CASH')}>
            {TH.payCash}
          </button>
        )}
        {payments.qr && (
          <button type="button" className="primary" data-testid="pay-qr" disabled={!canPay || priced?.totalSatang === 0} onClick={() => onPay('PROMPTPAY')}>
            {TH.payQr}
          </button>
        )}
      </div>
    </aside>
  )
}
