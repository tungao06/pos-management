// packages/dayo-mock/src/judge-shift.ts — the four shift kinds of E2 (spec 04 §4.10) as dayo main 12885fe ships them
// (ADR-0069 phase 1 · supabase/migrations/0066_pos_push_shift_kinds.sql): dayo_pos_shift_open (58-132), dayo_pos_cash_movement
// (137-226), dayo_pos_cash_count (231-320), dayo_pos_shift_close (325-561) — same checks, same order, same detail texts
// (preflight P7/D6: when a row breaks several rules, dayo's first check decides). No node:* imports.
// The mock holds ONE key, so dayo's `rule:` (an id or shift of another key) cannot happen here.
import { CASH_DENOMINATIONS_BAHT, BOT_ORDER_NO_RE, RECEIPT_NO_RE, type ReceivedRowResult } from '@dayo/contracts'
import { botCashBills } from './shift-cash.js'
import { cents, DAY, defer, FIVE_MIN, has, isInt, isMoney, isObj, isText, isUuid, minusDays, reject, staffOk, thaiDate, ts, utcZ, ymd, type J } from './judge-util.js'
import type { MockCount, MockState, MockZ } from './state.js'

const INT32_MAX = 2_147_483_647
const Z_KEYS = ['z_no', 'hash', 'prev_hash', 'chain_warning', 'variance_alert', 'cash', 'counted', 'bot_window', 'movement_ids', 'bot_bills', 'pos_bills']
const CASH_KEYS = ['opening_float', 'pos_cash_sales', 'void_refunds', 'paid_in', 'paid_out', 'drops', 'drawer_expenses', 'bot_cash']
const HEX64_RE = /^[0-9a-f]{64}$/

/** The kinds dayo_pos_is_shift_kind names (0066:48-53). */
export const SHIFT_KINDS: ReadonlySet<string> = new Set(['shift_open', 'cash_movement', 'cash_count', 'shift_close'])

/**
 * dayo_pos_record_shift_conflict (0066:830-905) — the S5 "shift data conflict" flag, written OUTSIDE the row's savepoint
 * (call it before the reject): the mock logs `<kind>:<shift id>` and sets the shift's data_conflict when the shift is known.
 * Kinds as the mock names them ('z_no_ceiling' is dayo's 'z_no_range').
 */
export function flagConflict(s: MockState, kind: string, shiftId: string | null): void {
  s.conflicts.push(`${kind}:${shiftId}`)
  const shift = shiftId === null ? undefined : s.shifts.get(shiftId)
  if (shift !== undefined) shift.dataConflict = true
}

/** The shift a conflicting row belongs to (0066:853-866): the stored row's shift first, then the shift_id it sent — known shifts only. */
export function conflictShiftOf(s: MockState, kind: string, d: J): string | null {
  let id: string | null = null
  if (kind === 'shift_open' || kind === 'shift_close') id = isUuid(d['shift_id']) ? d['shift_id'] : null
  else if (kind === 'cash_movement') id = s.movements.get(String(d['movement_id']))?.shiftId ?? null
  else if (kind === 'cash_count') id = s.counts.get(String(d['count_id']))?.shiftId ?? null
  if (id === null && isUuid(d['shift_id'])) id = d['shift_id']
  return id !== null && s.shifts.has(id) ? id : null
}

/** spec §4.10 time: the row's main time > server + 5 min = CLOCK_AHEAD · older than server − 60 days = INVALID (0066:88-95). */
export function checkTime(t: number, now: number, name: string): void {
  if (t > now + FIVE_MIN) defer('CLOCK_AHEAD', `${name} ${utcZ(t)} เกินเวลาเซิร์ฟเวอร์`)
  if (t < now - 60 * DAY) reject('INVALID', `${name} ${utcZ(t)} ย้อนหลังเกิน 60 วัน`)
}
/** dayo_pos_owner_active_at (0065:346) simplified (m6): the owner's status now, not at the row's time. */
export const ownerActive = (s: MockState, id: string): boolean => s.catalog.staff.some((x) => x.id === id && x.role === 'owner' && x.active)
const countOf = (s: MockState, shiftId: string): MockCount | undefined => [...s.counts.values()].find((c) => c.shiftId === shiftId)
const failRowError = (s: MockState): void => { if (s.mode === 'force_row_error') throw new Error('force_row_error') } // the business step fails after every check
/** btrim(text) — dayo stores reasons trimmed of spaces. */
const btrim = (v: string): string => v.replace(/^ +| +$/g, '')

/** dayo_pos_shift_open (0066:58-132). */
export function judgeShiftOpen(s: MockState, key: string, d: J, now: number): ReceivedRowResult {
  const businessDate = ymd(d['business_date']) ?? reject('INVALID', 'business_date ต้องเป็นวันที่ YYYY-MM-DD')
  const openedAt = ts(d['opened_at']) ?? reject('INVALID', 'opened_at ต้องเป็นเวลา ISO-8601 (UTC)')
  if (!isUuid(d['opened_by'])) reject('INVALID', 'opened_by ต้องเป็น uuid')
  if (!isMoney(d['opening_float'])) reject('INVALID', 'opening_float ต้องเป็นบาท ≥ 0 ทศนิยมไม่เกิน 2 ตำแหน่ง')
  if (typeof d['quick_open'] !== 'boolean') reject('INVALID', 'quick_open ต้องเป็น true/false')
  checkTime(openedAt, now, 'opened_at')
  if (businessDate !== thaiDate(openedAt)) reject('INVALID', `business_date ${businessDate} ไม่ตรงกับวันที่ไทยของ opened_at (${thaiDate(openedAt)})`)
  if (businessDate > thaiDate(now)) defer('CLOCK_AHEAD', `business_date ${businessDate} เป็นวันพรุ่งนี้ของเซิร์ฟเวอร์`)
  const by = d['opened_by'] as string
  if (!staffOk(s, by)) reject('UNKNOWN_STAFF', 'ไม่พบพนักงานผู้เปิดกะของร้านนี้')
  if (d['quick_open'] === true && !ownerActive(s, by)) reject('FORBIDDEN', 'role: เปิดกะด่วนต้องเป็นเจ้าของที่ใช้งานอยู่ ณ เวลาเปิดกะ')
  const id = d['shift_id'] as string
  if (s.shifts.has(id)) return { key, status: 'duplicate', data: { shift_id: id } }
  failRowError(s)
  s.shifts.set(id, { id, businessDate, openedAt, openedBy: by, openingFloat: d['opening_float'] as number, quickOpen: d['quick_open'] as boolean, status: 'open', closedBy: null, closedAt: null, dataConflict: false })
  // ADR-0056 rule 12 · D100: the day block 3 went live — set once, only from a shift of today/yesterday (0066:118-126)
  if (s.block3LiveFrom === null && businessDate >= minusDays(thaiDate(now), 1)) s.block3LiveFrom = businessDate
  return { key, status: 'accepted', data: { shift_id: id } }
}

/** dayo_pos_cash_movement (0066:137-226) — the id is looked up BEFORE the parent shift (0066:200-215). */
export function judgeCashMovement(s: MockState, key: string, d: J, now: number): ReceivedRowResult {
  if (!isUuid(d['shift_id'])) reject('INVALID', 'shift_id ต้องเป็น uuid')
  const kind = d['kind']
  if (kind !== 'PAID_IN' && kind !== 'PAID_OUT' && kind !== 'DROP' && kind !== 'VOID_REFUND') return reject('INVALID', 'kind ต้องเป็น PAID_IN/PAID_OUT/DROP/VOID_REFUND')
  if (!isMoney(d['amount']) || d['amount'] === 0) reject('INVALID', 'amount ต้องเป็นบาท > 0 ทศนิยมไม่เกิน 2 ตำแหน่ง')
  let orderId: string | null = null
  if (kind === 'VOID_REFUND') {
    if (!isUuid(d['pos_order_id'])) reject('INVALID', 'VOID_REFUND ต้องมี pos_order_id')
    orderId = d['pos_order_id'] as string
    if (has(d, 'reason') && !isText(d['reason'], 200)) reject('INVALID', 'reason ต้องมี 1–200 ตัวอักษรหรือ null')
  } else {
    if (has(d, 'pos_order_id')) reject('INVALID', 'pos_order_id ใช้กับ VOID_REFUND เท่านั้น')
    if (!isText(d['reason'], 200)) reject('INVALID', 'reason ต้องมี 1–200 ตัวอักษร (PAID_IN/PAID_OUT/DROP)')
  }
  const reason = has(d, 'reason') ? btrim(d['reason'] as string) : null
  if (!isUuid(d['created_by'])) reject('INVALID', 'created_by ต้องเป็น uuid')
  const createdAt = ts(d['created_at']) ?? reject('INVALID', 'created_at ต้องเป็นเวลา ISO-8601 (UTC)')
  checkTime(createdAt, now, 'created_at')
  if (!staffOk(s, d['created_by'] as string)) reject('UNKNOWN_STAFF', 'ไม่พบพนักงานผู้บันทึกของร้านนี้')
  const id = d['movement_id'] as string
  if (s.movements.has(id)) return { key, status: 'duplicate', data: { movement_id: id } }
  const shift = s.shifts.get(d['shift_id'] as string) ?? defer('PARENT_PENDING', 'กะที่อ้างยังมาไม่ถึง')
  if (createdAt < shift.openedAt) reject('INVALID', 'created_at ต้องไม่ก่อนเวลาเปิดกะ')
  const c = countOf(s, shift.id)
  if (c !== undefined && createdAt > c.countedAt) reject('INVALID', 'created_at หลังเวลานับเงินของกะ (กะหยุดรับเงินเข้า-ออกแล้ว)')
  failRowError(s)
  s.movements.set(id, { id, shiftId: shift.id, kind, amount: d['amount'] as number, posOrderId: orderId, reason, createdBy: d['created_by'] as string, createdAt })
  return { key, status: 'accepted', data: { movement_id: id } }
}

/** dayo_pos_cash_count (0066:231-320) — one count per shift; a second one = CONFLICT counted: + S5. */
export function judgeCashCount(s: MockState, key: string, d: J, now: number): ReceivedRowResult {
  if (!isUuid(d['shift_id'])) reject('INVALID', 'shift_id ต้องเป็น uuid')
  const lines = d['lines']
  if (!Array.isArray(lines) || lines.length !== 9) return reject('INVALID', 'lines ต้องมี 9 แถว (ธนบัตร/เหรียญชนิดละหนึ่ง)')
  const seen = new Set<number>()
  let sum = 0 // satang
  for (const l of lines as unknown[]) {
    if (!isObj(l) || !isInt(l['denomination'], 1, 1000) || !(CASH_DENOMINATIONS_BAHT as readonly number[]).includes(l['denomination']) || !isInt(l['count'], 0, 99_999)) {
      return reject('INVALID', 'lines ต้องเป็น {denomination, count} ของ 1000/500/100/50/20/10/5/2/1 บาท · count 0–99999')
    }
    if (seen.has(l['denomination'])) reject('INVALID', 'ธนบัตร/เหรียญชนิดเดียวกันซ้ำใน lines')
    seen.add(l['denomination'])
    sum += l['denomination'] * 100 * l['count']
  }
  if (!isMoney(d['counted']) || cents(d['counted']) !== sum) reject('INVALID', 'counted ไม่เท่ากับผลรวมธนบัตร/เหรียญ')
  if (!isUuid(d['counted_by'])) reject('INVALID', 'counted_by ต้องเป็น uuid')
  const countedAt = ts(d['counted_at']) ?? reject('INVALID', 'counted_at ต้องเป็นเวลา ISO-8601 (UTC)')
  checkTime(countedAt, now, 'counted_at')
  if (!staffOk(s, d['counted_by'] as string)) reject('UNKNOWN_STAFF', 'ไม่พบพนักงานผู้นับเงินของร้านนี้')
  const id = d['count_id'] as string
  if (s.counts.has(id)) return { key, status: 'duplicate', data: { count_id: id } }
  const shift = s.shifts.get(d['shift_id'] as string) ?? defer('PARENT_PENDING', 'กะที่อ้างยังมาไม่ถึง')
  if (countedAt < shift.openedAt) reject('INVALID', 'counted_at ต้องไม่ก่อนเวลาเปิดกะ')
  if (countOf(s, shift.id) !== undefined) {
    flagConflict(s, 'counted', shift.id)
    reject('CONFLICT', 'counted: กะนี้มีการนับเงินอีกใบแล้ว')
  }
  failRowError(s)
  s.counts.set(id, { id, shiftId: shift.id, counted: sum / 100, countedBy: d['counted_by'] as string, countedAt })
  if (shift.status === 'open') shift.status = 'counted'
  return { key, status: 'accepted', data: { count_id: id } }
}

/** The z_report checks of dayo_pos_shift_close (0066:359-449) — shape only, in dayo's order. */
function checkZReport(d: J): { zr: J; zNo: number; after: number; until: number } {
  if (!isUuid(d['count_id'])) reject('INVALID', 'count_id ต้องเป็น uuid')
  if (!isUuid(d['closed_by'])) reject('INVALID', 'closed_by ต้องเป็น uuid')
  if (ts(d['closed_at']) === null) reject('INVALID', 'closed_at ต้องเป็นเวลา ISO-8601 (UTC)')
  if (has(d, 'variance_reason') && !isText(d['variance_reason'], 200)) reject('INVALID', 'variance_reason ต้องมี 1–200 ตัวอักษรหรือ null')
  const zr = d['z_report']
  if (!isObj(zr) || Object.keys(zr).some((k) => !Z_KEYS.includes(k)) || Z_KEYS.some((k) => !(k in zr))) return reject('INVALID', 'z_report ต้องมีคีย์ครบและไม่มีคีย์ที่ไม่รู้จัก')
  if (!isInt(zr['z_no'], 1, INT32_MAX)) reject('INVALID', 'z_report.z_no ต้องเป็นจำนวนเต็มตั้งแต่ 1')
  const prev = zr['prev_hash']
  if (typeof zr['hash'] !== 'string' || !HEX64_RE.test(zr['hash']) || (prev !== null && (typeof prev !== 'string' || !HEX64_RE.test(prev)))) {
    reject('INVALID', 'z_report.hash/prev_hash ต้องเป็น hex ตัวเล็ก 64 ตัว (prev_hash null ได้)')
  }
  if (typeof zr['chain_warning'] !== 'boolean' || !isMoney(zr['variance_alert']) || !isMoney(zr['counted'])) reject('INVALID', 'z_report.chain_warning/variance_alert/counted ผิดรูป')
  const cash = zr['cash']
  if (!isObj(cash) || Object.keys(cash).some((k) => !CASH_KEYS.includes(k)) || CASH_KEYS.some((k) => !isMoney(cash[k]))) return reject('INVALID', 'z_report.cash ต้องมีองค์ประกอบ 8 ช่องเป็นบาท ≥ 0')
  if (cash['drawer_expenses'] !== 0) reject('INVALID', 'drawer_expenses ต้องเป็น 0 (ค่าใช้จ่ายจากลิ้นชักยังไม่รองรับ — ADR-0057)')
  const win = zr['bot_window']
  if (!isObj(win) || Object.keys(win).some((k) => k !== 'after' && k !== 'until')) return reject('INVALID', 'z_report.bot_window ต้องเป็น {after, until}')
  const after = ts(win['after'])
  const until = ts(win['until'])
  if (after === null || until === null || after >= until) return reject('INVALID', 'bot_window.after/until ต้องเป็นเวลา ISO-8601 และ after < until')
  const mids = zr['movement_ids']
  if (!Array.isArray(mids) || mids.length > 500 || !mids.every(isUuid) || new Set(mids).size !== mids.length) reject('INVALID', 'movement_ids ต้องเป็น uuid ไม่ซ้ำ ไม่เกิน 500')
  const bots = zr['bot_bills']
  if (!Array.isArray(bots) || bots.length > 500) return reject('INVALID', 'bot_bills ต้องเป็น array ไม่เกิน 500')
  let botSum = 0
  for (const b of bots as unknown[]) {
    if (!isObj(b) || Object.keys(b).some((k) => !['order_no', 'version', 'total'].includes(k)) || typeof b['order_no'] !== 'string' || !BOT_ORDER_NO_RE.test(b['order_no'])
      || !isInt(b['version'], 1, INT32_MAX) || !isMoney(b['total'])) return reject('INVALID', 'bot_bills ต้องเป็น {order_no, version, total}')
    botSum += cents(b['total'])
  }
  if (new Set((bots as J[]).map((b) => b['order_no'])).size !== bots.length) reject('INVALID', 'bot_bills มี order_no ซ้ำ')
  if (botSum !== cents(cash['bot_cash'] as number)) reject('INVALID', 'Σ bot_bills.total ไม่เท่ากับ cash.bot_cash')
  const pos = zr['pos_bills']
  if (!Array.isArray(pos) || pos.length > 2000) return reject('INVALID', 'pos_bills ต้องเป็น array ไม่เกิน 2000')
  const POS_KEYS = ['pos_order_id', 'receipt_no', 'payment', 'total', 'sold_at', 'voided_at']
  const badPos = (e: unknown): boolean => !isObj(e) || Object.keys(e).some((k) => !POS_KEYS.includes(k)) || !isUuid(e['pos_order_id'])
    || typeof e['receipt_no'] !== 'string' || !RECEIPT_NO_RE.test(e['receipt_no']) || !isText(e['payment'], 100) || !isMoney(e['total']) || ts(e['sold_at']) === null
    || (e['voided_at'] !== null && ts(e['voided_at']) === null) // a missing voided_at is 'missing', not null (dayo_jt) → INVALID
  if ((pos as unknown[]).some(badPos) || new Set((pos as J[]).map((e) => e['pos_order_id'])).size !== pos.length) {
    reject('INVALID', 'pos_bills ต้องเป็น {pos_order_id, receipt_no, payment, total, sold_at, voided_at} ไม่ซ้ำ')
  }
  return { zr, zNo: zr['z_no'] as number, after, until }
}

/** dayo_pos_shift_close (0066:325-561) — decided once, at receipt: first_of_key · chain_break · quarantined. */
export function judgeShiftClose(s: MockState, key: string, d: J, now: number): ReceivedRowResult {
  const { zr, zNo, after, until } = checkZReport(d)
  const closedAt = ts(d['closed_at'])!
  checkTime(closedAt, now, 'closed_at')
  const by = d['closed_by'] as string
  if (!staffOk(s, by)) reject('UNKNOWN_STAFF', 'ไม่พบพนักงานผู้ปิดกะของร้านนี้')
  if (!ownerActive(s, by)) reject('FORBIDDEN', 'role: ผู้ปิดกะต้องเป็นเจ้าของที่ใช้งานอยู่ ณ เวลาปิดกะ')
  const shiftId = d['shift_id'] as string
  if (s.zReports.has(shiftId)) return { key, status: 'duplicate', data: { shift_id: shiftId } }
  const shift = s.shifts.get(shiftId) ?? defer('PARENT_PENDING', 'กะที่อ้างยังมาไม่ถึง')
  const count = countOf(s, shiftId) ?? defer('PARENT_PENDING', 'การนับเงินของกะยังมาไม่ถึง')
  if (count.id !== d['count_id']) reject('INVALID', 'count_id ไม่ตรงกับการนับของกะนี้')
  if (closedAt < count.countedAt) reject('INVALID', 'closed_at ต้องไม่ก่อน counted_at')
  if (until !== count.countedAt) reject('INVALID', 'bot_window.until ต้องเท่ากับ counted_at ของการนับ')
  if (cents(zr['counted'] as number) !== cents(count.counted)) {
    flagConflict(s, 'counted_mismatch', shiftId) // §13.8 R5-2 · ADR-0069 rule 6
    reject('INVALID', 'data_conflict: ยอดนับในใบปิดกะไม่ตรงกับการนับของกะในระบบกลาง')
  }
  const { firstOfKey, quarantined } = zGate(s, shiftId, zNo, count.countedAt)
  failRowError(s)
  const z: MockZ = {
    shiftId, zNo, hash: zr['hash'] as string, prevHash: (zr['prev_hash'] as string | null), after, countedAt: count.countedAt, wire: zr,
    firstOfKey, quarantined, chainBreak: false, notes: [], chainMismatch: [], recomputeStatus: null, detail: [], // phase 2: judge.ts runs recomputeAll next
    missing: { posOrderIds: [], movementIds: [], voidOrderIds: [] },
  }
  Object.assign(z, chainOf(s, z))
  s.zReports.set(shiftId, z)
  shift.status = 'closed'
  shift.closedBy = by
  shift.closedAt = closedAt
  return { key, status: 'accepted', data: { shift_id: shiftId } }
}

type ZPoint = { zNo: number; hash: string; until: number; countedAt: number }
/** Zs that may be "the previous/next Z" of `except`: stored, not quarantined (§13.8 R5-3), plus a preloaded one. */
function points(s: MockState, except: string | null): ZPoint[] {
  const out = [...s.zReports.values()].filter((z) => z.shiftId !== except && !z.quarantined).map((z) => ({ zNo: z.zNo, hash: z.hash, until: z.countedAt, countedAt: z.countedAt }))
  if (s.preloadedZ !== null) out.push({ zNo: s.preloadedZ.zNo, hash: s.preloadedZ.hash, until: s.preloadedZ.countedAt, countedAt: s.preloadedZ.countedAt })
  return out
}

/** The highest non-quarantined Z (stored or preloaded) — E1 last_z_hash / last_z_until (0067:141-146). */
export function highestGoodZ(s: MockState): ZPoint | undefined {
  return points(s, null).sort((a, b) => b.zNo - a.zNo)[0]
}
/** The highest z_no of every Z of the key, quarantined included (the number is used) — E1 last_z_no (0067:140). */
export function highestZNo(s: MockState): number | undefined {
  const all = [...s.zReports.values()].map((z) => z.zNo)
  if (s.preloadedZ !== null) all.push(s.preloadedZ.zNo)
  return all.length === 0 ? undefined : Math.max(...all)
}

/**
 * Rules 0–1 and the rule-5 quarantine, ONCE, at receipt (0066:519-539 · spec 04 R5-3: decided once, kept for good). Every
 * stored Z — quarantined ones too — holds its number (unique (api_client_id, z_no)). Only a Z with z_no < the key's highest
 * at receipt can be quarantined (rule 1 already refused an equal one); a Z above the highest never is, even with an older
 * counted_at — rule 3 judges its `after` instead.
 */
function zGate(s: MockState, shiftId: string, zNo: number, countedAt: number): { firstOfKey: boolean; quarantined: boolean } {
  const taken = [...s.zReports.values()].map((z) => z.zNo)
  if (s.preloadedZ !== null) taken.push(s.preloadedZ.zNo)
  const maxZ = taken.length === 0 ? null : Math.max(...taken)
  if (maxZ !== null && zNo > maxZ + 50) { // rule 0 · R5-2 (a key without a Z has no ceiling)
    flagConflict(s, 'z_no_ceiling', shiftId)
    reject('INVALID', 'data_conflict: เลขใบปิดกะเกินเลขสูงสุดของเครื่องมากเกินไป')
  }
  if (taken.includes(zNo)) { // rule 1 — before rule 5, quarantined Zs included
    flagConflict(s, 'z_no_taken', shiftId)
    reject('CONFLICT', 'z_no_taken: เลขใบปิดกะนี้ถูกใช้แล้วในเครื่องนี้')
  }
  let quarantined = false
  if (maxZ !== null && zNo < maxZ) { // rule 5
    const all = points(s, shiftId)
    const lower = all.filter((p) => p.zNo < zNo).sort((a, b) => b.zNo - a.zNo)[0]
    const higher = all.filter((p) => p.zNo > zNo).sort((a, b) => a.zNo - b.zNo)[0]
    quarantined = !((lower === undefined || lower.countedAt < countedAt) && (higher === undefined || countedAt < higher.countedAt))
  }
  return { firstOfKey: maxZ === null, quarantined } // rule 2
}

/**
 * Rules 2–5 as a pure function of the stored Zs (recomputeAll re-runs it for rule 6 on phase 2). The quarantine is read, never
 * set or cleared. chainBreak = dayo phase 1 exactly (0066:540-542: quarantined, or the Z numbered z−1 has another hash).
 * chainMismatch/notes (rule 3's `after`, rule 4) are dayo PHASE 2 (0066:21) — empty on a phase-1 mock (preflight P3).
 */
export function chainOf(s: MockState, z: MockZ): Pick<MockZ, 'chainBreak' | 'notes' | 'chainMismatch'> {
  const full = chainRules(s, z)
  return s.block3Phase2 ? full : { chainBreak: full.chainBreak, notes: [], chainMismatch: [] }
}

function chainRules(s: MockState, z: MockZ): Pick<MockZ, 'chainBreak' | 'notes' | 'chainMismatch'> {
  const out = { chainBreak: false, notes: [] as string[], chainMismatch: [] as string[] }
  if (z.quarantined) return { chainBreak: true, notes: [], chainMismatch: ['Z เลขต่ำผิดลำดับเวลา (เล่นซ้ำ)'] } // rule 5 (sticky, R5-3)
  if (z.firstOfKey) return out // rule 2
  const all = points(s, z.shiftId)
  const lower = all.filter((p) => p.zNo < z.zNo).sort((a, b) => b.zNo - a.zNo)[0]
  if (lower !== undefined && lower.zNo === z.zNo - 1) { // rule 3
    if (z.prevHash !== lower.hash) out.chainBreak = true
    if (z.after !== lower.until) out.chainMismatch.push('bot_window.after ≠ until ของ Z ใบก่อน')
    return out
  }
  out.notes.push('Z ขาดช่วง / Z ก่อนหน้ายังไม่มี') // rule 4
  const quarantinedShifts = new Set([...s.zReports.values()].filter((q) => q.quarantined).map((q) => q.shiftId)) // their counts are never "the latest count" (R5-3)
  const lastCount = [...s.counts.values()].filter((c) => c.shiftId !== z.shiftId && !quarantinedShifts.has(c.shiftId) && c.countedAt < z.countedAt).sort((a, b) => b.countedAt - a.countedAt)[0]
  if (lastCount !== undefined && lastCount.countedAt !== z.after) {
    const [lo, hi] = lastCount.countedAt < z.after ? [lastCount.countedAt, z.after] : [z.after, lastCount.countedAt]
    if (botCashBills(s, lo, hi).length > 0) out.chainMismatch.push('ช่วงบิลบอทไม่ต่อกับการนับล่าสุด และช่วงนั้นมีบิลเงินสดบอท')
    else out.notes.push('ช่วงบิลบอทไม่ต่อกับการนับล่าสุด (ไม่มีบิลในช่วงนั้น)')
  }
  return out
}
