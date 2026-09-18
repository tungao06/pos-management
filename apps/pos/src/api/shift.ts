import { eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { enqueueOutbox } from '../db/outbox'
import { bangkokDate } from '../lib/clock'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import type { OpenShiftInput, ShiftDto } from './types'

/**
 * spec §4.8: one open shift per device — checked here for a clear error, and enforced by the DB's partial unique
 * index (D47 item 6) as the last line · business_date = Thai calendar date at opening (decision T11).
 */
export async function openShift(db: RemoteDb, deps: ApiDeps, input: OpenShiftInput): Promise<ShiftDto> {
  const device = await requireDevice(db)
  if (!Number.isSafeInteger(input.openingFloatSatang) || input.openingFloatSatang < 0) {
    throw new PosError('BAD_INPUT', 'opening float must be a whole number of satang >= 0')
  }
  const user = await db.select().from(s.user).where(eq(s.user.id, input.userId)).get()
  if (!user || !user.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${input.userId}`)

  return db.transaction(async (tx) => {
    if ((await currentOpenShift(tx, device.id)) !== null) throw new PosError('SHIFT_ALREADY_OPEN', 'close the current shift first')
    const at = deps.now()
    const row = {
      id: deps.newId(),
      deviceId: device.id,
      businessDate: bangkokDate(at),
      status: 'open',
      openedBy: user.id,
      openedAt: at,
      openingFloatSatang: input.openingFloatSatang,
      closedBy: null,
      closedAt: null,
    } satisfies typeof s.shift.$inferInsert
    await tx.insert(s.shift).values(row)
    await enqueueOutbox(tx, 'shift', row, at, deps.newId)
    return { id: row.id, businessDate: row.businessDate, openedAt: at, openedBy: user.id, openingFloatSatang: row.openingFloatSatang }
  })
}
