import { expect, test, type Page } from '@playwright/test'
import { TH } from '../src/ui/th'
import { fillCount, login, mock, mockState, openShift, OWNER, sellOne, setOtherPin, setStaffPin, setupDevice } from './helpers'

const MANAGER = { name: 'Beam', pin: '3333' } as const

test.beforeEach(async ({ request }) => {
  await mock(request, 'reset')
  // phase 2 (implies phase 1): order_off_catalog only exists on a phase-2 mock (preflight P3) — this whole spec needs it.
  await mock(request, 'block3', { on: true, phase2: true })
})
test.afterEach(async ({ request }) => {
  await mock(request, 'reset')
})

async function startShift(page: Page, floatBaht = '500'): Promise<void> {
  await setupDevice(page)
  await setOtherPin(page)
  await login(page)
  await openShift(page, floatBaht)
}

test('block3 off-catalog: an owner closes a rejected bill as off-catalog; a manager never sees the button', async ({ page, request }) => {
  await mock(request, 'block3-live-from', { date: '2026-09-01' })
  await startShift(page, '500')

  await mock(request, 'override', {
    match: { receiptNo: 'A-000001' },
    verdict: { status: 'rejected', reason: 'UNKNOWN_CODE', detail: 'ไม่รู้จักรหัสเมนูนี้' },
    times: 1,
  })
  const receipt = await sellOne(page, 'Cocoa', 'cash') // ฿45
  expect(receipt).toBe('A-000001')

  await expect(page.getByTestId('banner-problems')).toContainText('ส่งไม่ผ่าน 1 บิล', { timeout: 15_000 })

  // a manager (Beam) never even sees the row — `sync_problems` is owner-only (app/permissions.ts) — let alone the
  // "ปิดเป็นบิลนอกแคตตาล็อก" button gated a second time by `close_off_catalog` (D97 · security review).
  await page.getByTestId('lock').click()
  await setStaffPin(page, MANAGER.name, MANAGER.pin)
  await login(page, MANAGER)
  await expect(page.getByTestId('banner-problems')).toHaveCount(0)
  await page.getByTestId('lock').click()
  await login(page, OWNER)

  await page.getByTestId('banner-problems').click()
  await expect(page).toHaveURL(/\/sync-problems$/)
  const row = page.locator('[data-testid^="problem-"]', { hasText: 'A-000001' })
  await expect(row).toBeVisible()
  await row.getByTestId('remedy-close-off-catalog').click()
  await expect(page.getByTestId('off-catalog-dialog')).toBeVisible()
  await expect(page.getByText(TH.offCatalogWarning)).toBeVisible()
  await page.getByTestId('off-catalog-reason').fill('ลูกค้าจ่ายเงินแล้วแต่ระบบไม่รับรหัสเมนู')
  for (const digit of OWNER.pin) await page.getByTestId(`pin-${digit}`).click()
  await page.getByTestId('off-catalog-confirm').click()
  await expect(row).toHaveCount(0)

  // the bill now shows the "นอกแคตตาล็อก" badge
  await page.getByTestId('nav-status-back').click()
  await expect(page).toHaveURL(/\/status$/)
  await page.getByTestId('status-back').click()
  await expect(page).toHaveURL(/\/sell$/)
  await page.getByTestId('nav-orders').click()
  await expect(page.getByTestId('order-row-A-000001').getByTestId('order-off-catalog-badge')).toBeVisible()
  await page.getByTestId('nav-sell').click()

  // close the shift — the off-catalog bill was still cash ฿45, so the drawer holds exactly what it should
  await page.getByTestId('close-shift-open').click()
  await fillCount(page, 545)
  await page.getByTestId('count-finish').click()
  await expect(page.getByTestId('count-expected')).toHaveText('฿545.00')
  await page.getByTestId(`count-approver-${OWNER.name}`).click()
  for (const digit of OWNER.pin) await page.getByTestId(`pin-${digit}`).click()
  await page.getByTestId('count-confirm').click()
  await expect(page).toHaveURL(/\/z\//)

  await expect.poll(async () => (await mockState(request)).zReports[0]?.recomputeStatus, { timeout: 70_000 }).toBe('matched')
})

test('block3 off-catalog CONFLICT exists: shows "รับทราบ — บิลอยู่ในระบบกลางแล้ว" and the central-mismatch banner', async ({ page, request }) => {
  await mock(request, 'block3-live-from', { date: '2026-09-01' })
  await startShift(page, '500')

  await mock(request, 'override', {
    match: { receiptNo: 'A-000001' },
    verdict: { status: 'rejected', reason: 'UNKNOWN_CODE', detail: 'ไม่รู้จักรหัสเมนูนี้' },
    times: 1,
  })
  await sellOne(page, 'Cocoa', 'cash') // ฿45

  await expect(page.getByTestId('banner-problems')).toContainText('ส่งไม่ผ่าน 1 บิล', { timeout: 15_000 })
  await page.getByTestId('banner-problems').click()
  await expect(page).toHaveURL(/\/sync-problems$/)
  const row = page.locator('[data-testid^="problem-"]', { hasText: 'A-000001' })
  await row.getByTestId('remedy-close-off-catalog').click()

  // the retry this remedy sends (order_off_catalog) comes back CONFLICT exists: — dayo already has this bill
  await mock(request, 'override', {
    match: { receiptNo: 'A-000001' },
    verdict: {
      status: 'rejected', reason: 'CONFLICT', detail: 'exists: L260101-999 บิลนี้อยู่ในระบบกลางแล้ว',
      data: { order_no: 'L260101-999', version: 1, reported_total: 99, payment_is_cash: true, off_catalog: false },
    },
    times: 1,
  })
  await page.getByTestId('off-catalog-reason').fill('ลูกค้าจ่ายเงินแล้วแต่ระบบไม่รับรหัสเมนู')
  for (const digit of OWNER.pin) await page.getByTestId(`pin-${digit}`).click()
  await page.getByTestId('off-catalog-confirm').click()
  await expect(row).toHaveCount(0) // the old dead row is closed at once — `order_off_catalog`'s retry is queued, not sent yet

  // the retry is a fresh outbox write of its own: `syncProblemsKey` only refetches on remount (no polling) — leave
  // and come back until the scheduler's own cycle has actually pushed and killed it (a `banner-problems` count on
  // its own can be a moment ahead of `listSyncProblems` seeing the same dead row — both read the same local DB, but
  // not in the same instant here), never a single fixed wait.
  await expect(async () => {
    await page.getByTestId('nav-status-back').click()
    await expect(page).toHaveURL(/\/status$/)
    await expect(page.getByTestId('banner-problems')).toBeVisible()
    await page.getByTestId('banner-problems').click()
    await expect(page).toHaveURL(/\/sync-problems$/)
    await expect(page.getByTestId('problem-central-mismatch')).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 90_000, intervals: [2_000] })

  await expect(page.getByTestId('problem-central-mismatch')).toContainText(TH.problemCentralMismatch)
  await page.getByTestId('remedy-acknowledge').click()
  await page.getByTestId('approval-reason').fill('ตรวจกับระบบกลางแล้ว ยอดตรงกัน')
  await page.getByTestId(`approval-owner-${OWNER.name}`).click()
  await page.getByTestId('approval-pin').fill(OWNER.pin)
  await page.getByTestId('approval-ok').click()
  await expect(row).toHaveCount(0)

  await expect(page.getByTestId('banner-central-mismatch')).toContainText(TH.centralMismatchBanner)
})
