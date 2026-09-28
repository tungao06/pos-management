import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type JSX } from 'react'
import type { ApiState } from '../sync/state'
import type { DayoProbe } from '../api/types'
import { PIN_RE } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import { APP_VERSION } from '../lib/app-version'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'
import { ConnectFields, type ConnectFieldsValue } from './ConnectFields'
import { DbErrorScreen } from './DbErrorScreen'

const DATE_TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'medium' })
const fmt = (iso: string | null): string | null => (iso === null ? null : DATE_TIME.format(new Date(iso)))

const API_STATE_LABEL: Record<ApiState, string> = TH.statusApiStates

/**
 * spec 04 §4.3, §6.7, §10.5, §7 ข้อ 1 (D80): every role reads this page — it is the one place every figure of
 * `SyncStatusDto` is spelled out, whatever a `StatusBanners` may or may not be showing right now. Only an owner
 * gets the "ตั้งกุญแจใหม่" section (`replaceApiKey`, Task 11/14) — the address field stays locked to the address
 * already stored on this tablet (controller ruling R1, the same rule `ConnectFields`'s `lockBaseUrl` enforces on
 * `OwnerRecoveryScreen`).
 */
export function SystemStatusScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const boot = useBootstrap()
  const { user } = useSession()

  const [apiKey, setApiKey] = useState('')
  const [probed, setProbed] = useState<DayoProbe | null>(null)
  const [approverId, setApproverId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [replaceError, setReplaceError] = useState<string | null>(null)
  const [replaceDone, setReplaceDone] = useState(false)

  // D50 Q3-22: the signed-in owner is preselected — but `user` is only known once `<SessionProvider>` has
  // signed someone in, which can (in a test, or a fast reload) commit after this screen's first render; a plain
  // `useState` initializer would freeze on the `null` it saw then and never update (fix round, this task).
  useEffect(() => {
    if (approverId === null && user?.role === 'owner') setApproverId(user.id)
  }, [user, approverId])

  const syncNow = useMutation({
    mutationFn: () => api.syncNow(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bootstrapKey }),
  })

  const dayoBaseUrl = boot.data?.dayoBaseUrl ?? null
  const replace = useMutation({
    mutationFn: () => {
      const baseUrl = dayoBaseUrl
      if (baseUrl === null) throw new Error('NEEDS_SETUP: no stored dayo address')
      return api.replaceApiKey({ baseUrl, apiKey, approverUserId: approverId ?? '', approverPin: pin })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: bootstrapKey })
      setReplaceDone(true)
      setApiKey('')
      setProbed(null)
      setPin('')
    },
    onError: (e) => {
      setReplaceError(errorMessage(e))
      setPin('')
    },
  })

  if (boot.isPending) return <main className="page">{TH.loading}</main>
  if (boot.isError) return <DbErrorScreen error={boot.error} />

  const sync = boot.data.sync
  const isOwner = user !== null && user.role === 'owner'
  const owners = boot.data.users.filter((u) => u.role === 'owner')

  const submitReplace = (): void => {
    if (probed === null) return
    if (approverId === null) return setReplaceError(TH.errNotOwner)
    // SECURITY (fix round 2, parked Low): a blank/malformed PIN must never reach the API — every attempt that does
    // burns one of the login-lockout attempts (same PIN_RE rule OwnerApprovalDialog already applies).
    if (!PIN_RE.test(pin)) return setReplaceError(TH.errPinFormat)
    setReplaceError(null)
    replace.mutate()
  }

  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="status-back" onClick={() => void navigate({ to: '/sell' })}>
          {TH.back}
        </button>
        <button type="button" data-testid="status-sync-now" disabled={syncNow.isPending} onClick={() => syncNow.mutate()}>
          {TH.statusSyncNow}
        </button>
      </div>
      <h1>{TH.statusTitle}</h1>
      <div className="list">
        {/* fu app-version: build time shown in the same Bangkok format every other sync timestamp on this screen uses */}
        <p data-testid="status-app-version">{TH.statusVersionLine(APP_VERSION.version, APP_VERSION.commit, fmt(APP_VERSION.builtAt) ?? APP_VERSION.builtAt)}</p>
        <p data-testid="status-key">
          {TH.statusKeyLabel}: {sync.maskedKey ?? TH.statusNotLinked}
        </p>
        <p data-testid="status-base-url">
          {TH.statusBaseUrlLabel}: {sync.baseUrl ?? TH.statusNotLinked}
        </p>
        <p data-testid="status-api-state">
          {TH.statusApiStateLabel}: {sync.apiState === null ? TH.statusApiStateUnknown : API_STATE_LABEL[sync.apiState]}
        </p>
        <p data-testid="status-clock">
          {sync.clockSkewMs === null
            ? TH.statusClockNever
            : sync.clockWarning
              ? TH.statusClockWarn(Math.round(Math.abs(sync.clockSkewMs) / 60_000))
              : TH.statusClockOk(Math.round(Math.abs(sync.clockSkewMs) / 60_000))}
        </p>
        <p data-testid="status-catalog">{sync.catalogCheckedAt === null ? TH.statusCatalogNever : TH.statusCatalogLine(String(sync.catalogVersion ?? '—'), fmt(sync.catalogCheckedAt) ?? '—')}</p>
        <p data-testid="status-pricing">
          {sync.pricingMismatch
            ? TH.statusPricingMismatch
            : sync.pricingCommit === null
              ? TH.statusPricingCommitUnknown
              : TH.statusPricingCommitLabel(sync.pricingCommit)}
        </p>
        <p data-testid="status-last-push">{sync.lastPushAt === null ? TH.statusLastPushNever : TH.statusLastPush(fmt(sync.lastPushAt) ?? '—')}</p>
        <p data-testid="status-pending">{TH.statusPendingLine(sync.pendingBills)}</p>
        {isOwner ? (
          <button type="button" data-testid="status-problems-link" onClick={() => void navigate({ to: '/sync-problems' })}>
            {TH.statusProblemsLine(sync.problemBills)}
          </button>
        ) : (
          <p data-testid="status-problems">{TH.statusProblemsLine(sync.problemBills)}</p>
        )}
        {isOwner ? (
          <button type="button" data-testid="status-price-diff-link" onClick={() => void navigate({ to: '/price-diffs' })}>
            {TH.statusPriceDiffLine(sync.priceDiffBills)}
          </button>
        ) : (
          <p data-testid="status-price-diff">{TH.statusPriceDiffLine(sync.priceDiffBills)}</p>
        )}
      </div>
      {isOwner && (
        <section className="list" data-testid="status-replace-key">
          <h2>{TH.statusReplaceKeyTitle}</h2>
          {dayoBaseUrl === null ? (
            <p role="alert">{TH.ownerRecoveryNoAddress}</p>
          ) : (
            <>
              <ConnectFields value={{ baseUrl: dayoBaseUrl, apiKey }} onChange={(v: ConnectFieldsValue) => setApiKey(v.apiKey)} onProbed={setProbed} lockBaseUrl />
              {probed !== null && (
                <>
                  <h3>{TH.statusReplaceKeyApprover}</h3>
                  <div className="choices">
                    {owners.map((o) => (
                      <button key={o.id} type="button" data-testid={`status-replace-key-approver-${o.displayName}`} aria-pressed={approverId === o.id} onClick={() => setApproverId(o.id)}>
                        {o.displayName}
                      </button>
                    ))}
                  </div>
                  <label>
                    {TH.statusReplaceKeyPin}
                    <input
                      data-testid="status-replace-key-pin"
                      type="text"
                      className="text-mask"
                      name="status-replace-key-pin"
                      inputMode="numeric"
                      autoComplete="off"
                      autoCapitalize="off"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                    />
                  </label>
                  {replaceError !== null && (
                    <p role="alert" className="error">
                      {replaceError}
                    </p>
                  )}
                  {replaceDone && <p data-testid="status-replace-key-done">{TH.statusReplaceKeyDone}</p>}
                  <button type="button" className="primary" data-testid="status-replace-key-save" disabled={replace.isPending} onClick={submitReplace}>
                    {TH.statusReplaceKeySave}
                  </button>
                </>
              )}
            </>
          )}
        </section>
      )}
    </main>
  )
}
