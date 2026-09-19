// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CashMovementDto, CashMovementInput, PosApi, ShiftReportDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { shiftReportKey } from '../app/queries'
import { SessionProvider, useSession } from '../app/session'
import { TH } from '../ui/th'
import { CashMoveDialog } from './CashMoveDialog'

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }

const REPORT: ShiftReportDto = {
  shift: { id: 's1', businessDate: '2026-09-17', openedAt: '2026-09-17T00:00:00Z', openedBy: 'u1', openingFloatSatang: 50_000, openedByName: 'TungAo', openedQuick: false },
  generatedAt: '2026-09-17T10:00:00Z',
  sales: { orderCount: 0, voidCount: 0, grossSalesSatang: 0, discountSatang: 0, voidedSatang: 0, netSalesSatang: 0, cashSalesSatang: 0, qrSalesSatang: 0, qrRefundedSatang: 0, qrNetSatang: 0 },
  cash: { openingFloatSatang: 50_000, cashSalesSatang: 0, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 },
  // expected drawer cash ฿500 — never rendered by this dialog (blind count, Q3b-3 · D52)
  expectedCashSatang: 50_000,
  varianceAlertSatang: 2_000,
  cashMovements: [],
  voids: [],
  negativeBases: [],
  pendingSyncItems: 0,
}

function SignedIn({ children }: { children: JSX.Element }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return children
}

function mount(overrides: Partial<PosApi> = {}): { api: PosApi; onClose: ReturnType<typeof vi.fn>; queryClient: QueryClient } {
  const onClose = vi.fn()
  const api = {
    shiftReport: vi.fn(async () => REPORT),
    recordCashMovement: vi.fn(
      async (input: CashMovementInput): Promise<CashMovementDto> => ({
        id: 'm1',
        kind: input.kind,
        amountSatang: input.amountSatang,
        orderId: null,
        reason: input.reason,
        createdBy: input.actorUserId,
        createdAt: '2026-09-17T10:00:00Z',
      }),
    ),
    ...overrides,
  } as unknown as PosApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <SignedIn>
            <CashMoveDialog onClose={onClose} />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { api, onClose, queryClient }
}

/** Picks the kind, fills the amount and reason, and waits for the shift-report fetch that Q3b-14 compares against
 * — otherwise a click on "cash-save" could land before `report.data` is set and the over-drawer check would be
 * silently skipped. */
async function fillMove(queryClient: QueryClient, kind: 'PAID_IN' | 'PAID_OUT' | 'DROP', amountBaht: string, reason: string): Promise<void> {
  await waitFor(() => expect(queryClient.getQueryData(shiftReportKey)).toEqual(REPORT))
  fireEvent.click(screen.getByTestId(`cash-kind-${kind}`))
  fireEvent.change(screen.getByTestId('cash-amount'), { target: { value: amountBaht } })
  fireEvent.change(screen.getByTestId('cash-reason'), { target: { value: reason } })
}

describe('CashMoveDialog — Q3b-14 · D54 blind over-drawer confirm', () => {
  it('paid-out over the expected drawer cash warns and does not save on the first press, without naming the figure', async () => {
    const { api, onClose, queryClient } = mount()
    await fillMove(queryClient, 'PAID_OUT', '600', 'ซื้อของ') // expected ฿500
    fireEvent.click(screen.getByTestId('cash-save'))

    await waitFor(() => expect(screen.getByTestId('cash-over-drawer-warning')).toBeTruthy())
    expect(screen.getByTestId('cash-over-drawer-warning').textContent).toBe(TH.cashOverDrawerWarning)
    expect(screen.getByTestId('cash-over-drawer-warning').textContent).not.toContain('500') // no figure named
    expect(api.recordCashMovement).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('saves once the second, explicit confirm is pressed', async () => {
    const { api, onClose, queryClient } = mount()
    await fillMove(queryClient, 'PAID_OUT', '600', 'ซื้อของ')
    fireEvent.click(screen.getByTestId('cash-save'))
    await waitFor(() => expect(screen.getByTestId('cash-over-drawer-confirm')).toBeTruthy())

    fireEvent.click(screen.getByTestId('cash-over-drawer-confirm'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(api.recordCashMovement).toHaveBeenCalledWith({ actorUserId: OWNER.id, kind: 'PAID_OUT', amountSatang: 60_000, reason: 'ซื้อของ' })
  })

  it('no warning at or below the expected drawer cash', async () => {
    const { api, onClose, queryClient } = mount()
    await fillMove(queryClient, 'DROP', '500', 'เก็บเงิน') // exactly at the expected figure
    fireEvent.click(screen.getByTestId('cash-save'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByTestId('cash-over-drawer-warning')).toBeNull()
    expect(api.recordCashMovement).toHaveBeenCalledWith({ actorUserId: OWNER.id, kind: 'DROP', amountSatang: 50_000, reason: 'เก็บเงิน' })
  })

  it('paid-in never warns, however large', async () => {
    const { api, onClose, queryClient } = mount()
    await fillMove(queryClient, 'PAID_IN', '600', 'เติมเงินทอน') // above expected, but paid-in only ever helps the drawer
    fireEvent.click(screen.getByTestId('cash-save'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByTestId('cash-over-drawer-warning')).toBeNull()
    expect(api.recordCashMovement).toHaveBeenCalledWith({ actorUserId: OWNER.id, kind: 'PAID_IN', amountSatang: 60_000, reason: 'เติมเงินทอน' })
  })
})
