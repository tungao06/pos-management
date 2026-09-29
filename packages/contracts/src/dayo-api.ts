import { z } from 'zod'

// ── limits (spec 04 §4.1, §4.5, §6.2) ──────────────────────────────────────────────────────────────────────────────
export const MAX_PUSH_ROWS = 20
export const MAX_PUSH_BODY_BYTES = 262_144
export const MAX_ROW_KEY_LENGTH = 200
export const MAX_DETAIL_CODE_POINTS = 500
export const TEXT_MAX_CODE_POINTS = 200
export const API_KEY_RE = /^dayo_[0-9a-f]{64}$/
export const RECEIPT_NO_RE = /^[A-Z]{1,3}-\d{6}$/
/** Row key dayo accepts (0052 dayo_pos_push_row): `<kind>:<lowercase uuid>`, kind `^[a-z][a-z_]{0,39}$`. */
export const ROW_KEY_RE = /^[a-z][a-z_]{0,39}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/**
 * Push kinds (spec 04 §4.10 · C11). dayo main 12885fe ships ADR-0069 PHASE 1 only: order, order_void + the four shift kinds
 * (dayo_pos_supported, dayo 0066_pos_push_shift_kinds.sql:594-608). order_off_catalog is PHASE 2 (0066:15 · ADR-0069:18,24):
 * its schema is kept, but the tablet only sends a kind E1 `supported_kinds` advertises (preflight ruling P1) — dayo answers any
 * other kind `deferred UNSUPPORTED` (0066:654-656).
 */
export const PUSH_KINDS = ['order', 'order_void', 'shift_open', 'cash_movement', 'cash_count', 'shift_close', 'order_off_catalog'] as const
export type PushKind = (typeof PUSH_KINDS)[number]
/** spec §6.2: ONE shift lane per device, strictly in createdAt order = dayo_pos_is_shift_kind (0066:48-53). */
export const SHIFT_LANE_KINDS = ['shift_open', 'cash_movement', 'cash_count', 'shift_close'] as const
export type ShiftLaneKind = (typeof SHIFT_LANE_KINDS)[number]
export type Lane = 'bill' | 'shift'
/** spec §6.2: one shift lane per device; everything else (and any unknown kind) is the bill lane. */
export const laneOf = (kind: string): Lane => ((SHIFT_LANE_KINDS as readonly string[]).includes(kind) ? 'shift' : 'bill')
/** The data field whose uuid the row key carries = dayo_pos_id_field (0066:38-46, checked 0066:677-683). */
export const KIND_ID_FIELD: Record<PushKind, string> = { order: 'pos_order_id', order_void: 'pos_order_id', shift_open: 'shift_id', cash_movement: 'movement_id', cash_count: 'count_id', shift_close: 'shift_id', order_off_catalog: 'pos_order_id' }
/** The scope a row needs besides orders:write: shift:write per shift row (dayo 0066:669-675 → `FORBIDDEN scope:`). */
export const KIND_SCOPE: Record<PushKind, 'orders:write' | 'shift:write'> = { order: 'orders:write', order_void: 'orders:write', order_off_catalog: 'orders:write', shift_open: 'shift:write', cash_movement: 'shift:write', cash_count: 'shift:write', shift_close: 'shift:write' }
/** Block 3 kinds dayo phase 1 advertises (0066:595) — the shift kinds. */
export const BLOCK3_PHASE1_KINDS = SHIFT_LANE_KINDS
/** Block 3 kinds that wait for dayo ADR-0069 phase 2 (preflight ruling P1). */
export const BLOCK3_PHASE2_KINDS = ['order_off_catalog'] as const
/** C13: ALREADY_PRESENT of the old draft is cancelled — dayo never sends it (spec §4.5 table · CONFLICT replaces it). */
export const KNOWN_REJECT_REASONS = ['INVALID', 'BAD_KEY', 'UNKNOWN_CODE', 'UNKNOWN_STAFF', 'CONFLICT', 'FORBIDDEN'] as const
export const KNOWN_DEFER_REASONS = ['PARENT_PENDING', 'BUSY', 'CLOCK_AHEAD', 'UNSUPPORTED', 'SERVER_ERROR'] as const
/**
 * spec §4.10 · §13.8 R5-2: the fixed machine prefixes of `detail` (`data_conflict:` = the INVALID verdicts of the S5 class:
 * Z counted ≠ the count in dayo · z_no above max + 50 — dayo 0066:495-498, 0066:519-523). dayo phase 1 writes them on the
 * shift kinds only; on order/order_void rows they are phase 2 (0066:5 · preflight D3) — no prefix = the block-2 rule of that reason.
 */
export const DETAIL_PREFIXES = ['scope:', 'role:', 'rule:', 'exists:', 'off_catalog_exists:', 'receipt_taken:', 'key_changed:', 'counted:', 'z_no_taken:', 'data_conflict:'] as const
export type DetailPrefix = (typeof DETAIL_PREFIXES)[number]
/** spec §4.10: the tablet decides from this fixed prefix only — never from the Thai text after it. */
export function detailPrefix(detail: string | null | undefined): DetailPrefix | null {
  if (typeof detail !== 'string') return null
  return DETAIL_PREFIXES.find((p) => detail.startsWith(p)) ?? null
}

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
const isInstant = (s: string): boolean => !Number.isNaN(Date.parse(s))
/** Times the tablet SENDS: UTC with milliseconds. */
export const IsoSent = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(isInstant, 'not a real instant')
/** Times the tablet RECEIVES: Postgres timestamptz text, `Z` or `±HH:MM`. */
export const IsoReceived = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/).refine(isInstant, 'not a real instant')
export const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
/**
 * Baht the tablet SENDS = what dayo_pos_is_money accepts (0052): ≥ 0, ≤ 99,999,999.99 and `numeric*100 = trunc(numeric*100)`
 * on the JSON TEXT. So the shortest decimal form of the double (what JSON.stringify writes) must have ≤ 2 decimals:
 * satang/100 always does; 0.1 + 0.2 (→ "0.30000000000000004") does not and dayo would reject the row INVALID.
 */
export const Baht = z.number().finite().nonnegative().max(99_999_999.99).refine((v) => /^\d+(\.\d{1,2})?$/.test(String(v)), 'more than 2 decimals')
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/
/** A UTF-16 surrogate with no partner (`!String#isWellFormed`): Postgres refuses it in jsonb, so dayo answers DY422 for the WHOLE request. */
const LONE_SURROGATE_RE = /[\ud800-\udfff]/u
/**
 * dayo_pos_is_text (0052): 1..max code points · no C0/DEL · not blank after trimming spaces (Postgres btrim) · plus
 * well-formed UTF-16, so one bad text can never turn a whole push into a DY422.
 */
const posText = (max: number) =>
  z.string().refine((s) => {
    const n = [...s].length
    return n >= 1 && n <= max && !CONTROL_RE.test(s) && !LONE_SURROGATE_RE.test(s) && s.replace(/^ +| +$/g, '') !== ''
  }, `1–${max} code points, no control characters, well-formed, not blank`)
export const Text200 = posText(TEXT_MAX_CODE_POINTS)
/** A cup size code — any "<n> oz" since ADR-0054 (dayo cup_sizes CHECK, 0048_cup_sizes.sql:33 = shared SIZE_CODE_PATTERN). The shop's real sizes come in E1 `catalog.sizes`. */
export const SIZE_CODE_RE = /^[1-9][0-9]{0,2} oz$/
export const SizeCode = z.string().regex(SIZE_CODE_RE)
export const SweetnessCode = z.enum(['0%', '25%', '50%', '75%', '100%'])
export const MilkCodeSchema = z.enum(['fresh', 'oat'])
const UseUnit = z.enum(['ml', 'g', 'ชิ้น'])
const HHMM = z.string().regex(/^\d{2}:\d{2}$/)
/**
 * Promotion times: dayo sends the Postgres `time` as is, "HH:MM:SS" and possibly fractional seconds
 * (0048_cup_sizes.sql:1552); passed through unchanged — never trimmed here (the pricing code must see what dayo's shared sees).
 */
const PromoTime = z.string().regex(/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/)

// ── E1 catalog = OrderCatalog of @dayo/shared without cost (spec §4.4 rule 1) ──────────────────────────────────────
// Anything the vendored pricing code reads is checked here; a catalog it cannot understand is refused whole (ruling R12).
const RecipeLine = z.looseObject({ ingredientId: z.string().nullable().exactOptional(), baseId: z.string().nullable().exactOptional(), qty: z.number().finite(), unit: UseUnit })
const Variant = z.looseObject({
  menuCode: z.string().min(1), menuNameTh: z.string(), family: z.string(), categoryLabel: z.string().nullable(), menuSortOrder: z.number(),
  size: SizeCode, sweetness: SweetnessCode, price: z.number().finite().nonnegative(), allowOatMilk: z.boolean(), isMatcha: z.boolean(), recipeLines: z.array(RecipeLine),
})
const Ingredient = z.looseObject({ id: z.string(), code: z.string(), name: z.string(), useUnit: UseUnit })
const Base = z.looseObject({ id: z.string(), code: z.string(), name: z.string(), yieldQty: z.number().finite(), yieldUnit: z.enum(['ml', 'g']), lines: z.array(z.looseObject({ ingredientId: z.string(), qty: z.number().finite() })) })
// menu_options.ingredient_id and .multiplier are nullable columns (dayo 0002_catalog.sql) and get_full_catalog passes
// them through as is; dayo's web lets the owner save an option with no ingredient. A null must never refuse the whole E1.
const MilkOption = z.looseObject({ code: MilkCodeSchema, ingredientId: z.string().nullable(), priceAdd: z.number().finite(), aliases: z.array(z.string()) })
const GradeOption = z.looseObject({ code: z.string().min(1), ingredientId: z.string().nullable(), multiplier: z.number().finite().nullable(), priceAdd: z.number().finite(), isDefault: z.boolean(), aliases: z.array(z.string()) })
const Channel = z.looseObject({ code: z.string().min(1), name: z.string(), aliases: z.array(z.string()), priceMarkupPct: z.number().finite(), priceAddBaht: z.number().finite(), rounding: z.enum(['ceil_baht', 'none']), feePct: z.number().finite(), defaultPaymentMethodCode: z.string().nullable() })
const PaymentMethod = z.looseObject({ code: z.string().min(1), name: z.string(), aliases: z.array(z.string()) })
const promoCommon = {
  id: z.string(), code: z.string().nullable(), name: z.string(),
  startsOn: Ymd.nullable().exactOptional(), endsOn: Ymd.nullable().exactOptional(), daysOfWeek: z.array(z.number().int().min(0).max(6)).nullable().exactOptional(),
  timeFrom: PromoTime.nullable().exactOptional(), timeTo: PromoTime.nullable().exactOptional(), channelCodes: z.array(z.string()).nullable().exactOptional(),
  requiresCode: z.boolean(), autoApply: z.boolean(), priority: z.number().finite(), stackable: z.boolean(), isActive: z.boolean(),
}
const codes = z.array(z.string())
const Promotion = z.discriminatedUnion('kind', [
  z.looseObject({ ...promoCommon, kind: z.literal('buy_n_get_m'), params: z.looseObject({ buy_qty: z.number().int().min(1), get_qty: z.number().int().min(1), menu_codes: codes, max_sets: z.number().int().exactOptional() }) }),
  z.looseObject({ ...promoCommon, kind: z.literal('item_discount'), params: z.looseObject({ menu_codes: codes, amount_baht: z.number().finite().exactOptional(), percent: z.number().finite().exactOptional() }) }),
  z.looseObject({ ...promoCommon, kind: z.literal('bill_discount'), params: z.looseObject({ min_subtotal: z.number().finite().exactOptional(), amount_baht: z.number().finite().exactOptional(), percent: z.number().finite().exactOptional(), max_amount: z.number().finite().exactOptional() }) }),
  z.looseObject({ ...promoCommon, kind: z.literal('bundle'), params: z.looseObject({ items: z.array(z.looseObject({ menu_codes: codes, qty: z.number().int().min(1) })).min(1), bundle_price: z.number().finite(), max_sets: z.number().int().exactOptional() }) }),
])
const SaleSettings = z.looseObject({
  shopName: z.string().exactOptional(), defaultSize: SizeCode.exactOptional(), defaultSweetness: SweetnessCode.exactOptional(), defaultChannelCode: z.string().exactOptional(),
  defaultMilk: MilkCodeSchema.exactOptional(), maxQtyPerLine: z.number().int().min(1).exactOptional(), backdateDays: z.number().int().exactOptional(), recentOrdersCount: z.number().int().exactOptional(),
})
/**
 * One cup size (dayo CupSizeEntry · cup_sizes via get_full_catalog.sizes, 0048_cup_sizes.sql:30-37,1482-1487). The label
 * is display-only and dayo trims and counts it its own way, so no upper bound: a long label must not reject the whole E1.
 */
export const CupSize = z.looseObject({ code: SizeCode, label: z.string().min(1), sortOrder: z.number().int(), isActive: z.boolean() })
export type CupSize = z.infer<typeof CupSize>
export const PosOrderCatalog = z.looseObject({
  settings: SaleSettings.nullable().exactOptional(),
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
export const ClientInfo = z.looseObject({
  name: z.string(), last_receipt_no: z.string().nullable(),
  /**
   * Block 3 (spec §4.4 rule 6 · §13.8 R5-1/R5-3 · dayo 0067:134-155): last_z_no = the highest z_no of the key INCLUDING
   * quarantined Zs; last_z_hash / last_z_until = of the highest NON-quarantined Z (until = counted_at of its count); all three
   * null when the key has no Z. Raw like last_receipt_no — one odd value must not throw E1 away; Task 13 checks them where used.
   * dayo writes last_z_until as `YYYY-MM-DDTHH:MM:SS.mmm+00:00` (0067:155 · preflight P7), not `…Z`. Optional: older dayo has none.
   */
  last_z_no: z.number().int().nullable().optional(), last_z_hash: z.string().nullable().optional(), last_z_until: z.string().nullable().optional(),
})
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
  code: posText(100), size: SizeCode, sweetness: SweetnessCode, milk: MilkCodeSchema, grade: posText(100).nullable(),
  qty: z.number().int().min(1).max(999),
  free: z.boolean().optional(), discount_baht: Baht.nullable().optional(), discount_percent: z.number().min(0).max(100).nullable().optional(), discount_reason: Text200.nullable().optional(),
}).refine((l) => l.discount_baht == null || l.discount_percent == null, 'not both discount_baht and discount_percent')
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
  // sold_at may have failed IsoSent already: bangkokDateOf would throw on it, and safeParse must answer, never throw
  if (typeof d.sold_at === 'string' && isInstant(d.sold_at) && bangkokDateOf(d.sold_at) !== d.sale_date) ctx.addIssue({ code: 'custom', path: ['sale_date'], message: 'sale_date must be the Thai date of sold_at' })
  if (Array.isArray(d.lines) && d.lines.reduce((a, l) => a + (typeof l?.qty === 'number' ? l.qty : 0), 0) > 500) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'more than 500 cups' })
})
export type OrderRowData = z.infer<typeof OrderRowData>
export const OrderVoidRowData = z.strictObject({ pos_order_id: Uuid, voided_at: IsoSent, staff_id: Uuid, approved_by: Uuid.nullable(), reason: Text200 })
export type OrderVoidRowData = z.infer<typeof OrderVoidRowData>

// ── E2 block 3 rows (spec §4.10 · C11 · field rules = what dayo 0066 rejects INVALID) ─────────────────────────────────────
// Object-level refinements also run when a field already failed, so each one checks the shape it reads (safeParse never throws).
export const CASH_DENOMINATIONS_BAHT = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const
/** Lowercase hex, 64 characters (z_report.hash / prev_hash — dayo 0066:382-387). */
export const Hex64 = z.string().regex(/^[0-9a-f]{64}$/)
/** A bot/web bill number in `z_report.bot_bills` (dayo 0066:421 · 0008_orders_rpc.sql:1127 `L<yymmdd>-<seq ≥ 3 digits>` · preflight P7/D5). */
export const BOT_ORDER_NO_RE = /^L\d{6}-\d{3,}$/
const INT32_MAX = 2_147_483_647
/** Baht → satang for a CHECK only: every Baht here has ≤ 2 decimals, so this is exact (money stays in @dayo/domain). */
const satangOf = (baht: unknown): number => (typeof baht === 'number' ? Math.round(baht * 100) : Number.NaN)
const PositiveBaht = Baht.refine((v) => v > 0, 'must be > 0')
const isArr = (v: unknown): v is unknown[] => Array.isArray(v)
const isRec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const sameThaiDate = (instant: unknown, ymd: unknown): boolean => typeof instant !== 'string' || !isInstant(instant) || bangkokDateOf(instant) === ymd
const hasDuplicate = (values: unknown[]): boolean => new Set(values).size !== values.length

/** shift_open (dayo 0066:58-132): business_date = the Thai date of opened_at (0066:96-99). */
export const ShiftOpenRowData = z.strictObject({ shift_id: Uuid, business_date: Ymd, opened_at: IsoSent, opened_by: Uuid, opening_float: Baht, quick_open: z.boolean() })
  .superRefine((d, ctx) => {
    if (!sameThaiDate(d.opened_at, d.business_date)) ctx.addIssue({ code: 'custom', path: ['business_date'], message: 'business_date must be the Thai date of opened_at' })
  })
export type ShiftOpenRowData = z.infer<typeof ShiftOpenRowData>
/** cash_movement (dayo 0066:137-226): amount > 0 · pos_order_id for (and only for) VOID_REFUND · a reason for the other kinds. */
export const CashMovementRowData = z.strictObject({
  movement_id: Uuid, shift_id: Uuid, kind: z.enum(['PAID_IN', 'PAID_OUT', 'DROP', 'VOID_REFUND']), amount: PositiveBaht,
  pos_order_id: Uuid.nullable(), reason: Text200.nullable(), created_by: Uuid, created_at: IsoSent,
}).superRefine((d, ctx) => {
  if ((d.kind === 'VOID_REFUND') !== (d.pos_order_id !== null)) ctx.addIssue({ code: 'custom', path: ['pos_order_id'], message: 'pos_order_id only (and always) for VOID_REFUND' })
  if (d.kind !== 'VOID_REFUND' && d.reason === null) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason required for PAID_IN/PAID_OUT/DROP' })
})
export type CashMovementRowData = z.infer<typeof CashMovementRowData>
const CashCountLineData = z.strictObject({
  denomination: z.number().int().refine((v) => (CASH_DENOMINATIONS_BAHT as readonly number[]).includes(v), 'unknown denomination'),
  count: z.number().int().min(0).max(99_999),
})
/** cash_count (dayo 0066:231-320): nine lines, each denomination once, counted = Σ denomination × count (0066:253-272). */
export const CashCountRowData = z.strictObject({ count_id: Uuid, shift_id: Uuid, lines: z.array(CashCountLineData).length(9), counted: Baht, counted_by: Uuid, counted_at: IsoSent })
  .superRefine((d, ctx) => {
    if (!isArr(d.lines)) return
    const lines = d.lines.filter(isRec)
    if (hasDuplicate(lines.map((l) => l['denomination']))) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'each denomination once' })
    const sum = lines.reduce((a, l) => a + (typeof l['denomination'] === 'number' && typeof l['count'] === 'number' ? l['denomination'] * 100 * l['count'] : 0), 0)
    if (satangOf(d.counted) !== sum) ctx.addIssue({ code: 'custom', path: ['counted'], message: 'counted must equal Σ denomination × count' })
  })
export type CashCountRowData = z.infer<typeof CashCountRowData>
/** z_report.cash — the eight non-negative parts of the expected-cash formula (spec §4.10 · C5 · dayo 0066:392-397). */
export const ZCashData = z.strictObject({ opening_float: Baht, pos_cash_sales: Baht, void_refunds: Baht, paid_in: Baht, paid_out: Baht, drops: Baht, drawer_expenses: Baht, bot_cash: Baht })
export type ZCashData = z.infer<typeof ZCashData>
const ZBotBill = z.strictObject({ order_no: z.string().regex(BOT_ORDER_NO_RE), version: z.number().int().min(1).max(INT32_MAX), total: Baht })
const ZPosBill = z.strictObject({ pos_order_id: Uuid, receipt_no: z.string().regex(RECEIPT_NO_RE), payment: posText(100), total: Baht, sold_at: IsoSent, voided_at: IsoSent.nullable() })
/** shift_close.z_report: exactly these eleven keys, no unknown sub-key (spec §4.10 S28 · dayo 0066:375-449). */
export const ZReportData = z.strictObject({
  z_no: z.number().int().min(1).max(INT32_MAX), hash: Hex64, prev_hash: Hex64.nullable(), variance_alert: Baht, chain_warning: z.boolean(),
  cash: ZCashData, counted: Baht, bot_window: z.strictObject({ after: IsoSent, until: IsoSent }),
  movement_ids: z.array(Uuid).max(500), bot_bills: z.array(ZBotBill).max(500), pos_bills: z.array(ZPosBill).max(2000),
}).superRefine((r, ctx) => {
  const issue = (path: string, message: string): void => { ctx.addIssue({ code: 'custom', path: [path], message }) }
  if (isRec(r.cash) && r.cash.drawer_expenses !== 0) issue('cash', 'drawer_expenses must be 0 in block 3 (dayo 0066:398-400 · ADR-0057)')
  if (isRec(r.bot_window) && Date.parse(r.bot_window.after) >= Date.parse(r.bot_window.until)) issue('bot_window', 'after must be before until')
  if (isArr(r.movement_ids) && hasDuplicate(r.movement_ids)) issue('movement_ids', 'movement ids must be unique (dayo 0066:410-414)')
  if (isArr(r.bot_bills)) {
    const bills = r.bot_bills.filter(isRec)
    if (hasDuplicate(bills.map((b) => b['order_no']))) issue('bot_bills', 'order_no must be unique (dayo 0066:427-429)')
    if (isRec(r.cash) && bills.reduce((a, b) => a + satangOf(b['total']), 0) !== satangOf(r.cash.bot_cash)) issue('bot_bills', 'Σ bot_bills.total must equal cash.bot_cash')
  }
  if (isArr(r.pos_bills) && hasDuplicate(r.pos_bills.filter(isRec).map((b) => b['pos_order_id']))) issue('pos_bills', 'pos_order_id must be unique (dayo 0066:448)')
})
export type ZReportData = z.infer<typeof ZReportData>
/** shift_close (dayo 0066:325-561). Who closes (owner active at closed_at) and the z_no order are dayo's own checks. */
export const ShiftCloseRowData = z.strictObject({ shift_id: Uuid, count_id: Uuid, closed_by: Uuid, closed_at: IsoSent, variance_reason: Text200.nullable(), z_report: ZReportData })
export type ShiftCloseRowData = z.infer<typeof ShiftCloseRowData>
const OffCatalogLine = z.strictObject({
  code: z.string().min(1).max(40).nullable(), name: z.string().min(1).max(100), size: z.string().min(1).max(20).nullable(), sweetness: z.string().min(1).max(10).nullable(),
  qty: z.number().int().min(1).max(999), unit_price: Baht, discount_per_cup: Baht, line_total: Baht,
}).refine((l) => l.discount_per_cup <= l.unit_price && satangOf(l.line_total) === (satangOf(l.unit_price) - satangOf(l.discount_per_cup)) * l.qty, 'line_total = (unit_price − discount_per_cup) × qty')
/**
 * order_off_catalog — PHASE 2 of dayo (not shipped at 12885fe · ruling P1): kept so the tablet can build and hold the row.
 * Totals follow spec §4.10 (= @dayo/shared money.ts:284-291 · orders_discount_le_subtotal) — a check of what the frozen bill
 * already says, never a recomputation. channel/payment follow the order row (spec §4.10 "ตามแถว order").
 */
export const OrderOffCatalogRowData = z.strictObject({
  pos_order_id: Uuid, receipt_no: z.string().regex(RECEIPT_NO_RE), queue_no: z.number().int().min(1).max(9999), sale_date: Ymd, sold_at: IsoSent,
  channel: posText(100), payment: posText(100), staff_id: Uuid, catalog_version: z.number().int().min(1), shift_id: Uuid.nullable(), note: Text200.nullable(),
  lines: z.array(OffCatalogLine).min(1).max(50), totals: z.strictObject({ items_subtotal: Baht, items_discount: Baht, bill_discount: Baht, total: Baht }),
  closed_by: Uuid, closed_at: IsoSent, reason: Text200, original_reason: z.string().regex(/^[A-Z_]{1,40}$/),
}).superRefine((d, ctx) => {
  const issue = (path: string, message: string): void => { ctx.addIssue({ code: 'custom', path: [path], message }) }
  if (!sameThaiDate(d.sold_at, d.sale_date)) issue('sale_date', 'sale_date must be the Thai date of sold_at')
  if (Date.parse(d.closed_at) < Date.parse(d.sold_at)) issue('closed_at', 'closed_at must not be before sold_at')
  if (!isArr(d.lines) || !isRec(d.totals)) return
  const lines = d.lines.filter(isRec)
  const qty = (l: Record<string, unknown>): number => (typeof l['qty'] === 'number' ? l['qty'] : Number.NaN)
  const sub = lines.reduce((a, l) => a + satangOf(l['unit_price']) * qty(l), 0)
  const idisc = lines.reduce((a, l) => a + satangOf(l['discount_per_cup']) * qty(l), 0)
  const t = d.totals
  if (satangOf(t.items_subtotal) !== sub) issue('totals', 'items_subtotal = Σ unit_price × qty')
  if (satangOf(t.items_discount) !== idisc) issue('totals', 'items_discount = Σ discount_per_cup × qty')
  if (satangOf(t.items_discount) + satangOf(t.bill_discount) > satangOf(t.items_subtotal)) issue('totals', 'discounts must not exceed items_subtotal (orders_discount_le_subtotal)')
  if (satangOf(t.total) !== Math.max(0, satangOf(t.items_subtotal) - satangOf(t.items_discount) - satangOf(t.bill_discount))) issue('totals', 'total = max(0, subtotal − discounts)')
})
export type OrderOffCatalogRowData = z.infer<typeof OrderOffCatalogRowData>

const rowKeyField = z.string().max(MAX_ROW_KEY_LENGTH).regex(ROW_KEY_RE)
const rowOf = <K extends PushKind, T extends z.ZodType>(kind: K, data: T) => z.strictObject({ key: rowKeyField, kind: z.literal(kind), data })
/** One E2 row of any kind; key = `<kind>:<the kind's id field>` (dayo 0066:677-683 → BAD_KEY). */
export const PushRow = z.discriminatedUnion('kind', [
  rowOf('order', OrderRowData), rowOf('order_void', OrderVoidRowData), rowOf('shift_open', ShiftOpenRowData), rowOf('cash_movement', CashMovementRowData),
  rowOf('cash_count', CashCountRowData), rowOf('shift_close', ShiftCloseRowData), rowOf('order_off_catalog', OrderOffCatalogRowData),
]).refine((r) => {
  const data: unknown = r.data
  const id = isRec(data) ? data[KIND_ID_FIELD[r.kind]] : undefined
  return typeof id === 'string' && r.key === rowKey(r.kind, id)
}, { message: 'key must be <kind>:<id field of the kind>', path: ['key'] })
export type PushRow = z.infer<typeof PushRow>
export const PushRequest = z.strictObject({ device_time: IsoSent, rows: z.array(PushRow).min(1).max(MAX_PUSH_ROWS) })
export type PushRequest = z.infer<typeof PushRequest>
/**
 * Envelope only (spec §4.5: a bad row is that row's verdict, never a 422 of the whole request). dayo checks only `rows`
 * (0052 api_pos_push) — it ignores `device_time`, which the tablet still sends for clock diagnostics.
 */
export const PushEnvelope = z.looseObject({ rows: z.array(z.unknown()).min(1).max(MAX_PUSH_ROWS) })

// ── E2 response: what the tablet RECEIVES is tolerant (spec §4.1 · plan-5 ReceivedRowResult) ───────────────────────
/** key is null when dayo could not read a string key off the sent row (0052_pos_push.sql:748) — the receive side stays tolerant of both. */
export const ReceivedRowResult = z.looseObject({ key: z.string().nullable(), status: z.string(), reason: z.string().optional(), detail: z.string().optional(), data: z.unknown().optional() })
export type ReceivedRowResult = z.infer<typeof ReceivedRowResult>
export const OrderAcceptedData = z.looseObject({ order_no: z.string(), version: z.number().int(), computed_total: z.number().finite().nonnegative(), amount_mismatch: z.boolean(), duplicate_of: z.array(z.string()), warnings: z.array(z.string()) })
export const OrderVoidAcceptedData = z.looseObject({ order_no: z.string(), version: z.number().int() })
// block 3 accepted/duplicate `data` = `{<id field>}` only (spec §4.10 · dayo 0066:114,130,204,225,294,316,470,515,558 — no
// negative money, no cost) · order_off_catalog and the `exists:` conflict data are phase 2 (ADR-0056:40,42 · preflight C38)
export const ShiftOpenAcceptedData = z.looseObject({ shift_id: Uuid })
export const CashMovementAcceptedData = z.looseObject({ movement_id: Uuid })
export const CashCountAcceptedData = z.looseObject({ count_id: Uuid })
export const ShiftCloseAcceptedData = z.looseObject({ shift_id: Uuid })
export const OffCatalogAcceptedData = z.looseObject({ order_no: z.string(), version: z.number().int() })
/** `data` of a CONFLICT `exists:` / `off_catalog_exists:` (spec §4.10 m2): the tablet reads these values here, never from detail. */
export const ExistsConflictData = z.looseObject({ order_no: z.string(), version: z.number().int(), reported_total: z.number().finite().nonnegative(), payment_is_cash: z.boolean(), off_catalog: z.boolean() })
export type ExistsConflictData = z.infer<typeof ExistsConflictData>
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

// ── E4 GET /v1/pos/shift-cash?after=&until= (spec §4.10 · dayo 0067:18-73) — tolerant on receive ─────────────────────────
/**
 * One cash bill of the bot/web (status ok · payment cash · source line/web · created_at ∈ (after, until] — 0067:18-29).
 * sold_at comes as `…+00:00` (0067:66); created_by_name is null for a key without staff:read (0067:69). The tablet checks
 * order_no against BOT_ORDER_NO_RE where it builds the Z (Task 12), so one odd bill never throws the whole answer away here.
 */
export const ShiftCashBill = z.looseObject({ order_no: z.string().min(1), version: z.number().int(), source: z.string(), sold_at: IsoReceived.nullable(), total: z.number().finite().nonnegative(), created_by_name: z.string().nullable() })
export type ShiftCashBill = z.infer<typeof ShiftCashBill>
export const ShiftCashData = z.looseObject({ bills: z.array(ShiftCashBill), cash_total: z.number().finite().nonnegative() })
export type ShiftCashData = z.infer<typeof ShiftCashData>
export const ShiftCashResponse = z.looseObject({ ok: z.literal(true), data: ShiftCashData })
export type ShiftCashResponse = z.infer<typeof ShiftCashResponse>

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
/**
 * spec §4.4 rule 10 · §4.10: the fields dayo's E1 advertises per block 3 kind (sorted, dotted for lines.*). Phase 1 = exactly
 * dayo_pos_supported() of 0066:603-606 (dayo does not sort — compare as sets); phase 2 = order_off_catalog, not in dayo yet.
 * A mock or fixture of today's dayo advertises PHASE 1 only (preflight ruling P3).
 */
export const BLOCK3_PHASE1_SUPPORTED_FIELDS = {
  shift_open: ['business_date', 'opened_at', 'opened_by', 'opening_float', 'quick_open', 'shift_id'],
  cash_movement: ['amount', 'created_at', 'created_by', 'kind', 'movement_id', 'pos_order_id', 'reason', 'shift_id'],
  cash_count: ['count_id', 'counted', 'counted_at', 'counted_by', 'lines', 'lines.count', 'lines.denomination', 'shift_id'],
  shift_close: ['closed_at', 'closed_by', 'count_id', 'shift_id', 'variance_reason', 'z_report'],
} as const satisfies Record<ShiftLaneKind, readonly string[]>
export const BLOCK3_PHASE2_SUPPORTED_FIELDS = {
  order_off_catalog: ['catalog_version', 'channel', 'closed_at', 'closed_by', 'lines', 'lines.code', 'lines.discount_per_cup', 'lines.line_total', 'lines.name', 'lines.qty', 'lines.size', 'lines.sweetness', 'lines.unit_price', 'note', 'original_reason', 'payment', 'pos_order_id', 'queue_no', 'reason', 'receipt_no', 'sale_date', 'shift_id', 'sold_at', 'staff_id', 'totals'],
} as const satisfies Record<(typeof BLOCK3_PHASE2_KINDS)[number], readonly string[]>
/** Both phases — what spec §4.10 locks for all five block 3 kinds. */
export const BLOCK3_SUPPORTED_FIELDS = { ...BLOCK3_PHASE1_SUPPORTED_FIELDS, ...BLOCK3_PHASE2_SUPPORTED_FIELDS } as const

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

// ── fixtures/parity/pos-shift-cash-parity.json (spec §4.10 "dayo คิดเอง" · D84 — POS owns it; hand-computed, never edited to
// make a test pass). Name and shape fixed with dayo's plan 08: { cases: [{ name, cash, counted, expected, variance }] }, money in
// baht; expected/variance may be negative; cash may carry drawer_expenses ≠ 0 (a block 4 case — the formula already has it).
const SignedBaht = z.number().finite().refine((v) => /^-?\d+(\.\d{1,2})?$/.test(String(v)), 'at most 2 decimals')
export const ShiftCashParityCase = z.strictObject({ name: z.string().min(1), cash: ZCashData, counted: Baht, expected: SignedBaht, variance: SignedBaht })
export type ShiftCashParityCase = z.infer<typeof ShiftCashParityCase>
export const ShiftCashParityFile = z.strictObject({ cases: z.array(ShiftCashParityCase).min(1) })
export type ShiftCashParityFile = z.infer<typeof ShiftCashParityFile>
