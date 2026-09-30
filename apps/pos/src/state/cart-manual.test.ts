import { describe, expect, it } from 'vitest'
import { cartReducer, type CartState } from './cart'

const empty: CartState = { orderId: 'o1', lines: [], channelCode: 'store', billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, manualPromotionIds: [], manualPromotionReason: '' }
const tt = { code: 'Thai Tea', nameTh: 'ชาไทย', size: '16 oz' as const, sweetness: '50%' as const, milk: 'fresh' as const, grade: null }

describe('cart reducer — manual promotion reason (plan 10 T9 fix round 1)', () => {
  const picked = cartReducer(cartReducer(empty, { type: 'add', line: tt, maxQty: 99 }), { type: 'toggleManualPromotion', id: 'm1' })
  it('an emoji straddling position 200 is dropped whole, never cut in half', () => {
    const s = cartReducer(picked, { type: 'setManualReason', text: 'ก'.repeat(199) + '\u{1F600}' })
    expect(s.manualPromotionReason).toBe('ก'.repeat(199))
  })
  it('an emoji that fits inside 200 units is kept', () => {
    const s = cartReducer(picked, { type: 'setManualReason', text: 'ก'.repeat(198) + '\u{1F600}' })
    expect(s.manualPromotionReason.length).toBe(200)
  })
  it('clearManualPromotions drops the ids and the reason', () => {
    const s = cartReducer(cartReducer(picked, { type: 'setManualReason', text: 'x' }), { type: 'clearManualPromotions' })
    expect([s.manualPromotionIds, s.manualPromotionReason]).toEqual([[], ''])
  })
  it('the reason is empty after the last manual promotion is dropped, kept while one is left', () => {
    const s = cartReducer(cartReducer(cartReducer(picked, { type: 'toggleManualPromotion', id: 'm2' }), { type: 'setManualReason', text: 'x' }), { type: 'toggleManualPromotion', id: 'm1' })
    expect(s.manualPromotionReason).toBe('x')
    expect(cartReducer(s, { type: 'toggleManualPromotion', id: 'm2' }).manualPromotionReason).toBe('')
  })
})
