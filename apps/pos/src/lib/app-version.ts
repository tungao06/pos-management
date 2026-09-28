/**
 * Deploy version, visible on every screen (owner ask: "ตรวจสอบได้ว่าตอนนี้ใช้ version อะไรอยู่"). The three
 * values below come from `__APP_VERSION__`/`__APP_COMMIT__`/`__APP_BUILD_TIME__`, string-replaced at build time
 * by Vite's `define` (vite.config.ts) — this module never computes them itself, so a unit test can freely
 * import `formatAppVersion` without a build having run.
 */
export interface AppVersionInfo {
  /** `apps/pos/package.json`'s `version` field (semver, e.g. "0.1.0"). */
  version: string
  /** Short git commit hash of the deploy, or "dev" outside a git checkout. */
  commit: string
  /** ISO instant the build ran — format for display with the same Bangkok formatter other sync timestamps use. */
  builtAt: string
}

export const APP_VERSION: AppVersionInfo = {
  version: __APP_VERSION__,
  commit: __APP_COMMIT__,
  builtAt: __APP_BUILD_TIME__,
}

/** "v0.1.0 · a1b2c3d" — short enough for the BrandBar on a 360px phone. */
export function formatAppVersion(info: AppVersionInfo): string {
  return `v${info.version} · ${info.commit}`
}
