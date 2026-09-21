import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { EMPTY_COST_STATE, applyInboundGroup, applyMovement, initialCostState, productionMovements, rebuildCostState, scaleQtyMilli } from '../src/stock/costing.js'
import * as domain from '../src/index.js'
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

describe('applyInboundGroup (one document’s same-item inbound lines as one receipt · Q4-17 ก · D57)', () => {
  // RM-TEA-01 at −500 g; one bill: 400 g for ฿77 (19_250_000 usat/g) and 400 g for ฿0
  const paid = { qtyMilli: 400_000, unitCostUsat: 19_250_000 }
  const free = { qtyMilli: 400_000, unitCostUsat: 0 }
  const negative = { onHandMilli: -500_000, avgCostUsat: 19_250_000 }

  it('at on-hand <= 0 the whole bill sets avg = total cost ÷ total qty, whatever the line order', () => {
    // 400_000 × 19_250_000 ÷ 800_000 = 9_625_000 usat/g (฿77 over 800 g)
    expect(applyInboundGroup(negative, [paid, free])).toEqual({ onHandMilli: 300_000, avgCostUsat: 9_625_000 })
    expect(applyInboundGroup(negative, [free, paid])).toEqual({ onHandMilli: 300_000, avgCostUsat: 9_625_000 })
    // folding line by line lets the last line decide (the bug this fixes)
    expect(applyMovement(applyMovement(negative, paid), free).avgCostUsat).toBe(0)
    expect(applyMovement(applyMovement(negative, free), paid).avgCostUsat).toBe(19_250_000)
  })
  it('a single line equals applyMovement, at on-hand <= 0 and > 0', () => {
    fc.assert(fc.property(fc.integer({ min: -5_000_000, max: 5_000_000 }), usatArb, milliArb, usatArb, (onHandMilli, avgCostUsat, qtyMilli, unitCostUsat) => {
      const s = { onHandMilli, avgCostUsat }
      expect(applyInboundGroup(s, [{ qtyMilli, unitCostUsat }])).toEqual(applyMovement(s, { qtyMilli, unitCostUsat }))
    }))
  })
  it('at on-hand > 0 the group is weighted with the state and rounded once', () => {
    const s = { onHandMilli: 1_000, avgCostUsat: 0 }
    const a = { qtyMilli: 1_000, unitCostUsat: 1 }
    const b = { qtyMilli: 1_000, unitCostUsat: 0 }
    // (1_000 × 0 + 1_000 × 1 + 1_000 × 0) ÷ 3_000 = 0.33 → 0; line by line would round 0.5 → 1 first and end at 1
    expect(applyInboundGroup(s, [a, b])).toEqual({ onHandMilli: 3_000, avgCostUsat: 0 })
    expect(applyInboundGroup(s, [b, a])).toEqual({ onHandMilli: 3_000, avgCostUsat: 0 })
    expect(applyMovement(applyMovement(s, a), b).avgCostUsat).toBe(1)
    // 800 g at 0.1925 + two 200 g lines at 0.2 → 0.195 ฿/g
    expect(applyInboundGroup({ onHandMilli: 800_000, avgCostUsat: 19_250_000 }, [{ qtyMilli: 200_000, unitCostUsat: 20_000_000 }, { qtyMilli: 200_000, unitCostUsat: 20_000_000 }])).toEqual({ onHandMilli: 1_200_000, avgCostUsat: 19_500_000 })
  })
  it('line order never matters', () => {
    fc.assert(fc.property(fc.integer({ min: -5_000_000, max: 5_000_000 }), usatArb, fc.array(fc.record({ qtyMilli: milliArb, unitCostUsat: usatArb }), { minLength: 1, maxLength: 10 }), (onHandMilli, avgCostUsat, lines) => {
      const s = { onHandMilli, avgCostUsat }
      expect(applyInboundGroup(s, [...lines].reverse())).toEqual(applyInboundGroup(s, lines))
    }))
  })
  it('an all-฿0 bill at on-hand <= 0 still gives avg 0 (Q4-17 ข not chosen)', () => {
    expect(applyInboundGroup(negative, [free, free])).toEqual({ onHandMilli: 300_000, avgCostUsat: 0 })
    expect(applyInboundGroup(initialCostState(19_250_000), [free, free])).toEqual({ onHandMilli: 800_000, avgCostUsat: 0 })
  })
  it('an empty group returns the state; a non-positive or non-integer line is a RangeError', () => {
    expect(applyInboundGroup(negative, [])).toBe(negative)
    expect(() => applyInboundGroup(negative, [paid, { qtyMilli: 0, unitCostUsat: 1 }])).toThrow(RangeError)
    expect(() => applyInboundGroup(negative, [{ qtyMilli: -1, unitCostUsat: 1 }])).toThrow(RangeError)
    expect(() => applyInboundGroup(negative, [{ qtyMilli: 1.5, unitCostUsat: 1 }])).toThrow(RangeError)
    expect(() => applyInboundGroup(negative, [{ qtyMilli: 1, unitCostUsat: 0.5 }])).toThrow(RangeError)
    expect(() => applyInboundGroup(EMPTY_COST_STATE, [{ qtyMilli: Number.MAX_SAFE_INTEGER, unitCostUsat: 1 }, { qtyMilli: 1, unitCostUsat: 1 }])).toThrow(RangeError)
  })
  it('is exported from the domain index', () => {
    expect(typeof domain.applyInboundGroup).toBe('function')
    expect(domain.applyInboundGroup).toBe(applyInboundGroup)
  })
  it('rebuildCostState applies consecutive positive same-ref movements as one group; no refs keeps the per-movement fold', () => {
    const ref = { refType: 'purchase', refId: 'p1' }
    const sale = { qtyMilli: -500_000, unitCostUsat: 19_250_000, refType: 'order', refId: 'o1' }
    expect(rebuildCostState([sale, { ...paid, ...ref }, { ...free, ...ref }], 19_250_000)).toEqual({ onHandMilli: 300_000, avgCostUsat: 9_625_000 })
    expect(rebuildCostState([sale, { ...free, ...ref }, { ...paid, ...ref }], 19_250_000)).toEqual({ onHandMilli: 300_000, avgCostUsat: 9_625_000 })
    // two different documents are two receipts
    expect(rebuildCostState([sale, { ...paid, ...ref }, { ...free, refType: 'purchase', refId: 'p2' }], 19_250_000)).toEqual({ onHandMilli: 300_000, avgCostUsat: 0 })
    // a movement of another document between two lines ends the run
    expect(rebuildCostState([sale, { ...paid, ...ref }, { qtyMilli: -1_000, unitCostUsat: 0, refType: 'order', refId: 'o2' }, { ...free, ...ref }], 19_250_000)).toEqual({ onHandMilli: 299_000, avgCostUsat: 0 })
    // a non-positive movement of the same document between two lines ends the run too
    expect(rebuildCostState([sale, { ...paid, ...ref }, { qtyMilli: -100_000, unitCostUsat: 19_250_000, ...ref }, { ...free, ...ref }], 19_250_000)).toEqual({ onHandMilli: 200_000, avgCostUsat: 0 })
    expect(rebuildCostState([sale, { ...paid, ...ref }, { qtyMilli: 0, unitCostUsat: 0, ...ref }, { ...free, ...ref }], 19_250_000)).toEqual({ onHandMilli: 300_000, avgCostUsat: 0 })
    // no refs: the old fold
    expect(rebuildCostState([{ qtyMilli: -500_000, unitCostUsat: 0 }, paid, free], 19_250_000)).toEqual({ onHandMilli: 300_000, avgCostUsat: 0 })
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
