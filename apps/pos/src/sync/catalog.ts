import { and, eq, notInArray } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { PosOrderCatalog as PosOrderCatalogSchema, StaffEntry, UserRole, type PosCatalogLooseData, type Supported } from '@dayo/contracts'
import { toPricingCatalog, type PosOrderCatalog } from '@dayo/domain'
import vendor from '@dayo/dayo-pricing/VENDOR.json' with { type: 'json' }
import type { ApiDeps } from '../api/deps'
import { createDayoClient, DayoError, type DayoClient, type DayoFailure } from './dayo-client'
import { API_DISABLED_RETRY_MS, DAYO_KEYS, deleteKey, readKey, recordServerTime, writeKey } from './state'

export type SyncContext = { db: RemoteDb; deps: ApiDeps; serial: <T>(fn: () => Promise<T>) => Promise<T> }
export type StoredCatalog = { catalogVersion: number; catalog: PosOrderCatalog; staff: StaffEntry[]; client: { name: string; last_receipt_no: string | null } | null; fetchedAt: string }
export type CatalogPullResult = { outcome: 'changed' | 'unchanged' | 'catalog_rejected' | 'not_linked' | 'blocked' | 'failed'; failure?: DayoFailure }

export async function readDayoConfig(db: RemoteDb, deps: ApiDeps): Promise<{ baseUrl: string; apiKey: string } | null> {
  const baseUrl = await readKey(db, DAYO_KEYS.baseUrl)
  const apiKey = await deps.secrets.getApiKey()
  return baseUrl === null || apiKey === null ? null : { baseUrl, apiKey }
}

/**
 * The parsed catalog (~200 KB; recordSale reads it on every bill), cached per database handle and per
 * (catalog_version, fetched_at) — a rejected catalog (R12) rewrites staff/client but never these two, so staff and
 * client are parsed from the row on every read and never come from the cache.
 */
const catalogCache = new WeakMap<RemoteDb, { key: string; catalog: PosOrderCatalog }>()

/** The local copy of E1 (spec 04 §4.4). */
export async function readCatalog(db: RemoteDb): Promise<StoredCatalog | null> {
  const row = await db.select().from(s.dayoCatalog).where(eq(s.dayoCatalog.id, 'current')).get()
  if (!row) return null
  const key = `${row.catalogVersion}|${row.fetchedAt}`
  let hit = catalogCache.get(db)
  if (hit?.key !== key) {
    hit = { key, catalog: toPricingCatalog(PosOrderCatalogSchema.parse(row.catalogJson)) }
    catalogCache.set(db, hit)
  }
  return {
    catalogVersion: row.catalogVersion,
    catalog: hit.catalog,
    staff: StaffEntry.array().parse(row.staffJson), // zod through the contract (no zod dependency in @dayo/pos)
    client: (row.clientJson as StoredCatalog['client']) ?? null,
    fetchedAt: row.fetchedAt,
  }
}

export async function readSupported(db: RemoteDb): Promise<Supported | null> {
  const raw = await readKey(db, DAYO_KEYS.supportedJson)
  return raw === null ? null : (JSON.parse(raw) as Supported)
}

/** spec §4.4 rule 5: an empty name shows as "พนักงาน" + the last 4 characters of the id. */
export function staffDisplayName(e: StaffEntry): string {
  const n = e.display_name?.trim() ?? ''
  return n !== '' ? n : `พนักงาน ${e.id.slice(-4)}`
}
export function roleOf(raw: string): UserRole | null {
  const r = UserRole.safeParse(raw)
  return r.success ? r.data : null
}

/** spec §4.4 rule 9: only the file hashes decide — `commit` may be null (0049_pos_catalog.sql:303-305) and is kept as sent. */
function samePricing(files: Record<string, string>): boolean {
  const want = (vendor as { files: Record<string, string> }).files
  const a = Object.keys(want).sort()
  return JSON.stringify(a) === JSON.stringify(Object.keys(files).sort()) && a.every((k) => files[k] === want[k])
}

/**
 * dayo is the one writer of name/role/active; the PIN hash stays local (spec 04 §3, §6.5). No transaction of its own.
 * Review item 9: a list with no active owner is a dayo bug, not a decision — it is not applied (the caller records
 * catalogError), so the last owner with a PIN is never switched off by it (R12). Otherwise dayo's list wins at once
 * (controller ruling N2): an owner dayo deactivated or demoted loses owner rights here even when they were the last owner
 * with a PIN — the tablet then offers "เชื่อมใหม่ด้วยคีย์ใหม่" (`recoverOwner`, Task 11) instead of keeping a removed
 * owner's power.
 */
async function applyStaff(tx: RemoteDb, deps: ApiDeps, staff: StaffEntry[], at: string): Promise<'applied' | 'no_active_owner'> {
  if (!staff.some((e) => e.active && roleOf(e.role) === 'owner')) return 'no_active_owner'
  for (const e of staff) {
    const u = await tx.select().from(s.user).where(eq(s.user.id, e.id)).get()
    if (!u) continue // no PIN yet on this tablet → listed as "ต้องตั้ง PIN" (Task 11)
    const role = roleOf(e.role)
    const next = { displayName: staffDisplayName(e), role: role ?? u.role, isActive: e.active && role !== null } // ruling R10
    if (next.displayName === u.displayName && next.role === u.role && next.isActive === u.isActive) continue
    await tx.update(s.user).set({ ...next, updatedAt: at, version: u.version + 1 }).where(eq(s.user.id, u.id))
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'user', entityId: u.id, action: 'update', beforeJson: { displayName: u.displayName, role: u.role, isActive: u.isActive }, afterJson: { ...next, source: 'dayo' }, actorUserId: null, at })
  }
  // users dayo does not list (plan-3 owners with random ids, deleted staff) can no longer log in (ruling R7)
  const listed = staff.map((e) => e.id)
  const stale = await tx.select().from(s.user).where(and(eq(s.user.isActive, true), notInArray(s.user.id, listed))).all()
  for (const u of stale) {
    await tx.update(s.user).set({ isActive: false, updatedAt: at, version: u.version + 1 }).where(eq(s.user.id, u.id))
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'user', entityId: u.id, action: 'deactivate', beforeJson: { isActive: true }, afterJson: { isActive: false, source: 'dayo: not in the staff list' }, actorUserId: null, at })
  }
  return 'applied'
}

/** spec §6.3: 401/403 stop EVERY call to dayo (catalog, push, E3) until a new key; 404 waits for its retry time. */
export async function apiBlocked(db: RemoteDb, nowIso: string): Promise<boolean> {
  const state = await readKey(db, DAYO_KEYS.apiState)
  if (state === 'unauthorized' || state === 'forbidden') return true
  return state === 'disabled' && ((await readKey(db, DAYO_KEYS.apiRetryAt)) ?? '') > nowIso
}

/**
 * ruling R12: staff, supported_*, pricing and server_time are applied from EVERY answer; `catalog` is checked on its
 * own, and one the pricing code cannot read keeps the old copy (catalog_version unchanged, so the next pull asks again).
 * client.last_receipt_no is stored as sent — its shape is checked where it is used (Task 11/12).
 */
export async function writeCatalogAnswer(tx: RemoteDb, deps: ApiDeps, data: PosCatalogLooseData, timing: { sentAtMs: number; receivedAtMs: number }): Promise<'changed' | 'unchanged' | 'catalog_rejected'> {
  const at = deps.now()
  await recordServerTime(tx, data.server_time, timing.sentAtMs, timing.receivedAtMs, at)
  await writeKey(tx, DAYO_KEYS.pricingJson, JSON.stringify(data.pricing))
  await writeKey(tx, DAYO_KEYS.pricingMismatch, samePricing(data.pricing.files_sha256) ? '0' : '1')
  await writeKey(tx, DAYO_KEYS.supportedJson, JSON.stringify({ kinds: data.supported_kinds, fields: data.supported_fields }))
  await writeKey(tx, DAYO_KEYS.apiState, 'ok')
  await deleteKey(tx, DAYO_KEYS.apiRetryAt)
  await writeKey(tx, DAYO_KEYS.catalogCheckedAt, at)
  if (!data.changed) return 'unchanged'
  const problems: string[] = []
  if ((await applyStaff(tx, deps, data.staff, at)) === 'no_active_owner') problems.push('NO_ACTIVE_OWNER: the staff list from dayo has no active owner — not applied')
  const catalog = PosOrderCatalogSchema.safeParse(data.catalog)
  if (!catalog.success) {
    problems.push(`CATALOG_UNREADABLE: ${catalog.error.issues.slice(0, 3).map((i) => i.path.join('.')).join(', ')}`)
    // keep catalog_json / catalog_version; the staff copy used by "ต้องตั้ง PIN" follows dayo anyway
    await tx.update(s.dayoCatalog).set({ staffJson: data.staff, clientJson: data.client }).where(eq(s.dayoCatalog.id, 'current'))
  } else {
    const row = { id: 'current', catalogVersion: data.catalog_version, catalogJson: catalog.data, staffJson: data.staff, clientJson: data.client, fetchedAt: at }
    await tx.insert(s.dayoCatalog).values(row).onConflictDoUpdate({ target: s.dayoCatalog.id, set: { catalogVersion: row.catalogVersion, catalogJson: row.catalogJson, staffJson: row.staffJson, clientJson: row.clientJson, fetchedAt: at } })
  }
  if (problems.length > 0) await writeKey(tx, DAYO_KEYS.catalogError, problems.join(' · '))
  else await deleteKey(tx, DAYO_KEYS.catalogError)
  return catalog.success ? 'changed' : 'catalog_rejected'
}

export async function recordDayoFailure(db: RemoteDb, deps: ApiDeps, f: DayoFailure): Promise<void> {
  if (f.kind === 'unauthorized') await writeKey(db, DAYO_KEYS.apiState, 'unauthorized')
  else if (f.kind === 'forbidden') await writeKey(db, DAYO_KEYS.apiState, 'forbidden')
  else if (f.kind === 'api_disabled') {
    await writeKey(db, DAYO_KEYS.apiState, 'disabled')
    await writeKey(db, DAYO_KEYS.apiRetryAt, new Date(Date.parse(deps.now()) + API_DISABLED_RETRY_MS).toISOString())
  } else if (f.kind === 'bad_response') await writeKey(db, DAYO_KEYS.catalogError, f.message)
  // network / server / rate_limited: nothing to remember here — the scheduler backs off (Task 14)
}

export async function pullCatalog(ctx: SyncContext): Promise<CatalogPullResult> {
  const cfg = await ctx.serial(() => readDayoConfig(ctx.db, ctx.deps))
  if (cfg === null) return { outcome: 'not_linked' }
  if (await ctx.serial(() => apiBlocked(ctx.db, ctx.deps.now()))) return { outcome: 'blocked' } // review item 14
  // the version alone, straight from the row: a stored catalog this build can no longer parse must not stop the pull
  const known = await ctx.serial(async () => (await ctx.db.select({ v: s.dayoCatalog.catalogVersion }).from(s.dayoCatalog).where(eq(s.dayoCatalog.id, 'current')).get())?.v ?? 0)
  let client: DayoClient
  try {
    client = createDayoClient({ ...cfg, fetch: ctx.deps.fetch, nowMs: () => Date.parse(ctx.deps.now()) })
  } catch (e) {
    // Task 9 review note: a stored base URL the client refuses (a restored backup can carry one) throws synchronously —
    // a failed pull with nothing sent, never an exception out of the worker. The message never echoes the URL.
    return { outcome: 'failed', failure: { kind: 'network', message: e instanceof Error ? e.message : 'BAD_BASE_URL' } }
  }
  try {
    const r = await client.getCatalog(known) // network outside the serial queue
    return { outcome: await ctx.serial(() => ctx.db.transaction((tx) => writeCatalogAnswer(tx, ctx.deps, r.value, r))) }
  } catch (e) {
    if (!(e instanceof DayoError)) throw e
    await ctx.serial(() => recordDayoFailure(ctx.db, ctx.deps, e.failure))
    return { outcome: 'failed', failure: e.failure }
  }
}
