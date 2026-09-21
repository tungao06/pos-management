import { assertSafeInt, roundDivBig } from '../money.js'
import type { MovementDraft } from './movements.js'

/**
 * Purchase units → use units (spec §3.3 purchase_unit, §4.5): `unitsMilli` is the count in 1/1000 of a purchase unit
 * (3.5 bags → 3_500) and `qtyPerUnitMilli` the use-unit milli in one purchase unit (400 g bag → 400_000).
 * Rounded once, half away from zero, over the exact BigInt product.
 */
export function unitsToUseMilli(unitsMilli: number, qtyPerUnitMilli: number): number {
  assertSafeInt(unitsMilli, 'unitsMilli')
  assertSafeInt(qtyPerUnitMilli, 'qtyPerUnitMilli')
  if (qtyPerUnitMilli <= 0) throw new RangeError('qtyPerUnitMilli must be > 0')
  return Number(roundDivBig(BigInt(unitsMilli) * BigInt(qtyPerUnitMilli), 1_000n))
}

/**
 * Cost per use-unit in usat of a purchase line (spec §4.4, D33): `lineTotalSatang` paid for `qtyUseMilli`.
 * usat = satang × 1,000,000 per use-unit, and qty is in 1/1000 use-unit → usat = satang × 10^9 / qtyUseMilli.
 * A 400 g bag for ฿77 → 19,250,000 usat/g (0.1925 ฿/g) — exactly the Excel "ต้นทุนเฉลี่ย" of RM-TEA-01.
 */
export function purchaseUnitCostUsat(lineTotalSatang: number, qtyUseMilli: number): number {
  assertSafeInt(lineTotalSatang, 'lineTotalSatang')
  assertSafeInt(qtyUseMilli, 'qtyUseMilli')
  if (lineTotalSatang < 0) throw new RangeError('lineTotalSatang must be >= 0')
  if (qtyUseMilli <= 0) throw new RangeError('qtyUseMilli must be > 0')
  const usat = roundDivBig(BigInt(lineTotalSatang) * 1_000_000_000n, BigInt(qtyUseMilli))
  if (usat > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('unit cost out of range — check the quantity')
  return Number(usat)
}

export type PurchaseLineDraft = { itemId: string; qtyUseMilli: number; lineTotalSatang: number }

/**
 * One PURCHASE movement (+qty) per line at the line's own unit cost. The moving average happens when the movements
 * are folded: one bill's lines of the same item count as one receipt in applyInboundGroup (§4.4 · Q4-17 ก · D57).
 */
export function purchaseMovements(lines: readonly PurchaseLineDraft[], purchaseId: string): MovementDraft[] {
  return lines.map((l) => ({
    itemId: l.itemId,
    kind: 'PURCHASE' as const,
    qtyMilli: l.qtyUseMilli,
    unitCostUsat: purchaseUnitCostUsat(l.lineTotalSatang, l.qtyUseMilli),
    refType: 'purchase',
    refId: purchaseId,
  }))
}

/** D47 item 3: warn when a received price differs from the reference price by more than 10% (1,000 bp). */
export const PRICE_JUMP_BP = 1_000

/**
 * |new − ref| / ref in basis points, rounded half up, for display; a zero reference with a non-zero new cost is
 * "infinitely" off. `ref` is the reference price (Q4-15: the last non-zero purchase price, else the standard cost)
 * — not the moving average, which would re-alarm on every receipt after a real price change (I-7).
 */
export function priceDeviationBp(newUsat: number, refUsat: number): number {
  assertSafeInt(newUsat, 'newUsat')
  assertSafeInt(refUsat, 'refUsat')
  if (newUsat < 0 || refUsat < 0) throw new RangeError('costs must be >= 0')
  if (refUsat === 0) return newUsat === 0 ? 0 : Number.MAX_SAFE_INTEGER
  const diff = BigInt(Math.abs(newUsat - refUsat))
  return Number(roundDivBig(diff * 10_000n, BigInt(refUsat)))
}

/**
 * True when |new − ref| / ref is strictly above `limitBp` (exactly 10% is not a jump) — compared exactly, not on
 * the rounded bp. `ref` is the reference price (Q4-15: the last non-zero purchase price, else the standard cost).
 */
export function isPriceJump(newUsat: number, refUsat: number, limitBp: number = PRICE_JUMP_BP): boolean {
  assertSafeInt(newUsat, 'newUsat')
  assertSafeInt(refUsat, 'refUsat')
  assertSafeInt(limitBp, 'limitBp')
  if (newUsat < 0 || refUsat < 0) throw new RangeError('costs must be >= 0')
  return BigInt(Math.abs(newUsat - refUsat)) * 10_000n > BigInt(limitBp) * BigInt(refUsat)
}
