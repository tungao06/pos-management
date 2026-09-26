import type { JSX } from 'react'
import type { PricedCart } from '@dayo/domain'
import { useCart } from '../app/cart-context'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'

/** Promotions dayo's own pricing code applied (spec §4.4, §5.1) — each with a "ไม่ใช้" that skips just that one
 * (D50 Q3-27's sibling for promotions: the cart is re-priced from `skipPromotionIds`, never computed here). */
export function PromoPanel({ priced }: { priced: PricedCart | null }): JSX.Element {
  const { state, dispatch } = useCart()
  return (
    <div className="promo-panel" data-testid="promo-panel">
      {priced?.promotionsApplied.map((p) => (
        <div key={p.promotionId} className="promo-line" data-testid={`promo-${p.promotionId}`}>
          <span>
            {p.name} −{formatBaht(p.discountSatang)}
          </span>
          <button type="button" data-testid={`promo-skip-${p.promotionId}`} onClick={() => dispatch({ type: 'skipPromotion', id: p.promotionId })}>
            {TH.promoSkip}
          </button>
        </div>
      ))}
      <label>
        <input type="checkbox" data-testid="no-promotions" checked={state.noPromotions} onChange={(e) => dispatch({ type: 'setNoPromotions', value: e.target.checked })} />
        {TH.noPromotions}
      </label>
      <input
        data-testid="promo-code"
        placeholder={TH.promoCode}
        value={state.promoCode ?? ''}
        onChange={(e) => dispatch({ type: 'setPromoCode', code: e.target.value.trim() === '' ? null : e.target.value })}
      />
    </div>
  )
}
