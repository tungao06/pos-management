import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { TH } from '../src/ui/th'
import { addItem, enterPin, firstRun, OWNER } from './helpers'

async function sellCash(page: Page, productCode: string): Promise<void> {
  await addItem(page, productCode)
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  await page.getByTestId('done-new-sale').click()
  await expect(page).toHaveURL(/\/sell$/)
}

async function sellQr(page: Page, productCode: string): Promise<void> {
  await addItem(page, productCode)
  await page.getByTestId('pay-qr').click()
  await page.getByTestId('qr-received').click()
  await page.getByTestId('done-new-sale').click()
  await expect(page).toHaveURL(/\/sell$/)
}

test('blind count from the sell screen → variance reason → owner PIN → Z with QR vs bank → backup confirmed → next shift (spec §4.8, §11)', async ({ page }) => {
  await firstRun(page) // float ฿500
  await sellCash(page, 'Original') // ฿45
  await sellCash(page, 'Original') // ฿45
  await sellQr(page, 'Latte') // ฿50 PromptPay
  await page.getByTestId('cash-move-open').click() // paid-out ฿20 (Q3b-9)
  await page.getByTestId('cash-kind-PAID_OUT').click()
  await page.getByTestId('cash-amount').fill('20')
  await page.getByTestId('cash-reason').fill('ซื้อน้ำแข็ง')
  await page.getByTestId('cash-save').click()
  await expect(page.getByTestId('cash-save')).toHaveCount(0)

  // close from the sell screen: count first, the expected cash appears only after "นับเสร็จ" (Q3b-3 · D52)
  await page.getByTestId('close-shift-open').click()
  await expect(page.getByTestId('count-50000')).toBeVisible()
  await expect(page.getByTestId('close-expected')).toHaveCount(0)
  await page.getByTestId('count-50000').fill('1') // ฿500
  await page.getByTestId('count-2000').fill('2') // ฿40 → ฿540 counted
  await expect(page.getByTestId('close-counted')).toHaveText('฿540')
  await page.getByTestId('count-done').click()
  await expect(page.getByTestId('close-expected')).toHaveText('฿570') // 500 + 90 − 20
  await expect(page.getByTestId('close-variance')).toHaveText('-฿30')
  await expect(page.getByTestId('close-qr-net')).toHaveText('฿50') // Q3b-12
  await page.getByTestId('close-bank-qr').fill('50')
  await expect(page.getByTestId('neg-base-PB-TEA-THAI')).toBeVisible() // D28

  await enterPin(page, OWNER.pin) // no reason yet → refused on screen, nothing sent
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByTestId('close-reason').fill('ทอนเงินผิด')
  await enterPin(page, OWNER.pin)

  await expect(page).toHaveURL(/\/z\//)
  await expect(page.getByTestId('z-hash')).toHaveAttribute('data-ok', 'true')
  await expect(page.getByTestId('z-chain-warning')).toHaveCount(0)
  await expect(page.getByTestId('z-net')).toHaveText('฿140')
  await expect(page.getByTestId('z-qr-net')).toHaveText('฿50')
  await expect(page.getByTestId('z-bank-qr')).toHaveText('฿50')
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

test('quick open (spec §4.8 · Q3b-10): an owner opens with a 0 float and the X report marks it', async ({ page }) => {
  await firstRun(page)
  // the close screen can always be left again, without closing anything
  await page.getByTestId('close-shift-open').click()
  await expect(page.getByTestId('count-50000')).toBeVisible()
  await page.getByTestId('nav-sell').click()
  await expect(page).toHaveURL(/\/sell$/)

  // close the first shift with an exact count so we reach the open-shift screen again
  await page.getByTestId('close-shift-open').click()
  await page.getByTestId('count-50000').fill('1')
  await page.getByTestId('count-done').click()
  await enterPin(page, OWNER.pin)
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
