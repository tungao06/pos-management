import { eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { bangkokStamp } from '../lib/clock'
import { requireDevice } from './bootstrap'
import { deviceZRows } from './close'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import type { BackupFileDto, ConfirmBackupInput, DeviceDto } from './types'

/** sync_state key (local only, never synced): when the last backup file the owner confirmed as saved was exported. */
export const LAST_BACKUP_KEY = 'local.last_backup_at'
/** sync_state key (local only) holding the id of the last Z report a confirmed backup covered — `isBackupDue` chains on
 * this id, not on a timestamp, because a device clock can be wrong and later corrected (see domain `buildZReport`). */
export const LAST_BACKUP_Z_ID_KEY = 'local.last_backup_z_id'

/** Every SQLite 3 database file starts with these 16 bytes ("SQLite format 3\0"). */
const SQLITE_HEADER = 'SQLite format 3\u0000'

export function isSqliteFile(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 100) return false
  for (let i = 0; i < SQLITE_HEADER.length; i++) if (bytes[i] !== SQLITE_HEADER.charCodeAt(i)) return false
  return true
}

/** "dayo-pos-A-20260917-201000.sqlite3" — receipt prefix + Thai local time of the export (Q3b-6 · D52). */
export function backupFileName(device: DeviceDto, atIso: string): string {
  return `dayo-pos-${device.receiptPrefix}-${bangkokStamp(atIso)}.sqlite3`
}

export async function lastBackupAt(db: RemoteDb): Promise<string | null> {
  const row = await db.select().from(s.syncState).where(eq(s.syncState.key, LAST_BACKUP_KEY)).get()
  return row?.value ?? null
}

export async function lastBackupZId(db: RemoteDb): Promise<string | null> {
  const row = await db.select().from(s.syncState).where(eq(s.syncState.key, LAST_BACKUP_Z_ID_KEY)).get()
  return row?.value ?? null
}

/** Q3b-7 · D52: a backup is due when a Z report of this device was closed after the last one a confirmed backup
 * covered (or none was ever confirmed). Compares the latest Z's id, not a timestamp — a device clock can be wrong and
 * later corrected, and a Z stamped in the future must not keep this banner on after a real backup. */
export async function isBackupDue(db: RemoteDb, deviceId: string, lastBackupZId: string | null): Promise<boolean> {
  const last = (await deviceZRows(db, deviceId))[0]
  return last !== undefined && last.id !== lastBackupZId
}

/** Q3b-13 · D53: the file holds every PIN hash and the shop's PromptPay id — only an active owner may export or confirm it. */
async function requireActiveOwner(db: RemoteDb, userId: string): Promise<typeof s.user.$inferSelect> {
  const u = await db.select().from(s.user).where(eq(s.user.id, userId)).get()
  if (!u || !u.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${userId}`)
  if (u.role !== 'owner') throw new PosError('NOT_OWNER', `${u.displayName} is not an owner`)
  return u
}

/**
 * spec §11 "สำรองข้อมูลด้วย export ไฟล์ SQLite" + spike I3: copies the whole database file (opfs-sahpool `exportFile`
 * in the Worker) and returns it for the UI to download (Q3b-6). Runs inside the PosApi serial queue, so no transaction
 * is half-way when the file is read. Records nothing: the browser gives no signal that the download reached the
 * Downloads folder, so the backup only counts once the owner confirms it (`confirmBackupSaved` — review I-4).
 */
export async function exportBackup(db: RemoteDb, deps: ApiDeps, actorUserId: string): Promise<BackupFileDto> {
  const device = await requireDevice(db)
  await requireActiveOwner(db, actorUserId)
  const lastZ = (await deviceZRows(db, device.id))[0]
  let bytes: Uint8Array
  try {
    bytes = await deps.exportDbFile()
  } catch (e) {
    throw new PosError('BACKUP_FAILED', e instanceof Error ? e.message : String(e))
  }
  if (!isSqliteFile(bytes)) throw new PosError('BACKUP_FAILED', `exported ${bytes.byteLength} bytes that are not an SQLite file`)
  const at = deps.now()
  return { fileName: backupFileName(device, at), bytes, createdAt: at, lastZId: lastZ?.id ?? null }
}

/**
 * Q3b-7 · D52 + review I-4: the owner saw the file in Downloads and tapped "บันทึกไฟล์แล้ว". Records the export time and
 * the Z the file covers in sync_state, and an audit_log `backup` row, in one transaction. The input must describe a
 * file this device could have exported (its name matches the device and export time; the Z belongs to this device).
 */
export async function confirmBackupSaved(db: RemoteDb, deps: ApiDeps, input: ConfirmBackupInput): Promise<void> {
  const device = await requireDevice(db)
  const actor = await requireActiveOwner(db, input.actorUserId)
  if (Number.isNaN(Date.parse(input.createdAt)) || input.fileName !== backupFileName(device, input.createdAt)) {
    throw new PosError('BAD_INPUT', `${input.fileName} is not a backup file name of this device for ${input.createdAt}`)
  }
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength <= 0) throw new PosError('BAD_INPUT', 'byteLength must be a whole number > 0')
  if (input.lastZId !== null && !(await deviceZRows(db, device.id)).some((z) => z.id === input.lastZId)) {
    throw new PosError('BAD_INPUT', `z report ${input.lastZId} is not on this device`)
  }
  const at = deps.now()
  await db.transaction(async (tx) => {
    await tx.insert(s.syncState).values({ key: LAST_BACKUP_KEY, value: input.createdAt }).onConflictDoUpdate({ target: s.syncState.key, set: { value: input.createdAt } })
    if (input.lastZId !== null) {
      await tx.insert(s.syncState).values({ key: LAST_BACKUP_Z_ID_KEY, value: input.lastZId }).onConflictDoUpdate({ target: s.syncState.key, set: { value: input.lastZId } })
    }
    await tx.insert(s.auditLog).values({
      id: deps.newId(),
      entity: 'device',
      entityId: device.id,
      action: 'backup',
      beforeJson: null,
      afterJson: { fileName: input.fileName, bytes: input.byteLength, exportedAt: input.createdAt, lastZId: input.lastZId },
      actorUserId: actor.id,
      at,
    })
  })
}
