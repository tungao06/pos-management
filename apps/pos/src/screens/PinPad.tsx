import { useState, type JSX } from 'react'

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/**
 * `okTestId`/`okLabel` (Task 15 — CountReview's "count-confirm", labelled by the online/offline path): the digit
 * grid (`pin-<d>`) is always the same one every screen has used since Task 9 — only the confirm button's testid and
 * label ever change, defaulting to the original `pin-ok`/"OK" so no existing screen is touched. `extraDisabled`
 * combines with the usual `busy || pin.length < 4` (Task 15: a required variance reason typed after the PIN).
 */
export function PinPad({
  onSubmit,
  busy,
  error,
  okTestId = 'pin-ok',
  okLabel = 'OK',
  extraDisabled = false,
}: {
  onSubmit: (pin: string) => void
  busy: boolean
  error: string | null
  okTestId?: string
  okLabel?: string
  extraDisabled?: boolean
}): JSX.Element {
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
          data-testid={okTestId}
          disabled={busy || pin.length < 4 || extraDisabled}
          onClick={() => {
            onSubmit(pin)
            setPin('')
          }}
        >
          {okLabel}
        </button>
      </div>
    </div>
  )
}
