import { and, asc, count, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { KIND_SCOPE, PUSH_KINDS, SHIFT_LANE_KINDS, type DetailPrefix, type PushKind } from '@dayo/contracts'
import { TABLET_PROMO_RULE_VERSION } from '@dayo/domain'
import { readCatalog, readSupported } from '../sync/catalog'
import { maskApiKey } from '../sync/secret-store'
import { isHeld, SCOPE_CLOSABLE_AFTER_MS, SCOPE_RED_AFTER_MS } from '../sync/push'
import { CLOCK_WARN_MS, DAYO_KEYS, decodeLastError, readKey, type ApiState } from '../sync/state'
import { isBackupDue, lastBackupAt, lastBackupZId } from './backup'
import { readCentralZ } from './central-z'
import { isDayoLinked, ownerRecoveryAllowed, storedBaseUrl } from './connect'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { hintFor, isShiftConflict } from './problem-rules'
import { staffNeedingPin } from './staff'
import type { BootstrapState, DeviceDto, PromoSupportDto, ShiftDto, SyncStatusDto, UserDto, WaitingZDto } from './types'

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
  return row ? { id: row.id, businessDate: row.businessDate, openedAt: row.openedAt, openedBy: row.openedBy, openingFloatSatang: row.openingFloatSatang, syncMode: row.syncMode } : null
}

/** D101 · R2: the shift of this device after "นับเสร็จ" whose count is not confirmed yet (at most one — shift_counting_uq). */
export async function countingShiftOf(db: RemoteDb, deviceId: string): Promise<{ shiftId: string; countedAt: string } | null> {
  const r = await db.select({ shiftId: s.shift.id, countedAt: s.shift.countedAt }).from(s.shift).where(and(eq(s.shift.deviceId, deviceId), eq(s.shift.status, 'counting'))).get()
  return r === undefined || r.countedAt === null ? null : { shiftId: r.shiftId, countedAt: r.countedAt }
}

/** D68 · spec §6.8: counted shifts of this device with no Z yet ("ใบปิดกะ <วันที่> รอออนไลน์"), oldest count first (R7). */
export async function waitingZs(db: RemoteDb, deviceId: string): Promise<WaitingZDto[]> {
  const rows = await db
    .select({ shiftId: s.shift.id, businessDate: s.shift.businessDate, countedAt: s.shift.countedAt, syncMode: s.shift.syncMode, countedSatang: s.cashCount.countedSatang })
    .from(s.shift)
    .innerJoin(s.cashCount, eq(s.cashCount.shiftId, s.shift.id))
    .where(and(eq(s.shift.deviceId, deviceId), eq(s.shift.status, 'counted'), isNotNull(s.shift.countedAt)))
    .orderBy(asc(s.shift.countedAt), asc(s.shift.id))
    .all()
  return rows.map((r) => ({ shiftId: r.shiftId, businessDate: r.businessDate, countedAt: r.countedAt!, syncMode: r.syncMode, countedSatang: r.countedSatang }))
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
 * What one "ยังไม่ส่ง" / "มีปัญหา" item is (D50 Q3-26 · spec 04 §6.1, §12): a bill-lane row counts by its bill
 * (`pos_order_id` — an order, its order_void and an off-catalog replacement are ONE bill); a shift-lane row counts on
 * its own key (one per shift_open / cash_movement / cash_count / shift_close).
 */
const SYNC_ITEM = sql`case when table_name in ('shift_open', 'cash_movement', 'cash_count', 'shift_close') then idempotency_key else json_extract(row_json, '$.pos_order_id') end`
const SYNC_ITEM_KINDS = sql`table_name in ('order', 'order_void', 'order_off_catalog', 'shift_open', 'cash_movement', 'cash_count', 'shift_close')`

/**
 * The "ยังไม่ส่ง N รายการ" badge (D50 Q3-26): pending rows only — local_only (shifts that never reach dayo, block-2
 * shift/Z rows), closed_off_catalog, sent and dead rows never count; stock is not queued at all.
 */
export async function countPendingSyncItems(db: RemoteDb): Promise<number> {
  const r = await db.values<[number]>(sql`select count(distinct ${SYNC_ITEM}) from outbox where status = 'pending' and ${SYNC_ITEM_KINDS}`)
  return r[0]?.[0] ?? 0
}

/**
 * Items with a dead E2 row (dayo refused it for good, or it was stuck) — the "มีปัญหา" count of spec §12, shift-lane rows
 * included (Task 14 · carried item 2). One problem per ROOT cause: a row parked PARENT_REJECTED is counted through its dead
 * parent, never on its own (a rejected shift_open with its cash rows = 1).
 */
export async function countSyncProblems(db: RemoteDb): Promise<number> {
  const r = await db.values<[number]>(sql`select count(distinct ${SYNC_ITEM}) from outbox where status = 'dead' and ${SYNC_ITEM_KINDS} and not (json_valid(last_error) and json_extract(last_error, '$.reason') = 'PARENT_REJECTED')`)
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
  const farAhead = await db.values<[number]>(sql`select count(distinct ${SYNC_ITEM}) from outbox where status = 'pending' and ${SYNC_ITEM_KINDS} and json_valid(last_error) and json_extract(last_error, '$.farAhead') = 1`)
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
    pendingSyncRows: await countPendingSyncItems(db),
    problemSyncRows: await countSyncProblems(db),
    oldestPendingAt: oldest?.createdAt ?? null,
    pendingOver24h: oldest !== undefined && now - Date.parse(oldest.createdAt) > PENDING_WARN_AFTER_MS,
    priceDiffBills: diff?.n ?? 0,
    clockFarAheadBills: farAhead[0]?.[0] ?? 0,
    scopeWait: await scopeWaitOf(db, now),
    shiftDataConflict: await hasShiftDataConflict(db),
    shiftLaneHeld: await shiftLaneHeldOf(db),
    centralMismatchBills: (await db.values<[number]>(sql`select count(*) from "order" where central_mismatch_json is not null`))[0]?.[0] ?? 0,
  }
}

/**
 * Task 14 (spec §6.2 m1 · R14): the row waiting longest for a scope this key lacks (FORBIDDEN scope: — pending, retried every
 * 15 min): yellow at once, red after 24 h, "ปิดไว้ในเครื่อง" after 7 days.
 */
async function scopeWaitOf(db: RemoteDb, nowMs: number): Promise<NonNullable<SyncStatusDto['scopeWait']> | null> {
  const rows = await db.select({ kind: s.outbox.tableName, lastError: s.outbox.lastError }).from(s.outbox)
    .where(and(eq(s.outbox.status, 'pending'), inArray(s.outbox.tableName, [...PUSH_KINDS]), sql`json_valid(${s.outbox.lastError}) and json_extract(${s.outbox.lastError}, '$.prefix') = 'scope:'`)).all()
  let oldest: { kind: PushKind; since: string } | null = null
  for (const r of rows) {
    const since = decodeLastError(r.lastError).scopeSince
    if (since === undefined || !(PUSH_KINDS as readonly string[]).includes(r.kind)) continue
    if (oldest === null || Date.parse(since) < Date.parse(oldest.since)) oldest = { kind: r.kind as PushKind, since }
  }
  if (oldest === null) return null
  const waited = nowMs - Date.parse(oldest.since)
  return { scope: KIND_SCOPE[oldest.kind], since: oldest.since, red: waited > SCOPE_RED_AFTER_MS, closable: waited >= SCOPE_CLOSABLE_AFTER_MS }
}

/** The moment the key was last replaced on this tablet (audit_log api_key_replaced), or null. */
export async function lastKeyReplaceAt(db: RemoteDb): Promise<string | null> {
  return (await db.values<[string | null]>(sql`select max(at) from audit_log where action = 'api_key_replaced'`))[0]?.[0] ?? null
}
/** The shifts whose rows began under a key replaced since (carried item 7). */
export async function shiftsBeforeKeyReplace(db: RemoteDb, shiftIds: readonly string[]): Promise<Set<string>> {
  const replaced = await lastKeyReplaceAt(db)
  if (replaced === null || shiftIds.length === 0) return new Set()
  const rows = await db.select({ id: s.shift.id, openedAt: s.shift.openedAt }).from(s.shift).where(inArray(s.shift.id, [...new Set(shiftIds)])).all()
  return new Set(rows.filter((r) => Date.parse(r.openedAt) < Date.parse(replaced)).map((r) => r.id))
}

/**
 * Task 14 fix round 1 item 3 (carried item 6): the strict shift lane stopped behind a row that will not go by itself — dayo
 * does not support it (UNSUPPORTED / not in E1) or it is > 24 h ahead of dayo's clock (N5). `rows` = that row and every
 * pending shift-lane row after it · `blockingKey` = the row to close ("ปิดไว้ในเครื่อง" on the problems page).
 */
async function shiftLaneHeldOf(db: RemoteDb): Promise<NonNullable<SyncStatusDto['shiftLaneHeld']> | null> {
  const rows = await db.select().from(s.outbox)
    .where(and(eq(s.outbox.status, 'pending'), inArray(s.outbox.tableName, [...SHIFT_LANE_KINDS]))).orderBy(asc(s.outbox.createdAt), asc(sql`rowid`)).all()
  if (rows.length === 0) return null
  const sup = await readSupported(db)
  const at = rows.findIndex((r) => decodeLastError(r.lastError).farAhead === true || (sup !== null && isHeld(r, sup)))
  if (at < 0) return null
  const r = rows[at]!
  return { rows: rows.length - at, blockingKey: r.idempotencyKey, reason: decodeLastError(r.lastError).farAhead === true ? 'clock' : 'unsupported' }
}

/**
 * Task 14 (S5 · R5-2 · preflight D7): a dead shift-lane row whose verdict says someone else's data is under this key —
 * the red bar "ข้อมูลกะชนกับระบบกลาง — ตรวจกุญแจเครื่อง". A shift begun under a key the owner replaced since is not that
 * (carried item 7 — hint key_replaced on the problems page).
 */
async function hasShiftDataConflict(db: RemoteDb): Promise<boolean> {
  const rows = await db.select({ kind: s.outbox.tableName, lastError: s.outbox.lastError, rowJson: s.outbox.rowJson }).from(s.outbox)
    .where(and(eq(s.outbox.status, 'dead'), inArray(s.outbox.tableName, [...SHIFT_LANE_KINDS]))).all()
  const conflicts = rows.map((r) => ({ r, e: decodeLastError(r.lastError) })).filter(({ e }) => isShiftConflict(e.reason, (e.prefix as DetailPrefix | undefined) ?? null))
  if (conflicts.length === 0) return false
  const shiftIds = conflicts.map(({ r }) => (r.rowJson as { shift_id?: unknown }).shift_id).filter((x): x is string => typeof x === 'string')
  const old = await shiftsBeforeKeyReplace(db, shiftIds)
  return conflicts.some(({ r, e }) => {
    const hint = hintFor({ kind: r.kind as PushKind, dead: true, reason: e.reason, prefix: (e.prefix as DetailPrefix | undefined) ?? null, shiftOpenedBeforeKeyReplace: old.has(String((r.rowJson as { shift_id?: unknown }).shift_id)) })
    return hint === 'shift_conflict'
  })
}

/** plan 10 §0.2 (T7): what the last stored E1 `supported_*` says about promotions — none before any E1. */
export async function promoSupport(db: RemoteDb): Promise<PromoSupportDto> {
  const sup = await readSupported(db)
  if (sup === null) return { manualSupported: false, ruleBehind: false, ruleVersions: [] }
  return {
    manualSupported: ['manual_promotion_ids', 'manual_promotion_reason'].every((f) => sup.fields.order?.includes(f) ?? false), // the row sends both keys
    ruleBehind: sup.promoRuleVersions.some((v) => v > TABLET_PROMO_RULE_VERSION),
    ruleVersions: [...sup.promoRuleVersions],
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
    return { needsSetup: true, device: null, users: [], openShift: null, pendingSyncItems: 0, lastBackupAt: null, backupDue: false, legacyDevice: false, dayoLinked: false, dayoBaseUrl, staffNeedingPin: [], ownerRecovery: false, sync: await syncStatus(db, deps), countingShift: null, zWaiting: [], centralLastZNo: null, promo: await promoSupport(db) }
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
    legacyDevice: !dayoLinked, // a device row without a dayo link = set up before block 2's dayo connect flow (ruling R7)
    dayoLinked,
    dayoBaseUrl,
    staffNeedingPin: dayoLinked ? await staffNeedingPin(db) : [],
    ownerRecovery: dayoLinked && (await ownerRecoveryAllowed(db)),
    sync: await syncStatus(db, deps),
    countingShift: await countingShiftOf(db, device.id),
    zWaiting: await waitingZs(db, device.id),
    centralLastZNo: (await readCentralZ(db))?.lastZNo ?? null,
    promo: await promoSupport(db),
  }
}
