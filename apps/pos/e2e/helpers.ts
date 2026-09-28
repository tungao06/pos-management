import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { MOCK_API_KEY } from '@dayo/dayo-mock'

export const DAYO_BASE = 'http://localhost:8787/api/v1'
export const MOCK_KEY = MOCK_API_KEY // `dayo_${'0123456789abcdef'.repeat(4)}` — kept identical to @dayo/dayo-mock's own default key
export const OWNER = { name: 'TungAo', pin: '1111' } as const
export const OTHER = { name: 'DCm', pin: '2222' } as const
export const PROMPTPAY_ID = '0812345678'
// The receipt prefix used throughout these specs (e.g. "A-000001") — free to choose since the mock's
// client.last_receipt_no is null on a fresh run, so `connectShop` never locks it.
export const RECEIPT_PREFIX = 'A'

const MOCK_URL = 'http://localhost:8787'

/** Every `/__mock/*` test-control route the mock server answers (packages/dayo-mock/src/control.ts). */
export async function mock(
  request: APIRequestContext,
  path: 'reset' | 'mode' | 'now' | 'override' | 'bump-catalog' | 'seed-orders' | 'edit-pos-order',
  body?: unknown,
): Promise<void> {
  const res = await request.post(`${MOCK_URL}/__mock/${path}`, { data: body ?? {} })
  expect(res.ok(), `POST /__mock/${path} → ${res.status()}`).toBe(true)
}

export type MockOrderState = { posOrderId: string; orderNo: string; receiptNo: string; status: string; total: number }
export type MockRequestLog = { method: string; path: string; rows: number; status: number }
export async function mockState(request: APIRequestContext): Promise<{ orders: MockOrderState[]; requests: MockRequestLog[] }> {
  const res = await request.get(`${MOCK_URL}/__mock/state`)
  expect(res.ok(), `GET /__mock/state → ${res.status()}`).toBe(true)
  return res.json()
}

/**
 * Task 17: links this (fresh) tablet to the dayo mock server (playwright.config.ts) with its one key, then
 * leaves the login screen showing (the second owner, DCm, still has no PIN of their own — `setOtherPin` gives
 * them one, separately, since several specs need DCm's PIN and some do not need it at all).
 */
export async function setupDevice(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByTestId('setup-api-key')).toBeVisible()
  await page.getByTestId('setup-api-key').fill(MOCK_KEY)
  await page.getByTestId('setup-probe').click()
  await expect(page.getByTestId('setup-client-name')).toBeVisible()
  await page.getByTestId(`setup-owner-${OWNER.name}`).click()
  await page.getByTestId('setup-prefix').fill(RECEIPT_PREFIX)
  await page.getByTestId('setup-pin').fill(OWNER.pin)
  await page.getByTestId('setup-pin2').fill(OWNER.pin)
  await page.getByTestId('setup-promptpay').fill(PROMPTPAY_ID)
  await page.getByTestId('setup-save').click()
  // quality review (fix round 1): the persist-storage result is shown and waited on now, not flashed and
  // immediately navigated past (spec §6.9) — "setup-continue" is what leaves the setup screen.
  await expect(page.getByTestId('setup-persist-status')).toBeVisible()
  await page.getByTestId('setup-continue').click()
  await expect(page.getByTestId(`user-${OWNER.name}`)).toBeVisible()
}

/** DCm (the second dayo owner) gets a PIN, approved by TungAo, from the login screen — several e2e specs approve a void with DCm's PIN. */
export async function setOtherPin(page: Page): Promise<void> {
  await expect(page.getByTestId(`needs-pin-${OTHER.name}`)).toBeVisible()
  await page.getByTestId(`needs-pin-${OTHER.name}`).click()
  await page.getByTestId('staff-pin-approver-pin').fill(OWNER.pin) // TungAo is the only (and default-selected) approver
  await page.getByTestId('staff-pin-new').fill(OTHER.pin)
  await page.getByTestId('staff-pin-new2').fill(OTHER.pin)
  await page.getByTestId('staff-pin-save').click()
  await expect(page.getByTestId(`user-${OTHER.name}`)).toBeVisible()
}

export async function enterPin(page: Page, pin: string): Promise<void> {
  for (const digit of pin) await page.getByTestId(`pin-${digit}`).click()
  await page.getByTestId('pin-ok').click()
}

export async function login(page: Page, user: { name: string; pin: string } = OWNER): Promise<void> {
  await expect(page.getByTestId(`user-${user.name}`)).toBeVisible()
  await page.getByTestId(`user-${user.name}`).click()
  await enterPin(page, user.pin)
}

export async function openShift(page: Page, floatBaht = '500'): Promise<void> {
  await expect(page.getByTestId('shift-float')).toBeVisible()
  await page.getByTestId('shift-float').fill(floatBaht)
  await page.getByTestId('shift-open').click()
  await expect(page).toHaveURL(/\/sell$/)
}

/** mock reset + setup + DCm's PIN + login + open shift — every fresh e2e run starts here. */
export async function firstRun(page: Page, request: APIRequestContext): Promise<void> {
  await mock(request, 'reset')
  await setupDevice(page)
  await setOtherPin(page)
  await login(page)
  await openShift(page)
}

/**
 * Task 18: the sell screen is driven by dayo's own catalog (`menu-<code>`/`item-*`), not the old plan-3
 * `product-<code>`/`size-<code>`/`sweet-<code>`/`add-to-cart` — `size`/`sweet` are the catalog's own codes
 * (e.g. "20 oz", "100%"), never a fixed local one (ADR-0054).
 */
export async function addItem(page: Page, menuCode: string, opts: { size?: string; sweet?: string; milk?: string; grade?: string } = {}): Promise<void> {
  await page.getByTestId(`menu-${menuCode}`).click()
  if (opts.size !== undefined) await page.getByTestId(`item-size-${opts.size.replace(/\s+/g, '').toLowerCase()}`).click()
  if (opts.sweet !== undefined) await page.getByTestId(`item-sweet-${opts.sweet}`).click()
  if (opts.milk !== undefined) await page.getByTestId(`item-milk-${opts.milk}`).click()
  if (opts.grade !== undefined) await page.getByTestId(`item-grade-${opts.grade}`).click()
  await page.getByTestId('item-add').click()
}

/** Adds one item and pays, cash or QR — returns the receipt number shown on the done screen. */
export async function sellOne(page: Page, code: string, payment: 'cash' | 'qr'): Promise<string> {
  await addItem(page, code)
  if (payment === 'cash') {
    await page.getByTestId('pay-cash').click()
    await page.getByTestId('tender-exact').click()
    await page.getByTestId('confirm-cash').click()
  } else {
    await page.getByTestId('pay-qr').click()
    await page.getByTestId('qr-received').click()
  }
  const receipt = await page.getByTestId('done-receipt').textContent()
  await page.getByTestId('done-new-sale').click()
  await expect(page).toHaveURL(/\/sell$/)
  return receipt ?? ''
}

/** /status → "ส่งตอนนี้" — the one manual sync trigger every e2e spec that needs to force a push uses. */
export async function syncNow(page: Page): Promise<void> {
  await page.getByTestId('status-sync-now').click()
}
