import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type { UserDto } from '../api/types'

/** spec §5: lock after 10 minutes without interaction. */
export const IDLE_LOCK_MS = 10 * 60 * 1000

export function isIdleExpired(lastActivityMs: number, nowMs: number, limitMs: number = IDLE_LOCK_MS): boolean {
  return nowMs - lastActivityMs >= limitMs
}

type Session = { user: UserDto | null; signIn: (u: UserDto) => void; lock: () => void }
const SessionContext = createContext<Session | null>(null)

/** Who is using the till right now. Memory only: a reload asks for the PIN again. */
export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<UserDto | null>(null)
  const lastActivity = useRef(Date.now())

  useEffect(() => {
    const mark = (): void => {
      lastActivity.current = Date.now()
    }
    window.addEventListener('pointerdown', mark)
    window.addEventListener('keydown', mark)
    const timer = window.setInterval(() => {
      if (isIdleExpired(lastActivity.current, Date.now())) setUser(null)
    }, 15_000)
    return () => {
      window.removeEventListener('pointerdown', mark)
      window.removeEventListener('keydown', mark)
      window.clearInterval(timer)
    }
  }, [])

  const signIn = useCallback((u: UserDto) => {
    lastActivity.current = Date.now()
    setUser(u)
  }, [])
  const lock = useCallback(() => setUser(null), []) // CartProvider is a separate context, so locking keeps the cart as-is (D50 Q3-24)
  const value = useMemo(() => ({ user, signIn, lock }), [user, signIn, lock])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (s === null) throw new Error('useSession must be used inside <SessionProvider>')
  return s
}
