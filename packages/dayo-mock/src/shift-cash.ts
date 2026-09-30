// packages/dayo-mock/src/shift-cash.ts — E4 GET /api/v1/pos/shift-cash?after=&until= (spec 04 §4.10 · dayo main 0067:18-73).
// No node:* imports.
import { ts, utcMs } from './judge-util.js'
import type { MockState } from './state.js'

export type BotCashBill = { order_no: string; version: number; source: string; sold_at: string; total: number; created_by_name: string | null }

/**
 * dayo_shift_cash_bills (0067:18-29): status ok · payment cash · source line/web · created_at ∈ (after, until], ordered by
 * created_at, order_no. dayo filters on orders.created_at; the mock's seeded bills carry no created_at, so sold_at stands for
 * it (R15 · preflight D9 — a web bill keyed in later has created_at ≠ sold_at on real dayo; Task 19a checks that case).
 */
export function botCashBills(s: MockState, after: number, until: number): BotCashBill[] {
  const staffRead = s.scopes.includes('staff:read') // created_by_name only with staff:read (0067:69)
  return s.seedOrders
    .filter((o) => o.status === 'ok' && o.payment === 'cash' && (o.source === 'line' || o.source === 'web') && o.sold_at != null)
    .filter((o) => { const t = Date.parse(o.sold_at!); return t > after && t <= until })
    .sort((a, b) => Date.parse(a.sold_at!) - Date.parse(b.sold_at!) || (a.order_no < b.order_no ? -1 : a.order_no > b.order_no ? 1 : 0))
    .map((o) => ({ order_no: o.order_no, version: o.version, source: o.source, sold_at: utcMs(Date.parse(o.sold_at!)), total: o.totals.total, created_by_name: staffRead ? (o.created_by_name ?? null) : null }))
}

/** api_shift_cash (0067:31-75 · server_time since 0076:50-52 = the mock's clock, …mmm+00:00): after/until = dayo_pos_ts (ISO-8601 with a zone) else DY422 · after ≥ until = DY422 · no cap on bills. */
export function shiftCashAnswer(s: MockState, url: URL, serverTime: string): { status: number; body: unknown } {
  const after = ts(url.searchParams.get('after'))
  const until = ts(url.searchParams.get('until'))
  if (after === null || until === null) return { status: 422, body: { ok: false, error: { code: 'DY422', message: 'invalid: after และ until ต้องเป็นเวลา ISO-8601 ที่มีเขตเวลา' } } }
  if (after >= until) return { status: 422, body: { ok: false, error: { code: 'DY422', message: 'invalid: after ต้องน้อยกว่า until' } } }
  const bills = botCashBills(s, after, until)
  return { status: 200, body: { ok: true, data: { bills, cash_total: bills.reduce((a, b) => a + Math.round(b.total * 100), 0) / 100, server_time: serverTime } } }
}
