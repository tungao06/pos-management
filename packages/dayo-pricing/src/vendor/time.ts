// เวลา — วันขาย (sale_date) ตัดเที่ยงคืน Asia/Bangkok เสมอ (ADR-0024)
// พอร์ตตรงจาก legacy/worker.js (bkkDay/parseDay) เพื่อความเข้ากันได้ของวันที่

const BKK_OFFSET_MS = 7 * 3600e3;

/** วันที่ (yyyy-mm-dd) ตามเวลาไทย ของ "ตอนนี้ + offsetDays วัน" */
export function bkkDay(offsetDays = 0, now: number = Date.now()): string {
  return new Date(now + BKK_OFFSET_MS + offsetDays * 86400e3).toISOString().slice(0, 10);
}

/** เวลา HH:MM ตามเวลาไทย จาก ISO timestamp */
export function bkkTime(iso: string): string {
  return new Date(new Date(iso).getTime() + BKK_OFFSET_MS).toISOString().slice(11, 16);
}

/**
 * แปลงข้อความวันที่ (วันนี้/เมื่อวาน/2569-09-23/23/9/23/9/69) → yyyy-mm-dd
 * ปี พ.ศ. ถูกแปลงเป็น ค.ศ. (ADR-0020 ข้อ 3) · วันที่ในอนาคตเมื่อไม่ระบุปี → ถอยไปปีก่อนหน้า
 */
export function parseDay(arg: string | null | undefined, now: number = Date.now()): string {
  const a = String(arg ?? "").trim();
  if (!a || /วันนี้|today/.test(a)) return bkkDay(0, now);
  if (/เมื่อวาน|yesterday/.test(a)) return bkkDay(-1, now);
  let m = a.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  m = a.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) {
    let y = m[3] ? +m[3] : +bkkDay(0, now).slice(0, 4);
    // ปีสั้น 2 หลัก (เช่น 69) ถือเป็น พ.ศ. ย่อของศตวรรษ 25xx (ADR-0020 ข้อ 3 ตัวอย่าง "23/9/69")
    if (y < 100) y += 2500;
    if (y > 2400) y -= 543; // ปี พ.ศ. (ทั้งที่พิมพ์เต็ม 4 หลัก และที่แปลงจาก 2 หลักข้างบน)
    const day = m[1] ?? "1";
    const month = m[2] ?? "1";
    const candidate = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!m[3] && candidate > bkkDay(0, now)) {
      // ไม่ได้ระบุปี และได้วันที่อนาคต → ถอยไปปีก่อนหน้า (ADR-0020 ข้อ 3)
      return `${y - 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return candidate;
  }
  return bkkDay(0, now);
}

/** จำนวนวันของ b - a (ทั้งคู่ yyyy-mm-dd) เป็นจำนวนเต็มวัน */
export function dayDiff(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((tb - ta) / 86400e3);
}

/** เลขวันในสัปดาห์ 0=อาทิตย์ … 6=เสาร์ ของวันที่ yyyy-mm-dd (ไม่ขึ้นกับ timezone ของเครื่อง) */
export function dayOfWeek(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** ตรวจว่าเป็นวันที่ปฏิทินจริง (กัน 2569-13-32 ที่ parseDay อาจคืนมาจากข้อความมั่ว) */
export function isValidDateString(day: string): boolean {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, ys, ms, ds] = m;
  const y = Number(ys);
  const mo = Number(ms);
  const d = Number(ds);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}
