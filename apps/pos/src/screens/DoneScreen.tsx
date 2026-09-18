import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, type JSX } from 'react'
import { useApi } from '../app/api-context'
import { orderKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'

/** spec §5: big queue number + items for the drink maker, closes itself after 5 s. On screen only, no paper (D48 Q3-5). */
export const DONE_AUTO_CLOSE_MS = 5_000

export function DoneScreen(): JSX.Element {
  const { orderId } = useSearch({ from: '/done' })
  const api = useApi()
  const navigate = useNavigate()
  const order = useQuery({ queryKey: orderKey(orderId), queryFn: () => api.getOrder(orderId), enabled: orderId !== '' })

  useEffect(() => {
    const timer = window.setTimeout(() => void navigate({ to: '/sell' }), DONE_AUTO_CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [navigate])

  if (order.isError) {
    return (
      <main className="done">
        <p role="alert" className="error">
          {errorMessage(order.error)}
        </p>
      </main>
    )
  }
  if (order.data === undefined) return <main className="done">{TH.loading}</main>
  const o = order.data
  return (
    <main className="done">
      <div>{TH.queue}</div>
      <div className="queue-no" data-testid="done-queue">
        {o.queueNo}
      </div>
      <div>
        {TH.receiptNo} <strong data-testid="done-receipt">{o.receiptNo}</strong>
      </div>
      {o.changeSatang !== null && (
        <div>
          {TH.change} <span className="big-amount" data-testid="done-change">{formatBaht(o.changeSatang)}</span>
        </div>
      )}
      <ol className="list">
        {o.lines.map((l, i) => (
          <li key={l.lineNo} data-testid={`done-line-${i}`}>
            {l.qty} × {l.productName} {l.sizeName} · {TH.sweetShort} {l.sweetnessName}
          </li>
        ))}
      </ol>
      <button type="button" className="primary" data-testid="done-new-sale" onClick={() => void navigate({ to: '/sell' })}>
        {TH.newSale}
      </button>
    </main>
  )
}
