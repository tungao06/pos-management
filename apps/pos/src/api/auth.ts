import { eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { verifyPin } from '../lib/pin'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { assertNotLocked, clearPinGuard, pinLockMs, readPinGuard, recordPinFailure } from './pin-guard'
import type { UserDto } from './types'

/**
 * Offline PIN check against the synced pin_hash (spec §7 Auth). Same error for unknown user and wrong PIN.
 * D50 Q3-21: 5 wrong PINs in a row lock this user for 30 s, doubling per further failure up to 15 min (pin-guard.ts).
 */
export async function login(db: RemoteDb, deps: ApiDeps, userId: string, pin: string): Promise<UserDto> {
  const guard = await readPinGuard(db, userId)
  assertNotLocked(guard, deps.now()) // while locked the PIN is not even checked
  const u = await db.select().from(s.user).where(eq(s.user.id, userId)).get()
  if (!u || !u.isActive || !(await verifyPin(pin, u.pinHash))) {
    const next = await recordPinFailure(db, deps, userId, guard)
    if (next.lockedUntil !== null) throw new PosError('PIN_LOCKED', String(pinLockMs(next.fails) / 1000))
    throw new PosError('PIN_WRONG', 'wrong user or PIN')
  }
  if (guard.fails > 0) await clearPinGuard(db, userId)
  return { id: u.id, displayName: u.displayName, role: u.role }
}

/** spec §4.3: voiding a paid order needs an owner's PIN — same lockout counter as login (D50 Q3-21). */
export async function requireOwnerPin(db: RemoteDb, deps: ApiDeps, userId: string, pin: string): Promise<UserDto> {
  const u = await login(db, deps, userId, pin)
  if (u.role !== 'owner') throw new PosError('NOT_OWNER', `${u.displayName} is not an owner`)
  return u
}
