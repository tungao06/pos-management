import { describe, expect, it } from 'vitest'
import { loadContractFixture } from '@dayo/contracts/fixture-files'
import { createMockDayo, MOCK_API_KEY } from '../src/index.js'

const auth = { authorization: `Bearer ${MOCK_API_KEY}`, origin: 'http://localhost:4173' }
const acceptedBody = () => JSON.stringify({ ...(loadContractFixture('e2-order-accepted').request.body as object) })

describe('mock dayo', () => {
  it('bumpCatalog makes the next known_version call answer changed:true with the new version', async () => {
    const m = createMockDayo({ now: '2026-09-25T02:00:00.000Z' })
    const v = m.bumpCatalog((c) => { c.catalog.variants[0]!.price = 40 })
    const body = await (await m.fetch('http://mock/api/v1/pos/catalog?known_version=42', { headers: auth })).json() as { data: { changed: boolean; catalog_version: number } }
    expect(body.data).toMatchObject({ changed: true, catalog_version: v })
    expect(v).toBe(43)
  })
  it('an override answers once, then the real rule applies', async () => {
    const m = createMockDayo({ now: '2026-09-25T03:15:04.010Z' })
    m.override({ match: { receiptNo: 'A-000312' }, verdict: { status: 'rejected', reason: 'CONFLICT', detail: 'forced' }, times: 1 })
    const send = async () => (await (await m.fetch('http://mock/api/v1/pos/push', { method: 'POST', headers: auth, body: acceptedBody() })).json()) as { data: { results: { status: string }[] } }
    expect((await send()).data.results[0]!.status).toBe('rejected')
    expect((await send()).data.results[0]!.status).toBe('accepted')
  })
  it('hang never answers until the caller aborts', async () => {
    const m = createMockDayo({ mode: 'hang' })
    const ac = new AbortController()
    const p = m.fetch('http://mock/api/v1/pos/catalog', { headers: auth, signal: ac.signal })
    ac.abort(new Error('timeout'))
    await expect(p).rejects.toThrow()
  })
  it('a body over 262,144 UTF-8 bytes is a 422 envelope error', async () => {
    const m = createMockDayo()
    const huge = JSON.stringify({ device_time: '2026-09-25T03:15:03.120Z', rows: [{ pad: 'ก'.repeat(90_000) }] }) // 270,000 bytes in UTF-8
    expect((await m.fetch('http://mock/api/v1/pos/push', { method: 'POST', headers: auth, body: huge })).status).toBe(422)
  })
  it('a sale_date after today (crossing midnight inside the 5-minute grace) is deferred CLOCK_AHEAD (block-1 interpretation 3)', async () => {
    const m = createMockDayo({ now: '2026-09-25T16:58:00.000Z' }) // 23:58 Bangkok
    const b = JSON.parse(acceptedBody()) as { rows: { data: Record<string, unknown> }[] }
    b.rows[0]!.data['sold_at'] = '2026-09-25T17:01:00.000Z'; b.rows[0]!.data['sale_date'] = '2026-09-26' // 00:01 next day, +3 min
    const r = await (await m.fetch('http://mock/api/v1/pos/push', { method: 'POST', headers: auth, body: JSON.stringify(b) })).json() as { data: { results: { status: string; reason: string }[] } }
    expect(r.data.results[0]).toMatchObject({ status: 'deferred', reason: 'CLOCK_AHEAD' })
  })
  it('an unknown sub-key of totals is rejected INVALID — dayo checks sub-keys in dayo_pos_order, not the field list (0052:313-343, over block-1 interpretation 5)', async () => {
    const m = createMockDayo({ now: '2026-09-25T03:15:04.010Z' })
    const b = JSON.parse(acceptedBody()) as { rows: { data: { totals: Record<string, unknown> } }[] }
    b.rows[0]!.data.totals['service'] = 0
    const r = await (await m.fetch('http://mock/api/v1/pos/push', { method: 'POST', headers: auth, body: JSON.stringify(b) })).json() as { data: { results: { reason: string }[] } }
    expect(r.data.results[0]!.reason).toBe('INVALID')
  })
})
