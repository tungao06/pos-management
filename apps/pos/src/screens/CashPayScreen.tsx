import { useQuery } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import { cashChangeSatang, quickTenderOptions } from '@dayo/domain'
import { useApi } from '../app/api-context'
import { useCart } from '../app/cart-context'
import { sellCatalogKey } from '../app/queries'
import { useCommitSale } from '../app/use-commit-sale'
import { usePricedCart } from '../app/use-priced-cart'
import { cartErrorMessage, errorMessage } from '../ui/errors'
import { formatBaht, parseBahtInput } from '../ui/format'
import { TH } from '../ui/th'

/** spec §5: quick buttons exact / 50 / 100 / 500 / 1000 and a large change amount. Priced with dayo's own code
 * (`usePricedCart`) — never a hand-summed total. */
export function CashPayScreen(): JSX.Element {
  const api = useApi()
  const { state } = useCart()
  const navigate = useNavigate()
  const { pay, isPending, isSuccess, isError, error, priceChanged, confirmPriceChange } = useCommitSale()
  const catalogQuery = useQuery({ queryKey: sellCatalogKey, queryFn: () => api.loadSellCatalog() })
  const { priced, error: cartError } = usePricedCart(state, catalogQuery.data?.catalog)
  const [tenderText, setTenderText] = useState('')
  if (state.lines.length === 0 && !isPending && !isSuccess) return <Navigate to="/sell" />

  const total = priced?.totalSatang ?? 0
  const tendered = parseBahtInput(tenderText)
  const change = tendered !== null && tendered >= total ? cashChangeSatang(total, tendered) : null

  return (
    <main className="page">
      <h1>{TH.cashTitle}</h1>
      <div>
        {TH.total} <span className="big-amount" data-testid="cash-total">{formatBaht(total)}</span>
      </div>
      <div className="choices">
        {quickTenderOptions(total).map((amount, i) => (
          <button key={amount} type="button" data-testid={i === 0 ? 'tender-exact' : `tender-${amount / 100}`} onClick={() => setTenderText(String(amount / 100))}>
            {i === 0 ? TH.exact : formatBaht(amount)}
          </button>
        ))}
      </div>
      <label>
        {TH.tendered}
        <input data-testid="tender-input" inputMode="decimal" value={tenderText} onChange={(e) => setTenderText(e.target.value)} />
      </label>
      <div>
        {TH.change} <span className="big-amount" data-testid="cash-change">{change === null ? '–' : formatBaht(change)}</span>
      </div>
      {priceChanged !== null && (
        <p role="alert" className="error" data-testid="price-changed">
          {TH.priceChanged(formatBaht(priceChanged.shownSatang), formatBaht(priceChanged.nowSatang))}
        </p>
      )}
      {cartError !== null && (
        <p role="alert" className="error" data-testid="cart-error">
          {cartErrorMessage(cartError)}
        </p>
      )}
      {isError && priceChanged === null && (
        <p role="alert" className="error">
          {errorMessage(error)}
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
            data-testid="confirm-cash"
            disabled={change === null || tendered === null || isPending || priced === null || !priced.ok}
            onClick={() => tendered !== null && priced !== null && void pay({ method: 'CASH', tenderedSatang: tendered }, priced.totalSatang)}
          >
            {TH.confirmCash}
          </button>
        )}
      </div>
    </main>
  )
}
