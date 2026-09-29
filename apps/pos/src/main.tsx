import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from './app/providers'
import { createQueryClient } from './app/query-client'
import { router } from './router'
import './styles.css'

// networkMode 'always', no retry, mutations.gcTime 0 — the one configuration the screen tests use too (app/query-client.ts)
const queryClient = createQueryClient()

// spec §8/§12: OPFS is the only copy of sales until sync (plan 5) — ask the browser to keep it.
void navigator.storage?.persist?.().catch(() => false)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </QueryClientProvider>
  </StrictMode>,
)
