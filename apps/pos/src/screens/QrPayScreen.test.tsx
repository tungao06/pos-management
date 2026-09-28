// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PosError } from '../api/errors'
import type { CommitSaleResult, PosApi, SellCatalogDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { CartProvider } from '../app/cart-context'
import { SessionProvider, useSession } from '../app/session'
import type { CartState } from '../state/cart'
import { testSellCatalog } from '../test-utils/sell-catalog'
import { QrPayScreen } from './QrPayScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
}))

// A real QR render is pure overhead here — the screen only reads the resulting data URL string.
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async (text: string) => `data:image/png;base64,MOCK-${text}`) } }))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }
const CART: CartState = {
  orderId: 'o1', channelCode: 'store', billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false,
  lines: [{ key: 'Thai Tea|16 oz|50%|fresh|', code: 'Thai Tea', nameTh: 'ชาไทย', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1 }],
}

function bumpedCatalog(): SellCatalogDto {
  const dto = testSellCatalog()
  const variants = dto.catalog.variants.map((v) => (v.menuCode === 'Thai Tea' && v.size === '16 oz' && v.sweetness === '50%' ? { ...v, price: 40 } : v))
  return { ...dto, catalogVersion: dto.catalogVersion + 1, catalog: { ...dto.catalog, variants } }
}

function SignedIn(): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return <QrPayScreen />
}

function mount(overrides: Partial<PosApi>): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const api = { promptPayForAmount: vi.fn(async (amountSatang: number) => `PAYLOAD-${amountSatang}`), ...overrides } as unknown as PosApi
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
}

describe('QrPayScreen — PRICE_CHANGED refetches the catalog and rebuilds the QR (review C1)', () => {
  it('shows the new qr-total and a regenerated PromptPay payload after PRICE_CHANGED', async () => {
    const loadSellCatalog = vi.fn().mockResolvedValueOnce(testSellCatalog()).mockResolvedValue(bumpedCatalog())
    const recordSale = vi
      .fn()
      .mockRejectedValueOnce(new PosError('PRICE_CHANGED', 'shown 3500, now 4000'))
      .mockResolvedValueOnce({ orderId: 'o1', receiptNo: 'A-000001', queueNo: 1, businessDate: '2026-09-28', totalSatang: 4_000, changeSatang: null, method: 'PROMPTPAY' } satisfies CommitSaleResult)
    mount({ loadSellCatalog, recordSale })

    await waitFor(() => expect(screen.getByTestId('qr-total')).toHaveTextContent('35.00'))
    await waitFor(() => expect(screen.getByTestId('qr-image')).toHaveAttribute('data-payload', 'PAYLOAD-3500'))

    fireEvent.click(screen.getByTestId('qr-received'))
    expect(await screen.findByTestId('price-changed')).toHaveTextContent('35.00')
    expect(screen.getByTestId('price-changed')).toHaveTextContent('40.00')
    await waitFor(() => expect(screen.getByTestId('qr-total')).toHaveTextContent('40.00'))
    await waitFor(() => expect(screen.getByTestId('qr-image')).toHaveAttribute('data-payload', 'PAYLOAD-4000'))

    fireEvent.click(screen.getByTestId('price-changed-confirm'))
    await waitFor(() => expect(recordSale).toHaveBeenCalledTimes(2))
    expect(recordSale.mock.calls[1]![0]).toMatchObject({ expectedTotalSatang: 4_000, payment: { method: 'PROMPTPAY' } })
  })
})
