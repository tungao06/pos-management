import { expect, test } from '@playwright/test'

test('app shell loads with the DA-YO brand bar, theme colour and icons', async ({ page, request }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('DA-YO POS')
  await expect(page.getByTestId('app-name')).toBeVisible()
  await expect(page.getByTestId('brand-logo')).toBeVisible()
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1E3B22')
  await expect(page.locator('.brandbar')).toHaveCSS('background-color', 'rgb(30, 59, 34)')
  await expect(page.locator('.brandbar .name')).toHaveCSS('color', 'rgb(246, 243, 232)')
  for (const path of ['/icon.svg', '/icon-192.png', '/icon-512.png', '/brand/logo-header.svg', '/brand/wave.svg']) {
    expect((await request.get(path)).status(), path).toBe(200)
  }
})
