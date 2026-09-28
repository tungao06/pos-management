import { describe, expect, it } from 'vitest'
import { formatAppVersion } from './app-version'

describe('formatAppVersion', () => {
  it('joins the semver and short commit with a middle dot', () => {
    expect(formatAppVersion({ version: '0.1.0', commit: 'a1b2c3d', builtAt: '2026-09-29T00:00:00.000Z' })).toBe('v0.1.0 · a1b2c3d')
  })

  it('falls back to "dev" as a plain commit value when git is unavailable — never throws or blanks the line', () => {
    expect(formatAppVersion({ version: '0.1.0', commit: 'dev', builtAt: '2026-09-29T00:00:00.000Z' })).toBe('v0.1.0 · dev')
  })
})
