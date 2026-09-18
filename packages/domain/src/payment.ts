import { assertSafeInt } from './money.js'

export function cashChangeSatang(totalSatang: number, tenderedSatang: number): number {
  assertSafeInt(totalSatang, 'totalSatang')
  assertSafeInt(tenderedSatang, 'tenderedSatang')
  if (totalSatang < 0) throw new RangeError('total must be >= 0')
  if (tenderedSatang < totalSatang) throw new RangeError('tendered is less than total')
  return tenderedSatang - totalSatang
}

/** Banknote quick buttons of spec §5 (50 / 100 / 500 / 1000 baht). */
export const QUICK_TENDER_BANKNOTES_SATANG = [5_000, 10_000, 50_000, 100_000] as const

/** Exact amount first, then each banknote strictly above the total. */
export function quickTenderOptions(totalSatang: number): number[] {
  assertSafeInt(totalSatang, 'totalSatang')
  const out = [totalSatang]
  for (const note of QUICK_TENDER_BANKNOTES_SATANG) if (note > totalSatang) out.push(note)
  return out
}
