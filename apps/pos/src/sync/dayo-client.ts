import { API_KEY_RE, ApiErrorBody, OrdersListResponse, PosCatalogLooseResponse, PushResponse, ShiftCashResponse, type CentralOrder, type PosCatalogLooseData, type PushRequest, type PushResponseData, type ShiftCashData } from '@dayo/contracts'
import { normalizeBaseUrl } from './base-url'

export type DayoFailure =
  | { kind: 'network'; message: string }
  /** task 13 m1: the 20-second budget ran out (headers or body) — dayo was reached or is hanging, not an offline tablet. */
  | { kind: 'timeout' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'api_disabled' }
  | { kind: 'bad_envelope'; message: string }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'server'; status: number }
  | { kind: 'bad_response'; message: string }
  /** The stored base URL is refused before any fetch (normalizeBaseUrl) — retrying cannot help; the owner must re-link. */
  | { kind: 'bad_base_url'; message: string }

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
  /**
   * E1 · plan 10 §0.2: `promo_rule_version` is always sent (a dayo before 0071 ignores it); the answer's promotions depend
   * on it while `catalog_version` does not — the caller asks known_version=0 when it changes (R6).
   */
  getCatalog(knownVersion: number, promoRuleVersion: number): Promise<Timed<PosCatalogLooseData>>
  push(body: PushRequest): Promise<Timed<PushResponseData>>
  /** E3 · `updatedSince` = dayo's `updated_since` (coalesce(updated_at, created_at) > it — 0052_pos_push.sql:840). */
  listOrders(q: { from: string; to: string; updatedSince?: string }): Promise<Timed<CentralOrder[]>>
  /**
   * E4 (block 3 · dayo 0067): the bot/web CASH bills in (after, until] (scope orders:read). A block-2 dayo has no such
   * path = 404 = api_disabled. The answer is only parsed here — its bill numbers are checked by the Z builder (Task 12).
   */
  shiftCash(q: { after: string; until: string }): Promise<Timed<ShiftCashData>>
}

/** plan 5 transport (fix M-4): setTimeout + AbortController, not AbortSignal.timeout, so tests can use fake timers. */
export const FETCH_TIMEOUT_MS = 20_000
const RATE_LIMIT_DEFAULT_MS = 60_000
/** security review I1 (task 13): a hostile or broken Retry-After can neither stall the queue for days nor make it spin. */
export const RETRY_AFTER_MIN_MS = 1_000
export const RETRY_AFTER_MAX_MS = 15 * 60_000

export function createDayoClient(cfg: { baseUrl: string; apiKey: string; fetch: typeof fetch; nowMs: () => number }): DayoClient {
  const base = normalizeBaseUrl(cfg.baseUrl) // throws BAD_BASE_URL before any fetch (security review item 1)
  const keyOk = API_KEY_RE.test(cfg.apiKey)
  // Follow-up item 5: taken out of cfg and called as a plain function, never as `cfg.fetch(...)` — a browser's native
  // fetch called with cfg as its receiver throws "TypeError: Illegal invocation" (same bug class as the scheduler's
  // timers hotfix); Node does not check the receiver, so only a real browser would show it.
  const send = cfg.fetch
  async function call<T>(path: string, init: RequestInit, parse: (body: unknown) => T): Promise<Timed<T>> {
    // a malformed key would only earn a 401 (or break the header) — never send it (security review item 3)
    if (!keyOk) throw new DayoError({ kind: 'unauthorized' })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`timed out after ${FETCH_TIMEOUT_MS} ms`)), FETCH_TIMEOUT_MS)
    const sentAtMs = cfg.nowMs()
    let res: Response
    let text: string
    try {
      res = await send(`${base}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${cfg.apiKey}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
        signal: controller.signal,
        redirect: 'error', // a redirect would carry the Bearer key elsewhere (security review item 2)
      })
      // review item 11: the 20-second budget covers the BODY too — a connection that stalls mid-body must not hang
      // pushOnce (and with it every later scheduler wake) for ever.
      text = await res.text()
    } catch (e) {
      // our own 20-second abort (headers or body) = timeout (m1) · anything else: offline, DNS, and in a browser also a
      // response without CORS headers (spec §4.1)
      if (controller.signal.aborted) throw new DayoError({ kind: 'timeout' })
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
    // task 14 item 3: only dayo's own error body means "this key lacks a scope" — a proxy / WAF 403 in front of dayo is a
    // server failure (backoff and retry), never a stop of every call until a new key
    if (res.status === 403) throw new DayoError(ApiErrorBody.safeParse(body).success ? { kind: 'forbidden' } : { kind: 'server', status: 403 })
    if (res.status === 404) throw new DayoError({ kind: 'api_disabled' }) // any 404 under /api/v1 = API switched off (spec §4.1)
    if (res.status === 422) throw new DayoError({ kind: 'bad_envelope', message: ApiErrorBody.safeParse(body).data?.error.message ?? 'DY422' })
    if (res.status === 429) {
      const sec = Number(res.headers.get('retry-after'))
      const ms = Number.isFinite(sec) && sec > 0 ? Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, Math.round(sec * 1000))) : RATE_LIMIT_DEFAULT_MS
      throw new DayoError({ kind: 'rate_limited', retryAfterMs: ms })
    }
    if (res.status !== 200) throw new DayoError({ kind: 'server', status: res.status })
    try {
      return { value: parse(body), sentAtMs, receivedAtMs }
    } catch (e) {
      throw new DayoError({ kind: 'bad_response', message: e instanceof Error ? e.message.slice(0, 300) : 'unparseable' })
    }
  }
  return {
    getCatalog: (known, rules) => call(`/pos/catalog?known_version=${Math.max(0, Math.trunc(known))}&promo_rule_version=${Math.max(0, Math.trunc(rules))}`,{ method: 'GET' }, (b) => PosCatalogLooseResponse.parse(b).data), // `catalog` checked by the caller (R12)
    push: (body) => call('/pos/push', { method: 'POST', body: JSON.stringify(body) }, (b) => PushResponse.parse(b).data),
    shiftCash: (q) => call(`/pos/shift-cash?after=${encodeURIComponent(q.after)}&until=${encodeURIComponent(q.until)}`, { method: 'GET' }, (b) => ShiftCashResponse.parse(b).data),
    listOrders: (q) => call(`/orders?from=${encodeURIComponent(q.from)}&to=${encodeURIComponent(q.to)}${q.updatedSince === undefined ? '' : `&updated_since=${encodeURIComponent(q.updatedSince)}`}`, { method: 'GET' }, (b) => OrdersListResponse.parse(b).data),
  }
}
