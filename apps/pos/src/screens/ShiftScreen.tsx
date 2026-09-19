import { useQuery } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useApi } from '../app/api-context'
import { shiftReportKey, useBootstrap } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'
import { DrawerTable, NegativeBaseList, QrTable, SalesTable, VoidList } from './ShiftFigures'

/**
 * X report (spec §4.8): the open shift computed live — nothing is written. Viewable any time, but it is not the way to
 * close: "ปิดกะ" lives on the sell screen and the expected cash is left out here, so the drawer is counted blind
 * (Q3b-3 · D52 · review I-2).
 */
export function ShiftScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const boot = useBootstrap()
  const report = useQuery({ queryKey: shiftReportKey, queryFn: () => api.shiftReport() })

  if (boot.data !== undefined && boot.data.openShift === null) return <Navigate to="/shift/open" />
  if (report.isError) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(report.error)}
        </p>
      </main>
    )
  }
  if (report.data === undefined) return <main className="page">{TH.loading}</main>
  const r = report.data
  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-sell" onClick={() => void navigate({ to: '/sell' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.xTitle}</h1>
      <p data-testid="x-shift">
        {TH.shiftInfo(r.shift.businessDate, r.shift.openedByName)}
        {r.shift.openedQuick && (
          <span className="badge" data-testid="x-quick">
            {' '}
            · {TH.quickOpenBadge}
          </span>
        )}
      </p>
      <SalesTable sales={r.sales} p="x" />
      <QrTable sales={r.sales} p="x" />
      <DrawerTable cash={r.cash} expectedSatang={r.expectedCashSatang} p="x" hideExpected />
      <section>
        <h2>{TH.cashMovesTitle}</h2>
        <ul className="list">
          {r.cashMovements.map((m) => (
            <li key={m.id} data-testid={`x-move-${m.id}`}>
              {m.kind === 'VOID_REFUND' ? TH.voidRefunds : TH.cashKinds[m.kind]} · {formatBaht(m.amountSatang)} · {m.reason}
            </li>
          ))}
        </ul>
      </section>
      <VoidList voids={r.voids} p="x" />
      <NegativeBaseList items={r.negativeBases} />
      <p className="badge">{TH.pendingAtClose(r.pendingSyncItems)}</p>
      <div className="actions">
        <button type="button" data-testid="nav-z-list" onClick={() => void navigate({ to: '/z' })}>
          {TH.zList}
        </button>
        <button type="button" data-testid="nav-backup" onClick={() => void navigate({ to: '/backup' })}>
          {TH.backupTitle}
        </button>
      </div>
    </main>
  )
}
