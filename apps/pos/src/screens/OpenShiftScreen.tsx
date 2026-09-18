import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent, type JSX } from 'react'
import { useApi } from '../app/api-context'
import { bootstrapKey, useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { parseBahtInput } from '../ui/format'
import { TH } from '../ui/th'

export function OpenShiftScreen(): JSX.Element {
  const api = useApi()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const boot = useBootstrap()
  const { user } = useSession()
  const [floatText, setFloatText] = useState('') // no default: count the drawer every morning, 0 allowed (D48 Q3-12)
  const [error, setError] = useState<string | null>(null)

  const open = useMutation({
    mutationFn: (openingFloatSatang: number) => api.openShift({ userId: user?.id ?? '', openingFloatSatang }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: bootstrapKey })
      void navigate({ to: '/sell' })
    },
    onError: (e) => setError(errorMessage(e)),
  })

  if (boot.data?.openShift) return <Navigate to="/sell" />

  const submit = (ev: FormEvent): void => {
    ev.preventDefault()
    const satang = parseBahtInput(floatText)
    if (satang === null) return setError(TH.errBadInput)
    setError(null)
    open.mutate(satang)
  }

  return (
    <main className="page">
      <h1>{TH.shiftOpenTitle}</h1>
      <form className="list" onSubmit={submit}>
        <label>
          {TH.shiftOpeningFloat}
          <input data-testid="shift-float" inputMode="decimal" value={floatText} onChange={(e) => setFloatText(e.target.value)} required />
        </label>
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="primary" data-testid="shift-open" disabled={open.isPending}>
          {TH.shiftOpen}
        </button>
      </form>
    </main>
  )
}
