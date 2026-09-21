// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapState, OrderDetailDto, PosApi, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { shiftReportKey } from '../app/queries'
import { SessionProvider, useSession } from '../app/session'
import { VoidDialog } from './VoidDialog'

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }

const ORDER: OrderDetailDto = {
  id: 'o1',
  receiptNo: 'A-000001',
  queueNo: 1,
  status: 'paid',
  totalSatang: 4_500,
  method: 'CASH',
  paidAt: '2026-09-17T10:00:00Z',
  cups: 1,
  businessDate: '2026-09-17',
  shiftId: 's1',
  subtotalSatang: 4_500,
  discountSatang: 0,
  discountReason: null,
  tenderedSatang: 5_000,
  changeSatang: 500,
  voidedAt: null,
  lines: [],
  events: [],
  voidable: true,
}

const BOOT: BootstrapState = {
  needsSetup: false,
  device: { id: 'd1', name: 'เครื่อง 1', receiptPrefix: 'A' },
  users: [OWNER],
  openShift: { id: 's1', businessDate: '2026-09-17', openedAt: '2026-09-17T00:00:00Z', openedBy: 'u1', openingFloatSatang: 50_000 },
  pendingSyncItems: 0,
  lastBackupAt: null,
  backupDue: false,
}

function SignedIn({ children }: { children: JSX.Element }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return children
}

function mount(overrides: Partial<PosApi> = {}): { api: PosApi; onClose: ReturnType<typeof vi.fn>; queryClient: QueryClient } {
  const onClose = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const api = {
    bootstrap: vi.fn(async () => BOOT),
    voidOrder: vi.fn(async (): Promise<OrderDetailDto> => ({ ...ORDER, status: 'voided', voidedAt: '2026-09-17T10:05:00Z', voidable: false })),
    ...overrides,
  } as unknown as PosApi
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <SignedIn>
            <VoidDialog order={ORDER} onClose={onClose} />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { api, onClose, queryClient }
}

/** Fills the reason, the "made yet?" choice and the (already preselected, signed-in owner) approver, then enters a
 * 4-digit PIN and presses OK — enough to reach VoidDialog's onSuccess. */
async function submitVoid(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId(`void-approver-${OWNER.displayName}`)).toBeTruthy())
  fireEvent.change(screen.getByTestId('void-reason'), { target: { value: 'ลูกค้าขอคืนเงิน' } })
  fireEvent.click(screen.getByTestId('void-made-no'))
  fireEvent.click(screen.getByTestId(`void-approver-${OWNER.displayName}`))
  for (const d of ['1', '2', '3', '4']) fireEvent.click(screen.getByTestId(`pin-${d}`))
  fireEvent.click(screen.getByTestId('pin-ok'))
}

describe('VoidDialog — review m-2: the shift-report cache must be invalidated after a void', () => {
  it('invalidates shiftReportKey on a successful void, so the X report and the Q3b-14 over-drawer check are never stale', async () => {
    const { api, onClose, queryClient } = mount()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await submitVoid()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(api.voidOrder).toHaveBeenCalled()
    // The only assertion review m-2 needs: without `queryClient.invalidateQueries({ queryKey: shiftReportKey })` in
    // VoidDialog's onSuccess, this call is never made and this test fails — a cash void changes expectedCashSatang,
    // and a stale X report can miss the Q3b-14 over-drawer warning for up to staleTime (5s, main.tsx) afterwards.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: shiftReportKey })
  })
})
