import { useEffect } from 'react'
import { useApi } from './api-context'

/** spec §4.6 · O1 pending: the bill-history page and `/central-orders` re-read this tablet's `dayo_edit` display on
 * open and every 5 minutes while open — offline (or any other failure) just keeps the last stored value, never an
 * error on screen (refreshDayoEdits itself never throws OFFLINE to the caller, but this hook stays silent either way). */
const REFRESH_MS = 5 * 60_000

export function useDayoEditsRefresh(onUpdated: () => void): void {
  const api = useApi()
  useEffect(() => {
    let alive = true
    const run = (): void => {
      api
        .refreshDayoEdits()
        .then((r) => {
          if (alive && r.updated > 0) onUpdated()
        })
        .catch(() => {
          /* offline / OFFLINE — keep whatever this tablet already has, no error shown (spec §4.6) */
        })
    }
    run()
    const timer = window.setInterval(run, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])
}
