import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { TH } from '../src/ui/th'
import { countAndConfirm, enterPin, fillCount, login, mock, mockState, OTHER, openShift, OWNER, setOtherPin, setupDevice, sellOne } from './helpers'

test.beforeEach(async ({ request }) => {
  await mock(request, 'reset')
  // phase 2 (implies phase 1): dayo main 12885fe leaves recompute_status null on a phase-1 mock — a spec checking
  // `recomputeStatus === 'matched'` must turn phase 2 on too (preflight P3).
  await mock(request, 'block3', { on: true, phase2: true })
})
test.afterEach(async ({ request }) => {
  await mock(request, 'reset')
})

/** Three cash bot bills (LINE), `sold_at` a couple of minutes ago — inside every window `botWindowFor` builds today
 * (00:00 Bangkok .. now), so E4 (`GET /pos/shift-cash`) always answers with them once block 3 is on. */
async function seedBotCashBills(request: APIRequestContext, bills: readonly { orderNo: string; total: number }[]): Promise<void> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const soldAt = new Date(Date.now() - 2 * 60_000).toISOString()
  await mock(
    request,
    'seed-orders',
    bills.map((b) => ({
      order_no: b.orderNo, sale_date: today, status: 'ok', source: 'line', external_ref: null, version: 1,
      channel: null, payment: 'cash', totals: { items_subtotal: b.total, items_discount: 0, bill_discount: 0, total: b.total },
      amount_mismatch: null, updated_at: null, sold_at: soldAt, created_by_name: 'บอท LINE',
    })),
  )
}

async function startShift(page: Page, floatBaht = '500'): Promise<void> {
  await setupDevice(page)
  await setOtherPin(page)
  await login(page)
  await openShift(page, floatBaht)
}

test('block3 online shift: paid-out, a void refund and 3 bot cash bills close matched with the bot lines on the Z (spec §9 ก้อน 3)', async ({ page, request }) => {
  await startShift(page, '500')

  const r1 = await sellOne(page, 'Cocoa', 'cash') // ฿45
  await sellOne(page, 'Cocoa', 'cash') // ฿45 — kept

  await page.getByTestId('cash-move-open').click() // paid-out ฿20 (Q3b-9)
  await page.getByTestId('cash-kind-PAID_OUT').click()
  await page.getByTestId('cash-amount').fill('20')
  await page.getByTestId('cash-reason').fill('ซื้อน้ำแข็ง')
  await page.getByTestId('cash-save').click()
  await expect(page.getByTestId('cash-save')).toHaveCount(0)

  // void one of the two cash bills (a cash refund) — the other stays
  await page.getByTestId('nav-orders').click()
  await page.getByTestId(`order-row-${r1}`).click()
  await page.getByTestId('order-void').click()
  await expect(page.getByTestId('void-cash-refund')).toContainText('฿45')
  await page.getByTestId('void-reason-preset-0').click()
  await page.getByTestId('void-made-no').click()
  await page.getByTestId(`void-approver-${OTHER.name}`).click()
  await enterPin(page, OTHER.pin)
  await expect(page.getByTestId('order-status')).toHaveAttribute('data-status', 'voided')
  await page.getByTestId('nav-orders-back').click()
  await page.getByTestId('nav-sell').click()
  await expect(page).toHaveURL(/\/sell$/)

  await seedBotCashBills(request, [
    { orderNo: 'L260101-701', total: 70 },
    { orderNo: 'L260101-702', total: 35 },
    { orderNo: 'L260101-703', total: 50 },
  ])

  // expected cash = 500 (float) + 45 (one Cocoa left after the void) − 20 (paid-out) + 155 (3 bot bills) = ฿680
  await page.getByTestId('close-shift-open').click()
  await fillCount(page, 680) // blind — 9 denominations, no total shown yet
  await page.getByTestId('count-finish').click()
  await expect(page.getByTestId('count-expected')).toHaveText('฿680.00')
  await expect(page.getByText(TH.countBotCash(3))).toBeVisible()
  await countAndConfirm(page, 680, { pin: OTHER.pin })

  await expect(page).toHaveURL(/\/z\//)
  await expect(page.getByTestId('z-bot-bill-L260101-701')).toContainText('฿70.00')
  await expect(page.getByTestId('z-bot-bill-L260101-702')).toContainText('฿35.00')
  await expect(page.getByTestId('z-bot-bill-L260101-703')).toContainText('฿50.00')

  // wait for the Z (and every other row of this shift) to actually reach dayo, then check dayo's own recompute verdict
  await expect.poll(async () => (await mockState(request)).zReports.at(-1)?.recomputeStatus, { timeout: 20_000 }).toBe('matched')

  // ไม่มีแถวค้าง: nothing dayo refused or flagged a conflict on
  const state = await mockState(request)
  expect(state.conflicts).toEqual([])
  expect(state.rejections).toEqual([])
})

test('D102: a shortage of exactly ฿20.00 needs a reason; ฿19.00 short does not ask', async ({ page }) => {
  await startShift(page, '500')
  // no sale — expected cash stays the ฿500 float.

  await page.getByTestId('close-shift-open').click()
  await fillCount(page, 481) // ฿19.00 short of ฿500 — below the alert threshold (varianceAlertSatang), no reason asked
  await page.getByTestId('count-finish').click()
  await expect(page.getByTestId('count-expected')).toHaveText('฿500.00')
  await expect(page.getByTestId('count-reason')).toHaveCount(0)

  // recounted on the same review (the shift is frozen now: "กลับ" to selling only bounces back here once the tablet's
  // state refreshes — and since final fix C3 the before_close wake refreshes it at once, so the spec no longer leaves)
  await fillCount(page, 480) // exactly ฿20.00 short — at the threshold, a reason is required
  await expect(page.getByTestId('count-expected')).toHaveText('฿500.00')
  await expect(page.getByTestId('count-reason')).toBeVisible()
  await page.getByTestId(`count-approver-${OWNER.name}`).click()
  for (const digit of OWNER.pin) await page.getByTestId(`pin-${digit}`).click()
  await expect(page.getByTestId('count-confirm')).toBeDisabled()
})
