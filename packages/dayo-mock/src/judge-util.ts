// packages/dayo-mock/src/judge-util.ts — dayo's value checks and verdict plumbing, shared by judge.ts (order rows) and
// judge-shift.ts (block 3 shift rows). No node:* imports (sha256 from @noble/hashes).
// Ports of dayo main 0052_pos_push.sql:77-199 (dayo_jt, dayo_pos_has/is_uuid/is_text/is_int/is_money/ts/date).
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { bangkokDateOf } from '@dayo/contracts'
import type { MockState } from './state.js'

export const FIVE_MIN = 5 * 60_000
export const DAY = 86_400_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TS_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$/
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0001-\u001f\u007f]/

/** A verdict other than accepted/duplicate (dayo_pos_verdict · DYPV0). `data` rides along on a few block 3 conflicts (Task 8). */
export class Verdict extends Error {
  constructor(readonly status: 'rejected' | 'deferred', readonly reason: string, readonly detail: string, readonly data?: unknown) { super(reason) }
}
export const reject = (reason: string, detail: string, data?: unknown): never => { throw new Verdict('rejected', reason, detail, data) }
export const defer = (reason: string, detail: string): never => { throw new Verdict('deferred', reason, detail) }

export type J = Record<string, unknown>
export const isObj = (v: unknown): v is J => v !== null && typeof v === 'object' && !Array.isArray(v)
/** dayo_pos_has: key present and not JSON null. */
export const has = (o: J, k: string): boolean => o[k] !== undefined && o[k] !== null
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
/** dayo_pos_is_text: 1..max characters, no C0/DEL control, not only spaces (btrim). */
export const isText = (v: unknown, max: number): v is string => typeof v === 'string' && [...v].length >= 1 && [...v].length <= max && !CONTROL_RE.test(v) && v.replace(/^ +| +$/g, '') !== ''
export const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
export const isPct = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 100
export const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 99_999_999.99 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6
/** Baht (≤ 2 decimals, already checked by isMoney) → satang, for an exact comparison of two amounts. */
export const cents = (baht: number): number => Math.round(baht * 100)
/** dayo_pos_ts: ISO-8601 with a zone → instant (ms), else null. */
export function ts(v: unknown): number | null {
  if (typeof v !== 'string' || !TS_RE.test(v)) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}
/** dayo_pos_date: a real YYYY-MM-DD, else null. */
export function ymd(v: unknown): string | null {
  if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return null
  const t = Date.parse(`${v}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null
}
/** to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') — seconds truncated. */
export const utcZ = (t: number): string => `${new Date(t).toISOString().slice(0, 19)}Z`
/** to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"') — dayo's server_time / E4 sold_at / E1 last_z_until form. */
export const utcMs = (t: number): string => new Date(t).toISOString().replace('Z', '+00:00')
export const thaiDate = (t: number): string => bangkokDateOf(new Date(t).toISOString())
export const minusDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10)
const canonical = (v: unknown): string => JSON.stringify(v, (_, x: unknown) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x))
export const hashOf = (data: unknown): string => bytesToHex(sha256(utf8ToBytes(canonical(data))))
/** E1 staff = active + removed = dayo_pos_staff_ok. */
export const staffOk = (s: MockState, id: string): boolean => s.catalog.staff.some((x) => x.id === id)
