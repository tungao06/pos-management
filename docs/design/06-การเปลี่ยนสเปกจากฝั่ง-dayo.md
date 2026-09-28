# dayo → ทีม POS: สิ่งที่ต่างจากสเปก `04-สเปกการเชื่อม-POS-กับ-dayo.md` (ก้อน 1 ฝั่ง dayo เสร็จแล้ว)

วันที่ 25 ก.ย. 2569 · dayo `main` ที่ commit `135679c` · migration 0048–0052 ขึ้นทั้ง prod และ test แล้ว ·
**`/api/v1` ยังปิดอยู่** (ดูข้อ 8)

## 1. เลข ADR จริงของร่าง P1–P8

| ร่าง | ADR ของ dayo | สถานะ |
|---|---|---|
| P1 แคตตาล็อก + CORS | 0048 | ยอมรับ (มีข้อแก้) |
| P2 push + ขายหลายแหล่ง | 0049 (push) + 0050 (ขายหลายแหล่ง) | ยอมรับ (มีข้อแก้) |
| P3 กะ/ลิ้นชัก | 0056 | เลื่อน (ตัดสินตอนก้อน 3) |
| P4 ค่าใช้จ่าย/กำไร | 0057 (ส่วนเว็บ) · ส่วนดูกำไรบนแท็บเล็ตแทนด้วย 0055 | เลื่อน / ยอมรับแบบใหม่ |
| P5 ต้นทุนถัวเฉลี่ย | 0058 | เลื่อน |
| P6 ตอกบัตร/เงินเดือน | 0059 | เลื่อน |
| P7 สำรองอัตโนมัติ | 0051 | เลื่อน (เจ้าของสำรองแบบกดเองไปก่อน) |
| P8 นำเข้าแบบทับทั้งหมด | 0052 | ยอมรับ (ยังไม่ได้ทำ) |

**เลข ADR ที่ร่างอ้างผิด:** กติกา "API ไม่ส่งต้นทุน/กำไร" คือ **ADR-0040 ข้อ 3** และ DATA-CONTRACT §8 ไม่ใช่ ADR-0035
ข้อ 3 (พบใน P1, P4, P5 ข้อ 9, สเปก §4.4 ข้อ 1, §5.4)

## 2. Endpoint ที่ถอดออก (ต่างจากสเปก §4.1 ที่บอกว่า "คงเดิม")
- `POST /v1/orders` และ `PATCH /v1/orders/{order_no}` **ถอดออกแล้ว** (404) — ใช้ `POST /v1/pos/push` แทน
- `GET /v1/catalog`, `GET /v1/promotions`, `GET /v1/orders`, `GET /v1/stock`, `POST /v1/stock/movements` ยังอยู่

## 3. owner แก้/ยกเลิกบิล POS ได้ (ต่างจากสเปก §4.6/§4.7 และเกณฑ์ก้อน 1 "owner แก้บิล POS = DY403")
- **owner เท่านั้น บนหน้าเว็บเท่านั้น และต้องกรอกเหตุผลทุกครั้ง** (บอท/manager/staff/API แก้ไม่ได้)
- หลังแก้ ยอดของบิลเป็นยอดที่ dayo คิดใหม่ · ยอดที่ POS รายงานเดิมเก็บแช่แข็งไว้ใน `pos_reported_amounts` · ธง
  `amount_mismatch` เดิมไม่ถูกล้าง
- `GET /v1/orders` มีฟิลด์ใหม่ `dayo_edit: { kind: "edit" | "cancel", edited_at, edited_by_name, reason, version }`
  (null = ไม่เคยถูกแก้จาก dayo) — แท็บเล็ตควรแสดงแบบอ่านอย่างเดียว
- `created_by_name`, `dayo_edit.edited_by_name`, `dayo_edit.reason` เป็น `null` ถ้า key ไม่มี scope `staff:read`

## 4. ขนาดแก้วไม่ตายตัวแล้ว (ADR-0054)
- แคตตาล็อกมี `catalog.sizes: [{ code, label, sortOrder, isActive }]` — ตอนนี้มี `16 oz`, `20 oz`
- รูปรหัสขนาด `^[1-9][0-9]{0,2} oz$` · type `Size` ในไฟล์ตัวคิดราคาเปลี่ยนเป็น string ที่ตรวจรูปแบบ
- ตัวแปรเมนูมีฟิลด์เพิ่ม `categoryLabel`, `menuSortOrder`
- **ต้อง `vendor:update` ไฟล์ตัวคิดราคาใหม่ แล้วรัน parity ใหม่** (ดูข้อ 7)
- ร้าน**ยังไม่ขาย 22 oz** — ถ้าข้อมูลใน POS มี 22 oz จะถูก `rejected UNKNOWN_CODE`

## 5. `POST /v1/pos/push` — กติกาที่ implement จริง (ละเอียดใน `docs/API.md` §3)
- ฟิลด์บังคับของ `order`: `pos_order_id` · `receipt_no` รูป `A-000312` · `queue_no` (1–9999) · `sale_date` (= วันที่ไทย
  ของ `sold_at`) · `sold_at` (ISO-8601 มี `Z`/offset) · `channel` · `payment` · `staff_id` · `catalog_version` ·
  `lines` (1–50 รายการ ≤ 500 แก้ว) · `totals` ครบ 4 ช่อง (`items_subtotal`, `items_discount`, `bill_discount`, `total`)
- `order_void` บังคับ `pos_order_id`, `voided_at`, `staff_id`, `reason` · วันที่ไทยของ `voided_at` ต้อง = วันขาย ·
  เก่ากว่า 60 วัน = `rejected INVALID`
- **กันซ้ำด้วย `key` ของแถว + `pos_order_id`** — endpoint นี้**ไม่ใช้** header `Idempotency-Key`
- วิธีชำระ/ช่องทางที่ไม่รู้จัก = `rejected UNKNOWN_CODE` (ไม่แทนค่าเริ่มต้นเงียบ ๆ)
- **โปรที่ปิดก่อน `sold_at` ไม่ถูกคิดให้** (dayo ดูประวัติเปิด/ปิดโปร) → ยอดต่าง/`amount_mismatch` ไม่ปฏิเสธบิล
- ผู้ขายที่ถูกปลดแล้ว (`removed`) ยังส่งบิลได้ · ย้อนหลังได้ไม่เกิน 60 วัน · ล้ำหน้าเกิน 5 นาที = `deferred CLOCK_AHEAD`
- คำตอบมี `reason` (รหัสคงที่) + `detail` (ข้อความสำหรับคน อย่าเทียบในโค้ด) · `server_time` เป็น UTC
- body ≤ 256 KB (นับจริงระหว่างอ่าน ไม่ใช่แค่ Content-Length) · 1–20 แถว/คำขอ

## 6. CORS (ADR-0048)
- อนุญาตเฉพาะ origin ใน `POS_ORIGINS` แบบตรงตัว · ต้องเป็น `https://` (ยกเว้น `http://localhost` / `127.0.0.1`)
- **ไม่รับ wildcard และไม่รับ preview origin ของ Cloudflare Pages** — แจ้ง origin production ที่แน่นอนให้เจ้าของตั้ง
- `OPTIONS` ตอบ 204 เสมอ (แม้ API ปิด) · origin ไม่ตรง = 204 เปล่าไม่มีหัว `Allow-*`
- Allow-Headers: `Authorization`, `Content-Type`, `Idempotency-Key`

## 7. ไฟล์ตัวคิดราคาเป็นสัญญาข้าม repo + ชุดทดสอบ parity
- ไฟล์ที่ POS คัดลอก: `packages/shared/src/{money,promotions,cost,fmt,shopSettings,types,time}.ts`
  (`time.ts` เพิ่มจากรายการในสเปกเพราะไฟล์อื่น import)
- `GET /v1/pos/catalog` ส่ง `pricing.files_sha256` ของไฟล์ชุดนี้ — ค่าเปลี่ยน = ต้องอัปเดตไฟล์ที่คัดลอกไว้
- ไฟล์ `pos-parity.json` อยู่ข้างไฟล์นี้ (`docs/design/pos-parity.json` · สร้างจาก dayo commit `a0f76e2` · 25 เคสตามสเปก §5.3 · เคส 14–15 ไม่อยู่ในไฟล์ เพราะเคส 14 ต้องเทียบกับฐานข้อมูลจริง ส่วน
  เคส 15 ถูกปฏิเสธที่ชั้น API) — ตอนนี้ใช้แคตตาล็อกตัวอย่างในสคริปต์ ยังไม่ได้ดึงจากฐานจริง

## 8. ดูกำไรบนแท็บเล็ต (ADR-0055 แทน P4 ข้อ 6)
- API **ไม่ส่งกำไรเลย** · ปุ่ม "ดูกำไร" บนแท็บเล็ตจะเปิดหน้าแดชบอร์ดเว็บของ dayo แบบอ่านอย่างเดียว หลังยืนยันด้วย OTP
  ทาง LINE หรือรหัส 6 หลัก (เจ้าของเลือกในหน้าตั้งค่า) · session หมดอายุเอง
- `POST /v1/pos/profit-session`, `/profit` และรหัสปลดล็อกของ P4 **ยกเลิก** · ฝั่ง dayo ยังไม่ได้ทำ (ก้อนถัดไป)

## 9. เงื่อนไขเปิด `/api/v1` (แก้แล้ว — สำรองอัตโนมัติเลื่อน)
1. ทดสอบเชื่อมจริงผ่าน
2. ตั้ง `POS_ORIGINS` เป็น origin production ของแท็บเล็ต
3. สร้าง API key ของแท็บเล็ต (scope `catalog:read`, `staff:read`, `orders:read`, `orders:write` · มี QR ให้สแกน · รูปคีย์
   `dayo_<hex 64 ตัว>`)
4. เจ้าของกดสำรองภายใน 24 ชม. ก่อนเปิด + ซ้อมกู้ไฟล์นั้นลงโปรเจกต์ test สำเร็จ 1 ครั้ง

ระหว่างพัฒนา ทีม POS ทดสอบกับโปรเจกต์ test/เครื่อง local ได้ (ตั้ง `API_V1_ENABLED=1` และ `POS_ORIGINS=http://localhost:5173`)

## 10. P3 (กะ) ยังเลื่อน
- `shift_id` ส่งเป็น `null` ได้ต่อไป · dayo ยังไม่คำนวณใบปิดกะ
