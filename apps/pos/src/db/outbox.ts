import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'

/** Transaction tables that flow up to the server (spec §3 type T). Plan 5 sends them; plan 3 only writes them. */
export type OutboxTable = 'order' | 'order_line' | 'payment' | 'discount' | 'order_event' | 'stock_movement' | 'shift' | 'cash_movement'

/** Queues one written row for sync inside the caller's transaction (spec §6.1, decision T15). */
export async function enqueueOutbox(
  db: RemoteDb,
  table: OutboxTable,
  row: { id: string } & Record<string, unknown>,
  at: string,
  newId: () => string,
  keySuffix?: string,
): Promise<void> {
  const idempotencyKey = keySuffix === undefined ? `${table}:${row.id}` : `${table}:${row.id}:${keySuffix}`
  await db.insert(s.outbox).values({ id: newId(), tableName: table, rowJson: row, idempotencyKey, status: 'pending', createdAt: at, attempts: 0, lastError: null, sentAt: null, deadAt: null })
}
