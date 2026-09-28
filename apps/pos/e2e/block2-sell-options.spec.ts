import { expect, test } from '@playwright/test'
import { firstRun, login, mock } from './helpers'

/**
 * spec table row "block2-sell-options" (ADR-0054): milk/grade options, the buy-2-get-1 promo, a channel switch and
 * the size buttons a catalog bump adds. Every money figure here is checked against `priceCart` itself (a throwaway
 * Node script against `@dayo/contracts/fixtures/pos-test/e1-catalog-rich.json` — the same catalog this e1 mock
 * serves), never hand-arithmetic: ฿155.00 for Thai Tea (oat) + Matcha Latte (Premium grade) on the store channel ·
 * ฿70.00 for Thai Tea ×3 on the store channel (2-แถม-1 pays for 2 × ฿35) · ฿59.00 for one Thai Tea 20 oz on Grab
 * (ceil(45 × 1.30)).
 */
test('block2: milk/grade options price correctly, the buy-2-get-1 promo applies, and a channel switch reprices', async ({ page, request }) => {
  await firstRun(page, request)

  await page.getByTestId('menu-Thai Tea').click()
  await page.getByTestId('item-milk-oat').click()
  await expect(page.getByTestId('item-milk-oat')).toHaveText(/\+฿15/)
  await page.getByTestId('item-add').click()

  await page.getByTestId('menu-Matcha Latte').click()
  // the grade delta compares against whichever grade is CURRENTLY picked (default Excellent) — check it before
  // clicking Premium, since Premium's own delta against itself is 0 once it is the one selected.
  await expect(page.getByTestId('item-grade-Premium')).toHaveText(/\+฿20/)
  await page.getByTestId('item-grade-Premium').click()
  await page.getByTestId('item-add').click()

  await expect(page.getByTestId('cart-total')).toHaveText('฿155.00')

  // done with this bill — pay it so the cart is empty again before the next combo (adding items never merges across bills)
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000001')
  await page.getByTestId('done-new-sale').click()
  await expect(page).toHaveURL(/\/sell$/)

  // Thai Tea ×3, store channel (default) — buy 2 get 1 (auto-applied, priority 10)
  await page.getByTestId('menu-Thai Tea').click()
  await page.getByTestId('item-add').click()
  await page.getByTestId('cart-inc-0').click()
  await page.getByTestId('cart-inc-0').click()
  await expect(page.getByTestId('cart-qty-0')).toHaveText('3')
  await expect(page.getByTestId('cart-total')).toHaveText('฿70.00')
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000002')
  await page.getByTestId('done-new-sale').click()
  await expect(page).toHaveURL(/\/sell$/)

  // switch to Grab (cart is empty) — one Thai Tea 20 oz reprices under the channel's own markup + rounding
  await page.getByTestId('channel-select').selectOption('grab')
  await page.getByTestId('menu-Thai Tea').click()
  await page.getByTestId('item-size-20oz').click()
  await expect(page.getByTestId('item-add')).toBeEnabled()
  await page.getByTestId('item-add').click()
  await expect(page.getByTestId('cart-total')).toHaveText('฿59.00')
  await page.getByTestId('pay-qr').click()
  await expect(page.getByTestId('qr-total')).toHaveText('฿59.00')
  await page.getByTestId('qr-received').click()
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000003')

  // a catalog bump can open a new, currently-inactive size — its buttons must sort by the catalog's own sortOrder
  await mock(request, 'bump-catalog', {
    sizes: [
      { code: '16 oz', label: '16 oz', sortOrder: 0, isActive: true },
      { code: '20 oz', label: '20 oz', sortOrder: 1, isActive: true },
      { code: '22 oz', label: '22 oz', sortOrder: 2, isActive: true },
    ],
  })
  await page.getByTestId('done-new-sale').click()
  await page.reload()
  await login(page)
  await expect(page).toHaveURL(/\/sell$/)

  await page.getByTestId('menu-Thai Tea').click()
  // finding (Task 21, real gap in @dayo/dayo-mock — see report "Real bugs found, not fixed here"): `/__mock/bump-
  // catalog` only ever replaces `catalog.sizes` (packages/dayo-mock/src/control.ts) — there is no way through this
  // control endpoint to add a matching `catalog.variants` entry for the newly-active size. A menu's own `sizes`
  // list (SellCatalogDto, ADR-0054) is built from `catalog.variants`, never `catalog.sizes` alone, so activating
  // "22 oz" this way still shows only the two sizes Thai Tea actually has priced variants for — the size-button-
  // sortOrder and "a 22 oz bill reaches central" halves of this scenario cannot be built with the mock as it is;
  // this checks the reachable half (the catalog change lands, in the ordering the two REAL sizes always had).
  const sizeButtons = page.locator('[data-testid^="item-size-"]')
  await expect(sizeButtons).toHaveCount(2)
  await expect(sizeButtons.nth(0)).toHaveAttribute('data-testid', 'item-size-16oz')
  await expect(sizeButtons.nth(1)).toHaveAttribute('data-testid', 'item-size-20oz')
})
