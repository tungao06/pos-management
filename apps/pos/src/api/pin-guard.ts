import { eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import type { ApiDeps } from './deps'
import { PosError } from './errors'

/** D50 Q3-21: after 5 wrong PINs in a row wait 30 s; each further failure doubles the wait, capped at 15 minutes. */
export const PIN_FREE_TRIES = 5
export const PIN_LOCK_BASE_MS = 30_000
export const PIN_LOCK_MAX_MS = 15 * 60_000

/** Lock length after `fails` consecutive wrong PINs (0 = not locked). */
export function pinLockMs(fails: number): number {
  if (fails < PIN_FREE_TRIES) return 0
  return Math.min(PIN_LOCK_BASE_MS * 2 ** (fails - PIN_FREE_TRIES), PIN_LOCK_MAX_MS)
}

export type PinGuardState = { fails: number; lockedUntil: string | null }

/** Kept in the local-only sync_state table (never synced, survives a reload) — one row per user. */
const guardKey = (userId: string): string => `pin_guard.${userId}`

export async function readPinGuard(db: RemoteDb, userId: string): Promise<PinGuardState> {
  const row = await db.select().from(s.syncState).where(eq(s.syncState.key, guardKey(userId))).get()
  return row ? (JSON.parse(row.value) as PinGuardState) : { fails: 0, lockedUntil: null }
}

/** Throws PIN_LOCKED with the whole seconds left (rounded up) while the user is locked out. */
export function assertNotLocked(state: PinGuardState, nowIso: string): void {
  if (state.lockedUntil === null) return
  const leftMs = Date.parse(state.lockedUntil) - Date.parse(nowIso)
  if (leftMs > 0) throw new PosError('PIN_LOCKED', String(Math.ceil(leftMs / 1000)))
}

/** Counts one more wrong PIN, locks from the 5th, and audits the failure (and the lockout) — never the PIN itself. */
export async function recordPinFailure(db: RemoteDb, deps: ApiDeps, userId: string, state: PinGuardState): Promise<PinGuardState> {
  const at = deps.now()
  const fails = state.fails + 1
  const lockMs = pinLockMs(fails)
  const next: PinGuardState = { fails, lockedUntil: lockMs > 0 ? new Date(Date.parse(at) + lockMs).toISOString() : null }
  const value = JSON.stringify(next)
  await db.transaction(async (tx) => {
    await tx.insert(s.syncState).values({ key: guardKey(userId), value }).onConflictDoUpdate({ target: s.syncState.key, set: { value } })
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'user', entityId: userId, action: 'pin_fail', beforeJson: null, afterJson: { fails }, actorUserId: null, at })
    if (lockMs > 0) {
      await tx.insert(s.auditLog).values({
        id: deps.newId(), entity: 'user', entityId: userId, action: 'pin_lockout', beforeJson: null,
        afterJson: { fails, lockSeconds: lockMs / 1000, lockedUntil: next.lockedUntil }, actorUserId: null, at,
      })
    }
  })
  return next
}

/** A right PIN resets the counter (upsert to zero rather than delete — the row is reused on the next failure). */
export async function clearPinGuard(db: RemoteDb, userId: string): Promise<void> {
  const value = JSON.stringify({ fails: 0, lockedUntil: null } satisfies PinGuardState)
  await db.insert(s.syncState).values({ key: guardKey(userId), value }).onConflictDoUpdate({ target: s.syncState.key, set: { value } })
}
