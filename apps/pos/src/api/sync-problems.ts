import { and, asc, eq, inArray, isNotNull, like, ne, or, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { OrderRowData, OrderVoidRowData, rowKey, Text200, type PushKind } from '@dayo/contracts'
import { CartError, centralDiffSatang, findSellableVariant, nextReceiptNo } from '@dayo/domain'
import { appendOrderEvents } from '../db/events'
import { readCatalog, roleOf } from '../sync/catalog'
import { retryRow } from '../sync/push'
import { decodeLastError } from '../sync/state'
import { requireOwnerPin } from './auth'
import { requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { lastReceiptNoOverall } from './sale'
import { PAYMENT_CODE, type OwnerApproval, type PriceDiffDto, type RemapCodeInput, type Remedy, type SyncProblemDto } from './types'

/**
 * spec 04 §6.4 (locked): which fix fits which reason of a DEAD row. A reason missing here (STUCK, ENVELOPE,
 * REQUEST_FAILED, NO_VERDICT_REPEATED, anything dayo adds later) = RETRY only. PARENT_REJECTED = none: fix the parent.
 */
const REMEDIES: Record<string, Remedy[]> = {
  CONFLICT: ['RETRY', 'RENUMBER'], UNKNOWN_CODE: ['RETRY', 'REMAP_CODE'], UNKNOWN_STAFF: ['RETRY', 'REMAP_STAFF'],
  INVALID: ['RETRY', 'EXCLUDE'], FORBIDDEN: ['RETRY', 'EXCLUDE'], BAD_KEY: ['RETRY', 'EXCLUDE'], CLOCK_AHEAD: ['EXCLUDE'], PARENT_REJECTED: [],
}
const PAGE_KINDS: readonly PushKind[] = ['order', 'order_void']
type Row = typeof s.outbox.$inferSelect

/**
 * fix round 1 item 4: dayo answers CONFLICT for two different things. A receipt number another bill already holds
 * (0052_pos_push.sql:421 "เลขใบเสร็จ … ถูกใช้กับบิลอื่น…", :665 external_ref_taken…, :680 a unique violation after dayo
 * found no bill with this pos_order_id) — a new number fixes it. Or this very key already stored with other data
 * (:614 "key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว") — dayo HAS this bill; a new number would only burn receipt numbers
 * and conflict again, so that one (and any detail not recognised) gets RETRY only. Matched by the known start of the
 * detail dayo writes itself (the tablet clips a detail at its end, never its start).
 */
const RECEIPT_COLLISION = [/^เลขใบเสร็จ /, /^external_ref_taken/, /^SQLSTATE 23505$/]
const isReceiptCollision = (detail: string): boolean => RECEIPT_COLLISION.some((re) => re.test(detail))

/** review item 22: owner-only READS are checked here too (no PIN — the signed-in user id is enough for a read). */
async function requireOwner(db: RemoteDb, actorUserId: string): Promise<void> {
  const u = await db.select().from(s.user).where(eq(s.user.id, actorUserId)).get()
  if (!u || !u.isActive || u.role !== 'owner') throw new PosError('NOT_OWNER', 'owner only')
}
const orderIdOf = (r: Row): string => String((r.rowJson as { pos_order_id: string }).pos_order_id)
const isPageKind = (r: Row): boolean => (PAGE_KINDS as readonly string[]).includes(r.tableName)
/** ruling N5: a row > 24 h ahead of dayo's clock stays pending (it keeps retrying) and is flagged for the owner. */
const isFarAheadWaiting = (r: Row): boolean => r.status === 'pending' && decodeLastError(r.lastError).farAhead === true

/**
 * The fixes a row may take right now. A far-ahead row still pending = EXCLUDE only (N5), whatever reason its last
 * attempt left behind (a later failed request keeps the farAhead flag with reason REQUEST_FAILED — it must not then
 * show a RETRY that remedyRow refuses). A dead row: by its reason (RENUMBER only for a receipt collision). Anything
 * else: none (not on the page).
 */
function remediesFor(r: Row): Remedy[] {
  if (!isPageKind(r)) return []
  if (isFarAheadWaiting(r)) return ['EXCLUDE']
  if (r.status !== 'dead') return []
  const e = decodeLastError(r.lastError)
  return (REMEDIES[e.reason] ?? ['RETRY'])
    .filter((x) => x !== 'RENUMBER' || (r.tableName === 'order' && isReceiptCollision(e.detail)))
    .filter((x) => x !== 'REMAP_CODE' || namedUnknown(r) !== null)
}

type OrderLine = OrderRowData['lines'][number]
/** The one value of a bill dayo's UNKNOWN_CODE named: the channel, the payment, or the line(s) it describes. */
type NamedUnknown = { field: 'channel' | 'payment'; code: string } | { field: 'line'; matches: (l: OrderLine) => boolean }

/**
 * Follow-up item 2: dayo rejects UNKNOWN_CODE only for a code the shop does not have AT ALL — a disabled one is still
 * accepted (0052_pos_push.sql:369 "ปิดใช้แล้วยังรับ — ADR-0049 ข้อ 5"), while the tablet's latest catalog (E1) lists
 * active codes only. "Missing from the local catalog" is therefore a wider test than dayo's, and it let a remedy for one
 * unknown line also swap a channel dayo had merely disabled (a different fee %, never shown in "ยอดไม่ตรงระบบกลาง"). So
 * the value a remap may change is the one dayo NAMED, read from the detail dayo writes itself — the same technique as
 * RECEIPT_COLLISION above:
 *   0052:371 ไม่พบช่องทางขาย "<channel>" · 0052:374 (and create_order's unknown_code, 0051:1077 → 0052:648-649 strips
 *   the prefix) ไม่พบวิธีชำระ "<payment>" · 0052:379 ไม่พบเมนู "<code>" · 0052:385-386 ไม่พบ "<code> <size> <sweetness>"
 *   · 0052:402 ไม่พบเกรด "<grade>".
 * Whole-detail matches only (the tablet clips a detail at its end, so a clipped one matches nothing). Not a remap:
 * 0052:391 ไม่พบตัวเลือกนม "oat" (a remap cannot change the milk), DY404's raw text (0052:663), anything dayo adds
 * later — those get RETRY only.
 */
const NAMED_BY_DETAIL: readonly [RegExp, (value: string) => NamedUnknown][] = [
  [/^ไม่พบช่องทางขาย "(.*)"$/su, (code) => ({ field: 'channel', code })],
  [/^ไม่พบวิธีชำระ "(.*)"$/su, (code) => ({ field: 'payment', code })],
  [/^ไม่พบเมนู "(.*)"$/su, (code) => ({ field: 'line', matches: (l) => l.code === code })],
  [/^ไม่พบ "(.*)"$/su, (v) => ({ field: 'line', matches: (l) => `${l.code} ${l.size} ${l.sweetness}` === v })],
  [/^ไม่พบเกรด "(.*)"$/su, (grade) => ({ field: 'line', matches: (l) => l.grade === grade })],
]

/** What dayo named in this dead UNKNOWN_CODE bill row — and only if the row still carries it; else null (no remap). */
function namedUnknown(r: Row): NamedUnknown | null {
  if (r.tableName !== 'order') return null
  const e = decodeLastError(r.lastError)
  if (e.reason !== 'UNKNOWN_CODE') return null
  const data = OrderRowData.safeParse(r.rowJson)
  if (!data.success) return null
  for (const [re, named] of NAMED_BY_DETAIL) {
    const m = re.exec(e.detail)
    if (m === null) continue
    const n = named(m[1]!)
    const carried = n.field === 'line' ? data.data.lines.some(n.matches) : data.data[n.field] === n.code
    return carried ? n : null
  }
  return null
}

/**
 * Loads the row a remedy may touch, after the reason and the owner PIN. Every caller runs inside the PosApi serial
 * queue (pos-api.ts) — the same queue every read and write of the sender goes through — so nothing of pushOnce runs
 * between this check and the remedy's write.
 */
async function remedyRow(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }, remedy: Remedy): Promise<{ row: Row; approver: { id: string }; reason: string }> {
  const reason = typeof i.reason === 'string' ? i.reason.trim() : ''
  if (!Text200.safeParse(reason).success) throw new PosError('BAD_INPUT', 'a remedy needs a reason of 1–200 characters')
  const approver = await requireOwnerPin(db, deps, i.approverUserId, i.approverPin)
  const row = await db.select().from(s.outbox).where(eq(s.outbox.id, i.outboxId)).get()
  const allowed = row === undefined ? [] : remediesFor(row)
  if (row === undefined || allowed.length === 0) throw new PosError('REMEDY_NOT_ALLOWED', 'the row is not on the "ส่งไม่ผ่าน" page')
  if (!allowed.includes(remedy)) throw new PosError('REMEDY_NOT_ALLOWED', `${remedy} does not fit ${decodeLastError(row.lastError).reason || row.status}`)
  return { row, approver, reason }
}

/** The row's new data must still be a row dayo can read, under the same key (<kind>:<pos_order_id>). */
function checkedData(row: Row, data: unknown): OrderRowData | OrderVoidRowData {
  const parsed = row.tableName === 'order' ? OrderRowData.safeParse(data) : OrderVoidRowData.safeParse(data)
  if (!parsed.success) throw new PosError('BAD_INPUT', `E2 ${row.tableName} row: ${parsed.error.issues.slice(0, 3).map((x) => `${x.path.join('.')} ${x.message}`).join(' · ')}`)
  if (parsed.data.pos_order_id !== orderIdOf(row)) throw new PosError('BAD_INPUT', 'pos_order_id cannot change (it is the key)')
  return parsed.data
}

/**
 * Rewrites a REJECTED row's data and re-queues it under the SAME key (spec §6.1: allowed only because dayo never
 * stores a rejected result under a key) — pending, a fresh budget. Children parked as PARENT_REJECTED come back too.
 * The write is guarded by the status the check saw: a row decided meanwhile is never overwritten (rolls back).
 */
async function requeue(tx: RemoteDb, row: Row, data: unknown): Promise<void> {
  const parsed = checkedData(row, data)
  const done = await tx.update(s.outbox).set({ rowJson: parsed, status: 'pending', attempts: 0, deadAt: null, nextAttemptAt: null, lastError: null })
    .where(and(eq(s.outbox.id, row.id), eq(s.outbox.status, 'dead'))).returning({ id: s.outbox.id })
  if (done.length !== 1) throw new PosError('REMEDY_NOT_ALLOWED', 'the row changed meanwhile — reload the page')
  const kids = await tx.select().from(s.outbox).where(and(eq(s.outbox.parentKey, row.idempotencyKey), eq(s.outbox.status, 'dead'))).all()
  for (const k of kids) {
    if (decodeLastError(k.lastError).reason === 'PARENT_REJECTED') await tx.update(s.outbox).set({ status: 'pending', attempts: 0, deadAt: null, nextAttemptAt: null, lastError: null }).where(and(eq(s.outbox.id, k.id), eq(s.outbox.status, 'dead')))
  }
}

/** The event of a remedy in the bill's hash chain, with the WHOLE old row (spec §6.4 · Iron Rule 4). */
async function remedyEvent(tx: RemoteDb, deps: ApiDeps, row: Row, approverId: string, type: 'RECEIPT_RENUMBERED' | 'CODE_REMAPPED' | 'STAFF_REMAPPED' | 'EXCLUDED_FROM_SYNC', payload: Record<string, unknown>): Promise<void> {
  const device = await requireDevice(tx)
  await appendOrderEvents(tx, { orderId: orderIdOf(row), deviceId: device.id, actorType: 'user', actorId: approverId, at: deps.now(), newId: deps.newId },
    [{ type, payload: { ...payload, key: row.idempotencyKey, approvedBy: approverId, before: row.rowJson } }])
}

/** CONFLICT on the receipt number: the next receipt number of this device → order.receipt_no + row_json.receipt_no. Money never changes. */
export async function renumberReceipt(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }): Promise<{ oldReceiptNo: string; newReceiptNo: string }> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'RENUMBER')
  const device = await requireDevice(db)
  const out = await db.transaction(async (tx) => {
    const data = OrderRowData.parse(row.rowJson)
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
 * (cash_total = payment_code = 'cash', 0051_multi_source_sales.sql:1900 · 0009_stock_reports.sql:122,579; seed.sql:23).
 * A name or alias is never read: a substring match took "Cashless QR" for cash and "ไม่ใช่เงินสด" for cash.
 */
const isCashCode = (code: string): boolean => code === PAYMENT_CODE.CASH

const NOT_NAMED = 'แก้ได้เฉพาะรายการที่ระบบกลางแจ้งว่าไม่รู้จัก'

/**
 * UNKNOWN_CODE: replace the ONE value dayo named in its rejection (namedUnknown — follow-up item 2) with one the latest
 * catalog sells. Any other field or line is refused (BAD_INPUT), so a remedy for one unknown line cannot also move the
 * payment or the channel (which would never show in "ยอดไม่ตรงระบบกลาง" / would shift dayo's fee), and a value the
 * tablet's stale catalog still lists can be fixed once dayo said it does not know it. The new value is never the one
 * dayo refused. A payment stays the kind of money collected: a cash bill stays 'cash', a QR bill stays non-cash.
 * `totals` stay the charged ones (spec §6.4) — if dayo prices a new line code differently, the bill shows in
 * "ยอดไม่ตรงระบบกลาง".
 */
export async function remapCode(db: RemoteDb, deps: ApiDeps, i: RemapCodeInput): Promise<void> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'REMAP_CODE')
  const named = namedUnknown(row)
  if (named === null) throw new PosError('REMEDY_NOT_ALLOWED', 'dayo named no code of this bill')
  const c = await readCatalog(db)
  if (c === null) throw new PosError('NO_CATALOG', 'no catalog')
  const data = OrderRowData.parse(row.rowJson)
  const next = structuredClone(data)
  const tg = i.target
  if (tg.field !== named.field) throw new PosError('BAD_INPUT', `${NOT_NAMED} (${named.field})`)
  if (tg.field === 'line' && named.field === 'line') {
    const line = Number.isSafeInteger(tg.lineIndex) && tg.lineIndex >= 0 ? next.lines[tg.lineIndex] : undefined
    if (line === undefined) throw new PosError('BAD_INPUT', 'ไม่มีบรรทัดนี้ในบิล')
    if (!named.matches(line)) throw new PosError('BAD_INPUT', `${NOT_NAMED} — บรรทัดนี้ไม่ใช่บรรทัดที่ระบบกลางแจ้ง`)
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
    const collected = (await db.select({ method: s.payment.method }).from(s.payment).where(eq(s.payment.orderId, data.pos_order_id)).orderBy(asc(s.payment.createdAt)).get())?.method
    if (collected === undefined) throw new PosError('BAD_INPUT', 'บิลนี้ไม่มีการชำระเงินในเครื่อง')
    if (isCashCode(tg.code) !== (collected === 'CASH')) throw new PosError('BAD_INPUT', collected === 'CASH' ? 'บิลนี้รับเงินสด — เลือกวิธีชำระเงินสด (cash) เท่านั้น' : 'บิลนี้ไม่ได้รับเงินสด — เลือกวิธีชำระที่ไม่ใช่เงินสด')
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

/** UNKNOWN_STAFF: the seller (or the void's approver, when that is the unknown id) becomes an ACTIVE member of the latest list. */
export async function remapStaff(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string; newStaffId: string }): Promise<void> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'REMAP_STAFF')
  const staff = (await readCatalog(db))?.staff
  if (staff === undefined) throw new PosError('NO_CATALOG', 'no staff list')
  const e = staff.find((x) => x.id === i.newStaffId)
  if (e === undefined || !e.active || roleOf(e.role) === null) throw new PosError('BAD_INPUT', 'เลือกพนักงานที่ใช้งานอยู่ในรายชื่อล่าสุด')
  const listed = new Set(staff.map((x) => x.id))
  const data = row.rowJson as { staff_id: string; approved_by?: string | null }
  const field = row.tableName === 'order_void' && data.approved_by != null && !listed.has(data.approved_by) ? 'approved_by' : 'staff_id'
  const next = { ...data, [field]: i.newStaffId }
  checkedData(row, next)
  await db.transaction(async (tx) => {
    await remedyEvent(tx, deps, row, approver.id, 'STAFF_REMAPPED', { field, old: data[field] ?? null, newStaffId: i.newStaffId, reason })
    await requeue(tx, row, next)
  })
  deps.afterWrite?.()
}

/**
 * INVALID/FORBIDDEN/BAD_KEY, and a far-ahead CLOCK_AHEAD row by the owner's hand (N5): never sent again (ruling R8) —
 * the row and its waiting children become local_only. No order_excluded row in block 2 (R8), no PAID_IN/PAID_OUT.
 * The status write is guarded by the status the check saw; a verdict of a request already on the wire for this row
 * is then dropped by applyVerdicts (it judges only rows still pending).
 * Ledger ruling 1: if dayo ACCEPTED that in-flight request of a far-ahead row just excluded here, dayo now counts it
 * as a real sale while this tablet shows it excluded — block 3 must reconcile that (the accepted verdict is not kept).
 */
export async function excludeFromSync(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }): Promise<void> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'EXCLUDE')
  await db.transaction(async (tx) => {
    const done = await tx.update(s.outbox).set({ status: 'local_only', nextAttemptAt: null }).where(and(eq(s.outbox.id, row.id), eq(s.outbox.status, row.status))).returning({ id: s.outbox.id })
    if (done.length !== 1) throw new PosError('REMEDY_NOT_ALLOWED', 'the row changed meanwhile — reload the page')
    await remedyEvent(tx, deps, row, approver.id, 'EXCLUDED_FROM_SYNC', { reason, status: row.status, lastError: decodeLastError(row.lastError) })
    await tx.update(s.outbox).set({ status: 'local_only', nextAttemptAt: null }).where(and(eq(s.outbox.parentKey, row.idempotencyKey), inArray(s.outbox.status, ['pending', 'dead'])))
    if (row.tableName === 'order') await tx.update(s.order).set({ excludedAt: deps.now() }).where(eq(s.order.id, orderIdOf(row)))
  })
  deps.afterWrite?.()
}

/** "ลองใหม่": dead → pending with a fresh budget (Task 13 retryRow), same data, same key. */
export async function retrySyncRow(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }): Promise<void> {
  await remedyRow(db, deps, i, 'RETRY')
  await db.transaction((tx) => retryRow(tx, i.outboxId))
  deps.afterWrite?.()
}

/** The "ส่งไม่ผ่าน" page: dead rows + far-ahead pending rows (N5 — "รอเวลา", EXCLUDE only), oldest first; a child waiting on a listed parent is nested under it. */
export async function listSyncProblems(db: RemoteDb, actorUserId: string): Promise<SyncProblemDto[]> {
  await requireOwner(db, actorUserId)
  const candidates = await db.select().from(s.outbox)
    .where(and(inArray(s.outbox.tableName, [...PAGE_KINDS]), or(eq(s.outbox.status, 'dead'), and(eq(s.outbox.status, 'pending'), like(s.outbox.lastError, '%"farAhead":true%')))))
    .orderBy(asc(s.outbox.createdAt), asc(sql`rowid`)).all()
  const shown = candidates.filter((r) => r.status === 'dead' || isFarAheadWaiting(r))
  if (shown.length === 0) return []
  const receipts = new Map((await db.select({ id: s.order.id, receiptNo: s.order.receiptNo }).from(s.order).where(inArray(s.order.id, [...new Set(shown.map(orderIdOf))])).all()).map((o) => [o.id, o.receiptNo]))
  const dto = (r: Row): SyncProblemDto => {
    const e = decodeLastError(r.lastError)
    return { outboxId: r.id, key: r.idempotencyKey, kind: r.tableName as PushKind, orderId: orderIdOf(r), receiptNo: receipts.get(orderIdOf(r)) ?? null, at: r.createdAt, reason: e.reason, detail: e.detail, remedies: remediesFor(r), children: [] }
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
  if (r === undefined || !isPageKind(r)) throw new PosError('BAD_INPUT', 'no such push row')
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
