// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PosApi } from './api/types'
import { ApiProvider } from './app/api-context'
import { bootstrapKey } from './app/queries'
import { IssueZGate } from './router'

afterEach(() => cleanup())

// `IssueZGate` only ever reads `useBootstrap()` and hands `shiftId`/`countedSatang` to `IssueZScreen` — the real
// screen (its own E4 fetch, `CountReview`, PIN mutation, …) is not this route wrapper's own behaviour, so it is
// stubbed here to the two props that matter, same idiom a route-wrapper unit test uses elsewhere in this repo.
vi.mock('./screens/IssueZScreen', () => ({
  IssueZScreen: ({ shiftId, countedSatang }: { shiftId: string; countedSatang: number }) => (
    <div data-testid="issue-z-stub">
      {shiftId}:{countedSatang}
    </div>
  ),
}))

type Waiting = { shiftId: string; countedSatang: number; businessDate: string; countedAt: string; syncMode: 'central' }

function renderGate(shiftId: string, bootstrap: () => Promise<{ zWaiting: Waiting[] }>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const api = { bootstrap } as unknown as PosApi
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <IssueZGate shiftId={shiftId} />
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { queryClient, ...view }
}

const waiting = (shiftId: string, countedSatang: number): Waiting => ({ shiftId, countedSatang, businessDate: '2026-09-25', countedAt: 'x', syncMode: 'central' })

describe('IssueZGate (Task 17 fix round 1 item 1, High)', () => {
  it('ties the locked count to shiftId: A→B without a remount shows B\'s own countedSatang, never A\'s stale one', async () => {
    const bootstrap = vi.fn(async () => ({ zWaiting: [waiting('a', 1_000), waiting('b', 2_000)] }))
    const { rerender, queryClient } = renderGate('a', bootstrap)
    await screen.findByText('a:1000')

    rerender(
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={{ bootstrap } as unknown as PosApi}>
          <IssueZGate shiftId="b" />
        </ApiProvider>
      </QueryClientProvider>,
    )
    await screen.findByText('b:2000')
    expect(screen.queryByText('a:1000')).toBeNull()
  })

  it('a shiftId with no waiting shift of its own (never locked) shows errZNotFound, even after a DIFFERENT shiftId was locked', async () => {
    const bootstrap = vi.fn(async () => ({ zWaiting: [waiting('a', 1_000)] }))
    const { rerender, queryClient } = renderGate('a', bootstrap)
    await screen.findByText('a:1000')

    rerender(
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={{ bootstrap } as unknown as PosApi}>
          <IssueZGate shiftId="unknown-shift" />
        </ApiProvider>
      </QueryClientProvider>,
    )
    await screen.findByText('ไม่พบรายงาน Z')
    expect(screen.queryByTestId('issue-z-stub')).toBeNull()
  })

  it('the original success case: the shift leaving zWaiting (issueZ succeeded, bootstrapKey invalidated) keeps showing its own locked count, never "ไม่พบรายงาน Z"', async () => {
    let zWaiting = [waiting('a', 1_000)]
    const bootstrap = vi.fn(async () => ({ zWaiting }))
    const { queryClient } = renderGate('a', bootstrap)
    await screen.findByText('a:1000')

    zWaiting = [] // issueZ's own onSuccess invalidates bootstrapKey once the Z is written
    await queryClient.invalidateQueries({ queryKey: bootstrapKey })
    await waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(2))
    expect(screen.getByText('a:1000')).toBeVisible()
    expect(screen.queryByText('ไม่พบรายงาน Z')).toBeNull()
  })
})
