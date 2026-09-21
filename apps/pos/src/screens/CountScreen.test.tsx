// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PosApi, StockCountDto, StockItemDto, StockOverviewDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { SessionProvider, useSession } from '../app/session'
import { CountScreen, countedUseMilli } from './CountScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }
const item = (code: string, isKeyCount: boolean): StockItemDto => ({
  itemId: `i-${code}`, code, name: code, kind: 'raw', category: 'x', useUnit: 'g', onHandMilli: 800_000, avgCostUsat: 19_250_000, priceCheckUsat: 19_250_000, valueSatang: 15_400,
  reorderPointMilli: 400_000, status: 'ok', alert: false, isKeyCount, units: [{ id: `u-${code}`, name: 'ถุง', qtyPerUnitMilli: 400_000, isDefault: true }],
  shelfLifeHours: null, latestBatch: null, bom: null, isActive: true,
})
const OVERVIEW: StockOverviewDto = {
  generatedAt: '2026-09-17T03:00:00.000Z', businessDate: '2026-09-17', items: [item('RM-TEA-01', true), item('RM-POW-01', false)], totalValueSatang: 30_800,
  alertCount: 0, expiredBaseCodes: [], lastCountAt: '2026-09-10T03:00:00.000Z', countDue: true, openCountId: 'c1', openingCountPending: false,
}
const OPEN: StockCountDto = { id: 'c1', businessDate: '2026-09-17', status: 'open', createdBy: 'u1', createdAt: '2026-09-17T03:00:00.000Z', closedAt: null, lines: [], totalVarianceSatang: 0 }
const WITH_LINE: StockCountDto = {
  ...OPEN,
  lines: [{ itemId: 'i-RM-TEA-01', code: 'RM-TEA-01', name: 'RM-TEA-01', useUnit: 'g', purchaseUnitId: 'u-RM-TEA-01', unitName: 'ถุง', countedUnitsMilli: 1_500, countedUseMilli: 600_000, expectedUseMilli: 800_000, varianceUseMilli: -200_000, varianceSatang: -3_850, opening: false }],
  totalVarianceSatang: -3_850,
}

function SignedIn(): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return <CountScreen />
}

function mount(): PosApi {
  const api = {
    stockOverview: vi.fn(async () => OVERVIEW),
    getOpenStockCount: vi.fn(async () => OPEN),
    saveCountLine: vi.fn(async () => WITH_LINE),
  } as unknown as PosApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <SignedIn />
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return api
}

/**
 * Every method CountScreen may call, mocked with a sane default so a test can override only what it exercises. Used
 * by the tests below that go beyond the three calls `mount()` covers (recount, remove, close, disable-while-pending).
 */
function mountFull(overrides: Partial<PosApi> = {}): PosApi {
  const api = {
    stockOverview: vi.fn(async () => OVERVIEW),
    getOpenStockCount: vi.fn(async () => OPEN),
    startStockCount: vi.fn(async () => OPEN),
    saveCountLine: vi.fn(async () => WITH_LINE),
    removeCountLine: vi.fn(async () => OPEN),
    closeStockCount: vi.fn(async () => ({ ...WITH_LINE, status: 'closed' as const, closedAt: '2026-09-17T04:00:00.000Z' })),
    ...overrides,
  } as unknown as PosApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <SignedIn />
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return api
}

/**
 * The book figure (800 g on-hand / expected) must never reach the screen before a line is saved — not as visible
 * text, and not tucked into a `title` or `aria-*` attribute where a person would not see it but the DOM still
 * "shows" it (review "Blind count"). Scans every element, not just `textContent`.
 */
function leaksFigure(value: string): boolean {
  if (document.body.textContent?.includes(value) === true) return true
  return Array.from(document.body.querySelectorAll('*')).some((el) =>
    ['title', 'aria-label', 'aria-describedby', 'alt'].some((attr) => (el.getAttribute(attr) ?? '').includes(value)),
  )
}

describe('CountScreen (spec §4.5 · Q4-3 blind count · Q4-14 units + rest)', () => {
  it('shows the key items only, with no book figure before a line is saved; the variance appears after saving', async () => {
    const api = mount()
    await waitFor(() => expect(screen.getByTestId('count-row-RM-TEA-01')).toBeTruthy())
    expect(screen.queryByTestId('count-row-RM-POW-01')).toBeNull() // not in the key set (Q4-2)
    expect(document.body.textContent).not.toContain('800') // the book 800 g is never on screen before counting
    fireEvent.change(screen.getByTestId('count-units-RM-TEA-01'), { target: { value: '1' } }) // 1 full bag (400 g) …
    fireEvent.change(screen.getByTestId('count-rest-RM-TEA-01'), { target: { value: '200' } }) // … + 200 g loose (Q4-14)
    act(() => screen.getByTestId('count-save-RM-TEA-01').click())
    await waitFor(() => expect(screen.getByTestId('count-variance-RM-TEA-01').textContent).toContain('-200 g'))
    expect(screen.getByTestId('count-variance-RM-TEA-01').textContent).toContain('-฿38.50')
    expect(api.saveCountLine).toHaveBeenCalledWith({ actorUserId: 'u1', countId: 'c1', itemId: 'i-RM-TEA-01', purchaseUnitId: null, countedUnitsMilli: 600_000 })
    act(() => screen.getByTestId('count-scope-all').click())
    expect(screen.getByTestId('count-row-RM-POW-01')).toBeTruthy()
  })

  it('refuses a bad number on screen without calling the API', async () => {
    const api = mount()
    await waitFor(() => expect(screen.getByTestId('count-rest-RM-TEA-01')).toBeTruthy())
    fireEvent.change(screen.getByTestId('count-rest-RM-TEA-01'), { target: { value: '1.2345' } })
    act(() => screen.getByTestId('count-save-RM-TEA-01').click())
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(api.saveCountLine).not.toHaveBeenCalled()
  })
})

describe('countedUseMilli (Q4-14)', () => {
  it('whole purchase units + the loose rest in the use unit; blank is 0; not a number is null', () => {
    expect(countedUseMilli('3', '120', 400_000)).toBe(1_320_000)
    expect(countedUseMilli('', '', 400_000)).toBe(0)
    expect(countedUseMilli('', '16.6', null)).toBe(16_600) // a base: no purchase unit
    expect(countedUseMilli('1.5', '', 400_000)).toBeNull() // whole units only
    expect(countedUseMilli('2', 'abc', 400_000)).toBeNull()
  })
})

describe('CountScreen — blind count leaves no trace of the book figure anywhere in the DOM before a line is saved (review "Blind count")', () => {
  it('never renders the on-hand/book figure in text, title, aria-label, aria-describedby or alt before saving', async () => {
    mountFull()
    await waitFor(() => expect(screen.getByTestId('count-row-RM-TEA-01')).toBeTruthy())
    // RM-TEA-01's book on-hand is 800_000 milli-g → "800 g" is the exact figure that must never leak.
    expect(leaksFigure('800')).toBe(false)
  })

  it('still hides the figure once one line is saved, for every OTHER unsaved row on the same screen', async () => {
    mountFull({ getOpenStockCount: vi.fn(async () => WITH_LINE) }) // RM-TEA-01 already saved; RM-POW-01 is not
    await waitFor(() => expect(screen.getByTestId('count-counted-RM-TEA-01')).toBeTruthy())
    fireEvent.click(screen.getByTestId('count-scope-all'))
    await waitFor(() => expect(screen.getByTestId('count-row-RM-POW-01')).toBeTruthy())
    // RM-POW-01 is still unsaved: its own book figure (also 800 g in this fixture) must not appear either.
    expect(leaksFigure('800')).toBe(false)
  })
})

describe('CountScreen — "แก้ตัวเลข" is a typo fix only; a genuine recount goes through "ไม่นับรายการนี้" (review m-2, Task 7)', () => {
  it('"แก้ตัวเลข" is labelled and titled as a typo fix, reopens the inputs, and only calls saveCountLine again', async () => {
    const saveCountLine = vi.fn(async () => WITH_LINE)
    mountFull({ getOpenStockCount: vi.fn(async () => WITH_LINE), saveCountLine })
    await waitFor(() => expect(screen.getByTestId('count-counted-RM-TEA-01')).toBeTruthy())

    const recount = screen.getByTestId('count-recount-RM-TEA-01')
    expect(recount.textContent).toBe('แก้ตัวเลข')
    expect(recount.getAttribute('title')).toContain('ยอดบัญชี') // the tooltip says the book figure stays frozen

    fireEvent.click(recount)
    await waitFor(() => expect(screen.getByTestId('count-units-RM-TEA-01')).toBeTruthy())
    fireEvent.change(screen.getByTestId('count-units-RM-TEA-01'), { target: { value: '2' } })
    act(() => screen.getByTestId('count-save-RM-TEA-01').click())

    await waitFor(() => expect(saveCountLine).toHaveBeenCalledWith({ actorUserId: 'u1', countId: 'c1', itemId: 'i-RM-TEA-01', purchaseUnitId: null, countedUnitsMilli: 800_000 }))
  })

  it('"ไม่นับรายการนี้" removes the draft line and returns the row to an unsaved, editable state — the real recount path', async () => {
    const removeCountLine = vi.fn(async () => OPEN)
    mountFull({ getOpenStockCount: vi.fn(async () => WITH_LINE), removeCountLine })
    await waitFor(() => expect(screen.getByTestId('count-remove-RM-TEA-01')).toBeTruthy())
    expect(screen.getByTestId('count-remove-RM-TEA-01').getAttribute('title')).toContain('ยอดบัญชี')

    act(() => screen.getByTestId('count-remove-RM-TEA-01').click())

    await waitFor(() => expect(removeCountLine).toHaveBeenCalledWith({ actorUserId: 'u1', countId: 'c1', itemId: 'i-RM-TEA-01' }))
    await waitFor(() => expect(screen.getByTestId('count-units-RM-TEA-01')).toBeTruthy()) // back to a blank, blind form
    expect(screen.queryByTestId('count-counted-RM-TEA-01')).toBeNull()
    expect(screen.queryByTestId('count-variance-RM-TEA-01')).toBeNull()
  })
})

describe('CountScreen — save and close are disabled while a request is pending, so a double tap cannot double-submit', () => {
  it('a second click on count-save while a line save is in flight never calls saveCountLine twice, and count-close is disabled too', async () => {
    let resolveSave!: (c: StockCountDto) => void
    const savePromise = new Promise<StockCountDto>((resolve) => (resolveSave = resolve))
    const saveCountLine = vi.fn(() => savePromise)
    mountFull({ saveCountLine })
    await waitFor(() => expect(screen.getByTestId('count-units-RM-TEA-01')).toBeTruthy())
    fireEvent.change(screen.getByTestId('count-units-RM-TEA-01'), { target: { value: '1' } })

    fireEvent.click(screen.getByTestId('count-save-RM-TEA-01'))
    await waitFor(() => expect((screen.getByTestId('count-save-RM-TEA-01') as HTMLButtonElement).disabled).toBe(true))
    expect((screen.getByTestId('count-close') as HTMLButtonElement).disabled).toBe(true) // shared busy flag guards close too
    expect(saveCountLine).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('count-save-RM-TEA-01')) // a click on a disabled button never resubmits
    expect(saveCountLine).toHaveBeenCalledTimes(1)

    resolveSave(WITH_LINE)
    await waitFor(() => expect(screen.getByTestId('count-counted-RM-TEA-01')).toBeTruthy())
    expect(saveCountLine).toHaveBeenCalledTimes(1)
  })

  it('a second click on count-close-confirm while closing is in flight never calls closeStockCount twice', async () => {
    let resolveClose!: (c: StockCountDto) => void
    const closePromise = new Promise<StockCountDto>((resolve) => (resolveClose = resolve))
    const closeStockCount = vi.fn(() => closePromise)
    mountFull({ getOpenStockCount: vi.fn(async () => WITH_LINE), closeStockCount })
    await waitFor(() => expect(screen.getByTestId('count-close')).toBeTruthy())

    fireEvent.click(screen.getByTestId('count-close'))
    fireEvent.click(screen.getByTestId('count-close-confirm'))
    await waitFor(() => expect((screen.getByTestId('count-close-confirm') as HTMLButtonElement).disabled).toBe(true))
    expect(closeStockCount).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('count-close-confirm')) // a click on a disabled button never resubmits
    expect(closeStockCount).toHaveBeenCalledTimes(1)

    resolveClose({ ...WITH_LINE, status: 'closed', closedAt: '2026-09-17T04:00:00.000Z' })
    await waitFor(() => expect(screen.getByTestId('count-closed')).toBeTruthy())
    expect(closeStockCount).toHaveBeenCalledTimes(1)
  })
})
