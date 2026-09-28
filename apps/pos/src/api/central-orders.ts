import { eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { bangkokDateOf, clipCodePoints, type CentralOrder, type DayoEdit } from '@dayo/contracts'
import { edgeBahtToSatang } from '@dayo/domain'
import { apiBlocked, rateLimitLeft, readDayoConfig, recordDayoFailure, type SyncContext } from '../sync/catalog'
import { createDayoClient, DayoError, type DayoClient, type DayoFailure } from '../sync/dayo-client'
import { DAYO_KEYS, deleteKey, extendRateLimit, MAX_BACKOFF_WAIT_MS, readKey, writeKey } from '../sync/state'
import { requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import type { CentralOrderDto } from './types'

/** `beforeRequest`: the PosApi's E3 cap under dayo's 60/min (pos-api.ts) — throws to refuse before any request. */
export type E3Options = { beforeRequest?: () => void }

/** refreshDayoEdits looks this far back (Thai dates) for this tablet's bills dayo edited. */
export const DAYO_EDITS_LOOKBACK_DAYS = 60
/** list_api_orders returns at most this many bills (0052_pos_push.sql:841 `limit 500`), sorted by sale_date/order_no — not by updated_at. */
export const E3_PAGE_MAX = 500
/**
 * updated_since is asked this much earlier than the newest updated_at already seen: dayo stamps updated_at when a
 * transaction runs, so one that commits later with an earlier stamp is not missed. An edit seen twice writes nothing.
 */
export const DAYO_EDITS_OVERLAP_MS = 5 * 60_000
/** catalogError segment while a backward walk over full pages is still going (or a single day was cut off). */
export const DAYO_EDITS_TOO_MANY = 'DAYO_EDITS_TOO_MANY'
/** Pages one refreshDayoEdits may ask for (each is one E3 request, counted by the PosApi's E3 cap too). */
export const E3_PAGES_PER_REFRESH = 2
const DAY_MS = 86_400_000
const dayBefore = (ymd: string): string => new Date(Date.parse(`${ymd}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10)
const NAME_MAX = 100   // code points kept of dayo's edited_by_name
const REASON_MAX = 500 // code points kept of dayo's reason (dayo's answer is not trusted to be small — M6)

/**
 * One E3 request, online only. Refused before any request (OFFLINE) when the key is refused / the API is off
 * (review item 14), while a 429 of this key runs, or past the PosApi's E3 cap. The network wait is OUTSIDE the serial
 * queue — sales keep going; the reads and writes around it are inside.
 */
async function e3(ctx: SyncContext, opts: E3Options, q: Parameters<DayoClient['listOrders']>[0]): Promise<CentralOrder[]> {
  const cfg = await ctx.serial(() => readDayoConfig(ctx.db, ctx.deps))
  if (cfg === null) throw new PosError('NEEDS_SETUP', 'not linked to dayo')
  const hold = await ctx.serial(async () => {
    const now = ctx.deps.now()
    if (await apiBlocked(ctx.db, now)) return 'api_blocked'
    return (await rateLimitLeft(ctx.db, now)) > 0 ? 'rate_limited' : null
  })
  if (hold !== null) throw new PosError('OFFLINE', hold)
  opts.beforeRequest?.()
  let client: DayoClient
  try {
    client = createDayoClient({ ...cfg, fetch: ctx.deps.fetch, nowMs: () => Date.parse(ctx.deps.now()) })
  } catch (e) {
    const failure: DayoFailure = { kind: 'bad_base_url', message: e instanceof Error ? e.message : 'BAD_BASE_URL' }
    await ctx.serial(() => recordDayoFailure(ctx.db, ctx.deps, failure))
    throw new PosError('OFFLINE', 'bad_base_url')
  }
  try {
    return (await client.listOrders(q)).value
  } catch (e) {
    if (!(e instanceof DayoError)) throw e
    const f = e.failure
    await ctx.serial(async () => {
      await recordDayoFailure(ctx.db, ctx.deps, f) // 401 / 403 / 404 stop every call until a new key / the retry time
      // a 429 is for the whole key (E1, E2, E3 together) — never shortens a longer wait (M1)
      if (f.kind === 'rate_limited') await extendRateLimit(ctx.db, new Date(Date.parse(ctx.deps.now()) + Math.min(f.retryAfterMs, MAX_BACKOFF_WAIT_MS)).toISOString())
    })
    throw new PosError('OFFLINE', f.kind)
  }
}

/** dayo's dayo_edit, bounded — only the fields the tablet shows. */
function boundedEdit(e: DayoEdit): DayoEdit {
  return {
    kind: e.kind, edited_at: e.edited_at,
    edited_by_name: e.edited_by_name === null ? null : clipCodePoints(e.edited_by_name, NAME_MAX),
    reason: e.reason === null ? null : clipCodePoints(e.reason, REASON_MAX),
    version: e.version,
  }
}

/**
 * spec 04 §4.6 · O1 pending: records dayo_edit of this tablet's own bills (matched by pos_order_id), display only —
 * order.central_dayo_edit_json only, when it changed (null included: dayo may report "no edit"), with an audit row.
 * Never touches total_satang, payment, the bill's status, the outbox, the hash chain or the shift/Z: the receipt and
 * the totals here stay the money actually collected. An id not on this tablet, or a row without the field, is skipped.
 * No transaction of its own. Returns how many bills changed.
 */
export async function applyDayoEdits(tx: RemoteDb, deps: ApiDeps, rows: readonly CentralOrder[]): Promise<number> {
  let updated = 0
  for (const r of rows) {
    if (r.pos_order_id == null || r.dayo_edit === undefined) continue
    const o = await tx.select({ id: s.order.id, edit: s.order.centralDayoEditJson }).from(s.order).where(eq(s.order.id, r.pos_order_id)).get()
    if (o === undefined) continue
    const next = r.dayo_edit === null ? null : boundedEdit(r.dayo_edit)
    const before = o.edit ?? null
    if (JSON.stringify(before) === JSON.stringify(next)) continue
    await tx.update(s.order).set({ centralDayoEditJson: next }).where(eq(s.order.id, o.id))
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'order', entityId: o.id, action: 'dayo_edit_seen', beforeJson: before, afterJson: next, actorUserId: null, at: deps.now() })
    updated++
  }
  return updated
}

/** spec 04 §4.6: bot/web bills of today, online only — fetched when the page opens and every 5 minutes while open. */
export async function listCentralOrdersToday(ctx: SyncContext, opts: E3Options = {}): Promise<CentralOrderDto[]> {
  const today = bangkokDateOf(ctx.deps.now())
  const rows = await e3(ctx, opts, { from: today, to: today })
  const own = rows.filter((o) => o.pos_order_id != null)
  if (own.length > 0) await ctx.serial(() => ctx.db.transaction((tx) => applyDayoEdits(tx, ctx.deps, own))) // own POS bills: dayo_edit, read only
  return rows
    .filter((o) => o.source !== 'pos')
    .map((o) => ({
      orderNo: o.order_no, source: o.source, sourceLabel: o.source === 'line' ? 'บอท' : o.source === 'web' ? 'เว็บ' : o.source,
      createdByName: o.created_by_name ?? null, soldAt: o.sold_at ?? null, totalSatang: totalOf(o), payment: o.payment, status: o.status, duplicateSuspect: o.duplicate_suspect ?? false,
    }))
    .sort((a, b) => (b.soldAt ?? '').localeCompare(a.soldAt ?? ''))
}

/** dayo's baht → satang at the money edge; a total dayo cannot have stored (numeric(10,2)) is its bug, named clearly. */
function totalOf(o: CentralOrder): number {
  try {
    return edgeBahtToSatang(o.totals.total)
  } catch {
    throw new PosError('DAYO_BAD_RESPONSE', `E3 ${clipCodePoints(o.order_no, 40)}: total ${String(o.totals.total)}`)
  }
}

/** Sets (text) or removes (null) the "too many edits" segment of catalogError, leaving any other problem there as it is. */
async function setTooManyWarning(db: RemoteDb, text: string | null): Promise<void> {
  const cur = await readKey(db, DAYO_KEYS.catalogError)
  const parts = (cur ?? '').split(' · ').filter((p) => p !== '' && !p.startsWith(DAYO_EDITS_TOO_MANY))
  if (text !== null) parts.push(text)
  const next = parts.join(' · ')
  if (next === (cur ?? '')) return
  if (next === '') await deleteKey(db, DAYO_KEYS.catalogError)
  else await writeKey(db, DAYO_KEYS.catalogError, next)
}

/**
 * A backward walk over full pages, kept between refreshes (sync_state dayo.dayo_edits_walk). `since` = the mark it
 * walks under (a walk under another mark is dropped) · `to` = the sale_date the next page ends at (inclusive) ·
 * `newest` = the newest updated_at of the walk's FIRST page — the mark once the walk ends · `lossy` = days that alone
 * filled a page (their cut-off bills cannot be reached: E3 has no cursor inside a day).
 */
type Walk = { since: string; to: string; newest: string | null; lossy: string[] }
const YMD = /^\d{4}-\d{2}-\d{2}$/
function readWalk(raw: string | null, since: string): Walk | null {
  if (raw === null) return null
  try {
    const w = JSON.parse(raw) as Partial<Walk>
    if (w.since === since && typeof w.to === 'string' && YMD.test(w.to) && (w.newest === null || (typeof w.newest === 'string' && Number.isFinite(Date.parse(w.newest))))
      && Array.isArray(w.lossy) && w.lossy.length <= DAYO_EDITS_LOOKBACK_DAYS + 1 && w.lossy.every((d) => typeof d === 'string' && YMD.test(d))) {
      return { since: w.since, to: w.to, newest: w.newest ?? null, lossy: w.lossy }
    }
  } catch { /* an unreadable walk starts again from today */ }
  return null
}
const walkingText = (to: string): string => `${DAYO_EDITS_TOO_MANY}: บิลที่ระบบกลางแก้มีมากเกินดึงครั้งเดียว — กำลังไล่ดึงย้อนหลัง (ถึงวันที่ ${to}) บางบิลอาจยังไม่ขึ้นว่าแก้แล้ว`
const lossyText = (days: string[]): string => `${DAYO_EDITS_TOO_MANY}: วันที่ ${days.join(', ')} มีบิลที่ระบบกลางแก้เกิน ${E3_PAGE_MAX} — บางบิลของวันนั้นอาจไม่ขึ้นว่าแก้แล้ว`

/**
 * E3 with updated_since (spec §4.6 · O1 pending): this tablet's bills the owner edited or cancelled on the dayo web in
 * the last 60 days → applyDayoEdits. The "since" mark starts at the device's setup time. updated_since is shop-wide
 * (bot + web + POS), so a page of 500 is normal on a busy shop — and dayo sorts by sale_date, not updated_at, so a full
 * page does not hold every change (fix round 1 item 1):
 * - a full page → the next page ends at the page's lowest sale_date (inclusive; an edit seen twice writes nothing),
 *   up to E3_PAGES_PER_REFRESH pages now, the rest on the next refresh (the walk is kept); a warning shows meanwhile;
 * - a page of ONE sale_date that is full cannot be paged inside: that day is noted (lossy) and the walk goes on the day before;
 * - a page that is not full ends the walk: the mark becomes the newest updated_at of the walk's first page. Not the
 *   newest of later pages — an edit made during the walk on a date already walked past has a later updated_at than
 *   the first page, so the next refresh still sees it.
 * A later page that cannot be fetched (offline, the E3 cap) just stops this refresh; the walk resumes next time.
 */
export async function refreshDayoEdits(ctx: SyncContext, opts: E3Options = {}): Promise<{ updated: number }> {
  const start = await ctx.serial(async () => {
    const stored = await readKey(ctx.db, DAYO_KEYS.dayoEditsSince)
    let since = stored !== null && Number.isFinite(Date.parse(stored)) ? stored : null
    if (since === null) {
      const device = await requireDevice(ctx.db)
      since = (await ctx.db.select({ at: s.device.registeredAt }).from(s.device).where(eq(s.device.id, device.id)).get())?.at ?? ctx.deps.now()
    }
    return { since, walk: readWalk(await readKey(ctx.db, DAYO_KEYS.dayoEditsWalk), since) }
  })
  const { since } = start
  const today = bangkokDateOf(ctx.deps.now())
  const from = new Date(Date.parse(`${today}T00:00:00.000Z`) - DAYO_EDITS_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10)
  const updatedSince = new Date(Date.parse(since) - DAYO_EDITS_OVERLAP_MS).toISOString()
  const fresh = start.walk === null
  let to = start.walk?.to ?? today
  let newest = start.walk?.newest ?? null
  const lossy = [...(start.walk?.lossy ?? [])]
  let updated = 0
  for (let page = 0; page < E3_PAGES_PER_REFRESH; page++) {
    let rows: CentralOrder[]
    try {
      rows = to < from ? [] : await e3(ctx, opts, { from, to, updatedSince })
    } catch (e) {
      if (page === 0) throw e
      break // the walk is saved already — the next refresh goes on from `to`
    }
    if (fresh && page === 0) {
      for (const r of rows) if (r.updated_at !== null && Number.isFinite(Date.parse(r.updated_at)) && (newest === null || Date.parse(r.updated_at) > Date.parse(newest))) newest = r.updated_at
    }
    let nextTo: string | null = null
    if (rows.length >= E3_PAGE_MAX) {
      const lowest = rows.reduce((m, r) => (r.sale_date < m ? r.sale_date : m), to)
      if (lowest < to) nextTo = lowest
      else { lossy.push(to); nextTo = dayBefore(to) }
    }
    const walkTo = nextTo
    updated += await ctx.serial(() => ctx.db.transaction(async (tx) => {
      const n = await applyDayoEdits(tx, ctx.deps, rows.filter((o) => o.pos_order_id != null))
      if (walkTo !== null) {
        await writeKey(tx, DAYO_KEYS.dayoEditsWalk, JSON.stringify({ since, to: walkTo, newest, lossy } satisfies Walk))
        await setTooManyWarning(tx, walkingText(walkTo))
      } else {
        await deleteKey(tx, DAYO_KEYS.dayoEditsWalk)
        if (newest !== null && Date.parse(newest) > Date.parse(since)) await writeKey(tx, DAYO_KEYS.dayoEditsSince, newest)
        await setTooManyWarning(tx, lossy.length > 0 ? lossyText(lossy) : null)
      }
      return n
    }))
    if (walkTo === null) break
    to = walkTo
  }
  return { updated }
}
