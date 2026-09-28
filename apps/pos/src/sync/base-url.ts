import type { RemoteDb } from '@dayo/db-schema/browser'
import { DAYO_KEYS, readKey } from './state'

/**
 * Where the tablet may send `Authorization: Bearer <api key>`: https anywhere, or plain http only to this machine
 * (`localhost` / `127.0.0.1`, any port — the mock and local dev). `dayo.base_url` lives in SQLite, which a backup
 * restore can replace, so every reader validates it here rather than trusting the stored value.
 * Returns the URL without a trailing '/' (plan 5 fix L-2). The message never echoes the value.
 */
export function normalizeBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('BAD_BASE_URL: not a URL')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local))) throw new Error('BAD_BASE_URL: https only (http only for localhost / 127.0.0.1)')
  if (url.username !== '' || url.password !== '') throw new Error('BAD_BASE_URL: no credentials in the URL')
  if (url.search !== '' || url.hash !== '' || raw.includes('?') || raw.includes('#')) throw new Error('BAD_BASE_URL: no query or fragment')
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/**
 * Fix round 1 (security C1/I1) — the same central address rule: a key swap or an owner recovery never moves the tablet
 * to another server. Returns null when the stored address is missing or refused by the rule above (a restored backup
 * can carry one) — that tablet needs a full setup. Every reader that must treat a malformed stored URL as "not
 * really linked" goes through this, never the raw column — `isDayoLinked` (`api/connect.ts`) is one (final review
 * round: it used to read the raw key directly, which could report a device "linked" with no valid address to
 * recover to). `sync/catalog.ts`'s `readDayoConfig` deliberately does NOT — see its own docstring.
 */
export async function storedBaseUrl(db: RemoteDb): Promise<string | null> {
  const raw = await readKey(db, DAYO_KEYS.baseUrl)
  if (raw === null) return null
  try {
    const url = normalizeBaseUrl(raw)
    return url.endsWith('/api/v1') ? url : null
  } catch {
    return null
  }
}
