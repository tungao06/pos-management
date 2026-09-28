import type { RecordSaleResult } from '../../src/api/types'
import { PINS, sellCode, type ReadyApi } from './db'

export type Scenario = { cashVoided: RecordSaleResult; qrVoided: RecordSaleResult; cashKept: RecordSaleResult }

/**
 * One shift of every kind of row (float ฿500 from openReadyApi), priced with the POS test catalog (e1-catalog-rich):
 * A-000001 Cocoa 16oz ×2 cash ฿90 → voided, not made (VOID_REFUND ฿90)
 * A-000002 Thai Tea 16oz oat ×1 QR ฿50 → voided, made (refund reference KBANK-1, waste)
 * A-000003 Cocoa 16oz ×1 cash ฿45 − ฿5 bill discount = ฿40
 * PAID_OUT ฿20 "ซื้อน้ำแข็ง"
 * → gross 185 · discount 5 · voided 140 · net 40 · cash sales 130 · QR 50 · expected cash 500 + 130 − 90 − 20 = ฿520
 */
export async function sellVoidScenario(t: ReadyApi): Promise<Scenario> {
  const cashVoided = await sellCode(t, [{ code: 'Cocoa', qty: 2 }], { method: 'CASH', tenderedSatang: 10_000 })
  const qrVoided = await sellCode(t, [{ code: 'Thai Tea', milk: 'oat', qty: 1 }], { method: 'PROMPTPAY' })
  const cashKept = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 }, { billDiscountSatang: 500, reason: 'ลูกค้าประจำ' })
  t.clock.advanceMs(60_000)
  const base = { actorUserId: t.owner.id, approverUserId: t.other.id, approverPin: PINS.DCm }
  await t.api.cancelSale({ ...base, orderId: cashVoided.orderId, reason: 'กดผิดเมนู', made: false, refundReference: null })
  await t.api.cancelSale({ ...base, orderId: qrVoided.orderId, reason: 'ทำผิดสูตร', made: true, refundReference: 'KBANK-1' })
  await t.api.recordCashMovement({ actorUserId: t.owner.id, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'ซื้อน้ำแข็ง' })
  return { cashVoided, qrVoided, cashKept }
}

/** Notes/coins that add up to exactly ฿520 (the scenario's expected cash). */
export const COUNT_520 = [
  { denominationSatang: 50_000, count: 1 },
  { denominationSatang: 2_000, count: 1 },
]
