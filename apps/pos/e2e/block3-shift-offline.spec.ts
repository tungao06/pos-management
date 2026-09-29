import { expect, test, type Page } from '@playwright/test'
import { TH } from '../src/ui/th'
import { fillCount, login, mock, mockState, openShift, OWNER, sellOne, setOtherPin, setupDevice } from './helpers'

test.beforeEach(async ({ request }) => {
  await mock(request, 'reset')
  // phase 2 (implies phase 1): a spec checking `recomputeStatus === 'matched'` needs it (preflight P3).
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

test('block3 offline count → waiting Z → online again issues it, then the next shift also closes matched (spec §9 ก้อน 3 · D101 step 3)', async ({ page, context, request }) => {
  await startShift(page, '500')
  await sellOne(page, 'Cocoa', 'cash') // ฿45 — while still online

  await context.setOffline(true)

  await page.getByTestId('close-shift-open').click()
  await fillCount(page, 545) // ฿500 float + ฿45 — exact, no reason needed either way
  await page.getByTestId('count-finish').click()
  await expect(page.getByTestId('count-expected')).toHaveText('฿545.00')
  // offline: E4 never answers — "ยังไม่รวมบิลเงินสดจากบอท", and (D101 review item 5) no reason field regardless
  // of variance since a count with no bot cash never issues a Z from here (it is confirmed alone, z: null).
  await expect(page.getByTestId('count-no-bot-cash')).toHaveText(TH.countNoBotCash)
  await expect(page.getByTestId('count-reason')).toHaveCount(0)
  await page.getByTestId(`count-approver-${OWNER.name}`).click()
  for (const digit of OWNER.pin) await page.getByTestId(`pin-${digit}`).click()
  await page.getByTestId('count-confirm').click()
  await expect(page.getByTestId('count-saved-offline')).toHaveText(TH.countSavedOffline)

  await expect(page.getByTestId('banner-z-waiting')).toBeVisible()
  await page.getByTestId('nav-shift-open').click()
  await expect(page).toHaveURL(/\/shift\/open$/)

  // a second shift can still open and sell while the first one's Z is still waiting online
  await openShift(page, '0')
  await sellOne(page, 'Cocoa', 'cash') // ฿45, queued offline too

  await context.setOffline(false)
  await page.getByTestId('z-issue').click() // the banner's own button — the oldest waiting shift, never any other (ruling R7)
  await expect(page).toHaveURL(/\/shift\/z\//)
  await expect(page.getByText(TH.countBotCash(0))).toBeVisible() // E4 now answers — no bot bills, but a real (empty) answer
  await page.getByTestId(`count-approver-${OWNER.name}`).click()
  for (const digit of OWNER.pin) await page.getByTestId(`pin-${digit}`).click()
  await page.getByTestId('count-confirm').click()
  await expect(page.getByTestId('z-issued')).toHaveText(TH.zDone)
  await expect(page.getByTestId('banner-z-waiting')).toHaveCount(0)

  // ทุกแถวของทั้งสองกะรับแล้ว ไม่มี CONFLICT: both shifts' rows (open/count/z, cash sales) reached dayo clean
  await expect.poll(async () => (await mockState(request)).zReports.length, { timeout: 70_000 }).toBe(1)
  await expect.poll(async () => (await mockState(request)).zReports[0]?.recomputeStatus, { timeout: 20_000 }).toBe('matched')
  const state = await mockState(request)
  expect(state.shifts).toHaveLength(2)
  expect(state.shifts.every((s) => !s.dataConflict)).toBe(true)
  expect(state.conflicts).toEqual([])
  expect(state.rejections).toEqual([])
})
