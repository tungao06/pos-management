import { sql } from 'drizzle-orm'
import { bigint, bigserial, boolean, integer, jsonb, text as dText } from 'drizzle-orm/pg-core'

export const text = dText
export const id = () => dText('id').primaryKey()
export const int = (name: string) => integer(name)
/** 64-bit integer (usat), read back as a JS number (all values stay below 2^53). */
export const big = (name: string) => bigint(name, { mode: 'number' })
export const bool = (name: string) => boolean(name)
export const json = (name: string) => jsonb(name)
/**
 * Pull cursor (spec §6.1): `GET /sync/pull?table=…&since=server_seq`. On every reference table, and on the
 * transaction tables the device must pull (order, order_line, order_event, payment, item_cost_state — M7).
 * INSERT takes the next value from the bigserial default; UPDATE takes a fresh one from the `bump_server_seq`
 * BEFORE UPDATE trigger (custom migration drizzle/pg/0001_server_seq_bump.sql), so a pull also sees edits (I1).
 * Values are allocated at write time but become visible at commit, so the pull endpoint must either read only up to
 * `pg_snapshot_xmin(pg_current_snapshot())` or rely on a single writer — plan 4 decides; see spec §6.1.
 */
export const serverSeq = () => bigserial('server_seq', { mode: 'number' }).notNull()
/** When the server first received this transaction row (UTC ISO-8601, filled by the server's default). */
export const serverReceivedAt = () =>
  dText('server_received_at').notNull().default(sql`to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
/**
 * Text column typed by a @dayo/contracts zod enum (M4). Narrows `$inferSelect`/`$inferInsert` only: it emits no SQL
 * and no CHECK, so the DB still accepts any string — zod validates at the app boundary.
 */
export const textEnum = <T extends string>(name: string, e: { options: T[] }) => dText(name, { enum: e.options as [T, ...T[]] })
