// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PosApi, ZReportSummaryDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { TH } from '../ui/th'
import { ZListScreen } from './ZListScreen'

afterEach(() => cleanup())

function renderZList(api: Partial<PosApi>): void {
  const rootRoute = createRootRoute()
  const zListRoute = createRoute({ getParentRoute: () => rootRoute, path: '/z', component: ZListScreen })
  const zReportRoute = createRoute({ getParentRoute: () => rootRoute, path: '/z/$shiftId', component: () => null })
  const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null })
  const routeTree = rootRoute.addChildren([homeRoute, zListRoute, zReportRoute])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/z'] }) })
  const queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api as PosApi}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

describe('ZListScreen', () => {
  // review I-1 adaptation (Task 6): ZReportSummaryDto fields are null when the underlying snapshot could not be
  // read — the list must show "—" for those, not crash or print "null".
  it('shows — for every missing figure of a row whose snapshot could not be read', async () => {
    const rows: ZReportSummaryDto[] = [
      { shiftId: 'shift-1', businessDate: null, zNo: null, closedAt: null, netSalesSatang: null, cashVarianceSatang: null, openedQuick: null, hashOk: false, chainWarning: false },
    ]
    renderZList({ listZReports: async () => rows })

    const row = await screen.findByTestId('z-row-0')
    expect(row.textContent).not.toMatch(/null/i)
    expect(row.querySelector('strong')?.textContent).toBe('—') // businessDate
    const spans = [...row.querySelectorAll('span')]
    expect(spans[0]?.textContent?.trim()).toBe(`${TH.netSales} —`) // netSalesSatang, no quick-open badge
    expect(spans[1]?.textContent?.trim()).toBe(`${TH.variance} —`) // cashVarianceSatang
    expect(spans[2]?.textContent).toBe(TH.zHashBad) // hashOk: false
    expect(row.querySelector('[data-testid="z-warn-0"]')).toBeNull() // chainWarning: false — unreadable, not a real chain break
  })
})
