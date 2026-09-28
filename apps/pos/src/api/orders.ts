import { and, asc, desc, eq, inArray, isNotNull, max } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { bangkokDateOf, rowKey } from '@dayo/contracts'
import { centralDiffSatang, type PricedPromotion } from '@dayo/domain'
import { readCatalog, staffDisplayName } from '../sync/catalog'
import { DAYO_KEYS, decodeLastError, readKey, SKEW_FRESH_MS } from '../sync/state'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import type { CentralStateDto, OrderDetailDto, OrderLineDto, OrderSummaryDto } from './types'

type OrderRow = typeof s.order.$inferSelect
type OutboxRow = typeof s.outbox.$inferSelect

/** Everything summarize needs besides the bill itself, loaded once per page (review item 19: no query per row). */
type SummaryContext = { sellerName: (id: string) => string; outbox: ReadonlyMap<string, OutboxRow> }

function voidStateOf(o: OrderRow, v: OutboxRow | undefined): CentralStateDto['voidState'] {
  // a plan-3 bill, or one an owner closed as outside dayo (ruling R8), has no central void to wait for
  if (o.status !== 'voided' || o.soldAt === null || o.excludedAt !== null) return 'none'
  if (v === undefined || v.status === 'local_only') return 'local_only'
  return v.status === 'sent' ? 'sent' : v.status === 'dead' ? 'problem' : 'pending'
}

function centralState(o: OrderRow, row: OutboxRow | undefined, voidRow: OutboxRow | undefined): CentralStateDto {
  const base = {
    orderNo: o.centralOrderNo,
    computedTotalSatang: o.centralComputedTotalSatang,
    diffSatang: centralDiffSatang(o.centralComputedTotalSatang, o.totalSatang), // money math stays in @dayo/domain (review item 18)
    duplicateOf: (o.centralDuplicateOfJson as string[] | null) ?? [],
    reason: row?.lastError ? decodeLastError(row.lastError).reason || null : null,
    voidState: voidStateOf(o, voidRow),
  }
  if (o.soldAt === null) return { ...base, state: 'legacy' }
  if (o.excludedAt !== null) return { ...base, state: 'excluded' }
  if (row?.status === 'sent') return { ...base, state: 'sent' }
  if (row?.status === 'dead') return { ...base, state: 'problem' }
  return { ...base, state: 'pending' }
}

function summarize(o: OrderRow, payments: readonly { method: string }[], cupRows: readonly { qty: number }[], ctx: SummaryContext): OrderSummaryDto {
  if (o.receiptNo === null || o.queueNo === null || o.paidAt === null) throw new PosError('ORDER_NOT_FOUND', `order ${o.id} has no receipt`)
  return {
    id: o.id,
    receiptNo: o.receiptNo,
    queueNo: o.queueNo,
    status: o.status === 'voided' ? 'voided' : 'paid',
    totalSatang: o.totalSatang,
    method: payments[0]?.method === 'PROMPTPAY' ? 'PROMPTPAY' : 'CASH',
    paidAt: o.paidAt,
    cups: cupRows.reduce((a, l) => a + l.qty, 0), // order_line (plan-3 bills) + order_item (block 2)
    soldById: o.createdById,
    soldByName: ctx.sellerName(o.createdById),
    central: centralState(o, ctx.outbox.get(rowKey('order', o.id)), ctx.outbox.get(rowKey('order_void', o.id))),
  }
}

/** D61: the name of the user on this tablet, else dayo's staff list (spec §4.4 rule 5), else "พนักงาน" + the id's tail. */
async function sellerNames(db: RemoteDb, ids: readonly string[]): Promise<(id: string) => string> {
  const unique = [...new Set(ids)]
  const users = unique.length === 0 ? [] : await db.select({ id: s.user.id, displayName: s.user.displayName }).from(s.user).where(inArray(s.user.id, unique)).all()
  const local = new Map(users.map((u) => [u.id, u.displayName]))
  const staff = unique.every((id) => local.has(id)) ? [] : ((await readCatalog(db))?.staff ?? [])
  const central = new Map(staff.map((e) => [e.id, staffDisplayName(e)]))
  return (id) => local.get(id) ?? central.get(id) ?? staffDisplayName({ id, display_name: null, role: 'staff', active: false })
}

async function outboxOf(db: RemoteDb, orderIds: readonly string[]): Promise<Map<string, OutboxRow>> {
  if (orderIds.length === 0) return new Map()
  const keys = orderIds.flatMap((id) => [rowKey('order', id), rowKey('order_void', id)])
  const rows = await db.select().from(s.outbox).where(inArray(s.outbox.idempotencyKey, keys)).all()
  return new Map(rows.map((r) => [r.idempotencyKey, r]))
}

/** spec §5 "ประวัติบิล": receipts of the open shift (1 shift = 1 business day, D22), newest first. */
export async function listOrders(db: RemoteDb): Promise<OrderSummaryDto[]> {
  const device = await requireDevice(db)
  const shift = await currentOpenShift(db, device.id)
  if (shift === null) return []
  const orders = await db.select().from(s.order).where(and(eq(s.order.shiftId, shift.id), isNotNull(s.order.receiptNo))).orderBy(desc(s.order.receiptNo)).all()
  if (orders.length === 0) return []
  const ids = orders.map((o) => o.id)
  const payments = await db.select().from(s.payment).where(inArray(s.payment.orderId, ids)).all()
  const lines = await db.select({ orderId: s.orderLine.orderId, qty: s.orderLine.qty }).from(s.orderLine).where(inArray(s.orderLine.orderId, ids)).all()
  const items = await db.select({ orderId: s.orderItem.orderId, qty: s.orderItem.qty }).from(s.orderItem).where(inArray(s.orderItem.orderId, ids)).all()
  const cupRows = [...lines, ...items]
  const ctx: SummaryContext = { sellerName: await sellerNames(db, orders.map((o) => o.createdById)), outbox: await outboxOf(db, ids) }
  return orders.map((o) => summarize(o, payments.filter((p) => p.orderId === o.id), cupRows.filter((l) => l.orderId === o.id), ctx))
}

/** The promotions frozen in pricing_json at payment (a block-2 bill); none on a plan-3 bill. */
function promotionsOf(o: OrderRow): { name: string; discountSatang: number }[] {
  const applied = (o.pricingJson as { priced?: { promotionsApplied?: PricedPromotion[] } } | null)?.priced?.promotionsApplied ?? []
  return applied.map((p) => ({ name: p.name, discountSatang: p.discountSatang }))
}

/**
 * "Now" for a cancellation (spec §4.7 same-day rule), used by cancelSale AND getOrder.voidable so the screen offers
 * exactly what cancelSale accepts.
 * - `stamp` (voided_at and the rest of the void): the device clock, but never before the latest sale of this device —
 *   a void is never stamped before its sale. Stays on the tablet clock (spec §6.7: dayo trusts the device time).
 * - `judge` (which Thai day it is): the latest of `stamp` and the device clock corrected by the last skew dayo
 *   reported (D80, task 14 item 5) — a clock set back to yesterday, even before the first sale of today, does not
 *   reopen yesterday's bills once the tablet has heard dayo's server_time since.
 * D106: the skew counts only while fresh — measured at most SKEW_FRESH_MS (15 min) before the device's now; an older
 * one is ignored (judge = stamp, the original rule), so a stale skew can never block a legitimate same-day cancel.
 * A NEGATIVE age means the clock was set back after the measurement (final review I1): the device's now is then not
 * trusted at all — the estimate is frozen at the server time of the measurement (measured_at + skew), which real time
 * can only have passed. So rolling the clock back to last night, offline, does not reopen last night's bills.
 */
export async function voidInstant(db: RemoteDb, deviceId: string, deviceNow: string): Promise<{ stamp: string; judge: string }> {
  const latest = (await db.select({ v: max(s.order.soldAt) }).from(s.order).where(eq(s.order.deviceId, deviceId)).get())?.v ?? null
  const stamp = latest !== null && Date.parse(latest) > Date.parse(deviceNow) ? latest : deviceNow
  const skewRaw = await readKey(db, DAYO_KEYS.clockSkewMs)
  const skew = skewRaw === null ? Number.NaN : Number(skewRaw)
  const measuredAt = Date.parse((await readKey(db, DAYO_KEYS.clockMeasuredAt)) ?? '')
  const age = Date.parse(deviceNow) - measuredAt
  const server = !Number.isFinite(skew) || !Number.isFinite(age) || age > SKEW_FRESH_MS ? Number.NaN
    : age < 0 ? measuredAt + skew // the clock went back since: never move the estimate back with it
      : Date.parse(deviceNow) + skew
  const judge = Number.isFinite(server) && server > Date.parse(stamp) ? new Date(server).toISOString() : stamp
  return { stamp, judge }
}

export async function getOrder(db: RemoteDb, deps: Pick<ApiDeps, 'now'>, orderId: string): Promise<OrderDetailDto> {
  const o = await db.select().from(s.order).where(eq(s.order.id, orderId)).get()
  if (!o) throw new PosError('ORDER_NOT_FOUND', orderId)
  const payments = await db.select().from(s.payment).where(eq(s.payment.orderId, orderId)).orderBy(asc(s.payment.createdAt)).all()
  const oldLines = await db.select().from(s.orderLine).where(eq(s.orderLine.orderId, orderId)).orderBy(asc(s.orderLine.lineNo)).all()
  const items = await db.select().from(s.orderItem).where(eq(s.orderItem.orderId, orderId)).orderBy(asc(s.orderItem.lineNo)).all()
  const discount = await db.select().from(s.discount).where(eq(s.discount.orderId, orderId)).get()
  const events = await db.select().from(s.orderEvent).where(eq(s.orderEvent.orderId, orderId)).orderBy(asc(s.orderEvent.seq)).all()
  const device = await requireDevice(db)
  const shift = await currentOpenShift(db, device.id)
  const payment = payments[0]
  const lines: OrderLineDto[] = items.length > 0
    ? items.map((l) => ({ lineNo: l.lineNo, productName: l.menuNameTh, sizeName: l.size, sweetnessName: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty, unitPriceSatang: l.unitPriceSatang, lineTotalSatang: l.lineTotalSatang }))
    : oldLines.map((l) => ({ lineNo: l.lineNo, productName: l.productName, sizeName: l.sizeName, sweetnessName: l.sweetnessName, milk: null, grade: null, qty: l.qty, unitPriceSatang: l.unitPriceSatang, lineTotalSatang: l.lineTotalSatang }))
  const ctx: SummaryContext = { sellerName: await sellerNames(db, [o.createdById]), outbox: await outboxOf(db, [o.id]) }
  // Only paid orders of the open shift can be voided (D47 ข้อ 2 · Q3-13); a block-2 bill only on the Thai day it was sold (spec 04 §4.7)
  const sameDay = o.soldAt === null || bangkokDateOf((await voidInstant(db, device.id, deps.now())).judge) === bangkokDateOf(o.soldAt)
  return {
    ...summarize(o, payments, [...oldLines, ...items], ctx),
    businessDate: o.businessDate,
    shiftId: o.shiftId,
    subtotalSatang: o.subtotalSatang,
    discountSatang: o.discountSatang,
    discountReason: discount?.reason ?? null,
    tenderedSatang: payment?.tenderedSatang ?? null,
    changeSatang: payment?.changeSatang ?? null,
    voidedAt: o.voidedAt,
    soldAt: o.soldAt,
    channelCode: o.channelCode,
    catalogVersion: o.catalogVersion,
    promotions: promotionsOf(o),
    lines,
    events: events.map((e) => ({ seq: e.seq, type: e.type, at: e.at, actorId: e.actorId, payload: e.payloadJson })),
    voidable: o.status === 'paid' && shift !== null && o.shiftId === shift.id && o.deviceId === device.id && sameDay,
  }
}
