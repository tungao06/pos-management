// packages/dayo-mock/src/state.ts — no node:* imports (the tablet's jsdom tests load this package)
import { PosCatalogResponse, type CentralOrder, type OrderRowData, type PosCatalogData, type ReceivedRowResult } from '@dayo/contracts'
import rich from '@dayo/contracts/fixtures/pos-test/e1-catalog-rich.json' with { type: 'json' }

export type PosCatalogChangedData = Extract<PosCatalogData, { changed: true }>
export type MockMode = 'normal' | 'api_disabled' | 'rate_limited' | 'force_row_error' | 'server_down' | 'unauthorized' | 'forbidden' | 'hang'
export type MockOverride = { match: { receiptNo?: string; key?: string }; verdict: { status: string; reason?: string; detail?: string; data?: unknown }; times: number }
export type MockOptions = {
  apiKey?: string                 // default MOCK_API_KEY (dayo_ + 64 hex)
  origins?: string[]              // default ['http://localhost:4173'] (vite preview of the e2e run)
  now?: string | null             // fixed server clock; null = real clock
  mode?: MockMode; retryAfterSec?: number; forbiddenMessage?: string
  catalog?: PosCatalogChangedData // default = e1-catalog-rich.json
  pricing?: { commit: string; files_sha256: Record<string, string> } // overrides catalog.pricing
  seedOrders?: CentralOrder[]     // bot/web bills E3 returns and duplicate_of compares with
}
export type MockDayo = {
  handle(req: Request): Promise<Response>
  fetch: typeof fetch            // in-process: tests pass it as ApiDeps.fetch
  setMode(mode: MockMode): void
  setNow(iso: string | null): void
  override(o: MockOverride): void
  bumpCatalog(mutate?: (c: PosCatalogChangedData) => void): number
  seedCentralOrders(orders: CentralOrder[]): void
  preloadAccepted(row: { key: string; kind: 'order'; data: OrderRowData }, result: Record<string, unknown>): void  // as if pushed earlier
  preloadOrder(o: { posOrderId: string; receiptNo: string; saleDate: string; soldAt: string; orderNo: string; total: number }): void
  setNextOrderNo(saleDate: string, n: number): void
  orders(): { posOrderId: string; orderNo: string; receiptNo: string; status: 'ok' | 'cancelled'; total: number }[]
  requests(): { method: string; path: string; rows: number; status: number }[]   // every /api/v1 call, refused ones included
  reset(): void
}

export type StoredOrder = { orderNo: string; posOrderId: string; receiptNo: string; saleDate: string; soldAt: string; total: number; status: 'ok' | 'cancelled'; version: number; staffId: string | null; data: OrderRowData | null }
export type MockState = {
  apiKey: string; origins: string[]; fixedNow: number | null; mode: MockMode; retryAfterSec: number; forbiddenMessage: string
  catalog: PosCatalogChangedData; pricing: { commit: string; files_sha256: Record<string, string> } | null
  orders: Map<string, StoredOrder>            // by pos_order_id
  receipts: Map<string, string>               // receipt_no → pos_order_id
  keys: Map<string, { hash: string; result: ReceivedRowResult }> // accepted/duplicate only (spec §4.5 การกันซ้ำ)
  seq: Map<string, number>                    // next order_no per sale_date
  overrides: MockOverride[]
  seedOrders: CentralOrder[]
  log: { method: string; path: string; rows: number; status: number }[]
}

export function freshCatalog(): PosCatalogChangedData {
  const d = PosCatalogResponse.parse(rich).data
  if (!d.changed) throw new Error('e1-catalog-rich.json must be changed:true')
  return structuredClone(d)
}
