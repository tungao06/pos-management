// packages/dayo-mock/src/index.ts — browser-safe entry (no node:*); the Node server lives in server.ts only
export { mockControl } from './control.js'
export { createMockDayo, DEFAULT_OFF_CATALOG_CAP, isMockOffline, MOCK_API_KEY, MockOfflineError, pgTimestamp } from './handler.js'
export { chainOf } from './judge-shift.js'
export { botCashBills, type BotCashBill } from './shift-cash.js'
export { MAIN_GROUP, promotionRow, promotionsFor, type PromoRulesOption } from './promo-rules.js'
export { ALL_SCOPES, BLOCK3_SCOPES } from './state.js'
export type {
  CatalogPromotion, CatalogVariant, MockCount, MockDayo, MockMode, MockMovement, MockOptions, MockOrderData, MockOverride, MockShift, MockState, MockZ, PosCatalogChangedData, PosOrderEdit, PromotionGroup, StoredOrder,
} from './state.js'
