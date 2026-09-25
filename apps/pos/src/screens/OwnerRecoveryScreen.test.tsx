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
  })
})
