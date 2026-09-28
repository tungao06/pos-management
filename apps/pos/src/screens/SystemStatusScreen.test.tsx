// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapState, PosApi, SyncStatusDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { SessionProvider, useSession } from '../app/session'
import { HEALTHY_SYNC } from '../test-utils/sync-status'
import { TH } from '../ui/th'
import { SystemStatusScreen } from './SystemStatusScreen'

afterEach(() => cleanup())

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

function bootWithSync(sync: Partial<SyncStatusDto>, overrides: Partial<BootstrapState> = {}): BootstrapState {
  return {
    needsSetup: false,
    device: { id: 'd1', name: 'แท็บเล็ตหน้าร้าน', receiptPrefix: 'A' },
    users: [{ id: 'owner-1', displayName: 'เจ้าของ', role: 'owner' }],
    openShift: null,
    pendingSyncItems: 0,
    lastBackupAt: null,
    backupDue: false,
    legacyDevice: false,
    dayoLinked: true,
    dayoBaseUrl: 'https://dayo.example/api/v1',
    staffNeedingPin: [],
    ownerRecovery: false,
    sync: { ...HEALTHY_SYNC, ...sync },
    ...overrides,
  }
}

function SignedIn({ user, children }: { user: UserDto; children: JSX.Element }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(user), [signIn, user])
  return children
}

function renderStatus(api: Partial<PosApi>, role: UserDto['role']): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api as PosApi}>
        <SessionProvider>
          <SignedIn user={{ id: role === 'owner' ? 'owner-1' : 'staff-1', displayName: 'ผู้ใช้', role }}>
            <SystemStatusScreen />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
}

describe('SystemStatusScreen (spec §4.3, §6.7, §10.5, §7 ข้อ 1 · D80 — every role reads it)', () => {
  it('shows the clock line, the masked key and sends now on demand', async () => {
    const api = {
      bootstrap: vi.fn(async () => bootWithSync({ clockSkewMs: 7 * 60_000, clockWarning: true, maskedKey: 'dayo_…cdef' })),
      syncNow: vi.fn(async () => ({ catalog: null, push: { requests: 1, sent: 1, rejected: 0, deferred: 0, held: 0, noAnswer: 0, stopped: null } })),
    }
    renderStatus(api, 'staff')
    expect(await screen.findByTestId('status-clock')).toHaveTextContent('7 นาที')
    expect(screen.getByTestId('status-key')).toHaveTextContent('dayo_…cdef')
    expect(screen.queryByTestId('status-replace-key')).toBeNull() // owner only
    fireEvent.click(screen.getByTestId('status-sync-now'))
    await waitFor(() => expect(api.syncNow).toHaveBeenCalled())
  })

  it('pricingCommit: null shows "ไม่ทราบ" (spec §4.4 ข้อ 9 — unknown version is not a problem)', async () => {
    const api = { bootstrap: vi.fn(async () => bootWithSync({ pricingCommit: null, pricingMismatch: false })) }
    renderStatus(api, 'staff')
    expect(await screen.findByTestId('status-pricing')).toHaveTextContent(TH.statusPricingCommitUnknown)
  })

  it('a pricing mismatch shows the mismatch line instead of the unknown-version text', async () => {
    const api = { bootstrap: vi.fn(async () => bootWithSync({ pricingMismatch: true, pricingCommit: null })) }
    renderStatus(api, 'staff')
    expect(await screen.findByTestId('status-pricing')).toHaveTextContent(TH.statusPricingMismatch)
  })

  it('shows the "ตั้งกุญแจใหม่" section to the owner only, and lets them probe a new key', async () => {
    const probeDayo = vi.fn(async () => ({ clientName: 'DA-YO', lastReceiptNo: null, requiredPrefix: null, catalogVersion: 42, owners: [{ id: 'owner-1', displayName: 'เจ้าของ' }], pricingMatches: true }))
    const api = { bootstrap: vi.fn(async () => bootWithSync({})), probeDayo }
    renderStatus(api, 'owner')
    expect(await screen.findByTestId('status-replace-key')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('setup-api-key'), { target: { value: 'dayo_new_key_0123456789abcdef0123456789abcdef01234567' } })
    fireEvent.click(screen.getByTestId('setup-probe'))
    await waitFor(() => expect(probeDayo).toHaveBeenCalled())
    expect(await screen.findByTestId('status-replace-key-pin')).toBeInTheDocument()
  })

  it('calls replaceApiKey with the owner + PIN once probed and confirmed', async () => {
    const probeDayo = vi.fn(async () => ({ clientName: 'DA-YO', lastReceiptNo: null, requiredPrefix: null, catalogVersion: 42, owners: [{ id: 'owner-1', displayName: 'เจ้าของ' }], pricingMatches: true }))
    const replaceApiKey = vi.fn(async () => undefined)
    const api = { bootstrap: vi.fn(async () => bootWithSync({})), probeDayo, replaceApiKey }
    renderStatus(api, 'owner')
    fireEvent.change(await screen.findByTestId('setup-api-key'), { target: { value: 'dayo_new_key_0123456789abcdef0123456789abcdef01234567' } })
    fireEvent.click(screen.getByTestId('setup-probe'))
    fireEvent.change(await screen.findByTestId('status-replace-key-pin'), { target: { value: '1234' } })
    fireEvent.click(screen.getByTestId('status-replace-key-save'))
    await waitFor(() =>
      expect(replaceApiKey).toHaveBeenCalledWith({
        baseUrl: 'https://dayo.example/api/v1',
        apiKey: 'dayo_new_key_0123456789abcdef0123456789abcdef01234567',
        approverUserId: 'owner-1',
        approverPin: '1234',
      }),
    )
  })

  // SECURITY (fix round 2, parked Low): a manager must never even see the section that swaps the shop's key.
  it('does not show the "ตั้งกุญแจใหม่" section to a manager', async () => {
    const api = { bootstrap: vi.fn(async () => bootWithSync({})) }
    renderStatus(api, 'manager')
    await screen.findByTestId('status-key')
    expect(screen.queryByTestId('status-replace-key')).toBeNull()
  })

  // SECURITY (fix round 2, parked Low): a blank or malformed PIN must never reach the API — every failed attempt
  // burns one of the login-lockout attempts, so this has to be caught before `replace.mutate()` is ever called.
  it('never calls replaceApiKey with a blank PIN — it is rejected locally first', async () => {
    const probeDayo = vi.fn(async () => ({ clientName: 'DA-YO', lastReceiptNo: null, requiredPrefix: null, catalogVersion: 42, owners: [{ id: 'owner-1', displayName: 'เจ้าของ' }], pricingMatches: true }))
    const replaceApiKey = vi.fn(async () => undefined)
    const api = { bootstrap: vi.fn(async () => bootWithSync({})), probeDayo, replaceApiKey }
    renderStatus(api, 'owner')
    fireEvent.change(await screen.findByTestId('setup-api-key'), { target: { value: 'dayo_new_key_0123456789abcdef0123456789abcdef01234567' } })
    fireEvent.click(screen.getByTestId('setup-probe'))
    await screen.findByTestId('status-replace-key-pin')
    fireEvent.click(screen.getByTestId('status-replace-key-save'))
    expect(await screen.findByRole('alert')).toHaveTextContent(TH.errPinFormat)
    expect(replaceApiKey).not.toHaveBeenCalled()
  })

  it('never calls replaceApiKey with a malformed PIN — it is rejected locally first', async () => {
    const probeDayo = vi.fn(async () => ({ clientName: 'DA-YO', lastReceiptNo: null, requiredPrefix: null, catalogVersion: 42, owners: [{ id: 'owner-1', displayName: 'เจ้าของ' }], pricingMatches: true }))
    const replaceApiKey = vi.fn(async () => undefined)
    const api = { bootstrap: vi.fn(async () => bootWithSync({})), probeDayo, replaceApiKey }
    renderStatus(api, 'owner')
    fireEvent.change(await screen.findByTestId('setup-api-key'), { target: { value: 'dayo_new_key_0123456789abcdef0123456789abcdef01234567' } })
    fireEvent.click(screen.getByTestId('setup-probe'))
    fireEvent.change(await screen.findByTestId('status-replace-key-pin'), { target: { value: 'ab' } })
    fireEvent.click(screen.getByTestId('status-replace-key-save'))
    expect(await screen.findByRole('alert')).toHaveTextContent(TH.errPinFormat)
    expect(replaceApiKey).not.toHaveBeenCalled()
  })
})
