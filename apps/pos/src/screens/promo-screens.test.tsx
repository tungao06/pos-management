// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PosApi, SellCatalogDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { CartProvider } from '../app/cart-context'
import { SessionProvider, useSession } from '../app/session'
import type { CartState } from '../state/cart'
import { MANUAL_FIVE_ID, MANUAL_FREE_ID, promoSellCatalog, testSellCatalog } from '../test-utils/sell-catalog'
import { CartPanel } from './CartPanel'
import { CashPayScreen } from './CashPayScreen'
import { PromoPanel } from './PromoPanel'
import { QrPayScreen } from './QrPayScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
}))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }
const cocoa = { key: 'Cocoa|16 oz|50%|fresh|', code: 'Cocoa', nameTh: 'โกโก้', size: '16 oz', sweetness: '50%' as const, milk: 'fresh' as const, grade: null, qty: 1 }
const BASE: CartState = { orderId: 'o1', channelCode: 'store', billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, manualPromotionIds: [], manualPromotionReason: '', lines: [cocoa] }

function SignedIn({ children }: { children: JSX.Element }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return children
}

function mount(ui: (dto: SellCatalogDto) => JSX.Element, initial: CartState, dto = promoSellCatalog(), api: Partial<PosApi> = {}): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={{ loadSellCatalog: () => Promise.resolve(dto), ...api } as unknown as PosApi}>
        <SessionProvider>
          <CartProvider initial={initial}>
            <SignedIn>{ui(dto)}</SignedIn>
          </CartProvider>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
}

const cart = (dto: SellCatalogDto): JSX.Element => (
  <CartPanel catalog={dto.catalog} channels={dto.channels} payments={dto.payments} maxQtyPerLine={99} onOpenDiscount={() => undefined} onPay={() => undefined} manualSupported />
)

describe('manual promotion picker + reason (plan 10 T9)', () => {
  it('lists the manual promotions as chips, and asks for a reason only once the bill is ฿0', () => {
    mount(cart, BASE)
    expect(screen.getByTestId(`manual-promo-${MANUAL_FREE_ID}`)).toBeTruthy()
    expect(screen.queryByTestId('manual-reason')).toBeNull() // nothing picked: never asked
    fireEvent.click(screen.getByTestId(`manual-promo-${MANUAL_FIVE_ID}`))
    expect(screen.queryByTestId('manual-reason')).toBeNull() // a manual promo that leaves money to pay: still no reason asked
    fireEvent.click(screen.getByTestId(`manual-promo-${MANUAL_FIVE_ID}`))
    fireEvent.click(screen.getByTestId(`manual-promo-${MANUAL_FREE_ID}`))
    expect(screen.getByTestId('manual-reason').getAttribute('maxlength')).toBe('200')
  })

  it('a ฿0 manual bill can not be paid until a reason is typed; then cash yes, QR never', () => {
    mount(cart, BASE)
    fireEvent.click(screen.getByTestId(`manual-promo-${MANUAL_FREE_ID}`))
    expect((screen.getByTestId('pay-cash') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('manual-reason'), { target: { value: '  ชงผิดสูตร ' } })
    expect((screen.getByTestId('pay-cash') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTestId('pay-qr') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('cart-zero-cash-only')).toHaveTextContent('เงินสดเท่านั้น')
  })

  it('a blank (spaces only) reason does not unlock the pay button', () => {
    mount(cart, BASE)
    fireEvent.click(screen.getByTestId(`manual-promo-${MANUAL_FREE_ID}`))
    fireEvent.change(screen.getByTestId('manual-reason'), { target: { value: '     ' } })
    expect((screen.getByTestId('pay-cash') as HTMLButtonElement).disabled).toBe(true)
  })

  it('dropping the last manual promotion clears the reason', () => {
    mount(cart, { ...BASE, manualPromotionIds: [MANUAL_FREE_ID], manualPromotionReason: 'x' })
    fireEvent.click(screen.getByTestId(`manual-promo-${MANUAL_FREE_ID}`))
    expect(screen.queryByTestId('manual-reason')).toBeNull()
  })

  it('hides the whole picker when dayo does not take manual promotions', () => {
    mount((dto) => <PromoPanel priced={null} catalog={dto.catalog} manualSupported={false} />, BASE)
    expect(screen.queryByTestId('manual-promos')).toBeNull()
  })

  it('shows "จำกัด n ครั้ง" on a chip and on the applied promotion', () => {
    const dto = promoSellCatalog()
    const promotions = dto.catalog.promotions.map((p) => (p.id === MANUAL_FREE_ID ? { ...p, usageLimitTotal: 3 } : p))
    mount(cart, BASE, { ...dto, catalog: { ...dto.catalog, promotions } })
    expect(screen.getByTestId(`promo-limit-${MANUAL_FREE_ID}`)).toHaveTextContent('จำกัด 3 ครั้ง')
    fireEvent.click(screen.getByTestId(`manual-promo-${MANUAL_FREE_ID}`))
    expect(screen.getByTestId(`promo-mode-${MANUAL_FREE_ID}`)).toHaveTextContent('เลือกเอง')
    expect(screen.getAllByTestId(`promo-limit-${MANUAL_FREE_ID}`).length).toBe(2) // the chip and the applied line
    expect(screen.queryByTestId(`promo-skip-${MANUAL_FREE_ID}`)).toBeNull() // a manual promotion is dropped by its chip
  })

  it('shows the code the engine will read (normPromoCode)', () => {
    mount(cart, { ...BASE, promoCode: 'dayo10' })
    expect(screen.getByTestId('promo-code-norm')).toHaveTextContent('DAYO10')
  })

  it('shows ลด ฿x/แก้ว under a discounted cart line', () => {
    const state = { ...BASE, manualPromotionIds: [MANUAL_FIVE_ID], lines: [{ ...cocoa, code: 'Thai Tea', key: 'Thai Tea|16 oz|50%|fresh|', nameTh: 'ชาไทย' }] }
    mount(cart, state)
    expect(screen.getByTestId('cart-line-discount-0-0')).toHaveTextContent('ลด ฿5.00/แก้ว')
  })
})

describe('฿0 bill on the pay screens (owner Q1 = ข)', () => {
  const ZERO: CartState = { ...BASE, manualPromotionIds: [MANUAL_FREE_ID], manualPromotionReason: 'ชงผิดสูตร' }

  it('cash: no tender, confirms as CASH with tenderedSatang 0', async () => {
    const recordSale = vi.fn().mockResolvedValue({ orderId: 'o1', receiptNo: 'A-1', queueNo: 1, businessDate: '2026-09-30', totalSatang: 0, changeSatang: 0, method: 'CASH' })
    mount(() => <CashPayScreen />, ZERO, promoSellCatalog(), { recordSale })
    await waitFor(() => expect((screen.getByTestId('confirm-cash') as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByTestId('tender-input')).toBeNull()
    fireEvent.click(screen.getByTestId('confirm-cash'))
    await waitFor(() => expect(recordSale).toHaveBeenCalledTimes(1))
    expect(recordSale.mock.calls[0]![0]).toMatchObject({ expectedTotalSatang: 0, payment: { method: 'CASH', tenderedSatang: 0 }, cart: { manualPromotionIds: [MANUAL_FREE_ID], manualPromotionReason: 'ชงผิดสูตร' } })
  })

  it('cash: without the reason the confirm button stays off', async () => {
    mount(() => <CashPayScreen />, { ...ZERO, manualPromotionReason: '' })
    await waitFor(() => expect(screen.getByTestId('zero-bill-note')).toBeTruthy())
    expect((screen.getByTestId('confirm-cash') as HTMLButtonElement).disabled).toBe(true)
  })

  it('QR: refuses with the cash-only copy and never lets the cashier confirm', async () => {
    mount(() => <QrPayScreen />, ZERO, promoSellCatalog(), { promptPayForAmount: vi.fn() })
    expect(await screen.findByTestId('zero-bill-cash-only')).toHaveTextContent('เงินสดเท่านั้น')
    expect((screen.getByTestId('qr-received') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a normal bill keeps the tender box', async () => {
    mount(() => <CashPayScreen />, { ...BASE }, testSellCatalog())
    expect(await screen.findByTestId('tender-input')).toBeTruthy()
  })
})
