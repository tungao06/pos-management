import { and, asc, eq, getTableColumns, gt, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { clipCodePoints, isRowSupported, MAX_PUSH_BODY_BYTES, MAX_PUSH_ROWS, OrderAcceptedData, OrderVoidAcceptedData, PUSH_KINDS, type PushRequest, type ReceivedRowResult, type Supported } from '@dayo/contracts'
import { edgeBahtToSatang } from '@dayo/domain'
import type { ApiDeps } from '../api/deps'
import { apiBlocked, readDayoConfig, readSupported, recordDayoFailure, type SyncContext } from './catalog'
import { createDayoClient, DayoError, type DayoClient, type DayoFailure, type Timed } from './dayo-client'
import { BACKOFF_MS, backoffMs, DAYO_KEYS, decodeLastError, deleteKey, encodeLastError, NO_ANSWER_RETRY_MS, RATE_LIMIT_DEFAULT_MS, readKey, recordServerTime, STUCK_AFTER_ATTEMPTS, writeKey } from './state'

export type PushOutcome = { requests: number; sent: number; rejected: number; deferred: number; held: number; noAnswer: number; stopped: null | 'not_linked' | 'no_supported_list' | 'api_blocked' | 'backoff' | DayoFailure['kind'] }

/**
 * An outbox row plus its SQLite rowid. The queue is read in (created_at, rowid) order: a void's created_at can EQUAL its
 * bill's (the void time clamped to sold_at), and UUIDv7 ids inside one millisecond are not ordered, so only the rowid —
 * assigned in insertion order — keeps a bill ahead of its void when the timestamps tie.
 *
 * The outbox has no INTEGER PRIMARY KEY, so a plain `VACUUM` of the live database may renumber its rowids. Do not run
 * VACUUM on the live database without reviewing this ordering first (`VACUUM INTO`, used by the backup, writes a copy
 * and leaves the live rowids alone).
 */
type Row = typeof s.outbox.$inferSelect & { rid: number }
type Mark = { createdAt: string; rid: number }

/** plan 5 fix M-2: only these mean dayo stored the row. */
const KNOWN_SUCCESS = new Set(['accepted', 'duplicate'])
const utf8 = new TextEncoder()
const ENVELOPE_BYTES = 80 // {"device_time":"2026-…Z","rows":[]} is 52 bytes; the rest is slack
const MAX_ROUNDS_PER_CALL = 15 // ≤ 300 rows per call; the scheduler calls again (bounds the time one call can take)
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
const ORDER_NO_MAX = 100          // M6: code points
const DUPLICATE_OF_MAX = 20       // M6: entries
const WARNINGS_MAX = 20
const WARNING_MAX = 200
const PAGE = 200
const rowid = sql<number>`rowid`.mapWith(Number)
const isPushKind = inArray(s.outbox.tableName, [...PUSH_KINDS])
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

/** Reads the queue page by page (keyset on created_at, rowid) until a batch is full or the queue ends (review item 20). */
async function* pendingRows(db: RemoteDb, nowIso: string): AsyncGenerator<Row> {
  let after: Mark | null = null
  for (;;) {
    const page: Row[] = await db.select({ ...getTableColumns(s.outbox), rid: rowid }).from(s.outbox)
      .where(and(eq(s.outbox.status, 'pending'), isPushKind, or(isNull(s.outbox.nextAttemptAt), lte(s.outbox.nextAttemptAt, nowIso)), after === null ? undefined : afterMark(after)))
      .orderBy(asc(s.outbox.createdAt), asc(rowid)).limit(PAGE).all()
    for (const r of page) yield r
    if (page.length < PAGE) return
    after = { createdAt: page.at(-1)!.createdAt, rid: page.at(-1)!.rid }
  }
}

async function pickBatch(db: RemoteDb, nowIso: string, sup: Supported, size: number, decided: Set<string>): Promise<{ batch: Row[]; held: number }> {
  const batch: Row[] = []
  const inBatch = new Set<string>()
  let bytes = ENVELOPE_BYTES
  let held = 0
  for await (const r of pendingRows(db, nowIso)) {
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
    batch.push(r)
    inBatch.add(r.idempotencyKey)
    bytes += b
    if (batch.length >= size) break
  }
  return { batch, held }
}

async function gate(db: RemoteDb, deps: ApiDeps): Promise<{ cfg: { baseUrl: string; apiKey: string } | null; sup: Supported | null; blocked: PushOutcome['stopped'] }> {
  const cfg = await readDayoConfig(db, deps)
  if (cfg === null) return { cfg, sup: null, blocked: 'not_linked' }
  const now = deps.now()
  if (await apiBlocked(db, now)) return { cfg, sup: null, blocked: 'api_blocked' } // same gate as E1/E3 (Task 10)
  // a stored base URL the client refused: only re-linking fixes it (it writes api_state ok) — no request, no backoff retry
  if ((await readKey(db, DAYO_KEYS.apiState)) === 'bad_base_url') return { cfg, sup: null, blocked: 'api_blocked' }
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
 * security I2 + fix round 2 (controller ruling): in one-row mode a request that failed with 5xx / an unreadable 200 / an
 * unknown 4xx is charged to its row PROVISIONALLY. The next request of the same call decides: dayo answering it (200, or a
 * 422 verdict on that row) confirms the charge — the first row really was the poison row; any other failure means dayo
 * itself is down, so the charge is refunded (refundCharge) and the second row is not charged. A charge still pending when
 * the call ends with no other row tried is kept (a queue whose only sendable row is the poison row).
 */
async function chargeRow(db: RemoteDb, deps: ApiDeps, r: Row, f: DayoFailure, at: string): Promise<void> {
  const attempts = r.attempts + 1
  const detail = f.kind === 'server' ? `HTTP ${f.status}` : f.kind
  if (attempts >= STUCK_AFTER_ATTEMPTS) { await markDead(db, r, at, 'STUCK', `${REQUEST_FAILED}: ${detail}`, attempts); return }
  await db.update(s.outbox).set({ attempts, lastError: encodeLastError(REQUEST_FAILED, detail), nextAttemptAt: later(at, backoffMs(attempts, deps.random)) }).where(pendingRow(r.id))
}

/** Undoes a provisional charge: the row gets back exactly what it had when it was picked (a STUCK it reached is undone too). */
async function refundCharge(db: RemoteDb, r: Row): Promise<void> {
  await db.update(s.outbox).set({ status: 'pending', attempts: r.attempts, nextAttemptAt: r.nextAttemptAt, lastError: r.lastError, deadAt: r.deadAt })
    .where(and(eq(s.outbox.id, r.id), eq(s.outbox.attempts, r.attempts + 1)))
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
    default: { // network, server (5xx and unknown 4xx), bad_response: whole-request retry with backoff (spec §6.3 row 1)
      const streak = Number(await readKey(db, DAYO_KEYS.pushFailStreak) ?? '0') + 1
      await writeKey(db, DAYO_KEYS.pushFailStreak, String(streak))
      await writeKey(db, DAYO_KEYS.pushBackoffUntil, later(now, backoffMs(streak, deps.random)))
      await writeKey(db, DAYO_KEYS.pushBackoffReason, 'failure')
      if (f.kind === 'network') return false // not the rows' fault, and not part of the 5xx streak (m3)
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
  let provisional: Row | null = null // fix round 2: a charged row waiting for the next request to confirm or refund its charge
  for (let round = 0; round < MAX_ROUNDS_PER_CALL; round++) {
    const nowIso = ctx.deps.now()
    const { batch, held, single } = await ctx.serial(async () => {
      const size = await batchSize(ctx.db, sup)
      return { ...(await pickBatch(ctx.db, nowIso, sup, size, decided)), single: size === 1 }
    })
    out.held = held
    if (batch.length === 0) return out
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
      if (provisional !== null) {
        // dayo judged this row (422 ENVELOPE) = it is up, so the first failure was that row's own; anything else = dayo is down:
        // refund, charge nobody, stop — the whole-request backoff written above holds
        const first = provisional
        if (f.kind !== 'bad_envelope') await ctx.serial(() => refundCharge(ctx.db, first))
        return out
      }
      if (chargeable) {
        const row = batch[0]!
        await ctx.serial(() => chargeRow(ctx.db, ctx.deps, row, f, ctx.deps.now()))
        provisional = row
        continue // let the next row show whether this one was the cause
      }
      return out
    }
    provisional = null // confirmed by this 200
    out.stopped = null
    out.requests++
    const t = await ctx.serial(() => applyVerdicts(ctx.db, ctx.deps, batch, answer, sup))
    out.sent += t.sent; out.rejected += t.rejected; out.deferred += t.deferred; out.noAnswer += t.noAnswer
  }
  return out
}

/** Task 14: a wake that means "the network may be back" forgets the network/5xx backoff — never 429's Retry-After (review item 2). */
export async function clearFailureBackoff(db: RemoteDb): Promise<void> {
  if ((await readKey(db, DAYO_KEYS.pushBackoffReason)) === 'rate_limited') return
  await deleteKey(db, DAYO_KEYS.pushBackoffUntil)
  await deleteKey(db, DAYO_KEYS.pushFailStreak)
  await deleteKey(db, DAYO_KEYS.pushBackoffReason)
}

/** Owner's "ลองใหม่" (spec §6.4): dead → pending with a fresh budget; children parked as PARENT_REJECTED come back too. */
export async function retryRow(db: RemoteDb, outboxId: string): Promise<void> {
  const r = await db.select().from(s.outbox).where(eq(s.outbox.id, outboxId)).get()
  if (r === undefined || r.status !== 'dead') return
  await db.update(s.outbox).set({ status: 'pending', attempts: 0, deadAt: null, nextAttemptAt: null }).where(eq(s.outbox.id, r.id))
  const kids = await db.select().from(s.outbox).where(and(eq(s.outbox.parentKey, r.idempotencyKey), eq(s.outbox.status, 'dead'))).all()
  for (const k of kids) if (decodeLastError(k.lastError).reason === 'PARENT_REJECTED') await db.update(s.outbox).set({ status: 'pending', attempts: 0, deadAt: null, nextAttemptAt: null }).where(eq(s.outbox.id, k.id))
}
