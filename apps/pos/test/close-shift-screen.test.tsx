// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserDto } from '../src/api/types'
import { ApiProvider } from '../src/app/api-context'
import { CartProvider } from '../src/app/cart-context'
import { SessionProvider, useSession } from '../src/app/session'
import { CloseShiftScreen } from '../src/screens/CloseShiftScreen'
import { TH } from '../src/ui/th'
import { openReadyApi, PINS, legacySale, type ReadyApi } from './helpers/db'
import { sellVoidScenario } from './helpers/shift'

/**
 * D101 (spec 04 §6.8 · §4.10): the close-shift screen driven against the **real** on-device API (node:sqlite), not
 * a mocked one — the layer the browser e2e cannot reach, because breaking a stored Z needs raw SQL. It proves that
 * the `shownFingerprint` the screen echoes back to `confirmCount` really is the one the API accepts, that a real
 * SHIFT_CHANGED sends the owner back to a fresh (blind) count, and that a real Z_CHAIN_BROKEN is cleared by a
 * second PIN (Q3b-11 · D53). Rewritten for Task 15's replacement screen — see the report's "Follow-up" section for
 * exactly what changed and why; the invariants above (blind count D52, PIN, the Thai messages) are unchanged.
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
          <CartProvider initial={{ orderId: 'o', channelCode: 'store', billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, lines: [] }}>
            <SignedIn user={t.owner} />
          </CartProvider>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

/** Types one count line by its baht denomination (`count-input-<บาท>`, e.g. 500/20/5/1) — every one left out counts as 0. */
function count(denominationBaht: number, pieces: string): void {
  fireEvent.change(screen.getByTestId(`count-input-${denominationBaht}`), { target: { value: pieces } })
}

async function startCount(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('count-finish')).toBeTruthy())
}

/** "นับเสร็จ" (finishCount) → the review appears once `countSummary` lands. */
async function finishAndReview(): Promise<void> {
  await waitFor(() => expect((screen.getByTestId('count-finish') as HTMLButtonElement).disabled).toBe(false))
  act(() => screen.getByTestId('count-finish').click())
  await waitFor(() => expect(screen.queryByTestId('count-expected')).not.toBeNull())
}

function chooseApprover(name: string): void {
  act(() => screen.getByTestId(`count-approver-${name}`).click())
}

/** PIN digits, then the review's own confirm button (`CountReview`'s `PinPad` — the button is `count-confirm`,
 * labelled per path, not the generic "OK" other screens' `pin-ok` keeps). */
function enterPin(pin: string): void {
  for (const d of pin) act(() => screen.getByTestId(`pin-${d}`).click())
  act(() => screen.getByTestId('count-confirm').click())
}

/** Waits until the API really has `n` Z reports — the only proof the close was written, not merely attempted. */
async function waitForZCount(t: ReadyApi, n: number): Promise<void> {
  await waitFor(async () => expect((await t.api.listZReports()).length).toBe(n))
}

describe('CloseShiftScreen against the real API (D101)', () => {
  it('closes for real: the figures the owner saw are the ones confirmCount accepts, local-only issues the Z right away (ruling R6)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t) // expected cash ฿520
    mount(t)
    await startCount()

    count(500, '1')
    count(20, '1')
    expect(screen.getByTestId('count-total').textContent).toBe('฿520')
    expect(screen.queryByTestId('count-expected')).toBeNull() // blind until "นับเสร็จ" (Q3b-3 · D52)
    await finishAndReview()
    expect(screen.getByTestId('count-expected').textContent).toBe('฿520.00')
    expect(screen.getByTestId('count-variance').textContent).toBe('฿0.00')

    chooseApprover('TungAo')
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
      bankQrTotalSatang: null, // left empty — no bank figure is invented (Q3b-12 · D53, restored fix round 1 item 1)
      qrDifferenceSatang: null,
      chainWarning: null,
    })
  })

  it('a bill landing on the shift after "นับเสร็จ": real SHIFT_CHANGED against the stale echoed fingerprint, the count is cleared and taken again (Q3b-17 · D54)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t) // expected cash ฿520
    mount(t)
    await startCount()
    count(500, '1')
    count(20, '1')
    await finishAndReview()
    expect(screen.getByTestId('count-expected').textContent).toBe('฿520.00')

    // Behind the screen: `finishCount` moved the shift to 'counting', so a normal sale (real recordSale, and
    // `legacySale`'s own currentOpenShift check) can no longer land on it — simulating "another write still slips
    // in" (a second device's stale clock, a direct DB write) needs the status nudged back to 'open' just for this
    // insert, same idiom as the hash-tamper test below. `buildShiftReport` sums every row of the shift with no time
    // filter, so this ฿45 changes the fingerprint the screen is still holding, without the screen doing anything to
    // notice it (there is no continuous re-poll to catch it, unlike the old X report — see the report's Follow-up).
    // both are DB triggers (D101 ruling R2 / "a bill needs an open shift"), not merely the API's own check — drop
    // them for this one insert, exactly like the hash-tamper test below drops `z_report_no_update` (each test
    // opens its own :memory: database; do not copy this idiom blind outside a test).
    t.raw.exec('DROP TRIGGER shift_status_forward_only')
    t.raw.exec('DROP TRIGGER order_open_shift_only')
    t.raw.prepare(`update shift set status = 'open' where id = ?`).run(t.shift.id)
    await legacySale(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 5_000 })
    t.raw.prepare(`update shift set status = 'counting' where id = ?`).run(t.shift.id)
    expect(screen.getByTestId('count-expected').textContent).toBe('฿520.00') // still the stale figures — proves what gets sent below

    chooseApprover('TungAo')
    enterPin(PINS.TungAo)

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(TH.errShiftChanged))
    expect((await t.api.listZReports()).length).toBe(0) // nothing was written
    // D52 (old `setShown(null)` behaviour, fix round 1 item 6): fully blind again — the count is cleared and the
    // expected cash/variance are hidden until "นับเสร็จ" is pressed once more, not shown mid-reload.
    expect((screen.getByTestId('count-input-500') as HTMLInputElement).value).toBe('')
    expect(screen.queryByTestId('count-expected')).toBeNull()

    // recount, blind, against the reloaded figures: ฿520 + ฿45 = ฿565
    count(500, '1')
    count(20, '3')
    count(5, '1')
    expect(screen.getByTestId('count-total').textContent).toBe('฿565')
    await finishAndReview()
    expect(screen.getByTestId('count-expected').textContent).toBe('฿565.00')
    chooseApprover('TungAo')
    enterPin(PINS.TungAo)
    await waitForZCount(t, 1)
    expect((await t.api.getZReport(t.shift.id)).snapshot).toMatchObject({ countedCashSatang: 56_500, expectedCashSatang: 56_500, cashVarianceSatang: 0 })
  })

  it('a previous Z that fails its hash: the screen shows the warning and a second PIN acknowledges it (Q3b-11 · D53)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    mount(t)
    await startCount()
    count(500, '1')
    count(20, '1')
    await finishAndReview()
    chooseApprover('TungAo')
    enterPin(PINS.TungAo)
    await waitForZCount(t, 1)
    const z1 = await t.api.getZReport(t.shift.id)
    cleanup()

    // Someone edits the stored Z by hand — its hash no longer matches (spec §7 invariant 6). The append-only
    // trigger stays dropped for the rest of this test (review M8): harmless here, since each test opens its own
    // :memory: database and confirmCount only ever inserts into z_report — but do not copy this idiom blind.
    t.raw.exec('DROP TRIGGER z_report_no_update')
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.grandTotalSatang', 999)`).run()

    t.clock.set('2026-09-18T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await legacySale(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 5_000 }) // ฿45 cash
    mount(t)
    await startCount()
    count(20, '2')
    count(5, '1')
    await finishAndReview()
    expect(screen.getByTestId('count-expected').textContent).toBe('฿45.00')
    expect(screen.queryByTestId('close-chain-broken')).toBeNull()

    chooseApprover('TungAo')
    enterPin(PINS.TungAo)
    await waitFor(() => expect(screen.getByTestId('close-chain-broken').textContent).toBe(TH.zChainAck))
    expect((await t.api.listZReports()).length).toBe(1) // refused: nothing written until the owner acknowledges

    chooseApprover('TungAo')
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
