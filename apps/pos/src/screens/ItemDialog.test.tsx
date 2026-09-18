// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MenuDto } from '../api/types'
import { CartProvider, useCart } from '../app/cart-context'
import { ItemDialog } from './ItemDialog'

afterEach(() => cleanup())

const menu: MenuDto = {
  storeChannelId: 'store',
  categories: [{ id: 'c1', code: 'THAI', name: 'ชาไทย' }],
  products: [
    { id: 'p1', code: 'Original', nameTh: 'ชาไทยเย็น', nameEn: 'Original', categoryId: 'c1' },
    { id: 'p2', code: 'NoPrice', nameTh: 'ทดสอบไม่มีราคา', nameEn: 'NoPrice', categoryId: 'c1' },
  ],
  sizes: [
    { id: 'z16', code: '16oz', name: '16 oz' },
    { id: 'z22', code: '22oz', name: '22 oz' },
  ],
  sweetness: [
    { id: 'sw0', code: 'S000', name: '0%', isDefault: false },
    { id: 'sw50', code: 'S050', name: '50%', isDefault: true },
  ],
  variants: [
    { id: 'v16', productId: 'p1', sizeId: 'z16', priceSatang: 4500 },
    { id: 'v22', productId: 'p1', sizeId: 'z22', priceSatang: 5500 },
    { id: 'n16', productId: 'p2', sizeId: 'z16', priceSatang: null },
  ],
  defaultSizeId: 'z16',
  defaultSweetnessId: 'sw50',
  bestSellerProductIds: [],
}

function CartProbe(): JSX.Element {
  const { state } = useCart()
  return <pre data-testid="probe">{JSON.stringify(state.lines)}</pre>
}

describe('ItemDialog', () => {
  it('preselects 16 oz and 50% (spec §5, D27) and adds the chosen size', () => {
    const onClose = vi.fn()
    render(
      <CartProvider>
        <ItemDialog menu={menu} product={menu.products[0]!} onClose={onClose} />
        <CartProbe />
      </CartProvider>,
    )
    expect(screen.getByTestId('size-16oz').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('sweet-S050').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('size-22oz'))
    fireEvent.click(screen.getByTestId('add-to-cart'))
    expect(JSON.parse(screen.getByTestId('probe').textContent ?? '[]')).toEqual([
      { variantId: 'v22', sweetnessId: 'sw50', productName: 'ชาไทยเย็น', sizeName: '22 oz', sweetnessName: '50%', unitPriceSatang: 5500, key: 'v22|sw50', qty: 1 },
    ])
    expect(onClose).toHaveBeenCalled()
  })

  it('cannot add a variant without a price', () => {
    render(
      <CartProvider>
        <ItemDialog menu={menu} product={menu.products[1]!} onClose={() => undefined} />
      </CartProvider>,
    )
    expect((screen.getByTestId('add-to-cart') as HTMLButtonElement).disabled).toBe(true)
  })
})
