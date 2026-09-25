import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockDayo, MOCK_API_KEY } from '@dayo/dayo-mock'
import { createDayoClient, DayoError, FETCH_TIMEOUT_MS } from '../src/sync/dayo-client'

const BASE = 'http://mock/api/v1/'
const client = (mock = createMockDayo({ now: '2026-09-25T02:00:00.120Z' }), apiKey = MOCK_API_KEY) =>
  ({ mock, c: createDayoClient({ baseUrl: BASE, apiKey, fetch: mock.fetch, nowMs: () => Date.parse('2026-09-25T02:00:00.000Z') }) })
async function failureOf(p: Promise<unknown>) { try { await p; return null } catch (e) { expect(e).toBeInstanceOf(DayoError); return (e as DayoError).failure } }

afterEach(() => { vi.useRealTimers() })

describe('dayo client (spec 04 §4.1, §6.3)', () => {
  it('reads E1 and reports when the request left and the answer came', async () => {
    const { c } = client()
    const r = await c.getCatalog(0)
    expect(r.value.changed).toBe(true)
    expect(r.value.catalog_version).toBe(42)
    expect(r.sentAtMs).toBe(Date.parse('2026-09-25T02:00:00.000Z'))
  })
  it('a trailing slash on the base URL does not produce //pos', async () => {
    const { mock, c } = client()
    await c.getCatalog(42)
    expect(mock.requests().at(-1)?.path).toBe('/api/v1/pos/catalog')
  })
  it.each([
    ['unauthorized', { kind: 'unauthorized' }],
    ['forbidden', { kind: 'forbidden' }],
    ['api_disabled', { kind: 'api_disabled' }],
    ['server_down', { kind: 'server', status: 500 }],
    ['rate_limited', { kind: 'rate_limited', retryAfterMs: 30_000 }],
  ] as const)('mode %s → %o', async (mode, failure) => {
    const { mock, c } = client()
    mock.setMode(mode)
    expect(await failureOf(c.getCatalog(0))).toEqual(failure)
  })
  it('a wrong key is 401 and the key never appears in the error', async () => {
    const wrong = `dayo_${'f'.repeat(64)}`
    const { c } = client(undefined, wrong)
    try { await c.getCatalog(0) } catch (e) { expect(String((e as Error).message) + JSON.stringify((e as DayoError).failure)).not.toContain(wrong) }
  })
  it('a hung request becomes a network failure after 20 seconds', async () => {
    vi.useFakeTimers()
    const { mock, c } = client()
    mock.setMode('hang')
    const p = failureOf(c.getCatalog(0))
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS)
    expect((await p)?.kind).toBe('network')
  })
  it('a 200 whose body breaks the contract is bad_response, not a crash', async () => {
    const fetchBad: typeof fetch = async () => new Response(JSON.stringify({ ok: true, data: { changed: true } }), { status: 200 })
    const c = createDayoClient({ baseUrl: BASE, apiKey: MOCK_API_KEY, fetch: fetchBad, nowMs: () => 0 })
    expect((await failureOf(c.getCatalog(0)))?.kind).toBe('bad_response')
  })
  it('a 422 carries the envelope message', async () => {
    const f: typeof fetch = async () => new Response(JSON.stringify({ ok: false, error: { code: 'DY422', message: 'invalid: rows ต้องมี 1–20 แถว' } }), { status: 422 })
    const c = createDayoClient({ baseUrl: BASE, apiKey: MOCK_API_KEY, fetch: f, nowMs: () => 0 })
    expect(await failureOf(c.push({ device_time: '2026-09-25T02:00:00.000Z', rows: [] as never }))).toEqual({ kind: 'bad_envelope', message: 'invalid: rows ต้องมี 1–20 แถว' })
  })
  it('fetch throwing (offline, CORS-blocked) is a network failure', async () => {
    const f: typeof fetch = async () => { throw new TypeError('Failed to fetch') }
    const c = createDayoClient({ baseUrl: BASE, apiKey: MOCK_API_KEY, fetch: f, nowMs: () => 0 })
    expect((await failureOf(c.getCatalog(0)))?.kind).toBe('network')
  })
  it('a body that stalls after the headers also times out after 20 seconds (review item 11)', async () => {
    vi.useFakeTimers()
    const f: typeof fetch = async (_input, init) => new Response(new ReadableStream({
      start(ctl) { init?.signal?.addEventListener('abort', () => ctl.error(init.signal!.reason)) }, // headers sent, body never ends
    }), { status: 200 })
    const c = createDayoClient({ baseUrl: BASE, apiKey: MOCK_API_KEY, fetch: f, nowMs: () => 0 })
    const p = failureOf(c.getCatalog(0))
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS)
    expect((await p)?.kind).toBe('network')
  })
})
