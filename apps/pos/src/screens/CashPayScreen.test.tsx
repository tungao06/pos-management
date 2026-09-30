// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PosError } from '../api/errors'
import type { PosApi, RecordSaleResult, SellCatalogDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { CartProvider } from '../app/cart-context'
import { SessionProvider, useSession } from '../app/session'
import type { CartState } from '../state/cart'
import { testSellCatalog } from '../test-utils/sell-catalog'
import { CashPayScreen } from './CashPayScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
}))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }
const CART: CartState = {
  orderId: 'o1', channelCode: 'store', billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, manualPromotionIds: [], manualPromotionReason: '',
  lines: [{ key: 'Thai Tea|16 oz|50%|fresh|', code: 'Thai Tea', nameTh: 'ชาไทย', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1 }],
}

/** Thai Tea 16 oz/50% bumped from ฿35 to ฿40 — a real price change dayo would send on the next catalog fetch. */
function bumpedCatalog(): SellCatalogDto {
  const dto = testSellCatalog()
  const variants = dto.catalog.variants.map((v) => (v.menuCode === 'Thai Tea' && v.size === '16 oz' && v.sweetness === '50%' ? { ...v, price: 40 } : v))
  return { ...dto, catalogVersion: dto.catalogVersion + 1, catalog: { ...dto.catalog, variants } }
}

function SignedIn(): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return <CashPayScreen />
}

function mount(overrides: Partial<PosApi>): { queryClient: QueryClient } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const api = { ...overrides } as unknown as PosApi
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <CartProvider initial={CART}>
            <SignedIn />
          </CartProvider>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { queryClient }
}

describe('CashPayScreen — PRICE_CHANGED refetches the catalog before showing it (review C1)', () => {
  it('shows the new cash-total/cash-change from the refetched catalog, then resends with the current tender', async () => {
    const loadSellCatalog = vi.fn().mockResolvedValueOnce(testSellCatalog()).mockResolvedValue(bumpedCatalog())
    const recordSale = vi
      .fn()
      .mockRejectedValueOnce(new PosError('PRICE_CHANGED', 'shown 3500, now 4000'))
      .mockResolvedValueOnce({ orderId: 'o1', receiptNo: 'A-000001', queueNo: 1, businessDate: '2026-09-28', totalSatang: 4_000, changeSatang: 1_000, method: 'CASH' } satisfies RecordSaleResult)
    mount({ loadSellCatalog, recordSale })

    await waitFor(() => expect(screen.getByTestId('cash-total')).toHaveTextContent('35.00'))
    fireEvent.change(screen.getByTestId('tender-input'), { target: { value: '50' } })
    await waitFor(() => expect(screen.getByTestId('cash-change')).toHaveTextContent('15.00'))

    fireEvent.click(screen.getByTestId('confirm-cash'))
    expect(await screen.findByTestId('price-changed')).toHaveTextContent('35.00')
    expect(screen.getByTestId('price-changed')).toHaveTextContent('40.00')
    // C1: the total/change on screen come from the freshly priced cart, not from the stale attempt.
    await waitFor(() => expect(screen.getByTestId('cash-total')).toHaveTextContent('40.00'))
    expect(screen.getByTestId('cash-change')).toHaveTextContent('10.00')

    fireEvent.click(screen.getByTestId('price-changed-confirm'))
    await waitFor(() => expect(recordSale).toHaveBeenCalledTimes(2))
    expect(recordSale.mock.calls[1]![0]).toMatchObject({ expectedTotalSatang: 4_000, payment: { method: 'CASH', tenderedSatang: 5_000 } })
  })

  it('review I3: disables price-changed-confirm when the current tender is below the new total', async () => {
    const loadSellCatalog = vi.fn().mockResolvedValueOnce(testSellCatalog()).mockResolvedValue(bumpedCatalog())
    const recordSale = vi.fn().mockRejectedValueOnce(new PosError('PRICE_CHANGED', 'shown 3500, now 4000'))
    mount({ loadSellCatalog, recordSale })

    await waitFor(() => expect(screen.getByTestId('cash-total')).not.toHaveTextContent('0.00'))
    fireEvent.change(screen.getByTestId('tender-input'), { target: { value: '38' } }) // covers the old ฿35, not the new ฿40
    fireEvent.click(screen.getByTestId('confirm-cash'))
    await screen.findByTestId('price-changed')
    expect((screen.getByTestId('price-changed-confirm') as HTMLButtonElement).disabled).toBe(true)
  })

  it('review I3: a non-PRICE_CHANGED error clears priceChanged and shows the new error instead', async () => {
    const loadSellCatalog = vi.fn().mockResolvedValue(testSellCatalog())
    const recordSale = vi
      .fn()
      .mockRejectedValueOnce(new PosError('PRICE_CHANGED', 'shown 3500, now 3500'))
      .mockRejectedValueOnce(new PosError('TENDER_TOO_LOW', 'tendered 0 < total 3500'))
    mount({ loadSellCatalog, recordSale })

    await waitFor(() => expect(screen.getByTestId('cash-total')).not.toHaveTextContent('0.00'))
    fireEvent.change(screen.getByTestId('tender-input'), { target: { value: '35' } })
    fireEvent.click(screen.getByTestId('confirm-cash'))
    await screen.findByTestId('price-changed')

    fireEvent.click(screen.getByTestId('price-changed-confirm'))
    await waitFor(() => expect(screen.queryByTestId('price-changed')).toBeNull())
    expect(screen.getByRole('alert').textContent).toContain('รับเงินน้อยกว่ายอด')
  })
})
