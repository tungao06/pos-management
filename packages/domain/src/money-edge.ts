/**
 * The ONLY place money crosses between the tablet (integer satang) and dayo's API (baht, numeric(10,2)) — spec 04 §4.2.
 * No business rounding happens here: dayo's pricing code has already rounded (round2 / ceil_baht). `bahtToSatang` in
 * money.ts rounds silently and belongs to packages/excel-import only (a guard test enforces it).
 */
export type MoneyEdgeErrorCode = 'NOT_A_MONEY_VALUE' | 'MORE_THAN_2_DECIMALS' | 'OUT_OF_RANGE'

export class MoneyEdgeError extends Error {
  readonly code: MoneyEdgeErrorCode
  constructor(code: MoneyEdgeErrorCode, value: unknown) {
    super(`${code}: ${String(value)}`)
    this.name = 'MoneyEdgeError'
    this.code = code
  }
}

/** numeric(10,2) ceiling: 99,999,999.99 baht. */
export const EDGE_MAX_SATANG = 9_999_999_999

/** Baht from dayo (≤ 2 decimals) → satang. Removes float noise only; more than 2 decimals is a dayo bug and throws. */
export function edgeBahtToSatang(baht: number): number {
  if (typeof baht !== 'number' || !Number.isFinite(baht) || baht < 0) throw new MoneyEdgeError('NOT_A_MONEY_VALUE', baht)
  const x = baht * 100
  const r = Math.round(x)
  // measured: the worst float error up to the ceiling is 9.54e-7, so this 1e-6 threshold must never be loosened
  if (Math.abs(x - r) > 1e-6) throw new MoneyEdgeError('MORE_THAN_2_DECIMALS', baht)
  if (r > EDGE_MAX_SATANG) throw new MoneyEdgeError('OUT_OF_RANGE', baht)
  return r === 0 ? 0 : r // never -0
}

/** Satang → baht for a request body. JSON.stringify of the result always has ≤ 2 decimals (3550 → 35.5). */
export function edgeSatangToBaht(satang: number): number {
  if (!Number.isSafeInteger(satang)) throw new MoneyEdgeError('NOT_A_MONEY_VALUE', satang)
  if (satang < 0 || satang > EDGE_MAX_SATANG) throw new MoneyEdgeError('OUT_OF_RANGE', satang)
  return satang === 0 ? 0 : satang / 100
}
