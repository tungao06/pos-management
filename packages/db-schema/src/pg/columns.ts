import { bigint, bigserial, boolean, integer, jsonb, text as dText } from 'drizzle-orm/pg-core'

export const text = dText
export const id = () => dText('id').primaryKey()
export const int = (name: string) => integer(name)
/** 64-bit integer (usat), read back as a JS number (all values stay below 2^53). */
export const big = (name: string) => bigint(name, { mode: 'number' })
export const bool = (name: string) => boolean(name)
export const json = (name: string) => jsonb(name)
/** Monotonic server cursor for pull sync (reference tables). */
export const serverSeq = () => bigserial('server_seq', { mode: 'number' }).notNull()
/** When the server first received this transaction row. */
export const serverReceivedAt = () => dText('server_received_at')
