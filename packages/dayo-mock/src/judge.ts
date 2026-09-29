// packages/dayo-mock/src/judge.ts — one E2 row → one verdict. No node:* imports (sha256 from @noble/hashes).
// A port of dayo main supabase/migrations/0052_pos_push.sql: dayo_pos_push_row (539-629; row checks 555-620) → dayo_pos_order (228-447) /
// dayo_pos_void (452-534), same checks in the same order with dayo's reason and detail texts. A verdict is thrown (dayo raises
// DYPV0 and its savepoint undoes the row); any other exception reaches the handler, which makes it this row's
// deferred SERVER_ERROR (dayo_pos_map_error). State changes only after every check passed.
// Block 3 (dayo main 12885fe · 0066_pos_push_shift_kinds.sql): dayo_pos_push_row (0066:614-718) adds the per-row shift:write
// step, the id field per kind and key_changed: of the shift kinds; dayo_pos_dispatch sends the four shift kinds to judge-shift.ts;
// api_pos_push records every rejected `order` row in pos_push_rejections (0066:993-1002). Phase 2 (not shipped — preflight P3):
// order_off_catalog (judge-off-catalog.ts), off_catalog_exists: on order rows, and the recompute of every Z (recompute.ts).
import { clipCodePoints, fieldsUsed, KIND_ID_FIELD, MAX_MANUAL_PROMOTIONS, trimWs, type PushKind, type ReceivedRowResult } from '@dayo/contracts'
import { computedTotalAt, manualReasonRequiredAt } from './reprice.js'
import { judgeOffCatalog } from './judge-off-catalog.js'
import { conflictShiftOf, flagConflict, judgeCashCount, judgeCashMovement, judgeShiftClose, judgeShiftOpen, SHIFT_KINDS } from './judge-shift.js'
import { DAY, defer, existsData, FIVE_MIN, has, hashOf, isInt, isMoney, isObj, isPct, isText, isUuid, issueOrderNo, minusDays, reject, staffOk, thaiDate, ts, utcZ, Verdict, ymd, type J } from './judge-util.js'
import { recomputeAll } from './recompute.js'
import { variantKey, type MockOrderData, type MockOrderLine, type MockOverride, type MockState, type StoredOrder } from './state.js'

const KEY_RE = /^[a-z][a-z_]{0,39}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const RECEIPT_RE = /^[A-Z]{1,3}-[0-9]{6}$/
/** Text Postgres jsonb cannot hold: a lone UTF-16 surrogate or U+0000 (both fail `p_body::jsonb`). */
// eslint-disable-next-line no-control-regex
const JSONB_UNSTORABLE_RE = /[\ud800-\udfff\u0000]/u
/** Rule 6 of the recompute (spec 04 §4.10): an accepted row of these kinds may change a Z. */
const RECOMPUTE_KINDS: ReadonlySet<string> = new Set(['order', 'order_void', 'order_off_catalog', 'cash_movement', 'shift_close'])
const REASON_CODE_RE = /^[A-Z_]{1,40}$/
/** 0069:1628-1630: what manual_promotion_reason may not hold ON TOP of dayo_pos_is_text — C1, zero-width, bidi, line/paragraph separators. */
const MANUAL_REASON_BAD_RE = /[\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069]/

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

/** `testRaise` = header x-dayo-test-raise (dayo 0052:556-566): "XX000:<key>" makes that row raise XX000. */
export function judgeRow(s: MockState, raw: unknown, now: number, testRaise: string | null = null): ReceivedRowResult {
  const keyOut = isObj(raw) && typeof raw['key'] === 'string' ? clipCodePoints(raw['key'], 200) : null // dayo main 0052_pos_push.sql:748: null when the sent key is not a string
  let result: ReceivedRowResult
  try {
    result = pushRow(s, raw, now, testRaise)
  } catch (e) {
    if (!(e instanceof Verdict)) throw e
    result = { key: keyOut, status: e.status, reason: e.reason, detail: clipCodePoints(e.detail, 500), ...(e.data === undefined ? {} : { data: e.data }) }
  }
  recordRejection(s, raw, result)
  return result
}

/**
 * pos_push_rejections (0066:993-1002 · dayo phase 1), outside the row's savepoint: a `rejected` row whose `kind` (read from
 * the row, not the key) is 'order' with a uuid pos_order_id and an A–Z/_ reason — a test override's verdict too. Every
 * reason is kept once (unique (api_client_id, pos_order_id, reason)). A block-2 dayo (before 0066) has no such table.
 */
function recordRejection(s: MockState, raw: unknown, r: ReceivedRowResult): void {
  if (!s.block3 || r.status !== 'rejected' || !isObj(raw) || raw['kind'] !== 'order' || !isObj(raw['data'])) return
  const id = raw['data']['pos_order_id']
  const reason = (r as { reason?: unknown }).reason
  if (!isUuid(id) || typeof reason !== 'string' || !REASON_CODE_RE.test(reason)) return
  const reasons = s.rejections.get(id) ?? new Set<string>()
  reasons.add(reason)
  s.rejections.set(id, reasons)
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
  // dayo 0066:672-675 — the ONE place `scope:` comes from: a shift row of a key without shift:write (a bill in the same request passes)
  if (SHIFT_KINDS.has(kind) && !s.scopes.includes('shift:write')) return reject('FORBIDDEN', 'scope: API key ไม่มีสิทธิ์ shift:write')
  const idField = KIND_ID_FIELD[kind as PushKind] ?? 'pos_order_id' // dayo_pos_id_field (0066:38-46)
  if (!isUuid(data[idField])) return reject('INVALID', `${idField} ต้องเป็น uuid ตัวเล็ก`)
  if (keyUuid !== data[idField]) return reject('BAD_KEY', `uuid ใน key ไม่ตรงกับ ${idField}`)
  // de-duplication (1): the key's content hash first
  const hash = hashOf(data)
  const seen = s.keys.get(key)
  if (seen !== undefined) {
    if (seen.hash === hash) return { ...seen.result, status: 'duplicate' }
    // 0066:696-700: a shift row whose content changed under its key = shift data conflict (S5) · a bill row keeps the
    // block-2 text (its key_changed: prefix is dayo phase 2 — preflight D3)
    if (SHIFT_KINDS.has(kind)) {
      flagConflict(s, 'key_changed', conflictShiftOf(s, kind, data))
      return reject('CONFLICT', 'key_changed: key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว')
    }
    return reject('CONFLICT', `${s.block3Phase2 ? 'key_changed: ' : ''}key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว`)
  }
  const result = judgeKind(s, kind, key, data, now)
  s.keys.set(key, { hash, result: { ...result, status: 'accepted' } }) // only accepted/duplicate reach this line
  if (result.status === 'accepted' && RECOMPUTE_KINDS.has(kind)) recomputeAll(s) // a no-op on a phase-1 mock
  return result
}

/** dayo_pos_dispatch (0066:566-583). */
function judgeKind(s: MockState, kind: string, key: string, d: J, now: number): ReceivedRowResult {
  switch (kind) {
    case 'order': return judgeOrder(s, key, d, now)
    case 'order_void': return judgeVoid(s, key, d, now)
    case 'shift_open': return judgeShiftOpen(s, key, d, now)
    case 'cash_movement': return judgeCashMovement(s, key, d, now)
    case 'cash_count': return judgeCashCount(s, key, d, now)
    case 'shift_close': return judgeShiftClose(s, key, d, now)
    case 'order_off_catalog': if (s.block3Phase2) return judgeOffCatalog(s, key, d, now) // dayo phase 2 only (preflight P3)
      return defer('UNSUPPORTED', 'ชนิดแถวนี้ระบบกลางยังไม่รองรับ')
    default: return defer('UNSUPPORTED', 'ชนิดแถวนี้ระบบกลางยังไม่รองรับ')
  }
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
  // 0069:1620-1633 (dayo ≥ 0069 only — an older dayo defers the row UNSUPPORTED at the field list above)
  if (has(d, 'manual_promotion_ids') && (!Array.isArray(d['manual_promotion_ids']) || !d['manual_promotion_ids'].every(isUuid))) reject('INVALID', 'manual_promotion_ids ต้องเป็น array ของ uuid')
  if (has(d, 'manual_promotion_reason') && (!isText(d['manual_promotion_reason'], 200) || MANUAL_REASON_BAD_RE.test(d['manual_promotion_reason']))) {
    reject('INVALID', 'manual_promotion_reason ต้องเป็นข้อความ 1–200 ตัวอักษร หรือ null')
  }
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
  // phase 2 (§4.10 order_off_catalog rule 2): the bill is an off-catalog bill now → never a duplicate of this order row ·
  // phase 1 keeps the block-2 answer (same pos_order_id = duplicate), like its other bill-row texts (preflight D3)
  if (s.block3Phase2 && existing?.offCatalog === true) reject('CONFLICT', `off_catalog_exists: ${existing.orderNo}`, existsData(existing))
  if (existing !== undefined) return { key, status: 'duplicate', data: orderData(s, existing, []) }
  // the receipt_taken: prefix of a bill row is dayo phase 2 (0066:5 · preflight D3) — phase 1 keeps the block-2 text
  if (s.receipts.has(o.receipt_no)) reject('CONFLICT', `${s.block3Phase2 ? 'receipt_taken: ' : ''}เลขใบเสร็จ ${o.receipt_no} ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว`)

  // ── save (dayo create_order: re-quote at sold_at · freeze · amount_mismatch · pos_computed_total) ──
  if (s.mode === 'force_row_error') throw new Error('force_row_error') // the business step fails after every check above
  // dayo_create_order → dayo_quote (0069): the draft's manual list (dayo_draft_manual_promotions: DY422 too_large) · then the
  // reason guard on dayo's OWN quote at sold_at (0069:1096-1098) — both DY422 → rejected INVALID (dayo_pos_map_error)
  if (o.manual_promotion_ids.length > MAX_MANUAL_PROMOTIONS) reject('INVALID', 'too_large: เลือกโปรเองได้ไม่เกิน 20 ตัวต่อบิล')
  if (o.manual_promotion_ids.length > 0 && o.manual_promotion_reason === null && manualReasonRequiredAt(s, o, soldAt)) {
    reject('INVALID', 'reason_required: โปรที่เลือกเองทำให้บิลเหลือ ฿0 ต้องใส่เหตุผลค่ะ')
  }
  const { computed, warnings } = computedTotalAt(s, o, soldAt)
  const stored: StoredOrder = {
    orderNo: issueOrderNo(s, o.sale_date), posOrderId: o.pos_order_id, receiptNo: o.receipt_no,
    saleDate: o.sale_date, soldAt: o.sold_at, total: o.totals.total, status: 'ok', version: 1, staffId: o.staff_id, data: o, offCatalog: false,
    computedTotal: computed, amountMismatch: Math.abs(o.totals.total - computed) > 1, createdAt: now, updatedAt: null, dayoEdit: null,
  }
  s.orders.set(stored.posOrderId, stored)
  s.receipts.set(stored.receiptNo, stored.posOrderId)
  return { key, status: 'accepted', data: orderData(s, stored, warnings) }
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
    manual_promotion_ids: [...new Set(opt<string[]>(d, 'manual_promotion_ids') ?? [])],
    manual_promotion_reason: manualReasonOf(opt<string>(d, 'manual_promotion_reason')),
  }
}

/** dayo_draft_manual_reason (0069:322-345): cut by dayo_trim_ws · nothing left = null. */
function manualReasonOf(raw: string | null): string | null {
  if (raw === null) return null
  const t = trimWs(raw)
  return t === '' ? null : t
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
