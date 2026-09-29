import { useNavigate } from '@tanstack/react-router'
import type { JSX } from 'react'
import { can, type PosRole } from '../app/permissions'
import { useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import type { SyncStatusDto, WaitingZDto } from '../api/types'
import { formatThaiDate } from '../ui/format'
import { TH } from '../ui/th'

/** Server clock minus device clock, in whole minutes, always positive — the exact sign never matters on screen. */
function skewMinutes(clockSkewMs: number | null): number {
  return Math.round(Math.abs(clockSkewMs ?? 0) / 60_000)
}

/**
 * The warning table of spec §4.4 ข้อ 9, §6.3, §6.4, §6.7, §10.5 (D80 · ruling R8 · ruling N5) — shown on every
 * screen after login, top to bottom in the table's own order. Every banner reads straight off `SyncStatusDto`;
 * nothing here is computed money or a recomputation of dayo's verdict.
 *
 * `banner-clock-far-ahead` and `banner-problems` (and the counts they carry) are owner-only (ruling N5): staff and
 * manager see neither the banner nor the number of bills behind it.
 */
export function StatusBannersView({
  sync,
  role,
  zWaiting,
  onGoStatus,
  onGoProblems,
  onGoIssueZ,
}: {
  sync: SyncStatusDto
  role: PosRole
  /** D68 · spec §6.8: counted shifts of this device still waiting for their Z, oldest first (ruling R7 — that
   * oldest one is the one that must go out next; `IssueZScreen` refuses any other with Z_NOT_READY). */
  zWaiting: readonly WaitingZDto[]
  onGoStatus: () => void
  onGoProblems: () => void
  onGoIssueZ: (shiftId: string) => void
}): JSX.Element {
  // fix round 2 (parked Low): the permission table, not a raw role string, is what actually gates /sync-problems —
  // `sync_problems` is owner-only there too, so this stays byte-for-byte the same decision, just sourced from one
  // place instead of re-deriving "owner" by hand here.
  const isOwner = can(role, 'sync_problems')
  return (
    <div className="status-banners">
      {sync.apiState === 'unauthorized' && (
        <p role="alert" className="banner error" data-testid="banner-key-revoked">
          {TH.bannerKeyRevoked}
          {isOwner && (
            <button type="button" data-testid="banner-key-revoked-status" onClick={onGoStatus}>
              {TH.bannerGoStatus}
            </button>
          )}
        </p>
      )}
      {sync.apiState === 'forbidden' && (
        <p role="alert" className="banner error" data-testid="banner-key-forbidden">
          {TH.bannerKeyForbidden}
        </p>
      )}
      {sync.apiState === 'disabled' && (
        <p className="banner warn" data-testid="banner-api-off">
          {TH.bannerApiOff}
        </p>
      )}
      {sync.clockWarning && (
        <p className="banner warn" data-testid="banner-clock">
          {TH.bannerClock(skewMinutes(sync.clockSkewMs))}
        </p>
      )}
      {/* spec §4.4 ข้อ 9 — only a files_sha256 mismatch raises this; `pricingCommit: null` (unknown version) never does. */}
      {sync.pricingMismatch && (
        <p className="banner warn" data-testid="banner-pricing">
          {TH.bannerPricing}
        </p>
      )}
      {sync.catalogError !== null && (
        <p className="banner warn" data-testid="banner-catalog">
          {TH.bannerCatalog}
        </p>
      )}
      {sync.pendingOver24h && (
        <p className="banner warn" data-testid="banner-stale-queue">
          {TH.bannerStaleQueue}
        </p>
      )}
      {isOwner && sync.clockFarAheadBills > 0 && (
        <button type="button" className="banner error" data-testid="banner-clock-far-ahead" onClick={onGoProblems}>
          {TH.bannerClockFarAhead(sync.clockFarAheadBills)}
        </button>
      )}
      {isOwner && sync.problemBills > 0 && (
        <button type="button" className="banner error" data-testid="banner-problems" onClick={onGoProblems}>
          {TH.bannerProblems(sync.problemBills)}
        </button>
      )}
      {sync.pendingBills > 0 && (
        <span className="badge" data-testid="badge-pending">
          {TH.pendingSync(sync.pendingBills)}
        </span>
      )}
      {zWaiting.length > 0 && (
        <p role="alert" className="banner error" data-testid="banner-z-waiting">
          {TH.zWaitingBanner(formatThaiDate(zWaiting[0]!.businessDate))}
          <button type="button" data-testid="z-issue" onClick={() => onGoIssueZ(zWaiting[0]!.shiftId)}>
            {TH.zIssue}
          </button>
        </p>
      )}
    </div>
  )
}

/** The container mounted once, under `<BrandBar>`, on every route (`router.tsx`) — reads the signed-in role and
 * the latest `sync` off `useBootstrap()` (refetched every 30 s, `app/queries.ts`). Renders nothing before either
 * is known (logged out, or the first bootstrap still loading) — never a flash of a banner with no data behind it. */
export function StatusBanners(): JSX.Element | null {
  const boot = useBootstrap()
  const { user } = useSession()
  const navigate = useNavigate()
  if (user === null || boot.data === undefined) return null
  return (
    <StatusBannersView
      sync={boot.data.sync}
      role={user.role}
      zWaiting={boot.data.zWaiting}
      onGoStatus={() => void navigate({ to: '/status' })}
      onGoProblems={() => void navigate({ to: '/sync-problems' })}
      onGoIssueZ={(shiftId) => void navigate({ to: '/shift/z/$shiftId', params: { shiftId } })}
    />
  )
}
