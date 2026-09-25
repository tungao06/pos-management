// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithApi } from '../test-utils/render'
import { SetupScreen } from './SetupScreen'

const KEY = `dayo_${'0123456789abcdef'.repeat(4)}`
const probe = { clientName: 'แท็บเล็ตขาย 1', lastReceiptNo: 'B-000311', requiredPrefix: 'B', catalogVersion: 42, owners: [{ id: 'o1', displayName: 'TungAo' }, { id: 'o2', displayName: 'DCm' }], pricingMatches: true }

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
    await waitFor(() => expect(api.connectShop).toHaveBeenCalledWith({ baseUrl: 'https://dayo.example/api/v1', apiKey: KEY, receiptPrefix: 'B', ownerStaffId: 'o1', ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null }))
  })
  it('the key field never echoes the key after saving and is a password field', async () => {
    const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: false, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => probe), connectShop: vi.fn(async () => undefined) }
    renderWithApi(<SetupScreen />, api)
    expect(screen.getByTestId('setup-api-key')).toHaveAttribute('type', 'password')
    expect(screen.getByTestId('setup-api-key')).toHaveAttribute('autocomplete', 'off')
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
})
