import type { JSX } from 'react'
import { TH } from '../ui/th'

export function IndexRedirect(): JSX.Element {
  return (
    <main className="page">
      <h1 data-testid="app-name">{TH.appName}</h1>
    </main>
  )
}
