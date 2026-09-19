import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { initDatabase } from '../src/db/init'
import { openTestApi, openTestDb } from './helpers/db'

describe('initDatabase', () => {
  it('migrates and seeds the catalog on the first run only', async () => {
    const { db, init } = await openTestDb()
    expect(init.seeded).toBe(true)
    expect(init.migrated.length).toBeGreaterThan(0)
    expect(await initDatabase(db)).toEqual({ migrated: [], seeded: false })
    const countOf = async (table: string) => (await db.values<[number]>(sql.raw(`select count(*) from "${table}"`)))[0]?.[0]
    expect(await countOf('product')).toBe(24)
    expect(await countOf('product_variant')).toBe(72)
    expect(await countOf('recipe')).toBe(360)
    expect(await countOf('price')).toBe(72)
  })

  it('a fresh device asks for setup', async () => {
    const { api } = await openTestApi()
    expect(await api.bootstrap()).toEqual({ needsSetup: true, device: null, users: [], openShift: null, pendingSyncItems: 0, lastBackupAt: null, backupDue: false })
  })
})
