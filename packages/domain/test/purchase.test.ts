import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { costSatang } from '../src/money.js'
import { applyMovement, EMPTY_COST_STATE } from '../src/stock/costing.js'
import { isPriceJump, priceDeviationBp, purchaseMovements, purchaseUnitCostUsat, unitsToUseMilli } from '../src/stock/purchase.js'
import { milliArb, satangArb } from './arb.js'

describe('unitsToUseMilli', () => {
  it('3.5 bags of 400 g = 1,400 g · 2 kg of limes at 250 ml/kg = 500 ml (spec §3.3)', () => {
    expect(unitsToUseMilli(3_500, 400_000)).toBe(1_400_000)
    expect(unitsToUseMilli(2_000, 250_000)).toBe(500_000)
    expect(unitsToUseMilli(1_000, 1_000)).toBe(1_000) // one use unit typed as "use unit" (qtyPerUnit 1,000)
  })
  it('rounds once, half away from zero', () => {
    expect(unitsToUseMilli(1, 1_500)).toBe(2) // 1.5 → 2
    expect(unitsToUseMilli(1, 1_499)).toBe(1)
  })
  it('refuses a non-positive unit size and non-integers', () => {
    expect(() => unitsToUseMilli(1_000, 0)).toThrow(RangeError)
    expect(() => unitsToUseMilli(1.5, 1_000)).toThrow(RangeError)
  })
})

describe('purchaseUnitCostUsat', () => {
  it('a 400 g bag of RM-TEA-01 for ฿77 = 19,250,000 usat/g — the Excel average (D34)', () => {
    expect(purchaseUnitCostUsat(7_700, 400_000)).toBe(19_250_000)
  })
  it('a free line (฿0, e.g. ของแถม) costs 0', () => {
    expect(purchaseUnitCostUsat(0, 400_000)).toBe(0)
  })
  it('refuses a negative total, a non-positive quantity, and a unit cost past the safe-integer range', () => {
    expect(() => purchaseUnitCostUsat(-1, 1_000)).toThrow(RangeError)
    expect(() => purchaseUnitCostUsat(100, 0)).toThrow(RangeError)
    expect(() => purchaseUnitCostUsat(9_007_200, 1)).toThrow(RangeError) // ฿90,072 for 1/1000 g: a typo, not a price
  })
  it('property: pricing the received quantity back at the unit cost gives the paid total within 1 satang', () => {
    fc.assert(
      fc.property(satangArb, milliArb.filter((q) => q >= 1_000), (total, qty) => {
        const back = costSatang(qty, purchaseUnitCostUsat(total, qty))
        expect(Math.abs(back - total)).toBeLessThanOrEqual(1)
      }),
    )
  })
})

describe('purchaseMovements', () => {
  it('one +PURCHASE per line at its own unit cost, referencing the purchase', () => {
    expect(purchaseMovements([{ itemId: 'RM-TEA-01', qtyUseMilli: 800_000, lineTotalSatang: 15_400 }, { itemId: 'RM-MLK-02', qtyUseMilli: 405_000, lineTotalSatang: 3_000 }], 'p1')).toEqual([
      { itemId: 'RM-TEA-01', kind: 'PURCHASE', qtyMilli: 800_000, unitCostUsat: 19_250_000, refType: 'purchase', refId: 'p1' },
      { itemId: 'RM-MLK-02', kind: 'PURCHASE', qtyMilli: 405_000, unitCostUsat: 7_407_407, refType: 'purchase', refId: 'p1' },
    ])
  })
  it('feeds the moving average (spec §4.4): 1 bag at ฿77 on top of 1 bag at ฿80 → ฿78.50 a bag', () => {
    const [first] = purchaseMovements([{ itemId: 'x', qtyUseMilli: 400_000, lineTotalSatang: 8_000 }], 'p1')
    const [second] = purchaseMovements([{ itemId: 'x', qtyUseMilli: 400_000, lineTotalSatang: 7_700 }], 'p2')
    const s = applyMovement(applyMovement(EMPTY_COST_STATE, first!), second!)
    expect(s).toEqual({ onHandMilli: 800_000, avgCostUsat: 19_625_000 })
  })
})

describe('priceDeviationBp / isPriceJump (D47 item 3: more than 10%)', () => {
  it('measures the change against the current cost', () => {
    expect(priceDeviationBp(19_250_000, 19_250_000)).toBe(0)
    expect(priceDeviationBp(21_175_000, 19_250_000)).toBe(1_000) // exactly +10%
    expect(priceDeviationBp(17_325_000, 19_250_000)).toBe(1_000) // exactly −10%
    expect(priceDeviationBp(1, 0)).toBe(Number.MAX_SAFE_INTEGER)
    expect(priceDeviationBp(0, 0)).toBe(0)
  })
  it('exactly 10% is fine; above it is a jump', () => {
    expect(isPriceJump(21_175_000, 19_250_000)).toBe(false)
    expect(isPriceJump(21_175_001, 19_250_000)).toBe(true)
    expect(isPriceJump(17_324_999, 19_250_000)).toBe(true)
    expect(isPriceJump(0, 19_250_000)).toBe(true) // a free line is always worth a second look
  })
})
