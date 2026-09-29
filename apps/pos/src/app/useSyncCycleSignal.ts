import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { onSyncCycleDone } from '../sync/cycle-signal'
import { bootstrapKey, ordersKey, syncStatusKey } from './queries'

/**
 * Task 21 hotfix 2: mounted once at the router root. When the worker's scheduler finishes a cycle (an 'online' wake, the
 * minute tick, a debounced save — no click on this thread), re-read the bootstrap (the "ยังไม่ส่ง N" badge, every
 * banner) and the bill list (each bill's central state) at once, instead of on the 30 s poll, which stays as the fallback.
 */
export function useSyncCycleSignal(): void {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      onSyncCycleDone(() => {
        void queryClient.invalidateQueries({ queryKey: bootstrapKey })
        void queryClient.invalidateQueries({ queryKey: ordersKey })
        // fix (Task 17): StatusBanners prefers `syncStatus()`'s own cached data over `bootstrap().sync` once it has
        // answered once (fix round 2 item E) — invalidating bootstrapKey alone left the badge/every banner stuck on
        // a stale syncStatus answer until its own 30 s poll caught up.
        void queryClient.invalidateQueries({ queryKey: syncStatusKey })
      }),
    [queryClient],
  )
}
