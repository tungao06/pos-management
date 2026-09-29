import { describe, expect, it } from 'vitest'
import { cartReducer, toCartDraft, type CartState } from './cart'

const empty: CartState = { orderId: 'o1', lines: [], channelCode: 'store', billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false }
const tt = { code: 'Thai Tea', nameTh: 'ชาไทย', size: '16 oz' as const, sweetness: '50%' as const, milk: 'fresh' as const, grade: null }

describe('cart reducer (block 2)', () => {
  it('merges the same drink and options into one line, oat is a different line', () => {
    let s = cartReducer(empty, { type: 'add', line: tt, maxQty: 99 })
    s = cartReducer(s, { type: 'add', line: tt, maxQty: 99 })
    s = cartReducer(s, { type: 'add', line: { ...tt, milk: 'oat' }, maxQty: 99 })
    expect(s.lines.map((l) => [l.milk, l.qty])).toEqual([['fresh', 2], ['oat', 1]])
  })
  it('never goes above maxQtyPerLine (computeOrder would clamp silently)', () => {
    let s = cartReducer(empty, { type: 'add', line: tt, maxQty: 2 })
    s = cartReducer(s, { type: 'inc', key: s.lines[0]!.key, maxQty: 2 })
    s = cartReducer(s, { type: 'inc', key: s.lines[0]!.key, maxQty: 2 })
    expect(s.lines[0]!.qty).toBe(2)
  })
  it('builds the draft the API prices', () => {
    const s = cartReducer(cartReducer(empty, { type: 'add', line: tt, maxQty: 99 }), { type: 'setDiscount', satang: 500, reason: 'ลูกค้าประจำ' })
    expect(toCartDraft(cartReducer(s, { type: 'skipPromotion', id: 'p1' }))).toEqual({
      channelCode: 'store', promoCode: null, skipPromotionIds: ['p1'], noPromotions: false, manualPromotionIds: [], manualPromotionReason: null,
      billDiscount: { kind: 'satang', satang: 500, reason: 'ลูกค้าประจำ' },
      lines: [{ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null }],
    })
  })
})
