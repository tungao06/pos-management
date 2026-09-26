// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PosOrderCatalog } from '@dayo/domain'
import { CartProvider } from '../app/cart-context'
import type { CartLine, CartState } from '../state/cart'
import { CartPanel } from './CartPanel'
import { DiscountDialog } from './DiscountDialog'

afterEach(() => cleanup())

const FRESH_ID = 'ing-fresh'

function variant(code: string, size: string, price: number) {
  return {
    menuCode: code, menuNameTh: 'ชาไทยเย็น', family: 'ชาไทย', categoryLabel: 'ชา', menuSortOrder: 1,
    size, sweetness: '50%' as const, price, allowOatMilk: true, isMatcha: false,
    recipeLines: [{ ingredientId: FRESH_ID, baseId: null, qty: 150, unit: 'ml' as const }],
  }
}

const CATALOG: PosOrderCatalog = {
  settings: { shopName: 'DA-YO', defaultSize: '16 oz', defaultSweetness: '50%', defaultChannelCode: 'store', defaultMilk: 'fresh', maxQtyPerLine: 99, backdateDays: 7, recentOrdersCount: 5 },
  sizes: [
    { code: '16 oz', label: '16 oz', sortOrder: 0, isActive: true },
    { code: '12 oz', label: '12 oz', sortOrder: 1, isActive: false }, // closed after a catalog change (ADR-0054)
  ],
  variants: [variant('Original', '16 oz', 45), variant('Original', '12 oz', 35)],
  ingredients: { [FRESH_ID]: { id: FRESH_ID, code: 'fresh-milk', name: 'นมสด', useUnit: 'ml' } },
  bases: {},
  milkOptions: [{ code: 'fresh', ingredientId: FRESH_ID, priceAdd: 0, aliases: [] }],
  gradeOptions: [],
  channels: [{ code: 'store', name: 'หน้าร้าน', aliases: [], priceMarkupPct: 0, priceAddBaht: 0, rounding: 'none', feePct: 0, defaultPaymentMethodCode: 'cash' }],
  paymentMethods: [{ code: 'cash', name: 'เงินสด', aliases: [] }],
  promotions: [],
}

const CHANNELS = [{ code: 'store', name: 'หน้าร้าน' }]
const PAYMENTS = { cash: true, qr: true }

const line = (size = '16 oz'): CartLine => ({ key: `Original|${size}|50%|fresh|`, code: 'Original', nameTh: 'ชาไทยเย็น', size, sweetness: '50%', milk: 'fresh', grade: null, qty: 2 })

const twoCups: CartState = { orderId: 'o-1', channelCode: 'store', billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, lines: [line()] }

describe('CartPanel', () => {
  it('shows totals priced by the domain, changes qty and pays', async () => {
    const onPay = vi.fn()
    render(
      <CartProvider initial={twoCups}>
        <CartPanel catalog={CATALOG} channels={CHANNELS} payments={PAYMENTS} maxQtyPerLine={99} onOpenDiscount={() => undefined} onPay={onPay} />
      </CartProvider>,
    )
    expect(await screen.findByTestId('cart-total')).toHaveTextContent('฿90')
    fireEvent.click(screen.getByTestId('cart-inc-0'))
    expect(screen.getByTestId('cart-qty-0').textContent).toBe('3')
    expect(await screen.findByTestId('cart-total')).toHaveTextContent('฿135')
    fireEvent.click(screen.getByTestId('pay-cash'))
    fireEvent.click(screen.getByTestId('pay-qr'))
    expect(onPay.mock.calls).toEqual([['CASH'], ['PROMPTPAY']])
  })

  it('disables paying and discount on an empty cart', () => {
    render(
      <CartProvider initial={{ orderId: 'o', channelCode: 'store', billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, lines: [] }}>
        <CartPanel catalog={CATALOG} channels={CHANNELS} payments={PAYMENTS} maxQtyPerLine={99} onOpenDiscount={() => undefined} onPay={() => undefined} />
      </CartProvider>,
    )
    for (const id of ['pay-cash', 'pay-qr', 'discount-open', 'cart-clear']) expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true)
  })

  it('applies a discount with a reason and rejects one without', async () => {
    render(
      <CartProvider initial={twoCups}>
        <CartPanel catalog={CATALOG} channels={CHANNELS} payments={PAYMENTS} maxQtyPerLine={99} onOpenDiscount={() => undefined} onPay={() => undefined} />
        <DiscountDialog catalog={CATALOG} onClose={() => undefined} />
      </CartProvider>,
    )
    await screen.findByTestId('cart-total')
    fireEvent.change(screen.getByTestId('discount-amount'), { target: { value: '10' } })
    fireEvent.click(screen.getByTestId('discount-apply'))
    expect(screen.getByRole('alert').textContent).toBe('ต้องใส่เหตุผล')
    fireEvent.change(screen.getByTestId('discount-reason'), { target: { value: 'ลูกค้าประจำ' } })
    fireEvent.click(screen.getByTestId('discount-apply'))
    expect(await screen.findByTestId('cart-discount')).toHaveTextContent('−฿10')
    expect(screen.getByTestId('cart-total')).toHaveTextContent('฿80')
  })

  it('a line whose size the catalog closed (ADR-0054) disables pay-cash/pay-qr', async () => {
    const closed: CartState = { ...twoCups, lines: [line('12 oz')] }
    render(
      <CartProvider initial={closed}>
        <CartPanel catalog={CATALOG} channels={CHANNELS} payments={PAYMENTS} maxQtyPerLine={99} onOpenDiscount={() => undefined} onPay={() => undefined} />
      </CartProvider>,
    )
    expect(await screen.findByTestId('cart-error')).toHaveTextContent('ขนาดนี้ปิดขายแล้ว')
    expect((screen.getByTestId('pay-cash') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('pay-qr') as HTMLButtonElement).disabled).toBe(true)
  })
})
