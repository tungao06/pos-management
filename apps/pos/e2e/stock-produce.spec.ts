import { expect, test } from '@playwright/test'
import { addItem, firstRun } from './helpers'

test('a sale before brewing makes the base negative → half a batch → throw the leftover out (spec §4.4, §4.6 · D17 · D28)', async ({ page }) => {
  await firstRun(page)
  await addItem(page, 'Original')
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  await page.getByTestId('done-new-sale').click()

  await page.getByTestId('nav-stock').click()
  await expect(page.getByTestId('stock-row-PB-TEA-THAI')).toHaveAttribute('data-status', 'negative')
  await expect(page.getByTestId('stock-onhand-PB-TEA-THAI')).toContainText('-130 ml')

  await page.getByTestId('nav-produce').click()
  await page.getByTestId('produce-base-PB-TEA-THAI').click()
  await expect(page.getByTestId('produce-component-RM-TEA-02')).toContainText('180 g')
  await page.getByTestId('produce-scale-5000').click()
  await expect(page.getByTestId('produce-component-RM-TEA-02')).toContainText('90 g')
  await expect(page.getByTestId('produce-yield')).toHaveValue('1500')
  await page.getByTestId('produce-save').click()
  await expect(page.getByTestId('produce-done')).toBeVisible()

  await page.getByTestId('nav-stock').click()
  await expect(page.getByTestId('stock-onhand-PB-TEA-THAI')).toContainText('1,370 ml')
  await expect(page.getByTestId('stock-row-PB-TEA-THAI')).toHaveAttribute('data-status', 'ok')
  await expect(page.getByTestId('stock-expiry-PB-TEA-THAI')).toBeVisible() // 72 h shelf life
  await page.getByTestId('base-discard-PB-TEA-THAI').click()
  await page.getByTestId('base-discard-confirm').click()
  await expect(page.getByTestId('stock-onhand-PB-TEA-THAI')).toContainText('0 ml')
  await expect(page.getByTestId('base-discard-PB-TEA-THAI')).toHaveCount(0)
})
