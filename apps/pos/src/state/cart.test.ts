import { describe, expect, it } from 'vitest'
import { cartReducer, cartTotals, emptyCart, toSaleLines, type CartState, type NewCartLine } from './cart'

const line = (variantId: string, sweetnessId = 'sw50', unitPriceSatang = 4500): NewCartLine => ({
  variantId,
  sweetnessId,
  productName: 'ชาไทยเย็น',
  sizeName: '16 oz',
  sweetnessName: '50%',
  unitPriceSatang,
})

function run(state: CartState, ...actions: Parameters<typeof cartReducer>[1][]): CartState {
  return actions.reduce(cartReducer, state)
}

describe('cartReducer', () => {
  it('merges the same variant + sweetness and keeps other sweetness apart (D48 Q3-8)', () => {
    const s = run(emptyCart('o-1'), { type: 'add', line: line('v16') }, { type: 'add', line: line('v16') }, { type: 'add', line: line('v16', 'sw100') })
    expect(s.lines.map((l) => [l.key, l.qty])).toEqual([['v16|sw50', 2], ['v16|sw100', 1]])
    expect(toSaleLines(s)).toEqual([
      { variantId: 'v16', sweetnessId: 'sw50', qty: 2 },
      { variantId: 'v16', sweetnessId: 'sw100', qty: 1 },
    ])
    expect(cartTotals(s)).toMatchObject({ subtotalSatang: 13_500, discountSatang: 0, totalSatang: 13_500, vatSatang: 0 })
  })

  it('inc, dec and remove; dec at 1 removes the line', () => {
    let s = run(emptyCart('o-1'), { type: 'add', line: line('a') }, { type: 'add', line: line('b') })
    s = run(s, { type: 'inc', key: 'a|sw50' }, { type: 'dec', key: 'b|sw50' })
    expect(s.lines.map((l) => [l.key, l.qty])).toEqual([['a|sw50', 2]])
    s = run(s, { type: 'remove', key: 'a|sw50' })
    expect(s.lines).toEqual([])
  })

  it('accepts a discount only with a reason, above zero and not above subtotal (D48 Q3-6)', () => {
    const base = run(emptyCart('o-1'), { type: 'add', line: line('a') })
    expect(cartReducer(base, { type: 'setDiscount', discount: { amountSatang: 500, reason: '  ' } }).discount).toBeNull()
    expect(cartReducer(base, { type: 'setDiscount', discount: { amountSatang: 0, reason: 'x' } }).discount).toBeNull()
    expect(cartReducer(base, { type: 'setDiscount', discount: { amountSatang: 4501, reason: 'x' } }).discount).toBeNull()
    // a bill must stay above 0: payment.amount_satang > 0 is a DB CHECK (D47 item 7) · no 0-baht bills (D50 Q3-20)
    expect(cartReducer(base, { type: 'setDiscount', discount: { amountSatang: 4500, reason: 'x' } }).discount).toBeNull()
    const d = cartReducer(base, { type: 'setDiscount', discount: { amountSatang: 500, reason: ' ลูกค้าประจำ ' } })
    expect(d.discount).toEqual({ amountSatang: 500, reason: 'ลูกค้าประจำ' })
    expect(cartTotals(d).totalSatang).toBe(4000)
    expect(cartReducer(d, { type: 'clearDiscount' }).discount).toBeNull()
  })

  it('drops the discount when removing lines makes it larger than the subtotal', () => {
    let s = run(emptyCart('o-1'), { type: 'add', line: line('a') }, { type: 'add', line: line('b') }, { type: 'setDiscount', discount: { amountSatang: 6000, reason: 'x' } })
    expect(s.discount?.amountSatang).toBe(6000)
    s = cartReducer(s, { type: 'remove', key: 'b|sw50' })
    expect(s.discount).toBeNull()
  })

  it('reprice takes the new unit prices, keeps lines with no new price, and drops a discount the new subtotal no longer covers (D50 Q3-27)', () => {
    let s = run(emptyCart('o-1'), { type: 'add', line: line('a') }, { type: 'add', line: line('b') }, { type: 'setDiscount', discount: { amountSatang: 4000, reason: 'x' } })
    s = cartReducer(s, { type: 'reprice', prices: new Map<string, number | null>([['a', 4900], ['b', null], ['c', 100]]) })
    expect(s.lines.map((l) => [l.key, l.unitPriceSatang, l.qty])).toEqual([['a|sw50', 4900, 1], ['b|sw50', 4500, 1]])
    expect(cartTotals(s).totalSatang).toBe(5400) // 4900 + 4500 − 4000
    const cheaper = cartReducer(s, { type: 'reprice', prices: new Map([['a', 1000], ['b', 1000]]) })
    expect(cheaper.discount).toBeNull() // 4000 ≥ the new subtotal 2000 (D48 Q3-6, D50 Q3-20)
  })

  it('reset starts an empty cart with a new order id', () => {
    const s = run(emptyCart('o-1'), { type: 'add', line: line('a') }, { type: 'reset', orderId: 'o-2' })
    expect(s).toEqual({ orderId: 'o-2', lines: [], discount: null })
  })
})
