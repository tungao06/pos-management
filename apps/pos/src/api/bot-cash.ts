import { and, desc, eq, isNotNull, lt } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { BOT_ORDER_NO_RE } from '@dayo/contracts'
import { edgeBahtToSatang, MAX_Z_BOT_BILLS, sumSatang, type ZBotBill } from '@dayo/domain'
import { apiBlocked, rateLimitLeft, readDayoConfig, recordDayoFailure, type SyncContext } from '../sync/catalog'
import { createDayoClient, DayoError, type DayoClient, type DayoFailure } from '../sync/dayo-client'
import { DAYO_AHEAD_TOLERANCE_MS, DAYO_KEYS, estimatedServerMs, extendRateLimit, MAX_BACKOFF_WAIT_MS, readKey, writeKey } from '../sync/state'
import { requireDevice } from './bootstrap'
import { assertCountAfterCentralZ, centralWindowStart, readCentralZ } from './central-z'
import { PosError } from './errors'
import { CLOCK_AHEAD_COUNT } from './rows'
import type { BotCashDto } from './types'

/** sync_state key of the last good E4 answer of a shift (local only — never sent; deleted when the Z is written). */
export const botPreviewKey = (shiftId: string): string => `z.bot_cash.${shiftId}`
/** 00:00 Bangkok of a business date, as the UTC instant the tablet sends ('2026-09-25' → '2026-09-24T17:00:00.000Z'). */
export const thaiMidnightUtc = (ymd: string): string => new Date(Date.parse(`${ymd}T00:00:00.000+07:00`)).toISOString()

/** dayo 0066 bot_bills[].version is an int4 1..2147483647. */
const VERSION_MAX = 2_147_483_647

/**
 * spec §4.10 E4: after = counted_at of this device's previous count (local-only shifts included), else 00:00 Bangkok of
 * the business date; until = this shift's counted_at. Every counted_at is set once (trigger), so the window never moves.
 * Task 13 (spec §13.8 R5-1 · ruling R9): on the R9 path the first Z of the line starts at dayo's last_z_until instead
 * (centralWindowStart) — rows.ts floors this device's counts after it, so the window neither overlaps that Z nor leaves a gap.
 */
export async function botWindowFor(db: RemoteDb, shift: { id: string; deviceId: string; businessDate: string; countedAt: string }): Promise<{ after: string; until: string }> {
  const central = await centralWindowStart(db, shift)
  if (central !== null) return { after: central, until: shift.countedAt }
  const prev = await db.select({ c: s.shift.countedAt }).from(s.shift)
    .where(and(eq(s.shift.deviceId, shift.deviceId), isNotNull(s.shift.countedAt), lt(s.shift.countedAt, shift.countedAt)))
    .orderBy(desc(s.shift.countedAt)).limit(1).get()
  const after = prev?.c ?? thaiMidnightUtc(shift.businessDate)
  // Task 14 (9a): a count taken before dayo's last Z of this key (COUNT_BEFORE_CENTRAL_Z) whose shift the owner kept local
  // is not a window start — the next window never reaches back into that Z (bot cash counted twice); it starts at its until
  const cz = await readCentralZ(db)
  if (cz !== null && Date.parse(cz.lastZUntil) > Date.parse(after) && Date.parse(cz.lastZUntil) < Date.parse(shift.countedAt)) return { after: cz.lastZUntil, until: shift.countedAt }
  return { after, until: shift.countedAt }
}

/** Review item 9: only a network failure is OFFLINE (the screen then offers the offline count); everything else says what it is. */
export function botCashError(f: DayoFailure): PosError {
  switch (f.kind) {
    case 'network': return new PosError('OFFLINE', 'network')
    case 'unauthorized': return new PosError('DAYO_BAD_KEY', 'E4 401')
    case 'forbidden': return new PosError('DAYO_KEY_NO_SCOPE', 'E4 403 (orders:read)')
    case 'api_disabled': return new PosError('DAYO_API_DISABLED', 'E4 404')
    // dayo phase 1 has no cap on E4 (0067 · preflight D4) — the tablet's own 500 check below is what refuses; kept for a later cap
    case 'bad_envelope': return f.message.includes('too_large') ? new PosError('Z_TOO_LARGE', 'E4 422 too_large') : new PosError('DAYO_BAD_RESPONSE', 'E4 422')
    case 'rate_limited': case 'server': case 'timeout': return new PosError('DAYO_UNREACHABLE', f.kind) // preflight P1: timeout
    case 'bad_response': case 'bad_base_url': return new PosError('DAYO_BAD_RESPONSE', f.kind)
  }
}

/** A stop already recorded by an earlier call (spec §6.3: 401/403 stop every call; 404 until its retry time) — said as E4 would. */
async function blockedError(db: RemoteDb): Promise<PosError> {
  const state = await readKey(db, DAYO_KEYS.apiState)
  if (state === 'unauthorized') return new PosError('DAYO_BAD_KEY', 'api_state unauthorized')
  if (state === 'forbidden') return new PosError('DAYO_KEY_NO_SCOPE', 'api_state forbidden')
  if (state === 'disabled') return new PosError('DAYO_API_DISABLED', 'api_state disabled')
  return new PosError('DAYO_BAD_RESPONSE', `api_state ${String(state)}`)
}

const bad = (why: string): PosError => new PosError('DAYO_BAD_RESPONSE', `E4 ${why}`)

/**
 * Task 12 carried (security M): E4 answers for bills created up to dayo's time of the answer. A window whose end (this
 * count's counted_at) is later than that + 5 min is not closed yet — a bot bill created between the answer and
 * counted_at would be in neither this Z (not listed now) nor the next (its window starts at counted_at). Refused as
 * BAD_INPUT `CLOCK_AHEAD:` + Thai text (the screen shows the detail), nothing stored; asking again once dayo's time has
 * passed the count works. E4 carries no server_time (0067): dayo's time is the tablet's estimate at the answer — the
 * last skew E1/E2 measured while fresh (D106 `estimatedServerMs`), else the device clock. fetchBotCash refreshes a
 * stale skew with one E1 first (fix round 1 item 5), so the device-clock fallback is left for an E1 that failed.
 */
async function assertWindowClosed(db: RemoteDb, until: string, answeredAt: string): Promise<void> {
  const server = (await estimatedServerMs(db, answeredAt)) ?? Date.parse(answeredAt)
  if (Date.parse(until) > server + DAYO_AHEAD_TOLERANCE_MS) {
    throw new PosError('BAD_INPUT', `${CLOCK_AHEAD_COUNT}: เวลานับเงิน (${until}) ยังไม่ถึงในระบบกลาง (ตอนนี้ประมาณ ${new Date(server).toISOString()}) — นาฬิกาแท็บเล็ตไม่ตรงกับระบบกลาง บิลบอทที่จะเข้ามาก่อนถึงเวลานั้นจะไม่อยู่ในใบปิดกะใด ตั้งนาฬิกาให้ตรง แล้วรอให้ถึงเวลานับก่อนดึงยอดบิลบอทอีกครั้ง`)
  }
}

/**
 * Carried from Task 10 review: E4 is checked here, never trusted — at most 500 bills (dayo refuses a longer Z, R20) ·
 * every order_no as dayo's bot_bills check wants it (preflight D5) · no bill twice · version an int4 ≥ 1 · each sold_at
 * (when dayo has one) in [after, until] · every total and the sum through edgeBahtToSatang, and the sum must equal
 * cash_total — the tablet's own sum is what counts. dayo filters on created_at ∈ (after, until] in µs; its bot/web bills
 * get sold_at = now() in the same transaction (0051:1058) or null for a back-dated entry, so a null sold_at cannot be
 * checked and is taken · E4 prints sold_at truncated to ms (0067:65): a bill created 0.5 ms after `after` reads as
 * exactly `after`, so the lower bound is inclusive here (fix round 1 item 3).
 * Any failure = DAYO_BAD_RESPONSE: nothing is stored and the screen stays on the count-without-bot-cash path.
 */
export function checkedBotBills(data: { bills: readonly { order_no: string; version: number; source: string; sold_at: string | null; total: number; created_by_name: string | null }[]; cash_total: number }, window: { after: string; until: string }): { bills: ZBotBill[]; cashTotalSatang: number } {
  if (data.bills.length > MAX_Z_BOT_BILLS) throw new PosError('Z_TOO_LARGE', `bot_bills ${data.bills.length} > ${MAX_Z_BOT_BILLS}`)
  const afterMs = Date.parse(window.after)
  const untilMs = Date.parse(window.until)
  const seen = new Set<string>()
  const bills: ZBotBill[] = []
  for (const b of data.bills) {
    if (!BOT_ORDER_NO_RE.test(b.order_no)) throw bad(`order_no ${JSON.stringify(b.order_no.slice(0, 40))} is not a bot bill number`)
    if (seen.has(b.order_no)) throw bad(`order_no ${b.order_no} listed twice`)
    seen.add(b.order_no)
    if (!Number.isSafeInteger(b.version) || b.version < 1 || b.version > VERSION_MAX) throw bad(`${b.order_no} version ${b.version}`)
    if (b.sold_at !== null) {
      const t = Date.parse(b.sold_at)
      if (!(t >= afterMs && t <= untilMs)) throw bad(`${b.order_no} sold_at ${b.sold_at} is outside [${window.after}, ${window.until}]`)
    }
    let totalSatang: number
    try { totalSatang = edgeBahtToSatang(b.total) } catch { throw bad(`${b.order_no} total ${b.total}`) }
    bills.push({ orderNo: b.order_no, version: b.version, source: b.source, soldAt: b.sold_at, totalSatang, createdByName: b.created_by_name })
  }
  let cashTotalSatang: number
  try { cashTotalSatang = edgeBahtToSatang(data.cash_total) } catch { throw bad(`cash_total ${data.cash_total}`) }
  const sum = sumSatang(bills.map((b) => b.totalSatang))
  if (!Number.isSafeInteger(sum)) throw bad('Σ bills overflows')
  if (sum !== cashTotalSatang) throw bad(`cash_total ${cashTotalSatang} satang ≠ Σ bills ${sum}`)
  return { bills, cashTotalSatang: sum }
}

/**
 * E4 for a counting/counted CENTRAL shift. The network wait is outside the serial queue (block 2 L-R3 — sales on another
 * shift keep going); the reads and writes around it are inside. A good answer is stored per shift (botPreviewKey) — the
 * count review, confirmCount and issueZ read it from there (review item 1). `beforeRequest` = the PosApi's pacing check.
 * `refreshClock` (Task 13 fix round 1 item 5) = one E1 under the PosApi's sync budget, called when no fresh skew is
 * stored — the "window closed" check then has dayo's time; it never throws, and a failed pull keeps the fallback.
 */
export async function fetchBotCash(ctx: SyncContext, shiftId: string, opts: { beforeRequest?: () => void; refreshClock?: () => Promise<void> } = {}): Promise<BotCashDto> {
  const { cfg, window } = await ctx.serial(async () => {
    const shift = await ctx.db.select().from(s.shift).where(eq(s.shift.id, shiftId)).get()
    if (shift === undefined || shift.countedAt === null || (shift.status !== 'counting' && shift.status !== 'counted')) throw new PosError('SHIFT_NOT_COUNTING', shiftId)
    if (shift.deviceId !== (await requireDevice(ctx.db)).id) throw new PosError('SHIFT_NOT_COUNTING', shiftId) // another device's shift (a restored file)
    if (shift.syncMode !== 'central') throw new PosError('BAD_INPUT', 'a local-only shift has no bot cash (ruling R6)')
    const c = await readDayoConfig(ctx.db, ctx.deps)
    if (c === null) throw new PosError('OFFLINE', 'not linked')
    const now = ctx.deps.now()
    if (await apiBlocked(ctx.db, now)) throw await blockedError(ctx.db)
    if ((await rateLimitLeft(ctx.db, now)) > 0) throw new PosError('DAYO_UNREACHABLE', 'rate_limited')
    const at = { id: shift.id, deviceId: shift.deviceId, countedAt: shift.countedAt }
    await assertCountAfterCentralZ(ctx.db, at) // fix round 1 item 2: no E4 for a count before dayo's last Z (nothing sent)
    return { cfg: c, window: await botWindowFor(ctx.db, { ...at, businessDate: shift.businessDate }) }
  })
  if (opts.refreshClock !== undefined && (await ctx.serial(() => estimatedServerMs(ctx.db, ctx.deps.now()))) === null) {
    try { await opts.refreshClock() } catch { /* the device-clock fallback stands */ }
  }
  opts.beforeRequest?.()
  let client: DayoClient
  try {
    client = createDayoClient({ ...cfg, fetch: ctx.deps.fetch, nowMs: () => Date.parse(ctx.deps.now()) })
  } catch (e) {
    const failure: DayoFailure = { kind: 'bad_base_url', message: e instanceof Error ? e.message : 'BAD_BASE_URL' }
    await ctx.serial(() => recordDayoFailure(ctx.db, ctx.deps, failure))
    throw botCashError(failure)
  }
  let data
  try {
    data = (await client.shiftCash(window)).value
  } catch (e) {
    if (!(e instanceof DayoError)) throw e
    const f = e.failure
    await ctx.serial(async () => {
      // 401/403/404 stop every call like E1/E2/E3 (spec §6.3); a 429 is for the whole key · nothing else is recorded
      // (a bad_response here is E4's, not the catalog's error)
      if (f.kind === 'unauthorized' || f.kind === 'forbidden' || f.kind === 'api_disabled') await recordDayoFailure(ctx.db, ctx.deps, f)
      if (f.kind === 'rate_limited') await extendRateLimit(ctx.db, new Date(Date.parse(ctx.deps.now()) + Math.min(f.retryAfterMs, MAX_BACKOFF_WAIT_MS)).toISOString())
    })
    throw botCashError(f)
  }
  const answeredAt = ctx.deps.now()
  const { bills, cashTotalSatang } = checkedBotBills(data, window)
  await ctx.serial(() => assertWindowClosed(ctx.db, window.until, answeredAt))
  const dto: BotCashDto = { shiftId, after: window.after, until: window.until, bills, cashTotalSatang, fetchedAt: answeredAt }
  await ctx.serial(async () => {
    // the shift may have got its Z while the request was out — a stored preview must never outlive the Z
    const now = await ctx.db.select({ status: s.shift.status }).from(s.shift).where(eq(s.shift.id, shiftId)).get()
    if (now?.status === 'counting' || now?.status === 'counted') await writeKey(ctx.db, botPreviewKey(shiftId), JSON.stringify(dto))
  })
  return dto
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)

/**
 * The stored E4 answer of a shift for exactly this window, or null. sync_state is a plain table (a restored or hand-edited
 * file can hold anything): a preview that does not read back as the answer fetchBotCash stored — shape, window, Σ — is
 * ignored, never trusted (the screen then takes the count-without-bot-cash path and E4 is asked again).
 */
export async function readBotPreview(db: RemoteDb, shiftId: string, window: { after: string; until: string }): Promise<BotCashDto | null> {
  const raw = await readKey(db, botPreviewKey(shiftId))
  if (raw === null) return null
  let v: unknown
  try { v = JSON.parse(raw) } catch { return null }
  if (typeof v !== 'object' || v === null) return null
  const p = v as Record<string, unknown>
  if (p['shiftId'] !== shiftId || p['after'] !== window.after || p['until'] !== window.until || !isStr(p['fetchedAt']) || !isInt(p['cashTotalSatang']) || !Array.isArray(p['bills'])) return null
  const bills: ZBotBill[] = []
  for (const x of p['bills'] as unknown[]) {
    if (typeof x !== 'object' || x === null) return null
    const b = x as Record<string, unknown>
    if (!isStr(b['orderNo']) || !isInt(b['version']) || !isStr(b['source']) || !isInt(b['totalSatang']) || b['totalSatang'] < 0) return null
    if (b['soldAt'] !== null && !isStr(b['soldAt'])) return null
    if (b['createdByName'] !== null && !isStr(b['createdByName'])) return null
    bills.push({ orderNo: b['orderNo'], version: b['version'], source: b['source'], soldAt: b['soldAt'] as string | null, totalSatang: b['totalSatang'], createdByName: b['createdByName'] as string | null })
  }
  const sum = sumSatang(bills.map((b) => b.totalSatang)) // each already a safe integer ≥ 0
  if (!Number.isSafeInteger(sum) || sum !== p['cashTotalSatang']) return null
  return { shiftId, after: window.after, until: window.until, bills, cashTotalSatang: sum, fetchedAt: p['fetchedAt'] }
}
