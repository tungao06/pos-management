// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PosApi, StaffOptionDto, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { StaffPinDialog } from './StaffPinDialog'

afterEach(() => cleanup())

const STAFF: StaffOptionDto = { id: 'stf-1', displayName: 'Mint', role: 'staff' }
const OWNER: UserDto = { id: 'own-1', displayName: 'TungAo', role: 'owner' }

function mount(overrides: Partial<PosApi> = {}): { api: PosApi; onClose: ReturnType<typeof vi.fn>; onDone: ReturnType<typeof vi.fn>; container: HTMLElement } {
  const onClose = vi.fn()
  const onDone = vi.fn()
  const api = { setStaffPin: vi.fn(async () => ({ id: STAFF.id, displayName: STAFF.displayName, role: STAFF.role })), ...overrides } as unknown as PosApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <StaffPinDialog staff={STAFF} approvers={[OWNER]} onClose={onClose} onDone={onDone} />
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { api, onClose, onDone, container }
}

describe('StaffPinDialog (spec 04 §6.5)', () => {
  it('disables save while the two new PINs do not match', () => {
    mount()
    fireEvent.change(screen.getByTestId('staff-pin-new'), { target: { value: '1234' } })
    fireEvent.change(screen.getByTestId('staff-pin-new2'), { target: { value: '4321' } })
    expect(screen.getByTestId('staff-pin-save')).toBeDisabled()
  })

  it('saves with the chosen approver', async () => {
    const { api, onDone } = mount()
    fireEvent.change(screen.getByTestId('staff-pin-approver'), { target: { value: OWNER.id } })
    fireEvent.change(screen.getByTestId('staff-pin-approver-pin'), { target: { value: '1111' } })
    fireEvent.change(screen.getByTestId('staff-pin-new'), { target: { value: '2468' } })
    fireEvent.change(screen.getByTestId('staff-pin-new2'), { target: { value: '2468' } })
    expect(screen.getByTestId('staff-pin-save')).not.toBeDisabled()
    fireEvent.click(screen.getByTestId('staff-pin-save'))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api.setStaffPin).toHaveBeenCalledWith({ staffId: STAFF.id, pin: '2468', approverUserId: OWNER.id, approverPin: '1111' })
  })

  it('PIN_LOCKED shows the wait time (D50 Q3-21)', async () => {
    const setStaffPin = vi.fn(async () => { throw new Error('PIN_LOCKED: 30') })
    mount({ setStaffPin })
    fireEvent.change(screen.getByTestId('staff-pin-approver-pin'), { target: { value: '1111' } })
    fireEvent.change(screen.getByTestId('staff-pin-new'), { target: { value: '2468' } })
    fireEvent.change(screen.getByTestId('staff-pin-new2'), { target: { value: '2468' } })
    fireEvent.click(screen.getByTestId('staff-pin-save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('ลองใหม่ใน 30 วินาที')
  })

  // M4 (fix round 1): a rejected approval must not leave the approver's PIN sitting in the DOM/state.
  it('clears the approver PIN when setStaffPin refuses it (M4, fix round 1)', async () => {
    const setStaffPin = vi.fn(async () => { throw new Error('PIN_WRONG: nope') })
    mount({ setStaffPin })
    fireEvent.change(screen.getByTestId('staff-pin-approver-pin'), { target: { value: '1111' } })
    fireEvent.change(screen.getByTestId('staff-pin-new'), { target: { value: '2468' } })
    fireEvent.change(screen.getByTestId('staff-pin-new2'), { target: { value: '2468' } })
    fireEvent.click(screen.getByTestId('staff-pin-save'))
    await screen.findByRole('alert')
    expect(screen.getByTestId('staff-pin-approver-pin')).toHaveValue('')
  })

  // SECURITY I1 (fix round 1): type="password" inside a form still gets Chrome's "save password?" prompt even
  // with autocomplete="off" — every PIN here is masked with CSS instead.
  it('every PIN field is masked with CSS text-security, never a native password field', () => {
    const { container } = mount()
    for (const testId of ['staff-pin-approver-pin', 'staff-pin-new', 'staff-pin-new2']) {
      const field = screen.getByTestId(testId)
      expect(field).toHaveAttribute('type', 'text')
      expect(field).toHaveClass('text-mask')
    }
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0)
  })
})
