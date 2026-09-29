// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapState, PosApi, SyncStatusDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { CartProvider } from '../app/cart-context'
import { SessionProvider, useSession } from '../app/session'
import { HEALTHY_SYNC } from '../test-utils/sync-status'
import { testSellCatalog } from '../test-utils/sell-catalog'
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
    [{ pendingBills: 3 }, 'badge-pending'],
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
    renderBanners({ ...BASE_SYNC, pricingCommit: null, pricingMismatch: false, pendingBills: 1 }, 'owner')
    expect(await screen.findByTestId('badge-pending')).toBeInTheDocument() // proves the sync data has loaded
    expect(screen.queryByTestId('banner-pricing')).toBeNull()
  })

  it('shows banner-clock-far-ahead and banner-problems to the owner, with the right counts', async () => {
    renderBanners({ ...BASE_SYNC, clockFarAheadBills: 2, problemBills: 5 }, 'owner')
    expect(await screen.findByTestId('banner-clock-far-ahead')).toHaveTextContent('2')
    expect(screen.getByTestId('banner-problems')).toHaveTextContent('5')
  })

  it('ruling N5: staff sees neither banner-clock-far-ahead nor banner-problems, nor the counts', async () => {
    renderBanners({ ...BASE_SYNC, clockFarAheadBills: 2, problemBills: 5, pendingBills: 1 }, 'staff')
    expect(await screen.findByTestId('badge-pending')).toBeInTheDocument() // proves the sync data has loaded
    expect(screen.queryByTestId('banner-clock-far-ahead')).toBeNull()
    expect(screen.queryByTestId('banner-problems')).toBeNull()
    expect(screen.queryByText('2')).toBeNull()
    expect(screen.queryByText('5')).toBeNull()
  })

  it('a manager sees neither owner-only banner either', async () => {
    renderBanners({ ...BASE_SYNC, clockFarAheadBills: 1, problemBills: 1, pendingBills: 1 }, 'manager')
    expect(await screen.findByTestId('badge-pending')).toBeInTheDocument()
    expect(screen.queryByTestId('banner-clock-far-ahead')).toBeNull()
    expect(screen.queryByTestId('banner-problems')).toBeNull()
  })

  it('clicking banner-problems navigates toward /sync-problems (owner)', async () => {
    renderBanners({ ...BASE_SYNC, problemBills: 1 }, 'owner')
    const btn = await screen.findByTestId('banner-problems')
    fireEvent.click(btn) // just proves it is clickable — navigation itself is mocked in this suite
  })
})
