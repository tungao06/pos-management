import { useQuery } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import QRCode from 'qrcode'
import type { JSX } from 'react'
import { useApi } from '../app/api-context'
import { useCart } from '../app/cart-context'
import { useCommitSale } from '../app/use-commit-sale'
import { cartTotals } from '../state/cart'
import { errorMessage } from '../ui/errors'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'

/** spec §5: full-screen PromptPay QR with the bill amount, confirmed by eye (D48 Q3-4). */
export function QrPayScreen(): JSX.Element {
  const api = useApi()
  const { state } = useCart()
  const navigate = useNavigate()
  const { pay, priceChange } = useCommitSale()
  const total = cartTotals(state).totalSatang // after a PRICE_CHANGED re-price the QR below is rebuilt for the new total
  const payload = useQuery({ queryKey: ['promptpay', total], queryFn: () => api.promptPayForAmount(total), enabled: total > 0 })
  const image = useQuery({
    queryKey: ['qr-image', payload.data],
    queryFn: () => QRCode.toDataURL(payload.data ?? '', { margin: 2, width: 560, errorCorrectionLevel: 'M' }),
    enabled: payload.data !== undefined,
  })
  if (state.lines.length === 0 && !pay.isPending && !pay.isSuccess) return <Navigate to="/sell" />

  const error = payload.error ?? image.error ?? (priceChange === null ? pay.error : null)
  return (
    <main className="page qr">
      <h1>{TH.qrTitle}</h1>
      <div className="big-amount" data-testid="qr-total">
        {formatBaht(total)}
      </div>
      {image.data !== undefined && payload.data !== undefined && <img data-testid="qr-image" data-payload={payload.data} src={image.data} alt={TH.qrTitle} />}
      {priceChange !== null && (
        <p role="alert" className="error" data-testid="price-changed">
          {TH.priceChanged(formatBaht(priceChange.fromSatang), formatBaht(priceChange.toSatang))} {TH.qrRescan}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {errorMessage(error)}
        </p>
      )}
      <div className="actions">
        <button type="button" data-testid="pay-back" onClick={() => void navigate({ to: '/sell' })}>
          {TH.back}
        </button>
        <button type="button" className="primary" data-testid="qr-received" disabled={payload.data === undefined || pay.isPending} onClick={() => pay.mutate({ method: 'PROMPTPAY' })}>
          {TH.qrReceived}
        </button>
      </div>
    </main>
  )
}
