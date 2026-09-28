// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PosOrderCatalog } from '@dayo/domain'
import { CartProvider, useCart } from '../app/cart-context'
import type { CartState } from '../state/cart'
import { PromoPanel } from './PromoPanel'

afterEach(() => cleanup())

const CATALOG = {
  promotions: [{ id: 'p1', code: null, name: 'โปรทดสอบ', kind: 'item_discount', requiresCode: false, autoApply: true, priority: 1, stackable: false, isActive: true, params: {} }],
} as unknown as PosOrderCatalog

const BASE: CartState = { orderId: 'o1', channelCode: 'store', billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, lines: [] }

function Probe(): JSX.Element {
  const { state } = useCart()
  return <pre data-testid="probe">{JSON.stringify({ noPromotions: state.noPromotions, promoCode: state.promoCode, skipPromotionIds: state.skipPromotionIds })}</pre>
}

const probe = (): { noPromotions: boolean; promoCode: string | null; skipPromotionIds: string[] } => JSON.parse(screen.getByTestId('probe').textContent ?? '{}')

describe('PromoPanel', () => {
  it('review I6: toggles "ไม่ใช้โปรทั้งบิล" (no-promotions)', () => {
    render(
      <CartProvider initial={BASE}>
        <PromoPanel priced={null} catalog={undefined} />
        <Probe />
      </CartProvider>,
    )
    fireEvent.click(screen.getByTestId('no-promotions'))
    expect(probe().noPromotions).toBe(true)
  })

  it('review I6: promo-code stores the typed code (minor: trimmed, blank → null)', () => {
    render(
      <CartProvider initial={BASE}>
        <PromoPanel priced={null} catalog={undefined} />
        <Probe />
      </CartProvider>,
    )
    fireEvent.change(screen.getByTestId('promo-code'), { target: { value: '  DAYO10  ' } })
    expect(probe().promoCode).toBe('DAYO10')
    fireEvent.change(screen.getByTestId('promo-code'), { target: { value: '   ' } })
    expect(probe().promoCode).toBeNull()
  })

  it('minor: lists a skipped promotion by name with "ใช้โปรนี้" that unskips it', () => {
    render(
      <CartProvider initial={{ ...BASE, skipPromotionIds: ['p1'] }}>
        <PromoPanel priced={null} catalog={CATALOG} />
        <Probe />
      </CartProvider>,
    )
    expect(screen.getByTestId('promo-skipped-p1')).toHaveTextContent('โปรทดสอบ')
    fireEvent.click(screen.getByTestId('promo-unskip-p1'))
    expect(probe().skipPromotionIds).toEqual([])
  })
})
