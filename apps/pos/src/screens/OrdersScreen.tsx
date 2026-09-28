import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useApi } from '../app/api-context'
import { ordersKey } from '../app/queries'
import { useDayoEditsRefresh } from '../app/useDayoEditsRefresh'
import { errorMessage } from '../ui/errors'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'
import { CentralStateChip } from './CentralStateChip'

const TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })

/** spec §4.6, §9 ก้อน 2 ("ประวัติบิล"): every bill says where it was recorded (soldByName, D61) and how dayo has it
 * (CentralStateChip) — dayo_edit refreshes on open and every 5 minutes while this page stays open (O1 pending). */
export function OrdersScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const orders = useQuery({ queryKey: ordersKey, queryFn: () => api.listOrders() })
  useDayoEditsRefresh(() => queryClient.invalidateQueries({ queryKey: ordersKey }))
  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-sell" onClick={() => void navigate({ to: '/sell' })}>
          {TH.back}
        </button>
        <button type="button" data-testid="nav-central-orders" onClick={() => void navigate({ to: '/central-orders' })}>
          {TH.navCentralOrders}
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
            className="row order-row"
            data-testid={`order-row-${o.receiptNo}`}
            data-status={o.status}
            onClick={() => void navigate({ to: '/orders/$orderId', params: { orderId: o.id } })}
          >
            <strong>
              {TH.queue} {o.queueNo}
            </strong>
            <span>
              {o.receiptNo} · {TIME.format(new Date(o.paidAt))} · {o.cups} แก้ว · {o.method === 'CASH' ? TH.methodCash : TH.methodPromptPay} · แท็บเล็ต · {o.soldByName}
            </span>
            <span>{formatBaht(o.totalSatang)}</span>
            <span className={o.status === 'voided' ? 'error' : 'badge'}>{o.status === 'voided' ? TH.statusVoided : TH.statusPaid}</span>
            <CentralStateChip central={o.central} />
            {o.dayoEdit !== null && (
              <span data-testid="order-dayo-edit-chip" className="chip chip-orange">
                {o.dayoEdit.kind === 'cancel' ? TH.orderDayoEditChipCancel : TH.orderDayoEditChipEdit}
              </span>
            )}
          </button>
        ))}
      </div>
    </main>
  )
}
