import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { and, desc, eq, isNotNull, max } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import type { MilkCode, Size, Sweetness } from '@dayo/dayo-pricing'
import { loadCatalogSqlite, type RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { nodeSqliteCallback, type NodeSqliteLike } from '@dayo/db-schema/testing'
import { cashChangeSatang, explodeNeeds, lineUnitCostSatang, nextReceiptNo, priceCart, saleMovements } from '@dayo/domain'
import { currentOpenShift, LOCAL_DEVICE_KEY } from '../../src/api/bootstrap'
import type { ApiDeps } from '../../src/api/deps'
import { PosError } from '../../src/api/errors'
import { createPosApi } from '../../src/api/pos-api'
import { PROMPTPAY_SETTING_KEY } from '../../src/api/setup'
import { PAYMENT_CODE, REASON_MAX_LENGTH, type DeviceDto, type PosApi, type RecordSaleInput, type RecordSaleResult, type ShiftDto, type UserDto } from '../../src/api/types'
import { appendOrderEvents, type NewEvent } from '../../src/db/events'
import { initDatabase } from '../../src/db/init'
import { insertMovements, loadCostStates, makeCostOf } from '../../src/db/stock'
import { hashPin } from '../../src/lib/pin'
import { createMemorySecretStore } from '../../src/sync/secret-store'
import { openConnectedApi } from './dayo'
import { createTestLocks } from './locks'

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

/**
 * The PosApi's scheduler gets its own Web Locks stand-in (helpers/locks.ts) — never the host's navigator.locks, which
 * Node 24 has and Node 22 does not, and which one test's hung request would hold for the whole file.
 */
export async function openTestApi(opts: { fetch?: typeof fetch; now?: string } = {}): Promise<TestApi> {
  const { raw, db } = await openTestDb()
  const clock = testClock(opts.now)
  const deps: ApiDeps = {
    now: clock.now, newId: sequentialIds(), pinCost: { ...TEST_PIN_COST }, exportDbFile: async () => vacuumInto(raw),
    fetch: opts.fetch ?? (async () => { throw new TypeError('offline in tests') }),
    secrets: createMemorySecretStore(),
    random: () => 0.5,
  }
  return { api: createPosApi(db, deps, { locks: createTestLocks() }), db, raw, clock, deps }
}

export const PINS = { TungAo: '1111', DCm: '2222' } as const

export type DeviceSetupInput = { deviceName: string; receiptPrefix: string; owners: { displayName: string; pin: string }[]; promptPayId: string }

/**
 * The old first-run setup API's writes, direct — that API was deleted in Task 22, replaced everywhere selling means
 * by `connectShop`. A device, one setting row and one user row per owner, all version 1 at `t.clock.now()`. Only for
 * tests whose real subject is something else (opening a shift, receiving stock, a cash movement, …) and just needs a
 * device on record first; never validates input the way the API it replaces did.
 */
export async function insertLegacyShop(t: TestApi, input: DeviceSetupInput): Promise<{ deviceId: string; ownerIds: string[] }> {
  const at = t.clock.now()
  const deviceId = t.deps.newId()
  await t.db.insert(s.device).values({ id: deviceId, name: input.deviceName, receiptPrefix: input.receiptPrefix, isSellingDevice: true, registeredAt: at, version: 1, updatedAt: at })
  await t.db.insert(s.syncState).values({ key: LOCAL_DEVICE_KEY, value: deviceId })
  const ownerIds: string[] = []
  for (const o of input.owners) {
    const id = t.deps.newId()
    ownerIds.push(id)
    await t.db.insert(s.user).values({ id, displayName: o.displayName, role: 'owner', pinHash: await hashPin(o.pin, TEST_PIN_COST), isActive: true, createdAt: at, updatedAt: at, version: 1 })
  }
  await t.db.insert(s.setting).values({ key: PROMPTPAY_SETTING_KEY, valueJson: input.promptPayId, effectiveFrom: at, updatedAt: at, version: 1 })
  return { deviceId, ownerIds }
}

/** The shape `insertLegacyShop` used to get from the API caller — same device name/prefix/owners/PromptPay id as before. */
export const TEST_SETUP_INPUT: DeviceSetupInput = {
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
): Promise<RecordSaleResult> {
  const cat = await t.api.loadSellCatalog()
  const cart: RecordSaleInput['cart'] = {
    channelCode: extra.channelCode ?? cat.defaultChannelCode, promoCode: null, skipPromotionIds: [], noPromotions: false, manualPromotionIds: [], manualPromotionReason: null,
    billDiscount: extra.billDiscountSatang === undefined ? null : { kind: 'satang', satang: extra.billDiscountSatang, reason: extra.reason ?? 'ทดสอบ' },
    lines: lines.map((l) => ({ code: l.code, size: l.size ?? '16 oz', sweetness: l.sweetness ?? '50%', milk: l.milk ?? 'fresh', grade: l.grade ?? (l.code === 'Matcha Latte' ? 'Excellent' : null), qty: l.qty, free: false, discountSatang: null, discountPercent: null, discountReason: null })),
  }
  // the total the screen would show — a cart the screen could not even price is a mistake in the test, not a refusal to
  // test here (call t.api.recordSale directly for that)
  let shown: number
  try {
    shown = priceCart({ ...cart, paymentCode: PAYMENT_CODE[payment.method] }, cat.catalog, t.clock.now()).totalSatang
  } catch (e) {
    throw new Error(`sellCode: priceCart refused the cart before recordSale — ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
  return t.api.recordSale({ orderId: extra.orderId ?? t.deps.newId(), actorUserId: extra.actorUserId ?? t.owner.id, cart, payment, expectedTotalSatang: shown })
}

/**
 * A plan-3 style paid order (spec 04 §6.1's "legacy" bill: `sold_at` null) — one SKU at 50% sweetness, sold by the
 * first owner, written directly against the local catalog's price and recipe: order + order_line + payment
 * (+ discount) + SALE movements + hash-chained events, one transaction, exactly as the old in-store sale API used to
 * write it before it was deleted in Task 22 along with the rest of the plan-3 pricing path. A device that sold
 * before block 2 can still have rows shaped like this, so this stays as a fixture for the screens that must keep
 * reading them correctly. `NO_OPEN_SHIFT` / `BAD_INPUT` are thrown with the same wording that old API used, for
 * tests that check for them.
 *
 * This is NOT a drop-in replacement for the old sale path's validation — it is a narrow test-seed helper. It picks
 * whichever price row `.get()` returns rather than choosing by `effectiveFrom` (only seed one current price row per
 * SKU), only refuses a discount strictly greater than the subtotal (a discount exactly equal to it hits the raw DB
 * `CHECK` constraint instead of the old `DISCOUNT_TOO_BIG`, so keep discounts strictly less than the total), and
 * never checks `TENDER_TOO_LOW`, quantity limits, or the acting user the way `recordSale` does.
 *
 * It also writes with `t.db.transaction` directly, not through the API's `serial` queue the way the old
 * `sellSku`→`commitSale` did — do not call this while another API call may still be in flight in the same test
 * (SQLite does not allow a transaction to start inside another one).
 */
export async function legacySale(
  t: ReadyApi,
  sku: string,
  qty: number,
  payment: { method: 'CASH'; tenderedSatang: number } | { method: 'PROMPTPAY' },
  discount: { amountSatang: number; reason: string } | null = null,
): Promise<RecordSaleResult> {
  const cleanDiscount = discount === null ? null : { amountSatang: discount.amountSatang, reason: discount.reason.trim() }
  if (cleanDiscount !== null && cleanDiscount.reason.length > REASON_MAX_LENGTH) throw new PosError('BAD_INPUT', `a reason is at most ${REASON_MAX_LENGTH} characters`)

  const variant = await t.db.select().from(s.productVariant).where(eq(s.productVariant.sku, sku)).get()
  const sweet = await t.db.select().from(s.sweetnessLevel).where(eq(s.sweetnessLevel.code, 'S050')).get()
  if (!variant || !sweet) throw new Error(`no variant ${sku} or sweetness S050`)
  const product = await t.db.select().from(s.product).where(eq(s.product.id, variant.productId)).get()
  const size = await t.db.select().from(s.size).where(eq(s.size.id, variant.sizeId)).get()
  const channel = await t.db.select().from(s.channel).where(eq(s.channel.code, 'STORE')).get()
  if (!product || !size || !channel) throw new Error(`missing product/size/channel for ${sku}`)
  const price = await t.db.select().from(s.price).where(and(eq(s.price.variantId, variant.id), eq(s.price.channelId, channel.id))).get()
  if (!price) throw new Error(`no price for ${sku}`)
  const recipe = await t.db.select().from(s.recipe).where(and(eq(s.recipe.variantId, variant.id), eq(s.recipe.sweetnessId, sweet.id), eq(s.recipe.isCurrent, true))).get()
  if (!recipe) throw new Error(`no current recipe for ${sku}/S050`)
  const recipeLines = await t.db.select().from(s.recipeLine).where(eq(s.recipeLine.recipeId, recipe.id)).all()

  return t.db.transaction(async (tx) => {
    const shift = await currentOpenShift(tx, t.device.id)
    if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'open a shift before selling')
    const catalog = await loadCatalogSqlite(tx)
    const costOf = makeCostOf(catalog, await loadCostStates(tx))
    const needs = explodeNeeds(recipeLines.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli })), qty, catalog)
    const unitCostSatang = lineUnitCostSatang(needs, costOf, qty)

    const subtotalSatang = price.priceSatang * qty
    const discountSatang = cleanDiscount?.amountSatang ?? 0
    if (discountSatang > subtotalSatang) throw new PosError('DISCOUNT_TOO_BIG', 'discount exceeds subtotal')
    const totalSatang = subtotalSatang - discountSatang

    const at = t.clock.now()
    const orderId = t.deps.newId()
    let tenderedSatang: number | null = null
    let changeSatang: number | null = null
    if (payment.method === 'CASH') {
      tenderedSatang = payment.tenderedSatang
      changeSatang = cashChangeSatang(totalSatang, tenderedSatang)
    }
    const lastReceipt = await tx.select({ r: s.order.receiptNo }).from(s.order).where(and(eq(s.order.deviceId, t.device.id), isNotNull(s.order.receiptNo))).orderBy(desc(s.order.receiptNo)).limit(1).get()
    const receiptNo = nextReceiptNo(t.device.receiptPrefix, lastReceipt?.r ?? null)
    const lastQueue = await tx.select({ q: max(s.order.queueNo) }).from(s.order).where(and(eq(s.order.deviceId, t.device.id), eq(s.order.businessDate, shift.businessDate))).get()
    const queueNo = (lastQueue?.q ?? 0) + 1

    await tx.insert(s.order).values({
      id: orderId, origin: 'device', deviceId: t.device.id, receiptNo, queueNo, businessDate: shift.businessDate, shiftId: shift.id,
      channelId: channel.id, customerId: null, status: 'paid', subtotalSatang, discountSatang, totalSatang, vatSatang: 0,
      costSatang: unitCostSatang * qty, note: null, createdByType: 'user', createdById: t.owner.id, createdAt: at, paidAt: at, readyAt: null, voidedAt: null,
    })
    await tx.insert(s.orderLine).values({
      id: t.deps.newId(), orderId, lineNo: 1, variantId: variant.id, sweetnessId: sweet.id, recipeId: recipe.id,
      productName: product.nameTh, sizeName: size.name, sweetnessName: sweet.name, unitPriceSatang: price.priceSatang, qty, lineTotalSatang: subtotalSatang, unitCostSatang,
    })
    if (cleanDiscount !== null) {
      await tx.insert(s.discount).values({ id: t.deps.newId(), orderId, amountSatang: cleanDiscount.amountSatang, reason: cleanDiscount.reason, approvedBy: t.owner.id })
    }
    await tx.insert(s.payment).values({
      id: t.deps.newId(), orderId, method: payment.method, amountSatang: totalSatang, tenderedSatang, changeSatang, reference: null, verifyStatus: 'manual', createdBy: t.owner.id, createdAt: at,
    })
    const movementIds = await insertMovements(tx, t.deps, saleMovements(needs, costOf, orderId), { businessDate: shift.businessDate, deviceId: t.device.id, createdBy: t.owner.id, at }, catalog)

    const events: NewEvent[] = [
      { type: 'CREATED', payload: { origin: 'device', channelId: channel.id, shiftId: shift.id, businessDate: shift.businessDate } },
      { type: 'LINE_ADDED', payload: { lineNo: 1, variantId: variant.id, sweetnessId: sweet.id, recipeId: recipe.id, qty, unitPriceSatang: price.priceSatang, lineTotalSatang: subtotalSatang } },
    ]
    if (cleanDiscount !== null) events.push({ type: 'DISCOUNT_APPLIED', payload: { amountSatang: cleanDiscount.amountSatang, reason: cleanDiscount.reason, approvedBy: t.owner.id } })
    events.push({ type: 'PAID', payload: { receiptNo, queueNo, method: payment.method, subtotalSatang, discountSatang, totalSatang, tenderedSatang, changeSatang } })
    events.push({ type: 'STOCK_DEDUCTED', payload: { movementIds, costSatang: unitCostSatang * qty } })
    await appendOrderEvents(tx, { orderId, deviceId: t.device.id, actorType: 'user', actorId: t.owner.id, at, newId: t.deps.newId }, events)

    return { orderId, receiptNo, queueNo, businessDate: shift.businessDate, totalSatang, changeSatang, method: payment.method }
  })
}
