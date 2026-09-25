import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import type { StaffOptionDto, UserDto } from '../api/types'
import { useApi } from '../app/api-context'
import { useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'
import { DbErrorScreen } from './DbErrorScreen'
import { PinPad } from './PinPad'
import { StaffPinDialog } from './StaffPinDialog'

/**
 * spec 04 §6.5 (staff who need a first PIN), §7 ข้อ 5 (ruling N2 — "เชื่อมใหม่ด้วยคีย์ใหม่"): the existing
 * PIN sign-in is unchanged; this adds who still needs a PIN and, when nobody here can approve one, the way back in.
 */
export function LoginScreen(): JSX.Element {
  const api = useApi()
  const boot = useBootstrap()
  const session = useSession()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<UserDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pinDialogFor, setPinDialogFor] = useState<StaffOptionDto | null>(null)

  const login = useMutation({
    mutationFn: ({ userId, pin }: { userId: string; pin: string }) => api.login(userId, pin),
    onSuccess: (u) => {
      session.signIn(u)
      void navigate({ to: '/' })
    },
    onError: (e) => setError(errorMessage(e)),
  })

  if (boot.isPending) return <main className="page">{TH.loading}</main>
  if (boot.isError) return <DbErrorScreen error={boot.error} />

  if (pinDialogFor !== null) {
    return (
      <StaffPinDialog
        staff={pinDialogFor}
        approvers={boot.data.users.filter((u) => u.role === 'owner')}
        onClose={() => setPinDialogFor(null)}
        onDone={() => setPinDialogFor(null)}
      />
    )
  }

  return (
    <main className="page">
      <h1>{TH.loginTitle}</h1>
      {boot.data.ownerRecovery && (
        <div data-testid="owner-recovery-banner" className="warn">
          <p>{TH.ownerRecoveryBanner}</p>
          <button type="button" data-testid="owner-recovery" onClick={() => void navigate({ to: '/owner-recovery' })}>
            {TH.ownerRecoveryButton}
          </button>
        </div>
      )}
      <div className="choices">
        {boot.data.users.map((u) => (
          <button
            key={u.id}
            type="button"
            aria-pressed={selected?.id === u.id}
            data-testid={`user-${u.displayName}`}
            onClick={() => {
              setSelected(u)
              setError(null)
            }}
          >
            {u.displayName}
          </button>
        ))}
      </div>
      {selected !== null && (
        <>
          <p>{TH.loginEnterPin(selected.displayName)}</p>
          <PinPad busy={login.isPending} error={error} onSubmit={(pin) => login.mutate({ userId: selected.id, pin })} />
        </>
      )}
      {boot.data.staffNeedingPin.length > 0 && (
        <>
          <h2>{TH.needsPinTitle}</h2>
          <div className="choices">
            {boot.data.staffNeedingPin.map((s) => (
              <button key={s.id} type="button" data-testid={`needs-pin-${s.displayName}`} onClick={() => setPinDialogFor(s)}>
                {s.displayName}
              </button>
            ))}
          </div>
        </>
      )}
    </main>
  )
}
