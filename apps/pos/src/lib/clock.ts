const BANGKOK_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
const BANGKOK_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })

/** Calendar date (YYYY-MM-DD) in Thailand for an ISO-8601 instant. */
export function bangkokDate(iso: string): string {
  return BANGKOK_DATE.format(new Date(iso))
}

/** "20260917-100000" (Thai local date and time) for file names. */
export function bangkokStamp(iso: string): string {
  return `${bangkokDate(iso).replaceAll('-', '')}-${BANGKOK_TIME.format(new Date(iso)).replaceAll(':', '')}`
}

/** Q3b-8 · D52: 05:00 Thai time. */
export const STALE_SHIFT_CUTOFF_HOURS = 5

/**
 * Q3b-8 · D52: the open shift is "stale" once the Thai clock, shifted back by `cutoffHours`, is on a later date than the
 * shift's business date — after-midnight sales stay on the same day (spec §4.7) until the cutoff hour.
 */
export function isShiftStale(businessDate: string, nowIso: string, cutoffHours: number = STALE_SHIFT_CUTOFF_HOURS): boolean {
  return bangkokDate(new Date(Date.parse(nowIso) - cutoffHours * 3_600_000).toISOString()) > businessDate
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDaysToDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
