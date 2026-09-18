import { createContext, useContext, type JSX, type ReactNode } from 'react'
import type { PosApi } from '../api/types'

const ApiContext = createContext<PosApi | null>(null)

export function ApiProvider({ api, children }: { api: PosApi; children: ReactNode }): JSX.Element {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
}

export function useApi(): PosApi {
  const api = useContext(ApiContext)
  if (api === null) throw new Error('useApi must be used inside <ApiProvider>')
  return api
}
