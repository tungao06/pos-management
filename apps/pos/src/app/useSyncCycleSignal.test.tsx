// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeSyncCycleNotifier, notifySyncCycleDone } from '../sync/cycle-signal'
import { bootstrapKey, ordersKey } from './queries'
import { useSyncCycleSignal } from './useSyncCycleSignal'

afterEach(() => {
  cleanup()
  closeSyncCycleNotifier()
})

function setup() {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  const hook = renderHook(() => useSyncCycleSignal(), { wrapper })
  return { invalidate, hook }
}
const keysOf = (invalidate: ReturnType<typeof setup>['invalidate']) => invalidate.mock.calls.map(([f]) => f?.queryKey)

describe('useSyncCycleSignal (Task 21 hotfix 2)', () => {
  it('jsdom tests run with a working BroadcastChannel (the real one, not a stub)', () => {
    expect(typeof BroadcastChannel).toBe('function')
  })
  it('refetches the bootstrap (badge, banners) and the bill list at once when the worker reports a cycle', async () => {
    const { invalidate, hook } = setup()
    notifySyncCycleDone()
    await vi.waitFor(() => expect(keysOf(invalidate)).toEqual([bootstrapKey, ordersKey]))
    notifySyncCycleDone() // every cycle, not only the first
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(4))
    hook.unmount()
  })
  it('stops listening on unmount', async () => {
    const { invalidate, hook } = setup()
    hook.unmount()
    const other = setup() // a second mount proves the message is delivered after the first unmounted
    notifySyncCycleDone()
    await vi.waitFor(() => expect(other.invalidate).toHaveBeenCalledTimes(2))
    expect(invalidate).not.toHaveBeenCalled()
    other.hook.unmount()
  })
})
