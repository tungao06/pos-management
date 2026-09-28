import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { OrderRowData, OrderVoidRowData, Text200, type PushKind } from '@dayo/contracts'
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
import type { OwnerApproval, PriceDiffDto, RemapCodeInput, Remedy, SyncProblemDto } from './types'

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
 * show a RETRY that remedyRow refuses). A dead row: by its reason. Anything else: none (not on the page).
 */
function remediesFor(r: Row): Remedy[] {
  if (!isPageKind(r)) return []
  if (isFarAheadWaiting(r)) return ['EXCLUDE']
  if (r.status !== 'dead') return []
  return (REMEDIES[decodeLastError(r.lastError).reason] ?? ['RETRY']).filter((x) => x !== 'RENUMBER' || r.tableName === 'order')
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

/** CONFLICT: the next receipt number of this device → order.receipt_no + row_json.receipt_no. Money never changes. */
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
 * UNKNOWN_CODE: replace one code with one the latest catalog SELLS (an active size, an existing variant, a matcha grade
 * dayo lists, oat milk only where allowed) / an existing channel / payment method. `totals` stay the charged ones
 * (spec §6.4) — if dayo prices the new code differently, the bill shows in "ยอดไม่ตรงระบบกลาง".
 */
export async function remapCode(db: RemoteDb, deps: ApiDeps, i: RemapCodeInput): Promise<void> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'REMAP_CODE')
  if (row.tableName !== 'order') throw new PosError('REMEDY_NOT_ALLOWED', 'only a bill row has codes')
  const c = await readCatalog(db)
  if (c === null) throw new PosError('NO_CATALOG', 'no catalog')
  const data = OrderRowData.parse(row.rowJson)
  const next = structuredClone(data)
  const tg = i.target
  if (tg.field === 'line') {
    const line = Number.isSafeInteger(tg.lineIndex) && tg.lineIndex >= 0 ? next.lines[tg.lineIndex] : undefined
    if (line === undefined) throw new PosError('BAD_INPUT', 'ไม่มีบรรทัดนี้ในบิล')
    let v
    try {
      v = findSellableVariant(c.catalog, tg.code, tg.size, tg.sweetness)
    } catch (e) {
      if (e instanceof CartError) throw new PosError('BAD_INPUT', 'เลือกเมนู/ขนาด/ความหวานที่มีในแคตตาล็อกล่าสุด')
      throw e
    }
    const known = (g: string | null): g is string => g !== null && c.catalog.gradeOptions.some((x) => x.code === g)
    const grade = v.isMatcha ? (known(line.grade) ? line.grade : (c.catalog.gradeOptions.find((g) => g.isDefault)?.code ?? null)) : null
    if (v.isMatcha && grade === null) throw new PosError('BAD_INPUT', 'เมนูมัตฉะต้องมีเกรด')
    if (line.milk === 'oat' && !v.allowOatMilk) throw new PosError('BAD_INPUT', 'เมนูนี้ไม่มีนมโอ๊ต')
    next.lines[tg.lineIndex] = { ...line, code: tg.code, size: tg.size, sweetness: tg.sweetness, grade }
  } else if (tg.field === 'channel') {
    if (!c.catalog.channels.some((x) => x.code === tg.code)) throw new PosError('BAD_INPUT', 'ไม่มีช่องทางนี้ในแคตตาล็อกล่าสุด')
    next.channel = tg.code
  } else if (tg.field === 'payment') {
    if (!c.catalog.paymentMethods.some((x) => x.code === tg.code)) throw new PosError('BAD_INPUT', 'ไม่มีวิธีชำระนี้ในแคตตาล็อกล่าสุด')
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

/** spec §4.3 + review item 23 — owner only (R11). Money math: centralDiffSatang (@dayo/domain). */
export async function listPriceDiffs(db: RemoteDb, actorUserId: string): Promise<PriceDiffDto[]> {
  await requireOwner(db, actorUserId)
  const bills = await db.select().from(s.order).where(inArray(s.order.status, ['paid', 'voided'])).orderBy(asc(s.order.soldAt)).all()
  const rows = await db.select({ key: s.outbox.idempotencyKey, status: s.outbox.status }).from(s.outbox).where(inArray(s.outbox.tableName, [...PAGE_KINDS])).all()
  const statusOf = new Map(rows.map((r) => [r.key, r.status]))
  const out: PriceDiffDto[] = []
  for (const o of bills) {
    if (o.soldAt === null || o.receiptNo === null) continue
    const base = {
      orderId: o.id, receiptNo: o.receiptNo, soldAt: o.soldAt, totalSatang: o.totalSatang, computedTotalSatang: o.centralComputedTotalSatang,
      diffSatang: centralDiffSatang(o.centralComputedTotalSatang, o.totalSatang), catalogVersion: o.catalogVersion, amountMismatch: o.centralAmountMismatch === true,
    }
    if (base.diffSatang !== null && base.diffSatang !== 0) out.push({ ...base, kind: 'amount' })
    if (o.status === 'voided' && statusOf.get(`order:${o.id}`) === 'sent' && statusOf.get(`order_void:${o.id}`) === 'local_only') out.push({ ...base, kind: 'void_local_only' })
  }
  return out
}
