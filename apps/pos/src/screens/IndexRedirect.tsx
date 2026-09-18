import type { JSX } from 'react'
import { useBootstrap } from '../app/queries'
import { TH } from '../ui/th'
import { DbErrorScreen } from './DbErrorScreen'

export function IndexRedirect(): JSX.Element {
  const boot = useBootstrap()
  if (boot.isPending) return <main className="page">{TH.loading}</main>
  if (boot.isError) return <DbErrorScreen error={boot.error} />
  return (
    <main className="page">
      <h1 data-testid="app-name">{TH.appName}</h1>
      <p className="badge">{TH.pendingSync(boot.data.outboxPending)}</p>
    </main>
  )
}
