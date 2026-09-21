// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapState, MenuDto, PosApi, StockOverviewDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { CartProvider } from '../app/cart-context'
import { SessionProvider, useSession } from '../app/session'
import { TH } from '../ui/th'
import { SellScreen } from './SellScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }
const MENU: MenuDto = {
  storeChannelId: 'shop',
  categories: [],
  products: [],
  sizes: [],
  sweetness: [],
  variants: [],
  defaultSizeId: 'sz',
  defaultSweetnessId: 'sw',
  bestSellerProductIds: [],
}

function bootstrap(overrides: Partial<BootstrapState> = {}): BootstrapState {
  return {
    needsSetup: false,
    device: { id: 'd1', name: 'แท็บเล็ตหน้าร้าน', receiptPrefix: 'A' },
    users: [],
    openShift: { id: 's1', businessDate: '2026-09-17', openedAt: '2026-09-17T00:00:00Z', openedBy: 'u1', openingFloatSatang: 50_000 },
    pendingSyncItems: 0,
    lastBackupAt: null,
    backupDue: false,
    ...overrides,
  }
}

function SignedIn(): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return <SellScreen />
}

function mount(overrides: Partial<PosApi> = {}): void {
  const api = { loadMenu: vi.fn(async () => MENU), ...overrides } as unknown as PosApi
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
      itemId: 'i-shot', code: 'PB-MATCHA-SHOT', name: 'มัทฉะช็อต', kind: 'prepared', category: 'เบส', useUnit: 'ml', onHandMilli: 120_000, avgCostUsat: 95_666_667, priceCheckUsat: 95_666_667,
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

describe('SellScreen — stock badge and expired-base banner (plan 4 · Q4-10)', () => {
  it('shows the alert count on the stock button and an expired-base banner — selling stays open', async () => {
    mount({ bootstrap: vi.fn(async () => bootstrap()), stockOverview: vi.fn(async () => STOCK) })
    await waitFor(() => expect(screen.getByTestId('base-expired')).toBeTruthy())
    expect(screen.getByTestId('base-expired').textContent).toBe(TH.baseExpiredBanner('มัทฉะช็อต'))
    expect(screen.getByTestId('nav-stock').textContent).toBe(TH.stockMenuAlerts(3))
  })

  it('no alerts: a plain stock button and no banner', async () => {
    const stockOverview = vi.fn(async () => ({ ...STOCK, alertCount: 0, expiredBaseCodes: [] }))
    mount({ bootstrap: vi.fn(async () => bootstrap()), stockOverview })
    await waitFor(() => expect(stockOverview).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('nav-stock').textContent).toBe(TH.stockMenu))
    expect(screen.queryByTestId('base-expired')).toBeNull()
  })
})
