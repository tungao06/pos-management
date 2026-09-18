import type { JSX, ReactNode } from 'react'
import { getWorkerApi } from '../db/client'
import { ApiProvider } from './api-context'

export function AppProviders({ children }: { children: ReactNode }): JSX.Element {
  return <ApiProvider api={getWorkerApi()}>{children}</ApiProvider>
}
