import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useState, type JSX } from 'react'
import type { SkipCountFloorResult, UserDto } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, syncStatusKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'
import { OwnerApprovalDialog, type OwnerApproval } from './OwnerApprovalDialog'

/**
 * Task 14 · carried items 9a/9b — fix round 1 items 1, 3, 4, 5 · fix round 2 item A: the two owner escapes of a
 * stuck central shift, shared by every screen that can reach that dead end (`IssueZScreen`, `CloseShiftScreen`) so
 * they behave and test identically everywhere, never drift apart:
 * - item 4 (security): `onSettled: () => mutation.reset()` — the PIN just typed must not sit in this hook's
 *   `variables` a moment longer than the call itself needs it (paired with `mutations: { gcTime: 0 }` in main.tsx).
 * - item 5: every success here invalidates `syncStatusKey` alongside `bootstrapKey` — the status banners must not
 *   show a stale "ปิดไว้ในเครื่อง"-able warning right after the owner has just fixed it.
 * - fix round 2 item A (security, High): `reset()` detaches the observer from the mutation SYNCHRONOUSLY, in the
 *   same tick as the error/success dispatch it runs right after (`onSettled`) — a caller reading `mutation.isError`/
 *   `mutation.error` after that never sees anything but the just-reset idle state, so a wrong PIN (or NOT_OWNER,
 *   REMEDY_NOT_ALLOWED, …) silently showed no error at all. `error` here is a plain `useState` written by `onError`
 *   BEFORE `onSettled` resets the mutation — a real React state update, not the mutation's own (about-to-vanish)
 *   result — so the dialog can actually render it. Cleared on every open (a fresh dialog starts silent) and once
 *   the call succeeds.
 */
function useResettingMutation<T>(mutationFn: (approval: OwnerApproval) => Promise<T>, onSuccess: (result: T) => void) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const mutation: UseMutationResult<T, unknown, OwnerApproval> = useMutation<T, unknown, OwnerApproval>({
    mutationFn,
    onSuccess: async (result) => {
      setError(null)
      await Promise.all([queryClient.invalidateQueries({ queryKey: bootstrapKey }), queryClient.invalidateQueries({ queryKey: syncStatusKey })])
      onSuccess(result)
    },
    onError: (e) => setError(errorMessage(e)),
    onSettled: (): void => mutation.reset(),
  })
  // fix round 3 item 1 (M): `OwnerApprovalDialog` clears its PIN field only when `error` actually CHANGES (a
  // `useEffect` on it) — a second wrong PIN in a row sets the exact same Thai string again, which React sees as no
  // change at all, so the just-typed (wrong) PIN sat in the field forever. Clearing the saved error to `null`
  // right before every submit guarantees the next `onError` (if any) is always a real `null` → text transition.
  const mutate = (approval: OwnerApproval): void => {
    setError(null)
    mutation.mutate(approval)
  }
  return { mutate, isPending: mutation.isPending, error, clearError: () => setError(null) }
}

/** 9a "เก็บกะนี้ไว้ในเครื่อง" — `prominent` (fix round 1 item 1b) picks the banner button vs. a small secondary
 * link for a plain OFFLINE (the network may still come back; every other reason will not). */
export function KeepShiftLocalControl({ shiftId, owners, prominent, onDone }: { shiftId: string; owners: UserDto[]; prominent: boolean; onDone: () => void }): JSX.Element {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const { mutate, isPending, error, clearError } = useResettingMutation((approval) => api.keepShiftLocal({ ...approval, shiftId }), () => {
    setOpen(false)
    onDone()
  })
  const openDialog = (): void => {
    clearError()
    setOpen(true)
  }
  return (
    <>
      {prominent ? (
        <button type="button" className="banner error" data-testid="keep-shift-local-open" onClick={openDialog}>
          {TH.keepShiftLocalButton}
        </button>
      ) : (
        <>
          <p data-testid="keep-shift-local-offline-hint">{TH.keepShiftLocalOfflineHint}</p>
          <button type="button" data-testid="keep-shift-local-link" onClick={openDialog}>
            {TH.keepShiftLocalSecondaryLink}
          </button>
        </>
      )}
      {open && (
        <OwnerApprovalDialog
          title={TH.keepShiftLocalButton}
          owners={owners}
          defaultApproverId={null}
          busy={isPending}
          error={error}
          extra={
            <p role="alert" className="error">
              {TH.keepShiftLocalWarning}
            </p>
          }
          onSubmit={(approval) => mutate(approval)}
          onClose={() => {
            clearError()
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

/**
 * 9b "ข้ามการตรวจเวลาที่ล้ำ" — the risk is shown before the PIN (`extra`); the skipped counts are `onDone`'s job to
 * show afterwards (fix round 1 review: this control must not hold the result itself — the caller very reasonably
 * stops rendering it once its own "still blocked" flag clears, which would unmount it before the result ever showed).
 */
export function SkipCountFloorControl({ owners, onDone }: { owners: UserDto[]; onDone: (result: SkipCountFloorResult) => void }): JSX.Element {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const { mutate, isPending, error, clearError } = useResettingMutation((approval) => api.skipCountFloor(approval), (r) => {
    setOpen(false)
    onDone(r)
  })
  return (
    <>
      <button
        type="button"
        className="banner error"
        data-testid="skip-count-floor-open"
        onClick={() => {
          clearError()
          setOpen(true)
        }}
      >
        {TH.skipCountFloorButton}
      </button>
      {open && (
        <OwnerApprovalDialog
          title={TH.skipCountFloorButton}
          owners={owners}
          defaultApproverId={null}
          busy={isPending}
          error={error}
          extra={
            <p role="alert" className="error">
              {TH.skipCountFloorWarning}
            </p>
          }
          onSubmit={(approval) => mutate(approval)}
          onClose={() => {
            clearError()
            setOpen(false)
          }}
        />
      )}
    </>
  )
}
