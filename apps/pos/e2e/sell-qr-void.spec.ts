import { expect, test, type Page } from '@playwright/test'
import { addItem, enterPin, firstRun, OTHER } from './helpers'

async function openOrder(page: Page, receiptNo: string): Promise<void> {
  // Stay in the SPA: a full reload would drop the in-memory session and ask for the PIN again.
  // M20: DoneScreen auto-closes after 5s, which can race this click — only click if it is still visible.
  if (await page.getByTestId('done-new-sale').isVisible()) await page.getByTestId('done-new-sale').click()
  await expect(page).toHaveURL(/\/sell$/)
  await page.getByTestId('nav-orders').click()
  await page.getByTestId(`order-row-${receiptNo}`).click()
  await expect(page.getByTestId('order-status')).toHaveAttribute('data-status', 'paid')
}

test('PromptPay sale shows a QR with the amount; void it with a refund reference and the other owner PIN', async ({ page }) => {
  await firstRun(page)
  await addItem(page, 'Original')
  await page.getByTestId('pay-qr').click()
  await expect(page.getByTestId('qr-total')).toHaveText('฿45')
  const qr = page.getByTestId('qr-image')
  await expect(qr).toBeVisible()
  const payload = (await qr.getAttribute('data-payload')) ?? ''
  expect(payload.startsWith('000201010212')).toBe(true) // dynamic QR (D48 Q3-4)
  expect(payload).toContain('540545.00')
  await page.getByTestId('qr-received').click()
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000001')

  await openOrder(page, 'A-000001')
  await expect(page.getByTestId('event-3')).toContainText('PAID')
  await page.getByTestId('void-open').click()
  await expect(page.getByTestId('void-cash-refund')).toHaveCount(0)
  await page.getByTestId('void-reason-preset-0').click()
  await page.getByTestId('void-made-no').click()
  await page.getByTestId('void-approver-DCm').click()
  await enterPin(page, OTHER.pin)
  await expect(page.getByRole('alert')).toBeVisible() // refund reference missing
  await page.getByTestId('void-refund-ref').fill('KBANK-123')
  await enterPin(page, OTHER.pin)
  await expect(page.getByTestId('order-status')).toHaveAttribute('data-status', 'voided')
  await expect(page.getByTestId('void-open')).toHaveCount(0)
  await expect(page.getByTestId('event-6')).toContainText('STOCK_RETURNED')
})

test('cash sale voided after the drink was made: cash refund shown, wrong PIN refused', async ({ page }) => {
  await firstRun(page)
  await addItem(page, 'Latte')
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000001')

  await openOrder(page, 'A-000001')
  await page.getByTestId('void-open').click()
  await expect(page.getByTestId('void-cash-refund')).toContainText('฿50')
  await expect(page.getByTestId('void-refund-ref')).toHaveCount(0)
  await page.getByTestId('void-reason').fill('ลูกค้าเปลี่ยนใจหลังทำเสร็จ')
  await page.getByTestId('void-made-yes').click()
  await page.getByTestId('void-approver-DCm').click()
  await enterPin(page, '9999')
  await expect(page.getByRole('alert')).toBeVisible()
  await enterPin(page, OTHER.pin)
  await expect(page.getByTestId('order-status')).toHaveAttribute('data-status', 'voided')
  await page.getByTestId('nav-orders-back').click()
  await expect(page.getByTestId('order-row-A-000001')).toHaveAttribute('data-status', 'voided')
})
