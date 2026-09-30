import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { addItem, login, mockState, openShift, setOtherPin, setupDevice } from './helpers'

/**
 * Plan 10 Task 10: promotion rules (spec 04 §4.4 · ADR-0070/0071/0072) against dayo-mock, through the real screens.
 * Every expected baht figure is hand arithmetic on the catalog prices (Thai Tea 16 oz ฿35, 20 oz ฿45, Matcha Latte 20 oz
 * ฿95 — packages/contracts/fixtures/pos-test/e1-catalog-rich.json) or, for the stacked case, the values of dayo's own
 * golden `rules-breakdown.json` ("ส่วนลดเท่ากันแต่แบ่งต่างกัน": 2 cups ฿70 − ฿10 = ฿60) — never the mock's own answer.
 * Owner rulings in force: Q1 = ข (a ฿0 bill from promotions is sold, cash only) · Q2 = ก / D133 (reason only for a ฿0 bill
 * with a manual promotion) · Q3 = ก ("จำกัด n ครั้ง" badge, the tablet never counts uses).
 */

const MOCK = 'http://localhost:8787'
type Json = Record<string, unknown>

// ── what the owner saves on dayo's web: the rule only, dayo derives the old shape (mock promotionRow) ──────────────────
const GROUPS = [
  { code: 'main', name: 'ทั่วไป', sortOrder: 0, stackMode: 'separate', isActive: true },
  { code: 'stack', name: 'ซ้อนได้', sortOrder: 1, stackMode: 'stack', isActive: true },
]
function promo(id: string, name: string, priority: number, applyMode: 'auto' | 'manual', template: string, rule: Json, extra: Json = {}): Json {
  return {
    id, code: null, name, applyMode, startsOn: null, endsOn: null, channelCodes: [], requiresCode: false, autoApply: applyMode === 'auto',
    isActive: true, usageLimitTotal: null, usageLimitPerDay: null, priority, template, rule, timeWindows: [], groupCode: 'main', summaryTh: null, ...extra,
  }
}
const ID = (n: number): string => `7a7a7a7a-0000-4000-8000-${String(n).padStart(12, '0')}`
/** ชา (category) at 20 oz, 20% off — auto, with a limit of 300 in all and 30 a day. */
const AUTO_20OZ = ID(1)
const autoTea20 = (): Json =>
  promo(AUTO_20OZ, 'ชา 20 oz ลด 20%', 10, 'auto', 'item_discount', { v: 1, scope: 'cup', target: { categories: ['ชา'], sizes: ['20 oz'] }, reward: { type: 'percent', percent: 20 } }, { usageLimitTotal: 300, usageLimitPerDay: 30 })
/** manual ฿5 off Thai Tea, limit 100 in all. */
const MANUAL_5 = ID(2)
const manual5 = (): Json =>
  promo(MANUAL_5, 'ลดชาไทย 5 บาท (เลือกเอง)', 50, 'manual', 'item_discount', { v: 1, scope: 'cup', target: { menus: ['Thai Tea'] }, reward: { type: 'amount', baht: 5 } }, { usageLimitTotal: 100 })
/** manual "brewed wrong — free cup", 100% off anything. */
const MANUAL_FREE = ID(3)
const manualFree = (): Json => promo(MANUAL_FREE, 'ชงผิด ฟรีแก้วใหม่ (เลือกเอง)', 40, 'manual', 'item_discount', { v: 1, scope: 'cup', target: {}, reward: { type: 'percent', percent: 100 } })

async function ctl(request: APIRequestContext, path: string, body: unknown = {}): Promise<void> {
  const res = await request.post(`${MOCK}/__mock/${path}`, { data: body })
  expect(res.ok(), `POST /__mock/${path} → ${res.status()}`).toBe(true)
}

/** Every order row the tablet posts to /pos/push, as sent (the mock's own log does not keep the wire body). */
function recordPushedOrders(page: Page): Json[] {
  const rows: Json[] = []
  page.on('request', (r) => {
    if (r.method() !== 'POST' || !r.url().endsWith('/api/v1/pos/push')) return
    const body = JSON.parse(r.postData() ?? '{}') as { rows?: { kind: string; data: Json }[] }
    for (const row of body.rows ?? []) if (row.kind === 'order') rows.push(row.data)
  })
  return rows
}

/** A fresh mock playing a dayo of the given release, holding `promotions`; the tablet is then set up, logged in and its shift opened. */
async function startShop(
  page: Page,
  request: APIRequestContext,
  opts: { promoRules?: { versions: number[] | null; manualFields: boolean }; promotions?: Json[]; groups?: Json[] } = {},
): Promise<void> {
  await ctl(request, 'reset')
  if (opts.promoRules !== undefined) await ctl(request, 'promo-rules', opts.promoRules)
  if (opts.promotions !== undefined) await ctl(request, 'promotions', { promotions: opts.promotions, groups: opts.groups ?? GROUPS })
  await setupDevice(page)
  await setOtherPin(page)
  await login(page)
  await openShift(page)
}
const RULES_ON = { versions: [1, 2], manualFields: true }

async function payCashExact(page: Page): Promise<string> {
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  return (await page.getByTestId('done-receipt').textContent()) ?? ''
}

test('promo rules 1: a promotion by category and size applies on its own, with the right total and its limit badges', async ({ page, request }) => {
  await startShop(page, request, { promoRules: RULES_ON, promotions: [autoTea20()] })
  const pushed = recordPushedOrders(page)
  await expect(page.getByTestId('banner-rule-behind')).toHaveCount(0) // dayo is not ahead of this app

  await addItem(page, 'Thai Tea', { size: '16 oz' }) // not 20 oz → no discount
  await expect(page.getByTestId('cart-total')).toHaveText('฿35.00')
  await expect(page.getByTestId(`promo-${AUTO_20OZ}`)).toHaveCount(0)

  await addItem(page, 'Thai Tea', { size: '20 oz' }) // ฿45 − 20% (฿9) = ฿36
  await expect(page.getByTestId('cart-total')).toHaveText('฿71.00')
  await expect(page.getByTestId(`promo-${AUTO_20OZ}`)).toContainText('ชา 20 oz ลด 20%')
  await expect(page.getByTestId(`promo-mode-${AUTO_20OZ}`)).toHaveText('อัตโนมัติ')
  await expect(page.getByTestId(`promo-limit-${AUTO_20OZ}`)).toHaveText('จำกัด 300 ครั้ง') // Q3 = ก: the badge is on auto promotions too
  await expect(page.getByTestId(`promo-limit-day-${AUTO_20OZ}`)).toHaveText('จำกัด 30 ครั้ง/วัน')

  await addItem(page, 'Matcha Latte', { size: '20 oz' }) // another category → full ฿95
  await expect(page.getByTestId('cart-total')).toHaveText('฿166.00')
  await expect(page.getByTestId('manual-promos')).toHaveCount(0) // no manual promotion in this catalog: no chip section

  await payCashExact(page)
  await expect(page.getByTestId('done-sold-by')).toContainText('TungAo') // every bill says who sold it
  await expect.poll(async () => (await mockState(request)).orders.find((o) => o.receiptNo === 'A-000001')).toMatchObject({ status: 'ok', total: 166 })
  // no manual promotion picked → the E2 row carries no manual key at all, and never a usage count (ADR-0072 rule 2)
  expect(pushed).toHaveLength(1)
  expect(Object.keys(pushed[0]!)).not.toContain('manual_promotion_ids')
  expect(Object.keys(pushed[0]!)).not.toContain('manual_promotion_reason')
  expect(Object.keys(pushed[0]!)).not.toContain('exhaustedPromotions')
})

test('promo rules 2: a manual promotion chip lowers the total and the row dayo gets carries manual_promotion_ids', async ({ page, request }) => {
  await startShop(page, request, { promoRules: RULES_ON, promotions: [manual5()] })
  const pushed = recordPushedOrders(page)

  await addItem(page, 'Thai Tea', { size: '16 oz' })
  await expect(page.getByTestId('cart-total')).toHaveText('฿35.00')
  await expect(page.getByTestId(`manual-promo-${MANUAL_5}`)).toBeVisible()
  await expect(page.getByTestId(`promo-limit-${MANUAL_5}`)).toHaveText('จำกัด 100 ครั้ง')

  await page.getByTestId(`manual-promo-${MANUAL_5}`).click()
  await expect(page.getByTestId('cart-total')).toHaveText('฿30.00')
  await expect(page.getByTestId(`promo-mode-${MANUAL_5}`)).toHaveText('เลือกเอง')
  await expect(page.getByTestId('manual-reason')).toHaveCount(0) // D133: a ฿30 bill is not asked for a reason

  await page.getByTestId(`manual-promo-${MANUAL_5}`).click() // tap again = drop
  await expect(page.getByTestId('cart-total')).toHaveText('฿35.00')
  await page.getByTestId(`manual-promo-${MANUAL_5}`).click()
  await expect(page.getByTestId('cart-total')).toHaveText('฿30.00')

  await payCashExact(page)
  await expect.poll(async () => (await mockState(request)).orders.find((o) => o.receiptNo === 'A-000001')).toMatchObject({ status: 'ok', total: 30 })
  expect(pushed).toHaveLength(1)
  expect(pushed[0]!['manual_promotion_ids']).toEqual([MANUAL_5])
  expect(pushed[0]!['manual_promotion_reason'] ?? null).toBeNull()
  expect((pushed[0]!['totals'] as Json)['total']).toBe(30) // baht at the contract edge, one figure
})

test('promo rules 3: a 100% manual promotion makes a ฿0 bill — reason asked, cash only, recorded without taking money', async ({ page, request }) => {
  await startShop(page, request, { promoRules: RULES_ON, promotions: [manualFree()] })
  const pushed = recordPushedOrders(page)
  const reason = 'ชงผิด ทำแก้วใหม่ให้ลูกค้า'

  await addItem(page, 'Thai Tea', { size: '16 oz' })
  await expect(page.getByTestId('manual-reason')).toHaveCount(0) // ฿35 bill → no reason box
  await page.getByTestId(`manual-promo-${MANUAL_FREE}`).click()
  await expect(page.getByTestId('cart-total')).toHaveText('฿0.00')

  // Q1 = ข: allowed, but only in cash, and only with a reason (D133 — asked because the bill is ฿0 AND has a manual promotion)
  await expect(page.getByTestId('manual-reason-hint')).toBeVisible()
  await expect(page.getByTestId('cart-zero-cash-only')).toHaveCount(0) // not payable yet, so no "cash only" note either
  await expect(page.getByTestId('pay-qr')).toBeDisabled()
  await expect(page.getByTestId('pay-cash')).toBeDisabled() // no reason yet
  await page.getByTestId('manual-reason').fill(reason)
  await expect(page.getByTestId('manual-reason-count')).toHaveText(`${reason.length}/200`)
  await expect(page.getByTestId('pay-cash')).toBeEnabled()
  await expect(page.getByTestId('cart-zero-cash-only')).toContainText('รับชำระด้วยเงินสดเท่านั้น')
  await expect(page.getByTestId('pay-qr')).toBeDisabled() // QR stays off for ฿0

  await page.getByTestId('pay-cash').click()
  await expect(page.getByTestId('zero-bill-note')).toBeVisible()
  await expect(page.getByTestId('tender-input')).toHaveCount(0) // nothing to tender
  await page.getByTestId('confirm-cash').click()
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000001')
  await expect(page.getByTestId('done-sold-by')).toContainText('TungAo')

  await expect.poll(async () => (await mockState(request)).orders.find((o) => o.receiptNo === 'A-000001')).toMatchObject({ status: 'ok', total: 0 })
  expect(pushed).toHaveLength(1)
  expect(pushed[0]!['manual_promotion_ids']).toEqual([MANUAL_FREE])
  expect(pushed[0]!['manual_promotion_reason']).toBe(reason)
  expect(pushed[0]!['payment']).toBe('cash')

  // the saved bill shows the reason too
  await page.getByTestId('done-new-sale').click()
  await page.getByTestId('nav-orders').click()
  await page.getByTestId('order-row-A-000001').click()
  await expect(page.getByTestId('order-manual-reason')).toContainText(reason)
})

test('promo rules 4: a stack group shows the discount per cup, and the split of the cup two promotions share', async ({ page, request }) => {
  // dayo golden rules-breakdown "ส่วนลดเท่ากันแต่แบ่งต่างกัน": 2 cups of ฿35 · main: ฿5 a cup capped at ฿8 in all → 5 + 3 ·
  // stack: the dearest cup ฿2 off → the second cup takes 3 + 2 · items discount ฿10 → total ฿60
  const tea = { v: 1, scope: 'cup', target: { menus: ['Thai Tea'] } }
  const mainCap = promo(ID(11), 'ชาไทยลด 5 เพดาน 8', 10, 'auto', 'item_discount', { ...tea, reward: { type: 'amount', baht: 5 }, cap_baht: 8 })
  const stackTwo = promo(
    ID(12), 'ซ้อน แก้วแพงสุดลด 2', 20, 'auto', 'nth_cup',
    { ...tea, reward: { type: 'buy_get', buy: 1, get: 1, get_target: null, get_discount: { baht: 2 }, get_pick: 'most_expensive', max_sets: null } },
    { groupCode: 'stack' },
  )
  await startShop(page, request, { promoRules: RULES_ON, promotions: [mainCap, stackTwo] })
  const pushed = recordPushedOrders(page)

  await addItem(page, 'Thai Tea', { size: '16 oz' })
  await page.getByTestId('cart-inc-0').click()
  await expect(page.getByTestId('cart-qty-0')).toHaveText('2')
  await expect(page.getByTestId('cart-subtotal')).toHaveText('฿70.00')
  await expect(page.getByTestId('cart-total')).toHaveText('฿60.00')
  await expect(page.getByTestId(`promo-${ID(11)}`)).toContainText('−฿8.00')
  await expect(page.getByTestId(`promo-${ID(12)}`)).toContainText('−฿2.00')

  // two priced parts of the one cart line, both ฿5 a cup; only the second is split between the two promotions
  await expect(page.getByTestId('cart-line-discount-0-0')).toContainText('ลด ฿5.00/แก้ว')
  await expect(page.getByTestId('cart-line-discount-0-1')).toContainText('ลด ฿5.00/แก้ว')
  await expect(page.locator('[data-testid^="cart-line-breakdown-0-"]')).toHaveCount(1)
  const breakdown = page.locator('[data-testid^="cart-line-breakdown-0-"]')
  await expect(breakdown).toContainText('ชาไทยลด 5 เพดาน 8 −฿3.00')
  await expect(breakdown).toContainText('ซ้อน แก้วแพงสุดลด 2 −฿2.00')

  await payCashExact(page)
  await expect.poll(async () => (await mockState(request)).orders.find((o) => o.receiptNo === 'A-000001')).toMatchObject({ status: 'ok', total: 60 })
  expect(pushed).toHaveLength(1)
  // the per-cup split is kept with the bill
  await page.getByTestId('done-new-sale').click()
  await page.getByTestId('nav-orders').click()
  await page.getByTestId('order-row-A-000001').click()
  await expect(page.locator('[data-testid^="order-line-breakdown-"]')).toHaveCount(1)
  await expect(page.locator('[data-testid^="order-line-breakdown-"]')).toContainText('ซ้อน แก้วแพงสุดลด 2 −฿2.00')
})

test('promo rules 5: a dayo from before promotion rules has no manual chip, still sells, and its E2 row has no manual keys', async ({ page, request }) => {
  // default mock = dayo main 12885fe: no promotion_rule_versions, no manual_promotion_* in supported_fields.order, legacy promotions only
  await startShop(page, request)
  const pushed = recordPushedOrders(page)
  await expect(page.getByTestId('banner-rule-behind')).toHaveCount(0)

  await addItem(page, 'Thai Tea', { size: '16 oz' })
  await expect(page.getByTestId('cart-total')).toHaveText('฿35.00')
  await expect(page.getByTestId('manual-promos')).toHaveCount(0)
  await expect(page.locator('[data-testid^="manual-promo-"]')).toHaveCount(0)
  // the old buy-2-get-1 still works through the new engine (promoFromLegacy): 3 × ฿35, one free
  await page.getByTestId('cart-inc-0').click()
  await page.getByTestId('cart-inc-0').click()
  await expect(page.getByTestId('cart-total')).toHaveText('฿70.00')

  await payCashExact(page)
  await expect.poll(async () => (await mockState(request)).orders.find((o) => o.receiptNo === 'A-000001')).toMatchObject({ status: 'ok', total: 70 })
  expect(pushed).toHaveLength(1)
  for (const key of ['manual_promotion_ids', 'manual_promotion_reason', 'exhaustedPromotions']) expect(Object.keys(pushed[0]!)).not.toContain(key)
})

test('promo rules 5b: a dayo with promotion rules but no manual order fields hides the chips of its manual promotions', async ({ page, request }) => {
  await startShop(page, request, { promoRules: { versions: [1, 2], manualFields: false }, promotions: [manual5()] })
  await addItem(page, 'Thai Tea', { size: '16 oz' })
  await expect(page.getByTestId('cart-total')).toHaveText('฿35.00')
  await expect(page.getByTestId('manual-promos')).toHaveCount(0)
  await expect(page.getByTestId(`manual-promo-${MANUAL_5}`)).toHaveCount(0)
  await payCashExact(page)
  await expect.poll(async () => (await mockState(request)).orders.find((o) => o.receiptNo === 'A-000001')).toMatchObject({ status: 'ok', total: 35 })
})

test('promo rules 6: a dayo with a newer promotion rule release than this app shows the warning bar and still sells', async ({ page, request }) => {
  await startShop(page, request, { promoRules: { versions: [1, 2, 3], manualFields: true }, promotions: [autoTea20()] })
  await expect(page.getByTestId('banner-rule-behind')).toHaveText('ระบบกลางมีโปรรุ่นใหม่กว่าแอปนี้')
  await addItem(page, 'Thai Tea', { size: '20 oz' })
  await expect(page.getByTestId('cart-total')).toHaveText('฿36.00')
  await payCashExact(page)
  await expect.poll(async () => (await mockState(request)).orders.find((o) => o.receiptNo === 'A-000001')).toMatchObject({ status: 'ok', total: 36 })
})

test('promo rules 7: a promotion that starts at HH:MM applies in that very minute, one that starts later does not (D130)', async ({ page, request }) => {
  // Windows are built from the real Bangkok clock (moving the page clock makes the tablet think the session ran out).
  // Matcha Latte 16 oz ฿85: "now" promotion ฿10 off from the current HH:MM (start inclusive) · "later" one ฿20 off from 5 minutes on.
  const at = (offsetMin: number): string => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() + offsetMin * 60_000))
    return `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`
  }
  const matcha = { v: 1, scope: 'cup', target: { menus: ['Matcha Latte'] } }
  const nowPromo = promo(ID(21), 'มัตฉะเริ่มนาทีนี้ ลด 10', 10, 'auto', 'item_discount', { ...matcha, reward: { type: 'amount', baht: 10 } }, { timeWindows: [{ days: [], from: at(0), to: at(120) }] })
  const laterPromo = promo(ID(22), 'มัตฉะเริ่มอีกสักครู่ ลด 20', 20, 'auto', 'item_discount', { ...matcha, reward: { type: 'amount', baht: 20 } }, { groupCode: 'stack', timeWindows: [{ days: [], from: at(5), to: at(120) }] })
  await startShop(page, request, { promoRules: RULES_ON, promotions: [nowPromo, laterPromo] })

  await addItem(page, 'Matcha Latte', { size: '16 oz' })
  await expect(page.getByTestId('cart-total')).toHaveText('฿75.00') // ฿85 − ฿10; the later one is not on yet
  await expect(page.getByTestId(`promo-${ID(21)}`)).toContainText('มัตฉะเริ่มนาทีนี้ ลด 10')
  await expect(page.getByTestId(`promo-${ID(22)}`)).toHaveCount(0)
})

test('promo rules 8: a promotion dayo counts as used up — the bill is still sold and the price gap shows, never lost', async ({ page, request }) => {
  await startShop(page, request, { promoRules: RULES_ON, promotions: [autoTea20()] })
  await ctl(request, 'exhaust', { id: AUTO_20OZ, scope: 'total' }) // dayo's own count; the tablet never counts (ADR-0072 rule 2)
  await addItem(page, 'Thai Tea', { size: '20 oz' })
  await expect(page.getByTestId('cart-total')).toHaveText('฿36.00') // the tablet still shows the promotion, with its limit badge
  await expect(page.getByTestId(`promo-limit-${AUTO_20OZ}`)).toBeVisible()
  await payCashExact(page)

  // dayo accepts the bill, prices it without the used-up promotion (฿45) and flags the gap
  await expect.poll(async () => (await mockState(request)).orders.find((o) => o.receiptNo === 'A-000001')).toMatchObject({ status: 'ok', total: 36 })
  await page.getByTestId('done-new-sale').click()
  // the local write that follows dayo's accept lands a moment after the mock's own state (see block2-central-orders)
  await page.waitForTimeout(3_000)
  await page.getByTestId('nav-orders').click()
  await page.getByTestId('order-row-A-000001').click()
  await expect(page.getByTestId('order-diff')).toContainText('ระบบกลางคิด ฿45.00', { timeout: 30_000 })
})
