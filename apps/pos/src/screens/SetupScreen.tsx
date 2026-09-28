import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent, type JSX } from 'react'
import type { DayoProbe } from '../api/types'
import { PIN_RE } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, useBootstrap } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'
import { ConnectFields, type ConnectFieldsValue } from './ConnectFields'
import { DbErrorScreen } from './DbErrorScreen'

/** True once the tablet already knows the receipt prefix this key must belong to — dayo's own last_receipt_no, or
 * (a legacy device linking for the first time) the prefix the device already sells under. Either way spec 04 §7
 * ข้อ 1's "ปรับตาม dayo" applies: the setup screen never lets a person pick a prefix themselves. */
function lockedPrefix(probe: DayoProbe, existingPrefix: string | undefined): string | null {
  return probe.requiredPrefix ?? existingPrefix ?? null
}

/**
 * security M1 (fix round 1): the e2e run's own address (playwright.config.ts bakes it into `VITE_DAYO_BASE_URL`)
 * is only ever a convenience default, and only for the dedicated e2e build — never a plain `pnpm build`. Reading
 * it unconditionally would leave `localhost:8787` sitting in a production bundle whenever a shell that built it
 * happened to still have the var set. Gating on `MODE` means a default-mode build's dead-code elimination drops
 * the reference (and the literal) entirely; `test/build-check.test.ts` builds for real and checks this.
 */
function defaultBaseUrl(): string {
  if (import.meta.env.MODE !== 'e2e') return ''
  return (import.meta.env.VITE_DAYO_BASE_URL as string | undefined) ?? ''
}

/**
 * spec 04 §7 ข้อ 1, §6.5, §6.6, §6.9: connects this tablet to dayo with an owner-issued API key (`connectShop`,
 * Task 11) — a brand-new device, or a plan-3/4 ("legacy") device not linked yet, approved here with an existing
 * owner PIN of this tablet (ruling R7). One page, no wizard steps: everything past "ทดสอบกุญแจ" only appears once
 * E1 has accepted the key (`probed !== null`), and the plumbing (address / key / probe / its errors) lives in
 * `<ConnectFields>` so Task 20's key-swap screen can reuse it unchanged.
 */
export function SetupScreen(): JSX.Element {
  const api = useApi()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const boot = useBootstrap()

  const [target, setTarget] = useState<ConnectFieldsValue>({ baseUrl: defaultBaseUrl(), apiKey: '' })
  const [probed, setProbed] = useState<DayoProbe | null>(null)
  const [prefix, setPrefix] = useState('')
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [promptPayId, setPromptPayId] = useState('')
  const [legacyUserId, setLegacyUserId] = useState<string | null>(null)
  const [legacyPin, setLegacyPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  const legacyDevice = boot.data?.legacyDevice === true
  const legacyOwners = (boot.data?.users ?? []).filter((u) => u.role === 'owner')

  const onProbed = (p: DayoProbe): void => {
    setProbed(p)
    setPrefix(lockedPrefix(p, boot.data?.device?.receiptPrefix) ?? '')
  }

  const save = useMutation({
    mutationFn: () =>
      api.connectShop({
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        receiptPrefix: prefix.trim().toUpperCase(),
        ownerStaffId: ownerId ?? '',
        ownerPin: pin,
        promptPayId,
        legacyApproval: legacyDevice ? { userId: legacyUserId ?? '', pin: legacyPin } : null,
      }),
    onSuccess: async () => {
      // spec §6.9: persistent storage is asked for once the tablet is actually linked — never before, and its
      // result is only ever shown, never blocks the flow (a "no" still leaves the tablet usable).
      let ok = false
      try {
        ok = (await navigator.storage?.persist?.()) ?? false
      } catch {
        ok = false
      }
      setPersisted(ok)
      await queryClient.invalidateQueries({ queryKey: bootstrapKey })
      // SECURITY (fix round 2): the key and every PIN typed on this screen have done their job once dayo has
      // accepted them — nothing past this point ever reads them again, so they must not keep sitting in memory.
      setTarget((t) => ({ ...t, apiKey: '' }))
      setPin('')
      setPin2('')
      setLegacyPin('')
      // quality review (fix round 1): stay on this screen so the persist-storage result is actually seen —
      // "setup-continue" (below) is what leaves it.
    },
    onError: (e) => {
      setError(errorMessage(e))
      setLegacyPin('') // M4 (fix round 1): a refused approval must not leave this PIN sitting in state
    },
  })

  const submit = (ev: FormEvent): void => {
    ev.preventDefault()
    setError(null)
    if (probed === null) return
    if (ownerId === null) return setError(TH.errChooseOwner)
    if (pin !== pin2) return setError(TH.errPinMismatch)
    if (!PIN_RE.test(pin)) return setError(TH.errPinFormat)
    if (legacyDevice && legacyUserId === null) return setError(TH.errChooseOwner)
    save.mutate()
  }

  if (boot.isError) return <DbErrorScreen error={boot.error} />

  if (save.isSuccess) {
    return (
      <main className="page">
        <h1>{TH.setupTitle}</h1>
        <p data-testid="setup-persist-status">{persisted === true ? TH.persistOk : TH.persistNo}</p>
        <button type="button" className="primary" data-testid="setup-continue" onClick={() => void navigate({ to: '/' })}>
          {TH.setupContinue}
        </button>
      </main>
    )
  }

  return (
    <main className="page">
      <h1>{TH.setupTitle}</h1>
      <form className="list" onSubmit={submit}>
        <ConnectFields value={target} onChange={setTarget} onProbed={onProbed} />
        {legacyDevice && (
          // Proof of who is linking this specific tablet — independent of testing the new key, so it does not
          // wait on `probed` (test 4, ruling R7): an old OWNER's PIN of THIS device (quality review: only owners
          // may approve a link, so only owners are offered here), not anything from dayo.
          <fieldset className="list">
            <legend>{TH.setupLinkTitle}</legend>
            <p>{TH.setupLegacyUser}</p>
            <div className="choices">
              {legacyOwners.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  aria-pressed={legacyUserId === u.id}
                  data-testid={`setup-legacy-user-${u.displayName}`}
                  onClick={() => setLegacyUserId(u.id)}
                >
                  {u.displayName}
                </button>
              ))}
            </div>
            <label>
              {TH.setupLegacyPin}
              <input
                data-testid="setup-legacy-pin"
                type="text"
                className="text-mask"
                name="legacy-owner-pin"
                inputMode="numeric"
                autoComplete="off"
                autoCapitalize="off"
                value={legacyPin}
                onChange={(e) => setLegacyPin(e.target.value)}
                required
              />
            </label>
          </fieldset>
        )}
        {probed !== null && (
          <>
            <p>{TH.setupChooseOwner}</p>
            <div className="choices">
              {probed.owners.map((o) => (
                <button key={o.id} type="button" aria-pressed={ownerId === o.id} data-testid={`setup-owner-${o.displayName}`} onClick={() => setOwnerId(o.id)}>
                  {o.displayName}
                </button>
              ))}
            </div>
            <label>
              {TH.setupReceiptPrefix}
              <input
                data-testid="setup-prefix"
                value={prefix}
                disabled={lockedPrefix(probed, boot.data?.device?.receiptPrefix) !== null}
                maxLength={3}
                onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                required
              />
            </label>
            <label>
              {TH.setupPin}
              <input
                data-testid="setup-pin"
                type="text"
                className="text-mask"
                name="owner-pin"
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
                data-testid="setup-pin2"
                type="text"
                className="text-mask"
                name="owner-pin-confirm"
                inputMode="numeric"
                autoComplete="off"
                autoCapitalize="off"
                value={pin2}
                onChange={(e) => setPin2(e.target.value)}
                required
              />
            </label>
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
          </>
        )}
      </form>
    </main>
  )
}
