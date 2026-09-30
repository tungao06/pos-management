import type { JSX } from 'react'
import { normPromoCode } from '@dayo/dayo-pricing'
import { zeroBillNeedsReason, type PosOrderCatalog, type PricedCart } from '@dayo/domain'
import { useCart } from '../app/cart-context'
import { MANUAL_REASON_MAX, toCartDraft } from '../state/cart'
import { formatBahtFull } from '../ui/format'
import { TH } from '../ui/th'
import { ManualPromoPicker } from './ManualPromoPicker'
import { PromoLimitBadge } from './PromoLimitBadge'

const MODE_LABEL = { auto: TH.promoModeAuto, code: TH.promoModeCode, manual: TH.promoModeManual } as const

/** Promotions dayo's own pricing code applied (spec §4.4, §5.1) — each with how it applies (auto / code / manual), its
 * "จำกัด n ครั้ง" badge when it has a limit (Q3 = ก) and a "ไม่ใช้" that skips just that one (D50 Q3-27's sibling for
 * promotions: the cart is re-priced from `skipPromotionIds`, never computed here). A manual promotion is dropped by its
 * chip instead. A skipped promotion still lists its name with "ใช้โปรนี้" to bring it back (minor, review round 1). */
export function PromoPanel({ priced, catalog, manualSupported = false }: { priced: PricedCart | null; catalog: PosOrderCatalog | undefined; manualSupported?: boolean }): JSX.Element {
  const { state, dispatch } = useCart()
  const skipped = (catalog?.promotions ?? []).filter((p) => state.skipPromotionIds.includes(p.id))
  // Q2 = ก: the reason is asked only when the system asks for it (zeroBillNeedsReason) — never just because one was picked
  const needsReason = priced !== null && zeroBillNeedsReason({ ...toCartDraft(state), paymentCode: 'cash' }, priced)
  const pickedIds = state.manualPromotionIds.length
  const normalizedCode = state.promoCode === null ? null : normPromoCode(state.promoCode)
  const promoWarnings = (priced?.warnings ?? []).filter((w) => w.startsWith('ไม่ใช้โปร'))
  return (
    <div className="promo-panel" data-testid="promo-panel">
      {priced?.promotionsApplied.map((p) => (
        <div key={p.promotionId} className="promo-line" data-testid={`promo-${p.promotionId}`}>
          <span>
            {p.name} −{formatBahtFull(p.discountSatang)}
          </span>
          <span className="badge" data-testid={`promo-mode-${p.promotionId}`}>
            {MODE_LABEL[p.mode]}
          </span>
          <PromoLimitBadge id={p.promotionId} usageLimitTotal={p.usageLimitTotal} usageLimitPerDay={p.usageLimitPerDay} />
          {p.mode !== 'manual' && (
            <button type="button" data-testid={`promo-skip-${p.promotionId}`} onClick={() => dispatch({ type: 'skipPromotion', id: p.promotionId })}>
              {TH.promoSkip}
            </button>
          )}
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
      {promoWarnings.length > 0 && (
        <ul className="promo-warnings" data-testid="promo-warnings" aria-label={TH.promoWarnings}>
          {promoWarnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <ManualPromoPicker catalog={catalog} manualSupported={manualSupported} />
      {needsReason && pickedIds > 0 && (
        <div className="manual-reason">
          <label>
            {TH.manualReason}
            <input
              data-testid="manual-reason"
              maxLength={MANUAL_REASON_MAX}
              aria-required="true"
              aria-describedby="manual-reason-hint manual-reason-count"
              value={state.manualPromotionReason}
              onChange={(e) => dispatch({ type: 'setManualReason', text: e.target.value })}
            />
          </label>
          <span id="manual-reason-count" className="badge" data-testid="manual-reason-count">
            {TH.manualReasonCount(state.manualPromotionReason.length)}
          </span>
          <span id="manual-reason-hint" data-testid="manual-reason-hint">
            {TH.manualReasonNeeded}
          </span>
        </div>
      )}
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
      {normalizedCode !== null && (
        <span className="badge" data-testid="promo-code-norm">
          {TH.promoCodeNormalized(normalizedCode)}
        </span>
      )}
    </div>
  )
}
