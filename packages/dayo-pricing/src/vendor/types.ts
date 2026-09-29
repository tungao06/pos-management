// โดเมนไทป์ของ @dayo/shared — ใช้คำตาม docs/GLOSSARY.md
// โค้ดบริสุทธิ์: ไม่มี I/O, ไม่ผูกกับ Supabase client หรือ LINE SDK

/**
 * ขนาด (Size) — ข้อความรูป "<ตัวเลข> oz" เสมอ (ADR-0054: ตั้งได้ต่อร้านผ่านตาราง cup_sizes แทน CHECK ตายตัว)
 * รหัสจริงที่ร้านมีมาจาก OrderCatalog.sizes — ที่นี่เป็นแค่รูปแบบ (format) ตรวจด้วย SIZE_CODE_PATTERN/isValidSizeCode
 */
export type Size = string;

/** รูปแบบรหัสขนาดที่ถูกต้อง (ตรงกับ CHECK ของตาราง cup_sizes: `^[1-9][0-9]{0,2} oz$`) */
export const SIZE_CODE_PATTERN = /^[1-9][0-9]{0,2} oz$/;

export function isValidSizeCode(code: string): boolean {
  return SIZE_CODE_PATTERN.test(code);
}

/** ขนาดแก้วของร้าน (cup_sizes ผ่าน get_full_catalog.sizes — ADR-0054 ข้อ 5) */
export interface CupSizeEntry {
  code: Size;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

/** ความหวาน (Sweetness) — ข้อความเสมอ ห้ามเป็นตัวเลข */
export type Sweetness = "0%" | "25%" | "50%" | "75%" | "100%";

export const SWEETNESS_LEVELS: readonly Sweetness[] = ["0%", "25%", "50%", "75%", "100%"];
export const SWEETNESS_VALUES: readonly number[] = [0, 25, 50, 75, 100];

/** ตัวเลือกนม (menu_options.kind = 'milk') */
export type MilkCode = "fresh" | "oat";

/**
 * เกรดผงมัตจะ (menu_options.kind = 'matcha_grade') — รหัสอังกฤษ (menu_options.code)
 * owner/manager เพิ่มเกรดใหม่ได้จากเว็บ (ADR-0038) จึงเป็น `string` ธรรมดา ไม่ narrow เป็น union คงที่
 * ค่าเริ่มต้น 3 ตัวที่ระบบ seed มาให้: 'Excellent' | 'Daizu' | 'Isuzu' (ดู aliases.ts#defaultMatchaGradeAliases)
 */
export type MatchaGradeCode = string;

/** Key สูตร ตาม GLOSSARY เช่น 'Thai Tea|16 oz|50%' */
export type VariantKey = `${string}|${Size}|${Sweetness}`;

export function variantKey(menuCode: string, size: Size, sweetness: Sweetness): VariantKey {
  return `${menuCode}|${size}|${sweetness}`;
}

// ── วัตถุดิบ / เบส / สูตร (ADR-0026) ──────────────────────────────

export interface IngredientEntry {
  id: string;
  code: string;
  name: string;
  useUnit: "ml" | "g" | "ชิ้น";
  costPerUseUnit: number;
}

export interface BaseLineEntry {
  ingredientId: string;
  qty: number;
}

export interface BaseEntry {
  id: string;
  code: string;
  name: string;
  yieldQty: number;
  yieldUnit: "ml" | "g";
  lines: BaseLineEntry[];
}

export interface RecipeLineEntry {
  /** อ้างวัตถุดิบ หรือ เบส อย่างใดอย่างหนึ่งเท่านั้น */
  ingredientId?: string | null;
  baseId?: string | null;
  qty: number;
  unit: "ml" | "g" | "ชิ้น";
}

export interface MenuOptionMilkEntry {
  code: MilkCode;
  /** menu_options.ingredient_id — nullable ในฐาน (ตัวเลือกที่ยังไม่ผูกวัตถุดิบ) ต้องถือว่า "ไม่พบ" เหมือน SQL quote_order */
  ingredientId: string | null;
  priceAdd: number;
  /** คำที่พนักงานพิมพ์แทนตัวเลือกนี้ (menu_options.aliases) — ADR-0038 */
  aliases: string[];
}

export interface MenuOptionGradeEntry {
  code: MatchaGradeCode;
  /** menu_options.ingredient_id — nullable ในฐาน (ตัวเลือกที่ยังไม่ผูกวัตถุดิบ) ต้องถือว่า "ไม่พบ" เหมือน SQL quote_order */
  ingredientId: string | null;
  multiplier: number;
  priceAdd: number;
  isDefault: boolean;
  /** คำที่พนักงานพิมพ์แทนเกรดนี้ (menu_options.aliases) — ป้อนเป็น `grades` ให้ parseQuery ได้โดยตรง (ADR-0038) */
  aliases: string[];
}

export interface MenuVariantEntry {
  menuCode: string;
  menuNameTh: string;
  family: string;
  /** ป้ายหมวดที่ตั้งเอง (menu_items.category_label) — ใช้จัดกลุ่มหน้าขายของแท็บเล็ต POS (ADR-0048) */
  categoryLabel: string | null;
  /** ลำดับเมนู (menu_items.sort_order) — ใช้เรียงหน้าขายของแท็บเล็ต POS (ADR-0048) */
  menuSortOrder: number;
  size: Size;
  sweetness: Sweetness;
  price: number;
  allowOatMilk: boolean;
  isMatcha: boolean;
  recipeLines: RecipeLineEntry[];
}

// ── ช่องทางขาย / วิธีชำระ (ADR-0013 / ADR-0031) ──────────────────

export interface SalesChannelEntry {
  code: string;
  name: string;
  aliases: string[];
  priceMarkupPct: number;
  priceAddBaht: number;
  rounding: "ceil_baht" | "none";
  feePct: number;
  defaultPaymentMethodCode: string | null;
}

export interface PaymentMethodEntry {
  code: string;
  name: string;
  aliases: string[];
}

// ── โปรโมชั่น (ADR-0030) ──────────────────────────────────────────

export type PromotionKind = "buy_n_get_m" | "item_discount" | "bill_discount" | "bundle";

/**
 * วิธีใช้โปร (ADR-0070): `auto` = อัตโนมัติ · `code` = ใส่โค้ด · `manual` = พนักงานกดเลือกเอง (ต่อบิล)
 * ต้นฉบับเดียวคือ `promotions.apply_mode` — `requiresCode`/`autoApply` เป็นคอลัมน์ generated อ่านอย่างเดียวที่มากับ
 * แคตตาล็อกเก่า/แท็บเล็ตรุ่นเก่า (ข้อ 1) shared อ่าน `applyMode` ก่อนเสมอ ถ้าไม่มี (แคตตาล็อก cache เก่า) จึงถอดจากคู่ boolean
 */
export type ApplyMode = "auto" | "code" | "manual";

export interface BuyNGetMParams {
  buy_qty: number;
  get_qty: number;
  menu_codes: string[];
  max_sets?: number;
}

export interface ItemDiscountParams {
  menu_codes: string[];
  amount_baht?: number;
  percent?: number;
}

export interface BillDiscountParams {
  min_subtotal?: number;
  amount_baht?: number;
  percent?: number;
  max_amount?: number;
}

export interface BundleItemSpec {
  menu_codes: string[];
  qty: number;
}

export interface BundleParams {
  items: BundleItemSpec[];
  bundle_price: number;
  max_sets?: number;
}

export type PromotionParams = BuyNGetMParams | ItemDiscountParams | BillDiscountParams | BundleParams;

/**
 * แม่แบบโปร (ADR-0071 ข้อ 1) — ป้ายของหน้าตั้งค่า ไม่ใช่ตัวแยกทางคิดเงิน (เครื่องคิดอ่านแค่ `rule`)
 * 4 ตัวแรก = ชนิดเดิม (แปลงกลับเป็นรูปเดิมได้ถ้ากฎอยู่ในขอบเขตเดิม — promoToLegacy)
 */
export type PromoTemplate = PromotionKind | "buy_a_get_b" | "nth_cup" | "fixed_price" | "tiered_item" | "tiered_bill" | "custom";

export const PROMO_TEMPLATES: readonly PromoTemplate[] = [
  "buy_n_get_m",
  "item_discount",
  "bill_discount",
  "bundle",
  "buy_a_get_b",
  "nth_cup",
  "fixed_price",
  "tiered_item",
  "tiered_bill",
  "custom",
];

/** ตัวแปรเมนูในเป้าหมาย — sweetness ไม่ใส่ = ทุกความหวาน */
export interface PromoVariantTarget {
  menu: string;
  size: Size;
  sweetness?: Sweetness;
}

/**
 * เป้าหมายโปร (`rule.target` · ADR-0071 ข้อ 2) — ช่องว่าง/ไม่มี = ไม่กรองด้านนั้น
 * แก้วเข้าเป้าเมื่อ (ไม่มี menus/categories/variants เลย หรือ ตรงอย่างน้อยหนึ่งใน 3 ช่อง — OR) และตรง sizes และมีตัวเลือกตรง options
 * (milk กับ grade = AND · ในช่องเดียวกัน = OR) และไม่อยู่ใน exclude_menus
 */
export interface PromoTarget {
  menus?: string[];
  categories?: string[];
  variants?: PromoVariantTarget[];
  sizes?: Size[];
  options?: { milk?: string[]; grade?: string[] };
  exclude_menus?: string[];
}

/** รางวัลรายแก้วลดทั้งแก้ว (`cup` ค่าตั้งต้น) หรือเฉพาะค่าตัวเลือกที่จ่ายจริง (`option` — ต้องมี target.options) */
export type PromoApplyTo = "cup" | "option";

export type PromoGetDiscount = { percent: number } | { baht: number } | { fixed_price: number };

export type PromoReward =
  | { type: "percent"; percent: number; apply_to?: PromoApplyTo }
  | { type: "amount"; baht: number; apply_to?: PromoApplyTo }
  | { type: "fixed_price"; price: number; apply_to?: PromoApplyTo }
  | {
      type: "buy_get";
      buy: number;
      get: number;
      get_target?: PromoTarget | null;
      get_discount: PromoGetDiscount;
      get_pick?: "cheapest" | "most_expensive";
      max_sets?: number | null;
    }
  | { type: "bundle"; items: Array<{ target: PromoTarget; qty: number }>; price: number; max_sets?: number | null }
  | { type: "bill_percent"; percent: number }
  | { type: "bill_amount"; baht: number }
  | { type: "tiered"; basis: PromoTierCupBasis; apply_to?: PromoApplyTo; tiers: PromoCupTier[] }
  | { type: "bill_tiers"; basis: PromoTierBillBasis; tiers: PromoBillTier[] };

/**
 * ส่วนลดขั้นบันได (ADR-0072 ข้อ 1 · `rule.v = 2`) — ได้ขั้นสูงสุดที่ถึงขั้นเดียว (ค่าฐาน ≥ min) · 2–5 ขั้น · min เพิ่มขึ้นเคร่งครัด ·
 * ทุกขั้นใช้คีย์รางวัลเดียวกัน · ขั้นสูงลดไม่น้อยกว่าขั้นต่ำ
 * - รายแก้ว (`tiered`): qty = จำนวนแก้วที่รับโปรนี้ได้ ณ ตอนคิด · amount = ผลรวมราคาที่เหลือของแก้วชุดนั้น → ขั้นที่ได้ลดทุกแก้วในชุด
 * - ทั้งบิล (`bill_tiers`): subtotal = ฐานเดียวกับ min_subtotal · qty = แก้วในบิลที่ตรง `target` (ไม่นับแก้วส่วนลดกรอกเอง)
 */
export type PromoTierCupBasis = "qty" | "amount";
export type PromoTierBillBasis = "subtotal" | "qty";
export type PromoCupTier = { min: number } & ({ percent: number } | { baht: number } | { fixed_price: number });
export type PromoBillTier = { min: number } & ({ percent: number } | { baht: number });

/** ขั้นที่ได้ (order_promotions.detail.tier — ADR-0072 ข้อ 1 "แช่แข็ง") · index เริ่ม 0 ตามลำดับใน rule.reward.tiers · value = ค่าฐาน ณ ตอนคิด */
export interface PromoTierHit {
  index: number;
  min: number;
  basis: PromoTierCupBasis | PromoTierBillBasis;
  value: number;
}

/**
 * กฎโปร (`promotions.rule` · ADR-0071 ข้อ 2 · ADR-0072 ข้อ 1) — ตรวจด้วย validatePromoRule() = SQL dayo_promo_rule_problems()
 * `v` = รุ่นขั้นต่ำที่กฎใช้พอดี (promoRuleMinVersion: tiered/bill_tiers = 2 · อื่น = 1)
 */
export interface PromoRule {
  v: 1 | 2;
  scope: "cup" | "bill";
  /** scope=cup · หรือ scope=bill เฉพาะ reward bill_tiers basis=qty (ใช้นับแก้ว — ADR-0072) */
  target?: PromoTarget;
  reward: PromoReward;
  /** scope=bill เท่านั้น — เทียบยอดหลังส่วนลดรายแก้ว + โปรทั้งบิลกลุ่มก่อนหน้า · ห้ามใช้คู่กับขั้นบันได */
  min_subtotal?: number | null;
  /** เพดานส่วนลดต่อบิลของโปรนี้ · null/ไม่มี = ไม่จำกัด */
  cap_baht?: number | null;
  /** ค่าตั้งต้น round2 · floor_baht = ปัดส่วนลดต่อแก้ว (หรือทั้งบิล) ลงเป็นบาทเต็ม */
  rounding?: "round2" | "floor_baht";
  /** = not stackable เดิม: ใช้ได้แล้วโปรรายแก้วตัวถัดไปในกลุ่มเดียวกันหยุด */
  stop_group?: boolean;
  /** scope=bill เท่านั้น · ค่าตั้งต้น yield (มีส่วนลดทั้งบิลที่กรอกเอง = ไม่คิดโปรนี้) */
  manual_bill?: "yield" | "combine";
}

/** ช่วงเวลาโปร (ADR-0071 ข้อ 3) — days ว่าง = ทุกวัน · from/to null ทั้งคู่ = ทั้งวัน · from > to = ข้ามเที่ยงคืน (ของวันเริ่ม) */
export interface TimeWindow {
  days: number[];
  from: string | null;
  to: string | null;
}

/** กลุ่มโปร (promotion_groups · ADR-0071 ข้อ 1/4) — separate = ข้ามแก้วที่ได้โปรจากกลุ่มก่อนหน้า · stack = ลดต่อจากราคาที่เหลือ */
export interface PromotionGroup {
  code: string;
  name: string;
  sortOrder: number;
  stackMode: "separate" | "stack";
  isActive?: boolean;
}

/** กลุ่มตั้งต้นของทุกร้าน (seed) — โปรที่ไม่มี groupCode อยู่กลุ่มนี้ */
export const DEFAULT_PROMOTION_GROUP: PromotionGroup = { code: "main", name: "ทั่วไป", sortOrder: 0, stackMode: "separate", isActive: true };

export interface Promotion {
  id: string;
  code: string | null;
  name: string;
  /**
   * ชนิดเดิม (ADR-0071 R4: คอลัมน์อนุมาน อ่านอย่างเดียว) — null เมื่อกฎแปลงเป็นรูปเดิมไม่ได้
   * เครื่องคิดใช้ `rule` ก่อนเสมอ · ไม่มี `rule` (แคตตาล็อกเก่า) → promoFromLegacy(kind, params, stackable)
   */
  kind?: PromotionKind | null;
  /** แม่แบบ (ADR-0071) — ไม่มี = kind */
  template?: PromoTemplate;
  /** กฎโปร (ADR-0071) — ไม่มี = ถอดจาก kind/params/stackable */
  rule?: PromoRule | null;
  /** ช่วงเวลาหลายช่วง (ADR-0071 ข้อ 3) — ไม่มี (undefined/null) = ถอดจาก daysOfWeek/timeFrom/timeTo */
  timeWindows?: TimeWindow[] | null;
  /** รหัสกลุ่มโปร — ไม่มี = "main" */
  groupCode?: string | null;
  startsOn?: string | null; // yyyy-mm-dd
  endsOn?: string | null; // yyyy-mm-dd
  daysOfWeek?: number[] | null; // 0=อาทิตย์
  timeFrom?: string | null; // 'HH:MM'
  timeTo?: string | null; // 'HH:MM'
  channelCodes?: string[] | null; // ว่าง/null = ทุกช่องทาง
  /** ต้นฉบับ (ADR-0070) — ไม่มี (แคตตาล็อกเก่า) = ถอดจาก requiresCode/autoApply ด้วย promoApplyMode() */
  applyMode?: ApplyMode;
  requiresCode?: boolean;
  autoApply?: boolean;
  priority: number;
  stackable?: boolean | null;
  isActive: boolean;
  params?: PromotionParams | null;
  /**
   * จำกัดจำนวนครั้ง (ADR-0072 ข้อ 2 — เงื่อนไขของโปร ไม่ใช่ส่วนของ rule) · แสดงผลเท่านั้น ไม่มีจำนวนคงเหลือ ·
   * เครื่องคิดไม่อ่าน (ระบบนับเองแล้วส่งผลเป็น PromotionContext.exhaustedPromotions) · E1 ส่งเมื่อ promo_rule_version ≥ 2
   */
  usageLimitTotal?: number | null;
  usageLimitPerDay?: number | null;
}

/**
 * โปรที่ครบจำนวนครั้งแล้ว (ADR-0072 ข้อ 2) — ระบบนับจากบิลในฐาน (SQL `dayo_promo_usage_exhausted`) แล้วส่งให้เครื่องคิด
 * (`p_ctx.exhausted_promotions`) · scope: total = ครบรวม · day = ครบของวันขาย · id เดียวกันมีทั้งคู่ = total ก่อน ·
 * แท็บเล็ต POS นับเองไม่ได้ (ขายออฟไลน์) จึงส่งว่างเสมอ
 */
export interface ExhaustedPromotion {
  id: string;
  scope: "total" | "day";
}

/**
 * จำนวนครั้งคงเหลือของโปรจำกัดที่ใช้ในบิลนี้ (ADR-0072 ข้อ 2 · = quote_order.promo_usage) — นับแบบไม่ล็อก ตัวอย่างเท่านั้น
 * (ไม่แช่แข็ง) · null = ไม่มีเพดานด้านนั้น (แสดงเฉพาะที่มีค่า) · เฉพาะโปรจำกัดที่ถูกใช้จริงในบิลนี้เท่านั้น
 */
export interface PromoUsage {
  promotionId: string;
  remainingTotal: number | null;
  remainingDay: number | null;
}

/** รายการโปรเลือกเองที่พนักงานกดได้ตอนนี้ (ADR-0070 ข้อ 3) — คืนจาก selectablePromotions()/quote_order.selectable_promotions */
export interface SelectablePromotion {
  promotionId: string;
  code: string | null;
  name: string;
  /** แม่แบบ (ADR-0071 ข้อ 7 — แทน kind) */
  template: PromoTemplate;
  /** ชนิดเดิม (null = แปลงไม่ได้) — คงไว้ให้ผู้เรียกเดิม */
  kind: PromotionKind | null;
}

// ── คำสั่งขาย / บิลร่าง ──────────────────────────────────────────

export interface OrderDraftLine {
  code: string;
  size?: Size | null;
  sweetness?: Sweetness | null;
  milk?: MilkCode | null;
  grade?: MatchaGradeCode | null;
  qty: number;
  free?: boolean;
  discountBaht?: number | null;
  discountPercent?: number | null;
  discountReason?: string | null;
}

export interface OrderDraft {
  saleDate: string; // yyyy-mm-dd (Asia/Bangkok)
  saleTime?: string; // 'HH:MM' Asia/Bangkok — ใช้เช็กเงื่อนไขเวลาโปร
  /** ว่าง = ช่องทางเริ่มต้นของร้าน (catalog.settings.defaultChannelCode — ADR-0046) */
  channelCode: string;
  paymentCode?: string | null;
  lines: OrderDraftLine[];
  billDiscountBaht?: number | null;
  billDiscountPercent?: number | null;
  /** หมายเหตุส่วนลดทั้งบิลที่พนักงานกรอกเอง — บังคับเมื่อลดจนบิลเหลือ 0 บาท (ADR-0039) */
  billDiscountReason?: string | null;
  promoCode?: string | null;
  skipPromotionIds?: string[];
  /** โปรเลือกเอง (apply_mode='manual') ที่พนักงานเลือกไว้ต่อบิลนี้ (ADR-0070 ข้อ 3) — เกิน 20 ตัว = DY422 ที่จริง */
  manualPromotionIds?: string[];
  /** เหตุผลเลือกโปร (ADR-0070 ข้อ 4) — บังคับเมื่อบิลเหลือ ฿0 เพราะโปรเลือกเอง · 1–200 ตัว ตัดช่องว่างหัวท้าย */
  manualPromotionReason?: string | null;
  /** โปรที่ครบจำนวนครั้งแล้ว (ADR-0072 ข้อ 2) — ส่งต่อให้ PromotionContext · ไม่ส่ง = ไม่มี (แท็บเล็ต POS ว่างเสมอ) */
  exhaustedPromotions?: ExhaustedPromotion[];
}

/**
 * ค่าเริ่มต้นการขายของร้าน (ตาราง shop_settings — ADR-0046) · มากับ get_full_catalog.settings
 * ไม่มี/ขาดบางคีย์ = DEFAULT_SALE_SETTINGS (16 oz · 100% · store · นมสด) — ต้องตรงกับ dayo_shop_settings ใน SQL
 */
export interface ShopSaleSettings {
  shopName: string;
  defaultSize: Size;
  defaultSweetness: Sweetness;
  defaultChannelCode: string;
  defaultMilk: MilkCode;
  maxQtyPerLine: number;
  backdateDays: number;
  recentOrdersCount: number;
}

export interface OrderCatalog {
  /** ค่าเริ่มต้นการขาย (ADR-0046) — ไม่ส่ง = ค่าตั้งต้น */
  settings?: Partial<ShopSaleSettings> | null;
  /** ขนาดแก้วของร้าน (ADR-0054) — รวมที่ปิดใช้ (isActive:false); ปุ่ม/ตัวเลือกกรองเฉพาะ active เอง */
  sizes: CupSizeEntry[];
  variants: MenuVariantEntry[];
  ingredients: Record<string, IngredientEntry>;
  bases: Record<string, BaseEntry>;
  milkOptions: MenuOptionMilkEntry[];
  gradeOptions: MenuOptionGradeEntry[];
  channels: SalesChannelEntry[];
  paymentMethods: PaymentMethodEntry[];
  promotions: Promotion[];
  /** กลุ่มโปร (ADR-0071) — ไม่มี = กลุ่ม main แบบ separate กลุ่มเดียว */
  promotionGroups?: PromotionGroup[];
}

export interface QuotedLine {
  lineNo: number;
  menuCode: string;
  menuNameTh: string;
  size: Size;
  sweetness: Sweetness;
  milk: MilkCode;
  grade: MatchaGradeCode | null;
  qty: number;
  unitPrice: number;
  unitCost: number;
  discountPerCup: number;
  discountReason: string | null;
  promotionId: string | null;
  lineTotal: number;
  /** ค่าตัวเลือกที่แช่แข็งลง order_items.option_add_json (ADR-0071 ข้อ 2/6) — ไม่มีตัวเลือกบวกราคา = null */
  optionAdds?: OptionAdds | null;
  /** order_items.promo_breakdown — เฉพาะแก้วที่ได้ส่วนลดจากมากกว่า 1 โปร · อื่น = null */
  promoBreakdown?: PromoBreakdownEntry[] | null;
}

/** ค่าตัวเลือกของแก้ว: add = ราคาบวกตามแคตตาล็อก (ก่อนช่องทาง) · paid = ส่วนที่จ่ายจริงหลังบวกช่องทาง (R2) */
export interface OptionAddEntry {
  code: string;
  add: number;
  paid: number;
}

export interface OptionAdds {
  milk?: OptionAddEntry;
  grade?: OptionAddEntry;
}

export interface PromoBreakdownEntry {
  promotionId: string;
  amount: number;
}

export interface AppliedPromotion {
  promotionId: string;
  code: string | null;
  name: string;
  /** ชื่อแม่แบบ (ADR-0071 ข้อ 6 · ADR-0072 — order_promotions.kind 10 ค่า · โปรรูปเดิม = kind เดิม) */
  kind: PromoTemplate;
  discountAmount: number;
  detail?: Record<string, unknown>;
}

export interface QuoteResult {
  ok: boolean;
  lines: QuotedLine[];
  promotionsApplied: AppliedPromotion[];
  itemsSubtotal: number;
  itemsDiscount: number;
  billDiscountAmount: number;
  totalAmount: number;
  channelFeeAmount: number;
  costTotal: number;
  grossProfit: number | null;
  gpPercent: number | null;
  /**
   * เงื่อนไขล้วน (ADR-0070 ข้อ 4 — Q-D, = SQL `dayo_manual_reason_guard`): ยอดบิล = 0 และมีโปรเลือกเองให้ส่วนลด > 0
   * ไม่ขึ้นกับว่ามีเหตุผลแล้วหรือยัง — ใช้บอกหน้าจอว่าต้องแสดงช่องเหตุผล · `ok=false` เฉพาะตอนธงนี้ขึ้น "และ" ยังไม่มีเหตุผล
   */
  manualPromotionReasonRequired: boolean;
  warnings: string[];
  /** โปรจำกัดจำนวนครั้งที่ใช้ในบิลนี้ + เหลือกี่ครั้ง (ADR-0072 ข้อ 2 · = quote_order.promo_usage) — ไม่มี = ไม่มีโปรจำกัดในบิลนี้ */
  promoUsage?: PromoUsage[];
}

// ── บอท: คำสั่งพิมพ์ (§5.1) ────────────────────────────────────────

export type BotCommand =
  | "help"
  | "menus"
  | "recipe"
  | "sop"
  | "cost"
  | "base"
  | "stock"
  | "speed"
  | "tips"
  | "board"
  | "myid"
  | "sale"
  | "sale_batch"
  | "summary"
  | "recent"
  | "edit"
  | "cancel"
  | "receive"
  | "code";

export interface ParsedCommand {
  cmd: BotCommand | null;
  arg: string;
}

export interface ParsedQuery {
  name: string;
  size: Size | null;
  sweetness: Sweetness | null;
  milk: MilkCode | null;
  grade: MatchaGradeCode | null;
  qty: number | null;
  channelCode: string | null;
  paymentCode: string | null;
  free: boolean;
  discountBaht: number | null;
  discountPercent: number | null;
  promoCode: string | null;
  note: string | null;
}

export interface MenuIndexEntry {
  code: string;
  nameTh: string;
  family: string;
  active: boolean;
  aliases: Array<[string, number]>;
}

export interface SaleBlockItem extends ParsedQuery {
  raw: string;
}

export interface SaleBlockResult {
  ok: boolean;
  channelCode: string | null;
  paymentCode: string | null;
  promoCode: string | null;
  billDiscountBaht: number | null;
  billDiscountPercent: number | null;
  /** หมายเหตุหลัง # ในบรรทัดแรก เมื่อบรรทัดแรกมีส่วนลดทั้งบิล (ADR-0039) — ไม่งั้น null */
  billDiscountReason: string | null;
  /**
   * โปรเลือกเอง (apply_mode='manual') ที่พนักงานพิมพ์ด้วยบรรทัดหัว "โปร <รหัสหรือชื่อโปร>" (ADR-0070 ข้อ 11) — พิมพ์ได้หลายบรรทัด
   * เป็นโทเคนดิบ (รหัสหรือชื่อ) ยังไม่ resolve เป็น id — แอปบอทจับคู่กับแคตตาล็อก (เฉพาะโปรโหมด manual) เอง · ตัดซ้ำแล้ว, เกิน 20 รายการ = error
   */
  manualPromotionTokens: string[];
  /** เหตุผลเลือกโปรจากบรรทัดหัว "เหตุผล <ข้อความ>" (ADR-0070 ข้อ 4/11) — ตัดช่องว่างหัวท้ายแล้ว ยังไม่ตรวจความยาว/ตัวควบคุม (computeOrder ตรวจ) · ไม่มีบรรทัดนี้ = null */
  manualPromotionReason: string | null;
  items: SaleBlockItem[];
  errors: string[];
}

export interface BatchLineResult extends SaleBlockItem {
  lineNo: number;
}

export interface ParseBatchOptions {
  /** วันนี้ตามเวลา Asia/Bangkok (yyyy-mm-dd) — ปกติมาจาก bkkDay(0) */
  today: string;
  isOwner: boolean;
  maxLines?: number;
  maxBackDays?: number;
}

export interface BatchResult {
  ok: boolean;
  saleDate: string | null;
  items: BatchLineResult[];
  errors: string[];
}

// ── นำเข้า/ส่งออก: payload เดียวกับ RPC import_catalog (DATA-CONTRACT §1 §7) ──
// ใช้ร่วมกันระหว่าง extractLegacyWorkbook.ts (นำเข้าครั้งแรก) และ template.ts (เทมเพลต Excel)
// ชื่อคีย์ตรงกับคีย์ธรรมชาติ/คอลัมน์ใน §2 (camelCase ของชื่อคอลัมน์ Supabase)

export interface ImportIngredientRow {
  code: string;
  name: string;
  type: string; // 'วัตถุดิบ' | 'บรรจุภัณฑ์' | 'อื่นๆ'
  subcategory: string | null;
  useUnit: "ml" | "g" | "ชิ้น";
  buyUnit: string;
  packToUseFactor: number;
  buyPrice: number;
  reorderPoint: number | null;
  note: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface ImportBaseLineRow {
  ingredientCode: string;
  qty: number;
  sortOrder: number;
}

export interface ImportBaseRow {
  code: string;
  name: string;
  yieldQty: number;
  yieldUnit: "ml" | "g";
  instructions: string[];
  safetyNote: string | null;
  shelfLifeHours: number | null;
  sortOrder: number;
  isActive: boolean;
  lines: ImportBaseLineRow[];
}

export interface ImportMenuRow {
  code: string;
  nameTh: string;
  family: string;
  categoryLabel: string | null;
  allowOatMilk: boolean;
  isMatcha: boolean;
  aliases: Array<[string, number]>;
  sortOrder: number;
  isActive: boolean;
}

export interface ImportVariantRow {
  menuCode: string;
  size: Size;
  sweetness: Sweetness;
  price: number;
  note: string | null;
  isActive: boolean;
}

export interface ImportRecipeLineRow {
  menuCode: string;
  size: Size;
  sweetness: Sweetness;
  lineNo: number;
  ingredientCode: string | null;
  baseCode: string | null;
  qty: number;
  unit: "ml" | "g" | "ชิ้น";
}

export interface ImportOptionRow {
  kind: "milk" | "matcha_grade";
  code: string;
  label: string;
  /** คำที่พนักงานพิมพ์แทนตัวเลือกนี้ (menu_options.aliases) — ADR-0038 */
  aliases: string[];
  ingredientCode: string;
  priceAdd: number;
  multiplier: number | null;
  isDefault: boolean;
  note: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface ImportSopRow {
  menuCode: string;
  techniqueGroup: string | null;
  steps: string[];
  steps20oz: string[];
  tips: string[];
  equipment: string | null;
  targetSeconds: number | null;
  basesNeeded: string[];
  speedMix: string | null;
  speedIce: string | null;
  speedStation: string | null;
}

export interface ImportSectionRow {
  kind: "speed" | "tips" | "base" | "other";
  name: string;
  title: string | null;
  lines: string[];
  sortOrder: number;
  isActive: boolean;
}

export interface ImportStockCountRow {
  ingredientCode: string;
  countedQty: number;
}

export interface ImportChannelRow {
  code: string;
  name: string;
}

export interface ImportSalesChannelRow {
  code: string;
  name: string;
  aliases: string[];
  priceMarkupPct: number;
  priceAddBaht: number;
  rounding: "ceil_baht" | "none";
  feePct: number;
  defaultPaymentMethodCode: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface ImportPaymentMethodRow {
  code: string;
  name: string;
  aliases: string[];
  sortOrder: number;
  isActive: boolean;
}

/**
 * แถวโปรของ import_catalog/เทมเพลต (ADR-0071 ข้อ 11) — รูปใหม่ = template + rule + timeWindows + groupCode
 * รูปเดิม (kind + params + stackable + daysOfWeek/timeFrom/timeTo) ยังรับได้ (ไฟล์เก่า — ถอดด้วย promoFromLegacy)
 * ผู้เขียนรูปใหม่ไม่ต้องส่งคอลัมน์เดิม (trigger ในฐานอนุมานให้)
 */
export interface ImportPromotionRow {
  code: string | null;
  name: string;
  template?: PromoTemplate;
  rule?: PromoRule;
  timeWindows?: TimeWindow[];
  groupCode?: string | null;
  kind?: PromotionKind | null;
  startsOn: string | null;
  endsOn: string | null;
  daysOfWeek?: number[] | null;
  timeFrom?: string | null;
  timeTo?: string | null;
  channelCodes: string[] | null;
  /** ต้นฉบับเดียว (ADR-0070 ข้อ 1) — นำเข้าเทมเพลตเขียนเฉพาะฟิลด์นี้ (requires_code/auto_apply เป็น generated ในฐาน) */
  applyMode: ApplyMode;
  priority: number;
  stackable?: boolean | null;
  params?: PromotionParams | null;
  isActive: boolean;
  /**
   * จำกัดจำนวนครั้ง (ADR-0072 D25 — ชีต "โปรโมชั่น" คอลัมน์ "จำกัดรวม"/"จำกัดต่อวัน") ·
   * ไม่มีคีย์ (undefined) = ไม่มีคอลัมน์ในไฟล์ → RPC คงค่าเดิม · null = คอลัมน์มีแต่ว่าง → ไม่จำกัด · เลข = ตั้งเพดานใหม่
   */
  usageLimitTotal?: number | null;
  usageLimitPerDay?: number | null;
}

/** แถวกลุ่มโปร (ชีต "กลุ่มโปร" · ADR-0071 ข้อ 11) */
export interface ImportPromotionGroupRow {
  code: string;
  name: string;
  sortOrder: number;
  stackMode: "separate" | "stack";
  isActive: boolean;
}

/** payload ที่ส่งเข้า RPC import_catalog — extractLegacyWorkbook คืนเฉพาะกลุ่มที่ §1 ระบุ (ไม่มีโปร/วิธีชำระ/ช่องทางเต็มรูป) */
export interface ImportPayload {
  ingredients: ImportIngredientRow[];
  bases: ImportBaseRow[];
  menus: ImportMenuRow[];
  variants: ImportVariantRow[];
  recipeLines: ImportRecipeLineRow[];
  options: ImportOptionRow[];
  sops: ImportSopRow[];
  sections: ImportSectionRow[];
  stockCounts: ImportStockCountRow[];
  channels: ImportChannelRow[];
  /** เฉพาะเทมเพลต §7 (extractLegacyWorkbook ไม่ส่งมา) */
  salesChannels?: ImportSalesChannelRow[];
  paymentMethods?: ImportPaymentMethodRow[];
  promotions?: ImportPromotionRow[];
  /** กลุ่มโปร (ADR-0071) — นำเข้าก่อน promotions */
  promotionGroups?: ImportPromotionGroupRow[];
}

export function emptyImportPayload(): ImportPayload {
  return {
    ingredients: [],
    bases: [],
    menus: [],
    variants: [],
    recipeLines: [],
    options: [],
    sops: [],
    sections: [],
    stockCounts: [],
    channels: [],
    salesChannels: [],
    paymentMethods: [],
    promotions: [],
    promotionGroups: [],
  };
}

export interface ImportMeta {
  sourceFileName: string | null;
  extractedAt: string;
  counts: Record<string, number>;
}

export interface CostCheckEntry {
  menuCode: string;
  size: Size;
  sweetness: Sweetness;
  /** ต้นทุน/แก้ว (บาท) และ GP % ที่ Excel คำนวณไว้ตอน Save — ใช้เทียบในเทสต์เท่านั้น (ADR-0026) */
  expectedCost: number | null;
  expectedGp: number | null;
}

export interface LegacyImportResult {
  meta: ImportMeta;
  payload: ImportPayload;
  warnings: string[];
  costCheck: CostCheckEntry[];
}
