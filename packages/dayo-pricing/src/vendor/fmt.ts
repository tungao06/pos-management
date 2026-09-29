// fmt — จัดรูปตัวเลขเงิน/จำนวนสำหรับแสดงผล (ไม่ใช้คำนวณ)
// เงินในระบบเป็น numeric(10,2) (DATA-CONTRACT §2) จึงปัด 2 ตำแหน่งเป็นค่าเริ่มต้น

/**
 * ปัด 2 ตำแหน่งแบบทศนิยม (half away from zero) ให้ตรงกับ round(numeric, 2) ของ Postgres
 * ตัดเศษ float ด้วย toPrecision(12) แล้วเลื่อนจุดผ่านสตริง (e2) เพื่อไม่ให้ 36.675 กลายเป็น 36.67
 */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  // ทางลัด: ค่าที่เป็นทศนิยม ≤ 2 ตำแหน่งอยู่แล้ว (ส่วนใหญ่ของเงินในระบบ) — k/100 ปัดแบบถูกต้องเท่าทางปกติทุกบิต
  // (ทางปกติคืน Number(`${k}e-2`) ซึ่งก็คือ k/100 ที่ปัดถูกต้อง) · ไม่ใกล้จำนวนเต็มพอ = ทางปกติ
  const x = n * 100;
  const k = Math.round(x);
  if (Math.abs(x - k) < 1e-7 && Math.abs(k) < 1e13) return k / 100 + 0;
  const abs = Math.abs(Number(n.toPrecision(12)));
  const s = String(abs);
  const r = s.includes("e") ? Math.round(abs * 100) / 100 : Number(Math.round(Number(`${s}e2`)) + "e-2");
  return n < 0 ? -r : r;
}

export function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  const factor = 10 ** decimals;
  const rounded = Math.round((n + Number.EPSILON) * factor) / factor;
  const fixed = rounded.toFixed(decimals);
  const trimmed = decimals > 0 ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  const [intPart, decPart] = trimmed.split(".");
  const withComma = (intPart ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart ? `${withComma}.${decPart}` : withComma;
}

/** เงินเต็มรูปแบบเสมอ 2 ตำแหน่ง เช่น 85 -> "85.00" ใช้เวลาต้องคงรูปเงินชัดเจน */
export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  const withComma = round2(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))(?=\d*\.)/g, ",");
  return withComma;
}
