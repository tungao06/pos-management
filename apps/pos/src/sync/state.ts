import { eq, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { clipCodePoints } from '@dayo/contracts'

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
  pushBackoffReason: 'dayo.push_backoff_reason', // 'failure' (network/5xx — cleared by online/manual/open/before_close wakes) | 'rate_limited' (kept)
  pushSingleThrough: 'dayo.push_single_through',
  lastPushAt: 'dayo.last_push_at',
} as const
export type ApiState = 'ok' | 'unauthorized' | 'forbidden' | 'disabled'

export const CLOCK_WARN_MS = 5 * 60_000            // D80
export const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000, 900_000] as const // spec §6.3
export const STUCK_AFTER_ATTEMPTS = 50
export const API_DISABLED_RETRY_MS = 15 * 60_000
export const RATE_LIMIT_DEFAULT_MS = 60_000
export const NO_ANSWER_RETRY_MS = 60_000

export async function readKey(db: RemoteDb, key: string): Promise<string | null> {
  return (await db.select().from(s.syncState).where(eq(s.syncState.key, key)).get())?.value ?? null
}
export async function writeKey(db: RemoteDb, key: string, value: string): Promise<void> {
  await db.insert(s.syncState).values({ key, value }).onConflictDoUpdate({ target: s.syncState.key, set: { value: sql`excluded.value` } })
}
export async function deleteKey(db: RemoteDb, key: string): Promise<void> {
  await db.delete(s.syncState).where(eq(s.syncState.key, key))
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
export async function recordServerTime(db: RemoteDb, serverTimeIso: string, sentAtMs: number, receivedAtMs: number, nowIso: string): Promise<void> {
  await writeKey(db, DAYO_KEYS.clockSkewMs, String(skewMs(serverTimeIso, sentAtMs, receivedAtMs)))
  await writeKey(db, DAYO_KEYS.clockMeasuredAt, nowIso)
}

/** outbox.last_error is JSON (plan 5 I-12); the detail is clipped by code points so the JSON stays whole. */
export function encodeLastError(reason: string, detail: string, extra: { supportedHash?: string; farAhead?: true } = {}): string {
  return JSON.stringify({ reason: clipCodePoints(reason, 60), detail: clipCodePoints(detail, 500), ...extra })
}
export function decodeLastError(raw: string | null): { reason: string; detail: string; supportedHash?: string; farAhead?: true } {
  if (raw === null) return { reason: '', detail: '' }
  try {
    const p = JSON.parse(raw) as { reason?: unknown; detail?: unknown; supportedHash?: unknown; farAhead?: unknown }
    return { reason: typeof p.reason === 'string' ? p.reason : '', detail: typeof p.detail === 'string' ? p.detail : '', ...(typeof p.supportedHash === 'string' ? { supportedHash: p.supportedHash } : {}), ...(p.farAhead === true ? { farAhead: true as const } : {}) }
  } catch {
    return { reason: '', detail: raw }
  }
}
