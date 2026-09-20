// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserDto } from '../src/api/types'
import { ApiProvider } from '../src/app/api-context'
import { CartProvider } from '../src/app/cart-context'
import { shiftReportKey } from '../src/app/queries'
import { SessionProvider, useSession } from '../src/app/session'
import { CloseShiftScreen } from '../src/screens/CloseShiftScreen'
import { TH } from '../src/ui/th'
import { openReadyApi, PINS, sellSku, type ReadyApi } from './helpers/db'
import { sellVoidScenario } from './helpers/shift'

/**
 * The close-shift screen driven against the **real** on-device API (node:sqlite), not a mocked one — the layer the
 * browser e2e cannot reach, because breaking a stored Z needs raw SQL. It is what proves that the pair the screen
 * echoes back (`shownExpectedCashSatang` + `shownReportFingerprint`, Q3b-17 · D54) really is the pair `closeShift`
 * accepts, that a real SHIFT_CHANGED sends the owner back to a blind recount, and that a real Z_CHAIN_BROKEN is
 * cleared by a second PIN (Q3b-11 · D53).
 */

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
}))

afterEach(() => cleanup())

function SignedIn({ user }: { user: UserDto }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(user), [signIn, user])
  return <CloseShiftScreen />
}

function mount(t: ReadyApi): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={t.api}>
        <SessionProvider>
          <CartProvider initial={{ orderId: 'o', lines: [], discount: null }}>
            <SignedIn user={t.owner} />
          </CartProvider>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

/** Types one count line; every denomination left out counts as 0. */
function count(denominationSatang: number, pieces: string): void {
  fireEvent.change(screen.getByTestId(`count-${denominationSatang}`), { target: { value: pieces } })
}

async function startCount(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('count-50000')).toBeTruthy())
}

/** Confirms the count once the report has settled — `count-done` stays disabled while a reload is in flight. */
async function countDone(): Promise<void> {
  await waitFor(() => expect((screen.getByTestId('count-done') as HTMLButtonElement).disabled).toBe(false))
  act(() => screen.getByTestId('count-done').click())
  act(() => screen.getByTestId('close-approver-TungAo').click())
}

function enterPin(pin: string): void {
  for (const d of pin) act(() => screen.getByTestId(`pin-${d}`).click())
  act(() => screen.getByTestId('pin-ok').click())
}

/** Waits until the API really has `n` Z reports — the only proof the close was written, not merely attempted. */
async function waitForZCount(t: ReadyApi, n: number): Promise<void> {
  await waitFor(async () => expect((await t.api.listZReports()).length).toBe(n))
}

describe('CloseShiftScreen against the real API', () => {
  it('closes for real: the figures the owner saw are the ones closeShift accepts, bank QR left empty (Q3b-12 · D53)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t) // expected cash ฿520
    mount(t)
    await startCount()

    count(50_000, '1')
    count(2_000, '1')
    expect(screen.getByTestId('close-counted').textContent).toBe('฿520')
    expect(screen.queryByTestId('close-expected')).toBeNull() // blind until the count is confirmed (Q3b-3 · D52)
    await countDone()
    expect(screen.getByTestId('close-expected').textContent).toBe('฿520')
    expect(screen.getByTestId('close-variance').textContent).toBe('฿0')

    enterPin(PINS.TungAo)
    await waitForZCount(t, 1)
    const z = await t.api.getZReport(t.shift.id)
    expect(z.hashOk).toBe(true)
    expect(z.snapshot).toMatchObject({
      zNo: 1,
      countedCashSatang: 52_000,
      expectedCashSatang: 52_000,
      cashVarianceSatang: 0,
      varianceReason: null,
      bankQrTotalSatang: null, // left empty — no bank figure is invented (Q3b-12 · D53)
      qrDifferenceSatang: null,
      chainWarning: null,
    })
  })

  it('a sale made while the drawer was being counted: real SHIFT_CHANGED, the count is cleared and taken again (Q3b-17 · D54)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t) // expected cash ฿520
    const queryClient = mount(t)
    await startCount()
    count(50_000, '1')
    count(2_000, '1')
    await countDone()
    expect(screen.getByTestId('close-expected').textContent).toBe('฿520')

    await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 5_000 }) // ฿45 into the drawer, behind the screen
    // …and the report reloads on top of it (a window-focus refetch). Waiting for the *newer* report to be in the
    // cache is what gives the next line its meaning: the owner is still looking at the ฿520 they were shown, and
    // that is the pair the PIN submits — the real API is then the one that refuses it.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: shiftReportKey })
    })
    await waitFor(() => expect(queryClient.getQueryData(shiftReportKey)).toMatchObject({ expectedCashSatang: 56_500 }))
    expect(screen.getByTestId('close-expected').textContent).toBe('฿520')
    enterPin(PINS.TungAo)

    await waitFor(() => expect(screen.queryByTestId('close-expected')).toBeNull())
    expect(screen.getByRole('alert').textContent).toBe(TH.errShiftChanged)
    expect((screen.getByTestId('count-50000') as HTMLInputElement).value).toBe('')
    expect((await t.api.listZReports()).length).toBe(0) // nothing was written

    // count again, blind, against the reloaded figures: ฿520 + ฿45 = ฿565
    count(50_000, '1')
    count(2_000, '3')
    count(500, '1')
    await waitFor(() => expect(screen.getByTestId('close-counted').textContent).toBe('฿565'))
    await countDone()
    expect(screen.getByTestId('close-expected').textContent).toBe('฿565')
    enterPin(PINS.TungAo)
    await waitForZCount(t, 1)
    expect((await t.api.getZReport(t.shift.id)).snapshot).toMatchObject({ countedCashSatang: 56_500, expectedCashSatang: 56_500, cashVarianceSatang: 0 })
  })

  it('a previous Z that fails its hash: the screen shows the warning and a second PIN acknowledges it (Q3b-11 · D53)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    mount(t)
    await startCount()
    count(50_000, '1')
    count(2_000, '1')
    await countDone()
    enterPin(PINS.TungAo)
    await waitForZCount(t, 1)
    const z1 = await t.api.getZReport(t.shift.id)
    cleanup()

    // Someone edits the stored Z by hand — its hash no longer matches (spec §7 invariant 6). The append-only
    // trigger stays dropped for the rest of this test (review M8): harmless here, since each test opens its own
    // :memory: database and closeShift only ever inserts into z_report — but do not copy this idiom blind.
    t.raw.exec('DROP TRIGGER z_report_no_update')
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.grandTotalSatang', 999)`).run()

    t.clock.set('2026-09-18T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 5_000 }) // ฿45 cash
    mount(t)
    await startCount()
    count(2_000, '2')
    count(500, '1')
    await countDone()
    expect(screen.getByTestId('close-expected').textContent).toBe('฿45')
    expect(screen.queryByTestId('close-chain-broken')).toBeNull()

    enterPin(PINS.TungAo)
    await waitFor(() => expect(screen.getByTestId('close-chain-broken').textContent).toBe(TH.zChainAck))
    expect((await t.api.listZReports()).length).toBe(1) // refused: nothing written until the owner acknowledges

    enterPin(PINS.TungAo)
    await waitForZCount(t, 2)
    const list = await t.api.listZReports()
    expect(list.map((z) => [z.zNo, z.hashOk, z.chainWarning])).toEqual([
      [2, true, true],
      [1, false, false], // the hand-edited Z1 — its own hash no longer matches
    ])
    const z2 = await t.api.getZReport(list[0]!.shiftId)
    expect(z2.snapshot?.chainWarning).toMatchObject({ brokenShiftId: z1.shiftId, storedGrandTotalSatang: 999, acknowledgedBy: t.owner.id })
  })
})
