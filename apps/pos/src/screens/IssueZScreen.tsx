import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import type { CountSummaryDto, IssueZInput } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, issueZKey, useBootstrap, zKey, zListKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'
import { CountReview } from './CountReview'

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

  const load = useQuery({
    queryKey: issueZKey(shiftId),
    queryFn: async (): Promise<CountSummaryDto> => {
      try {
        await api.fetchBotCash(shiftId)
      } catch {
        // ignored here — `countSummary.includesBotCash` is what decides the path (review item 1 of Task 12)
      }
      return api.countSummary(shiftId)
    },
  })

  const issueZ = useMutation({
    mutationFn: (input: IssueZInput) => api.issueZ(input),
    onSuccess: async () => {
      setIssued(true)
      await Promise.all([queryClient.invalidateQueries({ queryKey: bootstrapKey }), queryClient.invalidateQueries({ queryKey: zListKey }), queryClient.invalidateQueries({ queryKey: zKey(shiftId) })])
    },
    onError: (e) => setError(errorMessage(e)),
  })

  if (load.isError) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(load.error)}
        </p>
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

  if (!online) {
    return (
      <main className="page">
        <h1>{TH.zIssue}</h1>
        <p role="alert" className="error">
          {TH.errBotCashRequired}
        </p>
        <button type="button" data-testid="z-retry" onClick={() => void load.refetch()}>
          {TH.retry}
        </button>
      </main>
    )
  }

  return (
    <main className="page">
      <h1>{TH.zIssue}</h1>
      <CountReview
        summary={summary}
        online={online}
        editable={false}
        countedSatang={countedSatang}
        owners={owners}
        confirmLabel={TH.zIssue}
        busy={issueZ.isPending}
        error={error}
        onSubmit={(pin, approverUserId, reason) => {
          setError(null)
          issueZ.mutate({
            shiftId,
            approverUserId,
            approverPin: pin,
            shownFingerprint: summary.fingerprint,
            varianceReason: reason,
            bankQrTotalSatang: null,
            acknowledgeZChainBroken: false,
          })
        }}
      />
    </main>
  )
}
