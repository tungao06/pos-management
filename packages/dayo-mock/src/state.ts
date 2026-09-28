// packages/dayo-mock/src/state.ts — no node:* imports (the tablet's jsdom tests load this package)
import { PosCatalogResponse, type CentralOrder, type DayoEdit, type OrderRowData, type PosCatalogData, type ReceivedRowResult } from '@dayo/contracts'
import rich from '@dayo/contracts/fixtures/pos-test/e1-catalog-rich.json' with { type: 'json' }

export type PosCatalogChangedData = Extract<PosCatalogData, { changed: true }>
export type CatalogPromotion = PosCatalogChangedData['catalog']['promotions'][number]
/** One priced menu × size × sweetness row of E1 (contracts `Variant`) — what a size needs before anything can be sold in it. */
export type CatalogVariant = PosCatalogChangedData['catalog']['variants'][number]
export type MockMode = 'normal' | 'api_disabled' | 'rate_limited' | 'force_row_error' | 'server_down' | 'unauthorized' | 'forbidden' | 'hang'
export type MockOverride = { match: { receiptNo?: string; key?: string }; verdict: { status: string; reason?: string; detail?: string; data?: unknown }; times: number }
/** Every scope a tablet key can hold (spec §4.4); the default mock key has all four. */
export const ALL_SCOPES = ['catalog:read', 'staff:read', 'orders:read', 'orders:write'] as const
export type MockOptions = {
  apiKey?: string                 // default MOCK_API_KEY (dayo_ + 64 hex)
  origins?: string[]              // default ['http://localhost:4173'] (vite preview of the e2e run)
  now?: string | null             // fixed server clock; null = real clock
  mode?: MockMode; retryAfterSec?: number; forbiddenMessage?: string
  scopes?: readonly string[]      // the key's scopes (default ALL_SCOPES) — a route whose scope is missing = 403 (dayo api_authenticate)
  catalog?: PosCatalogChangedData // default = e1-catalog-rich.json
  pricing?: { commit: string | null; files_sha256: Record<string, string> } // overrides catalog.pricing
  seedOrders?: CentralOrder[]     // bot/web bills E3 returns and duplicate_of compares with
}
/** The owner's edit/cancel of a POS bill on the dayo web (ADR-0050) — what E3 then reports as `dayo_edit`. */
export type PosOrderEdit = {
  kind: 'edit' | 'cancel'; reason: string
  editedAt?: string                // default = the mock's now
  editedByName?: string | null     // default = the shop's first owner in E1 staff
  totals?: Partial<MockTotals>     // dayo re-prices an edited bill; the tablet's reported amounts stay frozen
}
export type MockDayo = {
  handle(req: Request): Promise<Response>
  fetch: typeof fetch            // in-process: tests pass it as ApiDeps.fetch
  setMode(mode: MockMode): void
  setNow(iso: string | null): void
  setScopes(scopes: readonly string[]): void
  override(o: MockOverride): void
  bumpCatalog(mutate?: (c: PosCatalogChangedData) => void): number
  /** dayo_promo_active_at: the promotion is inactive from `at` on; it leaves E1 and the catalog version bumps. Returns the new version. */
  closePromotion(id: string, at: string): number
  editPosOrder(posOrderId: string, edit: PosOrderEdit): void
  seedCentralOrders(orders: CentralOrder[]): void
  preloadAccepted(row: { key: string; kind: 'order'; data: OrderRowData }, result: Record<string, unknown>): void  // as if pushed earlier
  preloadOrder(o: { posOrderId: string; receiptNo: string; saleDate: string; soldAt: string; orderNo: string; total: number }): void
  setNextOrderNo(saleDate: string, n: number): void
  orders(): { posOrderId: string; orderNo: string; receiptNo: string; status: 'ok' | 'cancelled'; total: number }[]
  requests(): { method: string; path: string; rows: number; status: number }[]   // every /api/v1 call, refused ones included
  reset(): void
}

/** An order row as dayo_pos_order reads it (optional keys may be absent → null / [] / false). */
export type MockOrderLine = { code: string; size: string; sweetness: string; milk: 'fresh' | 'oat'; grade: string | null; qty: number; free: boolean | null; discount_baht: number | null; discount_percent: number | null; discount_reason: string | null }
export type MockTotals = { items_subtotal: number; items_discount: number; bill_discount: number; total: number }
export type MockOrderData = {
  pos_order_id: string; receipt_no: string; queue_no: number; sale_date: string; sold_at: string; channel: string; payment: string; staff_id: string
  catalog_version: number; shift_id: string | null; lines: MockOrderLine[]; bill_discount: { baht: number | null; percent: number | null; reason: string | null } | null
  promo_code: string | null; skip_promotion_ids: string[]; no_promotions: boolean; totals: MockTotals; note: string | null
}
export type StoredOrder = {
  orderNo: string; posOrderId: string; receiptNo: string; saleDate: string; soldAt: string; total: number; status: 'ok' | 'cancelled'; version: number
  staffId: string | null; data: MockOrderData | null
  computedTotal: number; amountMismatch: boolean; createdAt: number; updatedAt: number | null; dayoEdit: DayoEdit | null
}
/**
 * What dayo's tables still hold after E1 stopped sending it: menu items, variants, channels, payment methods and options are
 * never deleted (a code in use cannot be — ADR-0054 rule 1; closed ones are still accepted — ADR-0049 rule 5), so a bill sold
 * on an older catalog is judged against every code the mock has ever served.
 */
export type KnownCodes = { menus: Map<string, boolean>; variants: Set<string>; channels: Set<string>; payments: Set<string>; milk: Set<string>; grades: Set<string> }
export type MockState = {
  apiKey: string; origins: string[]; fixedNow: number | null; mode: MockMode; retryAfterSec: number; forbiddenMessage: string; scopes: string[]
  catalog: PosCatalogChangedData; pricing: { commit: string | null; files_sha256: Record<string, string> } | null
  known: KnownCodes
  closedPromotions: Map<string, { promotion: CatalogPromotion; closedAt: number }>
  orders: Map<string, StoredOrder>            // by pos_order_id
  receipts: Map<string, string>               // receipt_no → pos_order_id
  keys: Map<string, { hash: string; result: ReceivedRowResult }> // accepted/duplicate only (spec §4.5 การกันซ้ำ)
  seq: Map<string, number>                    // next order_no per sale_date
  overrides: MockOverride[]
  seedOrders: CentralOrder[]
  log: { method: string; path: string; rows: number; status: number }[]
}

export const variantKey = (code: string, size: string, sweetness: string): string => JSON.stringify([code, size, sweetness])

export function emptyKnown(): KnownCodes {
  return { menus: new Map(), variants: new Set(), channels: new Set(), payments: new Set(), milk: new Set(), grades: new Set() }
}

/** Adds what this catalog lists to what dayo is known to hold (a code once seen is never forgotten). Tolerates a broken catalog. */
export function learnCatalog(k: KnownCodes, c: PosCatalogChangedData): void {
  const cat = c.catalog as Partial<PosCatalogChangedData['catalog']> | null
  for (const v of cat?.variants ?? []) {
    k.menus.set(v.menuCode, v.isMatcha)
    k.variants.add(variantKey(v.menuCode, v.size, v.sweetness))
  }
  for (const x of cat?.channels ?? []) k.channels.add(x.code)
  for (const x of cat?.paymentMethods ?? []) k.payments.add(x.code)
  for (const x of cat?.milkOptions ?? []) k.milk.add(x.code)
  for (const x of cat?.gradeOptions ?? []) k.grades.add(x.code)
}

/**
 * Task 21 hotfix 2: adds or replaces variants the way dayo's web does — one row per (menuCode, size, sweetness). A row
 * that matches an existing one replaces it in place; a new one is appended; every other variant stays as it was (a
 * whole-array replace would drop every other menu's prices).
 */
export function mergeVariants(c: PosCatalogChangedData, variants: readonly CatalogVariant[]): void {
  const list = c.catalog.variants
  for (const v of variants) {
    const key = variantKey(v.menuCode, v.size, v.sweetness)
    const at = list.findIndex((x) => variantKey(x.menuCode, x.size, x.sweetness) === key)
    if (at === -1) list.push(structuredClone(v))
    else list[at] = structuredClone(v)
  }
}

export function freshCatalog(): PosCatalogChangedData {
  const d = PosCatalogResponse.parse(rich).data
  if (!d.changed) throw new Error('e1-catalog-rich.json must be changed:true')
  return structuredClone(d)
}
