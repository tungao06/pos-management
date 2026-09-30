import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import type { CentralOrder } from '@dayo/contracts'
import { MOCK_API_KEY } from '@dayo/dayo-mock'
import { loadContractFixture } from '@dayo/contracts/fixture-files'
import { priceCart, type CartDraft } from '@dayo/domain'
import { pullCatalog, readCatalog, readSupported } from '../src/sync/catalog'
import { pushOnce } from '../src/sync/push'
import { DAYO_KEYS, readKey, writeKey } from '../src/sync/state'
import { openConnectedApi } from './helpers/dayo'
import { openTestApi, sellCode } from './helpers/db'

/**
 * Task 19 round 2: what the tablet does with the E1 fixture that copies dayo main (`e1-catalog-changed-main`), with promotion times
 * in both forms dayo has sent (HH:MM now, HH:MM:SS before), and with E3 timestamps that carry 6 fractional digits
 * (Postgres timestamptz → "…01.615815+00:00").
 */

const TUNGAO = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'
type E1Data = Record<string, unknown> & { catalog_version: number; server_time: string; pricing: unknown; supported_kinds: string[]; supported_fields: Record<string, unknown>; catalog: { promotions: Record<string, unknown>[] } }
const dataOf = (name: string): E1Data => structuredClone((loadContractFixture(name).response.body as { data: E1Data }).data)

/** A dayo that answers E1 with `data` whatever is asked (the fixture was recorded for promo_rule_version=1; the tablet always asks 2). */
function e1Dayo(data: E1Data) {
  const serve: typeof globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })
  return serve
}

describe('e1-catalog-changed-main (the E1 shape of dayo main)', () => {
  const target = { baseUrl: 'http://localhost:8787/api/v1', apiKey: MOCK_API_KEY }
  it('setup: probeDayo reads client.last_z_* of the fixture, connectShop stores the catalog, the 6 kinds and promotion_rule_versions [1, 2]', async () => {
    const t = await openTestApi({ fetch: e1Dayo(dataOf('e1-catalog-changed-main')), now: '2026-09-30T03:00:00.000Z' })
    const probe = await t.api.probeDayo(target)
    expect(probe.lastZNo).toBe(41)
    expect(probe.catalogVersion).toBe(43)
    await t.api.connectShop({ ...target, receiptPrefix: 'A', ownerStaffId: TUNGAO, ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null, confirmedLastZNo: probe.lastZNo })
    const stored = (await readCatalog(t.db))!
    expect(stored.catalogVersion).toBe(43)
    expect(stored.catalog.promotions).toHaveLength(4) // the v2 tiered promotion is not sent at promo_rule_version=1
    expect(stored.catalog.promotions.every((p) => p.applyMode !== undefined)).toBe(true)
    expect(stored.catalog.promotionGroups?.map((g) => g.code)).toEqual(['main', 'stack'])
    const sup = (await readSupported(t.db))!
    expect(sup.kinds).toEqual(['order', 'order_void', 'shift_open', 'cash_movement', 'cash_count', 'shift_close'])
    expect(sup.promoRuleVersions).toEqual([1, 2])
    expect(sup.fields.order).toContain('manual_promotion_ids')
    expect(sup.fields.shift_close).toContain('z_report')
    expect(await readKey(t.db, DAYO_KEYS.catalogError)).toBeNull()
    expect(await readKey(t.db, DAYO_KEYS.lastZNo)).toBe('41') // the owner confirmed dayo's last Z (spec 04 §4.4 rule 6)
    expect(await readKey(t.db, DAYO_KEYS.lastZUntil)).toBe('2026-09-24T12:00:00.000Z')
    expect((await t.api.bootstrap()).promo).toEqual({ manualSupported: true, ruleBehind: false, ruleVersions: [1, 2] })
  })
  it('pullCatalog accepts it as a changed catalog', async () => {
    const t = await openTestApi({ fetch: e1Dayo(dataOf('e1-catalog-changed-main')), now: '2026-09-30T03:00:00.000Z' })
    await writeKey(t.db, DAYO_KEYS.baseUrl, 'https://mock/api/v1')
    await t.deps.secrets.setApiKey(MOCK_API_KEY)
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    expect((await readCatalog(t.db))?.catalog.variants.every((v) => ['ชาไทย', 'ชาเขียว', 'มัตจะ', 'อื่นๆ'].includes(v.family))).toBe(true)
    expect(await readKey(t.db, DAYO_KEYS.catalogError)).toBeNull()
  })
})

describe('promotion times: HH:MM and HH:MM:SS are the same window for the pricing of the tablet', () => {
  const cart: CartDraft = {
    channelCode: 'store', paymentCode: 'cash', billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, manualPromotionIds: [], manualPromotionReason: null,
    lines: [{ code: 'Matcha Latte', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: 'Excellent', qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null }],
  }
  // "มัตจะช่วงเย็น ลด 10%": 17:00–20:00 Bangkok every day. 2026-09-25 is a Friday (the tiered promotion of the other fixture is not in this catalog).
  const IN = '2026-09-25T11:00:00.000Z' // 18:00 Bangkok
  const OUT = '2026-09-25T03:00:00.000Z' // 10:00 Bangkok
  const END = '2026-09-25T13:00:00.000Z' // 20:00 Bangkok — the end of a window is inclusive (promoRule.ts:461-470)
  const AFTER = '2026-09-25T13:01:00.000Z' // 20:01 Bangkok
  const NAME = 'มัตจะช่วงเย็น ลด 10%'
  /**
   * 'windows' = the promotion as dayo main sends it (timeFrom/timeTo "17:00" AND timeWindows "17:00");
   * 'legacy' = only the old columns, "17:00" · 'legacy-seconds' = only the old columns as a Postgres time, "17:00:00"
   * (timeWindows are always HH:MM — dayo validates them; the columns are what older dayo sent as HH:MM:SS).
   */
  async function catalogWith(form: 'windows' | 'legacy' | 'legacy-seconds') {
    const d = dataOf('e1-catalog-changed-main')
    const evening = d.catalog.promotions.find((p) => p['name'] === NAME)!
    if (form !== 'windows') for (const k of ['template', 'rule', 'timeWindows', 'groupCode', 'summaryTh']) delete evening[k]
    if (form === 'legacy-seconds') { evening['timeFrom'] = '17:00:00'; evening['timeTo'] = '20:00:00' }
    const t = await openTestApi({ fetch: e1Dayo(d), now: '2026-09-25T03:00:00.000Z' })
    await writeKey(t.db, DAYO_KEYS.baseUrl, 'https://mock/api/v1')
    await t.deps.secrets.setApiKey(MOCK_API_KEY)
    expect((await pullCatalog({ db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() })).outcome).toBe('changed')
    const stored = (await readCatalog(t.db))!.catalog
    expect(stored.promotions.find((p) => p.name === NAME)!.timeFrom).toBe(form === 'legacy-seconds' ? '17:00:00' : '17:00') // stored exactly as sent
    return stored
  }
  const price = (c: Awaited<ReturnType<typeof catalogWith>>, at: string) => priceCart(cart, c as never, at)
  it.each([['windows'], ['legacy'], ['legacy-seconds']] as const)('%s: 18:00 and 20:00 sell at the promotion price, 10:00 and 20:01 do not', async (form) => {
    const c = await catalogWith(form)
    const inside = price(c, IN)
    expect(inside.promotionsApplied.map((p) => p.name)).toEqual([NAME])
    expect(inside.totalSatang).toBe(7_650) // ฿85 − 10%
    expect(price(c, OUT).promotionsApplied).toEqual([])
    expect(price(c, END).promotionsApplied.map((p) => p.name)).toEqual([NAME])
    expect(price(c, AFTER).promotionsApplied).toEqual([])
  })
  it('the three forms price the same bill to the satang', async () => {
    const [a, b, c] = [price(await catalogWith('windows'), IN), price(await catalogWith('legacy'), IN), price(await catalogWith('legacy-seconds'), IN)]
    expect([b.totalSatang, c.totalSatang]).toEqual([a.totalSatang, a.totalSatang])
    expect([b.promotionsApplied, c.promotionsApplied]).toEqual([a.promotionsApplied, a.promotionsApplied])
  })
})

describe('E3 timestamps with 6 fractional digits (Postgres microseconds)', () => {
  const MICRO = '.615815'
  /** dayo's list_api_orders writes timestamptz as text: the same instant with microseconds — sub-millisecond digits the tablet must survive. */
  const withMicros = (t: string | null | undefined): string | null | undefined => (typeof t === 'string' ? t.replace(/(\.\d+)?\+00:00$/, `${MICRO}+00:00`) : t)
  function microE3(inner: typeof fetch): typeof fetch {
    return async (input, init) => {
      const res = await inner(input, init)
      if (!String(input).includes('/api/v1/orders') || !res.ok) return res
      const body = (await res.json()) as { ok: true; data: CentralOrder[] }
      body.data = body.data.map((o) => ({
        ...o, updated_at: withMicros(o.updated_at) ?? null, sold_at: withMicros(o.sold_at),
        ...(o.dayo_edit ? { dayo_edit: { ...o.dayo_edit, edited_at: withMicros(o.dayo_edit.edited_at)! } } : {}),
      }))
      return new Response(JSON.stringify(body), { status: 200, headers: res.headers })
    }
  }

  it('dayo_edit.edited_at and updated_at with 6 digits: the edit is read, the mark is kept, the next refresh asks a valid updated_since', async () => {
    const t = await openConnectedApi()
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
    t.mock.setNow('2026-09-25T03:05:00.000Z')
    t.mock.editPosOrder(r.orderId, { kind: 'edit', reason: 'ลูกค้าเปลี่ยนเมนู', totals: { total: 50 } })
    const urls: string[] = []
    const inner = microE3(t.deps.fetch)
    t.deps.fetch = async (input, init) => { urls.push(String(input)); return inner(input, init) }
    expect(await t.api.refreshDayoEdits()).toEqual({ updated: 1 })
    const d = await t.api.getOrder(r.orderId)
    expect(d.dayoEdit).toEqual({ kind: 'edit', editedAt: `2026-09-25T03:05:00${MICRO}+00:00`, editedByName: 'TungAo', reason: 'ลูกค้าเปลี่ยนเมนู', version: 2 })
    expect(d).toMatchObject({ totalSatang: 4500, status: 'paid' }) // the money collected here never changes
    expect(await readKey(t.db, DAYO_KEYS.dayoEditsSince)).toBe(`2026-09-25T03:05:00${MICRO}+00:00`)
    expect(await t.api.refreshDayoEdits()).toEqual({ updated: 0 }) // the same edit again writes nothing
    // Date.parse keeps the millisecond part of a 6-digit instant; the mark goes 5 minutes back as usual
    expect(new URL(urls[1]!).searchParams.get('updated_since')).toBe('2026-09-25T03:00:00.615Z')
    expect(await t.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'dayo_edit_seen')).all()).toHaveLength(1)
  })
  it('bot/web bills of today with 6-digit updated_at and sold_at are listed, newest first', async () => {
    const t = await openConnectedApi()
    const bill = (order_no: string, sold: string): CentralOrder => ({
      order_no, sale_date: '2026-09-25', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'store', payment: 'cash',
      totals: { items_subtotal: 45, items_discount: 0, bill_discount: 0, total: 45, fee: 0 }, amount_mismatch: false, updated_at: `${sold}${MICRO}+00:00`, sold_at: `${sold}${MICRO}+00:00`,
      created_by_name: 'DCm', duplicate_suspect: false,
    })
    t.mock.seedCentralOrders([bill('L260925-013', '2026-09-25T02:50:00'), bill('L260925-014', '2026-09-25T02:55:00')])
    t.deps.fetch = microE3(t.deps.fetch)
    const got = await t.api.listCentralOrdersToday()
    expect(got.map((o) => o.orderNo)).toEqual(['L260925-014', 'L260925-013'])
  })
})
