import { Navigate } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import { TH } from '../ui/th'
import { DbErrorScreen } from './DbErrorScreen'

/** Sends the user to the first unfinished step: setup → login → open shift → sell. */
export function IndexRedirect(): JSX.Element {
  const boot = useBootstrap()
  const { user } = useSession()
  // isFetching too (not just isPending): setupShop invalidates the bootstrap query from a route where it has no
  // mounted observer, so the invalidation only marks it stale rather than refetching it inline — without this,
  // the redirect below would run once against the stale (pre-setup) snapshot and bounce back to /setup.
  if (boot.isPending || boot.isFetching) return <main className="page">{TH.loading}</main>
  if (boot.isError) return <DbErrorScreen error={boot.error} />
  if (boot.data.needsSetup) return <Navigate to="/setup" />
  if (user === null) return <Navigate to="/login" />
  if (boot.data.openShift === null) return <Navigate to="/shift/open" />
  return <Navigate to="/sell" />
}
