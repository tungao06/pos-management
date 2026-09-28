import { expect, test } from '@playwright/test'
import { addItem, firstRun } from './helpers'

test('cash sale: defaults, discount, quick tender, change, queue and receipt; next sale continues; done screen auto-closes', async ({ page, request }) => {
  await firstRun(page, request)
  // block 2: shift/cash rows are local_only and never counted here (spec 04 §6.1) — only bills (order/order_void), and none yet.
  await expect(page.getByTestId('pending-sync')).toContainText(' 0 ')

  await addItem(page, 'Pink Milk') // 16 oz / 100% preselected — ฿65
  await addItem(page, 'Cocoa', { size: '20 oz', sweet: '100%' }) // ฿55
  await expect(page.getByTestId('cart-line-0')).toContainText('16 oz')
  await expect(page.getByTestId('cart-line-0')).toContainText('100%')
  await expect(page.getByTestId('cart-total')).toHaveText('฿120.00')

  await page.getByTestId('discount-open').click()
  await page.getByTestId('discount-amount').fill('5')
  await page.getByTestId('discount-reason').fill('ลูกค้าประจำ')
  await page.getByTestId('discount-apply').click()
  await expect(page.getByTestId('cart-total')).toHaveText('฿115.00')

  await page.getByTestId('pay-cash').click()
  await expect(page.getByTestId('cash-total')).toHaveText('฿115.00')
  await expect(page.getByTestId('confirm-cash')).toBeDisabled()
  await page.getByTestId('tender-500').click()
  await expect(page.getByTestId('cash-change')).toHaveText('฿385.00')
  await page.getByTestId('confirm-cash').click()

  await expect(page.getByTestId('done-queue')).toHaveText('คิว 1')
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000001')
  await expect(page.getByTestId('done-change')).toHaveText('฿385')
  await expect(page.getByTestId('done-line-1')).toContainText('20 oz')
  await page.getByTestId('done-new-sale').click()

  await expect(page).toHaveURL(/\/sell$/)
  await expect(page.getByTestId('pay-cash')).toBeDisabled() // cart cleared
  await expect(page.getByTestId('pending-sync')).toContainText(' 1 ') // one bill pending — the open shift never counts here (block 2, spec §6.1)

  await addItem(page, 'Pink Milk')
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await expect(page.getByTestId('cash-change')).toHaveText('฿0.00')
  await page.getByTestId('confirm-cash').click()
  await expect(page.getByTestId('done-queue')).toHaveText('คิว 2')
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000002')
  await expect(page).toHaveURL(/\/sell$/, { timeout: 10_000 }) // spec §5: closes by itself after 5 s
})
