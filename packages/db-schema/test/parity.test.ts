import { describe, expect, it } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { getTableConfig as pgConfig, PgDialect, PgTable } from 'drizzle-orm/pg-core'
import { getTableConfig as sqliteConfig, SQLiteSyncDialect, SQLiteTable } from 'drizzle-orm/sqlite-core'
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
  columns: Record<string, { cat: Cat; notNull: boolean; primary: boolean; unique: boolean }>
  fks: string[]      // "col->table.col"
  uniques: string[]  // "colA,colB" — table-level unique(); column-level .unique() is columns[name].unique
  indexes: string[]  // "name(colA,colB)[ unique][ where <sql>]"
}

type IndexLike = { config: { name?: string; columns: unknown[]; unique: boolean; where?: SQL } }
const pgDialect = new PgDialect()
const sqliteDialect = new SQLiteSyncDialect()

function indexShape(idx: IndexLike, render: (w: SQL) => string): string {
  const cols = idx.config.columns.map((c) => (c as { name?: string }).name ?? '<expr>').join(',')
  const where = idx.config.where ? ` where ${render(idx.config.where)}` : ''
  return `${idx.config.name ?? '<unnamed>'}(${cols})${idx.config.unique ? ' unique' : ''}${where}`
}

function shapeOfPg(t: PgTable): Shape {
  const c = pgConfig(t)
  const columns: Shape['columns'] = {}
  for (const col of c.columns) {
    if (PG_ONLY_COLUMNS.has(col.name)) continue
    // sqlite 'big' is plain integer, so compare big as int (the naming-rule test below pins pg _usat to bigint)
    const cat = category(col.columnType)
    columns[col.name] = { cat: cat === 'big' ? 'int' : cat, notNull: col.notNull, primary: col.primary, unique: col.isUnique }
  }
  const fks = c.foreignKeys.map((fk) => { const r = fk.reference(); return `${r.columns.map((x) => x.name).join(',')}->${pgConfig(r.foreignTable as PgTable).name}.${r.foreignColumns.map((x) => x.name).join(',')}` }).sort()
  const uniques = c.uniqueConstraints.map((u) => u.columns.map((x) => x.name).join(',')).sort()
  const indexes = c.indexes.map((i) => indexShape(i as IndexLike, (w) => pgDialect.sqlToQuery(w).sql)).sort()
  return { columns, fks, uniques, indexes }
}

function shapeOfSqlite(t: SQLiteTable): Shape {
  const c = sqliteConfig(t)
  const columns: Shape['columns'] = {}
  for (const col of c.columns) {
    const cat = category(col.columnType)
    columns[col.name] = { cat: cat === 'big' ? 'int' : cat, notNull: col.notNull, primary: col.primary, unique: col.isUnique }
  }
  const fks = c.foreignKeys.map((fk) => { const r = fk.reference(); return `${r.columns.map((x) => x.name).join(',')}->${sqliteConfig(r.foreignTable as SQLiteTable).name}.${r.foreignColumns.map((x) => x.name).join(',')}` }).sort()
  const uniques = c.uniqueConstraints.map((u) => u.columns.map((x) => x.name).join(',')).sort()
  const indexes = c.indexes.map((i) => indexShape(i as IndexLike, (w) => sqliteDialect.sqlToQuery(w).sql)).sort()
  return { columns, fks, uniques, indexes }
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
  it('compares column-level uniques and indexes (guards against a parity blind spot)', () => {
    const device = shapeOfPg(pgTables.get('device')!)
    expect(device.columns['receipt_prefix']!.unique).toBe(true)
    expect(shapeOfPg(pgTables.get('stock_movement')!).indexes.length).toBeGreaterThan(0)
  })
  it('naming rule: pg _usat columns are bigint; _satang/_milli/_bp/_months/qty/seq are integer', () => {
    const INT_SUFFIX = /(_satang|_milli|_bp|_months)$/
    const INT_EXACT = new Set(['qty', 'seq', 'chain_seq'])
    const bad: string[] = []
    let checked = 0
    for (const [name, t] of pgTables) {
      for (const col of pgConfig(t).columns) {
        if (col.name.endsWith('_usat')) {
          checked++
          if (col.columnType !== 'PgBigInt53') bad.push(`${name}.${col.name} is ${col.columnType}, want PgBigInt53`)
        } else if (INT_SUFFIX.test(col.name) || INT_EXACT.has(col.name)) {
          checked++
          if (col.columnType !== 'PgInteger') bad.push(`${name}.${col.name} is ${col.columnType}, want PgInteger`)
        }
      }
    }
    expect(bad).toEqual([])
    expect(checked).toBeGreaterThan(40)
  })
  it('every pg reference table has server_seq', () => {
    const refTables = ['user', 'device', 'setting', 'category', 'product', 'size', 'product_variant', 'sweetness_level', 'channel', 'price', 'recipe', 'recipe_line', 'item', 'purchase_unit', 'bom', 'bom_line', 'equipment', 'customer']
    for (const n of refTables) {
      const cols = pgConfig(pgTables.get(n)!).columns.map((c) => c.name)
      expect(cols, n).toContain('server_seq')
    }
  })
  it('every pg transaction table has server_received_at', () => {
    const txTables = ['purchase', 'purchase_line', 'production_batch', 'stock_count', 'stock_count_line', 'stock_movement', 'shift', 'cash_movement', 'cash_count', 'z_report', 'order', 'order_line', 'payment', 'discount', 'order_event', 'order_payment_intent']
    for (const n of txTables) {
      const t = pgTables.get(n)
      expect(t, `pg table ${n} missing`).toBeDefined()
      expect(pgConfig(t!).columns.map((c) => c.name), n).toContain('server_received_at')
    }
  })
  it('local-only and server-only tables exist on their side only', () => {
    expect(sqliteTables.has('outbox')).toBe(true)
    expect(sqliteTables.has('sync_state')).toBe(true)
    expect(pgTables.has('outbox')).toBe(false)
    expect(pgTables.has('sync_state')).toBe(false)
    expect(pgTables.has('idempotency_record')).toBe(true)
    expect(pgTables.has('invariant_run')).toBe(true)
    expect(sqliteTables.has('idempotency_record')).toBe(false)
    expect(sqliteTables.has('invariant_run')).toBe(false)
  })
})
