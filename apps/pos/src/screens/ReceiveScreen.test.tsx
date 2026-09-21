// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PosError } from '../api/errors'
import type { BootstrapState, PosApi, PurchaseDto, StockItemDto, StockOverviewDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { SessionProvider, useSession } from '../app/session'
import { ReceiveScreen } from './ReceiveScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }

function item(overrides: Partial<StockItemDto> & Pick<StockItemDto, 'itemId' | 'code' | 'name'>): StockItemDto {
  return {
    kind: 'raw',
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

// purchaseUnitId is null throughout this suite (no purchase units defined), so 1 typed unit = 1 g exactly and
// cost (usat/g) = satang typed × 1,000,000 — chosen so the jump/no-jump arithmetic is easy to read at a glance.
const ITEM_A = item({ itemId: 'i-a', code: 'RM-A', name: 'ชาเอ', priceCheckUsat: 10_000_000 }) // ref ฿0.10/g
const ITEM_B = item({ itemId: 'i-b', code: 'RM-B', name: 'ชาบี', priceCheckUsat: 10_000_000 })

const STOCK: StockOverviewDto = {
  generatedAt: '2026-09-17T10:00:00.000Z',
  businessDate: '2026-09-17',
  items: [ITEM_A, ITEM_B],
  totalValueSatang: 0,
  alertCount: 0,
  expiredBaseCodes: [],
  lastCountAt: null,
  countDue: false,
  openCountId: null,
  openingCountPending: false,
}

const DONE: PurchaseDto = { id: 'p1', businessDate: '2026-09-17', supplier: null, totalSatang: 12, lines: [], cashMovementId: null, createdAt: '2026-09-17T10:00:00Z' }

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
            <ReceiveScreen />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { api }
}

/** Fills the add-line form for a jumping (฿0.12/g, +20% of the ฿0.10 reference) or clean (฿0.10/g) line and adds it. */
async function addLine(code: string, priceBahtPerGram: '0.10' | '0.12'): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('receive-item')).toBeTruthy())
  fireEvent.change(screen.getByTestId('receive-item'), { target: { value: code } })
  fireEvent.change(screen.getByTestId('receive-qty'), { target: { value: '1' } })
  fireEvent.change(screen.getByTestId('receive-total'), { target: { value: priceBahtPerGram } })
  fireEvent.click(screen.getByTestId('receive-add'))
}

describe('ReceiveScreen — m-3 (Task 4 review, carried into Task 9): acceptPriceJump is a single flag for the whole receipt; any line edit after a confirm must reset it', () => {
  it('removing the jumping line clears the PRICE_JUMP confirm immediately, without a new save press', async () => {
    const receivePurchase = vi.fn(async (input: { acceptPriceJump: boolean }): Promise<PurchaseDto> => {
      if (!input.acceptPriceJump) throw new PosError('PRICE_JUMP', ITEM_A.code)
      return DONE
    })
    mount({ receivePurchase })
    await addLine(ITEM_A.code, '0.12') // +20% — a jump
    expect(screen.getByTestId('receive-jump-0')).toBeTruthy()

    fireEvent.click(screen.getByTestId('receive-save'))
    await waitFor(() => expect(screen.getByTestId('receive-confirm-price')).toBeTruthy())
    expect(screen.getByTestId('receive-price-jump')).toBeTruthy()
    expect(receivePurchase).toHaveBeenCalledTimes(1)
    expect(receivePurchase).toHaveBeenLastCalledWith(expect.objectContaining({ acceptPriceJump: false }))

    // the edit: the owner removes the line instead of confirming its price
    fireEvent.click(screen.getByTestId('receive-remove-0'))

    // mutation-proof: without the removeLine reset, both would still be on screen here (m-3 is exactly this line)
    expect(screen.queryByTestId('receive-confirm-price')).toBeNull()
    expect(screen.queryByTestId('receive-price-jump')).toBeNull()
  })

  it('a fresh line added after an edit is checked again — save never smuggles the old confirm past a new jump', async () => {
    const receivePurchase = vi.fn(async (input: { acceptPriceJump: boolean }): Promise<PurchaseDto> => {
      if (!input.acceptPriceJump) throw new PosError('PRICE_JUMP', ITEM_A.code)
      return DONE
    })
    mount({ receivePurchase })
    await addLine(ITEM_A.code, '0.12')
    fireEvent.click(screen.getByTestId('receive-save'))
    await waitFor(() => expect(screen.getByTestId('receive-confirm-price')).toBeTruthy())

    fireEvent.click(screen.getByTestId('receive-remove-0'))
    await addLine(ITEM_B.code, '0.12') // a different jumping line, added after the edit

    // the confirm button must not reappear on its own — only a fresh save press (and a fresh server refusal) can
    // bring it back, so the owner is shown the new line's own PRICE_JUMP before any acceptPriceJump:true is sent
    expect(screen.queryByTestId('receive-confirm-price')).toBeNull()
    fireEvent.click(screen.getByTestId('receive-save'))
    await waitFor(() => expect(receivePurchase).toHaveBeenCalledTimes(2))
    expect(receivePurchase).toHaveBeenLastCalledWith(expect.objectContaining({ acceptPriceJump: false, lines: [expect.objectContaining({ itemId: ITEM_B.itemId })] }))
  })
})

describe('ReceiveScreen — m-7 (Task 4 review, carried into Task 9): receive-save is disabled while the mutation is pending, so a double tap cannot record two purchases', () => {
  it('a second click while the first save is still in flight never calls receivePurchase twice', async () => {
    let resolveSave!: (p: PurchaseDto) => void
    const savePromise = new Promise<PurchaseDto>((resolve) => (resolveSave = resolve))
    const receivePurchase = vi.fn(() => savePromise)
    mount({ receivePurchase })
    await addLine(ITEM_A.code, '0.10') // no jump — a clean line

    fireEvent.click(screen.getByTestId('receive-save'))
    await waitFor(() => expect((screen.getByTestId('receive-save') as HTMLButtonElement).disabled).toBe(true))
    expect(receivePurchase).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('receive-save')) // a click on a disabled button never reaches submit()
    expect(receivePurchase).toHaveBeenCalledTimes(1)

    resolveSave(DONE)
    await waitFor(() => expect(screen.getByTestId('receive-done')).toBeTruthy())
    expect(receivePurchase).toHaveBeenCalledTimes(1)
  })
})
