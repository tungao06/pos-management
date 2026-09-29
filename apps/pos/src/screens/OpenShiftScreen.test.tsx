// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PosError } from '../api/errors'
import { renderWithApi, type FakeApi } from '../test-utils/render'
import { TH } from '../ui/th'
import { OpenShiftScreen } from './OpenShiftScreen'

afterEach(() => cleanup())

function boot(extra: Record<string, unknown> = {}) {
  return vi.fn(async () => ({
    needsSetup: false,
    device: null,
    users: [{ id: 'u1', displayName: 'TungAo', role: 'owner' }],
    openShift: null,
    countingShift: null,
    zWaiting: [],
    pendingSyncItems: 0,
    lastBackupAt: null,
    backupDue: false,
    ...extra,
  }))
}

describe('OpenShiftScreen (D101 ladder item 5)', () => {
  it('a COUNT_PENDING refusal offers a button straight to the count review', async () => {
    const api: FakeApi = {
      bootstrap: boot(),
      openShift: vi.fn(async () => {
        throw new PosError('COUNT_PENDING', 'a shift of this device is counting')
      }),
    }
    renderWithApi(<OpenShiftScreen />, api)
    await waitFor(() => expect(screen.getByTestId('shift-float')).toBeTruthy())
    fireEvent.change(screen.getByTestId('shift-float'), { target: { value: '500' } })
    fireEvent.click(screen.getByTestId('shift-open'))
    expect(await screen.findByTestId('nav-count-pending')).toHaveTextContent(TH.countPendingGo)
    expect(screen.getByRole('alert').textContent).toBe(TH.errCountPending)
  })
})
