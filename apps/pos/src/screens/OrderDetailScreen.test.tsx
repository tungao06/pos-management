// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CentralStateDto, DayoEditDto, OrderDetailDto, PosApi, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { SessionProvider, useSession } from '../app/session'
import { TH } from '../ui/th'
import { OrderDetailScreen } from './OrderDetailScreen'

afterEach(() => cleanup())

const CENTRAL_NONE: CentralStateDto = { state: 'legacy', orderNo: null, computedTotalSatang: null, diffSatang: null, duplicateOf: [], reason: null, voidState: 'none' }

const ORDER: OrderDetailDto = {
  id: 'o1',
  receiptNo: 'A-000312',
  queueNo: 12,
  status: 'paid',
  totalSatang: 15_500,
  method: 'CASH',
  paidAt: '2026-09-25T03:00:00Z',
  cups: 1,
  soldById: 'mint',
  soldByName: 'มิ้นท์',
  central: CENTRAL_NONE,
  dayoEdit: null,
  offCatalog: false,
  centralMismatch: null,
  businessDate: '2026-09-25',
  shiftId: 's1',
  subtotalSatang: 15_500,
  discountSatang: 0,
  discountReason: null,
  tenderedSatang: 16_000,
  changeSatang: 500,
  voidedAt: null,
  soldAt: '2026-09-25T03:00:00Z',
  channelCode: 'store',
  catalogVersion: 42,
  promotions: [],
  manualPromotionReason: null,
  lines: [],
  events: [],
  voidable: true,
}

/** `OrderDetailDto` sample + `over` (the brief's `fakeOrderApi`) — every field the screen actually reads is fixed here. */
function fakeOrderApi(over: Partial<OrderDetailDto> = {}): Partial<PosApi> {
  const dto: OrderDetailDto = { ...ORDER, ...over, central: { ...ORDER.central, ...(over.central ?? {}) } }
  return { getOrder: vi.fn(async () => dto) }
}

function SignedIn({ user, children }: { user: UserDto; children: JSX.Element }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(user), [signIn, user])
  return children
}

const DEFAULT_USER: UserDto = { id: 'mint', displayName: 'มิ้นท์', role: 'staff' }

/** `renderDetail` (the brief's helper) — sets the route to `/orders/$orderId` and signs the given user in. */
function renderDetail(api: Partial<PosApi>, user: UserDto = DEFAULT_USER): void {
  const rootRoute = createRootRoute()
  const detailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/orders/$orderId', component: OrderDetailScreen })
  const ordersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/orders', component: () => null })
  const routeTree = rootRoute.addChildren([detailRoute, ordersRoute])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/orders/o1'] }) })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api as PosApi}>
        <SessionProvider>
          <SignedIn user={user}>
            <RouterProvider router={router} />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
}

describe('OrderDetailScreen — dayo central state, diff and duplicate (spec §4.3, §4.8)', () => {
  it('shows the dayo order number, a 1-satang difference and the duplicate label (spec §4.3, §4.8)', async () => {
    const api = fakeOrderApi({ central: { state: 'sent', orderNo: 'L260925-014', computedTotalSatang: 15_501, diffSatang: 1, duplicateOf: ['L260925-013'], reason: null, voidState: 'none' }, totalSatang: 15_500 })
    renderDetail(api)
    expect(await screen.findByTestId('central-state')).toHaveTextContent('L260925-014')
    expect(screen.getByTestId('order-diff')).toHaveTextContent('+฿0.01')
    expect(screen.getByTestId('order-dup')).toHaveTextContent('อาจซ้ำกับบิลบอท L260925-013')
  })

  it('shows the discount reason only when there is one — never empty brackets (mobile audit row 21)', async () => {
    renderDetail(fakeOrderApi({ subtotalSatang: 16_500, discountSatang: 1_000, discountReason: null }))
    const line = await screen.findByTestId('order-discount')
    expect(line).toHaveTextContent('ส่วนลด −฿10')
    expect(line.textContent).not.toContain('(')
    cleanup()
    renderDetail(fakeOrderApi({ subtotalSatang: 16_500, discountSatang: 1_000, discountReason: 'ลูกค้าประจำ' }))
    expect(await screen.findByTestId('order-discount')).toHaveTextContent('ส่วนลด (ลูกค้าประจำ) −฿10')
  })

  it('a staff member sees the cancel button only on their own bill (Q44)', async () => {
    renderDetail(fakeOrderApi({ soldById: 'someone-else', voidable: true }), { id: 'mint', displayName: 'มิ้นท์', role: 'staff' })
    await screen.findByTestId('central-state')
    expect(screen.queryByTestId('order-void')).toBeNull()
  })

  it('a staff member sees the cancel button on their own bill', async () => {
    renderDetail(fakeOrderApi({ soldById: 'mint', voidable: true }), { id: 'mint', displayName: 'มิ้นท์', role: 'staff' })
    expect(await screen.findByTestId('order-void')).toBeInTheDocument()
  })

  it('an owner sees the cancel button on any bill (void_any)', async () => {
    renderDetail(fakeOrderApi({ soldById: 'someone-else', voidable: true }), { id: 'owner-1', displayName: 'เจ้าของ', role: 'owner' })
    expect(await screen.findByTestId('order-void')).toBeInTheDocument()
  })
})

describe('OrderDetailScreen — dayo_edit, read only (spec §4.6, §4.7 · ADR-0050)', () => {
  const EDIT: DayoEditDto = { kind: 'edit', editedAt: '2026-09-25T05:00:00Z', editedByName: 'เจ้าของ', reason: 'ราคาผิด', version: 1 }

  it('shows the edit label with when/who/why, and never shows dayo\'s new total', async () => {
    renderDetail(fakeOrderApi({ dayoEdit: EDIT }))
    const banner = await screen.findByTestId('order-dayo-edit')
    expect(banner).toHaveTextContent('เจ้าของแก้บิลนี้บนเว็บ')
    expect(banner).toHaveTextContent('เจ้าของ')
    expect(banner).toHaveTextContent('เหตุผล: ราคาผิด')
    expect(banner).toHaveTextContent('ยอดในเครื่องคือเงินที่เก็บจริง')
  })

  it('shows the cancel label and hides the void button even when voidable claims true (double check)', async () => {
    renderDetail(fakeOrderApi({ dayoEdit: { ...EDIT, kind: 'cancel' }, voidable: true }))
    const banner = await screen.findByTestId('order-dayo-edit')
    expect(banner).toHaveTextContent('เจ้าของยกเลิกบิลนี้บนเว็บ')
    expect(screen.queryByTestId('order-void')).toBeNull()
  })

  it('leaves out the name/reason segments when dayo sent them as null', async () => {
    renderDetail(fakeOrderApi({ dayoEdit: { kind: 'edit', editedAt: '2026-09-25T05:00:00Z', editedByName: null, reason: null, version: null } }))
    const banner = await screen.findByTestId('order-dayo-edit')
    expect(banner).toHaveTextContent('เจ้าของแก้บิลนี้บนเว็บ')
    expect(banner.textContent).not.toContain('เหตุผล:')
  })

  it('shows nothing when there is no dayo_edit', async () => {
    renderDetail(fakeOrderApi({ dayoEdit: null }))
    await screen.findByTestId('central-state')
    expect(screen.queryByTestId('order-dayo-edit')).toBeNull()
  })
})

describe('OrderDetailScreen — block 3 (spec §6.4 · m2)', () => {
  it('an off-catalog bill carries the badge; a central mismatch is shown read-only', async () => {
    renderDetail(
      fakeOrderApi({
        offCatalog: true,
        centralMismatch: { orderNo: 'L260925-014', reportedTotalSatang: 4_000, paymentIsCash: false, localTotalSatang: 4_500, localPaymentIsCash: false },
      }),
    )
    expect(await screen.findByTestId('order-off-catalog-badge')).toHaveTextContent(TH.offCatalogBadge)
    expect(screen.getByTestId('order-central-mismatch')).toHaveTextContent(TH.centralMismatchLine('L260925-014', '40.00', '45.00'))
    expect(screen.queryByTestId('order-edit')).toBeNull()
  })
})

describe('OrderDetailScreen — manual promotion reason and per-cup split (plan 10 T9)', () => {
  it('shows the reason the manual promotion was chosen with, and each promotion of a split cup in satang', async () => {
    renderDetail(
      fakeOrderApi({
        manualPromotionReason: 'ชงผิดสูตร',
        lines: [{ lineNo: 1, productName: 'ชาไทย', sizeName: '16 oz', sweetnessName: '50%', milk: 'fresh', grade: null, qty: 1, unitPriceSatang: 3_500, lineTotalSatang: 2_000, promoBreakdown: [{ promotionId: 'p1', name: 'ลด 10', satang: 1_000 }, { promotionId: 'p2', name: 'ลด 5', satang: 500 }] }],
      }),
    )
    expect(await screen.findByTestId('order-manual-reason')).toHaveTextContent('ชงผิดสูตร')
    expect(screen.getByTestId('order-line-breakdown-0')).toHaveTextContent('ลด 10 −฿10.00')
    expect(screen.getByTestId('order-line-breakdown-0')).toHaveTextContent('ลด 5 −฿5.00')
  })

  it('shows neither on a bill without them', async () => {
    renderDetail(fakeOrderApi())
    await screen.findByTestId('order-status')
    expect(screen.queryByTestId('order-manual-reason')).toBeNull()
  })
})
