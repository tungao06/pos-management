import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { nodeSqliteCallback, type NodeSqliteLike } from '@dayo/db-schema/testing'
import type { ApiDeps } from '../../src/api/deps'
import { createPosApi } from '../../src/api/pos-api'
import type { CommitSaleInput, CommitSaleResult, DeviceDto, PosApi, SetupInput, ShiftDto, UserDto } from '../../src/api/types'
import { initDatabase } from '../../src/db/init'

/** Tiny argon2 cost so tests stay fast (production uses PROD_PIN_COST). */
export const TEST_PIN_COST = { t: 1, m: 64 } as const

export type TestClock = { now: () => string; set: (iso: string) => void; advanceMs: (ms: number) => void }

export function testClock(startIso = '2026-09-17T03:00:00.000Z'): TestClock {
  let t = Date.parse(startIso)
  return {
    now: () => new Date(t).toISOString(),
    set: (iso) => {
      t = Date.parse(iso)
    },
    advanceMs: (ms) => {
      t += ms
    },
  }
}

export function sequentialIds(prefix = 'id'): () => string {
  let n = 0
  return () => `${prefix}-${String(++n).padStart(6, '0')}`
}

export async function openTestDb(): Promise<{ raw: DatabaseSync; db: RemoteDb; init: { migrated: string[]; seeded: boolean } }> {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  const db = drizzle(nodeSqliteCallback(raw as unknown as NodeSqliteLike))
  const init = await initDatabase(db)
  return { raw, db, init }
}

/** Test stand-in for opfs-sahpool `exportFile`: a consistent copy of the in-memory database via `VACUUM INTO`. */
export function vacuumInto(raw: DatabaseSync): Uint8Array {
  const file = join(mkdtempSync(join(tmpdir(), 'dayo-backup-')), 'copy.sqlite3')
  raw.prepare('VACUUM INTO ?').run(file)
  return new Uint8Array(readFileSync(file))
}

export type TestApi = { api: PosApi; db: RemoteDb; raw: DatabaseSync; clock: TestClock; deps: ApiDeps }

export async function openTestApi(): Promise<TestApi> {
  const { raw, db } = await openTestDb()
  const clock = testClock()
  const deps: ApiDeps = { now: clock.now, newId: sequentialIds(), pinCost: { ...TEST_PIN_COST }, exportDbFile: async () => vacuumInto(raw) }
  return { api: createPosApi(db, deps), db, raw, clock, deps }
}

export const PINS = { TungAo: '1111', DCm: '2222' } as const

export const TEST_SETUP: SetupInput = {
  deviceName: 'แท็บเล็ตทดสอบ',
  receiptPrefix: 'A',
  owners: [
    { displayName: 'TungAo', pin: PINS.TungAo },
    { displayName: 'DCm', pin: PINS.DCm },
  ],
  promptPayId: '0812345678',
}

export type ReadyApi = TestApi & { owner: UserDto; other: UserDto; device: DeviceDto; shift: ShiftDto }

/** Set-up device (prefix A), two owners, PromptPay id, and an open shift with a 500 baht float on 2026-09-17. */
export async function openReadyApi(): Promise<ReadyApi> {
  const t = await openTestApi()
  await t.api.setupShop(TEST_SETUP)
  const boot = await t.api.bootstrap()
  const owner = boot.users.find((u) => u.displayName === 'TungAo')!
  const other = boot.users.find((u) => u.displayName === 'DCm')!
  const shift = await t.api.openShift({ userId: owner.id, openingFloatSatang: 50_000 })
  return { ...t, owner, other, device: boot.device!, shift }
}

/**
 * D50 Q3-27: the total the cart would show for these lines right now (menu price × qty − discount) — what a test
 * passes as commitSale's expectedTotalSatang. Plain arithmetic on purpose: it must not share code with commitSale.
 */
export async function shownTotalSatang(t: TestApi, lines: CommitSaleInput['lines'], discount: CommitSaleInput['discount']): Promise<number> {
  const menu = await t.api.loadMenu()
  const price = (variantId: string): number => menu.variants.find((v) => v.id === variantId)?.priceSatang ?? 0
  return lines.reduce((sum, l) => sum + price(l.variantId) * l.qty, 0) - (discount?.amountSatang ?? 0)
}

/** One-line sale at 50% sweetness by the first owner (test shortcut). */
export async function sellSku(
  t: ReadyApi,
  sku: string,
  qty: number,
  payment: CommitSaleInput['payment'],
  discount: CommitSaleInput['discount'] = null,
): Promise<CommitSaleResult> {
  const variant = await t.db.select().from(s.productVariant).where(eq(s.productVariant.sku, sku)).get()
  const sweet = await t.db.select().from(s.sweetnessLevel).where(eq(s.sweetnessLevel.code, 'S050')).get()
  if (!variant || !sweet) throw new Error(`no variant ${sku} or sweetness S050`)
  const lines = [{ variantId: variant.id, sweetnessId: sweet.id, qty }]
  return t.api.commitSale({ orderId: t.deps.newId(), actorUserId: t.owner.id, lines, discount, payment, expectedTotalSatang: await shownTotalSatang(t, lines, discount) })
}
