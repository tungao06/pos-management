import { expect, test } from '@playwright/test'

type Check = { id: string; required: boolean; pass: boolean | 'manual'; detail: string }

test('spike checks pass in desktop Chromium and data survives a reload', async ({ page }) => {
  await page.goto('/')
  const status = page.locator('#status')
  await expect(status).not.toHaveAttribute('data-verdict', 'RUNNING', { timeout: 60_000 })
  const report = JSON.parse((await page.locator('#result').textContent()) ?? '{}') as { checks?: Check[]; error?: string }
  expect(report.error, 'worker error').toBeUndefined()
  // S9 (persist permission) is decided by the browser's engagement heuristics; judge it on the tablet only.
  const failed = (report.checks ?? []).filter((c) => c.required && c.pass === false && c.id !== 'S9')
  expect(failed, JSON.stringify(failed, null, 2)).toEqual([])

  const first = Number(await status.getAttribute('data-boot-count'))
  expect(first).toBeGreaterThan(0)
  await page.reload()
  await expect(status).not.toHaveAttribute('data-verdict', 'RUNNING', { timeout: 60_000 })
  expect(Number(await status.getAttribute('data-boot-count'))).toBe(first + 1)
})
