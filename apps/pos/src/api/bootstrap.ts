import { and, desc, eq, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { readCatalog } from '../sync/catalog'
import { isBackupDue, lastBackupAt, lastBackupZId } from './backup'
import { isDayoLinked, ownerRecoveryAllowed, storedBaseUrl } from './connect'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { staffNeedingPin } from './staff'
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

/** Active users with a PIN — in the order of dayo's staff list (E1) when there is one (owners first there), else by creation. */
export async function listActiveUsers(db: RemoteDb): Promise<UserDto[]> {
  const rows = await db.select().from(s.user).where(eq(s.user.isActive, true)).orderBy(s.user.createdAt, s.user.id).all()
  const users = rows.map((u) => ({ id: u.id, displayName: u.displayName, role: u.role }))
  const catalog = await readCatalog(db)
  if (catalog === null) return users
  const rank = new Map(catalog.staff.map((x, i) => [x.id, i]))
  const at = (id: string): number => rank.get(id) ?? Number.MAX_SAFE_INTEGER
  return users.map((u, i) => ({ u, i })).sort((a, b) => at(a.u.id) - at(b.u.id) || a.i - b.i).map((x) => x.u)
}

/**
 * D50 Q3-26 in block 2 (spec 04 §6.1, §12 "ยังไม่ส่ง N รายการ"): bills, not outbox rows — an order and its order_void
 * count once (both carry the bill's pos_order_id). local_only rows (shift, cash, count, Z) never count; stock is not
 * queued at all.
 */
export async function countPendingSyncItems(db: RemoteDb): Promise<number> {
  const r = await db.values<[number]>(sql`select count(distinct json_extract(row_json, '$.pos_order_id')) from outbox where status = 'pending' and table_name in ('order', 'order_void')`)
  return r[0]?.[0] ?? 0
}

/** Bills with a dead E2 row (dayo refused it for good, or it was stuck) — the "มีปัญหา" count of spec §12. */
export async function countSyncProblems(db: RemoteDb): Promise<number> {
  const r = await db.values<[number]>(sql`select count(distinct json_extract(row_json, '$.pos_order_id')) from outbox where status = 'dead' and table_name in ('order', 'order_void')`)
  return r[0]?.[0] ?? 0
}

export async function bootstrap(db: RemoteDb, deps: ApiDeps): Promise<BootstrapState> {
  const dayoLinked = await isDayoLinked(db, deps)
  // Not a secret (controller ruling R1): read regardless of `dayoLinked` so a device whose key was revoked or
  // cleared, but whose address is still stored, can still offer a locked address on the recovery screen.
  // M3 (fix round 1 round 2, security): the normalized `storedBaseUrl` — never the raw column — so the UI shows
  // null in exactly the cases `replaceApiKey`/`recoverOwner` themselves would refuse (e.g. a corrupt stored value).
  const dayoBaseUrl = await storedBaseUrl(db)
  if ((await localDeviceId(db)) === null) {
    return { needsSetup: true, device: null, users: [], openShift: null, pendingSyncItems: 0, lastBackupAt: null, backupDue: false, legacyDevice: false, dayoLinked: false, dayoBaseUrl, staffNeedingPin: [], ownerRecovery: false }
  }
  const device = await requireDevice(db)
  const lastAt = await lastBackupAt(db)
  const lastZId = await lastBackupZId(db)
  return {
    needsSetup: !dayoLinked,
    device,
    users: await listActiveUsers(db),
    openShift: await currentOpenShift(db, device.id),
    pendingSyncItems: await countPendingSyncItems(db),
    lastBackupAt: lastAt,
    backupDue: await isBackupDue(db, device.id, lastZId),
    legacyDevice: !dayoLinked, // a device row without a dayo link = set up by plan 3/4's setupShop (ruling R7)
    dayoLinked,
    dayoBaseUrl,
    staffNeedingPin: dayoLinked ? await staffNeedingPin(db) : [],
    ownerRecovery: dayoLinked && (await ownerRecoveryAllowed(db)),
  }
}
