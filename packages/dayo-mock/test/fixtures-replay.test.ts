// Block 3 contract fixtures (plan 09 Task 7 · spec 04 §4.11 rule 2 · D84) replayed on the block 3 mock. The mock is dayo main
// 12885fe (ADR-0069 phase 1 — preflight P3); the phase-2 files (order_off_catalog, prefixes on order rows) run on
// `block3Phase2` with Task 8's off-catalog judge. The block-2 files stay in replay.test.ts.
import { describe, expect, it } from 'vitest'
import { BLOCK3_FIXTURE_NAMES, BLOCK3_PHASE2_FIXTURE_NAMES, type CentralOrder, type PosContractFixture } from '@dayo/contracts'
import { loadContractFixture } from '@dayo/contracts/fixture-files'
import { createMockDayo, type MockDayo } from '../src/index.js'

const NOW = '2026-09-25T12:10:00.410Z' // = the fixtures' server_time
const KEY = 'dayo_fixture_key_0001'
const ORIGIN = 'https://pos.dayo.test'
const PHASE2 = new Set<string>(BLOCK3_PHASE2_FIXTURE_NAMES)

// the shared values of the block 3 fixtures (= Task 5's SAMPLE in packages/contracts/test/dayo-api-block3.test.ts)
const S = '5a5a5a5a-0000-4000-8000-000000000001'
const S2 = '5a5a5a5a-0000-4000-8000-000000000002'
const U = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'
const O = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21'
const C = '7c7c7c7c-0000-4000-8000-000000000001'
const C2 = '7c7c7c7c-0000-4000-8000-000000000002'
const H = 'ab'.repeat(32)
const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 2, 1]
const lines = (counts: Record<number, number>) => DENOMS.map((d) => ({ denomination: d, count: counts[d] ?? 0 }))
const SHIFT_OPEN = { shift_id: S, business_date: '2026-09-25', opened_at: '2026-09-25T02:00:00.000Z', opened_by: U, opening_float: 500, quick_open: false }
const CASH_COUNT = { count_id: C, shift_id: S, lines: lines({ 500: 1, 100: 1, 10: 1, 5: 1 }), counted: 615, counted_by: U, counted_at: '2026-09-25T12:00:00.000Z' }
const SHIFT_OPEN_2 = { shift_id: S2, business_date: '2026-09-25', opened_at: '2026-09-25T12:06:00.000Z', opened_by: U, opening_float: 500, quick_open: false }
const CASH_COUNT_2 = { count_id: C2, shift_id: S2, lines: lines({ 500: 1 }), counted: 500, counted_by: U, counted_at: '2026-09-25T12:08:00.000Z' }
const sampleShiftClose = () => (loadContractFixture('e2-shift-close-accepted').request.body as { rows: unknown[] }).rows[0]!
const rowsOf = (name: string) => (loadContractFixture(name).request.body as { rows: { key: string; kind: string; data: Record<string, unknown> }[] }).rows
/** The normal `order` row of bill O (฿70 cash) — the exists-order fixture's request. */
const orderRowO = () => rowsOf('e2-order-off-catalog-exists-order')[0]!
/** e2-order-accepted's `duplicate_of` bot bill (replay.test.ts SETUP) — the scope fixture sends that same order row. */
const BOT_013: CentralOrder = { order_no: 'L260925-013', sale_date: '2026-09-25', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'store', payment: 'cash', totals: { items_subtotal: 155, items_discount: 0, bill_discount: 0, total: 155, fee: 0 }, amount_mismatch: false, updated_at: null, sold_at: '2026-09-25T03:10:00+00:00', created_by_name: 'TungAo' }
/** The bot cash bill E4 finds in (after, until] and the shift_close fixture's z_report.bot_bills names. */
const BOT_901: CentralOrder = { order_no: 'L260925-901', sale_date: '2026-09-25', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'line', payment: 'cash', totals: { items_subtotal: 70, items_discount: 0, bill_discount: 0, total: 70, fee: 0 }, amount_mismatch: false, updated_at: null, sold_at: '2026-09-25T04:00:00+00:00', created_by_name: 'DCm' }
const row = (kind: string, id: string, data: unknown) => ({ key: `${kind}:${id}`, kind, data })

async function send(mock: MockDayo, method: string, path: string, body?: unknown): Promise<Response> {
  return mock.handle(new Request(`http://mock${path}`, {
    method, headers: { Origin: ORIGIN, Authorization: `Bearer ${KEY}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
}
/** Pre-state by pushing rows the normal way — each must be accepted, so a broken arrangement fails loudly here. */
async function pushAccepted(mock: MockDayo, rows: unknown[]): Promise<void> {
  const res = await send(mock, 'POST', '/api/v1/pos/push', { device_time: '2026-09-25T12:10:00.000Z', rows })
  const results = ((await res.json()) as { data: { results: { key: string; status: string; detail?: string }[] } }).data.results
  expect(results.filter((r) => r.status !== 'accepted')).toEqual([])
}

/**
 * S1 of an off-catalog bill, the way dayo gets there: the shop's first shift_open sets block3_live_from (2026-09-25, D100) and
 * dayo rejects the bill's `order` row UNKNOWN_CODE (a menu code the shop never had) — pos_push_rejections records it.
 */
async function offCatalogReady(mock: MockDayo, posOrderId: string, receiptNo: string): Promise<void> {
  await pushAccepted(mock, [row('shift_open', S, SHIFT_OPEN)])
  const d = { ...orderRowO().data, pos_order_id: posOrderId, receipt_no: receiptNo, lines: [{ code: 'Retired Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1 }] }
  const res = await send(mock, 'POST', '/api/v1/pos/push', { device_time: '2026-09-25T12:10:00.000Z', rows: [row('order', posOrderId, d)] })
  expect(((await res.json()) as { data: { results: unknown[] } }).data.results).toEqual([{ key: `order:${posOrderId}`, status: 'rejected', reason: 'UNKNOWN_CODE', detail: 'ไม่พบเมนู "Retired Tea"' }])
}

/** The state dayo's harness gets from `rpc`, recreated on the mock by its own API (never by editing the fixture). */
async function arrangeBlock3(mock: MockDayo, name: string): Promise<void> {
  switch (name) {
    case 'e1-catalog-changed-block3':
      mock.preloadZ({ zNo: 41, hash: H, countedAt: '2026-09-24T12:00:00.000Z' }) // an earlier Z of this key → E1 last_z_* (0067:134-155)
      return
    case 'e2-shift-rows-accepted':
      return
    case 'e2-shift-scope-forbidden':
      mock.setNextOrderNo('2026-09-25', 14)
      mock.seedCentralOrders([BOT_013])
      return
    case 'e2-cash-count-counted-conflict':
    case 'e2-shift-close-accepted':
      await pushAccepted(mock, [row('shift_open', S, SHIFT_OPEN), row('cash_count', C, CASH_COUNT)])
      return
    case 'e2-shift-close-z-no-taken':
      await pushAccepted(mock, [row('shift_open', S, SHIFT_OPEN), row('cash_count', C, CASH_COUNT), sampleShiftClose(), row('shift_open', S2, SHIFT_OPEN_2), row('cash_count', C2, CASH_COUNT_2)])
      return
    case 'e4-shift-cash':
      mock.seedCentralOrders([BOT_901])
      return
    // phase 2 (block3Phase2 · the off-catalog judge of Task 8)
    case 'e2-order-off-catalog-accepted':
      await offCatalogReady(mock, O, 'A-000001')
      mock.setNextOrderNo('2026-09-25', 15)
      return
    case 'e2-order-off-catalog-exists': // the bill is already a normal bill of dayo: L260925-014, ฿70 cash (its order row accepted)
      mock.setNextOrderNo('2026-09-25', 14)
      await pushAccepted(mock, [orderRowO()])
      return
    case 'e2-order-off-catalog-rule': // every S1 condition holds but the cap: ฿3,000.01 > the D103 default ฿3,000 (never set here)
      await offCatalogReady(mock, '0b0b0b0b-0000-4000-8000-000000000004', 'A-000004')
      return
    case 'e2-order-off-catalog-exists-order': // the bill is already an off-catalog bill of dayo (L260925-015)
      await offCatalogReady(mock, O, 'A-000001')
      mock.setNextOrderNo('2026-09-25', 15)
      await pushAccepted(mock, rowsOf('e2-order-off-catalog-accepted'))
      return
    default:
      throw new Error(`arrangeBlock3: no arrangement for ${name}`)
  }
}

function mockFor(fx: PosContractFixture): MockDayo {
  const auth = fx.rpc?.['api_authenticate'] as { scopes: string[] }
  const manifest = fx.env['DAYO_PRICING_MANIFEST'] as { commit: string; files_sha256: Record<string, string> } | undefined
  // E1: the block-2 answer of e1-catalog-changed is the mock's catalog — block 3 must only ADD to it (kinds, fields, last_z_*)
  const block2Catalog = (loadContractFixture('e1-catalog-changed').response.body as { data: unknown }).data
  return createMockDayo({
    apiKey: KEY, origins: String(fx.env['POS_ORIGINS'] ?? '').split(','), now: NOW, scopes: auth.scopes,
    ...(PHASE2.has(fx.name) ? { block3Phase2: true } : { block3: true }),
    ...(manifest === undefined ? {} : { pricing: manifest }),
    ...(fx.name === 'e1-catalog-changed-block3' ? { catalog: structuredClone(block2Catalog) as never } : {}),
  })
}

/** dayo does not sort supported_fields (0066:603-606) — they are sets; everything else must match exactly. */
function normalize(body: unknown): unknown {
  const b = structuredClone(body) as { data?: { supported_fields?: Record<string, string[]> } }
  const f = b.data?.supported_fields
  if (f !== undefined) for (const k of Object.keys(f)) f[k] = [...f[k]!].sort()
  return b
}

async function replay(name: string): Promise<void> {
  const fx = loadContractFixture(name)
  const mock = mockFor(fx)
  await arrangeBlock3(mock, name)
  const res = await send(mock, fx.request.method, fx.request.path, fx.request.body)
  expect(res.status).toBe(fx.response.status)
  for (const [h, v] of Object.entries(fx.response.headers ?? {})) expect(res.headers.get(h), h).toBe(v)
  for (const h of fx.response.headers_absent ?? []) expect(res.headers.get(h), h).toBeNull()
  expect(normalize(await res.json())).toEqual(normalize(fx.response.body))
}

describe('block 3 contract fixtures replay on the mock', () => {
  it.each(BLOCK3_FIXTURE_NAMES.filter((n) => !PHASE2.has(n)))('%s (phase 1): status, headers, verdicts, details and data', replay)
  it.each([...BLOCK3_PHASE2_FIXTURE_NAMES])('%s (phase 2): status, headers, verdicts, details and data', replay)
})
