import type { AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy'

/** The part of sqlite-wasm's oo1 `Database` we use — keeps db-schema free of a sqlite-wasm dependency. */
export type Oo1Database = {
  exec(opts: { sql: string; bind?: unknown[]; rowMode?: 'array'; returnValue?: 'resultRows' }): unknown
}

/** sqlite-proxy callback over sqlite-wasm oo1 (runs inside the Worker, synchronously under the hood). */
export function oo1Callback(db: Oo1Database): AsyncRemoteCallback {
  return async (sql, params, method) => {
    const base = params.length > 0 ? { sql, bind: params } : { sql }
    if (method === 'run') {
      db.exec(base)
      return { rows: [] }
    }
    const rows = db.exec({ ...base, rowMode: 'array', returnValue: 'resultRows' }) as unknown[][]
    return { rows: method === 'get' ? (rows[0] as unknown[]) : rows }
  }
}
