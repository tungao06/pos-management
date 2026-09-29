import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type JSX } from 'react'
import { CASH_DENOMINATIONS_SATANG, type CashCountLine } from '@dayo/domain'
import { posErrorCode } from '../api/errors'
import type { ConfirmCountInput } from '../api/types'
import { useApi } from '../app/api-context'
import { useCart } from '../app/cart-context'
import { bootstrapKey, countSummaryKey, ordersKey, useBootstrap, zListKey } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'
import { CountReview } from './CountReview'

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
  const [lines, setLines] = useState<CashCountLine[]>(() => CASH_DENOMINATIONS_SATANG.map((d) => ({ denominationSatang: d, count: 0 })))
  const [chainBroken, setChainBroken] = useState(false)
  const [chainCentralZNo, setChainCentralZNo] = useState<number | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [savedOffline, setSavedOffline] = useState<string | null>(null) // the shiftId of a count confirmed offline (z: null)
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
      setShiftId(r.shiftId)
      setCounted(true)
    },
    onError: (e) => setConfirmError(errorMessage(e)),
  })

  const summaryQuery = useQuery({
    queryKey: countSummaryKey(shiftId ?? ''),
    queryFn: () => api.countSummary(shiftId!),
    enabled: shiftId !== null,
  })

  // ladder item 1: a central shift whose stored E4 answer does not cover this count yet tries fetchBotCash once —
  // its own outcome never chooses the path (review item 1 of Task 12): only the countSummary read right after does.
  useEffect(() => {
    const s = summaryQuery.data
    if (s === undefined || shiftId === null || triedBotCash.current === shiftId) return
    if (s.syncMode === 'central' && !s.includesBotCash) {
      triedBotCash.current = shiftId
      void api
        .fetchBotCash(shiftId)
        .catch(() => undefined)
        .then(() => queryClient.invalidateQueries({ queryKey: countSummaryKey(shiftId) }))
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
        // Task 13 (parallel worktree, not merged yet) adds `centralLastZNo?: number | null` to `BootstrapState`
        // (apps/pos/src/api/types.ts) — read defensively so this screen compiles today and picks up the real
        // field once that merges; remove this cast then. Only surfaced in this Z_CHAIN_BROKEN "central" branch,
        // never as a general status figure.
        const centralLastZNo: number | null | undefined = (boot.data as unknown as { centralLastZNo?: number | null | undefined } | undefined)?.centralLastZNo
        setChainBroken(true)
        setChainCentralZNo(detail === 'central' && centralLastZNo != null ? centralLastZNo : null)
        setConfirmError(null)
        return
      }
      setChainBroken(false)
      setConfirmError(errorMessage(e))
      if (code === 'NO_OPEN_SHIFT' || code === 'SHIFT_NOT_COUNTING') {
        void queryClient.invalidateQueries({ queryKey: bootstrapKey })
      }
      if (code === 'SHIFT_CHANGED' && shiftId !== null) {
        setResetNonce((n) => n + 1) // review: count again, blind — the typed count and PIN attempt are discarded
        void queryClient.invalidateQueries({ queryKey: countSummaryKey(shiftId) })
      }
    },
  })

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

  const summary = summaryQuery.data ?? null
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
      {summary !== null && summary.zBlockedBy !== null && (
        <p role="alert" className="error" data-testid="count-z-blocked">
          {TH.errZNotReady}
        </p>
      )}
      <CountReview
        key={resetNonce}
        summary={summary}
        online={online}
        editable
        countedSatang={0}
        onLinesChange={setLines}
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
          !counted && (
            <div className="actions sticky-foot">
              <button
                type="button"
                className="primary"
                data-testid="count-finish"
                disabled={finish.isPending || cart.state.lines.length > 0}
                onClick={() => finish.mutate()}
              >
                {TH.countFinish}
              </button>
            </div>
          )
        }
        onSubmit={(pin, approverUserId, reason) => {
          if (shiftId === null || summary === null) return
          confirm.mutate({
            shiftId,
            actorUserId: user?.id ?? '',
            approverUserId,
            approverPin: pin,
            countLines: lines,
            shownFingerprint: summary.fingerprint,
            z: online ? { varianceReason: reason, bankQrTotalSatang: null, acknowledgeZChainBroken: chainBroken } : null,
          })
        }}
      />
    </main>
  )
}
