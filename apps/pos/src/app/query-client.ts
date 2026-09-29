import { QueryClient, type DefaultOptions } from '@tanstack/react-query'

/**
 * The one QueryClient configuration — main.tsx and the screen tests' render helpers (test-utils/render.tsx) both build
 * from it (final fix C7), so a screen test never passes on options the app does not run with.
 * - networkMode 'always': data lives in the on-device database, so queries and mutations must run while offline (T21).
 * - mutations.gcTime 0 (fix round 1 item 4, security): a PIN passed through `useMutation`'s `variables` must not sit in the
 *   mutation cache after it settles — paired with every PIN-carrying mutation's own `onSettled: () => mutation.reset()`.
 */
export const QUERY_CLIENT_DEFAULTS = {
  queries: { networkMode: 'always', retry: false, staleTime: 5_000 },
  mutations: { networkMode: 'always', retry: false, gcTime: 0 },
} as const satisfies DefaultOptions

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { ...QUERY_CLIENT_DEFAULTS.queries }, mutations: { ...QUERY_CLIENT_DEFAULTS.mutations } } })
}
