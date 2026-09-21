import { and, eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { enqueueOutbox } from '../db/outbox'
import { bangkokDate } from '../lib/clock'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import type { OpenShiftInput, QuickOpenShiftInput, ShiftDto } from './types'

/** audit_log action that marks a "เปิดกะด่วน" (spec §4.8 · plan 3 M18 · Q3b-10 · D52). */
export const QUICK_OPEN_ACTION = 'quick_open'

export async function requireActiveUser(db: RemoteDb, userId: string): Promise<typeof s.user.$inferSelect> {
  const user = await db.select().from(s.user).where(eq(s.user.id, userId)).get()
  if (!user || !user.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${userId}`)
  return user
}

/**
 * Inserts the open shift row + its outbox row inside the caller's transaction. spec §4.8: one open shift per
 * device — checked here for a clear error, and enforced by the DB's partial unique index (D47 item 6) as the last
 * line · business_date = Thai calendar date at opening (decision T11).
 */
async function insertOpenShift(tx: RemoteDb, deps: ApiDeps, deviceId: string, userId: string, openingFloatSatang: number): Promise<ShiftDto> {
  if ((await currentOpenShift(tx, deviceId)) !== null) throw new PosError('SHIFT_ALREADY_OPEN', 'close the current shift first')
  const at = deps.now()
  const row = {
    id: deps.newId(),
    deviceId,
    businessDate: bangkokDate(at),
    status: 'open',
    openedBy: userId,
    openedAt: at,
    openingFloatSatang,
    closedBy: null,
    closedAt: null,
  } satisfies typeof s.shift.$inferInsert
  await tx.insert(s.shift).values(row)
  await enqueueOutbox(tx, 'shift', row, at, deps.newId)
  return { id: row.id, businessDate: row.businessDate, openedAt: at, openedBy: userId, openingFloatSatang }
}

export async function openShift(db: RemoteDb, deps: ApiDeps, input: OpenShiftInput): Promise<ShiftDto> {
  const device = await requireDevice(db)
  if (!Number.isSafeInteger(input.openingFloatSatang) || input.openingFloatSatang < 0) {
    throw new PosError('BAD_INPUT', 'opening float must be a whole number of satang >= 0')
  }
  const user = await requireActiveUser(db, input.userId)
  return db.transaction((tx) => insertOpenShift(tx, deps, device.id, user.id, input.openingFloatSatang))
}

/**
 * spec §4.8 "เปิดกะด่วน": an owner opens the shift with a 0 float without counting the drawer. The shift row is the
 * same as a normal one; the separate record is an audit_log row `shift / quick_open` in the same transaction, and the
 * Z report of this shift carries `openedQuick: true` (Q3b-10 · D52).
 */
export async function quickOpenShift(db: RemoteDb, deps: ApiDeps, input: QuickOpenShiftInput): Promise<ShiftDto> {
  const device = await requireDevice(db)
  const user = await requireActiveUser(db, input.userId)
  if (user.role !== 'owner') throw new PosError('NOT_OWNER', `${user.displayName} is not an owner`)
  return db.transaction(async (tx) => {
    const shift = await insertOpenShift(tx, deps, device.id, user.id, 0)
    await tx.insert(s.auditLog).values({
      id: deps.newId(),
      entity: 'shift',
      entityId: shift.id,
      action: QUICK_OPEN_ACTION,
      beforeJson: null,
      afterJson: { openingFloatSatang: 0, openedBy: user.id },
      actorUserId: user.id,
      at: shift.openedAt,
    })
    return shift
  })
}

/** True when the shift was opened with "เปิดกะด่วน". */
export async function wasQuickOpened(db: RemoteDb, shiftId: string): Promise<boolean> {
  const row = await db
    .select({ id: s.auditLog.id })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.entity, 'shift'), eq(s.auditLog.entityId, shiftId), eq(s.auditLog.action, QUICK_OPEN_ACTION)))
    .get()
  return row !== undefined
}
