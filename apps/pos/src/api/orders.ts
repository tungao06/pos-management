import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { currentOpenShift, requireDevice } from './bootstrap'
import { PosError } from './errors'
import type { OrderDetailDto, OrderSummaryDto } from './types'

type OrderRow = typeof s.order.$inferSelect

function summarize(o: OrderRow, payments: readonly { method: string }[], lines: readonly { qty: number }[]): OrderSummaryDto {
  if (o.receiptNo === null || o.queueNo === null || o.paidAt === null) throw new PosError('ORDER_NOT_FOUND', `order ${o.id} has no receipt`)
  return {
    id: o.id,
    receiptNo: o.receiptNo,
    queueNo: o.queueNo,
    status: o.status === 'voided' ? 'voided' : 'paid',
    totalSatang: o.totalSatang,
    method: payments[0]?.method === 'PROMPTPAY' ? 'PROMPTPAY' : 'CASH',
    paidAt: o.paidAt,
    cups: lines.reduce((a, l) => a + l.qty, 0),
  }
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
  return orders.map((o) => summarize(o, payments.filter((p) => p.orderId === o.id), lines.filter((l) => l.orderId === o.id)))
}

export async function getOrder(db: RemoteDb, orderId: string): Promise<OrderDetailDto> {
  const o = await db.select().from(s.order).where(eq(s.order.id, orderId)).get()
  if (!o) throw new PosError('ORDER_NOT_FOUND', orderId)
  const payments = await db.select().from(s.payment).where(eq(s.payment.orderId, orderId)).orderBy(asc(s.payment.createdAt)).all()
  const lines = await db.select().from(s.orderLine).where(eq(s.orderLine.orderId, orderId)).orderBy(asc(s.orderLine.lineNo)).all()
  const discount = await db.select().from(s.discount).where(eq(s.discount.orderId, orderId)).get()
  const events = await db.select().from(s.orderEvent).where(eq(s.orderEvent.orderId, orderId)).orderBy(asc(s.orderEvent.seq)).all()
  const device = await requireDevice(db)
  const shift = await currentOpenShift(db, device.id)
  const payment = payments[0]
  return {
    ...summarize(o, payments, lines),
    businessDate: o.businessDate,
    shiftId: o.shiftId,
    subtotalSatang: o.subtotalSatang,
    discountSatang: o.discountSatang,
    discountReason: discount?.reason ?? null,
    tenderedSatang: payment?.tenderedSatang ?? null,
    changeSatang: payment?.changeSatang ?? null,
    voidedAt: o.voidedAt,
    lines: lines.map((l) => ({ lineNo: l.lineNo, productName: l.productName, sizeName: l.sizeName, sweetnessName: l.sweetnessName, qty: l.qty, unitPriceSatang: l.unitPriceSatang, lineTotalSatang: l.lineTotalSatang })),
    events: events.map((e) => ({ seq: e.seq, type: e.type, at: e.at, actorId: e.actorId, payload: e.payloadJson })),
    // Only paid orders of the open shift can be voided (D47 ข้อ 2 · Q3-13)
    voidable: o.status === 'paid' && shift !== null && o.shiftId === shift.id && o.deviceId === device.id,
  }
}
