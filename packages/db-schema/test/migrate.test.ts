import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { migratePg } from '../src/migrate-pg.js'
import { migrateSqlite } from '../src/migrate-sqlite.js'
import { openPglite, openSqliteMemory, sqliteRows } from './helpers.js'

// 36 shared tables (18 reference + 7 stock + 10 sales/shift + audit_log) + 2 dialect-only tables per side.
const TABLES_PER_DIALECT = 38

describe('migrations', () => {
  it('sqlite: creates all 38 tables and the FK from cash_movement to order', async () => {
    const { db, raw } = await openSqliteMemory()
    migrateSqlite(db)
    const names = sqliteRows(raw, `select name from sqlite_master where type = 'table' and name not like '__drizzle%' and name not like 'sqlite_%' order by name`).map((r) => r['name'] as string)
    expect(names).toContain('order')
    expect(names).toContain('outbox')
    expect(names).not.toContain('invariant_run')
    expect(names).toHaveLength(TABLES_PER_DIALECT)
    const fks = sqliteRows(raw, `select "table", "from" from pragma_foreign_key_list('cash_movement')`)
    expect(fks).toContainEqual({ table: 'order', from: 'order_id' })
  })
  it('pg: creates all 38 tables', async () => {
    const { db, client } = await openPglite()
    await migratePg(db)
    const r = await db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`)
    const names = r.rows.map((x) => x.table_name)
    expect(names).toContain('order')
    expect(names).toContain('invariant_run')
    expect(names).not.toContain('outbox')
    expect(names).toHaveLength(TABLES_PER_DIALECT)
    await client.close()
  })
})
