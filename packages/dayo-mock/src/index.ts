// packages/dayo-mock/src/index.ts — browser-safe entry (no node:*); the Node server lives in server.ts only
export { createMockDayo, MOCK_API_KEY } from './handler.js'
export type { MockDayo, MockMode, MockOptions, MockOverride, MockState, PosCatalogChangedData, StoredOrder } from './state.js'
