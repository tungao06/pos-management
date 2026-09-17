import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { VAT_OFF, computeTotals, priceFor, type LineInput, type PriceRow } from '../src/pricing.js'
import { qtyArb, satangArb } from './arb.js'

const lineArb = fc.record<LineInput>({ qty: qtyArb, unitPriceSatang: satangArb })

describe('computeTotals', () => {
  it('sums lines and subtracts discount with VAT off', () => {
    const t = computeTotals([{ qty: 2, unitPriceSatang: 4500 }, { qty: 1, unitPriceSatang: 8500 }], 500, VAT_OFF)
    expect(t.lineTotals).toEqual([9000, 8500])
    expect(t.subtotalSatang).toBe(17500)
    expect(t.discountSatang).toBe(500)
    expect(t.totalSatang).toBe(17000)
    expect(t.vatSatang).toBe(0)
    expect(t.lineVatSatang).toEqual([0, 0])
  })
  it('handles an empty cart', () => {
    expect(computeTotals([], 0, VAT_OFF).totalSatang).toBe(0)
  })
  it('computes VAT included in price when enabled (107 baht → 7 baht VAT)', () => {
    const t = computeTotals([{ qty: 1, unitPriceSatang: 10700 }], 0, { enabled: true, rateBp: 700 })
    expect(t.vatSatang).toBe(700)
    expect(t.lineVatSatang).toEqual([700])
    expect(t.totalSatang).toBe(10700)
  })
  it('rejects discount larger than subtotal, qty < 1 and negative prices', () => {
    expect(() => computeTotals([{ qty: 1, unitPriceSatang: 100 }], 101, VAT_OFF)).toThrow(RangeError)
    expect(() => computeTotals([{ qty: 0, unitPriceSatang: 100 }], 0, VAT_OFF)).toThrow(RangeError)
    expect(() => computeTotals([{ qty: 1, unitPriceSatang: -1 }], 0, VAT_OFF)).toThrow(RangeError)
  })
  it('invariant: Σ lineTotals − discount = total, and Σ lineVat = vat', () => {
    fc.assert(fc.property(fc.array(lineArb, { maxLength: 30 }), fc.nat(), fc.boolean(), (lines, d, vatOn) => {
      const subtotal = lines.reduce((a, l) => a + l.qty * l.unitPriceSatang, 0)
      const discount = subtotal === 0 ? 0 : d % (subtotal + 1)
      const t = computeTotals(lines, discount, vatOn ? { enabled: true, rateBp: 700 } : VAT_OFF)
      expect(t.lineTotals.reduce((a, b) => a + b, 0) - t.discountSatang).toBe(t.totalSatang)
      expect(t.lineVatSatang.reduce((a, b) => a + b, 0)).toBe(t.vatSatang)
      expect(t.vatSatang).toBeLessThanOrEqual(t.totalSatang)
    }))
  })
})

describe('priceFor', () => {
  const prices: PriceRow[] = [
    { variantId: 'v1', channelId: 'store', priceSatang: 4500, effectiveFrom: '2026-01-01T00:00:00.000Z' },
    { variantId: 'v1', channelId: 'store', priceSatang: 5000, effectiveFrom: '2026-10-01T00:00:00.000Z' },
    { variantId: 'v1', channelId: 'line', priceSatang: 4800, effectiveFrom: '2026-01-01T00:00:00.000Z' },
  ]
  it('picks the latest price effective at the given time', () => {
    expect(priceFor(prices, 'v1', 'store', '2026-09-17T10:00:00.000Z')?.priceSatang).toBe(4500)
    expect(priceFor(prices, 'v1', 'store', '2026-10-01T00:00:00.000Z')?.priceSatang).toBe(5000)
    expect(priceFor(prices, 'v1', 'line', '2026-09-17T10:00:00.000Z')?.priceSatang).toBe(4800)
  })
  it('returns undefined when nothing is effective yet or variant unknown', () => {
    expect(priceFor(prices, 'v1', 'store', '2025-12-31T23:59:59.000Z')).toBeUndefined()
    expect(priceFor(prices, 'v9', 'store', '2026-09-17T10:00:00.000Z')).toBeUndefined()
  })
})
