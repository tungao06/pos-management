// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PosError } from '../api/errors'
import type { BootstrapState, PosApi, SellCatalogDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { CartProvider } from '../app/cart-context'
import { SessionProvider, useSession } from '../app/session'
import type { CartState } from '../state/cart'
import { MANUAL_FIVE_ID, MANUAL_FREE_ID, promoSellCatalog } from '../test-utils/sell-catalog'
import { HEALTHY_SYNC } from '../test-utils/sync-status'
import { CartPanel } from './CartPanel'
import { CashPayScreen } from './CashPayScreen'
import { SellScreen } from './SellScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
}))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }
const cocoa = { key: 'Cocoa|16 oz|50%|fresh|', code: 'Cocoa', nameTh: 'โกโก้', size: '16 oz', sweetness: '50%' as const, milk: 'fresh' as const, grade: null, qty: 1 }
const thai = { ...cocoa, code: 'Thai Tea', key: 'Thai Tea|16 oz|50%|fresh|', nameTh: 'ชาไทย' }
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

describe('T9 fix round 1', () => {
  it('the reason survives the bill leaving ฿0 and coming back', () => {
    // the engine frees the whole bill, so "no promotions" is what moves it away from ฿0 here (a cup +/- would not)
    mount(cart, { ...BASE, manualPromotionIds: [MANUAL_FREE_ID], manualPromotionReason: 'ชงผิดสูตร' })
    expect((screen.getByTestId('manual-reason') as HTMLInputElement).value).toBe('ชงผิดสูตร')
    fireEvent.click(screen.getByTestId('no-promotions'))
    expect(screen.queryByTestId('manual-reason')).toBeNull()
    fireEvent.click(screen.getByTestId('no-promotions'))
    expect((screen.getByTestId('manual-reason') as HTMLInputElement).value).toBe('ชงผิดสูตร')
  })

  it('lists the "ไม่ใช้โปร" warnings once, in the promo panel only', () => {
    // an id dayo does not have is warned and skipped; FREE makes the bill ฿0 with no reason (not ok, own warning)
    mount(cart, { ...BASE, manualPromotionIds: ['ghost-promo', MANUAL_FREE_ID] })
    expect(screen.getByTestId('promo-warnings').textContent).toContain('ไม่ใช้โปร')
    const cartWarnings = screen.getByTestId('cart-warnings')
    expect(cartWarnings.textContent).not.toContain('ไม่ใช้โปร')
  })

  it('a cup discounted by two promotions lists both with their names, never a uuid', () => {
    const dto = promoSellCatalog()
    const five = dto.catalog.promotions.find((p) => p.id === MANUAL_FIVE_ID)!
    const three = { ...five, id: 'three', name: 'ลดชาไทย 3 บาท (เลือกเอง)', groupCode: 'main', rule: { ...five.rule!, reward: { type: 'amount', baht: 3 } } } as typeof five
    mount(cart, { ...BASE, manualPromotionIds: [MANUAL_FIVE_ID, 'three'], lines: [thai] }, { ...dto, catalog: { ...dto.catalog, promotions: [...dto.catalog.promotions, three] } })
    const list = screen.getByTestId('cart-line-breakdown-0-0')
    expect(list).toHaveTextContent('ลดชาไทย 3 บาท (เลือกเอง)')
    expect(list).toHaveTextContent('−฿3.00')
    expect(list.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
  })

  it('price-changed-confirm on a ฿0 bill still pays cash 0', async () => {
    const recordSale = vi
      .fn()
      .mockRejectedValueOnce(new PosError('PRICE_CHANGED', 'shown 0, now 0'))
      .mockResolvedValueOnce({ orderId: 'o1', receiptNo: 'A-1', queueNo: 1, businessDate: '2026-09-30', totalSatang: 0, changeSatang: 0, method: 'CASH' })
    mount(() => <CashPayScreen />, { ...BASE, manualPromotionIds: [MANUAL_FREE_ID], manualPromotionReason: 'ชงผิดสูตร' }, promoSellCatalog(), { recordSale })
    await waitFor(() => expect((screen.getByTestId('confirm-cash') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTestId('confirm-cash'))
    await waitFor(() => expect((screen.getByTestId('price-changed-confirm') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTestId('price-changed-confirm'))
    await waitFor(() => expect(recordSale).toHaveBeenCalledTimes(2))
    expect(recordSale.mock.calls[1]![0]).toMatchObject({ expectedTotalSatang: 0, payment: { method: 'CASH', tenderedSatang: 0 } })
  })

  it('the reason input is labelled, required and described by its hint', () => {
    mount(cart, { ...BASE, manualPromotionIds: [MANUAL_FREE_ID] })
    const input = screen.getByTestId('manual-reason')
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toContain('manual-reason-hint')
    expect(screen.getByLabelText('เหตุผลที่เลือกโปรนี้เอง')).toBe(input)
  })
})

describe('SellScreen passes manualSupported through', () => {
  const bootstrap = (manualSupported: boolean): BootstrapState =>
    ({
      needsSetup: false, device: { id: 'd1', name: 'x', receiptPrefix: 'A' }, users: [],
      openShift: { id: 's1', businessDate: '2026-09-30', openedAt: '2026-09-30T00:00:00Z', openedBy: 'u1', openingFloatSatang: 0, syncMode: 'local_only' },
      pendingSyncItems: 0, lastBackupAt: null, backupDue: false, legacyDevice: false, dayoLinked: true, dayoBaseUrl: 'https://dayo.example/api/v1',
      staffNeedingPin: [], ownerRecovery: false, sync: HEALTHY_SYNC, countingShift: null, zWaiting: [], centralLastZNo: null,
      promo: { manualSupported, ruleBehind: false, ruleVersions: manualSupported ? [1, 2] : [] },
    }) as BootstrapState

  it('supported: the chips show', async () => {
    mount(() => <SellScreen />, BASE, promoSellCatalog(), { bootstrap: () => Promise.resolve(bootstrap(true)) })
    expect(await screen.findByTestId(`manual-promo-${MANUAL_FREE_ID}`)).toBeTruthy()
  })

  it('not supported: no chips, and an earlier manual pick is dropped with its reason', async () => {
    mount(() => <SellScreen />, { ...BASE, manualPromotionIds: [MANUAL_FREE_ID], manualPromotionReason: 'x' }, promoSellCatalog(), { bootstrap: () => Promise.resolve(bootstrap(false)) })
    await waitFor(() => expect(screen.getByTestId('cart-total')).not.toHaveTextContent('฿0.00'))
    expect(screen.queryByTestId('manual-promos')).toBeNull()
    expect(screen.queryByTestId(`promo-${MANUAL_FREE_ID}`)).toBeNull()
  })
})
