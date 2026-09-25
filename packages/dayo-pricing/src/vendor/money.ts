// money.ts — ราคาและบิล (DATA-CONTRACT §4.2, ADR-0013/0023/0029/0031)
// ต้องได้ตัวเลขเท่ากับ RPC quote_order ใน Supabase (กฎเหล็กข้อ 3 — เทสต์บังคับ)

import { applyPromotions } from "./promotions";
import type { PricedCup } from "./promotions";
import { round2 } from "./fmt";
import { variantCost } from "./cost";
import { saleSettingsOf } from "./shopSettings";
import type {
  MatchaGradeCode,
  MenuVariantEntry,
  MilkCode,
  OrderCatalog,
  OrderDraft,
  QuotedLine,
  QuoteResult,
  RecipeLineEntry,
  SalesChannelEntry,
} from "./types";

export interface ApplyOptionsChoice {
  milk?: MilkCode | null;
  grade?: MatchaGradeCode | null;
}

export interface ApplyOptionsResult {
  ok: boolean;
  recipeLines: RecipeLineEntry[];
  priceAdd: number;
  milk: MilkCode;
  grade: MatchaGradeCode | null;
  warnings: string[];
}

/**
 * นมโอ๊ต/เกรดผง (§4.1) — แทนที่บรรทัดสูตรที่อ้างวัตถุดิบนมสด/ผงเกรดเริ่มต้นด้วยวัตถุดิบของตัวเลือกที่เลือก
 * เข้าเงื่อนไขไม่ได้ (ไม่มีนมสดในสูตร / เมนูไม่ให้นมโอ๊ต / เมนูไม่ใช่มัตจะ) = ❌ ทำเครื่องหมาย ok:false
 */
export function applyOptions(
  variant: MenuVariantEntry,
  choice: ApplyOptionsChoice,
  catalog: Pick<OrderCatalog, "milkOptions" | "gradeOptions">,
): ApplyOptionsResult {
  const lines = variant.recipeLines.map((l) => ({ ...l }));
  const warnings: string[] = [];
  let ok = true;
  let priceAdd = 0;
  let milkUsed: MilkCode = "fresh";
  let gradeUsed: MatchaGradeCode | null = null;

  if (choice.milk === "oat") {
    const freshOpt = catalog.milkOptions.find((o) => o.code === "fresh");
    const oatOpt = catalog.milkOptions.find((o) => o.code === "oat");
    const freshLineIdx = freshOpt ? lines.findIndex((l) => l.ingredientId === freshOpt.ingredientId) : -1;
    if (!variant.allowOatMilk || !oatOpt || freshLineIdx === -1) {
      warnings.push(`⚠ ${variant.menuNameTh} ไม่มีตัวเลือกนมโอ๊ต`);
      ok = false;
    } else {
      const line = lines[freshLineIdx];
      if (line) lines[freshLineIdx] = { ...line, ingredientId: oatOpt.ingredientId };
      priceAdd += oatOpt.priceAdd;
      milkUsed = "oat";
    }
  }

  if (choice.grade) {
    if (!variant.isMatcha) {
      warnings.push("⚠ เกรดมัตจะใช้ได้เฉพาะเมนูมัตจะ");
      ok = false;
    } else {
      const gradeOpt = catalog.gradeOptions.find((o) => o.code === choice.grade);
      const defaultOpt = catalog.gradeOptions.find((o) => o.isDefault);
      const powderLineIdx = defaultOpt ? lines.findIndex((l) => l.ingredientId === defaultOpt.ingredientId) : -1;
      if (!gradeOpt || powderLineIdx === -1) {
        warnings.push(`⚠ ไม่พบตัวเลือกเกรด ${choice.grade}`);
        ok = false;
      } else {
        const line = lines[powderLineIdx];
        if (line) {
          lines[powderLineIdx] = { ...line, ingredientId: gradeOpt.ingredientId, qty: round2(line.qty * gradeOpt.multiplier) };
        }
        priceAdd += gradeOpt.priceAdd;
        gradeUsed = gradeOpt.code;
      }
    }
  }

  return { ok, recipeLines: lines, priceAdd, milk: milkUsed, grade: gradeUsed, warnings };
}

/** ราคาช่องทาง (ADR-0013 ข้อ 2): ปัดตามกติกาช่องทางแล้วบวกค่าธรรมเนียมคงที่ */
export function channelPrice(basePrice: number, channel: Pick<SalesChannelEntry, "priceMarkupPct" | "priceAddBaht" | "rounding">): number {
  const marked = round2(basePrice * (1 + channel.priceMarkupPct));
  const rounded = channel.rounding === "ceil_baht" ? Math.ceil(marked) : marked;
  return round2(rounded + channel.priceAddBaht);
}

export interface LineDiscountInput {
  free?: boolean;
  discountBaht?: number | null;
  discountPercent?: number | null;
}

/** ส่วนลดรายแก้วที่พนักงานใส่ (§4.2 ข้อ 2) — ห้ามเกิน unit_price */
export function lineDiscount(unitPrice: number, input: LineDiscountInput): number {
  if (input.free) return unitPrice;
  if (input.discountPercent != null) return round2(Math.min(unitPrice, Math.max(0, unitPrice * (input.discountPercent / 100))));
  if (input.discountBaht != null) return round2(Math.min(unitPrice, Math.max(0, input.discountBaht)));
  return 0;
}

/**
 * นมที่ไม่ระบุ (ADR-0046) = dayo_impl_price_line: ร้านตั้งนมโอ๊ต + เมนูให้นมโอ๊ต + มีตัวเลือกนมโอ๊ต + สูตรมีนมสด → oat
 * ไม่เข้าเงื่อนไข = นมสด (ไม่เตือน ต่างจากสั่งนมโอ๊ตเองที่เป็น ❌)
 */
function defaultLineMilk(variant: MenuVariantEntry, catalog: Pick<OrderCatalog, "milkOptions">, defaultMilk: MilkCode): MilkCode | null {
  if (defaultMilk !== "oat" || !variant.allowOatMilk) return null;
  const fresh = catalog.milkOptions.find((o) => o.code === "fresh");
  const oat = catalog.milkOptions.find((o) => o.code === "oat");
  if (!oat || !fresh?.ingredientId) return null;
  return variant.recipeLines.some((l) => l.ingredientId === fresh.ingredientId) ? "oat" : null;
}

function findVariant(catalog: OrderCatalog, code: string, size: string, sweetness: string): MenuVariantEntry | undefined {
  return catalog.variants.find((v) => v.menuCode === code && v.size === size && v.sweetness === sweetness);
}

/** คำนวณบิลทั้งใบ (§4.2 ครบทุกข้อ) — ต้องได้ตัวเลขเท่ากับ RPC quote_order */
export function computeOrder(draft: OrderDraft, catalog: OrderCatalog): QuoteResult {
  const warnings: string[] = [];
  // ค่าเริ่มต้นของร้าน (ADR-0046) = dayo_shop_settings ใน SQL: ช่องทาง/ขนาด/ความหวาน/นม ที่ไม่ระบุ + จำนวนสูงสุดต่อรายการ
  const defaults = saleSettingsOf(catalog);
  const maxQty = defaults.maxQtyPerLine;
  const channelCode = draft.channelCode || defaults.defaultChannelCode;
  const channel = catalog.channels.find((c) => c.code === channelCode);
  if (!channel) {
    return {
      ok: false,
      lines: [],
      promotionsApplied: [],
      itemsSubtotal: 0,
      itemsDiscount: 0,
      billDiscountAmount: 0,
      totalAmount: 0,
      channelFeeAmount: 0,
      costTotal: 0,
      grossProfit: null,
      gpPercent: null,
      warnings: [`ไม่พบช่องทางขาย "${channelCode}"`],
    };
  }

  let ok = true;
  const cups: PricedCup[] = [];

  // ขนาดร่าง (ADR-0039 / migration 0012 ข้อ 4): เกิน 50 รายการ หรือเกิน 500 แก้วรวม ของจริง RPC จะปฏิเสธ (DY422)
  // ที่นี่แค่เตือน (ไม่ throw) เพราะ computeOrder เป็นตัวอย่างก่อนยืนยันเท่านั้น (กฎเหล็กข้อ 3)
  if (draft.lines.length > 50) {
    warnings.push(`บิลมีรายการเกิน 50 รายการ (${draft.lines.length}) — บันทึกจริงจะถูกปฏิเสธ (DY422)`);
  }
  const totalCups = draft.lines.reduce((s, l) => s + Math.max(1, Math.min(maxQty, Math.round(l.qty ?? 1))), 0);
  if (totalCups > 500) {
    warnings.push(`บิลมีจำนวนแก้วรวมเกิน 500 แก้ว (${totalCups}) — บันทึกจริงจะถูกปฏิเสธ (DY422)`);
  }

  for (const draftLine of draft.lines) {
    const size = draftLine.size ?? defaults.defaultSize;
    const sweetness = draftLine.sweetness ?? defaults.defaultSweetness;
    const qty = Math.max(1, Math.min(maxQty, draftLine.qty ?? 1));
    if (draftLine.qty != null && draftLine.qty !== qty) warnings.push(`จำนวน ${draftLine.qty} ปรับเป็น ${qty} แก้ว`);
    const variant = findVariant(catalog, draftLine.code, size, sweetness);
    if (!variant) {
      warnings.push(`ไม่พบสูตร "${draftLine.code} ${size} ${sweetness}"`);
      ok = false;
      continue;
    }

    const optResult = applyOptions(
      variant,
      { milk: draftLine.milk ?? defaultLineMilk(variant, catalog, defaults.defaultMilk), grade: draftLine.grade ?? null },
      catalog,
    );
    warnings.push(...optResult.warnings);
    if (!optResult.ok) {
      ok = false;
      continue;
    }

    if (draftLine.free && !draftLine.discountReason?.trim()) {
      warnings.push(`"${draftLine.code}" ให้ฟรีต้องมีหมายเหตุ (ADR-0023)`);
      ok = false;
      continue;
    }

    const { cost } = variantCost(optResult.recipeLines, catalog.ingredients, catalog.bases);
    const basePrice = variant.price + optResult.priceAdd;
    const unitPrice = channelPrice(basePrice, channel);
    const discountPerCup = lineDiscount(unitPrice, {
      free: draftLine.free ?? false,
      discountBaht: draftLine.discountBaht ?? null,
      discountPercent: draftLine.discountPercent ?? null,
    });

    // ลดบาท/% จน ≥ ราคาแก้ว (ราคาแก้ว > 0) โดยไม่มีหมายเหตุ = เหมือนฟรีไม่มีเหตุผล (ADR-0039 · migration 0012 dayo_price_line)
    if (
      (draftLine.discountBaht != null || draftLine.discountPercent != null) &&
      unitPrice > 0 &&
      discountPerCup >= unitPrice &&
      !draftLine.discountReason?.trim()
    ) {
      warnings.push(`"${draftLine.code}" ลดเต็มราคาต้องมีหมายเหตุ (ADR-0023)`);
      ok = false;
      continue;
    }

    const manual = Boolean(draftLine.free) || draftLine.discountBaht != null || draftLine.discountPercent != null;

    for (let i = 0; i < qty; i++) {
      cups.push({
        menuCode: variant.menuCode,
        size: variant.size,
        sweetness: variant.sweetness,
        milk: optResult.milk,
        grade: optResult.grade,
        unitPrice,
        unitCost: cost,
        discountPerCup,
        discountReason: manual ? (draftLine.discountReason ?? null) : null,
        promotionId: null,
        manual,
      });
    }
  }

  const promoResult = applyPromotions(
    cups,
    catalog.promotions,
    {
      saleDate: draft.saleDate,
      saleTime: draft.saleTime ?? null,
      channelCode: channel.code,
      promoCode: draft.promoCode ?? null,
      skipPromotionIds: draft.skipPromotionIds ?? [],
    },
    { billDiscountBaht: draft.billDiscountBaht ?? null, billDiscountPercent: draft.billDiscountPercent ?? null },
  );

  // จัดกลุ่มแก้วที่ราคา/ส่วนลด/โปรเหมือนกันกลับเป็นบรรทัด คงลำดับที่พบครั้งแรก (ตัวอย่างก่อนยืนยัน/order_items)
  const grouped = new Map<string, QuotedLine>();
  const order: string[] = [];
  for (const cup of promoResult.cups) {
    const key = [cup.menuCode, cup.size, cup.sweetness, cup.milk, cup.grade, cup.unitPrice, cup.discountPerCup, cup.promotionId, cup.discountReason].join(
      "\u0000",
    );
    let line = grouped.get(key);
    if (!line) {
      const variant = findVariant(catalog, cup.menuCode, cup.size, cup.sweetness);
      line = {
        lineNo: 0,
        menuCode: cup.menuCode,
        menuNameTh: variant?.menuNameTh ?? cup.menuCode,
        size: cup.size,
        sweetness: cup.sweetness,
        milk: cup.milk,
        grade: cup.grade,
        qty: 0,
        unitPrice: cup.unitPrice,
        unitCost: cup.unitCost,
        discountPerCup: cup.discountPerCup,
        discountReason: cup.discountReason,
        promotionId: cup.promotionId,
        lineTotal: 0,
      };
      grouped.set(key, line);
      order.push(key);
    }
    line.qty += 1;
  }

  const lines: QuotedLine[] = order.map((key, i) => {
    const line = grouped.get(key);
    if (!line) throw new Error("unreachable: grouped line missing");
    line.lineNo = i + 1;
    line.lineTotal = round2((line.unitPrice - line.discountPerCup) * line.qty);
    return line;
  });

  const itemsSubtotal = round2(lines.reduce((s, l) => s + l.unitPrice * l.qty, 0));
  const itemsDiscount = round2(lines.reduce((s, l) => s + l.discountPerCup * l.qty, 0));
  const billDiscountAmount = promoResult.billDiscountAmount;
  const totalAmount = round2(Math.max(0, itemsSubtotal - itemsDiscount - billDiscountAmount));
  const channelFeeAmount = round2(totalAmount * channel.feePct);
  const costTotal = round2(lines.reduce((s, l) => s + l.unitCost * l.qty, 0));
  const grossProfit = round2(totalAmount - costTotal - channelFeeAmount);
  const gpPercent = totalAmount === 0 ? null : Math.round((grossProfit / totalAmount) * 10000) / 10000;

  // ส่วนลดทั้งบิลที่กรอกเอง (บาท/%) จนบิลเหลือ 0 โดยไม่มีหมายเหตุ = ไม่ผ่าน (ADR-0039 · migration 0012 dayo_quote_guard)
  // โปร bill_discount มีชื่อโปรเป็นเหตุผลอยู่แล้ว จึงไม่เข้าเงื่อนไขนี้ (เช็กเฉพาะที่กรอกเอง)
  const itemsAfterLineDiscounts = round2(itemsSubtotal - itemsDiscount);
  if (
    (draft.billDiscountBaht != null || draft.billDiscountPercent != null) &&
    !draft.billDiscountReason?.trim() &&
    itemsAfterLineDiscounts > 0 &&
    billDiscountAmount >= itemsAfterLineDiscounts
  ) {
    ok = false;
    warnings.push("ส่วนลดทั้งบิลเต็มยอดต้องมีหมายเหตุ (ADR-0023)");
  }

  return {
    ok,
    lines,
    promotionsApplied: promoResult.applied,
    itemsSubtotal,
    itemsDiscount,
    billDiscountAmount,
    totalAmount,
    channelFeeAmount,
    costTotal,
    grossProfit,
    gpPercent,
    warnings,
  };
}
