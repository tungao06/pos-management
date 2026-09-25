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
  ingredientId: string;
  priceAdd: number;
  /** คำที่พนักงานพิมพ์แทนตัวเลือกนี้ (menu_options.aliases) — ADR-0038 */
  aliases: string[];
}

export interface MenuOptionGradeEntry {
  code: MatchaGradeCode;
  ingredientId: string;
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

export interface Promotion {
  id: string;
  code: string | null;
  name: string;
  kind: PromotionKind;
  startsOn?: string | null; // yyyy-mm-dd
  endsOn?: string | null; // yyyy-mm-dd
  daysOfWeek?: number[] | null; // 0=อาทิตย์
  timeFrom?: string | null; // 'HH:MM'
  timeTo?: string | null; // 'HH:MM'
  channelCodes?: string[] | null; // ว่าง/null = ทุกช่องทาง
  requiresCode: boolean;
  autoApply: boolean;
  priority: number;
  stackable: boolean;
  isActive: boolean;
  params: PromotionParams;
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
}

export interface AppliedPromotion {
  promotionId: string;
  code: string | null;
  name: string;
  kind: PromotionKind;
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
  warnings: string[];
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

export interface ImportPromotionRow {
  code: string | null;
  name: string;
  kind: PromotionKind;
  startsOn: string | null;
  endsOn: string | null;
  daysOfWeek: number[] | null;
  timeFrom: string | null;
  timeTo: string | null;
  channelCodes: string[] | null;
  requiresCode: boolean;
  autoApply: boolean;
  priority: number;
  stackable: boolean;
  params: PromotionParams;
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
