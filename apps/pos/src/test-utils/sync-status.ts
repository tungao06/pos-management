import type { SyncStatusDto } from '../api/types'

/** A healthy, linked sync status for screen tests that build a BootstrapState by hand (Task 14 added `sync`). */
export const HEALTHY_SYNC: SyncStatusDto = {
  linked: true, apiState: 'ok', maskedKey: 'dayo_…cdef', baseUrl: 'https://dayo.example/api/v1', clockSkewMs: 0, clockWarning: false,
  pricingMismatch: false, pricingCommit: null, catalogVersion: 42, catalogCheckedAt: '2026-09-17T02:58:00.000Z', catalogError: null, lastPushAt: '2026-09-17T02:59:30.000Z',
  pendingSyncRows: 0, problemSyncRows: 0, oldestPendingAt: null, pendingOver24h: false, priceDiffBills: 0, clockFarAheadBills: 0,
  scopeWait: null, shiftDataConflict: false, centralMismatchBills: 0, shiftLaneHeld: null,
}
