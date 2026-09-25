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
