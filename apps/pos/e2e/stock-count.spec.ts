import { expect, test } from '@playwright/test'
import { firstRun, login } from './helpers'

test('opening count covers every item, blind until saved, resumed after a reload; later counts offer the key set (spec §4.5 · D30 · Q4-2/3/12/13/14)', async ({ page }) => {
  await firstRun(page)
  await page.getByTestId('nav-stock').click()
  await expect(page.getByTestId('stock-count-due')).toBeVisible()
  await page.getByTestId('nav-count').click()
  await page.getByTestId('count-start').click()

  // the first count is the opening count: every item, no key-set choice (Q4-13)
  await expect(page.getByTestId('count-opening-hint')).toBeVisible()
  await expect(page.getByTestId('count-scope-key')).toHaveCount(0)
  await expect(page.getByTestId('count-row-RM-POW-01')).toBeVisible()

  await expect(page.getByTestId('count-variance-RM-TEA-01')).toHaveCount(0) // blind: nothing to compare against yet
  await page.getByTestId('count-units-RM-TEA-01').fill('2') // 2 full bags of 400 g, no loose rest (Q4-14)
  await page.getByTestId('count-save-RM-TEA-01').click()
  await expect(page.getByTestId('count-variance-RM-TEA-01')).toContainText('800 g')
  await expect(page.getByTestId('count-opening-RM-TEA-01')).toBeVisible()

  // "แก้ตัวเลข" is a typo fix, not a recount — check it before the row moves on (review m-2)
  await expect(page.getByTestId('count-recount-RM-TEA-01')).toHaveAttribute('title', /ยอดบัญชี/)
  await expect(page.getByTestId('count-remove-RM-TEA-01')).toHaveAttribute('title', /ยอดบัญชี/)

  // the open count survives a reload (lock / tablet sleep) and is resumed
  await page.reload()
  await login(page)
  await page.getByTestId('nav-stock').click()
  await page.getByTestId('nav-count').click()
  await expect(page.getByTestId('count-counted-RM-TEA-01')).toBeVisible()

  // closing with items left uncounted is refused
  await page.getByTestId('count-close').click()
  await page.getByTestId('count-close-confirm').click()
  await expect(page.getByRole('alert')).toBeVisible()
  // review m-3: the refusal names the still-uncounted items
  await expect(page.getByRole('alert')).toContainText('RM-POW-01')
  // review m-2 (fix round 1): the refusal un-arms the confirm — the plain "count-close" button is back, asking again is required
  await expect(page.getByTestId('count-close-confirm')).toHaveCount(0)
  await expect(page.getByTestId('count-close')).toBeVisible()

  // everything else is empty on this shelf: save each row with an explicit 0 (review I-2 — a blank field is refused)
  const unsaved = page.locator('[data-testid^="count-save-"]')
  while ((await unsaved.count()) > 0) {
    const n = await unsaved.count()
    const code = (await unsaved.first().getAttribute('data-testid'))!.slice('count-save-'.length)
    await page.getByTestId(`count-rest-${code}`).fill('0')
    await unsaved.first().click()
    await expect(unsaved).toHaveCount(n - 1)
  }
  await page.getByTestId('count-close').click()
  await page.getByTestId('count-close-confirm').click()
  await expect(page.getByTestId('count-closed')).toBeVisible()
  await expect(page.getByTestId('count-start')).toBeVisible()
  // review I-3: a successful close leaves no stale refusal banner behind
  await expect(page.getByRole('alert')).toHaveCount(0)

  await page.getByTestId('nav-stock').click()
  await expect(page.getByTestId('stock-onhand-RM-TEA-01')).toContainText('800 g')
  await expect(page.getByTestId('stock-count-due')).toHaveCount(0)

  // the weekly count after the opening: the key set by default (Q4-2), all items on request
  await page.getByTestId('nav-count').click()
  await page.getByTestId('count-start').click()
  await expect(page.getByTestId('count-row-RM-TEA-01')).toBeVisible()
  await expect(page.getByTestId('count-row-RM-POW-01')).toHaveCount(0)
  await page.getByTestId('count-scope-all').click()
  await expect(page.getByTestId('count-row-RM-POW-01')).toBeVisible()
})
