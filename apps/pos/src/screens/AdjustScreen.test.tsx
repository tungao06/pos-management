// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapState, MenuDto, PosApi, StockAdjustmentDto, StockItemDto, StockOverviewDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { SessionProvider, useSession } from '../app/session'
import { TH } from '../ui/th'
import { AdjustScreen } from './AdjustScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }

function item(overrides: Partial<StockItemDto> & Pick<StockItemDto, 'itemId' | 'code' | 'name' | 'kind'>): StockItemDto {
  return {
    isActive: true,
    category: 'วัตถุดิบ',
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

const ITEM_ACTIVE = item({ itemId: 'i-1', code: 'RM-01', name: 'นมสด', kind: 'raw', useUnit: 'ml' })
// controller ruling (Task 6, mirrored by requireStockItem's allowInactiveWithStock): an item turned off in the
// catalog but still holding stock can still be stocked out down to zero — stockOverview keeps it on this list for
// exactly that reason, so AdjustScreen must offer it here without adding an extra isActive filter of its own.
const ITEM_INACTIVE_WITH_STOCK = item({ itemId: 'i-2', code: 'RM-OLD', name: 'ของเลิกขาย', kind: 'raw', useUnit: 'g', isActive: false, onHandMilli: 500_000 })

const STOCK: StockOverviewDto = {
  generatedAt: '2026-09-21T10:00:00.000Z',
  businessDate: '2026-09-21',
  items: [ITEM_ACTIVE, ITEM_INACTIVE_WITH_STOCK],
  totalValueSatang: 0,
  alertCount: 0,
  expiredBaseCodes: [],
  lastCountAt: null,
  countDue: false,
  openCountId: null,
  openingCountPending: false,
}

const MENU: MenuDto = {
  storeChannelId: 'shop',
  categories: [{ id: 'c1', code: 'TEA', name: 'ชา' }],
  products: [{ id: 'p1', code: 'ORIGINAL', nameTh: 'ชาไทย', nameEn: 'Original', categoryId: 'c1' }],
  sizes: [{ id: 'sz16', code: '16', name: '16 oz' }],
  sweetness: [{ id: 'sw50', code: '50', name: '50%', isDefault: true }],
  variants: [{ id: 'v1', productId: 'p1', sizeId: 'sz16', priceSatang: 4_500 }],
  defaultSizeId: 'sz16',
  defaultSweetnessId: 'sw50',
  bestSellerProductIds: [],
}

const DONE: StockAdjustmentDto = {
  id: 'adj1',
  businessDate: '2026-09-21',
  reasonCode: 'WASTE',
  reason: 'ทดสอบ',
  movements: [{ itemId: ITEM_ACTIVE.itemId, code: ITEM_ACTIVE.code, kind: 'WASTE', qtyMilli: -5_000 }],
  createdAt: '2026-09-21T10:00:00.000Z',
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
    loadMenu: vi.fn(async () => MENU),
    bootstrap: vi.fn(async () => bootstrap()),
    ...overrides,
  } as unknown as PosApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <SignedIn>
            <AdjustScreen />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { api }
}

function optionValues(testId: string): string[] {
  return Array.from((screen.getByTestId(testId) as HTMLSelectElement).options).map((o) => o.value)
}

/** Adds one valid item line (RM-01, 5 g in the use unit) — the shared setup every reason/save test starts from. */
async function addItemLine(): Promise<void> {
  await waitFor(() => expect(optionValues('adjust-item')).toContain(ITEM_ACTIVE.code))
  fireEvent.change(screen.getByTestId('adjust-item'), { target: { value: ITEM_ACTIVE.code } })
  fireEvent.change(screen.getByTestId('adjust-qty'), { target: { value: '5' } })
  fireEvent.click(screen.getByTestId('adjust-add-item'))
  await waitFor(() => expect(screen.getByTestId('adjust-line-item-0')).toBeTruthy())
}

describe('AdjustScreen — the item picker mirrors stockOverview exactly, with no extra isActive filter of its own', () => {
  it('offers an inactive item that still holds stock alongside the active ones', async () => {
    mount()
    await waitFor(() => expect(optionValues('adjust-item')).toContain(ITEM_ACTIVE.code))
    expect(optionValues('adjust-item')).toContain(ITEM_INACTIVE_WITH_STOCK.code)
  })
})

describe('AdjustScreen — the reason code sent to adjustStock is whichever reason button was clicked', () => {
  it('sends GIVEAWAY when that was the last button clicked, not WASTE (the first choice in the row)', async () => {
    const adjustStock = vi.fn(async () => DONE)
    mount({ adjustStock })
    await addItemLine()
    fireEvent.click(screen.getByTestId('adjust-reason-GIVEAWAY'))
    fireEvent.change(screen.getByTestId('adjust-reason'), { target: { value: 'ชดเชยลูกค้า' } })
    fireEvent.click(screen.getByTestId('adjust-save'))
    await waitFor(() => expect(adjustStock).toHaveBeenCalledTimes(1))
    expect(adjustStock).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'GIVEAWAY' }))
  })

  it('sends OTHER when that was clicked instead, proving the code is not fixed to any one button', async () => {
    const adjustStock = vi.fn(async () => DONE)
    mount({ adjustStock })
    await addItemLine()
    fireEvent.click(screen.getByTestId('adjust-reason-OTHER'))
    fireEvent.change(screen.getByTestId('adjust-reason'), { target: { value: 'อื่น ๆ' } })
    fireEvent.click(screen.getByTestId('adjust-save'))
    await waitFor(() => expect(adjustStock).toHaveBeenCalledTimes(1))
    expect(adjustStock).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'OTHER' }))
  })
})

describe('AdjustScreen — a reason of only spaces is refused client-side, like an empty one', () => {
  it('shows the Thai required-reason message and never calls adjustStock', async () => {
    const adjustStock = vi.fn(async () => DONE)
    mount({ adjustStock })
    await addItemLine()
    fireEvent.click(screen.getByTestId('adjust-reason-WASTE'))
    fireEvent.change(screen.getByTestId('adjust-reason'), { target: { value: '   ' } })
    fireEvent.click(screen.getByTestId('adjust-save'))
    expect(screen.getByRole('alert').textContent).toBe(TH.errReasonRequired)
    expect(adjustStock).not.toHaveBeenCalled()
  })
})

describe('AdjustScreen — adjust-save is disabled while the mutation is pending, so a double tap cannot record two adjustments', () => {
  it('a second click while the first save is still in flight never calls adjustStock twice', async () => {
    let resolveSave!: (a: StockAdjustmentDto) => void
    const savePromise = new Promise<StockAdjustmentDto>((resolve) => (resolveSave = resolve))
    const adjustStock = vi.fn(() => savePromise)
    mount({ adjustStock })
    await addItemLine()
    fireEvent.click(screen.getByTestId('adjust-reason-WASTE'))
    fireEvent.change(screen.getByTestId('adjust-reason'), { target: { value: 'ทดสอบ' } })

    fireEvent.click(screen.getByTestId('adjust-save'))
    await waitFor(() => expect((screen.getByTestId('adjust-save') as HTMLButtonElement).disabled).toBe(true))
    expect(adjustStock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('adjust-save')) // a click on a disabled button never reaches submit()
    expect(adjustStock).toHaveBeenCalledTimes(1)

    resolveSave(DONE)
    await waitFor(() => expect(screen.getByTestId('adjust-done')).toBeTruthy())
    expect(adjustStock).toHaveBeenCalledTimes(1)
  })
})

describe('AdjustScreen — a full stock-out by item and by drink, in one save', () => {
  it('sends both lines mapped to the AdjustStockInput shape and shows the movement count back', async () => {
    const adjustStock = vi.fn(async () => ({ ...DONE, movements: [...DONE.movements, { itemId: 'ing-1', code: 'RM-TEA-01', kind: 'TRIAL' as const, qtyMilli: -30_000 }] }))
    mount({ adjustStock })
    await addItemLine()

    fireEvent.click(screen.getByTestId('adjust-mode-drinks'))
    fireEvent.change(screen.getByTestId('adjust-product'), { target: { value: 'ORIGINAL' } })
    fireEvent.click(screen.getByTestId('adjust-add-drink'))
    await waitFor(() => expect(screen.getByTestId('adjust-line-drink-0')).toBeTruthy())

    fireEvent.click(screen.getByTestId('adjust-reason-TRIAL'))
    fireEvent.change(screen.getByTestId('adjust-reason'), { target: { value: 'ทดลองสูตรใหม่' } })
    fireEvent.click(screen.getByTestId('adjust-save'))

    await waitFor(() => expect(adjustStock).toHaveBeenCalledTimes(1))
    expect(adjustStock).toHaveBeenCalledWith({
      actorUserId: OWNER.id,
      reasonCode: 'TRIAL',
      reason: 'ทดลองสูตรใหม่',
      items: [{ itemId: ITEM_ACTIVE.itemId, purchaseUnitId: null, qtyUnitsMilli: 5_000 }],
      drinks: [{ variantId: 'v1', sweetnessId: 'sw50', qty: 1 }],
    })
    await waitFor(() => expect(screen.getByTestId('adjust-done').textContent).toBe(TH.adjustDone(2)))
  })
})
