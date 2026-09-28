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
function Host({ initialError }: { initialError: string | null }): JSX.Element {
  const [error, setError] = useState(initialError)
  return (
    <OwnerApprovalDialog
      title="ทดสอบ"
      owners={OWNERS}
      defaultApproverId="o1"
      busy={false}
      error={error}
      onSubmit={() => setError(TH.errPinWrong)}
      onClose={() => undefined}
    />
  )
}

describe('OwnerApprovalDialog (fix round 2, parked Low)', () => {
  // matches SystemStatusScreen's replace-key form: a wrong PIN must not sit in the field for a retyped attempt.
  it('clears the PIN field once the caller reports PIN_WRONG', async () => {
    render(<Host initialError={null} />)
    fireEvent.change(screen.getByTestId('approval-pin'), { target: { value: '9999' } })
    fireEvent.change(screen.getByTestId('approval-reason'), { target: { value: 'เหตุผล' } })
    fireEvent.click(screen.getByTestId('approval-ok'))
    expect(await screen.findByRole('alert')).toHaveTextContent(TH.errPinWrong)
    expect(screen.getByTestId('approval-pin')).toHaveValue('')
  })

  it('does not clear the PIN field for an unrelated error', () => {
    render(<Host initialError="เครือข่ายขัดข้อง" />)
    fireEvent.change(screen.getByTestId('approval-pin'), { target: { value: '9999' } })
    expect(screen.getByTestId('approval-pin')).toHaveValue('9999')
  })
})
