import { useState, type JSX, type ReactNode } from 'react'
import { CASH_DENOMINATIONS_SATANG, cashVarianceSatang, tallyCashCount, varianceNeedsReason, type CashCountLine } from '@dayo/domain'
import { REASON_MAX_LENGTH, type CountSummaryDto, type UserDto } from '../api/types'
import { formatBaht, formatBahtFull, parseCountInput } from '../ui/format'
import { TH } from '../ui/th'
import { PinPad } from './PinPad'

/** spec §6.8 (D101 · D102): shared by `/shift/close` (editable — the count itself) and `/shift/z/$shiftId`
 * (read-only — the count was already saved; only the Z is issued). `online` is the ONE rule (review item 1 of
 * Task 12) that decides whether a Z can be issued now: `summary.includesBotCash || summary.syncMode === 'local_only'`.
 */
export function CountReview({
  summary,
  online,
  editable,
  countedSatang,
  onLinesChange,
  owners,
  confirmLabel,
  busy,
  error,
  onSubmit,
  extraWarning,
  finishSlot,
}: {
  /** null while the count is still blind (before "นับเสร็จ" → countSummary) — only `finishSlot` renders then. */
  summary: CountSummaryDto | null
  online: boolean
  /** true: shows the 9 denomination inputs and tallies them here (CloseShiftScreen). false: `countedSatang` is
   * the already-saved cash_count, shown as a fixed figure with no inputs (IssueZScreen). */
  editable: boolean
  /** The counted total when `!editable`; ignored (computed from the inputs) when `editable`. */
  countedSatang: number
  /** Fires with the tallied lines on every edit (editable mode only) — the caller needs them for `confirmCount`. */
  onLinesChange?: (lines: CashCountLine[]) => void
  owners: readonly UserDto[]
  confirmLabel: string
  busy: boolean
  error: string | null
  onSubmit: (pin: string, approverUserId: string, reason: string | null) => void
  /** Z_CHAIN_BROKEN acknowledgement text, shown above the PIN pad (review M1: says only what to do now). */
  extraWarning?: ReactNode
  finishSlot?: ReactNode
}): JSX.Element {
  const [texts, setTexts] = useState<Record<number, string>>({})
  const [approverId, setApproverId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const parsed = CASH_DENOMINATIONS_SATANG.map((d) => ({ denominationSatang: d, count: parseCountInput(texts[d] ?? '') }))
  const validInputs = parsed.every((l) => l.count !== null)
  const lines: CashCountLine[] = parsed.map((l) => ({ denominationSatang: l.denominationSatang, count: l.count ?? 0 }))
  const tallyTotal = validInputs ? tallyCashCount(lines).totalSatang : null
  const totalSatang = editable ? tallyTotal : countedSatang

  const setDenom = (d: number, text: string): void => {
    setTexts((t) => ({ ...t, [d]: text }))
    const nextParsed = CASH_DENOMINATIONS_SATANG.map((dd) => ({ denominationSatang: dd, count: parseCountInput((dd === d ? text : texts[dd]) ?? '') }))
    if (nextParsed.every((l) => l.count !== null)) onLinesChange?.(nextParsed.map((l) => ({ denominationSatang: l.denominationSatang, count: l.count! })))
  }

  const variance = summary === null || totalSatang === null ? null : cashVarianceSatang(totalSatang, summary.expectedCashSatang)
  const needsReason = summary !== null && variance !== null && varianceNeedsReason(variance, summary.varianceAlertSatang)
  const askReason = online && needsReason

  const submit = (pin: string): void => {
    if (summary === null || totalSatang === null) return setLocalError(TH.errCountFirst)
    if (askReason && reason.trim() === '') return setLocalError(TH.errVarianceReasonRequired)
    if (approverId === null) return setLocalError(TH.errNotOwner)
    setLocalError(null)
    onSubmit(pin, approverId, reason.trim() === '' ? null : reason)
  }

  return (
    <>
      {editable && (
        <table className="figures count">
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
                  <input data-testid={`count-input-${d / 100}`} inputMode="numeric" value={texts[d] ?? ''} onChange={(e) => setDenom(d, e.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editable && (
        <p>
          {TH.countedTotal} <strong data-testid="count-total">{tallyTotal === null ? TH.errCountFormat : formatBaht(tallyTotal)}</strong>
        </p>
      )}
      {summary === null ? (
        finishSlot
      ) : (
        <>
          <table className="figures">
            <tbody>
              <tr>
                <th scope="row">{TH.countExpected}</th>
                <td data-testid="count-expected">{formatBahtFull(summary.expectedCashSatang)}</td>
              </tr>
              <tr>
                <th scope="row">{TH.variance}</th>
                <td data-testid="count-variance" className={needsReason ? 'error' : undefined}>
                  {variance === null ? '' : formatBahtFull(variance)}
                </td>
              </tr>
            </tbody>
          </table>
          {summary.syncMode === 'central' && !summary.includesBotCash && (
            <p className="badge" data-testid="count-no-bot-cash">
              {TH.countNoBotCash}
            </p>
          )}
          {summary.bot !== null && (
            <p className="badge" data-testid="count-bot-cash">
              <span>{TH.countBotCash(summary.bot.bills.length)}</span> · <span>{formatBahtFull(summary.bot.cashTotalSatang)}</span>
            </p>
          )}
          {askReason && (
            <label>
              {TH.varianceReason} ({TH.varianceReasonHint(formatBaht(summary.varianceAlertSatang))})
              <input data-testid="count-reason" maxLength={REASON_MAX_LENGTH} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          )}
          {(localError ?? error) !== null && (
            <p role="alert" className="error">
              {localError ?? error}
            </p>
          )}
          {extraWarning}
          <h3>{TH.closeApprover}</h3>
          <div className="choices">
            {owners.map((u) => (
              <button key={u.id} type="button" data-testid={`count-approver-${u.displayName}`} aria-pressed={approverId === u.id} onClick={() => setApproverId(u.id)}>
                {u.displayName}
              </button>
            ))}
          </div>
          <PinPad busy={busy} error={null} onSubmit={submit} okTestId="count-confirm" okLabel={confirmLabel} extraDisabled={askReason && reason.trim() === ''} />
        </>
      )}
    </>
  )
}
