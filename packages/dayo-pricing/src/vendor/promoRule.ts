// promoRule.ts — กฎโปร (ADR-0071 ข้อ 1–3, 7, 8, 11): ตรวจ · แปลงรูปเดิม ↔ รูปใหม่ · ช่วงเวลา · โปรเสี่ยง
// โค้ดบริสุทธิ์ · ทุกฟังก์ชันมีคู่ใน SQL ที่ต้องได้ผลตรงกัน (เทสต์ parity จากชุดเคสกลาง test/fixtures/promo-rules)
//   validatePromoRule   = dayo_promo_rule_problems(rule)
//   validateTimeWindows = dayo_promo_windows_problems(time_windows)
//   promoTemplateFits   = dayo_promo_template_fits(template, rule)
//   promoFromLegacy     = dayo_promo_from_legacy(kind, params, stackable)
//   promoToLegacy       = dayo_promo_to_legacy(rule, time_windows, group)
//   promoWindowMatch    = dayo_promo_window_match(...)
//   promoNeedsOwner     = dayo_promo_needs_owner(rule, channel_ids, shop)
//   promoRuleMinVersion = dayo_promo_rule_min_version(rule)   (ADR-0072 ข้อ 1)

import { channelPrice } from "./money";
import { addDays, dayOfWeek } from "./time";
import type {
  BillDiscountParams,
  BundleParams,
  BuyNGetMParams,
  ItemDiscountParams,
  PromoBillTier,
  PromoCupTier,
  PromoReward,
  PromoRule,
  PromoTarget,
  PromoTemplate,
  PromotionKind,
  PromotionParams,
  SalesChannelEntry,
  TimeWindow,
} from "./types";

// ── เพดานกันข้อมูลผิดปกติ (ADR-0071 ข้อ 1 — ไม่ใช่ตัวเลขเงิน) ─────────────────
export const PROMO_RULE_MAX_BYTES = 4096;
export const PROMO_TARGET_MAX_ITEMS = 50;
export const PROMO_TIME_WINDOWS_MAX = 14;
export const PROMO_ACTIVE_MAX = 100;
/** กลุ่มโปรต่อร้าน (trigger promotion_groups_cap) */
export const PROMO_GROUPS_MAX = 50;
/** ขนาดข้อความ jsonb ของ time_windows (= SQL octet_length(time_windows::text)) */
export const PROMO_TIME_WINDOWS_MAX_BYTES = 1024;
/** เพดานจำนวนเต็มในรางวัล (กันค่าเกิน integer ฝั่ง SQL) */
export const PROMO_BUY_GET_MAX = 99;
export const PROMO_MAX_SETS_MAX = 999;
export const PROMO_BUNDLE_QTY_MAX = 99;
/** รุ่นกฎที่เครื่องคิดนี้เข้าใจ (E1 supported_fields.promotion_rule_versions · ADR-0072 ข้อ 1) */
export const PROMO_RULE_VERSIONS: readonly number[] = [1, 2];
/** ส่วนลดขั้นบันได (ADR-0072 ข้อ 1): 2–5 ขั้น · นับแก้ว min เป็นจำนวนเต็ม 1–99 */
export const PROMO_TIERS_MIN = 2;
export const PROMO_TIERS_MAX = 5;
export const PROMO_TIER_QTY_MAX = 99;
export const PROMO_MAIN_GROUP = "main";

// ── ตรวจกฎ ────────────────────────────────────────────────────────────────

const RULE_KEYS = ["v", "scope", "target", "reward", "min_subtotal", "cap_baht", "rounding", "stop_group", "manual_bill"] as const;
const TARGET_KEYS = ["menus", "categories", "variants", "sizes", "options", "exclude_menus"] as const;
const VARIANT_KEYS = ["menu", "size", "sweetness"] as const;
const OPTION_KEYS = ["milk", "grade"] as const;
const REWARD_KEYS: Readonly<Record<string, readonly string[]>> = Object.assign(Object.create(null), {
  percent: ["type", "percent", "apply_to"],
  amount: ["type", "baht", "apply_to"],
  fixed_price: ["type", "price", "apply_to"],
  buy_get: ["type", "buy", "get", "get_target", "get_discount", "get_pick", "max_sets"],
  bundle: ["type", "items", "price", "max_sets"],
  bill_percent: ["type", "percent"],
  bill_amount: ["type", "baht"],
  tiered: ["type", "basis", "apply_to", "tiers"],
  bill_tiers: ["type", "basis", "tiers"],
});
const CUP_REWARDS = ["percent", "amount", "fixed_price", "buy_get", "bundle", "tiered"];
const BILL_REWARDS = ["bill_percent", "bill_amount", "bill_tiers"];
/** รางวัลที่ต้องใช้กฎรุ่น 2 (ADR-0072 ข้อ 1) */
const V2_REWARDS = ["tiered", "bill_tiers"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);

function unknownKeys(o: Obj, allowed: readonly string[], path: string, out: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) out.push(`${path}${k}: ไม่รู้จักคีย์นี้`);
}

function checkStringList(v: unknown, path: string, out: string[]): void {
  if (!Array.isArray(v)) {
    out.push(`${path}: ต้องเป็นรายการ`);
    return;
  }
  if (v.length > PROMO_TARGET_MAX_ITEMS) out.push(`${path}: เกิน ${PROMO_TARGET_MAX_ITEMS} รายการ`);
  v.forEach((x, i) => checkText(x, `${path}[${i}]`, out));
}

/** ข้อความไม่ว่าง และไม่มีช่องว่างหัว/ท้าย (รหัสมีช่องว่าง = จับเป้า/คิดค่าตัวเลือกไม่ตรง จึงปฏิเสธ ไม่ตัดให้ — = SQL dayo_trim_ws) */
function checkText(x: unknown, path: string, out: string[]): void {
  if (typeof x !== "string" || x.trim() === "") out.push(`${path}: ต้องเป็นข้อความไม่ว่าง`);
  else if (x !== x.trim()) out.push(`${path}: ห้ามมีช่องว่างหัว/ท้าย`);
}

function checkTarget(t: unknown, path: string, out: string[]): void {
  if (!isObj(t)) {
    out.push(`${path}: ต้องเป็นอ็อบเจกต์`);
    return;
  }
  unknownKeys(t, TARGET_KEYS, `${path}.`, out);
  for (const k of ["menus", "categories", "sizes", "exclude_menus"] as const) {
    if (t[k] !== undefined) checkStringList(t[k], `${path}.${k}`, out);
  }
  if (t.variants !== undefined) {
    const vs = t.variants;
    if (!Array.isArray(vs)) out.push(`${path}.variants: ต้องเป็นรายการ`);
    else {
      if (vs.length > PROMO_TARGET_MAX_ITEMS) out.push(`${path}.variants: เกิน ${PROMO_TARGET_MAX_ITEMS} รายการ`);
      vs.forEach((v, i) => {
        const p = `${path}.variants[${i}]`;
        if (!isObj(v)) {
          out.push(`${p}: ต้องเป็นอ็อบเจกต์`);
          return;
        }
        unknownKeys(v, VARIANT_KEYS, `${p}.`, out);
        checkText(v.menu, `${p}.menu`, out);
        checkText(v.size, `${p}.size`, out);
        if (v.sweetness !== undefined) checkText(v.sweetness, `${p}.sweetness`, out);
      });
    }
  }
  if (t.options !== undefined) {
    const o = t.options;
    if (!isObj(o)) out.push(`${path}.options: ต้องเป็นอ็อบเจกต์`);
    else {
      unknownKeys(o, OPTION_KEYS, `${path}.options.`, out);
      for (const k of OPTION_KEYS) if (o[k] !== undefined) checkStringList(o[k], `${path}.options.${k}`, out);
    }
  }
}

function hasOptionTarget(t: unknown): boolean {
  if (!isObj(t) || !isObj(t.options)) return false;
  const o = t.options;
  return (Array.isArray(o.milk) && o.milk.length > 0) || (Array.isArray(o.grade) && o.grade.length > 0);
}

function checkPercent(v: unknown, path: string, out: string[]): void {
  if (!isNum(v) || v < 1 || v > 100) out.push(`${path}: ต้องเป็นตัวเลข 1–100`);
}
function checkPositive(v: unknown, path: string, out: string[]): void {
  if (!isNum(v) || v <= 0) out.push(`${path}: ต้องเป็นตัวเลขมากกว่า 0`);
}
function checkNonNegative(v: unknown, path: string, out: string[]): void {
  if (!isNum(v) || v < 0) out.push(`${path}: ต้องเป็นตัวเลขตั้งแต่ 0`);
}
function checkMaxSets(v: unknown, path: string, out: string[]): void {
  if (v !== undefined && v !== null && (!isInt(v) || v < 1 || v > PROMO_MAX_SETS_MAX)) {
    out.push(`${path}: ต้องเป็นจำนวนเต็ม 1–${PROMO_MAX_SETS_MAX} หรือ null`);
  }
}

/**
 * ทศนิยมไม่เกิน 2 ตำแหน่ง (= SQL `x = round(x, 2)`) — ดูจากรูปทศนิยมสั้นสุดของ Number (ไม่คูณ 100 ที่เพี้ยนตาม double) ·
 * รูปยกกำลัง: e+ = จำนวนเต็ม · e- = เล็กกว่า 1e-6 จึงเกิน 2 ตำแหน่ง
 */
function atMost2dp(v: number): boolean {
  const s = String(Math.abs(v));
  const e = s.indexOf("e");
  if (e >= 0) return s[e + 1] === "+";
  const dot = s.indexOf(".");
  return dot < 0 || s.length - dot - 1 <= 2;
}

/**
 * ขั้นบันได (ADR-0072 ข้อ 1 "ตรวจ"): 2–5 ขั้น · แต่ละขั้น = min + คีย์รางวัล 1 ตัว · คีย์เดียวกันทุกขั้น ·
 * min เพิ่มขึ้นเคร่งครัด (basis=qty = จำนวนเต็ม 1–99 · อื่น > 0 ทศนิยม ≤ 2 ตำแหน่ง) · ขั้นสูงลดไม่น้อยกว่าขั้นต่ำ (percent/baht ไม่ลดลง · fixed_price ไม่เพิ่มขึ้น)
 * ตรวจข้ามขั้น (เรียง/คีย์เดียวกัน/ไม่ลดลง) เฉพาะเมื่อทุกขั้นรูปถูก — ไม่งั้นมีแต่ปัญหารายขั้น
 */
function checkTiers(r: Obj, valueKeys: readonly string[], out: string[]): void {
  const tiers = r.tiers;
  const countMsg = `reward.tiers: ต้องเป็นรายการ ${PROMO_TIERS_MIN}–${PROMO_TIERS_MAX} ขั้น`;
  if (!Array.isArray(tiers)) {
    out.push(countMsg);
    return;
  }
  if (tiers.length < PROMO_TIERS_MIN || tiers.length > PROMO_TIERS_MAX) out.push(countMsg);
  const byQty = r.basis === "qty";
  const mins: number[] = [];
  const keys: string[] = [];
  const values: number[] = [];
  let allOk = true;
  tiers.forEach((t, i) => {
    const p = `reward.tiers[${i}]`;
    if (!isObj(t)) {
      out.push(`${p}: ต้องเป็นอ็อบเจกต์`);
      allOk = false;
      return;
    }
    unknownKeys(t, ["min", ...valueKeys], `${p}.`, out);
    if (byQty) {
      if (!isInt(t.min) || t.min < 1 || t.min > PROMO_TIER_QTY_MAX) {
        out.push(`${p}.min: ต้องเป็นจำนวนเต็ม 1–${PROMO_TIER_QTY_MAX}`);
        allOk = false;
      }
    } else if (!isNum(t.min) || t.min <= 0) {
      out.push(`${p}.min: ต้องเป็นตัวเลขมากกว่า 0`);
      allOk = false;
    } else if (!atMost2dp(t.min)) {
      // ยอดเงิน: ทศนิยม ≤ 2 ตำแหน่ง (เหตุ "ยังไม่ถึงขั้นแรก ฿…" ของ shared/SQL จึงพิมพ์ตัวเลขตรงกันเสมอ)
      out.push(`${p}.min: ทศนิยมได้ไม่เกิน 2 ตำแหน่ง`);
      allOk = false;
    }
    const known = valueKeys.filter((k) => t[k] !== undefined);
    if (known.length !== 1) {
      out.push(`${p}: ต้องมี ${valueKeys.join(" หรือ ")} อย่างเดียว`);
      allOk = false;
      return;
    }
    const k = known[0]!;
    const v = t[k];
    const before = out.length;
    if (k === "percent") checkPercent(v, `${p}.percent`, out);
    else if (k === "baht") checkPositive(v, `${p}.baht`, out);
    else checkNonNegative(v, `${p}.fixed_price`, out);
    if (out.length > before) allOk = false;
    mins.push(t.min as number);
    keys.push(k);
    values.push(v as number);
  });
  if (!allOk || tiers.length === 0) return;
  if (mins.some((m, i) => i > 0 && !(m > mins[i - 1]!))) out.push("reward.tiers: min ต้องเพิ่มขึ้นทีละขั้น");
  if (keys.some((k) => k !== keys[0])) {
    out.push("reward.tiers: ทุกขั้นต้องใช้คีย์รางวัลเดียวกัน");
    return;
  }
  const up = keys[0] !== "fixed_price";
  if (values.some((v, i) => i > 0 && (up ? v < values[i - 1]! : v > values[i - 1]!))) out.push("reward.tiers: ขั้นสูงต้องลดไม่น้อยกว่าขั้นต่ำ");
}

function checkReward(r: unknown, scope: unknown, target: unknown, out: string[]): void {
  if (!isObj(r)) {
    out.push("reward: ต้องเป็นอ็อบเจกต์");
    return;
  }
  const type = r.type;
  if (typeof type !== "string" || !REWARD_KEYS[type]) {
    out.push("reward.type: ไม่รู้จักชนิดรางวัล");
    return;
  }
  unknownKeys(r, REWARD_KEYS[type]!, "reward.", out);
  if (scope === "cup" && !CUP_REWARDS.includes(type)) out.push("reward.type: ใช้กับ scope=cup ไม่ได้");
  if (scope === "bill" && !BILL_REWARDS.includes(type)) out.push("reward.type: ใช้กับ scope=bill ไม่ได้");
  if (type === "percent" || type === "amount" || type === "fixed_price") {
    if (type === "percent") checkPercent(r.percent, "reward.percent", out);
    if (type === "amount") checkPositive(r.baht, "reward.baht", out);
    if (type === "fixed_price") checkNonNegative(r.price, "reward.price", out);
    if (r.apply_to !== undefined && r.apply_to !== "cup" && r.apply_to !== "option") out.push("reward.apply_to: ต้องเป็น cup หรือ option");
    if (r.apply_to === "option" && !hasOptionTarget(target)) out.push("reward.apply_to: option ต้องระบุ target.options");
  } else if (type === "buy_get") {
    if (!isInt(r.buy) || r.buy < 0 || r.buy > PROMO_BUY_GET_MAX) out.push(`reward.buy: ต้องเป็นจำนวนเต็ม 0–${PROMO_BUY_GET_MAX}`);
    if (!isInt(r.get) || r.get < 1 || r.get > PROMO_BUY_GET_MAX) out.push(`reward.get: ต้องเป็นจำนวนเต็ม 1–${PROMO_BUY_GET_MAX}`);
    if (r.get_target !== undefined && r.get_target !== null) checkTarget(r.get_target, "reward.get_target", out);
    const gd = r.get_discount;
    if (!isObj(gd)) out.push("reward.get_discount: ต้องเป็นอ็อบเจกต์");
    else {
      const keys = Object.keys(gd);
      unknownKeys(gd, ["percent", "baht", "fixed_price"], "reward.get_discount.", out);
      const known = keys.filter((k) => k === "percent" || k === "baht" || k === "fixed_price");
      if (known.length !== 1) out.push("reward.get_discount: ต้องมี percent หรือ baht หรือ fixed_price อย่างเดียว");
      if (gd.percent !== undefined) checkPercent(gd.percent, "reward.get_discount.percent", out);
      if (gd.baht !== undefined) checkPositive(gd.baht, "reward.get_discount.baht", out);
      if (gd.fixed_price !== undefined) checkNonNegative(gd.fixed_price, "reward.get_discount.fixed_price", out);
    }
    if (r.get_pick !== undefined && r.get_pick !== "cheapest" && r.get_pick !== "most_expensive") {
      out.push("reward.get_pick: ต้องเป็น cheapest หรือ most_expensive");
    }
    checkMaxSets(r.max_sets, "reward.max_sets", out);
  } else if (type === "bundle") {
    const items = r.items;
    if (!Array.isArray(items) || items.length === 0) out.push("reward.items: ต้องเป็นรายการอย่างน้อย 1 ชิ้น");
    else {
      if (items.length > PROMO_TARGET_MAX_ITEMS) out.push(`reward.items: เกิน ${PROMO_TARGET_MAX_ITEMS} รายการ`);
      items.forEach((it, i) => {
        const p = `reward.items[${i}]`;
        if (!isObj(it)) {
          out.push(`${p}: ต้องเป็นอ็อบเจกต์`);
          return;
        }
        unknownKeys(it, ["target", "qty"], `${p}.`, out);
        checkTarget(it.target, `${p}.target`, out);
        if (!isInt(it.qty) || it.qty < 1 || it.qty > PROMO_BUNDLE_QTY_MAX) out.push(`${p}.qty: ต้องเป็นจำนวนเต็ม 1–${PROMO_BUNDLE_QTY_MAX}`);
      });
    }
    checkNonNegative(r.price, "reward.price", out);
    checkMaxSets(r.max_sets, "reward.max_sets", out);
  } else if (type === "bill_percent") {
    checkPercent(r.percent, "reward.percent", out);
  } else if (type === "bill_amount") {
    checkPositive(r.baht, "reward.baht", out);
  } else if (type === "tiered") {
    if (r.basis !== "qty" && r.basis !== "amount") out.push("reward.basis: ต้องเป็น qty หรือ amount");
    if (r.apply_to !== undefined && r.apply_to !== "cup" && r.apply_to !== "option") out.push("reward.apply_to: ต้องเป็น cup หรือ option");
    if (r.apply_to === "option" && !hasOptionTarget(target)) out.push("reward.apply_to: option ต้องระบุ target.options");
    checkTiers(r, ["percent", "baht", "fixed_price"], out);
  } else if (type === "bill_tiers") {
    if (r.basis !== "subtotal" && r.basis !== "qty") out.push("reward.basis: ต้องเป็น subtotal หรือ qty");
    checkTiers(r, ["percent", "baht"], out);
  }
}

/**
 * รุ่นขั้นต่ำที่กฎใช้ (ADR-0072 ข้อ 1 · = SQL dayo_promo_rule_min_version) — รางวัล tiered/bill_tiers = 2 · อื่น = 1
 * (target บนโปรทั้งบิลใช้ได้เฉพาะคู่กับ bill_tiers จึงนับผ่านชนิดรางวัลแล้ว · กฎรุ่น 1 ที่ใส่ target บน scope=bill = รุ่น 1 ที่ผิด ·
 * กฎรูปผิด/ไม่มีรางวัล = 1)
 */
export function promoRuleMinVersion(rule: unknown): 1 | 2 {
  if (!isObj(rule) || !isObj(rule.reward)) return 1;
  const type = rule.reward.type;
  return typeof type === "string" && V2_REWARDS.includes(type) ? 2 : 1;
}

/**
 * ปัญหาของกฎ (ข้อความไทย) — ว่าง = ใช้ได้ · เรียงตาม code unit + ตัดซ้ำ (= SQL `order by … collate "C"`)
 * ไม่ตรวจขนาด 4 KB (ขึ้นกับรูปข้อความ jsonb — SQL ตรวจเอง) และไม่ตรวจว่ารหัสมีในร้าน (promotions_guard)
 */
export function validatePromoRule(rule: unknown): string[] {
  const out: string[] = [];
  if (!isObj(rule)) return ["rule: ต้องเป็นอ็อบเจกต์"];
  unknownKeys(rule, RULE_KEYS, "", out);
  // v ต้องเท่ารุ่นขั้นต่ำที่กฎใช้พอดี (ADR-0072 D7 — กันกฎรุ่น 1 ถูกซ่อนจากแท็บเล็ตเก่าโดยไม่จำเป็น)
  const minV = promoRuleMinVersion(rule);
  if (rule.v !== minV) out.push(`v: ต้องเป็น ${minV}`);
  const scope = rule.scope;
  if (scope !== "cup" && scope !== "bill") out.push("scope: ต้องเป็น cup หรือ bill");
  const billTiers = isObj(rule.reward) && rule.reward.type === "bill_tiers";
  if (rule.target !== undefined) {
    if (scope === "bill" && !billTiers) out.push("target: ใช้กับ scope=bill ไม่ได้");
    else if (scope === "bill" && (rule.reward as Obj).basis !== "qty") out.push("target: ใช้กับ scope=bill ได้เฉพาะ reward.basis=qty");
    else checkTarget(rule.target, "target", out);
  }
  if (rule.reward === undefined) out.push("reward: ต้องมี");
  else checkReward(rule.reward, scope, rule.target, out);
  if (rule.min_subtotal !== undefined && rule.min_subtotal !== null) {
    if (scope !== "bill") out.push("min_subtotal: ใช้ได้เฉพาะ scope=bill");
    else if (billTiers) out.push("min_subtotal: ใช้คู่กับขั้นบันไดไม่ได้ (ขั้นแรกทำหน้าที่แทน)");
    else checkNonNegative(rule.min_subtotal, "min_subtotal", out);
  }
  if (rule.cap_baht !== undefined && rule.cap_baht !== null) checkPositive(rule.cap_baht, "cap_baht", out);
  if (rule.rounding !== undefined && rule.rounding !== "round2" && rule.rounding !== "floor_baht") {
    out.push("rounding: ต้องเป็น round2 หรือ floor_baht");
  }
  if (rule.stop_group !== undefined && typeof rule.stop_group !== "boolean") out.push("stop_group: ต้องเป็น true หรือ false");
  if (rule.manual_bill !== undefined) {
    if (scope !== "bill") out.push("manual_bill: ใช้ได้เฉพาะ scope=bill");
    else if (rule.manual_bill !== "yield" && rule.manual_bill !== "combine") out.push("manual_bill: ต้องเป็น yield หรือ combine");
  }
  return Array.from(new Set(out)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * แม่แบบตรงกับกฎไหม (= SQL dayo_promo_template_fits · ADR-0071 ข้อ 10) — ไม่ตรง = ถือเป็นกฎขั้นสูง (owner เท่านั้น)
 * ตรง = scope + ชนิดรางวัลเป็นของแม่แบบนั้น (ชุดเดียวกับคอลัมน์เทมเพลต Excel): buy_n_get_m / buy_a_get_b / nth_cup = cup + buy_get ·
 * item_discount / fixed_price = cup + percent/amount/fixed_price · bundle = cup + bundle · bill_discount = bill + bill_percent/bill_amount ·
 * tiered_item = cup + tiered · tiered_bill = bill + bill_tiers (ADR-0072) · custom / แม่แบบไม่รู้จัก / กฎรูปผิด = ไม่ตรง
 */
export function promoTemplateFits(template: unknown, rule: unknown): boolean {
  if (!isObj(rule) || !isObj(rule.reward)) return false;
  const scope = rule.scope;
  const type = rule.reward.type;
  switch (template) {
    case "buy_n_get_m":
    case "buy_a_get_b":
    case "nth_cup":
      return scope === "cup" && type === "buy_get";
    case "item_discount":
    case "fixed_price":
      return scope === "cup" && (type === "percent" || type === "amount" || type === "fixed_price");
    case "bundle":
      return scope === "cup" && type === "bundle";
    case "bill_discount":
      return scope === "bill" && (type === "bill_percent" || type === "bill_amount");
    case "tiered_item":
      return scope === "cup" && type === "tiered";
    case "tiered_bill":
      return scope === "bill" && type === "bill_tiers";
    default:
      return false;
  }
}

// ── ช่วงเวลา ──────────────────────────────────────────────────────────────

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * ความยาวไบต์ (UTF-8) ของข้อความ jsonb ที่ Postgres แสดง (`value::text`) — คั่นด้วย ", " และ ": " ·
 * ลำดับคีย์ไม่มีผลกับความยาว · ตัวเลขใช้รูป JS (ต่างจาก numeric เฉพาะรูปแปลก เช่น 1.0 / 1e21)
 */
export function jsonbTextBytes(v: unknown): number {
  return new TextEncoder().encode(jsonbText(v)).length;
}
function jsonbText(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : jsonbText(x))).join(", ")}]`;
  if (isObj(v)) {
    return `{${Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${JSON.stringify(k)}: ${jsonbText(x)}`)
      .join(", ")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** ปัญหาของ time_windows (ข้อความไทย · เรียง/ตัดซ้ำแบบเดียวกับ validatePromoRule) · ยาวเกิน 1 KB = ปัญหาเดียว (ไม่ตรวจต่อ) */
export function validateTimeWindows(windows: unknown): string[] {
  const out: string[] = [];
  if (jsonbTextBytes(windows) > PROMO_TIME_WINDOWS_MAX_BYTES) return ["time_windows: ยาวเกิน 1 KB"];
  if (!Array.isArray(windows)) return ["time_windows: ต้องเป็นรายการ"];
  if (windows.length > PROMO_TIME_WINDOWS_MAX) out.push(`time_windows: เกิน ${PROMO_TIME_WINDOWS_MAX} ช่วง`);
  windows.forEach((w, i) => {
    const p = `time_windows[${i}]`;
    if (!isObj(w)) {
      out.push(`${p}: ต้องเป็นอ็อบเจกต์`);
      return;
    }
    unknownKeys(w, ["days", "from", "to"], `${p}.`, out);
    if (!Array.isArray(w.days) || w.days.some((d) => !isInt(d) || d < 0 || d > 6)) out.push(`${p}.days: ต้องเป็นรายการเลข 0–6`);
    else if (new Set(w.days).size !== w.days.length) out.push(`${p}.days: ห้ามมีวันซ้ำ`);
    const from = w.from ?? null;
    const to = w.to ?? null;
    if (from !== null && (typeof from !== "string" || !HHMM.test(from))) out.push(`${p}.from: ต้องเป็นเวลา HH:MM หรือ null`);
    if (to !== null && (typeof to !== "string" || !HHMM.test(to))) out.push(`${p}.to: ต้องเป็นเวลา HH:MM หรือ null`);
    if ((from === null) !== (to === null)) out.push(`${p}: ต้องมีเวลาเริ่มและสิ้นสุดทั้งคู่ หรือไม่มีทั้งคู่`);
    else if (from !== null && from === to) out.push(`${p}: เวลาเริ่มต้องไม่เท่ากับเวลาสิ้นสุด`);
  });
  return Array.from(new Set(out)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const hhmm = (t: string): string => t.slice(0, 5);

export interface WindowDateBounds {
  startsOn?: string | null;
  endsOn?: string | null;
}

function dateInRange(day: string, b: WindowDateBounds): boolean {
  if (b.startsOn && day < b.startsOn.slice(0, 10)) return false;
  if (b.endsOn && day > b.endsOn.slice(0, 10)) return false;
  return true;
}

/**
 * วันขาย+เวลาขาย เข้าช่วงเวลาโปรไหม (ADR-0071 ข้อ 3 · = SQL dayo_promo_window_match)
 * - `[]` = ทุกวันทุกเวลา (ตรวจแค่ช่วงวันที่กับวันขาย)
 * - ช่วงทั้งวัน: วันขาย ∈ days (ว่าง = ทุกวัน) · ไม่ต้องรู้เวลา
 * - `from < to`: วันขาย ∈ days และ from ≤ เวลา ≤ to (รวมนาที to) · ไม่รู้เวลา = ไม่ผ่าน (fail closed)
 * - `from > to` (ข้ามเที่ยงคืน — ของวันเริ่ม): (วันขาย ∈ days และ เวลา ≥ from) หรือ (วันก่อน ∈ days และ เวลา ≤ to)
 * - starts_on/ends_on ตรวจกับ "วันเริ่มของช่วง" (สาขาหลังเที่ยงคืนใช้วันก่อนวันขาย)
 * เวลาใช้ 5 ตัวแรก (HH:MM) ทั้งสองฝั่ง
 */
export function promoWindowMatch(
  windows: readonly TimeWindow[],
  saleDate: string,
  saleTime: string | null | undefined,
  bounds: WindowDateBounds = {},
): boolean {
  if (windows.length === 0) return dateInRange(saleDate, bounds);
  const t = saleTime ? hhmm(saleTime) : null;
  const dow = dayOfWeek(saleDate);
  let prevDay: string | null = null;
  for (const w of windows) {
    const days = w.days ?? [];
    const dayOk = (d: number) => days.length === 0 || days.includes(d);
    const from = w.from ? hhmm(w.from) : null;
    const to = w.to ? hhmm(w.to) : null;
    if (from === null || to === null) {
      if (dayOk(dow) && dateInRange(saleDate, bounds)) return true;
      continue;
    }
    if (t === null) continue;
    if (from < to) {
      if (dayOk(dow) && t >= from && t <= to && dateInRange(saleDate, bounds)) return true;
      continue;
    }
    // ข้ามเที่ยงคืน
    if (dayOk(dow) && t >= from && dateInRange(saleDate, bounds)) return true;
    if (t <= to) {
      prevDay ??= addDays(saleDate, -1);
      if (dayOk(dayOfWeek(prevDay)) && dateInRange(prevDay, bounds)) return true;
    }
  }
  return false;
}

/** มีช่วงที่ต้องรู้เวลาขายไหม (ใช้บอกเหตุ "ไม่รู้เวลาขาย") */
export function windowsNeedTime(windows: readonly TimeWindow[]): boolean {
  return windows.some((w) => w.from != null || w.to != null);
}

/** รูปเดิม (days_of_week + time_from/time_to) → time_windows · ไม่มีทั้งหมด = [] · มีข้างเดียว = เติม 00:00/23:59 (ADR-0070 ข้อ 8) */
export function windowsFromLegacy(
  daysOfWeek: readonly number[] | null | undefined,
  timeFrom: string | null | undefined,
  timeTo: string | null | undefined,
): TimeWindow[] {
  const days = daysOfWeek && daysOfWeek.length > 0 ? [...daysOfWeek] : [];
  const from = timeFrom ? hhmm(timeFrom) : null;
  const to = timeTo ? hhmm(timeTo) : null;
  if (days.length === 0 && from === null && to === null) return [];
  if (from === null && to === null) return [{ days, from: null, to: null }];
  return [{ days, from: from ?? "00:00", to: to ?? "23:59" }];
}

// ── รูปเดิม ↔ รูปใหม่ ───────────────────────────────────────────────────────

export interface LegacyPromoShape {
  kind: PromotionKind;
  params: PromotionParams;
  stackable: boolean;
}

export interface LegacyPromoFull extends LegacyPromoShape {
  daysOfWeek: number[] | null;
  timeFrom: string | null;
  timeTo: string | null;
}

const menusTarget = (codes: readonly string[] | undefined): PromoTarget => (codes && codes.length > 0 ? { menus: [...codes] } : {});

/**
 * รูปเดิม → กฎ (ADR-0071 ข้อ 11 · = SQL dayo_promo_from_legacy) — รูปผลลัพธ์ตายตัว (คีย์ค่าตั้งต้นไม่ใส่):
 * - buy_n_get_m → cup · buy_get {buy, get, get_target:null, get_discount:{percent:100}, get_pick:"cheapest", max_sets}
 * - item_discount → cup · amount (มี amount_baht) หรือ percent
 * - bill_discount → bill · bill_amount/bill_percent + min_subtotal (มี) + cap_baht (= max_amount มี)
 * - bundle → cup · bundle {items:[{target, qty}], price, max_sets}
 * - menu_codes → target.menus (ว่าง = {}) · stop_group = not stackable (ทุก scope — ให้แปลงกลับได้ตรงตัว)
 */
export function promoFromLegacy(kind: PromotionKind, params: PromotionParams | null | undefined, stackable: boolean | null | undefined): {
  template: PromoTemplate;
  rule: PromoRule;
} {
  const stop_group = stackable === false;
  const p = (params ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));
  if (kind === "buy_n_get_m") {
    const bp = p as unknown as BuyNGetMParams;
    const maxSets = num(bp.max_sets);
    return {
      template: kind,
      rule: {
        v: 1,
        scope: "cup",
        target: menusTarget(bp.menu_codes),
        reward: {
          type: "buy_get",
          buy: num(bp.buy_qty) ?? 0,
          get: num(bp.get_qty) ?? 0,
          get_target: null,
          get_discount: { percent: 100 },
          get_pick: "cheapest",
          max_sets: maxSets ?? null,
        },
        stop_group,
      },
    };
  }
  if (kind === "item_discount") {
    const ip = p as unknown as ItemDiscountParams;
    const baht = num(ip.amount_baht);
    const reward: PromoReward = baht !== undefined ? { type: "amount", baht } : { type: "percent", percent: num(ip.percent) ?? 0 };
    return { template: kind, rule: { v: 1, scope: "cup", target: menusTarget(ip.menu_codes), reward, stop_group } };
  }
  if (kind === "bill_discount") {
    const bp = p as unknown as BillDiscountParams;
    const baht = num(bp.amount_baht);
    const reward: PromoReward = baht !== undefined ? { type: "bill_amount", baht } : { type: "bill_percent", percent: num(bp.percent) ?? 0 };
    const rule: PromoRule = { v: 1, scope: "bill", reward, stop_group };
    const min = num(bp.min_subtotal);
    const cap = num(bp.max_amount);
    if (min !== undefined) rule.min_subtotal = min;
    if (cap !== undefined) rule.cap_baht = cap;
    return { template: kind, rule };
  }
  const bp = p as unknown as BundleParams;
  const maxSets = num(bp.max_sets);
  return {
    template: "bundle",
    rule: {
      v: 1,
      scope: "cup",
      reward: {
        type: "bundle",
        items: (bp.items ?? []).map((it) => ({ target: menusTarget(it.menu_codes), qty: num(it.qty) ?? 0 })),
        price: num(bp.bundle_price) ?? 0,
        max_sets: maxSets ?? null,
      },
      stop_group,
    },
  };
}

/** เป้าหมายที่มีแค่ menus (หรือว่าง) → รายชื่อเมนู · อื่น = null (แปลงเป็นรูปเดิมไม่ได้) */
function targetMenusOnly(t: PromoTarget | null | undefined): string[] | null {
  if (t == null) return [];
  for (const k of Object.keys(t)) {
    if (k !== "menus") {
      const v = (t as Record<string, unknown>)[k];
      // ช่องว่าง = ไม่กรอง → ยังนับว่า "มีแค่ menus"
      if (Array.isArray(v) && v.length === 0) continue;
      if (k === "options" && isObj(v) && Object.values(v).every((x) => Array.isArray(x) && x.length === 0)) continue;
      return null;
    }
  }
  return [...(t.menus ?? [])];
}

/**
 * กฎ → รูปเดิม (ADR-0071 ข้อ 7 "แปลงได้" · = SQL dayo_promo_to_legacy) — null เมื่อแปลงไม่ได้:
 * แม่แบบเดิม 4 ชนิด · เป้าหมายมีแค่ menus · buy_get แถม 100% cheapest กลุ่มเดียวกัน · รายแก้วไม่มี cap_baht ·
 * rounding=round2 · manual_bill=yield · ช่วงเวลา ≤ 1 ช่วงไม่ข้ามคืน · อยู่กลุ่ม main
 */
export function promoToLegacy(
  template: PromoTemplate | null | undefined,
  rule: PromoRule,
  timeWindows: readonly TimeWindow[] | null | undefined,
  groupCode: string | null | undefined,
): LegacyPromoFull | null {
  if ((groupCode ?? PROMO_MAIN_GROUP) !== PROMO_MAIN_GROUP) return null;
  if (rule.v !== 1) return null;
  // ขั้นบันได (รุ่น 2) แปลงเป็นรูปเดิมไม่ได้เสมอ (ADR-0072 ข้อ 1)
  if (promoRuleMinVersion(rule) !== 1) return null;
  if ((rule.rounding ?? "round2") !== "round2") return null;
  if ((rule.manual_bill ?? "yield") !== "yield") return null;
  const windows = timeWindows ?? [];
  if (windows.length > 1) return null;
  let daysOfWeek: number[] | null = null;
  let timeFrom: string | null = null;
  let timeTo: string | null = null;
  if (windows.length === 1) {
    const w = windows[0]!;
    if ((w.from == null) !== (w.to == null)) return null;
    if (w.from != null && w.to != null && !(hhmm(w.from) < hhmm(w.to))) return null;
    daysOfWeek = w.days && w.days.length > 0 ? [...w.days] : null;
    timeFrom = w.from != null ? hhmm(w.from) : null;
    timeTo = w.to != null ? hhmm(w.to) : null;
  }
  const stackable = rule.stop_group !== true;
  const r = rule.reward;
  const base = { stackable, daysOfWeek, timeFrom, timeTo };
  if (rule.scope === "cup") {
    if (rule.cap_baht != null) return null;
    if (rule.min_subtotal != null) return null;
    const menus = targetMenusOnly(rule.target);
    if (template === "buy_n_get_m" && r.type === "buy_get") {
      if (menus === null || r.get_target != null) return null;
      if ((r.get_pick ?? "cheapest") !== "cheapest") return null;
      if (!("percent" in r.get_discount) || r.get_discount.percent !== 100) return null;
      const params: BuyNGetMParams = { buy_qty: r.buy, get_qty: r.get, menu_codes: menus };
      if (r.max_sets != null) params.max_sets = r.max_sets;
      return { kind: "buy_n_get_m", params, ...base };
    }
    if (template === "item_discount" && (r.type === "percent" || r.type === "amount")) {
      if (menus === null || (r.apply_to ?? "cup") !== "cup") return null;
      const params: ItemDiscountParams = r.type === "amount" ? { menu_codes: menus, amount_baht: r.baht } : { menu_codes: menus, percent: r.percent };
      return { kind: "item_discount", params, ...base };
    }
    if (template === "bundle" && r.type === "bundle") {
      if (rule.target && targetMenusOnly(rule.target)?.length !== 0) return null;
      const items: BundleParams["items"] = [];
      for (const it of r.items) {
        const m = targetMenusOnly(it.target);
        if (m === null) return null;
        items.push({ menu_codes: m, qty: it.qty });
      }
      const params: BundleParams = { items, bundle_price: r.price };
      if (r.max_sets != null) params.max_sets = r.max_sets;
      return { kind: "bundle", params, ...base };
    }
    return null;
  }
  if (template === "bill_discount" && (r.type === "bill_percent" || r.type === "bill_amount")) {
    const params: BillDiscountParams = {};
    if (rule.min_subtotal != null) params.min_subtotal = rule.min_subtotal;
    if (r.type === "bill_amount") params.amount_baht = r.baht;
    else params.percent = r.percent;
    if (rule.cap_baht != null) params.max_amount = rule.cap_baht;
    return { kind: "bill_discount", params, ...base };
  }
  return null;
}

// ── การจับเป้าหมาย ────────────────────────────────────────────────────────

/** ข้อมูลแก้ว/ตัวแปรที่ใช้จับเป้าหมาย */
export interface TargetSubject {
  menuCode: string;
  categoryLabel?: string | null;
  size: string;
  sweetness: string;
  milk?: string | null;
  grade?: string | null;
}

/** ตัวจับเป้าหมายที่คอมไพล์แล้ว (ใช้ซ้ำหลายแก้ว — เร็วพอสำหรับ 500 แก้ว × 30 โปร) */
export type TargetMatcher = (s: TargetSubject, ignoreOptions?: boolean) => boolean;

const trimSet = (xs: readonly string[] | undefined): Set<string> | null =>
  xs && xs.length > 0 ? new Set(xs.map((x) => x.trim())) : null;

/** คอมไพล์เป้าหมาย (ADR-0071 ข้อ 2 "การจับเป้าหมาย") · null/{} = ทุกแก้ว */
export function compileTarget(t: PromoTarget | null | undefined): TargetMatcher {
  if (!t) return () => true;
  const menus = trimSet(t.menus);
  const cats = trimSet(t.categories);
  const variants = t.variants && t.variants.length > 0 ? t.variants : null;
  const sizes = trimSet(t.sizes);
  const milk = trimSet(t.options?.milk);
  const grade = trimSet(t.options?.grade);
  const exclude = trimSet(t.exclude_menus);
  const anyOf = menus || cats || variants;
  return (s, ignoreOptions = false) => {
    if (exclude && exclude.has(s.menuCode)) return false;
    if (sizes && !sizes.has(s.size)) return false;
    if (anyOf) {
      let hit = false;
      if (menus && menus.has(s.menuCode)) hit = true;
      else if (cats && s.categoryLabel != null && cats.has(s.categoryLabel.trim())) hit = true;
      else if (variants) {
        hit = variants.some((v) => v.menu.trim() === s.menuCode && v.size.trim() === s.size && (v.sweetness == null || v.sweetness === s.sweetness));
      }
      if (!hit) return false;
    }
    if (!ignoreOptions) {
      if (milk && (s.milk == null || !milk.has(s.milk))) return false;
      if (grade && (s.grade == null || !grade.has(s.grade))) return false;
    }
    return true;
  };
}

// ── โปรเสี่ยง (ADR-0071 ข้อ 8) ─────────────────────────────────────────────

export interface NeedsOwnerContext {
  /** ตัวแปรเมนู active (ไม่นับตัวเลือก) */
  variants: ReadonlyArray<{ menuCode: string; categoryLabel: string | null; size: string; sweetness: string; price: number }>;
  /** ช่องทาง active ของร้าน */
  channels: ReadonlyArray<Pick<SalesChannelEntry, "code" | "priceMarkupPct" | "priceAddBaht" | "rounding">>;
  /** ช่องทางของโปร — ว่าง/null = ทุกช่องทาง active */
  channelCodes: readonly string[] | null | undefined;
}

/** P_min = ราคาช่องทางต่ำสุดของตัวแปรที่เข้าเป้า × ช่องทางของโปร · ไม่มีตัวแปรเข้าเป้า = null */
export function promoMinTargetPrice(target: PromoTarget | null | undefined, ctx: NeedsOwnerContext): number | null {
  const match = compileTarget(target);
  const chans =
    ctx.channelCodes && ctx.channelCodes.length > 0 ? ctx.channels.filter((c) => ctx.channelCodes!.includes(c.code)) : ctx.channels;
  let min: number | null = null;
  for (const v of ctx.variants) {
    if (!match({ menuCode: v.menuCode, categoryLabel: v.categoryLabel, size: v.size, sweetness: v.sweetness }, true)) continue;
    for (const ch of chans) {
      const p = channelPrice(v.price, ch);
      if (min === null || p < min) min = p;
    }
  }
  return min;
}

/**
 * โปรเสี่ยง = ต้อง owner เปิดใช้ (= SQL dayo_promo_needs_owner) — จริงเมื่อมีรางวัลใดที่:
 * ลดทั้งแก้ว percent=100 · fixed_price=0 · bundle.price=0 · แถม get_discount.percent=100 หรือ fixed_price=0 ·
 * ลดเป็นบาท (amount.baht หรือ get_discount.baht) ≥ P_min (ไม่มีตัวแปรเข้าเป้า = เสี่ยง) · bill_percent=100 ·
 * bill_amount ที่ไม่มี min_subtotal หรือบาท ≥ min_subtotal · รางวัล apply_to=option ไม่นับ
 * ขั้นบันได (ADR-0072 ข้อ 1): ตรวจ **ทุกขั้น** เหมือนรางวัลแบบเรียบ — ขั้นใดเสี่ยง = เสี่ยง · tiered ใช้ apply_to/target ของกฎ ·
 * bill_tiers basis=subtotal ใช้ min ของขั้นแทน min_subtotal · basis=qty ไม่มียอดขั้นต่ำ → ขั้นที่ลดเป็นบาทเสี่ยงเสมอ
 */
export function promoNeedsOwner(rule: PromoRule, ctx: NeedsOwnerContext): boolean {
  const r = rule.reward;
  const bahtRisky = (baht: number, target: PromoTarget | null | undefined): boolean => {
    const pMin = promoMinTargetPrice(target, ctx);
    return pMin === null || baht >= pMin;
  };
  switch (r.type) {
    case "percent":
      return (r.apply_to ?? "cup") === "cup" && r.percent >= 100;
    case "fixed_price":
      return (r.apply_to ?? "cup") === "cup" && r.price === 0;
    case "amount":
      return (r.apply_to ?? "cup") === "cup" && bahtRisky(r.baht, rule.target);
    case "bundle":
      return r.price === 0;
    case "buy_get": {
      const gd = r.get_discount;
      if ("percent" in gd) return gd.percent >= 100;
      if ("fixed_price" in gd) return gd.fixed_price === 0;
      return bahtRisky(gd.baht, r.get_target ?? rule.target);
    }
    case "bill_percent":
      return r.percent >= 100;
    case "bill_amount":
      return rule.min_subtotal == null || r.baht >= rule.min_subtotal;
    case "tiered": {
      const onCup = (r.apply_to ?? "cup") === "cup";
      return (
        onCup &&
        r.tiers.some((t: PromoCupTier) => {
          if ("percent" in t) return t.percent >= 100;
          if ("fixed_price" in t) return t.fixed_price === 0;
          return bahtRisky(t.baht, rule.target);
        })
      );
    }
    case "bill_tiers":
      return r.tiers.some((t: PromoBillTier) => ("percent" in t ? t.percent >= 100 : r.basis !== "subtotal" || t.baht >= t.min));
  }
}

/** กฎของโปร: `rule` ถ้ามี · ไม่มี = ถอดจากรูปเดิม (แคตตาล็อกเก่า) */
export function resolvePromoRule(p: {
  rule?: PromoRule | null;
  template?: PromoTemplate;
  kind?: PromotionKind | null;
  params?: PromotionParams | null;
  stackable?: boolean | null;
}): { template: PromoTemplate; rule: PromoRule } | null {
  if (p.rule) return { template: p.template ?? p.kind ?? "custom", rule: p.rule };
  if (!p.kind) return null;
  return promoFromLegacy(p.kind, p.params, p.stackable);
}

/** ช่วงเวลาของโปร: `timeWindows` ถ้ามี · ไม่มี = ถอดจาก daysOfWeek/timeFrom/timeTo */
export function resolvePromoWindows(p: {
  timeWindows?: TimeWindow[] | null;
  daysOfWeek?: number[] | null;
  timeFrom?: string | null;
  timeTo?: string | null;
}): TimeWindow[] {
  if (Array.isArray(p.timeWindows)) return p.timeWindows;
  return windowsFromLegacy(p.daysOfWeek, p.timeFrom, p.timeTo);
}
