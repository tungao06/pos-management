import { createMockDayo, MOCK_API_KEY, type MockDayo } from '@dayo/dayo-mock'
import type { ShiftDto } from '../../src/api/types'
import { openTestApi, type ReadyApi } from './db'

/** UUIDs of packages/contracts/fixtures/pos-test/e1-catalog-rich.json (Task 6) */
export const STAFF = {
  TungAo: '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f', DCm: '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d', Beam: '2c3d4e5f-6071-4283-94a5-b6c7d8e9f0a1',
  Mint: '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0', Unnamed: '4e5f6071-8293-44a5-b6c7-d8e9f0a1b2c3', Old: '3d4e5f60-7182-4394-a5b6-c7d8e9f0a1b2',
} as const

/**
 * block3 = a dayo main 12885fe mock (ADR-0069 phase 1: the four shift kinds, shift:write, E4, E1 last_z_*) · block3Phase2 =
 * + dayo phase 2 (order_off_catalog, recompute, prefixes on order rows — preflight P3). Both default false (block-2 dayo).
 * beforeConnect (Task 13): runs on the mock before the setup — e.g. `preloadZ` (a Z another install of this key sent).
 */
type ConnectOpts = { now?: string; block3?: boolean; block3Phase2?: boolean; beforeConnect?: (mock: MockDayo) => void }
type Connected = Omit<ReadyApi, 'shift'> & { mock: MockDayo }
/** A device linked to the mock dayo: TungAo (owner, PIN 1111) + DCm (owner, PIN 2222) + (unless openShift: false) an open shift with ฿500. */
// the `openShift: false` overload comes FIRST: `ReturnType<typeof openConnectedApi>` reads the last one, and the block-2 tests type
// their helpers' `t` with it (shift present)
export async function openConnectedApi(opts: ConnectOpts & { openShift: false }): Promise<Connected & { shift: null }>
export async function openConnectedApi(opts?: ConnectOpts & { openShift?: true }): Promise<Connected & { shift: ShiftDto }>
export async function openConnectedApi(opts: ConnectOpts & { openShift?: boolean } = {}): Promise<Connected & { shift: ShiftDto | null }> {
  const now = opts.now ?? '2026-09-25T03:00:00.000Z'
  const mock = createMockDayo({ now, block3: opts.block3 ?? false, block3Phase2: opts.block3Phase2 ?? false })
  opts.beforeConnect?.(mock)
  const t = await openTestApi({ fetch: mock.fetch, now })
  const target = { baseUrl: 'http://localhost:8787/api/v1', apiKey: MOCK_API_KEY }
  // what the setup screen does (Task 13 · spec §4.4 ข้อ 6): "ทดสอบกุญแจ" shows dayo's last Z, the owner confirms that number
  const probe = await t.api.probeDayo(target)
  await t.api.connectShop({ ...target, receiptPrefix: 'A', ownerStaffId: STAFF.TungAo, ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null, confirmedLastZNo: probe.lastZNo ?? null })
  const other = await t.api.setStaffPin({ staffId: STAFF.DCm, pin: '2222', approverUserId: STAFF.TungAo, approverPin: '1111' })
  const boot = await t.api.bootstrap()
  const shift = opts.openShift === false ? null : await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
  return { ...t, mock, owner: boot.users.find((u) => u.id === STAFF.TungAo)!, other, device: boot.device!, shift }
}
