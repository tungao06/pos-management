import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { JSX } from 'react'
import { posErrorCode } from '../api/errors'
import { useApi } from '../app/api-context'
import { centralOrdersKey } from '../app/queries'
import { useDayoEditsRefresh } from '../app/useDayoEditsRefresh'
import { errorMessage } from '../ui/errors'
import { formatBahtFull } from '../ui/format'
import { TH } from '../ui/th'

const TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })

/**
 * spec §4.6: today's bot/web bills — read only, against double entry (Q44 · every role reads it). Online only: the
 * screen fetches when it opens and every 5 minutes while open (`refetchInterval`); the network wait for E3 is
 * outside the serial queue, so this never blocks a sale on another tab of the same tablet.
 */
export function CentralOrdersScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const orders = useQuery({ queryKey: centralOrdersKey, queryFn: () => api.listCentralOrdersToday(), refetchInterval: 300_000 })
  useDayoEditsRefresh(() => queryClient.invalidateQueries({ queryKey: centralOrdersKey }))
  const offline = orders.isError && posErrorCode(orders.error) === 'OFFLINE'
  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-orders-back" onClick={() => void navigate({ to: '/orders' })}>
          {TH.back}
        </button>
        <button type="button" data-testid="central-orders-refresh" onClick={() => void orders.refetch()}>
          {TH.centralOrdersRefresh}
        </button>
      </div>
      <h1>{TH.centralOrdersTitle}</h1>
      {orders.isError && (
        <p role="alert" className={offline ? undefined : 'error'}>
          {offline ? TH.centralOrdersOffline : errorMessage(orders.error)}
        </p>
      )}
      {orders.data?.length === 0 && <p>{TH.centralOrdersEmpty}</p>}
      <div className="list">
        {orders.data?.map((o) => (
          <div key={o.orderNo} className="row" data-testid={`central-order-${o.orderNo}`}>
            <span>
              {o.sourceLabel} · {o.createdByName ?? TH.centralOrdersUnknownBy} · {o.soldAt !== null ? TIME.format(new Date(o.soldAt)) : '—'} · {formatBahtFull(o.totalSatang)}
            </span>
            {o.duplicateSuspect && <span className="badge">{TH.centralOrdersDuplicate}</span>}
          </div>
        ))}
      </div>
    </main>
  )
}
