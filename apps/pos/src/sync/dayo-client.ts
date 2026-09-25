import { API_KEY_RE, ApiErrorBody, OrdersListResponse, PosCatalogLooseResponse, PushResponse, type CentralOrder, type PosCatalogLooseData, type PushRequest, type PushResponseData } from '@dayo/contracts'
import { normalizeBaseUrl } from './base-url'

export type DayoFailure =
  | { kind: 'network'; message: string }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'api_disabled' }
  | { kind: 'bad_envelope'; message: string }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'server'; status: number }
  | { kind: 'bad_response'; message: string }

export class DayoError extends Error {
  readonly failure: DayoFailure
  constructor(failure: DayoFailure) {
    super(`DAYO_${failure.kind.toUpperCase()}`)
    this.name = 'DayoError'
    this.failure = failure
  }
}

export type Timed<T> = { value: T; sentAtMs: number; receivedAtMs: number }
export type DayoClient = {
  getCatalog(knownVersion: number): Promise<Timed<PosCatalogLooseData>>
  push(body: PushRequest): Promise<Timed<PushResponseData>>
  listOrders(q: { from: string; to: string }): Promise<Timed<CentralOrder[]>>
}

/** plan 5 transport (fix M-4): setTimeout + AbortController, not AbortSignal.timeout, so tests can use fake timers. */
export const FETCH_TIMEOUT_MS = 20_000
const RATE_LIMIT_DEFAULT_MS = 60_000

export function createDayoClient(cfg: { baseUrl: string; apiKey: string; fetch: typeof fetch; nowMs: () => number }): DayoClient {
  const base = normalizeBaseUrl(cfg.baseUrl) // throws BAD_BASE_URL before any fetch (security review item 1)
  const keyOk = API_KEY_RE.test(cfg.apiKey)
  async function call<T>(path: string, init: RequestInit, parse: (body: unknown) => T): Promise<Timed<T>> {
    // a malformed key would only earn a 401 (or break the header) — never send it (security review item 3)
    if (!keyOk) throw new DayoError({ kind: 'unauthorized' })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`timed out after ${FETCH_TIMEOUT_MS} ms`)), FETCH_TIMEOUT_MS)
    const sentAtMs = cfg.nowMs()
    let res: Response
    let text: string
    try {
      res = await cfg.fetch(`${base}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${cfg.apiKey}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
        signal: controller.signal,
        redirect: 'error', // a redirect would carry the Bearer key elsewhere (security review item 2)
      })
      // review item 11: the 20-second budget covers the BODY too — a connection that stalls mid-body must not hang
      // pushOnce (and with it every later scheduler wake) for ever.
      text = await res.text()
    } catch (e) {
      // offline, DNS, timeout (headers or body) — and in a browser also a response without CORS headers (spec §4.1)
      throw new DayoError({ kind: 'network', message: e instanceof Error ? e.message : String(e) })
    } finally {
      clearTimeout(timer)
    }
    // a fetch that ignored `redirect: 'error'` (or an opaque redirect) — refuse it like the browser would
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw new DayoError({ kind: 'network', message: `redirect refused (${res.status})` })
    const receivedAtMs = cfg.nowMs()
    let body: unknown = null
    try { body = text === '' ? null : JSON.parse(text) } catch { body = null }
    if (res.status === 401) throw new DayoError({ kind: 'unauthorized' })
    if (res.status === 403) throw new DayoError({ kind: 'forbidden' })
    if (res.status === 404) throw new DayoError({ kind: 'api_disabled' }) // any 404 under /api/v1 = API switched off (spec §4.1)
    if (res.status === 422) throw new DayoError({ kind: 'bad_envelope', message: ApiErrorBody.safeParse(body).data?.error.message ?? 'DY422' })
    if (res.status === 429) {
      const sec = Number(res.headers.get('retry-after'))
      throw new DayoError({ kind: 'rate_limited', retryAfterMs: Number.isFinite(sec) && sec > 0 ? sec * 1000 : RATE_LIMIT_DEFAULT_MS })
    }
    if (res.status !== 200) throw new DayoError({ kind: 'server', status: res.status })
    try {
      return { value: parse(body), sentAtMs, receivedAtMs }
    } catch (e) {
      throw new DayoError({ kind: 'bad_response', message: e instanceof Error ? e.message.slice(0, 300) : 'unparseable' })
    }
  }
  return {
    getCatalog: (known) => call(`/pos/catalog?known_version=${Math.max(0, Math.trunc(known))}`, { method: 'GET' }, (b) => PosCatalogLooseResponse.parse(b).data), // `catalog` checked by the caller (R12)
    push: (body) => call('/pos/push', { method: 'POST', body: JSON.stringify(body) }, (b) => PushResponse.parse(b).data),
    listOrders: (q) => call(`/orders?from=${encodeURIComponent(q.from)}&to=${encodeURIComponent(q.to)}`, { method: 'GET' }, (b) => OrdersListResponse.parse(b).data),
  }
}
