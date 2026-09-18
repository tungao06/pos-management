// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserDto } from '../api/types'
import { IDLE_LOCK_MS, SessionProvider, useSession } from './session'

const USER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }

function Probe(): JSX.Element {
  const { user, signIn } = useSession()
  return (
    <div>
      <span data-testid="who">{user?.displayName ?? 'locked'}</span>
      <button type="button" data-testid="sign-in" onClick={() => signIn(USER)}>
        sign in
      </button>
    </div>
  )
}

/**
 * Time is advanced by moving `performance.now()` directly rather than via `vi.advanceTimersByTime`, so the 15 s
 * poll inside SessionProvider never runs — exactly like a backgrounded tab whose timers are suspended (review I-2).
 * Whether the session locks must then come from the pointerdown/visibilitychange handlers themselves, not the poll.
 */
function mockClock(): { advance: (ms: number) => void } {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  return { advance: (ms: number) => (now += ms) }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SessionProvider idle auto-lock (D50 spec §5, review I-2)', () => {
  it('locks on the very first tap after the idle limit, instead of the tap resetting the timer', () => {
    const clock = mockClock()
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    )
    act(() => screen.getByTestId('sign-in').click())
    expect(screen.getByTestId('who').textContent).toBe('TungAo')
    clock.advance(IDLE_LOCK_MS + 1_000) // well past the limit, but the 15 s poll never ran
    act(() => window.dispatchEvent(new Event('pointerdown')))
    expect(screen.getByTestId('who').textContent).toBe('locked')
  })

  it('locks on visibilitychange when the page becomes visible after a long hide', () => {
    const clock = mockClock()
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    )
    act(() => screen.getByTestId('sign-in').click())
    clock.advance(IDLE_LOCK_MS + 1_000)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(screen.getByTestId('who').textContent).toBe('locked')
  })

  it('does not lock an active session', () => {
    const clock = mockClock()
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    )
    act(() => screen.getByTestId('sign-in').click())
    clock.advance(IDLE_LOCK_MS - 1_000)
    act(() => window.dispatchEvent(new Event('pointerdown')))
    expect(screen.getByTestId('who').textContent).toBe('TungAo')
  })
})
