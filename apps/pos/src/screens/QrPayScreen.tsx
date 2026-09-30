import { useQuery } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import QRCode from 'qrcode'
import type { JSX } from 'react'
import { useApi } from '../app/api-context'
import { useCart } from '../app/cart-context'
import { sellCatalogKey } from '../app/queries'
import { useCommitSale } from '../app/use-commit-sale'
import { usePricedCart } from '../app/use-priced-cart'
import { cartErrorMessage, errorMessage } from '../ui/errors'
import { formatBahtFull } from '../ui/format'
import { TH } from '../ui/th'

/** spec §5: full-screen PromptPay QR with the bill amount, confirmed by eye (D48 Q3-4). Priced with dayo's own code
 * (`usePricedCart`); a PRICE_CHANGED refetches the catalog first (C1) so the QR below rebuilds for the new total,
 * with a freshly generated payload (the `['promptpay', total]` query key changes with it). */
export function QrPayScreen(): JSX.Element {
  const api = useApi()
  const { state } = useCart()
  const navigate = useNavigate()
  const { pay, isPending, isSuccess, isError, error, priceChanged, priceBump } = useCommitSale()
  const catalogQuery = useQuery({ queryKey: sellCatalogKey, queryFn: () => api.loadSellCatalog() })
  const { priced, error: cartError } = usePricedCart(state, catalogQuery.data?.catalog, priceBump)
  const isZero = priced !== null && priced.totalSatang === 0 // D124 · Q1 = ข: a ฿0 bill is cash only
  const total = priced?.totalSatang ?? 0 // after a PRICE_CHANGED re-price the QR below is rebuilt for the new total
  const payload = useQuery({ queryKey: ['promptpay', total], queryFn: () => api.promptPayForAmount(total), enabled: total > 0 })
  const image = useQuery({
    queryKey: ['qr-image', payload.data],
    queryFn: () => QRCode.toDataURL(payload.data ?? '', { margin: 2, width: 560, errorCorrectionLevel: 'M' }),
    enabled: payload.data !== undefined,
  })
  if (state.lines.length === 0 && !isPending && !isSuccess) return <Navigate to="/sell" />

  const commitError = payload.error ?? image.error ?? (priceChanged === null && isError ? error : null)
  return (
    <main className="page qr">
      <h1>{TH.qrTitle}</h1>
      <div className="big-amount" data-testid="qr-total">
        {formatBahtFull(total)}
      </div>
      {isZero && (
        <p role="alert" className="error" data-testid="zero-bill-cash-only">
          {TH.zeroBillCashOnly}
        </p>
      )}
      {image.data !== undefined && payload.data !== undefined && <img data-testid="qr-image" data-payload={payload.data} src={image.data} alt={TH.qrTitle} />}
      {priceChanged !== null && (
        <p role="alert" className="error" data-testid="price-changed">
          {TH.priceChanged(formatBahtFull(priceChanged.shownSatang), formatBahtFull(priceChanged.nowSatang))} {TH.qrRescan}
        </p>
      )}
      {cartError !== null && (
        <p role="alert" className="error" data-testid="cart-error">
          {cartErrorMessage(cartError)}
        </p>
      )}
      {commitError !== null && commitError !== undefined && (
        <p role="alert" className="error">
          {errorMessage(commitError)}
        </p>
      )}
      <div className="actions sticky-foot">
        <button type="button" data-testid="pay-back" onClick={() => void navigate({ to: '/sell' })}>
          {TH.back}
        </button>
        {priceChanged !== null ? (
          // review I3/C1: resends with the fresh total (`priced.totalSatang`, already re-priced from the refetched
          // catalog), never the stale `priceChanged.nowSatang` captured at the moment of the first refusal.
          // Round 2 item 1: also waits for `priced.totalSatang` to actually equal `priceChanged.nowSatang` (`priceBump`
          // forces the recompute right away, but the button still waits for it to have landed) — never sends before
          // the new QR (still loading below) matches what recordSale will price. Round 2 item 2: same guard as
          // `qr-received` (payload ready, `priced.ok`), so this button can never fire on a bad/still-loading price.
          <button
            type="button"
            className="primary"
            data-testid="price-changed-confirm"
            disabled={isPending || priced === null || !priced.ok || isZero || payload.data === undefined || priced.totalSatang !== priceChanged.nowSatang}
            onClick={() => priced !== null && void pay({ method: 'PROMPTPAY' }, priced.totalSatang)}
          >
            {TH.priceChangedConfirm}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            data-testid="qr-received"
            disabled={payload.data === undefined || isPending || priced === null || !priced.ok || isZero}
            onClick={() => priced !== null && void pay({ method: 'PROMPTPAY' }, priced.totalSatang)}
          >
            {TH.qrReceived}
          </button>
        )}
      </div>
    </main>
  )
}
