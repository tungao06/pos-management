import { expect, test } from '@playwright/test'
import { enterPin, firstRun, OWNER } from './helpers'

test('brand (D44): Deep Forest bar with cream text, header logo, theme colour and PWA icons', async ({ page, request }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('DA-YO POS')
  await expect(page.getByTestId('brand-logo')).toBeVisible()
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1E3B22')
  await expect(page.locator('.brandbar')).toHaveCSS('background-color', 'rgb(30, 59, 34)')
  await expect(page.locator('.brandbar .name')).toHaveCSS('color', 'rgb(246, 243, 232)')
  for (const path of ['/icon.svg', '/icon-192.png', '/icon-512.png', '/brand/logo-header.svg', '/brand/wave.svg']) {
    expect((await request.get(path)).status(), path).toBe(200)
  }
})

test('first run: setup → login → open shift lands on the sell screen; a reload asks for the PIN again', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('DA-YO POS')
  await firstRun(page)
  await page.reload()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByTestId(`user-${OWNER.name}`).click()
  await enterPin(page, '9999')
  await expect(page.getByRole('alert')).toBeVisible()
  await enterPin(page, OWNER.pin)
  await expect(page).toHaveURL(/\/sell$/)
})
