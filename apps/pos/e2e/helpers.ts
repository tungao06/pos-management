import { expect, type Page } from '@playwright/test'

export const OWNER = { name: 'TungAo', pin: '1111' } as const
export const OTHER = { name: 'DCm', pin: '2222' } as const
export const PROMPTPAY_ID = '0812345678'

export async function setupDevice(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByTestId('setup-save')).toBeVisible()
  await page.getByTestId('owner-0-pin').fill(OWNER.pin)
  await page.getByTestId('owner-0-pin2').fill(OWNER.pin)
  await page.getByTestId('owner-1-pin').fill(OTHER.pin)
  await page.getByTestId('owner-1-pin2').fill(OTHER.pin)
  await page.getByTestId('setup-promptpay').fill(PROMPTPAY_ID)
  await page.getByTestId('setup-save').click()
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
