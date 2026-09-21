import { useQuery } from '@tanstack/react-query'
import { useApi } from './api-context'

export const bootstrapKey = ['bootstrap'] as const
export const menuKey = ['menu'] as const
export const ordersKey = ['orders'] as const
export const orderKey = (orderId: string) => ['order', orderId] as const
export const zListKey = ['z-list'] as const
export const zKey = (shiftId: string) => ['z', shiftId] as const
export const shiftReportKey = ['shift-report'] as const

export function useBootstrap() {
  const api = useApi()
  return useQuery({ queryKey: bootstrapKey, queryFn: () => api.bootstrap() })
}
