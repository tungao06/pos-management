import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent, type JSX } from 'react'
import { PIN_RE } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'

type OwnerForm = { displayName: string; pin: string; pin2: string }

// Default owners from spec §1.3 (D48 Q3-16)
const DEFAULT_OWNERS: OwnerForm[] = [
  { displayName: 'TungAo', pin: '', pin2: '' },
  { displayName: 'DCm', pin: '', pin2: '' },
]

export function SetupScreen(): JSX.Element {
  const api = useApi()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [deviceName, setDeviceName] = useState<string>(TH.setupDeviceNameDefault)
  const [prefix, setPrefix] = useState('A')
  const [owners, setOwners] = useState<OwnerForm[]>(DEFAULT_OWNERS)
  const [promptPayId, setPromptPayId] = useState('') // typed on first setup, never in the repo (D48 Q3-3)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      api.setupShop({
        deviceName,
        receiptPrefix: prefix.trim().toUpperCase(),
        owners: owners.map((o) => ({ displayName: o.displayName, pin: o.pin })),
        promptPayId,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: bootstrapKey })
      void navigate({ to: '/' })
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const setOwner = (i: number, patch: Partial<OwnerForm>): void => setOwners((os) => os.map((o, j) => (j === i ? { ...o, ...patch } : o)))

  const submit = (ev: FormEvent): void => {
    ev.preventDefault()
    setError(null)
    for (const o of owners) {
      if (!PIN_RE.test(o.pin)) return setError(TH.errPinFormat)
      if (o.pin !== o.pin2) return setError(TH.errPinMismatch)
    }
    save.mutate()
  }

  return (
    <main className="page">
      <h1>{TH.setupTitle}</h1>
      <form className="list" onSubmit={submit}>
        <label>
          {TH.setupDeviceName}
          <input data-testid="setup-device-name" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} required />
        </label>
        <label>
          {TH.setupReceiptPrefix}
          <input data-testid="setup-prefix" value={prefix} maxLength={3} onChange={(e) => setPrefix(e.target.value)} required />
        </label>
        {owners.map((o, i) => (
          <fieldset key={i} className="list">
            <legend>{TH.setupOwner(i + 1)}</legend>
            <label>
              {TH.setupDisplayName}
              <input data-testid={`owner-${i}-name`} value={o.displayName} onChange={(e) => setOwner(i, { displayName: e.target.value })} required />
            </label>
            <label>
              {TH.setupPin}
              <input data-testid={`owner-${i}-pin`} type="password" inputMode="numeric" autoComplete="off" value={o.pin} onChange={(e) => setOwner(i, { pin: e.target.value })} required />
            </label>
            <label>
              {TH.setupPinConfirm}
              <input data-testid={`owner-${i}-pin2`} type="password" inputMode="numeric" autoComplete="off" value={o.pin2} onChange={(e) => setOwner(i, { pin2: e.target.value })} required />
            </label>
          </fieldset>
        ))}
        <label>
          {TH.setupPromptPayId}
          <input data-testid="setup-promptpay" inputMode="numeric" value={promptPayId} onChange={(e) => setPromptPayId(e.target.value)} required />
        </label>
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="primary" data-testid="setup-save" disabled={save.isPending}>
          {TH.setupSave}
        </button>
      </form>
    </main>
  )
}
