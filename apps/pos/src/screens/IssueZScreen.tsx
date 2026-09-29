import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import { posErrorCode } from '../api/errors'
import type { CountSummaryDto, IssueZInput, OwnerApproval } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, issueZKey, useBootstrap, zKey, zListKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'
import { CountReview } from './CountReview'
import { OwnerApprovalDialog } from './OwnerApprovalDialog'

/**
 * D101 step 3 (spec §6.8): once online again, a counted shift's Z is issued from its already-saved count —
 * `countedSatang` (from `bootstrap().zWaiting`) is shown fixed, never re-typed (the drawer was already counted at
 * `/shift/close`). E4 (fetchBotCash) runs first so `countSummary` can answer with the real bot cash; on any E4
 * failure the count stays saved and waiting — this screen offers only "ลองใหม่", never a confirm button, so a Z is
 * never issued from stale or missing bot cash (ruling R7's whole point).
 */
export function IssueZScreen({ shiftId, countedSatang }: { shiftId: string; countedSatang: number }): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const boot = useBootstrap()
  const owners = (boot.data?.users ?? []).filter((u) => u.role === 'owner')
  const [issued, setIssued] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chainBroken, setChainBroken] = useState(false)
  const [chainCentralZNo, setChainCentralZNo] = useState<number | null>(null)
  const [botCashError, setBotCashError] = useState<string | null>(null)
  // Task 14 · carried item 9a (Task 16): a central shift whose Z can never be issued with dayo (E4 keeps failing
  // here, BOT_CASH_REQUIRED) — the owner keeps it on the tablet for good so R7 stops holding every later Z.
  const [keepDialogOpen, setKeepDialogOpen] = useState(false)

  const load = useQuery({
    queryKey: issueZKey(shiftId),
    queryFn: async (): Promise<CountSummaryDto> => {
      try {
        await api.fetchBotCash(shiftId)
        setBotCashError(null)
      } catch (e) {
        // fix round 2 item 2 (same as CloseShiftScreen): a plain OFFLINE means "no answer yet" — expected, silent —
        // but anything else (DAYO_BAD_RESPONSE, CLOCK_AHEAD, …) is worth telling the owner about, not swallowed.
        setBotCashError(posErrorCode(e) === 'OFFLINE' ? null : errorMessage(e))
      }
      return api.countSummary(shiftId)
    },
  })

  const keepShiftLocal = useMutation({
    mutationFn: (approval: OwnerApproval) => api.keepShiftLocal({ ...approval, shiftId }),
    onSuccess: async () => {
      setKeepDialogOpen(false)
      await Promise.all([queryClient.invalidateQueries({ queryKey: bootstrapKey }), queryClient.invalidateQueries({ queryKey: issueZKey(shiftId) })])
    },
  })

  const issueZ = useMutation({
    mutationFn: (input: IssueZInput) => api.issueZ(input),
    onSuccess: async () => {
      setIssued(true)
      setChainBroken(false)
      await Promise.all([queryClient.invalidateQueries({ queryKey: bootstrapKey }), queryClient.invalidateQueries({ queryKey: zListKey }), queryClient.invalidateQueries({ queryKey: zKey(shiftId) })])
    },
    onError: (e) => {
      // fix round 1 item 2: the same Z_CHAIN_BROKEN acknowledgement CloseShiftScreen offers — an owner who only
      // ever reaches this screen for a shift stuck waiting online must still be able to clear a broken chain.
      const code = posErrorCode(e)
      if (code === 'Z_CHAIN_BROKEN') {
        const detail = e instanceof Error ? e.message.slice(code.length + 2) : ''
        const centralLastZNo = boot.data?.centralLastZNo ?? null
        setChainBroken(true)
        setChainCentralZNo(detail === 'central' && centralLastZNo != null ? centralLastZNo : null)
        setError(null)
        return
      }
      setChainBroken(false)
      setError(errorMessage(e))
      if (code === 'SHIFT_CHANGED') void queryClient.invalidateQueries({ queryKey: issueZKey(shiftId) })
    },
  })

  if (load.isError) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(load.error)}
        </p>
        <button type="button" data-testid="z-retry" onClick={() => void load.refetch()}>
          {TH.retry}
        </button>
      </main>
    )
  }
  if (load.data === undefined) return <main className="page">{TH.loading}</main>
  const summary = load.data
  const online = summary.includesBotCash || summary.syncMode === 'local_only'

  if (issued) {
    return (
      <main className="page">
        <p data-testid="z-issued">{TH.zDone}</p>
        <div className="actions">
          <button type="button" data-testid="nav-z-list" onClick={() => void navigate({ to: '/z' })}>
            {TH.zList}
          </button>
        </div>
      </main>
    )
  }

  // ruling R7: an earlier counted shift of this device still has no Z — this one is refused (Z_NOT_READY) until
  // that one goes out first. Point straight at it instead of letting the owner discover it only after a PIN.
  if (summary.zBlockedBy !== null) {
    return (
      <main className="page">
        <h1>{TH.zIssue}</h1>
        <p role="alert" className="error" data-testid="count-z-blocked">
          {TH.errZNotReady}
        </p>
        <button type="button" data-testid="count-z-blocked-go" onClick={() => void navigate({ to: '/shift/z/$shiftId', params: { shiftId: summary.zBlockedBy! } })}>
          {TH.zBlockedGo}
        </button>
      </main>
    )
  }

  if (!online) {
    return (
      <main className="page">
        <h1>{TH.zIssue}</h1>
        <p role="alert" className="error">
          {TH.errBotCashRequired}
        </p>
        {botCashError !== null && (
          <p role="alert" className="error" data-testid="count-bot-cash-error">
            {botCashError}
          </p>
        )}
        <button type="button" data-testid="z-retry" onClick={() => void load.refetch()}>
          {TH.retry}
        </button>
        {/* Task 14 · carried item 9a (Task 16): shown prominently right where BOT_CASH_REQUIRED is stuck. */}
        <button type="button" className="banner error" data-testid="keep-shift-local-open" onClick={() => setKeepDialogOpen(true)}>
          {TH.keepShiftLocalButton}
        </button>
        {keepDialogOpen && (
          <OwnerApprovalDialog
            title={TH.keepShiftLocalButton}
            owners={owners}
            defaultApproverId={null}
            busy={keepShiftLocal.isPending}
            error={keepShiftLocal.isError ? errorMessage(keepShiftLocal.error) : null}
            extra={
              <p role="alert" className="error">
                {TH.keepShiftLocalWarning}
              </p>
            }
            onSubmit={(approval) => keepShiftLocal.mutate(approval)}
            onClose={() => setKeepDialogOpen(false)}
          />
        )}
      </main>
    )
  }

  return (
    <main className="page">
      <h1>{TH.zIssue}</h1>
      {botCashError !== null && (
        <p role="alert" className="error" data-testid="count-bot-cash-error">
          {botCashError}
        </p>
      )}
      <CountReview
        summary={summary}
        online={online}
        editable={false}
        countedSatang={countedSatang}
        owners={owners}
        confirmLabel={TH.zIssue}
        busy={issueZ.isPending}
        error={error}
        extraWarning={
          chainBroken && (
            <p role="alert" className="error" data-testid="close-chain-broken">
              {chainCentralZNo !== null ? TH.zChainCentral(chainCentralZNo) : TH.zChainAck}
            </p>
          )
        }
        onSubmit={({ pin, approverUserId, reason, bankQrTotalSatang }) => {
          setError(null)
          issueZ.mutate({
            shiftId,
            approverUserId,
            approverPin: pin,
            shownFingerprint: summary.fingerprint,
            varianceReason: reason,
            bankQrTotalSatang,
            acknowledgeZChainBroken: chainBroken,
          })
        }}
      />
    </main>
  )
}
