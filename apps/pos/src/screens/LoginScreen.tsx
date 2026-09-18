import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import type { UserDto } from '../api/types'
import { useApi } from '../app/api-context'
import { useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'
import { DbErrorScreen } from './DbErrorScreen'
import { PinPad } from './PinPad'

export function LoginScreen(): JSX.Element {
  const api = useApi()
  const boot = useBootstrap()
  const session = useSession()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<UserDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  const login = useMutation({
    mutationFn: ({ userId, pin }: { userId: string; pin: string }) => api.login(userId, pin),
    onSuccess: (u) => {
      session.signIn(u)
      void navigate({ to: '/' })
    },
    onError: (e) => setError(errorMessage(e)),
  })

  if (boot.isPending) return <main className="page">{TH.loading}</main>
  if (boot.isError) return <DbErrorScreen error={boot.error} />

  return (
    <main className="page">
      <h1>{TH.loginTitle}</h1>
      <div className="choices">
        {boot.data.users.map((u) => (
          <button
            key={u.id}
            type="button"
            aria-pressed={selected?.id === u.id}
            data-testid={`user-${u.displayName}`}
            onClick={() => {
              setSelected(u)
              setError(null)
            }}
          >
            {u.displayName}
          </button>
        ))}
      </div>
      {selected !== null && (
        <>
          <p>{TH.loginEnterPin(selected.displayName)}</p>
          <PinPad busy={login.isPending} error={error} onSubmit={(pin) => login.mutate({ userId: selected.id, pin })} />
        </>
      )}
    </main>
  )
}
