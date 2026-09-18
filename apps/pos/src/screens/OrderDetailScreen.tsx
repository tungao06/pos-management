import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import { useApi } from '../app/api-context'
import { orderKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'
import { VoidDialog } from './VoidDialog'

const TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function OrderDetailScreen(): JSX.Element {
  const { orderId } = useParams({ from: '/orders/$orderId' })
  const api = useApi()
  const navigate = useNavigate()
  const order = useQuery({ queryKey: orderKey(orderId), queryFn: () => api.getOrder(orderId) })
  const [voiding, setVoiding] = useState(false)

  if (order.isError) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(order.error)}
        </p>
      </main>
    )
  }
  if (order.data === undefined) return <main className="page">{TH.loading}</main>
  const o = order.data
  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-orders-back" onClick={() => void navigate({ to: '/orders' })}>
          {TH.back}
        </button>
      </div>
      <h1>
        {o.receiptNo} · {TH.queue} {o.queueNo}
      </h1>
      <p data-testid="order-status" data-status={o.status} className={o.status === 'voided' ? 'error' : undefined}>
        {o.status === 'voided' ? TH.statusVoided : TH.statusPaid}
      </p>
      <h2>{TH.lines}</h2>
      <ol className="list">
        {o.lines.map((l, i) => (
          <li key={l.lineNo} data-testid={`order-line-${i}`}>
            {l.qty} × {l.productName} {l.sizeName} · {TH.sweetShort} {l.sweetnessName} — {formatBaht(l.lineTotalSatang)}
          </li>
        ))}
      </ol>
      <div className="totals">
        <div>
          {TH.subtotal} {formatBaht(o.subtotalSatang)}
        </div>
        {o.discountSatang > 0 && (
          <div>
            {TH.discount} ({o.discountReason}) −{formatBaht(o.discountSatang)}
          </div>
        )}
        <div className="total">
          {TH.total} {formatBaht(o.totalSatang)}
        </div>
      </div>
      <h2>{TH.payment}</h2>
      <p>
        {o.method === 'CASH' ? TH.methodCash : TH.methodPromptPay}
        {o.tenderedSatang !== null && ` · ${TH.tendered} ${formatBaht(o.tenderedSatang)} · ${TH.change} ${formatBaht(o.changeSatang ?? 0)}`}
      </p>
      <h2>{TH.events}</h2>
      <ol className="list">
        {o.events.map((e) => (
          <li key={e.seq} data-testid={`event-${e.seq}`}>
            {TIME.format(new Date(e.at))} · {e.type}
          </li>
        ))}
      </ol>
      {o.voidable && (
        <button type="button" data-testid="void-open" onClick={() => setVoiding(true)}>
          {TH.voidOrder}
        </button>
      )}
      {voiding && <VoidDialog order={o} onClose={() => setVoiding(false)} />}
    </main>
  )
}
