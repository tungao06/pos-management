// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrapKey } from '../app/queries'
import { renderWithApi, type FakeApi } from '../test-utils/render'
import { LoginScreen } from './LoginScreen'

afterEach(() => cleanup())

function boot(extra: Record<string, unknown>) {
  return vi.fn(async () => ({
    needsSetup: false,
    device: null,
    users: [{ id: 'o1', displayName: 'TungAo', role: 'owner' }],
    openShift: null,
    pendingSyncItems: 0,
    lastBackupAt: null,
    backupDue: false,
    legacyDevice: false,
    dayoLinked: true,
    dayoBaseUrl: 'https://dayo.example/api/v1',
    staffNeedingPin: [],
    ownerRecovery: false,
    ...extra,
  }))
}

describe('LoginScreen (spec 04 §6.5, §7 ข้อ 5)', () => {
  it('shows staff who still need a PIN, and tapping one opens the PIN dialog', async () => {
    const api: FakeApi = { bootstrap: boot({ staffNeedingPin: [{ id: 'mint', displayName: 'Mint', role: 'staff' }] }) }
    renderWithApi(<LoginScreen />, api)
    expect(await screen.findByTestId('needs-pin-Mint')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('needs-pin-Mint'))
    expect(await screen.findByTestId('staff-pin-save')).toBeInTheDocument()
  })

  it('shows the owner-recovery banner and button only when bootstrap offers it', async () => {
    const { queryClient } = renderWithApi(<LoginScreen />, { bootstrap: boot({ ownerRecovery: false }) })
    await waitFor(() => expect(queryClient.getQueryData(bootstrapKey)).toBeTruthy())
    expect(screen.queryByTestId('owner-recovery')).toBeNull()
    expect(screen.queryByTestId('owner-recovery-banner')).toBeNull()

    cleanup()
    renderWithApi(<LoginScreen />, { bootstrap: boot({ ownerRecovery: true }) })
    expect(await screen.findByTestId('owner-recovery-banner')).toBeInTheDocument()
    expect(screen.getByTestId('owner-recovery')).toBeInTheDocument()
  })
})
