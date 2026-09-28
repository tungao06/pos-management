import { and, asc, count, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { PUSH_KINDS } from '@dayo/contracts'
import { readCatalog } from '../sync/catalog'
import { maskApiKey } from '../sync/secret-store'
import { CLOCK_WARN_MS, DAYO_KEYS, readKey, type ApiState } from '../sync/state'
import { isBackupDue, lastBackupAt, lastBackupZId } from './backup'
import { isDayoLinked, ownerRecoveryAllowed, storedBaseUrl } from './connect'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { staffNeedingPin } from './staff'
import type { BootstrapState, DeviceDto, ShiftDto, SyncStatusDto, UserDto } from './types'

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

/** D80: a CLOCK_AHEAD answer keeps the clock warning up this long. */
export const CLOCK_AHEAD_WARN_FOR_MS = 3_600_000
/** spec §10.5: a bill waiting longer than this shows the "ของค้าง" warning (dayo refuses sale_date older than 60 days). */
export const PENDING_WARN_AFTER_MS = 86_400_000
const API_STATES: ReadonlySet<string> = new Set<ApiState>(['ok', 'unauthorized', 'forbidden', 'disabled', 'bad_base_url'])

/** pricing.commit of the last E1 answer (stored as sent — spec §4.4 rule 9); null when unknown or unreadable. */
function pricingCommitOf(raw: string | null): string | null {
  if (raw === null) return null
  try {
    const commit = (JSON.parse(raw) as { commit?: unknown } | null)?.commit
    return typeof commit === 'string' ? commit : null
  } catch {
    return null
  }
}

/**
 * Task 14: the health of the dayo link for bootstrap and the status screen (spec 04 §4.3, §6.7, §10.5 · D80).
 * Offline the server time is unknown: the skew is the last one measured (spec §6.7). The key itself never leaves
 * here — only its masked form.
 */
export async function syncStatus(db: RemoteDb, deps: ApiDeps): Promise<SyncStatusDto> {
  const now = Date.parse(deps.now())
  const key = await deps.secrets.getApiKey()
  const baseUrl = await storedBaseUrl(db) // M3: never the raw column — a restored backup may carry a URL the tablet refuses
  const skewRaw = await readKey(db, DAYO_KEYS.clockSkewMs)
  const skew = skewRaw === null || !Number.isFinite(Number(skewRaw)) ? null : Number(skewRaw)
  const aheadAt = Date.parse((await readKey(db, DAYO_KEYS.clockAheadAt)) ?? '')
  const state = await readKey(db, DAYO_KEYS.apiState)
  const oldest = await db.select({ createdAt: s.outbox.createdAt }).from(s.outbox)
    .where(and(eq(s.outbox.status, 'pending'), inArray(s.outbox.tableName, [...PUSH_KINDS]))).orderBy(asc(s.outbox.createdAt)).limit(1).get()
  const diff = await db.select({ n: count() }).from(s.order)
    .where(and(isNotNull(s.order.centralComputedTotalSatang), ne(s.order.centralComputedTotalSatang, s.order.totalSatang))).get()
  const farAhead = await db.values<[number]>(sql`select count(distinct json_extract(row_json, '$.pos_order_id')) from outbox where status = 'pending' and table_name in ('order', 'order_void') and json_extract(last_error, '$.farAhead') = 1`)
  const version = await db.select({ v: s.dayoCatalog.catalogVersion }).from(s.dayoCatalog).where(eq(s.dayoCatalog.id, 'current')).get()
  return {
    linked: key !== null && baseUrl !== null,
    apiState: state !== null && API_STATES.has(state) ? (state as ApiState) : null,
    maskedKey: key === null ? null : maskApiKey(key),
    baseUrl,
    clockSkewMs: skew,
    clockWarning: (skew !== null && Math.abs(skew) > CLOCK_WARN_MS) || (Number.isFinite(aheadAt) && now - aheadAt < CLOCK_AHEAD_WARN_FOR_MS),
    pricingMismatch: (await readKey(db, DAYO_KEYS.pricingMismatch)) === '1',
    pricingCommit: pricingCommitOf(await readKey(db, DAYO_KEYS.pricingJson)),
    catalogVersion: version?.v ?? null, // the column only: bootstrap must not parse the ~200 KB catalog
    catalogCheckedAt: await readKey(db, DAYO_KEYS.catalogCheckedAt),
    catalogError: await readKey(db, DAYO_KEYS.catalogError),
    lastPushAt: await readKey(db, DAYO_KEYS.lastPushAt),
    pendingBills: await countPendingSyncItems(db),
    problemBills: await countSyncProblems(db),
    oldestPendingAt: oldest?.createdAt ?? null,
    pendingOver24h: oldest !== undefined && now - Date.parse(oldest.createdAt) > PENDING_WARN_AFTER_MS,
    priceDiffBills: diff?.n ?? 0,
    clockFarAheadBills: farAhead[0]?.[0] ?? 0,
  }
}

export async function bootstrap(db: RemoteDb, deps: ApiDeps): Promise<BootstrapState> {
  const dayoLinked = await isDayoLinked(db, deps)
  // Not a secret (controller ruling R1): read regardless of `dayoLinked` so a device whose key was revoked or
  // cleared, but whose address is still stored, can still offer a locked address on the recovery screen.
  // M3 (fix round 1 round 2, security): the normalized `storedBaseUrl` — never the raw column — so the UI shows
  // null in exactly the cases `replaceApiKey`/`recoverOwner` themselves would refuse (e.g. a corrupt stored value).
  const dayoBaseUrl = await storedBaseUrl(db)
  if ((await localDeviceId(db)) === null) {
    return { needsSetup: true, device: null, users: [], openShift: null, pendingSyncItems: 0, lastBackupAt: null, backupDue: false, legacyDevice: false, dayoLinked: false, dayoBaseUrl, staffNeedingPin: [], ownerRecovery: false, sync: await syncStatus(db, deps) }
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
    sync: await syncStatus(db, deps),
  }
}
