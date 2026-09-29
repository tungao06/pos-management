import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { TH } from '../src/ui/th'
import { enterPin, fillCount, firstRun, mock, OWNER } from './helpers'

async function sellCash(page: Page, productCode: string): Promise<void> {
  await page.getByTestId(`menu-${productCode}`).click()
  await page.getByTestId('item-add').click()
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  await page.getByTestId('done-new-sale').click()
  await expect(page).toHaveURL(/\/sell$/)
}

async function sellQr(page: Page, productCode: string): Promise<void> {
  await page.getByTestId(`menu-${productCode}`).click()
  await page.getByTestId('item-add').click()
  await page.getByTestId('pay-qr').click()
  await page.getByTestId('qr-received').click()
  await page.getByTestId('done-new-sale').click()
  await expect(page).toHaveURL(/\/sell$/)
}

test('blind count from the sell screen → variance reason → owner PIN → Z with QR vs bank → backup confirmed → next shift (spec §4.8, §11 · Task 15 D101/D102)', async ({ page, request }) => {
  await firstRun(page, request) // float ฿500
  // D101: `finishCount` → `countSummary` → (central + online) `fetchBotCash` before the review — E4 only answers on
  // a block-3 mock (packages/dayo-mock/src/handler.ts), so this device is linked to one from here on.
  await mock(request, 'block3', { on: true })
  await sellCash(page, 'Cocoa') // 16 oz / 100% preselected — ฿45
  await sellCash(page, 'Cocoa') // ฿45
  await sellQr(page, 'Pink Milk') // ฿65 PromptPay
  await page.getByTestId('cash-move-open').click() // paid-out ฿20 (Q3b-9)
  await page.getByTestId('cash-kind-PAID_OUT').click()
  await page.getByTestId('cash-amount').fill('20')
  await page.getByTestId('cash-reason').fill('ซื้อน้ำแข็ง')
  await page.getByTestId('cash-save').click()
  await expect(page.getByTestId('cash-save')).toHaveCount(0)

  // close from the sell screen: count first, the expected cash appears only after "นับเสร็จ" (Q3b-3 · D52)
  await page.getByTestId('close-shift-open').click()
  await expect(page.getByTestId('count-input-500')).toBeVisible()
  await expect(page.getByTestId('count-expected')).toHaveCount(0)
  await fillCount(page, 540) // ฿500×1 + ฿20×2 = ฿540
  await expect(page.getByTestId('count-total')).toHaveText('฿540')
  // review m-3: the blind count (Q3b-3 · D52) must hide the expected cash figure everywhere on the page before
  // "นับเสร็จ" — not merely from the dedicated `count-expected` test id (M9b: rendering it in some other element
  // would still pass a check scoped to that id alone).
  await expect(page.locator('body')).not.toContainText('฿570')
  await page.getByTestId('count-finish').click()
  await expect(page.getByTestId('count-expected')).toHaveText('฿570.00') // 500 + 90 − 20
  await expect(page.getByTestId('count-variance')).toHaveText('-฿30.00')
  await expect(page.getByTestId('count-qr-net')).toHaveText('฿65') // Q3b-12
  await page.getByTestId('count-bank-qr').fill('65')
  await page.getByTestId(`count-approver-${OWNER.name}`).click()

  // D102: a shortage past the alert threshold disables "ยืนยันและออกใบปิดกะ" until a reason is typed — never a
  // submit-time refusal (the PIN pad's own `extraDisabled`, PinPad.tsx) — a PIN typed first still refuses to submit.
  for (const digit of OWNER.pin) await page.getByTestId(`pin-${digit}`).click()
  await expect(page.getByTestId('count-confirm')).toBeDisabled()
  await page.getByTestId('count-reason').fill('ทอนเงินผิด')
  await expect(page.getByTestId('count-confirm')).toBeEnabled()
  await page.getByTestId('count-confirm').click()

  await expect(page).toHaveURL(/\/z\//)
  await expect(page.getByTestId('z-hash')).toHaveAttribute('data-ok', 'true')
  await expect(page.getByTestId('z-chain-warning')).toHaveCount(0)
  await expect(page.getByTestId('z-net')).toHaveText('฿155') // 90 (cash) + 65 (QR) — sales net, before the paid-out
  await expect(page.getByTestId('z-qr-net')).toHaveText('฿65')
  await expect(page.getByTestId('z-bank-qr')).toHaveText('฿65')
  await expect(page.getByTestId('z-qr-diff')).toHaveText('฿0')
  await expect(page.getByTestId('z-expected')).toHaveText('฿570')
  await expect(page.getByTestId('z-counted')).toHaveText('฿540')
  await expect(page.getByTestId('z-variance')).toHaveText('-฿30')
  await expect(page.getByTestId('z-reason')).toHaveText('ทอนเงินผิด')
  await expect(page.getByTestId('backup-due')).toBeVisible()

  // backup: the whole SQLite file lands in Downloads (Q3b-6) and counts only once the owner confirms it (Q3b-7 · I-4)
  await page.getByTestId('nav-backup').click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('backup-download').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^dayo-pos-A-\d{8}-\d{6}\.sqlite3$/)
  const bytes = readFileSync(await download.path())
  expect(bytes.subarray(0, 16).toString('latin1')).toBe('SQLite format 3\u0000')
  await expect(page.getByTestId('backup-file')).toContainText(download.suggestedFilename())
  await expect(page.getByTestId('backup-done')).toHaveCount(0)
  await page.getByTestId('backup-confirm').click()
  await expect(page.getByTestId('backup-done')).toBeVisible()

  // next day: the sell screen needs a new shift; the banner is gone; the past Z is listed
  await page.getByTestId('nav-home').click()
  await expect(page).toHaveURL(/\/shift\/open$/)
  await expect(page.getByTestId('backup-due')).toHaveCount(0)
  await page.getByTestId('nav-z-list').click()
  await expect(page.getByTestId('z-row-0')).toBeVisible()
  await expect(page.getByTestId('z-warn-0')).toHaveCount(0)
})

test('quick open (spec §4.8 · Q3b-10): an owner opens with a 0 float and the X report marks it', async ({ page, request }) => {
  await firstRun(page, request)
  await mock(request, 'block3', { on: true })
  // the close screen can always be left again, without closing anything
  await page.getByTestId('close-shift-open').click()
  await expect(page.getByTestId('count-input-500')).toBeVisible()
  await page.getByTestId('nav-sell').click()
  await expect(page).toHaveURL(/\/sell$/)

  // close the first shift with an exact count so we reach the open-shift screen again
  await page.getByTestId('close-shift-open').click()
  await fillCount(page, 500)
  await page.getByTestId('count-finish').click()
  await expect(page.getByTestId('count-expected')).toBeVisible()
  await page.getByTestId(`count-approver-${OWNER.name}`).click()
  await enterPin(page, OWNER.pin, 'count-confirm')
  await expect(page).toHaveURL(/\/z\//)
  // the bank-app PromptPay total is optional: left empty, no figure and no difference are invented (Q3b-12 · D53)
  await expect(page.getByTestId('z-bank-qr')).toHaveText(TH.bankQrNotEntered)
  await expect(page.getByTestId('z-qr-diff')).toHaveText('—')
  await page.getByTestId('z-done').click()

  await page.getByTestId('shift-quick-open').click()
  await expect(page).toHaveURL(/\/sell$/)
  await page.getByTestId('nav-shift').click()
  await expect(page.getByTestId('x-quick')).toBeVisible()
  await expect(page.getByTestId('x-opening')).toHaveText('฿0')
})
