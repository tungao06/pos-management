// packages/dayo-mock/src/state.ts — no node:* imports (the tablet's jsdom tests load this package)
import { PosCatalogResponse, supportedOf, type CentralOrder, type DayoEdit, type OrderRowData, type PosCatalogData, type ReceivedRowResult } from '@dayo/contracts'
import rich from '@dayo/contracts/fixtures/pos-test/e1-catalog-rich.json' with { type: 'json' }
import vendor from '@dayo/dayo-pricing/VENDOR.json' with { type: 'json' }

/**
 * The E1 the mock serves. Its `supported_fields` holds the push field lists only — what judge.ts checks rows against.
 * (E1 of dayo ≥ 0071 also carries `promotion_rule_versions` there as numbers, plan 10 F2; the mock adds that where it
 * builds the answer — plan 10 Task 5.)
 */
export type PosCatalogChangedData = Extract<PosCatalogData, { changed: true }> & { supported_fields: Record<string, string[]> } // not Omit: it drops the known keys of a loose object
export type CatalogPromotion = PosCatalogChangedData['catalog']['promotions'][number]
/** One priced menu × size × sweetness row of E1 (contracts `Variant`) — what a size needs before anything can be sold in it. */
export type CatalogVariant = PosCatalogChangedData['catalog']['variants'][number]
/** 'offline' = mock.fetch rejects with TypeError('Failed to fetch') — a real network failure for the tablet (the server drops the socket). */
export type MockMode = 'normal' | 'api_disabled' | 'rate_limited' | 'force_row_error' | 'server_down' | 'unauthorized' | 'forbidden' | 'hang' | 'offline'
export type MockOverride = { match: { receiptNo?: string; key?: string }; verdict: { status: string; reason?: string; detail?: string; data?: unknown }; times: number }
/** Every scope a tablet key can hold (spec §4.4); the default mock key has all four. */
export const ALL_SCOPES = ['catalog:read', 'staff:read', 'orders:read', 'orders:write'] as const
/** The default key of a block 3 mock (R15): the four above + shift:write (dayo 0065:302-304 · ADR-0069 1.4). */
export const BLOCK3_SCOPES = [...ALL_SCOPES, 'shift:write'] as const
export type MockOptions = {
  apiKey?: string                 // default MOCK_API_KEY (dayo_ + 64 hex)
  origins?: string[]              // default ['http://localhost:4173'] (vite preview of the e2e run)
  now?: string | null             // fixed server clock; null = real clock
  mode?: MockMode; retryAfterSec?: number; forbiddenMessage?: string
  scopes?: readonly string[]      // the key's scopes (default ALL_SCOPES) — a route whose scope is missing = 403 (dayo api_authenticate)
  catalog?: PosCatalogChangedData // default = e1-catalog-rich.json
  pricing?: { commit: string | null; files_sha256: Record<string, string> } // overrides catalog.pricing
  seedOrders?: CentralOrder[]     // bot/web bills E3 returns and duplicate_of compares with
  /**
   * R15 · preflight P3: true = dayo main 12885fe exactly (ADR-0069 PHASE 1): E1 advertises the four shift kinds and their
   * fields, the default key holds shift:write. Default false: block-2 tests keep their supported lists.
   */
  block3?: boolean
  /** Preflight P3: dayo ADR-0069 PHASE 2 on top of phase 1 (implies block3) — order_off_catalog, recompute, prefixes on order rows. */
  block3Phase2?: boolean
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
  /** Phase 1 on/off: the four shift kinds + their fields + shift:write (off also turns phase 2 off). Bumps catalog_version, returns it. */
  setBlock3(on: boolean): number
  /** Phase 2 on/off (on implies phase 1): + order_off_catalog and its fields, prefixes on order rows. Bumps catalog_version, returns it. */
  setBlock3Phase2(on: boolean): number
  shifts(): MockShift[]
  movements(): MockMovement[]
  counts(): MockCount[]
  /** The LIVE state objects (not copies) — a test may edit one to pin a rule no push can reach; nothing else may. */
  zReports(): MockZ[]
  /** shop_settings.block3_live_from (D100): shift_open sets it once; a test (or the owner's web edit) sets it directly. */
  setBlock3LiveFrom(d: string | null): void
  /** shop_settings.off_catalog_max_total in baht (D103 · default ฿3,000). */
  setOffCatalogCap(baht: number): void
  /** pos_push_rejections (0065:184-193 · dayo phase 1): every reason an `order` row of each bill was rejected with, in order seen. */
  rejections(): { posOrderId: string; reasons: string[] }[]
  /** Phase 2 only (a no-op on a phase-1 mock): judges every Z again, oldest number first — runs by itself after each accepted row that can change one. */
  recomputeAll(): void
  /** A Z another install of this key sent earlier (reinstall tests — R9): counts for rules 0–5 and E1 last_z_*. */
  preloadZ(z: { zNo: number; hash: string; countedAt: string }): void
  /** Shift data-conflict flags (S5) the mock raised, as `<kind>:<shift id>` — kind 'key_changed' | 'counted' | 'z_no_taken' | 'z_no_ceiling' | 'counted_mismatch'. */
  conflicts(): string[]
}

/** dayo `shifts` (0065) as the mock keeps it · times in ms. */
export type MockShift = {
  id: string; businessDate: string; openedAt: number; openedBy: string; openingFloat: number; quickOpen: boolean
  status: 'open' | 'counted' | 'closed'; closedBy: string | null; closedAt: number | null; dataConflict: boolean
}
export type MockMovement = { id: string; shiftId: string; kind: 'PAID_IN' | 'PAID_OUT' | 'DROP' | 'VOID_REFUND'; amount: number; posOrderId: string | null; reason: string | null; createdBy: string; createdAt: number }
export type MockCount = { id: string; shiftId: string; counted: number; countedBy: string; countedAt: number }
/**
 * dayo `z_reports` (0065) as the mock keeps it. first_of_key / quarantined / chain_break are dayo phase 1 (0066:528-550) ·
 * notes, chainMismatch, recomputeStatus, detail and missing model the phase-2 recompute (spec 04 §4.10 rules 1–7) — never on
 * the wire (dayo has no API that returns a Z), only read by mock tests. On a phase-1 mock they stay empty and
 * recomputeStatus stays null, as dayo main 12885fe leaves recompute_status (preflight P1/P3).
 */
export type MockZ = {
  shiftId: string; zNo: number; hash: string; prevHash: string | null; after: number; countedAt: number; wire: Record<string, unknown>
  firstOfKey: boolean                                // rule 2: the key had no Z when this one arrived
  quarantined: boolean                               // §13.8 R5-3: failed rule 5 (replay / out-of-order low z_no) — never "the previous Z" of anyone
  chainBreak: boolean; notes: string[]; chainMismatch: string[]; recomputeStatus: 'waiting_bills' | 'matched' | 'mismatch' | null; detail: string[]
  missing: { posOrderIds: string[]; movementIds: string[]; voidOrderIds: string[] }
}

/** An order row as dayo_pos_order reads it (optional keys may be absent → null / [] / false). */
export type MockOrderLine = { code: string; size: string; sweetness: string; milk: 'fresh' | 'oat'; grade: string | null; qty: number; free: boolean | null; discount_baht: number | null; discount_percent: number | null; discount_reason: string | null }
export type MockTotals = { items_subtotal: number; items_discount: number; bill_discount: number; total: number }
export type MockOrderData = {
  pos_order_id: string; receipt_no: string; queue_no: number; sale_date: string; sold_at: string; channel: string; payment: string; staff_id: string
  catalog_version: number; shift_id: string | null; lines: MockOrderLine[]; bill_discount: { baht: number | null; percent: number | null; reason: string | null } | null
  promo_code: string | null; skip_promotion_ids: string[]; no_promotions: boolean; totals: MockTotals; note: string | null
}
/**
 * `total` and `data.payment` are what the tablet reported at sale (pos_reported_amounts — frozen, D93); editPosOrder changes
 * `data.totals` only. `offCatalog` = an order_off_catalog bill (phase 2): `data.lines` is [] (no order_items in dayo).
 */
export type StoredOrder = {
  orderNo: string; posOrderId: string; receiptNo: string; saleDate: string; soldAt: string; total: number; status: 'ok' | 'cancelled'; version: number
  staffId: string | null; data: MockOrderData | null; offCatalog: boolean
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
  // ── block 3 (spec 04 §4.10) ──
  block3: boolean; block3Phase2: boolean
  shifts: Map<string, MockShift>             // by shift id
  movements: Map<string, MockMovement>       // by movement id
  counts: Map<string, MockCount>             // by count id (one per shift)
  zReports: Map<string, MockZ>               // by shift id
  preloadedZ: { zNo: number; hash: string; countedAt: number } | null
  conflicts: string[]
  block3LiveFrom: string | null              // shop_settings.block3_live_from (ADR-0056 rule 12 · D100) — set once
  offCatalogCap: number                       // shop_settings.off_catalog_max_total, baht (D103 · default 3000)
  rejections: Map<string, Set<string>>        // pos_push_rejections: pos_order_id → reasons (0066:993-1002)
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
  // E1 `pricing` = the vendored pin: the mock plays a dayo running the exact pricing code the tablet vendored, so a
  // `vendor:update` never needs this fixture's hashes edited by hand (a test wanting a mismatch sets `opts.pricing`
  // or mutates `catalog.pricing`).
  const fields = Object.fromEntries(Object.entries(supportedOf(d.supported_kinds, d.supported_fields).fields).map(([k, v]) => [k, [...v]]))
  return { ...structuredClone(d), supported_fields: fields, pricing: { commit: vendor.commit, files_sha256: { ...vendor.files } } }
}
