import { describe, expect, it } from 'vitest'
import { cartFromOrderDraft } from '../src/order-draft.js'
import { CartError } from '../src/price-cart.js'
import { POS_CATALOG } from './fixtures/pos-catalog.js'

describe('cartFromOrderDraft (dayo OrderDraft → the tablet cart)', () => {
  it('turns saleDate + saleTime (Bangkok) into sold_at and fills interpreted values', () => {
    const { cart, soldAt } = cartFromOrderDraft({ saleDate: '2026-09-25', saleTime: '14:30', channelCode: '', lines: [{ code: 'Matcha Latte', qty: 1 }] }, POS_CATALOG)
    expect(soldAt).toBe('2026-09-25T07:30:00.000Z')
    expect(cart).toMatchObject({ channelCode: 'store', paymentCode: 'cash', lines: [{ code: 'Matcha Latte', size: '16 oz', sweetness: '100%', milk: 'fresh', grade: 'Excellent', qty: 1 }] })
  })
  it('converts baht discounts at the edge', () => {
    const { cart } = cartFromOrderDraft({ saleDate: '2026-09-25', saleTime: '10:00', channelCode: 'store', lines: [{ code: 'Thai Tea', size: '16 oz', sweetness: '50%', qty: 1, discountBaht: 5.25 }], billDiscountBaht: 10, billDiscountReason: 'x' }, POS_CATALOG)
    expect(cart.lines[0]!.discountSatang).toBe(525)
    expect(cart.billDiscount).toEqual({ kind: 'satang', satang: 1000, reason: 'x' })
  })
  it('refuses baht and percent together (spec §5.3 case 15)', () => {
    expect(() => cartFromOrderDraft({ saleDate: '2026-09-25', saleTime: '10:00', channelCode: 'store', lines: [{ code: 'Thai Tea', qty: 1 }], billDiscountBaht: 5, billDiscountPercent: 10 }, POS_CATALOG)).toThrow(CartError)
  })
  it('refuses a case without saleTime: the tablet always sends the time', () => {
    expect(() => cartFromOrderDraft({ saleDate: '2026-09-25', channelCode: 'store', lines: [{ code: 'Thai Tea', qty: 1 }] }, POS_CATALOG)).toThrow(/NO_SALE_TIME/)
  })
})
