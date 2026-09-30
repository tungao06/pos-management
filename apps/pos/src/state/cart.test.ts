import { describe, expect, it } from 'vitest'
import { cartReducer, toCartDraft, type CartState } from './cart'

const empty: CartState = { orderId: 'o1', lines: [], channelCode: 'store', billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, manualPromotionIds: [], manualPromotionReason: '' }
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

describe('cart reducer (plan 10 T9 — manual promotions)', () => {
  const withLine = cartReducer(empty, { type: 'add', line: tt, maxQty: 99 })
  it('toggles a manual promotion on and off, in the order picked', () => {
    let s = cartReducer(withLine, { type: 'toggleManualPromotion', id: 'm1' })
    s = cartReducer(s, { type: 'toggleManualPromotion', id: 'm2' })
    expect(s.manualPromotionIds).toEqual(['m1', 'm2'])
    s = cartReducer(s, { type: 'toggleManualPromotion', id: 'm1' })
    expect(s.manualPromotionIds).toEqual(['m2'])
  })
  it('clears the reason when the last manual promotion is removed', () => {
    let s = cartReducer(withLine, { type: 'toggleManualPromotion', id: 'm1' })
    s = cartReducer(s, { type: 'setManualReason', text: 'ลูกค้าเจ้าของร้าน' })
    expect(s.manualPromotionReason).toBe('ลูกค้าเจ้าของร้าน')
    s = cartReducer(s, { type: 'toggleManualPromotion', id: 'm1' })
    expect(s.manualPromotionIds).toEqual([])
    expect(s.manualPromotionReason).toBe('')
  })
  it('keeps the reason at 200 UTF-16 units at most', () => {
    const s = cartReducer(cartReducer(withLine, { type: 'toggleManualPromotion', id: 'm1' }), { type: 'setManualReason', text: 'ก'.repeat(250) })
    expect(s.manualPromotionReason.length).toBe(200)
  })
  it('a new bill starts with no manual promotion and no reason', () => {
    let s = cartReducer(withLine, { type: 'toggleManualPromotion', id: 'm1' })
    s = cartReducer(s, { type: 'setManualReason', text: 'x' })
    s = cartReducer(s, { type: 'reset', orderId: 'o2', channelCode: 'store' })
    expect(s.manualPromotionIds).toEqual([])
    expect(s.manualPromotionReason).toBe('')
  })
  it('toCartDraft sends the ids and the trimWs-cut reason; a blank reason is null', () => {
    let s = cartReducer(withLine, { type: 'toggleManualPromotion', id: 'm1' })
    s = cartReducer(s, { type: 'setManualReason', text: '  ลูกค้าประจำ ' })
    expect(toCartDraft(s)).toMatchObject({ manualPromotionIds: ['m1'], manualPromotionReason: 'ลูกค้าประจำ' })
    s = cartReducer(s, { type: 'setManualReason', text: '   ' })
    expect(toCartDraft(s).manualPromotionReason).toBeNull()
  })
})
