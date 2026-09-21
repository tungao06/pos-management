import { expect, test } from '@playwright/test'
import { firstRun } from './helpers'

test('receive goods paid from the drawer → stock and X report; a price jump and an over-drawer payment each need a confirm (spec §5 · D19 · D47-3 · Q4-6)', async ({ page }) => {
  await firstRun(page) // float ฿500
  await page.getByTestId('nav-stock').click()
  await expect(page.getByTestId('stock-row-RM-TEA-01')).toHaveAttribute('data-status', 'out')

  await page.getByTestId('nav-receive').click()
  await page.getByTestId('receive-supplier').fill('แม็คโคร')
  await page.getByTestId('receive-item').selectOption('RM-TEA-01') // default unit ถุง (400 g)
  await page.getByTestId('receive-qty').fill('2')
  await page.getByTestId('receive-total').fill('154')
  await page.getByTestId('receive-add').click()
  await page.getByTestId('receive-item').selectOption('RM-MLK-02')
  await page.getByTestId('receive-qty').fill('1')
  await page.getByTestId('receive-total').fill('30')
  await page.getByTestId('receive-add').click()
  await expect(page.getByTestId('receive-sum')).toHaveText('฿184')
  await expect(page.getByTestId('receive-jump-0')).toHaveCount(0) // ฿77 a bag = the standard cost
  await page.getByTestId('receive-paid-drawer').check()
  await page.getByTestId('receive-save').click()
  await expect(page.getByTestId('receive-done')).toBeVisible()

  // +10.4% on the next bag: flagged on the line, refused once, then confirmed
  await page.getByTestId('receive-item').selectOption('RM-TEA-01')
  await page.getByTestId('receive-qty').fill('1')
  await page.getByTestId('receive-total').fill('85')
  await page.getByTestId('receive-add').click()
  await expect(page.getByTestId('receive-jump-0')).toBeVisible()
  await page.getByTestId('receive-save').click()
  await expect(page.getByTestId('receive-price-jump')).toBeVisible()
  await page.getByTestId('receive-confirm-price').click()
  await expect(page.getByTestId('receive-done')).toBeVisible()

  await page.getByTestId('nav-stock').click()
  await expect(page.getByTestId('stock-onhand-RM-TEA-01')).toContainText('1,200 g')
  await expect(page.getByTestId('stock-row-RM-TEA-01')).toHaveAttribute('data-status', 'ok')
  await expect(page.getByTestId('stock-onhand-RM-MLK-02')).toContainText('405 ml')

  // more than the drawer should hold (฿500 − ฿184 = ฿316): the Q3b-14 confirm of a manual paid-out, no figure shown (review I-3)
  await page.getByTestId('nav-receive').click()
  await page.getByTestId('receive-item').selectOption('RM-TEA-01')
  await page.getByTestId('receive-qty').fill('4')
  await page.getByTestId('receive-total').fill('340') // ฿85 a bag = the last price: no price jump (Q4-15)
  await page.getByTestId('receive-add').click()
  await page.getByTestId('receive-paid-drawer').check()
  await page.getByTestId('receive-save').click()
  await expect(page.getByTestId('receive-over-drawer-warning')).toBeVisible()
  await expect(page.getByTestId('receive-done')).toHaveCount(0)
  await page.getByTestId('receive-over-drawer-confirm').click()
  await expect(page.getByTestId('receive-done')).toBeVisible()

  await page.getByTestId('nav-stock').click()
  await page.getByTestId('nav-sell').click()
  await page.getByTestId('nav-shift').click()
  await expect(page.getByTestId('x-paid-out')).toHaveText('−฿524') // the ฿85 receipt was not paid from the drawer
})
