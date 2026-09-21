// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PosError } from '../api/errors'
import { MAX_UNITS_MILLI } from '../api/stock-common'
import type { PosApi, StockCountDto, StockItemDto, StockOverviewDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { SessionProvider, useSession } from '../app/session'
import { formatQty } from '../ui/format'
import { TH } from '../ui/th'
import { CountScreen, countedUseMilli, splitCountedUseMilli } from './CountScreen'

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
// countedUseMilli 600_000 = 1 ถุง (400_000) + 200 g rest — book on-hand is 800_000 (different from the counted value
// on purpose, so a leak of one is never confused with the other in the assertions below).
const WITH_LINE: StockCountDto = {
  ...OPEN,
  lines: [{ itemId: 'i-RM-TEA-01', code: 'RM-TEA-01', name: 'RM-TEA-01', useUnit: 'g', purchaseUnitId: 'u-RM-TEA-01', unitName: 'ถุง', countedUnitsMilli: 1_500, countedUseMilli: 600_000, expectedUseMilli: 800_000, varianceUseMilli: -200_000, varianceSatang: -3_850, opening: false }],
  totalVarianceSatang: -3_850,
}
// RM-POW-01 (not in the key set) already has a saved line — review m-4.
const WITH_NONKEY_LINE: StockCountDto = {
  ...OPEN,
  lines: [{ itemId: 'i-RM-POW-01', code: 'RM-POW-01', name: 'RM-POW-01', useUnit: 'g', purchaseUnitId: 'u-RM-POW-01', unitName: 'ถุง', countedUnitsMilli: 1_000, countedUseMilli: 400_000, expectedUseMilli: 400_000, varianceUseMilli: 0, varianceSatang: 0, opening: false }],
  totalVarianceSatang: 0,
}
// A base (prepared item): no purchase units, only the rest field is ever shown.
const BASE_ITEM: StockItemDto = {
  itemId: 'i-PB-TEA', code: 'PB-TEA', name: 'PB-TEA', kind: 'prepared', category: 'x', useUnit: 'ml', onHandMilli: 500_000, avgCostUsat: 0, priceCheckUsat: 0, valueSatang: 0,
  reorderPointMilli: 0, status: 'ok', alert: false, isKeyCount: true, units: [], shelfLifeHours: 72, latestBatch: null, bom: null, isActive: true,
}
const BASE_OVERVIEW: StockOverviewDto = { ...OVERVIEW, items: [BASE_ITEM] }

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
 * Review I-1 (fix round 1): the book figure (800 g on-hand / expected) must never reach the screen before a line is
 * saved — not as visible text, not in ANY attribute (title, aria-*, alt, placeholder, data-*, …), and not sitting
 * unsaved in an input's `value`. Scans every attribute name of every element, plus every input's live value, not a
 * fixed short-list of attributes (the round-1 version missed `placeholder`, `data-*` and `value`).
 */
function leaksFigure(value: string): boolean {
  if (document.body.textContent?.includes(value) === true) return true
  return Array.from(document.body.querySelectorAll('*')).some((el) => {
    for (const name of el.getAttributeNames()) {
      if ((el.getAttribute(name) ?? '').includes(value)) return true
    }
    return el instanceof HTMLInputElement && el.value.includes(value)
  })
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

describe('splitCountedUseMilli (review I-2): the inverse of countedUseMilli, floor/mod, for a safe "แก้ตัวเลข" pre-fill', () => {
  it('splits into whole purchase units + the loose rest; a base (no unit) puts everything in the rest', () => {
    expect(splitCountedUseMilli(1_320_000, 400_000)).toEqual({ unitsText: '3', restText: '120' })
    expect(splitCountedUseMilli(200_000, 400_000)).toEqual({ unitsText: '0', restText: '200' }) // less than one whole unit
    expect(splitCountedUseMilli(0, 400_000)).toEqual({ unitsText: '0', restText: '0' })
    expect(splitCountedUseMilli(16_600, null)).toEqual({ unitsText: '', restText: '16.6' })
  })
})

describe('CountScreen — blind count leaves no trace of the book figure anywhere in the DOM, including inputs, placeholders and data-* (review I-1)', () => {
  it('never renders the on-hand/book figure in text or in any attribute before saving', async () => {
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

  it('opening "แก้ตัวเลข" pre-fills from the counted value only (1 ถุง + 200 g) — the book figure (800) never appears', async () => {
    mountFull({ getOpenStockCount: vi.fn(async () => WITH_LINE) })
    await waitFor(() => expect(screen.getByTestId('count-recount-RM-TEA-01')).toBeTruthy())
    fireEvent.click(screen.getByTestId('count-recount-RM-TEA-01'))
    await waitFor(() => expect(screen.getByTestId('count-units-RM-TEA-01')).toBeTruthy())
    expect((screen.getByTestId('count-units-RM-TEA-01') as HTMLInputElement).value).toBe('1')
    expect((screen.getByTestId('count-rest-RM-TEA-01') as HTMLInputElement).value).toBe('200')
    expect(leaksFigure('800')).toBe(false)
  })
})

describe('CountScreen — "แก้ตัวเลข" reopens pre-filled with the saved value, "ยกเลิก" backs out untouched, and "ไม่นับรายการนี้" is the real recount path (review I-2 · m-2, Task 7 · 12)', () => {
  it('is labelled and titled as a typo fix, reopens pre-filled, and saving the edit only calls saveCountLine — never removeCountLine', async () => {
    const saveCountLine = vi.fn(async () => WITH_LINE)
    const removeCountLine = vi.fn(async () => OPEN)
    mountFull({ getOpenStockCount: vi.fn(async () => WITH_LINE), saveCountLine, removeCountLine })
    await waitFor(() => expect(screen.getByTestId('count-counted-RM-TEA-01')).toBeTruthy())

    const recount = screen.getByTestId('count-recount-RM-TEA-01')
    expect(recount.textContent).toBe('แก้ตัวเลข')
    expect(recount.getAttribute('title')).toContain('ยอดบัญชี') // the tooltip says the book figure stays frozen

    fireEvent.click(recount)
    await waitFor(() => expect(screen.getByTestId('count-units-RM-TEA-01')).toBeTruthy())
    fireEvent.change(screen.getByTestId('count-units-RM-TEA-01'), { target: { value: '2' } }) // 200 g rest stays pre-filled
    act(() => screen.getByTestId('count-save-RM-TEA-01').click())

    await waitFor(() => expect(saveCountLine).toHaveBeenCalledWith({ actorUserId: 'u1', countId: 'c1', itemId: 'i-RM-TEA-01', purchaseUnitId: null, countedUnitsMilli: 1_000_000 }))
    expect(removeCountLine).not.toHaveBeenCalled()
  })

  it('an accidental tap on "แก้ตัวเลข" immediately followed by "บันทึก" resaves the same counted value, not 0 (review I-2 accidental-tap scenario)', async () => {
    const saveCountLine = vi.fn(async () => WITH_LINE)
    mountFull({ getOpenStockCount: vi.fn(async () => WITH_LINE), saveCountLine })
    await waitFor(() => expect(screen.getByTestId('count-recount-RM-TEA-01')).toBeTruthy())

    fireEvent.click(screen.getByTestId('count-recount-RM-TEA-01'))
    await waitFor(() => expect(screen.getByTestId('count-save-RM-TEA-01')).toBeTruthy())
    act(() => screen.getByTestId('count-save-RM-TEA-01').click()) // no edit at all — just recount then save

    await waitFor(() => expect(saveCountLine).toHaveBeenCalledWith({ actorUserId: 'u1', countId: 'c1', itemId: 'i-RM-TEA-01', purchaseUnitId: null, countedUnitsMilli: 600_000 }))
  })

  it('"ยกเลิก" backs out of "แก้ตัวเลข" without saving or removing — the saved line is untouched, and reopening shows the original value', async () => {
    const saveCountLine = vi.fn(async () => WITH_LINE)
    const removeCountLine = vi.fn(async () => OPEN)
    mountFull({ getOpenStockCount: vi.fn(async () => WITH_LINE), saveCountLine, removeCountLine })
    await waitFor(() => expect(screen.getByTestId('count-recount-RM-TEA-01')).toBeTruthy())

    fireEvent.click(screen.getByTestId('count-recount-RM-TEA-01'))
    await waitFor(() => expect(screen.getByTestId('count-cancel-RM-TEA-01')).toBeTruthy())
    fireEvent.change(screen.getByTestId('count-units-RM-TEA-01'), { target: { value: '9' } }) // typed, then thinks better of it
    fireEvent.click(screen.getByTestId('count-cancel-RM-TEA-01'))

    await waitFor(() => expect(screen.getByTestId('count-counted-RM-TEA-01')).toBeTruthy())
    expect(screen.getByTestId('count-counted-RM-TEA-01').textContent).toContain('600')
    expect(saveCountLine).not.toHaveBeenCalled()
    expect(removeCountLine).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('count-recount-RM-TEA-01')) // reopening still shows the ORIGINAL saved split
    await waitFor(() => expect((screen.getByTestId('count-units-RM-TEA-01') as HTMLInputElement).value).toBe('1'))
    expect((screen.getByTestId('count-rest-RM-TEA-01') as HTMLInputElement).value).toBe('200')
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

describe('CountScreen — a blank count is refused; an explicit 0 is accepted (review I-2 controller ruling)', () => {
  it('refuses to save with both fields blank, and never calls the API', async () => {
    const api = mount()
    await waitFor(() => expect(screen.getByTestId('count-save-RM-TEA-01')).toBeTruthy())
    act(() => screen.getByTestId('count-save-RM-TEA-01').click())
    expect(screen.getByRole('alert').textContent).toBe(TH.errCountBlank)
    expect(api.saveCountLine).not.toHaveBeenCalled()
  })

  it('accepts an explicit 0 in the rest field with units left blank', async () => {
    const api = mountFull()
    await waitFor(() => expect(screen.getByTestId('count-rest-RM-TEA-01')).toBeTruthy())
    fireEvent.change(screen.getByTestId('count-rest-RM-TEA-01'), { target: { value: '0' } })
    act(() => screen.getByTestId('count-save-RM-TEA-01').click())
    await waitFor(() => expect(api.saveCountLine).toHaveBeenCalledWith({ actorUserId: 'u1', countId: 'c1', itemId: 'i-RM-TEA-01', purchaseUnitId: null, countedUnitsMilli: 0 }))
  })

  it('a base item (no purchase unit) is also refused blank, but accepts an explicit 0', async () => {
    const saveCountLine = vi.fn(async () => OPEN)
    mountFull({ stockOverview: vi.fn(async () => BASE_OVERVIEW), saveCountLine })
    await waitFor(() => expect(screen.getByTestId('count-rest-PB-TEA')).toBeTruthy())
    expect(screen.queryByTestId('count-units-PB-TEA')).toBeNull() // no purchase unit for a base

    act(() => screen.getByTestId('count-save-PB-TEA').click())
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(saveCountLine).not.toHaveBeenCalled()

    fireEvent.change(screen.getByTestId('count-rest-PB-TEA'), { target: { value: '0' } })
    act(() => screen.getByTestId('count-save-PB-TEA').click())
    await waitFor(() => expect(saveCountLine).toHaveBeenCalledWith({ actorUserId: 'u1', countId: 'c1', itemId: 'i-PB-TEA', purchaseUnitId: null, countedUnitsMilli: 0 }))
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

  it('review m-7 (M3): a pending remove keeps save and close disabled too, until it resolves', async () => {
    let resolveRemove!: (c: StockCountDto) => void
    const removePromise = new Promise<StockCountDto>((resolve) => (resolveRemove = resolve))
    const removeCountLine = vi.fn(() => removePromise)
    mountFull({ getOpenStockCount: vi.fn(async () => WITH_LINE), removeCountLine })
    await waitFor(() => expect(screen.getByTestId('count-remove-RM-TEA-01')).toBeTruthy())

    fireEvent.click(screen.getByTestId('count-remove-RM-TEA-01'))
    await waitFor(() => expect((screen.getByTestId('count-remove-RM-TEA-01') as HTMLButtonElement).disabled).toBe(true))
    expect((screen.getByTestId('count-close') as HTMLButtonElement).disabled).toBe(true)
    expect(removeCountLine).toHaveBeenCalledTimes(1)

    resolveRemove(OPEN)
    await waitFor(() => expect(screen.getByTestId('count-units-RM-TEA-01')).toBeTruthy())
    expect((screen.getByTestId('count-close') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('CountScreen — a failed save keeps what was typed and the edit open; a later success clears the banner (review m-1 · I-3)', () => {
  it('keeps the typed units/rest and stays in edit mode after a refusal, then retrying with the same numbers succeeds and clears the banner', async () => {
    const saveCountLine = vi.fn().mockRejectedValueOnce(new PosError('STOCK_COUNT_NOT_OPEN', 'c1')).mockResolvedValueOnce(WITH_LINE)
    mountFull({ saveCountLine })
    await waitFor(() => expect(screen.getByTestId('count-units-RM-TEA-01')).toBeTruthy())
    fireEvent.change(screen.getByTestId('count-units-RM-TEA-01'), { target: { value: '2' } })
    fireEvent.change(screen.getByTestId('count-rest-RM-TEA-01'), { target: { value: '50' } })

    act(() => screen.getByTestId('count-save-RM-TEA-01').click())
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    // m-1: the refusal did not wipe the inputs or leave edit mode
    expect((screen.getByTestId('count-units-RM-TEA-01') as HTMLInputElement).value).toBe('2')
    expect((screen.getByTestId('count-rest-RM-TEA-01') as HTMLInputElement).value).toBe('50')
    expect(saveCountLine).toHaveBeenCalledTimes(1)

    act(() => screen.getByTestId('count-save-RM-TEA-01').click()) // retry with the same, still-present numbers
    await waitFor(() => expect(screen.getByTestId('count-counted-RM-TEA-01')).toBeTruthy())
    expect(saveCountLine).toHaveBeenCalledTimes(2)
    // I-3: the earlier banner does not linger next to a screen that just succeeded
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('CountScreen — the close confirm resets after a refusal (review m-2)', () => {
  it('OPENING_COUNT_INCOMPLETE un-arms count-close-confirm; a fresh tap on count-close is needed to retry', async () => {
    const closeStockCount = vi.fn(async () => {
      throw new PosError('OPENING_COUNT_INCOMPLETE', 'RM-POW-01')
    })
    mountFull({ getOpenStockCount: vi.fn(async () => WITH_LINE), closeStockCount })
    await waitFor(() => expect(screen.getByTestId('count-close')).toBeTruthy())

    fireEvent.click(screen.getByTestId('count-close'))
    fireEvent.click(screen.getByTestId('count-close-confirm'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())

    expect(screen.queryByTestId('count-close-confirm')).toBeNull() // confirming reset — cannot fire again by itself
    expect(screen.getByTestId('count-close')).toBeTruthy()
  })
})

describe('CountScreen — OPENING_COUNT_INCOMPLETE shows the missing item codes (review m-3)', () => {
  it('shows the codes from the server detail, not just the fixed Thai text', async () => {
    const closeStockCount = vi.fn(async () => {
      throw new PosError('OPENING_COUNT_INCOMPLETE', 'RM-POW-01,RM-MLK-01')
    })
    mountFull({ getOpenStockCount: vi.fn(async () => WITH_LINE), closeStockCount })
    await waitFor(() => expect(screen.getByTestId('count-close')).toBeTruthy())

    fireEvent.click(screen.getByTestId('count-close'))
    fireEvent.click(screen.getByTestId('count-close-confirm'))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('RM-POW-01'))
    expect(screen.getByRole('alert').textContent).toContain('RM-MLK-01')
  })
})

describe('CountScreen — resuming a count shows a saved line outside the key set (review m-4)', () => {
  it('a saved non-key line stays visible on resume, even though scope defaults to "ชุดหลัก"', async () => {
    mountFull({ getOpenStockCount: vi.fn(async () => WITH_NONKEY_LINE) })
    await waitFor(() => expect(screen.getByTestId('count-row-RM-TEA-01')).toBeTruthy()) // key item, always shown
    expect(screen.getByTestId('count-row-RM-POW-01')).toBeTruthy() // not key, but has a saved line
    expect(screen.getByTestId('count-counted-RM-POW-01')).toBeTruthy()
    expect(screen.getByTestId('count-scope-key').getAttribute('aria-pressed')).toBe('true') // scope itself still defaults to key
  })
})

describe('CountScreen — starting and closing a count invalidate stockKey (review m-5 · m-7 M4)', () => {
  it('starting a count invalidates stockKey', async () => {
    const stockOverview = vi.fn(async () => OVERVIEW)
    mountFull({ stockOverview, getOpenStockCount: vi.fn(async () => null), startStockCount: vi.fn(async () => OPEN) })
    await waitFor(() => expect(screen.getByTestId('count-start')).toBeTruthy())
    expect(stockOverview).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('count-start'))
    await waitFor(() => expect(screen.getByTestId('count-close')).toBeTruthy())
    await waitFor(() => expect(stockOverview).toHaveBeenCalledTimes(2)) // refetched after invalidateQueries(stockKey)
  })

  it('closing a count invalidates stockKey', async () => {
    const stockOverview = vi.fn(async () => OVERVIEW)
    const closeStockCount = vi.fn(async () => ({ ...WITH_LINE, status: 'closed' as const, closedAt: '2026-09-17T04:00:00.000Z' }))
    mountFull({ stockOverview, getOpenStockCount: vi.fn(async () => WITH_LINE), closeStockCount })
    await waitFor(() => expect(screen.getByTestId('count-close')).toBeTruthy())
    expect(stockOverview).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('count-close'))
    fireEvent.click(screen.getByTestId('count-close-confirm'))
    await waitFor(() => expect(screen.getByTestId('count-closed')).toBeTruthy())
    await waitFor(() => expect(stockOverview).toHaveBeenCalledTimes(2))
  })
})

describe('CountScreen — an oversized count is refused client-side, matching MAX_UNITS_MILLI (review m-6)', () => {
  it('refuses a count above MAX_UNITS_MILLI with a Thai message, and keeps the API uncalled', async () => {
    const api = mountFull()
    await waitFor(() => expect(screen.getByTestId('count-units-RM-TEA-01')).toBeTruthy())
    fireEvent.change(screen.getByTestId('count-units-RM-TEA-01'), { target: { value: '99999' } }) // 99,999 × 400 g ≫ MAX_UNITS_MILLI
    act(() => screen.getByTestId('count-save-RM-TEA-01').click())
    expect(screen.getByRole('alert').textContent).toContain(formatQty(MAX_UNITS_MILLI, 'g'))
    expect(api.saveCountLine).not.toHaveBeenCalled()
  })
})

describe('CountScreen — the closed summary clears once the next count starts (review m-8)', () => {
  it('clears "ปิดใบนับแล้ว" after "เริ่มนับ" starts the next count', async () => {
    const closeStockCount = vi.fn(async () => ({ ...WITH_LINE, status: 'closed' as const, closedAt: '2026-09-17T04:00:00.000Z' }))
    mountFull({ getOpenStockCount: vi.fn(async () => WITH_LINE), closeStockCount, startStockCount: vi.fn(async () => OPEN) })
    await waitFor(() => expect(screen.getByTestId('count-close')).toBeTruthy())

    fireEvent.click(screen.getByTestId('count-close'))
    fireEvent.click(screen.getByTestId('count-close-confirm'))
    await waitFor(() => expect(screen.getByTestId('count-closed')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('count-start')).toBeTruthy())

    fireEvent.click(screen.getByTestId('count-start'))
    await waitFor(() => expect(screen.queryByTestId('count-closed')).toBeNull())
  })
})
