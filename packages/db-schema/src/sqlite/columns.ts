import { integer, text as dText } from 'drizzle-orm/sqlite-core'

export const text = dText
export const id = () => dText('id').primaryKey()
export const int = (name: string) => integer(name)
/** 64-bit integer (usat). SQLite INTEGER is always 64-bit. */
export const big = (name: string) => integer(name)
export const bool = (name: string) => integer(name, { mode: 'boolean' })
export const json = (name: string) => dText(name, { mode: 'json' })
