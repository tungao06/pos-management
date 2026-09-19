import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { JSX, ReactNode } from 'react'
import { useApi } from '../app/api-context'
import { useBootstrap, zKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'
import { DrawerTable, QrTable, SalesTable, VoidList } from './ShiftFigures'

const DATE_TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })

/** A frozen Z report exactly as stored (spec §4.8) — shown on screen, never recomputed (Q3b-5 · D52). */
export function ZReportScreen(): JSX.Element {
  const { shiftId } = useParams({ from: '/z/$shiftId' })
  const api = useApi()
  const navigate = useNavigate()
  const boot = useBootstrap()
  const z = useQuery({ queryKey: zKey(shiftId), queryFn: () => api.getZReport(shiftId) })

  if (z.isError) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(z.error)}
        </p>
      </main>
    )
  }
  if (z.data === undefined) return <main className="page">{TH.loading}</main>

  const backupDueBlock = boot.data?.backupDue === true && (
    <p role="alert" className="error" data-testid="backup-due">
      {TH.backupDue}
    </p>
  )
  const actions: ReactNode = (
    <div className="actions">
      <button type="button" data-testid="nav-z-list" onClick={() => void navigate({ to: '/z' })}>
        {TH.zList}
      </button>
      <button type="button" className={boot.data?.backupDue === true ? 'primary' : undefined} data-testid="nav-backup" onClick={() => void navigate({ to: '/backup' })}>
        {TH.backupTitle}
      </button>
      <button type="button" data-testid="z-done" onClick={() => void navigate({ to: '/' })}>
        {TH.zDone}
      </button>
    </div>
  )

  // review I-1 adaptation (Task 6): snapshot_json can be unreadable — hashOk is then always false, and every
  // snapshot-derived figure is gone. Show a clear Thai message plus the tamper (hash) warning instead of crashing.
  if (z.data.snapshot === null) {
    return (
      <main className="page">
        <h1>{TH.zTitle}</h1>
        <p role="alert" className="error" data-testid="z-unreadable">
          {TH.zUnreadable}
        </p>
        <p data-testid="z-hash" data-ok="false" className="error">
          {TH.zHashBad} · {z.data.hash.slice(0, 12)}
        </p>
        {backupDueBlock}
        {actions}
      </main>
    )
  }
  const snap = z.data.snapshot
  return (
    <main className="page">
      <h1>
        {TH.zTitle} · {snap.businessDate}
        {snap.openedQuick && <span className="badge"> · {TH.quickOpenBadge}</span>}
      </h1>
      <p>{TH.zClosedAt(DATE_TIME.format(new Date(snap.closedAt)))}</p>
      <p data-testid="z-hash" data-ok={z.data.hashOk ? 'true' : 'false'} className={z.data.hashOk ? 'badge' : 'error'}>
        {z.data.hashOk ? TH.zHashOk : TH.zHashBad} · {z.data.hash.slice(0, 12)}
      </p>
      {snap.chainWarning != null && (
        <p role="alert" className="error" data-testid="z-chain-warning">
          {TH.zChainWarning}
        </p>
      )}
      {backupDueBlock}
      <SalesTable sales={snap.sales} p="z" />
      <QrTable sales={snap.sales} p="z" bank={{ totalSatang: snap.bankQrTotalSatang ?? null, differenceSatang: snap.qrDifferenceSatang ?? null }} />
      <DrawerTable cash={snap.cash} expectedSatang={snap.expectedCashSatang} p="z" />
      <table className="figures">
        <tbody>
          {snap.countLines
            .filter((l) => l.count > 0)
            .map((l) => (
              <tr key={l.denominationSatang}>
                <th scope="row">{formatBaht(l.denominationSatang)}</th>
                <td>× {l.count}</td>
              </tr>
            ))}
          <tr>
            <th scope="row">{TH.countedTotal}</th>
            <td data-testid="z-counted">{formatBaht(snap.countedCashSatang)}</td>
          </tr>
          <tr>
            <th scope="row">{TH.variance}</th>
            <td data-testid="z-variance">{formatBaht(snap.cashVarianceSatang)}</td>
          </tr>
          {snap.varianceReason !== null && (
            <tr>
              <th scope="row">{TH.varianceReason}</th>
              <td data-testid="z-reason">{snap.varianceReason}</td>
            </tr>
          )}
          <tr>
            <th scope="row">{TH.zGrandTotal}</th>
            <td data-testid="z-grand">{formatBaht(snap.grandTotalSatang)}</td>
          </tr>
        </tbody>
      </table>
      <VoidList voids={snap.voids} p="z" />
      {actions}
    </main>
  )
}
