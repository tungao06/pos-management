import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type JSX } from 'react'
import type { OrderDetailDto } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, orderKey, ordersKey, useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'
import { PinPad } from './PinPad'

/** spec §4.3: reason + "made yet?" + owner PIN; cash is refunded from the drawer, PromptPay needs the refund reference. */
export function VoidDialog({ order, onClose }: { order: OrderDetailDto; onClose: () => void }): JSX.Element {
  const api = useApi()
  const boot = useBootstrap()
  const { user } = useSession()
  const queryClient = useQueryClient()
  const owners = (boot.data?.users ?? []).filter((u) => u.role === 'owner')
  const [reason, setReason] = useState('')
  const [made, setMade] = useState<boolean | null>(null)
  const [refundRef, setRefundRef] = useState('')
  // D50 Q3-22: the signed-in owner is preselected and may approve their own void, but the PinPad below still asks for
  // their PIN every time (voidOrder always runs requireOwnerPin) and a reason is required; the VOIDED event keeps approvedBy.
  const [approverId, setApproverId] = useState<string | null>(user?.role === 'owner' ? user.id : null)
  const [error, setError] = useState<string | null>(null)
  const isQr = order.method === 'PROMPTPAY'

  const mutation = useMutation({
    mutationFn: (pin: string) =>
      api.voidOrder({
        orderId: order.id,
        actorUserId: user?.id ?? '',
        approverUserId: approverId ?? '',
        approverPin: pin,
        reason,
        made: made === true,
        refundReference: isQr ? refundRef : null,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ordersKey }),
        queryClient.invalidateQueries({ queryKey: orderKey(order.id) }),
        queryClient.invalidateQueries({ queryKey: bootstrapKey }),
      ])
      onClose()
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const submit = (pin: string): void => {
    if (reason.trim() === '') return setError(TH.errReasonRequired)
    if (made === null) return setError(TH.errChooseMade)
    if (isQr && refundRef.trim() === '') return setError(TH.errRefundRefRequired) // (D48 Q3-15)
    if (approverId === null) return setError(TH.errNotOwner)
    setError(null)
    mutation.mutate(pin)
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-label={TH.voidTitle(order.receiptNo)}>
      <div className="dialog">
        <h2>{TH.voidTitle(order.receiptNo)}</h2>
        <label>
          {TH.voidReason}
          <input data-testid="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="choices">
          {TH.voidReasonPresets.map((text, i) => (
            <button key={text} type="button" data-testid={`void-reason-preset-${i}`} onClick={() => setReason(text)}>
              {text}
            </button>
          ))}
        </div>
        <h3>{TH.voidMadeQuestion}</h3>
        <div className="choices">
          <button type="button" data-testid="void-made-no" aria-pressed={made === false} onClick={() => setMade(false)}>
            {TH.voidMadeNo}
          </button>
          <button type="button" data-testid="void-made-yes" aria-pressed={made === true} onClick={() => setMade(true)}>
            {TH.voidMadeYes}
          </button>
        </div>
        {isQr ? (
          <label>
            {TH.voidQrRefundRef}
            <input data-testid="void-refund-ref" value={refundRef} onChange={(e) => setRefundRef(e.target.value)} />
          </label>
        ) : (
          <p className="big-amount" data-testid="void-cash-refund">
            {TH.voidCashRefund(formatBaht(order.totalSatang))}
          </p>
        )}
        <h3>{TH.voidApprover}</h3>
        <div className="choices">
          {owners.map((u) => (
            <button key={u.id} type="button" data-testid={`void-approver-${u.displayName}`} aria-pressed={approverId === u.id} onClick={() => setApproverId(u.id)}>
              {u.displayName}
            </button>
          ))}
        </div>
        <PinPad busy={mutation.isPending} error={error} onSubmit={submit} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {TH.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}
