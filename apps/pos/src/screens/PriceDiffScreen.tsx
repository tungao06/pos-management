import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useApi } from '../app/api-context'
import { can } from '../app/permissions'
import { priceDiffsKey } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { formatBahtDiff, formatBahtFull } from '../ui/format'
import { TH } from '../ui/th'

const TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * spec §4.3, review item 23: owner-only "ยอดไม่ตรงระบบกลาง" (R11 — `price_diffs`, checked here AND server-side by
 * `listPriceDiffs` itself, review item 22) — every figure comes straight off `PriceDiffDto` (`@dayo/domain`'s
 * `centralDiffSatang`), never recomputed on screen.
 */
export function PriceDiffScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const { user } = useSession()
  const allowed = user !== null && can(user.role, 'price_diffs')
  const diffs = useQuery({
    queryKey: priceDiffsKey(user?.id ?? ''),
    queryFn: () => api.listPriceDiffs(user?.id ?? ''),
    enabled: allowed,
  })
  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-orders-back" onClick={() => void navigate({ to: '/orders' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.priceDiffTitle}</h1>
      {!allowed && (
        <p role="alert" className="error" data-testid="price-diff-owner-only">
          {TH.errNotOwner}
        </p>
      )}
      {allowed && diffs.isError && (
        <p role="alert" className="error">
          {errorMessage(diffs.error)}
        </p>
      )}
      {diffs.data?.length === 0 && <p>{TH.priceDiffEmpty}</p>}
      <div className="list">
        {diffs.data?.map((d) => (
          <div key={`${d.orderId}-${d.kind}`} className="kv-row" data-testid={`price-diff-${d.receiptNo}`}>
            <strong>
              {d.receiptNo} · {TIME.format(new Date(d.soldAt))}
            </strong>
            <span>{TH.priceDiffPos(formatBahtFull(d.totalSatang))}</span>
            <span>{TH.priceDiffCentral(d.computedTotalSatang !== null ? formatBahtFull(d.computedTotalSatang) : '—')}</span>
            {d.diffSatang !== null && <span>{TH.priceDiffDiff(formatBahtDiff(d.diffSatang))}</span>}
            {d.catalogVersion !== null && <span>{TH.priceDiffCatalog(String(d.catalogVersion))}</span>}
            {d.amountMismatch && (
              <span className="badge error" data-testid={`price-diff-mismatch-${d.receiptNo}`}>
                {TH.priceDiffAmountMismatch}
              </span>
            )}
            {d.kind === 'void_local_only' && <span className="error">{TH.priceDiffVoidLocalOnly}</span>}
          </div>
        ))}
      </div>
    </main>
  )
}
