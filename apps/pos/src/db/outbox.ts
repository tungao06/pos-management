import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import {
  type CashCountRowData, type CashMovementRowData, type OrderOffCatalogRowData, type OrderRowData, type OrderVoidRowData, PushRow, rowKey,
  type ShiftCloseRowData, type ShiftOpenRowData,
} from '@dayo/contracts'

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

/**
 * One E2 row of any of the seven kinds (spec 04 §4.10). `id` = the kind's own id field (KIND_ID_FIELD) · `parentKey` = the
 * outbox key of the local parent row it waits for (spec 04 §4.10 table · §6.2): a shift's other rows wait for its
 * `shift_open`, `shift_close` for its `cash_count`, `order_void` for its bill (`order` or `order_off_catalog`).
 */
export type PushRowInput =
  | { kind: 'order'; id: string; data: OrderRowData; parentKey: null }
  | { kind: 'order_void'; id: string; data: OrderVoidRowData; parentKey: string }
  | { kind: 'shift_open'; id: string; data: ShiftOpenRowData; parentKey: null }
  | { kind: 'cash_movement'; id: string; data: CashMovementRowData; parentKey: string } // shift_open:<shift_id>
  | { kind: 'cash_count'; id: string; data: CashCountRowData; parentKey: string } // shift_open:<shift_id>
  | { kind: 'shift_close'; id: string; data: ShiftCloseRowData; parentKey: string } // cash_count:<count_id>
  | { kind: 'order_off_catalog'; id: string; data: OrderOffCatalogRowData; parentKey: null }

/** The outbox key a shift's other rows wait for (spec 04 §4.10: parent = the shift's `shift_open`). */
export const shiftParentKey = (shiftId: string): string => rowKey('shift_open', shiftId)
/** The outbox key a `shift_close` waits for (spec 04 §4.10: parent = the shift's `cash_count`). */
export const countParentKey = (countId: string): string => rowKey('cash_count', countId)

/** The parent keys a row may wait for — derived from its own data, so a mislinked row is a tablet bug caught at save time. */
function allowedParents(row: PushRow): (string | null)[] {
  switch (row.kind) {
    case 'order': case 'shift_open': case 'order_off_catalog': return [null]
    case 'order_void': return [rowKey('order', row.data.pos_order_id), rowKey('order_off_catalog', row.data.pos_order_id)]
    case 'cash_movement': case 'cash_count': return [shiftParentKey(row.data.shift_id)]
    case 'shift_close': return [countParentKey(row.data.count_id)]
  }
}

/**
 * One E2 row, written in the caller's transaction (spec §6.1): `row_json` = the E2 `data` ready to send (money already
 * baht), key `<kind>:<id>`, `table_name` = the kind. Parsed with PushRow first (strict data, key = the kind's own id
 * field) and its parent checked — a row the tablet built wrong fails its own save, never the queue.
 */
export async function enqueuePush(db: RemoteDb, row: PushRowInput, at: string, newId: () => string): Promise<void> {
  const parsed = PushRow.parse({ key: rowKey(row.kind, row.id), kind: row.kind, data: row.data })
  if (!allowedParents(parsed).includes(row.parentKey)) throw new Error(`E2 row ${parsed.key}: parent ${String(row.parentKey)} is not ${allowedParents(parsed).map(String).join(' or ')}`)
  await db.insert(s.outbox).values({ id: newId(), tableName: parsed.kind, rowJson: parsed.data, idempotencyKey: parsed.key, status: 'pending', createdAt: at, attempts: 0, lastError: null, sentAt: null, deadAt: null, nextAttemptAt: null, parentKey: row.parentKey, resultJson: null })
}
