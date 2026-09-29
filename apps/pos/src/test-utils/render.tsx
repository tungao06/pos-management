import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { cleanup, render as rtlRender } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, vi } from 'vitest'
import type { PosApi } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { CartProvider } from '../app/cart-context'
import { createQueryClient } from '../app/query-client'
import type { PosRole } from '../app/permissions'
import { SessionProvider, useSession } from '../app/session'

// This project does not run vitest with `globals: true`, so `@testing-library/react`'s own auto-cleanup (which
// only fires when it finds a global `afterEach`) never triggers. Registering it once here — rather than in every
// screen test file — is what lets the brief's given test files skip it themselves.
afterEach(() => cleanup())

/**
 * `<RouterProvider>`'s own initial route match always resolves a tick after mount (spiked separately: even a
 * single trivial route with no loader renders nothing on the first synchronous paint), which would make every
 * `getByTestId` right after `renderWithApi` need an `await` first. Task 17's given tests interact with the screen
 * synchronously, so — the same choice `BackupScreen.test.tsx` / `CashMoveDialog.test.tsx` already made — screens
 * are rendered directly (no real router underneath) with `useNavigate` stubbed to a no-op `vi.fn()`. A screen that
 * needs its OWN memory router to check where it navigates (none of Task 17's do) still builds one itself.
 */
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

/** A fake PosApi for a screen test: every method is `vi.fn()`, so its mocked return value need not be a complete
 * DTO (screens only read the fields they use) — the real PosApi contract is checked by the Node-level API tests. */
export type FakeApi = { [K in keyof PosApi]?: (...args: never[]) => unknown }

/**
 * Renders `ui` behind `<ApiProvider>` + a `QueryClient` + `<SessionProvider>` — the same stack `main.tsx` builds,
 * minus the on-device Worker and (see above) the router. `api` stands in for the Comlink `PosApi` (Task 11); its
 * methods are typically `vi.fn()` returning only the fields the screen under test reads.
 */
export function renderWithApi(ui: JSX.Element, api: FakeApi): { queryClient: QueryClient; container: HTMLElement } {
  // final fix C7: the app's own QueryClient options (app/query-client.ts — networkMode 'always', staleTime, no retry,
  // mutations.gcTime 0 so a PIN-carrying mutation's cache entry never lingers), here as much as in production.
  const queryClient = createQueryClient()
  const { container } = rtlRender(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api as unknown as PosApi}>
        <SessionProvider>{ui}</SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { queryClient, container }
}

/** Signs a fake `{ userId, role }` in on mount (block 3 screen tests), then renders `children`. `displayName` is a
 * placeholder — every screen's approver choices come from `bootstrap().users`, never the signed-in session's own name. */
function SignedIn({ session, children }: { session: { userId: string; role: PosRole }; children: JSX.Element }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn({ id: session.userId, displayName: session.userId, role: session.role }), [signIn, session.userId, session.role])
  return children
}

/**
 * Block 3 screens (Task 15): the same stack `renderWithApi` builds, plus an optional signed-in `session` — most of
 * these screens read `useSession().user` straight away (the actor of `finishCount`/`confirmCount`/`issueZ`).
 */
export function render(ui: JSX.Element, opts: { api: FakeApi; session?: { userId: string; role: PosRole } }): { queryClient: QueryClient; container: HTMLElement; unmount: () => void } {
  // final fix C7: the app's own QueryClient options (app/query-client.ts — networkMode 'always', staleTime, no retry,
  // mutations.gcTime 0 so a PIN-carrying mutation's cache entry never lingers), here as much as in production.
  const queryClient = createQueryClient()
  const inner = opts.session === undefined ? ui : <SignedIn session={opts.session}>{ui}</SignedIn>
  const { container, unmount } = rtlRender(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={opts.api as unknown as PosApi}>
        <SessionProvider>
          <CartProvider>{inner}</CartProvider>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { queryClient, container, unmount }
}
