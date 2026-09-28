import { expect, test } from '@playwright/test'
import { addItem, firstRun, login, mock } from './helpers'

test('block2: a tablet clock 7 minutes ahead of dayo warns but never blocks a sale (D80)', async ({ page, request }) => {
  await firstRun(page, request)
  await mock(request, 'now', { iso: new Date(Date.now() + 7 * 60_000).toISOString() })
  await page.reload()
  await login(page)
  await expect(page).toHaveURL(/\/sell$/)

  await expect(page.getByTestId('banner-clock')).toBeVisible({ timeout: 35_000 })

  await addItem(page, 'Pink Milk')
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000001')
})
