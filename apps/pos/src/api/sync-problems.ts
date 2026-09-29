import { and, asc, eq, inArray, isNotNull, like, ne, or, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import {
  ExistsConflictData, laneOf, OrderOffCatalogRowData, OrderRowData, PUSH_KINDS, PushRow, rowKey, SHIFT_LANE_KINDS, Text200,
  type DetailPrefix, type PushKind, type Supported,
} from '@dayo/contracts'
import { buildOffCatalogRowData, CartError, centralDiffSatang, edgeBahtToSatang, findSellableVariant, nextReceiptNo, OffCatalogError } from '@dayo/domain'
import { can } from '../app/permissions'
import { enqueuePush } from '../db/outbox'
import { appendOrderEvents } from '../db/events'
import { readCatalog, readSupported, roleOf } from '../sync/catalog'
import { isHeld, releaseChildren, retryRow } from '../sync/push'
import { decodeLastError } from '../sync/state'
import { requireOwnerPin } from './auth'
import { requireDevice, shiftsBeforeKeyReplace } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { hintFor, remediesFor as remediesForFacts, type RemedyFacts } from './problem-rules'
import { lastReceiptNoOverall } from './sale'
import { PAYMENT_CODE, type CentralExistsDto, type OwnerApproval, type PriceDiffDto, type RemapCodeInput, type RemapScope, type Remedy, type SyncProblemDto, type UserDto } from './types'

/** spec 04 §6.4 table (locked) — the pure rules live in problem-rules.ts (shared with the status bar). */
export const remediesFor = (r: RemedyFacts): Remedy[] => remediesForFacts(r)

type Row = typeof s.outbox.$inferSelect
const isPushKind = (k: string): k is PushKind => (PUSH_KINDS as readonly string[]).includes(k)
const isBillKind = (k: string): boolean => k === 'order' || k === 'order_void' || k === 'order_off_catalog'
const SHIFT_KINDS: readonly string[] = SHIFT_LANE_KINDS

/** review item 22: owner-only READS are checked here too (no PIN — the signed-in user id is enough for a read). */
async function requireOwner(db: RemoteDb, actorUserId: string): Promise<void> {
  const u = await db.select().from(s.user).where(eq(s.user.id, actorUserId)).get()
  if (!u || !u.isActive || u.role !== 'owner' || !can(u.role, 'sync_problems')) throw new PosError('NOT_OWNER', 'owner only')
}
const dataOf = (r: Row): Record<string, unknown> => (r.rowJson ?? {}) as Record<string, unknown>
/** The bill a bill-lane row belongs to — null for a shift-lane row. */
const orderIdOf = (r: Row): string | null => (isBillKind(r.tableName) ? String(dataOf(r)['pos_order_id']) : null)
/** The shift a row belongs to: every shift-lane row carries shift_id; a bill its central shift (null on a local-only one). */
const shiftIdOf = (r: Row): string | null => { const v = dataOf(r)['shift_id']; return typeof v === 'string' ? v : null }
const prefixOf = (r: Row): DetailPrefix | null => (decodeLastError(r.lastError).prefix as DetailPrefix | undefined) ?? null

/**
 * What decides a row's buttons besides the row itself: dayo's E1 lists (P2: order_off_catalog advertised · carried item 6:
 * a shift-lane row dayo no longer supports) and "now" (the 7-day scope wait).
 */
type PageContext = { sup: Supported | null; nowIso: string }
async function pageContext(db: RemoteDb, nowIso: string): Promise<PageContext> {
  return { sup: await readSupported(db), nowIso }
}
/** Carried item 6: a pending shift-lane row dayo does not support holds every later shift-lane row (the strict lane). */
const isHeldShiftRow = (r: Row, pc: PageContext): boolean => r.status === 'pending' && laneOf(r.tableName) === 'shift' && pc.sup !== null && isHeld(r, pc.sup)

/** R16 · m2: dayo's exists: data kept with the dead row, read back — never from the Thai detail. */
function existsDataOf(r: Row): { orderNo: string; reportedTotalSatang: number; paymentIsCash: boolean } | null {
  if (r.tableName !== 'order' && r.tableName !== 'order_off_catalog') return null
  const e = decodeLastError(r.lastError)
  const prefix = prefixOf(r)
  if (e.reason !== 'CONFLICT' || (prefix !== 'exists:' && prefix !== 'off_catalog_exists:')) return null
  const d = ExistsConflictData.safeParse(r.resultJson)
  if (!d.success) return null
  try {
    return { orderNo: d.data.order_no, reportedTotalSatang: edgeBahtToSatang(d.data.reported_total), paymentIsCash: d.data.payment_is_cash }
  } catch {
    return null
  }
}

/**
 * The fixes a row may take right now — remediesFor (the locked table) narrowed by what this row carries: REMAP_CODE only
 * when dayo named a value a remap can change (block 2 follow-up item 2) · ACKNOWLEDGE_ELSEWHERE only when dayo's data came
 * with the verdict (else "ปิดไว้ในเครื่อง" stays the way out).
 */
function remediesOfRow(r: Row, pc: PageContext): Remedy[] {
  if (!isPushKind(r.tableName) || (r.status !== 'dead' && r.status !== 'pending')) return []
  const e = decodeLastError(r.lastError)
  let out = remediesForFacts({
    kind: r.tableName, pending: r.status === 'pending', reason: e.reason, prefix: prefixOf(r), detail: e.detail, farAhead: e.farAhead === true,
    held: isHeldShiftRow(r, pc), scopeSince: e.scopeSince ?? null, nowIso: pc.nowIso, offCatalog: pc.sup?.kinds.includes('order_off_catalog') ?? false,
  })
  if (r.status !== 'dead') return out
  out = out.filter((x) => x !== 'REMAP_CODE' || remapScope(r).named !== null)
  if (out.includes('ACKNOWLEDGE_ELSEWHERE') && existsDataOf(r) === null) {
    out = out.filter((x) => x !== 'ACKNOWLEDGE_ELSEWHERE')
    if (!out.includes('EXCLUDE')) out.push('EXCLUDE')
  }
  return out
}

type OrderLine = OrderRowData['lines'][number]
/**
 * The one value of a bill dayo's UNKNOWN_CODE named: the channel, the payment, or the line(s) it describes — by their
 * menu or variant ('code'), or by their grade alone ('grade': then only the grade may change, fix round security Low 1).
 */
type NamedUnknown = { field: 'channel' | 'payment'; code: string } | { field: 'line'; by: 'code' | 'grade'; matches: (l: OrderLine) => boolean }

/**
 * Follow-up item 2 (block 2): dayo rejects UNKNOWN_CODE only for a code the shop does not have AT ALL — a disabled one is
 * still accepted (0052_pos_push.sql:369), while the tablet's latest catalog lists active codes only. So the value a remap
 * may change is the one dayo NAMED, read from the detail dayo writes itself:
 *   0052:371 ไม่พบช่องทางขาย "<channel>" · 0052:374 ไม่พบวิธีชำระ "<payment>" · 0052:379 ไม่พบเมนู "<code>" ·
 *   0052:385-386 ไม่พบ "<code> <size> <sweetness>" · 0052:402 ไม่พบเกรด "<grade>".
 * Whole-detail matches only. An order_off_catalog row has no catalog lines: only its channel or payment can be named (§6.4).
 */
const NAMED_BY_DETAIL: readonly [RegExp, (value: string) => NamedUnknown][] = [
  [/^ไม่พบช่องทางขาย "(.*)"$/su, (code) => ({ field: 'channel', code })],
  [/^ไม่พบวิธีชำระ "(.*)"$/su, (code) => ({ field: 'payment', code })],
  [/^ไม่พบเมนู "(.*)"$/su, (code) => ({ field: 'line', by: 'code', matches: (l) => l.code === code })],
  [/^ไม่พบ "(.*)"$/su, (v) => ({ field: 'line', by: 'code', matches: (l) => `${l.code} ${l.size} ${l.sweetness}` === v })],
  [/^ไม่พบเกรด "(.*)"$/su, (grade) => ({ field: 'line', by: 'grade', matches: (l) => l.grade === grade })],
]

/**
 * Fix round code Low 2: dayo refused the payment 'cash' itself (the shop's cash method is gone from dayo). A cash bill
 * can only stay 'cash', and 'cash' is the refused value — no remap can fix it; dayo must have the code back.
 */
export const CASH_REFUSED_HINT = 'ระบบกลางไม่รู้จักวิธีชำระเงินสด (รหัส cash) — บิลเงินสดย้ายไปวิธีชำระอื่นไม่ได้: ให้เพิ่มวิธีชำระเงินสดรหัส cash กลับในเว็บระบบกลาง แล้วกด "ลองใหม่"'

/** What a remap of this row may change (`named`, null = no remap), and why not when dayo named a value no remap can fix. */
function remapScope(r: Row): { named: NamedUnknown | null; hint: string | null } {
  const named = namedUnknown(r)
  if (named?.field === 'payment' && isCashCode(named.code)) return { named: null, hint: CASH_REFUSED_HINT }
  return { named, hint: null }
}

/** remapScope as the page shows it (RemapScope, api/types.ts) — the named lines with their index and current variant. */
function remapScopeDto(r: Row): { remap: RemapScope | null; remapHint: string | null } {
  const { named, hint } = remapScope(r)
  if (named === null) return { remap: null, remapHint: hint }
  if (named.field !== 'line') return { remap: { field: named.field }, remapHint: hint }
  const lines = OrderRowData.parse(r.rowJson).lines
    .map((l, index) => ({ l, index })).filter(({ l }) => named.matches(l))
    .map(({ l, index }) => ({ index, code: l.code, size: l.size, sweetness: l.sweetness }))
  return { remap: { field: 'line', lines, gradeOnly: named.by === 'grade' }, remapHint: hint }
}

/** What dayo named in this dead UNKNOWN_CODE bill row — and only if the row still carries it; else null (no remap). */
function namedUnknown(r: Row): NamedUnknown | null {
  if (r.tableName !== 'order' && r.tableName !== 'order_off_catalog') return null
  const e = decodeLastError(r.lastError)
  if (e.reason !== 'UNKNOWN_CODE') return null
  const data = (r.tableName === 'order' ? OrderRowData : OrderOffCatalogRowData).safeParse(r.rowJson)
  if (!data.success) return null
  for (const [re, named] of NAMED_BY_DETAIL) {
    const m = re.exec(e.detail)
    if (m === null) continue
    const n = named(m[1]!)
    if (n.field === 'line') return r.tableName === 'order' && (data.data as OrderRowData).lines.some(n.matches) ? n : null
    return data.data[n.field] === n.code ? n : null
  }
  return null
}

/** The owner's typed reason of a remedy: trimmed, 1–200 code points, plain text (Text200 — preflight P6: no checkedReason on main). */
function checkedReason(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw.trim() : ''
  if (!Text200.safeParse(reason).success) throw new PosError('BAD_INPUT', 'a remedy needs a reason of 1–200 characters')
  return reason
}

/**
 * Loads the row a remedy may touch, after the reason and the owner PIN (can 'sync_problems' at the API too). Every caller
 * runs inside the PosApi serial queue (pos-api.ts) — the same queue every read and write of the sender goes through — so
 * nothing of pushOnce runs between this check and the remedy's write.
 */
async function remedyRow(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }, remedy: Remedy): Promise<{ row: Row; approver: UserDto; reason: string; pc: PageContext }> {
  const reason = checkedReason(i.reason)
  const approver = await requireOwnerPin(db, deps, i.approverUserId, i.approverPin)
  if (!can(approver.role, 'sync_problems')) throw new PosError('NOT_OWNER', approver.displayName)
  const row = await db.select().from(s.outbox).where(eq(s.outbox.id, i.outboxId)).get()
  const pc = await pageContext(db, deps.now())
  const allowed = row === undefined ? [] : remediesOfRow(row, pc)
  if (row === undefined || allowed.length === 0) throw new PosError('REMEDY_NOT_ALLOWED', 'the row is not on the "ส่งไม่ผ่าน" page')
  if (!allowed.includes(remedy)) {
    const hint = remedy === 'REMAP_CODE' ? remapScope(row).hint : null
    throw new PosError('REMEDY_NOT_ALLOWED', hint ?? `${remedy} does not fit ${decodeLastError(row.lastError).reason || row.status}`)
  }
  return { row, approver, reason, pc }
}

/** The row's new data must still be a row dayo can read, under the SAME key (PushRow: key = <kind>:<its id field>). */
function checkedData(row: Row, data: unknown): Record<string, unknown> {
  const parsed = PushRow.safeParse({ key: row.idempotencyKey, kind: row.tableName, data })
  if (!parsed.success) throw new PosError('BAD_INPUT', `E2 ${row.tableName} row: ${parsed.error.issues.slice(0, 3).map((x) => `${x.path.join('.')} ${x.message}`).join(' · ')}`)
  return parsed.data.data as Record<string, unknown>
}

/**
 * Rewrites a REJECTED row's data and re-queues it under the SAME key (spec §6.1: allowed only because dayo never stores a
 * rejected result under a key) — pending, a fresh budget. Children parked as PARENT_REJECTED come back through the
 * sender's one releaser (preflight P6). The write is guarded by the status the check saw: a row decided meanwhile is never
 * overwritten (rolls back).
 */
async function requeue(tx: RemoteDb, row: Row, data: unknown): Promise<void> {
  const parsed = checkedData(row, data)
  const done = await tx.update(s.outbox).set({ rowJson: parsed, status: 'pending', attempts: 0, deadAt: null, nextAttemptAt: null, lastError: null })
    .where(and(eq(s.outbox.id, row.id), eq(s.outbox.status, 'dead'))).returning({ id: s.outbox.id })
  if (done.length !== 1) throw new PosError('REMEDY_NOT_ALLOWED', 'the row changed meanwhile — reload the page')
  await releaseChildren(tx, [row.idempotencyKey])
}

type BillEvent = 'RECEIPT_RENUMBERED' | 'CODE_REMAPPED' | 'STAFF_REMAPPED' | 'EXCLUDED_FROM_SYNC' | 'CLOSED_OFF_CATALOG' | 'DELIVERED_ELSEWHERE'
/**
 * The event of a remedy in the bill's hash chain, with the WHOLE old row (spec §6.4 · Iron Rule 4) — plus an audit_log row
 * naming it (Task 14: every owner action is in audit_log; the old row itself lives in the chained event).
 */
async function remedyEvent(tx: RemoteDb, deps: ApiDeps, row: Row, approverId: string, type: BillEvent, payload: Record<string, unknown>): Promise<void> {
  const device = await requireDevice(tx)
  const at = deps.now()
  const [eventId] = await appendOrderEvents(tx, { orderId: orderIdOf(row)!, deviceId: device.id, actorType: 'user', actorId: approverId, at, newId: deps.newId },
    [{ type, payload: { ...payload, key: row.idempotencyKey, approvedBy: approverId, before: row.rowJson } }])
  await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'sync_row', entityId: row.idempotencyKey, action: `sync_row_${type.toLowerCase()}`, beforeJson: null, afterJson: { orderId: orderIdOf(row), eventId: eventId ?? null, reason: payload['reason'] ?? null, approvedBy: approverId }, actorUserId: approverId, at })
}

/** A shift-lane remedy has no bill hash chain: its record is an audit_log row with the WHOLE old row (Iron Rule 4). */
async function remedyAudit(tx: RemoteDb, deps: ApiDeps, row: Row, approverId: string, action: string, after: Record<string, unknown>): Promise<void> {
  await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'sync_row', entityId: row.idempotencyKey, action, beforeJson: row.rowJson as never, afterJson: { ...after, approvedBy: approverId }, actorUserId: approverId, at: deps.now() })
}

/** CONFLICT on the receipt number (an order or an order_off_catalog row): the next receipt number of this device. Money never changes. */
export async function renumberReceipt(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }): Promise<{ oldReceiptNo: string; newReceiptNo: string }> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'RENUMBER')
  const device = await requireDevice(db)
  const out = await db.transaction(async (tx) => {
    const data = dataOf(row) as { receipt_no: string; pos_order_id: string }
    const newReceiptNo = nextReceiptNo(device.receiptPrefix, await lastReceiptNoOverall(tx, device))
    await tx.update(s.order).set({ receiptNo: newReceiptNo }).where(eq(s.order.id, data.pos_order_id))
    await remedyEvent(tx, deps, row, approver.id, 'RECEIPT_RENUMBERED', { old: data.receipt_no, new: newReceiptNo, reason })
    await requeue(tx, row, { ...data, receipt_no: newReceiptNo })
    return { oldReceiptNo: data.receipt_no, newReceiptNo }
  })
  deps.afterWrite?.()
  return out
}

/**
 * Follow-up item 1: cash is dayo's payment code 'cash' and nothing else — the one code dayo itself counts as cash
 * (0051_multi_source_sales.sql:1900 · 0009_stock_reports.sql:122,579). A name or alias is never read.
 */
const isCashCode = (code: string): boolean => code === PAYMENT_CODE.CASH

const NOT_NAMED = 'แก้ได้เฉพาะรายการที่ระบบกลางแจ้งว่าไม่รู้จัก'
const FIELD_TH: Record<NamedUnknown['field'], string> = { line: 'บรรทัดสินค้า', channel: 'ช่องทางขาย', payment: 'วิธีชำระ' }

/**
 * UNKNOWN_CODE: replace the ONE value dayo named in its rejection (namedUnknown) with one the latest catalog sells. Any other
 * field or line is refused (BAD_INPUT). The new value is never the one dayo refused. A payment stays on the same side of the
 * money collected: cash ↔ cash, non-cash ↔ non-cash — else REMEDY_NOT_ALLOWED (§4.10 การคิดซ้ำ ข้อ 7 · Task 14). `totals`
 * stay the charged ones (spec §6.4).
 */
export async function remapCode(db: RemoteDb, deps: ApiDeps, i: RemapCodeInput): Promise<void> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'REMAP_CODE')
  const { named, hint } = remapScope(row)
  if (named === null) throw new PosError('REMEDY_NOT_ALLOWED', hint ?? 'dayo named no code of this bill')
  const c = await readCatalog(db)
  if (c === null) throw new PosError('NO_CATALOG', 'no catalog')
  const next = structuredClone(dataOf(row)) as { lines: OrderLine[]; channel: string; payment: string; pos_order_id: string }
  const tg = i.target
  if (tg.field !== named.field) throw new PosError('BAD_INPUT', `${NOT_NAMED} — ระบบกลางแจ้งเรื่อง${FIELD_TH[named.field]}`)
  if (tg.field === 'line' && named.field === 'line') { // an `order` row only (namedUnknown)
    const line = Number.isSafeInteger(tg.lineIndex) && tg.lineIndex >= 0 ? next.lines[tg.lineIndex] : undefined
    if (line === undefined) throw new PosError('BAD_INPUT', 'ไม่มีบรรทัดนี้ในบิล')
    if (!named.matches(line)) throw new PosError('BAD_INPUT', `${NOT_NAMED} — บรรทัดนี้ไม่ใช่บรรทัดที่ระบบกลางแจ้ง`)
    // fix round security Low 1: dayo named only the grade — menu, size and sweetness are known to dayo and stay
    if (named.by === 'grade' && (tg.code !== line.code || tg.size !== line.size || tg.sweetness !== line.sweetness)) {
      throw new PosError('BAD_INPUT', `${NOT_NAMED} — ระบบกลางแจ้งเรื่องเกรด: แก้ได้เฉพาะเกรด เมนู/ขนาด/ความหวานต้องเหมือนเดิม`)
    }
    let v
    try {
      v = findSellableVariant(c.catalog, tg.code, tg.size, tg.sweetness)
    } catch (e) {
      if (e instanceof CartError) throw new PosError('BAD_INPUT', 'เลือกเมนู/ขนาด/ความหวานที่มีในแคตตาล็อกล่าสุด')
      throw e
    }
    const moved = { ...line, code: tg.code, size: tg.size, sweetness: tg.sweetness }
    // a matcha line keeps its grade if the latest catalog has it AND dayo did not name it; else the default grade
    const usable = (g: string | null | undefined): g is string => typeof g === 'string' && c.catalog.gradeOptions.some((x) => x.code === g) && !named.matches({ ...moved, grade: g })
    const fallback = c.catalog.gradeOptions.find((g) => g.isDefault)?.code
    const grade = v.isMatcha ? (usable(line.grade) ? line.grade : usable(fallback) ? fallback : null) : null
    if (v.isMatcha && grade === null) throw new PosError('BAD_INPUT', 'เมนูมัตฉะต้องมีเกรด')
    if (line.milk === 'oat' && !v.allowOatMilk) throw new PosError('BAD_INPUT', 'เมนูนี้ไม่มีนมโอ๊ต')
    const replaced = { ...moved, grade }
    if (named.matches(replaced)) throw new PosError('BAD_INPUT', 'ยังเป็นรหัสเดิมที่ระบบกลางไม่รู้จัก — เลือกรายการอื่น')
    next.lines[tg.lineIndex] = replaced
  } else if (tg.field === 'channel' && named.field === 'channel') {
    if (tg.code === named.code) throw new PosError('BAD_INPUT', 'ยังเป็นรหัสเดิมที่ระบบกลางไม่รู้จัก — เลือกช่องทางอื่น')
    if (!c.catalog.channels.some((x) => x.code === tg.code)) throw new PosError('BAD_INPUT', 'ไม่มีช่องทางนี้ในแคตตาล็อกล่าสุด')
    next.channel = tg.code
  } else if (tg.field === 'payment' && named.field === 'payment') {
    if (tg.code === named.code) throw new PosError('BAD_INPUT', 'ยังเป็นรหัสเดิมที่ระบบกลางไม่รู้จัก — เลือกวิธีชำระอื่น')
    if (!c.catalog.paymentMethods.some((x) => x.code === tg.code)) throw new PosError('BAD_INPUT', 'ไม่มีวิธีชำระนี้ในแคตตาล็อกล่าสุด')
    const collected = (await db.select({ method: s.payment.method }).from(s.payment).where(eq(s.payment.orderId, next.pos_order_id)).orderBy(asc(s.payment.createdAt)).get())?.method
    if (collected === undefined) throw new PosError('BAD_INPUT', 'บิลนี้ไม่มีการชำระเงินในเครื่อง')
    if (isCashCode(tg.code) !== (collected === 'CASH')) throw new PosError('REMEDY_NOT_ALLOWED', collected === 'CASH' ? 'บิลนี้รับเงินสด — เลือกวิธีชำระเงินสด (cash) เท่านั้น' : 'บิลนี้ไม่ได้รับเงินสด — เลือกวิธีชำระที่ไม่ใช่เงินสด')
    next.payment = tg.code
  } else {
    throw new PosError('BAD_INPUT', 'unknown field')
  }
  checkedData(row, next) // before the transaction: a bad choice is refused without touching anything
  await db.transaction(async (tx) => {
    await remedyEvent(tx, deps, row, approver.id, 'CODE_REMAPPED', { field: tg.field, target: tg, reason })
    await requeue(tx, row, next)
  })
  deps.afterWrite?.()
}

/** spec §6.4: the person field a shift-lane row carries (the one "เลือกพนักงานแทน" may change). */
const SHIFT_STAFF_FIELD: Record<string, string> = { shift_open: 'opened_by', cash_movement: 'created_by', cash_count: 'counted_by', shift_close: 'closed_by' }

/**
 * UNKNOWN_STAFF (and a shift_open refused `role:` — §6.4 "owner แก้ได้เฉพาะ opened_by"): the person becomes an ACTIVE member
 * of the latest list. A bill: its seller (or the void's approver, when that is the unknown id). A shift-lane row: the field of
 * its kind — shift_close.closed_by and a quick-opened (or role:-refused) shift_open.opened_by must be an owner.
 */
export async function remapStaff(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string; newStaffId: string }): Promise<void> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'REMAP_STAFF')
  const staff = (await readCatalog(db))?.staff
  if (staff === undefined) throw new PosError('NO_CATALOG', 'no staff list')
  const e = staff.find((x) => x.id === i.newStaffId)
  const role = e === undefined ? null : roleOf(e.role)
  if (e === undefined || !e.active || role === null) throw new PosError('BAD_INPUT', 'เลือกพนักงานที่ใช้งานอยู่ในรายชื่อล่าสุด')
  const data = dataOf(row)
  let field: string
  let ownerOnly = false
  if (row.tableName === 'order_void') {
    const listed = new Set(staff.map((x) => x.id))
    field = data['approved_by'] != null && !listed.has(String(data['approved_by'])) ? 'approved_by' : 'staff_id'
  } else if (isBillKind(row.tableName)) {
    field = 'staff_id'
  } else {
    field = SHIFT_STAFF_FIELD[row.tableName]!
    ownerOnly = row.tableName === 'shift_close' || (row.tableName === 'shift_open' && (prefixOf(row) === 'role:' || data['quick_open'] === true))
  }
  if (ownerOnly && role !== 'owner') throw new PosError('BAD_INPUT', 'รายการนี้ต้องเป็นเจ้าของร้าน — เลือกเจ้าของร้านที่ใช้งานอยู่')
  const next = { ...data, [field]: i.newStaffId }
  checkedData(row, next)
  await db.transaction(async (tx) => {
    const payload = { field, old: data[field] ?? null, newStaffId: i.newStaffId, reason }
    if (isBillKind(row.tableName)) await remedyEvent(tx, deps, row, approver.id, 'STAFF_REMAPPED', payload)
    else await remedyAudit(tx, deps, row, approver.id, 'sync_row_remapped', payload)
    await requeue(tx, row, next)
  })
  deps.afterWrite?.()
}

/**
 * Every child of `parentKey`, every level (a shift_open → its cash rows → the shift_close of its count), still pending or
 * dead → local_only. Returns their keys.
 */
async function closeChildrenLocally(tx: RemoteDb, parentKey: string): Promise<string[]> {
  const closed: string[] = []
  const todo = [parentKey]
  const seen = new Set(todo)
  for (let key = todo.pop(); key !== undefined; key = todo.pop()) {
    const kids = await tx.select({ id: s.outbox.id, key: s.outbox.idempotencyKey }).from(s.outbox).where(and(eq(s.outbox.parentKey, key), inArray(s.outbox.status, ['pending', 'dead']))).all()
    if (kids.length > 0) await tx.update(s.outbox).set({ status: 'local_only', nextAttemptAt: null }).where(and(inArray(s.outbox.id, kids.map((k) => k.id)), inArray(s.outbox.status, ['pending', 'dead'])))
    for (const k of kids) {
      closed.push(k.key)
      if (!seen.has(k.key)) { seen.add(k.key); todo.push(k.key) }
    }
  }
  return closed
}

/**
 * "ปิดไว้ในเครื่อง" (spec §6.4 · R8 · R19): never sent again — the row and its waiting children of every level become
 * local_only. A shift_open takes its whole shift with it: shift.sync_mode → local_only (R19), so every later row of that
 * shift is written local_only too. No PAID_IN/PAID_OUT. The status write is guarded by the status the check saw; a verdict
 * of a request already on the wire for this row is then dropped by applyVerdicts (it judges only rows still pending).
 * Ledger ruling 1 (block 2): if dayo ACCEPTED that in-flight request, dayo counts it while this tablet shows it excluded.
 */
export async function excludeFromSync(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }): Promise<void> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'EXCLUDE')
  await db.transaction(async (tx) => {
    const done = await tx.update(s.outbox).set({ status: 'local_only', nextAttemptAt: null }).where(and(eq(s.outbox.id, row.id), eq(s.outbox.status, row.status))).returning({ id: s.outbox.id })
    if (done.length !== 1) throw new PosError('REMEDY_NOT_ALLOWED', 'the row changed meanwhile — reload the page')
    const children = await closeChildrenLocally(tx, row.idempotencyKey)
    const record = { reason, status: row.status, lastError: decodeLastError(row.lastError), children }
    if (isBillKind(row.tableName)) await remedyEvent(tx, deps, row, approver.id, 'EXCLUDED_FROM_SYNC', record)
    else await remedyAudit(tx, deps, row, approver.id, 'sync_row_excluded', record)
    if (row.tableName === 'order' || row.tableName === 'order_off_catalog') await tx.update(s.order).set({ excludedAt: deps.now() }).where(eq(s.order.id, orderIdOf(row)!))
    if (row.tableName === 'shift_open') await tx.update(s.shift).set({ syncMode: 'local_only' }).where(and(eq(s.shift.id, shiftIdOf(row)!), eq(s.shift.syncMode, 'central')))
  })
  deps.afterWrite?.()
}

/** "ลองใหม่": dead → pending with a fresh budget (retryRow — it releases the PARENT_REJECTED children too), same data, same key. */
export async function retrySyncRow(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }): Promise<void> {
  await remedyRow(db, deps, i, 'RETRY')
  await db.transaction((tx) => retryRow(tx, i.outboxId))
  deps.afterWrite?.()
}

/** duck-typed: apps/pos has no direct zod dependency — the contracts' parse throws a ZodError with `issues`. */
const isZodError = (e: unknown): e is { issues: { path: PropertyKey[] }[] } => typeof e === 'object' && e !== null && Array.isArray((e as { issues?: unknown }).issues)

/**
 * "ปิดเป็นบิลนอกแคตตาล็อก" (spec §6.4 · §4.10 order_off_catalog · D91 · D97 · R10/R11): owner only (can 'close_off_catalog'),
 * PIN + reason, a DEAD `order` row dayo refused (never a reason of the tablet's own — R11) and only while dayo advertises
 * order_off_catalog (P2). In ONE transaction: the new row is built from the bill as frozen here (never new money — the
 * builder refuses what it cannot represent: OFF_CATALOG_NOT_POSSIBLE, nothing written, "ปิดไว้ในเครื่อง" stays) · the
 * order row → closed_off_catalog (never sent again) · its void children move to the new parent (the same UPDATE rule the
 * sender uses — enqueuePush allows both parents) and PARENT_REJECTED ones come back · order.off_catalog_at · event
 * CLOSED_OFF_CATALOG. No PAID_IN/PAID_OUT (§4.10).
 */
export async function closeOffCatalog(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }): Promise<{ offCatalogKey: string }> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'CLOSE_OFF_CATALOG')
  if (!can(approver.role, 'close_off_catalog')) throw new PosError('NOT_OWNER', approver.displayName)
  const at = deps.now()
  const key = await db.transaction(async (tx) => {
    const now = await tx.select().from(s.outbox).where(eq(s.outbox.id, row.id)).get()
    if (now === undefined || now.status !== 'dead' || now.tableName !== 'order') throw new PosError('REMEDY_NOT_ALLOWED', 'the row changed meanwhile — reload the page')
    const order = OrderRowData.parse(now.rowJson)
    const newKey = rowKey('order_off_catalog', order.pos_order_id)
    // carried item 4: one bill is sent once — never when its order row reached dayo, never twice as off-catalog
    if ((await tx.select({ id: s.outbox.id }).from(s.outbox).where(eq(s.outbox.idempotencyKey, newKey)).get()) !== undefined) throw new PosError('REMEDY_NOT_ALLOWED', `${newKey} is queued already`)
    const local = await tx.select({ id: s.order.id }).from(s.order).where(eq(s.order.id, order.pos_order_id)).get()
    if (local === undefined) throw new PosError('ORDER_NOT_FOUND', order.pos_order_id)
    // carried item 5: the frozen lines of THIS bill only (block-2 bills keep them in order_item)
    const items = await tx.select().from(s.orderItem).where(eq(s.orderItem.orderId, order.pos_order_id)).orderBy(asc(s.orderItem.lineNo)).all()
    const originalReason = decodeLastError(now.lastError).reason
    let data
    try {
      data = buildOffCatalogRowData({
        order, closedBy: approver.id, closedAt: at, reason, originalReason,
        items: items.map((x) => ({ menuCode: x.menuCode, menuNameTh: x.menuNameTh, size: x.size, sweetness: x.sweetness, qty: x.qty, unitPriceSatang: x.unitPriceSatang, discountPerCupSatang: x.discountPerCupSatang, lineTotalSatang: x.lineTotalSatang })),
      })
    } catch (e) {
      if (e instanceof OffCatalogError) throw new PosError('OFF_CATALOG_NOT_POSSIBLE', e.message)
      // review item 2: a row dayo's own shape rules would refuse (closed_at < sold_at after the clock went back, …)
      if (isZodError(e) || e instanceof RangeError) throw new PosError('OFF_CATALOG_NOT_POSSIBLE', isZodError(e) ? e.issues.slice(0, 3).map((x) => x.path.join('.')).join(', ') : e.message)
      throw e
    }
    await enqueuePush(tx, { kind: 'order_off_catalog', id: order.pos_order_id, data, parentKey: null }, at, deps.newId)
    const done = await tx.update(s.outbox).set({ status: 'closed_off_catalog', nextAttemptAt: null }).where(and(eq(s.outbox.id, now.id), eq(s.outbox.status, 'dead'))).returning({ id: s.outbox.id })
    if (done.length !== 1) throw new PosError('REMEDY_NOT_ALLOWED', 'the row changed meanwhile — reload the page')
    await tx.update(s.outbox).set({ parentKey: newKey }).where(and(eq(s.outbox.parentKey, now.idempotencyKey), eq(s.outbox.tableName, 'order_void')))
    await releaseChildren(tx, [newKey]) // PARENT_REJECTED voids wait for the new parent instead
    await tx.update(s.order).set({ offCatalogAt: at }).where(eq(s.order.id, order.pos_order_id))
    await remedyEvent(tx, deps, now, approver.id, 'CLOSED_OFF_CATALOG', { reason, originalReason, closedAt: at, newKey })
    return newKey
  })
  deps.afterWrite?.()
  return { offCatalogKey: key }
}

/**
 * "รับทราบ — บิลอยู่ในระบบกลางแล้ว" (spec §6.4 · m2 · R16): dayo already holds this bill under `data.order_no`. The row is
 * marked sent (never sent again) with dayo's number; dayo's reported total and cash-ness are compared with the bill frozen
 * here — different = order.central_mismatch_json (the red bar), display only (the collected money never changes); the
 * children waiting on it come back; event DELIVERED_ELSEWHERE.
 */
export async function acknowledgeElsewhere(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }): Promise<{ orderNo: string; matchesLocal: boolean }> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'ACKNOWLEDGE_ELSEWHERE')
  const central = existsDataOf(row)
  if (central === null) throw new PosError('REMEDY_NOT_ALLOWED', 'dayo sent no readable data with this conflict')
  const orderId = orderIdOf(row)!
  const out = await db.transaction(async (tx) => {
    const order = await tx.select().from(s.order).where(eq(s.order.id, orderId)).get()
    if (order === undefined) throw new PosError('ORDER_NOT_FOUND', orderId)
    const localCash = (await tx.select({ method: s.payment.method }).from(s.payment).where(eq(s.payment.orderId, orderId)).all()).some((p) => p.method === 'CASH')
    const matchesLocal = central.reportedTotalSatang === order.totalSatang && central.paymentIsCash === localCash
    const at = deps.now()
    const done = await tx.update(s.outbox).set({ status: 'sent', sentAt: at, nextAttemptAt: null }).where(and(eq(s.outbox.id, row.id), eq(s.outbox.status, 'dead'))).returning({ id: s.outbox.id })
    if (done.length !== 1) throw new PosError('REMEDY_NOT_ALLOWED', 'the row changed meanwhile — reload the page')
    await tx.update(s.order).set({
      centralOrderNo: central.orderNo,
      centralMismatchJson: matchesLocal ? null : { orderNo: central.orderNo, reportedTotalSatang: central.reportedTotalSatang, paymentIsCash: central.paymentIsCash, localTotalSatang: order.totalSatang, localPaymentIsCash: localCash },
    }).where(eq(s.order.id, orderId))
    await releaseChildren(tx, [row.idempotencyKey])
    await remedyEvent(tx, deps, row, approver.id, 'DELIVERED_ELSEWHERE', { order_no: central.orderNo, matchesLocal, reason, reportedTotalSatang: central.reportedTotalSatang, paymentIsCash: central.paymentIsCash })
    return { orderNo: central.orderNo, matchesLocal }
  })
  deps.afterWrite?.()
  return out
}

/**
 * FORBIDDEN `role:` of a shift_close / order_off_catalog (the closer was not an active owner at closed_at): this owner closes
 * it again — row_json.closed_by = this owner, closed_at = now (never before the row's own closed_at, so closed_at ≥
 * counted_at / sold_at still holds) — and it is re-queued under the same key. The local Z is not edited (z_report has no
 * closed_by — its hash stays). Recorded as audit_log `sync_row_reconfirmed` (shift) or event CLOSED_OFF_CATALOG {reclosedBy} (bill).
 */
export async function reconfirmOwner(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }): Promise<void> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'RECONFIRM_OWNER')
  const data = dataOf(row)
  const before = Date.parse(String(data['closed_at']))
  const nowMs = Date.parse(deps.now())
  const closedAt = new Date(Number.isFinite(before) && before > nowMs ? before : nowMs).toISOString()
  const next = { ...data, closed_by: approver.id, closed_at: closedAt }
  checkedData(row, next)
  await db.transaction(async (tx) => {
    const payload = { reason, reclosedBy: approver.id, closedAt, oldClosedBy: data['closed_by'] ?? null }
    if (isBillKind(row.tableName)) await remedyEvent(tx, deps, row, approver.id, 'CLOSED_OFF_CATALOG', payload)
    else await remedyAudit(tx, deps, row, approver.id, 'sync_row_reconfirmed', payload)
    await requeue(tx, row, next)
  })
  deps.afterWrite?.()
}

/**
 * The "ส่งไม่ผ่าน" page (spec §6.4): dead rows of every kind + the waiting cards — pending rows far ahead (N5 'clock'), waiting
 * for a scope for ≥ 7 days ('scope'), or a shift-lane row dayo no longer supports ('unsupported', carried item 6) — oldest
 * first; a child waiting on a listed parent (PARENT_REJECTED) is nested under it, every level.
 */
export async function listSyncProblems(db: RemoteDb, deps: ApiDeps, actorUserId: string): Promise<SyncProblemDto[]> {
  await requireOwner(db, actorUserId)
  const pc = await pageContext(db, deps.now())
  const candidates = await db.select().from(s.outbox)
    .where(and(inArray(s.outbox.tableName, [...PUSH_KINDS]), or(
      eq(s.outbox.status, 'dead'),
      and(eq(s.outbox.status, 'pending'), or(like(s.outbox.lastError, '%"farAhead":true%'), like(s.outbox.lastError, '%"prefix":"scope:"%'), inArray(s.outbox.tableName, [...SHIFT_LANE_KINDS]))),
    )))
    .orderBy(asc(s.outbox.createdAt), asc(sql`rowid`)).all()
  const waitingOf = (r: Row): 'clock' | 'scope' | 'unsupported' | null => {
    if (r.status !== 'pending') return null
    const e = decodeLastError(r.lastError)
    if (e.farAhead === true) return 'clock'
    if (e.prefix === 'scope:') return 'scope'
    return isHeldShiftRow(r, pc) ? 'unsupported' : null
  }
  const shown = candidates.filter((r) => r.status === 'dead' || (waitingOf(r) !== null && remediesOfRow(r, pc).length > 0))
  if (shown.length === 0) return []
  // the strict shift lane: every pending shift-lane row after a waiting one waits behind it
  const pendingShift = candidates.filter((r) => r.status === 'pending' && SHIFT_KINDS.includes(r.tableName))
  const orderIds = [...new Set(shown.map(orderIdOf).filter((x): x is string => x !== null))]
  const orders = new Map((orderIds.length === 0 ? [] : await db.select({ id: s.order.id, receiptNo: s.order.receiptNo, totalSatang: s.order.totalSatang, centralOrderNo: s.order.centralOrderNo }).from(s.order).where(inArray(s.order.id, orderIds)).all()).map((o) => [o.id, o]))
  const cashBills = new Set((orderIds.length === 0 ? [] : await db.select({ orderId: s.payment.orderId }).from(s.payment).where(and(inArray(s.payment.orderId, orderIds), eq(s.payment.method, 'CASH'))).all()).map((p) => p.orderId))
  const oldKey = await shiftsBeforeKeyReplace(db, shown.filter((r) => laneOf(r.tableName) === 'shift').map(shiftIdOf).filter((x): x is string => x !== null))
  const dto = (r: Row): SyncProblemDto => {
    const e = decodeLastError(r.lastError)
    const remedies = remediesOfRow(r, pc)
    const scope = r.status === 'dead' ? remapScopeDto(r) : { remap: null, remapHint: null }
    const orderId = orderIdOf(r)
    const order = orderId === null ? undefined : orders.get(orderId)
    const shiftId = shiftIdOf(r)
    const prefix = prefixOf(r)
    const ex = existsDataOf(r)
    const central: CentralExistsDto | null = ex === null || order === undefined ? null
      : { ...ex, matchesLocal: ex.reportedTotalSatang === order.totalSatang && ex.paymentIsCash === cashBills.has(order.id) }
    const waiting = waitingOf(r)
    const at = pendingShift.findIndex((x) => x.id === r.id)
    return {
      // SyncProblemDto.kind is declared as the two bill kinds until Task 16 widens it (see api/types.ts) — the value is the row's kind
      outboxId: r.id, key: r.idempotencyKey, kind: r.tableName as SyncProblemDto['kind'], pushKind: r.tableName as PushKind, orderId, shiftId,
      receiptNo: order?.receiptNo ?? null, at: r.createdAt, reason: e.reason, detail: e.detail, prefix, remedies,
      remap: remedies.includes('REMAP_CODE') ? scope.remap : null, remapHint: scope.remapHint, children: [],
      waiting, hint: hintFor({ kind: r.tableName as PushKind, dead: r.status === 'dead', reason: e.reason, prefix, shiftOpenedBeforeKeyReplace: shiftId !== null && oldKey.has(shiftId) }),
      central, centralOrderNo: order?.centralOrderNo ?? null,
      blocksLaneRows: waiting !== null && at >= 0 ? pendingShift.length - at - 1 : 0,
    }
  }
  const byKey = new Map(shown.map((r) => [r.idempotencyKey, dto(r)]))
  const top: SyncProblemDto[] = []
  for (const r of shown) {
    const parent = r.parentKey === null ? undefined : byKey.get(r.parentKey)
    if (parent !== undefined && decodeLastError(r.lastError).reason === 'PARENT_REJECTED') parent.children.push(byKey.get(r.idempotencyKey)!)
    else top.push(byKey.get(r.idempotencyKey)!)
  }
  return top
}

export async function exportSyncRow(db: RemoteDb, i: { actorUserId: string; outboxId: string }): Promise<string> {
  await requireOwner(db, i.actorUserId)
  const r = await db.select().from(s.outbox).where(eq(s.outbox.id, i.outboxId)).get()
  if (r === undefined || !isPushKind(r.tableName)) throw new PosError('BAD_INPUT', 'no such push row')
  // the E2 row as it would be sent + dayo's last answer — never the API key, a PIN hash or sync_state
  return JSON.stringify({ key: r.idempotencyKey, kind: r.tableName, data: r.rowJson, lastError: decodeLastError(r.lastError), createdAt: r.createdAt }, null, 2)
}

/**
 * spec §4.3 + review item 23 — owner only (R11). Money math: centralDiffSatang (@dayo/domain). Fix round 1 item 6: the
 * candidates are picked in SQL, so the serial queue never loads every bill and outbox row the tablet ever had —
 * 'amount' = a computed total that is not the charged one; 'void_local_only' = an order_void row closed local_only
 * whose bill row was sent.
 */
export async function listPriceDiffs(db: RemoteDb, actorUserId: string): Promise<PriceDiffDto[]> {
  await requireOwner(db, actorUserId)
  const listed = and(inArray(s.order.status, ['paid', 'voided']), isNotNull(s.order.soldAt), isNotNull(s.order.receiptNo))
  const amount = await db.select().from(s.order)
    .where(and(listed, isNotNull(s.order.centralComputedTotalSatang), ne(s.order.centralComputedTotalSatang, s.order.totalSatang))).all()
  const localVoids = await db.select({ data: s.outbox.rowJson }).from(s.outbox).where(and(eq(s.outbox.tableName, 'order_void'), eq(s.outbox.status, 'local_only'))).all()
  const voidIds = [...new Set(localVoids.map((r) => String((r.data as { pos_order_id: string }).pos_order_id)))]
  const sentIds = voidIds.length === 0 ? [] : (await db.select({ data: s.outbox.rowJson }).from(s.outbox)
    .where(and(inArray(s.outbox.idempotencyKey, voidIds.map((id) => rowKey('order', id))), eq(s.outbox.status, 'sent'))).all())
    .map((r) => String((r.data as { pos_order_id: string }).pos_order_id))
  const voidOnly = sentIds.length === 0 ? [] : await db.select().from(s.order).where(and(listed, eq(s.order.status, 'voided'), inArray(s.order.id, sentIds))).all()
  type Bill = typeof s.order.$inferSelect
  const base = (o: Bill) => ({
    orderId: o.id, receiptNo: o.receiptNo!, soldAt: o.soldAt!, totalSatang: o.totalSatang, computedTotalSatang: o.centralComputedTotalSatang,
    diffSatang: centralDiffSatang(o.centralComputedTotalSatang, o.totalSatang), catalogVersion: o.catalogVersion, amountMismatch: o.centralAmountMismatch === true,
  })
  const out: (PriceDiffDto & { order: number })[] = []
  for (const o of amount) {
    const b = base(o)
    if (b.diffSatang !== null && b.diffSatang !== 0) out.push({ ...b, kind: 'amount', order: 0 })
  }
  for (const o of voidOnly) out.push({ ...base(o), kind: 'void_local_only', order: 1 })
  // oldest sale first; one bill's 'amount' before its 'void_local_only'
  return out.sort((a, b) => a.soldAt.localeCompare(b.soldAt) || a.order - b.order).map(({ order: _order, ...d }) => d)
}
