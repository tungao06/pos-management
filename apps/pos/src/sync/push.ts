import { and, asc, eq, getTableColumns, gt, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { clipCodePoints, isRowSupported, MAX_PUSH_BODY_BYTES, MAX_PUSH_ROWS, OrderAcceptedData, OrderVoidAcceptedData, PUSH_KINDS, type PushRequest, type ReceivedRowResult, type Supported } from '@dayo/contracts'
import { edgeBahtToSatang } from '@dayo/domain'
import type { ApiDeps } from '../api/deps'
import { apiBlocked, readDayoConfig, readSupported, recordDayoFailure, type SyncContext } from './catalog'
import { createDayoClient, DayoError, type DayoClient, type DayoFailure, type Timed } from './dayo-client'
import { BACKOFF_MS, backoffMs, DAYO_KEYS, decodeLastError, deleteKey, encodeLastError, NO_ANSWER_RETRY_MS, RATE_LIMIT_DEFAULT_MS, readKey, recordServerTime, STUCK_AFTER_ATTEMPTS, writeKey, type LastErrorExtra } from './state'

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
/** One-row mode reads the queue by this key: a row refunded after an outage (next_attempt_at = refund time) goes to the back. */
const effTime = sql<string>`coalesce(${s.outbox.nextAttemptAt}, ${s.outbox.createdAt})`
/** (created_at, rowid) strictly after a mark — the keyset of the page reader. */
const afterMark = (m: Mark): SQL => or(gt(s.outbox.createdAt, m.createdAt), and(eq(s.outbox.createdAt, m.createdAt), sql`rowid > ${m.rid}`))!
const blockedStates = new Set(['unauthorized', 'forbidden', 'bad_base_url'])

/** Every status change of a row is guarded by `status = 'pending'` — a decision already taken is never overwritten. */
const pendingRow = (id: string): SQL => and(eq(s.outbox.id, id), eq(s.outbox.status, 'pending'))!

async function markDead(db: RemoteDb, r: Row, at: string, reason: string, detail: string, attempts = r.attempts): Promise<void> {
  await db.update(s.outbox).set({ status: 'dead', deadAt: at, attempts, nextAttemptAt: null, lastError: encodeLastError(reason, detail) }).where(pendingRow(r.id))
}

/** A parent that became dead takes its waiting children with it (spec §4.5 table: PARENT_REJECTED). */
async function cascadeChildren(db: RemoteDb, parentKey: string, at: string): Promise<void> {
  const kids = await db.select({ ...getTableColumns(s.outbox), rid: rowid }).from(s.outbox).where(and(eq(s.outbox.parentKey, parentKey), eq(s.outbox.status, 'pending'))).all()
  for (const k of kids) await markDead(db, k, at, 'PARENT_REJECTED', `แถวแม่ ${parentKey} ส่งไม่ผ่าน — จะส่งเองเมื่อแถวแม่ผ่าน`)
}

/** Held = not sent and not counted: dayo does not list its kind/fields, or answered UNSUPPORTED under this same list. */
function isHeld(r: { tableName: string; rowJson: unknown; lastError: string | null }, sup: Supported): boolean {
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
 * rowid). `rotate` (R4 one-row mode, fix round 3) = keyset on (coalesce(next_attempt_at, created_at), created_at, rowid),
 * so rows refunded after a run of failures are tried after the others and a run of failing rows cannot wedge the head.
 * A child still never goes before its parent: pickBatch checks the parent whatever the order.
 */
async function* pendingRows(db: RemoteDb, nowIso: string, rotate: boolean): AsyncGenerator<Row> {
  let after: (Mark & { eff: string }) | null = null
  for (;;) {
    const keyset = after === null ? undefined
      : rotate ? sql`(${effTime}, ${s.outbox.createdAt}, rowid) > (${after.eff}, ${after.createdAt}, ${after.rid})` : afterMark(after)
    const page: (Row & { eff: string })[] = await db.select({ ...getTableColumns(s.outbox), rid: rowid, eff: effTime }).from(s.outbox)
      .where(and(eq(s.outbox.status, 'pending'), isPushKind, or(isNull(s.outbox.nextAttemptAt), lte(s.outbox.nextAttemptAt, nowIso)), keyset))
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
 */
async function pickBatch(db: RemoteDb, nowIso: string, sup: Supported, size: number, decided: Set<string>, opts: { rotate: boolean; probe: boolean } = { rotate: false, probe: false }): Promise<{ batch: Row[]; held: number }> {
  const batch: Row[] = []
  let fallback: Row | null = null
  const inBatch = new Set<string>()
  let bytes = ENVELOPE_BYTES
  let held = 0
  for await (const r of pendingRows(db, nowIso, opts.rotate)) {
    if (decided.has(r.id)) continue
    if (isHeld(r, sup)) { held++; continue }
    // a child never goes before its parent: the parent must be sent already, or sit earlier in this same batch
    if (r.parentKey !== null && !inBatch.has(r.parentKey)) {
      const parent = await db.select({ status: s.outbox.status }).from(s.outbox).where(eq(s.outbox.idempotencyKey, r.parentKey)).get()
      if (parent?.status === 'dead') { await markDead(db, r, nowIso, 'PARENT_REJECTED', `แถวแม่ ${r.parentKey} ส่งไม่ผ่าน`); decided.add(r.id); continue }
      if (parent?.status === 'local_only') { await db.update(s.outbox).set({ status: 'local_only', nextAttemptAt: null }).where(pendingRow(r.id)); decided.add(r.id); continue }
      if (parent !== undefined && parent.status !== 'sent') continue // wait for the parent
    }
    const b = rowBytes(r)
    if (ENVELOPE_BYTES + b > MAX_PUSH_BODY_BYTES) { await markDead(db, r, nowIso, 'ENVELOPE', 'แถวนี้ใหญ่เกิน 256 KB'); decided.add(r.id); continue }
    if (bytes + b > MAX_PUSH_BODY_BYTES) break
    if (opts.probe && !isTrusted(r)) { fallback ??= r; continue }
    batch.push(r)
    inBatch.add(r.idempotencyKey)
    bytes += b
    if (batch.length >= size) break
  }
  if (batch.length === 0 && fallback !== null) batch.push(fallback)
  return { batch, held }
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
 * security I2 + fix rounds 2–3 (controller rulings): in one-row mode a request that failed with 5xx / an unknown 4xx /
 * an unreadable 200 / a timeout is charged to its row PROVISIONALLY, and the call goes on to the next row (a probe).
 * - A 200 (or a 422 verdict on a row) = dayo is up: every provisional charge of the call is confirmed.
 * - K = SINGLE_FAILURES_PER_CALL failures in a row, or a failure that cannot be charged (offline, 401/403/404, 429) =
 *   dayo is down: every provisional charge is refunded (refundCharges), the call stops, the whole-request backoff holds.
 * - The queue runs out of sendable rows before K failures: every provisional charge is refunded, always (task 14 fix
 *   round 1, Path A). Nothing in the call showed dayo was up, and a 15-hour outage with two rows left must not spend
 *   their 50 tries. So a row is charged only when a later row of the SAME call gets a 200: a poison row alone in the
 *   queue waits under the whole-request backoff (≤ 15 min) and is never charged — it reaches STUCK only while the shop
 *   keeps selling (each new good bill confirms one charge); meanwhile it shows as pending (> 24 h = pendingOver24h).
 */
/** The owner banner (farAhead) and the M5 count (noVerdict) outlive a charge or a refund (task 14 item 7). */
function keptExtras(lastError: string | null): LastErrorExtra {
  const d = decodeLastError(lastError)
  return { ...(d.farAhead === true ? { farAhead: true as const } : {}), ...(d.noVerdict !== undefined ? { noVerdict: d.noVerdict } : {}), requestFailed: true }
}
type Provisional = { row: Row; chargedAt: string }
async function chargeRow(db: RemoteDb, deps: ApiDeps, r: Row, f: DayoFailure, at: string): Promise<void> {
  const attempts = r.attempts + 1
  const detail = f.kind === 'server' ? `HTTP ${f.status}` : f.kind
  if (attempts >= STUCK_AFTER_ATTEMPTS) { await markDead(db, r, at, 'STUCK', `${REQUEST_FAILED}: ${detail}`, attempts); return }
  await db.update(s.outbox).set({ attempts, lastError: encodeLastError(REQUEST_FAILED, detail, keptExtras(r.lastError)), nextAttemptAt: later(at, backoffMs(attempts, deps.random)) }).where(pendingRow(r.id))
}

/**
 * Undoes provisional charges: attempts and dead_at go back to what they were when the row was picked (a STUCK the charge
 * reached is undone too). m2: only the charge's own result is undone — pending with attempts+1, or dead with the dead_at
 * the charge wrote. Rotation (fix round 3): next_attempt_at = the refund time, so one-row mode tries the other rows first.
 */
async function refundCharges(db: RemoteDb, list: Provisional[], at: string): Promise<void> {
  for (const { row: r, chargedAt } of list) {
    await db.update(s.outbox)
      .set({ status: 'pending', attempts: r.attempts, deadAt: r.deadAt, nextAttemptAt: at, lastError: encodeLastError(REQUEST_FAILED, 'ส่งไม่ผ่านติดกันหลายแถว — ถือว่าระบบกลางล่ม ไม่นับครั้ง', keptExtras(r.lastError)) })
      .where(and(eq(s.outbox.id, r.id), eq(s.outbox.attempts, r.attempts + 1),
        or(eq(s.outbox.status, 'pending'), and(eq(s.outbox.status, 'dead'), eq(s.outbox.deadAt, chargedAt)))))
  }
}

/** Records a failed request. Returns true when the failure may be charged to the single row of a one-row request (the caller decides). */
async function onRequestFailure(db: RemoteDb, deps: ApiDeps, f: DayoFailure, batch: Row[], single: boolean): Promise<boolean> {
  const now = deps.now()
  switch (f.kind) {
    case 'unauthorized': case 'forbidden': case 'api_disabled': case 'bad_base_url':
      // 403 here is the whole request (the key lacks orders:write) — never a row's FORBIDDEN (spec §4.5 · §6.3)
      await recordDayoFailure(db, deps, f); return false
    case 'rate_limited':
      await writeKey(db, DAYO_KEYS.pushBackoffUntil, later(now, f.retryAfterMs))
      await writeKey(db, DAYO_KEYS.pushBackoffReason, 'rate_limited'); return false
    case 'bad_envelope':
      if (batch.length > 1) await startSingle(db, batch)
      else { await markDead(db, batch[0]!, now, 'ENVELOPE', f.message); await forgetSingle(db, [batch[0]!.id]) } // the queue moves on (spec §6.3 row 422)
      return false
    default: { // network, timeout, server (5xx and unknown 4xx), bad_response: whole-request retry with backoff (spec §6.3 row 1)
      const streak = Number(await readKey(db, DAYO_KEYS.pushFailStreak) ?? '0') + 1
      await writeKey(db, DAYO_KEYS.pushFailStreak, String(streak))
      await writeKey(db, DAYO_KEYS.pushBackoffUntil, later(now, backoffMs(streak, deps.random)))
      // fix round 1 item 4: only an offline tablet's backoff may be forgotten by the 'online' event
      await writeKey(db, DAYO_KEYS.pushBackoffReason, f.kind === 'network' ? 'network' : 'failure')
      if (f.kind === 'network') return false // offline: not the rows' fault, and not part of the 5xx streak (m3) — a timeout is (m1)
      const serverStreak = Number(await readKey(db, DAYO_KEYS.pushServerStreak) ?? '0') + 1
      await writeKey(db, DAYO_KEYS.pushServerStreak, String(serverStreak))
      if (serverStreak >= SERVER_STREAK_FOR_SINGLE && batch.length > 1) await startSingle(db, batch)
      return single && batch.length === 1
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
  const v = OrderVoidAcceptedData.safeParse(data)
  return v.success ? { order_no: clipCodePoints(v.data.order_no, ORDER_NO_MAX), version: v.data.version } : null
}

async function markSent(db: RemoteDb, r: Row, v: ReceivedRowResult, at: string): Promise<void> {
  const known = knownResult(r.tableName, v.data)
  await db.update(s.outbox).set({ status: 'sent', sentAt: at, attempts: r.attempts + 1, lastError: null, nextAttemptAt: null, resultJson: known as never }).where(pendingRow(r.id))
  if (r.tableName !== 'order' || known === null) return // stored by dayo all the same; the bill just shows no central number
  let computed: number | null = null
  try { computed = edgeBahtToSatang(known['computed_total'] as number) } catch { computed = null }
  await db.update(s.order).set({ centralOrderNo: known['order_no'] as string, centralComputedTotalSatang: computed, centralAmountMismatch: known['amount_mismatch'] as boolean, centralDuplicateOfJson: known['duplicate_of'] as string[] })
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
    const data = r.rowJson as { sold_at?: string; voided_at?: string }
    const rowTime = Date.parse(data.sold_at ?? data.voided_at ?? at)
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

/** No verdict / an unknown status / two verdicts: no try spent, retried in 60 s; ten in a row = an owner-visible warning (M5). */
async function markNoVerdict(db: RemoteDb, r: Row, reason: string, detail: string, at: string): Promise<void> {
  const n = (decodeLastError(r.lastError).noVerdict ?? 0) + 1
  const warn = n >= NO_VERDICT_WARN_AFTER
  await db.update(s.outbox).set({
    lastError: encodeLastError(warn ? NO_VERDICT_REPEATED : reason, warn ? `${reason} ×${n} — ระบบกลางไม่ตอบผลของแถวนี้ติดต่อกัน` : detail, { noVerdict: n }),
    nextAttemptAt: later(at, NO_ANSWER_RETRY_MS),
  }).where(pendingRow(r.id))
}

async function applyVerdicts(db: RemoteDb, deps: ApiDeps, batch: Row[], answer: Timed<{ server_time: string; results: ReceivedRowResult[] }>, sup: Supported): Promise<Pick<PushOutcome, 'sent' | 'rejected' | 'deferred' | 'noAnswer'>> {
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
    for (const r of batch) {
      // review item 3: only a row still pending in THIS transaction is judged — an earlier decision in the batch is never overwritten
      if ((await tx.select({ status: s.outbox.status }).from(s.outbox).where(eq(s.outbox.id, r.id)).get())?.status !== 'pending') continue
      const v = twice.has(r.idempotencyKey) ? undefined : byKey.get(r.idempotencyKey)
      if (v !== undefined && KNOWN_SUCCESS.has(v.status)) { await markSent(tx, r, v, at); t.sent++ }
      else if (v?.status === 'rejected') { await markDead(tx, r, at, v.reason ?? 'REJECTED', v.detail ?? '', r.attempts + 1); rejectedKeys.push(r.idempotencyKey); t.rejected++ }
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
    return t
  })
}

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
      const chargeable = await ctx.serial(() => onRequestFailure(ctx.db, ctx.deps, f, batch, single))
      out.stopped = f.kind
      if (f.kind === 'bad_envelope') { provisional = []; return out } // dayo judged the request = it is up: the charges stand
      if (chargeable) {
        const row = batch[0]!
        const chargedAt = ctx.deps.now()
        await ctx.serial(() => chargeRow(ctx.db, ctx.deps, row, f, chargedAt))
        provisional.push({ row, chargedAt })
        if (provisional.length < SINGLE_FAILURES_PER_CALL) continue // probe the next row
      }
      await refundAll() // K in a row, or a failure no row can be blamed for: dayo is down — the whole-request backoff holds
      return out
    }
    provisional = [] // confirmed by this 200
    out.stopped = null
    out.requests++
    const t = await ctx.serial(() => applyVerdicts(ctx.db, ctx.deps, batch, answer, sup))
    out.sent += t.sent; out.rejected += t.rejected; out.deferred += t.deferred; out.noAnswer += t.noAnswer
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

/** Owner's "ลองใหม่" (spec §6.4): dead → pending with a fresh budget; children parked as PARENT_REJECTED come back too. */
export async function retryRow(db: RemoteDb, outboxId: string): Promise<void> {
  const r = await db.select().from(s.outbox).where(eq(s.outbox.id, outboxId)).get()
  if (r === undefined || r.status !== 'dead') return
  await db.update(s.outbox).set({ status: 'pending', attempts: 0, deadAt: null, nextAttemptAt: null }).where(eq(s.outbox.id, r.id))
  const kids = await db.select().from(s.outbox).where(and(eq(s.outbox.parentKey, r.idempotencyKey), eq(s.outbox.status, 'dead'))).all()
  for (const k of kids) if (decodeLastError(k.lastError).reason === 'PARENT_REJECTED') await db.update(s.outbox).set({ status: 'pending', attempts: 0, deadAt: null, nextAttemptAt: null }).where(eq(s.outbox.id, k.id))
}
