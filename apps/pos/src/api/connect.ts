import { and, eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { API_KEY_RE, PosOrderCatalog, RECEIPT_NO_RE, type PosCatalogLooseData } from '@dayo/contracts'
import { classifyPromptPayId, parseReceiptNo } from '@dayo/domain'
import vendor from '@dayo/dayo-pricing/VENDOR.json' with { type: 'json' }
import { hashPin } from '../lib/pin'
import { normalizeBaseUrl } from '../sync/base-url'
import { roleOf, staffDisplayName, writeCatalogAnswer } from '../sync/catalog'
import { createDayoClient, DayoError, type Timed } from '../sync/dayo-client'
import { DAYO_KEYS, readKey, writeKey } from '../sync/state'
import { requireOwnerPin } from './auth'
import { LOCAL_DEVICE_KEY, localDeviceId } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { PROMPTPAY_SETTING_KEY } from './setup'
import type { ConnectShopInput, DayoProbe, DayoProbeInput, RecoverOwnerInput, ReplaceApiKeyInput } from './types'

/** The one base-URL rule of the tablet (Task 9) — re-exported so the setup screens need only this module. */
export { normalizeBaseUrl }

type ChangedAnswer = Extract<PosCatalogLooseData, { changed: true }>

/**
 * What the owner typed on a setup screen, checked before ANY network call (carried security requirement 3):
 * the shared `normalizeBaseUrl` (https, or http only to localhost / 127.0.0.1; no credentials, query or fragment),
 * plus — only here, where a person types it — the path must end in /api/v1. Errors never echo the URL or the key.
 */
function checkedTarget(input: { baseUrl: string; apiKey: string }): { baseUrl: string; apiKey: string } {
  let baseUrl: string
  try { baseUrl = normalizeBaseUrl(input.baseUrl) } catch (e) { throw new PosError('BAD_INPUT', e instanceof Error ? e.message : 'BAD_BASE_URL') }
  if (!baseUrl.endsWith('/api/v1')) throw new PosError('BAD_INPUT', 'BAD_BASE_URL: the address must end with /api/v1')
  const apiKey = input.apiKey.trim()
  if (!API_KEY_RE.test(apiKey)) throw new PosError('BAD_INPUT', 'กุญแจเครื่องต้องขึ้นต้นด้วย dayo_ ตามด้วยเลขฐานสิบหก 64 ตัว')
  return { baseUrl, apiKey }
}

/** E1 with known_version=0 — the only dayo call of setup; maps failures to setup codes (never the key in a message). */
async function fetchFullCatalog(deps: ApiDeps, target: { baseUrl: string; apiKey: string }): Promise<Timed<ChangedAnswer>> {
  const client = createDayoClient({ ...target, fetch: deps.fetch, nowMs: () => Date.parse(deps.now()) })
  let r: Timed<PosCatalogLooseData>
  try {
    r = await client.getCatalog(0)
  } catch (e) {
    if (!(e instanceof DayoError)) throw e
    const f = e.failure
    if (f.kind === 'unauthorized') throw new PosError('DAYO_BAD_KEY', 'dayo refused the key (401)')
    if (f.kind === 'forbidden') throw new PosError('DAYO_KEY_NO_SCOPE', 'the key lacks catalog:read / staff:read (403)')
    if (f.kind === 'api_disabled') throw new PosError('DAYO_API_DISABLED', 'API_V1_ENABLED is off (404)')
    if (f.kind === 'bad_response') throw new PosError('DAYO_BAD_RESPONSE', f.message)
    throw new PosError('DAYO_UNREACHABLE', f.kind)
  }
  if (!r.value.changed) throw new PosError('DAYO_BAD_RESPONSE', 'known_version=0 answered unchanged')
  // setup needs a catalog the tablet can sell with (R12 lets a running tablet keep its old one — a new one has none)
  if (!PosOrderCatalog.safeParse(r.value.catalog).success) throw new PosError('DAYO_BAD_RESPONSE', 'catalog unreadable by this tablet version')
  return { ...r, value: r.value }
}

function activeOwners(answer: ChangedAnswer): DayoProbe['owners'] {
  return answer.staff.filter((x) => x.active && roleOf(x.role) === 'owner').map((x) => ({ id: x.id, displayName: staffDisplayName(x) }))
}

/**
 * spec §4.4 ข้อ 6 · A1: `client.last_receipt_no` is dayo's raw external_ref — the schema no longer checks it, so every
 * reader checks it here before parseReceiptNo. A value of another shape stops the flow; nothing is written and no
 * prefix is guessed.
 */
function requiredPrefix(last: string | null): string | null {
  if (last === null) return null
  if (!RECEIPT_NO_RE.test(last)) throw new PosError('DAYO_RECEIPT_NO_INVALID', 'client.last_receipt_no is not <A-Z{1,3}>-<6 digits>')
  return parseReceiptNo(last).prefix
}

/** spec §4.4 rule 9: only the file hashes decide — `pricing.commit` may be null. */
function pricingMatches(files: Record<string, string>): boolean {
  const want = (vendor as { files: Record<string, string> }).files
  const keys = Object.keys(want).sort()
  return JSON.stringify(keys) === JSON.stringify(Object.keys(files).sort()) && keys.every((k) => files[k] === want[k])
}

/** spec 04 §7 ข้อ 1: test the key with E1 before saving anything. Touches no table. */
export async function probeDayo(deps: ApiDeps, input: DayoProbeInput): Promise<DayoProbe> {
  const answer = await fetchFullCatalog(deps, checkedTarget(input))
  const v = answer.value
  const last = v.client.last_receipt_no
  return {
    clientName: v.client.name, lastReceiptNo: last, requiredPrefix: requiredPrefix(last),
    catalogVersion: v.catalog_version, owners: activeOwners(v), pricingMatches: pricingMatches(v.pricing.files_sha256),
  }
}

/** Upsert of a dayo owner's local row with a fresh PIN hash (no transaction of its own). */
async function giveOwnerPin(tx: RemoteDb, owner: { id: string; displayName: string }, pinHash: string, at: string): Promise<void> {
  const before = await tx.select().from(s.user).where(eq(s.user.id, owner.id)).get()
  if (before === undefined) {
    await tx.insert(s.user).values({ id: owner.id, displayName: owner.displayName, role: 'owner', pinHash, isActive: true, createdAt: at, updatedAt: at, version: 1 })
  } else {
    await tx.update(s.user).set({ pinHash, isActive: true, role: 'owner', displayName: owner.displayName, updatedAt: at, version: before.version + 1 }).where(eq(s.user.id, owner.id))
  }
}

/**
 * spec 04 §7 ข้อ 1 + ruling R7: a new device, or a plan-3/4 device not linked yet (then an old owner approves with a
 * PIN and the device keeps its name and prefix). The key goes to the secret store only once E1 has accepted it, and
 * is cleared again if the save fails. Network runs inside the serial queue on purpose: nothing else runs on an
 * unlinked device.
 */
export async function connectShop(db: RemoteDb, deps: ApiDeps, input: ConnectShopInput): Promise<void> {
  const existingDeviceId = await localDeviceId(db)
  if (existingDeviceId !== null && (await deps.secrets.getApiKey()) !== null) throw new PosError('ALREADY_SET_UP', 'this device is already linked to dayo')
  if (existingDeviceId !== null) {
    if (input.legacyApproval === null) throw new PosError('ALREADY_SET_UP', 'a device set up before block 2 needs an old owner PIN to link')
    await requireOwnerPin(db, deps, input.legacyApproval.userId, input.legacyApproval.pin)
  }
  const prefix = input.receiptPrefix.trim()
  if (!/^[A-Z]{1,3}$/.test(prefix)) throw new PosError('BAD_INPUT', 'receipt prefix must be 1-3 letters A-Z')
  let promptPayDigits: string
  try { promptPayDigits = classifyPromptPayId(input.promptPayId).digits } catch (e) { throw new PosError('BAD_INPUT', e instanceof Error ? e.message : String(e)) }
  const target = checkedTarget(input)

  const answer = await fetchFullCatalog(deps, target)
  const v = answer.value
  const owner = activeOwners(v).find((o) => o.id === input.ownerStaffId)
  if (owner === undefined) throw new PosError('BAD_INPUT', 'เลือกเจ้าของจากรายชื่อระบบกลาง (owner ที่ใช้งานอยู่)')
  const last = v.client.last_receipt_no
  const keyPrefix = requiredPrefix(last)
  if (keyPrefix !== null && keyPrefix !== prefix) throw new PosError('BAD_INPUT', `กุญแจนี้ใช้เลขใบเสร็จ ${keyPrefix} — ใส่ prefix ${keyPrefix}`)
  const pinHash = await hashPin(input.ownerPin, deps.pinCost) // slow: outside the transaction

  await deps.secrets.setApiKey(target.apiKey)
  try {
    await db.transaction(async (tx) => {
      const at = deps.now()
      let deviceId = existingDeviceId
      if (deviceId === null) {
        deviceId = deps.newId()
        const device = { id: deviceId, name: v.client.name, receiptPrefix: prefix, isSellingDevice: true, registeredAt: at, version: 1, updatedAt: at } satisfies typeof s.device.$inferInsert
        await tx.insert(s.device).values(device)
        await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'device', entityId: deviceId, action: 'create', beforeJson: null, afterJson: device, actorUserId: null, at })
        await tx.insert(s.syncState).values({ key: LOCAL_DEVICE_KEY, value: deviceId })
      } else {
        const dev = await tx.select().from(s.device).where(eq(s.device.id, deviceId)).get()
        if (dev?.receiptPrefix !== prefix) throw new PosError('BAD_INPUT', `เครื่องนี้ใช้ prefix ${dev?.receiptPrefix ?? '?'} อยู่แล้ว`)
      }
      await giveOwnerPin(tx, owner, pinHash, at)
      await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'user', entityId: owner.id, action: 'pin_set', beforeJson: null, afterJson: { staffId: owner.id, role: 'owner', by: 'connectShop', legacyApprovedBy: input.legacyApproval?.userId ?? null }, actorUserId: owner.id, at })
      await tx.insert(s.setting).values({ key: PROMPTPAY_SETTING_KEY, valueJson: promptPayDigits, effectiveFrom: at, updatedAt: at, version: 1 })
        .onConflictDoUpdate({ target: [s.setting.key, s.setting.effectiveFrom], set: { valueJson: promptPayDigits, updatedAt: at } })
      await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'device', entityId: deviceId, action: 'dayo_linked', beforeJson: null, afterJson: { baseUrl: target.baseUrl, catalogVersion: v.catalog_version }, actorUserId: owner.id, at }) // never the key
      await writeKey(tx, DAYO_KEYS.baseUrl, target.baseUrl)
      if (last !== null) await writeKey(tx, DAYO_KEYS.lastReceiptNo, last)
      await writeCatalogAnswer(tx, deps, v, answer) // catalog + staff (disables plan-3 owners — ruling R7) + api_state ok
    })
  } catch (e) {
    await deps.secrets.clearApiKey() // nothing saved → no key left behind
    throw e
  }
  deps.afterWrite?.()
}

/** The linked device, its prefix and the check that a key's last receipt number belongs to it. */
async function linkedDevice(db: RemoteDb): Promise<{ id: string; receiptPrefix: string }> {
  const deviceId = await localDeviceId(db)
  const dev = deviceId === null ? undefined : await db.select().from(s.device).where(eq(s.device.id, deviceId)).get()
  if (dev === undefined) throw new PosError('NEEDS_SETUP', 'set the device up first')
  return { id: dev.id, receiptPrefix: dev.receiptPrefix }
}
function checkKeyBelongsTo(device: { receiptPrefix: string }, last: string | null): void {
  const keyPrefix = requiredPrefix(last)
  if (keyPrefix !== null && keyPrefix !== device.receiptPrefix) throw new PosError('BAD_INPUT', `กุญแจนี้เป็นของเครื่องที่ใช้ prefix ${keyPrefix}`)
}

/**
 * Swap the key in the secret store; if `save` fails, put the previous one back. setApiKey overwrites the one slot the
 * store has (carried security requirement 1: the replaced key is never readable afterwards).
 */
async function withNewKey(deps: ApiDeps, apiKey: string, save: () => Promise<void>): Promise<void> {
  const previous = await deps.secrets.getApiKey()
  await deps.secrets.setApiKey(apiKey)
  try {
    await save()
  } catch (e) {
    if (previous === null) await deps.secrets.clearApiKey(); else await deps.secrets.setApiKey(previous)
    throw e
  }
}

/**
 * spec 04 §6.3 row 401 / §7 ข้อ 3: an owner (own PIN) replaces the device key; the receipt prefix never changes.
 * ruling N2: an owner dayo no longer lists as active approves nothing, even with a PIN still on this tablet.
 */
export async function replaceApiKey(db: RemoteDb, deps: ApiDeps, input: ReplaceApiKeyInput): Promise<void> {
  const target = checkedTarget(input)
  await requireOwnerPin(db, deps, input.approverUserId, input.approverPin)
  const device = await linkedDevice(db)
  const answer = await fetchFullCatalog(deps, target)
  const v = answer.value
  if (!activeOwners(v).some((o) => o.id === input.approverUserId)) throw new PosError('NOT_OWNER', 'dayo no longer lists this owner — use "เชื่อมใหม่ด้วยคีย์ใหม่"')
  const last = v.client.last_receipt_no
  checkKeyBelongsTo(device, last)
  await withNewKey(deps, target.apiKey, () => db.transaction(async (tx) => {
    await writeKey(tx, DAYO_KEYS.baseUrl, target.baseUrl)
    if (last !== null) await writeKey(tx, DAYO_KEYS.lastReceiptNo, last)
    await writeCatalogAnswer(tx, deps, v, answer) // api_state = ok, api_retry_at cleared
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'device', entityId: device.id, action: 'api_key_replaced', beforeJson: null, afterJson: { baseUrl: target.baseUrl, by: 'replaceApiKey' }, actorUserId: input.approverUserId, at: deps.now() }) // never the key
  }))
  deps.afterWrite?.()
}

/**
 * ruling N2: recovery is offered only when nobody here can approve with a PIN — no active owner with a PIN is left,
 * or the key was revoked (then the tablet cannot learn from dayo who is still an owner, so no local PIN is trusted).
 */
export async function ownerRecoveryAllowed(db: RemoteDb): Promise<boolean> {
  const owner = await db.select({ id: s.user.id }).from(s.user).where(and(eq(s.user.isActive, true), eq(s.user.role, 'owner'))).limit(1).get()
  return owner === undefined || (await readKey(db, DAYO_KEYS.apiState)) === 'unauthorized'
}

/**
 * ruling N2 — "เชื่อมใหม่ด้วยคีย์ใหม่". Proof of ownership is dayo's, not the tablet's: the owner signed in to the dayo
 * web with LINE, issued a NEW key and revoked the old one there. So: recovery must be allowed now, the key must differ
 * from the stored one, dayo must refuse the old key (401), and the new key must pass E1 and list the chosen person as
 * an active owner. There is no approver. The device, its receipt prefix, the bills and the outbox are untouched.
 */
export async function recoverOwner(db: RemoteDb, deps: ApiDeps, input: RecoverOwnerInput): Promise<void> {
  const target = checkedTarget(input)
  const device = await linkedDevice(db)
  const oldKey = await deps.secrets.getApiKey()
  if (oldKey === null || (await readKey(db, DAYO_KEYS.baseUrl)) === null) throw new PosError('NEEDS_SETUP', 'this device is not linked to dayo')
  if (!(await ownerRecoveryAllowed(db))) throw new PosError('RECOVERY_NOT_ALLOWED', 'an owner with a PIN can still approve — use replaceApiKey')
  if (target.apiKey === oldKey) throw new PosError('KEY_NOT_NEW', 'issue a new key on the dayo web')
  // the old key is asked at the dayo the new key belongs to (a stored base URL may be one a restored backup brought)
  const oldClient = createDayoClient({ baseUrl: target.baseUrl, apiKey: oldKey, fetch: deps.fetch, nowMs: () => Date.parse(deps.now()) })
  const oldRevoked = await oldClient.getCatalog(0).then(() => false, (e: unknown) => {
    if (!(e instanceof DayoError)) throw e
    if (e.failure.kind === 'unauthorized') return true
    if (e.failure.kind === 'forbidden') return false // the key still exists (a scope was removed) — not revoked
    throw new PosError('DAYO_UNREACHABLE', `could not confirm the old key is revoked (${e.failure.kind})`)
  })
  if (!oldRevoked) throw new PosError('OLD_KEY_STILL_ACTIVE', 'revoke the old key on the dayo web first')
  const answer = await fetchFullCatalog(deps, target)
  const v = answer.value
  const owner = activeOwners(v).find((o) => o.id === input.ownerStaffId)
  if (owner === undefined) throw new PosError('BAD_INPUT', 'เลือกเจ้าของจากรายชื่อระบบกลาง (owner ที่ใช้งานอยู่)')
  const last = v.client.last_receipt_no
  checkKeyBelongsTo(device, last)
  const pinHash = await hashPin(input.ownerPin, deps.pinCost) // slow: outside the transaction
  await withNewKey(deps, target.apiKey, () => db.transaction(async (tx) => {
    const at = deps.now()
    await writeKey(tx, DAYO_KEYS.baseUrl, target.baseUrl)
    if (last !== null) await writeKey(tx, DAYO_KEYS.lastReceiptNo, last)
    await writeCatalogAnswer(tx, deps, v, answer) // staff from dayo + api_state = ok
    await giveOwnerPin(tx, owner, pinHash, at)
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'user', entityId: owner.id, action: 'owner_recovered', beforeJson: null, afterJson: { staffId: owner.id, role: 'owner', by: 'recoverOwner' }, actorUserId: owner.id, at })
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'device', entityId: device.id, action: 'api_key_replaced', beforeJson: null, afterJson: { baseUrl: target.baseUrl, by: 'recoverOwner' }, actorUserId: owner.id, at }) // never the key
  }))
  deps.afterWrite?.()
}
