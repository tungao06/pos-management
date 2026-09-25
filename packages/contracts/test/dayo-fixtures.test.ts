import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ApiErrorBody, OrdersListResponse, PosCatalogResponse, PushEnvelope, PushResponse } from '../src/dayo-api.js'
import { CONTRACT_FIXTURE_NAMES, header, PosContractFixture } from '../src/dayo-fixture.js'
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

it('an unknown path under /api/v1 is a 404 that still carries CORS (err-404-unknown-path, spec §4.1)', () => {
  const fx = loadContractFixture('err-404-unknown-path')
  expect(fx.response.status).toBe(404)
  expect(ApiErrorBody.parse(fx.response.body).error.message).toBe('not_found')
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
        expect(header(fx.response.headers, 'Access-Control-Expose-Headers')).toBe('Retry-After')
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
      else {
        const got = PushResponse.parse(rs.body)
        const sent = PushEnvelope.parse(rq.body)
        expect(got.data.results.map((r) => r.key)).toEqual(sent.rows.map((r) => (r as { key: string }).key)) // same order, same count (spec §4.5)
      }
    })
  })
}
