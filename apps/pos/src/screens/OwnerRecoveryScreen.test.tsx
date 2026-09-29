// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithApi, type FakeApi } from '../test-utils/render'
import { OwnerRecoveryScreen } from './OwnerRecoveryScreen'

const KEY = `dayo_${'0123456789abcdef'.repeat(4)}`
const STORED_URL = 'https://dayo.example/api/v1'

function boot(extra: Record<string, unknown>) {
  return vi.fn(async () => ({
    needsSetup: false,
    device: null,
    users: [],
    openShift: null,
    pendingSyncItems: 0,
    lastBackupAt: null,
    backupDue: false,
    legacyDevice: false,
    dayoLinked: true,
    dayoBaseUrl: STORED_URL,
    staffNeedingPin: [],
    ownerRecovery: true,
    ...extra,
  }))
}

// ruling N2 · controller ruling R1 (security): the address field is filled from the tablet's own stored dayo
// address and locked — recovery (like a key swap) may only ever target the central address already on this device.
describe('OwnerRecoveryScreen (ruling N2 · R1)', () => {
  it('R1: locks the address field to the address already stored on this tablet', async () => {
    renderWithApi(<OwnerRecoveryScreen />, { bootstrap: boot({}) })
    const field = await screen.findByTestId('setup-base-url')
    expect(field).toHaveValue(STORED_URL)
    expect(field).toHaveAttribute('readonly')
  })

  it('R1: with no stored address, tells the owner to set the device up again and offers no save flow', async () => {
    renderWithApi(<OwnerRecoveryScreen />, { bootstrap: boot({ dayoBaseUrl: null }) })
    expect(await screen.findByText('เครื่องนี้ไม่มีที่อยู่ระบบกลางที่บันทึกไว้ — ต้องตั้งเครื่องใหม่')).toBeInTheDocument()
    expect(screen.queryByTestId('setup-base-url')).toBeNull()
    expect(screen.queryByTestId('recovery-save')).toBeNull()
  })

  it('walks the owner through a new key and a PIN for an active dayo owner', async () => {
    const probe = { clientName: 'แท็บเล็ตขาย 1', lastReceiptNo: 'A-000120', requiredPrefix: 'A', catalogVersion: 43, owners: [{ id: 'dcm', displayName: 'DCm' }], pricingMatches: true }
    const api: FakeApi = { bootstrap: boot({}), probeDayo: vi.fn(async () => probe), recoverOwner: vi.fn(async () => undefined) }
    renderWithApi(<OwnerRecoveryScreen />, api)
    expect(await screen.findByText(/เพิกถอนกุญแจเก่า/)).toBeInTheDocument()
    fireEvent.change(await screen.findByTestId('setup-api-key'), { target: { value: KEY } })
    fireEvent.click(screen.getByTestId('setup-probe'))
    fireEvent.click(await screen.findByTestId('recovery-owner-DCm'))
    fireEvent.change(screen.getByTestId('recovery-pin'), { target: { value: '2468' } })
    fireEvent.change(screen.getByTestId('recovery-pin2'), { target: { value: '2468' } })
    fireEvent.click(screen.getByTestId('recovery-save'))
    await waitFor(() => expect(api.recoverOwner).toHaveBeenCalledWith({ baseUrl: STORED_URL, apiKey: KEY, ownerStaffId: 'dcm', ownerPin: '2468' }))
  })

  // M5 (fix round 1): the address field is read-only, but this pins that even a forced DOM change event on it
  // can never leak through to a network call — probeDayo and recoverOwner still get the stored address.
  it('M5: a change event on the locked address field has no effect — probeDayo and recoverOwner still get the stored address', async () => {
    const probe = { clientName: 'แท็บเล็ตขาย 1', lastReceiptNo: null, requiredPrefix: null, catalogVersion: 1, owners: [{ id: 'dcm', displayName: 'DCm' }], pricingMatches: true }
    const api: FakeApi = { bootstrap: boot({}), probeDayo: vi.fn(async () => probe), recoverOwner: vi.fn(async () => undefined) }
    renderWithApi(<OwnerRecoveryScreen />, api)
    const field = await screen.findByTestId('setup-base-url')
    fireEvent.change(field, { target: { value: 'https://evil.example/api/v1' } })
    expect(field).toHaveValue(STORED_URL) // the forced change never reached state
    fireEvent.change(await screen.findByTestId('setup-api-key'), { target: { value: KEY } })
    fireEvent.click(screen.getByTestId('setup-probe'))
    await waitFor(() => expect(api.probeDayo).toHaveBeenCalledWith({ baseUrl: STORED_URL, apiKey: KEY }))
    fireEvent.click(await screen.findByTestId('recovery-owner-DCm'))
    fireEvent.change(screen.getByTestId('recovery-pin'), { target: { value: '2468' } })
    fireEvent.change(screen.getByTestId('recovery-pin2'), { target: { value: '2468' } })
    fireEvent.click(screen.getByTestId('recovery-save'))
    await waitFor(() => expect(api.recoverOwner).toHaveBeenCalledWith({ baseUrl: STORED_URL, apiKey: KEY, ownerStaffId: 'dcm', ownerPin: '2468' }))
  })

  // SECURITY I1 (fix round 1)
  it('every PIN and the key field are masked with CSS text-security, never native password fields', async () => {
    const probe = { clientName: 'แท็บเล็ตขาย 1', lastReceiptNo: null, requiredPrefix: null, catalogVersion: 1, owners: [{ id: 'dcm', displayName: 'DCm' }], pricingMatches: true }
    const api: FakeApi = { bootstrap: boot({}), probeDayo: vi.fn(async () => probe), recoverOwner: vi.fn(async () => undefined) }
    const { container } = renderWithApi(<OwnerRecoveryScreen />, api)
    fireEvent.change(await screen.findByTestId('setup-api-key'), { target: { value: KEY } })
    expect(screen.getByTestId('setup-api-key')).toHaveClass('text-mask')
    fireEvent.click(screen.getByTestId('setup-probe'))
    fireEvent.click(await screen.findByTestId('recovery-owner-DCm'))
    for (const testId of ['recovery-pin', 'recovery-pin2']) expect(screen.getByTestId(testId)).toHaveClass('text-mask')
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0)
  })

  // Task 14 · carried items 8/9 (Task 16): a link to /status for an owner who already has a working PIN and only
  // needs `keepShiftLocal`/`skipCountFloor` — never a duplicate PIN flow on this no-PIN-works screen.
  it('links to /status for shift/Z problems that do not need a new key (carried items 8/9)', async () => {
    renderWithApi(<OwnerRecoveryScreen />, { bootstrap: boot({}) })
    expect(await screen.findByTestId('owner-recovery-status-link')).toBeVisible()
  })

  it('says to revoke the old key when dayo still accepts it', async () => {
    const api: FakeApi = {
      bootstrap: boot({}),
      probeDayo: vi.fn(async () => ({ clientName: 'x', lastReceiptNo: null, requiredPrefix: null, catalogVersion: 1, owners: [{ id: 'dcm', displayName: 'DCm' }], pricingMatches: true })),
      recoverOwner: vi.fn(async () => { throw new Error('OLD_KEY_STILL_ACTIVE: revoke') }),
    }
    renderWithApi(<OwnerRecoveryScreen />, api)
    fireEvent.change(await screen.findByTestId('setup-api-key'), { target: { value: KEY } })
    fireEvent.click(screen.getByTestId('setup-probe'))
    fireEvent.click(await screen.findByTestId('recovery-owner-DCm'))
    fireEvent.change(screen.getByTestId('recovery-pin'), { target: { value: '2468' } })
    fireEvent.change(screen.getByTestId('recovery-pin2'), { target: { value: '2468' } })
    fireEvent.click(screen.getByTestId('recovery-save'))
    expect(await screen.findByText('ยังไม่ได้เพิกถอนกุญแจเก่าบนเว็บ — เพิกถอนก่อนแล้วกดอีกครั้ง')).toBeInTheDocument()
    // fix round 3 item 4 (security): matches SetupScreen/SystemStatusScreen — a refused attempt must not leave
    // the PIN sitting in the field.
    expect(screen.getByTestId('recovery-pin')).toHaveValue('')
    expect(screen.getByTestId('recovery-pin2')).toHaveValue('')
  })
})
