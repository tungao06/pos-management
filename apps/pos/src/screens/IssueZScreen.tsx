import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import { isCentralZBlockedError, isClockAheadCountError, posErrorCode } from '../api/errors'
import type { CountSummaryDto, IssueZInput, SkipCountFloorResult } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, issueZKey, useBootstrap, zKey, zListKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'
import { CountReview } from './CountReview'
import { KeepShiftLocalControl, SkipCountFloorControl } from './OwnerEscapeControls'

/**
 * D101 step 3 (spec §6.8): once online again, a counted shift's Z is issued from its already-saved count —
 * `countedSatang` (from `bootstrap().zWaiting`) is shown fixed, never re-typed (the drawer was already counted at
 * `/shift/close`). For a central shift without a stored E4 answer, E4 (fetchBotCash) runs between two `countSummary`
 * reads so the second can answer with the real bot cash (a local-only shift never asks E4 — final fix C1); on any E4
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
  // fix round 2 item B · fix round 3 item 2: prominent only for the SAME allowlist `issueZ` itself uses
  // (`isCentralZBlockedError`) — an unknown E4 error (a plain Error, SHIFT_NOT_COUNTING, the worker down, …) is
  // not proof of a permanent block either, so it stays the small secondary link, same as a recoverable one.
  const [botCashProminent, setBotCashProminent] = useState(false)
  // fix round 1 items 1a/3: issueZ refused for a reason this device's own retry can never fix — the owner keeps
  // the shift on the tablet for good (9a) or, for CLOCK_AHEAD specifically, skips the far-ahead count (9b).
  const [zBlockedPermanently, setZBlockedPermanently] = useState(false)
  const [zClockAheadBlocked, setZClockAheadBlocked] = useState(false)
  const [skipResult, setSkipResult] = useState<SkipCountFloorResult | null>(null)

  const load = useQuery({
    queryKey: issueZKey(shiftId),
    queryFn: async (): Promise<CountSummaryDto> => {
      // final fix C1: the same rule as CloseShiftScreen — countSummary first; E4 only for a CENTRAL shift whose stored
      // answer does not cover this count yet. A local-only shift has no bot cash (ruling R6): asking E4 for it is a
      // refusal, which painted an error on every local-only Z (after keepShiftLocal).
      const first = await api.countSummary(shiftId)
      if (first.syncMode !== 'central' || first.includesBotCash) {
        setBotCashError(null)
        setBotCashProminent(false)
        return first
      }
      try {
        await api.fetchBotCash(shiftId)
        setBotCashError(null)
        setBotCashProminent(false)
      } catch (e) {
        // fix round 1 item 2 (same as CloseShiftScreen): a plain OFFLINE means "no answer yet" — expected, silent —
        // but anything else (DAYO_BAD_RESPONSE, CLOCK_AHEAD, …) is worth telling the owner about, not swallowed.
        if (posErrorCode(e) === 'OFFLINE') {
          setBotCashError(null)
        } else {
          setBotCashError(errorMessage(e))
          setBotCashProminent(isCentralZBlockedError(e))
        }
        return first // nothing stored: the first read still stands
      }
      return api.countSummary(shiftId) // E4's answer is stored: read again with the bot cash in
    },
  })

  const issueZ: UseMutationResult<Awaited<ReturnType<typeof api.issueZ>>, unknown, IssueZInput> = useMutation({
    mutationFn: (input: IssueZInput) => api.issueZ(input),
    onSuccess: async () => {
      setIssued(true)
      setChainBroken(false)
      setZBlockedPermanently(false)
      setZClockAheadBlocked(false)
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
        setZBlockedPermanently(false)
        setZClockAheadBlocked(false)
        return
      }
      setChainBroken(false)
      setError(errorMessage(e))
      // fix round 1 item 1a · fix round 2 item D: DAYO_BAD_RESPONSE, Z_TOO_LARGE, COUNT_BEFORE_CENTRAL_Z, a builder
      // refusal — none of this device's own retries can fix them, and only while the shift is still `central`
      // (already local_only has nothing left for keepShiftLocal to do); item 3: CLOCK_AHEAD gets skipCountFloor
      // instead, same as CloseShiftScreen.
      setZBlockedPermanently(summary.syncMode === 'central' && isCentralZBlockedError(e))
      setZClockAheadBlocked(isClockAheadCountError(e))
      if (code === 'SHIFT_CHANGED') void queryClient.invalidateQueries({ queryKey: issueZKey(shiftId) })
    },
    // fix round 2 item A (security): `approverPin` sits in this mutation's `variables` while this screen stays
    // mounted (a Z_CHAIN_BROKEN retry, the review) — reset once settled, same as every other PIN mutation.
    onSettled: (): void => issueZ.reset(),
  })

  const clearBlocked = (): void => {
    setZBlockedPermanently(false)
    setZClockAheadBlocked(false)
    setError(null)
    void queryClient.invalidateQueries({ queryKey: issueZKey(shiftId) })
  }

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
        {/* fix round 1 item 1a/1b · fix round 2 item B · fix round 3 item 2: prominent only when the E4 error
            itself is allowlisted as a permanent central-Z block (`isCentralZBlockedError`, the same allowlist
            `issueZ` uses) — a recoverable answer, an unknown error, or a plain OFFLINE (still no answer, network
            may come back) all get the small secondary link only. */}
        <KeepShiftLocalControl shiftId={shiftId} owners={owners} prominent={botCashProminent} onDone={() => void load.refetch()} />
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
      {/* fix round 1 items 1a/3: issueZ itself refused for good — the same two escapes, right next to the error. */}
      {zBlockedPermanently && <KeepShiftLocalControl shiftId={shiftId} owners={owners} prominent onDone={clearBlocked} />}
      {zClockAheadBlocked && (
        <SkipCountFloorControl
          owners={owners}
          onDone={(r) => {
            setSkipResult(r)
            clearBlocked()
          }}
        />
      )}
      {skipResult !== null && (
        <p className="badge" data-testid="skip-count-floor-done">
          {TH.skipCountFloorDone(skipResult.skipped.length)} ({skipResult.skipped.map((s) => s.countedAt).join(', ')})
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
