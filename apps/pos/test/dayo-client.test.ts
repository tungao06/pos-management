import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockDayo, MOCK_API_KEY } from '@dayo/dayo-mock'
import { createDayoClient, DayoError, FETCH_TIMEOUT_MS } from '../src/sync/dayo-client'

const BASE = 'https://mock/api/v1/' // http is only allowed for localhost / 127.0.0.1 (security review item 1)
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
    expect.assertions(2)
    const wrong = `dayo_${'f'.repeat(64)}`
    const { c } = client(undefined, wrong)
    try { await c.getCatalog(0) } catch (e) {
      expect((e as DayoError).failure).toEqual({ kind: 'unauthorized' })
      expect(String((e as Error).message) + String((e as Error).stack) + JSON.stringify((e as DayoError).failure)).not.toContain(wrong)
    }
  })
  it('a key that is not dayo_<64 hex> is unauthorized without calling fetch (security review item 3)', async () => {
    const f = vi.fn<typeof fetch>()
    for (const bad of ['', 'dayo_short', `dayo_${'F'.repeat(64)}`, `Bearer dayo_${'0'.repeat(64)}`, `dayo_${'0'.repeat(64)}\r\nX-Evil: 1`]) {
      const c = createDayoClient({ baseUrl: BASE, apiKey: bad, fetch: f, nowMs: () => 0 })
      expect(await failureOf(c.getCatalog(0))).toEqual({ kind: 'unauthorized' })
      expect(await failureOf(c.push({ device_time: '2026-09-25T02:00:00.000Z', rows: [] as never }))).toEqual({ kind: 'unauthorized' })
      expect(await failureOf(c.listOrders({ from: '2026-09-25', to: '2026-09-25' }))).toEqual({ kind: 'unauthorized' })
    }
    expect(f).not.toHaveBeenCalled()
  })
  it('refuses a base URL that is not https (or http on this machine) before any fetch (security review item 1)', () => {
    const f = vi.fn<typeof fetch>()
    for (const baseUrl of ['http://evil.example.com/api/v1', 'http://localhost.evil.com/api/v1', 'not a url', '']) {
      expect(() => createDayoClient({ baseUrl, apiKey: MOCK_API_KEY, fetch: f, nowMs: () => 0 })).toThrow(/^BAD_BASE_URL/)
    }
    expect(f).not.toHaveBeenCalled()
  })
  it.each(['https://dayo.example.com/api/v1/', 'http://localhost:8787/api/v1/', 'http://127.0.0.1:4010/api/v1'])('sends to %s', async (baseUrl) => {
    const mock = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const urls: string[] = []
    const f: typeof fetch = (input, init) => { urls.push(String(input)); return mock.fetch(input, init) }
    const c = createDayoClient({ baseUrl, apiKey: MOCK_API_KEY, fetch: f, nowMs: () => 0 })
    await c.getCatalog(0)
    expect(urls).toEqual([`${baseUrl.replace(/\/+$/, '')}/pos/catalog?known_version=0`])
  })
  it('every request refuses redirects (security review item 2)', async () => {
    const seen: (RequestRedirect | undefined)[] = []
    const mock = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const f: typeof fetch = (input, init) => { seen.push(init?.redirect); return mock.fetch(input, init) }
    const c = createDayoClient({ baseUrl: BASE, apiKey: MOCK_API_KEY, fetch: f, nowMs: () => 0 })
    await c.getCatalog(0)
    await failureOf(c.push({ device_time: '2026-09-25T02:00:00.000Z', rows: [] as never }))
    await c.listOrders({ from: '2026-09-25', to: '2026-09-25' })
    expect(seen).toEqual(['error', 'error', 'error'])
  })
  it.each([301, 302, 307, 308])('a %i that reaches the client anyway is a network failure', async (status) => {
    const f: typeof fetch = async () => new Response(null, { status, headers: { location: 'https://evil.example.com/steal' } })
    const c = createDayoClient({ baseUrl: BASE, apiKey: MOCK_API_KEY, fetch: f, nowMs: () => 0 })
    expect((await failureOf(c.getCatalog(0)))?.kind).toBe('network')
  })
  it('real fetch: a 307 from the server is a network failure and the key is not sent on', async () => {
    const hits: string[] = []
    const server = createServer((req, res) => {
      hits.push(req.url ?? '')
      if (req.url?.startsWith('/api/v1/')) { res.writeHead(307, { location: '/steal' }); res.end(); return }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    try {
      const { port } = server.address() as AddressInfo
      const c = createDayoClient({ baseUrl: `http://127.0.0.1:${port}/api/v1`, apiKey: MOCK_API_KEY, fetch: globalThis.fetch, nowMs: () => 0 })
      expect((await failureOf(c.getCatalog(0)))?.kind).toBe('network')
      expect(hits).toEqual(['/api/v1/pos/catalog?known_version=0'])
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
  it('an answer that is neither 200 nor a mapped error is a server failure', async () => {
    for (const status of [400, 409, 418]) {
      const f: typeof fetch = async () => new Response('{}', { status })
      const c = createDayoClient({ baseUrl: BASE, apiKey: MOCK_API_KEY, fetch: f, nowMs: () => 0 })
      expect(await failureOf(c.getCatalog(0))).toEqual({ kind: 'server', status })
    }
  })
  it('403 means "forbidden" only with dayo\'s own error body — a proxy or WAF 403 is a server failure (task 14 review item 3)', async () => {
    const failure = (body: string) => failureOf(createDayoClient({ baseUrl: BASE, apiKey: MOCK_API_KEY, fetch: async () => new Response(body, { status: 403 }), nowMs: () => 0 }).getCatalog(0))
    expect(await failure('<html><body>403 Forbidden</body></html>')).toEqual({ kind: 'server', status: 403 })
    expect(await failure('')).toEqual({ kind: 'server', status: 403 })
    expect(await failure(JSON.stringify({ message: 'Request blocked' }))).toEqual({ kind: 'server', status: 403 })
    expect(await failure(JSON.stringify({ ok: false, error: { code: 'DY403', message: 'forbidden: API key ไม่มีสิทธิ์ orders:write' } }))).toEqual({ kind: 'forbidden' })
  })
  it('a hung request becomes a timeout failure after 20 seconds', async () => {
    vi.useFakeTimers()
    const { mock, c } = client()
    mock.setMode('hang')
    const p = failureOf(c.getCatalog(0))
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS)
    expect(await p).toEqual({ kind: 'timeout' }) // task 13 m1: a timeout is not an offline network error
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
    expect(await p).toEqual({ kind: 'timeout' })
  })
})

describe('Retry-After is clamped to 1 s … 15 min (task 13 security I1)', () => {
  const answer429 = (value: string): typeof fetch => async () => new Response(JSON.stringify({ ok: false, error: { code: 'DY429', message: 'rate_limited' } }), { status: 429, headers: { 'Retry-After': value } })
  const clientWith = (f: typeof fetch) => createDayoClient({ baseUrl: BASE, apiKey: MOCK_API_KEY, fetch: f, nowMs: () => Date.parse('2026-09-25T02:00:00.000Z') })
  it.each([
    ['1e9', 900_000], ['1e20', 900_000], ['1000000000', 900_000], ['Infinity', 60_000], ['0.2', 1_000], ['-5', 60_000], ['0', 60_000],
    ['Wed, 21 Oct 2099 07:28:00 GMT', 60_000], ['', 60_000], ['30', 30_000],
  ])('Retry-After %s → %i ms', async (value, ms) => {
    expect(await failureOf(clientWith(answer429(value)).getCatalog(0))).toEqual({ kind: 'rate_limited', retryAfterMs: ms })
  })
})
