import { expect, test } from '@playwright/test'
import { addItem, firstRun, login } from './helpers'

test('after one online load the app reopens and sells with no network; data survives', async ({ page, context }) => {
  await firstRun(page)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  // M8: Playwright's network emulation does not reliably cover the service worker's own fetches —
  // check the precache directly so a missing entry fails here instead of silently loading from the network.
  const cached = await page.evaluate(async () => {
    const out: string[] = []
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url)
    return out
  })
  expect(cached.some((u) => u.endsWith('.wasm'))).toBe(true)
  expect(cached.some((u) => /worker.*\.js$/.test(u))).toBe(true)
  await context.setOffline(true)
  await page.reload() // served by the service worker precache
  await login(page)
  await expect(page).toHaveURL(/\/sell$/)
  await addItem(page, 'Original')
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000001')

  await page.reload()
  await login(page)
  await page.getByTestId('nav-orders').click()
  await expect(page.getByTestId('order-row-A-000001')).toHaveAttribute('data-status', 'paid')
  await context.setOffline(false)
})
