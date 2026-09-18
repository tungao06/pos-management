import { Navigate } from '@tanstack/react-router'
import type { JSX, ReactNode } from 'react'
import { useSession } from './session'

export function RequireSession({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useSession()
  if (user === null) return <Navigate to="/login" />
  return <>{children}</>
}
