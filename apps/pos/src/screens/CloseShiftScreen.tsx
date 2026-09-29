import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type JSX } from 'react'
import { isCentralZBlockedError, isClockAheadCountError, posErrorCode } from '../api/errors'
import type { ConfirmCountInput, SkipCountFloorResult } from '../api/types'
import { useApi } from '../app/api-context'
import { useCart } from '../app/cart-context'
import { bootstrapKey, countSummaryKey, ordersKey, useBootstrap, zListKey } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'
import { CountReview } from './CountReview'
import { KeepShiftLocalControl, SkipCountFloorControl } from './OwnerEscapeControls'

/**
 * D101 (spec 04 §6.8 · §4.10): "นับเสร็จ" (finishCount) freezes the open shift → `countSummary` shows the review,
 * blind (Q3b-3 · D52) until that moment — the same denomination inputs (`CountReview`, `editable`) are on screen
 * before and after, only the review figures below them appear once the count is frozen. `online` (review item 1 of
 * Task 12) decides everything from there: a central shift with the stored E4 answer, or ANY local-only shift
 * (ruling R6), issues its Z in the same PIN as the count; everything else confirms the count alone (`z: null`) and
 * waits for `/shift/z/$shiftId` once online again.
 */
export function CloseShiftScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const boot = useBootstrap()
  const { user } = useSession()
  const cart = useCart()

  const [shiftId, setShiftId] = useState<string | null>(null)
  const [counted, setCounted] = useState(false) // finishCount already ran (this session, or resumed from `countingShift`)
  // fix round 1 item 6 (D52 · old `setShown(null)` behaviour): true right after finishCount lands and after a
  // SHIFT_CHANGED refusal, until the owner presses "นับเสร็จ" again — `summary` below is forced back to null while
  // this is true, so the expected cash/variance never show a figure that might already be stale.
  const [blind, setBlind] = useState(false)
  const [chainBroken, setChainBroken] = useState(false)
  const [chainCentralZNo, setChainCentralZNo] = useState<number | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [botCashError, setBotCashError] = useState<string | null>(null)
  const [savedOffline, setSavedOffline] = useState<string | null>(null) // the shiftId of a count confirmed offline (z: null)
  // Task 14 · carried items 9a/9b — fix round 1 items 1a/1: a far-ahead count (CLOCK_AHEAD) or a permanently
  // blocked central Z (DAYO_BAD_RESPONSE, Z_TOO_LARGE, COUNT_BEFORE_CENTRAL_Z, a builder refusal) both need an
  // owner escape (`isCentralZBlockedError`/`isClockAheadCountError`, api/errors.ts).
  const [clockAheadBlocked, setClockAheadBlocked] = useState(false)
  const [zBlockedPermanently, setZBlockedPermanently] = useState(false)
  const [skipResult, setSkipResult] = useState<SkipCountFloorResult | null>(null)
  // SHIFT_CHANGED (D54): bumped to remount `CountReview` fresh (`key`) — the typed count, chosen approver and
  // reason are all discarded, same as the old screen's "count again, blind" (review kept this behaviour deliberately).
  const [resetNonce, setResetNonce] = useState(0)
  const triedBotCash = useRef<string | null>(null)

  // ladder item 5: reopened while this device has a shift still 'counting' — resume straight at the review, never
  // re-run finishCount (the shift already stopped taking bills).
  useEffect(() => {
    if (!counted && boot.data?.countingShift) {
      setShiftId(boot.data.countingShift.shiftId)
      setCounted(true)
    }
  }, [boot.data, counted])

  const finish = useMutation({
    mutationFn: () => api.finishCount({ actorUserId: user?.id ?? '' }),
    onSuccess: (r) => {
      setConfirmError(null)
      setClockAheadBlocked(false)
      setShiftId(r.shiftId)
      setCounted(true)
      setBlind(false)
    },
    onError: (e) => {
      setConfirmError(errorMessage(e))
      setClockAheadBlocked(isClockAheadCountError(e))
    },
  })

  const summaryQuery = useQuery({
    queryKey: countSummaryKey(shiftId ?? ''),
    queryFn: () => api.countSummary(shiftId!),
    enabled: shiftId !== null,
  })

  // fix round 2 item 1: a countSummary refusal (SHIFT_NOT_COUNTING after some other tab closed it, a transient
  // read failure, …) must not unmount `CountReview` — that threw away whatever the owner had already typed. Going
  // blind (same D52 "count again" gate SHIFT_CHANGED uses) instead keeps the denomination inputs exactly as they
  // were, shows the error + a retry inline, and — even once the retry succeeds — never pops the review back open
  // by itself; "นับเสร็จ" still does that, same as every other blind → reviewed transition on this screen.
  useEffect(() => {
    if (summaryQuery.isError) setBlind(true)
  }, [summaryQuery.isError])

  // ladder item 1 · fix round 1 item 8: a central shift whose stored E4 answer does not cover this count yet tries
  // fetchBotCash once — its own outcome never chooses the path (review item 1 of Task 12): only the countSummary
  // read right after does. But a failure worth telling the owner about (DAYO_BAD_RESPONSE, CLOCK_AHEAD, a far-ahead
  // count, …) must not be swallowed the way a plain OFFLINE is — that one alone means "count without bot cash" is
  // the expected, silent path.
  useEffect(() => {
    const s = summaryQuery.data
    if (s === undefined || shiftId === null || triedBotCash.current === shiftId) return
    if (s.syncMode === 'central' && !s.includesBotCash) {
      triedBotCash.current = shiftId
      api
        .fetchBotCash(shiftId)
        .then(() => setBotCashError(null))
        .catch((e: unknown) => setBotCashError(posErrorCode(e) === 'OFFLINE' ? null : errorMessage(e)))
        .finally(() => void queryClient.invalidateQueries({ queryKey: countSummaryKey(shiftId) }))
    }
  }, [summaryQuery.data, shiftId, api, queryClient])

  const confirm = useMutation({
    mutationFn: (input: ConfirmCountInput) => api.confirmCount(input),
    onSuccess: async (r) => {
      setConfirmError(null)
      setChainBroken(false)
      if (r.z !== null) {
        void navigate({ to: '/z/$shiftId', params: { shiftId: shiftId ?? '' } })
      } else {
        setSavedOffline(shiftId)
      }
      queryClient.removeQueries({ queryKey: countSummaryKey(shiftId ?? '') })
      await Promise.all([bootstrapKey, zListKey, ordersKey].map((k) => queryClient.invalidateQueries({ queryKey: k })))
    },
    onError: (e) => {
      const code = posErrorCode(e)
      if (code === 'Z_CHAIN_BROKEN') {
        const detail = e instanceof Error ? e.message.slice(code.length + 2) : ''
        // Task 13 (ruling R9): shown only in this Z_CHAIN_BROKEN "central" branch, never as a general status figure.
        const centralLastZNo = boot.data?.centralLastZNo ?? null
        setChainBroken(true)
        setChainCentralZNo(detail === 'central' && centralLastZNo != null ? centralLastZNo : null)
        setConfirmError(null)
        setClockAheadBlocked(false)
        setZBlockedPermanently(false)
        return
      }
      setChainBroken(false)
      setConfirmError(errorMessage(e))
      setClockAheadBlocked(isClockAheadCountError(e))
      // fix round 1 item 1a: only while a Z was actually being attempted (`online`) — confirming the count alone
      // (`z: null`) never runs `writeZ`, so this never fires there.
      setZBlockedPermanently(online && isCentralZBlockedError(e))
      if (code === 'NO_OPEN_SHIFT' || code === 'SHIFT_NOT_COUNTING') {
        void queryClient.invalidateQueries({ queryKey: bootstrapKey })
      }
      if (code === 'SHIFT_CHANGED' && shiftId !== null) {
        // fix round 1 items 5 · 6: the owner never saw these new figures — go fully blind again (hide
        // expected/variance, drop the stale count and PIN) until "นับเสร็จ" is pressed once more, against a
        // freshly reloaded summary.
        setResetNonce((n) => n + 1)
        setBlind(true)
        void queryClient.invalidateQueries({ queryKey: countSummaryKey(shiftId) })
      }
    },
  })

  const clearBlocked = (): void => {
    setClockAheadBlocked(false)
    setZBlockedPermanently(false)
    setConfirmError(null)
    if (shiftId !== null) void queryClient.invalidateQueries({ queryKey: countSummaryKey(shiftId) })
  }

  if (boot.data !== undefined && boot.data.openShift === null && boot.data.countingShift === null && savedOffline === null) return <Navigate to="/shift/open" />

  if (savedOffline !== null) {
    return (
      <main className="page">
        <h1>{TH.closeTitle}</h1>
        <p data-testid="count-saved-offline">{TH.countSavedOffline}</p>
        <div className="actions">
          <button type="button" className="primary" data-testid="nav-shift-open" onClick={() => void navigate({ to: '/shift/open' })}>
            {TH.shiftOpen}
          </button>
        </div>
      </main>
    )
  }

  const summary = blind ? null : (summaryQuery.data ?? null)
  const online = summary !== null && summary.zBlockedBy === null && (summary.includesBotCash || summary.syncMode === 'local_only')

  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-sell" onClick={() => void navigate({ to: '/sell' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.closeTitle}</h1>
      {cart.state.lines.length > 0 && (
        <p role="alert" className="error" data-testid="close-cart-not-empty">
          {TH.cartNotEmpty}
        </p>
      )}
      {counted && (
        <p className="badge" data-testid="count-frozen">
          {TH.countFrozen}
        </p>
      )}
      {summary !== null && summary.zBlockedBy !== null && (
        <p role="alert" className="error" data-testid="count-z-blocked">
          {TH.errZNotReady}
          <button type="button" data-testid="count-z-blocked-go" onClick={() => void navigate({ to: '/shift/z/$shiftId', params: { shiftId: summary.zBlockedBy! } })}>
            {TH.zBlockedGo}
          </button>
        </p>
      )}
      {/* Task 14 · carried items 9a/9b — fix round 1 items 1a/3: shown right where "นับเสร็จ"/"ยืนยัน" refused
          for a reason this device's own retry can never fix — the risk/warning shown before the PIN either way. */}
      {clockAheadBlocked && (
        <SkipCountFloorControl
          owners={(boot.data?.users ?? []).filter((u) => u.role === 'owner')}
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
      {zBlockedPermanently && shiftId !== null && <KeepShiftLocalControl shiftId={shiftId} owners={(boot.data?.users ?? []).filter((u) => u.role === 'owner')} prominent onDone={clearBlocked} />}
      {botCashError !== null && (
        <p role="alert" className="error" data-testid="count-bot-cash-error">
          {botCashError}
        </p>
      )}
      {summaryQuery.isError && (
        <>
          <p role="alert" className="error">
            {errorMessage(summaryQuery.error)}
          </p>
          <button type="button" data-testid="count-summary-retry" onClick={() => void summaryQuery.refetch()}>
            {TH.retry}
          </button>
        </>
      )}
      <CountReview
        key={resetNonce}
        summary={summary}
        online={online}
        editable
        countedSatang={0}
        owners={(boot.data?.users ?? []).filter((u) => u.role === 'owner')}
        confirmLabel={online ? TH.countConfirmOnline : TH.countConfirmOffline}
        busy={confirm.isPending}
        error={confirmError}
        extraWarning={
          chainBroken && (
            <p role="alert" className="error" data-testid="close-chain-broken">
              {chainCentralZNo !== null ? TH.zChainCentral(chainCentralZNo) : TH.zChainAck}
            </p>
          )
        }
        finishSlot={
          (!counted || blind) && (
            <div className="actions sticky-foot">
              <button
                type="button"
                className="primary"
                data-testid="count-finish"
                disabled={(!counted && finish.isPending) || (blind && (summaryQuery.isFetching || summaryQuery.isError)) || cart.state.lines.length > 0}
                onClick={() => {
                  if (!counted) {
                    finish.mutate()
                    return
                  }
                  // review already re-fetched (the SHIFT_CHANGED handler above invalidated it) — this only lifts
                  // the blind curtain back up, never re-runs finishCount on an already-counting shift.
                  setConfirmError(null) // fix round 2 item 3: a lingering errShiftChanged must not follow the owner into the recount
                  setBlind(false)
                }}
              >
                {TH.countFinish}
              </button>
            </div>
          )
        }
        onSubmit={({ pin, approverUserId, reason, bankQrTotalSatang, lines }) => {
          if (shiftId === null || summary === null) return
          confirm.mutate({
            shiftId,
            actorUserId: user?.id ?? '',
            approverUserId,
            approverPin: pin,
            countLines: lines,
            shownFingerprint: summary.fingerprint,
            z: online ? { varianceReason: reason, bankQrTotalSatang, acknowledgeZChainBroken: chainBroken } : null,
          })
        }}
      />
    </main>
  )
}
