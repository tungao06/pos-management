import { useState, type JSX, type ReactNode } from 'react'
import { CASH_DENOMINATIONS_SATANG, cashVarianceSatang, tallyCashCount, varianceNeedsReason, type CashCountLine } from '@dayo/domain'
import { REASON_MAX_LENGTH, type CountSummaryDto, type UserDto } from '../api/types'
import { formatBaht, formatBahtFull, parseBahtInput, parseCountInput } from '../ui/format'
import { TH } from '../ui/th'
import { PinPad } from './PinPad'
import { DrawerTable, NegativeBaseList, QrTable, VoidList } from './ShiftFigures'

/** What `onSubmit` hands the caller once the owner's PIN lands — every figure read straight off the fields on
 * screen at that instant (fix round 1 item 5: never a separately-tracked copy that could go stale). */
export type CountReviewSubmit = { pin: string; approverUserId: string; reason: string | null; bankQrTotalSatang: number | null; lines: CashCountLine[] }

/** spec §6.8 (D101 · D102): shared by `/shift/close` (editable — the count itself) and `/shift/z/$shiftId`
 * (read-only — the count was already saved; only the Z is issued). `online` is the ONE rule (review item 1 of
 * Task 12) that decides whether a Z can be issued now: `summary.includesBotCash || summary.syncMode === 'local_only'`.
 */
export function CountReview({
  summary,
  online,
  editable,
  countedSatang,
  owners,
  confirmLabel,
  busy,
  error,
  onSubmit,
  extraWarning,
  finishSlot,
}: {
  /** null while the count is still blind (before "นับเสร็จ" → countSummary, or hidden again after SHIFT_CHANGED
   * until the recount is finished — D52) — only `finishSlot` renders then. */
  summary: CountSummaryDto | null
  online: boolean
  /** true: shows the 9 denomination inputs and tallies them here (CloseShiftScreen). false: `countedSatang` is
   * the already-saved cash_count, shown as a fixed figure with no inputs (IssueZScreen). */
  editable: boolean
  /** The counted total when `!editable`; ignored (computed from the inputs) when `editable`. */
  countedSatang: number
  owners: readonly UserDto[]
  confirmLabel: string
  busy: boolean
  /** Shown regardless of blind/reviewed (fix round 1 item 3) — a `finishCount`/`countSummary` refusal (CLOCK_AHEAD,
   * NO_OPEN_SHIFT, …) must be visible while the denomination table is still the only thing on screen. */
  error: string | null
  onSubmit: (result: CountReviewSubmit) => void
  /** Z_CHAIN_BROKEN acknowledgement text, shown above the PIN pad (review M1: says only what to do now). */
  extraWarning?: ReactNode
  finishSlot?: ReactNode
}): JSX.Element {
  const [texts, setTexts] = useState<Record<number, string>>({})
  const [approverId, setApproverId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [bankQrText, setBankQrText] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const parsed = CASH_DENOMINATIONS_SATANG.map((d) => ({ denominationSatang: d, count: parseCountInput(texts[d] ?? '') }))
  const validInputs = parsed.every((l) => l.count !== null)
  const lines: CashCountLine[] = parsed.map((l) => ({ denominationSatang: l.denominationSatang, count: l.count ?? 0 }))
  const tallyTotal = validInputs ? tallyCashCount(lines).totalSatang : null
  const totalSatang = editable ? tallyTotal : countedSatang

  const variance = summary === null || totalSatang === null ? null : cashVarianceSatang(totalSatang, summary.expectedCashSatang)
  const needsReason = summary !== null && variance !== null && varianceNeedsReason(variance, summary.varianceAlertSatang)
  const askReason = online && needsReason

  // fix round 1 item 5 (security M, probe-confirmed): `lines` above is computed fresh from `texts` — the very
  // inputs on screen right now — every time this renders, so a stale, separately-tracked copy can never diverge
  // from what the owner sees and confirm with their PIN. Nothing else here is a second source of the same figure.
  const submit = (pin: string): void => {
    if (summary === null || totalSatang === null) return setLocalError(TH.errCountFirst)
    if (askReason && reason.trim() === '') return setLocalError(TH.errVarianceReasonRequired)
    if (approverId === null) return setLocalError(TH.errNotOwner)
    // fix round 2 item 5: offline (z: null) the bank-app figure has nowhere to go — `ZSettle` only exists when a Z
    // is actually being written, so it is always null here; the owner enters it on `/shift/z/$shiftId` instead,
    // once online (the field itself is hidden below in that case, review item 5).
    const bankQrTotalSatang = !online || bankQrText.trim() === '' ? null : parseBahtInput(bankQrText)
    if (online && bankQrText.trim() !== '' && bankQrTotalSatang === null) return setLocalError(TH.errBadInput)
    setLocalError(null)
    onSubmit({ pin, approverUserId: approverId, reason: reason.trim() === '' ? null : reason, bankQrTotalSatang, lines })
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
                  <input data-testid={`count-input-${d / 100}`} inputMode="numeric" value={texts[d] ?? ''} onChange={(e) => setTexts((t) => ({ ...t, [d]: e.target.value }))} />
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
      {/* fix round 1 item 3: a finishCount/countSummary refusal must be visible even before there is any summary
          to review — this is the ONLY error shown while blind (`localError` below only ever applies once a summary exists). */}
      {summary === null && error !== null && (
        <p role="alert" className="error">
          {error}
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
          {/* fix round 1 item 4 (brief step 2's review breakdown): the drawer's own components (float · cash sales ·
              void refunds · paid in/out · drops — the expected/variance pair above stays the one this screen owns,
              already checked against the domain formula), PromptPay (item 1 · D53 Q3b-12), negative bases, voids and
              the pending-sync count — every figure straight off `summary`, nothing recomputed here. */}
          <DrawerTable cash={summary.cash} expectedSatang={summary.expectedCashSatang} p="count" hideExpected hideExpectedNote />
          <QrTable sales={summary.sales} p="count" />
          <NegativeBaseList items={summary.negativeBases} />
          <VoidList voids={summary.voids} p="count" />
          <p className="badge" data-testid="count-pending">
            {TH.pendingAtClose(summary.pendingSyncItems)}
          </p>
          {/* Task 14 · carried item 8: receipts of this shift dayo will never receive — their VOID_REFUND (if any)
              still goes to dayo (ruling), so the money itself is unaffected; only the bill count is missing there. */}
          {summary.notInDayo.bills > 0 && (
            <p className="badge" data-testid="count-not-in-dayo">
              {TH.countNotInDayo(summary.notInDayo.bills, formatBahtFull(summary.notInDayo.voidRefundSatang))}
            </p>
          )}
          {/* fix round 2 item 5: offline (z: null), nothing here is ever sent anywhere — the owner types the
              bank-app figure on `/shift/z/$shiftId` instead, once online and a Z is actually being written. */}
          {online && (
            <label>
              {TH.bankQrTotal}
              <input data-testid="count-bank-qr" inputMode="decimal" value={bankQrText} onChange={(e) => setBankQrText(e.target.value)} />
            </label>
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
