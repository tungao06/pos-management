import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { posErrorCode } from '../src/api/errors'
import { createPosApi } from '../src/api/pos-api'
import { pushOnce } from '../src/sync/push'
import { encodeLastError } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

const owner = { approverUserId: STAFF.TungAo, approverPin: '1111', reason: 'แก้ตามหน้าส่งไม่ผ่าน' }
/** dayo's detail of a receipt collision (0052_pos_push.sql:421) — the only CONFLICT RENUMBER fits (fix round 1 item 4). */
const COLLISION = 'เลขใบเสร็จ A-000001 ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว'
type RowData = { lines: { code: string }[]; channel: string; payment: string; approved_by?: string | null }
/** Stands for "the code dayo rejected is not in the latest catalog": the queued row now carries codes the catalog lacks. */
async function patchRow(t: Awaited<ReturnType<typeof openConnectedApi>>, key: string, patch: (d: RowData) => void) {
  const row = (await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, key)).get())!
  const d = structuredClone(row.rowJson) as RowData
  patch(d)
  await t.db.update(s.outbox).set({ rowJson: d }).where(eq(s.outbox.id, row.id))
}
async function rejectedBill(reason: string, detail = 'x', patch?: (d: RowData) => void) {
  const t = await openConnectedApi()
  const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
  const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
  if (patch !== undefined) await patchRow(t, `order:${r.orderId}`, patch)
  t.mock.override({ match: { receiptNo: r.receiptNo }, verdict: { status: 'rejected', reason, detail }, times: 1 })
  await pushOnce(ctx)
  const [p] = await t.api.listSyncProblems(STAFF.TungAo)
  return { t, ctx, r, p: p! }
}
const retiredMenu = (d: RowData) => { d.lines[0]!.code = 'Retired Menu' }
const closedChannel = (d: RowData) => { d.channel = 'closed_channel' }
/**
 * dayo's own UNKNOWN_CODE details, word for word (0052_pos_push.sql:371-402; 0051:1077 via 0052:648-649). The value
 * named there is the only one a remap may change (follow-up item 2).
 */
const UNKNOWN = {
  channel: (code: string) => `ไม่พบช่องทางขาย "${code}"`,
  payment: (code: string) => `ไม่พบวิธีชำระ "${code}"`,
  menu: (code: string) => `ไม่พบเมนู "${code}"`,
  variant: (code: string, size: string, sweetness: string) => `ไม่พบ "${code} ${size} ${sweetness}"`,
  grade: (code: string) => `ไม่พบเกรด "${code}"`,
  oat: 'ไม่พบตัวเลือกนม "oat"',
}
/** dayo adds payment methods to the latest catalog (E1) and the tablet pulls it. */
async function addPaymentMethods(t: Awaited<ReturnType<typeof openConnectedApi>>, methods: { code: string; name: string; aliases: string[] }[]) {
  t.mock.bumpCatalog((c) => { c.catalog.paymentMethods.push(...methods) })
  await t.api.syncNow()
}

describe('owner remedies (spec 04 §6.4)', () => {
  it('a row far ahead of the server clock is listed as waiting; only the owner\'s EXCLUDE closes it (ruling N5)', async () => {
    const t = await openConnectedApi({ now: '2026-09-27T03:00:00.000Z' }) // tablet clock 2 days fast
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setNow('2026-09-25T03:00:00.000Z')
    await pushOnce(ctx)
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ receiptNo: r.receiptNo, reason: 'CLOCK_AHEAD', remedies: ['EXCLUDE'] })
    try { await t.api.retrySyncRow({ ...owner, outboxId: p!.outboxId }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('REMEDY_NOT_ALLOWED') }
    await t.api.excludeFromSync({ ...owner, outboxId: p!.outboxId })
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.id, p!.outboxId)).get())?.status).toBe('local_only')
  })
  it('lists the problem with the allowed buttons only', async () => {
    const { p } = await rejectedBill('CONFLICT', 'เลขใบเสร็จ A-000001 ถูกใช้แล้ว')
    expect(p).toMatchObject({ kind: 'order', receiptNo: 'A-000001', reason: 'CONFLICT', remedies: ['RETRY', 'RENUMBER'] })
  })
  it('CONFLICT → a new receipt number, same key, then accepted', async () => {
    const { t, ctx, r, p } = await rejectedBill('CONFLICT', COLLISION)
    const original = (await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get())!.rowJson
    expect(await t.api.renumberReceipt({ ...owner, outboxId: p.outboxId })).toEqual({ oldReceiptNo: 'A-000001', newReceiptNo: 'A-000002' })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
    const ev = await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'RECEIPT_RENUMBERED')).get()
    expect(ev?.payloadJson).toMatchObject({ old: 'A-000001', new: 'A-000002' })
    expect((ev?.payloadJson as { before: unknown }).before).toEqual(original) // the whole old row stays in the hash chain
    expect((await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())?.totalSatang).toBe(4500) // money never changes
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get())?.idempotencyKey).toBe(p.key) // same key
  })
  it('a remedy that does not fit the reason is refused', async () => {
    const { t, p } = await rejectedBill('UNKNOWN_STAFF')
    try { await t.api.renumberReceipt({ ...owner, outboxId: p.outboxId }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('REMEDY_NOT_ALLOWED') }
  })
  it('UNKNOWN_STAFF → choose another seller from the latest list', async () => {
    const { t, ctx, p } = await rejectedBill('UNKNOWN_STAFF')
    await t.api.remapStaff({ ...owner, outboxId: p.outboxId, newStaffId: STAFF.DCm })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('UNKNOWN_CODE → map the line to an active menu of the latest catalog', async () => {
    const { t, ctx, p } = await rejectedBill('UNKNOWN_CODE', UNKNOWN.menu('Retired Menu'), retiredMenu)
    const original = (await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get())!.rowJson
    await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'line', lineIndex: 0, code: 'Thai Tea', size: '16 oz', sweetness: '50%' } })
    const ev = await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'CODE_REMAPPED')).get()
    expect((ev?.payloadJson as { before: unknown }).before).toEqual(original)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('INVALID → closed as "นอกระบบกลาง": never sent again, still in the tablet reports (ruling R8)', async () => {
    const { t, ctx, r, p } = await rejectedBill('INVALID')
    await t.api.excludeFromSync({ ...owner, outboxId: p.outboxId })
    expect(await t.api.listSyncProblems(STAFF.TungAo)).toEqual([])
    expect(await pushOnce(ctx)).toMatchObject({ requests: 0 })
    expect((await t.api.getOrder(r.orderId)).central.state).toBe('excluded')
  })
  it('needs an owner PIN', async () => {
    const { t, p } = await rejectedBill('CONFLICT', COLLISION)
    try { await t.api.renumberReceipt({ ...owner, approverPin: '0000', outboxId: p.outboxId }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('PIN_WRONG') }
  })
  it('export JSON holds the row and the reason, never the API key', async () => {
    const { t, p } = await rejectedBill('CONFLICT')
    const json = await t.api.exportSyncRow({ actorUserId: STAFF.TungAo, outboxId: p.outboxId })
    expect(JSON.parse(json)).toMatchObject({ key: p.key, kind: 'order', lastError: { reason: 'CONFLICT' } })
    expect(json).not.toContain('dayo_0123')
  })
  it('only an owner may list, export or read price differences — checked at the API (review item 22)', async () => {
    const { t, p } = await rejectedBill('CONFLICT')
    await t.api.setStaffPin({ staffId: STAFF.Mint, pin: '4321', approverUserId: STAFF.TungAo, approverPin: '1111' })
    for (const call of [() => t.api.listSyncProblems(STAFF.Mint), () => t.api.exportSyncRow({ actorUserId: STAFF.Mint, outboxId: p.outboxId }), () => t.api.listPriceDiffs(STAFF.Mint)]) {
      try { await call(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('NOT_OWNER') }
    }
  })
  it('UNKNOWN_CODE on the channel → map it to an active channel; the charged totals never change', async () => {
    const { t, ctx, r, p } = await rejectedBill('UNKNOWN_CODE', UNKNOWN.channel('closed_channel'), closedChannel)
    const before = (await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get())!.rowJson as { totals: unknown }
    await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'channel', code: 'store' } })
    const after = (await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get())!.rowJson as { totals: unknown }
    expect(after.totals).toEqual(before.totals)
    expect((await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'CODE_REMAPPED')).get())?.orderId).toBe(r.orderId)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('remapCode refuses a menu that is not in the latest catalog', async () => {
    const { t, p } = await rejectedBill('UNKNOWN_CODE', UNKNOWN.menu('Retired Menu'), retiredMenu)
    try { await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'line', lineIndex: 0, code: 'Nope', size: '16 oz', sweetness: '50%' } }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
  })
  it('remapCode touches only what dayo cannot know: a valid payment, channel or line of the same row is refused (fix round 1 item 2)', async () => {
    const { t, p } = await rejectedBill('UNKNOWN_CODE', UNKNOWN.menu('Retired Menu'), retiredMenu) // line 0's menu is the unknown code
    const before = await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get()
    const calls = [
      () => t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'payment', code: 'cash' } }),
      () => t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'channel', code: 'grab' } }),
    ]
    for (const call of calls) {
      try { await call(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
    }
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get()).toEqual(before)
    expect(await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'CODE_REMAPPED')).all()).toEqual([])
    const valid = await rejectedBill('UNKNOWN_CODE', UNKNOWN.channel('closed_channel'), closedChannel) // nothing unknown on line 0
    try { await valid.t.api.remapCode({ ...owner, outboxId: valid.p.outboxId, target: { field: 'line', lineIndex: 0, code: 'Thai Tea', size: '16 oz', sweetness: '50%' } }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
  })
  it('a payment remap keeps the kind of money collected: a QR bill cannot become cash', async () => {
    const { t, ctx, p } = await rejectedBill('UNKNOWN_CODE', UNKNOWN.payment('old_qr'), (d) => { d.payment = 'old_qr' })
    try { await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'payment', code: 'cash' } }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
    await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'payment', code: 'qr' } })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('CONFLICT because this key was already stored with other data: RETRY only, no new receipt number (fix round 1 item 4)', async () => {
    const { t, p } = await rejectedBill('CONFLICT', 'key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว')
    expect(p.remedies).toEqual(['RETRY'])
    try { await t.api.renumberReceipt({ ...owner, outboxId: p.outboxId }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('REMEDY_NOT_ALLOWED') }
  })
  it('UNKNOWN_STAFF on a void\'s approver: the approver is replaced, the seller stays', async () => {
    const t = await openConnectedApi()
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await pushOnce(ctx)
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'x', made: false, refundReference: 'K' })
    await patchRow(t, `order_void:${r.orderId}`, (d) => { d.approved_by = 'abcdef01-2345-4678-89ab-cdef01234567' }) // no longer in dayo's list
    t.mock.override({ match: { key: `order_void:${r.orderId}` }, verdict: { status: 'rejected', reason: 'UNKNOWN_STAFF', detail: 'x' }, times: 1 })
    await pushOnce(ctx)
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ kind: 'order_void', remedies: ['RETRY', 'REMAP_STAFF'] })
    await t.api.remapStaff({ ...owner, outboxId: p!.outboxId, newStaffId: STAFF.DCm })
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.id, p!.outboxId)).get())?.rowJson).toMatchObject({ approved_by: STAFF.DCm, staff_id: STAFF.TungAo })
    expect((await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'STAFF_REMAPPED')).get())?.payloadJson).toMatchObject({ field: 'approved_by', old: 'abcdef01-2345-4678-89ab-cdef01234567' })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
    expect(t.mock.orders()).toEqual([expect.objectContaining({ posOrderId: r.orderId, status: 'cancelled' })])
  })
  it('remapStaff refuses a removed staff member', async () => {
    const { t, p } = await rejectedBill('UNKNOWN_STAFF')
    try { await t.api.remapStaff({ ...owner, outboxId: p.outboxId, newStaffId: STAFF.Old }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
  })
  it('excluding a rejected void of a bill dayo has shows the bill as "void only on the tablet" (review item 23)', async () => {
    const t = await openConnectedApi()
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await pushOnce(ctx) // the bill reaches dayo
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'x', made: false, refundReference: 'K' })
    t.mock.override({ match: { key: `order_void:${r.orderId}` }, verdict: { status: 'rejected', reason: 'FORBIDDEN', detail: 'x' }, times: 1 })
    await pushOnce(ctx)
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    await t.api.excludeFromSync({ ...owner, outboxId: p!.outboxId })
    expect(await t.api.listPriceDiffs(STAFF.TungAo)).toEqual([expect.objectContaining({ kind: 'void_local_only', orderId: r.orderId })])
  })

  // ── beyond the brief (controller dispatch, carried from earlier reviews) ──────────────────────────────────────
  it('a dead row whose reason has no table entry (REQUEST_FAILED) lists with RETRY only and retries', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.db.update(s.outbox).set({ status: 'dead', deadAt: t.clock.now(), attempts: 3, lastError: encodeLastError('REQUEST_FAILED', 'HTTP 500') }).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`))
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ kind: 'order', orderId: r.orderId, reason: 'REQUEST_FAILED', detail: 'HTTP 500', remedies: ['RETRY'], children: [] })
    await t.api.retrySyncRow({ ...owner, outboxId: p!.outboxId })
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.id, p!.outboxId)).get()).toMatchObject({ status: 'pending', attempts: 0 })
  })
  it('a far-ahead row that later failed a request (REQUEST_FAILED + farAhead) still offers EXCLUDE only — never a RETRY that is refused', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.db.update(s.outbox).set({ lastError: encodeLastError('REQUEST_FAILED', 'HTTP 500', { farAhead: true, requestFailed: true }) }).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`))
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ reason: 'REQUEST_FAILED', remedies: ['EXCLUDE'] })
    await t.api.excludeFromSync({ ...owner, outboxId: p!.outboxId })
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.id, p!.outboxId)).get())?.status).toBe('local_only')
  })
  it('a void waiting on a rejected bill is listed under it, and comes back with it after the fix', async () => {
    const t = await openConnectedApi()
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'x', made: false, refundReference: 'K' })
    t.mock.override({ match: { receiptNo: r.receiptNo }, verdict: { status: 'rejected', reason: 'UNKNOWN_STAFF', detail: 'x' }, times: 1 })
    await pushOnce(ctx)
    const list = await t.api.listSyncProblems(STAFF.TungAo)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'order', children: [{ kind: 'order_void', reason: 'PARENT_REJECTED', remedies: [] }] })
    await t.api.remapStaff({ ...owner, outboxId: list[0]!.outboxId, newStaffId: STAFF.DCm })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 2 })
    expect(t.mock.orders()).toEqual([expect.objectContaining({ posOrderId: r.orderId, status: 'cancelled' })])
  })
  it('a remedy on a row that is not on the problem page (pending, sent) is refused, and nothing is written', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const row = (await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`)).get())!
    for (const call of [() => t.api.retrySyncRow({ ...owner, outboxId: row.id }), () => t.api.excludeFromSync({ ...owner, outboxId: row.id })]) {
      try { await call(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('REMEDY_NOT_ALLOWED') }
    }
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.id, row.id)).get())).toEqual(row)
    expect(await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'EXCLUDED_FROM_SYNC')).all()).toEqual([])
  })
  it('a remedy needs a reason', async () => {
    const { t, p } = await rejectedBill('INVALID')
    try { await t.api.excludeFromSync({ ...owner, reason: '   ', outboxId: p.outboxId }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
  })
})

describe('remapCode follows dayo\'s own UNKNOWN_CODE detail, not the tablet\'s catalog (follow-up items 1–2)', () => {
  type Line = Parameters<typeof sellCode>[1][number]
  /** A bill dayo rejected UNKNOWN_CODE with `detail`; `patch` makes the queued row carry what dayo named. */
  async function rejectedSale(detail: string, opts: { lines?: Line[]; payment?: Parameters<typeof sellCode>[2]; patch?: (d: RowData) => void } = {}) {
    const t = await openConnectedApi()
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    const r = await sellCode(t, opts.lines ?? [{ code: 'Cocoa', qty: 1 }], opts.payment ?? { method: 'PROMPTPAY' })
    if (opts.patch !== undefined) await patchRow(t, `order:${r.orderId}`, opts.patch)
    t.mock.override({ match: { receiptNo: r.receiptNo }, verdict: { status: 'rejected', reason: 'UNKNOWN_CODE', detail }, times: 1 })
    await pushOnce(ctx)
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    return { t, ctx, r, p: p! }
  }
  const rowOf = async (t: Awaited<ReturnType<typeof openConnectedApi>>, outboxId: string) =>
    (await t.db.select().from(s.outbox).where(eq(s.outbox.id, outboxId)).get())!
  const refused = async (call: () => Promise<unknown>, code: string) => {
    try { await call(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe(code) }
  }

  it('the mock\'s own verdict text (no override) offers the remap end to end', async () => {
    const t = await openConnectedApi()
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await patchRow(t, `order:${r.orderId}`, retiredMenu)
    await pushOnce(ctx) // judged like dayo: UNKNOWN_CODE 'ไม่พบเมนู "Retired Menu"'
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ reason: 'UNKNOWN_CODE', detail: UNKNOWN.menu('Retired Menu'), remedies: ['RETRY', 'REMAP_CODE'] })
    await t.api.remapCode({ ...owner, outboxId: p!.outboxId, target: { field: 'line', lineIndex: 0, code: 'Thai Tea', size: '16 oz', sweetness: '50%' } })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('a detail the tablet does not recognise names nothing: RETRY only, and remapCode is refused', async () => {
    for (const detail of ['x', 'not_found: ไม่พบขนาดแก้วนี้ในร้านค่ะ', UNKNOWN.oat /* a remap cannot change the milk */, 'ไม่พบเมนู "Retired Me']) {
      const { t, p } = await rejectedSale(detail, { patch: retiredMenu })
      expect(p.remedies).toEqual(['RETRY'])
      await refused(() => t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'line', lineIndex: 0, code: 'Thai Tea', size: '16 oz', sweetness: '50%' } }), 'REMEDY_NOT_ALLOWED')
    }
  })
  it('a detail that names a value the row does not carry names nothing: RETRY only', async () => {
    const { p } = await rejectedSale(UNKNOWN.channel('grab')) // the row's channel is 'store'
    expect(p.remedies).toEqual(['RETRY'])
  })
  it('the disabled-channel gap: dayo rejected a LINE, so a channel missing from the latest catalog (disabled in dayo, still accepted there) stays as it is', async () => {
    const { t, p } = await rejectedSale(UNKNOWN.menu('Retired Menu'), { patch: (d) => { retiredMenu(d); closedChannel(d) } })
    const before = await rowOf(t, p.outboxId)
    await refused(() => t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'channel', code: 'grab' } }), 'BAD_INPUT')
    expect(await rowOf(t, p.outboxId)).toEqual(before)
    await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'line', lineIndex: 0, code: 'Thai Tea', size: '16 oz', sweetness: '50%' } })
    expect((await rowOf(t, p.outboxId)).rowJson).toMatchObject({ channel: 'closed_channel', lines: [{ code: 'Thai Tea' }] })
  })
  it('a stale local catalog no longer blocks the fix: dayo named a channel the tablet still lists — it may move, never to the same code', async () => {
    const { t, ctx, p } = await rejectedSale(UNKNOWN.channel('store'))
    expect(p.remedies).toEqual(['RETRY', 'REMAP_CODE'])
    await refused(() => t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'channel', code: 'store' } }), 'BAD_INPUT')
    await refused(() => t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'line', lineIndex: 0, code: 'Thai Tea', size: '16 oz', sweetness: '50%' } }), 'BAD_INPUT')
    await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'channel', code: 'grab' } })
    expect((await rowOf(t, p.outboxId)).rowJson).toMatchObject({ channel: 'grab' })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('only the line dayo named may change: a variant detail picks line 0, line 1 of the same bill is refused', async () => {
    const lines: Line[] = [{ code: 'Cocoa', qty: 1 }, { code: 'Thai Tea', qty: 1 }]
    const { t, p } = await rejectedSale(UNKNOWN.variant('Cocoa', '16 oz', '50%'), { lines })
    await refused(() => t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'line', lineIndex: 1, code: 'Pink Milk', size: '16 oz', sweetness: '100%' } }), 'BAD_INPUT')
    await refused(() => t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'line', lineIndex: 0, code: 'Cocoa', size: '16 oz', sweetness: '50%' } }), 'BAD_INPUT') // the same variant dayo refused
    await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'line', lineIndex: 0, code: 'Cocoa', size: '16 oz', sweetness: '100%' } })
    expect((await rowOf(t, p.outboxId)).rowJson).toMatchObject({ lines: [{ code: 'Cocoa', sweetness: '100%' }, { code: 'Thai Tea', sweetness: '50%' }] })
  })
  it('a grade dayo named is never kept: the remapped matcha line takes the default grade', async () => {
    const { t, p } = await rejectedSale(UNKNOWN.grade('Premium'), { lines: [{ code: 'Matcha Latte', grade: 'Premium', qty: 1 }] })
    await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'line', lineIndex: 0, code: 'Matcha Latte', size: '16 oz', sweetness: '100%' } })
    expect((await rowOf(t, p.outboxId)).rowJson).toMatchObject({ lines: [{ code: 'Matcha Latte', grade: 'Excellent' }] })
  })
  it('cash is dayo\'s code \'cash\' only: a non-cash method NAMED like cash ("Cashless QR") is non-cash (item 1)', async () => {
    const { t, p } = await rejectedSale(UNKNOWN.payment('old_qr'), { patch: (d) => { d.payment = 'old_qr' } })
    await addPaymentMethods(t, [{ code: 'cashless_qr', name: 'Cashless QR', aliases: ['cashless', 'เงินสดไม่ต้องใช้'] }])
    await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'payment', code: 'cashless_qr' } })
    expect((await rowOf(t, p.outboxId)).rowJson).toMatchObject({ payment: 'cashless_qr' })
  })
  it('a cash bill cannot move to a method whose name merely mentions cash ("ไม่ใช่เงินสด") — only to \'cash\' (item 1)', async () => {
    const { t, p } = await rejectedSale(UNKNOWN.payment('old_cash'), { payment: { method: 'CASH', tenderedSatang: 5_000 }, patch: (d) => { d.payment = 'old_cash' } })
    await addPaymentMethods(t, [{ code: 'not_cash', name: 'ไม่ใช่เงินสด', aliases: ['ไม่ใช่เงินสด', 'not cash'] }])
    for (const code of ['not_cash', 'qr']) await refused(() => t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'payment', code } }), 'BAD_INPUT')
    await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'payment', code: 'cash' } })
    expect((await rowOf(t, p.outboxId)).rowJson).toMatchObject({ payment: 'cash' })
  })
})

describe('remedies and the sender never interleave on one row (Iron Rule 5 · task 14 item 4)', () => {
  /** A PosApi on the same database whose serial queue is held by an exportBackup until `release()`. */
  async function heldApi(t: Awaited<ReturnType<typeof openConnectedApi>>) {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let hold = true
    const api = createPosApi(t.db, { ...t.deps, exportDbFile: async () => { if (hold) { hold = false; await gate } return t.deps.exportDbFile() } })
    const backup = api.exportBackup(STAFF.TungAo) // holds the queue, as a PIN check followed by its write would
    return { api, backup, release }
  }
  const tick = () => new Promise((r) => setTimeout(r, 50))

  it('every remedy waits in the PosApi\'s own serial queue — the one the sender uses — and writes nothing while it is held', async () => {
    type Case = { reason: string; detail?: string; patch?: (d: RowData) => void; call: (api: ReturnType<typeof createPosApi>, outboxId: string) => Promise<unknown> }
    const cases: Case[] = [
      { reason: 'CONFLICT', call: (api, outboxId) => api.retrySyncRow({ ...owner, outboxId }) },
      { reason: 'CONFLICT', detail: COLLISION, call: (api, outboxId) => api.renumberReceipt({ ...owner, outboxId }) },
      { reason: 'UNKNOWN_CODE', detail: UNKNOWN.channel('closed_channel'), patch: closedChannel, call: (api, outboxId) => api.remapCode({ ...owner, outboxId, target: { field: 'channel', code: 'store' } }) },
      { reason: 'UNKNOWN_STAFF', call: (api, outboxId) => api.remapStaff({ ...owner, outboxId, newStaffId: STAFF.DCm }) },
      { reason: 'INVALID', call: (api, outboxId) => api.excludeFromSync({ ...owner, outboxId }) },
    ]
    for (const c of cases) {
      const { t, p } = await rejectedBill(c.reason, c.detail, c.patch)
      const before = await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get()
      const { api, backup, release } = await heldApi(t)
      let done = false
      const remedy = c.call(api, p.outboxId).then(() => { done = true })
      await tick()
      expect(done).toBe(false)
      expect(await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get()).toEqual(before) // nothing written while held
      release()
      await backup
      await remedy
      expect((await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get())?.status).not.toBe('dead')
    }
  })
  it('a push cycle and a remedy on the same row run one after the other: the remedy queued first is committed before the cycle reads the queue', async () => {
    const { t, p } = await rejectedBill('UNKNOWN_STAFF')
    const { api, backup, release } = await heldApi(t)
    const remedy = api.remapStaff({ ...owner, outboxId: p.outboxId, newStaffId: STAFF.DCm })
    const sync = api.syncNow() // its first read queues behind the remedy
    await tick()
    expect(t.mock.requests().filter((x) => x.path === '/api/v1/pos/push')).toHaveLength(1) // only rejectedBill's own push so far
    release()
    await backup
    await remedy
    const cycle = await sync
    expect(cycle.push).toMatchObject({ sent: 1 })
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get()).toMatchObject({ status: 'sent', rowJson: expect.objectContaining({ staff_id: STAFF.DCm }) })
  })
  it('EXCLUDE of a far-ahead row while a push of that row is on the wire: the verdict that comes back never overwrites the owner\'s decision', async () => {
    const t = await openConnectedApi({ now: '2026-09-27T03:00:00.000Z' })
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setNow('2026-09-25T03:00:00.000Z')
    await pushOnce(ctx) // CLOCK_AHEAD, far ahead: pending, flagged
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    t.clock.advanceMs(120_000) // past the row's 60 s retry time
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let onWire!: () => void
    const wire = new Promise<void>((r) => { onWire = r })
    const gated: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/pos/push')) { onWire(); await gate }
      return t.mock.fetch(input, init)
    }
    const api = createPosApi(t.db, { ...t.deps, fetch: gated })
    const sync = api.syncNow()
    await wire                                                  // the push carrying this row is on the wire (outside the queue)
    await api.excludeFromSync({ ...owner, outboxId: p!.outboxId }) // not blocked by the network wait — and committed now
    release()
    await sync
    const row = await t.db.select().from(s.outbox).where(eq(s.outbox.id, p!.outboxId)).get()
    expect(row?.status).toBe('local_only') // the in-flight answer (CLOCK_AHEAD again) was not applied over it
    expect(await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'EXCLUDED_FROM_SYNC')).all()).toHaveLength(1)
    expect(t.mock.requests().filter((x) => x.path === '/api/v1/pos/push')).toHaveLength(2) // the first push + the one on the wire, nothing after
  })
})
