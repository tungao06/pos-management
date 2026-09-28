import { expect, test } from '@playwright/test'
import { addItem, enterPin, firstRun, mockState, OWNER } from './helpers'

test('block2: a bill sold and voided while offline reaches dayo cancelled — the order row is sent before its order_void', async ({ page, context, request }) => {
  await firstRun(page, request)
  await context.setOffline(true)

  await addItem(page, 'Pink Milk')
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000001')
  await page.getByTestId('done-new-sale').click()
  await expect(page).toHaveURL(/\/sell$/)

  await page.getByTestId('nav-orders').click()
  await page.getByTestId('order-row-A-000001').click()
  await page.getByTestId('order-void').click()
  await page.getByTestId('void-reason-preset-0').click()
  await page.getByTestId('void-made-no').click()
  await page.getByTestId(`void-approver-${OWNER.name}`).click()
  await enterPin(page, OWNER.pin)
  await expect(page.getByTestId('order-status')).toHaveAttribute('data-status', 'voided')

  await context.setOffline(false)

  await expect.poll(async () => (await mockState(request)).orders[0]?.status).toBe('cancelled')

  const { requests } = await mockState(request)
  const pushes = requests.filter((r) => r.path === '/api/v1/pos/push' && r.status === 200)
  const combined = pushes.some((r) => r.rows >= 2)
  const sequential = pushes.length >= 2
  expect(combined || sequential, `expected one push with rows>=2 or several pushes, got ${JSON.stringify(pushes)}`).toBe(true)
})
