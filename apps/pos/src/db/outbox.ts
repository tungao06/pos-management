import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { OrderRowData, OrderVoidRowData, rowKey } from '@dayo/contracts'

/**
 * spec 04 §6.1 (block 2): shift / cash / count / Z rows are still queued for the tablet's own record but as
 * `local_only` — their shifts never exist in the central database. Stock, production, purchase and plan-3 bill rows
 * are no longer queued at all (spec §6.1, §11).
 */
export type LocalOnlyTable = 'shift' | 'cash_movement' | 'cash_count' | 'z_report'

export async function enqueueLocalOnly(db: RemoteDb, table: LocalOnlyTable, row: { id: string } & Record<string, unknown>, at: string, newId: () => string, keySuffix?: string): Promise<void> {
  const idempotencyKey = keySuffix === undefined ? `${table}:${row.id}` : `${table}:${row.id}:${keySuffix}`
  await db.insert(s.outbox).values({ id: newId(), tableName: table, rowJson: row, idempotencyKey, status: 'local_only', createdAt: at, attempts: 0, lastError: null, sentAt: null, deadAt: null, nextAttemptAt: null, parentKey: null, resultJson: null })
}

export type PushRowInput =
  | { kind: 'order'; id: string; data: OrderRowData; parentKey: null }
  | { kind: 'order_void'; id: string; data: OrderVoidRowData; parentKey: string }

/**
 * One E2 row, written in the caller's transaction (spec §6.1): `row_json` = the E2 `data` ready to send (money already
 * baht), key `<kind>:<pos_order_id>`. Validated here so a malformed row fails the sale, never the queue.
 */
export async function enqueuePush(db: RemoteDb, row: PushRowInput, at: string, newId: () => string): Promise<void> {
  const data = row.kind === 'order' ? OrderRowData.parse(row.data) : OrderVoidRowData.parse(row.data)
  if (data.pos_order_id !== row.id) throw new Error(`E2 row ${row.kind}: pos_order_id ${data.pos_order_id} is not ${row.id}`)
  await db.insert(s.outbox).values({ id: newId(), tableName: row.kind, rowJson: data, idempotencyKey: rowKey(row.kind, row.id), status: 'pending', createdAt: at, attempts: 0, lastError: null, sentAt: null, deadAt: null, nextAttemptAt: null, parentKey: row.parentKey, resultJson: null })
}
