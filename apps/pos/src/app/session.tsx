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
  // Two clocks (review I-1, I-2). performance.now() is monotonic, but Chrome/Android pause it while the device is
  // suspended (Chromium's TimeTicks "stand still" when suspended; on Android/Linux it reads CLOCK_MONOTONIC, which
  // stops during suspend) — so a nap that outlasts the idle limit would not be counted. Date.now() keeps advancing
  // through suspend, but it can jump backwards (RTC/NTP correction), which would otherwise silently suspend the
  // idle lock until the jump is caught up. Tracking both and locking when either says the limit passed covers both
  // failure modes: sleep is caught by the wall clock, a backwards wall jump is caught by the monotonic clock (which
  // keeps working — a negative wall delta never locks by itself), and a forward wall jump can only lock early,
  // which is harmless.
  const lastActivityMono = useRef(performance.now())
  const lastActivityWall = useRef(Date.now())

  useEffect(() => {
    // Locks (and reports whether it did) if the idle limit has already passed. Called before any refresh of
    // lastActivity so a tap landing after the limit locks instead of silently resetting the timer, and also on
    // visibilitychange — a suspended tab's timers (including the 15 s poll below) do not run while hidden, so the
    // first check after the tab wakes must not wait for the next poll (review I-2).
    const check = (): boolean => {
      if (isIdleExpired(lastActivityMono.current, performance.now()) || isIdleExpired(lastActivityWall.current, Date.now())) {
        setUser(null)
        return true
      }
      return false
    }
    const mark = (): void => {
      if (!check()) {
        lastActivityMono.current = performance.now()
        lastActivityWall.current = Date.now()
      }
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') check()
    }
    // Capture phase: the lock (if any) is applied before the bubble-phase handler on whatever was tapped runs
    // against the stale session.
    window.addEventListener('pointerdown', mark, { capture: true })
    window.addEventListener('keydown', mark, { capture: true })
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(check, 15_000)
    return () => {
      window.removeEventListener('pointerdown', mark, { capture: true })
      window.removeEventListener('keydown', mark, { capture: true })
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [])

  const signIn = useCallback((u: UserDto) => {
    lastActivityMono.current = performance.now()
    lastActivityWall.current = Date.now()
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
