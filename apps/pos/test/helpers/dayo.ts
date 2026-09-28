import { createMockDayo, MOCK_API_KEY, type MockDayo } from '@dayo/dayo-mock'
import { openTestApi, type ReadyApi } from './db'

/** UUIDs of packages/contracts/fixtures/pos-test/e1-catalog-rich.json (Task 6) */
export const STAFF = {
  TungAo: '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f', DCm: '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d', Beam: '2c3d4e5f-6071-4283-94a5-b6c7d8e9f0a1',
  Mint: '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0', Unnamed: '4e5f6071-8293-44a5-b6c7-d8e9f0a1b2c3', Old: '3d4e5f60-7182-4394-a5b6-c7d8e9f0a1b2',
} as const

/** A device linked to the mock dayo: TungAo (owner, PIN 1111) + DCm (owner, PIN 2222) + an open shift with a 500 baht float. */
export async function openConnectedApi(opts: { now?: string } = {}): Promise<ReadyApi & { mock: MockDayo }> {
  const now = opts.now ?? '2026-09-25T03:00:00.000Z'
  const mock = createMockDayo({ now })
  const t = await openTestApi({ fetch: mock.fetch, now })
  await t.api.connectShop({ baseUrl: 'http://localhost:8787/api/v1', apiKey: MOCK_API_KEY, receiptPrefix: 'A', ownerStaffId: STAFF.TungAo, ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null })
  const other = await t.api.setStaffPin({ staffId: STAFF.DCm, pin: '2222', approverUserId: STAFF.TungAo, approverPin: '1111' })
  const boot = await t.api.bootstrap()
  const shift = await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
  return { ...t, mock, owner: boot.users.find((u) => u.id === STAFF.TungAo)!, other, device: boot.device!, shift }
}
