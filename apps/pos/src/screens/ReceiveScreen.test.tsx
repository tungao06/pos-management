// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PosError } from '../api/errors'
import { MAX_LINE_SATANG, MAX_STOCK_LINES } from '../api/stock-common'
import type { BootstrapState, PosApi, PurchaseDto, ShiftReportDto, StockItemDto, StockOverviewDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { bootstrapKey } from '../app/queries'
import { SessionProvider, useSession } from '../app/session'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'
import { ReceiveScreen } from './ReceiveScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }

function item(overrides: Partial<StockItemDto> & Pick<StockItemDto, 'itemId' | 'code' | 'name'>): StockItemDto {
  return {
    kind: 'raw',
    isActive: true,
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

// purchaseUnitId is null throughout this suite (no purchase units defined), so 1 typed unit = 1 g exactly and
// cost (usat/g) = satang typed × 1,000,000 — chosen so the jump/no-jump arithmetic is easy to read at a glance.
const ITEM_A = item({ itemId: 'i-a', code: 'RM-A', name: 'ชาเอ', priceCheckUsat: 10_000_000 }) // ref ฿0.10/g
const ITEM_B = item({ itemId: 'i-b', code: 'RM-B', name: 'ชาบี', priceCheckUsat: 10_000_000 })
// I-3 mutant M3 / controller ruling I-2: an inactive raw item and a base (prepared) must both be absent from the
// receive-item picker — the first because it can only be counted or written off, the second because D29 never
// receives a prepared item (raw only).
const ITEM_INACTIVE = item({ itemId: 'i-old', code: 'RM-OLD', name: 'วัตถุดิบเลิกขาย', isActive: false })
const BASE_ITEM = item({ itemId: 'i-base', code: 'PB-BASE', name: 'เบส', kind: 'prepared' })

const STOCK: StockOverviewDto = {
  generatedAt: '2026-09-17T10:00:00.000Z',
  businessDate: '2026-09-17',
  items: [ITEM_A, ITEM_B, ITEM_INACTIVE, BASE_ITEM],
  totalValueSatang: 0,
  alertCount: 0,
  expiredBaseCodes: [],
  lastCountAt: null,
  countDue: false,
  openCountId: null,
  openingCountPending: false,
}

const DONE: PurchaseDto = { id: 'p1', businessDate: '2026-09-17', supplier: null, totalSatang: 12, lines: [], cashMovementId: null, createdAt: '2026-09-17T10:00:00Z' }

const OPEN_SHIFT = { id: 's1', businessDate: '2026-09-17', openedAt: '2026-09-17T00:00:00Z', openedBy: 'u1', openingFloatSatang: 5 }

// Q3b-14: an expected drawer cash of just 5 satang — small enough that even a single ฿0.10/g line (10 satang) is
// "over the drawer", so the over-drawer flow is trivial to reach without needing large quantities.
const REPORT: ShiftReportDto = {
  shift: { id: 's1', businessDate: '2026-09-17', openedAt: '2026-09-17T00:00:00Z', openedBy: 'u1', openingFloatSatang: 5, openedByName: 'TungAo', openedQuick: false },
  generatedAt: '2026-09-17T10:00:00Z',
  sales: { orderCount: 0, voidCount: 0, grossSalesSatang: 0, discountSatang: 0, voidedSatang: 0, netSalesSatang: 0, cashSalesSatang: 0, qrSalesSatang: 0, qrRefundedSatang: 0, qrNetSatang: 0 },
  cash: { openingFloatSatang: 5, cashSalesSatang: 0, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 },
  expectedCashSatang: 5,
  varianceAlertSatang: 2_000,
  cashMovements: [],
  voids: [],
  negativeBases: [],
  pendingSyncItems: 0,
  fingerprint: 'test-fingerprint',
}

function bootstrap(overrides: Partial<BootstrapState> = {}): BootstrapState {
  return { needsSetup: false, device: null, users: [], openShift: null, pendingSyncItems: 0, lastBackupAt: null, backupDue: false, ...overrides }
}

function SignedIn({ children }: { children: JSX.Element }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return children
}

function mount(overrides: Partial<PosApi> = {}, queryClient: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })): { api: PosApi; queryClient: QueryClient } {
  const api = {
    stockOverview: vi.fn(async () => STOCK),
    bootstrap: vi.fn(async () => bootstrap()),
    ...overrides,
  } as unknown as PosApi
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <SignedIn>
            <ReceiveScreen />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { api, queryClient }
}

/** Fills the add-line form for a jumping (฿0.12/g, +20% of the ฿0.10 reference) or clean (฿0.10/g) line and adds it. */
async function addLine(code: string, priceBahtPerGram: '0.10' | '0.12'): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('receive-item')).toBeTruthy())
  fireEvent.change(screen.getByTestId('receive-item'), { target: { value: code } })
  fireEvent.change(screen.getByTestId('receive-qty'), { target: { value: '1' } })
  fireEvent.change(screen.getByTestId('receive-total'), { target: { value: priceBahtPerGram } })
  fireEvent.click(screen.getByTestId('receive-add'))
}

/** Ticks "จ่ายด้วยเงินในลิ้นชัก" and waits for the drawer check (shiftReport) to settle, so receive-save's disabled
 * state reflects the real over-drawer comparison rather than `drawer.pending`. */
async function checkPaidFromDrawer(): Promise<void> {
  await waitFor(() => expect((screen.getByTestId('receive-paid-drawer') as HTMLInputElement).disabled).toBe(false))
  fireEvent.click(screen.getByTestId('receive-paid-drawer'))
  await waitFor(() => expect((screen.getByTestId('receive-paid-drawer') as HTMLInputElement).checked).toBe(true))
  // the drawer check (shiftReport) must settle before receive-save is clicked, or submit() sees drawer.pending and
  // silently returns without ever raising the over-drawer warning (review C-1/I-1, plan 3b) — receive-save's own
  // disabled expression already tracks this exact condition.
  await waitFor(() => expect((screen.getByTestId('receive-save') as HTMLButtonElement).disabled).toBe(false))
}

describe('ReceiveScreen — m-3 (Task 4 review, carried into Task 9): acceptPriceJump is a single flag for the whole receipt; any line edit after a confirm must reset it', () => {
  it('removing the jumping line clears the PRICE_JUMP confirm immediately, without a new save press', async () => {
    const receivePurchase = vi.fn(async (input: { acceptPriceJump: boolean }): Promise<PurchaseDto> => {
      if (!input.acceptPriceJump) throw new PosError('PRICE_JUMP', ITEM_A.code)
      return DONE
    })
    mount({ receivePurchase })
    await addLine(ITEM_A.code, '0.12') // +20% — a jump
    expect(screen.getByTestId('receive-jump-0')).toBeTruthy()

    fireEvent.click(screen.getByTestId('receive-save'))
    await waitFor(() => expect(screen.getByTestId('receive-confirm-price')).toBeTruthy())
    expect(screen.getByTestId('receive-price-jump')).toBeTruthy()
    expect(receivePurchase).toHaveBeenCalledTimes(1)
    expect(receivePurchase).toHaveBeenLastCalledWith(expect.objectContaining({ acceptPriceJump: false }))

    // the edit: the owner removes the line instead of confirming its price
    fireEvent.click(screen.getByTestId('receive-remove-0'))

    // mutation-proof: without the removeLine reset, both would still be on screen here (m-3 is exactly this line)
    expect(screen.queryByTestId('receive-confirm-price')).toBeNull()
    expect(screen.queryByTestId('receive-price-jump')).toBeNull()
  })

  it('a fresh line added after an edit is checked again — save never smuggles the old confirm past a new jump', async () => {
    const receivePurchase = vi.fn(async (input: { acceptPriceJump: boolean }): Promise<PurchaseDto> => {
      if (!input.acceptPriceJump) throw new PosError('PRICE_JUMP', ITEM_A.code)
      return DONE
    })
    mount({ receivePurchase })
    await addLine(ITEM_A.code, '0.12')
    fireEvent.click(screen.getByTestId('receive-save'))
    await waitFor(() => expect(screen.getByTestId('receive-confirm-price')).toBeTruthy())

    fireEvent.click(screen.getByTestId('receive-remove-0'))
    await addLine(ITEM_B.code, '0.12') // a different jumping line, added after the edit

    // the confirm button must not reappear on its own — only a fresh save press (and a fresh server refusal) can
    // bring it back, so the owner is shown the new line's own PRICE_JUMP before any acceptPriceJump:true is sent
    expect(screen.queryByTestId('receive-confirm-price')).toBeNull()
    fireEvent.click(screen.getByTestId('receive-save'))
    await waitFor(() => expect(receivePurchase).toHaveBeenCalledTimes(2))
    expect(receivePurchase).toHaveBeenLastCalledWith(expect.objectContaining({ acceptPriceJump: false, lines: [expect.objectContaining({ itemId: ITEM_B.itemId })] }))
  })
})

describe('ReceiveScreen — m-7 (Task 4 review, carried into Task 9): receive-save is disabled while the mutation is pending, so a double tap cannot record two purchases', () => {
  it('a second click while the first save is still in flight never calls receivePurchase twice', async () => {
    let resolveSave!: (p: PurchaseDto) => void
    const savePromise = new Promise<PurchaseDto>((resolve) => (resolveSave = resolve))
    const receivePurchase = vi.fn(() => savePromise)
    mount({ receivePurchase })
    await addLine(ITEM_A.code, '0.10') // no jump — a clean line

    fireEvent.click(screen.getByTestId('receive-save'))
    await waitFor(() => expect((screen.getByTestId('receive-save') as HTMLButtonElement).disabled).toBe(true))
    expect(receivePurchase).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('receive-save')) // a click on a disabled button never reaches submit()
    expect(receivePurchase).toHaveBeenCalledTimes(1)

    resolveSave(DONE)
    await waitFor(() => expect(screen.getByTestId('receive-done')).toBeTruthy())
    expect(receivePurchase).toHaveBeenCalledTimes(1)
  })
})

describe('ReceiveScreen — I-1 (Task 9 fix round 1, money): a PRICE_JUMP refusal must clear overDrawer, so a second tap on the over-drawer confirm can never send acceptPriceJump: true', () => {
  it("reproduces the reviewer's probe: the over-drawer confirm hides itself the instant PRICE_JUMP comes back, and a jump is accepted only through ยืนยันราคานี้", async () => {
    // acceptPriceJump: false always refuses (this is the ฿850-typo'd line, still unconfirmed); true always succeeds
    const receivePurchase = vi.fn(async (input: { acceptPriceJump: boolean; paidFromDrawer: boolean }): Promise<PurchaseDto> => {
      if (!input.acceptPriceJump) throw new PosError('PRICE_JUMP', ITEM_A.code)
      return DONE
    })
    mount({ receivePurchase, shiftReport: vi.fn(async () => REPORT), bootstrap: vi.fn(async () => bootstrap({ openShift: OPEN_SHIFT })) })
    await addLine(ITEM_A.code, '0.12') // a typo'd +20% jump, 12 satang — over the tiny ฿0.05 drawer too
    await checkPaidFromDrawer()

    fireEvent.click(screen.getByTestId('receive-save')) // submit(false): the over-drawer check runs first, client-side
    await waitFor(() => expect(screen.getByTestId('receive-over-drawer-warning')).toBeTruthy())
    expect(screen.getByTestId('receive-over-drawer-warning').textContent).not.toMatch(/\d/) // D52 blind count: no figure
    expect(receivePurchase).not.toHaveBeenCalled() // the warning alone must not have saved anything yet

    fireEvent.click(screen.getByTestId('receive-over-drawer-confirm')) // sends mutate(priceJump = false) so far
    await waitFor(() => expect(receivePurchase).toHaveBeenCalledTimes(1))
    expect(receivePurchase).toHaveBeenLastCalledWith(expect.objectContaining({ acceptPriceJump: false, paidFromDrawer: true }))

    // the API refused with PRICE_JUMP — without the I-1 fix, receive-over-drawer-confirm would still be on screen
    // here, and one more tap on it would send mutate(priceJump = true): the jump accepted with no "ยืนยันราคานี้" press
    await waitFor(() => expect(screen.getByTestId('receive-price-jump')).toBeTruthy())
    expect(screen.queryByTestId('receive-over-drawer-confirm')).toBeNull()
    expect(screen.queryByTestId('receive-over-drawer-warning')).toBeNull()
    expect(receivePurchase).toHaveBeenCalledTimes(1) // still only the one (refused) attempt

    // the only way forward is "ยืนยันราคานี้" — which re-asks the over-drawer question for real, not a silent bypass
    fireEvent.click(screen.getByTestId('receive-confirm-price'))
    await waitFor(() => expect(screen.getByTestId('receive-over-drawer-warning')).toBeTruthy())
    expect(receivePurchase).toHaveBeenCalledTimes(1) // re-asking the drawer question saves nothing by itself

    fireEvent.click(screen.getByTestId('receive-over-drawer-confirm'))
    await waitFor(() => expect(receivePurchase).toHaveBeenCalledTimes(2))
    expect(receivePurchase).toHaveBeenLastCalledWith(expect.objectContaining({ acceptPriceJump: true, paidFromDrawer: true }))
    await waitFor(() => expect(screen.getByTestId('receive-done')).toBeTruthy())
  })
})

describe('ReceiveScreen — I-3 mutant M1: addLine must clear a stale PRICE_JUMP confirm on every kind of line-edit (item, qty, price), not only after a remove', () => {
  it.each([
    ['a different item', ITEM_B.code, '1', '0.10'],
    ['a different qty of the same item', ITEM_A.code, '2', '0.10'],
    ['a different price of the same item', ITEM_A.code, '1', '0.11'],
  ])('adding a line with %s after a PRICE_JUMP refusal hides the confirm immediately, without removing line 0 first', async (_label, code, qty, total) => {
    const receivePurchase = vi.fn(async (input: { acceptPriceJump: boolean }): Promise<PurchaseDto> => {
      if (!input.acceptPriceJump) throw new PosError('PRICE_JUMP', ITEM_A.code)
      return DONE
    })
    mount({ receivePurchase })
    await addLine(ITEM_A.code, '0.12') // line 0: a jump, refused on save
    fireEvent.click(screen.getByTestId('receive-save'))
    await waitFor(() => expect(screen.getByTestId('receive-confirm-price')).toBeTruthy())

    // the M1 mutant (addLine no longer calls setPriceJump(false)) must not survive this: no remove happens here
    fireEvent.change(screen.getByTestId('receive-item'), { target: { value: code } })
    fireEvent.change(screen.getByTestId('receive-qty'), { target: { value: qty } })
    fireEvent.change(screen.getByTestId('receive-total'), { target: { value: total } })
    fireEvent.click(screen.getByTestId('receive-add'))

    expect(screen.queryByTestId('receive-confirm-price')).toBeNull()
    expect(screen.queryByTestId('receive-price-jump')).toBeNull()
    expect(screen.getByTestId('receive-line-0')).toBeTruthy() // both lines kept, not replaced
    expect(screen.getByTestId('receive-line-1')).toBeTruthy()
  })
})

describe('ReceiveScreen — I-3 mutant M2: the over-drawer confirm must send the current priceJump flag, not a hard-coded true', () => {
  it('a clean (non-jumping) over-drawer receipt sends acceptPriceJump: false', async () => {
    const receivePurchase = vi.fn(async () => DONE)
    mount({ receivePurchase, shiftReport: vi.fn(async () => REPORT), bootstrap: vi.fn(async () => bootstrap({ openShift: OPEN_SHIFT })) })
    await addLine(ITEM_A.code, '0.10') // clean — no jump, but 10 satang > the ฿0.05 drawer
    await checkPaidFromDrawer()

    fireEvent.click(screen.getByTestId('receive-save'))
    await waitFor(() => expect(screen.getByTestId('receive-over-drawer-confirm')).toBeTruthy())
    expect(receivePurchase).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('receive-over-drawer-confirm'))
    await waitFor(() => expect(receivePurchase).toHaveBeenCalledTimes(1))
    // a hard-coded mutate(true) would send acceptPriceJump: true here — priceJump was never set for this receipt
    expect(receivePurchase).toHaveBeenLastCalledWith(expect.objectContaining({ acceptPriceJump: false, paidFromDrawer: true }))
  })
})

describe('ReceiveScreen — I-3 mutant M3: the item picker offers active raw items only', () => {
  it('never lists an inactive item or a prepared base, only active raw items', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId('receive-item')).toBeTruthy())
    const codes = Array.from((screen.getByTestId('receive-item') as HTMLSelectElement).options).map((o) => o.value)
    expect(codes).toEqual(expect.arrayContaining([ITEM_A.code, ITEM_B.code]))
    expect(codes).not.toContain(ITEM_INACTIVE.code)
    expect(codes).not.toContain(BASE_ITEM.code)
  })
})

describe('ReceiveScreen — I-3 mutant M5 and the drawer checkbox: removeLine and unticking "จ่ายจากลิ้นชัก" both clear the over-drawer warning', () => {
  it('removing the over-drawer line clears the warning immediately, without a new save press', async () => {
    mount({ shiftReport: vi.fn(async () => REPORT), bootstrap: vi.fn(async () => bootstrap({ openShift: OPEN_SHIFT })) })
    await addLine(ITEM_A.code, '0.10')
    await checkPaidFromDrawer()
    fireEvent.click(screen.getByTestId('receive-save'))
    await waitFor(() => expect(screen.getByTestId('receive-over-drawer-warning')).toBeTruthy())

    fireEvent.click(screen.getByTestId('receive-remove-0'))

    expect(screen.queryByTestId('receive-over-drawer-warning')).toBeNull()
    expect(screen.queryByTestId('receive-over-drawer-confirm')).toBeNull()
  })

  it('unticking the drawer checkbox clears the warning immediately', async () => {
    mount({ shiftReport: vi.fn(async () => REPORT), bootstrap: vi.fn(async () => bootstrap({ openShift: OPEN_SHIFT })) })
    await addLine(ITEM_A.code, '0.10')
    await checkPaidFromDrawer()
    fireEvent.click(screen.getByTestId('receive-save'))
    await waitFor(() => expect(screen.getByTestId('receive-over-drawer-warning')).toBeTruthy())

    fireEvent.click(screen.getByTestId('receive-paid-drawer')) // untick

    expect(screen.queryByTestId('receive-over-drawer-warning')).toBeNull()
    expect(screen.queryByTestId('receive-over-drawer-confirm')).toBeNull()
  })
})

describe('ReceiveScreen — m-1 (Task 9 fix round 1): a stale PRICE_JUMP message must not outlive the line it was about', () => {
  it('removing the jumping line clears the error text, not only its receive-price-jump testid', async () => {
    const receivePurchase = vi.fn(async (input: { acceptPriceJump: boolean }): Promise<PurchaseDto> => {
      if (!input.acceptPriceJump) throw new PosError('PRICE_JUMP', ITEM_A.code)
      return DONE
    })
    mount({ receivePurchase })
    await addLine(ITEM_A.code, '0.12')
    fireEvent.click(screen.getByTestId('receive-save'))
    await waitFor(() => expect(screen.getByText(TH.errPriceJump)).toBeTruthy())

    fireEvent.click(screen.getByTestId('receive-remove-0'))

    expect(screen.queryByText(TH.errPriceJump)).toBeNull()
  })
})

describe('ReceiveScreen — m-2 (Task 9 fix round 1): the drawer checkbox cannot get stuck checked and disabled once the shift disappears', () => {
  it('a shift closed elsewhere (bootstrap refetch lands with no open shift) unticks the checkbox and stops sending paidFromDrawer: true', async () => {
    const receivePurchase = vi.fn(async () => DONE)
    const { queryClient } = mount({ receivePurchase, shiftReport: vi.fn(async () => REPORT), bootstrap: vi.fn(async () => bootstrap({ openShift: OPEN_SHIFT })) })
    await addLine(ITEM_A.code, '0.10')
    await checkPaidFromDrawer()

    // the shift closed on another screen; the next bootstrap refetch lands with no open shift
    queryClient.setQueryData(bootstrapKey, bootstrap({ openShift: null }))
    await waitFor(() => expect((screen.getByTestId('receive-paid-drawer') as HTMLInputElement).checked).toBe(false))
    expect((screen.getByTestId('receive-paid-drawer') as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(screen.getByTestId('receive-save')) // must not fail in a loop against NO_OPEN_SHIFT
    await waitFor(() => expect(receivePurchase).toHaveBeenCalledTimes(1))
    expect(receivePurchase).toHaveBeenLastCalledWith(expect.objectContaining({ paidFromDrawer: false }))
    await waitFor(() => expect(screen.getByTestId('receive-done')).toBeTruthy())
  })
})

describe('ReceiveScreen — m-3 (Task 9 fix round 1): the client enforces the same ฿100,000-per-line and 50-line caps as receivePurchase', () => {
  it('refuses a line total over the per-line cap, with a Thai message, and adds nothing', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId('receive-item')).toBeTruthy())
    fireEvent.change(screen.getByTestId('receive-item'), { target: { value: ITEM_A.code } })
    fireEvent.change(screen.getByTestId('receive-qty'), { target: { value: '1' } })
    fireEvent.change(screen.getByTestId('receive-total'), { target: { value: '100000.01' } }) // 1 satang over MAX_LINE_SATANG
    fireEvent.click(screen.getByTestId('receive-add'))

    expect(screen.queryByTestId('receive-line-0')).toBeNull()
    expect(screen.getByText(TH.errLineTooLarge(formatBaht(MAX_LINE_SATANG)))).toBeTruthy()
  })

  it('refuses a 51st line, with a Thai message, once MAX_STOCK_LINES is reached', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId('receive-item')).toBeTruthy())
    for (let n = 0; n < MAX_STOCK_LINES; n++) {
      fireEvent.change(screen.getByTestId('receive-item'), { target: { value: ITEM_A.code } })
      fireEvent.change(screen.getByTestId('receive-qty'), { target: { value: '1' } })
      fireEvent.change(screen.getByTestId('receive-total'), { target: { value: '0.10' } })
      fireEvent.click(screen.getByTestId('receive-add'))
    }
    expect(screen.getByTestId(`receive-line-${MAX_STOCK_LINES - 1}`)).toBeTruthy()

    fireEvent.change(screen.getByTestId('receive-item'), { target: { value: ITEM_A.code } })
    fireEvent.change(screen.getByTestId('receive-qty'), { target: { value: '1' } })
    fireEvent.change(screen.getByTestId('receive-total'), { target: { value: '0.10' } })
    fireEvent.click(screen.getByTestId('receive-add'))

    expect(screen.queryByTestId(`receive-line-${MAX_STOCK_LINES}`)).toBeNull()
    expect(screen.getByText(TH.errTooManyLines(MAX_STOCK_LINES))).toBeTruthy()
  })
})
