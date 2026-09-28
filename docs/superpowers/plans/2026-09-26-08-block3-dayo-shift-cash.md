# ก้อน 3 (ฝั่ง dayo) — กะ · เงินเข้า-ออกลิ้นชัก · นับเงิน · ใบปิดกะ (Z) · บิลนอกแคตตาล็อก — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **แผนนี้ทำใน repo dayo** (`D:\TungAo-Project\line-bot\dayo-shop-system`) โดย session ของ dayo ด้วยทีมของ dayo (`docs/TEAM-WORKFLOW.md` · `.claude/agents/*.md`) — หัวหน้าทีม (Opus) แจกงานตามตาราง "ลำดับและงานขนาน" · ทีม POS **ไม่แก้ไฟล์ใน repo dayo** · path ทุกตัวในแผนนี้เป็น path ใน repo dayo ยกเว้นที่ขึ้นต้นด้วย `POS:` · แผนคู่ฝั่งแท็บเล็ต = `POS:docs/superpowers/plans/2026-09-26-09-*.md` (แผน 09)

**Goal:** ให้ฐานกลาง dayo รับกะ เงินเข้า-ออก การนับเงิน และใบปิดกะ (Z) จากแท็บเล็ต POS ตามสัญญาก้อน 3 ที่ล็อกแล้ว — ชนิด push ใหม่ 5 ชนิด (`shift_open` `cash_movement` `cash_count` `shift_close` `order_off_catalog`) · E4 `GET /v1/pos/shift-cash` · ตัวคิดใบปิดกะซ้ำ (`waiting_bills`/`matched`/`mismatch`) · บิลนอกแคตตาล็อกใน `orders` (ต้นทุนไม่ทราบ) และรายงานทุกตัวที่รองรับ · E1 `last_z_no`/`last_z_hash` · แจ้ง Discord (ไม่มียอดเงิน) · แดชบอร์ด owner 1 บรรทัดต่อกะ + หน้ารายละเอียดกะ — โดย **dayo deploy ก่อน POS เสมอ** และ `API_V1_ENABLED` ยังเป็นไปตามเงื่อนไขเดิมของ ADR-0048

**Architecture:** งานหนักทั้งหมดอยู่ใน migration ใหม่ 6 ไฟล์ (`0055`–`0060`) · ทุกชนิดใหม่เข้าทาง `api_pos_push` ตัวเดิม: แต่ละแถวอยู่ใน savepoint ของตัวเอง → ตัวแยกชนิด `dayo_pos_dispatch` → ฟังก์ชันต่อชนิด · สิ่งที่ต้องไม่ถูกย้อนเมื่อแถวถูกปฏิเสธ (`pos_push_rejections`, บันทึกข้อมูลกะชนกัน S5, แจ้ง `scope:`) เขียนในลูปของ `api_pos_push` **นอก** savepoint · การคิด Z ซ้ำเป็นฟังก์ชันเดียว `dayo_z_recompute(shift_id)` เรียกจาก `shift_close` และจาก trigger ของ `orders`/`cash_movements` · แจ้งเตือนเขียนลงคิว `pos_alerts` ในธุรกรรมเดียวกับเหตุการณ์ แล้ว Route Handler/Server Action/cron ดึงด้วย `pos_alerts_take` → `console.warn/error` → Discord ตามกลไก ADR-0044 (คำถาม ค4 ของ P3) · Route Handler = ตรวจ key + RPC ก้อนเดียว (+ RPC ดึงแจ้งเตือนใน `waitUntil`)

**Tech Stack:** Supabase Postgres 17 (plpgsql) · Next.js 16 App Router บน Cloudflare Workers (OpenNext) · TypeScript strict · Vitest 4 · npm workspaces (`@dayo/web`, `@dayo/shared`, `@dayo/line-bot`) · Node 24 LTS

**Spec:** POS `docs/design/04-สเปกการเชื่อม-POS-กับ-dayo.md` — **ก้อน 3 ล็อกแล้ว**: §4.4 (ข้อ 6 `last_z_no`/`last_z_hash`) · §4.5 ข้อ 0 (คำนำหน้า) และข้อ 6 · §4.10 ก้อน 3 ทั้งหัวข้อ · §6.2 · §6.4 · §6.6 · §6.8 · §9 แถวก้อน 3 · §13.8 · การตัดสินใจ POS `docs/design/00-บันทึกการตัดสินใจ.md` D84–D102 · ร่าง ADR POS `docs/design/dayo-adr-drafts/P3-shift-cash-z-report.md` (รับเป็น ADR-0056) — เจ้าของส่งสำเนาทั้งสามไฟล์ + แผนนี้ให้ session dayo ก่อนเริ่ม (Task 0) · executor อ่านสเปก §4.10 ก้อน 3 + ร่าง P3 ก่อนทุก task · **SQL ใน repo dayo คือความจริง** ที่ใดเอกสาร dayo ต่างจาก SQL ให้ถือ SQL

## Global Constraints

ค่าต่อไปนี้ลอกจากสเปก 04 และ P3 ตรงตัว — ทุก task ต้องเป็นไปตามนี้โดยไม่ต้องเขียนซ้ำ

- **กะมีเฉพาะที่แท็บเล็ต** (D92): เปิด/ปิดกะ นับเงิน ใบปิดกะ ทำบนแท็บเล็ตเท่านั้น · บอทไม่มีคำสั่งกะ · เว็บ dayo อ่านอย่างเดียว (D99)
- **เงินในลิ้นชักยึดเงินที่เก็บจริงตอนขาย** (D93): เงินสดที่ควรมีและการคิดใบปิดกะซ้ำใช้ `orders.pos_reported_amounts` (แช่แข็ง) **ไม่ใช่** `total_amount`/วิธีชำระ/สถานะหลังเจ้าของแก้บนเว็บ · การแก้บนเว็บแสดงเป็นบรรทัด "เจ้าของแก้บิลหลังขาย" ไม่เข้า Z ไม่ทำให้ `mismatch`
- ทุกตารางใหม่: `id uuid` จากแท็บเล็ต · `shop_id` · `api_client_id` · **เวลาเซิร์ฟเวอร์ = `received_at timestamptz default now()`** · เวลาจากเครื่องอยู่ในคอลัมน์ชื่อเฉพาะ · RLS เปิดไม่มี policy · **append-only** (trigger raise เมื่อ update/delete ยกเว้นคอลัมน์ "ปิด" ที่ตั้งได้ครั้งเดียวจาก null) · ลงไฟล์สำรอง · เงิน `numeric(10,2)` บาท
- ชนิด push ใหม่: ซอง คำตัดสิน กันซ้ำ ตารางแผนที่ error ตาม §4.5 · key รูป `<kind>:<uuid>` (ผ่าน regex เดิม `^[a-z][a-z_]{0,39}:<uuid>$`) · **ไม่มีเงินติดลบข้ามขอบ** — `expected`/`variance` dayo คิดเอง: `expected = opening_float + pos_cash_sales − void_refunds + paid_in − paid_out − drops − drawer_expenses + bot_cash` · `variance = counted − expected` (ติดลบ = ขาด · `expected` ติดลบได้)

  | ชนิด | key | ช่อง id | scope | ต้องมีแล้ว (ไม่งั้น `deferred PARENT_PENDING`) |
  |---|---|---|---|---|
  | `shift_open` | `shift_open:<shift_id>` | `shift_id` | `shift:write` | — |
  | `cash_movement` | `cash_movement:<movement_id>` | `movement_id` | `shift:write` | กะ |
  | `cash_count` | `cash_count:<count_id>` | `count_id` | `shift:write` | กะ |
  | `shift_close` | `shift_close:<shift_id>` | `shift_id` | `shift:write` | การนับของกะ |
  | `order_off_catalog` | `order_off_catalog:<pos_order_id>` | `pos_order_id` | `orders:write` | — |

- **ลำดับตรวจแถว** = `0052_pos_push.sql:560-620` โดย (ก) หลังขั้น `orders:write` เพิ่ม "ชนิดกะ และ key ไม่มี `shift:write` → `rejected FORBIDDEN`" (บิลในคำขอเดียวกันยังผ่าน) (ข) ขั้น "`pos_order_id` ไม่ใช่ uuid / uuid ใน key ≠ `pos_order_id`" ใช้ **ช่อง id ของชนิดนั้น** · 403 ทั้งคำขอยังใช้กับ `orders:write` เท่านั้น
- **เวลา**: ช่องเวลาหลักของแถว (`opened_at` · `created_at` · `counted_at` · `closed_at`) เกินเวลาเซิร์ฟเวอร์ + 5 นาที = `deferred CLOCK_AHEAD` · เก่ากว่าเวลาเซิร์ฟเวอร์ − 60 วัน = `rejected INVALID`
- **พนักงาน**: `*_by` = `staff.id` ของร้าน สถานะ active หรือ removed (ไม่พบ/pending = `UNKNOWN_STAFF`) · ช่องที่ต้องเป็น owner ต้องเป็น role owner **และ active ณ เวลาในแถว** ไม่งั้น `FORBIDDEN` `role:` · เป็นการระบุตัว ไม่ใช่สิทธิ์ (ADR-0040)
- **ขอบเขต key (S4)**: ทุกการหา `shifts` `cash_counts` `cash_movements` `z_reports` ใช้ `(shop_id, api_client_id, id)` · แถวแม่ของ key อื่น = `rejected FORBIDDEN` `rule:` · "id เดิม = `duplicate`" เฉพาะเมื่อ `api_client_id` ตรง (id ชนกับ key อื่น = `FORBIDDEN` `rule:`)
- **คำนำหน้า `detail` (ล็อก)**: `FORBIDDEN` → `scope:` (มาจากขั้นตรวจ scope ต่อชนิดเท่านั้น) / `role:` / `rule:` · `CONFLICT` → `exists:<order_no>` / `off_catalog_exists:<order_no>` / `receipt_taken:` / `key_changed:` / `counted:` / `z_no_taken:` · `INVALID` → `data_conflict:` (เฉพาะข้อมูลกะชนกันแบบ INVALID: ยอดนับใน Z ≠ `cash_counts.counted` และ `z_no` > สูงสุด + 50 — คำวินิจฉัยผู้คุมงาน 26 ก.ย. 2569 · ทีม POS เพิ่มในสเปก 04/แผน 09) · `exists:`/`off_catalog_exists:` มี `data` = `{order_no, version, reported_total, payment_is_cash, off_catalog}` · ใช้กับทุกชนิดของก้อน 3 และเพิ่มให้ `order`/`order_void` เดิมด้วย · ไม่มีคำนำหน้า = แท็บเล็ตทำแบบเดิมของเหตุผลนั้น
- **`data` ของ `accepted`/`duplicate` (ล็อก)**: `shift_open` `{shift_id}` · `cash_movement` `{movement_id}` · `cash_count` `{count_id}` · `shift_close` `{shift_id}` **เท่านั้น** · `order_off_catalog` `{order_no, version}` (`order_no` จากตัวออกเลขเดียวกับ `create_order`)
- **เพดานรายการ**: `pos_bills` ≤ 2000 · `bot_bills` ≤ 500 · `movement_ids` ≤ 500 · เกิน = `rejected INVALID` · คีย์ย่อยที่ไม่รู้จักใน `z_report` (รวม `cash`, `bot_window`, สมาชิกของ `bot_bills`/`pos_bills`) และ `totals` = `rejected INVALID`
- **ข้อมูลกะชนกัน (S5)**: `CONFLICT` `key_changed:`/`counted:`/`z_no_taken:` ของชนิดกะ · `shift_close` ที่ `z_report.counted` ≠ `cash_counts.counted` (`INVALID`) · `z_no` > สูงสุด + 50 (`INVALID`) → `audit_log` (sha256 ของเนื้อหาทั้งสองชุด) **นอก savepoint** + 🔴 Discord "ข้อมูลกะชนกัน — ตรวจกุญแจเครื่อง" + `shifts.data_conflict` · ผู้ส่งคนแรกชนะ
- **แจ้ง Discord `#dayo-ระบบ`** (D98 · D102 · ADR-0044): **ข้อความไม่มียอดเงิน (รอ Q73 — ค่าเริ่มต้น)** ไม่มีชื่อพนักงาน เหตุผลอิสระ หรือ id นอกจากลิงก์หน้ากะ · |variance| ≥ `z_report.variance_alert` ครั้งเดียวต่อ Z · เปลี่ยน**เข้า** `mismatch` ครั้งเดียวต่อการเปลี่ยน · ข้อมูลกะชนกัน 🔴 · บิลนอกแคตตาล็อกที่รับ 🟡 นับใบ · `scope:` 🟡 วันละครั้งต่อ key · "กะซ้อนกัน" และ > 3 กะต่อ key ต่อวัน 🟡 · `duplicate` ไม่แจ้งซ้ำ · **`waiting_bills` ไม่แจ้ง (D98)** ยกเว้นค่าตั้ง `shift_waiting_alert_hours` (**รอ Q74 — ค่าเริ่มต้น 48 ชม. · ขัด D98 ดู "จุดขัด" ข้อ 1**)
- **บิลนอกแคตตาล็อก** (D91 · D97): ใน `orders` `source='pos'` `off_catalog=true` · **`cost_total = null`** (ไม่ทราบ ≠ 0) · ไม่มี `order_items`/`order_promotions` · ไม่ตัดสต็อก · เพดานต่อบิล `shop_settings.off_catalog_max_total` **ค่าเริ่มต้น ฿3,000 (รอ Q72 — ค่าเริ่มต้น)** · พื้นล่าง `sold_at` ≥ 00:00 ไทยของ `shop_settings.block3_live_from` (ว่าง = ปฏิเสธ)
- **รายงาน**: ยอดขายและจำนวนบิลรวมบิลนอกแคตตาล็อก · ต้นทุน/กำไรขั้นต้นไม่รวม + บรรทัด **"บิลไม่รู้ต้นทุน N ใบ · ยอด ฿X"** · **GP%** = กำไรขั้นต้น ÷ (ยอดขาย − ยอดบิลไม่รู้ต้นทุน) (ตัวหาร 0 = "—") · จำนวนแก้วรวม Σ `qty` ของ `off_catalog_lines` · อันดับเมนูไม่รวม · **ห้ามถือต้นทุนเป็น 0**
- **สิทธิ์เว็บ (S6 · D99)**: `dashboard_shifts` และ `get_shift_detail` รับ `p_staff_id` และ raise `DY403` ถ้าไม่ใช่ owner · `today_mini` คืนแค่สถานะกะเปิด/ปิด · **ไม่มี API ใด (E3 E4 หรืออื่น) คืน `z_reports` หรือส่วนต่าง** · Export ที่มีข้อมูลกะเฉพาะ owner
- `detail` ≤ 500 code point · สะท้อนได้เฉพาะ วันที่/เวลา รหัสเมนู-ช่องทาง-วิธีชำระ เลขใบเสร็จ `order_no` SQLSTATE · **ห้าม** id พนักงาน ข้อความอิสระ (`reason`/`note`/`variance_reason`/`lines.name`) ยอดเงิน ข้อความ error ดิบของ Postgres · **รวมถึงเลขอื่นที่ส่งมา** เช่น `z_no` ชนิดธนบัตร จำนวนนับ (ไม่อยู่ในรายการที่อนุญาต)
- ค่าลับทั้งหมดเจ้าของถือ · agent ห้ามอ่าน `.env*` / `.dev.vars` / `backups/` · ขั้นที่มี ⛔ **เจ้าของทำเอง**
- กฎเหล็กของ dayo ใช้ครบ: migration ใหม่เท่านั้น (ห้ามแก้ไฟล์เก่า · ฟังก์ชันที่ต้องเปลี่ยน "ลอกรุ่นล่าสุดทุกบรรทัด" แล้วแก้เฉพาะจุดที่ระบุ + ป้าย `-- ADR-0056`) · หลังแก้ schema รัน `npm run db:types` · RLS เปิดไม่มี policy · ท้ายทุก migration ใช้ **บล็อกสิทธิ์มาตรฐาน** = `0054_customer_bot.sql:1000-1005` ตรงตัว (revoke ทั้งหมดจาก anon/authenticated · grant service_role · **แล้ว `grant execute on function public.customer_shop_info(uuid) to anon;` ซ้ำเสมอ** — ขาดบรรทัดนี้ = บอทลูกค้าบน production พัง · ADR-0062) · `npm run ci` ผ่านก่อน commit · **commit เมื่อเจ้าของสั่งเท่านั้น** (กฎเหล็กข้อ 18) และใช้ skill `committing-code` ทุกครั้ง · `db:push` = production ถามเจ้าของก่อนทุกครั้ง
- ห้ามเปลี่ยนสัญญา §4.10 ก้อน 3 เอง — ถ้าต้องเปลี่ยน: หยุด แจ้งเจ้าของ ทีม POS แก้สเปกก่อน แล้วทั้งสองฝั่งทำตาม

## จุดขัดกับ D ของ POS / ADR ของ dayo (หัวหน้าทีม dayo ถามเจ้าของใน Task 0 ก่อนเริ่มโค้ด)

1. **Q74 ขัด D98** — D98 (ยืนยันโดย D102 เฉพาะเกณฑ์) บอก "สถานะรอบิลมาครบไม่แจ้ง" · ผู้คุมงานสั่งให้แผนนี้ทำค่าเริ่มต้นของ Q74 (แจ้ง 🟡 ครั้งเดียวเมื่อรอเกิน 48 ชม.) → แผนทำเป็นค่าตั้ง `shop_settings.shift_waiting_alert_hours` **ค่าเริ่มต้น 48 (รอ Q74 — ค่าเริ่มต้น)** · ถ้าเจ้าของตอบ "ไม่แจ้ง" ให้เปลี่ยนค่าเริ่มต้นใน migration `0055` เป็น `null` ก่อน merge (โค้ดอื่นไม่เปลี่ยน) · ถ้าตอบ "แจ้ง" ทีม POS บันทึก D ใหม่แทนส่วนนั้นของ D98
2. **ADR-0044 ข้อ 8 (`@here`)** — P3 คำถาม ค3 แนะนำ "ข้อมูลกะชนกัน = 🔴 + `@here`" แต่ ADR-0044 ข้อ 8 จำกัด `@here` เฉพาะ deploy ล้ม/heartbeat ล้ม/error ซ้ำ > 10 ครั้ง · **ผู้คุมงานยืนยัน 26 ก.ย. 2569: ไม่ใส่ `@here`** (คง ADR-0044) — Task 0 บันทึกเป็นหมายเหตุเท่านั้น ไม่ถามเจ้าของ
3. **ADR-0051 (สำรองอัตโนมัติ) ยังเลื่อน** — P3 "สิ่งที่ dayo ต้องเปลี่ยน" ข้อ 4 (D95) ขอยกเลิกการเลื่อน · **ไม่อยู่ในขอบเขตโค้ดของแผนนี้** (เนื้องานเดิมอยู่ในแผน 06 Task 14/17) · Task 0 ให้เจ้าของตัดสินสถานะ ADR-0051 · POS จะไม่เปิดใช้แท็บเล็ตขายจริงจนกว่าสำรองอัตโนมัติทำงาน (D86 · D94)
4. ไม่พบจุดอื่นที่ขัด D84–D102 · ADR ของ dayo ที่ถูกแก้ (ADR-0024 ข้อ 2 · ADR-0049 ข้อ 3 (ก0) · ADR-0056 ทั้งฉบับ) ผ่าน Task 0 ตามกฎเหล็กข้อ 1

---

## File Structure

### ฐานข้อมูล (`supabase/`) — lane A (db-engineer · ช่อง Docker)
| ไฟล์ | หน้าที่ |
|---|---|
| `supabase/migrations/0055_block3_schema.sql` (Task 1) | ตรวจคู่ซ้ำ + ย้าย unique `orders (shop_id, pos_order_id)` · `orders.off_catalog*` + `cost_total` null ได้เฉพาะบิลนอกแคตตาล็อก · `orders_pos_frozen` + `pos_shift_id`/`external_ref`/`off_catalog*` · คีย์ `payment` ใน `pos_reported_amounts` (trigger ตอนแทรก) · กันแก้บิลนอกแคตตาล็อก · ตาราง `shifts` `cash_movements` `cash_counts` `z_reports` `pos_push_rejections` `pos_alerts` + trigger · `shop_settings.block3_live_from` `off_catalog_max_total` `shift_waiting_alert_hours` + trigger · scope `shift:write` · `audit_log.action` ใหม่ · ตัวช่วย (`dayo_pos_owner_active_at` `dayo_thai_short_date` `dayo_pos_alert` `dayo_z_expected`) · `pos_alerts_take` · `get_pos_cash_settings`/`save_pos_cash_settings` · `backup_dump_table` |
| `supabase/migrations/0056_pos_push_shift_kinds.sql` (Task 2) | `dayo_pos_verdict_s5` · `dayo_pos_exists_verdict` · `dayo_pos_id_field` · `dayo_pos_shift_open` · `dayo_pos_cash_movement` · `dayo_pos_cash_count` · `dayo_pos_dispatch` · `dayo_pos_supported` (+3 ชนิด) · `dayo_pos_push_row` · `dayo_pos_map_error` · `dayo_pos_order` (หาข้าม key + คำนำหน้า) · `dayo_pos_void` (คำนำหน้า `rule:`) · `dayo_pos_record_shift_conflict` · `dayo_shift_overlap_alert` · `api_pos_push` (`pos_push_rejections` + S5 + `scope:` นอก savepoint) |
| `supabase/migrations/0057_pos_off_catalog.sql` (Task 3) | `dayo_pos_order_off_catalog` · `dayo_pos_dispatch` + `dayo_pos_supported` (+`order_off_catalog`) |
| `supabase/migrations/0058_pos_shift_close_z.sql` (Task 4) | `dayo_shift_cash_bills` · `api_shift_cash` (E4) · `dayo_pos_shift_close` · `dayo_z_recompute` · trigger คิดซ้ำบน `orders`/`cash_movements` · `dayo_pos_dispatch` + `dayo_pos_supported` (+`shift_close`) · `api_pos_catalog` (+`last_z_no`/`last_z_hash`/`last_z_until`) |
| `supabase/migrations/0059_block3_reports.sql` (Task 5) | `v_daily_summary` (+บิลไม่รู้ต้นทุน) · `dayo_summary_range` · `dayo_source_rows` · `profit_view_dashboard` · `dashboard_breakdown` · `dashboard_trend` · `today_mini` · `get_order` · `list_api_orders` (+`off_catalog`) · ไม่แก้ `dashboard_summary`/`daily_digest` (ได้ฟิลด์ใหม่ผ่าน `dayo_summary_range`) |
| `supabase/migrations/0060_block3_shift_reads.sql` (Task 6) | `dayo_shift_owner_edits` · `dashboard_shifts` · `get_shift_detail` · `pos_alerts_scan` (รอเกินเกณฑ์ + ล้างคิวเก่า) · `export_rows` (+`orders.off_catalog` · +กลุ่ม `shifts`) |
| หมายเหตุเลขไฟล์ | `0055`–`0060` เป็นเลขตอนเขียนแผน · ก้อน 3 เริ่มที่ `0064` (`0061`–`0063` ถูกงานอื่นของ dayo ใช้แล้ว — อัปเดต 28 ก.ย. 2569) → ใช้ `0064`–`0069` ตาม Task 0 Step 1b |
| `packages/shared/test/db/block3Fixtures.ts` (Task 1 — เจ้าของคนเดียว) | ตัวช่วยเทสต์: key ทดสอบ · ตัวส่ง push · ตัวสร้างแถวทุกชนิด + `z_report` |
| `packages/shared/test/db/block3_schema.db.test.ts` (Task 1) | ตาราง/trigger/ค่าตั้ง/scope/ดัชนี |
| `packages/shared/test/db/pos_push_shift.db.test.ts` (Task 2) | ชนิดกะ 3 ชนิด · scope · คำนำหน้า · S4 · S5 · `pos_push_rejections` · หาบิลข้าม key |
| `packages/shared/test/db/pos_off_catalog.db.test.ts` (Task 3) | `order_off_catalog` ครบเกณฑ์ §9 |
| `packages/shared/test/db/pos_z_recompute.db.test.ts` (Task 4) | `shift_close` · คิดซ้ำ 6 ข้อ · ลำดับ `z_no` 0–6 · E4 · E1 · parity สูตรเงินที่ควรมี |
| `packages/shared/test/db/block3_reports.db.test.ts` (Task 5) | รายงานกับบิลไม่รู้ต้นทุน · `get_order` · E3 · `today_mini` |
| `packages/shared/test/db/block3_shift_reads.db.test.ts` (Task 6) | สิทธิ์ owner · บรรทัดกะ · รายละเอียดกะ · "เจ้าของแก้บิลหลังขาย" · แจ้งรอเกินเกณฑ์ |
| `packages/shared/src/database.types.ts` | สร้างใหม่ด้วย `npm run db:types` — **เฉพาะ lane A** |

### ตรรกะกลาง (`packages/shared`) — lane C (shared-logic-engineer)
| ไฟล์ | หน้าที่ |
|---|---|
| `packages/shared/src/shiftDisplay.ts` (ใหม่ · Task 7) | ข้อความบรรทัดกะ · ป้าย · อายุการรอ · "ขาด/เกิน ฿n" · ตัวช่วยบรรทัด "บิลไม่รู้ต้นทุน" |
| `packages/shared/src/discordMessages.ts` (แก้ · Task 7) | `DailyDigest.summary` + `unknown_cost_*` · บรรทัด "บิลไม่รู้ต้นทุน" ในรายงานเช้า (เมื่อ showProfit) |
| `packages/shared/src/index.ts` (แก้) | export `shiftDisplay` |
| `packages/shared/test/shiftDisplay.test.ts` · `packages/shared/test/discordDigestUnknownCost.test.ts` (ใหม่) | เทสต์บริสุทธิ์ |

### เว็บ (`apps/web/`) — lane B (web-developer)
| ไฟล์ | หน้าที่ |
|---|---|
| `apps/web/src/lib/apiScopes.ts` (แก้ · Task 8) | + `shift:write` |
| `apps/web/src/lib/posCashSettings.ts` · `apps/web/src/app/(staff)/settings/system/{page.tsx,actions.ts,PosCashSettingsSection.tsx}` (Task 8) | ค่าตั้ง "เพดานบิลนอกแคตตาล็อก" · "วันเริ่มใช้กะ" (เลื่อนได้เฉพาะเก่าลง) · "แจ้งเมื่อใบปิดกะรอบิลเกิน N ชม." |
| `apps/web/src/lib/backup.ts` · `scripts/restore.ts` (แก้ · Task 8) | ตารางใหม่ในไฟล์สำรอง/กู้คืน |
| `apps/web/src/lib/posAlerts.ts` (ใหม่ · Task 9) | `drainPosAlerts(shopId)` → `console.warn/error` |
| `apps/web/src/lib/api/shiftCash.ts` · `apps/web/src/app/api/v1/pos/shift-cash/route.ts` (ใหม่ · Task 9) | E4 |
| `apps/web/src/app/api/v1/pos/push/route.ts` (แก้ · Task 9) | ดึงแจ้งเตือนหลัง RPC |
| `apps/web/src/app/(staff)/sales/[order_no]/{offCatalog.ts,OrderDetailClient.tsx,actions.ts}` · `apps/web/src/app/(staff)/dashboard/OwnerDashboardClient.tsx` · `apps/web/src/lib/{dashboard,sales,profitView}.ts` · `apps/web/src/app/profit-view/DashboardClient.tsx` (Task 10) | บิลนอกแคตตาล็อก: ป้าย + รายการ + ผู้ปิด/เหตุผล + ต้นทุน "ไม่ทราบ" · การ์ดกำไรแสดง "บิลไม่รู้ต้นทุน" · ยกเลิกบนเว็บดึงแจ้งเตือน |
| `apps/web/src/lib/shifts.ts` · `apps/web/src/app/(staff)/dashboard/ShiftLines.tsx` · `apps/web/src/app/(staff)/shifts/[shift_id]/{page.tsx,ShiftDetailClient.tsx}` (Task 11) | บรรทัดกะบนแดชบอร์ด owner · หน้ารายละเอียดกะ (owner อ่านอย่างเดียว) · `today_mini` สถานะกะ |
| `apps/web/src/app/(staff)/dashboard/{page.tsx,StaffTodayClient.tsx}` (แก้ · Task 11) | ดึง `dashboard_shifts` · สถานะกะใน "ยอดวันนี้" |
| `apps/web/test/api.shiftCash.test.ts` · `apps/web/test/posAlerts.test.ts` · `apps/web/test/shifts.test.ts` · `apps/web/test/settings.posCash.test.ts` · `apps/web/test/offCatalogDisplay.test.ts` (ใหม่) | เทสต์ |

### บอท — lane D (bot-developer)
| ไฟล์ | หน้าที่ |
|---|---|
| `apps/line-bot/src/posAlerts.ts` (ใหม่ · Task 12) | `runPosAlertsCron`: `pos_alerts_scan` + `pos_alerts_take` → `console.warn/error` |
| `apps/line-bot/src/alerts.ts` (แก้ · Task 12) | `hourlyRun` เรียก `runPosAlertsCron` ทุกชั่วโมง · รายงานเช้าไม่ต้องแก้ (ส่ง `summary` ทั้งก้อนอยู่แล้ว) |
| `apps/line-bot/test/posAlertsCron.test.ts` (ใหม่) | เทสต์ |

### เอกสาร — architect (Task 0) / docs-writer (Task 13)
`docs/adr/0056-pos-shifts-cash-drawer.md` (เขียนใหม่จาก P3) · `docs/adr/0024-*.md` · `docs/adr/0049-*.md` · `docs/adr/README.md` · `docs/API.md` · `apps/web/openapi.yaml` · `docs/DATA-CONTRACT.md` · `docs/GLOSSARY.md` · `docs/OPERATIONS.md` · `docs/PLAN.md` · `docs/pos-integration/` (สำเนาอ้างอิง)

### fixture สัญญา
- **เจ้าของ = POS (D84 · สเปก §4.11 ข้อ 2)**: ชุดก้อน 3 อยู่ที่ `POS:packages/contracts/fixtures/dayo-api/*.json` (แผน 09 สร้าง) · dayo ไม่ import แพ็กเกจ POS · ⛔ เจ้าของคัดลอกไฟล์ก้อน 3 ที่แผน 09 สร้างมาไว้ที่ dayo `docs/pos-integration/fixtures/` เมื่อพร้อม แล้ว Task 14 Step 3 เล่นซ้ำกับฐานจริง (ต่างจากคำตอบจริง = แจ้งทีม POS แก้ fixture — สเปก §4.11)
- **parity สูตรเงินที่ควรมี**: fixture ของ POS (D84) — ⛔ เจ้าของคัดลอก `POS:packages/contracts/fixtures/parity/pos-shift-cash-parity.json` (แผน 09) มาไว้ที่ `packages/shared/test/db/fixtures/pos-shift-cash-parity.json` · รูปที่เทสต์ Task 4 อ่าน: `{cases:[{name, cash:{opening_float, pos_cash_sales, void_refunds, paid_in, paid_out, drops, drawer_expenses, bot_cash}, counted, expected, variance}]}` (บาท) · ไม่มีไฟล์ = เทสต์ส่วนนั้น SKIP แต่เคสในเทสต์เอง (รวมติดลบ) ต้องผ่าน · ชื่อ/รูปไฟล์นี้ตกลงกับแผน 09 แล้ว (คำวินิจฉัยผู้คุมงาน 26 ก.ย. 2569)

---

## ลำดับและงานขนาน

ข้อจำกัดของ repo dayo ที่กำหนดตาราง (เหมือนแผน 06)
1. **Supabase local มีได้ชุดเดียวต่อเครื่อง** → งานที่รันเทสต์ฐานข้อมูลอยู่ช่อง "Docker" ทีละงาน (lane A และงานเว็บ/บอทที่เทสต์กับฐานจริงต้องรอคิว Docker)
2. ขนานได้เฉพาะงานคนละ workspace และไม่รอ interface ของกัน → งานใน `apps/web` ต่อกันเป็นสายเดียว
3. ไม่เกิน 4 agent พร้อมกัน
4. แต่ละ lane ทำใน worktree/branch ของตัวเอง (`block3/db`, `block3/shared`, `block3/web`, `block3/bot`, `block3/docs`) · หัวหน้า merge ตามลำดับ db → shared → web → bot → docs · `packages/shared/src/database.types.ts` สร้างใหม่ได้เฉพาะ lane A · ชื่อ RPC/รูปผลลัพธ์ใน "Interfaces" ของแต่ละ task คือสัญญาภายในระหว่าง lane — lane B/C/D เขียนโค้ดจากชื่อในแผนได้ก่อน แต่รันเทสต์ที่แตะฐานจริงหลัง merge งาน lane A ที่ระบุใน "รอ"

| รอบ | lane A — `supabase/` (Docker ทีละงาน) | lane B — `apps/web` | lane C — `packages/shared/src` | lane D — `apps/line-bot` / `docs` |
|---|---|---|---|---|
| 0 | **Task 0** architect (opus) + ⛔ เจ้าของ — ทุก lane รอ | | | |
| 1 | Task 1 db-engineer (opus) | — | Task 7 shared-logic-engineer (sonnet) — ข้อยกเว้นใต้ตาราง (ไฟล์ไม่ทับ · `ci` เต็มหลัง merge Task 1) | — |
| 2 | Task 2 db-engineer (opus) | Task 8 web-developer (sonnet) — หลัง merge Task 1 | — | — |
| 3 | Task 3 db-engineer (opus) | Task 8 (ต่อ) | — | — |
| 4 | Task 4 db-engineer (opus) | — | — | — |
| 5 | Task 5 db-engineer (opus) | Task 9 web-developer (sonnet) — หลัง merge Task 4 · เทสต์ฐานจริงเข้าคิว Docker หลัง Task 5 | — | — |
| 6 | Task 6 db-engineer (opus) | Task 10 web-developer (sonnet) — หลัง merge Task 5 + 7 | — | Task 13 docs-writer (sonnet, low) เริ่มส่วน API/DATA-CONTRACT หลัง merge Task 4 |
| 7 | — | Task 11 web-developer (sonnet) — หลัง merge Task 6 + 7 | — | Task 12 bot-developer (sonnet) — หลัง merge Task 6 + 7 (Docker หลัง Task 11) |
| 8 | **Task 14** รวม: test-runner (haiku) → code-reviewer (sonnet) + security-reviewer (opus) | | | Task 13 (ต่อ) |
| 9 | **Task 15** ⛔ เจ้าของ + devops (sonnet): production + ส่งมอบให้ทีม POS | | | |

**ข้อยกเว้นของกติกาข้อ 2 (ระบุชัด):** Task 7 (lane C) ทำพร้อม lane A แม้อยู่ workspace `packages/shared` เดียวกัน เพราะไฟล์ไม่ทับกันเลย — Task 7 แตะเฉพาะ `packages/shared/src/{shiftDisplay,discordMessages,index}.ts` และ `packages/shared/test/{shiftDisplay,discordDigestUnknownCost}.test.ts` · lane A แตะเฉพาะ `packages/shared/test/db/**` และ `packages/shared/src/database.types.ts` · ระหว่างขนาน Task 7 รันเฉพาะเทสต์บริสุทธิ์ของตัวเอง + `npm run typecheck -w @dayo/shared` · **`npm run ci` เต็มของ Task 7 รันหลัง merge Task 1 เข้า branch รวมแล้วเท่านั้น** (merge ลำดับ db → shared) · ถ้าชนไฟล์ใดนอกรายการนี้ = หยุดขนาน ทำ Task 7 หลัง lane A

ไฟล์ที่มีเจ้าของคนเดียว: `packages/shared/test/db/block3Fixtures.ts` = Task 1 (task อื่นใน lane A เพิ่มฟังก์ชันได้หลัง Task 1 merge เท่านั้น — lane A เป็นสายเดียวจึงไม่ชน) · `packages/shared/src/database.types.ts` = lane A · `packages/shared/src/shiftDisplay.ts` = Task 7 · `apps/web/src/lib/posAlerts.ts` = Task 9

| Task | agent · โมเดล | รอ | ผลิต interface ที่คนอื่นใช้ |
|---|---|---|---|
| 0 | architect · opus + ⛔ | — | ADR-0056 (ยอมรับ) · ADR-0024 ข้อ 2 ใหม่ · คำตอบ Q72–Q74 · ค1–ค5 |
| 1 | db-engineer · opus | 0 | ตาราง 6 ตัว · คอลัมน์ `orders`/`shop_settings` · `dayo_pos_owner_active_at(uuid,uuid,timestamptz)→boolean` · `dayo_thai_short_date(date)→text` · `dayo_pos_alert(uuid,text,text,text,text)→boolean` · `dayo_z_expected(jsonb)→numeric` · `pos_alerts_take(uuid,integer)→jsonb` · `get_pos_cash_settings(uuid,uuid)→jsonb` · `save_pos_cash_settings(uuid,uuid,jsonb)→jsonb` · `block3Fixtures.ts` |
| 2 | db-engineer · opus | 1 | ชนิด `shift_open` `cash_movement` `cash_count` · `dayo_pos_dispatch(uuid,uuid,text,jsonb)→jsonb` · `dayo_pos_exists_verdict(orders,text)→jsonb` · `dayo_pos_verdict_s5(text,text,text,text)` |
| 3 | db-engineer · opus | 2 | ชนิด `order_off_catalog` |
| 4 | db-engineer · opus | 3 | ชนิด `shift_close` · `dayo_z_recompute(uuid)→text` · `api_shift_cash(uuid,uuid,text,text)→jsonb` · E1 `client.last_z_no`/`last_z_hash`/`last_z_until` |
| 5 | db-engineer · opus | 4 | `dashboard_summary.current.unknown_cost_*` · `get_order.off_catalog*` · `today_mini.shift_state` · E3 `off_catalog` · `daily_digest.summary.unknown_cost_*` |
| 6 | db-engineer · opus | 5 | `dashboard_shifts(uuid,uuid,date,date)→jsonb` · `get_shift_detail(uuid,uuid,uuid)→jsonb` · `pos_alerts_scan(uuid)→integer` · `export_rows(...,'shifts',...)` |
| 7 | shared-logic-engineer · sonnet | 0 | `shiftLineText` `shiftBadges` `varianceLabel` `waitingAgeHours` `unknownCostLine` · `DailyDigest.summary.unknown_cost_*` |
| 8 | web-developer · sonnet | 1 | หน้าตั้งค่า · `API_SCOPES` + `shift:write` · ไฟล์สำรอง |
| 9 | web-developer · sonnet | 4 (ชื่อ `pos_alerts_take` จาก Task 1) | E4 route · `drainPosAlerts` |
| 10 | web-developer · sonnet | 5, 7, 9 | หน้าบิล/แดชบอร์ดกับบิลไม่รู้ต้นทุน |
| 11 | web-developer · sonnet | 6, 7, 10 | บรรทัดกะ · `/shifts/[shift_id]` |
| 12 | bot-developer · sonnet | 6, 7 | cron แจ้งเตือน · รายงานเช้า |
| 13 | docs-writer · sonnet (low) | 4 (ส่วน API) · 11 (ส่วนเว็บ) | เอกสาร |
| 14 | test-runner · haiku / code-reviewer · sonnet / security-reviewer · opus | ทุก task | ผลตรวจ |
| 15 | ⛔ เจ้าของ + devops · sonnet | 14 | production · ส่งมอบให้ทีม POS |

---

## Task 0: รับ P3 เป็น ADR-0056 และแก้ ADR-0024 ข้อ 2 (ก่อนเขียนโค้ดใด ๆ) — ⛔ gated

ADR ที่ยอมรับแล้วห้ามเปลี่ยนเงียบ ๆ (กฎเหล็กข้อ 1 ของ dayo) → session ของ dayo ทำกับเจ้าของ · **แผนนี้ไม่เขียนเนื้อ ADR** (architect ของ dayo เขียนจาก P3)

**agent:** architect ของ dayo (opus) · หัวหน้าทีมสรุปให้เจ้าของ · ⛔ เจ้าของอนุมัติ

**Files:**
- Modify: `docs/adr/0056-pos-shifts-cash-drawer.md` (เขียนใหม่ทั้งฉบับจาก P3 · สถานะ "เลื่อน" → "เสนอ" → "ยอมรับ") · `docs/adr/0024-confirmed-operating-assumptions.md` (ข้อ 2 + บรรทัดสถานะ) · `docs/adr/0049-pos-push-row-verdicts.md` (บรรทัดสถานะ: ข้อ 3 ขั้น (ก0) แทนโดย ADR-0056 ข้อ 5) · `docs/adr/0035-*.md` (บรรทัดสถานะ: ขยายโดย ADR-0056) · `docs/adr/README.md`
- Create: `docs/pos-integration/` (สำเนาอ้างอิง อ่านอย่างเดียว)

**Interfaces:**
- Consumes: POS `docs/design/04-*` · `docs/design/dayo-adr-drafts/P3-shift-cash-z-report.md` · `docs/design/00-บันทึกการตัดสินใจ.md` D84–D102
- Produces: ADR-0056 สถานะ "ยอมรับ" (ทุก task อ้างเลขนี้) · คำตอบเจ้าของ Q72/Q73/Q74 และคำถามเปิด ค1–ค5 ของ P3 (บันทึกใน ADR-0056)

- [ ] **Step 1: ⛔ เจ้าของวางสำเนา** — คัดลอก POS `docs/design/04-สเปกการเชื่อม-POS-กับ-dayo.md`, `docs/design/dayo-adr-drafts/P3-shift-cash-z-report.md`, `docs/design/00-บันทึกการตัดสินใจ.md` และแผนนี้ ไปไว้ที่ dayo `docs/pos-integration/`

- [ ] **Step 1b: หัวหน้าทีม dayo ตรวจเลข migration ที่ว่าง** — `git fetch --all && git ls-tree -r --name-only main supabase/migrations | tail -5` และ `git for-each-ref --format='%(refname:short)' refs/heads refs/remotes | xargs -I{} git ls-tree -r --name-only {} supabase/migrations | sort -u | tail -10` · ตอนเขียนแผน: main จบที่ `0054` แต่ branch `import-replace-all` (667cc74) มี `0061_import_replace_all.sql` รอ `db:push` · กติกา: **เลขของแผนนี้ต้องมากกว่าเลขสูงสุดที่จะขึ้น production ก่อน** — **อัปเดต 28 ก.ย. 2569: `0062` และ `0063` ถูกงานอื่นของ dayo ใช้แล้ว → ก้อน 3 เริ่มที่ `0064`** ให้ **เปลี่ยนเลขทั้งแผนเป็น `0064`–`0069`** (0055→0064 … 0060→0069 · ทั้งชื่อไฟล์ คอมเมนต์ `git add` และการอ้างใน Task 1–6/13–15 · เนื้อ SQL ไม่เปลี่ยน) · `0061`–`0063` ต้องขึ้น production ก่อนเสมอ (เลขก้อน 3 อยู่หลังเลขเหล่านี้ทุกกรณี) — ตรวจด้วย `supabase migration list` ก่อน `db:push` ของก้อน 3 ทุกครั้ง · บันทึกผลเลขที่ใช้จริงใน ADR-0056 · (supabase ไล่ migration ตามชื่อไฟล์ — เลขต่ำกว่าที่ขึ้นแล้วจะถูกข้าม/ล้ม)

- [ ] **Step 2: architect ตรวจ P3 กับโค้ดจริง** — อ่าน CLAUDE.md, ADR 0024/0035/0040/0044/0048–0051/0053/0055/0056, `supabase/migrations/0049`–`0054`, DATA-CONTRACT §2–§4 §8 · ตรวจว่า (ก) P3 ขัด ADR ใดที่ไม่ได้ระบุ (ข) ชื่อตาราง/ฟังก์ชันตรงกับ migration จริง · **จุดตีความของแผนนี้ต้องอยู่ใน ADR-0056 ด้วย**: ทุกข้อในหัวข้อ "จุดตีความจากสเปก" ท้ายแผน · ถ้า architect ไม่เห็นด้วยกับข้อใด = เปลี่ยนสัญญา → หยุด แจ้งทีม POS ผ่านเจ้าของ

- [ ] **Step 3: เขียน ADR-0056 ใหม่** ตามแบบ ADR ของ dayo (สถานะ บริบท ตัดสินใจ ทางเลือกที่ไม่เลือก ผลที่ตามมา) เนื้อหา = P3 ข้อ 1–13 + จุดตีความ · สถานะ "เสนอ" · ข้อความ ADR-0024 ข้อ 2 ใหม่ = ข้อความเสนอใน P3 "สิ่งที่ dayo ต้องตัดสิน/เปลี่ยน" ข้อ 2 ตรงตัว

- [ ] **Step 4: เสนอศัพท์ใหม่ใน GLOSSARY** (ร่างให้ Task 13): กะ · ใบปิดกะ (Z) · เงินสดที่ควรมี · ส่วนต่าง (ขาด/เกิน) · เงินเข้า-ออกลิ้นชัก (`PAID_IN` `PAID_OUT` `DROP` `VOID_REFUND`) · นับเงิน · บิลนอกแคตตาล็อก · บิลไม่รู้ต้นทุน · เจ้าของแก้บิลหลังขาย · คิดใบปิดกะซ้ำ (`waiting_bills` "รอบิลมาครบ" / `matched` "ตรง" / `mismatch` "ไม่ตรง") · โซ่ Z · Z ขาดช่วง · ข้อมูลกะชนกัน · กะซ้อนกัน · วันเริ่มใช้กะ (`block3_live_from`)

- [ ] **Step 5: หัวหน้าสรุปให้เจ้าของ** (ไทย ≤ 30 บรรทัด) พร้อมคำถาม (มีเลขข้อ + คำตอบที่แนะนำ):
  1. รับ ADR-0056 ตาม P3 — แนะนำ: รับ
  2. แก้ ADR-0024 ข้อ 2 ตามข้อความใน P3 — แนะนำ: รับ
  3. Q72 เพดานต่อบิลนอกแคตตาล็อก — แนะนำ: ฿3,000 (แก้บนเว็บได้)
  4. Q73 ข้อความ Discord ไม่มียอดเงิน — แนะนำ: ไม่มียอดเงิน
  5. Q74 แจ้งเมื่อใบปิดกะรอบิลเกิน 48 ชม. (ขัด D98) — ค่าเริ่มต้นของแผน: แจ้ง 🟡 ครั้งเดียว ปิดได้ที่หน้าตั้งค่า · ตอบ "ไม่แจ้ง" = ค่าเริ่มต้น `null`
  6. ค2 บิลนอกแคตตาล็อกบนเว็บ — แนะนำ: ยกเลิกได้ แก้รายการไม่ได้ (`DY422`)
  7. ค3 ระดับข้อความ — แนะนำ: ขาด/เกิน 🟡 · `mismatch` 🔴 · ข้อมูลชนกัน 🔴 · (หมายเหตุ ไม่ใช่คำถาม: **ไม่ใส่ `@here`** — ผู้คุมงานยืนยันแล้ว คง ADR-0044 ข้อ 8)
  8. ค1/ค4/ค5 — แนะนำตาม P3 (`audit_log` action `order_off_catalog` · คิวแจ้งเตือน · `/shifts/[shift_id]`)
  9. ADR-0051 (สำรองอัตโนมัติ) — แนะนำ: ยกเลิกการเลื่อนตาม D95 แล้วทำตามแผน 06 Task 14/17 เป็นงานแยก

- [ ] **Step 6: ⛔ เจ้าของอนุมัติ** → architect เปลี่ยนสถานะ ADR-0056 เป็น "ยอมรับ" · แก้บรรทัดสถานะ:
  - 0024: "ข้อ 2 แก้โดย ADR-0056 (กะ/นับเงิน/ใบปิดกะมีเฉพาะที่แท็บเล็ต)"
  - 0035: "ขยายโดย ADR-0056 (POS เป็นเครื่องมือเรื่องเงิน: กะ/เงินสด/ใบปิดกะ)"
  - 0049: "ข้อ 3 ขั้น (ก0) แทนโดย ADR-0056 ข้อ 5 (บิลนอกแคตตาล็อก)"
  - อัปเดต `docs/adr/README.md`
  - ถ้าคำตอบข้อ 5 = "ไม่แจ้ง" → แก้ Task 1 Step 3 บรรทัด `shift_waiting_alert_hours` เป็น `default null` ก่อนเริ่ม Task 1
  - ถ้าเจ้าของ/architect ต้องการเปลี่ยนสัญญา §4.10 ก้อน 3 → **หยุดทั้งแผน** แจ้งทีม POS

- [ ] **Step 7: Commit** (เมื่อเจ้าของสั่ง · ใช้ skill `committing-code`)
```bash
git add docs/adr/0056-pos-shifts-cash-drawer.md docs/adr/0024-confirmed-operating-assumptions.md docs/adr/0035-pos-is-separate-system-with-api.md docs/adr/0049-pos-push-row-verdicts.md docs/adr/README.md docs/pos-integration/
git commit -m "docs(adr): accept pos shifts, cash drawer and z report decisions"
```

---

## Task 1: โครงข้อมูลก้อน 3 (migration 0055)

**agent:** db-engineer · opus · high (lane A · ใช้ Docker)

**Files:**
- Create: `supabase/migrations/0055_block3_schema.sql`
- Create: `packages/shared/test/db/block3Fixtures.ts`, `packages/shared/test/db/block3_schema.db.test.ts`
- Modify: `packages/shared/src/database.types.ts` (สร้างใหม่ด้วย `npm run db:types`)

**Interfaces:**
- Consumes: `dayo_restoring()` (0050) · `dayo_append_only()` (0004) · `dayo_require_staff()` (0005) · `dayo_patch_int()` (0047) · `dayo_pos_is_money()` `dayo_pos_date()` (0052) · `backup_dump_table` รุ่นล่าสุด (0054:857)
- Produces:
  - ตาราง `shifts` `cash_movements` `cash_counts` `z_reports` `pos_push_rejections` `pos_alerts` (คอลัมน์ตาม Step 3) · unique index `orders_shop_pos_order_key (shop_id, pos_order_id)` · `orders.off_catalog boolean` `orders.off_catalog_lines jsonb` · `shop_settings.block3_live_from date` `off_catalog_max_total numeric(10,2)` `shift_waiting_alert_hours integer`
  - GUC ภายใน `dayo.shift_writer` ∈ `'push' | 'recompute' | 'alert' | 'conflict'` — ตั้งด้วย `set_config(…, true)` รอบคำสั่งที่เขียนแล้วคืน `''` ทันที · `dayo_shift_writer() → text`
  - `dayo_pos_owner_active_at(p_shop_id uuid, p_staff_id uuid, p_at timestamptz) → boolean`
  - `dayo_thai_short_date(p_day date) → text` (`'25 ก.ย.'`)
  - `dayo_pos_alert(p_shop_id uuid, p_level text, p_kind text, p_dedupe text, p_message text) → boolean` (true = แถวใหม่)
  - `dayo_z_expected(p_cash jsonb) → numeric`
  - `pos_alerts_take(p_shop_id uuid, p_limit integer default 5) → jsonb` = `[{level:'error'|'warning', kind, text}]` (บิลนอกแคตตาล็อกรวมเป็นข้อความเดียว · ตั้ง `sent_at`)
  - `get_pos_cash_settings(p_shop_id uuid, p_staff_id uuid) → jsonb` = `{block3_live_from, off_catalog_max_total, shift_waiting_alert_hours}` (owner)
  - `save_pos_cash_settings(p_shop_id uuid, p_staff_id uuid, p_patch jsonb) → jsonb` (owner · คืนแบบ get)
  - `block3Fixtures.ts`: `T` `MIN` `DENOMS` `POS_SCOPES` `bkkDateOf` `ago` `hex64` `nextReceipt` `block3Catalog` `backdateOwner` `setupBlock3Shop` `mkClient` `pusher` `shiftOpenRow` `movementRow` `countRow` `orderRow` `offCatalogRow` `shiftCloseRow` `posBillOf` `ZParts`

- [ ] **Step 1: ตัวช่วยเทสต์** — `packages/shared/test/db/block3Fixtures.ts`

```ts
// block3Fixtures.ts — ตัวช่วยเทสต์ก้อน 3 (ADR-0056 · สเปก POS §4.10 ก้อน 3) · เจ้าของไฟล์: Task 1 (lane A เท่านั้นที่แก้)
import { createHash, randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { Db, TestShop } from "./helpers.js";

export interface RowResult { key: string | null; status: string; reason?: string; detail?: string; data?: Record<string, unknown> }
interface PushEnvelope { ok: boolean; data: { server_time: string; results: RowResult[] } }
export interface PushRow { key: string; kind: string; data: Record<string, unknown> }

export const T = 120_000;
export const MIN = 60_000;
export const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;
export const POS_SCOPES = ["catalog:read", "staff:read", "orders:read", "orders:write", "shift:write"];
export const bkkDateOf = (d: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(d));
export const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
export const hex64 = (s: string) => createHash("sha256").update(s).digest("hex");

let receiptSeq = 100_000 + Math.floor(Math.random() * 800_000);
export const nextReceipt = () => `A-${String(++receiptSeq).padStart(6, "0")}`;

/** แคตตาล็อกขั้นต่ำ: Thai Tea 16 oz ฿35 · ช่องทาง store (ค่าธรรมเนียม 0) / grab (30%) · วิธีชำระ cash/qr */
export function block3Catalog() {
  const ing = (code: string, name: string, pack: number, price: number) => ({
    code, name, type: "วัตถุดิบ", subcategory: null, useUnit: "ml", buyUnit: "แพ็ก",
    packToUseFactor: pack, buyPrice: price, reorderPoint: null, note: null, sortOrder: 0, isActive: true,
  });
  return {
    ingredients: [ing("RM-TEA", "ใบชา", 1000, 60), ing("RM-MILK", "นมสด", 1000, 50)],
    bases: [{
      code: "BASE-THAI", name: "ชาไทยเบส", yieldQty: 1000, yieldUnit: "ml", instructions: [], safetyNote: null, shelfLifeHours: null,
      sortOrder: 0, isActive: true, lines: [{ ingredientCode: "RM-TEA", qty: 1000, sortOrder: 0 }],
    }],
    menus: [{ code: "Thai Tea", nameTh: "ชาไทย", family: "ชาไทย", categoryLabel: "ชาไทย", allowOatMilk: false, isMatcha: false, aliases: [], sortOrder: 1, isActive: true }],
    variants: [{ menuCode: "Thai Tea", size: "16 oz", sweetness: "100%", price: 35, note: null, isActive: true }],
    recipeLines: [
      { menuCode: "Thai Tea", size: "16 oz", sweetness: "100%", lineNo: 1, ingredientCode: null, baseCode: "BASE-THAI", qty: 120, unit: "ml" },
      { menuCode: "Thai Tea", size: "16 oz", sweetness: "100%", lineNo: 2, ingredientCode: "RM-MILK", baseCode: null, qty: 60, unit: "ml" },
    ],
    options: [{ kind: "milk", code: "fresh", label: "นมสด", aliases: ["นมสด"], ingredientCode: "RM-MILK", priceAdd: 0, multiplier: null, isDefault: true, note: null, sortOrder: 0, isActive: true }],
    sops: [], sections: [], stockCounts: [], channels: [],
    paymentMethods: [
      { code: "cash", name: "เงินสด", aliases: [], sortOrder: 0, isActive: true },
      { code: "qr", name: "QR", aliases: [], sortOrder: 1, isActive: true },
    ],
    salesChannels: [
      { code: "store", name: "หน้าร้าน", aliases: [], priceMarkupPct: 0, priceAddBaht: 0, rounding: "none", feePct: 0, defaultPaymentMethodCode: "cash", sortOrder: 0, isActive: true },
      { code: "grab", name: "Grab", aliases: [], priceMarkupPct: 0, priceAddBaht: 0, rounding: "none", feePct: 0.3, defaultPaymentMethodCode: "qr", sortOrder: 1, isActive: true },
    ],
    promotions: [],
  };
}

/**
 * owner ของร้านทดสอบ "เป็น owner active มาแล้ว 90 วัน" — dayo_pos_owner_active_at อ่านสถานะ ณ เวลาในแถวจากประวัติ staff (audit_log)
 * ร้านทดสอบเพิ่งถูกสร้าง จึงแทรกประวัติย้อนเวลา 1 แถว (audit_log รับ insert · แก้/ลบไม่ได้) — ทำในเทสต์เท่านั้น
 */
export async function backdateOwner(svc: Db, shop: TestShop): Promise<void> {
  await svc.insert("audit_log", {
    shop_id: shop.shopId, entity: "staff", entity_id: shop.ownerId, action: "insert", before: null,
    after: { id: shop.ownerId, role: "owner", status: "active" }, at: ago(90 * 24 * 60 * MIN),
  });
}

export async function setupBlock3Shop(svc: Db, shop: TestShop): Promise<void> {
  const imp = await svc.rpc<{ ok: boolean }>("import_catalog", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_payload: block3Catalog(), p_mode: "replace" });
  expect(imp.ok).toBe(true);
  await backdateOwner(svc, shop);
}

export async function mkClient(svc: Db, shopId: string, scopes: string[] = POS_SCOPES): Promise<string> {
  const key = `dayo_${randomUUID().replace(/-/g, "")}`;
  const [c] = await svc.insert<{ id: string }>("api_clients", {
    shop_id: shopId, name: `pos-${key.slice(5, 11)}`, key_hash: createHash("sha256").update(key).digest("hex"), key_prefix: key.slice(0, 8), scopes,
  });
  return c!.id;
}

/** ส่งแถวผ่าน api_pos_push จริง (สิทธิ์จาก key — p_scopes null) คืนคำตัดสินเรียงตามแถว */
export function pusher(svc: Db, shopId: string) {
  return async (rows: PushRow[], clientId: string): Promise<RowResult[]> =>
    (await svc.rpc<PushEnvelope>("api_pos_push", {
      p_shop_id: shopId, p_api_client_id: clientId, p_scopes: null,
      p_body: JSON.stringify({ device_time: new Date().toISOString(), rows }),
    })).data.results;
}

export function shiftOpenRow(shop: TestShop, over: Record<string, unknown> = {}, id: string = randomUUID()): PushRow {
  const openedAt = (over.opened_at as string | undefined) ?? ago(60 * MIN);
  return {
    key: `shift_open:${id}`, kind: "shift_open",
    data: { shift_id: id, business_date: bkkDateOf(openedAt), opened_at: openedAt, opened_by: shop.staffId, opening_float: 500, quick_open: false, ...over },
  };
}

export function movementRow(shiftId: string, shop: TestShop, over: Record<string, unknown> = {}, id: string = randomUUID()): PushRow {
  return {
    key: `cash_movement:${id}`, kind: "cash_movement",
    data: { movement_id: id, shift_id: shiftId, kind: "PAID_IN", amount: 100, pos_order_id: null, reason: "แลกเหรียญ", created_by: shop.staffId, created_at: ago(30 * MIN), ...over },
  };
}

/** นับเงิน 9 ชนิด (ไม่ระบุ = 0) · counted คิดจาก lines */
export function countRow(shiftId: string, shop: TestShop, counts: Partial<Record<number, number>>, over: Record<string, unknown> = {}, id: string = randomUUID()): PushRow {
  const lines = DENOMS.map((d) => ({ denomination: d, count: counts[d] ?? 0 }));
  const counted = lines.reduce((s, l) => s + l.denomination * l.count, 0);
  return {
    key: `cash_count:${id}`, kind: "cash_count",
    data: { count_id: id, shift_id: shiftId, lines, counted, counted_by: shop.staffId, counted_at: ago(5 * MIN), ...over },
  };
}

export function orderRow(shop: TestShop, over: Record<string, unknown> = {}, id: string = randomUUID()): PushRow {
  const soldAt = (over.sold_at as string | undefined) ?? ago(20 * MIN);
  return {
    key: `order:${id}`, kind: "order",
    data: {
      pos_order_id: id, receipt_no: nextReceipt(), queue_no: 1, sale_date: bkkDateOf(soldAt), sold_at: soldAt,
      channel: "store", payment: "cash", staff_id: shop.staffId, catalog_version: 1, shift_id: null,
      lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "100%", milk: "fresh", grade: null, qty: 1 }],
      bill_discount: null, promo_code: null, skip_promotion_ids: [], no_promotions: true,
      totals: { items_subtotal: 35, items_discount: 0, bill_discount: 0, total: 35 }, note: null, ...over,
    },
  };
}

/** บิลนอกแคตตาล็อก: 2 แก้ว × ฿40 ลดแก้วละ ฿5 = ฿70 · ปิดโดย owner */
export function offCatalogRow(shop: TestShop, over: Record<string, unknown> = {}, id: string = randomUUID()): PushRow {
  const soldAt = (over.sold_at as string | undefined) ?? ago(20 * MIN);
  return {
    key: `order_off_catalog:${id}`, kind: "order_off_catalog",
    data: {
      pos_order_id: id, receipt_no: nextReceipt(), queue_no: 2, sale_date: bkkDateOf(soldAt), sold_at: soldAt,
      channel: "store", payment: "cash", staff_id: shop.staffId, catalog_version: 1, shift_id: null, note: null,
      lines: [{ code: "OLD-1", name: "ชาไทยสูตรเก่า", size: "16 oz", sweetness: "100%", qty: 2, unit_price: 40, discount_per_cup: 5, line_total: 70 }],
      totals: { items_subtotal: 80, items_discount: 10, bill_discount: 0, total: 70 },
      // closed_at = ตอนนี้: owner ของร้านทดสอบเพิ่งถูกสร้าง (dayo_pos_owner_active_at ดูประวัติ staff — เวลาก่อนสร้าง = ยังไม่มีคนนี้)
      closed_by: shop.ownerId, closed_at: new Date().toISOString(), reason: "เมนูถูกลบจากระบบกลาง", original_reason: "UNKNOWN_CODE", ...over,
    },
  };
}

export interface ZParts {
  zNo: number;
  hash?: string;
  prevHash?: string | null;
  chainWarning?: boolean;
  varianceAlert?: number;
  cash: { opening_float: number; pos_cash_sales: number; void_refunds: number; paid_in: number; paid_out: number; drops: number; drawer_expenses?: number; bot_cash: number };
  counted: number;
  after: string;
  until: string;
  movementIds: string[];
  botBills?: Array<{ order_no: string; version: number; total: number }>;
  posBills: Array<{ pos_order_id: string; receipt_no: string; payment: string; total: number; sold_at: string; voided_at: string | null }>;
}

export function shiftCloseRow(shop: TestShop, shiftId: string, countId: string, z: ZParts, over: Record<string, unknown> = {}): PushRow {
  return {
    key: `shift_close:${shiftId}`, kind: "shift_close",
    data: {
      shift_id: shiftId, count_id: countId, closed_by: shop.ownerId, closed_at: new Date().toISOString(), variance_reason: null,
      z_report: {
        z_no: z.zNo, hash: z.hash ?? hex64(`z${z.zNo}:${shiftId}`), prev_hash: z.prevHash ?? null, chain_warning: z.chainWarning ?? false,
        variance_alert: z.varianceAlert ?? 20, cash: { drawer_expenses: 0, ...z.cash }, counted: z.counted,
        bot_window: { after: z.after, until: z.until }, movement_ids: z.movementIds, bot_bills: z.botBills ?? [], pos_bills: z.posBills,
      },
      ...over,
    },
  };
}

/** แถว pos_bills ของ z_report จากแถว order/order_off_catalog ที่ส่ง */
export const posBillOf = (row: PushRow, voidedAt: string | null = null) => ({
  pos_order_id: row.data.pos_order_id as string, receipt_no: row.data.receipt_no as string, payment: row.data.payment as string,
  total: (row.data.totals as { total: number }).total, sold_at: row.data.sold_at as string, voided_at: voidedAt,
});
```

- [ ] **Step 2: เทสต์ที่ต้องตก** — `packages/shared/test/db/block3_schema.db.test.ts`

```ts
// block3_schema.db.test.ts — migration 0055 (ADR-0056 · สเปก POS §4.10 ก้อน 3 ตาราง/คอลัมน์)
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { connectLocalSupabase, createTestShop, Db, expectDbError, localSql } from "./helpers.js";
import type { TestShop } from "./helpers.js";
import { T, ago, bkkDateOf, hex64, mkClient, nextReceipt, orderRow, pusher, setupBlock3Shop } from "./block3Fixtures.js";

const sb = await connectLocalSupabase();

describe.skipIf(!sb)("0055 ก้อน 3 — โครงข้อมูล", () => {
  let svc: Db;
  let shop: TestShop;
  let client: string;
  let push: ReturnType<typeof pusher>;

  beforeAll(async () => {
    svc = Db.service(sb!);
    shop = await createTestShop(svc, "b3-schema");
    await setupBlock3Shop(svc, shop);
    client = await mkClient(svc, shop.shopId);
    push = pusher(svc, shop.shopId);
  }, T);

  const insertShift = async (over: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await svc.insert("shifts", { id, shop_id: shop.shopId, api_client_id: client, business_date: bkkDateOf(new Date()), opened_by: shop.staffId,
      opened_at: ago(60_000), opening_float: 500, quick_open: false, ...over });
    return id;
  };

  it("unique บิล POS = (shop_id, pos_order_id): key อื่นส่ง pos_order_id เดิมไม่เกิดบิลที่สอง", async () => {
    const other = await mkClient(svc, shop.shopId);
    const row = orderRow(shop);
    expect((await push([row], client))[0]!.status).toBe("accepted");
    const again = { ...row, data: { ...row.data, receipt_no: nextReceipt() } };
    const r = (await push([again], other))[0]!;
    expect([r.status, r.reason]).toEqual(["rejected", "CONFLICT"]);
    expect(await svc.select("orders", `shop_id=eq.${shop.shopId}&pos_order_id=eq.${row.data.pos_order_id}&select=id`)).toHaveLength(1);
  }, T);

  it("บิล POS ใหม่มีคีย์ payment ใน pos_reported_amounts · pos_shift_id/external_ref แช่แข็ง (DY423)", async () => {
    const row = orderRow(shop, { payment: "qr" });
    await push([row], client);
    const [o] = await svc.select<{ id: string; pos_reported_amounts: Record<string, unknown> }>("orders", `pos_order_id=eq.${row.data.pos_order_id}&select=id,pos_reported_amounts`);
    expect(o!.pos_reported_amounts).toEqual({ items_subtotal: 35, items_discount: 0, bill_discount: 0, total: 35, payment: "qr" });
    expect((await expectDbError(svc.update("orders", `id=eq.${o!.id}`, { pos_shift_id: randomUUID() }))).code).toBe("DY423");
    expect((await expectDbError(svc.update("orders", `id=eq.${o!.id}`, { external_ref: "A-999999" }))).code).toBe("DY423");
  }, T);

  it("cost_total เป็น null ได้เฉพาะบิลนอกแคตตาล็อก (23514) · ธง off_catalog แก้ไม่ได้ (DY423)", async () => {
    const row = orderRow(shop);
    await push([row], client);
    const [o] = await svc.select<{ id: string }>("orders", `pos_order_id=eq.${row.data.pos_order_id}&select=id`);
    expect((await expectDbError(svc.update("orders", `id=eq.${o!.id}`, { cost_total: null }))).code).toBe("23514");
    expect((await expectDbError(svc.update("orders", `id=eq.${o!.id}`, { off_catalog: true, cost_total: null, off_catalog_lines: [] }))).code).toBe("DY423");
  }, T);

  it("scope shift:write รับได้ · scope ผิดรูป = DY422", async () => {
    await svc.rpc("dayo_check_api_scopes", { p_scopes: ["shift:write"] });
    expect((await expectDbError(svc.rpc("dayo_check_api_scopes", { p_scopes: ["shift:writ"] }))).code).toBe("DY422");
  }, T);

  it("shifts: แก้คอลัมน์ข้อมูล/สถานะตรง ๆ ไม่ได้ · ลบไม่ได้ (DY423)", async () => {
    const id = await insertShift();
    expect((await expectDbError(svc.update("shifts", `id=eq.${id}`, { opening_float: 0 }))).code).toBe("DY423");
    expect((await expectDbError(svc.update("shifts", `id=eq.${id}`, { status: "closed" }))).code).toBe("DY423");
    expect((await expectDbError(svc.update("shifts", `id=eq.${id}`, { data_conflict: true }))).code).toBe("DY423");
    expect((await expectDbError(svc.delete("shifts", `id=eq.${id}`))).code).toBe("DY423");
  }, T);

  it("cash_movements: VOID_REFUND ต้องมี pos_order_id และชนิดอื่นห้ามมี (23514) · append-only", async () => {
    const shiftId = await insertShift();
    const base = { shop_id: shop.shopId, api_client_id: client, shift_id: shiftId, amount: 10, created_by: shop.staffId, created_at: ago(1000) };
    expect((await expectDbError(svc.insert("cash_movements", { id: randomUUID(), ...base, kind: "PAID_IN", reason: "x", pos_order_id: randomUUID() }))).code).toBe("23514");
    expect((await expectDbError(svc.insert("cash_movements", { id: randomUUID(), ...base, kind: "VOID_REFUND", reason: null, pos_order_id: null }))).code).toBe("23514");
    expect((await expectDbError(svc.insert("cash_movements", { id: randomUUID(), ...base, kind: "PAID_OUT", reason: null, pos_order_id: null }))).code).toBe("23514");
    const id = randomUUID();
    await svc.insert("cash_movements", { id, ...base, kind: "DROP", reason: "ฝากเงิน", pos_order_id: null });
    expect((await expectDbError(svc.update("cash_movements", `id=eq.${id}`, { amount: 20 }))).code).toBe("DY423");
  }, T);

  it("cash_counts: กะละหนึ่งการนับ (23505 cash_counts_shift_key) · z_reports แก้ตรง ๆ ไม่ได้", async () => {
    const shiftId = await insertShift();
    const lines = [1000, 500, 100, 50, 20, 10, 5, 2, 1].map((d) => ({ denomination: d, count: 0 }));
    const cc = { shop_id: shop.shopId, api_client_id: client, shift_id: shiftId, lines, counted: 0, counted_by: shop.staffId, counted_at: ago(500) };
    await svc.insert("cash_counts", { id: randomUUID(), ...cc });
    expect((await expectDbError(svc.insert("cash_counts", { id: randomUUID(), ...cc }))).code).toBe("23505");
    await svc.insert("z_reports", {
      shift_id: shiftId, shop_id: shop.shopId, api_client_id: client, z_no: 1, hash: hex64("z1"), prev_hash: null, chain_warning: false, first_of_key: true,
      snapshot: {}, expected: 0, counted: 0, variance: 0, variance_reason: null, variance_alert: 20,
    });
    expect((await expectDbError(svc.update("z_reports", `shift_id=eq.${shiftId}`, { recompute_status: "matched" }))).code).toBe("DY423");
    expect((await expectDbError(svc.update("z_reports", `shift_id=eq.${shiftId}`, { counted: 5 }))).code).toBe("DY423");
  }, T);

  it("block3_live_from: owner ตั้งจากว่างไม่ได้ · ตัวรับ push ตั้งได้ · owner เลื่อนเก่าลงได้ · ไปข้างหน้า/ล้าง = DY422 · มี audit_log", async () => {
    await svc.rpc("save_pos_cash_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: {} });
    expect((await expectDbError(svc.rpc("save_pos_cash_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { block3_live_from: "2026-09-20" } }))).code).toBe("DY422");
    localSql(`do $$ begin perform set_config('dayo.shift_writer', 'push', true); update public.shop_settings set block3_live_from = '2026-09-20' where shop_id = '${shop.shopId}'; end $$;`);
    const s = await svc.rpc<{ block3_live_from: string }>("save_pos_cash_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { block3_live_from: "2026-09-10" } });
    expect(s.block3_live_from).toBe("2026-09-10");
    for (const bad of ["2026-09-11", null]) {
      expect((await expectDbError(svc.rpc("save_pos_cash_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { block3_live_from: bad } }))).code).toBe("DY422");
    }
    const audits = await svc.select<{ after: { block3_live_from: string } }>("audit_log", `shop_id=eq.${shop.shopId}&entity=eq.shop_settings&select=after&order=at.desc&limit=1`);
    expect(audits[0]!.after.block3_live_from).toBe("2026-09-10");
  }, T);

  it("ค่าเริ่มต้น: off_catalog_max_total 3000 (รอ Q72) · shift_waiting_alert_hours 48 (รอ Q74) · manager = DY403", async () => {
    const fresh = await createTestShop(svc, "b3-settings");
    const g = await svc.rpc<Record<string, unknown>>("get_pos_cash_settings", { p_shop_id: fresh.shopId, p_staff_id: fresh.ownerId });
    expect(g).toEqual({ block3_live_from: null, off_catalog_max_total: 3000, shift_waiting_alert_hours: 48 });
    expect((await expectDbError(svc.rpc("get_pos_cash_settings", { p_shop_id: fresh.shopId, p_staff_id: fresh.managerId }))).code).toBe("DY403");
    expect((await expectDbError(svc.rpc("save_pos_cash_settings", { p_shop_id: fresh.shopId, p_staff_id: fresh.managerId, p_patch: { off_catalog_max_total: 1 } }))).code).toBe("DY403");
    const s = await svc.rpc<Record<string, unknown>>("save_pos_cash_settings", { p_shop_id: fresh.shopId, p_staff_id: fresh.ownerId, p_patch: { off_catalog_max_total: 4500.5, shift_waiting_alert_hours: null } });
    expect(s).toMatchObject({ off_catalog_max_total: 4500.5, shift_waiting_alert_hours: null });
    expect((await expectDbError(svc.rpc("save_pos_cash_settings", { p_shop_id: fresh.shopId, p_staff_id: fresh.ownerId, p_patch: { off_catalog_max_total: 1.234 } }))).code).toBe("DY422");
    expect((await expectDbError(svc.rpc("save_pos_cash_settings", { p_shop_id: fresh.shopId, p_staff_id: fresh.ownerId, p_patch: { foo: 1 } }))).code).toBe("DY422");
  }, T);

  it("dayo_pos_owner_active_at: ใช้สถานะ ณ เวลานั้นจากประวัติ staff", async () => {
    const id = randomUUID();
    await svc.insert("staff", { id, shop_id: shop.shopId, line_user_id: `U${randomUUID().replace(/-/g, "")}`, display_name: "owner2", role: "owner", status: "active" });
    await svc.update("staff", `id=eq.${id}`, { status: "removed" });
    const rows = await svc.select<{ at: string; action: string }>("audit_log", `entity=eq.staff&entity_id=eq.${id}&select=at,action&order=at`);
    const insertedAt = Date.parse(rows[0]!.at);
    const removedAt = Date.parse(rows[1]!.at);
    const at = (ms: number) => svc.rpc<boolean>("dayo_pos_owner_active_at", { p_shop_id: shop.shopId, p_staff_id: id, p_at: new Date(ms).toISOString() });
    expect(await at(insertedAt - 1000)).toBe(false);
    expect(await at(removedAt - 1)).toBe(true);
    expect(await at(removedAt + 1000)).toBe(false);
    expect(await svc.rpc<boolean>("dayo_pos_owner_active_at", { p_shop_id: shop.shopId, p_staff_id: shop.managerId, p_at: new Date().toISOString() })).toBe(false);
  }, T);

  it("pos_alerts_take: บิลนอกแคตตาล็อกรวมเป็นข้อความเดียว · ส่งแล้วไม่ส่งซ้ำ · ซ้ำ dedupe ไม่เพิ่มแถว", async () => {
    const s2 = await createTestShop(svc, "b3-alerts");
    const add = (kind: string, key: string, level = "warning", msg = "กะ 25 ก.ย. เงินไม่ตรงเกินเกณฑ์ — ดูที่ /shifts/x") =>
      svc.rpc<boolean>("dayo_pos_alert", { p_shop_id: s2.shopId, p_level: level, p_kind: kind, p_dedupe: key, p_message: msg });
    expect(await add("off_catalog", "off_catalog:1", "warning", "บิลนอกแคตตาล็อก")).toBe(true);
    expect(await add("off_catalog", "off_catalog:2", "warning", "บิลนอกแคตตาล็อก")).toBe(true);
    expect(await add("off_catalog", "off_catalog:2", "warning", "บิลนอกแคตตาล็อก")).toBe(false);
    expect(await add("mismatch", "mismatch:1", "error")).toBe(true);
    const got = await svc.rpc<Array<{ level: string; kind: string; text: string }>>("pos_alerts_take", { p_shop_id: s2.shopId, p_limit: 5 });
    expect(got).toEqual([
      { level: "error", kind: "mismatch", text: "กะ 25 ก.ย. เงินไม่ตรงเกินเกณฑ์ — ดูที่ /shifts/x" },
      { level: "warning", kind: "off_catalog", text: "มีบิลนอกแคตตาล็อกใหม่ 2 ใบ — ดูที่เว็บ" },
    ]);
    expect(await svc.rpc("pos_alerts_take", { p_shop_id: s2.shopId, p_limit: 5 })).toEqual([]);
  }, T);

  it("dayo_z_expected: สูตรเดียวกับสเปก · ติดลบได้", async () => {
    const cash = { opening_float: 0, pos_cash_sales: 0, void_refunds: 0, paid_in: 0, paid_out: 150.25, drops: 0, drawer_expenses: 0, bot_cash: 0 };
    expect(Number(await svc.rpc("dayo_z_expected", { p_cash: cash }))).toBe(-150.25);
    const c2 = { opening_float: 500, pos_cash_sales: 1235.5, void_refunds: 35, paid_in: 100, paid_out: 20.25, drops: 1000, drawer_expenses: 0, bot_cash: 70 };
    expect(Number(await svc.rpc("dayo_z_expected", { p_cash: c2 }))).toBe(850.25);
  }, T);

  it("backup_dump_table มีตารางใหม่ 5 ตาราง · pos_alerts ไม่อยู่ในไฟล์สำรอง", async () => {
    for (const t of ["shifts", "cash_movements", "cash_counts", "z_reports", "pos_push_rejections"]) {
      expect(Array.isArray(await svc.rpc("backup_dump_table", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_table: t }))).toBe(true);
    }
    expect((await expectDbError(svc.rpc("backup_dump_table", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_table: "pos_alerts" }))).code).toBe("DY422");
  }, T);
});
```

- [ ] **Step 3: รันให้ตก**

Run: `npm run db:reset && npx vitest run --root packages/shared test/db/block3_schema.db.test.ts`
Expected: FAIL — `relation "public.shifts" does not exist` / `function public.save_pos_cash_settings does not exist`

- [ ] **Step 4: เขียน migration** — `supabase/migrations/0055_block3_schema.sql`

```sql
-- 0055_block3_schema — ก้อน 3: กะ · เงินเข้า-ออก · นับเงิน · ใบปิดกะ · บิลนอกแคตตาล็อก (ADR-0056 · สเปก POS §4.10 ก้อน 3)
-- ห้ามแก้ไฟล์เก่า (กฎเหล็กข้อ 13) — ฟังก์ชันเดิมที่เปลี่ยน "ลอกรุ่นล่าสุดทุกบรรทัด" แก้เฉพาะบรรทัดที่มีป้าย ADR-0056
--   0. ตรวจคู่ซ้ำ + unique orders (shop_id, pos_order_id) (R4-2)
--   1. orders: off_catalog · off_catalog_lines · cost_total null ได้เฉพาะบิลนอกแคตตาล็อก · แช่แข็ง pos_shift_id/external_ref ·
--      คีย์ payment ใน pos_reported_amounts ตอนแทรก · บิลนอกแคตตาล็อกแก้ไม่ได้ (P3 ค2)
--   2. ตาราง shifts cash_movements cash_counts z_reports pos_push_rejections pos_alerts + trigger (append-only / ผู้เขียนผ่าน GUC dayo.shift_writer)
--   3. shop_settings: block3_live_from (ตั้งเองจากกะแรก · owner เลื่อนเก่าลงได้เท่านั้น) · off_catalog_max_total (รอ Q72 — ค่าเริ่มต้น 3000) ·
--      shift_waiting_alert_hours (รอ Q74 — ค่าเริ่มต้น 48 · null = ไม่แจ้ง — ขัด D98 ดูแผน 08 "จุดขัด" ข้อ 1)
--   4. scope shift:write · audit_log.action order_off_catalog / shift_data_conflict
--   5. ตัวช่วย · pos_alerts_take · get/save_pos_cash_settings · backup_dump_table (ลอก 0054)

-- ═════════════════════════════════════════════════════════════════════════════════
-- 0. unique บิล POS ต่อร้าน (R4-2) — ตรวจข้อมูลเดิมก่อน (ซ้ำ = หยุด ไม่แก้ข้อมูลเอง)
-- ═════════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_dup bigint;
begin
  select count(*) into v_dup from (
    select 1 from public.orders o where o.pos_order_id is not null group by o.shop_id, o.pos_order_id having count(*) > 1
  ) d;
  if v_dup > 0 then
    raise exception using errcode = 'DY422',
      message = format('precheck: พบบิล POS ที่ pos_order_id ซ้ำในร้านเดียวกัน %s ชุด — หยุด migration ให้เจ้าของตรวจก่อน (ADR-0056)', v_dup);
  end if;
end;
$$;

drop index public.orders_api_client_pos_order_key;
create unique index orders_shop_pos_order_key on public.orders (shop_id, pos_order_id) where pos_order_id is not null;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 1. orders — บิลนอกแคตตาล็อก (D91 · D97)
-- ═════════════════════════════════════════════════════════════════════════════════
alter table public.orders
  add column off_catalog boolean not null default false,
  add column off_catalog_lines jsonb;
alter table public.orders alter column cost_total drop not null;
alter table public.orders
  add constraint orders_off_catalog_cost check (off_catalog = (cost_total is null)),
  add constraint orders_off_catalog_lines check (
    off_catalog = (off_catalog_lines is not null)
    and (off_catalog_lines is null or (jsonb_typeof(off_catalog_lines) = 'array' and jsonb_array_length(off_catalog_lines) between 1 and 50))),
  add constraint orders_off_catalog_pos check (not off_catalog or source = 'pos');
create index orders_shop_off_catalog_idx on public.orders (shop_id, sale_date) where off_catalog;
create index orders_shop_pos_shift_idx on public.orders (shop_id, pos_shift_id) where pos_shift_id is not null;

-- ลอก 0051:95-114 + pos_shift_id/external_ref/off_catalog* (ADR-0056 · R-m8) + บิลนอกแคตตาล็อกแก้ไม่ได้ (P3 ค2)
create or replace function public.dayo_orders_pos_frozen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.dayo_restoring() then
    return new;
  end if;
  if (old.pos_computed_total is not null and new.pos_computed_total is distinct from old.pos_computed_total)
     or (old.pos_reported_amounts is not null and new.pos_reported_amounts is distinct from old.pos_reported_amounts)
     or (old.pos_order_id is not null and new.pos_order_id is distinct from old.pos_order_id)
     or (old.sold_at is not null and new.sold_at is distinct from old.sold_at)
     or (old.catalog_version is not null and new.catalog_version is distinct from old.catalog_version)
     -- ADR-0056: Z จับคู่บิลด้วย pos_shift_id + external_ref · ธง/รายการของบิลนอกแคตตาล็อก
     or (old.source = 'pos' and new.pos_shift_id is distinct from old.pos_shift_id)
     or (old.source = 'pos' and old.external_ref is not null and new.external_ref is distinct from old.external_ref)
     or (new.off_catalog is distinct from old.off_catalog)
     or (old.off_catalog_lines is not null and new.off_catalog_lines is distinct from old.off_catalog_lines) then
    raise exception using errcode = 'DY423',
      message = 'frozen: ยอด/เวลา/รหัส/กะของบิลจาก POS แช่แข็งแล้ว แก้ไม่ได้ (ADR-0049 · ADR-0056)';
  end if;
  -- ADR-0056 (P3 ค2): บิลนอกแคตตาล็อกยกเลิกได้ แต่แก้รายการ/ยอดไม่ได้
  if old.off_catalog and (new.edited_at is distinct from old.edited_at or new.total_amount is distinct from old.total_amount
                          or new.cost_total is distinct from old.cost_total) then
    raise exception using errcode = 'DY422', message = 'off_catalog_read_only: บิลนอกแคตตาล็อกแก้ไม่ได้ ยกเลิกแล้วบันทึกใหม่ค่ะ';
  end if;
  return new;
end;
$$;

-- บิลนอกแคตตาล็อกไม่มีรายการเมนู — update_order จะเขียน order_items ก่อน จึงกันที่นี่ (ADR-0056 · P3 ค2)
create or replace function public.dayo_order_items_off_catalog_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.dayo_restoring() then
    return new;
  end if;
  if exists (select 1 from public.orders o where o.id = new.order_id and o.off_catalog) then
    raise exception using errcode = 'DY422', message = 'off_catalog_read_only: บิลนอกแคตตาล็อกแก้ไม่ได้ ยกเลิกแล้วบันทึกใหม่ค่ะ';
  end if;
  return new;
end;
$$;
create trigger order_items_off_catalog_guard before insert on public.order_items
  for each row execute function public.dayo_order_items_off_catalog_guard();

-- บิล POS ใหม่ทุกใบ: pos_reported_amounts มีคีย์ payment = รหัสวิธีชำระตอนขาย (D93 · แช่แข็งด้วย orders_pos_frozen)
create or replace function public.dayo_orders_pos_payment_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.dayo_restoring() then
    return new;  -- กู้คืน: แถวในไฟล์สำรองต้องเข้าตรงตัว (บิลก่อน migration นี้ไม่มีคีย์ payment — การคิดซ้ำใช้วิธีชำระปัจจุบันแทน)
  end if;
  if new.source = 'pos' and new.pos_reported_amounts is not null and not (new.pos_reported_amounts ? 'payment') then
    new.pos_reported_amounts := new.pos_reported_amounts || jsonb_build_object('payment',
      (select pm.code from public.payment_methods pm where pm.id = new.payment_method_id and pm.shop_id = new.shop_id));
  end if;
  return new;
end;
$$;
create trigger orders_pos_payment_stamp before insert on public.orders
  for each row execute function public.dayo_orders_pos_payment_stamp();

-- ═════════════════════════════════════════════════════════════════════════════════
-- 2. ตาราง (ADR-0056 ข้อ 3 · สเปก §4.10 ก้อน 3) — id จากแท็บเล็ต · received_at = เวลาเซิร์ฟเวอร์ · RLS เปิดไม่มี policy
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_shift_writer()
returns text
language sql
stable
set search_path = public
as $$ select coalesce(current_setting('dayo.shift_writer', true), '') $$;

create table public.shifts (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete restrict,
  api_client_id uuid not null,
  business_date date not null,
  opened_by uuid not null,
  opened_at timestamptz not null,
  opening_float numeric(10,2) not null check (opening_float >= 0),
  quick_open boolean not null,
  status text not null default 'open' check (status in ('open', 'counted', 'closed')),
  closed_by uuid,
  closed_at timestamptz,
  data_conflict boolean not null default false,
  received_at timestamptz not null default now(),
  constraint shifts_shop_client_id_key unique (shop_id, api_client_id, id),
  constraint shifts_closed_pair check ((closed_by is null) = (closed_at is null)),
  constraint shifts_api_client_fkey foreign key (shop_id, api_client_id) references public.api_clients (shop_id, id) on delete restrict,
  constraint shifts_opened_by_fkey foreign key (shop_id, opened_by) references public.staff (shop_id, id) on delete restrict,
  constraint shifts_closed_by_fkey foreign key (shop_id, closed_by) references public.staff (shop_id, id) on delete restrict
);
create index shifts_client_date_idx on public.shifts (api_client_id, business_date);
create index shifts_shop_date_idx on public.shifts (shop_id, business_date desc);
create index shifts_opened_by_idx on public.shifts (opened_by);
create index shifts_closed_by_idx on public.shifts (closed_by) where closed_by is not null;

create table public.cash_movements (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete restrict,
  api_client_id uuid not null,
  shift_id uuid not null,
  kind text not null check (kind in ('PAID_IN', 'PAID_OUT', 'DROP', 'VOID_REFUND')),
  amount numeric(10,2) not null check (amount > 0),
  pos_order_id uuid,
  reason text check (reason is null or (char_length(reason) between 1 and 200 and reason !~ '[\x01-\x1f\x7f]')),
  created_by uuid not null,
  created_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint cash_movements_void_refund_order check ((kind = 'VOID_REFUND') = (pos_order_id is not null)),
  constraint cash_movements_reason_required check (kind = 'VOID_REFUND' or reason is not null),
  constraint cash_movements_shift_fkey foreign key (shop_id, api_client_id, shift_id)
    references public.shifts (shop_id, api_client_id, id) on delete restrict,
  constraint cash_movements_created_by_fkey foreign key (shop_id, created_by) references public.staff (shop_id, id) on delete restrict
);
create index cash_movements_shift_idx on public.cash_movements (shift_id, created_at);
create index cash_movements_void_order_idx on public.cash_movements (shop_id, pos_order_id) where pos_order_id is not null;
create index cash_movements_created_by_idx on public.cash_movements (created_by);

create table public.cash_counts (
  id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete restrict,
  api_client_id uuid not null,
  shift_id uuid not null,
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) = 9),
  counted numeric(10,2) not null check (counted >= 0),
  counted_by uuid not null,
  counted_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint cash_counts_shift_key unique (shift_id),
  constraint cash_counts_shift_fkey foreign key (shop_id, api_client_id, shift_id)
    references public.shifts (shop_id, api_client_id, id) on delete restrict,
  constraint cash_counts_counted_by_fkey foreign key (shop_id, counted_by) references public.staff (shop_id, id) on delete restrict
);
create index cash_counts_client_at_idx on public.cash_counts (api_client_id, counted_at);
create index cash_counts_counted_by_idx on public.cash_counts (counted_by);

create table public.z_reports (
  shift_id uuid primary key,
  shop_id uuid not null references public.shops (id) on delete restrict,
  api_client_id uuid not null,
  z_no integer not null check (z_no >= 1),
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  prev_hash text check (prev_hash is null or prev_hash ~ '^[0-9a-f]{64}$'),
  chain_warning boolean not null,
  -- ADR-0056 (ตีความ): key ไม่มี Z ในฐานเลย ณ ตอนรับ (ลำดับ z_no ข้อ 2) — ตั้งตอนแทรก ไม่เปลี่ยน
  first_of_key boolean not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  expected numeric(10,2) not null,
  counted numeric(10,2) not null check (counted >= 0),
  variance numeric(10,2) not null,
  variance_reason text check (variance_reason is null or char_length(variance_reason) between 1 and 200),
  variance_alert numeric(10,2) not null check (variance_alert >= 0),
  recompute_status text not null default 'waiting_bills' check (recompute_status in ('waiting_bills', 'matched', 'mismatch')),
  z_mismatch boolean not null default false,
  recompute_detail jsonb not null default '{}'::jsonb,
  recompute_notes jsonb not null default '[]'::jsonb,
  missing_pos_order_ids uuid[] not null default '{}',
  missing_movement_ids uuid[] not null default '{}',
  missing_void_order_ids uuid[] not null default '{}',
  waiting_since timestamptz,
  recomputed_at timestamptz,
  chain_break boolean not null default false,
  alerted_variance_at timestamptz,
  alerted_mismatch_at timestamptz,
  alerted_waiting_at timestamptz,  -- (รอ Q74 — ค่าเริ่มต้น)
  -- สเปก 04 §13.8 R5-3: Z ที่ตกลำดับ z_no ข้อ 5 (z_no ≤ สูงสุดของ key ณ ตอนรับ และ counted_at ไม่อยู่ระหว่างใบข้างเคียง) ถูกกัก —
  -- ไม่เป็น "Z ใบก่อน/ถัดไป" และไม่ใช้ตัดสินใบข้างเคียง · ตั้งครั้งเดียวตอน insert ใน dayo_pos_shift_close แล้วแก้ไม่ได้ (guard)
  z_order_quarantined boolean not null default false,
  received_at timestamptz not null default now(),
  constraint z_reports_client_z_no_key unique (api_client_id, z_no),
  constraint z_reports_mismatch_flag check (z_mismatch = (recompute_status = 'mismatch')),
  constraint z_reports_shift_fkey foreign key (shop_id, api_client_id, shift_id)
    references public.shifts (shop_id, api_client_id, id) on delete restrict
);
create index z_reports_shop_status_idx on public.z_reports (shop_id, recompute_status);
create index z_reports_missing_bills_idx on public.z_reports using gin (missing_pos_order_ids);
create index z_reports_missing_movements_idx on public.z_reports using gin (missing_movement_ids);
create index z_reports_missing_void_idx on public.z_reports using gin (missing_void_order_ids);

create table public.pos_push_rejections (
  shop_id uuid not null references public.shops (id) on delete restrict,
  api_client_id uuid not null,
  pos_order_id uuid not null,
  reason text not null check (reason ~ '^[A-Z_]{1,40}$'),
  first_at timestamptz not null default now(),
  constraint pos_push_rejections_pkey primary key (api_client_id, pos_order_id, reason),
  constraint pos_push_rejections_client_fkey foreign key (shop_id, api_client_id) references public.api_clients (shop_id, id) on delete restrict
);
create index pos_push_rejections_shop_order_idx on public.pos_push_rejections (shop_id, pos_order_id);

-- คิวแจ้งเตือน Discord (P3 ค4) — เขียนในธุรกรรมของเหตุการณ์ · ดึงด้วย pos_alerts_take · ไม่อยู่ในไฟล์สำรอง (ข้อมูลปฏิบัติการ)
create table public.pos_alerts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  level text not null check (level in ('error', 'warning')),
  kind text not null check (kind in ('variance', 'mismatch', 'shift_conflict', 'off_catalog', 'scope', 'overlap', 'too_many_shifts', 'waiting', 'recompute_failed')),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  message text not null check (char_length(message) between 1 and 300),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint pos_alerts_dedupe_key unique (shop_id, dedupe_key)
);
create index pos_alerts_pending_idx on public.pos_alerts (shop_id, created_at) where sent_at is null;

alter table public.shifts enable row level security;
alter table public.cash_movements enable row level security;
alter table public.cash_counts enable row level security;
alter table public.z_reports enable row level security;
alter table public.pos_push_rejections enable row level security;
alter table public.pos_alerts enable row level security;

-- กะ: คอลัมน์ข้อมูลแก้ไม่ได้ · status ไปข้างหน้าเท่านั้น + closed_* ครั้งเดียวจาก null (ตัวรับ push) · data_conflict false→true (ตัวตรวจชน)
create or replace function public.dayo_shifts_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_mut constant text[] := array['status', 'closed_by', 'closed_at', 'data_conflict'];
begin
  if public.dayo_restoring() then
    return new;
  end if;
  if (to_jsonb(new) - v_mut) is distinct from (to_jsonb(old) - v_mut) then
    raise exception using errcode = 'DY423', message = 'append_only: กะแก้ไม่ได้ (ADR-0056)';
  end if;
  if (new.status is distinct from old.status or new.closed_by is distinct from old.closed_by or new.closed_at is distinct from old.closed_at)
     and (public.dayo_shift_writer() <> 'push'
          or not (new.status = old.status
                  or (old.status = 'open' and new.status in ('counted', 'closed'))
                  or (old.status = 'counted' and new.status = 'closed'))
          or (old.closed_at is not null
              and (new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by))) then
    raise exception using errcode = 'DY423', message = 'append_only: สถานะกะเปลี่ยนไปข้างหน้าได้ทางเดียวผ่านแถวจากแท็บเล็ต (ADR-0056)';
  end if;
  if new.data_conflict is distinct from old.data_conflict and (old.data_conflict or public.dayo_shift_writer() <> 'conflict') then
    raise exception using errcode = 'DY423', message = 'append_only: data_conflict ตั้งได้เฉพาะตัวตรวจข้อมูลกะชนกัน (ADR-0056)';
  end if;
  return new;
end;
$$;
create trigger shifts_guard before update on public.shifts for each row execute function public.dayo_shifts_guard();

-- ใบปิดกะ: แก้ได้เฉพาะผลคิดซ้ำ/แจ้งเตือน ผ่านฟังก์ชันคิดซ้ำ/แจ้งเตือน
create or replace function public.dayo_z_reports_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_mut constant text[] := array['recompute_status', 'z_mismatch', 'recompute_detail', 'recompute_notes', 'missing_pos_order_ids',
    'missing_movement_ids', 'missing_void_order_ids', 'waiting_since', 'recomputed_at', 'chain_break',
    'alerted_variance_at', 'alerted_mismatch_at', 'alerted_waiting_at'];  -- z_order_quarantined ไม่อยู่ในรายการ: ตั้งตอน insert แล้วแก้ไม่ได้ (สเปก 04 R5-3)
begin
  if public.dayo_restoring() then
    return new;
  end if;
  if (to_jsonb(new) - v_mut) is distinct from (to_jsonb(old) - v_mut) then
    raise exception using errcode = 'DY423', message = 'append_only: ใบปิดกะแก้ไม่ได้ (ADR-0056)';
  end if;
  if public.dayo_shift_writer() not in ('recompute', 'alert') then
    raise exception using errcode = 'DY423', message = 'append_only: ผลคิดซ้ำของใบปิดกะตั้งได้เฉพาะฟังก์ชันคิดซ้ำ/แจ้งเตือน (ADR-0056)';
  end if;
  return new;
end;
$$;
create trigger z_reports_guard before update on public.z_reports for each row execute function public.dayo_z_reports_guard();

create trigger shifts_no_delete before delete on public.shifts for each row execute function public.dayo_append_only();
create trigger shifts_no_truncate before truncate on public.shifts for each statement execute function public.dayo_append_only();
create trigger z_reports_no_delete before delete on public.z_reports for each row execute function public.dayo_append_only();
create trigger z_reports_no_truncate before truncate on public.z_reports for each statement execute function public.dayo_append_only();
create trigger cash_movements_append_only before update or delete on public.cash_movements for each row execute function public.dayo_append_only();
create trigger cash_movements_no_truncate before truncate on public.cash_movements for each statement execute function public.dayo_append_only();
create trigger cash_counts_append_only before update or delete on public.cash_counts for each row execute function public.dayo_append_only();
create trigger cash_counts_no_truncate before truncate on public.cash_counts for each statement execute function public.dayo_append_only();
create trigger pos_push_rejections_append_only before update or delete on public.pos_push_rejections for each row execute function public.dayo_append_only();
create trigger pos_push_rejections_no_truncate before truncate on public.pos_push_rejections for each statement execute function public.dayo_append_only();

-- ═════════════════════════════════════════════════════════════════════════════════
-- 3. shop_settings (ADR-0056 · D100 · S1(c) · R3-C)
-- ═════════════════════════════════════════════════════════════════════════════════
alter table public.shop_settings
  add column block3_live_from date,
  add column off_catalog_max_total numeric(10,2) not null default 3000 check (off_catalog_max_total >= 0),  -- (รอ Q72 — ค่าเริ่มต้น)
  add column shift_waiting_alert_hours integer default 48
    check (shift_waiting_alert_hours is null or shift_waiting_alert_hours between 1 and 720);             -- (รอ Q74 — ค่าเริ่มต้น · null = ไม่แจ้ง)

create or replace function public.dayo_shop_settings_block3_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old date := case when tg_op = 'UPDATE' then old.block3_live_from end;
begin
  if public.dayo_restoring() or new.block3_live_from is not distinct from v_old then
    return new;
  end if;
  if v_old is null then
    -- ตั้งครั้งแรกได้เฉพาะตัวรับ shift_open (D100 · m5)
    if public.dayo_shift_writer() <> 'push' then
      raise exception using errcode = 'DY422', message = 'invalid: วันเริ่มใช้กะตั้งเองจากกะแรกที่ระบบรับค่ะ (ADR-0056 · D100)';
    end if;
  elsif new.block3_live_from is null or new.block3_live_from > v_old then
    raise exception using errcode = 'DY422', message = 'invalid: วันเริ่มใช้กะเลื่อนได้เฉพาะเป็นวันที่เก่ากว่าเดิมค่ะ (ADR-0056)';
  end if;
  return new;
end;
$$;
create trigger shop_settings_block3_guard before insert or update on public.shop_settings
  for each row execute function public.dayo_shop_settings_block3_guard();

-- ═════════════════════════════════════════════════════════════════════════════════
-- 4. scope shift:write · audit_log.action
-- ═════════════════════════════════════════════════════════════════════════════════
alter table public.api_clients drop constraint api_clients_scopes_check;
alter table public.api_clients add constraint api_clients_scopes_check
  check (scopes <@ array['catalog:read', 'staff:read', 'orders:read', 'orders:write', 'stock:read', 'stock:write', 'reports:profit', 'shift:write']::text[]);

-- ลอก 0053 + shift:write (รายการเดียวกับ CHECK ของ api_clients และ apps/web/src/lib/apiScopes.ts)
create or replace function public.dayo_check_api_scopes(p_scopes text[])
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_bad text;
begin
  if p_scopes is null then
    return;
  end if;
  select string_agg(coalesce(s, 'null'), ', ') into v_bad
  from unnest(p_scopes) s
  where s is null or s <> all (array['catalog:read', 'staff:read', 'orders:read', 'orders:write', 'stock:read', 'stock:write', 'reports:profit', 'shift:write']);
  if v_bad is not null then
    raise exception using errcode = 'DY422',
      message = format('invalid: scope ไม่ถูกต้อง (%s) — ใช้ได้เฉพาะ catalog:read, staff:read, orders:read, orders:write, stock:read, stock:write, reports:profit, shift:write ค่ะ', v_bad);
  end if;
end;
$$;

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('insert', 'update', 'delete', 'order_edit', 'order_cancel',
    'profit_view_request', 'profit_view_otp_issue', 'profit_view_otp_sent', 'profit_view_otp_failed',
    'profit_view_verify', 'profit_view_lock', 'profit_view_open', 'profit_view_logout', 'profit_view_revoke',
    'profit_view_daily_cap',
    'order_off_catalog', 'shift_data_conflict'));

-- ═════════════════════════════════════════════════════════════════════════════════
-- 5. ตัวช่วย
-- ═════════════════════════════════════════════════════════════════════════════════
-- owner active ณ เวลาในแถว (m6) = สถานะจากประวัติ staff_audit (0004) ล่าสุดที่ ≤ p_at · ไม่มีประวัติก่อน p_at:
--   การเปลี่ยนครั้งแรกหลัง p_at เป็น update → ใช้ before · เป็น insert → ยังไม่มีคนนี้ (false) · ไม่มีประวัติเลย → สถานะปัจจุบัน
create or replace function public.dayo_pos_owner_active_at(p_shop_id uuid, p_staff_id uuid, p_at timestamptz)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  s public.staff;
  v_state jsonb;
  v_first public.audit_log;
begin
  select * into s from public.staff x where x.id = p_staff_id and x.shop_id = p_shop_id;
  if not found or p_at is null then
    return false;
  end if;
  select a.after into v_state from public.audit_log a
  where a.shop_id = p_shop_id and a.entity = 'staff' and a.entity_id = p_staff_id
    and a.action in ('insert', 'update') and a.at <= p_at
  order by a.at desc, a.created_at desc, a.id desc
  limit 1;
  if v_state is null then
    select * into v_first from public.audit_log a
    where a.shop_id = p_shop_id and a.entity = 'staff' and a.entity_id = p_staff_id and a.at > p_at
    order by a.at, a.created_at, a.id
    limit 1;
    if not found then
      if s.created_at > p_at then
        return false;
      end if;
      v_state := jsonb_build_object('role', s.role, 'status', s.status);
    elsif v_first.action = 'update' then
      v_state := v_first.before;
    else
      return false;
    end if;
  end if;
  return coalesce(v_state ->> 'role' = 'owner' and v_state ->> 'status' = 'active', false);
end;
$$;

create or replace function public.dayo_thai_short_date(p_day date)
returns text
language sql
immutable
set search_path = public
as $$
  select extract(day from p_day)::integer || ' ' ||
    (array['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'])[extract(month from p_day)::integer]
$$;

-- เข้าคิวแจ้งเตือน (ข้อความไม่มียอดเงิน — รอ Q73 — ค่าเริ่มต้น) · dedupe ต่อร้าน · true = แถวใหม่
create or replace function public.dayo_pos_alert(p_shop_id uuid, p_level text, p_kind text, p_dedupe text, p_message text)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.pos_alerts (shop_id, level, kind, dedupe_key, message)
  values (p_shop_id, p_level, p_kind, left(p_dedupe, 200), left(p_message, 300))
  on conflict (shop_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;

-- เงินสดที่ควรมี (สเปก §4.10 ก้อน 3 · C5) — ติดลบได้ · สูตรเดียวกับ POS packages/domain/src/shift.ts หลังขยายตาม R-m1 (parity — Task 4)
create or replace function public.dayo_z_expected(p_cash jsonb)
returns numeric
language sql
immutable
set search_path = public
as $$
  select (p_cash ->> 'opening_float')::numeric + (p_cash ->> 'pos_cash_sales')::numeric - (p_cash ->> 'void_refunds')::numeric
       + (p_cash ->> 'paid_in')::numeric - (p_cash ->> 'paid_out')::numeric - (p_cash ->> 'drops')::numeric
       - (p_cash ->> 'drawer_expenses')::numeric + (p_cash ->> 'bot_cash')::numeric
$$;

-- ดึงแจ้งเตือนที่ยังไม่ส่ง (Route Handler / Server Action / cron บอท) — บิลนอกแคตตาล็อกรวมเป็นข้อความเดียว "N ใบ" (S1(d)) ·
-- ≤ p_limit ข้อความ (≤ 5 — งบ Discord ต่อคำขอ ADR-0044 ข้อ 5) · ที่เหลือรอรอบถัดไป · skip locked กันสองคำขอส่งซ้ำ
create or replace function public.pos_alerts_take(p_shop_id uuid, p_limit integer default 5)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_lim integer := least(greatest(coalesce(p_limit, 5), 1), 5);
  v_oc uuid[];
  v_other uuid[];
  v_out jsonb;
begin
  if p_shop_id is null then
    raise exception using errcode = 'DY401', message = 'actor_required: ต้องระบุร้าน';
  end if;
  v_oc := array(
    select a.id from public.pos_alerts a
    where a.shop_id = p_shop_id and a.sent_at is null and a.kind = 'off_catalog'
    order by a.created_at, a.id limit 500 for update skip locked);
  v_other := array(
    select a.id from public.pos_alerts a
    where a.shop_id = p_shop_id and a.sent_at is null and a.kind <> 'off_catalog'
    order by a.created_at, a.id limit (v_lim - case when cardinality(v_oc) > 0 then 1 else 0 end) for update skip locked);
  select coalesce(jsonb_agg(jsonb_build_object('level', a.level, 'kind', a.kind, 'text', a.message) order by a.created_at, a.id), '[]'::jsonb)
    into v_out from public.pos_alerts a where a.id = any (v_other);
  if cardinality(v_oc) > 0 then
    v_out := v_out || jsonb_build_array(jsonb_build_object('level', 'warning', 'kind', 'off_catalog',
      'text', format('มีบิลนอกแคตตาล็อกใหม่ %s ใบ — ดูที่เว็บ', cardinality(v_oc))));
  end if;
  update public.pos_alerts a set sent_at = now() where a.id = any (v_oc || v_other);
  return v_out;
end;
$$;

-- ค่าตั้งเงินสด POS (owner) — ไม่มีแถว = ค่าเริ่มต้นของคอลัมน์ (ต้องตรงกับ default ข้างบน)
create or replace function public.get_pos_cash_settings(p_shop_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  r public.shop_settings;
begin
  perform public.dayo_require_staff(p_shop_id, p_staff_id, array['owner']);
  select * into r from public.shop_settings s where s.shop_id = p_shop_id;
  if not found then
    return jsonb_build_object('block3_live_from', null, 'off_catalog_max_total', 3000, 'shift_waiting_alert_hours', 48);  -- (รอ Q72/Q74 — ค่าเริ่มต้น)
  end if;
  return jsonb_build_object('block3_live_from', r.block3_live_from, 'off_catalog_max_total', r.off_catalog_max_total,
    'shift_waiting_alert_hours', r.shift_waiting_alert_hours);
end;
$$;

-- บันทึก (owner) · คีย์ที่ไม่รู้จัก = DY422 · block3_live_from เลื่อนเก่าลงเท่านั้น (trigger) · audit ผ่าน shop_settings_audit
create or replace function public.save_pos_cash_settings(p_shop_id uuid, p_staff_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  s public.staff := public.dayo_require_staff(p_shop_id, p_staff_id, array['owner']);
  k text;
  v_live date;
  v_hours integer;
begin
  if coalesce(jsonb_typeof(p_patch), '') <> 'object' then
    raise exception using errcode = 'DY422', message = 'invalid: ค่าตั้งต้องเป็นออบเจกต์ค่ะ';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('off_catalog_max_total', 'block3_live_from', 'shift_waiting_alert_hours') then
      raise exception using errcode = 'DY422', message = format('invalid: ไม่รู้จักค่าตั้ง "%s" ค่ะ', left(k, 40));
    end if;
  end loop;
  perform set_config('dayo.shop_id', p_shop_id::text, true);
  perform set_config('dayo.staff_id', s.id::text, true);
  insert into public.shop_settings (shop_id) values (p_shop_id) on conflict (shop_id) do nothing;
  if p_patch ? 'off_catalog_max_total' then
    if not public.dayo_pos_is_money(p_patch -> 'off_catalog_max_total') then
      raise exception using errcode = 'DY422', message = 'invalid: เพดานบิลนอกแคตตาล็อกต้องเป็นบาท ≥ 0 ทศนิยมไม่เกิน 2 ตำแหน่งค่ะ';
    end if;
    update public.shop_settings x set off_catalog_max_total = (p_patch ->> 'off_catalog_max_total')::numeric, updated_by = s.id
    where x.shop_id = p_shop_id;
  end if;
  if p_patch ? 'block3_live_from' then
    v_live := public.dayo_pos_date(p_patch -> 'block3_live_from');
    if v_live is null then
      raise exception using errcode = 'DY422', message = 'invalid: วันเริ่มใช้กะต้องเป็นวันที่ YYYY-MM-DD (ล้างค่าไม่ได้) ค่ะ';
    end if;
    update public.shop_settings x set block3_live_from = v_live, updated_by = s.id where x.shop_id = p_shop_id;
  end if;
  if p_patch ? 'shift_waiting_alert_hours' then
    v_hours := case when jsonb_typeof(p_patch -> 'shift_waiting_alert_hours') = 'null' then null
                    else public.dayo_patch_int(p_patch, 'shift_waiting_alert_hours', 'แจ้งเมื่อใบปิดกะรอบิลเกิน (ชั่วโมง)', 1, 720) end;
    update public.shop_settings x set shift_waiting_alert_hours = v_hours, updated_by = s.id where x.shop_id = p_shop_id;
  end if;
  return public.get_pos_cash_settings(p_shop_id, p_staff_id);
end;
$$;
```

  ต่อท้ายไฟล์เดียวกัน: **`backup_dump_table` (ลอก 0054:857 ทั้งตัว)** แล้วเพิ่ม 5 กิ่งนี้ไว้ก่อน `else` (ป้าย `-- ADR-0056`) · `pos_alerts` ไม่อยู่ในไฟล์สำรอง:

```sql
  -- ADR-0056: กะ/เงินสด/ใบปิดกะ/ประวัติถูกปฏิเสธ
  elsif p_table = 'shifts' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from public.shifts t where t.shop_id = p_shop_id;
  elsif p_table = 'cash_movements' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from public.cash_movements t where t.shop_id = p_shop_id;
  elsif p_table = 'cash_counts' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from public.cash_counts t where t.shop_id = p_shop_id;
  elsif p_table = 'z_reports' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from public.z_reports t where t.shop_id = p_shop_id;
  elsif p_table = 'pos_push_rejections' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from public.pos_push_rejections t where t.shop_id = p_shop_id;
```

  ท้ายไฟล์ — **บล็อกสิทธิ์มาตรฐาน** (= `0054_customer_bot.sql:1000-1005` · ใช้ข้อความนี้ตรงตัวท้ายทุก migration 0055–0060):

```sql
-- ── สิทธิ์: เฉพาะ service_role ─────────────────────────────────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
-- 0054: บอทลูกค้าเรียกด้วย publishable key — ต้องให้ anon ซ้ำทุก migration ที่ revoke ทั้งหมด (ADR-0062 · ไม่งั้นบอทลูกค้าพังบน production)
grant execute on function public.customer_shop_info(uuid) to anon;
```

- [ ] **Step 5: รันให้ผ่าน + เทสต์เดิมยังผ่าน**

Run: `npm run db:reset && npm run db:types && npx vitest run --root packages/shared test/db/block3_schema.db.test.ts test/db/pos_push.db.test.ts test/db/shop_settings.db.test.ts test/db/customer_bot.db.test.ts`
Expected: PASS ทั้งหมด · `customer_bot.db.test.ts` ผ่าน = anon ยังเรียก `customer_shop_info` ได้ (บล็อกสิทธิ์มาตรฐานถูกต้อง) · ถ้าเทสต์เดิมใน `pos_push.db.test.ts` ที่ตรวจ unique ต่อ `api_client_id` ล้ม ให้แก้ **เฉพาะ assertion นั้น** ให้เป็นกติกาใหม่ (ต่อร้าน) พร้อมคอมเมนต์ `// ADR-0056 R4-2` · ถ้าเทสต์ที่ตรวจ `pos_reported_amounts` แบบ `toEqual` ล้มเพราะมีคีย์ `payment` ให้แก้เป็นมี `payment` · ห้ามแก้อย่างอื่นในเทสต์เดิม

- [ ] **Step 6: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add supabase/migrations/0055_block3_schema.sql packages/shared/test/db/block3Fixtures.ts packages/shared/test/db/block3_schema.db.test.ts packages/shared/src/database.types.ts packages/shared/test/db/pos_push.db.test.ts
git commit -m "feat(db): add shift, cash count and z report tables for pos block 3"
```

---

## Task 2: `api_pos_push` รับชนิดกะ `shift_open` `cash_movement` `cash_count` · คำนำหน้า · หาบิลข้าม key · สิ่งที่อยู่นอก savepoint (migration 0056)

**agent:** db-engineer · opus · high (lane A · ใช้ Docker) · **security-reviewer ตรวจ task นี้ก่อน merge** (scope ต่อแถว · S4 · S5 · ข้อความ `detail`)

**Files:**
- Create: `supabase/migrations/0056_pos_push_shift_kinds.sql`
- Create: `packages/shared/test/db/pos_push_shift.db.test.ts`
- Modify: `packages/shared/test/db/pos_push.db.test.ts` (เฉพาะ assertion ของ `detail` ที่มีคำนำหน้าใหม่ — Step 5)
- Modify: `packages/shared/src/database.types.ts`

**Interfaces:**
- Consumes: Task 1 ทั้งหมด · `0052`: `dayo_pos_verdict` `dayo_pos_is_*` `dayo_jt` `dayo_pos_ts` `dayo_pos_date` `dayo_pos_has` `dayo_pos_staff_ok` `dayo_pos_order_data` `dayo_request_header` `dayo_switch_on` · `dayo_create_order` (0051)
- Produces:
  - `dayo_pos_verdict_s5(p_status text, p_reason text, p_detail text, p_s5 text)` — raise `DYPV5` (คำตัดสินเดียวกับ `DYPV0` + ธงข้อมูลกะชนกันใน `column_name`) · `p_s5` ∈ `key_changed` `counted` `z_no_taken` `counted_mismatch` `z_no_range`
  - `dayo_pos_exists_verdict(o public.orders, p_prefix text) → jsonb` = `{status:'rejected', reason:'CONFLICT', detail:'<prefix><order_no> …', data:{order_no, version, reported_total, payment_is_cash, off_catalog}}`
  - `dayo_pos_id_field(p_kind text) → text` · `dayo_pos_is_shift_kind(p_kind text) → boolean`
  - `dayo_pos_dispatch(p_shop_id uuid, p_client_id uuid, p_kind text, d jsonb) → jsonb` (Task 3/4 สร้างทับเพื่อเพิ่มชนิด)
  - `dayo_pos_map_error(p_shop_id uuid, p_client_id uuid, p_row jsonb, p_state text, p_msg text, p_det text, p_hint text, p_col text) → jsonb` (ลายเซ็นใหม่ — drop ตัว 7 อาร์กิวเมนต์)
  - `dayo_pos_record_shift_conflict(p_shop_id uuid, p_client_id uuid, p_row jsonb, p_s5 text) → void`
  - `dayo_shift_overlap_alert(p_shop_id uuid, p_client_id uuid, p_shift_id uuid) → void`
  - คำนำหน้า `detail` ตาม Global Constraints ในทุกชนิด (รวม `order`/`order_void` เดิม)

- [ ] **Step 1: เทสต์ที่ต้องตก** — `packages/shared/test/db/pos_push_shift.db.test.ts`

```ts
// pos_push_shift.db.test.ts — migration 0056 (ADR-0056 ข้อ 4 · สเปก POS §4.10 ก้อน 3 กติการ่วม · §4.5 ข้อ 0 · §9 ก้อน 3)
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { connectLocalSupabase, createTestShop, Db, localSql } from "./helpers.js";
import type { TestShop } from "./helpers.js";
import {
  MIN, POS_SCOPES, T, ago, bkkDateOf, countRow, mkClient, movementRow, nextReceipt, orderRow, pusher, setupBlock3Shop, shiftOpenRow,
} from "./block3Fixtures.js";
import type { PushRow, RowResult } from "./block3Fixtures.js";

const sb = await connectLocalSupabase();
const v = (r: RowResult) => [r.status, r.reason ?? null];

describe.skipIf(!sb)("0056 ชนิดกะ + คำนำหน้า + หาบิลข้าม key", () => {
  let svc: Db;
  let shop: TestShop;
  let client: string;
  let push: ReturnType<typeof pusher>;
  const one = async (row: PushRow, c = client) => (await push([row], c))[0]!;
  const alerts = (kind: string) => svc.select<{ level: string; message: string; dedupe_key: string }>("pos_alerts", `shop_id=eq.${shop.shopId}&kind=eq.${kind}&select=level,message,dedupe_key`);

  beforeAll(async () => {
    svc = Db.service(sb!);
    shop = await createTestShop(svc, "b3-push");
    await setupBlock3Shop(svc, shop);
    client = await mkClient(svc, shop.shopId);
    push = pusher(svc, shop.shopId);
  }, T);

  describe("shift_open", () => {
    it("accepted {shift_id} · ส่งซ้ำ = duplicate · หลังคีย์หมดอายุ id เดิม = duplicate · id เดียวกันจาก key อื่น = FORBIDDEN rule:", async () => {
      const row = shiftOpenRow(shop);
      const a = await one(row);
      expect(v(a)).toEqual(["accepted", null]);
      expect(a.data).toEqual({ shift_id: row.data.shift_id });
      expect((await one(row)).status).toBe("duplicate");
      await svc.delete("api_idempotency_keys", `api_client_id=eq.${client}&idempotency_key=eq.${row.key}`);
      const d = await one(row);
      expect([d.status, d.data]).toEqual(["duplicate", { shift_id: row.data.shift_id }]);
      const other = await mkClient(svc, shop.shopId);
      const f = await one(row, other);
      expect(v(f)).toEqual(["rejected", "FORBIDDEN"]);
      expect(f.detail).toMatch(/^rule:/);
    }, T);

    it("key ไม่มี shift:write → แถวกะ FORBIDDEN scope: ขณะบิลในคำขอเดียวกันผ่าน · แจ้ง 🟡 วันละครั้งต่อ key", async () => {
      const noShift = await mkClient(svc, shop.shopId, POS_SCOPES.filter((s) => s !== "shift:write"));
      const [s, o] = await push([shiftOpenRow(shop), orderRow(shop)], noShift);
      expect(v(s!)).toEqual(["rejected", "FORBIDDEN"]);
      expect(s!.detail).toMatch(/^scope:/);
      expect(o!.status).toBe("accepted");
      await push([shiftOpenRow(shop)], noShift);
      const a = (await alerts("scope")).filter((x) => x.dedupe_key.startsWith(`scope:${noShift}:`));
      expect(a).toHaveLength(1);
      expect(a[0]!.level).toBe("warning");
      expect(a[0]!.message).toContain("shift:write");
    }, T);

    it("ช่อง id ตามชนิด: uuid ใน key ≠ shift_id = BAD_KEY · shift_id ไม่ใช่ uuid = INVALID", async () => {
      const row = shiftOpenRow(shop);
      expect(v(await one({ ...row, key: `shift_open:${randomUUID()}` }))).toEqual(["rejected", "BAD_KEY"]);
      const id = randomUUID();
      expect(v(await one({ key: `shift_open:${id}`, kind: "shift_open", data: { ...row.data, shift_id: "x" } }))).toEqual(["rejected", "INVALID"]);
    }, T);

    it("เวลา/วัน: business_date ≠ วันไทยของ opened_at = INVALID · เกิน +5 นาที = CLOCK_AHEAD · เก่ากว่า 60 วัน = INVALID", async () => {
      const at = ago(10 * MIN);
      expect(v(await one(shiftOpenRow(shop, { opened_at: at, business_date: "2020-01-01" })))).toEqual(["rejected", "INVALID"]);
      const future = new Date(Date.now() + 7 * MIN).toISOString();
      expect(v(await one(shiftOpenRow(shop, { opened_at: future, business_date: bkkDateOf(future) })))).toEqual(["deferred", "CLOCK_AHEAD"]);
      const old = ago(61 * 24 * 60 * MIN);
      expect(v(await one(shiftOpenRow(shop, { opened_at: old, business_date: bkkDateOf(old) })))).toEqual(["rejected", "INVALID"]);
    }, T);

    it("quick_open: ผู้เปิดไม่ใช่ owner = FORBIDDEN role: · owner active = ผ่าน · พนักงานไม่รู้จัก = UNKNOWN_STAFF", async () => {
      const r = await one(shiftOpenRow(shop, { quick_open: true, opened_by: shop.staffId }));
      expect(v(r)).toEqual(["rejected", "FORBIDDEN"]);
      expect(r.detail).toMatch(/^role:/);
      // opened_at = ตอนนี้ (owner ร้านทดสอบเพิ่งถูกสร้าง — ก่อนหน้านั้นยังไม่ใช่ owner active)
      expect((await one(shiftOpenRow(shop, { quick_open: true, opened_by: shop.ownerId, opened_at: new Date().toISOString() }))).status).toBe("accepted");
      expect(v(await one(shiftOpenRow(shop, { opened_by: shop.pendingId })))).toEqual(["rejected", "UNKNOWN_STAFF"]);
    }, T);

    it("block3_live_from: shift_open แรกที่ accepted ตั้งค่า · แถวถัดไปไม่เปลี่ยน · rejected ไม่ตั้ง · กะเก่ากว่าเมื่อวานไม่ตั้ง", async () => {
      const s2 = await createTestShop(svc, "b3-live");
      const c2 = await mkClient(svc, s2.shopId);
      const p2 = pusher(svc, s2.shopId);
      const get = async () => (await svc.rpc<{ block3_live_from: string | null }>("get_pos_cash_settings", { p_shop_id: s2.shopId, p_staff_id: s2.ownerId })).block3_live_from;
      await p2([shiftOpenRow(s2, { opened_by: s2.pendingId })], c2);
      expect(await get()).toBeNull();
      const old = ago(3 * 24 * 60 * MIN);
      expect((await p2([shiftOpenRow(s2, { opened_at: old, business_date: bkkDateOf(old), opened_by: s2.staffId })], c2))[0]!.status).toBe("accepted");
      expect(await get()).toBeNull();
      const first = shiftOpenRow(s2, { opened_by: s2.staffId });
      await p2([first], c2);
      expect(await get()).toBe(first.data.business_date);
      const y = ago(24 * 60 * MIN);
      await p2([shiftOpenRow(s2, { opened_at: y, business_date: bkkDateOf(y), opened_by: s2.staffId })], c2);
      expect(await get()).toBe(first.data.business_date);
    }, T);

    it("key เดียวมีกะเกิน 3 กะในวันเดียว → แจ้ง 🟡 ครั้งเดียว", async () => {
      const c3 = await mkClient(svc, shop.shopId);
      await push([1, 2, 3, 4, 5].map((i) => shiftOpenRow(shop, { opened_at: ago(i * MIN) })), c3);
      expect((await alerts("too_many_shifts")).filter((a) => a.dedupe_key.startsWith(`too_many:${c3}:`))).toHaveLength(1);
    }, T);

    it("key เดิมเนื้อหาต่าง = CONFLICT key_changed: + ข้อมูลกะชนกัน (audit_log นอก savepoint · data_conflict · 🔴)", async () => {
      const row = shiftOpenRow(shop);
      await one(row);
      const r = await one({ ...row, data: { ...row.data, opening_float: 999 } });
      expect(v(r)).toEqual(["rejected", "CONFLICT"]);
      expect(r.detail).toMatch(/^key_changed:/);
      const [s] = await svc.select<{ data_conflict: boolean; opening_float: number }>("shifts", `id=eq.${row.data.shift_id}&select=data_conflict,opening_float`);
      expect(s).toEqual({ data_conflict: true, opening_float: 500 });
      const au = await svc.select<{ before: { sha256: string }; after: { sha256: string; conflict: string } }>("audit_log", `entity=eq.shifts&entity_id=eq.${row.data.shift_id}&action=eq.shift_data_conflict&select=before,after`);
      expect(au).toHaveLength(1);
      expect(au[0]!.after.conflict).toBe("key_changed");
      expect(au[0]!.before.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(au[0]!.after.sha256).not.toBe(au[0]!.before.sha256);
      expect((await alerts("shift_conflict")).some((a) => a.level === "error" && a.message.startsWith("ข้อมูลกะชนกัน — ตรวจกุญแจเครื่อง"))).toBe(true);
    }, T);
  });

  describe("cash_movement", () => {
    it("กะยังไม่มา = deferred PARENT_PENDING → กะมาแล้วผ่าน {movement_id} · กะของ key อื่น = FORBIDDEN rule:", async () => {
      const sh = shiftOpenRow(shop);
      const mv = movementRow(sh.data.shift_id as string, shop);
      expect(v(await one(mv))).toEqual(["deferred", "PARENT_PENDING"]);
      await one(sh);
      const a = await one(mv);
      expect([a.status, a.data]).toEqual(["accepted", { movement_id: mv.data.movement_id }]);
      const other = await mkClient(svc, shop.shopId);
      const r = await one(movementRow(sh.data.shift_id as string, shop), other);
      expect(v(r)).toEqual(["rejected", "FORBIDDEN"]);
      expect(r.detail).toMatch(/^rule:/);
    }, T);

    it("กติกาแถว: VOID_REFUND ต้องมี pos_order_id · ชนิดอื่นต้องมี reason · created_at ก่อนเปิดกะ/หลังนับ = INVALID", async () => {
      const sh = shiftOpenRow(shop, { opened_at: ago(60 * MIN) });
      await one(sh);
      const sid = sh.data.shift_id as string;
      expect(v(await one(movementRow(sid, shop, { kind: "VOID_REFUND", pos_order_id: null, reason: null })))).toEqual(["rejected", "INVALID"]);
      expect(v(await one(movementRow(sid, shop, { kind: "PAID_OUT", reason: null })))).toEqual(["rejected", "INVALID"]);
      expect(v(await one(movementRow(sid, shop, { amount: 0 })))).toEqual(["rejected", "INVALID"]);
      expect(v(await one(movementRow(sid, shop, { created_at: ago(61 * MIN) })))).toEqual(["rejected", "INVALID"]);
      expect((await one(movementRow(sid, shop, { kind: "VOID_REFUND", pos_order_id: randomUUID(), reason: null }))).status).toBe("accepted");
      await one(countRow(sid, shop, { 100: 5 }, { counted_at: ago(10 * MIN) }));
      expect(v(await one(movementRow(sid, shop, { created_at: ago(5 * MIN) })))).toEqual(["rejected", "INVALID"]);
    }, T);
  });

  describe("cash_count", () => {
    it("9 แถว · counted = Σ · ผ่านแล้วกะเป็น counted · การนับที่สองของกะ = CONFLICT counted: + ข้อมูลกะชนกัน", async () => {
      const sh = shiftOpenRow(shop);
      await one(sh);
      const sid = sh.data.shift_id as string;
      const bad = countRow(sid, shop, { 100: 5 });
      expect(v(await one({ ...bad, data: { ...bad.data, counted: 499 } }))).toEqual(["rejected", "INVALID"]);
      expect(v(await one({ ...bad, data: { ...bad.data, lines: (bad.data.lines as unknown[]).slice(0, 8) } }))).toEqual(["rejected", "INVALID"]);
      const ok = countRow(sid, shop, { 1000: 1, 20: 3, 1: 7 });
      const a = await one(ok);
      expect([a.status, a.data]).toEqual(["accepted", { count_id: ok.data.count_id }]);
      expect((await svc.select<{ status: string }>("shifts", `id=eq.${sid}&select=status`))[0]!.status).toBe("counted");
      const r = await one(countRow(sid, shop, { 100: 1 }));
      expect(v(r)).toEqual(["rejected", "CONFLICT"]);
      expect(r.detail).toMatch(/^counted:/);
      expect((await svc.select<{ data_conflict: boolean }>("shifts", `id=eq.${sid}&select=data_conflict`))[0]!.data_conflict).toBe(true);
    }, T);

    it("นับออฟไลน์ → เปิดกะถัดไป → ส่งทีหลังในคำขอเดียว: ทุกแถว accepted ไม่มี CONFLICT", async () => {
      const a = shiftOpenRow(shop, { opened_at: ago(120 * MIN) });
      const ca = countRow(a.data.shift_id as string, shop, { 500: 1 }, { counted_at: ago(61 * MIN) });
      const b = shiftOpenRow(shop, { opened_at: ago(60 * MIN) });
      const res = await push([a, ca, b], await mkClient(svc, shop.shopId));
      expect(res.map((x) => x.status)).toEqual(["accepted", "accepted", "accepted"]);
    }, T);

    it("กะซ้อนกัน (ช่วง [opened_at, counted_at] ทับกันใน key เดียว) → แจ้ง 🟡", async () => {
      const c4 = await mkClient(svc, shop.shopId);
      const a = shiftOpenRow(shop, { opened_at: ago(120 * MIN) });
      const b = shiftOpenRow(shop, { opened_at: ago(90 * MIN) });
      await push([a, b, countRow(a.data.shift_id as string, shop, {}, { counted_at: ago(60 * MIN) }), countRow(b.data.shift_id as string, shop, {}, { counted_at: ago(30 * MIN) })], c4);
      expect((await alerts("overlap")).some((x) => x.message.startsWith("กะซ้อนกันบนเครื่องเดียวกัน"))).toBe(true);
    }, T);
  });

  describe("order / order_void ก้อน 3", () => {
    it("บิลเดียวกันใต้ key อื่น = CONFLICT exists:<order_no> + data · ใบเสร็จชน = CONFLICT receipt_taken:", async () => {
      const row = orderRow(shop);
      const a = await one(row);
      const other = await mkClient(svc, shop.shopId);
      const r = await one({ ...row, data: { ...row.data, receipt_no: nextReceipt() } }, other);
      expect(v(r)).toEqual(["rejected", "CONFLICT"]);
      expect(r.detail).toBe(`exists:${a.data!.order_no} บิลนี้อยู่ในระบบกลางแล้ว`);
      expect(r.data).toEqual({ order_no: a.data!.order_no, version: 1, reported_total: 35, payment_is_cash: true, off_catalog: false });
      const clash = orderRow(shop, { receipt_no: row.data.receipt_no });
      const c = await one(clash);
      expect(v(c)).toEqual(["rejected", "CONFLICT"]);
      expect(c.detail).toMatch(/^receipt_taken:/);
    }, T);

    it("แถว order ที่ rejected → pos_push_rejections เก็บทุกเหตุผล (นอก savepoint)", async () => {
      const id = randomUUID();
      await one(orderRow(shop, { channel: "nochannel" }, id));
      await one(orderRow(shop, { staff_id: randomUUID() }, id));
      await one(orderRow(shop, { channel: "nochannel" }, id));
      const rows = await svc.select<{ reason: string }>("pos_push_rejections", `pos_order_id=eq.${id}&select=reason&order=reason`);
      expect(rows.map((r) => r.reason)).toEqual(["UNKNOWN_CODE", "UNKNOWN_STAFF"]);
    }, T);

    it("order_void: บิลของ key อื่น / คนละวันกับวันขาย = FORBIDDEN rule:", async () => {
      const row = orderRow(shop);
      await one(row);
      const voidRow = (at: string) => ({ key: `order_void:${row.data.pos_order_id}`, kind: "order_void",
        data: { pos_order_id: row.data.pos_order_id, voided_at: at, staff_id: shop.staffId, approved_by: null, reason: "ลูกค้าเปลี่ยนใจ" } });
      const other = await mkClient(svc, shop.shopId);
      const r = await one(voidRow(ago(1 * MIN)), other);
      expect([...v(r), r.detail?.slice(0, 5)]).toEqual(["rejected", "FORBIDDEN", "rule:"]);
    }, T);
  });

  describe("ตัวแปลง 23505 (ชนกันพร้อมกัน) — เรียก dayo_pos_map_error ตรง", () => {
    it("ชนิดกะหาใหม่ด้วย (api_client_id, id): เจอ = duplicate · การนับของกะชน = CONFLICT counted: + ธง s5", async () => {
      const sh = shiftOpenRow(shop);
      await one(sh);
      const map = (row: PushRow) => svc.rpc<Record<string, unknown>>("dayo_pos_map_error", {
        p_shop_id: shop.shopId, p_client_id: client, p_row: row, p_state: "23505", p_msg: "dup", p_det: null, p_hint: null, p_col: null });
      expect(await map(sh)).toEqual({ status: "duplicate", data: { shift_id: sh.data.shift_id } });
      const c1 = countRow(sh.data.shift_id as string, shop, {});
      await one(c1);
      expect(await map(countRow(sh.data.shift_id as string, shop, {}))).toMatchObject({ status: "rejected", reason: "CONFLICT", s5: "counted" });
      // id การนับของ key อื่น = FORBIDDEN rule: ไม่มีธง s5 (ไม่ใช่ข้อมูลกะชนกันของเครื่องนี้)
      const otherKey = await mkClient(svc, shop.shopId);
      const osh = shiftOpenRow(shop);
      await one(osh, otherKey);
      const oc = countRow(osh.data.shift_id as string, shop, {});
      await one(oc, otherKey);
      const foreign = await map({ ...countRow(sh.data.shift_id as string, shop, {}, {}, oc.data.count_id as string) });
      expect(foreign).toMatchObject({ status: "rejected", reason: "FORBIDDEN", detail: "rule: id นี้เป็นของเครื่องอื่น" });
      expect(foreign).not.toHaveProperty("s5");
      const o = orderRow(shop);
      const a = await one(o);
      expect(await map(o)).toMatchObject({ status: "duplicate", data: { order_no: a.data!.order_no } });
    }, T);
  });

  it("supported_kinds/fields ตรงกับที่ RPC รับจริง: ฟิลด์เกิน = UNSUPPORTED · แถวครบทุกฟิลด์ไม่ UNSUPPORTED", async () => {
    const sup = await svc.rpc<{ kinds: string[]; fields: Record<string, string[]> }>("dayo_pos_supported", {});
    for (const k of ["shift_open", "cash_movement", "cash_count"]) expect(sup.kinds).toContain(k);
    const sh = shiftOpenRow(shop);
    const rows: PushRow[] = [sh, movementRow(sh.data.shift_id as string, shop), countRow(sh.data.shift_id as string, shop, {})];
    for (const r of rows) {
      expect(Object.keys(r.data).sort()).toEqual(sup.fields[r.kind]!.filter((f) => !f.includes(".")).sort());
      expect(v(await one({ ...r, data: { ...r.data, extra: 1 } }))).toEqual(["deferred", "UNSUPPORTED"]);
    }
    expect(sup.fields.cash_count).toEqual(expect.arrayContaining(["lines.denomination", "lines.count"]));
    const c = countRow(randomUUID(), shop, {});
    const withSub = { ...c, data: { ...c.data, lines: (c.data.lines as Array<Record<string, unknown>>).map((l) => ({ ...l, x: 1 })) } };
    expect(v(await one(withSub))).toEqual(["deferred", "UNSUPPORTED"]);
    const res = await push(rows, await mkClient(svc, shop.shopId));
    expect(res.map((x) => x.status)).toEqual(["accepted", "accepted", "accepted"]);
  }, T);
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npx vitest run --root packages/shared test/db/pos_push_shift.db.test.ts`
Expected: FAIL — แถวชนิด `shift_open` ได้ `deferred UNSUPPORTED` · `dayo_pos_map_error` ไม่มีอาร์กิวเมนต์ `p_col`

- [ ] **Step 3: เขียน migration** — `supabase/migrations/0056_pos_push_shift_kinds.sql`

```sql
-- 0056_pos_push_shift_kinds — POST /v1/pos/push รับชนิดกะ shift_open / cash_movement / cash_count (ADR-0056 ข้อ 4 · สเปก POS §4.10 ก้อน 3)
-- ห้ามแก้ไฟล์เก่า — ลอกรุ่นล่าสุด (0052) แก้เฉพาะบรรทัดที่มีป้าย ADR-0056:
--   dayo_pos_push_row: scope shift:write ต่อแถว · ช่อง id ตามชนิด · key_changed: (ชนิดกะ = ข้อมูลกะชนกัน) · ตัวแยกชนิด dayo_pos_dispatch ·
--                      เก็บใต้ key เฉพาะ accepted/duplicate (ตัวชนิดคืน rejected + data ได้)
--   dayo_pos_map_error: + p_col (ธง S5) · 23505 หาใหม่ข้าม key/ตามชนิด · DY404 ของแถวกะ = PARENT_PENDING · receipt_taken:
--   dayo_pos_order: หาบิลด้วย (shop_id, pos_order_id) ข้าม key (R4-2) · off_catalog_exists:/exists: + data · receipt_taken:
--   dayo_pos_void: คำนำหน้า rule:
--   api_pos_push: นอก savepoint — pos_push_rejections · บันทึกข้อมูลกะชนกัน (S5) · แจ้ง scope: วันละครั้งต่อ key
-- ใหม่: dayo_pos_verdict_s5 · dayo_pos_exists_verdict · dayo_pos_id_field · dayo_pos_is_shift_kind · dayo_pos_shift_open ·
--       dayo_pos_cash_movement · dayo_pos_cash_count · dayo_pos_dispatch · dayo_pos_record_shift_conflict · dayo_shift_overlap_alert

-- ═════════════════════════════════════════════════════════════════════════════════
-- 1. ตัวช่วย
-- ═════════════════════════════════════════════════════════════════════════════════
-- คำตัดสินที่เป็น "ข้อมูลกะชนกัน" (S5): ย้อนแถวเหมือน DYPV0 แต่ api_pos_push บันทึกการชนนอก savepoint (ชนิดการชนอยู่ใน column_name)
create or replace function public.dayo_pos_verdict_s5(p_status text, p_reason text, p_detail text, p_s5 text)
returns void
language plpgsql
volatile
set search_path = public
as $$
begin
  raise exception using errcode = 'DYPV5', message = p_status, detail = p_reason, hint = left(coalesce(p_detail, ''), 500), column = p_s5;
end;
$$;

-- CONFLICT exists:/off_catalog_exists: พร้อม data (m2) — แท็บเล็ตอ่าน order_no จาก data เท่านั้น (R3-m4)
create or replace function public.dayo_pos_exists_verdict(o public.orders, p_prefix text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'status', 'rejected', 'reason', 'CONFLICT',
    'detail', p_prefix || o.order_no || case when o.off_catalog then ' บิลนี้ถูกปิดเป็นบิลนอกแคตตาล็อกในระบบกลางแล้ว' else ' บิลนี้อยู่ในระบบกลางแล้ว' end,
    'data', jsonb_build_object(
      'order_no', o.order_no,
      'version', o.version,
      'reported_total', coalesce((o.pos_reported_amounts ->> 'total')::numeric, o.total_amount),
      'payment_is_cash', coalesce(o.pos_reported_amounts ->> 'payment',
        (select pm.code from public.payment_methods pm where pm.id = o.payment_method_id and pm.shop_id = o.shop_id)) is not distinct from 'cash',
      'off_catalog', o.off_catalog))
$$;

create or replace function public.dayo_pos_id_field(p_kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_kind when 'shift_open' then 'shift_id' when 'shift_close' then 'shift_id'
                     when 'cash_movement' then 'movement_id' when 'cash_count' then 'count_id' else 'pos_order_id' end
$$;

create or replace function public.dayo_pos_is_shift_kind(p_kind text)
returns boolean
language sql
immutable
set search_path = public
as $$ select coalesce(p_kind in ('shift_open', 'cash_movement', 'cash_count', 'shift_close'), false) $$;

-- "กะซ้อนกัน" (C3): ช่วง [opened_at, counted_at] ของกะใน key เดียวกันทับกัน — ตรวจเมื่อรู้ counted_at ของทั้งสองกะ (ตีความข้อ 7)
create or replace function public.dayo_shift_overlap_alert(p_shop_id uuid, p_client_id uuid, p_shift_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_other uuid;
begin
  select s.opened_at, c.counted_at into v_start, v_end
  from public.shifts s join public.cash_counts c on c.shift_id = s.id
  where s.id = p_shift_id and s.shop_id = p_shop_id and s.api_client_id = p_client_id;
  if not found then
    return;
  end if;
  select s2.id into v_other
  from public.shifts s2 join public.cash_counts c2 on c2.shift_id = s2.id
  where s2.shop_id = p_shop_id and s2.api_client_id = p_client_id and s2.id <> p_shift_id
    and s2.opened_at < v_end and v_start < c2.counted_at
  order by s2.opened_at
  limit 1;
  if found then
    perform public.dayo_pos_alert(p_shop_id, 'warning', 'overlap',
      'overlap:' || least(p_shift_id, v_other)::text || ':' || greatest(p_shift_id, v_other)::text,
      'กะซ้อนกันบนเครื่องเดียวกัน — ดูที่ /shifts/' || p_shift_id::text);
  end if;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 2. shift_open (สเปก §4.10 ก้อน 3)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_pos_shift_open(p_shop_id uuid, p_client_id uuid, d jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := (d ->> 'shift_id')::uuid;
  v_date date := public.dayo_pos_date(d -> 'business_date');
  v_at timestamptz := public.dayo_pos_ts(d -> 'opened_at');
  v_by uuid;
  s public.shifts;
  v_n integer;
begin
  -- ── รูป ──
  if v_date is null then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'business_date ต้องเป็นวันที่ YYYY-MM-DD');
  end if;
  if v_at is null then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'opened_at ต้องเป็นเวลา ISO-8601 (UTC)');
  end if;
  if not public.dayo_pos_is_uuid(d -> 'opened_by') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'opened_by ต้องเป็น uuid');
  end if;
  v_by := (d ->> 'opened_by')::uuid;
  if not public.dayo_pos_is_money(d -> 'opening_float') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'opening_float ต้องเป็นบาท ≥ 0 ทศนิยมไม่เกิน 2 ตำแหน่ง');
  end if;
  if public.dayo_jt(d -> 'quick_open') <> 'boolean' then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'quick_open ต้องเป็น true/false');
  end if;
  -- ── เวลา ──
  if v_at > now() + interval '5 minutes' then
    perform public.dayo_pos_verdict('deferred', 'CLOCK_AHEAD',
      format('opened_at %s เกินเวลาเซิร์ฟเวอร์', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  if v_at < now() - interval '60 days' then
    perform public.dayo_pos_verdict('rejected', 'INVALID',
      format('opened_at %s ย้อนหลังเกิน 60 วัน', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  if v_date <> (v_at at time zone 'Asia/Bangkok')::date then
    perform public.dayo_pos_verdict('rejected', 'INVALID',
      format('business_date %s ไม่ตรงกับวันที่ไทยของ opened_at (%s)', v_date, (v_at at time zone 'Asia/Bangkok')::date));
  end if;
  if v_date > public.dayo_today() then
    perform public.dayo_pos_verdict('deferred', 'CLOCK_AHEAD', format('business_date %s เป็นวันพรุ่งนี้ของเซิร์ฟเวอร์', v_date));
  end if;
  -- ── พนักงาน (ระบุตัว ไม่ใช่สิทธิ์ — ADR-0040) ──
  if not public.dayo_pos_staff_ok(p_shop_id, v_by) then
    perform public.dayo_pos_verdict('rejected', 'UNKNOWN_STAFF', 'ไม่พบพนักงานผู้เปิดกะของร้านนี้');
  end if;
  if (d ->> 'quick_open')::boolean and not public.dayo_pos_owner_active_at(p_shop_id, v_by, v_at) then
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'role: เปิดกะด่วนต้องเป็นเจ้าของที่ใช้งานอยู่ ณ เวลาเปิดกะ');
  end if;
  -- ── id เดิม (S4: ตรงเฉพาะ key เดียวกัน) ──
  select * into s from public.shifts x where x.id = v_id;
  if found then
    if s.shop_id = p_shop_id and s.api_client_id = p_client_id then
      return jsonb_build_object('status', 'duplicate', 'data', jsonb_build_object('shift_id', v_id));
    end if;
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'rule: id กะนี้เป็นของเครื่องอื่น');
  end if;

  insert into public.shifts (id, shop_id, api_client_id, business_date, opened_by, opened_at, opening_float, quick_open)
  values (v_id, p_shop_id, p_client_id, v_date, v_by, v_at, (d ->> 'opening_float')::numeric, (d ->> 'quick_open')::boolean);

  -- วันเริ่มใช้กะ: ตั้งครั้งเดียวจากว่าง เฉพาะกะของวันนี้/เมื่อวาน (D100 · m5) — ธุรกรรมเดียวกับแถวนี้
  if v_date >= public.dayo_today() - 1 then
    perform set_config('dayo.shift_writer', 'push', true);
    insert into public.shop_settings (shop_id, block3_live_from) values (p_shop_id, v_date)
    on conflict (shop_id) do update set block3_live_from = excluded.block3_live_from
      where public.shop_settings.block3_live_from is null;
    perform set_config('dayo.shift_writer', '', true);
  end if;

  -- เครื่องเดียวมีกะเกิน 3 กะในวันเดียว → 🟡 (m4)
  select count(*) into v_n from public.shifts x where x.api_client_id = p_client_id and x.business_date = v_date;
  if v_n > 3 then
    perform public.dayo_pos_alert(p_shop_id, 'warning', 'too_many_shifts', format('too_many:%s:%s', p_client_id, v_date),
      format('เครื่องเดียวเปิดกะเกิน 3 กะในวันที่ %s — ดูที่ /dashboard', public.dayo_thai_short_date(v_date)));
  end if;
  return jsonb_build_object('status', 'accepted', 'data', jsonb_build_object('shift_id', v_id));
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 3. cash_movement
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_pos_cash_movement(p_shop_id uuid, p_client_id uuid, d jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := (d ->> 'movement_id')::uuid;
  v_shift uuid;
  v_kind text;
  v_at timestamptz := public.dayo_pos_ts(d -> 'created_at');
  v_by uuid;
  v_order uuid;
  v_reason text;
  s public.shifts;
  m public.cash_movements;
  v_counted_at timestamptz;
begin
  if not public.dayo_pos_is_uuid(d -> 'shift_id') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'shift_id ต้องเป็น uuid');
  end if;
  v_shift := (d ->> 'shift_id')::uuid;
  if public.dayo_jt(d -> 'kind') <> 'string' or (d ->> 'kind') not in ('PAID_IN', 'PAID_OUT', 'DROP', 'VOID_REFUND') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'kind ต้องเป็น PAID_IN/PAID_OUT/DROP/VOID_REFUND');
  end if;
  v_kind := d ->> 'kind';
  if not public.dayo_pos_is_money(d -> 'amount') or (d ->> 'amount')::numeric = 0 then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'amount ต้องเป็นบาท > 0 ทศนิยมไม่เกิน 2 ตำแหน่ง');
  end if;
  if v_kind = 'VOID_REFUND' then
    if not public.dayo_pos_is_uuid(d -> 'pos_order_id') then
      perform public.dayo_pos_verdict('rejected', 'INVALID', 'VOID_REFUND ต้องมี pos_order_id');
    end if;
    v_order := (d ->> 'pos_order_id')::uuid;
    if public.dayo_pos_has(d, 'reason') and not public.dayo_pos_is_text(d -> 'reason', 200) then
      perform public.dayo_pos_verdict('rejected', 'INVALID', 'reason ต้องมี 1–200 ตัวอักษรหรือ null');
    end if;
  else
    if public.dayo_pos_has(d, 'pos_order_id') then
      perform public.dayo_pos_verdict('rejected', 'INVALID', 'pos_order_id ใช้กับ VOID_REFUND เท่านั้น');
    end if;
    if not public.dayo_pos_is_text(d -> 'reason', 200) then
      perform public.dayo_pos_verdict('rejected', 'INVALID', 'reason ต้องมี 1–200 ตัวอักษร (PAID_IN/PAID_OUT/DROP)');
    end if;
  end if;
  v_reason := case when public.dayo_pos_has(d, 'reason') then btrim(d ->> 'reason') end;
  if not public.dayo_pos_is_uuid(d -> 'created_by') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'created_by ต้องเป็น uuid');
  end if;
  v_by := (d ->> 'created_by')::uuid;
  if v_at is null then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'created_at ต้องเป็นเวลา ISO-8601 (UTC)');
  end if;
  if v_at > now() + interval '5 minutes' then
    perform public.dayo_pos_verdict('deferred', 'CLOCK_AHEAD',
      format('created_at %s เกินเวลาเซิร์ฟเวอร์', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  if v_at < now() - interval '60 days' then
    perform public.dayo_pos_verdict('rejected', 'INVALID',
      format('created_at %s ย้อนหลังเกิน 60 วัน', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  if not public.dayo_pos_staff_ok(p_shop_id, v_by) then
    perform public.dayo_pos_verdict('rejected', 'UNKNOWN_STAFF', 'ไม่พบพนักงานผู้บันทึกของร้านนี้');
  end if;
  select * into m from public.cash_movements x where x.id = v_id;
  if found then
    if m.shop_id = p_shop_id and m.api_client_id = p_client_id then
      return jsonb_build_object('status', 'duplicate', 'data', jsonb_build_object('movement_id', v_id));
    end if;
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'rule: id รายการนี้เป็นของเครื่องอื่น');
  end if;
  select * into s from public.shifts x where x.id = v_shift;
  if not found then
    perform public.dayo_pos_verdict('deferred', 'PARENT_PENDING', 'กะที่อ้างยังมาไม่ถึง');
  end if;
  if s.shop_id <> p_shop_id or s.api_client_id <> p_client_id then
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'rule: กะนี้เป็นของเครื่องอื่น');
  end if;
  if v_at < s.opened_at then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'created_at ต้องไม่ก่อนเวลาเปิดกะ');
  end if;
  select c.counted_at into v_counted_at from public.cash_counts c where c.shift_id = v_shift;
  if found and v_at > v_counted_at then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'created_at หลังเวลานับเงินของกะ (กะหยุดรับเงินเข้า-ออกแล้ว)');
  end if;
  insert into public.cash_movements (id, shop_id, api_client_id, shift_id, kind, amount, pos_order_id, reason, created_by, created_at)
  values (v_id, p_shop_id, p_client_id, v_shift, v_kind, (d ->> 'amount')::numeric, v_order, v_reason, v_by, v_at);
  return jsonb_build_object('status', 'accepted', 'data', jsonb_build_object('movement_id', v_id));
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 4. cash_count (นับปิดกะ — กะละครั้ง)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_pos_cash_count(p_shop_id uuid, p_client_id uuid, d jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := (d ->> 'count_id')::uuid;
  v_shift uuid;
  v_at timestamptz := public.dayo_pos_ts(d -> 'counted_at');
  v_by uuid;
  v_line jsonb;
  v_seen integer[] := '{}';
  v_den integer;
  v_sum numeric := 0;
  s public.shifts;
  c public.cash_counts;
begin
  if not public.dayo_pos_is_uuid(d -> 'shift_id') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'shift_id ต้องเป็น uuid');
  end if;
  v_shift := (d ->> 'shift_id')::uuid;
  if public.dayo_jt(d -> 'lines') <> 'array' or jsonb_array_length(d -> 'lines') <> 9 then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'lines ต้องมี 9 แถว (ธนบัตร/เหรียญชนิดละหนึ่ง)');
  end if;
  for v_line in select e from jsonb_array_elements(d -> 'lines') e loop
    if public.dayo_jt(v_line) <> 'object'
       or not public.dayo_pos_is_int(v_line -> 'denomination', 1, 1000)
       or (v_line ->> 'denomination')::integer not in (1000, 500, 100, 50, 20, 10, 5, 2, 1)
       or not public.dayo_pos_is_int(v_line -> 'count', 0, 99999) then
      perform public.dayo_pos_verdict('rejected', 'INVALID', 'lines ต้องเป็น {denomination, count} ของ 1000/500/100/50/20/10/5/2/1 บาท · count 0–99999');
    end if;
    v_den := (v_line ->> 'denomination')::integer;
    if v_den = any (v_seen) then
      perform public.dayo_pos_verdict('rejected', 'INVALID', 'ธนบัตร/เหรียญชนิดเดียวกันซ้ำใน lines');  -- ไม่สะท้อนตัวเลขที่ส่งมา (Global: detail)
    end if;
    v_seen := v_seen || v_den;
    v_sum := v_sum + v_den * (v_line ->> 'count')::numeric;
  end loop;
  if not public.dayo_pos_is_money(d -> 'counted') or (d ->> 'counted')::numeric <> v_sum then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'counted ไม่เท่ากับผลรวมธนบัตร/เหรียญ');
  end if;
  if not public.dayo_pos_is_uuid(d -> 'counted_by') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'counted_by ต้องเป็น uuid');
  end if;
  v_by := (d ->> 'counted_by')::uuid;
  if v_at is null then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'counted_at ต้องเป็นเวลา ISO-8601 (UTC)');
  end if;
  if v_at > now() + interval '5 minutes' then
    perform public.dayo_pos_verdict('deferred', 'CLOCK_AHEAD',
      format('counted_at %s เกินเวลาเซิร์ฟเวอร์', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  if v_at < now() - interval '60 days' then
    perform public.dayo_pos_verdict('rejected', 'INVALID',
      format('counted_at %s ย้อนหลังเกิน 60 วัน', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  if not public.dayo_pos_staff_ok(p_shop_id, v_by) then
    perform public.dayo_pos_verdict('rejected', 'UNKNOWN_STAFF', 'ไม่พบพนักงานผู้นับเงินของร้านนี้');
  end if;
  select * into c from public.cash_counts x where x.id = v_id;
  if found then
    if c.shop_id = p_shop_id and c.api_client_id = p_client_id then
      return jsonb_build_object('status', 'duplicate', 'data', jsonb_build_object('count_id', v_id));
    end if;
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'rule: id การนับนี้เป็นของเครื่องอื่น');
  end if;
  select * into s from public.shifts x where x.id = v_shift;
  if not found then
    perform public.dayo_pos_verdict('deferred', 'PARENT_PENDING', 'กะที่อ้างยังมาไม่ถึง');
  end if;
  if s.shop_id <> p_shop_id or s.api_client_id <> p_client_id then
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'rule: กะนี้เป็นของเครื่องอื่น');
  end if;
  if v_at < s.opened_at then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'counted_at ต้องไม่ก่อนเวลาเปิดกะ');
  end if;
  if exists (select 1 from public.cash_counts x where x.shift_id = v_shift) then
    perform public.dayo_pos_verdict_s5('rejected', 'CONFLICT', 'counted: กะนี้มีการนับเงินอีกใบแล้ว', 'counted');
  end if;
  insert into public.cash_counts (id, shop_id, api_client_id, shift_id, lines, counted, counted_by, counted_at)
  values (v_id, p_shop_id, p_client_id, v_shift, d -> 'lines', v_sum, v_by, v_at);
  perform set_config('dayo.shift_writer', 'push', true);
  update public.shifts x set status = 'counted' where x.id = v_shift and x.status = 'open';
  perform set_config('dayo.shift_writer', '', true);
  perform public.dayo_shift_overlap_alert(p_shop_id, p_client_id, v_shift);
  return jsonb_build_object('status', 'accepted', 'data', jsonb_build_object('count_id', v_id));
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 5. order (ลอก 0052:228-447) · order_void (ลอก 0052:452-534)
-- ═════════════════════════════════════════════════════════════════════════════════
```

  **`dayo_pos_order`**: ลอก `0052_pos_push.sql:228-447` ทุกบรรทัด แล้วแก้ 3 จุด (ป้าย `-- ADR-0056`): (1) ใน `declare` เพิ่มบรรทัด `v_o public.orders;` (2) แทน **บรรทัด 413–422** (บล็อก "กันซ้ำขั้น (2)") ด้วยบล็อกแรกข้างล่าง (3) แทน **บรรทัด 443–445** (`return` ท้ายฟังก์ชัน) ด้วยบล็อกที่สองข้างล่าง — ทางลัด "คืนบิลเดิม" ใน `dayo_impl_create_order` (`0051:981-987` และตัวจับ `unique_violation` `0051:1120-1127`) ยังหาด้วย `(api_client_id, pos_order_id)` และคืน `duplicate` โดยไม่ดู `off_catalog` · แทนที่จะลอกฟังก์ชัน 240 บรรทัดนั้น ให้ตรวจผลที่นี่แทน (ครอบทั้งสองทางลัด):

```sql
  -- ── กันซ้ำขั้น (2) — ADR-0056 (R4-2): หาด้วย (shop_id, pos_order_id) ข้ามทุก key ของร้าน ──
  --    บิลนอกแคตตาล็อกแล้ว = off_catalog_exists: · บิลของ key นี้ = duplicate · บิลของ key อื่น = exists: (+ data)
  select * into v_o from public.orders o where o.shop_id = p_shop_id and o.pos_order_id = v_pos_order_id;
  if found then
    if v_o.off_catalog then
      return public.dayo_pos_exists_verdict(v_o, 'off_catalog_exists:');
    elsif v_o.api_client_id = p_client_id then
      return jsonb_build_object('status', 'duplicate', 'data', public.dayo_pos_order_data(v_o.id, '[]'::jsonb));
    end if;
    return public.dayo_pos_exists_verdict(v_o, 'exists:');
  end if;
  if exists (select 1 from public.orders o
             where o.shop_id = p_shop_id and o.api_client_id = p_client_id and o.external_ref = v_receipt) then
    perform public.dayo_pos_verdict('rejected', 'CONFLICT', format('receipt_taken: เลขใบเสร็จ %s ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว', v_receipt));
  end if;
```

```sql
  -- ADR-0056: ทางลัด "คืนบิลเดิม" ของ create_order (0051:981-987, 1120-1127) ไม่ดู off_catalog —
  -- ถ้าบิลที่คืนมาเป็นบิลนอกแคตตาล็อก (อีกคำขอของ key เดียวกันเพิ่ง commit order_off_catalog ระหว่างขั้น (2) กับ create_order)
  -- ต้องตอบ off_catalog_exists: ไม่ใช่ duplicate (บิลเดียวไม่นับรายได้สองครั้ง — ไม่เกิดรายได้ซ้ำอยู่แล้ว แต่คำตัดสินต้องถูก)
  select * into v_o from public.orders o where o.id = (v_res ->> 'order_id')::uuid;
  if (v_res ->> 'duplicate')::boolean and v_o.off_catalog then
    return public.dayo_pos_exists_verdict(v_o, 'off_catalog_exists:');
  end if;
  return jsonb_build_object(
    'status', case when (v_res ->> 'duplicate')::boolean then 'duplicate' else 'accepted' end,
    'data', public.dayo_pos_order_data((v_res ->> 'order_id')::uuid, coalesce(v_res -> 'warnings', '[]'::jsonb)));
```

  **`dayo_pos_void`**: ลอก `0052_pos_push.sql:452-534` ทุกบรรทัด แล้วแก้ข้อความ 2 จุด (ป้าย `-- ADR-0056 คำนำหน้า rule:`): บรรทัด 502 → `'rule: บิลนี้ไม่ใช่ของเครื่องนี้'` · บรรทัด 514 → `format('rule: ยกเลิกได้เฉพาะวันเดียวกับวันขาย (voided_at %s ≠ sale_date %s)', …)` (อาร์กิวเมนต์เดิม)

  ต่อในไฟล์เดียวกัน:

```sql
-- ═════════════════════════════════════════════════════════════════════════════════
-- 6. ตัวแยกชนิด + ชนิด/ฟิลด์ที่รับ (ต้องตรงกัน — เทสต์บังคับ ADR-0049 ข้อ 7)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_pos_dispatch(p_shop_id uuid, p_client_id uuid, p_kind text, d jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  case p_kind
    when 'order' then return public.dayo_pos_order(p_shop_id, p_client_id, d);
    when 'order_void' then return public.dayo_pos_void(p_shop_id, p_client_id, d);
    when 'shift_open' then return public.dayo_pos_shift_open(p_shop_id, p_client_id, d);
    when 'cash_movement' then return public.dayo_pos_cash_movement(p_shop_id, p_client_id, d);
    when 'cash_count' then return public.dayo_pos_cash_count(p_shop_id, p_client_id, d);
    else
      perform public.dayo_pos_verdict('deferred', 'UNSUPPORTED', 'ชนิดแถวนี้ระบบกลางยังไม่รองรับ');
      return null;
  end case;
end;
$$;

-- ลอก 0049:235-252 + ชนิดกะ 3 ชนิด (Task 3 เพิ่ม order_off_catalog · Task 4 เพิ่ม shift_close)
create or replace function public.dayo_pos_supported()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'kinds', jsonb_build_array('order', 'order_void', 'shift_open', 'cash_movement', 'cash_count'),
    'fields', jsonb_build_object(
      'order', jsonb_build_array(
        'pos_order_id', 'receipt_no', 'queue_no', 'sale_date', 'sold_at', 'channel', 'payment', 'staff_id',
        'catalog_version', 'shift_id', 'lines', 'lines.code', 'lines.size', 'lines.sweetness', 'lines.milk', 'lines.grade',
        'lines.qty', 'lines.free', 'lines.discount_baht', 'lines.discount_percent', 'lines.discount_reason',
        'bill_discount', 'promo_code', 'skip_promotion_ids', 'no_promotions', 'totals', 'note'),
      'order_void', jsonb_build_array('pos_order_id', 'voided_at', 'staff_id', 'approved_by', 'reason'),
      'shift_open', jsonb_build_array('shift_id', 'business_date', 'opened_at', 'opened_by', 'opening_float', 'quick_open'),
      'cash_movement', jsonb_build_array('movement_id', 'shift_id', 'kind', 'amount', 'pos_order_id', 'reason', 'created_by', 'created_at'),
      'cash_count', jsonb_build_array('count_id', 'shift_id', 'lines', 'lines.denomination', 'lines.count', 'counted', 'counted_by', 'counted_at')
    )
  )
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 7. แถวเดียว (ลอก 0052:539-629 · แก้ตามป้าย ADR-0056)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_pos_push_row(p_shop_id uuid, p_client_id uuid, p_scopes text[], p_row jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_supported jsonb := public.dayo_pos_supported();
  v_key text;
  v_kind text;
  v_data jsonb;
  v_fields jsonb;
  v_hash text;
  v_idf text;
  k public.api_idempotency_keys;
  v_res jsonb;
  v_test text;
begin
  v_test := public.dayo_request_header('x-dayo-test-raise');
  if v_test is not null and not public.dayo_switch_on('test_hooks') then
    v_test := null;
  end if;
  if public.dayo_jt(p_row) <> 'object' then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'แถวต้องเป็นออบเจกต์ {key, kind, data}');
  end if;
  if public.dayo_jt(p_row -> 'key') <> 'string' or char_length(p_row ->> 'key') > 200
     or (p_row ->> 'key') !~ '^[a-z][a-z_]{0,39}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform public.dayo_pos_verdict('rejected', 'BAD_KEY', 'key ต้องเป็นรูป <kind>:<uuid>');
  end if;
  v_key := p_row ->> 'key';
  if v_test is not null and v_test = 'XX000:' || v_key then
    raise exception using errcode = 'XX000', message = 'test_raise';
  end if;
  if public.dayo_jt(p_row -> 'kind') <> 'string' then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'kind ต้องเป็นข้อความ');
  end if;
  v_kind := p_row ->> 'kind';
  if split_part(v_key, ':', 1) <> v_kind then
    perform public.dayo_pos_verdict('rejected', 'BAD_KEY', 'ชนิดใน key ไม่ตรงกับ kind');
  end if;
  if not (v_supported -> 'kinds') ? v_kind then
    perform public.dayo_pos_verdict('deferred', 'UNSUPPORTED', 'ชนิดแถวนี้ระบบกลางยังไม่รองรับ');
  end if;
  v_data := p_row -> 'data';
  if public.dayo_jt(v_data) <> 'object' then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'data ต้องเป็นออบเจกต์');
  end if;
  v_fields := v_supported -> 'fields' -> v_kind;
  if exists (select 1 from jsonb_object_keys(v_data) f where not v_fields ? f)
     or (public.dayo_jt(v_data -> 'lines') = 'array' and exists (
       select 1 from jsonb_array_elements(v_data -> 'lines') l, jsonb_object_keys(case when public.dayo_jt(l) = 'object' then l else '{}'::jsonb end) f
       where not v_fields ? ('lines.' || f))) then
    perform public.dayo_pos_verdict('deferred', 'UNSUPPORTED', 'มีฟิลด์ที่ระบบกลางยังไม่รองรับ');
  end if;
  -- ADR-0056: ขั้นตรวจ scope ต่อชนิด = ที่เดียวที่ออก scope: (m1)
  if not ('orders:write' = any (p_scopes)) then
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'scope: API key ไม่มีสิทธิ์ orders:write');
  end if;
  if public.dayo_pos_is_shift_kind(v_kind) and not ('shift:write' = any (p_scopes)) then
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'scope: API key ไม่มีสิทธิ์ shift:write');
  end if;
  -- ADR-0056: ช่อง id ตามชนิด (แทน pos_order_id ตายตัว 0052:596-600)
  v_idf := public.dayo_pos_id_field(v_kind);
  if not public.dayo_pos_is_uuid(v_data -> v_idf) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', format('%s ต้องเป็น uuid ตัวเล็ก', v_idf));
  end if;
  if split_part(v_key, ':', 2) <> v_data ->> v_idf then
    perform public.dayo_pos_verdict('rejected', 'BAD_KEY', format('uuid ใน key ไม่ตรงกับ %s', v_idf));
  end if;

  -- กันซ้ำ (1): เทียบ hash เนื้อหาก่อนเสมอ
  v_hash := encode(sha256(convert_to(v_data::text, 'UTF8')), 'hex');
  select * into k from public.api_idempotency_keys x
  where x.api_client_id = p_client_id and x.endpoint = 'pos_push' and x.idempotency_key = v_key;
  if found then
    if k.result is null then
      perform public.dayo_pos_verdict('deferred', 'BUSY', 'คีย์นี้กำลังบันทึกอยู่');
    end if;
    if k.request_hash = v_hash then
      return jsonb_build_object('status', 'duplicate', 'data', k.result);
    end if;
    -- ADR-0056 (S5): เนื้อหาแถวกะใต้ key เดิมเปลี่ยน = ข้อมูลกะชนกัน (อาจมีคนใช้กุญแจเครื่องนี้)
    if public.dayo_pos_is_shift_kind(v_kind) then
      perform public.dayo_pos_verdict_s5('rejected', 'CONFLICT', 'key_changed: key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว', 'key_changed');
    end if;
    perform public.dayo_pos_verdict('rejected', 'CONFLICT', 'key_changed: key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว');
  end if;

  v_res := public.dayo_pos_dispatch(p_shop_id, p_client_id, v_kind, v_data);

  -- เก็บเฉพาะผลที่บันทึกสำเร็จ — ADR-0056: ตัวชนิดคืน {status:'rejected', …, data} ได้ (exists:) → ไม่เก็บใต้ key
  if v_res ->> 'status' in ('accepted', 'duplicate') then
    insert into public.api_idempotency_keys (shop_id, api_client_id, endpoint, idempotency_key, request_hash, result)
    values (p_shop_id, p_client_id, 'pos_push', v_key, v_hash, v_res -> 'data')
    on conflict (api_client_id, endpoint, idempotency_key) do nothing;
  end if;
  return v_res;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 8. ตัวแปลง exception → คำตัดสิน (ลอก 0052:632-689 · ลายเซ็นใหม่ + p_col)
-- ═════════════════════════════════════════════════════════════════════════════════
drop function public.dayo_pos_map_error(uuid, uuid, jsonb, text, text, text, text);

create or replace function public.dayo_pos_map_error(
  p_shop_id uuid, p_client_id uuid, p_row jsonb, p_state text, p_msg text, p_det text, p_hint text, p_col text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_kind text := case when public.dayo_jt(p_row) = 'object' then p_row ->> 'kind' end;
  v_data jsonb := case when public.dayo_jt(p_row) = 'object' and public.dayo_jt(p_row -> 'data') = 'object' then p_row -> 'data' end;
  v_msg text := left(coalesce(p_msg, ''), 500);
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_id uuid;
  o public.orders;
begin
  if p_state = 'DYPV0' then
    return jsonb_build_object('status', p_msg, 'reason', p_det, 'detail', nullif(p_hint, ''));
  elsif p_state = 'DYPV5' then
    -- ADR-0056 (S5): คำตัดสินเดียวกัน + ธงให้ api_pos_push บันทึกการชนนอก savepoint (ไม่ออกไปถึงแท็บเล็ต)
    return jsonb_build_object('status', p_msg, 'reason', p_det, 'detail', nullif(p_hint, ''), 's5', coalesce(p_col, 'unknown'));
  elsif p_state = 'DY422' then
    if v_msg like 'unknown_code:%' then
      return jsonb_build_object('status', 'rejected', 'reason', 'UNKNOWN_CODE', 'detail', btrim(substr(v_msg, 14)));
    end if;
    return jsonb_build_object('status', 'rejected', 'reason', 'INVALID', 'detail', v_msg);
  elsif p_state = 'DY401' then
    if v_msg like 'staff%' then
      return jsonb_build_object('status', 'rejected', 'reason', 'UNKNOWN_STAFF', 'detail', 'ไม่พบพนักงานของร้านนี้');
    end if;
    return jsonb_build_object('status', 'deferred', 'reason', 'SERVER_ERROR', 'detail', 'DY401');
  elsif p_state = 'DY403' then
    return jsonb_build_object('status', 'rejected', 'reason', 'FORBIDDEN', 'detail', v_msg);
  elsif p_state = 'DY404' then
    -- ADR-0056: แถวที่อ้างกะ/การนับ/บิลที่ยังไม่มา = รอ (ไม่ตอบ "ไม่พบ" แบบถาวร)
    if v_kind in ('order_void', 'cash_movement', 'cash_count', 'shift_close') then
      return jsonb_build_object('status', 'deferred', 'reason', 'PARENT_PENDING', 'detail', 'แถวที่อ้างยังมาไม่ถึง');
    end if;
    return jsonb_build_object('status', 'rejected', 'reason', 'UNKNOWN_CODE', 'detail', v_msg);
  elsif p_state = 'DY409' then
    if v_msg like 'external_ref_taken%' then
      return jsonb_build_object('status', 'rejected', 'reason', 'CONFLICT',
        'detail', 'receipt_taken: ' || btrim(regexp_replace(v_msg, '^external_ref_taken:\s*', '')));
    elsif v_msg like 'idempotency_in_progress%' or v_msg like 'duplicate_event%' then
      return jsonb_build_object('status', 'deferred', 'reason', 'BUSY', 'detail', 'DY409');
    end if;
    return jsonb_build_object('status', 'deferred', 'reason', 'SERVER_ERROR', 'detail', 'DY409');
  elsif p_state = '23505' then
    -- ADR-0056 (m3 · R4-2): หาใหม่ตามชนิด
    if v_kind in ('order', 'order_off_catalog') and coalesce(v_data ->> 'pos_order_id', '') ~ v_uuid then
      select * into o from public.orders x where x.shop_id = p_shop_id and x.pos_order_id = (v_data ->> 'pos_order_id')::uuid;
      if found then
        if o.api_client_id = p_client_id and o.off_catalog = (v_kind = 'order_off_catalog') then
          return jsonb_build_object('status', 'duplicate', 'data', case when v_kind = 'order'
            then public.dayo_pos_order_data(o.id, '[]'::jsonb)
            else jsonb_build_object('order_no', o.order_no, 'version', o.version) end);
        end if;
        return public.dayo_pos_exists_verdict(o, case when o.off_catalog then 'off_catalog_exists:' else 'exists:' end);
      end if;
      if exists (select 1 from public.orders x
                 where x.shop_id = p_shop_id and x.api_client_id = p_client_id and x.external_ref = v_data ->> 'receipt_no') then
        return jsonb_build_object('status', 'rejected', 'reason', 'CONFLICT',
          'detail', format('receipt_taken: เลขใบเสร็จ %s ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว', left(v_data ->> 'receipt_no', 20)));
      end if;
    elsif public.dayo_pos_is_shift_kind(v_kind) and coalesce(v_data ->> public.dayo_pos_id_field(v_kind), '') ~ v_uuid then
      v_id := (v_data ->> public.dayo_pos_id_field(v_kind))::uuid;
      if v_kind = 'shift_open' and exists (select 1 from public.shifts x where x.id = v_id and x.shop_id = p_shop_id and x.api_client_id = p_client_id) then
        return jsonb_build_object('status', 'duplicate', 'data', jsonb_build_object('shift_id', v_id));
      elsif v_kind = 'cash_movement' and exists (select 1 from public.cash_movements x where x.id = v_id and x.shop_id = p_shop_id and x.api_client_id = p_client_id) then
        return jsonb_build_object('status', 'duplicate', 'data', jsonb_build_object('movement_id', v_id));
      elsif v_kind = 'cash_count' and exists (select 1 from public.cash_counts x where x.id = v_id and x.shop_id = p_shop_id and x.api_client_id = p_client_id) then
        return jsonb_build_object('status', 'duplicate', 'data', jsonb_build_object('count_id', v_id));
      -- S4: id ชนแถวของ key/ร้านอื่น = FORBIDDEN rule: (ไม่ใช่ข้อมูลกะชนกัน — ไม่มีธง s5)
      elsif (v_kind = 'shift_open' and exists (select 1 from public.shifts x where x.id = v_id))
         or (v_kind = 'cash_movement' and exists (select 1 from public.cash_movements x where x.id = v_id))
         or (v_kind = 'cash_count' and exists (select 1 from public.cash_counts x where x.id = v_id))
         or (v_kind = 'shift_close' and exists (select 1 from public.z_reports x where x.shift_id = v_id
                                                 and (x.shop_id <> p_shop_id or x.api_client_id <> p_client_id))) then
        return jsonb_build_object('status', 'rejected', 'reason', 'FORBIDDEN', 'detail', 'rule: id นี้เป็นของเครื่องอื่น');
      elsif v_kind = 'cash_count' then
        return jsonb_build_object('status', 'rejected', 'reason', 'CONFLICT', 'detail', 'counted: กะนี้มีการนับเงินอีกใบแล้ว', 's5', 'counted');
      elsif v_kind = 'shift_close' and exists (select 1 from public.z_reports x where x.shift_id = v_id and x.shop_id = p_shop_id and x.api_client_id = p_client_id) then
        return jsonb_build_object('status', 'duplicate', 'data', jsonb_build_object('shift_id', v_id));
      elsif v_kind = 'shift_close' then
        return jsonb_build_object('status', 'rejected', 'reason', 'CONFLICT', 'detail', 'z_no_taken: เลขใบปิดกะนี้ถูกใช้แล้วในเครื่องนี้', 's5', 'z_no_taken');
      end if;
    end if;
    return jsonb_build_object('status', 'rejected', 'reason', 'CONFLICT', 'detail', 'SQLSTATE 23505');
  elsif p_state in ('23502', '23514', '22001', '22003', '22007', '22008', '22021', '22P02', '22P05') then
    return jsonb_build_object('status', 'rejected', 'reason', 'INVALID', 'detail', 'SQLSTATE ' || p_state);
  elsif p_state in ('40001', '40P01', '55P03', '57014') then
    return jsonb_build_object('status', 'deferred', 'reason', 'BUSY', 'detail', 'SQLSTATE ' || p_state);
  end if;
  return jsonb_build_object('status', 'deferred', 'reason', 'SERVER_ERROR', 'detail', 'SQLSTATE ' || coalesce(p_state, '?'));
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 9. บันทึกข้อมูลกะชนกัน (S5 · R3-m7) — เรียกนอก savepoint ของแถว · ผู้ส่งคนแรกชนะ (ข้อมูลในฐานไม่เปลี่ยนนอกจากธง)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_pos_record_shift_conflict(p_shop_id uuid, p_client_id uuid, p_row jsonb, p_s5 text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_data jsonb := case when public.dayo_jt(p_row -> 'data') = 'object' then p_row -> 'data' else '{}'::jsonb end;
  v_kind text := p_row ->> 'kind';
  v_shift uuid := case when public.dayo_pos_is_uuid(v_data -> 'shift_id') then (v_data ->> 'shift_id')::uuid end;
  v_new text := encode(sha256(convert_to(v_data::text, 'UTF8')), 'hex');
  v_old text;
  v_mine boolean;
begin
  if p_s5 = 'key_changed' then
    select k.request_hash into v_old from public.api_idempotency_keys k
    where k.api_client_id = p_client_id and k.endpoint = 'pos_push' and k.idempotency_key = p_row ->> 'key';
  elsif p_s5 in ('counted', 'counted_mismatch') then
    select encode(sha256(convert_to((to_jsonb(cc) - 'received_at')::text, 'UTF8')), 'hex') into v_old
    from public.cash_counts cc where cc.shift_id = v_shift;
  elsif p_s5 = 'z_no_taken' and public.dayo_pos_is_int(v_data #> '{z_report,z_no}', 1, 2147483647) then
    select encode(sha256(convert_to(z.snapshot::text, 'UTF8')), 'hex') into v_old
    from public.z_reports z where z.api_client_id = p_client_id and z.z_no = (v_data #>> '{z_report,z_no}')::integer;
  end if;
  v_mine := v_shift is not null and exists (
    select 1 from public.shifts s where s.id = v_shift and s.shop_id = p_shop_id and s.api_client_id = p_client_id);

  insert into public.audit_log (shop_id, entity, entity_id, action, before, after, staff_id, api_client_id)
  values (p_shop_id, 'shifts', case when v_mine then v_shift end, 'shift_data_conflict',
    jsonb_build_object('sha256', v_old),
    jsonb_build_object('sha256', v_new, 'kind', v_kind, 'conflict', p_s5, 'key', left(p_row ->> 'key', 200)),
    null, p_client_id);

  if v_mine then
    perform set_config('dayo.shift_writer', 'conflict', true);
    update public.shifts x set data_conflict = true where x.id = v_shift and not x.data_conflict;
    perform set_config('dayo.shift_writer', '', true);
  end if;
  perform public.dayo_pos_alert(p_shop_id, 'error', 'shift_conflict',
    format('conflict:%s:%s', coalesce(v_shift::text, '-'), v_new),
    'ข้อมูลกะชนกัน — ตรวจกุญแจเครื่อง' || case when v_mine then ' — ดูที่ /shifts/' || v_shift::text else '' end);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 10. api_pos_push (ลอก 0052:694-777 · แก้ตามป้าย ADR-0056)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.api_pos_push(
  p_shop_id uuid, p_api_client_id uuid, p_scopes text[] default null, p_body text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  c public.api_clients;
  v_scopes text[];
  v_body jsonb;
  v_row jsonb;
  v_ord bigint;
  v_key_out text;
  v_kind text;
  v_data jsonb;
  v_verdict jsonb;
  v_results jsonb := '[]'::jsonb;
  v_state text;
  v_msg text;
  v_det text;
  v_hint text;
  v_col text;
begin
  if p_shop_id is null or p_api_client_id is null then
    raise exception using errcode = 'DY401', message = 'actor_required: ต้องระบุร้านและ API client';
  end if;
  select * into c from public.api_clients x where x.id = p_api_client_id and x.shop_id = p_shop_id;
  if not found or not c.is_active then
    raise exception using errcode = 'DY401', message = 'api_client_not_active: API client ไม่ถูกต้องหรือถูกปิด';
  end if;
  v_scopes := case when p_scopes is null then c.scopes
                   else array(select s from unnest(c.scopes) s where s = any (p_scopes)) end;
  if not ('orders:write' = any (v_scopes)) then
    raise exception using errcode = 'DY403', message = 'forbidden: API key ไม่มีสิทธิ์ orders:write';
  end if;
  perform set_config('dayo.shop_id', p_shop_id::text, true);
  perform set_config('dayo.api_client_id', c.id::text, true);

  if p_body is null or octet_length(p_body) > 262144 then
    raise exception using errcode = 'DY422', message = 'invalid: body ต้องเป็น JSON ไม่เกิน 256 KB';
  end if;
  begin
    v_body := p_body::jsonb;
  exception when others then
    raise exception using errcode = 'DY422', message = 'invalid: body ไม่ใช่ JSON';
  end;
  if public.dayo_jt(v_body) <> 'object' or public.dayo_jt(v_body -> 'rows') <> 'array' then
    raise exception using errcode = 'DY422', message = 'invalid: ต้องมี rows เป็น array';
  end if;
  if jsonb_array_length(v_body -> 'rows') not between 1 and 20 then
    raise exception using errcode = 'DY422', message = 'invalid: rows ต้องมี 1–20 แถว';
  end if;

  for v_row, v_ord in select e, o from jsonb_array_elements(v_body -> 'rows') with ordinality t(e, o) loop
    v_key_out := case when public.dayo_jt(v_row) = 'object' and public.dayo_jt(v_row -> 'key') = 'string' then left(v_row ->> 'key', 200) end;
    v_kind := case when public.dayo_jt(v_row) = 'object' and public.dayo_jt(v_row -> 'kind') = 'string' then v_row ->> 'kind' end;
    v_data := case when public.dayo_jt(v_row) = 'object' and public.dayo_jt(v_row -> 'data') = 'object' then v_row -> 'data' end;
    begin
      v_verdict := public.dayo_pos_push_row(p_shop_id, c.id, v_scopes, v_row);
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_det = pg_exception_detail,
                              v_hint = pg_exception_hint, v_col = column_name;
      v_verdict := public.dayo_pos_map_error(p_shop_id, c.id, v_row, v_state, v_msg, v_det, v_hint, v_col);
      if v_verdict ->> 'status' = 'duplicate' and v_key_out is not null and v_verdict ? 'data' then
        begin
          insert into public.api_idempotency_keys (shop_id, api_client_id, endpoint, idempotency_key, request_hash, result)
          values (p_shop_id, c.id, 'pos_push', v_key_out, encode(sha256(convert_to((v_row -> 'data')::text, 'UTF8')), 'hex'), v_verdict -> 'data')
          on conflict (api_client_id, endpoint, idempotency_key) do nothing;
        exception when others then
          null;
        end;
      end if;
    end;

    -- ── ADR-0056: นอก savepoint ของแถว (แถวถูกปฏิเสธแล้วสิ่งเหล่านี้ต้องไม่ถูกย้อน) · แต่ละอย่างไม่ทำให้คำขอล้ม ──
    -- (ก) ประวัติแถว order ที่ถูกปฏิเสธ — ใช้ตัดสิน order_off_catalog (S1(a) · R3-C) · เก็บทุกเหตุผล ชนแล้วข้าม
    if v_verdict ->> 'status' = 'rejected' and v_kind = 'order' and public.dayo_pos_is_uuid(v_data -> 'pos_order_id') then
      begin
        insert into public.pos_push_rejections (shop_id, api_client_id, pos_order_id, reason)
        values (p_shop_id, c.id, (v_data ->> 'pos_order_id')::uuid, v_verdict ->> 'reason')
        on conflict (api_client_id, pos_order_id, reason) do nothing;
      exception when others then
        raise warning 'pos_push_rejections insert failed: %', sqlstate;
      end;
    end if;
    -- (ข) ข้อมูลกะชนกัน (S5)
    if v_verdict ? 's5' then
      begin
        perform public.dayo_pos_record_shift_conflict(p_shop_id, c.id, v_row, v_verdict ->> 's5');
      exception when others then
        raise warning 'dayo_pos_record_shift_conflict failed: %', sqlstate;
      end;
    end if;
    -- (ค) key ไม่มี scope ของชนิดกะ → 🟡 วันละครั้งต่อ key (m1)
    if v_verdict ->> 'status' = 'rejected' and v_verdict ->> 'reason' = 'FORBIDDEN' and coalesce(v_verdict ->> 'detail', '') like 'scope:%' then
      begin
        perform public.dayo_pos_alert(p_shop_id, 'warning', 'scope', format('scope:%s:%s', c.id, public.dayo_today()),
          format('กุญแจเครื่อง POS ถูกปฏิเสธเพราะไม่มีสิทธิ์ %s — เพิ่มสิทธิ์ที่ /settings/api-clients',
            coalesce(substring(v_verdict ->> 'detail' from 'สิทธิ์ ([a-z]+:[a-z]+)'), 'ที่ต้องใช้')));
      exception when others then
        raise warning 'scope alert failed: %', sqlstate;
      end;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object('key', v_key_out, 'status', v_verdict ->> 'status')
      || case when v_verdict ->> 'reason' is not null then jsonb_build_object('reason', v_verdict ->> 'reason') else '{}'::jsonb end
      || case when v_verdict ->> 'detail' is not null then jsonb_build_object('detail', v_verdict ->> 'detail') else '{}'::jsonb end
      || case when coalesce(v_verdict -> 'data', 'null'::jsonb) <> 'null'::jsonb
              then jsonb_build_object('data', v_verdict -> 'data') else '{}'::jsonb end);
  end loop;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'server_time', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"'),
    'results', v_results));
end;
$$;

-- ── สิทธิ์: เฉพาะ service_role ─────────────────────────────────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
-- 0054: บอทลูกค้าเรียกด้วย publishable key — ต้องให้ anon ซ้ำทุก migration ที่ revoke ทั้งหมด (ADR-0062 · ไม่งั้นบอทลูกค้าพังบน production)
grant execute on function public.customer_shop_info(uuid) to anon;
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npm run db:reset && npm run db:types && npx vitest run --root packages/shared test/db/pos_push_shift.db.test.ts test/db/block3_schema.db.test.ts test/db/customer_bot.db.test.ts`
Expected: PASS · `block3_schema` เคส "unique บิล POS" ยังได้ `CONFLICT` (ตอนนี้ detail = `exists:…`)

- [ ] **Step 5: เทสต์เดิมกับคำนำหน้าใหม่**

Run: `npx vitest run --root packages/shared test/db/pos_push.db.test.ts`
Expected: PASS ยกเว้น assertion ที่เทียบ `detail` ตรงตัวของ (ก) ใบเสร็จชน (ข) ยกเลิกบิลของเครื่องอื่น (ค) ยกเลิกคนละวัน (ง) key เดิมเนื้อหาต่าง · แก้ **เฉพาะ assertion เหล่านี้** ให้ขึ้นต้นด้วย `receipt_taken:` / `rule:` / `rule:` / `key_changed:` ตามลำดับ (คอมเมนต์ `// ADR-0056 คำนำหน้า detail`) · คำตัดสิน (`status`/`reason`) ต้องไม่เปลี่ยน — ถ้าเปลี่ยน = บั๊ก หยุดแก้โค้ด ไม่แก้เทสต์

- [ ] **Step 6: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add supabase/migrations/0056_pos_push_shift_kinds.sql packages/shared/test/db/pos_push_shift.db.test.ts packages/shared/test/db/pos_push.db.test.ts packages/shared/src/database.types.ts
git commit -m "feat(db): accept shift open, cash movement and cash count rows from pos"
```

---

## Task 3: บิลนอกแคตตาล็อก `order_off_catalog` (migration 0057)

**agent:** db-engineer · opus · high (lane A · ใช้ Docker) · **security-reviewer ตรวจ task นี้ก่อน merge** (ด่านจริงของ key ที่หลุด = พื้นล่าง + เพดาน + แจ้งทุกใบ — สเปก §7 ข้อ 4)

**Files:**
- Create: `supabase/migrations/0057_pos_off_catalog.sql`
- Create: `packages/shared/test/db/pos_off_catalog.db.test.ts`
- Modify: `packages/shared/src/database.types.ts`

**Interfaces:**
- Consumes: Task 1 (`orders.off_catalog*` · `pos_push_rejections` · `shop_settings.block3_live_from/off_catalog_max_total` · `dayo_pos_owner_active_at` · `dayo_pos_alert`) · Task 2 (`dayo_pos_exists_verdict` · `dayo_pos_dispatch` · `dayo_pos_supported`) · `order_counters` (0003) · `catalog_versions` (0049)
- Produces:
  - `dayo_pos_order_off_catalog(p_shop_id uuid, p_client_id uuid, d jsonb) → jsonb` · ผล `accepted`/`duplicate` = `{order_no, version}`
  - `orders` แถว `source='pos'` `off_catalog=true` `cost_total=null` `off_catalog_lines=[{code, name, size, sweetness, qty, unit_price, discount_per_cup, line_total}]` `pos_reported_amounts = totals + {payment}` `pos_computed_total=null` · `audit_log` action `order_off_catalog` (`after` = `{closed_by, closed_at, reason, original_reason}`) · `pos_alerts` kind `off_catalog` (1 แถวต่อบิล · รวมเป็นข้อความ "N ใบ" ตอนดึง)
  - `dayo_pos_supported()` + ชนิด `order_off_catalog` · `dayo_pos_dispatch` + ชนิด `order_off_catalog`

- [ ] **Step 1: เทสต์ที่ต้องตก** — `packages/shared/test/db/pos_off_catalog.db.test.ts`

```ts
// pos_off_catalog.db.test.ts — migration 0057 (ADR-0056 ข้อ 5 · สเปก POS §4.10 order_off_catalog · §9 ก้อน 3)
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { connectLocalSupabase, createTestShop, Db, expectDbError } from "./helpers.js";
import type { TestShop } from "./helpers.js";
import { MIN, T, ago, bkkDateOf, mkClient, offCatalogRow, orderRow, pusher, setupBlock3Shop, shiftOpenRow } from "./block3Fixtures.js";
import type { PushRow, RowResult } from "./block3Fixtures.js";

const sb = await connectLocalSupabase();
const v = (r: RowResult) => [r.status, r.reason ?? null];

describe.skipIf(!sb)("0057 บิลนอกแคตตาล็อก", () => {
  let svc: Db;
  let shop: TestShop;
  let client: string;
  let push: ReturnType<typeof pusher>;
  const one = async (row: PushRow, c = client) => (await push([row], c))[0]!;

  /** ส่งแถว order ที่จะถูกปฏิเสธ (ช่องทางไม่มีในร้าน = UNKNOWN_CODE) แล้วคืนแถว order_off_catalog ของบิลเดียวกัน */
  async function rejectedThenOffCatalog(over: Record<string, unknown> = {}, c = client, orderOver: Record<string, unknown> = { channel: "gone" }) {
    const id = randomUUID();
    const order = orderRow(shop, orderOver, id);
    expect((await one(order, c)).status).toBe("rejected");
    return offCatalogRow(shop, { receipt_no: order.data.receipt_no, sold_at: order.data.sold_at, sale_date: order.data.sale_date, ...over }, id);
  }

  beforeAll(async () => {
    svc = Db.service(sb!);
    shop = await createTestShop(svc, "b3-offcat");
    await setupBlock3Shop(svc, shop);
    client = await mkClient(svc, shop.shopId);
    push = pusher(svc, shop.shopId);
    expect((await one(shiftOpenRow(shop, { opened_at: new Date().toISOString() }))).status).toBe("accepted"); // ตั้ง block3_live_from = วันนี้
    // R3-m5: ให้บิลเก่ากว่า 60 วันผ่านพื้นล่าง — owner เลื่อนวันเริ่มใช้กะให้เก่าลง
    await svc.rpc("save_pos_cash_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { block3_live_from: bkkDateOf(ago(90 * 24 * 60 * MIN)) } });
  }, T);

  it("order ถูกปฏิเสธ → owner ปิด → accepted {order_no, version} · off_catalog · cost_total null · ไม่มี order_items/สต็อก · audit · แจ้ง 🟡 ไม่มียอดเงิน", async () => {
    const row = await rejectedThenOffCatalog({ channel: "grab" });
    const r = await one(row);
    expect(r.status).toBe("accepted");
    expect(r.data).toEqual({ order_no: expect.stringMatching(/^L\d{6}-\d{3,}$/), version: 1 });
    const [o] = await svc.select<Record<string, unknown>>("orders", `pos_order_id=eq.${row.data.pos_order_id}&select=*`);
    expect(o).toMatchObject({
      source: "pos", off_catalog: true, cost_total: null, pos_computed_total: null, amount_mismatch: false, promo_discount_total: 0,
      total_amount: 70, items_subtotal: 80, items_discount: 10, bill_discount_amount: 0, channel_fee_pct: 0.3, channel_fee_amount: 21,
      items_signature: null, external_ref: row.data.receipt_no, created_by: shop.staffId,
      pos_reported_amounts: { items_subtotal: 80, items_discount: 10, bill_discount: 0, total: 70, payment: "cash" },
    });
    expect((o!.off_catalog_lines as unknown[])[0]).toMatchObject({ name: "ชาไทยสูตรเก่า", qty: 2, unit_price: 40, line_total: 70 });
    expect(await svc.select("order_items", `order_id=eq.${o!.id}&select=id`)).toEqual([]);
    expect(await svc.select("stock_movements", `order_id=eq.${o!.id}&select=id`)).toEqual([]);
    const [a] = await svc.select<{ after: Record<string, unknown> }>("audit_log", `entity_id=eq.${o!.id}&action=eq.order_off_catalog&select=after`);
    expect(a!.after).toMatchObject({ closed_by: shop.ownerId, reason: "เมนูถูกลบจากระบบกลาง", original_reason: "UNKNOWN_CODE" });
    const al = await svc.select<{ level: string; message: string }>("pos_alerts", `shop_id=eq.${shop.shopId}&kind=eq.off_catalog&dedupe_key=eq.off_catalog:${o!.id}&select=level,message`);
    expect(al).toHaveLength(1);
    expect(al[0]!.message).not.toMatch(/฿|\d+\.\d{2}|70/);
    expect((await one(row)).status).toBe("duplicate");
    await svc.delete("api_idempotency_keys", `api_client_id=eq.${client}&idempotency_key=eq.${row.key}`);
    expect([(await one(row)).status, (await one(row)).data]).toEqual(["duplicate", r.data]);
  }, T);

  it("closed_by ไม่ใช่ owner = FORBIDDEN role: · พนักงานไม่รู้จัก = UNKNOWN_STAFF", async () => {
    const r = await one(await rejectedThenOffCatalog({ closed_by: shop.managerId }));
    expect(v(r)).toEqual(["rejected", "FORBIDDEN"]);
    expect(r.detail).toMatch(/^role:/);
    expect(v(await one(await rejectedThenOffCatalog({ closed_by: shop.pendingId })))).toEqual(["rejected", "UNKNOWN_STAFF"]);
  }, T);

  it("ยอดไม่ตรงสูตร / line_total ผิด / คีย์ย่อยแปลกใน totals / ส่วนลดเกินยอด = INVALID", async () => {
    const base = await rejectedThenOffCatalog();
    const bad = (data: Record<string, unknown>) => one({ ...base, data: { ...base.data, ...data } });
    expect(v(await bad({ totals: { items_subtotal: 80, items_discount: 10, bill_discount: 0, total: 71 } }))).toEqual(["rejected", "INVALID"]);
    expect(v(await bad({ totals: { items_subtotal: 81, items_discount: 10, bill_discount: 0, total: 71 } }))).toEqual(["rejected", "INVALID"]);
    expect(v(await bad({ lines: [{ code: null, name: "x", size: null, sweetness: null, qty: 2, unit_price: 40, discount_per_cup: 5, line_total: 80 }] }))).toEqual(["rejected", "INVALID"]);
    expect(v(await bad({ totals: { items_subtotal: 80, items_discount: 10, bill_discount: 0, total: 70, tip: 0 } }))).toEqual(["rejected", "INVALID"]);
    expect(v(await bad({ totals: { items_subtotal: 80, items_discount: 10, bill_discount: 75, total: 0 } }))).toEqual(["rejected", "INVALID"]);
    expect((await one(base)).status).toBe("accepted");
  }, T);

  it("เงื่อนไขปิด: ไม่เคยถูกปฏิเสธ / original_reason ไม่ตรง = FORBIDDEN rule: · เหตุผลใดก็ได้ที่เคยบันทึก = ผ่าน", async () => {
    const never = await one(offCatalogRow(shop));
    expect(v(never)).toEqual(["rejected", "FORBIDDEN"]);
    expect(never.detail).toMatch(/^rule:/);
    const id = randomUUID();
    const order = orderRow(shop, { channel: "gone" }, id);
    await one(order);
    await one({ ...order, data: { ...order.data, channel: "store", staff_id: randomUUID() } }); // UNKNOWN_STAFF
    const oc = (reason: string) => offCatalogRow(shop, { receipt_no: order.data.receipt_no, sold_at: order.data.sold_at, sale_date: order.data.sale_date, original_reason: reason }, id);
    expect(v(await one(oc("INVALID")))).toEqual(["rejected", "FORBIDDEN"]);
    expect((await one(oc("UNKNOWN_STAFF"))).status).toBe("accepted");
  }, T);

  it("เพดานต่อบิล (รอ Q72): เกิน = FORBIDDEN rule: → owner เพิ่มเพดาน → ส่ง key เดิมซ้ำผ่าน", async () => {
    await svc.rpc("save_pos_cash_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { off_catalog_max_total: 50 } });
    const row = await rejectedThenOffCatalog();
    const r = await one(row);
    expect([...v(r), r.detail?.slice(0, 5)]).toEqual(["rejected", "FORBIDDEN", "rule:"]);
    expect(r.detail).not.toMatch(/70|50/);
    await svc.rpc("save_pos_cash_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { off_catalog_max_total: 3000 } });
    expect((await one(row)).status).toBe("accepted");
  }, T);

  it("พื้นล่าง: ร้านที่ block3_live_from ว่าง = FORBIDDEN rule: · sold_at ต่ำกว่าวันเริ่มใช้กะ = rule:", async () => {
    const s2 = await createTestShop(svc, "b3-floor");
    await setupBlock3Shop(svc, s2);
    const c2 = await mkClient(svc, s2.shopId);
    const p2 = pusher(svc, s2.shopId);
    const id = randomUUID();
    const order = orderRow(s2, { channel: "gone" }, id);
    await p2([order], c2);
    const oc = offCatalogRow(s2, { receipt_no: order.data.receipt_no, sold_at: order.data.sold_at, sale_date: order.data.sale_date }, id);
    expect((await p2([oc], c2))[0]!.detail).toMatch(/^rule:/);
    await p2([shiftOpenRow(s2, { opened_at: new Date().toISOString() })], c2);
    const old = ago(3 * 24 * 60 * MIN);
    const id2 = randomUUID();
    const order2 = orderRow(s2, { channel: "gone", sold_at: old, sale_date: bkkDateOf(old) }, id2);
    await p2([order2], c2);
    const oc2 = offCatalogRow(s2, { receipt_no: order2.data.receipt_no, sold_at: old, sale_date: bkkDateOf(old) }, id2);
    expect((await p2([oc2], c2))[0]!.detail).toMatch(/^rule:/);
    expect((await p2([oc], c2))[0]!.status).toBe("accepted");
  }, T);

  it("ชนบิลในฐาน (ทั้งสองทิศ · ข้าม key — R4-2)", async () => {
    // บิลปกติ key นี้ → order_off_catalog = CONFLICT exists: + data
    const normal = orderRow(shop);
    const acc = await one(normal);
    const e1 = await one(offCatalogRow(shop, { receipt_no: normal.data.receipt_no }, normal.data.pos_order_id as string));
    expect(v(e1)).toEqual(["rejected", "CONFLICT"]);
    expect(e1.detail?.startsWith(`exists:${acc.data!.order_no}`)).toBe(true);
    expect(e1.data).toMatchObject({ order_no: acc.data!.order_no, reported_total: 35, payment_is_cash: true, off_catalog: false });
    // บิลนอกแคตตาล็อกแล้ว → แถว order = CONFLICT off_catalog_exists:
    const oc = await rejectedThenOffCatalog();
    const ocAcc = await one(oc);
    const back = orderRow(shop, { receipt_no: oc.data.receipt_no }, oc.data.pos_order_id as string);
    const e2 = await one(back);
    expect(v(e2)).toEqual(["rejected", "CONFLICT"]);
    expect(e2.detail?.startsWith(`off_catalog_exists:${ocAcc.data!.order_no}`)).toBe(true);
    expect(e2.data).toMatchObject({ off_catalog: true, reported_total: 70 });
    // เปลี่ยนกุญแจเครื่อง: บิลนอกแคตตาล็อกของ key เก่า ปิดซ้ำจาก key ใหม่ = off_catalog_exists: (ไม่ใช่ duplicate)
    const newKey = await mkClient(svc, shop.shopId);
    expect((await one(oc, newKey)).detail?.startsWith("off_catalog_exists:")).toBe(true);
    // บิลที่ key เก่าเคยถูกปฏิเสธ ปิดจาก key ใหม่ได้ (pos_push_rejections หาข้าม key ของร้าน)
    const id = randomUUID();
    const order = orderRow(shop, { channel: "gone" }, id);
    await one(order);
    expect((await one(offCatalogRow(shop, { receipt_no: order.data.receipt_no, sold_at: order.data.sold_at, sale_date: order.data.sale_date }, id), newKey)).status).toBe("accepted");
    // บิลรับแล้วใต้ key เก่า ปิดเป็นนอกแคตตาล็อกจาก key ใหม่ = exists:
    expect((await one(offCatalogRow(shop, { receipt_no: normal.data.receipt_no }, normal.data.pos_order_id as string), newKey)).detail?.startsWith("exists:")).toBe(true);
  }, T);

  it("order ที่ถูกปฏิเสธเพราะเก่ากว่า 60 วัน ปิดเป็นนอกแคตตาล็อกได้ (ไม่ใช้เพดาน 60 วันกับ sold_at) · closed_at เก่ากว่า 60 วัน = INVALID", async () => {
    const old = ago(70 * 24 * 60 * MIN);
    const id = randomUUID();
    const order = orderRow(shop, { sold_at: old, sale_date: bkkDateOf(old) }, id);
    expect(v(await one(order))).toEqual(["rejected", "INVALID"]);
    const oc = offCatalogRow(shop, { receipt_no: order.data.receipt_no, sold_at: old, sale_date: bkkDateOf(old), original_reason: "INVALID" }, id);
    expect(v(await one({ ...oc, data: { ...oc.data, closed_at: ago(61 * 24 * 60 * MIN) } }))).toEqual(["rejected", "INVALID"]);
    expect((await one(oc)).status).toBe("accepted");
  }, T);

  it("เวลาขายในอนาคต = deferred CLOCK_AHEAD · sale_date ≠ วันไทยของ sold_at = INVALID", async () => {
    const future = new Date(Date.now() + 7 * MIN).toISOString();
    expect(v(await one(offCatalogRow(shop, { sold_at: future, sale_date: bkkDateOf(future) })))).toEqual(["deferred", "CLOCK_AHEAD"]);
    expect(v(await one(offCatalogRow(shop, { sale_date: "2020-01-01" })))).toEqual(["rejected", "INVALID"]);
  }, T);

  it("order_void ของบิลนอกแคตตาล็อก = ยกเลิกได้ · owner ยกเลิกบนเว็บได้ · แก้รายการบนเว็บไม่ได้ (DY422)", async () => {
    const a = await rejectedThenOffCatalog();
    await one(a);
    const vr = await one({ key: `order_void:${a.data.pos_order_id}`, kind: "order_void",
      data: { pos_order_id: a.data.pos_order_id, voided_at: new Date().toISOString(), staff_id: shop.staffId, approved_by: shop.ownerId, reason: "ลูกค้าคืน" } });
    expect(vr.status).toBe("accepted");
    const b = await rejectedThenOffCatalog();
    const bAcc = await one(b);
    const upd = svc.rpc("update_order", { p_shop_id: shop.shopId, p_actor: { staff_id: shop.ownerId, via: "web" }, p_order_no: bAcc.data!.order_no,
      p_expected_version: 1, p_changes: { note: "แก้" }, p_reason: "ลองแก้" });
    expect((await expectDbError(upd)).code).toBe("DY422");
    const c = await svc.rpc<{ status: string }>("cancel_order", { p_shop_id: shop.shopId, p_actor: { staff_id: shop.ownerId, via: "web" }, p_order_no: bAcc.data!.order_no, p_reason: "ยกเลิกบิลนอกแคตตาล็อก" });
    expect(c.status).toBe("cancelled");
  }, T);

  it("supported_fields ของ order_off_catalog ครบ (รวม lines.*) · ฟิลด์เกิน = UNSUPPORTED", async () => {
    const sup = await svc.rpc<{ kinds: string[]; fields: Record<string, string[]> }>("dayo_pos_supported", {});
    expect(sup.kinds).toContain("order_off_catalog");
    const row = offCatalogRow(shop);
    expect(Object.keys(row.data).sort()).toEqual(sup.fields.order_off_catalog!.filter((f) => !f.includes(".")).sort());
    expect(sup.fields.order_off_catalog).toEqual(expect.arrayContaining(
      ["lines.code", "lines.name", "lines.size", "lines.sweetness", "lines.qty", "lines.unit_price", "lines.discount_per_cup", "lines.line_total"]));
    expect(v(await one({ ...row, data: { ...row.data, extra: 1 } }))).toEqual(["deferred", "UNSUPPORTED"]);
  }, T);
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npx vitest run --root packages/shared test/db/pos_off_catalog.db.test.ts`
Expected: FAIL — แถว `order_off_catalog` ได้ `deferred UNSUPPORTED`

- [ ] **Step 3: เขียน migration** — `supabase/migrations/0057_pos_off_catalog.sql`

```sql
-- 0057_pos_off_catalog — บิลนอกแคตตาล็อก (ADR-0056 ข้อ 5 · D91 · D97 · สเปก POS §4.10 order_off_catalog)
-- บันทึกเป็นบิลใน orders (source='pos' · off_catalog=true · cost_total=null · ไม่มี order_items · ไม่ตัดสต็อก)
-- กันซ้ำตาม §4.5 ข้อ 0: (1) hash ของ key (dayo_pos_push_row) (2) หาบิล (shop_id, pos_order_id) ข้าม key (3) receipt_taken:
-- (4) เงื่อนไขปิดฝั่งเซิร์ฟเวอร์ (S1): (ก) pos_push_rejections ของร้าน + original_reason ที่เคยบันทึก (ข) sold_at ≥ 00:00 ไทยของ
--     block3_live_from (ค) total ≤ off_catalog_max_total (รอ Q72 — ค่าเริ่มต้น) — ไม่ผ่าน = FORBIDDEN rule: · detail ไม่มียอดเงิน
-- (5) บันทึก + audit_log order_off_catalog + แจ้ง 🟡 นับใบ (ไม่มียอดเงิน — รอ Q73)

create or replace function public.dayo_pos_order_off_catalog(p_shop_id uuid, p_client_id uuid, d jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_pos_order_id uuid := (d ->> 'pos_order_id')::uuid;
  v_receipt text;
  v_sale_date date;
  v_sold_at timestamptz;
  v_staff uuid;
  v_closed_by uuid;
  v_closed_at timestamptz;
  v_reason text;
  v_orig text;
  v_line jsonb;
  v_i integer := 0;
  v_lines jsonb := '[]'::jsonb;
  v_sub numeric := 0;
  v_idisc numeric := 0;
  v_up numeric;
  v_dpc numeric;
  v_qty integer;
  v_totals jsonb;
  v_t_sub numeric;
  v_t_idisc numeric;
  v_t_bdisc numeric;
  v_t_total numeric;
  v_ch public.sales_channels;
  v_pm public.payment_methods;
  v_live date;
  v_max numeric;
  v_o public.orders;
  v_seq integer;
  v_order_no text;
  v_id uuid;
  v_version bigint := coalesce((select cv.version from public.catalog_versions cv where cv.shop_id = p_shop_id), 1);
begin
  -- ── รูป: ฟิลด์ร่วมกับแถว order (0052:254-286) ──
  if not public.dayo_pos_is_text(d -> 'receipt_no', 10) or (d ->> 'receipt_no') !~ '^[A-Z]{1,3}-[0-9]{6}$' then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'receipt_no ต้องเป็นรูป A-000123');
  end if;
  v_receipt := d ->> 'receipt_no';
  if not public.dayo_pos_is_int(d -> 'queue_no', 1, 9999) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'queue_no ต้องเป็นจำนวนเต็ม 1–9999');
  end if;
  v_sale_date := public.dayo_pos_date(d -> 'sale_date');
  if v_sale_date is null then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'sale_date ต้องเป็นวันที่ YYYY-MM-DD');
  end if;
  v_sold_at := public.dayo_pos_ts(d -> 'sold_at');
  if v_sold_at is null then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'sold_at ต้องเป็นเวลา ISO-8601 (UTC)');
  end if;
  if not public.dayo_pos_is_text(d -> 'channel', 100) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'channel ต้องเป็นรหัสช่องทางขาย');
  end if;
  if not public.dayo_pos_is_text(d -> 'payment', 100) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'payment ต้องเป็นรหัสวิธีชำระ');
  end if;
  if not public.dayo_pos_is_uuid(d -> 'staff_id') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'staff_id ต้องเป็น uuid');
  end if;
  v_staff := (d ->> 'staff_id')::uuid;
  if not public.dayo_pos_is_int(d -> 'catalog_version', 1, 9223372036854775807) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'catalog_version ต้องเป็นจำนวนเต็มตั้งแต่ 1');
  end if;
  if public.dayo_pos_has(d, 'shift_id') and not public.dayo_pos_is_uuid(d -> 'shift_id') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'shift_id ต้องเป็น uuid หรือ null');
  end if;
  if public.dayo_pos_has(d, 'note') and not public.dayo_pos_is_text(d -> 'note', 200) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'note ยาวได้ไม่เกิน 200 ตัวอักษร');
  end if;

  -- ── รายการตามที่แท็บเล็ตคิดตอนขาย (คีย์ย่อยที่ไม่รู้จักถูกกันที่ supported_fields แล้ว) ──
  if public.dayo_jt(d -> 'lines') <> 'array' or jsonb_array_length(d -> 'lines') not between 1 and 50 then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'lines ต้องมี 1–50 รายการ');
  end if;
  for v_line in select e from jsonb_array_elements(d -> 'lines') e loop
    v_i := v_i + 1;
    if public.dayo_jt(v_line) <> 'object'
       or (public.dayo_pos_has(v_line, 'code') and not public.dayo_pos_is_text(v_line -> 'code', 40))
       or not public.dayo_pos_is_text(v_line -> 'name', 100)
       or (public.dayo_pos_has(v_line, 'size') and not public.dayo_pos_is_text(v_line -> 'size', 20))
       or (public.dayo_pos_has(v_line, 'sweetness') and not public.dayo_pos_is_text(v_line -> 'sweetness', 10))
       or not public.dayo_pos_is_int(v_line -> 'qty', 1, 999)
       or not public.dayo_pos_is_money(v_line -> 'unit_price')
       or not public.dayo_pos_is_money(v_line -> 'discount_per_cup')
       or not public.dayo_pos_is_money(v_line -> 'line_total') then
      perform public.dayo_pos_verdict('rejected', 'INVALID',
        format('รายการที่ %s ข้อมูลไม่ครบหรือผิดรูป (name/qty/unit_price/discount_per_cup/line_total)', v_i));
    end if;
    v_up := (v_line ->> 'unit_price')::numeric;
    v_dpc := (v_line ->> 'discount_per_cup')::numeric;
    v_qty := (v_line ->> 'qty')::integer;
    if v_dpc > v_up then
      perform public.dayo_pos_verdict('rejected', 'INVALID', format('รายการที่ %s ส่วนลดต่อแก้วเกินราคา', v_i));
    end if;
    if (v_line ->> 'line_total')::numeric <> (v_up - v_dpc) * v_qty then
      perform public.dayo_pos_verdict('rejected', 'INVALID', format('รายการที่ %s line_total ไม่เท่ากับ (unit_price − discount_per_cup) × qty', v_i));
    end if;
    v_sub := v_sub + v_up * v_qty;
    v_idisc := v_idisc + v_dpc * v_qty;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'code', case when public.dayo_pos_has(v_line, 'code') then v_line ->> 'code' end,
      'name', btrim(v_line ->> 'name'),
      'size', case when public.dayo_pos_has(v_line, 'size') then v_line ->> 'size' end,
      'sweetness', case when public.dayo_pos_has(v_line, 'sweetness') then v_line ->> 'sweetness' end,
      'qty', v_qty, 'unit_price', v_up, 'discount_per_cup', v_dpc, 'line_total', (v_line ->> 'line_total')::numeric));
  end loop;
  v_totals := d -> 'totals';
  if public.dayo_jt(v_totals) <> 'object'
     or exists (select 1 from jsonb_object_keys(v_totals) k where k not in ('items_subtotal', 'items_discount', 'bill_discount', 'total'))
     or not public.dayo_pos_is_money(v_totals -> 'items_subtotal') or not public.dayo_pos_is_money(v_totals -> 'items_discount')
     or not public.dayo_pos_is_money(v_totals -> 'bill_discount') or not public.dayo_pos_is_money(v_totals -> 'total') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'totals ต้องมี items_subtotal, items_discount, bill_discount, total เป็นบาท ≥ 0 ทศนิยม ≤ 2 ตำแหน่ง');
  end if;
  v_t_sub := (v_totals ->> 'items_subtotal')::numeric;
  v_t_idisc := (v_totals ->> 'items_discount')::numeric;
  v_t_bdisc := (v_totals ->> 'bill_discount')::numeric;
  v_t_total := (v_totals ->> 'total')::numeric;
  -- สูตรเดียวกับ packages/shared/src/money.ts:284-291 · check orders_discount_le_subtotal (0003:139)
  if v_t_sub <> v_sub or v_t_idisc <> v_idisc then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'totals ไม่ตรงกับผลรวมของรายการ');
  end if;
  if v_t_idisc + v_t_bdisc > v_t_sub then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'ส่วนลดรวมเกินยอดก่อนลด');
  end if;
  if v_t_total <> greatest(0, v_t_sub - v_t_idisc - v_t_bdisc) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'total ไม่เท่ากับ max(0, items_subtotal − items_discount − bill_discount)');
  end if;
  if not public.dayo_pos_is_uuid(d -> 'closed_by') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'closed_by ต้องเป็น uuid');
  end if;
  v_closed_by := (d ->> 'closed_by')::uuid;
  v_closed_at := public.dayo_pos_ts(d -> 'closed_at');
  if v_closed_at is null then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'closed_at ต้องเป็นเวลา ISO-8601 (UTC)');
  end if;
  if not public.dayo_pos_is_text(d -> 'reason', 200) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'reason ต้องมี 1–200 ตัวอักษร');
  end if;
  v_reason := btrim(d ->> 'reason');
  if public.dayo_jt(d -> 'original_reason') <> 'string' or (d ->> 'original_reason') !~ '^[A-Z_]{1,40}$' then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'original_reason ต้องเป็นรหัสเหตุผล A-Z_ 1–40 ตัว');
  end if;
  v_orig := d ->> 'original_reason';

  -- ── เวลา: ไม่ใช้เพดาน 60 วันกับ sale_date/sold_at (ทางตัน (ก) §6.4) · 60 วันใช้กับ closed_at ──
  if v_sold_at > now() + interval '5 minutes' then
    perform public.dayo_pos_verdict('deferred', 'CLOCK_AHEAD',
      format('sold_at %s เกินเวลาเซิร์ฟเวอร์', to_char(v_sold_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  if v_sale_date <> (v_sold_at at time zone 'Asia/Bangkok')::date then
    perform public.dayo_pos_verdict('rejected', 'INVALID',
      format('sale_date %s ไม่ตรงกับวันที่ไทยของ sold_at (%s)', v_sale_date, (v_sold_at at time zone 'Asia/Bangkok')::date));
  end if;
  if v_sale_date > public.dayo_today() then
    perform public.dayo_pos_verdict('deferred', 'CLOCK_AHEAD', format('sale_date %s เป็นวันพรุ่งนี้ของเซิร์ฟเวอร์', v_sale_date));
  end if;
  if v_closed_at > now() + interval '5 minutes' then
    perform public.dayo_pos_verdict('deferred', 'CLOCK_AHEAD',
      format('closed_at %s เกินเวลาเซิร์ฟเวอร์', to_char(v_closed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  if v_closed_at < now() - interval '60 days' then
    perform public.dayo_pos_verdict('rejected', 'INVALID',
      format('closed_at %s ย้อนหลังเกิน 60 วัน', to_char(v_closed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  if v_closed_at < v_sold_at then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'closed_at ต้องไม่ก่อน sold_at');
  end if;

  -- ── พนักงาน ──
  if not public.dayo_pos_staff_ok(p_shop_id, v_staff) or not public.dayo_pos_staff_ok(p_shop_id, v_closed_by) then
    perform public.dayo_pos_verdict('rejected', 'UNKNOWN_STAFF', 'ไม่พบพนักงานผู้ขาย/ผู้ปิดบิลของร้านนี้');
  end if;
  if not public.dayo_pos_owner_active_at(p_shop_id, v_closed_by, v_closed_at) then
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'role: ผู้ปิดบิลนอกแคตตาล็อกต้องเป็นเจ้าของที่ใช้งานอยู่ ณ เวลาปิด');
  end if;

  -- ── รหัส (รวมที่ปิดใช้ — ADR-0049 ข้อ 5) ──
  select * into v_ch from public.sales_channels c where c.shop_id = p_shop_id and c.code = d ->> 'channel';
  if not found then
    perform public.dayo_pos_verdict('rejected', 'UNKNOWN_CODE', format('ไม่พบช่องทางขาย "%s"', left(d ->> 'channel', 40)));
  end if;
  select * into v_pm from public.payment_methods pm where pm.shop_id = p_shop_id and pm.code = d ->> 'payment';
  if not found then
    perform public.dayo_pos_verdict('rejected', 'UNKNOWN_CODE', format('ไม่พบวิธีชำระ "%s"', left(d ->> 'payment', 40)));
  end if;

  -- ── กันซ้ำ (2): หาบิลด้วย (shop_id, pos_order_id) ข้ามทุก key (R4-2) ──
  select * into v_o from public.orders o where o.shop_id = p_shop_id and o.pos_order_id = v_pos_order_id;
  if found then
    if v_o.off_catalog and v_o.api_client_id = p_client_id then
      return jsonb_build_object('status', 'duplicate', 'data', jsonb_build_object('order_no', v_o.order_no, 'version', v_o.version));
    elsif v_o.off_catalog then
      return public.dayo_pos_exists_verdict(v_o, 'off_catalog_exists:');
    end if;
    return public.dayo_pos_exists_verdict(v_o, 'exists:');
  end if;
  -- ── (3) ใบเสร็จชน ──
  if exists (select 1 from public.orders o
             where o.shop_id = p_shop_id and o.api_client_id = p_client_id and o.external_ref = v_receipt) then
    perform public.dayo_pos_verdict('rejected', 'CONFLICT', format('receipt_taken: เลขใบเสร็จ %s ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว', v_receipt));
  end if;
  -- ── (4) เงื่อนไขปิดฝั่งเซิร์ฟเวอร์ (S1 · R3-C) ──
  if not exists (select 1 from public.pos_push_rejections r
                 where r.shop_id = p_shop_id and r.pos_order_id = v_pos_order_id and r.reason = v_orig) then
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'rule: ไม่พบประวัติที่ระบบกลางปฏิเสธบิลนี้ด้วยเหตุผลที่อ้าง');
  end if;
  select s.block3_live_from, s.off_catalog_max_total into v_live, v_max from public.shop_settings s where s.shop_id = p_shop_id;
  if v_live is null or v_sold_at < (v_live::timestamp at time zone 'Asia/Bangkok') then
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN',
      format('rule: เวลาขาย %s ก่อนวันเริ่มใช้กะของร้าน', to_char(v_sold_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  if v_t_total > coalesce(v_max, 3000) then  -- (รอ Q72 — ค่าเริ่มต้น)
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'rule: ยอดบิลเกินเพดานบิลนอกแคตตาล็อก (เจ้าของเพิ่มเพดานได้ที่หน้าตั้งค่าระบบ)');
  end if;

  -- ── (5) บันทึก — ตัวออกเลขเดียวกับ create_order (0051:1096-1099) ──
  insert into public.order_counters as oc (shop_id, sale_date, last_seq) values (p_shop_id, v_sale_date, 1)
  on conflict (shop_id, sale_date) do update set last_seq = oc.last_seq + 1
  returning last_seq into v_seq;
  v_order_no := 'L' || to_char(v_sale_date, 'YYMMDD') || '-' || case when v_seq < 1000 then lpad(v_seq::text, 3, '0') else v_seq::text end;
  perform set_config('dayo.shop_id', p_shop_id::text, true);
  perform set_config('dayo.api_client_id', p_client_id::text, true);
  perform set_config('dayo.staff_id', v_staff::text, true);

  insert into public.orders (shop_id, order_no, sale_date, sales_channel_id, payment_method_id, source, external_ref, api_client_id,
    status, items_subtotal, items_discount, bill_discount_amount, bill_discount_reason, promo_discount_total, total_amount,
    channel_fee_pct, channel_fee_amount, cost_total, amount_mismatch, note, created_by, pricing_context,
    pos_order_id, pos_queue_no, pos_shift_id, pos_computed_total, pos_reported_amounts, catalog_version, sold_at, items_signature,
    off_catalog, off_catalog_lines)
  values (p_shop_id, v_order_no, v_sale_date, v_ch.id, v_pm.id, 'pos', v_receipt, p_client_id,
    'ok', v_t_sub, v_t_idisc, v_t_bdisc, null, 0, v_t_total,
    v_ch.fee_pct, round(v_t_total * v_ch.fee_pct, 2), null, false,
    case when public.dayo_pos_has(d, 'note') then d ->> 'note' end, v_staff,
    jsonb_build_object('off_catalog', true, 'intake_catalog_version', v_version),
    v_pos_order_id, (d ->> 'queue_no')::integer,
    case when public.dayo_pos_has(d, 'shift_id') then (d ->> 'shift_id')::uuid end,
    null, v_totals || jsonb_build_object('payment', v_pm.code), (d ->> 'catalog_version')::bigint, v_sold_at, null,
    true, v_lines)
  returning id into v_id;

  insert into public.audit_log (shop_id, entity, entity_id, action, before, after, staff_id, api_client_id)
  values (p_shop_id, 'orders', v_id, 'order_off_catalog', null,
    jsonb_build_object('closed_by', v_closed_by, 'closed_at', v_closed_at, 'reason', v_reason, 'original_reason', v_orig),
    v_closed_by, p_client_id);
  -- ทุกใบที่รับ: 🟡 นับใบ (S1(d)) — ไม่มียอดเงิน (รอ Q73 — ค่าเริ่มต้น) · รวมเป็น "N ใบ" ตอน pos_alerts_take
  perform public.dayo_pos_alert(p_shop_id, 'warning', 'off_catalog', 'off_catalog:' || v_id::text, 'บิลนอกแคตตาล็อกใหม่ — ดูที่เว็บ');
  return jsonb_build_object('status', 'accepted', 'data', jsonb_build_object('order_no', v_order_no, 'version', 1));
end;
$$;

-- ตัวแยกชนิด (สร้างทับ 0056) + order_off_catalog
create or replace function public.dayo_pos_dispatch(p_shop_id uuid, p_client_id uuid, p_kind text, d jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  case p_kind
    when 'order' then return public.dayo_pos_order(p_shop_id, p_client_id, d);
    when 'order_void' then return public.dayo_pos_void(p_shop_id, p_client_id, d);
    when 'order_off_catalog' then return public.dayo_pos_order_off_catalog(p_shop_id, p_client_id, d);
    when 'shift_open' then return public.dayo_pos_shift_open(p_shop_id, p_client_id, d);
    when 'cash_movement' then return public.dayo_pos_cash_movement(p_shop_id, p_client_id, d);
    when 'cash_count' then return public.dayo_pos_cash_count(p_shop_id, p_client_id, d);
    else
      perform public.dayo_pos_verdict('deferred', 'UNSUPPORTED', 'ชนิดแถวนี้ระบบกลางยังไม่รองรับ');
      return null;
  end case;
end;
$$;

-- สร้างทับ 0056 + order_off_catalog
create or replace function public.dayo_pos_supported()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'kinds', jsonb_build_array('order', 'order_void', 'order_off_catalog', 'shift_open', 'cash_movement', 'cash_count'),
    'fields', jsonb_build_object(
      'order', jsonb_build_array(
        'pos_order_id', 'receipt_no', 'queue_no', 'sale_date', 'sold_at', 'channel', 'payment', 'staff_id',
        'catalog_version', 'shift_id', 'lines', 'lines.code', 'lines.size', 'lines.sweetness', 'lines.milk', 'lines.grade',
        'lines.qty', 'lines.free', 'lines.discount_baht', 'lines.discount_percent', 'lines.discount_reason',
        'bill_discount', 'promo_code', 'skip_promotion_ids', 'no_promotions', 'totals', 'note'),
      'order_void', jsonb_build_array('pos_order_id', 'voided_at', 'staff_id', 'approved_by', 'reason'),
      'order_off_catalog', jsonb_build_array(
        'pos_order_id', 'receipt_no', 'queue_no', 'sale_date', 'sold_at', 'channel', 'payment', 'staff_id',
        'catalog_version', 'shift_id', 'note', 'lines', 'lines.code', 'lines.name', 'lines.size', 'lines.sweetness',
        'lines.qty', 'lines.unit_price', 'lines.discount_per_cup', 'lines.line_total', 'totals',
        'closed_by', 'closed_at', 'reason', 'original_reason'),
      'shift_open', jsonb_build_array('shift_id', 'business_date', 'opened_at', 'opened_by', 'opening_float', 'quick_open'),
      'cash_movement', jsonb_build_array('movement_id', 'shift_id', 'kind', 'amount', 'pos_order_id', 'reason', 'created_by', 'created_at'),
      'cash_count', jsonb_build_array('count_id', 'shift_id', 'lines', 'lines.denomination', 'lines.count', 'counted', 'counted_by', 'counted_at')
    )
  )
$$;

-- ── สิทธิ์: เฉพาะ service_role ─────────────────────────────────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
-- 0054: บอทลูกค้าเรียกด้วย publishable key — ต้องให้ anon ซ้ำทุก migration ที่ revoke ทั้งหมด (ADR-0062 · ไม่งั้นบอทลูกค้าพังบน production)
grant execute on function public.customer_shop_info(uuid) to anon;
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npm run db:reset && npm run db:types && npx vitest run --root packages/shared test/db/pos_off_catalog.db.test.ts test/db/pos_push_shift.db.test.ts test/db/pos_push.db.test.ts test/db/customer_bot.db.test.ts`
Expected: PASS · ถ้า `cancel_order` ของบิลนอกแคตตาล็อกล้ม (บิลไม่มี `order_items`) ให้หาสาเหตุใน `dayo_order_snapshot`/`dayo_order_sync_stock`/`dayo_check_order_edit` แล้วแก้ในไฟล์นี้ด้วยการลอกฟังก์ชันนั้นรุ่นล่าสุด + ป้าย `-- ADR-0056 บิลไม่มีรายการ` (สเปก §4.10 order_off_catalog ข้อ 3)

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add supabase/migrations/0057_pos_off_catalog.sql packages/shared/test/db/pos_off_catalog.db.test.ts packages/shared/src/database.types.ts
git commit -m "feat(db): record off-catalog pos bills with unknown cost"
```

---

## Task 4: `shift_close` + ใบปิดกะ · คิด Z ซ้ำ · E4 `api_shift_cash` · E1 `last_z_no`/`last_z_hash` (migration 0058)

**agent:** db-engineer · opus · high (lane A · ใช้ Docker) · **security-reviewer ตรวจ task นี้ก่อน merge** (S2/S3/S4 — ตรวจจริงไม่เชื่อ snapshot · E4 ไม่มีต้นทุน · E1 ไม่มี Z/ส่วนต่างนอกจากเลข/แฮช)

**Files:**
- Create: `supabase/migrations/0058_pos_shift_close_z.sql`
- Create: `packages/shared/test/db/pos_z_recompute.db.test.ts`
- Create (⛔ เจ้าของคัดลอกจาก `POS:packages/contracts/fixtures/parity/pos-shift-cash-parity.json` เมื่อแผน 09 สร้างแล้ว · ไม่มี = เทสต์ส่วนนั้น SKIP): `packages/shared/test/db/fixtures/pos-shift-cash-parity.json`
- Modify: `packages/shared/src/database.types.ts`

**Interfaces:**
- Consumes: Task 1–3 ทั้งหมด · `api_pos_catalog` รุ่นล่าสุด (`0049:266-338`) · `create_order`/`cancel_order` (0051)
- Produces:
  - `dayo_shift_cash_bills(p_shop_id uuid, p_after timestamptz, p_until timestamptz) → table(order_id uuid, order_no text, version integer, source text, sold_at timestamptz, total numeric, created_by uuid)` — คำค้นเดียวของ E4 และการคิดซ้ำข้อ 4
  - `api_shift_cash(p_shop_id uuid, p_api_client_id uuid, p_after text, p_until text) → jsonb` = `{ok:true, data:{bills:[{order_no, version, source, sold_at, total, created_by_name}], cash_total}}` (scope `orders:read` · `created_by_name` null เมื่อไม่มี `staff:read` · > 500 ใบ = `DY422 too_large`)
  - `dayo_pos_shift_close(p_shop_id uuid, p_client_id uuid, d jsonb) → jsonb` · ผล `{shift_id}`
  - `dayo_z_recompute(p_shift_id uuid) → text` (สถานะใหม่) · `dayo_z_recompute_safe(p_shift_id uuid) → void` (ไม่ raise — แจ้ง `recompute_failed` · ใช้กับใบข้างเคียงและจาก trigger เสมอ) · `z_reports.z_order_quarantined` (คอลัมน์จาก Task 1) ตั้งครั้งเดียวตอน insert ใน `dayo_pos_shift_close` เฉพาะใบที่ `z_no` ≤ สูงสุดของ key ณ ตอนรับและตกข้อ 5 · การคิดซ้ำอ่านอย่างเดียว — ใบที่ถูกกักไม่ใช้เป็นใบก่อน/ตัดสินใบข้างเคียง (สเปก 04 R5-3)
  - `z_reports.recompute_detail` = `{diffs:[{check, …}], notes:[{note:'receipt_renumbered', …}], computed:{opening_float, pos_cash_sales, void_refunds, paid_in, paid_out, drops, drawer_expenses, bot_cash}}` · `z_reports.recompute_notes` = `[{note:'z_gap'|'z_prev_missing'|'bot_window_after_differs'|'bot_bill_changed_after_count', …}]` — ค่า `check` ที่ Task 6/11 แปลเป็นข้อความ: `bill_shift` `bill_total` `bill_sold_at` `bill_payment_side` `bill_not_in_z` `movement_not_of_shift` `movement_not_in_z` `void_refund_other_key` `void_refund_bill_not_voided_in_z` `void_refund_over_total` `bot_bill_missing_in_z` `bot_bill_not_in_window` `bot_bill_total` `bot_bill_in_other_z` `bot_window_after` `bot_window_after_gap` `z_order` `cash_component`
  - trigger `orders_z_recompute_ins` / `orders_z_recompute_upd` (บน `orders`) · `cash_movements_z_recompute` (บน `cash_movements`)
  - E1 `data.client.last_z_no` (int|null) · `data.client.last_z_hash` (hex 64|null) · `data.client.last_z_until` (ISO UTC มิลลิวินาที `…Z` | null — **คำวินิจฉัยผู้คุมงาน 26 ก.ย. 2569** แบบเดียวกับ R4-1: `counted_at` ของการนับของ Z ใบเดียวกับ `last_z_hash` = `bot_window.until` ของใบนั้น · สเปก 04 R5-3: `last_z_no` = สูงสุดของทุก Z รวมใบที่ถูกกัก · `last_z_hash`/`last_z_until` = ของ Z ที่ไม่ถูกกักที่เลขสูงสุด · แท็บเล็ตที่ติดตั้งใหม่ใช้เป็น `after` ของ Z ใบถัดไป ไม่งั้น `after` = 00:00 → ลำดับ z_no ข้อ 3 ได้ `mismatch` + 🔴 ปลอม · ทีม POS แก้สเปก 04/P3 แยก)
  - `dayo_pos_supported()` + `shift_close` (`shift_id` `count_id` `closed_by` `closed_at` `variance_reason` `z_report`)

- [ ] **Step 1: เทสต์ที่ต้องตก** — `packages/shared/test/db/pos_z_recompute.db.test.ts`

```ts
// pos_z_recompute.db.test.ts — migration 0058 (ADR-0056 ข้อ 4, 6, 7 · สเปก POS §4.10 shift_close / ลำดับ z_no / E4 / การคิดซ้ำ · §9 ก้อน 3)
// แต่ละสถานการณ์ใช้ร้านของตัวเอง (บิลบอทเป็นของทั้งร้าน — ช่วง bot_window ของสถานการณ์อื่นต้องไม่ปนกัน)
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT, connectLocalSupabase, createTestShop, Db } from "./helpers.js";
import type { TestShop } from "./helpers.js";
import {
  MIN, POS_SCOPES, T, ago, countRow, hex64, mkClient, movementRow, orderRow, posBillOf, pusher, setupBlock3Shop, shiftCloseRow, shiftOpenRow,
} from "./block3Fixtures.js";
import type { PushRow, RowResult, ZParts } from "./block3Fixtures.js";

const sb = await connectLocalSupabase();
type Bot = { order_no: string; version: number; total: number };
interface ZRow {
  recompute_status: string; z_mismatch: boolean; chain_break: boolean; expected: number; variance: number;
  missing_pos_order_ids: string[]; missing_movement_ids: string[]; missing_void_order_ids: string[]; waiting_since: string | null;
  recompute_detail: { diffs: Array<{ check: string }>; notes: Array<{ note: string }> }; recompute_notes: Array<{ note: string }>;
  alerted_variance_at: string | null; alerted_mismatch_at: string | null; z_order_quarantined: boolean;
}
const iso = (ms: number) => new Date(ms).toISOString();
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe.skipIf(!sb)("0058 ใบปิดกะ + คิดซ้ำ + E4 + E1", () => {
  let svc: Db;
  beforeAll(() => { svc = Db.service(sb!); });

  async function world(label: string) {
    const shop: TestShop = await createTestShop(svc, label);
    await setupBlock3Shop(svc, shop);
    const client = await mkClient(svc, shop.shopId);
    const push = pusher(svc, shop.shopId);
    const one = async (row: PushRow, c = client): Promise<RowResult> => (await push([row], c))[0]!;
    const z = async (sid: string) => (await svc.select<ZRow>("z_reports", `shift_id=eq.${sid}&select=*`))[0]!;
    const alerts = (kind: string) => svc.select<{ message: string }>("pos_alerts", `shop_id=eq.${shop.shopId}&kind=eq.${kind}&select=message`);
    const bot = async (payment = "cash"): Promise<Bot> => {
      const r = await svc.rpc<{ order_no: string; version: number; total: number }>("create_order", {
        p_shop_id: shop.shopId, p_actor: { staff_id: shop.staffId, via: "bot" },
        p_draft: { channel: "store", source: "line", payment, lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "100%", qty: 1 }] },
      });
      return { order_no: r.order_no, version: r.version, total: Number(r.total) };
    };
    const e4 = async (after: string, until: string, c = client) =>
      (await svc.rpc<{ ok: boolean; data: { bills: Array<Bot & { source: string; sold_at: string | null; created_by_name: string | null }>; cash_total: number } }>(
        "api_shift_cash", { p_shop_id: shop.shopId, p_api_client_id: c, p_after: after, p_until: until })).data;
    const sale = (sid: string, soldAt: string, over: Record<string, unknown> = {}) => orderRow(shop, { shift_id: sid, sold_at: soldAt, ...over });
    const mov = (sid: string, createdAt: string, over: Record<string, unknown> = {}) => movementRow(sid, shop, { created_at: createdAt, ...over });

    /** กะเต็ม — องค์ประกอบเงินคิดจากแถวที่ให้ (override ได้) · bot_bills ดึงจาก E4 ช่วงเดียวกันตามที่แท็บเล็ตทำ */
    async function build(p: {
      sid: string; zNo: number; openedAt: string; countedAt: string; after: string; float?: number;
      bills?: PushRow[]; voided?: Record<string, string>; movements?: PushRow[]; counts?: Partial<Record<number, number>>;
      prevHash?: string | null; hash?: string; varianceAlert?: number; cashOver?: Partial<ZParts["cash"]>;
      posBills?: ZParts["posBills"]; movementIds?: string[]; botBills?: Bot[];
    }) {
      const bills = p.bills ?? [];
      const movements = p.movements ?? [];
      const until = p.countedAt;
      const botBills = p.botBills ?? (await e4(p.after, until)).bills.map((b) => ({ order_no: b.order_no, version: b.version, total: Number(b.total) }));
      const cashBills = bills.filter((b) => b.data.payment === "cash" && Date.parse(b.data.sold_at as string) <= Date.parse(until));
      const mv = (k: string) => sum(movements.filter((m) => m.data.kind === k).map((m) => m.data.amount as number));
      const open = shiftOpenRow(shop, { opened_at: p.openedAt, opening_float: p.float ?? 500 }, p.sid);
      const count = countRow(p.sid, shop, p.counts ?? {}, { counted_at: until });
      const cash = {
        opening_float: p.float ?? 500, pos_cash_sales: sum(cashBills.map((b) => (b.data.totals as { total: number }).total)),
        void_refunds: mv("VOID_REFUND"), paid_in: mv("PAID_IN"), paid_out: mv("PAID_OUT"), drops: mv("DROP"),
        bot_cash: sum(botBills.map((b) => b.total)), ...p.cashOver,
      };
      const close = shiftCloseRow(shop, p.sid, count.data.count_id as string, {
        zNo: p.zNo, hash: p.hash, prevHash: p.prevHash ?? null, varianceAlert: p.varianceAlert, cash, counted: count.data.counted as number,
        after: p.after, until, movementIds: p.movementIds ?? movements.map((m) => m.data.movement_id as string), botBills,
        posBills: p.posBills ?? bills.map((b) => posBillOf(b, p.voided?.[b.data.pos_order_id as string] ?? null)),
      }, { closed_at: iso(Date.parse(until) + 1000) });
      return { open, count, close, bills, movements, cash };
    }
    return { shop, client, push, one, z, alerts, bot, e4, sale, mov, build };
  }

  it("ปิดกะที่มีบิลเงินสดบอท 3 ใบ: เงินที่ควรมีรวมบิลบอท · matched · data {shift_id} · ส่งซ้ำ duplicate · E1 last_z_no/last_z_hash", async () => {
    const w = await world("z-happy");
    const sid = randomUUID();
    const bills = [w.sale(sid, ago(40 * MIN)), w.sale(sid, ago(30 * MIN)), w.sale(sid, ago(20 * MIN), { payment: "qr" })];
    const movements = [w.mov(sid, ago(25 * MIN), { kind: "PAID_IN", amount: 100 }), w.mov(sid, ago(15 * MIN), { kind: "DROP", amount: 50, reason: "ฝากธนาคาร" })];
    await w.bot(); await w.bot(); await w.bot(); await w.bot("qr");
    const countedAt = iso(Date.now() + 1000);
    const b = await w.build({ sid, zNo: 1, openedAt: ago(60 * MIN), countedAt, after: ago(120 * MIN), bills, movements, counts: { 500: 1, 100: 2, 50: 1, 5: 1 } });
    expect(b.cash.bot_cash).toBe(105);
    const res = await w.push([b.open, ...bills, ...movements, b.count, b.close], w.client);
    expect(res.map((r) => r.status)).toEqual(Array(res.length).fill("accepted"));
    expect(res.at(-1)!.data).toEqual({ shift_id: sid });
    const zr = await w.z(sid);
    expect(zr.recompute_status).toBe("matched");
    expect(Number(zr.expected)).toBe(500 + 70 + 100 - 50 + 105);
    expect(Number(zr.variance)).toBe(755 - 725);
    expect((await svc.select<{ status: string }>("shifts", `id=eq.${sid}&select=status`))[0]!.status).toBe("closed");
    expect((await w.one(b.close)).status).toBe("duplicate");
    const cat = await svc.rpc<{ data: { client: { last_z_no: number; last_z_hash: string; last_z_until: string } } }>("api_pos_catalog", { p_shop_id: w.shop.shopId, p_api_client_id: w.client, p_known_version: 0 });
    expect(cat.data.client).toMatchObject({ last_z_no: 1, last_z_hash: (b.close.data.z_report as { hash: string }).hash, last_z_until: countedAt });
    // ติดตั้งใหม่ด้วย key เดิม: Z ใบถัดไปใช้ last_z_no + 1 · prev_hash = last_z_hash · after = last_z_until → matched ไม่มี mismatch/🔴 ปลอม
    const next = randomUUID();
    const nb = await w.build({ sid: next, zNo: cat.data.client.last_z_no + 1, openedAt: iso(Date.parse(countedAt) + 100), countedAt: iso(Date.now() + 2000),
      after: cat.data.client.last_z_until, prevHash: cat.data.client.last_z_hash, botBills: [] });
    await w.push([nb.open, nb.count, nb.close], w.client);
    expect([(await w.z(next)).recompute_status, (await w.z(next)).chain_break]).toEqual(["matched", false]);
    const fresh = await mkClient(svc, w.shop.shopId);
    const empty = await svc.rpc<{ data: { client: Record<string, unknown> } }>("api_pos_catalog", { p_shop_id: w.shop.shopId, p_api_client_id: fresh, p_known_version: 0 });
    expect(empty.data.client).toMatchObject({ last_z_no: null, last_z_hash: null, last_z_until: null });
  }, T);

  it("E4: บิลเงินสด ok ของบอท/เว็บในช่วง (after, until] เท่านั้น · created_by_name null เมื่อไม่มี staff:read · after ≥ until = DY422", async () => {
    const w = await world("z-e4");
    const t0 = iso(Date.now() - 1000);
    const a = await w.bot();
    await w.bot("qr");
    const c = await w.bot();
    await svc.rpc("cancel_order", { p_shop_id: w.shop.shopId, p_actor: { staff_id: w.shop.ownerId, via: "web" }, p_order_no: c.order_no, p_reason: "ซ้ำ" });
    await w.one(orderRow(w.shop));
    const t1 = iso(Date.now() + 1000);
    const r = await w.e4(t0, t1);
    expect(r.bills.map((x) => x.order_no)).toEqual([a.order_no]);
    expect(r.bills[0]).toMatchObject({ source: "line", total: 35, created_by_name: "staff-active" });
    expect(Number(r.cash_total)).toBe(35);
    const noStaff = await mkClient(svc, w.shop.shopId, POS_SCOPES.filter((s) => s !== "staff:read"));
    expect((await w.e4(t0, t1, noStaff)).bills[0]!.created_by_name).toBeNull();
    expect(await w.e4(t1, iso(Date.now() + 2000))).toMatchObject({ bills: [], cash_total: 0 });
    await expect(w.e4(t1, t0)).rejects.toMatchObject({ err: { code: "DY422" } });
  }, T);

  it("ขายออฟไลน์ทั้งกะ: Z มาก่อนบิลและ order_void → waiting_bills (ไม่ mismatch · ไม่แจ้ง) → แถวมาครบ → matched เอง · ยกเลิก+คืนเงินไม่หักซ้ำ", async () => {
    const w = await world("z-offline");
    const sid = randomUUID();
    const bills = [w.sale(sid, ago(40 * MIN)), w.sale(sid, ago(30 * MIN))];
    const voidedAt = ago(29 * MIN);
    const refund = w.mov(sid, ago(29 * MIN), { kind: "VOID_REFUND", amount: 35, pos_order_id: bills[1]!.data.pos_order_id, reason: null });
    const countedAt = iso(Date.now() + 1000);
    const b = await w.build({ sid, zNo: 1, openedAt: ago(60 * MIN), countedAt, after: ago(120 * MIN), bills, movements: [refund],
      voided: { [bills[1]!.data.pos_order_id as string]: voidedAt }, counts: { 500: 1, 20: 1, 10: 1, 5: 1 } });
    expect((await w.push([b.open, b.count, b.close], w.client)).map((r) => r.status)).toEqual(["accepted", "accepted", "accepted"]);
    let zr = await w.z(sid);
    expect(zr.recompute_status).toBe("waiting_bills");
    expect(zr.missing_pos_order_ids.sort()).toEqual(bills.map((x) => x.data.pos_order_id as string).sort());
    expect(zr.missing_movement_ids).toEqual([refund.data.movement_id]);
    expect(zr.waiting_since).not.toBeNull();
    await w.push([...bills], w.client);
    await w.one(refund);
    zr = await w.z(sid);
    expect([zr.recompute_status, zr.missing_void_order_ids]).toEqual(["waiting_bills", [bills[1]!.data.pos_order_id]]);
    await w.one({ key: `order_void:${bills[1]!.data.pos_order_id}`, kind: "order_void",
      data: { pos_order_id: bills[1]!.data.pos_order_id, voided_at: voidedAt, staff_id: w.shop.staffId, approved_by: w.shop.ownerId, reason: "ลูกค้าคืน" } });
    zr = await w.z(sid);
    expect(zr.recompute_status).toBe("matched");
    expect(Number(zr.expected)).toBe(500 + 70 - 35);
    expect(await w.alerts("mismatch")).toEqual([]);
  }, T);

  it("บิลครบแต่องค์ประกอบต่าง → mismatch + แจ้ง 🔴 ครั้งเดียว (คิดซ้ำรอบถัดไปไม่แจ้งซ้ำ) · มีบิลยอดต่างขณะบิลอื่นยังไม่มา → mismatch ทันที", async () => {
    const w = await world("z-mismatch");
    const sid = randomUUID();
    const bills = [w.sale(sid, ago(30 * MIN))];
    const b = await w.build({ sid, zNo: 1, openedAt: ago(60 * MIN), countedAt: iso(Date.now() + 1000), after: ago(120 * MIN), bills, cashOver: { pos_cash_sales: 40 } });
    await w.push([b.open, ...bills, b.count, b.close], w.client);
    let zr = await w.z(sid);
    expect([zr.recompute_status, zr.z_mismatch]).toEqual(["mismatch", true]);
    expect(zr.recompute_detail.diffs.map((d) => d.check)).toContain("cash_component");
    await svc.rpc("dayo_z_recompute", { p_shift_id: sid });
    expect(await w.alerts("mismatch")).toHaveLength(1);
    expect((await w.alerts("mismatch"))[0]!.message).toMatch(/^กะ \d{1,2} .+ ใบปิดกะไม่ตรงกับระบบกลาง — ดูที่ \/shifts\//);

    const sid2 = randomUUID();
    const two = [w.sale(sid2, ago(30 * MIN)), w.sale(sid2, ago(25 * MIN))];
    const pb = two.map((x) => posBillOf(x));
    pb[0]!.total = 99;
    const b2 = await w.build({ sid: sid2, zNo: 2, openedAt: ago(60 * MIN), countedAt: iso(Date.now() + 1500), after: (b.close.data.z_report as { bot_window: { until: string } }).bot_window.until,
      bills: two, posBills: pb, prevHash: (b.close.data.z_report as { hash: string }).hash });
    await w.push([b2.open, two[0]!, b2.count, b2.close], w.client);
    zr = await w.z(sid2);
    expect(zr.recompute_status).toBe("mismatch");
    expect(zr.missing_pos_order_ids).toEqual([two[1]!.data.pos_order_id]);
  }, T);

  it("แจ้งส่วนต่างตาม variance_alert ของ Z (D102): −20.00 แจ้ง · −19.99 ไม่แจ้ง · เกณฑ์ 50 ส่วนต่าง 30 ไม่แจ้ง · ข้อความไม่มียอดเงิน", async () => {
    const w = await world("z-variance");
    const run = async (zNo: number, float: number, counts: Partial<Record<number, number>>, varianceAlert = 20) => {
      const sid = randomUUID();
      const bills = [w.sale(sid, ago(30 * MIN))];
      const b = await w.build({ sid, zNo, openedAt: ago(60 * MIN), countedAt: iso(Date.now() + 1000 + zNo * 10), after: ago(120 * MIN),
        bills, float, counts, varianceAlert, botBills: [] });
      await w.push([b.open, ...bills, b.count, b.close], w.client);
      return sid;
    };
    const s1 = await run(1, 500, { 500: 1, 10: 1, 5: 1 });            // expected 535 counted 515 → −20.00
    const s2 = await run(2, 499.99, { 500: 1, 10: 1, 5: 1 });         // expected 534.99 → −19.99
    const s3 = await run(3, 500, { 500: 1, 50: 1, 10: 1, 5: 1 }, 50); // expected 535 counted 565 → +30 เกณฑ์ 50
    expect(Number((await w.z(s1)).variance)).toBe(-20);
    expect((await w.z(s1)).alerted_variance_at).not.toBeNull();
    expect((await w.z(s2)).alerted_variance_at).toBeNull();
    expect((await w.z(s3)).alerted_variance_at).toBeNull();
    const msgs = await w.alerts("variance");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.message).toMatch(/^กะ .+ เงินไม่ตรงเกินเกณฑ์ — ดูที่ \/shifts\/[0-9a-f-]{36}$/);
    expect(msgs[0]!.message).not.toMatch(/฿|บาท|\d+\.\d{2}/);
  }, T);

  it("owner ยกเลิกบิลเงินสดบนเว็บหลังปิดกะ → Z ยัง matched (D93)", async () => {
    const w = await world("z-owner-edit");
    const sid = randomUUID();
    const bills = [w.sale(sid, ago(30 * MIN))];
    const b = await w.build({ sid, zNo: 1, openedAt: ago(60 * MIN), countedAt: iso(Date.now() + 1000), after: ago(120 * MIN), bills });
    const res = await w.push([b.open, ...bills, b.count, b.close], w.client);
    await svc.rpc("cancel_order", { p_shop_id: w.shop.shopId, p_actor: { staff_id: w.shop.ownerId, via: "web" }, p_order_no: res[1]!.data!.order_no, p_reason: "ลูกค้าคืน" });
    expect((await w.z(sid)).recompute_status).toBe("matched");
  }, T);

  it("สองกะในวันเดียว: บิลบอทแต่ละใบอยู่ใน Z เดียว · after = until ของ Z ก่อน · Z ที่ใส่บิลบอทของ Z อื่น/นอกช่วง → mismatch", async () => {
    const w = await world("z-two-shifts");
    const a = randomUUID();
    await w.bot();
    const tA = iso(Date.now() + 1000);
    const bA = await w.build({ sid: a, zNo: 1, openedAt: ago(60 * MIN), countedAt: tA, after: ago(120 * MIN) });
    await w.push([bA.open, bA.count, bA.close], w.client);
    await new Promise((r) => setTimeout(r, 1500));
    const later = await w.bot();
    const b = randomUUID();
    const tB = iso(Date.now() + 1000);
    const bB = await w.build({ sid: b, zNo: 2, openedAt: iso(Date.parse(tA) + 100), countedAt: tB, after: tA, prevHash: (bA.close.data.z_report as { hash: string }).hash });
    expect(bB.cash.bot_cash).toBe(35);
    expect((bB.close.data.z_report as { bot_bills: Bot[] }).bot_bills.map((x) => x.order_no)).toEqual([later.order_no]);
    await w.push([bB.open, bB.count, bB.close], w.client);
    expect([(await w.z(a)).recompute_status, (await w.z(b)).recompute_status]).toEqual(["matched", "matched"]);

    const c = randomUUID();
    const tC = iso(Date.now() + 2000);
    const stolen = (bA.close.data.z_report as { bot_bills: Bot[] }).bot_bills;
    const bC = await w.build({ sid: c, zNo: 3, openedAt: iso(Date.parse(tB) + 100), countedAt: tC, after: tB,
      prevHash: (bB.close.data.z_report as { hash: string }).hash, botBills: stolen });
    await w.push([bC.open, bC.count, bC.close], w.client);
    const zc = await w.z(c);
    expect(zc.recompute_status).toBe("mismatch");
    expect(zc.recompute_detail.diffs.map((d) => d.check)).toEqual(expect.arrayContaining(["bot_bill_in_other_z", "bot_bill_not_in_window"]));
  }, T);

  it("after ≠ until ของ Z ใบก่อน (z_no − 1) → mismatch · prev_hash ไม่ต่อโซ่ → chain_break · บิลบอทที่ dayo ค้นได้แต่ไม่อยู่ใน bot_bills → mismatch", async () => {
    const w = await world("z-chain");
    const a = randomUUID();
    const bA = await w.build({ sid: a, zNo: 1, openedAt: ago(90 * MIN), countedAt: ago(60 * MIN), after: ago(120 * MIN), botBills: [] });
    await w.push([bA.open, bA.count, bA.close], w.client);
    const b = randomUUID();
    const bB = await w.build({ sid: b, zNo: 2, openedAt: ago(50 * MIN), countedAt: ago(30 * MIN), after: ago(59 * MIN), prevHash: hex64("wrong"), botBills: [] });
    await w.push([bB.open, bB.count, bB.close], w.client);
    const zb = await w.z(b);
    expect([zb.recompute_status, zb.chain_break]).toEqual(["mismatch", true]);
    expect(zb.recompute_detail.diffs.map((d) => d.check)).toContain("bot_window_after");

    await w.bot();
    const c = randomUUID();
    const bC = await w.build({ sid: c, zNo: 3, openedAt: ago(20 * MIN), countedAt: iso(Date.now() + 1000),
      after: (bB.close.data.z_report as { bot_window: { until: string } }).bot_window.until,
      prevHash: (bB.close.data.z_report as { hash: string }).hash, botBills: [] });
    await w.push([bC.open, bC.count, bC.close], w.client);
    const zc = await w.z(c);
    expect([zc.recompute_status, zc.chain_break]).toEqual(["mismatch", false]);
    expect(zc.recompute_detail.diffs.map((d) => d.check)).toContain("bot_bill_missing_in_z");
  }, T);

  it("บิลบอทแก้/ยกเลิกหลังนับ = ข้อสังเกต (ไม่ต่าง) · ไม่ถูกแก้แต่ยอดใน snapshot ≠ ยอดปัจจุบัน = mismatch", async () => {
    const w = await world("z-bot-edit");
    const x = await w.bot();
    const a = randomUUID();
    const bA = await w.build({ sid: a, zNo: 1, openedAt: ago(60 * MIN), countedAt: iso(Date.now() + 1000), after: ago(120 * MIN) });
    await new Promise((r) => setTimeout(r, 1200));
    await svc.rpc("cancel_order", { p_shop_id: w.shop.shopId, p_actor: { staff_id: w.shop.ownerId, via: "web" }, p_order_no: x.order_no, p_reason: "ยกเลิกหลังนับ" });
    await w.push([bA.open, bA.count, bA.close], w.client);
    const za = await w.z(a);
    expect(za.recompute_status).toBe("matched");
    expect(za.recompute_notes.map((n) => n.note)).toContain("bot_bill_changed_after_count");

    const w2 = await world("z-bot-total");
    const y = await w2.bot();
    const s = randomUUID();
    const bS = await w2.build({ sid: s, zNo: 1, openedAt: ago(60 * MIN), countedAt: iso(Date.now() + 1000), after: ago(120 * MIN),
      botBills: [{ ...y, total: 30 }], cashOver: { bot_cash: 30 } });
    await w2.push([bS.open, bS.count, bS.close], w2.client);
    expect((await w2.z(s)).recompute_detail.diffs.map((d) => d.check)).toContain("bot_bill_total");
  }, T);

  it("เงินเข้า-ออก: ถูกปฏิเสธแล้ว shift_close มาก่อน → waiting (missing_movement_ids) → แก้แล้วผ่าน → matched · movement_ids มี id กะอื่น → mismatch", async () => {
    const w = await world("z-movement");
    const sid = randomUUID();
    const m1 = w.mov(sid, ago(30 * MIN), { kind: "PAID_OUT", amount: 20, reason: "ซื้อน้ำแข็ง" });
    const b = await w.build({ sid, zNo: 1, openedAt: ago(60 * MIN), countedAt: iso(Date.now() + 1000), after: ago(120 * MIN), movements: [m1], botBills: [] });
    const bad = { ...m1, data: { ...m1.data, created_by: w.shop.pendingId } };
    expect((await w.push([b.open, bad, b.count, b.close], w.client)).map((r) => r.status)).toEqual(["accepted", "rejected", "accepted", "accepted"]);
    expect((await w.z(sid)).missing_movement_ids).toEqual([m1.data.movement_id]);
    expect((await w.one(m1)).status).toBe("accepted");
    expect((await w.z(sid)).recompute_status).toBe("matched");

    const other = randomUUID();
    await w.one(shiftOpenRow(w.shop, { opened_at: ago(50 * MIN) }, other));
    const foreign = w.mov(other, ago(40 * MIN));
    await w.one(foreign);
    const s2 = randomUUID();
    const b2 = await w.build({ sid: s2, zNo: 2, openedAt: ago(45 * MIN), countedAt: iso(Date.now() + 2000),
      after: (b.close.data.z_report as { bot_window: { until: string } }).bot_window.until, prevHash: (b.close.data.z_report as { hash: string }).hash,
      movementIds: [foreign.data.movement_id as string], botBills: [] });
    await w.push([b2.open, b2.count, b2.close], w.client);
    expect((await w.z(s2)).recompute_detail.diffs.map((d) => d.check)).toContain("movement_not_of_shift");
  }, T);

  it("VOID_REFUND: รวมเกินยอดบิล / บิลอยู่ใน pos_bills โดย voided_at null / ชี้บิลของ key อื่น → mismatch ทันที", async () => {
    const w = await world("z-refund");
    const sid = randomUUID();
    const bill = w.sale(sid, ago(40 * MIN));
    const over = w.mov(sid, ago(30 * MIN), { kind: "VOID_REFUND", amount: 36, pos_order_id: bill.data.pos_order_id, reason: null });
    const b = await w.build({ sid, zNo: 1, openedAt: ago(60 * MIN), countedAt: iso(Date.now() + 1000), after: ago(120 * MIN), bills: [bill], movements: [over], botBills: [] });
    await w.push([b.open, bill, over, b.count, b.close], w.client);
    expect((await w.z(sid)).recompute_detail.diffs.map((d) => d.check)).toEqual(expect.arrayContaining(["void_refund_bill_not_voided_in_z", "void_refund_over_total"]));

    const otherKey = await mkClient(svc, w.shop.shopId);
    const foreignBill = orderRow(w.shop);
    await w.one(foreignBill, otherKey);
    const s2 = randomUUID();
    const r2 = w.mov(s2, ago(30 * MIN), { kind: "VOID_REFUND", amount: 35, pos_order_id: foreignBill.data.pos_order_id, reason: null });
    const b2 = await w.build({ sid: s2, zNo: 2, openedAt: ago(50 * MIN), countedAt: iso(Date.now() + 2000),
      after: (b.close.data.z_report as { bot_window: { until: string } }).bot_window.until, prevHash: (b.close.data.z_report as { hash: string }).hash,
      movements: [r2], botBills: [] });
    await w.push([b2.open, r2, b2.count, b2.close], w.client);
    expect((await w.z(s2)).recompute_detail.diffs.map((d) => d.check)).toContain("void_refund_other_key");
  }, T);

  it("VOID_REFUND รอ order_void ที่ถูกปฏิเสธ → waiting จนเจ้าของยกเลิกบิลบนเว็บ แล้ว matched เอง", async () => {
    const w = await world("z-void-web");
    const sid = randomUUID();
    const bill = w.sale(sid, ago(40 * MIN));
    const refund = w.mov(sid, ago(30 * MIN), { kind: "VOID_REFUND", amount: 35, pos_order_id: bill.data.pos_order_id, reason: null });
    const b = await w.build({ sid, zNo: 1, openedAt: ago(60 * MIN), countedAt: iso(Date.now() + 1000), after: ago(120 * MIN), bills: [bill], movements: [refund],
      voided: { [bill.data.pos_order_id as string]: ago(30 * MIN) }, botBills: [] });
    const res = await w.push([b.open, bill, refund, b.count, b.close], w.client);
    expect((await w.z(sid)).missing_void_order_ids).toEqual([bill.data.pos_order_id]);
    await svc.rpc("cancel_order", { p_shop_id: w.shop.shopId, p_actor: { staff_id: w.shop.ownerId, via: "web" }, p_order_no: res[1]!.data!.order_no, p_reason: "แท็บเล็ตยกเลิกไม่ผ่าน" });
    expect((await w.z(sid)).recompute_status).toBe("matched");
  }, T);

  it("RECEIPT_RENUMBERED หลังออก Z: receipt_no ใน pos_bills ≠ external_ref → ยัง matched + ข้อสังเกตใน recompute_detail", async () => {
    const w = await world("z-renumber");
    const sid = randomUUID();
    const bill = w.sale(sid, ago(30 * MIN));
    const pb = [{ ...posBillOf(bill), receipt_no: "A-999998" }];
    const b = await w.build({ sid, zNo: 1, openedAt: ago(60 * MIN), countedAt: iso(Date.now() + 1000), after: ago(120 * MIN), bills: [bill], posBills: pb, botBills: [] });
    await w.push([b.open, bill, b.count, b.close], w.client);
    const zr = await w.z(sid);
    expect(zr.recompute_status).toBe("matched");
    expect(zr.recompute_detail.notes.map((n) => n.note)).toContain("receipt_renumbered");
  }, T);

  describe("ลำดับ z_no และโซ่ (R3-B · R4-M)", () => {
    const hashOf = (b: { close: PushRow }) => (b.close.data.z_report as { hash: string }).hash;
    const untilOf = (b: { close: PushRow }) => (b.close.data.z_report as { bot_window: { until: string } }).bot_window.until;

    it("Z ใบแรกของ key ไม่ตรวจโซ่ · Z 5 ปิดไว้ในเครื่องแล้ว Z 6 มาถึง → ข้อสังเกต 'z_gap' ไม่ใช่ mismatch/chain_break · Z 5 ส่งทีหลัง → เติมช่อง แล้ว Z 6 ถูกคิดซ้ำ ข้อสังเกตหาย", async () => {
      const w = await world("z-order-gap");
      const mk = (zNo: number, openMin: number, countMin: number, after: string, prevHash: string | null) =>
        w.build({ sid: randomUUID(), zNo, openedAt: ago(openMin * MIN), countedAt: ago(countMin * MIN), after, prevHash, botBills: [] });
      const z4 = await mk(4, 100, 90, ago(200 * MIN), hex64("anything"));
      await w.push([z4.open, z4.count, z4.close], w.client);
      expect((await w.z(z4.open.data.shift_id as string)).recompute_status).toBe("matched");
      const z5 = await mk(5, 80, 70, untilOf(z4), hashOf(z4));
      await w.push([z5.open, z5.count], w.client);
      const z6 = await mk(6, 60, 50, untilOf(z5), hashOf(z5));
      await w.push([z6.open, z6.count, z6.close], w.client);
      let r6 = await w.z(z6.open.data.shift_id as string);
      expect([r6.recompute_status, r6.chain_break]).toEqual(["matched", false]);
      expect(r6.recompute_notes.map((n) => n.note)).toContain("z_gap");
      await w.push([z5.close], w.client);
      expect((await w.z(z5.open.data.shift_id as string)).recompute_status).toBe("matched");
      r6 = await w.z(z6.open.data.shift_id as string);
      expect([r6.recompute_status, r6.chain_break, r6.recompute_notes]).toEqual(["matched", false, []]);
    }, T);

    it("z_no ซ้ำ → CONFLICT z_no_taken: + 🔴 · z_no เกินสูงสุด + 50 → INVALID + 🔴 · เลขต่ำที่ counted_at ไม่อยู่ระหว่างใบข้างเคียง → mismatch + chain_break", async () => {
      const w = await world("z-order-bad");
      const z1 = await w.build({ sid: randomUUID(), zNo: 1, openedAt: ago(100 * MIN), countedAt: ago(90 * MIN), after: ago(200 * MIN), botBills: [] });
      const z3 = await w.build({ sid: randomUUID(), zNo: 3, openedAt: ago(80 * MIN), countedAt: ago(70 * MIN), after: untilOf(z1), botBills: [] });
      await w.push([z1.open, z1.count, z1.close, z3.open, z3.count, z3.close], w.client);
      const dup = await w.build({ sid: randomUUID(), zNo: 3, openedAt: ago(60 * MIN), countedAt: ago(50 * MIN), after: untilOf(z3), botBills: [] });
      const r = await w.push([dup.open, dup.count, dup.close], w.client);
      expect([r[2]!.status, r[2]!.reason, r[2]!.detail?.split(" ")[0]]).toEqual(["rejected", "CONFLICT", "z_no_taken:"]);
      const far = await w.build({ sid: randomUUID(), zNo: 54, openedAt: ago(40 * MIN), countedAt: ago(35 * MIN), after: untilOf(z3), botBills: [] });
      const r2 = await w.push([far.open, far.count, far.close], w.client);
      expect([r2[2]!.status, r2[2]!.reason, r2[2]!.detail?.split(" ")[0]]).toEqual(["rejected", "INVALID", "data_conflict:"]);
      expect((await w.alerts("shift_conflict")).length).toBeGreaterThanOrEqual(2);
      const replay = await w.build({ sid: randomUUID(), zNo: 2, openedAt: ago(30 * MIN), countedAt: ago(20 * MIN), after: untilOf(z3), botBills: [] });
      await w.push([replay.open, replay.count, replay.close], w.client);
      const rr = await w.z(replay.open.data.shift_id as string);
      expect([rr.recompute_status, rr.chain_break]).toEqual(["mismatch", true]);
      expect(rr.recompute_detail.diffs.map((d) => d.check)).toContain("z_order");
      expect(rr.z_order_quarantined).toBe(true);
      // คำวินิจฉัยผู้คุมงาน: ใบที่ถูกกักไม่ใช้ตัดสินใบข้างเคียง — Z 3 (คิดซ้ำเพราะเป็น z_no + 1 ของใบเล่นซ้ำ) ยัง matched ไม่ตก z_order/chain_break
      const r3 = await w.z(z3.open.data.shift_id as string);
      expect([r3.recompute_status, r3.chain_break, r3.z_order_quarantined]).toEqual(["matched", false, false]);
      // สเปก 04 R5-3 (แก้รอบ 2): E1 last_z_no = สูงสุดของทุก Z รวมใบที่ถูกกัก · hash/until = ของ Z ที่ไม่ถูกกักที่เลขสูงสุด
      // (ตามสเปก ใบที่ถูกกักมี z_no < สูงสุดเสมอ — ข้อ 1 ตัดเลขซ้ำ ข้อ 5 ต้องมีใบเลขสูงกว่า — กรณี "ใบถูกกักเลขสูงสุด" จึงเกิดผ่าน push ไม่ได้;
      //  SQL ของ E1 ยังแยกสองกฎไว้เผื่อ และเทสต์นี้ตรึงว่าใบที่ถูกกักไม่ถูกใช้เป็นแหล่ง hash/until)
      const cat = await svc.rpc<{ data: { client: { last_z_no: number; last_z_hash: string; last_z_until: string } } }>("api_pos_catalog", { p_shop_id: w.shop.shopId, p_api_client_id: w.client, p_known_version: 0 });
      expect(cat.data.client).toMatchObject({ last_z_no: 3, last_z_hash: hashOf(z3), last_z_until: untilOf(z3) });
    }, T);

    it("R5-3 ขอบเขตตามสเปก: ใบเลขสูงกว่าสูงสุดที่ counted_at เก่ากว่าใบก่อน ไม่ถูกกัก — ข้อ 3 จับ after เป็นต่างแทน", async () => {
      const w = await world("z-order-higher-older");
      const z1 = await w.build({ sid: randomUUID(), zNo: 1, openedAt: ago(60 * MIN), countedAt: ago(50 * MIN), after: ago(200 * MIN), botBills: [] });
      await w.push([z1.open, z1.count, z1.close], w.client);
      const z2 = await w.build({ sid: randomUUID(), zNo: 2, openedAt: ago(100 * MIN), countedAt: ago(90 * MIN), after: ago(200 * MIN), prevHash: hashOf(z1), botBills: [] });
      await w.push([z2.open, z2.count, z2.close], w.client);
      const r2 = await w.z(z2.open.data.shift_id as string);
      expect([r2.z_order_quarantined, r2.chain_break, r2.recompute_status]).toEqual([false, false, "mismatch"]);
      expect(r2.recompute_detail.diffs.map((d) => d.check)).toEqual(["bot_window_after"]);
    }, T);

    it("Z ขาดช่วงที่ after ≠ การนับล่าสุดของ key: ช่วงที่ไม่ถูกครอบมีบิลเงินสดบอท → mismatch · ไม่มีบิล → ข้อสังเกต", async () => {
      const w = await world("z-gap-after");
      const z1 = await w.build({ sid: randomUUID(), zNo: 1, openedAt: ago(30 * MIN), countedAt: ago(3 * MIN), after: ago(200 * MIN), botBills: [] });
      await w.push([z1.open, z1.count, z1.close], w.client);
      const quiet = await w.build({ sid: randomUUID(), zNo: 3, openedAt: ago(2 * MIN), countedAt: iso(Date.now() + 60_000), after: ago(10 * MIN), botBills: [] });
      await w.push([quiet.open, quiet.count, quiet.close], w.client);
      const rq = await w.z(quiet.open.data.shift_id as string);
      expect(rq.recompute_status).toBe("matched");
      expect(rq.recompute_notes.map((n) => n.note)).toEqual(expect.arrayContaining(["z_gap", "bot_window_after_differs"]));

      const w2 = await world("z-gap-after-bill");
      const a1 = await w2.build({ sid: randomUUID(), zNo: 1, openedAt: ago(30 * MIN), countedAt: ago(3 * MIN), after: ago(200 * MIN), botBills: [] });
      await w2.push([a1.open, a1.count, a1.close], w2.client);
      await w2.bot();
      const gap = await w2.build({ sid: randomUUID(), zNo: 3, openedAt: ago(2 * MIN), countedAt: iso(Date.now() + 60_000), after: iso(Date.now() + 30_000), botBills: [] });
      await w2.push([gap.open, gap.count, gap.close], w2.client);
      expect((await w2.z(gap.open.data.shift_id as string)).recompute_detail.diffs.map((d) => d.check)).toContain("bot_window_after_gap");
    }, T);
  });

  it("shift_close: การนับยังไม่มา = PARENT_PENDING · count_id ไม่ตรง / until ≠ counted_at / Σ bot_bills ≠ bot_cash / คีย์ย่อยแปลก / pos_bills > 2000 = INVALID · closed_by ไม่ใช่ owner = FORBIDDEN role:", async () => {
    const w = await world("z-close-rules");
    const sid = randomUUID();
    const b = await w.build({ sid, zNo: 1, openedAt: ago(60 * MIN), countedAt: ago(10 * MIN), after: ago(120 * MIN), botBills: [] });
    await w.one(b.open);
    expect([(await w.one(b.close)).status, (await w.one(b.close)).reason]).toEqual(["deferred", "PARENT_PENDING"]);
    await w.one(b.count);
    const zr = b.close.data.z_report as Record<string, unknown>;
    const withZ = (patch: Record<string, unknown>, top: Record<string, unknown> = {}) => ({ ...b.close, data: { ...b.close.data, ...top, z_report: { ...zr, ...patch } } });
    const reason = async (row: PushRow) => { const r = await w.one(row); return [r.status, r.reason]; };
    expect(await reason(withZ({}, { count_id: randomUUID() }))).toEqual(["rejected", "INVALID"]);
    expect(await reason(withZ({ bot_window: { after: ago(120 * MIN), until: ago(9 * MIN) } }))).toEqual(["rejected", "INVALID"]);
    expect(await reason(withZ({ bot_bills: [{ order_no: "L260925-001", version: 1, total: 35 }] }))).toEqual(["rejected", "INVALID"]);
    expect(await reason(withZ({ extra: 1 }))).toEqual(["rejected", "INVALID"]);
    expect(await reason(withZ({ cash: { ...(zr.cash as object), tips: 0 } }))).toEqual(["rejected", "INVALID"]);
    expect(await reason(withZ({ cash: { ...(zr.cash as object), drawer_expenses: 5 } }))).toEqual(["rejected", "INVALID"]);
    expect(await reason(withZ({ movement_ids: Array.from({ length: 501 }, () => randomUUID()) }))).toEqual(["rejected", "INVALID"]);
    const r = await w.one(withZ({}, { closed_by: w.shop.managerId }));
    expect([r.status, r.reason, r.detail?.slice(0, 5)]).toEqual(["rejected", "FORBIDDEN", "role:"]);
    const mismatchCount = await w.one(withZ({ counted: 999 }));
    expect([mismatchCount.status, mismatchCount.reason, mismatchCount.detail?.split(" ")[0]]).toEqual(["rejected", "INVALID", "data_conflict:"]);
    // INVALID อื่นไม่มีคำนำหน้านี้ (แท็บเล็ตถือเป็นบั๊ก → ส่งออก JSON)
    expect((await w.one(withZ({ extra: 1 }))).detail).not.toMatch(/^data_conflict:/);
    expect((await svc.select<{ data_conflict: boolean }>("shifts", `id=eq.${sid}&select=data_conflict`))[0]!.data_conflict).toBe(true);
    expect((await w.one(b.close)).status).toBe("accepted");
  }, T);

  it("parity สูตรเงินที่ควรมี (D84 · R-m1): dayo_z_expected = expected ของ fixture POS ทุกเคส · เคสในไฟล์นี้รวมติดลบ", async () => {
    const inline = [
      { name: "ปกติ", cash: { opening_float: 500, pos_cash_sales: 1235.5, void_refunds: 35, paid_in: 100, paid_out: 20.25, drops: 1000, drawer_expenses: 0, bot_cash: 70 }, counted: 850, expected: 850.25, variance: -0.25 },
      { name: "จ่ายออกเกินลิ้นชัก", cash: { opening_float: 0, pos_cash_sales: 0, void_refunds: 0, paid_in: 0, paid_out: 150.25, drops: 0, drawer_expenses: 0, bot_cash: 0 }, counted: 0, expected: -150.25, variance: 150.25 },
    ];
    const file = `${REPO_ROOT}packages/shared/test/db/fixtures/pos-shift-cash-parity.json`;
    const cases = existsSync(file) ? [...inline, ...(JSON.parse(readFileSync(file, "utf8")) as { cases: typeof inline }).cases] : inline;
    for (const c of cases) {
      const e = Number(await svc.rpc("dayo_z_expected", { p_cash: c.cash }));
      expect([c.name, e, Math.round((c.counted - e) * 100) / 100]).toEqual([c.name, c.expected, c.variance]);
    }
  }, T);
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npx vitest run --root packages/shared test/db/pos_z_recompute.db.test.ts`
Expected: FAIL — `function public.api_shift_cash does not exist` · `shift_close` = `deferred UNSUPPORTED`

- [ ] **Step 3: เขียน migration** — `supabase/migrations/0058_pos_shift_close_z.sql`

```sql
-- 0058_pos_shift_close_z — ใบปิดกะ + คิดซ้ำ + E4 + E1 last_z (ADR-0056 ข้อ 4, 6, 7 · สเปก POS §4.10 ก้อน 3 · §4.4 ข้อ 6)
--   dayo_shift_cash_bills: คำค้นเดียวของ E4 และการคิดซ้ำข้อ 4 — บิล ok · เงินสด · source line/web · created_at ∈ (after, until]
--   api_shift_cash (E4 · orders:read) · dayo_pos_shift_close (ลำดับ z_no ข้อ 0–1 · ข้อ 2–6 อยู่ใน dayo_z_recompute)
--   dayo_z_recompute: ตรวจรายแถวเสมอ · เทียบผลรวมกับ z_report.cash เฉพาะเมื่อไม่ขาด (R3-A) · ห้ามใช้ orders.created_at กับบิล POS
--   และห้ามใช้ total_amount ปัจจุบันของบิล POS (D93) · แจ้งเมื่อเปลี่ยนเข้า mismatch ครั้งเดียวต่อการเปลี่ยน
--   trigger คิดซ้ำ: orders (แทรก/เปลี่ยนสถานะ) · cash_movements (แทรก) — ในธุรกรรมเดียวกับการกระทำนั้น (ข้อ 6)
--   api_pos_catalog (ลอก 0049) + client.last_z_no/last_z_hash (R4-1)

create index if not exists orders_shop_created_botweb_idx on public.orders (shop_id, created_at) where source in ('line', 'web');

-- ═════════════════════════════════════════════════════════════════════════════════
-- 1. E4 — GET /v1/pos/shift-cash?after=&until=
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_shift_cash_bills(p_shop_id uuid, p_after timestamptz, p_until timestamptz)
returns table (order_id uuid, order_no text, version integer, source text, sold_at timestamptz, total numeric, created_by uuid)
language sql
stable
set search_path = public
as $$
  select o.id, o.order_no, o.version, o.source, o.sold_at, o.total_amount, o.created_by
  from public.orders o
  join public.payment_methods pm on pm.id = o.payment_method_id and pm.shop_id = o.shop_id
  where o.shop_id = p_shop_id and o.status = 'ok' and pm.code = 'cash' and o.source in ('line', 'web')
    and o.created_at > p_after and o.created_at <= p_until
  order by o.created_at, o.order_no
$$;

create or replace function public.api_shift_cash(p_shop_id uuid, p_api_client_id uuid, p_after text, p_until text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  c public.api_clients;
  v_after timestamptz := public.dayo_pos_ts(to_jsonb(p_after));
  v_until timestamptz := public.dayo_pos_ts(to_jsonb(p_until));
  v_staff_read boolean;
  v_n integer;
  v_bills jsonb;
  v_total numeric;
begin
  if p_shop_id is null or p_api_client_id is null then
    raise exception using errcode = 'DY401', message = 'actor_required: ต้องระบุร้านและ API client';
  end if;
  select * into c from public.api_clients x where x.id = p_api_client_id and x.shop_id = p_shop_id;
  if not found or not c.is_active then
    raise exception using errcode = 'DY401', message = 'api_client_not_active: API client ไม่ถูกต้องหรือถูกปิด';
  end if;
  if not ('orders:read' = any (c.scopes)) then
    raise exception using errcode = 'DY403', message = 'forbidden: API client ไม่มีสิทธิ์ orders:read';
  end if;
  v_staff_read := 'staff:read' = any (c.scopes);
  if v_after is null or v_until is null then
    raise exception using errcode = 'DY422', message = 'invalid: after และ until ต้องเป็นเวลา ISO-8601 (UTC)';
  end if;
  if v_after >= v_until then
    raise exception using errcode = 'DY422', message = 'invalid: after ต้องน้อยกว่า until';
  end if;
  select count(*), coalesce(sum(b.total), 0) into v_n, v_total from public.dayo_shift_cash_bills(p_shop_id, v_after, v_until) b;
  if v_n > 500 then
    -- เพดาน bot_bills ของ shift_close (m4) — ตอบก่อนให้แท็บเล็ตรู้ (ตีความข้อ 8)
    raise exception using errcode = 'DY422', message = 'too_large: บิลเงินสดจากบอท/เว็บในช่วงนี้เกิน 500 ใบ';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'order_no', b.order_no, 'version', b.version, 'source', b.source, 'sold_at', b.sold_at, 'total', b.total,
      'created_by_name', case when v_staff_read then st.display_name end)), '[]'::jsonb)
    into v_bills
  from public.dayo_shift_cash_bills(p_shop_id, v_after, v_until) b
  left join public.staff st on st.id = b.created_by and st.shop_id = p_shop_id;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('bills', v_bills, 'cash_total', v_total));
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 2. คิดใบปิดกะซ้ำ (ADR-0056 ข้อ 7 · สเปก §4.10 การคิดซ้ำ 1–6 · ลำดับ z_no 2–5)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_z_recompute(p_shift_id uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  z public.z_reports;
  s public.shifts;
  c public.cash_counts;
  v_snap jsonb;
  v_cash jsonb;
  v_until timestamptz;
  v_after timestamptz;
  v_diffs jsonb := '[]'::jsonb;
  v_notes jsonb := '[]'::jsonb;
  v_dnotes jsonb := '[]'::jsonb;
  v_miss_b uuid[] := '{}';
  v_miss_m uuid[] := '{}';
  v_miss_v uuid[] := '{}';
  v_chain boolean := false;
  b jsonb;
  o public.orders;
  m public.cash_movements;
  v_mid uuid;
  v_has boolean;
  v_rep numeric;
  v_pay text;
  v_pos_cash numeric := 0;
  v_void numeric := 0;
  v_in numeric := 0;
  v_out numeric := 0;
  v_drop numeric := 0;
  v_bot numeric := 0;
  v_prev public.z_reports;
  v_prev_until timestamptz;
  v_last_count timestamptz;
  v_on text;
  v_edited boolean;
  v_rec record;
  v_calc jsonb;
  v_k text;
  v_quarantine boolean;
  v_missing boolean;
  v_status text;
begin
  select * into z from public.z_reports x where x.shift_id = p_shift_id for update;
  if not found then
    return null;
  end if;
  select * into s from public.shifts x where x.id = z.shift_id;
  select * into c from public.cash_counts x where x.shift_id = z.shift_id;
  v_snap := z.snapshot;
  v_cash := v_snap -> 'cash';
  v_until := c.counted_at;
  v_after := (v_snap #>> '{bot_window,after}')::timestamptz;

  -- (1)(2) บิล POS ใน pos_bills: หาด้วย (api_client_id, pos_order_id) · ยอด/วิธีชำระ = ค่าที่แช่แข็ง (D93) · sold_at ของบิล
  for b in select e from jsonb_array_elements(v_snap -> 'pos_bills') e loop
    select * into o from public.orders x
    where x.shop_id = z.shop_id and x.api_client_id = z.api_client_id and x.pos_order_id = (b ->> 'pos_order_id')::uuid;
    if not found then
      v_miss_b := v_miss_b || (b ->> 'pos_order_id')::uuid;
      continue;
    end if;
    v_rep := coalesce((o.pos_reported_amounts ->> 'total')::numeric, o.total_amount);
    v_pay := coalesce(o.pos_reported_amounts ->> 'payment',
      (select pm.code from public.payment_methods pm where pm.id = o.payment_method_id and pm.shop_id = o.shop_id));
    if o.pos_shift_id is distinct from z.shift_id then
      v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'bill_shift', 'receipt_no', b ->> 'receipt_no'));
    end if;
    if v_rep <> (b ->> 'total')::numeric then
      v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'bill_total', 'receipt_no', b ->> 'receipt_no', 'db', v_rep, 'z', (b ->> 'total')::numeric));
    end if;
    if o.sold_at is distinct from (b ->> 'sold_at')::timestamptz then
      v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'bill_sold_at', 'receipt_no', b ->> 'receipt_no'));
    end if;
    -- วิธีชำระเทียบแค่ฝั่งเงินสด/ไม่ใช่เงินสด (R-I2)
    if (v_pay = 'cash') is distinct from ((b ->> 'payment') = 'cash') then
      v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'bill_payment_side', 'receipt_no', b ->> 'receipt_no'));
    end if;
    -- เลขใบเสร็จเปลี่ยนหลังออก Z (RECEIPT_RENUMBERED) = ข้อสังเกตใน recompute_detail เท่านั้น (R-I2)
    if o.external_ref is distinct from b ->> 'receipt_no' then
      v_dnotes := v_dnotes || jsonb_build_array(jsonb_build_object('note', 'receipt_renumbered', 'z', b ->> 'receipt_no', 'db', o.external_ref));
    end if;
    if v_pay = 'cash' and o.sold_at <= v_until then
      v_pos_cash := v_pos_cash + v_rep;
    end if;
  end loop;

  -- (3) บิลในฐานที่ pos_shift_id = กะนี้แต่ไม่อยู่ใน pos_bills
  for o in select x.* from public.orders x
           where x.shop_id = z.shop_id and x.pos_shift_id = z.shift_id
             and not exists (select 1 from jsonb_array_elements(v_snap -> 'pos_bills') e where (e ->> 'pos_order_id')::uuid = x.pos_order_id) loop
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'bill_not_in_z', 'receipt_no', o.external_ref));
  end loop;

  -- (3) เงินเข้า-ออกใน movement_ids: ต้องเป็นของกะนี้ key นี้ และ created_at ≤ counted_at
  for v_mid in select (e #>> '{}')::uuid from jsonb_array_elements(v_snap -> 'movement_ids') e loop
    select * into m from public.cash_movements x where x.id = v_mid;
    if not found then
      v_miss_m := v_miss_m || v_mid;
      continue;
    end if;
    if m.shop_id <> z.shop_id or m.api_client_id <> z.api_client_id or m.shift_id <> z.shift_id or m.created_at > v_until then
      v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'movement_not_of_shift', 'movement_id', v_mid));
      continue;
    end if;
    if m.kind = 'PAID_IN' then
      v_in := v_in + m.amount;
    elsif m.kind = 'PAID_OUT' then
      v_out := v_out + m.amount;
    elsif m.kind = 'DROP' then
      v_drop := v_drop + m.amount;
    else
      v_void := v_void + m.amount;
      -- VOID_REFUND (R3-m9): บิลของ key อื่น/ร้านอื่น = ต่างทันที · บิลอยู่ใน pos_bills ของ Z นี้โดย voided_at null = ต่างทันที ·
      -- บิล/การยกเลิกยังไม่มา = รอ · Σ ต่อบิล (ทุกกะ) ≤ ยอดที่เก็บจริง
      if exists (select 1 from public.orders x where x.pos_order_id = m.pos_order_id
                 and (x.shop_id <> z.shop_id or x.api_client_id <> z.api_client_id)) then
        v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'void_refund_other_key', 'movement_id', v_mid));
      else
        if exists (select 1 from jsonb_array_elements(v_snap -> 'pos_bills') e
                   where (e ->> 'pos_order_id')::uuid = m.pos_order_id and jsonb_typeof(e -> 'voided_at') = 'null') then
          v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'void_refund_bill_not_voided_in_z', 'movement_id', v_mid));
        end if;
        select * into o from public.orders x
        where x.shop_id = z.shop_id and x.api_client_id = z.api_client_id and x.pos_order_id = m.pos_order_id;
        v_has := found;
        if not v_has or o.status <> 'cancelled' then
          v_miss_v := v_miss_v || m.pos_order_id;
        end if;
        if v_has and (select sum(x.amount) from public.cash_movements x
                      where x.shop_id = z.shop_id and x.kind = 'VOID_REFUND' and x.pos_order_id = m.pos_order_id)
                     > coalesce((o.pos_reported_amounts ->> 'total')::numeric, o.total_amount) then
          v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'void_refund_over_total', 'movement_id', v_mid));
        end if;
      end if;
    end if;
  end loop;
  -- (3) เงินเข้า-ออกในฐานของกะนี้ (created_at ≤ counted_at) ที่ไม่อยู่ใน movement_ids
  for m in select x.* from public.cash_movements x
           where x.shift_id = z.shift_id and x.created_at <= v_until
             and not exists (select 1 from jsonb_array_elements_text(v_snap -> 'movement_ids') e where e::uuid = x.id) loop
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'movement_not_in_z', 'movement_id', m.id));
  end loop;

  -- (4) บิลบอท: รันคำค้น E4 ช่วง bot_window เอง · ชุด order_no ต้องเท่ากัน · แก้หลังนับ (± 5 นาที — D80) = ข้อสังเกต ·
  --     ไม่ถูกแก้แต่ยอดต่างจาก total_amount ปัจจุบัน = ต่าง (R3-m2)
  for v_rec in
    select coalesce(q.order_no, sb.order_no) as order_no, q.total as cur_total, sb.total as z_total,
           sb.order_no is not null as in_z, q.order_no is not null as in_db
    from public.dayo_shift_cash_bills(z.shop_id, v_after, v_until) q
    full join (select e ->> 'order_no' as order_no, (e ->> 'total')::numeric as total
               from jsonb_array_elements(v_snap -> 'bot_bills') e) sb on sb.order_no = q.order_no
  loop
    if v_rec.in_z and v_rec.in_db and v_rec.cur_total = v_rec.z_total then
      continue;
    end if;
    v_edited := exists (
      select 1 from public.orders x
      join public.audit_log a on a.shop_id = x.shop_id and a.entity = 'orders' and a.entity_id = x.id
      where x.shop_id = z.shop_id and x.order_no = v_rec.order_no
        and a.action in ('order_edit', 'order_cancel') and a.at > v_until - interval '5 minutes');
    if v_edited then
      v_notes := v_notes || jsonb_build_array(jsonb_build_object('note', 'bot_bill_changed_after_count', 'order_no', v_rec.order_no));
    else
      v_diffs := v_diffs || jsonb_build_array(jsonb_build_object(
        'check', case when not v_rec.in_z then 'bot_bill_missing_in_z' when not v_rec.in_db then 'bot_bill_not_in_window' else 'bot_bill_total' end,
        'order_no', v_rec.order_no));
    end if;
  end loop;
  for v_on in select e ->> 'order_no' from jsonb_array_elements(v_snap -> 'bot_bills') e loop
    if exists (select 1 from public.z_reports z2, jsonb_array_elements(z2.snapshot -> 'bot_bills') e2
               where z2.shop_id = z.shop_id and z2.shift_id <> z.shift_id and not z2.z_order_quarantined and e2 ->> 'order_no' = v_on) then
      v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'bot_bill_in_other_z', 'order_no', v_on));
    end if;
  end loop;

  -- ลำดับ z_no และโซ่ (R3-B · R4-M): "Z ใบก่อน" = Z ของ key เดียวกันที่ z_no มากสุดที่น้อยกว่าใบนี้
  select * into v_prev from public.z_reports x
  where x.api_client_id = z.api_client_id and x.z_no < z.z_no and not x.z_order_quarantined  -- Z ที่ถูกกักไม่เป็น "ใบก่อน"
  order by x.z_no desc limit 1;
  if found and v_prev.z_no = z.z_no - 1 then
    -- (3) ใบติดกัน: prev_hash ต้องต่อโซ่ (ไม่ตรง = chain_break) · after = until ของใบก่อน (ไม่ตรง = ต่าง)
    v_prev_until := (v_prev.snapshot #>> '{bot_window,until}')::timestamptz;
    if z.prev_hash is distinct from v_prev.hash then
      v_chain := true;
    end if;
    if v_after is distinct from v_prev_until then
      v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'bot_window_after'));
    end if;
  elsif found or not z.first_of_key then
    -- (4) ใบก่อนขาดช่วง / ยังไม่มี = ข้อสังเกต (ไม่ใช่ chain_break) · after เทียบการนับล่าสุดของ key ก่อน counted_at ของใบนี้
    v_notes := v_notes || jsonb_build_array(case when found
      then jsonb_build_object('note', 'z_gap', 'prev_z_no', v_prev.z_no)
      else jsonb_build_object('note', 'z_prev_missing') end);
    select max(cc.counted_at) into v_last_count from public.cash_counts cc
    where cc.api_client_id = z.api_client_id and cc.counted_at < v_until
      and not exists (select 1 from public.z_reports zq where zq.shift_id = cc.shift_id and zq.z_order_quarantined);
    if v_last_count is not null and v_last_count is distinct from v_after then
      if exists (select 1 from public.dayo_shift_cash_bills(z.shop_id, least(v_last_count, v_after), greatest(v_last_count, v_after))) then
        v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'bot_window_after_gap'));
      else
        v_notes := v_notes || jsonb_build_array(jsonb_build_object('note', 'bot_window_after_differs'));
      end if;
    end if;
  end if;
  -- (2) key ไม่มี Z ในฐานเลย ณ ตอนรับ (first_of_key) และยังไม่มีใบเลขน้อยกว่า = ไม่ตรวจโซ่/after
  -- (5) + สเปก 04 §13.8 R5-3: การกักตัดสินครั้งเดียวตอนรับใน dayo_pos_shift_close (เฉพาะใบที่ z_no ≤ สูงสุดของ key ณ ตอนรับ
  --     และ counted_at ไม่อยู่ระหว่างใบข้างเคียงที่ไม่ถูกกัก) แล้วคงอยู่ — ฟังก์ชันนี้แค่อ่านค่า ไม่ตั้งใหม่ ไม่ถอน
  --     (ใบเลขสูงที่ counted_at เก่ากว่าไม่ถูกกัก — ข้อ 3 จับ after ≠ until ของใบก่อนเป็นต่างอยู่แล้ว)
  v_quarantine := z.z_order_quarantined;
  if v_quarantine then
    v_chain := true;
    v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'z_order'));
  end if;

  -- (4)(5) ผลรวม — เทียบกับ z_report.cash เฉพาะเมื่อไม่มีอะไรขาด (R3-A)
  v_missing := cardinality(v_miss_b) + cardinality(v_miss_m) + cardinality(v_miss_v) > 0;
  select coalesce(sum((e ->> 'total')::numeric), 0) into v_bot from jsonb_array_elements(v_snap -> 'bot_bills') e;
  v_calc := jsonb_build_object('opening_float', s.opening_float, 'pos_cash_sales', v_pos_cash, 'void_refunds', v_void,
    'paid_in', v_in, 'paid_out', v_out, 'drops', v_drop, 'drawer_expenses', 0, 'bot_cash', v_bot);
  if not v_missing then
    for v_k in select k from jsonb_object_keys(v_calc) k loop
      if (v_calc ->> v_k)::numeric <> (v_cash ->> v_k)::numeric then
        v_diffs := v_diffs || jsonb_build_array(jsonb_build_object('check', 'cash_component', 'component', v_k,
          'db', (v_calc ->> v_k)::numeric, 'z', (v_cash ->> v_k)::numeric));
      end if;
    end loop;
  end if;

  v_status := case when jsonb_array_length(v_diffs) > 0 then 'mismatch' when v_missing then 'waiting_bills' else 'matched' end;
  perform set_config('dayo.shift_writer', 'recompute', true);
  update public.z_reports x set
    recompute_status = v_status,
    z_mismatch = (v_status = 'mismatch'),
    recompute_detail = jsonb_build_object('diffs', v_diffs, 'notes', v_dnotes, 'computed', v_calc),
    recompute_notes = v_notes,
    missing_pos_order_ids = v_miss_b,
    missing_movement_ids = v_miss_m,
    missing_void_order_ids = v_miss_v,
    waiting_since = case when v_status = 'waiting_bills' then coalesce(x.waiting_since, now()) else x.waiting_since end,
    recomputed_at = now(),
    chain_break = v_chain,
    alerted_mismatch_at = case when v_status = 'mismatch' and z.recompute_status <> 'mismatch' then now() else x.alerted_mismatch_at end
  where x.shift_id = z.shift_id;
  perform set_config('dayo.shift_writer', '', true);
  -- เปลี่ยน "เข้า" mismatch → 🔴 ครั้งเดียวต่อการเปลี่ยน (D98 · P3 ค3) · waiting_bills ไม่แจ้ง (D98) · ไม่มียอดเงิน (รอ Q73)
  if v_status = 'mismatch' and z.recompute_status <> 'mismatch' then
    perform public.dayo_pos_alert(z.shop_id, 'error', 'mismatch', format('mismatch:%s:%s', z.shift_id, extract(epoch from clock_timestamp())),
      format('กะ %s ใบปิดกะไม่ตรงกับระบบกลาง — ดูที่ /shifts/%s', public.dayo_thai_short_date(s.business_date), z.shift_id));
  end if;
  return v_status;
end;
$$;

-- เรียกจาก trigger — การคิดซ้ำล้มต้องไม่ทำให้แถวบิล/เงินสดถูกปฏิเสธ → แจ้ง 🔴 recompute_failed แทน
create or replace function public.dayo_z_recompute_safe(p_shift_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_shop uuid;
begin
  perform public.dayo_z_recompute(p_shift_id);
exception when others then
  select z.shop_id into v_shop from public.z_reports z where z.shift_id = p_shift_id;
  if v_shop is not null then
    perform public.dayo_pos_alert(v_shop, 'error', 'recompute_failed', format('recompute_failed:%s:%s', p_shift_id, sqlstate),
      format('คิดใบปิดกะซ้ำไม่สำเร็จ (SQLSTATE %s) — ดูที่ /shifts/%s', sqlstate, p_shift_id));
  end if;
end;
$$;

create or replace function public.dayo_orders_z_recompute()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_shift uuid;
begin
  if public.dayo_restoring() or new.source <> 'pos' or new.pos_order_id is null then
    return null;
  end if;
  for v_shift in
    select z.shift_id from public.z_reports z
    where z.shop_id = new.shop_id
      and (z.shift_id = new.pos_shift_id
           or new.pos_order_id = any (z.missing_pos_order_ids)
           or new.pos_order_id = any (z.missing_void_order_ids))
  loop
    perform public.dayo_z_recompute_safe(v_shift);
  end loop;
  return null;
end;
$$;
create trigger orders_z_recompute_ins after insert on public.orders
  for each row execute function public.dayo_orders_z_recompute();
create trigger orders_z_recompute_upd after update of status on public.orders
  for each row when (old.status is distinct from new.status) execute function public.dayo_orders_z_recompute();

create or replace function public.dayo_cash_movements_z_recompute()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_shift uuid;
begin
  if public.dayo_restoring() then
    return null;
  end if;
  for v_shift in
    select z.shift_id from public.z_reports z
    where z.shop_id = new.shop_id and (z.shift_id = new.shift_id or new.id = any (z.missing_movement_ids))
  loop
    perform public.dayo_z_recompute_safe(v_shift);
  end loop;
  return null;
end;
$$;
create trigger cash_movements_z_recompute after insert on public.cash_movements
  for each row execute function public.dayo_cash_movements_z_recompute();

-- ═════════════════════════════════════════════════════════════════════════════════
-- 3. shift_close (มีใบปิดกะในตัว)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_pos_shift_close(p_shop_id uuid, p_client_id uuid, d jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id uuid := (d ->> 'shift_id')::uuid;
  v_count_id uuid;
  v_by uuid;
  v_at timestamptz := public.dayo_pos_ts(d -> 'closed_at');
  v_vreason text;
  zr jsonb := d -> 'z_report';
  v_zkeys constant text[] := array['z_no', 'hash', 'prev_hash', 'chain_warning', 'variance_alert', 'cash', 'counted',
    'bot_window', 'movement_ids', 'bot_bills', 'pos_bills'];
  v_ckeys constant text[] := array['opening_float', 'pos_cash_sales', 'void_refunds', 'paid_in', 'paid_out', 'drops', 'drawer_expenses', 'bot_cash'];
  v_cash jsonb;
  v_after timestamptz;
  v_until timestamptz;
  v_zno integer;
  v_max integer;
  v_quarantine boolean;
  v_e jsonb;
  v_bot_sum numeric := 0;
  s public.shifts;
  c public.cash_counts;
  v_old public.z_reports;
  v_expected numeric;
  v_variance numeric;
  v_next uuid;
begin
  -- ── รูป ──
  if not public.dayo_pos_is_uuid(d -> 'count_id') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'count_id ต้องเป็น uuid');
  end if;
  v_count_id := (d ->> 'count_id')::uuid;
  if not public.dayo_pos_is_uuid(d -> 'closed_by') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'closed_by ต้องเป็น uuid');
  end if;
  v_by := (d ->> 'closed_by')::uuid;
  if v_at is null then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'closed_at ต้องเป็นเวลา ISO-8601 (UTC)');
  end if;
  if public.dayo_pos_has(d, 'variance_reason') and not public.dayo_pos_is_text(d -> 'variance_reason', 200) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'variance_reason ต้องมี 1–200 ตัวอักษรหรือ null');
  end if;
  v_vreason := case when public.dayo_pos_has(d, 'variance_reason') then btrim(d ->> 'variance_reason') end;
  -- z_report: คีย์ครบ 11 และไม่มีคีย์แปลก (คีย์ย่อยที่ไม่รู้จัก = INVALID — สเปก §4.10)
  if public.dayo_jt(zr) <> 'object'
     or exists (select 1 from jsonb_object_keys(zr) k where k <> all (v_zkeys))
     or exists (select 1 from unnest(v_zkeys) k where not zr ? k) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'z_report ต้องมีคีย์ครบและไม่มีคีย์ที่ไม่รู้จัก');
  end if;
  if not public.dayo_pos_is_int(zr -> 'z_no', 1, 2147483647) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'z_report.z_no ต้องเป็นจำนวนเต็มตั้งแต่ 1');
  end if;
  v_zno := (zr ->> 'z_no')::integer;
  if public.dayo_jt(zr -> 'hash') <> 'string' or (zr ->> 'hash') !~ '^[0-9a-f]{64}$'
     or (public.dayo_jt(zr -> 'prev_hash') <> 'null' and (public.dayo_jt(zr -> 'prev_hash') <> 'string' or (zr ->> 'prev_hash') !~ '^[0-9a-f]{64}$')) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'z_report.hash/prev_hash ต้องเป็น hex ตัวเล็ก 64 ตัว (prev_hash null ได้)');
  end if;
  if public.dayo_jt(zr -> 'chain_warning') <> 'boolean' or not public.dayo_pos_is_money(zr -> 'variance_alert')
     or not public.dayo_pos_is_money(zr -> 'counted') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'z_report.chain_warning/variance_alert/counted ผิดรูป');
  end if;
  v_cash := zr -> 'cash';
  if public.dayo_jt(v_cash) <> 'object'
     or exists (select 1 from jsonb_object_keys(v_cash) k where k <> all (v_ckeys))
     or exists (select 1 from unnest(v_ckeys) k where not public.dayo_pos_is_money(v_cash -> k)) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'z_report.cash ต้องมีองค์ประกอบ 8 ช่องเป็นบาท ≥ 0');
  end if;
  if (v_cash ->> 'drawer_expenses')::numeric <> 0 then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'drawer_expenses ต้องเป็น 0 ในก้อนนี้ (รอ ADR-0057)');
  end if;
  if public.dayo_jt(zr -> 'bot_window') <> 'object'
     or exists (select 1 from jsonb_object_keys(zr -> 'bot_window') k where k not in ('after', 'until')) then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'z_report.bot_window ต้องเป็น {after, until}');
  end if;
  v_after := public.dayo_pos_ts(zr #> '{bot_window,after}');
  v_until := public.dayo_pos_ts(zr #> '{bot_window,until}');
  if v_after is null or v_until is null or v_after >= v_until then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'bot_window.after/until ต้องเป็นเวลา ISO-8601 และ after < until');
  end if;
  if public.dayo_jt(zr -> 'movement_ids') <> 'array' or jsonb_array_length(zr -> 'movement_ids') > 500
     or exists (select 1 from jsonb_array_elements(zr -> 'movement_ids') x where not public.dayo_pos_is_uuid(x))
     or (select count(distinct x) from jsonb_array_elements_text(zr -> 'movement_ids') x) <> jsonb_array_length(zr -> 'movement_ids') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'movement_ids ต้องเป็น uuid ไม่ซ้ำ ไม่เกิน 500');
  end if;
  if public.dayo_jt(zr -> 'bot_bills') <> 'array' or jsonb_array_length(zr -> 'bot_bills') > 500 then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'bot_bills ต้องเป็น array ไม่เกิน 500');
  end if;
  for v_e in select e from jsonb_array_elements(zr -> 'bot_bills') e loop
    if public.dayo_jt(v_e) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_e) k where k not in ('order_no', 'version', 'total'))
       or public.dayo_jt(v_e -> 'order_no') <> 'string' or (v_e ->> 'order_no') !~ '^L[0-9]{6}-[0-9]{3,}$'
       or not public.dayo_pos_is_int(v_e -> 'version', 1, 2147483647) or not public.dayo_pos_is_money(v_e -> 'total') then
      perform public.dayo_pos_verdict('rejected', 'INVALID', 'bot_bills ต้องเป็น {order_no, version, total}');
    end if;
    v_bot_sum := v_bot_sum + (v_e ->> 'total')::numeric;
  end loop;
  if (select count(distinct e ->> 'order_no') from jsonb_array_elements(zr -> 'bot_bills') e) <> jsonb_array_length(zr -> 'bot_bills') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'bot_bills มี order_no ซ้ำ');
  end if;
  if v_bot_sum <> (v_cash ->> 'bot_cash')::numeric then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'Σ bot_bills.total ไม่เท่ากับ cash.bot_cash');
  end if;
  if public.dayo_jt(zr -> 'pos_bills') <> 'array' or jsonb_array_length(zr -> 'pos_bills') > 2000 then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'pos_bills ต้องเป็น array ไม่เกิน 2000');
  end if;
  if exists (
       select 1 from jsonb_array_elements(zr -> 'pos_bills') e
       where public.dayo_jt(e) <> 'object'
          or exists (select 1 from jsonb_object_keys(case when public.dayo_jt(e) = 'object' then e else '{}'::jsonb end) k
                     where k not in ('pos_order_id', 'receipt_no', 'payment', 'total', 'sold_at', 'voided_at'))
          or not public.dayo_pos_is_uuid(e -> 'pos_order_id')
          or public.dayo_jt(e -> 'receipt_no') <> 'string' or (e ->> 'receipt_no') !~ '^[A-Z]{1,3}-[0-9]{6}$'
          or not public.dayo_pos_is_text(e -> 'payment', 100)
          or not public.dayo_pos_is_money(e -> 'total')
          or public.dayo_pos_ts(e -> 'sold_at') is null
          or (public.dayo_jt(e -> 'voided_at') <> 'null' and public.dayo_pos_ts(e -> 'voided_at') is null))
     or (select count(distinct e ->> 'pos_order_id') from jsonb_array_elements(zr -> 'pos_bills') e) <> jsonb_array_length(zr -> 'pos_bills') then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'pos_bills ต้องเป็น {pos_order_id, receipt_no, payment, total, sold_at, voided_at} ไม่ซ้ำ');
  end if;
  -- ── เวลา ──
  if v_at > now() + interval '5 minutes' then
    perform public.dayo_pos_verdict('deferred', 'CLOCK_AHEAD',
      format('closed_at %s เกินเวลาเซิร์ฟเวอร์', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  if v_at < now() - interval '60 days' then
    perform public.dayo_pos_verdict('rejected', 'INVALID',
      format('closed_at %s ย้อนหลังเกิน 60 วัน', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  -- ── ผู้ปิดกะ = owner active ณ closed_at (m6) ──
  if not public.dayo_pos_staff_ok(p_shop_id, v_by) then
    perform public.dayo_pos_verdict('rejected', 'UNKNOWN_STAFF', 'ไม่พบพนักงานผู้ปิดกะของร้านนี้');
  end if;
  if not public.dayo_pos_owner_active_at(p_shop_id, v_by, v_at) then
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'role: ผู้ปิดกะต้องเป็นเจ้าของที่ใช้งานอยู่ ณ เวลาปิดกะ');
  end if;
  -- ── id เดิม (S4) ──
  select * into v_old from public.z_reports x where x.shift_id = v_id;
  if found then
    if v_old.shop_id = p_shop_id and v_old.api_client_id = p_client_id then
      return jsonb_build_object('status', 'duplicate', 'data', jsonb_build_object('shift_id', v_id));
    end if;
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'rule: ใบปิดกะนี้เป็นของเครื่องอื่น');
  end if;
  -- ── กะ + การนับ (แถวแม่) ──
  select * into s from public.shifts x where x.id = v_id;
  if not found then
    perform public.dayo_pos_verdict('deferred', 'PARENT_PENDING', 'กะที่อ้างยังมาไม่ถึง');
  end if;
  if s.shop_id <> p_shop_id or s.api_client_id <> p_client_id then
    perform public.dayo_pos_verdict('rejected', 'FORBIDDEN', 'rule: กะนี้เป็นของเครื่องอื่น');
  end if;
  select * into c from public.cash_counts x where x.shift_id = v_id;
  if not found then
    perform public.dayo_pos_verdict('deferred', 'PARENT_PENDING', 'การนับเงินของกะยังมาไม่ถึง');
  end if;
  if c.id <> v_count_id then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'count_id ไม่ตรงกับการนับของกะนี้');
  end if;
  if v_at < c.counted_at then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'closed_at ต้องไม่ก่อน counted_at');
  end if;
  if v_until <> c.counted_at then
    perform public.dayo_pos_verdict('rejected', 'INVALID', 'bot_window.until ต้องเท่ากับ counted_at ของการนับ');
  end if;
  if (zr ->> 'counted')::numeric <> c.counted then
    -- คำวินิจฉัยผู้คุมงาน 26 ก.ย.: INVALID ที่เป็นข้อมูลกะชนกัน (S5) ขึ้นต้น data_conflict: ให้แท็บเล็ตแสดงแถบแดง (§6.4)
    perform public.dayo_pos_verdict_s5('rejected', 'INVALID', 'data_conflict: ยอดนับใน z_report ไม่ตรงกับการนับของกะในระบบกลาง', 'counted_mismatch');
  end if;
  -- ── ลำดับ z_no ข้อ 0–1 (ข้อ 1 ตรวจก่อนข้อ 5 เสมอ) ──
  select max(x.z_no) into v_max from public.z_reports x where x.api_client_id = p_client_id;
  if v_max is not null and v_zno > v_max + 50 then
    perform public.dayo_pos_verdict_s5('rejected', 'INVALID', 'data_conflict: เลขใบปิดกะเกินเลขสูงสุดของเครื่อง + 50', 'z_no_range');
  end if;
  if exists (select 1 from public.z_reports x where x.api_client_id = p_client_id and x.z_no = v_zno) then
    perform public.dayo_pos_verdict_s5('rejected', 'CONFLICT', 'z_no_taken: เลขใบปิดกะนี้ถูกใช้แล้วในเครื่องนี้', 'z_no_taken');
  end if;

  -- ── ลำดับ z_no ข้อ 5 + R5-3 (สเปก 04): ตัดสินการกักครั้งเดียวที่นี่ ตอนรับ — เฉพาะใบที่ z_no ≤ สูงสุดของ key ณ ตอนนี้
  --    (ข้อ 1 ตัดเลขซ้ำไปแล้ว จึงเป็น < เสมอ) · ต้องอยู่ระหว่าง counted_at ของใบข้างเคียงที่ไม่ถูกกัก ไม่งั้นกัก · ตั้งแล้วไม่ถอน ──
  v_quarantine := v_max is not null and v_zno < v_max and not (
    coalesce((select c2.counted_at < c.counted_at from public.z_reports z2 join public.cash_counts c2 on c2.shift_id = z2.shift_id
              where z2.api_client_id = p_client_id and z2.z_no < v_zno and not z2.z_order_quarantined order by z2.z_no desc limit 1), true)
    and coalesce((select c.counted_at < c3.counted_at from public.z_reports z3 join public.cash_counts c3 on c3.shift_id = z3.shift_id
              where z3.api_client_id = p_client_id and z3.z_no > v_zno and not z3.z_order_quarantined order by z3.z_no asc limit 1), true));

  -- ── บันทึก: expected/variance ระบบคิดเองจาก snapshot.cash (C5) ──
  v_expected := public.dayo_z_expected(v_cash);
  v_variance := c.counted - v_expected;
  insert into public.z_reports (shift_id, shop_id, api_client_id, z_no, hash, prev_hash, chain_warning, first_of_key, snapshot,
    expected, counted, variance, variance_reason, variance_alert, z_order_quarantined)
  values (v_id, p_shop_id, p_client_id, v_zno, zr ->> 'hash', zr ->> 'prev_hash', (zr ->> 'chain_warning')::boolean, v_max is null, zr,
    v_expected, c.counted, v_variance, v_vreason, (zr ->> 'variance_alert')::numeric, v_quarantine);
  perform set_config('dayo.shift_writer', 'push', true);
  update public.shifts x set closed_by = v_by, closed_at = v_at, status = 'closed' where x.id = v_id;
  perform set_config('dayo.shift_writer', '', true);

  -- ── คิดซ้ำใบนี้ + ใบ z_no + 1 ของ key (ลำดับ z_no ข้อ 6) ──
  perform public.dayo_z_recompute(v_id);
  select x.shift_id into v_next from public.z_reports x where x.api_client_id = p_client_id and x.z_no = v_zno + 1;
  if found then
    -- ใบข้างเคียงคิดซ้ำผ่านตัวห่อเสมอ: ล้มแล้วแจ้ง recompute_failed ไม่ทำให้ shift_close ของใบนี้ถูกปฏิเสธ
    perform public.dayo_z_recompute_safe(v_next);
  end if;

  -- ── แจ้งส่วนต่าง |variance| ≥ variance_alert ของ Z (D98 · D102) ครั้งเดียวต่อ Z · ไม่มียอดเงิน (รอ Q73) ──
  if abs(v_variance) >= (zr ->> 'variance_alert')::numeric then
    if public.dayo_pos_alert(p_shop_id, 'warning', 'variance', 'variance:' || v_id::text,
         format('กะ %s เงินไม่ตรงเกินเกณฑ์ — ดูที่ /shifts/%s', public.dayo_thai_short_date(s.business_date), v_id)) then
      perform set_config('dayo.shift_writer', 'alert', true);
      update public.z_reports x set alerted_variance_at = now() where x.shift_id = v_id;
      perform set_config('dayo.shift_writer', '', true);
    end if;
  end if;
  return jsonb_build_object('status', 'accepted', 'data', jsonb_build_object('shift_id', v_id));
end;
$$;
```

  ต่อในไฟล์เดียวกัน: **`dayo_pos_dispatch`** (สร้างทับ 0057 · เพิ่มบรรทัด `when 'shift_close' then return public.dayo_pos_shift_close(p_shop_id, p_client_id, d);` ต่อจาก `cash_count`) และ **`dayo_pos_supported`** (สร้างทับ 0057 · `kinds` ต่อท้าย `'shift_close'` · `fields` เพิ่ม `'shift_close', jsonb_build_array('shift_id', 'count_id', 'closed_by', 'closed_at', 'variance_reason', 'z_report')`) — เขียนทั้งตัวในไฟล์ (ไม่อ้างไฟล์ก่อน)

  ต่อในไฟล์เดียวกัน: **`api_pos_catalog`** — ลอก `0049_pos_catalog.sql:266-338` ทุกบรรทัด แล้วแทน **บรรทัด 319–325** (ออบเจกต์ `'client'`) ด้วย:

```sql
    'client', jsonb_build_object(
      'name', c.name,
      'last_receipt_no', (
        select o.external_ref from public.orders o
        where o.api_client_id = c.id and o.external_ref is not null
        order by o.created_at desc, o.id desc
        limit 1),
      -- ADR-0056 (R4-1 + คำวินิจฉัยผู้คุมงาน 26 ก.ย.): เลข/แฮช/เวลาตัดช่วงบิลบอทของ Z เลขสูงสุดของ key นี้ —
      -- ตั้งเครื่องใหม่ต่อเลข Z โซ่ และ bot_window.after (ยังไม่มี Z = null ทั้งสามช่อง) · last_z_until = counted_at ของการนับของ Z นั้น
      -- สเปก 04 R5-3: last_z_no = สูงสุดของทุก Z รวมใบที่ถูกกัก (เลขถูกใช้แล้ว — เครื่องใหม่ต้องไม่ได้เลขซ้ำ)
      --   · last_z_hash / last_z_until = ของ Z ที่ไม่ถูกกักที่เลขสูงสุด (ใบที่ใช้เป็น "Z ใบก่อน" ได้จริง)
      'last_z_no', (select max(z.z_no) from public.z_reports z where z.api_client_id = c.id),
      'last_z_hash', (select z.hash from public.z_reports z where z.api_client_id = c.id and not z.z_order_quarantined order by z.z_no desc limit 1),
      'last_z_until', (
        select to_char(cc.counted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        from public.z_reports z join public.cash_counts cc on cc.shift_id = z.shift_id
        where z.api_client_id = c.id and not z.z_order_quarantined order by z.z_no desc limit 1)),
```

  ท้ายไฟล์: **บล็อกสิทธิ์มาตรฐาน** (Task 1 Step 4 · รวม `grant execute on function public.customer_shop_info(uuid) to anon;`)

- [ ] **Step 4: รันให้ผ่าน + ไม่มีเทสต์เดิมพัง**

Run: `npm run db:reset && npm run db:types && npx vitest run --root packages/shared test/db/pos_z_recompute.db.test.ts test/db/pos_off_catalog.db.test.ts test/db/pos_push_shift.db.test.ts test/db/pos_push.db.test.ts test/db/pos_catalog.db.test.ts test/db/customer_bot.db.test.ts`
Expected: PASS · `pos_catalog.db.test.ts` ที่ตรวจ `client` แบบ `toEqual` ให้เพิ่ม `last_z_no: null, last_z_hash: null, last_z_until: null` (คอมเมนต์ `// ADR-0056 R4-1`) · route E1 (`app/api/v1/pos/catalog/route.ts`) ส่งต่อ body ดิบของ RPC จึงไม่ต้องแก้ · dayo ไม่มี zod ของ E1 (schema ฝั่งรับอยู่ที่ POS `packages/contracts` — แผน 09) · ถ้า `apps/web/test/api.pos.test.ts` ตรวจคีย์ของ `client` ให้เพิ่มสามช่องเดียวกัน

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add supabase/migrations/0058_pos_shift_close_z.sql packages/shared/test/db/pos_z_recompute.db.test.ts packages/shared/test/db/pos_catalog.db.test.ts packages/shared/src/database.types.ts
git commit -m "feat(db): accept z reports and recompute them against central data"
```

---

## Task 5: รายงานกับบิลไม่รู้ต้นทุน · `get_order` · E3 `off_catalog` · `today_mini` สถานะกะ (migration 0059)

**agent:** db-engineer · opus · high (lane A · ใช้ Docker)

**Files:**
- Create: `supabase/migrations/0059_block3_reports.sql`
- Create: `packages/shared/test/db/block3_reports.db.test.ts`
- Modify: `packages/shared/src/database.types.ts`

**Interfaces:**
- Consumes: Task 1–4 · `v_daily_summary` (0009:103-137) · `dayo_summary_range` (0009:349-378) · `dayo_source_rows` / `dashboard_breakdown` / `profit_view_dashboard` (0053) · `dashboard_trend` (0009:508-548) · `get_order` / `today_mini` (0051) · `list_api_orders` (0052:785-846)
- Produces (เพิ่มฟิลด์ · ฟิลด์เดิมคงชื่อ/ชนิด):
  - `v_daily_summary` + คอลัมน์ท้าย `unknown_cost_bills` `unknown_cost_revenue` `unknown_cost_fee` · `cups` รวม Σ `qty` ของ `off_catalog_lines` · `gross_profit` = เฉพาะบิลที่รู้ต้นทุน · `gp_pct` = `gross_profit ÷ (revenue − unknown_cost_revenue)` (ตัวหาร 0 = null)
  - `dayo_summary_range(...)` (ใช้โดย `dashboard_summary` `daily_digest` `profit_view_dashboard`) + `unknown_cost_bills` `unknown_cost_revenue` `unknown_cost_fee` `fee_known_cost` — **สมการที่เว็บแสดง**: `revenue − unknown_cost_revenue − fee_known_cost − cost = gross_profit`
  - `dayo_source_rows(...)` + คอลัมน์ `unknown_cost_bills` `unknown_cost_revenue` (drop + create)
  - `profit_view_dashboard.summary` + `unknown_cost_bills` `unknown_cost_revenue` `fee_known_cost` `gp_pct` · `by_source[]` + `unknown_cost_bills` `unknown_cost_revenue`
  - `dashboard_breakdown` (channel/payment/staff/hour) แถว + `unknown_cost_revenue` · `gp_pct` ตัวหารใหม่ · `cups` รวมบิลนอกแคตตาล็อก · `dashboard_trend` แถว `gp_pct` ตัวหารใหม่ + `unknown_cost_revenue`
  - `get_order` + `off_catalog` `off_catalog_lines` `off_catalog_closed: {closed_by_name, closed_at, reason, original_reason} | null` · `can_edit=false` เมื่อ `off_catalog` · `gross_profit` = null เมื่อ `off_catalog`
  - `today_mini` + `shift_state: 'open' | 'closed' | null` (null = วันนี้ยังไม่มีกะ) · `cups` รวมบิลนอกแคตตาล็อก · **ไม่มีส่วนต่าง/ยอดขาด-เกิน** (D99)
  - E3 `list_api_orders` + `off_catalog` (bool) ต่อบิล

- [ ] **Step 1: เทสต์ที่ต้องตก** — `packages/shared/test/db/block3_reports.db.test.ts`

```ts
// block3_reports.db.test.ts — migration 0059 (ADR-0056 ข้อ 5 รายงาน · D97 · สเปก POS §4.10 order_off_catalog ข้อ 4 · §9 ก้อน 3)
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { bkkDay } from "../../src/time.js";
import { connectLocalSupabase, createTestShop, Db } from "./helpers.js";
import type { TestShop } from "./helpers.js";
import { T, mkClient, offCatalogRow, orderRow, pusher, setupBlock3Shop, shiftOpenRow } from "./block3Fixtures.js";

const sb = await connectLocalSupabase();
type Card = Record<string, number | null>;

describe.skipIf(!sb)("0059 รายงานกับบิลไม่รู้ต้นทุน", () => {
  let svc: Db;
  let shop: TestShop;
  let client: string;
  let normalNo: string;
  let offNo: string;
  const today = bkkDay(0);

  beforeAll(async () => {
    svc = Db.service(sb!);
    shop = await createTestShop(svc, "b3-reports");
    await setupBlock3Shop(svc, shop);
    client = await mkClient(svc, shop.shopId);
    const push = pusher(svc, shop.shopId);
    expect((await push([shiftOpenRow(shop, { opened_at: new Date().toISOString() })], client))[0]!.status).toBe("accepted");
    const n = orderRow(shop);
    normalNo = (await push([n], client))[0]!.data!.order_no as string;
    const id = randomUUID();
    const bad = orderRow(shop, { channel: "gone" }, id);
    await push([bad], client);
    const oc = offCatalogRow(shop, { channel: "grab", receipt_no: bad.data.receipt_no, sold_at: bad.data.sold_at, sale_date: bad.data.sale_date }, id);
    offNo = (await push([oc], client))[0]!.data!.order_no as string;
  }, T);

  it("dashboard_summary: ยอดขาย/บิล/แก้วรวม · ต้นทุน/กำไรไม่รวม · บรรทัดบิลไม่รู้ต้นทุน · สมการบวกลบได้ตรง · GP% ตัวหารใหม่", async () => {
    const s = await svc.rpc<{ current: Card }>("dashboard_summary", { p_shop_id: shop.shopId, p_from: today, p_to: today, p_staff_id: shop.ownerId });
    const c = s.current;
    expect([c.revenue, c.bills, c.cups]).toEqual([105, 2, 3]);
    expect([c.unknown_cost_bills, c.unknown_cost_revenue, c.unknown_cost_fee, c.fee, c.fee_known_cost]).toEqual([1, 70, 21, 21, 0]);
    expect(Number(c.revenue) - Number(c.unknown_cost_revenue) - Number(c.fee_known_cost) - Number(c.cost)).toBeCloseTo(Number(c.gross_profit), 2);
    expect(Number(c.gp_pct)).toBeCloseTo(Math.round((Number(c.gross_profit) / 35) * 10000) / 10000, 4);
    expect(Number(c.cost)).toBeGreaterThan(0);
  }, T);

  it("หน้าดูกำไรใช้ตัวเลขเดียวกับแดชบอร์ด: dayo_summary_range = dashboard_summary.current · Σ dayo_source_rows = summary", async () => {
    const sum = await svc.rpc<Card>("dayo_summary_range", { p_shop_id: shop.shopId, p_from: today, p_to: today });
    const dash = (await svc.rpc<{ current: Card }>("dashboard_summary", { p_shop_id: shop.shopId, p_from: today, p_to: today, p_staff_id: shop.ownerId })).current;
    expect(sum).toEqual(dash);
    const rows = await svc.rpc<Array<Record<string, number>>>("dayo_source_rows", { p_shop_id: shop.shopId, p_from: today, p_to: today });
    const pos = rows.find((r) => (r as unknown as { source: string }).source === "pos")!;
    expect([pos.revenue, pos.unknown_cost_bills, pos.unknown_cost_revenue, pos.cups]).toEqual([105, 1, 70, 3]);
    expect(Number(pos.gross_profit)).toBeCloseTo(Number(sum.gross_profit), 2);
  }, T);

  it("dashboard_breakdown ช่องทาง: แถว grab มีแต่บิลไม่รู้ต้นทุน → gp_pct null · แก้วรวม · อันดับเมนูไม่มีบิลนอกแคตตาล็อก · trend ใช้ตัวหารใหม่", async () => {
    const ch = await svc.rpc<{ rows: Array<Record<string, unknown>> }>("dashboard_breakdown", { p_shop_id: shop.shopId, p_from: today, p_to: today, p_by: "channel", p_staff_id: shop.ownerId });
    const grab = ch.rows.find((r) => r.key === "grab")!;
    expect(grab).toMatchObject({ revenue: 70, cups: 2, unknown_cost_revenue: 70, gp_pct: null });
    const menu = await svc.rpc<{ rows: Array<{ key: string }> }>("dashboard_breakdown", { p_shop_id: shop.shopId, p_from: today, p_to: today, p_by: "menu", p_staff_id: shop.ownerId });
    expect(menu.rows.map((r) => r.key)).toEqual(["Thai Tea"]);
    const tr = await svc.rpc<{ rows: Array<Record<string, number | null>> }>("dashboard_trend", { p_shop_id: shop.shopId, p_from: today, p_to: today, p_grain: "day", p_staff_id: shop.ownerId });
    expect(tr.rows[0]!.unknown_cost_revenue).toBe(70);
    expect(Number(tr.rows[0]!.gp_pct)).toBeCloseTo(Number(tr.rows[0]!.gross_profit) / 35, 4);
  }, T);

  it("get_order ของบิลนอกแคตตาล็อก: gross_profit null · ป้าย/รายการ/ผู้ปิด/เหตุผล · แก้ไม่ได้ ยกเลิกได้ · บิลปกติไม่เปลี่ยน", async () => {
    const g = await svc.rpc<Record<string, unknown>>("get_order", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_order_no: offNo });
    expect(g).toMatchObject({ off_catalog: true, cost_total: null, gross_profit: null, can_edit: false, can_cancel: true, lines: [] });
    expect((g.off_catalog_lines as unknown[]).length).toBe(1);
    expect(g.off_catalog_closed).toMatchObject({ closed_by_name: "owner-active", reason: "เมนูถูกลบจากระบบกลาง", original_reason: "UNKNOWN_CODE" });
    const n = await svc.rpc<Record<string, unknown>>("get_order", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_order_no: normalNo });
    expect(n).toMatchObject({ off_catalog: false, off_catalog_closed: null });
    expect(typeof n.gross_profit).toBe("number");
  }, T);

  it("E3 list_api_orders มี off_catalog ต่อบิล · ไม่มีต้นทุน/กำไร", async () => {
    const list = await svc.rpc<Array<Record<string, unknown>>>("list_api_orders", { p_shop_id: shop.shopId, p_api_client_id: client, p_from: today, p_to: today });
    const by = new Map(list.map((o) => [o.order_no as string, o]));
    expect(by.get(offNo)!.off_catalog).toBe(true);
    expect(by.get(normalNo)!.off_catalog).toBe(false);
    expect(JSON.stringify(list)).not.toMatch(/cost|gross|gp_pct/);
  }, T);

  it("today_mini: แก้วรวมบิลนอกแคตตาล็อก · shift_state เปิด/ปิดเท่านั้น (manager/staff ไม่เห็นส่วนต่าง)", async () => {
    const m = await svc.rpc<Record<string, unknown>>("today_mini", { p_shop_id: shop.shopId, p_staff_id: shop.managerId });
    expect(m).toMatchObject({ bills: 2, cups: 3, shift_state: "open" });
    expect(JSON.stringify(m)).not.toMatch(/variance|expected|z_report|recompute/);
    const s2 = await createTestShop(svc, "b3-mini-none");
    expect((await svc.rpc<Record<string, unknown>>("today_mini", { p_shop_id: s2.shopId, p_staff_id: s2.staffId })).shift_state).toBeNull();
  }, T);

  it("daily_digest: summary มีบรรทัดบิลไม่รู้ต้นทุน · เมนูขายดีไม่รวมบิลนอกแคตตาล็อก", async () => {
    const d = await svc.rpc<{ summary: Card; top_menus: Array<{ code: string }> }>("daily_digest", { p_shop_id: shop.shopId, p_day: today });
    expect([d.summary.unknown_cost_bills, d.summary.unknown_cost_revenue]).toEqual([1, 70]);
    expect(d.top_menus.map((t) => t.code)).toEqual(["Thai Tea"]);
  }, T);
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npx vitest run --root packages/shared test/db/block3_reports.db.test.ts`
Expected: FAIL — ไม่มีคีย์ `unknown_cost_bills` · `cups` = 1

- [ ] **Step 3: เขียน migration** — `supabase/migrations/0059_block3_reports.sql`

```sql
-- 0059_block3_reports — รายงานกับบิลนอกแคตตาล็อก (ต้นทุนไม่ทราบ) + get_order/E3/today_mini (ADR-0056 ข้อ 5 · D97 · สเปก POS §4.10)
-- ยอดขาย/จำนวนบิล/แก้ว รวมบิลนอกแคตตาล็อก · ต้นทุน/กำไรขั้นต้นไม่รวม (ไม่นับยอด ค่าธรรมเนียม ต้นทุนของบิลนั้น) ·
-- GP% = กำไรขั้นต้น ÷ (ยอดขาย − ยอดบิลไม่รู้ต้นทุน) · ห้ามถือต้นทุนเป็น 0 · อันดับเมนูไม่รวม (ไม่มี order_items)
-- ฟิลด์เดิมคงชื่อ/ชนิด (view ต่อคอลัมน์ท้าย) · fee = ค่าธรรมเนียมทุกบิล (เงินที่จ่ายจริง) · fee_known_cost = ของบิลที่รู้ต้นทุน (ตีความข้อ 9)

-- ═════════════════════════════════════════════════════════════════════════════════
-- 1. v_daily_summary (ลอก 0009:103-137 · คอลัมน์เดิมลำดับเดิม + 3 คอลัมน์ท้าย)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace view public.v_daily_summary
with (security_invoker = true)
as
select
  o.shop_id,
  o.sale_date,
  count(*) filter (where o.status = 'ok') as bills,
  coalesce(sum(coalesce(c.cups, oc.cups)) filter (where o.status = 'ok'), 0) as cups,
  coalesce(sum(o.total_amount) filter (where o.status = 'ok'), 0) as revenue,
  coalesce(sum(o.items_subtotal) filter (where o.status = 'ok'), 0) as items_subtotal,
  coalesce(sum(o.items_discount) filter (where o.status = 'ok'), 0) as items_discount,
  coalesce(sum(o.bill_discount_amount) filter (where o.status = 'ok'), 0) as bill_discount,
  coalesce(sum(o.promo_discount_total) filter (where o.status = 'ok'), 0) as promo_discount,
  coalesce(sum(o.channel_fee_amount) filter (where o.status = 'ok'), 0) as fee,
  coalesce(sum(o.cost_total) filter (where o.status = 'ok' and not o.off_catalog), 0) as cost,
  coalesce(sum(o.total_amount - o.cost_total - o.channel_fee_amount) filter (where o.status = 'ok' and not o.off_catalog), 0) as gross_profit,
  case when coalesce(sum(o.total_amount) filter (where o.status = 'ok' and not o.off_catalog), 0) = 0 then null
       else round(sum(o.total_amount - o.cost_total - o.channel_fee_amount) filter (where o.status = 'ok' and not o.off_catalog)
                  / sum(o.total_amount) filter (where o.status = 'ok' and not o.off_catalog), 4) end as gp_pct,
  coalesce(sum(o.total_amount) filter (where o.status = 'ok' and pm.code = 'cash'), 0) as cash_total,
  coalesce(sum(c.free_cups) filter (where o.status = 'ok'), 0) as free_cups,
  coalesce(sum(c.discount_cups) filter (where o.status = 'ok'), 0) as discount_cups,
  count(*) filter (where o.status = 'cancelled') as cancelled_bills,
  count(*) filter (where o.status = 'ok' and o.amount_mismatch) as mismatch_bills,
  -- ADR-0056: บิลไม่รู้ต้นทุน (บิลนอกแคตตาล็อก)
  count(*) filter (where o.status = 'ok' and o.off_catalog) as unknown_cost_bills,
  coalesce(sum(o.total_amount) filter (where o.status = 'ok' and o.off_catalog), 0) as unknown_cost_revenue,
  coalesce(sum(o.channel_fee_amount) filter (where o.status = 'ok' and o.off_catalog), 0) as unknown_cost_fee
from public.orders o
left join (
  select oi.order_id,
         sum(oi.qty) as cups,
         coalesce(sum(oi.qty) filter (where oi.unit_price > 0 and oi.discount_per_cup >= oi.unit_price), 0) as free_cups,
         coalesce(sum(oi.qty) filter (where oi.discount_per_cup > 0), 0) as discount_cups
  from public.order_items oi
  group by oi.order_id
) c on c.order_id = o.id
left join lateral (
  select sum((l ->> 'qty')::integer)::bigint as cups from jsonb_array_elements(o.off_catalog_lines) l
) oc on o.off_catalog
left join public.payment_methods pm on pm.id = o.payment_method_id and pm.shop_id = o.shop_id
group by o.shop_id, o.sale_date;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 2. dayo_summary_range (ลอก 0009:349-378 + บิลไม่รู้ต้นทุน · gp_pct ตัวหารใหม่)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_summary_range(p_shop_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'bills', coalesce(sum(d.bills), 0),
    'cups', coalesce(sum(d.cups), 0),
    'revenue', coalesce(sum(d.revenue), 0),
    'items_subtotal', coalesce(sum(d.items_subtotal), 0),
    'items_discount', coalesce(sum(d.items_discount), 0),
    'bill_discount', coalesce(sum(d.bill_discount), 0),
    'promo_discount', coalesce(sum(d.promo_discount), 0),
    'fee', coalesce(sum(d.fee), 0),
    'cost', coalesce(sum(d.cost), 0),
    'gross_profit', coalesce(sum(d.gross_profit), 0),
    -- ADR-0056: GP% = กำไรขั้นต้น ÷ (ยอดขาย − ยอดบิลไม่รู้ต้นทุน) · ตัวหาร 0 = null ("—")
    'gp_pct', case when coalesce(sum(d.revenue - d.unknown_cost_revenue), 0) = 0 then null
                   else round(sum(d.gross_profit) / sum(d.revenue - d.unknown_cost_revenue), 4) end,
    'avg_bill', case when coalesce(sum(d.bills), 0) = 0 then null else round(sum(d.revenue) / sum(d.bills), 2) end,
    'cash_total', coalesce(sum(d.cash_total), 0),
    'free_cups', coalesce(sum(d.free_cups), 0),
    'discount_cups', coalesce(sum(d.discount_cups), 0),
    'cancelled_bills', coalesce(sum(d.cancelled_bills), 0),
    'mismatch_bills', coalesce(sum(d.mismatch_bills), 0),
    'unknown_cost_bills', coalesce(sum(d.unknown_cost_bills), 0),
    'unknown_cost_revenue', coalesce(sum(d.unknown_cost_revenue), 0),
    'unknown_cost_fee', coalesce(sum(d.unknown_cost_fee), 0),
    'fee_known_cost', coalesce(sum(d.fee - d.unknown_cost_fee), 0)
  )
  from public.v_daily_summary d
  where d.shop_id = p_shop_id and d.sale_date between p_from and p_to
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 3. dayo_source_rows (ลอก 0053:306-320 + แก้วบิลนอกแคตตาล็อก + บิลไม่รู้ต้นทุน) — คืน table ใหม่ต้อง drop ก่อน
-- ═════════════════════════════════════════════════════════════════════════════════
drop function public.dayo_source_rows(uuid, date, date);

create or replace function public.dayo_source_rows(p_shop_id uuid, p_from date, p_to date)
returns table (source text, bills bigint, cups bigint, revenue numeric, cost numeric, fee numeric, gross_profit numeric,
               unknown_cost_bills bigint, unknown_cost_revenue numeric)
language sql
stable
set search_path = public
as $$
  select s.source, count(o.id), coalesce(sum(coalesce(c.cups, oc.cups)), 0)::bigint, coalesce(sum(o.total_amount), 0),
         coalesce(sum(o.cost_total) filter (where not o.off_catalog), 0), coalesce(sum(o.channel_fee_amount), 0),
         coalesce(sum(o.total_amount - o.cost_total - o.channel_fee_amount) filter (where not o.off_catalog), 0),
         count(o.id) filter (where o.off_catalog), coalesce(sum(o.total_amount) filter (where o.off_catalog), 0)
  from (values ('pos', 1), ('line', 2), ('web', 3)) s(source, ord)
  left join public.orders o
    on o.shop_id = p_shop_id and o.source = s.source and o.status = 'ok' and o.sale_date between p_from and p_to
  left join lateral (select sum(i.qty) as cups from public.order_items i where i.order_id = o.id) c on true
  left join lateral (select sum((l ->> 'qty')::integer)::bigint as cups from jsonb_array_elements(o.off_catalog_lines) l) oc on o.off_catalog
  group by s.source, s.ord
  order by s.ord
$$;
```

  ต่อในไฟล์เดียวกัน — ฟังก์ชันที่ "ลอกทั้งตัวแล้วแทนเฉพาะบรรทัด" (ทุกจุดใส่ป้าย `-- ADR-0056`):

  **(4) `profit_view_dashboard`** — ลอก `0053_profit_view.sql:788-848` แล้วแทนบรรทัด 829–835 (`'summary'` และ `'by_source'`) ด้วย:

```sql
    'summary', jsonb_build_object('revenue', v_sum -> 'revenue', 'cost', v_sum -> 'cost', 'fee', v_sum -> 'fee',
      'gross_profit', v_sum -> 'gross_profit', 'bills', v_sum -> 'bills', 'cups', v_sum -> 'cups',
      -- ADR-0056: บรรทัด "บิลไม่รู้ต้นทุน N ใบ · ยอด ฿X" ให้ตัวเลขเท่าแดชบอร์ดทุกสตางค์ (ADR-0055 ข้อ 8–9)
      'unknown_cost_bills', v_sum -> 'unknown_cost_bills', 'unknown_cost_revenue', v_sum -> 'unknown_cost_revenue',
      'fee_known_cost', v_sum -> 'fee_known_cost', 'gp_pct', v_sum -> 'gp_pct'),
    'by_source', (
      select jsonb_agg(jsonb_build_object('source', x.source, 'revenue', x.revenue, 'cost', x.cost, 'fee', x.fee,
        'gross_profit', x.gross_profit, 'bills', x.bills, 'cups', x.cups,
        'unknown_cost_bills', x.unknown_cost_bills, 'unknown_cost_revenue', x.unknown_cost_revenue)
        order by case x.source when 'pos' then 1 when 'line' then 2 else 3 end)
      from public.dayo_source_rows(p_shop_id, v_from, v_to) x),
```

  **(5) `dashboard_breakdown`** — ลอก `0053_profit_view.sql:323-394` แล้ว (ก) แทนบรรทัด 338 ด้วย
  `coalesce((select sum(i.qty) from public.order_items i where i.order_id = x.id), (select sum((l ->> 'qty')::integer) from jsonb_array_elements(x.off_catalog_lines) l), 0) as cups,`
  (ข) แทนบรรทัด 358–365 ด้วย:

```sql
      select o.k, min(o.label) as label, count(*) as bills, sum(o.cups) as cups, sum(o.total_amount) as revenue,
             sum(o.items_discount + o.bill_discount_amount) as discount, sum(o.channel_fee_amount) as fee,
             coalesce(sum(o.cost_total) filter (where not o.off_catalog), 0) as cost,
             coalesce(sum(o.total_amount - o.cost_total - o.channel_fee_amount) filter (where not o.off_catalog), 0) as gross_profit,
             coalesce(sum(o.total_amount) filter (where o.off_catalog), 0) as unknown_cost_revenue
      from o group by o.k
    )
    select coalesce(jsonb_agg(jsonb_build_object('key', g.k, 'label', g.label, 'bills', g.bills, 'cups', g.cups,
      'revenue', g.revenue, 'discount', g.discount, 'fee', g.fee, 'cost', g.cost, 'gross_profit', g.gross_profit,
      'unknown_cost_revenue', g.unknown_cost_revenue,
      'gp_pct', case when g.revenue - g.unknown_cost_revenue = 0 then null else round(g.gross_profit / (g.revenue - g.unknown_cost_revenue), 4) end)
```

  **(6) `dashboard_trend`** — ลอก `0009_stock_reports.sql:508-548` แล้วแทนบรรทัด 529–530 และ 538–540 ด้วย:

```sql
      'fee', coalesce(s.fee, 0), 'cost', coalesce(s.cost, 0), 'gross_profit', coalesce(s.gross_profit, 0),
      'unknown_cost_revenue', coalesce(s.unknown_cost_revenue, 0),
      'gp_pct', case when coalesce(s.revenue - s.unknown_cost_revenue, 0) = 0 then null
                     else round(s.gross_profit / (s.revenue - s.unknown_cost_revenue), 4) end
```
```sql
    select sum(d.bills) as bills, sum(d.cups) as cups, sum(d.revenue) as revenue,
           sum(d.items_discount + d.bill_discount) as discount, sum(d.promo_discount) as promo_discount,
           sum(d.fee) as fee, sum(d.cost) as cost, sum(d.gross_profit) as gross_profit,
           sum(d.unknown_cost_revenue) as unknown_cost_revenue
```

  **(7) `get_order`** — ลอก `0051_multi_source_sales.sql:1563-1602` แล้วแทนบรรทัด 1594–1595 (`'can_edit'`, `'can_cancel'`) ด้วย และเพิ่มคีย์ท้ายออบเจกต์ก่อน `);`:

```sql
    'can_edit', v_allowed and not o.off_catalog,   -- ADR-0056 (P3 ค2): บิลนอกแคตตาล็อกแก้ไม่ได้ ยกเลิกได้
    'can_cancel', v_allowed,
```
```sql
    ,
    -- ADR-0056: บิลนอกแคตตาล็อก — ป้าย + รายการจาก off_catalog_lines + ผู้ปิด/เหตุผล (gross_profit เป็น null อยู่แล้วเพราะ cost_total null)
    'off_catalog', o.off_catalog,
    'off_catalog_lines', o.off_catalog_lines,
    'off_catalog_closed', case when o.off_catalog then (
      select jsonb_build_object('closed_by_name', st.display_name, 'closed_at', a.after ->> 'closed_at',
        'reason', a.after ->> 'reason', 'original_reason', a.after ->> 'original_reason')
      from public.audit_log a
      left join public.staff st on st.id = (a.after ->> 'closed_by')::uuid and st.shop_id = a.shop_id
      where a.shop_id = p_shop_id and a.entity = 'orders' and a.entity_id = o.id and a.action = 'order_off_catalog'
      order by a.at limit 1) end
```

  **(8) `today_mini`** — ลอก `0051_multi_source_sales.sql:1867-1915` แล้ว (ก) แทนบรรทัด 1880 ด้วย
  `coalesce((select sum(i.qty) from public.order_items i where i.order_id = x.id), (select sum((l ->> 'qty')::integer) from jsonb_array_elements(x.off_catalog_lines) l), 0) as cups,`
  (ข) เพิ่มคีย์ต่อจาก `'sale_date', v_day,`:

```sql
      -- ADR-0056 (D99): ทุก role เห็นแค่สถานะกะของวันนี้ (เปิด/ปิด) — ไม่มีส่วนต่าง/ยอดขาด-เกิน
      'shift_state', case
        when exists (select 1 from public.shifts sh where sh.shop_id = p_shop_id and sh.business_date = v_day and sh.status = 'open') then 'open'
        when exists (select 1 from public.shifts sh where sh.shop_id = p_shop_id and sh.business_date = v_day) then 'closed'
      end,
```

  **(9) `list_api_orders`** (E3) — ลอก `0052_pos_push.sql:785-846` แล้วเพิ่มบรรทัดต่อจาก `'duplicate_suspect', …,` (บรรทัด 828–829):
  `'off_catalog', o.off_catalog,   -- ADR-0056: แท็บเล็ตยืนยันว่าบิลของตัวเองเข้าฐานเป็นบิลนอกแคตตาล็อก`

  ท้ายไฟล์: **บล็อกสิทธิ์มาตรฐาน** (Task 1 Step 4 · รวม `grant execute on function public.customer_shop_info(uuid) to anon;`) · `daily_digest` ไม่ต้องแก้ (ได้ฟิลด์ใหม่ผ่าน `dayo_summary_range` · เมนูขายดีมาจาก `order_items` จึงไม่รวมบิลนอกแคตตาล็อกอยู่แล้ว)

- [ ] **Step 4: รันให้ผ่าน + รายงานเดิมไม่เปลี่ยนเมื่อไม่มีบิลนอกแคตตาล็อก**

Run: `npm run db:reset && npm run db:types && npx vitest run --root packages/shared test/db/block3_reports.db.test.ts test/db/customer_bot.db.test.ts test/db`
Expected: PASS ทั้งโฟลเดอร์ · เทสต์รายงานเดิม (แดชบอร์ด/สรุปประจำวัน/ดูกำไร) ผ่านโดยไม่แก้ assertion (ร้านที่ไม่มีบิลนอกแคตตาล็อกได้ตัวเลขเดิมทุกตัว) · ถ้าเทสต์เดิมตรวจรายการคีย์แบบ `toEqual` ให้เพิ่มเฉพาะคีย์ใหม่ (คอมเมนต์ `// ADR-0056`)

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add supabase/migrations/0059_block3_reports.sql packages/shared/test/db/block3_reports.db.test.ts packages/shared/src/database.types.ts
git commit -m "feat(db): report off-catalog bills as sales with unknown cost"
```

---

## Task 6: อ่านข้อมูลกะบนเว็บ (owner) · "เจ้าของแก้บิลหลังขาย" · แจ้งใบปิดกะรอนาน · Export กะ (migration 0060)

**agent:** db-engineer · opus · high (lane A · ใช้ Docker) · **security-reviewer ตรวจ task นี้ก่อน merge** (S6 — สิทธิ์ owner ใน RPC เอง · ไม่มี API ใดคืน Z/ส่วนต่าง)

**Files:**
- Create: `supabase/migrations/0060_block3_shift_reads.sql`
- Create: `packages/shared/test/db/block3_shift_reads.db.test.ts`
- Modify: `packages/shared/src/database.types.ts`

**Interfaces:**
- Consumes: Task 1–5 · `dayo_require_staff(uuid, uuid, text[])` (raise `DY403` เมื่อ role ไม่อยู่ในรายการ) · `dayo_check_range` (0009) · `dayo_order_dayo_edit` (0051) · `export_rows` (0009:693-769)
- Produces:
  - `dayo_shift_owner_edits(p_shop_id uuid, p_shift_id uuid) → jsonb` = `[{order_no, receipt_no, reported_total, reported_payment, current_total, current_payment, current_status, edited_by_name, reason, edited_at, cash_diff}]` (บิล POS ของกะที่เจ้าของแก้/ยกเลิกบนเว็บ · คิดตอนแสดง ไม่เก็บใน Z · `cash_diff` = เงินสดที่เก็บจริง − เงินสดปัจจุบัน)
  - `dashboard_shifts(p_shop_id uuid, p_staff_id uuid, p_from date, p_to date) → jsonb` (owner) =
    `{from, to, block3_live_from, off_catalog_bills, shifts:[{shift_id, business_date, device_name, opened_at, opened_by_name, quick_open, status, counted_at, closed_at, variance, variance_alert, recompute_status, waiting_since, chain_break, z_gap, data_conflict, overlap, owner_edited_bills}], extras:{bot_outside_z:[…], changed_after_count:[…], changed_from_cash_before_count:[…], bills_without_shift:[…]}}`
  - `get_shift_detail(p_shop_id uuid, p_staff_id uuid, p_shift_id uuid) → jsonb` (owner) =
    `{shift:{…, opening_float, closed_by_name}, count:{lines, counted, counted_at, counted_by_name}|null, movements:[{id, kind, amount, reason, created_at, created_by_name, pos_order_id, receipt_no}], z:{z_no, hash, prev_hash, chain_warning, chain_break, expected, counted, variance, variance_reason, variance_alert, variance_alert_prev, cash, computed, bot_window, bot_bills:[{order_no, version, total, current_version, current_total, current_status}], pos_bills:[{…snapshot, order_no, in_db}], recompute_status, recompute_detail, recompute_notes, waiting_since, waiting:[{kind:'bill'|'movement'|'void', id, receipt_no}]}|null, owner_edits:[…], owner_edits_cash_diff}`
  - `pos_alerts_scan(p_shop_id uuid) → integer` (cron บอทรายชั่วโมง · แจ้ง 🟡 ครั้งเดียวเมื่อ `waiting_bills` นานเกิน `shift_waiting_alert_hours` — **รอ Q74 — ค่าเริ่มต้น** · ล้าง `pos_alerts` ที่ส่งแล้วเกิน 30 วัน · คืนจำนวนแจ้งใหม่)
  - `export_rows(…, p_group => 'shifts', …)` (owner) + `orders` มี `off_catalog`

- [ ] **Step 1: เทสต์ที่ต้องตก** — `packages/shared/test/db/block3_shift_reads.db.test.ts`

```ts
// block3_shift_reads.db.test.ts — migration 0060 (ADR-0056 ข้อ 9–11 · D93 · D99 · สเปก POS §4.10 เว็บ dayo / แจ้งเตือน · §9 ก้อน 3)
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { bkkDay } from "../../src/time.js";
import { connectLocalSupabase, createTestShop, Db, expectDbError, localSql } from "./helpers.js";
import type { TestShop } from "./helpers.js";
import { MIN, T, ago, countRow, mkClient, movementRow, orderRow, posBillOf, pusher, setupBlock3Shop, shiftCloseRow, shiftOpenRow } from "./block3Fixtures.js";

const sb = await connectLocalSupabase();
const iso = (ms: number) => new Date(ms).toISOString();

describe.skipIf(!sb)("0060 อ่านข้อมูลกะ (owner)", () => {
  let svc: Db;
  let shop: TestShop;
  let client: string;
  let push: ReturnType<typeof pusher>;
  let sid: string;
  let cashBillNo: string;
  const today = bkkDay(0);
  const rpcOwner = <R>(fn: string, args: Record<string, unknown>, staff = shop.ownerId) => svc.rpc<R>(fn, { p_shop_id: shop.shopId, p_staff_id: staff, ...args });

  beforeAll(async () => {
    svc = Db.service(sb!);
    shop = await createTestShop(svc, "b3-reads");
    await setupBlock3Shop(svc, shop);
    client = await mkClient(svc, shop.shopId);
    push = pusher(svc, shop.shopId);
    // กะ 1: บิลเงินสด 1 ใบ + PAID_IN 100 · นับ 9 ชนิด · Z matched (variance_alert 20)
    sid = randomUUID();
    const open = shiftOpenRow(shop, { opened_at: ago(60 * MIN) }, sid);
    const bill = orderRow(shop, { shift_id: sid, sold_at: ago(40 * MIN) });
    const mv = movementRow(sid, shop, { created_at: ago(30 * MIN) });
    const count = countRow(sid, shop, { 500: 1, 100: 1, 20: 1, 10: 1, 5: 1 }, { counted_at: ago(10 * MIN) });
    const close = shiftCloseRow(shop, sid, count.data.count_id as string, {
      zNo: 1, cash: { opening_float: 500, pos_cash_sales: 35, void_refunds: 0, paid_in: 100, paid_out: 0, drops: 0, bot_cash: 0 },
      counted: 635, after: ago(120 * MIN), until: count.data.counted_at as string, movementIds: [mv.data.movement_id as string], posBills: [posBillOf(bill)],
    }, { closed_at: ago(9 * MIN) });
    const res = await push([open, bill, mv, count, close], client);
    expect(res.map((r) => r.status)).toEqual(["accepted", "accepted", "accepted", "accepted", "accepted"]);
    cashBillNo = res[1]!.data!.order_no as string;
  }, T);

  it("สิทธิ์ (S6): manager/staff เรียก dashboard_shifts / get_shift_detail / export shifts = DY403", async () => {
    for (const staff of [shop.managerId, shop.staffId]) {
      expect((await expectDbError(rpcOwner("dashboard_shifts", { p_from: today, p_to: today }, staff))).code).toBe("DY403");
      expect((await expectDbError(rpcOwner("get_shift_detail", { p_shift_id: sid }, staff))).code).toBe("DY403");
      expect((await expectDbError(svc.rpc("export_rows", { p_shop_id: shop.shopId, p_group: "shifts", p_from: today, p_to: today, p_staff_id: staff }))).code).toBe("DY403");
    }
  }, T);

  it("บรรทัดกะ + \"เจ้าของแก้บิลหลังขาย\": owner ยกเลิกบิลเงินสดบนเว็บ → Z ยัง matched · owner_edited_bills 1 · ส่วนต่างเงินสด ฿35", async () => {
    await svc.rpc("cancel_order", { p_shop_id: shop.shopId, p_actor: { staff_id: shop.ownerId, via: "web" }, p_order_no: cashBillNo, p_reason: "ลูกค้าคืนของ" });
    const d = await rpcOwner<{ shifts: Array<Record<string, unknown>> }>("dashboard_shifts", { p_from: today, p_to: today });
    const line = d.shifts.find((s) => s.shift_id === sid)!;
    expect(line).toMatchObject({ status: "closed", recompute_status: "matched", variance: 0, variance_alert: 20, chain_break: false,
      z_gap: false, data_conflict: false, overlap: false, owner_edited_bills: 1, opened_by_name: "staff-active" });
    const det = await rpcOwner<Record<string, any>>("get_shift_detail", { p_shift_id: sid });
    expect(det.owner_edits).toHaveLength(1);
    expect(det.owner_edits[0]).toMatchObject({ order_no: cashBillNo, reported_total: 35, reported_payment: "cash", current_status: "cancelled", reason: "ลูกค้าคืนของ", cash_diff: 35 });
    expect(det.owner_edits_cash_diff).toBe(35);
    expect(det.count.lines).toHaveLength(9);
    expect(det.movements).toHaveLength(1);
    expect(det.z).toMatchObject({ z_no: 1, expected: 635, counted: 635, variance: 0, recompute_status: "matched", waiting: [] });
    expect(det.z.pos_bills[0]).toMatchObject({ order_no: cashBillNo, in_db: true });
  }, T);

  it("รอบิล: บรรทัดกะมี waiting_since · รายละเอียดมีรายการที่รอพร้อมชนิด (บิล/เงินเข้า-ออก/เงินคืน) · เกณฑ์ขอเหตุผลต่างจาก Z ใบก่อน", async () => {
    const s2 = randomUUID();
    const bill = orderRow(shop, { shift_id: s2, sold_at: ago(8 * MIN) });
    const refund = movementRow(s2, shop, { kind: "VOID_REFUND", amount: 35, pos_order_id: bill.data.pos_order_id, reason: null, created_at: ago(7 * MIN) });
    const count = countRow(s2, shop, {}, { counted_at: ago(5 * MIN) });
    const prevClose = (await svc.select<{ snapshot: { bot_window: { until: string } }; hash: string }>("z_reports", `shift_id=eq.${sid}&select=snapshot,hash`))[0]!;
    const close = shiftCloseRow(shop, s2, count.data.count_id as string, {
      zNo: 2, prevHash: prevClose.hash, varianceAlert: 50,
      cash: { opening_float: 500, pos_cash_sales: 35, void_refunds: 35, paid_in: 0, paid_out: 0, drops: 0, bot_cash: 0 },
      counted: 0, after: prevClose.snapshot.bot_window.until, until: count.data.counted_at as string,
      movementIds: [refund.data.movement_id as string], posBills: [posBillOf(bill, ago(7 * MIN))],
    }, { closed_at: ago(4 * MIN) });
    await push([shiftOpenRow(shop, { opened_at: ago(9 * MIN) }, s2), count, close], client);
    const det = await rpcOwner<Record<string, any>>("get_shift_detail", { p_shift_id: s2 });
    expect(det.z.recompute_status).toBe("waiting_bills");
    expect(det.z.waiting.map((w: { kind: string }) => w.kind).sort()).toEqual(["bill", "movement"]);
    expect(det.z.waiting.find((w: { kind: string }) => w.kind === "bill").receipt_no).toBe(bill.data.receipt_no);
    expect(det.z).toMatchObject({ variance_alert: 50, variance_alert_prev: 20 });
    const line = (await rpcOwner<{ shifts: Array<Record<string, unknown>> }>("dashboard_shifts", { p_from: today, p_to: today })).shifts.find((s) => s.shift_id === s2)!;
    expect(line.recompute_status).toBe("waiting_bills");
    expect(line.waiting_since).not.toBeNull();
  }, T);

  it("pos_alerts_scan (รอ Q74 — ค่าเริ่มต้น 48 ชม.): รอเกินเกณฑ์ → 🟡 ครั้งเดียว · ปิดค่าตั้ง (null) = ไม่แจ้ง", async () => {
    const [w] = await svc.select<{ shift_id: string }>("z_reports", `shop_id=eq.${shop.shopId}&recompute_status=eq.waiting_bills&select=shift_id`);
    localSql(`do $$ begin perform set_config('dayo.shift_writer', 'recompute', true);
      update public.z_reports set waiting_since = now() - interval '49 hours' where shift_id = '${w!.shift_id}'; end $$;`);
    await svc.rpc("save_pos_cash_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { shift_waiting_alert_hours: null } });
    expect(await svc.rpc("pos_alerts_scan", { p_shop_id: shop.shopId })).toBe(0);
    await svc.rpc("save_pos_cash_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { shift_waiting_alert_hours: 48 } });
    expect(await svc.rpc("pos_alerts_scan", { p_shop_id: shop.shopId })).toBe(1);
    expect(await svc.rpc("pos_alerts_scan", { p_shop_id: shop.shopId })).toBe(0);
    const a = await svc.select<{ message: string }>("pos_alerts", `shop_id=eq.${shop.shopId}&kind=eq.waiting&select=message`);
    expect(a[0]!.message).toMatch(/^กะ .+ ใบปิดกะรอบิลเกิน 48 ชม\. — ดูที่ \/shifts\//);
  }, T);

  it("รายการเสริม: บิลบอทนอกใบปิดกะ · เปลี่ยนหลังนับ · เปลี่ยนจากเงินสดก่อนนับ · บิลที่ pos_shift_id ยังไม่มีกะ · ป้ายนับบิลนอกแคตตาล็อก", async () => {
    const s3 = await createTestShop(svc, "b3-extras");
    await setupBlock3Shop(svc, s3);
    const c3 = await mkClient(svc, s3.shopId);
    const p3 = pusher(svc, s3.shopId);
    await p3([shiftOpenRow(s3, { opened_at: new Date().toISOString() })], c3); // block3_live_from = วันนี้
    const bot = (payment = "cash") => svc.rpc<{ order_no: string; version: number; total: number }>("create_order", {
      p_shop_id: s3.shopId, p_actor: { staff_id: s3.staffId, via: "bot" },
      p_draft: { channel: "store", source: "line", payment, lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "100%", qty: 1 }] } });
    const outside = await bot();
    const inZ = await bot();
    const switched = await bot();
    await svc.rpc("update_order", { p_shop_id: s3.shopId, p_actor: { staff_id: s3.ownerId, via: "web" }, p_order_no: switched.order_no,
      p_expected_version: 1, p_changes: { payment: "qr" } });
    const a = randomUUID();
    await new Promise((r) => setTimeout(r, 600));   // บิลสามใบข้างบนอยู่ก่อน after แน่นอน
    const after = iso(Date.now() - 100);
    await new Promise((r) => setTimeout(r, 300));
    const inZ2 = await bot();
    const count = countRow(a, s3, {}, { counted_at: iso(Date.now() + 1000) });
    const close = shiftCloseRow(s3, a, count.data.count_id as string, {
      zNo: 1, cash: { opening_float: 0, pos_cash_sales: 0, void_refunds: 0, paid_in: 0, paid_out: 0, drops: 0, bot_cash: 35 },
      counted: 0, after, until: count.data.counted_at as string, movementIds: [], botBills: [{ order_no: inZ2.order_no, version: 1, total: 35 }], posBills: [],
    }, { closed_at: iso(Date.now() + 2000) });
    await p3([shiftOpenRow(s3, { opened_at: ago(10 * MIN), opening_float: 0 }, a), count, close], c3);
    await new Promise((r) => setTimeout(r, 1200));
    await svc.rpc("cancel_order", { p_shop_id: s3.shopId, p_actor: { staff_id: s3.ownerId, via: "web" }, p_order_no: inZ2.order_no, p_reason: "ยกเลิกหลังนับ" });
    await p3([orderRow(s3, { shift_id: randomUUID() })], c3);
    const d = await svc.rpc<{ extras: Record<string, Array<{ order_no?: string; receipt_no?: string }>>; off_catalog_bills: number }>("dashboard_shifts",
      { p_shop_id: s3.shopId, p_staff_id: s3.ownerId, p_from: today, p_to: today });
    expect(d.extras.bot_outside_z.map((x) => x.order_no)).toEqual(expect.arrayContaining([outside.order_no, inZ.order_no]));
    expect(d.extras.changed_after_count.map((x) => x.order_no)).toEqual([inZ2.order_no]);
    expect(d.extras.changed_from_cash_before_count.map((x) => x.order_no)).toEqual([switched.order_no]);
    expect(d.extras.bills_without_shift).toHaveLength(1);
    expect(d.off_catalog_bills).toBe(0);
  }, T);

  it("export_rows: กลุ่ม shifts (owner) มีข้อมูลกะ · กลุ่ม orders มี off_catalog", async () => {
    const ex = await svc.rpc<{ rows: Array<Record<string, unknown>> }>("export_rows", { p_shop_id: shop.shopId, p_group: "shifts", p_from: today, p_to: today, p_staff_id: shop.ownerId });
    expect(ex.rows.find((r) => r.z_no === 1)).toMatchObject({ expected: 635, variance: 0, recompute_status: "matched" });
    const ord = await svc.rpc<{ rows: Array<Record<string, unknown>> }>("export_rows", { p_shop_id: shop.shopId, p_group: "orders", p_from: today, p_to: today, p_staff_id: shop.ownerId });
    expect(ord.rows.every((r) => r.off_catalog === false)).toBe(true);
  }, T);
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npx vitest run --root packages/shared test/db/block3_shift_reads.db.test.ts`
Expected: FAIL — `function public.dashboard_shifts does not exist`

- [ ] **Step 3: เขียน migration** — `supabase/migrations/0060_block3_shift_reads.sql`

```sql
-- 0060_block3_shift_reads — เว็บ dayo อ่านข้อมูลกะ (owner เท่านั้น · อ่านอย่างเดียว — D99 · S6) + แจ้งใบปิดกะรอนาน + Export กะ
--   dashboard_shifts · get_shift_detail — ตรวจ owner ใน RPC เอง (DY403) · ไม่มี API /v1 ใดเรียกสองฟังก์ชันนี้
--   dayo_shift_owner_edits — บรรทัด "เจ้าของแก้บิลหลังขาย" (D93) คิดตอนแสดง ไม่เก็บใน Z ไม่เปลี่ยน recompute_status
--   pos_alerts_scan — waiting_bills นานเกิน shift_waiting_alert_hours → 🟡 ครั้งเดียวต่อ Z (รอ Q74 — ค่าเริ่มต้น 48 · ขัด D98 — แผน 08 จุดขัดข้อ 1)
--   export_rows (ลอก 0009:693-769) + orders.off_catalog + กลุ่ม shifts

-- ═════════════════════════════════════════════════════════════════════════════════
-- 1. "เจ้าของแก้บิลหลังขาย" (D93)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_shift_owner_edits(p_shop_id uuid, p_shift_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(x.j order by x.sold_at, x.order_no), '[]'::jsonb)
  from (
    select o.sold_at, o.order_no, jsonb_build_object(
      'order_no', o.order_no,
      'receipt_no', o.external_ref,
      'reported_total', coalesce((o.pos_reported_amounts ->> 'total')::numeric, o.total_amount),
      'reported_payment', o.pos_reported_amounts ->> 'payment',
      'current_total', o.total_amount,
      'current_payment', pm.code,
      'current_status', o.status,
      'edited_by_name', d.e ->> 'edited_by_name',
      'reason', d.e ->> 'reason',
      'edited_at', d.e ->> 'edited_at',
      'cash_diff',
        (case when o.pos_reported_amounts ->> 'payment' = 'cash' then coalesce((o.pos_reported_amounts ->> 'total')::numeric, 0) else 0 end)
        - (case when o.status = 'ok' and pm.code = 'cash' then o.total_amount else 0 end)) as j
    from public.orders o
    left join public.payment_methods pm on pm.id = o.payment_method_id and pm.shop_id = o.shop_id
    cross join lateral (select public.dayo_order_dayo_edit(o.shop_id, o.id) as e) d
    where o.shop_id = p_shop_id and o.pos_shift_id = p_shift_id and o.source = 'pos' and d.e is not null
      and (o.status = 'cancelled'
           or o.total_amount <> coalesce((o.pos_reported_amounts ->> 'total')::numeric, o.total_amount)
           or pm.code is distinct from coalesce(o.pos_reported_amounts ->> 'payment', pm.code))
  ) x
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 2. แดชบอร์ด owner — 1 บรรทัดต่อกะ + รายการเสริม (สเปก §4.10 เว็บ dayo)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dashboard_shifts(p_shop_id uuid, p_staff_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_live date;
  v_cash_pm uuid;
  v_last_count timestamptz;
begin
  perform public.dayo_require_staff(p_shop_id, p_staff_id, array['owner']);
  perform public.dayo_check_range(p_from, p_to);
  select s.block3_live_from into v_live from public.shop_settings s where s.shop_id = p_shop_id;
  select pm.id into v_cash_pm from public.payment_methods pm where pm.shop_id = p_shop_id and pm.code = 'cash';
  select max(cc.counted_at) into v_last_count from public.cash_counts cc where cc.shop_id = p_shop_id;
  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'block3_live_from', v_live,
    'off_catalog_bills', (select count(*) from public.orders o
                          where o.shop_id = p_shop_id and o.off_catalog and o.status = 'ok' and o.sale_date between p_from and p_to),
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'shift_id', s.id, 'business_date', s.business_date, 'device_name', ac.name,
        'opened_at', s.opened_at, 'opened_by_name', so.display_name, 'quick_open', s.quick_open, 'status', s.status,
        'counted_at', c.counted_at, 'closed_at', s.closed_at,
        'variance', z.variance, 'variance_alert', z.variance_alert,
        'recompute_status', z.recompute_status, 'waiting_since', case when z.recompute_status = 'waiting_bills' then z.waiting_since end,
        'chain_break', coalesce(z.chain_break, false),
        'z_gap', coalesce(z.recompute_notes @> '[{"note":"z_gap"}]' or z.recompute_notes @> '[{"note":"z_prev_missing"}]', false),
        'data_conflict', s.data_conflict,
        'overlap', exists (
          select 1 from public.shifts s2 join public.cash_counts c2 on c2.shift_id = s2.id
          where c.counted_at is not null and s2.api_client_id = s.api_client_id and s2.id <> s.id
            and s2.opened_at < c.counted_at and s.opened_at < c2.counted_at),
        'owner_edited_bills', jsonb_array_length(public.dayo_shift_owner_edits(p_shop_id, s.id))
      ) order by s.business_date desc, s.opened_at desc)
      from public.shifts s
      left join public.cash_counts c on c.shift_id = s.id
      left join public.z_reports z on z.shift_id = s.id
      left join public.api_clients ac on ac.id = s.api_client_id and ac.shop_id = s.shop_id
      left join public.staff so on so.id = s.opened_by and so.shop_id = s.shop_id
      where s.shop_id = p_shop_id and s.business_date between p_from and p_to), '[]'::jsonb),
    'extras', jsonb_build_object(
      -- บิลเงินสดบอท/เว็บที่ไม่อยู่ใน Z ใดเลย (นับเฉพาะ sale_date ≥ block3_live_from · สร้างก่อนการนับล่าสุดของร้าน — ตีความข้อ 10)
      'bot_outside_z', coalesce((
        select jsonb_agg(jsonb_build_object('order_no', o.order_no, 'source', o.source, 'created_at', o.created_at, 'total', o.total_amount)
                         order by o.created_at)
        from public.orders o
        where o.shop_id = p_shop_id and o.status = 'ok' and o.payment_method_id = v_cash_pm and o.source in ('line', 'web')
          and o.sale_date between p_from and p_to and v_live is not null and o.sale_date >= v_live
          and v_last_count is not null and o.created_at <= v_last_count
          and not exists (select 1 from public.z_reports z, jsonb_array_elements(z.snapshot -> 'bot_bills') e
                          where z.shop_id = p_shop_id and e ->> 'order_no' = o.order_no)), '[]'::jsonb),
      -- บิลบอทใน Z ที่เปลี่ยน/ยกเลิกหลังถูกนับ (เทียบ version) — Z แช่แข็งไม่เปลี่ยน
      'changed_after_count', coalesce((
        select jsonb_agg(jsonb_build_object('order_no', o.order_no, 'shift_id', z.shift_id, 'z_version', (e ->> 'version')::integer,
                           'current_version', o.version, 'current_status', o.status, 'z_total', (e ->> 'total')::numeric, 'current_total', o.total_amount)
                         order by o.order_no)
        from public.z_reports z
        join public.shifts s on s.id = z.shift_id
        cross join jsonb_array_elements(z.snapshot -> 'bot_bills') e
        join public.orders o on o.shop_id = z.shop_id and o.order_no = e ->> 'order_no'
        where z.shop_id = p_shop_id and s.business_date between p_from and p_to and o.version <> (e ->> 'version')::integer), '[]'::jsonb),
      -- บิลบอท/เว็บที่เปลี่ยนจากเงินสดหรือถูกยกเลิก "ก่อน" ถูกนับ (อ่านจาก audit_log — m7)
      'changed_from_cash_before_count', coalesce((
        select jsonb_agg(distinct jsonb_build_object('order_no', o.order_no, 'source', o.source, 'current_status', o.status))
        from public.orders o
        join public.audit_log a on a.shop_id = o.shop_id and a.entity = 'orders' and a.entity_id = o.id and a.action in ('order_edit', 'order_cancel')
        where o.shop_id = p_shop_id and o.source in ('line', 'web') and o.sale_date between p_from and p_to
          and v_live is not null and o.sale_date >= v_live
          and (a.before -> 'order' ->> 'payment_method_id')::uuid = v_cash_pm
          and ((a.after -> 'order' ->> 'payment_method_id') is distinct from (a.before -> 'order' ->> 'payment_method_id')
               or a.after -> 'order' ->> 'status' = 'cancelled')
          and a.at <= (select min(cc.counted_at) from public.cash_counts cc where cc.shop_id = o.shop_id and cc.counted_at >= o.created_at)), '[]'::jsonb),
      -- บิล POS ที่ pos_shift_id ยังไม่มีกะในฐาน (ผูกทีหลังได้)
      'bills_without_shift', coalesce((
        select jsonb_agg(jsonb_build_object('order_no', o.order_no, 'receipt_no', o.external_ref, 'pos_shift_id', o.pos_shift_id) order by o.sold_at)
        from public.orders o
        where o.shop_id = p_shop_id and o.source = 'pos' and o.pos_shift_id is not null and o.sale_date between p_from and p_to
          and not exists (select 1 from public.shifts s where s.id = o.pos_shift_id)), '[]'::jsonb)
    )
  );
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 3. หน้ารายละเอียดกะ /shifts/[shift_id] (owner · อ่านอย่างเดียว)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.get_shift_detail(p_shop_id uuid, p_staff_id uuid, p_shift_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  s public.shifts;
  c public.cash_counts;
  z public.z_reports;
  v_prev_alert numeric;
  v_edits jsonb;
begin
  perform public.dayo_require_staff(p_shop_id, p_staff_id, array['owner']);
  select * into s from public.shifts x where x.id = p_shift_id and x.shop_id = p_shop_id;
  if not found then
    raise exception using errcode = 'DY404', message = 'not_found: ไม่พบกะ';
  end if;
  select * into c from public.cash_counts x where x.shift_id = s.id;
  select * into z from public.z_reports x where x.shift_id = s.id;
  if z.shift_id is not null then
    select p.variance_alert into v_prev_alert from public.z_reports p
    where p.api_client_id = z.api_client_id and p.z_no < z.z_no order by p.z_no desc limit 1;
  end if;
  v_edits := public.dayo_shift_owner_edits(p_shop_id, s.id);
  return jsonb_build_object(
    'shift', jsonb_build_object(
      'id', s.id, 'business_date', s.business_date, 'device_name', (select ac.name from public.api_clients ac where ac.id = s.api_client_id),
      'opened_at', s.opened_at, 'opened_by_name', (select st.display_name from public.staff st where st.id = s.opened_by),
      'opening_float', s.opening_float, 'quick_open', s.quick_open, 'status', s.status,
      'counted_at', c.counted_at, 'closed_at', s.closed_at,
      'closed_by_name', (select st.display_name from public.staff st where st.id = s.closed_by), 'data_conflict', s.data_conflict),
    'count', case when c.id is null then null else jsonb_build_object(
      'lines', c.lines, 'counted', c.counted, 'counted_at', c.counted_at,
      'counted_by_name', (select st.display_name from public.staff st where st.id = c.counted_by)) end,
    'movements', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'amount', m.amount, 'reason', m.reason, 'created_at', m.created_at,
        'created_by_name', st.display_name, 'pos_order_id', m.pos_order_id, 'receipt_no', o.external_ref) order by m.created_at, m.id)
      from public.cash_movements m
      left join public.staff st on st.id = m.created_by and st.shop_id = m.shop_id
      left join public.orders o on o.shop_id = m.shop_id and o.pos_order_id = m.pos_order_id
      where m.shift_id = s.id), '[]'::jsonb),
    'z', case when z.shift_id is null then null else jsonb_build_object(
      'z_no', z.z_no, 'hash', z.hash, 'prev_hash', z.prev_hash, 'chain_warning', z.chain_warning, 'chain_break', z.chain_break,
      'expected', z.expected, 'counted', z.counted, 'variance', z.variance, 'variance_reason', z.variance_reason,
      'variance_alert', z.variance_alert, 'variance_alert_prev', v_prev_alert,
      'cash', z.snapshot -> 'cash', 'computed', z.recompute_detail -> 'computed', 'bot_window', z.snapshot -> 'bot_window',
      'bot_bills', coalesce((
        select jsonb_agg(e || jsonb_build_object('current_version', o.version, 'current_total', o.total_amount, 'current_status', o.status)
                         order by e ->> 'order_no')
        from jsonb_array_elements(z.snapshot -> 'bot_bills') e
        left join public.orders o on o.shop_id = z.shop_id and o.order_no = e ->> 'order_no'), '[]'::jsonb),
      'pos_bills', coalesce((
        select jsonb_agg(e || jsonb_build_object('order_no', o.order_no, 'in_db', o.id is not null) order by e ->> 'sold_at')
        from jsonb_array_elements(z.snapshot -> 'pos_bills') e
        left join public.orders o on o.shop_id = z.shop_id and o.api_client_id = z.api_client_id and o.pos_order_id = (e ->> 'pos_order_id')::uuid), '[]'::jsonb),
      'recompute_status', z.recompute_status, 'recompute_detail', z.recompute_detail, 'recompute_notes', z.recompute_notes,
      'waiting_since', z.waiting_since,
      'waiting',
        coalesce((select jsonb_agg(jsonb_build_object('kind', 'bill', 'id', x, 'receipt_no',
                    (select e ->> 'receipt_no' from jsonb_array_elements(z.snapshot -> 'pos_bills') e where (e ->> 'pos_order_id')::uuid = x limit 1)))
                  from unnest(z.missing_pos_order_ids) x), '[]'::jsonb)
        || coalesce((select jsonb_agg(jsonb_build_object('kind', 'movement', 'id', x, 'receipt_no', null)) from unnest(z.missing_movement_ids) x), '[]'::jsonb)
        || coalesce((select jsonb_agg(jsonb_build_object('kind', 'void', 'id', x, 'receipt_no',
                    coalesce((select e ->> 'receipt_no' from jsonb_array_elements(z.snapshot -> 'pos_bills') e where (e ->> 'pos_order_id')::uuid = x limit 1),
                             (select o.external_ref from public.orders o where o.shop_id = z.shop_id and o.pos_order_id = x))))
                  from unnest(z.missing_void_order_ids) x), '[]'::jsonb)
    ) end,
    'owner_edits', v_edits,
    'owner_edits_cash_diff', coalesce((select sum((e ->> 'cash_diff')::numeric) from jsonb_array_elements(v_edits) e), 0)
  );
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 4. แจ้งใบปิดกะรอบิลนาน (รอ Q74 — ค่าเริ่มต้น) + ล้างคิวแจ้งเตือนเก่า — cron บอทรายชั่วโมงเรียก
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.pos_alerts_scan(p_shop_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_hours integer;
  v_n integer := 0;
  r record;
begin
  if p_shop_id is null then
    raise exception using errcode = 'DY401', message = 'actor_required: ต้องระบุร้าน';
  end if;
  select s.shift_waiting_alert_hours into v_hours from public.shop_settings s where s.shop_id = p_shop_id;
  if not found then
    v_hours := 48;  -- (รอ Q74 — ค่าเริ่มต้น · ต้องเท่ากับ default ของคอลัมน์ใน 0055)
  end if;
  if v_hours is not null then
    for r in
      select z.shift_id, s.business_date from public.z_reports z join public.shifts s on s.id = z.shift_id
      where z.shop_id = p_shop_id and z.recompute_status = 'waiting_bills' and z.alerted_waiting_at is null
        and z.waiting_since < now() - make_interval(hours => v_hours)
    loop
      if public.dayo_pos_alert(p_shop_id, 'warning', 'waiting', 'waiting:' || r.shift_id::text,
           format('กะ %s ใบปิดกะรอบิลเกิน %s ชม. — ดูที่ /shifts/%s', public.dayo_thai_short_date(r.business_date), v_hours, r.shift_id)) then
        v_n := v_n + 1;
      end if;
      perform set_config('dayo.shift_writer', 'alert', true);
      update public.z_reports x set alerted_waiting_at = now() where x.shift_id = r.shift_id;
      perform set_config('dayo.shift_writer', '', true);
    end loop;
  end if;
  delete from public.pos_alerts a where a.shop_id = p_shop_id and a.sent_at < now() - interval '30 days';
  return v_n;
end;
$$;
```

  ต่อในไฟล์เดียวกัน: **`export_rows`** — ลอก `0009_stock_reports.sql:693-769` ทุกบรรทัด แล้ว (ก) ในกลุ่ม `orders` เพิ่ม `'off_catalog', o.off_catalog,` ต่อจาก `'amount_mismatch', o.amount_mismatch,` (ข) เพิ่มกิ่งนี้ก่อน `else` สุดท้าย (ป้าย `-- ADR-0056`) (ค) แก้ข้อความ error ท้ายเป็น `'invalid: group ต้องเป็น template/sales/orders/daily/stock/stock_movements/staff/imports/audit/shifts'`:

```sql
  elsif p_group = 'shifts' then
    -- ADR-0056 (D99 · S6): ข้อมูลกะ — owner เท่านั้น (ตรวจแล้วบรรทัดแรกของฟังก์ชัน)
    select coalesce(jsonb_agg(jsonb_build_object(
      'business_date', s.business_date, 'device_name', ac.name, 'opened_at', s.opened_at, 'opened_by_name', so.display_name,
      'opening_float', s.opening_float, 'quick_open', s.quick_open, 'counted_at', c.counted_at, 'counted', c.counted,
      'closed_at', s.closed_at, 'closed_by_name', sc.display_name, 'z_no', z.z_no, 'expected', z.expected, 'variance', z.variance,
      'variance_reason', z.variance_reason, 'variance_alert', z.variance_alert, 'recompute_status', z.recompute_status,
      'chain_break', z.chain_break, 'data_conflict', s.data_conflict) order by s.business_date, s.opened_at), '[]'::jsonb)
    into v_rows
    from public.shifts s
    left join public.cash_counts c on c.shift_id = s.id
    left join public.z_reports z on z.shift_id = s.id
    left join public.api_clients ac on ac.id = s.api_client_id and ac.shop_id = s.shop_id
    left join public.staff so on so.id = s.opened_by and so.shop_id = s.shop_id
    left join public.staff sc on sc.id = s.closed_by and sc.shop_id = s.shop_id
    where s.shop_id = p_shop_id and s.business_date between p_from and p_to;
```

  ท้ายไฟล์: **บล็อกสิทธิ์มาตรฐาน** (Task 1 Step 4 · รวม `grant execute on function public.customer_shop_info(uuid) to anon;`)

- [ ] **Step 4: รันให้ผ่าน + ทั้งโฟลเดอร์**

Run: `npm run db:reset && npm run db:types && npx vitest run --root packages/shared test/db/block3_shift_reads.db.test.ts test/db/customer_bot.db.test.ts test/db`
Expected: PASS ทุกไฟล์ (ใหม่ 6 ไฟล์ + ของเดิม รวม `customer_bot.db.test.ts`)

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add supabase/migrations/0060_block3_shift_reads.sql packages/shared/test/db/block3_shift_reads.db.test.ts packages/shared/src/database.types.ts
git commit -m "feat(db): add owner shift views, waiting alerts and shift export"
```

---

## Task 7: ข้อความแสดงผลกะ + บรรทัดบิลไม่รู้ต้นทุนในรายงานเช้า (`packages/shared`)

**agent:** shared-logic-engineer · sonnet (lane C · ไม่ใช้ Docker) · เริ่มได้หลัง Task 0 (ใช้ชื่อฟิลด์จาก "Interfaces" ของ Task 5/6 — ไม่ต้องรอ merge)

**Files:**
- Create: `packages/shared/src/shiftDisplay.ts`, `packages/shared/test/shiftDisplay.test.ts`, `packages/shared/test/discordDigestUnknownCost.test.ts`
- Modify: `packages/shared/src/index.ts` (export) · `packages/shared/src/discordMessages.ts` (`DailyDigest.summary` + บรรทัดใน `buildDailyDigestMessage`)

**Interfaces:**
- Consumes: `fmtMoney` (`fmt.ts`) · `bkkTime` (`time.ts`) · รูปแถวของ `dashboard_shifts.shifts[]` และ `get_shift_detail.z.waiting[]` (Task 6) · รหัส `check`/`note` ของ `recompute_detail`/`recompute_notes` (Task 4)
- Produces: `ShiftLine` · `thaiShortDate(d)` · `varianceLabel(v)` · `waitingAgeHours(since, now)` · `shiftLineText(s)` · `shiftBadges(s, now)` · `unknownCostLine(bills, revenue)` · `gpPctText(gp)` · `WaitingItem` · `waitingReasonText(w, hours)` · `recomputeCheckText(code)` · `recomputeNoteText(code)` · `DailyDigest.summary.unknown_cost_bills?/unknown_cost_revenue?`

- [ ] **Step 1: เทสต์ที่ต้องตก** — `packages/shared/test/shiftDisplay.test.ts`

```ts
// shiftDisplay.test.ts — ข้อความแสดงผลกะ (ADR-0056 ข้อ 11 · สเปก POS §4.10 เว็บ dayo) — บริสุทธิ์ ไม่มีฐานข้อมูล
import { describe, expect, it } from "vitest";
import {
  gpPctText, recomputeCheckText, recomputeNoteText, shiftBadges, shiftLineText, thaiShortDate, unknownCostLine, varianceLabel, waitingAgeHours, waitingReasonText,
} from "../src/shiftDisplay.js";
import type { ShiftLine } from "../src/shiftDisplay.js";

const base: ShiftLine = {
  shift_id: "s1", business_date: "2026-09-25", device_name: "แท็บเล็ตขาย 1", opened_at: "2026-09-25T02:02:00Z", opened_by_name: "TungAo",
  quick_open: false, status: "closed", counted_at: "2026-09-25T13:41:00Z", closed_at: "2026-09-25T13:45:00Z", variance: -20, variance_alert: 20,
  recompute_status: "matched", waiting_since: null, chain_break: false, z_gap: false, data_conflict: false, overlap: false, owner_edited_bills: 0,
};

describe("shiftDisplay", () => {
  it("บรรทัดกะตามสเปก: วันที่ · เปิด เวลา ชื่อ · ปิด เวลา · ขาด/เกิน", () => {
    expect(shiftLineText(base)).toBe("กะ 25 ก.ย. · เปิด 09:02 TungAo · ปิด 20:41 · ขาด ฿20.00");
    expect(shiftLineText({ ...base, variance: 5.5 })).toBe("กะ 25 ก.ย. · เปิด 09:02 TungAo · ปิด 20:41 · เกิน ฿5.50");
    expect(shiftLineText({ ...base, counted_at: null, recompute_status: null, variance: null, status: "open" })).toBe("กะ 25 ก.ย. · เปิด 09:02 TungAo · ยังเปิดอยู่");
    expect(shiftLineText({ ...base, recompute_status: null, variance: null, status: "counted" })).toBe("กะ 25 ก.ย. · เปิด 09:02 TungAo · ปิด 20:41 · รอใบปิดกะ");
  });

  it("ป้าย: ไม่ตรง · รอบิล N ชม. · โซ่ Z ขาด · Z ขาดช่วง · ข้อมูลชนกัน · กะซ้อนกัน · เจ้าของแก้ N บิล", () => {
    const now = Date.parse("2026-09-26T02:00:00Z");
    expect(shiftBadges(base, now)).toEqual([]);
    expect(shiftBadges({ ...base, recompute_status: "waiting_bills", waiting_since: "2026-09-25T23:30:00Z", chain_break: true, z_gap: true,
      data_conflict: true, overlap: true, owner_edited_bills: 2 }, now)).toEqual(["รอบิล 2 ชม.", "โซ่ Z ขาด", "Z ขาดช่วง", "ข้อมูลชนกัน", "กะซ้อนกัน", "เจ้าของแก้ 2 บิล"]);
    expect(shiftBadges({ ...base, recompute_status: "mismatch" }, now)).toEqual(["ไม่ตรง"]);
  });

  it("ส่วนต่าง/อายุการรอ/บรรทัดบิลไม่รู้ต้นทุน/GP%", () => {
    expect([varianceLabel(0), varianceLabel(null), varianceLabel("-19.99")]).toEqual(["ตรง", "—", "ขาด ฿19.99"]);
    expect(waitingAgeHours("2026-09-25T00:00:00Z", Date.parse("2026-09-27T00:30:00Z"))).toBe(48);
    expect(waitingAgeHours(null, 0)).toBeNull();
    expect(unknownCostLine(1, 70)).toBe("บิลไม่รู้ต้นทุน 1 ใบ · ยอด ฿70.00");
    expect(unknownCostLine(0, 0)).toBeNull();
    expect([gpPctText(0.70857), gpPctText(null)]).toEqual(["70.9%", "—"]);
    expect(thaiShortDate("2026-01-05")).toBe("5 ม.ค.");
  });

  it("เหตุผลการรอ + ข้อความผลคิดซ้ำ", () => {
    expect(waitingReasonText({ kind: "void", id: "x", receipt_no: "A-000312" }, 3)).toBe("เงินคืนของบิลที่ยังไม่ถูกยกเลิก A-000312 · 3 ชม.");
    expect(waitingReasonText({ kind: "bill", id: "x", receipt_no: "A-000313" }, null)).toBe("บิล A-000313 ยังไม่ถึงระบบกลาง");
    expect(waitingReasonText({ kind: "movement", id: "x", receipt_no: null }, 1)).toBe("เงินเข้า-ออกลิ้นชักยังไม่ถึงระบบกลาง · 1 ชม.");
    expect(recomputeCheckText("bot_bill_missing_in_z")).toBe("บิลเงินสดบอท/เว็บในช่วงนับ แต่ไม่อยู่ในใบปิดกะ");
    expect(recomputeCheckText("unknown_code_x")).toBe("unknown_code_x");
    expect(recomputeNoteText("z_gap")).toBe("Z ขาดช่วง (ใบก่อนหน้ายังไม่ถึงระบบกลาง)");
  });
});
```

  `packages/shared/test/discordDigestUnknownCost.test.ts`:

```ts
// รายงานเช้า: บรรทัด "บิลไม่รู้ต้นทุน" แสดงเฉพาะเมื่อเปิดกำไร (showProfit) และมีบิลนอกแคตตาล็อก (ADR-0056 ข้อ 5 · ADR-0044)
import { describe, expect, it } from "vitest";
import { buildDailyDigestMessage, type DailyDigest } from "../src/discordMessages.js";

const d: DailyDigest = {
  day: "2026-09-25",
  summary: { revenue: 105, cups: 3, bills: 2, gross_profit: 24.8, gp_pct: 0.7086, unknown_cost_bills: 1, unknown_cost_revenue: 70 },
  top_menus: [], low_stock: [], low_stock_count: 0, last_backup_at: new Date().toISOString(),
};
const fields = (showProfit: boolean) => buildDailyDigestMessage(d, { at: Date.now(), showProfit }).embeds[0]!.fields ?? [];

describe("buildDailyDigestMessage — บิลไม่รู้ต้นทุน", () => {
  it("showProfit → มีบรรทัด · ปิด → ไม่มี", () => {
    expect(fields(true).find((f) => f.name === "บิลไม่รู้ต้นทุน")?.value).toBe("1 ใบ · ฿70.00");
    expect(fields(false).some((f) => f.name === "บิลไม่รู้ต้นทุน")).toBe(false);
  });
  it("ไม่มีบิลนอกแคตตาล็อก → ไม่มีบรรทัด", () => {
    const f = buildDailyDigestMessage({ ...d, summary: { ...d.summary, unknown_cost_bills: 0, unknown_cost_revenue: 0 } }, { at: Date.now(), showProfit: true }).embeds[0]!.fields ?? [];
    expect(f.some((x) => x.name === "บิลไม่รู้ต้นทุน")).toBe(false);
  });
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npx vitest run --root packages/shared test/shiftDisplay.test.ts test/discordDigestUnknownCost.test.ts`
Expected: FAIL — `Cannot find module '../src/shiftDisplay.js'`

- [ ] **Step 3: เขียนโค้ด** — `packages/shared/src/shiftDisplay.ts`

```ts
// shiftDisplay.ts — ข้อความแสดงผลกะบนเว็บ dayo (ADR-0056 ข้อ 11 · สเปก POS §4.10 เว็บ dayo · D99)
// แปลงผล RPC dashboard_shifts / get_shift_detail เป็นข้อความไทยเท่านั้น — ไม่คิดเงิน (ตัวเลขมาจาก RPC — กฎเหล็กข้อ 3)
import { fmtMoney } from "./fmt.js";
import { bkkTime } from "./time.js";

const TH_MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."] as const;

export type RecomputeStatus = "waiting_bills" | "matched" | "mismatch";

/** 1 แถวของ dashboard_shifts.shifts (Task 6) */
export interface ShiftLine {
  shift_id: string;
  business_date: string;
  device_name: string | null;
  opened_at: string;
  opened_by_name: string | null;
  quick_open: boolean;
  status: "open" | "counted" | "closed";
  counted_at: string | null;
  closed_at: string | null;
  variance: number | string | null;
  variance_alert: number | string | null;
  recompute_status: RecomputeStatus | null;
  waiting_since: string | null;
  chain_break: boolean;
  z_gap: boolean;
  data_conflict: boolean;
  overlap: boolean;
  owner_edited_bills: number;
}

/** "2026-09-25" → "25 ก.ย." (ตรงกับ SQL dayo_thai_short_date) */
export function thaiShortDate(yyyyMmDd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(yyyyMmDd);
  return m ? `${Number(m[3])} ${TH_MONTHS_SHORT[Number(m[2]) - 1] ?? ""}` : yyyyMmDd;
}

/** ส่วนต่าง = นับได้ − ที่ควรมี (ติดลบ = ขาด) */
export function varianceLabel(variance: number | string | null | undefined): string {
  if (variance === null || variance === undefined || variance === "") return "—";
  const v = Number(variance);
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "ตรง";
  return v < 0 ? `ขาด ฿${fmtMoney(-v)}` : `เกิน ฿${fmtMoney(v)}`;
}

/** อายุการรอบิล (ชั่วโมงเต็ม ปัดลง) */
export function waitingAgeHours(waitingSince: string | null | undefined, now: number): number | null {
  if (!waitingSince) return null;
  const t = Date.parse(waitingSince);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / 3_600_000));
}

/** "กะ 25 ก.ย. · เปิด 09:02 TungAo · ปิด 20:41 · ขาด ฿20.00" — "ปิด" = เวลานับเงิน (กะหยุดขาย — ตีความข้อ 11) */
export function shiftLineText(s: ShiftLine): string {
  const opened = `เปิด ${bkkTime(s.opened_at)}${s.opened_by_name ? ` ${s.opened_by_name}` : ""}`;
  if (!s.counted_at) return `กะ ${thaiShortDate(s.business_date)} · ${opened} · ยังเปิดอยู่`;
  const tail = s.recompute_status ? varianceLabel(s.variance) : "รอใบปิดกะ";
  return `กะ ${thaiShortDate(s.business_date)} · ${opened} · ปิด ${bkkTime(s.counted_at)} · ${tail}`;
}

export function shiftBadges(s: ShiftLine, now: number): string[] {
  const b: string[] = [];
  if (s.recompute_status === "mismatch") b.push("ไม่ตรง");
  if (s.recompute_status === "waiting_bills") b.push(`รอบิล ${waitingAgeHours(s.waiting_since, now) ?? 0} ชม.`);
  if (s.chain_break) b.push("โซ่ Z ขาด");
  if (s.z_gap) b.push("Z ขาดช่วง");
  if (s.data_conflict) b.push("ข้อมูลชนกัน");
  if (s.overlap) b.push("กะซ้อนกัน");
  if (s.owner_edited_bills > 0) b.push(`เจ้าของแก้ ${s.owner_edited_bills} บิล`);
  return b;
}

/** "บิลไม่รู้ต้นทุน N ใบ · ยอด ฿X" (D97) — ไม่มีบิล = null */
export function unknownCostLine(bills: number | string | null | undefined, revenue: number | string | null | undefined): string | null {
  const n = Number(bills ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `บิลไม่รู้ต้นทุน ${n} ใบ · ยอด ฿${fmtMoney(Number(revenue ?? 0))}`;
}

/** GP% (ตัวหาร = ยอดขาย − ยอดบิลไม่รู้ต้นทุน คิดใน SQL แล้ว) · null = "—" */
export function gpPctText(gpPct: number | string | null | undefined): string {
  if (gpPct === null || gpPct === undefined || gpPct === "") return "—";
  const v = Number(gpPct);
  return Number.isFinite(v) ? `${(Math.round(v * 1000) / 10).toFixed(1)}%` : "—";
}

export interface WaitingItem {
  kind: "bill" | "movement" | "void";
  id: string;
  receipt_no: string | null;
}

export function waitingReasonText(w: WaitingItem, hours: number | null): string {
  const age = hours === null ? "" : ` · ${hours} ชม.`;
  if (w.kind === "bill") return `บิล ${w.receipt_no ?? "(ไม่ทราบเลข)"} ยังไม่ถึงระบบกลาง${age}`;
  if (w.kind === "movement") return `เงินเข้า-ออกลิ้นชักยังไม่ถึงระบบกลาง${age}`;
  return `เงินคืนของบิลที่ยังไม่ถูกยกเลิก ${w.receipt_no ?? "(ไม่ทราบเลข)"}${age}`;
}

const CHECK_TEXT: Record<string, string> = {
  bill_shift: "บิลในใบปิดกะไม่ได้ผูกกับกะนี้ในระบบกลาง",
  bill_total: "ยอดบิลในใบปิดกะไม่ตรงกับยอดที่เก็บจริง",
  bill_sold_at: "เวลาขายในใบปิดกะไม่ตรงกับระบบกลาง",
  bill_payment_side: "วิธีชำระ (เงินสด/ไม่ใช่เงินสด) ไม่ตรงกับระบบกลาง",
  bill_not_in_z: "บิลของกะนี้ในระบบกลางไม่อยู่ในใบปิดกะ",
  movement_not_of_shift: "เงินเข้า-ออกในใบปิดกะไม่ใช่ของกะนี้ หรือหลังเวลานับ",
  movement_not_in_z: "เงินเข้า-ออกของกะนี้ไม่อยู่ในใบปิดกะ",
  void_refund_other_key: "เงินคืนชี้บิลของเครื่องอื่น",
  void_refund_bill_not_voided_in_z: "เงินคืนของบิลที่ใบปิดกะบอกว่ายังไม่ยกเลิก",
  void_refund_over_total: "เงินคืนรวมเกินยอดบิล",
  bot_bill_missing_in_z: "บิลเงินสดบอท/เว็บในช่วงนับ แต่ไม่อยู่ในใบปิดกะ",
  bot_bill_not_in_window: "บิลบอท/เว็บในใบปิดกะไม่อยู่ในช่วงนับ",
  bot_bill_total: "ยอดบิลบอท/เว็บในใบปิดกะไม่ตรงกับยอดปัจจุบัน",
  bot_bill_in_other_z: "บิลบอท/เว็บถูกนับในใบปิดกะอื่นแล้ว",
  bot_window_after: "ช่วงนับบิลบอทไม่ต่อจากใบปิดกะก่อน",
  bot_window_after_gap: "ช่วงนับบิลบอทมีช่องว่าง/ทับกันที่มีบิลเงินสด",
  z_order: "เลขใบปิดกะไม่เรียงตามเวลานับ",
  cash_component: "องค์ประกอบเงินที่ควรมีไม่ตรงกับระบบกลาง",
};
const NOTE_TEXT: Record<string, string> = {
  z_gap: "Z ขาดช่วง (ใบก่อนหน้ายังไม่ถึงระบบกลาง)",
  z_prev_missing: "Z ก่อนหน้ายังไม่มีในระบบกลาง",
  bot_window_after_differs: "ช่วงนับบิลบอทไม่ต่อจากการนับครั้งก่อน (ไม่มีบิลในช่องว่าง)",
  bot_bill_changed_after_count: "บิลบอท/เว็บถูกแก้หลังนับ",
  receipt_renumbered: "เลขใบเสร็จเปลี่ยนหลังออกใบปิดกะ",
};
export const recomputeCheckText = (code: string): string => CHECK_TEXT[code] ?? code;
export const recomputeNoteText = (code: string): string => NOTE_TEXT[code] ?? code;
```

  `packages/shared/src/index.ts`: เพิ่ม `export * from "./shiftDisplay.js";`

  `packages/shared/src/discordMessages.ts`: (ก) บรรทัด 326 เปลี่ยนเป็น
  `summary: { revenue: number; cups: number; bills: number; gross_profit: number; gp_pct: number | null; unknown_cost_bills?: number; unknown_cost_revenue?: number };`
  (ข) ในบล็อก `if (opts.showProfit) {` (บรรทัด 381–384) เพิ่มท้ายบล็อก:

```ts
      // ADR-0056 (D97): บิลนอกแคตตาล็อกไม่มีต้นทุน — ไม่นับในกำไรขั้นต้น/GP% จึงบอกแยก
      if (n(s.unknown_cost_bills) > 0) {
        fields.push(field("บิลไม่รู้ต้นทุน", `${fmt(n(s.unknown_cost_bills), 0)} ใบ · ฿${fmtMoney(n(s.unknown_cost_revenue))}`));
      }
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npx vitest run --root packages/shared test/shiftDisplay.test.ts test/discordDigestUnknownCost.test.ts && npm run typecheck -w @dayo/shared`
Expected: PASS · (`npm run ci` เต็มรันหลัง merge Task 1 แล้วเท่านั้น — ข้อยกเว้นในตาราง "ลำดับและงานขนาน")

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add packages/shared/src/shiftDisplay.ts packages/shared/src/index.ts packages/shared/src/discordMessages.ts packages/shared/test/shiftDisplay.test.ts packages/shared/test/discordDigestUnknownCost.test.ts
git commit -m "feat(shared): add shift display text and unknown-cost digest line"
```

---

## Task 8: เว็บ — scope `shift:write` · ค่าตั้งเงินสด POS · ไฟล์สำรองตารางใหม่

**agent:** web-developer · sonnet (lane B) · หลัง merge Task 1

**Files:**
- Modify: `apps/web/src/lib/apiScopes.ts` · `apps/web/src/lib/backup.ts` · `scripts/restore.ts`
- Create: `apps/web/src/lib/posCashSettings.ts` · `apps/web/src/app/(staff)/settings/system/PosCashSettingsSection.tsx` · `apps/web/test/settings.posCash.test.ts`
- Modify: `apps/web/src/app/(staff)/settings/system/page.tsx` · `apps/web/src/app/(staff)/settings/system/actions.ts` · `apps/web/test/backup.tables.test.ts`

**Interfaces:**
- Consumes: `get_pos_cash_settings` · `save_pos_cash_settings` (Task 1) · `backup_dump_table` ตารางใหม่ (Task 1)
- Produces: `PosCashSettings` · `getPosCashSettings(shopId, staffId)` · `savePosCashSettings(shopId, staffId, patch)` · `validatePosCashPatch(patch, current) → string | null` · `savePosCashSettingsAction(patch)` · `API_SCOPES` มี `shift:write`

- [ ] **Step 1: เทสต์ที่ต้องตก** — `apps/web/test/settings.posCash.test.ts`

```ts
// settings.posCash.test.ts — ค่าตั้งเงินสด POS (ADR-0056 · D100 · Q72/Q74) · scope shift:write · ไฟล์สำรอง
import { describe, expect, it } from "vitest";
import { API_SCOPES } from "../src/lib/apiScopes";
import { BACKUP_TABLES } from "../src/lib/backup";
import { validatePosCashPatch } from "../src/lib/posCashSettings";

const cur = { block3_live_from: "2026-09-20", off_catalog_max_total: 3000, shift_waiting_alert_hours: 48 };

describe("ค่าตั้งเงินสด POS", () => {
  it("scope shift:write อยู่ในรายการ (ตรงกับ CHECK ของ api_clients)", () => {
    expect(API_SCOPES).toContain("shift:write");
  });
  it("เพดาน: บาท ≥ 0 ทศนิยม ≤ 2", () => {
    expect(validatePosCashPatch({ off_catalog_max_total: 4500.5 }, cur)).toBeNull();
    expect(validatePosCashPatch({ off_catalog_max_total: -1 }, cur)).toMatch(/เพดาน/);
    expect(validatePosCashPatch({ off_catalog_max_total: 1.234 }, cur)).toMatch(/เพดาน/);
  });
  it("วันเริ่มใช้กะ: เลื่อนเก่าลงได้ · ไปข้างหน้า/ว่าง/ยังไม่เคยตั้ง = ผิด", () => {
    expect(validatePosCashPatch({ block3_live_from: "2026-09-01" }, cur)).toBeNull();
    expect(validatePosCashPatch({ block3_live_from: "2026-09-21" }, cur)).toMatch(/เก่ากว่าเดิม/);
    expect(validatePosCashPatch({ block3_live_from: "" }, cur)).toMatch(/วันที่/);
    expect(validatePosCashPatch({ block3_live_from: "2026-09-01" }, { ...cur, block3_live_from: null })).toMatch(/กะแรก/);
  });
  it("แจ้งใบปิดกะรอนาน: 1–720 ชม. หรือปิด (null)", () => {
    expect(validatePosCashPatch({ shift_waiting_alert_hours: null }, cur)).toBeNull();
    expect(validatePosCashPatch({ shift_waiting_alert_hours: 0 }, cur)).toMatch(/1–720/);
  });
  it("ไฟล์สำรองมีตารางก้อน 3 หลัง orders ตามลำดับ FK (shifts ก่อนลูก)", () => {
    const i = BACKUP_TABLES.indexOf("shifts");
    expect(i).toBeGreaterThan(BACKUP_TABLES.indexOf("orders"));
    expect(BACKUP_TABLES.slice(i, i + 5)).toEqual(["shifts", "cash_movements", "cash_counts", "z_reports", "pos_push_rejections"]);
    expect(BACKUP_TABLES).not.toContain("pos_alerts");
  });
});
```

- [ ] **Step 2: รันให้ตก** — Run: `npx vitest run --root apps/web test/settings.posCash.test.ts` · Expected: FAIL (`Cannot find module '../src/lib/posCashSettings'`)

- [ ] **Step 3: เขียนโค้ด**

  `apps/web/src/lib/apiScopes.ts` บรรทัด 4:
```ts
export const API_SCOPES = ["catalog:read", "staff:read", "orders:read", "orders:write", "stock:read", "stock:write", "reports:profit", "shift:write"] as const;
```

  `apps/web/src/lib/posCashSettings.ts`:
```ts
import "server-only";
import { rpc } from "./db";

// ค่าตั้งเงินสด POS (ADR-0056) — owner เท่านั้น · RPC ตรวจ p_staff_id เองอีกชั้น (ADR-0034)
// block3_live_from ตั้งเองจาก shift_open แรก (D100) · owner เลื่อนเก่าลงได้เท่านั้น (พื้นล่างของบิลนอกแคตตาล็อก)
export interface PosCashSettings {
  block3_live_from: string | null;
  off_catalog_max_total: number;          // (รอ Q72 — ค่าเริ่มต้น 3000)
  shift_waiting_alert_hours: number | null; // (รอ Q74 — ค่าเริ่มต้น 48 · null = ไม่แจ้ง)
}
export type PosCashSettingsPatch = Partial<PosCashSettings>;

export function getPosCashSettings(shopId: string, staffId: string): Promise<PosCashSettings> {
  return rpc<PosCashSettings>("get_pos_cash_settings", { p_shop_id: shopId, p_staff_id: staffId });
}

export function savePosCashSettings(shopId: string, staffId: string, patch: PosCashSettingsPatch): Promise<PosCashSettings> {
  return rpc<PosCashSettings>("save_pos_cash_settings", { p_shop_id: shopId, p_staff_id: staffId, p_patch: patch });
}

/** ตรวจก่อนส่ง (RPC ตรวจซ้ำ) — ผิด = ข้อความไทย · ถูก = null */
export function validatePosCashPatch(p: PosCashSettingsPatch, current: PosCashSettings): string | null {
  if (p.off_catalog_max_total !== undefined) {
    const v = p.off_catalog_max_total;
    if (!Number.isFinite(v) || v < 0 || Math.abs(Math.round(v * 100) - v * 100) > 1e-9) return "เพดานบิลนอกแคตตาล็อกต้องเป็นบาท ≥ 0 ทศนิยมไม่เกิน 2 ตำแหน่งค่ะ";
  }
  if (p.block3_live_from !== undefined) {
    if (!p.block3_live_from || !/^\d{4}-\d{2}-\d{2}$/.test(p.block3_live_from)) return "วันเริ่มใช้กะต้องเป็นวันที่ค่ะ";
    if (!current.block3_live_from) return "วันเริ่มใช้กะตั้งเองจากกะแรกที่ระบบรับค่ะ";
    if (p.block3_live_from > current.block3_live_from) return "เลื่อนวันเริ่มใช้กะได้เฉพาะเป็นวันที่เก่ากว่าเดิมค่ะ";
  }
  if (p.shift_waiting_alert_hours !== undefined && p.shift_waiting_alert_hours !== null) {
    const h = p.shift_waiting_alert_hours;
    if (!Number.isInteger(h) || h < 1 || h > 720) return "ชั่วโมงต้องเป็นจำนวนเต็ม 1–720 ค่ะ";
  }
  return null;
}
```

  `apps/web/src/app/(staff)/settings/system/actions.ts` — เพิ่ม import และ action ท้ายไฟล์:
```ts
import { getPosCashSettings, savePosCashSettings, validatePosCashPatch, type PosCashSettings, type PosCashSettingsPatch } from "@/lib/posCashSettings";

// ── ค่าตั้งเงินสด POS (ADR-0056 · owner เท่านั้น — RPC ตรวจ p_staff_id เองอีกชั้น) ───────────────────
export async function savePosCashSettingsAction(patch: PosCashSettingsPatch): Promise<ActionResult<PosCashSettings>> {
  return toActionResult(async () => {
    const staff = await requireRole("owner");
    const shopId = currentShopId();
    const current = await getPosCashSettings(shopId, staff.id);
    const err = validatePosCashPatch(patch, current);
    if (err) throw new Error(err);
    if (Object.keys(patch).length === 0) throw new Error("ยังไม่มีอะไรเปลี่ยนค่ะ");
    return savePosCashSettings(shopId, staff.id, patch);
  });
}
```

  `apps/web/src/app/(staff)/settings/system/PosCashSettingsSection.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import type { PosCashSettings } from "@/lib/posCashSettings";
import { savePosCashSettingsAction } from "./actions";

// ค่าตั้งเงินสด POS (ADR-0056): เพดานบิลนอกแคตตาล็อก (รอ Q72) · วันเริ่มใช้กะ (เลื่อนเก่าลงได้เท่านั้น) · แจ้งใบปิดกะรอบิลนาน (รอ Q74)
export function PosCashSettingsSection({ initial }: { initial: PosCashSettings }) {
  const [saved, setSaved] = useState(initial);
  const [maxTotal, setMaxTotal] = useState(String(initial.off_catalog_max_total));
  const [liveFrom, setLiveFrom] = useState(initial.block3_live_from ?? "");
  const [alertOn, setAlertOn] = useState(initial.shift_waiting_alert_hours !== null);
  const [hours, setHours] = useState(String(initial.shift_waiting_alert_hours ?? 48));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save() {
    const patch: Record<string, unknown> = {};
    if (Number(maxTotal) !== saved.off_catalog_max_total) patch.off_catalog_max_total = Number(maxTotal);
    if (saved.block3_live_from && liveFrom !== saved.block3_live_from) patch.block3_live_from = liveFrom;
    const h = alertOn ? Number(hours) : null;
    if (h !== saved.shift_waiting_alert_hours) patch.shift_waiting_alert_hours = h;
    start(async () => {
      const res = await savePosCashSettingsAction(patch);
      if (!res.ok) return setMsg({ ok: false, text: res.error });
      setSaved(res.data);
      setMsg({ ok: true, text: "บันทึกแล้วค่ะ" });
    });
  }

  return (
    <section className="mb-4 rounded-xl border border-forest/10 bg-white p-4">
      <h2 className="mb-1 font-semibold text-forest">🧾 เงินสดหน้าร้าน (แท็บเล็ต POS)</h2>
      <label className="mb-3 block text-sm">
        เพดานยอดต่อบิลนอกแคตตาล็อก (บาท)
        <input type="number" min={0} step="0.01" value={maxTotal} onChange={(e) => setMaxTotal(e.target.value)}
          className="mt-1 w-full rounded border border-charcoal/20 px-2 py-1.5" />
        <span className="text-xs text-charcoal/50">บิลที่ระบบปฏิเสธแล้วเจ้าของปิดเป็น "นอกแคตตาล็อก" บนแท็บเล็ต ต้องไม่เกินยอดนี้</span>
      </label>
      <label className="mb-3 block text-sm">
        วันเริ่มใช้กะ
        <input type="date" value={liveFrom} disabled={!saved.block3_live_from} max={saved.block3_live_from ?? undefined}
          onChange={(e) => setLiveFrom(e.target.value)} className="mt-1 w-full rounded border border-charcoal/20 px-2 py-1.5 disabled:opacity-50" />
        <span className="text-xs text-charcoal/50">
          {saved.block3_live_from ? "ตั้งเองจากกะแรกที่ระบบรับ · เลื่อนได้เฉพาะเป็นวันที่เก่ากว่าเดิม" : "ยังไม่มีกะจากแท็บเล็ต — ระบบตั้งให้เองเมื่อรับกะแรก"}
        </span>
      </label>
      <label className="mb-1 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={alertOn} onChange={(e) => setAlertOn(e.target.checked)} />
        แจ้ง Discord เมื่อใบปิดกะรอบิลนานเกิน
        <input type="number" min={1} max={720} value={hours} disabled={!alertOn} onChange={(e) => setHours(e.target.value)}
          className="w-20 rounded border border-charcoal/20 px-2 py-1 disabled:opacity-50" /> ชม.
      </label>
      <button type="button" disabled={pending} onClick={save} className="mt-2 rounded-full bg-forest px-4 py-2 text-sm text-cream disabled:opacity-50">
        บันทึก
      </button>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-forest" : "text-brick"}`}>{msg.text}</p>}
    </section>
  );
}
```

  `apps/web/src/app/(staff)/settings/system/page.tsx`: เพิ่ม `getPosCashSettings(shopId, staff.id)` ใน `Promise.all` (ตัวที่ 5 → `posCash`) · import `PosCashSettingsSection` แล้ววาง `<PosCashSettingsSection initial={posCash} />` ต่อจาก `<SystemSettingsClient … />`

  `apps/web/src/lib/backup.ts` และ `scripts/restore.ts`: เพิ่มต่อจาก `"order_duplicate_flags",` (ทั้งสองรายการ ลำดับเดียวกัน):
```ts
  "shifts", // กะ (ADR-0056) — หลัง api_clients/staff · append-only (กู้แบบใส่เฉพาะที่ยังไม่มี)
  "cash_movements", // เงินเข้า-ออกลิ้นชัก — หลัง shifts
  "cash_counts", // นับเงินปิดกะ — หลัง shifts
  "z_reports", // ใบปิดกะ — หลัง shifts · คีย์ shift_id
  "pos_push_rejections", // ประวัติแถว order ที่ถูกปฏิเสธ — คีย์ (api_client_id, pos_order_id, reason)
```
  `scripts/restore.ts` เพิ่มเติม: `APPEND_ONLY_TABLES` + `"shifts", "cash_movements", "cash_counts", "z_reports", "pos_push_rejections"` · `COMPOSITE_KEY` + `z_reports: "shift_id",` และ `pos_push_rejections: "api_client_id,pos_order_id,reason",`

  `apps/web/test/backup.tables.test.ts`: เคสเดิมคงไว้ (เคสใหม่อยู่ใน `settings.posCash.test.ts`)

- [ ] **Step 4: รันให้ผ่าน** — Run: `npx vitest run --root apps/web test/settings.posCash.test.ts test/backup.tables.test.ts && npm run typecheck -w @dayo/web` · Expected: PASS

- [ ] **Step 5: ทดสอบด้วยมือ (Docker ว่าง)** — `npm run dev:web` → `/settings/system` ในฐานะ owner: เห็นส่วน "เงินสดหน้าร้าน" · วันเริ่มใช้กะปิดอยู่ (ยังไม่มีกะ) · แก้เพดานเป็น 4500 → บันทึกแล้ว · `/settings/api-clients` มีช่องติ๊ก `shift:write`

- [ ] **Step 6: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add apps/web/src/lib/apiScopes.ts apps/web/src/lib/posCashSettings.ts apps/web/src/lib/backup.ts scripts/restore.ts "apps/web/src/app/(staff)/settings/system/page.tsx" "apps/web/src/app/(staff)/settings/system/actions.ts" "apps/web/src/app/(staff)/settings/system/PosCashSettingsSection.tsx" apps/web/test/settings.posCash.test.ts
git commit -m "feat(web): add pos cash settings, shift scope and backup tables"
```

---

## Task 9: เว็บ — E4 `GET /v1/pos/shift-cash` · ส่งแจ้งเตือน POS จากคิว

**agent:** web-developer · sonnet (lane B) · โค้ดเริ่มได้หลัง merge Task 1 · เทสต์ฐานจริงหลัง merge Task 4 (คิว Docker) · **security-reviewer ตรวจ** (E4 ไม่มีต้นทุน · `staff:read` · CORS)

**Files:**
- Create: `apps/web/src/lib/api/shiftCash.ts` · `apps/web/src/app/api/v1/pos/shift-cash/route.ts` · `apps/web/src/lib/posAlerts.ts` · `apps/web/test/api.shiftCash.test.ts` · `apps/web/test/posAlerts.test.ts`
- Modify: `apps/web/src/app/api/v1/pos/push/route.ts`

**Interfaces:**
- Consumes: `api_shift_cash` (Task 4) · `pos_alerts_take` (Task 1) · `authenticate` `apiHandler` `corsPreflight` `rpcRawStream` `rpc` `waitUntil` (มีอยู่แล้ว)
- Produces: route `GET/OPTIONS /api/v1/pos/shift-cash` · `shiftCashStream(shopId, apiClientId, after, until)` · `drainPosAlerts(shopId) → Promise<number>` · `drainPosAlertsInBackground(shopId) → void`

- [ ] **Step 1: เทสต์ที่ต้องตก** — `apps/web/test/posAlerts.test.ts`

```ts
// posAlerts.test.ts — ส่งแจ้งเตือน POS จากคิวผ่าน console → Discord (ADR-0044 · ADR-0056 ข้อ 10 · P3 ค4)
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
vi.mock("../src/lib/db", () => ({ rpc: (...a: unknown[]) => rpcMock(...a) }));
vi.mock("../src/lib/platform", () => ({ waitUntil: (p: Promise<unknown>) => { void p; return true; } }));
const { drainPosAlerts } = await import("../src/lib/posAlerts");

describe("drainPosAlerts", () => {
  beforeEach(() => rpcMock.mockReset());
  it("error → console.error · warning → console.warn · ขึ้นต้น POS:", async () => {
    rpcMock.mockResolvedValue([
      { level: "error", kind: "mismatch", text: "กะ 25 ก.ย. ใบปิดกะไม่ตรงกับระบบกลาง — ดูที่ /shifts/x" },
      { level: "warning", kind: "off_catalog", text: "มีบิลนอกแคตตาล็อกใหม่ 2 ใบ — ดูที่เว็บ" },
    ]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await drainPosAlerts("shop-1")).toBe(2);
    expect(rpcMock).toHaveBeenCalledWith("pos_alerts_take", { p_shop_id: "shop-1", p_limit: 5 });
    expect(err).toHaveBeenCalledWith("POS: กะ 25 ก.ย. ใบปิดกะไม่ตรงกับระบบกลาง — ดูที่ /shifts/x");
    expect(warn).toHaveBeenCalledWith("POS: มีบิลนอกแคตตาล็อกใหม่ 2 ใบ — ดูที่เว็บ");
  });
  it("RPC ล้ม → ไม่ throw (แจ้งเตือนค้างในคิวรอรอบถัดไป)", async () => {
    rpcMock.mockRejectedValue(new Error("down"));
    await expect(drainPosAlerts("shop-1").catch(() => -1)).resolves.toBe(-1);
  });
});
```

  `apps/web/test/api.shiftCash.test.ts` (ฐานจริง แบบ `api.orders.test.ts`):

```ts
// api.shiftCash.test.ts — GET /api/v1/pos/shift-cash (E4 · ADR-0056 ข้อ 6 · สเปก POS §4.10 E4) · Supabase บนเครื่อง · ไม่ mock RPC
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { connectLocalSupabase, createTestShop, Db } from "./db/helpers";
import type { TestShop } from "./db/helpers";

const T = 120_000;
const sb = await connectLocalSupabase();
const envShopId = { current: "unused-before-setup" };
vi.mock("../src/lib/platform", () => ({
  getEnv: () => ({ SUPABASE_URL: sb?.url ?? "http://127.0.0.1:54321", SUPABASE_SECRET_KEY: sb?.serviceKey ?? "", DAYO_SHOP_ID: envShopId.current, API_V1_ENABLED: "1" }),
  isApiV1Enabled: () => true,
  getRequestScope: () => null,
  waitUntil: () => false,
}));
const route = await import("../src/app/api/v1/pos/shift-cash/route");

describe.skipIf(!sb)("GET /api/v1/pos/shift-cash", () => {
  let svc: Db;
  let shop: TestShop;
  const mkKey = async (scopes: string[]) => {
    const raw = randomUUID().replace(/-/g, "");
    await svc.insert("api_clients", { shop_id: shop.shopId, name: `e4-${raw.slice(0, 6)}`, key_hash: createHash("sha256").update(raw).digest("hex"), key_prefix: raw.slice(0, 8), scopes });
    return raw;
  };
  const get = (key: string, q: string) => route.GET(new Request(`http://test.local/api/v1/pos/shift-cash?${q}`, { headers: { authorization: `Bearer ${key}` } }));

  beforeAll(async () => {
    svc = Db.service(sb!);
    shop = await createTestShop(svc, "api-e4");
    envShopId.current = shop.shopId;
  }, T);

  it("200 + bills/cash_total · ไม่มีต้นทุน · ไม่มี staff:read = created_by_name null · ไม่มี orders:read = 403 · after/until ผิดรูป = 422", async () => {
    const after = new Date(Date.now() - 60_000).toISOString();
    const until = new Date(Date.now() + 60_000).toISOString();
    const q = `after=${encodeURIComponent(after)}&until=${encodeURIComponent(until)}`;
    const full = await mkKey(["orders:read", "staff:read"]);
    const r = await get(full, q);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; data: { bills: unknown[]; cash_total: number } };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.bills)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/cost|gross|variance|z_report/);
    expect((await get(await mkKey(["orders:write"]), q)).status).toBe(403);
    expect((await get(full, "after=yesterday&until=now")).status).toBe(422);
    expect((await get(full, `after=${encodeURIComponent(until)}&until=${encodeURIComponent(after)}`)).status).toBe(422);
  }, T);
});
```

- [ ] **Step 2: รันให้ตก** — Run: `npx vitest run --root apps/web test/posAlerts.test.ts test/api.shiftCash.test.ts` · Expected: FAIL (module not found)

- [ ] **Step 3: เขียนโค้ด**

  `apps/web/src/lib/api/shiftCash.ts`:
```ts
import "server-only";
import { rpcRawStream } from "@/lib/db";
import { ApiError } from "./errors";

// GET /v1/pos/shift-cash?after=&until= (E4 · orders:read · ADR-0056 ข้อ 6) — บิลเงินสด ok ของบอท/เว็บที่ created_at ∈ (after, until]
// ส่งต่อ body ดิบของ api_shift_cash (RPC ห่อซอง {ok,data} เอง) ไม่ parse (CPU 10 ms — ADR-0036) · ไม่มีต้นทุน
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export async function shiftCashStream(shopId: string, apiClientId: string, after: string | null, until: string | null): Promise<ReadableStream<Uint8Array>> {
  if (!after || !until || !ISO.test(after) || !ISO.test(until)) {
    throw new ApiError("DY422", "invalid: ต้องส่ง after และ until เป็นเวลา ISO-8601 (UTC)");
  }
  return rpcRawStream("api_shift_cash", { p_shop_id: shopId, p_api_client_id: apiClientId, p_after: after, p_until: until });
}
```

  `apps/web/src/app/api/v1/pos/shift-cash/route.ts`:
```ts
import { NextResponse } from "next/server";
import { authenticate } from "@/lib/api/auth";
import { shiftCashStream } from "@/lib/api/shiftCash";
import { apiHandler } from "@/lib/api/response";
import { corsPreflight } from "@/lib/api/cors";

// GET /v1/pos/shift-cash — บิลเงินสดจากบอท/เว็บช่วงนับเงินปิดกะ (scope orders:read — ADR-0056 ข้อ 6)
export async function GET(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const actor = await authenticate(req, "orders:read");
    const url = new URL(req.url);
    const body = await shiftCashStream(actor.shopId, actor.apiClientId, url.searchParams.get("after"), url.searchParams.get("until"));
    return new NextResponse(body, { headers: { "Content-Type": "application/json; charset=utf-8" } });
  }, req);
}

export { corsPreflight as OPTIONS };
```

  `apps/web/src/lib/posAlerts.ts`:
```ts
import "server-only";
import { rpc } from "./db";
import { waitUntil } from "./platform";

// แจ้งเตือนจากแท็บเล็ต POS (ADR-0056 ข้อ 10 · P3 ค4): SQL เขียนลงคิว pos_alerts ในธุรกรรมของเหตุการณ์ → ดึงที่นี่ →
// console.error (🔴) / console.warn (🟡) → Discord ช่องระบบผ่านกลไกเดิม (ADR-0044) · ข้อความสร้างใน SQL ที่เดียว
// ไม่มียอดเงิน ชื่อพนักงาน หรือเหตุผลอิสระ (รอ Q73 — ค่าเริ่มต้น) · ≤ 5 ข้อความต่อคำขอ (งบ ADR-0044 ข้อ 5)
export interface PosAlert {
  level: "error" | "warning";
  kind: string;
  text: string;
}

export async function drainPosAlerts(shopId: string): Promise<number> {
  const alerts = await rpc<PosAlert[]>("pos_alerts_take", { p_shop_id: shopId, p_limit: 5 });
  for (const a of alerts) {
    if (a.level === "error") console.error(`POS: ${a.text}`);
    else console.warn(`POS: ${a.text}`);
  }
  return alerts.length;
}

/** เรียกหลัง RPC ที่อาจสร้างแจ้งเตือน — ไม่หน่วงคำตอบ · ล้ม = ค้างในคิว (cron บอทรายชั่วโมงดึงต่อ — Task 12) */
export function drainPosAlertsInBackground(shopId: string): void {
  waitUntil(drainPosAlerts(shopId).catch(() => 0));
}
```

  `apps/web/src/app/api/v1/pos/push/route.ts`: import `drainPosAlertsInBackground` จาก `@/lib/posAlerts` แล้วเพิ่มบรรทัดหลัง `const body = await posPushStream(…);`:
```ts
    drainPosAlertsInBackground(actor.shopId); // ADR-0056: แจ้งเตือนกะ/บิลนอกแคตตาล็อกที่เกิดในคำขอนี้
```

- [ ] **Step 4: รันให้ผ่าน** — Run: `npx vitest run --root apps/web test/posAlerts.test.ts test/api.shiftCash.test.ts test/api.pos.test.ts test/api.cors.test.ts && npm run typecheck -w @dayo/web` · Expected: PASS · `api.cors.test.ts` ถ้ามีรายการ route ที่ต้องมี `OPTIONS` ให้เพิ่ม `/api/v1/pos/shift-cash`

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add apps/web/src/lib/api/shiftCash.ts apps/web/src/app/api/v1/pos/shift-cash/route.ts apps/web/src/lib/posAlerts.ts apps/web/src/app/api/v1/pos/push/route.ts apps/web/test/posAlerts.test.ts apps/web/test/api.shiftCash.test.ts
git commit -m "feat(web): add shift cash endpoint and pos alert delivery"
```

---

## Task 10: เว็บ — หน้าบิลนอกแคตตาล็อก · การ์ดกำไรกับบิลไม่รู้ต้นทุน (แดชบอร์ด + หน้าดูกำไร)

**agent:** web-developer · sonnet (lane B) · หลัง merge Task 5 + 7 + 9

**Files:**
- Modify: `apps/web/src/lib/sales.ts` (`OrderDetail`) · `apps/web/src/app/(staff)/sales/[order_no]/OrderDetailClient.tsx` · `apps/web/src/app/(staff)/sales/[order_no]/actions.ts` · `apps/web/src/lib/dashboard.ts` (`DashboardCard`) · `apps/web/src/app/(staff)/dashboard/OwnerDashboardClient.tsx` · `apps/web/src/lib/profitView.ts` (ชนิดผล `profit_view_dashboard`) · `apps/web/src/app/profit-view/DashboardClient.tsx`
- Create: `apps/web/src/app/(staff)/sales/[order_no]/offCatalog.ts` · `apps/web/test/offCatalogDisplay.test.ts`

**Interfaces:**
- Consumes: Task 5 (`get_order.off_catalog*` · `dashboard_summary.current.unknown_cost_*`/`fee_known_cost` · `profit_view_dashboard.summary.unknown_cost_*`) · Task 7 (`unknownCostLine` `gpPctText`) · Task 9 (`drainPosAlertsInBackground`)
- Produces: หน้าบิลแสดงป้าย "บิลนอกแคตตาล็อก" + รายการ + ผู้ปิด/เหตุผล + ต้นทุน/กำไร "ไม่ทราบ (บิลนอกแคตตาล็อก)" · การ์ดแดชบอร์ด/หน้าดูกำไรมีบรรทัด "บิลไม่รู้ต้นทุน N ใบ · ยอด ฿X" และค่าธรรมเนียมที่ใช้ในสมการ = `fee_known_cost`

- [ ] **Step 1: เทสต์ที่ต้องตก** — `apps/web/test/offCatalogDisplay.test.ts`

```ts
// offCatalogDisplay.test.ts — ข้อความบิลนอกแคตตาล็อก/บิลไม่รู้ต้นทุนบนเว็บ (ADR-0056 ข้อ 5 · D97)
import { describe, expect, it } from "vitest";
import { costCellText, offCatalogLineText } from "../src/app/(staff)/sales/[order_no]/offCatalog";

describe("บิลนอกแคตตาล็อกบนหน้าบิล", () => {
  it("ต้นทุน/กำไรของบิลนอกแคตตาล็อก = ไม่ทราบ ไม่ใช่ ฿0", () => {
    expect(costCellText({ off_catalog: true, cost_total: null })).toBe("ไม่ทราบ (บิลนอกแคตตาล็อก)");
    expect(costCellText({ off_catalog: false, cost_total: 10.2 })).toBe("฿10.20");
  });
  it("บรรทัดรายการจาก off_catalog_lines", () => {
    expect(offCatalogLineText({ code: "OLD-1", name: "ชาไทยสูตรเก่า", size: "16 oz", sweetness: "100%", qty: 2, unit_price: 40, discount_per_cup: 5, line_total: 70 }))
      .toBe("ชาไทยสูตรเก่า 16 oz 100% ×2 · ฿40.00 − ฿5.00/แก้ว = ฿70.00");
  });
});
```

- [ ] **Step 2: รันให้ตก** — Run: `npx vitest run --root apps/web test/offCatalogDisplay.test.ts` · Expected: FAIL (module not found)

- [ ] **Step 3: เขียนโค้ด**

  Create `apps/web/src/app/(staff)/sales/[order_no]/offCatalog.ts`:
```ts
import { fmtMoney } from "@dayo/shared";
import type { OffCatalogLine } from "@/lib/sales";

// บิลนอกแคตตาล็อก (ADR-0056 ข้อ 5 · D97) — ต้นทุนไม่ทราบ ห้ามแสดงเป็น ฿0 (import แบบ type เท่านั้น — ใช้ใน Client Component ได้)

export function costCellText(o: { off_catalog?: boolean; cost_total: number | null | undefined }): string {
  if (o.off_catalog) return "ไม่ทราบ (บิลนอกแคตตาล็อก)";
  return `฿${fmtMoney(Number(o.cost_total ?? 0))}`;
}

export function offCatalogLineText(l: OffCatalogLine): string {
  const opt = [l.size, l.sweetness].filter(Boolean).join(" ");
  return `${l.name}${opt ? ` ${opt}` : ""} ×${l.qty} · ฿${fmtMoney(Number(l.unit_price))} − ฿${fmtMoney(Number(l.discount_per_cup))}/แก้ว = ฿${fmtMoney(Number(l.line_total))}`;
}
```

  `apps/web/src/lib/sales.ts` — เพิ่มชนิดก่อน `interface OrderDetail` และฟิลด์ใน `OrderDetail`:
```ts
/** รายการของบิลนอกแคตตาล็อก = ชื่อ/ราคาตามที่แท็บเล็ตคิดตอนขาย (ADR-0056 ข้อ 5) */
export interface OffCatalogLine {
  code: string | null; name: string; size: string | null; sweetness: string | null;
  qty: number; unit_price: number; discount_per_cup: number; line_total: number;
}
```
```ts
  /** บิลนอกแคตตาล็อก (ADR-0056) — ไม่มี lines/ต้นทุน · รายการอยู่ใน off_catalog_lines */
  off_catalog: boolean;
  off_catalog_lines: OffCatalogLine[] | null;
  off_catalog_closed: { closed_by_name: string | null; closed_at: string | null; reason: string | null; original_reason: string | null } | null;
```

  `OrderDetailClient.tsx`: (ก) import `{ costCellText, offCatalogLineText }` จาก `./offCatalog` (ข) ต่อจากบล็อก `order.source === "pos" && order.pos_reported_amounts` (บรรทัด 261–266) เพิ่ม:
```tsx
      {order.off_catalog && (
        <div className="mb-2 rounded-lg bg-brick/10 px-3 py-2 text-xs text-brick">
          <p className="font-medium">บิลนอกแคตตาล็อก — ต้นทุนไม่ทราบ ไม่ตัดสต็อก</p>
          {order.off_catalog_closed && (
            <p>
              ปิดโดย {order.off_catalog_closed.closed_by_name ?? "เจ้าของ"}
              {order.off_catalog_closed.closed_at && ` เมื่อ ${dt(order.off_catalog_closed.closed_at)}`}
              {order.off_catalog_closed.reason && ` — ${order.off_catalog_closed.reason}`}
              {order.off_catalog_closed.original_reason && ` (ระบบปฏิเสธเดิม: ${order.off_catalog_closed.original_reason})`}
            </p>
          )}
          <ul className="mt-1 list-disc pl-4 text-charcoal/80">
            {(order.off_catalog_lines ?? []).map((l, i) => (
              <li key={i}>{offCatalogLineText(l)}</li>
            ))}
          </ul>
        </div>
      )}
```
  (ค) แทนบรรทัด 393–394 ด้วย:
```tsx
        {showCost && <Row label="ต้นทุน" value={order.off_catalog ? costCellText(order) : money(order.cost_total)} />}
        {showCost && (order.off_catalog
          ? <Row label="กำไรขั้นต้น" value="ไม่ทราบ (บิลนอกแคตตาล็อก)" />
          : order.gross_profit != null && <Row label="กำไรขั้นต้น" value={money(order.gross_profit)} />)}
```

  `apps/web/src/app/(staff)/sales/[order_no]/actions.ts`: import `drainPosAlertsInBackground` จาก `@/lib/posAlerts` · ใน `updateOrderAction` และ `cancelOrderAction` เก็บผลไว้ในตัวแปร แล้วเรียก `drainPosAlertsInBackground(currentShopId());` ก่อน `return` (การยกเลิกบิลที่รอ `order_void` ทำให้ Z คิดซ้ำ อาจเปลี่ยนเข้า `mismatch` — ADR-0056 ข้อ 7 (6))

  `apps/web/src/lib/dashboard.ts` — ใน `interface DashboardCard` เพิ่ม:
```ts
  /** บิลไม่รู้ต้นทุน (บิลนอกแคตตาล็อก — ADR-0056 · D97): ยอดขาย − unknown_cost_revenue − fee_known_cost − cost = gross_profit */
  unknown_cost_bills: number;
  unknown_cost_revenue: number;
  unknown_cost_fee: number;
  fee_known_cost: number;
```
  และใน `interface TodayMini` เพิ่ม `shift_state: "open" | "closed" | null;`

  `OwnerDashboardClient.tsx`: import `{ gpPctText, unknownCostLine }` จาก `@dayo/shared` · แทนบรรทัด 110 ด้วย
```tsx
        <Card label="GP%" value={gpPctText(cur.gp_pct)} />
```
  และต่อจากการ์ดชุดนี้ (หลังแท็กปิดของกลุ่มการ์ดที่มีบรรทัด 109–110) เพิ่ม:
```tsx
      {unknownCostLine(cur.unknown_cost_bills, cur.unknown_cost_revenue) && (
        <p className="mb-3 text-xs text-charcoal/60">
          {unknownCostLine(cur.unknown_cost_bills, cur.unknown_cost_revenue)} — ไม่รวมในต้นทุน/กำไรขั้นต้น/GP% (ค่าธรรมเนียมของบิลที่รู้ต้นทุน {money(cur.fee_known_cost)})
        </p>
      )}
```

  `apps/web/src/lib/profitView.ts` — ในชนิด `summary` ของผล `profit_view_dashboard` เพิ่ม `unknown_cost_bills: number; unknown_cost_revenue: number; fee_known_cost: number; gp_pct: number | null;` · `apps/web/src/app/profit-view/DashboardClient.tsx` บรรทัด 94 แทนด้วย:
```tsx
              {data.summary.fee_known_cost > 0 && <p className="text-[11px] text-charcoal/50">หักค่าธรรมเนียม {money(data.summary.fee_known_cost)}</p>}
              {data.summary.unknown_cost_bills > 0 && (
                <p className="text-[11px] text-brick">บิลไม่รู้ต้นทุน {data.summary.unknown_cost_bills} ใบ · ยอด {money(data.summary.unknown_cost_revenue)} (ไม่รวมในกำไร)</p>
              )}
```

- [ ] **Step 4: รันให้ผ่าน** — Run: `npx vitest run --root apps/web && npm run typecheck -w @dayo/web` · Expected: PASS (เทสต์เดิมที่สร้าง `OrderDetail`/`DashboardCard` จำลองให้เติมฟิลด์ใหม่ด้วยค่า `false`/`0`/`null`)

- [ ] **Step 5: ทดสอบด้วยมือ** (⛔ เจ้าของตั้ง `.dev.vars` + คีย์ทดสอบแบบแผน 06 Task 16 Step 3) — `npm run dev:web` → curl `POST /api/v1/pos/push` ร้าน seed: `shift_open` → `order` ที่ช่องทางไม่มี (ได้ `UNKNOWN_CODE`) → `order_off_catalog` ของบิลเดียวกัน · เปิด `/sales/<order_no>` เห็นป้าย "บิลนอกแคตตาล็อก" และต้นทุน/กำไร "ไม่ทราบ" · `/dashboard` เห็นบรรทัด "บิลไม่รู้ต้นทุน 1 ใบ · ยอด ฿…"

- [ ] **Step 6: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add apps/web/src/lib/sales.ts apps/web/src/lib/dashboard.ts apps/web/src/lib/profitView.ts "apps/web/src/app/(staff)/sales/[order_no]/offCatalog.ts" "apps/web/src/app/(staff)/sales/[order_no]/OrderDetailClient.tsx" "apps/web/src/app/(staff)/sales/[order_no]/actions.ts" "apps/web/src/app/(staff)/dashboard/OwnerDashboardClient.tsx" apps/web/src/app/profit-view/DashboardClient.tsx apps/web/test/offCatalogDisplay.test.ts
git commit -m "feat(web): show off-catalog bills and unknown-cost totals"
```

---

## Task 11: เว็บ — บรรทัดกะบนแดชบอร์ด owner · หน้ารายละเอียดกะ `/shifts/[shift_id]` · สถานะกะใน "ยอดวันนี้" · Export กะ

**agent:** web-developer · sonnet (lane B) · หลัง merge Task 6 + 7 + 10 · **security-reviewer ตรวจ** (owner เท่านั้น ทั้งหน้าและ RPC — S6)

**Files:**
- Create: `apps/web/src/lib/shifts.ts` · `apps/web/src/app/(staff)/dashboard/ShiftLines.tsx` · `apps/web/src/app/(staff)/shifts/[shift_id]/page.tsx` · `apps/web/src/app/(staff)/shifts/[shift_id]/ShiftDetailClient.tsx` · `apps/web/test/shifts.test.ts`
- Modify: `apps/web/src/app/(staff)/dashboard/page.tsx` · `apps/web/src/app/(staff)/dashboard/OwnerDashboardClient.tsx` · `apps/web/src/app/(staff)/dashboard/StaffTodayClient.tsx`
- ไม่แก้: หน้า Export — เว็บตอนนี้เรียก `export_rows` เฉพาะกลุ่ม `imports`/`template` (`settings/import-export/actions.ts:102,128`) · ข้อมูลกะออกทางไฟล์สำรอง (owner — Task 8) และกลุ่ม `shifts` ของ `export_rows` (owner — Task 6) พร้อมให้หน้า Export ใช้เมื่อมี

**Interfaces:**
- Consumes: `dashboard_shifts` · `get_shift_detail` (Task 6) · `today_mini.shift_state` (Task 5) · `ShiftLine` `shiftLineText` `shiftBadges` `unknownCostLine` `waitingReasonText` `waitingAgeHours` `recomputeCheckText` `recomputeNoteText` `varianceLabel` (Task 7) · `requireRole` (มีอยู่แล้ว)
- Produces: `getDashboardShifts(shopId, staffId, range)` · `getShiftDetail(shopId, staffId, shiftId)` · หน้า `/shifts/[shift_id]`

- [ ] **Step 1: เทสต์ที่ต้องตก** — `apps/web/test/shifts.test.ts`

```ts
// shifts.test.ts — หน้า/RPC กะบนเว็บ (ADR-0056 ข้อ 11 · D99 · S6) · Supabase บนเครื่อง
import { beforeAll, describe, expect, it, vi } from "vitest";
import { connectLocalSupabase, createTestShop, Db } from "./db/helpers";
import type { TestShop } from "./db/helpers";

const T = 120_000;
const sb = await connectLocalSupabase();
vi.mock("../src/lib/platform", () => ({
  getEnv: () => ({ SUPABASE_URL: sb?.url ?? "http://127.0.0.1:54321", SUPABASE_SECRET_KEY: sb?.serviceKey ?? "", DAYO_SHOP_ID: "x" }),
  getRequestScope: () => null,
  waitUntil: () => false,
}));
const { getDashboardShifts, getShiftDetail } = await import("../src/lib/shifts");

describe.skipIf(!sb)("lib/shifts", () => {
  let svc: Db;
  let shop: TestShop;
  beforeAll(async () => {
    svc = Db.service(sb!);
    shop = await createTestShop(svc, "web-shifts");
  }, T);

  it("owner อ่านได้ · manager/staff = DY403 (RPC ตรวจเอง แม้หน้าเว็บจะกันด้วย requireRole แล้ว)", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
    const d = await getDashboardShifts(shop.shopId, shop.ownerId, { from: today, to: today });
    expect(d).toMatchObject({ shifts: [], off_catalog_bills: 0 });
    await expect(getDashboardShifts(shop.shopId, shop.managerId, { from: today, to: today })).rejects.toThrow(/DY403|สิทธิ์/);
    await expect(getShiftDetail(shop.shopId, shop.staffId, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/DY403|สิทธิ์/);
  }, T);
});
```

- [ ] **Step 2: รันให้ตก** — Run: `npx vitest run --root apps/web test/shifts.test.ts` · Expected: FAIL (module not found)

- [ ] **Step 3: เขียนโค้ด**

  `apps/web/src/lib/shifts.ts`:
```ts
import "server-only";
import type { ShiftLine, WaitingItem } from "@dayo/shared";
import type { DashboardRange } from "./dashboard";
import { rpc } from "./db";

// กะบนเว็บ (ADR-0056 ข้อ 11 · D99) — owner เท่านั้น อ่านอย่างเดียว · RPC ตรวจ owner เอง (DY403 — S6) · เงินทุกบาทมาจาก RPC
export interface DashboardShifts {
  from: string;
  to: string;
  block3_live_from: string | null;
  off_catalog_bills: number;
  shifts: ShiftLine[];
  extras: {
    bot_outside_z: Array<{ order_no: string; source: string; created_at: string; total: number }>;
    changed_after_count: Array<{ order_no: string; shift_id: string; z_version: number; current_version: number; current_status: string; z_total: number; current_total: number }>;
    changed_from_cash_before_count: Array<{ order_no: string; source: string; current_status: string }>;
    bills_without_shift: Array<{ order_no: string; receipt_no: string; pos_shift_id: string }>;
  };
}

export interface ShiftDetail {
  shift: { id: string; business_date: string; device_name: string | null; opened_at: string; opened_by_name: string | null; opening_float: number;
    quick_open: boolean; status: string; counted_at: string | null; closed_at: string | null; closed_by_name: string | null; data_conflict: boolean };
  count: { lines: Array<{ denomination: number; count: number }>; counted: number; counted_at: string; counted_by_name: string | null } | null;
  movements: Array<{ id: string; kind: "PAID_IN" | "PAID_OUT" | "DROP" | "VOID_REFUND"; amount: number; reason: string | null; created_at: string;
    created_by_name: string | null; pos_order_id: string | null; receipt_no: string | null }>;
  z: null | {
    z_no: number; hash: string; prev_hash: string | null; chain_warning: boolean; chain_break: boolean;
    expected: number; counted: number; variance: number; variance_reason: string | null; variance_alert: number; variance_alert_prev: number | null;
    cash: Record<string, number>; computed: Record<string, number> | null; bot_window: { after: string; until: string };
    bot_bills: Array<{ order_no: string; version: number; total: number; current_version: number | null; current_total: number | null; current_status: string | null }>;
    pos_bills: Array<{ pos_order_id: string; receipt_no: string; payment: string; total: number; sold_at: string; voided_at: string | null; order_no: string | null; in_db: boolean }>;
    recompute_status: "waiting_bills" | "matched" | "mismatch";
    recompute_detail: { diffs?: Array<{ check: string; [k: string]: unknown }>; notes?: Array<{ note: string; [k: string]: unknown }> };
    recompute_notes: Array<{ note: string; [k: string]: unknown }>;
    waiting_since: string | null;
    waiting: WaitingItem[];
  };
  owner_edits: Array<{ order_no: string; receipt_no: string | null; reported_total: number; reported_payment: string | null; current_total: number;
    current_payment: string | null; current_status: string; edited_by_name: string | null; reason: string | null; edited_at: string | null; cash_diff: number }>;
  owner_edits_cash_diff: number;
}

export function getDashboardShifts(shopId: string, staffId: string, range: DashboardRange): Promise<DashboardShifts> {
  return rpc<DashboardShifts>("dashboard_shifts", { p_shop_id: shopId, p_staff_id: staffId, p_from: range.from, p_to: range.to });
}

export function getShiftDetail(shopId: string, staffId: string, shiftId: string): Promise<ShiftDetail> {
  return rpc<ShiftDetail>("get_shift_detail", { p_shop_id: shopId, p_staff_id: staffId, p_shift_id: shiftId });
}
```

  `apps/web/src/app/(staff)/dashboard/ShiftLines.tsx`:
```tsx
import { shiftBadges, shiftLineText } from "@dayo/shared";
import type { DashboardShifts } from "@/lib/shifts";

// แดชบอร์ด owner: 1 บรรทัดต่อกะ + ป้าย (ADR-0056 ข้อ 11 · Q20 · D99) · กดเข้าหน้ารายละเอียดกะ
export function ShiftLines({ data, now }: { data: DashboardShifts; now: number }) {
  const ex = data.extras;
  return (
    <section className="mb-4 rounded-xl border border-forest/10 bg-white p-3">
      <h2 className="mb-2 font-semibold text-forest">🧾 กะ (แท็บเล็ต POS)</h2>
      {data.off_catalog_bills > 0 && <p className="mb-2 text-xs text-brick">บิลนอกแคตตาล็อก {data.off_catalog_bills} ใบในช่วงนี้</p>}
      {data.shifts.length === 0 && <p className="text-sm text-charcoal/50">ยังไม่มีกะในช่วงนี้</p>}
      <ul className="divide-y divide-forest/5">
        {data.shifts.map((s) => (
          <li key={s.shift_id} className="py-2">
            <a href={`/shifts/${s.shift_id}`} className="block text-sm text-charcoal">
              {shiftLineText(s)}
              {shiftBadges(s, now).map((b) => (
                <span key={b} className="ml-1 rounded-full bg-brick/10 px-2 py-0.5 text-xs text-brick">{b}</span>
              ))}
            </a>
          </li>
        ))}
      </ul>
      {(ex.bot_outside_z.length > 0 || ex.changed_after_count.length > 0 || ex.changed_from_cash_before_count.length > 0 || ex.bills_without_shift.length > 0) && (
        <details className="mt-2 text-xs text-charcoal/70">
          <summary>รายการเสริม</summary>
          {ex.bot_outside_z.length > 0 && <p>บิลบอทนอกใบปิดกะ: {ex.bot_outside_z.map((b) => b.order_no).join(", ")}</p>}
          {ex.changed_after_count.length > 0 && <p>เปลี่ยนหลังนับ: {ex.changed_after_count.map((b) => b.order_no).join(", ")}</p>}
          {ex.changed_from_cash_before_count.length > 0 && <p>เปลี่ยนจากเงินสดก่อนนับ: {ex.changed_from_cash_before_count.map((b) => b.order_no).join(", ")}</p>}
          {ex.bills_without_shift.length > 0 && <p>บิลที่ยังไม่มีกะในระบบกลาง: {ex.bills_without_shift.map((b) => b.receipt_no).join(", ")}</p>}
        </details>
      )}
    </section>
  );
}
```

  `apps/web/src/app/(staff)/dashboard/page.tsx`: import `getDashboardShifts` จาก `@/lib/shifts` · เพิ่ม `getDashboardShifts(shopId, staff.id, range)` ท้าย `Promise.all` (→ `shifts`) · ส่ง `shifts={shifts}` ให้ `OwnerDashboardClient`
  `OwnerDashboardClient.tsx`: prop ใหม่ `shifts: DashboardShifts` · วาง `<ShiftLines data={shifts} now={Date.now()} />` ต่อจากส่วนธงบิลน่าจะซ้ำ
  `StaffTodayClient.tsx`: แสดง `data.shift_state === "open" ? "🟢 กะเปิดอยู่" : data.shift_state === "closed" ? "⚪ กะปิดแล้ว" : null` ใต้หัวข้อ (ไม่มียอดขาด/เกิน — D99)

  `apps/web/src/app/(staff)/shifts/[shift_id]/page.tsx`:
```tsx
import { currentShopId, requireRole } from "@/lib/auth";
import { getShiftDetail } from "@/lib/shifts";
import { ShiftDetailClient } from "./ShiftDetailClient";

// หน้ารายละเอียดกะ (ADR-0056 ข้อ 11 · D99 · P3 ค5) — owner เท่านั้น อ่านอย่างเดียว · RPC ตรวจ owner เองอีกชั้น (S6)
export default async function ShiftPage({ params }: { params: Promise<{ shift_id: string }> }) {
  const staff = await requireRole("owner");
  const { shift_id } = await params;
  const detail = await getShiftDetail(currentShopId(), staff.id, shift_id);
  return (
    <main className="mx-auto max-w-2xl px-3 py-3 pb-20">
      <a href="/dashboard" className="mb-2 inline-block text-sm text-charcoal/60">← แดชบอร์ด</a>
      <ShiftDetailClient detail={detail} now={Date.now()} />
    </main>
  );
}
```

  `apps/web/src/app/(staff)/shifts/[shift_id]/ShiftDetailClient.tsx`:
```tsx
import { fmtMoney, recomputeCheckText, recomputeNoteText, thaiShortDate, varianceLabel, waitingAgeHours, waitingReasonText } from "@dayo/shared";
import type { ShiftDetail } from "@/lib/shifts";

const KIND: Record<string, string> = { PAID_IN: "เงินเข้า", PAID_OUT: "เงินออก", DROP: "นำเงินออก (ฝาก)", VOID_REFUND: "คืนเงินบิลยกเลิก" };
const COMP: Array<[string, string, 1 | -1]> = [
  ["opening_float", "เงินทอนตั้งต้น", 1], ["pos_cash_sales", "ขายเงินสด (แท็บเล็ต)", 1], ["void_refunds", "คืนเงินบิลยกเลิก", -1],
  ["paid_in", "เงินเข้า", 1], ["paid_out", "เงินออก", -1], ["drops", "นำเงินออก", -1], ["drawer_expenses", "ค่าใช้จ่ายจากลิ้นชัก", -1], ["bot_cash", "เงินสดบิลบอท/เว็บ", 1],
];
const STATUS: Record<string, string> = { matched: "✅ ตรงกับระบบกลาง", mismatch: "⚠ ไม่ตรงกับระบบกลาง", waiting_bills: "⏳ รอบิลมาครบ" };
const bkk = (iso: string) => new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" });

// อ่านอย่างเดียว — ไม่มีปุ่มแก้ใด ๆ (กะมีเฉพาะที่แท็บเล็ต — D92)
export function ShiftDetailClient({ detail, now }: { detail: ShiftDetail; now: number }) {
  const { shift, count, movements, z } = detail;
  const hours = waitingAgeHours(z?.waiting_since ?? null, now);
  return (
    <div className="space-y-3 text-sm">
      <h1 className="text-xl font-semibold text-forest">กะ {thaiShortDate(shift.business_date)} · {shift.device_name ?? "แท็บเล็ต"}</h1>
      <p className="text-charcoal/70">
        เปิด {bkk(shift.opened_at)} {shift.opened_by_name ?? ""}{shift.quick_open ? " (เปิดด่วน)" : ""} · เงินทอนตั้งต้น ฿{fmtMoney(shift.opening_float)}
        {shift.counted_at && ` · นับเงิน ${bkk(shift.counted_at)}`}
        {shift.closed_at && ` · ปิดกะ ${bkk(shift.closed_at)} ${shift.closed_by_name ?? ""}`}
      </p>
      {shift.data_conflict && <p className="rounded bg-brick/10 px-2 py-1 text-brick">⚠ ข้อมูลกะชนกัน — ตรวจกุญแจเครื่อง</p>}

      {count && (
        <section className="rounded-xl border border-forest/10 bg-white p-3">
          <h2 className="mb-1 font-medium text-forest">นับเงิน ฿{fmtMoney(count.counted)}</h2>
          <ul className="grid grid-cols-3 gap-1 text-xs">
            {count.lines.map((l) => <li key={l.denomination}>{l.denomination} บาท × {l.count}</li>)}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-forest/10 bg-white p-3">
        <h2 className="mb-1 font-medium text-forest">เงินเข้า-ออกลิ้นชัก</h2>
        {movements.length === 0 ? <p className="text-charcoal/50">ไม่มี</p> : (
          <ul>{movements.map((m) => (
            <li key={m.id}>{KIND[m.kind]} ฿{fmtMoney(m.amount)}{m.receipt_no ? ` · ใบเสร็จ ${m.receipt_no}` : ""}{m.reason ? ` — ${m.reason}` : ""} · {m.created_by_name ?? ""}</li>
          ))}</ul>
        )}
      </section>

      {z ? (
        <section className="rounded-xl border border-forest/10 bg-white p-3">
          <h2 className="mb-1 font-medium text-forest">ใบปิดกะ Z #{z.z_no} · {STATUS[z.recompute_status]}</h2>
          <table className="w-full text-xs">
            <tbody>
              {COMP.map(([k, label, sign]) => (
                <tr key={k}><td>{label}</td><td className="text-right">{sign < 0 ? "−" : ""}฿{fmtMoney(z.cash[k] ?? 0)}</td>
                  <td className="text-right text-charcoal/50">{z.computed && z.computed[k] !== z.cash[k] ? `ระบบกลาง ฿${fmtMoney(z.computed[k] ?? 0)}` : ""}</td></tr>
              ))}
              <tr className="font-medium"><td>เงินที่ควรมี</td><td className="text-right">฿{fmtMoney(z.expected)}</td><td /></tr>
              <tr><td>นับได้</td><td className="text-right">฿{fmtMoney(z.counted)}</td><td /></tr>
              <tr className="font-medium"><td>ส่วนต่าง</td><td className="text-right">{varianceLabel(z.variance)}</td><td /></tr>
            </tbody>
          </table>
          {z.variance_reason && <p className="mt-1">เหตุผล: {z.variance_reason}</p>}
          <p className="mt-1 text-xs text-charcoal/60">
            เกณฑ์ขอเหตุผลที่ใช้ ฿{fmtMoney(z.variance_alert)}
            {z.variance_alert_prev !== null && Number(z.variance_alert_prev) !== Number(z.variance_alert) && (
              <span className="ml-1 rounded-full bg-brick/10 px-2 text-brick">ต่างจากใบก่อน (฿{fmtMoney(z.variance_alert_prev)})</span>
            )}
          </p>
          {z.chain_break && <p className="text-brick">⚠ โซ่ Z ขาด</p>}
          {z.waiting.length > 0 && (
            <ul className="mt-1 text-xs text-charcoal/70">{z.waiting.map((w) => <li key={`${w.kind}:${w.id}`}>{waitingReasonText(w, hours)}</li>)}</ul>
          )}
          {(z.recompute_detail.diffs ?? []).map((d, i) => <p key={i} className="text-xs text-brick">• {recomputeCheckText(d.check)}</p>)}
          {[...(z.recompute_detail.notes ?? []), ...z.recompute_notes].map((n, i) => <p key={`n${i}`} className="text-xs text-charcoal/60">ข้อสังเกต: {recomputeNoteText(n.note)}</p>)}
          <h3 className="mt-2 font-medium">บิลบอท/เว็บที่นับ ({z.bot_bills.length})</h3>
          <ul className="text-xs">{z.bot_bills.map((b) => (
            <li key={b.order_no}>{b.order_no} ฿{fmtMoney(b.total)}{b.current_version !== null && b.current_version !== b.version ? ` · เปลี่ยนหลังนับ (${b.current_status} ฿${fmtMoney(b.current_total ?? 0)})` : ""}</li>
          ))}</ul>
          <h3 className="mt-2 font-medium">บิลแท็บเล็ตของกะ ({z.pos_bills.length})</h3>
          <ul className="text-xs">{z.pos_bills.map((b) => (
            <li key={b.pos_order_id}>{b.receipt_no} · {b.payment} ฿{fmtMoney(b.total)}{b.voided_at ? " · ยกเลิก" : ""}{b.in_db ? ` · ${b.order_no}` : " · ยังไม่ถึงระบบกลาง"}</li>
          ))}</ul>
        </section>
      ) : (
        <p className="text-charcoal/60">{shift.counted_at ? "นับเงินแล้ว — รอใบปิดกะจากแท็บเล็ต (ต้องออนไลน์)" : "กะยังเปิดอยู่"}</p>
      )}

      {detail.owner_edits.length > 0 && (
        <section className="rounded-xl border border-brick/20 bg-white p-3">
          <h2 className="mb-1 font-medium text-brick">เจ้าของแก้บิลหลังขาย (ไม่อยู่ในใบปิดกะ)</h2>
          <ul className="text-xs">{detail.owner_edits.map((e) => (
            <li key={e.order_no}>
              ใบเสร็จ {e.receipt_no} · เก็บจริง ฿{fmtMoney(e.reported_total)} {e.reported_payment ?? ""} → ปัจจุบัน {e.current_status === "cancelled" ? "ยกเลิก" : `฿${fmtMoney(e.current_total)} ${e.current_payment ?? ""}`}
              {e.edited_by_name ? ` (แก้โดย ${e.edited_by_name}` : " ("}{e.reason ? ` — ${e.reason})` : ")"}
            </li>
          ))}</ul>
          <p className="mt-1 text-xs">ส่วนต่างเงินสดรวม ฿{fmtMoney(detail.owner_edits_cash_diff)}</p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: รันให้ผ่าน** — Run: `npx vitest run --root apps/web test/shifts.test.ts && npx vitest run --root apps/web && npm run typecheck -w @dayo/web && npm run build -w @dayo/web` · Expected: PASS · build ผ่าน

- [ ] **Step 5: ทดสอบด้วยมือ** — `npm run dev:web` (หลังส่งกะทดสอบด้วย curl ตาม Task 10 Step 5 + `shift_open`/`cash_count`/`shift_close`) → `/dashboard` (owner) เห็นบรรทัด "กะ … · เปิด … · ปิด … · ขาด/เกิน/ตรง" + ป้าย · กดเข้า `/shifts/<id>` เห็นธนบัตร เงินเข้า-ออก องค์ประกอบ บิล · ล็อกอิน manager → `/shifts/<id>` ถูกปฏิเสธ · `/dashboard` ของ manager เห็นแค่ "กะเปิดอยู่/ปิดแล้ว"

- [ ] **Step 6: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add apps/web/src/lib/shifts.ts "apps/web/src/app/(staff)/dashboard/ShiftLines.tsx" "apps/web/src/app/(staff)/dashboard/page.tsx" "apps/web/src/app/(staff)/dashboard/OwnerDashboardClient.tsx" "apps/web/src/app/(staff)/dashboard/StaffTodayClient.tsx" "apps/web/src/app/(staff)/shifts/[shift_id]/page.tsx" "apps/web/src/app/(staff)/shifts/[shift_id]/ShiftDetailClient.tsx" apps/web/test/shifts.test.ts
git commit -m "feat(web): add owner shift lines and read-only shift detail page"
```

---

## Task 12: บอท — cron แจ้งเตือน POS · รายงานเช้ามีบิลไม่รู้ต้นทุน

**agent:** bot-developer · sonnet (lane D) · หลัง merge Task 6 + 7

**Files:**
- Modify: `apps/line-bot/src/alerts.ts` (`hourlyRun` บรรทัด 85–90)
- Create: `apps/line-bot/src/posAlerts.ts` · `apps/line-bot/test/posAlertsCron.test.ts`
- ไม่แก้: รายงานเช้า — `alerts.ts:101-109` ส่งผล `daily_digest_once` ทั้งก้อนเข้า `buildDailyDigestMessage` อยู่แล้ว (`summary` มี `unknown_cost_*` จาก Task 5 · บรรทัดใหม่มาจาก Task 7)

**Interfaces:**
- Consumes: `pos_alerts_scan(uuid) → integer` · `pos_alerts_take(uuid, integer) → jsonb` (Task 1/6) · `DailyDigest.summary.unknown_cost_*` (Task 7 — ผล `daily_digest` มีฟิลด์นี้แล้วจาก Task 5)
- Produces: `runPosAlertsCron(db, shopId) → Promise<number>` (จำนวนข้อความที่ส่ง)

- [ ] **Step 1: เทสต์ที่ต้องตก** — `apps/line-bot/test/posAlertsCron.test.ts`

```ts
// posAlertsCron.test.ts — cron รายชั่วโมง: แจ้งใบปิดกะรอนาน (รอ Q74 — ค่าเริ่มต้น) + ส่งแจ้งเตือน POS ที่ค้าง (ADR-0056 ข้อ 10 · ADR-0044)
import { describe, expect, it, vi } from "vitest";
import { runPosAlertsCron } from "../src/posAlerts";

describe("runPosAlertsCron", () => {
  it("scan ก่อน แล้ว take ≤ 5 · error → console.error · warning → console.warn", async () => {
    const calls: string[] = [];
    const rpc = vi.fn(async (fn: string) => {
      calls.push(fn);
      return fn === "pos_alerts_scan" ? 1 : [{ level: "warning", kind: "waiting", text: "กะ 25 ก.ย. ใบปิดกะรอบิลเกิน 48 ชม. — ดูที่ /shifts/x" }];
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await runPosAlertsCron({ rpc }, "shop-1")).toBe(1);
    expect(calls).toEqual(["pos_alerts_scan", "pos_alerts_take"]);
    expect(rpc).toHaveBeenLastCalledWith("pos_alerts_take", { p_shop_id: "shop-1", p_limit: 5 });
    expect(warn).toHaveBeenCalledWith("POS: กะ 25 ก.ย. ใบปิดกะรอบิลเกิน 48 ชม. — ดูที่ /shifts/x");
  });
  it("RPC ล้ม → ไม่ทำให้ cron ล้ม (คืน 0)", async () => {
    expect(await runPosAlertsCron({ rpc: vi.fn(async () => { throw new Error("down"); }) }, "shop-1")).toBe(0);
  });
});
```

- [ ] **Step 2: รันให้ตก** — Run: `npx vitest run --root apps/line-bot test/posAlertsCron.test.ts` · Expected: FAIL (module not found)

- [ ] **Step 3: เขียนโค้ด** — `apps/line-bot/src/posAlerts.ts`

```ts
// แจ้งเตือนจากแท็บเล็ต POS (ADR-0056 ข้อ 10) — cron รายชั่วโมงของบอท:
// (1) pos_alerts_scan: ใบปิดกะรอบิลนานเกินค่าตั้ง → เข้าคิว (รอ Q74 — ค่าเริ่มต้น 48 ชม. · ปิดได้ที่หน้าตั้งค่าระบบ) + ล้างคิวเก่า
// (2) pos_alerts_take: ส่งที่ค้าง (เว็บส่งไม่ทัน) ผ่าน console → Discord ช่องระบบ (ADR-0044) · ข้อความไม่มียอดเงิน (รอ Q73)
export interface RpcLike {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
}

export async function runPosAlertsCron(db: RpcLike, shopId: string): Promise<number> {
  try {
    await db.rpc("pos_alerts_scan", { p_shop_id: shopId });
    const alerts = (await db.rpc("pos_alerts_take", { p_shop_id: shopId, p_limit: 5 })) as Array<{ level: string; text: string }>;
    for (const a of alerts) {
      if (a.level === "error") console.error(`POS: ${a.text}`);
      else console.warn(`POS: ${a.text}`);
    }
    return alerts.length;
  } catch {
    return 0;
  }
}
```

  `apps/line-bot/src/alerts.ts` — import `{ runPosAlertsCron }` จาก `./posAlerts` · ใน `hourlyRun` แทรกระหว่างบล็อก heartbeat (บรรทัด 86–88) กับ `const shopUrl = …` (บรรทัด 89):
```ts
  // ADR-0056 ข้อ 10: แจ้งใบปิดกะรอนาน + ส่งแจ้งเตือน POS ที่ค้าง — ทุกชั่วโมง (2 RPC · ช่องระบบ ไม่ขึ้นกับช่องร้าน)
  await runPosAlertsCron({ rpc: (fn, args) => rpc(env, fn, args) }, env.DAYO_SHOP_ID);
```
  (อยู่ในขอบเขตแจ้งเตือนของคำขอ cron เดียวกับ heartbeat — ADR-0044 ข้อ 3)

- [ ] **Step 4: รันให้ผ่าน** — Run: `npx vitest run --root apps/line-bot && npm run typecheck -w @dayo/line-bot` · Expected: PASS

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add apps/line-bot/src/posAlerts.ts apps/line-bot/src/alerts.ts apps/line-bot/test/posAlertsCron.test.ts
git commit -m "feat(bot): send pending pos alerts and waiting z report alerts hourly"
```

---

## Task 13: เอกสารของ dayo

**agent:** docs-writer · sonnet · low (lane D) · ส่วน API/DATA-CONTRACT หลัง merge Task 4 · ส่วนเว็บ/OPERATIONS หลัง merge Task 11 · GLOSSARY ตามร่างของ architect ใน Task 0 Step 4

**Files (Modify):** `docs/API.md` · `apps/web/openapi.yaml` · `docs/DATA-CONTRACT.md` · `docs/GLOSSARY.md` · `docs/OPERATIONS.md` · `docs/PLAN.md`

- [ ] **Step 1: `docs/API.md`** — หัวข้อ "ก้อน 3 (ADR-0056)": scope `shift:write` (ตรวจต่อแถว · 403 ทั้งคำขอยังเป็น `orders:write`) · ตารางชนิด 5 ชนิด (key · ช่อง id · scope · แถวแม่) · ฟิลด์ต่อชนิด (ตาม `dayo_pos_supported()`) · กติกา `z_report` (คีย์ครบ · เพดาน 2000/500/500 · `drawer_expenses` = 0) · คำนำหน้า `detail` ทั้ง 10 ตัว (รวม `data_conflict:` ของ `INVALID` ที่เป็นข้อมูลกะชนกัน) + `data` ของ `exists:`/`off_catalog_exists:` · `data` ของผล `accepted`/`duplicate` ต่อชนิด · ลำดับตรวจแถวเต็ม (0052 + ขั้น `shift:write` + ช่อง id ตามชนิด) · ตารางแผนที่ error ที่เปลี่ยน (DY404 ของแถวกะ = `PARENT_PENDING` · 23505 ตามชนิด · `receipt_taken:`) · E4 (พารามิเตอร์ · ช่วง `(after, until]` · `created_by_name` · 422 · > 500 ใบ) · E1 `client.last_z_no`/`last_z_hash`/`last_z_until` · E3 `off_catalog`

- [ ] **Step 2: `apps/web/openapi.yaml`** — path `/pos/shift-cash` (GET, OPTIONS · response 200/401/403/404/422/429/500 พร้อม header CORS) · schema `ShiftCashResponse` · เพิ่ม `ShiftOpenRow` `CashMovementRow` `CashCountRow` `ShiftCloseRow` `ZReport` `OrderOffCatalogRow` ใน `PushRow` · `RowVerdict.detail` อธิบายคำนำหน้า · `PosCatalogResponse.client.last_z_no/last_z_hash/last_z_until` · `Order.off_catalog`

- [ ] **Step 3: `docs/DATA-CONTRACT.md`** — §2.2 scope `shift:write` · §2.4 ตาราง `shifts` `cash_movements` `cash_counts` `z_reports` `pos_push_rejections` `pos_alerts` (คอลัมน์ · check · trigger · อยู่/ไม่อยู่ในไฟล์สำรอง) · `orders.off_catalog` `off_catalog_lines` `cost_total` null ได้ · `pos_reported_amounts.payment` · unique `(shop_id, pos_order_id)` · `shop_settings.block3_live_from` `off_catalog_max_total` `shift_waiting_alert_hours` · §3 RPC ใหม่/ที่เปลี่ยนของ Task 1–6 · GUC `dayo.shift_writer` (ผู้เขียนคอลัมน์ที่ถูกคุม) · `audit_log.action` ใหม่ `order_off_catalog` `shift_data_conflict` · รายงาน: นิยาม `unknown_cost_*` `fee_known_cost` · สมการ `ยอดขาย − ยอดบิลไม่รู้ต้นทุน − ค่าธรรมเนียม (บิลที่รู้ต้นทุน) − ต้นทุน = กำไรขั้นต้น` · GP% ตัวหารใหม่ · §8 endpoint E4

- [ ] **Step 4: `docs/GLOSSARY.md`** — ศัพท์จาก Task 0 Step 4 ครบทุกคำ

- [ ] **Step 5: `docs/OPERATIONS.md`** — "ใบปิดกะไม่ตรง (🔴) ทำอะไร" (เปิด `/shifts/<id>` อ่านรายการต่าง) · "ข้อมูลกะชนกัน (🔴) = อาจมีคนใช้กุญแจเครื่อง → เพิกถอนคีย์ สร้างคีย์ใหม่" · "ใบปิดกะรอบิลนาน" (ดูรายการที่รอ · ถ้าเป็นเงินคืนของบิลที่แท็บเล็ตยกเลิกไม่ผ่าน → ยกเลิกบิลบนเว็บพร้อมเหตุผล) · "บิลนอกแคตตาล็อกใหม่ (🟡)" (ตรวจที่ `/sales/<order_no>` · เพดาน/วันเริ่มใช้กะที่ `/settings/system`) · "กุญแจเครื่องไม่มีสิทธิ์ shift:write (🟡)" · ขั้นตรวจคู่ `pos_order_id` ซ้ำก่อน `db:push` 0055 (Task 15 ขั้น 1)

- [ ] **Step 6: `docs/PLAN.md`** — แถวเฟส "เชื่อม POS ก้อน 3" อ้างแผนนี้ + ADR-0056

- [ ] **Step 7: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add docs/API.md apps/web/openapi.yaml docs/DATA-CONTRACT.md docs/GLOSSARY.md docs/OPERATIONS.md docs/PLAN.md
git commit -m "docs: document pos shifts, z reports and off-catalog bills"
```

---

## Task 14: รวมงาน · ตรวจครบ · รีวิวทั้งสาย

**agent:** หัวหน้าทีม (merge) → test-runner · haiku (รันและสรุป) → code-reviewer · sonnet + security-reviewer · opus (ขนานกันได้ — อ่านอย่างเดียว) → **ตรวจทั้งสาย (Opus)** ก่อน merge เข้า main

- [ ] **Step 1: merge ตามลำดับ** `block3/db` → `block3/shared` → `block3/web` → `block3/bot` → `block3/docs` (ขัดกันที่ `database.types.ts` ใช้ของ lane A แล้วรัน `npm run db:types` ใหม่)

- [ ] **Step 2: ตรวจทั้ง repo**

Run: `npm install && npm run db:reset && npm run db:types && npm run ci && npx vitest run --root packages/shared test/db && npx vitest run --root apps/web`
Expected: `ci` ผ่าน (typecheck + test + build ทุก workspace) · เทสต์ฐานข้อมูลผ่านทุกไฟล์ (`block3_schema` `pos_push_shift` `pos_off_catalog` `pos_z_recompute` `block3_reports` `block3_shift_reads` + ของเดิมทั้งหมด) · `git diff --exit-code packages/shared/src/database.types.ts` ไม่มีความต่าง

- [ ] **Step 3: ⛔ เล่น fixture สัญญาของ POS (ถ้าแผน 09 ส่งมาแล้ว)** — เจ้าของคัดลอก `POS:packages/contracts/fixtures/dayo-api/` ไฟล์ของก้อน 3 มาที่ dayo `docs/pos-integration/fixtures/` · เจ้าของรันบนเครื่อง (`API_V1_ENABLED=1` · คีย์ทดสอบที่มี `shift:write`) `curl` คำขอในแต่ละไฟล์ (แทน uuid/เวลาตามหมายเหตุในไฟล์) แล้วเทียบ `status`/`reason`/คำนำหน้า `detail`/รูป `data` กับคำตอบในไฟล์ · **ต่าง = อย่าแก้ fixture เอง** แจ้งทีม POS พร้อมคำตอบจริง (สเปก §4.11 ข้อ 2 — fixture สะท้อนของจริง POS แก้ไฟล์ของตัวเอง) · ยังไม่มีไฟล์ = บันทึกว่า "รอแผน 09" แล้วไปต่อ (ไม่ขวาง merge ฝั่ง dayo แต่ขวางการเปิดใช้แท็บเล็ต)

- [ ] **Step 4: code-reviewer (sonnet)** — ตรวจ diff ทั้งก้อนกับ CLAUDE.md, ADR-0056, DATA-CONTRACT, GLOSSARY, สเปก POS §4.10 ก้อน 3: migration ใหม่เท่านั้น · ทุกฟังก์ชันที่ "ลอก" ต่างจากต้นฉบับเฉพาะบรรทัดป้าย `ADR-0056` (ใช้ `diff` กับไฟล์ต้นทาง: `0052` `0049` `0051` `0053` `0009` `0054`) · ทุก RPC ใหม่มี `set search_path` · ท้ายทุก migration มีบล็อกสิทธิ์ · ชื่อฟิลด์ทุกตัวตรงสเปก (`shift_id` `movement_id` `count_id` `z_report.*` `pos_bills.*` `bot_bills.*` ฯลฯ) · `supported_fields` = ที่ RPC อ่านจริง · เทสต์ครอบเกณฑ์ §9 ทุกข้อตามตาราง "เกณฑ์ก้อน 3 → ที่ตรวจ" · คำตัดสินของ `order`/`order_void` เดิมไม่เปลี่ยน (เปลี่ยนแค่คำนำหน้า `detail` + หาบิลข้าม key)

- [ ] **Step 5: security-reviewer (opus)** — รายการตรวจบังคับ:
  1. scope: แถวกะต้องมี `shift:write` (ต่อแถว) · `orders:write` 403 ทั้งคำขอยังอยู่ · `p_scopes` ตัดให้แคบลงได้เท่านั้น · `scope:` ออกจากขั้นตรวจ scope ต่อชนิดเท่านั้น (`dayo_pos_map_error` ไม่เติม `scope:` ให้ `DY403`)
  2. S4: ทุกการหา `shifts` `cash_counts` `cash_movements` `z_reports` มี `shop_id` + `api_client_id` · FK `(shop_id, api_client_id, shift_id)` · id ชนข้าม key/ร้าน = `FORBIDDEN rule:` ไม่ใช่ `duplicate`
  3. S5: บันทึกนอก savepoint (`api_pos_push` ลูป) · ตั้ง `data_conflict` ได้เฉพาะกะของ key ที่ส่ง (`v_mine`) — key หนึ่งทำให้กะของอีก key ติดธงไม่ได้ · ผู้ส่งคนแรกชนะ (ไม่มี UPDATE ข้อมูลเดิม)
  4. GUC `dayo.shift_writer`: ตั้งเฉพาะในฟังก์ชัน SQL และคืน `''` ทันทีหลังคำสั่ง · ไม่มี RPC ใดรับค่า writer จากภายนอก · PATCH ตรงด้วย service role ถูก trigger ปฏิเสธ (เทสต์ Task 1)
  5. `detail` ไม่สะท้อนยอดเงิน id พนักงาน `reason`/`note`/`variance_reason`/`lines.name` หรือข้อความดิบ (ไล่ทุก `dayo_pos_verdict*` ใน 0056–0058) · ข้อความ `pos_alerts` ไม่มียอดเงิน ชื่อพนักงาน เหตุผลอิสระ (รอ Q73) — มีแค่วันที่ จำนวนใบ/ชั่วโมง และลิงก์ `/shifts/<id>`
  6. E4 ไม่มีต้นทุน · `created_by_name` null เมื่อไม่มี `staff:read` · **ไม่มี API `/v1` ใดคืน `z_reports`/ส่วนต่าง** (E1 มีแค่ `last_z_no`/`last_z_hash`/`last_z_until` ของ key ตัวเอง) · `dashboard_shifts`/`get_shift_detail`/`export_rows('shifts')` owner เท่านั้นใน RPC · หน้า `/shifts/[shift_id]` ใช้ `requireRole("owner")` · **สิทธิ์ท้ายทุก migration 0055–0060 = บล็อกมาตรฐาน `0054:1000-1005` ครบ 6 บรรทัด รวม `grant execute on function public.customer_shop_info(uuid) to anon;`** (ขาด = บอทลูกค้าบน production พัง) · anon/authenticated ไม่มีสิทธิ์ execute ฟังก์ชันใหม่ใด (ตรวจด้วย RPC ตรวจสิทธิ์ของ 0054 ที่ `customer_bot.db.test.ts` ใช้)
  7. บิลนอกแคตตาล็อก: ด่านจริง = พื้นล่าง `block3_live_from` + เพดาน `off_catalog_max_total` + แจ้งทุกใบ · `block3_live_from` ตั้งจากว่างได้เฉพาะตัวรับ `shift_open` (วันนี้/เมื่อวาน) · owner เลื่อนได้เฉพาะเก่าลง · `pos_push_rejections` เขียนได้เฉพาะลูปของ `api_pos_push` (แถว `order` ที่ rejected) · ยอมรับความเสี่ยงที่ระบุใน P3 "ผลที่ตามมา" (key หลุดส่ง `order` ให้ถูกปฏิเสธก่อนได้)
  8. `dayo_pos_owner_active_at` เชื่อ `audit_log` (ประวัติ staff) — service role แทรกประวัติปลอมได้ = ขอบความไว้ใจเดียวกับ service role ทั้งหมด · `backdateOwner` อยู่ในเทสต์เท่านั้น
  9. การคิดซ้ำจาก trigger ห่อด้วย `dayo_z_recompute_safe` (ล้มไม่ทำให้แถวบิล/เงินถูกปฏิเสธ) · งานต่อแถวมีขอบ (≤ 2000 บิล · ≤ 500 รายการ) · ไม่มี SQL แบบ dynamic
  10. `pos_alerts` ไม่อยู่ในไฟล์สำรอง · ตารางใหม่ 5 ตารางอยู่ในไฟล์สำรองและกู้คืนแบบใส่เฉพาะที่ยังไม่มี · ไม่มีค่าลับในไฟล์ใด

- [ ] **Step 6: แก้ผลตรวจระดับ สูง/วิกฤต** โดย implementer ตัวเดิม (SendMessage ต่อบริบทเดิม) → test-runner รัน Step 2 ซ้ำ · **ตรวจทั้งสาย (Opus)** อ่าน diff รวมอีกรอบเฉพาะจุดที่แก้

- [ ] **Step 7: หัวหน้าสรุปให้เจ้าของ** (ไทย): สิ่งที่เปลี่ยน · ผลเทสต์ · วิธีลองด้วยมือ (Task 8 Step 5 · Task 10 Step 5 · Task 11 Step 5) · ADR/GLOSSARY ที่แตะ · ⛔ ขั้นใน Task 15 → รอเจ้าของสั่ง commit/merge

---

## Task 15: ⛔ production + ส่งมอบให้ทีม POS (เจ้าของทำเอง · devops ช่วยแสดงคำสั่ง/อ่าน log)

devops แสดงคำสั่งและผลที่จะเกิด แล้ว **หยุดรอเจ้าของพิมพ์ยืนยันทุกขั้น** · **dayo deploy ก่อน POS เสมอ** (ADR-0049 ข้อ 7)

- [ ] **ขั้น 0 ⛔ รู้ว่าอะไรจะขึ้นไปด้วย + สำรองก่อน** (เจ้าของรันเอง · devops อ่านผล):
  1. `npx supabase migration list` (linked production) → จด migration สุดท้ายที่ production มีจริง
  2. แสดงรายการ **migration ทุกไฟล์ที่ยังไม่ขึ้น** ซึ่งจะขึ้นพร้อม `db:push` ครั้งนี้ — ตาม `HANDOFF.md` ของ dayo อาจมี `0053_profit_view` `0054_customer_bot` `0061_import_replace_all` ค้างอยู่ด้วย → เจ้าของยืนยันว่ายอมให้ฟีเจอร์เหล่านั้น (ดูกำไร · บอทลูกค้า · นำเข้าแทนทั้งหมด) ขึ้นพร้อมกัน หรือให้ขึ้นแยกก่อน
  3. ยืนยันเลข migration ของแผนนี้ตามผล Task 0 Step 1b (ก้อน 3 เริ่มที่ `0064` → `0064`–`0069`) ต้องมากกว่าเลขสูงสุดใน production และใน branch ที่จะขึ้นก่อน
  4. **สำรองข้อมูลแบบกดเอง (ADR-0021)** ที่ `/settings/backup` แล้วเก็บไฟล์ไว้นอกเครื่อง ก่อน `db:push` ทุกครั้ง
- [ ] **ขั้น 1 ⛔ ตรวจข้อมูลก่อนย้าย unique** — SQL editor production:
  `select shop_id, pos_order_id, count(*) from public.orders where pos_order_id is not null group by 1, 2 having count(*) > 1;` → ต้อง **0 แถว** (มีแถว = หยุด · migration 0055 จะ raise `precheck:` อยู่แล้ว · เจ้าของตัดสินกับทีม dayo ว่าจะจัดการบิลซ้ำอย่างไรก่อน)
- [ ] **ขั้น 2 ⛔ db:push** — `npm run db:push` (ก้อน 3 เริ่มที่ 0064 → 0064–0069 ตาม Task 0 Step 1b · `supabase migration list` ต้องแสดงว่า `0061`–`0063` ขึ้น production แล้ว ก่อนรันขั้นนี้ ไม่ผ่านให้หยุด) · ตรวจ: `select has_function_privilege('anon', 'public.customer_shop_info(uuid)', 'execute');` = `true` (บอทลูกค้ายังใช้ได้) · `select public.dayo_pos_supported() -> 'kinds';` = 7 ชนิด · `select off_catalog_max_total, shift_waiting_alert_hours, block3_live_from from public.shop_settings;` = `3000`, `48` (หรือ null ตามคำตอบ Q74), `null` · `select count(*) from public.shifts;` = 0
- [ ] **ขั้น 3 ⛔ deploy** — `npm run release:deploy` (เว็บ + บอท) · `curl -si -X OPTIONS -H "Origin: <POS origin>" https://<dayo-web>/api/v1/pos/shift-cash` = `204` · ถ้า `API_V1_ENABLED` เปิดอยู่แล้ว: `curl` E1 ด้วยคีย์แท็บเล็ตเห็น `supported_kinds` 7 ชนิด และ `client.last_z_no`/`last_z_hash`/`last_z_until` เป็น `null`
- [ ] **ขั้น 4 ⛔ เพิ่ม scope** — `/settings/api-clients` ติ๊ก `shift:write` ให้คีย์แท็บเล็ต (ไม่ติ๊ก = แท็บเล็ตรอแบบ `scope:` + 🟡 วันละครั้ง — ไม่เสียข้อมูล)
- [ ] **ขั้น 5 ⛔ ส่งมอบให้ทีม POS** (เจ้าของส่งข้อความ/ไฟล์ให้ session POS): commit ที่ deploy · ผล Task 14 Step 3 (fixture ที่ตรง/ต่าง) · ยืนยันว่าชนิด/ฟิลด์ตรง §4.10 · "จุดตีความจากสเปก" ท้ายแผนนี้ (ข้อที่กระทบแท็บเล็ต: 8 · 12 · 21) · จากนั้นทีม POS deploy แท็บเล็ตรุ่นที่ใช้ชนิดก้อน 3 ได้ · **การเปิดใช้แท็บเล็ตขายจริงยังรอสำรองอัตโนมัติ (D86 · D94 · ADR-0051 — แยกจากแผนนี้)**

---

## วิธีส่งแผนนี้ให้ session ของ dayo

1. ⛔ เจ้าของคัดลอกไฟล์นี้ + POS `docs/design/04-สเปกการเชื่อม-POS-กับ-dayo.md` + `docs/design/dayo-adr-drafts/P3-shift-cash-z-report.md` + `docs/design/00-บันทึกการตัดสินใจ.md` ไปที่ dayo `docs/pos-integration/` (Task 0 Step 1)
2. เปิด session ใน repo dayo: `claude --model opus` แล้วสั่ง:
   ```
   ทำงานแบบทีมตาม docs/TEAM-WORKFLOW.md:
   1) architect อ่าน docs/pos-integration/2026-09-26-08-block3-dayo-shift-cash.md + สเปก + P3 แล้วทำ Task 0 (ร่าง ADR-0056 ใหม่ + ADR-0024 ข้อ 2) สรุปคำถามให้ฉันก่อน
   2) หลังอนุมัติ แจกงานตามตาราง "ลำดับและงานขนาน" (lane A ใช้ Docker ทีละงาน · ไม่เกิน 4 agent)
   3) ทุก task ผ่าน test-runner → code-reviewer (+ security-reviewer ตามที่ task ระบุ)
   4) Task 14 ตรวจทั้งสาย แล้วรอฉันสั่ง commit/merge · Task 15 ฉันทำเอง
   ```
3. ข้อขัดกับสเปกที่พบระหว่างทำ: session dayo หยุดแล้วแจ้งเจ้าของ → ทีม POS (architect) แก้สเปกก่อน → ทั้งสองฝั่งทำตาม (สเปก §4.11) · ห้ามแก้สัญญาฝ่ายเดียว

---

## เกณฑ์ก้อน 3 (สเปก §9 — ส่วนที่เป็นของ dayo) → ที่ตรวจ

| เกณฑ์ | ตรวจที่ |
|---|---|
| ปิดกะที่มีบิลเงินสดบอท 3 ใบ → เงินที่ควรมีรวมบิลบอท · Z `matched` | `pos_z_recompute` "ปิดกะที่มีบิลเงินสดบอท 3 ใบ" |
| ขายออฟไลน์ทั้งกะ Z มาก่อนบิลและ `order_void` → `waiting_bills` ไม่มี Discord → ครบแล้ว `matched` เอง | `pos_z_recompute` "ขายออฟไลน์ทั้งกะ" |
| บิลครบแต่องค์ประกอบต่าง → `mismatch` + Discord ครั้งเดียว | `pos_z_recompute` "บิลครบแต่องค์ประกอบต่าง" |
| ส่วนต่าง −฿20.00 แจ้ง · −฿19.99 ไม่แจ้ง · เกณฑ์ ฿50 ส่วนต่าง ฿30 ไม่แจ้ง · ข้อความไม่มียอดเงิน | `pos_z_recompute` "แจ้งส่วนต่างตาม variance_alert" · `block3_schema` "pos_alerts_take" |
| ขายเงินสดแล้วยกเลิกคืนเงิน → ไม่หักซ้ำ `matched` | `pos_z_recompute` "ขายออฟไลน์ทั้งกะ" (VOID_REFUND + order_void) |
| owner แก้/ยกเลิกบิลเงินสดบนเว็บหลังปิดกะ → Z ยัง `matched` + บรรทัด "เจ้าของแก้บิลหลังขาย" | `pos_z_recompute` "owner ยกเลิกบิลเงินสด" · `block3_shift_reads` "บรรทัดกะ + เจ้าของแก้บิลหลังขาย" |
| สองกะในวันเดียว บิลบอทแต่ละใบอยู่ใน Z เดียว · บิลบอทหลัง `counted_at` ไม่อยู่ใน Z นี้ | `pos_z_recompute` "สองกะในวันเดียว" |
| นับออฟไลน์ → เปิดกะถัดไป → ออนไลน์ → ทุกแถว `accepted` ไม่มี `CONFLICT` | `pos_push_shift` "นับออฟไลน์ → เปิดกะถัดไป" |
| บิลนอกแคตตาล็อก: accepted · `off_catalog` · `cost_total` null · ไม่มี `order_items`/สต็อก · ยอดขายรวม · กำไรไม่รวม + "บิลไม่รู้ต้นทุน 1 ใบ" (แดชบอร์ด = หน้าดูกำไร) · ไม่ค้าง `waiting_bills` | `pos_off_catalog` เคสแรก · `block3_reports` 2 เคสแรก · Task 10 (หน้าเว็บ) |
| `closed_by` ไม่ใช่ owner = `FORBIDDEN` · ยอดไม่ตรงสูตร = `INVALID` · มีบิลปกติแล้ว = `CONFLICT` · `order` ของบิลนอกแคตตาล็อก = `CONFLICT` · `order_void` ของบิลนอกแคตตาล็อก = ยกเลิกได้ | `pos_off_catalog` เคส 2, 3, 7, 10 |
| key ไม่มี `shift:write` → แถวกะ `FORBIDDEN` ขณะบิลในคำขอเดียวกันผ่าน | `pos_push_shift` "key ไม่มี shift:write" |
| `block3_live_from` ว่าง → `shift_open` แรกที่ accepted ตั้ง · แถวถัดไปไม่เปลี่ยน · rejected ไม่ตั้ง | `pos_push_shift` "block3_live_from" |
| ส่งกะซ้ำ = `duplicate` | `pos_push_shift` "accepted {shift_id} · ส่งซ้ำ" |
| แก้ `shifts`/`cash_movements`/`cash_counts`/`z_reports.snapshot` ในฐาน = raise · ฟังก์ชันคิดซ้ำอัปเดต `recompute_*` ได้ | `block3_schema` เคส shifts/cash_movements/cash_counts · `pos_z_recompute` (สถานะเปลี่ยนผ่าน `dayo_z_recompute`) |
| หน้ารายละเอียดกะ owner เห็น · manager/staff ถูกปฏิเสธ · RPC `dashboard_shifts`/หน้ากะ ด้วย staff/manager = `DY403` | `block3_shift_reads` "สิทธิ์ (S6)" · `apps/web/test/shifts.test.ts` · Task 11 Step 5 |
| `supported_kinds`/`supported_fields` ตรงกับที่ RPC รับจริง | `pos_push_shift` / `pos_off_catalog` "supported_fields" · `pos_z_recompute` (แถว `shift_close` ครบฟิลด์ผ่าน) |
| `cash_movement` ถูกปฏิเสธแล้ว `shift_close` มาก่อน → `waiting_bills` → แก้แล้ว `matched` | `pos_z_recompute` "เงินเข้า-ออก: ถูกปฏิเสธแล้ว shift_close มาก่อน" |
| `RECEIPT_RENUMBERED` หลังออก Z → ยัง `matched` (ข้อสังเกต) | `pos_z_recompute` "RECEIPT_RENUMBERED" |
| `after` ≠ `until` ของ Z ใบก่อน → `mismatch` · บิลบอทที่ค้นได้แต่ไม่อยู่ใน `bot_bills` → `mismatch` · แก้บิลบอทหลังนับ → ข้อสังเกต | `pos_z_recompute` "after ≠ until …" · "บิลบอทแก้/ยกเลิกหลังนับ" |
| `movement_ids` มี id กะอื่น/key อื่น → `mismatch` · `VOID_REFUND` รวมเกินยอดบิล → `mismatch` | `pos_z_recompute` "เงินเข้า-ออก …" · "VOID_REFUND: รวมเกินยอดบิล …" |
| มีบิลยอดต่างขณะบิลอื่นยังไม่มา → `mismatch` ทันที | `pos_z_recompute` "บิลครบแต่องค์ประกอบต่าง" (ส่วนที่สอง) |
| แถวแม่ของ key อื่น → `FORBIDDEN rule:` | `pos_push_shift` "cash_movement … กะของ key อื่น" · "shift_open … id เดียวกันจาก key อื่น" |
| `order_off_catalog` ไม่เคยถูกปฏิเสธ / `original_reason` ไม่ตรง / ต่ำกว่าพื้นล่าง / เกินเพดาน → `FORBIDDEN rule:` · บิลที่รับ → Discord 1 ข้อความไม่มียอดเงิน | `pos_off_catalog` เคส 1, 4, 5, 6 |
| `prev_hash` ไม่ต่อโซ่ → `chain_break` | `pos_z_recompute` "after ≠ until … prev_hash" |
| `shift_close` ชนการนับในฐาน → 🔴 + `data_conflict` | `pos_z_recompute` "shift_close: … counted 999" · `pos_push_shift` "cash_count … counted:" |
| ข้อความ Discord ทุกชนิดไม่มียอดเงิน · Discord ส่วนต่างใช้ `variance_alert` ของ Z | `pos_z_recompute` "แจ้งส่วนต่าง" · `pos_off_catalog` เคสแรก · `block3_shift_reads` "pos_alerts_scan" · security-reviewer ข้อ 5 |
| key ไม่มี `shift:write` → รอ (ฝั่ง dayo: `rejected FORBIDDEN scope:` ทุกครั้งจนเพิ่ม scope) · เพิ่ม scope แล้วผ่านเอง | `pos_push_shift` "key ไม่มี shift:write" (ฝั่งรอเป็นของแท็บเล็ต — แผน 09) |
| `order_off_catalog` ของบิลปกติที่มีแล้ว = `CONFLICT exists:<order_no>` + `data` | `pos_off_catalog` "ชนบิลในฐาน" |
| `order` เกิน 60 วันปิดเป็นนอกแคตตาล็อกได้ (fixture ตั้ง `block3_live_from` เก่ากว่า 60 วัน) | `pos_off_catalog` "order ที่ถูกปฏิเสธเพราะเก่ากว่า 60 วัน" (`beforeAll` เลื่อนวันเริ่มใช้กะ 90 วัน) |
| `VOID_REFUND` ของบิลใน `pos_bills` ของ Z เดียวกันโดย `voided_at` null → `mismatch` · ชี้บิล key อื่น → `mismatch` · รอ `order_void` ที่ถูกปฏิเสธ → รอจนยกเลิกบนเว็บแล้ว `matched` | `pos_z_recompute` "VOID_REFUND: …" · "VOID_REFUND รอ order_void …" |
| บิลบอทไม่ถูกแก้หลังนับแต่ยอดใน snapshot ≠ ยอดปัจจุบัน → `mismatch` | `pos_z_recompute` "บิลบอทแก้/ยกเลิกหลังนับ …" (ส่วนที่สอง) |
| Z 5 ปิดไว้ในเครื่องแล้ว Z 6 มา → "Z ขาดช่วง" ไม่ใช่ mismatch/chain_break · Z 5 ส่งทีหลัง → เติมช่อง แล้ว Z 6 ถูกคิดซ้ำ ข้อสังเกตหาย · `z_no` ซ้ำ → `z_no_taken:` + 🔴 · เลขต่ำเล่นซ้ำ → `mismatch` + `chain_break` · Z ใบแรกไม่ตรวจโซ่ · `z_no` > สูงสุด + 50 → `INVALID` + 🔴 | `pos_z_recompute` describe "ลำดับ z_no และโซ่" (3 เคส) |
| ติดตั้งแอปใหม่ด้วย key เดิม → E1 ให้ `last_z_no`/`last_z_hash` (+ `last_z_until` — คำวินิจฉัยผู้คุมงาน) → Z ใบถัดไปต่อเลข/โซ่/`after` ได้ `matched` ไม่มี 🔴 | `pos_z_recompute` เคสแรก (ส่วน E1 + Z ใบถัดไปหลังติดตั้งใหม่) · (ฝั่งต่อเลข — แผน 09) |
| บิลรับแล้วใต้ key เก่า แล้วปิดเป็นนอกแคตตาล็อกจาก key ใหม่ → `exists:` · `order` เดียวกันจาก key ใหม่ → `exists:` ไม่สร้างบิลที่สอง · บิลนอกแคตตาล็อกของ key เก่าปิดซ้ำจาก key ใหม่ → `off_catalog_exists:` | `pos_off_catalog` "ชนบิลในฐาน" · `pos_push_shift` "บิลเดียวกันใต้ key อื่น" · `block3_schema` "unique บิล POS" |
| Z ขาดช่วงที่ `after` ไม่ตรงการนับล่าสุดและช่วงนั้นมีบิลเงินสดบอท → `mismatch` · ไม่มีบิล → ข้อสังเกต | `pos_z_recompute` "Z ขาดช่วงที่ after ≠ การนับล่าสุด" |
| `order_off_catalog` จาก key ใหม่ของบิลที่ key เก่าเคยถูกปฏิเสธ → รับ · `original_reason` เหตุผลใดก็ได้ที่เคยบันทึก → รับ | `pos_off_catalog` "ชนบิลในฐาน" · "เงื่อนไขปิด" |
| owner ตั้ง `block3_live_from` ใหม่กว่าเดิมบนเว็บ → ปฏิเสธ | `block3_schema` "block3_live_from" · `apps/web/test/settings.posCash.test.ts` |
| `data` ของผลทุกชนิดตามที่ล็อก | `pos_push_shift` (`{shift_id}` `{movement_id}` `{count_id}`) · `pos_z_recompute` (`{shift_id}`) · `pos_off_catalog` (`{order_no, version}`) |
| parity สูตรเงินที่ควรมี แท็บเล็ต = dayo (รวมติดลบ) | `pos_z_recompute` "parity สูตรเงินที่ควรมี" + fixture POS (D84) |
| (ส่งมอบอื่น) E4 · แดชบอร์ด 1 บรรทัดต่อกะ · หน้ารายละเอียดกะ · `today_mini` เปิด/ปิด · Export กะ owner · ไฟล์สำรอง | `api.shiftCash.test.ts` · `block3_shift_reads` · Task 11 · `block3_reports` "today_mini" · `block3_shift_reads` "export_rows" · Task 8 |

## จุดตีความจากสเปก (architect ของ dayo ใส่ใน ADR-0056 ตาม Task 0 Step 2 · ข้อที่กระทบแท็บเล็ตแจ้งทีม POS)

1. **คิวแจ้งเตือน `pos_alerts`** (P3 ค4): SQL เขียนแจ้งเตือนลงคิวในธุรกรรมของเหตุการณ์ → Route Handler push / Server Action แก้-ยกเลิกบิล / cron บอทรายชั่วโมง ดึงด้วย `pos_alerts_take` แล้ว `console.warn/error` → Discord ตาม ADR-0044 · บิลนอกแคตตาล็อกรวมเป็นข้อความ "N ใบ" · ข้อความชนิดเดียวกันภายใน 5 นาทีอาจถูกรวมเป็น "ซ้ำ N ครั้ง" ตามกลไกกันสแปมของ ADR-0044 ข้อ 5 (ยอมรับ) · ไม่อยู่ในไฟล์สำรอง · **ส่งแบบ at-most-once (ยอมรับ)**: `pos_alerts_take` ตั้ง `sent_at` ตอนดึง ก่อนส่ง Discord — ดึงแล้ว Worker ล้ม/Discord ตอบผิด/พ้นขอบคำขอ = ข้อความนั้นหาย ไม่ส่งซ้ำ · สวิตช์ "แจ้ง warning/error" ของร้านปิด (ADR-0046 `alert_warnings`/`alert_errors`) → console ไม่ส่ง Discord แต่แถวถูกตั้ง `sent_at` แล้ว (ไม่ค้างส่งทีหลังเมื่อเปิดสวิตช์) · งบ ≤ 5 ข้อความต่อคำขอของ ADR-0044 ข้อ 5 เต็ม (มี error อื่นในคำขอเดียวกัน) → ข้อความที่เกินถูกทิ้งโดยกลไก ADR-0044 ทั้งที่ตั้ง `sent_at` แล้ว · ข้อมูลต้นทางไม่หาย: ทุกเหตุการณ์ยังเห็นบนแดชบอร์ด/หน้ากะ (สถานะ `mismatch` · ป้าย · `alerted_*_at`)
2. **ระดับข้อความ** (P3 ค3): ขาด/เกิน 🟡 · `mismatch` 🔴 · ข้อมูลกะชนกัน 🔴 **ไม่ `@here`** (คง ADR-0044 ข้อ 8) · บิลนอกแคตตาล็อก/`scope:`/กะซ้อน/> 3 กะ/รอนาน 🟡 · เพิ่มชนิด `recompute_failed` 🔴 (การคิดซ้ำจาก trigger ล้ม — แถวบิล/เงินไม่ถูกปฏิเสธเพราะเรื่องนี้)
3. **ผู้เขียนคอลัมน์ที่ถูกคุม** = GUC `dayo.shift_writer` ตั้งเฉพาะในฟังก์ชัน SQL (`push` สถานะ/ปิดกะ/`block3_live_from` จากว่าง · `recompute` ผลคิดซ้ำ · `alert` เวลาแจ้ง · `conflict` `data_conflict`)
4. **`z_reports.first_of_key`** (คอลัมน์เพิ่ม): จำว่า "key ไม่มี Z ในฐานเลย ณ ตอนรับ" (ลำดับ z_no ข้อ 2) — คิดซ้ำภายหลังยังแยกข้อ 2 กับข้อ 4 ได้
5. **`chain_break` จากข้อ 3 (prev_hash ไม่ตรง) ไม่ทำให้ `mismatch` เอง** — สเปกข้อ 3 แยกผล "prev_hash → chain_break · after → mismatch" และข้อ 5 เขียน "mismatch + chain_break" คู่กัน · เงินไม่ตรง = `mismatch` ตามปกติ · **กระทบแท็บเล็ต: ไม่มี (ไม่มีข้อมูล Z กลับไปแท็บเล็ต)**
6. **ข้อ 5 (เติมช่อง/เล่นซ้ำ) ตามสเปก 04 ตรงตัว** (แก้รอบ 2 — คำวินิจฉัยผู้คุมงาน: สเปกเป็นหลัก · เดิมแผนนี้ใช้กว้างกว่าสเปก): ใช้เฉพาะใบที่ **`z_no` ≤ สูงสุดของ key ณ ตอนรับ** และ `counted_at` ไม่อยู่ระหว่างใบข้างเคียงที่ไม่ถูกกัก = `mismatch` + `chain_break` (`check: z_order`) · **ใบเลขสูงที่ `counted_at` เก่ากว่าไม่ถูกกัก** (ข้อ 3 จับ `after` ≠ `until` ของใบก่อนเป็นต่างอยู่แล้ว) · **ใบที่ตก z_order ถูกกัก** (`z_reports.z_order_quarantined` ตั้งครั้งเดียวตอน insert ใน `dayo_pos_shift_close` แล้วแก้ไม่ได้ — การคิดซ้ำอ่านค่าอย่างเดียว · สเปก 04 §13.8 R5-3): ไม่เป็น "Z ใบก่อน/ถัดไป" · ไม่ใช้ตัดสิน `prev_hash`/`after`/`z_order`/บิลบอทซ้ำของใบข้างเคียง · การนับของกะที่ถูกกักไม่ใช้ในการตรวจ `after` ของ Z ขาดช่วง · เลข `z_no` ของใบที่ถูกกักยังถือว่า "ถูกใช้แล้ว" (`z_no_taken:` · เพดาน +50 · **E1 `last_z_no` = สูงสุดของทุก Z รวมใบที่ถูกกัก · `last_z_hash`/`last_z_until` = ของ Z ที่ไม่ถูกกักที่เลขสูงสุด**)
7. **"กะซ้อนกัน"** ตรวจเมื่อรู้ `counted_at` ของทั้งสองกะ (ตอนรับ `cash_count`) — กันแจ้งปลอมระหว่างที่การนับของกะก่อนยังไม่มา
8. **E4 > 500 บิล = `DY422 too_large`** (ตรงกับเพดาน `bot_bills` ≤ 500 ของ `shift_close`) · `until` ในอนาคตรับได้ · **กระทบแท็บเล็ต: ต้องแสดงข้อความเมื่อได้ 422 นี้**
9. **รายงาน**: `fee` คงเป็นค่าธรรมเนียมทุกบิล (เงินที่จ่ายจริง) · เพิ่ม `fee_known_cost` สำหรับสมการ "ยอดขาย − ยอดบิลไม่รู้ต้นทุน − ค่าธรรมเนียม (บิลที่รู้ต้นทุน) − ต้นทุน = กำไรขั้นต้น" · `cost` ของ view = ต้นทุนบิลที่รู้ต้นทุน
10. **"บิลบอทนอกใบปิดกะ"** นับเฉพาะบิลที่สร้างก่อนการนับล่าสุดของร้าน (บิลหลังจากนั้นยังรอกะถัดไป ไม่ใช่ "นอก")
11. **บรรทัดกะ "ปิด <เวลา>"** = `counted_at` (เวลาที่กะหยุดขาย) · ยังไม่นับ = "ยังเปิดอยู่" · นับแล้วยังไม่มี Z = "รอใบปิดกะ"
12. **ข้อมูลกะชนกันแบบ `INVALID`** (`z_report.counted` ≠ การนับในฐาน · `z_no` > สูงสุด + 50): dayo บันทึก S5 ครบ และ `detail` ขึ้นต้น **`data_conflict:`** (คำวินิจฉัยผู้คุมงาน 26 ก.ย. 2569 — ทีม POS เพิ่มในสเปก 04 และแผน 09) · **กระทบแท็บเล็ต: `INVALID` + `data_conflict:` = แถบแดง "ข้อมูลกะชนกัน" (§6.4) ไม่ใช่บั๊ก** · `INVALID` อื่นไม่มีคำนำหน้านี้ · `CONFLICT` `counted:`/`key_changed:`/`z_no_taken:` คงเดิม
13. `scope:` ใส่ให้แถว `FORBIDDEN orders:write` ต่อแถวด้วย (ขั้นตรวจ scope ต่อชนิดเดียวกัน · ในทางปฏิบัติไปไม่ถึง) · `DY403` ทั่วไปจากภายใน RPC = `FORBIDDEN` ไม่มีคำนำหน้า
14. ตรวจ "id เดิม = `duplicate`" ก่อนตรวจแถวแม่ (`PARENT_PENDING`) ในทุกชนิดกะ
15. คีย์ `payment` ของ `pos_reported_amounts` ใส่ด้วย trigger `BEFORE INSERT` (`orders_pos_payment_stamp`) แทนการลอก `dayo_impl_create_order` ทั้งตัว
16. บิลนอกแคตตาล็อก: แก้บนเว็บไม่ได้ (`DY422 off_catalog_read_only` — trigger บน `orders`/`order_items`) ยกเลิกได้ (P3 ค2) · `audit_log.after` = `{closed_by, closed_at, reason, original_reason}` (P3 ค1)
17. `VOID_REFUND` "ชี้บิลของ key อื่น" = มีแถว `orders` ที่ `pos_order_id` เดียวกันแต่ร้าน/key ต่าง
18. `shift_open` ที่ตั้ง `block3_live_from` แก้ `shop_settings` → ฉบับแคตตาล็อกเพิ่ม 1 ครั้ง (trigger ของ ADR-0048) → แท็บเล็ตดึง E1 ใหม่ครั้งเดียว (ไม่กระทบความถูกต้อง)
19. `dayo_pos_owner_active_at` อ่านสถานะ ณ เวลาในแถวจากประวัติ `staff` ใน `audit_log` (ไม่มีตารางประวัติแยก)
20. `shift_waiting_alert_hours` + `z_reports.alerted_waiting_at` (**รอ Q74 — ค่าเริ่มต้น · ขัด D98**) · `null` = ไม่แจ้ง
21. **E1 `client.last_z_until`** (คำวินิจฉัยผู้คุมงาน 26 ก.ย. 2569 — ทีม POS แก้สเปก 04/P3 ตาม): `counted_at` ของการนับของ Z ที่ไม่ถูกกักที่เลขสูงสุดของ key (ใบเดียวกับ `last_z_hash` · = `bot_window.until` ของใบนั้น · สเปก 04 R5-3) รูป ISO UTC มิลลิวินาที `…Z` · ไม่มี Z = null · **กระทบแท็บเล็ต: ติดตั้งใหม่ใช้เป็น `after` ของ Z ใบถัดไป** · ไม่ใช่ข้อมูลส่วนต่าง/ยอดเงิน จึงไม่ขัด D99/S6

---

## Self-review (architect POS · 26 ก.ย. 2569)

**ครอบสเปก** — ทุกข้อที่เป็นของ dayo มี task:

| สเปก | task |
|---|---|
| Step 0 รับ ADR-0056 · แก้ ADR-0024 ข้อ 2 · ADR-0049 ข้อ 3 (ก0) · คำถาม Q72–Q74 ค1–ค5 · ADR-0051 | 0 |
| ตาราง `shifts` `cash_movements` `cash_counts` `z_reports` `pos_push_rejections` + trigger · RLS · ไฟล์สำรอง | 1 (+ 8 ไฟล์สำรองฝั่งเว็บ/กู้คืน) |
| `orders.off_catalog` `off_catalog_lines` · `cost_total` null เฉพาะบิลนี้ · แช่แข็ง `pos_shift_id`/`external_ref` · unique `(shop_id, pos_order_id)` + ตรวจคู่ซ้ำ · คีย์ `payment` | 1 (+ 15 ขั้น 1) |
| `shop_settings.block3_live_from` (ตั้งเอง · เลื่อนเก่าลงเท่านั้น) · `off_catalog_max_total` (Q72) | 1 · 2 (ตั้งเอง) · 8 (หน้าเว็บ) |
| scope `shift:write` (CHECK · `dayo_check_api_scopes` · `apiScopes.ts`) | 1 · 8 |
| `pos_push_rejections` นอก savepoint | 1 (ตาราง) · 2 (เขียน) |
| ชนิด push 5 ชนิด · คำตัดสิน · คำนำหน้า · `data` · ช่อง id · scope ต่อชนิด · S4 · เวลา · พนักงาน/owner ณ เวลา | 2 · 3 · 4 |
| ตัวแปลง 23505 | 2 |
| ลำดับ `z_no` 0–6 · คิดซ้ำ 6 ข้อ (รายแถวก่อน ผลรวมเมื่อไม่ขาด) · trigger คิดซ้ำ | 4 |
| E1 `last_z_no`/`last_z_hash` (+ `last_z_until` — คำวินิจฉัยผู้คุมงาน) · E4 | 4 (RPC) · 9 (route E4 · E1 route ส่งต่อดิบ ไม่แก้) |
| Discord D98/D102/S5/S1(d)/m1/m4/Q74 ไม่มียอดเงิน | 1 (คิว) · 2 · 3 · 4 · 6 (รอนาน) · 9 (เว็บส่ง) · 12 (cron) |
| แดชบอร์ด owner 1 บรรทัดต่อกะ · หน้ารายละเอียดกะ · RPC ตรวจ owner (D99/S6) · `today_mini` เปิด/ปิด · Export กะ owner | 5 · 6 · 11 |
| รายงานบิลนอกแคตตาล็อก: GP null · ตัวหาร GP% · แก้ว · E3 `off_catalog` · หน้าบิล "ไม่ทราบ" · หน้าดูกำไร = แดชบอร์ด · รายงานเช้า | 5 · 7 · 10 |
| "เจ้าของแก้บิลหลังขาย" (D93) | 6 · 11 |
| เอกสาร dayo (API/DATA-CONTRACT/GLOSSARY/OPERATIONS/OpenAPI) | 13 |
| รีวิวทั้งสาย · security-reviewer · deploy dayo ก่อน POS · ส่งมอบ | 14 · 15 |

**placeholder** — ไม่มี "TBD"/"ทำแบบ Task N" · จุด "ลอกฟังก์ชันเดิม" ทุกจุดระบุไฟล์ + ช่วงบรรทัดต้นทาง + ข้อความที่แทนตรงตัว (ตามแบบกฎเหล็กข้อ 13 ของ dayo) · ไฟล์ fixture parity ของ POS เป็นขั้น ⛔ ที่ไม่มีไฟล์ = SKIP เฉพาะส่วนนั้น

**ชื่อ/ชนิดตรงกัน** — `shift_id` `movement_id` `count_id` `pos_order_id` · `z_report.{z_no, hash, prev_hash, chain_warning, variance_alert, cash, counted, bot_window, movement_ids, bot_bills, pos_bills}` · `cash.{opening_float, pos_cash_sales, void_refunds, paid_in, paid_out, drops, drawer_expenses, bot_cash}` · `recompute_status ∈ {waiting_bills, matched, mismatch}` · `unknown_cost_{bills,revenue,fee}` + `fee_known_cost` ใช้ชื่อเดียวกันใน SQL (Task 5) · shared (Task 7) · เว็บ (Task 10) · `ShiftLine` (Task 7) = แถว `dashboard_shifts.shifts` (Task 6) · `WaitingItem` = `get_shift_detail.z.waiting` · `dayo_pos_map_error` ลายเซ็นใหม่ใช้ใน `api_pos_push` และเทสต์ Task 2 ตรงกัน

