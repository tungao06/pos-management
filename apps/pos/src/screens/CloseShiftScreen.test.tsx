// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PosError } from '../api/errors'
import type { CloseShiftInput, PosApi, ShiftReportDto, UserDto, ZReportDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { CartProvider } from '../app/cart-context'
import { SessionProvider, useSession } from '../app/session'
import { TH } from '../ui/th'
import { CloseShiftScreen } from './CloseShiftScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
}))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }
const SHIFT = { id: 's1', businessDate: '2026-09-17', openedAt: '2026-09-17T01:00:00.000Z', openedBy: 'u1', openingFloatSatang: 50_000 }
const REPORT: ShiftReportDto = {
  shift: { ...SHIFT, openedByName: 'TungAo', openedQuick: false },
  generatedAt: '2026-09-17T13:00:00.000Z',
  sales: { orderCount: 2, voidCount: 0, grossSalesSatang: 9_500, discountSatang: 0, voidedSatang: 0, netSalesSatang: 9_500, cashSalesSatang: 4_500, qrSalesSatang: 5_000, qrRefundedSatang: 0, qrNetSatang: 5_000 },
  cash: { openingFloatSatang: 50_000, cashSalesSatang: 4_500, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 2_500, dropsSatang: 0 },
  expectedCashSatang: 52_000,
  varianceAlertSatang: 2_000,
  cashMovements: [],
  voids: [],
  negativeBases: [],
  pendingSyncItems: 3,
  // Q3b-17 · D54: opaque to the screen — echoed straight back into closeShift, so any figure that moved is refused.
  fingerprint: 'fp-1',
}

function SignedIn(): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return <CloseShiftScreen />
}

function mount(closeShift: (input: CloseShiftInput) => Promise<ZReportDto>, shiftReport: () => Promise<ShiftReportDto> = async () => REPORT): PosApi {
  const api = {
    bootstrap: vi.fn(async () => ({ needsSetup: false, device: null, users: [OWNER], openShift: SHIFT, pendingSyncItems: 3, lastBackupAt: null, backupDue: false })),
    shiftReport: vi.fn(shiftReport),
    closeShift: vi.fn(closeShift),
  } as unknown as PosApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <CartProvider initial={{ orderId: 'o', lines: [], discount: null }}>
            <SignedIn />
          </CartProvider>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return api
}

async function countAndConfirm(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('count-50000')).toBeTruthy())
  fireEvent.change(screen.getByTestId('count-50000'), { target: { value: '1' } })
  fireEvent.change(screen.getByTestId('count-2000'), { target: { value: '1' } })
  act(() => screen.getByTestId('count-done').click())
  act(() => screen.getByTestId('close-approver-TungAo').click())
}

function enterPin(pin: string): void {
  for (const d of pin) act(() => screen.getByTestId(`pin-${d}`).click())
  act(() => screen.getByTestId('pin-ok').click())
}

const inputOf = (api: PosApi, call: number): CloseShiftInput => (api.closeShift as unknown as ReturnType<typeof vi.fn>).mock.calls[call]![0] as CloseShiftInput

describe('CloseShiftScreen', () => {
  it('counts blind: the expected cash appears only after the count is confirmed (Q3b-3 · D52 · review I-2)', async () => {
    mount(async () => ({}) as ZReportDto)
    await waitFor(() => expect(screen.getByTestId('count-50000')).toBeTruthy())
    expect(screen.queryByTestId('close-expected')).toBeNull()
    expect(screen.queryByTestId('close-variance')).toBeNull()
    await countAndConfirm()
    expect(screen.getByTestId('close-counted').textContent).toBe('฿520')
    expect(screen.getByTestId('close-expected').textContent).toBe('฿520')
    expect(screen.getByTestId('close-variance').textContent).toBe('฿0')
    expect(screen.getByTestId('close-qr-net').textContent).toBe('฿50')
  })

  it('sends the bank-app PromptPay total when typed, null when left empty (Q3b-12 · D53)', async () => {
    let calls = 0
    const api = mount(async () => {
      calls += 1
      if (calls === 1) throw new PosError('PIN_WRONG', 'wrong user or PIN') // stay on the screen for a second try
      return { shiftId: 's1' } as ZReportDto
    })
    await countAndConfirm()
    enterPin('1111')
    await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(1))
    expect(inputOf(api, 0)).toMatchObject({
      bankQrTotalSatang: null,
      acknowledgeZChainBroken: false,
      approverUserId: OWNER.id,
      // both guards come from the one shiftReport() the owner was actually shown (Q3b-17 · D54)
      shownExpectedCashSatang: 52_000,
      shownReportFingerprint: 'fp-1',
    })
    fireEvent.change(screen.getByTestId('close-bank-qr'), { target: { value: '45.50' } })
    enterPin('1111')
    await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(2))
    expect(inputOf(api, 1).bankQrTotalSatang).toBe(4_550)
  })

  it('after Z_CHAIN_BROKEN the owner enters the PIN again to acknowledge (Q3b-11 · D53)', async () => {
    let calls = 0
    const api = mount(async () => {
      calls += 1
      if (calls === 1) throw new PosError('Z_CHAIN_BROKEN', 's0')
      return { shiftId: 's1' } as ZReportDto
    })
    await countAndConfirm()
    expect(screen.queryByTestId('close-chain-broken')).toBeNull()
    enterPin('1111')
    await waitFor(() => expect(screen.getByTestId('close-chain-broken')).toBeTruthy())
    expect(inputOf(api, 0).acknowledgeZChainBroken).toBe(false)
    enterPin('1111')
    await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(2))
    expect(inputOf(api, 1).acknowledgeZChainBroken).toBe(true)
    // the acknowledged retry still echoes the figures the owner saw — the count is not re-taken behind their back
    expect(inputOf(api, 1)).toMatchObject({ shownExpectedCashSatang: 52_000, shownReportFingerprint: 'fp-1' })
  })

  it('SHIFT_CHANGED clears the count and reloads the report — the drawer is counted again, blind (Q3b-17 · D54)', async () => {
    // a ฿10 cash sale slipped in while the drawer was being counted: expected cash and the fingerprint both move
    const LATER: ShiftReportDto = { ...REPORT, expectedCashSatang: 53_000, fingerprint: 'fp-2' }
    let reports = 0
    let calls = 0
    const api = mount(
      async () => {
        calls += 1
        if (calls === 1) throw new PosError('SHIFT_CHANGED', 'shown 52000, now 53000')
        return { shiftId: 's1' } as ZReportDto
      },
      async () => {
        reports += 1
        return reports === 1 ? REPORT : LATER
      },
    )
    await countAndConfirm()
    enterPin('1111')
    await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(1))

    // back to a blind count: no expected cash on screen and every denomination empty again
    await waitFor(() => expect(screen.queryByTestId('close-expected')).toBeNull())
    expect(screen.getByRole('alert').textContent).toBe(TH.errShiftChanged)
    expect((screen.getByTestId('count-50000') as HTMLInputElement).value).toBe('')
    await waitFor(() => expect(api.shiftReport).toHaveBeenCalledTimes(2))

    await countAndConfirm()
    expect(screen.getByTestId('close-expected').textContent).toBe('฿530')
    enterPin('1111')
    await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(2))
    expect(inputOf(api, 1)).toMatchObject({ shownExpectedCashSatang: 53_000, shownReportFingerprint: 'fp-2' })
  })
})
