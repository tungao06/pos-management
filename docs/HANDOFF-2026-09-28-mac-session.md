# Handoff: session บน Mac วันที่ 28 ก.ย. 2569

ไฟล์นี้มีเนื้อหาเดียวกันทั้งใน `pos-management` และ `dayo-shop-system` เพื่อให้เห็นภาพรวมของทั้งสอง repo จากที่เดียว ใช้เปิดงานต่อบนเครื่อง Windows

สถานะโดยรวม: ยังไม่มีอะไร merge เข้า `main` ของทั้งสอง repo ทุก branch ด้านล่าง push ขึ้น origin แล้ว

## การตัดสินใจของเจ้าของในรอบนี้

| เรื่อง | คำตอบ | บันทึกที่ |
|---|---|---|
| ADR-0051 สำรองอัตโนมัติ | ยอมรับ | dayo `adr-0051-0056-accept` |
| ADR-0056 กะ / เงินสด / ใบปิดกะ (ก้อน 3) | ยอมรับ | dayo `adr-0051-0056-accept` |
| Q72 เพดานยอดต่อบิลนอกแคตตาล็อก | ค่าเริ่มต้น ฿3,000 (`off_catalog_max_total`) | POS D103 · ADR-0056 ข้อ 18 |
| Q73 ข้อความ Discord ของกะ/เงินสด | ไม่แสดงยอดเงิน (`shift_alert_show_amounts = false`) | POS D104 · ADR-0056 ข้อ 18 |
| Q74 ใบปิดกะที่รอบิลเกิน 48 ชม. | แจ้งระดับเหลืองครั้งเดียว (`shift_waiting_alert_hours = 48`) แก้ D98 | POS D105 · ADR-0056 ข้อ 18 |
| ADR-0067 / ADR-0064 (คะแนนจากลูกค้า) | เลื่อนไว้ก่อน | ไม่มีการแก้ |

เรื่องที่ agent ตัดสินใจเองและรอเจ้าของยืนยัน (ถ้าไม่ตกลงให้แก้ใน ADR):
1. เกณฑ์เปิดขายจริง: สำรองอัตโนมัติสำเร็จติดกัน 3 คืน และ restore-test ผ่าน 1 ครั้ง (ADR-0051 ข้อ 16)
2. บิลนอกแคตตาล็อกบนเว็บทำได้แค่ยกเลิก (ADR-0056, คำถาม ค2 ของ P3)
3. ระดับข้อความ Discord ตาม P3 (ค3) และการตรวจใบปิดกะที่รอเกิน 48 ชม. ใช้ cron รายชั่วโมงของบอทที่มีอยู่แล้ว

## pos-management

| Branch | สถานะ | ต้องทำต่อ |
|---|---|---|
| `block-2-pos` | branch รวมงานของก้อน 2 · มี T1 money-edge และ T2 `@dayo/dayo-pricing` (vendor จาก dayo `995fd41`) ผ่าน review แล้ว | ใช้เป็นฐานของทุกสายในก้อน 2 · merge เข้า `main` แบบ `--no-ff` หลัง T22 และ review ทั้งก้อน |
| `b2-pricing` | merge เข้า `block-2-pos` แล้ว | ไม่ต้องใช้ต่อ |
| `b2-screens` (`9bb39ae`) | T16 ซ่อนหน้าสต็อก + ตารางสิทธิ์ ผ่าน review และแก้ตามที่ติแล้ว · unit test 329 ผ่าน · e2e ยังไม่ได้รันหลังแก้ | รัน `pnpm --filter @dayo/pos e2e` แล้ว merge `--no-ff` เข้า `block-2-pos` |
| `b2-contract` (`39a7612`) | T5 zod contract (รวม A1) · review: CHANGES_REQUIRED · ข้อที่ต่างจากแผนทุกข้อตรงกับ SQL ของ dayo | แก้ตามรายการด้านล่าง แล้ว merge เข้า `block-2-pos` |
| `docs-block3-plan` | แผนก้อน 3 ฝั่ง POS (`2026-09-28-08-block3-pos-shift-cash.md`, 18 task) · ร่างแผนฝั่ง dayo (`2026-09-28-08d-block3-dayo-side.md`, wip) · D103-D105 · แก้คำสั่ง T23 เป็น `npm run pos:parity` | ดูรายการด้านล่าง |

### ต้องแก้ใน `b2-contract` ก่อน merge
1. (major) `packages/contracts/src/dayo-api.ts:173`: superRefine ของ `OrderRowData` เรียก `bangkokDateOf(d.sold_at)` แม้ `IsoSent` ไม่ผ่าน ทำให้ `safeParse` โยน `RangeError` แทนที่จะคืน `success: false` ให้ครอบด้วย `isInstant(d.sold_at) &&` และเพิ่มเทสต์ที่ `sold_at` เป็นค่าขยะ
2. (minor) `posText` รับ lone surrogate (`'\ud800'`) ได้ ซึ่ง dayo จะตอบ DY422 ทั้งคำขอ ให้เพิ่ม `s.isWellFormed()` และเทสต์
3. (minor) เพิ่มเทสต์: `PushEnvelope` ที่ไม่มี `device_time` และ `ROW_KEY_RE` ต้องไม่รับ UUID ตัวพิมพ์ใหญ่
4. (nit) ลบ alias `numberish` ใช้ `z.number()` ตรง ๆ

### งานที่เหลือใน `docs-block3-plan`
1. `docs/superpowers/plans/README.md`: ตารางตามลำดับก้อนของ C1 (D65) · แผน 5/5b/5c เลิกแล้ว · ก้อน 2 กำลังทำบน `block-2-pos` · เพิ่มแผนก้อน 3 · แทนบรรทัด "ไม่ push (D49)" ด้วย CLAUDE.md ข้อ 10
2. `docs/design/02-เรื่องค้างสำหรับเจ้าของ.md`: เพิ่มรายการที่ติดเจ้าของ (หัวข้อ "ติดเจ้าของ" ด้านล่าง) · ADR-0051/0056 ยอมรับแล้ว · Q72-Q74 ตอบแล้ว (D103-D105)
3. แผนก้อน 3 ฝั่ง POS §0.6 ยังเขียนว่า Q72-Q74 ยังไม่มีคำตอบ ให้ชี้ไปที่ D103-D105
4. แผน `08d` ฝั่ง dayo: เลข migration ต้องเริ่มที่ `0064` (0062 และ 0063 ใช้แล้ว) · ลบ em-dash/emoji ที่เหลือ · ตรวจรอบสุดท้าย

### ลำดับงานก้อน 2 ที่เหลือ (plan 07)
- สาย B: T6 fixtures → T7 `@dayo/dayo-mock` (รวม A3) หลัง T5 merge
- สาย A: T3 priceCart/order-row → T4 parity (รวม A2) หลัง T5/T6 · map `ingredientId`/`multiplier` ที่เป็น null ด้วยค่าเริ่มต้นพร้อมเทสต์
- สาย C (เส้นทางวิกฤต): T8 schema (+A4) หลัง T5 · T9 หลัง T7 · จากนั้น T10 → T11 → T12a-d → T13 → T14 → T15 ตามลำดับ
- สาย D: T17 หลัง T11 · T18 หลัง T12b · T19-T21 หลัง T15
- ท้าย: T22 ลบเส้นทางคิดราคาเดิม → review ทั้งก้อน → merge `main` → T23 กับเจ้าของ
- หมายเหตุ T12: `can('staff','void_own')` เป็น true แต่ Q44/D50 ให้ staff ยกเลิกบิลต้องมี PIN ของ owner อนุมัติ ขั้นตอนยกเลิกต้องบังคับข้อนี้

## dayo-shop-system

| Branch | สถานะ | ต้องทำต่อ |
|---|---|---|
| `adr-0051-0056-accept` (`24d6c7c`) | ยอมรับ ADR-0051/0056 · แก้ 0021/0024/0035/0049 · CLAUDE.md ข้อ 6 + secret 5 ชื่อ · GLOSSARY คำของก้อน 3 · คำตอบ Q72-Q74 | review แล้วเปิด PR merge ก่อน branch docs อื่น |
| `docs-handoff-sync` (`804418b`) | อัปเดต HANDOFF/PLAN · นโยบายเลข migration · review: CHANGES_REQUIRED | HANDOFF บรรทัด 13/14/20/58/64 ยังเขียนว่า 0051/0056 เลื่อนหรือรออนุมัติ และยังบอกว่าไม่มี `packages/dayo-pricing` · เลข 0062 ให้เขียนว่าเป็นเลขที่คาดไว้ เปลี่ยนชื่อไฟล์ได้ถ้าชนตอน merge · merge หลัง ADR branch |
| `pos-1b-parity` (`51166fb`) | B1 (S4): migration `0062_promo_time_hhmm.sql` ส่ง `timeFrom`/`timeTo` เป็น HH:MM · เทสต์ DB ผ่าน (shared 712) | B2 (S24) `scripts/export-pos-parity.ts` ดึงจาก SQL จริง (`api_pos_catalog` + `quote_order`, `catalog_version`, `--expect-commit`, `saleTime` ทุกเคส, `--out` นอก repo) · B4 CORS `Vary: Origin` · แก้ `docs/API.md` (ตัวอย่าง `timeFrom: "17:00"`, `server_time` เป็น UTC) · เขียน `docs/pos-handoff-1b.md` · `npm run ci` |
| `auto-backup` (`e753fff`, wip) | K1 migration `0063_backup_auto.sql` (role `dayo_backup`, `backup_log_auto`, `backup_status`, ตรวจ ACL) · `supabase/manual/backup-role.sql` · เทสต์ DB เขียนแล้วแต่**ยังไม่เคยรันกับ DB** · `database.types.ts` แก้ด้วยมือ · K2 บางส่วนใน `scripts/backup/` | `db:reset` → เทสต์ DB → `db:types` · K2 `.github/workflows/backup.yml` + `restore-test.yml` (pg client 17 ตัวเดียวกัน) + เทสต์ · K3 หน้า `/settings/backup` · K4 SETUP/OPERATIONS · security reviewer ตรวจ workflow (ADR-0051 ข้อ 8) · `npm run ci` |
| `customer-feedback` | ADR-0067 ของเดิม เลื่อนไว้ | ไม่ต้องแตะ |

### ลำดับ migration
`0062` (pos-1b-parity) → `0063` (auto-backup) → ก้อน 3 เริ่มที่ `0064` · ทำ DB ทีละ worktree (ADR-0066) · migration ใดที่ grant execute ทุก function ให้ `service_role` ต้อง revoke `backup_log_auto` ด้วย (เทสต์ ACL จะจับ)

### ก้อน 3 ฝั่ง dayo
ลงมือได้หลังแผน `08d` เสร็จและ 0062/0063 merge แล้ว · รายการ object ที่ต้องมีอยู่ใน ADR-0056 (ตารางใหม่ 5 ตาราง, คอลัมน์ `orders.off_catalog*`, ค่าตั้ง 4 ตัวใน `shop_settings`, scope `shift:write`, push kind ใหม่ 5 ชนิด, `GET /v1/pos/shift-cash`, คิด Z ซ้ำ, หน้า `/shifts/[shift_id]`)

## ข้อควรรู้เรื่องเครื่อง

- `pos-management` ใช้ Node 22 + pnpm (turbo ต้องหา `pnpm` บน PATH ได้) · `dayo-shop-system` ใช้ Node 24
- เทสต์ `excel-import` timeout บางครั้งตอนรันขนานกัน ให้รันซ้ำหรือใช้ `--concurrency=1`
- `npm run db:start` บน Mac พัง ใช้แทนได้ด้วย `npx supabase start -x studio,logflare,vector,realtime,edge-runtime,imgproxy,mailpit --ignore-health-check`
- `apps/web/.next` ที่ค้างอยู่ทำให้ typecheck พังได้ ลบโฟลเดอร์นั้นแล้วรันใหม่
- dayo `scripts/version.ts` hash ไฟล์คิดราคาแบบไบต์ดิบ ไม่แปลง CRLF เป็น LF ถ้า build dayo จาก checkout แบบ CRLF บน Windows ค่า `files_sha256` จะไม่ตรงกับ POS
- บน Mac: `main` ในเครื่องของ `pos-management` นำหน้า origin 4 commit (merge ผิดโฟลเดอร์) ห้าม push จากเครื่องนั้น · commit ทั้งหมดอยู่ใน `block-2-pos` แล้ว
- ถ้าเครื่อง Windows มีโค้ดก้อน 2 เดิมที่ยังไม่ push ให้ push เป็น branch ใหม่แล้วเทียบกับ `block-2-pos` ก่อนทำต่อ

## ติดเจ้าของ

1. `db:push` 0062 / 0063 ขึ้น production (ตรวจ `supabase migration list` ก่อน)
2. รัน `supabase/manual/backup-role.sql` · ถ้า Supabase ไม่ให้ BYPASSRLS ให้ใช้ `postgres` และบันทึกความเสี่ยง
3. `rclone config` สำหรับ OneDrive · สร้าง fine-grained PAT (Secrets read/write เฉพาะ repo นี้)
4. ตั้ง GitHub secrets: `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` (เก็บสำเนานอก GitHub), `RCLONE_CONF`, `DISCORD_ALERT_WEBHOOK_URL`, `GH_SECRETS_PAT`
5. เปิด `API_V1_ENABLED`, ตั้ง `POS_ORIGINS` และสำรองด้วยมือ + ซ้อม restore
6. บัญชี Cloudflare Pages สำหรับ POS + URL ของ dayo ที่ล็อกตอน build (D89)
7. T23 ทดสอบกับ dayo จริงในเครื่อง (สร้าง API key, นำเข้าแคตตาล็อกจริง, เพิกถอน key, ตรวจ SQL)
8. ทดสอบบนแท็บเล็ตจริง (D51)
