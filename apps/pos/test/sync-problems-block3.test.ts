import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { OrderOffCatalogRowData } from '@dayo/contracts'
import { posErrorCode } from '../src/api/errors'
import { remediesFor } from '../src/api/sync-problems'
import { pullCatalog } from '../src/sync/catalog'
import { pushOnce, SCOPE_CLOSABLE_AFTER_MS } from '../src/sync/push'
import { encodeLastError } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

const owner = { approverUserId: STAFF.TungAo, approverPin: '1111', reason: 'แก้ตามหน้าส่งไม่ผ่าน' }
/** dayo's receipt-collision text of phase 1 (0052_pos_push.sql:421) — no prefix, block-2 text rule (preflight P4/D3). */
const COLLISION = 'เลขใบเสร็จ A-000001 ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว'
type Connected = Awaited<ReturnType<typeof openConnectedApi>>
const ctxOf = (t: Pick<Connected, 'db' | 'deps'>) => ({ db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() })

/**
 * A bill dayo rejects with `reason`/`detail`. `phase2` (default): the mock is dayo phase 2 — it advertises
 * order_off_catalog, so "ปิดเป็นบิลนอกแคตตาล็อก" is offered (preflight ruling P2); `phase2: false` = dayo main today.
 */
async function rejected(reason: string, detail: string, data?: unknown, pay: 'CASH' | 'PROMPTPAY' = 'PROMPTPAY', phase2 = true) {
  const t = await openConnectedApi({ block3: true, block3Phase2: phase2 })
  t.mock.setBlock3LiveFrom('2026-09-01')
  const ctx = ctxOf(t)
  const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], pay === 'CASH' ? { method: 'CASH', tenderedSatang: 5_000 } : { method: 'PROMPTPAY' })
  t.mock.override({ match: { key: `order:${r.orderId}` }, verdict: { status: 'rejected', reason, detail, ...(data === undefined ? {} : { data }) }, times: 1 })
  await pushOnce(ctx)
  const p = (await t.api.listSyncProblems(STAFF.TungAo)).find((x) => x.key === `order:${r.orderId}`)!
  return { t, ctx, r, p }
}
async function refusal(call: () => Promise<unknown>): Promise<string | null> {
  try { await call() } catch (e) { return posErrorCode(e) }
  throw new Error('expected a refusal')
}

describe('remediesFor (spec 04 §6.4 · ruling R11 · preflight P2/P4)', () => {
  const base = { pending: false, farAhead: false, held: false, scopeSince: null, nowIso: '2026-09-25T12:00:00.000Z', detail: 'x', offCatalog: true }
  it.each([
    ['order', 'UNKNOWN_CODE', null, ['RETRY', 'REMAP_CODE', 'CLOSE_OFF_CATALOG', 'EXCLUDE']],
    ['order', 'UNKNOWN_STAFF', null, ['RETRY', 'REMAP_STAFF', 'CLOSE_OFF_CATALOG', 'EXCLUDE']],
    ['order', 'CONFLICT', 'exists:', ['ACKNOWLEDGE_ELSEWHERE', 'EXCLUDE']],
    ['order', 'CONFLICT', 'off_catalog_exists:', ['ACKNOWLEDGE_ELSEWHERE', 'EXCLUDE']],
    ['order', 'CONFLICT', 'receipt_taken:', ['RETRY', 'RENUMBER', 'CLOSE_OFF_CATALOG', 'EXCLUDE']],
    // P4 · D3: no prefix = block 2's text rule — dayo already holds this key with other data: a new number would only burn receipts
    ['order', 'CONFLICT', null, ['RETRY', 'EXCLUDE']],
    ['order', 'CONFLICT', 'key_changed:', ['EXCLUDE']],
    ['order', 'STUCK', null, ['RETRY', 'EXCLUDE']],
    ['order', 'ENVELOPE', null, ['RETRY', 'EXCLUDE']],
    ['order', 'REQUEST_FAILED', null, ['RETRY', 'EXCLUDE']],
    ['order', 'INVALID', null, ['RETRY', 'CLOSE_OFF_CATALOG', 'EXCLUDE']],
    ['order', 'FORBIDDEN', null, ['RETRY', 'CLOSE_OFF_CATALOG', 'EXCLUDE']],
    ['order', 'BAD_KEY', null, ['RETRY', 'CLOSE_OFF_CATALOG', 'EXCLUDE']],
    ['order', 'SOMETHING_NEW', null, ['RETRY', 'CLOSE_OFF_CATALOG', 'EXCLUDE']],
    ['order', 'PARENT_REJECTED', null, []],
    ['order_off_catalog', 'CONFLICT', 'receipt_taken:', ['RETRY', 'RENUMBER']],
    ['order_off_catalog', 'CONFLICT', 'exists:', ['ACKNOWLEDGE_ELSEWHERE']],
    ['order_off_catalog', 'CONFLICT', 'key_changed:', ['EXCLUDE']],
    ['order_off_catalog', 'UNKNOWN_CODE', null, ['RETRY', 'REMAP_CODE']],
    ['order_off_catalog', 'UNKNOWN_STAFF', null, ['RETRY', 'REMAP_STAFF']],
    ['order_off_catalog', 'FORBIDDEN', 'rule:', ['RETRY', 'EXCLUDE']],
    ['order_off_catalog', 'FORBIDDEN', 'role:', ['RECONFIRM_OWNER']],
    ['order_off_catalog', 'INVALID', null, ['EXCLUDE']],
    ['order_off_catalog', 'STUCK', null, ['RETRY', 'EXCLUDE']],
    ['order_void', 'FORBIDDEN', 'rule:', ['EXCLUDE']],
    ['order_void', 'FORBIDDEN', null, ['RETRY', 'EXCLUDE']],            // P4: no prefix = block 2
    ['order_void', 'INVALID', null, ['RETRY', 'EXCLUDE']],
    ['order_void', 'UNKNOWN_STAFF', null, ['RETRY', 'REMAP_STAFF']],
    ['order_void', 'CONFLICT', null, ['RETRY', 'EXCLUDE']],
    ['shift_close', 'CONFLICT', 'z_no_taken:', ['EXCLUDE']],
    ['shift_close', 'INVALID', 'data_conflict:', ['EXCLUDE']],
    ['shift_close', 'FORBIDDEN', 'role:', ['RECONFIRM_OWNER']],
    ['cash_count', 'CONFLICT', 'counted:', ['EXCLUDE']],
    ['cash_movement', 'FORBIDDEN', 'rule:', ['EXCLUDE']],                // preflight D7
    ['shift_open', 'CONFLICT', 'key_changed:', ['EXCLUDE']],
    ['shift_open', 'FORBIDDEN', 'role:', ['REMAP_STAFF']],
    ['cash_movement', 'UNKNOWN_STAFF', null, ['RETRY', 'REMAP_STAFF']],
    ['cash_movement', 'INVALID', null, ['RETRY', 'EXCLUDE']],
    ['shift_open', 'STUCK', null, ['RETRY', 'EXCLUDE']],
    ['cash_count', 'PARENT_REJECTED', null, []],
  ] as const)('%s %s %s → %j', (kind, reason, prefix, want) => {
    expect(remediesFor({ ...base, kind, reason, prefix })).toEqual(want)
  })
  it('a phase-1 dayo (no order_off_catalog in E1) never gets CLOSE_OFF_CATALOG — every other button stays (ruling P2)', () => {
    for (const reason of ['UNKNOWN_CODE', 'INVALID', 'FORBIDDEN', 'BAD_KEY']) {
      const r = remediesFor({ ...base, kind: 'order', reason, prefix: null, offCatalog: false })
      expect(r).not.toContain('CLOSE_OFF_CATALOG')
      expect(r.at(-1)).toBe('EXCLUDE')
    }
  })
  it('a receipt collision without prefix is recognised by dayo\'s own text (P4 · D3)', () => {
    expect(remediesFor({ ...base, kind: 'order', reason: 'CONFLICT', prefix: null, detail: COLLISION })).toEqual(['RETRY', 'RENUMBER', 'CLOSE_OFF_CATALOG', 'EXCLUDE'])
    expect(remediesFor({ ...base, kind: 'order', reason: 'CONFLICT', prefix: null, detail: COLLISION, offCatalog: false })).toEqual(['RETRY', 'RENUMBER', 'EXCLUDE'])
  })
  it('every dead order row except PARENT_REJECTED ends with EXCLUDE (review item 2)', () => {
    for (const reason of ['UNKNOWN_CODE', 'UNKNOWN_STAFF', 'CONFLICT', 'INVALID', 'FORBIDDEN', 'BAD_KEY', 'STUCK', 'ENVELOPE', 'NO_VERDICT_REPEATED', 'X']) {
      for (const offCatalog of [true, false]) expect(remediesFor({ ...base, kind: 'order', reason, prefix: null, offCatalog }).at(-1)).toBe('EXCLUDE')
    }
  })
  it('a scope wait shows up only after 7 days, with EXCLUDE only', () => {
    const since = '2026-09-18T12:00:00.000Z'
    expect(remediesFor({ ...base, kind: 'shift_open', pending: true, reason: 'FORBIDDEN', prefix: 'scope:', scopeSince: since, nowIso: '2026-09-25T11:59:59.999Z' })).toEqual([])
    expect(remediesFor({ ...base, kind: 'shift_open', pending: true, reason: 'FORBIDDEN', prefix: 'scope:', scopeSince: since, nowIso: new Date(Date.parse(since) + SCOPE_CLOSABLE_AFTER_MS).toISOString() })).toEqual(['EXCLUDE'])
  })
  it('a pending row far ahead (N5) or a shift-lane row dayo does not support (carried item 6): EXCLUDE only · any other pending row: none', () => {
    expect(remediesFor({ ...base, kind: 'cash_count', pending: true, reason: 'CLOCK_AHEAD', prefix: null, farAhead: true })).toEqual(['EXCLUDE'])
    expect(remediesFor({ ...base, kind: 'shift_open', pending: true, reason: 'UNSUPPORTED', prefix: null, held: true })).toEqual(['EXCLUDE'])
    expect(remediesFor({ ...base, kind: 'order', pending: true, reason: 'BUSY', prefix: null })).toEqual([])
  })
})

describe('owner remedies of block 3 (spec 04 §6.4)', () => {
  it('"ปิดเป็นบิลนอกแคตตาล็อก": the order row stops for good, order_off_catalog is queued with the frozen money, the void follows it', async () => {
    const { t, ctx, r, p } = await rejected('UNKNOWN_CODE', 'ไม่พบเมนู "Cocoa"', undefined, 'CASH')
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'ลูกค้ายกเลิก', made: false, refundReference: null })
    expect(await t.api.closeOffCatalog({ ...owner, outboxId: p.outboxId })).toEqual({ offCatalogKey: `order_off_catalog:${r.orderId}` })
    const rows = await t.db.select().from(s.outbox).all()
    expect(rows.find((x) => x.idempotencyKey === `order:${r.orderId}`)?.status).toBe('closed_off_catalog')
    const oc = rows.find((x) => x.idempotencyKey === `order_off_catalog:${r.orderId}`)!
    expect(OrderOffCatalogRowData.parse(oc.rowJson)).toMatchObject({ totals: { total: 45 }, original_reason: 'UNKNOWN_CODE', closed_by: STAFF.TungAo, reason: owner.reason, shift_id: t.shift!.id })
    expect(rows.find((x) => x.idempotencyKey === `order_void:${r.orderId}`)?.parentKey).toBe(`order_off_catalog:${r.orderId}`)
    expect((await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'CLOSED_OFF_CATALOG')).get())?.payloadJson).toMatchObject({ originalReason: 'UNKNOWN_CODE' })
    expect((await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())?.offCatalogAt).not.toBeNull()
    expect(await t.db.select().from(s.cashMovement).all()).toHaveLength(1) // only the VOID_REFUND — never a PAID_IN/PAID_OUT "to make up" for it (§4.10)
    expect((await t.api.getOrder(r.orderId))).toMatchObject({ offCatalog: true, central: { state: 'pending' } })
    await pushOnce(ctx); await pushOnce(ctx)
    expect(t.mock.orders().find((o) => o.posOrderId === r.orderId)).toMatchObject({ status: 'cancelled' })
    expect(await t.api.listSyncProblems(STAFF.TungAo)).toEqual([])
    expect((await t.api.getOrder(r.orderId)).central).toMatchObject({ state: 'sent', voidState: 'sent' })
  })
  it('closing the same bill twice is refused and writes nothing (idempotent owner action)', async () => {
    const { t, p } = await rejected('INVALID', 'x')
    await t.api.closeOffCatalog({ ...owner, outboxId: p.outboxId })
    expect(await refusal(() => t.api.closeOffCatalog({ ...owner, outboxId: p.outboxId }))).toBe('REMEDY_NOT_ALLOWED')
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_off_catalog')).all()).toHaveLength(1)
    expect(await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'CLOSED_OFF_CATALOG')).all()).toHaveLength(1)
  })
  it('dayo phase 1 (no order_off_catalog advertised): no button, and the API refuses — the block-2 buttons stay (ruling P2)', async () => {
    const { t, p } = await rejected('INVALID', 'x', undefined, 'PROMPTPAY', false)
    expect(p.remedies).toEqual(['RETRY', 'EXCLUDE'])
    expect(await refusal(() => t.api.closeOffCatalog({ ...owner, outboxId: p.outboxId }))).toBe('REMEDY_NOT_ALLOWED')
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_off_catalog')).all()).toEqual([])
  })
  it('only an owner, only with the PIN (can "close_off_catalog")', async () => {
    const { t, p } = await rejected('INVALID', 'x')
    await t.api.setStaffPin({ staffId: STAFF.Beam, pin: '5555', approverUserId: STAFF.TungAo, approverPin: '1111' })
    for (const bad of [{ ...owner, approverUserId: STAFF.Beam, approverPin: '5555' }, { ...owner, approverPin: '0000' }]) {
      expect(['NOT_OWNER', 'PIN_WRONG']).toContain(await refusal(() => t.api.closeOffCatalog({ ...bad, outboxId: p.outboxId })))
    }
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_off_catalog')).all()).toEqual([])
  })
  it('a row the tablet itself gave up on (STUCK) cannot be closed off-catalog (ruling R11)', async () => {
    const { t, p } = await rejected('INVALID', 'x')
    await t.db.update(s.outbox).set({ lastError: JSON.stringify({ reason: 'STUCK', detail: '' }) }).where(eq(s.outbox.id, p.outboxId))
    expect(await refusal(() => t.api.closeOffCatalog({ ...owner, outboxId: p.outboxId }))).toBe('REMEDY_NOT_ALLOWED')
  })
  it('"รับทราบ — บิลอยู่ในระบบกลางแล้ว": marked sent with dayo\'s order_no; a different total raises the red bar (m2)', async () => {
    const data = { order_no: 'L260925-014', version: 2, reported_total: 40, payment_is_cash: false, off_catalog: true }
    const { t, ctx, r, p } = await rejected('CONFLICT', 'off_catalog_exists: L260925-014', data)
    expect(p).toMatchObject({ prefix: 'off_catalog_exists:', remedies: ['ACKNOWLEDGE_ELSEWHERE', 'EXCLUDE'] })
    expect(p.central).toEqual({ orderNo: 'L260925-014', reportedTotalSatang: 4_000, paymentIsCash: false, matchesLocal: false })
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'ลูกค้ายกเลิก', made: false, refundReference: 'K1' })
    await pushOnce(ctx) // the void waits: its bill row is dead → PARENT_REJECTED
    expect(await t.api.acknowledgeElsewhere({ ...owner, outboxId: p.outboxId })).toEqual({ orderNo: 'L260925-014', matchesLocal: false })
    expect((await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())).toMatchObject({ centralOrderNo: 'L260925-014', centralMismatchJson: { reportedTotalSatang: 4_000, localTotalSatang: 4_500 } })
    const rows = await t.db.select().from(s.outbox).all()
    expect(rows.find((x) => x.idempotencyKey === `order:${r.orderId}`)).toMatchObject({ status: 'sent' })
    expect(rows.find((x) => x.idempotencyKey === `order_void:${r.orderId}`)).toMatchObject({ status: 'pending' }) // released
    expect((await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'DELIVERED_ELSEWHERE')).get())?.payloadJson).toMatchObject({ order_no: 'L260925-014', matchesLocal: false, approvedBy: STAFF.TungAo })
    const st = await t.api.syncStatus()
    expect(st.centralMismatchBills).toBe(1)
    expect(await t.api.getOrder(r.orderId)).toMatchObject({ centralMismatch: { orderNo: 'L260925-014', reportedTotalSatang: 4_000 }, central: { state: 'sent', orderNo: 'L260925-014' } })
    expect(await refusal(() => t.api.acknowledgeElsewhere({ ...owner, outboxId: p.outboxId }))).toBe('REMEDY_NOT_ALLOWED') // twice: nothing more
  })
  it('"รับทราบ" of a matching bill: no red bar', async () => {
    const data = { order_no: 'L260925-015', version: 1, reported_total: 45, payment_is_cash: true, off_catalog: false }
    const { t, p } = await rejected('CONFLICT', 'off_catalog_exists: L260925-015', data, 'CASH')
    expect(await t.api.acknowledgeElsewhere({ ...owner, outboxId: p.outboxId })).toEqual({ orderNo: 'L260925-015', matchesLocal: true })
    expect((await t.api.syncStatus()).centralMismatchBills).toBe(0)
  })
  it('an exists: conflict whose data dayo did not send cannot be acknowledged — "ปิดไว้ในเครื่อง" is left', async () => {
    const { t, p } = await rejected('CONFLICT', 'off_catalog_exists: L260925-016')
    expect(p).toMatchObject({ central: null, remedies: ['EXCLUDE'] })
    expect(await refusal(() => t.api.acknowledgeElsewhere({ ...owner, outboxId: p.outboxId }))).toBe('REMEDY_NOT_ALLOWED')
  })
  it('a bill dayo\'s shape rules would refuse as off-catalog (clock set back before sold_at) → OFF_CATALOG_NOT_POSSIBLE, nothing written, "ปิดไว้ในเครื่อง" still offered (review item 2)', async () => {
    const { t, r, p } = await rejected('INVALID', 'x')
    t.clock.set('2026-09-25T02:00:00.000Z')                                       // an hour before the sale (sold 03:00Z)
    expect(await refusal(() => t.api.closeOffCatalog({ ...owner, outboxId: p.outboxId }))).toBe('OFF_CATALOG_NOT_POSSIBLE')
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`)).get())?.status).toBe('dead')
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_off_catalog')).all()).toEqual([])
    expect(await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'CLOSED_OFF_CATALOG')).all()).toEqual([])
    expect(p.remedies.at(-1)).toBe('EXCLUDE')
    await t.api.excludeFromSync({ ...owner, outboxId: p.outboxId })
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`)).get())?.status).toBe('local_only')
  })
  it('closing off-catalog needs a reason: blank → BAD_INPUT, nothing written (review item 13)', async () => {
    const { t, p } = await rejected('INVALID', 'x')
    expect(await refusal(() => t.api.closeOffCatalog({ ...owner, reason: '   ', outboxId: p.outboxId }))).toBe('BAD_INPUT')
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_off_catalog')).all()).toEqual([])
  })
  it('CODE_REMAPPED of a payment on the same non-cash side passes and the bill goes (review item 13)', async () => {
    const { t, ctx, r, p } = await rejected('UNKNOWN_CODE', 'ไม่พบวิธีชำระ "qr"')
    t.mock.bumpCatalog((c) => { c.catalog.paymentMethods.push({ code: 'transfer', name: 'โอน', aliases: [] }) })
    await pullCatalog(ctx)
    await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'payment', code: 'transfer' } })
    await pushOnce(ctx)
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`)).get())?.status).toBe('sent')
  })
  it('CODE_REMAPPED of a payment never flips cash ↔ non-cash (§4.10 ข้อ 7)', async () => {
    const { t, p } = await rejected('UNKNOWN_CODE', 'ไม่พบวิธีชำระ "qr"')
    expect(await refusal(() => t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'payment', code: 'cash' } }))).toBe('REMEDY_NOT_ALLOWED')
  })
  it('a shift conflict (key_changed:) shows the S5 red bar and "ปิดไว้ในเครื่อง" frees the lane; children of every level follow (R12 · R19)', async () => {
    const t = await openConnectedApi({ block3: true })
    const ctx = ctxOf(t)
    await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'น้ำแข็ง' })
    t.mock.override({ match: { key: `shift_open:${t.shift!.id}` }, verdict: { status: 'rejected', reason: 'CONFLICT', detail: 'key_changed: x' }, times: 1 })
    await pushOnce(ctx)
    expect((await t.api.syncStatus())).toMatchObject({ shiftDataConflict: true, problemBills: 1 }) // one root cause, its child rolls up (carried item 2)
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ kind: 'shift_open', orderId: null, shiftId: t.shift!.id, hint: 'shift_conflict', remedies: ['EXCLUDE'], children: [expect.objectContaining({ kind: 'cash_movement', reason: 'PARENT_REJECTED', remedies: [] })] })
    await t.api.excludeFromSync({ ...owner, outboxId: p!.outboxId })
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, t.shift!.id)).get())?.syncMode).toBe('local_only')
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'cash_movement')).get())?.status).toBe('local_only')
    expect(await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'sync_row_excluded')).all()).toHaveLength(1)
    // later rows of the shift stay on the tablet (R19): a new movement is local_only at once
    await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_IN', amountSatang: 1_000, reason: 'เงินทอน' })
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'cash_movement')).all()).map((x) => x.status)).toEqual(['local_only', 'local_only'])
    expect((await t.api.syncStatus()).shiftDataConflict).toBe(false)
  })
  it('scope bar: yellow at once, red after 24 h, closable after 7 days (m1)', async () => {
    const t = await openConnectedApi({ block3: true })
    const ctx = ctxOf(t)
    t.mock.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write'])
    await pushOnce(ctx)
    expect((await t.api.syncStatus()).scopeWait).toMatchObject({ scope: 'shift:write', red: false, closable: false })
    expect(await t.api.listSyncProblems(STAFF.TungAo)).toEqual([]) // < 7 days: not on the page
    t.clock.advanceMs(24 * 3_600_000 + 1)
    expect((await t.api.syncStatus()).scopeWait).toMatchObject({ red: true, closable: false })
    t.clock.advanceMs(6 * 86_400_000)
    expect((await t.api.syncStatus()).scopeWait).toMatchObject({ red: true, closable: true })
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ kind: 'shift_open', waiting: 'scope', prefix: 'scope:', remedies: ['EXCLUDE'] })
    await t.api.excludeFromSync({ ...owner, outboxId: p!.outboxId })
    expect((await t.api.syncStatus()).scopeWait).toBeNull()
  })
  it('closed_off_catalog and local_only rows are never counted as "ยังไม่ส่ง"', async () => {
    const { t, p } = await rejected('INVALID', 'x')
    await t.api.closeOffCatalog({ ...owner, outboxId: p.outboxId })
    expect((await t.api.bootstrap()).pendingSyncItems).toBe(1) // only the new order_off_catalog row — shift_open went with the first push; the closed order row is not counted
  })
  it('RECONFIRM_OWNER: an off-catalog row dayo refused as not closed by an owner is closed again by this owner (PIN) and re-queued', async () => {
    const { t, ctx, r, p } = await rejected('INVALID', 'x')
    await t.api.closeOffCatalog({ ...owner, outboxId: p.outboxId })
    t.mock.override({ match: { key: `order_off_catalog:${r.orderId}` }, verdict: { status: 'rejected', reason: 'FORBIDDEN', detail: 'role: ผู้ปิดไม่ใช่เจ้าของร้าน' }, times: 1 })
    await pushOnce(ctx)
    const q = (await t.api.listSyncProblems(STAFF.TungAo)).find((x) => x.pushKind === 'order_off_catalog')!
    expect(q).toMatchObject({ orderId: r.orderId, remedies: ['RECONFIRM_OWNER'] })
    t.clock.advanceMs(60_000)
    await t.api.reconfirmOwner({ approverUserId: STAFF.DCm, approverPin: '2222', reason: 'ยืนยันอีกครั้ง', outboxId: q.outboxId })
    const row = (await t.db.select().from(s.outbox).where(eq(s.outbox.id, q.outboxId)).get())!
    expect(row).toMatchObject({ status: 'pending', attempts: 0, rowJson: { closed_by: STAFF.DCm, closed_at: t.clock.now() } })
    expect((await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'CLOSED_OFF_CATALOG')).all()).at(-1)?.payloadJson).toMatchObject({ reclosedBy: STAFF.DCm })
    await pushOnce(ctx)
    expect(t.mock.orders().find((o) => o.posOrderId === r.orderId)).toMatchObject({ status: 'ok' })
  })
  it('RECONFIRM_OWNER of a shift_close refused FORBIDDEN role: — closed_by becomes this owner; the local Z is not touched', async () => {
    const t = await openConnectedApi({ block3: true })
    const ctx = ctxOf(t)
    await pushOnce(ctx)
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.fetchBotCash(shiftId)
    const sum = await t.api.countSummary(shiftId)
    const res = await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, approverUserId: STAFF.TungAo, approverPin: '1111', countLines: [{ denominationSatang: 50_000, count: 1 }], shownFingerprint: sum.fingerprint, z: { varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: false } })
    t.mock.override({ match: { key: `shift_close:${shiftId}` }, verdict: { status: 'rejected', reason: 'FORBIDDEN', detail: 'role: ผู้ปิดกะไม่ใช่เจ้าของร้าน' }, times: 1 })
    await pushOnce(ctx)
    const p = (await t.api.listSyncProblems(STAFF.TungAo)).find((x) => x.pushKind === 'shift_close')!
    expect(p).toMatchObject({ shiftId, remedies: ['RECONFIRM_OWNER'], hint: null })
    await t.api.reconfirmOwner({ approverUserId: STAFF.DCm, approverPin: '2222', reason: 'ยืนยันอีกครั้ง', outboxId: p.outboxId })
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get())).toMatchObject({ status: 'pending', rowJson: { closed_by: STAFF.DCm } })
    expect(await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'sync_row_reconfirmed')).all()).toHaveLength(1)
    expect((await t.api.getZReport(shiftId)).hash).toBe(res.z!.hash)
    await pushOnce(ctx)
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get())?.status).toBe('sent')
  })
  it('REMAP_STAFF of a shift row: the field of its kind, an ACTIVE member of the latest list; the audit keeps the old row', async () => {
    const t = await openConnectedApi({ block3: true })
    const ctx = ctxOf(t)
    const m = await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'น้ำแข็ง' })
    t.mock.override({ match: { key: `cash_movement:${m.id}` }, verdict: { status: 'rejected', reason: 'UNKNOWN_STAFF', detail: 'ไม่พบพนักงาน' }, times: 1 })
    await pushOnce(ctx)
    const p = (await t.api.listSyncProblems(STAFF.TungAo)).find((x) => x.pushKind === 'cash_movement')!
    expect(p).toMatchObject({ remedies: ['RETRY', 'REMAP_STAFF'], orderId: null, shiftId: t.shift!.id })
    expect(await refusal(() => t.api.remapStaff({ ...owner, outboxId: p.outboxId, newStaffId: STAFF.Old }))).toBe('BAD_INPUT')
    await t.api.remapStaff({ ...owner, outboxId: p.outboxId, newStaffId: STAFF.Mint })
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get())).toMatchObject({ status: 'pending', rowJson: { created_by: STAFF.Mint } })
    expect((await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'sync_row_remapped')).get())).toMatchObject({ beforeJson: { created_by: STAFF.TungAo }, afterJson: { field: 'created_by', newStaffId: STAFF.Mint } })
    await pushOnce(ctx)
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get())?.status).toBe('sent')
  })
  it('a quick-opened shift dayo refused (role:) can only move to an owner', async () => {
    const t = await openConnectedApi({ block3: true, openShift: false })
    const ctx = ctxOf(t)
    const shift = await t.api.quickOpenShift({ userId: STAFF.TungAo })
    t.mock.override({ match: { key: `shift_open:${shift.id}` }, verdict: { status: 'rejected', reason: 'FORBIDDEN', detail: 'role: เปิดกะด่วนได้เฉพาะเจ้าของร้าน' }, times: 1 })
    await pushOnce(ctx)
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ kind: 'shift_open', remedies: ['REMAP_STAFF'] })
    expect(await refusal(() => t.api.remapStaff({ ...owner, outboxId: p!.outboxId, newStaffId: STAFF.Mint }))).toBe('BAD_INPUT')
    await t.api.remapStaff({ ...owner, outboxId: p!.outboxId, newStaffId: STAFF.DCm })
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.id, p!.outboxId)).get())?.rowJson).toMatchObject({ opened_by: STAFF.DCm })
  })
  it('a void dayo refused (FORBIDDEN rule:) names the bill\'s dayo number so the owner cancels it on the web (§6.4 ค)', async () => {
    const t = await openConnectedApi({ block3: true, block3Phase2: true })
    const ctx = ctxOf(t)
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await pushOnce(ctx)
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'x', made: false, refundReference: 'K' })
    t.mock.override({ match: { key: `order_void:${r.orderId}` }, verdict: { status: 'rejected', reason: 'FORBIDDEN', detail: 'rule: วันยกเลิกไม่ตรงวันขาย' }, times: 1 })
    await pushOnce(ctx)
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    const orderNo = (await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())!.centralOrderNo
    expect(orderNo).not.toBeNull()
    expect(p).toMatchObject({ kind: 'order_void', hint: 'void_rejected', centralOrderNo: orderNo, remedies: ['EXCLUDE'], receiptNo: r.receiptNo })
  })
  it('after the key was replaced during a central shift, dayo\'s rule: on the old shift\'s rows says so (carried item 7)', async () => {
    const t = await openConnectedApi({ block3: true })
    const ctx = ctxOf(t)
    await pushOnce(ctx) // shift_open under the old key
    t.clock.advanceMs(60_000)
    await t.db.insert(s.auditLog).values({ id: t.deps.newId(), entity: 'device', entityId: t.device.id, action: 'api_key_replaced', beforeJson: null, afterJson: { by: 'replaceApiKey' }, actorUserId: STAFF.TungAo, at: t.clock.now() })
    const m = await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'น้ำแข็ง' })
    t.mock.override({ match: { key: `cash_movement:${m.id}` }, verdict: { status: 'rejected', reason: 'FORBIDDEN', detail: 'rule: กะนี้เป็นของกุญแจอื่น' }, times: 1 })
    await pushOnce(ctx)
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ kind: 'cash_movement', hint: 'key_replaced', remedies: ['EXCLUDE'] })
    expect((await t.api.syncStatus()).shiftDataConflict).toBe(false) // not a stranger on the key: the owner replaced it
  })
  it('a shift-lane row dayo no longer supports holds the lane: it is listed with EXCLUDE and how many rows wait behind it (carried item 6)', async () => {
    const t = await openConnectedApi({ block3: true })
    const ctx = ctxOf(t)
    await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'น้ำแข็ง' })
    await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_IN', amountSatang: 1_000, reason: 'เงินทอน' })
    t.mock.setBlock3(false)
    await pullCatalog(ctx)
    expect(await pushOnce(ctx)).toMatchObject({ requests: 0 })
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ kind: 'shift_open', waiting: 'unsupported', remedies: ['EXCLUDE'], blocksLaneRows: 2 })
    await t.api.excludeFromSync({ ...owner, outboxId: p!.outboxId })
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'cash_movement')).all()).map((x) => x.status)).toEqual(['local_only', 'local_only'])
  })
  it('a void queued while its bill\'s order row is closed off-catalog waits for the order_off_catalog row (carried item 3)', async () => {
    const { t, ctx, r, p } = await rejected('INVALID', 'x')
    await t.api.closeOffCatalog({ ...owner, outboxId: p.outboxId })
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'x', made: false, refundReference: 'K' })
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order_void:${r.orderId}`)).get())?.parentKey).toBe(`order_off_catalog:${r.orderId}`)
    // an older build's void under the old parent is moved by the sender (same UPDATE rule as closeOffCatalog)
    await t.db.update(s.outbox).set({ parentKey: `order:${r.orderId}` }).where(eq(s.outbox.idempotencyKey, `order_void:${r.orderId}`))
    await pushOnce(ctx)
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order_void:${r.orderId}`)).get())).toMatchObject({ parentKey: `order_off_catalog:${r.orderId}` })
    await pushOnce(ctx)
    expect(t.mock.orders().find((o) => o.posOrderId === r.orderId)).toMatchObject({ status: 'cancelled' })
  })
  it('a count shows the bills of its Z dayo will never receive and their cash refunds (carried item 8)', async () => {
    const { t, r, p } = await rejected('INVALID', 'x', undefined, 'CASH')
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'x', made: false, refundReference: null })
    await t.api.excludeFromSync({ ...owner, outboxId: p.outboxId })
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect((await t.api.countSummary(shiftId)).notInDayo).toEqual({ bills: 1, voidRefundSatang: 4_500 })
  })
  it('a problem row of a dead row the owner cannot reach is never an unhandled state: an unreadable last_error still offers RETRY and EXCLUDE', async () => {
    const t = await openConnectedApi({ block3: true })
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.db.update(s.outbox).set({ status: 'dead', deadAt: t.clock.now(), lastError: 'garbage' }).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`))
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ remedies: ['RETRY', 'EXCLUDE'] })
    await t.db.update(s.outbox).set({ lastError: encodeLastError('NO_VERDICT_REPEATED', 'x') }).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`))
    expect((await t.api.listSyncProblems(STAFF.TungAo))[0]).toMatchObject({ remedies: ['RETRY', 'EXCLUDE'] })
  })
})
