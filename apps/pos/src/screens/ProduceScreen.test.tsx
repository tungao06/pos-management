// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapState, PosApi, ProductionBatchDto, StockItemDto, StockOverviewDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { SessionProvider, useSession } from '../app/session'
import { ProduceScreen } from './ProduceScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }

function item(overrides: Partial<StockItemDto> & Pick<StockItemDto, 'itemId' | 'code' | 'name' | 'kind'>): StockItemDto {
  return {
    isActive: true,
    category: 'เบส',
    useUnit: 'g',
    onHandMilli: 0,
    avgCostUsat: 0,
    priceCheckUsat: 0,
    valueSatang: 0,
    reorderPointMilli: 0,
    status: 'ok',
    alert: false,
    isKeyCount: false,
    units: [],
    shelfLifeHours: null,
    latestBatch: null,
    bom: null,
    ...overrides,
  }
}

const BASE = item({
  itemId: 'i-base',
  code: 'PB-TEA-THAI',
  name: 'ชาไทยเบส',
  kind: 'prepared',
  useUnit: 'ml',
  shelfLifeHours: 72,
  bom: { yieldMilli: 3_000_000, lines: [{ itemId: 'i-rm-02', code: 'RM-TEA-02', name: 'ใบชา', useUnit: 'g', qtyMilli: 180_000 }] },
})
// controller ruling I-2 (Task 9 fix round 1): an inactive base still holding stock stays on the stock page but must
// not be offered here — producing more of it is refused server-side (requireStockItem, no allowInactiveWithStock).
const BASE_INACTIVE = item({
  itemId: 'i-base-old',
  code: 'PB-OLD',
  name: 'เบสเลิกทำ',
  kind: 'prepared',
  useUnit: 'ml',
  isActive: false,
  bom: { yieldMilli: 1_000_000, lines: [{ itemId: 'i-rm-02', code: 'RM-TEA-02', name: 'ใบชา', useUnit: 'g', qtyMilli: 60_000 }] },
})

const STOCK: StockOverviewDto = {
  generatedAt: '2026-09-17T10:00:00.000Z',
  businessDate: '2026-09-17',
  items: [BASE, BASE_INACTIVE],
  totalValueSatang: 0,
  alertCount: 0,
  expiredBaseCodes: [],
  lastCountAt: null,
  countDue: false,
  openCountId: null,
  openingCountPending: false,
}

const DONE: ProductionBatchDto = {
  id: 'b1',
  itemId: BASE.itemId,
  code: BASE.code,
  name: BASE.name,
  businessDate: '2026-09-17',
  scaleBp: 10_000,
  yieldActualMilli: 3_000_000,
  unitCostUsat: 2_000_000,
  batchCostSatang: 6_000,
  expiresAt: '2026-09-20T03:00:00.000Z',
  createdAt: '2026-09-17T10:00:00.000Z',
  components: [{ itemId: 'i-rm-02', code: 'RM-TEA-02', qtyMilli: -180_000 }],
}

function bootstrap(overrides: Partial<BootstrapState> = {}): BootstrapState {
  return { needsSetup: false, device: null, users: [], openShift: null, pendingSyncItems: 0, lastBackupAt: null, backupDue: false, ...overrides }
}

function SignedIn({ children }: { children: JSX.Element }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return children
}

function mount(overrides: Partial<PosApi> = {}): { api: PosApi } {
  const api = {
    stockOverview: vi.fn(async () => STOCK),
    bootstrap: vi.fn(async () => bootstrap()),
    ...overrides,
  } as unknown as PosApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <SignedIn>
            <ProduceScreen />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { api }
}

async function chooseBase(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId(`produce-base-${BASE.code}`)).toBeTruthy())
  fireEvent.click(screen.getByTestId(`produce-base-${BASE.code}`))
}

describe('ProduceScreen — controller ruling I-2 (Task 9 fix round 1): the base picker offers active bases only', () => {
  it('an inactive base with stock left never appears among the choices', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId(`produce-base-${BASE.code}`)).toBeTruthy())
    expect(screen.queryByTestId(`produce-base-${BASE_INACTIVE.code}`)).toBeNull()
  })
})

describe('ProduceScreen — M-10: a scale preset clears whatever custom scale was typed', () => {
  it('typing a custom scale then clicking a preset button empties the custom field', async () => {
    mount()
    await chooseBase()

    fireEvent.change(screen.getByTestId('produce-scale'), { target: { value: '0.75' } })
    expect((screen.getByTestId('produce-scale') as HTMLInputElement).value).toBe('0.75')
    expect((screen.getByTestId('produce-yield') as HTMLInputElement).value).toBe('2250') // 0.75 × 3,000 ml standard

    fireEvent.click(screen.getByTestId('produce-scale-5000'))
    expect((screen.getByTestId('produce-scale') as HTMLInputElement).value).toBe('')
    expect((screen.getByTestId('produce-yield') as HTMLInputElement).value).toBe('1500') // back to the ½× preset's standard
  })
})

describe('ProduceScreen — produce-save is disabled while the mutation is pending, so a double tap cannot record two batches', () => {
  it('a second click while the first save is still in flight never calls produceBatch twice', async () => {
    let resolveSave!: (b: ProductionBatchDto) => void
    const savePromise = new Promise<ProductionBatchDto>((resolve) => (resolveSave = resolve))
    const produceBatch = vi.fn(() => savePromise)
    mount({ produceBatch })
    await chooseBase()

    fireEvent.click(screen.getByTestId('produce-save'))
    await waitFor(() => expect((screen.getByTestId('produce-save') as HTMLButtonElement).disabled).toBe(true))
    expect(produceBatch).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('produce-save')) // a click on a disabled button never reaches submit()
    expect(produceBatch).toHaveBeenCalledTimes(1)

    resolveSave(DONE)
    await waitFor(() => expect(screen.getByTestId('produce-done')).toBeTruthy())
    expect(produceBatch).toHaveBeenCalledTimes(1)
  })
})
