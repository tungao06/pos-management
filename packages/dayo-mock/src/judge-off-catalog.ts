// packages/dayo-mock/src/judge-off-catalog.ts — `order_off_catalog` (spec 04 §4.10 · D91 · D97 · R3-C · R4-2), dayo ADR-0069
// PHASE 2: not in dayo main 12885fe, so only a `block3Phase2` mock reaches it (preflight P1/P3). No node:* imports.
// Order of checks: shapes (INVALID) → time → staff → codes → closed_by owner → (2) the bill by pos_order_id → (3) the receipt
// → (4) the S1 closing conditions (FORBIDDEN rule:) → create (no order_items, no stock, pos_computed_total null).
// One key only: "an off-catalog bill of another key" (off_catalog_exists:) cannot happen here.
import { RECEIPT_NO_RE, type ReceivedRowResult } from '@dayo/contracts'
import { checkTime, ownerActive } from './judge-shift.js'
import { cents, defer, existsData, FIVE_MIN, has, isInt, isMoney, isObj, isText, isUuid, issueOrderNo, reject, staffOk, thaiDate, ts, utcZ, ymd, type J } from './judge-util.js'
import type { MockOrderData, MockState, StoredOrder } from './state.js'

const LINE_KEYS = ['code', 'name', 'size', 'sweetness', 'qty', 'unit_price', 'discount_per_cup', 'line_total']
const TOTAL_KEYS = ['items_subtotal', 'items_discount', 'bill_discount', 'total']
const REASON_CODE_RE = /^[A-Z_]{1,40}$/
/** 00:00 Bangkok of a YYYY-MM-DD, in ms. */
const thaiMidnight = (d: string): number => Date.parse(`${d}T00:00:00+07:00`)
const nullOrText = (v: unknown, max: number): boolean => v === null || isText(v, max)

export function judgeOffCatalog(s: MockState, key: string, d: J, now: number): ReceivedRowResult {
  // ── shapes (INVALID) — the order row's rules for the shared fields ──
  if (!isText(d['receipt_no'], 10) || !RECEIPT_NO_RE.test(d['receipt_no'])) reject('INVALID', 'receipt_no ต้องเป็นรูป A-000123')
  if (!isInt(d['queue_no'], 1, 9999)) reject('INVALID', 'queue_no ต้องเป็นจำนวนเต็ม 1–9999')
  const saleDate = ymd(d['sale_date']) ?? reject('INVALID', 'sale_date ต้องเป็นวันที่ YYYY-MM-DD')
  const soldAt = ts(d['sold_at']) ?? reject('INVALID', 'sold_at ต้องเป็นเวลา ISO-8601 (UTC)')
  if (!isText(d['channel'], 100)) reject('INVALID', 'channel ต้องเป็นรหัสช่องทางขาย')
  if (!isText(d['payment'], 100)) reject('INVALID', 'payment ต้องเป็นรหัสวิธีชำระ')
  if (!isUuid(d['staff_id'])) reject('INVALID', 'staff_id ต้องเป็น uuid')
  if (!isInt(d['catalog_version'], 1, Number.MAX_SAFE_INTEGER)) reject('INVALID', 'catalog_version ต้องเป็นจำนวนเต็มตั้งแต่ 1')
  if (has(d, 'shift_id') && !isUuid(d['shift_id'])) reject('INVALID', 'shift_id ต้องเป็น uuid หรือ null')
  if (has(d, 'note') && !isText(d['note'], 200)) reject('INVALID', 'note ยาวได้ไม่เกิน 200 ตัวอักษร')
  const lines = d['lines']
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50) return reject('INVALID', 'lines ต้องมี 1–50 รายการ')
  let sub = 0 // satang
  let idisc = 0
  lines.forEach((l: unknown, i) => {
    if (!isObj(l) || Object.keys(l).some((k) => !LINE_KEYS.includes(k)) || !nullOrText(l['code'], 40) || !isText(l['name'], 100) || !nullOrText(l['size'], 20)
      || !nullOrText(l['sweetness'], 10) || !isInt(l['qty'], 1, 999) || !isMoney(l['unit_price']) || !isMoney(l['discount_per_cup']) || !isMoney(l['line_total'])) {
      return reject('INVALID', `รายการที่ ${i + 1} ข้อมูลไม่ครบหรือผิดรูป (code/name/size/sweetness/qty/unit_price/discount_per_cup/line_total)`)
    }
    const [unit, disc, qty] = [cents(l['unit_price']), cents(l['discount_per_cup']), l['qty']]
    if (disc > unit || cents(l['line_total']) !== (unit - disc) * qty) reject('INVALID', `รายการที่ ${i + 1} line_total ต้องเท่ากับ (unit_price − discount_per_cup) × qty`)
    sub += unit * qty
    idisc += disc * qty
  })
  const t = d['totals']
  if (!isObj(t) || Object.keys(t).some((k) => !TOTAL_KEYS.includes(k)) || !TOTAL_KEYS.every((k) => isMoney(t[k]))) {
    return reject('INVALID', 'totals ต้องมี items_subtotal, items_discount, bill_discount, total เป็นบาท ≥ 0 ทศนิยม ≤ 2 ตำแหน่ง')
  }
  const [tSub, tIdisc, tBill, total] = TOTAL_KEYS.map((k) => cents(t[k] as number)) as [number, number, number, number]
  if (tSub !== sub || tIdisc !== idisc || tIdisc + tBill > tSub || total !== Math.max(0, tSub - tIdisc - tBill)) {
    reject('INVALID', 'totals ไม่ตรงกับรายการ (items_subtotal/items_discount/total · ส่วนลดรวมต้องไม่เกิน items_subtotal)')
  }
  if (!isUuid(d['closed_by'])) reject('INVALID', 'closed_by ต้องเป็น uuid')
  const closedAt = ts(d['closed_at']) ?? reject('INVALID', 'closed_at ต้องเป็นเวลา ISO-8601 (UTC)')
  if (!isText(d['reason'], 200)) reject('INVALID', 'reason ต้องมี 1–200 ตัวอักษร')
  if (typeof d['original_reason'] !== 'string' || !REASON_CODE_RE.test(d['original_reason'])) reject('INVALID', 'original_reason ต้องเป็นรหัสเหตุผล A–Z/_ ไม่เกิน 40 ตัว')

  // ── time: the order row's future rules · NO 60-day floor on sold_at (§6.4 dead ends) · closed_at carries it instead ──
  if (soldAt > now + FIVE_MIN) defer('CLOCK_AHEAD', `sold_at ${utcZ(soldAt)} เกินเวลาเซิร์ฟเวอร์`)
  if (saleDate !== thaiDate(soldAt)) reject('INVALID', `sale_date ${saleDate} ไม่ตรงกับวันที่ไทยของ sold_at (${thaiDate(soldAt)})`)
  if (saleDate > thaiDate(now)) defer('CLOCK_AHEAD', `sale_date ${saleDate} เป็นวันพรุ่งนี้ของเซิร์ฟเวอร์`)
  checkTime(closedAt, now, 'closed_at')
  if (closedAt < soldAt) reject('INVALID', 'closed_at ต้องไม่ก่อน sold_at')

  // ── people · codes (closed ones still count — ADR-0049 rule 5) · the owner who closed it ──
  const o = normalize(d)
  if (!staffOk(s, o.staff_id)) reject('UNKNOWN_STAFF', 'ไม่พบพนักงานผู้ขายของร้านนี้')
  const closedBy = d['closed_by'] as string
  if (!staffOk(s, closedBy)) reject('UNKNOWN_STAFF', 'ไม่พบพนักงานผู้ปิดบิลของร้านนี้')
  if (!s.known.channels.has(o.channel)) reject('UNKNOWN_CODE', `ไม่พบช่องทางขาย "${o.channel}"`)
  if (!s.known.payments.has(o.payment)) reject('UNKNOWN_CODE', `ไม่พบวิธีชำระ "${o.payment}"`)
  if (!ownerActive(s, closedBy)) reject('FORBIDDEN', 'role: ผู้ปิดบิลนอกแคตตาล็อกต้องเป็นเจ้าของที่ใช้งานอยู่ ณ เวลาปิด')

  // ── (2) the bill by pos_order_id (R4-2) · (3) the receipt ──
  const existing = s.orders.get(o.pos_order_id)
  if (existing !== undefined) {
    if (existing.offCatalog) return { key, status: 'duplicate', data: { order_no: existing.orderNo, version: existing.version } }
    reject('CONFLICT', `exists: ${existing.orderNo} บิลนี้อยู่ในระบบกลางแล้ว`, existsData(existing))
  }
  if (s.receipts.has(o.receipt_no)) reject('CONFLICT', `receipt_taken: เลขใบเสร็จ ${o.receipt_no} ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว`)

  // ── (4) the S1 closing conditions (R3-C): a real rejected order row · the block3_live_from floor · the per-bill cap ──
  const reasons = s.rejections.get(o.pos_order_id)
  if (reasons === undefined) reject('FORBIDDEN', 'rule: ไม่มีประวัติแถว order ที่ถูกปฏิเสธของบิลนี้')
  if (!reasons!.has(d['original_reason'] as string)) reject('FORBIDDEN', 'rule: original_reason ไม่ตรงกับเหตุผลที่ระบบกลางเคยปฏิเสธบิลนี้')
  if (s.block3LiveFrom === null) reject('FORBIDDEN', 'rule: ร้านยังไม่มีวันเริ่มใช้งานก้อน 3 (block3_live_from)')
  if (soldAt < thaiMidnight(s.block3LiveFrom!)) reject('FORBIDDEN', 'rule: sold_at ก่อนวันเริ่มใช้งานก้อน 3 ของร้าน (block3_live_from)')
  if (total > cents(s.offCatalogCap)) reject('FORBIDDEN', 'rule: ยอดเกินเพดานบิลนอกแคตตาล็อก')

  // ── create ──
  if (s.mode === 'force_row_error') throw new Error('force_row_error') // the business step fails after every check above
  const stored: StoredOrder = {
    orderNo: issueOrderNo(s, o.sale_date), posOrderId: o.pos_order_id, receiptNo: o.receipt_no, saleDate: o.sale_date, soldAt: o.sold_at, total: o.totals.total,
    status: 'ok', version: 1, staffId: o.staff_id, data: o, offCatalog: true,
    computedTotal: o.totals.total, amountMismatch: false, createdAt: now, updatedAt: null, dayoEdit: null, // pos_computed_total is null in dayo (it cannot price the bill)
  }
  s.orders.set(stored.posOrderId, stored)
  s.receipts.set(stored.receiptNo, stored.posOrderId)
  return { key, status: 'accepted', data: { order_no: stored.orderNo, version: stored.version } }
}

/** The bill as E3 and the recompute read it: no menu lines (off_catalog_lines, not order_items), no promotions. */
function normalize(d: J): MockOrderData {
  const t = d['totals'] as J
  return {
    pos_order_id: d['pos_order_id'] as string, receipt_no: d['receipt_no'] as string, queue_no: d['queue_no'] as number, sale_date: d['sale_date'] as string,
    sold_at: d['sold_at'] as string, channel: d['channel'] as string, payment: d['payment'] as string, staff_id: d['staff_id'] as string,
    catalog_version: d['catalog_version'] as number, shift_id: has(d, 'shift_id') ? (d['shift_id'] as string) : null, lines: [], bill_discount: null,
    promo_code: null, skip_promotion_ids: [], no_promotions: false, note: has(d, 'note') ? (d['note'] as string) : null,
    totals: { items_subtotal: t['items_subtotal'] as number, items_discount: t['items_discount'] as number, bill_discount: t['bill_discount'] as number, total: t['total'] as number },
  }
}
