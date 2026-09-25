# ก้อน 1 (ฝั่ง dayo) — เปิด `/api/v1` ให้ POS · E1/E2/E3 · ธงบิลซ้ำ · สำรองอัตโนมัติ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **แผนนี้ทำใน repo dayo** (`D:\TungAo-Project\line-bot\dayo-shop-system`) โดย session ของ dayo ด้วยทีมของ dayo (`docs/TEAM-WORKFLOW.md`) — หัวหน้าทีม (Opus) แจกงานตามตาราง "ลำดับและงานขนาน" · ทีม POS **ไม่แก้ไฟล์ใน repo dayo** · path ทุกตัวในแผนนี้เป็น path ใน repo dayo ยกเว้นที่ขึ้นต้นด้วย `POS:`

**Goal:** ให้ระบบกลาง dayo พร้อมรับแท็บเล็ต POS ตามสัญญาก้อน 1–2 ที่ล็อกแล้ว — `GET /v1/pos/catalog` (E1), `POST /v1/pos/push` (E2) ชนิด `order`/`order_void` พร้อมคำตัดสินรายแถว, ฟิลด์ใหม่ของ `GET /v1/orders` (E3), CORS, แหล่ง/ผู้บันทึกของบิล, ธงบิลน่าจะซ้ำ, รหัสที่ถูกอ้างเปลี่ยนไม่ได้ และสำรองฐานข้อมูลอัตโนมัติทุกคืนไป OneDrive — โดย `API_V1_ENABLED` **ยังปิดใน production** จนก้อน 2 ผ่าน

**Architecture:** งานหนักทั้งหมดอยู่ใน migration ใหม่ 4 ไฟล์ (RPC `api_pos_catalog`, `api_pos_push` ทำทุกแถวใน savepoint ของตัวเอง แปลง error ทุกชนิดเป็นคำตัดสินรายแถว) · Route Handler ทำแค่ตรวจ key + เรียก RPC ก้อนเดียว (กฎเหล็กข้อ 11) · CORS ทำที่จุดเดียวใน `apiHandler(req, fn)` · ไฟล์ fixture สัญญา (JSON) ชุดเดียวใช้เทสต์ Route Handler ของ dayo และคัดลอกไปเป็น fixture/mock server ของ POS · สำรองข้อมูลเป็น GitHub Actions (`pg_dump` → `gpg` → `rclone` → OneDrive) แจ้ง Discord ช่องระบบเมื่อล้ม

**Tech Stack:** Supabase Postgres 17 (plpgsql) · Next.js 16 App Router บน Cloudflare Workers (OpenNext) · TypeScript strict · Vitest 4 · npm workspaces (`@dayo/web`, `@dayo/shared`, `@dayo/line-bot`) · GitHub Actions (ubuntu-24.04, `postgresql-client-17`, rclone, gpg, gh)

**Spec:** POS `docs/design/04-สเปกการเชื่อม-POS-กับ-dayo.md` (§4.1–4.9, §4.11, §5.2–5.3, §6.6–6.7, §7, §8, §9 แถวก้อน 1, §10, §13) + ร่าง ADR POS `docs/design/dayo-adr-drafts/P1-*.md`, `P2-*.md`, `P7-*.md` — เจ้าของส่งสำเนาทั้ง 4 ไฟล์ให้ session dayo ก่อนเริ่ม (Task 0) · executor อ่านสเปก + ร่าง ADR ก่อนทุก task

## Global Constraints

ค่าต่อไปนี้ลอกจากสเปก 04 ตรงตัว — ทุก task ต้องเป็นไปตามนี้โดยไม่ต้องเขียนซ้ำ

- ฐานเดียว = Supabase ของ dayo · แท็บเล็ตคุยผ่าน `/api/v1/*` เท่านั้น · งานหนักอยู่ใน RPC · Route Handler = ตรวจ key + RPC ก้อนเดียว (CPU 10 ms, subrequest ≤ 50 — ADR-0036)
- `/api/v1/**` ตอบ 404 เมื่อ `API_V1_ENABLED` ไม่ใช่ `1` (ADR-0042) · **production ยังปิด** ตลอดก้อนนี้
- ยืนยันตัว `Authorization: Bearer <api_key>` · 1 เครื่อง = 1 key · อัตรา 60 คำขอ/นาที/key · เกิน = 429 + `Retry-After`
- scope ใหม่ `staff:read` · E1 ต้องมี `catalog:read` **และ** `staff:read` · E2 ชนิด `order`/`order_void` ต้องมี `orders:write` (ตรวจต่อแถว) · E3 `orders:read`
- CORS: origin ที่อนุญาต = env `POS_ORIGINS` (คั่นจุลภาค) · **ทุกคำตอบใต้ `/api/v1/*` รวม error ทุกชนิด** (404 จากสวิตช์, 401, 403, 422, 429, 5xx) มี `Access-Control-Allow-Origin: <origin ที่ตรง>` + `Vary: Origin` + `Access-Control-Expose-Headers: Retry-After` · `OPTIONS` ตอบ **204 เสมอ** (แม้ API ปิด · ไม่แตะฐานข้อมูล) พร้อม `Access-Control-Allow-Headers: Authorization, Content-Type` · `Access-Control-Allow-Methods: GET, POST, OPTIONS` · `Access-Control-Max-Age: 7200` · origin ที่ไม่อยู่ในรายการ = ไม่มีหัว CORS · ทำที่จุดเดียวใน `apps/web/src/lib/api/response.ts` (`apiHandler`)
- รูปคำตอบ `{ "ok": true, "data": … }` หรือ `{ "ok": false, "error": { "code": "DY422", "message": "…" } }`
- เวลาส่งเข้า = ISO-8601 UTC มีมิลลิวินาที (`2026-09-25T03:15:03.120Z`) · เวลาส่งออก = ISO-8601 (`…+00:00`) · วันขาย `YYYY-MM-DD` เวลาไทย (Asia/Bangkok)
- เงิน = บาท เลข JSON ทศนิยม ≤ 2 ตำแหน่ง · `priceMarkupPct`/`feePct` = สัดส่วน (`0.30`) · ส่วนลด `percent` = ร้อยละ (`10`) — ห้ามสลับ
- ข้อความ UTF-8 · ห้าม C0 และ DEL · ความยาวนับ code point · `reason`/`note`/`description` ≤ 200 · id = UUID ตัวเล็ก `8-4-4-4-12`
- ฟิลด์/ชนิดที่ dayo ยังไม่รู้จักในคำขอ = `deferred UNSUPPORTED` · **dayo deploy ก่อน POS เสมอ**
- `detail` ≤ 500 code point · สะท้อนได้เฉพาะ วันที่/เวลา รหัสเมนู-ช่องทาง-วิธีชำระ เลขใบเสร็จ SQLSTATE · **ห้าม** id พนักงาน ข้อความอิสระ (`note`/`reason`) ข้อความ error ดิบของ Postgres
- E2: ≤ 20 แถว · body ≤ 256 KB · ซองผิด = 422 `DY422` ทั้งคำขอ · ปัญหาในแถว = คำตัดสินของแถวนั้นเสมอ · error ของแถวไม่เป็น 5xx
- กันซ้ำ: `api_idempotency_keys` (`endpoint='pos_push'`, `request_hash = sha256(data::jsonb::text)`) เก็บ **เฉพาะ `accepted`/`duplicate`** · ตรวจ hash ของ key **ก่อน** ขั้น (ก)(ข)(ค) เสมอ · `receipt_no` เดิม + `pos_order_id` ต่าง = `CONFLICT` เสมอ ห้ามเป็น `duplicate`
- ธงซ้ำ: `status='ok'` ทั้งคู่ · `source` ต่างกัน · `sale_date` เดียวกัน · `|sold_at_A − sold_at_B| ≤ 10 นาที` · `total_amount` เท่ากัน · `items_signature` เท่ากัน · **ไม่บล็อกการบันทึก**
- บิล `source='pos'` แก้/ยกเลิกจากเว็บ/บอทไม่ได้แม้ owner (`DY403 pos_bill_read_only`)
- ค่าลับทั้งหมดเจ้าของถือ · agent ห้ามอ่าน `.env*` / `.dev.vars` / `backups/` · ขั้นที่มี ⛔ **เจ้าของทำเอง**
- กฎเหล็กของ dayo ใช้ครบ: migration ใหม่เท่านั้น (ห้ามแก้ไฟล์เก่า) · หลังแก้ schema รัน `npm run db:types` · RLS เปิดไม่มี policy · `npm run ci` ผ่านก่อน commit · **commit เมื่อเจ้าของสั่งเท่านั้น** (กฎเหล็กข้อ 18) และใช้ skill `committing-code` ทุกครั้ง · `db:push` = production ถามเจ้าของก่อนทุกครั้ง
- ห้ามเปลี่ยนสัญญา §4 ของสเปกเอง — ถ้าต้องเปลี่ยน: หยุด แจ้งเจ้าของ ทีม POS แก้สเปกก่อน แล้วทั้งสองฝั่งทำตาม

---

## File Structure

### ฐานข้อมูล (`supabase/`) — lane A (db-engineer)
| ไฟล์ | หน้าที่ |
|---|---|
| `supabase/migrations/0048_pos_catalog_version.sql` | `catalog_versions` + trigger 12 ตาราง · scope `staff:read` · `dayo_iso_ms` · `dayo_pos_supported()` · `api_pos_catalog` |
| `supabase/migrations/0049_pos_bill_source_duplicates.sql` | คอลัมน์ใหม่ `orders` · `order_duplicate_flags` · ลายเซ็นรายการ + ตรวจซ้ำ · `dayo_impl_create_order` (ลอก+แก้) · `dayo_require_actor` (รับ removed ผ่าน API) · `dayo_check_order_edit` (บิล POS อ่านอย่างเดียว) · `dayo_order_cancel_core` + `cancel_order` · `update_order` ตัวห่อ · ล็อกรหัสที่ถูกอ้าง · `backup_dump_table` |
| `supabase/migrations/0050_pos_push_checks.sql` (Task 3a) | `dayo_impl_price_line` (ตัวเลือกที่ปิดแล้ว + ไม่บีบ qty บิล POS) · `dayo_quote` · `dayo_impl_quote` · `dayo_quote_priced` + `dayo_promo_eligible` (โปรที่ปิดหลังขาย) · ตัวตรวจรูป · `dayo_pos_unknown_fields` · `dayo_pos_verdict` · `dayo_pos_error_verdict` |
| `supabase/migrations/0051_pos_push.sql` (Task 3b) | `dayo_pos_apply_order/void` · `dayo_pos_after_unique` · `dayo_pos_push_row` · `api_pos_push` · `api_idempotency_keys.endpoint += 'pos_push'` · ธงทดสอบผ่าน GUC `dayo.test_faults` (ไม่มีตาราง) |
| `supabase/migrations/0052_pos_reads_backup_log.sql` (Task 4) | `api_list_orders` · `list_orders`/`get_order` ตัวห่อ · `bot_recent_orders` · `dashboard_duplicate_flags` · `resolve_duplicate_flag` · `duplicate_flags_open_count` · `dashboard_pos_diffs` · CHECK `audit_log.action` ใหม่ · `backup_log.kind += 'auto'` + `bytes` · `backup_log_auto` |
| `packages/shared/test/db/posParity.ts` (Task 1 — เจ้าของคนเดียว) | แคตตาล็อก + เคส parity §5.3 (ใช้ทั้งเทสต์ฐานข้อมูล เทสต์ parity และสคริปต์ export) |
| `packages/shared/test/db/pos_checks.db.test.ts` (Task 3a) | เทสต์ตัวตรวจรูป · ตารางแผนที่ error · โปรที่ปิดหลังขาย |
| `supabase/seed.sql` (แก้) | เพิ่ม `alter database postgres set dayo.test_faults = 'on';` (seed รันเฉพาะเครื่อง — `db:push` ไม่รัน seed · PostgREST/service_role ตั้ง GUC ระดับฐานไม่ได้) |
| `supabase/manual/backup-role.sql` | ⛔ SQL ที่เจ้าของรันเองใน SQL editor (สร้าง role `dayo_backup`) — ไม่ใช่ migration |
| `packages/shared/test/db/pos_catalog.db.test.ts` | เทสต์ E1/ฉบับแคตตาล็อก |
| `packages/shared/test/db/pos_bills.db.test.ts` | เทสต์คอลัมน์ใหม่ ธงซ้ำ อ่านอย่างเดียว ล็อกรหัส |
| `packages/shared/test/db/pos_push.db.test.ts` | เทสต์ E2 ครบเกณฑ์ก้อน 1 (+ เล่น fixture ซ้ำกับฐานจริง) |
| `packages/shared/test/db/pos_reads.db.test.ts` | เทสต์ RPC อ่าน + `backup_log_auto` |
| `packages/shared/test/db/posFixtures.ts` | อ่าน fixture สัญญาจาก `apps/web/test/fixtures/pos-contract/` + สร้าง API key ทดสอบ |

### เว็บ (`apps/web/`) — lane B (web-developer)
| ไฟล์ | หน้าที่ |
|---|---|
| `apps/web/src/lib/api/cors.ts` (ใหม่) | `corsHeaders`, `withCors`, `apiPreflight` |
| `apps/web/src/lib/api/response.ts` (แก้) | `apiHandler(req, fn)` ครอบ CORS ทุกคำตอบ |
| `apps/web/src/lib/platform.ts` (แก้) | `posOrigins()` |
| `apps/web/src/env.d.ts`, `apps/web/.env.example` (แก้) | `POS_ORIGINS` |
| `apps/web/src/app/api/v1/**/route.ts` (แก้ 6 ไฟล์) | ส่ง `req` ให้ `apiHandler` + `export function OPTIONS` |
| `apps/web/src/app/api/v1/[...rest]/route.ts` (ใหม่) | path ที่ไม่รู้จักใต้ `/api/v1` = 404 มีหัว CORS · OPTIONS 204 |
| `apps/web/test/fixtures/pos-contract/*.json` (ใหม่ 22 ไฟล์) + `.gitattributes` | **fixture สัญญาชุดกลาง — ต้นฉบับ (D82)** (POS คัดลอกไป `POS:packages/contracts/fixtures/dayo-api/`) |
| `apps/web/test/api.posContract.test.ts` (ใหม่) | เล่นทุก fixture ผ่าน Route Handler จริง (RPC ถูก mock) |
| `scripts/pricing-manifest.ts` (ใหม่) | รายชื่อไฟล์ตัวคิดราคา + sha256 ตอน build |
| `apps/web/next.config.ts` (แก้) | ฝัง `DAYO_PRICING_MANIFEST` ตอน build |
| `apps/web/src/lib/api/pricing.ts`, `apps/web/src/lib/api/jsonSplice.ts` (ใหม่) | อ่าน manifest · ต่อ `pricing` เข้ากับ JSON ดิบของ RPC โดยไม่ parse |
| `apps/web/src/app/api/v1/pos/catalog/route.ts` (ใหม่) | E1 |
| `apps/web/src/lib/api/posPush.ts`, `apps/web/src/app/api/v1/pos/push/route.ts` (ใหม่) | ตรวจซอง + E2 |
| `apps/web/src/lib/api/orders.ts` (แก้) | `listApiOrders` → RPC `api_list_orders` (E3) |
| `apps/web/src/lib/apiScopes.ts` (แก้) | เพิ่ม `staff:read` |
| `apps/web/src/lib/keyQr.ts` + `settings/api-clients/*` (แก้) | QR ของคีย์ |
| `apps/web/src/lib/billSource.ts` + `sales/*`, `dashboard/*` (แก้) | "แหล่ง · ผู้บันทึก" · ซ่อนแก้/ยกเลิกบิล POS · ธงซ้ำ · ส่วนต่าง POS |

### ตรรกะกลาง + สคริปต์ — lane C (shared-logic-engineer)
| ไฟล์ | หน้าที่ |
|---|---|
| `packages/shared/test/posParity.test.ts` (ใหม่ · Task 11) | เทสต์บริสุทธิ์ของ `posParity.ts` (ไม่ใช้ฐานข้อมูล) |
| `packages/shared/test/db/pos_parity.db.test.ts` (ใหม่ · Task 13) | `computeOrder` = `quote_order` ทุกเคส §5.3 **และ** ทุกเคสผ่าน `api_pos_push` ได้ `computed_total − total = 0` |
| `scripts/export-pos-parity.ts` (ใหม่) + `package.json` (script `export-pos-parity`) | เขียน `pos-parity.json` จาก `api_pos_catalog` จริง |

### บอท — lane D (bot-developer)
| ไฟล์ | หน้าที่ |
|---|---|
| `apps/line-bot/src/commands.ts`, `src/line/flex.ts`, `src/flowEngine.ts` (แก้) | "⚠ บิลที่อาจซ้ำ N ใบ" · "แหล่ง · ผู้บันทึก" ในบิลล่าสุด · flow `edit` ข้ามบิล POS |
| `apps/line-bot/test/posBills.test.ts` (ใหม่) | เทสต์ |

### DevOps — lane D (devops)
| ไฟล์ | หน้าที่ |
|---|---|
| `.github/workflows/backup.yml`, `.github/workflows/restore-test.yml` (ใหม่) | สำรองทุกคืน · ซ้อมกู้รายเดือน |
| `scripts/backup/manifest.sql` (ใหม่) | นับแถว/ขนาด/ยอดรายเดือน |
| `scripts/backup/backup-tool.mjs` + `backup-tool.d.mts` (ใหม่) | JavaScript ล้วน **ไม่มี dependency** รันด้วย `node` ที่มีใน runner (job สำรองไม่รัน `npm ci`/`npx`) · เก็บกี่ไฟล์ · ระดับขนาดฐาน · วัน PAT เหลือ · เทียบผลซ้อมกู้ |
| `packages/shared/test/backupTool.test.ts` (ใหม่) | เทสต์ฟังก์ชันใน `backup-tool.mjs` + สี/อีโมจิตรง `DISCORD_STYLES` (ADR-0044) |

### เอกสาร — docs-writer / architect
`docs/adr/0048-*.md` `0049-*.md` `0050-*.md` (เลขจริงตอนรับเข้า) · `docs/adr/README.md` · `docs/API.md` · `apps/web/openapi.yaml` · `docs/DATA-CONTRACT.md` · `docs/GLOSSARY.md` · `docs/SETUP.md` · `docs/OPERATIONS.md` · `docs/PLAN.md` (แถวเฟส 13)

### fixture สัญญาชุดกลาง — ที่อยู่ (ตอบข้อกำหนดของงาน)
- **เจ้าของ (D82 · สเปก §4.11 ที่แก้แล้ว)**: repo dayo `apps/web/test/fixtures/pos-contract/*.json` — fixture สะท้อนพฤติกรรมจริงของเซิร์ฟเวอร์ · dayo เป็นผู้เขียน/แก้เท่านั้น (Task 6) · ใช้โดย `apps/web/test/api.posContract.test.ts` (Route Handler) และ `packages/shared/test/db/pos_push.db.test.ts` (เล่นคำขอซ้ำกับฐานจริง) · เนื้อหาเต็มของทุกไฟล์อยู่ใน Task 6 ของแผนนี้ (ทีม POS ใช้ข้อความนี้ทำ mock server ได้ก่อน dayo เสร็จ)
- **สำเนาใน POS**: `packages/contracts/fixtures/dayo-api/*.json` ชื่อไฟล์เดียวกัน — ⛔ เจ้าของคัดลอกจาก dayo ไป POS หลัง Task 6 ผ่าน และทุกครั้งที่ dayo แก้ไฟล์ · POS ไม่แก้ไฟล์เอง (ถ้าต้องเปลี่ยน ให้แก้สเปก แล้ว dayo แก้ก่อน)
- **กติกาความเท่ากัน**: POS ตรวจ sha256 **หลังแปลง CRLF → LF** เทียบกับของ dayo (กติกาเดียวกับ sha256 ของไฟล์ตัวคิดราคา) · ทั้งสอง repo ใส่ `.gitattributes` ในโฟลเดอร์ fixture: `*.json text eol=lf` · คำสั่ง: `for f in *.json; do printf '%s  %s\n' "$(tr -d '\r' < "$f" | sha256sum | cut -d' ' -f1)" "$f"; done` รันในทั้งสองโฟลเดอร์แล้วผลต้องเท่ากันทุกบรรทัด

---

## ลำดับและงานขนาน

ข้อจำกัดของ repo dayo ที่กำหนดตาราง
1. **Supabase local มีได้ชุดเดียวต่อเครื่อง** (พอร์ตของ `supabase start` ชนกันข้าม worktree) → งานที่รันเทสต์ฐานข้อมูลต้องอยู่ช่อง "ใช้ Docker" ทีละงาน
2. TEAM-WORKFLOW §3: ขนานได้เฉพาะงานคนละ workspace และไม่รอ interface ของกัน → งานใน `apps/web` ต่อกันเป็นสายเดียว
3. `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=4` → ไม่เกิน 4 agent พร้อมกัน
4. แต่ละ lane ทำใน worktree/branch ของตัวเอง (`block1/db`, `block1/web`, `block1/shared`, `block1/bot`, `block1/ops`) · หัวหน้า merge ตามลำดับ db → shared → web → bot → ops → docs · `packages/shared/src/database.types.ts` สร้างใหม่ได้เฉพาะ lane A

| รอบ | lane A — `supabase/` (ช่อง Docker — ทีละงาน) | lane B — `apps/web` | lane C — `packages/shared` | lane D — `apps/line-bot` / `.github` / `docs` |
|---|---|---|---|---|
| 0 | **Task 0** architect (opus) + ⛔ เจ้าของอนุมัติ — ทุก lane รอ | | | |
| 1 | Task 1 db-engineer (opus) — สร้าง `posParity.ts` (เจ้าของไฟล์คนเดียว) | Task 5 web-developer (sonnet) | — | Task 14 Step 1–5 devops (sonnet) |
| 2 | Task 2 db-engineer (opus) | Task 6 web-developer (sonnet) — fixture ชุดกลาง | Task 11 shared-logic-engineer (sonnet) — หลัง merge Task 1 | Task 12 bot-developer (sonnet) |
| 3 | Task 3a db-engineer (opus) | Task 7 web-developer (sonnet) | — | Task 12 (ต่อ) |
| 4 | Task 3b db-engineer (opus) — **หลัง merge Task 6** (อ่าน fixture) | Task 8 web-developer (sonnet) | — | — |
| 5 | Task 4 db-engineer (opus) | Task 9 web-developer (sonnet) | — | — |
| 6 | Task 13 shared-logic-engineer (sonnet) — ช่อง Docker · หลัง merge Task 4 + 7 + 11 | Task 10 web-developer (sonnet) | — | Task 15 docs-writer (sonnet, low) |
| 7 | Task 14 Step 6–7 devops (sonnet) — ช่อง Docker · หลัง merge Task 4 + Task 11 + Task 14 Step 1–5 | Task 10 (ต่อ) | — | Task 15 (ต่อ) |
| 8 | **Task 16** รวม: test-runner (haiku) → code-reviewer (sonnet) + security-reviewer (opus) | | | |
| 9 | **Task 17** ⛔ เจ้าของ + devops (sonnet): production + สำรองจริง 3 คืน + ซ้อมกู้ | | | |

ไฟล์ที่มีเจ้าของคนเดียว (กัน add/add conflict และเนื้อหาต่างกันเงียบ ๆ): `packages/shared/test/db/posParity.ts` = Task 1 · `apps/web/test/fixtures/pos-contract/*.json` = Task 6 (Task 3b อ่านหลัง merge เท่านั้น) · `scripts/backup/*` + `.github/workflows/*` = Task 14 · `packages/shared/src/database.types.ts` = lane A

| Task | agent · โมเดล | รอ | ผลิต interface ที่คนอื่นใช้ |
|---|---|---|---|
| 0 | architect · opus + ⛔ | — | ADR เลขจริง |
| 1 | db-engineer · opus | 0 | `api_pos_catalog(uuid, uuid, bigint) → jsonb` · `dayo_pos_supported()` · `dayo_iso_ms(timestamptz)` · `posParity.ts` |
| 2 | db-engineer · opus | 1 | คอลัมน์ `orders.*` ใหม่ · `dayo_order_items_signature` · `dayo_detect_duplicates` · `dayo_order_duplicate_of` · `dayo_order_cancel_core` · `DY403 pos_bill_read_only` |
| 3a | db-engineer · opus | 2 | ตัวตรวจรูป · `dayo_pos_error_verdict` · `dayo_pos_verdict` · `dayo_pos_unknown_fields` · include_inactive ของตัวเลือก/โปร/qty (migration 0050) |
| 3b | db-engineer · opus | 3a, 6 | `api_pos_push(uuid, uuid, text[], jsonb) → jsonb` (migration 0051) |
| 4 | db-engineer · opus | 3b | `api_list_orders` · `dashboard_duplicate_flags` · `resolve_duplicate_flag` · `duplicate_flags_open_count` · `dashboard_pos_diffs` · `backup_log_auto(jsonb, bigint)` · `bot_recent_orders` ฟิลด์ใหม่ · CHECK `audit_log.action` ใหม่ · `dayo_order_recheck_flags` (migration 0052) |
| 5 | web-developer · sonnet | 0 | `apiHandler(req, fn)` · `apiPreflight(req)` · `posOrigins()` · route กันตก `/api/v1/[...rest]` |
| 6 | web-developer · sonnet | 5 | fixture 22 ไฟล์ + harness |
| 7 | web-developer · sonnet | 6 | E1 route · `scripts/pricing-manifest.ts` (`PRICING_FILES`, `pricingManifestAtBuild`) |
| 8 | web-developer · sonnet | 7 | E2 route · `splitUnsafeRows` |
| 9 | web-developer · sonnet | 8 (+ ชื่อ RPC จาก Task 4 ในแผนนี้) | E3 |
| 10 | web-developer · sonnet | 9 (+ ชื่อ RPC Task 4) | หน้าเว็บ |
| 11 | shared-logic-engineer · sonnet | 1 | เทสต์บริสุทธิ์ของ `posParity.ts` (ชื่อฟิลด์ตรง `types.ts` · ทุกเคสมี `saleTime`) |
| 12 | bot-developer · sonnet | 0 (+ ชื่อ RPC Task 4) | — |
| 13 | shared-logic-engineer · sonnet | 1, 3b, 4, 7, 11 | `pos-parity.json` |
| 14 | devops · sonnet | Step 1–5: 0 · Step 6–7: 4, 11 (ช่อง Docker) | workflow + `scripts/backup/backup-tool.mjs` |
| 15 | docs-writer · sonnet (low) | 3b, 8 | เอกสาร |
| 16 | test-runner · haiku / code-reviewer · sonnet / security-reviewer · opus | ทุก task | ผลตรวจ |
| 17 | ⛔ เจ้าของ + devops · sonnet | 16 | production |

---

## Task 0: รับ P1 · P2 · P7 เป็น ADR ของ dayo (ก่อนเขียนโค้ดใด ๆ)

ADR ที่ยอมรับแล้วห้ามเปลี่ยนเงียบ ๆ (กฎเหล็กข้อ 1) → ต้องผ่านกระบวนการของ dayo ก่อน

**agent:** architect ของ dayo (opus) · หัวหน้าทีมสรุปให้เจ้าของ · ⛔ เจ้าของอนุมัติ

**Files:**
- Create: `docs/adr/0048-pos-api-on-staff-catalog-version.md` (จาก P1) · `docs/adr/0049-bill-source-actor-duplicate-flag.md` (จาก P2) · `docs/adr/0050-automatic-onedrive-backup.md` (จาก P7) — **เลขจริง = เลขถัดไปตอนรับเข้า** (ตอนเขียนแผน ADR ล่าสุดคือ 0047) · ถ้าเลขไม่ใช่ 0048–0050 ให้แทนเลขทุกที่ในแผนนี้ที่อ้าง ADR (ไม่กระทบเลข migration)
- Modify: `docs/adr/README.md` · บรรทัดสถานะของ `docs/adr/0006-*.md`, `0021-*.md`, `0029-*.md`, `0035-*.md`, `0040-*.md`, `0042-*.md`

- [ ] **Step 1: ⛔ เจ้าของวางสำเนาเอกสาร** — คัดลอก POS `docs/design/04-สเปกการเชื่อม-POS-กับ-dayo.md` และ `docs/design/dayo-adr-drafts/{P1,P2,P7}-*.md` มาไว้ที่ dayo `docs/pos-integration/` (โฟลเดอร์อ้างอิง อ่านอย่างเดียว) พร้อมแผนนี้

- [ ] **Step 2: architect ตรวจร่างกับโค้ดจริง** — อ่าน CLAUDE.md, `docs/adr/README.md`, ADR 0006/0021/0029/0035/0036/0040/0041/0042/0044/0045/0046, DATA-CONTRACT §2–§4 §8, GLOSSARY แล้วตรวจแต่ละข้อของ P1/P2/P7 ว่า (ก) ขัด ADR ใดที่ร่างไม่ได้ระบุ (ข) ชื่อตาราง/ฟังก์ชันตรงกับ migration 0001–0047 · จุดที่แผนนี้ตีความแล้ว **ต้องอยู่ใน ADR ด้วย**: ลำดับตรวจเต็มของแถว E2 (Task 3b Step 4) และ 18 ข้อในหัวข้อ "จุดตีความจากสเปก" ท้ายแผนนี้ · ถ้า architect ไม่เห็นด้วยกับข้อใด = เปลี่ยนสัญญา → หยุด แจ้งทีม POS ผ่านเจ้าของ

- [ ] **Step 3: เขียน ADR 3 ไฟล์** ตามแบบ ADR ของ dayo (หัวข้อ สถานะ บริบท ตัดสินใจ ทางเลือกที่ไม่เลือก ผลที่ตามมา) เนื้อหา = ร่าง P1/P2/P7 + จุดตีความใน Step 2 · สถานะ "เสนอ" · **ADR-0050 (จาก P7) เขียนกติกาเก็บไฟล์เป็น "นับไฟล์: daily เก็บ 30 ไฟล์ล่าสุด · monthly เก็บ 12 ไฟล์ล่าสุด (เรียงตามวันที่ในชื่อไฟล์) — แทน `rclone delete --min-age` ในสเปก §8 เพราะถ้าสำรองหยุดหลายวัน ไฟล์เก่าจะไม่ถูกลบจนหมด"** ให้เจ้าของอนุมัติใน Step 6 · ADR-0050 ระบุด้วยว่า `backup_log_auto` เรียกได้เฉพาะ role `dayo_backup` (ถอนสิทธิ์จาก `service_role`) และทุก migration ถัดไปต้องถอนซ้ำ · ADR-0049 ระบุค่าใหม่ของ `audit_log.action`: `duplicate_flag_resolve` (owner กด "ไม่ซ้ำ") · `duplicate_flag_auto_close` (ระบบปิดธงเมื่อแก้บิลแล้วคู่ไม่ตรงเงื่อนไข)

- [ ] **Step 4: เสนอศัพท์ใหม่ใน GLOSSARY** (ร่างให้ docs-writer ใส่ใน Task 15): แหล่ง (`pos`/`line`/`web` — จอแสดง "แท็บเล็ต"/"บอท"/"เว็บ") · ผู้บันทึก · ฉบับแคตตาล็อก · คำตัดสินรายแถว (`accepted`/`duplicate`/`rejected`/`deferred`) · บิลน่าจะซ้ำ · ส่วนต่างเล็กน้อย (≤ ฿1) · สำรองอัตโนมัติ

- [ ] **Step 5: หัวหน้าสรุปให้เจ้าของ** (ไทย ≤ 30 บรรทัด): ADR ใหม่ 3 ฉบับ · ADR เดิมที่เปลี่ยนสถานะ · จุดตีความ · สิ่งที่ต้องแจ้งทีม POS (ถ้ามี)

- [ ] **Step 6: ⛔ เจ้าของอนุมัติ** → architect เปลี่ยนสถานะเป็น "ยอมรับ" · แก้บรรทัดสถานะ ADR เดิม:
  - 0035: "ข้อ 2–3 ขยายโดย ADR-0048/0049 · ข้อ 5 แก้โดย ADR-0049"
  - 0040: "ข้อ 2 แก้โดย ADR-0049 (บิลจากแท็บเล็ตเทียบวันที่ไทยของ `voided_at`)"
  - 0042: "ขยายโดย ADR-0048 (เงื่อนไขเปิดใช้)"
  - 0006: "⚠ แทนที่โดย ADR-0011 (ที่เก็บ) และ ADR-0049 (บอทเป็นช่องทางหนึ่งในหลายช่องทาง ไม่ใช่ที่บันทึกหลักเพียงแห่งเดียว)"
  - 0021: "เพิ่มเติมโดย ADR-0050 (สำรองอัตโนมัติ — ปุ่มสำรองเองคงเดิม)"
  - 0029: "ขยายโดย ADR-0049"
  - อัปเดต `docs/adr/README.md`
  - ถ้าเจ้าของ/architect ต้องการเปลี่ยนสัญญา §4 → **หยุดทั้งแผน** แจ้งทีม POS

- [ ] **Step 7: Commit** (เมื่อเจ้าของสั่ง · ใช้ skill `committing-code`)
```bash
git add docs/adr/0048-pos-api-on-staff-catalog-version.md docs/adr/0049-bill-source-actor-duplicate-flag.md docs/adr/0050-automatic-onedrive-backup.md docs/adr/README.md docs/adr/0006-*.md docs/adr/0021-*.md docs/adr/0029-*.md docs/adr/0035-*.md docs/adr/0040-*.md docs/adr/0042-*.md docs/pos-integration/
git commit -m "docs(adr): accept pos api, bill source and automatic backup decisions"
```

---

## Task 1: ฉบับแคตตาล็อก + scope `staff:read` + `api_pos_catalog` (migration 0048)

**agent:** db-engineer · opus · high (lane A · ใช้ Docker)

**Files:**
- Create: `supabase/migrations/0048_pos_catalog_version.sql`
- Create: `packages/shared/test/db/pos_catalog.db.test.ts`
- Modify: `packages/shared/src/database.types.ts` (สร้างด้วย `npm run db:types`)

**Interfaces:**
- Consumes: `dayo_impl_get_full_catalog(uuid)` (0047), `api_clients`, `staff`, `orders.external_ref`
- Produces:
  - `public.catalog_versions (shop_id uuid pk, version bigint, changed_at timestamptz)`
  - `public.dayo_iso_ms(p timestamptz) returns text` — `2026-09-25T02:00:00.120+00:00`
  - `public.dayo_pos_supported() returns jsonb` — `{supported_kinds: [...], supported_fields: {...}}`
  - `public.dayo_catalog_version(p_shop_id uuid) returns bigint`
  - `public.api_pos_catalog(p_shop_id uuid, p_api_client_id uuid, p_known_version bigint default null) returns jsonb` — `data` ของ E1 **ไม่มี** `pricing` (Route ต่อให้ — Task 7)

- [ ] **Step 0: สร้างไฟล์ชุด parity (Task 1 เป็นเจ้าของไฟล์นี้คนเดียว · lane อื่น import อย่างเดียว)** — กติกา: **ทุกเคสต้องมี `saleTime`** (แท็บเล็ตส่งเวลาขายทุกบิล — เคสที่ไม่มีทำให้ parity ข้ามระบบล้ม · ตัวช่วย `d()` ใส่ `"10:00"` เป็นค่าเริ่มต้น) · ทุกบรรทัดส่ง `milk` ที่ตีความแล้ว และเมนูมัตจะส่ง `grade`

`packages/shared/test/db/posParity.ts`:
```ts
// posParity.ts — แคตตาล็อกทดสอบ + เคส parity ของ POS (สเปก POS 04 §5.3) · ใช้โดย pos_*.db.test.ts,
// pos_parity.db.test.ts และ scripts/export-pos-parity.ts · ราคาเลือกให้เกิดเศษครึ่งสตางค์/ปัดขึ้นตามที่สเปกต้องการ
import type { OrderDraft, OrderDraftLine, QuoteResult, Size, Sweetness } from "../../src/types.js";

const ing = (code: string, name: string, useUnit: "ml" | "g" | "ชิ้น", pack: number, price: number) => ({
  code, name, type: code.startsWith("PK") ? "บรรจุภัณฑ์" : "วัตถุดิบ", subcategory: null, useUnit, buyUnit: "แพ็ก",
  packToUseFactor: pack, buyPrice: price, reorderPoint: null, note: null, sortOrder: 0, isActive: true,
});
const menu = (code: string, nameTh: string, family: string, allowOatMilk: boolean, isMatcha: boolean, sortOrder: number) => ({
  code, nameTh, family, categoryLabel: null, allowOatMilk, isMatcha, aliases: [], sortOrder, isActive: true,
});
type Recipe = Array<[string | null, string | null, number, "ml" | "g" | "ชิ้น"]>;
const V: Array<{ menuCode: string; size: Size; sweetness: Sweetness; price: number; recipe: Recipe }> = [
  { menuCode: "Thai Tea", size: "16 oz", sweetness: "50%", price: 35, recipe: [[null, "BASE-THAI", 150, "ml"], ["RM-004", null, 20, "ml"], ["RM-020", null, 30, "ml"], ["PK-001", null, 1, "ชิ้น"]] },
  { menuCode: "Thai Tea", size: "16 oz", sweetness: "100%", price: 35, recipe: [[null, "BASE-THAI", 150, "ml"], ["RM-004", null, 30, "ml"], ["RM-020", null, 30, "ml"], ["PK-001", null, 1, "ชิ้น"]] },
  { menuCode: "Thai Tea", size: "20 oz", sweetness: "50%", price: 40, recipe: [[null, "BASE-THAI", 200, "ml"], ["RM-004", null, 25, "ml"], ["RM-020", null, 40, "ml"], ["PK-002", null, 1, "ชิ้น"]] },
  { menuCode: "Green Tea", size: "16 oz", sweetness: "50%", price: 40, recipe: [[null, "BASE-GREEN", 150, "ml"], ["RM-020", null, 50, "ml"], ["PK-001", null, 1, "ชิ้น"]] },
  { menuCode: "Green Tea", size: "20 oz", sweetness: "50%", price: 45, recipe: [[null, "BASE-GREEN", 200, "ml"], ["RM-020", null, 60, "ml"], ["PK-002", null, 1, "ชิ้น"]] },
  { menuCode: "Premium Thai", size: "16 oz", sweetness: "50%", price: 65, recipe: [[null, "BASE-THAI", 180, "ml"], ["RM-020", null, 40, "ml"], ["PK-001", null, 1, "ชิ้น"]] },
  { menuCode: "Matcha Latte", size: "16 oz", sweetness: "50%", price: 85, recipe: [["RM-010", null, 3.5, "g"], ["RM-020", null, 150, "ml"], ["PK-001", null, 1, "ชิ้น"]] },
  { menuCode: "Matcha Latte", size: "20 oz", sweetness: "50%", price: 95, recipe: [["RM-010", null, 4.5, "g"], ["RM-020", null, 200, "ml"], ["PK-002", null, 1, "ชิ้น"]] },
  { menuCode: "Lemon Tea", size: "16 oz", sweetness: "50%", price: 30, recipe: [[null, "BASE-THAI", 150, "ml"], ["RM-002", null, 10, "g"], ["PK-001", null, 1, "ชิ้น"]] },
];
const P = (code: string, name: string, kind: string, priority: number, params: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  code, name, kind, startsOn: null, endsOn: null, daysOfWeek: null, timeFrom: null, timeTo: null, channelCodes: null,
  requiresCode: false, autoApply: true, priority, stackable: true, params, isActive: true, ...extra,
});

export function posParityCatalogPayload() {
  return {
    ingredients: [
      ing("RM-001", "ใบชาไทย", "g", 500, 250), ing("RM-002", "น้ำตาล", "g", 1000, 30), ing("RM-003", "น้ำ", "ml", 1000, 10),
      ing("RM-004", "นมข้น", "ml", 1000, 80), ing("RM-020", "นมสด", "ml", 1000, 50), ing("RM-021", "นมโอ๊ต", "ml", 1000, 90),
      ing("RM-010", "ผงมัตจะ Excellent", "g", 100, 800), ing("RM-011", "ผงมัตจะ Daizu", "g", 100, 1000),
      ing("RM-012", "ผงมัตจะ Isuzu", "g", 100, 1200), ing("RM-030", "ผงชาเขียว", "g", 500, 400),
      ing("PK-001", "แก้ว 16 oz", "ชิ้น", 50, 100), ing("PK-002", "แก้ว 20 oz", "ชิ้น", 50, 125),
    ],
    bases: [
      { code: "BASE-THAI", name: "เบสชาไทย", yieldQty: 1000, yieldUnit: "ml", instructions: [], safetyNote: null, shelfLifeHours: 24, sortOrder: 1, isActive: true,
        lines: [{ ingredientCode: "RM-001", qty: 50, sortOrder: 1 }, { ingredientCode: "RM-002", qty: 100, sortOrder: 2 }, { ingredientCode: "RM-003", qty: 1000, sortOrder: 3 }] },
      { code: "BASE-GREEN", name: "เบสชาเขียว", yieldQty: 500, yieldUnit: "ml", instructions: [], safetyNote: null, shelfLifeHours: 24, sortOrder: 2, isActive: true,
        lines: [{ ingredientCode: "RM-030", qty: 20, sortOrder: 1 }, { ingredientCode: "RM-003", qty: 500, sortOrder: 2 }] },
    ],
    menus: [
      menu("Thai Tea", "ชาไทย", "ชาไทย", false, false, 1), menu("Green Tea", "ชาเขียว", "ชาเขียว", true, false, 2),
      menu("Premium Thai", "ชาไทยพรีเมียม", "ชาไทย", false, false, 3), menu("Matcha Latte", "มัตจะลาเต้", "มัตจะ", true, true, 4),
      menu("Lemon Tea", "ชามะนาว", "อื่นๆ", true, false, 5),
    ],
    variants: V.map((v) => ({ menuCode: v.menuCode, size: v.size, sweetness: v.sweetness, price: v.price, note: null, isActive: true })),
    recipeLines: V.flatMap((v) => v.recipe.map(([ingredientCode, baseCode, qty, unit], i) => ({
      menuCode: v.menuCode, size: v.size, sweetness: v.sweetness, lineNo: i + 1, ingredientCode, baseCode, qty, unit }))),
    options: [
      { kind: "milk", code: "fresh", label: "นมสด", aliases: ["นมสด"], ingredientCode: "RM-020", priceAdd: 0, multiplier: null, isDefault: true, note: null, sortOrder: 0, isActive: true },
      { kind: "milk", code: "oat", label: "นมโอ๊ต", aliases: ["โอ๊ต"], ingredientCode: "RM-021", priceAdd: 5, multiplier: null, isDefault: false, note: null, sortOrder: 1, isActive: true },
      { kind: "matcha_grade", code: "Excellent", label: "Excellent", aliases: [], ingredientCode: "RM-010", priceAdd: 0, multiplier: 1, isDefault: true, note: null, sortOrder: 0, isActive: true },
      { kind: "matcha_grade", code: "Daizu", label: "Daizu", aliases: [], ingredientCode: "RM-011", priceAdd: 40, multiplier: 0.9, isDefault: false, note: null, sortOrder: 1, isActive: true },
      { kind: "matcha_grade", code: "Isuzu", label: "Isuzu", aliases: [], ingredientCode: "RM-012", priceAdd: 90, multiplier: 0.8, isDefault: false, note: null, sortOrder: 2, isActive: true },
    ],
    sops: [], sections: [], stockCounts: [], channels: [],
    paymentMethods: [
      { code: "cash", name: "เงินสด", aliases: ["เงินสด"], sortOrder: 0, isActive: true },
      { code: "qr", name: "QR", aliases: ["qr"], sortOrder: 1, isActive: true },
      { code: "platform", name: "แพลตฟอร์ม", aliases: [], sortOrder: 2, isActive: true },
    ],
    salesChannels: [
      { code: "store", name: "หน้าร้าน", aliases: [], priceMarkupPct: 0, priceAddBaht: 0, rounding: "none", feePct: 0, defaultPaymentMethodCode: "cash", sortOrder: 0, isActive: true },
      { code: "pct7", name: "บวก 7%", aliases: [], priceMarkupPct: 0.07, priceAddBaht: 0, rounding: "ceil_baht", feePct: 0, defaultPaymentMethodCode: "qr", sortOrder: 1, isActive: true },
      { code: "mix", name: "บวก 10% + 2 บาท", aliases: [], priceMarkupPct: 0.1, priceAddBaht: 2, rounding: "ceil_baht", feePct: 0.25, defaultPaymentMethodCode: "qr", sortOrder: 2, isActive: true },
      { code: "fee30", name: "ค่าธรรมเนียม 30%", aliases: [], priceMarkupPct: 0, priceAddBaht: 0, rounding: "none", feePct: 0.3, defaultPaymentMethodCode: "qr", sortOrder: 3, isActive: true },
      { code: "grab", name: "Grab", aliases: [], priceMarkupPct: 0.3, priceAddBaht: 0, rounding: "ceil_baht", feePct: 0.3, defaultPaymentMethodCode: "platform", sortOrder: 4, isActive: true },
    ],
    promotions: [
      P("HAPPY", "ชาไทยลด 20% บ่าย", "item_discount", 5, { menu_codes: ["Thai Tea"], percent: 20 }, { timeFrom: "14:00", timeTo: "16:00" }),
      P("NOON", "ชาเขียวลด 5 เที่ยง", "item_discount", 6, { menu_codes: ["Green Tea"], amount_baht: 5 }, { timeFrom: "12:00", timeTo: "14:00" }),
      P("B2G1", "ชาไทย ซื้อ 2 แถม 1", "buy_n_get_m", 10, { buy_qty: 2, get_qty: 1, menu_codes: ["Thai Tea"] }),
      P("MATCHA2", "มัตจะ 1 แถม 1 (โค้ด)", "buy_n_get_m", 20, { buy_qty: 1, get_qty: 1, menu_codes: ["Matcha Latte"], max_sets: 1 }, { requiresCode: true }),
      P("SET100", "เซ็ตชาไทย+มัตจะ 100", "bundle", 50, { items: [{ menu_codes: ["Thai Tea"], qty: 1 }, { menu_codes: ["Matcha Latte"], qty: 1 }], bundle_price: 100 }, { stackable: false }),
      P("GRAB3", "Grab ลด 3", "item_discount", 60, { menu_codes: [], amount_baht: 3 }, { channelCodes: ["grab"] }),
      P("WEEKEND", "มัตจะเสาร์อาทิตย์ลด 4", "item_discount", 70, { menu_codes: ["Matcha Latte"], amount_baht: 4 }, { daysOfWeek: [0, 6] }),
      P("BILL10", "ลดบิล 10% ครบ 200 สูงสุด 30", "bill_discount", 90, { min_subtotal: 200, percent: 10, max_amount: 30 }),
      P("FRIEND", "โค้ดเพื่อนลด 50", "bill_discount", 92, { amount_baht: 50 }, { requiresCode: true }),
    ],
  };
}

/** ค่าร้านของชุด parity: ค่าเริ่มต้นนมโอ๊ต (§5.3 เคส 11 — แท็บเล็ตส่ง milk ที่ตีความแล้วเสมอ) */
export const POS_PARITY_SHOP_SETTINGS = { default_milk: "oat", default_sweetness: "50%" } as const;

export interface ParityCtx {
  promoId(code: string): string;
  allPromoIds: string[];
  onlyPromos(...codes: string[]): string[];
}
export interface ParityCase {
  id: string;
  spec: string;
  draft(ctx: ParityCtx): OrderDraft;
  /** ฟิลด์เพิ่มฝั่ง SQL (เช่น no_promotions: true) — แท็บเล็ตส่งแบบ skip ทุกโปร */
  sqlExtra?: Record<string, unknown>;
}

const THU = "2026-09-24";
const SAT = "2026-09-26";
const L = (code: string, size: Size, sweetness: Sweetness, qty: number, extra: Partial<OrderDraftLine> = {}): OrderDraftLine => ({
  code, size, sweetness, qty, milk: "fresh", grade: code === "Matcha Latte" ? "Excellent" : null, ...extra,
});
const d = (lines: OrderDraftLine[], skip: string[], extra: Partial<OrderDraft> = {}): OrderDraft => ({
  saleDate: THU, saleTime: "10:00", channelCode: "store", paymentCode: "cash", lines, skipPromotionIds: skip, ...extra,
});

export const POS_PARITY_CASES: ParityCase[] = [
  { id: "01-pct15-of-35", spec: "§5.3 ข้อ 1", draft: (c) => d([L("Thai Tea", "16 oz", "50%", 1, { discountPercent: 15 })], c.allPromoIds) },
  { id: "01-pct15-of-45", spec: "§5.3 ข้อ 1", draft: (c) => d([L("Green Tea", "20 oz", "50%", 1, { discountPercent: 15 })], c.allPromoIds) },
  { id: "01-pct7-of-85", spec: "§5.3 ข้อ 1", draft: (c) => d([L("Matcha Latte", "16 oz", "50%", 1, { discountPercent: 7 })], c.allPromoIds) },
  { id: "01-pct33-of-65", spec: "§5.3 ข้อ 1", draft: (c) => d([L("Premium Thai", "16 oz", "50%", 1, { discountPercent: 33 })], c.allPromoIds) },
  { id: "02-markup7-ceil", spec: "§5.3 ข้อ 2", draft: (c) => d([L("Thai Tea", "16 oz", "50%", 1)], c.allPromoIds, { channelCode: "pct7", paymentCode: "qr" }) },
  { id: "02-round2-36675", spec: "§5.3 ข้อ 2 (fee 122.25 × 0.3 = 36.675 → 36.68)", draft: (c) =>
      d([L("Premium Thai", "16 oz", "50%", 1, { discountBaht: 7.75 }), L("Premium Thai", "16 oz", "50%", 1)], c.allPromoIds, { channelCode: "fee30", paymentCode: "qr" }) },
  { id: "03-markup-add-ceil-fee", spec: "§5.3 ข้อ 3", draft: (c) =>
      d([L("Thai Tea", "16 oz", "50%", 2), L("Green Tea", "16 oz", "50%", 1)], c.allPromoIds, { channelCode: "mix", paymentCode: "qr" }) },
  { id: "04-bill-pct-after-line", spec: "§5.3 ข้อ 4", draft: (c) =>
      d([L("Thai Tea", "16 oz", "50%", 1, { discountBaht: 5 }), L("Thai Tea", "16 oz", "50%", 1)], c.allPromoIds, { billDiscountPercent: 10 }) },
  { id: "04-bill10-max30", spec: "§5.3 ข้อ 4", draft: (c) => d([L("Matcha Latte", "16 oz", "50%", 4)], c.onlyPromos("BILL10")) },
  { id: "05-bundle-remainder", spec: "§5.3 ข้อ 5", draft: (c) => d([L("Thai Tea", "16 oz", "50%", 1), L("Matcha Latte", "16 oz", "50%", 1)], c.onlyPromos("SET100")) },
  { id: "05-b2g1-split-qty4", spec: "§5.3 ข้อ 5", draft: (c) => d([L("Thai Tea", "20 oz", "50%", 4)], c.onlyPromos("B2G1")) },
  { id: "06-oat-isuzu-180", spec: "§5.3 ข้อ 6", draft: (c) => d([L("Matcha Latte", "16 oz", "50%", 1, { milk: "oat", grade: "Isuzu" })], c.allPromoIds) },
  { id: "06-oat-without-fresh-milk", spec: "§5.3 ข้อ 6 (ok=false)", draft: (c) => d([L("Lemon Tea", "16 oz", "50%", 1, { milk: "oat" })], c.allPromoIds) },
  { id: "07-happy-1359", spec: "§5.3 ข้อ 7", draft: (c) => d([L("Thai Tea", "16 oz", "50%", 1)], c.onlyPromos("HAPPY"), { saleTime: "13:59" }) },
  { id: "07-happy-1400", spec: "§5.3 ข้อ 7", draft: (c) => d([L("Thai Tea", "16 oz", "50%", 1)], c.onlyPromos("HAPPY"), { saleTime: "14:00" }) },
  { id: "07-happy-1600", spec: "§5.3 ข้อ 7", draft: (c) => d([L("Thai Tea", "16 oz", "50%", 1)], c.onlyPromos("HAPPY"), { saleTime: "16:00" }) },
  { id: "07-happy-1601", spec: "§5.3 ข้อ 7", draft: (c) => d([L("Thai Tea", "16 oz", "50%", 1)], c.onlyPromos("HAPPY"), { saleTime: "16:01" }) },
  { id: "07-weekend-sat", spec: "§5.3 ข้อ 7 (วันในสัปดาห์)", draft: (c) => d([L("Matcha Latte", "16 oz", "50%", 1)], c.onlyPromos("WEEKEND"), { saleDate: SAT }) },
  { id: "07-weekend-thu", spec: "§5.3 ข้อ 7 (วันในสัปดาห์)", draft: (c) => d([L("Matcha Latte", "16 oz", "50%", 1)], c.onlyPromos("WEEKEND")) },
  { id: "08-skip-b2g1", spec: "§5.3 ข้อ 8", draft: (c) => d([L("Thai Tea", "16 oz", "50%", 3)], c.allPromoIds) },
  { id: "08-no-promotions", spec: "§5.3 ข้อ 8 (แท็บเล็ต skip ทุกโปร = SQL no_promotions)", draft: (c) =>
      d([L("Thai Tea", "16 oz", "50%", 3), L("Matcha Latte", "16 oz", "50%", 3)], c.allPromoIds),
    sqlExtra: { no_promotions: true, skip_promotions: [] } },
  { id: "08-promo-code-required", spec: "§5.3 ข้อ 8", draft: (c) => d([L("Matcha Latte", "16 oz", "50%", 2)], c.onlyPromos("MATCHA2"), { promoCode: "MATCHA2" }) },
  { id: "08-promo-code-missing", spec: "§5.3 ข้อ 8", draft: (c) => d([L("Matcha Latte", "16 oz", "50%", 2)], c.onlyPromos("MATCHA2")) },
  { id: "09-qty-99", spec: "§5.3 ข้อ 9", draft: (c) => d([L("Thai Tea", "16 oz", "50%", 99)], c.allPromoIds) },
  { id: "09-50-lines-500-cups", spec: "§5.3 ข้อ 9", draft: (c) =>
      d(Array.from({ length: 50 }, (_, i) => L(i % 2 ? "Green Tea" : "Thai Tea", "16 oz", "50%", 10)), c.allPromoIds) },
  { id: "10-free-without-reason", spec: "§5.3 ข้อ 10 (ok=false)", draft: (c) => d([L("Thai Tea", "16 oz", "50%", 1, { free: true })], c.allPromoIds) },
  { id: "10-full-discount-without-reason", spec: "§5.3 ข้อ 10 (ok=false)", draft: (c) => d([L("Thai Tea", "16 oz", "50%", 1, { discountBaht: 35 })], c.allPromoIds) },
  { id: "11-default-oat-explicit-fresh", spec: "§5.3 ข้อ 11", draft: (c) => d([L("Green Tea", "16 oz", "50%", 1, { milk: "fresh" })], c.allPromoIds) },
  { id: "11-default-oat-explicit-oat", spec: "§5.3 ข้อ 11", draft: (c) => d([L("Green Tea", "16 oz", "50%", 1, { milk: "oat" })], c.allPromoIds) },
  { id: "12-channel-promo-grab", spec: "§5.3 ข้อ 12", draft: (c) => d([L("Thai Tea", "16 oz", "50%", 1)], c.onlyPromos("GRAB3"), { channelCode: "grab", paymentCode: "platform" }) },
  { id: "12-channel-promo-store", spec: "§5.3 ข้อ 12", draft: (c) => d([L("Thai Tea", "16 oz", "50%", 1)], c.onlyPromos("GRAB3")) },
  { id: "13-timeto-1400-truncated", spec: "§5.3 ข้อ 13 (14:00:59 → 14:00)", draft: (c) => d([L("Green Tea", "16 oz", "50%", 1)], c.onlyPromos("NOON"), { saleTime: "14:00" }) },
  { id: "13-timefrom-1200", spec: "§5.3 ข้อ 13", draft: (c) => d([L("Green Tea", "16 oz", "50%", 1)], c.onlyPromos("NOON"), { saleTime: "12:00" }) },
];
// §5.3 ข้อ 14 (ตัวแปร/ตัวเลือกปิดใช้หลังขาย) อยู่ใน pos_push.db.test.ts · ข้อ 15 (bill_discount สองค่า = INVALID) อยู่ใน pos_push.db.test.ts

/** OrderDraft ของ shared → ร่างของ SQL quote_order (ลอกจาก orders.db.test.ts) */
export function toSqlDraft(dr: OrderDraft, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const bill = dr.billDiscountBaht != null || dr.billDiscountPercent != null
    ? { baht: dr.billDiscountBaht ?? null, percent: dr.billDiscountPercent ?? null, reason: dr.billDiscountReason ?? null }
    : undefined;
  return {
    sale_date: dr.saleDate, sale_time: dr.saleTime ?? null, channel: dr.channelCode, payment: dr.paymentCode ?? null,
    promo_code: dr.promoCode ?? null, skip_promotions: dr.skipPromotionIds ?? [], bill_discount: bill,
    lines: dr.lines.map((l) => ({
      code: l.code, size: l.size ?? null, sweetness: l.sweetness ?? null, milk: l.milk ?? null, grade: l.grade ?? null, qty: l.qty,
      free: l.free ?? false, discount_baht: l.discountBaht ?? null, discount_percent: l.discountPercent ?? null, discount_reason: l.discountReason ?? null,
    })),
    ...extra,
  };
}

export interface ParityMoney {
  ok: boolean;
  itemsSubtotal: number;
  itemsDiscount: number;
  billDiscountAmount: number;
  totalAmount: number;
  channelFeeAmount: number;
  lines: Array<{ lineNo: number; unitPrice: number; discountPerCup: number; lineTotal: number }>;
  promotionsApplied: Array<{ promotionId: string; discountAmount: number }>;
}
const r2 = (n: unknown) => Math.round(Number(n) * 100) / 100;

export function moneyFromSql(q: Record<string, unknown>): ParityMoney {
  const lines = (q.lines as Array<Record<string, unknown>>) ?? [];
  const promos = (q.promotions_applied as Array<Record<string, unknown>>) ?? [];
  return {
    ok: Boolean(q.ok), itemsSubtotal: r2(q.items_subtotal), itemsDiscount: r2(q.items_discount), billDiscountAmount: r2(q.bill_discount),
    totalAmount: r2(q.total), channelFeeAmount: r2(q.fee),
    lines: lines.map((l) => ({ lineNo: Number(l.line_no), unitPrice: r2(l.unit_price), discountPerCup: r2(l.discount_per_cup), lineTotal: r2(l.line_total) })),
    promotionsApplied: promos.map((p) => ({ promotionId: String(p.promotion_id), discountAmount: r2(p.discount_amount) })),
  };
}

export function moneyFromShared(q: QuoteResult): ParityMoney {
  return {
    ok: q.ok, itemsSubtotal: r2(q.itemsSubtotal), itemsDiscount: r2(q.itemsDiscount), billDiscountAmount: r2(q.billDiscountAmount),
    totalAmount: r2(q.totalAmount), channelFeeAmount: r2(q.channelFeeAmount),
    lines: q.lines.map((l) => ({ lineNo: l.lineNo, unitPrice: r2(l.unitPrice), discountPerCup: r2(l.discountPerCup), lineTotal: r2(l.lineTotal) })),
    promotionsApplied: q.promotionsApplied.map((p) => ({ promotionId: p.promotionId, discountAmount: r2(p.discountAmount) })),
  };
}
```
(ชื่อฟิลด์ของ `QuoteResult`/`OrderDraftLine` ให้ตรง `packages/shared/src/types.ts` — ถ้าชื่อต่าง เช่น `promotionsApplied[].promotionId` ให้แก้ตามไฟล์ types และใช้ชื่อเดียวกันใน `ParityMoney` · `import_catalog` ต้องรับ payload นี้ได้ — ถ้า `salesChannels[].rounding: "none"` ของ `store` ขัดกับ check ใดให้ดูค่าที่ 0043 อนุญาต)
- [ ] **Step 1: เขียนเทสต์ที่ต้องตก** — `packages/shared/test/db/pos_catalog.db.test.ts`

```ts
// pos_catalog.db.test.ts — ฉบับแคตตาล็อก + E1 (สเปก POS 04 §4.3–4.4 · ADR-0048)
// รันกับ Supabase บนเครื่องเท่านั้น · ข้ามเมื่อ CI=true หรือ Supabase ไม่ทำงาน · สร้างร้านใหม่ของตัวเอง

import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { connectLocalSupabase, createTestShop, Db, expectDbError } from "./helpers.js";
import type { TestShop } from "./helpers.js";
import { posParityCatalogPayload } from "./posParity.js";

const T = 120_000;
const sb = await connectLocalSupabase();

describe.skipIf(!sb)("ฉบับแคตตาล็อก + api_pos_catalog (0048)", () => {
  let svc: Db;
  let shop: TestShop;
  let clientId: string;
  const version = async () =>
    Number((await svc.select<{ version: number }>("catalog_versions", `shop_id=eq.${shop.shopId}&select=version`))[0]?.version ?? 1);
  const catalog = (known: number | null) =>
    svc.rpc<Record<string, unknown>>("api_pos_catalog", { p_shop_id: shop.shopId, p_api_client_id: clientId, p_known_version: known });

  beforeAll(async () => {
    svc = Db.service(sb!);
    shop = await createTestShop(svc, "pos-catalog");
    const imp = await svc.rpc<{ ok: boolean }>("import_catalog", {
      p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_payload: posParityCatalogPayload(), p_mode: "replace",
    });
    expect(imp.ok).toBe(true);
    const key = randomUUID();
    const [c] = await svc.insert<{ id: string }>("api_clients", {
      shop_id: shop.shopId, name: "แท็บเล็ตขาย 1", key_hash: createHash("sha256").update(key).digest("hex"),
      key_prefix: key.slice(0, 8), scopes: ["catalog:read", "staff:read", "orders:read", "orders:write"],
    });
    clientId = c!.id;
  }, T);

  it("scope staff:read ใช้ได้ (check ของตาราง + create_api_client)", async () => {
    const key = randomUUID();
    const res = await svc.rpc<Record<string, unknown>>("create_api_client", {
      p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_name: "เครื่องสำรอง", p_scopes: ["catalog:read", "staff:read"],
      p_key_hash: createHash("sha256").update(key).digest("hex"), p_key_prefix: key.slice(0, 8),
    });
    expect(res).toBeTruthy();
    const bad = await expectDbError(svc.rpc("create_api_client", {
      p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_name: "ผิด", p_scopes: ["payroll:write"],
      p_key_hash: createHash("sha256").update(`${key}x`).digest("hex"), p_key_prefix: "x1234567",
    }));
    expect(bad.code).toBe("DY422");
  });

  it("แก้ราคาตัวแปร → ฉบับเพิ่ม", async () => {
    const before = await version();
    const [v] = await svc.select<{ id: string; price: number }>(
      "menu_variants", `select=id,price,menu_items!inner(shop_id)&menu_items.shop_id=eq.${shop.shopId}&limit=1`);
    await svc.update("menu_variants", `id=eq.${v!.id}`, { price: Number(v!.price) + 1 });
    expect(await version()).toBeGreaterThan(before);
  });

  it("แก้ buy_price ของวัตถุดิบ (รับเข้า) → ฉบับไม่เพิ่ม · แก้ชื่อวัตถุดิบ → เพิ่ม", async () => {
    const [ing] = await svc.select<{ id: string; buy_price: number }>("ingredients", `shop_id=eq.${shop.shopId}&code=eq.RM-020&select=id,buy_price`);
    const before = await version();
    await svc.update("ingredients", `id=eq.${ing!.id}`, { buy_price: Number(ing!.buy_price) + 7 });
    await svc.rpc("stock_receive", {
      p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_lines: [{ ingredient_code: "RM-020", buy_qty: 1, buy_price: 55 }],
    });
    expect(await version()).toBe(before);
    await svc.update("ingredients", `id=eq.${ing!.id}`, { name: "นมสด (ใหม่)" });
    expect(await version()).toBeGreaterThan(before);
  });

  it("staff: เปลี่ยน role/สถานะ → เพิ่ม · เปลี่ยน can_see_cost → ไม่เพิ่ม", async () => {
    const before = await version();
    await svc.update("staff", `id=eq.${shop.staffId}`, { can_see_cost: true });
    expect(await version()).toBe(before);
    await svc.update("staff", `id=eq.${shop.staffId}`, { display_name: "DCm" });
    expect(await version()).toBeGreaterThan(before);
  });

  it("known_version ตรง → changed:false ไม่มี catalog/staff แต่มี pricing-less meta ครบ", async () => {
    const v = await version();
    const r = await catalog(v);
    expect(r.changed).toBe(false);
    expect(r.catalog_version).toBe(v);
    expect(r).not.toHaveProperty("catalog");
    expect(r).not.toHaveProperty("staff");
    expect(r.supported_kinds).toEqual(["order", "order_void"]);
    expect((r.supported_fields as Record<string, string[]>).order).toContain("lines.milk");
    expect(String(r.server_time)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/);
  });

  it("known_version 0/null/ไม่ตรง → changed:true รูป OrderCatalog + staff + client ไม่มีต้นทุน/LINE id", async () => {
    for (const known of [null, 0, 999_999]) {
      const r = await catalog(known);
      expect(r.changed).toBe(true);
      const cat = r.catalog as Record<string, unknown>;
      expect(Object.keys(cat).sort()).toEqual(
        ["bases", "channels", "gradeOptions", "ingredients", "milkOptions", "paymentMethods", "promotions", "settings", "variants"]);
      const text = JSON.stringify(r);
      expect(text).not.toContain("costPerUseUnit");
      expect(text).not.toContain("line_user_id");
      expect(text).not.toContain("buy_price");
      const v0 = (cat.variants as Array<Record<string, unknown>>)[0]!;
      expect(v0).toHaveProperty("categoryLabel");
      expect(v0).toHaveProperty("menuSortOrder");
      expect(v0).toHaveProperty("recipeLines");
      const staff = r.staff as Array<{ id: string; role: string; active: boolean; display_name: string | null }>;
      expect(staff.map((s) => s.id)).not.toContain(shop.pendingId);
      expect(staff.find((s) => s.id === shop.ownerId)).toMatchObject({ role: "owner", active: true });
      expect(r.client).toEqual({ name: "แท็บเล็ตขาย 1", last_receipt_no: null });
    }
  });

  it("staff สถานะ removed อยู่ในรายชื่อเป็น active:false", async () => {
    const id = randomUUID();
    await svc.insert("staff", { id, shop_id: shop.shopId, line_user_id: `U${id.replace(/-/g, "")}`, display_name: "ออกแล้ว", role: "staff", status: "removed" });
    const r = await catalog(0);
    expect((r.staff as Array<{ id: string; active: boolean }>).find((s) => s.id === id)).toMatchObject({ active: false });
  });

  it("known_version ติดลบ → DY422 · key ของร้านอื่น/ปิดใช้ → DY401", async () => {
    expect((await expectDbError(catalog(-1))).code).toBe("DY422");
    await svc.update("api_clients", `id=eq.${clientId}`, { is_active: false });
    expect((await expectDbError(catalog(0))).code).toBe("DY401");
    await svc.update("api_clients", `id=eq.${clientId}`, { is_active: true });
  });
});
```

(`posParityCatalogPayload` มาจาก Step 0 ของ task นี้ — lane อื่นห้ามสร้าง/แก้ไฟล์ `posParity.ts` · ถ้าต้องแก้ ให้ส่งกลับ lane A)

- [ ] **Step 2: รันให้ตก**

Run: `npm run db:start && npm run db:reset && npx vitest run --root packages/shared test/db/pos_catalog.db.test.ts`
Expected: FAIL — `function public.api_pos_catalog(...) does not exist` / relation `catalog_versions` does not exist

- [ ] **Step 3: เขียน migration** — `supabase/migrations/0048_pos_catalog_version.sql`

```sql
-- 0048_pos_catalog_version — ฉบับแคตตาล็อก + E1 GET /v1/pos/catalog (ADR-0048 · สเปก POS 04 §4.3–4.4)
-- ไม่แก้ไฟล์เก่า (กฎเหล็กข้อ 13) · ของใหม่: catalog_versions + trigger · scope staff:read · dayo_iso_ms ·
-- dayo_pos_supported · dayo_catalog_version · api_pos_catalog

-- ═════════════════════════════════════════════════════════════════════════════════
-- 1. ฉบับแคตตาล็อก (1 แถวต่อร้าน · ผู้ใช้เทียบแค่เท่ากัน/ไม่เท่ากัน ห้ามคิดว่าเลขต่อเนื่อง)
-- ═════════════════════════════════════════════════════════════════════════════════
create table public.catalog_versions (
  shop_id uuid primary key references public.shops (id) on delete restrict,
  version bigint not null default 1 check (version >= 1),
  changed_at timestamptz not null default now()
);
alter table public.catalog_versions enable row level security;
insert into public.catalog_versions (shop_id) select s.id from public.shops s on conflict do nothing;

create or replace function public.dayo_catalog_version(p_shop_id uuid)
returns bigint
language sql
stable
set search_path = public
as $$ select coalesce((select cv.version from public.catalog_versions cv where cv.shop_id = p_shop_id), 1) $$;

create or replace function public.dayo_catalog_bump()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_row record;
  v_shop uuid;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  if tg_table_name in ('menu_items', 'bases', 'menu_options', 'sales_channels', 'payment_methods',
                       'promotions', 'shop_settings', 'staff', 'ingredients') then
    v_shop := v_row.shop_id;
  elsif tg_table_name = 'menu_variants' then
    select m.shop_id into v_shop from public.menu_items m where m.id = v_row.menu_item_id;
  elsif tg_table_name = 'recipe_lines' then
    select m.shop_id into v_shop from public.menu_variants v join public.menu_items m on m.id = v.menu_item_id
    where v.id = v_row.variant_id;
  elsif tg_table_name = 'base_lines' then
    select b.shop_id into v_shop from public.bases b where b.id = v_row.base_id;
  end if;
  if v_shop is null then
    return null;
  end if;
  insert into public.catalog_versions as cv (shop_id, version, changed_at) values (v_shop, 2, now())
  on conflict (shop_id) do update set version = cv.version + 1, changed_at = now();
  return null;
end;
$$;

create trigger menu_items_catalog_bump after insert or update or delete on public.menu_items
  for each row execute function public.dayo_catalog_bump();
create trigger menu_variants_catalog_bump after insert or update or delete on public.menu_variants
  for each row execute function public.dayo_catalog_bump();
create trigger recipe_lines_catalog_bump after insert or update or delete on public.recipe_lines
  for each row execute function public.dayo_catalog_bump();
create trigger bases_catalog_bump after insert or update or delete on public.bases
  for each row execute function public.dayo_catalog_bump();
create trigger base_lines_catalog_bump after insert or update or delete on public.base_lines
  for each row execute function public.dayo_catalog_bump();
create trigger menu_options_catalog_bump after insert or update or delete on public.menu_options
  for each row execute function public.dayo_catalog_bump();
create trigger sales_channels_catalog_bump after insert or update or delete on public.sales_channels
  for each row execute function public.dayo_catalog_bump();
create trigger payment_methods_catalog_bump after insert or update or delete on public.payment_methods
  for each row execute function public.dayo_catalog_bump();
create trigger promotions_catalog_bump after insert or update or delete on public.promotions
  for each row execute function public.dayo_catalog_bump();
create trigger shop_settings_catalog_bump after insert or update or delete on public.shop_settings
  for each row execute function public.dayo_catalog_bump();
-- staff: เฉพาะเมื่อ display_name/role/status เปลี่ยน (E1 มีแค่ 3 ค่านี้) · แถว pending ใหม่ไม่อยู่ใน E1
create trigger staff_catalog_bump after update of display_name, role, status on public.staff
  for each row when (old.display_name is distinct from new.display_name or old.role is distinct from new.role
                     or old.status is distinct from new.status)
  execute function public.dayo_catalog_bump();
-- ingredients: รับเข้าที่แก้ buy_price ไม่ทำให้ฉบับเปลี่ยน
create trigger ingredients_catalog_bump_ins_del after insert or delete on public.ingredients
  for each row execute function public.dayo_catalog_bump();
create trigger ingredients_catalog_bump_upd after update of code, name, use_unit, is_active on public.ingredients
  for each row when (old.code is distinct from new.code or old.name is distinct from new.name
                     or old.use_unit is distinct from new.use_unit or old.is_active is distinct from new.is_active)
  execute function public.dayo_catalog_bump();

-- ═════════════════════════════════════════════════════════════════════════════════
-- 2. scope ใหม่ staff:read (ตาราง + ตัวตรวจของ create_api_client/save_api_client ใน 0044)
-- ═════════════════════════════════════════════════════════════════════════════════
-- CHECK ของตาราง (สร้างแบบไม่ตั้งชื่อใน 0001 → ชื่ออัตโนมัติ api_clients_scopes_check · ถ้าไม่ตรง ให้ดูจาก
--   select conname from pg_constraint where conrelid = 'public.api_clients'::regclass and contype = 'c';)
alter table public.api_clients drop constraint api_clients_scopes_check;
alter table public.api_clients add constraint api_clients_scopes_check
  check (scopes <@ array['catalog:read', 'staff:read', 'orders:read', 'orders:write', 'stock:read', 'stock:write']::text[]);

-- ตัวตรวจของ create_api_client/save_api_client (ลอก 0044 ข้อ 6 · เพิ่ม staff:read)
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
  where s is null or s <> all (array['catalog:read', 'staff:read', 'orders:read', 'orders:write', 'stock:read', 'stock:write']);
  if v_bad is not null then
    raise exception using errcode = 'DY422',
      message = format('invalid: scope ไม่ถูกต้อง (%s) — ใช้ได้เฉพาะ catalog:read, staff:read, orders:read, orders:write, stock:read, stock:write ค่ะ', v_bad);
  end if;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 3. เวลาแบบมีมิลลิวินาที · ชนิด/ฟิลด์ที่ E2 รุ่นนี้รับ (ต้องตรงกับ api_pos_push — Task 3a/3b ใช้ตัวเดียวกัน)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_iso_ms(p timestamptz)
returns text
language sql
immutable
set search_path = public
as $$ select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || '+00:00' $$;

create or replace function public.dayo_pos_supported()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'supported_kinds', jsonb_build_array('order', 'order_void'),
    'supported_fields', jsonb_build_object(
      'order', jsonb_build_array('pos_order_id', 'receipt_no', 'queue_no', 'sale_date', 'sold_at', 'channel', 'payment',
        'staff_id', 'catalog_version', 'shift_id', 'lines', 'lines.code', 'lines.size', 'lines.sweetness', 'lines.milk',
        'lines.grade', 'lines.qty', 'lines.free', 'lines.discount_baht', 'lines.discount_percent', 'lines.discount_reason',
        'bill_discount', 'promo_code', 'skip_promotion_ids', 'no_promotions', 'totals', 'note'),
      'order_void', jsonb_build_array('pos_order_id', 'voided_at', 'staff_id', 'approved_by', 'reason')))
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 4. E1 — api_pos_catalog (Route ต่อ "pricing" ให้เอง — Task 7) · ไม่มีต้นทุนเสมอ (ADR-0035 ข้อ 3)
-- ═════════════════════════════════════════════════════════════════════════════════
create index orders_api_client_created_idx on public.orders (api_client_id, created_at desc) where external_ref is not null;

create or replace function public.api_pos_catalog(p_shop_id uuid, p_api_client_id uuid, p_known_version bigint default null)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_version bigint := public.dayo_catalog_version(p_shop_id);
  v_base jsonb;
  v_full jsonb;
  v_meta jsonb;
  c public.api_clients;
begin
  select * into c from public.api_clients x where x.id = p_api_client_id and x.shop_id = p_shop_id;
  if p_shop_id is null or not found or not c.is_active then
    raise exception using errcode = 'DY401', message = 'invalid_key: API key ไม่ถูกต้องหรือถูกปิดใช้งาน';
  end if;
  if p_known_version is not null and p_known_version < 0 then
    raise exception using errcode = 'DY422', message = 'invalid: known_version ต้องเป็นจำนวนเต็ม ≥ 0';
  end if;

  v_base := jsonb_build_object('catalog_version', v_version, 'server_time', public.dayo_iso_ms(now()))
            || public.dayo_pos_supported();
  if p_known_version is not null and p_known_version = v_version then
    return v_base || jsonb_build_object('changed', false);
  end if;

  v_full := public.dayo_impl_get_full_catalog(p_shop_id);
  select jsonb_object_agg(m.code, jsonb_build_object('categoryLabel', coalesce(m.category_label, m.family),
                                                     'menuSortOrder', m.sort_order))
  into v_meta
  from public.menu_items m where m.shop_id = p_shop_id;
  v_full := jsonb_set(v_full, '{variants}', coalesce((
    select jsonb_agg(v || coalesce(v_meta -> (v ->> 'menuCode'), '{}'::jsonb) order by o)
    from jsonb_array_elements(v_full -> 'variants') with ordinality t(v, o)), '[]'::jsonb));
  v_full := jsonb_set(v_full, '{ingredients}', coalesce((
    select jsonb_object_agg(k, val - 'costPerUseUnit') from jsonb_each(v_full -> 'ingredients') e(k, val)), '{}'::jsonb));

  return v_base || jsonb_build_object(
    'changed', true,
    'client', jsonb_build_object('name', c.name, 'last_receipt_no', (
      select o.external_ref from public.orders o
      where o.api_client_id = c.id and o.external_ref is not null
      order by o.created_at desc limit 1)),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'display_name', s.display_name, 'role', s.role,
                                          'active', s.status = 'active') order by s.created_at, s.id)
      from public.staff s where s.shop_id = p_shop_id and s.status in ('active', 'removed')), '[]'::jsonb),
    'catalog', v_full);
end;
$$;

-- ── สิทธิ์: เฉพาะ service_role ─────────────────────────────────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
```

- [ ] **Step 4: รันให้ผ่าน + สร้าง types**

Run: `npm run db:reset && npx vitest run --root packages/shared test/db/pos_catalog.db.test.ts && npm run db:types`
Expected: PASS ทั้ง 7 เคส · `database.types.ts` มี `catalog_versions` และ `api_pos_catalog`

- [ ] **Step 5: รันเทสต์ฐานข้อมูลเดิมทั้งหมด (กันถอยหลัง)**

Run: `npx vitest run --root packages/shared test/db`
Expected: PASS ทุกไฟล์ (trigger ใหม่ไม่ทำให้ import_catalog/เทสต์เดิมพัง)

- [ ] **Step 6: Commit** (เมื่อเจ้าของสั่ง · skill `committing-code`)
```bash
git add supabase/migrations/0048_pos_catalog_version.sql packages/shared/test/db/pos_catalog.db.test.ts packages/shared/test/db/posParity.ts packages/shared/src/database.types.ts
git commit -m "feat(db): add catalog version and the pos catalog rpc"
```

---

## Task 2: บิลบอกแหล่ง/ผู้บันทึก · ธงบิลซ้ำ · บิล POS อ่านอย่างเดียว · ล็อกรหัส (migration 0049)

**agent:** db-engineer · opus · high (lane A · ใช้ Docker)

**Files:**
- Create: `supabase/migrations/0049_pos_bill_source_duplicates.sql`
- Create: `packages/shared/test/db/pos_bills.db.test.ts`
- Modify: `packages/shared/src/database.types.ts`, `apps/web/src/lib/backup.ts`, `scripts/restore.ts` (เพิ่ม `order_duplicate_flags` ในรายการตาราง)

**Interfaces:**
- Consumes: `dayo_catalog_version` (Task 1) · `dayo_impl_create_order` (0008 ตัวที่ 0012 เปลี่ยนชื่อ) · `update_order` (0047) · `cancel_order` (0008) · `dayo_check_order_edit` · `dayo_require_actor` (0012)
- Produces:
  - `orders`: `pos_order_id uuid` · `pos_queue_no integer` · `pos_shift_id uuid` · `pos_computed_total numeric(10,2)` · `catalog_version bigint` · `sold_at timestamptz` · `items_signature text`
  - `order_duplicate_flags (id, shop_id, order_a_id, order_b_id, detected_at, status, resolved_by, resolved_at, resolution_note)`
  - `dayo_order_items_signature(p_order_id uuid) returns text`
  - `dayo_order_refresh_signature(p_order_id uuid) returns void`
  - `dayo_detect_duplicates(p_order_id uuid) returns text[]` (order_no ของคู่ที่ติดธงใหม่)
  - `dayo_order_duplicate_of(p_order_id uuid) returns jsonb` (อาร์เรย์ order_no ของคู่ที่ธงยัง open)
  - `dayo_order_cancel_core(p_order_id uuid, p_staff_id uuid, p_client_id uuid, p_reason text, p_cancelled_at timestamptz, p_audit_extra jsonb) returns void`
  - ร่าง `create_order` รับ `p_draft.pos = {pos_order_id, queue_no, shift_id, catalog_version, sold_at}` (เฉพาะ actor ที่มี `api_client_id`)
  - `DY409 external_ref_taken:` · `DY403 pos_bill_read_only:` · `DY422` ล็อกรหัส

- [ ] **Step 1: เขียนเทสต์ที่ต้องตก** — `packages/shared/test/db/pos_bills.db.test.ts`

```ts
// pos_bills.db.test.ts — แหล่ง/ผู้บันทึก · ธงบิลซ้ำ · บิล POS อ่านอย่างเดียว · ล็อกรหัส (ADR-0049 · สเปก POS 04 §4.7–4.9)
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { bkkDay } from "../../src/time.js";
import { connectLocalSupabase, createTestShop, Db, expectDbError } from "./helpers.js";
import type { TestShop } from "./helpers.js";
import { posParityCatalogPayload } from "./posParity.js";

const T = 120_000;
const sb = await connectLocalSupabase();

describe.skipIf(!sb)("บิล POS: แหล่ง ผู้บันทึก ธงซ้ำ (0049)", () => {
  let svc: Db;
  let shop: TestShop;
  let clientId: string;
  const today = bkkDay(0);
  let receiptSeq = 100;

  const line = { code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", qty: 1 };
  async function botBill(): Promise<{ order_no: string }> {
    return svc.rpc("create_order", {
      p_shop_id: shop.shopId, p_actor: { staff_id: shop.staffId },
      p_draft: { sale_date: today, channel: "store", payment: "cash", source: "line", no_promotions: true, lines: [line] },
    });
  }
  async function posBill(minutesAgo: number): Promise<{ order_no: string; duplicate_of?: string[] }> {
    const soldAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const posId = randomUUID();
    return svc.rpc("create_order", {
      p_shop_id: shop.shopId, p_actor: { api_client_id: clientId, staff_id: shop.staffId },
      p_draft: {
        sale_date: today, channel: "store", payment: "cash", no_promotions: true, lines: [line],
        pos_amounts: { items_subtotal: 35, items_discount: 0, bill_discount: 0, total: 35 },
        pos: { pos_order_id: posId, queue_no: 1, shift_id: null, catalog_version: 1, sold_at: soldAt },
      },
      p_idempotency: { external_ref: `A-${String(receiptSeq++).padStart(6, "0")}` },
    });
  }
  const row = async (orderNo: string) =>
    (await svc.select<Record<string, unknown>>("orders", `shop_id=eq.${shop.shopId}&order_no=eq.${orderNo}&select=*`))[0]!;
  const openFlagsOf = async (orderNo: string) => {
    const o = await row(orderNo);
    return svc.select("order_duplicate_flags", `status=eq.open&or=(order_a_id.eq.${o.id},order_b_id.eq.${o.id})&select=id`);
  };

  beforeAll(async () => {
    svc = Db.service(sb!);
    shop = await createTestShop(svc, "pos-bills");
    await svc.rpc("import_catalog", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_payload: posParityCatalogPayload(), p_mode: "replace" });
    await svc.rpc("save_shop_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { default_milk: "fresh" } });
    const key = randomUUID();
    const [c] = await svc.insert<{ id: string }>("api_clients", {
      shop_id: shop.shopId, name: "แท็บเล็ตขาย 1", key_hash: createHash("sha256").update(key).digest("hex"),
      key_prefix: key.slice(0, 8), scopes: ["orders:read", "orders:write"],
    });
    clientId = c!.id;
  }, T);

  it("บิลบอทวันนี้: sold_at = เวลาบันทึก · catalog_version = ฉบับปัจจุบัน · items_signature ตามรูปสเปก", async () => {
    const b = await botBill();
    const r = await row(b.order_no);
    expect(r.sold_at).not.toBeNull();
    expect(Number(r.catalog_version)).toBeGreaterThanOrEqual(1);
    expect(r.items_signature).toBe("Thai Tea|16 oz|50%|fresh|×1");
    expect(r.pos_computed_total).toBeNull();
  });

  it("บิล POS เก็บ pos_* + pos_computed_total ทุกบิล (ไม่ใช่แค่ตอนติดธง)", async () => {
    const p = await posBill(1);
    const r = await row(p.order_no);
    expect(r.source).toBe("pos");
    expect(r.pos_order_id).toBeTruthy();
    expect(r.pos_queue_no).toBe(1);
    expect(Number(r.pos_computed_total)).toBe(35);
    expect(r.created_by).toBe(shop.staffId);
  });

  it("บอท + POS รายการ/ยอดเดียวกันห่าง 9 นาที = ติดธง · 11 นาที = ไม่ติด · แหล่งเดียวกัน = ไม่ติด", async () => {
    // ร้านแยกของเคสนี้ — บิลจากเคสอื่นที่รายการเดียวกันจะไม่ปนนับธง
    const prev = { shop, clientId };
    shop = await createTestShop(svc, "pos-dup");
    await svc.rpc("import_catalog", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_payload: posParityCatalogPayload(), p_mode: "replace" });
    await svc.rpc("save_shop_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { default_milk: "fresh" } });
    const key = randomUUID();
    const [c] = await svc.insert<{ id: string }>("api_clients", {
      shop_id: shop.shopId, name: "แท็บเล็ตขาย 1", key_hash: createHash("sha256").update(key).digest("hex"),
      key_prefix: key.slice(0, 8), scopes: ["orders:read", "orders:write"],
    });
    clientId = c!.id;
    try {
      const b = await botBill();                       // sold_at = ตอนนี้
      const p9 = await posBill(9);
      expect(p9.duplicate_of).toEqual([b.order_no]);
      expect(await openFlagsOf(b.order_no)).toHaveLength(1);
      const p11 = await posBill(11);
      expect(p11.duplicate_of).toEqual([]);
      const p9b = await posBill(9);                    // POS กับ POS (แหล่งเดียวกัน) ห่าง 0 นาที — ไม่จับคู่กัน
      expect(p9b.duplicate_of).toEqual([b.order_no]); // จับกับบิลบอทเท่านั้น
      expect(await openFlagsOf(p9.order_no)).toHaveLength(1);
    } finally {
      ({ shop, clientId } = prev);
    }
  }, T);

  it("ยกเลิกบิลบอทที่ติดธง → ธงปิดเป็น resolved_cancelled", async () => {
    const b = await botBill();
    await posBill(2);
    await svc.rpc("cancel_order", { p_shop_id: shop.shopId, p_actor: { staff_id: shop.staffId }, p_order_no: b.order_no, p_reason: "ซ้ำ" });
    expect(await openFlagsOf(b.order_no)).toHaveLength(0);
  });

  it("owner แก้/ยกเลิกบิล POS บนเว็บหรือบอท = DY403 pos_bill_read_only", async () => {
    const p = await posBill(1);
    const r = await row(p.order_no);
    const e1 = await expectDbError(svc.rpc("update_order", {
      p_shop_id: shop.shopId, p_actor: { staff_id: shop.ownerId }, p_order_no: p.order_no,
      p_expected_version: r.version, p_changes: { note: "แก้" },
    }));
    expect(e1.code).toBe("DY403");
    expect(e1.message).toMatch(/^pos_bill_read_only:/);
    const e2 = await expectDbError(svc.rpc("cancel_order", {
      p_shop_id: shop.shopId, p_actor: { staff_id: shop.ownerId }, p_order_no: p.order_no, p_reason: "x" }));
    expect(e2.code).toBe("DY403");
  });

  it("external_ref เดิม + pos_order_id ต่าง → DY409 external_ref_taken (ไม่คืนบิลเดิม)", async () => {
    const posId = randomUUID();
    const draft = (id: string) => ({
      sale_date: today, channel: "store", payment: "cash", no_promotions: true, lines: [line],
      pos_amounts: { items_subtotal: 35, items_discount: 0, bill_discount: 0, total: 35 },
      pos: { pos_order_id: id, queue_no: 2, shift_id: null, catalog_version: 1, sold_at: new Date().toISOString() },
    });
    const call = (id: string) => svc.rpc<{ duplicate: boolean }>("create_order", {
      p_shop_id: shop.shopId, p_actor: { api_client_id: clientId, staff_id: shop.staffId },
      p_draft: draft(id), p_idempotency: { external_ref: "A-900001" } });
    expect((await call(posId)).duplicate).toBe(false);
    expect((await call(posId)).duplicate).toBe(true);
    const e = await expectDbError(call(randomUUID()));
    expect(e.code).toBe("DY409");
    expect(e.message).toMatch(/^external_ref_taken:/);
  });

  it("เปลี่ยนรหัสเมนู/ช่องทาง/วิธีชำระที่มีบิลอ้าง = DY422 · ที่ยังไม่มีบิลอ้าง = เปลี่ยนได้", async () => {
    await botBill();
    const [m] = await svc.select<{ id: string }>("menu_items", `shop_id=eq.${shop.shopId}&code=eq.Thai Tea&select=id`);
    expect((await expectDbError(svc.update("menu_items", `id=eq.${m!.id}`, { code: "Thai Tea X" }))).code).toBe("DY422");
    const [ch] = await svc.select<{ id: string }>("sales_channels", `shop_id=eq.${shop.shopId}&code=eq.store&select=id`);
    expect((await expectDbError(svc.update("sales_channels", `id=eq.${ch!.id}`, { code: "shop" }))).code).toBe("DY422");
    const [pm] = await svc.select<{ id: string }>("payment_methods", `shop_id=eq.${shop.shopId}&code=eq.cash&select=id`);
    expect((await expectDbError(svc.update("payment_methods", `id=eq.${pm!.id}`, { code: "cash2" }))).code).toBe("DY422");
    const [unused] = await svc.select<{ id: string }>("menu_items", `shop_id=eq.${shop.shopId}&code=eq.Lemon Tea&select=id`);
    await svc.update("menu_items", `id=eq.${unused!.id}`, { code: "Lemon Tea 2" });
    await svc.update("menu_items", `id=eq.${unused!.id}`, { code: "Lemon Tea" });
  });

  it("check: บิลที่มี pos_order_id ต้องเป็น source='pos' และมี external_ref + created_by · POST /v1/orders เดิม (ไม่มี pos) ยังบันทึกได้", async () => {
    const e = await expectDbError(svc.rpc("create_order", {
      p_shop_id: shop.shopId, p_actor: { api_client_id: clientId },   // ไม่มี staff_id → created_by ว่าง
      p_draft: { sale_date: today, channel: "store", payment: "cash", no_promotions: true, lines: [line],
                 pos_amounts: { total: 35 },
                 pos: { pos_order_id: randomUUID(), queue_no: 3, shift_id: null, catalog_version: 1, sold_at: new Date().toISOString() } },
      p_idempotency: { external_ref: "A-900777" } }));
    expect(e.code).toBe("23514");
    const legacy = await svc.rpc<{ duplicate: boolean }>("create_order", {
      p_shop_id: shop.shopId, p_actor: { api_client_id: clientId },
      p_draft: { sale_date: today, channel: "store", payment: "cash", no_promotions: true, lines: [line], pos_amounts: { total: 35 } },
      p_idempotency: { external_ref: "LEGACY-1" } });
    expect(legacy.duplicate).toBe(false);
  });
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npm run db:reset && npx vitest run --root packages/shared test/db/pos_bills.db.test.ts`
Expected: FAIL — column `sold_at` does not exist / `update_order` ไม่ตอบ DY403

- [ ] **Step 3: เขียน migration** — `supabase/migrations/0049_pos_bill_source_duplicates.sql`

```sql
-- 0049_pos_bill_source_duplicates — แหล่ง/ผู้บันทึก · ธงบิลน่าจะซ้ำ · บิล POS อ่านอย่างเดียว · ล็อกรหัสที่ถูกอ้าง
-- (ADR-0049 · สเปก POS 04 §4.7–4.9) · ไม่แก้ไฟล์เก่า — ลอกฟังก์ชันรุ่นล่าสุดมาแก้เฉพาะจุดที่มีป้าย "-- ADR-0049"

-- ═════════════════════════════════════════════════════════════════════════════════
-- 1. คอลัมน์ใหม่ของ orders
-- ═════════════════════════════════════════════════════════════════════════════════
alter table public.orders
  add column pos_order_id uuid,
  add column pos_queue_no integer check (pos_queue_no between 1 and 9999),
  add column pos_shift_id uuid,                 -- ไม่มี FK: ผูกกะทีหลังได้ (ก้อน 3)
  add column pos_computed_total numeric(10,2),  -- ยอดที่ระบบคิดเองของทุกบิล POS
  add column catalog_version bigint,
  add column sold_at timestamptz,
  add column items_signature text;
create unique index orders_api_client_pos_order_key on public.orders (api_client_id, pos_order_id) where pos_order_id is not null;
create index orders_shop_date_total_idx on public.orders (shop_id, sale_date, total_amount);
-- สเปก §4.9 เขียน "source='pos' ⇒ pos_order_id, external_ref, created_by ไม่ว่าง" แต่ §4.1 ล็อกว่า POST /v1/orders เดิม
-- "คงอยู่ไม่เปลี่ยน" (บิล source='pos' ที่ไม่มี pos_order_id และ staff ไม่บังคับ) → บังคับกับบิลที่มาทาง E2 (มี pos_order_id) เท่านั้น
-- (จุดตีความ — อยู่ใน ADR-0049 ตาม Task 0 Step 2)
alter table public.orders add constraint orders_pos_fields_required
  check (pos_order_id is null or (source = 'pos' and external_ref is not null and created_by is not null)) not valid;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 2. ธงบิลน่าจะซ้ำ (RLS เปิด ไม่มี policy · ลงไฟล์สำรอง)
-- ═════════════════════════════════════════════════════════════════════════════════
create table public.order_duplicate_flags (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  order_a_id uuid not null,
  order_b_id uuid not null,
  detected_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'resolved_not_duplicate', 'resolved_cancelled')),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) between 1 and 200),
  constraint order_duplicate_flags_pair_order check (order_a_id < order_b_id),
  constraint order_duplicate_flags_pair_key unique (order_a_id, order_b_id),
  constraint order_duplicate_flags_a_fkey foreign key (shop_id, order_a_id) references public.orders (shop_id, id) on delete restrict,
  constraint order_duplicate_flags_b_fkey foreign key (shop_id, order_b_id) references public.orders (shop_id, id) on delete restrict,
  constraint order_duplicate_flags_resolved_by_fkey foreign key (shop_id, resolved_by) references public.staff (shop_id, id) on delete restrict,
  constraint order_duplicate_flags_resolved_fields check (status = 'open' or resolved_at is not null)
);
create index order_duplicate_flags_shop_status_idx on public.order_duplicate_flags (shop_id, status);
create index order_duplicate_flags_b_idx on public.order_duplicate_flags (order_b_id);
alter table public.order_duplicate_flags enable row level security;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 3. ลายเซ็นรายการ + ตรวจซ้ำ
-- ═════════════════════════════════════════════════════════════════════════════════
-- รวม qty ตามคีย์ menu_code|size|sweetness|milk_code|grade_code เรียงคีย์ (collate "C") ต่อด้วย ";" · ส่วนลดไม่นับ
create or replace function public.dayo_order_items_signature(p_order_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select string_agg(k || '×' || q, ';' order by k collate "C")
  from (
    select i.menu_code || '|' || i.size || '|' || i.sweetness || '|' || coalesce(i.milk_code, '') || '|' || coalesce(i.grade_code, '') as k,
           sum(i.qty)::text as q
    from public.order_items i where i.order_id = p_order_id
    group by 1
  ) t
$$;

create or replace function public.dayo_order_refresh_signature(p_order_id uuid)
returns void
language sql
set search_path = public
as $$ update public.orders o set items_signature = public.dayo_order_items_signature(o.id) where o.id = p_order_id $$;

create or replace function public.dayo_detect_duplicates(p_order_id uuid)
returns text[]
language plpgsql
set search_path = public
as $$
declare
  o public.orders;
  r record;
  v_nos text[] := '{}';
begin
  select * into o from public.orders x where x.id = p_order_id;
  if not found or o.status <> 'ok' or o.sold_at is null or o.items_signature is null then
    return v_nos;
  end if;
  for r in
    select x.id, x.order_no from public.orders x
    where x.shop_id = o.shop_id and x.sale_date = o.sale_date and x.total_amount = o.total_amount
      and x.status = 'ok' and x.source <> o.source and x.id <> o.id and x.sold_at is not null
      and abs(extract(epoch from (x.sold_at - o.sold_at))) <= 600
      and x.items_signature = o.items_signature
  loop
    insert into public.order_duplicate_flags (shop_id, order_a_id, order_b_id)
    values (o.shop_id, least(o.id, r.id), greatest(o.id, r.id))
    on conflict (order_a_id, order_b_id) do nothing;
    v_nos := v_nos || r.order_no;
  end loop;
  return v_nos;
end;
$$;

create or replace function public.dayo_order_duplicate_of(p_order_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(x.order_no order by x.order_no), '[]'::jsonb)
  from public.order_duplicate_flags f
  join public.orders x on x.id = case when f.order_a_id = p_order_id then f.order_b_id else f.order_a_id end
  where f.status = 'open' and (f.order_a_id = p_order_id or f.order_b_id = p_order_id)
$$;

-- เติมของเก่า: sold_at = created_at เมื่อวันที่ไทยของ created_at = sale_date · items_signature ทุกบิล
-- (ปิด trigger ของผู้ใช้ชั่วคราว ไม่ให้ updated_at ของบิลเก่าเปลี่ยน — GET /v1/orders?updated_since ไม่ถูกท่วม)
alter table public.orders disable trigger user;
update public.orders o set sold_at = o.created_at
where o.sold_at is null and (o.created_at at time zone 'Asia/Bangkok')::date = o.sale_date;
update public.orders o set items_signature = public.dayo_order_items_signature(o.id) where o.items_signature is null;
alter table public.orders enable trigger user;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 4. ผู้กระทำ: POS ระบุพนักงาน active หรือ removed ได้ (ระบุผู้ทำเท่านั้น — ADR-0040 ข้อ 1 · ADR-0049)
--    ลอก 0012 dayo_require_actor ทุกบรรทัด เปลี่ยนเฉพาะบล็อก "if v_staff_id is not null"
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_require_actor(p_shop_id uuid, p_actor jsonb, p_scope text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_staff_id uuid := public.dayo_j_uuid(p_actor, 'staff_id');
  v_client_id uuid := public.dayo_j_uuid(p_actor, 'api_client_id');
  s public.staff;
  c public.api_clients;
begin
  if p_shop_id is null or (v_staff_id is null and v_client_id is null) then
    raise exception using errcode = 'DY401', message = 'actor_required: ต้องระบุร้านและพนักงานหรือ API client';
  end if;
  if v_client_id is not null then
    select * into c from public.api_clients x where x.id = v_client_id and x.shop_id = p_shop_id;
    if not found or not c.is_active then
      raise exception using errcode = 'DY401', message = 'api_client_not_active: API client ไม่ถูกต้องหรือถูกปิด';
    end if;
    if p_scope is not null and not (p_scope = any (c.scopes)) then
      raise exception using errcode = 'DY403', message = format('forbidden: API client ไม่มีสิทธิ์ %s', p_scope);
    end if;
    perform set_config('dayo.api_client_id', c.id::text, true);
    perform set_config('dayo.shop_id', p_shop_id::text, true);
  end if;
  if v_staff_id is not null then
    if c.id is not null and current_setting('dayo.pos_push', true) = '1' then
      -- ADR-0049: เฉพาะแถวที่มาทาง api_pos_push (E2 ตั้ง dayo.pos_push = '1' ในธุรกรรม) — ขายไปก่อนพนักงานถูกปลด → ยังบันทึกชื่อได้
      -- POST/PATCH /v1/orders เดิมและ actor อื่นทั้งหมดยังต้องเป็นพนักงาน active ตามเดิม
      select * into s from public.staff x where x.id = v_staff_id and x.shop_id = p_shop_id and x.status in ('active', 'removed');
      if not found then
        raise exception using errcode = 'DY401', message = 'staff_not_active: ไม่พบพนักงานที่ระบุของร้านนี้';
      end if;
      perform set_config('dayo.staff_id', s.id::text, true);
    else
      s := public.dayo_require_staff(p_shop_id, v_staff_id, null);   -- active เท่านั้น (เดิม)
    end if;
  end if;
  if c.id is not null then
    return jsonb_build_object('staff_id', s.id, 'role', null, 'api_client_id', c.id, 'can_see_cost', false, 'is_pos', true);
  end if;
  return jsonb_build_object('staff_id', s.id, 'role', s.role, 'api_client_id', null,
    'can_see_cost', coalesce(s.role = 'owner' or s.can_see_cost, false), 'is_pos', false);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 5. สิทธิ์แก้/ยกเลิก: บิล POS อ่านอย่างเดียวบนเว็บ/บอท (ลอก 0012 + บรรทัดแรก)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_check_order_edit(p_actor jsonb, o public.orders)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_role text := p_actor ->> 'role';
  v_staff uuid := (p_actor ->> 'staff_id')::uuid;
  v_client uuid := (p_actor ->> 'api_client_id')::uuid;
begin
  -- ADR-0049: บิลจากแท็บเล็ตมีผู้เขียนคนเดียว (แท็บเล็ต) — แม้ owner ก็แก้/ยกเลิกจากเว็บ/บอทไม่ได้
  if o.source = 'pos' and v_client is null then
    raise exception using errcode = 'DY403',
      message = 'pos_bill_read_only: บิลจากแท็บเล็ต POS แก้หรือยกเลิกได้ที่แท็บเล็ตเท่านั้นค่ะ';
  end if;
  if v_client is not null then
    if o.source <> 'pos' or o.api_client_id is distinct from v_client then
      raise exception using errcode = 'DY403', message = 'forbidden: API client แก้/ยกเลิกได้เฉพาะบิลที่ตัวเองส่ง';
    end if;
  elsif v_role = 'owner' then
    return;
  elsif v_staff is null or o.created_by is distinct from v_staff then
    raise exception using errcode = 'DY403', message = 'forbidden: แก้/ยกเลิกได้เฉพาะบิลที่ตัวเองบันทึก (ADR-0029)';
  end if;
  if o.sale_date <> public.dayo_today() then
    raise exception using errcode = 'DY403', message = 'forbidden: แก้/ยกเลิกได้เฉพาะบิลของวันนี้ (ADR-0029)';
  end if;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 6. ยกเลิกบิล: แกนกลางเดียว (cancel_order เดิม + order_void ของ E2 ใน Task 3b) · ปิดธงซ้ำเอง
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_order_cancel_core(
  p_order_id uuid, p_staff_id uuid, p_client_id uuid, p_reason text, p_cancelled_at timestamptz, p_audit_extra jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_shop uuid;
  v_before jsonb := public.dayo_order_snapshot(p_order_id);
begin
  update public.orders x set status = 'cancelled', cancelled_by = p_staff_id, cancelled_at = coalesce(p_cancelled_at, now()),
    cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), version = x.version + 1
  where x.id = p_order_id
  returning x.shop_id into v_shop;
  perform public.dayo_order_sync_stock(p_order_id, p_staff_id);
  update public.order_duplicate_flags f set status = 'resolved_cancelled', resolved_at = now(), resolved_by = p_staff_id
  where f.status = 'open' and (f.order_a_id = p_order_id or f.order_b_id = p_order_id);
  insert into public.audit_log (shop_id, entity, entity_id, action, before, after, staff_id, api_client_id)
  values (v_shop, 'orders', p_order_id, 'order_cancel', v_before,
          public.dayo_order_snapshot(p_order_id) || coalesce(p_audit_extra, '{}'::jsonb), p_staff_id, p_client_id);
end;
$$;

-- cancel_order (ลอก 0008 · เปลี่ยนเฉพาะตัวยกเลิกเป็น dayo_order_cancel_core)
create or replace function public.cancel_order(p_shop_id uuid, p_actor jsonb, p_order_no text, p_reason text default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_actor jsonb := public.dayo_require_actor(p_shop_id, p_actor, 'orders:write');
  v_staff_id uuid := (v_actor ->> 'staff_id')::uuid;
  v_client_id uuid := (v_actor ->> 'api_client_id')::uuid;
  o public.orders;
  v_res jsonb;
begin
  select * into o from public.orders x where x.shop_id = p_shop_id and x.order_no = p_order_no for update;
  if not found then
    raise exception using errcode = 'DY404', message = format('not_found: ไม่พบบิล %s', p_order_no);
  end if;
  perform public.dayo_check_order_edit(v_actor, o);
  if o.status = 'cancelled' then
    v_res := public.dayo_order_result(o.id) || jsonb_build_object('duplicate', true);
  else
    perform public.dayo_order_cancel_core(o.id, v_staff_id, v_client_id, p_reason, null, null);
    v_res := public.dayo_order_result(o.id) || jsonb_build_object('duplicate', false);
  end if;
  return case when (v_actor ->> 'can_see_cost')::boolean then v_res else public.dayo_strip_cost(v_res) end;
end;
$$;

-- update_order: ห่อตัวเดิม (0047) แล้วคิดลายเซ็น + ตรวจซ้ำใหม่ทุกครั้งที่แก้
alter function public.update_order(uuid, jsonb, text, integer, jsonb) rename to dayo_impl_update_order;
create or replace function public.update_order(
  p_shop_id uuid, p_actor jsonb, p_order_no text, p_expected_version integer, p_changes jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_res jsonb := public.dayo_impl_update_order(p_shop_id, p_actor, p_order_no, p_expected_version, p_changes);
  v_id uuid;
begin
  select o.id into v_id from public.orders o where o.shop_id = p_shop_id and o.order_no = p_order_no;
  perform public.dayo_order_refresh_signature(v_id);
  perform public.dayo_detect_duplicates(v_id);
  return v_res || jsonb_build_object('duplicate_of', public.dayo_order_duplicate_of(v_id));
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 7. create_order: ลอก dayo_impl_create_order ทั้งตัวจาก 0008 บรรทัด 1017–1170 (ชื่อ dayo_create_order เดิม
--    ที่ 0012 เปลี่ยนชื่อเป็น dayo_impl_create_order) มาเป็น "create or replace function public.dayo_impl_create_order(...)"
--    ลายเซ็นเดิม (p_shop_id uuid, p_actor jsonb, p_draft jsonb, p_idempotency jsonb, p_batch_id uuid default null)
--    แล้วแก้ 6 จุดต่อไปนี้ (ทุกจุดมีคอมเมนต์ "-- ADR-0049"):
-- ═════════════════════════════════════════════════════════════════════════════════
```

แก้ 6 จุดใน `dayo_impl_create_order` ที่ลอกมา (executor วางโค้ดเหล่านี้ลงในตำแหน่งที่ระบุ):

(ก) `declare` เพิ่มตัวแปร:
```sql
  v_pos jsonb := case when jsonb_typeof(p_draft -> 'pos') = 'object' then p_draft -> 'pos' end;   -- ADR-0049
  v_pos_order_id uuid := public.dayo_j_uuid(case when jsonb_typeof(p_draft -> 'pos') = 'object' then p_draft -> 'pos' end, 'pos_order_id');
  v_found_pos uuid;
  v_dups text[];
```

(ข) ต้นฟังก์ชัน ต่อจากบรรทัดตรวจ `external_ref ใช้ได้กับบิลจาก API เท่านั้น`:
```sql
  if v_pos is not null and not v_is_pos then   -- ADR-0049
    raise exception using errcode = 'DY422', message = 'invalid: ข้อมูล pos ใช้ได้กับบิลจาก API เท่านั้น';
  end if;
```

(ค) แทนบล็อก "ซ้ำด้วย external_ref" ทั้งบล็อก:
```sql
  -- ซ้ำด้วย pos_order_id / external_ref (unique ต่อ api_client) — ADR-0049: external_ref ชนแต่ pos_order_id ต่าง = CONFLICT
  if v_pos_order_id is not null then
    select o.id into v_order_id from public.orders o
    where o.shop_id = p_shop_id and o.api_client_id = v_client_id and o.pos_order_id = v_pos_order_id;
    if found then
      return public.dayo_order_result(v_order_id) || jsonb_build_object('duplicate', true);
    end if;
  end if;
  if v_ext_ref is not null then
    select o.id, o.pos_order_id into v_order_id, v_found_pos from public.orders o
    where o.shop_id = p_shop_id and o.api_client_id = v_client_id and o.external_ref = v_ext_ref;
    if found then
      if v_pos_order_id is not null and v_found_pos is distinct from v_pos_order_id then
        raise exception using errcode = 'DY409', message = format('external_ref_taken: เลขใบเสร็จ %s ถูกใช้กับบิลอื่นแล้ว', v_ext_ref);
      end if;
      return public.dayo_order_result(v_order_id) || jsonb_build_object('duplicate', true);
    end if;
  end if;
```

(ง) คำสั่ง `insert into public.orders (...)` เพิ่ม 6 คอลัมน์ท้ายรายการ `…, pricing_context` → `…, pricing_context, pos_order_id, pos_queue_no, pos_shift_id, catalog_version, sold_at, pos_computed_total)` และท้าย `values (…, v_ctx` เพิ่ม:
```sql
      , v_pos_order_id, public.dayo_j_int(v_pos, 'queue_no'), public.dayo_j_uuid(v_pos, 'shift_id'),          -- ADR-0049
      coalesce((v_pos ->> 'catalog_version')::bigint, public.dayo_catalog_version(p_shop_id)),
      case when v_pos is not null then (v_pos ->> 'sold_at')::timestamptz
           when v_sale_date = public.dayo_today() then now() end,
      case when v_is_pos then (v_quote ->> 'total')::numeric end
```
และก่อน insert ให้เติมฉบับของเซิร์ฟเวอร์ ณ ตอนบิลเข้า ลง `pricing_context` (ไว้แสดง "ต่างเพราะเมนูในเครื่องเก่า" บนแดชบอร์ด):
```sql
  if v_is_pos then   -- ADR-0049
    v_ctx := coalesce(v_ctx, '{}'::jsonb) || jsonb_build_object('server_catalog_version', public.dayo_catalog_version(p_shop_id));
  end if;
```

(จ) แทน `exception when unique_violation then …` ทั้งบล็อก:
```sql
  exception when unique_violation then
    -- ADR-0049: ชนพร้อมกัน → หาใหม่: pos_order_id เดียวกัน = ซ้ำ · external_ref ชนแต่ pos_order_id ต่าง = DY409
    if v_pos_order_id is not null then
      select o.id into v_order_id from public.orders o
      where o.shop_id = p_shop_id and o.api_client_id = v_client_id and o.pos_order_id = v_pos_order_id;
      if found then
        return public.dayo_order_result(v_order_id) || jsonb_build_object('duplicate', true);
      end if;
    end if;
    if v_ext_ref is not null then
      select o.id, o.pos_order_id into v_order_id, v_found_pos from public.orders o
      where o.shop_id = p_shop_id and o.api_client_id = v_client_id and o.external_ref = v_ext_ref;
      if found then
        if v_pos_order_id is not null and v_found_pos is distinct from v_pos_order_id then
          raise exception using errcode = 'DY409', message = format('external_ref_taken: เลขใบเสร็จ %s ถูกใช้กับบิลอื่นแล้ว', v_ext_ref);
        end if;
        return public.dayo_order_result(v_order_id) || jsonb_build_object('duplicate', true);
      end if;
    end if;
    raise;
  end;
```

(ฉ) ต่อจาก `perform public.dayo_order_sync_stock(v_order_id, v_staff_id);` และบรรทัดสุดท้าย:
```sql
  perform public.dayo_order_refresh_signature(v_order_id);   -- ADR-0049
  v_dups := public.dayo_detect_duplicates(v_order_id);
  ...
  return v_result || jsonb_build_object('duplicate', false, 'warnings', v_quote -> 'warnings',
                                        'duplicate_of', public.dayo_order_duplicate_of(v_order_id));
```

ต่อท้าย migration:
```sql
-- ═════════════════════════════════════════════════════════════════════════════════
-- 8. รหัสที่มีบิลอ้างเปลี่ยนไม่ได้ (Q51 + ช่องทาง/วิธีชำระ) — trigger ครอบทุกทาง (save_* และนำเข้า)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_forbid_referenced_code_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.code is not distinct from old.code then
    return new;
  end if;
  if tg_table_name = 'menu_items' and exists (
      select 1 from public.order_items i join public.orders o on o.id = i.order_id
      where o.shop_id = old.shop_id and i.menu_code = old.code) then
    raise exception using errcode = 'DY422',
      message = format('invalid: เปลี่ยนรหัสเมนู "%s" ไม่ได้ เพราะมีบิลอ้างแล้ว — เปลี่ยนชื่อไทยหรือชื่อพ้องแทนค่ะ', old.code);
  elsif tg_table_name = 'sales_channels' and exists (select 1 from public.orders o where o.sales_channel_id = old.id) then
    raise exception using errcode = 'DY422',
      message = format('invalid: เปลี่ยนรหัสช่องทาง "%s" ไม่ได้ เพราะมีบิลอ้างแล้ว — เปลี่ยนชื่อหรือชื่อพ้องแทนค่ะ', old.code);
  elsif tg_table_name = 'payment_methods' and exists (select 1 from public.orders o where o.payment_method_id = old.id) then
    raise exception using errcode = 'DY422',
      message = format('invalid: เปลี่ยนรหัสวิธีชำระ "%s" ไม่ได้ เพราะมีบิลอ้างแล้ว — เปลี่ยนชื่อหรือชื่อพ้องแทนค่ะ', old.code);
  end if;
  return new;
end;
$$;
create trigger menu_items_code_lock before update of code on public.menu_items
  for each row execute function public.dayo_forbid_referenced_code_change();
create trigger sales_channels_code_lock before update of code on public.sales_channels
  for each row execute function public.dayo_forbid_referenced_code_change();
create trigger payment_methods_code_lock before update of code on public.payment_methods
  for each row execute function public.dayo_forbid_referenced_code_change();

-- ═════════════════════════════════════════════════════════════════════════════════
-- 9. ไฟล์สำรองแบบกดเอง (ADR-0021): ห่อ backup_dump_table (0047) ให้มีตาราง order_duplicate_flags
-- ═════════════════════════════════════════════════════════════════════════════════
alter function public.backup_dump_table(uuid, uuid, text) rename to dayo_impl_backup_dump_table;
create or replace function public.backup_dump_table(p_shop_id uuid, p_staff_id uuid, p_table text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if p_table = 'order_duplicate_flags' then
    perform public.dayo_require_staff(p_shop_id, p_staff_id, array['owner']);
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows
    from public.order_duplicate_flags t where t.shop_id = p_shop_id;
    return v_rows;
  end if;
  return public.dayo_impl_backup_dump_table(p_shop_id, p_staff_id, p_table);
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
```

แก้รายการตารางสำรอง (หลัง `orders` ตาม FK):
- `apps/web/src/lib/backup.ts` และ `scripts/restore.ts`: เพิ่ม `"order_duplicate_flags", // ธงบิลน่าจะซ้ำ (ADR-0049) — หลัง orders ตาม FK · ไฟล์สำรองเก่าไม่มี = ข้าม` ต่อจาก `"order_promotions"` · `scripts/restore.ts` ตารางคีย์ธรรมชาติ: `order_duplicate_flags: "order_a_id,order_b_id"`

ก่อน rename `update_order` ให้ executor รัน `grep -n "update_order(" supabase/migrations/*.sql` ยืนยันว่าไม่มีฟังก์ชัน SQL อื่นเรียก `update_order` ด้วยลายเซ็น 5 อาร์กิวเมนต์ (ถ้ามี ให้ตัวนั้นยังเรียกชื่อ `update_order` ซึ่งกลายเป็นตัวห่อ — ถูกต้อง)

- [ ] **Step 4: รันให้ผ่าน**

Run: `npm run db:reset && npx vitest run --root packages/shared test/db/pos_bills.db.test.ts`
Expected: PASS 8 เคส

- [ ] **Step 5: เทสต์เดิม + types**

Run: `npx vitest run --root packages/shared test/db && npm run db:types && npx vitest run --root apps/web test/backup.stream.test.ts`
Expected: PASS ทุกไฟล์ (`orders.db.test.ts` ที่เทสต์ POST external_ref ซ้ำเดิมต้องยังผ่าน — บิลที่ไม่ส่ง `pos` ใช้กติกาเดิม)

- [ ] **Step 6: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add supabase/migrations/0049_pos_bill_source_duplicates.sql packages/shared/test/db/pos_bills.db.test.ts packages/shared/src/database.types.ts apps/web/src/lib/backup.ts scripts/restore.ts
git commit -m "feat(db): record bill source, flag likely duplicates and lock pos bills"
```

---
## Task 3a: E2 ส่วนบริสุทธิ์ — ตัวตรวจรูป · แผนที่ error · ของที่ปิดใช้หลังขาย (migration 0050)

**agent:** db-engineer · opus · high (lane A · ใช้ Docker) · แยกจาก Task 3b ให้แต่ละรอบขนาดพอดี agent หนึ่งตัว

**Files:**
- Create: `supabase/migrations/0050_pos_push_checks.sql`
- Create: `packages/shared/test/db/pos_checks.db.test.ts`
- Modify: `apps/web/src/lib/backup.ts`, `scripts/restore.ts` (เพิ่มตาราง `promotion_active_windows`)
- Modify: `packages/shared/src/database.types.ts`

**Interfaces:**
- Consumes: `dayo_pos_supported()` `dayo_iso_ms()` (Task 1) · `dayo_impl_price_line` `dayo_quote` (0047) · `dayo_impl_quote` (0008 `dayo_quote` ที่ 0012 เปลี่ยนชื่อ) · `dayo_quote_priced` `dayo_promo_eligible` (0008)
- Produces:
  - `dayo_pos_invalid_order(p jsonb) returns text` · `dayo_pos_invalid_void(p jsonb) returns text` (null = ผ่าน)
  - `dayo_pos_unknown_fields(p_kind text, p_data jsonb) returns text[]`
  - `dayo_pos_verdict(p_key text, p_status text, p_reason text, p_detail text, p_data jsonb) returns jsonb`
  - `dayo_pos_error_verdict(p_state text, p_msg text) returns jsonb` → `{status, reason?, detail?}`
  - `dayo_promo_eligible(p promotions, p_sale_date date, p_sale_time time, p_channel_id uuid, p_promo_code text, p_skip uuid[], p_include_inactive boolean default false, p_sold_at timestamptz default null)` · `dayo_quote_priced(..., p_include_inactive boolean default false)` อ่าน `sold_at` จาก ctx — บิล POS ใช้โปรที่ปิดแล้วได้เฉพาะเมื่อ `sold_at` (เต็มความละเอียด) อยู่ในช่วงของตาราง `promotion_active_windows(promotion_id, activated_at, deactivated_at)` ที่ trigger `promotions_track_window` ดูแล
  - บิล POS: ตัวเลือกนม/เกรดที่ปิดแล้วคิดได้ · qty ไม่ถูกบีบด้วย `max_qty_per_line` (เพดาน 999) · ขนาดร่างนับด้วย `dayo_check_draft_size_pos`

- [ ] **Step 1: เขียนเทสต์ที่ต้องตก** — `packages/shared/test/db/pos_checks.db.test.ts`

```ts
// pos_checks.db.test.ts — ส่วนบริสุทธิ์ของ E2 (0050): ตัวตรวจรูป · ฟิลด์ไม่รู้จัก · ตารางแผนที่ error (สเปก POS 04 §4.5)
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { connectLocalSupabase, Db } from "./helpers.js";

const sb = await connectLocalSupabase();

describe.skipIf(!sb)("ตัวตรวจของ api_pos_push (0050)", () => {
  let svc: Db;
  beforeAll(() => { svc = Db.service(sb!); });
  const good = () => ({
    pos_order_id: randomUUID(), receipt_no: "A-000312", queue_no: 12, sale_date: "2026-09-25", sold_at: "2026-09-25T03:15:03.120Z",
    channel: "store", payment: "cash", staff_id: randomUUID(), catalog_version: 42, shift_id: null,
    lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 3 }],
    bill_discount: null, promo_code: null, skip_promotion_ids: [], no_promotions: false,
    totals: { items_subtotal: 190, items_discount: 35, bill_discount: 0, total: 155 }, note: null,
  });
  const invalid = (p: unknown) => svc.rpc<string | null>("dayo_pos_invalid_order", { p });

  it("แถวถูกรูป = null", async () => expect(await invalid(good())).toBeNull());

  it("รูปผิดแต่ละแบบ = ข้อความไทยที่ไม่สะท้อนค่าที่ส่งมา", async () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ["receipt_no", { receipt_no: "a-12" }], ["queue_no", { queue_no: 0 }], ["sold_at", { sold_at: "yesterday" }],
      ["staff_id", { staff_id: "SECRET-STAFF" }], ["catalog_version", { catalog_version: 0 }], ["shift_id", { shift_id: "x" }],
      ["lines", { lines: [] }], ["milk", { lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: null, grade: null, qty: 1 }] }],
      ["qty", { lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 1000 }] }],
      ["discount", { lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 1, discount_baht: 1, discount_percent: 5 }] }],
      ["free", { lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 1, free: true }] }],
      ["bill_discount", { bill_discount: { baht: 5, percent: 10 } }], ["totals", { totals: { total: 1.234 } }],
      ["note", { note: "SECRET\u0001NOTE" }],
    ];
    for (const [name, over] of bad) {
      const msg = await invalid({ ...good(), ...over });
      expect(msg, name).not.toBeNull();
      expect(msg!, name).not.toContain("SECRET");
    }
  });

  it("ฟิลด์ไม่รู้จัก (บนสุด / lines / bill_discount / totals) · ฟิลด์ในรายการ E1 ครบทุกตัวรับได้", async () => {
    const unk = (d: unknown, kind = "order") => svc.rpc<string[]>("dayo_pos_unknown_fields", { p_kind: kind, p_data: d });
    expect(await unk(good())).toEqual([]);
    expect(await unk({ ...good(), tip: 1 })).toEqual(["tip"]);
    expect(await unk({ ...good(), lines: [{ ...good().lines[0], topping: "x" }] })).toEqual(["lines.topping"]);
    expect(await unk({ ...good(), bill_discount: { baht: 5, coupon: "x" } })).toEqual(["bill_discount.coupon"]);
    expect(await unk({ pos_order_id: randomUUID(), voided_at: "x", staff_id: "x", approved_by: null, reason: "x" }, "order_void")).toEqual([]);
  });

  it("ตารางแผนที่ error → คำตัดสิน ครบทุกแถวของสเปก §4.5 (23505 ทดสอบปลายทางใน Task 3b)", async () => {
    const cases: Array<[string, string, string, string | null]> = [
      ["DY422", "invalid: ส่วนลดเต็มราคาต้องมีหมายเหตุ", "rejected", "INVALID"],
      ["DY422", "too_large: บิลละไม่เกิน 50 รายการ", "rejected", "INVALID"],
      ["DY422", "unknown_code: ไม่พบเมนู \"X\"", "rejected", "UNKNOWN_CODE"],
      ["DY404", "unknown_code: ไม่พบช่องทาง \"x\"", "rejected", "UNKNOWN_CODE"],
      ["DY401", "staff_not_active: ไม่พบพนักงาน", "rejected", "UNKNOWN_STAFF"],
      ["DY404", "staff_ref_invalid: ไม่พบพนักงาน", "rejected", "UNKNOWN_STAFF"],
      ["DY403", "forbidden: x", "rejected", "FORBIDDEN"],
      ["DY404", "parent_pending: ยังไม่พบบิล", "deferred", "PARENT_PENDING"],
      ["DY409", "external_ref_taken: x", "rejected", "CONFLICT"],
      ["DY409", "already_cancelled: x", "duplicate", null],
      ["DY409", "idempotency_in_progress: x", "deferred", "BUSY"],
      ["DY409", "duplicate_event: x", "deferred", "BUSY"],
      ["DY409", "version_conflict: x", "deferred", "SERVER_ERROR"],
      ...["23502", "23514", "22001", "22003", "22007", "22008", "22021", "22P02", "22P05"].map(
        (s): [string, string, string, string] => [s, "raw", "rejected", "INVALID"]),
      ...["40001", "40P01", "55P03", "57014"].map((s): [string, string, string, string] => [s, "raw", "deferred", "BUSY"]),
      ["23503", "raw fk message", "deferred", "SERVER_ERROR"],
      ["XX000", "raw", "deferred", "SERVER_ERROR"],
    ];
    for (const [state, msg, status, reason] of cases) {
      const v = await svc.rpc<{ status: string; reason?: string; detail?: string }>("dayo_pos_error_verdict", { p_state: state, p_msg: msg });
      expect([state, v.status, v.reason ?? null]).toEqual([state, status, reason]);
      expect(v.detail ?? "").not.toContain("raw");
    }
  });

  it("dayo_pos_verdict ตัด key ที่ 200 และ detail ที่ 500 code point · data เฉพาะ accepted/duplicate", async () => {
    const v = await svc.rpc<Record<string, unknown>>("dayo_pos_verdict", {
      p_key: "k".repeat(300), p_status: "rejected", p_reason: "INVALID", p_detail: "ก".repeat(600), p_data: { order_no: "x" } });
    expect(String(v.key)).toHaveLength(200);
    expect([...String(v.detail)]).toHaveLength(500);
    expect(v).not.toHaveProperty("data");
  });
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npm run db:reset && npx vitest run --root packages/shared test/db/pos_checks.db.test.ts`
Expected: FAIL — `function public.dayo_pos_invalid_order(...) does not exist`

- [ ] **Step 3: เขียน migration** — `supabase/migrations/0050_pos_push_checks.sql`

```sql
-- 0050_pos_push_checks — ส่วนบริสุทธิ์ของ E2 + ของที่ปิดใช้หลังขายสำหรับบิล POS (ADR-0049 · สเปก POS 04 §4.5 ข้อ 2, §5.3 ข้อ 14)
-- ไม่แก้ไฟล์เก่า — ลอกฟังก์ชันรุ่นล่าสุดมาแก้เฉพาะบรรทัดที่มีป้าย "-- ADR-0049"

-- ═════════════════════════════════════════════════════════════════════════════════
-- 2. ราคาต่อบรรทัด: ลอก dayo_impl_price_line (0047 บรรทัด 418–586) ทุกบรรทัด แก้ 2 เรื่อง (ป้าย "-- ADR-0049"):
--   (ก) บิล POS (p_include_inactive = true) ไม่บีบ qty กับ max_qty_per_line — เพดาน 999 ตาม check ของ order_items:
--         v_qty := greatest(1, least(case when p_include_inactive then 999 else v_set.max_qty_per_line end,
--                                    coalesce(round(v_qty_in)::integer, 1)));
--   (ข) ตัวเลือกนม/เกรดที่ปิดใช้แล้วยังคิดได้กับบิล POS — ทุก select จาก menu_options ในฟังก์ชัน (o_fresh และ o_oat ทั้ง 2 ที่,
--       o_grade, o_def) เปลี่ยน "and o.is_active" เป็น "and (p_include_inactive or o.is_active)" ·
--       o_def ใช้ "order by o.is_active desc, o.sort_order, o.code limit 1"
-- ═════════════════════════════════════════════════════════════════════════════════

-- ขนาดร่างของบิล POS: นับแก้วด้วยเพดาน 999 (ไม่ใช่ max_qty_per_line ของร้าน) · ยังจำกัด 50 รายการ / 500 แก้ว
create or replace function public.dayo_check_draft_size_pos(p_draft jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_lines jsonb := case when jsonb_typeof(p_draft -> 'lines') = 'array' then p_draft -> 'lines' else '[]'::jsonb end;
begin
  perform public.dayo_check_order_size(
    jsonb_array_length(v_lines),
    (select coalesce(sum(greatest(1, least(999, coalesce(round(public.dayo_j_num(e, 'qty')), 1)))), 0)::integer
     from jsonb_array_elements(v_lines) e where jsonb_typeof(e) = 'object'));
end;
$$;

-- dayo_quote (ลอก 0047) — เปลี่ยนเฉพาะบรรทัดตรวจขนาด
create or replace function public.dayo_quote(p_shop_id uuid, p_draft jsonb, p_include_inactive boolean default false)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_draft jsonb := public.dayo_draft_with_channel(p_shop_id, p_draft);
  v_res jsonb;
begin
  if p_include_inactive then   -- ADR-0049: บิล POS
    perform public.dayo_check_draft_size_pos(v_draft);
  else
    perform public.dayo_check_draft_size(p_shop_id, v_draft);
  end if;
  v_res := public.dayo_impl_quote(p_shop_id, v_draft, p_include_inactive);
  if not p_include_inactive
     and public.dayo_j_text(v_draft, 'payment') is null
     and v_res ->> 'payment_method_id' is not null
     and not exists (
       select 1 from public.payment_methods pm
       where pm.shop_id = p_shop_id and pm.id = (v_res ->> 'payment_method_id')::uuid and pm.is_active
     ) then
    v_res := v_res || jsonb_build_object('payment', null, 'payment_method_id', null);
  end if;
  return public.dayo_quote_guard(v_res, v_res -> 'context');
end;
$$;


-- ═════════════════════════════════════════════════════════════════════════════════
-- 2b. โปรที่ถูกปิดแล้วใช้กับบิล POS ได้ ถ้า "ขายในช่วงที่โปรเปิดอยู่" (สเปก §4.5 ข้อ 2) — ADR-0049
--     ตารางช่วงเวลาที่โปร active (trigger ดูแล · append-only ยกเว้นปิดช่วงที่เปิดอยู่) · เทียบกับ sold_at เต็มความละเอียด
--     (ไม่ใช่ sale_time ที่ตัดวินาที) · ปิด-เปิด-ปิดหลายรอบถูกต้องทุกรอบ · โปรที่เปิดหลังเวลาขายไม่ใช้กับบิลนั้น
--     ไม่ใช้ updated_at (แก้ชื่อ/ค่าอื่นหลังขายต้องไม่มีผล) · ไม่มีทางตั้งเวลาย้อนหลังจาก trigger · บิลบอท/เว็บ = เหมือนเดิมทุกอย่าง
-- ═════════════════════════════════════════════════════════════════════════════════
create table public.promotion_active_windows (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  promotion_id uuid not null references public.promotions (id) on delete restrict,
  activated_at timestamptz not null,
  deactivated_at timestamptz,
  constraint promotion_active_windows_order check (deactivated_at is null or deactivated_at >= activated_at)
);
create unique index promotion_active_windows_open_key on public.promotion_active_windows (promotion_id) where deactivated_at is null;
create index promotion_active_windows_promo_idx on public.promotion_active_windows (promotion_id, activated_at);
alter table public.promotion_active_windows enable row level security;

-- ย้อนหลัง: โปรที่ active อยู่ตอนนี้ได้ช่วงที่เปิดอยู่ 1 ช่วง (เริ่มที่ created_at) · โปรที่ปิดอยู่ตอนนี้ไม่มีช่วง (ไม่รู้ประวัติ = ไม่ใช้กับบิล POS)
insert into public.promotion_active_windows (shop_id, promotion_id, activated_at)
select p.shop_id, p.id, coalesce(p.created_at, now()) from public.promotions p where p.is_active;

create or replace function public.dayo_promo_track_window()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_active then
      insert into public.promotion_active_windows (shop_id, promotion_id, activated_at) values (new.shop_id, new.id, now());
    end if;
  elsif not old.is_active and new.is_active then
    insert into public.promotion_active_windows (shop_id, promotion_id, activated_at) values (new.shop_id, new.id, now());
  elsif old.is_active and not new.is_active then
    update public.promotion_active_windows w set deactivated_at = now()
    where w.promotion_id = new.id and w.deactivated_at is null;
  end if;
  return null;
end;
$$;
create trigger promotions_track_window after insert or update of is_active on public.promotions
  for each row execute function public.dayo_promo_track_window();

drop function public.dayo_promo_eligible(public.promotions, date, time, uuid, text, uuid[]);
create function public.dayo_promo_eligible(
  p public.promotions, p_sale_date date, p_sale_time time, p_channel_id uuid, p_promo_code text, p_skip uuid[],
  p_include_inactive boolean default false, p_sold_at timestamptz default null
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  if not p.is_active then
    -- ADR-0049: บิล POS ใช้โปรที่ปิดแล้วได้เฉพาะเมื่อ sold_at (เต็มความละเอียด) อยู่ในช่วงที่โปรเปิด
    --           activated_at ≤ sold_at < coalesce(deactivated_at, infinity) · เงื่อนไขวัน/เวลา/ช่องทางของโปรเองตรวจต่อด้านล่าง
    if not p_include_inactive or p_sold_at is null or not exists (
         select 1 from public.promotion_active_windows w
         where w.promotion_id = p.id and w.activated_at <= p_sold_at
           and p_sold_at < coalesce(w.deactivated_at, 'infinity'::timestamptz)) then
      return false;
    end if;
  end if;
  if p.id = any (coalesce(p_skip, '{}')) then return false; end if;
  if p.starts_on is not null and p_sale_date < p.starts_on then return false; end if;
  if p.ends_on is not null and p_sale_date > p.ends_on then return false; end if;
  if p.days_of_week is not null and cardinality(p.days_of_week) > 0
     and not (extract(dow from p_sale_date)::int = any (p.days_of_week)) then
    return false;
  end if;
  if (p.time_from is not null or p.time_to is not null) and p_sale_time is null then return false; end if;
  if p.time_from is not null and p_sale_time < p.time_from then return false; end if;
  if p.time_to is not null and p_sale_time > p.time_to then return false; end if;
  if cardinality(p.channel_ids) > 0 and not (p_channel_id = any (p.channel_ids)) then return false; end if;
  if p.requires_code then
    return p_promo_code is not null and p_promo_code = p.code;
  end if;
  return p.auto_apply;
end;
$$;

-- ไฟล์สำรองแบบกดเอง: ห่อ backup_dump_table (ตัวห่อของ 0049) ให้มีตาราง promotion_active_windows ด้วย
alter function public.backup_dump_table(uuid, uuid, text) rename to dayo_impl2_backup_dump_table;
create or replace function public.backup_dump_table(p_shop_id uuid, p_staff_id uuid, p_table text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if p_table = 'promotion_active_windows' then
    perform public.dayo_require_staff(p_shop_id, p_staff_id, array['owner']);
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows
    from public.promotion_active_windows t where t.shop_id = p_shop_id;
    return v_rows;
  end if;
  return public.dayo_impl2_backup_dump_table(p_shop_id, p_staff_id, p_table);
end;
$$;
```

`dayo_quote_priced` — executor ลอก `0008_orders_rpc.sql` บรรทัด 375–692 ทุกบรรทัด แล้วแก้ตรงตัว 5 จุด:

| ที่ | เดิม (0008) | ใหม่ |
|---|---|---|
| ก่อน `create` | — | `drop function public.dayo_quote_priced(uuid, public.sales_channels, jsonb, jsonb, boolean, jsonb);` |
| บรรทัด 375–377 ลายเซ็น | `create or replace function public.dayo_quote_priced(`<br>`  p_shop_id uuid, p_channel public.sales_channels, p_ctx jsonb, p_priced jsonb, p_ok boolean, p_warnings jsonb`<br>`)` | `create function public.dayo_quote_priced(`<br>`  p_shop_id uuid, p_channel public.sales_channels, p_ctx jsonb, p_priced jsonb, p_ok boolean, p_warnings jsonb,`<br>`  p_include_inactive boolean default false   -- ADR-0049`<br>`)` |
| `declare` (ต่อจาก `v_sale_time`) | — | `  v_sold_at timestamptz := case when p_include_inactive then (p_ctx ->> 'sold_at')::timestamptz end;   -- ADR-0049 เวลาขายเต็มความละเอียดของบิล POS` |
| บรรทัด 468 | `and public.dayo_promo_eligible(pr, v_sale_date, v_sale_time, p_channel.id, v_promo_code, v_skip)` | `and public.dayo_promo_eligible(pr, v_sale_date, v_sale_time, p_channel.id, v_promo_code, v_skip, p_include_inactive, v_sold_at)   -- ADR-0049` |
| บรรทัด 597 | (บรรทัดเดียวกับ 468) | (แก้แบบเดียวกัน) |

ผู้เรียกเดิมที่ส่ง 6 อาร์กิวเมนต์ (`update_order` ใน 0047 บรรทัด 863 · 0012 บรรทัด 475) ได้ค่า `false` จาก default — ไม่เปลี่ยนพฤติกรรม

`dayo_impl_quote` — ลอก `0008_orders_rpc.sql` บรรทัด 718–776 (ฟังก์ชันชื่อ `dayo_quote` เดิมที่ 0012 เปลี่ยนชื่อ) โดยเปลี่ยน `create or replace function public.dayo_quote(` เป็น `create or replace function public.dayo_impl_quote(` และแทนบรรทัด 757–758 (`v_ctx := …` และ `v_res := …`) ด้วย:
```sql
  v_ctx := public.dayo_draft_context(p_draft, v_sale_date);
  if p_include_inactive and jsonb_typeof(p_draft -> 'pos') = 'object' and public.dayo_j_text(p_draft -> 'pos', 'sold_at') is not null then
    v_ctx := v_ctx || jsonb_build_object('sold_at', p_draft -> 'pos' -> 'sold_at');   -- ADR-0049 ส่ง sold_at เต็มความละเอียดให้การตรวจโปร
  end if;
  v_res := public.dayo_quote_priced(p_shop_id, v_ch, v_ctx, v_priced, v_ok, v_warn, p_include_inactive);   -- ADR-0049
```
(`sold_at` จึงอยู่ใน `orders.pricing_context` ของบิล POS ด้วย — เป็นข้อมูลเวลาเครื่องเดียวกับ `orders.sold_at`)

เพิ่มรายการตารางสำรอง: `apps/web/src/lib/backup.ts` และ `scripts/restore.ts` เพิ่ม `"promotion_active_windows", // ช่วงเวลาที่โปรเปิด (ADR-0049) — หลัง promotions ตาม FK · ไฟล์สำรองเก่าไม่มี = ข้าม` ต่อจาก `"promotions"` · `scripts/restore.ts` คีย์ธรรมชาติ `promotion_active_windows: "id"`

แพตช์ของ `dayo_impl_price_line` (ลอก 0047 บรรทัด 418–586 ทุกบรรทัด แล้วแทนตรงตัว):

| บรรทัดเดิม (0047) | ใหม่ |
|---|---|
| `  v_qty := greatest(1, least(v_set.max_qty_per_line, coalesce(round(v_qty_in)::integer, 1)));` | `  v_qty := greatest(1, least(case when p_include_inactive then 999 else v_set.max_qty_per_line end, coalesce(round(v_qty_in)::integer, 1)));   -- ADR-0049` |
| `    where o.shop_id = p_shop_id and o.kind = 'milk' and o.code = 'fresh' and o.is_active;` (2 ที่) | `    where o.shop_id = p_shop_id and o.kind = 'milk' and o.code = 'fresh' and (p_include_inactive or o.is_active);   -- ADR-0049` |
| `    where o.shop_id = p_shop_id and o.kind = 'milk' and o.code = 'oat' and o.is_active;` (2 ที่) | `    where o.shop_id = p_shop_id and o.kind = 'milk' and o.code = 'oat' and (p_include_inactive or o.is_active);   -- ADR-0049` |
| `      where o.shop_id = p_shop_id and o.kind = 'matcha_grade' and o.code = v_grade and o.is_active;` | `      where o.shop_id = p_shop_id and o.kind = 'matcha_grade' and o.code = v_grade and (p_include_inactive or o.is_active);   -- ADR-0049` |
| `      where o.shop_id = p_shop_id and o.kind = 'matcha_grade' and o.is_default and o.is_active`<br>`      order by o.sort_order, o.code limit 1;` | `      where o.shop_id = p_shop_id and o.kind = 'matcha_grade' and o.is_default and (p_include_inactive or o.is_active)`<br>`      order by o.is_active desc, o.sort_order, o.code limit 1;   -- ADR-0049` |

(ตรวจหลังแก้: `grep -c "ADR-0049" supabase/migrations/0050_pos_push_checks.sql` ต้องมีทุกจุดข้างบน และ `diff` กับต้นฉบับต่างเฉพาะบรรทัดเหล่านี้)

```sql
-- ═════════════════════════════════════════════════════════════════════════════════
-- 3. ตัวตรวจรูป (ข้อความไทยสะท้อนได้เฉพาะชื่อฟิลด์/ลำดับบรรทัด — ไม่สะท้อนค่าที่ส่งมา)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_pos_is_uuid(p text)
returns boolean language sql immutable set search_path = public
as $$ select p is not null and p ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' $$;

create or replace function public.dayo_pos_is_iso(p jsonb)
returns boolean language plpgsql stable set search_path = public
as $$
begin
  if jsonb_typeof(p) is distinct from 'string'
     or (p #>> '{}') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    return false;
  end if;
  perform (p #>> '{}')::timestamptz;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.dayo_pos_is_date(p jsonb)
returns boolean language plpgsql stable set search_path = public
as $$
begin
  if jsonb_typeof(p) is distinct from 'string' or (p #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  perform (p #>> '{}')::date;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.dayo_pos_is_int(p jsonb, p_min numeric, p_max numeric)
returns boolean language sql immutable set search_path = public
as $$
  select coalesce(jsonb_typeof(p) = 'number' and (p::text)::numeric = trunc((p::text)::numeric)
     and (p::text)::numeric between p_min and p_max, false)
$$;

create or replace function public.dayo_pos_is_money(p jsonb)
returns boolean language sql immutable set search_path = public
as $$
  select coalesce(jsonb_typeof(p) = 'number' and (p::text)::numeric >= 0 and (p::text)::numeric <= 99999999.99
     and (p::text)::numeric = round((p::text)::numeric, 2), false)
$$;

create or replace function public.dayo_pos_is_text(p jsonb, p_min integer, p_max integer)
returns boolean language sql immutable set search_path = public
as $$
  select coalesce(jsonb_typeof(p) = 'string' and char_length(p #>> '{}') between p_min and p_max
     and (p #>> '{}') !~ E'[\\x01-\\x1F\\x7F]', false)
$$;

create or replace function public.dayo_pos_null_or(p_obj jsonb, p_key text)
returns boolean language sql immutable set search_path = public
as $$ select not (p_obj ? p_key) or jsonb_typeof(p_obj -> p_key) = 'null' $$;

create or replace function public.dayo_pos_invalid_order(p jsonb)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  l jsonb;
  v_i integer := 0;
  v_cups integer := 0;
  bd jsonb := p -> 'bill_discount';
  t jsonb := p -> 'totals';
begin
  if not public.dayo_pos_is_uuid(p ->> 'pos_order_id') then return 'pos_order_id ต้องเป็น UUID ตัวเล็ก'; end if;
  if jsonb_typeof(p -> 'receipt_no') is distinct from 'string' or (p ->> 'receipt_no') !~ '^[A-Z]{1,3}-\d{6}$' then
    return 'receipt_no ต้องเป็นรูป A-000123';
  end if;
  if not public.dayo_pos_is_int(p -> 'queue_no', 1, 9999) then return 'queue_no ต้องเป็นจำนวนเต็ม 1–9999'; end if;
  if not public.dayo_pos_is_date(p -> 'sale_date') then return 'sale_date ต้องเป็น YYYY-MM-DD'; end if;
  if not public.dayo_pos_is_iso(p -> 'sold_at') then return 'sold_at ต้องเป็นเวลา ISO-8601'; end if;
  if not public.dayo_pos_is_text(p -> 'channel', 1, 50) then return 'channel ต้องเป็นรหัสช่องทาง'; end if;
  if not public.dayo_pos_is_text(p -> 'payment', 1, 50) then return 'payment ต้องเป็นรหัสวิธีชำระ'; end if;
  if not public.dayo_pos_is_uuid(p ->> 'staff_id') then return 'staff_id ต้องเป็น UUID ตัวเล็ก'; end if;
  if not public.dayo_pos_is_int(p -> 'catalog_version', 1, 9223372036854775807) then return 'catalog_version ต้องเป็นจำนวนเต็ม ≥ 1'; end if;
  if not (p ? 'shift_id') or not (jsonb_typeof(p -> 'shift_id') = 'null' or public.dayo_pos_is_uuid(p ->> 'shift_id')) then
    return 'shift_id ต้องเป็น UUID หรือ null';
  end if;
  if jsonb_typeof(p -> 'lines') is distinct from 'array' or jsonb_array_length(p -> 'lines') not between 1 and 50 then
    return 'lines ต้องมี 1–50 รายการ';
  end if;
  for l in select e from jsonb_array_elements(p -> 'lines') e loop
    v_i := v_i + 1;
    if jsonb_typeof(l) <> 'object' then return format('lines[%s] ต้องเป็น object', v_i); end if;
    if not public.dayo_pos_is_text(l -> 'code', 1, 100) then return format('lines[%s].code ต้องเป็นรหัสเมนู', v_i); end if;
    if (l ->> 'size') is null or (l ->> 'size') not in ('16 oz', '20 oz') then return format('lines[%s].size ต้องเป็น "16 oz" หรือ "20 oz"', v_i); end if;
    if (l ->> 'sweetness') is null or (l ->> 'sweetness') not in ('0%', '25%', '50%', '75%', '100%') then
      return format('lines[%s].sweetness ไม่ถูกต้อง', v_i);
    end if;
    if (l ->> 'milk') is null or (l ->> 'milk') not in ('fresh', 'oat') then return format('lines[%s].milk ต้องเป็น fresh หรือ oat (ห้าม null)', v_i); end if;
    if not (l ? 'grade') or not (jsonb_typeof(l -> 'grade') = 'null' or public.dayo_pos_is_text(l -> 'grade', 1, 50)) then
      return format('lines[%s].grade ต้องเป็นรหัสเกรดหรือ null', v_i);
    end if;
    if not public.dayo_pos_is_int(l -> 'qty', 1, 999) then return format('lines[%s].qty ต้องเป็นจำนวนเต็ม 1–999', v_i); end if;
    if not public.dayo_pos_null_or(l, 'free') and jsonb_typeof(l -> 'free') <> 'boolean' then return format('lines[%s].free ต้องเป็น true/false', v_i); end if;
    if not public.dayo_pos_null_or(l, 'discount_baht') and not public.dayo_pos_is_money(l -> 'discount_baht') then
      return format('lines[%s].discount_baht ต้องเป็นเงินบาท ≥ 0 ทศนิยม ≤ 2 ตำแหน่ง', v_i);
    end if;
    if not public.dayo_pos_null_or(l, 'discount_percent')
       and not coalesce(jsonb_typeof(l -> 'discount_percent') = 'number' and (l ->> 'discount_percent')::numeric between 0 and 100, false) then
      return format('lines[%s].discount_percent ต้องเป็น 0–100', v_i);
    end if;
    if not public.dayo_pos_null_or(l, 'discount_baht') and not public.dayo_pos_null_or(l, 'discount_percent') then
      return format('lines[%s] ส่ง discount_baht และ discount_percent พร้อมกันไม่ได้', v_i);
    end if;
    if not public.dayo_pos_null_or(l, 'discount_reason') and not public.dayo_pos_is_text(l -> 'discount_reason', 1, 200) then
      return format('lines[%s].discount_reason ต้องเป็นข้อความ 1–200 ตัวอักษร', v_i);
    end if;
    if coalesce((l ->> 'free')::boolean, false) and public.dayo_pos_null_or(l, 'discount_reason') then
      return format('lines[%s] แก้วฟรีต้องมี discount_reason', v_i);
    end if;
    v_cups := v_cups + (l ->> 'qty')::integer;
  end loop;
  if v_cups > 500 then return 'บิลละไม่เกิน 500 แก้ว'; end if;
  if not public.dayo_pos_null_or(p, 'bill_discount') then
    if jsonb_typeof(bd) <> 'object' then return 'bill_discount ต้องเป็น object หรือ null'; end if;
    if public.dayo_pos_null_or(bd, 'baht') = public.dayo_pos_null_or(bd, 'percent') then
      return 'bill_discount ต้องมี baht หรือ percent อย่างใดอย่างหนึ่งเท่านั้น';
    end if;
    if not public.dayo_pos_null_or(bd, 'baht') and not public.dayo_pos_is_money(bd -> 'baht') then return 'bill_discount.baht ไม่ถูกต้อง'; end if;
    if not public.dayo_pos_null_or(bd, 'percent')
       and not coalesce(jsonb_typeof(bd -> 'percent') = 'number' and (bd ->> 'percent')::numeric between 0 and 100, false) then
      return 'bill_discount.percent ต้องเป็น 0–100';
    end if;
    if not public.dayo_pos_null_or(bd, 'reason') and not public.dayo_pos_is_text(bd -> 'reason', 1, 200) then
      return 'bill_discount.reason ต้องเป็นข้อความ 1–200 ตัวอักษร';
    end if;
  end if;
  if not public.dayo_pos_null_or(p, 'promo_code') and not public.dayo_pos_is_text(p -> 'promo_code', 1, 50) then return 'promo_code ไม่ถูกต้อง'; end if;
  if not public.dayo_pos_null_or(p, 'skip_promotion_ids') and (
       jsonb_typeof(p -> 'skip_promotion_ids') <> 'array' or jsonb_array_length(p -> 'skip_promotion_ids') > 200
       or exists (select 1 from jsonb_array_elements(p -> 'skip_promotion_ids') e
                  where jsonb_typeof(e) <> 'string' or not public.dayo_pos_is_uuid(e #>> '{}'))) then
    return 'skip_promotion_ids ต้องเป็นรายการ UUID';
  end if;
  if not public.dayo_pos_null_or(p, 'no_promotions') and jsonb_typeof(p -> 'no_promotions') <> 'boolean' then return 'no_promotions ต้องเป็น true/false'; end if;
  if jsonb_typeof(t) is distinct from 'object'
     or not public.dayo_pos_is_money(t -> 'items_subtotal') or not public.dayo_pos_is_money(t -> 'items_discount')
     or not public.dayo_pos_is_money(t -> 'bill_discount') or not public.dayo_pos_is_money(t -> 'total') then
    return 'totals ต้องมี items_subtotal, items_discount, bill_discount, total เป็นเงินบาท';
  end if;
  if not public.dayo_pos_null_or(p, 'note') and not public.dayo_pos_is_text(p -> 'note', 0, 200) then return 'note ต้องเป็นข้อความไม่เกิน 200 ตัวอักษร'; end if;
  return null;
end;
$$;

create or replace function public.dayo_pos_invalid_void(p jsonb)
returns text
language plpgsql
stable
set search_path = public
as $$
begin
  if not public.dayo_pos_is_uuid(p ->> 'pos_order_id') then return 'pos_order_id ต้องเป็น UUID ตัวเล็ก'; end if;
  if not public.dayo_pos_is_iso(p -> 'voided_at') then return 'voided_at ต้องเป็นเวลา ISO-8601'; end if;
  if not public.dayo_pos_is_uuid(p ->> 'staff_id') then return 'staff_id ต้องเป็น UUID ตัวเล็ก'; end if;
  if not (public.dayo_pos_null_or(p, 'approved_by') or public.dayo_pos_is_uuid(p ->> 'approved_by')) then return 'approved_by ต้องเป็น UUID หรือ null'; end if;
  if not public.dayo_pos_is_text(p -> 'reason', 1, 200) then return 'reason ต้องเป็นข้อความ 1–200 ตัวอักษร'; end if;
  return null;
end;
$$;

-- ฟิลด์ที่รุ่นนี้ไม่รู้จัก (รายการเดียวกับ E1 จาก dayo_pos_supported) · คีย์ย่อยของ bill_discount/totals ตายตัว
create or replace function public.dayo_pos_unknown_fields(p_kind text, p_data jsonb)
returns text[]
language sql
immutable
set search_path = public
as $$
  with allowed as (
    select jsonb_array_elements_text(public.dayo_pos_supported() -> 'supported_fields' -> p_kind) as f
  )
  select coalesce(array_agg(x), '{}') from (
    select k as x from jsonb_object_keys(p_data) k where k not in (select f from allowed where f not like '%.%')
    union all
    select 'lines.' || lk
    from jsonb_array_elements(case when jsonb_typeof(p_data -> 'lines') = 'array' then p_data -> 'lines' else '[]'::jsonb end) e,
      lateral jsonb_object_keys(case when jsonb_typeof(e) = 'object' then e else '{}'::jsonb end) lk
    where p_kind = 'order' and 'lines.' || lk not in (select f from allowed)
    union all
    select 'bill_discount.' || bk
    from jsonb_object_keys(case when jsonb_typeof(p_data -> 'bill_discount') = 'object' then p_data -> 'bill_discount' else '{}'::jsonb end) bk
    where p_kind = 'order' and bk not in ('baht', 'percent', 'reason')
    union all
    select 'totals.' || tk
    from jsonb_object_keys(case when jsonb_typeof(p_data -> 'totals') = 'object' then p_data -> 'totals' else '{}'::jsonb end) tk
    where p_kind = 'order' and tk not in ('items_subtotal', 'items_discount', 'bill_discount', 'total')
  ) u
$$;


-- ═════════════════════════════════════════════════════════════════════════════════
-- 4. คำตัดสิน · แผนที่ error (สเปก §4.5 ตาราง — ล็อก) · detail ไม่มีข้อความดิบของ Postgres
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_pos_verdict(p_key text, p_status text, p_reason text, p_detail text, p_data jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'key', left(coalesce(p_key, ''), 200), 'status', p_status, 'reason', p_reason, 'detail', left(p_detail, 500)))
    || case when p_data is not null and p_status in ('accepted', 'duplicate') then jsonb_build_object('data', p_data) else '{}'::jsonb end
$$;

create or replace function public.dayo_pos_error_verdict(p_state text, p_msg text)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_msg text := coalesce(p_msg, '');
  v_tag text := lower(btrim(split_part(v_msg, ':', 1)));
  v_thai text := case when strpos(v_msg, ':') > 0 then btrim(substr(v_msg, strpos(v_msg, ':') + 1)) else '' end;
begin
  -- ข้อความ DY… มาจาก RPC ของระบบนี้ (ภาษาไทย ไม่มี note/reason/id พนักงาน) · SQLSTATE อื่นไม่ใช้ข้อความเลย
  if p_state = 'DY422' then
    if v_tag = 'unknown_code' then
      return jsonb_build_object('status', 'rejected', 'reason', 'UNKNOWN_CODE', 'detail', v_thai);
    end if;
    return jsonb_build_object('status', 'rejected', 'reason', 'INVALID', 'detail', coalesce(nullif(v_thai, ''), 'ข้อมูลไม่ผ่านการตรวจ') || ' (DY422)');
  elsif p_state in ('DY401', 'DY404') and v_tag in ('staff_ref_invalid', 'staff_not_active', 'staff_required') then
    return jsonb_build_object('status', 'rejected', 'reason', 'UNKNOWN_STAFF', 'detail', 'ไม่พบพนักงานที่ระบุในร้าน (ต้องเป็น active หรือ removed)');
  elsif p_state = 'DY404' and v_tag = 'unknown_code' then
    return jsonb_build_object('status', 'rejected', 'reason', 'UNKNOWN_CODE', 'detail', v_thai);
  elsif p_state = 'DY404' and v_tag = 'parent_pending' then
    return jsonb_build_object('status', 'deferred', 'reason', 'PARENT_PENDING', 'detail', v_thai);
  elsif p_state = 'DY403' then
    return jsonb_build_object('status', 'rejected', 'reason', 'FORBIDDEN', 'detail', coalesce(nullif(v_thai, ''), 'ไม่มีสิทธิ์') || ' (DY403)');
  elsif p_state = 'DY409' and v_tag = 'external_ref_taken' then
    return jsonb_build_object('status', 'rejected', 'reason', 'CONFLICT', 'detail', v_thai);
  elsif p_state = 'DY409' and v_tag = 'already_cancelled' then
    return jsonb_build_object('status', 'duplicate');
  elsif p_state = 'DY409' and v_tag in ('idempotency_in_progress', 'duplicate_event') then
    return jsonb_build_object('status', 'deferred', 'reason', 'BUSY', 'detail', 'มีคำขออื่นกำลังบันทึกรายการนี้ — ลองใหม่อัตโนมัติ');
  elsif p_state in ('23502', '23514', '22001', '22003', '22007', '22008', '22021', '22P02', '22P05') then
    return jsonb_build_object('status', 'rejected', 'reason', 'INVALID', 'detail', format('ข้อมูลไม่ผ่านเงื่อนไขของฐานข้อมูล (SQLSTATE %s)', p_state));
  elsif p_state in ('40001', '40P01', '55P03', '57014') then
    return jsonb_build_object('status', 'deferred', 'reason', 'BUSY', 'detail', format('ระบบกลางไม่ว่างชั่วคราว (SQLSTATE %s) — ลองใหม่อัตโนมัติ', p_state));
  end if;
  return jsonb_build_object('status', 'deferred', 'reason', 'SERVER_ERROR', 'detail', format('SQLSTATE %s', p_state));
end;
$$;


revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
```

(ส่วน `create or replace function public.dayo_impl_price_line`, `dayo_quote_priced`, `dayo_impl_quote` ที่ลอกมา วางต่อจาก `dayo_promo_eligible` และก่อน `dayo_check_draft_size_pos` ใน 2 ข้างบน)

- [ ] **Step 4: รันให้ผ่าน + เทสต์เดิมทั้งหมด (กันถอยหลังของ quote/promo)**

Run: `npm run db:reset && npx vitest run --root packages/shared test/db && npm run db:types`
Expected: PASS ทุกไฟล์ — `orders.db.test.ts` ส่วน `quote_order = computeOrder` และโปรทั้งหมดยังผ่าน (`p_include_inactive = false` ทุกเส้นทางเดิม)

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add supabase/migrations/0050_pos_push_checks.sql packages/shared/test/db/pos_checks.db.test.ts packages/shared/src/database.types.ts apps/web/src/lib/backup.ts scripts/restore.ts
git commit -m "feat(db): add pos push row checks and allow items disabled after an offline sale"
```

---

## Task 3b: E2 `api_pos_push` — ใช้งานแถว · กันซ้ำ · savepoint ต่อแถว (migration 0051)

**agent:** db-engineer · opus · high (lane A · ใช้ Docker) · **เริ่มหลัง merge Task 3a และ Task 6** (เทสต์อ่าน fixture ชุดกลางของ Task 6 — ห้ามสร้าง fixture เองใน lane A)

**Files:**
- Create: `supabase/migrations/0051_pos_push.sql`
- Modify: `supabase/seed.sql` (บรรทัดท้าย)
- Create: `packages/shared/test/db/posFixtures.ts`, `packages/shared/test/db/pos_push.db.test.ts`
- Modify: `packages/shared/src/database.types.ts`

**Interfaces:**
- Consumes: ตัวตรวจ/`dayo_pos_verdict`/`dayo_pos_error_verdict`/`dayo_pos_unknown_fields` (Task 3a) · `dayo_pos_supported()` `dayo_iso_ms()` (Task 1) · ร่าง `pos` ของ `create_order` + `DY409 external_ref_taken` + `dayo_order_cancel_core` + `dayo_order_duplicate_of` + `dayo.pos_push` ใน `dayo_require_actor` (Task 2) · fixture ของ Task 6
- Produces:
  - `public.api_pos_push(p_shop_id uuid, p_api_client_id uuid, p_scopes text[], p_rows jsonb) returns jsonb` → `{server_time, results:[{key, status, reason?, detail?, data?}]}` — แต่ละแถวอยู่ใน `begin … exception` ของตัวเอง (ตรวจ (a)–(g) + ตรวจรูปอยู่ในนั้นด้วย) · error ใด ๆ ของแถว = คำตัดสินของแถวนั้น ไม่เคยเป็น exception ของทั้งคำขอ
  - `public.dayo_pos_order_data(p_order_id uuid, p_warnings jsonb) returns jsonb` → `{order_no, version, computed_total, amount_mismatch, duplicate_of, warnings}`
  - `public.dayo_pos_after_unique(p_shop_id uuid, p_client_id uuid, p_kind text, p_key text, p_hash text, p jsonb) returns jsonb`
  - `api_idempotency_keys.endpoint` รับ `'pos_push'` · ธงทดสอบ `note = "__fault_<SQLSTATE>__"` ทำงานเฉพาะเมื่อ GUC ระดับฐาน `dayo.test_faults = 'on'` (seed ของเครื่อง dev ตั้ง · production ไม่มีค่า)

- [ ] **Step 1: ตัวช่วยอ่าน fixture สำหรับเทสต์ฐานข้อมูล** — `packages/shared/test/db/posFixtures.ts`

```ts
// posFixtures.ts — อ่าน fixture สัญญา POS ชุดกลาง (apps/web/test/fixtures/pos-contract) มาเล่นกับฐานจริง
// แทน UUID ทุกตัวใน rows ด้วย UUID ใหม่ (คงความสัมพันธ์ key ↔ id) · แทน staff_id ด้วยพนักงานของร้านทดสอบ ·
// เลื่อน sold_at/sale_date/voided_at เป็น "2 นาทีก่อนตอนนี้" (fixture เขียนด้วยวันที่ 25 ก.ย. 2026)
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { REPO_ROOT } from "./helpers.js";
import type { Db } from "./helpers.js";

export interface PosFixture {
  name: string;
  request: { method: string; path: string; headers?: Record<string, string>; body?: { device_time?: string; rows?: unknown } };
  response: { status: number; body?: { ok: boolean; data?: { results?: Array<{ key: string; status: string; reason?: string }> } } };
}

export function loadPosFixture(name: string): PosFixture {
  return JSON.parse(readFileSync(`${REPO_ROOT}apps/web/test/fixtures/pos-contract/${name}.json`, "utf8")) as PosFixture;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
export const bkkDateOf = (iso: string): string => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10);

export type PushRow = { key: string; kind: string; data: Record<string, unknown> };

/** rows ใหม่ + ตาราง uuid เดิม → ใหม่ · staffMap: uuid พนักงานใน fixture → พนักงานจริงของร้านทดสอบ */
export function materializeRows(rows: unknown, staffMap: Record<string, string>): { rows: PushRow[]; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const soldAt = new Date(Date.now() - 2 * 60_000).toISOString();
  const text = JSON.stringify(rows).replace(UUID_RE, (u) => {
    if (staffMap[u]) return staffMap[u]!;
    if (!ids.has(u)) ids.set(u, randomUUID());
    return ids.get(u)!;
  });
  const out = JSON.parse(text) as PushRow[];
  for (const r of out) {
    if (r.data && typeof r.data === "object") {
      if ("sold_at" in r.data) r.data.sold_at = soldAt;
      if ("sale_date" in r.data) r.data.sale_date = bkkDateOf(soldAt);
      if ("voided_at" in r.data) r.data.voided_at = new Date(Date.parse(soldAt) + 30_000).toISOString();
    }
  }
  return { rows: out, ids };
}

/** API key ทดสอบของร้าน (คืน id) */
export async function createPosClient(
  svc: Db, shopId: string, scopes = ["catalog:read", "staff:read", "orders:read", "orders:write"],
): Promise<string> {
  const key = randomUUID();
  const [c] = await svc.insert<{ id: string }>("api_clients", {
    shop_id: shopId, name: `แท็บเล็ต ${key.slice(0, 6)}`, key_hash: createHash("sha256").update(key).digest("hex"),
    key_prefix: key.slice(0, 8), scopes,
  });
  return c!.id;
}
```

- [ ] **Step 2: เขียนเทสต์ที่ต้องตก** — `packages/shared/test/db/pos_push.db.test.ts` (ครอบเกณฑ์ก้อน 1 ทุกข้อที่เป็นของ E2)

```ts
// pos_push.db.test.ts — E2 POST /v1/pos/push ระดับฐานข้อมูล (ADR-0049 · สเปก POS 04 §4.5 · เกณฑ์ก้อน 1 ใน §9)
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { bkkDay } from "../../src/time.js";
import { connectLocalSupabase, createTestShop, Db, expectDbError } from "./helpers.js";
import type { TestShop } from "./helpers.js";
import { bkkDateOf, createPosClient, loadPosFixture, materializeRows } from "./posFixtures.js";
import { posParityCatalogPayload } from "./posParity.js";

const T = 120_000;
const sb = await connectLocalSupabase();

type Verdict = { key: string; status: string; reason?: string; detail?: string; data?: Record<string, unknown> };
type PushResult = { server_time: string; results: Verdict[] };

// พนักงานใน fixture (สเปก §4.4) → แทนด้วยพนักงานจริงของร้านทดสอบ
const FX_OWNER = "7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f";
const FX_STAFF = "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";

describe.skipIf(!sb)("api_pos_push (0050)", () => {
  let svc: Db;
  let shop: TestShop;
  let clientId: string;
  let receipt = 1000;
  const push = (rows: unknown, scopes = ["catalog:read", "staff:read", "orders:read", "orders:write"], client = clientId) =>
    svc.rpc<PushResult>("api_pos_push", { p_shop_id: shop.shopId, p_api_client_id: client, p_scopes: scopes, p_rows: rows });
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

  function orderData(over: Record<string, unknown> = {}): Record<string, unknown> {
    const soldAt = (over.sold_at as string) ?? minutesAgo(2);
    return {
      pos_order_id: randomUUID(), receipt_no: `A-${String(receipt++).padStart(6, "0")}`, queue_no: 7,
      sale_date: bkkDateOf(soldAt), sold_at: soldAt, channel: "store", payment: "cash", staff_id: shop.staffId,
      catalog_version: 1, shift_id: null,
      lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 1 }],
      bill_discount: null, promo_code: null, skip_promotion_ids: [], no_promotions: true,
      totals: { items_subtotal: 35, items_discount: 0, bill_discount: 0, total: 35 }, note: null,
      ...over,
    };
  }
  const orderRow = (d: Record<string, unknown>) => ({ key: `order:${d.pos_order_id}`, kind: "order", data: d });
  const voidRow = (posOrderId: string, over: Record<string, unknown> = {}) => ({
    key: `order_void:${posOrderId}`, kind: "order_void",
    data: { pos_order_id: posOrderId, voided_at: minutesAgo(1), staff_id: shop.staffId, approved_by: shop.ownerId, reason: "ลูกค้าเปลี่ยนใจ", ...over },
  });

  beforeAll(async () => {
    svc = Db.service(sb!);
    shop = await createTestShop(svc, "pos-push");
    await svc.rpc("import_catalog", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_payload: posParityCatalogPayload(), p_mode: "replace" });
    await svc.rpc("save_shop_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { default_milk: "fresh" } });
    clientId = await createPosClient(svc, shop.shopId);
  }, T);

  describe("fixture สัญญาเล่นกับฐานจริง (สถานะ/เหตุผลตรง fixture)", () => {
    for (const name of ["e2-order-accepted", "e2-unknown-code-other-row-ok", "e2-order-and-void-same-batch", "e2-unsupported-kind-and-field"]) {
      it(name, async () => {
        const fx = loadPosFixture(name);
        const { rows } = materializeRows(fx.request.body!.rows, { [FX_OWNER]: shop.ownerId, [FX_STAFF]: shop.staffId });
        for (const r of rows) if (r.kind === "order") r.data.receipt_no = `A-${String(receipt++).padStart(6, "0")}`;
        const res = await push(rows);
        const want = fx.response.body!.data!.results!;
        expect(res.results.map((r) => [r.status, r.reason ?? null])).toEqual(want.map((r) => [r.status, r.reason ?? null]));
        expect(res.results.map((r) => r.key)).toEqual(rows.map((r) => r.key));
      });
    }
  });

  it("ส่งแถวเดิมซ้ำ = duplicate ผลเดิม · computed_total มีทุกบิล", async () => {
    const d = orderData();
    const a = (await push([orderRow(d)])).results[0]!;
    expect(a.status).toBe("accepted");
    expect(Number(a.data!.computed_total)).toBe(35);
    const b = (await push([orderRow(d)])).results[0]!;
    expect(b).toMatchObject({ status: "duplicate", data: { order_no: a.data!.order_no } });
  });

  it("key เดิม เนื้อหาต่าง = rejected CONFLICT", async () => {
    const d = orderData();
    await push([orderRow(d)]);
    expect((await push([orderRow({ ...d, note: "เปลี่ยน" })])).results[0]).toMatchObject({ status: "rejected", reason: "CONFLICT" });
  });

  it("receipt_no เดิม + pos_order_id ใหม่ = CONFLICT ทั้งก่อนและหลังลบคีย์ 30 วัน", async () => {
    const d = orderData();
    await push([orderRow(d)]);
    expect((await push([orderRow(orderData({ receipt_no: d.receipt_no }))])).results[0]).toMatchObject({ status: "rejected", reason: "CONFLICT" });
    await svc.delete("api_idempotency_keys", `api_client_id=eq.${clientId}&endpoint=eq.pos_push`);
    expect((await push([orderRow(orderData({ receipt_no: d.receipt_no }))])).results[0]).toMatchObject({ status: "rejected", reason: "CONFLICT" });
    // หลังลบคีย์: pos_order_id เดิม เนื้อหาต่าง = duplicate (ข้อจำกัดที่ยอมรับ — บิลอยู่ในฐานแล้ว ไม่มีเงินหาย)
    expect((await push([orderRow({ ...d, note: "ต่าง" })])).results[0]!.status).toBe("duplicate");
  });

  it("rejected แล้วส่ง key เดิมด้วยข้อมูลที่แก้ = accepted (ผล rejected ไม่ถูกเก็บใต้ key)", async () => {
    const d = orderData({ lines: [{ code: "Mango", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 1 }] });
    expect((await push([orderRow(d)])).results[0]).toMatchObject({ status: "rejected", reason: "UNKNOWN_CODE" });
    const fixed = { ...d, lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 1 }] };
    expect((await push([orderRow(fixed)])).results[0]!.status).toBe("accepted");
  });

  it("รหัสเมนูไม่รู้จัก = UNKNOWN_CODE แถวอื่นในก้อนยังผ่าน · detail ไม่สะท้อน note/id พนักงาน", async () => {
    const bad = orderData({ note: "SECRET-NOTE-123", lines: [{ code: "Nope", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 1 }] });
    const res = await push([orderRow(bad), orderRow(orderData())]);
    expect(res.results.map((r) => r.status)).toEqual(["rejected", "accepted"]);
    expect(res.results[0]!.detail).not.toContain("SECRET-NOTE");
    expect(res.results[0]!.detail).not.toContain(shop.staffId);
  });

  it("ตัวแปรที่ปิดใช้แล้ว + นมโอ๊ตที่ปิดแล้ว = ผ่าน และยอดที่คิดเท่ากับตอนขาย (§5.3 เคส 14)", async () => {
    const q = await svc.rpc<{ total: number }>("quote_order", { p_shop_id: shop.shopId, p_draft: {
      sale_date: bkkDay(0), channel: "store", payment: "cash", no_promotions: true,
      lines: [{ code: "Green Tea", size: "20 oz", sweetness: "50%", milk: "oat", qty: 1 }] } });
    const [v] = await svc.select<{ id: string }>("menu_variants",
      `select=id,menu_items!inner(shop_id,code)&menu_items.shop_id=eq.${shop.shopId}&menu_items.code=eq.Green%20Tea&size=eq.20%20oz&sweetness=eq.50%25`);
    await svc.update("menu_variants", `id=eq.${v!.id}`, { is_active: false });
    await svc.update("menu_options", `shop_id=eq.${shop.shopId}&kind=eq.milk&code=eq.oat`, { is_active: false });
    try {
      const d = orderData({ lines: [{ code: "Green Tea", size: "20 oz", sweetness: "50%", milk: "oat", grade: null, qty: 1 }],
        totals: { items_subtotal: q.total, items_discount: 0, bill_discount: 0, total: q.total } });
      const r = (await push([orderRow(d)])).results[0]!;
      expect(r.status).toBe("accepted");
      expect(Number(r.data!.computed_total)).toBe(Number(q.total));
    } finally {
      await svc.update("menu_variants", `id=eq.${v!.id}`, { is_active: true });
      await svc.update("menu_options", `shop_id=eq.${shop.shopId}&kind=eq.milk&code=eq.oat`, { is_active: true });
    }
  });

  it("พนักงาน removed = ผ่าน · pending = UNKNOWN_STAFF", async () => {
    const id = randomUUID();
    await svc.insert("staff", { id, shop_id: shop.shopId, line_user_id: `U${id.replace(/-/g, "")}`, display_name: "ออกแล้ว", role: "staff", status: "removed" });
    expect((await push([orderRow(orderData({ staff_id: id }))])).results[0]!.status).toBe("accepted");
    expect((await push([orderRow(orderData({ staff_id: shop.pendingId }))])).results[0]).toMatchObject({ status: "rejected", reason: "UNKNOWN_STAFF" });
  });

  it("qty เกิน maxQtyPerLine ของร้าน (บิล POS) ไม่ถูกบีบ", async () => {
    await svc.rpc("save_shop_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { max_qty_per_line: 5 } });
    try {
      const d = orderData({ lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 8 }],
        totals: { items_subtotal: 280, items_discount: 0, bill_discount: 0, total: 280 } });
      const r = (await push([orderRow(d)])).results[0]!;
      expect(r.status).toBe("accepted");
      expect(Number(r.data!.computed_total)).toBe(280);
    } finally {
      await svc.rpc("save_shop_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { max_qty_per_line: 99 } });
    }
  });

  it("sold_at เกินเวลาเซิร์ฟเวอร์ + 5 นาที = deferred CLOCK_AHEAD", async () => {
    const future = new Date(Date.now() + 7 * 60_000).toISOString();
    expect((await push([orderRow(orderData({ sold_at: future }))])).results[0]).toMatchObject({ status: "deferred", reason: "CLOCK_AHEAD" });
  });

  it("sale_date ไม่ตรงวันที่ไทยของ sold_at · เก่ากว่า 60 วัน · bill_discount สองค่า · milk null = INVALID ทั้งหมด", async () => {
    const wrongDate = { ...orderData(), sale_date: "2020-01-01" };
    const old = orderData({ sold_at: new Date(Date.now() - 61 * 86_400_000).toISOString() });
    const both = orderData({ bill_discount: { baht: 5, percent: 10, reason: null } });
    const milkNull = orderData({ lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: null, grade: null, qty: 1 }] });
    const res = await push([orderRow(wrongDate), orderRow(old), orderRow(both), orderRow(milkNull)]);
    expect(res.results.map((r) => r.reason)).toEqual(["INVALID", "INVALID", "INVALID", "INVALID"]);
  });

  it("key ผิดรูป / uuid ใน key ไม่ตรง data = BAD_KEY · key ไม่มี orders:write = FORBIDDEN", async () => {
    const d = orderData();
    const res = await push([{ key: "order:not-a-uuid", kind: "order", data: d }, { key: `order:${randomUUID()}`, kind: "order", data: d }]);
    expect(res.results.map((r) => r.reason)).toEqual(["BAD_KEY", "BAD_KEY"]);
    const readOnly = await createPosClient(svc, shop.shopId, ["catalog:read", "orders:read"]);
    const f = await push([orderRow(orderData())], ["catalog:read", "orders:read"], readOnly);
    expect(f.results[0]).toMatchObject({ status: "rejected", reason: "FORBIDDEN" });
  });

  describe("order_void", () => {
    it("ยกเลิกวันเดียวกัน = accepted (cancelled_by, cancel_reason, audit approved_by) · ส่งซ้ำ = duplicate", async () => {
      const d = orderData();
      await push([orderRow(d)]);
      expect((await push([voidRow(d.pos_order_id as string)])).results[0]!.status).toBe("accepted");
      const [o] = await svc.select<Record<string, unknown>>("orders", `api_client_id=eq.${clientId}&pos_order_id=eq.${d.pos_order_id}&select=*`);
      expect(o).toMatchObject({ status: "cancelled", cancelled_by: shop.staffId, cancel_reason: "ลูกค้าเปลี่ยนใจ" });
      const audit = await svc.select<{ after: Record<string, unknown> }>("audit_log", `entity_id=eq.${o!.id}&action=eq.order_cancel&select=after`);
      expect(audit[0]!.after.approved_by).toBe(shop.ownerId);
      expect((await push([voidRow(d.pos_order_id as string)])).results[0]!.status).toBe("duplicate");
    });

    it("voided_at วันเดียวกับวันขายแต่ส่งวันถัดไป = ผ่าน", async () => {
      const soldAt = new Date(Date.now() - 30 * 3600_000).toISOString(); // เมื่อวาน (หรือก่อนนั้น 1 วัน)
      const d = orderData({ sold_at: soldAt });
      await push([orderRow(d)]);
      const voidedAt = new Date(Date.parse(soldAt) + 60_000).toISOString();
      if (bkkDateOf(voidedAt) !== bkkDateOf(soldAt)) return; // ข้ามเมื่อ sold_at อยู่นาทีสุดท้ายของวันไทย
      expect((await push([voidRow(d.pos_order_id as string, { voided_at: voidedAt })])).results[0]!.status).toBe("accepted");
    });

    it("voided_at คนละวันกับวันขาย = FORBIDDEN · ก่อน sold_at = INVALID · เกินเซิร์ฟเวอร์ 7 นาที = deferred CLOCK_AHEAD", async () => {
      const soldAt = new Date(Date.now() - 30 * 3600_000).toISOString();
      const d = orderData({ sold_at: soldAt });
      await push([orderRow(d)]);
      const id = d.pos_order_id as string;
      expect((await push([voidRow(id, { voided_at: minutesAgo(1) })])).results[0]).toMatchObject({ status: "rejected", reason: "FORBIDDEN" });
      expect((await push([voidRow(id, { voided_at: new Date(Date.parse(soldAt) - 60_000).toISOString() })])).results[0])
        .toMatchObject({ status: "rejected", reason: "INVALID" });
      expect((await push([voidRow(id, { voided_at: new Date(Date.now() + 7 * 60_000).toISOString() })])).results[0])
        .toMatchObject({ status: "deferred", reason: "CLOCK_AHEAD" });
    });

    it("บิลยังไม่มา = deferred PARENT_PENDING · บิลของ key อื่น = FORBIDDEN · บิล + ยกเลิกในก้อนเดียว = ผ่านทั้งคู่", async () => {
      expect((await push([voidRow(randomUUID())])).results[0]).toMatchObject({ status: "deferred", reason: "PARENT_PENDING" });
      const other = await createPosClient(svc, shop.shopId);
      const d = orderData();
      await push([orderRow(d)], undefined, other);
      expect((await push([voidRow(d.pos_order_id as string)])).results[0]).toMatchObject({ status: "rejected", reason: "FORBIDDEN" });
      const d2 = orderData();
      expect((await push([orderRow(d2), voidRow(d2.pos_order_id as string)])).results.map((r) => r.status)).toEqual(["accepted", "accepted"]);
    });
  });

  it("ชนิด/ฟิลด์ไม่รู้จัก = deferred UNSUPPORTED · ฟิลด์ใน supported_fields ครบทุกตัวรับได้", async () => {
    const res = await push([
      { key: `shift_open:${randomUUID()}`, kind: "shift_open", data: {} },
      orderRow(orderData({ tip: 5 })),
      orderRow(orderData({ lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 1, topping: "x" }] })),
    ]);
    expect(res.results.map((r) => [r.status, r.reason])).toEqual([["deferred", "UNSUPPORTED"], ["deferred", "UNSUPPORTED"], ["deferred", "UNSUPPORTED"]]);
    const full = orderData({ promo_code: null, lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 1,
      free: false, discount_baht: null, discount_percent: null, discount_reason: null }] });
    expect((await push([orderRow(full)])).results[0]!.status).toBe("accepted");
  });

  it("error ที่ไม่ได้แผนที่ (บังคับ raise XX000) = deferred SERVER_ERROR เฉพาะแถวนั้น แถวอื่นผ่าน", async () => {
    const res = await push([orderRow(orderData({ note: "__fault_XX000__" })), orderRow(orderData())]);
    expect(res.results[0]).toMatchObject({ status: "deferred", reason: "SERVER_ERROR", detail: "SQLSTATE XX000" });
    expect(res.results[1]!.status).toBe("accepted");
  });

  it("23505 (ชนพร้อมกัน): บังคับ raise 23505 ขณะยังไม่มีอะไรในฐาน = deferred BUSY", async () => {
    const r = (await push([orderRow(orderData({ note: "__fault_23505__" }))])).results[0]!;
    expect(r).toMatchObject({ status: "deferred", reason: "BUSY" });
  });

  it("23505 ปลายทางจริง: ส่งแถวเดียวกันสองคำขอพร้อมกัน = accepted หนึ่ง + duplicate หนึ่ง (order_no เดียวกัน)", async () => {
    const d = orderData();
    const [a, b] = await Promise.all([push([orderRow(d)]), push([orderRow(d)])]);
    const rs = [a.results[0]!, b.results[0]!];
    expect(rs.map((r) => r.status).sort()).toEqual(["accepted", "duplicate"]);
    expect(rs[0]!.data!.order_no).toBe(rs[1]!.data!.order_no);
  });

  it("dayo_pos_after_unique: key เดิม hash เดิม = duplicate · มีบิล pos_order_id แล้ว = duplicate · ใบเสร็จชน = CONFLICT", async () => {
    const d = orderData();
    await push([orderRow(d)]);
    const after = (kind: string, key: string, hash: string, data: Record<string, unknown>) =>
      svc.rpc<{ status: string; reason?: string }>("dayo_pos_after_unique", {
        p_shop_id: shop.shopId, p_client_id: clientId, p_kind: kind, p_key: key, p_hash: hash, p: data });
    const [k] = await svc.select<{ request_hash: string }>("api_idempotency_keys",
      `api_client_id=eq.${clientId}&idempotency_key=eq.order:${d.pos_order_id}&select=request_hash`);
    expect((await after("order", `order:${d.pos_order_id}`, k!.request_hash, d)).status).toBe("duplicate");
    expect((await after("order", `order:${d.pos_order_id}`, "0".repeat(64), d)).reason).toBe("CONFLICT");
    expect((await after("order", `order:${randomUUID()}`, "x", d)).status).toBe("duplicate");
    const other = orderData({ receipt_no: d.receipt_no });
    expect((await after("order", `order:${other.pos_order_id}`, "x", other)).reason).toBe("CONFLICT");
  });

  it("trigger ดูแลช่วงเปิดของโปร: ปิด = ปิดช่วง · เปิดใหม่ = ช่วงใหม่ · สร้างโปรที่ active = ช่วงเปิด · แก้ชื่อ = ไม่แตะ", async () => {
    const [p] = await svc.select<{ id: string }>("promotions", `shop_id=eq.${shop.shopId}&code=eq.GRAB3&select=id`);
    const windows = () => svc.select<{ activated_at: string; deactivated_at: string | null }>("promotion_active_windows",
      `promotion_id=eq.${p!.id}&select=activated_at,deactivated_at&order=activated_at`);
    const before = (await windows()).length;
    expect((await windows()).filter((w) => w.deactivated_at === null)).toHaveLength(1);   // import สร้างแบบ active
    await svc.update("promotions", `id=eq.${p!.id}`, { is_active: false });
    expect((await windows()).filter((w) => w.deactivated_at === null)).toHaveLength(0);
    await svc.update("promotions", `id=eq.${p!.id}`, { name: "Grab ลด 3 (ชื่อใหม่)" });
    expect(await windows()).toHaveLength(before);
    await svc.update("promotions", `id=eq.${p!.id}`, { is_active: true, name: "Grab ลด 3" });
    const w = await windows();
    expect(w).toHaveLength(before + 1);
    expect(w.filter((x) => x.deactivated_at === null)).toHaveLength(1);
  });

  it("โปรที่ปิดแล้ว: ใช้กับบิล POS เฉพาะเมื่อ sold_at อยู่ในช่วงเปิด (เต็มความละเอียด) · ปิด-เปิด-ปิดหลายรอบ · แก้ชื่อหลังขายไม่มีผล", async () => {
    // ช่วงเวลาตายตัว (insert ตรงด้วย service_role บนเครื่อง dev — ไม่รอเวลาจริง ไม่ย้อนเวลาใน trigger)
    const lines = [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 3 }];
    const [b2g1] = await svc.select<{ id: string }>("promotions", `shop_id=eq.${shop.shopId}&code=eq.B2G1&select=id`);
    const others = (await svc.select<{ id: string }>("promotions", `shop_id=eq.${shop.shopId}&code=neq.B2G1&select=id`)).map((p) => p.id);
    const bill = (soldAt: string, total: number) => orderData({ sold_at: soldAt, lines, no_promotions: false, skip_promotion_ids: others,
      totals: { items_subtotal: 105, items_discount: 105 - total, bill_discount: 0, total } });
    const at = (m: number, s = 0) => new Date(Math.floor(Date.now() / 60_000) * 60_000 - m * 60_000 + s * 1_000).toISOString();
    const computed = async (soldAt: string, total: number) => {
      const r = (await push([orderRow(bill(soldAt, total))])).results[0]!;
      expect(r.status, soldAt).toBe("accepted");
      return Number(r.data!.computed_total);
    };
    await svc.update("promotions", `id=eq.${b2g1!.id}`, { is_active: false });
    await svc.delete("promotion_active_windows", `promotion_id=eq.${b2g1!.id}`);
    await svc.insert("promotion_active_windows", [
      { shop_id: shop.shopId, promotion_id: b2g1!.id, activated_at: at(120), deactivated_at: at(60, 10) },   // เปิดรอบแรก (ปิดที่วินาทีที่ 10)
      { shop_id: shop.shopId, promotion_id: b2g1!.id, activated_at: at(30), deactivated_at: at(20) },        // เปิดรอบสอง
    ]);
    try {
      expect(await computed(at(150), 105)).toBe(105);      // ก่อนโปรเคยเปิด (โปรเปิดหลังเวลาขาย) → ไม่คิด
      expect(await computed(at(90), 70)).toBe(70);         // อยู่ในช่วงรอบแรก → คิด 2 แถม 1
      expect(await computed(at(60, 9), 70)).toBe(70);      // 1 วินาทีก่อนปิด (นาทีเดียวกัน) → คิด — เทียบเต็มความละเอียด ไม่ตัดวินาที
      expect(await computed(at(60, 40), 105)).toBe(105);   // 30 วินาทีหลังปิด (นาทีเดียวกัน) → ไม่คิด
      expect(await computed(at(45), 105)).toBe(105);       // ระหว่างปิดรอบแรกกับเปิดรอบสอง → ไม่คิด
      expect(await computed(at(25), 70)).toBe(70);         // ในช่วงรอบสอง → คิด
      expect(await computed(at(10), 105)).toBe(105);       // หลังปิดรอบสอง → ไม่คิด
      await svc.update("promotions", `id=eq.${b2g1!.id}`, { name: "ชาไทย ซื้อ 2 แถม 1 (ชื่อใหม่)" });   // แก้ชื่อหลังขายทุกบิล
      expect(await computed(at(90, 30), 70)).toBe(70);     // ยังคิดเหมือนเดิม
      expect(await computed(at(10, 30), 105)).toBe(105);   // ยังไม่คิดเหมือนเดิม
    } finally {
      await svc.update("promotions", `id=eq.${b2g1!.id}`, { is_active: true, name: "ชาไทย ซื้อ 2 แถม 1" });
    }
  });

  it("พนักงาน removed ใช้ได้เฉพาะทาง E2 — create_order ผ่าน API เดิม (POST /v1/orders) ยัง DY401", async () => {
    const id = randomUUID();
    await svc.insert("staff", { id, shop_id: shop.shopId, line_user_id: `U${id.replace(/-/g, "")}`, display_name: "ออกแล้ว 2", role: "staff", status: "removed" });
    const e = await expectDbError(svc.rpc("create_order", {
      p_shop_id: shop.shopId, p_actor: { api_client_id: clientId, staff_id: id },
      p_draft: { sale_date: bkkDay(0), channel: "store", payment: "cash", no_promotions: true,
                 lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", qty: 1 }], pos_amounts: { total: 35 } },
      p_idempotency: { external_ref: `LEGACY-${id.slice(0, 8)}` } }));
    expect(e.code).toBe("DY401");
  });

  it("key ยาวเกิน 200 ในคำตอบถูกตัด · ซองผิด (ไม่ใช่ array / 21 แถว) = DY422 ทั้งคำขอ", async () => {
    const r = (await push([{ key: `order:${"x".repeat(300)}`, kind: "order", data: orderData() }])).results[0]!;
    expect(r.key.length).toBe(200);
    expect(r.reason).toBe("BAD_KEY");
    await expect(push({ not: "array" })).rejects.toMatchObject({ err: { code: "DY422" } });
    await expect(push(Array.from({ length: 21 }, () => orderRow(orderData())))).rejects.toMatchObject({ err: { code: "DY422" } });
  });
});
```

- [ ] **Step 3: รันให้ตก**

Run: `npm run db:reset && npx vitest run --root packages/shared test/db/pos_push.db.test.ts`
Expected: FAIL — `function public.api_pos_push(...) does not exist`

- [ ] **Step 4: เขียน migration** — `supabase/migrations/0051_pos_push.sql`

**ลำดับตรวจเต็มของแถว (ล็อก — ADR-0049 · สเปก §4.5 ข้อ 0 · ใส่ใน ADR ตาม Task 0):**
(a) รูปของแถว: `key` ข้อความ 1–200 → ไม่ใช่ = `BAD_KEY` · `kind` ข้อความ + `data` object → ไม่ใช่ = `INVALID`
(b) `kind` อยู่ใน `supported_kinds` → ไม่อยู่ = `deferred UNSUPPORTED`
(c) scope ของชนิด (`orders:write`) → ไม่มี = `FORBIDDEN`
(d) `key` = `<kind>:<uuid>` และ uuid = `data.pos_order_id` → ไม่ใช่ = `BAD_KEY`
(e) ฟิลด์ที่ไม่รู้จัก → `deferred UNSUPPORTED`
(1) **hash ของ key**: มีใน `api_idempotency_keys` → hash เท่า = `duplicate` ผลเดิม · ต่าง = `CONFLICT` (หยุด)
(f) รูปฟิลด์ → `INVALID`
(g) นาฬิกา: `sold_at`/`voided_at` > เวลาเซิร์ฟเวอร์ + 5 นาที → `deferred CLOCK_AHEAD`
(2) ใน savepoint — `order`: (ก0) *ก้อน 3 เพิ่ม `pos_excluded_orders` ตรงนี้* → (ก) มี `(api_client_id, pos_order_id)` = `duplicate` → (ข) มี `(api_client_id, external_ref)` = `CONFLICT` → (ค) `sale_date` = วันที่ไทยของ `sold_at` (`INVALID`) · `sale_date` > วันนี้ (`deferred CLOCK_AHEAD` — ข้ามเที่ยงคืนภายใน 5 นาที) · < วันนี้ − 60 (`INVALID`) · พนักงาน active/removed (`UNKNOWN_STAFF`) · รหัสทุกตัวมีในร้าน (`UNKNOWN_CODE`) · `create_order` — `order_void`: หาบิลของ key นี้ (ไม่พบ: มีของ key อื่น = `FORBIDDEN` ไม่งั้น `deferred PARENT_PENDING`) → `voided_at` ≥ `sold_at` (`INVALID`) → วันที่ไทยของ `voided_at` = `sale_date` (`FORBIDDEN`) → ยกเลิกแล้ว = `duplicate` → พนักงาน/ผู้อนุมัติ (`UNKNOWN_STAFF`) → ยกเลิก
(3) สำเร็จ (`accepted`/`duplicate`) → เก็บ key + hash + `data` ของผล · exception ใด ๆ ใน (2)(3) → `dayo_pos_error_verdict` (23505 → หาใหม่ตาม (1)/(ก)/(ข))
(4) **ทุกขั้นตั้งแต่ (a) อยู่ใน savepoint ชั้นนอกของแถว** (`api_pos_push`) — exception ที่หลุดจากขั้น (a)–(g) (เช่นบั๊กในตัวตรวจรูป) = `deferred SERVER_ERROR` เฉพาะแถวนั้น · แถวที่มี `\u0000` หรือ surrogate เดี่ยว (Postgres แปลงเป็น jsonb ไม่ได้) ถูกแยกออกเป็น `rejected INVALID` ที่ชั้นเว็บก่อนเรียก RPC (Task 8) — ทั้งคำขอไม่เป็น 5xx เพราะแถวเดียว

```sql
-- 0051_pos_push — E2 POST /v1/pos/push คำตัดสินรายแถว (ADR-0049 · สเปก POS 04 §4.5) · ไม่แก้ไฟล์เก่า

-- ═════════════════════════════════════════════════════════════════════════════════
-- 1. กันซ้ำ endpoint ใหม่ · ธงทดสอบ (มีแถวเฉพาะเครื่อง dev จาก seed.sql — production ว่างเสมอ)
-- ═════════════════════════════════════════════════════════════════════════════════
alter table public.api_idempotency_keys drop constraint api_idempotency_keys_endpoint_check;
alter table public.api_idempotency_keys add constraint api_idempotency_keys_endpoint_check
  check (endpoint in ('stock_movements', 'pos_push'));

-- ธงทดสอบ = GUC ระดับฐาน dayo.test_faults (seed ของเครื่อง dev เท่านั้น) — ไม่มีตาราง


-- ═════════════════════════════════════════════════════════════════════════════════
-- 5. ตรวจธุรกิจของแถว order / order_void
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_pos_require_staff(p_shop_id uuid, p_staff_id uuid)
returns void language plpgsql stable set search_path = public
as $$
begin
  if not exists (select 1 from public.staff s where s.id = p_staff_id and s.shop_id = p_shop_id and s.status in ('active', 'removed')) then
    raise exception using errcode = 'DY404', message = 'staff_ref_invalid: ไม่พบพนักงานที่ระบุ';
  end if;
end;
$$;

-- รหัสต้องมีในร้าน (รวมที่ปิดใช้แล้ว) — ไม่มีเลย = unknown_code · มัตจะต้องมีเกรด / เมนูอื่นห้ามมีเกรด = invalid
create or replace function public.dayo_pos_check_codes(p_shop_id uuid, p_data jsonb)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  l jsonb;
  m public.menu_items;
begin
  if not exists (select 1 from public.sales_channels c where c.shop_id = p_shop_id and c.code = p_data ->> 'channel') then
    raise exception using errcode = 'DY422', message = format('unknown_code: ไม่พบช่องทาง "%s"', p_data ->> 'channel');
  end if;
  if not exists (select 1 from public.payment_methods pm where pm.shop_id = p_shop_id and pm.code = p_data ->> 'payment') then
    raise exception using errcode = 'DY422', message = format('unknown_code: ไม่พบวิธีชำระ "%s"', p_data ->> 'payment');
  end if;
  for l in select e from jsonb_array_elements(p_data -> 'lines') e loop
    select * into m from public.menu_items x where x.shop_id = p_shop_id and x.code = l ->> 'code';
    if not found then
      raise exception using errcode = 'DY422', message = format('unknown_code: ไม่พบเมนู "%s"', l ->> 'code');
    end if;
    if not exists (select 1 from public.menu_variants v where v.menu_item_id = m.id and v.size = l ->> 'size' and v.sweetness = l ->> 'sweetness') then
      raise exception using errcode = 'DY422',
        message = format('unknown_code: ไม่พบขนาด-ความหวาน "%s %s %s"', m.code, l ->> 'size', l ->> 'sweetness');
    end if;
    if not exists (select 1 from public.menu_options o where o.shop_id = p_shop_id and o.kind = 'milk' and o.code = l ->> 'milk') then
      raise exception using errcode = 'DY422', message = format('unknown_code: ไม่พบตัวเลือกนม "%s"', l ->> 'milk');
    end if;
    if m.is_matcha then
      if l ->> 'grade' is null then
        raise exception using errcode = 'DY422', message = format('invalid: เมนูมัตจะ "%s" ต้องส่งเกรดผง', m.code);
      end if;
      if not exists (select 1 from public.menu_options o where o.shop_id = p_shop_id and o.kind = 'matcha_grade' and o.code = l ->> 'grade') then
        raise exception using errcode = 'DY422', message = format('unknown_code: ไม่พบเกรดผง "%s"', l ->> 'grade');
      end if;
    elsif l ->> 'grade' is not null then
      raise exception using errcode = 'DY422', message = format('invalid: เมนู "%s" ไม่ใช่มัตจะ ต้องส่ง grade เป็น null', m.code);
    end if;
  end loop;
end;
$$;

create or replace function public.dayo_pos_order_data(p_order_id uuid, p_warnings jsonb)
returns jsonb language sql stable set search_path = public
as $$
  select jsonb_build_object('order_no', o.order_no, 'version', o.version, 'computed_total', o.pos_computed_total,
    'amount_mismatch', o.amount_mismatch, 'duplicate_of', public.dayo_order_duplicate_of(o.id),
    'warnings', coalesce(p_warnings, '[]'::jsonb))
  from public.orders o where o.id = p_order_id
$$;

-- ร่าง SQL ของ create_order จาก data ของแถว order
-- sale_time = HH24:MI ไทยของ sold_at (ตัดวินาที ไม่ปัด) · skip_promotion_ids/no_promotions → ฟิลด์เดิมของ SQL
create or replace function public.dayo_pos_order_draft(p jsonb)
returns jsonb language sql stable set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'sale_date', p -> 'sale_date',
    'sale_time', to_char(((p ->> 'sold_at')::timestamptz) at time zone 'Asia/Bangkok', 'HH24:MI'),
    'channel', p -> 'channel', 'payment', p -> 'payment', 'promo_code', p -> 'promo_code',
    'skip_promotions', coalesce(p -> 'skip_promotion_ids', '[]'::jsonb),
    'no_promotions', coalesce(p -> 'no_promotions', 'false'::jsonb),
    'bill_discount', p -> 'bill_discount', 'note', p -> 'note', 'pos_amounts', p -> 'totals',
    'pos', jsonb_build_object('pos_order_id', p -> 'pos_order_id', 'queue_no', p -> 'queue_no', 'shift_id', p -> 'shift_id',
                              'catalog_version', p -> 'catalog_version', 'sold_at', p -> 'sold_at'),
    'lines', (select jsonb_agg(jsonb_build_object('code', l -> 'code', 'size', l -> 'size', 'sweetness', l -> 'sweetness',
                'milk', l -> 'milk', 'grade', l -> 'grade', 'qty', l -> 'qty', 'free', coalesce(l -> 'free', 'false'::jsonb),
                'discount_baht', l -> 'discount_baht', 'discount_percent', l -> 'discount_percent',
                'discount_reason', l -> 'discount_reason') order by o)
              from jsonb_array_elements(p -> 'lines') with ordinality t(l, o))))
$$;

create or replace function public.dayo_pos_apply_order(p_shop_id uuid, p_client_id uuid, p jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_pos_id uuid := (p ->> 'pos_order_id')::uuid;
  v_sold timestamptz := (p ->> 'sold_at')::timestamptz;
  v_sale date := (p ->> 'sale_date')::date;
  v_staff uuid := (p ->> 'staff_id')::uuid;
  v_id uuid;
  v_created jsonb;
begin
  -- ธงทดสอบ: GUC ระดับฐาน dayo.test_faults = 'on' ตั้งโดย seed ของเครื่อง dev (alter database) · PostgREST/service_role ตั้งไม่ได้ · production ไม่มีค่า
  if (p ->> 'note') like '\_\_fault\_%' and current_setting('dayo.test_faults', true) = 'on' then
    raise exception using errcode = substr(p ->> 'note', 9, 5), message = 'test fault';
  end if;
  -- (ก0) ก้อน 3 (P3): pos_order_id อยู่ใน pos_excluded_orders → rejected CONFLICT — ตารางยังไม่มีในก้อนนี้
  -- (ก)
  select o.id into v_id from public.orders o where o.api_client_id = p_client_id and o.pos_order_id = v_pos_id;
  if found then
    return jsonb_build_object('status', 'duplicate', 'data', public.dayo_pos_order_data(v_id, '[]'::jsonb));
  end if;
  -- (ข)
  if exists (select 1 from public.orders o where o.api_client_id = p_client_id and o.external_ref = p ->> 'receipt_no') then
    return jsonb_build_object('status', 'rejected', 'reason', 'CONFLICT',
      'detail', format('เลขใบเสร็จ %s ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว', p ->> 'receipt_no'));
  end if;
  -- (ค)
  if v_sale <> (v_sold at time zone 'Asia/Bangkok')::date then
    return jsonb_build_object('status', 'rejected', 'reason', 'INVALID',
      'detail', format('sale_date %s ไม่ตรงกับวันที่ไทยของ sold_at (%s)', v_sale, (v_sold at time zone 'Asia/Bangkok')::date));
  end if;
  if v_sale > public.dayo_today() then
    return jsonb_build_object('status', 'deferred', 'reason', 'CLOCK_AHEAD',
      'detail', format('วันขาย %s ยังมาไม่ถึงตามเวลาระบบกลาง — ตรวจนาฬิกาเครื่องค่ะ', v_sale));
  end if;
  if v_sale < public.dayo_today() - 60 then
    return jsonb_build_object('status', 'rejected', 'reason', 'INVALID', 'detail', format('sale_date %s เก่ากว่า 60 วัน', v_sale));
  end if;
  perform public.dayo_pos_require_staff(p_shop_id, v_staff);
  perform public.dayo_pos_check_codes(p_shop_id, p);
  v_created := public.create_order(p_shop_id, jsonb_build_object('api_client_id', p_client_id, 'staff_id', v_staff),
                                   public.dayo_pos_order_draft(p), jsonb_build_object('external_ref', p ->> 'receipt_no'));
  select o.id into v_id from public.orders o where o.shop_id = p_shop_id and o.order_no = v_created ->> 'order_no';
  if coalesce((v_created ->> 'duplicate')::boolean, false) then
    return jsonb_build_object('status', 'duplicate', 'data', public.dayo_pos_order_data(v_id, '[]'::jsonb));
  end if;
  return jsonb_build_object('status', 'accepted', 'data', public.dayo_pos_order_data(v_id, coalesce(v_created -> 'warnings', '[]'::jsonb)));
end;
$$;

create or replace function public.dayo_pos_apply_void(p_shop_id uuid, p_client_id uuid, p jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_pos_id uuid := (p ->> 'pos_order_id')::uuid;
  v_at timestamptz := (p ->> 'voided_at')::timestamptz;
  v_staff uuid := (p ->> 'staff_id')::uuid;
  v_appr uuid := case when public.dayo_pos_null_or(p, 'approved_by') then null else (p ->> 'approved_by')::uuid end;
  v_day date := ((p ->> 'voided_at')::timestamptz at time zone 'Asia/Bangkok')::date;
  o public.orders;
begin
  select * into o from public.orders x
  where x.shop_id = p_shop_id and x.api_client_id = p_client_id and x.pos_order_id = v_pos_id for update;
  if not found then
    if exists (select 1 from public.orders x where x.shop_id = p_shop_id and x.pos_order_id = v_pos_id) then
      return jsonb_build_object('status', 'rejected', 'reason', 'FORBIDDEN', 'detail', 'ยกเลิกได้เฉพาะบิลที่เครื่องนี้ส่งเข้ามา');
    end if;
    return jsonb_build_object('status', 'deferred', 'reason', 'PARENT_PENDING', 'detail', 'ยังไม่พบบิลนี้ในระบบกลาง — จะลองยกเลิกใหม่หลังบิลมาถึง');
  end if;
  if v_at < o.sold_at then
    return jsonb_build_object('status', 'rejected', 'reason', 'INVALID',
      'detail', format('voided_at %s ก่อนเวลาขาย %s', public.dayo_iso_ms(v_at), public.dayo_iso_ms(o.sold_at)));
  end if;
  if v_day <> o.sale_date then
    return jsonb_build_object('status', 'rejected', 'reason', 'FORBIDDEN',
      'detail', format('ยกเลิกได้เฉพาะวันเดียวกับวันขาย (voided_at %s ≠ sale_date %s)', v_day, o.sale_date));
  end if;
  if o.status = 'cancelled' then
    return jsonb_build_object('status', 'duplicate', 'data', jsonb_build_object('order_no', o.order_no, 'version', o.version));
  end if;
  perform public.dayo_pos_require_staff(p_shop_id, v_staff);
  if v_appr is not null then
    perform public.dayo_pos_require_staff(p_shop_id, v_appr);
  end if;
  -- cancelled_at = voided_at (เวลาเครื่อง เชื่อได้แบบ sold_at — ADR-0040 ข้อ 4) · approved_by/voided_at ลง audit_log.after
  perform public.dayo_order_cancel_core(o.id, v_staff, p_client_id, p ->> 'reason', v_at,
    jsonb_strip_nulls(jsonb_build_object('approved_by', v_appr, 'voided_at', p -> 'voided_at')));
  select * into o from public.orders x where x.id = o.id;
  return jsonb_build_object('status', 'accepted', 'data', jsonb_build_object('order_no', o.order_no, 'version', o.version));
end;
$$;

-- 23505 (ชนพร้อมกัน): หาใหม่ตามลำดับ key → pos_order_id → external_ref
create or replace function public.dayo_pos_after_unique(p_shop_id uuid, p_client_id uuid, p_kind text, p_key text, p_hash text, p jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_prev public.api_idempotency_keys;
  v_id uuid;
begin
  select * into v_prev from public.api_idempotency_keys k
  where k.api_client_id = p_client_id and k.endpoint = 'pos_push' and k.idempotency_key = p_key;
  if found then
    if v_prev.request_hash = p_hash then
      return public.dayo_pos_verdict(p_key, 'duplicate', null, null, v_prev.result);
    end if;
    return public.dayo_pos_verdict(p_key, 'rejected', 'CONFLICT', 'key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว', null);
  end if;
  if p_kind = 'order' then
    select o.id into v_id from public.orders o where o.api_client_id = p_client_id and o.pos_order_id = (p ->> 'pos_order_id')::uuid;
    if found then
      return public.dayo_pos_verdict(p_key, 'duplicate', null, null, public.dayo_pos_order_data(v_id, '[]'::jsonb));
    end if;
    if exists (select 1 from public.orders o where o.api_client_id = p_client_id and o.external_ref = p ->> 'receipt_no') then
      return public.dayo_pos_verdict(p_key, 'rejected', 'CONFLICT',
        format('เลขใบเสร็จ %s ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว', p ->> 'receipt_no'), null);
    end if;
  end if;
  return public.dayo_pos_verdict(p_key, 'deferred', 'BUSY', 'มีคำขออื่นกำลังบันทึกรายการนี้ — ลองใหม่อัตโนมัติ', null);
end;
$$;


-- ═════════════════════════════════════════════════════════════════════════════════
-- 6. แถวเดียว (ลำดับตรวจเต็ม — หัวข้อ Step 4) · งานธุรกิจใน savepoint (begin … exception)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_pos_push_row(p_shop_id uuid, p_client_id uuid, p_scopes text[], p_row jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_key text;
  v_kind text;
  v_data jsonb;
  v_hash text;
  v_prev public.api_idempotency_keys;
  v_invalid text;
  v_at timestamptz;
  v_res jsonb;
  v_state text;
  v_msg text;
  v_ver jsonb;
begin
  -- (a)
  if jsonb_typeof(p_row) is distinct from 'object' or jsonb_typeof(p_row -> 'key') is distinct from 'string'
     or char_length(p_row ->> 'key') not between 1 and 200 then
    return public.dayo_pos_verdict(case when jsonb_typeof(p_row -> 'key') = 'string' then p_row ->> 'key' else '' end,
      'rejected', 'BAD_KEY', 'key ต้องเป็นข้อความ 1–200 ตัวอักษร รูป <kind>:<uuid>', null);
  end if;
  v_key := p_row ->> 'key';
  if jsonb_typeof(p_row -> 'kind') is distinct from 'string' or jsonb_typeof(p_row -> 'data') is distinct from 'object' then
    return public.dayo_pos_verdict(v_key, 'rejected', 'INVALID', 'แถวต้องมี kind (ข้อความ) และ data (object)', null);
  end if;
  v_kind := p_row ->> 'kind';
  v_data := p_row -> 'data';
  -- (b)
  if not ((public.dayo_pos_supported() -> 'supported_kinds') ? v_kind) then
    return public.dayo_pos_verdict(v_key, 'deferred', 'UNSUPPORTED', 'ชนิดแถวนี้ระบบกลางรุ่นนี้ยังไม่รองรับ', null);
  end if;
  -- (c)
  if not ('orders:write' = any (p_scopes)) then
    return public.dayo_pos_verdict(v_key, 'rejected', 'FORBIDDEN', 'API key ไม่มีสิทธิ์ orders:write', null);
  end if;
  -- (d)
  if v_key !~ ('^' || v_kind || ':[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     or substr(v_key, char_length(v_kind) + 2) is distinct from (v_data ->> 'pos_order_id') then
    return public.dayo_pos_verdict(v_key, 'rejected', 'BAD_KEY', 'key ต้องเป็นรูป <kind>:<uuid> และ uuid ต้องตรงกับ pos_order_id', null);
  end if;
  -- (e)
  if cardinality(public.dayo_pos_unknown_fields(v_kind, v_data)) > 0 then
    return public.dayo_pos_verdict(v_key, 'deferred', 'UNSUPPORTED', 'มีฟิลด์ที่ระบบกลางรุ่นนี้ยังไม่รู้จัก', null);
  end if;
  -- (1) hash ของ key ก่อนเสมอ
  v_hash := encode(sha256(convert_to(v_data::text, 'UTF8')), 'hex');
  select * into v_prev from public.api_idempotency_keys k
  where k.api_client_id = p_client_id and k.endpoint = 'pos_push' and k.idempotency_key = v_key;
  if found then
    if v_prev.request_hash = v_hash then
      return public.dayo_pos_verdict(v_key, 'duplicate', null, null, v_prev.result);
    end if;
    return public.dayo_pos_verdict(v_key, 'rejected', 'CONFLICT', 'key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว', null);
  end if;
  -- (f)
  v_invalid := case v_kind when 'order' then public.dayo_pos_invalid_order(v_data) else public.dayo_pos_invalid_void(v_data) end;
  if v_invalid is not null then
    return public.dayo_pos_verdict(v_key, 'rejected', 'INVALID', v_invalid, null);
  end if;
  -- (g)
  v_at := (v_data ->> case v_kind when 'order' then 'sold_at' else 'voided_at' end)::timestamptz;
  if v_at > now() + interval '5 minutes' then
    return public.dayo_pos_verdict(v_key, 'deferred', 'CLOCK_AHEAD',
      format('เวลา %s เร็วกว่าเวลาระบบกลาง %s เกิน 5 นาที — ตรวจนาฬิกาเครื่องค่ะ', public.dayo_iso_ms(v_at), public.dayo_iso_ms(now())), null);
  end if;
  -- (2)(3) savepoint
  begin
    v_res := case v_kind when 'order' then public.dayo_pos_apply_order(p_shop_id, p_client_id, v_data)
                         else public.dayo_pos_apply_void(p_shop_id, p_client_id, v_data) end;
    if v_res ->> 'status' in ('accepted', 'duplicate') then
      insert into public.api_idempotency_keys (shop_id, api_client_id, endpoint, idempotency_key, request_hash, result)
      values (p_shop_id, p_client_id, 'pos_push', v_key, v_hash, v_res -> 'data');
    end if;
    return public.dayo_pos_verdict(v_key, v_res ->> 'status', v_res ->> 'reason', v_res ->> 'detail', v_res -> 'data');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = '23505' then
      return public.dayo_pos_after_unique(p_shop_id, p_client_id, v_kind, v_key, v_hash, v_data);
    end if;
    v_ver := public.dayo_pos_error_verdict(v_state, v_msg);
    return public.dayo_pos_verdict(v_key, v_ver ->> 'status', v_ver ->> 'reason', v_ver ->> 'detail', null);
  end;
end;
$$;


-- ═════════════════════════════════════════════════════════════════════════════════
-- 7. E2 — api_pos_push (ซองผิด = DY422 ทั้งคำขอ · error ของแถวไม่หลุดเป็น exception)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.api_pos_push(p_shop_id uuid, p_api_client_id uuid, p_scopes text[], p_rows jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  c public.api_clients;
  v_scopes text[];
  v_row jsonb;
  v_res jsonb;
  v_state text;
  v_out jsonb := '[]'::jsonb;
begin
  select * into c from public.api_clients x where x.id = p_api_client_id and x.shop_id = p_shop_id;
  if p_shop_id is null or not found or not c.is_active then
    raise exception using errcode = 'DY401', message = 'invalid_key: API key ไม่ถูกต้องหรือถูกปิดใช้งาน';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 20 then
    raise exception using errcode = 'DY422', message = 'invalid: rows ต้องเป็นรายการ 1–20 แถว';
  end if;
  -- scope ที่ใช้ = ที่ชั้นเว็บส่งมา ∩ ที่ตารางมีจริง
  v_scopes := array(select unnest(c.scopes) intersect select unnest(coalesce(p_scopes, '{}')));
  perform set_config('dayo.api_client_id', c.id::text, true);
  perform set_config('dayo.shop_id', p_shop_id::text, true);
  -- ADR-0049: เปิดทาง "พนักงาน removed" ใน dayo_require_actor เฉพาะธุรกรรมของ E2 นี้ (ไม่กระทบ /v1/orders เดิม)
  perform set_config('dayo.pos_push', '1', true);
  for v_row in select e from jsonb_array_elements(p_rows) with ordinality t(e, o) order by o loop
    -- savepoint ชั้นนอกต่อแถว: ครอบขั้นตรวจ (a)–(g) + ตรวจรูปด้วย — บั๊กใด ๆ ในตัวตรวจ = คำตัดสินของแถวนี้ ไม่ใช่ 5xx ทั้งคำขอ
    begin
      v_res := public.dayo_pos_push_row(p_shop_id, c.id, v_scopes, v_row);
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      v_res := public.dayo_pos_verdict(case when jsonb_typeof(v_row -> 'key') = 'string' then v_row ->> 'key' else '' end,
        'deferred', 'SERVER_ERROR', format('SQLSTATE %s', v_state), null);
    end;
    v_out := v_out || jsonb_build_array(v_res);
  end loop;
  return jsonb_build_object('server_time', public.dayo_iso_ms(now()), 'results', v_out);
end;
$$;


revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
```

เพิ่มท้าย `supabase/seed.sql`:
```sql
-- ธงทดสอบของ api_pos_push (บังคับ error ด้วย note "__fault_<SQLSTATE>__") — seed รันเฉพาะเครื่อง dev · production ไม่มีค่านี้
alter database postgres set dayo.test_faults = 'on';
-- มีผลกับ connection ใหม่ — ถ้าเทสต์ fault ไม่ทำงานหลัง db:reset ให้ npm run db:stop && npm run db:start แล้วตรวจด้วย
--   select current_setting('dayo.test_faults', true);   (ต้องได้ on บนเครื่อง dev)
```

จุดที่ executor ต้องยืนยันก่อนรัน: (1) ชื่อ constraint `endpoint` ของ `api_idempotency_keys` (`select conname from pg_constraint where conrelid = 'public.api_idempotency_keys'::regclass`) (2) `grep -n "format(" supabase/migrations/00{08,12,44,47}*.sql` — ข้อความ `DY422` ที่อาจโผล่ใน `detail` ต้อง **ไม่** รวม `note`/`discount_reason`/`bill_discount.reason` ของผู้ใช้ ถ้ามีแท็กใด ให้เพิ่มกิ่งใน `dayo_pos_error_verdict` (ด้วย migration นี้ — `create or replace`) ให้ใช้ข้อความกลาง `ข้อมูลบิลไม่ผ่านการตรวจของระบบกลาง (DY422)` สำหรับแท็กนั้น และเพิ่มเคสในเทสต์

- [ ] **Step 5: รันให้ผ่าน**

Run: `npm run db:reset && npx vitest run --root packages/shared test/db/pos_push.db.test.ts`
Expected: PASS ทุกเคส

- [ ] **Step 6: เทสต์ฐานข้อมูลทั้งหมด + types**

Run: `npx vitest run --root packages/shared test/db && npm run db:types`
Expected: PASS ทุกไฟล์

- [ ] **Step 7: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add supabase/migrations/0051_pos_push.sql supabase/seed.sql packages/shared/test/db/posFixtures.ts packages/shared/test/db/pos_push.db.test.ts packages/shared/src/database.types.ts
git commit -m "feat(db): add the pos push rpc with per-row verdicts"
```

---

## Task 4: RPC อ่าน (E3 · เว็บ · บอท · แดชบอร์ด) + `backup_log_auto` (migration 0052)

**agent:** db-engineer · opus · high (lane A · ใช้ Docker)

**Files:**
- Create: `supabase/migrations/0052_pos_reads_backup_log.sql`
- Create: `packages/shared/test/db/pos_reads.db.test.ts`
- Modify: `packages/shared/src/database.types.ts`

**Interfaces:**
- Consumes: คอลัมน์/ฟังก์ชันของ Task 2–3
- Produces (ทุกตัวคืน `jsonb` · owner-only ตรวจด้วย `dayo_require_staff(..., array['owner'])` → `DY403`):
  - `api_list_orders(p_shop_id uuid, p_from date, p_to date, p_updated_since timestamptz)` → อาร์เรย์บิล (ฟิลด์เดิมของ `listApiOrders` ทุกตัว + `sold_at` `created_by_name` `pos_receipt_no` `pos_queue_no` `catalog_version` `duplicate_suspect`) · ≤ 500 แถว ใหม่สุดก่อน
  - `list_orders(...)` ตัวห่อ (ลายเซ็นเดิม): ทุกบิลเพิ่ม `pos_receipt_no` `pos_queue_no` `sold_at` `duplicate_suspect`
  - `get_order(p_shop_id uuid, p_staff_id uuid, p_order_no text)` ตัวห่อ: เพิ่ม `pos_receipt_no` `pos_queue_no` `sold_at` `duplicate_suspect` `catalog_version` `pos_computed_total` `duplicate_of` `read_only_pos`
  - `bot_recent_orders(...)` (ลอก 0047): ทุกบิลเพิ่ม `source` `createdByName` `editable` (= `source <> 'pos'`)
  - `dashboard_duplicate_flags(p_shop_id uuid, p_staff_id uuid)` → `[{id, detected_at, a:{order_no, source, created_by_name, sold_at, total, status, pos_receipt_no}, b:{…}}]` เฉพาะ `open`
  - `resolve_duplicate_flag(p_shop_id uuid, p_staff_id uuid, p_flag_id uuid, p_note text)` → `{ok, duplicate}` · note 1–200 · audit `duplicate_flag_resolve`
  - `duplicate_flags_open_count(p_shop_id uuid, p_staff_id uuid)` → `{open}`
  - `dashboard_pos_diffs(p_shop_id uuid, p_from date, p_to date, p_staff_id uuid)` → `[{order_no, pos_receipt_no, sale_date, total, computed_total, diff, amount_mismatch, small_diff, catalog_version, server_catalog_version}]`
  - `backup_log.kind` รับ `'auto'` · คอลัมน์ `bytes bigint` · `backup_log_auto(p_row_counts jsonb, p_bytes bigint)` (security definer · execute เฉพาะ `dayo_backup` — ถอนจาก `service_role`)
  - CHECK `audit_log.action` เพิ่ม `duplicate_flag_resolve` `duplicate_flag_auto_close` · `dayo_order_recheck_flags(p_order_id uuid, p_staff_id uuid)` · `update_order` ตัวห่อปิดธงที่คู่ไม่ตรงแล้ว

- [ ] **Step 1: เขียนเทสต์ที่ต้องตก** — `packages/shared/test/db/pos_reads.db.test.ts`

```ts
// pos_reads.db.test.ts — E3 ฟิลด์ใหม่ · แดชบอร์ดธงซ้ำ/ส่วนต่าง · บิลล่าสุดของบอท · backup_log_auto (0052)
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { bkkDay } from "../../src/time.js";
import { connectLocalSupabase, createTestShop, Db, expectDbError } from "./helpers.js";
import type { TestShop } from "./helpers.js";
import { createPosClient } from "./posFixtures.js";
import { posParityCatalogPayload } from "./posParity.js";

const T = 120_000;
const sb = await connectLocalSupabase();

describe.skipIf(!sb)("RPC อ่านของก้อน 1 (0052)", () => {
  let svc: Db;
  let shop: TestShop;
  let clientId: string;
  let botNo: string;
  let posNo: string;
  const today = bkkDay(0);

  beforeAll(async () => {
    svc = Db.service(sb!);
    shop = await createTestShop(svc, "pos-reads");
    await svc.rpc("import_catalog", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_payload: posParityCatalogPayload(), p_mode: "replace" });
    await svc.rpc("save_shop_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: { default_milk: "fresh" } });
    clientId = await createPosClient(svc, shop.shopId);
    const bot = await svc.rpc<{ order_no: string }>("create_order", { p_shop_id: shop.shopId, p_actor: { staff_id: shop.staffId },
      p_draft: { sale_date: today, channel: "store", payment: "cash", source: "line", no_promotions: true,
                 lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", qty: 1 }] } });
    botNo = bot.order_no;
    const posId = randomUUID();
    const soldAt = new Date(Date.now() - 3 * 60_000).toISOString();
    const res = await svc.rpc<{ results: Array<{ status: string; data: { order_no: string } }> }>("api_pos_push", {
      p_shop_id: shop.shopId, p_api_client_id: clientId, p_scopes: ["orders:write"],
      p_rows: [{ key: `order:${posId}`, kind: "order", data: {
        pos_order_id: posId, receipt_no: "A-000312", queue_no: 12,
        sale_date: new Date(Date.parse(soldAt) + 7 * 3600_000).toISOString().slice(0, 10), sold_at: soldAt,
        channel: "store", payment: "cash", staff_id: shop.staffId, catalog_version: 1, shift_id: null,
        lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 1 }],
        bill_discount: null, promo_code: null, skip_promotion_ids: [], no_promotions: true,
        totals: { items_subtotal: 35, items_discount: 0, bill_discount: 0.5, total: 34.5 }, note: null } }] });
    expect(res.results[0]!.status).toBe("accepted");
    posNo = res.results[0]!.data.order_no;
  }, T);

  it("api_list_orders: ฟิลด์เดิมครบ + ฟิลด์ใหม่ · ไม่มีต้นทุน", async () => {
    const rows = await svc.rpc<Array<Record<string, unknown>>>("api_list_orders", { p_shop_id: shop.shopId, p_from: today, p_to: today, p_updated_since: null });
    const pos = rows.find((r) => r.order_no === posNo)!;
    expect(Object.keys(pos).sort()).toEqual(["amount_mismatch", "catalog_version", "channel", "created_by_name", "duplicate_suspect",
      "external_ref", "order_no", "payment", "pos_queue_no", "pos_receipt_no", "sale_date", "sold_at", "source", "status", "totals",
      "updated_at", "version"]);
    expect(pos).toMatchObject({ source: "pos", pos_receipt_no: "A-000312", pos_queue_no: 12, created_by_name: "staff-active" });
    expect(rows.find((r) => r.order_no === botNo)).toMatchObject({ source: "line", pos_receipt_no: null });
    expect(JSON.stringify(rows)).not.toMatch(/cost|gross_profit/);
  });

  it("dashboard_pos_diffs: ต่าง 0.50 = small_diff ไม่ใช่ amount_mismatch · มีฉบับของบิลและของเซิร์ฟเวอร์", async () => {
    const d = await svc.rpc<Array<Record<string, unknown>>>("dashboard_pos_diffs", { p_shop_id: shop.shopId, p_from: today, p_to: today, p_staff_id: shop.ownerId });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ order_no: posNo, amount_mismatch: false, small_diff: true, catalog_version: 1 });
    expect(Number(d[0]!.diff)).toBe(0.5);
    expect(d[0]!.server_catalog_version).not.toBeNull();
    expect((await expectDbError(svc.rpc("dashboard_pos_diffs", { p_shop_id: shop.shopId, p_from: today, p_to: today, p_staff_id: shop.staffId }))).code).toBe("DY403");
  });

  it("get_order: read_only_pos + ใบเสร็จ/คิว · list ของบอท: owner เห็นบิล POS แต่ editable=false", async () => {
    expect(await svc.rpc("get_order", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_order_no: posNo }))
      .toMatchObject({ read_only_pos: true, pos_receipt_no: "A-000312", pos_queue_no: 12 });
    expect((await svc.rpc<Record<string, unknown>>("get_order", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_order_no: botNo })).read_only_pos).toBe(false);
    const r = await svc.rpc<Array<Record<string, unknown>>>("bot_recent_orders", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId });
    expect(r.find((x) => x.orderNo === posNo)).toMatchObject({ source: "pos", editable: false, createdByName: "staff-active" });
    expect(r.find((x) => x.orderNo === botNo)).toMatchObject({ source: "line", editable: true });
  });

  it("ธงซ้ำ: นับ/รายการ/ปิดธง (owner เท่านั้น · หมายเหตุบังคับ)", async () => {
    // บิลบอทใหม่ที่ยอดเท่าบิล POS (34.5 ไม่เท่า 35) จึงสร้างคู่ใหม่: POS ยอด 35 + บิลบอท 35
    const posId = randomUUID();
    const soldAt = new Date(Date.now() - 60_000).toISOString();
    await svc.rpc("api_pos_push", { p_shop_id: shop.shopId, p_api_client_id: clientId, p_scopes: ["orders:write"],
      p_rows: [{ key: `order:${posId}`, kind: "order", data: {
        pos_order_id: posId, receipt_no: "A-000313", queue_no: 13,
        sale_date: new Date(Date.parse(soldAt) + 7 * 3600_000).toISOString().slice(0, 10), sold_at: soldAt,
        channel: "store", payment: "cash", staff_id: shop.staffId, catalog_version: 1, shift_id: null,
        lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 1 }],
        bill_discount: null, promo_code: null, skip_promotion_ids: [], no_promotions: true,
        totals: { items_subtotal: 35, items_discount: 0, bill_discount: 0, total: 35 }, note: null } }] });
    const flags = await svc.rpc<Array<{ id: string; a: { order_no: string }; b: { order_no: string } }>>(
      "dashboard_duplicate_flags", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId });
    expect(flags).toHaveLength(1);
    expect([flags[0]!.a.order_no, flags[0]!.b.order_no]).toContain(botNo);
    expect((await svc.rpc<{ open: number }>("duplicate_flags_open_count", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId })).open).toBe(1);
    expect((await expectDbError(svc.rpc("dashboard_duplicate_flags", { p_shop_id: shop.shopId, p_staff_id: shop.staffId }))).code).toBe("DY403");
    expect((await expectDbError(svc.rpc("resolve_duplicate_flag", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_flag_id: flags[0]!.id, p_note: "" }))).code).toBe("DY422");
    await svc.rpc("resolve_duplicate_flag", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_flag_id: flags[0]!.id, p_note: "ลูกค้าคนละคน" });
    expect((await svc.rpc<{ open: number }>("duplicate_flags_open_count", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId })).open).toBe(0);
    const audit = await svc.select("audit_log", `entity_id=eq.${flags[0]!.id}&action=eq.duplicate_flag_resolve&select=id`);
    expect(audit).toHaveLength(1);
  });

  it("แก้บิลจนคู่ไม่ตรงเงื่อนไขแล้ว → ธงปิดเอง (resolved_not_duplicate + หมายเหตุระบบ) + audit duplicate_flag_auto_close", async () => {
    const bot = await svc.rpc<{ order_no: string; version: number }>("create_order", { p_shop_id: shop.shopId, p_actor: { staff_id: shop.ownerId },
      p_draft: { sale_date: today, channel: "store", payment: "cash", source: "web", no_promotions: true,
                 lines: [{ code: "Green Tea", size: "16 oz", sweetness: "50%", milk: "fresh", qty: 1 }] } });
    const posId = randomUUID();
    const soldAt = new Date(Date.now() - 60_000).toISOString();
    await svc.rpc("api_pos_push", { p_shop_id: shop.shopId, p_api_client_id: clientId, p_scopes: ["orders:write"],
      p_rows: [{ key: `order:${posId}`, kind: "order", data: {
        pos_order_id: posId, receipt_no: "A-000314", queue_no: 14,
        sale_date: new Date(Date.parse(soldAt) + 7 * 3600_000).toISOString().slice(0, 10), sold_at: soldAt,
        channel: "store", payment: "cash", staff_id: shop.staffId, catalog_version: 1, shift_id: null,
        lines: [{ code: "Green Tea", size: "16 oz", sweetness: "50%", milk: "fresh", grade: null, qty: 1 }],
        bill_discount: null, promo_code: null, skip_promotion_ids: [], no_promotions: true,
        totals: { items_subtotal: 40, items_discount: 0, bill_discount: 0, total: 40 }, note: null } }] });
    const [b] = await svc.select<{ id: string; version: number }>("orders", `shop_id=eq.${shop.shopId}&order_no=eq.${bot.order_no}&select=id,version`);
    const open = () => svc.select<{ id: string }>("order_duplicate_flags", `status=eq.open&or=(order_a_id.eq.${b!.id},order_b_id.eq.${b!.id})&select=id`);
    const [flag] = await open();
    expect(flag).toBeTruthy();
    await svc.rpc("update_order", { p_shop_id: shop.shopId, p_actor: { staff_id: shop.ownerId }, p_order_no: bot.order_no,
      p_expected_version: b!.version, p_changes: { lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", milk: "fresh", qty: 1 }] } });
    expect(await open()).toHaveLength(0);
    const [closed] = await svc.select<{ status: string; resolution_note: string }>("order_duplicate_flags", `id=eq.${flag!.id}&select=status,resolution_note`);
    expect(closed).toMatchObject({ status: "resolved_not_duplicate" });
    expect(closed!.resolution_note).toMatch(/^ระบบ:/);
    expect(await svc.select("audit_log", `entity_id=eq.${flag!.id}&action=eq.duplicate_flag_auto_close&select=id`)).toHaveLength(1);
  });

  it("CHECK ของ audit_log.action รับค่าใหม่ทุกตัว (แทรกได้จริง) และยังปฏิเสธค่าที่ไม่รู้จัก", async () => {
    for (const action of ["duplicate_flag_resolve", "duplicate_flag_auto_close"]) {
      await svc.insert("audit_log", { shop_id: shop.shopId, entity: "order_duplicate_flags", entity_id: randomUUID(), action, before: null, after: {} });
    }
    expect((await expectDbError(svc.insert("audit_log", { shop_id: shop.shopId, entity: "x", entity_id: randomUUID(), action: "nope", before: null, after: {} }))).code).toBe("23514");
  });

  it("backup_log_auto เรียกด้วยคีย์ service_role ไม่ได้ (เฉพาะ role dayo_backup — ADR-0050) · แถว kind=auto นับใน heartbeat", async () => {
    const e = await expectDbError(svc.rpc("backup_log_auto", { p_row_counts: { orders: 2 }, p_bytes: 12345 }));
    expect(e.code).toBe("42501");
    await svc.insert("backup_log", { shop_id: shop.shopId, kind: "auto", groups: ["all"], row_counts: { orders: 2 }, bytes: 12345 });
    const rows = await svc.select<{ kind: string; bytes: number }>("backup_log", `shop_id=eq.${shop.shopId}&kind=eq.auto&select=kind,bytes`);
    expect(rows[0]).toMatchObject({ kind: "auto", bytes: 12345 });
    expect((await svc.rpc<{ last_backup_at: string | null }>("heartbeat", { p_shop_id: shop.shopId })).last_backup_at).not.toBeNull();
    // พฤติกรรมของ backup_log_auto เอง (บันทึกแถว · ค่าผิด = DY422) ทดสอบด้วย psql ของ role postgres ใน Task 14 Step 7
  });
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npm run db:reset && npx vitest run --root packages/shared test/db/pos_reads.db.test.ts`
Expected: FAIL — `function public.api_list_orders(...) does not exist`

- [ ] **Step 3: เขียน migration** — `supabase/migrations/0052_pos_reads_backup_log.sql`

```sql
-- 0052_pos_reads_backup_log — RPC อ่านของก้อน 1 + บันทึกการสำรองอัตโนมัติ (ADR-0049 · ADR-0050)

-- ═════════════════════════════════════════════════════════════════════════════════
-- 1. E3 GET /v1/orders — ฟิลด์เดิมของ listApiOrders ทุกตัว + ฟิลด์ใหม่ (ไม่มีต้นทุน/กำไร)
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_order_has_open_flag(p_order_id uuid)
returns boolean language sql stable set search_path = public
as $$ select exists (select 1 from public.order_duplicate_flags f where f.status = 'open' and (f.order_a_id = p_order_id or f.order_b_id = p_order_id)) $$;

create or replace function public.api_list_orders(p_shop_id uuid, p_from date, p_to date, p_updated_since timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_no', o.order_no, 'sale_date', o.sale_date, 'status', o.status, 'source', o.source,
    'external_ref', o.external_ref, 'version', o.version, 'channel', ch.code, 'payment', pm.code,
    'totals', jsonb_build_object('items_subtotal', o.items_subtotal, 'items_discount', o.items_discount,
      'bill_discount', o.bill_discount_amount, 'total', o.total_amount, 'fee', o.channel_fee_amount),
    'amount_mismatch', o.amount_mismatch, 'updated_at', o.updated_at,
    'sold_at', o.sold_at, 'created_by_name', st.display_name,
    'pos_receipt_no', case when o.source = 'pos' then o.external_ref end, 'pos_queue_no', o.pos_queue_no,
    'catalog_version', o.catalog_version, 'duplicate_suspect', public.dayo_order_has_open_flag(o.id)
  ) order by o.sale_date desc, o.order_no desc), '[]'::jsonb)
  from (
    select x.* from public.orders x
    where x.shop_id = p_shop_id
      and (p_from is null or x.sale_date >= p_from) and (p_to is null or x.sale_date <= p_to)
      and (p_updated_since is null or x.updated_at > p_updated_since)
    order by x.sale_date desc, x.order_no desc
    limit 500
  ) o
  left join public.sales_channels ch on ch.id = o.sales_channel_id
  left join public.payment_methods pm on pm.id = o.payment_method_id
  left join public.staff st on st.id = o.created_by
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 2. เว็บ: get_order / list_orders ตัวห่อ (ลายเซ็นเดิม) — ข้อมูลบิล POS
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_pos_bill_extra(p_shop_id uuid, p_order_no text)
returns jsonb language sql stable set search_path = public
as $$
  select coalesce((select jsonb_build_object('pos_receipt_no', case when o.source = 'pos' then o.external_ref end,
    'pos_queue_no', o.pos_queue_no, 'sold_at', o.sold_at, 'duplicate_suspect', public.dayo_order_has_open_flag(o.id))
  from public.orders o where o.shop_id = p_shop_id and o.order_no = p_order_no), '{}'::jsonb)
$$;

alter function public.get_order(uuid, uuid, text) rename to dayo_impl_get_order;
create or replace function public.get_order(p_shop_id uuid, p_staff_id uuid, p_order_no text)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_res jsonb := public.dayo_impl_get_order(p_shop_id, p_staff_id, p_order_no);
  o public.orders;
begin
  select * into o from public.orders x where x.shop_id = p_shop_id and x.order_no = p_order_no;
  return v_res || public.dayo_pos_bill_extra(p_shop_id, p_order_no) || jsonb_build_object(
    'catalog_version', o.catalog_version, 'pos_computed_total', o.pos_computed_total,
    'duplicate_of', public.dayo_order_duplicate_of(o.id), 'read_only_pos', o.source = 'pos');
end;
$$;
```

`list_orders` (0044 · ผลเป็น `{orders:[…], truncated}`) — ตัวห่อ:
```sql
alter function public.list_orders(uuid, uuid, date, text) rename to dayo_impl_list_orders;
create or replace function public.list_orders(
  p_shop_id uuid, p_staff_id uuid, p_sale_date date default null, p_search text default null
)
returns jsonb language plpgsql stable set search_path = public
as $$
declare
  v jsonb := public.dayo_impl_list_orders(p_shop_id, p_staff_id, p_sale_date, p_search);
begin
  return jsonb_set(v, '{orders}', coalesce((
    select jsonb_agg(e || public.dayo_pos_bill_extra(p_shop_id, e ->> 'order_no') order by i)
    from jsonb_array_elements(v -> 'orders') with ordinality t(e, i)), '[]'::jsonb));
end;
$$;
```

`bot_recent_orders` (ลอก 0047 บรรทัด 930–966 · เพิ่ม 3 ฟิลด์ต่อบิล — ป้าย `-- ADR-0049`):
```sql
create or replace function public.bot_recent_orders(p_shop_id uuid, p_staff_id uuid, p_limit integer default null)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  s public.staff := public.dayo_require_staff(p_shop_id, p_staff_id, null);
  v_limit integer := greatest(1, least(coalesce(p_limit, (public.dayo_shop_settings(p_shop_id)).recent_orders_count), 20));
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'orderNo', o.order_no, 'saleDate', o.sale_date, 'channelCode', o.channel_code, 'paymentCode', o.payment_code,
      'totalAmount', o.total_amount, 'version', o.version, 'createdByStaffId', o.created_by,
      'source', o.source, 'createdByName', o.created_by_name, 'editable', o.source <> 'pos',   -- ADR-0049
      'lines', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'lineNo', i.line_no, 'menuCode', i.menu_code, 'menuNameTh', i.menu_name_th,
          'size', i.size, 'sweetness', i.sweetness, 'qty', i.qty, 'unitPrice', i.unit_price
        ) order by i.line_no), '[]'::jsonb)
        from public.order_items i where i.order_id = o.id
      )
    ) order by o.created_at desc)
    from (
      select x.*, ch.code as channel_code, pm.code as payment_code,
             (select st.display_name from public.staff st where st.id = x.created_by) as created_by_name   -- ADR-0049
      from public.orders x
      join public.sales_channels ch on ch.id = x.sales_channel_id
      left join public.payment_methods pm on pm.id = x.payment_method_id
      where x.shop_id = p_shop_id and x.status = 'ok'
        and (s.role = 'owner' or x.created_by = s.id)
      order by x.created_at desc
      limit v_limit
    ) o
  ), '[]'::jsonb);
end;
$$;
```

ต่อท้าย migration:
```sql
-- ═════════════════════════════════════════════════════════════════════════════════
-- 3. แดชบอร์ด owner: ธงซ้ำ · ส่วนต่างบิล POS
-- ═════════════════════════════════════════════════════════════════════════════════
create or replace function public.dayo_bill_brief(p_order_id uuid)
returns jsonb language sql stable set search_path = public
as $$
  select jsonb_build_object('order_no', o.order_no, 'source', o.source, 'created_by_name', st.display_name, 'sold_at', o.sold_at,
    'total', o.total_amount, 'status', o.status, 'pos_receipt_no', case when o.source = 'pos' then o.external_ref end)
  from public.orders o left join public.staff st on st.id = o.created_by where o.id = p_order_id
$$;

create or replace function public.dashboard_duplicate_flags(p_shop_id uuid, p_staff_id uuid)
returns jsonb language plpgsql stable set search_path = public
as $$
begin
  perform public.dayo_require_staff(p_shop_id, p_staff_id, array['owner']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'detected_at', f.detected_at,
      'a', public.dayo_bill_brief(f.order_a_id), 'b', public.dayo_bill_brief(f.order_b_id)) order by f.detected_at desc)
    from public.order_duplicate_flags f where f.shop_id = p_shop_id and f.status = 'open'), '[]'::jsonb);
end;
$$;

create or replace function public.duplicate_flags_open_count(p_shop_id uuid, p_staff_id uuid)
returns jsonb language plpgsql stable set search_path = public
as $$
begin
  perform public.dayo_require_staff(p_shop_id, p_staff_id, array['owner']);
  return jsonb_build_object('open', (select count(*) from public.order_duplicate_flags f where f.shop_id = p_shop_id and f.status = 'open'));
end;
$$;

create or replace function public.resolve_duplicate_flag(p_shop_id uuid, p_staff_id uuid, p_flag_id uuid, p_note text)
returns jsonb language plpgsql set search_path = public
as $$
declare
  f public.order_duplicate_flags;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.dayo_require_staff(p_shop_id, p_staff_id, array['owner']);
  if v_note is null or char_length(v_note) > 200 then
    raise exception using errcode = 'DY422', message = 'invalid: ต้องใส่หมายเหตุ 1–200 ตัวอักษรว่าทำไมไม่ซ้ำค่ะ';
  end if;
  select * into f from public.order_duplicate_flags x where x.id = p_flag_id and x.shop_id = p_shop_id for update;
  if not found then
    raise exception using errcode = 'DY404', message = 'not_found: ไม่พบธงนี้';
  end if;
  if f.status <> 'open' then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  update public.order_duplicate_flags x set status = 'resolved_not_duplicate', resolved_by = p_staff_id, resolved_at = now(),
    resolution_note = v_note where x.id = f.id;
  insert into public.audit_log (shop_id, entity, entity_id, action, before, after, staff_id)
  values (p_shop_id, 'order_duplicate_flags', f.id, 'duplicate_flag_resolve', to_jsonb(f),
          (select to_jsonb(x) from public.order_duplicate_flags x where x.id = f.id), p_staff_id);
  return jsonb_build_object('ok', true, 'duplicate', false);
end;
$$;

create or replace function public.dashboard_pos_diffs(p_shop_id uuid, p_from date, p_to date, p_staff_id uuid)
returns jsonb language plpgsql stable set search_path = public
as $$
begin
  perform public.dayo_require_staff(p_shop_id, p_staff_id, array['owner']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('order_no', o.order_no, 'pos_receipt_no', o.external_ref, 'sale_date', o.sale_date,
      'total', o.total_amount, 'computed_total', o.pos_computed_total, 'diff', o.pos_computed_total - o.total_amount,
      'amount_mismatch', o.amount_mismatch, 'small_diff', abs(o.pos_computed_total - o.total_amount) <= 1,
      'catalog_version', o.catalog_version, 'server_catalog_version', (o.pricing_context ->> 'server_catalog_version')::bigint)
      order by o.sale_date desc, o.order_no desc)
    from public.orders o
    where o.shop_id = p_shop_id and o.source = 'pos' and o.status = 'ok' and o.sale_date between p_from and p_to
      and o.pos_computed_total is not null and o.pos_computed_total <> o.total_amount), '[]'::jsonb);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 3b. audit_log.action ค่าใหม่ (CHECK เดิมใน 0004: insert|update|delete|order_edit|order_cancel) — ADR-0049
-- ═════════════════════════════════════════════════════════════════════════════════
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('insert', 'update', 'delete', 'order_edit', 'order_cancel',
                    'duplicate_flag_resolve', 'duplicate_flag_auto_close'));

-- แก้บิลแล้วคู่ที่เคยติดธงไม่ผ่านเงื่อนไข §4.8 อีก (รายการ/ยอด/เวลา/สถานะ) → ปิดธงเอง + audit
create or replace function public.dayo_order_recheck_flags(p_order_id uuid, p_staff_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  f public.order_duplicate_flags;
  a public.orders;
  b public.orders;
begin
  for f in select * from public.order_duplicate_flags x
           where x.status = 'open' and (x.order_a_id = p_order_id or x.order_b_id = p_order_id) for update loop
    select * into a from public.orders where id = f.order_a_id;
    select * into b from public.orders where id = f.order_b_id;
    if a.status = 'ok' and b.status = 'ok' and a.source <> b.source and a.sale_date = b.sale_date
       and a.sold_at is not null and b.sold_at is not null and abs(extract(epoch from (a.sold_at - b.sold_at))) <= 600
       and a.total_amount = b.total_amount and a.items_signature = b.items_signature then
      continue;
    end if;
    update public.order_duplicate_flags x set status = 'resolved_not_duplicate', resolved_at = now(), resolved_by = null,
      resolution_note = 'ระบบ: แก้บิลแล้วรายการ/ยอดไม่ตรงกันอีก' where x.id = f.id;
    insert into public.audit_log (shop_id, entity, entity_id, action, before, after, staff_id)
    values (f.shop_id, 'order_duplicate_flags', f.id, 'duplicate_flag_auto_close', to_jsonb(f),
            (select to_jsonb(x) from public.order_duplicate_flags x where x.id = f.id), p_staff_id);
  end loop;
end;
$$;

-- update_order (ตัวห่อจาก 0049) + ปิดธงที่ไม่ตรงแล้ว
create or replace function public.update_order(
  p_shop_id uuid, p_actor jsonb, p_order_no text, p_expected_version integer, p_changes jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_res jsonb := public.dayo_impl_update_order(p_shop_id, p_actor, p_order_no, p_expected_version, p_changes);
  v_id uuid;
begin
  select o.id into v_id from public.orders o where o.shop_id = p_shop_id and o.order_no = p_order_no;
  perform public.dayo_order_refresh_signature(v_id);
  perform public.dayo_order_recheck_flags(v_id, public.dayo_j_uuid(p_actor, 'staff_id'));
  perform public.dayo_detect_duplicates(v_id);
  return v_res || jsonb_build_object('duplicate_of', public.dayo_order_duplicate_of(v_id));
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════
-- 4. สำรองอัตโนมัติ (ADR-0050) — เรียกจาก GitHub Actions ด้วย role dayo_backup (อ่านอย่างเดียว + execute ฟังก์ชันนี้)
-- ═════════════════════════════════════════════════════════════════════════════════
alter table public.backup_log drop constraint backup_log_kind_check;
alter table public.backup_log add constraint backup_log_kind_check check (kind in ('zip', 'excel', 'auto'));
alter table public.backup_log add column bytes bigint check (bytes is null or bytes >= 0);

create or replace function public.backup_log_auto(p_row_counts jsonb, p_bytes bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if jsonb_typeof(p_row_counts) is distinct from 'object' or p_bytes is null or p_bytes <= 0 then
    raise exception using errcode = 'DY422', message = 'invalid: ต้องส่งจำนวนแถว (object) และขนาดไฟล์ > 0';
  end if;
  -- ร้านเดียว (ADR-0018) — บันทึกให้ทุกร้านในฐาน (ปัจจุบันมี 1)
  insert into public.backup_log (shop_id, kind, groups, row_counts, bytes, created_by)
  select s.id, 'auto', array['all'], p_row_counts, p_bytes, null from public.shops s;
  return jsonb_build_object('ok', true, 'at', now());
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
-- ADR-0050: backup_log_auto เรียกได้เฉพาะ dayo_backup — คีย์ secret ของเว็บ/บอทปลอมบันทึก "สำรองอัตโนมัติ" ไม่ได้
-- ⚠ ทุก migration ถัดไปที่ "grant execute on all functions … to service_role" ต้องมีบรรทัด revoke นี้ซ้ำ (เทสต์ pos_reads จับถ้าลืม)
revoke execute on function public.backup_log_auto(jsonb, bigint) from service_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'dayo_backup') then
    execute 'grant execute on function public.backup_log_auto(jsonb, bigint) to dayo_backup';
  end if;
end $$;
```

ถ้าชื่อ constraint ของ `backup_log.kind` ไม่ใช่ `backup_log_kind_check` ให้หาจาก `pg_constraint` · ถ้ามีฟังก์ชัน/หน้าที่กรอง `kind in ('zip','excel')` (`grep -n "backup_log" supabase/migrations/*.sql apps/web/src/lib/*.ts`) ให้ลอกมาแก้ให้นับ `auto` ด้วย

- [ ] **Step 4: รันให้ผ่าน + เทสต์ทั้งหมด + types**

Run: `npm run db:reset && npx vitest run --root packages/shared test/db && npm run db:types`
Expected: PASS ทุกไฟล์

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add supabase/migrations/0052_pos_reads_backup_log.sql packages/shared/test/db/pos_reads.db.test.ts packages/shared/src/database.types.ts
git commit -m "feat(db): add pos read rpcs, duplicate flag dashboard and automatic backup log"
```

---

## Task 5: CORS ที่จุดเดียว — `apiHandler(req, fn)` + `OPTIONS` ทุก route

**agent:** web-developer · sonnet · medium (lane B · ไม่ใช้ Docker)

**Files:**
- Create: `apps/web/src/lib/api/cors.ts`, `apps/web/test/api.cors.test.ts`, `apps/web/src/app/api/v1/[...rest]/route.ts`
- Modify: `apps/web/src/lib/api/response.ts`, `apps/web/src/lib/platform.ts`, `apps/web/src/env.d.ts`, `apps/web/.env.example`
- Modify: `apps/web/src/app/api/v1/catalog/route.ts`, `orders/route.ts`, `orders/[order_no]/route.ts`, `promotions/route.ts`, `stock/route.ts`, `stock/movements/route.ts`
- Modify: `apps/web/test/api.v1Gate.test.ts`, `apps/web/test/api.response.test.ts` (+ เทสต์อื่นที่เรียก `apiHandler(fn)` — หาด้วย `grep -rn "apiHandler(" apps/web/test`)

**Interfaces:**
- Produces:
  - `posOrigins(): string[]` (`lib/platform.ts`)
  - `corsHeaders(origin: string | null, allowed: readonly string[]): Record<string, string> | null`
  - `withCors(res: Response, req: Request): Response`
  - `apiPreflight(req: Request): Response` — 204 เสมอ ไม่แตะฐานข้อมูล ไม่ดู `API_V1_ENABLED`
  - `apiHandler(req: Request, fn: () => Promise<Response>): Promise<Response>` (**ลายเซ็นใหม่** — ทุก route ส่ง `req`)

- [ ] **Step 1: เขียนเทสต์ที่ต้องตก** — `apps/web/test/api.cors.test.ts`

```ts
// api.cors.test.ts — CORS ของ /api/v1/* (สเปก POS 04 §4.1 · ADR-0048): ทุกคำตอบรวม error มีหัว CORS · OPTIONS 204 เสมอ
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { enabled: string | undefined; origins: string } = { enabled: "1", origins: "https://pos.dayo.test,http://localhost:5173" };

vi.mock("../src/lib/db", () => {
  class RpcError extends Error {
    constructor(public code: string, message: string) { super(message); this.name = "RpcError"; }
  }
  return { RpcError, rpc: vi.fn(), rpcRawStream: vi.fn(), db: vi.fn(), shopId: () => "s1" };
});
vi.mock("../src/lib/platform", () => ({
  getEnv: () => ({ API_V1_ENABLED: state.enabled, POS_ORIGINS: state.origins }),
  isApiV1Enabled: () => state.enabled === "1",
  posOrigins: () => state.origins.split(",").map((s) => s.trim()).filter(Boolean),
  waitUntil: () => false,
  getRequestScope: () => null,
}));

const { apiHandler, apiOk } = await import("../src/lib/api/response");
const { apiPreflight, corsHeaders } = await import("../src/lib/api/cors");
const { ApiError } = await import("../src/lib/api/errors");
const { RpcError } = await import("../src/lib/db");

const req = (origin: string | null, method = "GET") =>
  new Request("https://dayo-web.example.workers.dev/api/v1/pos/catalog", { method, headers: origin ? { Origin: origin } : {} });
const ALLOWED = "https://pos.dayo.test";

beforeEach(() => {
  state.enabled = "1";
  state.origins = "https://pos.dayo.test,http://localhost:5173";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function expectCors(res: Response) {
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED);
  expect(res.headers.get("Vary")).toBe("Origin");
  expect(res.headers.get("Access-Control-Expose-Headers")).toBe("Retry-After");
}

describe("corsHeaders", () => {
  it("origin ตรงรายการ → หัว CORS · ไม่ตรง/ไม่ส่ง → null", () => {
    expect(corsHeaders(ALLOWED, [ALLOWED])).toEqual({ "Access-Control-Allow-Origin": ALLOWED, "Access-Control-Expose-Headers": "Retry-After" });
    expect(corsHeaders("https://evil.example", [ALLOWED])).toBeNull();
    expect(corsHeaders(null, [ALLOWED])).toBeNull();
    expect(corsHeaders(ALLOWED, [])).toBeNull();
  });
});

describe("apiHandler ใส่หัว CORS ทุกคำตอบ", () => {
  it("200", async () => expectCors(await apiHandler(req(ALLOWED), async () => apiOk({ a: 1 }))));
  it("404 เมื่อ API ปิด (ไม่เรียก fn)", async () => {
    state.enabled = "0";
    const fn = vi.fn(async () => apiOk({}));
    const res = await apiHandler(req(ALLOWED), fn);
    expect(res.status).toBe(404);
    expect(fn).not.toHaveBeenCalled();
    expectCors(res);
  });
  it("401 / 403 / 422 / 429 (Retry-After อ่านได้) / 5xx", async () => {
    for (const [code, status] of [["DY401", 401], ["DY403", 403], ["DY422", 422]] as const) {
      const res = await apiHandler(req(ALLOWED), async () => { throw new ApiError(code, "x"); });
      expect(res.status).toBe(status);
      expectCors(res);
    }
    const r429 = await apiHandler(req(ALLOWED), async () => { throw new ApiError("DY429", "rate_limited: x", 17); });
    expect(r429.status).toBe(429);
    expect(r429.headers.get("Retry-After")).toBe("17");
    expectCors(r429);
    const r500 = await apiHandler(req(ALLOWED), async () => { throw new RpcError("XX000", "raw postgres text"); });
    expect(r500.status).toBe(500);
    expectCors(r500);
    const r500b = await apiHandler(req(ALLOWED), async () => { throw new TypeError("fetch failed"); });
    expect(r500b.status).toBe(500);
    expectCors(r500b);
  });
  it("origin ไม่อยู่ในรายการ → ไม่มีหัว CORS แต่มี Vary: Origin", async () => {
    const res = await apiHandler(req("https://evil.example"), async () => apiOk({}));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Origin");
  });
  it("ไม่ตั้ง POS_ORIGINS → ไม่มี CORS", async () => {
    state.origins = "";
    expect((await apiHandler(req(ALLOWED), async () => apiOk({}))).headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("apiPreflight", () => {
  it("204 เสมอแม้ API ปิด พร้อมหัว preflight ครบ", async () => {
    state.enabled = "0";
    const res = apiPreflight(req(ALLOWED, "OPTIONS"));
    expect(res.status).toBe(204);
    expectCors(res);
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type");
    expect(res.headers.get("Access-Control-Max-Age")).toBe("7200");
    expect(await res.text()).toBe("");
  });
  it("origin ไม่อนุญาต → 204 ไม่มีหัว CORS", () => {
    const res = apiPreflight(req("https://evil.example", "OPTIONS"));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Methods")).toBeNull();
  });
});

describe("route กันตก /api/v1/[...rest]", () => {
  it("path ไม่รู้จัก = 404 DY404 มีหัว CORS · OPTIONS = 204", async () => {
    const mod = (await import("../src/app/api/v1/[...rest]/route")) as Record<string, (r: Request) => Promise<Response> | Response>;
    const res = await mod.GET!(new Request("https://x/api/v1/pos/nope", { headers: { Origin: ALLOWED } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: { code: "DY404", message: "not_found" } });
    expectCors(res);
    expect((await mod.OPTIONS!(req(ALLOWED, "OPTIONS"))).status).toBe(204);
  });
});

describe("ทุก route ใต้ /api/v1 export OPTIONS", () => {
  it.each([
    "../src/app/api/v1/catalog/route", "../src/app/api/v1/orders/route", "../src/app/api/v1/orders/[order_no]/route",
    "../src/app/api/v1/promotions/route", "../src/app/api/v1/stock/route", "../src/app/api/v1/stock/movements/route",
  ])("%s", async (path) => {
    const mod = (await import(path)) as { OPTIONS?: (r: Request) => Response };
    expect(typeof mod.OPTIONS).toBe("function");
    expect(mod.OPTIONS!(req(ALLOWED, "OPTIONS")).status).toBe(204);
  });
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npx vitest run --root apps/web test/api.cors.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/api/cors'`

- [ ] **Step 3: เขียนโค้ด**

`apps/web/src/lib/platform.ts` เพิ่ม:
```ts
/** origin ของแอป POS ที่อนุญาต CORS (env `POS_ORIGINS` คั่นจุลภาค · ไม่ตั้ง = ไม่มี CORS — ADR-0048) */
export function posOrigins(): string[] {
  return (getEnv().POS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
```

`apps/web/src/env.d.ts` ใน `interface CloudflareEnv` เพิ่ม:
```ts
  /** origin ของแอป POS ที่อนุญาต CORS คั่นด้วยจุลภาค เช่น "https://pos.example.pages.dev" (ADR-0048) — ไม่ตั้ง = ไม่มี CORS */
  POS_ORIGINS?: string;
```

`apps/web/.env.example` ต่อจากบรรทัด `API_V1_ENABLED`:
```
# POS_ORIGINS=http://localhost:5173  # origin ของแอป POS ที่เรียก /api/v1 จากเบราว์เซอร์ได้ (คั่นจุลภาค · ADR-0048)
```

`apps/web/src/lib/api/cors.ts`:
```ts
import "server-only";
import { posOrigins } from "@/lib/platform";

// CORS ของ /api/v1/* ที่จุดเดียว (สเปก POS 04 §4.1 · ADR-0048) — ใช้โดย apiHandler และ OPTIONS ของทุก route
// ไม่ใช่กำแพงความปลอดภัย (คำขอนอกเบราว์เซอร์ไม่สน CORS) แต่ไม่มีหัวนี้เบราว์เซอร์จะซ่อน 401/404/429 จาก JS ของแท็บเล็ต
export const CORS_ALLOW_METHODS = "GET, POST, OPTIONS";
export const CORS_ALLOW_HEADERS = "Authorization, Content-Type";
export const CORS_MAX_AGE = "7200";

export function corsHeaders(origin: string | null, allowed: readonly string[]): Record<string, string> | null {
  if (!origin || !allowed.includes(origin)) return null;
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": "Retry-After" };
}

function allowedOrigins(): string[] {
  try {
    return posOrigins();
  } catch {
    return [];
  }
}

function addVaryOrigin(headers: Headers): void {
  const vary = headers.get("Vary");
  if (!vary) headers.set("Vary", "Origin");
  else if (!vary.split(/\s*,\s*/).includes("Origin")) headers.set("Vary", `${vary}, Origin`);
}

/** ครอบคำตอบใด ๆ (รวม error) ด้วยหัว CORS + Vary: Origin — สร้าง Response ใหม่ (หัวของบางคำตอบแก้ไม่ได้) */
export function withCors(res: Response, req: Request): Response {
  const headers = new Headers(res.headers);
  addVaryOrigin(headers);
  const cors = corsHeaders(req.headers.get("Origin"), allowedOrigins());
  if (cors) for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** OPTIONS ของทุก route ใต้ /api/v1 — 204 เสมอ (แม้ API ปิด) · ไม่แตะฐานข้อมูล */
export function apiPreflight(req: Request): Response {
  const headers = new Headers();
  addVaryOrigin(headers);
  const cors = corsHeaders(req.headers.get("Origin"), allowedOrigins());
  if (cors) {
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
    headers.set("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
    headers.set("Access-Control-Max-Age", CORS_MAX_AGE);
  }
  return new Response(null, { status: 204, headers });
}
```

`apps/web/src/lib/api/response.ts` — เปลี่ยน `apiHandler` (เนื้อในเดิมย้ายไป `runApi` ทุกบรรทัด):
```ts
import { withCors } from "./cors";

/** ครอบ handler ของ route: สวิตช์ API_V1_ENABLED → แปล error เป็นคำตอบ §8 → ใส่หัว CORS ให้ทุกคำตอบ (ADR-0048) */
export async function apiHandler(req: Request, fn: () => Promise<Response>): Promise<Response> {
  return withCors(await runApi(fn), req);
}

// เนื้อในเดิมของ apiHandler ทุกบรรทัด (ไม่เปลี่ยนพฤติกรรม)
async function runApi(fn: () => Promise<Response>): Promise<Response> {
  // /api/v1/* ปิดเป็นค่าเริ่มต้น (owner decision, ADR-0042) — ตอบ 404 ก่อนแตะ auth/DB เสมอ
  if (!isApiV1Enabled()) {
    return apiError("DY404", "not_found");
  }
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) return apiError(err.code, err.message, err.retryAfter);
    if (err instanceof RpcError) {
      if (KNOWN_DY_CODE_RE.test(err.code)) return apiError(err.code, err.message);
      // eslint-disable-next-line no-console
      console.error("api/v1 db error", err.code, err.message);
      return apiError("DY500", "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ ลองใหม่อีกครั้งค่ะ");
    }
    // eslint-disable-next-line no-console
    console.error("api/v1 unexpected error", err);
    return apiError("DY500", "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ ลองใหม่อีกครั้งค่ะ");
  }
}
```

route กันตก `apps/web/src/app/api/v1/[...rest]/route.ts` (ใหม่ — path ที่ไม่รู้จักใต้ `/api/v1` ต้องได้ 404 ที่มีหัว CORS ไม่ใช่หน้า 404 ของ Next · §4.1 "ทุกคำตอบใต้ /api/v1/*"):
```ts
import { apiPreflight } from "@/lib/api/cors";
import { apiError, apiHandler } from "@/lib/api/response";

// ทุก path ใต้ /api/v1 ที่ไม่มี route จริง → 404 รูป §8 + หัว CORS (ADR-0048) · ไม่แตะ auth/DB
async function notFound(req: Request): Promise<Response> {
  return apiHandler(req, async () => apiError("DY404", "not_found"));
}
export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export function OPTIONS(req: Request): Response {
  return apiPreflight(req);
}
```
(Next ใช้ route เฉพาะก่อน catch-all เสมอ — route เดิมทุกตัวไม่ถูกกระทบ)

ทุก route ใต้ `apps/web/src/app/api/v1/**/route.ts` (6 ไฟล์): เปลี่ยน `apiHandler(async () => …)` เป็น `apiHandler(req, async () => …)` และเพิ่มท้ายไฟล์:
```ts
import { apiPreflight } from "@/lib/api/cors";

export function OPTIONS(req: Request): Response {
  return apiPreflight(req);
}
```

เทสต์เดิม (`api.v1Gate.test.ts`, `api.response.test.ts` และที่ `grep` เจอ): เปลี่ยนการเรียกเป็น `apiHandler(new Request("https://x/api/v1/t"), fn)` และเพิ่ม `posOrigins: () => []` ใน `vi.mock("../src/lib/platform", …)`

- [ ] **Step 4: รันให้ผ่าน**

Run: `npx vitest run --root apps/web && npm run typecheck -w @dayo/web`
Expected: PASS ทั้งหมด

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add apps/web/src/lib/api/cors.ts apps/web/src/lib/api/response.ts apps/web/src/lib/platform.ts apps/web/src/env.d.ts apps/web/.env.example apps/web/src/app/api/v1 apps/web/test/api.cors.test.ts apps/web/test/api.v1Gate.test.ts apps/web/test/api.response.test.ts
git commit -m "feat(web): add cors to every /api/v1 response and preflight"
```

---

## Task 6: fixture สัญญาชุดกลาง (22 ไฟล์) + harness เล่นผ่าน Route Handler

**agent:** web-developer · sonnet · medium (lane B)

**Files:**
- Create: `apps/web/test/fixtures/pos-contract/*.json` (22 ไฟล์ตามรายการด้านล่าง — เนื้อหาเต็ม) + `apps/web/test/fixtures/pos-contract/.gitattributes`
- Create: `apps/web/test/api.posContract.test.ts`

**Interfaces:**
- Consumes: `apiHandler(req, fn)`, `apiPreflight` (Task 5) · route E1/E2 (Task 7/8) · E3 ผ่าน `api_list_orders` (Task 9)
- Produces: รูปไฟล์ fixture (ทีม POS ใช้ส่วน `request`/`response` · ส่วน `env`/`rpc` ใช้เฉพาะ harness ของ dayo):
  ```ts
  interface PosContractFixture {
    name: string;                      // = ชื่อไฟล์ไม่รวม .json
    spec: string;                      // หัวข้อในสเปก 04
    env: Record<string, string | object>;   // API_V1_ENABLED, POS_ORIGINS, DAYO_SHOP_ID, DAYO_PRICING_MANIFEST(object)
    rpc?: Record<string, unknown>;     // ผลที่ mock ต่อชื่อ RPC · "@data" = response.body.data (ตัด pricing) · {"$throw":"network"}
    request: { method: "GET" | "POST" | "OPTIONS"; path: string; headers?: Record<string, string>; body?: unknown };
    response: { status: number; headers?: Record<string, string>; headers_absent?: string[]; body?: unknown };  // ไม่มี body = ว่าง
  }
  ```

ไฟล์นี้เป็น **สัญญากลาง**: ห้ามแก้เนื้อหาโดยไม่แก้สเปก 04 ก่อน · harness ของ Task นี้ต้องผ่านทุกไฟล์เมื่อ Task 7–9 เสร็จ (ก่อนนั้น fixture ของ route ที่ยังไม่มีข้ามได้ด้วย `it.skipIf(!routeExists)`)

- [ ] **Step 1: สร้างไฟล์ fixture** — ทุกไฟล์ใน `apps/web/test/fixtures/pos-contract/`

`e1-catalog-changed.json`
```json
{
  "name": "e1-catalog-changed",
  "spec": "04 §4.4 (changed:true) · §4.1 CORS",
  "env": {
    "API_V1_ENABLED": "1",
    "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173",
    "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555",
    "DAYO_PRICING_MANIFEST": {
      "commit": "3f2a9c1e5b7d9f0a2c4e6a8b0d1f3a5c7e9b1d3f",
      "files_sha256": {
        "packages/shared/src/cost.ts": "1a2b3c4d5e6f70811a2b3c4d5e6f70811a2b3c4d5e6f70811a2b3c4d5e6f7081",
        "packages/shared/src/fmt.ts": "2b3c4d5e6f7081922b3c4d5e6f7081922b3c4d5e6f7081922b3c4d5e6f708192",
        "packages/shared/src/money.ts": "9b1e0c3a5d7f9e1b9b1e0c3a5d7f9e1b9b1e0c3a5d7f9e1b9b1e0c3a5d7f9e1b",
        "packages/shared/src/promotions.ts": "c47d2e8f1a3b5c6dc47d2e8f1a3b5c6dc47d2e8f1a3b5c6dc47d2e8f1a3b5c6d",
        "packages/shared/src/shopSettings.ts": "3c4d5e6f708192033c4d5e6f708192033c4d5e6f708192033c4d5e6f70819203",
        "packages/shared/src/time.ts": "4d5e6f70819203144d5e6f70819203144d5e6f70819203144d5e6f7081920314",
        "packages/shared/src/types.ts": "5e6f7081920314255e6f7081920314255e6f7081920314255e6f708192031425"
      }
    }
  },
  "rpc": {
    "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] },
    "api_pos_catalog": "@data"
  },
  "request": {
    "method": "GET",
    "path": "/api/v1/pos/catalog?known_version=0",
    "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001" }
  },
  "response": {
    "status": 200,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After", "Cache-Control": "no-store" },
    "body": {
      "ok": true,
      "data": {
        "pricing": {
          "commit": "3f2a9c1e5b7d9f0a2c4e6a8b0d1f3a5c7e9b1d3f",
          "files_sha256": {
            "packages/shared/src/cost.ts": "1a2b3c4d5e6f70811a2b3c4d5e6f70811a2b3c4d5e6f70811a2b3c4d5e6f7081",
            "packages/shared/src/fmt.ts": "2b3c4d5e6f7081922b3c4d5e6f7081922b3c4d5e6f7081922b3c4d5e6f708192",
            "packages/shared/src/money.ts": "9b1e0c3a5d7f9e1b9b1e0c3a5d7f9e1b9b1e0c3a5d7f9e1b9b1e0c3a5d7f9e1b",
            "packages/shared/src/promotions.ts": "c47d2e8f1a3b5c6dc47d2e8f1a3b5c6dc47d2e8f1a3b5c6dc47d2e8f1a3b5c6d",
            "packages/shared/src/shopSettings.ts": "3c4d5e6f708192033c4d5e6f708192033c4d5e6f708192033c4d5e6f70819203",
            "packages/shared/src/time.ts": "4d5e6f70819203144d5e6f70819203144d5e6f70819203144d5e6f7081920314",
            "packages/shared/src/types.ts": "5e6f7081920314255e6f7081920314255e6f7081920314255e6f708192031425"
          }
        },
        "changed": true,
        "catalog_version": 42,
        "server_time": "2026-09-25T02:00:00.120+00:00",
        "client": { "name": "แท็บเล็ตขาย 1", "last_receipt_no": "A-000311" },
        "supported_kinds": ["order", "order_void"],
        "supported_fields": {
          "order": ["pos_order_id", "receipt_no", "queue_no", "sale_date", "sold_at", "channel", "payment", "staff_id", "catalog_version", "shift_id", "lines", "lines.code", "lines.size", "lines.sweetness", "lines.milk", "lines.grade", "lines.qty", "lines.free", "lines.discount_baht", "lines.discount_percent", "lines.discount_reason", "bill_discount", "promo_code", "skip_promotion_ids", "no_promotions", "totals", "note"],
          "order_void": ["pos_order_id", "voided_at", "staff_id", "approved_by", "reason"]
        },
        "staff": [
          { "id": "7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f", "display_name": "TungAo", "role": "owner", "active": true },
          { "id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "display_name": "DCm", "role": "staff", "active": true },
          { "id": "6c5b4a39-2817-4f06-9e5d-4c3b2a190807", "display_name": null, "role": "staff", "active": false }
        ],
        "catalog": {
          "settings": { "shopName": "DA-YO", "defaultSize": "16 oz", "defaultSweetness": "100%", "defaultChannelCode": "store", "defaultMilk": "fresh", "maxQtyPerLine": 99, "backdateDays": 7, "recentOrdersCount": 5 },
          "variants": [
            { "menuCode": "Thai Tea", "menuNameTh": "ชาไทย", "family": "ชาไทย", "categoryLabel": "ชาไทย", "menuSortOrder": 1, "size": "16 oz", "sweetness": "50%", "price": 35, "allowOatMilk": false, "isMatcha": false,
              "recipeLines": [ { "ingredientId": null, "baseId": "5e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b", "qty": 120, "unit": "ml" }, { "ingredientId": "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f", "baseId": null, "qty": 60, "unit": "ml" } ] },
            { "menuCode": "Matcha Latte", "menuNameTh": "มัตจะลาเต้", "family": "มัตจะ", "categoryLabel": "มัตจะ", "menuSortOrder": 3, "size": "16 oz", "sweetness": "50%", "price": 85, "allowOatMilk": true, "isMatcha": true,
              "recipeLines": [ { "ingredientId": "e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7a8b", "baseId": null, "qty": 3.5, "unit": "g" }, { "ingredientId": "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f", "baseId": null, "qty": 150, "unit": "ml" } ] }
          ],
          "ingredients": {
            "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d": { "id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "code": "RM-001", "name": "ใบชาไทย", "useUnit": "g" },
            "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f": { "id": "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f", "code": "RM-012", "name": "นมสด", "useUnit": "ml" },
            "d4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f7a": { "id": "d4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f7a", "code": "RM-013", "name": "นมโอ๊ต", "useUnit": "ml" },
            "e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7a8b": { "id": "e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7a8b", "code": "RM-020", "name": "ผงมัตจะ Excellent", "useUnit": "g" }
          },
          "bases": {
            "5e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b": { "id": "5e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b", "code": "BASE-THAI", "name": "ชาไทยเบส", "yieldQty": 1000, "yieldUnit": "ml", "lines": [ { "ingredientId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "qty": 40 } ] }
          },
          "milkOptions": [
            { "code": "fresh", "ingredientId": "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f", "priceAdd": 0, "aliases": ["นมสด"] },
            { "code": "oat", "ingredientId": "d4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f7a", "priceAdd": 15, "aliases": ["โอ๊ต"] }
          ],
          "gradeOptions": [
            { "code": "Excellent", "ingredientId": "e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7a8b", "multiplier": 1, "priceAdd": 0, "isDefault": true, "aliases": [] }
          ],
          "channels": [
            { "code": "store", "name": "หน้าร้าน", "aliases": [], "priceMarkupPct": 0, "priceAddBaht": 0, "rounding": "none", "feePct": 0, "defaultPaymentMethodCode": "cash" }
          ],
          "paymentMethods": [
            { "code": "cash", "name": "เงินสด", "aliases": ["เงินสด", "สด"] },
            { "code": "qr", "name": "QR", "aliases": ["qr"] }
          ],
          "promotions": [
            { "id": "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f", "code": null, "name": "ชาไทย ซื้อ 2 แถม 1", "kind": "buy_n_get_m", "startsOn": null, "endsOn": null, "daysOfWeek": null, "timeFrom": null, "timeTo": null, "channelCodes": [], "requiresCode": false, "autoApply": true, "priority": 10, "stackable": false, "isActive": true, "params": { "buy_qty": 2, "get_qty": 1, "menu_codes": ["Thai Tea"] } }
          ]
        }
      }
    }
  }
}
```

`e1-catalog-unchanged.json`
```json
{
  "name": "e1-catalog-unchanged",
  "spec": "04 §4.4 (changed:false)",
  "env": {
    "API_V1_ENABLED": "1",
    "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173",
    "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555",
    "DAYO_PRICING_MANIFEST": { "commit": "3f2a9c1e5b7d9f0a2c4e6a8b0d1f3a5c7e9b1d3f", "files_sha256": { "packages/shared/src/money.ts": "9b1e0c3a5d7f9e1b9b1e0c3a5d7f9e1b9b1e0c3a5d7f9e1b9b1e0c3a5d7f9e1b" } }
  },
  "rpc": {
    "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] },
    "api_pos_catalog": "@data"
  },
  "request": { "method": "GET", "path": "/api/v1/pos/catalog?known_version=42", "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001" } },
  "response": {
    "status": 200,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": {
      "ok": true,
      "data": {
        "pricing": { "commit": "3f2a9c1e5b7d9f0a2c4e6a8b0d1f3a5c7e9b1d3f", "files_sha256": { "packages/shared/src/money.ts": "9b1e0c3a5d7f9e1b9b1e0c3a5d7f9e1b9b1e0c3a5d7f9e1b9b1e0c3a5d7f9e1b" } },
        "changed": false,
        "catalog_version": 42,
        "server_time": "2026-09-25T02:00:00.120+00:00",
        "supported_kinds": ["order", "order_void"],
        "supported_fields": {
          "order": ["pos_order_id", "receipt_no", "queue_no", "sale_date", "sold_at", "channel", "payment", "staff_id", "catalog_version", "shift_id", "lines", "lines.code", "lines.size", "lines.sweetness", "lines.milk", "lines.grade", "lines.qty", "lines.free", "lines.discount_baht", "lines.discount_percent", "lines.discount_reason", "bill_discount", "promo_code", "skip_promotion_ids", "no_promotions", "totals", "note"],
          "order_void": ["pos_order_id", "voided_at", "staff_id", "approved_by", "reason"]
        }
      }
    }
  }
}
```

`e1-missing-staff-scope.json`
```json
{
  "name": "e1-missing-staff-scope",
  "spec": "04 §4.4 scope catalog:read และ staff:read",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": { "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "orders:read", "orders:write"] } },
  "request": { "method": "GET", "path": "/api/v1/pos/catalog", "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001" } },
  "response": {
    "status": 403,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": false, "error": { "code": "DY403", "message": "forbidden: API key ไม่มีสิทธิ์ staff:read" } }
  }
}
```

`e2-order-accepted.json`
```json
{
  "name": "e2-order-accepted",
  "spec": "04 §4.5 แถว order · accepted",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {
    "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] },
    "api_pos_push": "@data"
  },
  "request": {
    "method": "POST",
    "path": "/api/v1/pos/push",
    "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001", "Content-Type": "application/json" },
    "body": {
      "device_time": "2026-09-25T03:15:03.500Z",
      "rows": [
        { "key": "order:0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21", "kind": "order", "data": {
          "pos_order_id": "0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21", "receipt_no": "A-000312", "queue_no": 12,
          "sale_date": "2026-09-25", "sold_at": "2026-09-25T03:15:03.120Z", "channel": "store", "payment": "cash",
          "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "catalog_version": 42, "shift_id": null,
          "lines": [
            { "code": "Thai Tea", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": null, "qty": 3 },
            { "code": "Matcha Latte", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": "Excellent", "qty": 1 }
          ],
          "bill_discount": null, "promo_code": null, "skip_promotion_ids": [], "no_promotions": false,
          "totals": { "items_subtotal": 190, "items_discount": 35, "bill_discount": 0, "total": 155 }, "note": null } }
      ]
    }
  },
  "response": {
    "status": 200,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": true, "data": { "server_time": "2026-09-25T03:15:04.010+00:00", "results": [
      { "key": "order:0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21", "status": "accepted",
        "data": { "order_no": "L260925-014", "version": 1, "computed_total": 155, "amount_mismatch": false, "duplicate_of": ["L260925-013"], "warnings": [] } }
    ] } }
  }
}
```

`e2-order-duplicate.json`
```json
{
  "name": "e2-order-duplicate",
  "spec": "04 §4.5 key เดิม + เนื้อหาเดิม = duplicate ผลเดิม",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {
    "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] },
    "api_pos_push": "@data"
  },
  "request": {
    "method": "POST",
    "path": "/api/v1/pos/push",
    "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001", "Content-Type": "application/json" },
    "body": {
      "device_time": "2026-09-25T03:20:00.000Z",
      "rows": [
        { "key": "order:0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21", "kind": "order", "data": {
          "pos_order_id": "0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21", "receipt_no": "A-000312", "queue_no": 12,
          "sale_date": "2026-09-25", "sold_at": "2026-09-25T03:15:03.120Z", "channel": "store", "payment": "cash",
          "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "catalog_version": 42, "shift_id": null,
          "lines": [
            { "code": "Thai Tea", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": null, "qty": 3 },
            { "code": "Matcha Latte", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": "Excellent", "qty": 1 }
          ],
          "bill_discount": null, "promo_code": null, "skip_promotion_ids": [], "no_promotions": false,
          "totals": { "items_subtotal": 190, "items_discount": 35, "bill_discount": 0, "total": 155 }, "note": null } }
      ]
    }
  },
  "response": {
    "status": 200,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": true, "data": { "server_time": "2026-09-25T03:20:00.180+00:00", "results": [
      { "key": "order:0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21", "status": "duplicate",
        "data": { "order_no": "L260925-014", "version": 1, "computed_total": 155, "amount_mismatch": false, "duplicate_of": ["L260925-013"], "warnings": [] } }
    ] } }
  }
}
```

`e2-receipt-conflict.json`
```json
{
  "name": "e2-receipt-conflict",
  "spec": "04 §4.5 ข้อ 0 (ข) receipt_no เดิม + pos_order_id ใหม่ = CONFLICT ห้ามเป็น duplicate",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {
    "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] },
    "api_pos_push": "@data"
  },
  "request": {
    "method": "POST", "path": "/api/v1/pos/push",
    "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001", "Content-Type": "application/json" },
    "body": { "device_time": "2026-09-25T04:00:00.000Z", "rows": [
      { "key": "order:1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", "kind": "order", "data": {
        "pos_order_id": "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", "receipt_no": "A-000312", "queue_no": 1,
        "sale_date": "2026-09-25", "sold_at": "2026-09-25T03:59:10.000Z", "channel": "store", "payment": "qr",
        "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "catalog_version": 42, "shift_id": null,
        "lines": [ { "code": "Thai Tea", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": null, "qty": 1 } ],
        "bill_discount": null, "promo_code": null, "skip_promotion_ids": [], "no_promotions": false,
        "totals": { "items_subtotal": 35, "items_discount": 0, "bill_discount": 0, "total": 35 }, "note": null } } ] }
  },
  "response": {
    "status": 200,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": true, "data": { "server_time": "2026-09-25T04:00:00.410+00:00", "results": [
      { "key": "order:1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", "status": "rejected", "reason": "CONFLICT", "detail": "เลขใบเสร็จ A-000312 ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว" }
    ] } }
  }
}
```

`e2-key-reused-different-content.json`
```json
{
  "name": "e2-key-reused-different-content",
  "spec": "04 §4.5 ข้อ 0 (1) key เดิม เนื้อหาต่างจากที่เคยบันทึกสำเร็จ = CONFLICT",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {
    "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] },
    "api_pos_push": "@data"
  },
  "request": {
    "method": "POST",
    "path": "/api/v1/pos/push",
    "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001", "Content-Type": "application/json" },
    "body": {
      "device_time": "2026-09-25T03:25:00.000Z",
      "rows": [
        { "key": "order:0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21", "kind": "order", "data": {
          "pos_order_id": "0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21", "receipt_no": "A-000312", "queue_no": 12,
          "sale_date": "2026-09-25", "sold_at": "2026-09-25T03:15:03.120Z", "channel": "store", "payment": "cash",
          "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "catalog_version": 42, "shift_id": null,
          "lines": [
            { "code": "Thai Tea", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": null, "qty": 3 },
            { "code": "Matcha Latte", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": "Excellent", "qty": 1 }
          ],
          "bill_discount": null, "promo_code": null, "skip_promotion_ids": [], "no_promotions": false,
          "totals": { "items_subtotal": 190, "items_discount": 35, "bill_discount": 0, "total": 155 }, "note": "ลูกค้าขอแยกบิล" } }
      ]
    }
  },
  "response": {
    "status": 200,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": true, "data": { "server_time": "2026-09-25T03:25:00.140+00:00", "results": [
      { "key": "order:0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21", "status": "rejected", "reason": "CONFLICT", "detail": "key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว" }
    ] } }
  }
}
```

`e2-unknown-code-other-row-ok.json`
```json
{
  "name": "e2-unknown-code-other-row-ok",
  "spec": "04 §4.5 รหัสไม่มีในร้าน = UNKNOWN_CODE · แถวอื่นในก้อนยังผ่าน",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {
    "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] },
    "api_pos_push": "@data"
  },
  "request": {
    "method": "POST", "path": "/api/v1/pos/push",
    "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001", "Content-Type": "application/json" },
    "body": { "device_time": "2026-09-25T05:00:00.000Z", "rows": [
      { "key": "order:2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a", "kind": "order", "data": {
        "pos_order_id": "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a", "receipt_no": "A-000320", "queue_no": 20,
        "sale_date": "2026-09-25", "sold_at": "2026-09-25T04:58:00.000Z", "channel": "store", "payment": "cash",
        "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "catalog_version": 41, "shift_id": null,
        "lines": [ { "code": "Mango Smoothie", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": null, "qty": 1 } ],
        "bill_discount": null, "promo_code": null, "skip_promotion_ids": [], "no_promotions": false,
        "totals": { "items_subtotal": 45, "items_discount": 0, "bill_discount": 0, "total": 45 }, "note": null } },
      { "key": "order:3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b", "kind": "order", "data": {
        "pos_order_id": "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b", "receipt_no": "A-000321", "queue_no": 21,
        "sale_date": "2026-09-25", "sold_at": "2026-09-25T04:59:00.000Z", "channel": "store", "payment": "cash",
        "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "catalog_version": 42, "shift_id": null,
        "lines": [ { "code": "Thai Tea", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": null, "qty": 1 } ],
        "bill_discount": null, "promo_code": null, "skip_promotion_ids": [], "no_promotions": false,
        "totals": { "items_subtotal": 35, "items_discount": 0, "bill_discount": 0, "total": 35 }, "note": null } }
    ] }
  },
  "response": {
    "status": 200,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": true, "data": { "server_time": "2026-09-25T05:00:00.300+00:00", "results": [
      { "key": "order:2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a", "status": "rejected", "reason": "UNKNOWN_CODE", "detail": "ไม่พบเมนู \"Mango Smoothie\"" },
      { "key": "order:3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b", "status": "accepted",
        "data": { "order_no": "L260925-020", "version": 1, "computed_total": 35, "amount_mismatch": false, "duplicate_of": [], "warnings": [] } }
    ] } }
  }
}
```

`e2-order-and-void-same-batch.json`
```json
{
  "name": "e2-order-and-void-same-batch",
  "spec": "04 §4.5 แถวถัดไปเห็นแถวก่อนหน้าในคำขอเดียวกัน · order_void",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {
    "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] },
    "api_pos_push": "@data"
  },
  "request": {
    "method": "POST", "path": "/api/v1/pos/push",
    "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001", "Content-Type": "application/json" },
    "body": { "device_time": "2026-09-25T06:10:00.000Z", "rows": [
      { "key": "order:4f5a6b7c-8d9e-4f0a-9b1c-3d4e5f6a7b8c", "kind": "order", "data": {
        "pos_order_id": "4f5a6b7c-8d9e-4f0a-9b1c-3d4e5f6a7b8c", "receipt_no": "A-000330", "queue_no": 30,
        "sale_date": "2026-09-25", "sold_at": "2026-09-25T06:00:00.000Z", "channel": "store", "payment": "cash",
        "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "catalog_version": 42, "shift_id": null,
        "lines": [ { "code": "Thai Tea", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": null, "qty": 1 } ],
        "bill_discount": null, "promo_code": null, "skip_promotion_ids": [], "no_promotions": false,
        "totals": { "items_subtotal": 35, "items_discount": 0, "bill_discount": 0, "total": 35 }, "note": null } },
      { "key": "order_void:4f5a6b7c-8d9e-4f0a-9b1c-3d4e5f6a7b8c", "kind": "order_void", "data": {
        "pos_order_id": "4f5a6b7c-8d9e-4f0a-9b1c-3d4e5f6a7b8c", "voided_at": "2026-09-25T06:05:00.000Z",
        "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "approved_by": "7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f", "reason": "ลูกค้าเปลี่ยนใจ" } }
    ] }
  },
  "response": {
    "status": 200,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": true, "data": { "server_time": "2026-09-25T06:10:00.250+00:00", "results": [
      { "key": "order:4f5a6b7c-8d9e-4f0a-9b1c-3d4e5f6a7b8c", "status": "accepted",
        "data": { "order_no": "L260925-030", "version": 1, "computed_total": 35, "amount_mismatch": false, "duplicate_of": [], "warnings": [] } },
      { "key": "order_void:4f5a6b7c-8d9e-4f0a-9b1c-3d4e5f6a7b8c", "status": "accepted", "data": { "order_no": "L260925-030", "version": 2 } }
    ] } }
  }
}
```

`e2-void-cross-day.json`
```json
{
  "name": "e2-void-cross-day",
  "spec": "04 §4.5 order_void: วันที่ไทยของ voided_at ≠ sale_date = FORBIDDEN",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {
    "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] },
    "api_pos_push": "@data"
  },
  "request": {
    "method": "POST", "path": "/api/v1/pos/push",
    "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001", "Content-Type": "application/json" },
    "body": { "device_time": "2026-09-26T03:00:05.000Z", "rows": [
      { "key": "order_void:5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a", "kind": "order_void", "data": {
        "pos_order_id": "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a", "voided_at": "2026-09-26T03:00:00.000Z",
        "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "approved_by": "7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f", "reason": "ทำผิดแก้ว" } }
    ] }
  },
  "response": {
    "status": 200,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": true, "data": { "server_time": "2026-09-26T03:00:05.120+00:00", "results": [
      { "key": "order_void:5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a", "status": "rejected", "reason": "FORBIDDEN", "detail": "ยกเลิกได้เฉพาะวันเดียวกับวันขาย (voided_at 2026-09-26 ≠ sale_date 2026-09-25)" }
    ] } }
  }
}
```

`e2-void-clock-ahead.json`
```json
{
  "name": "e2-void-clock-ahead",
  "spec": "04 §4.5 voided_at เกินเวลาเซิร์ฟเวอร์ + 5 นาที = deferred CLOCK_AHEAD",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {
    "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] },
    "api_pos_push": "@data"
  },
  "request": {
    "method": "POST", "path": "/api/v1/pos/push",
    "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001", "Content-Type": "application/json" },
    "body": { "device_time": "2026-09-25T03:22:03.500Z", "rows": [
      { "key": "order_void:0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21", "kind": "order_void", "data": {
        "pos_order_id": "0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21", "voided_at": "2026-09-25T03:22:03.120Z",
        "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "approved_by": null, "reason": "ลูกค้ายกเลิก" } }
    ] }
  },
  "response": {
    "status": 200,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": true, "data": { "server_time": "2026-09-25T03:15:04.010+00:00", "results": [
      { "key": "order_void:0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21", "status": "deferred", "reason": "CLOCK_AHEAD", "detail": "เวลา 2026-09-25T03:22:03.120+00:00 เร็วกว่าเวลาระบบกลาง 2026-09-25T03:15:04.010+00:00 เกิน 5 นาที — ตรวจนาฬิกาเครื่องค่ะ" }
    ] } }
  }
}
```

`e2-unsupported-kind-and-field.json`
```json
{
  "name": "e2-unsupported-kind-and-field",
  "spec": "04 §4.1 ความเข้ากันได้: ชนิด/ฟิลด์ที่ไม่รู้จัก = deferred UNSUPPORTED",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {
    "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] },
    "api_pos_push": "@data"
  },
  "request": {
    "method": "POST", "path": "/api/v1/pos/push",
    "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001", "Content-Type": "application/json" },
    "body": { "device_time": "2026-09-25T07:00:00.000Z", "rows": [
      { "key": "shift_open:6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d", "kind": "shift_open", "data": {
        "id": "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d", "business_date": "2026-09-25", "opened_by": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d",
        "opened_at": "2026-09-25T01:58:00.000Z", "opening_float": 1000 } },
      { "key": "order:7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e", "kind": "order", "data": {
        "pos_order_id": "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e", "receipt_no": "A-000340", "queue_no": 40,
        "sale_date": "2026-09-25", "sold_at": "2026-09-25T06:59:00.000Z", "channel": "store", "payment": "cash",
        "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "catalog_version": 42, "shift_id": null,
        "lines": [ { "code": "Thai Tea", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": null, "qty": 1 } ],
        "bill_discount": null, "promo_code": null, "skip_promotion_ids": [], "no_promotions": false,
        "totals": { "items_subtotal": 35, "items_discount": 0, "bill_discount": 0, "total": 35 }, "note": null, "tip": 5 } }
    ] }
  },
  "response": {
    "status": 200,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": true, "data": { "server_time": "2026-09-25T07:00:00.200+00:00", "results": [
      { "key": "shift_open:6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d", "status": "deferred", "reason": "UNSUPPORTED", "detail": "ชนิดแถวนี้ระบบกลางรุ่นนี้ยังไม่รองรับ" },
      { "key": "order:7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e", "status": "deferred", "reason": "UNSUPPORTED", "detail": "มีฟิลด์ที่ระบบกลางรุ่นนี้ยังไม่รู้จัก" }
    ] } }
  }
}
```

`e2-row-server-error.json`
```json
{
  "name": "e2-row-server-error",
  "spec": "04 §4.5 error ที่ไม่ได้แผนที่ = deferred SERVER_ERROR เฉพาะแถวนั้น · HTTP 200",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {
    "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] },
    "api_pos_push": "@data"
  },
  "request": {
    "method": "POST", "path": "/api/v1/pos/push",
    "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001", "Content-Type": "application/json" },
    "body": { "device_time": "2026-09-25T08:00:00.000Z", "rows": [
      { "key": "order:8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f", "kind": "order", "data": {
        "pos_order_id": "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f", "receipt_no": "A-000350", "queue_no": 50,
        "sale_date": "2026-09-25", "sold_at": "2026-09-25T07:59:00.000Z", "channel": "store", "payment": "cash",
        "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "catalog_version": 42, "shift_id": null,
        "lines": [ { "code": "Thai Tea", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": null, "qty": 1 } ],
        "bill_discount": null, "promo_code": null, "skip_promotion_ids": [], "no_promotions": false,
        "totals": { "items_subtotal": 35, "items_discount": 0, "bill_discount": 0, "total": 35 }, "note": null } },
      { "key": "order:9d0e1f2a-3b4c-4d5e-9f6a-7b8c9d0e1f2a", "kind": "order", "data": {
        "pos_order_id": "9d0e1f2a-3b4c-4d5e-9f6a-7b8c9d0e1f2a", "receipt_no": "A-000351", "queue_no": 51,
        "sale_date": "2026-09-25", "sold_at": "2026-09-25T07:59:30.000Z", "channel": "store", "payment": "qr",
        "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "catalog_version": 42, "shift_id": null,
        "lines": [ { "code": "Thai Tea", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": null, "qty": 1 } ],
        "bill_discount": null, "promo_code": null, "skip_promotion_ids": [], "no_promotions": false,
        "totals": { "items_subtotal": 35, "items_discount": 0, "bill_discount": 0, "total": 35 }, "note": null } }
    ] }
  },
  "response": {
    "status": 200,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": true, "data": { "server_time": "2026-09-25T08:00:00.330+00:00", "results": [
      { "key": "order:8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f", "status": "deferred", "reason": "SERVER_ERROR", "detail": "SQLSTATE XX000" },
      { "key": "order:9d0e1f2a-3b4c-4d5e-9f6a-7b8c9d0e1f2a", "status": "accepted",
        "data": { "order_no": "L260925-051", "version": 1, "computed_total": 35, "amount_mismatch": false, "duplicate_of": ["L260925-049"], "warnings": [] } }
    ] } }
  }
}
```

`e2-envelope-invalid.json`
```json
{
  "name": "e2-envelope-invalid",
  "spec": "04 §4.5 ซองผิด = 422 DY422 ทั้งคำขอ (มีหัว CORS)",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": { "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] } },
  "request": {
    "method": "POST", "path": "/api/v1/pos/push",
    "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001", "Content-Type": "application/json" },
    "body": { "device_time": "2026-09-25T08:00:00.000Z", "rows": {} }
  },
  "response": {
    "status": 422,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": false, "error": { "code": "DY422", "message": "invalid: rows ต้องเป็นรายการ 1–20 แถว" } }
  }
}
```

`err-401-invalid-key.json`
```json
{
  "name": "err-401-invalid-key",
  "spec": "04 §4.1 · §6.3 401 มีหัว CORS (แท็บเล็ตต้องเห็นสถานะ ไม่ใช่เน็ตหลุด)",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": { "api_authenticate": { "ok": false, "error": { "code": "DY401", "message": "invalid_key: API key ไม่ถูกต้องหรือถูกปิดใช้งาน" } } },
  "request": { "method": "GET", "path": "/api/v1/pos/catalog", "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_revoked_key" } },
  "response": {
    "status": 401,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": false, "error": { "code": "DY401", "message": "invalid_key: API key ไม่ถูกต้องหรือถูกปิดใช้งาน" } }
  }
}
```

`err-404-api-disabled.json`
```json
{
  "name": "err-404-api-disabled",
  "spec": "04 §4.1 API_V1_ENABLED ไม่ใช่ 1 = 404 มีหัว CORS",
  "env": { "API_V1_ENABLED": "0", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {},
  "request": { "method": "POST", "path": "/api/v1/pos/push", "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001", "Content-Type": "application/json" }, "body": { "device_time": "2026-09-25T08:00:00.000Z", "rows": [] } },
  "response": {
    "status": 404,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": false, "error": { "code": "DY404", "message": "not_found" } }
  }
}
```

`err-429-rate-limited.json`
```json
{
  "name": "err-429-rate-limited",
  "spec": "04 §4.1 เกิน 60/นาที = 429 + Retry-After ที่ JS อ่านได้",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": { "api_authenticate": { "ok": false, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "retry_after": 17, "error": { "code": "DY429", "message": "rate_limited: เกินจำนวนคำขอต่อนาที (60/min)" } } },
  "request": { "method": "GET", "path": "/api/v1/pos/catalog?known_version=42", "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001" } },
  "response": {
    "status": 429,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After", "Retry-After": "17" },
    "body": { "ok": false, "error": { "code": "DY429", "message": "rate_limited: เกินจำนวนคำขอต่อนาที (60/min)" } }
  }
}
```

`err-500-rpc-unreachable.json`
```json
{
  "name": "err-500-rpc-unreachable",
  "spec": "04 §4.5 5xx เฉพาะเมื่อเรียก RPC ไม่ได้เลย · มีหัว CORS · ไม่มีข้อความดิบ",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": { "api_authenticate": { "$throw": "network" } },
  "request": { "method": "GET", "path": "/api/v1/pos/catalog", "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001" } },
  "response": {
    "status": 500,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": false, "error": { "code": "DY500", "message": "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ ลองใหม่อีกครั้งค่ะ" } }
  }
}
```

`preflight-allowed-api-off.json`
```json
{
  "name": "preflight-allowed-api-off",
  "spec": "04 §4.1 OPTIONS = 204 เสมอ แม้ API ปิด",
  "env": { "API_V1_ENABLED": "0", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {},
  "request": { "method": "OPTIONS", "path": "/api/v1/pos/push", "headers": { "Origin": "https://pos.dayo.test", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } },
  "response": {
    "status": 204,
    "headers": {
      "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "7200"
    }
  }
}
```

`preflight-disallowed-origin.json`
```json
{
  "name": "preflight-disallowed-origin",
  "spec": "04 §4.1 origin ไม่อยู่ในรายการ = ไม่มีหัว CORS",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {},
  "request": { "method": "OPTIONS", "path": "/api/v1/pos/catalog", "headers": { "Origin": "https://evil.example", "Access-Control-Request-Method": "GET" } },
  "response": {
    "status": 204,
    "headers": { "Vary": "Origin" },
    "headers_absent": ["Access-Control-Allow-Origin", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers", "Access-Control-Expose-Headers"]
  }
}
```

`err-404-unknown-path.json`
```json
{
  "name": "err-404-unknown-path",
  "spec": "04 §4.1 ทุกคำตอบใต้ /api/v1/* มีหัว CORS — รวม path ที่ไม่มี (route กันตก)",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {},
  "request": { "method": "GET", "path": "/api/v1/pos/shift-cash?after=2026-09-25T00:00:00.000Z", "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001" } },
  "response": {
    "status": 404,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": false, "error": { "code": "DY404", "message": "not_found" } }
  }
}
```

`.gitattributes` (ในโฟลเดอร์ fixture — ทั้ง dayo และ POS ใส่ไฟล์เดียวกัน)
```
*.json text eol=lf
```

`e3-orders-today.json`
```json
{
  "name": "e3-orders-today",
  "spec": "04 §4.6 GET /v1/orders ฟิลด์ใหม่",
  "env": { "API_V1_ENABLED": "1", "POS_ORIGINS": "https://pos.dayo.test,http://localhost:5173", "DAYO_SHOP_ID": "11111111-2222-4333-8444-555555555555" },
  "rpc": {
    "api_authenticate": { "ok": true, "api_client_id": "5b8e2c1a-7d3f-4e6a-9b0c-2d4e6f8a0b1c", "shop_id": "11111111-2222-4333-8444-555555555555", "name": "แท็บเล็ตขาย 1", "scopes": ["catalog:read", "staff:read", "orders:read", "orders:write"] },
    "api_list_orders": "@data"
  },
  "request": { "method": "GET", "path": "/api/v1/orders?from=2026-09-25&to=2026-09-25", "headers": { "Origin": "https://pos.dayo.test", "Authorization": "Bearer dayo_fixture_key_0001" } },
  "response": {
    "status": 200,
    "headers": { "Access-Control-Allow-Origin": "https://pos.dayo.test", "Vary": "Origin", "Access-Control-Expose-Headers": "Retry-After" },
    "body": { "ok": true, "data": [
      { "order_no": "L260925-014", "sale_date": "2026-09-25", "status": "ok", "source": "pos", "external_ref": "A-000312", "version": 1,
        "channel": "store", "payment": "cash", "totals": { "items_subtotal": 190, "items_discount": 35, "bill_discount": 0, "total": 155, "fee": 0 },
        "amount_mismatch": false, "updated_at": "2026-09-25T03:15:04.012+00:00", "sold_at": "2026-09-25T03:15:03.12+00:00", "created_by_name": "DCm",
        "pos_receipt_no": "A-000312", "pos_queue_no": 12, "catalog_version": 42, "duplicate_suspect": true },
      { "order_no": "L260925-013", "sale_date": "2026-09-25", "status": "ok", "source": "line", "external_ref": null, "version": 1,
        "channel": "store", "payment": "cash", "totals": { "items_subtotal": 190, "items_discount": 35, "bill_discount": 0, "total": 155, "fee": 0 },
        "amount_mismatch": false, "updated_at": "2026-09-25T03:12:40.603+00:00", "sold_at": "2026-09-25T03:12:40.551+00:00", "created_by_name": "TungAo",
        "pos_receipt_no": null, "pos_queue_no": null, "catalog_version": 42, "duplicate_suspect": true }
    ] }
  }
}
```

- [ ] **Step 2: เขียน harness** — `apps/web/test/api.posContract.test.ts`

```ts
// api.posContract.test.ts — เล่น fixture สัญญา POS ชุดกลางทุกไฟล์ผ่าน Route Handler จริง (RPC ถูก mock)
// fixture = สัญญาเดียวกับที่ทีม POS ใช้ (สำเนาอยู่ที่ POS packages/contracts/fixtures/dayo-api) — ห้ามแก้เพื่อให้เทสต์ผ่าน
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Fixture {
  name: string;
  spec: string;
  env: Record<string, string | object>;
  rpc?: Record<string, unknown>;
  request: { method: string; path: string; headers?: Record<string, string>; body?: unknown };
  response: { status: number; headers?: Record<string, string>; headers_absent?: string[]; body?: unknown };
}

const DIR = fileURLToPath(new URL("./fixtures/pos-contract/", import.meta.url));
const fixtures: Fixture[] = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()
  .map((f) => JSON.parse(readFileSync(DIR + f, "utf8")) as Fixture);

const state: { env: Record<string, string>; fx: Fixture | null } = { env: {}, fx: null };

vi.mock("../src/lib/platform", () => ({
  getEnv: () => state.env,
  isApiV1Enabled: () => state.env.API_V1_ENABLED === "1",
  posOrigins: () => (state.env.POS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  waitUntil: () => false,
  getRequestScope: () => null,
}));

vi.mock("../src/lib/db", () => {
  class RpcError extends Error {
    constructor(public code: string, message: string) { super(message); this.name = "RpcError"; }
  }
  const resolve = (fn: string): unknown => {
    const v = state.fx?.rpc?.[fn];
    if (v === undefined) throw new Error(`fixture ${state.fx?.name} ไม่ได้กำหนดผลของ rpc ${fn}`);
    if (v === "@data") {
      const data = structuredClone((state.fx!.response.body as { data: unknown }).data);
      if (data && typeof data === "object" && !Array.isArray(data)) delete (data as Record<string, unknown>).pricing;
      return data;
    }
    if (v && typeof v === "object" && "$throw" in v) throw new TypeError("fetch failed");
    return structuredClone(v);
  };
  return {
    RpcError,
    shopId: () => state.env.DAYO_SHOP_ID,
    rpc: async (fn: string) => resolve(fn),
    rpcRawStream: async (fn: string) => new Response(JSON.stringify(resolve(fn))).body!,
    db: () => { throw new Error("route ของสัญญา POS ต้องเรียก RPC เท่านั้น"); },
  };
});

const ROUTES: Record<string, string> = {
  "/api/v1/pos/catalog": "../src/app/api/v1/pos/catalog/route",
  "/api/v1/pos/push": "../src/app/api/v1/pos/push/route",
  "/api/v1/orders": "../src/app/api/v1/orders/route",
};
// path อื่นใต้ /api/v1 ไปที่ route กันตก [...rest] (Task 5)
const routeOf = (p: string) => ROUTES[p] ?? "../src/app/api/v1/[...rest]/route";
const routeFile = (p: string) => fileURLToPath(new URL(`${routeOf(p)}.ts`, import.meta.url));
// E3 ยังเป็นรูปเดิมจนถึง Task 9 — Task 9 ลบบรรทัดนี้ (ห้ามเพิ่มชื่ออื่นเข้าไป)
const PENDING = new Set<string>(["e3-orders-today"]);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("สัญญา POS ↔ dayo (fixture ชุดกลาง)", () => {
  it("มีครบ 22 ไฟล์ และ name ตรงชื่อไฟล์", () => {
    expect(fixtures).toHaveLength(22);
    const names = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort().map((f) => f.replace(/\.json$/, ""));
    expect(fixtures.map((f) => f.name)).toEqual(names);
  });

  for (const fx of fixtures) {
    const url = new URL(fx.request.path, "https://dayo-web.example.workers.dev");
    it.skipIf(!existsSync(routeFile(url.pathname)) || PENDING.has(fx.name))(`${fx.name} — ${fx.spec}`, async () => {
      state.fx = fx;
      state.env = Object.fromEntries(Object.entries(fx.env).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
      process.env.DAYO_PRICING_MANIFEST = state.env.DAYO_PRICING_MANIFEST ?? "";
      const mod = (await import(routeOf(url.pathname))) as Record<string, (r: Request) => Promise<Response> | Response>;
      const handler = mod[fx.request.method];
      expect(handler, `route ไม่มี ${fx.request.method}`).toBeTypeOf("function");
      const req = new Request(url, {
        method: fx.request.method,
        headers: fx.request.headers,
        body: fx.request.body === undefined ? undefined : JSON.stringify(fx.request.body),
      });
      const res = await handler!(req);
      expect(res.status).toBe(fx.response.status);
      for (const [k, v] of Object.entries(fx.response.headers ?? {})) expect(res.headers.get(k), k).toBe(v);
      for (const k of fx.response.headers_absent ?? []) expect(res.headers.get(k), k).toBeNull();
      const text = await res.text();
      if (fx.response.body === undefined) expect(text).toBe("");
      else expect(JSON.parse(text)).toEqual(fx.response.body);
    });
  }
});
```

- [ ] **Step 3: รัน (fixture ของ route ที่ยังไม่มีถูกข้าม · ไฟล์ครบ 21)**

Run: `npx vitest run --root apps/web test/api.posContract.test.ts`
Expected: เคส "มีครบ 22 ไฟล์" PASS · fixture ของ `/pos/*` และ `e3-orders-today` SKIP · `npm run ci -w @dayo/web` ยังผ่าน

- [ ] **Step 4: ตรวจ JSON ทุกไฟล์ parse ได้ + พิมพ์ sha256 ไว้เทียบกับสำเนาของ POS**

Run: `node -e "const fs=require('fs');const d='apps/web/test/fixtures/pos-contract/';for(const f of fs.readdirSync(d).filter(n=>n.endsWith('.json'))){JSON.parse(fs.readFileSync(d+f,'utf8'))}" && cd apps/web/test/fixtures/pos-contract && for f in *.json; do printf '%s  %s\n' "$(tr -d '\r' < "$f" | sha256sum | cut -d' ' -f1)" "$f"; done`
Expected: ไม่มี error · 22 บรรทัด sha256 (หลังแปลง CRLF → LF) (เก็บไว้ในข้อความสรุปของ task ให้เจ้าของเทียบหลังคัดลอก)

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง) · ⛔ หลัง commit เจ้าของคัดลอกโฟลเดอร์ไป POS `packages/contracts/fixtures/dayo-api/` (ชื่อไฟล์เดิม)
```bash
git add apps/web/test/fixtures/pos-contract apps/web/test/api.posContract.test.ts
git commit -m "test(web): add the shared pos contract fixtures and harness"
```

---

## Task 7: E1 `GET /v1/pos/catalog` + `pricing` ตอน build

**agent:** web-developer · sonnet · medium (lane B)

**Files:**
- Create: `scripts/pricing-manifest.ts`, `apps/web/src/lib/api/pricing.ts`, `apps/web/src/lib/api/jsonSplice.ts`, `apps/web/src/lib/api/posCatalog.ts`
- Create: `apps/web/src/app/api/v1/pos/catalog/route.ts`
- Create: `apps/web/test/pricingManifest.test.ts`, `apps/web/test/jsonSplice.test.ts`
- Modify: `apps/web/next.config.ts`

**Interfaces:**
- Consumes: `api_pos_catalog(p_shop_id, p_api_client_id, p_known_version)` (Task 1) · `rpcRawStream` (มีอยู่) · `apiHandler(req, fn)` / `apiPreflight` (Task 5)
- Produces:
  - `scripts/pricing-manifest.ts`: `PRICING_FILES: readonly string[]` · `fileSha256(repoPath: string): string` · `pricingManifestAtBuild(env?): PricingManifest`
  - `apps/web/src/lib/api/pricing.ts`: `interface PricingManifest { commit: string; files_sha256: Record<string, string> }` · `pricingManifest(): PricingManifest`
  - `apps/web/src/lib/api/jsonSplice.ts`: `wrapOkData(prefix: Record<string, unknown>, raw: ReadableStream<Uint8Array>): ReadableStream<Uint8Array>`
  - `apps/web/src/lib/api/posCatalog.ts`: `parseKnownVersion(v: string | null): number | null`

- [ ] **Step 1: เขียนเทสต์ที่ต้องตก**

`apps/web/test/jsonSplice.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { wrapOkData } from "../src/lib/api/jsonSplice";

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } });
}
const read = (s: ReadableStream<Uint8Array>) => new Response(s).text();

describe("wrapOkData — ต่อ pricing เข้ากับ JSON ดิบของ RPC โดยไม่ parse", () => {
  it("วัตถุปกติ", async () => {
    const out = await read(wrapOkData({ pricing: { commit: "abc" } }, streamOf('{"changed":false,"catalog_version":3}')));
    expect(JSON.parse(out)).toEqual({ ok: true, data: { pricing: { commit: "abc" }, changed: false, catalog_version: 3 } });
  });
  it("ช่องว่างนำหน้า + ถูกหั่นหลายก้อนตรงวงเล็บ", async () => {
    const out = await read(wrapOkData({ pricing: { commit: "x" } }, streamOf("  ", "{", "  ", '"a":1', "}")));
    expect(JSON.parse(out)).toEqual({ ok: true, data: { pricing: { commit: "x" }, a: 1 } });
  });
  it("วัตถุว่าง", async () => {
    expect(JSON.parse(await read(wrapOkData({ pricing: {} }, streamOf("{}"))))).toEqual({ ok: true, data: { pricing: {} } });
  });
  it("ไม่ใช่วัตถุ → stream error", async () => {
    await expect(read(wrapOkData({ pricing: {} }, streamOf("[1]")))).rejects.toThrow();
  });
});
```

`apps/web/test/pricingManifest.test.ts`:
```ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileSha256, PRICING_FILES, pricingManifestAtBuild } from "../../../scripts/pricing-manifest";
import { REPO_ROOT } from "../../../scripts/version";

describe("pricing manifest (สเปก POS 04 §4.4 ข้อ 9 · §5.1)", () => {
  it("ทุกไฟล์มีอยู่ และไฟล์ที่ import กันเองอยู่ในรายการครบ (ชุดปิด — POS คัดลอกชุดนี้)", () => {
    for (const p of PRICING_FILES) {
      expect(existsSync(`${REPO_ROOT}${p}`), p).toBe(true);
      const src = readFileSync(`${REPO_ROOT}${p}`, "utf8");
      for (const m of src.matchAll(/from\s+"\.\/([^"]+)"/g)) {
        const dep = `packages/shared/src/${m[1]!.replace(/\.js$/, "")}.ts`;
        expect(PRICING_FILES, `${p} import ${dep}`).toContain(dep);
      }
    }
  });
  it("sha256 = เนื้อไฟล์หลังแปลง CRLF → LF", () => {
    const p = PRICING_FILES[0]!;
    const want = createHash("sha256").update(readFileSync(`${REPO_ROOT}${p}`, "utf8").replace(/\r\n/g, "\n"), "utf8").digest("hex");
    expect(fileSha256(p)).toBe(want);
  });
  it("commit มาจาก WORKERS_CI_COMMIT_SHA ตอน build บน Cloudflare", () => {
    const m = pricingManifestAtBuild({ WORKERS_CI_COMMIT_SHA: "3f2a9c1e5b7d9f0a2c4e6a8b0d1f3a5c7e9b1d3f" });
    expect(m.commit).toBe("3f2a9c1e5b7d9f0a2c4e6a8b0d1f3a5c7e9b1d3f");
    expect(Object.keys(m.files_sha256)).toEqual([...PRICING_FILES]);
  });
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npx vitest run --root apps/web test/jsonSplice.test.ts test/pricingManifest.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: เขียนโค้ด**

`scripts/pricing-manifest.ts`:
```ts
// scripts/pricing-manifest.ts — รายชื่อไฟล์ตัวคิดราคา + sha256 ที่ E1 รายงานใน `pricing` (สเปก POS 04 §4.4 ข้อ 9 · ADR-0048)
// POS คัดลอกไฟล์ชุดนี้ไป packages/dayo-pricing/src/vendor/ แล้วเทียบกับ VENDOR.json
// sha256 คิดจากเนื้อ UTF-8 หลังแปลง CRLF → LF (checkout บน Windows กับ build บน Linux ได้ค่าเดียวกัน — ทีม POS คิดแบบเดียวกัน)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commitSha, REPO_ROOT } from "./version";

export const PRICING_FILES = [
  "packages/shared/src/cost.ts",
  "packages/shared/src/fmt.ts",
  "packages/shared/src/money.ts",
  "packages/shared/src/promotions.ts",
  "packages/shared/src/shopSettings.ts",
  "packages/shared/src/time.ts",
  "packages/shared/src/types.ts",
] as const;

export interface PricingManifest {
  commit: string;
  files_sha256: Record<string, string>;
}

export function fileSha256(repoPath: string): string {
  const text = readFileSync(`${REPO_ROOT}${repoPath}`, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function pricingManifestAtBuild(env: NodeJS.ProcessEnv = process.env): PricingManifest {
  return {
    commit: commitSha(env) || "dev",
    files_sha256: Object.fromEntries(PRICING_FILES.map((p) => [p, fileSha256(p)])),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(pricingManifestAtBuild(), null, 2));
}
```

`apps/web/next.config.ts` — `env` เพิ่ม `DAYO_PRICING_MANIFEST`:
```ts
import { pricingManifestAtBuild } from "../../scripts/pricing-manifest";
// …
  env: {
    NEXT_PUBLIC_DAYO_VERSION: resolveVersion(),
    // ADR-0048: E1 รายงาน commit + sha256 ของตัวคิดราคาที่ build นี้ใช้ (ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่มีความลับ)
    DAYO_PRICING_MANIFEST: JSON.stringify(pricingManifestAtBuild()),
  },
```

`apps/web/src/lib/api/pricing.ts`:
```ts
import "server-only";

export interface PricingManifest {
  commit: string;
  files_sha256: Record<string, string>;
}

const DEV: PricingManifest = { commit: "dev", files_sha256: {} };

/** manifest ที่ next.config.ts ฝังตอน build (ADR-0048) · ไม่มี/อ่านไม่ได้ = "dev" */
export function pricingManifest(): PricingManifest {
  const raw = process.env.DAYO_PRICING_MANIFEST;
  if (!raw) return DEV;
  try {
    const p = JSON.parse(raw) as Partial<PricingManifest>;
    if (typeof p.commit !== "string" || !p.files_sha256 || typeof p.files_sha256 !== "object") return DEV;
    return { commit: p.commit, files_sha256: p.files_sha256 };
  } catch {
    return DEV;
  }
}
```

`apps/web/src/lib/api/jsonSplice.ts`:
```ts
import "server-only";

// E1 ตอบ ~150–250 KB: ห้าม parse + stringify ใน Worker (CPU 10 ms — กฎเหล็กข้อ 11)
// จึงต่อข้อความ: {"ok":true,"data":{<prefix>,<เนื้อในของวัตถุจาก RPC>}} แบบ stream
const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

export function wrapOkData(prefix: Record<string, unknown>, raw: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const head = JSON.stringify(prefix).slice(0, -1); // `{"pricing":{…}` — ยังไม่ปิดวงเล็บ
  let state: "start" | "afterBrace" | "body" = "start";
  return raw.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(enc.encode(`{"ok":true,"data":${head}`));
      },
      transform(chunk, ctrl) {
        let i = 0;
        if (state === "start") {
          while (i < chunk.length && WS.has(chunk[i]!)) i++;
          if (i >= chunk.length) return;
          if (chunk[i] !== 0x7b) throw new Error("rpc result is not a JSON object");
          i++;
          state = "afterBrace";
        }
        if (state === "afterBrace") {
          while (i < chunk.length && WS.has(chunk[i]!)) i++;
          if (i >= chunk.length) return;
          if (chunk[i] !== 0x7d) ctrl.enqueue(enc.encode(","));
          state = "body";
        }
        ctrl.enqueue(chunk.subarray(i));
      },
      flush(ctrl) {
        if (state !== "body") throw new Error("rpc result is empty");
        ctrl.enqueue(enc.encode("}"));
      },
    }),
  );
}
```

`apps/web/src/lib/api/posCatalog.ts`:
```ts
import "server-only";
import { ApiError } from "./errors";

/** known_version: ไม่ส่ง/ว่าง = null (ขอทั้งก้อน) · ต้องเป็นจำนวนเต็ม ≥ 0 */
export function parseKnownVersion(v: string | null): number | null {
  if (v == null || v === "") return null;
  if (!/^\d{1,15}$/.test(v)) throw new ApiError("DY422", "invalid: known_version ต้องเป็นจำนวนเต็ม ≥ 0");
  return Number(v);
}
```

`apps/web/src/app/api/v1/pos/catalog/route.ts`:
```ts
import { authenticate } from "@/lib/api/auth";
import { apiPreflight } from "@/lib/api/cors";
import { ApiError } from "@/lib/api/errors";
import { wrapOkData } from "@/lib/api/jsonSplice";
import { parseKnownVersion } from "@/lib/api/posCatalog";
import { pricingManifest } from "@/lib/api/pricing";
import { apiHandler } from "@/lib/api/response";
import { rpcRawStream } from "@/lib/db";

// GET /v1/pos/catalog?known_version= — แคตตาล็อก + พนักงาน + ฉบับ (สเปก POS 04 §4.4 · ADR-0048) · scope catalog:read + staff:read
export async function GET(req: Request): Promise<Response> {
  return apiHandler(req, async () => {
    const actor = await authenticate(req, "catalog:read");
    if (!actor.scopes.includes("staff:read")) {
      throw new ApiError("DY403", "forbidden: API key ไม่มีสิทธิ์ staff:read");
    }
    const known = parseKnownVersion(new URL(req.url).searchParams.get("known_version"));
    const raw = await rpcRawStream("api_pos_catalog", {
      p_shop_id: actor.shopId,
      p_api_client_id: actor.apiClientId,
      p_known_version: known,
    });
    return new Response(wrapOkData({ pricing: pricingManifest() }, raw), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  });
}

export function OPTIONS(req: Request): Response {
  return apiPreflight(req);
}
```

- [ ] **Step 4: รันให้ผ่าน (+ fixture E1 ทั้ง 3 ไฟล์ + err-401/429/500)**

Run: `npx vitest run --root apps/web test/jsonSplice.test.ts test/pricingManifest.test.ts test/api.posContract.test.ts && npm run typecheck -w @dayo/web`
Expected: PASS · fixture `e1-*` และ `err-401-invalid-key` `err-429-rate-limited` `err-500-rpc-unreachable` `preflight-disallowed-origin` ผ่าน (fixture `/pos/push` ยัง SKIP · E3 ยัง FAIL)

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add scripts/pricing-manifest.ts apps/web/next.config.ts apps/web/src/lib/api/pricing.ts apps/web/src/lib/api/jsonSplice.ts apps/web/src/lib/api/posCatalog.ts apps/web/src/app/api/v1/pos/catalog/route.ts apps/web/test/jsonSplice.test.ts apps/web/test/pricingManifest.test.ts
git commit -m "feat(web): add the pos catalog endpoint with pricing manifest"
```

---

## Task 8: E2 `POST /v1/pos/push`

**agent:** web-developer · sonnet · medium (lane B)

**Files:**
- Create: `apps/web/src/lib/api/posPush.ts`, `apps/web/src/app/api/v1/pos/push/route.ts`, `apps/web/test/api.posPush.test.ts`

**Interfaces:**
- Consumes: `api_pos_push(p_shop_id, p_api_client_id, p_scopes, p_rows)` (Task 3b) · `authenticate(req, scope?)` · `apiHandler`/`apiPreflight`
- Produces: `PUSH_MAX_ROWS = 20` · `PUSH_MAX_BYTES = 262144` · `POS_PUSH_SCOPES = ["orders:write"]` · `readPushEnvelope(req: Request): Promise<{ device_time: string | null; rows: unknown[] }>` · `interface PosPushResult { server_time: string; results: Array<{ key: string; status: string; reason?: string; detail?: string; data?: unknown }> }`

- [ ] **Step 1: เขียนเทสต์ที่ต้องตก** — `apps/web/test/api.posPush.test.ts`

```ts
// api.posPush.test.ts — ตรวจซองของ E2 ที่ชั้นเว็บ (ก่อนเรียก RPC) + ไม่ log body
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const scopes = { value: ["orders:write"] as string[] };

vi.mock("../src/lib/platform", () => ({
  getEnv: () => ({ API_V1_ENABLED: "1", DAYO_SHOP_ID: "s1" }),
  isApiV1Enabled: () => true,
  posOrigins: () => [],
}));
vi.mock("../src/lib/db", () => {
  class RpcError extends Error { constructor(public code: string, message: string) { super(message); } }
  return {
    RpcError,
    shopId: () => "s1",
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "api_authenticate") return { ok: true, api_client_id: "c1", shop_id: "s1", scopes: scopes.value };
      return { server_time: "2026-09-25T03:15:04.010+00:00", results: [{ key: "order:x", status: "deferred", reason: "SERVER_ERROR", detail: "SQLSTATE XX000" }] };
    },
  };
});

const { POST } = await import("../src/app/api/v1/pos/push/route");
const post = (body: string, headers: Record<string, string> = {}) =>
  POST(new Request("https://x/api/v1/pos/push", { method: "POST", body, headers: { Authorization: "Bearer k", "Content-Type": "application/json", ...headers } }));

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  rpcCalls.length = 0;
  scopes.value = ["orders:write"];
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /v1/pos/push ซอง", () => {
  it("ไม่ใช่ JSON / rows ว่าง / 21 แถว / เกิน 256 KB → 422 ไม่เรียก api_pos_push", async () => {
    for (const body of ["{", JSON.stringify({ rows: [] }), JSON.stringify({ rows: Array.from({ length: 21 }, () => ({})) }),
                        JSON.stringify({ rows: [{ key: "x".repeat(262_200) }] })]) {
      const res = await post(body);
      expect(res.status).toBe(422);
    }
    expect(rpcCalls.filter((c) => c.fn === "api_pos_push")).toHaveLength(0);
  });
  it("key ไม่มี scope ใดของ endpoint → 403 ทั้งคำขอ", async () => {
    scopes.value = ["catalog:read"];
    expect((await post(JSON.stringify({ rows: [{}] }))).status).toBe(403);
  });
  it("ส่งต่อ rows + scopes ให้ RPC ก้อนเดียว · SERVER_ERROR ของแถว log เฉพาะ detail (ไม่ log body) · HTTP 200", async () => {
    const res = await post(JSON.stringify({ device_time: "2026-09-25T03:15:03.500Z", rows: [{ key: "order:x", kind: "order", data: { note: "SECRET" } }] }));
    expect(res.status).toBe(200);
    const call = rpcCalls.find((c) => c.fn === "api_pos_push")!;
    expect(call.args).toMatchObject({ p_shop_id: "s1", p_api_client_id: "c1", p_scopes: ["orders:write"] });
    expect(JSON.stringify(errSpy.mock.calls)).toContain("SQLSTATE XX000");
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain("SECRET");
  });
  it("แถวที่มี U+0000 / surrogate เดี่ยว = rejected INVALID ของแถวนั้น · แถวอื่นส่ง RPC · ลำดับคำตอบตรงกับ rows · HTTP 200", async () => {
    const res = await post(JSON.stringify({ rows: [
      { key: "order:bad", kind: "order", data: { note: "a\u0000b" } },
      { key: "order:x", kind: "order", data: {} },
      { key: "order:bad2", kind: "order", data: { note: "\ud800" } },
    ] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { results: Array<{ key: string; status: string; reason?: string }> } };
    expect(body.data.results.map((r) => [r.key, r.status, r.reason])).toEqual([
      ["order:bad", "rejected", "INVALID"], ["order:x", "deferred", "SERVER_ERROR"], ["order:bad2", "rejected", "INVALID"]]);
    const call = rpcCalls.find((c) => c.fn === "api_pos_push")!;
    expect((call.args.p_rows as unknown[]).length).toBe(1);
  });
  it("ทุกแถวไม่ปลอดภัย → ไม่เรียก RPC แต่ยังตอบ 200 พร้อมคำตัดสินครบ", async () => {
    const res = await post(JSON.stringify({ rows: [{ key: "order:bad", kind: "order", data: { note: "\u0000" } }] }));
    expect(res.status).toBe(200);
    expect(rpcCalls.filter((c) => c.fn === "api_pos_push")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npx vitest run --root apps/web test/api.posPush.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: เขียนโค้ด**

`apps/web/src/lib/api/posPush.ts`:
```ts
import "server-only";
import { ApiError } from "./errors";

// ซองของ E2 (สเปก POS 04 §4.5): ≤ 20 แถว · body ≤ 256 KB · ปัญหาในแถวเป็นคำตัดสินของแถว (RPC) ไม่ใช่ 422
export const PUSH_MAX_ROWS = 20;
export const PUSH_MAX_BYTES = 256 * 1024;
/** scope ที่ endpoint นี้ใช้ — ก้อน 3/4/6 เพิ่ม shift:write / expense:write / payroll:write */
export const POS_PUSH_SCOPES = ["orders:write"] as const;

export interface PosPushResult {
  server_time: string;
  results: Array<{ key: string; status: string; reason?: string; detail?: string; data?: unknown }>;
}

export async function readPushEnvelope(req: Request): Promise<{ device_time: string | null; rows: unknown[] }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > PUSH_MAX_BYTES) throw new ApiError("DY422", "too_large: body ต้องไม่เกิน 256 KB");
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > PUSH_MAX_BYTES) throw new ApiError("DY422", "too_large: body ต้องไม่เกิน 256 KB");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError("DY422", "invalid: body ต้องเป็น JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError("DY422", "invalid: body ต้องเป็น object");
  const rows = (body as { rows?: unknown }).rows;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > PUSH_MAX_ROWS) {
    throw new ApiError("DY422", "invalid: rows ต้องเป็นรายการ 1–20 แถว");
  }
  const dt = (body as { device_time?: unknown }).device_time;
  return { device_time: typeof dt === "string" ? dt : null, rows };
}

// Postgres แปลงข้อความที่มี U+0000 หรือ surrogate เดี่ยวเป็น jsonb ไม่ได้ (22P05 ที่ชั้น PostgREST = ทั้งคำขอล้ม)
// → แยกแถวแบบนี้ออกเป็นคำตัดสิน rejected INVALID ของแถวนั้นที่ชั้นเว็บ แล้วส่งแถวที่เหลือให้ RPC (สเปก §4.5: ปัญหาในแถว = คำตัดสินของแถว)
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const LONE_SURROGATE_G = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function hasUnsafeText(v: unknown): boolean {
  if (typeof v === "string") return v.includes("\u0000") || LONE_SURROGATE.test(v);
  if (Array.isArray(v)) return v.some(hasUnsafeText);
  if (v && typeof v === "object") return Object.entries(v).some(([k, x]) => hasUnsafeText(k) || hasUnsafeText(x));
  return false;
}

export type RowVerdict = PosPushResult["results"][number];

function echoKey(row: unknown): string {
  const k = row && typeof row === "object" ? (row as { key?: unknown }).key : undefined;
  if (typeof k !== "string") return "";
  return [...k.replace(/\u0000/g, "").replace(LONE_SURROGATE_G, "�")].slice(0, 200).join("");
}

export function splitUnsafeRows(rows: unknown[]): { safe: unknown[]; local: Map<number, RowVerdict> } {
  const safe: unknown[] = [];
  const local = new Map<number, RowVerdict>();
  rows.forEach((row, i) => {
    if (hasUnsafeText(row)) {
      local.set(i, { key: echoKey(row), status: "rejected", reason: "INVALID", detail: "ข้อความมีอักขระที่ระบบกลางรับไม่ได้ (U+0000 หรือ surrogate เดี่ยว)" });
    } else {
      safe.push(row);
    }
  });
  return { safe, local };
}

/** รวมคำตัดสินกลับตามลำดับ rows เดิม (results เรียงตรงกับ rows และจำนวนเท่ากันเสมอ) */
export function mergeVerdicts(total: number, local: Map<number, RowVerdict>, remote: RowVerdict[]): RowVerdict[] {
  const out: RowVerdict[] = [];
  let r = 0;
  for (let i = 0; i < total; i++) out.push(local.get(i) ?? remote[r++]!);
  return out;
}
```

`apps/web/src/app/api/v1/pos/push/route.ts`:
```ts
import { authenticate } from "@/lib/api/auth";
import { apiPreflight } from "@/lib/api/cors";
import { ApiError } from "@/lib/api/errors";
import { mergeVerdicts, POS_PUSH_SCOPES, readPushEnvelope, splitUnsafeRows } from "@/lib/api/posPush";
import type { PosPushResult } from "@/lib/api/posPush";
import { apiHandler, apiOk } from "@/lib/api/response";
import { rpc } from "@/lib/db";

// POST /v1/pos/push — แถวจากแท็บเล็ต คำตัดสินรายแถว (สเปก POS 04 §4.5 · ADR-0049) · ห้าม log body
export async function POST(req: Request): Promise<Response> {
  return apiHandler(req, async () => {
    const actor = await authenticate(req);
    if (!POS_PUSH_SCOPES.some((s) => actor.scopes.includes(s))) {
      throw new ApiError("DY403", "forbidden: API key ไม่มีสิทธิ์ส่งข้อมูล (orders:write)");
    }
    const envelope = await readPushEnvelope(req);
    const { safe, local } = splitUnsafeRows(envelope.rows);
    const remote: PosPushResult = safe.length
      ? await rpc<PosPushResult>("api_pos_push", {
          p_shop_id: actor.shopId,
          p_api_client_id: actor.apiClientId,
          p_scopes: actor.scopes,
          p_rows: safe,
        })
      : { server_time: new Date().toISOString().replace("Z", "+00:00"), results: [] };
    const data: PosPushResult = { server_time: remote.server_time, results: mergeVerdicts(envelope.rows.length, local, remote.results) };
    for (const r of data.results) {
      // error ที่ไม่ได้แผนที่ของแถว → ช่องระบบ Discord ผ่าน console.error (ADR-0044) · detail = SQLSTATE เท่านั้น
      if (r.status === "deferred" && r.reason === "SERVER_ERROR") console.error("api/v1 pos push row error", r.detail ?? "");
    }
    return apiOk(data);
  });
}

export function OPTIONS(req: Request): Response {
  return apiPreflight(req);
}
```

- [ ] **Step 4: รันให้ผ่าน (+ fixture E2 ทั้งหมด)**

Run: `npx vitest run --root apps/web test/api.posPush.test.ts test/api.posContract.test.ts && npm run typecheck -w @dayo/web`
Expected: PASS · fixture `e2-*` `err-404-api-disabled` `preflight-allowed-api-off` ผ่าน (เหลือ E3 FAIL จนถึง Task 9)

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add apps/web/src/lib/api/posPush.ts apps/web/src/app/api/v1/pos/push/route.ts apps/web/test/api.posPush.test.ts
git commit -m "feat(web): add the pos push endpoint"
```

---

## Task 9: E3 `GET /v1/orders` ฟิลด์ใหม่ (ผ่าน `api_list_orders`)

**agent:** web-developer · sonnet · medium (lane B)

**Files:**
- Modify: `apps/web/src/lib/api/orders.ts` (`listApiOrders`)
- Modify: `apps/web/test/api.orders.test.ts` (ส่วนที่ mock `db().from("orders")` ของ `listApiOrders`)

**Interfaces:**
- Consumes: `api_list_orders(p_shop_id uuid, p_from date, p_to date, p_updated_since timestamptz) → jsonb[]` (Task 4)
- Produces: `listApiOrders(shopId: string, params: ListOrdersParams): Promise<Record<string, unknown>[]>` (ลายเซ็นเดิม)

- [ ] **Step 1: แก้เทสต์เดิมให้คาดการเรียก RPC (ต้องตก)** — ใน `apps/web/test/api.orders.test.ts` แทนเคสของ `GET /v1/orders` ที่ mock query builder ด้วย:
```ts
it("GET /v1/orders เรียก RPC api_list_orders ก้อนเดียวด้วยพารามิเตอร์ที่ส่งมา (ว่าง = null)", async () => {
  // rpcMock คือ mock ของ rpc ในไฟล์นี้ — คืนอาร์เรย์บิลรูป E3 (ดู fixture e3-orders-today.json)
  rpcMock.mockResolvedValueOnce({ ok: true, api_client_id: "c1", shop_id: "s1", scopes: ["orders:read"] });
  rpcMock.mockResolvedValueOnce([{ order_no: "L260925-014", source: "pos", pos_receipt_no: "A-000312" }]);
  const res = await GET(new Request("https://x/api/v1/orders?from=2026-09-25", { headers: { Authorization: "Bearer k" } }));
  expect(res.status).toBe(200);
  expect(rpcMock).toHaveBeenLastCalledWith("api_list_orders", { p_shop_id: "s1", p_from: "2026-09-25", p_to: null, p_updated_since: null });
});
```
(ถ้าไฟล์เดิมไม่มี `rpcMock` ให้ประกาศ `const rpcMock = vi.fn()` แล้วให้ `vi.mock("../src/lib/db", …)` คืน `rpc: rpcMock`)

- [ ] **Step 2: รันให้ตก**

Run: `npx vitest run --root apps/web test/api.orders.test.ts`
Expected: FAIL — `listApiOrders` ยังเรียก `db().from`

- [ ] **Step 3: เขียนโค้ด** — แทนเนื้อใน `listApiOrders` ทั้งหมด:
```ts
// ── GET /v1/orders?from=&to=&updated_since= (orders:read) — ไม่มีต้นทุน/กำไร · ฟิลด์ใหม่ของ POS (สเปก POS 04 §4.6 · ADR-0049)
export async function listApiOrders(shopId: string, params: ListOrdersParams): Promise<Record<string, unknown>[]> {
  return rpc<Record<string, unknown>[]>("api_list_orders", {
    p_shop_id: shopId,
    p_from: params.from || null,
    p_to: params.to || null,
    p_updated_since: params.updatedSince || null,
  });
}
```
(ลบ import ที่ไม่ใช้แล้ว เช่น `db` ถ้าไฟล์ไม่ใช้ที่อื่น — ตรวจด้วย `npm run lint -w @dayo/web`) · ใน `apps/web/test/api.posContract.test.ts` ลบบรรทัด `const PENDING = …` และแก้เงื่อนไข skip เป็น `it.skipIf(!existsSync(routeFile(url.pathname)))`

- [ ] **Step 4: รันให้ผ่าน — fixture ครบ 22 ไฟล์**

Run: `npx vitest run --root apps/web && npm run typecheck -w @dayo/web`
Expected: PASS ทั้งหมด · `api.posContract.test.ts` ผ่าน 22/22 ไม่มี SKIP

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add apps/web/src/lib/api/orders.ts apps/web/test/api.orders.test.ts apps/web/test/api.posContract.test.ts
git commit -m "feat(web): return pos receipt, queue, actor and duplicate flag in the orders api"
```

---

## Task 10: หน้าเว็บ — QR ของคีย์ · scope `staff:read` · แหล่ง/ผู้บันทึก · บิล POS อ่านอย่างเดียว · แดชบอร์ดธงซ้ำ/ส่วนต่าง

**agent:** web-developer · sonnet · medium (lane B)

**Files:**
- Create: `apps/web/src/lib/billSource.ts`, `apps/web/src/lib/keyQr.ts`, `apps/web/test/billSource.test.ts`, `apps/web/test/keyQr.test.ts`
- Modify: `apps/web/package.json` (+ `qrcode-generator` ^1.4.4 — MIT ไม่มี dependency ต่อ) · `package-lock.json`
- Modify: `apps/web/src/lib/apiScopes.ts` · `apps/web/src/app/(staff)/settings/api-clients/*` (ตัวที่แสดงคีย์ครั้งเดียว + ป้าย scope)
- Modify: `apps/web/src/app/(staff)/sales/SalesListClient.tsx`, `sales/_shared.tsx`, `sales/[order_no]/OrderDetailClient.tsx`, `sales/[order_no]/actions.ts`
- Modify: `apps/web/src/lib/dashboard.ts`, `apps/web/src/app/(staff)/dashboard/OwnerDashboardClient.tsx`, `dashboard/page.tsx` (+ server action ปิดธง)

**Interfaces:**
- Consumes: `get_order` (`read_only_pos`, `pos_receipt_no`, `pos_queue_no`, `duplicate_of`) · `list_orders` (`pos_receipt_no`, `duplicate_suspect`) · `dashboard_duplicate_flags` · `resolve_duplicate_flag` · `dashboard_pos_diffs` (Task 4) · `pricingManifest()` (Task 7)
- Produces:
  - `sourceLabel(source: string): string` — `pos`→"แท็บเล็ต" · `line`→"บอท" · `web`→"เว็บ"
  - `billOriginText(b: { source: string; created_by_name?: string | null; pos_receipt_no?: string | null; pos_queue_no?: number | null }): string`
  - `canEditBill(b: { source: string }): boolean`
  - `keyQrSvg(key: string): string`
  - `getDuplicateFlags(staffId: string)` · `resolveDuplicateFlag(staffId: string, flagId: string, note: string)` · `getPosDiffs(staffId: string, from: string, to: string)` ใน `lib/dashboard.ts`

- [ ] **Step 1: เขียนเทสต์ที่ต้องตก**

`apps/web/test/billSource.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { billOriginText, canEditBill, sourceLabel } from "../src/lib/billSource";

describe("แหล่ง · ผู้บันทึก (ADR-0049)", () => {
  it("ป้ายแหล่ง", () => {
    expect(sourceLabel("pos")).toBe("แท็บเล็ต");
    expect(sourceLabel("line")).toBe("บอท");
    expect(sourceLabel("web")).toBe("เว็บ");
  });
  it("บิล POS มีใบเสร็จ + คิว · บิลบอทไม่มี · ไม่มีชื่อ = ไม่ระบุ", () => {
    expect(billOriginText({ source: "pos", created_by_name: "DCm", pos_receipt_no: "A-000312", pos_queue_no: 12 }))
      .toBe("แท็บเล็ต · DCm · ใบเสร็จ A-000312 · คิว 12");
    expect(billOriginText({ source: "line", created_by_name: "TungAo" })).toBe("บอท · TungAo");
    expect(billOriginText({ source: "web", created_by_name: null })).toBe("เว็บ · ไม่ระบุ");
  });
  it("บิล POS แก้/ยกเลิกบนเว็บไม่ได้", () => {
    expect(canEditBill({ source: "pos" })).toBe(false);
    expect(canEditBill({ source: "line" })).toBe(true);
  });
});
```

`apps/web/test/keyQr.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { keyQrSvg } from "../src/lib/keyQr";

describe("QR ของ API key (ADR-0048) — สร้างในเครื่อง ไม่ส่งคีย์ไปที่อื่น", () => {
  it("คืน SVG และไม่มีข้อความคีย์ตรง ๆ ใน markup", () => {
    const svg = keyQrSvg("dayo_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("dayo_ABCDEFGHIJ");
  });
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npx vitest run --root apps/web test/billSource.test.ts test/keyQr.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: เขียนโค้ด**

ติดตั้ง: `npm install qrcode-generator@^1.4.4 -w @dayo/web`

`apps/web/src/lib/billSource.ts`:
```ts
// แหล่งและผู้บันทึกของบิล (ADR-0049 · GLOSSARY "แหล่ง") — ค่าในฐาน pos/line/web ไม่เปลี่ยนชื่อ แสดงผลเป็นคำไทย
export function sourceLabel(source: string): string {
  if (source === "pos") return "แท็บเล็ต";
  if (source === "line") return "บอท";
  if (source === "web") return "เว็บ";
  return source;
}

export function billOriginText(b: {
  source: string;
  created_by_name?: string | null;
  pos_receipt_no?: string | null;
  pos_queue_no?: number | null;
}): string {
  const who = b.created_by_name?.trim() || "ไม่ระบุ";
  const base = `${sourceLabel(b.source)} · ${who}`;
  if (b.source !== "pos" || !b.pos_receipt_no) return base;
  return `${base} · ใบเสร็จ ${b.pos_receipt_no}${b.pos_queue_no ? ` · คิว ${b.pos_queue_no}` : ""}`;
}

/** บิลจากแท็บเล็ตมีผู้เขียนคนเดียว — แก้/ยกเลิกบนเว็บไม่ได้แม้ owner (RPC ตอบ DY403 pos_bill_read_only อีกชั้น) */
export function canEditBill(b: { source: string }): boolean {
  return b.source !== "pos";
}
```

`apps/web/src/lib/keyQr.ts`:
```ts
import qrcode from "qrcode-generator";

/** QR ของ API key ให้แท็บเล็ตสแกน (ADR-0048) — สร้างในเบราว์เซอร์/เซิร์ฟเวอร์ของเราเอง ไม่ส่งคีย์ไปบริการอื่น */
export function keyQrSvg(key: string): string {
  const qr = qrcode(0, "M");
  qr.addData(key);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
```

`apps/web/src/lib/apiScopes.ts`:
```ts
export const API_SCOPES = ["catalog:read", "staff:read", "orders:read", "orders:write", "stock:read", "stock:write"] as const;
```
และในไฟล์ UI ที่แสดงป้าย scope (หาด้วย `grep -rn "API_SCOPES\|catalog:read" apps/web/src/app/(staff)/settings/api-clients`) เพิ่มป้าย `"staff:read": "อ่านรายชื่อพนักงาน (แท็บเล็ต POS)"`

หน้า `/settings/api-clients` ตรงที่แสดงคีย์ครั้งเดียวหลังสร้าง: ใต้ข้อความคีย์เพิ่ม
```tsx
<div className="mt-3 w-48" aria-label="QR ของ API key ให้แท็บเล็ตสแกน" dangerouslySetInnerHTML={{ __html: keyQrSvg(newKey) }} />
<p className="text-sm">สแกน QR นี้ที่หน้าตั้งค่าเครื่องของแท็บเล็ต — แสดงครั้งเดียวค่ะ</p>
```
(`newKey` = ตัวแปรเดิมที่เก็บคีย์ที่เพิ่งสร้าง · SVG มาจาก `qrcode-generator` ในเครื่อง ข้อมูลเป็นอักขระของคีย์เท่านั้น)

หน้าขาย:
- `SalesListClient.tsx` / `_shared.tsx`: บรรทัดรองของแต่ละบิลใช้ `billOriginText(order)` · บิลที่ `duplicate_suspect` แสดงป้าย "⚠ อาจซ้ำ"
- `OrderDetailClient.tsx`: แสดง `billOriginText(order)` ใต้เลขบิล · ถ้า `order.duplicate_of.length > 0` แสดง "⚠ อาจซ้ำกับบิล L… (แหล่งอื่น)" · ปุ่ม "แก้บิล" และ "✖ ยกเลิกบิล" แสดงเมื่อ `canEditBill(order)` เท่านั้น · บิล POS แสดงข้อความ "บิลจากแท็บเล็ต — แก้หรือยกเลิกได้ที่แท็บเล็ตเท่านั้นค่ะ"
- `sales/[order_no]/actions.ts`: ก่อนเรียก `update_order`/`cancel_order` ถ้า `order.read_only_pos` ให้คืนข้อความเดียวกันโดยไม่เรียก RPC (RPC ยังกันอีกชั้น)

แดชบอร์ด owner:
- `lib/dashboard.ts` เพิ่ม:
```ts
export async function getDuplicateFlags(staffId: string) {
  return rpc<Array<{ id: string; detected_at: string; a: BillBrief; b: BillBrief }>>("dashboard_duplicate_flags", { p_shop_id: shopId(), p_staff_id: staffId });
}
export async function resolveDuplicateFlag(staffId: string, flagId: string, note: string) {
  return rpc<{ ok: boolean }>("resolve_duplicate_flag", { p_shop_id: shopId(), p_staff_id: staffId, p_flag_id: flagId, p_note: note });
}
export async function getPosDiffs(staffId: string, from: string, to: string) {
  return rpc<PosDiff[]>("dashboard_pos_diffs", { p_shop_id: shopId(), p_from: from, p_to: to, p_staff_id: staffId });
}
export interface BillBrief { order_no: string; source: string; created_by_name: string | null; sold_at: string | null; total: number; status: string; pos_receipt_no: string | null }
export interface PosDiff { order_no: string; pos_receipt_no: string; sale_date: string; total: number; computed_total: number; diff: number; amount_mismatch: boolean; small_diff: boolean; catalog_version: number | null; server_catalog_version: number | null }
```
- `OwnerDashboardClient.tsx` เพิ่ม 2 การ์ด:
  1. **"บิลที่อาจซ้ำ (N)"** — คู่ละแถว: `billOriginText(a)` ยอด เวลา ↔ `billOriginText(b)` · ปุ่ม **"ไม่ซ้ำ"** เปิดช่องหมายเหตุ (บังคับ 1–200) → server action `requireRole('owner')` → `resolveDuplicateFlag` · ข้อความแนะนำ "ถ้าซ้ำจริง ให้ยกเลิกบิลฝั่งบอท/เว็บ (บิลแท็บเล็ตยกเลิกที่แท็บเล็ตในวันขายเท่านั้น)"
  2. **"บิลแท็บเล็ตที่ยอดไม่ตรงระบบกลาง"** (ช่วงวันเดียวกับแดชบอร์ด) — แยกกลุ่ม "ต่างเล็กน้อย (≤ ฿1)" (`small_diff && !amount_mismatch`) กับ "`amount_mismatch` (> ฿1)" · คอลัมน์: ใบเสร็จ · ยอดเก็บจริง · ยอดที่ระบบคิด · ส่วนต่าง · ฉบับเมนูในเครื่อง (`catalog_version`) เทียบฉบับระบบ ณ ตอนบิลเข้า (`server_catalog_version`) — ไม่เท่ากันแสดง "เมนูในเครื่องเก่า" · หัวการ์ดแสดง "ตัวคิดราคาของระบบกลาง: `pricingManifest().commit` 7 ตัวแรก" (อ่านฝั่งเซิร์ฟเวอร์ใน `dashboard/page.tsx` แล้วส่งเป็น prop)

- [ ] **Step 4: รันให้ผ่าน + ci ของเว็บ**

Run: `npm run ci -w @dayo/web`
Expected: typecheck + test + build ผ่าน

- [ ] **Step 5: ลองด้วยมือ (dev + Supabase local หลัง lane A merge)** — `npm run dev:web` → ล็อกอินด้วย `/auth/e2e-login` (E2E=1 ในเครื่อง) → สร้างคีย์ใหม่เห็น QR · หน้าขายเห็น "แท็บเล็ต · … · ใบเสร็จ …" และไม่มีปุ่มแก้/ยกเลิกของบิล POS · แดชบอร์ดเห็นธงซ้ำและปุ่ม "ไม่ซ้ำ" ทำงาน

- [ ] **Step 6: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add apps/web/package.json package-lock.json apps/web/src/lib/billSource.ts apps/web/src/lib/keyQr.ts apps/web/src/lib/apiScopes.ts apps/web/src/lib/dashboard.ts "apps/web/src/app/(staff)/settings/api-clients" "apps/web/src/app/(staff)/sales" "apps/web/src/app/(staff)/dashboard" apps/web/test/billSource.test.ts apps/web/test/keyQr.test.ts
git commit -m "feat(web): show bill source and actor, lock pos bills, add duplicate flag dashboard and key qr"
```

---

## Task 11: ตรวจชุด parity แบบไม่ใช้ฐานข้อมูล (เทสต์บริสุทธิ์ของ `posParity.ts`)

**agent:** shared-logic-engineer · sonnet · high (lane C · ไม่ใช้ Docker · เริ่มหลัง merge Task 1)

ไฟล์ `packages/shared/test/db/posParity.ts` เป็นของ Task 1 คนเดียว — task นี้ **ไม่สร้าง/ไม่แก้ไฟล์นั้น** (ถ้าเจอชื่อฟิลด์ไม่ตรง `types.ts` ให้รายงานหัวหน้าเพื่อส่งกลับ lane A) · งานสำรอง (เดิมอยู่ที่นี่) ย้ายไป Task 14 เป็น `scripts/backup/backup-tool.mjs` ที่ไม่มี dependency

**Files:**
- Create: `packages/shared/test/posParity.test.ts`

**Interfaces:**
- Consumes: `posParityCatalogPayload` `POS_PARITY_CASES` `POS_PARITY_SHOP_SETTINGS` `toSqlDraft` `moneyFromShared` `ParityCtx` (Task 1 Step 0) · `computeOrder` `OrderCatalog` `QuoteResult` (`packages/shared/src`)
- Produces: การยืนยันว่า `posParity.ts` ใช้ชื่อฟิลด์ตรง `types.ts` และทุกเคสสมบูรณ์ (Task 13 และแผน 07 ของ POS พึ่งไฟล์นี้)

- [ ] **Step 1: เขียนเทสต์** — `packages/shared/test/posParity.test.ts`
```ts
// posParity.test.ts — ตรวจชุด parity ของ POS โดยไม่ใช้ฐานข้อมูล (สเปก POS 04 §5.3)
// ฐานข้อมูลจริงตรวจใน test/db/pos_parity.db.test.ts (Task 13) · ที่นี่จับชื่อฟิลด์ผิด/เคสไม่สมบูรณ์ตั้งแต่ CI
import { describe, expect, it } from "vitest";
import { computeOrder } from "../src/money";
import type { OrderCatalog } from "../src/types";
import { moneyFromShared, POS_PARITY_CASES, POS_PARITY_SHOP_SETTINGS, posParityCatalogPayload, toSqlDraft } from "./db/posParity";
import type { ParityCtx } from "./db/posParity";

const payload = posParityCatalogPayload();
const promoCodes = payload.promotions.map((p) => p.code);
const ctx: ParityCtx = {
  promoId: (c) => `id-${c}`,
  allPromoIds: promoCodes.map((c) => `id-${c}`),
  onlyPromos: (...codes) => promoCodes.filter((c) => !codes.includes(c)).map((c) => `id-${c}`),
};

describe("posParity.ts", () => {
  it("มี 33 เคส · id ไม่ซ้ำ · ครอบ §5.3 ข้อ 1–13", () => {
    expect(POS_PARITY_CASES).toHaveLength(33);
    const ids = POS_PARITY_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let n = 1; n <= 13; n++) expect(ids.some((id) => id.startsWith(String(n).padStart(2, "0")))).toBe(true);
  });

  it("ทุกเคสมี saleTime (HH:MM) · ทุกบรรทัดมี milk · มัตจะมี grade · เมนูอื่นไม่มี grade", () => {
    for (const c of POS_PARITY_CASES) {
      const d = c.draft(ctx);
      expect(d.saleTime, c.id).toMatch(/^\d{2}:\d{2}$/);
      for (const l of d.lines) {
        expect(["fresh", "oat"], c.id).toContain(l.milk);
        if (l.code === "Matcha Latte") expect(l.grade, c.id).toBeTruthy();
        else expect(l.grade ?? null, c.id).toBeNull();
      }
    }
  });

  it("toSqlDraft ส่ง sale_time และ skip_promotions ครบ · sqlExtra ทับได้", () => {
    const c = POS_PARITY_CASES.find((x) => x.id === "08-no-promotions")!;
    const sql = toSqlDraft(c.draft(ctx), c.sqlExtra);
    expect(sql).toMatchObject({ sale_time: "10:00", no_promotions: true, skip_promotions: [] });
  });

  it("รหัสที่เคสใช้มีในแคตตาล็อกทั้งหมด (เมนู/ขนาด-ความหวาน/ช่องทาง/วิธีชำระ/โปร)", () => {
    const variants = new Set(payload.variants.map((v) => `${v.menuCode}|${v.size}|${v.sweetness}`));
    const channels = new Set(payload.salesChannels.map((c) => c.code));
    const pays = new Set(payload.paymentMethods.map((p) => p.code));
    for (const c of POS_PARITY_CASES) {
      const d = c.draft(ctx);
      expect(channels.has(d.channelCode), c.id).toBe(true);
      expect(pays.has(d.paymentCode!), c.id).toBe(true);
      for (const l of d.lines) expect(variants.has(`${l.code}|${l.size}|${l.sweetness}`), `${c.id} ${l.code}`).toBe(true);
    }
    expect(POS_PARITY_SHOP_SETTINGS.default_milk).toBe("oat");
  });

  it("moneyFromShared อ่านชื่อฟิลด์ของ QuoteResult ได้จริง (แคตตาล็อกจำลองขั้นต่ำ)", () => {
    const catalog: OrderCatalog = {
      settings: { defaultMilk: "fresh" },
      variants: [{ menuCode: "Thai Tea", menuNameTh: "ชาไทย", family: "ชาไทย", size: "16 oz", sweetness: "50%", price: 35,
                   allowOatMilk: false, isMatcha: false, recipeLines: [] }],
      ingredients: {}, bases: {}, milkOptions: [], gradeOptions: [],
      channels: [{ code: "store", name: "หน้าร้าน", aliases: [], priceMarkupPct: 0, priceAddBaht: 0, rounding: "none", feePct: 0, defaultPaymentMethodCode: "cash" }],
      paymentMethods: [{ code: "cash", name: "เงินสด", aliases: [] }], promotions: [],
    } as unknown as OrderCatalog;
    const m = moneyFromShared(computeOrder({ saleDate: "2026-09-24", saleTime: "10:00", channelCode: "store", paymentCode: "cash",
      lines: [{ code: "Thai Tea", size: "16 oz", sweetness: "50%", qty: 2, milk: "fresh", grade: null }], skipPromotionIds: [] }, catalog));
    expect(m).toMatchObject({ ok: true, itemsSubtotal: 70, totalAmount: 70, channelFeeAmount: 0 });
    expect(m.lines).toEqual([{ lineNo: 1, unitPrice: 35, discountPerCup: 0, lineTotal: 70 }]);
  });
});
```

- [ ] **Step 2: รัน**

Run: `npx vitest run --root packages/shared test/posParity.test.ts && npm run typecheck -w @dayo/shared`
Expected: PASS · ถ้าตก = ชื่อฟิลด์ใน `posParity.ts` ไม่ตรง `types.ts` หรือเคสไม่สมบูรณ์ → **ไม่แก้ `posParity.ts` เอง** รายงานหัวหน้าให้ lane A แก้ แล้วรันซ้ำ (ถ้าชนิดของ `OrderCatalog` ในเทสต์ข้อสุดท้ายต้องการฟิลด์เพิ่ม ให้เติมในเทสต์นี้ได้)

- [ ] **Step 3: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add packages/shared/test/posParity.test.ts
git commit -m "test(shared): check the pos parity cases without a database"
```

---

## Task 12: บอท — ธงซ้ำใน "ยอดวันนี้" · แหล่ง/ผู้บันทึกในบิลล่าสุด · flow แก้บิลข้ามบิล POS

**agent:** bot-developer · sonnet · medium (lane D · ไม่ใช้ Docker)

**Files:**
- Create: `apps/line-bot/src/posBills.ts`, `apps/line-bot/test/posBills.test.ts`
- Modify: `apps/line-bot/src/commands.ts` (`cmdSummary` owner, `cmdRecent`), `apps/line-bot/src/line/flex.ts` (`buildSummaryOwnerCard`, `buildRecentCard`), `apps/line-bot/src/flowEngine.ts` (ตัวโหลด `recentOrders` ของ flow `edit`)

**Interfaces:**
- Consumes: `duplicate_flags_open_count(p_shop_id, p_staff_id) → {open}` · `bot_recent_orders` ฟิลด์ใหม่ `source` `createdByName` `editable` (Task 4) · `DY403 pos_bill_read_only:` (Task 2 — ข้อความไทยของ RPC แสดงผ่าน `toUserMessage` เดิม)
- Produces: `duplicateWarningText(open: number): string | null` · `recentOriginLabel(o: { source?: string; createdByName?: string | null }): string` · `editableRecentOrders<T extends { editable?: boolean }>(list: T[]): T[]`

- [ ] **Step 1: เขียนเทสต์ที่ต้องตก** — `apps/line-bot/test/posBills.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { duplicateWarningText, editableRecentOrders, recentOriginLabel } from "../src/posBills";

describe("บิลจากแท็บเล็ตในบอท (ADR-0049)", () => {
  it("ยอดวันนี้ของ owner เติมคำเตือนเมื่อมีธงเปิด", () => {
    expect(duplicateWarningText(0)).toBeNull();
    expect(duplicateWarningText(2)).toBe("⚠ บิลที่อาจซ้ำ 2 ใบ — ตรวจที่แดชบอร์ดค่ะ");
  });
  it("แหล่ง · ผู้บันทึก", () => {
    expect(recentOriginLabel({ source: "pos", createdByName: "DCm" })).toBe("แท็บเล็ต · DCm");
    expect(recentOriginLabel({ source: "line", createdByName: null })).toBe("บอท · ไม่ระบุ");
  });
  it("flow แก้บิลเห็นเฉพาะบิลที่แก้ได้ (ไม่มีบิลแท็บเล็ต)", () => {
    const list = [{ orderNo: "L1", editable: true }, { orderNo: "L2", editable: false }, { orderNo: "L3" }];
    expect(editableRecentOrders(list).map((o) => o.orderNo)).toEqual(["L1", "L3"]);
  });
});
```

- [ ] **Step 2: รันให้ตก**

Run: `npx vitest run --root apps/line-bot test/posBills.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: เขียนโค้ด** — `apps/line-bot/src/posBills.ts`
```ts
// บิลจากแท็บเล็ต POS ในบอท (ADR-0049): แหล่ง · ผู้บันทึก · บิล POS แก้/ยกเลิกจากบอทไม่ได้ · ธงบิลน่าจะซ้ำ

export function duplicateWarningText(open: number): string | null {
  return open > 0 ? `⚠ บิลที่อาจซ้ำ ${open} ใบ — ตรวจที่แดชบอร์ดค่ะ` : null;
}

export function recentOriginLabel(o: { source?: string; createdByName?: string | null }): string {
  const src = o.source === "pos" ? "แท็บเล็ต" : o.source === "line" ? "บอท" : o.source === "web" ? "เว็บ" : (o.source ?? "");
  return `${src} · ${o.createdByName?.trim() || "ไม่ระบุ"}`;
}

export function editableRecentOrders<T extends { editable?: boolean }>(list: T[]): T[] {
  return list.filter((o) => o.editable !== false);
}
```
ต่อสาย:
- `commands.ts` `cmdSummary` (owner): เพิ่มใน `Promise.all` → `rpc<{ open: number }>(env, "duplicate_flags_open_count", { p_shop_id: env.DAYO_SHOP_ID, p_staff_id: staff.id }).catch(() => ({ open: 0 }))` แล้วส่ง `duplicateWarning: duplicateWarningText(dup.open)` ให้ `buildSummaryOwnerCard`
- `flex.ts` `buildSummaryOwnerCard`: รับ `duplicateWarning?: string | null` แสดงเป็นบรรทัดข้อความใต้ `backupWarning` (รูปแบบเดียวกัน) เมื่อไม่ null
- `commands.ts` `cmdRecent`: ชนิดผลเพิ่ม `source?: string; createdByName?: string | null` · ส่ง `originLabel: recentOriginLabel(o)` ให้ `buildRecentCard` · `flex.ts` แสดง `originLabel` เป็นบรรทัดรองของแต่ละบิล (ตัดตามลิมิต label ใน `line/messages.ts`)
- `flowEngine.ts` ตัวที่โหลด `recentOrders` ของ flow `edit` (`rpc<BotFlowContext["recentOrders"]>(env, "bot_recent_orders", …)`): ห่อผลด้วย `editableRecentOrders(...)` ก่อนส่งเข้า `botFlowStep` · คำสั่งพิมพ์ "แก้ <บิล POS>" ได้ข้อความ `pos_bill_read_only` จาก RPC ผ่าน `toUserMessage` เดิม (ไม่ต้องเพิ่มโค้ด)
- เทสต์เดิมของการ์ด (`flex.test.ts`, `saleFlow.test.ts`) ที่ snapshot การ์ด → อัปเดตให้มีบรรทัดใหม่เมื่อมีข้อมูล และไม่เปลี่ยนเมื่อไม่มี

- [ ] **Step 4: รันให้ผ่าน**

Run: `npm run ci -w @dayo/line-bot`
Expected: typecheck + test + build (dry-run) ผ่าน

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add apps/line-bot/src/posBills.ts apps/line-bot/src/commands.ts apps/line-bot/src/line/flex.ts apps/line-bot/src/flowEngine.ts apps/line-bot/test/posBills.test.ts apps/line-bot/test/flex.test.ts apps/line-bot/test/saleFlow.test.ts
git commit -m "feat(bot): show bill source and duplicate warnings, skip pos bills when editing"
```

---

## Task 13: parity ชั้น ก + สคริปต์ `export-pos-parity` (ชั้น ข)

**agent:** shared-logic-engineer · sonnet · high (**ช่อง Docker** — รันหลัง lane A เสร็จ Task 4 และ merge แล้ว)

**Files:**
- Create: `packages/shared/test/db/pos_parity.db.test.ts`, `scripts/export-pos-parity.ts`
- Modify: `package.json` (root script `"export-pos-parity": "tsx scripts/export-pos-parity.ts"`), `.gitignore` (+ `pos-parity.json`)

**Interfaces:**
- Consumes: `posParityCatalogPayload` `POS_PARITY_CASES` `POS_PARITY_SHOP_SETTINGS` `toSqlDraft` `moneyFromSql` `moneyFromShared` (Task 1 Step 0 · ตรวจแล้วใน Task 11) · `api_pos_catalog` (Task 1) · `pricingManifestAtBuild` `PRICING_FILES` (Task 7) · `connectLocalSupabase` `createTestShop` `Db` (helpers เดิม) · `createPosClient` (Task 3b) · `api_pos_push` (Task 3b)
- Produces: ไฟล์ `pos-parity.json` = `{ dayo_commit: string, pricing_files_sha256: Record<string,string>, generated_at: string, catalog_version: number, catalog: OrderCatalog-without-cost, cases: Array<{ id: string; spec: string; draft: OrderDraft; expected: ParityMoney }> }` — ⛔ เจ้าของคัดลอกไป POS `packages/dayo-pricing/fixtures/pos-parity.json`

- [ ] **Step 1: เขียนเทสต์ parity ชั้น ก** — `packages/shared/test/db/pos_parity.db.test.ts`
```ts
// pos_parity.db.test.ts — computeOrder (shared) = quote_order (SQL) ทุกเคส §5.3 ของ POS (กฎเหล็กข้อ 3 · ADR-0048)
// แคตตาล็อกฝั่ง shared มาจาก api_pos_catalog จริง (เติมต้นทุน 0 แบบแท็บเล็ต) — จับบั๊กการแปลงชื่อฟิลด์ของ E1 ด้วย
import { beforeAll, describe, expect, it } from "vitest";
import { computeOrder } from "../../src/money.js";
import type { OrderCatalog } from "../../src/types.js";
import { connectLocalSupabase, createTestShop, Db } from "./helpers.js";
import type { TestShop } from "./helpers.js";
import { createPosClient } from "./posFixtures.js";
import { moneyFromShared, moneyFromSql, POS_PARITY_CASES, POS_PARITY_SHOP_SETTINGS, posParityCatalogPayload, toSqlDraft } from "./posParity.js";
import type { ParityCtx } from "./posParity.js";

const T = 120_000;
const sb = await connectLocalSupabase();

describe.skipIf(!sb)("parity POS §5.3: computeOrder = quote_order", () => {
  let svc: Db;
  let shop: TestShop;
  let catalog: OrderCatalog;
  let ctx: ParityCtx;

  beforeAll(async () => {
    svc = Db.service(sb!);
    shop = await createTestShop(svc, "pos-parity");
    await svc.rpc("import_catalog", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_payload: posParityCatalogPayload(), p_mode: "replace" });
    await svc.rpc("save_shop_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: POS_PARITY_SHOP_SETTINGS });
    const clientId = await createPosClient(svc, shop.shopId);
    const e1 = await svc.rpc<{ catalog: OrderCatalog }>("api_pos_catalog", { p_shop_id: shop.shopId, p_api_client_id: clientId, p_known_version: 0 });
    catalog = e1.catalog;
    for (const i of Object.values(catalog.ingredients)) i.costPerUseUnit = 0;   // แท็บเล็ตเติม 0 (§4.4 ข้อ 1)
    const byCode = new Map(catalog.promotions.map((p) => [p.code!, p.id]));
    const all = catalog.promotions.map((p) => p.id);
    ctx = {
      promoId: (c) => byCode.get(c)!,
      allPromoIds: all,
      onlyPromos: (...codes) => all.filter((id) => !codes.some((c) => byCode.get(c) === id)),
    };
  }, T);

  it.each(POS_PARITY_CASES.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const draft = c.draft(ctx);
    const sql = await svc.rpc<Record<string, unknown>>("quote_order", { p_shop_id: shop.shopId, p_draft: toSqlDraft(draft, c.sqlExtra) });
    expect(moneyFromShared(computeOrder(draft, catalog))).toEqual(moneyFromSql(sql));
  });

  it("เลขอ้างอิงที่สเปกระบุ", async () => {
    const q = async (id: string) => {
      const c = POS_PARITY_CASES.find((x) => x.id === id)!;
      return moneyFromSql(await svc.rpc("quote_order", { p_shop_id: shop.shopId, p_draft: toSqlDraft(c.draft(ctx), c.sqlExtra) }));
    };
    expect((await q("01-pct15-of-35")).lines[0]!.discountPerCup).toBe(5.25);
    expect((await q("01-pct15-of-45")).lines[0]!.discountPerCup).toBe(6.75);
    expect((await q("01-pct7-of-85")).lines[0]!.discountPerCup).toBe(5.95);
    expect((await q("01-pct33-of-65")).lines[0]!.discountPerCup).toBe(21.45);
    expect((await q("02-markup7-ceil")).totalAmount).toBe(38);
    expect((await q("02-round2-36675")).channelFeeAmount).toBe(36.68);
    expect((await q("04-bill10-max30")).billDiscountAmount).toBe(30);
    expect((await q("06-oat-isuzu-180")).totalAmount).toBe(180);
    expect((await q("06-oat-without-fresh-milk")).ok).toBe(false);
    expect((await q("10-free-without-reason")).ok).toBe(false);
  });

  it("เส้นทางจริงของ E2: ทุกเคสที่ ok ส่งผ่าน api_pos_push ด้วย totals จาก computeOrder → computed_total − total = 0 และไม่ติด amount_mismatch", async () => {
    // บิล POS คิดผ่าน create_order (include_inactive = true + dayo_check_draft_size_pos) ไม่ใช่ quote_order — ต้องได้เลขเดียวกัน
    const clientId = await createPosClient(svc, shop.shopId);
    const day = new Date(Date.now() - 86_400_000 + 7 * 3600_000).toISOString().slice(0, 10); // เมื่อวาน (ไทย) — ≤ วันนี้ และเวลาไม่ล้ำเซิร์ฟเวอร์
    let seq = 1;
    for (const c of POS_PARITY_CASES) {
      const draft = { ...c.draft(ctx), saleDate: day };
      const q = computeOrder(draft, catalog);
      if (!q.ok) continue;
      const soldAt = new Date(Date.parse(`${day}T${draft.saleTime}:30+07:00`)).toISOString();
      const posId = crypto.randomUUID();
      const noPromos = c.sqlExtra?.no_promotions === true;
      const bill = draft.billDiscountBaht != null || draft.billDiscountPercent != null
        ? { baht: draft.billDiscountBaht ?? null, percent: draft.billDiscountPercent ?? null, reason: draft.billDiscountReason ?? null } : null;
      const res = await svc.rpc<{ results: Array<{ status: string; reason?: string; data?: { computed_total: number; amount_mismatch: boolean } }> }>(
        "api_pos_push", { p_shop_id: shop.shopId, p_api_client_id: clientId, p_scopes: ["orders:write"], p_rows: [{
          key: `order:${posId}`, kind: "order", data: {
            pos_order_id: posId, receipt_no: `P-${String(seq++).padStart(6, "0")}`, queue_no: seq, sale_date: day, sold_at: soldAt,
            channel: draft.channelCode, payment: draft.paymentCode, staff_id: shop.staffId, catalog_version: 1, shift_id: null,
            lines: draft.lines.map((l) => ({ code: l.code, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade ?? null, qty: l.qty,
              free: l.free ?? false, discount_baht: l.discountBaht ?? null, discount_percent: l.discountPercent ?? null, discount_reason: l.discountReason ?? null })),
            bill_discount: bill, promo_code: draft.promoCode ?? null,
            skip_promotion_ids: noPromos ? [] : (draft.skipPromotionIds ?? []), no_promotions: noPromos,
            totals: { items_subtotal: q.itemsSubtotal, items_discount: q.itemsDiscount, bill_discount: q.billDiscountAmount, total: q.totalAmount },
            note: null } }] });
      const r = res.results[0]!;
      expect([c.id, r.status], JSON.stringify(r)).toEqual([c.id, "accepted"]);
      expect([c.id, Number(r.data!.computed_total)]).toEqual([c.id, Math.round(q.totalAmount * 100) / 100]);
      expect([c.id, r.data!.amount_mismatch]).toEqual([c.id, false]);
    }
  });
});
```

- [ ] **Step 2: รัน (ผ่านได้ทันทีถ้า shared = SQL อยู่แล้ว · ถ้าตก = บั๊ก parity จริง)**

Run: `npm run db:reset && npx vitest run --root packages/shared test/db/pos_parity.db.test.ts`
Expected: PASS ทุกเคส · ถ้าเคสใดตก **ห้ามแก้เคสให้ผ่าน** — หยุด รายงานหัวหน้า (ความต่างของ `computeOrder` กับ `quote_order` = บั๊กตามกฎเหล็กข้อ 3 แก้ที่ฝั่งที่ผิดใน task แยก)

- [ ] **Step 3: เขียนสคริปต์ export** — `scripts/export-pos-parity.ts`
```ts
// scripts/export-pos-parity.ts — parity ชั้น ข (สเปก POS 04 §5.2 · ADR-0048)
// ใช้: npm run db:start && npm run db:reset && npm run export-pos-parity -- --expect-commit <pricing.commit ของ E1 production> [--out pos-parity.json]
// ต้องรันบน commit ที่ deploy อยู่จริง + working tree สะอาด · ดึง catalog ด้วย api_pos_catalog จริงบน Supabase local
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { computeOrder } from "../packages/shared/src/money";
import type { OrderCatalog } from "../packages/shared/src/types";
import { connectLocalSupabase, createTestShop, Db } from "../packages/shared/test/db/helpers";
import { createPosClient } from "../packages/shared/test/db/posFixtures";
import { moneyFromShared, moneyFromSql, POS_PARITY_CASES, POS_PARITY_SHOP_SETTINGS, posParityCatalogPayload, toSqlDraft } from "../packages/shared/test/db/posParity";
import type { ParityCtx } from "../packages/shared/test/db/posParity";
import { pricingManifestAtBuild } from "./pricing-manifest";
import { REPO_ROOT } from "./version";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const git = (a: string[]) => execFileSync("git", a, { cwd: REPO_ROOT }).toString().trim();

async function main(): Promise<void> {
  const expect = arg("--expect-commit");
  const out = arg("--out") ?? `${REPO_ROOT}pos-parity.json`;
  const head = git(["rev-parse", "HEAD"]);
  if (!expect || !head.startsWith(expect)) {
    throw new Error(`ต้องรันบน commit ที่ deploy อยู่: --expect-commit ${expect ?? "(ไม่ได้ส่ง)"} ≠ HEAD ${head}`);
  }
  if (git(["status", "--porcelain"]) !== "") throw new Error("working tree ไม่สะอาด — commit หรือ stash ก่อน");
  const sb = await connectLocalSupabase();
  if (!sb) throw new Error("ไม่พบ Supabase บนเครื่อง — npm run db:start ก่อน");
  const svc = Db.service(sb);
  const shop = await createTestShop(svc, `pos-parity-export-${Date.now()}`);
  await svc.rpc("import_catalog", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_payload: posParityCatalogPayload(), p_mode: "replace" });
  await svc.rpc("save_shop_settings", { p_shop_id: shop.shopId, p_staff_id: shop.ownerId, p_patch: POS_PARITY_SHOP_SETTINGS });
  const clientId = await createPosClient(svc, shop.shopId);
  const e1 = await svc.rpc<{ catalog: OrderCatalog; catalog_version: number }>("api_pos_catalog", {
    p_shop_id: shop.shopId, p_api_client_id: clientId, p_known_version: 0 });
  const byCode = new Map(e1.catalog.promotions.map((p) => [p.code!, p.id]));
  const all = e1.catalog.promotions.map((p) => p.id);
  const ctx: ParityCtx = { promoId: (c) => byCode.get(c)!, allPromoIds: all, onlyPromos: (...codes) => all.filter((id) => !codes.some((c) => byCode.get(c) === id)) };
  const withZeroCost = structuredClone(e1.catalog);
  for (const i of Object.values(withZeroCost.ingredients)) i.costPerUseUnit = 0;
  const cases = [];
  for (const c of POS_PARITY_CASES) {
    const draft = c.draft(ctx);
    if (!/^\d{2}:\d{2}$/.test(draft.saleTime ?? "")) throw new Error(`เคส ${c.id} ไม่มี saleTime — แท็บเล็ตส่งเวลาขายทุกบิล ห้าม export`);
    const expected = moneyFromSql(await svc.rpc("quote_order", { p_shop_id: shop.shopId, p_draft: toSqlDraft(draft, c.sqlExtra) }));
    const shared = moneyFromShared(computeOrder(draft, withZeroCost));
    if (JSON.stringify(shared) !== JSON.stringify(expected)) throw new Error(`parity ชั้น ก ไม่ผ่านที่เคส ${c.id} — ห้าม export`);
    cases.push({ id: c.id, spec: c.spec, draft, expected });
  }
  const manifest = pricingManifestAtBuild({ WORKERS_CI_COMMIT_SHA: head });
  writeFileSync(out, `${JSON.stringify({
    dayo_commit: head, pricing_files_sha256: manifest.files_sha256, generated_at: new Date().toISOString(),
    catalog_version: e1.catalog_version, catalog: e1.catalog, cases,
  }, null, 2)}\n`);
  console.log(`เขียน ${out} แล้ว (${cases.length} เคส) — ส่งให้ทีม POS วางที่ packages/dayo-pricing/fixtures/pos-parity.json`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```
- root `package.json` → `"export-pos-parity": "tsx scripts/export-pos-parity.ts"` · `.gitignore` → `pos-parity.json`

- [ ] **Step 4: ลองรันบนเครื่อง (commit ปัจจุบัน)**

Run: `npm run export-pos-parity -- --expect-commit $(git rev-parse HEAD) --out pos-parity.json && node -e "const j=require('./pos-parity.json');console.log(j.cases.length, Object.keys(j.pricing_files_sha256).length, JSON.stringify(j).includes('costPerUseUnit'), j.cases.every(c => /^d{2}:d{2}$/.test(c.draft.saleTime)))"`
Expected: `33 7 false true` (ทุกเคสมี `saleTime` — กติกาของไฟล์ parity ที่แผน 07 ใช้)

- [ ] **Step 5: Commit** (เมื่อเจ้าของสั่ง — ไม่ commit `pos-parity.json`)
```bash
git add packages/shared/test/db/pos_parity.db.test.ts scripts/export-pos-parity.ts package.json .gitignore
git commit -m "feat(scripts): add pos parity tests and the parity export script"
```

---

## Task 14: สำรองอัตโนมัติทุกคืน + ซ้อมกู้รายเดือน (P7)

**agent:** devops · sonnet · medium · Step 1–5 = lane D รอบ 1 (ไม่ใช้ Docker) · **Step 6–7 = ช่อง Docker รอบ 7 หลัง merge Task 4 และ Task 11** · ไม่แตะ production — ทุกขั้นที่แตะ GitHub/OneDrive/Supabase จริงอยู่ใน Task 17 ⛔

**หลักความปลอดภัยของ job (ADR-0050 · ตามรีวิว):** job สำรองและซ้อมกู้ **ไม่รัน `npm ci`/`npx`/`setup-node`** — ไม่มีโค้ด third-party จาก npm อยู่ใน runner ขณะมี dump/token/PAT · ใช้เฉพาะ bash, `jq`, `curl`, `gh` (มีใน image ของ GitHub), `node` ที่มากับ image (รัน `.mjs` ไม่มี import นอก `node:*`), `postgresql-client-17` จาก apt ของ PostgreSQL และ rclone จาก `.deb` ทางการ · ค่าลับอยู่ใน `env` ของ step ที่ใช้เท่านั้น · dump/tar ที่ยังไม่เข้ารหัสถูก `shred` ทันทีหลัง `gpg` · แจ้ง Discord ตอนล้มด้วย `curl`+`jq` ล้วน (ไม่พึ่งขั้นติดตั้งใด ๆ)

**Files:**
- Create: `.github/workflows/backup.yml`, `.github/workflows/restore-test.yml`
- Create: `scripts/backup/manifest.sql`, `scripts/backup/dump.sh`, `scripts/backup/notify.sh`, `scripts/backup/backup-tool.mjs`, `scripts/backup/backup-tool.d.mts`
- Create: `packages/shared/test/backupTool.test.ts`
- Create: `supabase/manual/backup-role.sql`

**Interfaces:**
- Consumes: `backup_log_auto(p_row_counts jsonb, p_bytes bigint)` (Task 4 — execute เฉพาะ `dayo_backup`) · `DISCORD_STYLES` (`packages/shared/src/discordMessages.ts` — ใช้ในเทสต์เท่านั้น เพื่อยืนยันสี/อีโมจิตรง ADR-0044)
- Produces:
  - `scripts/backup/backup-tool.mjs`: `filesToDelete(names: string[], keep: number): string[]` · `hasMonthly(names: string[], month: string): boolean` · `dbSizeLevel(bytes: number, limit?: number): "ok" | "warn" | "critical"` · `patDaysLeft(header: string | null, now: number): number | null` · `compareRestore(expected: BackupStats, restored: BackupStats): string[]` · CLI `retention --keep <n>` (stdin → stdout) · `has-monthly <YYYY-MM>` (stdin) · `size-level <bytes>` · `pat-days "<header>"` · `compare <a.json> <b.json>`
  - `scripts/backup/notify.sh <error|warning|report> "<หัวข้อ>" "<รายละเอียด>" [--here]` (ต้องมี env `DISCORD_ALERT_WEBHOOK_URL` · `--dry-run` เป็นอาร์กิวเมนต์ที่ 5 = พิมพ์ payload ไม่ส่ง)
  - `scripts/backup/dump.sh <db_url> <outdir>` → `<outdir>/dump.pgcustom` + `<outdir>/manifest.json` (dump และสถิติจาก snapshot เดียวกัน)
- ค่าลับ (เจ้าของตั้งใน GitHub เท่านั้น): `SUPABASE_DB_URL` `BACKUP_PASSPHRASE` `RCLONE_CONF` `DISCORD_ALERT_WEBHOOK_URL` `GH_SECRETS_PAT`

- [ ] **Step 1: SQL สถิติ** — `scripts/backup/manifest.sql`
```sql
-- สถิติของฐาน (ใช้ทั้งตอนสำรองและตอนซ้อมกู้ — ADR-0050) · ผลเป็น JSON บรรทัดเดียว
select jsonb_build_object(
  'generated_at', now(),
  'db_bytes', pg_database_size(current_database()),
  'last_migration', (select max(version) from supabase_migrations.schema_migrations),
  'row_counts', (
    select coalesce(jsonb_object_agg(t.table_name,
      (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.table_name), false, true, '')))[1]::text::bigint), '{}'::jsonb)
    from information_schema.tables t where t.table_schema = 'public' and t.table_type = 'BASE TABLE'),
  'monthly_totals', (
    select coalesce(jsonb_object_agg(m, s), '{}'::jsonb)
    from (select to_char(o.sale_date, 'YYYY-MM') as m, sum(o.total_amount)::text as s
          from public.orders o where o.status = 'ok' group by 1) x)
)::text;
```

- [ ] **Step 2: dump + สถิติใน snapshot เดียวกัน** — `scripts/backup/dump.sh`
```bash
#!/usr/bin/env bash
# dump + manifest จาก snapshot เดียวกัน (ADR-0050) — แถวที่เข้ามาระหว่างสองขั้นไม่ทำให้จำนวนแถวใน manifest ต่างจาก dump
# ใช้: bash scripts/backup/dump.sh "<db_url>" <outdir>   (ต้องมี pg_dump/psql รุ่น 17 ใน PATH หรือ $PGBIN)
set -euo pipefail
URL="$1"; OUT="$2"
BIN="${PGBIN:-$(dirname "$(command -v pg_dump)")}"
mkdir -p "$OUT"; chmod 700 "$OUT"
rm -f "$OUT/ctl"; mkfifo "$OUT/ctl"
# session ค้างธุรกรรม repeatable read ไว้ตลอดการ dump แล้ว export snapshot ให้ session อื่นใช้ (ใช้ได้กับ session pooler)
"$BIN/psql" "$URL" -qAt -v ON_ERROR_STOP=1 < "$OUT/ctl" > "$OUT/holder.out" &
HOLDER=$!
exec 3> "$OUT/ctl"
printf 'begin isolation level repeatable read read only;\nselect pg_export_snapshot();\n' >&3
for _ in $(seq 1 60); do [ -s "$OUT/holder.out" ] && break; sleep 1; done
SNAP=$(head -n 1 "$OUT/holder.out")
[ -n "$SNAP" ] || { echo "export snapshot ไม่สำเร็จ" >&2; exit 1; }
printf "begin isolation level repeatable read read only;\nset transaction snapshot '%s';\n\\\\i scripts/backup/manifest.sql\ncommit;\n" "$SNAP" \
  | "$BIN/psql" "$URL" -qAt -v ON_ERROR_STOP=1 > "$OUT/stats.json"
"$BIN/pg_dump" --snapshot="$SNAP" --format=custom --no-owner --no-privileges --schema=public --schema=supabase_migrations \
  --file="$OUT/dump.pgcustom" "$URL"
printf 'commit;\n' >&3
exec 3>&-
wait "$HOLDER"
rm -f "$OUT/ctl" "$OUT/holder.out"
jq --arg sha "$(sha256sum "$OUT/dump.pgcustom" | cut -d' ' -f1)" '. + {dump_sha256: $sha}' "$OUT/stats.json" > "$OUT/manifest.json"
rm -f "$OUT/stats.json"
test "$(jq '.row_counts | length' "$OUT/manifest.json")" -gt 0
```

- [ ] **Step 3: แจ้ง Discord ด้วย curl + jq** — `scripts/backup/notify.sh`
```bash
#!/usr/bin/env bash
# แจ้ง Discord ช่องระบบ (ADR-0044) — ใช้แค่ bash + jq + curl (ใช้ได้แม้ขั้นติดตั้งล้ม) · สี/อีโมจิต้องตรง DISCORD_STYLES (เทสต์บังคับ)
# ใช้: bash scripts/backup/notify.sh <error|warning|report> "<หัวข้อ>" "<รายละเอียด>" [--here] [--dry-run]
set -euo pipefail
KIND="$1"; TITLE="$2"; DESC="${3:-}"; HERE="${4:-}"; DRY="${5:-}"
case "$KIND" in
  error)   EMOJI="🔴"; LABEL="ERROR";   COLOR=14692657 ;;   # 0xe03131
  warning) EMOJI="🟡"; LABEL="WARNING"; COLOR=15904798 ;;   # 0xf2b01e
  report)  EMOJI="📊"; LABEL="รายงาน";  COLOR=8298591 ;;    # 0x7ea05f
  *) echo "ไม่รู้จักชนิด $KIND" >&2; exit 2 ;;
esac
PARSE='[]'; CONTENT=''
if [ "$HERE" = "--here" ]; then PARSE='["everyone"]'; CONTENT='@here'; fi
PAYLOAD=$(jq -n --arg t "$EMOJI $LABEL · สำรองข้อมูล · $TITLE" --arg d "${DESC:0:3500}" --argjson c "$COLOR" \
  --arg content "$CONTENT" --argjson parse "$PARSE" \
  '{username: "DA-YO Alerts", allowed_mentions: {parse: $parse}, embeds: [{title: $t[0:256], description: $d, color: $c}]}
   + (if $content == "" then {} else {content: $content} end)')
if [ "$DRY" = "--dry-run" ] || [ "$HERE" = "--dry-run" ]; then echo "$PAYLOAD"; exit 0; fi
if [ -z "${DISCORD_ALERT_WEBHOOK_URL:-}" ]; then echo "ไม่ได้ตั้ง DISCORD_ALERT_WEBHOOK_URL — ข้ามการแจ้งเตือน" >&2; exit 0; fi
curl -fsS -H "Content-Type: application/json" -d "$PAYLOAD" "$DISCORD_ALERT_WEBHOOK_URL" > /dev/null
```

- [ ] **Step 4: ตัวช่วยไม่มี dependency + เทสต์**

`scripts/backup/backup-tool.mjs`:
```js
// scripts/backup/backup-tool.mjs — ตัวช่วยของ workflow สำรอง/ซ้อมกู้ (ADR-0050)
// JavaScript ล้วน import เฉพาะ node:* — รันด้วย node ที่มากับ runner โดยไม่ต้อง npm ci · ห้ามพิมพ์ค่าลับ
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BACKUP_FILE_RE = /^DA-YO_db_(\d{4}-\d{2}-\d{2})\.tar\.gpg$/;
export const DB_LIMIT_BYTES = 500 * 1024 * 1024;

/** ไฟล์ที่ต้องลบเพื่อเหลือ keep ไฟล์ล่าสุด (เรียงตามวันที่ในชื่อ) — ชื่อที่ไม่ตรงรูปไม่แตะ */
export function filesToDelete(names, keep) {
  const valid = names.filter((n) => BACKUP_FILE_RE.test(n)).sort().reverse();
  return valid.slice(Math.max(0, keep)).sort();
}

/** มีไฟล์ของเดือน YYYY-MM ในรายการแล้วหรือยัง (สำเนารายเดือนของรอบแรกที่สำเร็จในเดือน) */
export function hasMonthly(names, month) {
  return names.some((n) => BACKUP_FILE_RE.test(n) && n.slice(9, 16) === month);
}

export function dbSizeLevel(bytes, limit = DB_LIMIT_BYTES) {
  if (bytes >= limit * 0.8) return "critical";
  if (bytes >= limit * 0.6) return "warn";
  return "ok";
}

/** หัว github-authentication-token-expiration เช่น "2026-10-09 00:00:00 UTC" → วันที่เหลือ (ปัดลง) · อ่านไม่ได้ = null */
export function patDaysLeft(header, now) {
  if (!header) return null;
  const at = Date.parse(header.trim().replace(" UTC", "Z").replace(" ", "T"));
  if (Number.isNaN(at)) return null;
  return Math.floor((at - now) / 86_400_000);
}

/** เทียบสถิติของไฟล์สำรองกับฐานที่กู้ — คืนข้อความไทยทุกจุดที่ต่าง */
export function compareRestore(expected, restored) {
  const out = [];
  for (const t of Object.keys(expected.row_counts).sort()) {
    const a = expected.row_counts[t];
    const b = restored.row_counts[t];
    if (a !== b) out.push(`ตาราง ${t}: ไฟล์สำรอง ${a} แถว กู้ได้ ${b ?? "ไม่มี"} แถว`);
  }
  for (const m of Object.keys(expected.monthly_totals).sort()) {
    const a = String(expected.monthly_totals[m]);
    const b = restored.monthly_totals[m] === undefined ? "ไม่มี" : String(restored.monthly_totals[m]);
    if (Number(a) !== Number(b)) out.push(`ยอดขาย ${m}: ไฟล์สำรอง ${a} กู้ได้ ${b}`);
  }
  return out;
}

const stdinLines = () => readFileSync(0, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "retention") {
    for (const n of filesToDelete(stdinLines(), Number(rest[rest.indexOf("--keep") + 1]))) console.log(n);
  } else if (cmd === "has-monthly") {
    console.log(hasMonthly(stdinLines(), rest[0]) ? "yes" : "no");
  } else if (cmd === "size-level") {
    console.log(dbSizeLevel(Number(rest[0])));
  } else if (cmd === "pat-days") {
    const d = patDaysLeft(rest[0] || null, Date.now());
    console.log(d == null ? "none" : String(d));
  } else if (cmd === "compare") {
    const diff = compareRestore(JSON.parse(readFileSync(rest[0], "utf8")), JSON.parse(readFileSync(rest[1], "utf8")));
    for (const line of diff) console.log(line);
    process.exitCode = diff.length ? 1 : 0;
  } else {
    console.error(`ไม่รู้จักคำสั่ง ${cmd}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
```

`scripts/backup/backup-tool.d.mts`:
```ts
export interface BackupStats {
  db_bytes: number;
  last_migration: string | null;
  row_counts: Record<string, number>;
  monthly_totals: Record<string, number | string>;
}
export declare const BACKUP_FILE_RE: RegExp;
export declare const DB_LIMIT_BYTES: number;
export declare function filesToDelete(names: string[], keep: number): string[];
export declare function hasMonthly(names: string[], month: string): boolean;
export declare function dbSizeLevel(bytes: number, limit?: number): "ok" | "warn" | "critical";
export declare function patDaysLeft(header: string | null, now: number): number | null;
export declare function compareRestore(expected: BackupStats, restored: BackupStats): string[];
```

`packages/shared/test/backupTool.test.ts`:
```ts
// backupTool.test.ts — ตัวช่วยงานสำรอง (ADR-0050) + สี/อีโมจิของ notify.sh ต้องตรง DISCORD_STYLES (ADR-0044)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareRestore, dbSizeLevel, DB_LIMIT_BYTES, filesToDelete, hasMonthly, patDaysLeft } from "../../../scripts/backup/backup-tool.mjs";
import { DISCORD_STYLES } from "../src/discordMessages";

const NOTIFY = readFileSync(fileURLToPath(new URL("../../../scripts/backup/notify.sh", import.meta.url)), "utf8");

describe("backup-tool.mjs", () => {
  it("เก็บ N ไฟล์ล่าสุดตามวันที่ในชื่อ · ไม่แตะไฟล์ชื่ออื่น", () => {
    const names = ["DA-YO_db_2026-09-01.tar.gpg", "DA-YO_db_2026-09-03.tar.gpg", "DA-YO_db_2026-09-02.tar.gpg", "notes.txt"];
    expect(filesToDelete(names, 2)).toEqual(["DA-YO_db_2026-09-01.tar.gpg"]);
    expect(filesToDelete(names, 30)).toEqual([]);
  });
  it("สำเนารายเดือน: มีไฟล์ของเดือนนี้แล้ว = ไม่คัดลอกซ้ำ · ยังไม่มี (รอบวันที่ 1 ล้ม) = คัดลอกรอบถัดไป", () => {
    expect(hasMonthly(["DA-YO_db_2026-09-01.tar.gpg"], "2026-09")).toBe(true);
    expect(hasMonthly(["DA-YO_db_2026-08-01.tar.gpg"], "2026-09")).toBe(false);
  });
  it("ระดับขนาดฐาน 60% / 80% ของ 500 MB", () => {
    expect(dbSizeLevel(Math.floor(DB_LIMIT_BYTES * 0.59))).toBe("ok");
    expect(dbSizeLevel(Math.ceil(DB_LIMIT_BYTES * 0.6))).toBe("warn");
    expect(dbSizeLevel(Math.ceil(DB_LIMIT_BYTES * 0.8))).toBe("critical");
  });
  it("วัน PAT เหลือ", () => {
    const now = Date.parse("2026-09-25T00:00:00Z");
    expect(patDaysLeft("2026-10-09 00:00:00 UTC", now)).toBe(14);
    expect(patDaysLeft("2026-09-24 00:00:00 UTC", now)).toBe(-1);
    expect(patDaysLeft(null, now)).toBeNull();
    expect(patDaysLeft("อ่านไม่ได้", now)).toBeNull();
  });
  it("เทียบผลซ้อมกู้", () => {
    const base = { db_bytes: 1, last_migration: "0052", row_counts: { orders: 10, staff: 2 }, monthly_totals: { "2026-09": "1550.00" } };
    expect(compareRestore(base, { ...base })).toEqual([]);
    expect(compareRestore(base, { ...base, row_counts: { orders: 9, staff: 2 }, monthly_totals: { "2026-09": "1500.00" } }))
      .toEqual(["ตาราง orders: ไฟล์สำรอง 10 แถว กู้ได้ 9 แถว", "ยอดขาย 2026-09: ไฟล์สำรอง 1550.00 กู้ได้ 1500.00"]);
  });
  it("backup-tool.mjs import เฉพาะ node:*", () => {
    const src = readFileSync(fileURLToPath(new URL("../../../scripts/backup/backup-tool.mjs", import.meta.url)), "utf8");
    for (const m of src.matchAll(/from\s+"([^"]+)"/g)) expect(m[1]!.startsWith("node:"), m[1]).toBe(true);
  });
});

describe("notify.sh ตรง ADR-0044", () => {
  it.each([["error", "🔴", "ERROR"], ["warning", "🟡", "WARNING"], ["report", "📊", "รายงาน"]] as const)("%s", (kind, emoji, label) => {
    const style = DISCORD_STYLES[kind];
    expect(style.emoji).toBe(emoji);
    expect(style.label).toBe(label);
    expect(NOTIFY).toMatch(new RegExp(`${kind}\\)\\s+EMOJI="${emoji}"; LABEL="${label}";\\s+COLOR=${style.color} `));
  });
  it("ไม่มี npm/npx/node ใน notify.sh และใน workflow สำรอง/ซ้อมกู้ไม่มี npm ci/npx/setup-node", () => {
    expect(NOTIFY).not.toMatch(/\bnpx?\b|\bnode\b/);
    for (const wf of ["backup.yml", "restore-test.yml"]) {
      const y = readFileSync(fileURLToPath(new URL(`../../../.github/workflows/${wf}`, import.meta.url)), "utf8");
      expect(y, wf).not.toMatch(/npm ci|npx |setup-node/);
    }
  });
});
```

- [ ] **Step 5: workflow + SQL ของ role**

`.github/workflows/backup.yml`:
```yaml
name: backup
# สำรองฐานข้อมูลอัตโนมัติทุกคืน → OneDrive (ADR-0050) · ล้ม = Discord ช่องระบบ 🔴 @here · ไม่มี npm ใน job นี้
on:
  schedule:
    - cron: "0 18 * * *" # 01:00 เวลาไทย
  workflow_dispatch:
    inputs:
      force_fail:
        description: "ทดสอบการแจ้งเตือน: true = บังคับให้ล้มหลังอัปโหลด"
        required: false
        default: "false"
permissions:
  contents: read
concurrency:
  group: backup
  cancel-in-progress: false
jobs:
  backup:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    env:
      REMOTE: "onedrive:DAYO/Backups/auto"
      PGBIN: /usr/lib/postgresql/17/bin
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: ติดตั้ง postgresql-client-17 และ rclone (.deb ทางการ)
        run: |
          sudo install -d /usr/share/postgresql-common/pgdg
          sudo curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
          echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
          sudo apt-get update -qq
          sudo apt-get install -y -qq postgresql-client-17
          curl -fsSL -o /tmp/rclone.deb https://downloads.rclone.org/rclone-current-linux-amd64.deb
          sudo dpkg -i /tmp/rclone.deb > /dev/null
      - name: เขียน rclone.conf (ไม่พิมพ์ค่า)
        env:
          RCLONE_CONF: ${{ secrets.RCLONE_CONF }}
        run: |
          mkdir -p ~/.config/rclone
          printf '%s\n' "$RCLONE_CONF" > ~/.config/rclone/rclone.conf
          chmod 600 ~/.config/rclone/rclone.conf
      - name: dump + manifest (snapshot เดียวกัน)
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: bash scripts/backup/dump.sh "$SUPABASE_DB_URL" work
      - name: เข้ารหัส แล้วทำลายไฟล์ดิบทันที
        env:
          BACKUP_PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
        run: |
          DAY=$(TZ=Asia/Bangkok date +%F)
          echo "FILE=DA-YO_db_${DAY}.tar.gpg" >> "$GITHUB_ENV"
          tar -C work -cf "work/DA-YO_db_${DAY}.tar" dump.pgcustom manifest.json
          printf '%s' "$BACKUP_PASSPHRASE" > work/pass
          gpg --batch --yes --pinentry-mode loopback --passphrase-file work/pass --symmetric --cipher-algo AES256 \
            -o "work/DA-YO_db_${DAY}.tar.gpg" "work/DA-YO_db_${DAY}.tar"
          shred -u work/pass work/dump.pgcustom "work/DA-YO_db_${DAY}.tar"
      - name: อัปโหลด + ตรวจขนาด + สำเนารายเดือน
        run: |
          rclone copyto "work/$FILE" "$REMOTE/daily/$FILE"
          LOCAL=$(stat -c %s "work/$FILE")
          REMOTE_SIZE=$(rclone lsjson "$REMOTE/daily/$FILE" | jq '.[0].Size')
          test "$LOCAL" = "$REMOTE_SIZE"
          echo "BYTES=$LOCAL" >> "$GITHUB_ENV"
          MONTH=$(TZ=Asia/Bangkok date +%Y-%m)
          # สำเนารายเดือน = ไฟล์ของรอบแรกที่สำเร็จในเดือน (ถ้ารอบวันที่ 1 ล้ม รอบถัดไปคัดลอกแทน)
          if [ "$(rclone lsf --files-only "$REMOTE/monthly" | node scripts/backup/backup-tool.mjs has-monthly "$MONTH")" = "no" ]; then
            rclone copyto "work/$FILE" "$REMOTE/monthly/$FILE"
          fi
      - name: เขียน token OneDrive ที่ต่ออายุแล้วกลับเข้า secret (ทำเสมอ แม้ขั้นอื่นล้ม)
        if: always()
        env:
          GH_TOKEN: ${{ secrets.GH_SECRETS_PAT }}
        run: |
          CONF=~/.config/rclone/rclone.conf
          [ -s "$CONF" ] || { echo "ไม่มี rclone.conf — ข้าม"; exit 0; }
          while IFS= read -r line; do [ -n "$line" ] && echo "::add-mask::$line"; done < "$CONF"
          gh secret set RCLONE_CONF --repo "$GITHUB_REPOSITORY" < "$CONF"
      - name: ลบไฟล์เก่า (daily 30 · monthly 12 ไฟล์ล่าสุด)
        run: |
          rclone lsf --files-only "$REMOTE/daily" | node scripts/backup/backup-tool.mjs retention --keep 30 | while read -r f; do rclone deletefile "$REMOTE/daily/$f"; done
          rclone lsf --files-only "$REMOTE/monthly" | node scripts/backup/backup-tool.mjs retention --keep 12 | while read -r f; do rclone deletefile "$REMOTE/monthly/$f"; done
      - name: บันทึก backup_log (kind=auto)
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: |
          echo "select public.backup_log_auto(:'counts'::jsonb, :bytes);" | \
            "$PGBIN/psql" "$SUPABASE_DB_URL" -qAt -v ON_ERROR_STOP=1 -v counts="$(jq -c .row_counts work/manifest.json)" -v bytes="$BYTES"
      - name: เตือนขนาดฐาน / พื้นที่ OneDrive
        env:
          DISCORD_ALERT_WEBHOOK_URL: ${{ secrets.DISCORD_ALERT_WEBHOOK_URL }}
        run: |
          BYTES_DB=$(jq .db_bytes work/manifest.json)
          LEVEL=$(node scripts/backup/backup-tool.mjs size-level "$BYTES_DB")
          MB=$(( BYTES_DB / 1048576 ))
          if [ "$LEVEL" = "warn" ]; then bash scripts/backup/notify.sh warning "ฐานข้อมูลใช้ ${MB} MB" "≥ 60% ของ 500 MB — วางแผนย้ายข้อมูลเก่า (สเปก §10.1)"; fi
          if [ "$LEVEL" = "critical" ]; then bash scripts/backup/notify.sh error "ฐานข้อมูลใช้ ${MB} MB" "≥ 80% ของ 500 MB" --here; fi
          FREE=$(rclone about "$REMOTE" --json | jq '.free // 0')
          if [ "$FREE" -lt 1073741824 ]; then bash scripts/backup/notify.sh warning "OneDrive เหลือ $(( FREE / 1048576 )) MB" "น้อยกว่า 1 GB"; fi
      - name: อายุ GH_SECRETS_PAT (เตือน 🟡 ที่ ≤ 14 วัน · 🔴 เมื่อหมดแล้ว)
        env:
          GH_SECRETS_PAT: ${{ secrets.GH_SECRETS_PAT }}
          DISCORD_ALERT_WEBHOOK_URL: ${{ secrets.DISCORD_ALERT_WEBHOOK_URL }}
        run: |
          EXP=$(curl -fsSI -H "Authorization: Bearer $GH_SECRETS_PAT" "https://api.github.com/repos/$GITHUB_REPOSITORY" | tr -d '\r' | grep -i '^github-authentication-token-expiration:' | cut -d' ' -f2- || true)
          DAYS=$(node scripts/backup/backup-tool.mjs pat-days "$EXP")
          if [ "$DAYS" != "none" ] && [ "$DAYS" -lt 0 ]; then bash scripts/backup/notify.sh error "GH_SECRETS_PAT หมดอายุแล้ว" "token OneDrive จะไม่ถูกต่ออายุ — สร้าง PAT ใหม่แล้วใส่ secret" --here
          elif [ "$DAYS" != "none" ] && [ "$DAYS" -le 14 ]; then bash scripts/backup/notify.sh warning "GH_SECRETS_PAT จะหมดอายุใน ${DAYS} วัน" "สร้าง PAT ใหม่แล้วใส่ secret"; fi
      - name: บังคับล้ม (ทดสอบการแจ้งเตือน)
        if: ${{ inputs.force_fail == 'true' }}
        run: |
          echo "บังคับให้ล้มตามคำสั่ง force_fail"
          exit 1
      - name: แจ้ง Discord เมื่อล้ม (curl + jq เท่านั้น)
        if: failure()
        env:
          DISCORD_ALERT_WEBHOOK_URL: ${{ secrets.DISCORD_ALERT_WEBHOOK_URL }}
        run: bash scripts/backup/notify.sh error "สำรองข้อมูลอัตโนมัติล้ม" "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}" --here
      - name: ล้างไฟล์ในเครื่อง runner
        if: always()
        run: |
          [ -d work ] && find work -type f -exec shred -u {} + || true
          rm -rf work
          [ -f ~/.config/rclone/rclone.conf ] && shred -u ~/.config/rclone/rclone.conf || true
```

`.github/workflows/restore-test.yml`:
```yaml
name: restore-test
# ซ้อมกู้ไฟล์สำรองล่าสุดทุกวันที่ 2 (ADR-0050) · ผ่าน = 📊 · ไม่ผ่าน = 🔴 @here · ไม่มี npm ใน job นี้
on:
  schedule:
    - cron: "0 3 2 * *" # วันที่ 2 เวลา 10:00 ไทย
  workflow_dispatch:
permissions:
  contents: read
jobs:
  restore:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: restore
          POSTGRES_DB: restore
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 20
    env:
      REMOTE: "onedrive:DAYO/Backups/auto"
      PGBIN: /usr/lib/postgresql/17/bin
      RESTORE_URL: postgresql://postgres:restore@localhost:5432/restore
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - name: ติดตั้ง postgresql-client-17 และ rclone (.deb ทางการ)
        run: |
          sudo install -d /usr/share/postgresql-common/pgdg
          sudo curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
          echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
          sudo apt-get update -qq
          sudo apt-get install -y -qq postgresql-client-17
          curl -fsSL -o /tmp/rclone.deb https://downloads.rclone.org/rclone-current-linux-amd64.deb
          sudo dpkg -i /tmp/rclone.deb > /dev/null
      - name: เขียน rclone.conf
        env:
          RCLONE_CONF: ${{ secrets.RCLONE_CONF }}
        run: |
          mkdir -p ~/.config/rclone
          printf '%s\n' "$RCLONE_CONF" > ~/.config/rclone/rclone.conf
          chmod 600 ~/.config/rclone/rclone.conf
      - name: ดาวน์โหลดไฟล์ล่าสุด + ถอดรหัส + ตรวจ sha256
        env:
          BACKUP_PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
        run: |
          mkdir -p work && chmod 700 work
          FILE=$(rclone lsf --files-only "$REMOTE/daily" | grep -E '^DA-YO_db_[0-9]{4}-[0-9]{2}-[0-9]{2}\.tar\.gpg$' | sort | tail -n 1)
          test -n "$FILE"
          echo "FILE=$FILE" >> "$GITHUB_ENV"
          rclone copyto "$REMOTE/daily/$FILE" "work/$FILE"
          printf '%s' "$BACKUP_PASSPHRASE" > work/pass
          gpg --batch --yes --pinentry-mode loopback --passphrase-file work/pass -o work/backup.tar -d "work/$FILE"
          shred -u work/pass
          tar -C work -xf work/backup.tar
          shred -u work/backup.tar
          test "$(sha256sum work/dump.pgcustom | cut -d' ' -f1)" = "$(jq -r .dump_sha256 work/manifest.json)"
      - name: กู้ลง postgres:17 + เทียบจำนวนแถวและยอดรายเดือน
        run: |
          "$PGBIN/pg_restore" --no-owner --no-privileges -d "$RESTORE_URL" work/dump.pgcustom 2> work/restore.err || true
          shred -u work/dump.pgcustom
          "$PGBIN/psql" "$RESTORE_URL" -qAt -v ON_ERROR_STOP=1 -f scripts/backup/manifest.sql > work/restored.json
          node scripts/backup/backup-tool.mjs compare work/manifest.json work/restored.json | tee work/diff.txt
          test "${PIPESTATUS[0]}" = "0"
      - name: แจ้งผ่าน
        if: success()
        env:
          DISCORD_ALERT_WEBHOOK_URL: ${{ secrets.DISCORD_ALERT_WEBHOOK_URL }}
        run: bash scripts/backup/notify.sh report "ซ้อมกู้ไฟล์สำรองผ่าน" "ไฟล์ $FILE · $(jq '.row_counts | length' work/manifest.json) ตาราง · migration $(jq -r .last_migration work/manifest.json)"
      - name: แจ้งไม่ผ่าน (curl + jq เท่านั้น)
        if: failure()
        env:
          DISCORD_ALERT_WEBHOOK_URL: ${{ secrets.DISCORD_ALERT_WEBHOOK_URL }}
        run: bash scripts/backup/notify.sh error "ซ้อมกู้ไฟล์สำรองไม่ผ่าน" "$(head -n 10 work/diff.txt 2>/dev/null || true) ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}" --here
      - name: ล้างไฟล์
        if: always()
        run: |
          [ -d work ] && find work -type f -exec shred -u {} + || true
          rm -rf work
          [ -f ~/.config/rclone/rclone.conf ] && shred -u ~/.config/rclone/rclone.conf || true
```

`supabase/manual/backup-role.sql`:
```sql
-- ⛔ เจ้าของรันเองใน Supabase SQL editor ครั้งเดียว (ไม่ใช่ migration — ไม่ถูก db:push) — ADR-0050
-- role อ่านอย่างเดียวของ GitHub Actions: SELECT ทุกตาราง + BYPASSRLS (ทุกตารางเปิด RLS ไม่มี policy) + execute backup_log_auto
-- ถ้าคำสั่ง create role … bypassrls ถูกปฏิเสธ: ใช้ role postgres ผ่าน session pooler แทน และบันทึกความเสี่ยงใน OPERATIONS.md (ADR-0050 ข้อ 2)
create role dayo_backup with login bypassrls;
-- ตั้งรหัสผ่านด้วยคำสั่งต่อไปนี้ในหน้า SQL editor (พิมพ์รหัสเอง ห้ามบันทึกลงไฟล์หรือแชท):
--   alter role dayo_backup with password '<รหัสที่เจ้าของตั้ง>';
grant usage on schema public to dayo_backup;
grant usage on schema supabase_migrations to dayo_backup;
grant select on all tables in schema public to dayo_backup;
grant select on all sequences in schema public to dayo_backup;
grant select on all tables in schema supabase_migrations to dayo_backup;
alter default privileges for role postgres in schema public grant select on tables to dayo_backup;
alter default privileges for role postgres in schema public grant select on sequences to dayo_backup;
grant execute on function public.backup_log_auto(jsonb, bigint) to dayo_backup;
-- ตรวจ: ต้องได้ true, true
select rolbypassrls, rolcanlogin from pg_roles where rolname = 'dayo_backup';
```

รัน (ไม่ใช้ Docker): `npx vitest run --root packages/shared test/backupTool.test.ts && bash scripts/backup/notify.sh error "ทดสอบ" "รายละเอียด" --here --dry-run | jq .embeds[0].color`
Expected: PASS · พิมพ์ `14692657`

- [ ] **Step 6: (ช่อง Docker · รอบ 7) ตรวจ workflow + รันเทสต์ของ Step 4 บน main ที่ merge แล้ว**

Run: `npx --yes @action-validator/cli .github/workflows/backup.yml && npx --yes @action-validator/cli .github/workflows/restore-test.yml && npx vitest run --root packages/shared test/backupTool.test.ts && printf 'DA-YO_db_2026-09-01.tar.gpg\nDA-YO_db_2026-09-02.tar.gpg\n' | node scripts/backup/backup-tool.mjs retention --keep 1`
Expected: validator ไม่มี error · เทสต์ผ่าน · พิมพ์ `DA-YO_db_2026-09-01.tar.gpg`
(ถ้าใช้ `@action-validator/cli` ไม่ได้ ให้ใช้ `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest` · `npx` ที่นี่รันบนเครื่อง dev เท่านั้น ไม่ใช่ใน job)

- [ ] **Step 7: (ช่อง Docker · รอบ 7) dump.sh + manifest + backup_log_auto กับ Supabase local (0048–0052 อยู่แล้ว)**

Run:
```bash
npm run db:start && npm run db:reset
docker run --rm -v "$PWD:/w" -w /w postgres:17 bash -c 'apt-get update -qq && apt-get install -y -qq jq > /dev/null && PGBIN=/usr/lib/postgresql/17/bin bash scripts/backup/dump.sh "postgresql://postgres:postgres@host.docker.internal:54322/postgres" work-local'
jq '.row_counts.orders, .last_migration, (.dump_sha256 | length)' work-local/manifest.json
echo "select public.backup_log_auto(:'c'::jsonb, 1234);" | docker run --rm -i postgres:17 psql "postgresql://postgres:postgres@host.docker.internal:54322/postgres" -qAt -v c='{"orders":1}'
echo "select kind, bytes from public.backup_log where kind = 'auto' order by created_at desc limit 1; select public.backup_log_auto('[]'::jsonb, 1);" | docker run --rm -i postgres:17 psql "postgresql://postgres:postgres@host.docker.internal:54322/postgres" -At
rm -rf work-local
```
Expected: จำนวน `orders` ≥ 0 · `"0052…"` (migration ล่าสุด) · `64` · แถวล่าสุด `auto|1234` · คำสั่งสุดท้าย error `DY422` (ค่าผิด) · (ถ้า Docker บนเครื่องไม่รองรับ `host.docker.internal` ให้ใช้ `--network host` และ `127.0.0.1`)

- [ ] **Step 8: Commit** (เมื่อเจ้าของสั่ง — Step 1–5 commit ได้ก่อนในรอบ 1–2 · Step 6–7 ไม่มีไฟล์ใหม่ นอกจากแก้ที่พบ)
```bash
git add .github/workflows/backup.yml .github/workflows/restore-test.yml scripts/backup supabase/manual/backup-role.sql packages/shared/test/backupTool.test.ts
git commit -m "ci(backup): add nightly encrypted onedrive backup and monthly restore test"
```

---

## Task 15: เอกสารของ dayo

**agent:** docs-writer · sonnet · low (lane D หลัง Task 3b และ 8 merge) · GLOSSARY ตามร่างของ architect ใน Task 0 Step 4

**Files (Modify):** `docs/API.md` · `apps/web/openapi.yaml` · `docs/DATA-CONTRACT.md` · `docs/GLOSSARY.md` · `docs/SETUP.md` · `docs/OPERATIONS.md` · `docs/PLAN.md`

- [ ] **Step 1: `docs/API.md`** — หัวข้อใหม่ "สำหรับแท็บเล็ต POS (ADR-0048/0049)": ข้อกำหนดร่วม (ตาราง §4.1 ของสเปก POS ย่อ) · CORS (หัวทั้งหมด + OPTIONS 204) · E1 (พารามิเตอร์, รูปคำตอบ changed true/false, `pricing`, `supported_kinds`/`supported_fields`) · E2 (ซอง, ชนิด `order`/`order_void`, ตาราง status/reason ทั้ง rejected และ deferred, ลำดับตรวจเต็มจาก Task 3b Step 4, กันซ้ำ) · E3 ฟิลด์ใหม่ · ตัวอย่างคำขอ/คำตอบ = อ้างไฟล์ใน `apps/web/test/fixtures/pos-contract/` · ขนาดคำตอบ E1 ที่วัดใน Task 16 Step 4

- [ ] **Step 2: `apps/web/openapi.yaml`** — เพิ่ม path `/pos/catalog` (GET, OPTIONS), `/pos/push` (POST, OPTIONS), schema `PosCatalogResponse` `PushRequest` `PushRow` `PushResult` `RowVerdict` และฟิลด์ใหม่ใน `Order` ของ `/orders` · ทุก operation ใต้ `/api/v1` มี response 404/401/429/500 พร้อม header `Access-Control-Allow-Origin` `Vary` `Access-Control-Expose-Headers`

- [ ] **Step 3: `docs/DATA-CONTRACT.md`** — §2.2 scope `staff:read` · §2.4 คอลัมน์ใหม่ `orders` + ตาราง `catalog_versions` `order_duplicate_flags` `promotion_active_windows` · §3 RPC ใหม่ทั้งหมดของ Task 1–4 + รหัส `DY403 pos_bill_read_only` `DY409 external_ref_taken` + คำนำหน้า `unknown_code:` `staff_ref_invalid:` `parent_pending:` · §8 endpoint ใหม่ · กติกา "รหัสที่มีบิลอ้างเปลี่ยนไม่ได้" · `backup_log.kind = auto` · `audit_log.action` ค่าใหม่ `duplicate_flag_resolve` `duplicate_flag_auto_close` · กติกา "ทุก migration ที่ grant execute on all functions ให้ service_role ต้องถอน `backup_log_auto` ซ้ำ" · `dayo.pos_push` (รับพนักงาน removed เฉพาะ E2) · โปรที่ปิดแล้วใช้กับบิล POS ได้เมื่อ `sold_at` อยู่ในช่วงเปิดของโปร (`promotion_active_windows`) · GUC `dayo.test_faults` (เครื่อง dev เท่านั้น)

- [ ] **Step 4: `docs/GLOSSARY.md`** — แถวใหม่: แหล่ง · ผู้บันทึก · ฉบับแคตตาล็อก · คำตัดสินรายแถว · บิลน่าจะซ้ำ · ส่วนต่างเล็กน้อย · สำรองอัตโนมัติ · ซ้อมกู้

- [ ] **Step 5: `docs/SETUP.md`** — หัวข้อ "สำรองอัตโนมัติไป OneDrive (ADR-0050)" ขั้นเจ้าของเป็นข้อ (ตรงกับ Task 17 ขั้น 4–8) รวม "เก็บสำเนา `BACKUP_PASSPHRASE` นอก GitHub แล้วติ๊กยืนยัน" · หัวข้อ "เปิด API ให้แท็บเล็ต (ADR-0048 ข้อ 7)": เงื่อนไขเปิดครบ 3 ข้อ · ตั้ง `POS_ORIGINS` · สร้างคีย์ + QR · `API_V1_ENABLED=1` **ทำหลังก้อน 2 ผ่านเท่านั้น**

- [ ] **Step 6: `docs/OPERATIONS.md`** — "กู้คืนจากไฟล์สำรองอัตโนมัติ" (ดาวน์โหลดจาก OneDrive → `gpg -d` → `tar -x` → `pg_restore --no-owner --no-privileges -d <ฐานใหม่>` → ตรวจด้วย `scripts/backup/manifest.sql`) · "ตรวจ Discord `#dayo-ระบบ` ทุกเช้า" · "เมื่อ GH_SECRETS_PAT ใกล้หมดอายุ" · "เมื่อ token OneDrive หมดอายุ (รัน `rclone config reconnect onedrive:` แล้วใส่ `RCLONE_CONF` ใหม่)" · "ธงบิลน่าจะซ้ำ — owner ทำอะไร" · "ส่วนต่างบิลแท็บเล็ต — อ่านการ์ดอย่างไร" · "export-pos-parity ทุกครั้งที่ `pricing.files_sha256` เปลี่ยน"

- [ ] **Step 7: `docs/PLAN.md`** — แถวเฟส 13 "เชื่อม POS ก้อน 1" อ้างแผนนี้ + ADR-0048/0049/0050

- [ ] **Step 8: Commit** (เมื่อเจ้าของสั่ง)
```bash
git add docs/API.md apps/web/openapi.yaml docs/DATA-CONTRACT.md docs/GLOSSARY.md docs/SETUP.md docs/OPERATIONS.md docs/PLAN.md
git commit -m "docs: document the pos api, duplicate flags and automatic backup"
```

---

## Task 16: รวมงาน · ตรวจครบ · รีวิว

**agent:** หัวหน้าทีม (merge) → test-runner · haiku (รันและสรุป) → code-reviewer · sonnet + security-reviewer · opus (ขนานกันได้ — อ่านอย่างเดียว)

- [ ] **Step 1: merge ตามลำดับ** `block1/db` → `block1/shared` → `block1/web` → `block1/bot` → `block1/ops` → docs (ขัดกันที่ `database.types.ts` ใช้ของ lane A แล้วรัน `npm run db:types` ใหม่)

- [ ] **Step 2: ตรวจทั้ง repo**

Run: `npm install && npm run db:reset && npm run db:types && npm run ci && npx vitest run --root packages/shared test/db`
Expected: `ci` ผ่าน (typecheck + test + build ทุก workspace) · เทสต์ฐานข้อมูลผ่านทุกไฟล์ (`pos_catalog` `pos_bills` `pos_checks` `pos_push` `pos_reads` `pos_parity` + ของเดิม) · `backupTool.test.ts` `posParity.test.ts` ผ่าน · `api.posContract.test.ts` 22/22 ไม่มี SKIP · `git diff --exit-code packages/shared/src/database.types.ts` ไม่มีความต่าง

- [ ] **Step 3: ⛔ เจ้าของตั้งค่าเครื่อง dev** (agent อ่าน `.dev.vars` ไม่ได้) — ใน `apps/web/.dev.vars` เพิ่ม `API_V1_ENABLED=1` และ `POS_ORIGINS=http://localhost:5173` · เปิด `npm run dev:web` · สร้าง API key "แท็บเล็ตทดสอบ" ที่ `/settings/api-clients` เลือก scope `catalog:read staff:read orders:read orders:write` (เห็น QR) · ใส่คีย์ในตัวแปร shell `DAYO_KEY` ของเครื่องเจ้าของเอง

- [ ] **Step 4: ทดสอบเชื่อมจริงบนเครื่อง (เจ้าของรัน · devops ช่วยอ่านผล)**

Run:
```bash
curl -si -H "Origin: http://localhost:5173" -H "Authorization: Bearer $DAYO_KEY" "http://localhost:3000/api/v1/pos/catalog?known_version=0" -o e1.json -D - | grep -iE "^(HTTP|access-control|vary)"
wc -c e1.json
curl -si -X OPTIONS -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST" http://localhost:3000/api/v1/pos/push | grep -iE "^(HTTP|access-control)"
curl -si -H "Origin: http://localhost:5173" -H "Authorization: Bearer wrong" http://localhost:3000/api/v1/pos/catalog | grep -iE "^(HTTP|access-control)"
```
Expected: E1 `HTTP/1.1 200` + หัว CORS ครบ · ขนาด `e1.json` (บันทึกใน API.md — คาด 150–250 KB กับเมนูจริง) · OPTIONS `204` + `Access-Control-Allow-Methods: GET, POST, OPTIONS` · คีย์ผิด `401` + `Access-Control-Allow-Origin: http://localhost:5173`

- [ ] **Step 5: code-reviewer (sonnet)** — ตรวจ diff ทั้งก้อนกับ CLAUDE.md, ADR-0048/0049/0050, DATA-CONTRACT, GLOSSARY: migration ใหม่เท่านั้น · ทุกตัวที่ "ลอกฟังก์ชันเดิม" ต่างจากต้นฉบับเฉพาะบรรทัดที่มีป้าย ADR-0049 (ใช้ `diff` กับไฟล์ migration ต้นทาง) · ทุก RPC ใหม่มี `set search_path` · เทสต์ครอบเกณฑ์ก้อน 1 ทุกข้อ (ตารางท้ายแผน)

- [ ] **Step 6: security-reviewer (opus)** — รายการตรวจบังคับ:
  1. CORS: เทียบ origin แบบตรงตัว (ไม่ใช้ `endsWith`/regex) · ไม่มี `Access-Control-Allow-Credentials` · origin ไม่อนุญาตไม่มีหัว CORS
  2. E1 ไม่มีต้นทุน/`buy_price`/`line_user_id`/พนักงาน `pending` · `staff:read` บังคับจริง
  3. E2: `detail` ไม่สะท้อน `note`/`reason`/`discount_reason`/id พนักงาน/ข้อความดิบ (ไล่ทุกข้อความ DY422 ที่ไหลเข้า `dayo_pos_error_verdict`) · route ไม่ log body · scope ตรวจทั้งชั้นเว็บและ `api_pos_push` (∩ กับตาราง)
  4. `dayo_require_actor` รับ `removed` เฉพาะ actor ที่มี `api_client_id` **และ** `dayo.pos_push = '1'` (ตั้งโดย `api_pos_push` เท่านั้น) · `/v1/orders` เดิม เว็บ บอท ยังต้อง active (เทสต์ Task 3b)
  5. `pos_bill_read_only` ครอบ `update_order` และ `cancel_order` ทุกทาง (เว็บ/บอท/owner)
  6. ไม่มีโค้ดทดสอบในเส้นทางข้อมูลเงินนอกจาก `dayo_pos_apply_order` ที่ดู GUC ระดับฐาน `dayo.test_faults` (production ต้องไม่มีค่า · PostgREST/service_role ตั้งไม่ได้) · trigger `promotions_track_window` ไม่มีกิ่งทดสอบและตั้งเวลาย้อนหลังไม่ได้ · `promotion_active_windows` เขียนได้เฉพาะ trigger ในการใช้งานจริง (เทสต์ insert ตรงด้วย service_role บนเครื่อง dev)
  7. `backup_log_auto` security definer + `search_path` · role `dayo_backup` สิทธิ์น้อยที่สุด
  8. workflow: `permissions: contents: read` · ไม่มี `pull_request_target` · `persist-credentials: false` · **ไม่มี `npm ci`/`npx`/`setup-node` ใน job สำรอง/ซ้อมกู้** (เทสต์ `backupTool.test.ts` บังคับ) · ค่าลับอยู่ใน `env` ของ step ที่ใช้เท่านั้น · ไม่ echo ค่าลับ · `::add-mask::` ของ rclone.conf ที่ต่ออายุ · dump/tar/passphrase ถูก `shred` ทันทีหลัง `gpg` · ขั้นเขียน token กลับเป็น `if: always()` · PAT ใช้เฉพาะ `gh secret set RCLONE_CONF` · แจ้งล้มด้วย `curl`+`jq` ล้วน
  8b. `backup_log_auto` ถูกถอนจาก `service_role` (เทสต์ pos_reads 42501) · route กันตก `/api/v1/[...rest]` ไม่แตะ auth/DB · แถวที่มี U+0000/surrogate เดี่ยวไม่ทำให้ทั้งคำขอ 5xx · `dayo.pos_push` ถูกตั้งเฉพาะใน `api_pos_push` (ไม่มี RPC อื่นตั้งค่านี้) · โปรที่ปิดหลังขายใช้ได้เฉพาะ `p_include_inactive` ของบิล POS
  9. QR สร้างในเครื่อง ไม่มีคำขอออกนอก
  10. `API_V1_ENABLED` ไม่ถูกตั้งในไฟล์ใดที่ commit

- [ ] **Step 7: แก้ผลตรวจระดับ สูง/วิกฤต** โดย implementer ตัวเดิม (SendMessage ต่อบริบทเดิม) → test-runner รัน Step 2 ซ้ำ

- [ ] **Step 8: หัวหน้าสรุปให้เจ้าของ** (ไทย): สิ่งที่เปลี่ยน · ผลเทสต์ · วิธีลองด้วยมือ (Step 3–4) · ADR ที่แตะ · ⛔ ขั้นที่เจ้าของต้องทำใน Task 17 → รอเจ้าของสั่ง commit/merge

---

## Task 17: ⛔ production + สำรองจริง (เจ้าของทำเอง · devops ช่วยแสดงคำสั่ง/อ่าน log)

devops แสดงคำสั่งและผลที่จะเกิด แล้ว **หยุดรอเจ้าของพิมพ์ยืนยันทุกขั้น** (TEAM-WORKFLOW · devops.md)

- [ ] **ขั้น 1 ⛔ db:push** — `npm run db:push` (migration 0048–0052 ขึ้น production) · ตรวจใน SQL editor: `select current_setting('dayo.test_faults', true);` ต้องได้ว่าง (null) · `select version from public.catalog_versions;` มี 1 แถว · `select count(*) from public.promotion_active_windows where deactivated_at is null;` = จำนวนโปรที่ active
- [ ] **ขั้น 2 ⛔ deploy** — `npm run release:deploy` (เว็บ + บอท) · **ไม่ตั้ง** `API_V1_ENABLED` · ตรวจ `curl -si https://<dayo-web>/api/v1/pos/catalog` = `404` · `curl -si -X OPTIONS -H "Origin: https://x" https://<dayo-web>/api/v1/pos/push` = `204`
- [ ] **ขั้น 3 ⛔ ส่งของให้ทีม POS** — คัดลอก `apps/web/test/fixtures/pos-contract/*.json` → POS `packages/contracts/fixtures/dayo-api/` (เทียบ `sha256sum`) · อ่าน `pricing.commit` ของ production (หลังเปิด API ในก้อน 2 — ก่อนนั้นใช้ commit ที่ deploy จาก `npm run version:print`) แล้วรันบน commit นั้น: `npm run db:reset && npm run export-pos-parity -- --expect-commit <sha>` → วาง `pos-parity.json` ที่ POS `packages/dayo-pricing/fixtures/`
- [ ] **ขั้น 4 ⛔ role สำรอง** — รัน `supabase/manual/backup-role.sql` ใน SQL editor + ตั้งรหัสผ่านเอง · ถ้า `bypassrls` ถูกปฏิเสธ → ใช้ `postgres` และบันทึกความเสี่ยงใน OPERATIONS
- [ ] **ขั้น 5 ⛔ rclone** — บนเครื่องเจ้าของ: ติดตั้ง rclone → `rclone config` → New remote ชื่อ `onedrive` ชนิด `onedrive` (ใช้แอปของ rclone เอง ไม่ใส่ client id) → ล็อกอินบัญชี OneDrive ของร้าน → `rclone mkdir onedrive:DAYO/Backups/auto/daily` และ `…/monthly` → เปิด `rclone config file` แล้วคัดลอกเนื้อหาทั้งไฟล์
- [ ] **ขั้น 6 ⛔ PAT** — GitHub → Settings → Developer settings → Fine-grained tokens → เฉพาะ repo `dayo-shop-system` → Repository permissions: **Secrets: Read and write** เท่านั้น → อายุ ≤ 1 ปี
- [ ] **ขั้น 7 ⛔ secrets ของ repo** (Settings → Secrets and variables → Actions): `SUPABASE_DB_URL` (session pooler พอร์ต 5432 ผู้ใช้ `dayo_backup.<project-ref>`) · `BACKUP_PASSPHRASE` (สุ่มยาว ≥ 32 ตัว **เก็บสำเนานอก GitHub**) · `RCLONE_CONF` · `DISCORD_ALERT_WEBHOOK_URL` (ตัวเดียวกับของ Worker) · `GH_SECRETS_PAT`
- [ ] **ขั้น 8 ⛔ รันครั้งแรก** — Actions → backup → Run workflow → เขียว · OneDrive มี `DA-YO_db_<วันนี้>.tar.gpg` · หน้า `/settings/backup` แสดง "สำรองล่าสุด" เป็นวันนี้ · ดาวน์โหลดไฟล์มาถอดรหัสบนเครื่อง: `gpg -d DA-YO_db_<วัน>.tar.gpg > b.tar && tar -tf b.tar` เห็น `dump.pgcustom` `manifest.json`
- [ ] **ขั้น 9 ⛔ บังคับล้ม 1 ครั้ง** — Run workflow ด้วย `force_fail = true` → Discord `#dayo-ระบบ` ได้ 🔴 + `@here` และอีเมลของ GitHub
- [ ] **ขั้น 10 ⛔ ซ้อมกู้ 1 ครั้ง** — Actions → restore-test → Run workflow → 📊 "ซ้อมกู้ไฟล์สำรองผ่าน" ใน Discord
- [ ] **ขั้น 11 ⛔ 3 คืนติด** — ตรวจ 3 รันตามตารางเขียวติดกัน · OneDrive มี 3 ไฟล์ · `RCLONE_CONF` ถูกอัปเดต (ดู "Updated" ของ secret)
- [ ] **ขั้น 12 ⛔ ยืนยันสุดท้าย** — `API_V1_ENABLED` ยังไม่ตั้งใน production (`curl` = 404) · แจ้งทีม POS ว่าก้อน 1 เสร็จ (ก้อน 2 ทดสอบเชื่อมจริงกับ Supabase local ได้แล้ว)

---

## เกณฑ์ก้อน 1 (สเปก §9) → ที่ตรวจ

| เกณฑ์ | ตรวจที่ |
|---|---|
| `npm run ci` ผ่าน | Task 16 Step 2 |
| ทุกไฟล์ fixture ใน §4.11 ผ่านเทสต์ Route Handler | Task 6 harness (22/22) — Task 16 Step 2 |
| ส่งแถวเดิมซ้ำ = `duplicate` | `pos_push.db.test.ts` "ส่งแถวเดิมซ้ำ" · fixture `e2-order-duplicate` |
| key เดิมเนื้อหาต่าง = `CONFLICT` | `pos_push.db.test.ts` · fixture `e2-key-reused-different-content` |
| `receipt_no` เดิม + `pos_order_id` ใหม่ ก่อน/หลังลบคีย์ 30 วัน = `CONFLICT` | `pos_push.db.test.ts` · `pos_bills.db.test.ts` (DY409) · fixture `e2-receipt-conflict` |
| rejected แล้วส่ง key เดิมข้อมูลที่แก้ = `accepted` | `pos_push.db.test.ts` |
| ทุกแถวของตารางแผนที่ error ได้คำตัดสินตามตาราง | `pos_checks.db.test.ts` "ตารางแผนที่ error" (Task 3a) · แถว 23505: `pos_push.db.test.ts` ธงทดสอบ `__fault_23505__` + ส่งพร้อมกันสองคำขอ + `dayo_pos_after_unique` (Task 3b) · เคสจริง (INVALID/UNKNOWN_CODE/UNKNOWN_STAFF/FORBIDDEN/PARENT_PENDING/CONFLICT/CLOCK_AHEAD/UNSUPPORTED) |
| error ไม่ได้แผนที่ (XX000) = `deferred SERVER_ERROR` เฉพาะแถว HTTP 200 | `pos_push.db.test.ts` (ธงทดสอบ) · fixture `e2-row-server-error` |
| `voided_at` เกินเซิร์ฟเวอร์ 7 นาที = `deferred CLOCK_AHEAD` | `pos_push.db.test.ts` order_void · fixture `e2-void-clock-ahead` |
| ชนิด/ฟิลด์ไม่รู้จัก = `deferred UNSUPPORTED` | `pos_push.db.test.ts` · fixture `e2-unsupported-kind-and-field` |
| `computed_total` มีทุกบิล | `pos_push.db.test.ts` · `pos_bills.db.test.ts` |
| CORS: 401/404 (API ปิด)/429/5xx มีหัวครบ · OPTIONS 204 แม้ API ปิด | `api.cors.test.ts` (รวม route กันตก `/api/v1/[...rest]`) · fixture `err-*` (รวม `err-404-unknown-path`) `preflight-*` · Task 16 Step 4 |
| (สเปก §4.5) error ของแถวไม่ทำให้ทั้งคำขอเป็น 5xx | savepoint ชั้นนอกต่อแถวใน `api_pos_push` (Task 3b) · `api.posPush.test.ts` แถว U+0000/surrogate เดี่ยว (Task 8) |
| (§5.2) ตัวคิดราคาเท่ากันบนเส้นทางจริงของ E2 | `pos_parity.db.test.ts` "เส้นทางจริงของ E2" (Task 13) |
| E1 มี `pricing` และ `supported_kinds` | fixture `e1-*` · `pos_catalog.db.test.ts` |
| เปลี่ยนรหัสช่องทาง/วิธีชำระที่มีบิลอ้าง = `DY422` | `pos_bills.db.test.ts` |
| ยกเลิก `voided_at` วันเดียวกันแต่ส่งวันถัดไป = ผ่าน · คนละวัน = `FORBIDDEN` | `pos_push.db.test.ts` order_void · fixture `e2-void-cross-day` |
| พนักงาน `removed` = ผ่าน | `pos_push.db.test.ts` |
| ตัวแปรที่ปิดใช้แล้ว = ผ่าน | `pos_push.db.test.ts` (+ ยอดเท่าตอนขาย §5.3 ข้อ 14 · ตัวเลือกนมที่ปิดแล้ว · **โปรที่ปิดแล้ว**: คิดเฉพาะเมื่อ `sold_at` อยู่ในช่วงเปิด (ทดสอบระดับวินาที · ปิด-เปิดหลายรอบ · แก้ชื่อหลังขายไม่มีผล)) |
| รหัสเมนูไม่รู้จัก = `UNKNOWN_CODE` แถวอื่นยังผ่าน | `pos_push.db.test.ts` · fixture `e2-unknown-code-other-row-ok` |
| แก้ราคาเมนู → ฉบับเพิ่ม · รับเข้าแก้ `buy_price` → ไม่เพิ่ม | `pos_catalog.db.test.ts` |
| บอท + POS ห่าง 9 นาที = ติดธง · 11 = ไม่ติด · แหล่งเดียวกัน = ไม่ติด | `pos_bills.db.test.ts` |
| owner แก้บิล POS บนเว็บ = `DY403` | `pos_bills.db.test.ts` · UI Task 10 |
| สำรองรันสำเร็จ 3 คืนติด · ถอดรหัสได้ · ซ้อมกู้ผ่าน 1 ครั้ง · บังคับล้มแล้ว Discord ได้ข้อความ | Task 17 ขั้น 8–11 |
| `API_V1_ENABLED` ยังปิดใน production | Task 17 ขั้น 2 และ 12 |
| (ส่งมอบอื่นในแถวก้อน 1) E3 ฟิลด์ใหม่ · QR ของคีย์ · scope `staff:read` · ธงซ้ำ + แดชบอร์ด · บิล POS อ่านอย่างเดียวบนเว็บ/บอท · `export-pos-parity` | Task 4/9 · Task 10 · Task 1/10 · Task 2/4/10/12 · Task 2/10/12 · Task 13 |

## จุดตีความจากสเปก (architect ของ dayo ใส่ใน ADR ตาม Task 0 Step 2 · แจ้งทีม POS)

1. **check `source='pos'` ⇒ …** บังคับเฉพาะแถวที่มี `pos_order_id` (มาจาก E2) — ไม่งั้น `POST /v1/orders` เดิมที่สเปกล็อกว่า "คงอยู่ไม่เปลี่ยน" จะพัง
2. **(ก0) `pos_excluded_orders`** ยังไม่มีตารางในก้อนนี้ → ก้อน 3 เพิ่มในตำแหน่งที่มาร์กไว้ใน `dayo_pos_apply_order`
3. **`sale_date` > วันนี้** (ข้ามเที่ยงคืนภายใน 5 นาทีที่ยอมให้) = `deferred CLOCK_AHEAD` ไม่ใช่ `INVALID`
4. **`cancelled_at` ของบิล POS = `voided_at`** (เวลาเครื่อง เชื่อได้แบบ `sold_at`) · `approved_by` + `voided_at` อยู่ใน `audit_log.after`
5. **คีย์ย่อยที่ไม่รู้จักของ `bill_discount`/`totals`** = `deferred UNSUPPORTED` (รายการ `supported_fields` ที่ล็อกไม่ได้แจกคีย์ย่อยของสองฟิลด์นี้) — แท็บเล็ตไม่ส่งคีย์ย่อยอื่นอยู่แล้ว
6. **sha256 ของไฟล์ตัวคิดราคา** คิดหลังแปลง CRLF → LF — **ทีม POS ต้องคิด `VENDOR.json` แบบเดียวกัน** ไม่งั้นแถบเหลืองขึ้นถาวรเมื่อ checkout บน Windows
7. **`items_signature` ตามสเปกตรงตัว**: ตรวจ 0047 แล้ว — `dayo_impl_price_line` ตั้ง `v_grade_used` เฉพาะเมื่อส่ง `grade` มา จึงบิลบอทมัตจะที่ไม่ระบุเกรดมี `grade_code` ว่าง และไม่จับคู่กับบิล POS ที่ส่งเกรดปกติ → ธงหลุดได้ในกรณีนี้ (ไม่แก้ในก้อนนี้ — ถ้าต้องการ ให้แก้สเปก §4.8 ก่อน)
8. **"รุ่นตัวคิดราคา" บนแดชบอร์ด** = commit ของ dayo ที่ deploy อยู่ (แท็บเล็ตไม่ส่งรุ่นของตัวเองใน E2) · ฉบับแคตตาล็อกของเซิร์ฟเวอร์ ณ ตอนบิลเข้าเก็บใน `orders.pricing_context.server_catalog_version`
9. **`Access-Control-Allow-Methods: GET, POST, OPTIONS`** ตามสเปก แม้ `PATCH /v1/orders/{order_no}` เดิมยังมี (แท็บเล็ตไม่ใช้)
10. **fixture สัญญาเป็นของ dayo (D82)**: `apps/web/test/fixtures/pos-contract/` คือต้นฉบับ (สะท้อนเซิร์ฟเวอร์จริง) · POS คัดลอกไป `packages/contracts/fixtures/dayo-api/` แล้วตรวจ sha256 หลังแปลง CRLF → LF · `.gitattributes` `*.json text eol=lf` ทั้งสองโฟลเดอร์
11. **ลบไฟล์สำรองเก่าแบบนับไฟล์** (30/12 ล่าสุด) แทน `rclone delete --min-age` — ถ้าสำรองหยุดหลายวัน ไฟล์เก่าไม่ถูกลบจนเหลือศูนย์ · ผู้คุมงานรับแล้ว **เจ้าของอนุมัติผ่าน ADR-0050 ใน Task 0** · สำเนารายเดือน = ไฟล์ของรอบแรกที่สำเร็จในเดือน (รอบวันที่ 1 ล้มก็ยังมี)
12. **`categoryLabel`** = `coalesce(menu_items.category_label, family)`
13. **ทดสอบ `SERVER_ERROR` และ 23505 ปลายทางถึงปลายทาง** ด้วย GUC ระดับฐาน `dayo.test_faults` ที่ seed ของเครื่อง dev ตั้ง (`alter database`) — ไม่มีตารางธง · PostgREST/service_role ตั้งไม่ได้ · production ไม่มีค่า (Task 17 ขั้น 1 ตรวจ)
14. **โปรที่ถูกปิดแล้วกับบิล POS** (สเปก §4.5 ข้อ 2) ตัดสินด้วยตาราง `promotion_active_windows(promotion_id, activated_at, deactivated_at)` ที่ trigger `promotions_track_window` ดูแล (insert ที่ active / false → true = เปิดช่วงใหม่ · true → false = ปิดช่วง) · ใช้เมื่อมีช่วงที่ `activated_at ≤ sold_at < coalesce(deactivated_at, ∞)` เทียบ `sold_at` **เต็มความละเอียด** (ไม่ใช่ `sale_time` ที่ตัดวินาที) และผ่านเงื่อนไขวัน/เวลา/ช่องทางของโปรเอง · ปิด-เปิด-ปิดหลายรอบถูกทุกรอบ · แก้ชื่อ/ค่าอื่นไม่แตะช่วง · migration เติมช่วงเปิด 1 ช่วงให้โปรที่ active อยู่ (เริ่มที่ `created_at`) · โปรที่ปิดอยู่ตอน migration ไม่มีช่วง = ไม่ใช้กับบิล POS · ตัวแปร/ตัวเลือก/ช่องทาง/วิธีชำระที่ปิดแล้วไม่ใช้เวลา (ใช้ได้เสมอเมื่อรหัสมีในร้าน)
15. **พนักงาน `removed` รับเฉพาะทาง E2** (`dayo.pos_push`) — `POST/PATCH /v1/orders` เดิมยังต้อง active ตามพฤติกรรมเดิม
16. **`audit_log.action` ค่าใหม่** `duplicate_flag_resolve` `duplicate_flag_auto_close` (0052) · ธงเปิดที่คู่ไม่ตรงเงื่อนไขหลังแก้บิล = ระบบปิดเอง `resolved_not_duplicate` พร้อมหมายเหตุ "ระบบ: …"
17. **`backup_log_auto` ถอนจาก `service_role`** — เรียกได้เฉพาะ `dayo_backup` · migration ถัดไปทุกไฟล์ต้องถอนซ้ำหลัง `grant execute on all functions`
18. **ทุกเคส parity มี `saleTime`** (แท็บเล็ตส่งเวลาขายทุกบิล — แผน 07 §7) · ใช้เป็นกติกาของไฟล์ fixture parity ทั้งสองฝั่ง
