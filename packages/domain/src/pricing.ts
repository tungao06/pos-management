import { assertSafeInt, roundDiv, splitLargestRemainder } from './money.js'

export type LineInput = { qty: number; unitPriceSatang: number }
export type VatConfig = { enabled: boolean; rateBp: number }
export type Totals = {
  lineTotals: number[]
  subtotalSatang: number
  discountSatang: number
  totalSatang: number
  vatSatang: number
  lineVatSatang: number[]
}
export const VAT_OFF: VatConfig = { enabled: false, rateBp: 0 }

export function computeTotals(lines: LineInput[], discountSatang: number, vat: VatConfig): Totals {
  assertSafeInt(discountSatang, 'discountSatang')
  if (discountSatang < 0) throw new RangeError('discount must be >= 0')
  const lineTotals = lines.map((l, i) => {
    assertSafeInt(l.qty, `lines[${i}].qty`)
    assertSafeInt(l.unitPriceSatang, `lines[${i}].unitPriceSatang`)
    if (l.qty < 1) throw new RangeError(`lines[${i}].qty must be >= 1`)
    if (l.unitPriceSatang < 0) throw new RangeError(`lines[${i}].unitPriceSatang must be >= 0`)
    return l.qty * l.unitPriceSatang
  })
  const subtotalSatang = lineTotals.reduce((a, b) => a + b, 0)
  if (discountSatang > subtotalSatang) throw new RangeError('discount exceeds subtotal')
  const totalSatang = subtotalSatang - discountSatang
  // VAT-inclusive pricing: vat = total × r / (1 + r)
  const vatSatang = vat.enabled && vat.rateBp > 0 ? roundDiv(totalSatang * vat.rateBp, 10_000 + vat.rateBp) : 0
  const lineVatSatang = splitLargestRemainder(vatSatang, lineTotals)
  return { lineTotals, subtotalSatang, discountSatang, totalSatang, vatSatang, lineVatSatang }
}

export type PriceRow = { variantId: string; channelId: string; priceSatang: number; effectiveFrom: string }

/** Latest price row for (variant, channel) whose effectiveFrom <= atIso. ISO-8601 UTC strings compare lexically. */
export function priceFor(prices: readonly PriceRow[], variantId: string, channelId: string, atIso: string): PriceRow | undefined {
  let best: PriceRow | undefined
  for (const p of prices) {
    if (p.variantId !== variantId || p.channelId !== channelId || p.effectiveFrom > atIso) continue
    if (!best || p.effectiveFrom >= best.effectiveFrom) best = p
  }
  return best
}
