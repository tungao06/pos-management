import type { JSX } from 'react'
import { APP_VERSION, formatAppVersion } from '../lib/app-version'
import { TH } from './th'

/** Shop-signage header (D44): Deep Forest bar, cream text, reversed logo without slogan, orange/forest wave (D50 Q3-23).
 * `app-version` (fu app-version): a small muted line so the owner can tell which deploy the tablet is running
 * without leaving the sell screen — full detail (build time, whole commit) is on `/status`. */
export function BrandBar(): JSX.Element {
  return (
    <header className="brandbar">
      <div className="bar">
        <img className="logo" src="/brand/logo-header.svg" alt="DA-YO" data-testid="brand-logo" />
        <span className="name">{TH.appName}</span>
        <span className="version" data-testid="app-version">
          {formatAppVersion(APP_VERSION)}
        </span>
      </div>
      <div className="wave" aria-hidden="true" />
    </header>
  )
}
