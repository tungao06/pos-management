import type { JSX } from 'react'
import { TH } from './th'

/** Shop-signage header (D44): Deep Forest bar, cream text, reversed logo without slogan, orange/forest wave (D50 Q3-23). */
export function BrandBar(): JSX.Element {
  return (
    <header className="brandbar">
      <div className="bar">
        <img className="logo" src="/brand/logo-header.svg" alt="DA-YO" data-testid="brand-logo" />
        <span className="name">{TH.appName}</span>
      </div>
      <div className="wave" aria-hidden="true" />
    </header>
  )
}
