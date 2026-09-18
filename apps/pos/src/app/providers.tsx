import type { JSX, ReactNode } from 'react'
import { getWorkerApi } from '../db/client'
import { ApiProvider } from './api-context'
import { CartProvider } from './cart-context'
import { SessionProvider } from './session'

export function AppProviders({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ApiProvider api={getWorkerApi()}>
      <SessionProvider>
        <CartProvider>{children}</CartProvider>
      </SessionProvider>
    </ApiProvider>
  )
}
