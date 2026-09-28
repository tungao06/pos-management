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

/** Cost in satang of `qtyMilli` (1/1000 use-unit) at `unitCostUsat` (micro-satang per use-unit). */
export function costSatang(qtyMilli: number, unitCostUsat: number): number {
  assertSafeInt(qtyMilli, 'qtyMilli')
  assertSafeInt(unitCostUsat, 'unitCostUsat')
  return Number(roundDivBig(BigInt(qtyMilli) * BigInt(unitCostUsat), 1_000_000_000n))
}
