// packages/dayo-mock/src/judge.ts — one E2 row → one verdict. No node:* imports (sha256 from @noble/hashes).
// Check order = block-1 plan Task 3b Step 4 (ADR-0049): (a) → (b) → [(c) scope: the mock has no scopes] → (d) → (e) → (1) → (f) → (g) → (2).
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { bangkokDateOf, clipCodePoints, fieldsUsed, PushRow, type OrderRowData, type OrderVoidRowData, type ReceivedRowResult } from '@dayo/contracts'
import type { MockOverride, MockState, StoredOrder } from './state.js'

const FIVE_MIN = 5 * 60_000
const KEY_RE = /^([a-z_]+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
const SUBKEYS: Record<string, readonly string[]> = { bill_discount: ['baht', 'percent', 'reason'], totals: ['items_subtotal', 'items_discount', 'bill_discount', 'total'] }
const canonical = (v: unknown): string => JSON.stringify(v, (_, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x))
const hashOf = (data: unknown): string => bytesToHex(sha256(utf8ToBytes(canonical(data))))
const plus00 = (iso: string): string => iso.replace(/Z$/, '+00:00')
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const rejected = (key: string, reason: string, detail: string): ReceivedRowResult => ({ key, status: 'rejected', reason, detail: clipCodePoints(detail, 500) })
const deferred = (key: string, reason: string, detail: string): ReceivedRowResult => ({ key, status: 'deferred', reason, detail: clipCodePoints(detail, 500) })
const staffKnown = (s: MockState, id: string | null): boolean => id === null || s.catalog.staff.some((x) => x.id === id) // active or removed (spec §4.5 rule 4)

export function judgeRow(s: MockState, raw: unknown, now: number, serverTime: string): ReceivedRowResult {
  const r = isObj(raw) ? raw : {}
  const key = typeof r['key'] === 'string' ? clipCodePoints(r['key'], 200) : ''
  const data = isObj(r['data']) ? r['data'] : null
  // (a) row shape — texts as dayo_pos_push_row (block-1 Task 3b Step 4)
  if (typeof r['key'] !== 'string' || [...(r['key'] as string)].length < 1 || [...(r['key'] as string)].length > 200) return rejected(key, 'BAD_KEY', 'key ต้องเป็นข้อความ 1–200 ตัวอักษร รูป <kind>:<uuid>')
  if (typeof r['kind'] !== 'string' || data === null) return rejected(key, 'INVALID', 'แถวต้องมี kind (ข้อความ) และ data (object)')
  const kind = r['kind']
  const forced = takeOverride(s, key, data) // test hook: a forced verdict wins over every rule below
  if (forced !== null) return { key, ...forced }
  // (b) kind this dayo build does not know
  if (!s.catalog.supported_kinds.includes(kind)) return deferred(key, 'UNSUPPORTED', 'ชนิดแถวนี้ระบบกลางรุ่นนี้ยังไม่รองรับ')
  // (c) scope orders:write — the mock key always has it (401/403 are modes)
  // (d) key = <kind>:<uuid> and uuid = data.pos_order_id
  const m = KEY_RE.exec(key)
  if (m === null || m[1] !== kind || data['pos_order_id'] !== m[2]) return rejected(key, 'BAD_KEY', 'key ต้องเป็นรูป <kind>:<uuid> และ uuid ต้องตรงกับ pos_order_id')
  // (e) unknown fields — incl. unknown sub-keys of bill_discount / totals (block-1 interpretation 5)
  const allowed = new Set(s.catalog.supported_fields[kind] ?? [])
  const unknownSub = Object.entries(SUBKEYS).some(([f, subs]) => isObj(data[f]) && Object.keys(data[f] as object).some((k) => !subs.includes(k)))
  if (fieldsUsed(data).some((f) => !allowed.has(f)) || unknownSub) return deferred(key, 'UNSUPPORTED', 'มีฟิลด์ที่ระบบกลางรุ่นนี้ยังไม่รู้จัก')
  // (1) idempotency hash BEFORE any other check (spec §4.5 rule 0 (1))
  const hash = hashOf(data)
  const seen = s.keys.get(key)
  if (seen !== undefined) return seen.hash === hash ? { ...seen.result, status: 'duplicate' } : rejected(key, 'CONFLICT', 'key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว')
  // (f) field shapes
  const parsed = PushRow.safeParse(raw)
  if (!parsed.success) return rejected(key, 'INVALID', `รูปข้อมูลไม่ถูกต้อง: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`) // paths only, never values (§7 ข้อ 8)
  // (g) clock
  const t = parsed.data.kind === 'order' ? parsed.data.data.sold_at : parsed.data.data.voided_at
  if (Date.parse(t) > now + FIVE_MIN) return deferred(key, 'CLOCK_AHEAD', `เวลา ${plus00(t)} เร็วกว่าเวลาระบบกลาง ${serverTime} เกิน 5 นาที — ตรวจนาฬิกาเครื่องค่ะ`)
  // (2) — mode force_row_error = the business step fails (dayo's savepoint → SERVER_ERROR), after every check above
  if (s.mode === 'force_row_error') return deferred(key, 'SERVER_ERROR', 'SQLSTATE XX000')
  const result = parsed.data.kind === 'order' ? judgeOrder(s, key, parsed.data.data, now, serverTime) : judgeVoid(s, key, parsed.data.data)
  if (result.status === 'accepted' || result.status === 'duplicate') s.keys.set(key, { hash, result: { ...result, status: 'accepted' } }) // rejected/deferred never stored under the key
  return result
}

function judgeOrder(s: MockState, key: string, d: OrderRowData, now: number, serverTime: string): ReceivedRowResult {
  const existing = s.orders.get(d.pos_order_id)
  if (existing !== undefined) return { key, status: 'duplicate', data: acceptedData(s, existing) }                                   // (ก)
  const holder = s.receipts.get(d.receipt_no)
  if (holder !== undefined && holder !== d.pos_order_id) return rejected(key, 'CONFLICT', `เลขใบเสร็จ ${d.receipt_no} ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว`) // (ข)
  const today = bangkokDateOf(new Date(now).toISOString())
  if (d.sale_date > today) return deferred(key, 'CLOCK_AHEAD', `เวลา ${plus00(d.sold_at)} เร็วกว่าเวลาระบบกลาง ${serverTime} เกิน 5 นาที — ตรวจนาฬิกาเครื่องค่ะ`) // block-1 interpretation 3
  if (d.sale_date < bangkokDateOf(new Date(now - 60 * 86_400_000).toISOString())) return rejected(key, 'INVALID', `sale_date ${d.sale_date} เก่ากว่า 60 วัน`)
  if (!staffKnown(s, d.staff_id)) return rejected(key, 'UNKNOWN_STAFF', 'ผู้ขายไม่ใช่พนักงานของร้าน')
  const codes = new Set(s.catalog.catalog.variants.map((v) => v.menuCode))
  for (const l of d.lines) if (!codes.has(l.code)) return rejected(key, 'UNKNOWN_CODE', `ไม่พบเมนู "${clipCodePoints(l.code, 100)}"`)
  if (!s.catalog.catalog.channels.some((c) => c.code === d.channel)) return rejected(key, 'UNKNOWN_CODE', `ไม่พบช่องทาง "${clipCodePoints(d.channel, 100)}"`)
  if (!s.catalog.catalog.paymentMethods.some((p) => p.code === d.payment)) return rejected(key, 'UNKNOWN_CODE', `ไม่พบวิธีชำระ "${clipCodePoints(d.payment, 100)}"`)
  const n = s.seq.get(d.sale_date) ?? 1                                                                                                // (ค)
  s.seq.set(d.sale_date, n + 1)
  const o: StoredOrder = { orderNo: `L${d.sale_date.slice(2).replaceAll('-', '')}-${String(n).padStart(3, '0')}`, posOrderId: d.pos_order_id, receiptNo: d.receipt_no, saleDate: d.sale_date, soldAt: d.sold_at, total: d.totals.total, status: 'ok', version: 1, staffId: d.staff_id, data: d }
  s.orders.set(o.posOrderId, o)
  s.receipts.set(o.receiptNo, o.posOrderId)
  return { key, status: 'accepted', data: acceptedData(s, o) }
}

/** The mock does not re-price: computed_total = total (Task 14/21 force a difference with an override). */
function acceptedData(s: MockState, o: StoredOrder): Record<string, unknown> {
  const dup = s.seedOrders.filter((b) => b.status === 'ok' && b.source !== 'pos' && b.sale_date === o.saleDate && b.totals.total === o.total && b.sold_at != null && Math.abs(Date.parse(b.sold_at) - Date.parse(o.soldAt)) <= 10 * 60_000).map((b) => b.order_no)
  return { order_no: o.orderNo, version: o.version, computed_total: o.total, amount_mismatch: false, duplicate_of: dup, warnings: [] }
}

function judgeVoid(s: MockState, key: string, d: OrderVoidRowData): ReceivedRowResult {
  const o = s.orders.get(d.pos_order_id)
  if (o === undefined) return deferred(key, 'PARENT_PENDING', 'ยังไม่พบบิลนี้ในระบบกลาง')
  if (Date.parse(d.voided_at) < Date.parse(o.soldAt)) return rejected(key, 'INVALID', 'voided_at ต้องไม่ก่อน sold_at')
  const day = bangkokDateOf(d.voided_at)
  if (day !== o.saleDate) return rejected(key, 'FORBIDDEN', `ยกเลิกได้เฉพาะวันเดียวกับวันขาย (voided_at ${day} ≠ sale_date ${o.saleDate})`)
  if (o.status === 'cancelled') return { key, status: 'duplicate', data: { order_no: o.orderNo, version: o.version } }
  if (!staffKnown(s, d.staff_id) || !staffKnown(s, d.approved_by)) return rejected(key, 'UNKNOWN_STAFF', 'ผู้ยกเลิกหรือผู้อนุมัติไม่ใช่พนักงานของร้าน')
  o.status = 'cancelled'
  o.version += 1
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
