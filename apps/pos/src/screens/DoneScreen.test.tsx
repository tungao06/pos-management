// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrderDetailDto, PosApi, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { SessionProvider, useSession } from '../app/session'
import { DoneScreen } from './DoneScreen'

afterEach(() => cleanup())

const ORDER: OrderDetailDto = {
  id: 'o1',
  receiptNo: 'A-000312',
  queueNo: 12,
  status: 'paid',
  totalSatang: 4_500,
  method: 'CASH',
  paidAt: '2026-09-25T03:00:00Z',
  cups: 1,
  soldById: 'dcm',
  soldByName: 'DCm',
  central: { state: 'legacy', orderNo: null, computedTotalSatang: null, diffSatang: null, duplicateOf: [], reason: null, voidState: 'none' },
  dayoEdit: null,
  offCatalog: false,
  centralMismatch: null,
  businessDate: '2026-09-25',
  shiftId: 's1',
  subtotalSatang: 4_500,
  discountSatang: 0,
  discountReason: null,
  tenderedSatang: 5_000,
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

function fakeOrderApi(over: Partial<OrderDetailDto> = {}): Partial<PosApi> {
  const dto: OrderDetailDto = { ...ORDER, ...over }
  return { getOrder: vi.fn(async () => dto) }
}

function SignedIn({ children }: { children: JSX.Element }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn({ id: 'dcm', displayName: 'DCm', role: 'staff' } as UserDto), [signIn])
  return children
}

function renderDone(api: Partial<PosApi>): void {
  const rootRoute = createRootRoute()
  const doneRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/done',
    validateSearch: (search: Record<string, unknown>): { orderId: string } => ({ orderId: typeof search['orderId'] === 'string' ? search['orderId'] : '' }),
    component: DoneScreen,
  })
  const sellRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sell', component: () => null })
  const routeTree = rootRoute.addChildren([doneRoute, sellRoute])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/done?orderId=o1'] }) })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api as PosApi}>
        <SessionProvider>
          <SignedIn>
            <RouterProvider router={router} />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
}

describe('DoneScreen (D61, spec §9 ก้อน 2)', () => {
  it('shows the receipt number, the queue number big, and who sold it (D61, §9 ก้อน 2)', async () => {
    renderDone(fakeOrderApi({ receiptNo: 'A-000312', queueNo: 12, soldByName: 'DCm' }))
    expect(await screen.findByTestId('done-receipt')).toHaveTextContent('A-000312')
    expect(screen.getByTestId('done-queue')).toHaveTextContent('คิว 12')
    expect(screen.getByTestId('done-sold-by')).toHaveTextContent('ขายโดย DCm · แท็บเล็ต')
  })
})
