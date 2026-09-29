import { eq, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { clipCodePoints, DETAIL_PREFIXES } from '@dayo/contracts'

/** Every sync_state key of block 2 — local only, never in the outbox, no secret among them (the key is in IndexedDB). */
export const DAYO_KEYS = {
  baseUrl: 'dayo.base_url',
  apiState: 'dayo.api_state',
  apiRetryAt: 'dayo.api_retry_at',
  clockSkewMs: 'dayo.clock_skew_ms',
  clockMeasuredAt: 'dayo.clock_measured_at',
  clockAheadAt: 'dayo.clock_ahead_at',
  pricingJson: 'dayo.pricing_json',
  pricingMismatch: 'dayo.pricing_mismatch',
  supportedJson: 'dayo.supported_json',
  lastReceiptNo: 'dayo.last_receipt_no',
  catalogCheckedAt: 'dayo.catalog_checked_at',
  catalogError: 'dayo.catalog_error',
  pushFailStreak: 'dayo.push_fail_streak',
  pushBackoffUntil: 'dayo.push_backoff_until',
  // 'network' (offline — an online wake may forget it) | 'failure' (timeout / 5xx / unreadable 200 — only a manual, open or
  // before_close wake, at most once per 30 s) | 'rate_limited' (a 429 from E1 or E2 — per key, never cleared: it runs out)
  pushBackoffReason: 'dayo.push_backoff_reason',
  pushSingleThrough: 'dayo.push_single_through', // R4: {ids} of the rows of the batch that failed (task 13 fix round 1)
  pushServerStreak: 'dayo.push_server_streak',   // consecutive 5xx / unreadable 200 — enters R4; network failures do not count (m3)
  // E1's own failure backoff (fix round 1 item 3) — a 429 on E1 goes to push_backoff_* ('rate_limited'), shared per key
  catalogAttemptAt: 'dayo.catalog_attempt_at',     // the last E1 request, answered or not (catalog_checked_at = the last good one)
  catalogFailStreak: 'dayo.catalog_fail_streak',
  catalogBackoffUntil: 'dayo.catalog_backoff_until',
  catalogBackoffReason: 'dayo.catalog_backoff_reason', // 'network' | 'failure', as push_backoff_reason
  manualClearAt: 'dayo.manual_clear_at',           // N4: the last time a wake cleared a failure backoff (survives a reload)
  requestWindow: 'dayo.request_window',            // the wall times of the dayo requests of the last 60 s (survives a reload)
  lastPushAt: 'dayo.last_push_at',
  // Task 15: refreshDayoEdits' mark — E3 updated_since (absent = the device's setup time) — and its backward walk over
  // full pages, kept between refreshes (fix round 1 item 1)
  dayoEditsSince: 'dayo.dayo_edits_since',
  dayoEditsWalk: 'dayo.dayo_edits_walk',
  // Task 13 · ruling R9: dayo's E1 client.last_z_* — written ONLY by connectShop / replaceApiKey / recoverOwner (never the
  // periodic E1); all three or none (api/central-z.ts)
  lastZNo: 'dayo.last_z_no',
  lastZHash: 'dayo.last_z_hash',
  lastZUntil: 'dayo.last_z_until',
  lastZContinued: 'dayo.last_z_continued', // fix round 1: last_z_no a Z of this device has already continued (used once)
} as const
export type ApiState = 'ok' | 'unauthorized' | 'forbidden' | 'disabled' | 'bad_base_url'

export const CLOCK_WARN_MS = 5 * 60_000            // D80
/** dayo's own tolerance for a device time ahead of its clock (0066: `v_at > now() + interval '5 minutes'`). */
export const DAYO_AHEAD_TOLERANCE_MS = 5 * 60_000
export const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000, 900_000] as const // spec §6.3
export const STUCK_AFTER_ATTEMPTS = 50
export const API_DISABLED_RETRY_MS = 15 * 60_000
export const RATE_LIMIT_DEFAULT_MS = 60_000
export const NO_ANSWER_RETRY_MS = 60_000
/** D106: a measured clock skew is used for the same-day void rule only this long after it was measured. */
export const SKEW_FRESH_MS = 15 * 60_000
/** The longest wait a stored backoff may still have: the last step + 20 % jitter. Anything longer is not trusted. */
export const MAX_BACKOFF_WAIT_MS = Math.round(BACKOFF_MS[BACKOFF_MS.length - 1]! * 1.2)

export async function readKey(db: RemoteDb, key: string): Promise<string | null> {
  return (await db.select().from(s.syncState).where(eq(s.syncState.key, key)).get())?.value ?? null
}
export async function writeKey(db: RemoteDb, key: string, value: string): Promise<void> {
  await db.insert(s.syncState).values({ key, value }).onConflictDoUpdate({ target: s.syncState.key, set: { value: sql`excluded.value` } })
}
export async function deleteKey(db: RemoteDb, key: string): Promise<void> {
  await db.delete(s.syncState).where(eq(s.syncState.key, key))
}

/**
 * A 429 of the key (E1 or E2): the shared backoff becomes 'rate_limited' — until the LATER of the one already set and
 * this one, so a short Retry-After never shortens a longer wait (final review M1).
 */
export async function extendRateLimit(db: RemoteDb, untilIso: string): Promise<void> {
  const current = Date.parse((await readKey(db, DAYO_KEYS.pushBackoffUntil)) ?? '')
  if (!(Number.isFinite(current) && current > Date.parse(untilIso))) await writeKey(db, DAYO_KEYS.pushBackoffUntil, untilIso)
  await writeKey(db, DAYO_KEYS.pushBackoffReason, 'rate_limited')
}

/** attempt 1 → 5 s … attempt ≥ 5 → 15 min, ±20 % (spec §6.3). `random` in [0, 1). */
export function backoffMs(attempt: number, random: () => number): number {
  const base = BACKOFF_MS[Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1]!
  return Math.round(base * (0.8 + 0.4 * random()))
}

/** Server clock minus device clock, measured at the midpoint of the request. */
export function skewMs(serverTimeIso: string, sentAtMs: number, receivedAtMs: number): number {
  return Date.parse(serverTimeIso) - Math.round((sentAtMs + receivedAtMs) / 2)
}
/**
 * D106: dayo's time as this tablet can estimate it at `deviceNowIso` (epoch ms), or null when no skew counts now. A measured
 * skew counts only while fresh — measured at most SKEW_FRESH_MS before the device's now. A NEGATIVE age means the clock was
 * set back after the measurement (final review I1): the device's now is then not trusted at all — the estimate is frozen at
 * the server time of the measurement (measured_at + skew), which real time can only have passed. Shared by the same-day
 * void rule (voidInstant), the far-ahead count rule (rows.ts) and E4's "window closed" check (bot-cash.ts).
 */
export async function estimatedServerMs(db: RemoteDb, deviceNowIso: string): Promise<number | null> {
  const skewRaw = await readKey(db, DAYO_KEYS.clockSkewMs)
  const skew = skewRaw === null ? Number.NaN : Number(skewRaw)
  const measuredAt = Date.parse((await readKey(db, DAYO_KEYS.clockMeasuredAt)) ?? '')
  const deviceNow = Date.parse(deviceNowIso)
  const age = deviceNow - measuredAt
  if (!Number.isFinite(skew) || !Number.isFinite(age) || age > SKEW_FRESH_MS) return null
  return age < 0 ? measuredAt + skew : deviceNow + skew
}

export async function recordServerTime(db: RemoteDb, serverTimeIso: string, sentAtMs: number, receivedAtMs: number, nowIso: string): Promise<void> {
  await writeKey(db, DAYO_KEYS.clockSkewMs, String(skewMs(serverTimeIso, sentAtMs, receivedAtMs)))
  await writeKey(db, DAYO_KEYS.clockMeasuredAt, nowIso)
}

/** outbox.last_error is JSON (plan 5 I-12); the detail is clipped by code points so the JSON stays whole. */
/**
 * requestFailed: the row was part of a request that failed (a provisional charge or its refund) — not a trusted probe.
 * ownFailures: requests that carried only this row and failed (5xx / unknown 4xx / timeout / unreadable 200), counted
 * whatever happened to its charge — at most once per OWN_FAILURE_EVERY_MS (ownFailedAt = the last counted one); STUCK at
 * STUCK_AFTER_ATTEMPTS. Any verdict from dayo (a 200) starts it again.
 */
/**
 * Block 3 (Task 10): prefix = the fixed `detail` prefix of dayo's verdict (spec §4.10 — the tablet decides from it only) ·
 * scopeSince = when this row was FIRST answered FORBIDDEN `scope:` (spec §6.2 m1: red banner after 24 h, "ปิดไว้ในเครื่อง"
 * after 7 days — kept across its 15-minute retries).
 */
export type LastErrorExtra = { supportedHash?: string; farAhead?: true; noVerdict?: number; requestFailed?: true; ownFailures?: number; ownFailedAt?: string; scopeSince?: string; prefix?: string }
/** final review I2: however often a wake clears the backoff, a row's own failures count at most once per 5 minutes. */
export const OWN_FAILURE_EVERY_MS = 5 * 60_000
export function encodeLastError(reason: string, detail: string, extra: LastErrorExtra = {}): string {
  return JSON.stringify({ reason: clipCodePoints(reason, 60), detail: clipCodePoints(detail, 500), ...extra })
}
export function decodeLastError(raw: string | null): { reason: string; detail: string } & LastErrorExtra {
  if (raw === null) return { reason: '', detail: '' }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { reason: '', detail: raw }
    const p = parsed as { reason?: unknown; detail?: unknown; supportedHash?: unknown; farAhead?: unknown; noVerdict?: unknown; requestFailed?: unknown; ownFailures?: unknown; ownFailedAt?: unknown; scopeSince?: unknown; prefix?: unknown }
    return { reason: typeof p.reason === 'string' ? p.reason : '', detail: typeof p.detail === 'string' ? p.detail : '', ...(typeof p.supportedHash === 'string' ? { supportedHash: p.supportedHash } : {}), ...(p.farAhead === true ? { farAhead: true as const } : {}), ...(typeof p.noVerdict === 'number' && Number.isSafeInteger(p.noVerdict) && p.noVerdict > 0 ? { noVerdict: p.noVerdict } : {}), ...(p.requestFailed === true ? { requestFailed: true as const } : {}), ...(typeof p.ownFailures === 'number' && Number.isSafeInteger(p.ownFailures) && p.ownFailures > 0 ? { ownFailures: p.ownFailures } : {}), ...(typeof p.ownFailedAt === 'string' && Number.isFinite(Date.parse(p.ownFailedAt)) ? { ownFailedAt: p.ownFailedAt } : {}), ...(typeof p.scopeSince === 'string' && Number.isFinite(Date.parse(p.scopeSince)) ? { scopeSince: p.scopeSince } : {}), ...(typeof p.prefix === 'string' && (DETAIL_PREFIXES as readonly string[]).includes(p.prefix) ? { prefix: p.prefix } : {}) }
  } catch {
    return { reason: '', detail: raw }
  }
}
