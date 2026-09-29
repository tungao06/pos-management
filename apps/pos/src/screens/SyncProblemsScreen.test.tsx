// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, type Router } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PosApi, SyncProblemDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { can } from '../app/permissions'
import { SessionProvider, useSession } from '../app/session'
import { testSellCatalog } from '../test-utils/sell-catalog'
import { TH } from '../ui/th'
import { OWNERS, problem, user } from './block3-test-fixtures'
import { SyncProblemsScreen } from './SyncProblemsScreen'

const downloads: { name: string; text: string }[] = []
vi.mock('../ui/save-file', () => ({ saveFile: (name: string, text: string) => downloads.push({ name, text }) }))

afterEach(() => {
  cleanup()
  downloads.length = 0
})

function fakeProblemsApi(rows: SyncProblemDto[], overrides: Partial<PosApi> = {}): PosApi {
  return {
    listSyncProblems: vi.fn(async () => rows),
    loadSellCatalog: vi.fn(async () => testSellCatalog()),
    bootstrap: vi.fn(async () => ({
      needsSetup: false,
      device: { id: 'd1', name: 'แท็บเล็ตหน้าร้าน', receiptPrefix: 'A' },
      users: [{ id: 'owner-1', displayName: 'เจ้าของ', role: 'owner' as const }],
      openShift: null,
      pendingSyncItems: 0,
      lastBackupAt: null,
      backupDue: false,
      legacyDevice: false,
      dayoLinked: true,
      dayoBaseUrl: 'https://dayo.example/api/v1',
      staffNeedingPin: [],
      ownerRecovery: false,
      countingShift: null,
      zWaiting: [],
      centralLastZNo: null,
      sync: {
        linked: true, apiState: 'ok', maskedKey: 'dayo_…cdef', baseUrl: 'https://dayo.example/api/v1', clockSkewMs: 0, clockWarning: false, pricingMismatch: false, pricingCommit: null,
        catalogVersion: 42, catalogCheckedAt: null, catalogError: null, lastPushAt: null, pendingSyncRows: 0, problemSyncRows: rows.length, oldestPendingAt: null, pendingOver24h: false,
        priceDiffBills: 0, clockFarAheadBills: 0, scopeWait: null, shiftDataConflict: false, centralMismatchBills: 0, shiftLaneHeld: null,
      },
    })),
    retrySyncRow: vi.fn(async () => undefined),
    renumberReceipt: vi.fn(async () => ({ oldReceiptNo: 'A-000001', newReceiptNo: 'A-000009' })),
    remapCode: vi.fn(async () => undefined),
    remapStaff: vi.fn(async () => undefined),
    excludeFromSync: vi.fn(async () => undefined),
    exportSyncRow: vi.fn(async () => '{"key":"order:o1"}'),
    ...overrides,
  } as unknown as PosApi
}

function SignedIn({ user, children }: { user: UserDto; children: JSX.Element }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(user), [signIn, user])
  return children
}

function renderProblems(api: PosApi, role: UserDto['role']): { router: Router<ReturnType<typeof buildRouteTree>> } {
  const user: UserDto = { id: role === 'owner' ? 'owner-1' : role === 'manager' ? 'manager-1' : 'staff-1', displayName: 'ผู้ใช้', role }
  const routeTree = buildRouteTree()
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/sync-problems'] }) })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <SignedIn user={user}>
            <RouterProvider router={router} />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { router }
}

/**
 * The block-3 tests below (spec §6.4) need an arbitrary signed-in user id (to match `approverUserId` in what they
 * assert the API was called with) — `renderProblems` above always picks a fixed one per role. Same stack, a real
 * router underneath (this screen's own `<Navigate>` needs one — `../test-utils`'s router-less `render` cannot be
 * used here without breaking the `useNavigate` this screen's real "กลับ" button relies on elsewhere in this file).
 */
function renderProblemsAs(api: PosApi, user: UserDto): { router: Router<ReturnType<typeof buildRouteTree>>; queryClient: QueryClient } {
  const routeTree = buildRouteTree()
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/sync-problems'] }) })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <SignedIn user={user}>
            <RouterProvider router={router} />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { router, queryClient }
}

function buildRouteTree() {
  const rootRoute = createRootRoute()
  const syncProblemsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sync-problems', component: SyncProblemsScreen })
  const sellRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sell', component: () => null })
  const statusRoute = createRoute({ getParentRoute: () => rootRoute, path: '/status', component: () => null })
  return rootRoute.addChildren([syncProblemsRoute, sellRoute, statusRoute])
}

const ROW = (over: Partial<SyncProblemDto> = {}): SyncProblemDto => ({
  outboxId: 'x1', key: 'order:o1', kind: 'order', orderId: 'o1', receiptNo: 'A-000001', at: '2026-09-25T03:00:00.000Z',
  reason: 'CONFLICT', detail: 'เลขใบเสร็จ A-000001 ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว', remedies: ['RETRY', 'RENUMBER'], remap: null, remapHint: null, children: [],
  pushKind: 'order', shiftId: null, prefix: null, waiting: null, hint: null, central: null, centralOrderNo: null, blocksLaneRows: 0,
  ...over,
})

describe('SyncProblemsScreen (spec §6.4 — owner only, ruling R11/R8/N5)', () => {
  it('CONFLICT offers "ออกเลขใบเสร็จใหม่" behind an owner PIN and a reason, and has no delete button', async () => {
    const api = fakeProblemsApi([ROW()])
    renderProblems(api, 'owner')
    fireEvent.click(await screen.findByTestId('remedy-renumber'))
    fireEvent.change(screen.getByTestId('approval-pin'), { target: { value: '1111' } })
    fireEvent.change(screen.getByTestId('approval-reason'), { target: { value: 'เลขชน' } })
    fireEvent.click(screen.getByTestId('approval-ok'))
    await waitFor(() => expect(api.renumberReceipt).toHaveBeenCalledWith({ outboxId: 'x1', approverUserId: 'owner-1', approverPin: '1111', reason: 'เลขชน' }))
    expect(screen.queryByText(/ลบ/)).toBeNull()
  })

  it('a staff member is sent away from /sync-problems', async () => {
    const { router } = renderProblems(fakeProblemsApi([]), 'staff')
    await waitFor(() => expect(router.state.location.pathname).toBe('/sell'))
  })

  it('a manager is sent away from /sync-problems too (owner only)', async () => {
    const { router } = renderProblems(fakeProblemsApi([]), 'manager')
    await waitFor(() => expect(router.state.location.pathname).toBe('/sell'))
  })

  it('never calls listSyncProblems for a non-owner (role checked before the call)', async () => {
    const api = fakeProblemsApi([])
    const { router } = renderProblems(api, 'staff')
    await waitFor(() => expect(router.state.location.pathname).toBe('/sell'))
    expect(api.listSyncProblems).not.toHaveBeenCalled()
  })

  it('"ลองใหม่" also needs an owner PIN and a reason — retrySyncRow enforces it (Task 15 remedyRow)', async () => {
    const api = fakeProblemsApi([ROW()])
    renderProblems(api, 'owner')
    fireEvent.click(await screen.findByTestId('remedy-retry'))
    fireEvent.change(screen.getByTestId('approval-pin'), { target: { value: '2222' } })
    fireEvent.change(screen.getByTestId('approval-reason'), { target: { value: 'ลองอีกครั้ง' } })
    fireEvent.click(screen.getByTestId('approval-ok'))
    await waitFor(() => expect(api.retrySyncRow).toHaveBeenCalledWith({ outboxId: 'x1', approverUserId: 'owner-1', approverPin: '2222', reason: 'ลองอีกครั้ง' }))
  })

  it('UNKNOWN_CODE: "เลือกรหัสแทน" picks a menu/size/sweetness from the latest catalog and calls remapCode', async () => {
    const api = fakeProblemsApi([ROW({ reason: 'UNKNOWN_CODE', detail: 'ไม่พบรหัสเมนู', remedies: ['RETRY', 'REMAP_CODE'] })])
    renderProblems(api, 'owner')
    fireEvent.click(await screen.findByTestId('remedy-remap-code'))
    // the default target (first menu, its default size/sweetness) is already selected — only approval is left
    expect(screen.getByTestId('approval-ok')).not.toBeDisabled()
    fireEvent.change(screen.getByTestId('approval-pin'), { target: { value: '3333' } })
    fireEvent.change(screen.getByTestId('approval-reason'), { target: { value: 'เมนูใหม่' } })
    fireEvent.click(screen.getByTestId('approval-ok'))
    await waitFor(() => expect(api.remapCode).toHaveBeenCalled())
    const call = (api.remapCode as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(call.outboxId).toBe('x1')
    expect(call.approverUserId).toBe('owner-1')
    expect(call.target.field).toBe('line')
  })

  it('UNKNOWN_STAFF: "เลือกผู้ขายแทน" needs a staff pick before "ยืนยัน" is enabled', async () => {
    const api = fakeProblemsApi([ROW({ reason: 'UNKNOWN_STAFF', detail: 'ไม่พบพนักงาน', remedies: ['RETRY', 'REMAP_STAFF'] })])
    renderProblems(api, 'owner')
    fireEvent.click(await screen.findByTestId('remedy-remap-staff'))
    expect(screen.getByTestId('approval-ok')).toBeDisabled()
    fireEvent.click(screen.getByTestId('remap-staff-เจ้าของ'))
    fireEvent.change(screen.getByTestId('approval-pin'), { target: { value: '4444' } })
    fireEvent.change(screen.getByTestId('approval-reason'), { target: { value: 'มอบให้เจ้าของ' } })
    fireEvent.click(screen.getByTestId('approval-ok'))
    await waitFor(() => expect(api.remapStaff).toHaveBeenCalledWith({ outboxId: 'x1', approverUserId: 'owner-1', approverPin: '4444', reason: 'มอบให้เจ้าของ', newStaffId: 'owner-1' }))
  })

  it('INVALID: "ปิดเป็นรายการนอกระบบกลาง" needs a two-step confirm with an explanation before the PIN dialog', async () => {
    const api = fakeProblemsApi([ROW({ reason: 'INVALID', detail: 'ข้อมูลไม่ถูกต้อง', remedies: ['RETRY', 'EXCLUDE'] })])
    renderProblems(api, 'owner')
    fireEvent.click(await screen.findByTestId('remedy-exclude'))
    expect(screen.getByText(TH.syncExcludeWarning)).toBeInTheDocument()
    expect(screen.queryByTestId('approval-pin')).toBeNull() // not yet — the explanation comes first
    fireEvent.click(screen.getByTestId('exclude-confirm'))
    fireEvent.change(await screen.findByTestId('approval-pin'), { target: { value: '5555' } })
    fireEvent.change(screen.getByTestId('approval-reason'), { target: { value: 'ปิดรายการ' } })
    fireEvent.click(screen.getByTestId('approval-ok'))
    await waitFor(() => expect(api.excludeFromSync).toHaveBeenCalledWith({ outboxId: 'x1', approverUserId: 'owner-1', approverPin: '5555', reason: 'ปิดรายการ' }))
  })

  it('CLOCK_AHEAD: shows "รอเวลา" and the stronger exclude warning, with EXCLUDE as the only remedy', async () => {
    const api = fakeProblemsApi([ROW({ reason: 'CLOCK_AHEAD', detail: 'เวลาบิลล้ำเวลาระบบกลาง', remedies: ['EXCLUDE'] })])
    renderProblems(api, 'owner')
    const row = await screen.findByTestId('problem-x1')
    expect(within(row).getByText(TH.syncProblemClockAheadTag)).toBeInTheDocument()
    expect(within(row).queryByTestId('remedy-retry')).toBeNull()
    fireEvent.click(within(row).getByTestId('remedy-exclude'))
    expect(screen.getByText(TH.syncExcludeClockAheadWarning)).toBeInTheDocument()
  })

  it('a PARENT_REJECTED child is nested under its parent row', async () => {
    const child = ROW({ outboxId: 'x2', key: 'order_void:o1', kind: 'order_void', receiptNo: 'A-000001', reason: 'PARENT_REJECTED', detail: '', remedies: [] })
    const api = fakeProblemsApi([ROW({ children: [child] })])
    renderProblems(api, 'owner')
    // deviation from the pre-Task-16 comment: the row testid is now by `outboxId` (stable and always present, unlike
    // `receiptNo` — null on a shift-lane row) rather than shared receipt number — the child (nested under the
    // parent's OUTER wrapper, a sibling of the parent's own testid div — indented, `style` margin-left) is the one
    // that shows "ยกเลิกบิล" (its own kind) and never gets its own remedy buttons (remedies: []).
    await screen.findByTestId('problem-x1')
    const childRow = await screen.findByTestId('problem-x2')
    expect(within(childRow).getByText(TH.syncProblemKind.order_void)).toBeInTheDocument()
    expect(within(childRow).queryByTestId('remedy-retry')).toBeNull()
  })

  it('"ส่งออก JSON" downloads the row under sync-row-<key>.json', async () => {
    const api = fakeProblemsApi([ROW()])
    renderProblems(api, 'owner')
    fireEvent.click(await screen.findByTestId('remedy-export'))
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0]!.name).toBe('sync-row-order:o1.json')
    expect(api.exportSyncRow).toHaveBeenCalledWith({ actorUserId: 'owner-1', outboxId: 'x1' })
  })

  it('shows nothing to do when there are no problems', async () => {
    renderProblems(fakeProblemsApi([]), 'owner')
    expect(await screen.findByText(TH.syncProblemsEmpty)).toBeInTheDocument()
  })
})

describe('SyncProblemsScreen — "เลือกรหัสแทน" follows the field dayo named (fix round: code Low 3)', () => {
  const approve = async (api: PosApi) => {
    fireEvent.change(screen.getByTestId('approval-pin'), { target: { value: '1111' } })
    fireEvent.change(screen.getByTestId('approval-reason'), { target: { value: 'แก้ตามระบบกลาง' } })
    fireEvent.click(screen.getByTestId('approval-ok'))
    await waitFor(() => expect(api.remapCode).toHaveBeenCalled())
    return (api.remapCode as ReturnType<typeof vi.fn>).mock.calls[0]![0].target
  }
  const UNKNOWN_CODE = { reason: 'UNKNOWN_CODE', remedies: ['RETRY', 'REMAP_CODE'] as SyncProblemDto['remedies'] }

  it('dayo named the channel: the picker opens on it and the other two fields are locked', async () => {
    const api = fakeProblemsApi([ROW({ ...UNKNOWN_CODE, detail: 'ไม่พบช่องทางขาย "old"', remap: { field: 'channel' } })])
    renderProblems(api, 'owner')
    fireEvent.click(await screen.findByTestId('remedy-remap-code'))
    expect(screen.getByTestId('remap-code-field-channel')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('remap-code-field-line')).toBeDisabled()
    expect(screen.getByTestId('remap-code-field-payment')).toBeDisabled()
    fireEvent.change(screen.getByTestId('remap-code-channel'), { target: { value: 'grab' } })
    expect(await approve(api)).toEqual({ field: 'channel', code: 'grab' })
  })
  it('dayo named a line: only the lines it named can be picked, the first one preselected', async () => {
    const remap = { field: 'line' as const, lines: [{ index: 1, code: 'Old Menu', size: '16 oz' as const, sweetness: '50%' as const }, { index: 3, code: 'Old Menu', size: '20 oz' as const, sweetness: '50%' as const }], gradeOnly: false }
    const api = fakeProblemsApi([ROW({ ...UNKNOWN_CODE, detail: 'ไม่พบเมนู "Old Menu"', remap })])
    renderProblems(api, 'owner')
    fireEvent.click(await screen.findByTestId('remedy-remap-code'))
    expect(screen.getByTestId('remap-code-field-line')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('remap-code-field-channel')).toBeDisabled()
    const index = screen.getByTestId('remap-code-line-index')
    expect(index).toHaveValue('1')
    expect(within(index).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toEqual(['1', '3'])
    fireEvent.change(index, { target: { value: '3' } })
    expect(await approve(api)).toMatchObject({ field: 'line', lineIndex: 3 })
  })
  it('dayo named only a grade: menu, size and sweetness are locked to the line\'s own — only the grade changes', async () => {
    const remap = { field: 'line' as const, lines: [{ index: 0, code: 'Matcha Latte', size: '16 oz' as const, sweetness: '50%' as const }], gradeOnly: true }
    const api = fakeProblemsApi([ROW({ ...UNKNOWN_CODE, detail: 'ไม่พบเกรด "Premium"', remap })])
    renderProblems(api, 'owner')
    fireEvent.click(await screen.findByTestId('remedy-remap-code'))
    for (const id of ['remap-code-menu', 'remap-code-size', 'remap-code-sweetness']) expect(screen.getByTestId(id)).toBeDisabled()
    expect(screen.getByText(TH.remapCodeGradeOnly)).toBeInTheDocument()
    expect(await approve(api)).toEqual({ field: 'line', lineIndex: 0, code: 'Matcha Latte', size: '16 oz', sweetness: '50%' })
  })
  it('a row dayo refused for a value no remap can fix shows its hint (e.g. the cash method gone from dayo)', async () => {
    const api = fakeProblemsApi([ROW({ reason: 'UNKNOWN_CODE', detail: 'ไม่พบวิธีชำระ "cash"', remedies: ['RETRY'], remapHint: 'ให้เพิ่มวิธีชำระเงินสดกลับ แล้วกด "ลองใหม่"' })])
    renderProblems(api, 'owner')
    expect(await screen.findByTestId('problem-remap-hint')).toHaveTextContent('ให้เพิ่มวิธีชำระเงินสดกลับ')
    expect(screen.queryByTestId('remedy-remap-code')).toBeNull()
  })
})

/** `bootstrap` only needs `users` (owners) here — everything this screen reads off it. */
const apiWith = (rows: SyncProblemDto[]): PosApi =>
  ({
    listSyncProblems: vi.fn(async () => rows),
    loadSellCatalog: vi.fn(async () => testSellCatalog()),
    closeOffCatalog: vi.fn(async () => ({ offCatalogKey: 'order_off_catalog:o1' })),
    acknowledgeElsewhere: vi.fn(async () => ({ orderNo: 'L260925-014', matchesLocal: false })),
    reconfirmOwner: vi.fn(async () => undefined),
    excludeFromSync: vi.fn(async () => undefined),
    exportSyncRow: vi.fn(async () => '{}'),
    bootstrap: vi.fn(async () => ({ users: OWNERS })),
  }) as unknown as PosApi
const OWNER_U1: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }
const MANAGER_M1: UserDto = { id: 'm1', displayName: 'ผู้จัดการ', role: 'manager' }

describe('SyncProblemsScreen — block 3 (spec 04 §6.4)', () => {
  it('shows exactly the buttons the row carries', async () => {
    renderProblemsAs(apiWith([problem({ reason: 'CONFLICT', prefix: 'exists:', remedies: ['ACKNOWLEDGE_ELSEWHERE', 'EXCLUDE'] })]), OWNER_U1)
    const row = await screen.findByTestId('problem-ob1')
    expect(within(row).getByTestId('remedy-acknowledge')).toHaveTextContent(TH.remedyAcknowledge)
    expect(within(row).getByTestId('remedy-exclude')).toHaveTextContent(TH.remedyExcludeLocal)
    expect(within(row).queryByTestId('remedy-close-off-catalog')).toBeNull()
    expect(within(row).queryByTestId('remedy-retry')).toBeNull()
  })
  it('"ปิดเป็นบิลนอกแคตตาล็อก" warns, needs a reason and the owner PIN, then calls closeOffCatalog', async () => {
    const api = apiWith([problem()])
    const { queryClient } = renderProblemsAs(api, OWNER_U1)
    await user.click(await screen.findByTestId('remedy-close-off-catalog'))
    const dialog = await screen.findByTestId('off-catalog-dialog')
    expect(dialog).toHaveTextContent(TH.offCatalogWarning)
    expect(within(dialog).getByTestId('off-catalog-confirm')).toBeDisabled()
    await user.type(within(dialog).getByTestId('off-catalog-reason'), 'เมนูถูกลบในระบบกลาง')
    await user.click(within(dialog).getByTestId('count-approver-TungAo'))
    for (const d of '1111') await user.click(within(dialog).getByTestId(`pin-${d}`))
    await user.click(within(dialog).getByTestId('off-catalog-confirm'))
    await waitFor(() => expect(api.closeOffCatalog).toHaveBeenCalledWith({ approverUserId: 'u1', approverPin: '1111', reason: 'เมนูถูกลบในระบบกลาง', outboxId: 'ob1' }))
    // fix round 1 item 4 (security): the PIN just typed must not sit in the mutation's own state afterwards.
    await waitFor(() => expect(queryClient.getMutationCache().getAll().every((m) => m.state.status === 'idle')).toBe(true))
  })
  // deviation from task-16-brief.md: spec 04 §12 Q44 makes the WHOLE "ส่งไม่ผ่าน" page owner-only (already covered
  // by "a manager is sent away from /sync-problems too" above) — a manager never reaches a row to check the button
  // against, so this checks the same role gate `canCloseOffCatalog` uses instead (defense in depth, D97): even a
  // row that carries CLOSE_OFF_CATALOG never shows the button to a role `can()` refuses it to.
  it('CLOSE_OFF_CATALOG is hidden from any role can() refuses (D97 defense in depth)', async () => {
    renderProblemsAs(apiWith([problem()]), OWNER_U1)
    const row = await screen.findByTestId('problem-ob1')
    expect(within(row).getByTestId('remedy-close-off-catalog')).toBeVisible() // owner: shown (can('owner','close_off_catalog'))
    expect(can('manager', 'close_off_catalog')).toBe(false) // manager never reaches this row (owner-only page) — the same check would hide it too
  })
  it('an exists: row shows dayo\'s order number and "ไม่ตรง" when the totals differ (m2)', async () => {
    renderProblemsAs(apiWith([problem({ reason: 'CONFLICT', prefix: 'exists:', remedies: ['ACKNOWLEDGE_ELSEWHERE', 'EXCLUDE'], central: { orderNo: 'L260925-014', reportedTotalSatang: 4_000, paymentIsCash: false, matchesLocal: false } })]), OWNER_U1)
    const row = await screen.findByTestId('problem-ob1')
    expect(row).toHaveTextContent('L260925-014')
    expect(within(row).getByTestId('problem-central-mismatch')).toBeVisible()
  })
  it('a rejected void tells the owner which bill to cancel on the web', async () => {
    renderProblemsAs(apiWith([problem({ kind: 'order_void', key: 'order_void:o1', reason: 'FORBIDDEN', prefix: 'rule:', remedies: ['EXCLUDE'], hint: 'void_rejected', centralOrderNo: 'L260925-014' })]), OWNER_U1)
    expect(await screen.findByText(TH.voidRejectedHint('L260925-014'))).toBeVisible()
  })
  it('a scope wait of 7 days shows as a waiting card with "ปิดไว้ในเครื่อง" only', async () => {
    renderProblemsAs(apiWith([problem({ kind: 'shift_open', key: 'shift_open:s1', orderId: null, receiptNo: null, reason: 'FORBIDDEN', prefix: 'scope:', remedies: ['EXCLUDE'], waiting: 'scope' })]), OWNER_U1)
    const row = await screen.findByTestId('problem-ob1')
    expect(within(row).getByTestId('problem-waiting-scope')).toBeVisible()
    expect(within(row).getAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual(['remedy-exclude', 'problem-export'])
  })
  it('a shift conflict (CONFLICT counted: or INVALID data_conflict:) shows the change-key card (R12 · R5-2)', async () => {
    renderProblemsAs(apiWith([problem({ kind: 'shift_close', key: 'shift_close:s1', orderId: null, reason: 'INVALID', prefix: 'data_conflict:', remedies: ['EXCLUDE'], hint: 'shift_conflict' })]), OWNER_U1)
    expect(await screen.findByTestId('problem-hint-shift-conflict')).toHaveTextContent(TH.shiftConflictBanner)
  })
})
