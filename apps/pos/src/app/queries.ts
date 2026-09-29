import { useQuery } from '@tanstack/react-query'
import { useApi } from './api-context'

export const bootstrapKey = ['bootstrap'] as const
export const drinkCatalogKey = ['drink-catalog'] as const
export const sellCatalogKey = ['sell-catalog'] as const
export const ordersKey = ['orders'] as const
export const orderKey = (orderId: string) => ['order', orderId] as const
export const zListKey = ['z-list'] as const
export const zKey = (shiftId: string) => ['z', shiftId] as const
export const shiftReportKey = ['shift-report'] as const
/** D101 · block 3 count/Z screens (Task 15). */
export const countSummaryKey = (shiftId: string) => ['count-summary', shiftId] as const
export const issueZKey = (shiftId: string) => ['issue-z', shiftId] as const
export const stockKey = ['stock'] as const
export const stockCountKey = ['stock-count'] as const
export const centralOrdersKey = ['central-orders'] as const
export const priceDiffsKey = (actorUserId: string) => ['price-diffs', actorUserId] as const
export const syncProblemsKey = (actorUserId: string) => ['sync-problems', actorUserId] as const

/** Task 20: every screen's `StatusBanners` reads `sync` off this — refetched every 30 s so a key revoked or a
 * problem raised on another tab of the same tablet shows up here without a manual reload. */
export const BOOTSTRAP_REFETCH_MS = 30_000

export function useBootstrap() {
  const api = useApi()
  return useQuery({ queryKey: bootstrapKey, queryFn: () => api.bootstrap(), refetchInterval: BOOTSTRAP_REFETCH_MS })
}

/**
 * Task 16 (block 3 · spec §6.2 m1 · S5 · m2): the sync-health banners (`scopeWait`/`shiftDataConflict`/
 * `centralMismatchBills`/`shiftLaneHeld`) come from their own poll — same `syncStatus()` call `bootstrap` embeds,
 * but on its own cadence so they do not wait on the whole `bootstrap` round trip. `StatusBanners` falls back to
 * `bootstrap().sync` (unchanged since Task 14) whenever this one has not answered yet — offline first render, or a
 * fake api in a screen test that stubs `bootstrap` alone.
 */
export const syncStatusKey = ['sync-status'] as const
export function useSyncStatus() {
  const api = useApi()
  return useQuery({ queryKey: syncStatusKey, queryFn: () => api.syncStatus(), refetchInterval: BOOTSTRAP_REFETCH_MS, retry: false })
}
