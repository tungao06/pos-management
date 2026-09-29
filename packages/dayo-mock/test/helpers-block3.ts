// Shared helpers of the block 3 mock tests (Tasks 6, 7, 8).
import type { CentralOrder } from '@dayo/contracts'
import { createMockDayo, MOCK_API_KEY, type MockDayo } from '../src/index'

export const NOW = '2026-09-25T12:10:00.000Z'
export const U = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'                   // TungAo, active owner (e1-catalog-rich.json)
export const STAFF_ONLY = '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0'          // Mint, staff
const id = (prefix: string, n: number): string => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`
export const sid = (n: number): string => id('5a5a5a5a', n)             // shift n
export const cid = (n: number): string => id('7c7c7c7c', n)             // its count
export const mid = (n: number): string => id('6b6b6b6b', n)             // a movement
export const oid = (n: number): string => id('0b0b0b0b', n)             // a POS bill
export const H = (n: number): string => (n % 256).toString(16).padStart(2, '0').repeat(32)
export const at = (hour: number, min = 0): string => `2026-09-25T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`
export const MIDNIGHT = '2026-09-24T17:00:00.000Z'                       // 00:00 Bangkok of 2026-09-25
/** dayo's to_char(… 'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"') form of an instant (E1 last_z_until · E4 sold_at — preflight P7). */
export const pg = (iso: string): string => new Date(iso).toISOString().replace('Z', '+00:00')

export const newMock = (): MockDayo => createMockDayo({ now: NOW, block3: true })
export const row = (kind: string, key: string, data: unknown) => ({ key: `${kind}:${key}`, kind, data })
export async function push(mock: MockDayo, rows: unknown[]) {
  const r = await mock.fetch('http://localhost:8787/api/v1/pos/push', { method: 'POST', headers: { authorization: `Bearer ${MOCK_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ device_time: NOW, rows }) })
  return ((await r.json()) as { data: { results: { key: string; status: string; reason?: string; detail?: string; data?: Record<string, unknown> }[] } }).data.results
}
export const shiftOpen = (n: number, float = 500) => ({ shift_id: sid(n), business_date: '2026-09-25', opened_at: at(0, 30), opened_by: U, opening_float: float, quick_open: false })
export const cashCount = (n: number, countedAt: string, counted: number) => ({
  count_id: cid(n), shift_id: sid(n), lines: [1000, 500, 100, 50, 20, 10, 5, 2, 1].map((d) => ({ denomination: d, count: d === 1 ? counted : 0 })), counted, counted_by: U, counted_at: countedAt,
})
export type PosBill = { pos_order_id: string; receipt_no: string; payment: string; total: number; sold_at: string; voided_at: string | null }
export const posBill = (n: number, o: { total?: number; payment?: string; soldAt?: string; voidedAt?: string | null } = {}): PosBill => ({
  pos_order_id: oid(n), receipt_no: `A-${String(n).padStart(6, '0')}`, payment: o.payment ?? 'cash', total: o.total ?? 35, sold_at: o.soldAt ?? at(1), voided_at: o.voidedAt ?? null,
})
export function shiftClose(n: number, o: { zNo: number; countedAt: string; counted: number; after?: string; prevHash?: string | null; hash?: string
  cash?: Partial<Record<'opening_float' | 'pos_cash_sales' | 'void_refunds' | 'paid_in' | 'paid_out' | 'drops' | 'drawer_expenses' | 'bot_cash', number>>
  posBills?: PosBill[]; movementIds?: string[]; botBills?: { order_no: string; version: number; total: number }[] }) {
  const botBills = o.botBills ?? []
  const cash = { opening_float: 500, pos_cash_sales: 0, void_refunds: 0, paid_in: 0, paid_out: 0, drops: 0, drawer_expenses: 0, bot_cash: botBills.reduce((a, b) => a + b.total, 0), ...o.cash }
  return {
    shift_id: sid(n), count_id: cid(n), closed_by: U, closed_at: new Date(Date.parse(o.countedAt) + 5 * 60_000).toISOString(), variance_reason: null,
    z_report: { z_no: o.zNo, hash: o.hash ?? H(o.zNo), prev_hash: o.prevHash ?? null, variance_alert: 20, chain_warning: false, cash, counted: o.counted,
      bot_window: { after: o.after ?? MIDNIGHT, until: o.countedAt }, movement_ids: o.movementIds ?? [], bot_bills: botBills, pos_bills: o.posBills ?? [] },
  }
}
/** A whole empty shift n (float ฿500, counted ฿500) closed as Z zNo. */
export async function emptyZ(mock: MockDayo, n: number, zNo: number, countedAt: string, o: { after?: string; prevHash?: string | null } = {}) {
  return push(mock, [row('shift_open', sid(n), shiftOpen(n)), row('cash_count', cid(n), cashCount(n, countedAt, 500)), row('shift_close', sid(n), shiftClose(n, { zNo, countedAt, counted: 500, ...o }))])
}
/** A POS `order` row (variant Thai Tea 16 oz 50% of e1-catalog-rich.json — the one the block-2 fixtures use). */
export const orderRow = (n: number, o: { shiftId: string | null; total?: number; payment?: 'cash' | 'qr'; soldAt?: string }) => {
  const total = o.total ?? 35
  return { pos_order_id: oid(n), receipt_no: `A-${String(n).padStart(6, '0')}`, queue_no: n, sale_date: '2026-09-25', sold_at: o.soldAt ?? at(1), channel: 'store', payment: o.payment ?? 'cash',
    staff_id: U, catalog_version: 1, shift_id: o.shiftId, lines: [{ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1 }],
    bill_discount: null, promo_code: null, skip_promotion_ids: [], no_promotions: false, totals: { items_subtotal: total, items_discount: 0, bill_discount: 0, total }, note: null }
}
export const voidRow = (n: number, voidedAt: string) => ({ pos_order_id: oid(n), voided_at: voidedAt, staff_id: U, approved_by: null, reason: 'ลูกค้ายกเลิก' })
export const movementRow = (n: number, shiftN: number, kind: 'PAID_IN' | 'PAID_OUT' | 'DROP' | 'VOID_REFUND', amount: number, createdAt: string, posOrderN: number | null = null) =>
  ({ movement_id: mid(n), shift_id: sid(shiftN), kind, amount, pos_order_id: posOrderN === null ? null : oid(posOrderN), reason: kind === 'VOID_REFUND' ? null : 'ทดสอบ', created_by: U, created_at: createdAt })
export const botBill = (no: string, total: number, soldAt: string): CentralOrder => ({ order_no: no, sale_date: soldAt.slice(0, 10), status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'line', payment: 'cash',
  totals: { items_subtotal: total, items_discount: 0, bill_discount: 0, total }, amount_mismatch: false, updated_at: soldAt, sold_at: soldAt })
