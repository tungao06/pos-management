import { useQuery } from '@tanstack/react-query'
import { useApi } from './api-context'

export const bootstrapKey = ['bootstrap'] as const
export const menuKey = ['menu'] as const
export const sellCatalogKey = ['sell-catalog'] as const
export const ordersKey = ['orders'] as const
export const orderKey = (orderId: string) => ['order', orderId] as const
export const zListKey = ['z-list'] as const
export const zKey = (shiftId: string) => ['z', shiftId] as const
export const shiftReportKey = ['shift-report'] as const
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
