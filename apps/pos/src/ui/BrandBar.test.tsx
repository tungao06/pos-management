// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { APP_VERSION, formatAppVersion } from '../lib/app-version'
import { BrandBar } from './BrandBar'

afterEach(() => cleanup())

describe('BrandBar (fu app-version)', () => {
  it('shows the short "vX.Y.Z · commit" line so the owner can tell which deploy is running', () => {
    render(<BrandBar />)
    expect(screen.getByTestId('app-version')).toHaveTextContent(formatAppVersion(APP_VERSION))
  })
})
