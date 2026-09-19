import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type JSX } from 'react'
import { REASON_MAX_LENGTH, type CashMovementInput } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, shiftReportKey } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { parseBahtInput } from '../ui/format'
import { TH } from '../ui/th'

const KINDS: CashMovementInput['kind'][] = ['PAID_IN', 'PAID_OUT', 'DROP']

/**
 * spec §3.5: paid-in / paid-out / drop typed in by whoever is signed in, with a reason (Q3b-9 · D52).
 *
 * Q3b-14 · D54: a paid-out or drop larger than the drawer's current expected cash (read from the same X report the
 * `/shift` screen shows, but never displayed here — the drawer stays counted blind, Q3b-3 · D52) is refused on the
 * first press with a warning that names no figure, and only saved once the person presses a second, explicit
 * confirm. Paid-in never warns — it can only ever bring the drawer closer to what it should hold.
 */
export function CashMoveDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const api = useApi()
  const queryClient = useQueryClient()
  const { user } = useSession()
  const report = useQuery({ queryKey: shiftReportKey, queryFn: () => api.shiftReport() })
  const [kind, setKind] = useState<CashMovementInput['kind'] | null>(null)
  const [amountText, setAmountText] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [overDrawerWarning, setOverDrawerWarning] = useState(false)

  const save = useMutation({
    mutationFn: (input: CashMovementInput) => api.recordCashMovement(input),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: bootstrapKey }), queryClient.invalidateQueries({ queryKey: shiftReportKey })])
      onClose()
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const pickKind = (k: CashMovementInput['kind']): void => {
    setKind(k)
    setOverDrawerWarning(false)
  }
  const changeAmount = (text: string): void => {
    setAmountText(text)
    setOverDrawerWarning(false)
  }

  const doSave = (k: CashMovementInput['kind'], amountSatang: number): void => {
    save.mutate({ actorUserId: user?.id ?? '', kind: k, amountSatang, reason })
  }

  const submit = (): void => {
    const amountSatang = parseBahtInput(amountText)
    if (kind === null || amountSatang === null || amountSatang <= 0) return setError(TH.errBadInput)
    if (reason.trim() === '') return setError(TH.errReasonRequired)
    setError(null)
    // Q3b-14: only paid-out / drop can overdraw the drawer, and only once the expected figure is known.
    if (kind !== 'PAID_IN' && report.data !== undefined && amountSatang > report.data.expectedCashSatang) {
      setOverDrawerWarning(true)
      return
    }
    doSave(kind, amountSatang)
  }

  const confirmOverDrawer = (): void => {
    const amountSatang = parseBahtInput(amountText)
    if (kind === null || amountSatang === null) return
    setOverDrawerWarning(false)
    doSave(kind, amountSatang)
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-label={TH.cashMoveTitle}>
      <div className="dialog">
        <h2>{TH.cashMoveTitle}</h2>
        <div className="choices">
          {KINDS.map((k) => (
            <button key={k} type="button" data-testid={`cash-kind-${k}`} aria-pressed={kind === k} onClick={() => pickKind(k)}>
              {TH.cashKinds[k]}
            </button>
          ))}
        </div>
        <label>
          {TH.cashMoveAmount}
          <input data-testid="cash-amount" inputMode="decimal" value={amountText} onChange={(e) => changeAmount(e.target.value)} />
        </label>
        <label>
          {TH.cashMoveReason}
          <input data-testid="cash-reason" maxLength={REASON_MAX_LENGTH} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {overDrawerWarning && (
          <>
            <p role="alert" className="error" data-testid="cash-over-drawer-warning">
              {TH.cashOverDrawerWarning}
            </p>
            <div className="actions">
              <button type="button" className="primary" data-testid="cash-over-drawer-confirm" disabled={save.isPending} onClick={confirmOverDrawer}>
                {TH.cashOverDrawerConfirm}
              </button>
            </div>
          </>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            {TH.cancel}
          </button>
          <button type="button" className="primary" data-testid="cash-save" disabled={save.isPending} onClick={submit}>
            {TH.save}
          </button>
        </div>
      </div>
    </div>
  )
}
