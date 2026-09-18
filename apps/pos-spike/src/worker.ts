import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { argon2idAsync } from '@noble/hashes/argon2.js'
import { eq, like, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { migrateSqliteRemote, oo1Callback, SQLITE_TABLES, SQLITE_TRIGGERS, type Oo1Database } from '@dayo/db-schema/browser'
import { syncState } from '@dayo/db-schema/sqlite'
import type { CheckResult, SpikeReport, WorkerReply } from './types'

const DB_FILE = '/dayo-spike.sqlite3'
const reply = (m: WorkerReply): void => (self as unknown as { postMessage(x: unknown): void }).postMessage(m)
const since = (t: number): number => Math.round(performance.now() - t)

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>
type PoolOpts = Parameters<Sqlite3['installOpfsSAHPoolVfs']>[0]

/** Same retry as the app's worker (I-4): a reload can race the previous page's worker for the OPFS access handles. */
async function openPool(sqlite3: Sqlite3): Promise<{ pool: Awaited<ReturnType<Sqlite3['installOpfsSAHPoolVfs']>>; attempts: number }> {
  let last: unknown
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'dayo-spike', forceReinitIfPreviouslyFailed: true } as PoolOpts)
      return { pool, attempts: attempt }
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 250 * attempt))
    }
  }
  throw last
}

async function run(): Promise<SpikeReport> {
  const checks: CheckResult[] = []
  const t0 = performance.now()
  const sqlite3 = await sqlite3InitModule()
  checks.push({ id: 'I1', title: "classic 'opfs' VFS available (needs COOP/COEP)", required: false, pass: 'opfs' in sqlite3, detail: `opfs=${'opfs' in sqlite3}` })

  let raw: Oo1Database & { exec(sql: string): unknown }
  let exportFile: (() => Promise<Uint8Array>) | null = null
  let attempts = 1
  try {
    if (__SPIKE_VFS__ === 'opfs') {
      raw = new sqlite3.oo1.OpfsDb(DB_FILE) as unknown as typeof raw
    } else {
      const opened = await openPool(sqlite3)
      attempts = opened.attempts
      raw = new opened.pool.OpfsSAHPoolDb(DB_FILE) as unknown as typeof raw
      exportFile = () => opened.pool.exportFile(DB_FILE)
    }
    raw.exec('PRAGMA foreign_keys = ON')
    checks.push({ id: 'S1', title: `open DB on ${__SPIKE_VFS__}`, required: true, pass: true, detail: `SQLite ${sqlite3.version.libVersion} attempts=${attempts}` })
  } catch (e) {
    checks.push({ id: 'S1', title: `open DB on ${__SPIKE_VFS__}`, required: true, pass: false, detail: `attempts=${attempts} ${String(e)}` })
    return { vfs: __SPIKE_VFS__, sqliteVersion: sqlite3.version.libVersion, bootCount: -1, checks }
  }

  const db = drizzle(oo1Callback(raw))

  // S2 migrations (same tables and append-only triggers as migrateSqlite in Node)
  const { applied } = await migrateSqliteRemote(db)
  const list = async (type: string) => (await db.values<[string]>(sql`select name from sqlite_master where type = ${type} and name not like 'sqlite_%' and name not like '__drizzle%' order by name`)).map((r) => r[0])
  const tables = await list('table')
  const triggers = await list('trigger')
  const sameTables = JSON.stringify(tables) === JSON.stringify(SQLITE_TABLES) && JSON.stringify(triggers) === JSON.stringify(SQLITE_TRIGGERS)
  checks.push({ id: 'S2', title: 'migrations from @dayo/db-schema', required: true, pass: sameTables, detail: `tables=${tables.length}/${SQLITE_TABLES.length} triggers=${triggers.length}/${SQLITE_TRIGGERS.length} appliedNow=${applied.length}` })
  checks.push({ id: 'S7', title: 'cold start (wasm + open + migrate)', required: true, pass: since(t0) <= 3000, detail: `${since(t0)} ms` })

  // I4 (seed timing) intentionally dropped from this spike — see task-1-report.md "Deviations" for why
  // (`canonicalSeedOpts` from the brief's worker.ts does not exist anywhere in the repo, `applySeedSqlite`/
  // `seedToRows` are exported only from db-schema's Node-only root entry per its own doc comment, and
  // apps/pos-spike's package.json as given does not depend on @dayo/excel-import or @dayo/contracts). I4 is
  // informational-only (not required for the S1-S10 gate), so it is safe to skip here.

  // S5 boot counter (persistence across reloads)
  const prev = await db.select().from(syncState).where(eq(syncState.key, 'spike.boot_count')).get()
  const bootCount = Number(prev?.value ?? '0') + 1
  await db.insert(syncState).values({ key: 'spike.boot_count', value: String(bootCount) }).onConflictDoUpdate({ target: syncState.key, set: { value: String(bootCount) } })
  checks.push({ id: 'S5', title: 'data survives reload', required: true, pass: 'manual', detail: `bootCount=${bootCount} — reload: must become ${bootCount + 1}` })

  // S3 commit
  const commitKey = `spike.commit.${bootCount}`
  await db.transaction(async (tx) => {
    await tx.insert(syncState).values({ key: commitKey, value: 'ok' })
  })
  const committed = await db.select().from(syncState).where(eq(syncState.key, commitKey)).get()
  checks.push({ id: 'S3', title: 'drizzle transaction commit', required: true, pass: committed?.value === 'ok', detail: `row=${JSON.stringify(committed ?? null)}` })

  // S4 rollback
  const rollbackKey = `spike.rollback.${bootCount}`
  try {
    await db.transaction(async (tx) => {
      await tx.insert(syncState).values({ key: rollbackKey, value: 'should-vanish' })
      throw new Error('intentional')
    })
  } catch {
    // expected
  }
  const rolledBack = await db.select().from(syncState).where(eq(syncState.key, rollbackKey)).get()
  checks.push({ id: 'S4', title: 'drizzle transaction rollback', required: true, pass: rolledBack === undefined, detail: `row=${JSON.stringify(rolledBack ?? null)}` })

  // S6 write speed: 50 transactions × 40 inserts
  const durations: number[] = []
  for (let r = 0; r < 50; r++) {
    const t = performance.now()
    await db.transaction(async (tx) => {
      for (let i = 0; i < 40; i++) await tx.insert(syncState).values({ key: `spike.perf.${bootCount}.${r}.${i}`, value: 'x'.repeat(200) })
    })
    durations.push(performance.now() - t)
  }
  await db.delete(syncState).where(like(syncState.key, 'spike.perf.%'))
  durations.sort((a, b) => a - b)
  const p95 = Math.round(durations[Math.floor(durations.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY)
  checks.push({ id: 'S6', title: '50 tx × 40 inserts', required: true, pass: p95 <= 150, detail: `p95=${p95} ms median=${Math.round(durations[25] ?? 0)} ms` })

  // S8 argon2idAsync (M9: the app hashes async, not sync — and setup hashes both owners' PINs concurrently)
  const ta = performance.now()
  await Promise.all([
    argon2idAsync('1111', 'dayo-spike-salt-1!', { t: 2, m: 19_456, p: 1, dkLen: 32 }),
    argon2idAsync('2222', 'dayo-spike-salt-2!', { t: 2, m: 19_456, p: 1, dkLen: 32 }),
  ])
  checks.push({ id: 'S8', title: 'argon2idAsync t=2 m=19456 × 2 concurrent (setup: both owners)', required: true, pass: since(ta) <= 2000, detail: `${since(ta)} ms` })

  // I3 export
  if (exportFile) {
    const bytes = await exportFile()
    checks.push({ id: 'I3', title: 'pool.exportFile', required: false, pass: bytes.byteLength > 0, detail: `${bytes.byteLength} bytes` })
  }

  return { vfs: __SPIKE_VFS__, sqliteVersion: sqlite3.version.libVersion, bootCount, checks }
}

self.onmessage = () => {
  run().then(
    (report) => reply({ type: 'report', report }),
    (e: unknown) => reply({ type: 'error', message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }),
  )
}
