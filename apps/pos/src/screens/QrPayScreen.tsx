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
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'

/** spec §5: full-screen PromptPay QR with the bill amount, confirmed by eye (D48 Q3-4). Priced with dayo's own code
 * (`usePricedCart`); a PRICE_CHANGED rebuilds the QR for the new total (D50 Q3-27). */
export function QrPayScreen(): JSX.Element {
  const api = useApi()
  const { state } = useCart()
  const navigate = useNavigate()
  const { pay, isPending, isSuccess, isError, error, priceChanged, confirmPriceChange } = useCommitSale()
  const catalogQuery = useQuery({ queryKey: sellCatalogKey, queryFn: () => api.loadSellCatalog() })
  const { priced, error: cartError } = usePricedCart(state, catalogQuery.data?.catalog)
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
        {formatBaht(total)}
      </div>
      {image.data !== undefined && payload.data !== undefined && <img data-testid="qr-image" data-payload={payload.data} src={image.data} alt={TH.qrTitle} />}
      {priceChanged !== null && (
        <p role="alert" className="error" data-testid="price-changed">
          {TH.priceChanged(formatBaht(priceChanged.shownSatang), formatBaht(priceChanged.nowSatang))} {TH.qrRescan}
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
      <div className="actions">
        <button type="button" data-testid="pay-back" onClick={() => void navigate({ to: '/sell' })}>
          {TH.back}
        </button>
        {priceChanged !== null ? (
          <button type="button" className="primary" data-testid="price-changed-confirm" disabled={isPending} onClick={() => void confirmPriceChange()}>
            {TH.priceChangedConfirm}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            data-testid="qr-received"
            disabled={payload.data === undefined || isPending || priced === null || !priced.ok}
            onClick={() => priced !== null && void pay({ method: 'PROMPTPAY' }, priced.totalSatang)}
          >
            {TH.qrReceived}
          </button>
        )}
      </div>
    </main>
  )
}
