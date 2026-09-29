// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, useParams } from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapState, PosApi, ZReportDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { HEALTHY_SYNC } from '../test-utils/sync-status'
import { CHAIN_WARNING, zDto } from './block3-test-fixtures'
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
  legacyDevice: false,
  dayoLinked: true,
  dayoBaseUrl: 'https://dayo.example/api/v1',
  staffNeedingPin: [],
  ownerRecovery: false,
  sync: HEALTHY_SYNC,
  countingShift: null,
  zWaiting: [],
}

function ZReportRoute(): JSX.Element {
  const { shiftId } = useParams({ from: '/z/$shiftId' })
  return <ZReportScreen shiftId={shiftId} />
}

function renderZReport(shiftId: string, api: Partial<PosApi>): void {
  const rootRoute = createRootRoute()
  const zReportRoute = createRoute({ getParentRoute: () => rootRoute, path: '/z/$shiftId', component: ZReportRoute })
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

  it('a block 3 Z lists its bot bills and the window', async () => {
    renderZReport('s1', {
      getZReport: vi.fn(async () =>
        zDto({
          botWindow: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T05:00:00.000Z' },
          botBills: [{ orderNo: 'L260925-901', version: 1, source: 'line', soldAt: null, totalSatang: 7_000, createdByName: null }],
          cash: { openingFloatSatang: 50_000, cashSalesSatang: 4_500, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0, drawerExpensesSatang: 0, botCashSatang: 7_000 },
        }),
      ),
    })
    expect(await screen.findByTestId('z-bot-bill-L260925-901')).toHaveTextContent('70.00')
    expect(screen.getByTestId('z-bot-window')).toHaveTextContent('00:00')
  })

  it('a Z from before block 3 (no botBills/botWindow/botCashSatang) still renders', async () => {
    const old = zDto()
    const snap = { ...old.snapshot! } as Record<string, unknown>
    delete snap['botBills']
    delete snap['botWindow']
    delete (snap['cash'] as Record<string, unknown>)['botCashSatang']
    renderZReport('s1', { getZReport: vi.fn(async () => ({ ...old, snapshot: snap }) as ZReportDto) })
    expect(await screen.findByTestId('z-report')).toBeVisible()
    expect(screen.queryByTestId('z-bot-window')).toBeNull()
    // fix round 1 item 13: a Z with no bot window at all (ruling R6, or predates block 3) is labelled local-only
    expect(screen.getByTestId('z-local-only')).toHaveTextContent(TH.zLocalOnly)
  })

  it('a Z continued from dayo names the central Z (R9)', async () => {
    renderZReport('s1', {
      getZReport: vi.fn(async () => zDto({ zNo: 42, chainWarning: { ...CHAIN_WARNING, brokenShiftId: 'central', centralLastZ: { zNo: 41, hash: 'ab'.repeat(32) } } })),
    })
    expect(await screen.findByTestId('z-central-continued')).toHaveTextContent('41')
  })

  it('fix round 1 item 12: a bot bill order_no is sanitized before it reaches the screen (control chars stripped, capped at 32)', async () => {
    // buildZReport (domain) refuses a bad order_no outright — this simulates a hand-edited/legacy row that skipped
    // that check, the same idiom the "before block 3" test above uses (mutate the stored snapshot, not `zDto`'s input).
    const dirty = `L260925-901‮${'x'.repeat(50)}`
    const dto = zDto({ botWindow: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T05:00:00.000Z' }, botBills: [{ orderNo: 'L260925-901', version: 1, source: 'line', soldAt: null, totalSatang: 7_000, createdByName: null }] })
    const snap = { ...dto.snapshot!, botBills: [{ ...dto.snapshot!.botBills![0]!, orderNo: dirty }] }
    renderZReport('s1', { getZReport: vi.fn(async () => ({ ...dto, snapshot: snap })) })
    const clean = dirty.replace(/\p{C}/gu, '').slice(0, 32)
    expect(await screen.findByTestId(`z-bot-bill-${clean}`)).toHaveTextContent(clean)
    expect(screen.queryByTestId(`z-bot-bill-${dirty}`)).toBeNull()
  })
})
