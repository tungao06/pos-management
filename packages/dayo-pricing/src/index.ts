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
export type {
  AppliedPromotion, BaseEntry, CupSizeEntry, IngredientEntry, MenuOptionGradeEntry, MenuOptionMilkEntry, MenuVariantEntry,
  MilkCode, OrderCatalog, OrderDraft, OrderDraftLine, PaymentMethodEntry, Promotion, QuoteResult, QuotedLine,
  SalesChannelEntry, ShopSaleSettings, Size, Sweetness,
} from './vendor/types'
