# ก้อน 3 · ฝั่ง dayo: กะ เงินสด นับเงิน ใบปิดกะ (Z) บิลนอกแคตตาล็อก · Implementation Plan (สำหรับ session ของ dayo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **แผนนี้ทีม POS เขียนให้ session ของ repo `dayo-shop-system` ใช้** (D90) · ทีม POS ไม่แก้ไฟล์ใน repo dayo · session ของ dayo เป็นผู้ทำ ตรวจ และตัดสินจุดที่ติดป้าย "dayo ตัดสิน" ตามกฎเหล็กและ ADR ของ dayo เอง (`CLAUDE.md` · `docs/TEAM-WORKFLOW.md` · ADR-0066 worktree) · ถ้าข้อความในแผนนี้ขัดกับ SQL บน `main` ของ dayo ให้ถือ SQL ของ dayo เป็นความจริงและแจ้งทีม POS

**Goal:** ฐานกลางรับกะ เงินเข้า-ออก การนับเงิน และใบปิดกะจากแท็บเล็ตผ่าน `POST /v1/pos/push` ด้วยชนิดใหม่ 5 ชนิด (`shift_open` `cash_movement` `cash_count` `shift_close` `order_off_catalog`) คิดใบปิดกะซ้ำจากแถวจริงในฐาน (`waiting_bills`/`matched`/`mismatch`) ให้ `GET /v1/pos/shift-cash` (E4) รายงานรองรับบิลไม่รู้ต้นทุน แจ้ง Discord และมีหน้ากะบนเว็บสำหรับ owner

**Architecture:** migration ใหม่ต่อจาก `0061_import_replace_all.sql` (ตัวล่าสุดบน `main` `995fd41`) · ตาราง append-only แบบเดียวกับ `stock_movements`/`audit_log` · ขยาย `dayo_pos_push_row` (`0052_pos_push.sql:539-630`) ให้ช่อง id ตามชนิด + scope ต่อแถว + คำนำหน้า `detail` · ตัวรับชนิดใหม่เป็นฟังก์ชัน `dayo_pos_<kind>` ข้าง `dayo_pos_order`/`dayo_pos_void` · ฟังก์ชันคิดซ้ำ `dayo_z_recompute` เรียกจากทุกจุดที่แถวเกี่ยวกับกะที่มี Z ถูกรับ · Route Handler ใหม่ `apps/web/src/app/api/v1/pos/shift-cash/route.ts` · แจ้ง Discord ผ่าน Route Handler แบบเครื่องหมายในคำตอบ (P3 ค4) · หน้าเว็บ `/shifts/[shiftId]` ใต้ layout owner

**Tech Stack:** ของ dayo เดิม (Supabase Postgres · Next.js OpenNext บน Workers · `@dayo/shared` · vitest 4 · Playwright · Node 24)

**Spec (อ่านจาก repo POS · อ่านอย่างเดียว):** `pos-management/docs/design/04-สเปกการเชื่อม-POS-กับ-dayo.md` §4.10 ก้อน 3 · §6.2 · §6.4 · §6.8 · §9 ก้อน 3 · §13.8 · ร่าง ADR `pos-management/docs/design/dayo-adr-drafts/P3-shift-cash-z-report.md` · แผนฝั่ง POS ที่ทำคู่กัน `pos-management/docs/superpowers/plans/2026-09-28-08-block3-pos-shift-cash.md`

> **สถานะ (28 ก.ย. 2569):** เจ้าของ **ยอมรับ ADR-0056** ตามร่าง P3 และ **ยอมรับ ADR-0051** (สำรองอัตโนมัติ · ยกเลิกการเลื่อน · D95) แล้ว · ADR-0051 มีแผนของตัวเองฝั่ง dayo (ไม่อยู่ในแผนนี้ · แต่ตารางใหม่ของแผนนี้ต้องเข้าไฟล์สำรองตั้งแต่วันแรก · Task 1) · เจ้าของตอบ Q72-Q74 แล้วเป็น **D103 D104 D105** (§0.3)

## Global Constraints

- กฎเหล็กของ dayo ทุกข้อ · **ห้ามแก้ migration เก่า** (สร้างไฟล์ใหม่เท่านั้น) · เลขไฟล์ใหม่เริ่ม **`0062`** (ห้ามใช้ช่องว่าง `0055`-`0060` เพราะ Supabase ใช้ลำดับชื่อไฟล์ และ `0061` ถูก apply แล้ว) · ADR-0066: ในเวลาเดียวกันมี worktree เดียวที่เพิ่ม migration/รันเทสต์ฐาน
- ทุกตารางใหม่: `id uuid` จากแท็บเล็ต · `shop_id` · `api_client_id` · `received_at timestamptz not null default now()` · RLS เปิดไม่มี policy · append-only (trigger raise เมื่อ update/delete ยกเว้นคอลัมน์ที่ระบุ) · เงิน `numeric(10,2)` บาท · อยู่ใน `BACKUP_TABLES` + `backup_dump_table` + `scripts/restore.ts`
- **ไม่มี API ใด (E3 E4 หรืออื่น) คืน `z_reports` หรือส่วนต่าง** · ไม่มีต้นทุน/กำไรใน API (ADR-0040 ข้อ 3)
- **ไฟล์ตัวคิดราคาที่ POS คัดลอก** (`packages/shared/src/{money,promotions,cost,fmt,shopSettings,types,time}.ts`) **อย่าแก้ในก้อนนี้ถ้าไม่จำเป็น** · ค่าตั้งใหม่อ่านผ่านไฟล์ใหม่ (เช่น `shiftSettings.ts`) · ถ้าต้องแก้ ให้รัน `npm run pos:parity` และแจ้งทีม POS (ADR-0048 · POS ต้อง `vendor:update`)
- ข้อความ Discord ไม่มียอดเงิน ชื่อพนักงาน เหตุผลอิสระ หรือ id นอกจากลิงก์หน้ากะ (ค่าเริ่มต้นจนกว่าเจ้าของตอบ Q73)
- เทสต์ฐานรันกับ Supabase local (`npm run db:start`) แบบเดียวกับ `packages/shared/test/db/pos_push.db.test.ts` และ `apps/web/test/api.pos.test.ts` · `npm run ci` ผ่านก่อน commit

---

## 0. ภาพรวม

### 0.1 ลำดับ task และผู้ทำ (ชื่อบทบาทตามทีม dayo)

| Task | งาน | ไฟล์หลัก | ผู้ทำ (dayo) | รอ |
|---|---|---|---|---|
| 0 | ADR: เขียน ADR-0056 ฉบับยอมรับ · แก้ ADR-0024 ข้อ 2 · แก้ ADR-0049 ขั้น (ก0) · GLOSSARY · DATA-CONTRACT | `docs/adr/0056-*.md`, `0024-*.md`, `0049-*.md`, `docs/GLOSSARY.md`, `docs/DATA-CONTRACT.md` | หัวหน้า dayo | — |
| 1 | ตารางกะ 4 ตาราง + trigger + สำรอง | `supabase/migrations/0062_block3_shift_tables.sql`, `apps/web/src/lib/backup.ts`, `scripts/restore.ts` | db-engineer | 0 |
| 2 | `orders` บิลนอกแคตตาล็อก + unique index ใหม่ + แช่แข็งเพิ่ม + `pos_push_rejections` | `0063_block3_orders_off_catalog.sql` | db-engineer | 1 |
| 3 | `shop_settings` + scope `shift:write` | `0064_block3_settings_scope.sql`, `apps/web/src/lib/apiScopes.ts` | db-engineer | 2 |
| 4 | ตัวตรวจแถวรวม: ช่อง id ตามชนิด · scope ต่อแถว · คำนำหน้า `detail` · 23505 · `supported_*` · E1 `last_z_no` | `0065_block3_pos_push_core.sql` | db-engineer | 3 |
| 5 | ตัวรับชนิดกะ 4 ชนิด | `0066_block3_pos_push_shift_kinds.sql` | db-engineer | 4 |
| 6 | ตัวรับ `order_off_catalog` + `order`/`order_void` ก้อน 3 | `0067_block3_pos_push_off_catalog.sql` | db-engineer | 4 |
| 7 | คิดใบปิดกะซ้ำ `dayo_z_recompute` + parity สูตรเงิน | `0068_block3_z_recompute.sql` | db-engineer | 5, 6 |
| 8 | E4 `api_pos_shift_cash` + Route Handler | `0069_block3_shift_cash.sql`, `apps/web/src/app/api/v1/pos/shift-cash/route.ts`, `apps/web/src/lib/api/pos.ts` | db-engineer + web-developer | 4 |
| 9 | แจ้ง Discord ของกะ | `apps/web/src/lib/api/pos.ts`, `packages/shared/src/discordMessages.ts`, `packages/shared/src/shiftAlerts.ts` | web-developer + shared-logic-engineer | 7 |
| 10 | รายงานรองรับบิลไม่รู้ต้นทุน (แดชบอร์ด สรุปประจำวัน Export หน้าดูกำไร `get_order` E3) | `0070_block3_reports.sql`, หน้าเว็บที่เกี่ยว | db-engineer + web-developer | 6 |
| 11 | หน้ากะบนเว็บ + บรรทัดแดชบอร์ด + ค่าตั้ง | `0071_block3_shift_pages.sql`, `apps/web/src/app/(staff)/shifts/[shiftId]/*`, `(staff)/dashboard/*`, `(staff)/settings/system/*` | db-engineer + web-developer | 7, 10 |
| 12 | เทสต์สัญญากับ fixture ของ POS + เกณฑ์ §9 ก้อน 3 + เอกสาร API | `apps/web/test/api.pos.block3.test.ts`, `packages/shared/test/db/block3_*.db.test.ts`, `docs/API.md`, `apps/web/openapi.yaml` | test/qa + web-developer | 5-11 |

เลข migration เป็นข้อเสนอ · ถ้ามีงานอื่นของ dayo เอาเลขไปก่อน ให้เลื่อนตามลำดับ (ADR-0066 ข้อ 4) · ทุก task ที่แตะฐานทำใน worktree เดียวกันทีละ task

### 0.2 จุดที่แผนเสนอ (dayo ตัดสินได้)

| # | เรื่อง | เสนอ | เหตุผล |
|---|---|---|---|
| P1 | ที่เก็บ `closed_by`/`closed_at`/`reason`/`original_reason` ของบิลนอกแคตตาล็อก (P3 ค1) | `audit_log` action `order_off_catalog` · ไม่เพิ่มคอลัมน์ | แช่แข็งอยู่แล้ว · ไม่ได้ส่งออกทาง API |
| P2 | owner แก้บิลนอกแคตตาล็อกบนเว็บ (P3 ค2) | ยกเลิกได้ (ADR-0050) · แก้รายการไม่ได้ (`DY422` "บิลนอกแคตตาล็อกแก้ไม่ได้ ยกเลิกแล้วบันทึกใหม่") | `update_order` คิดราคาจากแคตตาล็อก ซึ่งบิลนี้ไม่มี |
| P3 | ระดับ Discord (P3 ค3) | ขาด/เกินตั้งแต่เกณฑ์ = WARNING · `mismatch` = ERROR · ข้อมูลกะชนกัน = ERROR + `@here` · อื่น WARNING | ตามร่าง |
| P4 | กลไกส่งแจ้งเตือนจาก RPC (P3 ค4) | RPC ใส่รายการ `notices` ภายใน (ไม่อยู่ในคำตอบ API) ผ่านตาราง/คอลัมน์ `alerted_*` · Route Handler ของ push เรียก RPC `pos_pending_notices` หลังตอบแล้วส่งด้วย `ctx.waitUntil` · cron รายชั่วโมงของบอท (`0 * * * *`) กวาดที่ยังไม่ส่ง | `mismatch` เกิดได้ตอนรับแถวของวันหลัง · ไม่เปลี่ยนรูปคำตอบ E2 ที่ล็อกแล้ว · ส่งซ้ำไม่ได้เพราะ `alerted_*` |
| P5 | path หน้ากะ (P3 ค5) | `/shifts/[shiftId]` ใต้ `(staff)` + `requireRole('owner')` · ลิงก์จากบรรทัดกะบนแดชบอร์ด | ตามร่าง |

### 0.3 คำตอบเจ้าของ (D103-D105 · 28 ก.ย. 2569 · ค่าอยู่ที่บรรทัดเดียว)

| # | คำถาม | คำตอบที่แนะนำ (ทีม POS) | ค่าในโค้ดจนกว่าจะตอบ |
|---|---|---|---|
| Q72 | เพดานต่อบิลนอกแคตตาล็อก | ฿3,000 | `off_catalog_max_total numeric(10,2) not null default 3000.00` ใน Task 3 (บรรทัดเดียว) · owner แก้บนเว็บได้ |
| Q73 | ข้อความ Discord ของกะไม่มียอดเงิน | ไม่มียอดเงิน | ตัวสร้างข้อความใน `discordMessages.ts` ไม่รับพารามิเตอร์เงิน (Task 9) |
| Q74 | แจ้งเมื่อ `waiting_bills` เกิน 48 ชม. (ขัด D98) | เปิด: WARNING ครั้งเดียวต่อ Z | **D105**: `export const WAITING_BILLS_ALERT_HOURS: number \| null = 48` ใน `packages/shared/src/shiftAlerts.ts` (แจ้งครั้งเดียวต่อ Z) |

---

## Task 0: ADR และเอกสาร

- [ ] เขียน `docs/adr/0056-pos-shifts-cash-drawer.md` ใหม่เป็นฉบับ **ยอมรับ** จากร่าง P3 (ส่วน "ตัดสินใจ" ข้อ 1-11 · ทางเลือกที่ไม่เลือก · ผลที่ตามมา 5 ตาราง) · ระบุ P1-P5 ที่ตัดสิน · อ้าง Q72-Q74 เป็นค่าเริ่มต้นรอเจ้าของ
- [ ] ADR-0024 ข้อ 2 เพิ่มตามร่าง P3 "สิ่งที่ dayo ต้องตัดสิน" ข้อ 2 (กะมีเฉพาะที่แท็บเล็ต · บอทไม่มีคำสั่งกะ)
- [ ] ADR-0049 ข้อ 3 ขั้น (ก0) `pos_excluded_orders` → ยกเลิก แทนด้วย `order_off_catalog` (ADR-0056)
- [ ] GLOSSARY: กะ · ช่องกะ · ใบปิดกะ (Z) · บิลนอกแคตตาล็อก · รอบิล/ตรง/ไม่ตรง · เงินที่ควรมี · บิลไม่รู้ต้นทุน
- [ ] DATA-CONTRACT: ตารางใหม่ + สูตรเงินที่ควรมี · commit `docs(adr): accept ADR-0056 shifts, cash and Z`

## Task 1: `0062_block3_shift_tables.sql` · ตารางกะ

สเปก §4.10 "ตาราง/คอลัมน์ใหม่ฝั่ง dayo"

- `shifts` (`id` pk = `shift_id` · `shop_id` · `api_client_id` · `business_date` · `opened_by` · `opened_at` · `opening_float ≥ 0` · `quick_open` · `status` `open`/`counted`/`closed` (เดินหน้าเท่านั้น · แสดงผล) · `closed_by` · `closed_at` (ตั้งครั้งเดียวจาก null) · `data_conflict bool default false` (ตั้งได้เฉพาะฟังก์ชันตรวจชน) · `received_at`) · **ไม่มี unique กะ open ต่อ key** (C3)
- `cash_movements` (`kind` check 4 ค่า · `amount > 0` · check `(kind = 'VOID_REFUND') = (pos_order_id is not null)` · `reason` · `created_by` · `created_at` เวลาเครื่อง)
- `cash_counts` (`shift_id` unique · `lines jsonb` · `counted ≥ 0` · `counted_by` · `counted_at`) · ไม่มี `expected`/`variance`/`reason`
- `z_reports` (ทุกคอลัมน์ตาม §4.10 · unique `shift_id` · unique `(api_client_id, z_no)` · `recompute_status` check 3 ค่า · trigger ยอมให้แก้เฉพาะ `recompute_status z_mismatch recompute_detail missing_* waiting_since recomputed_at chain_break recompute_notes alerted_*` เมื่อ `current_setting('dayo.z_recompute', true) = 'on'`)
- ดัชนี: `(shop_id, api_client_id, id)` ทุกตาราง (S4) · `cash_movements (shift_id)` · `cash_movements (pos_order_id)` · `z_reports (api_client_id, z_no)`
- trigger append-only ลอกรูปของ `stock_movements` · `dayo_restoring()` ข้ามได้เหมือน `orders_pos_frozen`
- `BACKUP_TABLES` เพิ่ม 4 ตาราง (หลัง `orders`) · `backup_dump_table` ลอกรุ่นล่าสุด (`0051:1960`) + 4 ตาราง · `scripts/restore.ts`
- [ ] **เทสต์ล้มก่อน** (`packages/shared/test/db/block3_tables.db.test.ts`): แก้/ลบแถวทุกตาราง = raise · `recompute_status` แก้ได้เฉพาะเมื่อเปิดสวิตช์ฟังก์ชันคิดซ้ำ · `backup.tables.test.ts` มีตารางใหม่ · `status` ถอยหลังไม่ได้ · commit `feat(db): add block 3 shift tables (ADR-0056)`

## Task 2: `0063_block3_orders_off_catalog.sql`

- `orders`: `off_catalog boolean not null default false` · `off_catalog_lines jsonb` · check `off_catalog = (cost_total is null)` (แก้ not null ของ `cost_total` ถ้ามี) · **ตรวจคู่ซ้ำ `(shop_id, pos_order_id)` ก่อน** (มี = raise พร้อมข้อความให้แก้ข้อมูล) แล้ว `drop index orders_api_client_pos_order_key` (`0051:38`) · `create unique index orders_shop_pos_order_key on orders (shop_id, pos_order_id) where pos_order_id is not null` (R4-2)
- `dayo_orders_pos_frozen` (ลอก `0051:95-114`) + แช่แข็ง `pos_shift_id` และ `external_ref` ของบิล POS (R-m8)
- `pos_push_rejections` (`shop_id` `api_client_id` `pos_order_id` `reason` `first_at` · unique สามคอลัมน์ · ดัชนี `(shop_id, pos_order_id)` · RLS · สำรอง)
- `create_order` เก็บคีย์ `payment` ใน `pos_reported_amounts` ของบิล POS ใหม่ (D93)
- [ ] **เทสต์ล้มก่อน**: บิล POS เดียวกันจากสอง key = 23505 · แก้ `pos_shift_id` ของบิล POS = `DY423` · `off_catalog=false` + `cost_total null` = check · บิลใหม่มี `pos_reported_amounts.payment` · commit `feat(db): off-catalog columns and shop-wide pos_order_id key (R4-2)`

## Task 3: `0064_block3_settings_scope.sql`

- `shop_settings.block3_live_from date` (ตั้งอัตโนมัติ · owner แก้บนเว็บได้เฉพาะเป็นวันที่เก่ากว่าเดิม + `audit_log` · ห้ามล้าง) · `shop_settings.off_catalog_max_total numeric(10,2) not null default 3000.00 check (> 0)` (**Q72 · บรรทัดเดียว**)
- `api_clients_scopes_check` ลอก `0053:28-30` + `shift:write` · `dayo_check_api_scopes` ลอกรุ่นล่าสุด · `apps/web/src/lib/apiScopes.ts` เพิ่ม `shift:write` (ติ๊กไว้ล่วงหน้าในฟอร์มสร้างคีย์ใหม่ของแท็บเล็ต · dayo ตัดสิน)
- `save_shop_settings`/`get_shop_settings` ลอกรุ่นล่าสุด + สองค่า · ค่าตั้งอ่านจาก `packages/shared/src/shiftSettings.ts` ใหม่ (ไม่แก้ `shopSettings.ts` ที่ POS คัดลอก)
- [ ] **เทสต์ล้มก่อน**: ตั้ง `block3_live_from` ให้ใหม่กว่าเดิม = `DY422` · เก่ากว่า = ผ่าน + audit · scope `shift:write` สร้างคีย์ได้ · commit `feat(db): block 3 settings and shift:write scope`

## Task 4: `0065_block3_pos_push_core.sql` · ตัวตรวจแถวรวม

ลอก `dayo_pos_push_row` (`0052:539-630`) · `dayo_pos_map_error` (`0052:632-690`) · `dayo_pos_supported` (`0049:235-251`) · `api_pos_catalog` (`0049`) รุ่นล่าสุด

- `dayo_pos_supported()`: `kinds` + 5 ชนิด · `fields` ของทุกชนิดตาม §4.10 (รวม `lines.denomination` `lines.count` ของ `cash_count` และ `lines.*` ของ `order_off_catalog`) · ชื่อที่นี่ต้องตรงกับที่ RPC รับจริง (เทสต์ ADR-0049 ข้อ 7 เดิม)
- ลำดับตรวจ = เดิม (`0052:560-620`) โดย: (ก) หลังขั้น `orders:write` เพิ่ม "ชนิดกะ และ `shift:write` ไม่อยู่ใน scope → `rejected FORBIDDEN 'scope: …'`" · (ข) ขั้น uuid/key ใช้ช่อง id ตามชนิด (`pos_order_id` · `shift_id` · `movement_id` · `count_id`)
- dispatch ไป `dayo_pos_order` · `dayo_pos_void` · `dayo_pos_shift_open` · `dayo_pos_cash_movement` · `dayo_pos_cash_count` · `dayo_pos_shift_close` · `dayo_pos_order_off_catalog`
- คำนำหน้า `detail` (ล็อก): `scope:` `role:` `rule:` `exists:` `off_catalog_exists:` `receipt_taken:` `key_changed:` `counted:` `z_no_taken:` · CONFLICT ของ key เดิมเนื้อหาต่าง (`0052:616`) = `key_changed:` · ของ `external_ref_taken` = `receipt_taken:`
- `api_pos_push` เมื่อแถว `order` ได้ `rejected`: แทรก `pos_push_rejections` **นอก savepoint ของแถว** (on conflict do nothing) · ข้อมูลกะชนกัน (S5): `audit_log` (sha256 สองชุด) + ตั้ง `shifts.data_conflict` นอก savepoint
- `dayo_pos_map_error` 23505: `order`/`order_off_catalog` หาใหม่ด้วย `(shop_id, pos_order_id)` ตามกติกา m3 · ชนิดกะหาใหม่ด้วย `(api_client_id, id)` · ไม่เจอ = `CONFLICT` คำนำหน้าที่ตรง (`counted:`)
- เพดานรายการ `pos_bills` ≤ 2000 · `bot_bills` ≤ 500 · `movement_ids` ≤ 500 = `rejected INVALID`
- `api_pos_catalog`: `client` เพิ่ม `last_z_no`/`last_z_hash` จาก Z เลขสูงสุดของ key (R4-1)
- [ ] **เทสต์ล้มก่อน** (`block3_push_core.db.test.ts`): key ไม่มี `shift:write` → แถวกะ `FORBIDDEN scope:` ขณะบิลในคำขอเดียวกัน `accepted` · ฟิลด์ไม่รู้จักในชนิดใหม่ = `UNSUPPORTED` · `supported_fields` = ที่ RPC รับ · `order` เดิมทุกเทสต์ใน `pos_push.db.test.ts` ยังผ่าน (เปลี่ยนแค่คำนำหน้า `detail`) · E1 ให้ `last_z_no` · commit `feat(db): per-kind id, scope and detail prefixes in pos push`

## Task 5: `0066_block3_pos_push_shift_kinds.sql` · ชนิดกะ 4 ชนิด

ตามตาราง `shift_open` `cash_movement` `cash_count` `shift_close` + `z_report` และกติการ่วมของ §4.10 (เวลา CLOCK_AHEAD +5 นาที/INVALID −60 วัน · พนักงาน active/removed · owner active ณ เวลาในแถว · ขอบเขต key S4 · PARENT_PENDING · `duplicate` เมื่อ id เดิม key เดียวกัน · ผล `data` ตามที่ล็อก · `shift_close` คืน `{shift_id}` เท่านั้น)

- `shift_open`: หลังรับ ตั้ง `block3_live_from` ครั้งเดียวเมื่อยังว่างและ `business_date ≥ วันนี้ − 1` (D100 · m5) · key มีกะเกิน 3 กะในวันเดียว → notice WARNING
- `cash_movement`: `created_at ≥ opened_at` · ถ้ากะมี `cash_count` แล้วต้อง `≤ counted_at`
- `cash_count`: กะละครั้ง (`counted:`) · `counted` = Σ · ตั้ง `shifts.status = 'counted'`
- `shift_close`: `count_id` ตรง · `z_report.counted` = `cash_counts.counted` (ไม่ตรง = `INVALID` + S5) · `bot_window.until = counted_at` · กติกาลำดับ `z_no` ข้อ 0-6 (R3-B · R4-M) · เก็บ `snapshot` ตรงตัว · `expected`/`variance` คิดเองจาก `snapshot.cash` · ตั้ง `shifts.status='closed'` `closed_by` `closed_at` · เรียก `dayo_z_recompute` ของ Z นี้และ `z_no + 1` (ตัวแทนว่างใน task นี้ · เติมจริงใน Task 7)
- [ ] **เทสต์ล้มก่อน**: ทุกเกณฑ์ §9 ก้อน 3 ที่เป็นคำตัดสินของแถวกะ (ส่งซ้ำ = `duplicate` · แม่ของ key อื่น = `FORBIDDEN rule:` · `z_no` ซ้ำ = `CONFLICT z_no_taken:` + notice ERROR + `data_conflict` · `z_no` > สูงสุด+50 = `INVALID` · `closed_by` ไม่ใช่ owner = `FORBIDDEN role:` · นับออฟไลน์ → `shift_open` กะถัดไป → `shift_close` กะแรก = ทุกแถว `accepted` · `block3_live_from` ตั้งครั้งเดียว · `shift_open` ที่ rejected ไม่ตั้ง) · commit `feat(db): accept shift, cash and count push rows`

## Task 6: `0067_block3_pos_push_off_catalog.sql`

ตาม "`order_off_catalog`" และ "กติกาฝั่ง dayo ของ `order_off_catalog` ข้อ 0-4" ของ §4.10

- กันซ้ำข้อ 0 (1)-(5) ครบ · พื้นล่าง `sold_at ≥ 00:00 ไทยของ block3_live_from` (ว่าง = ปฏิเสธ) · ไม่ใช้เพดาน 60 วันกับ `sold_at` (ใช้กับ `closed_at`) · เพดาน `off_catalog_max_total` · ต้องมีแถว `pos_push_rejections` ของ `(shop_id, pos_order_id)` และ `original_reason` เป็นเหตุผลใดก็ได้ที่บันทึกไว้
- แทรก `orders` 1 แถว ตามข้อ 1 (`source='pos'` · `off_catalog=true` · `cost_total null` · `pos_computed_total null` · `channel_fee_amount` · ไม่มี `order_items`/`order_promotions` · ไม่ตัดสต็อก · `order_no` จากตัวออกเลขเดียวกับ `create_order`) · `audit_log` action `order_off_catalog` (P1) · notice WARNING "มีบิลนอกแคตตาล็อกใหม่" (ไม่มียอด)
- `order` ของบิลที่เป็นนอกแคตตาล็อกแล้ว = `CONFLICT off_catalog_exists:<order_no>` + `data` `{order_no, version, reported_total, payment_is_cash, off_catalog}` · `order_off_catalog` ของบิลปกติ = `CONFLICT exists:<order_no>` + `data`
- `cancel_order` รองรับบิลที่ไม่มี `order_items` · `update_order` ปฏิเสธบิลนอกแคตตาล็อก (P2)
- [ ] **เทสต์ล้มก่อน**: ทุกเกณฑ์ §9 ก้อน 3 ของบิลนอกแคตตาล็อก (รวม R4-2 ข้าม key · `block3_live_from` เก่ากว่า 60 วันใน fixture · `original_reason` ใดก็ได้ · เปลี่ยนกุญแจแล้วรับ) · commit `feat(db): accept order_off_catalog rows (ADR-0056)`

## Task 7: `0068_block3_z_recompute.sql` · คิดใบปิดกะซ้ำ + parity สูตรเงิน

ตาม "การคิดใบปิดกะซ้ำของ dayo" ข้อ 1-7 และลำดับ R3-A ของ §4.10 · ใช้เวลาจากเครื่อง ห้ามใช้ `orders.created_at` · หาแถวด้วย `(shop_id, api_client_id, id)`

- `dayo_z_recompute(p_z_id uuid)`: ตรวจรายแถวเสมอ (บิล · เงินเข้า-ออก · `VOID_REFUND` R3-m9 · ชุดบิลบอทด้วยคำค้นแบบ E4 · `bot_window.after` · โซ่ Z) → เทียบผลรวมกับ `snapshot.cash` เมื่อไม่มีอะไรขาด → `mismatch`/`waiting_bills`/`matched` · `waiting_since` ครั้งแรก · ตั้งสวิตช์ `dayo.z_recompute` ภายในฟังก์ชันเท่านั้น
- เรียกจาก: รับ `shift_close` (+ `z_no + 1`) · รับ `order`/`order_off_catalog`/`order_void`/`cash_movement` ที่เกี่ยวกับกะที่มี Z แล้ว · owner ยกเลิกบิล POS ที่อยู่ใน `missing_void_order_ids` บนเว็บ (ธุรกรรมเดียวกัน)
- เปลี่ยน **เข้า** `mismatch` → notice ERROR ครั้งเดียวต่อการเปลี่ยน (`alerted_mismatch_at`) · `|variance| ≥ z_report.variance_alert` → notice WARNING ครั้งเดียวต่อ Z (`alerted_variance_at`) · `waiting_bills` เกิน `WAITING_BILLS_ALERT_HOURS` → notice WARNING ครั้งเดียวต่อ Z (D105 · ตรวจตอน cron กวาด · คอลัมน์ `alerted_waiting_at`)
- **parity**: เทสต์ SQL อ่าน `pos-management/packages/domain/test/fixtures/z-cash-parity.json` (ทีม POS ส่งสำเนาให้ วางที่ `packages/shared/test/fixtures/z-cash-parity.json` · POS เป็นเจ้าของ D84) → ทุกเคส `expected`/`variance` ต่าง 0 สตางค์ รวมติดลบ
- [ ] **เทสต์ล้มก่อน**: ทุกเกณฑ์ §9 ก้อน 3 ของการคิดซ้ำ (บิลบอท 3 ใบ `matched` · Z มาก่อนบิล `waiting_bills` → `matched` เอง · ขายเงินสดแล้วคืน `matched` · owner แก้บิล ฿100→฿80 ยัง `matched` · `after` ไม่ตรง Z ก่อน `mismatch` · บิลบอทที่ไม่อยู่ใน `bot_bills` `mismatch` · `movement_ids` ของกะอื่น `mismatch` · `VOID_REFUND` เกินยอดบิล `mismatch` · ยอดต่างขณะบิลอื่นยังไม่มา `mismatch` ทันที · Z 5 ปิดในเครื่องแล้ว Z 6 มา = ข้อสังเกต · เติมช่อง Z 5 แล้ว Z 6 คิดซ้ำ · `RECEIPT_RENUMBERED` หลังออก Z ยัง `matched`) · commit `feat(db): recompute Z reports from stored rows (ADR-0056)`

## Task 8: E4 `GET /v1/pos/shift-cash`

- `0069_block3_shift_cash.sql`: `api_pos_shift_cash(p_shop_id, p_api_client_id, p_scopes, p_after, p_until)` · scope `orders:read` · บิล `status='ok'` วิธีชำระ `cash` `source in ('line','web')` `created_at ∈ (after, until]` → `{bills:[{order_no, version, source, sold_at, total, created_by_name}], cash_total}` · `created_by_name` null เมื่อไม่มี `staff:read` · ไม่มีต้นทุน · `after < until` ไม่ใช่ = `DY422`
- Route Handler `apps/web/src/app/api/v1/pos/shift-cash/route.ts` ลอกรูป `pos/push/route.ts` (`apiHandler` · `authenticate(req, 'orders:read')` · CORS + `OPTIONS` · ข้อความ JSON สำเร็จรูปจาก RPC)
- [ ] **เทสต์ล้มก่อน** (`api.pos.block3.test.ts`): ขอบ `(after, until]` · ไม่มี `staff:read` = ชื่อ null · 401/404/429 มีหัว CORS ครบแบบ E1/E2 · commit `feat(api): add GET /v1/pos/shift-cash (E4)`

## Task 9: แจ้ง Discord ของกะ

- `packages/shared/src/shiftAlerts.ts`: `WAITING_BILLS_ALERT_HOURS: number | null = 48` (**D105 · บรรทัดเดียว**) + ตัววางแผนการแจ้ง (บริสุทธิ์ มีเทสต์)
- `packages/shared/src/discordMessages.ts`: ข้อความ "กะ <วันที่> เงินไม่ตรงเกินเกณฑ์ · ดูที่ /shifts/<id>" · "ใบปิดกะไม่ตรงกับระบบกลาง" · "ข้อมูลกะชนกัน · ตรวจกุญแจเครื่อง" (`@here`) · "มีบิลนอกแคตตาล็อกใหม่ N ใบ" · "กุญแจเครื่องไม่มีสิทธิ์ shift:write" (วันละครั้งต่อ key) · "กะซ้อนกัน" · **ไม่มีพารามิเตอร์เงิน** (Q73)
- `apps/web/src/lib/api/pos.ts`: หลังตอบ push เรียก RPC `pos_pending_notices` แล้วส่งผ่าน `ctx.waitUntil` (P4) · `apps/line-bot` cron รายชั่วโมงกวาดที่ค้าง
- [ ] **เทสต์ล้มก่อน**: ส่วนต่าง −฿20.00 แจ้ง · −฿19.99 ไม่แจ้ง · ตั้ง `variance_alert` ฿50 ส่วนต่าง ฿30 ไม่แจ้ง · ส่ง `shift_close` ซ้ำไม่แจ้งซ้ำ · ทุกข้อความไม่มีตัวเลขเงิน (regex `฿|\d+\.\d{2}`) · commit `feat(alerts): Discord notices for shifts without amounts`

## Task 10: `0070_block3_reports.sql` · รายงานรองรับบิลไม่รู้ต้นทุน (D97)

ลอกรุ่นล่าสุดของ `dashboard_summary` `dashboard_breakdown` `daily_digest` Export หน้าดูกำไร (`0053_profit_view.sql`) `get_order` `list_api_orders` (`0052:785-848`)

- ยอดขาย/จำนวนบิลรวมบิลนอกแคตตาล็อก · ต้นทุน/กำไรขั้นต้นไม่รวม + บรรทัด "บิลไม่รู้ต้นทุน N ใบ · ยอด ฿X" · GP% หารด้วยยอดขายที่รู้ต้นทุน (0 = "—") · จำนวนแก้วรวม qty ของ `off_catalog_lines` · อันดับเมนูไม่รวม · `get_order.gross_profit` null · หน้าบิลแสดงป้าย "บิลนอกแคตตาล็อก" และ "ไม่ทราบ" · E3 เพิ่ม `off_catalog`
- [ ] **เทสต์ล้มก่อน**: แดชบอร์ดกับหน้าดูกำไรตรงกันเมื่อมีบิลนอกแคตตาล็อก 1 ใบ · ห้ามถือต้นทุนเป็น 0 · commit `feat(reports): keep off-catalog bills out of cost and profit (D97)`

## Task 11: หน้ากะบนเว็บ + แดชบอร์ด + ค่าตั้ง (D99)

- `0071_block3_shift_pages.sql`: `dashboard_shifts(p_shop_id, p_staff_id, …)` และ `shift_detail(p_shop_id, p_staff_id, p_shift_id)` raise `DY403` เมื่อไม่ใช่ owner · `today_mini` คืนแค่สถานะกะ เปิด/ปิด
- แดชบอร์ด owner (`OwnerDashboardClient.tsx`): 1 บรรทัดต่อกะ + ป้าย "ไม่ตรง" / "รอบิล N ชม." / "โซ่ Z ขาด" / "Z ขาดช่วง" / "ข้อมูลชนกัน" / "เจ้าของแก้ N บิล" + ป้ายนับบิลนอกแคตตาล็อก
- `/shifts/[shiftId]` (owner อ่านอย่างเดียว): ธนบัตรแต่ละชนิด · เงินเข้า-ออก · องค์ประกอบเงินที่ควรมี · บิลบอทที่ถูกนับ · บิล POS · ส่วนต่าง + เหตุผล · สถานะคิดซ้ำ + แถวที่ยังไม่มาพร้อมอายุและเหตุผลการรอ · `recompute_detail` · เกณฑ์ที่ใช้ (ป้ายเมื่อต่างจาก Z ก่อน) · บรรทัด "เจ้าของแก้บิลหลังขาย" (D93) · รายการเสริม "บิลบอทนอกใบปิดกะ" / "เปลี่ยนหลังนับ" / "เปลี่ยนจากเงินสดก่อนนับ" / "กะซ้อนกัน"
- ตั้งค่าระบบ (`settings/system`): `off_catalog_max_total` · `block3_live_from` (เลือกได้เฉพาะวันที่เก่ากว่า)
- [ ] **เทสต์ล้มก่อน**: RPC หน้ากะด้วย manager/staff = `DY403` · e2e owner เห็นหน้า manager ถูกปฏิเสธ · commit `feat(web): owner shift pages and dashboard line (D99)`

## Task 12: เทสต์สัญญากับ fixture ของ POS + เอกสาร

- รับชุด `pos-management/packages/contracts/fixtures/dayo-api/b3-*.json` (POS เป็นเจ้าของ · D84) ไปเป็นเทสต์ Route Handler ใน `apps/web/test/api.pos.block3.test.ts` · ต่างจากคำตอบจริง = แจ้งทีม POS พร้อมคำตอบจริง (POS แก้ fixture ใน Task 18 ของแผน 08)
- ไล่เกณฑ์ §9 ก้อน 3 ทุกข้อเป็นรายการตรวจ (ติ๊กเมื่อมีเทสต์)
- `docs/API.md` · `apps/web/openapi.yaml` · `docs/HANDOFF.md` · `docs/SETUP.md` (สร้างคีย์ที่มี `shift:write`)
- `npm run ci` ผ่าน · `npm run db:push` ขึ้น production **ถามเจ้าของก่อน** · commit `test(api): cover block 3 contract fixtures`

---

## ส่งต่อทีม POS

เมื่อ Task 0-12 ผ่านบน dayo local: เจ้าของแจ้งทีม POS เพื่อเริ่ม Task 18 ของแผน 08 (เชื่อมจริง) · ส่ง commit ของ dayo · ผลเทสต์ parity สูตรเงิน · คำตอบจริงที่ต่างจาก fixture
