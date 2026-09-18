import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useApi } from '../app/api-context'
import { ordersKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'

const TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })

export function OrdersScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const orders = useQuery({ queryKey: ordersKey, queryFn: () => api.listOrders() })
  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-sell" onClick={() => void navigate({ to: '/sell' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.orders}</h1>
      {orders.isError && (
        <p role="alert" className="error">
          {errorMessage(orders.error)}
        </p>
      )}
      {orders.data?.length === 0 && <p>{TH.noOrders}</p>}
      <div className="list">
        {orders.data?.map((o) => (
          <button
            key={o.id}
            type="button"
            className="row"
            data-testid={`order-row-${o.receiptNo}`}
            data-status={o.status}
            onClick={() => void navigate({ to: '/orders/$orderId', params: { orderId: o.id } })}
          >
            <strong>
              {TH.queue} {o.queueNo}
            </strong>
            <span>
              {o.receiptNo} · {TIME.format(new Date(o.paidAt))} · {o.cups} แก้ว · {o.method === 'CASH' ? TH.methodCash : TH.methodPromptPay}
            </span>
            <span>{formatBaht(o.totalSatang)}</span>
            <span className={o.status === 'voided' ? 'error' : 'badge'}>{o.status === 'voided' ? TH.statusVoided : TH.statusPaid}</span>
          </button>
        ))}
      </div>
    </main>
  )
}
