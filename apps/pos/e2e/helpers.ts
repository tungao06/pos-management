import { expect, type Page } from '@playwright/test'
import { MOCK_API_KEY } from '@dayo/dayo-mock'

export const OWNER = { name: 'TungAo', pin: '1111' } as const
export const OTHER = { name: 'DCm', pin: '2222' } as const
export const PROMPTPAY_ID = '0812345678'
// The receipt prefix used throughout these specs (e.g. "A-000001") — free to choose since the mock's
// client.last_receipt_no is null on a fresh run, so `connectShop` never locks it.
export const RECEIPT_PREFIX = 'A'

/**
 * Task 17: links this (fresh) tablet to the dayo mock server (playwright.config.ts) with its one key, then gives
 * the second dayo owner (DCm) a PIN too, from the login screen, before anyone signs in (spec 04 §6.5) — several
 * e2e specs approve a void with DCm's PIN.
 */
export async function setupDevice(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByTestId('setup-api-key')).toBeVisible()
  await page.getByTestId('setup-api-key').fill(MOCK_API_KEY)
  await page.getByTestId('setup-probe').click()
  await expect(page.getByTestId('setup-client-name')).toBeVisible()
  await page.getByTestId(`setup-owner-${OWNER.name}`).click()
  await page.getByTestId('setup-prefix').fill(RECEIPT_PREFIX)
  await page.getByTestId('setup-pin').fill(OWNER.pin)
  await page.getByTestId('setup-pin2').fill(OWNER.pin)
  await page.getByTestId('setup-promptpay').fill(PROMPTPAY_ID)
  await page.getByTestId('setup-save').click()

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

export async function firstRun(page: Page): Promise<void> {
  await setupDevice(page)
  await login(page)
  await openShift(page)
}

export async function addItem(page: Page, productCode: string, opts: { category?: string; size?: string; sweet?: string } = {}): Promise<void> {
  await page.getByTestId(`tab-${opts.category ?? 'THAI'}`).click()
  await page.getByTestId(`product-${productCode}`).click()
  if (opts.size !== undefined) await page.getByTestId(`size-${opts.size}`).click()
  if (opts.sweet !== undefined) await page.getByTestId(`sweet-${opts.sweet}`).click()
  await page.getByTestId('add-to-cart').click()
}
