import { useState, type JSX } from 'react'

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export function PinPad({ onSubmit, busy, error }: { onSubmit: (pin: string) => void; busy: boolean; error: string | null }): JSX.Element {
  const [pin, setPin] = useState('')
  const press = (d: string): void => setPin((p) => (p.length < 6 ? p + d : p))
  return (
    <div className="pinpad">
      <div className="pin-dots" data-testid="pin-dots">
        {'●'.repeat(pin.length)}
      </div>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="pin-grid">
        {DIGITS.map((d) => (
          <button key={d} type="button" data-testid={`pin-${d}`} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" data-testid="pin-clear" onClick={() => setPin('')}>
          C
        </button>
        <button type="button" data-testid="pin-0" onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          className="primary"
          data-testid="pin-ok"
          disabled={busy || pin.length < 4}
          onClick={() => {
            onSubmit(pin)
            setPin('')
          }}
        >
          OK
        </button>
      </div>
    </div>
  )
}
