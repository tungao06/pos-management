import { and, count, desc, eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
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
 * spec §12 "ยังไม่ส่ง N รายการ": rows still waiting (status pending — plan 2 M8; dead rows are shown elsewhere by plan 5).
 * นับเป็นจำนวน "แถว" ใน outbox (บิลหนึ่งใบ ≈ 20+ แถว) ไม่ใช่จำนวนบิล — รอ Q3-26 ถ้าต้องเปลี่ยนไปนับบิล
 */
export async function countPendingOutbox(db: RemoteDb): Promise<number> {
  const row = await db.select({ c: count() }).from(s.outbox).where(eq(s.outbox.status, 'pending')).get()
  return row?.c ?? 0
}

export async function bootstrap(db: RemoteDb): Promise<BootstrapState> {
  if ((await localDeviceId(db)) === null) return { needsSetup: true, device: null, users: [], openShift: null, outboxPending: 0 }
  const device = await requireDevice(db)
  return {
    needsSetup: false,
    device,
    users: await listActiveUsers(db),
    openShift: await currentOpenShift(db, device.id),
    outboxPending: await countPendingOutbox(db),
  }
}
