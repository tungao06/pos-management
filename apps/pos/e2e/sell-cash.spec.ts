import { expect, test } from '@playwright/test'
import { addItem, firstRun } from './helpers'

test('cash sale: defaults, discount, quick tender, change, queue and receipt; next sale continues; done screen auto-closes', async ({ page }) => {
  await firstRun(page)
  await expect(page.getByTestId('pending-sync')).toContainText(' 1 ') // the open shift counts as one item (D50 Q3-26)

  await addItem(page, 'Original') // 16 oz / 50% preselected
  await addItem(page, 'Latte', { size: '22oz', sweet: 'S100' })
  await expect(page.getByTestId('cart-line-0')).toContainText('16 oz')
  await expect(page.getByTestId('cart-line-0')).toContainText('50%')
  await expect(page.getByTestId('cart-total')).toHaveText('฿105')

  await page.getByTestId('discount-open').click()
  await page.getByTestId('discount-amount').fill('5')
  await page.getByTestId('discount-reason').fill('ลูกค้าประจำ')
  await page.getByTestId('discount-apply').click()
  await expect(page.getByTestId('cart-total')).toHaveText('฿100')

  await page.getByTestId('pay-cash').click()
  await expect(page.getByTestId('cash-total')).toHaveText('฿100')
  await expect(page.getByTestId('confirm-cash')).toBeDisabled()
  await page.getByTestId('tender-500').click()
  await expect(page.getByTestId('cash-change')).toHaveText('฿400')
  await page.getByTestId('confirm-cash').click()

  await expect(page.getByTestId('done-queue')).toHaveText('1')
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000001')
  await expect(page.getByTestId('done-change')).toHaveText('฿400')
  await expect(page.getByTestId('done-line-1')).toContainText('22 oz')
  await page.getByTestId('done-new-sale').click()

  await expect(page).toHaveURL(/\/sell$/)
  await expect(page.getByTestId('pay-cash')).toBeDisabled() // cart cleared
  await expect(page.getByTestId('pending-sync')).toContainText(' 2 ') // the open shift + one bill — bills, not outbox rows (D50 Q3-26)

  await addItem(page, 'Original')
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await expect(page.getByTestId('cash-change')).toHaveText('฿0')
  await page.getByTestId('confirm-cash').click()
  await expect(page.getByTestId('done-queue')).toHaveText('2')
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000002')
  await expect(page).toHaveURL(/\/sell$/, { timeout: 10_000 }) // spec §5: closes by itself after 5 s
})
