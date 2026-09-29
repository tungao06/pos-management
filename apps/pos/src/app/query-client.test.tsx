// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, renderWithApi } from '../test-utils'
import { createQueryClient, QUERY_CLIENT_DEFAULTS } from './query-client'

// final fix C7: screen tests run on the SAME QueryClient options the app does (networkMode 'always', staleTime, no retry,
// mutations.gcTime 0) — a test that passed only because its client differed from main.tsx's proved nothing.
describe('one QueryClient configuration for the app and the screen tests (final fix C7)', () => {
  it('the defaults: data lives on the device (networkMode always), no retry, a PIN mutation leaves the cache at once', () => {
    expect(QUERY_CLIENT_DEFAULTS).toEqual({
      queries: { networkMode: 'always', retry: false, staleTime: 5_000 },
      mutations: { networkMode: 'always', retry: false, gcTime: 0 },
    })
    expect(createQueryClient().getDefaultOptions()).toEqual(QUERY_CLIENT_DEFAULTS)
  })
  it('renderWithApi and render build their client from them', () => {
    expect(renderWithApi(<p />, {}).queryClient.getDefaultOptions()).toEqual(QUERY_CLIENT_DEFAULTS)
    expect(render(<p />, { api: {} }).queryClient.getDefaultOptions()).toEqual(QUERY_CLIENT_DEFAULTS)
  })
  // main.tsx itself (it renders into #root on import): test/query-client-main.test.ts reads its source
})
