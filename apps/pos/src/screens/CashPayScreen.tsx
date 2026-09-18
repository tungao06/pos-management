import { Navigate, useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import { cashChangeSatang, quickTenderOptions } from '@dayo/domain'
import { useCart } from '../app/cart-context'
import { useCommitSale } from '../app/use-commit-sale'
import { cartTotals } from '../state/cart'
import { errorMessage } from '../ui/errors'
import { formatBaht, parseBahtInput } from '../ui/format'
import { TH } from '../ui/th'

/** spec §5: quick buttons exact / 50 / 100 / 500 / 1000 and a large change amount. */
export function CashPayScreen(): JSX.Element {
  const { state } = useCart()
  const navigate = useNavigate()
  const { pay, priceChange } = useCommitSale()
  const [tenderText, setTenderText] = useState('')
  if (state.lines.length === 0 && !pay.isPending && !pay.isSuccess) return <Navigate to="/sell" />

  const total = cartTotals(state).totalSatang
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
      {priceChange !== null && (
        <p role="alert" className="error" data-testid="price-changed">
          {TH.priceChanged(formatBaht(priceChange.fromSatang), formatBaht(priceChange.toSatang))}
        </p>
      )}
      {pay.isError && priceChange === null && (
        <p role="alert" className="error">
          {errorMessage(pay.error)}
        </p>
      )}
      <div className="actions">
        <button type="button" data-testid="pay-back" onClick={() => void navigate({ to: '/sell' })}>
          {TH.back}
        </button>
        <button
          type="button"
          className="primary"
          data-testid="confirm-cash"
          disabled={change === null || tendered === null || pay.isPending}
          onClick={() => tendered !== null && pay.mutate({ method: 'CASH', tenderedSatang: tendered })}
        >
          {TH.confirmCash}
        </button>
      </div>
    </main>
  )
}
