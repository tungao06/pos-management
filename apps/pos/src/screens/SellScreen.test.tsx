// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapState, PosApi, StockOverviewDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { CartProvider } from '../app/cart-context'
import { SessionProvider, useSession } from '../app/session'
import { sellCatalogKey } from '../app/queries'
import { testSellCatalog } from '../test-utils/sell-catalog'
import { HEALTHY_SYNC } from '../test-utils/sync-status'
import { TH } from '../ui/th'
import { SellScreen } from './SellScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }

function bootstrap(overrides: Partial<BootstrapState> = {}): BootstrapState {
  return {
    needsSetup: false,
    device: { id: 'd1', name: 'แท็บเล็ตหน้าร้าน', receiptPrefix: 'A' },
    users: [],
    openShift: { id: 's1', businessDate: '2026-09-17', openedAt: '2026-09-17T00:00:00Z', openedBy: 'u1', openingFloatSatang: 50_000, syncMode: 'local_only' },
    pendingSyncItems: 0,
    lastBackupAt: null,
    backupDue: false,
    legacyDevice: false,
    dayoLinked: true,
    dayoBaseUrl: 'https://dayo.example/api/v1',
    staffNeedingPin: [],
    ownerRecovery: false,
    sync: HEALTHY_SYNC,
    ...overrides,
  }
}

function SignedIn(): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return <SellScreen />
}

function sellApi(overrides: Partial<PosApi> = {}): { api: PosApi } {
  const api = { loadSellCatalog: vi.fn(async () => testSellCatalog()), ...overrides } as unknown as PosApi
  return { api }
}

function renderSell(api: PosApi): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <CartProvider>
            <SignedIn />
          </CartProvider>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

function mount(overrides: Partial<PosApi> = {}): void {
  const api = { loadSellCatalog: vi.fn(async () => testSellCatalog()), ...overrides } as unknown as PosApi
  renderSell(api)
}

describe('SellScreen — backup-due banner (Task 8 TH.backupDue wired to the sell screen)', () => {
  it('shows the banner and links to /backup when a backup is due', async () => {
    mount({ bootstrap: vi.fn(async () => bootstrap({ backupDue: true })) })
    await waitFor(() => expect(screen.getByTestId('backup-due')).toBeTruthy())
    expect(screen.getByTestId('backup-due').textContent).toBe(TH.backupDue)
  })

  it('hides the banner when no backup is due', async () => {
    mount({ bootstrap: vi.fn(async () => bootstrap({ backupDue: false })) })
    await waitFor(() => expect(screen.getByTestId('nav-shift')).toBeTruthy())
    expect(screen.queryByTestId('backup-due')).toBeNull()
  })
})

const STOCK: StockOverviewDto = {
  generatedAt: '2026-09-17T10:00:00.000Z',
  businessDate: '2026-09-17',
  items: [
    {
      itemId: 'i-shot', code: 'PB-MATCHA-SHOT', name: 'มัทฉะช็อต', kind: 'prepared', isActive: true, category: 'เบส', useUnit: 'ml', onHandMilli: 120_000, avgCostUsat: 95_666_667, priceCheckUsat: 95_666_667,
      valueSatang: 11_480, reorderPointMilli: 0, status: 'ok', alert: true, isKeyCount: false, units: [], shelfLifeHours: 4,
      latestBatch: { batchId: 'b1', createdAt: '2026-09-17T03:00:00.000Z', expiresAt: '2026-09-17T07:00:00.000Z', expiry: 'expired' }, bom: null,
    },
  ],
  totalValueSatang: 11_480,
  alertCount: 3,
  expiredBaseCodes: ['PB-MATCHA-SHOT'],
  lastCountAt: null,
  countDue: true,
  openCountId: null,
  openingCountPending: true,
}

describe('Task 16: the stock screens are hidden from the sell screen', () => {
  it('has no nav-stock link and never calls stockOverview', async () => {
    const stockOverview = vi.fn(async () => STOCK)
    mount({ bootstrap: vi.fn(async () => bootstrap()), stockOverview })
    await waitFor(() => expect(screen.getByTestId('nav-shift')).toBeTruthy())
    expect(screen.queryByTestId('nav-stock')).toBeNull()
    expect(stockOverview).not.toHaveBeenCalled()
  })
})

describe('Task 18: sell with dayo\'s catalog (options, promotions, channel)', () => {
  it('Thai Tea ×3 shows the buy-2-get-1 promotion and ฿70.00; "ไม่ใช้" puts it back to ฿105.00', async () => {
    const { api } = sellApi()
    renderSell(api)
    for (let i = 0; i < 3; i++) {
      fireEvent.click(await screen.findByTestId('menu-Thai Tea'))
      fireEvent.click(screen.getByTestId('item-add'))
    }
    expect(await screen.findByTestId('cart-total')).toHaveTextContent('70.00')
    fireEvent.click(screen.getByTestId('promo-skip-9f8e0000-0000-4000-8000-000000000001'))
    expect(screen.getByTestId('cart-total')).toHaveTextContent('105.00')
  })

  it('offers oat for Thai Tea but not for Cocoa; a matcha shows its grades', async () => {
    const { api } = sellApi()
    renderSell(api)
    fireEvent.click(await screen.findByTestId('menu-Thai Tea'))
    expect(screen.getByTestId('item-milk-oat')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('item-cancel'))
    fireEvent.click(screen.getByTestId('menu-Cocoa'))
    expect(screen.queryByTestId('item-milk-oat')).toBeNull()
    fireEvent.click(screen.getByTestId('item-cancel'))
    fireEvent.click(screen.getByTestId('menu-Matcha Latte'))
    expect(screen.getByTestId('item-grade-Premium')).toBeInTheDocument()
  })

  it('the Grab channel prices Thai Tea 20 oz at ฿59.00 (45 × 1.30 rounded up)', async () => {
    const { api } = sellApi()
    renderSell(api)
    fireEvent.change(await screen.findByTestId('channel-select'), { target: { value: 'grab' } })
    fireEvent.click(screen.getByTestId('menu-Thai Tea'))
    fireEvent.click(screen.getByTestId('item-size-20oz'))
    fireEvent.click(screen.getByTestId('item-add'))
    expect(await screen.findByTestId('cart-total')).toHaveTextContent('59.00')
  })

  it('review I6: shows "catalog-changed" once the refetched catalogVersion differs from the one first shown', async () => {
    const first = testSellCatalog()
    const second = { ...first, catalogVersion: first.catalogVersion + 1 }
    const loadSellCatalog = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(second)
    const { api } = sellApi({ loadSellCatalog })
    const queryClient = renderSell(api)
    await screen.findByTestId('menu-Thai Tea')
    expect(screen.queryByTestId('catalog-changed')).toBeNull()

    await queryClient.refetchQueries({ queryKey: sellCatalogKey })
    expect(await screen.findByTestId('catalog-changed')).toHaveTextContent(TH.catalogChanged)

    // dismissible — clicking it clears the banner (it does not reappear until the version changes again).
    fireEvent.click(screen.getByTestId('catalog-changed'))
    expect(screen.queryByTestId('catalog-changed')).toBeNull()
  })
})
