import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import type { StockItemDto } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, stockKey } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { formatBaht, formatQty } from '../ui/format'
import { TH } from '../ui/th'

// shared with ProduceScreen (fix round 1, review [Minor]) — one formatter, not two copies drifting apart
export const DATE_TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })
type Filter = 'all' | 'reorder' | 'bases'

/** On hand in the default purchase unit, when the item has one (e.g. "2 ถุง") — for reading at a glance. */
function inUnits(i: StockItemDto): string | null {
  const unit = i.units.find((u) => u.isDefault) ?? i.units[0]
  if (unit === undefined || i.onHandMilli <= 0) return null
  return formatQty(Math.floor((i.onHandMilli * 1000) / unit.qtyPerUnitMilli), unit.name)
}

/** "หมดอายุ 20 ก.ย. 69 10:00" / "หมดอายุแล้ว …" for a base with stock left. */
export function expiryText(i: StockItemDto): string | null {
  const b = i.latestBatch
  if (b === null || b.expiry === 'none') return null
  if (b.expiresAt === null) return TH.stockNoExpiry
  return TH.stockExpiresAt(TH.stockExpiry[b.expiry], DATE_TIME.format(new Date(b.expiresAt)))
}

/** หน้าสต็อก (spec §5): on hand · status · value · reorder list · bases and expiry · "ทิ้ง" (spec §4.6). Everyone. */
export function StockScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useSession()
  const stock = useQuery({ queryKey: stockKey, queryFn: () => api.stockOverview() })
  const [filter, setFilter] = useState<Filter>('all')
  const [discarding, setDiscarding] = useState<StockItemDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  const discard = useMutation({
    mutationFn: (itemId: string) => api.discardBase({ actorUserId: user?.id ?? '', itemId }),
    onSuccess: async () => {
      setDiscarding(null)
      await Promise.all([queryClient.invalidateQueries({ queryKey: stockKey }), queryClient.invalidateQueries({ queryKey: bootstrapKey })])
    },
    onError: (e) => setError(errorMessage(e)),
  })

  if (stock.isError) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(stock.error)}
        </p>
      </main>
    )
  }
  if (stock.data === undefined) return <main className="page">{TH.loading}</main>
  const o = stock.data
  const shown = o.items.filter((i) => (filter === 'all' ? true : filter === 'bases' ? i.kind === 'prepared' : i.kind === 'raw' && i.alert))

  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-sell" onClick={() => void navigate({ to: '/sell' })}>
          {TH.back}
        </button>
        <button type="button" data-testid="nav-receive" onClick={() => void navigate({ to: '/stock/receive' })}>
          {TH.navReceive}
        </button>
        <button type="button" data-testid="nav-produce" onClick={() => void navigate({ to: '/stock/produce' })}>
          {TH.navProduce}
        </button>
      </div>
      <h1>{TH.stockTitle}</h1>
      <p>
        {TH.stockTotalValue} <strong data-testid="stock-total-value">{formatBaht(o.totalValueSatang)}</strong>
      </p>
      <p data-testid="stock-last-count">{o.lastCountAt === null ? TH.stockNeverCounted : TH.stockLastCount(DATE_TIME.format(new Date(o.lastCountAt)))}</p>
      {o.countDue && (
        <p role="alert" className="error" data-testid="stock-count-due">
          {TH.stockCountDue}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="choices">
        {(['all', 'reorder', 'bases'] as const).map((f) => (
          <button key={f} type="button" data-testid={`stock-filter-${f}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? TH.stockFilterAll : f === 'reorder' ? TH.stockFilterReorder : TH.stockFilterBases}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p>{TH.stockNoItems}</p>}
      <table className="figures">
        <tbody>
          {shown.map((i) => {
            const units = inUnits(i)
            const expiry = expiryText(i)
            return (
              <tr key={i.itemId} data-testid={`stock-row-${i.code}`} data-status={i.status} data-alert={i.alert}>
                <th>
                  {i.name}
                  <br />
                  <small className="badge">{i.code}</small>
                  {!i.isActive && (
                    <>
                      {' '}
                      <small className="badge" data-testid={`stock-inactive-${i.code}`}>
                        {TH.stockInactive}
                      </small>
                    </>
                  )}
                  {expiry !== null && (
                    <>
                      <br />
                      <small className={i.latestBatch?.expiry === 'fresh' ? 'badge' : 'error'} data-testid={`stock-expiry-${i.code}`}>
                        {expiry}
                      </small>
                    </>
                  )}
                </th>
                <td data-testid={`stock-onhand-${i.code}`}>
                  {formatQty(i.onHandMilli, i.useUnit)}
                  {units !== null && (
                    <>
                      <br />
                      <small className="badge">≈ {units}</small>
                    </>
                  )}
                </td>
                <td className={i.alert ? 'error' : undefined} data-testid={`stock-status-${i.code}`}>
                  {TH.stockStatus[i.status]}
                </td>
                <td>{formatBaht(i.valueSatang)}</td>
                <td>
                  {i.kind === 'prepared' && i.onHandMilli > 0 && (
                    <button type="button" data-testid={`base-discard-${i.code}`} onClick={() => setDiscarding(i)}>
                      {TH.discard}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {discarding !== null && (
        <div className="dialog-backdrop" role="dialog" aria-label={TH.discardTitle(discarding.name)}>
          <div className="dialog">
            <h2>{TH.discardTitle(discarding.name)}</h2>
            {expiryText(discarding) !== null && <p>{expiryText(discarding)}</p>}
            <div className="actions">
              <button type="button" onClick={() => setDiscarding(null)}>
                {TH.cancel}
              </button>
              <button type="button" className="primary" data-testid="base-discard-confirm" disabled={discard.isPending} onClick={() => discard.mutate(discarding.itemId)}>
                {TH.discardConfirm(formatQty(discarding.onHandMilli, discarding.useUnit))}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
