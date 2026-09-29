// load.ts — อ่านชุดเคสกลางของเครื่องคิดโปร (ADR-0071 ข้อ 5/11) แล้วแปลงเป็นรูปของ @dayo/shared
// ไฟล์ JSON ในโฟลเดอร์นี้ใช้ร่วมกันระหว่าง vitest (shared) และ test/db/promo_rules.db.test.ts (SQL) — ดู README.md
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ApplyMode,
  ImportPayload,
  ImportPromotionGroupRow,
  ImportPromotionRow,
  MatchaGradeCode,
  MenuVariantEntry,
  MilkCode,
  OptionAdds,
  OrderCatalog,
  OrderDraft,
  PromoRule,
  PromoTemplate,
  PromoTierHit,
  Promotion,
  PromotionKind,
  PromotionParams,
  QuoteResult,
  Size,
  Sweetness,
  TimeWindow,
} from "../../../src/types.js";
import type { PromotionContext } from "../../../src/promotions.js";

export const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

/** ร่างบิลในไฟล์ — เหมือน OrderDraft แต่อ้างโปรด้วย "ชื่อ" (id ในฐานสุ่ม) · ชื่อที่ไม่พบในไฟล์ = ส่งเป็น id ตรงตัว */
export interface FixtureDraft {
  saleDate: string;
  saleTime?: string;
  channelCode: string;
  lines: Array<{
    code: string;
    size: Size;
    sweetness: Sweetness;
    qty: number;
    milk?: MilkCode | null;
    grade?: MatchaGradeCode | null;
    free?: boolean;
    discountBaht?: number | null;
    discountPercent?: number | null;
    discountReason?: string | null;
  }>;
  promoCode?: string | null;
  billDiscountBaht?: number | null;
  billDiscountPercent?: number | null;
  billDiscountReason?: string | null;
  skipPromotions?: string[];
  manualPromotions?: string[];
  manualPromotionReason?: string | null;
  /**
   * โปรที่ครบจำนวนครั้ง (ADR-0072 ข้อ 2 · rules-usage.json) — shared ส่งเข้า PromotionContext ตรง ๆ · SQL ตั้งเพดาน 1 ครั้ง
   * (total → usage_limit_total · day → usage_limit_per_day) + บิลที่ใช้โปรแล้ว 1 ใบในวันขายของเคส ก่อน quote_order
   */
  exhaustedPromotions?: Array<{ promotion: string; scope: "total" | "day" }>;
}

/** ผลที่ต้องได้ (เงินทุกช่อง + คำเตือน) — ไม่มีต้นทุน/กำไร (ไม่ใช่เรื่องของเครื่องคิดโปร) · โปรอ้างด้วยชื่อ */
export interface FixtureExpected {
  ok: boolean;
  itemsSubtotal: number;
  itemsDiscount: number;
  billDiscountAmount: number;
  totalAmount: number;
  channelFeeAmount: number;
  manualPromotionReasonRequired: boolean;
  lines: Array<{
    menuCode: string;
    size: Size;
    sweetness: Sweetness;
    milk: MilkCode;
    grade: MatchaGradeCode | null;
    qty: number;
    unitPrice: number;
    discountPerCup: number;
    promotion: string | null;
    lineTotal: number;
    /** rules-* เท่านั้น: order_items.option_add_json (มีเมื่อไม่ null) */
    optionAdds?: OptionAdds;
    /** rules-* เท่านั้น: order_items.promo_breakdown (ชื่อโปร · มีเมื่อไม่ null) */
    promoBreakdown?: Array<{ promotion: string; amount: number }>;
  }>;
  /** tier = order_promotions.detail.tier (ADR-0072 — มีเฉพาะโปรขั้นบันได · index เริ่ม 0) */
  promotionsApplied: Array<{ name: string; kind: string; discountAmount: number; tier?: PromoTierHit }>;
  warnings: string[];
  /** ชื่อโปรเลือกเองที่กดได้ (selectablePromotions / quote_order.selectable_promotions) — มีเฉพาะเคสที่ตรวจ (rules-usage.json) */
  selectable?: string[];
}

export interface FixtureCase {
  name: string;
  draft: FixtureDraft;
  expected?: FixtureExpected;
}

/** โปรรูปเดิม = ImportPromotionRow รูปเดิมครบทุกช่อง (ส่งเข้า import_catalog ได้ตรงตัว) */
export type LegacyFixturePromo = ImportPromotionRow & {
  kind: PromotionKind;
  params: PromotionParams;
  stackable: boolean;
  daysOfWeek: number[] | null;
  timeFrom: string | null;
  timeTo: string | null;
};

/** โปรรูปใหม่ (ADR-0071) = ImportPromotionRow รูปใหม่ (ไม่มีคอลัมน์เดิม) */
export interface RuleFixturePromo {
  code: string | null;
  name: string;
  template: PromoTemplate;
  rule: PromoRule;
  timeWindows: TimeWindow[];
  groupCode: string;
  startsOn: string | null;
  endsOn: string | null;
  channelCodes: string[] | null;
  applyMode: ApplyMode;
  priority: number;
  isActive: boolean;
}

export interface RuleFixtureFile {
  description: string;
  /** "rule" = โปรรูปใหม่ · ผลตรวจด้วยมือในเทสต์หน่วย แล้วบันทึกจากเครื่องคิดใหม่ */
  form: "rule";
  groups: ImportPromotionGroupRow[];
  promotions: RuleFixturePromo[];
  cases: FixtureCase[];
}

export interface FixtureFile {
  description: string;
  /** "legacy" = โปรรูปเดิม (kind+params) · ผลคือ golden ของเครื่องคิดเดิมหลัง 0070 · ห้ามแก้ตัวเลขด้วยมือ */
  form: "legacy";
  promotions: LegacyFixturePromo[];
  cases: FixtureCase[];
}

export function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, name), "utf8")) as T;
}

export function fixtureFileNames(prefix: string): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort();
}

/** catalog.json (รูป import_catalog) → OrderCatalog ของ shared (= get_full_catalog หลังนำเข้า) */
export function catalogFromPayload(p: ImportPayload): Omit<OrderCatalog, "promotions"> {
  const ingredients: OrderCatalog["ingredients"] = {};
  for (const i of p.ingredients) {
    ingredients[i.code] = { id: i.code, code: i.code, name: i.name, useUnit: i.useUnit, costPerUseUnit: i.buyPrice / i.packToUseFactor };
  }
  const variants: MenuVariantEntry[] = p.variants.map((v) => {
    const m = p.menus.find((mm) => mm.code === v.menuCode);
    if (!m) throw new Error(`fixture: ไม่พบเมนู ${v.menuCode}`);
    return {
      menuCode: m.code,
      menuNameTh: m.nameTh,
      family: m.family,
      categoryLabel: m.categoryLabel,
      menuSortOrder: m.sortOrder,
      size: v.size,
      sweetness: v.sweetness,
      price: v.price,
      allowOatMilk: m.allowOatMilk,
      isMatcha: m.isMatcha,
      recipeLines: p.recipeLines
        .filter((r) => r.menuCode === v.menuCode && r.size === v.size && r.sweetness === v.sweetness)
        .sort((a, b) => a.lineNo - b.lineNo)
        .map((r) => ({ ingredientId: r.ingredientCode, baseId: null, qty: r.qty, unit: r.unit })),
    };
  });
  return {
    sizes: [
      { code: "16 oz", label: "16 oz", sortOrder: 0, isActive: true },
      { code: "20 oz", label: "20 oz", sortOrder: 1, isActive: true },
    ],
    variants,
    ingredients,
    bases: {},
    milkOptions: p.options
      .filter((o) => o.kind === "milk")
      .map((o) => ({ code: o.code as MilkCode, ingredientId: o.ingredientCode, priceAdd: o.priceAdd, aliases: o.aliases })),
    gradeOptions: p.options
      .filter((o) => o.kind === "matcha_grade")
      .map((o) => ({
        code: o.code,
        ingredientId: o.ingredientCode,
        multiplier: o.multiplier ?? 1,
        priceAdd: o.priceAdd,
        isDefault: o.isDefault,
        aliases: o.aliases,
      })),
    channels: (p.salesChannels ?? []).map((c) => ({
      code: c.code,
      name: c.name,
      aliases: c.aliases,
      priceMarkupPct: c.priceMarkupPct,
      priceAddBaht: c.priceAddBaht,
      rounding: c.rounding,
      feePct: c.feePct,
      defaultPaymentMethodCode: c.defaultPaymentMethodCode,
    })),
    paymentMethods: (p.paymentMethods ?? []).map((m) => ({ code: m.code, name: m.name, aliases: m.aliases })),
  };
}

/** เรียงแบบ SQL `order by priority, code (nulls last), id` — ในไฟล์ใช้ชื่อแทน id (เคสต้องไม่พึ่งลำดับ id: ดู assertNoIdTies) */
export function sqlPromoOrder<T extends { priority: number; code: string | null; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.code !== b.code) {
      if (a.code == null) return 1;
      if (b.code == null) return -1;
      return a.code < b.code ? -1 : 1;
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

/** กันเคสที่ผลขึ้นกับ uuid สุ่มในฐาน: priority เท่ากันต้องมี code ต่างกัน (ตัวใหญ่/ตัวเลขล้วน ให้ collation ใดก็เรียงเท่ากัน) */
export function assertNoIdTies(rows: Array<{ priority: number; code: string | null; name: string }>): void {
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      if (a.priority !== b.priority) continue;
      if (a.code === b.code) throw new Error(`fixture: ${a.name} กับ ${b.name} priority+code เท่ากัน (ลำดับขึ้นกับ id)`);
      for (const c of [a.code, b.code]) {
        if (c != null && !/^[A-Z0-9]+$/.test(c)) throw new Error(`fixture: code ${c} ต้องเป็น A-Z0-9 เมื่อ priority ชนกัน`);
      }
    }
  }
}

/** โปรรูปเดิม → Promotion (แคตตาล็อกเดิม · id = ชื่อ) */
export function legacyPromotion(row: LegacyFixturePromo): Promotion {
  const mode: ApplyMode = row.applyMode;
  return {
    id: row.name,
    code: row.code,
    name: row.name,
    kind: row.kind,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    daysOfWeek: row.daysOfWeek,
    timeFrom: row.timeFrom,
    timeTo: row.timeTo,
    channelCodes: row.channelCodes,
    applyMode: mode,
    requiresCode: mode === "code",
    autoApply: mode === "auto",
    priority: row.priority,
    stackable: row.stackable,
    isActive: row.isActive,
    params: row.params,
  };
}

/** ร่างในไฟล์ → OrderDraft ของ shared (id โปรฝั่ง shared = ชื่อ จึงส่งชื่อตรงตัว · ฝั่ง SQL แปลงชื่อ → uuid) */
/** โปรรูปใหม่ → Promotion (id = ชื่อ) */
export function rulePromotion(row: RuleFixturePromo): Promotion {
  return {
    id: row.name,
    code: row.code,
    name: row.name,
    template: row.template,
    rule: row.rule,
    timeWindows: row.timeWindows,
    groupCode: row.groupCode,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    channelCodes: row.channelCodes,
    applyMode: row.applyMode,
    priority: row.priority,
    isActive: row.isActive,
  };
}

export function toOrderDraft(d: FixtureDraft): OrderDraft {
  const ids = (names: string[] | undefined) => [...(names ?? [])];
  const out: OrderDraft = {
    saleDate: d.saleDate,
    channelCode: d.channelCode,
    lines: d.lines.map((l) => ({ ...l })),
    promoCode: d.promoCode ?? null,
    billDiscountBaht: d.billDiscountBaht ?? null,
    billDiscountPercent: d.billDiscountPercent ?? null,
    billDiscountReason: d.billDiscountReason ?? null,
    skipPromotionIds: ids(d.skipPromotions),
    manualPromotionIds: ids(d.manualPromotions),
    manualPromotionReason: d.manualPromotionReason ?? null,
  };
  if (d.saleTime != null) out.saleTime = d.saleTime;
  if (d.exhaustedPromotions) out.exhaustedPromotions = d.exhaustedPromotions.map((e) => ({ id: e.promotion, scope: e.scope }));
  return out;
}

/** บริบทโปรเดียวกับที่ computeOrder สร้างจากร่าง (ใช้กับ selectablePromotions ในเคส rules-usage.json) */
export function toPromotionContext(d: FixtureDraft): PromotionContext {
  const od = toOrderDraft(d);
  return {
    saleDate: od.saleDate,
    saleTime: od.saleTime ?? null,
    channelCode: od.channelCode,
    promoCode: od.promoCode ?? null,
    skipPromotionIds: od.skipPromotionIds ?? [],
    manualPromotionIds: od.manualPromotionIds ?? [],
    exhaustedPromotions: od.exhaustedPromotions ?? [],
  };
}

/** QuoteResult → รูป expected (id โปร = ชื่อ ในฝั่ง shared) · ext = ใส่ optionAdds/promoBreakdown (ไฟล์ rules-*) */
export function toExpected(q: QuoteResult, ext = false): FixtureExpected {
  return {
    ok: q.ok,
    itemsSubtotal: q.itemsSubtotal,
    itemsDiscount: q.itemsDiscount,
    billDiscountAmount: q.billDiscountAmount,
    totalAmount: q.totalAmount,
    channelFeeAmount: q.channelFeeAmount,
    manualPromotionReasonRequired: q.manualPromotionReasonRequired,
    lines: q.lines.map((l) => ({
      menuCode: l.menuCode,
      size: l.size,
      sweetness: l.sweetness,
      milk: l.milk,
      grade: l.grade,
      qty: l.qty,
      unitPrice: l.unitPrice,
      discountPerCup: l.discountPerCup,
      promotion: l.promotionId,
      lineTotal: l.lineTotal,
      ...(ext && l.optionAdds ? { optionAdds: l.optionAdds } : {}),
      ...(ext && l.promoBreakdown ? { promoBreakdown: l.promoBreakdown.map((b) => ({ promotion: b.promotionId, amount: b.amount })) } : {}),
    })),
    promotionsApplied: q.promotionsApplied.map((p) => {
      const tier = p.detail?.tier as PromoTierHit | undefined;
      return { name: p.name, kind: p.kind, discountAmount: p.discountAmount, ...(tier ? { tier } : {}) };
    }),
    warnings: q.warnings,
  };
}
