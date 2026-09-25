// packages/dayo-mock/src/index.ts — browser-safe entry (no node:*); the Node server lives in server.ts only
export { mockControl } from './control.js'
export { createMockDayo, MOCK_API_KEY, pgTimestamp } from './handler.js'
export { ALL_SCOPES } from './state.js'
export type { MockDayo, MockMode, MockOptions, MockOrderData, MockOverride, MockState, PosCatalogChangedData, PosOrderEdit, StoredOrder } from './state.js'
