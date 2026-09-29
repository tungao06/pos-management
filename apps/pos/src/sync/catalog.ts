import { and, eq, notInArray } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { clipCodePoints, PosOrderCatalog as PosOrderCatalogSchema, PROMO_RULE_VERSIONS_KEY, StaffEntry, supportedOf, UserRole, type PosCatalogLooseData, type PosOrderCatalogParsed, type Supported } from '@dayo/contracts'
import { toPricingCatalog, type PosOrderCatalog } from '@dayo/domain'
import vendor from '@dayo/dayo-pricing/VENDOR.json' with { type: 'json' }
import type { ApiDeps } from '../api/deps'
import { createDayoClient, DayoError, type DayoClient, type DayoFailure } from './dayo-client'
import { checkCatalogRules, TABLET_PROMO_RULE_VERSION } from './promo-rules-stub'
import { API_DISABLED_RETRY_MS, backoffMs, DAYO_KEYS, deleteKey, extendRateLimit, MAX_BACKOFF_WAIT_MS, RATE_LIMIT_DEFAULT_MS, readKey, recordServerTime, writeKey } from './state'

export type SyncContext = { db: RemoteDb; deps: ApiDeps; serial: <T>(fn: () => Promise<T>) => Promise<T> }
export type StoredCatalog = { catalogVersion: number; catalog: PosOrderCatalog; staff: StaffEntry[]; client: { name: string; last_receipt_no: string | null } | null; fetchedAt: string }
/** 'backoff' (fix round 1 item 3): E1's own failure backoff, or a 429 Retry-After of this key, is still running — no request. */
export type CatalogPullResult = { outcome: 'changed' | 'unchanged' | 'catalog_rejected' | 'not_linked' | 'blocked' | 'backoff' | 'failed'; failure?: DayoFailure }

/**
 * Deliberately the raw `dayo.base_url` key, NOT `storedBaseUrl` (final review round flagged this as the same
 * anti-pattern as `isDayoLinked`'s — it is not: `isDayoLinked` gates whether the device counts as linked at all,
 * where a malformed stored URL must fall through to `connectShop`'s re-link path, not report "linked". Here the
 * raw value is passed on so `createDayoClient` (`./dayo-client.ts`) — which itself calls `normalizeBaseUrl` — is
 * what classifies a malformed-but-non-null URL as the specific `bad_base_url` failure (Task 9 review note, fix
 * round 1 item 3): a failed pull/push with no request sent, apiState `bad_base_url`, exempt from ordinary backoff,
 * pointing the owner at re-linking rather than a retry. Pre-filtering with `storedBaseUrl` here would turn that
 * into an undifferentiated `not_linked` and drop the dedicated diagnostic (`catalog-sync.test.ts`, `push.test.ts`).
 */
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The stored E1 `supported_*`, always through `supportedOf` (plan 10 T7): the current form `{kinds, fields, promoRuleVersions}`
 * and the form older builds stored — `{kinds, fields}` with dayo's raw `supported_fields`, where `fields` may carry
 * `promotion_rule_versions` (numbers) or any other non-list value. So `isRowSupported` never meets a non-array. Unreadable
 * JSON = null (no list: push waits for the next E1), never a throw.
 */
export async function readSupported(db: RemoteDb): Promise<Supported | null> {
  const raw = await readKey(db, DAYO_KEYS.supportedJson)
  if (raw === null) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!isRecord(parsed)) return null
  const kinds = Array.isArray(parsed.kinds) ? parsed.kinds.filter((k): k is string => typeof k === 'string') : []
  const fields: Record<string, unknown> = isRecord(parsed.fields) ? { ...parsed.fields } : {}
  if ('promoRuleVersions' in parsed) fields[PROMO_RULE_VERSIONS_KEY] = parsed.promoRuleVersions // the current form wins
  return supportedOf(kinds, fields)
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
  // users dayo does not list (plan-3 owners with random ids, deleted staff) can no longer log in (ruling R7) — the last
  // owner with a PIN included (ruling N2: the list has another active owner, checked above; recovery = recoverOwner, Task 11)
  const listed = staff.map((e) => e.id)
  const stale = await tx.select().from(s.user).where(and(eq(s.user.isActive, true), notInArray(s.user.id, listed))).all()
  for (const u of stale) {
    await tx.update(s.user).set({ isActive: false, updatedAt: at, version: u.version + 1 }).where(eq(s.user.id, u.id))
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'user', entityId: u.id, action: 'deactivate', beforeJson: { isActive: true }, afterJson: { isActive: false, source: 'dayo: not in the staff list' }, actorUserId: null, at })
  }
  return 'applied'
}

/**
 * spec §6.3: 401/403 stop EVERY call to dayo (catalog, push, E3) until a new key; 404 waits for its retry time.
 * task 14 item 2: a stored base URL the client refused (`bad_base_url`) is the same kind of stop — no request, no
 * backoff retry — until re-linking (connectShop / replaceApiKey / recoverOwner) writes api_state ok.
 */
export async function apiBlocked(db: RemoteDb, nowIso: string): Promise<boolean> {
  const state = await readKey(db, DAYO_KEYS.apiState)
  if (state === 'unauthorized' || state === 'forbidden' || state === 'bad_base_url') return true
  return state === 'disabled' && ((await readKey(db, DAYO_KEYS.apiRetryAt)) ?? '') > nowIso
}

/**
 * ruling R12: staff, supported_*, pricing and server_time are applied from EVERY answer; `catalog` is checked on its
 * own, and one the pricing code cannot read keeps the old copy (catalog_version unchanged, so the next pull asks again).
 * client.last_receipt_no is stored as sent — its shape is checked where it is used (Task 11/12).
 * Any answer that parses — unchanged included — ends an earlier BAD_RESPONSE; catalog/staff problems are only
 * re-judged by a `changed` answer (a refused catalog keeps the old version, so dayo keeps sending it).
 * plan 10 T7: supported_* is stored as `supportedOf(...)` (never the raw record) · a catalog that parses but whose
 * promotions the pricing engine cannot use (`checkCatalogRules`) is refused the same way — whole, never one promotion
 * dropped · `promoRuleVersion` = the promo_rule_version the answer was asked with, recorded (R6) only with an accepted catalog.
 */
export async function writeCatalogAnswer(tx: RemoteDb, deps: ApiDeps, data: PosCatalogLooseData, timing: { sentAtMs: number; receivedAtMs: number }, promoRuleVersion: number): Promise<'changed' | 'unchanged' | 'catalog_rejected'> {
  const at = deps.now()
  await recordServerTime(tx, data.server_time, timing.sentAtMs, timing.receivedAtMs, at)
  await writeKey(tx, DAYO_KEYS.pricingJson, JSON.stringify(data.pricing))
  await writeKey(tx, DAYO_KEYS.pricingMismatch, samePricing(data.pricing.files_sha256) ? '0' : '1') // Q6: strict, all 8 pinned files
  await writeKey(tx, DAYO_KEYS.supportedJson, JSON.stringify(supportedOf(data.supported_kinds, data.supported_fields)))
  await writeKey(tx, DAYO_KEYS.apiState, 'ok')
  await deleteKey(tx, DAYO_KEYS.apiRetryAt)
  await writeKey(tx, DAYO_KEYS.catalogCheckedAt, at)
  await deleteKey(tx, DAYO_KEYS.catalogFailStreak) // a 200 ends E1's failure backoff (not a 429's Retry-After — that runs out)
  await deleteKey(tx, DAYO_KEYS.catalogBackoffUntil)
  await deleteKey(tx, DAYO_KEYS.catalogBackoffReason)
  if (!data.changed) {
    if ((await readKey(tx, DAYO_KEYS.catalogError))?.startsWith(BAD_RESPONSE) === true) await deleteKey(tx, DAYO_KEYS.catalogError)
    return 'unchanged'
  }
  const problems: string[] = []
  if ((await applyStaff(tx, deps, data.staff, at)) === 'no_active_owner') problems.push('NO_ACTIVE_OWNER: the staff list from dayo has no active owner — not applied')
  const checked = checkCatalog(data.catalog)
  if (!checked.ok) {
    problems.push(`CATALOG_UNREADABLE: ${checked.problem}`)
    // keep catalog_json / catalog_version / catalog_rule_version; the staff copy used by "ต้องตั้ง PIN" follows dayo anyway
    await tx.update(s.dayoCatalog).set({ staffJson: data.staff, clientJson: data.client }).where(eq(s.dayoCatalog.id, 'current'))
  } else {
    const row = { id: 'current', catalogVersion: data.catalog_version, catalogJson: checked.catalog, staffJson: data.staff, clientJson: data.client, fetchedAt: at }
    await tx.insert(s.dayoCatalog).values(row).onConflictDoUpdate({ target: s.dayoCatalog.id, set: { catalogVersion: row.catalogVersion, catalogJson: row.catalogJson, staffJson: row.staffJson, clientJson: row.clientJson, fetchedAt: at } })
    await writeKey(tx, DAYO_KEYS.catalogRuleVersion, String(promoRuleVersion))
  }
  if (problems.length > 0) await writeKey(tx, DAYO_KEYS.catalogError, problems.join(' · '))
  else await deleteKey(tx, DAYO_KEYS.catalogError)
  return checked.ok ? 'changed' : 'catalog_rejected'
}

/**
 * Whether the tablet can price with this E1 `catalog`: the contract shape first (a refusal names the paths of the first
 * three issues), then the promotion rules (`checkCatalogRules` — the first three problems, 200 code points each).
 * Shared with setup (api/connect.ts), which has no old catalog to keep and refuses the key test instead.
 */
export function checkCatalog(raw: unknown): { ok: true; catalog: PosOrderCatalogParsed } | { ok: false; problem: string } {
  const parsed = PosOrderCatalogSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, problem: parsed.error.issues.slice(0, 3).map((i) => i.path.join('.')).join(', ') }
  const rules = checkCatalogRules(toPricingCatalog(parsed.data))
  return rules.length === 0 ? { ok: true, catalog: parsed.data } : { ok: false, problem: rules.slice(0, 3).map((p) => clipCodePoints(p, 200)).join(', ') }
}

/** Prefix of a catalogError that came from an answer breaking the contract (not from its catalog or staff). */
export const BAD_RESPONSE = 'BAD_RESPONSE'

export async function recordDayoFailure(db: RemoteDb, deps: ApiDeps, f: DayoFailure): Promise<void> {
  if (f.kind === 'unauthorized') await writeKey(db, DAYO_KEYS.apiState, 'unauthorized')
  else if (f.kind === 'forbidden') await writeKey(db, DAYO_KEYS.apiState, 'forbidden')
  else if (f.kind === 'api_disabled') {
    await writeKey(db, DAYO_KEYS.apiState, 'disabled')
    await writeKey(db, DAYO_KEYS.apiRetryAt, new Date(Date.parse(deps.now()) + API_DISABLED_RETRY_MS).toISOString())
  } else if (f.kind === 'bad_base_url') await writeKey(db, DAYO_KEYS.apiState, 'bad_base_url')
  else if (f.kind === 'bad_response') await writeKey(db, DAYO_KEYS.catalogError, `${BAD_RESPONSE}: ${f.message}`)
  // network / timeout / server / rate_limited: E1's backoff is recorded by pullCatalog (recordCatalogBackoff); E2 has its own
}

/** The time left on a stored backoff; an unreadable or out-of-range value (a restored backup) waits the default 60 s. */
async function backoffLeft(db: RemoteDb, key: string, nowIso: string): Promise<number> {
  const until = await readKey(db, key)
  if (until === null) return 0
  const left = Date.parse(until) - Date.parse(nowIso)
  if (Number.isFinite(left) && left <= MAX_BACKOFF_WAIT_MS) return left
  await writeKey(db, key, new Date(Date.parse(nowIso) + RATE_LIMIT_DEFAULT_MS).toISOString())
  return RATE_LIMIT_DEFAULT_MS
}

/** A 429 from E1 or E2 is for the whole key (dayo counts every route together): it holds E1, E2 and E3 alike. */
export async function rateLimitLeft(db: RemoteDb, nowIso: string): Promise<number> {
  if ((await readKey(db, DAYO_KEYS.pushBackoffReason)) !== 'rate_limited') return 0
  return backoffLeft(db, DAYO_KEYS.pushBackoffUntil, nowIso)
}

/** fix round 1 item 3: E1 backs off on its own failures (5 s … 15 min, like spec §6.3) and on a 429 of the key. */
async function recordCatalogBackoff(db: RemoteDb, deps: ApiDeps, f: DayoFailure): Promise<void> {
  const now = deps.now()
  if (f.kind === 'rate_limited') {
    await extendRateLimit(db, new Date(Date.parse(now) + Math.min(f.retryAfterMs, MAX_BACKOFF_WAIT_MS)).toISOString()) // never shortens (M1)
    return
  }
  if (f.kind !== 'network' && f.kind !== 'timeout' && f.kind !== 'server' && f.kind !== 'bad_response') return // refusals: apiBlocked
  const streak = Number((await readKey(db, DAYO_KEYS.catalogFailStreak)) ?? '0') + 1
  await writeKey(db, DAYO_KEYS.catalogFailStreak, String(streak))
  await writeKey(db, DAYO_KEYS.catalogBackoffUntil, new Date(Date.parse(now) + backoffMs(streak, deps.random)).toISOString())
  await writeKey(db, DAYO_KEYS.catalogBackoffReason, f.kind === 'network' ? 'network' : 'failure')
}

export async function pullCatalog(ctx: SyncContext): Promise<CatalogPullResult> {
  const cfg = await ctx.serial(() => readDayoConfig(ctx.db, ctx.deps))
  if (cfg === null) return { outcome: 'not_linked' }
  if (await ctx.serial(() => apiBlocked(ctx.db, ctx.deps.now()))) return { outcome: 'blocked' } // review item 14
  // fix round 1 item 3: a 429 of this key, or E1's own failure backoff, holds every caller — "ส่งตอนนี้" included
  const waiting = await ctx.serial(async () => {
    const now = ctx.deps.now()
    if ((await rateLimitLeft(ctx.db, now)) > 0 || (await backoffLeft(ctx.db, DAYO_KEYS.catalogBackoffUntil, now)) > 0) return true
    await writeKey(ctx.db, DAYO_KEYS.catalogAttemptAt, now) // the scheduler's 5-minute rhythm counts from the attempt
    return false
  })
  if (waiting) return { outcome: 'backoff' }
  // the version alone, straight from the row: a stored catalog this build can no longer parse must not stop the pull ·
  // plan 10 R6: a catalog asked with another promo_rule_version (or before plan 10 recorded one) is asked for in full —
  // dayo's answer depends on the parameter while catalog_version does not, so known_version alone would get changed:false
  const rules = TABLET_PROMO_RULE_VERSION
  const known = await ctx.serial(async () => {
    const v = (await ctx.db.select({ v: s.dayoCatalog.catalogVersion }).from(s.dayoCatalog).where(eq(s.dayoCatalog.id, 'current')).get())?.v ?? 0
    return (await readKey(ctx.db, DAYO_KEYS.catalogRuleVersion)) === String(rules) ? v : 0
  })
  let client: DayoClient
  try {
    client = createDayoClient({ ...cfg, fetch: ctx.deps.fetch, nowMs: () => Date.parse(ctx.deps.now()) })
  } catch (e) {
    // Task 9 review note: a stored base URL the client refuses (a restored backup can carry one) throws synchronously —
    // a failed pull with nothing sent, never an exception out of the worker. Its own failure and apiState, not
    // 'network': backing off cannot fix it, the owner must re-link. The message never echoes the URL.
    const failure: DayoFailure = { kind: 'bad_base_url', message: e instanceof Error ? e.message : 'BAD_BASE_URL' }
    await ctx.serial(() => recordDayoFailure(ctx.db, ctx.deps, failure))
    return { outcome: 'failed', failure }
  }
  try {
    const r = await client.getCatalog(known, rules) // network outside the serial queue
    return { outcome: await ctx.serial(() => ctx.db.transaction((tx) => writeCatalogAnswer(tx, ctx.deps, r.value, r, rules))) }
  } catch (e) {
    if (!(e instanceof DayoError)) throw e
    await ctx.serial(async () => { await recordDayoFailure(ctx.db, ctx.deps, e.failure); await recordCatalogBackoff(ctx.db, ctx.deps, e.failure) })
    return { outcome: 'failed', failure: e.failure }
  }
}
