import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ApiErrorBody, BLOCK3_PHASE1_KINDS, BLOCK3_PHASE1_SUPPORTED_FIELDS, BLOCK3_PHASE2_KINDS, CashCountAcceptedData, CashMovementAcceptedData, detailPrefix,
  ExistsConflictData, KIND_ID_FIELD, OffCatalogAcceptedData, OrderAcceptedData, OrdersListResponse, PosCatalogResponse, PushEnvelope, PushRequest, PushResponse,
  ShiftCashResponse, ShiftCloseAcceptedData, ShiftOpenAcceptedData, supportedOf, type PushKind,
} from '../src/dayo-api.js'
import { BLOCK3_FIXTURE_NAMES, BLOCK3_PHASE2_FIXTURE_NAMES, CONTRACT_FIXTURE_NAMES, header, PosContractFixture } from '../src/dayo-fixture.js'
import { contractFixtureHashes, fixtureSha256, listContractFixtures, loadContractFixture } from '../src/dayo-fixture-files.js'

it('holds exactly the contract fixtures CONTRACT_FIXTURE_NAMES lists (block-1 plan Task 6 — no count written here, N1)', () => {
  expect(listContractFixtures().map((f) => basename(f, '.json'))).toEqual([...CONTRACT_FIXTURE_NAMES])
  expect(new Set(CONTRACT_FIXTURE_NAMES).size).toBe(CONTRACT_FIXTURE_NAMES.length)
  expect([...CONTRACT_FIXTURE_NAMES]).toEqual([...CONTRACT_FIXTURE_NAMES].sort())
})

it('the fixture folder pins LF line ends like dayo (N6)', () => {
  expect(readFileSync(fileURLToPath(new URL('../fixtures/dayo-api/.gitattributes', import.meta.url)), 'utf8').trim()).toBe('*.json text eol=lf')
})

it('fixture hashes ignore CRLF vs LF (D82) and report a missing file', () => {
  expect(fixtureSha256(Buffer.from('{\r\n"a":1\r\n}\r\n'))).toBe(fixtureSha256(Buffer.from('{\n"a":1\n}\n')))
  const all = contractFixtureHashes()
  expect(all.map((h) => h.name)).toEqual([...CONTRACT_FIXTURE_NAMES])
  expect(all.every((h) => h.sha256 !== null && /^[0-9a-f]{64}$/.test(h.sha256))).toBe(true)
  expect(contractFixtureHashes(tmpdir()).every((h) => h.sha256 === null)).toBe(true)
})

it('no fixture expects Cache-Control: spec 04 does not ask for it and dayo main does not send it (Task 19 report #1-4)', () => {
  for (const file of listContractFixtures()) {
    const fx = loadContractFixture(basename(file, '.json'))
    expect(header(fx.response.headers, 'Cache-Control'), fx.name).toBeUndefined()
  }
})

it('preflight-allowed-api-off allows Authorization, Content-Type and Idempotency-Key (spec 04 §4.1, S9) and no Expose-Headers', () => {
  const fx = loadContractFixture('preflight-allowed-api-off')
  expect(header(fx.response.headers, 'Access-Control-Allow-Headers')).toBe('Authorization, Content-Type, Idempotency-Key')
  expect(header(fx.response.headers, 'Access-Control-Expose-Headers')).toBeUndefined()
  expect(fx.response.headers_absent).toContain('Access-Control-Expose-Headers')
})

it('an unknown path under /api/v1 is a 404 that still carries CORS (err-404-unknown-path, spec §4.1)', () => {
  const fx = loadContractFixture('err-404-unknown-path')
  expect(fx.response.status).toBe(404)
  expect(ApiErrorBody.parse(fx.response.body).error.message).toBe('not_found')
  // a path dayo really lacks: E4 shift-cash exists since dayo 0067 (plan 09 Task 6 review), pos/profit-view since block 2
  const routes = ['/api/v1/pos/catalog', '/api/v1/pos/push', '/api/v1/pos/shift-cash', '/api/v1/pos/profit-view', '/api/v1/orders', '/api/v1/catalog', '/api/v1/promotions', '/api/v1/stock', '/api/v1/docs']
  expect(routes.filter((r) => fx.request.path.split('?')[0]!.startsWith(r))).toEqual([])
})

for (const file of listContractFixtures()) {
  describe(basename(file), () => {
    const fx = PosContractFixture.parse(JSON.parse(readFileSync(file, 'utf8')))
    const origins = String(fx.env['POS_ORIGINS'] ?? '').split(',')
    const origin = header(fx.request.headers, 'Origin')
    const allowed = origin !== undefined && origins.includes(origin)
    it('file name = fixture name', () => { expect(`${fx.name}.json`).toBe(basename(file)) })
    it('CORS on every answer from an allowed origin, errors included; none for other origins (spec §4.1)', () => {
      expect(header(fx.response.headers, 'Vary')).toBe('Origin')
      if (allowed) {
        expect(header(fx.response.headers, 'Access-Control-Allow-Origin')).toBe(origin)
        // Expose-Headers is for the real (non-preflight) answer only: it does nothing on OPTIONS (dayo cors.ts:69-82 · Task 19 report #7)
        if (fx.request.method === 'OPTIONS') expect(fx.response.headers_absent).toContain('Access-Control-Expose-Headers')
        else expect(header(fx.response.headers, 'Access-Control-Expose-Headers')).toBe('Retry-After')
      } else {
        expect(fx.response.headers_absent).toContain('Access-Control-Allow-Origin')
      }
    })
    it('the body follows the POS contract for its path and status', () => {
      const { request: rq, response: rs } = fx
      if (rq.method === 'OPTIONS') { expect(rs.status).toBe(204); expect(rs.body).toBeUndefined(); return }
      if (rs.status !== 200) {
        ApiErrorBody.parse(rs.body)
        if (rs.status === 429) expect(Number(header(rs.headers, 'Retry-After'))).toBeGreaterThan(0)
        return
      }
      if (rq.path.startsWith('/api/v1/pos/catalog')) PosCatalogResponse.parse(rs.body)
      else if (rq.path.startsWith('/api/v1/orders')) OrdersListResponse.parse(rs.body)
      else if (rq.path.startsWith('/api/v1/pos/shift-cash')) ShiftCashResponse.parse(rs.body)
      else {
        const got = PushResponse.parse(rs.body)
        const sent = PushEnvelope.parse(rq.body)
        expect(got.data.results.map((r) => r.key)).toEqual(sent.rows.map((r) => (r as { key: string }).key)) // same order, same count (spec §4.5)
      }
    })
  })
}

// ── block 3 (plan 09 Task 7 · spec 04 §4.10 · §4.11 rule 2 · D84): the POS owns these; dayo replays them (plan 08) ──────────
const DEVICE_TIME = '2026-09-25T12:10:00.000Z'
const SERVER_TIME = '2026-09-25T12:10:00.410+00:00'
const PHASE2 = new Set<string>(BLOCK3_PHASE2_FIXTURE_NAMES)
type Result = { key: string; status: string; reason?: string; detail?: string; data?: unknown }
const bodyData = (fx: PosContractFixture): Record<string, unknown> => (fx.response.body as { data: Record<string, unknown> }).data
const scopesOf = (fx: PosContractFixture): string[] => (fx.rpc?.['api_authenticate'] as { scopes: string[] }).scopes
const ACCEPTED: Record<PushKind, { parse: (v: unknown) => unknown }> = {
  order: OrderAcceptedData, order_void: OrderAcceptedData, shift_open: ShiftOpenAcceptedData, cash_movement: CashMovementAcceptedData,
  cash_count: CashCountAcceptedData, shift_close: ShiftCloseAcceptedData, order_off_catalog: OffCatalogAcceptedData,
}
const ID_ONLY_KINDS: readonly PushKind[] = BLOCK3_PHASE1_KINDS

describe('block 3 contract fixtures (plan 09 Task 7)', () => {
  it('are named in CONTRACT_FIXTURE_NAMES, sorted; the phase-2 ones are a subset (preflight P3)', () => {
    expect(BLOCK3_FIXTURE_NAMES.filter((n) => !(CONTRACT_FIXTURE_NAMES as readonly string[]).includes(n))).toEqual([])
    expect([...BLOCK3_FIXTURE_NAMES]).toEqual([...BLOCK3_FIXTURE_NAMES].sort())
    expect(BLOCK3_PHASE2_FIXTURE_NAMES.filter((n) => !(BLOCK3_FIXTURE_NAMES as readonly string[]).includes(n))).toEqual([])
  })

  describe.each([...BLOCK3_FIXTURE_NAMES])('%s', (name) => {
    const fx = loadContractFixture(name)
    it('the key holds shift:write — except the scope fixture', () => {
      expect(scopesOf(fx).includes('shift:write')).toBe(name !== 'e2-shift-scope-forbidden')
    })
    it('phase-2 fixtures say so in `spec`; the others send only kinds dayo 12885fe advertises', () => {
      expect(fx.spec.includes('ระยะ 2')).toBe(PHASE2.has(name))
      if (PHASE2.has(name) || fx.request.method !== 'POST') return
      const phase1: readonly string[] = ['order', 'order_void', ...BLOCK3_PHASE1_KINDS]
      expect((fx.request.body as { rows: { kind: string }[] }).rows.filter((r) => !phase1.includes(r.kind))).toEqual([])
    })
    if (fx.request.method !== 'POST') return
    it('every row is one the tablet would send (PushRequest, strict) · the common clocks', () => {
      const sent = PushRequest.parse(fx.request.body)
      expect(sent.device_time).toBe(DEVICE_TIME)
      expect(bodyData(fx)['server_time']).toBe(SERVER_TIME)
    })
    it('accepted data = the kind\'s own shape · a rejection carries a machine prefix · exists data parses', () => {
      const rows = PushRequest.parse(fx.request.body).rows
      const results = bodyData(fx)['results'] as Result[]
      expect(results.map((r) => r.key)).toEqual(rows.map((r) => r.key))
      rows.forEach((row, i) => {
        const r = results[i]!
        if (r.status === 'accepted') {
          ACCEPTED[row.kind].parse(r.data)
          const idField = KIND_ID_FIELD[row.kind]
          if (ID_ONLY_KINDS.includes(row.kind)) expect(r.data).toEqual({ [idField]: (row.data as Record<string, unknown>)[idField] }) // §4.10 · C32: {id} only
          return
        }
        expect(r.status).toBe('rejected')
        const prefix = detailPrefix(r.detail)
        expect(prefix).not.toBeNull()
        if (prefix === 'exists:' || prefix === 'off_catalog_exists:') ExistsConflictData.parse(r.data)
        else expect(r.data).toBeUndefined()
      })
    })
  })

  it('e1-catalog-changed-block3 = e1-catalog-changed + the 4 shift kinds and their fields (dayo 0066:594-606, as sets) + client.last_z_* (0067)', () => {
    const b2 = bodyData(loadContractFixture('e1-catalog-changed'))
    const b3 = PosCatalogResponse.parse(loadContractFixture('e1-catalog-changed-block3').response.body).data
    if (!b3.changed) throw new Error('changed:true expected')
    expect(b3.supported_kinds).toEqual([...(b2['supported_kinds'] as string[]), ...BLOCK3_PHASE1_KINDS])
    expect(b3.supported_kinds.filter((k) => (BLOCK3_PHASE2_KINDS as readonly string[]).includes(k))).toEqual([])
    const sorted = (f: Readonly<Record<string, readonly string[]>>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, [...v].sort()]))
    expect(Object.keys(b3.supported_fields).sort()).toEqual(Object.keys(supportedOf(b3.supported_kinds, b3.supported_fields).fields).sort()) // every value a field list
    expect(sorted(supportedOf(b3.supported_kinds, b3.supported_fields).fields)).toEqual(sorted({ ...(b2['supported_fields'] as Record<string, string[]>), ...BLOCK3_PHASE1_SUPPORTED_FIELDS }))
    expect(b3.client).toEqual({ ...(b2['client'] as object), last_z_no: 41, last_z_hash: 'ab'.repeat(32), last_z_until: '2026-09-24T12:00:00.000+00:00' })
    for (const k of ['changed', 'pricing', 'catalog_version', 'staff', 'catalog']) expect((b3 as Record<string, unknown>)[k], k).toEqual(b2[k])
    expect(b3.server_time).toBe(SERVER_TIME)
  })

  it('e2-order-off-catalog-rule sends a bill ฿0.01 above the default off-catalog cap (D103: ฿3,000)', () => {
    const row = PushRequest.parse(loadContractFixture('e2-order-off-catalog-rule').request.body).rows[0]!
    expect(row.kind).toBe('order_off_catalog')
    expect((row.data as { totals: { total: number } }).totals.total).toBe(3000.01)
  })

  it('e4-shift-cash asks for (after, until] and gets dayo\'s …mmm+00:00 sold_at (0067:66)', () => {
    const fx = loadContractFixture('e4-shift-cash')
    expect(fx.request.method).toBe('GET')
    expect(fx.request.path).toBe('/api/v1/pos/shift-cash?after=2026-09-24T17:00:00.000Z&until=2026-09-25T12:00:00.000Z')
    const d = ShiftCashResponse.parse(fx.response.body).data
    expect(d.bills.map((b) => b.sold_at)).toEqual(['2026-09-25T04:00:00.000+00:00'])
    expect(d.cash_total).toBe(d.bills.reduce((a, b) => a + b.total, 0))
  })

  it('e4-shift-cash carries data.server_time in the dayo …mmm+00:00 form (0076:50-52)', () => {
    expect(bodyData(loadContractFixture('e4-shift-cash'))['server_time']).toBe(SERVER_TIME)
  })
})
