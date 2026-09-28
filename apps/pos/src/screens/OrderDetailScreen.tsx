import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import type { DayoEditDto } from '../api/types'
import { useApi } from '../app/api-context'
import { can } from '../app/permissions'
import { orderKey } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { formatBaht, formatBahtDiff, formatBahtFull } from '../ui/format'
import { TH } from '../ui/th'
import { CentralStateChip } from './CentralStateChip'
import { VoidDialog } from './VoidDialog'

const TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const EDIT_TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** spec §4.6, §4.7 · O1 pending: dayo_edit read only — never dayo's new total (that is still O1). */
function dayoEditText(edit: DayoEditDto): string {
  const kindText = edit.kind === 'edit' ? TH.dayoEditKindEdit : edit.kind === 'cancel' ? TH.dayoEditKindCancel : TH.dayoEditKindOther
  const parts = [kindText, EDIT_TIME.format(new Date(edit.editedAt))]
  if (edit.editedByName !== null) parts.push(edit.editedByName)
  if (edit.reason !== null) parts.push(TH.dayoEditReason(edit.reason))
  return parts.join(' · ')
}

export function OrderDetailScreen(): JSX.Element {
  const { orderId } = useParams({ from: '/orders/$orderId' })
  const api = useApi()
  const navigate = useNavigate()
  const { user } = useSession()
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
  // Q44 · ruling R11: owner voids any bill (void_any) · staff/manager only their own (void_own) · either way the
  // DTO's own `voidable` (false once dayo reports this bill cancelled on its web) is checked again here — a screen
  // must never offer a void ADR-0050 already knows will be refused.
  const mayVoid = o.voidable && o.dayoEdit?.kind !== 'cancel' && user !== null && (can(user.role, 'void_any') || (o.soldById === user.id && can(user.role, 'void_own')))
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
      {o.dayoEdit !== null && (
        <p data-testid="order-dayo-edit" className="banner">
          {dayoEditText(o.dayoEdit)}
          <br />
          {TH.dayoEditMoneyNote}
        </p>
      )}
      <CentralStateChip central={o.central} />
      {o.central.diffSatang !== null && o.central.diffSatang !== 0 && o.central.computedTotalSatang !== null && (
        <p data-testid="order-diff" className="error">
          {TH.orderDiff(formatBahtFull(o.central.computedTotalSatang), formatBahtDiff(o.central.diffSatang))}
        </p>
      )}
      {o.central.duplicateOf.length > 0 && (
        <p data-testid="order-dup" className="badge">
          {TH.orderDup(o.central.duplicateOf.join(', '))}
        </p>
      )}
      <h2>{TH.lines}</h2>
      <ol className="list">
        {o.lines.map((l, i) => (
          <li key={l.lineNo} data-testid={`order-line-${i}`}>
            {l.qty} × {l.productName} {l.sizeName} · {TH.sweetShort} {l.sweetnessName}
            {l.milk === 'oat' && ` · ${TH.milkOat}`}
            {l.grade !== null && ` · ${TH.grade} ${l.grade}`}
            {' — '}
            {formatBaht(l.lineTotalSatang)}
          </li>
        ))}
      </ol>
      {o.promotions.length > 0 && (
        <>
          <h2>{TH.promotions}</h2>
          <ol className="list">
            {o.promotions.map((p, i) => (
              <li key={`${p.name}-${i}`} data-testid={`order-promo-${i}`}>
                {p.name} −{formatBaht(p.discountSatang)}
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="totals">
        <div>
          {TH.subtotal} {formatBaht(o.subtotalSatang)}
        </div>
        {o.discountSatang > 0 && (
          <div data-testid="order-discount">
            {TH.discount}
            {o.discountReason !== null && o.discountReason.trim() !== '' && ` (${o.discountReason})`} −{formatBaht(o.discountSatang)}
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
      {mayVoid && (
        <div className="actions sticky-foot">
          <button type="button" data-testid="order-void" onClick={() => setVoiding(true)}>
            {TH.voidButton}
          </button>
        </div>
      )}
      {voiding && <VoidDialog order={o} onClose={() => setVoiding(false)} />}
    </main>
  )
}
