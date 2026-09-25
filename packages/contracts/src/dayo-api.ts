import { z } from 'zod'

// ── limits (spec 04 §4.1, §4.5, §6.2) ──────────────────────────────────────────────────────────────────────────────
export const MAX_PUSH_ROWS = 20
export const MAX_PUSH_BODY_BYTES = 262_144
export const MAX_ROW_KEY_LENGTH = 200
export const MAX_DETAIL_CODE_POINTS = 500
export const TEXT_MAX_CODE_POINTS = 200
export const API_KEY_RE = /^dayo_[0-9a-f]{64}$/
export const RECEIPT_NO_RE = /^[A-Z]{1,3}-\d{6}$/
export const PUSH_KINDS = ['order', 'order_void'] as const
export type PushKind = (typeof PUSH_KINDS)[number]
export const KNOWN_REJECT_REASONS = ['INVALID', 'BAD_KEY', 'UNKNOWN_CODE', 'UNKNOWN_STAFF', 'CONFLICT', 'ALREADY_PRESENT', 'FORBIDDEN'] as const
export const KNOWN_DEFER_REASONS = ['PARENT_PENDING', 'BUSY', 'CLOCK_AHEAD', 'UNSUPPORTED', 'SERVER_ERROR'] as const

/** Shortens to `max` CODE POINTS — never strands half a surrogate pair (plan 5 `clip`, fix N4-2). */
export function clipCodePoints(text: string, max: number): string {
  const points = [...text]
  return points.length <= max ? text : points.slice(0, max).join('')
}

/** Thai calendar date (YYYY-MM-DD) of an instant — the shop closes before midnight (ADR-0024). */
export function bangkokDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10)
}

export const rowKey = (kind: PushKind, id: string): string => `${kind}:${id}`

// ── scalars (spec 04 §4.1) ─────────────────────────────────────────────────────────────────────────────────────────
export const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
/** Times the tablet SENDS: UTC with milliseconds. */
export const IsoSent = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine((s) => !Number.isNaN(Date.parse(s)), 'not a real instant')
/** Times the tablet RECEIVES: Postgres timestamptz text, `Z` or `±HH:MM`. */
export const IsoReceived = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/).refine((s) => !Number.isNaN(Date.parse(s)), 'not a real instant')
export const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
/** Baht on the wire: finite, ≥ 0, ≤ numeric(10,2), at most 2 decimals (the same tolerance as edgeBahtToSatang). */
export const Baht = z.number().finite().nonnegative().max(99_999_999.99).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) <= 1e-6, 'more than 2 decimals')
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/
export const Text200 = z.string().refine((s) => !CONTROL_RE.test(s), 'control character').refine((s) => { const n = [...s].length; return n >= 1 && n <= TEXT_MAX_CODE_POINTS }, '1–200 code points')
/** A cup size code — any "<n> oz" since ADR-0054 (dayo cup_sizes CHECK, 0048_cup_sizes.sql:33 = shared SIZE_CODE_PATTERN). The shop's real sizes come in E1 `catalog.sizes`. */
export const SIZE_CODE_RE = /^[1-9][0-9]{0,2} oz$/
export const SizeCode = z.string().regex(SIZE_CODE_RE)
export const SweetnessCode = z.enum(['0%', '25%', '50%', '75%', '100%'])
export const MilkCodeSchema = z.enum(['fresh', 'oat'])
const UseUnit = z.enum(['ml', 'g', 'ชิ้น'])
const HHMM = z.string().regex(/^\d{2}:\d{2}$/)
/** Promotion times: dayo sends the Postgres `time` as is, "HH:MM:SS" (0048_cup_sizes.sql:1552); passed through unchanged — never trimmed here (the pricing code must see what dayo's shared sees). */
const PromoTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/)

// ── E1 catalog = OrderCatalog of @dayo/shared without cost (spec §4.4 rule 1) ──────────────────────────────────────
// Anything the vendored pricing code reads is checked here; a catalog it cannot understand is refused whole (ruling R12).
const RecipeLine = z.looseObject({ ingredientId: z.string().nullable().optional(), baseId: z.string().nullable().optional(), qty: z.number().finite(), unit: UseUnit })
const Variant = z.looseObject({
  menuCode: z.string().min(1), menuNameTh: z.string(), family: z.string(), categoryLabel: z.string().nullable().optional(), menuSortOrder: z.number().optional(),
  size: SizeCode, sweetness: SweetnessCode, price: z.number().finite().nonnegative(), allowOatMilk: z.boolean(), isMatcha: z.boolean(), recipeLines: z.array(RecipeLine),
})
const Ingredient = z.looseObject({ id: z.string(), code: z.string(), name: z.string(), useUnit: UseUnit })
const Base = z.looseObject({ id: z.string(), code: z.string(), name: z.string(), yieldQty: z.number().finite(), yieldUnit: z.enum(['ml', 'g']), lines: z.array(z.looseObject({ ingredientId: z.string(), qty: z.number().finite() })) })
const MilkOption = z.looseObject({ code: MilkCodeSchema, ingredientId: z.string(), priceAdd: z.number().finite(), aliases: z.array(z.string()) })
const GradeOption = z.looseObject({ code: z.string().min(1), ingredientId: z.string(), multiplier: z.number().finite(), priceAdd: z.number().finite(), isDefault: z.boolean(), aliases: z.array(z.string()) })
const Channel = z.looseObject({ code: z.string().min(1), name: z.string(), aliases: z.array(z.string()), priceMarkupPct: z.number().finite(), priceAddBaht: z.number().finite(), rounding: z.enum(['ceil_baht', 'none']), feePct: z.number().finite(), defaultPaymentMethodCode: z.string().nullable() })
const PaymentMethod = z.looseObject({ code: z.string().min(1), name: z.string(), aliases: z.array(z.string()) })
const promoCommon = {
  id: z.string(), code: z.string().nullable(), name: z.string(),
  startsOn: Ymd.nullable().optional(), endsOn: Ymd.nullable().optional(), daysOfWeek: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  timeFrom: PromoTime.nullable().optional(), timeTo: PromoTime.nullable().optional(), channelCodes: z.array(z.string()).nullable().optional(),
  requiresCode: z.boolean(), autoApply: z.boolean(), priority: z.number().finite(), stackable: z.boolean(), isActive: z.boolean(),
}
const codes = z.array(z.string())
const Promotion = z.discriminatedUnion('kind', [
  z.looseObject({ ...promoCommon, kind: z.literal('buy_n_get_m'), params: z.looseObject({ buy_qty: z.number().int().min(1), get_qty: z.number().int().min(1), menu_codes: codes, max_sets: z.number().int().optional() }) }),
  z.looseObject({ ...promoCommon, kind: z.literal('item_discount'), params: z.looseObject({ menu_codes: codes, amount_baht: z.number().finite().optional(), percent: z.number().finite().optional() }) }),
  z.looseObject({ ...promoCommon, kind: z.literal('bill_discount'), params: z.looseObject({ min_subtotal: z.number().finite().optional(), amount_baht: z.number().finite().optional(), percent: z.number().finite().optional(), max_amount: z.number().finite().optional() }) }),
  z.looseObject({ ...promoCommon, kind: z.literal('bundle'), params: z.looseObject({ items: z.array(z.looseObject({ menu_codes: codes, qty: z.number().int().min(1) })).min(1), bundle_price: z.number().finite(), max_sets: z.number().int().optional() }) }),
])
const SaleSettings = z.looseObject({
  shopName: z.string(), defaultSize: SizeCode, defaultSweetness: SweetnessCode, defaultChannelCode: z.string(), defaultMilk: MilkCodeSchema,
  maxQtyPerLine: z.number().int().min(1), backdateDays: z.number().int(), recentOrdersCount: z.number().int(),
}).partial()
/** One cup size (dayo CupSizeEntry · cup_sizes via get_full_catalog.sizes, 0048_cup_sizes.sql:30-37,1482-1487). */
export const CupSize = z.looseObject({ code: SizeCode, label: z.string().min(1).max(30), sortOrder: z.number().int(), isActive: z.boolean() })
export type CupSize = z.infer<typeof CupSize>
export const PosOrderCatalog = z.looseObject({
  settings: SaleSettings.nullable().optional(),
  /** Every size of the shop, INACTIVE ones included (ADR-0054 rule 5); variants only carry active sizes (0048:1503-1504). */
  sizes: z.array(CupSize),
  variants: z.array(Variant), ingredients: z.record(z.string(), Ingredient), bases: z.record(z.string(), Base),
  milkOptions: z.array(MilkOption), gradeOptions: z.array(GradeOption), channels: z.array(Channel), paymentMethods: z.array(PaymentMethod), promotions: z.array(Promotion),
})
export type PosOrderCatalogParsed = z.infer<typeof PosOrderCatalog>

export const StaffEntry = z.looseObject({ id: Uuid, display_name: z.string().nullable(), role: z.string(), active: z.boolean() })
export type StaffEntry = z.infer<typeof StaffEntry>
/** commit is JSON null when the build passed none (0049_pos_catalog.sql:303-305). */
export const PricingInfo = z.looseObject({ commit: z.string().nullable(), files_sha256: z.record(z.string(), z.string()) })
/**
 * last_receipt_no = the latest `external_ref` of this key as stored (0049_pos_catalog.sql:321-325), so any text: one odd
 * value must not throw the whole E1 away. The receipt counter checks RECEIPT_NO_RE where it uses it.
 */
export const ClientInfo = z.looseObject({ name: z.string(), last_receipt_no: z.string().nullable() })
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

// ── E2 request: what the tablet SENDS is strict (spec §4.5) ────────────────────────────────────────────────────────
export const OrderLineData = z.strictObject({
  code: z.string().min(1).max(100), size: SizeCode, sweetness: SweetnessCode, milk: MilkCodeSchema, grade: z.string().min(1).max(50).nullable(),
  qty: z.number().int().min(1).max(999),
  free: z.boolean().optional(), discount_baht: Baht.nullable().optional(), discount_percent: z.number().min(0).max(100).nullable().optional(), discount_reason: Text200.nullable().optional(),
}).refine((l) => l.discount_baht == null || l.discount_percent == null, 'not both discount_baht and discount_percent')
const BillDiscountData = z.strictObject({ baht: Baht.optional(), percent: z.number().min(0).max(100).optional(), reason: Text200.nullable().optional() })
  .refine((b) => (b.baht === undefined) !== (b.percent === undefined), 'exactly one of baht or percent')
export const OrderRowData = z.strictObject({
  pos_order_id: Uuid, receipt_no: z.string().regex(RECEIPT_NO_RE), queue_no: z.number().int().min(1).max(9999),
  sale_date: Ymd, sold_at: IsoSent, channel: z.string().min(1).max(100), payment: z.string().min(1).max(100),
  staff_id: Uuid, catalog_version: z.number().int().min(1), shift_id: Uuid.nullable(),
  lines: z.array(OrderLineData).min(1).max(50), bill_discount: BillDiscountData.nullable(),
  promo_code: z.string().min(1).max(100).nullable(), skip_promotion_ids: z.array(Uuid), no_promotions: z.boolean(),
  totals: z.strictObject({ items_subtotal: Baht, items_discount: Baht, bill_discount: Baht, total: Baht }),
  note: Text200.nullable(),
}).superRefine((d, ctx) => {
  if (bangkokDateOf(d.sold_at) !== d.sale_date) ctx.addIssue({ code: 'custom', path: ['sale_date'], message: 'sale_date must be the Thai date of sold_at' })
  if (d.lines.reduce((a, l) => a + l.qty, 0) > 500) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'more than 500 cups' })
})
export type OrderRowData = z.infer<typeof OrderRowData>
export const OrderVoidRowData = z.strictObject({ pos_order_id: Uuid, voided_at: IsoSent, staff_id: Uuid, approved_by: Uuid.nullable(), reason: Text200 })
export type OrderVoidRowData = z.infer<typeof OrderVoidRowData>
const rowKeyField = z.string().min(1).max(MAX_ROW_KEY_LENGTH)
export const PushRow = z.discriminatedUnion('kind', [
  z.strictObject({ key: rowKeyField, kind: z.literal('order'), data: OrderRowData }),
  z.strictObject({ key: rowKeyField, kind: z.literal('order_void'), data: OrderVoidRowData }),
]).refine((r) => r.key === rowKey(r.kind, r.data.pos_order_id), { message: 'key must be <kind>:<pos_order_id>', path: ['key'] })
export type PushRow = z.infer<typeof PushRow>
export const PushRequest = z.strictObject({ device_time: IsoSent, rows: z.array(PushRow).min(1).max(MAX_PUSH_ROWS) })
export type PushRequest = z.infer<typeof PushRequest>
/** Envelope only (spec §4.5: a bad row is that row's verdict, never a 422 of the whole request) — used by the mock. */
export const PushEnvelope = z.looseObject({ device_time: z.string(), rows: z.array(z.unknown()).min(1).max(MAX_PUSH_ROWS) })

// ── E2 response: what the tablet RECEIVES is tolerant (spec §4.1 · plan-5 ReceivedRowResult) ───────────────────────
export const ReceivedRowResult = z.looseObject({ key: z.string(), status: z.string(), reason: z.string().optional(), detail: z.string().optional(), data: z.unknown().optional() })
export type ReceivedRowResult = z.infer<typeof ReceivedRowResult>
export const OrderAcceptedData = z.looseObject({ order_no: z.string(), version: z.number().int(), computed_total: z.number().finite().nonnegative(), amount_mismatch: z.boolean(), duplicate_of: z.array(z.string()), warnings: z.array(z.string()) })
export const OrderVoidAcceptedData = z.looseObject({ order_no: z.string(), version: z.number().int() })
export const PushResponseData = z.looseObject({ server_time: IsoReceived, results: z.array(ReceivedRowResult) })
export type PushResponseData = z.infer<typeof PushResponseData>
export const PushResponse = z.looseObject({ ok: z.literal(true), data: PushResponseData })
export const ApiErrorBody = z.looseObject({ ok: z.literal(false), error: z.looseObject({ code: z.string(), message: z.string() }) })

// ── E3 (spec §4.6 · dayo list_api_orders, 0052_pos_push.sql:785-846) ─────────────────────────────────────────────────
/**
 * The owner's latest edit/cancel of a bill on the dayo web (ADR-0050 · dayo_order_dayo_edit, 0051_multi_source_sales.sql:1479-1497);
 * null when there is none. edited_by_name and reason are null for a key without staff:read (0052_pos_push.sql:830-831).
 */
export const DayoEdit = z.looseObject({
  kind: z.enum(['edit', 'cancel']), edited_at: IsoReceived, edited_by_name: z.string().nullable(), reason: z.string().nullable(), version: z.number().int().nullable(),
})
export type DayoEdit = z.infer<typeof DayoEdit>
export const CentralOrder = z.looseObject({
  order_no: z.string(), sale_date: Ymd, status: z.string(), source: z.string(), external_ref: z.string().nullable(), version: z.number().int(),
  channel: z.string().nullable(), payment: z.string().nullable(),
  totals: z.looseObject({ items_subtotal: z.number(), items_discount: z.number(), bill_discount: z.number(), total: z.number(), fee: z.number().nullable().optional() }),
  amount_mismatch: z.boolean().nullable(), updated_at: IsoReceived.nullable(),
  sold_at: IsoReceived.nullable().optional(), created_by_name: z.string().nullable().optional(), pos_receipt_no: z.string().nullable().optional(),
  pos_queue_no: z.number().int().nullable().optional(), catalog_version: z.number().int().nullable().optional(), duplicate_suspect: z.boolean().optional(),
  /** Only on this key's own bills, else null (0052_pos_push.sql:826). */
  pos_order_id: Uuid.nullable().optional(),
  dayo_edit: DayoEdit.nullable().optional(),
})
export type CentralOrder = z.infer<typeof CentralOrder>
export const OrdersListResponse = z.looseObject({ ok: z.literal(true), data: z.array(CentralOrder) })

// ── supported kinds/fields (spec §4.4 rule 10) ─────────────────────────────────────────────────────────────────────
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

// ── parity file = pos-parity.json of dayo scripts/export-pos-parity.ts:230-238 (spec §5.2 layer B → C) ─────────────────
// {dayo_commit, generated_at, pricing_files_sha256, catalog, cases:[{spec, note, draft, expected}]} — no catalog_version, cases named by `spec`.
// draft = dayo's own OrderDraft (camelCase); expected = dayo's QuoteResult in baht (ParityMoney reads the money part).
const DraftLine = z.looseObject({
  code: z.string(), size: SizeCode.nullable().optional(), sweetness: SweetnessCode.nullable().optional(), milk: MilkCodeSchema.nullable().optional(),
  grade: z.string().nullable().optional(), qty: z.number(), free: z.boolean().optional(),
  discountBaht: z.number().nullable().optional(), discountPercent: z.number().nullable().optional(), discountReason: z.string().nullable().optional(),
})
export const ParityDraft = z.looseObject({
  saleDate: Ymd, saleTime: HHMM.optional(), channelCode: z.string(), paymentCode: z.string().nullable().optional(), lines: z.array(DraftLine).min(1),
  billDiscountBaht: z.number().nullable().optional(), billDiscountPercent: z.number().nullable().optional(), billDiscountReason: z.string().nullable().optional(),
  promoCode: z.string().nullable().optional(), skipPromotionIds: z.array(z.string()).optional(),
})
export type ParityDraft = z.infer<typeof ParityDraft>
export const ParityMoney = z.looseObject({
  ok: z.boolean(), itemsSubtotal: z.number(), itemsDiscount: z.number(), billDiscountAmount: z.number(), totalAmount: z.number(), channelFeeAmount: z.number(),
  lines: z.array(z.looseObject({ lineNo: z.number().int(), unitPrice: z.number(), discountPerCup: z.number(), lineTotal: z.number() })),
  promotionsApplied: z.array(z.looseObject({ promotionId: z.string(), discountAmount: z.number() })),
})
export type ParityMoney = z.infer<typeof ParityMoney>
export const ParityCase = z.looseObject({ spec: z.string().min(1), note: z.string().optional(), draft: ParityDraft, expected: ParityMoney })
export type ParityCase = z.infer<typeof ParityCase>
export const ParityFile = z.looseObject({
  dayo_commit: z.string(), pricing_files_sha256: z.record(z.string(), z.string()), generated_at: z.string(),
  /** dayo's export does not write it yet. */
  catalog_version: z.number().int().optional(),
  catalog: PosOrderCatalog,
  cases: z.array(ParityCase).min(1),
})
