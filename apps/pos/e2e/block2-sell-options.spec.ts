import { expect, test } from '@playwright/test'
import { login, mock, mockState, openShift, setOtherPin, setupDevice } from './helpers'

/**
 * spec table row "block2-sell-options" (ADR-0054): milk/grade options, the buy-2-get-1 promo, a channel switch and
 * the size buttons a catalog bump adds. Every money figure here is checked against `priceCart` itself (a throwaway
 * Node script against `@dayo/contracts/fixtures/pos-test/e1-catalog-rich.json` — the same catalog this e1 mock
 * serves), never hand-arithmetic: ฿155.00 for Thai Tea (oat) + Matcha Latte (Premium grade) on the store channel ·
 * ฿70.00 for Thai Tea ×3 on the store channel (2-แถม-1 pays for 2 × ฿35) · ฿59.00 for one Thai Tea 20 oz on Grab
 * (ceil(45 × 1.30)) · ฿55.00 for one Thai Tea 22 oz on the store channel after the bump below (no promotion applies).
 */
test('block2: milk/grade options price correctly, the buy-2-get-1 promo applies, a channel switch reprices, and a bumped 22 oz sells and reaches dayo', async ({ page, request }) => {
  // The catalog's "มัตฉะบ่าย ลด 15%" (Mon-Fri 14:00-16:00 Bangkok) would cut the ฿155.00 below by ฿15.75 whenever the suite
  // runs in that window. `page.clock` cannot pin it: the sale is priced in the DB worker with the real clock, so the
  // recheck at payment disagrees with the pinned preview. Dayo's owner closing the promotion (like the real flow, E1
  // then sends active promotions only) makes this spec independent of the time of day; p10 tests the windows.
  await mock(request, 'reset')
  await mock(request, 'close-promotion', { id: '9f8e0000-0000-4000-8000-000000000002', at: new Date().toISOString() })
  await setupDevice(page)
  await setOtherPin(page)
  await login(page)
  await openShift(page)

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

  // a catalog bump opens the inactive 22 oz AND prices Thai Tea in it (a size with no priced variant has no button —
  // the menu's sizes come from its variants). The sizes are listed out of order on purpose: the buttons must follow
  // the catalog's own sortOrder, not the order dayo happens to send them in.
  const thaiTea22 = (sweetness: string) => ({
    menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', family: 'ชาไทย', categoryLabel: 'ชา', menuSortOrder: 1,
    size: '22 oz', sweetness, price: 55, allowOatMilk: true, isMatcha: false,
    recipeLines: [
      { ingredientId: null, baseId: '5e1f0000-0000-4000-8000-000000000001', qty: 170, unit: 'ml' },
      { ingredientId: 'c3d4e5f6-0000-4000-8000-000000000001', baseId: null, qty: 90, unit: 'ml' },
    ],
  })
  await mock(request, 'bump-catalog', {
    sizes: [
      { code: '22 oz', label: '22 oz', sortOrder: 2, isActive: true },
      { code: '16 oz', label: '16 oz', sortOrder: 0, isActive: true },
      { code: '20 oz', label: '20 oz', sortOrder: 1, isActive: true },
    ],
    variants: ['0%', '25%', '50%', '75%', '100%'].map(thaiTea22),
  })
  const catalogPulls = async () => (await mockState(request)).requests.filter((r) => r.path === '/api/v1/pos/catalog' && r.status === 200).length
  const pullsBefore = await catalogPulls()
  await page.getByTestId('done-new-sale').click()
  await page.reload()
  // the reloaded app pulls E1 on open ('open' wake) — wait for it so the sell screen reads the bumped catalog
  await expect.poll(catalogPulls).toBeGreaterThan(pullsBefore)
  await login(page)
  await expect(page).toHaveURL(/\/sell$/)

  await page.getByTestId('channel-select').selectOption('store')
  await page.getByTestId('menu-Thai Tea').click()
  const sizeButtons = page.locator('[data-testid^="item-size-"]')
  await expect(sizeButtons).toHaveCount(3)
  await expect(sizeButtons.nth(0)).toHaveAttribute('data-testid', 'item-size-16oz')
  await expect(sizeButtons.nth(1)).toHaveAttribute('data-testid', 'item-size-20oz')
  await expect(sizeButtons.nth(2)).toHaveAttribute('data-testid', 'item-size-22oz')
  await page.getByTestId('item-size-22oz').click()
  await expect(page.getByTestId('item-add')).toBeEnabled()
  await page.getByTestId('item-add').click()
  await expect(page.getByTestId('cart-total')).toHaveText('฿55.00')
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  await expect(page.getByTestId('done-receipt')).toHaveText('A-000004')

  // the 22 oz bill reaches dayo: accepted (dayo knows the variant — an unknown one is rejected UNKNOWN_CODE) at ฿55
  await expect.poll(async () => (await mockState(request)).orders.find((o) => o.receiptNo === 'A-000004')).toMatchObject({ status: 'ok', total: 55 })
})
