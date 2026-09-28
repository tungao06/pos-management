// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PosOrderCatalog } from '@dayo/domain'
import type { SellMenuDto } from '../api/types'
import { CartProvider, useCart } from '../app/cart-context'
import { ItemDialog } from './ItemDialog'

afterEach(() => cleanup())

const FRESH_ID = 'ing-fresh'
const OAT_ID = 'ing-oat'

function variant(size: string, price: number) {
  return {
    menuCode: 'Original', menuNameTh: 'ชาไทยเย็น', family: 'ชาไทย', categoryLabel: 'ชา', menuSortOrder: 1,
    size, sweetness: '50%' as const, price, allowOatMilk: true, isMatcha: false,
    recipeLines: [{ ingredientId: FRESH_ID, baseId: null, qty: 150, unit: 'ml' as const }],
  }
}

// ADR-0054: 3 active sizes in sortOrder, plus one CLOSED size ('12 oz', isActive: false) that must never be offered.
const CATALOG: PosOrderCatalog = {
  settings: { shopName: 'DA-YO', defaultSize: '16 oz', defaultSweetness: '50%', defaultChannelCode: 'store', defaultMilk: 'fresh', maxQtyPerLine: 99, backdateDays: 7, recentOrdersCount: 5 },
  sizes: [
    { code: '16 oz', label: '16 oz', sortOrder: 0, isActive: true },
    { code: '20 oz', label: '20 oz', sortOrder: 1, isActive: true },
    { code: '22 oz', label: '22 oz', sortOrder: 2, isActive: true },
    { code: '12 oz', label: '12 oz', sortOrder: 3, isActive: false },
  ],
  variants: [variant('16 oz', 45), variant('20 oz', 55), variant('22 oz', 65), variant('12 oz', 35)],
  ingredients: { [FRESH_ID]: { id: FRESH_ID, code: 'fresh-milk', name: 'นมสด', useUnit: 'ml' }, [OAT_ID]: { id: OAT_ID, code: 'oat-milk', name: 'นมโอ๊ต', useUnit: 'ml' } },
  bases: {},
  milkOptions: [
    { code: 'fresh', ingredientId: FRESH_ID, priceAdd: 0, aliases: [] },
    { code: 'oat', ingredientId: OAT_ID, priceAdd: 15, aliases: [] },
  ],
  gradeOptions: [],
  channels: [{ code: 'store', name: 'หน้าร้าน', aliases: [], priceMarkupPct: 0, priceAddBaht: 0, rounding: 'none', feePct: 0, defaultPaymentMethodCode: 'cash' }],
  paymentMethods: [{ code: 'cash', name: 'เงินสด', aliases: [] }],
  promotions: [],
}

const MENU: SellMenuDto = {
  code: 'Original',
  nameTh: 'ชาไทยเย็น',
  categoryLabel: 'ชา',
  sortOrder: 1,
  isMatcha: false,
  sizes: ['16 oz', '20 oz', '22 oz'], // never the inactive '12 oz' (ADR-0054, buildMenus)
  sweetnessBySize: { '16 oz': ['50%'], '20 oz': ['50%'], '22 oz': ['50%'] },
  defaultSize: '16 oz',
  defaultSweetness: '50%',
}

function CartProbe(): JSX.Element {
  const { state } = useCart()
  return <pre data-testid="probe">{JSON.stringify(state.lines)}</pre>
}

describe('ItemDialog', () => {
  it('preselects menu.defaultSize/defaultSweetness (ADR-0054) and adds the chosen size', () => {
    const onClose = vi.fn()
    render(
      <CartProvider>
        <ItemDialog catalog={CATALOG} menu={MENU} channelCode="store" maxQtyPerLine={99} onClose={onClose} />
        <CartProbe />
      </CartProvider>,
    )
    expect(screen.getByTestId('item-size-16oz').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('item-sweet-50%').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('item-size-20oz'))
    fireEvent.click(screen.getByTestId('item-add'))
    expect(JSON.parse(screen.getByTestId('probe').textContent ?? '[]')).toEqual([
      { key: 'Original|20 oz|50%|fresh|', code: 'Original', nameTh: 'ชาไทยเย็น', size: '20 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1 },
    ])
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the 3 active sizes in sortOrder and never the closed 12 oz', () => {
    render(
      <CartProvider>
        <ItemDialog catalog={CATALOG} menu={MENU} channelCode="store" maxQtyPerLine={99} onClose={() => undefined} />
      </CartProvider>,
    )
    const buttons = screen.getAllByTestId(/^item-size-/)
    expect(buttons.map((b) => b.textContent)).toEqual(['16 oz', '20 oz', '22 oz'])
    expect(screen.queryByTestId('item-size-12oz')).toBeNull()
  })
})

// review I2: 16 oz offers 50%/100%, 22 oz offers only 100% — switching size must derive a usable sweetness
// synchronously (no useEffect lag) and never throw mid-render.
function sweetVariant(size: string, sweetness: '50%' | '100%', price: number) {
  return {
    menuCode: 'Original', menuNameTh: 'ชาไทยเย็น', family: 'ชาไทย', categoryLabel: 'ชา', menuSortOrder: 1,
    size, sweetness, price, allowOatMilk: false, isMatcha: false,
    recipeLines: [{ ingredientId: FRESH_ID, baseId: null, qty: 150, unit: 'ml' as const }],
  }
}
const SWEET_CATALOG: PosOrderCatalog = {
  ...CATALOG,
  variants: [sweetVariant('16 oz', '50%', 45), sweetVariant('16 oz', '100%', 45), sweetVariant('22 oz', '100%', 65)],
}
const SWEET_MENU: SellMenuDto = {
  ...MENU,
  sizes: ['16 oz', '22 oz'],
  sweetnessBySize: { '16 oz': ['50%', '100%'], '22 oz': ['100%'] },
  defaultSweetness: '50%',
}

describe('ItemDialog — review I2: derived sweetness, never a crash', () => {
  it('picks 50% on 16 oz, switches to 22 oz (only 100%) with no crash', () => {
    expect(() =>
      render(
        <CartProvider>
          <ItemDialog catalog={SWEET_CATALOG} menu={SWEET_MENU} channelCode="store" maxQtyPerLine={99} onClose={() => undefined} />
        </CartProvider>,
      ),
    ).not.toThrow()
    expect(screen.getByTestId('item-sweet-50%').getAttribute('aria-pressed')).toBe('true')
    expect(() => fireEvent.click(screen.getByTestId('item-size-22oz'))).not.toThrow()
    expect(screen.getByTestId('item-sweet-100%').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('item-sweet-50%')).toBeNull()
    expect((screen.getByTestId('item-add') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a refetch that closes the only size open while the dialog is open disables item-add, no crash', () => {
    const { rerender } = render(
      <CartProvider>
        <ItemDialog catalog={CATALOG} menu={MENU} channelCode="store" maxQtyPerLine={99} onClose={() => undefined} />
      </CartProvider>,
    )
    expect((screen.getByTestId('item-add') as HTMLButtonElement).disabled).toBe(false)
    const closed: PosOrderCatalog = { ...CATALOG, sizes: CATALOG.sizes.map((s) => (s.code === '16 oz' ? { ...s, isActive: false } : s)) }
    expect(() =>
      rerender(
        <CartProvider>
          <ItemDialog catalog={closed} menu={MENU} channelCode="store" maxQtyPerLine={99} onClose={() => undefined} />
        </CartProvider>,
      ),
    ).not.toThrow()
    expect(screen.getByTestId('item-unavailable')).toBeInTheDocument()
    expect((screen.getByTestId('item-add') as HTMLButtonElement).disabled).toBe(true)
  })
})
