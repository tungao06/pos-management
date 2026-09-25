// ตั้งค่าระบบ (ADR-0046) + ความหวานปกติ 100% (ADR-0047) — โค้ดบริสุทธิ์ใช้ร่วมกันระหว่างบอท/เว็บ
// ต้นฉบับค่าจริง = ตาราง shop_settings (RPC get_shop_settings / save_shop_settings) · ค่าตั้งต้นที่นี่ต้องตรงกับ dayo_shop_settings ใน SQL

import { bkkDay } from "./time";
import { isValidSizeCode } from "./types";
import type { CupSizeEntry, MilkCode, OrderCatalog, ShopSaleSettings, Size, Sweetness } from "./types";

/** ชื่อร้านเมื่ออ่านค่าไม่ได้ */
export const DEFAULT_SHOP_NAME = "DA-YO";

export const DEFAULT_SALE_SETTINGS: ShopSaleSettings = {
  shopName: DEFAULT_SHOP_NAME,
  defaultSize: "16 oz",
  defaultSweetness: "100%",
  defaultChannelCode: "store",
  defaultMilk: "fresh",
  maxQtyPerLine: 99,
  backdateDays: 7,
  recentOrdersCount: 5,
};

/** ค่าเริ่มต้นการขายจากแคตตาล็อก (get_full_catalog.settings) — คีย์ที่ขาด = ค่าตั้งต้น */
export function saleSettingsOf(catalog: Pick<OrderCatalog, "settings"> | null | undefined): ShopSaleSettings {
  const s = catalog?.settings ?? {};
  const pick = <K extends keyof ShopSaleSettings>(k: K): ShopSaleSettings[K] => (s[k] ?? DEFAULT_SALE_SETTINGS[k]) as ShopSaleSettings[K];
  return {
    shopName: pick("shopName") || DEFAULT_SHOP_NAME,
    defaultSize: pick("defaultSize"),
    defaultSweetness: pick("defaultSweetness"),
    defaultChannelCode: pick("defaultChannelCode") || DEFAULT_SALE_SETTINGS.defaultChannelCode,
    defaultMilk: pick("defaultMilk"),
    maxQtyPerLine: Number(pick("maxQtyPerLine")) || DEFAULT_SALE_SETTINGS.maxQtyPerLine,
    backdateDays: Number.isFinite(Number(pick("backdateDays"))) ? Number(pick("backdateDays")) : DEFAULT_SALE_SETTINGS.backdateDays,
    recentOrdersCount: Number(pick("recentOrdersCount")) || DEFAULT_SALE_SETTINGS.recentOrdersCount,
  };
}

// ── ความหวาน (ADR-0047) ─────────────────────────────────────────────

/** ลำดับปุ่ม/ตัวเลือกความหวาน: 100% (ปกติของร้าน) ก่อน */
export const SWEETNESS_PICK_ORDER: readonly Sweetness[] = ["100%", "75%", "50%", "25%", "0%"];

/** คำเรียกความหวานที่แสดงบนเว็บ/บอท */
export const SWEETNESS_LABELS: Record<Sweetness, string> = {
  "0%": "ไม่หวาน",
  "25%": "หวานน้อยมาก",
  "50%": "หวานน้อย",
  "75%": "หวานกลาง",
  "100%": "หวานปกติ",
};

/** เรียงรายการความหวานตาม SWEETNESS_PICK_ORDER (ค่าที่ไม่รู้จักไว้ท้าย) */
export function sortSweetnessForPicker<T extends string>(values: readonly T[]): T[] {
  const rank = (v: string) => {
    const i = (SWEETNESS_PICK_ORDER as readonly string[]).indexOf(v);
    return i === -1 ? SWEETNESS_PICK_ORDER.length : i;
  };
  return [...values].sort((a, b) => rank(a) - rank(b));
}

/**
 * ตัวแปรเมนูที่ใช้ตั้งต้น (บอร์ด/การ์ดสูตร/หน้าขาย): ขนาด+ความหวานเริ่มต้นของร้าน →
 * ขนาดเริ่มต้นความหวานอื่น → ความหวานเริ่มต้นขนาดอื่น → ตัวแรกตามลำดับปุ่ม (เหมือน dayo_impl_get_menu_index)
 */
export function pickDefaultVariant<T extends { size: string; sweetness: string }>(
  variants: readonly T[],
  defaults: { defaultSize: Size | string; defaultSweetness: Sweetness | string },
): T | undefined {
  const exact = variants.find((v) => v.size === defaults.defaultSize && v.sweetness === defaults.defaultSweetness);
  if (exact) return exact;
  const bySize = sortSweetnessForPicker(variants.filter((v) => v.size === defaults.defaultSize).map((v) => v.sweetness));
  if (bySize[0]) return variants.find((v) => v.size === defaults.defaultSize && v.sweetness === bySize[0]);
  const bySweet = variants.find((v) => v.sweetness === defaults.defaultSweetness);
  if (bySweet) return bySweet;
  const anySweet = sortSweetnessForPicker(variants.map((v) => v.sweetness))[0];
  return variants.find((v) => v.sweetness === anySweet);
}

/** นมตั้งต้นของ 1 เมนู: ร้านตั้งนมโอ๊ต + เมนูเปลี่ยนเป็นนมโอ๊ตได้ = oat ไม่งั้น fresh (dayo_impl_price_line) */
export function defaultMilkFor(defaultMilk: MilkCode, allowOatMilk: boolean): MilkCode {
  return defaultMilk === "oat" && allowOatMilk ? "oat" : "fresh";
}

// ── ขนาดแก้ว (ADR-0054) ──────────────────────────────────────────────

/** ขนาดที่เปิดใช้ เรียงตาม sort_order แล้วรหัส (ตรงกับ dayo_impl_get_full_catalog/get_options) — ใช้สร้างปุ่ม/ตัวเลือกขนาด */
export function activeSizesSorted(sizes: readonly CupSizeEntry[]): CupSizeEntry[] {
  return sizes
    .filter((s) => s.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

/** ตรวจ default_size ก่อนส่ง save_shop_settings: รูปแบบต้องถูกต้องเสมอ · ถ้าส่งรายการขนาดของร้านมาด้วย ต้องเป็นขนาดที่ active ด้วย (RPC ตรวจซ้ำอีกชั้นเสมอ — ADR-0054 ข้อ 3) */
export function isValidDefaultSize(code: unknown, activeCodes?: readonly string[]): code is Size {
  if (typeof code !== "string" || !isValidSizeCode(code)) return false;
  return activeCodes == null || activeCodes.includes(code);
}

// ── ตั้งค่าทั้งหมด (ผลของ RPC get_shop_settings) ───────────────────────────

export interface ShopSettings {
  shop_name: string;
  default_size: Size;
  default_sweetness: Sweetness;
  default_channel_code: string;
  default_milk: MilkCode;
  backdate_days: number;
  max_qty_per_line: number;
  recent_orders_count: number;
  notify_daily_digest: boolean;
  notify_pending_staff: boolean;
  digest_low_stock: boolean;
  digest_backup_reminder: boolean;
  digest_show_profit: boolean;
  alert_errors: boolean;
  alert_warnings: boolean;
  backup_stale_days: number;
  digest_hour: number;
  updated_at?: string | null;
  updated_by?: string | null;
}

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  shop_name: DEFAULT_SHOP_NAME,
  default_size: "16 oz",
  default_sweetness: "100%",
  default_channel_code: "store",
  default_milk: "fresh",
  backdate_days: 7,
  max_qty_per_line: 99,
  recent_orders_count: 5,
  notify_daily_digest: true,
  notify_pending_staff: true,
  digest_low_stock: true,
  digest_backup_reminder: true,
  digest_show_profit: false,
  alert_errors: true,
  alert_warnings: true,
  backup_stale_days: 7,
  digest_hour: 8,
};

/** ช่วงค่าที่ตั้งได้ (ตรงกับ CHECK ของตาราง shop_settings) — ใช้ทั้งฟอร์มเว็บและตรวจก่อนส่ง */
export const SHOP_SETTINGS_RANGES = {
  backdate_days: { min: 0, max: 60 },
  max_qty_per_line: { min: 1, max: 999 },
  recent_orders_count: { min: 3, max: 10 },
  backup_stale_days: { min: 1, max: 60 },
  digest_hour: { min: 0, max: 23 },
} as const;

export type ShopSettingsPatch = Partial<Omit<ShopSettings, "updated_at" | "updated_by">>;

const BOOL_KEYS = [
  "notify_daily_digest",
  "notify_pending_staff",
  "digest_low_stock",
  "digest_backup_reminder",
  "digest_show_profit",
  "alert_errors",
  "alert_warnings",
] as const;

/**
 * ตรวจค่าก่อนส่ง save_shop_settings (RPC ตรวจซ้ำอีกชั้นเสมอ) — คืน patch ที่สะอาดแล้ว หรือข้อความผิดพลาดภาษาไทย
 * รับค่าจากฟอร์ม (unknown) · คีย์ที่ไม่รู้จัก = ผิด
 */
export function validateShopSettingsPatch(input: unknown): { ok: true; patch: ShopSettingsPatch } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "ข้อมูลไม่ถูกต้องค่ะ" };
  const src = input as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const allowed = new Set<string>([
    "shop_name",
    "default_size",
    "default_sweetness",
    "default_channel_code",
    "default_milk",
    ...Object.keys(SHOP_SETTINGS_RANGES),
    ...BOOL_KEYS,
  ]);
  for (const key of Object.keys(src)) {
    if (!allowed.has(key)) return { ok: false, error: `ไม่รู้จักการตั้งค่า "${key}" ค่ะ` };
  }
  if ("shop_name" in src) {
    const raw = typeof src.shop_name === "string" ? src.shop_name : "";
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(raw)) return { ok: false, error: "ชื่อร้านต้องไม่มีขึ้นบรรทัดใหม่หรืออักขระพิเศษที่มองไม่เห็นค่ะ" };
    const name = raw.trim();
    if (!name || name.length > 60) return { ok: false, error: "ชื่อร้านต้องมี 1–60 ตัวอักษรค่ะ" };
    patch.shop_name = name;
  }
  if ("default_size" in src) {
    // รูปแบบเท่านั้น (ADR-0054) — ต้องเป็นขนาด active ของร้านด้วย ตรวจซ้ำที่ RPC save_shop_settings (มีรายชื่อขนาดจริงของร้าน)
    if (!isValidDefaultSize(src.default_size)) return { ok: false, error: 'ขนาดเริ่มต้นต้องเป็นรหัสขนาดรูปแบบ "<ตัวเลข> oz" เช่น 16 oz ค่ะ' };
    patch.default_size = src.default_size;
  }
  if ("default_sweetness" in src) {
    if (!(SWEETNESS_PICK_ORDER as readonly unknown[]).includes(src.default_sweetness)) {
      return { ok: false, error: "ความหวานเริ่มต้นต้องเป็น 0% 25% 50% 75% หรือ 100% ค่ะ" };
    }
    patch.default_sweetness = src.default_sweetness;
  }
  if ("default_milk" in src) {
    if (src.default_milk !== "fresh" && src.default_milk !== "oat") return { ok: false, error: "นมเริ่มต้นต้องเป็นนมสดหรือนมโอ๊ตค่ะ" };
    patch.default_milk = src.default_milk;
  }
  if ("default_channel_code" in src) {
    const code = typeof src.default_channel_code === "string" ? src.default_channel_code.trim() : "";
    if (!code) return { ok: false, error: "เลือกช่องทางเริ่มต้นก่อนค่ะ" };
    patch.default_channel_code = code;
  }
  const labels: Record<keyof typeof SHOP_SETTINGS_RANGES, string> = {
    backdate_days: "บันทึกย้อนหลังได้กี่วัน",
    max_qty_per_line: "จำนวนสูงสุดต่อรายการ",
    recent_orders_count: 'จำนวนบิลใน "ขายล่าสุด"',
    backup_stale_days: "เตือนสำรองเมื่อเกินกี่วัน",
    digest_hour: "เวลาส่งสรุป",
  };
  for (const key of Object.keys(SHOP_SETTINGS_RANGES) as Array<keyof typeof SHOP_SETTINGS_RANGES>) {
    if (!(key in src)) continue;
    const raw = src[key];
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
    const { min, max } = SHOP_SETTINGS_RANGES[key];
    if (!Number.isInteger(n) || n < min || n > max) return { ok: false, error: `${labels[key]} ต้องเป็นจำนวนเต็ม ${min}–${max} ค่ะ` };
    patch[key] = n;
  }
  for (const key of BOOL_KEYS) {
    if (!(key in src)) continue;
    if (typeof src[key] !== "boolean") return { ok: false, error: "สวิตช์ต้องเป็น เปิด/ปิด ค่ะ" };
    patch[key] = src[key];
  }
  return { ok: true, patch: patch as ShopSettingsPatch };
}

// ── แจ้งเตือน (ADR-0044 ขยายโดย ADR-0046) ───────────────────────────────

/** สวิตช์แจ้ง error/warning — อ่านไม่ได้ (null) = ส่ง (ปลอดภัยไว้ก่อน) */
export function alertLevelEnabled(
  settings: Pick<ShopSettings, "alert_errors" | "alert_warnings"> | null | undefined,
  level: "error" | "warning",
): boolean {
  if (!settings) return true;
  return level === "error" ? settings.alert_errors !== false : settings.alert_warnings !== false;
}

// ── cron รายชั่วโมงของบอท ────────────────────────────────────────────

/** heartbeat วันละครั้ง 01:00 UTC = 08:00 ไทย (กัน Supabase ฟรีหยุดโปรเจกต์ — ADR-0011) */
export const HEARTBEAT_UTC_HOUR = 1;

/** ชั่วโมงเวลาไทย (0–23) ของเวลา epoch ms */
export function bangkokHour(at: number): number {
  return (new Date(at).getUTCHours() + 7) % 24;
}

export interface DigestPlan {
  /** วันที่สรุป (yyyy-mm-dd ไทย) */
  day: string;
  /** วันที่ส่ง (ไทย) — ใช้กันส่งซ้ำในวันเดียวกัน */
  sentOn: string;
  /** true = สรุปของวันนี้ (ส่งตั้งแต่เที่ยง) · false = ของเมื่อวาน */
  isToday: boolean;
}

/**
 * รอบนี้ต้องส่งสรุปไหม: เฉพาะชั่วโมงไทยตรงกับ digest_hour และเปิดสวิตช์ไว้
 * วันที่สรุป: ชั่วโมง < 12 = เมื่อวาน · ≥ 12 = วันนี้ (เจ้าของเลือก — ADR-0046)
 */
export function planDailyDigest(
  at: number,
  settings: Pick<ShopSettings, "notify_daily_digest" | "digest_hour"> | null | undefined,
): DigestPlan | null {
  const s = settings ?? DEFAULT_SHOP_SETTINGS;
  if (!s.notify_daily_digest) return null;
  const hour = bangkokHour(at);
  if (hour !== s.digest_hour) return null;
  const isToday = hour >= 12;
  return { day: bkkDay(isToday ? 0 : -1, at), sentOn: bkkDay(0, at), isToday };
}
