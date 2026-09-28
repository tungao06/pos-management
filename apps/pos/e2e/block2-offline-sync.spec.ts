import { expect, test } from '@playwright/test'
import { addItem, firstRun, mockState } from './helpers'

test('block2: 5 bills sold offline queue up, then push and clear within 10 s of coming back online', async ({ page, context, request }) => {
  await firstRun(page, request)
  await context.setOffline(true)

  for (let i = 0; i < 5; i++) {
    await addItem(page, 'Pink Milk') // ฿65 cash — the sender's own backoff climbs on every failed attempt while offline
    await page.getByTestId('pay-cash').click()
    await page.getByTestId('tender-exact').click()
    await page.getByTestId('confirm-cash').click()
    await page.getByTestId('done-new-sale').click()
    await expect(page).toHaveURL(/\/sell$/)
  }
  await expect(page.getByTestId('badge-pending')).toContainText('5')

  await context.setOffline(false)
  // review item 2: the browser's `online` event forgets the offline backoff at once — the badge must clear well
  // inside 10 s, not wait for the scheduler's own 60 s timer or a stale 30 s bootstrap refetch.
  await expect(page.getByTestId('badge-pending')).toHaveCount(0, { timeout: 10_000 })

  await expect.poll(async () => (await mockState(request)).orders.length).toBe(5)
  const state = await mockState(request)
  for (const o of state.orders) expect(o.orderNo).toMatch(/^L/)

  await page.getByTestId('nav-orders').click()
  for (let i = 1; i <= 5; i++) {
    const row = page.getByTestId(`order-row-A-00000${i}`)
    await expect(row.getByTestId('central-state')).toContainText('ระบบกลาง L')
  }
})
