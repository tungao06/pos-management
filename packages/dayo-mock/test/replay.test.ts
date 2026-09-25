import { describe, expect, it } from 'vitest'
import { header, type CentralOrder, type OrderRowData } from '@dayo/contracts'
import { listContractFixtures, loadContractFixture } from '@dayo/contracts/fixture-files'
import { basename } from 'node:path'
import { createMockDayo, type MockDayo, type MockMode } from '../src/index.js'

type Fx = ReturnType<typeof loadContractFixture>
const accepted = loadContractFixture('e2-order-accepted')
const acceptedRow = (accepted.request.body as { rows: { key: string; kind: 'order'; data: OrderRowData }[] }).rows[0]!
const acceptedResult = (accepted.response.body as { data: { results: { data: Record<string, unknown> }[] } }).data.results[0]!.data

/** State dayo's harness gets from `rpc`, recreated on the mock (never by editing the fixture). */
const SETUP: Partial<Record<string, (m: MockDayo, fx: Fx) => void>> = {
  'e2-order-accepted': (m) => {
    m.setNextOrderNo('2026-09-25', 14)
    // the fixture's duplicate_of ["L260925-013"] = a bot bill of the same total within 10 minutes that dayo's DB already holds
    m.seedCentralOrders([{ order_no: 'L260925-013', sale_date: '2026-09-25', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'store', payment: 'cash', totals: { items_subtotal: 155, items_discount: 0, bill_discount: 0, total: 155, fee: 0 }, amount_mismatch: false, updated_at: null, sold_at: '2026-09-25T03:10:00+00:00', created_by_name: 'TungAo' } satisfies CentralOrder])
  },
  'e2-order-duplicate': (m) => m.preloadAccepted(acceptedRow, acceptedResult),
  'e2-key-reused-different-content': (m) => m.preloadAccepted(acceptedRow, acceptedResult),
  'e2-receipt-conflict': (m) => m.preloadOrder({ posOrderId: acceptedRow.data.pos_order_id, receiptNo: 'A-000312', saleDate: '2026-09-25', soldAt: '2026-09-25T03:15:03.120Z', orderNo: 'L260925-014', total: 155 }),
  'e2-unknown-code-other-row-ok': (m) => m.setNextOrderNo('2026-09-25', 20),
  'e2-order-and-void-same-batch': (m) => m.setNextOrderNo('2026-09-25', 30),
  'e2-void-cross-day': (m) => m.preloadOrder({ posOrderId: '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a', receiptNo: 'A-000300', saleDate: '2026-09-25', soldAt: '2026-09-25T05:00:00.000Z', orderNo: 'L260925-040', total: 35 }),
  'e2-row-server-error': (m) => {
    m.override({ match: { key: 'order:8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f' }, verdict: { status: 'deferred', reason: 'SERVER_ERROR', detail: 'SQLSTATE XX000' }, times: 1 })
    m.setNextOrderNo('2026-09-25', 51)
    m.seedCentralOrders([{ order_no: 'L260925-049', sale_date: '2026-09-25', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'store', payment: 'qr', totals: { items_subtotal: 35, items_discount: 0, bill_discount: 0, total: 35, fee: 0 }, amount_mismatch: false, updated_at: null, sold_at: '2026-09-25T07:55:00+00:00', created_by_name: 'TungAo' } satisfies CentralOrder])
  },
}

function mockFor(fx: Fx): MockDayo {
  const auth = fx.rpc?.['api_authenticate'] as { ok?: boolean; scopes?: string[]; retry_after?: number; error?: { code: string; message: string }; $throw?: string } | undefined
  const mode: MockMode = fx.env['API_V1_ENABLED'] !== '1' ? 'api_disabled'
    : auth?.$throw !== undefined ? 'server_down'
    : auth?.error?.code === 'DY429' ? 'rate_limited'
    : auth?.ok === true && fx.request.path.startsWith('/api/v1/pos/catalog') && !(auth.scopes ?? []).includes('staff:read') ? 'forbidden'
    : 'normal'
  const data = (fx.response.body as { data?: Record<string, unknown> } | undefined)?.data
  const now = typeof data?.['server_time'] === 'string' ? (data['server_time'] as string) : '2026-09-25T02:00:00.120Z'
  const manifest = fx.env['DAYO_PRICING_MANIFEST'] as { commit: string; files_sha256: Record<string, string> } | undefined
  const m = createMockDayo({
    apiKey: 'dayo_fixture_key_0001', origins: String(fx.env['POS_ORIGINS'] ?? '').split(','), now, mode,
    retryAfterSec: auth?.retry_after ?? 30, forbiddenMessage: 'forbidden: API key ไม่มีสิทธิ์ staff:read',
    ...(fx.name === 'e1-catalog-changed' ? { catalog: data as never } : {}),
    ...(manifest === undefined ? {} : { pricing: manifest }),
    ...(fx.name === 'e3-orders-today' ? { seedOrders: (data as unknown as CentralOrder[]) } : {}),
  })
  SETUP[fx.name]?.(m, fx)
  return m
}

for (const file of listContractFixtures()) {
  const fx = loadContractFixture(basename(file, '.json'))
  describe(`replay ${fx.name}`, () => {
    it('the mock answers exactly as the contract fixture says', async () => {
      const m = mockFor(fx)
      const res = await m.handle(new Request(`http://mock${fx.request.path}`, {
        method: fx.request.method, headers: fx.request.headers ?? {},
        ...(fx.request.body === undefined ? {} : { body: JSON.stringify(fx.request.body) }),
      }))
      expect(res.status).toBe(fx.response.status)
      for (const [h, v] of Object.entries(fx.response.headers ?? {})) expect(res.headers.get(h), h).toBe(v)
      for (const h of fx.response.headers_absent ?? []) expect(res.headers.get(h), h).toBeNull()
      const text = await res.text()
      expect(text === '' ? undefined : JSON.parse(text)).toEqual(fx.response.body)
      void header
    })
  })
}
