import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import * as pg from '../src/pg/index.js'
import * as sqlite from '../src/sqlite/index.js'

// drizzle-kit/api is CJS; load it with require so it shares the drizzle-orm instance node resolves.
const require = createRequire(import.meta.url)
const kit = require('drizzle-kit/api') as typeof import('drizzle-kit/api')

type Journal = { entries: { tag: string }[] }
function latestSnapshot(dialect: 'sqlite' | 'pg'): unknown {
  const dir = new URL(`../drizzle/${dialect}/meta/`, import.meta.url)
  const journal = JSON.parse(readFileSync(fileURLToPath(new URL('_journal.json', dir)), 'utf8')) as Journal
  const idx = journal.entries.length - 1
  return JSON.parse(readFileSync(fileURLToPath(new URL(`${String(idx).padStart(4, '0')}_snapshot.json`, dir)), 'utf8'))
}

describe('schema ↔ committed migrations (no drift)', () => {
  it('sqlite: drizzle-kit generate would produce nothing', async () => {
    const prev = latestSnapshot('sqlite') as Parameters<typeof kit.generateSQLiteMigration>[0]
    const cur = await kit.generateSQLiteDrizzleJson(sqlite as Record<string, unknown>, prev.id)
    expect(await kit.generateSQLiteMigration(prev, cur)).toEqual([])
  })
  it('pg: drizzle-kit generate would produce nothing', async () => {
    const prev = latestSnapshot('pg') as Parameters<typeof kit.generateMigration>[0]
    const cur = kit.generateDrizzleJson(pg as Record<string, unknown>, prev.id)
    expect(await kit.generateMigration(prev, cur)).toEqual([])
  })
})
