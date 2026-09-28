import { expect, test } from '@playwright/test'
import { firstRun, mock, mockState, sellOne } from './helpers'

test('block2: the owner cancelling a bill on the dayo web shows read-only on the tablet — no local void, amount unchanged (O1 pending)', async ({ page, request }) => {
  await firstRun(page, request)
  const receipt = await sellOne(page, 'Pink Milk', 'cash')
  expect(receipt).toBe('A-000001')
  await expect.poll(async () => (await mockState(request)).orders.map((o) => o.receiptNo)).toContain('A-000001')

  await mock(request, 'edit-pos-order', { kind: 'cancel', reason: 'ลูกค้ายกเลิก' })

  await page.getByTestId('nav-orders').click()
  // the list page's own dayo_edit refresh (useDayoEditsRefresh, E3) is what actually learns about the cancel —
  // wait for its chip on the row before opening the bill, rather than racing a fetch that started on mount.
  await expect(page.getByTestId('order-dayo-edit-chip')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('order-row-A-000001').click()
  // the detail page's own query can still land a moment before the same write the list row just proved happened —
  // re-open until it catches up (`.count()`, never `.textContent()`, so a missing element never blocks an attempt).
  await expect
    .poll(async () => {
      if ((await page.getByTestId('order-dayo-edit').count()) === 0) {
        await page.getByTestId('nav-orders-back').click()
        await page.getByTestId('order-row-A-000001').click()
      }
      return (await page.getByTestId('order-dayo-edit').count()) > 0 ? page.getByTestId('order-dayo-edit').textContent() : null
    })
    .toContain('เจ้าของยกเลิกบิลนี้บนเว็บ')
  await expect(page.getByTestId('order-dayo-edit')).toContainText('เหตุผล: ลูกค้ายกเลิก')
  await expect(page.getByTestId('order-void')).toHaveCount(0) // dayo already cancelled it — no local void offered
  await expect(page.getByTestId('order-status')).toHaveAttribute('data-status', 'paid') // O1 pending: the local total/status stay frozen
  await expect(page.getByTestId('event-3')).toContainText('PAID') // still just CREATED/LINE_ADDED/PAID — no local VOIDED event
})
