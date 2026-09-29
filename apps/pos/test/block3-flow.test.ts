import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import type { CentralOrder } from '@dayo/contracts'
import { pushOnce } from '../src/sync/push'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'
import { countAndClose } from './helpers/shift'

const owner = { approverUserId: STAFF.TungAo, approverPin: '1111', reason: 'แก้ตามหน้าส่งไม่ผ่าน' }
const dcm = { approverUserId: STAFF.DCm, approverPin: '2222' }
const lines = (baht: number) => [{ denominationSatang: 100, count: baht }]
const bot = (no: string, total: number, at: string): CentralOrder => ({ order_no: no, sale_date: '2026-09-25', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'line', payment: 'cash', totals: { items_subtotal: total, items_discount: 0, bill_discount: 0, total }, amount_mismatch: false, updated_at: at, sold_at: at })
/**
 * The mock as dayo PHASE 2 (preflight P3 · D2): recompute_status (waiting_bills / matched) and order_off_catalog exist only
 * there — dayo main today leaves recompute_status null. Shift open 10:00 Bangkok, float ฿500.
 */
async function ready() {
  const t = await openConnectedApi({ block3: true, block3Phase2: true })
  t.mock.setBlock3LiveFrom('2026-09-01')
  return { t, ctx: { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() } }
}
type T = Awaited<ReturnType<typeof ready>>['t']
const statuses = (t: T) => t.mock.zReports().map((z) => z.recomputeStatus)
const dead = (t: T) => t.db.select().from(s.outbox).where(eq(s.outbox.status, 'dead')).all()
const cashSale = (t: T) => sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })   // ฿45
const qrSale = (t: T) => sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
const problemOf = async (t: T, key: string) => (await t.api.listSyncProblems(STAFF.TungAo)).find((p) => p.key === key)!

describe('block 3 end to end with the mock (spec 04 §9 block 3, tablet side — mock phase 2)', () => {
  it('a shift whose bills arrive after the Z: waiting_bills, then matched with nothing more sent (R3-A)', async () => {
    const { t, ctx } = await ready()
    const c1 = await cashSale(t); const c2 = await cashSale(t); const q1 = await qrSale(t)
    await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'น้ำแข็ง' })
    await t.api.cancelSale({ orderId: c1.orderId, actorUserId: STAFF.TungAo, ...dcm, reason: 'ลูกค้ายกเลิก', made: false, refundReference: null }) // VOID_REFUND ฿45
    for (const o of [c1, c2, q1]) t.mock.override({ match: { key: `order:${o.orderId}` }, verdict: { status: 'deferred', reason: 'BUSY', detail: 'lock' }, times: 1 })
    await countAndClose(t, lines(525), dcm)                              // 500 + 90 − 45 − 20
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['waiting_bills'])                      // the Z is in dayo, its bills are not
    t.clock.advanceMs(6_001)                                            // past the first backoff even at +20% jitter (5 s × 1.2)
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['matched'])                            // the bills arrived; the tablet sent nothing extra for the Z
    expect(await dead(t)).toEqual([])
  })
  it('three bot cash bills are in the expected cash and the Z is matched', async () => {
    const { t, ctx } = await ready()
    await cashSale(t)
    t.mock.seedCentralOrders([bot('L260925-901', 70, '2026-09-25T04:00:00+00:00'), bot('L260925-902', 35, '2026-09-25T04:10:00+00:00'), bot('L260925-903', 50, '2026-09-25T04:20:00+00:00')])
    t.clock.advanceMs(2 * 3_600_000)
    t.mock.setNow(t.clock.now())                                        // dayo's clock moves too (else E4's window is not closed yet — Task 13)
    const r = await countAndClose(t, lines(700), dcm)                   // 500 + 45 + 155
    expect(r.z?.snapshot).toMatchObject({ cashVarianceSatang: 0, cash: { botCashSatang: 15_500 } })
    expect(r.z?.snapshot?.botBills).toHaveLength(3)
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['matched'])
  })
  it('a rejected bill closed off-catalog is accepted and the Z listing it is matched — never waiting_bills', async () => {
    const { t, ctx } = await ready()
    const c = await cashSale(t)
    t.mock.override({ match: { key: `order:${c.orderId}` }, verdict: { status: 'rejected', reason: 'UNKNOWN_CODE', detail: 'ไม่พบเมนู "Cocoa"' }, times: 1 })
    await pushOnce(ctx)
    await t.api.closeOffCatalog({ ...owner, outboxId: (await problemOf(t, `order:${c.orderId}`)).outboxId })
    await countAndClose(t, lines(545), dcm)
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['matched'])
    expect(t.mock.orders().find((o) => o.posOrderId === c.orderId)).toMatchObject({ status: 'ok', total: 45 })
    expect(await dead(t)).toEqual([])
  })
  it('a rejected cash movement makes the Z wait (missing movement); REMAP_STAFF fixes it → matched', async () => {
    const { t, ctx } = await ready()
    const m = await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'น้ำแข็ง' })
    t.mock.override({ match: { key: `cash_movement:${m.id}` }, verdict: { status: 'rejected', reason: 'UNKNOWN_STAFF', detail: 'ไม่พบพนักงาน' }, times: 1 })
    await pushOnce(ctx)
    await countAndClose(t, lines(480), dcm)
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['waiting_bills'])
    expect(t.mock.zReports()[0]!.missing.movementIds).toEqual([m.id])
    await t.api.remapStaff({ ...owner, outboxId: (await problemOf(t, `cash_movement:${m.id}`)).outboxId, newStaffId: STAFF.DCm })
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['matched'])
  })
  it('RECEIPT_RENUMBERED after the Z: the local Z does not change and dayo stays matched (R-I2)', async () => {
    const { t, ctx } = await ready()
    const q = await qrSale(t)
    t.mock.override({ match: { key: `order:${q.orderId}` }, verdict: { status: 'rejected', reason: 'CONFLICT', detail: 'receipt_taken: A-000001' }, times: 1 })
    const r = await countAndClose(t, lines(500), dcm)
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['waiting_bills'])
    await t.api.renumberReceipt({ ...owner, outboxId: (await problemOf(t, `order:${q.orderId}`)).outboxId })
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['matched'])
    expect((await t.api.getZReport(r.z!.shiftId)).hash).toBe(r.z!.hash)  // the Z in the tablet is never edited
  })
})
