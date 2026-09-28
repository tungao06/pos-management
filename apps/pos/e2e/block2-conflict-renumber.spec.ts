import { expect, test } from '@playwright/test'
import { enterPin, firstRun, mock, mockState, OWNER, sellOne } from './helpers'

test('block2: a receipt conflict on A-000001 is fixed with a new receipt number, approved by the owner', async ({ page, request }) => {
  await firstRun(page, request)
  await mock(request, 'override', {
    match: { receiptNo: 'A-000001' },
    verdict: { status: 'rejected', reason: 'CONFLICT', detail: 'เลขใบเสร็จ A-000001 ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว' },
    times: 1,
  })

  const receipt = await sellOne(page, 'Pink Milk', 'cash')
  expect(receipt).toBe('A-000001')

  await expect(page.getByTestId('banner-problems')).toContainText('ส่งไม่ผ่าน 1 บิล', { timeout: 35_000 })
  await page.getByTestId('banner-problems').click()
  await expect(page).toHaveURL(/\/sync-problems$/)
  await expect(page.getByTestId('problem-A-000001')).toBeVisible()
  await page.getByTestId('remedy-renumber').click()
  await page.getByTestId(`approval-owner-${OWNER.name}`).click()
  await page.getByTestId('approval-reason').fill('เลขใบเสร็จชนกับบิลอื่น')
  await page.getByTestId('approval-pin').fill(OWNER.pin)
  await page.getByTestId('approval-ok').click()
  await expect(page.getByTestId('problem-A-000001')).toHaveCount(0)

  await expect.poll(async () => (await mockState(request)).orders.map((o) => o.receiptNo)).toContain('A-000002')

  await page.getByTestId('nav-status-back').click()
  await expect(page).toHaveURL(/\/status$/)
  await page.getByTestId('status-back').click()
  await expect(page).toHaveURL(/\/sell$/)
  await page.getByTestId('nav-orders').click()
  await page.getByTestId('order-row-A-000002').click()
  await expect(page.getByTestId('central-state')).toContainText('ระบบกลาง L')
})
