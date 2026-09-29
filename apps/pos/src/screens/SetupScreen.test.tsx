// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { render as renderBlock3 } from '../test-utils'
import { renderWithApi } from '../test-utils/render'
import { TH } from '../ui/th'
import { user } from './block3-test-fixtures'
import { SetupScreen } from './SetupScreen'

const KEY = `dayo_${'0123456789abcdef'.repeat(4)}`
const probe = { clientName: 'แท็บเล็ตขาย 1', lastReceiptNo: 'B-000311', requiredPrefix: 'B', catalogVersion: 42, owners: [{ id: 'o1', displayName: 'TungAo' }, { id: 'o2', displayName: 'DCm' }], pricingMatches: true, lastZNo: null }

describe('SetupScreen (spec 04 §7 ข้อ 1)', () => {
  it('tests the key with E1, then saves with the chosen owner and the locked prefix', async () => {
    const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: false, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => probe), connectShop: vi.fn(async () => undefined) }
    renderWithApi(<SetupScreen />, api)
    fireEvent.change(screen.getByTestId('setup-base-url'), { target: { value: 'https://dayo.example/api/v1' } })
    fireEvent.change(screen.getByTestId('setup-api-key'), { target: { value: KEY } })
    fireEvent.click(screen.getByTestId('setup-probe'))
    expect(await screen.findByTestId('setup-client-name')).toHaveTextContent('แท็บเล็ตขาย 1')
    expect(screen.getByTestId('setup-prefix')).toHaveValue('B')
    expect(screen.getByTestId('setup-prefix')).toBeDisabled()
    fireEvent.click(screen.getByTestId('setup-owner-TungAo'))
    fireEvent.change(screen.getByTestId('setup-pin'), { target: { value: '1111' } })
    fireEvent.change(screen.getByTestId('setup-pin2'), { target: { value: '1111' } })
    fireEvent.change(screen.getByTestId('setup-promptpay'), { target: { value: '0812345678' } })
    fireEvent.click(screen.getByTestId('setup-save'))
    await waitFor(() => expect(api.connectShop).toHaveBeenCalledWith({ baseUrl: 'https://dayo.example/api/v1', apiKey: KEY, receiptPrefix: 'B', ownerStaffId: 'o1', ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null, confirmedLastZNo: null }))
  })
  // controller ruling SECURITY I1 (fix round 1): Chrome ignores autocomplete=off on type="password" inputs inside
  // a form and offers to save them anyway — which would sync the dayo key and PINs to Google Password Manager.
  // The masking is CSS (`-webkit-text-security`), not the input type, so Chrome never recognizes these as credential
  // fields at all.
  it('the key field is masked with CSS, not a native password field, and never echoes the key after saving', async () => {
    const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: false, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => probe), connectShop: vi.fn(async () => undefined) }
    renderWithApi(<SetupScreen />, api)
    const field = screen.getByTestId('setup-api-key')
    expect(field).toHaveAttribute('type', 'text')
    expect(field).not.toHaveAttribute('type', 'password')
    expect(field).toHaveClass('text-mask')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(field).toHaveAttribute('autocapitalize', 'off')
    expect(field).not.toHaveAttribute('name', 'password')
  })

  it('no input on this screen is type="password" (SECURITY I1)', async () => {
    const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: true, users: [{ id: 'old', displayName: 'TungAo', role: 'owner' }], staffNeedingPin: [] })), probeDayo: vi.fn(async () => probe), connectShop: vi.fn(async () => undefined) }
    const { container } = renderWithApi(<SetupScreen />, api)
    fireEvent.change(screen.getByTestId('setup-api-key'), { target: { value: KEY } })
    fireEvent.click(screen.getByTestId('setup-probe'))
    await screen.findByTestId('setup-client-name')
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0)
  })

  it('lists only owners (not managers/staff) as the old-owner approver of a legacy device (quality review)', async () => {
    const api = {
      bootstrap: vi.fn(async () => ({
        needsSetup: true, legacyDevice: true,
        users: [{ id: 'old-owner', displayName: 'TungAo', role: 'owner' }, { id: 'old-manager', displayName: 'Beam', role: 'manager' }, { id: 'old-staff', displayName: 'Mint', role: 'staff' }],
        staffNeedingPin: [],
      })),
      probeDayo: vi.fn(async () => probe),
      connectShop: vi.fn(async () => undefined),
    }
    renderWithApi(<SetupScreen />, api)
    await screen.findByTestId('setup-legacy-user-TungAo')
    expect(screen.queryByTestId('setup-legacy-user-Beam')).toBeNull()
    expect(screen.queryByTestId('setup-legacy-user-Mint')).toBeNull()
  })

  it('clears the legacy-owner PIN field when connectShop refuses it (M4, fix round 1)', async () => {
    const api = {
      bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: true, users: [{ id: 'old', displayName: 'TungAo', role: 'owner' }], staffNeedingPin: [] })),
      probeDayo: vi.fn(async () => ({ ...probe, requiredPrefix: null, lastReceiptNo: null })),
      connectShop: vi.fn(async () => { throw new Error('PIN_WRONG: nope') }),
    }
    renderWithApi(<SetupScreen />, api)
    fireEvent.change(screen.getByTestId('setup-base-url'), { target: { value: 'https://dayo.example/api/v1' } })
    fireEvent.change(screen.getByTestId('setup-api-key'), { target: { value: KEY } })
    fireEvent.click(screen.getByTestId('setup-probe'))
    await screen.findByTestId('setup-client-name')
    fireEvent.click(await screen.findByTestId('setup-legacy-user-TungAo'))
    fireEvent.change(screen.getByTestId('setup-legacy-pin'), { target: { value: '9999' } })
    fireEvent.click(screen.getByTestId('setup-owner-TungAo'))
    fireEvent.change(screen.getByTestId('setup-prefix'), { target: { value: 'A' } })
    fireEvent.change(screen.getByTestId('setup-pin'), { target: { value: '1111' } })
    fireEvent.change(screen.getByTestId('setup-pin2'), { target: { value: '1111' } })
    fireEvent.change(screen.getByTestId('setup-promptpay'), { target: { value: '0812345678' } })
    fireEvent.click(screen.getByTestId('setup-save'))
    await screen.findByRole('alert')
    expect(screen.getByTestId('setup-legacy-pin')).toHaveValue('')
  })

  // spec §6.9 (quality review): the persist-storage result must actually be seen, not flashed and immediately
  // navigated away from.
  it('shows the persist-storage result and waits for "ไปหน้าขาย" before leaving the screen', async () => {
    const navigator2 = window.navigator as unknown as { storage?: { persist: () => Promise<boolean> } }
    const original = navigator2.storage
    navigator2.storage = { persist: async () => true }
    try {
      const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: false, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => probe), connectShop: vi.fn(async () => undefined) }
      renderWithApi(<SetupScreen />, api)
      fireEvent.change(screen.getByTestId('setup-base-url'), { target: { value: 'https://dayo.example/api/v1' } })
      fireEvent.change(screen.getByTestId('setup-api-key'), { target: { value: KEY } })
      fireEvent.click(screen.getByTestId('setup-probe'))
      await screen.findByTestId('setup-client-name')
      fireEvent.click(screen.getByTestId('setup-owner-TungAo'))
      fireEvent.change(screen.getByTestId('setup-pin'), { target: { value: '1111' } })
      fireEvent.change(screen.getByTestId('setup-pin2'), { target: { value: '1111' } })
      fireEvent.change(screen.getByTestId('setup-promptpay'), { target: { value: '0812345678' } })
      fireEvent.click(screen.getByTestId('setup-save'))
      await waitFor(() => expect(api.connectShop).toHaveBeenCalled())
      expect(await screen.findByTestId('setup-persist-status')).toHaveTextContent('ได้')
      const button = await screen.findByTestId('setup-continue')
      expect(screen.queryByTestId('setup-save')).toBeNull() // the form is gone — nothing left to resubmit
      fireEvent.click(button)
    } finally {
      if (original === undefined) delete navigator2.storage
      else navigator2.storage = original
    }
  })
  it('shows a Thai message for a refused key', async () => {
    const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: false, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => { throw new Error('DAYO_BAD_KEY: key refused') }), connectShop: vi.fn() }
    renderWithApi(<SetupScreen />, api)
    fireEvent.change(screen.getByTestId('setup-api-key'), { target: { value: KEY } })
    fireEvent.click(screen.getByTestId('setup-probe'))
    expect(await screen.findByRole('alert')).toHaveTextContent('กุญแจไม่ถูกต้องหรือถูกยกเลิก')
  })
  it('a pre-block-2 device asks for an old owner PIN (ruling R7)', async () => {
    const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: true, users: [{ id: 'old', displayName: 'TungAo', role: 'owner' }], staffNeedingPin: [] })), probeDayo: vi.fn(async () => ({ ...probe, requiredPrefix: null, lastReceiptNo: null })), connectShop: vi.fn(async () => undefined) }
    renderWithApi(<SetupScreen />, api)
    expect(await screen.findByTestId('setup-legacy-pin')).toBeInTheDocument()
  })

  // Task 16 (ruling R9): the owner checks dayo's own last Z number before this device's next Z continues from it.
  // deviation from task-16-brief.md's literal fillAndProbe: `setup-base-url` is a required field of this form —
  // jsdom's own constraint validation refuses a real "submit" event (userEvent.click on a type="submit" button)
  // while it is empty, so it must be filled before "setup-save" is clicked (the brief's helper omits this).
  async function fillAndProbe(api: Record<string, unknown>) {
    renderBlock3(<SetupScreen />, { api: api as never })
    await user.type(screen.getByTestId('setup-base-url'), 'https://dayo.example/api/v1')
    await user.type(screen.getByTestId('setup-api-key'), KEY)
    await user.click(screen.getByTestId('setup-probe'))
    await screen.findByTestId('setup-client-name')
    await user.click(screen.getByTestId('setup-owner-TungAo'))
    await user.type(screen.getByTestId('setup-prefix'), 'A')
    await user.type(screen.getByTestId('setup-pin'), '1111')
    await user.type(screen.getByTestId('setup-pin2'), '1111')
    await user.type(screen.getByTestId('setup-promptpay'), '0812345678')
  }
  it('shows "Z ล่าสุดในระบบกลาง" and needs the owner\'s tick before saving (R9)', async () => {
    const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: false, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => ({ ...probe, requiredPrefix: null, lastReceiptNo: null, lastZNo: 41 })), connectShop: vi.fn(async () => undefined) }
    await fillAndProbe(api)
    expect(screen.getByTestId('setup-last-z')).toHaveTextContent(TH.setupLastZ(41))
    expect(screen.getByTestId('setup-save')).toBeDisabled()
    await user.click(screen.getByTestId('setup-last-z-confirm'))
    await user.click(screen.getByTestId('setup-save'))
    await waitFor(() => expect(api.connectShop).toHaveBeenCalledWith(expect.objectContaining({ confirmedLastZNo: 41 })))
  })
  it('no Z in dayo: "ยังไม่มี", no tick, confirmedLastZNo: null', async () => {
    const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: false, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => ({ ...probe, requiredPrefix: null, lastReceiptNo: null, lastZNo: null })), connectShop: vi.fn(async () => undefined) }
    await fillAndProbe(api)
    expect(screen.getByTestId('setup-last-z')).toHaveTextContent(TH.setupLastZ(null))
    expect(screen.queryByTestId('setup-last-z-confirm')).toBeNull()
    await user.click(screen.getByTestId('setup-save'))
    await waitFor(() => expect(api.connectShop).toHaveBeenCalledWith(expect.objectContaining({ confirmedLastZNo: null })))
  })
})
