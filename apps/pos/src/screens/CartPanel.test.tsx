// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CartProvider } from '../app/cart-context'
import type { CartState } from '../state/cart'
import { CartPanel } from './CartPanel'
import { DiscountDialog } from './DiscountDialog'

afterEach(() => cleanup())

const twoCups: CartState = {
  orderId: 'o-1',
  discount: null,
  lines: [{ key: 'v16|sw50', variantId: 'v16', sweetnessId: 'sw50', productName: 'ชาไทยเย็น', sizeName: '16 oz', sweetnessName: '50%', unitPriceSatang: 4500, qty: 2 }],
}

describe('CartPanel', () => {
  it('shows totals from the domain, changes qty and pays', () => {
    const onPay = vi.fn()
    render(
      <CartProvider initial={twoCups}>
        <CartPanel onPay={onPay} onOpenDiscount={() => undefined} />
      </CartProvider>,
    )
    expect(screen.getByTestId('cart-total').textContent).toBe('฿90')
    fireEvent.click(screen.getByTestId('cart-inc-0'))
    expect(screen.getByTestId('cart-qty-0').textContent).toBe('3')
    expect(screen.getByTestId('cart-total').textContent).toBe('฿135')
    fireEvent.click(screen.getByTestId('pay-cash'))
    fireEvent.click(screen.getByTestId('pay-qr'))
    expect(onPay.mock.calls).toEqual([['CASH'], ['PROMPTPAY']])
  })

  it('disables paying and discount on an empty cart', () => {
    render(
      <CartProvider initial={{ orderId: 'o', lines: [], discount: null }}>
        <CartPanel onPay={() => undefined} onOpenDiscount={() => undefined} />
      </CartProvider>,
    )
    for (const id of ['pay-cash', 'pay-qr', 'discount-open', 'cart-clear']) expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true)
  })

  it('applies a discount with a reason and rejects one without', () => {
    render(
      <CartProvider initial={twoCups}>
        <CartPanel onPay={() => undefined} onOpenDiscount={() => undefined} />
        <DiscountDialog onClose={() => undefined} />
      </CartProvider>,
    )
    fireEvent.change(screen.getByTestId('discount-amount'), { target: { value: '10' } })
    fireEvent.click(screen.getByTestId('discount-apply'))
    expect(screen.getByRole('alert').textContent).toBe('ต้องใส่เหตุผล')
    fireEvent.change(screen.getByTestId('discount-reason'), { target: { value: 'ลูกค้าประจำ' } })
    fireEvent.click(screen.getByTestId('discount-apply'))
    expect(screen.getByTestId('cart-discount').textContent).toBe('−฿10')
    expect(screen.getByTestId('cart-total').textContent).toBe('฿80')
  })
})
