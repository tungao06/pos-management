export const USAT_PER_BAHT = 100_000_000
export const USAT_PER_SATANG = 1_000_000
export const MILLI = 1_000

export function assertSafeInt(n: number, name: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${name} must be a safe integer, got ${n}`)
}

export function bahtToSatang(baht: number): number {
  return Math.round(baht * 100)
}

export function bahtToUsat(baht: number): number {
  return Math.round(baht * USAT_PER_BAHT)
}

/** Integer division rounding half away from zero. */
export function roundDivBig(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError('division by zero')
  const negative = (num < 0n) !== (den < 0n)
  const a = num < 0n ? -num : num
  const b = den < 0n ? -den : den
  const q = (2n * a + b) / (2n * b)
  return negative ? -q : q
}

export function roundDiv(num: number, den: number): number {
  assertSafeInt(num, 'num')
  assertSafeInt(den, 'den')
  return Number(roundDivBig(BigInt(num), BigInt(den)))
}

/** Cost in satang of `qtyMilli` (1/1000 use-unit) at `unitCostUsat` (micro-satang per use-unit). */
export function costSatang(qtyMilli: number, unitCostUsat: number): number {
  assertSafeInt(qtyMilli, 'qtyMilli')
  assertSafeInt(unitCostUsat, 'unitCostUsat')
  return Number(roundDivBig(BigInt(qtyMilli) * BigInt(unitCostUsat), 1_000_000_000n))
}

/**
 * Split `total` proportionally to `weights` so that parts sum exactly to `total`.
 * Ties on fractional part go to the earlier index. All-zero weights → everything to index 0.
 */
export function splitLargestRemainder(total: number, weights: number[]): number[] {
  assertSafeInt(total, 'total')
  if (weights.length === 0) return []
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0))
  const floors = weights.map((w) => Math.floor((total * w) / sum))
  let remainder = total - floors.reduce((a, b) => a + b, 0)
  const order = weights
    .map((w, i) => ({ i, frac: (total * w) / sum - Math.floor((total * w) / sum) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (remainder === 0) break
    floors[i] = (floors[i] ?? 0) + 1
    remainder -= 1
  }
  return floors
}
