import { saleSettingsOf } from '@dayo/dayo-pricing'
import { trimWs, type ParityDraft } from '@dayo/contracts'
import { edgeBahtToSatang } from './money-edge.js'
import { CartError, defaultMilkForLine, type CartDraft, type PosOrderCatalog } from './price-cart.js'

/** dayo's OrderDraft (a parity case of pos-parity.json) → the cart the tablet would build for it (spec 04 §4.5, §5.2 layer C). */
export function cartFromOrderDraft(draft: ParityDraft, catalog: PosOrderCatalog): { cart: CartDraft; soldAt: string } {
  if (draft.saleTime === undefined) throw new Error('NO_SALE_TIME: the tablet always sends sold_at; ask the dayo team to set saleTime on this case')
  if (draft.billDiscountBaht != null && draft.billDiscountPercent != null) throw new CartError('BAD_DISCOUNT', 'bill discount has both baht and percent')
  const set = saleSettingsOf(catalog)
  const channelCode = draft.channelCode || set.defaultChannelCode
  const channel = catalog.channels.find((c) => c.code === channelCode)
  const defaultGrade = (catalog.gradeOptions.find((g) => g.isDefault) ?? catalog.gradeOptions[0])?.code ?? null
  // the cart holds the reason as dayo stores it (dayo_trim_ws): the engine trims too, so the price is the same (carried item 6)
  const reason = draft.manualPromotionReason == null ? '' : trimWs(draft.manualPromotionReason)
  return {
    soldAt: new Date(`${draft.saleDate}T${draft.saleTime}:00.000+07:00`).toISOString(),
    cart: {
      channelCode,
      paymentCode: draft.paymentCode ?? channel?.defaultPaymentMethodCode ?? 'cash',
      lines: draft.lines.map((l) => {
        const size = l.size ?? set.defaultSize
        const sweetness = l.sweetness ?? set.defaultSweetness
        const v = catalog.variants.find((x) => x.menuCode === l.code && x.size === size && x.sweetness === sweetness)
        return {
          code: l.code, size, sweetness,
          milk: l.milk ?? (v === undefined ? 'fresh' : defaultMilkForLine(catalog, v)),
          grade: l.grade ?? (v?.isMatcha === true ? defaultGrade : null),
          qty: l.qty, free: l.free ?? false,
          discountSatang: l.discountBaht == null ? null : edgeBahtToSatang(l.discountBaht),
          discountPercent: l.discountPercent ?? null,
          discountReason: l.discountReason ?? null,
        }
      }),
      billDiscount: draft.billDiscountBaht != null ? { kind: 'satang', satang: edgeBahtToSatang(draft.billDiscountBaht), reason: draft.billDiscountReason ?? null }
        : draft.billDiscountPercent != null ? { kind: 'percent', percent: draft.billDiscountPercent, reason: draft.billDiscountReason ?? null }
        : null,
      promoCode: draft.promoCode ?? null,
      skipPromotionIds: [...(draft.skipPromotionIds ?? [])],
      noPromotions: false, // dayo cases express "no promotions" as skipPromotionIds = every id — the same result (spec §4.5)
      manualPromotionIds: [...(draft.manualPromotionIds ?? [])],
      manualPromotionReason: reason === '' ? null : reason,
      // the exhausted list stays out: the tablet never counts uses (ADR-0072 rule 2) — parity-support passes it on request
    },
  }
}
