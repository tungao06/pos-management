// packages/dayo-mock/src/serve.ts — what server.ts answers to one HTTP request, kept free of node:* so it is unit-tested.
// Only the offline mode's network failure drops the socket; any other exception (a mock bug, a bad /__mock/* call) is a 500
// with the error handed back for the log — never a silent "offline" (Task 6 review).
import { mockControl } from './control.js'
import { isMockOffline } from './handler.js'
import type { MockDayo } from './state.js'

export type ServeRequest = { method: string; url: URL; headers: Headers; body: string }
export type ServeAnswer = { drop: true } | { drop: false; status: number; headers: Record<string, string>; body: Uint8Array; error?: unknown }

const utf8 = new TextEncoder()
const jsonAnswer = (status: number, payload: unknown, error?: unknown): ServeAnswer =>
  ({ drop: false, status, headers: { 'content-type': 'application/json' }, body: utf8.encode(JSON.stringify(payload)), ...(error === undefined ? {} : { error }) })
const bug = (e: unknown): ServeAnswer => jsonAnswer(500, { ok: false, error: { code: 'DY500', message: `mock error: ${e instanceof Error ? e.message : String(e)}` } }, e)

export async function serveOne(mock: MockDayo, req: ServeRequest): Promise<ServeAnswer> {
  if (req.url.pathname.startsWith('/__mock/')) { // test control — no auth, never shipped
    try {
      const r = await mockControl(mock, req.url.pathname, req.body === '' ? null : (JSON.parse(req.body) as unknown))
      return jsonAnswer(r.status, r.body)
    } catch (e) {
      return bug(e)
    }
  }
  const hasBody = !(req.body === '' || req.method === 'GET' || req.method === 'OPTIONS')
  let r: Response
  try {
    r = await mock.handle(new Request(req.url, { method: req.method, headers: req.headers, ...(hasBody ? { body: req.body } : {}) }))
  } catch (e) {
    if (isMockOffline(e)) return { drop: true } // mode 'offline': the browser sees a network failure (TypeError: Failed to fetch)
    return bug(e)
  }
  return { drop: false, status: r.status, headers: Object.fromEntries(r.headers), body: new Uint8Array(await r.arrayBuffer()) }
}
