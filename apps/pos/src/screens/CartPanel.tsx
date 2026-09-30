import { useEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import { CartError, checkLine, maxQtyPerLineOf, sumSatang, type CartLineDraft, type PosOrderCatalog, type PricedLine } from '@dayo/domain'
import { usePricedCart } from '../app/use-priced-cart'
import { zeroVerdictOf } from '../app/zero-bill'
import { useCart } from '../app/cart-context'
import type { CartLine } from '../state/cart'
import { cartErrorMessage } from '../ui/errors'
import { formatBahtFull } from '../ui/format'
import { TH } from '../ui/th'
import { PromoPanel } from './PromoPanel'

const sameCombo = (p: PricedLine, l: CartLine): boolean => p.code === l.code && p.size === l.size && p.sweetness === l.sweetness && p.milk === l.milk && p.grade === l.grade

/** Every check one cart line fails on its own (review I5) — `null` when it is fine. Never throws: `checkLine` only
 * ever throws `CartError`, and this is the one place that catches it — the `CartError` itself (never a stringified
 * message) is what `cartErrorMessage` reads, for both this line's own label and the combined banner below (review
 * round 2 item 4: the same function, so the two can never disagree about the same error). */
function lineError(catalog: PosOrderCatalog, l: CartLine, i: number, maxQty: number): CartError | null {
  const draft: CartLineDraft = { code: l.code, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty, free: false, discountSatang: null, discountPercent: null, discountReason: null }
  try {
    checkLine(catalog, draft, i, maxQty)
    return null
  } catch (e) {
    if (e instanceof CartError) return e
    throw e
  }
}

export function CartPanel({
  catalog,
  channels,
  payments,
  maxQtyPerLine,
  onOpenDiscount,
  onPay,
  manualSupported = false,
}: {
  catalog: PosOrderCatalog | undefined
  channels: { code: string; name: string }[]
  payments: { cash: boolean; qr: boolean }
  maxQtyPerLine: number
  onOpenDiscount: () => void
  onPay: (method: 'CASH' | 'PROMPTPAY') => void
  /** dayo takes manual promotions (E1 supported_fields.order has manual_promotion_ids) — else the picker is hidden. */
  manualSupported?: boolean
}): JSX.Element {
  const { state, dispatch, clear } = useCart()
  const { priced, error } = usePricedCart(state, catalog)
  const empty = state.lines.length === 0
  // review I4: dayo's own pricing never goes negative — a bill discount left at/above the subtotal just clamps the
  // total to ฿0 with `priced.ok` still true. D124 · Q1 = ข: a ฿0 bill is sold only when it comes from promotions (the
  // domain's `zeroTotalVerdict`), with a reason when one is asked for, and paid in cash only — never by QR.
  const verdict = empty ? 'ok' : zeroVerdictOf(state, priced)
  const isZero = priced !== null && priced.totalSatang === 0 && !empty
  const canPay = priced !== null && priced.ok && (priced.totalSatang > 0 || verdict === 'ok')
  const canPayQr = canPay && !isZero
  const zeroTotal = isZero && verdict === 'ZERO_TOTAL_NOT_ALLOWED'
  const zeroCashOnly = isZero && canPay
  const billDiscountTooBig = zeroTotal && state.billDiscount !== null
  const lineErrors = state.lines.map((l, i) => (catalog === undefined ? null : lineError(catalog, l, i, maxQtyPerLineOf(catalog))))
  const hasProblem = error !== null || (priced !== null && !priced.ok) || zeroTotal || (isZero && verdict === 'MANUAL_REASON_REQUIRED') || lineErrors.some((e) => e !== null)
  const cups = state.lines.reduce((n, l) => n + l.qty, 0)
  const channelName = channels.find((c) => c.code === state.channelCode)?.name ?? state.channelCode

  // Phones only (styles.css hides the handle elsewhere): the cart is a bottom sheet — collapsed it shows just the
  // total and pay buttons under the menu, expanded it slides up over the menu to show every line. Tap or swipe the
  // handle; an emptied cart folds itself back down.
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (empty) setExpanded(false)
  }, [empty])
  const swipeStart = useRef<number | null>(null)
  const swiped = useRef(false)
  const onHandleUp = (e: PointerEvent<HTMLButtonElement>): void => {
    const start = swipeStart.current
    swipeStart.current = null
    if (start === null) return
    const dy = e.clientY - start
    if (Math.abs(dy) < 24) return
    swiped.current = true
    setExpanded(dy < 0 && !empty)
  }

  return (
    <aside className="cart" data-testid="cart" data-expanded={expanded}>
      <button
        type="button"
        className="cart-toggle"
        data-testid="cart-toggle"
        aria-expanded={expanded}
        onPointerDown={(e) => {
          swipeStart.current = e.clientY
        }}
        onPointerUp={onHandleUp}
        onClick={() => {
          if (swiped.current) {
            swiped.current = false
            return
          }
          if (!empty || expanded) setExpanded((v) => !v)
        }}
      >
        <span className="grip" aria-hidden="true" />
        <span className="summary">
          <strong>{TH.cart}</strong> · {TH.cartCups(cups)} · {channelName}
        </span>
        <span className="cue">{expanded ? TH.cartCollapse : TH.cartExpand}</span>
        {hasProblem && <span className="error">{TH.cartCheck}</span>}
      </button>
      <div className="cart-head">
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
      </div>
      {/* only this part scrolls — the totals and pay buttons below stay on screen however long the bill gets */}
      <div className="cart-body">
        {empty && <p>{TH.cartEmpty}</p>}
        {state.lines.map((l, i) => {
          // A promotion (e.g. buy-2-get-1) can split one cart line into a free priced line and a paid one — both share
          // this line's code/size/sweetness/milk/grade (only qty splits), so summing them back is exact, never a
          // hand-computed price (spec: "bills priced by dayo can split a line — display them as stored").
          const matched = priced?.lines.filter((p) => sameCombo(p, l)) ?? []
          const lineTotal = sumSatang(matched.map((p) => p.lineTotalSatang))
          const freeQty = sumSatang(matched.filter((p) => p.promotionId !== null && p.lineTotalSatang === 0).map((p) => p.qty))
          // a promotion can split one line by promo (and a cup two promos share): each discounted part is shown as priced
          const discounted = matched.filter((p) => p.promotionId !== null && p.discountPerCupSatang > 0)
          const promoName = (id: string): string => priced?.promotionsApplied.find((a) => a.promotionId === id)?.name ?? id
          const badLine = lineErrors[i] ?? null
          return (
            <div key={l.key} className="cart-line" data-testid={`cart-line-${i}`}>
              <div>
                <strong>{l.nameTh}</strong>
                <div>
                  {l.size} · {TH.sweetShort} {l.sweetness}
                  {l.milk === 'oat' ? ` · ${TH.milkOat}` : ''}
                  {l.grade !== null ? ` · ${l.grade}` : ''}
                  {freeQty > 0 && ` · ${TH.freeUnits(freeQty)}`}
                </div>
                {discounted.map((p, j) => (
                  <div key={j} className="line-discount" data-testid={`cart-line-discount-${i}-${j}`}>
                    {discounted.length > 1 && `${TH.cupsWith(p.qty)}: `}
                    {TH.perCupDiscount(formatBahtFull(p.discountPerCupSatang))}
                    {p.promoBreakdown !== null && p.promoBreakdown.length >= 2 && (
                      <ul className="promo-breakdown" data-testid={`cart-line-breakdown-${i}-${j}`}>
                        {p.promoBreakdown.map((b) => (
                          <li key={b.promotionId}>
                            {promoName(b.promotionId)} −{formatBahtFull(b.satang)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                {badLine !== null && (
                  <p role="alert" className="error" data-testid={`cart-line-error-${i}`}>
                    {cartErrorMessage(badLine)}
                  </p>
                )}
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
        <PromoPanel priced={priced} catalog={catalog} manualSupported={manualSupported} />
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
        {billDiscountTooBig && (
          <p role="alert" className="error" data-testid="cart-discount-too-big">
            {TH.errBillDiscountTooBig}
          </p>
        )}
        {zeroTotal && !billDiscountTooBig && (
          <p role="alert" className="error" data-testid="cart-zero-total">
            {TH.errZeroTotal}
          </p>
        )}
        {zeroCashOnly && (
          <p className="badge" data-testid="cart-zero-cash-only">
            {TH.zeroBillCashOnly}
          </p>
        )}
      </div>
      <div className="cart-foot">
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
            <button type="button" className="primary" data-testid="pay-qr" disabled={!canPayQr} onClick={() => onPay('PROMPTPAY')}>
              {TH.payQr}
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
