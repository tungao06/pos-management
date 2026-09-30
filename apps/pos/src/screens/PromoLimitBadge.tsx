import type { JSX } from 'react'
import { TH } from '../ui/th'

/** Q3 = (ก): "จำกัด n ครั้ง" — read-only. The tablet does not count uses (ADR-0072 ข้อ 2), dayo does; this only warns
 * the cashier that a limit exists. Shown for every promotion kind (manual, auto, code) that carries one. */
export function PromoLimitBadge({ id, usageLimitTotal, usageLimitPerDay }: { id: string; usageLimitTotal?: number | null | undefined; usageLimitPerDay?: number | null | undefined }): JSX.Element | null {
  const hasTotal = usageLimitTotal != null
  const hasDay = usageLimitPerDay != null
  if (!hasTotal && !hasDay) return null
  return (
    <span className="chips">
      {hasTotal && (
        <span className="badge" data-testid={`promo-limit-${id}`}>
          {TH.promoLimitInfo(usageLimitTotal, false)}
        </span>
      )}
      {hasDay && (
        <span className="badge" data-testid={`promo-limit-day-${id}`}>
          {TH.promoLimitInfo(usageLimitPerDay, true)}
        </span>
      )}
    </span>
  )
}
