import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useApi } from '../app/api-context'
import { zListKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'

/** Past Z reports of this device, newest first (Q3b-5 · D52) — hash state and the chain warning on every row (Q3b-11 · D53).
 *  review I-1 adaptation (Task 6): a row whose snapshot could not be read has every snapshot-derived field null —
 *  shown as "—" rather than crashing the list. */
export function ZListScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const list = useQuery({ queryKey: zListKey, queryFn: () => api.listZReports() })
  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-home" onClick={() => void navigate({ to: '/' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.zList}</h1>
      {list.isError && (
        <p role="alert" className="error">
          {errorMessage(list.error)}
        </p>
      )}
      {list.data?.length === 0 && <p>{TH.noZ}</p>}
      <div className="list">
        {list.data?.map((z, i) => (
          <button key={z.shiftId} type="button" className="row" data-testid={`z-row-${i}`} onClick={() => void navigate({ to: '/z/$shiftId', params: { shiftId: z.shiftId } })}>
            <strong>{z.businessDate ?? '—'}</strong>
            <span>
              {TH.netSales} {z.netSalesSatang === null ? '—' : formatBaht(z.netSalesSatang)}
              {z.openedQuick === true && ` · ${TH.quickOpenBadge}`}
            </span>
            <span>
              {TH.variance} {z.cashVarianceSatang === null ? '—' : formatBaht(z.cashVarianceSatang)}
            </span>
            <span className={z.hashOk ? 'badge' : 'error'}>{z.hashOk ? TH.zHashOk : TH.zHashBad}</span>
            {z.chainWarning && (
              <span className="error" data-testid={`z-warn-${i}`}>
                {TH.zChainWarningShort}
              </span>
            )}
          </button>
        ))}
      </div>
    </main>
  )
}
