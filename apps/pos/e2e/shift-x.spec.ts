import { expect, test, type Page } from '@playwright/test'
import { addItem, firstRun } from './helpers'

async function sellCash(page: Page, productCode: string): Promise<void> {
  await addItem(page, productCode)
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  await page.getByTestId('done-new-sale').click()
  await expect(page).toHaveURL(/\/sell$/)
}

test('paid-out from the sell screen → X report live, without the expected cash (spec §4.8 · Q3b-3/9 · D52)', async ({ page }) => {
  await firstRun(page) // float ฿500
  await sellCash(page, 'Original') // ฿45
  await sellCash(page, 'Original') // ฿45

  // paid-out ฿20 for ice — anyone signed in, with a reason (Q3b-9)
  await page.getByTestId('cash-move-open').click()
  await page.getByTestId('cash-kind-PAID_OUT').click()
  await page.getByTestId('cash-amount').fill('20')
  await page.getByTestId('cash-save').click()
  await expect(page.getByRole('alert')).toBeVisible() // no reason yet → refused on screen
  await page.getByTestId('cash-reason').fill('ซื้อน้ำแข็ง')
  await page.getByTestId('cash-save').click()
  await expect(page.getByTestId('cash-save')).toHaveCount(0)

  await page.getByTestId('nav-shift').click()
  await expect(page.getByTestId('x-net')).toHaveText('฿90')
  await expect(page.getByTestId('x-opening')).toHaveText('฿500')
  await expect(page.getByTestId('x-drawer-cash-sales')).toHaveText('+฿90')
  await expect(page.getByTestId('x-paid-out')).toHaveText('−฿20')
  await expect(page.getByTestId('x-qr-net')).toHaveText('฿0')
  // blind count (review I-2): the X report never shows the expected cash, and closing is not reached from here
  await expect(page.getByTestId('x-expected')).toHaveCount(0)
  await expect(page.getByTestId('x-expected-hidden')).toBeVisible()
  await expect(page.getByTestId('close-shift-open')).toHaveCount(0)
  await page.getByTestId('nav-sell').click()
  await expect(page).toHaveURL(/\/sell$/)
})
