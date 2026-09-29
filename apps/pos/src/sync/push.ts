import { and, asc, desc, eq, getTableColumns, gt, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import {
  BOT_ORDER_NO_RE, CashCountAcceptedData, CashMovementAcceptedData, clipCodePoints, detailPrefix, ExistsConflictData, isRowSupported, laneOf, MAX_DETAIL_CODE_POINTS, MAX_PUSH_BODY_BYTES, MAX_PUSH_ROWS,
  OffCatalogAcceptedData, OrderAcceptedData, OrderVoidAcceptedData, PUSH_KINDS, PushRow, rowKey, SHIFT_LANE_KINDS, ShiftCloseAcceptedData, ShiftOpenAcceptedData,
  type PushRequest, type ReceivedRowResult, type Supported,
} from '@dayo/contracts'
import { edgeBahtToSatang } from '@dayo/domain'
import type { ApiDeps } from '../api/deps'
import { enqueuePush } from '../db/outbox'
import { apiBlocked, readDayoConfig, readSupported, recordDayoFailure, type SyncContext } from './catalog'
import { createDayoClient, DayoError, type DayoClient, type DayoFailure, type Timed } from './dayo-client'
import { createLanePicker, type ParentState } from './lanes'
import { BACKOFF_MS, backoffMs, DAYO_KEYS, decodeLastError, deleteKey, encodeLastError, extendRateLimit, NO_ANSWER_RETRY_MS, OWN_FAILURE_EVERY_MS, RATE_LIMIT_DEFAULT_MS, readKey, recordServerTime, STUCK_AFTER_ATTEMPTS, writeKey, type LastErrorExtra } from './state'

export type PushOutcome = { requests: number; sent: number; rejected: number; deferred: number; held: number; noAnswer: number; stopped: null | 'not_linked' | 'no_supported_list' | 'api_blocked' | 'backoff' | DayoFailure['kind'] }

/**
 * An outbox row plus its SQLite rowid. The queue is read in (created_at, rowid) order: a void's created_at can EQUAL its
 * bill's (the void time clamped to sold_at), and UUIDv7 ids inside one millisecond are not ordered, so only the rowid —
 * assigned in insertion order — keeps a bill ahead of its void when the timestamps tie.
 *
 * The outbox has no INTEGER PRIMARY KEY, so a plain `VACUUM` of the live database may renumber its rowids. Nothing runs
 * VACUUM on the tablet: the backup is opfs-sahpool's `exportFile` (a byte copy of the file, rowids included), and
 * `VACUUM INTO` appears only in the tests' stand-in for it. Review this ordering before adding any VACUUM.
 */
type Row = typeof s.outbox.$inferSelect & { rid: number }
type Mark = { createdAt: string; rid: number }

/**
 * spec 04 §6.2 (m1) · ruling R14: a row answered FORBIDDEN `scope:` (the key lacks the kind's scope — the owner adds it on
 * dayo's web) waits like a deferred row: retried every 15 minutes (no jitter), never counted toward STUCK; the owner banner
 * turns red after 24 hours and "ปิดไว้ในเครื่อง" is offered after 7 days (Task 16 reads lastError.scopeSince).
 */
export const SCOPE_RETRY_MS = 15 * 60_000
export const SCOPE_RED_AFTER_MS = 24 * 3_600_000
export const SCOPE_CLOSABLE_AFTER_MS = 7 * 86_400_000

/** audit_log action: dayo stored a row the owner had closed local_only while its request was on the wire (Task 14 fix round 1). */
export const SENT_AFTER_LOCAL_ACTION = 'sync_row_reached_dayo_after_local'
/**
 * Reasons only the TABLET writes on a row (ruling R11 "ของเครื่อง") — a verdict of dayo carrying one of these is renamed
 * REJECTED (fix round 1 item 4), so dayo can never park a row as PARENT_REJECTED or pass it off as the tablet's own.
 */
export const TABLET_OWN_REASONS: ReadonlySet<string> = new Set(['PARENT_REJECTED', 'STUCK', 'ENVELOPE', 'CLOCK_AHEAD', 'REQUEST_FAILED', 'NO_VERDICT_REPEATED', 'NO_ANSWER', 'DUPLICATE_VERDICT', 'UNSUPPORTED'])
/** plan 5 fix M-2: only these mean dayo stored the row. */
const KNOWN_SUCCESS = new Set(['accepted', 'duplicate'])
const utf8 = new TextEncoder()
const ENVELOPE_BYTES = 80 // {"device_time":"2026-…Z","rows":[]} is 52 bytes; the rest is slack
export const MAX_ROUNDS_PER_CALL = 15 // ≤ 300 rows per call; the scheduler calls again (bounds the time one call can take)
const rowBytes = (r: Row): number => utf8.encode(JSON.stringify({ key: r.idempotencyKey, kind: r.tableName, data: r.rowJson })).length + 1
const hashOf = (sup: Supported): string => JSON.stringify(sup)
/** The longest wait the sender ever sets: the last backoff step + 20 % jitter (a clamped Retry-After, 15 min, fits under it). */
const MAX_WAIT_MS = Math.round(BACKOFF_MS[BACKOFF_MS.length - 1]! * 1.2)
/** security I1: a wait that is not a finite 0 … MAX_WAIT_MS is not trusted — the default 60 s is used instead. */
const later = (iso: string, ms: number): string => new Date(Date.parse(iso) + (Number.isFinite(ms) && ms >= 0 && ms <= MAX_WAIT_MS ? ms : RATE_LIMIT_DEFAULT_MS)).toISOString()
/** R3 + ruling N5: a row more than 24 h ahead of server_time stays pending, flagged lastError.farAhead (owner-only alert). */
export const CLOCK_AHEAD_FAR_MS = 86_400_000
/** R4: consecutive 5xx / unreadable 200 answers before the sender goes one row per request. */
const SERVER_STREAK_FOR_SINGLE = 3
/** M5: this many answers in a row without a verdict for one row = an owner-visible warning (the row stays pending). */
export const NO_VERDICT_WARN_AFTER = 10
export const NO_VERDICT_REPEATED = 'NO_VERDICT_REPEATED'
/** A request that failed while it carried only this row (R4 one-row mode) — the row is charged a try (security I2). */
export const REQUEST_FAILED = 'REQUEST_FAILED'
/** fix round 3: K one-row requests failing in a row within one call = dayo is down (refund every provisional charge, stop). */
export const SINGLE_FAILURES_PER_CALL = 3
const ORDER_NO_MAX = 100          // M6: code points
const DUPLICATE_OF_MAX = 20       // M6: entries
const WARNINGS_MAX = 20
const WARNING_MAX = 200
const PAGE = 200
const rowid = sql<number>`rowid`.mapWith(Number)
const isPushKind = inArray(s.outbox.tableName, [...PUSH_KINDS])
const isShiftLane = inArray(s.outbox.tableName, [...SHIFT_LANE_KINDS])
/**
 * One-row mode reads the queue by this key: a bill refunded after an outage (next_attempt_at = refund time) goes to the
 * back. A shift-lane row keeps its created_at (spec §6.2: that lane is strictly in createdAt order — rotation never
 * reorders it).
 */
const effTime = sql<string>`case when ${isShiftLane} then ${s.outbox.createdAt} else coalesce(${s.outbox.nextAttemptAt}, ${s.outbox.createdAt}) end`
/** "Cannot go now" for the lane picker: a row judged earlier in this call, or not a trusted probe. */
const NOT_NOW = '9999-12-31T23:59:59.999Z'
/** (created_at, rowid) strictly after a mark — the keyset of the page reader. */
const afterMark = (m: Mark): SQL => or(gt(s.outbox.createdAt, m.createdAt), and(eq(s.outbox.createdAt, m.createdAt), sql`rowid > ${m.rid}`))!
const blockedStates = new Set(['unauthorized', 'forbidden', 'bad_base_url'])

/** Every status change of a row is guarded by `status = 'pending'` — a decision already taken is never overwritten. */
const pendingRow = (id: string): SQL => and(eq(s.outbox.id, id), eq(s.outbox.status, 'pending'))!

/** `result` (R16): the verdict's data kept with the dead row — `undefined` leaves result_json as it is. */
async function markDead(db: RemoteDb, r: Row, at: string, reason: string, detail: string, attempts = r.attempts, extra: LastErrorExtra = {}, result?: Record<string, unknown> | null): Promise<void> {
  await db.update(s.outbox).set({ status: 'dead', deadAt: at, attempts, nextAttemptAt: null, lastError: encodeLastError(reason, detail, extra), ...(result === undefined ? {} : { resultJson: result as never }) }).where(pendingRow(r.id))
}

/**
 * A parent that became dead takes its waiting children with it (spec §4.5 table: PARENT_REJECTED) — every level at once
 * (spec §4.10: shift_open → cash_count → shift_close), so a Z never waits behind a count that can no longer go.
 */
async function cascadeChildren(db: RemoteDb, parentKey: string, at: string): Promise<void> {
  const todo = [parentKey]
  const seen = new Set(todo)
  for (let key = todo.pop(); key !== undefined; key = todo.pop()) {
    const kids = await db.select({ ...getTableColumns(s.outbox), rid: rowid }).from(s.outbox).where(and(eq(s.outbox.parentKey, key), eq(s.outbox.status, 'pending'))).all()
    for (const k of kids) {
      await markDead(db, k, at, 'PARENT_REJECTED', `แถวแม่ ${key} ส่งไม่ผ่าน — จะส่งเองเมื่อแถวแม่ผ่าน`)
      if (!seen.has(k.idempotencyKey)) { seen.add(k.idempotencyKey); todo.push(k.idempotencyKey) }
    }
  }
}

/** The outbox status of a row's local parent (spec §4.10 table) — no row under that key = 'missing'. */
async function parentStateOf(db: RemoteDb, key: string): Promise<ParentState> {
  const p = await db.select({ status: s.outbox.status }).from(s.outbox).where(eq(s.outbox.idempotencyKey, key)).get()
  return p === undefined ? 'missing' : p.status
}

/** Held = not sent and not counted: dayo does not list its kind/fields, or answered UNSUPPORTED under this same list. */
export function isHeld(r: { tableName: string; rowJson: unknown; lastError: string | null }, sup: Supported): boolean {
  const last = decodeLastError(r.lastError)
  return !isRowSupported(r.tableName, r.rowJson as Record<string, unknown>, sup) || (last.reason === 'UNSUPPORTED' && last.supportedHash === hashOf(sup))
}

// ── R4 one-row mode (ruling R4 · controller ruling, fix round 1): only the rows of the batch that failed count ────────
/** The ids of the failed batch, or null when there is no (readable) mark — an unreadable or old-format one is dropped. */
async function readSingle(db: RemoteDb): Promise<string[] | null> {
  const raw = await readKey(db, DAYO_KEYS.pushSingleThrough)
  if (raw === null) return null
  try {
    const v = JSON.parse(raw) as { ids?: unknown }
    if (Array.isArray(v.ids) && v.ids.length > 0 && v.ids.length <= MAX_PUSH_ROWS && v.ids.every((x) => typeof x === 'string')) return v.ids as string[]
  } catch { /* dropped below */ }
  await deleteKey(db, DAYO_KEYS.pushSingleThrough)
  return null
}
async function startSingle(db: RemoteDb, batch: Row[]): Promise<void> {
  await writeKey(db, DAYO_KEYS.pushSingleThrough, JSON.stringify({ ids: batch.slice(0, MAX_PUSH_ROWS).map((r) => r.id) }))
}
/** A row of the failed batch was decided (any 200, or its own ENVELOPE death) — it no longer holds one-row mode on. */
async function forgetSingle(db: RemoteDb, ids: string[]): Promise<void> {
  const cur = await readSingle(db)
  if (cur === null) return
  const left = cur.filter((id) => !ids.includes(id))
  if (left.length === 0) await deleteKey(db, DAYO_KEYS.pushSingleThrough)
  else if (left.length !== cur.length) await writeKey(db, DAYO_KEYS.pushSingleThrough, JSON.stringify({ ids: left }))
}
/** 1 while a row of the failed batch is still pending and not held; otherwise the mark is deleted and batches are full again. */
async function batchSize(db: RemoteDb, sup: Supported): Promise<number> {
  const ids = await readSingle(db)
  if (ids === null) return MAX_PUSH_ROWS
  const rows = await db.select().from(s.outbox).where(and(inArray(s.outbox.id, ids), eq(s.outbox.status, 'pending'))).all()
  if (rows.some((r) => !isHeld(r, sup))) return 1
  await deleteKey(db, DAYO_KEYS.pushSingleThrough)
  return MAX_PUSH_ROWS
}

/**
 * Reads the queue page by page until a batch is full or the queue ends (review item 20). FIFO = keyset on (created_at,
 * rowid). `rotate` (R4 one-row mode, fix round 3) = keyset on (effTime, created_at, rowid), so bills refunded after a run
 * of failures are tried after the others and a run of failing rows cannot wedge the head.
 * A child still never goes before its parent: pickBatch checks the parent whatever the order.
 * Block 3: shift-lane rows are read even while they wait out a backoff — the lane picker must SEE a waiting row to hold
 * every later shift-lane row behind it (spec §6.2). Bills that are not due stay out, as in block 2.
 */
async function* pendingRows(db: RemoteDb, nowIso: string, rotate: boolean): AsyncGenerator<Row> {
  let after: (Mark & { eff: string }) | null = null
  for (;;) {
    const keyset = after === null ? undefined
      : rotate ? sql`(${effTime}, ${s.outbox.createdAt}, rowid) > (${after.eff}, ${after.createdAt}, ${after.rid})` : afterMark(after)
    const page: (Row & { eff: string })[] = await db.select({ ...getTableColumns(s.outbox), rid: rowid, eff: effTime }).from(s.outbox)
      .where(and(eq(s.outbox.status, 'pending'), isPushKind, or(isNull(s.outbox.nextAttemptAt), lte(s.outbox.nextAttemptAt, nowIso), isShiftLane), keyset))
      .orderBy(...(rotate ? [asc(effTime), asc(s.outbox.createdAt), asc(rowid)] : [asc(s.outbox.createdAt), asc(rowid)])).limit(PAGE).all()
    for (const r of page) yield r
    if (page.length < PAGE) return
    const last = page.at(-1)!
    after = { eff: last.eff, createdAt: last.createdAt, rid: last.rid }
  }
}

/**
 * A row not marked as part of a failed request — the best probe after a failure. fix round 1 item 9: a row an older
 * build charged or refunded carries reason REQUEST_FAILED without the requestFailed flag; it is not trusted either.
 */
const isTrusted = (r: Row): boolean => {
  const d = decodeLastError(r.lastError)
  return d.requestFailed !== true && d.reason !== REQUEST_FAILED
}

/**
 * `probe` (one-row mode, after a failure in this call): the first sendable row that has never been part of a failed
 * request, else the first sendable row — a good row behind failing ones is reached within K requests.
 *
 * Block 3 (Task 10 · spec §6.2 · §4.10): every row goes through the lane picker (sync/lanes.ts) — the strict shift lane
 * and the bill lane share one batch budget (rows and UTF-8 bytes; the byte count of block 2 lives only there now). Before
 * a row is offered, a parent that is dead / local only takes it along (PARENT_REJECTED / local_only), for every kind and
 * every level in one pass (the queue is read in created_at order, so a grandchild sees its parent's new status). A row
 * bigger than an empty batch ends dead ENVELOPE here, before any request, with no try counted.
 */
async function pickBatch(db: RemoteDb, nowIso: string, sup: Supported, size: number, decided: Set<string>, opts: { rotate: boolean; probe: boolean } = { rotate: false, probe: false }): Promise<{ batch: Row[]; held: number }> {
  const first = await pickPass(db, nowIso, sup, size, decided, opts.rotate, opts.probe)
  if (first.batch.length > 0 || !first.skippedUntrusted) return first
  // no trusted row could go: the first sendable row goes alone (block 2's fallback — a lane picker offers each row once)
  return pickPass(db, nowIso, sup, size, decided, opts.rotate, false)
}

async function pickPass(db: RemoteDb, nowIso: string, sup: Supported, size: number, decided: Set<string>, rotate: boolean, probe: boolean): Promise<{ batch: Row[]; held: number; skippedUntrusted: boolean }> {
  const parents = new Map<string, ParentState>()
  const picker = createLanePicker((k) => parents.get(k) ?? 'missing', nowIso, { maxRows: size, maxBytes: MAX_PUSH_BODY_BYTES - ENVELOPE_BYTES })
  const batch: Row[] = []
  const seen = new Map<string, Row>()
  let held = 0
  let skippedUntrusted = false
  for await (const r of pendingRows(db, nowIso, rotate)) {
    if (picker.full()) break
    const q = { id: r.id, kind: r.tableName, key: r.idempotencyKey, createdAt: r.createdAt, nextAttemptAt: r.nextAttemptAt, parentKey: r.parentKey, supported: true, bytes: 0 }
    if (decided.has(r.id)) {
      // judged once per call (plan 5 fix H-1) — a shift-lane row still pending holds every later shift-lane row
      if (laneOf(r.tableName) === 'shift') picker.offer({ ...q, nextAttemptAt: NOT_NOW })
      continue
    }
    if (r.parentKey !== null) {
      let st = await parentStateOf(db, r.parentKey)
      if (st === 'closed_off_catalog') {
        // carried item 3 · spec §4.10 (แถวแม่ถูกปิด): the new parent of a bill's void is its order_off_catalog row. closeOffCatalog
        // moves every child in its own transaction; this catches a void queued under the old parent (an older build) — the same
        // UPDATE, and to one of the two parents enqueuePush allows. No such row = the bill will never be sent: local_only.
        const moved = r.tableName === 'order_void' ? rowKey('order_off_catalog', String((r.rowJson as { pos_order_id: string }).pos_order_id)) : null
        st = moved === null ? 'missing' : await parentStateOf(db, moved)
        if (moved === null || st === 'missing') { await db.update(s.outbox).set({ status: 'local_only', nextAttemptAt: null }).where(pendingRow(r.id)); decided.add(r.id); continue }
        await db.update(s.outbox).set({ parentKey: moved }).where(pendingRow(r.id))
        r.parentKey = moved
        q.parentKey = moved
      }
      if (st === 'dead') { await markDead(db, r, nowIso, 'PARENT_REJECTED', `แถวแม่ ${r.parentKey} ส่งไม่ผ่าน`); decided.add(r.id); continue }
      if (st === 'local_only') { await db.update(s.outbox).set({ status: 'local_only', nextAttemptAt: null }).where(pendingRow(r.id)); decided.add(r.id); continue }
      parents.set(r.parentKey, st)
    }
    const unsupported = isHeld(r, sup)
    if (unsupported) held++
    const untrusted = probe && !isTrusted(r)
    if (untrusted) skippedUntrusted = true
    seen.set(r.id, r)
    if (picker.offer({ ...q, supported: !unsupported, bytes: rowBytes(r), nextAttemptAt: untrusted ? NOT_NOW : r.nextAttemptAt })) batch.push(r)
  }
  for (const o of picker.oversized()) {
    const r = seen.get(o.id)!
    await markDead(db, r, nowIso, 'ENVELOPE', 'แถวนี้ใหญ่เกิน 256 KB')
    decided.add(r.id)
  }
  return { batch, held, skippedUntrusted }
}

async function gate(db: RemoteDb, deps: ApiDeps): Promise<{ cfg: { baseUrl: string; apiKey: string } | null; sup: Supported | null; blocked: PushOutcome['stopped'] }> {
  const cfg = await readDayoConfig(db, deps)
  if (cfg === null) return { cfg, sup: null, blocked: 'not_linked' }
  const now = deps.now()
  // same gate as E1/E3 (Task 10): a refused key, the API switched off, or a refused base URL (task 14 item 2)
  if (await apiBlocked(db, now)) return { cfg, sup: null, blocked: 'api_blocked' }
  const until = await readKey(db, DAYO_KEYS.pushBackoffUntil)
  if (until !== null) {
    const left = Date.parse(until) - Date.parse(now)
    // security I1: an unreadable or out-of-range stored backoff (a restored backup, an old build) is not trusted — the default applies
    if (!Number.isFinite(left) || left > MAX_WAIT_MS) { await writeKey(db, DAYO_KEYS.pushBackoffUntil, later(now, RATE_LIMIT_DEFAULT_MS)); return { cfg, sup: null, blocked: 'backoff' } }
    if (left > 0) return { cfg, sup: null, blocked: 'backoff' }
  }
  const sup = await readSupported(db)
  return { cfg, sup, blocked: sup === null ? 'no_supported_list' : null }
}

/**
 * Two separate questions (task 14 fix round 2 ruling):
 * 1. "Has this row itself failed again and again?" — an operational signal. Every request that carried ONLY this row
 *    and failed with 5xx / an unknown 4xx / an unreadable 200 / a timeout adds 1 to its own count (lastError.ownFailures)
 *    at once, whatever any other row of the call got and whatever happens to its charge — but at most once per
 *    OWN_FAILURE_EVERY_MS (5 min, final review I2), so wakes that clear the backoff again and again cannot rush it; the
 *    50th ends it STUCK ("ส่งไม่ผ่าน"). Any verdict from dayo for the row starts the count again (a dead row keeps no
 *    extras, so "ลองใหม่" starts from 0 too). A lone poison row thus reaches STUCK on its own after ≥ 50 × 5 min of
 *    failing — and so does a row only unlucky enough to be tried alone through an outage that long (in practice
 *    longer: the backoff reaches 15 min; its data stays, "ลองใหม่" sends it).
 * 2. "Is a try charged?" — the conservative money decision below (`attempts`, the row's own backoff).
 *
 * security I2 + fix rounds 2–3 (controller rulings): in one-row mode a request that failed with 5xx / an unknown 4xx /
 * an unreadable 200 / a timeout is charged to its row PROVISIONALLY, and the call goes on to the next row (a probe).
 * - A 200 (or a 422 verdict on a row) = dayo is up: every provisional charge of the call is confirmed.
 * - K = SINGLE_FAILURES_PER_CALL failures in a row, or a failure that cannot be charged (offline, 401/403/404, 429) =
 *   dayo is down: every provisional charge is refunded (refundCharges), the call stops, the whole-request backoff holds.
 * - The queue runs out of sendable rows before K failures: every provisional charge is refunded, always (task 14 fix
 *   round 1, Path A). Nothing in the call showed dayo was up. So a charge is kept only when a later row of the SAME call
 *   gets a 200. (Reaching STUCK does not wait for that any more — see 1. above.)
 */
/** The owner banner (farAhead), the M5 count (noVerdict) and the row's own failure count outlive a charge or a refund (item 7). */
/** The row's own failure count and when it was last counted (fix round 2 · final review I2). */
type Own = { ownFailures: number; ownFailedAt: string | null }
function keptExtras(lastError: string | null, own: Own): LastErrorExtra {
  const d = decodeLastError(lastError)
  return {
    ...(d.farAhead === true ? { farAhead: true as const } : {}), ...(d.noVerdict !== undefined ? { noVerdict: d.noVerdict } : {}), requestFailed: true,
    ...(own.ownFailures > 0 ? { ownFailures: own.ownFailures } : {}), ...(own.ownFailedAt !== null ? { ownFailedAt: own.ownFailedAt } : {}),
    // block 3: an outage does not restart a scope: wait's 24 h / 7 day clock (the next scope: verdict reads it back)
    ...(d.scopeSince !== undefined ? { scopeSince: d.scopeSince } : {}),
  }
}
/** This failure counted or not: once per OWN_FAILURE_EVERY_MS; a clock that moved back by more than that counts again. */
function nextOwn(r: Row, nowIso: string): Own & { counted: boolean } {
  const d = decodeLastError(r.lastError)
  const n = d.ownFailures ?? 0
  const last = Date.parse(d.ownFailedAt ?? '')
  if (Number.isFinite(last) && Math.abs(Date.parse(nowIso) - last) < OWN_FAILURE_EVERY_MS) return { ownFailures: n, ownFailedAt: d.ownFailedAt ?? null, counted: false }
  return { ownFailures: n + 1, ownFailedAt: nowIso, counted: true }
}
const failureDetail = (f: DayoFailure): string => (f.kind === 'server' ? `HTTP ${f.status}` : f.kind)
type Provisional = { row: Row; chargedAt: string; own: Own }
/**
 * Fix round 2: the row's own failure, recorded at once and never refunded. Returns true when it ended the row STUCK
 * (then there is nothing left to charge).
 */
async function recordOwnFailure(db: RemoteDb, deps: ApiDeps, r: Row, f: DayoFailure, own: Own & { counted: boolean }, charge: boolean): Promise<boolean> {
  const at = deps.now()
  if (own.counted && own.ownFailures >= STUCK_AFTER_ATTEMPTS) {
    await markDead(db, r, at, 'STUCK', `${REQUEST_FAILED}: ${failureDetail(f)} ×${own.ownFailures}`, Math.max(r.attempts, own.ownFailures))
    return true
  }
  if (!charge) await db.update(s.outbox).set({ lastError: encodeLastError(REQUEST_FAILED, failureDetail(f), keptExtras(r.lastError, own)) }).where(pendingRow(r.id))
  return false
}
async function chargeRow(db: RemoteDb, deps: ApiDeps, r: Row, f: DayoFailure, at: string, own: Own): Promise<void> {
  const attempts = r.attempts + 1
  const detail = failureDetail(f)
  if (attempts >= STUCK_AFTER_ATTEMPTS) { await markDead(db, r, at, 'STUCK', `${REQUEST_FAILED}: ${detail}`, attempts); return }
  await db.update(s.outbox).set({ attempts, lastError: encodeLastError(REQUEST_FAILED, detail, keptExtras(r.lastError, own)), nextAttemptAt: later(at, backoffMs(attempts, deps.random)) }).where(pendingRow(r.id))
}

/**
 * Undoes provisional charges: attempts and dead_at go back to what they were when the row was picked (a STUCK the charge
 * reached is undone too). m2: only the charge's own result is undone — pending with attempts+1, or dead with the dead_at
 * the charge wrote. Rotation (fix round 3): next_attempt_at = the refund time, so one-row mode tries the other rows first.
 */
async function refundCharges(db: RemoteDb, list: Provisional[], at: string): Promise<void> {
  for (const { row: r, chargedAt, own } of list) {
    await db.update(s.outbox) // the charge goes back; the row's own failure count stays (fix round 2)
      .set({ status: 'pending', attempts: r.attempts, deadAt: r.deadAt, nextAttemptAt: at, lastError: encodeLastError(REQUEST_FAILED, 'ส่งไม่ผ่านติดกันหลายแถว — ถือว่าระบบกลางล่ม ไม่นับครั้ง', keptExtras(r.lastError, own)) })
      .where(and(eq(s.outbox.id, r.id), eq(s.outbox.attempts, r.attempts + 1),
        or(eq(s.outbox.status, 'pending'), and(eq(s.outbox.status, 'dead'), eq(s.outbox.deadAt, chargedAt)))))
  }
}

/**
 * Records a failed request. `own`: the request carried only this row and failed in a way that can be the row's own
 * doing — it counts toward the row's STUCK (fix round 2). `chargeable`: in R4 one-row mode it may also be charged
 * provisionally (the caller decides).
 */
type FailureVerdict = { own: boolean; chargeable: boolean }
const NOT_THE_ROWS: FailureVerdict = { own: false, chargeable: false }
async function onRequestFailure(db: RemoteDb, deps: ApiDeps, f: DayoFailure, batch: Row[], single: boolean): Promise<FailureVerdict> {
  const now = deps.now()
  switch (f.kind) {
    case 'unauthorized': case 'forbidden': case 'api_disabled': case 'bad_base_url':
      // 403 here is the whole request (the key lacks orders:write) — never a row's FORBIDDEN (spec §4.5 · §6.3)
      await recordDayoFailure(db, deps, f); return NOT_THE_ROWS
    case 'rate_limited':
      await extendRateLimit(db, later(now, f.retryAfterMs)); return NOT_THE_ROWS // never shortens a longer backoff (M1)
    case 'bad_envelope':
      if (batch.length > 1) await startSingle(db, batch)
      else { await markDead(db, batch[0]!, now, 'ENVELOPE', f.message); await forgetSingle(db, [batch[0]!.id]) } // the queue moves on (spec §6.3 row 422)
      return NOT_THE_ROWS
    default: { // network, timeout, server (5xx and unknown 4xx), bad_response: whole-request retry with backoff (spec §6.3 row 1)
      const streak = Number(await readKey(db, DAYO_KEYS.pushFailStreak) ?? '0') + 1
      await writeKey(db, DAYO_KEYS.pushFailStreak, String(streak))
      await writeKey(db, DAYO_KEYS.pushBackoffUntil, later(now, backoffMs(streak, deps.random)))
      // fix round 1 item 4: only an offline tablet's backoff may be forgotten by the 'online' event
      await writeKey(db, DAYO_KEYS.pushBackoffReason, f.kind === 'network' ? 'network' : 'failure')
      if (f.kind === 'network') return NOT_THE_ROWS // offline: not the rows' fault, and not part of the 5xx streak (m3) — a timeout is (m1)
      const serverStreak = Number(await readKey(db, DAYO_KEYS.pushServerStreak) ?? '0') + 1
      await writeKey(db, DAYO_KEYS.pushServerStreak, String(serverStreak))
      if (serverStreak >= SERVER_STREAK_FOR_SINGLE && batch.length > 1) await startSingle(db, batch)
      const own = batch.length === 1 // a lone row fails the same way in batch mode too — it never enters R4 on its own
      return { own, chargeable: own && single }
    }
  }
}

/** M6: only the fields the tablet knows, bounded — dayo's answer is not trusted to be small. */
function knownResult(kind: string, data: unknown): Record<string, unknown> | null {
  if (kind === 'order') {
    const d = OrderAcceptedData.safeParse(data)
    if (!d.success) return null
    return {
      order_no: clipCodePoints(d.data.order_no, ORDER_NO_MAX), version: d.data.version, computed_total: d.data.computed_total, amount_mismatch: d.data.amount_mismatch,
      duplicate_of: d.data.duplicate_of.slice(0, DUPLICATE_OF_MAX).map((x) => clipCodePoints(x, ORDER_NO_MAX)),
      warnings: d.data.warnings.slice(0, WARNINGS_MAX).map((x) => clipCodePoints(x, WARNING_MAX)),
    }
  }
  if (kind === 'order_void' || kind === 'order_off_catalog') {
    const v = (kind === 'order_void' ? OrderVoidAcceptedData : OffCatalogAcceptedData).safeParse(data)
    return v.success ? { order_no: clipCodePoints(v.data.order_no, ORDER_NO_MAX), version: v.data.version } : null
  }
  // block 3 shift kinds: `{<id field>}` only (spec §4.10 · dayo 0066) — no money, nothing else kept
  if (kind === 'shift_open') { const d = ShiftOpenAcceptedData.safeParse(data); return d.success ? { shift_id: d.data.shift_id } : null }
  if (kind === 'cash_movement') { const d = CashMovementAcceptedData.safeParse(data); return d.success ? { movement_id: d.data.movement_id } : null }
  if (kind === 'cash_count') { const d = CashCountAcceptedData.safeParse(data); return d.success ? { count_id: d.data.count_id } : null }
  if (kind === 'shift_close') { const d = ShiftCloseAcceptedData.safeParse(data); return d.success ? { shift_id: d.data.shift_id } : null }
  return null
}

/**
 * R16: the data of a `rejected` verdict, kept with the dead row — today only the `exists:` / `off_catalog_exists:` conflict
 * data (spec §4.10 m2: the tablet reads order_no / reported_total / payment_is_cash from here, never from the Thai detail).
 * Known fields only, bounded (M6); anything else = null.
 */
function rejectedResult(data: unknown): Record<string, unknown> | null {
  const d = ExistsConflictData.safeParse(data)
  if (!d.success) return null
  return { order_no: clipCodePoints(d.data.order_no, ORDER_NO_MAX), version: d.data.version, reported_total: d.data.reported_total, payment_is_cash: d.data.payment_is_cash, off_catalog: d.data.off_catalog }
}

/**
 * final fix S5: order.central_order_no takes only a real dayo order number (L<yymmdd>-<seq> — BOT_ORDER_NO_RE, the same check
 * sync-problems.ts makes on an `exists:` conflict); anything else = null (the row stays sent, its result kept as it came).
 */
function centralOrderNoOf(known: Record<string, unknown>): string | null {
  const no = known['order_no']
  return typeof no === 'string' && BOT_ORDER_NO_RE.test(no) ? no : null
}

/** `from` = the status the row must still have (pending; local_only for a verdict that arrived after the owner closed it). */
async function markSent(db: RemoteDb, r: Row, v: ReceivedRowResult, at: string, from: 'pending' | 'local_only' = 'pending'): Promise<void> {
  const known = knownResult(r.tableName, v.data)
  await db.update(s.outbox).set({ status: 'sent', sentAt: at, attempts: r.attempts + 1, lastError: null, nextAttemptAt: null, resultJson: known as never }).where(and(eq(s.outbox.id, r.id), eq(s.outbox.status, from)))
  if (r.tableName === 'order_off_catalog' && known !== null) { // spec §6.4: the bill now carries dayo's number of its off-catalog bill
    await db.update(s.order).set({ centralOrderNo: centralOrderNoOf(known) }).where(eq(s.order.id, String((r.rowJson as { pos_order_id: string }).pos_order_id)))
    return
  }
  if (r.tableName !== 'order' || known === null) return // stored by dayo all the same; the bill just shows no central number · shift kinds: result only
  let computed: number | null = null
  try { computed = edgeBahtToSatang(known['computed_total'] as number) } catch { computed = null }
  await db.update(s.order).set({ centralOrderNo: centralOrderNoOf(known), centralComputedTotalSatang: computed, centralAmountMismatch: known['amount_mismatch'] as boolean, centralDuplicateOfJson: known['duplicate_of'] as string[] })
    .where(eq(s.order.id, String((r.rowJson as { pos_order_id: string }).pos_order_id)))
}

async function markDeferred(db: RemoteDb, deps: ApiDeps, r: Row, v: ReceivedRowResult, at: string, sup: Supported, serverTime: string): Promise<void> {
  const reason = v.reason ?? 'DEFERRED'
  const detail = v.detail ?? ''
  if (reason === 'PARENT_PENDING' && r.parentKey !== null) {
    const parent = await db.select({ status: s.outbox.status }).from(s.outbox).where(eq(s.outbox.idempotencyKey, r.parentKey)).get()
    // its bill is still on its way here — the child-waits-for-parent rule holds it; no try spent (review item 12).
    // A bill that is not on this tablet at all will never arrive from here: that is counted like any deferral (M5).
    if (parent !== undefined && parent.status !== 'sent') {
      await db.update(s.outbox).set({ lastError: encodeLastError(reason, detail), nextAttemptAt: null }).where(pendingRow(r.id))
      return
    }
  }
  if (reason === 'UNSUPPORTED') {
    await db.update(s.outbox).set({ lastError: encodeLastError(reason, detail, { supportedHash: hashOf(sup) }), nextAttemptAt: null }).where(pendingRow(r.id))
    return
  }
  if (reason === 'CLOCK_AHEAD') { // ruling R3: not counted; the banner is the signal (D80)
    await writeKey(db, DAYO_KEYS.clockAheadAt, at)
    const rowTime = rowTimeMs(r.rowJson, at)
    // ruling N5: far ahead (> 24 h) is only FLAGGED — the row stays pending and keeps retrying; EXCLUDE is the owner's manual choice
    const farAhead = rowTime - Date.parse(serverTime) > CLOCK_AHEAD_FAR_MS
    const text = farAhead ? `เวลาในแถวล้ำระบบกลางเกิน 24 ชม. — ${detail}` : detail
    await db.update(s.outbox).set({ lastError: encodeLastError(reason, text, farAhead ? { farAhead: true } : {}), nextAttemptAt: later(at, NO_ANSWER_RETRY_MS) }).where(pendingRow(r.id))
    return
  }
  const attempts = r.attempts + 1
  if (attempts >= STUCK_AFTER_ATTEMPTS) { await markDead(db, r, at, 'STUCK', `${reason}: ${detail}`, attempts); return }
  await db.update(s.outbox).set({ attempts, lastError: encodeLastError(reason, detail), nextAttemptAt: later(at, backoffMs(attempts, deps.random)) }).where(pendingRow(r.id))
}

/** The row's latest own time (bills: sold_at / voided_at · shift kinds: opened_at / created_at / counted_at / closed_at). */
const ROW_TIME_FIELDS = ['sold_at', 'voided_at', 'opened_at', 'created_at', 'counted_at', 'closed_at'] as const
function rowTimeMs(rowJson: unknown, fallback: string): number {
  const d = (rowJson ?? {}) as Record<string, unknown>
  const times = ROW_TIME_FIELDS.map((f) => d[f]).filter((v): v is string => typeof v === 'string').map((v) => Date.parse(v)).filter((v) => Number.isFinite(v))
  return times.length > 0 ? Math.max(...times) : Date.parse(fallback)
}

/**
 * FORBIDDEN `scope:` (spec §6.2 m1 · R14): pending, no try counted, retried in exactly 15 minutes; `scopeSince` keeps the
 * FIRST time it was seen. Counted as deferred, never on the problems page.
 */
async function markScopeWait(db: RemoteDb, r: Row, v: ReceivedRowResult, at: string): Promise<void> {
  const prev = decodeLastError(r.lastError)
  await db.update(s.outbox).set({
    nextAttemptAt: new Date(Date.parse(at) + SCOPE_RETRY_MS).toISOString(),
    lastError: encodeLastError('FORBIDDEN', clipCodePoints(v.detail ?? '', MAX_DETAIL_CODE_POINTS), { prefix: 'scope:', scopeSince: prev.scopeSince ?? at }),
  }).where(pendingRow(r.id))
}

/** No verdict / an unknown status / two verdicts: no try spent, retried in 60 s; ten in a row = an owner-visible warning (M5). */
async function markNoVerdict(db: RemoteDb, r: Row, reason: string, detail: string, at: string): Promise<void> {
  const n = (decodeLastError(r.lastError).noVerdict ?? 0) + 1
  const warn = n >= NO_VERDICT_WARN_AFTER
  await db.update(s.outbox).set({
    lastError: encodeLastError(warn ? NO_VERDICT_REPEATED : reason, warn ? `${reason} ×${n} — ระบบกลางไม่ตอบผลของแถวนี้ติดต่อกัน` : detail, { noVerdict: n }),
    nextAttemptAt: later(at, NO_ANSWER_RETRY_MS),
  }).where(pendingRow(r.id))
}

async function applyVerdicts(db: RemoteDb, deps: ApiDeps, batch: Row[], answer: Timed<{ server_time: string; results: ReceivedRowResult[] }>, sup: Supported): Promise<Pick<PushOutcome, 'sent' | 'rejected' | 'deferred' | 'noAnswer'> & { released: string[] }> {
  return db.transaction(async (tx) => {
    const at = deps.now()
    await recordServerTime(tx, answer.value.server_time, answer.sentAtMs, answer.receivedAtMs, at)
    // M4: a refused key (E1/E3 answered 401/403 while this push was on the wire) or a refused base URL is not undone by this 200
    if (!blockedStates.has((await readKey(tx, DAYO_KEYS.apiState)) ?? '')) await writeKey(tx, DAYO_KEYS.apiState, 'ok')
    await writeKey(tx, DAYO_KEYS.lastPushAt, at)
    await deleteKey(tx, DAYO_KEYS.pushFailStreak)
    await deleteKey(tx, DAYO_KEYS.pushServerStreak)
    await deleteKey(tx, DAYO_KEYS.pushBackoffUntil)
    await deleteKey(tx, DAYO_KEYS.pushBackoffReason)
    await forgetSingle(tx, batch.map((r) => r.id)) // a 200 decides every row of the request for R4, whatever its verdict
    // match by key, never by position (spec §6.2) · a null key (A6: dayo could not read the sent key) matches no row
    const byKey = new Map<string, ReceivedRowResult>()
    const twice = new Set<string>()
    for (const v of answer.value.results) {
      if (v.key === null) continue
      if (byKey.has(v.key)) twice.add(v.key)
      byKey.set(v.key, v)
    }
    const t = { sent: 0, rejected: 0, deferred: 0, noAnswer: 0 }
    const rejectedKeys: string[] = []
    const sentKeys: string[] = []
    for (const r of batch) {
      // review item 3: only a row still pending in THIS transaction is judged — an earlier decision in the batch is never overwritten
      const status = (await tx.select({ status: s.outbox.status }).from(s.outbox).where(eq(s.outbox.id, r.id)).get())?.status
      const v = twice.has(r.idempotencyKey) ? undefined : byKey.get(r.idempotencyKey)
      if (status === 'local_only' && v !== undefined && KNOWN_SUCCESS.has(v.status)) {
        // Task 14 fix round 1 (item 2 · block-2 ledger ruling 1): the owner closed this row ("ปิดไว้ในเครื่อง", keepShiftLocal)
        // while a request carrying it was on the wire, and dayo STORED it. The tablet must say so — the money is in dayo —
        // or the owner may enter it again on the web. The row becomes sent (dayo's data kept as usual), an audit_log row
        // records that it reached dayo after the close, and a bill closed "ปิดไว้ในเครื่อง" is no longer shown as outside dayo.
        await markSent(tx, r, v, at, 'local_only')
        let previousExcludedAt: string | null = null
        let restored: string[] = []
        let queuedVoid: string | null = null
        let queuedVoidError: string | null = null
        if (r.tableName === 'order' || r.tableName === 'order_off_catalog') {
          const orderId = String((r.rowJson as { pos_order_id: string }).pos_order_id)
          previousExcludedAt = (await tx.select({ x: s.order.excludedAt }).from(s.order).where(eq(s.order.id, orderId)).get())?.x ?? null
          await tx.update(s.order).set({ excludedAt: null }).where(eq(s.order.id, orderId))
          restored = await restoreExcludedChildren(tx, r, orderId) // fix round 2: its void must reach dayo too
          ;({ key: queuedVoid, error: queuedVoidError } = await queueMissingVoid(tx, deps, r, orderId, at)) // fix round 3: a void cancelSale did not queue (the bill was excluded then)
        }
        await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'sync_row', entityId: r.idempotencyKey, action: SENT_AFTER_LOCAL_ACTION, beforeJson: { status: 'local_only', excludedAt: previousExcludedAt }, afterJson: { status: 'sent', verdict: v.status, restoredChildren: restored, queuedVoid, ...(queuedVoidError === null ? {} : { queuedVoidError }) }, actorUserId: null, at })
        t.sent++
        continue
      }
      if (status !== 'pending') continue
      const prefix = detailPrefix(v?.detail)
      if (v !== undefined && KNOWN_SUCCESS.has(v.status)) { await markSent(tx, r, v, at); sentKeys.push(r.idempotencyKey); t.sent++ }
      else if (v?.status === 'rejected' && v.reason === 'FORBIDDEN' && prefix === 'scope:') { await markScopeWait(tx, r, v, at); t.deferred++ } // not dead: no cascade
      else if (v?.status === 'rejected') {
        // fix round 1 item 4: a reason the tablet writes itself (PARENT_REJECTED, STUCK, …) is never taken from dayo — it would
        // hide the row's buttons or its count; it is dayo's plain rejection
        const reason = v.reason === undefined || v.reason === '' || TABLET_OWN_REASONS.has(v.reason) ? 'REJECTED' : v.reason
        await markDead(tx, r, at, reason, v.detail ?? '', r.attempts + 1, prefix === null ? {} : { prefix }, rejectedResult(v.data))
        rejectedKeys.push(r.idempotencyKey); t.rejected++
      }
      else if (v?.status === 'deferred') { await markDeferred(tx, deps, r, v, at, sup, answer.value.server_time); t.deferred++ }
      else {
        const reason = twice.has(r.idempotencyKey) ? 'DUPLICATE_VERDICT' : v === undefined ? 'NO_ANSWER' : `UNKNOWN_STATUS:${clipCodePoints(v.status, 40)}`
        await markNoVerdict(tx, r, reason, v?.detail ?? '', at)
        t.noAnswer++
      }
    }
    // after the loop: children waiting for a rejected parent (including a void in this same batch that got its own
    // PARENT_PENDING verdict above) end as PARENT_REJECTED, so retryRow can wake them later
    for (const k of rejectedKeys) await cascadeChildren(tx, k, at)
    // R18 · spec §4.10: a parent accepted (or duplicate) brings back its PARENT_REJECTED children, in the same transaction
    const released = await releaseChildIds(tx, sentKeys)
    return { ...t, released }
  })
}

/**
 * Task 14 fix round 2: dayo stored a bill the owner had just closed "ปิดไว้ในเครื่อง" — the children that close took along
 * (listed in the EXCLUDED_FROM_SYNC event of this very row) come back to the queue: its void must reach dayo too, or dayo
 * counts a cancelled bill as a sale. Only those still local_only and still waiting on THIS row — a void the owner closed on
 * its own, or one moved to another parent, stays as it is (enqueuePush's parent rules are untouched). Shift-lane rows are
 * never restored: a shift kept local stays local (keepShiftLocal · R19). Returns their keys.
 */
async function restoreExcludedChildren(tx: RemoteDb, r: Row, orderId: string): Promise<string[]> {
  const events = await tx.select({ payload: s.orderEvent.payloadJson }).from(s.orderEvent)
    .where(and(eq(s.orderEvent.orderId, orderId), eq(s.orderEvent.type, 'EXCLUDED_FROM_SYNC'))).orderBy(desc(s.orderEvent.seq)).all()
  const ev = events.map((e) => e.payload as { key?: unknown; children?: unknown }).find((p) => p.key === r.idempotencyKey)
  const listed = Array.isArray(ev?.children) ? ev.children.filter((k): k is string => typeof k === 'string') : []
  if (listed.length === 0) return []
  const kids = await tx.select({ id: s.outbox.id, key: s.outbox.idempotencyKey }).from(s.outbox)
    .where(and(inArray(s.outbox.idempotencyKey, listed), eq(s.outbox.tableName, 'order_void'), eq(s.outbox.parentKey, r.idempotencyKey), eq(s.outbox.status, 'local_only'))).all()
  if (kids.length === 0) return []
  await tx.update(s.outbox).set({ status: 'pending', attempts: 0, deadAt: null, nextAttemptAt: null, lastError: null })
    .where(and(inArray(s.outbox.id, kids.map((k) => k.id)), eq(s.outbox.status, 'local_only')))
  return kids.map((k) => k.key)
}

/**
 * Task 14 fix round 3 (ruling option ก): the bill was cancelled here AFTER the owner closed it "ปิดไว้ในเครื่อง" — cancelSale
 * then queues no order_void (an excluded bill has no central void) — and dayo stored the bill all the same. Its void is
 * queued now, in the same transaction, exactly as cancelSale builds it (the VOIDED event: who, the owner who approved,
 * the reason · voided_at = the bill's voided_at), under this row as its parent (enqueuePush's parent rule), so dayo does
 * not keep a cancelled bill as a sale. Nothing when the bill is not voided, has no sold_at, or already has a void row.
 * Returns the queued key, or null.
 * final fix S1: runs inside applyVerdicts' transaction — a void row that cannot be built (PushRow or the parent rule refuses
 * it) must never throw there, or the whole batch's verdicts roll back and the queue stalls on one row (Iron Rule 5). It is
 * checked first and left unqueued; the error goes into the SENT_AFTER_LOCAL audit row for the owner to see.
 */
async function queueMissingVoid(tx: RemoteDb, deps: ApiDeps, r: Row, orderId: string, at: string): Promise<{ key: string | null; error: string | null }> {
  const none = { key: null, error: null }
  const order = await tx.select().from(s.order).where(eq(s.order.id, orderId)).get()
  if (order === undefined || order.status !== 'voided' || order.voidedAt === null || order.soldAt === null) return none
  const key = rowKey('order_void', orderId)
  if ((await tx.select({ id: s.outbox.id }).from(s.outbox).where(eq(s.outbox.idempotencyKey, key)).get()) !== undefined) return none
  const voided = await tx.select().from(s.orderEvent).where(and(eq(s.orderEvent.orderId, orderId), eq(s.orderEvent.type, 'VOIDED'))).orderBy(desc(s.orderEvent.seq)).limit(1).get()
  const p = (voided?.payloadJson ?? {}) as { reason?: unknown; approvedBy?: unknown }
  if (voided === undefined || typeof p.reason !== 'string') return none
  const data = { pos_order_id: orderId, voided_at: order.voidedAt, staff_id: voided.actorId, approved_by: typeof p.approvedBy === 'string' ? p.approvedBy : null, reason: p.reason }
  const checked = PushRow.safeParse({ key, kind: 'order_void', data })
  if (!checked.success) {
    return { key: null, error: clipCodePoints(`E2 order_void row: ${checked.error.issues.slice(0, 3).map((x) => `${x.path.join('.')} ${x.message}`).join(' · ')}`, MAX_DETAIL_CODE_POINTS) }
  }
  try {
    await enqueuePush(tx, { kind: 'order_void', id: orderId, data, parentKey: r.idempotencyKey }, notBeforeIso(at, order.voidedAt), deps.newId)
  } catch (e) {
    return { key: null, error: clipCodePoints(e instanceof Error ? e.message : String(e), MAX_DETAIL_CODE_POINTS) }
  }
  return { key, error: null }
}
const notBeforeIso = (a: string, b: string): string => (Date.parse(a) < Date.parse(b) ? b : a)

/**
 * One call of the sender (item 8 — the states it moves through):
 *
 * | state                         | how it is entered                                   | how it ends                                            |
 * |-------------------------------|-----------------------------------------------------|--------------------------------------------------------|
 * | gated (no request)            | not linked · apiBlocked · backoff running · no list | the owner re-links · the backoff runs out · E1 answers |
 * | batch mode (≤ 20 rows)        | push_single_through absent                          | 3 × 5xx/timeout/bad 200 in a row, or a 422 → one-row   |
 * | one-row mode                  | push_single_through = ids of the failed batch       | every one of those rows decided (a 200, or ENVELOPE)   |
 * | provisional charges (one-row) | a request that carried only this row failed         | a 200 of a later row (kept) · K in a row, a failure    |
 * |                               |                                                     | no row is blamed for, the queue running out, or the    |
 * |                               |                                                     | round cap (all refunded)                               |
 * | whole-request backoff         | network / timeout / 5xx / bad 200 (5 s … 15 min)    | a 200 · 'online' wake (network cause only) · manual /  |
 * |                               | · a 429 of E1 or E2 (Retry-After)                   | open / before_close wake ≤ once per 30 s (never 429's) |
 */
export async function pushOnce(ctx: SyncContext): Promise<PushOutcome> {
  const out: PushOutcome = { requests: 0, sent: 0, rejected: 0, deferred: 0, held: 0, noAnswer: 0, stopped: null }
  const g = await ctx.serial(() => gate(ctx.db, ctx.deps))
  if (g.blocked !== null || g.cfg === null || g.sup === null) return { ...out, stopped: g.blocked ?? 'not_linked' }
  const sup = g.sup
  let client: DayoClient
  try {
    client = createDayoClient({ ...g.cfg, fetch: ctx.deps.fetch, nowMs: () => Date.parse(ctx.deps.now()) })
  } catch (e) {
    // a stored base URL the client refuses (a restored backup can carry one): nothing is sent, no backoff — the owner re-links.
    // The message never echoes the URL (normalizeBaseUrl).
    const failure: DayoFailure = { kind: 'bad_base_url', message: e instanceof Error ? e.message : 'BAD_BASE_URL' }
    await ctx.serial(() => recordDayoFailure(ctx.db, ctx.deps, failure))
    return { ...out, stopped: 'bad_base_url' }
  }
  const decided = new Set<string>() // plan 5 fix H-1: judged once per call
  let provisional: Provisional[] = [] // fix round 3: charged rows of this call waiting for a 200 (confirm) or K failures (refund)
  let failuresInRow = 0 // one-row requests failing in a row in this call (K) — a row that died STUCK counts too
  const refundAll = async (): Promise<void> => {
    const list = provisional
    provisional = []
    if (list.length > 0) await ctx.serial(() => refundCharges(ctx.db, list, ctx.deps.now()))
  }
  for (let round = 0; round < MAX_ROUNDS_PER_CALL; round++) {
    const nowIso = ctx.deps.now()
    const probe = provisional.length > 0
    const { batch, held, single } = await ctx.serial(async () => {
      const size = await batchSize(ctx.db, sup)
      return { ...(await pickBatch(ctx.db, nowIso, sup, size, decided, { rotate: size === 1, probe: size === 1 && probe })), single: size === 1 }
    })
    out.held = held
    if (batch.length === 0) { await refundAll(); return out } // the queue ran out before K failures: refund, always (Path A)
    for (const r of batch) decided.add(r.id)
    const body = { device_time: nowIso, rows: batch.map((r) => ({ key: r.idempotencyKey, kind: r.tableName, data: r.rowJson })) } as PushRequest
    let answer: Timed<{ server_time: string; results: ReceivedRowResult[] }>
    try {
      answer = await client.push(body) // network OUTSIDE the serial queue — sales keep going (plan 5 L-R3)
    } catch (e) {
      if (!(e instanceof DayoError)) throw e
      out.requests++
      const f = e.failure
      const verdict = await ctx.serial(() => onRequestFailure(ctx.db, ctx.deps, f, batch, single))
      const chargeable = verdict.chargeable
      out.stopped = f.kind
      if (f.kind === 'bad_envelope') { provisional = []; return out } // dayo judged the request = it is up: the charges stand
      if (verdict.own) {
        const row = batch[0]!
        const own = nextOwn(row, ctx.deps.now())
        const stuck = await ctx.serial(() => recordOwnFailure(ctx.db, ctx.deps, row, f, own, chargeable))
        if (chargeable) {
          if (!stuck) {
            const chargedAt = ctx.deps.now()
            await ctx.serial(() => chargeRow(ctx.db, ctx.deps, row, f, chargedAt, own))
            provisional.push({ row, chargedAt, own })
          }
          if (++failuresInRow < SINGLE_FAILURES_PER_CALL) continue // probe the next row
        }
      }
      await refundAll() // K in a row, or a failure no row can be blamed for: dayo is down — the whole-request backoff holds
      return out
    }
    provisional = [] // confirmed by this 200
    failuresInRow = 0
    out.stopped = null
    out.requests++
    const t = await ctx.serial(() => applyVerdicts(ctx.db, ctx.deps, batch, answer, sup))
    out.sent += t.sent; out.rejected += t.rejected; out.deferred += t.deferred; out.noAnswer += t.noAnswer
    for (const id of t.released) decided.add(id) // a released child goes from the next call on — judged once per call
  }
  await refundAll() // the round cap ended the call in the middle of a run: no row is blamed
  return out
}

/**
 * Task 14: a wake that means "the network may be back" forgets the failure backoff of E2 and E1 — never a 429's
 * Retry-After (review item 2). `onlyNetwork` (fix round 1 item 4, the 'online' event): only a backoff an offline tablet
 * caused; a 5xx / timeout one must run out (or be cleared by a manual / open / before_close wake, ≤ once per 30 s).
 * It leaves push_server_streak alone ON PURPOSE: that count says dayo itself kept answering 5xx / unreadable 200s,
 * which a reconnect does not change — only dayo's next 200 clears it (and with it the way into R4 one-row mode).
 */
/** final review M3: is there a failure backoff a wake could clear (not a 429's — that one only runs out)? */
export async function hasClearableBackoff(db: RemoteDb, opts: { onlyNetwork?: boolean } = {}): Promise<boolean> {
  const may = (reason: string | null): boolean => reason !== null && reason !== 'rate_limited' && (opts.onlyNetwork !== true || reason === 'network')
  return may(await readKey(db, DAYO_KEYS.pushBackoffReason)) || may(await readKey(db, DAYO_KEYS.catalogBackoffReason))
}

export async function clearFailureBackoff(db: RemoteDb, opts: { onlyNetwork?: boolean } = {}): Promise<void> {
  const may = (reason: string | null): boolean => reason !== 'rate_limited' && (opts.onlyNetwork !== true || reason === 'network')
  if (may(await readKey(db, DAYO_KEYS.pushBackoffReason))) {
    await deleteKey(db, DAYO_KEYS.pushBackoffUntil)
    await deleteKey(db, DAYO_KEYS.pushFailStreak)
    await deleteKey(db, DAYO_KEYS.pushBackoffReason)
  }
  if (may(await readKey(db, DAYO_KEYS.catalogBackoffReason))) {
    await deleteKey(db, DAYO_KEYS.catalogBackoffUntil)
    await deleteKey(db, DAYO_KEYS.catalogFailStreak)
    await deleteKey(db, DAYO_KEYS.catalogBackoffReason)
  }
}

/**
 * Task 17 fix round 1 item 3 (ruling): a scope-wait row (`markScopeWait`, FORBIDDEN `scope:`) otherwise sits out its
 * full SCOPE_RETRY_MS (15 real minutes) — even a manual "ส่งตอนนี้" wake would not resend it a moment sooner, since
 * `pendingRows`'s `isShiftLane` only lets the lane picker SEE it early (so it keeps holding the lane), never send it
 * again. The owner just added the scope back on dayo's website — nothing here is worth waiting 15 minutes for once
 * they press "ส่งตอนนี้" — so a manual wake (already throttled to at most once per 30 s, same as the failure-backoff
 * clear right above) also makes every scope-wait row due again right away. An automatic wake (the minute tick, a
 * write) still waits the full 15 minutes — only 'manual' reaches this.
 */
export async function hasScopeWait(db: RemoteDb): Promise<boolean> {
  const r = await db.values<[number]>(sql`select count(*) from outbox where status = 'pending' and json_valid(last_error) and json_extract(last_error, '$.prefix') = 'scope:'`)
  return (r[0]?.[0] ?? 0) > 0
}
export async function clearScopeWait(db: RemoteDb, at: string): Promise<void> {
  await db.update(s.outbox).set({ nextAttemptAt: at })
    .where(and(eq(s.outbox.status, 'pending'), sql`json_valid(last_error) and json_extract(last_error, '$.prefix') = 'scope:'`))
}

/** Owner's "ลองใหม่" (spec §6.4): dead → pending with a fresh budget; children parked as PARENT_REJECTED come back too. */
export async function retryRow(db: RemoteDb, outboxId: string): Promise<void> {
  const r = await db.select().from(s.outbox).where(eq(s.outbox.id, outboxId)).get()
  if (r === undefined || r.status !== 'dead') return
  // a dead row carries no ownFailures (markDead writes no extras), so its own count starts again from 0 as well
  await db.update(s.outbox).set({ status: 'pending', attempts: 0, deadAt: null, nextAttemptAt: null }).where(eq(s.outbox.id, r.id))
  await releaseChildren(db, [r.idempotencyKey]) // preflight P6: one releaser (they wait for the parent again in the queue)
}

/** The ids releaseChildren put back (pushOnce keeps them out of the rest of its call). */
async function releaseChildIds(tx: RemoteDb, parentKeys: readonly string[]): Promise<string[]> {
  if (parentKeys.length === 0) return []
  const rows = await tx.select({ id: s.outbox.id, lastError: s.outbox.lastError }).from(s.outbox).where(and(inArray(s.outbox.parentKey, [...parentKeys]), eq(s.outbox.status, 'dead'))).all()
  const ids = rows.filter((x) => decodeLastError(x.lastError).reason === 'PARENT_REJECTED').map((x) => x.id)
  if (ids.length > 0) await tx.update(s.outbox).set({ status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null, deadAt: null }).where(and(inArray(s.outbox.id, ids), eq(s.outbox.status, 'dead')))
  return ids
}

/**
 * R18 · spec §4.10: once a parent is accepted (or acknowledged), its PARENT_REJECTED children go back to the queue in
 * their old order (created_at is untouched) with a fresh budget. Only children dead for PARENT_REJECTED — a child dead
 * for its own reason stays on the problems page. The same key is sent again, so dayo can never store a row twice.
 */
export async function releaseChildren(tx: RemoteDb, parentKeys: readonly string[]): Promise<number> {
  return (await releaseChildIds(tx, parentKeys)).length
}
