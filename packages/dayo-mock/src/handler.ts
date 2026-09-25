// packages/dayo-mock/src/handler.ts — the mock dayo /api/v1 as a fetch handler. No node:* imports.
// Route order as dayo main ships it (apps/web/src/app/api/v1/*/route.ts + lib/api/auth.ts + api_authenticate 0049:187-225):
// Content-Length > 256 KB (push only) → 401 key → 403 scope → 429 → the route.
import { MAX_PUSH_BODY_BYTES, type CentralOrder, type DayoEdit, type ReceivedRowResult } from '@dayo/contracts'
import { judgeRow } from './judge.js'
import { ALL_SCOPES, emptyKnown, freshCatalog, learnCatalog, type MockDayo, type MockOptions, type MockState, type StoredOrder } from './state.js'

export const MOCK_API_KEY = `dayo_${'0123456789abcdef'.repeat(4)}`
const utf8 = new TextEncoder()
const E1_SCOPES = ['catalog:read', 'staff:read']

/** Postgres timestamptz → JSON text: UTC as +00:00, fractional seconds without trailing zeros ("…03.12+00:00"). */
export function pgTimestamp(t: number): string {
  const iso = new Date(t).toISOString() // …THH:MM:SS.mmmZ
  const frac = iso.slice(20, 23).replace(/0+$/, '')
  return `${iso.slice(0, 19)}${frac === '' ? '' : `.${frac}`}+00:00`
}

export function createMockDayo(opts: MockOptions = {}): MockDayo {
  const init = (): MockState => {
    const catalog = opts.catalog ? structuredClone(opts.catalog) : freshCatalog()
    const known = emptyKnown()
    learnCatalog(known, catalog)
    return {
      apiKey: opts.apiKey ?? MOCK_API_KEY, origins: opts.origins ?? ['http://localhost:4173'], fixedNow: opts.now ? Date.parse(opts.now) : null,
      mode: opts.mode ?? 'normal', retryAfterSec: opts.retryAfterSec ?? 30, forbiddenMessage: opts.forbiddenMessage ?? 'forbidden: API key ไม่มีสิทธิ์ staff:read',
      scopes: [...(opts.scopes ?? ALL_SCOPES)], catalog, pricing: opts.pricing ?? null, known, closedPromotions: new Map(),
      orders: new Map(), receipts: new Map(), keys: new Map(), seq: new Map(), overrides: [], seedOrders: [...(opts.seedOrders ?? [])], log: [],
    }
  }
  let s = init()
  const now = (): number => s.fixedNow ?? Date.now()
  const serverTime = (): string => new Date(now()).toISOString().replace('Z', '+00:00')
  /** CORS at one point (spec §4.1): Vary always; the rest only for an allowed origin — errors included. */
  const cors = (origin: string | null): Record<string, string> => (origin !== null && s.origins.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'Retry-After' } : { Vary: 'Origin' })
  const json = (status: number, body: unknown, h: Record<string, string>): Response => new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json' } })
  const err = (status: number, code: string, message: string, h: Record<string, string>): Response => json(status, { ok: false, error: { code, message } }, h)
  const bump = (): number => { learnCatalog(s.known, s.catalog); s.catalog.catalog_version += 1; return s.catalog.catalog_version }

  /** Every /api/v1 request is logged WITH its status — refused ones too (review item 14: a revoked key must stay silent). */
  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    let rows = 0
    if (req.method === 'POST') {
      try { const b = JSON.parse(await req.clone().text()) as { rows?: unknown }; rows = Array.isArray(b.rows) ? b.rows.length : 0 } catch { rows = 0 }
    }
    const res = await route(req)
    if (url.pathname.startsWith('/api/v1/') && req.method !== 'OPTIONS') s.log.push({ method: req.method, path: url.pathname, rows, status: res.status })
    return res
  }

  /** dayo api_authenticate: missing scopes named in the route's order (0049:207-214). */
  function scopeError(required: readonly string[], h: Record<string, string>): Response | null {
    const missing = required.filter((x) => !s.scopes.includes(x))
    return missing.length === 0 ? null : err(403, 'DY403', `forbidden: API key ไม่มีสิทธิ์ ${missing.join(', ')}`, h)
  }

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const h = cors(req.headers.get('origin'))
    if (!url.pathname.startsWith('/api/v1/')) return new Response('not found', { status: 404 })
    if (req.method === 'OPTIONS') { // 204 always, even with the API off (spec §4.1)
      const allowed = 'Access-Control-Allow-Origin' in h
      return new Response(null, { status: 204, headers: { ...h, ...(allowed ? { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '7200' } : {}) } })
    }
    if (s.mode === 'hang') {
      return new Promise((_, reject) => {
        if (req.signal.aborted) return reject(req.signal.reason ?? new Error('aborted'))
        req.signal.addEventListener('abort', () => reject(req.signal.reason ?? new Error('aborted')))
      })
    }
    if (s.mode === 'api_disabled') return err(404, 'DY404', 'not_found', h)
    if (s.mode === 'server_down') return err(500, 'DY500', 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ ลองใหม่อีกครั้งค่ะ', h)
    const isPush = req.method === 'POST' && url.pathname === '/api/v1/pos/push'
    const tooBig = 'invalid: body ต้องเป็น JSON ไม่เกิน 256 KB'
    if (isPush && Number(req.headers.get('content-length') ?? '0') > MAX_PUSH_BODY_BYTES) return err(422, 'DY422', tooBig, h) // before the key (push route.ts)
    if (s.mode === 'unauthorized' || req.headers.get('authorization') !== `Bearer ${s.apiKey}`) return err(401, 'DY401', 'invalid_key: API key ไม่ถูกต้องหรือถูกปิดใช้งาน', h)
    const required = req.method === 'GET' && url.pathname === '/api/v1/pos/catalog' ? E1_SCOPES
      : isPush ? ['orders:write'] : req.method === 'GET' && url.pathname === '/api/v1/orders' ? ['orders:read'] : []
    const denied = scopeError(required, h)
    if (denied !== null) return denied
    if (s.mode === 'rate_limited') return err(429, 'DY429', 'rate_limited: เกินจำนวนคำขอต่อนาที (60/min)', { ...h, 'Retry-After': String(s.retryAfterSec) })
    if (s.mode === 'forbidden') return err(403, 'DY403', s.forbiddenMessage, h)

    if (req.method === 'GET' && url.pathname === '/api/v1/pos/catalog') {
      const c = s.catalog
      const common = { pricing: s.pricing ?? c.pricing, catalog_version: c.catalog_version, server_time: serverTime(), supported_kinds: c.supported_kinds, supported_fields: c.supported_fields }
      const known = Number(url.searchParams.get('known_version') ?? '0')
      return json(200, { ok: true, data: known === c.catalog_version ? { ...common, changed: false } : { ...c, ...common, changed: true } }, { ...h, 'Cache-Control': 'no-store' })
    }
    if (isPush) return push(req, h)
    if (req.method === 'GET' && url.pathname === '/api/v1/orders') return listOrders(url, h)
    return err(404, 'DY404', 'not_found', h)
  }

  /** api_pos_push (0052:694-775): envelope errors = 422 of the request; each row judged on its own. */
  async function push(req: Request, h: Record<string, string>): Promise<Response> {
    const text = await req.text()
    if (utf8.encode(text).length > MAX_PUSH_BODY_BYTES) return err(422, 'DY422', 'invalid: body ต้องเป็น JSON ไม่เกิน 256 KB', h)
    let body: unknown
    try { body = JSON.parse(text) } catch { return err(422, 'DY422', 'invalid: body ไม่ใช่ JSON', h) }
    const rows = body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as { rows?: unknown }).rows : undefined
    if (!Array.isArray(rows)) return err(422, 'DY422', 'invalid: ต้องมี rows เป็น array', h)
    if (rows.length < 1 || rows.length > 20) return err(422, 'DY422', 'invalid: rows ต้องมี 1–20 แถว', h)
    const t = now()
    const raise = req.headers.get('x-dayo-test-raise')
    return json(200, { ok: true, data: { server_time: serverTime(), results: rows.map((r) => judgeOne(r, t, raise)) } }, h)
  }

  /** A row that throws is that row's deferred SERVER_ERROR, never the batch's (dayo: one savepoint per row + dayo_pos_map_error). */
  function judgeOne(row: unknown, t: number, raise: string | null): ReceivedRowResult {
    try {
      return judgeRow(s, row, t, raise)
    } catch {
      const key = row !== null && typeof row === 'object' && typeof (row as { key?: unknown }).key === 'string' ? [...(row as { key: string }).key].slice(0, 200).join('') : ''
      return { key, status: 'deferred', reason: 'SERVER_ERROR', detail: 'SQLSTATE XX000' }
    }
  }

  /** list_api_orders (0052:785-846): sale_date desc, order_no desc, ≤ 500 · names and edit reasons only with staff:read. */
  function listOrders(url: URL, h: Record<string, string>): Response {
    const from = url.searchParams.get('from') || null
    const to = url.searchParams.get('to') || null
    const since = url.searchParams.get('updated_since') || null
    if (from !== null && to !== null && to < from) return err(422, 'DY422', 'invalid: ช่วงวันที่ไม่ถูกต้อง (from ≤ to)', h)
    const staffRead = s.scopes.includes('staff:read')
    const pos: CentralOrder[] = [...s.orders.values()].filter((o) => o.data !== null).map((o) => centralOf(o, staffRead))
    const seeds = s.seedOrders.map((o) => (staffRead ? o : { ...o, created_by_name: null, ...(o.dayo_edit ? { dayo_edit: { ...o.dayo_edit, edited_by_name: null, reason: null } } : {}) }))
    const touched = (o: CentralOrder): number => Date.parse(o.updated_at ?? o.sold_at ?? '1970-01-01T00:00:00Z')
    const rows = [...seeds, ...pos]
      .filter((o) => (from === null || o.sale_date >= from) && (to === null || o.sale_date <= to) && (since === null || touched(o) > Date.parse(since)))
      .sort((a, b) => (a.sale_date !== b.sale_date ? (a.sale_date < b.sale_date ? 1 : -1) : a.order_no < b.order_no ? 1 : a.order_no > b.order_no ? -1 : 0))
      .slice(0, 500)
    return json(200, { ok: true, data: rows }, h)
  }

  function centralOf(o: StoredOrder, staffRead: boolean): CentralOrder {
    const d = o.data!
    const edit: DayoEdit | null = o.dayoEdit === null ? null : staffRead ? o.dayoEdit : { ...o.dayoEdit, edited_by_name: null, reason: null }
    return {
      order_no: o.orderNo, sale_date: o.saleDate, status: o.status, source: 'pos', external_ref: o.receiptNo, version: o.version,
      channel: d.channel, payment: d.payment, totals: { ...d.totals, fee: 0 }, amount_mismatch: o.amountMismatch,
      updated_at: pgTimestamp(o.updatedAt ?? o.createdAt), sold_at: pgTimestamp(Date.parse(o.soldAt)),
      created_by_name: staffRead ? (s.catalog.staff.find((x) => x.id === o.staffId)?.display_name ?? null) : null,
      pos_receipt_no: o.receiptNo, pos_queue_no: d.queue_no, pos_order_id: o.posOrderId, catalog_version: d.catalog_version, duplicate_suspect: false, dayo_edit: edit,
    }
  }

  return {
    handle,
    fetch: (input, init) => handle(new Request(input as RequestInfo, init)),
    setMode: (mode) => { s.mode = mode },
    setNow: (iso) => { s.fixedNow = iso === null ? null : Date.parse(iso) },
    setScopes: (scopes) => { s.scopes = [...scopes] },
    override: (o) => { s.overrides.push(structuredClone(o)) },
    bumpCatalog: (mutate) => { mutate?.(s.catalog); return bump() },
    closePromotion: (id, at) => {
      const promotion = s.catalog.catalog.promotions.find((p) => p.id === id)
      if (promotion === undefined) throw new Error(`closePromotion: ${id} is not an active promotion of the mock catalog`)
      s.closedPromotions.set(id, { promotion: structuredClone(promotion), closedAt: Date.parse(at) })
      s.catalog.catalog.promotions = s.catalog.catalog.promotions.filter((p) => p.id !== id) // E1 sends active promotions only (ADR-0053 rule 5)
      return bump()
    },
    editPosOrder: (posOrderId, e) => {
      const o = s.orders.get(posOrderId)
      if (o === undefined) throw new Error(`editPosOrder: no POS bill ${posOrderId}`)
      const at = e.editedAt === undefined ? now() : Date.parse(e.editedAt)
      o.version += 1
      if (e.kind === 'cancel') o.status = 'cancelled'
      if (e.totals !== undefined && o.data !== null) o.data = { ...o.data, totals: { ...o.data.totals, ...e.totals } } // pos_reported_amounts stay frozen in dayo
      o.updatedAt = at
      const owner = s.catalog.staff.find((x) => x.role === 'owner')?.display_name ?? null
      o.dayoEdit = { kind: e.kind, edited_at: pgTimestamp(at), edited_by_name: e.editedByName === undefined ? owner : e.editedByName, reason: e.reason, version: o.version }
    },
    seedCentralOrders: (orders) => { s.seedOrders.push(...orders) },
    preloadAccepted: (row, result) => {
      judgeRow(s, row, Date.parse(row.data.sold_at)) // store the order the normal way…
      const stored = s.orders.get(row.data.pos_order_id)!
      stored.orderNo = String(result['order_no'])     // …then pin the fixture's order number
      s.keys.set(row.key, { ...s.keys.get(row.key)!, result: { key: row.key, status: 'accepted', data: result } })
    },
    preloadOrder: (o) => {
      s.orders.set(o.posOrderId, { ...o, status: 'ok', version: 1, staffId: null, data: null, computedTotal: o.total, amountMismatch: false, createdAt: Date.parse(o.soldAt), updatedAt: null, dayoEdit: null })
      s.receipts.set(o.receiptNo, o.posOrderId)
    },
    setNextOrderNo: (saleDate, n) => { s.seq.set(saleDate, n) },
    orders: () => [...s.orders.values()].map((o) => ({ posOrderId: o.posOrderId, orderNo: o.orderNo, receiptNo: o.receiptNo, status: o.status, total: o.total })),
    requests: () => [...s.log],
    reset: () => { s = init() },
  }
}
