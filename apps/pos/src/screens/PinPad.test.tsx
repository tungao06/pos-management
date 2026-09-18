// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PinPad } from './PinPad'

afterEach(() => cleanup())

describe('PinPad', () => {
  it('enables OK only from 4 digits, submits, then clears', () => {
    const onSubmit = vi.fn()
    render(<PinPad busy={false} error={null} onSubmit={onSubmit} />)
    const ok = screen.getByTestId('pin-ok') as HTMLButtonElement
    for (const d of ['1', '2', '3']) fireEvent.click(screen.getByTestId(`pin-${d}`))
    expect(ok.disabled).toBe(true)
    fireEvent.click(screen.getByTestId('pin-4'))
    expect(ok.disabled).toBe(false)
    fireEvent.click(ok)
    expect(onSubmit).toHaveBeenCalledWith('1234')
    expect(screen.getByTestId('pin-dots').textContent).toBe('')
  })

  it('takes at most 6 digits, C clears, and shows the error', () => {
    const onSubmit = vi.fn()
    render(<PinPad busy={false} error="PIN ไม่ถูกต้อง" onSubmit={onSubmit} />)
    for (const d of ['1', '2', '3', '4', '5', '6', '7', '8']) fireEvent.click(screen.getByTestId(`pin-${d}`))
    expect(screen.getByTestId('pin-dots').textContent).toBe('●●●●●●')
    fireEvent.click(screen.getByTestId('pin-clear'))
    expect(screen.getByTestId('pin-dots').textContent).toBe('')
    expect(screen.getByRole('alert').textContent).toBe('PIN ไม่ถูกต้อง')
  })
})
