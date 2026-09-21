import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { EMPTY_COST_STATE, applyMovement, initialCostState, productionMovements, rebuildCostState, scaleQtyMilli } from '../src/stock/costing.js'
import { costSatang } from '../src/money.js'
import type { Bom } from '../src/stock/catalog.js'
import { milliArb, usatArb } from './arb.js'

describe('applyMovement (moving weighted average)', () => {
  it('first purchase sets the average', () => {
    expect(applyMovement(EMPTY_COST_STATE, { qtyMilli: 400_000, unitCostUsat: 19_250_000 })).toEqual({ onHandMilli: 400_000, avgCostUsat: 19_250_000 })
  })
  it('second purchase at a different price is weighted', () => {
    const s1 = applyMovement(EMPTY_COST_STATE, { qtyMilli: 1_000, unitCostUsat: 100 })
    const s2 = applyMovement(s1, { qtyMilli: 3_000, unitCostUsat: 200 })
    expect(s2).toEqual({ onHandMilli: 4_000, avgCostUsat: 175 })
  })
  it('outbound keeps the average and can go negative (spec: never block a sale)', () => {
    const s1 = applyMovement(EMPTY_COST_STATE, { qtyMilli: 1_000, unitCostUsat: 100 })
    const s2 = applyMovement(s1, { qtyMilli: -1_500, unitCostUsat: 100 })
    expect(s2).toEqual({ onHandMilli: -500, avgCostUsat: 100 })
  })
  it('inbound when on hand <= 0 resets the average to the new cost', () => {
    const s = applyMovement({ onHandMilli: -500, avgCostUsat: 100 }, { qtyMilli: 1_000, unitCostUsat: 300 })
    expect(s).toEqual({ onHandMilli: 500, avgCostUsat: 300 })
  })
  it('a SALE before any inbound keeps avg = standard cost (spec §4.4)', () => {
    const s = applyMovement(initialCostState(2_000_000), { qtyMilli: -130_000, unitCostUsat: 0 })
    expect(s).toEqual({ onHandMilli: -130_000, avgCostUsat: 2_000_000 })
  })
  it('after the first PURCHASE, avg becomes the purchase cost, not the standard cost (spec §4.4)', () => {
    const s = applyMovement(initialCostState(2_000_000), { qtyMilli: 1_000, unitCostUsat: 3_000_000 })
    expect(s).toEqual({ onHandMilli: 1_000, avgCostUsat: 3_000_000 })
  })
  it('rebuildCostState starts from the standard cost and a leading SALE keeps it until the first inbound', () => {
    const movements = [
      { qtyMilli: -100_000, unitCostUsat: 0 }, // SALE before any inbound
      { qtyMilli: 400_000, unitCostUsat: 19_250_000 }, // first PURCHASE resets avg
    ]
    expect(rebuildCostState(movements, 2_000_000)).toEqual({ onHandMilli: 300_000, avgCostUsat: 19_250_000 })
  })
  it('initialCostState requires a safe integer', () => {
    expect(() => initialCostState(1.5)).toThrow(RangeError)
  })
  it('average is always between min and max inbound cost and never NaN', () => {
    fc.assert(fc.property(fc.array(fc.record({ qtyMilli: milliArb, unitCostUsat: usatArb }), { minLength: 1, maxLength: 30 }), (ins) => {
      const s = rebuildCostState(ins)
      const costs = ins.map((m) => m.unitCostUsat)
      expect(Number.isSafeInteger(s.avgCostUsat)).toBe(true)
      expect(s.avgCostUsat).toBeGreaterThanOrEqual(Math.min(...costs))
      expect(s.avgCostUsat).toBeLessThanOrEqual(Math.max(...costs))
      expect(s.onHandMilli).toBe(ins.reduce((a, m) => a + m.qtyMilli, 0))
    }))
  })
})

describe('productionMovements', () => {
  const thaiBase: Bom = {
    itemId: 'PB-TEA-THAI',
    yieldMilli: 3_000_000,
    lines: [{ itemId: 'RM-TEA-02', qtyMilli: 180_000 }, { itemId: 'RM-TEA-01', qtyMilli: 120_000 }, { itemId: 'RM-WTR-02', qtyMilli: 3_300_000 }],
  }
  const costOf = (id: string) => ({ 'RM-TEA-02': 19_000_000, 'RM-TEA-01': 19_250_000, 'RM-WTR-02': 75_000 })[id] ?? 0

  it('one standard batch: components out, base in at 0.019925 baht/ml', () => {
    const r = productionMovements(thaiBase, 10_000, 3_000_000, costOf, 'b1')
    expect(r.outs).toEqual([
      { itemId: 'RM-TEA-02', kind: 'PRODUCE_OUT', qtyMilli: -180_000, unitCostUsat: 19_000_000, refType: 'production_batch', refId: 'b1' },
      { itemId: 'RM-TEA-01', kind: 'PRODUCE_OUT', qtyMilli: -120_000, unitCostUsat: 19_250_000, refType: 'production_batch', refId: 'b1' },
      { itemId: 'RM-WTR-02', kind: 'PRODUCE_OUT', qtyMilli: -3_300_000, unitCostUsat: 75_000, refType: 'production_batch', refId: 'b1' },
    ])
    expect(r.inn).toEqual({ itemId: 'PB-TEA-THAI', kind: 'PRODUCE_IN', qtyMilli: 3_000_000, unitCostUsat: 1_992_500, refType: 'production_batch', refId: 'b1' })
    expect(r.batchCostSatang).toBe(5978) // 59.775 baht
  })
  it('scales components by scaleBp (0.2 batch = 600 ml)', () => {
    const r = productionMovements(thaiBase, 2_000, 600_000, costOf, 'b2')
    expect(r.outs.map((m) => m.qtyMilli)).toEqual([-36_000, -24_000, -660_000])
    expect(r.inn.qtyMilli).toBe(600_000)
    expect(r.inn.unitCostUsat).toBe(1_992_500)
  })
  it('lower actual yield raises unit cost (cost is conserved)', () => {
    const r = productionMovements(thaiBase, 10_000, 2_500_000, costOf, 'b3')
    expect(r.inn.unitCostUsat).toBe(2_391_000)
    const outCost = r.outs.reduce((a, m) => a + costSatang(-m.qtyMilli, m.unitCostUsat), 0)
    expect(Math.abs(outCost - costSatang(r.inn.qtyMilli, r.inn.unitCostUsat))).toBeLessThanOrEqual(r.outs.length + 1)
  })
  it('rejects non-positive yield or scale', () => {
    expect(() => productionMovements(thaiBase, 0, 1, costOf, 'b')).toThrow(RangeError)
    expect(() => productionMovements(thaiBase, 10_000, 0, costOf, 'b')).toThrow(RangeError)
  })
})

describe('scaleQtyMilli', () => {
  it('scales by basis points, rounding once (10000 bp = one batch)', () => {
    expect(scaleQtyMilli(3_000_000, 10_000)).toBe(3_000_000)
    expect(scaleQtyMilli(3_000_000, 5_000)).toBe(1_500_000)
    expect(scaleQtyMilli(490_000, 15_000)).toBe(735_000)
    expect(scaleQtyMilli(1, 5_000)).toBe(1) // 0.5 → 1 (half away from zero)
  })
})
