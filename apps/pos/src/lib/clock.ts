const BANGKOK_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Calendar date (YYYY-MM-DD) in Thailand for an ISO-8601 instant. */
export function bangkokDate(iso: string): string {
  return BANGKOK_DATE.format(new Date(iso))
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDaysToDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
