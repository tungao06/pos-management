import { z } from 'zod'

/*
 * The contract of dayo /api/v1 used by the tablet (spec 04 §4). Source of truth = dayo SQL on `main`:
 *   E1 GET  /v1/pos/catalog  → 0049 api_pos_catalog + 0048 dayo_impl_get_full_catalog (+ 0047 dayo_sale_settings_json)
 *   E2 POST /v1/pos/push     → 0052 api_pos_push / dayo_pos_push_row / dayo_pos_order / dayo_pos_void / dayo_pos_map_error
 *   E3 GET  /v1/orders       → 0052 list_api_orders + 0051 dayo_order_dayo_edit
 * What the tablet SENDS is strict (it must never send a row dayo would reject for its shape).
 * What the tablet RECEIVES is loose (unknown keys pass; nullable wherever the SQL can produce null).
 */

// ── limits (spec 04 §4.1, §4.5, §6.2 · 0052) ───────────────────────────────────────────────────────────────────────
export const MAX_PUSH_ROWS = 20
export const MAX_PUSH_BODY_BYTES = 262_144
export const MAX_ROW_KEY_LENGTH = 200
/** dayo cuts `detail` of a verdict to 500 characters (dayo_pos_verdict `left(…, 500)`). */
export const MAX_DETAIL_CODE_POINTS = 500
export const TEXT_MAX_CODE_POINTS = 200
export const API_KEY_RE = /^dayo_[0-9a-f]{64}$/
/** receipt_no the tablet sends (dayo_pos_order: `^[A-Z]{1,3}-[0-9]{6}$`). Not applied to `client.last_receipt_no`. */
export const RECEIPT_NO_RE = /^[A-Z]{1,3}-\d{6}$/
/** Row key dayo accepts (dayo_pos_push_row): `<kind>:<lowercase uuid>`, kind `^[a-z][a-z_]{0,39}$`. */
export const ROW_KEY_RE = /^[a-z][a-z_]{0,39}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** cup_sizes.code CHECK (0048) = SIZE_CODE_PATTERN of @dayo/shared types.ts (ADR-0054). */
export const SIZE_CODE_RE = /^[1-9][0-9]{0,2} oz$/
export const PUSH_KINDS = ['order', 'order_void'] as const
export type PushKind = (typeof PUSH_KINDS)[number]
export const KNOWN_ROW_STATUSES = ['accepted', 'duplicate', 'rejected', 'deferred'] as const
/** Every `rejected` reason 0052 can emit (ALREADY_PRESENT of the old draft is withdrawn — spec 04 §13.8 C1). */
export const KNOWN_REJECT_REASONS = ['INVALID', 'BAD_KEY', 'UNKNOWN_CODE', 'UNKNOWN_STAFF', 'CONFLICT', 'FORBIDDEN'] as const
/** Every `deferred` reason 0052 can emit. */
export const KNOWN_DEFER_REASONS = ['PARENT_PENDING', 'BUSY', 'CLOCK_AHEAD', 'UNSUPPORTED', 'SERVER_ERROR'] as const

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Shortens to `max` CODE POINTS — never strands half a surrogate pair (plan 5 `clip`, fix N4-2). */
export function clipCodePoints(text: string, max: number): string {
  const points = [...text]
  return points.length <= max ? text : points.slice(0, max).join('')
}

/** Thai calendar date (YYYY-MM-DD) of an instant — `(ts at time zone 'Asia/Bangkok')::date` (no DST in Thailand). */
export function bangkokDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10)
}

export const rowKey = (kind: PushKind, id: string): string => `${kind}:${id}`

// ── scalars (spec 04 §4.1) ─────────────────────────────────────────────────────────────────────────────────────────
export const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
const isInstant = (s: string): boolean => !Number.isNaN(Date.parse(s))
/** Times the tablet SENDS: UTC with milliseconds. */
export const IsoSent = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(isInstant, 'not a real instant')
/** Times the tablet RECEIVES: Postgres timestamptz JSON text — any fraction length, `Z` or `±HH:MM`. */
export const IsoReceived = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/).refine(isInstant, 'not a real instant')
export const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
/**
 * Baht the tablet SENDS = what dayo_pos_is_money accepts: ≥ 0, ≤ 99,999,999.99 and `numeric*100 = trunc(numeric*100)`
 * on the JSON TEXT. So the shortest decimal form of the double (what JSON.stringify writes) must have ≤ 2 decimals:
 * satang/100 always does; 0.1 + 0.2 (→ "0.30000000000000004") does not and dayo would reject it INVALID.
 */
export const Baht = z.number().nonnegative().max(99_999_999.99).refine((v) => /^\d+(\.\d{1,2})?$/.test(String(v)), 'more than 2 decimals')
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/
/** dayo_pos_is_text: 1..max code points · no C0/DEL · not blank after trimming spaces (Postgres btrim). */
const posText = (max: number) =>
  z.string().refine((s) => {
    const n = [...s].length
    return n >= 1 && n <= max && !CONTROL_RE.test(s) && s.replace(/^ +| +$/g, '') !== ''
  }, `1–${max} code points, no control characters, not blank`)
export const Text200 = posText(TEXT_MAX_CODE_POINTS)
/** Cup size `<n> oz` — the shop configures its sizes (ADR-0054); the real list is `PosOrderCatalog.sizes`. */
export const SizeCode = z.string().regex(SIZE_CODE_RE)
export type SizeCode = z.infer<typeof SizeCode>
export const SweetnessCode = z.enum(['0%', '25%', '50%', '75%', '100%'])
export type SweetnessCode = z.infer<typeof SweetnessCode>
export const MilkCodeSchema = z.enum(['fresh', 'oat'])
export type MilkCode = z.infer<typeof MilkCodeSchema>
/** Promotion time of day: `HH:MM` (shared) or Postgres `time` text `HH:MM:SS[.ffffff]` (0048 get_full_catalog). */
export const TimeOfDay = z.string().regex(/^\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?$/)

// ── E1 catalog = OrderCatalog of @dayo/shared without cost (spec §4.4 rule 1 · 0048 dayo_impl_get_full_catalog) ────
// Anything the vendored pricing code reads is checked here; a catalog it cannot understand is refused whole (ruling R12).
const CatalogUseUnit = z.enum(['ml', 'g', 'ชิ้น'])
const numberish = z.number()
/** cup_sizes row (ADR-0054) — includes sizes that are switched off (isActive:false). */
export const CupSize = z.looseObject({ code: SizeCode, label: z.string(), sortOrder: z.number().int(), isActive: z.boolean() })
export type CupSize = z.infer<typeof CupSize>
const RecipeLine = z.looseObject({ ingredientId: z.string().nullable().optional(), baseId: z.string().nullable().optional(), qty: numberish, unit: CatalogUseUnit })
const Variant = z.looseObject({
  menuCode: z.string().min(1), menuNameTh: z.string(), family: z.string(),
  categoryLabel: z.string().nullable().optional(), menuSortOrder: z.number().int().optional(),
  size: SizeCode, sweetness: SweetnessCode, price: z.number().nonnegative(), allowOatMilk: z.boolean(), isMatcha: z.boolean(), recipeLines: z.array(RecipeLine),
})
const Ingredient = z.looseObject({ id: z.string(), code: z.string(), name: z.string(), useUnit: CatalogUseUnit })
const Base = z.looseObject({ id: z.string(), code: z.string(), name: z.string(), yieldQty: numberish, yieldUnit: z.enum(['ml', 'g']), lines: z.array(z.looseObject({ ingredientId: z.string(), qty: numberish })) })
// menu_options.ingredient_id and .multiplier are nullable columns (0002) — they only feed cost, never price.
const MilkOption = z.looseObject({ code: MilkCodeSchema, ingredientId: z.string().nullable(), priceAdd: numberish, aliases: z.array(z.string()) })
const GradeOption = z.looseObject({ code: z.string().min(1), ingredientId: z.string().nullable(), multiplier: numberish.nullable(), priceAdd: numberish, isDefault: z.boolean(), aliases: z.array(z.string()) })
const Channel = z.looseObject({ code: z.string().min(1), name: z.string(), aliases: z.array(z.string()), priceMarkupPct: numberish, priceAddBaht: numberish, rounding: z.enum(['ceil_baht', 'none']), feePct: numberish, defaultPaymentMethodCode: z.string().nullable() })
const PaymentMethodEntry = z.looseObject({ code: z.string().min(1), name: z.string(), aliases: z.array(z.string()) })
const promoCommon = {
  id: z.string(), code: z.string().nullable(), name: z.string(),
  startsOn: Ymd.nullable().optional(), endsOn: Ymd.nullable().optional(), daysOfWeek: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  timeFrom: TimeOfDay.nullable().optional(), timeTo: TimeOfDay.nullable().optional(), channelCodes: z.array(z.string()).nullable().optional(),
  requiresCode: z.boolean(), autoApply: z.boolean(), priority: numberish, stackable: z.boolean(), isActive: z.boolean(),
}
const codes = z.array(z.string())
const Promotion = z.discriminatedUnion('kind', [
  z.looseObject({ ...promoCommon, kind: z.literal('buy_n_get_m'), params: z.looseObject({ buy_qty: z.number().int().min(1), get_qty: z.number().int().min(1), menu_codes: codes, max_sets: z.number().int().optional() }) }),
  z.looseObject({ ...promoCommon, kind: z.literal('item_discount'), params: z.looseObject({ menu_codes: codes, amount_baht: numberish.optional(), percent: numberish.optional() }) }),
  z.looseObject({ ...promoCommon, kind: z.literal('bill_discount'), params: z.looseObject({ min_subtotal: numberish.optional(), amount_baht: numberish.optional(), percent: numberish.optional(), max_amount: numberish.optional() }) }),
  z.looseObject({ ...promoCommon, kind: z.literal('bundle'), params: z.looseObject({ items: z.array(z.looseObject({ menu_codes: codes, qty: z.number().int().min(1) })).min(1), bundle_price: numberish, max_sets: z.number().int().optional() }) }),
])
const SaleSettings = z.looseObject({
  shopName: z.string(), defaultSize: SizeCode, defaultSweetness: SweetnessCode, defaultChannelCode: z.string(), defaultMilk: MilkCodeSchema,
  maxQtyPerLine: z.number().int().min(1), backdateDays: z.number().int(), recentOrdersCount: z.number().int(),
}).partial()
export const PosOrderCatalog = z.looseObject({
  settings: SaleSettings.nullable().optional(),
  sizes: z.array(CupSize),
  variants: z.array(Variant), ingredients: z.record(z.string(), Ingredient), bases: z.record(z.string(), Base),
  milkOptions: z.array(MilkOption), gradeOptions: z.array(GradeOption), channels: z.array(Channel), paymentMethods: z.array(PaymentMethodEntry), promotions: z.array(Promotion),
})
export type PosOrderCatalogParsed = z.infer<typeof PosOrderCatalog>

/** staff of the shop, active + removed (0049) — role is dayo's text, unknown roles are the caller's problem. */
export const StaffEntry = z.looseObject({ id: Uuid, display_name: z.string().nullable(), role: z.string(), active: z.boolean() })
export type StaffEntry = z.infer<typeof StaffEntry>
/** commit = dayo WEB_VERSION text ("v1.3.0 (a8e3ff0)" / "dev"), null when the route sent none (0049). */
export const PricingInfo = z.looseObject({ commit: z.string().nullable(), files_sha256: z.record(z.string(), z.string()) })
export type PricingInfo = z.infer<typeof PricingInfo>
/** last_receipt_no = external_ref of this key's newest order, raw (any text) — Task 11 checks its shape when numbering. */
export const ClientInfo = z.looseObject({ name: z.string(), last_receipt_no: z.string().nullable() })
export type ClientInfo = z.infer<typeof ClientInfo>
const e1Common = {
  catalog_version: z.number().int().min(1), server_time: IsoReceived, pricing: PricingInfo,
  supported_kinds: z.array(z.string()), supported_fields: z.record(z.string(), z.array(z.string())),
}
export const PosCatalogUnchanged = z.looseObject({ changed: z.literal(false), ...e1Common })
export const PosCatalogChanged = z.looseObject({ changed: z.literal(true), ...e1Common, client: ClientInfo, staff: z.array(StaffEntry), catalog: PosOrderCatalog })
export const PosCatalogData = z.discriminatedUnion('changed', [PosCatalogChanged, PosCatalogUnchanged])
export type PosCatalogData = z.infer<typeof PosCatalogData>
export const PosCatalogResponse = z.looseObject({ ok: z.literal(true), data: PosCatalogData })
/**
 * ruling R12: what the tablet parses FIRST — everything strict except `catalog`, which is checked on its own so a
 * catalog the pricing code cannot read never throws away staff (a removed employee must be locked out at once),
 * supported_*, pricing or server_time.
 */
export const PosCatalogLooseData = z.discriminatedUnion('changed', [
  z.looseObject({ changed: z.literal(true), ...e1Common, client: ClientInfo, staff: z.array(StaffEntry), catalog: z.unknown() }),
  PosCatalogUnchanged,
])
export type PosCatalogLooseData = z.infer<typeof PosCatalogLooseData>
export const PosCatalogLooseResponse = z.looseObject({ ok: z.literal(true), data: PosCatalogLooseData })

// ── E2 request: what the tablet SENDS is strict (spec §4.5 · 0052 dayo_pos_order / dayo_pos_void) ──────────────────
export const OrderLineData = z.strictObject({
  code: posText(100), size: SizeCode, sweetness: SweetnessCode, milk: MilkCodeSchema, grade: posText(100).nullable(),
  qty: z.number().int().min(1).max(999),
  free: z.boolean().optional(), discount_baht: Baht.nullable().optional(), discount_percent: z.number().min(0).max(100).nullable().optional(), discount_reason: Text200.nullable().optional(),
}).refine((l) => l.discount_baht == null || l.discount_percent == null, { message: 'discount_baht and discount_percent together', path: ['discount_percent'] })
export type OrderLineData = z.infer<typeof OrderLineData>
const BillDiscountData = z.strictObject({ baht: Baht.optional(), percent: z.number().min(0).max(100).optional(), reason: Text200.nullable().optional() })
  .refine((b) => (b.baht === undefined) !== (b.percent === undefined), 'exactly one of baht or percent')
export const OrderRowData = z.strictObject({
  pos_order_id: Uuid, receipt_no: z.string().regex(RECEIPT_NO_RE), queue_no: z.number().int().min(1).max(9999),
  sale_date: Ymd, sold_at: IsoSent, channel: posText(100), payment: posText(100),
  staff_id: Uuid, catalog_version: z.number().int().min(1), shift_id: Uuid.nullable(),
  lines: z.array(OrderLineData).min(1).max(50), bill_discount: BillDiscountData.nullable(),
  promo_code: posText(100).nullable(), skip_promotion_ids: z.array(Uuid), no_promotions: z.boolean(),
  totals: z.strictObject({ items_subtotal: Baht, items_discount: Baht, bill_discount: Baht, total: Baht }),
  note: Text200.nullable(),
}).superRefine((d, ctx) => {
  if (bangkokDateOf(d.sold_at) !== d.sale_date) ctx.addIssue({ code: 'custom', path: ['sale_date'], message: 'sale_date must be the Thai date of sold_at' })
  if (d.lines.reduce((a, l) => a + l.qty, 0) > 500) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'more than 500 cups' })
})
export type OrderRowData = z.infer<typeof OrderRowData>
export const OrderVoidRowData = z.strictObject({ pos_order_id: Uuid, voided_at: IsoSent, staff_id: Uuid, approved_by: Uuid.nullable(), reason: Text200 })
export type OrderVoidRowData = z.infer<typeof OrderVoidRowData>
const rowKeyField = z.string().max(MAX_ROW_KEY_LENGTH).regex(ROW_KEY_RE)
export const PushRow = z.discriminatedUnion('kind', [
  z.strictObject({ key: rowKeyField, kind: z.literal('order'), data: OrderRowData }),
  z.strictObject({ key: rowKeyField, kind: z.literal('order_void'), data: OrderVoidRowData }),
]).refine((r) => r.key === rowKey(r.kind, r.data.pos_order_id), { message: 'key must be <kind>:<pos_order_id>', path: ['key'] })
export type PushRow = z.infer<typeof PushRow>
/** dayo ignores `device_time` today; the tablet still sends it (spec §4.5 — clock diagnostics). */
export const PushRequest = z.strictObject({ device_time: IsoSent, rows: z.array(PushRow).min(1).max(MAX_PUSH_ROWS) })
export type PushRequest = z.infer<typeof PushRequest>
/** Envelope only (0052: a bad row is that row's verdict, only a bad envelope is a 422 of the whole request) — for the mock. */
export const PushEnvelope = z.looseObject({ rows: z.array(z.unknown()).min(1).max(MAX_PUSH_ROWS) })
export type PushEnvelope = z.infer<typeof PushEnvelope>

// ── E2 response: what the tablet RECEIVES is tolerant (spec §4.1 · 0052 api_pos_push) ──────────────────────────────
/**
 * One verdict. `key` = the sent key cut to 200, or null when the sent row was not an object with a string key (0052:748
 * — the sender cannot match it: keep the row pending, do not count an attempt). reason/detail/data are left out when null.
 */
export const ReceivedRowResult = z.looseObject({
  key: z.string().nullable(), status: z.string(), reason: z.string().nullable().optional(), detail: z.string().nullable().optional(), data: z.unknown().optional(),
})
export type ReceivedRowResult = z.infer<typeof ReceivedRowResult>
/** data of accepted/duplicate `order` (dayo_pos_order_data) — no cost. */
export const OrderAcceptedData = z.looseObject({
  order_no: z.string(), version: z.number().int(), computed_total: z.number().nonnegative().nullable(), amount_mismatch: z.boolean().nullable(),
  duplicate_of: z.array(z.string()), warnings: z.array(z.string()),
})
export type OrderAcceptedData = z.infer<typeof OrderAcceptedData>
/** data of accepted/duplicate `order_void`. */
export const OrderVoidAcceptedData = z.looseObject({ order_no: z.string(), version: z.number().int() })
export type OrderVoidAcceptedData = z.infer<typeof OrderVoidAcceptedData>
export const PushResponseData = z.looseObject({ server_time: IsoReceived, results: z.array(ReceivedRowResult) })
export type PushResponseData = z.infer<typeof PushResponseData>
export const PushResponse = z.looseObject({ ok: z.literal(true), data: PushResponseData })
export type PushResponse = z.infer<typeof PushResponse>
/** Every non-2xx answer of /api/v1 (lib/api/response.ts): code = DY401 · DY403 · DY404 · DY409 · DY422 · DY429 · DY500 … */
export const ApiErrorBody = z.looseObject({ ok: z.literal(false), error: z.looseObject({ code: z.string(), message: z.string() }) })
export type ApiErrorBody = z.infer<typeof ApiErrorBody>

// ── E3 (spec §4.6 · 0052 list_api_orders) ──────────────────────────────────────────────────────────────────────────
/**
 * The latest web edit/cancel of a bill by the shop (0051 dayo_order_dayo_edit — ADR-0050). edited_by_name and reason are
 * null for a key without staff:read. Block 2 shows it read-only (owner question O1).
 */
export const DayoEdit = z.looseObject({
  kind: z.string(), edited_at: IsoReceived, edited_by_name: z.string().nullable(), reason: z.string().nullable(), version: z.number().int().nullable(),
})
export type DayoEdit = z.infer<typeof DayoEdit>
export const CentralOrder = z.looseObject({
  order_no: z.string(), sale_date: Ymd, status: z.string(), source: z.string(), external_ref: z.string().nullable(), version: z.number().int(),
  channel: z.string().nullable(), payment: z.string().nullable(),
  totals: z.looseObject({ items_subtotal: z.number(), items_discount: z.number(), bill_discount: z.number(), total: z.number(), fee: z.number().nullable().optional() }),
  amount_mismatch: z.boolean().nullable(), updated_at: IsoReceived.nullable(),
  sold_at: IsoReceived.nullable().optional(), created_by_name: z.string().nullable().optional(), pos_receipt_no: z.string().nullable().optional(),
  pos_queue_no: z.number().int().nullable().optional(), catalog_version: z.number().int().nullable().optional(), duplicate_suspect: z.boolean().optional(),
  /** only for bills of THIS api key; null for everything else */
  pos_order_id: Uuid.nullable().optional(),
  dayo_edit: DayoEdit.nullable().optional(),
})
export type CentralOrder = z.infer<typeof CentralOrder>
export const OrdersListResponse = z.looseObject({ ok: z.literal(true), data: z.array(CentralOrder) })
export type OrdersListResponse = z.infer<typeof OrdersListResponse>

// ── supported kinds/fields (spec §4.4 rule 10 · 0049 dayo_pos_supported) ───────────────────────────────────────────
/** Every key present in `data` (value irrelevant); keys inside an ARRAY of objects are named `array.key` (lines.milk). */
export function fieldsUsed(data: Record<string, unknown>): string[] {
  const out = new Set<string>()
  for (const [k, v] of Object.entries(data)) {
    out.add(k)
    if (Array.isArray(v)) for (const item of v) if (item !== null && typeof item === 'object' && !Array.isArray(item)) for (const sub of Object.keys(item)) out.add(`${k}.${sub}`)
  }
  return [...out].sort()
}
export type Supported = { kinds: readonly string[]; fields: Readonly<Record<string, readonly string[]>> }
export function isRowSupported(kind: string, data: Record<string, unknown>, s: Supported): boolean {
  if (!s.kinds.includes(kind)) return false
  const allowed = new Set(s.fields[kind] ?? [])
  return fieldsUsed(data).every((f) => allowed.has(f))
}

// ── parity file = pos-parity.json of dayo `npm run pos:parity` (scripts/export-pos-parity.ts · spec §5.2 layer B → C) ─
// File: {dayo_commit, generated_at, pricing_files_sha256, catalog, cases:[{spec, note, draft, expected}]} (ruling R15).
// draft = dayo's own OrderDraft (camelCase); expected = QuoteResult of computeOrder, money in baht.
const DraftLine = z.looseObject({
  code: z.string(), size: SizeCode.nullable().optional(), sweetness: SweetnessCode.nullable().optional(), milk: MilkCodeSchema.nullable().optional(),
  grade: z.string().nullable().optional(), qty: z.number(), free: z.boolean().optional(),
  discountBaht: z.number().nullable().optional(), discountPercent: z.number().nullable().optional(), discountReason: z.string().nullable().optional(),
})
export const ParityDraft = z.looseObject({
  saleDate: Ymd, saleTime: TimeOfDay.optional(), channelCode: z.string(), paymentCode: z.string().nullable().optional(), lines: z.array(DraftLine).min(1),
  billDiscountBaht: z.number().nullable().optional(), billDiscountPercent: z.number().nullable().optional(), billDiscountReason: z.string().nullable().optional(),
  promoCode: z.string().nullable().optional(), skipPromotionIds: z.array(z.string()).optional(),
})
export type ParityDraft = z.infer<typeof ParityDraft>
/** The money part of dayo QuoteResult (loose: cost/gp/warnings ride along unchecked). */
export const ParityMoney = z.looseObject({
  ok: z.boolean(), itemsSubtotal: z.number(), itemsDiscount: z.number(), billDiscountAmount: z.number(), totalAmount: z.number(), channelFeeAmount: z.number(),
  lines: z.array(z.looseObject({ lineNo: z.number().int(), unitPrice: z.number(), discountPerCup: z.number(), lineTotal: z.number() })),
  promotionsApplied: z.array(z.looseObject({ promotionId: z.string(), discountAmount: z.number() })),
})
export type ParityMoney = z.infer<typeof ParityMoney>
export const ParityCase = z.looseObject({
  /** case name = the spec 04 §5.3 item ("1a", "13b") */
  spec: z.string().min(1), note: z.string().optional(), id: z.string().optional(), draft: ParityDraft, expected: ParityMoney,
})
export type ParityCase = z.infer<typeof ParityCase>
export const ParityFile = z.looseObject({
  dayo_commit: z.string(), pricing_files_sha256: z.record(z.string(), z.string()), generated_at: z.string(),
  catalog_version: z.number().int().optional(),
  catalog: PosOrderCatalog,
  cases: z.array(ParityCase).min(1),
})
export type ParityFile = z.infer<typeof ParityFile>
