import { and, asc, eq, getTableColumns, gt, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { clipCodePoints, isRowSupported, MAX_PUSH_BODY_BYTES, MAX_PUSH_ROWS, OrderAcceptedData, PUSH_KINDS, type PushRequest, type ReceivedRowResult, type Supported } from '@dayo/contracts'
import { edgeBahtToSatang } from '@dayo/domain'
import type { ApiDeps } from '../api/deps'
import { apiBlocked, readDayoConfig, readSupported, recordDayoFailure, type SyncContext } from './catalog'
import { createDayoClient, DayoError, type DayoClient, type DayoFailure, type Timed } from './dayo-client'
import { backoffMs, DAYO_KEYS, decodeLastError, deleteKey, encodeLastError, NO_ANSWER_RETRY_MS, readKey, recordServerTime, STUCK_AFTER_ATTEMPTS, writeKey } from './state'

export type PushOutcome = { requests: number; sent: number; rejected: number; deferred: number; held: number; noAnswer: number; stopped: null | 'not_linked' | 'no_supported_list' | 'api_blocked' | 'backoff' | DayoFailure['kind'] }

/**
 * An outbox row plus its SQLite rowid. The queue is read in (created_at, rowid) order: a void's created_at can EQUAL its
 * bill's (the void time clamped to sold_at), and UUIDv7 ids inside one millisecond are not ordered, so only the rowid —
 * assigned in insertion order — keeps a bill ahead of its void when the timestamps tie.
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
const later = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString()
/** R3 + ruling N5: a row more than 24 h ahead of server_time stays pending, flagged lastError.farAhead (owner-only alert). */
export const CLOCK_AHEAD_FAR_MS = 86_400_000
const PAGE = 200
const rowid = sql<number>`rowid`.mapWith(Number)
const isPushKind = inArray(s.outbox.tableName, [...PUSH_KINDS])
/** (created_at, rowid) strictly after / at-or-before a mark. */
const afterMark = (m: Mark): SQL => or(gt(s.outbox.createdAt, m.createdAt), and(eq(s.outbox.createdAt, m.createdAt), sql`rowid > ${m.rid}`))!
const upToMark = (m: Mark): SQL => or(lt(s.outbox.createdAt, m.createdAt), and(eq(s.outbox.createdAt, m.createdAt), sql`rowid <= ${m.rid}`))!

async function markDead(db: RemoteDb, r: Row, at: string, reason: string, detail: string, attempts = r.attempts): Promise<void> {
  await db.update(s.outbox).set({ status: 'dead', deadAt: at, attempts, nextAttemptAt: null, lastError: encodeLastError(reason, detail) }).where(eq(s.outbox.id, r.id))
}

/** A parent that became dead takes its waiting children with it (spec §4.5 table: PARENT_REJECTED). */
async function cascadeChildren(db: RemoteDb, parentKey: string, at: string): Promise<void> {
  const kids = await db.select({ ...getTableColumns(s.outbox), rid: rowid }).from(s.outbox).where(and(eq(s.outbox.parentKey, parentKey), eq(s.outbox.status, 'pending'))).all()
  for (const k of kids) await markDead(db, k, at, 'PARENT_REJECTED', `แถวแม่ ${parentKey} ส่งไม่ผ่าน — จะส่งเองเมื่อแถวแม่ผ่าน`)
}

function parseMark(raw: string): Mark | null {
  try {
    const m = JSON.parse(raw) as Partial<Mark>
    return typeof m.createdAt === 'string' && typeof m.rid === 'number' ? { createdAt: m.createdAt, rid: m.rid } : null
  } catch {
    return null
  }
}

/** ruling R4: stay at one row per request until every row up to the failed batch's last row is decided. */
async function batchSize(db: RemoteDb): Promise<number> {
  const raw = await readKey(db, DAYO_KEYS.pushSingleThrough)
  if (raw === null) return MAX_PUSH_ROWS
  const m = parseMark(raw)
  const left = m === null ? undefined : await db.select({ id: s.outbox.id }).from(s.outbox).where(and(eq(s.outbox.status, 'pending'), isPushKind, upToMark(m))).limit(1).get()
  if (left === undefined) { await deleteKey(db, DAYO_KEYS.pushSingleThrough); return MAX_PUSH_ROWS }
  return 1
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
    const last = decodeLastError(r.lastError)
    if (!isRowSupported(r.tableName, r.rowJson as Record<string, unknown>, sup) || (last.reason === 'UNSUPPORTED' && last.supportedHash === hashOf(sup))) { held++; continue }
    // a child never goes before its parent: the parent must be sent already, or sit earlier in this same batch
    if (r.parentKey !== null && !inBatch.has(r.parentKey)) {
      const parent = await db.select({ status: s.outbox.status }).from(s.outbox).where(eq(s.outbox.idempotencyKey, r.parentKey)).get()
      if (parent?.status === 'dead') { await markDead(db, r, nowIso, 'PARENT_REJECTED', `แถวแม่ ${r.parentKey} ส่งไม่ผ่าน`); decided.add(r.id); continue }
      if (parent?.status === 'local_only') { await db.update(s.outbox).set({ status: 'local_only', nextAttemptAt: null }).where(eq(s.outbox.id, r.id)); decided.add(r.id); continue }
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
  if ((await readKey(db, DAYO_KEYS.pushBackoffUntil) ?? '') > now) return { cfg, sup: null, blocked: 'backoff' }
  const sup = await readSupported(db)
  return { cfg, sup, blocked: sup === null ? 'no_supported_list' : null }
}

async function onRequestFailure(db: RemoteDb, deps: ApiDeps, f: DayoFailure, batch: Row[]): Promise<void> {
  const now = deps.now()
  const lastOfBatch = JSON.stringify({ createdAt: batch.at(-1)!.createdAt, rid: batch.at(-1)!.rid } satisfies Mark)
  switch (f.kind) {
    case 'unauthorized': case 'forbidden': case 'api_disabled': case 'bad_base_url':
      // 403 here is the whole request (the key lacks orders:write) — never a row's FORBIDDEN (spec §4.5 · §6.3)
      await recordDayoFailure(db, deps, f); return
    case 'rate_limited':
      await writeKey(db, DAYO_KEYS.pushBackoffUntil, later(now, f.retryAfterMs))
      await writeKey(db, DAYO_KEYS.pushBackoffReason, 'rate_limited'); return
    case 'bad_envelope':
      if (batch.length > 1) await writeKey(db, DAYO_KEYS.pushSingleThrough, lastOfBatch)
      else await markDead(db, batch[0]!, now, 'ENVELOPE', f.message) // the queue moves on (spec §6.3 row 422)
      return
    default: { // network, server, bad_response: whole-request retry with backoff (spec §6.3 row 1)
      const streak = Number(await readKey(db, DAYO_KEYS.pushFailStreak) ?? '0') + 1
      await writeKey(db, DAYO_KEYS.pushFailStreak, String(streak))
      await writeKey(db, DAYO_KEYS.pushBackoffUntil, later(now, backoffMs(streak, deps.random)))
      await writeKey(db, DAYO_KEYS.pushBackoffReason, 'failure')
      if (f.kind === 'server' && streak >= 3 && batch.length > 1) await writeKey(db, DAYO_KEYS.pushSingleThrough, lastOfBatch)
    }
  }
}

async function markSent(db: RemoteDb, r: Row, v: ReceivedRowResult, at: string): Promise<void> {
  await db.update(s.outbox).set({ status: 'sent', sentAt: at, attempts: r.attempts + 1, lastError: null, nextAttemptAt: null, resultJson: (v.data ?? null) as never }).where(eq(s.outbox.id, r.id))
  if (r.tableName !== 'order') return
  const d = OrderAcceptedData.safeParse(v.data)
  if (!d.success) return // stored by dayo all the same; the bill just shows no central number
  let computed: number | null = null
  try { computed = edgeBahtToSatang(d.data.computed_total) } catch { computed = null }
  await db.update(s.order).set({ centralOrderNo: d.data.order_no, centralComputedTotalSatang: computed, centralAmountMismatch: d.data.amount_mismatch, centralDuplicateOfJson: d.data.duplicate_of })
    .where(eq(s.order.id, String((r.rowJson as { pos_order_id: string }).pos_order_id)))
}

async function markDeferred(db: RemoteDb, deps: ApiDeps, r: Row, v: ReceivedRowResult, at: string, sup: Supported, serverTime: string): Promise<void> {
  const reason = v.reason ?? 'DEFERRED'
  const detail = v.detail ?? ''
  if (reason === 'PARENT_PENDING' && r.parentKey !== null) {
    const parent = await db.select({ status: s.outbox.status }).from(s.outbox).where(eq(s.outbox.idempotencyKey, r.parentKey)).get()
    if (parent?.status !== 'sent') { // its bill is still on its way here — the child-waits-for-parent rule holds it; no try spent (review item 12)
      await db.update(s.outbox).set({ lastError: encodeLastError(reason, detail), nextAttemptAt: null }).where(eq(s.outbox.id, r.id))
      return
    }
  }
  if (reason === 'UNSUPPORTED') {
    await db.update(s.outbox).set({ lastError: encodeLastError(reason, detail, { supportedHash: hashOf(sup) }), nextAttemptAt: null }).where(eq(s.outbox.id, r.id))
    return
  }
  if (reason === 'CLOCK_AHEAD') { // ruling R3: not counted; the banner is the signal (D80)
    await writeKey(db, DAYO_KEYS.clockAheadAt, at)
    const data = r.rowJson as { sold_at?: string; voided_at?: string }
    const rowTime = Date.parse(data.sold_at ?? data.voided_at ?? at)
    // ruling N5: far ahead (> 24 h) is only FLAGGED — the row stays pending and keeps retrying; EXCLUDE is the owner's manual choice
    const farAhead = rowTime - Date.parse(serverTime) > CLOCK_AHEAD_FAR_MS
    const text = farAhead ? `เวลาในแถวล้ำระบบกลางเกิน 24 ชม. — ${detail}` : detail
    await db.update(s.outbox).set({ lastError: encodeLastError(reason, text, farAhead ? { farAhead: true } : {}), nextAttemptAt: later(at, NO_ANSWER_RETRY_MS) }).where(eq(s.outbox.id, r.id))
    return
  }
  const attempts = r.attempts + 1
  if (attempts >= STUCK_AFTER_ATTEMPTS) { await markDead(db, r, at, 'STUCK', `${reason}: ${detail}`, attempts); return }
  await db.update(s.outbox).set({ attempts, lastError: encodeLastError(reason, detail), nextAttemptAt: later(at, backoffMs(attempts, deps.random)) }).where(eq(s.outbox.id, r.id))
}

async function applyVerdicts(db: RemoteDb, deps: ApiDeps, batch: Row[], answer: Timed<{ server_time: string; results: ReceivedRowResult[] }>, sup: Supported): Promise<Pick<PushOutcome, 'sent' | 'rejected' | 'deferred' | 'noAnswer'>> {
  return db.transaction(async (tx) => {
    const at = deps.now()
    await recordServerTime(tx, answer.value.server_time, answer.sentAtMs, answer.receivedAtMs, at)
    await writeKey(tx, DAYO_KEYS.apiState, 'ok')
    await writeKey(tx, DAYO_KEYS.lastPushAt, at)
    await deleteKey(tx, DAYO_KEYS.pushFailStreak)
    await deleteKey(tx, DAYO_KEYS.pushBackoffUntil)
    await deleteKey(tx, DAYO_KEYS.pushBackoffReason)
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
        await tx.update(s.outbox).set({ lastError: encodeLastError(reason, v?.detail ?? ''), nextAttemptAt: later(at, NO_ANSWER_RETRY_MS) }).where(eq(s.outbox.id, r.id))
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
  for (let round = 0; round < MAX_ROUNDS_PER_CALL; round++) {
    const nowIso = ctx.deps.now()
    const { batch, held } = await ctx.serial(async () => pickBatch(ctx.db, nowIso, g.sup!, await batchSize(ctx.db), decided))
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
      await ctx.serial(() => onRequestFailure(ctx.db, ctx.deps, e.failure, batch))
      return { ...out, stopped: e.failure.kind }
    }
    out.requests++
    const t = await ctx.serial(() => applyVerdicts(ctx.db, ctx.deps, batch, answer, g.sup!))
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
