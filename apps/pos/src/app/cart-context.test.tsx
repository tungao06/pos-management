// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { UserDto } from '../api/types'
import { CartProvider, useCart } from './cart-context'
import { SessionProvider, useSession } from './session'

afterEach(() => cleanup())

const USER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }

/** Mirrors the nesting in providers.tsx: SessionProvider outside CartProvider, so a lock cannot reach the cart. */
function Probe(): JSX.Element {
  const session = useSession()
  const { state, dispatch } = useCart()
  return (
    <div>
      <span data-testid="who">{session.user?.displayName ?? 'locked'}</span>
      <span data-testid="cart-lines">{state.lines.length}</span>
      <button type="button" data-testid="sign-in" onClick={() => session.signIn(USER)}>
        sign in
      </button>
      <button type="button" data-testid="lock" onClick={session.lock}>
        lock
      </button>
      <button
        type="button"
        data-testid="add"
        onClick={() =>
          dispatch({
            type: 'add',
            line: { variantId: 'v1', sweetnessId: 'sw50', productName: 'ชาไทยเย็น', sizeName: '16 oz', sweetnessName: '50%', unitPriceSatang: 4500 },
          })
        }
      >
        add
      </button>
    </div>
  )
}

describe('cart survives auto-lock (D50 Q3-24)', () => {
  it('keeps the cart through SessionProvider.lock() and shows the same cart after re-login', () => {
    render(
      <SessionProvider>
        <CartProvider>
          <Probe />
        </CartProvider>
      </SessionProvider>,
    )
    act(() => screen.getByTestId('sign-in').click())
    act(() => screen.getByTestId('add').click())
    expect(screen.getByTestId('cart-lines').textContent).toBe('1')

    // SessionProvider.lock() clears only the user (session.tsx:57) — the cart lives in a separate context.
    act(() => screen.getByTestId('lock').click())
    expect(screen.getByTestId('who').textContent).toBe('locked')
    expect(screen.getByTestId('cart-lines').textContent).toBe('1')

    act(() => screen.getByTestId('sign-in').click())
    expect(screen.getByTestId('who').textContent).toBe('TungAo')
    expect(screen.getByTestId('cart-lines').textContent).toBe('1')
  })
})
