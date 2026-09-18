import type { JSX } from 'react'
import { TH } from '../ui/th'

export function DbErrorScreen({ error }: { error: unknown }): JSX.Element {
  return (
    <main className="page">
      <h1>{TH.dbError}</h1>
      <p>{TH.dbErrorTwoTabs}</p>
      <pre className="error">{error instanceof Error ? error.message : String(error)}</pre>
      <button type="button" className="primary" onClick={() => window.location.reload()}>
        {TH.retry}
      </button>
    </main>
  )
}
