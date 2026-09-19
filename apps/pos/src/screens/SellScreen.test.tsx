// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapState, MenuDto, PosApi, UserDto } from '../api/types'
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
