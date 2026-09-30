import type { JSX } from 'react'
import { selectableManualPromotions, type PosOrderCatalog } from '@dayo/domain'
import { useCart } from '../app/cart-context'
import { toCartDraft } from '../state/cart'
import { TH } from '../ui/th'
import { PromoLimitBadge } from './PromoLimitBadge'

/**
 * Manual promotions (apply_mode 'manual', ADR-0070 rule 3): one big chip each, tap to pick / tap again to drop. The list
 * is dayo's own `selectableManualPromotions` (channel, time, conditions, skips) — `code` promotions are not chips (they
 * are typed in the code box). A picked promotion stays listed even when it stopped being selectable (its time window
 * passed), so the cashier can always drop it. The whole section is hidden when dayo does not take manual promotions.
 */
export function ManualPromoPicker({ catalog, manualSupported }: { catalog: PosOrderCatalog | undefined; manualSupported: boolean }): JSX.Element | null {
  const { state, dispatch } = useCart()
  if (!manualSupported || catalog === undefined) return null
  const selectable = selectableManualPromotions({ ...toCartDraft(state), paymentCode: 'cash' }, catalog, new Date().toISOString())
  const picked = state.manualPromotionIds
  const chips = [
    ...selectable.map((s) => ({ id: s.promotionId, name: s.name, total: s.usageLimitTotal, perDay: s.usageLimitPerDay })),
    ...picked
      .filter((id) => !selectable.some((s) => s.promotionId === id))
      .map((id) => {
        const p = catalog.promotions.find((x) => x.id === id)
        return { id, name: p?.name ?? id, total: p?.usageLimitTotal ?? null, perDay: p?.usageLimitPerDay ?? null }
      }),
  ]
  if (chips.length === 0) return null
  return (
    <div className="manual-promos" data-testid="manual-promos">
      <h3>{TH.manualPromos}</h3>
      <div className="choices">
        {chips.map((c) => (
          <span key={c.id}>
            <button type="button" data-testid={`manual-promo-${c.id}`} aria-pressed={picked.includes(c.id)} onClick={() => dispatch({ type: 'toggleManualPromotion', id: c.id })}>
              {c.name}
            </button>
            <PromoLimitBadge id={c.id} usageLimitTotal={c.total} usageLimitPerDay={c.perDay} />
          </span>
        ))}
      </div>
    </div>
  )
}
