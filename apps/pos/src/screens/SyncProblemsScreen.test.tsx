// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, type Router } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PosApi, SyncProblemDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { SessionProvider, useSession } from '../app/session'
import { testSellCatalog } from '../test-utils/sell-catalog'
import { TH } from '../ui/th'
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
      sync: {
        linked: true, apiState: 'ok', maskedKey: 'dayo_…cdef', baseUrl: 'https://dayo.example/api/v1', clockSkewMs: 0, clockWarning: false, pricingMismatch: false, pricingCommit: null,
        catalogVersion: 42, catalogCheckedAt: null, catalogError: null, lastPushAt: null, pendingBills: 0, problemBills: rows.length, oldestPendingAt: null, pendingOver24h: false,
        priceDiffBills: 0, clockFarAheadBills: 0,
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
    const row = await screen.findByTestId('problem-A-000001')
    expect(within(row).getByText(TH.syncProblemClockAheadTag)).toBeInTheDocument()
    expect(within(row).queryByTestId('remedy-retry')).toBeNull()
    fireEvent.click(within(row).getByTestId('remedy-exclude'))
    expect(screen.getByText(TH.syncExcludeClockAheadWarning)).toBeInTheDocument()
  })

  it('a PARENT_REJECTED child is nested under its parent row', async () => {
    const child = ROW({ outboxId: 'x2', key: 'order_void:o1', kind: 'order_void', receiptNo: 'A-000001', reason: 'PARENT_REJECTED', detail: '', remedies: [] })
    const api = fakeProblemsApi([ROW({ children: [child] })])
    renderProblems(api, 'owner')
    // parent and child share the same receipt number — both share the testid; the child (nested inside the parent) is
    // the one that shows "ยกเลิกบิล" (its own kind), and it never gets its own remedy buttons (remedies: []).
    const rows = await screen.findAllByTestId('problem-A-000001')
    expect(rows).toHaveLength(2)
    expect(within(rows[1]!).getByText(TH.syncProblemKind.order_void)).toBeInTheDocument()
    expect(within(rows[1]!).queryByTestId('remedy-retry')).toBeNull()
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
