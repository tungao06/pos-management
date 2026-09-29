// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { priceCart, type CartDraft, type CartLineDraft } from '@dayo/domain'
import { PosError } from '../api/errors'
import type { PosApi, RecordSaleResult, SellCatalogDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { CartProvider } from '../app/cart-context'
import { SessionProvider, useSession } from '../app/session'
import type { CartState } from '../state/cart'
import { testSellCatalog } from '../test-utils/sell-catalog'
import { formatBahtFull } from '../ui/format'
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

function mount(overrides: Partial<PosApi>, cart: CartState = CART): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const api = { promptPayForAmount: vi.fn(async (amountSatang: number) => `PAYLOAD-${amountSatang}`), ...overrides } as unknown as PosApi
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <CartProvider initial={cart}>
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
      .mockResolvedValueOnce({ orderId: 'o1', receiptNo: 'A-000001', queueNo: 1, businessDate: '2026-09-28', totalSatang: 4_000, changeSatang: null, method: 'PROMPTPAY' } satisfies RecordSaleResult)
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

describe('QrPayScreen — review round 2 item 1 (Medium): a clock-crossed promotion updates the total right away, not after 30 s', () => {
  it('recomputes on PRICE_CHANGED even when the refetched catalog is the SAME object (structural sharing) — a matcha promo crossing 14:00', async () => {
    // shouldAdvanceTime: real async work (promises, testing-library's own polling) still proceeds normally; only
    // `Date`/`Date.now()` — what usePricedCart prices with — is pinned to whatever `vi.setSystemTime` says.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const BEFORE = '2026-09-25T06:59:50.000Z' // Friday 13:59:50 Bangkok — before มัตฉะบ่าย ลด 15% starts
      // dayo's engine applies the window from 14:00 sharp (D130 · f4cda56 — the old one started at 14:01);
      // this Medium fix's own scenario uses 14:05, safely inside it either way.
      const DURING = '2026-09-25T07:05:00.000Z' // Friday 14:05 Bangkok — inside the promo window
      vi.setSystemTime(new Date(BEFORE))

      const matchaLine: CartLineDraft = { code: 'Matcha Latte', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: 'Excellent', qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null }
      const matchaDraft: CartDraft = { channelCode: 'store', paymentCode: 'cash', lines: [matchaLine], billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, manualPromotionIds: [], manualPromotionReason: null }
      const matchaCart: CartState = { orderId: 'o1', channelCode: 'store', billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, lines: [{ key: 'Matcha Latte|16 oz|50%|fresh|Excellent', code: 'Matcha Latte', nameTh: 'มัตฉะลาเต้', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: 'Excellent', qty: 1 }] }

      const dto = testSellCatalog()
      // The exact same reference every call — simulates react-query's structural sharing when nothing in the
      // catalog's own data changed, only the wall clock crossed the promotion's time window.
      const loadSellCatalog = vi.fn().mockResolvedValue(dto)
      const beforeTotal = priceCart(matchaDraft, dto.catalog, BEFORE).totalSatang
      const duringTotal = priceCart(matchaDraft, dto.catalog, DURING).totalSatang
      expect(duringTotal).toBeLessThan(beforeTotal) // sanity: the promo really does discount it

      const recordSale = vi
        .fn()
        .mockRejectedValueOnce(new PosError('PRICE_CHANGED', `shown ${beforeTotal}, now ${duringTotal}`))
        .mockResolvedValueOnce({ orderId: 'o1', receiptNo: 'A-000001', queueNo: 1, businessDate: '2026-09-25', totalSatang: duringTotal, changeSatang: null, method: 'PROMPTPAY' } satisfies RecordSaleResult)
      mount({ loadSellCatalog, recordSale }, matchaCart)

      await waitFor(() => expect(screen.getByTestId('qr-total')).toHaveTextContent(formatBahtFull(beforeTotal)))

      // Time passes to 14:00:05 — nothing on screen has recomputed yet (the catalog never changed, and the 30 s
      // repricing tick never fired) — the total must still read the pre-promo figure.
      vi.setSystemTime(new Date(DURING))
      expect(screen.getByTestId('qr-total')).toHaveTextContent(formatBahtFull(beforeTotal))

      fireEvent.click(screen.getByTestId('qr-received')) // recordSale refuses with the real, now-discounted total
      await screen.findByTestId('price-changed')
      // the fix: priceBump forced usePricedCart to recompute at the current (fake) time despite the identical
      // catalog reference — the total on screen already matches priceChanged.nowSatang, so confirm is not stuck.
      await waitFor(() => expect(screen.getByTestId('qr-total')).toHaveTextContent(formatBahtFull(duringTotal)))
      await waitFor(() => expect((screen.getByTestId('price-changed-confirm') as HTMLButtonElement).disabled).toBe(false))

      fireEvent.click(screen.getByTestId('price-changed-confirm'))
      await waitFor(() => expect(recordSale).toHaveBeenCalledTimes(2))
      expect(recordSale.mock.calls[1]![0]).toMatchObject({ expectedTotalSatang: duringTotal })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('QrPayScreen — review round 2 item 2 (minor): price-changed-confirm waits for the new QR payload', () => {
  it('stays disabled while the new total\'s PromptPay payload is still loading', async () => {
    const loadSellCatalog = vi.fn().mockResolvedValueOnce(testSellCatalog()).mockResolvedValue(bumpedCatalog())
    const recordSale = vi.fn().mockRejectedValueOnce(new PosError('PRICE_CHANGED', 'shown 3500, now 4000'))
    const deferred: { resolve: (v: string) => void } = { resolve: () => undefined }
    const promptPayForAmount = vi.fn((amountSatang: number) => {
      if (amountSatang === 4_000)
        return new Promise<string>((resolve) => {
          deferred.resolve = resolve
        })
      return Promise.resolve(`PAYLOAD-${amountSatang}`)
    })
    mount({ loadSellCatalog, recordSale, promptPayForAmount })

    await waitFor(() => expect(screen.getByTestId('qr-total')).toHaveTextContent('35.00'))
    await waitFor(() => expect((screen.getByTestId('qr-received') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTestId('qr-received'))
    await waitFor(() => expect(recordSale).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('qr-total')).toHaveTextContent('40.00')) // priced already caught up
    // ...but the new QR payload has not resolved yet — confirm must not let the cashier tap through blind.
    expect((screen.getByTestId('price-changed-confirm') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByTestId('qr-image')).toBeNull()

    deferred.resolve('PAYLOAD-4000')
    await waitFor(() => expect(screen.getByTestId('qr-image')).toHaveAttribute('data-payload', 'PAYLOAD-4000'))
    await waitFor(() => expect((screen.getByTestId('price-changed-confirm') as HTMLButtonElement).disabled).toBe(false))
  })
})
