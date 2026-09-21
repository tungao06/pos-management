// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PosApi, StockAdjustmentDto, StockItemDto, StockOverviewDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { SessionProvider, useSession } from '../app/session'
import { TH } from '../ui/th'
import { expiryText, StockScreen } from './StockScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }
// Mirrors StockScreen's own formatter (th-TH, Asia/Bangkok, medium date + short time) — used only to build expected
// strings here, never imported from the screen, so the test still pins the real wiring.
const DATE_TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })

function item(overrides: Partial<StockItemDto> & Pick<StockItemDto, 'itemId' | 'code' | 'name' | 'kind'>): StockItemDto {
  return {
    category: 'วัตถุดิบ',
    useUnit: 'g',
    onHandMilli: 0,
    avgCostUsat: 0,
    priceCheckUsat: 0,
    valueSatang: 0,
    reorderPointMilli: 0,
    status: 'ok',
    alert: false,
    isKeyCount: false,
    units: [],
    shelfLifeHours: null,
    latestBatch: null,
    bom: null,
    ...overrides,
  }
}

const RAW_OK = item({ itemId: 'i-ice', code: 'RW-ICE', name: 'น้ำแข็ง', kind: 'raw', status: 'ok', alert: false, onHandMilli: 5_000_000 })
const RAW_LOW = item({ itemId: 'i-milk', code: 'RW-MILK', name: 'นมสด', kind: 'raw', status: 'low', alert: true, onHandMilli: 500, reorderPointMilli: 2_000 })
// Task 3's stockCountableItems fix: an inactive catalog item with stock left still comes back from stockOverview.
// StockItemDto carries no isActive field at all, so the screen has nothing to filter on — this stands in for one
// and pins that it is rendered like any other row, not silently dropped.
const RAW_INACTIVE = item({ itemId: 'i-old', code: 'RW-OLD', name: 'วัตถุดิบเลิกขาย', kind: 'raw', status: 'negative', alert: true, onHandMilli: 250 })
const BASE_EXPIRED = item({
  itemId: 'i-expired',
  code: 'PB-EXPIRED',
  name: 'เบสหมดอายุ',
  kind: 'prepared',
  status: 'ok',
  alert: true,
  onHandMilli: 100_000,
  latestBatch: { batchId: 'b1', createdAt: '2026-09-17T03:00:00.000Z', expiresAt: '2026-09-17T07:00:00.000Z', expiry: 'expired' },
})
const BASE_SOON = item({
  itemId: 'i-soon',
  code: 'PB-SOON',
  name: 'เบสใกล้หมดอายุ',
  kind: 'prepared',
  status: 'ok',
  alert: false,
  onHandMilli: 80_000,
  latestBatch: { batchId: 'b2', createdAt: '2026-09-17T09:00:00.000Z', expiresAt: '2026-09-17T10:30:00.000Z', expiry: 'soon' }, // <= 60 min out
})
const BASE_FRESH = item({
  itemId: 'i-fresh',
  code: 'PB-FRESH',
  name: 'เบสสด',
  kind: 'prepared',
  status: 'ok',
  alert: false,
  onHandMilli: 90_000,
  latestBatch: { batchId: 'b3', createdAt: '2026-09-17T09:50:00.000Z', expiresAt: '2026-09-17T15:00:00.000Z', expiry: 'fresh' },
})
// review Minor finding: alert (negative on-hand) but a base — pinned below as excluded from "ต้องสั่งซื้อ"
// (bases are made, not ordered; the "เบส" filter is where a negative base is meant to be noticed).
const BASE_NEG = item({ itemId: 'i-neg', code: 'PB-NEG', name: 'เบสติดลบ', kind: 'prepared', status: 'negative', alert: true, onHandMilli: -50_000 })

const STOCK: StockOverviewDto = {
  generatedAt: '2026-09-17T10:00:00.000Z',
  businessDate: '2026-09-17',
  items: [RAW_OK, RAW_LOW, RAW_INACTIVE, BASE_EXPIRED, BASE_SOON, BASE_FRESH, BASE_NEG],
  totalValueSatang: 0,
  alertCount: 3,
  expiredBaseCodes: ['PB-EXPIRED'],
  lastCountAt: '2026-09-16T08:00:00.000Z',
  countDue: true,
  openCountId: null,
  openingCountPending: false,
}

const ADJUSTMENT: StockAdjustmentDto = { id: 'adj1', businessDate: '2026-09-17', reasonCode: 'EXPIRED', reason: '', movements: [], createdAt: '2026-09-17T10:05:00.000Z' }

function SignedIn({ children }: { children: JSX.Element }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return children
}

function mount(overrides: Partial<PosApi> = {}): { api: PosApi } {
  const api = {
    stockOverview: vi.fn(async () => STOCK),
    discardBase: vi.fn(async () => ADJUSTMENT),
    ...overrides,
  } as unknown as PosApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <SignedIn>
            <StockScreen />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { api }
}

describe('StockScreen — filter views (Task 8 fix round 1: the review found zero coverage here)', () => {
  it('"ทั้งหมด" (default) lists every item, active and inactive alike', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId(`stock-row-${RAW_OK.code}`)).toBeTruthy())
    for (const i of STOCK.items) expect(screen.getByTestId(`stock-row-${i.code}`)).toBeTruthy()
  })

  it('"ต้องสั่งซื้อ" shows only raw items with an alert — bases never appear here (review Minor finding, pinned)', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId('stock-filter-reorder')).toBeTruthy())
    fireEvent.click(screen.getByTestId('stock-filter-reorder'))

    expect(screen.getByTestId(`stock-row-${RAW_LOW.code}`)).toBeTruthy()
    expect(screen.getByTestId(`stock-row-${RAW_INACTIVE.code}`)).toBeTruthy() // raw, alert — still counts
    expect(screen.queryByTestId(`stock-row-${RAW_OK.code}`)).toBeNull() // raw, no alert
    expect(screen.queryByTestId(`stock-row-${BASE_EXPIRED.code}`)).toBeNull() // base, alert — excluded on purpose
    expect(screen.queryByTestId(`stock-row-${BASE_NEG.code}`)).toBeNull() // base, alert — excluded on purpose
  })

  it('"เบส" shows every prepared item regardless of alert', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId('stock-filter-bases')).toBeTruthy())
    fireEvent.click(screen.getByTestId('stock-filter-bases'))

    for (const b of [BASE_EXPIRED, BASE_SOON, BASE_FRESH, BASE_NEG]) expect(screen.getByTestId(`stock-row-${b.code}`)).toBeTruthy()
    expect(screen.queryByTestId(`stock-row-${RAW_OK.code}`)).toBeNull()
    expect(screen.queryByTestId(`stock-row-${RAW_LOW.code}`)).toBeNull()
  })
})

describe('StockScreen — an inactive catalog item with stock left is shown and marked', () => {
  it('renders with the same data-status/data-alert marks and on-hand figure as any other row', async () => {
    mount()
    const row = await screen.findByTestId(`stock-row-${RAW_INACTIVE.code}`)
    expect(row.getAttribute('data-status')).toBe(RAW_INACTIVE.status)
    expect(row.getAttribute('data-alert')).toBe(String(RAW_INACTIVE.alert))
    expect(screen.getByTestId(`stock-status-${RAW_INACTIVE.code}`).textContent).toBe(TH.stockStatus.negative)
    expect(screen.getByTestId(`stock-onhand-${RAW_INACTIVE.code}`).textContent).toContain('0.25 g')
  })
})

describe('StockScreen — expiryText (expired / soon (≤ 60 min) / fresh)', () => {
  it('maps each expiry state to its Thai label plus the formatted date', () => {
    expect(expiryText(BASE_EXPIRED)).toBe(TH.stockExpiresAt(TH.stockExpiry.expired, DATE_TIME.format(new Date('2026-09-17T07:00:00.000Z'))))
    expect(expiryText(BASE_SOON)).toBe(TH.stockExpiresAt(TH.stockExpiry.soon, DATE_TIME.format(new Date('2026-09-17T10:30:00.000Z'))))
    expect(expiryText(BASE_FRESH)).toBe(TH.stockExpiresAt(TH.stockExpiry.fresh, DATE_TIME.format(new Date('2026-09-17T15:00:00.000Z'))))
  })

  it('is null for an item with no batch at all (a raw item)', () => {
    expect(expiryText(RAW_OK)).toBeNull()
  })

  it('wires the same text into the rendered row', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId(`stock-expiry-${BASE_EXPIRED.code}`)).toBeTruthy())
    expect(screen.getByTestId(`stock-expiry-${BASE_EXPIRED.code}`).textContent).toBe(expiryText(BASE_EXPIRED))
    expect(screen.getByTestId(`stock-expiry-${BASE_SOON.code}`).textContent).toBe(expiryText(BASE_SOON))
    expect(screen.getByTestId(`stock-expiry-${BASE_FRESH.code}`).textContent).toBe(expiryText(BASE_FRESH))
  })
})

describe('StockScreen — discard-base flow (spec §4.6): opening does not discard, only the confirm step does', () => {
  it('opening the dialog does not call the API; confirming discards the exact base that was clicked, not another one', async () => {
    const { api } = mount()
    await waitFor(() => expect(screen.getByTestId(`base-discard-${BASE_FRESH.code}`)).toBeTruthy())

    fireEvent.click(screen.getByTestId(`base-discard-${BASE_FRESH.code}`))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(TH.discardTitle(BASE_FRESH.name))
    expect(api.discardBase).not.toHaveBeenCalled() // opening the confirm dialog must not itself discard anything

    fireEvent.click(screen.getByTestId('base-discard-confirm'))
    await waitFor(() => expect(api.discardBase).toHaveBeenCalledTimes(1))
    expect(api.discardBase).toHaveBeenCalledWith({ actorUserId: OWNER.id, itemId: BASE_FRESH.itemId }) // not BASE_EXPIRED's id
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()) // dialog closes on success
  })

  it('cancelling the dialog never calls the API', async () => {
    const { api } = mount()
    await waitFor(() => expect(screen.getByTestId(`base-discard-${BASE_EXPIRED.code}`)).toBeTruthy())

    fireEvent.click(screen.getByTestId(`base-discard-${BASE_EXPIRED.code}`))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByText(TH.cancel))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.discardBase).not.toHaveBeenCalled()
  })

  it('a base with no stock left has no "ทิ้ง" button at all', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId(`stock-row-${BASE_NEG.code}`)).toBeTruthy())
    expect(screen.queryByTestId(`base-discard-${BASE_NEG.code}`)).toBeNull() // onHandMilli < 0 — nothing to discard
  })
})

describe('StockScreen — count-reminder banner (Q4-12)', () => {
  it('shows the due banner when a weekly count is overdue', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId('stock-count-due')).toBeTruthy())
    expect(screen.getByTestId('stock-count-due').textContent).toBe(TH.stockCountDue)
  })

  it('hides the banner when no count is due', async () => {
    mount({ stockOverview: vi.fn(async () => ({ ...STOCK, countDue: false })) })
    await waitFor(() => expect(screen.getByTestId('stock-total-value')).toBeTruthy())
    expect(screen.queryByTestId('stock-count-due')).toBeNull()
  })
})
