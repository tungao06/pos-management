import { useQuery } from '@tanstack/react-query'
import { useApi } from './api-context'
import { shiftReportKey } from './queries'

/**
 * Q3b-14 · D54: money leaving the drawer (a paid-out, a drop, or a receipt paid from the drawer — plan 4 Q4-6) larger
 * than the drawer's current expected cash is saved only after a second, explicit confirm. The figure comes from the
 * same X report as `/shift` but is never shown — the drawer stays counted blind (Q3b-3 · D52).
 *
 * `pending` is true while the comparison is not safe yet (review C-1/I-1 of plan 3b): the report is missing, or a
 * refetch is still in flight after an earlier write's `invalidateQueries` — `data` is then set but stale. Callers keep
 * their save button disabled while `pending`. `exceeds` answers only when not pending.
 */
export function useDrawerCheck(active: boolean): { pending: boolean; exceeds: (amountSatang: number) => boolean } {
  const api = useApi()
  const report = useQuery({ queryKey: shiftReportKey, queryFn: () => api.shiftReport(), enabled: active })
  const data = report.data
  const pending = active && (data === undefined || report.isFetching)
  return { pending, exceeds: (amountSatang) => data !== undefined && !report.isFetching && amountSatang > data.expectedCashSatang }
}
