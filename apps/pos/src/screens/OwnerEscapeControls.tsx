import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useState, type JSX } from 'react'
import type { SkipCountFloorResult, UserDto } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, syncStatusKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'
import { OwnerApprovalDialog, type OwnerApproval } from './OwnerApprovalDialog'

/**
 * Task 14 · carried items 9a/9b — fix round 1 items 1, 3, 4, 5: the two owner escapes of a stuck central shift,
 * shared by every screen that can reach that dead end (`IssueZScreen`, `CloseShiftScreen`) so they behave and test
 * identically everywhere, never drift apart:
 * - item 4 (security): `onSettled: () => mutation.reset()` — the PIN just typed must not sit in this hook's
 *   `variables` a moment longer than the call itself needs it (paired with `mutations: { gcTime: 0 }` in main.tsx).
 * - item 5: every success here invalidates `syncStatusKey` alongside `bootstrapKey` — the status banners must not
 *   show a stale "ปิดไว้ในเครื่อง"-able warning right after the owner has just fixed it.
 */

function useResettingMutation<T>(mutationFn: (approval: OwnerApproval) => Promise<T>, onSuccess: (result: T) => void) {
  const queryClient = useQueryClient()
  const mutation: UseMutationResult<T, unknown, OwnerApproval> = useMutation<T, unknown, OwnerApproval>({
    mutationFn,
    onSuccess: async (result) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: bootstrapKey }), queryClient.invalidateQueries({ queryKey: syncStatusKey })])
      onSuccess(result)
    },
    onSettled: (): void => mutation.reset(),
  })
  return mutation
}

/** 9a "เก็บกะนี้ไว้ในเครื่อง" — `prominent` (fix round 1 item 1b) picks the banner button vs. a small secondary
 * link for a plain OFFLINE (the network may still come back; every other reason will not). */
export function KeepShiftLocalControl({ shiftId, owners, prominent, onDone }: { shiftId: string; owners: UserDto[]; prominent: boolean; onDone: () => void }): JSX.Element {
  const api = useApi()
  const [open, setOpen] = useState(false)
  const mutation = useResettingMutation((approval) => api.keepShiftLocal({ ...approval, shiftId }), () => {
    setOpen(false)
    onDone()
  })
  return (
    <>
      {prominent ? (
        <button type="button" className="banner error" data-testid="keep-shift-local-open" onClick={() => setOpen(true)}>
          {TH.keepShiftLocalButton}
        </button>
      ) : (
        <>
          <p data-testid="keep-shift-local-offline-hint">{TH.keepShiftLocalOfflineHint}</p>
          <button type="button" data-testid="keep-shift-local-link" onClick={() => setOpen(true)}>
            {TH.keepShiftLocalSecondaryLink}
          </button>
        </>
      )}
      {open && (
        <OwnerApprovalDialog
          title={TH.keepShiftLocalButton}
          owners={owners}
          defaultApproverId={null}
          busy={mutation.isPending}
          error={mutation.isError ? errorMessage(mutation.error) : null}
          extra={
            <p role="alert" className="error">
              {TH.keepShiftLocalWarning}
            </p>
          }
          onSubmit={(approval) => mutation.mutate(approval)}
          onClose={() => setOpen(false)}
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
  const mutation = useResettingMutation((approval) => api.skipCountFloor(approval), (r) => {
    setOpen(false)
    onDone(r)
  })
  return (
    <>
      <button type="button" className="banner error" data-testid="skip-count-floor-open" onClick={() => setOpen(true)}>
        {TH.skipCountFloorButton}
      </button>
      {open && (
        <OwnerApprovalDialog
          title={TH.skipCountFloorButton}
          owners={owners}
          defaultApproverId={null}
          busy={mutation.isPending}
          error={mutation.isError ? errorMessage(mutation.error) : null}
          extra={
            <p role="alert" className="error">
              {TH.skipCountFloorWarning}
            </p>
          }
          onSubmit={(approval) => mutation.mutate(approval)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
