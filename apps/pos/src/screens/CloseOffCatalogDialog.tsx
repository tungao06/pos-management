import { useState, type JSX } from 'react'
import { REASON_MAX_LENGTH, type OwnerApproval, type UserDto } from '../api/types'
import { TH } from '../ui/th'
import { PinPad } from './PinPad'

/**
 * "ปิดเป็นบิลนอกแคตตาล็อก" (spec 04 §6.4 · §4.10 · D91 · D97): a stronger warning than the generic
 * `OwnerApprovalDialog` — the owner sees exactly what this does to the money before typing a PIN (never math here,
 * only the fixed Thai warning) — reason, then approver + PIN (the same digit-grid pattern `CountReview` uses for
 * every block-3 owner confirmation, spec §6.8).
 */
export function CloseOffCatalogDialog({
  owners,
  defaultApproverId = null,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  owners: UserDto[]
  defaultApproverId?: string | null
  busy: boolean
  error: string | null
  onSubmit: (approval: OwnerApproval) => void
  onClose: () => void
}): JSX.Element {
  const [approverId, setApproverId] = useState<string | null>(defaultApproverId ?? owners[0]?.id ?? null)
  const [reason, setReason] = useState('')

  const submit = (pin: string): void => {
    if (approverId === null || reason.trim() === '') return
    onSubmit({ approverUserId: approverId, approverPin: pin, reason: reason.trim() })
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-label={TH.remedyCloseOffCatalog} data-testid="off-catalog-dialog">
      <div className="dialog">
        <h2>{TH.remedyCloseOffCatalog}</h2>
        <p role="alert" className="error">
          {TH.offCatalogWarning}
        </p>
        <label>
          {TH.approvalReasonLabel}
          <input data-testid="off-catalog-reason" maxLength={REASON_MAX_LENGTH} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <h3>{TH.voidApprover}</h3>
        <div className="choices">
          {owners.map((o) => (
            <button key={o.id} type="button" data-testid={`count-approver-${o.displayName}`} aria-pressed={approverId === o.id} onClick={() => setApproverId(o.id)}>
              {o.displayName}
            </button>
          ))}
        </div>
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <PinPad busy={busy} error={null} onSubmit={submit} okTestId="off-catalog-confirm" okLabel={TH.approvalOk} extraDisabled={approverId === null || reason.trim() === ''} />
        <div className="actions dialog-foot">
          <button type="button" onClick={onClose}>
            {TH.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}
