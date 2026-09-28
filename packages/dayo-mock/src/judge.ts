// packages/dayo-mock/src/judge.ts — one E2 row → one verdict. No node:* imports (sha256 from @noble/hashes).
// A port of dayo main supabase/migrations/0052_pos_push.sql: dayo_pos_push_row (539-629; row checks 555-620) → dayo_pos_order (228-447) /
// dayo_pos_void (452-534), same checks in the same order with dayo's reason and detail texts. A verdict is thrown (dayo raises
// DYPV0 and its savepoint undoes the row); any other exception reaches the handler, which makes it this row's
// deferred SERVER_ERROR (dayo_pos_map_error). State changes only after every check passed.
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { bangkokDateOf, clipCodePoints, fieldsUsed, type ReceivedRowResult } from '@dayo/contracts'
import { computedTotalAt } from './reprice.js'
import { variantKey, type MockOrderData, type MockOrderLine, type MockOverride, type MockState, type StoredOrder } from './state.js'

const FIVE_MIN = 5 * 60_000
const DAY = 86_400_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const KEY_RE = /^[a-z][a-z_]{0,39}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TS_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$/
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0001-\u001f\u007f]/
const RECEIPT_RE = /^[A-Z]{1,3}-[0-9]{6}$/
/** Text Postgres jsonb cannot hold: a lone UTF-16 surrogate or U+0000 (both fail `p_body::jsonb`). */
// eslint-disable-next-line no-control-regex
const JSONB_UNSTORABLE_RE = /[\ud800-\udfff\u0000]/u

/**
 * api_pos_push casts the whole body to jsonb before it looks at any row (0052:735-739), so ONE lone surrogate or NUL in
 * any string or key anywhere in the body is a DY422 of the whole request — never a row verdict. The mock mirrors that.
 */
export function bodyJsonbRefuses(body: unknown): boolean {
  const stack: unknown[] = [body]
  while (stack.length > 0) {
    const v = stack.pop()
    if (typeof v === 'string') {
      if (JSONB_UNSTORABLE_RE.test(v)) return true
    } else if (Array.isArray(v)) {
      stack.push(...v)
    } else if (v !== null && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (JSONB_UNSTORABLE_RE.test(k)) return true
        stack.push(x)
      }
    }
  }
  return false
}

/** A verdict other than accepted/duplicate (dayo_pos_verdict). */
class Verdict extends Error {
  constructor(readonly status: 'rejected' | 'deferred', readonly reason: string, readonly detail: string) { super(reason) }
}
const reject = (reason: string, detail: string): never => { throw new Verdict('rejected', reason, detail) }
const defer = (reason: string, detail: string): never => { throw new Verdict('deferred', reason, detail) }

// ── dayo's value checks (0052:77-199) ──────────────────────────────────────────────────────────────────────────────
type J = Record<string, unknown>
const isObj = (v: unknown): v is J => v !== null && typeof v === 'object' && !Array.isArray(v)
/** dayo_pos_has: key present and not JSON null. */
const has = (o: J, k: string): boolean => o[k] !== undefined && o[k] !== null
const isUuid = (v: unknown): boolean => typeof v === 'string' && UUID_RE.test(v)
/** dayo_pos_is_text: 1..max characters, no C0/DEL control, not only spaces (btrim). */
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && [...v].length >= 1 && [...v].length <= max && !CONTROL_RE.test(v) && v.replace(/^ +| +$/g, '') !== ''
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const isPct = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 100
const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 99_999_999.99 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6
/** dayo_pos_ts: ISO-8601 with a zone → instant (ms), else null. */
function ts(v: unknown): number | null {
  if (typeof v !== 'string' || !TS_RE.test(v)) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}
/** dayo_pos_date: a real YYYY-MM-DD, else null. */
function ymd(v: unknown): string | null {
  if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return null
  const t = Date.parse(`${v}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null
}
/** to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') — seconds truncated. */
const utcZ = (t: number): string => `${new Date(t).toISOString().slice(0, 19)}Z`
const thaiDate = (t: number): string => bangkokDateOf(new Date(t).toISOString())
const minusDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10)
const canonical = (v: unknown): string => JSON.stringify(v, (_, x: unknown) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x))
const hashOf = (data: unknown): string => bytesToHex(sha256(utf8ToBytes(canonical(data))))
const staffOk = (s: MockState, id: string): boolean => s.catalog.staff.some((x) => x.id === id) // E1 staff = active + removed = dayo_pos_staff_ok

/** `testRaise` = header x-dayo-test-raise (dayo 0052:556-566): "XX000:<key>" makes that row raise XX000. */
export function judgeRow(s: MockState, raw: unknown, now: number, testRaise: string | null = null): ReceivedRowResult {
  const keyOut = isObj(raw) && typeof raw['key'] === 'string' ? clipCodePoints(raw['key'], 200) : null // dayo main 0052_pos_push.sql:748: null when the sent key is not a string
  try {
    return pushRow(s, raw, now, testRaise)
  } catch (e) {
    if (!(e instanceof Verdict)) throw e
    return { key: keyOut, status: e.status, reason: e.reason, detail: clipCodePoints(e.detail, 500) }
  }
}

function pushRow(s: MockState, raw: unknown, now: number, testRaise: string | null): ReceivedRowResult {
  if (!isObj(raw)) return reject('INVALID', 'แถวต้องเป็นออบเจกต์ {key, kind, data}')
  const key = raw['key']
  if (typeof key !== 'string' || [...key].length > 200 || !KEY_RE.test(key)) return reject('BAD_KEY', 'key ต้องเป็นรูป <kind>:<uuid>')
  if (testRaise !== null && testRaise === `XX000:${key}`) throw new Error('test_raise')
  const forced = takeOverride(s, key, isObj(raw['data']) ? raw['data'] : {}) // test hook: a forced verdict wins over every rule below
  if (forced !== null) return { key, ...forced }
  const kind = raw['kind']
  if (typeof kind !== 'string') return reject('INVALID', 'kind ต้องเป็นข้อความ')
  const [keyKind, keyUuid] = key.split(':') as [string, string]
  if (keyKind !== kind) return reject('BAD_KEY', 'ชนิดใน key ไม่ตรงกับ kind')
  if (!s.catalog.supported_kinds.includes(kind)) return defer('UNSUPPORTED', 'ชนิดแถวนี้ระบบกลางยังไม่รองรับ')
  const data = raw['data']
  if (!isObj(data)) return reject('INVALID', 'data ต้องเป็นออบเจกต์')
  const allowed = new Set(s.catalog.supported_fields[kind] ?? [])
  if (fieldsUsed(data).some((f) => !allowed.has(f))) return defer('UNSUPPORTED', 'มีฟิลด์ที่ระบบกลางยังไม่รองรับ')
  if (!s.scopes.includes('orders:write')) return reject('FORBIDDEN', 'API key ไม่มีสิทธิ์ orders:write') // unreachable: the route answers 403 first
  if (!isUuid(data['pos_order_id'])) return reject('INVALID', 'pos_order_id ต้องเป็น uuid ตัวเล็ก')
  if (keyUuid !== data['pos_order_id']) return reject('BAD_KEY', 'uuid ใน key ไม่ตรงกับ pos_order_id')
  // de-duplication (1): the key's content hash first
  const hash = hashOf(data)
  const seen = s.keys.get(key)
  if (seen !== undefined) return seen.hash === hash ? { ...seen.result, status: 'duplicate' } : reject('CONFLICT', 'key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว')
  const result = kind === 'order' ? judgeOrder(s, key, data, now) : judgeVoid(s, key, data, now)
  s.keys.set(key, { hash, result: { ...result, status: 'accepted' } }) // only accepted/duplicate reach this line
  return result
}

/** dayo_pos_order (0052:228-447). */
function judgeOrder(s: MockState, key: string, d: J, now: number): ReceivedRowResult {
  // ── shapes (INVALID) ──
  if (!isText(d['receipt_no'], 10) || !RECEIPT_RE.test(d['receipt_no'])) reject('INVALID', 'receipt_no ต้องเป็นรูป A-000123')
  if (!isInt(d['queue_no'], 1, 9999)) reject('INVALID', 'queue_no ต้องเป็นจำนวนเต็ม 1–9999')
  const saleDate = ymd(d['sale_date']) ?? reject('INVALID', 'sale_date ต้องเป็นวันที่ YYYY-MM-DD')
  const soldAt = ts(d['sold_at']) ?? reject('INVALID', 'sold_at ต้องเป็นเวลา ISO-8601 (UTC)')
  if (!isText(d['channel'], 100)) reject('INVALID', 'channel ต้องเป็นรหัสช่องทางขาย')
  if (!isText(d['payment'], 100)) reject('INVALID', 'payment ต้องเป็นรหัสวิธีชำระ')
  if (!isUuid(d['staff_id'])) reject('INVALID', 'staff_id ต้องเป็น uuid')
  if (!isInt(d['catalog_version'], 1, Number.MAX_SAFE_INTEGER)) reject('INVALID', 'catalog_version ต้องเป็นจำนวนเต็มตั้งแต่ 1')
  if (has(d, 'shift_id') && !isUuid(d['shift_id'])) reject('INVALID', 'shift_id ต้องเป็น uuid หรือ null')
  const rawLines = d['lines']
  if (!Array.isArray(rawLines) || rawLines.length < 1 || rawLines.length > 50) return reject('INVALID', 'lines ต้องมี 1–50 รายการ')
  let cups = 0
  rawLines.forEach((l: unknown, i) => {
    const bad = `รายการที่ ${i + 1} ข้อมูลไม่ครบหรือผิดรูป (code/size/sweetness/milk/grade/qty/ส่วนลด)`
    if (!isObj(l) || !isText(l['code'], 100) || !isText(l['size'], 20) || !isText(l['sweetness'], 10)
      || (l['milk'] !== 'fresh' && l['milk'] !== 'oat') || (has(l, 'grade') && !isText(l['grade'], 100)) || !isInt(l['qty'], 1, 999)
      || (has(l, 'free') && typeof l['free'] !== 'boolean') || (has(l, 'discount_baht') && !isMoney(l['discount_baht']))
      || (has(l, 'discount_percent') && !isPct(l['discount_percent'])) || (has(l, 'discount_reason') && !isText(l['discount_reason'], 200))) return reject('INVALID', bad)
    if (has(l, 'discount_baht') && has(l, 'discount_percent')) reject('INVALID', `รายการที่ ${i + 1} ส่งส่วนลดทั้งบาทและ % ไม่ได้`)
    cups += l['qty'] as number
  })
  if (cups > 500) reject('INVALID', 'too_large: บิลละไม่เกิน 500 แก้ว')
  const bill = d['bill_discount']
  if (has(d, 'bill_discount') && (!isObj(bill) || Object.keys(bill).some((k) => !['baht', 'percent', 'reason'].includes(k)) || has(bill, 'baht') === has(bill, 'percent')
    || (has(bill, 'baht') && !isMoney(bill['baht'])) || (has(bill, 'percent') && !isPct(bill['percent'])) || (has(bill, 'reason') && !isText(bill['reason'], 200)))) {
    reject('INVALID', 'bill_discount ต้องมี baht หรือ percent อย่างเดียว (+ reason)')
  }
  if (has(d, 'promo_code') && !isText(d['promo_code'], 100)) reject('INVALID', 'promo_code ต้องเป็นข้อความหรือ null')
  if (has(d, 'skip_promotion_ids') && (!Array.isArray(d['skip_promotion_ids']) || !d['skip_promotion_ids'].every(isUuid))) reject('INVALID', 'skip_promotion_ids ต้องเป็น array ของ uuid')
  if (has(d, 'no_promotions') && typeof d['no_promotions'] !== 'boolean') reject('INVALID', 'no_promotions ต้องเป็น true/false')
  const totals = d['totals']
  if (!isObj(totals) || Object.keys(totals).some((k) => !['items_subtotal', 'items_discount', 'bill_discount', 'total'].includes(k))
    || !isMoney(totals['items_subtotal']) || !isMoney(totals['items_discount']) || !isMoney(totals['bill_discount']) || !isMoney(totals['total'])) {
    reject('INVALID', 'totals ต้องมี items_subtotal, items_discount, bill_discount, total เป็นบาท ≥ 0 ทศนิยม ≤ 2 ตำแหน่ง')
  }
  if (has(d, 'note') && !isText(d['note'], 200)) reject('INVALID', 'note ยาวได้ไม่เกิน 200 ตัวอักษร')
  const o = normalizeOrder(d)

  // ── time: CLOCK_AHEAD before the date range (a fast clock past midnight is never a permanent reject) ──
  if (soldAt > now + FIVE_MIN) defer('CLOCK_AHEAD', `sold_at ${utcZ(soldAt)} เกินเวลาเซิร์ฟเวอร์`)
  if (saleDate !== thaiDate(soldAt)) reject('INVALID', `sale_date ${saleDate} ไม่ตรงกับวันที่ไทยของ sold_at (${thaiDate(soldAt)})`)
  const today = thaiDate(now)
  if (saleDate > today) defer('CLOCK_AHEAD', `sale_date ${saleDate} เป็นวันพรุ่งนี้ของเซิร์ฟเวอร์`)
  if (saleDate < minusDays(today, 60)) reject('INVALID', `วันขาย ${saleDate} ย้อนหลังเกิน 60 วัน`)

  // ── seller (active or removed) ──
  if (!staffOk(s, o.staff_id)) reject('UNKNOWN_STAFF', 'ไม่พบพนักงานผู้ขายของร้านนี้')

  // ── codes the shop never had (closed ones are still accepted — ADR-0049 rule 5) ──
  if (!s.known.channels.has(o.channel)) reject('UNKNOWN_CODE', `ไม่พบช่องทางขาย "${o.channel}"`)
  if (!s.known.payments.has(o.payment)) reject('UNKNOWN_CODE', `ไม่พบวิธีชำระ "${o.payment}"`)
  for (const l of o.lines) {
    const isMatcha = s.known.menus.get(l.code)
    if (isMatcha === undefined) reject('UNKNOWN_CODE', `ไม่พบเมนู "${l.code}"`)
    if (!s.known.variants.has(variantKey(l.code, l.size, l.sweetness))) reject('UNKNOWN_CODE', `ไม่พบ "${l.code} ${l.size} ${l.sweetness}"`)
    if (l.milk === 'oat' && !s.known.milk.has('oat')) reject('UNKNOWN_CODE', 'ไม่พบตัวเลือกนม "oat"')
    if (isMatcha === true && l.grade === null) reject('INVALID', `เมนูมัตจะ "${l.code}" ต้องระบุเกรด`)
    if (isMatcha === false && l.grade !== null) reject('INVALID', `เมนู "${l.code}" ไม่ใช่มัตจะ — grade ต้องเป็น null`)
    if (l.grade !== null && !s.known.grades.has(l.grade)) reject('UNKNOWN_CODE', `ไม่พบเกรด "${l.grade}"`)
  }

  // ── de-duplication (2): same pos_order_id = duplicate · same receipt, other pos_order_id = CONFLICT ──
  const existing = s.orders.get(o.pos_order_id)
  if (existing !== undefined) return { key, status: 'duplicate', data: orderData(s, existing, []) }
  if (s.receipts.has(o.receipt_no)) reject('CONFLICT', `เลขใบเสร็จ ${o.receipt_no} ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว`)

  // ── save (dayo create_order: re-quote at sold_at · freeze · amount_mismatch · pos_computed_total) ──
  if (s.mode === 'force_row_error') throw new Error('force_row_error') // the business step fails after every check above
  const computed = computedTotalAt(s, o, soldAt)
  const n = s.seq.get(o.sale_date) ?? 1
  const stored: StoredOrder = {
    orderNo: `L${o.sale_date.slice(2).replaceAll('-', '')}-${n < 1000 ? String(n).padStart(3, '0') : String(n)}`, posOrderId: o.pos_order_id, receiptNo: o.receipt_no,
    saleDate: o.sale_date, soldAt: o.sold_at, total: o.totals.total, status: 'ok', version: 1, staffId: o.staff_id, data: o,
    computedTotal: computed, amountMismatch: Math.abs(o.totals.total - computed) > 1, createdAt: now, updatedAt: null, dayoEdit: null,
  }
  s.seq.set(o.sale_date, n + 1)
  s.orders.set(stored.posOrderId, stored)
  s.receipts.set(stored.receiptNo, stored.posOrderId)
  return { key, status: 'accepted', data: orderData(s, stored, []) }
}

function normalizeOrder(d: J): MockOrderData {
  const bill = isObj(d['bill_discount']) ? d['bill_discount'] : null
  const t = d['totals'] as J
  const opt = <T>(o: J, k: string): T | null => (has(o, k) ? (o[k] as T) : null)
  return {
    pos_order_id: d['pos_order_id'] as string, receipt_no: d['receipt_no'] as string, queue_no: d['queue_no'] as number, sale_date: d['sale_date'] as string,
    sold_at: d['sold_at'] as string, channel: d['channel'] as string, payment: d['payment'] as string, staff_id: d['staff_id'] as string,
    catalog_version: d['catalog_version'] as number, shift_id: opt(d, 'shift_id'),
    lines: (d['lines'] as J[]).map((l): MockOrderLine => ({
      code: l['code'] as string, size: l['size'] as string, sweetness: l['sweetness'] as string, milk: l['milk'] as 'fresh' | 'oat', grade: opt(l, 'grade'),
      qty: l['qty'] as number, free: opt(l, 'free'), discount_baht: opt(l, 'discount_baht'), discount_percent: opt(l, 'discount_percent'), discount_reason: opt(l, 'discount_reason'),
    })),
    bill_discount: bill === null ? null : { baht: opt(bill, 'baht'), percent: opt(bill, 'percent'), reason: opt(bill, 'reason') },
    promo_code: opt(d, 'promo_code'), skip_promotion_ids: opt<string[]>(d, 'skip_promotion_ids') ?? [], no_promotions: opt<boolean>(d, 'no_promotions') ?? false,
    totals: { items_subtotal: t['items_subtotal'] as number, items_discount: t['items_discount'] as number, bill_discount: t['bill_discount'] as number, total: t['total'] as number },
    note: opt(d, 'note'),
  }
}

/** dayo_pos_order_data (0052:212-222): the bill as it is NOW (a duplicate sees a later version). */
export function orderData(s: MockState, o: StoredOrder, warnings: string[]): Record<string, unknown> {
  const dup = s.seedOrders.filter((b) => b.status === 'ok' && b.source !== 'pos' && b.sale_date === o.saleDate && b.totals.total === o.total && b.sold_at != null && Math.abs(Date.parse(b.sold_at) - Date.parse(o.soldAt)) <= 10 * 60_000).map((b) => b.order_no)
  return { order_no: o.orderNo, version: o.version, computed_total: o.computedTotal, amount_mismatch: o.amountMismatch, duplicate_of: dup, warnings }
}

/** dayo_pos_void (0052:452-534). */
function judgeVoid(s: MockState, key: string, d: J, now: number): ReceivedRowResult {
  const voidedAt = ts(d['voided_at']) ?? reject('INVALID', 'voided_at ต้องเป็นเวลา ISO-8601 (UTC)')
  if (!isUuid(d['staff_id'])) reject('INVALID', 'staff_id ต้องเป็น uuid')
  if (has(d, 'approved_by') && !isUuid(d['approved_by'])) reject('INVALID', 'approved_by ต้องเป็น uuid หรือ null')
  if (!isText(d['reason'], 200)) reject('INVALID', 'reason ต้องมี 1–200 ตัวอักษร')
  const approvedBy = has(d, 'approved_by') ? (d['approved_by'] as string) : null
  if (!staffOk(s, d['staff_id'] as string) || (approvedBy !== null && !staffOk(s, approvedBy))) reject('UNKNOWN_STAFF', 'ไม่พบพนักงานผู้ยกเลิก/ผู้อนุมัติของร้านนี้')
  if (voidedAt > now + FIVE_MIN) defer('CLOCK_AHEAD', `voided_at ${utcZ(voidedAt)} เกินเวลาเซิร์ฟเวอร์`)
  // checked before looking for the bill — an old void whose bill never came must not wait as PARENT_PENDING forever
  if (voidedAt < now - 60 * DAY) reject('INVALID', `voided_at ${utcZ(voidedAt)} ย้อนหลังเกิน 60 วัน`)
  const o = s.orders.get(d['pos_order_id'] as string) ?? defer('PARENT_PENDING', 'บิลที่จะยกเลิกยังมาไม่ถึง') // one key only: FORBIDDEN "not this device's bill" cannot happen
  if (o.status === 'cancelled') return { key, status: 'duplicate', data: { order_no: o.orderNo, version: o.version } }
  if (voidedAt < Date.parse(o.soldAt)) reject('INVALID', 'voided_at ต้องไม่ก่อน sold_at ของบิล')
  const day = thaiDate(voidedAt)
  if (day !== o.saleDate) reject('FORBIDDEN', `ยกเลิกได้เฉพาะวันเดียวกับวันขาย (voided_at ${day} ≠ sale_date ${o.saleDate})`)
  if (s.mode === 'force_row_error') throw new Error('force_row_error')
  o.status = 'cancelled'
  o.version += 1
  o.updatedAt = now
  return { key, status: 'accepted', data: { order_no: o.orderNo, version: o.version } }
}

function takeOverride(s: MockState, key: string, data: Record<string, unknown>): MockOverride['verdict'] | null {
  const i = s.overrides.findIndex((o) => (o.match.key !== undefined && o.match.key === key) || (o.match.receiptNo !== undefined && data['receipt_no'] === o.match.receiptNo))
  if (i === -1) return null
  const o = s.overrides[i]!
  o.times -= 1
  if (o.times <= 0) s.overrides.splice(i, 1)
  return o.verdict
}
