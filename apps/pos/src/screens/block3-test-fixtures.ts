// Shared test helpers of block 3's screens (Task 15) — Task 16's stock screens reuse `render`/`fakeApi` shape too.
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import { buildZReport, cashInputsFromMovements, summarizeShiftSales, zReportHash, type ZChainWarning, type ZSnapshot } from '@dayo/domain'
import type { BotCashDto, CountSummaryDto, OrderDetailDto, SyncProblemDto, SyncStatusDto, UserDto, ZReportDto } from '../api/types'

/** A healthy, linked sync status (Task 14 block-3 fields included) for the block-3 screen tests that build one by hand. */
export function status(over: Partial<SyncStatusDto> = {}): SyncStatusDto {
  return {
    linked: true, apiState: 'ok', maskedKey: 'dayo_…abcd', baseUrl: 'http://localhost:8787/api/v1', clockSkewMs: 0, clockWarning: false,
    pricingMismatch: false, pricingCommit: null, catalogVersion: 42, catalogCheckedAt: '2026-09-25T03:00:00.000Z', catalogError: null,
    lastPushAt: '2026-09-25T03:00:00.000Z', pendingSyncRows: 0, problemSyncRows: 0, oldestPendingAt: null, pendingOver24h: false, priceDiffBills: 0,
    clockFarAheadBills: 0, scopeWait: null, shiftDataConflict: false, centralMismatchBills: 0, shiftLaneHeld: null, ...over,
  }
}

/** A dead `order` row of the "ส่งไม่ผ่าน" page (Task 14 block-3 shape) with `over` laid on top. */
export function problem(over: Partial<SyncProblemDto> = {}): SyncProblemDto {
  return {
    outboxId: 'ob1', key: 'order:o1', kind: 'order', orderId: 'o1', shiftId: 's1', receiptNo: 'A-000001', at: '2026-09-25T03:00:00.000Z', reason: 'UNKNOWN_CODE', detail: 'ไม่พบเมนู',
    prefix: null, remedies: ['RETRY', 'REMAP_CODE', 'CLOSE_OFF_CATALOG', 'EXCLUDE'], remap: null, remapHint: null, children: [], pushKind: 'order',
    waiting: null, hint: null, central: null, centralOrderNo: null, blocksLaneRows: 0, ...over,
  }
}

/** A paid bill of block 2/3 shape (OrderDetailDto) with `over` laid on top — the full shape lives on `main`; this
 * mirrors the fields the block-3 screens read. */
export function detail(over: Partial<OrderDetailDto> = {}): OrderDetailDto {
  return {
    id: 'o1', receiptNo: 'A-000001', queueNo: 1, status: 'paid', businessDate: '2026-09-25', soldAt: '2026-09-25T03:00:00.000Z', channelCode: 'store', catalogVersion: 42,
    subtotalSatang: 4_500, discountSatang: 0, discountReason: null, totalSatang: 4_500, method: 'PROMPTPAY', tenderedSatang: null, changeSatang: null, voidedAt: null, cups: 1,
    paidAt: '2026-09-25T03:00:00.000Z', payments: [{ method: 'PROMPTPAY', amountSatang: 4_500 }], lines: [], promotions: [], events: [], shiftId: 's1',
    soldById: 'u1', soldByName: 'TungAo', voidable: true, dayoEdit: null, offCatalog: false, centralMismatch: null,
    central: { state: 'sent', orderNo: 'L260925-014', computedTotalSatang: 4_500, diffSatang: 0, duplicateOf: [], reason: null, voidState: 'none' },
    ...over,
  } as OrderDetailDto
}

export const SALES_45 = summarizeShiftSales([{ id: 'o1', status: 'paid', subtotalSatang: 4_500, discountSatang: 0, totalSatang: 4_500, payments: [{ method: 'CASH', amountSatang: 4_500 }] }])

export const botDto: BotCashDto = {
  shiftId: 's1',
  after: '2026-09-24T17:00:00.000Z',
  until: '2026-09-25T05:00:00.000Z',
  cashTotalSatang: 7_000,
  fetchedAt: '2026-09-25T05:00:01.000Z',
  bills: [{ orderNo: 'L260925-901', version: 1, source: 'line', soldAt: '2026-09-25T04:00:00+00:00', totalSatang: 7_000, createdByName: 'DCm' }],
}

export function summary(over: Partial<CountSummaryDto> = {}): CountSummaryDto {
  return {
    shift: { id: 's1', businessDate: '2026-09-25', openedAt: '2026-09-25T03:00:00.000Z', openedBy: 'u1', openingFloatSatang: 50_000, syncMode: 'central', openedByName: 'TungAo', openedQuick: false },
    generatedAt: '2026-09-25T05:00:00.000Z',
    sales: SALES_45,
    cash: { openingFloatSatang: 50_000, cashSalesSatang: 4_500, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0, drawerExpensesSatang: 0, botCashSatang: 7_000 },
    expectedCashSatang: 61_500,
    varianceAlertSatang: 2_000,
    cashMovements: [],
    voids: [],
    negativeBases: [],
    pendingSyncItems: 0,
    fingerprint: 'fp',
    countedAt: '2026-09-25T05:00:00.000Z',
    syncMode: 'central',
    includesBotCash: true,
    bot: botDto,
    zBlockedBy: null,
    notInDayo: { bills: 0, voidRefundSatang: 0 },
    ...over,
  }
}

export const OWNERS: UserDto[] = [
  { id: 'u1', displayName: 'TungAo', role: 'owner' },
  { id: 'u2', displayName: 'DCm', role: 'owner' },
]

/** Every method is a `vi.fn()` with a reasonable default answer — override any of them with `over`. */
export function fakeApi(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bootstrap: vi.fn(async () => ({ users: OWNERS, countingShift: null, zWaiting: [], centralLastZNo: null })),
    finishCount: vi.fn(async () => ({ shiftId: 's1', countedAt: '2026-09-25T05:00:00.000Z' })),
    fetchBotCash: vi.fn(async () => botDto),
    countSummary: vi.fn(async () => summary()),
    confirmCount: vi.fn(async () => ({ countId: 'c1', z: null })),
    issueZ: vi.fn(async () => ({ id: 'z1', shiftId: 's1', createdAt: '2026-09-25T05:10:00.000Z', hash: 'ab'.repeat(32), hashOk: true, snapshot: null })),
    // Task 14 · carried items 9a/9b (Task 16)
    keepShiftLocal: vi.fn(async () => ({ shiftId: 's1', closedKeys: [], sentKeys: [], botWindow: null })),
    skipCountFloor: vi.fn(async () => ({ skipped: [{ countedAt: '2026-09-22T05:00:00.000Z', shiftId: 's0' }], botBillsRisk: 'double_or_missed' as const })),
    ...over,
  }
}

export const user = userEvent.setup()

export async function countBaht(baht: number): Promise<void> {
  await user.clear(screen.getByTestId('count-input-1'))
  await user.type(screen.getByTestId('count-input-1'), String(baht))
}

export async function pickOwnerAndPin(name: string, pin: string): Promise<void> {
  await user.click(screen.getByTestId(`count-approver-${name}`))
  for (const d of pin) await user.click(screen.getByTestId(`pin-${d}`))
}

export const CHAIN_WARNING: ZChainWarning = {
  brokenShiftId: 's0',
  storedGrandTotalSatang: null,
  recomputedGrandTotalSatang: 0,
  acknowledgedBy: 'u1',
  unreadableZs: [],
  duplicateZNos: [],
  duplicateZNosTruncated: false,
  missingZNos: [],
  missingZNosTruncated: false,
  deletedShiftIds: [],
  deletedShiftIdsTruncated: false,
  zNoGap: 0,
}

/** A real Z (float ฿500 + one ฿45 cash bill, counted ฿545, local-only shape) with `over` laid on top; the hash matches what is shown. */
export function zDto(over: Partial<ZSnapshot> = {}): ZReportDto {
  const { snapshot } = buildZReport(
    {
      shiftId: 's1',
      businessDate: '2026-09-25',
      deviceId: 'd1',
      zNo: 1,
      openedAt: '2026-09-25T03:00:00.000Z',
      openedBy: 'u1',
      openedQuick: false,
      countedAt: '2026-09-25T05:00:00.000Z',
      closedAt: '2026-09-25T05:05:00.000Z',
      closedBy: 'u2',
      countedBy: 'u1',
      sales: SALES_45,
      cash: cashInputsFromMovements(50_000, 4_500, []),
      countLines: [{ denominationSatang: 100, count: 545 }],
      countedCashSatang: 54_500,
      varianceAlertSatang: 2_000,
      varianceReason: null,
      voids: [],
      bankQrTotalSatang: null,
      chainWarning: null,
      botWindow: null,
      botBills: [],
    },
    null,
  )
  const snap: ZSnapshot = { ...snapshot, ...over }
  return { id: 'z1', shiftId: 's1', createdAt: snap.closedAt, hash: zReportHash(snap), hashOk: true, snapshot: snap }
}
