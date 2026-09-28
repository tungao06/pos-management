import { expect, test } from '@playwright/test'
import { firstRun, mock, mockState, sellOne, syncNow } from './helpers'

test('block2: a revoked key shows "กุญแจถูกยกเลิก" (not "เน็ตหลุด") and stops every further call to dayo', async ({ page, request }) => {
  await firstRun(page, request)
  await mock(request, 'mode', { mode: 'unauthorized' })

  await sellOne(page, 'Pink Milk', 'cash') // the automatic push after this sale is what actually meets dayo's 401

  // finding (Task 21, same as block2-rejected-row): the banner only catches up on the 30 s bootstrap poll —
  // no push-completion signal invalidates it sooner. No hard time bound is given for this scenario in the brief.
  await expect(page.getByTestId('banner-key-revoked')).toBeVisible({ timeout: 35_000 })
  await page.getByTestId('banner-key-revoked-status').click()
  await expect(page).toHaveURL(/\/status$/)

  await expect.poll(async () => (await mockState(request)).requests.some((r) => r.status === 401)).toBe(true)
  const before = (await mockState(request)).requests.length

  await syncNow(page) // "ส่งตอนนี้" again — 401/403 stop everything until the owner re-links (spec §6.2)
  await page.waitForTimeout(500)
  await page.getByTestId('status-back').click()
  await expect(page).toHaveURL(/\/sell$/)
  await page.getByTestId('nav-orders').click()
  await page.getByTestId('nav-central-orders').click() // E3 too must be gated before any request — never just "offline"
  await expect(page).toHaveURL(/\/central-orders$/)
  await page.waitForTimeout(500)

  const after = (await mockState(request)).requests.length
  expect(after, 'no request of any kind (catalog/push/orders) should have been sent once the key is revoked').toBe(before)
})
