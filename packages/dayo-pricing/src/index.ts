/**
 * dayo's own pricing code, vendored unchanged and pinned by VENDOR.json (spec 04 §5.1, D72). Never edit src/vendor —
 * update with `pnpm --filter @dayo/dayo-pricing vendor:update <dayo repo> <commit>` and re-run the parity test.
 */
export { applyOptions, channelPrice, computeOrder } from './vendor/money'
export { round2 } from './vendor/fmt'
export { bkkDay, bkkTime } from './vendor/time'
export { activeSizesSorted, defaultMilkFor, saleSettingsOf } from './vendor/shopSettings'
// ADR-0054: sizes are dayo cup-size codes ("22 oz"), a string checked by pattern, not a closed pair
export { isValidSizeCode, SIZE_CODE_PATTERN } from './vendor/types'
// dayo's rule engine (ADR-0071/0072 · plan 10): the tablet validates E1 promotions with these and asks E1 for max(PROMO_RULE_VERSIONS)
export { normPromoCode, promoApplyMode, selectablePromotions } from './vendor/promotions'
export { PROMO_RULE_VERSIONS, validatePromoRule, validateTimeWindows, promoToLegacy, promoRuleMinVersion } from './vendor/promoRule'
export type {
  ApplyMode, PromoRule, PromoTemplate, PromotionGroup, TimeWindow, SelectablePromotion, OptionAdds, PromoBreakdownEntry, ExhaustedPromotion,
  PromoTierHit,
} from './vendor/types'
export type {
  AppliedPromotion, BaseEntry, CupSizeEntry, IngredientEntry, MenuOptionGradeEntry, MenuOptionMilkEntry, MenuVariantEntry,
  MilkCode, OrderCatalog, OrderDraft, OrderDraftLine, PaymentMethodEntry, Promotion, QuoteResult, QuotedLine,
  SalesChannelEntry, ShopSaleSettings, Size, Sweetness,
} from './vendor/types'
