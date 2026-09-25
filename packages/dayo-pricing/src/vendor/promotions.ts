// promotions.ts — เครื่องคิดโปรโมชั่น 4 ชนิด (DATA-CONTRACT §4.3, ADR-0030)
// ทำงานกับ "แก้ว" แยกหน่วย (Cup) เพื่อให้ซื้อ N แถม M / เซ็ตราคาพิเศษ เลือกแก้วที่ถูกต้องได้ระดับแก้วเดียว
// แล้วค่อยรวมกลับเป็นบรรทัดใน money.ts#computeOrder

import { round2 } from "./fmt";
import { dayOfWeek } from "./time";
import type {
  AppliedPromotion,
  BillDiscountParams,
  BuyNGetMParams,
  BundleParams,
  ItemDiscountParams,
  MatchaGradeCode,
  MilkCode,
  Promotion,
  Size,
  Sweetness,
} from "./types";

export interface PricedCup {
  menuCode: string;
  size: Size;
  sweetness: Sweetness;
  milk: MilkCode;
  grade: MatchaGradeCode | null;
  unitPrice: number;
  unitCost: number;
  discountPerCup: number;
  discountReason: string | null;
  promotionId: string | null;
  /** พนักงานใส่ ฟรี/ลด เองบนบรรทัดนี้แล้ว — ไม่รับโปรรายแก้วซ้อน (§4.2 ข้อ 3) */
  manual: boolean;
}

export interface PromotionContext {
  saleDate: string; // yyyy-mm-dd
  saleTime?: string | null; // 'HH:MM'
  channelCode: string;
  promoCode?: string | null;
  skipPromotionIds?: string[];
}

export interface ApplyPromotionsResult {
  cups: PricedCup[];
  applied: AppliedPromotion[];
  billDiscountAmount: number;
  billDiscountPromotion: AppliedPromotion | null;
}

export interface ManualBillDiscount {
  billDiscountBaht?: number | null;
  billDiscountPercent?: number | null;
}

function isPromoEligible(promo: Promotion, ctx: PromotionContext): boolean {
  if (!promo.isActive) return false;
  if (ctx.skipPromotionIds?.includes(promo.id)) return false;
  if (promo.startsOn && ctx.saleDate < promo.startsOn) return false;
  if (promo.endsOn && ctx.saleDate > promo.endsOn) return false;
  if (promo.daysOfWeek && promo.daysOfWeek.length > 0 && !promo.daysOfWeek.includes(dayOfWeek(ctx.saleDate))) return false;
  // ไม่รู้เวลาขาย = ไม่ให้โปรที่จำกัดช่วงเวลา (fail closed)
  if ((promo.timeFrom || promo.timeTo) && !ctx.saleTime) return false;
  if (promo.timeFrom && ctx.saleTime! < promo.timeFrom) return false;
  if (promo.timeTo && ctx.saleTime! > promo.timeTo) return false;
  if (promo.channelCodes && promo.channelCodes.length > 0 && !promo.channelCodes.includes(ctx.channelCode)) return false;
  if (promo.requiresCode) return ctx.promoCode != null && ctx.promoCode === promo.code;
  return promo.autoApply;
}

function eligibleCupIndices(cups: PricedCup[], menuCodes: string[] | undefined): number[] {
  const codes = menuCodes && menuCodes.length > 0 ? new Set(menuCodes) : null;
  const out: number[] = [];
  cups.forEach((cup, idx) => {
    if (cup.manual || cup.promotionId) return;
    if (codes && !codes.has(cup.menuCode)) return;
    out.push(idx);
  });
  return out;
}

function applyBuyNGetM(cups: PricedCup[], promo: Promotion): AppliedPromotion | null {
  const params = promo.params as BuyNGetMParams;
  const groupSize = params.buy_qty + params.get_qty;
  if (groupSize <= 0 || params.get_qty <= 0) return null;
  const idxs = eligibleCupIndices(cups, params.menu_codes);
  let sets = Math.floor(idxs.length / groupSize);
  if (params.max_sets != null) sets = Math.min(sets, params.max_sets);
  if (sets <= 0) return null;
  const freeCount = sets * params.get_qty;
  // เลือกแก้วที่ถูกที่สุด freeCount แก้ว จากกลุ่มที่เข้าเงื่อนไข (คงลำดับเดิมเมื่อราคาเท่ากัน)
  const ranked = idxs.map((idx) => ({ idx, price: cups[idx]!.unitPrice })).sort((a, b) => a.price - b.price);
  const chosen = ranked.slice(0, freeCount);
  let discountAmount = 0;
  for (const { idx } of chosen) {
    const cup = cups[idx]!;
    cup.discountPerCup = cup.unitPrice;
    cup.promotionId = promo.id;
    discountAmount += cup.unitPrice;
  }
  return {
    promotionId: promo.id,
    code: promo.code,
    name: promo.name,
    kind: "buy_n_get_m",
    discountAmount: round2(discountAmount),
    detail: { sets, freeCount },
  };
}

function applyItemDiscount(cups: PricedCup[], promo: Promotion): AppliedPromotion | null {
  const params = promo.params as ItemDiscountParams;
  const idxs = eligibleCupIndices(cups, params.menu_codes);
  if (idxs.length === 0) return null;
  let discountAmount = 0;
  for (const idx of idxs) {
    const cup = cups[idx]!;
    const amt =
      params.amount_baht != null
        ? Math.min(cup.unitPrice, params.amount_baht)
        : round2(cup.unitPrice * ((params.percent ?? 0) / 100));
    cup.discountPerCup = Math.min(cup.unitPrice, round2(amt));
    cup.promotionId = promo.id;
    discountAmount += cup.discountPerCup;
  }
  return {
    promotionId: promo.id,
    code: promo.code,
    name: promo.name,
    kind: "item_discount",
    discountAmount: round2(discountAmount),
  };
}

function applyBundle(cups: PricedCup[], promo: Promotion): AppliedPromotion | null {
  const params = promo.params as BundleParams;
  if (!params.items.length) return null;
  // ต่อ item spec หนึ่ง ๆ: เรียงแก้วที่เข้าเงื่อนไขราคาสูง→ต่ำ (จับคู่แก้วราคาสูงสุดก่อน §4.3)
  const perItemCandidates = params.items.map((spec) => {
    const idxs = eligibleCupIndices(cups, spec.menu_codes);
    const ranked = idxs.map((idx) => ({ idx, price: cups[idx]!.unitPrice })).sort((a, b) => b.price - a.price);
    return { spec, ranked };
  });
  let sets = Math.min(...perItemCandidates.map(({ spec, ranked }) => Math.floor(ranked.length / spec.qty)));
  if (!Number.isFinite(sets)) sets = 0;
  if (params.max_sets != null) sets = Math.min(sets, params.max_sets);
  if (sets <= 0) return null;

  let discountAmount = 0;
  for (let s = 0; s < sets; s++) {
    const setIdxs: number[] = [];
    for (const { spec, ranked } of perItemCandidates) {
      const start = s * spec.qty;
      for (let i = 0; i < spec.qty; i++) {
        const entry = ranked[start + i];
        if (entry) setIdxs.push(entry.idx);
      }
    }
    const setTotal = setIdxs.reduce((sum, idx) => sum + cups[idx]!.unitPrice, 0);
    const setDiscount = Math.max(0, round2(setTotal - params.bundle_price));
    if (setDiscount <= 0 || setTotal <= 0) {
      for (const idx of setIdxs) cups[idx]!.promotionId = promo.id;
      continue;
    }
    let allocated = 0;
    setIdxs.forEach((idx, i) => {
      const cup = cups[idx]!;
      cup.promotionId = promo.id;
      if (i === setIdxs.length - 1) {
        cup.discountPerCup = round2(setDiscount - allocated);
      } else {
        const share = round2((cup.unitPrice / setTotal) * setDiscount);
        cup.discountPerCup = share;
        allocated += share;
      }
      discountAmount += cup.discountPerCup;
    });
  }
  return {
    promotionId: promo.id,
    code: promo.code,
    name: promo.name,
    kind: "bundle",
    discountAmount: round2(discountAmount),
    detail: { sets },
  };
}

function computeBillDiscount(
  cups: PricedCup[],
  promotions: Promotion[],
  ctx: PromotionContext,
  manual: ManualBillDiscount,
): { amount: number; applied: AppliedPromotion | null } {
  const itemsSubtotal = cups.reduce((s, c) => s + c.unitPrice, 0);
  const itemsDiscount = cups.reduce((s, c) => s + c.discountPerCup, 0);
  const afterItems = Math.max(0, round2(itemsSubtotal - itemsDiscount));

  if (manual.billDiscountBaht != null || manual.billDiscountPercent != null) {
    const raw =
      manual.billDiscountBaht != null ? manual.billDiscountBaht : round2(afterItems * ((manual.billDiscountPercent ?? 0) / 100));
    return { amount: round2(Math.max(0, Math.min(raw, afterItems))), applied: null };
  }

  const billPromos = promotions.filter((p) => p.kind === "bill_discount" && isPromoEligible(p, ctx));
  let best: { promo: Promotion; amount: number } | null = null;
  for (const promo of billPromos) {
    const params = promo.params as BillDiscountParams;
    if (params.min_subtotal != null && afterItems < params.min_subtotal) continue;
    let amt = params.amount_baht != null ? params.amount_baht : round2(afterItems * ((params.percent ?? 0) / 100));
    if (params.max_amount != null) amt = Math.min(amt, params.max_amount);
    amt = round2(Math.max(0, Math.min(amt, afterItems)));
    if (!best || amt > best.amount) best = { promo, amount: amt };
  }
  if (!best) return { amount: 0, applied: null };
  return {
    amount: best.amount,
    applied: {
      promotionId: best.promo.id,
      code: best.promo.code,
      name: best.promo.name,
      kind: "bill_discount",
      discountAmount: best.amount,
    },
  };
}

/**
 * ใส่โปรให้ cups ที่ส่งเข้ามา (mutate สำเนาที่ caller เตรียมไว้แล้ว — ฟังก์ชันนี้ยัง pure เพราะ caller
 * รับผิดชอบสร้างอาเรย์ใหม่ก่อนเรียก) เรียงตาม priority · หยุดหลังโปร stackable=false ตัวแรกที่ใช้ได้จริง
 */
export function applyPromotions(
  cupsIn: PricedCup[],
  promotions: Promotion[],
  ctx: PromotionContext,
  manualBillDiscount: ManualBillDiscount = {},
): ApplyPromotionsResult {
  const cups = cupsIn.map((c) => ({ ...c }));
  const applied: AppliedPromotion[] = [];

  const perCupPromos = promotions
    .filter((p) => p.kind !== "bill_discount" && isPromoEligible(p, ctx))
    .sort((a, b) => a.priority - b.priority);

  for (const promo of perCupPromos) {
    let result: AppliedPromotion | null = null;
    if (promo.kind === "buy_n_get_m") result = applyBuyNGetM(cups, promo);
    else if (promo.kind === "item_discount") result = applyItemDiscount(cups, promo);
    else if (promo.kind === "bundle") result = applyBundle(cups, promo);
    if (result) {
      applied.push(result);
      if (!promo.stackable) break;
    }
  }

  const { amount: billDiscountAmount, applied: billDiscountPromotion } = computeBillDiscount(
    cups,
    promotions,
    ctx,
    manualBillDiscount,
  );
  if (billDiscountPromotion) applied.push(billDiscountPromotion);

  return { cups, applied, billDiscountAmount, billDiscountPromotion };
}
