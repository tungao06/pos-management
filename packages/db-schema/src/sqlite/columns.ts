import { integer, text as dText } from 'drizzle-orm/sqlite-core'

export const text = dText
export const id = () => dText('id').primaryKey()
export const int = (name: string) => integer(name)
/** 64-bit integer (usat). SQLite INTEGER is always 64-bit. */
export const big = (name: string) => integer(name)
export const bool = (name: string) => integer(name, { mode: 'boolean' })
export const json = (name: string) => dText(name, { mode: 'json' })
/**
 * Text column typed by a @dayo/contracts zod enum (M4). Narrows `$inferSelect`/`$inferInsert` only: it emits no SQL
 * and no CHECK, so the DB still accepts any string — zod validates at the app boundary.
 */
export const textEnum = <T extends string>(name: string, e: { options: T[] }) => dText(name, { enum: e.options as [T, ...T[]] })
