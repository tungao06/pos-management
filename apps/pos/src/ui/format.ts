/** 4500 → "฿45" · 4550 → "฿45.50" · integer arithmetic only. */
export function formatBaht(satang: number): string {
  const sign = satang < 0 ? '-' : ''
  const abs = Math.abs(satang)
  const baht = Math.floor(abs / 100).toLocaleString('en-US')
  const rest = abs % 100
  return `${sign}฿${baht}${rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`}`
}

/** "45" → 4500 · "45.5" → 4550 · invalid → null. The only way UI text becomes money. */
export function parseBahtInput(text: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!m) return null
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/** Pieces of one note/coin typed at shift close: "" → 0 · "12" → 12 · anything else (or over 99999) → null. */
export function parseCountInput(text: string): number | null {
  const t = text.trim()
  if (t === '') return 0
  return /^\d{1,5}$/.test(t) ? Number(t) : null
}

/**
 * Plan 4: 1/1000 of a unit → text. 1_400_000 g → "1,400 g" · 16_600 ml → "16.6 ml" · -130_000 → "-130 ml" ·
 * integer arithmetic only (spec §3: quantities are milli-units).
 */
export function formatQty(milli: number, unit: string): string {
  const sign = milli < 0 ? '-' : ''
  const abs = Math.abs(milli)
  const whole = Math.floor(abs / 1000).toLocaleString('en-US')
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '')
  return `${sign}${whole}${frac === '' ? '' : `.${frac}`} ${unit}`
}

/**
 * "3.5" → 3_500 · "12" → 12_000 · "0.125" → 125 — a quantity typed in some unit (bags, ml, cups of a batch) as
 * milli-units; up to 3 decimals and 9,999 units. Anything else → null. The only way UI text becomes a quantity.
 */
export function parseQtyInput(text: string): number | null {
  const m = /^(\d{1,4})(?:\.(\d{1,3}))?$/.exec(text.trim())
  if (!m) return null
  return Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'))
}
