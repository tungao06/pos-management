// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PosApi, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { SessionProvider, useSession } from '../app/session'
import { PriceDiffScreen } from './PriceDiffScreen'

afterEach(() => cleanup())

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

function SignedIn({ user, children }: { user: UserDto; children: JSX.Element }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(user), [signIn, user])
  return children
}

function renderDiffs(api: Partial<PosApi>, user: UserDto): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api as PosApi}>
        <SessionProvider>
          <SignedIn user={user}>
            <PriceDiffScreen />
          </SignedIn>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
}

describe('PriceDiffScreen (spec §4.3, review item 23 · R11 owner-only)', () => {
  it('shows a difference to the satang and a void-only-on-the-tablet row', async () => {
    const api: Partial<PosApi> = {
      listPriceDiffs: vi.fn(async () => [
        { kind: 'amount' as const, orderId: 'o1', receiptNo: 'A-000001', soldAt: '2026-09-25T03:00:00.000Z', totalSatang: 4_550, computedTotalSatang: 4_500, diffSatang: -50, catalogVersion: 42, amountMismatch: false },
        { kind: 'void_local_only' as const, orderId: 'o2', receiptNo: 'A-000002', soldAt: '2026-09-25T03:05:00.000Z', totalSatang: 4_500, computedTotalSatang: 4_500, diffSatang: 0, catalogVersion: 42, amountMismatch: false },
      ]),
    }
    renderDiffs(api, { id: 'owner-1', displayName: 'เจ้าของ', role: 'owner' })
    expect(await screen.findByTestId('price-diff-A-000001')).toHaveTextContent('-฿0.50')
    expect(screen.getByTestId('price-diff-A-000002')).toHaveTextContent('ยกเลิกในเครื่องเท่านั้น')
    expect(api.listPriceDiffs).toHaveBeenCalledWith('owner-1')
    // mobile audit row 19: each figure says what it is — POS total, dayo's total, the difference
    const row = screen.getByTestId('price-diff-A-000001')
    expect(row).toHaveTextContent('POS ฿45.50')
    expect(row).toHaveTextContent('ระบบกลาง ฿45.00')
    expect(row).toHaveTextContent('ต่าง -฿0.50')
  })

  it('shows the amount_mismatch badge only when it is set on the row', async () => {
    const api: Partial<PosApi> = {
      listPriceDiffs: vi.fn(async () => [
        { kind: 'amount' as const, orderId: 'o1', receiptNo: 'A-000003', soldAt: '2026-09-25T03:00:00.000Z', totalSatang: 10_000, computedTotalSatang: 8_000, diffSatang: -2_000, catalogVersion: 42, amountMismatch: true },
      ]),
    }
    renderDiffs(api, { id: 'owner-1', displayName: 'เจ้าของ', role: 'owner' })
    expect(await screen.findByTestId('price-diff-mismatch-A-000003')).toBeInTheDocument()
  })

  it('never asks for a non-owner\'s price diffs (safe default — role checked before the call)', async () => {
    const listPriceDiffs = vi.fn(async () => [])
    renderDiffs({ listPriceDiffs }, { id: 'staff-1', displayName: 'พนักงาน', role: 'staff' })
    expect(await screen.findByTestId('price-diff-owner-only')).toBeInTheDocument()
    expect(listPriceDiffs).not.toHaveBeenCalled()
  })
})
