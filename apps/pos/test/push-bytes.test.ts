import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { OrderRowData } from '@dayo/contracts'
import { pushOnce } from '../src/sync/push'
import { openConnectedApi, STAFF } from './helpers/dayo'

const uuid = (n: number): string => `aaaaaaaa-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
function bigRow(n: number): OrderRowData {
  return OrderRowData.parse({
    pos_order_id: uuid(n), receipt_no: `A-${String(n).padStart(6, '0')}`, queue_no: n, sale_date: '2026-09-25', sold_at: '2026-09-25T03:00:00.000Z',
    channel: 'store', payment: 'cash', staff_id: STAFF.TungAo, catalog_version: 42, shift_id: null,
    lines: Array.from({ length: 50 }, () => ({ code: 'ก'.repeat(100), size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1 })), // ~20 KB of Thai per row
    bill_discount: null, promo_code: null, skip_promotion_ids: [], no_promotions: false,
    totals: { items_subtotal: 35, items_discount: 0, bill_discount: 0, total: 35 }, note: null,
  })
}
async function insertRows(t: Awaited<ReturnType<typeof openConnectedApi>>, from: number, count: number, shape: (row: OrderRowData) => Record<string, unknown> = (r) => r) {
  for (let n = from; n < from + count; n++) {
    const createdAt = new Date(Date.parse('2026-09-25T03:00:00.000Z') + n).toISOString() // strictly increasing, FIFO by n
    await t.db.insert(s.outbox).values({ id: uuid(n), tableName: 'order', rowJson: shape(bigRow(n)), idempotencyKey: `order:${uuid(n)}`, status: 'pending', createdAt, attempts: 0, lastError: null, sentAt: null, deadAt: null, nextAttemptAt: null, parentKey: null, resultJson: null })
  }
}

describe('push body size and the pick window', () => {
  it('never sends a body over 262,144 UTF-8 bytes and keeps FIFO order', async () => {
    const t = await openConnectedApi()
    await insertRows(t, 1, 20)
    const sizes: number[] = []
    const keys: string[] = []
    const spy: typeof fetch = async (input, init) => {
      const body = String(init?.body ?? '')
      sizes.push(new TextEncoder().encode(body).length)
      keys.push(...(JSON.parse(body) as { rows: { key: string }[] }).rows.map((r) => r.key))
      return t.mock.fetch(input, init)
    }
    await pushOnce({ db: t.db, deps: { ...t.deps, fetch: spy }, serial: (fn) => fn() })
    expect(sizes.length).toBeGreaterThan(1)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(262_144)
    expect(keys).toEqual(Array.from({ length: 20 }, (_, i) => `order:${uuid(i + 1)}`))
  })
  it('250 rows parked as UNSUPPORTED in front do not hide a sendable row behind them', async () => {
    const t = await openConnectedApi()
    await insertRows(t, 1, 250, (r) => ({ ...r, tip: 5 })) // a field dayo does not list → held by isRowSupported
    await insertRows(t, 251, 1, (r) => ({ ...r, lines: [{ code: 'Cocoa', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1 }] }))
    const o = await pushOnce({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    expect(o).toMatchObject({ requests: 1, sent: 1, held: 250 })
  })
})
