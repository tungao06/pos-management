// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PosError } from '../api/errors'
import type { CloseShiftInput, PosApi, ShiftReportDto, UserDto, ZReportDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { CartProvider } from '../app/cart-context'
import { shiftReportKey } from '../app/queries'
import { SessionProvider, useSession } from '../app/session'
import type { CartState } from '../state/cart'
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
/** The same shift a moment later: a ฿10 cash sale slipped in, so the expected cash and the fingerprint both moved. */
const LATER: ShiftReportDto = { ...REPORT, expectedCashSatang: 53_000, fingerprint: 'fp-2' }
const TWO_CUPS: CartState = {
  orderId: 'o-1',
  discount: null,
  lines: [{ key: 'v16|sw50', variantId: 'v16', sweetnessId: 'sw50', productName: 'ชาไทยเย็น', sizeName: '16 oz', sweetnessName: '50%', unitPriceSatang: 4_500, qty: 2 }],
}

function SignedIn(): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return <CloseShiftScreen />
}

function mount(
  closeShift: (input: CloseShiftInput) => Promise<ZReportDto>,
  opts: { shiftReport?: () => Promise<ShiftReportDto>; cart?: CartState } = {},
): { api: PosApi; queryClient: QueryClient } {
  const api = {
    bootstrap: vi.fn(async () => ({ needsSetup: false, device: null, users: [OWNER], openShift: SHIFT, pendingSyncItems: 3, lastBackupAt: null, backupDue: false })),
    shiftReport: vi.fn(opts.shiftReport ?? (async () => REPORT)),
    closeShift: vi.fn(closeShift),
  } as unknown as PosApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <CartProvider initial={opts.cart ?? { orderId: 'o', lines: [], discount: null }}>
            <SignedIn />
          </CartProvider>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { api, queryClient }
}

const countBox = (denominationSatang: number): HTMLInputElement => screen.getByTestId(`count-${denominationSatang}`) as HTMLInputElement
const countDoneButton = (): HTMLButtonElement => screen.getByTestId('count-done') as HTMLButtonElement

/** Confirms the count once the report has settled — `count-done` stays disabled while a reload is in flight. */
async function countDone(): Promise<void> {
  await waitFor(() => expect(countDoneButton().disabled).toBe(false))
  act(() => countDoneButton().click())
}

async function countAndConfirm(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('count-50000')).toBeTruthy())
  fireEvent.change(countBox(50_000), { target: { value: '1' } })
  fireEvent.change(countBox(2_000), { target: { value: '1' } })
  await countDone()
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
    // nothing is pre-filled: every note and coin is counted, not confirmed (D52)
    for (const d of [100_000, 50_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100]) expect(countBox(d).value).toBe('')
    expect(screen.getByTestId('close-counted').textContent).toBe('฿0')
    expect(screen.queryByTestId('close-expected')).toBeNull()
    expect(screen.queryByTestId('close-variance')).toBeNull()
    expect(screen.queryByTestId('close-cart-not-empty')).toBeNull()
    await countAndConfirm()
    expect(screen.getByTestId('close-counted').textContent).toBe('฿520')
    expect(screen.getByTestId('close-expected').textContent).toBe('฿520')
    expect(screen.getByTestId('close-variance').textContent).toBe('฿0')
    expect(screen.getByTestId('close-qr-net').textContent).toBe('฿50')
  })

  it('shows the figures the owner was shown, not a later refetch — and sends that same pair (Q3b-17 · D54)', async () => {
    let reports = 0
    const { api, queryClient } = mount(async () => ({ shiftId: 's1' }) as ZReportDto, {
      shiftReport: async () => {
        reports += 1
        return reports === 1 ? REPORT : LATER
      },
    })
    await countAndConfirm()
    expect(screen.getByTestId('close-expected').textContent).toBe('฿520')

    // the report reloads behind the owner's back (react-query refetches on window focus by default)
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: shiftReportKey })
    })
    await waitFor(() => expect(api.shiftReport).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('close-expected').textContent).toBe('฿520') // still the frozen figures, never ฿530
    expect(screen.getByTestId('close-variance').textContent).toBe('฿0')

    enterPin('1111')
    await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(1))
    expect(inputOf(api, 0)).toMatchObject({ shownExpectedCashSatang: 52_000, shownReportFingerprint: 'fp-1' })
  })

  it('sends the bank-app PromptPay total when typed, null when left empty (Q3b-12 · D53)', async () => {
    let calls = 0
    const { api } = mount(async () => {
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
    const { api } = mount(async () => {
      calls += 1
      if (calls === 1) throw new PosError('Z_CHAIN_BROKEN', 's0')
      return { shiftId: 's1' } as ZReportDto
    })
    await countAndConfirm()
    expect(screen.queryByTestId('close-chain-broken')).toBeNull()
    enterPin('1111')
    await waitFor(() => expect(screen.getByTestId('close-chain-broken').textContent).toBe(TH.zChainAck))
    // the warning is said once: the line by the PIN pad only says what to do next (review M1)
    expect(screen.getAllByRole('alert').map((n) => n.textContent)).toEqual([TH.zChainAck, TH.zChainAckPin])
    // …and that one warning still carries both halves D54 Q3b-16 owes the owner: the cause in plain words, and
    // that acknowledging lets the shift close anyway (the literal Thai is asserted because shortening the copy is
    // exactly the regression — review N-3).
    const warning = screen.getByTestId('close-chain-broken').textContent ?? ''
    expect(warning).toContain('ถูกแก้ไขหรือไฟล์เสีย')
    expect(warning).toContain('ปิดกะต่อได้')
    expect(inputOf(api, 0).acknowledgeZChainBroken).toBe(false)
    enterPin('1111')
    await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(2))
    expect(inputOf(api, 1).acknowledgeZChainBroken).toBe(true)
    // the acknowledged retry still echoes the figures the owner saw — the count is not re-taken behind their back
    expect(inputOf(api, 1)).toMatchObject({ shownExpectedCashSatang: 52_000, shownReportFingerprint: 'fp-1' })
  })

  it('SHIFT_CHANGED clears the count and reloads the report — the drawer is counted again, blind (Q3b-17 · D54)', async () => {
    let reports = 0
    let calls = 0
    const { api } = mount(
      async () => {
        calls += 1
        if (calls === 1) throw new PosError('SHIFT_CHANGED', 'shown 52000, now 53000')
        return { shiftId: 's1' } as ZReportDto
      },
      {
        shiftReport: async () => {
          reports += 1
          return reports === 1 ? REPORT : LATER
        },
      },
    )
    await countAndConfirm()
    enterPin('1111')
    await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(1))

    // back to a blind count: no expected cash on screen and every denomination empty again
    await waitFor(() => expect(screen.queryByTestId('close-expected')).toBeNull())
    expect(screen.getByRole('alert').textContent).toBe(TH.errShiftChanged)
    expect(countBox(50_000).value).toBe('')
    await waitFor(() => expect(api.shiftReport).toHaveBeenCalledTimes(2))

    await countAndConfirm()
    expect(screen.getByTestId('close-expected').textContent).toBe('฿530')
    enterPin('1111')
    await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(2))
    expect(inputOf(api, 1)).toMatchObject({ shownExpectedCashSatang: 53_000, shownReportFingerprint: 'fp-2' })
  })

  it('"แก้จำนวนที่นับ" reopens the boxes, hides the expected cash again and clears a stale error (D52 Q3b-3 · review M6)', async () => {
    const { api } = mount(async () => {
      throw new PosError('PIN_WRONG', 'wrong user or PIN')
    })
    await countAndConfirm()
    enterPin('1111')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(TH.errPinWrong))
    act(() => screen.getByTestId('pin-ok').click()) // a second tap sends nothing: the pad was cleared on submit
    expect(api.closeShift).toHaveBeenCalledTimes(1)

    act(() => screen.getByTestId('count-edit').click())
    expect(screen.queryByTestId('close-expected')).toBeNull() // blind again while the count is open
    expect(screen.queryByRole('alert')).toBeNull() // the PIN error does not follow the owner into the recount
    expect(countBox(50_000).disabled).toBe(false)
    expect(countBox(50_000).value).toBe('1') // what was typed is kept, only re-editable

    fireEvent.change(countBox(50_000), { target: { value: '2' } })
    expect(screen.getByTestId('close-counted').textContent).toBe('฿1,020')
    await countDone()
    expect(screen.getByTestId('close-expected').textContent).toBe('฿520')
    expect(screen.getByTestId('close-variance').textContent).toBe('฿500')
    expect(api.closeShift).toHaveBeenCalledTimes(1) // re-editing sends nothing of its own
  })

  it('a cart with unsold lines blocks the close until it is rung up or cleared', async () => {
    mount(async () => ({}) as ZReportDto, { cart: TWO_CUPS })
    await waitFor(() => expect(screen.getByTestId('count-50000')).toBeTruthy())
    expect(screen.getByTestId('close-cart-not-empty').textContent).toBe(TH.cartNotEmpty)

    fireEvent.change(countBox(50_000), { target: { value: '1' } })
    expect(countDoneButton().disabled).toBe(true)
    act(() => countDoneButton().click())
    expect(screen.queryByTestId('close-expected')).toBeNull() // no expected cash, no PIN pad, no close
  })

  it('the count cannot be confirmed while the report is still reloading (review M2)', async () => {
    let reports = 0
    let landSecondReport: (report: ShiftReportDto) => void = () => undefined
    const { api, queryClient } = mount(async () => ({}) as ZReportDto, {
      shiftReport: async () => {
        reports += 1
        return reports === 1 ? REPORT : new Promise<ShiftReportDto>((resolve) => (landSecondReport = resolve))
      },
    })
    await waitFor(() => expect(screen.getByTestId('count-50000')).toBeTruthy())
    fireEvent.change(countBox(50_000), { target: { value: '1' } })
    expect(countDoneButton().disabled).toBe(false)

    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: shiftReportKey }) // a reload the owner cannot see, still in flight
    })
    await waitFor(() => expect(api.shiftReport).toHaveBeenCalledTimes(2))
    expect(countDoneButton().disabled).toBe(true)
    act(() => countDoneButton().click())
    expect(screen.queryByTestId('close-expected')).toBeNull() // the report about to be replaced is never frozen

    await act(async () => landSecondReport(LATER))
    await countDone()
    expect(screen.getByTestId('close-expected').textContent).toBe('฿530') // the figures that actually landed
  })

  it('a close that finds no open shift refreshes the bootstrap, so the screen leaves itself (review M7)', async () => {
    const { api } = mount(async () => {
      throw new PosError('NO_OPEN_SHIFT', 'no open shift to close')
    })
    await countAndConfirm()
    expect(api.bootstrap).toHaveBeenCalledTimes(1)
    enterPin('1111')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(TH.errNoOpenShift))
    // the shift is gone (a close that committed without answering): the refreshed bootstrap is what redirects
    await waitFor(() => expect(api.bootstrap).toHaveBeenCalledTimes(2))
  })
})
