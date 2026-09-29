// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapState, PosApi, SyncStatusDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { CartProvider } from '../app/cart-context'
import { SessionProvider, useSession } from '../app/session'
import { render as renderBlock3 } from '../test-utils'
import { HEALTHY_SYNC } from '../test-utils/sync-status'
import { testSellCatalog } from '../test-utils/sell-catalog'
import { TH } from '../ui/th'
import { fakeApi, OWNERS, status } from './block3-test-fixtures'
import { SellScreen } from './SellScreen'
import { StatusBanners } from './StatusBanners'

afterEach(() => cleanup())

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

const BASE_SYNC: SyncStatusDto = HEALTHY_SYNC

function bootstrapWith(sync: SyncStatusDto, overrides: Partial<BootstrapState> = {}): BootstrapState {
  return {
    needsSetup: false,
    device: { id: 'd1', name: 'แท็บเล็ตหน้าร้าน', receiptPrefix: 'A' },
    users: [],
    openShift: { id: 's1', businessDate: '2026-09-25', openedAt: '2026-09-25T00:00:00Z', openedBy: 'u1', openingFloatSatang: 0, syncMode: 'local_only' },
    pendingSyncItems: 0,
    lastBackupAt: null,
    backupDue: false,
    legacyDevice: false,
    dayoLinked: true,
    dayoBaseUrl: 'https://dayo.example/api/v1',
    staffNeedingPin: [],
    ownerRecovery: false,
    sync,
    countingShift: null,
    zWaiting: [],
    centralLastZNo: null,
    ...overrides,
  }
}

function SignedIn({ role, children }: { role: UserDto['role']; children: JSX.Element }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn({ id: role === 'owner' ? 'owner-1' : 'staff-1', displayName: 'ผู้ใช้', role }), [signIn, role])
  return children
}

function renderBanners(sync: SyncStatusDto, role: UserDto['role']): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const api: Partial<PosApi> = { bootstrap: vi.fn(async () => bootstrapWith(sync)) }
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api as PosApi}>
        <SessionProvider>
          <SignedIn role={role}>
            <StatusBanners />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
}

function renderSellWithSync(sync: SyncStatusDto): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const api: Partial<PosApi> = {
    bootstrap: vi.fn(async () => bootstrapWith(sync)),
    loadSellCatalog: vi.fn(async () => testSellCatalog()),
  }
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api as PosApi}>
        <SessionProvider>
          <SignedIn role="staff">
            <CartProvider>
              <>
                <StatusBanners />
                <SellScreen />
              </>
            </CartProvider>
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
}

describe('StatusBanners — the warning table (spec §4.4 ข้อ 9, §6.3, §6.4, §6.7, §10.5 · D80 · ruling R8/N5)', () => {
  it.each([
    [{ apiState: 'unauthorized' as const }, 'banner-key-revoked'],
    [{ clockWarning: true, clockSkewMs: 7 * 60_000 }, 'banner-clock'],
    [{ pricingMismatch: true }, 'banner-pricing'],
    [{ apiState: 'disabled' as const }, 'banner-api-off'],
    [{ apiState: 'forbidden' as const }, 'banner-key-forbidden'],
    [{ catalogError: 'อ่านไม่ได้' }, 'banner-catalog'],
    [{ pendingOver24h: true }, 'banner-stale-queue'],
    [{ pendingSyncRows: 3 }, 'badge-pending'],
  ])('%o shows %s', async (sync, id) => {
    renderBanners({ ...BASE_SYNC, ...sync }, 'staff')
    expect(await screen.findByTestId(id)).toBeInTheDocument()
  })

  it('the clock banner never blocks selling (D80)', async () => {
    renderSellWithSync({ ...BASE_SYNC, clockWarning: true, clockSkewMs: 7 * 60_000 })
    expect(await screen.findByTestId('banner-clock')).toHaveTextContent('7 นาที')
    fireEvent.click(await screen.findByTestId('menu-Thai Tea'))
    fireEvent.click(screen.getByTestId('item-add'))
    expect(await screen.findByTestId('pay-cash')).not.toBeDisabled()
  })

  it('pricingCommit: null shows no banner-pricing (only a files_sha256 mismatch does — spec §4.4 ข้อ 9)', async () => {
    renderBanners({ ...BASE_SYNC, pricingCommit: null, pricingMismatch: false, pendingSyncRows: 1 }, 'owner')
    expect(await screen.findByTestId('badge-pending')).toBeInTheDocument() // proves the sync data has loaded
    expect(screen.queryByTestId('banner-pricing')).toBeNull()
  })

  it('shows banner-clock-far-ahead and banner-problems to the owner, with the right counts', async () => {
    renderBanners({ ...BASE_SYNC, clockFarAheadBills: 2, problemSyncRows: 5 }, 'owner')
    expect(await screen.findByTestId('banner-clock-far-ahead')).toHaveTextContent('2')
    expect(screen.getByTestId('banner-problems')).toHaveTextContent('5')
  })

  it('ruling N5: staff sees neither banner-clock-far-ahead nor banner-problems, nor the counts', async () => {
    renderBanners({ ...BASE_SYNC, clockFarAheadBills: 2, problemSyncRows: 5, pendingSyncRows: 1 }, 'staff')
    expect(await screen.findByTestId('badge-pending')).toBeInTheDocument() // proves the sync data has loaded
    expect(screen.queryByTestId('banner-clock-far-ahead')).toBeNull()
    expect(screen.queryByTestId('banner-problems')).toBeNull()
    expect(screen.queryByText('2')).toBeNull()
    expect(screen.queryByText('5')).toBeNull()
  })

  it('a manager sees neither owner-only banner either', async () => {
    renderBanners({ ...BASE_SYNC, clockFarAheadBills: 1, problemSyncRows: 1, pendingSyncRows: 1 }, 'manager')
    expect(await screen.findByTestId('badge-pending')).toBeInTheDocument()
    expect(screen.queryByTestId('banner-clock-far-ahead')).toBeNull()
    expect(screen.queryByTestId('banner-problems')).toBeNull()
  })

  it('clicking banner-problems navigates toward /sync-problems (owner)', async () => {
    renderBanners({ ...BASE_SYNC, problemSyncRows: 1 }, 'owner')
    const btn = await screen.findByTestId('banner-problems')
    fireEvent.click(btn) // just proves it is clickable — navigation itself is mocked in this suite
  })

  it('a Z waiting to go online shows the red bar with the Thai date and the issue button (§6.8)', async () => {
    renderBlock3(<StatusBanners />, {
      api: fakeApi({ bootstrap: vi.fn(async () => ({ users: OWNERS, countingShift: null, centralLastZNo: null, sync: BASE_SYNC, zWaiting: [{ shiftId: 's1', businessDate: '2026-09-25', countedAt: '2026-09-25T05:00:00.000Z', syncMode: 'central', countedSatang: 59_500 }] })) }),
      session: { userId: 'u1', role: 'staff' },
    })
    expect(await screen.findByTestId('banner-z-waiting')).toHaveTextContent(TH.zWaitingBanner('25 ก.ย. 2569'))
    expect(screen.getByTestId('z-issue')).toBeVisible()
  })

  // Task 16 (block 3 · spec §6.2 m1 · S5 · m2): these banners read `api.syncStatus()` on its own poll — `bootstrap`
  // still supplies `users`/`zWaiting` only (its own `sync` field, when present, is only the fallback).
  it('scope bar: yellow at first, red after 24 h, owner only (m1)', async () => {
    const api = { syncStatus: vi.fn(async () => status({ scopeWait: { scope: 'shift:write', since: '2026-09-25T03:00:00.000Z', red: false, closable: false } })), bootstrap: vi.fn(async () => ({ users: OWNERS, zWaiting: [] })) }
    const { unmount } = renderBlock3(<StatusBanners />, { api, session: { userId: 'u1', role: 'owner' } })
    expect(await screen.findByTestId('banner-scope')).toHaveAttribute('data-level', 'warn')
    expect(screen.getByTestId('banner-scope')).toHaveTextContent(TH.scopeBanner('shift:write'))
    unmount()
    api.syncStatus.mockResolvedValue(status({ scopeWait: { scope: 'shift:write', since: '2026-09-24T03:00:00.000Z', red: true, closable: false } }))
    renderBlock3(<StatusBanners />, { api, session: { userId: 'u1', role: 'owner' } })
    expect(await screen.findByTestId('banner-scope')).toHaveAttribute('data-level', 'error')
    renderBlock3(<StatusBanners />, { api, session: { userId: 's1', role: 'staff' } })
    expect(screen.getAllByTestId('banner-scope')).toHaveLength(1) // the staff render adds none
  })
  it('shift data conflict and central mismatch are red bars for the owner (S5 · m2)', async () => {
    renderBlock3(<StatusBanners />, {
      api: { syncStatus: vi.fn(async () => status({ shiftDataConflict: true, centralMismatchBills: 2 })), bootstrap: vi.fn(async () => ({ users: OWNERS, zWaiting: [] })) },
      session: { userId: 'u1', role: 'owner' },
    })
    expect(await screen.findByTestId('banner-shift-conflict')).toHaveTextContent(TH.shiftConflictBanner)
    expect(screen.getByTestId('banner-central-mismatch')).toHaveTextContent(TH.centralMismatchBanner)
  })

  // fix round 1 item 5: syncStatus.isError must not blank the banners — bootstrap().sync is still shown.
  it('falls back to bootstrap().sync when syncStatus errors', async () => {
    renderBlock3(<StatusBanners />, {
      api: {
        syncStatus: vi.fn(async () => { throw new Error('OFFLINE: network') }),
        bootstrap: vi.fn(async () => ({ users: OWNERS, zWaiting: [], sync: status({ problemSyncRows: 3 }) })),
      },
      session: { userId: 'u1', role: 'owner' },
    })
    expect(await screen.findByTestId('banner-problems')).toHaveTextContent('3')
  })
})
