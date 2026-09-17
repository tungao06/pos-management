import { describe, expect, it } from 'vitest'
import { getTableConfig as pgConfig, PgTable } from 'drizzle-orm/pg-core'
import { getTableConfig as sqliteConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as pg from '../src/pg/index.js'
import * as sqlite from '../src/sqlite/index.js'

const SQLITE_ONLY = new Set(['outbox', 'sync_state'])
const PG_ONLY = new Set(['idempotency_record', 'invariant_run'])
const PG_ONLY_COLUMNS = new Set(['server_seq', 'server_received_at'])

type Cat = 'text' | 'int' | 'big' | 'bool' | 'json'
function category(columnType: string): Cat {
  switch (columnType) {
    case 'PgText': case 'SQLiteText': return 'text'
    case 'PgInteger': case 'SQLiteInteger': return 'int'
    case 'PgBigInt53': case 'PgBigSerial53': return 'big'
    case 'PgBoolean': case 'SQLiteBoolean': return 'bool'
    case 'PgJsonb': case 'SQLiteTextJson': return 'json'
    default: throw new Error(`unmapped column type ${columnType}`)
  }
}

type Shape = {
  columns: Record<string, { cat: Cat; notNull: boolean; primary: boolean }>
  fks: string[]      // "col->table.col"
  uniques: string[]  // "colA,colB"
}

function shapeOfPg(t: PgTable): Shape {
  const c = pgConfig(t)
  const columns: Shape['columns'] = {}
  for (const col of c.columns) {
    if (PG_ONLY_COLUMNS.has(col.name)) continue
    // sqlite 'big' is plain integer, so compare big as int
    const cat = category(col.columnType)
    columns[col.name] = { cat: cat === 'big' ? 'int' : cat, notNull: col.notNull, primary: col.primary }
  }
  const fks = c.foreignKeys.map((fk) => { const r = fk.reference(); return `${r.columns.map((x) => x.name).join(',')}->${pgConfig(r.foreignTable as PgTable).name}.${r.foreignColumns.map((x) => x.name).join(',')}` }).sort()
  const uniques = c.uniqueConstraints.map((u) => u.columns.map((x) => x.name).join(',')).sort()
  return { columns, fks, uniques }
}

function shapeOfSqlite(t: SQLiteTable): Shape {
  const c = sqliteConfig(t)
  const columns: Shape['columns'] = {}
  for (const col of c.columns) {
    const cat = category(col.columnType)
    columns[col.name] = { cat: cat === 'big' ? 'int' : cat, notNull: col.notNull, primary: col.primary }
  }
  const fks = c.foreignKeys.map((fk) => { const r = fk.reference(); return `${r.columns.map((x) => x.name).join(',')}->${sqliteConfig(r.foreignTable as SQLiteTable).name}.${r.foreignColumns.map((x) => x.name).join(',')}` }).sort()
  const uniques = c.uniqueConstraints.map((u) => u.columns.map((x) => x.name).join(',')).sort()
  return { columns, fks, uniques }
}

function tables<T>(mod: Record<string, unknown>, guard: (v: unknown) => v is T, nameOf: (t: T) => string): Map<string, T> {
  const out = new Map<string, T>()
  for (const v of Object.values(mod)) if (guard(v)) out.set(nameOf(v), v)
  return out
}

const pgTables = tables(pg, (v): v is PgTable => v instanceof PgTable, (t) => pgConfig(t).name)
const sqliteTables = tables(sqlite, (v): v is SQLiteTable => v instanceof SQLiteTable, (t) => sqliteConfig(t).name)

describe('schema parity sqlite ↔ pg', () => {
  it('has the same set of shared tables', () => {
    const a = [...pgTables.keys()].filter((n) => !PG_ONLY.has(n)).sort()
    const b = [...sqliteTables.keys()].filter((n) => !SQLITE_ONLY.has(n)).sort()
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThanOrEqual(18)
  })
  for (const name of [...sqliteTables.keys()].filter((n) => !SQLITE_ONLY.has(n))) {
    it(`table ${name} matches`, () => {
      const p = pgTables.get(name)
      expect(p, `pg table ${name} missing`).toBeDefined()
      expect(shapeOfSqlite(sqliteTables.get(name)!)).toEqual(shapeOfPg(p!))
    })
  }
  it('every pg reference table has server_seq', () => {
    const refTables = ['user', 'device', 'setting', 'category', 'product', 'size', 'product_variant', 'sweetness_level', 'channel', 'price', 'recipe', 'recipe_line', 'item', 'purchase_unit', 'bom', 'bom_line', 'equipment', 'customer']
    for (const n of refTables) {
      const cols = pgConfig(pgTables.get(n)!).columns.map((c) => c.name)
      expect(cols, n).toContain('server_seq')
    }
  })
})
