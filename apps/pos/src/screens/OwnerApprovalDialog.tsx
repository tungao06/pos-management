import { useState, type JSX, type ReactNode } from 'react'
import { PIN_RE, REASON_MAX_LENGTH, type UserDto } from '../api/types'
import { TH } from '../ui/th'

export type OwnerApproval = { approverUserId: string; approverPin: string; reason: string }

/**
 * spec 04 §6.4: every owner remedy on the "ส่งไม่ผ่าน" page (and every field a remedy needs beyond that, e.g. a
 * new receipt code or staff — `extra`) is owner + PIN + a mandatory reason, the same shape `OwnerApproval` on every
 * remedy call (Task 15). The signed-in owner is preselected (`defaultApproverId`, as `VoidDialog` already does for
 * D50 Q3-22) but still types their PIN every time — the API checks it again regardless of who is preselected.
 *
 * `submitDisabled` lets the caller hold the button off until an extra field it renders through `extra` (a remap
 * target, a replacement staff id) has a value — never letting "ยืนยัน" reach the API with a field the caller has
 * not actually chosen yet.
 */
export function OwnerApprovalDialog({
  title,
  owners,
  defaultApproverId = null,
  busy,
  error,
  extra,
  submitDisabled = false,
  onSubmit,
  onClose,
}: {
  title: string
  owners: UserDto[]
  defaultApproverId?: string | null
  busy: boolean
  error: string | null
  extra?: ReactNode
  submitDisabled?: boolean
  onSubmit: (approval: OwnerApproval) => void
  onClose: () => void
}): JSX.Element {
  const [approverId, setApproverId] = useState<string | null>(defaultApproverId ?? owners[0]?.id ?? null)
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = (): void => {
    if (approverId === null) return setLocalError(TH.errNotOwner)
    if (reason.trim() === '') return setLocalError(TH.errReasonRequired)
    if (!PIN_RE.test(pin)) return setLocalError(TH.errPinFormat)
    setLocalError(null)
    onSubmit({ approverUserId: approverId, approverPin: pin, reason: reason.trim() })
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-label={title}>
      <div className="dialog">
        <h2>{title}</h2>
        {extra}
        <h3>{TH.voidApprover}</h3>
        <div className="choices">
          {owners.map((o) => (
            <button key={o.id} type="button" data-testid={`approval-owner-${o.displayName}`} aria-pressed={approverId === o.id} onClick={() => setApproverId(o.id)}>
              {o.displayName}
            </button>
          ))}
        </div>
        <label>
          {TH.approvalPinLabel}
          <input
            data-testid="approval-pin"
            type="text"
            className="text-mask"
            name="approval-owner-pin"
            inputMode="numeric"
            autoComplete="off"
            autoCapitalize="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </label>
        <label>
          {TH.approvalReasonLabel}
          <input data-testid="approval-reason" maxLength={REASON_MAX_LENGTH} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {(localError ?? error) !== null && (
          <p role="alert" className="error">
            {localError ?? error}
          </p>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            {TH.cancel}
          </button>
          <button type="button" className="primary" data-testid="approval-ok" disabled={busy || submitDisabled} onClick={submit}>
            {TH.approvalOk}
          </button>
        </div>
      </div>
    </div>
  )
}
