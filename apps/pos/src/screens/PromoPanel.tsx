import type { JSX } from 'react'
import type { PosOrderCatalog, PricedCart } from '@dayo/domain'
import { useCart } from '../app/cart-context'
import { formatBahtFull } from '../ui/format'
import { TH } from '../ui/th'

/** Promotions dayo's own pricing code applied (spec §4.4, §5.1) — each with a "ไม่ใช้" that skips just that one
 * (D50 Q3-27's sibling for promotions: the cart is re-priced from `skipPromotionIds`, never computed here). A
 * skipped promotion still lists its name with "ใช้โปรนี้" to bring it back (minor, review round 1). */
export function PromoPanel({ priced, catalog }: { priced: PricedCart | null; catalog: PosOrderCatalog | undefined }): JSX.Element {
  const { state, dispatch } = useCart()
  const skipped = (catalog?.promotions ?? []).filter((p) => state.skipPromotionIds.includes(p.id))
  return (
    <div className="promo-panel" data-testid="promo-panel">
      {priced?.promotionsApplied.map((p) => (
        <div key={p.promotionId} className="promo-line" data-testid={`promo-${p.promotionId}`}>
          <span>
            {p.name} −{formatBahtFull(p.discountSatang)}
          </span>
          <button type="button" data-testid={`promo-skip-${p.promotionId}`} onClick={() => dispatch({ type: 'skipPromotion', id: p.promotionId })}>
            {TH.promoSkip}
          </button>
        </div>
      ))}
      {skipped.map((p) => (
        <div key={p.id} className="promo-line promo-line-skipped" data-testid={`promo-skipped-${p.id}`}>
          <span>{p.name}</span>
          <button type="button" data-testid={`promo-unskip-${p.id}`} onClick={() => dispatch({ type: 'unskipPromotion', id: p.id })}>
            {TH.promoUnskip}
          </button>
        </div>
      ))}
      <label className="check">
        <input type="checkbox" data-testid="no-promotions" checked={state.noPromotions} onChange={(e) => dispatch({ type: 'setNoPromotions', value: e.target.checked })} />
        {TH.noPromotions}
      </label>
      <input
        data-testid="promo-code"
        placeholder={TH.promoCode}
        value={state.promoCode ?? ''}
        onChange={(e) => {
          const trimmed = e.target.value.trim()
          dispatch({ type: 'setPromoCode', code: trimmed === '' ? null : trimmed })
        }}
      />
    </div>
  )
}
