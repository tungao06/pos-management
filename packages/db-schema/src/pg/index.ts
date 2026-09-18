/**
 * PostgreSQL schema (server). NOTE (M14): `user` and `order` are reserved words in PostgreSQL. Drizzle always quotes
 * identifiers, but hand-written SQL (reports, migrations, psql) MUST write `"user"` and `"order"` with double quotes —
 * an unquoted `SELECT … FROM user` silently returns the current role name instead of failing.
 */
export * from './reference.js'
export * from './stock.js'
export * from './sales.js'
export * from './system.js'
