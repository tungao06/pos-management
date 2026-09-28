import { expect, test } from '@playwright/test'
import { firstRun, mock, mockState, sellOne } from './helpers'

test('block2: a bill sold minutes after a bot bill of the same total flags itself as a possible duplicate', async ({ page, request }) => {
  await firstRun(page, request)
  const soldAt = new Date(Date.now() - 2 * 60_000).toISOString()
  // sale_date must be the THAI calendar date the order itself uses (bangkokDateOf), never a plain UTC slice —
  // near midnight Bangkok time those two dates differ.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  await mock(request, 'seed-orders', [
    {
      order_no: 'L260101-001', sale_date: today, status: 'ok', source: 'line', external_ref: null, version: 1,
      channel: null, payment: null, totals: { items_subtotal: 45, items_discount: 0, bill_discount: 0, total: 45 },
      amount_mismatch: null, updated_at: null, sold_at: soldAt, created_by_name: 'บอท LINE',
    },
  ])

  const receipt = await sellOne(page, 'Cocoa', 'cash') // 16 oz / 100% preselected — ฿45, same total as the seeded bot bill
  expect(receipt).toBe('A-000001')

  await expect.poll(async () => (await mockState(request)).orders.map((o) => o.receiptNo)).toContain('A-000001')
  // the local write that follows dayo's accept (centralDuplicateOfJson) lands a moment after the mock's own state
  // does, and neither this page nor the order detail one refetches on their own — a plain settle wait here, not a
  // repeat visit to /orders, since re-mounting it repeatedly costs E3 budget (E3_CALLS_PER_MIN = 3, pos-api.ts) that
  // this test also needs for /central-orders below.
  await page.waitForTimeout(3_000)

  await page.getByTestId('nav-orders').click() // E3 call 1/3 (useDayoEditsRefresh, unrelated to this check but unavoidable on this screen)
  await page.getByTestId('order-row-A-000001').click()
  await expect(page.getByTestId('order-dup')).toContainText('อาจซ้ำกับบิลบอท L', { timeout: 10_000 })

  await page.getByTestId('nav-orders-back').click() // E3 call 2/3
  await page.getByTestId('nav-central-orders').click() // E3 call 3/3 (listCentralOrdersToday)
  await expect(page).toHaveURL(/\/central-orders$/)
  await expect(page.getByTestId('central-order-L260101-001')).toContainText('บอท ·', { timeout: 10_000 })
})
