import { and, desc, eq, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { isBackupDue, lastBackupAt, lastBackupZId } from './backup'
import { PosError } from './errors'
import type { BootstrapState, DeviceDto, ShiftDto, UserDto } from './types'

/** sync_state key holding this device's id (decision T7). */
export const LOCAL_DEVICE_KEY = 'local.device_id'

export async function localDeviceId(db: RemoteDb): Promise<string | null> {
  const row = await db.select().from(s.syncState).where(eq(s.syncState.key, LOCAL_DEVICE_KEY)).get()
  return row?.value ?? null
}

export async function requireDevice(db: RemoteDb): Promise<DeviceDto> {
  const id = await localDeviceId(db)
  const row = id === null ? undefined : await db.select().from(s.device).where(eq(s.device.id, id)).get()
  if (!row) throw new PosError('NEEDS_SETUP', 'this device has not been set up')
  return { id: row.id, name: row.name, receiptPrefix: row.receiptPrefix }
}

export async function currentOpenShift(db: RemoteDb, deviceId: string): Promise<ShiftDto | null> {
  const row = await db
    .select()
    .from(s.shift)
    .where(and(eq(s.shift.deviceId, deviceId), eq(s.shift.status, 'open')))
    .orderBy(desc(s.shift.openedAt))
    .limit(1)
    .get()
  return row ? { id: row.id, businessDate: row.businessDate, openedAt: row.openedAt, openedBy: row.openedBy, openingFloatSatang: row.openingFloatSatang } : null
}

export async function listActiveUsers(db: RemoteDb): Promise<UserDto[]> {
  const rows = await db.select().from(s.user).where(eq(s.user.isActive, true)).orderBy(s.user.createdAt, s.user.id).all()
  return rows.map((u) => ({ id: u.id, displayName: u.displayName, role: u.role }))
}

/**
 * spec §12 "ยังไม่ส่ง N รายการ" (D50 Q3-26): counts bills, not outbox rows. Every pending row that belongs to an order
 * (the order row itself, its lines, discount, payment, events, `refType = 'order'` stock movements and the VOID_REFUND
 * cash movement) counts once per order. Plan 4 (T4-8) counts stock documents the same way: a purchase, a production
 * batch, a stock count or a stock adjustment is one item with its lines and movements (a movement counts under its
 * `refType:refId`). Any other record (a shift, a paid-in/out — including the PAID_OUT of a receipt paid from the
 * drawer, which is a cash record of its own) counts once per row id. Only status pending — plan 2 M8; dead rows are
 * shown elsewhere by plan 5. m-2 (Task 3 fix round 1): the whole case is wrapped in `coalesce(…, table_name || ':' ||
 * id)` — if a future writer ever queues a row missing the field a branch reads (`refType`/`refId`, `purchaseId`,
 * `countId`), the key must fall back to something non-null, never disappear into `count(distinct …)`'s silent skip
 * of NULL. That would make the badge undercount, which it must never do.
 */
export async function countPendingSyncItems(db: RemoteDb): Promise<number> {
  const rows = await db.values<[number]>(sql`
    select count(distinct coalesce(case
      when table_name = 'order' then 'order:' || json_extract(row_json, '$.id')
      when table_name in ('order_line', 'payment', 'discount', 'order_event') then 'order:' || json_extract(row_json, '$.orderId')
      when table_name = 'stock_movement' then json_extract(row_json, '$.refType') || ':' || json_extract(row_json, '$.refId')
      when table_name = 'cash_movement' and json_extract(row_json, '$.orderId') is not null then 'order:' || json_extract(row_json, '$.orderId')
      when table_name = 'purchase_line' then 'purchase:' || json_extract(row_json, '$.purchaseId')
      when table_name = 'stock_count_line' then 'stock_count:' || json_extract(row_json, '$.countId')
      else table_name || ':' || json_extract(row_json, '$.id')
    end, table_name || ':' || json_extract(row_json, '$.id')))
    from outbox where status = 'pending'`)
  return rows[0]?.[0] ?? 0
}

export async function bootstrap(db: RemoteDb): Promise<BootstrapState> {
  if ((await localDeviceId(db)) === null) return { needsSetup: true, device: null, users: [], openShift: null, pendingSyncItems: 0, lastBackupAt: null, backupDue: false }
  const device = await requireDevice(db)
  const lastAt = await lastBackupAt(db)
  const lastZId = await lastBackupZId(db)
  return {
    needsSetup: false,
    device,
    users: await listActiveUsers(db),
    openShift: await currentOpenShift(db, device.id),
    pendingSyncItems: await countPendingSyncItems(db),
    lastBackupAt: lastAt,
    backupDue: await isBackupDue(db, device.id, lastZId),
  }
}
