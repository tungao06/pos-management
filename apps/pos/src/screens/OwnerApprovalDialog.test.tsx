// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { UserDto } from '../api/types'
import { TH } from '../ui/th'
import { OwnerApprovalDialog } from './OwnerApprovalDialog'

afterEach(() => cleanup())

const OWNERS: UserDto[] = [{ id: 'o1', displayName: 'เจ้าของ', role: 'owner' }]

/** A parent that owns `error` the way every real caller does — set once a mutation actually rejects. */
function Host({ onError }: { onError: string }): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  return (
    <OwnerApprovalDialog
      title="ทดสอบ"
      owners={OWNERS}
      defaultApproverId="o1"
      busy={false}
      error={error}
      onSubmit={() => setError(onError)}
      onClose={() => undefined}
    />
  )
}

describe('OwnerApprovalDialog (fix round 2, parked Low; widened per security review)', () => {
  // matches SystemStatusScreen's replace-key form: a failed attempt must not sit in the field for a retry.
  it.each([
    ['PIN_WRONG', TH.errPinWrong],
    ['PIN_LOCKED (the 5th wrong try)', TH.errPinLocked],
    ['an unrelated error', 'เครือข่ายขัดข้อง'],
  ])('clears the PIN field once the caller reports %s', async (_label, errorText) => {
    render(<Host onError={errorText} />)
    fireEvent.change(screen.getByTestId('approval-pin'), { target: { value: '9999' } })
    fireEvent.change(screen.getByTestId('approval-reason'), { target: { value: 'เหตุผล' } })
    fireEvent.click(screen.getByTestId('approval-ok'))
    expect(await screen.findByRole('alert')).toHaveTextContent(errorText)
    expect(screen.getByTestId('approval-pin')).toHaveValue('')
  })
})
