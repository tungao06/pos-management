import { useQuery } from '@tanstack/react-query'
import { useApi } from './api-context'

export const bootstrapKey = ['bootstrap'] as const

export function useBootstrap() {
  const api = useApi()
  return useQuery({ queryKey: bootstrapKey, queryFn: () => api.bootstrap() })
}
