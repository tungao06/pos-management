import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type JSX } from 'react'
import { PIN_RE, type StaffOptionDto, type UserDto } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'

/**
 * spec 04 §6.5, Q44 (`can(role, 'set_other_pin')` — owner only): an owner gives a dayo staff member who has no PIN
 * on this tablet yet their first one, approving with their own PIN (D50 Q3-21's lockout applies to that PIN).
 * Opened from `<LoginScreen>` — `approvers` is the tablet's own active owners (their PIN is what's checked), not
 * dayo's owner list.
 */
export function StaffPinDialog({
  staff,
  approvers,
  onClose,
  onDone,
}: {
  staff: StaffOptionDto
  approvers: UserDto[]
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const api = useApi()
  const queryClient = useQueryClient()
  const [approverId, setApproverId] = useState(approvers[0]?.id ?? '')
  const [approverPin, setApproverPin] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => api.setStaffPin({ staffId: staff.id, pin, approverUserId: approverId, approverPin }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: bootstrapKey })
      onDone()
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const mismatched = pin === '' || pin2 === '' || pin !== pin2 || !PIN_RE.test(pin)

  const submit = (ev: FormEvent): void => {
    ev.preventDefault()
    setError(null)
    if (mismatched) return setError(pin !== pin2 ? TH.errPinMismatch : TH.errPinFormat)
    save.mutate()
  }

  return (
    <div className="dialog" role="dialog" aria-label={TH.staffPinTitle(staff.displayName)}>
      <form className="list" onSubmit={submit}>
        <h2>{TH.staffPinTitle(staff.displayName)}</h2>
        <label>
          {TH.staffPinApprover}
          <select data-testid="staff-pin-approver" value={approverId} onChange={(e) => setApproverId(e.target.value)} required>
            {approvers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          {TH.staffPinApproverPin}
          <input data-testid="staff-pin-approver-pin" type="password" inputMode="numeric" autoComplete="off" value={approverPin} onChange={(e) => setApproverPin(e.target.value)} required />
        </label>
        <label>
          {TH.staffPinNew}
          <input data-testid="staff-pin-new" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} required />
        </label>
        <label>
          {TH.staffPinNew2}
          <input data-testid="staff-pin-new2" type="password" inputMode="numeric" autoComplete="off" value={pin2} onChange={(e) => setPin2(e.target.value)} required />
        </label>
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="row">
          <button type="button" data-testid="staff-pin-cancel" onClick={onClose}>
            {TH.cancel}
          </button>
          <button type="submit" className="primary" data-testid="staff-pin-save" disabled={save.isPending || mismatched}>
            {TH.save}
          </button>
        </div>
      </form>
    </div>
  )
}
