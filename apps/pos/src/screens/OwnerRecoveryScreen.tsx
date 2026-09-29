import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent, type JSX } from 'react'
import { PIN_RE, type DayoProbe } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, syncStatusKey, useBootstrap } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'
import { ConnectFields } from './ConnectFields'
import { DbErrorScreen } from './DbErrorScreen'

/**
 * ruling N2 — "เชื่อมใหม่ด้วยคีย์ใหม่": reached from the login screen's banner when no owner here can approve
 * with a PIN. No sign-in is needed to reach it. Controller ruling R1 (security): the address field is filled from
 * `bootstrap().dayoBaseUrl` and locked — recovery may only ever target the central address already stored on this
 * tablet, the same rule `recoverOwner` (Task 11) enforces server-side.
 */
export function OwnerRecoveryScreen(): JSX.Element {
  const api = useApi()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const boot = useBootstrap()

  const [apiKey, setApiKey] = useState('')
  const [probed, setProbed] = useState<DayoProbe | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Every hook above this line runs on every render (Rules of Hooks) — `boot.isPending`/`isError` below only
  // gate what JSX comes back, never how many hooks ran.
  const dayoBaseUrl = boot.data?.dayoBaseUrl ?? null

  const save = useMutation({
    mutationFn: () => {
      // quality review (fix round 1): a proper narrowing instead of `dayoBaseUrl ?? ''` — the save button only
      // ever renders once `dayoBaseUrl !== null` (below), so this never actually throws; it exists so the type
      // checker, not a silent empty string, is what would catch a future change that renders it too early.
      const baseUrl = dayoBaseUrl
      if (baseUrl === null) throw new Error('NEEDS_SETUP: no stored dayo address')
      return api.recoverOwner({ baseUrl, apiKey, ownerStaffId: ownerId ?? '', ownerPin: pin })
    },
    onSuccess: async () => {
      // fix round 2 item E: a brand-new key changes apiState/scope immediately — syncStatusKey too, not just bootstrapKey.
      await Promise.all([queryClient.invalidateQueries({ queryKey: bootstrapKey }), queryClient.invalidateQueries({ queryKey: syncStatusKey })])
      void navigate({ to: '/login' })
    },
    onError: (e) => {
      // fix round 3 item 4 (security): matches SetupScreen/SystemStatusScreen — a refused attempt must not leave
      // the PIN sitting in the field.
      setError(errorMessage(e))
      setPin('')
      setPin2('')
    },
  })

  if (boot.isPending) return <main className="page">{TH.loading}</main>
  if (boot.isError) return <DbErrorScreen error={boot.error} />

  const submit = (ev: FormEvent): void => {
    ev.preventDefault()
    setError(null)
    if (probed === null || ownerId === null) return
    if (pin !== pin2) return setError(TH.errPinMismatch)
    if (!PIN_RE.test(pin)) return setError(TH.errPinFormat)
    save.mutate()
  }

  return (
    <main className="page">
      <h1>{TH.ownerRecoveryTitle}</h1>
      <ol>
        <li>{TH.ownerRecoveryStep1}</li>
        <li>{TH.ownerRecoveryStep2}</li>
        <li>{TH.ownerRecoveryStep3}</li>
      </ol>
      {/* Task 14 · carried items 8/9 (Task 16): "เก็บกะนี้ไว้ในเครื่อง"/"ข้ามการตรวจเวลาที่ล้ำ" both still need an
          owner PIN that already works — this screen exists only because none does. Reachable from here as a
          pointer to where an owner whose PIN still works actually uses them (the status page's own banners point
          at the "ส่งไม่ผ่าน"/close-shift/issue-Z screens that carry the real PIN dialog), not a PIN flow
          duplicated on this screen itself. */}
      <p>
        {TH.ownerRecoveryOtherToolsHint}{' '}
        <button type="button" data-testid="owner-recovery-status-link" onClick={() => void navigate({ to: '/status' })}>
          {TH.statusTitle}
        </button>
      </p>
      {dayoBaseUrl === null ? (
        <p role="alert">{TH.ownerRecoveryNoAddress}</p>
      ) : (
        <form className="list" onSubmit={submit}>
          <ConnectFields value={{ baseUrl: dayoBaseUrl, apiKey }} onChange={(v) => setApiKey(v.apiKey)} onProbed={setProbed} lockBaseUrl />
          {probed !== null && (
            <>
              <div className="choices">
                {probed.owners.map((o) => (
                  <button key={o.id} type="button" aria-pressed={ownerId === o.id} data-testid={`recovery-owner-${o.displayName}`} onClick={() => setOwnerId(o.id)}>
                    {o.displayName}
                  </button>
                ))}
              </div>
              <label>
                {TH.setupPin}
                <input
                  data-testid="recovery-pin"
                  type="text"
                  className="text-mask"
                  name="recovery-owner-pin"
                  inputMode="numeric"
                  autoComplete="off"
                  autoCapitalize="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  required
                />
              </label>
              <label>
                {TH.setupPinConfirm}
                <input
                  data-testid="recovery-pin2"
                  type="text"
                  className="text-mask"
                  name="recovery-owner-pin-confirm"
                  inputMode="numeric"
                  autoComplete="off"
                  autoCapitalize="off"
                  value={pin2}
                  onChange={(e) => setPin2(e.target.value)}
                  required
                />
              </label>
              {error !== null && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button type="submit" className="primary" data-testid="recovery-save" disabled={save.isPending}>
                {TH.setupSave}
              </button>
            </>
          )}
        </form>
      )}
    </main>
  )
}
