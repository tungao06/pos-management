// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PosError } from '../api/errors'
import type { CommitSaleInput, CommitSaleResult, MenuDto, PosApi, UserDto } from '../api/types'
import { cartReducer, cartTotals, type CartState } from '../state/cart'
import { ApiProvider } from './api-context'
import { CartProvider, useCart } from './cart-context'
import { shiftReportKey } from './queries'
import { SessionProvider, useSession } from './session'
import { useCommitSale } from './use-commit-sale'

// useCommitSale calls useNavigate() directly; onSuccess (not under test here) awaits it, so a no-op stub is enough.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

afterEach(() => cleanup())

const USER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }
const VARIANT_ID = 'v1'
const SWEETNESS_ID = 'sw50'
const OLD_PRICE = 4_500
const NEW_PRICE = 5_000

const INITIAL_CART: CartState = {
  orderId: 'order-1',
  lines: [{ key: `${VARIANT_ID}|${SWEETNESS_ID}`, variantId: VARIANT_ID, sweetnessId: SWEETNESS_ID, productName: 'ชาไทยเย็น', sizeName: '16 oz', sweetnessName: '50%', unitPriceSatang: OLD_PRICE, qty: 1 }],
  discount: null,
}

function menuWithPrice(priceSatang: number): MenuDto {
  return {
    storeChannelId: 'ch1',
    categories: [],
    products: [],
    sizes: [],
    sweetness: [],
    variants: [{ id: VARIANT_ID, productId: 'p1', sizeId: 's1', priceSatang }],
    defaultSizeId: 's1',
    defaultSweetnessId: SWEETNESS_ID,
    bestSellerProductIds: [],
  }
}

/** commitSale rejects with PRICE_CHANGED on the first call (old price still on the server), then succeeds. */
function makeMockApi(): PosApi {
  const commitSale = vi.fn(async (input: CommitSaleInput): Promise<CommitSaleResult> => {
    if (commitSale.mock.calls.length === 1) throw new PosError('PRICE_CHANGED', `shown ${input.expectedTotalSatang}, now ${NEW_PRICE}`)
    return { orderId: input.orderId, receiptNo: 'A-000001', queueNo: 1, businessDate: '2026-09-18', totalSatang: input.expectedTotalSatang, changeSatang: 0, method: 'CASH' }
  })
  return {
    bootstrap: vi.fn(),
    setupShop: vi.fn(),
    login: vi.fn(),
    openShift: vi.fn(),
    loadMenu: vi.fn(async () => menuWithPrice(NEW_PRICE)),
    commitSale,
    listOrders: vi.fn(),
    getOrder: vi.fn(),
    promptPayForAmount: vi.fn(),
  } as unknown as PosApi
}

function Probe(): JSX.Element {
  const session = useSession()
  const { state } = useCart()
  const { pay, priceChange } = useCommitSale()
  const total = cartTotals(state).totalSatang
  return (
    <div>
      <button type="button" data-testid="sign-in" onClick={() => session.signIn(USER)}>
        sign in
      </button>
      <span data-testid="lines">{state.lines.length}</span>
      <span data-testid="line-price">{state.lines[0]?.unitPriceSatang ?? ''}</span>
      <span data-testid="price-change">{priceChange !== null ? `${priceChange.fromSatang}|${priceChange.toSatang}` : ''}</span>
      <button type="button" data-testid="pay" onClick={() => pay.mutate({ method: 'CASH', tenderedSatang: total })}>
        pay
      </button>
    </div>
  )
}

describe('useCommitSale PRICE_CHANGED (D50 Q3-27)', () => {
  it('re-prices the cart from the fresh menu, exposes old/new totals, never auto-retries, and re-sends the new total on confirm', async () => {
    const api = makeMockApi()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    // Independently derived from the same production reducer/totals functions the hook itself uses — not a
    // hardcoded VAT calculation — so this is what a correct reprice must produce, not what the hook happens to do.
    const oldTotal = cartTotals(INITIAL_CART).totalSatang
    const repriced = cartReducer(INITIAL_CART, { type: 'reprice', prices: new Map([[VARIANT_ID, NEW_PRICE]]) })
    const newTotal = cartTotals(repriced).totalSatang

    render(
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={api}>
          <SessionProvider>
            <CartProvider initial={INITIAL_CART}>
              <Probe />
            </CartProvider>
          </SessionProvider>
        </ApiProvider>
      </QueryClientProvider>,
    )
    act(() => screen.getByTestId('sign-in').click())

    act(() => screen.getByTestId('pay').click())
    await waitFor(() => expect(screen.getByTestId('price-change').textContent).not.toBe(''))

    // (a) no auto-retry: exactly one commitSale call happened on its own before the cashier presses confirm again.
    expect(api.commitSale).toHaveBeenCalledTimes(1)
    // (b) priceChange carries the exact old/new totals.
    expect(screen.getByTestId('price-change').textContent).toBe(`${oldTotal}|${newTotal}`)
    // (c) the cart line itself was re-priced (the reprice dispatch actually landed, not just previewed).
    expect(screen.getByTestId('line-price').textContent).toBe(String(NEW_PRICE))

    // Cashier checks the new total and presses confirm again.
    act(() => screen.getByTestId('pay').click())
    await waitFor(() => expect(api.commitSale).toHaveBeenCalledTimes(2))

    // (d) the second call sends expectedTotalSatang equal to the new total, never the stale pre-reprice amount.
    const secondCallInput = (api.commitSale as unknown as ReturnType<typeof vi.fn>).mock.calls[1]![0] as CommitSaleInput
    expect(secondCallInput.expectedTotalSatang).toBe(newTotal)
    // ...and after success the cart is cleared.
    await waitFor(() => expect(screen.getByTestId('lines').textContent).toBe('0'))
  })
})

describe('useCommitSale — review m-2: the shift-report cache must be invalidated after a committed sale', () => {
  it('invalidates shiftReportKey on success, so the X report and the Q3b-14 over-drawer check are never stale', async () => {
    const api = {
      bootstrap: vi.fn(),
      setupShop: vi.fn(),
      login: vi.fn(),
      openShift: vi.fn(),
      loadMenu: vi.fn(async () => menuWithPrice(OLD_PRICE)),
      commitSale: vi.fn(
        async (input: CommitSaleInput): Promise<CommitSaleResult> => ({
          orderId: input.orderId,
          receiptNo: 'A-000001',
          queueNo: 1,
          businessDate: '2026-09-18',
          totalSatang: input.expectedTotalSatang,
          changeSatang: 0,
          method: 'CASH',
        }),
      ),
      listOrders: vi.fn(),
      getOrder: vi.fn(),
      promptPayForAmount: vi.fn(),
    } as unknown as PosApi
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    render(
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={api}>
          <SessionProvider>
            <CartProvider initial={INITIAL_CART}>
              <Probe />
            </CartProvider>
          </SessionProvider>
        </ApiProvider>
      </QueryClientProvider>,
    )
    act(() => screen.getByTestId('sign-in').click())
    act(() => screen.getByTestId('pay').click())

    await waitFor(() => expect(api.commitSale).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('lines').textContent).toBe('0')) // cart cleared only after onSuccess ran to completion

    // the only assertion review m-2 needs: without `queryClient.invalidateQueries({ queryKey: shiftReportKey })` in
    // useCommitSale's onSuccess, this call is never made and this test fails — a committed sale changes
    // expectedCashSatang or qrSalesSatang, and a stale X report can miss the Q3b-14 over-drawer warning for up to
    // staleTime (5s, main.tsx) afterwards.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: shiftReportKey })
  })
})
