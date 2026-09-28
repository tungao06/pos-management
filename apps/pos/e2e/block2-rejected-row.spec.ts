import { expect, test } from '@playwright/test'
import { firstRun, mock, mockState, sellOne } from './helpers'

test('block2: dayo rejects one bill (UNKNOWN_CODE) — the other still reaches dayo, and the owner sees it on "ส่งไม่ผ่าน"', async ({ page, request }) => {
  await firstRun(page, request)
  await mock(request, 'override', {
    match: { receiptNo: 'A-000001' },
    verdict: { status: 'rejected', reason: 'UNKNOWN_CODE', detail: 'ไม่รู้จักรหัสเมนูนี้' },
    times: 1,
  })

  const receipt1 = await sellOne(page, 'Pink Milk', 'cash')
  expect(receipt1).toBe('A-000001')
  const receipt2 = await sellOne(page, 'Pink Milk', 'cash')
  expect(receipt2).toBe('A-000002')

  await expect.poll(async () => (await mockState(request)).orders.map((o) => o.receiptNo)).toContain('A-000002')
  await expect.poll(async () => (await mockState(request)).orders.map((o) => o.receiptNo)).not.toContain('A-000001')

  // finding (Task 21): nothing invalidates the bootstrap query when a background push cycle finishes — the banner
  // only catches up on the 30 s `refetchInterval` (queries.ts BOOTSTRAP_REFETCH_MS), not right after the push. The
  // brief does not give this scenario a hard time bound (unlike block2-offline-sync's online-reconnect "ภายใน 10 วิ"),
  // so a generous timeout here is the correct wait, not a weakened assertion.
  await expect(page.getByTestId('banner-problems')).toContainText('ส่งไม่ผ่าน 1 บิล', { timeout: 35_000 })
  await page.getByTestId('banner-problems').click()
  await expect(page).toHaveURL(/\/sync-problems$/)
  await expect(page.getByTestId('problem-A-000001')).toBeVisible()
})
