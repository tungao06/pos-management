/** 4500 → "฿45" · 4550 → "฿45.50" · integer arithmetic only. */
export function formatBaht(satang: number): string {
  const sign = satang < 0 ? '-' : ''
  const abs = Math.abs(satang)
  const baht = Math.floor(abs / 100).toLocaleString('en-US')
  const rest = abs % 100
  return `${sign}฿${baht}${rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`}`
}

/** Like `formatBaht`, always with 2 decimals — the exact amount of a bill (cart/cash/QR totals, discounts, change):
 * 7000 → "฿70.00" · 10500 → "฿105.00". Integer arithmetic only. */
export function formatBahtFull(satang: number): string {
  const sign = satang < 0 ? '-' : ''
  const abs = Math.abs(satang)
  const baht = Math.floor(abs / 100).toLocaleString('en-US')
  const rest = String(abs % 100).padStart(2, '0')
  return `${sign}฿${baht}.${rest}`
}

/** Like `formatBahtFull`, with a leading '+' on a positive amount (negatives already show their own '-') — display
 * only, no arithmetic: for a difference already computed in `@dayo/domain` (e.g. `centralDiffSatang`), spec §4.3. */
export function formatBahtDiff(satang: number): string {
  return satang > 0 ? `+${formatBahtFull(satang)}` : formatBahtFull(satang)
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

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/**
 * 'YYYY-MM-DD' → "25 ก.ย. 2569" (D101 zWaitingBanner) — day · Thai month short · พ.ศ. (ค.ศ. + 543), no time zone
 * math: a business date is already a plain calendar date, never an instant. Fix round 1 item 11: this feeds the
 * global "ใบปิดกะ … รอออนไลน์" banner on every screen — a business date this cannot parse (a hand-edited row, a
 * shape this device has never seen) must never crash that banner. Returns the raw text unchanged instead.
 */
export function formatThaiDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const y = m[1]!
  const mo = m[2]!
  const d = m[3]!
  const day = Number(d)
  const month = THAI_MONTHS[Number(mo) - 1]
  if (month === undefined) return ymd
  const be = Number(y) + 543
  return `${day} ${month} ${be}`
}
