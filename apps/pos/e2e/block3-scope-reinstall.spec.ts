import { expect, test, type Page } from '@playwright/test'
import { TH } from '../src/ui/th'
import { fillCount, login, mock, mockState, openShift, OWNER, sellOne, setOtherPin, setupDevice } from './helpers'

test.beforeEach(async ({ request }) => {
  await mock(request, 'reset')
  await mock(request, 'block3', { on: true })
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

test('block3 scope wait: a key without shift:write still pushes bills; the shift row waits, never on "ส่งไม่ผ่าน" — until the scope is added back (spec §9 ก้อน 3)', async ({ page, request }) => {
  // dayo 0066:672-675: only a shift-kind row needs shift:write — the key otherwise has every scope it needs.
  await mock(request, 'scopes', { scopes: ['catalog:read', 'staff:read', 'orders:read', 'orders:write'] })
  await startShift(page, '500')
  const receipt = await sellOne(page, 'Cocoa', 'cash') // ฿45 — orders:write still works

  await expect.poll(async () => (await mockState(request)).orders.map((o) => o.receiptNo)).toContain(receipt)
  await expect(page.getByTestId('banner-scope')).toContainText(TH.scopeBanner('shift:write'))
  await expect(page.getByTestId('banner-problems')).toHaveCount(0) // never "dead" — nothing here for the owner to remedy directly

  // an owner adds the scope back on the dayo website, then presses "ส่งตอนนี้" — fix round 1 item 3 (ruling): a
  // manual wake now also clears a scope-wait row's own retry wait at once (apps/pos/src/sync/push.ts
  // clearScopeWait/hasScopeWait, apps/pos/src/sync/scheduler.ts clearBackoffFor), never waiting the full
  // SCOPE_RETRY_MS (15 real minutes) an automatic cycle still would.
  await mock(request, 'scopes', { scopes: ['catalog:read', 'staff:read', 'orders:read', 'orders:write', 'shift:write'] })
  await page.getByTestId('nav-shift').click()
  await page.getByTestId('nav-status').click()
  await expect(page).toHaveURL(/\/status$/)
  await page.getByTestId('status-sync-now').click()
  await expect(page.getByTestId('banner-scope')).toHaveCount(0, { timeout: 15_000 })

  await expect.poll(async () => (await mockState(request)).shifts.at(-1)?.status).not.toBe(undefined)
  const state = await mockState(request)
  expect(state.shifts.some((s) => s.dataConflict)).toBe(false)
})

test('block3 reinstall: setup shows dayo\'s last Z and requires the tick; the first Z after it acknowledges the broken chain and continues the number', async ({ page, request }) => {
  const countedAt = new Date(Date.now() - 60_000).toISOString()
  await mock(request, 'preload-z', { zNo: 41, hash: 'a'.repeat(64), countedAt })

  await setupDevice(page) // asserts "Z ล่าสุดในระบบกลาง: 41" is shown and ticks "ตรวจแล้ว" before "setup-save" unlocks
  await setOtherPin(page)
  await login(page)
  await openShift(page, '500')

  await page.getByTestId('close-shift-open').click()
  await fillCount(page, 500) // exact — no sales, no variance
  await page.getByTestId('count-finish').click()
  await expect(page.getByTestId('count-expected')).toHaveText('฿500.00')
  await page.getByTestId(`count-approver-${OWNER.name}`).click()
  for (const digit of OWNER.pin) await page.getByTestId(`pin-${digit}`).click()
  await page.getByTestId('count-confirm').click()

  // Z_CHAIN_BROKEN "central" (ruling R9): this reinstalled device's own chain never saw dayo's Z 41 — the owner
  // acknowledges it once, by PIN, before the first Z of the line (42) actually goes out.
  await expect(page.getByTestId('close-chain-broken')).toHaveText(TH.zChainCentral(41))
  await page.getByTestId(`count-approver-${OWNER.name}`).click()
  for (const digit of OWNER.pin) await page.getByTestId(`pin-${digit}`).click()
  await page.getByTestId('count-confirm').click()

  await expect(page).toHaveURL(/\/z\//)
  // the Z's own frozen snapshot still names the (now acknowledged) chain break — `z-chain-warning` is not about
  // whether it was acknowledged, only whether one happened; `z-central-continued` is the number it continued from.
  await expect(page.getByTestId('z-chain-warning')).toBeVisible()
  await expect(page.getByTestId('z-central-continued')).toContainText('41')

  await expect.poll(async () => (await mockState(request)).zReports.length, { timeout: 70_000 }).toBe(1)
  const state = await mockState(request)
  expect(state.zReports[0]?.zNo).toBe(42)
  expect(state.conflicts.some((c) => c.startsWith('z_no_taken'))).toBe(false)
})
