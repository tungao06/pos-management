import type { AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy'

type NodeSqliteStatement = {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  setReturnArrays(enabled: boolean): void
}

/** Structural type of `DatabaseSync` from `node:sqlite` (Node >= 22.16, M1). */
export type NodeSqliteLike = { prepare(sql: string): NodeSqliteStatement; exec(sql: string): void }

/** sqlite-proxy callback over Node's built-in SQLite. Tests only — the browser uses `oo1Callback` in a Worker. */
export function nodeSqliteCallback(raw: NodeSqliteLike): AsyncRemoteCallback {
  return async (sql, params, method) => {
    if (method === 'run') {
      // M15: DatabaseSync.prepare() only compiles the first statement — a hand-written multi-statement chunk
      // (e.g. a raw migration) would silently run just the first one. exec() runs all of them, matching the
      // browser's oo1.exec(). Only takes this path when there are no bound params (exec doesn't accept any).
      if (params.length === 0) {
        raw.exec(sql)
      } else {
        raw.prepare(sql).run(...params)
      }
      return { rows: [] }
    }
    const stmt = raw.prepare(sql)
    stmt.setReturnArrays(true)
    if (method === 'get') return { rows: stmt.get(...params) as unknown[] }
    return { rows: stmt.all(...params) }
  }
}
