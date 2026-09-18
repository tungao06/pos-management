import { and, desc, eq, lte } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { classifyPromptPayId } from '@dayo/domain'
import { hashPin } from '../lib/pin'
import { LOCAL_DEVICE_KEY, localDeviceId } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import type { SetupInput } from './types'

export const PROMPTPAY_SETTING_KEY = 'promptpay.id'

/** setting is keyed by (key, effective_from) (D47 item 9): the value in force at `atIso` is the latest one not in the future. */
export async function getSetting(db: RemoteDb, key: string, atIso: string): Promise<unknown> {
  const row = await db
    .select()
    .from(s.setting)
    .where(and(eq(s.setting.key, key), lte(s.setting.effectiveFrom, atIso)))
    .orderBy(desc(s.setting.effectiveFrom))
    .limit(1)
    .get()
  return row?.valueJson ?? null
}

/**
 * First-run registration of this selling device, its owners (TungAo, DCm by default) and the PromptPay id — typed in
 * on the tablet, never stored in the repo (D48 Q3-16, Q3-3). Plan 5 decides how these rows reach the server.
 */
export async function setupShop(db: RemoteDb, deps: ApiDeps, input: SetupInput): Promise<void> {
  if ((await localDeviceId(db)) !== null) throw new PosError('ALREADY_SET_UP', 'this device is already registered')
  const deviceName = input.deviceName.trim()
  const prefix = input.receiptPrefix.trim()
  if (deviceName === '') throw new PosError('BAD_INPUT', 'device name is required')
  if (!/^[A-Z]{1,3}$/.test(prefix)) throw new PosError('BAD_INPUT', 'receipt prefix must be 1-3 letters A-Z')
  if (input.owners.length === 0) throw new PosError('BAD_INPUT', 'at least one owner is required')
  const names = input.owners.map((o) => o.displayName.trim())
  if (names.some((n) => n === '')) throw new PosError('BAD_INPUT', 'owner name is required')
  if (new Set(names).size !== names.length) throw new PosError('BAD_INPUT', 'owner names must be different')
  let promptPayDigits: string
  try {
    promptPayDigits = classifyPromptPayId(input.promptPayId).digits
  } catch (e) {
    throw new PosError('BAD_INPUT', e instanceof Error ? e.message : String(e))
  }
  // Hash outside the transaction: argon2 is slow and must not hold the database.
  const pinHashes = await Promise.all(input.owners.map((o) => hashPin(o.pin, deps.pinCost)))

  await db.transaction(async (tx) => {
    const at = deps.now()
    const deviceId = deps.newId()
    // Every R row starts at version 1 with updated_at = now (D47 item 8).
    const device = { id: deviceId, name: deviceName, receiptPrefix: prefix, isSellingDevice: true, registeredAt: at, version: 1, updatedAt: at } satisfies typeof s.device.$inferInsert
    await tx.insert(s.device).values(device)
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'device', entityId: deviceId, action: 'create', beforeJson: null, afterJson: device, actorUserId: null, at })

    let firstOwnerId: string | null = null
    for (const [i, name] of names.entries()) {
      const userId = deps.newId()
      firstOwnerId ??= userId
      await tx.insert(s.user).values({ id: userId, displayName: name, role: 'owner', pinHash: pinHashes[i]!, isActive: true, createdAt: at, updatedAt: at, version: 1 })
      await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'user', entityId: userId, action: 'create', beforeJson: null, afterJson: { id: userId, displayName: name, role: 'owner', isActive: true }, actorUserId: null, at })
    }

    await tx.insert(s.setting).values({ key: PROMPTPAY_SETTING_KEY, valueJson: promptPayDigits, effectiveFrom: at, updatedAt: at, version: 1 })
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'setting', entityId: PROMPTPAY_SETTING_KEY, action: 'create', beforeJson: null, afterJson: { value: promptPayDigits }, actorUserId: firstOwnerId, at })
    await tx.insert(s.syncState).values({ key: LOCAL_DEVICE_KEY, value: deviceId })
  })
}
