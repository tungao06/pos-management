import { eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { hashPin } from '../lib/pin'
import { readCatalog, roleOf, staffDisplayName } from '../sync/catalog'
import { requireOwnerPin } from './auth'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import type { SetStaffPinInput, StaffOptionDto, UserDto } from './types'

/** Staff dayo lists as active with a role the tablet knows, who have no PIN here yet (spec 04 §6.5). */
export async function staffNeedingPin(db: RemoteDb): Promise<StaffOptionDto[]> {
  const c = await readCatalog(db)
  if (c === null) return []
  const withPin = new Set((await db.select({ id: s.user.id }).from(s.user).all()).map((u) => u.id))
  return c.staff.flatMap((x) => {
    const role = roleOf(x.role)
    return x.active && role !== null && !withPin.has(x.id) ? [{ id: x.id, displayName: staffDisplayName(x), role }] : []
  })
}

/**
 * Q44 (`can(role, 'set_other_pin')` — owner only): an owner sets another person's PIN, approving with their own PIN
 * (D50 Q3-21 lockout applies). Only the argon2id hash is stored; the audit row names who, never the PIN.
 * Same caller requirement as `requireOwnerPin`: outside any transaction, inside the PosApi serial queue.
 */
export async function setStaffPin(db: RemoteDb, deps: ApiDeps, input: SetStaffPinInput): Promise<UserDto> {
  const approver = await requireOwnerPin(db, deps, input.approverUserId, input.approverPin)
  const c = await readCatalog(db)
  if (c === null) throw new PosError('NO_CATALOG', 'no staff list from dayo on this tablet yet')
  const entry = c.staff.find((x) => x.id === input.staffId)
  const role = entry === undefined ? null : roleOf(entry.role)
  if (entry === undefined || !entry.active || role === null) throw new PosError('BAD_INPUT', 'พนักงานคนนี้ไม่ได้อยู่ในรายชื่อที่ใช้งานของระบบกลาง')
  const pinHash = await hashPin(input.pin, deps.pinCost) // slow: outside the transaction
  const displayName = staffDisplayName(entry)
  await db.transaction(async (tx) => {
    const at = deps.now()
    const before = await tx.select().from(s.user).where(eq(s.user.id, entry.id)).get()
    if (before === undefined) {
      await tx.insert(s.user).values({ id: entry.id, displayName, role, pinHash, isActive: true, createdAt: at, updatedAt: at, version: 1 })
    } else {
      await tx.update(s.user).set({ pinHash, displayName, role, isActive: true, updatedAt: at, version: before.version + 1 }).where(eq(s.user.id, entry.id))
    }
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'user', entityId: entry.id, action: 'pin_set', beforeJson: null, afterJson: { staffId: entry.id, role, approvedBy: approver.id }, actorUserId: approver.id, at })
  })
  return { id: entry.id, displayName, role }
}
