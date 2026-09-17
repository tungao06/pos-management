import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { buildCatalog, standardUnitCostUsat, type Bom, type CatalogItem } from '../src/stock/catalog.js'
import { explodeNeeds } from '../src/stock/explode.js'
import { costSatang } from '../src/money.js'

// Thai tea base from the Excel file: 180 g + 120 g tea + 3,300 ml water → 3,000 ml
const items: CatalogItem[] = [
  { id: 'RM-TEA-02', kind: 'raw', isTracked: true, standardCostUsat: 19_000_000 },
  { id: 'RM-TEA-01', kind: 'raw', isTracked: true, standardCostUsat: 19_250_000 },
  { id: 'RM-WTR-02', kind: 'raw', isTracked: false, standardCostUsat: 75_000 },
  { id: 'RM-MLK-02', kind: 'raw', isTracked: true, standardCostUsat: 7_407_407 },
  { id: 'PK-CUP-01', kind: 'raw', isTracked: true, standardCostUsat: 200_000_000 },
  { id: 'PK-LID-01', kind: 'raw', isTracked: true, standardCostUsat: 100_000_000 },
  { id: 'PB-TEA-THAI', kind: 'prepared', isTracked: true, standardCostUsat: 0 },
  { id: 'PB-UNTRACKED', kind: 'prepared', isTracked: false, standardCostUsat: 0 },
  { id: 'PK-SET-16', kind: 'packaging_set', isTracked: false, standardCostUsat: 0 },
]
const boms: Bom[] = [
  { itemId: 'PB-TEA-THAI', yieldMilli: 3_000_000, lines: [{ itemId: 'RM-TEA-02', qtyMilli: 180_000 }, { itemId: 'RM-TEA-01', qtyMilli: 120_000 }, { itemId: 'RM-WTR-02', qtyMilli: 3_300_000 }] },
  { itemId: 'PB-UNTRACKED', yieldMilli: 1_000_000, lines: [{ itemId: 'RM-MLK-02', qtyMilli: 500_000 }, { itemId: 'RM-WTR-02', qtyMilli: 500_000 }] },
  { itemId: 'PK-SET-16', yieldMilli: 1_000, lines: [{ itemId: 'PK-CUP-01', qtyMilli: 1_000 }, { itemId: 'PK-LID-01', qtyMilli: 1_000 }] },
]
const catalog = buildCatalog(items, boms)

describe('standardUnitCostUsat', () => {
  it('returns standard cost for raw items', () => {
    expect(standardUnitCostUsat('RM-TEA-02', catalog)).toBe(19_000_000)
  })
  it('computes Thai tea base cost = 0.019925 baht/ml exactly like the Excel sheet', () => {
    expect(standardUnitCostUsat('PB-TEA-THAI', catalog)).toBe(1_992_500)
  })
  it('computes packaging set cost = 3 baht per set', () => {
    expect(standardUnitCostUsat('PK-SET-16', catalog)).toBe(300_000_000)
  })
  it('throws for unknown item or prepared item without BOM', () => {
    expect(() => standardUnitCostUsat('nope', catalog)).toThrow()
    const c2 = buildCatalog([{ id: 'P', kind: 'prepared', isTracked: true, standardCostUsat: 0 }], [])
    expect(() => standardUnitCostUsat('P', c2)).toThrow()
  })
})

describe('explodeNeeds', () => {
  it('stops at raw and at tracked prepared items', () => {
    const needs = explodeNeeds([{ itemId: 'PB-TEA-THAI', qtyMilli: 130_000 }, { itemId: 'RM-MLK-02', qtyMilli: 46_000 }], 2, catalog)
    expect([...needs.entries()]).toEqual([['PB-TEA-THAI', 260_000], ['RM-MLK-02', 92_000]])
  })
  it('explodes untracked prepared items and packaging sets down to raw', () => {
    const needs = explodeNeeds([{ itemId: 'PB-UNTRACKED', qtyMilli: 200_000 }, { itemId: 'PK-SET-16', qtyMilli: 1_000 }], 1, catalog)
    expect(needs.get('RM-MLK-02')).toBe(100_000)
    expect(needs.get('RM-WTR-02')).toBe(100_000)
    expect(needs.get('PK-CUP-01')).toBe(1_000)
    expect(needs.get('PK-LID-01')).toBe(1_000)
    expect(needs.has('PB-UNTRACKED')).toBe(false)
  })
  it('merges the same raw item reached from different lines', () => {
    const needs = explodeNeeds([{ itemId: 'PB-UNTRACKED', qtyMilli: 1_000_000 }, { itemId: 'RM-WTR-02', qtyMilli: 10_000 }], 1, catalog)
    expect(needs.get('RM-WTR-02')).toBe(510_000)
  })
  it('is linear in the multiplier up to rounding (≤ 1 milli per component)', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 50 }), fc.integer({ min: 1, max: 999_999 }), (k, q) => {
      const one = explodeNeeds([{ itemId: 'PB-UNTRACKED', qtyMilli: q }], 1, catalog)
      const many = explodeNeeds([{ itemId: 'PB-UNTRACKED', qtyMilli: q }], k, catalog)
      for (const [id, n] of many) expect(Math.abs(n - k * (one.get(id) ?? 0))).toBeLessThanOrEqual(k)
    }))
  })
  it('detects cycles', () => {
    const c = buildCatalog(
      [{ id: 'A', kind: 'prepared', isTracked: false, standardCostUsat: 0 }, { id: 'B', kind: 'prepared', isTracked: false, standardCostUsat: 0 }],
      [{ itemId: 'A', yieldMilli: 1000, lines: [{ itemId: 'B', qtyMilli: 1000 }] }, { itemId: 'B', yieldMilli: 1000, lines: [{ itemId: 'A', qtyMilli: 1000 }] }],
    )
    expect(() => explodeNeeds([{ itemId: 'A', qtyMilli: 1000 }], 1, c)).toThrow(/cycle|depth/)
  })
  it('cost of exploded needs at standard cost equals line cost via standardUnitCostUsat (within 1 satang per component)', () => {
    const needs = explodeNeeds([{ itemId: 'PB-UNTRACKED', qtyMilli: 333_000 }], 3, catalog)
    const viaNeeds = [...needs].reduce((a, [id, n]) => a + costSatang(n, standardUnitCostUsat(id, catalog)), 0)
    const viaUnit = costSatang(999_000, standardUnitCostUsat('PB-UNTRACKED', catalog))
    expect(Math.abs(viaNeeds - viaUnit)).toBeLessThanOrEqual(2)
  })
})
