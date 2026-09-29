// server.ts's answer per request (Task 6 review): only mode 'offline' drops the socket; a mock bug is a 500, never "offline".
import { describe, expect, it } from 'vitest'
import { createMockDayo, MOCK_API_KEY, type MockDayo } from '../src/index'
import { serveOne } from '../src/serve'

const req = (path: string, o: { method?: string; body?: string } = {}) =>
  ({ method: o.method ?? 'GET', url: new URL(`http://localhost:8787${path}`), headers: new Headers({ authorization: `Bearer ${MOCK_API_KEY}` }), body: o.body ?? '' })
const text = (b: Uint8Array): string => new TextDecoder().decode(b)

describe('serveOne (the Node mock server)', () => {
  it('answers a normal request with the handler\'s status and body', async () => {
    const a = await serveOne(createMockDayo(), req('/api/v1/pos/catalog'))
    expect(a).toMatchObject({ drop: false, status: 200 })
    expect(a.drop === false && JSON.parse(text(a.body))).toMatchObject({ ok: true })
  })
  it('mode offline → drop the socket (the browser sees Failed to fetch)', async () => {
    const m = createMockDayo()
    m.setMode('offline')
    expect(await serveOne(m, req('/api/v1/pos/catalog'))).toEqual({ drop: true })
  })
  it('any other exception of the handler → 500 with the error for the log, not a dropped socket', async () => {
    const broken: MockDayo = { ...createMockDayo(), handle: async () => { throw new Error('handler bug') } }
    const a = await serveOne(broken, req('/api/v1/pos/catalog'))
    expect(a).toMatchObject({ drop: false, status: 500, error: expect.objectContaining({ message: 'handler bug' }) })
    expect(a.drop === false && JSON.parse(text(a.body))).toEqual({ ok: false, error: { code: 'DY500', message: 'mock error: handler bug' } })
  })
  it('a /__mock/* call that throws (or bad JSON) → 500, the server keeps running', async () => {
    const m = createMockDayo()
    expect(await serveOne(m, req('/__mock/close-promotion', { method: 'POST', body: JSON.stringify({ id: 'nope', at: '2026-09-25T00:00:00Z' }) }))).toMatchObject({ drop: false, status: 500 })
    expect(await serveOne(m, req('/__mock/mode', { method: 'POST', body: '{' }))).toMatchObject({ drop: false, status: 500 })
    expect(await serveOne(m, req('/__mock/reset', { method: 'POST' }))).toMatchObject({ drop: false, status: 200 })
  })
})
