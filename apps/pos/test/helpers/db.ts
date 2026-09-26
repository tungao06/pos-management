import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import type { MilkCode, Size, Sweetness } from '@dayo/dayo-pricing'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { nodeSqliteCallback, type NodeSqliteLike } from '@dayo/db-schema/testing'
import { priceCart } from '@dayo/domain'
import type { ApiDeps } from '../../src/api/deps'
import { createPosApi } from '../../src/api/pos-api'
import { PAYMENT_CODE, type CommitSaleInput, type CommitSaleResult, type DeviceDto, type PosApi, type RecordSaleInput, type SetupInput, type ShiftDto, type UserDto } from '../../src/api/types'
import { initDatabase } from '../../src/db/init'
import { createMemorySecretStore } from '../../src/sync/secret-store'
import { openConnectedApi } from './dayo'

// Node's built-ins are taken from `process.getBuiltinModule`, never named in an `import` statement: this helper is
// also used by a jsdom test file (`test/close-shift-screen.test.tsx`, the close screen driven against the real
// API), and Vite's "client" environment — the one jsdom tests run in — refuses to resolve an imported built-in.
const { mkdtempSync, readFileSync } = process.getBuiltinModule('node:fs')
const { tmpdir } = process.getBuiltinModule('node:os')
const { join } = process.getBuiltinModule('node:path')
const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
export type DatabaseSync = DatabaseSyncType

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

/** Deterministic lowercase UUIDs for tests — every id the app writes must pass the contract's Uuid (spec §4.1). */
export function sequentialIds(): () => string {
  let n = 0
  return () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`
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

export async function openTestApi(opts: { fetch?: typeof fetch; now?: string } = {}): Promise<TestApi> {
  const { raw, db } = await openTestDb()
  const clock = testClock(opts.now)
  const deps: ApiDeps = {
    now: clock.now, newId: sequentialIds(), pinCost: { ...TEST_PIN_COST }, exportDbFile: async () => vacuumInto(raw),
    fetch: opts.fetch ?? (async () => { throw new TypeError('offline in tests') }),
    secrets: createMemorySecretStore(),
    random: () => 0.5,
  }
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

/**
 * A device linked to the mock dayo (prefix A, owners TungAo 1111 and DCm 2222, PromptPay id) with an open shift and a
 * 500 baht float on 2026-09-17 — the day every plan-3/4 expectation was written for.
 */
export async function openReadyApi(): Promise<ReadyApi> {
  return openConnectedApi({ now: '2026-09-17T03:00:00.000Z' })
}

/**
 * Sells lines of dayo's catalog through recordSale with the total the screen would show: priceCart at "now", the same
 * instant recordSale uses (the test clock does not move in between). Defaults: 16 oz, 50%, fresh milk, the default
 * grade for Matcha Latte, the shop's default channel, sold by the first owner.
 */
export async function sellCode(
  t: ReadyApi,
  lines: { code: string; size?: Size; sweetness?: Sweetness; milk?: MilkCode; grade?: string | null; qty: number }[],
  payment: RecordSaleInput['payment'],
  extra: { billDiscountSatang?: number; reason?: string; channelCode?: string; actorUserId?: string; orderId?: string } = {},
): Promise<CommitSaleResult> {
  const cat = await t.api.loadSellCatalog()
  const cart: RecordSaleInput['cart'] = {
    channelCode: extra.channelCode ?? cat.defaultChannelCode, promoCode: null, skipPromotionIds: [], noPromotions: false,
    billDiscount: extra.billDiscountSatang === undefined ? null : { kind: 'satang', satang: extra.billDiscountSatang, reason: extra.reason ?? 'ทดสอบ' },
    lines: lines.map((l) => ({ code: l.code, size: l.size ?? '16 oz', sweetness: l.sweetness ?? '50%', milk: l.milk ?? 'fresh', grade: l.grade ?? (l.code === 'Matcha Latte' ? 'Excellent' : null), qty: l.qty, free: false, discountSatang: null, discountPercent: null, discountReason: null })),
  }
  // the total the screen would show; a cart the pricing code refuses is sent as is, so recordSale gives the refusal
  let shown = 0
  try {
    shown = priceCart({ ...cart, paymentCode: PAYMENT_CODE[payment.method] }, cat.catalog, t.clock.now()).totalSatang
  } catch {
    shown = 0
  }
  return t.api.recordSale({ orderId: extra.orderId ?? t.deps.newId(), actorUserId: extra.actorUserId ?? t.owner.id, cart, payment, expectedTotalSatang: shown })
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
