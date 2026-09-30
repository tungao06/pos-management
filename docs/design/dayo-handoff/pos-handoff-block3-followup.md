# ส่งมอบให้ทีม POS: ตอบเรื่องที่แจ้งฝั่ง dayo (ข้อ 1–14 + แผน 10 F7)

> ตอบไฟล์ `pos-management/docs/design/08-เรื่องที่ต้องแจ้งฝั่ง-dayo.md` ข้อ 1–14 และแผน 10 (`2026-09-30-10-promo-engine-parity.md`) F7/Q6
> branch `pos-followup` (ต่อจาก dayo `main` `f4cda56`) · migration ใหม่ `0076` · ไม่มี ADR ใหม่

## สรุปสั้น ๆ

- **E4 มี `server_time` แล้ว** (ข้อ 9): รูปเดียวกับ E1/E2 (`2026-09-24T13:05:01.337+00:00`) และมีในทุกคำตอบที่ `ok: true` แม้ไม่มีบิลในช่วงนั้น
- **E1 `pricing.files_sha256` มีครบ 8 ไฟล์แล้ว รวม `promoRule.ts`** (F7/Q6) และคำนวณแฮช**หลังแปลง CRLF เป็น LF** (ข้อ 7 · D72) จึงได้ค่าเดียวกับ `pos-parity.json` ทุกเครื่อง
- **`pos-parity.json`**: ทุกเคสใน `cases` มี `saleTime` แล้ว (ข้อ 5) · ค่าเงินเป็น number เสมอ (ข้อ 10) · แต่ละบรรทัดมี `optionAdds`/`promoBreakdown` เพิ่มเมื่อ SQL ให้ค่า (additive)
- **ยอดเงินในไฟล์ parity ไม่เปลี่ยนเลย**: เทียบ export ก่อนและหลังแก้ ได้ 38 เคส + `rule_fixtures` 104 เคส ต่างกัน 0 เคส
- **ไฟล์ตัวคิดราคาใน `packages/shared/src` ไม่ได้แก้** จึงไม่ต้อง `vendor:update` รอบนี้ แต่ค่า `files_sha256` จะเปลี่ยนรูป (ดูข้อ 3 ด้านล่าง)

## 1) สิ่งที่เปลี่ยนรอบนี้

| ข้อ | เปลี่ยนอะไร | หลักฐาน |
|---|---|---|
| 9 | E4 `GET /v1/pos/shift-cash` เพิ่ม `data.server_time` (UTC `+00:00`) · เป็นฟิลด์เพิ่ม ความหมายของ `bills`/`cash_total` เหมือนเดิม | `supabase/migrations/0076_pos_shift_cash_server_time.sql` · `docs/API.md` §4 · `apps/web/openapi.yaml` `/pos/shift-cash` |
| F7 | `POS_PRICING_FILES` = `money promotions promoRule cost fmt shopSettings types time` (8 ไฟล์) · E1 และ `pos-parity.json` ใช้รายชื่อนี้ร่วมกัน · มีเทสต์ตรวจว่าชุดไฟล์ปิดตัวเอง (ทุก import ของไฟล์ในชุดอยู่ในชุด) | `scripts/version.ts` · `packages/shared/test/posParityExport.test.ts` |
| 7 | แฮชคิดจากเนื้อไฟล์หลังแปลง `\r\n` เป็น `\n` (`lfSha256`) · ได้ค่าเดียวกับ blob ใน git | `scripts/version.ts` `lfSha256` |
| 5 | เคสใน `cases` ที่สเปกไม่ได้กำหนดเวลา ใช้ `saleTime: "12:00"` (ไม่มีโปรจำกัดเวลาตัวไหนครอบ 12:00 ยกเว้นเคส 7/13 ที่ระบุเวลาเอง) | `scripts/posParityNormalize.ts` `DEFAULT_SALE_TIME` |
| 10 | ค่าเงินทุกช่องผ่าน `parityNumber` ก่อนเขียนไฟล์: number ผ่าน · `"70.00"` แปลงเป็น `70` · ค่าผิดรูปจะหยุด export | `scripts/posParityNormalize.ts` · `scripts/export-pos-parity.ts` `toQuoteResult` |
| — | openapi ตามให้ตรงโค้ด: E1 `client.last_z_no/last_z_hash/last_z_until` · `supported_fields` มีค่าเป็นตัวเลขได้ (`promotion_rule_versions`) · `supported_kinds` ไม่ล็อก enum | `apps/web/openapi.yaml` |

## 2) เรื่องที่ทำเสร็จแล้วก่อนรอบนี้ (มีหลักฐาน)

| ข้อ | สถานะ | หลักฐาน |
|---|---|---|
| 1 | เวลาโปรเป็น `HH:MM` แล้ว (`left(time::text, 5)`) | `0062_promo_time_hhmm.sql` · ล่าสุด `0074_promo_usage_limits.sql:172,214` |
| 2 | E1 `client.last_z_until` มีแล้ว (ADR-0069 ข้อ 4 แก้ ADR-0056 ข้อ 16) | `0067_pos_shift_cash_catalog.sql:138-155` · `docs/API.md:107,120-126` |
| 3 | export ใช้ `api_pos_catalog` และ `quote_order` จริงแล้ว | `scripts/export-pos-parity.ts` ส่วน main (ยิง RPC ทั้งสองตัว) |
| 8 | ตัวเลือกที่ `ingredient_id` เป็น null: shared ไม่จับคู่ null=null แล้ว (เหมือน SQL) และตั้งแต่ 0064 บังคับให้นม/เกรดต้องมีวัตถุดิบ | `packages/shared/src/money.ts:57,77,148` · `0064_option_ingredient_required.sql` |

## 3) สิ่งที่ POS ต้องทำ

- **`samePricing`**: หลัง deploy รอบนี้ E1 จะรายงาน 8 คีย์ (เดิม 7) และค่าแฮชเป็นแบบ LF ตรงกับ `VENDOR.json` ของ POS โดยไม่ต้องทำอะไรเพิ่ม ถ้า vendor commit ที่มี `promoRule.ts` ไว้แล้ว
- **E4**: อ่าน `server_time` ได้ถ้าต้องการ (schema ของ POS เป็น `looseObject` อยู่แล้ว ไม่พัง) · dayo รุ่นก่อน `0076` ไม่มีคีย์นี้ ต้องรองรับกรณีไม่มีด้วย
- **`pos-parity.json`**: ถอด `TABLET_UNREACHABLE` หรือการข้ามเคสที่เคยใส่เพราะไม่มี `saleTime` ออกได้ · ใน `rule_fixtures` ยังมี 3 เคสของ `rules-windows.json` ที่ตั้งใจไม่มีเวลา ("ไม่รู้เวลา") เคสเหล่านี้ทดสอบที่ชั้นเครื่องคิดได้เท่านั้น ทางขายของแท็บเล็ตทดสอบไม่ได้
- **ตัวเทียบของ harness (ข้อ 10)** อยู่ฝั่ง POS: ให้เทียบหลัง `JSON.parse` เป็นตัวเลข ไม่เทียบสตริงดิบ ฝั่ง dayo ไม่มีตัวเทียบกับแท็บเล็ต
- ขอไฟล์ `pos-parity.json` ชุดใหม่จากเจ้าของ (รันที่ commit ที่ merge แล้ว) เพราะ `files_sha256` เปลี่ยนรูปเป็น LF

## 4) เรื่องที่รับทราบ หรือเป็นงานของ POS เอง

- **ข้อ 4** (ชุด fixture สัญญาของ dayo): ตอนนี้ POS เป็นเจ้าของตามคำวินิจฉัย O4 · ฝั่ง dayo มีเทสต์สัญญาผ่าน route จริงอยู่แล้ว (`apps/web/test/api.pos*.test.ts`) · **เจ้าของตัดสิน 30 ก.ย. 2569: POS เป็นเจ้าของชุด fixture สัญญาต่อไป** dayo ไม่ทำ `pos-contract/` ของตัวเอง
- **ข้อ 6**: รับทราบ กติกา "API ไม่ส่งต้นทุน/กำไร" คือ ADR-0040 ข้อ 3 · ไม่แก้ ADR
- **ข้อ 11, 14**: รับทราบเป็นผลของ D118 · ไม่แก้โค้ด dayo
- **ข้อ 13**: เจ้าของตอบแล้วว่ายังไม่ทำปุ่มปิดกะค้างบนเว็บ (จ-5)
- **ข้อ 12 — เจ้าของตัดสิน 30 ก.ย. 2569 ตามข้อเสนอ: POS ไม่ส่ง `order_void` ของบิลที่เก็บไว้ในเครื่อง ให้บันทึกเงินออกเป็น `cash_movement` แทน** · dayo ไม่เปลี่ยน (ไม่มี ADR ใหม่) · เหตุผลเดิม: วันนี้ dayo ตอบ `order_void` ที่อ้างบิลซึ่งไม่เคยมาถึงว่า `deferred PARENT_PENDING` ตลอดไป (`0074_promo_usage_limits.sql:2567-2570` · ADR-0056 ข้อ 4) ทำให้คืนเงินก้อนนี้**ไม่เข้า**ยอดเงินสดที่ dayo คาด และแถวค้างในเครื่องตลอด ข้อเสนอคือให้ POS ไม่ส่ง `order_void` ของบิลที่เก็บไว้ในเครื่อง แล้วบันทึกเงินออกเป็น `cash_movement` (ชนิดที่ dayo รับอยู่แล้ว) · ถ้าจะให้ dayo รับ void ของบิลที่ไม่มีในฐาน ต้องทำ ADR ใหม่
- **F2/F3** (`supported_fields` มีค่าเป็นตัวเลข · โปรรูปใหม่ไม่มี `kind`): เป็นสัญญาที่ ADR-0071/0072 ยอมรับแล้ว แก้ที่ schema ฝั่ง POS
