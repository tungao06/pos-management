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
