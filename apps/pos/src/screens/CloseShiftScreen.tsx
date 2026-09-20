import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import { CASH_DENOMINATIONS_SATANG, tallyCashCount, varianceNeedsReason, type CashCountLine } from '@dayo/domain'
import { posErrorCode } from '../api/errors'
import { REASON_MAX_LENGTH, type CloseShiftInput, type ShiftReportDto } from '../api/types'
import { useApi } from '../app/api-context'
import { useCart } from '../app/cart-context'
import { bootstrapKey, ordersKey, shiftReportKey, useBootstrap, zListKey } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { formatBaht, parseBahtInput, parseCountInput } from '../ui/format'
import { TH } from '../ui/th'
import { PinPad } from './PinPad'
import { NegativeBaseList, QrTable } from './ShiftFigures'

/**
 * spec §4.8 / §5 ปิดวัน, reached from the sell screen (not from the X report): count the drawer by denomination
 * (Q3b-1) blind → only after "นับเสร็จ" show expected cash and the variance (Q3b-3 · review I-2) → reason when above
 * the threshold → PromptPay received / refunded / net and the optional bank-app total (Q3b-12) → an owner confirms
 * with their PIN (Q3b-2). If the previous Z fails its hash, the API answers Z_CHAIN_BROKEN and the owner
 * acknowledges it by entering their PIN once more (Q3b-11 · D53).
 *
 * The X report is read **once per count** and frozen in `shown` when the owner taps "นับเสร็จ": every figure on
 * screen, `shownExpectedCashSatang` and `shownReportFingerprint` all come from that one `shiftReport()` response
 * (Q3b-17 · D54, review NF-6), so what the owner saw is exactly what `closeShift` re-checks. If anything moved
 * meanwhile the API refuses with SHIFT_CHANGED — the count is then thrown away and the drawer is counted again,
 * still blind, against the reloaded figures.
 *
 * Two frozen figures sit outside that guarantee by design (review M3): `negativeBases` and `pendingSyncItems` are
 * deliberately left out of `shiftReportFingerprint` — they are informational, move for reasons unrelated to this
 * shift's money and never enter the Z — so they alone are not re-checked at submit and can be shown stale.
 */
export function CloseShiftScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const boot = useBootstrap()
  const { user } = useSession()
  const cart = useCart()
  const report = useQuery({ queryKey: shiftReportKey, queryFn: () => api.shiftReport() })
  const [texts, setTexts] = useState<Record<number, string>>({})
  /** The one X report the owner is being shown, frozen at "นับเสร็จ"; null while the count is still blind. */
  const [shown, setShown] = useState<ShiftReportDto | null>(null)
  const [reason, setReason] = useState('')
  const [bankText, setBankText] = useState('')
  const [chainBroken, setChainBroken] = useState(false)
  const owners = (boot.data?.users ?? []).filter((u) => u.role === 'owner')
  const [approverId, setApproverId] = useState<string | null>(user?.role === 'owner' ? user.id : null)
  const [error, setError] = useState<string | null>(null)

  const close = useMutation({
    mutationFn: (input: CloseShiftInput) => api.closeShift(input),
    onSuccess: async (z) => {
      // navigate first: a refetched bootstrap (openShift null) would otherwise redirect this screen to /shift/open
      void navigate({ to: '/z/$shiftId', params: { shiftId: z.shiftId } })
      queryClient.removeQueries({ queryKey: shiftReportKey })
      await Promise.all([bootstrapKey, zListKey, ordersKey].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
    },
    onError: async (e) => {
      const code = posErrorCode(e)
      if (code === 'Z_CHAIN_BROKEN') {
        // `close-chain-broken` below already explains it at length — the line by the PinPad only says what to do
        // now, instead of repeating the same paragraph in slightly different words (review M1).
        setChainBroken(true)
        setError(TH.zChainAckPin)
        return
      }
      setError(errorMessage(e))
      if (code === 'NO_OPEN_SHIFT') {
        // The shift is gone (e.g. the close committed but its answer never arrived): let the bootstrap refresh
        // send the owner out of this screen rather than leave them on "ยังไม่ได้เปิดกะ" (review M7).
        await queryClient.invalidateQueries({ queryKey: bootstrapKey })
        return
      }
      if (code === 'SHIFT_CHANGED') {
        // The shift moved while the drawer was being counted: the count belongs to figures that no longer exist.
        // Drop it, hide the expected cash again and reload the report — the owner counts once more, blind.
        setShown(null)
        setTexts({})
        await queryClient.invalidateQueries({ queryKey: shiftReportKey })
      }
    },
  })

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

  const parsed = CASH_DENOMINATIONS_SATANG.map((d) => ({ denominationSatang: d, count: parseCountInput(texts[d] ?? '') }))
  const valid = parsed.every((l) => l.count !== null)
  const lines: CashCountLine[] = parsed.map((l) => ({ denominationSatang: l.denominationSatang, count: l.count ?? 0 }))
  const totalSatang = valid ? tallyCashCount(lines).totalSatang : null
  const variance = totalSatang === null || shown === null ? null : totalSatang - shown.expectedCashSatang
  const needsReason = shown !== null && variance !== null && varianceNeedsReason(variance, shown.varianceAlertSatang)

  const submit = (pin: string): void => {
    if (shown === null || totalSatang === null) return setError(TH.errCountFirst)
    if (needsReason && reason.trim() === '') return setError(TH.errVarianceReasonRequired)
    if (approverId === null) return setError(TH.errNotOwner)
    const bankQrTotalSatang = bankText.trim() === '' ? null : parseBahtInput(bankText)
    if (bankText.trim() !== '' && bankQrTotalSatang === null) return setError(TH.errBadInput)
    setError(null)
    close.mutate({
      actorUserId: user?.id ?? '',
      approverUserId: approverId,
      approverPin: pin,
      countLines: lines,
      // both from `shown` — the very response whose figures are on screen, never a newer one (Q3b-17 · D54)
      shownExpectedCashSatang: shown.expectedCashSatang,
      shownReportFingerprint: shown.fingerprint,
      varianceReason: reason.trim() === '' ? null : reason,
      bankQrTotalSatang,
      acknowledgeZChainBroken: chainBroken,
    })
  }

  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-sell" onClick={() => void navigate({ to: '/sell' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.closeTitle}</h1>
      {cart.state.lines.length > 0 && (
        <p role="alert" className="error" data-testid="close-cart-not-empty">
          {TH.cartNotEmpty}
        </p>
      )}
      <table className="figures">
        <thead>
          <tr>
            <th scope="col">{TH.denomination}</th>
            <th scope="col">{TH.pieces}</th>
          </tr>
        </thead>
        <tbody>
          {CASH_DENOMINATIONS_SATANG.map((d) => (
            <tr key={d}>
              <th scope="row">{formatBaht(d)}</th>
              <td>
                <input
                  data-testid={`count-${d}`}
                  inputMode="numeric"
                  disabled={shown !== null}
                  value={texts[d] ?? ''}
                  onChange={(e) => setTexts((t) => ({ ...t, [d]: e.target.value }))}
                />
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row">{TH.countedTotal}</th>
            <td data-testid="close-counted">{totalSatang === null ? TH.errCountFormat : formatBaht(totalSatang)}</td>
          </tr>
        </tbody>
      </table>
      {shown === null ? (
        <>
          {error !== null && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="primary"
              data-testid="count-done"
              // `report.isFetching`: after a SHIFT_CHANGED the reload is still in flight — confirming now would
              // freeze the figures that were just refused (review M2).
              disabled={totalSatang === null || cart.state.lines.length > 0 || report.isFetching}
              onClick={() => {
                setError(null)
                setShown(report.data)
              }}
            >
              {TH.countDone}
            </button>
          </div>
        </>
      ) : (
        <>
          <table className="figures">
            <tbody>
              <tr>
                <th scope="row">{TH.expectedCash}</th>
                <td data-testid="close-expected">{formatBaht(shown.expectedCashSatang)}</td>
              </tr>
              <tr>
                <th scope="row">{TH.variance}</th>
                <td data-testid="close-variance" className={needsReason ? 'error' : undefined}>
                  {variance === null ? '' : formatBaht(variance)}
                </td>
              </tr>
            </tbody>
          </table>
          <label>
            {TH.varianceReason} {needsReason && `(${TH.varianceReasonHint(formatBaht(shown.varianceAlertSatang))})`}
            <input data-testid="close-reason" maxLength={REASON_MAX_LENGTH} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <QrTable sales={shown.sales} p="close" />
          <label>
            {TH.bankQrTotal}
            <input data-testid="close-bank-qr" inputMode="decimal" value={bankText} onChange={(e) => setBankText(e.target.value)} />
          </label>
          <NegativeBaseList items={shown.negativeBases} />
          <p className="badge" data-testid="close-pending">
            {TH.pendingAtClose(shown.pendingSyncItems)}
          </p>
          <div className="actions">
            <button
              type="button"
              data-testid="count-edit"
              onClick={() => {
                setError(null) // a PIN error from the previous attempt must not follow the owner into the recount (review M6)
                setShown(null)
              }}
            >
              {TH.countEdit}
            </button>
          </div>
          {chainBroken && (
            <p role="alert" className="error" data-testid="close-chain-broken">
              {TH.zChainAck}
            </p>
          )}
          <h3>{TH.closeApprover}</h3>
          <div className="choices">
            {owners.map((u) => (
              <button key={u.id} type="button" data-testid={`close-approver-${u.displayName}`} aria-pressed={approverId === u.id} onClick={() => setApproverId(u.id)}>
                {u.displayName}
              </button>
            ))}
          </div>
          <PinPad busy={close.isPending} error={error} onSubmit={submit} />
        </>
      )}
    </main>
  )
}
