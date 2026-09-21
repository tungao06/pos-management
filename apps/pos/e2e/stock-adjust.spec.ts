import { expect, test } from '@playwright/test'
import { firstRun } from './helpers'

test('a free drink by recipe and spilled milk by item, each with a reason — no bill (spec §5 · D50 Q3-20 · Q4-8)', async ({ page }) => {
  await firstRun(page)
  await page.getByTestId('nav-stock').click()
  await page.getByTestId('nav-adjust').click()

  await page.getByTestId('adjust-save').click()
  await expect(page.getByRole('alert')).toBeVisible() // no reason code yet
  await page.getByTestId('adjust-reason-GIVEAWAY').click()
  await page.getByTestId('adjust-mode-drinks').click()
  await page.getByTestId('adjust-product').selectOption('Original') // 16 oz · 50% preselected
  await page.getByTestId('adjust-add-drink').click()
  await expect(page.getByTestId('adjust-line-drink-0')).toBeVisible()
  await page.getByTestId('adjust-reason').fill('ชดเชยลูกค้า แก้วหก')
  await page.getByTestId('adjust-save').click()
  await expect(page.getByTestId('adjust-done')).toBeVisible()

  await page.getByTestId('adjust-reason-WASTE').click()
  await page.getByTestId('adjust-mode-items').click()
  await page.getByTestId('adjust-item').selectOption('RM-MLK-01') // the use unit (ml) is preselected
  await page.getByTestId('adjust-qty').fill('200')
  await page.getByTestId('adjust-add-item').click()
  await page.getByTestId('adjust-reason').fill('นมหก')
  await page.getByTestId('adjust-save').click()
  await expect(page.getByTestId('adjust-done')).toBeVisible()

  await page.getByTestId('nav-stock').click()
  await expect(page.getByTestId('stock-onhand-PB-TEA-THAI')).toContainText('-130 ml')
  await expect(page.getByTestId('stock-onhand-RM-MLK-01')).toContainText('-200 ml')
  await page.getByTestId('nav-sell').click()
  await page.getByTestId('nav-orders').click()
  await expect(page.locator('[data-testid^="order-row-"]')).toHaveCount(0) // a giveaway is not a sale
})
