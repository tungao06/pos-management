// promotions.ts — เครื่องคิดโปรตามกฎ (ADR-0071 ข้อ 4 · DATA-CONTRACT §4.3) = SQL dayo_promo_engine ทุกสตางค์
// ทำงานกับ "แก้ว" แยกหน่วย (PricedCup) แล้ว money.ts#computeOrder รวมกลับเป็นบรรทัด
// ลำดับ: กลุ่ม (sort_order, code) → รอบรายแก้ว (ในกลุ่มตาม priority, code, id — แคตตาล็อกเรียงมาแล้ว) → รอบทั้งบิล → ส่วนลดทั้งบิลที่กรอกเอง
// โปรที่ไม่มี `rule` (แคตตาล็อกเก่า/แท็บเล็ตรุ่นเก่า) ถอดจาก kind/params/stackable ด้วย promoFromLegacy — ผลเท่าเครื่องคิดเดิม (golden)

import { round2 } from "./fmt";
import { dayOfWeek } from "./time";
import {
  PROMO_MAIN_GROUP,
  compileTarget,
  resolvePromoRule,
  resolvePromoWindows,
  promoWindowMatch,
  windowsNeedTime,
  type TargetMatcher,
  type TargetSubject,
} from "./promoRule";
import type {
  AppliedPromotion,
  ApplyMode,
  ExhaustedPromotion,
  MatchaGradeCode,
  MilkCode,
  OptionAdds,
  PromoBreakdownEntry,
  PromoRule,
  PromoTarget,
  PromoTemplate,
  PromoTierHit,
  Promotion,
  PromotionGroup,
  SelectablePromotion,
  Size,
  Sweetness,
  TimeWindow,
} from "./types";

/**
 * โค้ดโปรแบบเดียวกับ SQL `dayo_norm_promo_code` (ADR-0070 ข้อ 9): ตัดช่องว่างหัวท้าย (ชุดเดียวกับ `String.prototype.trim`
 * ของ JS) + a-z → A-Z เฉพาะ ASCII (ตัวอักษรอื่น เช่น ไทย คงเดิม ให้ JS กับ Postgres ได้ผลตรงกันทุกตัวอักษร —
 * ห้ามใช้ toUpperCase()/upper() ของภาษา) · ว่างหลังตัด = null (เหมือน SQL `nullif(..., '')`)
 */
export function normPromoCode(raw: string): string | null {
  const trimmed = raw.trim().replace(/[a-z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 32));
  return trimmed === "" ? null : trimmed;
}

/**
 * วิธีใช้จริงของโปรนี้ (ADR-0070 ข้อ 1/2): อ่าน `applyMode` ก่อนเสมอ ไม่มี (แคตตาล็อกเก่าที่ cache ไว้) → ถอดจากคู่ boolean
 * requiresCode=true → 'code' · autoApply=true → 'auto' · ทั้งคู่ false → 'manual'
 */
export function promoApplyMode(promo: Pick<Promotion, "applyMode" | "requiresCode" | "autoApply">): ApplyMode {
  if (promo.applyMode) return promo.applyMode;
  if (promo.requiresCode) return "code";
  if (promo.autoApply) return "auto";
  return "manual";
}

export interface PricedCup {
  menuCode: string;
  /** menu_items.category_label — ใช้จับ target.categories (ADR-0071) */
  categoryLabel?: string | null;
  size: Size;
  sweetness: Sweetness;
  milk: MilkCode;
  grade: MatchaGradeCode | null;
  unitPrice: number;
  unitCost: number;
  discountPerCup: number;
  discountReason: string | null;
  /** โปรของกลุ่มแรกที่ได้แก้วนี้ (order_items.promotion_id) */
  promotionId: string | null;
  /** พนักงานใส่ ฟรี/ลด เองบนบรรทัดนี้แล้ว — ไม่รับโปรรายแก้วซ้อน (§4.2 ข้อ 3) */
  manual: boolean;
  /** ค่าตัวเลือกที่บวกราคา (add ตามแคตตาล็อก · paid หลังช่องทาง R2) — ใช้กับรางวัล apply_to=option */
  optionAdds?: OptionAdds | null;
  /** ผล: เฉพาะแก้วที่ได้ส่วนลดจากมากกว่า 1 โปร (order_items.promo_breakdown) */
  promoBreakdown?: PromoBreakdownEntry[] | null;
}

export interface PromotionContext {
  saleDate: string; // yyyy-mm-dd
  saleTime?: string | null; // 'HH:MM'
  channelCode: string;
  promoCode?: string | null;
  skipPromotionIds?: string[];
  /** โปรเลือกเอง (apply_mode='manual') ที่พนักงานเลือกไว้ (ADR-0070 ข้อ 3) */
  manualPromotionIds?: string[];
  /**
   * โปรที่ครบจำนวนครั้งแล้ว (ADR-0072 ข้อ 2 · = SQL p_ctx.exhausted_promotions) — ใช้ไม่ได้ทุกโหมด · โค้ด/เลือกเองที่ครบ = คำเตือน
   * "ครบจำนวนครั้งแล้ว" (total ก่อน) / "ครบจำนวนครั้งต่อวันแล้ว" ต่อจากเหตุเงื่อนไขเดิม · selectablePromotions ไม่แสดง
   */
  exhaustedPromotions?: ExhaustedPromotion[];
}

export interface ApplyPromotionsResult {
  cups: PricedCup[];
  applied: AppliedPromotion[];
  /** รวมส่วนลดทั้งบิล (โปรทั้งบิลทุกกลุ่ม + ที่กรอกเอง) */
  billDiscountAmount: number;
  /** โปรทั้งบิลตัวแรกที่ใช้ (เดิมใช้ได้ตัวเดียว — คงไว้ให้ผู้เรียกเดิม) */
  billDiscountPromotion: AppliedPromotion | null;
  /** โปรทั้งบิลทุกตัวที่ใช้ (ตัวละกลุ่ม · ADR-0071 ข้อ 4.6) */
  billPromotions: AppliedPromotion[];
  /** "ไม่ใช้โปร <ชื่อ>: <เหตุ>" — id ที่เลือกแต่ผิดโหมด/ไม่พบ/ไม่เข้าเงื่อนไข (ADR-0070 ข้อ 3 — ไม่ปฏิเสธบิล) */
  warnings: string[];
}

export interface ManualBillDiscount {
  billDiscountBaht?: number | null;
  billDiscountPercent?: number | null;
}

// ── โปรที่เตรียมแล้ว ───────────────────────────────────────────────────────

interface PreparedPromo {
  promo: Promotion;
  template: PromoTemplate;
  rule: PromoRule;
  windows: TimeWindow[];
  groupCode: string;
  mode: ApplyMode;
}

function preparePromo(promo: Promotion): PreparedPromo | null {
  const rr = resolvePromoRule(promo);
  if (!rr) return null;
  return {
    promo,
    template: rr.template,
    rule: rr.rule,
    windows: resolvePromoWindows(promo),
    groupCode: promo.groupCode || PROMO_MAIN_GROUP,
    mode: promoApplyMode(promo),
  };
}

/** เหตุ "ครบจำนวนครั้ง" ของโปรนี้ (ADR-0072 ข้อ 2 · = SQL dayo_promo_exhausted_reason) — id ซ้ำหลาย scope = total ก่อน · ไม่ครบ = null */
function exhaustedReason(promoId: string, ctx: PromotionContext): string | null {
  let day = false;
  for (const e of ctx.exhaustedPromotions ?? []) {
    if (e.id !== promoId) continue;
    if (e.scope === "total") return "ครบจำนวนครั้งแล้ว";
    if (e.scope === "day") day = true;
  }
  return day ? "ครบจำนวนครั้งต่อวันแล้ว" : null;
}

/**
 * เงื่อนไขร่วมของทุกโหมด (เปิดอยู่ ณ เวลาขาย · วันที่ · ช่วงเวลา · ช่องทาง · ไม่อยู่ใน skip · ยังไม่ครบจำนวนครั้ง) — ยังไม่ตัดสินตามโหมด
 */
function isConditionsMet(pp: PreparedPromo, ctx: PromotionContext): boolean {
  const promo = pp.promo;
  if (!promo.isActive) return false;
  if (ctx.skipPromotionIds?.includes(promo.id)) return false;
  if (!promoWindowMatch(pp.windows, ctx.saleDate, ctx.saleTime, { startsOn: promo.startsOn, endsOn: promo.endsOn })) return false;
  if (promo.channelCodes && promo.channelCodes.length > 0 && !promo.channelCodes.includes(ctx.channelCode)) return false;
  if (exhaustedReason(promo.id, ctx) != null) return false;
  return true;
}

const DAY_ABBR_TH = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."] as const;

function daysLabel(days: readonly number[]): string {
  const ds = Array.from(new Set(days))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b)
    .map((d) => DAY_ABBR_TH[d]);
  return ds.length > 0 ? ds.join(" ") : "-";
}

/** ช่วงเวลาแบบอ่านง่ายสำหรับคำเตือน: "จ. อ. 14:00–16:00; ทุกวัน 22:00–02:00; ส. ทั้งวัน" */
export function windowsLabel(windows: readonly TimeWindow[]): string {
  return windows
    .map((w) => {
      const d = w.days && w.days.length > 0 ? daysLabel(w.days) : "ทุกวัน";
      const t = w.from != null && w.to != null ? `${w.from.slice(0, 5)}–${w.to.slice(0, 5)}` : "ทั้งวัน";
      return `${d} ${t}`;
    })
    .join("; ");
}

/**
 * เหตุผลอ่านง่ายว่าทำไมโปรนี้ใช้ไม่ได้ตอนนี้ — สำหรับคำเตือน "ไม่ใช้โปร <ชื่อ>: <เหตุ>" เท่านั้น ไม่ใช้ในการคิดเงิน
 * ถ้อยคำตรงกับ SQL `dayo_promo_block_reason` ทุกตัวอักษร (ADR-0070 ข้อ 12) · ช่วงเวลา 1 ช่วงไม่ข้ามคืน = ข้อความเดิมทุกตัวอักษร
 * หลายช่วง/ข้ามคืน = "ไม่อยู่ในช่วงวัน/เวลาของโปร (ใช้ได้ <windowsLabel>)"
 */
function promoIneligibleReason(pp: PreparedPromo, ctx: PromotionContext): string {
  const promo = pp.promo;
  if (!promo.isActive) return "ปิดอยู่";
  if (ctx.skipPromotionIds?.includes(promo.id)) return "ถูกข้ามในบิลนี้";
  const ws = pp.windows;
  const windowOk = promoWindowMatch(ws, ctx.saleDate, ctx.saleTime, { startsOn: promo.startsOn, endsOn: promo.endsOn });
  const channelOk = !(promo.channelCodes && promo.channelCodes.length > 0 && !promo.channelCodes.includes(ctx.channelCode));
  // ADR-0072 ข้อ 2: เงื่อนไขเดิมผ่านทุกข้อ → ครบจำนวนครั้ง (SQL: coalesce(dayo_promo_block_reason_j, dayo_promo_exhausted_reason))
  if (windowOk && channelOk) return exhaustedReason(promo.id, ctx) ?? "ไม่เข้าเงื่อนไข";
  // 0070: บอกค่าที่ตั้งไว้ด้วย (วันที่ yyyy-mm-dd · วันในสัปดาห์เรียง อา.→ส. · ช่วงเวลา HH:MM–HH:MM)
  if (promo.startsOn && ctx.saleDate < promo.startsOn.slice(0, 10)) return `ยังไม่ถึงวันเริ่มโปร (เริ่ม ${promo.startsOn.slice(0, 10)})`;
  if (promo.endsOn && ctx.saleDate > promo.endsOn.slice(0, 10)) return `เลยวันสิ้นสุดโปรแล้ว (ถึง ${promo.endsOn.slice(0, 10)})`;
  if (!windowOk) {
    const single = ws.length === 1 ? ws[0]! : null;
    const simple = single != null && (single.from == null || single.to == null || single.from.slice(0, 5) < single.to.slice(0, 5));
    if (single && simple) {
      if (single.days.length > 0 && !single.days.includes(dayOfWeek(ctx.saleDate))) {
        return `ไม่ตรงวันในสัปดาห์ของโปร (ใช้ได้ ${daysLabel(single.days)})`;
      }
      if (single.from != null && !ctx.saleTime) return "ไม่รู้เวลาขาย (โปรจำกัดเวลา)";
      if (single.from != null) return `ไม่อยู่ในช่วงเวลาของโปร (ใช้ได้ ${single.from.slice(0, 5)}–${single.to!.slice(0, 5)})`;
    } else if (ws.length > 0) {
      if (!ctx.saleTime && windowsNeedTime(ws)) return "ไม่รู้เวลาขาย (โปรจำกัดเวลา)";
      return `ไม่อยู่ในช่วงวัน/เวลาของโปร (ใช้ได้ ${windowsLabel(ws)})`;
    }
  }
  if (!channelOk) return "ไม่ใช้กับช่องทางขายนี้";
  return "ไม่เข้าเงื่อนไข";
}

/** ตัดสินตามโหมด (ADR-0070 ข้อ 2): auto=ใช้เมื่อเข้าเงื่อนไข · code=โค้ดตรง (normPromoCode ทั้งคู่) · manual=id อยู่ในรายการที่เลือก */
function isUsable(pp: PreparedPromo, ctx: PromotionContext): boolean {
  if (!isConditionsMet(pp, ctx)) return false;
  if (pp.mode === "code") {
    if (!pp.promo.code || !ctx.promoCode) return false;
    const wanted = normPromoCode(pp.promo.code);
    const given = normPromoCode(ctx.promoCode);
    return wanted != null && given != null && wanted === given;
  }
  if (pp.mode === "manual") return Boolean(ctx.manualPromotionIds?.includes(pp.promo.id));
  return true; // auto
}

/** รายการโปรเลือกเองที่พนักงานกดได้ตอนนี้ (ADR-0070 ข้อ 3) — โหมด manual ที่ผ่านเงื่อนไขของบิลนี้ ไม่รวมโหมด code/auto · ไม่รวมโปรที่ครบจำนวนครั้ง (ADR-0072) */
export function selectablePromotions(promotions: Promotion[], ctx: PromotionContext): SelectablePromotion[] {
  const out: SelectablePromotion[] = [];
  for (const p of promotions) {
    const pp = preparePromo(p);
    if (!pp || pp.mode !== "manual" || !isConditionsMet(pp, ctx)) continue;
    out.push({ promotionId: p.id, code: p.code, name: p.name, template: pp.template, kind: p.kind ?? null });
  }
  return out;
}

// ── รอบรายแก้ว ──────────────────────────────────────────────────────────────

interface CupState {
  cups: PricedCup[];
  subjects: TargetSubject[];
  claims: PromoBreakdownEntry[][];
  /** ราคาที่เหลือของแก้ว = max(0, round2(unitPrice − ส่วนลดสะสม)) — อัปเดตทุกครั้งที่ claim */
  rem: Float64Array;
}

interface GroupRound {
  mode: "separate" | "stack";
  claimed: Uint8Array;
}

const remainingOf = (c: PricedCup): number => (c.discountPerCup === 0 ? Math.max(0, c.unitPrice) : Math.max(0, round2(c.unitPrice - c.discountPerCup)));

function eligibleIn(st: CupState, g: GroupRound, i: number): boolean {
  const c = st.cups[i]!;
  if (c.manual || g.claimed[i]) return false;
  return g.mode === "stack" || c.promotionId == null;
}

/** แก้วที่รับได้ในกลุ่มนี้และเข้าเป้า (ลำดับเดิม) */
function candidates(st: CupState, g: GroupRound, match: TargetMatcher): number[] {
  const out: number[] = [];
  for (let i = 0; i < st.cups.length; i++) if (eligibleIn(st, g, i) && match(st.subjects[i]!)) out.push(i);
  return out;
}

/** ค่าตัวเลือกที่จ่ายจริงของแก้วที่อยู่ในเป้า target.options (Σ paid · ADR-0071 R2) */
function optionPaid(c: PricedCup, t: PromoTarget | undefined): number {
  const adds = c.optionAdds;
  if (!adds || !t?.options) return 0;
  let sum = 0;
  const milk = t.options.milk;
  if (milk && milk.length > 0 && adds.milk && milk.includes(adds.milk.code)) sum += adds.milk.paid;
  const grade = t.options.grade;
  if (grade && grade.length > 0 && adds.grade && grade.includes(adds.grade.code)) sum += adds.grade.paid;
  return round2(sum);
}

/** ส่วนลดตามลำดับที่เลือก → ปัดลงเป็นบาท (floor_baht) → ตัดเพดาน cap_baht (แก้วท้าย ๆ ได้น้อยลง/0) */
function finishAmounts(amounts: number[], rule: PromoRule): number[] {
  let out = amounts;
  if (rule.rounding === "floor_baht") out = out.map((d) => Math.max(0, Math.floor(round2(d) + 1e-9)));
  if (rule.cap_baht != null) {
    let left = rule.cap_baht;
    out = out.map((d) => {
      const take = round2(Math.max(0, Math.min(d, left)));
      left = round2(left - take);
      return take;
    });
  }
  return out;
}

function claim(st: CupState, g: GroupRound, i: number, promoId: string, amount: number): void {
  const c = st.cups[i]!;
  g.claimed[i] = 1;
  if (c.promotionId == null) c.promotionId = promoId;
  c.discountPerCup = round2(c.discountPerCup + amount);
  st.rem[i] = remainingOf(c);
  st.claims[i]!.push({ promotionId: promoId, amount });
}

interface CupResult {
  discountAmount: number;
  detail?: Record<string, unknown>;
}

type SimpleValue = { percent: number } | { baht: number } | { fixed_price: number };

/**
 * ลดรายแก้วแบบเรียบกับชุดแก้ว idxs (ADR-0071 ข้อ 4.4) — percent / baht / fixed_price บนราคาที่เหลือ (หรือค่าตัวเลือกที่จ่ายจริง
 * เมื่อ apply_to=option) → floor_baht → cap_baht → จองแก้ว · ใช้ร่วมกับขั้นบันไดรายแก้ว (ADR-0072 — ขั้นที่ได้คิดด้วยสูตรเดียวกัน)
 */
function claimSimple(st: CupState, g: GroupRound, pp: PreparedPromo, idxs: number[], v: SimpleValue, onOption: boolean): number {
  const raw = idxs.map((i) => {
    const c = st.cups[i]!;
    const rem = st.rem[i]!;
    const base = onOption ? Math.min(rem, optionPaid(c, pp.rule.target)) : rem;
    let d: number;
    if ("percent" in v) d = round2(base * (v.percent / 100));
    else if ("baht" in v) d = Math.min(base, v.baht);
    else d = Math.max(0, round2(base - v.fixed_price));
    return Math.min(base, round2(d));
  });
  const amts = finishAmounts(raw, pp.rule);
  let total = 0;
  idxs.forEach((i, k) => {
    claim(st, g, i, pp.promo.id, amts[k]!);
    total += amts[k]!;
  });
  return round2(total);
}

/** percent / amount / fixed_price (apply_to cup|option) — ทุกแก้วที่เข้าเป้า ตามลำดับแก้ว */
function applySimple(st: CupState, g: GroupRound, pp: PreparedPromo, match: TargetMatcher): CupResult | null {
  const r = pp.rule.reward;
  if (r.type !== "percent" && r.type !== "amount" && r.type !== "fixed_price") return null;
  const idxs = candidates(st, g, match);
  if (idxs.length === 0) return null;
  const v: SimpleValue = r.type === "percent" ? { percent: r.percent } : r.type === "amount" ? { baht: r.baht } : { fixed_price: r.price };
  return { discountAmount: claimSimple(st, g, pp, idxs, v, (r.apply_to ?? "cup") === "option") };
}

/** ขั้นสูงสุดที่ค่าฐาน ≥ min (tiers เรียง min จากน้อยไปมาก — validatePromoRule บังคับ) · ไม่ถึงขั้นแรก = -1 */
function reachedTier(tiers: ReadonlyArray<{ min: number }>, value: number): number {
  let k = -1;
  for (let i = 0; i < tiers.length; i++) if (value >= tiers[i]!.min) k = i;
  return k;
}

/**
 * ขั้นบันไดรายแก้ว (ADR-0072 ข้อ 1): ชุดแก้ว = แก้วที่รับโปรนี้ได้ ณ ตอนคิด (เข้าเป้า · ไม่ใช่ส่วนลดกรอกเอง · ยังไม่ถูกจองในกลุ่ม ·
 * separate ไม่นับแก้วที่กลุ่มก่อนลดแล้ว) · ค่าฐาน qty = จำนวนแก้ว · amount = Σ ราคาที่เหลือของชุด (ราคาแก้ว ไม่ใช่ค่าตัวเลือก
 * แม้ apply_to=option) · ได้ขั้นสูงสุดที่ถึง → ลดทุกแก้วในชุดด้วยสูตรเรียบ · ไม่ถึงขั้นแรก = ไม่ใช้ (ไม่จอง · ไม่ทำให้ stop_group ทำงาน)
 */
function applyTiered(st: CupState, g: GroupRound, pp: PreparedPromo, match: TargetMatcher): CupResult | null {
  const r = pp.rule.reward;
  if (r.type !== "tiered") return null;
  const idxs = candidates(st, g, match);
  if (idxs.length === 0) return null;
  let value = idxs.length;
  if (r.basis === "amount") {
    let sum = 0;
    for (const i of idxs) sum += st.rem[i]!;
    value = round2(sum);
  }
  const k = reachedTier(r.tiers, value);
  if (k < 0) return null;
  const t = r.tiers[k]!;
  const v: SimpleValue = "percent" in t ? { percent: t.percent } : "baht" in t ? { baht: t.baht } : { fixed_price: t.fixed_price };
  const discountAmount = claimSimple(st, g, pp, idxs, v, (r.apply_to ?? "cup") === "option");
  const tier: PromoTierHit = { index: k, min: t.min, basis: r.basis, value };
  return { discountAmount, detail: { tier } };
}

/**
 * buy_get (ADR-0071 ข้อ 4.5 — ครอบ ซื้อ N แถม M เดิม): วนทีละชุด เลือกแก้วแถม `get` ใบจาก E_get เรียงตาม get_pick
 * (ราคาที่เหลือ ต่ำ→สูง หรือ สูง→ต่ำ · เท่ากัน = ลำดับเดิม) แล้วแก้วซื้อ `buy` ใบจาก E_buy ที่ยังว่าง เรียง
 * (ไม่อยู่ใน E_get ก่อน · ราคาทิศตรงข้าม · เท่ากัน = ลำดับเดิมย้อนกลับ ให้เป็นลำดับกลับของฝั่งแถมพอดี) · ไม่ครบ = หยุด
 * กลุ่มเดียวกัน (get_target=null) ได้ชุด = floor(n/(buy+get)) และแก้วแถม = get×ชุด ใบแรกตามลำดับเดิมทุกกรณี
 * แก้วฝั่งซื้อไม่ถูกจองข้ามโปร (โปรถัดไปในกลุ่มยังใช้ได้)
 */
function applyBuyGet(st: CupState, g: GroupRound, pp: PreparedPromo, match: TargetMatcher): CupResult | null {
  const r = pp.rule.reward;
  if (r.type !== "buy_get") return null;
  if (r.get <= 0 || r.buy < 0) return null;
  const buyIdx = candidates(st, g, match);
  const getMatch = r.get_target ? compileTarget(r.get_target) : match;
  const getIdx = r.get_target ? candidates(st, g, getMatch) : buyIdx;
  if (getIdx.length === 0) return null;
  const price = (i: number) => st.rem[i]!;
  const cheapest = (r.get_pick ?? "cheapest") === "cheapest";
  const getOrder = [...getIdx].sort((a, b) => (cheapest ? price(a) - price(b) : price(b) - price(a)) || a - b);
  const inGet = new Set(getIdx);
  const buyOrder = [...buyIdx].sort((a, b) => {
    const ga = inGet.has(a) ? 1 : 0;
    const gb = inGet.has(b) ? 1 : 0;
    if (ga !== gb) return ga - gb;
    return (cheapest ? price(b) - price(a) : price(a) - price(b)) || b - a;
  });
  const used = new Set<number>();
  let gp = 0;
  let bp = 0;
  const freeCups: number[] = [];
  let sets = 0;
  while (r.max_sets == null || sets < r.max_sets) {
    const setGet: number[] = [];
    while (gp < getOrder.length && used.has(getOrder[gp]!)) gp++;
    for (let k = gp; k < getOrder.length && setGet.length < r.get; k++) {
      const i = getOrder[k]!;
      if (!used.has(i)) setGet.push(i);
    }
    if (setGet.length < r.get) break;
    const setGetSet = new Set(setGet);
    const setBuy: number[] = [];
    while (bp < buyOrder.length && used.has(buyOrder[bp]!)) bp++;
    for (let k = bp; k < buyOrder.length && setBuy.length < r.buy; k++) {
      const i = buyOrder[k]!;
      if (!used.has(i) && !setGetSet.has(i)) setBuy.push(i);
    }
    if (setBuy.length < r.buy) break;
    for (const i of setGet) used.add(i);
    for (const i of setBuy) used.add(i);
    freeCups.push(...setGet);
    sets++;
  }
  if (sets <= 0) return null;
  const gd = r.get_discount;
  const raw = freeCups.map((i) => {
    const base = price(i);
    let d: number;
    if ("percent" in gd) d = round2(base * (gd.percent / 100));
    else if ("baht" in gd) d = Math.min(base, gd.baht);
    else d = Math.max(0, round2(base - gd.fixed_price));
    return Math.min(base, round2(d));
  });
  const amts = finishAmounts(raw, pp.rule);
  let total = 0;
  freeCups.forEach((i, k) => {
    claim(st, g, i, pp.promo.id, amts[k]!);
    total += amts[k]!;
  });
  return { discountAmount: round2(total), detail: { sets, freeCount: freeCups.length } };
}

/**
 * bundle (ADR-0070 ข้อ 14 ย้ายมาอยู่บน rule): จัดทีละชุด · แก้ว 1 ใบอยู่ได้ชุดเดียว spec เดียว (spec ทับกันได้) ·
 * spec ที่แก้วว่าง (ณ ต้นชุด) น้อยกว่าหยิบก่อน · เท่ากัน = ลำดับ spec · หยิบแก้วราคา(ที่เหลือ)สูงสุดที่ยังว่าง · spec ใดไม่ครบ = หยุด ·
 * ส่วนลดชุด = max(0, round2(ราคารวม − ราคาเซ็ต)) แบ่งตามสัดส่วนราคาตามลำดับ spec (แก้วสุดท้ายรับเศษ)
 */
function applyBundle(st: CupState, g: GroupRound, pp: PreparedPromo): CupResult | null {
  const r = pp.rule.reward;
  if (r.type !== "bundle") return null;
  const items = r.items ?? [];
  if (!items.length) return null;
  const price = (i: number) => st.rem[i]!;
  const n = st.cups.length;
  const specs = items.map((spec) => {
    const idxs = candidates(st, g, compileTarget(spec.target));
    const ranked = idxs.map((i) => ({ i, p: price(i) })).sort((a, b) => b.p - a.p || a.i - b.i).map((x) => x.i);
    const member = new Uint8Array(n);
    for (const i of ranked) member[i] = 1;
    return { qty: spec.qty ?? 0, ranked, member, free: ranked.length, ptr: 0 };
  });
  const anyQty = specs.some((s) => s.qty > 0);
  const used = new Uint8Array(n);
  const markUsed = (i: number) => {
    used[i] = 1;
    for (const s of specs) if (s.member[i]) s.free--;
  };
  const order: number[] = [];
  const amountsRaw: number[] = [];
  let sets = 0;
  while (anyQty && (r.max_sets == null || sets < r.max_sets)) {
    // ลำดับ spec ตามจำนวนแก้วว่าง ณ ต้นชุด (น้อยก่อน · เท่ากัน = ลำดับ spec)
    const specOrder = specs.map((s, sp) => ({ sp, free: s.free })).sort((a, b) => a.free - b.free || a.sp - b.sp);
    const picks: number[][] = specs.map(() => []);
    let complete = true;
    for (const { sp } of specOrder) {
      const s = specs[sp]!;
      if (s.qty <= 0) continue;
      while (s.ptr < s.ranked.length && used[s.ranked[s.ptr]!]) s.ptr++;
      const got: number[] = [];
      for (let k = s.ptr; k < s.ranked.length && got.length < s.qty; k++) {
        const i = s.ranked[k]!;
        if (!used[i]) got.push(i);
      }
      if (got.length < s.qty) {
        complete = false;
        break;
      }
      // จองทันที (ชุดไม่ครบ = หยุดทั้งโปร จึงไม่ต้องคืน)
      for (const i of got) markUsed(i);
      picks[sp] = got;
    }
    if (!complete) break;
    const setIdxs = picks.flat();
    sets++;
    const setTotal = setIdxs.reduce((sum, i) => sum + price(i), 0);
    const setDiscount = Math.max(0, round2(setTotal - (r.price ?? 0)));
    let allocated = 0;
    setIdxs.forEach((i, k) => {
      let d = 0;
      if (setDiscount > 0 && setTotal > 0) {
        if (k === setIdxs.length - 1) d = round2(setDiscount - allocated);
        else {
          d = round2((price(i) / setTotal) * setDiscount);
          allocated += d;
        }
      }
      order.push(i);
      amountsRaw.push(d);
    });
  }
  if (sets <= 0) return null;
  const amts = finishAmounts(amountsRaw, pp.rule);
  let total = 0;
  order.forEach((i, k) => {
    claim(st, g, i, pp.promo.id, amts[k]!);
    total += amts[k]!;
  });
  return { discountAmount: round2(total), detail: { sets } };
}

function applyCupPromo(st: CupState, g: GroupRound, pp: PreparedPromo): CupResult | null {
  const match = compileTarget(pp.rule.target);
  switch (pp.rule.reward.type) {
    case "buy_get":
      return applyBuyGet(st, g, pp, match);
    case "bundle":
      return applyBundle(st, g, pp);
    case "percent":
    case "amount":
    case "fixed_price":
      return applySimple(st, g, pp, match);
    case "tiered":
      return applyTiered(st, g, pp, match);
    default:
      return null;
  }
}

/** ฿ ในคำเตือน (= SQL ข้อความตัวเลขแบบตัดศูนย์ท้าย เหมือนเหตุ min_subtotal เดิม) */
const bahtNum = (n: number): string => `฿${Number(n)}`;

/** เหตุ "ยังไม่ถึงขั้นแรก" (ADR-0072 ข้อ 1 — = SQL ทุกตัวอักษร) */
function tierMissReason(rule: PromoRule): string | null {
  const r = rule.reward;
  if (r.type !== "tiered" && r.type !== "bill_tiers") return null;
  const min = r.tiers[0]?.min ?? 0;
  if (r.basis === "qty") return `จำนวนแก้วยังไม่ถึงขั้นแรก ${Number(min)} แก้ว`;
  if (r.basis === "subtotal") return `ยอดหลังส่วนลดรายแก้วยังไม่ถึงขั้นแรก ${bahtNum(min)}`;
  return `ยอดแก้วที่เข้าโปรยังไม่ถึงขั้นแรก ${bahtNum(min)}`;
}

/** เป้าหมายรวมของโปร (สำหรับเหตุในคำเตือนโค้ด) — bundle = OR ของทุก spec · buy_get = target หรือ get_target */
function unionMatcher(rule: PromoRule): TargetMatcher {
  const r = rule.reward;
  if (r.type === "bundle") {
    const ms = r.items.map((it) => compileTarget(it.target));
    return (s) => ms.some((m) => m(s));
  }
  const main = compileTarget(rule.target);
  if (r.type === "buy_get" && r.get_target) {
    const gm = compileTarget(r.get_target);
    return (s) => main(s) || gm(s);
  }
  return main;
}

/**
 * เหตุที่โปรรายแก้วไม่ได้ชุด/แก้วเลย (สถานะแก้วก่อนโปรนี้แตะ) — ใช้ในคำเตือนเท่านั้น = SQL
 * ขั้นบันได (ADR-0072): ไม่มีแก้วเข้าเป้า = "ไม่มีเมนู…" · แก้วเข้าเป้าถูกใช้หมดทุกใบ = "ถูกใช้…" · อื่น = "ยังไม่ถึงขั้นแรก"
 */
function noCupReason(st: CupState, g: GroupRound, pp: PreparedPromo): string {
  const match = unionMatcher(pp.rule);
  const matching: number[] = [];
  for (let i = 0; i < st.cups.length; i++) if (match(st.subjects[i]!)) matching.push(i);
  if (matching.length === 0) return "ไม่มีเมนูที่ร่วมโปรในบิล";
  const tierMiss = tierMissReason(pp.rule);
  if (tierMiss != null) {
    if (matching.every((i) => !eligibleIn(st, g, i))) return "แก้วที่ร่วมโปรถูกใช้กับโปรอื่นหรือส่วนลดที่กรอกเองแล้ว";
    return tierMiss;
  }
  if (matching.some((i) => !eligibleIn(st, g, i))) return "แก้วที่ร่วมโปรถูกใช้กับโปรอื่นหรือส่วนลดที่กรอกเองแล้ว";
  return "จำนวนแก้วยังไม่ครบเงื่อนไขโปร";
}

function orderedGroups(groups: readonly PromotionGroup[] | undefined, used: readonly string[]): PromotionGroup[] {
  const map = new Map<string, PromotionGroup>();
  for (const g of groups ?? []) map.set(g.code, g);
  for (const code of used) {
    if (!map.has(code)) map.set(code, { code, name: code, sortOrder: 0, stackMode: "separate" });
  }
  return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

function appliedOf(pp: PreparedPromo, discountAmount: number, detail?: Record<string, unknown>): AppliedPromotion {
  const d: Record<string, unknown> = { ...(detail ?? {}), applyMode: pp.mode };
  if (pp.groupCode !== PROMO_MAIN_GROUP) d.group = pp.groupCode;
  return { promotionId: pp.promo.id, code: pp.promo.code, name: pp.promo.name, kind: pp.template, discountAmount, detail: d };
}

/**
 * ใส่โปรให้แก้ว (ไม่แก้อาเรย์ขาเข้า — คัดลอกทุกแก้วก่อน) ตาม ADR-0071 ข้อ 4
 * groups ไม่ส่ง = กลุ่ม main แบบ separate กลุ่มเดียว (= พฤติกรรมเดิมทุกกรณี)
 */
export function applyPromotions(
  cupsIn: PricedCup[],
  promotions: Promotion[],
  ctx: PromotionContext,
  manualBillDiscount: ManualBillDiscount = {},
  groups?: readonly PromotionGroup[],
): ApplyPromotionsResult {
  const cups: PricedCup[] = cupsIn.map((c) => ({ ...c, promoBreakdown: null }));
  const applied: AppliedPromotion[] = [];
  const warnings: string[] = [];

  // เลือกเองต่อบิล (ADR-0070 ข้อ 3): ตัดตัวซ้ำ · เกิน 20 ตัว = DY422 ที่จริง (ที่นี่ใช้ 20 ตัวแรกแล้วเตือน)
  const dedupedManualIds = Array.from(new Set(ctx.manualPromotionIds ?? []));
  if (dedupedManualIds.length > 20) {
    warnings.push(`เลือกโปรเองเกิน 20 รายการ (${dedupedManualIds.length}) — บันทึกจริงจะถูกปฏิเสธ (DY422)`);
  }
  const cappedManualIds = dedupedManualIds.slice(0, 20);
  const effectiveCtx: PromotionContext = { ...ctx, manualPromotionIds: cappedManualIds };

  const prepared: PreparedPromo[] = [];
  const preparedById = new Map<string, PreparedPromo>();
  for (const p of promotions) {
    const pp = preparePromo(p);
    if (!pp) continue;
    prepared.push(pp);
    if (!preparedById.has(p.id)) preparedById.set(p.id, pp);
  }

  // id ที่ไม่ใช่โหมด manual / ไม่มีในร้าน / ไม่เข้าเงื่อนไข → ไม่ใช้ + คำเตือน (ไม่ปฏิเสธบิล)
  for (const id of cappedManualIds) {
    const promo = promotions.find((p) => p.id === id);
    if (!promo) {
      // ข้อความคงที่ตรงกับ SQL ทุกตัวอักษร (ไม่มีชื่อ/id เพราะไม่พบโปรนั้น)
      warnings.push("ไม่ใช้โปรที่เลือก: ไม่พบโปรนี้ในร้าน");
      continue;
    }
    if (promoApplyMode(promo) !== "manual") {
      warnings.push(`ไม่ใช้โปร ${promo.name}: ไม่ใช่โปรแบบพนักงานกดเลือกเอง`);
      continue;
    }
    const pp = preparedById.get(id);
    if (!pp) warnings.push(`ไม่ใช้โปร ${promo.name}: ไม่เข้าเงื่อนไข`);
    else if (!isConditionsMet(pp, effectiveCtx)) warnings.push(`ไม่ใช้โปร ${promo.name}: ${promoIneligibleReason(pp, effectiveCtx)}`);
  }

  // โปรของโค้ดที่พิมพ์ (ทุกโหมด) · โปรที่ปิดอยู่ = "ไม่พบโค้ดนี้ในร้าน" (= SQL 0070 · ไม่เผยชื่อโปรที่ปิด)
  const typedCode = ctx.promoCode != null ? normPromoCode(ctx.promoCode) : null;
  const codePromoRaw =
    typedCode != null ? promotions.find((p) => p.isActive && p.code != null && normPromoCode(p.code) === typedCode) : undefined;
  const codePP = codePromoRaw ? preparedById.get(codePromoRaw.id) : undefined;
  let codeEvaluated = false;
  let codeEvalReason: string | null = null;
  let codeStopName: string | null = null;
  /** โปรเลือกเองที่ถูกคิดแล้วแต่ไม่ถึงขั้นแรกของขั้นบันได → เหตุ (ADR-0072 ข้อ 1 — เตือนหลังคำเตือนโค้ด ตามลำดับ id ที่เลือก) */
  const manualTierMiss = new Map<string, string>();

  const usable = prepared.filter((pp) => isUsable(pp, effectiveCtx));
  const groupList = orderedGroups(
    groups,
    prepared.map((pp) => pp.groupCode),
  );

  // ── รอบรายแก้ว ──
  const st: CupState = {
    cups,
    subjects: cups.map((c) => ({
      menuCode: c.menuCode,
      categoryLabel: c.categoryLabel ?? null,
      size: c.size,
      sweetness: c.sweetness,
      milk: c.milk,
      grade: c.grade,
    })),
    claims: cups.map(() => []),
    rem: Float64Array.from(cups, remainingOf),
  };
  for (const grp of groupList) {
    const inGroup = usable
      .filter((pp) => pp.groupCode === grp.code && pp.rule.scope === "cup")
      .sort((a, b) => a.promo.priority - b.promo.priority);
    if (inGroup.length === 0) continue;
    const g: GroupRound = { mode: grp.stackMode, claimed: new Uint8Array(cups.length) };
    let stopName: string | null = null;
    for (const pp of inGroup) {
      if (stopName != null) {
        if (pp === codePP) codeStopName = stopName;
        continue;
      }
      const reasonBefore = pp === codePP ? noCupReason(st, g, pp) : null;
      const res = applyCupPromo(st, g, pp);
      if (pp === codePP) {
        codeEvaluated = true;
        if (!res) codeEvalReason = reasonBefore;
        else if (res.discountAmount <= 0) codeEvalReason = "ไม่มีส่วนลดจากบิลนี้";
      }
      if (res) {
        applied.push(appliedOf(pp, res.discountAmount, res.detail));
        if (pp.rule.stop_group === true) stopName = pp.promo.name;
      } else if (pp.mode === "manual" && pp.rule.reward.type === "tiered") {
        manualTierMiss.set(pp.promo.id, noCupReason(st, g, pp));
      }
    }
  }

  // ── รอบทั้งบิล ──
  const itemsSubtotal = cups.reduce((s, c) => s + c.unitPrice, 0);
  const itemsDiscount = cups.reduce((s, c) => s + c.discountPerCup, 0);
  const afterItems = Math.max(0, round2(itemsSubtotal - itemsDiscount));
  const manualPresent = manualBillDiscount.billDiscountBaht != null || manualBillDiscount.billDiscountPercent != null;
  let base = afterItems;
  const billPromotions: AppliedPromotion[] = [];
  let codeBillBase: number | null = null;
  let codeBillWinner: string | null = null;
  let codeBillTierMiss = false;
  for (const grp of groupList) {
    const inGroup = usable
      .filter((pp) => pp.groupCode === grp.code && pp.rule.scope === "bill")
      .sort((a, b) => a.promo.priority - b.promo.priority);
    if (inGroup.length === 0) continue;
    let best: { pp: PreparedPromo; amount: number; detail?: Record<string, unknown> } | null = null;
    for (const pp of inGroup) {
      if (pp === codePP) codeBillBase = base;
      if (manualPresent && (pp.rule.manual_bill ?? "yield") !== "combine") continue;
      const r = pp.rule.reward;
      if (pp.rule.min_subtotal != null && base < pp.rule.min_subtotal) continue;
      let amt = 0;
      let detail: Record<string, unknown> | undefined;
      if (r.type === "bill_tiers") {
        // ขั้นบันไดทั้งบิล (ADR-0072 ข้อ 1): subtotal = ฐานเดียวกับ min_subtotal · qty = แก้วในบิลที่ตรง target ไม่นับส่วนลดกรอกเอง
        let value = base;
        if (r.basis === "qty") {
          const m = compileTarget(pp.rule.target);
          value = 0;
          for (let i = 0; i < cups.length; i++) if (!cups[i]!.manual && m(st.subjects[i]!)) value++;
        }
        const k = reachedTier(r.tiers, value);
        if (k < 0) {
          if (pp === codePP) codeBillTierMiss = true;
          else if (pp.mode === "manual") manualTierMiss.set(pp.promo.id, tierMissReason(pp.rule)!);
          continue;
        }
        const t = r.tiers[k]!;
        amt = "baht" in t ? t.baht : round2(base * (t.percent / 100));
        const tier: PromoTierHit = { index: k, min: t.min, basis: r.basis, value };
        detail = { tier };
      } else {
        amt = r.type === "bill_amount" ? r.baht : r.type === "bill_percent" ? round2(base * (r.percent / 100)) : 0;
      }
      if (pp.rule.rounding === "floor_baht") amt = Math.floor(round2(amt) + 1e-9);
      if (pp.rule.cap_baht != null) amt = Math.min(amt, pp.rule.cap_baht);
      amt = round2(Math.max(0, Math.min(amt, base)));
      if (!best || amt > best.amount) best = detail ? { pp, amount: amt, detail } : { pp, amount: amt };
    }
    if (codePP && inGroup.includes(codePP) && best && best.pp !== codePP) codeBillWinner = best.pp.promo.name;
    if (!best) continue;
    const ap = appliedOf(best.pp, best.amount, best.detail);
    applied.push(ap);
    billPromotions.push(ap);
    base = Math.max(0, round2(base - best.amount));
  }
  let manualAmount = 0;
  if (manualPresent) {
    const raw =
      manualBillDiscount.billDiscountBaht != null
        ? manualBillDiscount.billDiscountBaht
        : round2(base * ((manualBillDiscount.billDiscountPercent ?? 0) / 100));
    manualAmount = round2(Math.max(0, Math.min(raw, base)));
  }
  const billDiscountAmount = round2(billPromotions.reduce((s, p) => s + p.discountAmount, 0) + manualAmount);

  // ── โค้ดที่พิมพ์แต่ไม่ได้ส่วนลด → 1 คำเตือนบอกเหตุ (= SQL ทุกตัวอักษร · ลำดับตัดสินเดียวกัน) ──
  if (typedCode != null) {
    if (!codePromoRaw) {
      warnings.push(`ไม่ใช้โปร ${Array.from(typedCode).slice(0, 30).join("")}: ไม่พบโค้ดนี้ในร้าน`);
    } else if (!applied.some((a) => a.promotionId === codePromoRaw.id && a.discountAmount > 0)) {
      let why: string | null = null;
      if (!codePP) why = "ไม่เข้าเงื่อนไข";
      else if (!isConditionsMet(codePP, effectiveCtx)) why = promoIneligibleReason(codePP, effectiveCtx);
      if (why == null && codePP && !isUsable(codePP, effectiveCtx)) why = "ไม่ใช่โปรแบบใส่โค้ด";
      if (why == null && codePP && codePP.rule.scope === "bill") {
        const minSubtotal = codePP.rule.min_subtotal;
        const baseAt = codeBillBase ?? afterItems;
        if (manualPresent && (codePP.rule.manual_bill ?? "yield") !== "combine") {
          why = "ใช้ส่วนลดทั้งบิลที่กรอกเองแทน";
        } else if (minSubtotal != null && baseAt < minSubtotal) {
          why = `ยอดหลังส่วนลดรายแก้วยังไม่ถึงขั้นต่ำ ฿${Number(minSubtotal)}`;
        } else if (codeBillTierMiss) {
          why = tierMissReason(codePP.rule);
        } else if (codeBillWinner != null) {
          why = `ใช้โปร ${codeBillWinner} แทน (ส่วนลดทั้งบิลใช้ได้ตัวเดียว)`;
        } else {
          why = "ไม่มีส่วนลดจากบิลนี้";
        }
      } else if (why == null) {
        if (codeEvaluated) why = codeEvalReason ?? "ไม่มีส่วนลดจากบิลนี้";
        else if (codeStopName != null) why = `ไม่ซ้อนกับโปร ${codeStopName}`;
        else why = "ไม่มีส่วนลดจากบิลนี้";
      }
      warnings.push(`ไม่ใช้โปร ${codePromoRaw.name}: ${why}`);
    }
  }

  // โปรเลือกเองแบบขั้นบันไดที่ไม่ถึงขั้นแรก (ADR-0072 ข้อ 1) — ตามลำดับ id ที่เลือก (ตัดซ้ำแล้ว) · โปรของโค้ดที่พิมพ์เตือนไปแล้วด้านบน
  for (const id of cappedManualIds) {
    const why = manualTierMiss.get(id);
    if (why == null || id === codePromoRaw?.id) continue;
    warnings.push(`ไม่ใช้โปร ${preparedById.get(id)!.promo.name}: ${why}`);
  }

  // promo_breakdown = รายการที่ส่วนลด > 0 เมื่อมี ≥ 2 รายการ หรือรายการเดียวที่ไม่ใช่ promotionId ของแก้ว
  // (โปรแรกจองแก้วด้วยส่วนลด 0 แล้วกลุ่มซ้อนลดต่อ — ไม่งั้นส่วนลดถูกนับเป็นของโปรแรก · = SQL dayo_promo_engine)
  cups.forEach((c, i) => {
    const pos = st.claims[i]!.filter((e) => e.amount > 0);
    const record = pos.length > 1 || (pos.length === 1 && pos[0]!.promotionId !== c.promotionId);
    c.promoBreakdown = record ? pos.map((e) => ({ promotionId: e.promotionId, amount: e.amount })) : null;
  });

  return { cups, applied, billDiscountAmount, billDiscountPromotion: billPromotions[0] ?? null, billPromotions, warnings };
}
