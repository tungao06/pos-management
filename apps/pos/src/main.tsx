import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from './app/providers'
import { router } from './router'
import './styles.css'

// networkMode 'always': data lives in the on-device database, so queries must run while offline (T21).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always', retry: false, staleTime: 5_000 },
    mutations: { networkMode: 'always', retry: false },
  },
})

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
