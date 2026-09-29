import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { bangkokDateOf, type OrderRowData } from '@dayo/contracts'
import { buildCashCountRowData, buildCashMovementRowData, buildOffCatalogRowData, buildShiftOpenRowData, edgeBahtToSatang } from '@dayo/domain'
import { enqueuePush } from '../src/db/outbox'
import { CLOCK_AHEAD_FAR_MS, pushOnce, releaseChildren, REQUEST_FAILED, retryRow, SCOPE_CLOSABLE_AFTER_MS, SCOPE_RED_AFTER_MS, SCOPE_RETRY_MS } from '../src/sync/push'
import { DAYO_KEYS, decodeLastError, encodeLastError, writeKey } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

const SH = '5a5a5a5a-0000-4000-8000-000000000001'
const M1 = '6b6b6b6b-0000-4000-8000-000000000001'
const C = '7c7c7c7c-0000-4000-8000-000000000001'
/** No shift from the helper (review item 4): Task 11, merged in the same round, makes an opened shift queue its own
 * shift_open — these tests build every shift-lane row themselves and assert by key, never by counting rows. */
async function ready() {
  return connect({ block3: true })
}
/** `sent` = every key of every E2 request body, in order (assert by key — review item 4). */
async function connect(opts: { block3: boolean; block3Phase2?: boolean }) {
  const t = await openConnectedApi({ ...opts, openShift: false })
  const sent: string[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/pos/push')) sent.push(...(JSON.parse(String(init?.body)) as { rows: { key: string }[] }).rows.map((x) => x.key))
    return t.mock.fetch(input, init)
  }
  return { t, sent, ctx: { db: t.db, deps: { ...t.deps, fetch }, serial: <T>(fn: () => Promise<T>) => fn() } }
}
type T = Awaited<ReturnType<typeof ready>>['t']
/** A bill needs an open shift; opened AFTER the test's own shift rows so it never sits ahead of them in the lane. */
async function sellOne(t: T) {
  if ((await t.api.bootstrap()).openShift === null) await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 0 }) // BootstrapState.openShift (block 2 api/types.ts)
  return sellCode(t as unknown as Parameters<typeof sellCode>[0], [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }) // sellCode never reads t.shift
}
async function queueShift(t: T, id = SH) {
  const at = t.clock.now()
  await t.db.transaction((tx) => enqueuePush(tx, { kind: 'shift_open', id, data: buildShiftOpenRowData({ shiftId: id, businessDate: bangkokDateOf(at), openedAt: at, openedBy: STAFF.TungAo, openingFloatSatang: 50_000, quickOpen: false }), parentKey: null }, at, t.deps.newId))
}
async function queuePaidOut(t: T, id = M1, shiftId = SH) {
  t.clock.advanceMs(1_000)
  const at = t.clock.now()
  await t.db.transaction((tx) => enqueuePush(tx, { kind: 'cash_movement', id, data: buildCashMovementRowData({ movementId: id, shiftId, kind: 'PAID_OUT', amountSatang: 2_000, posOrderId: null, reason: 'ซื้อน้ำแข็ง', createdBy: STAFF.TungAo, createdAt: at }), parentKey: `shift_open:${shiftId}` }, at, t.deps.newId))
}
async function queueCount(t: T, id = C, shiftId = SH) {
  t.clock.advanceMs(1_000)
  const at = t.clock.now()
  const data = buildCashCountRowData({ countId: id, shiftId, lines: [{ denominationSatang: 50_000, count: 1 }], countedBy: STAFF.TungAo, countedAt: at })
  await t.db.transaction((tx) => enqueuePush(tx, { kind: 'cash_count', id, data, parentKey: `shift_open:${shiftId}` }, at, t.deps.newId))
}
const row = async (t: T, key: string) => (await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, key)).get())!

describe('pushOnce — block 3 lanes and verdicts (spec 04 §6.2 · §4.10)', () => {
  it('shift rows go in order and are accepted; the result data is kept', async () => {
    const { t, ctx } = await ready()
    await queueShift(t); await queuePaidOut(t)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 2 })
    expect((await row(t, `cash_movement:${M1}`)).resultJson).toEqual({ movement_id: M1 })
    expect((await row(t, `shift_open:${SH}`)).resultJson).toEqual({ shift_id: SH })
    expect(t.mock.movements()).toHaveLength(1)
  })
  it('a deferred shift row holds the shift lane across requests while bills still go (C3)', async () => {
    const { t, ctx } = await ready()
    await queueShift(t); await queuePaidOut(t)
    t.mock.override({ match: { key: `shift_open:${SH}` }, verdict: { status: 'deferred', reason: 'BUSY', detail: 'lock' }, times: 1 })
    await pushOnce(ctx)                                     // shift_open BUSY; the movement in the same request answers PARENT_PENDING
    t.clock.advanceMs(1_000)                                // shift_open backoff (5 s) not over yet
    const bill = await sellOne(t)
    await pushOnce(ctx)
    expect((await row(t, `order:${bill.orderId}`)).status).toBe('sent')      // the bill lane went
    expect(await row(t, `shift_open:${SH}`)).toMatchObject({ status: 'pending', attempts: 1 })
    expect(await row(t, `cash_movement:${M1}`)).toMatchObject({ status: 'pending' }) // held behind it, by key
    expect(t.mock.movements()).toEqual([])
    t.clock.advanceMs(6_001)                                // past the first backoff even at +20% jitter (5 s × 1.2)
    await pushOnce(ctx)
    expect((await row(t, `cash_movement:${M1}`)).status).toBe('sent')
  })
  it('a later shift with no parent of its own does not overtake a deferred shift row (one lane per device, C3)', async () => {
    const { t, ctx: c, sent } = await ready()
    const SH2 = '5a5a5a5a-0000-4000-8000-000000000002'
    await queueShift(t); t.clock.advanceMs(1_000); await queueShift(t, SH2)
    t.mock.override({ match: { key: `shift_open:${SH}` }, verdict: { status: 'deferred', reason: 'BUSY', detail: 'lock' }, times: 1 })
    await pushOnce(c)                                       // both in one request: dayo judges each by its own time (R13)
    expect(await row(t, `shift_open:${SH}`)).toMatchObject({ status: 'pending', attempts: 1 })
    await t.db.update(s.outbox).set({ status: 'pending', sentAt: null, attempts: 0, resultJson: null }).where(eq(s.outbox.idempotencyKey, `shift_open:${SH2}`)) // as if it had not gone yet
    sent.length = 0
    t.clock.advanceMs(1_000)
    expect(await pushOnce(c)).toMatchObject({ requests: 0 })   // SH is waiting out its backoff: SH2 is behind it in the lane
    expect(sent).toEqual([])
    t.clock.advanceMs(6_001)
    await pushOnce(c)
    expect(sent).toEqual([`shift_open:${SH}`, `shift_open:${SH2}`])
  })
  it('R4 one-row mode never reorders the shift lane: a refunded shift row still goes before a later one', async () => {
    const { t, ctx, sent } = await ready()
    const SH2 = '5a5a5a5a-0000-4000-8000-000000000002'
    await queueShift(t); t.clock.advanceMs(1_000); await queueShift(t, SH2)
    t.clock.advanceMs(60_000)
    const first = await row(t, `shift_open:${SH}`)
    // refunded after an outage: next_attempt_at = the refund time, which would send a BILL to the back of the rotation
    await t.db.update(s.outbox).set({ nextAttemptAt: t.clock.now(), lastError: encodeLastError(REQUEST_FAILED, 'HTTP 500', { requestFailed: true }) }).where(eq(s.outbox.id, first.id))
    await writeKey(t.db, DAYO_KEYS.pushSingleThrough, JSON.stringify({ ids: [first.id] }))
    await pushOnce(ctx)
    expect(sent).toEqual([`shift_open:${SH}`, `shift_open:${SH2}`])
  })
  it('FORBIDDEN "scope:" waits like a deferred row: pending, not counted, every 15 min, never on the problems page (m1)', async () => {
    const { t, ctx } = await ready()
    t.mock.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write'])
    await queueShift(t)
    expect(await pushOnce(ctx)).toMatchObject({ deferred: 1, rejected: 0 })
    const r1 = await row(t, `shift_open:${SH}`)
    expect(r1).toMatchObject({ status: 'pending', attempts: 0 })
    expect(Date.parse(r1.nextAttemptAt!) - Date.parse(t.clock.now())).toBe(SCOPE_RETRY_MS)
    const since = decodeLastError(r1.lastError).scopeSince
    expect(decodeLastError(r1.lastError)).toMatchObject({ reason: 'FORBIDDEN', prefix: 'scope:', scopeSince: t.clock.now() })
    t.clock.advanceMs(SCOPE_RETRY_MS); await pushOnce(ctx)
    expect(decodeLastError((await row(t, `shift_open:${SH}`)).lastError).scopeSince).toBe(since) // the first time is kept
    t.mock.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write', 'shift:write'])
    t.clock.advanceMs(SCOPE_RETRY_MS); await pushOnce(ctx)
    expect((await row(t, `shift_open:${SH}`)).status).toBe('sent')
  })
  it('a key without shift:write still sends the bills of the same request; later shift rows wait behind the scope row', async () => {
    const { t, ctx } = await ready()
    t.mock.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write'])
    await queueShift(t); await queuePaidOut(t)
    const bill = await sellOne(t)
    await pushOnce(ctx)
    expect((await row(t, `order:${bill.orderId}`)).status).toBe('sent')
    expect(await row(t, `shift_open:${SH}`)).toMatchObject({ status: 'pending', attempts: 0 })
    expect(await row(t, `cash_movement:${M1}`)).toMatchObject({ status: 'pending', attempts: 0 })
  })
  it('the scope wait times are the ones of spec §6.2 (15 min · red after 24 h · closable after 7 days)', () => {
    expect([SCOPE_RETRY_MS, SCOPE_RED_AFTER_MS, SCOPE_CLOSABLE_AFTER_MS]).toEqual([900_000, 86_400_000, 604_800_000])
  })
  it('a rejected shift_open sends its children to PARENT_REJECTED; once it is accepted they come back by themselves (R-I1 · R18)', async () => {
    const { t, ctx } = await ready()
    await queueShift(t); await queuePaidOut(t)
    t.mock.override({ match: { key: `shift_open:${SH}` }, verdict: { status: 'rejected', reason: 'UNKNOWN_STAFF', detail: 'x' }, times: 1 })
    await pushOnce(ctx)
    expect(decodeLastError((await row(t, `cash_movement:${M1}`)).lastError).reason).toBe('PARENT_REJECTED')
    await t.db.update(s.outbox).set({ status: 'pending', attempts: 0, nextAttemptAt: null }).where(eq(s.outbox.idempotencyKey, `shift_open:${SH}`)) // the owner's fix (Task 14) — children NOT touched here
    await pushOnce(ctx)                                     // parent accepted → children released in the same transaction
    expect((await row(t, `cash_movement:${M1}`)).status).toBe('pending')
    await pushOnce(ctx)
    expect((await row(t, `cash_movement:${M1}`)).status).toBe('sent')
  })
  it('a rejected shift_open takes every level of its children with it in one call (shift_open → cash_count → shift_close)', async () => {
    const { t, ctx } = await ready()
    await queueShift(t); await queuePaidOut(t); await queueCount(t)
    const at = t.clock.now()
    const close = { shift_id: SH, count_id: C, closed_by: STAFF.TungAo, closed_at: at, variance_reason: null, z_report: {
      z_no: 1, hash: 'ab'.repeat(32), prev_hash: null, variance_alert: 20, chain_warning: false,
      cash: { opening_float: 500, pos_cash_sales: 0, void_refunds: 0, paid_in: 0, paid_out: 20, drops: 0, drawer_expenses: 0, bot_cash: 0 },
      counted: 500, bot_window: { after: '2026-09-24T17:00:00.000Z', until: at }, movement_ids: [M1], bot_bills: [], pos_bills: [] } }
    await t.db.transaction((tx) => enqueuePush(tx, { kind: 'shift_close', id: SH, data: close, parentKey: `cash_count:${C}` }, at, t.deps.newId))
    t.mock.override({ match: { key: `shift_open:${SH}` }, verdict: { status: 'rejected', reason: 'UNKNOWN_STAFF', detail: 'x' }, times: 1 })
    await pushOnce(ctx)
    for (const k of [`cash_movement:${M1}`, `cash_count:${C}`, `shift_close:${SH}`]) {
      expect(await row(t, k)).toMatchObject({ status: 'dead' })
      expect(decodeLastError((await row(t, k)).lastError).reason).toBe('PARENT_REJECTED')
    }
    await retryRow(t.db, (await row(t, `shift_open:${SH}`)).id) // "ลองใหม่" on the parent: its own children come back (P6: one releaser)
    expect((await row(t, `cash_count:${C}`)).status).toBe('pending')
    expect((await row(t, `shift_close:${SH}`)).status).toBe('dead')  // a grandchild waits for ITS parent to be accepted
    await pushOnce(ctx)                                     // shift_open, movement, count accepted → the close is released
    expect((await row(t, `shift_close:${SH}`)).status).toBe('pending')
    await pushOnce(ctx)
    expect((await row(t, `shift_close:${SH}`)).status).toBe('sent')
    expect(t.mock.counts()).toHaveLength(1)
  })
  it('a local-only shift_open makes its children local-only too, at every level, and the lane walks on', async () => {
    const { t, ctx } = await ready()
    await queueShift(t); await queueCount(t)
    const SH2 = '5a5a5a5a-0000-4000-8000-000000000002'
    t.clock.advanceMs(1_000); await queueShift(t, SH2)
    await t.db.update(s.outbox).set({ status: 'local_only' }).where(eq(s.outbox.idempotencyKey, `shift_open:${SH}`)) // "ปิดไว้ในเครื่อง" (Task 14)
    await pushOnce(ctx)
    expect((await row(t, `cash_count:${C}`)).status).toBe('local_only')
    expect((await row(t, `shift_open:${SH2}`)).status).toBe('sent')
  })
  it('a rejected row keeps the verdict data (exists: comparisons — R16)', async () => {
    const { t, ctx } = await ready()
    const bill = await sellOne(t)
    const data = { order_no: 'L260925-001', version: 1, reported_total: 45, payment_is_cash: false, off_catalog: true }
    t.mock.override({ match: { key: `order:${bill.orderId}` }, verdict: { status: 'rejected', reason: 'CONFLICT', detail: 'off_catalog_exists: L260925-001', data }, times: 1 })
    await pushOnce(ctx)
    expect(await row(t, `order:${bill.orderId}`)).toMatchObject({ status: 'dead', resultJson: data })
    expect(decodeLastError((await row(t, `order:${bill.orderId}`)).lastError).prefix).toBe('off_catalog_exists:')
  })
  it('a rejected row keeps only the known, bounded fields of the verdict data (M6)', async () => {
    const { t, ctx } = await ready()
    const bill = await sellOne(t)
    const data = { order_no: `L${'9'.repeat(300)}`, version: 1, reported_total: 45, payment_is_cash: true, off_catalog: false, secret: 'x'.repeat(10_000) }
    t.mock.override({ match: { key: `order:${bill.orderId}` }, verdict: { status: 'rejected', reason: 'CONFLICT', detail: 'exists: x', data }, times: 1 })
    await pushOnce(ctx)
    const r = await row(t, `order:${bill.orderId}`)
    expect(Object.keys(r.resultJson as object).sort()).toEqual(['off_catalog', 'order_no', 'payment_is_cash', 'reported_total', 'version'])
    expect([...(r.resultJson as { order_no: string }).order_no].length).toBe(100)
    t.mock.override({ match: { key: `order:${bill.orderId}` }, verdict: { status: 'rejected', reason: 'INVALID', detail: 'x', data: 'not an object' }, times: 1 })
    await retryRow(t.db, r.id)
    await pushOnce(ctx)
    expect(await row(t, `order:${bill.orderId}`)).toMatchObject({ status: 'dead', resultJson: null })
    expect(decodeLastError((await row(t, `order:${bill.orderId}`)).lastError).prefix).toBeUndefined()
  })
  it('releaseChildren puts back only the PARENT_REJECTED children of the given parents (review item 13)', async () => {
    const { t, ctx } = await ready()
    const SH2 = '5a5a5a5a-0000-4000-8000-000000000002'
    const M2 = '6b6b6b6b-0000-4000-8000-000000000002'
    await queueShift(t); await queuePaidOut(t); await queueShift(t, SH2); await queuePaidOut(t, M2, SH2)
    t.mock.override({ match: { key: `shift_open:${SH}` }, verdict: { status: 'rejected', reason: 'INVALID', detail: 'x' }, times: 1 })
    t.mock.override({ match: { key: `shift_open:${SH2}` }, verdict: { status: 'rejected', reason: 'INVALID', detail: 'y' }, times: 1 })
    await pushOnce(ctx)
    expect(await t.db.transaction((tx) => releaseChildren(tx, []))).toBe(0)
    expect(await t.db.transaction((tx) => releaseChildren(tx, [`shift_open:${SH}`]))).toBe(1)
    expect(await row(t, `cash_movement:${M1}`)).toMatchObject({ status: 'pending', attempts: 0, lastError: null, nextAttemptAt: null })
    expect(decodeLastError((await row(t, `cash_movement:${M2}`)).lastError).reason).toBe('PARENT_REJECTED') // other parent: untouched
    expect((await row(t, `shift_open:${SH}`)).status).toBe('dead')                                         // the parent itself: untouched
  })
  it('a child dead for its own reason is never released with the PARENT_REJECTED ones', async () => {
    const { t, ctx } = await ready()
    await queueShift(t); await queuePaidOut(t)
    await pushOnce(ctx)
    await t.db.update(s.outbox).set({ status: 'dead', lastError: JSON.stringify({ reason: 'INVALID', detail: 'x' }) }).where(eq(s.outbox.idempotencyKey, `cash_movement:${M1}`))
    expect(await t.db.transaction((tx) => releaseChildren(tx, [`shift_open:${SH}`]))).toBe(0)
    expect((await row(t, `cash_movement:${M1}`)).status).toBe('dead')
  })
  it('a shift_close near the 2000-bill cap (> 262,144 bytes on its own) becomes dead ENVELOPE; the rows before it still go (round 2 item 4)', async () => {
    const { t, ctx } = await ready()
    await queueShift(t); await queueCount(t)
    const at = t.clock.now()
    const posBills = Array.from({ length: 2000 }, (_, i) => ({ pos_order_id: `0b0b0b0b-0000-4000-8000-${String(i).padStart(12, '0')}`, receipt_no: `A-${String(i + 1).padStart(6, '0')}`, payment: 'qr', total: 35, sold_at: at, voided_at: null }))
    const data = { shift_id: SH, count_id: C, closed_by: STAFF.TungAo, closed_at: at, variance_reason: null, z_report: {
      z_no: 1, hash: 'ab'.repeat(32), prev_hash: null, variance_alert: 20, chain_warning: false,
      cash: { opening_float: 500, pos_cash_sales: 0, void_refunds: 0, paid_in: 0, paid_out: 0, drops: 0, drawer_expenses: 0, bot_cash: 0 },
      counted: 500, bot_window: { after: '2026-09-24T17:00:00.000Z', until: at }, movement_ids: [], bot_bills: [], pos_bills: posBills } }
    expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeGreaterThan(262_144)
    // Task 9's enqueuePush accepts only the shift's cash_count as the parent of shift_close (spec §4.10 table)
    await t.db.transaction((tx) => enqueuePush(tx, { kind: 'shift_close', id: SH, data, parentKey: `cash_count:${C}` }, at, t.deps.newId))
    await pushOnce(ctx)
    expect((await row(t, `shift_open:${SH}`)).status).toBe('sent')
    expect((await row(t, `cash_count:${C}`)).status).toBe('sent')
    expect(await row(t, `shift_close:${SH}`)).toMatchObject({ status: 'dead' })
    expect(decodeLastError((await row(t, `shift_close:${SH}`)).lastError).reason).toBe('ENVELOPE')
  })
  it('without the block 3 kinds in E1 the shift rows are held (not counted, not sent)', async () => {
    const { t, ctx } = await connect({ block3: false })
    await queueShift(t)
    expect(await pushOnce(ctx)).toMatchObject({ held: 1, requests: 0 })
    expect(await row(t, `shift_open:${SH}`)).toMatchObject({ status: 'pending', attempts: 0, lastError: null })
  })
  it('dayo phase 1 (no order_off_catalog in E1): an off-catalog row is held — not counted, not dead (preflight D1)', async () => {
    const { t, ctx, sent } = await ready()
    const bill = await sellOne(t)
    const orderRow = await row(t, `order:${bill.orderId}`)
    await t.db.update(s.outbox).set({ status: 'closed_off_catalog' }).where(eq(s.outbox.id, orderRow.id)) // Task 14's close, simplified
    const order = orderRow.rowJson as OrderRowData
    const sub = edgeBahtToSatang(order.totals.items_subtotal)
    const data = buildOffCatalogRowData({ order, items: [{ menuCode: 'Cocoa', menuNameTh: 'โกโก้', size: '16 oz', sweetness: '50%', qty: 1, unitPriceSatang: sub, discountPerCupSatang: 0, lineTotalSatang: sub }], closedBy: STAFF.TungAo, closedAt: t.clock.now(), reason: 'เมนูเลิกขายแล้ว', originalReason: 'UNKNOWN_CODE' })
    await t.db.transaction((tx) => enqueuePush(tx, { kind: 'order_off_catalog', id: bill.orderId, data, parentKey: null }, t.clock.now(), t.deps.newId))
    expect((await pushOnce(ctx)).held).toBeGreaterThanOrEqual(1)
    t.clock.advanceMs(3_600_000)
    expect((await pushOnce(ctx)).held).toBeGreaterThanOrEqual(1)
    expect(sent).not.toContain(`order_off_catalog:${bill.orderId}`)
    expect(await row(t, `order_off_catalog:${bill.orderId}`)).toMatchObject({ status: 'pending', attempts: 0, lastError: null })
  })
  it('a void of a bill closed as off-catalog is never sent under the closed row: with no order_off_catalog row to wait for, it stays on the tablet (Task 14 · carried item 3)', async () => {
    // Task 14 changed this T10 expectation ("waits"): closeOffCatalog moves every void to the order_off_catalog row in its own
    // transaction and the sender moves a late one the same way (sync-problems-block3.test.ts) — a closed order row with NO such
    // row (a hand-edited file) means the bill will never reach dayo, so its void is local_only (spec §4.10: "no longer sent")
    const { t, ctx, sent } = await ready()
    const bill = await sellOne(t)
    await t.db.update(s.outbox).set({ status: 'closed_off_catalog' }).where(eq(s.outbox.idempotencyKey, `order:${bill.orderId}`))
    await t.api.cancelSale({ orderId: bill.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'กดผิด', made: false, refundReference: 'K1' })
    await pushOnce(ctx)
    expect(sent).not.toContain(`order_void:${bill.orderId}`)
    expect(await row(t, `order_void:${bill.orderId}`)).toMatchObject({ status: 'local_only', attempts: 0 })
  })
  it('an accepted order_off_catalog stores dayo\'s order number on the bill', async () => {
    const { t, ctx } = await connect({ block3: true, block3Phase2: true })
    const bill = await sellOne(t)
    const orderRow = await row(t, `order:${bill.orderId}`)
    await t.db.update(s.outbox).set({ status: 'closed_off_catalog' }).where(eq(s.outbox.id, orderRow.id))
    const order = orderRow.rowJson as OrderRowData
    const sub = edgeBahtToSatang(order.totals.items_subtotal)
    const data = buildOffCatalogRowData({ order, items: [{ menuCode: 'Cocoa', menuNameTh: 'โกโก้', size: '16 oz', sweetness: '50%', qty: 1, unitPriceSatang: sub, discountPerCupSatang: 0, lineTotalSatang: sub }], closedBy: STAFF.TungAo, closedAt: t.clock.now(), reason: 'เมนูเลิกขายแล้ว', originalReason: 'UNKNOWN_CODE' })
    await t.db.transaction((tx) => enqueuePush(tx, { kind: 'order_off_catalog', id: bill.orderId, data, parentKey: null }, t.clock.now(), t.deps.newId))
    t.mock.override({ match: { key: `order_off_catalog:${bill.orderId}` }, verdict: { status: 'accepted', data: { order_no: 'L260925-777', version: 1, extra: 'x' } }, times: 1 })
    await pushOnce(ctx)
    expect(await row(t, `order_off_catalog:${bill.orderId}`)).toMatchObject({ status: 'sent', resultJson: { order_no: 'L260925-777', version: 1 } })
    expect((await t.db.select().from(s.order).where(eq(s.order.id, bill.orderId)).get())!.centralOrderNo).toBe('L260925-777')
  })
  it('a shift row more than 24 h ahead of dayo stays pending, flagged, not counted — and holds the lane (N5 in the shift lane)', async () => {
    const { t, ctx } = await ready()
    t.clock.advanceMs(CLOCK_AHEAD_FAR_MS + 3_600_000)
    await queueShift(t)
    await pushOnce(ctx)
    const r = await row(t, `shift_open:${SH}`)
    expect(r).toMatchObject({ status: 'pending', attempts: 0 })
    expect(decodeLastError(r.lastError)).toMatchObject({ reason: 'CLOCK_AHEAD', farAhead: true })
  })
  it('a released child is not sent twice: dayo stores the movement once (idempotent key)', async () => {
    const { t, ctx } = await ready()
    await queueShift(t); await queuePaidOut(t)
    await pushOnce(ctx)
    await t.db.update(s.outbox).set({ status: 'dead', lastError: JSON.stringify({ reason: 'PARENT_REJECTED', detail: 'x' }) }).where(and(eq(s.outbox.idempotencyKey, `cash_movement:${M1}`)))
    await t.db.transaction((tx) => releaseChildren(tx, [`shift_open:${SH}`]))
    await pushOnce(ctx)
    expect((await row(t, `cash_movement:${M1}`)).status).toBe('sent')
    expect(t.mock.movements()).toHaveLength(1)
  })
})
