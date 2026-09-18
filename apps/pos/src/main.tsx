import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { router } from './router'
import './styles.css'

// networkMode 'always': data lives in the on-device database, so queries must run while offline.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always', retry: false, staleTime: 5_000 },
    mutations: { networkMode: 'always', retry: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
