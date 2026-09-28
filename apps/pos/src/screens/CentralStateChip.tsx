import type { JSX } from 'react'
import type { CentralStateDto } from '../api/types'
import { TH } from '../ui/th'

/** spec 04 §4.3, §6.4: how dayo has this bill right now — read only, no action here changes it. */
export function CentralStateChip({ central }: { central: CentralStateDto }): JSX.Element {
  const { state, orderNo, reason, voidState } = central
  const text =
    state === 'sent'
      ? TH.centralSent(orderNo ?? '')
      : state === 'problem'
        ? TH.centralProblem(reason ?? '')
        : state === 'excluded'
          ? TH.centralExcluded
          : state === 'legacy'
            ? TH.centralLegacy
            : TH.centralPending
  const color = state === 'sent' ? 'green' : state === 'problem' ? 'red' : state === 'excluded' ? 'orange' : 'gray'
  return (
    <span className="chips">
      <span data-testid="central-state" data-central-state={state} className={`chip chip-${color}`}>
        {text}
      </span>
      {voidState === 'local_only' && (
        <span data-testid="central-void-local" className="chip chip-orange">
          {TH.centralVoidLocalOnly}
        </span>
      )}
    </span>
  )
}
