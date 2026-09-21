// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BootstrapState, PosApi, ZReportDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { TH } from '../ui/th'
import { ZReportScreen } from './ZReportScreen'

afterEach(() => cleanup())

const bootstrap: BootstrapState = {
  needsSetup: false,
  device: { id: 'd1', name: 'แท็บเล็ตหน้าร้าน', receiptPrefix: 'A' },
  users: [],
  openShift: null,
  pendingSyncItems: 0,
  lastBackupAt: null,
  backupDue: false,
}

function renderZReport(shiftId: string, api: Partial<PosApi>): void {
  const rootRoute = createRootRoute()
  const zReportRoute = createRoute({ getParentRoute: () => rootRoute, path: '/z/$shiftId', component: ZReportScreen })
  const zListRoute = createRoute({ getParentRoute: () => rootRoute, path: '/z', component: () => null })
  const backupRoute = createRoute({ getParentRoute: () => rootRoute, path: '/backup', component: () => null })
  const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null })
  const routeTree = rootRoute.addChildren([homeRoute, zListRoute, zReportRoute, backupRoute])
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [`/z/${shiftId}`] }) })
  const queryClient = new QueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={{ bootstrap: async () => bootstrap, ...api } as PosApi}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

describe('ZReportScreen', () => {
  // review I-1 adaptation (Task 6): ZReportDto.snapshot is null when the stored row is unreadable — hashOk is
  // then always false. The screen must show a clear message instead of crashing on `snapshot.sales` etc.
  it('shows the unreadable message and the tamper warning when the snapshot cannot be read', async () => {
    const dto: ZReportDto = { id: 'z1', shiftId: 'shift-1', createdAt: '2026-09-01T10:00:00Z', hash: 'deadbeefcafebabefeed1234', hashOk: false, snapshot: null }
    renderZReport('shift-1', { getZReport: async () => dto })

    expect((await screen.findByTestId('z-unreadable')).textContent).toBe(TH.zUnreadable)
    const hash = screen.getByTestId('z-hash')
    expect(hash.getAttribute('data-ok')).toBe('false')
    expect(hash.textContent).toContain(TH.zHashBad)
    // no snapshot-derived figures crash the screen
    expect(screen.queryByTestId('z-counted')).toBeNull()
  })
})
