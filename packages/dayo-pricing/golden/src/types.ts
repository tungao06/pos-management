/**
 * Shim (plan 10 R1): dayo's vendored golden load.ts imports `../../../src/types.js` — in dayo that is
 * packages/shared/src/types.ts. Here it resolves to this file, which re-exports the vendored copy. Types only.
 */
export type * from '../../src/vendor/types'
