// packages/dayo-mock/src/handler.ts — the mock dayo /api/v1 as a fetch handler. No node:* imports.
import { MAX_PUSH_BODY_BYTES, PushEnvelope, type CentralOrder } from '@dayo/contracts'
import { judgeRow } from './judge.js'
import { freshCatalog, type MockDayo, type MockOptions, type MockState } from './state.js'

export const MOCK_API_KEY = `dayo_${'0123456789abcdef'.repeat(4)}`
const utf8 = new TextEncoder()

export function createMockDayo(opts: MockOptions = {}): MockDayo {
  const init = (): MockState => ({
    apiKey: opts.apiKey ?? MOCK_API_KEY, origins: opts.origins ?? ['http://localhost:4173'], fixedNow: opts.now ? Date.parse(opts.now) : null,
    mode: opts.mode ?? 'normal', retryAfterSec: opts.retryAfterSec ?? 30, forbiddenMessage: opts.forbiddenMessage ?? 'forbidden: API key ไม่มีสิทธิ์ staff:read',
    catalog: opts.catalog ? structuredClone(opts.catalog) : freshCatalog(), pricing: opts.pricing ?? null,
    orders: new Map(), receipts: new Map(), keys: new Map(), seq: new Map(), overrides: [], seedOrders: [...(opts.seedOrders ?? [])], log: [],
  })
  let s = init()
  const now = (): number => s.fixedNow ?? Date.now()
  const serverTime = (): string => new Date(now()).toISOString().replace('Z', '+00:00')
  /** CORS at one point (spec §4.1): Vary always; the rest only for an allowed origin — errors included. */
  const cors = (origin: string | null): Record<string, string> => (origin !== null && s.origins.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'Retry-After' } : { Vary: 'Origin' })
  const json = (status: number, body: unknown, h: Record<string, string>): Response => new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json' } })
  const err = (status: number, code: string, message: string, h: Record<string, string>): Response => json(status, { ok: false, error: { code, message } }, h)

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
    if (s.mode === 'unauthorized' || req.headers.get('authorization') !== `Bearer ${s.apiKey}`) return err(401, 'DY401', 'invalid_key: API key ไม่ถูกต้องหรือถูกปิดใช้งาน', h)
    if (s.mode === 'rate_limited') return err(429, 'DY429', 'rate_limited: เกินจำนวนคำขอต่อนาที (60/min)', { ...h, 'Retry-After': String(s.retryAfterSec) })
    if (s.mode === 'forbidden') return err(403, 'DY403', s.forbiddenMessage, h)

    if (req.method === 'GET' && url.pathname === '/api/v1/pos/catalog') {
      const c = s.catalog
      const common = { pricing: s.pricing ?? c.pricing, catalog_version: c.catalog_version, server_time: serverTime(), supported_kinds: c.supported_kinds, supported_fields: c.supported_fields }
      const known = Number(url.searchParams.get('known_version') ?? '0')
      return json(200, { ok: true, data: known === c.catalog_version ? { ...common, changed: false } : { ...c, ...common, changed: true } }, { ...h, 'Cache-Control': 'no-store' })
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/pos/push') {
      const text = await req.text()
      if (utf8.encode(text).length > MAX_PUSH_BODY_BYTES) return err(422, 'DY422', 'invalid: body เกิน 256 KB', h)
      let body: unknown
      try { body = JSON.parse(text) } catch { return err(422, 'DY422', 'invalid: body ต้องเป็น JSON', h) }
      const env = PushEnvelope.safeParse(body)
      if (!env.success) return err(422, 'DY422', 'invalid: rows ต้องเป็นรายการ 1–20 แถว', h)
      const t = now()
      const st = serverTime()
      return json(200, { ok: true, data: { server_time: st, results: env.data.rows.map((r) => judgeRow(s, r, t, st)) } }, h)
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/orders') {
      const from = url.searchParams.get('from') ?? '0000-00-00'
      const to = url.searchParams.get('to') ?? '9999-99-99'
      const pos: CentralOrder[] = [...s.orders.values()].filter((o) => o.data !== null).map((o) => ({
        order_no: o.orderNo, sale_date: o.saleDate, status: o.status === 'cancelled' ? 'cancelled' : 'ok', source: 'pos', external_ref: o.receiptNo, version: o.version,
        channel: o.data!.channel, payment: o.data!.payment, totals: { ...o.data!.totals, fee: 0 }, amount_mismatch: false, updated_at: null, sold_at: o.soldAt.replace('Z', '+00:00'),
        created_by_name: s.catalog.staff.find((x) => x.id === o.staffId)?.display_name ?? null, pos_receipt_no: o.receiptNo, pos_queue_no: o.data!.queue_no,
        catalog_version: o.data!.catalog_version, duplicate_suspect: false,
      }))
      return json(200, { ok: true, data: [...s.seedOrders, ...pos].filter((o) => o.sale_date >= from && o.sale_date <= to) }, h)
    }
    return err(404, 'DY404', 'not_found', h)
  }

  return {
    handle,
    fetch: (input, init) => handle(new Request(input as RequestInfo, init)),
    setMode: (mode) => { s.mode = mode },
    setNow: (iso) => { s.fixedNow = iso === null ? null : Date.parse(iso) },
    override: (o) => { s.overrides.push(structuredClone(o)) },
    bumpCatalog: (mutate) => { mutate?.(s.catalog); s.catalog.catalog_version += 1; return s.catalog.catalog_version },
    seedCentralOrders: (orders) => { s.seedOrders.push(...orders) },
    preloadAccepted: (row, result) => {
      judgeRow(s, row, Date.parse(row.data.sold_at), row.data.sold_at) // store the order the normal way…
      const stored = s.orders.get(row.data.pos_order_id)!
      stored.orderNo = String(result['order_no'])                       // …then pin the fixture's order number
      s.keys.set(row.key, { ...s.keys.get(row.key)!, result: { key: row.key, status: 'accepted', data: result } })
    },
    preloadOrder: (o) => {
      s.orders.set(o.posOrderId, { ...o, status: 'ok', version: 1, staffId: null, data: null })
      s.receipts.set(o.receiptNo, o.posOrderId)
    },
    setNextOrderNo: (saleDate, n) => { s.seq.set(saleDate, n) },
    orders: () => [...s.orders.values()].map((o) => ({ posOrderId: o.posOrderId, orderNo: o.orderNo, receiptNo: o.receiptNo, status: o.status, total: o.total })),
    requests: () => [...s.log],
    reset: () => { s = init() },
  }
}
