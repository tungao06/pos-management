/**
 * Shim (plan 10 R1): dayo's vendored golden load.ts imports `../../../src/promotions.js` (for PromotionContext) — in
 * dayo that is packages/shared/src/promotions.ts. Here it resolves to this file, which re-exports the vendored copy. Types only.
 */
export type * from '../../src/vendor/promotions'
