// packages/dayo-mock/src/handler.ts — the mock dayo /api/v1 as a fetch handler. No node:* imports.
// Route order as dayo main ships it (apps/web/src/app/api/v1/*/route.ts + lib/api/auth.ts + api_authenticate 0049:187-225):
// Content-Length > 256 KB (push only) → 401 key → 403 scope → 429 → the route.
import { BLOCK3_PHASE1_KINDS, BLOCK3_PHASE1_SUPPORTED_FIELDS, BLOCK3_PHASE2_KINDS, BLOCK3_PHASE2_SUPPORTED_FIELDS, MAX_PUSH_BODY_BYTES, type CentralOrder, type DayoEdit, type ReceivedRowResult } from '@dayo/contracts'
import { bodyJsonbRefuses, judgeRow } from './judge.js'
import { highestGoodZ, highestZNo } from './judge-shift.js'
import { utcMs } from './judge-util.js'
import { clearRecompute, recomputeAll } from './recompute.js'
import { shiftCashAnswer } from './shift-cash.js'
import { applyManualFields, MAIN_GROUP, PROMO_RULE_VERSION_INVALID, PROMO_RULES_OFF, promotionRow, promotionsFor, readPromoRuleVersion } from './promo-rules.js'
import { ALL_SCOPES, BLOCK3_SCOPES, emptyKnown, freshCatalog, learnCatalog, storedCatalog, type MockDayo, type MockOptions, type MockState, type StoredOrder } from './state.js'

export const MOCK_API_KEY = `dayo_${'0123456789abcdef'.repeat(4)}`
const utf8 = new TextEncoder()
const E1_SCOPES = ['catalog:read', 'staff:read']
/** D103: shop_settings.off_catalog_max_total default (baht). */
export const DEFAULT_OFF_CATALOG_CAP = 3000

/**
 * What `handle`/`fetch` throw in mode 'offline' — a TypeError('Failed to fetch') like a browser's network failure. The Node
 * server drops the socket for this one error only; any other exception is a mock bug and must surface (server.ts answers 500).
 */
export class MockOfflineError extends TypeError {
  constructor() { super('Failed to fetch') }
}
export const isMockOffline = (e: unknown): boolean => e instanceof MockOfflineError

/** Postgres timestamptz → JSON text: UTC as +00:00, fractional seconds without trailing zeros ("…03.12+00:00"). */
export function pgTimestamp(t: number): string {
  const iso = new Date(t).toISOString() // …THH:MM:SS.mmmZ
  const frac = iso.slice(20, 23).replace(/0+$/, '')
  return `${iso.slice(0, 19)}${frac === '' ? '' : `.${frac}`}+00:00`
}

/**
 * dayo_pos_supported() of dayo main 12885fe (0066:588-608 · preflight P3): phase 1 = the four shift kinds + their fields ·
 * phase 2 (not shipped) = + order_off_catalog. `scopes`: a phase-1 key gains shift:write, leaving phase 1 drops it.
 */
function setPhases(s: MockState, phase1: boolean, phase2: boolean, scopes: boolean): void {
  const p1: readonly string[] = BLOCK3_PHASE1_KINDS
  const p2: readonly string[] = BLOCK3_PHASE2_KINDS
  const fields: Record<string, readonly string[]> = { ...BLOCK3_PHASE1_SUPPORTED_FIELDS, ...BLOCK3_PHASE2_SUPPORTED_FIELDS }
  const want = [...(phase1 ? p1 : []), ...(phase2 ? p2 : [])]
  const c = s.catalog
  c.supported_kinds = [...c.supported_kinds.filter((k) => !p1.includes(k) && !p2.includes(k)), ...want]
  for (const k of [...p1, ...p2]) delete c.supported_fields[k]
  for (const k of want) c.supported_fields[k] = [...fields[k]!]
  const wasPhase2 = s.block3Phase2
  s.block3 = phase1
  s.block3Phase2 = phase2
  if (phase2 && !wasPhase2) recomputeAll(s)      // dayo phase 2 judges the Zs it already holds
  if (!phase2 && wasPhase2) clearRecompute(s)    // back to phase 1: recompute_status null
  if (scopes) s.scopes = phase1 ? [...new Set([...s.scopes, 'shift:write'])] : s.scopes.filter((x) => x !== 'shift:write')
}

export function createMockDayo(opts: MockOptions = {}): MockDayo {
  const init = (): MockState => {
    const catalog = opts.catalog ? storedCatalog(opts.catalog) : freshCatalog()
    const promoRules = structuredClone(opts.promoRules ?? PROMO_RULES_OFF)
    applyManualFields(catalog.supported_fields, promoRules.manualFields)
    const known = emptyKnown()
    learnCatalog(known, catalog)
    const phase2 = opts.block3Phase2 === true
    const phase1 = phase2 || opts.block3 === true
    const s: MockState = {
      apiKey: opts.apiKey ?? MOCK_API_KEY, origins: opts.origins ?? ['http://localhost:4173'], fixedNow: opts.now ? Date.parse(opts.now) : null,
      mode: opts.mode ?? 'normal', retryAfterSec: opts.retryAfterSec ?? 30, forbiddenMessage: opts.forbiddenMessage ?? 'forbidden: API key ไม่มีสิทธิ์ staff:read',
      scopes: [...(opts.scopes ?? (phase1 ? BLOCK3_SCOPES : ALL_SCOPES))], catalog, pricing: opts.pricing ?? null, known, closedPromotions: new Map(),
      orders: new Map(), receipts: new Map(), keys: new Map(), seq: new Map(), overrides: [], seedOrders: [...(opts.seedOrders ?? [])], log: [],
      block3: false, block3Phase2: false, shifts: new Map(), movements: new Map(), counts: new Map(), zReports: new Map(), preloadedZ: null, conflicts: [], block3LiveFrom: null,
      offCatalogCap: DEFAULT_OFF_CATALOG_CAP, rejections: new Map(), promoRules,
    }
    if (phase1) setPhases(s, phase1, phase2, false) // no bump · explicit opts.scopes win (the default block 3 key has shift:write)
    return s
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
    if (s.mode === 'offline') throw new MockOfflineError() // a real network failure: never reaches dayo, not logged
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
    // E4 exists only on a block 3 dayo (0067): the block-2 mock keeps answering its path 404 like block-2 dayo (fixture e4-shift-cash)
    const isShiftCash = s.block3 && req.method === 'GET' && url.pathname === '/api/v1/pos/shift-cash'
    const required = req.method === 'GET' && url.pathname === '/api/v1/pos/catalog' ? E1_SCOPES
      : isPush ? ['orders:write'] : (req.method === 'GET' && url.pathname === '/api/v1/orders') || isShiftCash ? ['orders:read'] : []
    const denied = scopeError(required, h)
    if (denied !== null) return denied
    if (s.mode === 'forbidden') return err(403, 'DY403', s.forbiddenMessage, h) // legacy 403 mode before 429 (dayo order: 403 before 429)
    if (s.mode === 'rate_limited') return err(429, 'DY429', 'rate_limited: เกินจำนวนคำขอต่อนาที (60/min)', { ...h, 'Retry-After': String(s.retryAfterSec) })

    if (req.method === 'GET' && url.pathname === '/api/v1/pos/catalog') return catalogAnswer(url, h)
    if (isPush) return push(req, h)
    if (req.method === 'GET' && url.pathname === '/api/v1/orders') return listOrders(url, h)
    if (isShiftCash) { const r = shiftCashAnswer(s, url); return json(r.status, r.body, h) } // E4 (0067:31-75)
    return err(404, 'DY404', 'not_found', h)
  }

  /**
   * E1 (0074 api_pos_catalog of the release played — plan 10 Task 5): a dayo with rule versions reads promo_rule_version
   * (DY422 when malformed — the route checks it before the RPC), serves the promotions through dayo_pos_promotions_for,
   * sends promotionGroups with every changed answer and names its versions in supported_fields (changed or not). A dayo
   * before 0071 reads none of it: version 0, no groups, no versions key.
   */
  function catalogAnswer(url: URL, h: Record<string, string>): Response {
    const c = s.catalog
    const versions = s.promoRules.versions
    const asked = versions === null ? 0 : readPromoRuleVersion(url.searchParams.get('promo_rule_version'))
    if (asked === null) return err(422, 'DY422', PROMO_RULE_VERSION_INVALID, h)
    const supported_fields = versions === null ? c.supported_fields : { ...c.supported_fields, promotion_rule_versions: [...versions] }
    const common = { pricing: s.pricing ?? c.pricing, catalog_version: c.catalog_version, server_time: serverTime(), supported_kinds: c.supported_kinds, supported_fields }
    const known = Number(url.searchParams.get('known_version') ?? '0')
    if (known === c.catalog_version) return json(200, { ok: true, data: { ...common, changed: false } }, { ...h, 'Cache-Control': 'no-store' })
    const { promotionGroups, ...rest } = c.catalog
    const catalog = { ...rest, promotions: promotionsFor(c.catalog.promotions, asked), ...(versions === null ? {} : { promotionGroups: promotionGroups ?? [MAIN_GROUP] }) }
    return json(200, { ok: true, data: { ...c, ...common, catalog, client: clientOf(c.client), changed: true } }, { ...h, 'Cache-Control': 'no-store' })
  }

  /**
   * E1 client.last_z_* (0067:134-155 · spec 04 R5-3): last_z_no = the highest z_no of every Z (quarantined included) ·
   * last_z_hash / last_z_until = of the highest NON-quarantined Z, until in dayo's `…mmm+00:00` form (preflight P7/D8). They
   * override the catalog's client ONLY when a Z exists — without one, whatever bumpCatalog set stays (review item 3); a
   * block 3 mock then still names all three (null), as dayo does.
   */
  function clientOf(client: MockState['catalog']['client']): MockState['catalog']['client'] {
    const maxAll = highestZNo(s)
    if (maxAll === undefined) return s.block3 ? { last_z_no: null, last_z_hash: null, last_z_until: null, ...client } : client
    const good = highestGoodZ(s)
    return { ...client, last_z_no: maxAll, last_z_hash: good?.hash ?? null, last_z_until: good === undefined ? null : utcMs(good.until) }
  }

  /** api_pos_push (0052:694-775): envelope errors = 422 of the request; each row judged on its own. */
  async function push(req: Request, h: Record<string, string>): Promise<Response> {
    const text = await req.text()
    if (utf8.encode(text).length > MAX_PUSH_BODY_BYTES) return err(422, 'DY422', 'invalid: body ต้องเป็น JSON ไม่เกิน 256 KB', h)
    let body: unknown
    try { body = JSON.parse(text) } catch { return err(422, 'DY422', 'invalid: body ไม่ใช่ JSON', h) }
    if (bodyJsonbRefuses(body)) return err(422, 'DY422', 'invalid: body ไม่ใช่ JSON', h) // p_body::jsonb fails like a parse error
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
      const key = row !== null && typeof row === 'object' && typeof (row as { key?: unknown }).key === 'string' ? [...(row as { key: string }).key].slice(0, 200).join('') : null // dayo: null when the sent key is not a string
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
    setPromotions: (promotions, groups) => {
      s.catalog.catalog.promotions = promotions.map(promotionRow)
      if (groups !== undefined) s.catalog.catalog.promotionGroups = structuredClone([...groups])
      return bump()
    },
    setPromoRules: (p) => {
      s.promoRules = structuredClone(p)
      applyManualFields(s.catalog.supported_fields, p.manualFields)
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
      if (e.kind === 'cancel') recomputeAll(s) // rule 6 · R3-m1: a web cancel can end a Z's wait for an order_void (phase 2 only)
    },
    seedCentralOrders: (orders) => { s.seedOrders.push(...orders) },
    preloadAccepted: (row, result) => {
      judgeRow(s, row, Date.parse(row.data.sold_at)) // store the order the normal way…
      const stored = s.orders.get(row.data.pos_order_id)!
      stored.orderNo = String(result['order_no'])     // …then pin the fixture's order number
      s.keys.set(row.key, { ...s.keys.get(row.key)!, result: { key: row.key, status: 'accepted', data: result } })
    },
    preloadOrder: (o) => {
      s.orders.set(o.posOrderId, { ...o, status: 'ok', version: 1, staffId: null, data: null, offCatalog: false, computedTotal: o.total, amountMismatch: false, createdAt: Date.parse(o.soldAt), updatedAt: null, dayoEdit: null })
      s.receipts.set(o.receiptNo, o.posOrderId)
    },
    setNextOrderNo: (saleDate, n) => { s.seq.set(saleDate, n) },
    orders: () => [...s.orders.values()].map((o) => ({ posOrderId: o.posOrderId, orderNo: o.orderNo, receiptNo: o.receiptNo, status: o.status, total: o.total })),
    requests: () => [...s.log],
    reset: () => { s = init() },
    setBlock3: (on) => { setPhases(s, on, on && s.block3Phase2, true); return bump() },
    setBlock3Phase2: (on) => { setPhases(s, on || s.block3, on, true); return bump() },
    shifts: () => [...s.shifts.values()].map((x) => ({ ...x })),
    movements: () => [...s.movements.values()].map((x) => ({ ...x })),
    counts: () => [...s.counts.values()].map((x) => ({ ...x })),
    zReports: () => [...s.zReports.values()], // live objects on purpose — tests only (see MockDayo.zReports)
    preloadZ: (z) => { s.preloadedZ = { zNo: z.zNo, hash: z.hash, countedAt: Date.parse(z.countedAt) } },
    conflicts: () => [...s.conflicts],
    setBlock3LiveFrom: (d) => { s.block3LiveFrom = d },
    setOffCatalogCap: (baht) => { s.offCatalogCap = baht },
    rejections: () => [...s.rejections].map(([posOrderId, reasons]) => ({ posOrderId, reasons: [...reasons] })),
    recomputeAll: () => { recomputeAll(s) },
  }
}
