# ก้อน 2 — POS ขายด้วยแคตตาล็อก/ราคา/โปร/พนักงานกลางของ dayo · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แท็บเล็ตขายด้วยเมนู ราคา โปร ช่องทาง วิธีชำระ และรายชื่อพนักงานที่ดึงจาก `GET /v1/pos/catalog` ของ dayo คิดราคาด้วยสำเนาตัวคิดราคาของ dayo (ต่าง 0 สตางค์) ขายได้ตอนออฟไลน์ แล้วส่งบิล/ยกเลิกบิลขึ้น `POST /v1/pos/push` ด้วยคำตัดสินรายแถว โดยไม่มีบิลหายหรือซ้ำ

**Architecture:** เพิ่มแพ็กเกจ `@dayo/dayo-pricing` (สำเนาไฟล์ตัวคิดราคาของ dayo ปักกับ commit + sha256) ห่อด้วย `priceCart` ใน `@dayo/domain` ที่แปลงบาท↔สตางค์ที่ขอบสัญญาจุดเดียว (`money-edge.ts`) · `@dayo/contracts` ได้ zod schema ของ E1/E2/E3 + สำเนา fixture สัญญาชุดกลางของ dayo ใน `fixtures/dayo-api/` · `@dayo/dayo-mock` เป็น mock server ที่ทำตามสัญญาเพื่อพัฒนาขนานกับก้อน 1 · แท็บเล็ตเก็บสำเนาแคตตาล็อกเป็นก้อน JSON รูป E1 ใน SQLite เขียนบิลลงเครื่องก่อน (ตาราง + `outbox` ในธุรกรรมเดียว) แล้วตัวส่งใน Worker ส่งตามทีหลัง — การอ่าน/เขียนฐานผ่านคิว serial เดิม แต่การรอเครือข่ายอยู่นอกคิว (ขายได้ขณะกำลังส่ง)

**Tech Stack:** TypeScript 5.9 · pnpm + turbo · zod 4 · vitest 5 + fast-check 4 · React 19 + TanStack Router/Query · SQLite WASM (OPFS) + drizzle-orm 0.45 · Comlink Worker · Playwright 1.63 · Node 22 (`node:http` สำหรับ mock)

**Spec:** `docs/design/04-สเปกการเชื่อม-POS-กับ-dayo.md` (§3, §4.1–4.7, §4.11, §5, §6, §7, §9 ก้อน 2, §11, §13) · การตัดสินใจ D59–D81 ใน `docs/design/00-บันทึกการตัดสินใจ.md` (สำคัญ: D60 ซ่อนสต็อก · D61 แหล่ง/ผู้บันทึก · D63 สตางค์↔บาท · D72 สำเนาปักรุ่น + sha256 · D80 นาฬิกาเตือนไม่บล็อก) · ร่าง ADR `docs/design/dayo-adr-drafts/P1*.md`, `P2*.md` · ทีมและ workflow `docs/design/05-ทีม-agent-และ-workflow.md` · แผนก้อน 1 (ฝั่ง dayo เขียนขนานกัน): `docs/superpowers/plans/2026-09-25-06-block1-dayo-api.md` (**ถูกแทนด้วยงานที่ dayo ship เอง** — ก้อน 1A ของ dayo · ใช้อ้างอิงเท่านั้น)

> **ปรับตาม dayo ที่ ship แล้ว (26 ก.ย. 2569)** — dayo ยอมรับ ADR-0048–0059 และ ship ก้อน 1A (migration 0048–0052) ไม่ตรงกับแผนก้อน 1 ของเราทุกจุด · สเปก 04 แก้แล้ว (§13.6 รายการ S1–S27 พร้อม file:line ของ dayo) · งานปรับอยู่ใน **§0.6 (A1–A5)** · Task 1–9 และ 16 ทำเสร็จหรือกำลังทำ — ข้อความเดิมไม่แก้ ส่วนที่ต้องตามให้ดู §0.6 · Task 10–15 และ 17–23 แก้ข้อความแล้ว (ย่อหน้า **"ปรับตาม dayo"** ต้นแต่ละ task **มีผลเหนือโค้ดตัวอย่างข้างล่างที่ขัดกัน**) · **ถ้าโค้ดตัวอย่างในแผนขัดกับ SQL ของ dayo ให้ถือ SQL เป็นความจริง** · จุดที่รอเจ้าของติดป้าย "รอเจ้าของ O1/O2/O3"

## Global Constraints

- เงินในแท็บเล็ตเป็น **สตางค์จำนวนเต็ม** ทุกจุด · แปลงบาท↔สตางค์ได้เฉพาะ `edgeBahtToSatang` / `edgeSatangToBaht` ใน `packages/domain/src/money-edge.ts` (ชื่อไฟล์และชื่อฟังก์ชันล็อก — spec §4.2) · `apps/pos/**`, `packages/dayo-pricing/src/**`, `packages/domain/src/{price-cart,order-row,order-draft}.ts` **ห้าม** import `bahtToSatang` / `bahtToUsat` (มีเทสต์บังคับ)
- ขอบเงิน: เพดาน `9_999_999_999` สตางค์ (`numeric(10,2)`) · ขอบสัญญาไม่ปัดทางธุรกิจ · ค่าไม่ใช่เงิน (`priceMarkupPct`, `feePct`, `percent`, `multiplier`, `qty`) ไม่ผ่านตัวแปลง
- ตัวคิดราคา: สำเนา `packages/shared/src/{money,promotions,cost,fmt,shopSettings,types,time}.ts` ของ dayo **ไม่แก้แม้แต่บรรทัดเดียว** อยู่ที่ `packages/dayo-pricing/src/vendor/` · `packages/dayo-pricing/VENDOR.json` = `{ "repo": "dayo-shop-system", "commit": "<sha 40 ตัว>", "files": { "packages/shared/src/<name>.ts": "<sha256>" } }` · **sha256 คิดจากเนื้อ UTF-8 หลังแปลง CRLF → LF** (กติกาเดียวกับ `scripts/pricing-manifest.ts` ของ dayo — แผนก้อน 1 จุดตีความข้อ 6) · ชื่อแพ็กเกจ `@dayo/dayo-pricing` (ห้ามตั้งชื่อ `@dayo/shared`)
- fixture สัญญา (**คำวินิจฉัย O4 — แทน D82 ชั่วคราว** · สเปก §4.11 ข้อ 2): **POS เป็นเจ้าของ** ต้นฉบับที่ `packages/contracts/fixtures/dayo-api/*.json` + `.gitattributes` (`*.json text eol=lf`) เพราะ dayo ship โดยไม่มีชุด fixture · รายชื่อ = `CONTRACT_FIXTURE_NAMES` (วันนี้ 22 ไฟล์ · **ไม่มีเทสต์หรือขั้นตรวจใดนับจำนวนเอง**) · เนื้อหาสร้างจาก **SQL ของ dayo `main`** แล้วแทนด้วย **คำตอบจริงของ `dayo-test`/Supabase local** ใน Task 23 · sha256 **หลังแปลง CRLF → LF** (`pnpm --filter @dayo/contracts fixtures:hashes`) ใช้เทียบเมื่อ dayo รับชุดนี้ไปเป็นเทสต์ของตัวเอง (ก้อน 1B) · ห้ามแก้เนื้อหาเพื่อให้เทสต์ POS ผ่าน (ต่างจากคำตอบจริง = แก้ fixture ให้ตรงของจริงแล้วแก้โค้ด) · แคตตาล็อกทดสอบของ POS แยกอยู่ `packages/contracts/fixtures/pos-test/e1-catalog-rich.json` (ไม่ใช่สัญญา)
- สัญญา API (ล็อก §4.1): `Authorization: Bearer <api_key>` · รูปคำตอบ `{ok:true,data}` / `{ok:false,error:{code,message}}` · เวลาที่ส่ง `YYYY-MM-DDTHH:mm:ss.sssZ` · เวลาที่รับ parse ได้ทั้ง `Z` และ `+00:00` · วันขาย = วันที่ไทย (Asia/Bangkok) ของ `sold_at` · id = UUID ตัวเล็ก · ข้อความห้ามมี C0/DEL นับเป็น code point `reason`/`note` ≤ 200 · ฝั่งรับยอมรับฟิลด์/`status`/`reason` ที่ไม่รู้จัก
- ตัวส่ง (ล็อก §6.2–6.3): ≤ **20** แถวต่อคำขอ · body ≤ **262,144** ไบต์ UTF-8 · timeout **20 วินาที** · backoff **5 วิ → 15 วิ → 1 นาที → 5 นาที → 15 นาที** (ค้างที่ 15 นาที) ±20% · 429 รอ `Retry-After` (อ่านไม่ได้ = 60 วิ) · 401/403 หยุดส่งทั้งหมด · 404 ที่ `/api/v1` = "ระบบกลางปิด API อยู่" ลองทุก 15 นาที · 5xx ติดกัน 3 ครั้งหรือ 422 = ส่งทีละ 1 แถว · deferred ครบ **50** ครั้ง = `STUCK` · Web Lock ชื่อ `dayo-push` · ปลุก: บันทึกเสร็จ (หน่วง 2 วิ) · ทุก 60 วิเมื่อมีของค้าง · event `online` · เปิดแอป · ก่อนปิดกะ · ดึง E1 เมื่อเปิดแอป · ทุก 5 นาที · ก่อนเปิดกะ
- ก้อน 2: `shift_id` ของแถว `order` **เป็น null เสมอ** · แถว outbox ของกะ/เงินสด/นับเงิน/Z (รวม `VOID_REFUND`) เขียนเป็น `local_only` ไม่ถูกส่งตลอดไป ไม่นับในป้าย "ยังไม่ส่ง" ไม่ขึ้นหน้า "ส่งไม่ผ่าน"
- นาฬิกา (D80): ต่างจาก `server_time` เกิน **5 นาที** = แถบเตือนบนหน้าขาย + บรรทัดในหน้าสถานะ · **ไม่บล็อก** การขาย/ยกเลิก/เปิด-ปิดกะ
- API key: รูป `^dayo_[0-9a-f]{64}$` · เก็บใน IndexedDB แยกจาก SQLite (ไม่อยู่ในไฟล์สำรอง ไม่อยู่ใน outbox ไม่ลง log ไม่แสดงอีก) · แสดงได้แค่ `dayo_…` + 4 ตัวท้าย
- repo dayo (`D:\TungAo-Project\line-bot\dayo-shop-system`) **อ่านอย่างเดียว** · agent ไม่อ่าน `.env*`/`.dev.vars` ของทั้งสอง repo · ค่าลับ (API key จริง) เจ้าของเป็นคนกรอกเอง
- ข้อความบนจอเป็นภาษาไทย (`apps/pos/src/ui/th.ts`) · `data-testid` เป็นอังกฤษ · สีแบรนด์ตาม D44/D50 Q3-23
- ทุก task: `pnpm turbo run typecheck test` ผ่านทั้ง repo ก่อน merge สาย · commit ผ่าน skill `committing-code` · stage เป็นชื่อไฟล์ · ไม่มีบรรทัด `Co-Authored-By`/ระบุ AI · ห้าม `git checkout -- <ไฟล์>`/`git reset --hard`
- ทดสอบบนแท็บเล็ตจริงเก็บไว้ท้ายสุด (D51) — แผนนี้ไม่รันบนแท็บเล็ต

---

## 0. ภาพรวมการตัดสินใจของแผน

### 0.1 สิ่งที่ใช้ / ปรับ / ทิ้งจากแผน 5 (branch archive `plan-5-pos`, `plan-5-api-sync` — ห้าม merge, ห้ามลบ)

| ของจากแผน 5 | อยู่ที่ | ทำอย่างไรในก้อน 2 |
|---|---|---|
| `ReceivedRowResult` (schema ฝั่งรับที่ `status`/`reason` เป็น string อิสระ) | `plan-5-api-sync:packages/contracts/src/sync.ts:514` | **ใช้ต่อ (ปรับชื่อฟิลด์)** → `ReceivedRowResult` ใน `packages/contracts/src/dayo-api.ts`: `key` แทน `idempotencyKey` + `data?: unknown` · `PushResponse` ใช้ schema ตัวนี้ |
| `clip()` ตัดเป็น code point | `plan-5-api-sync:…/sync.ts` | **ใช้ต่อ** → `clipCodePoints` (ใช้ใน mock ตอนสร้าง `detail`/`key` และในแท็บเล็ตตอนเก็บ `lastError`) |
| `KNOWN_SUCCESS` whitelist, คำตัดสินที่ไม่รู้จัก/หาย/ซ้ำ key ในคำตอบ = "ยังไม่รู้ผล" ไม่เสียครั้งลอง, `decided` ต่อการเรียกหนึ่งครั้ง, `PushOutcome.noAnswer` | `plan-5-pos:apps/pos/src/sync/push.ts` | **ใช้ต่อ** ใน `apps/pos/src/sync/push.ts` ใหม่ |
| นับขนาดด้วย `TextEncoder` (ไบต์ UTF-8 จริง) | `push.ts` `rowBytes` | **ใช้ต่อ** (เพดานใหม่ 262,144 ไบต์) |
| `FETCH_TIMEOUT_MS = 20_000` ด้วย `setTimeout`+`AbortController` (ไม่ใช้ `AbortSignal.timeout` เพื่อให้เทสต์ใช้ fake timers ได้) · ตัด `/` ท้าย `baseUrl` | `plan-5-pos:apps/pos/src/sync/transport.ts` | **ใช้ต่อ** ใน `apps/pos/src/sync/dayo-client.ts` |
| `encodeLastError`/`decodeLastError` (lastError เป็น JSON) | `plan-5-pos:apps/pos/src/sync/keys.ts` | **ใช้ต่อ** ใน `apps/pos/src/sync/state.ts` |
| กติกา "ตัวส่งห้ามใช้คิว serial เดียวกับ `commitSale` ขณะรอเครือข่าย" (hand-off L-R3) | `transport.ts` | **ใช้ต่อ** — อ่าน/เขียนฐานผ่าน serial ทีละช่วงสั้น การรอ fetch อยู่นอกคิว |
| `batchEnd` + `DOCUMENT_OF` (จัดแถวลูกของเอกสารให้อยู่ก้อนเดียว), `MAX_BATCH_BYTES` 1.5 MB, `MAX_ROW_BYTES`, ตัดโซ่ `order_event` ที่ใหญ่เกิน | `push.ts` | **ทิ้ง** — แถว E2 หนึ่งแถว = เอกสารครบหนึ่งใบ ไม่มีแถวลูกระดับตาราง · `order_event` ไม่ถูกส่ง (Q23) |
| `MAX_PUSH_ROWS = 200`, `MAX_DEFERRED_ATTEMPTS = 10` | `sync.ts`, `keys.ts` | **ทิ้ง** → 20 แถว · 50 ครั้ง (spec §6.2–6.3) |
| ลงทะเบียนเครื่อง/`device_token`/หัว `x-device-id`/pull/inbox-flag/`SYNC_ROW_SCHEMAS` 16 ตาราง/`domain/verify.ts`/เซิร์ฟเวอร์ NestJS/pg `0004_device_token` | หลายไฟล์ | **ทิ้ง** (D59/D66) |
| `outbox` + `enqueueOutbox` + `sync_state` บน main | `apps/pos/src/db/outbox.ts` | **ใช้ต่อ** · `enqueueOutbox` เปลี่ยนชื่อเป็น `enqueueLocalOnly` (ตารางเดิมทั้ง 16 ชนิด → `local_only`) · เพิ่ม `enqueuePush` สำหรับชนิด E2 |

### 0.2 สิ่งที่ใช้ต่อ / เลิกใช้จากโค้ดบน main

| ของ | ทำอย่างไร |
|---|---|
| `packages/domain/src/pricing.ts`, `sale.ts` (`planSale`), `apps/pos/src/api/menu.ts`, `apps/pos/src/db/stock.ts` `loadSaleContext` | เลิกใช้ใน Task 12 · **ลบพร้อมเทสต์ใน Task 22** (หลังก้อน 2 ผ่านตรวจ — spec §11) |
| ตารางแคตตาล็อกเดิม (`product`, `product_variant`, `size`, `sweetness_level`, `price`, `channel`, `recipe*`) + seed จาก Excel | **คงไว้** เพราะหน้าสต็อกที่ซ่อนยังอ้าง (spec §11: โค้ดสต็อกคงไว้จนเจ้าของสั่งลบ) · การขายไม่อ่านอีก |
| `order`, `payment`, `discount`, `order_event` (โซ่แฮช), กะ/เงินสด/Z ของแผน 3b | **ใช้ต่อ** (Z ในเครื่องยังนับบิลก้อน 2 ได้เพราะอ่าน `order`+`payment`) · `order_line` ใช้กับบิลเก่าเท่านั้น บิลใหม่เขียน `order_item` |
| PIN (argon2id) + ตัวล็อก PIN (D50 Q3-21) + ล็อกจอ 10 นาที | **ใช้ต่อ** · ตาราง `user` = ที่เก็บ PIN ในเครื่อง โดย `user.id` = `staff.id` ของ dayo |
| หน้าสต็อก (Receive/Produce/Count/Adjust/Stock) | **ซ่อน** จาก router/เมนู (Task 16) · โค้ดและเทสต์คอมโพเนนต์คงไว้ · e2e ของหน้าที่ซ่อนย้ายไป `e2e/hidden-stock/` และตั้ง `testIgnore` |
| pg schema ใน `packages/db-schema/src/pg` (ของเซิร์ฟเวอร์แผน 5) | **ไม่แตะ** · ตาราง/คอลัมน์ใหม่ของก้อน 2 ใส่ในรายการยกเว้นของ `test/parity.test.ts` |

### 0.3 จุดที่แผนตัดสินเอง (Ruling — แก้ได้ถ้าเจ้าของสั่ง)

| # | เรื่องที่สเปกไม่ระบุชัด | ตัดสิน | เหตุผล |
|---|---|---|---|
| R1 | ทิศของ fixture สัญญา | **คำวินิจฉัยผู้คุมงาน O4 (26 ก.ย. 2569) — แทน D82 ชั่วคราว รอบันทึกเป็น D ใหม่พร้อมคำตอบ O1–O3** (สเปก §4.11 ข้อ 2 แก้แล้ว): **POS เป็นเจ้าของ fixture สัญญาไปก่อน** ที่ `packages/contracts/fixtures/dayo-api/` (+ `.gitattributes` `*.json text eol=lf`) · Task 6 เขียนจากแผนก้อน 1 แล้ว → **A1 แก้ให้ตรง SQL ของ dayo `main`** (sizes · `categoryLabel:null` · `timeFrom:"HH:MM:SS"` · `commit:null` · E3 `dayo_edit`/`pos_order_id`) → **Task 23 แทนด้วยคำตอบจริงของ `dayo-test`/Supabase local** · ส่งชุดนี้ให้ dayo รับไปเป็นเทสต์ Route Handler ในก้อน 1B · `fixtures:hashes` (sha256 หลัง CRLF → LF) ใช้เทียบเมื่อ dayo มีสำเนา | dayo ship ก้อน 1A โดยไม่มี `apps/web/test/fixtures/pos-contract/` · แท็บเล็ตรอไม่ได้ · ถ้าผิด เสียแค่ขั้นคัดลอกอีกหนึ่งครั้งภายหลัง |
| R2 | `pos-parity.json` ของจริงมาได้หลังก้อน 1 เท่านั้น | Task 4 สร้าง `pos-parity.seed.json` จากสำเนาตัวคิดราคา (ตรวจตัวห่อ + การแปลง ไม่ใช่ตรวจ SQL) · เทสต์ใช้ไฟล์จริงเมื่อมี · **เกณฑ์ "parity ต่าง 0 สตางค์" ของก้อน 2 ผ่านได้ด้วยไฟล์จริงเท่านั้น (Task 23)** | ไม่ปล่อยให้เทสต์ข้ามเงียบ และไม่อ้างว่าผ่านก่อนมีข้อมูลจริง |
| R3 | `CLOCK_AHEAD` นับรวมใน 50 ครั้งไหม | **ไม่นับ** (เหมือน `UNSUPPORTED`) · แถบเตือนนาฬิกาเป็นสัญญาณ · แถวยัง `pending` และลองใหม่ทุก 60 วิ **เสมอ** — ไม่ตายเอง ไม่ปิดนอกระบบกลางเอง (**คำตัดสินหัวหน้า N5**) · เวลาในแถวล้ำ `server_time` เกิน 24 ชม. = แถบเตือน **เฉพาะ owner** `banner-clock-far-ahead` "เวลาในบิล <N> รายการล้ำระบบกลางเกิน 24 ชม. — ตั้งนาฬิกาแท็บเล็ตให้ตรง แล้วกด 'ส่งตอนนี้'" และแถวขึ้นหน้า "ส่งไม่ผ่าน" เป็นการ์ด "รอเวลา" ที่มีปุ่ม `EXCLUDE` **ให้ owner กดเองเท่านั้น** (ยืนยันสองชั้น + คำเตือนว่ายอดนี้จะไม่ถึงระบบกลาง) | บิลที่นาฬิกาล้ำเป็นยอดขายจริง — ปิดนอกระบบกลางในก้อน 2 = ยอดหายจากฐานกลาง (ไม่มี `order_excluded` จนก้อน 3) จึงห้ามทำอัตโนมัติ · เวลาในแถวแก้ไม่ได้ (ข้อความเดิมทุกไบต์ §6.1) แถวจึงผ่านเมื่อเวลาเซิร์ฟเวอร์ตามทัน หรือ owner ปิดเอง · สเปก §6.4 ให้ EXCLUDE แค่ INVALID/FORBIDDEN/BAD_KEY — การเพิ่ม CLOCK_AHEAD เป็นข้อยกเว้นตามคำตัดสิน N5 |
| R4 | ส่งทีละ 1 แถวหลัง 5xx×3/422 นานแค่ไหน | จำ "แถวสุดท้ายของก้อนที่ล้ม" (`dayo.push_single_through`) · ส่งทีละแถวจนแถวในช่วงนั้นถูกตัดสินหมด แล้วกลับเป็น 20 | มีขอบเขตชัด ไม่วนส่งก้อนใหญ่ที่มีแถวเสียซ้ำ |
| R5 | บิล 0 บาท | คง D50 Q3-20 (ยอดต้อง > 0) · `priceCart` รองรับแก้วฟรี/ส่วนลดรายแก้ว (สำหรับ parity) แต่หน้าจอก้อน 2 ยังไม่มีปุ่มแก้วฟรี/ส่วนลดรายแก้ว | สเปก §9 ก้อน 2 ไม่ได้สั่งหน้าจอนี้ · `payment.amount_satang > 0` เป็น CHECK ในเครื่อง |
| R6 | คำถาม "ทำเครื่องดื่มไปแล้วหรือยัง" ตอนยกเลิกบิล | **คงคำถามไว้เป็นข้อมูลในเครื่อง** (event `VOIDED.made` + รายการ void ใน Z) แต่ **ไม่เขียนความเคลื่อนไหวสต็อก** (D60) · ไม่ส่งขึ้น E2 (`order_void` ไม่มีฟิลด์นี้) | รูป Z snapshot (`ZVoid.made`) และโซ่แฮชของแผน 3b ไม่ต้องเปลี่ยน · ของเสียยังนับได้ในรายงานร้าน · การคืนสต็อกฝั่ง dayo เป็นเรื่องของ `cancel_order` |
| R7 | owner เดิมในเครื่องก่อนก้อน 2 (id สุ่ม ไม่ใช่ `staff.id`) | เครื่องที่ตั้งก่อนก้อน 2 ต้อง "เชื่อมระบบกลาง" ด้วย PIN owner เดิม แล้ว owner เลือกชื่อตัวเองจากรายชื่อ dayo + ตั้ง PIN ใหม่ · ผู้ใช้เดิมที่ไม่อยู่ในรายชื่อ dayo ถูกปิด (`is_active=false`) · แถว outbox เดิมทั้งหมดเป็น `local_only` | ยังไม่เคยขายจริง (D51) · กันแถวรูปแบบเก่าหลุดไป E2 |
| R8 | "ปิดเป็นรายการนอกระบบกลาง" ในก้อน 2 | ทำได้ (owner + PIN + เหตุผล) → แถวเป็น `local_only` ถาวร + `order.excluded_at` + event `EXCLUDED_FROM_SYNC` · **ไม่มีแถว `order_excluded`** | สเปก §4.10 ก้อน 3 ยอมรับไว้แล้วว่าบิลช่วงก้อน 2 ส่ง `order_excluded` ไม่ได้ |
| R9 | ที่อยู่ของ mock server (สเปกเขียน "`apps/pos` dev/test") | แพ็กเกจใหม่ `packages/dayo-mock` (`@dayo/dayo-mock`) | ให้สาย B ทำขนานกับสาย C ได้โดยไม่แตะแพ็กเกจเดียวกัน |
| R10 | บทบาทที่ dayo ส่งมาแต่แท็บเล็ตไม่รู้จัก | เก็บเป็นผู้ใช้ที่ล็อกอินไม่ได้ (`is_active=false`) | ปลอดภัยกว่าให้สิทธิ์เดา |
| N2 | owner คนสุดท้ายที่มี PIN ถูกปลด/ลดบทบาทใน dayo | **คำตัดสินหัวหน้า N2:** แท็บเล็ตทำตามรายชื่อ dayo ทันที (ไม่คงสิทธิ์ของ owner ที่ถูกปลด แม้เป็นคนสุดท้าย) · เมื่อไม่เหลือ owner active ที่มี PIN (หรือกุญแจถูกเพิกถอนแล้ว owner ที่เหลืออนุมัติไม่ได้) แท็บเล็ตแสดงปุ่ม **"เชื่อมใหม่ด้วยคีย์ใหม่"**: owner ออกกุญแจใหม่บนเว็บ dayo (ล็อกอิน LINE = พิสูจน์ความเป็นเจ้าของ) · เพิกถอนกุญแจเก่าบนเว็บ · วางกุญแจใหม่ที่แท็บเล็ต · เลือก owner ที่ active ใน dayo แล้วตั้ง PIN (`recoverOwner` — Task 11) · เครื่อง prefix บิล และคิวส่งเดิมอยู่ครบ | กันแท็บเล็ตตันโดยไม่ต้องให้สิทธิ์คนที่ dayo ปลดแล้ว |
| R11 | Q44 "ยกเลิกบิลตัวเอง" | ตาม Q44 ตรงตัว: **staff และ manager ยกเลิกได้เฉพาะบิลที่ตัวเองขาย** · **owner เท่านั้น** ยกเลิกบิลของคนอื่นได้ (`void_any`) · ทุกกรณียังต้อง PIN owner (D50) · หน้า "ยอดไม่ตรงระบบกลาง" เป็นของ owner (Q44 ไม่ได้ให้ manager) | กฎเหล็กข้อ 1 — ไม่เพิ่มสิทธิ์เกิน Q44 |
| R12 | แคตตาล็อกที่ตัวคิดราคาไม่รู้จัก (ขนาด/ความหวาน/ชนิดโปรใหม่) | ปฏิเสธเฉพาะส่วน `catalog` เก็บฉบับเดิมไว้ + แถบ "แคตตาล็อกจากระบบกลางอ่านไม่ได้" · **ส่วนอื่นของคำตอบ E1 ยังใช้เสมอ**: `staff` (ปิดพนักงานที่ถูกปลดทันที), `supported_*`, `pricing`, `server_time` · รายชื่อพนักงานที่ไม่มี owner active เลย = ไม่ใช้รายชื่อนั้น (บันทึก `catalogError`) และไม่ปิด owner คนสุดท้ายที่มี PIN ในเครื่องเด็ดขาด | ขายด้วยราคาที่คิดผิดแย่กว่าขายด้วยฉบับเก่า · แต่พนักงานที่ถูกปลดต้องล็อกอินไม่ได้ทันที (ความปลอดภัย) · บั๊กฝั่งรายชื่อต้องไม่ทำให้เครื่องไม่มี owner |
| R13 | `queue_no` เกิน 9999 ต่อวัน | ปฏิเสธการขาย (`QUEUE_FULL`) | ร้านขาย ~100 บิล/วัน · ห้ามวนเลขเพราะ unique ต่อวัน |
| R14 | จุดตีความของแผนก้อน 1 ที่กระทบแท็บเล็ต | รับทั้งหมด: `sale_date` > วันนี้ (ข้ามเที่ยงคืนใน 5 นาที) = `deferred CLOCK_AHEAD` → แท็บเล็ตทำเหมือน CLOCK_AHEAD อื่น (R3) · `cancelled_at` = `voided_at` (ไม่มีผลฝั่งแท็บเล็ต) · คีย์ย่อยที่ไม่รู้จักใน `bill_discount`/`totals` = `UNSUPPORTED` (แท็บเล็ตไม่ส่งอยู่แล้ว — schema ของ POS เป็น strict) · (ก0) `pos_excluded_orders` เลื่อนไปก้อน 3 (ตรงกับ R8) · `categoryLabel` — **dayo ship เป็นค่าดิบ null ได้ ไม่ coalesce** (`0048_cup_sizes.sql:1491`) → schema รับ null (A1) แท็บเล็ตใช้ `family` แทน · ลำดับตรวจแถว E2 ของ mock = **ลำดับในโค้ดจริง `0052_pos_push.sql:560-620`** (สเปก §4.5 ข้อ 6 · A3) แทนแผนก้อน 1 Task 3 Step 4 | สัญญาเดียวกันสองฝั่ง |
| R15 | รูปไฟล์ parity | **รูปที่ dayo ship จริง** (`docs/design/pos-parity.json` · dayo `a0f76e2` · สเปก §5.2): `{dayo_commit, generated_at, pricing_files_sha256, catalog, cases:[{spec, note, draft: OrderDraft, expected: QuoteResult}]}` — **ไม่มี `catalog_version` และ `id`** (ตัวระบุเคส = `spec`) · `expected` เป็น `QuoteResult` เต็ม อ่านเฉพาะฟิลด์เงินแบบ `ParityMoney` (ยอมรับฟิลด์เกิน) · แท็บเล็ตแปลงเคสเป็นตะกร้าด้วยกติกาเดียวกับตอนขาย (`cartFromOrderDraft`) · **เคสที่ไม่มี `saleTime` (20 จาก 25)**: ตัดสินตอน A1 — แนะนำให้เคสที่แคตตาล็อกไม่มีโปรจำกัดเวลาที่เข้าเงื่อนไขใช้ `saleTime` ใดก็ได้ (ผลไม่ขึ้นกับเวลา) ส่วนเคสที่ขึ้นกับเวลาแต่ไม่มี `saleTime` = เทสต์ล้ม + ขอทีม dayo เติม | ไม่ต้องมีตัวแปลงสองชุด · ไม่ทำให้ไฟล์จริงของ dayo ล้มทั้งไฟล์ |

~~ไม่พบจุดขัดกับ D ของ POS หรือ ADR ของ dayo ที่ต้องหยุดถามเจ้าของ~~ (**26 ก.ย. — พบแล้ว 3 ข้อ รอเจ้าของ** · ไม่บล็อกโค้ดก้อน 2): **O1** ADR-0050 (owner แก้/ยกเลิกบิล POS บนเว็บ) กับ D76 — ก้อน 2 ทำแค่แสดง `dayo_edit` แบบอ่านอย่างเดียว (Task 15, 19) · **O2** ADR-0051 เลื่อน (สำรองอัตโนมัติ) กับ D64/D67 — กระทบเงื่อนไขเปิด production (Task 23) · **O3** ADR-0055 (ดูกำไรบนเว็บ dayo) กับ D79 — ไม่กระทบก้อน 2

### 0.4 ตารางงานขนาน (สูงสุด 4 agent · สายละ 1 worktree)

integration branch: `block-2-pos` (แตกจาก `main`) · แต่ละสายแตก branch จาก `block-2-pos` ใน worktree ของตัวเอง · task ที่เสร็จและผ่านตรวจ merge `--no-ff` เข้า `block-2-pos` เพื่อให้สายอื่นดึง interface ไปใช้ · ตรวจทั้งก้อนแล้วจึง merge `block-2-pos` เข้า `main`

| สาย | worktree / branch | แพ็กเกจที่แตะ | task |
|---|---|---|---|
| A pricing | `wt-b2-pricing` / `b2-pricing` | `packages/domain`, `packages/dayo-pricing`, `.gitattributes` | 1 → 2 → 3 → 4 |
| B contract | `wt-b2-contract` / `b2-contract` | `packages/contracts`, `packages/dayo-mock` | 5 → 6 → 7 |
| C device | `wt-b2-device` / `b2-device` | `packages/db-schema`, `apps/pos/src/{db,sync,api}`, `apps/pos/test` | 8 → 9 → 10 → 11 → 12a → 12b → 12c → 12d → 13 → 14 → 15 |
| D screens | `wt-b2-screens` / `b2-screens` | `apps/pos/src/{screens,ui,state,app,test-utils,router.tsx}`, `apps/pos/e2e`, `apps/pos/playwright.config.ts` | 16 → 17 → 18a → 18b → 19 → 20 → 21 |
| ท้าย | `block-2-pos` | ทุกที่ | 22 → 23 |

หมายเหตุ: สาย C กับ D แตะแพ็กเกจเดียวกัน (`@dayo/pos`) แต่คนละโฟลเดอร์และ D เริ่ม task ที่ใช้ API หลัง task ของ C ที่ผลิต interface นั้น merge เข้า `block-2-pos` แล้วเท่านั้น (คอลัมน์ "รอ")

**ไฟล์ที่มีเจ้าของสายเดียว** (กันชนตอน merge): `apps/pos/src/api/errors.ts` (รหัส error) = สาย C เท่านั้น · `apps/pos/src/ui/errors.ts` และ `ui/th.ts` (ข้อความไทยของทุกรหัส รวมรหัสใหม่ของสาย C) = สาย D เท่านั้น — สาย C ไม่แตะสองไฟล์นี้ · `pnpm-lock.yaml`: task ที่เพิ่ม dependency commit lockfile ของตัวเอง · ตอน merge เข้า `block-2-pos` ถ้าชน **ห้ามแก้ด้วยมือ** — รับของฝั่งใดฝั่งหนึ่งแล้วรัน `pnpm install` ใหม่ให้ lockfile ถูกสร้างใหม่ แล้ว commit ผลใน merge commit

| รอบ | สาย A | สาย B | สาย C | สาย D | agent พร้อมกัน |
|---|---|---|---|---|---|
| 1 | T1 | T5 | — | T16 | 3 |
| 2 | T2 | T6 | T8 (รอ T5) | — | 3 |
| 3 | T3 (รอ T5, T6) | T7 (รอ T6) | — | — | 2 |
| 4 | T4 (รอ T3) | — | T9 (รอ T7 — เทสต์ใช้ mock) | — | 2 |
| 4a | — | **A1** (contracts + fixtures — §0.6) | — | — | 1 (+ architect ทำ A5 ขนาน) |
| 4b | **A2** (รอ A1) | **A3** (รอ A1) | **A4** (รอ T9 merge) | — | 3 |
| 5 | — | — | T10 (รอ T8, T9, **A1, A3**) | — | 1 |
| 6 | — | — | T11 (รอ T10) | — | 1 |
| 7 | — | — | T12a → T12b (รอ T3, T11, **A2**) | T17 (รอ T11) | 2 |
| 8 | — | — | T12c → T12d | T18a (รอ T12b, **A2**) | 2 |
| 9 | — | — | T13 (รอ T12d) | T18b (รอ T18a) | 2 |
| 10 | — | — | T14 (รอ T13) | — | 1 |
| 11 | — | — | T15 (รอ T14, **A4**) | — | 1 |
| 12 | — | — | — | T19 (รอ T15 — ใช้ `listPriceDiffs`/`void_local_only` ของ T15 · N3) → T20 (รอ T15) | 1 |
| 13 | — | — | — | T21 (รอ T7, T20) | 1 |
| 14 | T22 บน `block-2-pos` → ตรวจทั้งก้อน → merge เข้า `main` | | | | 1 |
| 15 | T23 (รอก้อน 1 ของ dayo merge + deploy dev แล้ว) | | | | หัวหน้า + 1 |

### 0.5 ผู้ทำ โมเดล และผู้ตรวจต่อ task

| Task | ผู้ทำ (โมเดล) | ผู้ตรวจ |
|---|---|---|
| 1 money-edge · 2 dayo-pricing · 3 priceCart · 4 parity | domain-engineer (opus) | code-reviewer (sonnet) |
| 5 contracts · 6 fixtures | domain-engineer (opus) | code-reviewer |
| 7 dayo-mock | sync-engineer (opus) | code-reviewer |
| 8 db-schema | sync-engineer (opus) | code-reviewer |
| 9 client + ที่เก็บ key | sync-engineer (opus) | code-reviewer + **security-reviewer (opus)** |
| 10 ดึงแคตตาล็อก + พนักงาน | sync-engineer (opus) | code-reviewer |
| 11 ตั้งเครื่อง/เชื่อม/ตั้ง PIN | sync-engineer (opus) | code-reviewer + **security-reviewer** |
| 12a outbox · 12b ขาย · 12c ยกเลิก · 12d ประวัติบิล/ตัวช่วยเทสต์ | sync-engineer (opus) | code-reviewer |
| 13 ตัวส่ง | sync-engineer (opus) | code-reviewer + **security-reviewer** (401/คีย์ในคำขอ) |
| 14 ตัวตั้งเวลา + สถานะ | sync-engineer (opus) | code-reviewer |
| 15 ทางแก้ของ owner + E3 + ส่วนต่าง | sync-engineer (opus) | code-reviewer + **security-reviewer** (PIN owner) |
| 16, 17, 18a, 18b, 19, 20, 21 หน้าจอ + e2e | pos-ui-developer (sonnet) | code-reviewer (+ **security-reviewer** สำหรับ 17 และ 20) |
| 22 ลบของเก่า | sync-engineer (sonnet) | code-reviewer |
| 23 เชื่อมจริง | หัวหน้า + sync-engineer (opus) + เจ้าของ | code-reviewer + security-reviewer (ตรวจทั้งก้อน) |

ทุก task: implementer → test-runner (haiku) → ผู้ตรวจ → แก้ ≤ 3 รอบกับ agent ตัวเดิม → บันทึก `Task N: complete` ใน `.superpowers/sdd/block-2/progress.md` (ไม่ commit ไฟล์นี้)

### 0.6 งานปรับตาม dayo (A1–A5)

ที่มา: รายงานส่วนต่าง `.superpowers/sdd/2026-09-25-07-block2-pos-sell-central/dayo-adr-delta.md` (M1–M8) · สเปก 04 §13.6 (S1–S27 พร้อม file:line ของ dayo) · **ถือ SQL ของ dayo `main` เป็นความจริง** (ไม่ใช่ `docs/API.md` ของ dayo) · ทุกงาน: `pnpm turbo run typecheck test` ผ่านทั้ง repo · commit ผ่าน `committing-code` · ผู้ตรวจ code-reviewer · ลำดับในตาราง §0.4 แถว 4a–4b

| งาน | ผู้ทำ · สาย · แพ็กเกจ | ทำอะไร | เกณฑ์เสร็จ (ตรวจได้) |
|---|---|---|---|
| **A1** สัญญา + fixture (M1–M3) | domain-engineer (opus) · สาย B · `packages/contracts` (`src/dayo-api.ts`, `fixtures/dayo-api/*.json`, `fixtures/pos-test/e1-catalog-rich.json`, เทสต์) | (1) `SizeCode` = regex `^[1-9][0-9]{0,2} oz$` (ใช้ที่ Variant.size · SaleSettings.defaultSize · OrderLineData.size · DraftLine.size) (2) `PosOrderCatalog.sizes` บังคับ `[{code: SizeCode, label, sortOrder: int, isActive: bool}]` (3) `categoryLabel` `.nullable().optional()` (4) `HHMM` รับ `HH:MM` และ `HH:MM:SS` (5) `PricingInfo.commit` `string \| null` (6) `ClientInfo.last_receipt_no` `string \| null` **ไม่ตรวจรูปใน schema** (Task 11 ตรวจตอนตั้งเลข) (7) `CentralOrder` + `dayo_edit` (`{kind: string, edited_at, edited_by_name: string\|null, reason: string\|null, version: int}` แบบ looseObject · null/ไม่มีได้) + `pos_order_id` (Uuid · null/ไม่มีได้) (8) `ParityFile` ตามรูปจริง (R15): `catalog_version` optional · `cases[].spec` เป็นตัวระบุ · `note`/`id` optional · `expected` looseObject (9) fixture ตาม O4 (R1): E1 `changed` มี `sizes` 3 ขนาด (`22 oz` ปิด) · ตัวแปรหนึ่งตัว `categoryLabel: null` · โปรหนึ่งตัว `timeFrom: "17:00:00"` · E1 หนึ่งไฟล์ `pricing.commit: null` · E3 มีบิล POS ของ key นี้ที่มี `dayo_edit` แบบ `edit` หนึ่งใบและ `cancel` หนึ่งใบ (+ `pos_order_id`) · คิด hash ใหม่ (10) แคตตาล็อกทดสอบ `pos-test/e1-catalog-rich.json` มี `sizes` เดียวกัน | `grep -n "'16 oz', '20 oz'" packages/contracts/src` → ไม่มีผล · เทสต์: E1 ที่มี `sizes` 3 ขนาด / `categoryLabel:null` / `timeFrom:"14:00:00"` / `commit:null` / `last_receipt_no:"L260924-014"` ผ่าน schema · ขนาด `"big"` / `"0 oz"` ไม่ผ่าน · E1 ไม่มี `sizes` ไม่ผ่าน · E3 ที่มี `dayo_edit` และไม่มีฟิลด์นี้ผ่านทั้งคู่ · `ParityFile.parse(docs/design/pos-parity.json)` ผ่าน และ `PosOrderCatalog.parse(ไฟล์นั้น.catalog)` ผ่าน · ทุก fixture ผ่าน schema · `fixtures:hashes` ตรงกับไฟล์ |
| **A2** ตัวห่อราคา (M4 + ส่วนต่อของ T4) | domain-engineer (opus) · สาย A · `packages/domain` (`price-cart.ts`, `order-row.ts`, `order-draft.ts`, `test/parity.test.ts`) · รอ A1 | (1) `size` ในตะกร้าเป็น `string` (`Size` ของตัวที่คัดลอก) · เลิกตัวกัน `rowSize()` ที่บีบเป็นสองค่า · `PosVariant.categoryLabel` เป็น `string \| null` (2) `toPricingCatalog` ส่ง `sizes` ต่อให้ `OrderCatalog` ตรงตัว (3) **`timeFrom`/`timeTo` ส่งผ่านตรงตัว ห้ามแปลง** (4) **ตัวตรวจตะกร้าก่อนเก็บเงิน (`checkCart` ของ T3) ตรวจขนาด**: ไม่อยู่ใน `sizes` ที่ `isActive` หรือเมนู+ความหวานนั้นไม่มีตัวแปร = `CartError` (ไม่ถึงขั้นเก็บเงิน) (5) **ส่วนต่อของ T4**: ตัวอ่านไฟล์ parity รับรูปจริงของ dayo (ใช้ `spec` เป็นชื่อเคส · อ่านเงินจาก `QuoteResult`) · คัดลอก `docs/design/pos-parity.json` ไปที่ `packages/dayo-pricing/fixtures/pos-parity.json` แล้วรันชั้น ค · เคสไม่มี `saleTime` ทำตาม R15 | เทสต์: ตะกร้าขนาด `22 oz` ในแคตตาล็อกที่ `22 oz` active และมีตัวแปร = คิดราคาได้ · `22 oz` ที่ปิด / ไม่มีตัวแปร = `CartError` ก่อนเก็บเงิน · แคตตาล็อกที่ `timeFrom:"17:00:00"` ได้ผลเท่ากับเรียก `computeOrder` ของสำเนาโดยตรงด้วยแคตตาล็อกเดียวกัน (พิสูจน์ว่าไม่แปลง) · `grep -rn "rowSize\|'20 oz'" packages/domain/src` → ไม่มีตัวกันสองค่าเหลือ · parity ชั้น ค กับไฟล์ dayo `a0f76e2`: ทุกเคสที่รันได้ต่าง 0 สตางค์ (เคสที่ข้ามต้องมีเหตุผลเขียนในเทสต์) · property test เดิมผ่าน |
| **A3** mock (M5) | sync-engineer (opus) · สาย B · `packages/dayo-mock` · รอ A1 | (1) แคตตาล็อกมี `sizes` (จาก fixture) (2) E3 คืน `dayo_edit` และ `pos_order_id` (บิล POS ของ key นี้เท่านั้น) + ตัวควบคุมให้เทสต์ตั้ง `dayo_edit` ของบิลที่รับแล้ว (`mock.editPosOrder(posOrderId, {kind, reason, …})`) (3) ขนาด/ความหวานที่ไม่มีตัวแปร = `rejected UNKNOWN_CODE` (4) `order_void` ที่ `voided_at` เก่ากว่าเวลา mock − 60 วัน = `rejected INVALID` (5) `sale_date` > วันนี้ของ mock = `deferred CLOCK_AHEAD` (6) key ไม่มี `orders:write` = **HTTP 403 ทั้งคำขอ** (ไม่ใช่ `FORBIDDEN` ต่อแถว) (7) โปรที่ปิดก่อน `sold_at` ไม่ถูกใช้ตอนคิด `computed_total` (mock รับตารางเวลาปิดโปรของตัวเอง `mock.closePromotion(id, at)`) (8) `judgeRow` เรียงขั้นตาม `0052_pos_push.sql:560-620` (สเปก §4.5 ข้อ 6) (9) ค้างจาก T7: ครอบ `judgeRow` ด้วย try/catch ต่อแถว → `deferred SERVER_ERROR` (10) ทางควบคุม HTTP สำหรับ e2e: `/__mock/edit-pos-order` (= `editPosOrder`) · `/__mock/bump-catalog` แก้ `sizes` ได้ | เทสต์หนึ่งข้อต่อข้อ (3)–(9) · เทสต์ลำดับ: แถวที่ผิดสองอย่างพร้อมกันได้เหตุผลของขั้นที่มาก่อนตามโค้ดจริง (เช่น ฟิลด์ไม่รู้จัก + ไม่มีสิทธิ์ = `UNSUPPORTED`) · บิลที่ขายด้วยโปรที่ปิดก่อน `sold_at` ได้ `accepted` และ `computed_total ≠ total` · fixture ทุกไฟล์ยังเล่นซ้ำได้ครบ |
| **A4** ฐานในเครื่อง (M6) | sync-engineer (opus) · สาย C · `packages/db-schema` · รอ T9 merge | migration ใหม่ `0005_order_central_dayo_edit.sql` เพิ่ม `order.central_dayo_edit_json` (json · null ได้ · ไม่มีค่าเริ่มต้น) + `centralDayoEditJson` ใน `src/sqlite/sales.ts` + `sqlite-migrations.gen.ts` + รายการยกเว้นของ `test/parity.test.ts` · ไม่แตะ append-only trigger ของบิล (คอลัมน์ `central_*` อัปเดตได้แบบเดียวกับ `central_order_no`) | เทสต์ migrate: ฐานที่มีบิลก่อน 0005 → จำนวนแถวเท่าเดิม · คอลัมน์ใหม่เป็น null · อัปเดต `central_dayo_edit_json` ของบิลที่จ่ายแล้วได้ (trigger ไม่ raise) · `foreign_key_check` ว่าง |
| **A5** สเปก + แผน (M7–M8) | architect · `docs/` เท่านั้น | แก้สเปก 04 (§13.6) และแผนนี้ (ย่อหน้า "ปรับตาม dayo" ของ Task 10–15, 17–23 · §0.3 R1/R14/R15 · §7) | **เสร็จแล้ว 26 ก.ย. 2569** |

**T18 รอ A2** (ปุ่มขนาดและการตรวจขนาดก่อนเก็บเงินใช้ของ A2) · T12b รอ A2 ด้วย (`sell-catalog.ts` ใช้ `sizes`) · T10 รอ A1 + A3 (เทสต์ดึง E1 จาก mock ที่มี `sizes`) · T15 รอ A4 (เก็บ `dayo_edit`)

**รอเจ้าของ (ไม่บล็อกโค้ดก้อน 2 · ห้ามเลือกข้างในโค้ด)**: **O1** ADR-0050 กับ D76 — ก้อน 2 ทำแค่ **แสดง `dayo_edit` แบบอ่านอย่างเดียว** (dayo ส่งมาแน่แล้ว — A1, A3, A4, T15, T19) ไม่มีปุ่มแก้บิล ไม่ปรับยอดในเครื่อง · **O2** ADR-0051 เลื่อน กับ D64/D67 — เงื่อนไขเปิด production ใน Task 23 · **O3** ADR-0055 กับ D79 — ไม่มีงานในก้อน 2

**แก้หลังรีวิว A3 (26 ก.ย. 2569 — ทับข้อความเดิมที่ขัด):**
- **R14 ข้อ "คีย์ย่อยที่ไม่รู้จักใน `bill_discount`/`totals`" แก้เป็น `rejected INVALID`** (ไม่ใช่ `deferred UNSUPPORTED`) ตาม SQL ของ dayo `0052_pos_push.sql:316,339` — ตัวตรวจรายชื่อฟิลด์ของ dayo ดูแค่ฟิลด์ชั้นบนกับ `lines.*` (`0052:587-591`) · เทสต์ใน Task 12/13 ที่คาด UNSUPPORTED สำหรับกรณีนี้ต้องคาด INVALID · แท็บเล็ตไม่ส่งคีย์แบบนี้อยู่แล้ว (schema ขาส่งเป็น strict)
- **จำนวน fixture ไม่ตายตัว** — รายชื่อคือ `CONTRACT_FIXTURE_NAMES` (วันนี้ 27 ไฟล์ หลัง A3) · ข้อความ "22 ไฟล์" ในแผนนี้หมายถึงชุดเริ่มต้นเท่านั้น
- **`ReceivedRowResult.key` เป็น `null` ได้** (dayo `0052:748` เมื่อ key ที่ส่งไม่ใช่ข้อความ — A6) · ตัวส่ง (Task 13) ถือแถวคำตอบที่ key เป็น null ว่า "จับคู่ไม่ได้ → ยัง pending ลองใหม่" ไม่นับครั้ง

---

## 1. File Structure

### สร้างใหม่

| ไฟล์ | หน้าที่ |
|---|---|
| `.gitattributes` | `packages/dayo-pricing/src/vendor/** -text` — ห้าม git แปลงปลายบรรทัดของไฟล์สำเนา (sha256 ต้องคงที่) |
| `packages/domain/src/money-edge.ts` | `edgeBahtToSatang` · `edgeSatangToBaht` · `MoneyEdgeError` · `EDGE_MAX_SATANG` |
| `packages/domain/src/price-cart.ts` | `CartDraft` · `priceCart` · `toOrderDraft` · `withZeroCosts` · `lineOptions` · `defaultMilkForLine` · `menuUnitPriceSatang` · `CartError` |
| `packages/domain/src/order-row.ts` | `buildOrderRowData` (ตะกร้า → `data` ของ E2) · `orderRowToCart` (กลับทาง) |
| `packages/domain/src/order-draft.ts` | `cartFromOrderDraft` (เคส parity รูป `OrderDraft` ของ dayo → ตะกร้าของแท็บเล็ต) |
| `packages/domain/scripts/gen-parity-seed.ts` | สร้าง `pos-parity.seed.json` จากเคส §5.3 ด้วยสำเนาตัวคิดราคา |
| `packages/domain/test/{money-edge,money-edge-guard,price-cart,order-row,parity}.test.ts` + `test/fixtures/parity-cases.ts` | เทสต์ |
| `packages/dayo-pricing/{package.json,tsconfig.json,vitest.config.ts,VENDOR.json}` | แพ็กเกจสำเนา |
| `packages/dayo-pricing/src/index.ts` · `src/vendor/*.ts` (7 ไฟล์) | ทางเข้า + สำเนาไม่แก้ |
| `packages/dayo-pricing/scripts/{vendor-lib.ts,vendor.ts}` | `vendor:check` · `vendor:update` |
| `packages/dayo-pricing/fixtures/pos-parity.seed.json` | (Task 4 สร้าง) · `pos-parity.json` ของจริงเจ้าของคัดลอกมาใน Task 23 |
| `packages/dayo-pricing/test/vendor.test.ts` | ตรวจ sha256 + ชุดไฟล์ปิด |
| `packages/contracts/src/dayo-api.ts` | zod ของ E1/E2/E3/ข้อผิดพลาด/parity + `fieldsUsed` · `isRowSupported` · `rowKey` · `clipCodePoints` |
| `packages/contracts/src/dayo-fixture.ts` | zod ของรูป fixture สัญญา (`PosContractFixture`) + `CONTRACT_FIXTURE_NAMES` (ถอดจากแผนก้อน 1 — 22 ชื่อ) |
| `packages/contracts/src/dayo-fixture-files.ts` | อ่านไฟล์ fixture (Node เท่านั้น — subpath `./fixture-files`) |
| `packages/contracts/fixtures/dayo-api/*.json` + `.gitattributes` | fixture สัญญาตาม `CONTRACT_FIXTURE_NAMES` — **ต้นฉบับของ POS ชั่วคราว (§4.11 · O4 แทน D82)** · ข้อความ "D82 / dayo เป็นเจ้าของ" ใน Task 6 (ทำเสร็จแล้ว) ให้อ่านตาม R1 · `scripts/fixture-hashes.ts` เทียบ sha256 หลัง CRLF → LF |
| `packages/contracts/fixtures/pos-test/e1-catalog-rich.json` | แคตตาล็อกทดสอบของ POS (22 ตัวแปร 3 ช่องทาง 5 โปร 6 พนักงาน) |
| `packages/contracts/test/{dayo-api,dayo-fixtures}.test.ts` | เทสต์ |
| `packages/dayo-mock/{package.json,tsconfig.json,vitest.config.ts}` · `src/{index,state,judge,handler,server}.ts` · `test/*.test.ts` | mock server ตามสัญญา |
| `packages/db-schema/drizzle/sqlite/0003_*.sql`, `0004_block2_outbox_local_only.sql` (+ snapshot/journal) | migration |
| `apps/pos/src/sync/{state,secret-store,dayo-client,catalog,push,scheduler}.ts` | ฝั่งเชื่อม dayo |
| `apps/pos/src/api/{connect,staff,sell-catalog,sync-problems,central-orders}.ts` | API ใหม่ใน Worker |
| `apps/pos/src/app/permissions.ts` | สิทธิ์ตามบทบาท (Q44) |
| `apps/pos/src/screens/{ConnectFields,StaffPinDialog,StatusBanners,SyncProblemsScreen,CentralOrdersScreen,PriceDiffScreen,SystemStatusScreen,PromoPanel}.tsx` | หน้าจอใหม่ |
| `apps/pos/test/helpers/dayo.ts` | ตั้งเครื่องกับ mock ในเทสต์ |
| `apps/pos/test/{catalog-sync,connect,staff-pin,push,scheduler,sync-problems,central-orders,secret-store,dayo-client}.test.ts` | เทสต์ |
| `apps/pos/e2e/block2-*.spec.ts` · `apps/pos/e2e/hidden-stock/` (ย้ายไฟล์เดิม) | e2e |

### แก้

| ไฟล์ | เปลี่ยน |
|---|---|
| `packages/domain/src/index.ts`, `package.json` | export ใหม่ · dependency `@dayo/dayo-pricing`, `@dayo/contracts` |
| `packages/contracts/src/enums.ts`, `index.ts` | `UserRole` + `manager` · `OutboxStatus` + `local_only` · `EventType` + 4 ชนิด |
| `packages/db-schema/src/sqlite/{reference,sales,system}.ts`, `src/browser/sqlite-migrations.gen.ts`, `test/{parity,triggers,migrate}.test.ts` | ตาราง/คอลัมน์ใหม่ |
| `apps/pos/src/db/{outbox,events,worker}.ts` | `enqueuePush`/`enqueueLocalOnly` · event ไม่เข้า outbox · เริ่มตัวส่ง |
| `apps/pos/src/api/{sale,void,bootstrap,setup,auth,deps,errors,types,pos-api,shift,cash,close,adjust,production,purchase,stock-count,orders}.ts` · `src/db/stock.ts` | ตาม task |
| `apps/pos/src/{router.tsx,state/cart.ts,app/*,screens/*,ui/th.ts,ui/errors.ts}` | ตาม task |
| `apps/pos/playwright.config.ts`, `e2e/helpers.ts`, `package.json` | mock server + helper ใหม่ + dev deps |
| `apps/pos/test/helpers/{db,shift}.ts` และเทสต์เดิมที่ขายของ | ใช้ตะกร้ารูปใหม่ |

---

## 2. สาย A — ราคาและเงิน

### Task 1: ขอบเงิน `money-edge.ts` (สตางค์ ↔ บาท)

ผู้ทำ: domain-engineer (opus) · สเปก §4.2

**Files:**
- Create: `packages/domain/src/money-edge.ts`
- Create: `packages/domain/test/money-edge.test.ts`, `packages/domain/test/money-edge-guard.test.ts`
- Modify: `packages/domain/src/index.ts` (เพิ่ม `export * from './money-edge.js'`)

**Interfaces:**
- Consumes: —
- Produces: `edgeBahtToSatang(baht: number): number` · `edgeSatangToBaht(satang: number): number` · `class MoneyEdgeError extends Error { code: 'NOT_A_MONEY_VALUE' | 'MORE_THAN_2_DECIMALS' | 'OUT_OF_RANGE' }` · `EDGE_MAX_SATANG = 9_999_999_999`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `packages/domain/test/money-edge.test.ts`

```ts
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { EDGE_MAX_SATANG, edgeBahtToSatang, edgeSatangToBaht, MoneyEdgeError } from '../src/money-edge.js'

const TWO_DECIMALS = /^\d+(\.\d{1,2})?$/

function roundTrip(s: number): void {
  const b = edgeSatangToBaht(s)
  if (edgeBahtToSatang(b) !== s) throw new Error(`round trip broke at ${s} (baht ${b})`)
  if (!TWO_DECIMALS.test(JSON.stringify(b))) throw new Error(`${s} serialised as ${JSON.stringify(b)}`)
}

describe('edge round trip (spec 04 §4.2)', () => {
  it('every satang 0…1,000,000 survives satang → baht → satang and serialises with ≤ 2 decimals', () => {
    for (let s = 0; s <= 1_000_000; s++) roundTrip(s)
  })
  it('100,000 random values up to the numeric(10,2) ceiling', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: EDGE_MAX_SATANG }), (s) => { roundTrip(s) }), { numRuns: 100_000 })
  })
  it('the last 10,000 values below the ceiling', () => {
    for (let s = EDGE_MAX_SATANG - 10_000; s <= EDGE_MAX_SATANG; s++) roundTrip(s)
  })
  it('serialises like the spec examples', () => {
    expect(JSON.stringify(edgeSatangToBaht(3550))).toBe('35.5')
    expect(JSON.stringify(edgeSatangToBaht(1225))).toBe('12.25')
    expect(JSON.stringify(edgeSatangToBaht(3500))).toBe('35')
    expect(Object.is(edgeSatangToBaht(0), 0)).toBe(true)
  })
})

describe('edgeBahtToSatang', () => {
  it.each([
    [0.1 + 0.2, 30],
    [19.99 * 3, 5997],
    [35 * 1.07, 3745],
    // outputs of dayo round2 for the classic float traps: round2(36.675) = 36.68, round2(1.005) = 1.01
    [36.68, 3668],
    [1.01, 101],
    [0, 0],
    [99_999_999.99, EDGE_MAX_SATANG],
  ])('%s baht → %s satang', (baht, satang) => {
    expect(edgeBahtToSatang(baht)).toBe(satang)
  })
  it('never returns -0', () => {
    expect(Object.is(edgeBahtToSatang(-0), 0)).toBe(true)
  })
  it.each([
    [-0.01, 'NOT_A_MONEY_VALUE'],
    [Number.NaN, 'NOT_A_MONEY_VALUE'],
    [Number.POSITIVE_INFINITY, 'NOT_A_MONEY_VALUE'],
    [35.123, 'MORE_THAN_2_DECIMALS'],
    [36.675, 'MORE_THAN_2_DECIMALS'], // a raw 3-decimal value from dayo is a dayo bug: never rounded away silently
    [1e11, 'OUT_OF_RANGE'],
  ])('%s throws %s', (baht, code) => {
    try { edgeBahtToSatang(baht); expect.unreachable() } catch (e) {
      expect(e).toBeInstanceOf(MoneyEdgeError)
      expect((e as MoneyEdgeError).code).toBe(code)
    }
  })
})

describe('edgeSatangToBaht', () => {
  it.each([[1.5, 'NOT_A_MONEY_VALUE'], [Number.NaN, 'NOT_A_MONEY_VALUE'], [-1, 'OUT_OF_RANGE'], [EDGE_MAX_SATANG + 1, 'OUT_OF_RANGE']])('%s throws %s', (s, code) => {
    try { edgeSatangToBaht(s); expect.unreachable() } catch (e) { expect((e as MoneyEdgeError).code).toBe(code) }
  })
})
```

`packages/domain/test/money-edge-guard.test.ts`:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
/** spec 04 §4.2: these never use the silent-rounding converters of money.ts (they are for packages/excel-import only). */
const GUARDED = ['apps/pos/src', 'packages/dayo-pricing/src', 'packages/domain/src/price-cart.ts', 'packages/domain/src/order-row.ts']

function* sources(path: string): Generator<string> {
  if (!existsSync(path)) return
  if (statSync(path).isFile()) { if (/\.(ts|tsx)$/.test(path)) yield path; return }
  for (const entry of readdirSync(path)) yield* sources(join(path, entry))
}

it('no guarded file names bahtToSatang or bahtToUsat', () => {
  const offenders: string[] = []
  for (const g of GUARDED) for (const f of sources(join(ROOT, g))) if (/\bbahtTo(Satang|Usat)\b/.test(readFileSync(f, 'utf8'))) offenders.push(f)
  expect(offenders).toEqual([])
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/domain test -- money-edge` · คาดว่า FAIL: `Cannot find module '../src/money-edge.js'` (guard test ผ่านอยู่แล้ว — ถูกต้อง เพราะวันนี้ยังไม่มีใครฝ่า)

- [ ] **Step 3: เขียนโค้ด** — `packages/domain/src/money-edge.ts`

```ts
/**
 * The ONLY place money crosses between the tablet (integer satang) and dayo's API (baht, numeric(10,2)) — spec 04 §4.2.
 * No business rounding happens here: dayo's pricing code has already rounded (round2 / ceil_baht). `bahtToSatang` in
 * money.ts rounds silently and belongs to packages/excel-import only (a guard test enforces it).
 */
export type MoneyEdgeErrorCode = 'NOT_A_MONEY_VALUE' | 'MORE_THAN_2_DECIMALS' | 'OUT_OF_RANGE'

export class MoneyEdgeError extends Error {
  readonly code: MoneyEdgeErrorCode
  constructor(code: MoneyEdgeErrorCode, value: unknown) {
    super(`${code}: ${String(value)}`)
    this.name = 'MoneyEdgeError'
    this.code = code
  }
}

/** numeric(10,2) ceiling: 99,999,999.99 baht. */
export const EDGE_MAX_SATANG = 9_999_999_999

/** Baht from dayo (≤ 2 decimals) → satang. Removes float noise only; more than 2 decimals is a dayo bug and throws. */
export function edgeBahtToSatang(baht: number): number {
  if (typeof baht !== 'number' || !Number.isFinite(baht) || baht < 0) throw new MoneyEdgeError('NOT_A_MONEY_VALUE', baht)
  const x = baht * 100
  const r = Math.round(x)
  if (Math.abs(x - r) > 1e-6) throw new MoneyEdgeError('MORE_THAN_2_DECIMALS', baht)
  if (r > EDGE_MAX_SATANG) throw new MoneyEdgeError('OUT_OF_RANGE', baht)
  return r === 0 ? 0 : r // never -0
}

/** Satang → baht for a request body. JSON.stringify of the result always has ≤ 2 decimals (3550 → 35.5). */
export function edgeSatangToBaht(satang: number): number {
  if (!Number.isSafeInteger(satang)) throw new MoneyEdgeError('NOT_A_MONEY_VALUE', satang)
  if (satang < 0 || satang > EDGE_MAX_SATANG) throw new MoneyEdgeError('OUT_OF_RANGE', satang)
  return satang === 0 ? 0 : satang / 100
}
```

หมายเหตุ architect: วัดแล้วว่าอัลกอริทึมที่สเปกล็อก (`|x − r| > 1e-6`) ผ่าน round trip ทั้งช่วงถึงเพดาน — ความคลาดสูงสุดที่วัดได้ 9.54e-7 (ใกล้ขอบ) จึงต้องมีเทสต์ 10,000 ค่าสุดท้ายใต้เพดานข้างบน ห้ามลดเกณฑ์ 1e-6

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/domain test -- money-edge` → PASS · `pnpm --filter @dayo/domain typecheck` → ไม่มี error

- [ ] **Step 5: Commit** (ผ่าน skill `committing-code`)

```bash
git add packages/domain/src/money-edge.ts packages/domain/src/index.ts packages/domain/test/money-edge.test.ts packages/domain/test/money-edge-guard.test.ts
git commit -m "feat(domain): convert satang and baht at the dayo contract edge"
```

---

### Task 2: แพ็กเกจ `@dayo/dayo-pricing` (สำเนาตัวคิดราคาปักรุ่น + sha256)

ผู้ทำ: domain-engineer (opus) · สเปก §5.1 · D72

**Files:**
- Create: `.gitattributes`
- Create: `packages/dayo-pricing/package.json`, `tsconfig.json`, `vitest.config.ts`, `VENDOR.json`
- Create: `packages/dayo-pricing/src/index.ts` · `src/vendor/{money,promotions,cost,fmt,shopSettings,types,time}.ts` (สร้างด้วยสคริปต์เท่านั้น ห้ามพิมพ์/แก้เอง)
- Create: `packages/dayo-pricing/scripts/vendor-lib.ts`, `scripts/vendor.ts`
- Test: `packages/dayo-pricing/test/vendor.test.ts`

**Interfaces:**
- Consumes: repo dayo (อ่านอย่างเดียว ผ่าน `git show <commit>:<path>`)
- Produces: `@dayo/dayo-pricing` exports `computeOrder`, `applyOptions`, `channelPrice`, `round2`, `bkkDay`, `bkkTime`, `saleSettingsOf`, `defaultMilkFor` และ type `OrderCatalog`, `OrderDraft`, `OrderDraftLine`, `QuoteResult`, `QuotedLine`, `AppliedPromotion`, `MenuVariantEntry`, `IngredientEntry`, `BaseEntry`, `SalesChannelEntry`, `PaymentMethodEntry`, `Promotion`, `MenuOptionMilkEntry`, `MenuOptionGradeEntry`, `ShopSaleSettings`, `Size`, `Sweetness`, `MilkCode` · subpath `@dayo/dayo-pricing/VENDOR.json` · `pnpm --filter @dayo/dayo-pricing vendor:check` / `vendor:update <dayoRepo> [commit]`

- [ ] **Step 1: สร้างโครงแพ็กเกจ**

`.gitattributes` (root):

```
# spec 04 §5.1 · D72: keep the vendored dayo pricing files byte-identical to dayo's commit (the sha256 rule normalises CRLF anyway)
packages/dayo-pricing/src/vendor/** -text
```

`packages/dayo-pricing/package.json`:

```json
{
  "name": "@dayo/dayo-pricing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./VENDOR.json": "./VENDOR.json" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "vendor:check": "tsx scripts/vendor.ts check",
    "vendor:update": "tsx scripts/vendor.ts update"
  },
  "devDependencies": { "@types/node": "^22.0.0", "tsx": "4.23.13", "typescript": "~5.9.0", "vitest": "^5.0.0" }
}
```

`tsconfig.json` = `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": ["node"], "resolveJsonModule": true }, "include": ["src", "test", "scripts"] }` · `vitest.config.ts` แบบเดียวกับ `packages/domain/vitest.config.ts`

- [ ] **Step 2: เขียนเทสต์ที่ล้ม** — `packages/dayo-pricing/test/vendor.test.ts`

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { checkVendor, fileSha256, VENDOR_DIR, VENDORED } from '../scripts/vendor-lib.js'
import { computeOrder } from '../src/index.js'

describe('vendored dayo pricing (spec 04 §5.1, D72)', () => {
  it('every vendored file matches VENDOR.json byte for byte', () => {
    expect(checkVendor()).toEqual([])
  })
  it('src/vendor holds exactly the vendored set', () => {
    expect(readdirSync(VENDOR_DIR).sort()).toEqual(VENDORED.map((p) => p.split('/').pop()).sort())
  })
  it('the set is closed: every relative import of a vendored file is another vendored file', () => {
    const names = new Set(VENDORED.map((p) => p.split('/').pop()!.replace(/\.ts$/, '')))
    for (const file of readdirSync(VENDOR_DIR)) {
      for (const m of readFileSync(join(VENDOR_DIR, file), 'utf8').matchAll(/from\s+"\.\/([^"]+)"/g)) expect(names.has(m[1]!), `${file} imports ./${m[1]}`).toBe(true)
    }
  })
  it('computeOrder is reachable through the package entry', () => {
    expect(typeof computeOrder).toBe('function')
  })
  it('hashes like dayo: a CRLF copy has the same sha256 as the LF original (block-1 interpretation 6)', () => {
    const lf = Buffer.from('a\nb\n', 'utf8')
    const crlf = Buffer.from('a\r\nb\r\n', 'utf8')
    expect(fileSha256(crlf)).toBe(fileSha256(lf))
    expect(fileSha256(lf)).toBe(createHash('sha256').update('a\nb\n', 'utf8').digest('hex'))
  })
})
```

- [ ] **Step 3: รันให้ล้ม** — `pnpm install && pnpm --filter @dayo/dayo-pricing test` · คาดว่า FAIL: `Cannot find module '../scripts/vendor-lib.js'`

- [ ] **Step 4: เขียนสคริปต์** — `packages/dayo-pricing/scripts/vendor-lib.ts`

```ts
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** spec 04 §5.1: dayo's pricing files and everything they import (not xlsx). */
export const VENDORED = ['money', 'promotions', 'cost', 'fmt', 'shopSettings', 'types', 'time'].map((n) => `packages/shared/src/${n}.ts`)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const VENDOR_DIR = join(ROOT, 'src', 'vendor')
const VENDOR_JSON = join(ROOT, 'VENDOR.json')

export type VendorJson = { repo: 'dayo-shop-system'; commit: string; files: Record<string, string> }

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
/**
 * The hash rule dayo uses for E1 `pricing.files_sha256` (block-1 plan Task 7 · interpretation 6): UTF-8 text after
 * CRLF → LF. VENDOR.json MUST use the same rule, or a Windows checkout shows the yellow banner for ever.
 */
export const fileSha256 = (bytes: Uint8Array): string => sha256(Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n'))
const localPath = (dayoPath: string): string => join(VENDOR_DIR, dayoPath.split('/').pop()!)

/** Problems as readable lines; [] = the vendored copy is exactly what VENDOR.json pins. */
export function checkVendor(): string[] {
  const v = JSON.parse(readFileSync(VENDOR_JSON, 'utf8')) as VendorJson
  const problems: string[] = []
  if (v.repo !== 'dayo-shop-system') problems.push(`repo must be dayo-shop-system, got ${String(v.repo)}`)
  if (!/^[0-9a-f]{40}$/.test(v.commit)) problems.push(`commit must be a 40-character sha, got ${String(v.commit)}`)
  const listed = Object.keys(v.files).sort()
  if (JSON.stringify(listed) !== JSON.stringify([...VENDORED].sort())) problems.push(`VENDOR.json lists [${listed.join(', ')}], expected [${VENDORED.join(', ')}]`)
  for (const p of VENDORED) {
    let got: string
    try { got = fileSha256(readFileSync(localPath(p))) } catch { problems.push(`missing ${localPath(p)}`); continue }
    if (got !== v.files[p]) problems.push(`${p}: sha256 ${got} ≠ VENDOR.json ${String(v.files[p])} — ตัวคิดราคาในเครื่องไม่ตรงรุ่นกับ dayo`)
  }
  return problems
}

/** Copies the COMMITTED bytes (git show — never the working tree, which may carry CRLF) and rewrites VENDOR.json. */
export function updateVendor(dayoRepo: string, commit: string): VendorJson {
  const full = execFileSync('git', ['-C', dayoRepo, 'rev-parse', `${commit}^{commit}`], { encoding: 'utf8' }).trim()
  mkdirSync(VENDOR_DIR, { recursive: true })
  const files: Record<string, string> = {}
  for (const p of VENDORED) {
    const bytes = execFileSync('git', ['-C', dayoRepo, 'show', `${full}:${p}`])
    writeFileSync(localPath(p), bytes)
    files[p] = fileSha256(bytes)
  }
  const out: VendorJson = { repo: 'dayo-shop-system', commit: full, files }
  writeFileSync(VENDOR_JSON, `${JSON.stringify(out, null, 2)}\n`)
  return out
}
```

`packages/dayo-pricing/scripts/vendor.ts`:

```ts
import { checkVendor, updateVendor } from './vendor-lib.js'

const [cmd, repo, commit = 'HEAD'] = process.argv.slice(2)
if (cmd === 'check') {
  const problems = checkVendor()
  for (const p of problems) console.error(p)
  process.exit(problems.length === 0 ? 0 : 1)
} else if (cmd === 'update' && repo !== undefined) {
  const v = updateVendor(repo, commit)
  console.log(`vendored ${Object.keys(v.files).length} files from ${v.commit} — now run the parity test (spec 04 §5.2 layer C)`)
} else {
  console.error('usage: vendor.ts check | vendor.ts update <path-to-dayo-shop-system> [commit]')
  process.exit(2)
}
```

- [ ] **Step 5: คัดลอกสำเนา** (อ่าน repo dayo อย่างเดียว)

Run: `pnpm --filter @dayo/dayo-pricing vendor:update D:/TungAo-Project/line-bot/dayo-shop-system 65d3af2`
Expected: `vendored 7 files from 65d3af2ba9fce1f6c3aa591379890a8d61fe9755` และ `VENDOR.json.files` เท่ากับค่าที่ architect วัดไว้ ณ commit นั้น (ไฟล์ใน dayo เก็บแบบ LF จึงเท่ากับ sha256 ของไบต์ที่ `git show` คืน และเท่ากับกติกา CRLF→LF ของ dayo):

```
packages/shared/src/cost.ts          83df8f024306ad4e4575d84e3b2b32b0ff1579d765138d76c4eacfb7160202a8
packages/shared/src/fmt.ts           df31505296c9c99d2e1cc984d02a7fc86706b7ce668b7680554008fbc74334ac
packages/shared/src/money.ts         96abf33a850979298e3d3f3996acc03cdbbd6a17b33630b22a3cfcdb1407699e
packages/shared/src/promotions.ts    4850b98d5084e703bb1deb84ea4629253f510f37d6e0ab80161e2e5dab15ea11
packages/shared/src/shopSettings.ts  6ae3480f4c980a5cfbd8aadad99eafa2170b8b74e92c7f39a90c4c4392d88b3c
packages/shared/src/time.ts          c634692b8b9c5dd30876cca15e94b3b642da7c685966db5017a34682c3cc1de1
packages/shared/src/types.ts         de361ebdd0c7d08d556d347867d9068511039dcc2af29c7684468296e86d9bda
```

ถ้า dayo มี commit ใหม่ที่แก้ไฟล์เหล่านี้ก่อนถึงงานนี้ ใช้ HEAD ของ dayo และบันทึก commit ใน ledger · architect ตรวจแล้วว่า 7 ไฟล์นี้ผ่าน `tsc` ภายใต้ `tsconfig.base.json` ของ POS (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) โดยไม่ต้องแก้ · ถ้ารุ่นใหม่ไม่ผ่าน ห้ามแก้ไฟล์สำเนา — หยุดแจ้งหัวหน้า

- [ ] **Step 6: ทางเข้าแพ็กเกจ** — `packages/dayo-pricing/src/index.ts`

```ts
/**
 * dayo's own pricing code, vendored unchanged and pinned by VENDOR.json (spec 04 §5.1, D72). Never edit src/vendor —
 * update with `pnpm --filter @dayo/dayo-pricing vendor:update <dayo repo> <commit>` and re-run the parity test.
 */
export { applyOptions, channelPrice, computeOrder } from './vendor/money'
export { round2 } from './vendor/fmt'
export { bkkDay, bkkTime } from './vendor/time'
export { defaultMilkFor, saleSettingsOf } from './vendor/shopSettings'
export type {
  AppliedPromotion, BaseEntry, IngredientEntry, MenuOptionGradeEntry, MenuOptionMilkEntry, MenuVariantEntry, MilkCode,
  OrderCatalog, OrderDraft, OrderDraftLine, PaymentMethodEntry, Promotion, QuoteResult, QuotedLine, SalesChannelEntry,
  ShopSaleSettings, Size, Sweetness,
} from './vendor/types'
```

- [ ] **Step 7: รันให้ผ่าน** — `pnpm --filter @dayo/dayo-pricing test` → PASS · `pnpm --filter @dayo/dayo-pricing vendor:check` → exit 0 · `pnpm --filter @dayo/dayo-pricing typecheck` → ไม่มี error · `git ls-files --eol packages/dayo-pricing/src/vendor` แสดง attr `-text` ทุกไฟล์

- [ ] **Step 8: Commit**

```bash
git add .gitattributes packages/dayo-pricing/package.json packages/dayo-pricing/tsconfig.json packages/dayo-pricing/vitest.config.ts packages/dayo-pricing/VENDOR.json packages/dayo-pricing/src/index.ts packages/dayo-pricing/src/vendor/money.ts packages/dayo-pricing/src/vendor/promotions.ts packages/dayo-pricing/src/vendor/cost.ts packages/dayo-pricing/src/vendor/fmt.ts packages/dayo-pricing/src/vendor/shopSettings.ts packages/dayo-pricing/src/vendor/types.ts packages/dayo-pricing/src/vendor/time.ts packages/dayo-pricing/scripts/vendor-lib.ts packages/dayo-pricing/scripts/vendor.ts packages/dayo-pricing/test/vendor.test.ts pnpm-lock.yaml
git commit -m "feat(dayo-pricing): vendor dayo's pricing code pinned by commit and sha256"
```

---

### Task 3: `priceCart` + ตะกร้า ↔ แถว E2 ใน `@dayo/domain`

ผู้ทำ: domain-engineer (opus) · สเปก §4.5 (แถว `order`), §5.1 · รอ Task 1, 2, 5, 6 merge

**Files:**
- Create: `packages/domain/src/price-cart.ts`, `packages/domain/src/order-row.ts`
- Create: `packages/domain/test/price-cart.test.ts`, `packages/domain/test/order-row.test.ts`, `packages/domain/test/fixtures/pos-catalog.ts`
- Modify: `packages/domain/src/index.ts`, `packages/domain/package.json` (dependencies `"@dayo/dayo-pricing": "workspace:*"`, `"@dayo/contracts": "workspace:*"`)

**Interfaces:**
- Consumes: Task 1 `edgeBahtToSatang`/`edgeSatangToBaht` · Task 2 `computeOrder`, `applyOptions`, `channelPrice`, `bkkDay`, `bkkTime`, `saleSettingsOf` · Task 5 `OrderRowData`, `PosOrderCatalog` (zod) + type `PosOrderCatalogParsed` · Task 6 `loadRichCatalog` (`@dayo/contracts/fixture-files`)
- Produces (ใช้ใน Task 4, 12, 15, 18):

```ts
export type PosIngredient = Omit<IngredientEntry, 'costPerUseUnit'>
export type PosVariant = MenuVariantEntry & { categoryLabel?: string; menuSortOrder?: number }
export type PosOrderCatalog = Omit<OrderCatalog, 'ingredients' | 'variants'> & { ingredients: Record<string, PosIngredient>; variants: PosVariant[] }
export type CartLineDraft = { code: string; size: Size; sweetness: Sweetness; milk: MilkCode; grade: string | null; qty: number; free: boolean; discountSatang: number | null; discountPercent: number | null; discountReason: string | null }
export type BillDiscountDraft = { kind: 'satang'; satang: number; reason: string | null } | { kind: 'percent'; percent: number; reason: string | null }
export type CartDraft = { channelCode: string; paymentCode: string; lines: CartLineDraft[]; billDiscount: BillDiscountDraft | null; promoCode: string | null; skipPromotionIds: string[]; noPromotions: boolean }
export type PricedLine = { lineNo: number; code: string; nameTh: string; size: Size; sweetness: Sweetness; milk: MilkCode; grade: string | null; qty: number; unitPriceSatang: number; discountPerCupSatang: number; discountReason: string | null; promotionId: string | null; lineTotalSatang: number }
export type PricedPromotion = { promotionId: string; code: string | null; name: string; kind: string; discountSatang: number }
export type PricedCart = { ok: boolean; warnings: string[]; soldAt: string; saleDate: string; saleTime: string; draft: OrderDraft; lines: PricedLine[]; promotionsApplied: PricedPromotion[]; itemsSubtotalSatang: number; itemsDiscountSatang: number; billDiscountSatang: number; discountSatang: number; totalSatang: number; channelFeeSatang: number }
export class CartError extends Error { code: 'EMPTY_CART' | 'CART_TOO_LARGE' | 'QTY_OUT_OF_RANGE' | 'UNKNOWN_VARIANT' | 'GRADE_RULE' | 'BAD_DISCOUNT' }
export function priceCart(cart: CartDraft, catalog: PosOrderCatalog, soldAtIso: string): PricedCart
export function toOrderDraft(cart: CartDraft, catalog: PosOrderCatalog, soldAtIso: string): OrderDraft
export function withZeroCosts(catalog: PosOrderCatalog): OrderCatalog
export function defaultMilkForLine(catalog: PosOrderCatalog, variant: PosVariant): MilkCode
export function lineOptions(catalog: PosOrderCatalog, code: string, size: Size, sweetness: Sweetness): { milk: MilkChoice[]; grades: GradeChoice[]; defaultMilk: MilkCode; defaultGrade: string | null }
export type MilkChoice = { code: MilkCode; priceAddSatang: number }
export type GradeChoice = { code: string; priceAddSatang: number; isDefault: boolean }
export function menuUnitPriceSatang(catalog: PosOrderCatalog, variant: PosVariant, channelCode: string): number | null
export function toPricingCatalog(parsed: PosOrderCatalogParsed): PosOrderCatalog   // PosOrderCatalogParsed = z.infer of the contracts schema
export function sumSatang(values: readonly number[]): number
export function centralDiffSatang(computedSatang: number | null, chargedSatang: number): number | null
export const MAX_CART_LINES = 50, MAX_CART_CUPS = 500
// order-row.ts
export type OrderRowInput = { posOrderId: string; receiptNo: string; queueNo: number; staffId: string; catalogVersion: number; cart: CartDraft; priced: PricedCart; note: string | null }
export function buildOrderRowData(i: OrderRowInput): OrderRowData
export function orderRowToCart(draft: OrderRowData): { cart: CartDraft; soldAt: string }
```

- [ ] **Step 1: แคตตาล็อกทดสอบ** — `packages/domain/test/fixtures/pos-catalog.ts`

```ts
import { loadRichCatalog } from '@dayo/contracts/fixture-files'
import { toPricingCatalog, type PosOrderCatalog } from '../../src/price-cart.js'

/** The one test catalog of block 2 on the POS side: packages/contracts/fixtures/pos-test/e1-catalog-rich.json (Task 6). Never re-type a catalog in a test. */
export const POS_CATALOG: PosOrderCatalog = toPricingCatalog(loadRichCatalog().catalog)
```

- [ ] **Step 2: เขียนเทสต์ที่ล้ม** — `packages/domain/test/price-cart.test.ts`

```ts
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { computeOrder } from '@dayo/dayo-pricing'
import { PosOrderCatalog as PosOrderCatalogSchema } from '@dayo/contracts'
import { edgeBahtToSatang } from '../src/money-edge.js'
import { CartError, centralDiffSatang, lineOptions, priceCart, sumSatang, toOrderDraft, withZeroCosts, type CartDraft, type CartLineDraft } from '../src/price-cart.js'
import { POS_CATALOG } from './fixtures/pos-catalog.js'

const line = (over: Partial<CartLineDraft> = {}): CartLineDraft => ({ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null, ...over })
const cart = (lines: CartLineDraft[], over: Partial<CartDraft> = {}): CartDraft => ({ channelCode: 'store', paymentCode: 'cash', lines, billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false, ...over })
const FRI_1030 = '2026-09-25T03:30:00.000Z' // Friday 10:30 Bangkok

it('the contracts schema refuses a catalog missing a field the pricing code reads (why toPricingCatalog may cast)', () => {
  const broken = structuredClone(POS_CATALOG) as unknown as { promotions: { params: Record<string, unknown> }[] }
  delete broken.promotions[0]!.params['buy_qty']
  expect(PosOrderCatalogSchema.safeParse(broken).success).toBe(false)
})

describe('toOrderDraft', () => {
  it('sale_time is the Bangkok HH:MM with seconds cut, not rounded (spec §4.5)', () => {
    expect(toOrderDraft(cart([line()]), POS_CATALOG, '2026-09-25T07:00:59.999Z').saleTime).toBe('14:00')
  })
  it('sale_date is the Thai calendar date of sold_at', () => {
    expect(toOrderDraft(cart([line()]), POS_CATALOG, '2026-09-24T17:30:00.000Z').saleDate).toBe('2026-09-25')
  })
  it('no_promotions skips every promotion of the catalog (same result as SQL no_promotions — spec §4.5)', () => {
    expect(toOrderDraft(cart([line()], { noPromotions: true }), POS_CATALOG, FRI_1030).skipPromotionIds).toEqual(POS_CATALOG.promotions.map((p) => p.id))
  })
  it('money inputs cross the edge in baht', () => {
    const d = toOrderDraft(cart([line({ discountSatang: 525 })], { billDiscount: { kind: 'satang', satang: 1000, reason: 'ลูกค้าประจำ' } }), POS_CATALOG, FRI_1030)
    expect(d.lines[0]!.discountBaht).toBe(5.25)
    expect(d.billDiscountBaht).toBe(10)
    expect(d.billDiscountPercent).toBeNull()
  })
})

describe('priceCart', () => {
  it('Thai Tea ×3 with "buy 2 get 1": 105.00 − 35.00 = 70.00', () => {
    const p = priceCart(cart([line({ qty: 3 })]), POS_CATALOG, FRI_1030)
    expect(p.ok).toBe(true)
    expect([p.itemsSubtotalSatang, p.itemsDiscountSatang, p.discountSatang, p.totalSatang]).toEqual([10500, 3500, 3500, 7000])
    expect(p.promotionsApplied.map((x) => x.discountSatang)).toEqual([3500])
  })
  it('sumSatang / centralDiffSatang keep money math in the domain', () => {
    expect(sumSatang([9000, 5000])).toBe(14_000)
    expect(() => sumSatang([1.5])).toThrow(RangeError)
    expect(centralDiffSatang(15_501, 15_500)).toBe(1)
    expect(centralDiffSatang(null, 15_500)).toBeNull()
  })
  it('every money field equals edgeBahtToSatang of the vendored computeOrder (random carts)', () => {
    const variants = POS_CATALOG.variants.filter((v) => !v.isMatcha)
    fc.assert(fc.property(
      fc.array(fc.record({ v: fc.integer({ min: 0, max: variants.length - 1 }), qty: fc.integer({ min: 1, max: 5 }), pct: fc.option(fc.integer({ min: 1, max: 50 }), { nil: null }) }), { minLength: 1, maxLength: 6 }),
      fc.constantFrom('store', 'grab', 'lineman'),
      (rows, channelCode) => {
        const c = cart(rows.map((r) => { const v = variants[r.v]!; return line({ code: v.menuCode, size: v.size, sweetness: v.sweetness, qty: r.qty, discountPercent: r.pct }) }), { channelCode })
        const p = priceCart(c, POS_CATALOG, FRI_1030)
        const q = computeOrder(toOrderDraft(c, POS_CATALOG, FRI_1030), withZeroCosts(POS_CATALOG))
        expect(p.totalSatang).toBe(edgeBahtToSatang(q.totalAmount))
        expect(p.itemsSubtotalSatang).toBe(edgeBahtToSatang(q.itemsSubtotal))
        expect(p.itemsDiscountSatang).toBe(edgeBahtToSatang(q.itemsDiscount))
        expect(p.billDiscountSatang).toBe(edgeBahtToSatang(q.billDiscountAmount))
        expect(p.channelFeeSatang).toBe(edgeBahtToSatang(q.channelFeeAmount))
        expect(p.lines.map((l) => l.lineTotalSatang)).toEqual(q.lines.map((l) => edgeBahtToSatang(l.lineTotal)))
      },
    ), { numRuns: 300 })
  })
  it.each<[string, CartDraft, CartError['code']]>([
    ['empty', cart([]), 'EMPTY_CART'],
    ['qty 0', cart([line({ qty: 0 })]), 'QTY_OUT_OF_RANGE'],
    ['qty above maxQtyPerLine (99)', cart([line({ qty: 100 })]), 'QTY_OUT_OF_RANGE'],
    ['unknown variant', cart([line({ code: 'Nope' })]), 'UNKNOWN_VARIANT'],
    ['matcha without a grade', cart([line({ code: 'Matcha Latte', grade: null })]), 'GRADE_RULE'],
    ['grade on a non-matcha menu', cart([line({ grade: 'Excellent' })]), 'GRADE_RULE'],
    ['line baht and percent together', cart([line({ discountSatang: 100, discountPercent: 10 })]), 'BAD_DISCOUNT'],
    ['51 lines', cart(Array.from({ length: 51 }, () => line())), 'CART_TOO_LARGE'],
  ])('%s → CartError %s', (_, c, code) => {
    try { priceCart(c, POS_CATALOG, FRI_1030); expect.unreachable() } catch (e) { expect(e).toBeInstanceOf(CartError); expect((e as CartError).code).toBe(code) }
  })
  it('oat on a menu without fresh milk in its recipe is not ok (spec §5.3 case 6)', () => {
    expect(priceCart(cart([line({ code: 'Cocoa', sweetness: '50%', milk: 'oat' })]), POS_CATALOG, FRI_1030).ok).toBe(false)
  })
})

describe('lineOptions', () => {
  it('offers oat only where the recipe has fresh milk and the menu allows it', () => {
    expect(lineOptions(POS_CATALOG, 'Thai Tea', '16 oz', '50%').milk.map((m) => m.code)).toEqual(['fresh', 'oat'])
    expect(lineOptions(POS_CATALOG, 'Cocoa', '16 oz', '50%').milk.map((m) => m.code)).toEqual(['fresh'])
    expect(lineOptions(POS_CATALOG, 'Pink Milk', '16 oz', '100%').milk.map((m) => m.code)).toEqual(['fresh'])
  })
  it('matcha lists its grades and picks the default', () => {
    const o = lineOptions(POS_CATALOG, 'Matcha Latte', '16 oz', '50%')
    expect(o.grades.map((g) => [g.code, g.priceAddSatang])).toEqual([['Excellent', 0], ['Premium', 2000]])
    expect(o.defaultGrade).toBe('Excellent')
  })
})
```

`packages/domain/test/order-row.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { OrderRowData } from '@dayo/contracts'
import { buildOrderRowData, orderRowToCart } from '../src/order-row.js'
import { priceCart, type CartDraft } from '../src/price-cart.js'
import { POS_CATALOG } from './fixtures/pos-catalog.js'

const SOLD_AT = '2026-09-25T03:15:03.120Z'
const CART: CartDraft = {
  channelCode: 'store', paymentCode: 'cash', promoCode: null, skipPromotionIds: [], noPromotions: false,
  billDiscount: { kind: 'satang', satang: 500, reason: 'ลูกค้าประจำ' },
  lines: [
    { code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 3, free: false, discountSatang: null, discountPercent: null, discountReason: null },
    { code: 'Matcha Latte', size: '16 oz', sweetness: '50%', milk: 'oat', grade: 'Premium', qty: 1, free: false, discountSatang: 525, discountPercent: null, discountReason: 'ทดลองสูตร' },
  ],
}

describe('buildOrderRowData (spec §4.5 row kind order)', () => {
  const priced = priceCart(CART, POS_CATALOG, SOLD_AT)
  const data = buildOrderRowData({ posOrderId: '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21', receiptNo: 'A-000312', queueNo: 12, staffId: '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d', catalogVersion: 42, cart: CART, priced, note: null })
  it('passes the contract schema', () => { expect(OrderRowData.parse(data)).toEqual(data) })
  it('always sends shift_id null in block 2 and the interpreted milk/grade', () => {
    expect(data.shift_id).toBeNull()
    expect(data.lines.map((l) => [l.milk, l.grade])).toEqual([['fresh', null], ['oat', 'Premium']])
  })
  it('totals are the charged amounts in baht from the re-price at sold_at', () => {
    expect(Math.round(data.totals.total * 100)).toBe(priced.totalSatang)
    expect(data.sale_date).toBe('2026-09-25')
    expect(data.sold_at).toBe(SOLD_AT)
  })
  it('optional line fields appear only when set', () => {
    expect(Object.keys(data.lines[0]!)).toEqual(['code', 'size', 'sweetness', 'milk', 'grade', 'qty'])
    expect(data.lines[1]).toMatchObject({ discount_baht: 5.25, discount_reason: 'ทดลองสูตร' })
  })
  it('orderRowToCart undoes buildOrderRowData', () => {
    expect(orderRowToCart(data)).toEqual({ cart: CART, soldAt: SOLD_AT })
  })
})
```

- [ ] **Step 3: รันให้ล้ม** — `pnpm --filter @dayo/domain test -- price-cart order-row` · คาดว่า FAIL: module not found

- [ ] **Step 4: เขียนโค้ด** — `packages/domain/src/price-cart.ts`

```ts
import {
  applyOptions, bkkDay, bkkTime, channelPrice, computeOrder, saleSettingsOf,
  type IngredientEntry, type MenuVariantEntry, type MilkCode, type OrderCatalog, type OrderDraft, type Size, type Sweetness,
} from '@dayo/dayo-pricing'
import type { PosOrderCatalogParsed } from '@dayo/contracts'
import { edgeBahtToSatang, edgeSatangToBaht } from './money-edge.js'

/** E1 catalog: OrderCatalog without ingredient cost (spec 04 §4.4 rule 1) + two display-only variant fields (rule 2). */
export type PosIngredient = Omit<IngredientEntry, 'costPerUseUnit'>
export type PosVariant = MenuVariantEntry & { categoryLabel?: string; menuSortOrder?: number }
export type PosOrderCatalog = Omit<OrderCatalog, 'ingredients' | 'variants'> & { ingredients: Record<string, PosIngredient>; variants: PosVariant[] }

export type CartLineDraft = {
  code: string; size: Size; sweetness: Sweetness; milk: MilkCode; grade: string | null; qty: number
  free: boolean; discountSatang: number | null; discountPercent: number | null; discountReason: string | null
}
export type BillDiscountDraft = { kind: 'satang'; satang: number; reason: string | null } | { kind: 'percent'; percent: number; reason: string | null }
export type CartDraft = {
  channelCode: string; paymentCode: string; lines: CartLineDraft[]; billDiscount: BillDiscountDraft | null
  promoCode: string | null; skipPromotionIds: string[]; noPromotions: boolean
}
export type PricedLine = {
  lineNo: number; code: string; nameTh: string; size: Size; sweetness: Sweetness; milk: MilkCode; grade: string | null; qty: number
  unitPriceSatang: number; discountPerCupSatang: number; discountReason: string | null; promotionId: string | null; lineTotalSatang: number
}
export type PricedPromotion = { promotionId: string; code: string | null; name: string; kind: string; discountSatang: number }
export type PricedCart = {
  ok: boolean; warnings: string[]; soldAt: string; saleDate: string; saleTime: string; draft: OrderDraft
  lines: PricedLine[]; promotionsApplied: PricedPromotion[]
  itemsSubtotalSatang: number; itemsDiscountSatang: number; billDiscountSatang: number; discountSatang: number; totalSatang: number; channelFeeSatang: number
}
export type MilkChoice = { code: MilkCode; priceAddSatang: number }
export type GradeChoice = { code: string; priceAddSatang: number; isDefault: boolean }

export type CartErrorCode = 'EMPTY_CART' | 'CART_TOO_LARGE' | 'QTY_OUT_OF_RANGE' | 'UNKNOWN_VARIANT' | 'GRADE_RULE' | 'BAD_DISCOUNT'
export class CartError extends Error {
  readonly code: CartErrorCode
  constructor(code: CartErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'CartError'
    this.code = code
  }
}

/** DY422 limits of dayo (ADR-0039): the tablet never builds a bill dayo would refuse for size. */
export const MAX_CART_LINES = 50
export const MAX_CART_CUPS = 500

/** Cost never reaches the tablet (spec §4.4 rule 1, §5.4): 0 keeps dayo's pricing code whole and changes no price. */
export function withZeroCosts(c: PosOrderCatalog): OrderCatalog {
  const ingredients: Record<string, IngredientEntry> = {}
  for (const [id, ing] of Object.entries(c.ingredients)) ingredients[id] = { ...ing, costPerUseUnit: 0 }
  return { ...c, ingredients }
}

function findVariant(c: PosOrderCatalog, code: string, size: string, sweetness: string): PosVariant | undefined {
  return c.variants.find((v) => v.menuCode === code && v.size === size && v.sweetness === sweetness)
}

function checkCart(cart: CartDraft, catalog: PosOrderCatalog): void {
  if (cart.lines.length === 0) throw new CartError('EMPTY_CART', 'cart has no lines')
  // computeOrder silently clamps qty to maxQtyPerLine; the tablet must never price a different bill than it sends
  const maxQty = Math.min(saleSettingsOf(catalog).maxQtyPerLine, 999)
  let cups = 0
  cart.lines.forEach((l, i) => {
    if (!Number.isSafeInteger(l.qty) || l.qty < 1 || l.qty > maxQty) throw new CartError('QTY_OUT_OF_RANGE', `line ${i + 1}: qty ${l.qty} (1–${maxQty})`)
    cups += l.qty
    const v = findVariant(catalog, l.code, l.size, l.sweetness)
    if (!v) throw new CartError('UNKNOWN_VARIANT', `${l.code} ${l.size} ${l.sweetness}`)
    if (v.isMatcha !== (l.grade !== null)) throw new CartError('GRADE_RULE', `${l.code}: ${v.isMatcha ? 'a matcha menu needs a grade' : 'grade must be null'}`)
    if (l.discountSatang !== null && l.discountPercent !== null) throw new CartError('BAD_DISCOUNT', `line ${i + 1}: baht and percent together`)
    if (l.discountSatang !== null && (!Number.isSafeInteger(l.discountSatang) || l.discountSatang < 0)) throw new CartError('BAD_DISCOUNT', `line ${i + 1}: discount must be whole satang ≥ 0`)
    if (l.discountPercent !== null && !(l.discountPercent >= 0 && l.discountPercent <= 100)) throw new CartError('BAD_DISCOUNT', `line ${i + 1}: percent must be 0–100`)
  })
  if (cart.lines.length > MAX_CART_LINES || cups > MAX_CART_CUPS) throw new CartError('CART_TOO_LARGE', `${cart.lines.length} lines, ${cups} cups`)
  const d = cart.billDiscount
  if (d !== null && d.kind === 'satang' && (!Number.isSafeInteger(d.satang) || d.satang <= 0)) throw new CartError('BAD_DISCOUNT', 'bill discount must be whole satang > 0')
  if (d !== null && d.kind === 'percent' && !(d.percent > 0 && d.percent <= 100)) throw new CartError('BAD_DISCOUNT', 'bill percent must be 0–100')
}

/** The exact draft dayo's pricing code sees. `soldAtIso` is the payment instant (spec §5.1: re-price at sold_at). */
export function toOrderDraft(cart: CartDraft, catalog: PosOrderCatalog, soldAtIso: string): OrderDraft {
  const d = cart.billDiscount
  return {
    saleDate: bkkDay(0, Date.parse(soldAtIso)),
    saleTime: bkkTime(soldAtIso),
    channelCode: cart.channelCode,
    paymentCode: cart.paymentCode,
    lines: cart.lines.map((l) => ({
      code: l.code, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty, free: l.free,
      discountBaht: l.discountSatang === null ? null : edgeSatangToBaht(l.discountSatang),
      discountPercent: l.discountPercent,
      discountReason: l.discountReason,
    })),
    billDiscountBaht: d !== null && d.kind === 'satang' ? edgeSatangToBaht(d.satang) : null,
    billDiscountPercent: d !== null && d.kind === 'percent' ? d.percent : null,
    billDiscountReason: d?.reason ?? null,
    promoCode: cart.promoCode,
    // spec §4.5 no_promotions: OrderDraft has no such field — skipping every promotion gives the same result
    skipPromotionIds: cart.noPromotions ? catalog.promotions.map((p) => p.id) : [...cart.skipPromotionIds],
  }
}

export function priceCart(cart: CartDraft, catalog: PosOrderCatalog, soldAtIso: string): PricedCart {
  checkCart(cart, catalog)
  const draft = toOrderDraft(cart, catalog, soldAtIso)
  const q = computeOrder(draft, withZeroCosts(catalog))
  // spec §5.1: only these fields are money; costTotal/grossProfit/gpPercent/unitCost are not converted
  const priced: Omit<PricedCart, 'discountSatang'> = {
    ok: q.ok,
    warnings: q.warnings,
    soldAt: soldAtIso,
    saleDate: draft.saleDate,
    saleTime: draft.saleTime ?? '',
    draft,
    lines: q.lines.map((l) => ({
      lineNo: l.lineNo, code: l.menuCode, nameTh: l.menuNameTh, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty,
      unitPriceSatang: edgeBahtToSatang(l.unitPrice),
      discountPerCupSatang: edgeBahtToSatang(l.discountPerCup),
      discountReason: l.discountReason,
      promotionId: l.promotionId,
      lineTotalSatang: edgeBahtToSatang(l.lineTotal),
    })),
    promotionsApplied: q.promotionsApplied.map((p) => ({ promotionId: p.promotionId, code: p.code, name: p.name, kind: p.kind, discountSatang: edgeBahtToSatang(p.discountAmount) })),
    itemsSubtotalSatang: edgeBahtToSatang(q.itemsSubtotal),
    itemsDiscountSatang: edgeBahtToSatang(q.itemsDiscount),
    billDiscountSatang: edgeBahtToSatang(q.billDiscountAmount),
    totalSatang: edgeBahtToSatang(q.totalAmount),
    channelFeeSatang: edgeBahtToSatang(q.channelFeeAmount),
  }
  // The Z report stores subtotal − discount = total (plan 3b). If dayo ever adds another amount to totalAmount this
  // stops the sale loudly instead of skewing the Z's discount silently (review item 18 — money rules stay in the domain).
  const discountSatang = priced.itemsDiscountSatang + priced.billDiscountSatang
  if (priced.itemsSubtotalSatang - discountSatang !== priced.totalSatang) {
    return { ...priced, ok: false, discountSatang, warnings: [...priced.warnings, 'PRICED_TOTAL_MISMATCH: subtotal − discounts ≠ total'] }
  }
  return { ...priced, discountSatang }
}

/** Sum of satang amounts (never float baht — spec §5.4). */
export function sumSatang(values: readonly number[]): number {
  return values.reduce((a, v) => {
    if (!Number.isSafeInteger(v)) throw new RangeError(`not whole satang: ${v}`)
    return a + v
  }, 0)
}

/** What dayo computed minus what the tablet charged (spec §4.3) — null until dayo answered. */
export function centralDiffSatang(computedSatang: number | null, chargedSatang: number): number | null {
  return computedSatang === null ? null : computedSatang - chargedSatang
}

/** The milk dayo picks for an unspecified line (dayo_impl_price_line): shop default oat + oat possible → oat. */
export function defaultMilkForLine(catalog: PosOrderCatalog, variant: PosVariant): MilkCode {
  if (saleSettingsOf(catalog).defaultMilk !== 'oat') return 'fresh'
  return applyOptions(variant, { milk: 'oat', grade: null }, catalog).ok ? 'oat' : 'fresh'
}

export function lineOptions(catalog: PosOrderCatalog, code: string, size: Size, sweetness: Sweetness): { milk: MilkChoice[]; grades: GradeChoice[]; defaultMilk: MilkCode; defaultGrade: string | null } {
  const v = findVariant(catalog, code, size, sweetness)
  if (!v) throw new CartError('UNKNOWN_VARIANT', `${code} ${size} ${sweetness}`)
  const milk: MilkChoice[] = [{ code: 'fresh', priceAddSatang: 0 }]
  const oat = applyOptions(v, { milk: 'oat', grade: null }, catalog)
  if (oat.ok) milk.push({ code: 'oat', priceAddSatang: edgeBahtToSatang(oat.priceAdd) })
  const grades: GradeChoice[] = v.isMatcha
    ? catalog.gradeOptions.flatMap((g) => {
        const r = applyOptions(v, { milk: 'fresh', grade: g.code }, catalog)
        return r.ok ? [{ code: g.code, priceAddSatang: edgeBahtToSatang(r.priceAdd), isDefault: g.isDefault }] : []
      })
    : []
  const defaultGrade = v.isMatcha ? ((grades.find((g) => g.isDefault) ?? grades[0])?.code ?? null) : null
  return { milk, grades, defaultMilk: defaultMilkForLine(catalog, v), defaultGrade }
}

/**
 * The E1 catalog after zod validation (contracts `PosOrderCatalog`). zod infers optional keys as `T | undefined`, which
 * `exactOptionalPropertyTypes` will not assign to dayo's interfaces; the schema checks every field the pricing code
 * reads (a test pins that), so this cast is the one sanctioned bridge. If zod's inferred type ever assigns directly,
 * drop the cast.
 */
export function toPricingCatalog(parsed: PosOrderCatalogParsed): PosOrderCatalog {
  return parsed as unknown as PosOrderCatalog
}

/** Unit price on a channel before options and promotions — for the menu grid only (dayo channelPrice, then the edge). */
export function menuUnitPriceSatang(catalog: PosOrderCatalog, variant: PosVariant, channelCode: string): number | null {
  const channel = catalog.channels.find((c) => c.code === channelCode)
  return channel === undefined ? null : edgeBahtToSatang(channelPrice(variant.price, channel))
}
```

`packages/domain/src/order-row.ts`:

```ts
import type { OrderRowData } from '@dayo/contracts'
import { edgeBahtToSatang, edgeSatangToBaht } from './money-edge.js'
import { CartError, type BillDiscountDraft, type CartDraft, type CartLineDraft, type PricedCart } from './price-cart.js'

export type OrderRowInput = { posOrderId: string; receiptNo: string; queueNo: number; staffId: string; catalogVersion: number; cart: CartDraft; priced: PricedCart; note: string | null }

function lineToRow(l: CartLineDraft): OrderRowData['lines'][number] {
  return {
    code: l.code, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty,
    ...(l.free ? { free: true } : {}),
    ...(l.discountSatang !== null ? { discount_baht: edgeSatangToBaht(l.discountSatang) } : {}),
    ...(l.discountPercent !== null ? { discount_percent: l.discountPercent } : {}),
    ...(l.discountReason !== null ? { discount_reason: l.discountReason } : {}),
  }
}

function billToRow(d: BillDiscountDraft | null): OrderRowData['bill_discount'] {
  if (d === null) return null
  return d.kind === 'satang' ? { baht: edgeSatangToBaht(d.satang), reason: d.reason } : { percent: d.percent, reason: d.reason }
}

/** `data` of an E2 row of kind `order` (spec 04 §4.5) — money converted once, here, at write time (spec §6.1). */
export function buildOrderRowData(i: OrderRowInput): OrderRowData {
  const p = i.priced
  return {
    pos_order_id: i.posOrderId,
    receipt_no: i.receiptNo,
    queue_no: i.queueNo,
    sale_date: p.saleDate,
    sold_at: p.soldAt,
    channel: i.cart.channelCode,
    payment: i.cart.paymentCode,
    staff_id: i.staffId,
    catalog_version: i.catalogVersion,
    shift_id: null, // block 2: always null (spec §4.5 shift_id)
    lines: i.cart.lines.map(lineToRow),
    bill_discount: billToRow(i.cart.billDiscount),
    promo_code: i.cart.promoCode,
    skip_promotion_ids: i.cart.noPromotions ? [] : [...i.cart.skipPromotionIds],
    no_promotions: i.cart.noPromotions,
    totals: {
      items_subtotal: edgeSatangToBaht(p.itemsSubtotalSatang),
      items_discount: edgeSatangToBaht(p.itemsDiscountSatang),
      bill_discount: edgeSatangToBaht(p.billDiscountSatang),
      total: edgeSatangToBaht(p.totalSatang),
    },
    note: i.note,
  }
}

/** A queued E2 row → the cart it describes (the inverse of buildOrderRowData; owner remedies and tests use it). */
export function orderRowToCart(draft: OrderRowData): { cart: CartDraft; soldAt: string } {
  const b = draft.bill_discount ?? null
  const baht = b?.baht ?? null
  const percent = b?.percent ?? null
  if (baht !== null && percent !== null) throw new CartError('BAD_DISCOUNT', 'bill_discount has both baht and percent') // spec §5.3 case 15
  const billDiscount: BillDiscountDraft | null =
    baht !== null ? { kind: 'satang', satang: edgeBahtToSatang(baht), reason: b?.reason ?? null }
    : percent !== null ? { kind: 'percent', percent, reason: b?.reason ?? null }
    : null
  return {
    soldAt: draft.sold_at,
    cart: {
      channelCode: draft.channel,
      paymentCode: draft.payment,
      lines: draft.lines.map((l) => ({
        code: l.code, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty,
        free: l.free ?? false,
        discountSatang: l.discount_baht === undefined || l.discount_baht === null ? null : edgeBahtToSatang(l.discount_baht),
        discountPercent: l.discount_percent ?? null,
        discountReason: l.discount_reason ?? null,
      })),
      billDiscount,
      promoCode: draft.promo_code ?? null,
      skipPromotionIds: draft.no_promotions ? [] : [...(draft.skip_promotion_ids ?? [])],
      noPromotions: draft.no_promotions ?? false,
    },
  }
}
```

`packages/domain/src/index.ts` เพิ่ม `export * from './price-cart.js'` และ `export * from './order-row.js'`

- [ ] **Step 5: รันให้ผ่าน** — `pnpm --filter @dayo/domain test` → PASS ทั้งแพ็กเกจ (เทสต์เดิมของ `pricing.ts`/`sale.ts` ยังผ่าน — ลบใน Task 22) · `pnpm turbo run typecheck` → ผ่าน

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/price-cart.ts packages/domain/src/order-row.ts packages/domain/src/index.ts packages/domain/package.json packages/domain/test/price-cart.test.ts packages/domain/test/order-row.test.ts packages/domain/test/fixtures/pos-catalog.ts pnpm-lock.yaml
git commit -m "feat(domain): price a cart with dayo's pricing code and build the push row"
```

---

### Task 4: parity ชั้น ค (ต่าง 0 สตางค์)

ผู้ทำ: domain-engineer (opus) · สเปก §5.2 ชั้น ค, §5.3 · แผนก้อน 1 Task 11/13 (รูปไฟล์ `pos-parity.json`) · ruling R2 · รอ Task 3

**Files:**
- Create: `packages/domain/src/order-draft.ts` (`cartFromOrderDraft`), `packages/domain/test/order-draft.test.ts`
- Create: `packages/domain/test/fixtures/parity-cases.ts`, `packages/domain/scripts/gen-parity-seed.ts`, `packages/domain/test/parity.test.ts`
- Create (ด้วยสคริปต์): `packages/dayo-pricing/fixtures/pos-parity.seed.json`
- Modify: `packages/domain/src/index.ts`, `packages/domain/package.json` (script `"parity:seed": "tsx scripts/gen-parity-seed.ts"`, devDependency `"tsx": "4.23.13"`), `packages/domain/tsconfig.json` (`include` เพิ่ม `"scripts"`)

**Interfaces:**
- Consumes: `priceCart`, `defaultMilkForLine`, `toPricingCatalog`, `withZeroCosts`, `toOrderDraft`, `CartError` (Task 3) · `ParityFile`, `ParityDraft`, `ParityMoney` (Task 5) · `loadRichCatalog` (Task 6) · `VENDOR.json` (Task 2) · `computeOrder`, `saleSettingsOf` (Task 2)
- Produces:

```ts
/** dayo's OrderDraft (a parity case) → the cart the tablet would build: fills every value the tablet always interprets (§4.5). */
export function cartFromOrderDraft(draft: ParityDraft, catalog: PosOrderCatalog): { cart: CartDraft; soldAt: string }
```

และเทสต์ `parity.test.ts` ที่ **ใช้ `packages/dayo-pricing/fixtures/pos-parity.json` ของจริงแทน seed อัตโนมัติเมื่อไฟล์นั้นมี** (เจ้าของวางใน Task 23)

รูปไฟล์ = `ParityFile` (Task 5) = ผลของ `scripts/export-pos-parity.ts` ของ dayo (แผนก้อน 1 Task 13): `{ dayo_commit, pricing_files_sha256, generated_at, catalog_version, catalog, cases: [{ id, spec, draft: OrderDraft, expected: ParityMoney }] }` · `ParityMoney` เป็นบาท `{ ok, itemsSubtotal, itemsDiscount, billDiscountAmount, totalAmount, channelFeeAmount, lines: [{ lineNo, unitPrice, discountPerCup, lineTotal }], promotionsApplied: [{ promotionId, discountAmount }] }` · ชั้น ค เทียบทุกฟิลด์เงินผ่าน `edgeBahtToSatang` ต้องต่าง 0 สตางค์

กติกาการแปลงเคสเป็นตะกร้า (เหมือนที่แท็บเล็ตตีความตอนขายจริง — spec §4.5 `milk`/`grade` ห้าม null):

| ใน `OrderDraft` | ในตะกร้าของแท็บเล็ต |
|---|---|
| `saleDate` + `saleTime` (`HH:MM`) | `soldAt` = `saleDate`T`saleTime`:00.000 เวลาไทย → ISO UTC · **ไม่มี `saleTime` = เทสต์ล้มพร้อมข้อความ** "เคสนี้ไม่มี saleTime — แท็บเล็ตส่งเวลาเสมอ ขอทีม dayo เติม" (ไม่ข้ามเงียบ) |
| `size`/`sweetness` ว่าง | ค่าตั้งร้าน `settings.defaultSize`/`defaultSweetness` |
| `milk` ว่าง | `defaultMilkForLine(catalog, variant)` |
| `grade` ว่างในเมนูมัตฉะ | เกรด `isDefault` ของแคตตาล็อก |
| `channelCode` ว่าง / `paymentCode` ว่าง | `settings.defaultChannelCode` / ช่องทาง `defaultPaymentMethodCode` หรือ `cash` |
| `discountBaht` / `billDiscountBaht` | `edgeBahtToSatang` |
| `billDiscountBaht` และ `billDiscountPercent` พร้อมกัน | `CartError BAD_DISCOUNT` (เคส 15 — ต้องคู่กับ `expected.ok = false`) |

- [ ] **Step 1: เขียนเทสต์ที่ล้มของตัวแปลง** — `packages/domain/test/order-draft.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { cartFromOrderDraft } from '../src/order-draft.js'
import { CartError } from '../src/price-cart.js'
import { POS_CATALOG } from './fixtures/pos-catalog.js'

describe('cartFromOrderDraft (dayo OrderDraft → the tablet cart)', () => {
  it('turns saleDate + saleTime (Bangkok) into sold_at and fills interpreted values', () => {
    const { cart, soldAt } = cartFromOrderDraft({ saleDate: '2026-09-25', saleTime: '14:30', channelCode: '', lines: [{ code: 'Matcha Latte', qty: 1 }] }, POS_CATALOG)
    expect(soldAt).toBe('2026-09-25T07:30:00.000Z')
    expect(cart).toMatchObject({ channelCode: 'store', paymentCode: 'cash', lines: [{ code: 'Matcha Latte', size: '16 oz', sweetness: '100%', milk: 'fresh', grade: 'Excellent', qty: 1 }] })
  })
  it('converts baht discounts at the edge', () => {
    const { cart } = cartFromOrderDraft({ saleDate: '2026-09-25', saleTime: '10:00', channelCode: 'store', lines: [{ code: 'Thai Tea', size: '16 oz', sweetness: '50%', qty: 1, discountBaht: 5.25 }], billDiscountBaht: 10, billDiscountReason: 'x' }, POS_CATALOG)
    expect(cart.lines[0]!.discountSatang).toBe(525)
    expect(cart.billDiscount).toEqual({ kind: 'satang', satang: 1000, reason: 'x' })
  })
  it('refuses baht and percent together (spec §5.3 case 15)', () => {
    expect(() => cartFromOrderDraft({ saleDate: '2026-09-25', saleTime: '10:00', channelCode: 'store', lines: [{ code: 'Thai Tea', qty: 1 }], billDiscountBaht: 5, billDiscountPercent: 10 }, POS_CATALOG)).toThrow(CartError)
  })
  it('refuses a case without saleTime: the tablet always sends the time', () => {
    expect(() => cartFromOrderDraft({ saleDate: '2026-09-25', channelCode: 'store', lines: [{ code: 'Thai Tea', qty: 1 }] }, POS_CATALOG)).toThrow(/NO_SALE_TIME/)
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/domain test -- order-draft` · คาดว่า FAIL: module not found

- [ ] **Step 3: เขียนตัวแปลง** — `packages/domain/src/order-draft.ts`

```ts
import { saleSettingsOf } from '@dayo/dayo-pricing'
import type { ParityDraft } from '@dayo/contracts'
import { edgeBahtToSatang } from './money-edge.js'
import { CartError, defaultMilkForLine, type CartDraft, type PosOrderCatalog } from './price-cart.js'

/** dayo's OrderDraft (a parity case of pos-parity.json) → the cart the tablet would build for it (spec 04 §4.5, §5.2 layer C). */
export function cartFromOrderDraft(draft: ParityDraft, catalog: PosOrderCatalog): { cart: CartDraft; soldAt: string } {
  if (draft.saleTime === undefined) throw new Error('NO_SALE_TIME: the tablet always sends sold_at; ask the dayo team to set saleTime on this case')
  if (draft.billDiscountBaht != null && draft.billDiscountPercent != null) throw new CartError('BAD_DISCOUNT', 'bill discount has both baht and percent')
  const set = saleSettingsOf(catalog)
  const channelCode = draft.channelCode || set.defaultChannelCode
  const channel = catalog.channels.find((c) => c.code === channelCode)
  const defaultGrade = (catalog.gradeOptions.find((g) => g.isDefault) ?? catalog.gradeOptions[0])?.code ?? null
  return {
    soldAt: new Date(`${draft.saleDate}T${draft.saleTime}:00.000+07:00`).toISOString(),
    cart: {
      channelCode,
      paymentCode: draft.paymentCode ?? channel?.defaultPaymentMethodCode ?? 'cash',
      lines: draft.lines.map((l) => {
        const size = l.size ?? set.defaultSize
        const sweetness = l.sweetness ?? set.defaultSweetness
        const v = catalog.variants.find((x) => x.menuCode === l.code && x.size === size && x.sweetness === sweetness)
        return {
          code: l.code, size, sweetness,
          milk: l.milk ?? (v === undefined ? 'fresh' : defaultMilkForLine(catalog, v)),
          grade: l.grade ?? (v?.isMatcha === true ? defaultGrade : null),
          qty: l.qty, free: l.free ?? false,
          discountSatang: l.discountBaht == null ? null : edgeBahtToSatang(l.discountBaht),
          discountPercent: l.discountPercent ?? null,
          discountReason: l.discountReason ?? null,
        }
      }),
      billDiscount: draft.billDiscountBaht != null ? { kind: 'satang', satang: edgeBahtToSatang(draft.billDiscountBaht), reason: draft.billDiscountReason ?? null }
        : draft.billDiscountPercent != null ? { kind: 'percent', percent: draft.billDiscountPercent, reason: draft.billDiscountReason ?? null }
        : null,
      promoCode: draft.promoCode ?? null,
      skipPromotionIds: [...(draft.skipPromotionIds ?? [])],
      noPromotions: false, // dayo cases express "no promotions" as skipPromotionIds = every id — the same result (spec §4.5)
    },
  }
}
```

`index.ts` เพิ่ม `export * from './order-draft.js'` · `packages/domain/test/money-edge-guard.test.ts` เพิ่ม `'packages/domain/src/order-draft.ts'` ใน `GUARDED`

- [ ] **Step 4: เคส §5.3 ของ seed** — `packages/domain/test/fixtures/parity-cases.ts` (รูป `OrderDraft` แบบเดียวกับที่ dayo export · 25 ก.ย. 2026 = วันศุกร์ · แคตตาล็อก `e1-catalog-rich.json`)

```ts
import type { ParityDraft } from '@dayo/contracts'

type L = ParityDraft['lines'][number]
const tt = (o: Partial<L> = {}): L => ({ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, ...o })
const mt = (o: Partial<L> = {}): L => ({ code: 'Matcha Latte', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: 'Excellent', qty: 1, ...o })
const cc = (o: Partial<L> = {}): L => ({ code: 'Cocoa', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, ...o })
const d = (lines: L[], o: Partial<ParityDraft> = {}): ParityDraft => ({ saleDate: '2026-09-25', saleTime: '10:30', channelCode: 'store', paymentCode: 'cash', lines, promoCode: null, skipPromotionIds: [], ...o })
const P = (n: number): string => `9f8e0000-0000-4000-8000-00000000000${n}`
const ALL = [1, 2, 3, 4, 5].map(P)
const SWEET = ['0%', '25%', '50%', '75%', '100%'] as const

/** spec 04 §5.3 on the POS test catalog. c11 (shop default oat) and c14 (disabled after sale) need another catalog state — only dayo's export has them. */
export const PARITY_CASES: { id: string; spec: string; draft: ParityDraft }[] = [
  { id: 'c01a-pct15-of-35', spec: '§5.3-1', draft: d([tt({ discountPercent: 15 })]) },
  { id: 'c01b-pct15-of-45', spec: '§5.3-1', draft: d([tt({ size: '20 oz', discountPercent: 15 })]) },
  { id: 'c01c-pct7-of-85', spec: '§5.3-1', draft: d([mt({ discountPercent: 7 })]) },
  { id: 'c01d-pct33-of-65', spec: '§5.3-1', draft: d([{ code: 'Pink Milk', size: '16 oz', sweetness: '100%', milk: 'fresh', grade: null, qty: 1, discountPercent: 33 }]) },
  { id: 'c02a-lineman-7pct-ceil-plus5', spec: '§5.3-2', draft: d([tt()], { channelCode: 'lineman', paymentCode: 'qr' }) },
  { id: 'c02b-grab-30pct-ceil', spec: '§5.3-2', draft: d([tt({ size: '20 oz' })], { channelCode: 'grab', paymentCode: 'qr' }) },
  { id: 'c03-grab-fee-and-channel-promo', spec: '§5.3-3', draft: d([cc({ qty: 2 })], { channelCode: 'grab', paymentCode: 'qr' }) },
  { id: 'c04a-bill-pct-after-line-discounts', spec: '§5.3-4', draft: d([tt({ qty: 2, discountBaht: 5 })], { billDiscountPercent: 10, billDiscountReason: 'สมาชิก', skipPromotionIds: [P(1)] }) },
  { id: 'c04b-code-bill-discount-max-amount', spec: '§5.3-4', draft: d([mt({ size: '20 oz', qty: 3 })], { promoCode: 'DAYO10' }) },
  { id: 'c05a-bundle-cocoa-thai-tea', spec: '§5.3-5', draft: d([cc(), tt()]) },
  { id: 'c05b-buy2get1-qty4', spec: '§5.3-5', draft: d([tt({ qty: 4 })]) },
  { id: 'c06a-oat-premium-matcha', spec: '§5.3-6', draft: d([mt({ milk: 'oat', grade: 'Premium' })]) },
  { id: 'c06b-oat-without-fresh-milk', spec: '§5.3-6', draft: d([cc({ milk: 'oat' })]) },
  { id: 'c07a-time-before', spec: '§5.3-7', draft: d([mt()], { saleTime: '13:59' }) },
  { id: 'c07b-time-inside', spec: '§5.3-7', draft: d([mt()], { saleTime: '14:30' }) },
  { id: 'c07c-time-after', spec: '§5.3-7', draft: d([mt()], { saleTime: '16:01' }) },
  { id: 'c07d-time-saturday', spec: '§5.3-7', draft: d([mt()], { saleDate: '2026-09-26', saleTime: '14:30' }) },
  { id: 'c08a-skip-one', spec: '§5.3-8', draft: d([tt({ qty: 3 })], { skipPromotionIds: [P(1)] }) },
  { id: 'c08b-no-promotions', spec: '§5.3-8', draft: d([tt({ qty: 3 })], { skipPromotionIds: ALL }) },
  { id: 'c08c-code-promo-without-code', spec: '§5.3-8', draft: d([mt({ size: '20 oz', qty: 3 })]) },
  { id: 'c09a-max-qty-99', spec: '§5.3-9', draft: d([tt({ qty: 99 })]) },
  { id: 'c09b-50-lines-500-cups', spec: '§5.3-9', draft: d(Array.from({ length: 50 }, (_, i) => tt({ sweetness: SWEET[i % 5], size: i % 2 === 0 ? '16 oz' : '20 oz', qty: 10 }))) },
  { id: 'c10a-free-without-reason', spec: '§5.3-10', draft: d([tt({ free: true })]) },
  { id: 'c10b-free-with-reason', spec: '§5.3-10', draft: d([tt({ free: true, discountReason: 'ชดเชยแก้วหก' })]) },
  { id: 'c11b-milk-omitted', spec: '§5.3-11', draft: d([tt({ milk: null })]) },
  { id: 'c12a-grab-promo-on-store', spec: '§5.3-12', draft: d([cc()]) },
  { id: 'c12b-grab-promo-on-grab', spec: '§5.3-12', draft: d([cc()], { channelCode: 'grab', paymentCode: 'qr' }) },
  { id: 'c13a-at-timeFrom', spec: '§5.3-13', draft: d([mt()], { saleTime: '14:00' }) },
  { id: 'c13b-at-timeTo', spec: '§5.3-13', draft: d([mt()], { saleTime: '16:00' }) },
  { id: 'c15-bill-baht-and-percent', spec: '§5.3-15', draft: d([tt()], { billDiscountBaht: 5, billDiscountPercent: 10, billDiscountReason: 'ผิดรูป' }) },
]
```

(การตัดวินาทีของ `sale_time` (§5.3 ข้อ 13 ส่วนแรก) เทสต์ที่ `toOrderDraft` ใน Task 3 แล้ว — `OrderDraft` เก็บแค่ HH:MM)

- [ ] **Step 5: สคริปต์สร้าง seed** — `packages/domain/scripts/gen-parity-seed.ts`

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { computeOrder } from '@dayo/dayo-pricing'
import { ParityFile } from '@dayo/contracts'
import { loadRichCatalog } from '@dayo/contracts/fixture-files'
import { CartError, cartFromOrderDraft, toOrderDraft, toPricingCatalog, withZeroCosts } from '../src/index.js'
import { PARITY_CASES } from '../test/fixtures/parity-cases.js'

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url))
const e1 = loadRichCatalog()
const catalog = toPricingCatalog(e1.catalog)
const vendor = JSON.parse(readFileSync(here('../../dayo-pricing/VENDOR.json'), 'utf8')) as { commit: string; files: Record<string, string> }
const r2 = (n: number): number => Math.round(n * 100) / 100
const REFUSED = { ok: false, itemsSubtotal: 0, itemsDiscount: 0, billDiscountAmount: 0, totalAmount: 0, channelFeeAmount: 0, lines: [], promotionsApplied: [] }

const cases = PARITY_CASES.map(({ id, spec, draft }) => {
  let parsed
  try { parsed = cartFromOrderDraft(draft, catalog) } catch (e) { if (e instanceof CartError) return { id, spec, draft, expected: REFUSED }; throw e }
  const q = computeOrder(toOrderDraft(parsed.cart, catalog, parsed.soldAt), withZeroCosts(catalog))
  return { id, spec, draft, expected: {
    ok: q.ok, itemsSubtotal: r2(q.itemsSubtotal), itemsDiscount: r2(q.itemsDiscount), billDiscountAmount: r2(q.billDiscountAmount), totalAmount: r2(q.totalAmount), channelFeeAmount: r2(q.channelFeeAmount),
    lines: q.lines.map((l) => ({ lineNo: l.lineNo, unitPrice: r2(l.unitPrice), discountPerCup: r2(l.discountPerCup), lineTotal: r2(l.lineTotal) })),
    promotionsApplied: q.promotionsApplied.map((p) => ({ promotionId: p.promotionId, discountAmount: r2(p.discountAmount) })),
  } }
})
const out = ParityFile.parse({ source: 'pos-seed: vendored computeOrder — NOT dayo quote_order', dayo_commit: vendor.commit, pricing_files_sha256: vendor.files, generated_at: new Date(0).toISOString(), catalog_version: e1.catalog_version, catalog: e1.catalog, cases })
writeFileSync(here('../../dayo-pricing/fixtures/pos-parity.seed.json'), `${JSON.stringify(out, null, 2)}\n`)
console.log(`wrote ${cases.length} seed cases`)
```

(`r2` เลียนแบบ `moneyFromShared` ของ dayo ในแผนก้อน 1 Task 11 · `generated_at` คงที่ให้ไฟล์ seed ไม่เปลี่ยนทุกครั้งที่รัน)

- [ ] **Step 6: เขียนเทสต์ parity** — `packages/domain/test/parity.test.ts`

```ts
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ParityFile } from '@dayo/contracts'
import { CartError, cartFromOrderDraft, edgeBahtToSatang, priceCart, toPricingCatalog } from '../src/index.js'

const REAL = fileURLToPath(new URL('../../dayo-pricing/fixtures/pos-parity.json', import.meta.url))
const SEED = fileURLToPath(new URL('../../dayo-pricing/fixtures/pos-parity.seed.json', import.meta.url))
const FILE = existsSync(REAL) ? REAL : SEED
const parity = ParityFile.parse(JSON.parse(readFileSync(FILE, 'utf8')))
const catalog = toPricingCatalog(parity.catalog)
const vendor = JSON.parse(readFileSync(fileURLToPath(new URL('../../dayo-pricing/VENDOR.json', import.meta.url)), 'utf8')) as { files: Record<string, string> }
/** Cases whose draft the tablet can never build (e.g. qty above maxQtyPerLine that dayo clamps). Each entry needs a reason and the head's OK. */
const TABLET_UNREACHABLE = new Map<string, string>([])

describe(`parity layer C (spec 04 §5.2) — ${FILE === REAL ? 'dayo export' : 'POS SEED: wrapper check only, NOT the block-2 gate'}`, () => {
  it('the fixture was made with the vendored pricing version', () => {
    expect(parity.pricing_files_sha256, 'ตัวคิดราคาในเครื่องไม่ตรงรุ่นกับ dayo').toEqual(vendor.files)
  })
  for (const c of parity.cases) {
    const skip = TABLET_UNREACHABLE.get(c.id)
    it.skipIf(skip !== undefined)(`${c.id}: 0 satang difference on every money field`, () => {
      let priced
      try {
        const { cart, soldAt } = cartFromOrderDraft(c.draft, catalog)
        priced = priceCart(cart, catalog, soldAt)
      } catch (e) {
        if (!(e instanceof CartError)) throw e
        expect(c.expected.ok, `the tablet refuses ${c.id} (${e.code}) but dayo accepts it`).toBe(false)
        return
      }
      expect(priced.ok).toBe(c.expected.ok)
      if (!c.expected.ok) return
      const e = c.expected
      expect({
        itemsSubtotal: priced.itemsSubtotalSatang, itemsDiscount: priced.itemsDiscountSatang, billDiscountAmount: priced.billDiscountSatang,
        totalAmount: priced.totalSatang, channelFeeAmount: priced.channelFeeSatang,
        lines: priced.lines.map((l) => [l.lineNo, l.unitPriceSatang, l.discountPerCupSatang, l.lineTotalSatang]),
        promotionsApplied: priced.promotionsApplied.map((p) => [p.promotionId, p.discountSatang]),
      }).toEqual({
        itemsSubtotal: edgeBahtToSatang(e.itemsSubtotal), itemsDiscount: edgeBahtToSatang(e.itemsDiscount), billDiscountAmount: edgeBahtToSatang(e.billDiscountAmount),
        totalAmount: edgeBahtToSatang(e.totalAmount), channelFeeAmount: edgeBahtToSatang(e.channelFeeAmount),
        lines: e.lines.map((l) => [l.lineNo, edgeBahtToSatang(l.unitPrice), edgeBahtToSatang(l.discountPerCup), edgeBahtToSatang(l.lineTotal)]),
        promotionsApplied: e.promotionsApplied.map((p) => [p.promotionId, edgeBahtToSatang(p.discountAmount)]),
      })
    })
  }
})
```

- [ ] **Step 7: รันให้ล้ม แล้วสร้าง seed** — `pnpm --filter @dayo/domain test -- parity` → FAIL (`ENOENT … pos-parity.seed.json`) · `pnpm --filter @dayo/domain parity:seed` → `wrote 30 seed cases` · ตรวจด้วยตา: `c05b.expected.totalAmount = 105` (4 แก้ว แถม 1) · `c06b.expected.ok = false` · `c08c` ไม่มีโปร DAYO10 ใน `promotionsApplied` · `c15.expected.ok = false` · `c09a.expected.totalAmount = 2310` (99 × 35 − 33 × 35)

- [ ] **Step 8: รันให้ผ่าน** — `pnpm --filter @dayo/domain test` → PASS · หัว describe ขึ้น `POS SEED` (ยังไม่มีไฟล์จริง — ถูกต้อง)

- [ ] **Step 9: Commit**

```bash
git add packages/domain/src/order-draft.ts packages/domain/src/index.ts packages/domain/test/order-draft.test.ts packages/domain/test/money-edge-guard.test.ts packages/domain/test/fixtures/parity-cases.ts packages/domain/scripts/gen-parity-seed.ts packages/domain/test/parity.test.ts packages/domain/package.json packages/domain/tsconfig.json packages/dayo-pricing/fixtures/pos-parity.seed.json pnpm-lock.yaml
git commit -m "test(domain): check price parity with dayo to the satang"
```

---

## 3. สาย B — สัญญา, fixture, mock

### Task 5: zod ของสัญญา E1/E2/E3 ใน `@dayo/contracts`

ผู้ทำ: domain-engineer (opus) · สเปก §4.1, §4.4, §4.5, §4.6, §4.11 ข้อ 1, §5.2

**Files:**
- Create: `packages/contracts/src/dayo-api.ts`, `packages/contracts/test/dayo-api.test.ts`
- Modify: `packages/contracts/src/enums.ts`, `packages/contracts/src/index.ts` (`export * from './dayo-api.js'`)

**Interfaces:**
- Consumes: —
- Produces (ทุกสายใช้):
  - ค่าคงที่ `MAX_PUSH_ROWS = 20` · `MAX_PUSH_BODY_BYTES = 262_144` · `MAX_ROW_KEY_LENGTH = 200` · `MAX_DETAIL_CODE_POINTS = 500` · `API_KEY_RE` · `RECEIPT_NO_RE` · `PUSH_KINDS = ['order','order_void']` · `KNOWN_REJECT_REASONS` · `KNOWN_DEFER_REASONS`
  - schema: `Uuid` `IsoSent` `IsoReceived` `Ymd` `Baht` `Text200` `SizeCode` `SweetnessCode` `MilkCodeSchema` · `PosOrderCatalog` (+ type `PosOrderCatalogParsed`) · `StaffEntry` · `PricingInfo` · `ClientInfo` · `PosCatalogChanged` · `PosCatalogUnchanged` · `PosCatalogData` · `PosCatalogResponse` · `PosCatalogLooseData` · `PosCatalogLooseResponse` (R12: `catalog` เป็น `unknown` แล้วตรวจแยก) · `OrderLineData` · `OrderRowData` · `OrderVoidRowData` · `PushRow` · `PushRequest` · `PushEnvelope` · `ReceivedRowResult` · `OrderAcceptedData` · `OrderVoidAcceptedData` · `PushResponseData` · `PushResponse` · `CentralOrder` · `OrdersListResponse` · `ApiErrorBody` · `ParityDraft` (= `OrderDraft` ของ dayo) · `ParityMoney` · `ParityFile` (รูปไฟล์ `pos-parity.json` ของแผนก้อน 1 Task 13)
  - ฟังก์ชัน `rowKey(kind, id)` · `fieldsUsed(data)` · `isRowSupported(kind, data, supported)` · `bangkokDateOf(iso)` · `clipCodePoints(text, max)`
  - enum: `UserRole` = `owner | manager | staff` · `OutboxStatus` = `pending | sent | dead | local_only` · `EventType` เพิ่ม `RECEIPT_RENUMBERED`, `CODE_REMAPPED`, `STAFF_REMAPPED`, `EXCLUDED_FROM_SYNC`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `packages/contracts/test/dayo-api.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  Baht, clipCodePoints, fieldsUsed, IsoReceived, isRowSupported, OrderRowData, OrderVoidRowData, PosCatalogUnchanged,
  PushRequest, PushResponse, ReceivedRowResult, rowKey, Text200,
} from '../src/dayo-api.js'
import { OutboxStatus, UserRole } from '../src/enums.js'

/** spec 04 §4.5 example, verbatim. */
export const SPEC_ORDER = {
  pos_order_id: '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21', receipt_no: 'A-000312', queue_no: 12,
  sale_date: '2026-09-25', sold_at: '2026-09-25T03:15:03.120Z', channel: 'store', payment: 'cash',
  staff_id: '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d', catalog_version: 42, shift_id: null,
  lines: [
    { code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 3 },
    { code: 'Matcha Latte', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: 'Excellent', qty: 1 },
  ],
  bill_discount: null, promo_code: null, skip_promotion_ids: [], no_promotions: false,
  totals: { items_subtotal: 190, items_discount: 35, bill_discount: 0, total: 155 }, note: null,
}
const row = (data: object = SPEC_ORDER) => ({ key: `order:${SPEC_ORDER.pos_order_id}`, kind: 'order', data })

describe('E2 request (spec §4.5)', () => {
  it('the spec example is a valid request', () => {
    expect(PushRequest.safeParse({ device_time: '2026-09-25T03:15:03.120Z', rows: [row()] }).success).toBe(true)
  })
  it('key must be <kind>:<pos_order_id>', () => {
    expect(PushRequest.safeParse({ device_time: '2026-09-25T03:15:03.120Z', rows: [{ ...row(), key: 'order:11111111-1111-4111-8111-111111111111' }] }).success).toBe(false)
    expect(rowKey('order_void', SPEC_ORDER.pos_order_id)).toBe(`order_void:${SPEC_ORDER.pos_order_id}`)
  })
  it.each([
    ['sale_date not the Thai date of sold_at', { sale_date: '2026-09-24' }],
    ['milk null', { lines: [{ ...SPEC_ORDER.lines[0], milk: null }] }],
    ['bill discount baht and percent', { bill_discount: { baht: 5, percent: 10, reason: null } }],
    ['sold_at without milliseconds', { sold_at: '2026-09-25T03:15:03Z' }],
    ['more than 2 decimals', { totals: { ...SPEC_ORDER.totals, total: 155.001 } }],
    ['unknown field', { tip: 5 }],
    ['21 lines is fine but 51 is not', { lines: Array.from({ length: 51 }, () => SPEC_ORDER.lines[0]) }],
  ])('%s → invalid', (_, over) => {
    expect(OrderRowData.safeParse({ ...SPEC_ORDER, ...over }).success).toBe(false)
  })
  it('21 rows is an envelope error', () => {
    expect(PushRequest.safeParse({ device_time: '2026-09-25T03:15:03.120Z', rows: Array.from({ length: 21 }, () => row()) }).success).toBe(false)
  })
  it('order_void needs a reason of 1–200 code points without control characters', () => {
    const v = { pos_order_id: SPEC_ORDER.pos_order_id, voided_at: '2026-09-25T03:20:00.000Z', staff_id: SPEC_ORDER.staff_id, approved_by: null, reason: 'ลูกค้าเปลี่ยนใจ' }
    expect(OrderVoidRowData.safeParse(v).success).toBe(true)
    expect(OrderVoidRowData.safeParse({ ...v, reason: '' }).success).toBe(false)
    expect(OrderVoidRowData.safeParse({ ...v, reason: 'a\u0007b' }).success).toBe(false)
    expect(Text200.safeParse('ก'.repeat(200)).success).toBe(true)
    expect(Text200.safeParse('ก'.repeat(201)).success).toBe(false)
  })
  it('Baht accepts dayo round2 results and refuses 3 decimals', () => {
    expect(Baht.safeParse(0.1 + 0.2).success).toBe(true)
    expect(Baht.safeParse(36.675).success).toBe(false)
  })
})

describe('E2 response is tolerant (spec §4.1 ความเข้ากันได้ · plan-5 ReceivedRowResult)', () => {
  it('accepts a status, reason and fields this build does not know', () => {
    const body = { ok: true, data: { server_time: '2026-09-25T03:15:04.010+00:00', extra: 1, results: [{ key: 'order:x', status: 'quarantined', reason: 'NEW_REASON', detail: 'x'.repeat(900), data: { anything: true }, more: 2 }] } }
    expect(PushResponse.safeParse(body).success).toBe(true)
    expect(ReceivedRowResult.safeParse({ key: 'k', status: 'accepted' }).success).toBe(true)
  })
})

describe('supported kinds and fields (spec §4.4 rule 10)', () => {
  it('fieldsUsed names nested array keys with a dot, objects by their top key', () => {
    expect(fieldsUsed({ ...SPEC_ORDER, lines: [{ code: 'x', qty: 1, discount_baht: 5 }] })).toEqual([
      'bill_discount', 'catalog_version', 'channel', 'lines', 'lines.code', 'lines.discount_baht', 'lines.qty', 'no_promotions', 'note', 'payment',
      'pos_order_id', 'promo_code', 'queue_no', 'receipt_no', 'sale_date', 'shift_id', 'skip_promotion_ids', 'sold_at', 'staff_id', 'totals',
    ])
  })
  it('a row is held when its kind or any field is missing from the lists', () => {
    const supported = { kinds: ['order'], fields: { order: fieldsUsed(SPEC_ORDER) } }
    expect(isRowSupported('order', SPEC_ORDER, supported)).toBe(true)
    expect(isRowSupported('order', { ...SPEC_ORDER, lines: [{ ...SPEC_ORDER.lines[0], free: true }] }, supported)).toBe(false)
    expect(isRowSupported('order_void', {}, supported)).toBe(false)
  })
})

describe('E1 and time', () => {
  it('parses Postgres timestamps with +00:00 and Z', () => {
    expect(IsoReceived.safeParse('2026-09-25T02:00:00.120+00:00').success).toBe(true)
    expect(IsoReceived.safeParse('2026-09-25T02:00:00Z').success).toBe(true)
  })
  it('the unchanged answer of the spec parses', () => {
    expect(PosCatalogUnchanged.safeParse({ changed: false, catalog_version: 42, server_time: '2026-09-25T02:00:00.120+00:00', pricing: { commit: 'abc', files_sha256: {} }, supported_kinds: ['order', 'order_void'], supported_fields: { order: [], order_void: [] } }).success).toBe(true)
  })
})

describe('enums for block 2', () => {
  it('knows manager and local_only', () => {
    expect(UserRole.options).toEqual(['owner', 'manager', 'staff'])
    expect(OutboxStatus.options).toContain('local_only')
  })
  it('clipCodePoints never splits a surrogate pair', () => {
    expect(clipCodePoints('😀😀😀', 2)).toBe('😀😀')
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/contracts test -- dayo-api` · คาดว่า FAIL: module not found

- [ ] **Step 3: แก้ enum** — `packages/contracts/src/enums.ts`

```ts
// spec 04 §7 ข้อ 6: roles come from dayo staff.role
export const UserRole = z.enum(['owner', 'manager', 'staff'])

// plan 3 events + block-2 owner remedies of the "ส่งไม่ผ่าน" page (spec 04 §6.4) — all go into the device hash chain
export const EventType = z.enum(['CREATED', 'LINE_ADDED', 'LINE_REMOVED', 'DISCOUNT_APPLIED', 'PAYMENT_CLAIMED', 'PAID', 'READY', 'PICKED_UP', 'CANCELLED', 'REJECTED', 'VOIDED', 'STOCK_DEDUCTED', 'STOCK_RETURNED', 'NOTE', 'RECEIPT_RENUMBERED', 'CODE_REMAPPED', 'STAFF_REMAPPED', 'EXCLUDED_FROM_SYNC'])

/**
 * outbox.status on the device (spec 04 §6.1). `pending` = waiting or retrying · `sent` = dayo accepted it (or answered
 * duplicate) · `dead` = on the "ส่งไม่ผ่าน" page (rejected, STUCK, ENVELOPE, PARENT_REJECTED) — never retried
 * automatically, the owner presses "ลองใหม่" · `local_only` = never sent: rows of the plan-3/4 format, shift/cash rows
 * of block 2, and rows the owner closed as "นอกระบบกลาง".
 */
export const OutboxStatus = z.enum(['pending', 'sent', 'dead', 'local_only'])
```

- [ ] **Step 4: เขียน schema** — `packages/contracts/src/dayo-api.ts`

```ts
import { z } from 'zod'

// ── limits (spec 04 §4.1, §4.5, §6.2) ──────────────────────────────────────────────────────────────────────────────
export const MAX_PUSH_ROWS = 20
export const MAX_PUSH_BODY_BYTES = 262_144
export const MAX_ROW_KEY_LENGTH = 200
export const MAX_DETAIL_CODE_POINTS = 500
export const TEXT_MAX_CODE_POINTS = 200
export const API_KEY_RE = /^dayo_[0-9a-f]{64}$/
export const RECEIPT_NO_RE = /^[A-Z]{1,3}-\d{6}$/
export const PUSH_KINDS = ['order', 'order_void'] as const
export type PushKind = (typeof PUSH_KINDS)[number]
export const KNOWN_REJECT_REASONS = ['INVALID', 'BAD_KEY', 'UNKNOWN_CODE', 'UNKNOWN_STAFF', 'CONFLICT', 'ALREADY_PRESENT', 'FORBIDDEN'] as const
export const KNOWN_DEFER_REASONS = ['PARENT_PENDING', 'BUSY', 'CLOCK_AHEAD', 'UNSUPPORTED', 'SERVER_ERROR'] as const

/** Shortens to `max` CODE POINTS — never strands half a surrogate pair (plan 5 `clip`, fix N4-2). */
export function clipCodePoints(text: string, max: number): string {
  const points = [...text]
  return points.length <= max ? text : points.slice(0, max).join('')
}

/** Thai calendar date (YYYY-MM-DD) of an instant — the shop closes before midnight (ADR-0024). */
export function bangkokDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10)
}

export const rowKey = (kind: PushKind, id: string): string => `${kind}:${id}`

// ── scalars (spec 04 §4.1) ─────────────────────────────────────────────────────────────────────────────────────────
export const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
/** Times the tablet SENDS: UTC with milliseconds. */
export const IsoSent = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine((s) => !Number.isNaN(Date.parse(s)), 'not a real instant')
/** Times the tablet RECEIVES: Postgres timestamptz text, `Z` or `±HH:MM`. */
export const IsoReceived = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/).refine((s) => !Number.isNaN(Date.parse(s)), 'not a real instant')
export const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
/** Baht on the wire: finite, ≥ 0, ≤ numeric(10,2), at most 2 decimals (the same tolerance as edgeBahtToSatang). */
export const Baht = z.number().finite().nonnegative().max(99_999_999.99).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) <= 1e-6, 'more than 2 decimals')
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/
export const Text200 = z.string().refine((s) => !CONTROL_RE.test(s), 'control character').refine((s) => { const n = [...s].length; return n >= 1 && n <= TEXT_MAX_CODE_POINTS }, '1–200 code points')
export const SizeCode = z.enum(['16 oz', '20 oz'])
export const SweetnessCode = z.enum(['0%', '25%', '50%', '75%', '100%'])
export const MilkCodeSchema = z.enum(['fresh', 'oat'])
const UseUnit = z.enum(['ml', 'g', 'ชิ้น'])
const HHMM = z.string().regex(/^\d{2}:\d{2}$/)

// ── E1 catalog = OrderCatalog of @dayo/shared without cost (spec §4.4 rule 1) ──────────────────────────────────────
// Anything the vendored pricing code reads is checked here; a catalog it cannot understand is refused whole (ruling R12).
const RecipeLine = z.looseObject({ ingredientId: z.string().nullable().optional(), baseId: z.string().nullable().optional(), qty: z.number().finite(), unit: UseUnit })
const Variant = z.looseObject({
  menuCode: z.string().min(1), menuNameTh: z.string(), family: z.string(), categoryLabel: z.string().optional(), menuSortOrder: z.number().optional(),
  size: SizeCode, sweetness: SweetnessCode, price: z.number().finite().nonnegative(), allowOatMilk: z.boolean(), isMatcha: z.boolean(), recipeLines: z.array(RecipeLine),
})
const Ingredient = z.looseObject({ id: z.string(), code: z.string(), name: z.string(), useUnit: UseUnit })
const Base = z.looseObject({ id: z.string(), code: z.string(), name: z.string(), yieldQty: z.number().finite(), yieldUnit: z.enum(['ml', 'g']), lines: z.array(z.looseObject({ ingredientId: z.string(), qty: z.number().finite() })) })
const MilkOption = z.looseObject({ code: MilkCodeSchema, ingredientId: z.string(), priceAdd: z.number().finite(), aliases: z.array(z.string()) })
const GradeOption = z.looseObject({ code: z.string().min(1), ingredientId: z.string(), multiplier: z.number().finite(), priceAdd: z.number().finite(), isDefault: z.boolean(), aliases: z.array(z.string()) })
const Channel = z.looseObject({ code: z.string().min(1), name: z.string(), aliases: z.array(z.string()), priceMarkupPct: z.number().finite(), priceAddBaht: z.number().finite(), rounding: z.enum(['ceil_baht', 'none']), feePct: z.number().finite(), defaultPaymentMethodCode: z.string().nullable() })
const PaymentMethod = z.looseObject({ code: z.string().min(1), name: z.string(), aliases: z.array(z.string()) })
const promoCommon = {
  id: z.string(), code: z.string().nullable(), name: z.string(),
  startsOn: Ymd.nullable().optional(), endsOn: Ymd.nullable().optional(), daysOfWeek: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  timeFrom: HHMM.nullable().optional(), timeTo: HHMM.nullable().optional(), channelCodes: z.array(z.string()).nullable().optional(),
  requiresCode: z.boolean(), autoApply: z.boolean(), priority: z.number().finite(), stackable: z.boolean(), isActive: z.boolean(),
}
const codes = z.array(z.string())
const Promotion = z.discriminatedUnion('kind', [
  z.looseObject({ ...promoCommon, kind: z.literal('buy_n_get_m'), params: z.looseObject({ buy_qty: z.number().int().min(1), get_qty: z.number().int().min(1), menu_codes: codes, max_sets: z.number().int().optional() }) }),
  z.looseObject({ ...promoCommon, kind: z.literal('item_discount'), params: z.looseObject({ menu_codes: codes, amount_baht: z.number().finite().optional(), percent: z.number().finite().optional() }) }),
  z.looseObject({ ...promoCommon, kind: z.literal('bill_discount'), params: z.looseObject({ min_subtotal: z.number().finite().optional(), amount_baht: z.number().finite().optional(), percent: z.number().finite().optional(), max_amount: z.number().finite().optional() }) }),
  z.looseObject({ ...promoCommon, kind: z.literal('bundle'), params: z.looseObject({ items: z.array(z.looseObject({ menu_codes: codes, qty: z.number().int().min(1) })).min(1), bundle_price: z.number().finite(), max_sets: z.number().int().optional() }) }),
])
const SaleSettings = z.looseObject({
  shopName: z.string(), defaultSize: SizeCode, defaultSweetness: SweetnessCode, defaultChannelCode: z.string(), defaultMilk: MilkCodeSchema,
  maxQtyPerLine: z.number().int().min(1), backdateDays: z.number().int(), recentOrdersCount: z.number().int(),
}).partial()
export const PosOrderCatalog = z.looseObject({
  settings: SaleSettings.nullable().optional(),
  variants: z.array(Variant), ingredients: z.record(z.string(), Ingredient), bases: z.record(z.string(), Base),
  milkOptions: z.array(MilkOption), gradeOptions: z.array(GradeOption), channels: z.array(Channel), paymentMethods: z.array(PaymentMethod), promotions: z.array(Promotion),
})
export type PosOrderCatalogParsed = z.infer<typeof PosOrderCatalog>

export const StaffEntry = z.looseObject({ id: Uuid, display_name: z.string().nullable(), role: z.string(), active: z.boolean() })
export type StaffEntry = z.infer<typeof StaffEntry>
export const PricingInfo = z.looseObject({ commit: z.string(), files_sha256: z.record(z.string(), z.string()) })
export const ClientInfo = z.looseObject({ name: z.string(), last_receipt_no: z.string().regex(RECEIPT_NO_RE).nullable() })
const e1Common = {
  catalog_version: z.number().int().min(1), server_time: IsoReceived, pricing: PricingInfo,
  supported_kinds: z.array(z.string()), supported_fields: z.record(z.string(), z.array(z.string())),
}
export const PosCatalogUnchanged = z.looseObject({ changed: z.literal(false), ...e1Common })
export const PosCatalogChanged = z.looseObject({ changed: z.literal(true), ...e1Common, client: ClientInfo, staff: z.array(StaffEntry), catalog: PosOrderCatalog })
export const PosCatalogData = z.discriminatedUnion('changed', [PosCatalogChanged, PosCatalogUnchanged])
export type PosCatalogData = z.infer<typeof PosCatalogData>
export const PosCatalogResponse = z.looseObject({ ok: z.literal(true), data: PosCatalogData })
/**
 * ruling R12: what the tablet parses FIRST — everything strict except `catalog`, which is checked on its own so a
 * catalog the pricing code cannot read never throws away staff (a removed employee must be locked out at once),
 * supported_*, pricing or server_time.
 */
export const PosCatalogLooseData = z.discriminatedUnion('changed', [
  z.looseObject({ changed: z.literal(true), ...e1Common, client: ClientInfo, staff: z.array(StaffEntry), catalog: z.unknown() }),
  PosCatalogUnchanged,
])
export type PosCatalogLooseData = z.infer<typeof PosCatalogLooseData>
export const PosCatalogLooseResponse = z.looseObject({ ok: z.literal(true), data: PosCatalogLooseData })

// ── E2 request: what the tablet SENDS is strict (spec §4.5) ────────────────────────────────────────────────────────
export const OrderLineData = z.strictObject({
  code: z.string().min(1).max(100), size: SizeCode, sweetness: SweetnessCode, milk: MilkCodeSchema, grade: z.string().min(1).max(50).nullable(),
  qty: z.number().int().min(1).max(999),
  free: z.boolean().optional(), discount_baht: Baht.nullable().optional(), discount_percent: z.number().min(0).max(100).nullable().optional(), discount_reason: Text200.nullable().optional(),
})
const BillDiscountData = z.strictObject({ baht: Baht.optional(), percent: z.number().min(0).max(100).optional(), reason: Text200.nullable().optional() })
  .refine((b) => (b.baht === undefined) !== (b.percent === undefined), 'exactly one of baht or percent')
export const OrderRowData = z.strictObject({
  pos_order_id: Uuid, receipt_no: z.string().regex(RECEIPT_NO_RE), queue_no: z.number().int().min(1).max(9999),
  sale_date: Ymd, sold_at: IsoSent, channel: z.string().min(1).max(100), payment: z.string().min(1).max(100),
  staff_id: Uuid, catalog_version: z.number().int().min(1), shift_id: Uuid.nullable(),
  lines: z.array(OrderLineData).min(1).max(50), bill_discount: BillDiscountData.nullable(),
  promo_code: z.string().min(1).max(100).nullable(), skip_promotion_ids: z.array(Uuid), no_promotions: z.boolean(),
  totals: z.strictObject({ items_subtotal: Baht, items_discount: Baht, bill_discount: Baht, total: Baht }),
  note: Text200.nullable(),
}).superRefine((d, ctx) => {
  if (bangkokDateOf(d.sold_at) !== d.sale_date) ctx.addIssue({ code: 'custom', path: ['sale_date'], message: 'sale_date must be the Thai date of sold_at' })
  if (d.lines.reduce((a, l) => a + l.qty, 0) > 500) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'more than 500 cups' })
})
export type OrderRowData = z.infer<typeof OrderRowData>
export const OrderVoidRowData = z.strictObject({ pos_order_id: Uuid, voided_at: IsoSent, staff_id: Uuid, approved_by: Uuid.nullable(), reason: Text200 })
export type OrderVoidRowData = z.infer<typeof OrderVoidRowData>
const rowKeyField = z.string().min(1).max(MAX_ROW_KEY_LENGTH)
export const PushRow = z.discriminatedUnion('kind', [
  z.strictObject({ key: rowKeyField, kind: z.literal('order'), data: OrderRowData }),
  z.strictObject({ key: rowKeyField, kind: z.literal('order_void'), data: OrderVoidRowData }),
]).refine((r) => r.key === rowKey(r.kind, r.data.pos_order_id), { message: 'key must be <kind>:<pos_order_id>', path: ['key'] })
export type PushRow = z.infer<typeof PushRow>
export const PushRequest = z.strictObject({ device_time: IsoSent, rows: z.array(PushRow).min(1).max(MAX_PUSH_ROWS) })
export type PushRequest = z.infer<typeof PushRequest>
/** Envelope only (spec §4.5: a bad row is that row's verdict, never a 422 of the whole request) — used by the mock. */
export const PushEnvelope = z.looseObject({ device_time: z.string(), rows: z.array(z.unknown()).min(1).max(MAX_PUSH_ROWS) })

// ── E2 response: what the tablet RECEIVES is tolerant (spec §4.1 · plan-5 ReceivedRowResult) ───────────────────────
export const ReceivedRowResult = z.looseObject({ key: z.string(), status: z.string(), reason: z.string().optional(), detail: z.string().optional(), data: z.unknown().optional() })
export type ReceivedRowResult = z.infer<typeof ReceivedRowResult>
export const OrderAcceptedData = z.looseObject({ order_no: z.string(), version: z.number().int(), computed_total: z.number().finite().nonnegative(), amount_mismatch: z.boolean(), duplicate_of: z.array(z.string()), warnings: z.array(z.string()) })
export const OrderVoidAcceptedData = z.looseObject({ order_no: z.string(), version: z.number().int() })
export const PushResponseData = z.looseObject({ server_time: IsoReceived, results: z.array(ReceivedRowResult) })
export type PushResponseData = z.infer<typeof PushResponseData>
export const PushResponse = z.looseObject({ ok: z.literal(true), data: PushResponseData })
export const ApiErrorBody = z.looseObject({ ok: z.literal(false), error: z.looseObject({ code: z.string(), message: z.string() }) })

// ── E3 (spec §4.6) ─────────────────────────────────────────────────────────────────────────────────────────────────
export const CentralOrder = z.looseObject({
  order_no: z.string(), sale_date: Ymd, status: z.string(), source: z.string(), external_ref: z.string().nullable(), version: z.number().int(),
  channel: z.string().nullable(), payment: z.string().nullable(),
  totals: z.looseObject({ items_subtotal: z.number(), items_discount: z.number(), bill_discount: z.number(), total: z.number(), fee: z.number().nullable().optional() }),
  amount_mismatch: z.boolean().nullable(), updated_at: IsoReceived.nullable(),
  sold_at: IsoReceived.nullable().optional(), created_by_name: z.string().nullable().optional(), pos_receipt_no: z.string().nullable().optional(),
  pos_queue_no: z.number().int().nullable().optional(), catalog_version: z.number().int().nullable().optional(), duplicate_suspect: z.boolean().optional(),
})
export type CentralOrder = z.infer<typeof CentralOrder>
export const OrdersListResponse = z.looseObject({ ok: z.literal(true), data: z.array(CentralOrder) })

// ── supported kinds/fields (spec §4.4 rule 10) ─────────────────────────────────────────────────────────────────────
/** Every key present in `data` (value irrelevant); keys inside an ARRAY of objects are named `array.key` (lines.milk). */
export function fieldsUsed(data: Record<string, unknown>): string[] {
  const out = new Set<string>()
  for (const [k, v] of Object.entries(data)) {
    out.add(k)
    if (Array.isArray(v)) for (const item of v) if (item !== null && typeof item === 'object' && !Array.isArray(item)) for (const sub of Object.keys(item)) out.add(`${k}.${sub}`)
  }
  return [...out].sort()
}
export type Supported = { kinds: readonly string[]; fields: Readonly<Record<string, readonly string[]>> }
export function isRowSupported(kind: string, data: Record<string, unknown>, s: Supported): boolean {
  if (!s.kinds.includes(kind)) return false
  const allowed = new Set(s.fields[kind] ?? [])
  return fieldsUsed(data).every((f) => allowed.has(f))
}

// ── parity file = pos-parity.json of dayo scripts/export-pos-parity.ts (block-1 plan Task 13 · spec §5.2 layer B → C) ──
// draft = dayo's own OrderDraft (camelCase); expected = ParityMoney in baht (moneyFromSql of quote_order).
const DraftLine = z.looseObject({
  code: z.string(), size: SizeCode.nullable().optional(), sweetness: SweetnessCode.nullable().optional(), milk: MilkCodeSchema.nullable().optional(),
  grade: z.string().nullable().optional(), qty: z.number(), free: z.boolean().optional(),
  discountBaht: z.number().nullable().optional(), discountPercent: z.number().nullable().optional(), discountReason: z.string().nullable().optional(),
})
export const ParityDraft = z.looseObject({
  saleDate: Ymd, saleTime: HHMM.optional(), channelCode: z.string(), paymentCode: z.string().nullable().optional(), lines: z.array(DraftLine).min(1),
  billDiscountBaht: z.number().nullable().optional(), billDiscountPercent: z.number().nullable().optional(), billDiscountReason: z.string().nullable().optional(),
  promoCode: z.string().nullable().optional(), skipPromotionIds: z.array(z.string()).optional(),
})
export type ParityDraft = z.infer<typeof ParityDraft>
export const ParityMoney = z.looseObject({
  ok: z.boolean(), itemsSubtotal: z.number(), itemsDiscount: z.number(), billDiscountAmount: z.number(), totalAmount: z.number(), channelFeeAmount: z.number(),
  lines: z.array(z.looseObject({ lineNo: z.number().int(), unitPrice: z.number(), discountPerCup: z.number(), lineTotal: z.number() })),
  promotionsApplied: z.array(z.looseObject({ promotionId: z.string(), discountAmount: z.number() })),
})
export type ParityMoney = z.infer<typeof ParityMoney>
export const ParityFile = z.looseObject({
  dayo_commit: z.string(), pricing_files_sha256: z.record(z.string(), z.string()), generated_at: z.string(), catalog_version: z.number().int(),
  catalog: PosOrderCatalog,
  cases: z.array(z.looseObject({ id: z.string().min(1), spec: z.string(), draft: ParityDraft, expected: ParityMoney })).min(1),
})
```

- [ ] **Step 5: รันให้ผ่าน** — `pnpm --filter @dayo/contracts test` → PASS · `pnpm turbo run typecheck` → ผ่าน (ถ้า `db-schema`/`pos` ฟ้องเพราะ `UserRole`/`OutboxStatus` เพิ่มค่า: ไม่ควรมี เพราะ `textEnum` ไม่สร้าง SQL — ถ้ามีให้แก้จุดนั้นให้รับค่าใหม่ ไม่ลบค่า)

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/dayo-api.ts packages/contracts/src/enums.ts packages/contracts/src/index.ts packages/contracts/test/dayo-api.test.ts
git commit -m "feat(contracts): add the zod contract of the dayo pos api"
```

---

### Task 6: fixture สัญญาชุดกลาง `packages/contracts/fixtures/dayo-api/` + แคตตาล็อกทดสอบของ POS

ผู้ทำ: domain-engineer (opus) · สเปก §4.11 ข้อ 2 · แผนก้อน 1 Task 6 · ruling R1 · รอ Task 5

**ต้นฉบับอยู่ที่ dayo — repo dayo เป็นเจ้าของ (D82)** (`apps/web/test/fixtures/pos-contract/*.json` + `.gitattributes` — แผนก้อน 1 Task 6 พิมพ์เนื้อหาเต็มทุกไฟล์) · POS เก็บ **สำเนาชื่อไฟล์เดียวกัน เนื้อหาเท่ากัน** ที่ `packages/contracts/fixtures/dayo-api/` · "เท่ากัน" = sha256 **หลังแปลง CRLF → LF** (D82 — เช็กเอาต์บน Windows ที่ `core.autocrlf=true` ไม่ทำให้ไม่ตรง) และทั้งสองฝั่งมี `.gitattributes` `*.json text eol=lf` ในโฟลเดอร์ fixture · ⛔ เมื่อ dayo merge Task 6 แล้ว **เจ้าของ** คัดลอกโฟลเดอร์นั้นมาทับ แล้วรัน `fixtures:hashes` สองฝั่งเทียบกัน (ทำซ้ำใน Task 23) · **รายชื่อไฟล์** = `CONTRACT_FIXTURE_NAMES` ถอดจากรายการไฟล์ของแผนก้อน 1 Task 6 (เรียงตามตัวอักษร · วันนี้ 22 ชื่อ รวม `err-404-unknown-path`) — ถ้าแผนก้อน 1 เพิ่ม/ลบไฟล์ แก้ที่รายชื่อนี้ที่เดียว เทสต์และขั้นตรวจทุกจุดอ่านจากรายชื่อ ไม่มีจุดใดเขียนจำนวนตายตัว · ระหว่างรอ ให้คัดลอกเนื้อหา JSON **ตรงตัวอักษร** จากบล็อก ```json ในแผนก้อน 1 Task 6 Step 1 (`docs/superpowers/plans/2026-09-25-06-block1-dayo-api.md`) — **ห้ามแก้เนื้อหาเพื่อให้เทสต์ POS ผ่าน**: ถ้าไม่ผ่านแปลว่า schema ของ POS หรือสเปกผิด → หยุดแจ้งหัวหน้า

**Files:**
- Create: `packages/contracts/fixtures/dayo-api/*.json` (ตาม `CONTRACT_FIXTURE_NAMES` ข้างล่าง) · `packages/contracts/fixtures/dayo-api/.gitattributes` (ไฟล์เดียวกับของ dayo: `*.json text eol=lf` — N6)
- Create: `packages/contracts/scripts/fixture-hashes.ts` (พิมพ์ `<sha256 หลัง CRLF→LF>  <name>.json` ตามรายชื่อ — ใช้เทียบกับโฟลเดอร์ของ dayo)
- Create: `packages/contracts/fixtures/pos-test/e1-catalog-rich.json` (แคตตาล็อกทดสอบของ POS — ข้างล่าง)
- Create: `packages/contracts/src/dayo-fixture.ts` (schema + ค่าคงที่ ไม่มี `node:*` — export จาก `index.ts`) · `packages/contracts/src/dayo-fixture-files.ts` (อ่านไฟล์ด้วย `node:fs` — export ผ่าน subpath `./fixture-files` เท่านั้น)
- Modify: `packages/contracts/package.json` (`exports` เพิ่ม `"./fixture-files": "./src/dayo-fixture-files.ts"`, `"./fixtures/*": "./fixtures/*"` · script `"fixtures:hashes": "tsx scripts/fixture-hashes.ts"` · devDependency `"tsx": "4.23.13"` · `tsconfig.json` `include` เพิ่ม `"scripts"`) · `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/dayo-fixtures.test.ts`, `packages/contracts/test/rich-catalog.test.ts`

**Interfaces:**
- Consumes: schema ทั้งหมดของ Task 5
- Produces:
  - จาก `@dayo/contracts`: `PosContractFixture` (zod ตามรูปของแผนก้อน 1: `{ name, spec, env, rpc?, request: { method, path, headers?, body? }, response: { status, headers?, headers_absent?, body? } }`) · `CONTRACT_FIXTURE_NAMES` (ถอดจากแผนก้อน 1 — 22 ชื่อ) · `header(h, name)` (หาหัวแบบไม่สนตัวพิมพ์)
  - จาก `@dayo/contracts/fixture-files` (Node เท่านั้น): `listContractFixtures(): string[]` · `fixtureSha256(bytes): string` (sha256 หลัง CRLF → LF — กติกา D82 เดียวกับ `fileSha256` ของ Task 2) · `contractFixtureHashes(dir?): { name: string; sha256: string | null }[]` (ตามรายชื่อ · `null` = ไม่มีไฟล์) · `loadContractFixture(name): PosContractFixture` · `loadRichCatalog(): PosCatalogChangedData`
  - JSON ดิบผ่าน `@dayo/contracts/fixtures/pos-test/e1-catalog-rich.json` และ `@dayo/contracts/fixtures/dayo-api/<name>.json` (import JSON — ใช้ได้ทั้ง Node และ jsdom)
  - **แคตตาล็อกทดสอบเดียวของฝั่ง POS** = `e1-catalog-rich.json` (Task 3, 4, 7, 10+ ใช้) · UUID พนักงาน: TungAo `7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f` (owner) · DCm `0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d` (owner ในแคตตาล็อกนี้ — ต่างจาก fixture สัญญาที่ DCm เป็น staff; ไม่เกี่ยวกัน) · Beam `2c3d4e5f-6071-4283-94a5-b6c7d8e9f0a1` (manager) · Mint `1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0` (staff) · ไม่มีชื่อ `4e5f6071-8293-44a5-b6c7-d8e9f0a1b2c3` (staff) · Old `3d4e5f60-7182-4394-a5b6-c7d8e9f0a1b2` (removed)

```ts
// packages/contracts/src/dayo-fixture.ts — no node:* imports (the tablet's jsdom tests load it through @dayo/dayo-mock)
import { z } from 'zod'

/** The contract fixture format of block-1 plan Task 6 (PosContractFixture). `env`/`rpc` drive dayo's harness; POS reads them to set up its mock. */
export const PosContractFixture = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]+$/),
  spec: z.string(),
  env: z.record(z.string(), z.union([z.string(), z.record(z.string(), z.unknown())])),
  rpc: z.record(z.string(), z.unknown()).optional(),
  request: z.strictObject({ method: z.enum(['GET', 'POST', 'OPTIONS']), path: z.string().regex(/^\/api\/v1\//), headers: z.record(z.string(), z.string()).optional(), body: z.unknown().optional() }),
  response: z.strictObject({ status: z.number().int().min(100).max(599), headers: z.record(z.string(), z.string()).optional(), headers_absent: z.array(z.string()).optional(), body: z.unknown().optional() }),
})
export type PosContractFixture = z.infer<typeof PosContractFixture>

/**
 * The file list of block-1 plan Task 6 (docs/superpowers/plans/2026-09-25-06-block1-dayo-api.md), sorted — the ONE place
 * that names the contract fixtures (N1). Tests and the Task 23 hash check read this list; nothing counts files on its own.
 * dayo owns the fixtures (D82): when block 1 adds or drops one, change this list and copy the folder again.
 */
export const CONTRACT_FIXTURE_NAMES = [
  'e1-catalog-changed', 'e1-catalog-unchanged', 'e1-missing-staff-scope', 'e2-envelope-invalid', 'e2-key-reused-different-content', 'e2-order-accepted',
  'e2-order-and-void-same-batch', 'e2-order-duplicate', 'e2-receipt-conflict', 'e2-row-server-error', 'e2-unknown-code-other-row-ok',
  'e2-unsupported-kind-and-field', 'e2-void-clock-ahead', 'e2-void-cross-day', 'e3-orders-today', 'err-401-invalid-key', 'err-404-api-disabled',
  'err-404-unknown-path', 'err-429-rate-limited', 'err-500-rpc-unreachable', 'preflight-allowed-api-off', 'preflight-disallowed-origin',
] as const

/** Header lookup ignoring case — the fixtures write `Access-Control-Allow-Origin`, fetch lower-cases. */
export function header(h: Record<string, string> | undefined, name: string): string | undefined {
  const k = Object.keys(h ?? {}).find((x) => x.toLowerCase() === name.toLowerCase())
  return k === undefined ? undefined : h![k]
}
```

```ts
// packages/contracts/src/dayo-fixture-files.ts — Node only
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PosCatalogResponse, type PosCatalogData } from './dayo-api.js'
import { CONTRACT_FIXTURE_NAMES, PosContractFixture } from './dayo-fixture.js'

const DIR = fileURLToPath(new URL('../fixtures/dayo-api/', import.meta.url))
/** D82: sha256 of the UTF-8 text after CRLF → LF (the same rule as fileSha256 of Task 2), so a Windows checkout still matches. */
export const fixtureSha256 = (bytes: Uint8Array): string => createHash('sha256').update(Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n')).digest('hex')
/** One entry per CONTRACT_FIXTURE_NAMES name, in list order; sha256 null = the file is missing in `dir`. */
export function contractFixtureHashes(dir: string = DIR): { name: string; sha256: string | null }[] {
  return CONTRACT_FIXTURE_NAMES.map((name) => {
    const p = join(dir, `${name}.json`)
    return { name, sha256: existsSync(p) ? fixtureSha256(readFileSync(p)) : null }
  })
}
const RICH = fileURLToPath(new URL('../fixtures/pos-test/e1-catalog-rich.json', import.meta.url))
export const listContractFixtures = (): string[] => readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().map((f) => join(DIR, f))
export const loadContractFixture = (name: string): PosContractFixture => PosContractFixture.parse(JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')))
export function loadRichCatalog(): Extract<PosCatalogData, { changed: true }> {
  const d = PosCatalogResponse.parse(JSON.parse(readFileSync(RICH, 'utf8'))).data
  if (!d.changed) throw new Error('e1-catalog-rich.json must be changed:true')
  return d
}
```

**`packages/contracts/fixtures/pos-test/e1-catalog-rich.json`** — แคตตาล็อกทดสอบของทีม POS (ไม่ใช่ fixture สัญญา · ไม่ mirror ไป dayo) เพราะแคตตาล็อกใน `e1-catalog-changed.json` ของสัญญามีแค่ 2 ตัวแปร 1 ช่องทาง ไม่พอครอบเคส §5.3 และหน้าขาย · รูปไฟล์ = body ของ E1 ตรงตัว `{ "ok": true, "data": … }` · `data` ดังนี้ (id ทุกตัวเป็น UUID เต็ม · ห้ามย่อ):

```json
{
  "changed": true, "catalog_version": 42, "server_time": "2026-09-25T02:00:00.120+00:00",
  "client": { "name": "แท็บเล็ตขาย 1", "last_receipt_no": null },
  "pricing": { "commit": "65d3af2ba9fce1f6c3aa591379890a8d61fe9755", "files_sha256": {
      "packages/shared/src/cost.ts": "83df8f024306ad4e4575d84e3b2b32b0ff1579d765138d76c4eacfb7160202a8",
      "packages/shared/src/fmt.ts": "df31505296c9c99d2e1cc984d02a7fc86706b7ce668b7680554008fbc74334ac",
      "packages/shared/src/money.ts": "96abf33a850979298e3d3f3996acc03cdbbd6a17b33630b22a3cfcdb1407699e",
      "packages/shared/src/promotions.ts": "4850b98d5084e703bb1deb84ea4629253f510f37d6e0ab80161e2e5dab15ea11",
      "packages/shared/src/shopSettings.ts": "6ae3480f4c980a5cfbd8aadad99eafa2170b8b74e92c7f39a90c4c4392d88b3c",
      "packages/shared/src/time.ts": "c634692b8b9c5dd30876cca15e94b3b642da7c685966db5017a34682c3cc1de1",
      "packages/shared/src/types.ts": "de361ebdd0c7d08d556d347867d9068511039dcc2af29c7684468296e86d9bda" }  },
  "supported_kinds": ["order", "order_void"],
  "supported_fields": {
    "order": ["pos_order_id", "receipt_no", "queue_no", "sale_date", "sold_at", "channel", "payment", "staff_id", "catalog_version", "shift_id", "lines", "lines.code", "lines.size", "lines.sweetness", "lines.milk", "lines.grade", "lines.qty", "lines.free", "lines.discount_baht", "lines.discount_percent", "lines.discount_reason", "bill_discount", "promo_code", "skip_promotion_ids", "no_promotions", "totals", "note"],
    "order_void": ["pos_order_id", "voided_at", "staff_id", "approved_by", "reason"]
  },
  "staff": [
    { "id": "7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f", "display_name": "TungAo", "role": "owner", "active": true },
    { "id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "display_name": "DCm", "role": "owner", "active": true },
    { "id": "2c3d4e5f-6071-4283-94a5-b6c7d8e9f0a1", "display_name": "Beam", "role": "manager", "active": true },
    { "id": "1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0", "display_name": "Mint", "role": "staff", "active": true },
    { "id": "4e5f6071-8293-44a5-b6c7-d8e9f0a1b2c3", "display_name": "", "role": "staff", "active": true },
    { "id": "3d4e5f60-7182-4394-a5b6-c7d8e9f0a1b2", "display_name": "Old", "role": "staff", "active": false }
  ],
  "catalog": {
    "settings": { "shopName": "DA-YO", "defaultSize": "16 oz", "defaultSweetness": "100%", "defaultChannelCode": "store", "defaultMilk": "fresh", "maxQtyPerLine": 99, "backdateDays": 7, "recentOrdersCount": 5 },
    "variants": [ "<22 แถว ตามตาราง variant ข้างล่าง>" ],
    "ingredients": {
      "c3d4e5f6-0000-4000-8000-000000000001": { "id": "c3d4e5f6-0000-4000-8000-000000000001", "code": "RM-012", "name": "นมสด", "useUnit": "ml" },
      "c3d4e5f6-0000-4000-8000-000000000002": { "id": "c3d4e5f6-0000-4000-8000-000000000002", "code": "RM-013", "name": "นมโอ๊ต", "useUnit": "ml" },
      "c3d4e5f6-0000-4000-8000-000000000003": { "id": "c3d4e5f6-0000-4000-8000-000000000003", "code": "RM-020", "name": "ผงมัตฉะ Excellent", "useUnit": "g" },
      "c3d4e5f6-0000-4000-8000-000000000004": { "id": "c3d4e5f6-0000-4000-8000-000000000004", "code": "RM-021", "name": "ผงมัตฉะ Premium", "useUnit": "g" },
      "c3d4e5f6-0000-4000-8000-000000000005": { "id": "c3d4e5f6-0000-4000-8000-000000000005", "code": "RM-001", "name": "ใบชาไทย", "useUnit": "g" },
      "c3d4e5f6-0000-4000-8000-000000000006": { "id": "c3d4e5f6-0000-4000-8000-000000000006", "code": "RM-030", "name": "ผงโกโก้", "useUnit": "g" },
      "c3d4e5f6-0000-4000-8000-000000000007": { "id": "c3d4e5f6-0000-4000-8000-000000000007", "code": "RM-099", "name": "น้ำ", "useUnit": "ml" }
    },
    "bases": {
      "5e1f0000-0000-4000-8000-000000000001": { "id": "5e1f0000-0000-4000-8000-000000000001", "code": "BASE-THAI", "name": "ชาไทยเบส", "yieldQty": 1000, "yieldUnit": "ml",
        "lines": [ { "ingredientId": "c3d4e5f6-0000-4000-8000-000000000005", "qty": 40 }, { "ingredientId": "c3d4e5f6-0000-4000-8000-000000000007", "qty": 1000 } ] }
    },
    "milkOptions": [
      { "code": "fresh", "ingredientId": "c3d4e5f6-0000-4000-8000-000000000001", "priceAdd": 0, "aliases": ["นมสด"] },
      { "code": "oat", "ingredientId": "c3d4e5f6-0000-4000-8000-000000000002", "priceAdd": 15, "aliases": ["โอ๊ต"] }
    ],
    "gradeOptions": [
      { "code": "Excellent", "ingredientId": "c3d4e5f6-0000-4000-8000-000000000003", "multiplier": 1, "priceAdd": 0, "isDefault": true, "aliases": [] },
      { "code": "Premium", "ingredientId": "c3d4e5f6-0000-4000-8000-000000000004", "multiplier": 1, "priceAdd": 20, "isDefault": false, "aliases": ["พรีเมียม"] }
    ],
    "channels": [
      { "code": "store", "name": "หน้าร้าน", "aliases": [], "priceMarkupPct": 0, "priceAddBaht": 0, "rounding": "none", "feePct": 0, "defaultPaymentMethodCode": "cash" },
      { "code": "grab", "name": "Grab", "aliases": ["แกร็บ"], "priceMarkupPct": 0.30, "priceAddBaht": 0, "rounding": "ceil_baht", "feePct": 0.30, "defaultPaymentMethodCode": "qr" },
      { "code": "lineman", "name": "LINE MAN", "aliases": ["ไลน์แมน"], "priceMarkupPct": 0.07, "priceAddBaht": 5, "rounding": "ceil_baht", "feePct": 0.25, "defaultPaymentMethodCode": "qr" }
    ],
    "paymentMethods": [ { "code": "cash", "name": "เงินสด", "aliases": ["เงินสด", "สด"] }, { "code": "qr", "name": "QR", "aliases": ["qr"] } ],
    "promotions": [
      { "id": "9f8e0000-0000-4000-8000-000000000001", "code": null, "name": "ชาไทย ซื้อ 2 แถม 1", "kind": "buy_n_get_m", "startsOn": null, "endsOn": null, "daysOfWeek": null, "timeFrom": null, "timeTo": null, "channelCodes": [], "requiresCode": false, "autoApply": true, "priority": 10, "stackable": false, "isActive": true, "params": { "buy_qty": 2, "get_qty": 1, "menu_codes": ["Thai Tea"] } },
      { "id": "9f8e0000-0000-4000-8000-000000000002", "code": null, "name": "มัตฉะบ่าย ลด 15%", "kind": "item_discount", "startsOn": null, "endsOn": null, "daysOfWeek": [1, 2, 3, 4, 5], "timeFrom": "14:00", "timeTo": "16:00", "channelCodes": [], "requiresCode": false, "autoApply": true, "priority": 20, "stackable": true, "isActive": true, "params": { "menu_codes": ["Matcha Latte"], "percent": 15 } },
      { "id": "9f8e0000-0000-4000-8000-000000000003", "code": "DAYO10", "name": "DAYO10 ลด 10% ทั้งบิล", "kind": "bill_discount", "startsOn": null, "endsOn": null, "daysOfWeek": null, "timeFrom": null, "timeTo": null, "channelCodes": [], "requiresCode": true, "autoApply": false, "priority": 30, "stackable": true, "isActive": true, "params": { "min_subtotal": 200, "percent": 10, "max_amount": 30 } },
      { "id": "9f8e0000-0000-4000-8000-000000000004", "code": null, "name": "โกโก้ + ชาไทย ฿70", "kind": "bundle", "startsOn": null, "endsOn": null, "daysOfWeek": null, "timeFrom": null, "timeTo": null, "channelCodes": [], "requiresCode": false, "autoApply": true, "priority": 5, "stackable": false, "isActive": true, "params": { "items": [ { "menu_codes": ["Cocoa"], "qty": 1 }, { "menu_codes": ["Thai Tea"], "qty": 1 } ], "bundle_price": 70 } },
      { "id": "9f8e0000-0000-4000-8000-000000000005", "code": null, "name": "Grab โกโก้ลด 5 บาท", "kind": "item_discount", "startsOn": null, "endsOn": null, "daysOfWeek": null, "timeFrom": null, "timeTo": null, "channelCodes": ["grab"], "requiresCode": false, "autoApply": true, "priority": 15, "stackable": true, "isActive": true, "params": { "menu_codes": ["Cocoa"], "amount_baht": 5 } }
    ]
  }
}
```

ตาราง variant (22 แถว · เรียง `menuSortOrder`, `menuCode`, ขนาด, ความหวานตามค่าตัวเลข · ทุกแถวมี `menuCode, menuNameTh, family, categoryLabel, menuSortOrder, size, sweetness, price, allowOatMilk, isMatcha, recipeLines`):

| menuCode | menuNameTh / family / categoryLabel / sort | allowOat / isMatcha | ขนาด → ราคา → recipeLines | ความหวาน |
|---|---|---|---|---|
| `Thai Tea` | ชาไทย / ชาไทย / ชา / 1 | true / false | 16 oz → 35 → `[{baseId: BASE-THAI, ingredientId: null, qty: 120, unit: ml}, {ingredientId: นมสด, baseId: null, qty: 60, unit: ml}]` · 20 oz → 45 → base 150 + นมสด 80 | 0% 25% 50% 75% 100% |
| `Matcha Latte` | มัตฉะลาเต้ / มัตฉะ / มัตฉะ / 2 | true / true | 16 oz → 85 → `[{ingredientId: ผง Excellent, qty: 4, unit: g}, {ingredientId: นมสด, qty: 150, unit: ml}]` · 20 oz → 95 → ผง 5 g + นมสด 190 ml | 25% 50% 100% |
| `Cocoa` | โกโก้ / โกโก้ / โกโก้ / 3 | true / false | 16 oz → 45 → ผงโกโก้ 20 g + น้ำ 150 ml · 20 oz → 55 → ผงโกโก้ 25 g + น้ำ 190 ml (ไม่มีนมสด → นมโอ๊ตใช้ไม่ได้) | 50% 100% |
| `Pink Milk` | นมชมพู / นม / นม / 4 | false / false | 16 oz → 65 → นมสด 200 ml · 20 oz → 75 → นมสด 250 ml | 100% |


ไฟล์จริงเขียนเป็น `{ "ok": true, "data": { … } }` โดย `variants` เป็นวัตถุเต็ม 22 ตัวตามตาราง (ห้ามมีข้อความในวงเล็บมุม — grep `"<` ต้องไม่เจอ)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `packages/contracts/test/dayo-fixtures.test.ts`

```ts
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ApiErrorBody, OrdersListResponse, PosCatalogResponse, PushEnvelope, PushResponse } from '../src/dayo-api.js'
import { CONTRACT_FIXTURE_NAMES, header, PosContractFixture } from '../src/dayo-fixture.js'
import { contractFixtureHashes, fixtureSha256, listContractFixtures, loadContractFixture } from '../src/dayo-fixture-files.js'

it('holds exactly the contract fixtures CONTRACT_FIXTURE_NAMES lists (block-1 plan Task 6 — no count written here, N1)', () => {
  expect(listContractFixtures().map((f) => basename(f, '.json'))).toEqual([...CONTRACT_FIXTURE_NAMES])
  expect(new Set(CONTRACT_FIXTURE_NAMES).size).toBe(CONTRACT_FIXTURE_NAMES.length)
  expect([...CONTRACT_FIXTURE_NAMES]).toEqual([...CONTRACT_FIXTURE_NAMES].sort())
})

it('the fixture folder pins LF line ends like dayo (N6)', () => {
  expect(readFileSync(fileURLToPath(new URL('../fixtures/dayo-api/.gitattributes', import.meta.url)), 'utf8').trim()).toBe('*.json text eol=lf')
})

it('fixture hashes ignore CRLF vs LF (D82) and report a missing file', () => {
  expect(fixtureSha256(Buffer.from('{\r\n"a":1\r\n}\r\n'))).toBe(fixtureSha256(Buffer.from('{\n"a":1\n}\n')))
  const all = contractFixtureHashes()
  expect(all.map((h) => h.name)).toEqual([...CONTRACT_FIXTURE_NAMES])
  expect(all.every((h) => h.sha256 !== null && /^[0-9a-f]{64}$/.test(h.sha256))).toBe(true)
  expect(contractFixtureHashes(tmpdir()).every((h) => h.sha256 === null)).toBe(true)
})

it('an unknown path under /api/v1 is a 404 that still carries CORS (err-404-unknown-path, spec §4.1)', () => {
  const fx = loadContractFixture('err-404-unknown-path')
  expect(fx.response.status).toBe(404)
  expect(ApiErrorBody.parse(fx.response.body).error.message).toBe('not_found')
})

for (const file of listContractFixtures()) {
  describe(basename(file), () => {
    const fx = PosContractFixture.parse(JSON.parse(readFileSync(file, 'utf8')))
    const origins = String(fx.env['POS_ORIGINS'] ?? '').split(',')
    const origin = header(fx.request.headers, 'Origin')
    const allowed = origin !== undefined && origins.includes(origin)
    it('file name = fixture name', () => { expect(`${fx.name}.json`).toBe(basename(file)) })
    it('CORS on every answer from an allowed origin, errors included; none for other origins (spec §4.1)', () => {
      expect(header(fx.response.headers, 'Vary')).toBe('Origin')
      if (allowed) {
        expect(header(fx.response.headers, 'Access-Control-Allow-Origin')).toBe(origin)
        expect(header(fx.response.headers, 'Access-Control-Expose-Headers')).toBe('Retry-After')
      } else {
        expect(fx.response.headers_absent).toContain('Access-Control-Allow-Origin')
      }
    })
    it('the body follows the POS contract for its path and status', () => {
      const { request: rq, response: rs } = fx
      if (rq.method === 'OPTIONS') { expect(rs.status).toBe(204); expect(rs.body).toBeUndefined(); return }
      if (rs.status !== 200) {
        ApiErrorBody.parse(rs.body)
        if (rs.status === 429) expect(Number(header(rs.headers, 'Retry-After'))).toBeGreaterThan(0)
        return
      }
      if (rq.path.startsWith('/api/v1/pos/catalog')) PosCatalogResponse.parse(rs.body)
      else if (rq.path.startsWith('/api/v1/orders')) OrdersListResponse.parse(rs.body)
      else {
        const got = PushResponse.parse(rs.body)
        const sent = PushEnvelope.parse(rq.body)
        expect(got.data.results.map((r) => r.key)).toEqual(sent.rows.map((r) => (r as { key: string }).key)) // same order, same count (spec §4.5)
      }
    })
  })
}
```

`packages/contracts/test/rich-catalog.test.ts`:

```ts
import { expect, it } from 'vitest'
import { loadRichCatalog } from '../src/dayo-fixture-files.js'

it('the POS test catalog parses and covers what block-2 tests need', () => {
  const c = loadRichCatalog()
  expect(c.catalog.variants).toHaveLength(22)
  expect(c.catalog.channels.map((x) => x.code)).toEqual(['store', 'grab', 'lineman'])
  expect(c.catalog.promotions.map((p) => p.kind).sort()).toEqual(['bill_discount', 'bundle', 'buy_n_get_m', 'item_discount', 'item_discount'])
  expect(c.staff).toHaveLength(6)
  expect(JSON.stringify(c)).not.toContain('costPerUseUnit') // spec §4.4 rule 1
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/contracts test -- dayo-fixtures rich-catalog` · คาดว่า FAIL: `ENOENT … fixtures/dayo-api`

- [ ] **Step 3: สร้างไฟล์** — `dayo-fixture.ts`, `dayo-fixture-files.ts` ตามข้างบน · fixture ทุกชื่อใน `CONTRACT_FIXTURE_NAMES` คัดลอกตรงตัวจากแผนก้อน 1 (รวม `err-404-unknown-path.json`) + `.gitattributes` ของโฟลเดอร์ · `e1-catalog-rich.json` ตามตาราง · `scripts/fixture-hashes.ts`:

```ts
// packages/contracts/scripts/fixture-hashes.ts — `pnpm --filter @dayo/contracts fixtures:hashes [dir]` (dir default = the POS copy)
import { contractFixtureHashes } from '../src/dayo-fixture-files.js'

const rows = contractFixtureHashes(process.argv[2])
for (const r of rows) console.log(`${r.sha256 ?? 'MISSING'.padEnd(64)}  ${r.name}.json`)
if (rows.some((r) => r.sha256 === null)) process.exitCode = 1
```

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/contracts test` → PASS · `grep -rn '"<' packages/contracts/fixtures` → ไม่มีผล · `pnpm --filter @dayo/contracts fixtures:hashes` → หนึ่งบรรทัดต่อชื่อในรายชื่อ ไม่มี `MISSING` · เก็บผลไว้ในรายงาน task (หัวหน้าเทียบกับของ dayo เมื่อ dayo Task 6 merge)

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/dayo-fixture.ts packages/contracts/src/dayo-fixture-files.ts packages/contracts/src/index.ts packages/contracts/package.json packages/contracts/tsconfig.json packages/contracts/scripts/fixture-hashes.ts packages/contracts/test/dayo-fixtures.test.ts packages/contracts/test/rich-catalog.test.ts packages/contracts/fixtures/dayo-api/ packages/contracts/fixtures/pos-test/e1-catalog-rich.json pnpm-lock.yaml
git commit -m "test(contracts): mirror the dayo pos contract fixtures and add the pos test catalog"
```

(ตรวจ `git status` ก่อนว่าในสองโฟลเดอร์มีแค่ไฟล์ของงานนี้)

---

### Task 7: `@dayo/dayo-mock` — mock server ตามสัญญา

ผู้ทำ: sync-engineer (opus) · สเปก §4.1, §4.4–4.6, §4.11 ข้อ 3 · แผนก้อน 1 Task 3 Step 4 (ลำดับตรวจ) + "จุดตีความจากสเปก" · ruling R9 · รอ Task 5, 6

**Files:**
- Create: `packages/dayo-mock/package.json`, `tsconfig.json` (`"resolveJsonModule": true`), `vitest.config.ts`
- Create: `packages/dayo-mock/src/{state,judge,handler,server,index}.ts`
- Test: `packages/dayo-mock/test/{replay,judge,handler}.test.ts`

**Interfaces:**
- Consumes: Task 5 schemas + `fieldsUsed`, `bangkokDateOf`, `clipCodePoints`, `rowKey`, `MAX_PUSH_BODY_BYTES`, `API_KEY_RE` · Task 6 `header`, `PosContractFixture`, JSON `@dayo/contracts/fixtures/pos-test/e1-catalog-rich.json` · เทสต์ใช้ `listContractFixtures`/`loadContractFixture` จาก `@dayo/contracts/fixture-files` · **ห้ามใช้ `node:*` ใน `src/` ยกเว้น `server.ts`** (เทสต์ jsdom ของ `apps/pos` import mock นี้)
- Produces (Task 9–15, 21 ใช้):

```ts
export type MockMode = 'normal' | 'api_disabled' | 'rate_limited' | 'force_row_error' | 'server_down' | 'unauthorized' | 'forbidden' | 'hang'
export type MockOverride = { match: { receiptNo?: string; key?: string }; verdict: { status: string; reason?: string; detail?: string; data?: unknown }; times: number }
export type MockOptions = {
  apiKey?: string                 // default MOCK_API_KEY (dayo_ + 64 hex)
  origins?: string[]              // default ['http://localhost:4173'] (vite preview of the e2e run)
  now?: string | null             // fixed server clock; null = real clock
  mode?: MockMode; retryAfterSec?: number; forbiddenMessage?: string
  catalog?: PosCatalogChangedData // default = e1-catalog-rich.json
  pricing?: { commit: string; files_sha256: Record<string, string> } // overrides catalog.pricing
  seedOrders?: CentralOrder[]     // bot/web bills E3 returns and duplicate_of compares with
}
export type MockDayo = {
  handle(req: Request): Promise<Response>
  fetch: typeof fetch            // in-process: tests pass it as ApiDeps.fetch
  setMode(mode: MockMode): void
  setNow(iso: string | null): void
  override(o: MockOverride): void
  bumpCatalog(mutate?: (c: PosCatalogChangedData) => void): number
  seedCentralOrders(orders: CentralOrder[]): void
  preloadAccepted(row: { key: string; kind: 'order'; data: OrderRowData }, result: Record<string, unknown>): void  // as if pushed earlier
  preloadOrder(o: { posOrderId: string; receiptNo: string; saleDate: string; soldAt: string; orderNo: string; total: number }): void
  setNextOrderNo(saleDate: string, n: number): void
  orders(): { posOrderId: string; orderNo: string; receiptNo: string; status: 'ok' | 'cancelled'; total: number }[]
  requests(): { method: string; path: string; rows: number; status: number }[]   // every /api/v1 call, refused ones included
  reset(): void
}
export function createMockDayo(opts?: MockOptions): MockDayo
export const MOCK_API_KEY = `dayo_${'0123456789abcdef'.repeat(4)}`
// server.ts CLI: tsx src/server.ts --port 8787 --origin http://localhost:4173
// HTTP control (no auth, mock only): POST /__mock/reset · /__mock/mode {mode} · /__mock/now {iso|null} · /__mock/override {MockOverride} · /__mock/bump-catalog {} · /__mock/seed-orders [..] · GET /__mock/state → { orders, requests }
```

ข้อความ `detail`/`message` ของ mock **ตรงตัวอักษรกับ fixture สัญญา** (ทั้งแท็บเล็ตและ mock อ่านจากที่เดียวกัน):

| กรณี | ข้อความ |
|---|---|
| 401 | `invalid_key: API key ไม่ถูกต้องหรือถูกปิดใช้งาน` |
| 403 | `forbiddenMessage` (ค่าเริ่มต้น `forbidden: API key ไม่มีสิทธิ์ staff:read`) |
| 404 | `not_found` |
| 422 ซองผิด | `invalid: rows ต้องเป็นรายการ 1–20 แถว` |
| 429 | `rate_limited: เกินจำนวนคำขอต่อนาที (60/min)` + `Retry-After` |
| 500 | `เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ ลองใหม่อีกครั้งค่ะ` |
| `CONFLICT` ใบเสร็จ | `เลขใบเสร็จ <receipt_no> ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว` |
| `CONFLICT` key | `key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว` |
| `UNKNOWN_CODE` เมนู | `ไม่พบเมนู "<code>"` |
| `UNSUPPORTED` ชนิด / ฟิลด์ | `ชนิดแถวนี้ระบบกลางรุ่นนี้ยังไม่รองรับ` / `มีฟิลด์ที่ระบบกลางรุ่นนี้ยังไม่รู้จัก` |
| `FORBIDDEN` ข้ามวัน | `ยกเลิกได้เฉพาะวันเดียวกับวันขาย (voided_at <วันไทย> ≠ sale_date <วันขาย>)` |
| `CLOCK_AHEAD` | `เวลา <เวลาในแถวแบบ +00:00> เร็วกว่าเวลาระบบกลาง <server_time> เกิน 5 นาที — ตรวจนาฬิกาเครื่องค่ะ` |
| `SERVER_ERROR` | `SQLSTATE XX000` |

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `packages/dayo-mock/test/replay.test.ts` (ทุก fixture สัญญาต้องเล่นซ้ำกับ mock ได้ตรง · สถานะก่อนหน้าที่ dayo จำลองด้วย `rpc` ฝั่ง POS จำลองด้วย `SETUP`)

```ts
import { describe, expect, it } from 'vitest'
import { header, type CentralOrder, type OrderRowData } from '@dayo/contracts'
import { listContractFixtures, loadContractFixture } from '@dayo/contracts/fixture-files'
import { basename } from 'node:path'
import { createMockDayo, type MockDayo, type MockMode } from '../src/index.js'

type Fx = ReturnType<typeof loadContractFixture>
const accepted = loadContractFixture('e2-order-accepted')
const acceptedRow = (accepted.request.body as { rows: { key: string; kind: 'order'; data: OrderRowData }[] }).rows[0]!
const acceptedResult = (accepted.response.body as { data: { results: { data: Record<string, unknown> }[] } }).data.results[0]!.data

/** State dayo's harness gets from `rpc`, recreated on the mock (never by editing the fixture). */
const SETUP: Partial<Record<string, (m: MockDayo, fx: Fx) => void>> = {
  'e2-order-accepted': (m) => m.setNextOrderNo('2026-09-25', 14),
  'e2-order-duplicate': (m) => m.preloadAccepted(acceptedRow, acceptedResult),
  'e2-key-reused-different-content': (m) => m.preloadAccepted(acceptedRow, acceptedResult),
  'e2-receipt-conflict': (m) => m.preloadOrder({ posOrderId: acceptedRow.data.pos_order_id, receiptNo: 'A-000312', saleDate: '2026-09-25', soldAt: '2026-09-25T03:15:03.120Z', orderNo: 'L260925-014', total: 155 }),
  'e2-unknown-code-other-row-ok': (m) => m.setNextOrderNo('2026-09-25', 20),
  'e2-order-and-void-same-batch': (m) => m.setNextOrderNo('2026-09-25', 30),
  'e2-void-cross-day': (m) => m.preloadOrder({ posOrderId: '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a', receiptNo: 'A-000300', saleDate: '2026-09-25', soldAt: '2026-09-25T05:00:00.000Z', orderNo: 'L260925-040', total: 35 }),
  'e2-row-server-error': (m) => {
    m.override({ match: { key: 'order:8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f' }, verdict: { status: 'deferred', reason: 'SERVER_ERROR', detail: 'SQLSTATE XX000' }, times: 1 })
    m.setNextOrderNo('2026-09-25', 51)
    m.seedCentralOrders([{ order_no: 'L260925-049', sale_date: '2026-09-25', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'store', payment: 'qr', totals: { items_subtotal: 35, items_discount: 0, bill_discount: 0, total: 35, fee: 0 }, amount_mismatch: false, updated_at: null, sold_at: '2026-09-25T07:55:00+00:00', created_by_name: 'TungAo' } satisfies CentralOrder])
  },
}

function mockFor(fx: Fx): MockDayo {
  const auth = fx.rpc?.['api_authenticate'] as { ok?: boolean; scopes?: string[]; retry_after?: number; error?: { code: string; message: string }; $throw?: string } | undefined
  const mode: MockMode = fx.env['API_V1_ENABLED'] !== '1' ? 'api_disabled'
    : auth?.$throw !== undefined ? 'server_down'
    : auth?.error?.code === 'DY429' ? 'rate_limited'
    : auth?.ok === true && fx.request.path.startsWith('/api/v1/pos/catalog') && !(auth.scopes ?? []).includes('staff:read') ? 'forbidden'
    : 'normal'
  const data = (fx.response.body as { data?: Record<string, unknown> } | undefined)?.data
  const now = typeof data?.['server_time'] === 'string' ? (data['server_time'] as string) : '2026-09-25T02:00:00.120Z'
  const manifest = fx.env['DAYO_PRICING_MANIFEST'] as { commit: string; files_sha256: Record<string, string> } | undefined
  const m = createMockDayo({
    apiKey: 'dayo_fixture_key_0001', origins: String(fx.env['POS_ORIGINS'] ?? '').split(','), now, mode,
    retryAfterSec: auth?.retry_after ?? 30, forbiddenMessage: 'forbidden: API key ไม่มีสิทธิ์ staff:read',
    ...(fx.name === 'e1-catalog-changed' ? { catalog: data as never } : {}),
    ...(manifest === undefined ? {} : { pricing: manifest }),
    ...(fx.name === 'e3-orders-today' ? { seedOrders: (data as unknown as CentralOrder[]) } : {}),
  })
  SETUP[fx.name]?.(m, fx)
  return m
}

for (const file of listContractFixtures()) {
  const fx = loadContractFixture(basename(file, '.json'))
  describe(`replay ${fx.name}`, () => {
    it('the mock answers exactly as the contract fixture says', async () => {
      const m = mockFor(fx)
      const res = await m.handle(new Request(`http://mock${fx.request.path}`, {
        method: fx.request.method, headers: fx.request.headers ?? {},
        ...(fx.request.body === undefined ? {} : { body: JSON.stringify(fx.request.body) }),
      }))
      expect(res.status).toBe(fx.response.status)
      for (const [h, v] of Object.entries(fx.response.headers ?? {})) expect(res.headers.get(h), h).toBe(v)
      for (const h of fx.response.headers_absent ?? []) expect(res.headers.get(h), h).toBeNull()
      const text = await res.text()
      expect(text === '' ? undefined : JSON.parse(text)).toEqual(fx.response.body)
      void header
    })
  })
}
```

(ถ้า fixture `e3-orders-today` มีบิล `source:'pos'` ใน `data` — mock คืนบิล seed ตามที่ให้ไว้ทุกใบ ไม่กรอง source · การกรองบิล POS ออกเป็นหน้าที่ของแท็บเล็ต (Task 15))

`packages/dayo-mock/test/handler.test.ts` (พฤติกรรมที่ fixture ไม่ครอบ):

```ts
import { describe, expect, it } from 'vitest'
import { loadContractFixture } from '@dayo/contracts/fixture-files'
import { createMockDayo, MOCK_API_KEY } from '../src/index.js'

const auth = { authorization: `Bearer ${MOCK_API_KEY}`, origin: 'http://localhost:4173' }
const acceptedBody = () => JSON.stringify({ ...(loadContractFixture('e2-order-accepted').request.body as object) })

describe('mock dayo', () => {
  it('bumpCatalog makes the next known_version call answer changed:true with the new version', async () => {
    const m = createMockDayo({ now: '2026-09-25T02:00:00.000Z' })
    const v = m.bumpCatalog((c) => { c.catalog.variants[0]!.price = 40 })
    const body = await (await m.fetch('http://mock/api/v1/pos/catalog?known_version=42', { headers: auth })).json() as { data: { changed: boolean; catalog_version: number } }
    expect(body.data).toMatchObject({ changed: true, catalog_version: v })
    expect(v).toBe(43)
  })
  it('an override answers once, then the real rule applies', async () => {
    const m = createMockDayo({ now: '2026-09-25T03:15:04.010Z' })
    m.override({ match: { receiptNo: 'A-000312' }, verdict: { status: 'rejected', reason: 'CONFLICT', detail: 'forced' }, times: 1 })
    const send = async () => (await (await m.fetch('http://mock/api/v1/pos/push', { method: 'POST', headers: auth, body: acceptedBody() })).json()) as { data: { results: { status: string }[] } }
    expect((await send()).data.results[0]!.status).toBe('rejected')
    expect((await send()).data.results[0]!.status).toBe('accepted')
  })
  it('hang never answers until the caller aborts', async () => {
    const m = createMockDayo({ mode: 'hang' })
    const ac = new AbortController()
    const p = m.fetch('http://mock/api/v1/pos/catalog', { headers: auth, signal: ac.signal })
    ac.abort(new Error('timeout'))
    await expect(p).rejects.toThrow()
  })
  it('a body over 262,144 UTF-8 bytes is a 422 envelope error', async () => {
    const m = createMockDayo()
    const huge = JSON.stringify({ device_time: '2026-09-25T03:15:03.120Z', rows: [{ pad: 'ก'.repeat(90_000) }] }) // 270,000 bytes in UTF-8
    expect((await m.fetch('http://mock/api/v1/pos/push', { method: 'POST', headers: auth, body: huge })).status).toBe(422)
  })
  it('a sale_date after today (crossing midnight inside the 5-minute grace) is deferred CLOCK_AHEAD (block-1 interpretation 3)', async () => {
    const m = createMockDayo({ now: '2026-09-25T16:58:00.000Z' }) // 23:58 Bangkok
    const b = JSON.parse(acceptedBody()) as { rows: { data: Record<string, unknown> }[] }
    b.rows[0]!.data['sold_at'] = '2026-09-25T17:01:00.000Z'; b.rows[0]!.data['sale_date'] = '2026-09-26' // 00:01 next day, +3 min
    const r = await (await m.fetch('http://mock/api/v1/pos/push', { method: 'POST', headers: auth, body: JSON.stringify(b) })).json() as { data: { results: { status: string; reason: string }[] } }
    expect(r.data.results[0]).toMatchObject({ status: 'deferred', reason: 'CLOCK_AHEAD' })
  })
  it('an unknown sub-key of bill_discount or totals is deferred UNSUPPORTED (block-1 interpretation 5)', async () => {
    const m = createMockDayo({ now: '2026-09-25T03:15:04.010Z' })
    const b = JSON.parse(acceptedBody()) as { rows: { data: { totals: Record<string, unknown> } }[] }
    b.rows[0]!.data.totals['service'] = 0
    const r = await (await m.fetch('http://mock/api/v1/pos/push', { method: 'POST', headers: auth, body: JSON.stringify(b) })).json() as { data: { results: { reason: string }[] } }
    expect(r.data.results[0]!.reason).toBe('UNSUPPORTED')
  })
})
```

`packages/dayo-mock/test/judge.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadContractFixture } from '@dayo/contracts/fixture-files'
import type { OrderRowData } from '@dayo/contracts'
import { createMockDayo, MOCK_API_KEY } from '../src/index.js'

const auth = { authorization: `Bearer ${MOCK_API_KEY}` }
const base = (loadContractFixture('e2-order-accepted').request.body as { rows: { data: OrderRowData }[] }).rows[0]!.data
const ID2 = '11111111-2222-4333-8444-555555555555'
const row = (data: Partial<OrderRowData> & { pos_order_id: string }) => ({ key: `order:${data.pos_order_id}`, kind: 'order', data: { ...base, ...data } })
const voidRow = (d: Record<string, unknown>) => ({ key: `order_void:${base.pos_order_id}`, kind: 'order_void', data: { pos_order_id: base.pos_order_id, voided_at: '2026-09-25T03:16:00.000Z', staff_id: base.staff_id, approved_by: null, reason: 'x', ...d } })
async function push(m: ReturnType<typeof createMockDayo>, ...rows: unknown[]) {
  const r = await m.fetch('http://mock/api/v1/pos/push', { method: 'POST', headers: auth, body: JSON.stringify({ device_time: '2026-09-25T03:15:04.000Z', rows }) })
  return ((await r.json()) as { data: { results: { status: string; reason?: string }[] } }).data.results
}

describe('mock verdict rules not covered by the contract fixtures (spec §4.5 การกันซ้ำ)', () => {
  it('after the 30-day key purge: same pos_order_id with other content = duplicate (accepted limit); same receipt + new pos_order_id = CONFLICT', async () => {
    const m = createMockDayo({ now: '2026-09-25T03:15:04.010Z' })
    m.preloadOrder({ posOrderId: base.pos_order_id, receiptNo: base.receipt_no, saleDate: '2026-09-25', soldAt: base.sold_at, orderNo: 'L260925-014', total: 155 }) // order exists, key gone
    expect((await push(m, row({ pos_order_id: base.pos_order_id, note: 'อื่น' })))[0]!.status).toBe('duplicate')
    expect((await push(m, row({ pos_order_id: ID2 })))[0]).toMatchObject({ status: 'rejected', reason: 'CONFLICT' })
  })
  it('a rejected row sent again under the same key with fixed data is accepted (rejected results are never stored)', async () => {
    const m = createMockDayo({ now: '2026-09-25T03:15:04.010Z' })
    const bad = row({ pos_order_id: base.pos_order_id, lines: [{ ...base.lines[0]!, code: 'Nope' }] })
    expect((await push(m, bad))[0]).toMatchObject({ status: 'rejected', reason: 'UNKNOWN_CODE' })
    expect((await push(m, row({ pos_order_id: base.pos_order_id })))[0]!.status).toBe('accepted')
  })
  it('order_void: unknown approver = UNKNOWN_STAFF · voided_at before sold_at = INVALID', async () => {
    const m = createMockDayo({ now: '2026-09-25T03:15:04.010Z' })
    await push(m, row({ pos_order_id: base.pos_order_id }))
    expect((await push(m, voidRow({ approved_by: ID2 })))[0]).toMatchObject({ status: 'rejected', reason: 'UNKNOWN_STAFF' })
    expect((await push(m, voidRow({ voided_at: '2026-09-25T03:00:00.000Z' })))[0]).toMatchObject({ status: 'rejected', reason: 'INVALID' })
  })
})
```

`src/server.ts` (Node เท่านั้น):

```ts
import { createServer } from 'node:http'
import { createMockDayo, type MockMode, type MockOverride } from './index.js'

const arg = (name: string): string[] => process.argv.flatMap((a, i) => (a === name ? [process.argv[i + 1] ?? ''] : []))
const port = Number(arg('--port')[0] ?? '8787')
const origins = arg('--origin')
const mock = createMockDayo(origins.length > 0 ? { origins } : {})

createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const body = Buffer.concat(chunks).toString('utf8')
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)
  const send = (status: number, payload: unknown): void => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)) }
  if (url.pathname.startsWith('/__mock/')) { // test control — no auth, never shipped
    const j = body === '' ? null : (JSON.parse(body) as unknown)
    switch (url.pathname) {
      case '/__mock/reset': mock.reset(); return send(200, { ok: true })
      case '/__mock/mode': mock.setMode((j as { mode: MockMode }).mode); return send(200, { ok: true })
      case '/__mock/now': mock.setNow((j as { iso: string | null }).iso); return send(200, { ok: true })
      case '/__mock/override': mock.override(j as MockOverride); return send(200, { ok: true })
      case '/__mock/bump-catalog': return send(200, { catalog_version: mock.bumpCatalog() })
      case '/__mock/seed-orders': mock.seedCentralOrders(j as never); return send(200, { ok: true })
      case '/__mock/state': return send(200, { orders: mock.orders(), requests: mock.requests() })
      default: return send(404, { ok: false })
    }
  }
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const r = await mock.handle(new Request(url, { method: req.method ?? 'GET', headers, ...(body === '' || req.method === 'GET' || req.method === 'OPTIONS' ? {} : { body }) }))
  res.writeHead(r.status, Object.fromEntries(r.headers))
  res.end(Buffer.from(await r.arrayBuffer()))
}).listen(port, () => console.log(`dayo mock on http://localhost:${port}`))
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm install && pnpm --filter @dayo/dayo-mock test` · คาดว่า FAIL: module not found

- [ ] **Step 3: เขียนโค้ด**

`packages/dayo-mock/package.json`: name `@dayo/dayo-mock` · `exports: { ".": "./src/index.ts" }` · scripts `test`, `typecheck`, `"start": "tsx src/server.ts"` · dependencies `@dayo/contracts: workspace:*`, `@noble/hashes: ^2.4.0` (sha256 แบบ JS ล้วน — ห้าม `node:crypto`) · devDependencies `@types/node`, `tsx`, `typescript`, `vitest`

`src/state.ts`:

```ts
import { PosCatalogResponse, type CentralOrder, type OrderRowData, type PosCatalogData, type ReceivedRowResult } from '@dayo/contracts'
import rich from '@dayo/contracts/fixtures/pos-test/e1-catalog-rich.json' with { type: 'json' }

export type PosCatalogChangedData = Extract<PosCatalogData, { changed: true }>
export type StoredOrder = { orderNo: string; posOrderId: string; receiptNo: string; saleDate: string; soldAt: string; total: number; status: 'ok' | 'cancelled'; version: number; staffId: string | null; data: OrderRowData | null }
export type MockState = {
  apiKey: string; origins: string[]; fixedNow: number | null; mode: MockMode; retryAfterSec: number; forbiddenMessage: string
  catalog: PosCatalogChangedData; pricing: { commit: string; files_sha256: Record<string, string> } | null
  orders: Map<string, StoredOrder>            // by pos_order_id
  receipts: Map<string, string>               // receipt_no → pos_order_id
  keys: Map<string, { hash: string; result: ReceivedRowResult }> // accepted/duplicate only (spec §4.5 การกันซ้ำ)
  seq: Map<string, number>                    // next order_no per sale_date
  overrides: MockOverride[]
  seedOrders: CentralOrder[]
  log: { method: string; path: string; rows: number; status: number }[]
}
// MockMode, MockOverride, MockOptions, MockDayo as in Interfaces
export function freshCatalog(): PosCatalogChangedData {
  const d = PosCatalogResponse.parse(rich).data
  if (!d.changed) throw new Error('e1-catalog-rich.json must be changed:true')
  return structuredClone(d)
}
```

`src/judge.ts` — **ลำดับตรวจตามแผนก้อน 1 Task 3 Step 4** (a)→(b)→(d)→(e)→(1)→(f)→(g)→(2):

```ts
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { bangkokDateOf, clipCodePoints, fieldsUsed, PushRow, type OrderRowData, type OrderVoidRowData, type ReceivedRowResult } from '@dayo/contracts'
import type { MockState, StoredOrder } from './state.js'

const FIVE_MIN = 5 * 60_000
const KEY_RE = /^([a-z_]+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
const SUBKEYS: Record<string, readonly string[]> = { bill_discount: ['baht', 'percent', 'reason'], totals: ['items_subtotal', 'items_discount', 'bill_discount', 'total'] }
const canonical = (v: unknown): string => JSON.stringify(v, (_, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x))
const hashOf = (data: unknown): string => bytesToHex(sha256(utf8ToBytes(canonical(data))))
const plus00 = (iso: string): string => iso.replace(/Z$/, '+00:00')
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const rejected = (key: string, reason: string, detail: string): ReceivedRowResult => ({ key, status: 'rejected', reason, detail: clipCodePoints(detail, 500) })
const deferred = (key: string, reason: string, detail: string): ReceivedRowResult => ({ key, status: 'deferred', reason, detail: clipCodePoints(detail, 500) })
const staffKnown = (s: MockState, id: string | null): boolean => id === null || s.catalog.staff.some((x) => x.id === id) // active or removed (spec §4.5 rule 4)

export function judgeRow(s: MockState, raw: unknown, now: number, serverTime: string): ReceivedRowResult {
  const r = isObj(raw) ? raw : {}
  const key = typeof r['key'] === 'string' ? clipCodePoints(r['key'], 200) : ''
  const data = isObj(r['data']) ? r['data'] : null
  // (a) row shape
  if (typeof r['key'] !== 'string' || [...(r['key'] as string)].length < 1 || [...(r['key'] as string)].length > 200) return rejected(key, 'BAD_KEY', 'key ต้องเป็นข้อความ 1–200 ตัว')
  if (typeof r['kind'] !== 'string' || data === null) return rejected(key, 'INVALID', 'รูปแถวไม่ถูกต้อง')
  const kind = r['kind']
  const forced = takeOverride(s, key, data)
  if (forced !== null) return { key, ...forced }
  if (s.mode === 'force_row_error') return deferred(key, 'SERVER_ERROR', 'SQLSTATE XX000')
  // (b) kind this dayo build does not know
  if (!s.catalog.supported_kinds.includes(kind)) return deferred(key, 'UNSUPPORTED', 'ชนิดแถวนี้ระบบกลางรุ่นนี้ยังไม่รองรับ')
  // (d) key = <kind>:<uuid> and uuid = data.pos_order_id
  const m = KEY_RE.exec(key)
  if (m === null || m[1] !== kind || data['pos_order_id'] !== m[2]) return rejected(key, 'BAD_KEY', 'key ต้องเป็น <kind>:<pos_order_id> ของแถวนี้')
  // (e) unknown fields — incl. unknown sub-keys of bill_discount / totals (block-1 interpretation 5)
  const allowed = new Set(s.catalog.supported_fields[kind] ?? [])
  const unknownSub = Object.entries(SUBKEYS).some(([f, subs]) => isObj(data[f]) && Object.keys(data[f] as object).some((k) => !subs.includes(k)))
  if (fieldsUsed(data).some((f) => !allowed.has(f)) || unknownSub) return deferred(key, 'UNSUPPORTED', 'มีฟิลด์ที่ระบบกลางรุ่นนี้ยังไม่รู้จัก')
  // (1) idempotency hash BEFORE any other check (spec §4.5 rule 0 (1))
  const hash = hashOf(data)
  const seen = s.keys.get(key)
  if (seen !== undefined) return seen.hash === hash ? { ...seen.result, status: 'duplicate' } : rejected(key, 'CONFLICT', 'key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว')
  // (f) field shapes
  const parsed = PushRow.safeParse(raw)
  if (!parsed.success) return rejected(key, 'INVALID', `รูปข้อมูลไม่ถูกต้อง: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`) // paths only, never values (§7 ข้อ 8)
  // (g) clock
  const t = parsed.data.kind === 'order' ? parsed.data.data.sold_at : parsed.data.data.voided_at
  if (Date.parse(t) > now + FIVE_MIN) return deferred(key, 'CLOCK_AHEAD', `เวลา ${plus00(t)} เร็วกว่าเวลาระบบกลาง ${serverTime} เกิน 5 นาที — ตรวจนาฬิกาเครื่องค่ะ`)
  // (2)
  const result = parsed.data.kind === 'order' ? judgeOrder(s, key, parsed.data.data, now, serverTime) : judgeVoid(s, key, parsed.data.data)
  if (result.status === 'accepted' || result.status === 'duplicate') s.keys.set(key, { hash, result: { ...result, status: 'accepted' } }) // rejected/deferred never stored under the key
  return result
}

function judgeOrder(s: MockState, key: string, d: OrderRowData, now: number, serverTime: string): ReceivedRowResult {
  const existing = s.orders.get(d.pos_order_id)
  if (existing !== undefined) return { key, status: 'duplicate', data: acceptedData(s, existing) }                                   // (ก)
  const holder = s.receipts.get(d.receipt_no)
  if (holder !== undefined && holder !== d.pos_order_id) return rejected(key, 'CONFLICT', `เลขใบเสร็จ ${d.receipt_no} ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว`) // (ข)
  const today = bangkokDateOf(new Date(now).toISOString())
  if (d.sale_date > today) return deferred(key, 'CLOCK_AHEAD', `เวลา ${plus00(d.sold_at)} เร็วกว่าเวลาระบบกลาง ${serverTime} เกิน 5 นาที — ตรวจนาฬิกาเครื่องค่ะ`) // block-1 interpretation 3
  if (d.sale_date < bangkokDateOf(new Date(now - 60 * 86_400_000).toISOString())) return rejected(key, 'INVALID', `sale_date ${d.sale_date} เก่ากว่า 60 วัน`)
  if (!staffKnown(s, d.staff_id)) return rejected(key, 'UNKNOWN_STAFF', 'ผู้ขายไม่ใช่พนักงานของร้าน')
  const codes = new Set(s.catalog.catalog.variants.map((v) => v.menuCode))
  for (const l of d.lines) if (!codes.has(l.code)) return rejected(key, 'UNKNOWN_CODE', `ไม่พบเมนู "${clipCodePoints(l.code, 100)}"`)
  if (!s.catalog.catalog.channels.some((c) => c.code === d.channel)) return rejected(key, 'UNKNOWN_CODE', `ไม่พบช่องทาง "${clipCodePoints(d.channel, 100)}"`)
  if (!s.catalog.catalog.paymentMethods.some((p) => p.code === d.payment)) return rejected(key, 'UNKNOWN_CODE', `ไม่พบวิธีชำระ "${clipCodePoints(d.payment, 100)}"`)
  const n = s.seq.get(d.sale_date) ?? 1                                                                                                // (ค)
  s.seq.set(d.sale_date, n + 1)
  const o: StoredOrder = { orderNo: `L${d.sale_date.slice(2).replaceAll('-', '')}-${String(n).padStart(3, '0')}`, posOrderId: d.pos_order_id, receiptNo: d.receipt_no, saleDate: d.sale_date, soldAt: d.sold_at, total: d.totals.total, status: 'ok', version: 1, staffId: d.staff_id, data: d }
  s.orders.set(o.posOrderId, o)
  s.receipts.set(o.receiptNo, o.posOrderId)
  return { key, status: 'accepted', data: acceptedData(s, o) }
}

/** The mock does not re-price: computed_total = total (Task 14/21 force a difference with an override). */
function acceptedData(s: MockState, o: StoredOrder): Record<string, unknown> {
  const dup = s.seedOrders.filter((b) => b.status === 'ok' && b.source !== 'pos' && b.sale_date === o.saleDate && b.totals.total === o.total && b.sold_at != null && Math.abs(Date.parse(b.sold_at) - Date.parse(o.soldAt)) <= 10 * 60_000).map((b) => b.order_no)
  return { order_no: o.orderNo, version: o.version, computed_total: o.total, amount_mismatch: false, duplicate_of: dup, warnings: [] }
}

function judgeVoid(s: MockState, key: string, d: OrderVoidRowData): ReceivedRowResult {
  const o = s.orders.get(d.pos_order_id)
  if (o === undefined) return deferred(key, 'PARENT_PENDING', 'ยังไม่พบบิลนี้ในระบบกลาง')
  if (Date.parse(d.voided_at) < Date.parse(o.soldAt)) return rejected(key, 'INVALID', 'voided_at ต้องไม่ก่อน sold_at')
  const day = bangkokDateOf(d.voided_at)
  if (day !== o.saleDate) return rejected(key, 'FORBIDDEN', `ยกเลิกได้เฉพาะวันเดียวกับวันขาย (voided_at ${day} ≠ sale_date ${o.saleDate})`)
  if (o.status === 'cancelled') return { key, status: 'duplicate', data: { order_no: o.orderNo, version: o.version } }
  if (!staffKnown(s, d.staff_id) || !staffKnown(s, d.approved_by)) return rejected(key, 'UNKNOWN_STAFF', 'ผู้ยกเลิกหรือผู้อนุมัติไม่ใช่พนักงานของร้าน')
  o.status = 'cancelled'
  o.version += 1
  return { key, status: 'accepted', data: { order_no: o.orderNo, version: o.version } }
}

function takeOverride(s: MockState, key: string, data: Record<string, unknown>): Omit<ReceivedRowResult, 'key'> | null {
  const i = s.overrides.findIndex((o) => (o.match.key !== undefined && o.match.key === key) || (o.match.receiptNo !== undefined && data['receipt_no'] === o.match.receiptNo))
  if (i === -1) return null
  const o = s.overrides[i]!
  o.times -= 1
  if (o.times <= 0) s.overrides.splice(i, 1)
  return o.verdict
}
```

`src/handler.ts`:

```ts
import { MAX_PUSH_BODY_BYTES, PushEnvelope, type CentralOrder } from '@dayo/contracts'
import { judgeRow } from './judge.js'
import { freshCatalog, type MockDayo, type MockOptions, type MockState } from './state.js'

export const MOCK_API_KEY = `dayo_${'0123456789abcdef'.repeat(4)}`
const utf8 = new TextEncoder()

export function createMockDayo(opts: MockOptions = {}): MockDayo {
  const init = (): MockState => ({
    apiKey: opts.apiKey ?? MOCK_API_KEY, origins: opts.origins ?? ['http://localhost:4173'], fixedNow: opts.now ? Date.parse(opts.now) : null,
    mode: opts.mode ?? 'normal', retryAfterSec: opts.retryAfterSec ?? 30, forbiddenMessage: opts.forbiddenMessage ?? 'forbidden: API key ไม่มีสิทธิ์ staff:read',
    catalog: opts.catalog ? structuredClone(opts.catalog) : freshCatalog(), pricing: opts.pricing ?? null,
    orders: new Map(), receipts: new Map(), keys: new Map(), seq: new Map(), overrides: [], seedOrders: [...(opts.seedOrders ?? [])], log: [],
  })
  let s = init()
  const now = (): number => s.fixedNow ?? Date.now()
  const serverTime = (): string => new Date(now()).toISOString().replace('Z', '+00:00')
  /** CORS at one point (spec §4.1): Vary always; the rest only for an allowed origin — errors included. */
  const cors = (origin: string | null): Record<string, string> => (origin !== null && s.origins.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'Retry-After' } : { Vary: 'Origin' })
  const json = (status: number, body: unknown, h: Record<string, string>): Response => new Response(JSON.stringify(body), { status, headers: { ...h, 'Content-Type': 'application/json' } })
  const err = (status: number, code: string, message: string, h: Record<string, string>): Response => json(status, { ok: false, error: { code, message } }, h)

  /** Every /api/v1 request is logged WITH its status — refused ones too (review item 14: a revoked key must stay silent). */
  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    let rows = 0
    if (req.method === 'POST') {
      try { const b = JSON.parse(await req.clone().text()) as { rows?: unknown }; rows = Array.isArray(b.rows) ? b.rows.length : 0 } catch { rows = 0 }
    }
    const res = await route(req)
    if (url.pathname.startsWith('/api/v1/') && req.method !== 'OPTIONS') s.log.push({ method: req.method, path: url.pathname, rows, status: res.status })
    return res
  }

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const h = cors(req.headers.get('origin'))
    if (!url.pathname.startsWith('/api/v1/')) return new Response('not found', { status: 404 })
    if (req.method === 'OPTIONS') { // 204 always, even with the API off (spec §4.1)
      const allowed = 'Access-Control-Allow-Origin' in h
      return new Response(null, { status: 204, headers: { ...h, ...(allowed ? { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '7200' } : {}) } })
    }
    if (s.mode === 'hang') return new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason ?? new Error('aborted'))))
    if (s.mode === 'api_disabled') return err(404, 'DY404', 'not_found', h)
    if (s.mode === 'server_down') return err(500, 'DY500', 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ ลองใหม่อีกครั้งค่ะ', h)
    if (s.mode === 'unauthorized' || req.headers.get('authorization') !== `Bearer ${s.apiKey}`) return err(401, 'DY401', 'invalid_key: API key ไม่ถูกต้องหรือถูกปิดใช้งาน', h)
    if (s.mode === 'rate_limited') return err(429, 'DY429', 'rate_limited: เกินจำนวนคำขอต่อนาที (60/min)', { ...h, 'Retry-After': String(s.retryAfterSec) })
    if (s.mode === 'forbidden') return err(403, 'DY403', s.forbiddenMessage, h)

    if (req.method === 'GET' && url.pathname === '/api/v1/pos/catalog') {
      const c = s.catalog
      const common = { pricing: s.pricing ?? c.pricing, catalog_version: c.catalog_version, server_time: serverTime(), supported_kinds: c.supported_kinds, supported_fields: c.supported_fields }
      const known = Number(url.searchParams.get('known_version') ?? '0')
      return json(200, { ok: true, data: known === c.catalog_version ? { ...common, changed: false } : { ...c, ...common, changed: true } }, { ...h, 'Cache-Control': 'no-store' })
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/pos/push') {
      const text = await req.text()
      if (utf8.encode(text).length > MAX_PUSH_BODY_BYTES) return err(422, 'DY422', 'invalid: body เกิน 256 KB', h)
      let body: unknown
      try { body = JSON.parse(text) } catch { return err(422, 'DY422', 'invalid: body ต้องเป็น JSON', h) }
      const env = PushEnvelope.safeParse(body)
      if (!env.success) return err(422, 'DY422', 'invalid: rows ต้องเป็นรายการ 1–20 แถว', h)
      const t = now()
      const st = serverTime()
      return json(200, { ok: true, data: { server_time: st, results: env.data.rows.map((r) => judgeRow(s, r, t, st)) } }, h)
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/orders') {
      const from = url.searchParams.get('from') ?? '0000-00-00'
      const to = url.searchParams.get('to') ?? '9999-99-99'
      const pos: CentralOrder[] = [...s.orders.values()].filter((o) => o.data !== null).map((o) => ({
        order_no: o.orderNo, sale_date: o.saleDate, status: o.status === 'cancelled' ? 'cancelled' : 'ok', source: 'pos', external_ref: o.receiptNo, version: o.version,
        channel: o.data!.channel, payment: o.data!.payment, totals: { ...o.data!.totals, fee: 0 }, amount_mismatch: false, updated_at: null, sold_at: o.soldAt.replace('Z', '+00:00'),
        created_by_name: s.catalog.staff.find((x) => x.id === o.staffId)?.display_name ?? null, pos_receipt_no: o.receiptNo, pos_queue_no: o.data!.queue_no,
        catalog_version: o.data!.catalog_version, duplicate_suspect: false,
      }))
      return json(200, { ok: true, data: [...s.seedOrders, ...pos].filter((o) => o.sale_date >= from && o.sale_date <= to) }, h)
    }
    return err(404, 'DY404', 'not_found', h)
  }

  return {
    handle,
    fetch: (input, init) => handle(new Request(input as RequestInfo, init)),
    setMode: (mode) => { s.mode = mode },
    setNow: (iso) => { s.fixedNow = iso === null ? null : Date.parse(iso) },
    override: (o) => { s.overrides.push(structuredClone(o)) },
    bumpCatalog: (mutate) => { mutate?.(s.catalog); s.catalog.catalog_version += 1; return s.catalog.catalog_version },
    seedCentralOrders: (orders) => { s.seedOrders.push(...orders) },
    preloadAccepted: (row, result) => {
      judgeRow(s, row, Date.parse(row.data.sold_at), row.data.sold_at) // store the order the normal way…
      const stored = s.orders.get(row.data.pos_order_id)!
      stored.orderNo = String(result['order_no'])                       // …then pin the fixture's order number
      s.keys.set(row.key, { ...s.keys.get(row.key)!, result: { key: row.key, status: 'accepted', data: result } })
    },
    preloadOrder: (o) => {
      s.orders.set(o.posOrderId, { ...o, status: 'ok', version: 1, staffId: null, data: null })
      s.receipts.set(o.receiptNo, o.posOrderId)
    },
    setNextOrderNo: (saleDate, n) => { s.seq.set(saleDate, n) },
    orders: () => [...s.orders.values()].map((o) => ({ posOrderId: o.posOrderId, orderNo: o.orderNo, receiptNo: o.receiptNo, status: o.status, total: o.total })),
    requests: () => [...s.log],
    reset: () => { s = init() },
  }
}
```

(`acceptedData` ใช้ `o.total` — สำหรับ `preloadOrder` ที่ไม่มี `data` ยังคิด `duplicate_of` ได้ · E3 ไม่ส่งบิลที่ preload แบบไม่มี `data`)

`src/server.ts` ตามโค้ดใน Step 1 · `src/index.ts` export `createMockDayo`, `MOCK_API_KEY` และ type ทั้งหมด

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/dayo-mock test` → PASS (fixture สัญญาทุกชื่อใน `CONTRACT_FIXTURE_NAMES` เล่นซ้ำตรงทุกไบต์ของ body + หัว CORS — รวม `err-404-unknown-path` ที่ mock ตอบด้วย route กันตก 404 `not_found` + CORS · handler · judge) · `pnpm --filter @dayo/dayo-mock start -- --port 8787 --origin http://localhost:4173` แล้ว `curl -si -X OPTIONS http://localhost:8787/api/v1/pos/push -H "origin: http://localhost:4173"` → `204` พร้อมหัว CORS (หยุดด้วย Ctrl+C)

- [ ] **Step 5: Commit**

```bash
git add packages/dayo-mock/package.json packages/dayo-mock/tsconfig.json packages/dayo-mock/vitest.config.ts packages/dayo-mock/src/state.ts packages/dayo-mock/src/judge.ts packages/dayo-mock/src/handler.ts packages/dayo-mock/src/server.ts packages/dayo-mock/src/index.ts packages/dayo-mock/test/replay.test.ts packages/dayo-mock/test/judge.test.ts packages/dayo-mock/test/handler.test.ts pnpm-lock.yaml
git commit -m "feat(dayo-mock): add a contract-true mock of the dayo pos api"
```

---

## 4. สาย C — ฐานในเครื่อง การเชื่อม และตัวส่ง

กติกาของสาย C ทุก task: (1) การอ่าน/เขียน SQLite ผ่านคิว `serial` ของ `createPosApi` ทีละช่วงสั้น · **การรอเครือข่ายห้ามอยู่ในคิว serial** ยกเว้นการตั้งเครื่อง (`connectShop`) ที่ไม่มีงานอื่นแข่ง (2) **ชื่อ API ใหม่เป็นชื่อถาวร** (`connectShop`, `loadSellCatalog`, `recordSale`, `cancelSale`, …) ส่วน API เดิม (`setupShop`, `loadMenu`, `commitSale`, `voidOrder`) คงไว้ให้หน้าจอเดิม compile ได้จนสาย D เปลี่ยน แล้ว Task 22 ลบ — typecheck ของทั้ง repo จึงผ่านทุก task (3) e2e บน `block-2-pos` อาจล้มระหว่าง Task 11–20 (หน้าตั้งเครื่องเดิมใช้ไม่ได้) — **ห้าม merge `block-2-pos` เข้า `main` ก่อน Task 21 ผ่าน**

### Task 8: ฐานในเครื่อง — ตาราง/คอลัมน์ก้อน 2 + migration

ผู้ทำ: sync-engineer (opus) · สเปก §3, §4.3, §6.1, §11 · รอ Task 5

**Files:**
- Modify: `packages/db-schema/src/sqlite/sales.ts` (`order` + ตารางใหม่ `orderItem`), `packages/db-schema/src/sqlite/system.ts` (`outbox` + ตารางใหม่ `dayoCatalog`)
- Create (ด้วย drizzle-kit): `packages/db-schema/drizzle/sqlite/0003_block2_central_catalog.sql`, `0004_block2_outbox_local_only.sql`, `meta/0003_snapshot.json`, `meta/0004_snapshot.json` · แก้ `meta/_journal.json`
- Regenerate: `packages/db-schema/src/browser/sqlite-migrations.gen.ts`
- Modify: `packages/db-schema/test/parity.test.ts`, `packages/db-schema/test/triggers.test.ts`
- Create: `packages/db-schema/test/block2.test.ts`

**Interfaces:**
- Consumes: `OutboxStatus` (มี `local_only`) จาก Task 5
- Produces: `s.orderItem` · `s.dayoCatalog` · คอลัมน์ใหม่ของ `s.order`: `soldAt`, `catalogVersion`, `channelCode`, `paymentCode`, `pricingJson`, `excludedAt`, `centralOrderNo`, `centralComputedTotalSatang`, `centralAmountMismatch`, `centralDuplicateOfJson` · `s.order.channelId` เป็น nullable · คอลัมน์ใหม่ของ `s.outbox`: `nextAttemptAt`, `parentKey`, `resultJson` · แถว outbox ทุกแถวที่มีอยู่ก่อน migration เป็น `local_only`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `packages/db-schema/test/block2.test.ts`

```ts
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import { describe, expect, it } from 'vitest'
import { applySeedSqlite, migrateSqlite, seedToRows, sqlite as s, SQLITE_MIGRATIONS_FOLDER } from '../src/index.js'
import { fileURLToPath } from 'node:url'
import { parseSeed, type Seed } from '@dayo/contracts'
import { seedOpts } from './helpers.js'
const seed: Seed = parseSeed(JSON.parse(readFileSync(fileURLToPath(new URL('../../excel-import/seed/dayo-seed.json', import.meta.url)), 'utf8'))) // same seed as constraints.test.ts

async function freshDb() { const SQL = await initSqlJs(); return new SQL.Database() }
const one = (db: import('sql.js').Database, q: string) => db.exec(q)[0]?.values ?? []

/** A copy of the migrations folder cut after `lastTag` — to build a device that is still on plan 4. */
function folderUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'))
  cpSync(SQLITE_MIGRATIONS_FOLDER, dir, { recursive: true })
  const j = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  j.entries = j.entries.slice(0, j.entries.findIndex((e) => e.tag === lastTag) + 1)
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(j))
  return dir
}

const NOW = '2026-09-20T03:00:00.000Z'
const BILL_TABLES = ['order', 'order_line', 'payment', 'discount', 'order_event', 'cash_movement', 'shift', 'outbox'] as const

/**
 * review item 7: a real plan-3/4 device — seed + one paid bill with every child row + its VOID_REFUND — built on the
 * pre-0003 schema. `order` goes in as raw SQL (the drizzle table already has the block-2 columns); the tables block 2
 * does not change go through drizzle.
 */
async function plan4DeviceWithBills() {
  const raw = await freshDb()
  raw.exec('PRAGMA foreign_keys = ON')
  const db = drizzle(raw)
  migrateSqlite(db, folderUpTo('0002_stock_adjustment'))
  await applySeedSqlite(db, seedToRows(seed, seedOpts()))
  const channelId = String(one(raw, `select id from channel limit 1`)[0]![0])
  const variantId = String(one(raw, `select id from product_variant limit 1`)[0]![0])
  const sweetId = String(one(raw, `select id from sweetness_level limit 1`)[0]![0])
  db.insert(s.user).values({ id: 'u1', displayName: 'Owner', role: 'owner', pinHash: 'x', isActive: true, createdAt: NOW, updatedAt: NOW, version: 1 }).run()
  db.insert(s.device).values({ id: 'dev-1', name: 'Tablet A', receiptPrefix: 'A', isSellingDevice: true, registeredAt: NOW, updatedAt: NOW }).run()
  db.insert(s.shift).values({ id: 'shift-1', deviceId: 'dev-1', businessDate: '2026-09-20', status: 'open', openedBy: 'u1', openedAt: NOW, openingFloatSatang: 0 }).run()
  raw.exec(`insert into "order" (id, origin, device_id, receipt_no, queue_no, business_date, shift_id, channel_id, status,
      subtotal_satang, discount_satang, total_satang, vat_satang, cost_satang, created_by_type, created_by_id, created_at, paid_at, voided_at)
    values ('order-1', 'device', 'dev-1', 'A-000001', 1, '2026-09-20', 'shift-1', '${channelId}', 'voided',
      5000, 500, 4500, 0, 1200, 'user', 'u1', '${NOW}', '${NOW}', '${NOW}')`)
  db.insert(s.orderLine).values({ id: 'ol-1', orderId: 'order-1', lineNo: 1, variantId, sweetnessId: sweetId, productName: 'ชาไทย', sizeName: 'M', sweetnessName: '100%', unitPriceSatang: 5000, qty: 1, lineTotalSatang: 5000, unitCostSatang: 1200 }).run()
  db.insert(s.payment).values({ id: 'pay-1', orderId: 'order-1', method: 'CASH', amountSatang: 4500, tenderedSatang: 5000, changeSatang: 500, verifyStatus: 'manual', createdBy: 'u1', createdAt: NOW }).run()
  db.insert(s.discount).values({ id: 'disc-1', orderId: 'order-1', amountSatang: 500, reason: 'ลูกค้าประจำ', approvedBy: 'u1' }).run()
  raw.exec(`insert into order_event (id, order_id, seq, device_id, chain_id, chain_seq, type, payload_json, actor_type, actor_id, at, prev_hash, hash) values
    ('ev-1', 'order-1', 1, 'dev-1', 'dev-1', 1, 'PAID', '{}', 'user', 'u1', '${NOW}', '0', 'h1'),
    ('ev-2', 'order-1', 2, 'dev-1', 'dev-1', 2, 'VOIDED', '{}', 'user', 'u1', '${NOW}', 'h1', 'h2')`)
  db.insert(s.cashMovement).values({ id: 'cm-1', shiftId: 'shift-1', kind: 'VOID_REFUND', amountSatang: 4500, orderId: 'order-1', createdBy: 'u1', createdAt: NOW }).run()
  raw.exec(`insert into outbox (id, table_name, row_json, idempotency_key, status, created_at, attempts) values
    ('o1', 'order', '{"id":"order-1"}', 'order:order-1', 'pending', '${NOW}', 0),
    ('o2', 'shift', '{"id":"shift-1"}', 'shift:shift-1', 'dead', '${NOW}', 3)`)
  return { raw, db, channelId }
}
const counts = (raw: import('sql.js').Database) => BILL_TABLES.map((t) => [t, Number(one(raw, `select count(*) from "${t}"`)[0]![0])])

describe('block 2 local schema (spec 04 §6.1)', () => {
  it('a plan-3/4 device with real bills survives 0003/0004: same rows, foreign keys intact (review item 7)', async () => {
    const { raw, db } = await plan4DeviceWithBills()
    const before = counts(raw)
    const orderBefore = one(raw, `select id, receipt_no, channel_id, total_satang, status, voided_at from "order"`)
    migrateSqlite(db, SQLITE_MIGRATIONS_FOLDER) // 0003 rebuilds "order" (channel_id becomes nullable) — must not lose children
    expect(counts(raw)).toEqual(before)
    expect(one(raw, `select id, receipt_no, channel_id, total_satang, status, voided_at from "order"`)).toEqual(orderBefore)
    expect(one(raw, `PRAGMA foreign_key_check`)).toEqual([])
    expect(one(raw, `PRAGMA foreign_keys`)).toEqual([[1]]) // the migrator turns enforcement back on
    expect(one(raw, `select status from outbox order by id`)).toEqual([['local_only'], ['local_only']])
  })
  it('after 0003 a block-2 bill with only channel_code inserts; a bill with neither channel is rejected', async () => {
    const { raw, db } = await plan4DeviceWithBills()
    migrateSqlite(db, SQLITE_MIGRATIONS_FOLDER)
    const block2 = (id: string, queueNo: number, channelCode: string | null) => `insert into "order" (id, origin, device_id, receipt_no, queue_no, business_date, shift_id, channel_id, channel_code, status,
        subtotal_satang, discount_satang, total_satang, vat_satang, cost_satang, created_by_type, created_by_id, created_at, sold_at, catalog_version)
      values ('${id}', 'device', 'dev-1', 'A-00000${queueNo}', ${queueNo}, '2026-09-25', 'shift-1', null, ${channelCode === null ? 'null' : `'${channelCode}'`}, 'paid',
        4500, 0, 4500, 0, 0, 'user', 'u1', '${NOW}', '${NOW}', 42)`
    expect(() => raw.exec(block2('order-b2', 2, 'store'))).not.toThrow()
    expect(() => raw.exec(block2('order-bad', 3, null))).toThrow(/CHECK/)
  })
  it('a plan-4 device with only queued rows turns every queued row local_only', async () => {
    const raw = await freshDb()
    raw.exec('PRAGMA foreign_keys = OFF')
    migrateSqlite(drizzle(raw), folderUpTo('0002_stock_adjustment'))
    raw.exec(`insert into outbox (id, table_name, row_json, idempotency_key, status, created_at, attempts) values
      ('o1', 'order', '{"id":"x"}', 'order:x', 'pending', '2026-09-20T00:00:00.000Z', 0),
      ('o2', 'shift', '{"id":"y"}', 'shift:y', 'dead', '2026-09-20T00:00:00.000Z', 3)`)
    migrateSqlite(drizzle(raw), SQLITE_MIGRATIONS_FOLDER)
    expect(one(raw, `select status from outbox order by id`)).toEqual([['local_only'], ['local_only']])
  })
  it('order.channel_id may be null when channel_code is set, never both null', async () => {
    const raw = await freshDb()
    migrateSqlite(drizzle(raw), SQLITE_MIGRATIONS_FOLDER)
    const cols = one(raw, `select name, "notnull" from pragma_table_info('order') where name in ('channel_id','sold_at','central_order_no') order by name`)
    expect(cols).toEqual([['central_order_no', 0], ['channel_id', 0], ['sold_at', 0]])
    const sqlText = String(one(raw, `select sql from sqlite_master where name = 'order'`)[0]?.[0])
    expect(sqlText).toMatch(/channel_id.+is not null or .+channel_code.+is not null/is)
  })
  it('order_item is append-only and dayo_catalog holds one row', async () => {
    const raw = await freshDb()
    migrateSqlite(drizzle(raw), SQLITE_MIGRATIONS_FOLDER)
    expect(one(raw, `select name from sqlite_master where type = 'trigger' and name like 'order_item_%' order by name`)).toEqual([['order_item_no_delete'], ['order_item_no_update']])
    expect(() => raw.exec(`insert into dayo_catalog (id, catalog_version, catalog_json, staff_json, fetched_at) values ('other', 1, '{}', '[]', 'x')`)).toThrow(/CHECK/)
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/db-schema test -- block2` · คาดว่า FAIL (ไม่มีตาราง/คอลัมน์)

- [ ] **Step 3: แก้ schema**

`packages/db-schema/src/sqlite/sales.ts` — ใน `order`:

```ts
  // plan-3 bills only; a block-2 bill carries channel_code instead (spec 04 §4.5) — the check below keeps one of them
  channelId: text('channel_id').references(() => channel.id),
  // … existing columns unchanged …
  // block 2 (spec 04 §4.3, §4.5, §6.4): set on every bill priced with dayo's catalog
  soldAt: text('sold_at'),
  catalogVersion: int('catalog_version'),
  channelCode: text('channel_code'),
  paymentCode: text('payment_code'),
  pricingJson: json('pricing_json'),            // { draft, priced } frozen at payment — what the customer was charged
  excludedAt: text('excluded_at'),              // owner closed the row as "นอกระบบกลาง" (ruling R8)
  centralOrderNo: text('central_order_no'),     // E2 accepted data.order_no
  centralComputedTotalSatang: int('central_computed_total_satang'), // E2 computed_total through edgeBahtToSatang
  centralAmountMismatch: bool('central_amount_mismatch'),
  centralDuplicateOfJson: json('central_duplicate_of_json'),        // E2 duplicate_of (order_no of bot/web bills)
}, (t) => [
  // … existing constraints unchanged …
  check('order_channel_ck', sql`${t.channelId} is not null or ${t.channelCode} is not null`),
])
```

และเพิ่ม (import `bool` จาก `./columns.js`):

```ts
/** Lines of a block-2 bill as dayo's pricing code quoted them (spec 04 §5.1). Append-only (0004 triggers). */
export const orderItem = sqliteTable('order_item', {
  id: id(),
  orderId: text('order_id').notNull().references(() => order.id),
  lineNo: int('line_no').notNull(),
  menuCode: text('menu_code').notNull(),
  menuNameTh: text('menu_name_th').notNull(),
  size: text('size').notNull(),
  sweetness: text('sweetness').notNull(),
  milk: text('milk').notNull(),
  grade: text('grade'),
  qty: int('qty').notNull(),
  unitPriceSatang: int('unit_price_satang').notNull(),
  discountPerCupSatang: int('discount_per_cup_satang').notNull(),
  discountReason: text('discount_reason'),
  promotionId: text('promotion_id'),
  lineTotalSatang: int('line_total_satang').notNull(),
}, (t) => [
  unique().on(t.orderId, t.lineNo),
  check('order_item_qty_positive_ck', sql`${t.qty} > 0`),
  check('order_item_money_nonneg_ck', sql`${t.unitPriceSatang} >= 0 and ${t.discountPerCupSatang} >= 0 and ${t.lineTotalSatang} >= 0`),
])
```

`packages/db-schema/src/sqlite/system.ts` — ใน `outbox` เพิ่ม:

```ts
  nextAttemptAt: text('next_attempt_at'),   // not before this instant (backoff of a deferred/unanswered row — spec §6.3)
  parentKey: text('parent_key'),            // order_void waits for `order:<id>` (spec §6.2)
  resultJson: json('result_json'),          // E2 verdict data of an accepted/duplicate row
}, (t) => [
  index('outbox_pending_idx').on(t.createdAt).where(sql`status = 'pending'`),
  index('outbox_parent_idx').on(t.parentKey),
])
```

และตารางใหม่:

```ts
/** Local copy of E1 (spec 04 §4.4, §6.5): one row, replaced whole in one transaction when catalog_version changes. */
export const dayoCatalog = sqliteTable('dayo_catalog', {
  id: text('id').primaryKey(),                         // always 'current'
  catalogVersion: int('catalog_version').notNull(),
  catalogJson: json('catalog_json').notNull(),         // E1 data.catalog (OrderCatalog shape, no cost)
  staffJson: json('staff_json').notNull(),             // E1 data.staff
  clientJson: json('client_json'),                     // E1 data.client
  fetchedAt: text('fetched_at').notNull(),
}, (t) => [check('dayo_catalog_single_row_ck', sql`${t.id} = 'current'`)])
```

- [ ] **Step 4: สร้าง migration**

Run (sqlite เท่านั้น — pg ไม่แตะ):
```bash
pnpm --filter @dayo/db-schema exec drizzle-kit generate --config drizzle.config.sqlite.ts --name block2_central_catalog
pnpm --filter @dayo/db-schema exec drizzle-kit generate --config drizzle.config.sqlite.ts --custom --name block2_outbox_local_only
```
Expected: `0003_block2_central_catalog.sql` สร้าง `order_item`, `dayo_catalog`, เพิ่มคอลัมน์ outbox และ **recreate ตาราง `order`** (`__new_order` → copy → drop → rename) · เปิดไฟล์ตรวจว่า `INSERT INTO __new_order … SELECT` คัดลอกทุกคอลัมน์เดิม

เขียน `0004_block2_outbox_local_only.sql`:

```sql
-- block 2 (spec 04 §6.1, ruling R7): every row queued before block 2 used the plan-3/4 row format, which dayo's
-- /v1/pos/push does not accept. They stay on the tablet as local records only and are never sent.
UPDATE `outbox` SET `status` = 'local_only' WHERE `status` IN ('pending', 'dead');
--> statement-breakpoint
CREATE TRIGGER `order_item_no_update` BEFORE UPDATE ON `order_item` BEGIN SELECT RAISE(ABORT, 'order_item is append-only: UPDATE rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `order_item_no_delete` BEFORE DELETE ON `order_item` BEGIN SELECT RAISE(ABORT, 'order_item is append-only: DELETE rejected'); END;
```

แล้ว `pnpm --filter @dayo/db-schema gen:browser`

- [ ] **Step 5: รายการยกเว้นของ parity (pg ไม่แตะ)** — `packages/db-schema/test/parity.test.ts`

```ts
const SQLITE_ONLY = new Set(['outbox', 'sync_state', 'dayo_catalog', 'order_item'])
/**
 * Block 2 (spec 04, D59): the pg schema belonged to the plan-5 server that was dropped; block-2 columns live on the
 * tablet only and pg is left untouched. Keys are "table.column".
 */
const SQLITE_ONLY_COLUMNS = new Set([
  'order.sold_at', 'order.catalog_version', 'order.channel_code', 'order.payment_code', 'order.pricing_json', 'order.excluded_at',
  'order.central_order_no', 'order.central_computed_total_satang', 'order.central_amount_mismatch', 'order.central_duplicate_of_json',
  'outbox.next_attempt_at', 'outbox.parent_key', 'outbox.result_json',
])
/** Nullable on the tablet since block 2 (a block-2 bill has channel_code instead). */
const DIVERGED_NOT_NULL = new Set(['order.channel_id'])
```

ใช้ในฟังก์ชันสร้าง shape ฝั่ง sqlite: ข้ามคอลัมน์ที่อยู่ใน `SQLITE_ONLY_COLUMNS` · ก่อนเทียบ `notNull` ของคอลัมน์ใน `DIVERGED_NOT_NULL` ให้ตั้งเป็นค่าของ pg · ข้าม check `order_channel_ck` (ถ้า parity เทียบ check) · ห้ามเปลี่ยนการเทียบอย่างอื่น · `triggers.test.ts` เพิ่ม `order_item_no_update`, `order_item_no_delete` ในรายการที่คาด

- [ ] **Step 6: รันให้ผ่าน** — `pnpm --filter @dayo/db-schema test` → PASS (drift, parity, triggers, block2) · `pnpm turbo run typecheck test` → ผ่านทั้ง repo (ถ้าเทสต์ของ `apps/pos` ที่คาดว่า outbox เป็น `pending` ล้ม — ยังไม่ควรล้ม เพราะ 0004 มีผลกับแถวที่มีอยู่ก่อน migration เท่านั้น)

- [ ] **Step 7: Commit**

```bash
git add packages/db-schema/src/sqlite/sales.ts packages/db-schema/src/sqlite/system.ts packages/db-schema/drizzle/sqlite/0003_block2_central_catalog.sql packages/db-schema/drizzle/sqlite/0004_block2_outbox_local_only.sql packages/db-schema/drizzle/sqlite/meta/0003_snapshot.json packages/db-schema/drizzle/sqlite/meta/0004_snapshot.json packages/db-schema/drizzle/sqlite/meta/_journal.json packages/db-schema/src/browser/sqlite-migrations.gen.ts packages/db-schema/test/parity.test.ts packages/db-schema/test/triggers.test.ts packages/db-schema/test/block2.test.ts
git commit -m "feat(db-schema): store dayo's catalog, block-2 bill lines and push state on the tablet"
```

---

### Task 9: ตัวคุย dayo + ที่เก็บ API key + สถานะการเชื่อม

ผู้ทำ: sync-engineer (opus) · ผู้ตรวจเพิ่ม: **security-reviewer** · สเปก §4.1, §6.3, §6.7, §7 ข้อ 1 · รอ Task 5 (และ Task 7 สำหรับเทสต์)

**Files:**
- Create: `apps/pos/src/sync/state.ts`, `apps/pos/src/sync/secret-store.ts`, `apps/pos/src/sync/dayo-client.ts`
- Test: `apps/pos/test/dayo-client.test.ts`, `apps/pos/test/secret-store.test.ts`
- Modify: `apps/pos/package.json` (dependencies `@dayo/dayo-pricing: workspace:*` · devDependencies `@dayo/dayo-mock: workspace:*`, `fake-indexeddb: 6.2.2`)

**Interfaces:**
- Consumes: `PosCatalogResponse`, `PushResponse`, `OrdersListResponse`, `ApiErrorBody`, `API_KEY_RE`, `clipCodePoints`, type `PushRequest` (Task 5) · `createMockDayo`, `MOCK_API_KEY` (Task 7, เทสต์)
- Produces:

```ts
// state.ts
export const DAYO_KEYS: { baseUrl; apiState; apiRetryAt; clockSkewMs; clockMeasuredAt; clockAheadAt; pricingJson; pricingMismatch; supportedJson; lastReceiptNo; catalogCheckedAt; catalogError; pushFailStreak; pushBackoffUntil; pushBackoffReason; pushSingleThrough; lastPushAt }  // values 'dayo.*'
export type ApiState = 'ok' | 'unauthorized' | 'forbidden' | 'disabled'
export const CLOCK_WARN_MS = 300_000, BACKOFF_MS = [5_000, 15_000, 60_000, 300_000, 900_000], STUCK_AFTER_ATTEMPTS = 50, API_DISABLED_RETRY_MS = 900_000, RATE_LIMIT_DEFAULT_MS = 60_000, NO_ANSWER_RETRY_MS = 60_000
export async function readKey(db: RemoteDb, key: string): Promise<string | null>
export async function writeKey(db: RemoteDb, key: string, value: string): Promise<void>
export async function deleteKey(db: RemoteDb, key: string): Promise<void>
export function backoffMs(attempt: number, random: () => number): number
export function skewMs(serverTimeIso: string, sentAtMs: number, receivedAtMs: number): number
export async function recordServerTime(db: RemoteDb, serverTimeIso: string, sentAtMs: number, receivedAtMs: number, nowIso: string): Promise<void>
export function encodeLastError(reason: string, detail: string, extra?: { supportedHash?: string; farAhead?: true }): string
export function decodeLastError(raw: string | null): { reason: string; detail: string; supportedHash?: string; farAhead?: true }
// secret-store.ts
export type SecretStore = { getApiKey(): Promise<string | null>; setApiKey(key: string): Promise<void>; clearApiKey(): Promise<void> }
export function createIdbSecretStore(dbName?: string): SecretStore
export function createMemorySecretStore(initial?: string | null): SecretStore
export function maskApiKey(key: string): string   // "dayo_…abcd"
// dayo-client.ts
export type DayoFailure = { kind: 'network'; message: string } | { kind: 'unauthorized' } | { kind: 'forbidden' } | { kind: 'api_disabled' } | { kind: 'bad_envelope'; message: string } | { kind: 'rate_limited'; retryAfterMs: number } | { kind: 'server'; status: number } | { kind: 'bad_response'; message: string }
export class DayoError extends Error { readonly failure: DayoFailure }
export type Timed<T> = { value: T; sentAtMs: number; receivedAtMs: number }
export type DayoClient = { getCatalog(knownVersion: number): Promise<Timed<PosCatalogLooseData>>; push(body: PushRequest): Promise<Timed<PushResponseData>>; listOrders(q: { from: string; to: string }): Promise<Timed<CentralOrder[]>> }
export const FETCH_TIMEOUT_MS = 20_000
export function createDayoClient(cfg: { baseUrl: string; apiKey: string; fetch: typeof fetch; nowMs: () => number }): DayoClient
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/test/dayo-client.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockDayo, MOCK_API_KEY } from '@dayo/dayo-mock'
import { createDayoClient, DayoError, FETCH_TIMEOUT_MS } from '../src/sync/dayo-client'

const BASE = 'http://mock/api/v1/'
const client = (mock = createMockDayo({ now: '2026-09-25T02:00:00.120Z' }), apiKey = MOCK_API_KEY) =>
  ({ mock, c: createDayoClient({ baseUrl: BASE, apiKey, fetch: mock.fetch, nowMs: () => Date.parse('2026-09-25T02:00:00.000Z') }) })
async function failureOf(p: Promise<unknown>) { try { await p; return null } catch (e) { expect(e).toBeInstanceOf(DayoError); return (e as DayoError).failure } }

afterEach(() => { vi.useRealTimers() })

describe('dayo client (spec 04 §4.1, §6.3)', () => {
  it('reads E1 and reports when the request left and the answer came', async () => {
    const { c } = client()
    const r = await c.getCatalog(0)
    expect(r.value.changed).toBe(true)
    expect(r.value.catalog_version).toBe(42)
    expect(r.sentAtMs).toBe(Date.parse('2026-09-25T02:00:00.000Z'))
  })
  it('a trailing slash on the base URL does not produce //pos', async () => {
    const { mock, c } = client()
    await c.getCatalog(42)
    expect(mock.requests().at(-1)?.path).toBe('/api/v1/pos/catalog')
  })
  it.each([
    ['unauthorized', { kind: 'unauthorized' }],
    ['forbidden', { kind: 'forbidden' }],
    ['api_disabled', { kind: 'api_disabled' }],
    ['server_down', { kind: 'server', status: 500 }],
    ['rate_limited', { kind: 'rate_limited', retryAfterMs: 30_000 }],
  ] as const)('mode %s → %o', async (mode, failure) => {
    const { mock, c } = client()
    mock.setMode(mode)
    expect(await failureOf(c.getCatalog(0))).toEqual(failure)
  })
  it('a wrong key is 401 and the key never appears in the error', async () => {
    const wrong = `dayo_${'f'.repeat(64)}`
    const { c } = client(undefined, wrong)
    try { await c.getCatalog(0) } catch (e) { expect(String((e as Error).message) + JSON.stringify((e as DayoError).failure)).not.toContain(wrong) }
  })
  it('a hung request becomes a network failure after 20 seconds', async () => {
    vi.useFakeTimers()
    const { mock, c } = client()
    mock.setMode('hang')
    const p = failureOf(c.getCatalog(0))
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS)
    expect((await p)?.kind).toBe('network')
  })
  it('a 200 whose body breaks the contract is bad_response, not a crash', async () => {
    const fetchBad: typeof fetch = async () => new Response(JSON.stringify({ ok: true, data: { changed: true } }), { status: 200 })
    const c = createDayoClient({ baseUrl: BASE, apiKey: MOCK_API_KEY, fetch: fetchBad, nowMs: () => 0 })
    expect((await failureOf(c.getCatalog(0)))?.kind).toBe('bad_response')
  })
  it('a 422 carries the envelope message', async () => {
    const f: typeof fetch = async () => new Response(JSON.stringify({ ok: false, error: { code: 'DY422', message: 'invalid: rows ต้องมี 1–20 แถว' } }), { status: 422 })
    const c = createDayoClient({ baseUrl: BASE, apiKey: MOCK_API_KEY, fetch: f, nowMs: () => 0 })
    expect(await failureOf(c.push({ device_time: '2026-09-25T02:00:00.000Z', rows: [] as never }))).toEqual({ kind: 'bad_envelope', message: 'invalid: rows ต้องมี 1–20 แถว' })
  })
  it('fetch throwing (offline, CORS-blocked) is a network failure', async () => {
    const f: typeof fetch = async () => { throw new TypeError('Failed to fetch') }
    const c = createDayoClient({ baseUrl: BASE, apiKey: MOCK_API_KEY, fetch: f, nowMs: () => 0 })
    expect((await failureOf(c.getCatalog(0)))?.kind).toBe('network')
  })
  it('a body that stalls after the headers also times out after 20 seconds (review item 11)', async () => {
    vi.useFakeTimers()
    const f: typeof fetch = async (_input, init) => new Response(new ReadableStream({
      start(ctl) { init?.signal?.addEventListener('abort', () => ctl.error(init.signal!.reason)) }, // headers sent, body never ends
    }), { status: 200 })
    const c = createDayoClient({ baseUrl: BASE, apiKey: MOCK_API_KEY, fetch: f, nowMs: () => 0 })
    const p = failureOf(c.getCatalog(0))
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS)
    expect((await p)?.kind).toBe('network')
  })
})
```

`apps/pos/test/secret-store.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createIdbSecretStore, createMemorySecretStore, maskApiKey } from '../src/sync/secret-store'

const KEY = `dayo_${'0123456789abcdef'.repeat(4)}`
describe.each([['memory', () => createMemorySecretStore()], ['indexeddb', () => createIdbSecretStore(`t-${Math.random()}`)]])('%s secret store', (_, make) => {
  it('stores, reads and clears the API key', async () => {
    const s = make()
    expect(await s.getApiKey()).toBeNull()
    await s.setApiKey(KEY)
    expect(await s.getApiKey()).toBe(KEY)
    await s.clearApiKey()
    expect(await s.getApiKey()).toBeNull()
  })
  it('refuses a value that is not a dayo key', async () => {
    await expect(make().setApiKey('dayo_short')).rejects.toThrow()
  })
})
it('shows only dayo_ and the last 4 characters (spec §7 ข้อ 1)', () => { expect(maskApiKey(KEY)).toBe('dayo_…cdef') })
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm install && pnpm --filter @dayo/pos test -- dayo-client secret-store` · คาดว่า FAIL: module not found

- [ ] **Step 3: เขียนโค้ด**

`apps/pos/src/sync/secret-store.ts`:

```ts
import { API_KEY_RE } from '@dayo/contracts'

/**
 * spec 04 §7 ข้อ 1: the device API key lives in IndexedDB, NOT in SQLite — the SQLite file is what the backup screen
 * exports (exportDbFile), so a key there would leak into every backup. Never synced, never logged, never shown again.
 */
export type SecretStore = { getApiKey(): Promise<string | null>; setApiKey(key: string): Promise<void>; clearApiKey(): Promise<void> }

const STORE = 'secrets'
const API_KEY = 'dayo.api_key'

export function maskApiKey(key: string): string {
  return `dayo_…${key.slice(-4)}`
}

function check(key: string): void {
  if (!API_KEY_RE.test(key)) throw new Error('BAD_API_KEY: not a dayo_<64 hex> key') // never echo the value
}

export function createMemorySecretStore(initial: string | null = null): SecretStore {
  let value = initial
  return {
    getApiKey: async () => value,
    setApiKey: async (key) => { check(key); value = key },
    clearApiKey: async () => { value = null },
  }
}

export function createIdbSecretStore(dbName = 'dayo-pos-secrets'): SecretStore {
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open()
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  }
  return {
    getApiKey: async () => ((await run('readonly', (s) => s.get(API_KEY))) as string | undefined) ?? null,
    setApiKey: async (key) => { check(key); await run('readwrite', (s) => s.put(key, API_KEY)) },
    clearApiKey: async () => { await run('readwrite', (s) => s.delete(API_KEY)) },
  }
}
```

`apps/pos/src/sync/dayo-client.ts`:

```ts
import { ApiErrorBody, OrdersListResponse, PosCatalogLooseResponse, PushResponse, type CentralOrder, type PosCatalogLooseData, type PushRequest, type PushResponseData } from '@dayo/contracts'

export type DayoFailure =
  | { kind: 'network'; message: string }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'api_disabled' }
  | { kind: 'bad_envelope'; message: string }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'server'; status: number }
  | { kind: 'bad_response'; message: string }

export class DayoError extends Error {
  readonly failure: DayoFailure
  constructor(failure: DayoFailure) {
    super(`DAYO_${failure.kind.toUpperCase()}`)
    this.name = 'DayoError'
    this.failure = failure
  }
}

export type Timed<T> = { value: T; sentAtMs: number; receivedAtMs: number }
export type DayoClient = {
  getCatalog(knownVersion: number): Promise<Timed<PosCatalogLooseData>>
  push(body: PushRequest): Promise<Timed<PushResponseData>>
  listOrders(q: { from: string; to: string }): Promise<Timed<CentralOrder[]>>
}

/** plan 5 transport (fix M-4): setTimeout + AbortController, not AbortSignal.timeout, so tests can use fake timers. */
export const FETCH_TIMEOUT_MS = 20_000
const RATE_LIMIT_DEFAULT_MS = 60_000

export function createDayoClient(cfg: { baseUrl: string; apiKey: string; fetch: typeof fetch; nowMs: () => number }): DayoClient {
  const base = cfg.baseUrl.replace(/\/+$/, '') // plan 5 fix L-2
  async function call<T>(path: string, init: RequestInit, parse: (body: unknown) => T): Promise<Timed<T>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`timed out after ${FETCH_TIMEOUT_MS} ms`)), FETCH_TIMEOUT_MS)
    const sentAtMs = cfg.nowMs()
    let res: Response
    let text: string
    try {
      res = await cfg.fetch(`${base}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${cfg.apiKey}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
        signal: controller.signal,
      })
      // review item 11: the 20-second budget covers the BODY too — a connection that stalls mid-body must not hang
      // pushOnce (and with it every later scheduler wake) for ever.
      text = await res.text()
    } catch (e) {
      // offline, DNS, timeout (headers or body) — and in a browser also a response without CORS headers (spec §4.1)
      throw new DayoError({ kind: 'network', message: e instanceof Error ? e.message : String(e) })
    } finally {
      clearTimeout(timer)
    }
    const receivedAtMs = cfg.nowMs()
    let body: unknown = null
    try { body = text === '' ? null : JSON.parse(text) } catch { body = null }
    if (res.status === 401) throw new DayoError({ kind: 'unauthorized' })
    if (res.status === 403) throw new DayoError({ kind: 'forbidden' })
    if (res.status === 404) throw new DayoError({ kind: 'api_disabled' }) // any 404 under /api/v1 = API switched off (spec §4.1)
    if (res.status === 422) throw new DayoError({ kind: 'bad_envelope', message: ApiErrorBody.safeParse(body).data?.error.message ?? 'DY422' })
    if (res.status === 429) {
      const sec = Number(res.headers.get('retry-after'))
      throw new DayoError({ kind: 'rate_limited', retryAfterMs: Number.isFinite(sec) && sec > 0 ? sec * 1000 : RATE_LIMIT_DEFAULT_MS })
    }
    if (res.status >= 500 || res.status !== 200) throw new DayoError({ kind: 'server', status: res.status })
    try {
      return { value: parse(body), sentAtMs, receivedAtMs }
    } catch (e) {
      throw new DayoError({ kind: 'bad_response', message: e instanceof Error ? e.message.slice(0, 300) : 'unparseable' })
    }
  }
  return {
    getCatalog: (known) => call(`/pos/catalog?known_version=${Math.max(0, Math.trunc(known))}`, { method: 'GET' }, (b) => PosCatalogLooseResponse.parse(b).data), // `catalog` checked by the caller (R12)
    push: (body) => call('/pos/push', { method: 'POST', body: JSON.stringify(body) }, (b) => PushResponse.parse(b).data),
    listOrders: (q) => call(`/orders?from=${encodeURIComponent(q.from)}&to=${encodeURIComponent(q.to)}`, { method: 'GET' }, (b) => OrdersListResponse.parse(b).data),
  }
}
```

`apps/pos/src/sync/state.ts`:

```ts
import { eq, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { clipCodePoints } from '@dayo/contracts'

/** Every sync_state key of block 2 — local only, never in the outbox, no secret among them (the key is in IndexedDB). */
export const DAYO_KEYS = {
  baseUrl: 'dayo.base_url',
  apiState: 'dayo.api_state',
  apiRetryAt: 'dayo.api_retry_at',
  clockSkewMs: 'dayo.clock_skew_ms',
  clockMeasuredAt: 'dayo.clock_measured_at',
  clockAheadAt: 'dayo.clock_ahead_at',
  pricingJson: 'dayo.pricing_json',
  pricingMismatch: 'dayo.pricing_mismatch',
  supportedJson: 'dayo.supported_json',
  lastReceiptNo: 'dayo.last_receipt_no',
  catalogCheckedAt: 'dayo.catalog_checked_at',
  catalogError: 'dayo.catalog_error',
  pushFailStreak: 'dayo.push_fail_streak',
  pushBackoffUntil: 'dayo.push_backoff_until',
  pushBackoffReason: 'dayo.push_backoff_reason', // 'failure' (network/5xx — cleared by online/manual/open/before_close wakes) | 'rate_limited' (kept)
  pushSingleThrough: 'dayo.push_single_through',
  lastPushAt: 'dayo.last_push_at',
} as const
export type ApiState = 'ok' | 'unauthorized' | 'forbidden' | 'disabled'

export const CLOCK_WARN_MS = 5 * 60_000            // D80
export const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000, 900_000] as const // spec §6.3
export const STUCK_AFTER_ATTEMPTS = 50
export const API_DISABLED_RETRY_MS = 15 * 60_000
export const RATE_LIMIT_DEFAULT_MS = 60_000
export const NO_ANSWER_RETRY_MS = 60_000

export async function readKey(db: RemoteDb, key: string): Promise<string | null> {
  return (await db.select().from(s.syncState).where(eq(s.syncState.key, key)).get())?.value ?? null
}
export async function writeKey(db: RemoteDb, key: string, value: string): Promise<void> {
  await db.insert(s.syncState).values({ key, value }).onConflictDoUpdate({ target: s.syncState.key, set: { value: sql`excluded.value` } })
}
export async function deleteKey(db: RemoteDb, key: string): Promise<void> {
  await db.delete(s.syncState).where(eq(s.syncState.key, key))
}

/** attempt 1 → 5 s … attempt ≥ 5 → 15 min, ±20 % (spec §6.3). `random` in [0, 1). */
export function backoffMs(attempt: number, random: () => number): number {
  const base = BACKOFF_MS[Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1]!
  return Math.round(base * (0.8 + 0.4 * random()))
}

/** Server clock minus device clock, measured at the midpoint of the request. */
export function skewMs(serverTimeIso: string, sentAtMs: number, receivedAtMs: number): number {
  return Date.parse(serverTimeIso) - Math.round((sentAtMs + receivedAtMs) / 2)
}
export async function recordServerTime(db: RemoteDb, serverTimeIso: string, sentAtMs: number, receivedAtMs: number, nowIso: string): Promise<void> {
  await writeKey(db, DAYO_KEYS.clockSkewMs, String(skewMs(serverTimeIso, sentAtMs, receivedAtMs)))
  await writeKey(db, DAYO_KEYS.clockMeasuredAt, nowIso)
}

/** outbox.last_error is JSON (plan 5 I-12); the detail is clipped by code points so the JSON stays whole. */
export function encodeLastError(reason: string, detail: string, extra: { supportedHash?: string; farAhead?: true } = {}): string {
  return JSON.stringify({ reason: clipCodePoints(reason, 60), detail: clipCodePoints(detail, 500), ...extra })
}
export function decodeLastError(raw: string | null): { reason: string; detail: string; supportedHash?: string; farAhead?: true } {
  if (raw === null) return { reason: '', detail: '' }
  try {
    const p = JSON.parse(raw) as { reason?: unknown; detail?: unknown; supportedHash?: unknown; farAhead?: unknown }
    return { reason: typeof p.reason === 'string' ? p.reason : '', detail: typeof p.detail === 'string' ? p.detail : '', ...(typeof p.supportedHash === 'string' ? { supportedHash: p.supportedHash } : {}), ...(p.farAhead === true ? { farAhead: true as const } : {}) }
  } catch {
    return { reason: '', detail: raw }
  }
}
```

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test -- dayo-client secret-store` → PASS · `pnpm --filter @dayo/pos typecheck` → ผ่าน

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/sync/state.ts apps/pos/src/sync/secret-store.ts apps/pos/src/sync/dayo-client.ts apps/pos/test/dayo-client.test.ts apps/pos/test/secret-store.test.ts apps/pos/package.json pnpm-lock.yaml
git commit -m "feat(pos): talk to dayo's api and keep the device key out of the database"
```

---

### Task 10: ดึงแคตตาล็อกและพนักงาน (E1)

ผู้ทำ: sync-engineer (opus) · สเปก §3, §4.3, §4.4, §6.5, §6.7, §7 ข้อ 6 · รอ Task 8, 9, **A1, A3**

**ปรับตาม dayo (มีผลเหนือโค้ดข้างล่าง · สเปก §4.4 ข้อ 2, 6, 9, 12, 13 · §13.6 S1–S6)**:
- แคตตาล็อกทดสอบมี `sizes` 3 ขนาด (`22 oz` ปิด) · เทสต์ "keeps the old catalog when the new one cannot be priced" เปลี่ยนตัวกระตุ้นจาก `'24 oz'` (ตอนนี้เป็นขนาดที่ **ถูกรูป** schema รับ) เป็นขนาดผิดรูป `'big'` (หรือแคตตาล็อกไม่มี `sizes`) — ผลที่คาดคงเดิม (`catalog_rejected` · staff ยังถูกใช้)
- เพิ่มเทสต์: ร้านเปิดขนาดใหม่ `22 oz` (bump แคตตาล็อก: `sizes[2].isActive = true` + ตัวแปร `22 oz`) → `changed` (**ไม่ใช่** `catalog_rejected`) · `readCatalog().catalog.sizes` มี 3 ตัว
- เพิ่มเทสต์: E1 ที่ `categoryLabel: null` · `timeFrom: "17:00:00"` → `changed` และค่าที่เก็บ **ตรงตัว** (ไม่ตัดวินาที)
- `pricing.commit` เป็น `null` ได้ → เก็บใน `pricingJson` ตามที่ได้ · `pricingMismatch` เทียบ `files_sha256` เท่านั้น (เพิ่มเทสต์ `commit:null` + sha ตรง = `'0'`)
- `client.last_receipt_no` ไม่ตรวจรูปใน schema แล้ว (A1) — Task 10 เก็บค่าตามที่ได้ · การตรวจรูปอยู่ที่ Task 11/12

**Files:**
- Create: `apps/pos/src/sync/catalog.ts`
- Modify: `apps/pos/src/api/deps.ts`, `apps/pos/src/db/worker.ts`, `apps/pos/test/helpers/db.ts` (deps ใหม่ + **ตัวสร้าง id ในเทสต์เป็น UUID ตัวเล็ก** — review item 4)
- Test: `apps/pos/test/catalog-sync.test.ts` · แก้เทสต์เดิมที่ assert ค่า `id-000001` ให้ใช้รูปใหม่

**Interfaces:**
- Consumes: Task 8 `s.dayoCatalog`, `s.user` · Task 9 ทั้งหมด · `toPricingCatalog`, type `PosOrderCatalog` (Task 3) · `PosOrderCatalog` (zod), `StaffEntry`, `UserRole` (Task 5) · `@dayo/dayo-pricing/VENDOR.json`
- Produces:

```ts
// deps.ts — ApiDeps gains:
fetch: typeof fetch            // worker: globalThis.fetch bound · tests: mock.fetch
secrets: SecretStore           // worker: createIdbSecretStore() · tests: createMemorySecretStore()
random: () => number           // backoff jitter · tests: () => 0.5
afterWrite?: () => void        // Task 14 sets it to wake the sender 2 s after a save
// catalog.ts
export type SyncContext = { db: RemoteDb; deps: ApiDeps; serial: <T>(fn: () => Promise<T>) => Promise<T> }
export type StoredCatalog = { catalogVersion: number; catalog: PosOrderCatalog; staff: StaffEntry[]; client: { name: string; last_receipt_no: string | null } | null; fetchedAt: string }
export type CatalogPullResult = { outcome: 'changed' | 'unchanged' | 'catalog_rejected' | 'not_linked' | 'blocked' | 'failed'; failure?: DayoFailure }
export async function readDayoConfig(db: RemoteDb, deps: ApiDeps): Promise<{ baseUrl: string; apiKey: string } | null>
export async function readCatalog(db: RemoteDb): Promise<StoredCatalog | null>
export async function writeCatalogAnswer(tx: RemoteDb, deps: ApiDeps, data: PosCatalogLooseData, timing: { sentAtMs: number; receivedAtMs: number }): Promise<'changed' | 'unchanged' | 'catalog_rejected'> // no own transaction
export async function apiBlocked(db: RemoteDb, nowIso: string): Promise<boolean> // 401/403 state, or 404 before its retry time — no call to dayo at all (spec §6.3)
// test/helpers/db.ts
export function sequentialIds(): () => string   // '00000000-0000-4000-8000-000000000001', … — lowercase UUIDs so OrderRowData (Uuid) accepts them
export async function recordDayoFailure(db: RemoteDb, deps: ApiDeps, f: DayoFailure): Promise<void>
export async function pullCatalog(ctx: SyncContext): Promise<CatalogPullResult>
export async function readSupported(db: RemoteDb): Promise<Supported | null>
export function staffDisplayName(e: StaffEntry): string   // "" → "พนักงาน " + last 4 of id (spec §4.4 rule 5)
export function roleOf(raw: string): UserRole | null
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/test/catalog-sync.test.ts` (ใช้ `openTestApi` + mock ในโปรเซส + ตั้ง `dayo.base_url` และ key เอง เพราะ `connectShop` มาใน Task 11)

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { createMockDayo, MOCK_API_KEY } from '@dayo/dayo-mock'
import { pullCatalog, readCatalog, staffDisplayName } from '../src/sync/catalog'
import { DAYO_KEYS, readKey, writeKey } from '../src/sync/state'
import { openTestApi } from './helpers/db'

const PIN = 'argon2id$t=1,m=64,p=1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000'

async function linked(mockNow = '2026-09-25T02:00:00.120Z') {
  const mock = createMockDayo({ now: mockNow })
  const t = await openTestApi({ fetch: mock.fetch })
  await writeKey(t.db, DAYO_KEYS.baseUrl, 'http://mock/api/v1')
  await t.deps.secrets.setApiKey(MOCK_API_KEY)
  const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
  return { mock, t, ctx }
}

describe('pullCatalog (spec 04 §4.4, §6.5)', () => {
  it('stores the whole catalog in one row and remembers the version', async () => {
    const { ctx, t } = await linked()
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    const c = await readCatalog(t.db)
    expect(c?.catalogVersion).toBe(42)
    expect(c?.catalog.variants).toHaveLength(22)
    expect(c?.client?.name).toBe('แท็บเล็ตขาย 1')
  })
  it('asks with known_version and does not rewrite when unchanged', async () => {
    const { ctx, t } = await linked()
    await pullCatalog(ctx)
    const before = (await t.db.select().from(s.dayoCatalog).get())?.fetchedAt
    t.clock.advanceMs(60_000)
    expect((await pullCatalog(ctx)).outcome).toBe('unchanged')
    expect((await t.db.select().from(s.dayoCatalog).get())?.fetchedAt).toBe(before)
  })
  it('a new version replaces the copy', async () => {
    const { ctx, t, mock } = await linked()
    await pullCatalog(ctx)
    mock.bumpCatalog((c) => { c.catalog.variants[0]!.price = 40 })
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    expect((await readCatalog(t.db))?.catalog.variants[0]!.price).toBe(40)
  })
  it('measures the clock skew from server_time (D80)', async () => {
    const { ctx, t } = await linked('2026-09-25T03:10:00.000Z') // server 7 min ahead of the test clock (03:03)
    t.clock.set('2026-09-25T03:03:00.000Z')
    await pullCatalog(ctx)
    expect(Number(await readKey(t.db, DAYO_KEYS.clockSkewMs))).toBe(7 * 60_000)
  })
  it('flags a pricing version other than VENDOR.json (spec §4.4 rule 9)', async () => {
    const { ctx, t, mock } = await linked()
    await pullCatalog(ctx)
    expect(await readKey(t.db, DAYO_KEYS.pricingMismatch)).toBe('0')
    mock.bumpCatalog((c) => { c.pricing = { ...c.pricing, files_sha256: { ...c.pricing.files_sha256, 'packages/shared/src/money.ts': '0'.repeat(64) } } })
    await pullCatalog(ctx)
    expect(await readKey(t.db, DAYO_KEYS.pricingMismatch)).toBe('1')
  })
  it('keeps the old catalog when the new one cannot be priced — but still applies staff, supported_* and pricing (ruling R12)', async () => {
    const { ctx, t, mock } = await linked()
    await pullCatalog(ctx)
    const at = t.clock.now()
    await t.db.insert(s.user).values([
      { id: '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f', displayName: 'TungAo', role: 'owner', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 },
      { id: '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0', displayName: 'Mint', role: 'staff', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 },
    ])
    mock.bumpCatalog((c) => {
      (c.catalog.variants[0] as { size: string }).size = 'big'                                     // malformed size (not "<n> oz"): the schema refuses the catalog (ADR-0054 — '24 oz' would be a valid new size)
      c.staff = c.staff.map((x) => (x.display_name === 'Mint' ? { ...x, active: false } : x))   // …and Mint is removed the same day
    })
    expect((await pullCatalog(ctx)).outcome).toBe('catalog_rejected')
    expect((await readCatalog(t.db))?.catalogVersion).toBe(42)
    expect(await readKey(t.db, DAYO_KEYS.catalogError)).toMatch(/CATALOG_UNREADABLE/)
    expect((await t.db.select().from(s.user).where(eq(s.user.id, '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0')).get())?.isActive).toBe(false)
  })
  it('401 marks the key as revoked and no later pull calls dayo (spec §6.3)', async () => {
    const { ctx, t, mock } = await linked()
    mock.setMode('unauthorized')
    expect((await pullCatalog(ctx)).failure?.kind).toBe('unauthorized')
    expect(await readKey(t.db, DAYO_KEYS.apiState)).toBe('unauthorized')
    const calls = mock.requests().length
    expect((await pullCatalog(ctx)).outcome).toBe('blocked')
    expect(mock.requests().length).toBe(calls)
  })
})

describe('staff from E1 (spec 04 §4.4 rule 5, §6.5, ruling R7/R10/R12)', () => {
  it('updates name/role/active of users that have a PIN, and disables users dayo does not list', async () => {
    const { ctx, t, mock } = await linked()
    const at = t.clock.now()
    await t.db.insert(s.user).values([
      { id: '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f', displayName: 'TungAo', role: 'owner', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 },
      { id: '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0', displayName: 'old name', role: 'staff', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 },
      { id: 'legacy-owner', displayName: 'TungAo (plan 3)', role: 'owner', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 },
    ])
    await pullCatalog(ctx)
    const rows = await t.db.select().from(s.user).all()
    expect(rows.find((u) => u.id.startsWith('1b2c'))).toMatchObject({ displayName: 'Mint', isActive: true })
    expect(rows.find((u) => u.id === 'legacy-owner')).toMatchObject({ isActive: false })
    mock.bumpCatalog((c) => { c.staff = c.staff.map((x) => (x.display_name === 'Mint' ? { ...x, active: false } : x)) })
    await pullCatalog(ctx)
    expect((await t.db.select().from(s.user).where(eq(s.user.id, '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0')).get())?.isActive).toBe(false)
  })
  it('a staff list without any active owner is not applied (review item 9)', async () => {
    const { ctx, t, mock } = await linked()
    const at = t.clock.now()
    await t.db.insert(s.user).values({ id: '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f', displayName: 'TungAo', role: 'owner', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 })
    mock.bumpCatalog((c) => { c.staff = [] })
    await pullCatalog(ctx)
    expect((await t.db.select().from(s.user).where(eq(s.user.id, '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f')).get())?.isActive).toBe(true)
    expect(await readKey(t.db, DAYO_KEYS.catalogError)).toMatch(/NO_ACTIVE_OWNER/)
  })
  it.each([['deactivated', { active: false }], ['demoted', { role: 'staff' }]] as const)('the last owner with a PIN who is %s in dayo loses owner rights here at once (ruling N2)', async (_, change) => {
    const { ctx, t, mock } = await linked()
    const at = t.clock.now()
    await t.db.insert(s.user).values({ id: '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f', displayName: 'TungAo', role: 'owner', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 })
    mock.bumpCatalog((c) => { c.staff = c.staff.map((x) => (x.display_name === 'TungAo' ? { ...x, ...change } : x)) }) // DCm stays an active owner in dayo (no PIN here)
    await pullCatalog(ctx)
    const u = await t.db.select().from(s.user).where(eq(s.user.id, '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f')).get()
    expect(u!.isActive && u!.role === 'owner').toBe(false)
  })
  it('an empty display name shows as "พนักงาน" + the last 4 of the id', () => {
    expect(staffDisplayName({ id: '4e5f6071-8293-44a5-b6c7-d8e9f0a1b2c3', display_name: '', role: 'staff', active: true })).toBe('พนักงาน b2c3')
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos test -- catalog-sync` · คาดว่า FAIL

- [ ] **Step 3: เขียนโค้ด**

`apps/pos/src/api/deps.ts` เพิ่มฟิลด์ตาม Interfaces · `apps/pos/src/db/worker.ts` ส่ง `fetch: (input, init) => fetch(input, init)`, `secrets: createIdbSecretStore()`, `random: Math.random` · `apps/pos/test/helpers/db.ts`: `openTestApi(opts: { fetch?: typeof fetch } = {})` ส่ง `fetch: opts.fetch ?? (async () => { throw new TypeError('offline in tests') })`, `secrets: createMemorySecretStore()`, `random: () => 0.5` · และตัวสร้าง id (review item 4 — ห้ามผ่อน schema ให้รับ id ที่ไม่ใช่ UUID):

```ts
/** Deterministic lowercase UUIDs for tests — every id the app writes must pass the contract's Uuid (spec §4.1). */
export function sequentialIds(): () => string {
  let n = 0
  return () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`
}
```

แก้เทสต์เดิมที่ assert ค่าแบบ `id-000001` ให้เป็นรูปนี้ (`grep -rn "id-0" apps/pos/test apps/pos/src`)

`apps/pos/src/sync/catalog.ts`:

```ts
import { and, eq, notInArray } from 'drizzle-orm'
import { z } from 'zod'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { PosOrderCatalog as PosOrderCatalogSchema, StaffEntry, UserRole, type PosCatalogLooseData, type Supported } from '@dayo/contracts'
import { toPricingCatalog, type PosOrderCatalog } from '@dayo/domain'
import vendor from '@dayo/dayo-pricing/VENDOR.json'
import type { ApiDeps } from '../api/deps'
import { createDayoClient, DayoError, type DayoFailure } from './dayo-client'
import { API_DISABLED_RETRY_MS, DAYO_KEYS, deleteKey, readKey, recordServerTime, writeKey } from './state'

export type SyncContext = { db: RemoteDb; deps: ApiDeps; serial: <T>(fn: () => Promise<T>) => Promise<T> }
export type StoredCatalog = { catalogVersion: number; catalog: PosOrderCatalog; staff: StaffEntry[]; client: { name: string; last_receipt_no: string | null } | null; fetchedAt: string }
export type CatalogPullResult = { outcome: 'changed' | 'unchanged' | 'catalog_rejected' | 'not_linked' | 'blocked' | 'failed'; failure?: DayoFailure }

export async function readDayoConfig(db: RemoteDb, deps: ApiDeps): Promise<{ baseUrl: string; apiKey: string } | null> {
  const baseUrl = await readKey(db, DAYO_KEYS.baseUrl)
  const apiKey = await deps.secrets.getApiKey()
  return baseUrl === null || apiKey === null ? null : { baseUrl, apiKey }
}

let cache: { fetchedAt: string; value: StoredCatalog } | null = null
/** The local copy of E1, parsed once per fetch (the catalog is ~200 KB; recordSale reads it on every bill). */
export async function readCatalog(db: RemoteDb): Promise<StoredCatalog | null> {
  const row = await db.select().from(s.dayoCatalog).where(eq(s.dayoCatalog.id, 'current')).get()
  if (!row) return null
  if (cache?.fetchedAt === row.fetchedAt) return cache.value
  const value: StoredCatalog = {
    catalogVersion: row.catalogVersion,
    catalog: toPricingCatalog(PosOrderCatalogSchema.parse(row.catalogJson)),
    staff: z.array(StaffEntry).parse(row.staffJson),
    client: (row.clientJson as StoredCatalog['client']) ?? null,
    fetchedAt: row.fetchedAt,
  }
  cache = { fetchedAt: row.fetchedAt, value }
  return value
}

export async function readSupported(db: RemoteDb): Promise<Supported | null> {
  const raw = await readKey(db, DAYO_KEYS.supportedJson)
  return raw === null ? null : (JSON.parse(raw) as Supported)
}

export function staffDisplayName(e: StaffEntry): string {
  const n = e.display_name?.trim() ?? ''
  return n !== '' ? n : `พนักงาน ${e.id.slice(-4)}`
}
export function roleOf(raw: string): UserRole | null {
  const r = UserRole.safeParse(raw)
  return r.success ? r.data : null
}

function samePricing(files: Record<string, string>): boolean {
  const want = (vendor as { files: Record<string, string> }).files
  const a = Object.keys(want).sort()
  return JSON.stringify(a) === JSON.stringify(Object.keys(files).sort()) && a.every((k) => files[k] === want[k])
}

/**
 * dayo is the one writer of name/role/active; the PIN hash stays local (spec 04 §3, §6.5). No transaction of its own.
 * Review item 9: a list with no active owner is a dayo bug, not a decision — it is not applied (the caller records
 * catalogError). Otherwise dayo's list wins at once (controller ruling N2): an owner dayo deactivated or demoted loses
 * owner rights here even when they were the last owner with a PIN — the tablet then offers "เชื่อมใหม่ด้วยคีย์ใหม่"
 * (`recoverOwner`, Task 11) instead of keeping a removed owner's power.
 */
async function applyStaff(tx: RemoteDb, deps: ApiDeps, staff: StaffEntry[], at: string): Promise<'applied' | 'no_active_owner'> {
  if (!staff.some((e) => e.active && roleOf(e.role) === 'owner')) return 'no_active_owner'
  for (const e of staff) {
    const u = await tx.select().from(s.user).where(eq(s.user.id, e.id)).get()
    if (!u) continue // no PIN yet on this tablet → listed as "ต้องตั้ง PIN" (Task 11)
    const role = roleOf(e.role)
    const next = { displayName: staffDisplayName(e), role: role ?? u.role, isActive: e.active && role !== null } // ruling R10
    if (next.displayName === u.displayName && next.role === u.role && next.isActive === u.isActive) continue
    await tx.update(s.user).set({ ...next, updatedAt: at, version: u.version + 1 }).where(eq(s.user.id, u.id))
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'user', entityId: u.id, action: 'update', beforeJson: { displayName: u.displayName, role: u.role, isActive: u.isActive }, afterJson: { ...next, source: 'dayo' }, actorUserId: null, at })
  }
  // users dayo does not list (plan-3 owners with random ids, deleted staff) can no longer log in (ruling R7)
  const listed = staff.map((e) => e.id)
  const stale = await tx.select().from(s.user).where(and(eq(s.user.isActive, true), notInArray(s.user.id, listed))).all()
  for (const u of stale) {
    await tx.update(s.user).set({ isActive: false, updatedAt: at, version: u.version + 1 }).where(eq(s.user.id, u.id))
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'user', entityId: u.id, action: 'deactivate', beforeJson: { isActive: true }, afterJson: { isActive: false, source: 'dayo: not in the staff list' }, actorUserId: null, at })
  }
  return 'applied'
}

/** spec §6.3: 401/403 stop EVERY call to dayo (catalog, push, E3) until a new key; 404 waits for its retry time. */
export async function apiBlocked(db: RemoteDb, nowIso: string): Promise<boolean> {
  const state = await readKey(db, DAYO_KEYS.apiState)
  if (state === 'unauthorized' || state === 'forbidden') return true
  return state === 'disabled' && ((await readKey(db, DAYO_KEYS.apiRetryAt)) ?? '') > nowIso
}

/**
 * ruling R12: staff, supported_*, pricing and server_time are applied from EVERY answer; `catalog` is checked on its
 * own, and one the pricing code cannot read keeps the old copy (catalog_version unchanged, so the next pull asks again).
 */
export async function writeCatalogAnswer(tx: RemoteDb, deps: ApiDeps, data: PosCatalogLooseData, timing: { sentAtMs: number; receivedAtMs: number }): Promise<'changed' | 'unchanged' | 'catalog_rejected'> {
  const at = deps.now()
  await recordServerTime(tx, data.server_time, timing.sentAtMs, timing.receivedAtMs, at)
  await writeKey(tx, DAYO_KEYS.pricingJson, JSON.stringify(data.pricing))
  await writeKey(tx, DAYO_KEYS.pricingMismatch, samePricing(data.pricing.files_sha256) ? '0' : '1')
  await writeKey(tx, DAYO_KEYS.supportedJson, JSON.stringify({ kinds: data.supported_kinds, fields: data.supported_fields }))
  await writeKey(tx, DAYO_KEYS.apiState, 'ok')
  await deleteKey(tx, DAYO_KEYS.apiRetryAt)
  await writeKey(tx, DAYO_KEYS.catalogCheckedAt, at)
  if (!data.changed) return 'unchanged'
  const problems: string[] = []
  if ((await applyStaff(tx, deps, data.staff, at)) === 'no_active_owner') problems.push('NO_ACTIVE_OWNER: the staff list from dayo has no active owner — not applied')
  const catalog = PosOrderCatalogSchema.safeParse(data.catalog)
  if (!catalog.success) {
    problems.push(`CATALOG_UNREADABLE: ${catalog.error.issues.slice(0, 3).map((i) => i.path.join('.')).join(', ')}`)
    // keep catalog_json / catalog_version; the staff copy used by "ต้องตั้ง PIN" follows dayo anyway
    await tx.update(s.dayoCatalog).set({ staffJson: data.staff, clientJson: data.client }).where(eq(s.dayoCatalog.id, 'current'))
  } else {
    const row = { id: 'current', catalogVersion: data.catalog_version, catalogJson: catalog.data, staffJson: data.staff, clientJson: data.client, fetchedAt: at }
    await tx.insert(s.dayoCatalog).values(row).onConflictDoUpdate({ target: s.dayoCatalog.id, set: { catalogVersion: row.catalogVersion, catalogJson: row.catalogJson, staffJson: row.staffJson, clientJson: row.clientJson, fetchedAt: at } })
  }
  if (problems.length > 0) await writeKey(tx, DAYO_KEYS.catalogError, problems.join(' · '))
  else await deleteKey(tx, DAYO_KEYS.catalogError)
  return catalog.success ? 'changed' : 'catalog_rejected'
}

export async function recordDayoFailure(db: RemoteDb, deps: ApiDeps, f: DayoFailure): Promise<void> {
  if (f.kind === 'unauthorized') await writeKey(db, DAYO_KEYS.apiState, 'unauthorized')
  else if (f.kind === 'forbidden') await writeKey(db, DAYO_KEYS.apiState, 'forbidden')
  else if (f.kind === 'api_disabled') {
    await writeKey(db, DAYO_KEYS.apiState, 'disabled')
    await writeKey(db, DAYO_KEYS.apiRetryAt, new Date(Date.parse(deps.now()) + API_DISABLED_RETRY_MS).toISOString())
  } else if (f.kind === 'bad_response') await writeKey(db, DAYO_KEYS.catalogError, f.message)
  // network / server / rate_limited: nothing to remember here — the scheduler backs off (Task 14)
}

export async function pullCatalog(ctx: SyncContext): Promise<CatalogPullResult> {
  const cfg = await ctx.serial(() => readDayoConfig(ctx.db, ctx.deps))
  if (cfg === null) return { outcome: 'not_linked' }
  if (await ctx.serial(() => apiBlocked(ctx.db, ctx.deps.now()))) return { outcome: 'blocked' } // review item 14
  const known = await ctx.serial(async () => (await readCatalog(ctx.db))?.catalogVersion ?? 0)
  const client = createDayoClient({ ...cfg, fetch: ctx.deps.fetch, nowMs: () => Date.parse(ctx.deps.now()) })
  try {
    const r = await client.getCatalog(known) // network outside the serial queue
    return { outcome: await ctx.serial(() => ctx.db.transaction((tx) => writeCatalogAnswer(tx, ctx.deps, r.value, r))) }
  } catch (e) {
    if (!(e instanceof DayoError)) throw e
    await ctx.serial(() => recordDayoFailure(ctx.db, ctx.deps, e.failure))
    return { outcome: 'failed', failure: e.failure }
  }
}
```

(สังเกต: `createDayoClient.getCatalog` ตรวจแบบ `PosCatalogLooseResponse` — `catalog` ที่อ่านไม่ได้ไม่ทำให้ทั้งคำตอบเป็น `bad_response` อีก (R12) · `bad_response` เหลือเฉพาะเมื่อส่วนอื่น (staff/pricing/…) ผิดรูป)

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test` → PASS ทั้งแพ็กเกจ · `pnpm --filter @dayo/pos typecheck` → ผ่าน

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/sync/catalog.ts apps/pos/src/api/deps.ts apps/pos/src/db/worker.ts apps/pos/test/helpers/db.ts apps/pos/test/catalog-sync.test.ts
git commit -m "feat(pos): pull dayo's catalog and staff into the tablet"
```

---

### Task 11: ตั้งเครื่องด้วย API key · เชื่อมเครื่องเดิม · ตั้ง PIN พนักงาน

ผู้ทำ: sync-engineer (opus) · ผู้ตรวจเพิ่ม: **security-reviewer** · สเปก §6.5, §6.6, §6.9, §7 ข้อ 1/2/5/6, §12 Q44 · ruling R7, R10 · รอ Task 7, 10

**ปรับตาม dayo (มีผลเหนือโค้ดข้างล่าง · สเปก §4.4 ข้อ 6 · §6.6 · §13.6 S6)**: `client.last_receipt_no` เป็น `external_ref` ดิบของ dayo — schema ไม่ตรวจรูปแล้ว (A1) · ทุกจุดที่เรียก `parseReceiptNo(last)` (`probeDayo`, `connectShop`, `replaceApiKey`, `recoverOwner` — ทุกที่ที่อ่าน `v.client.last_receipt_no`) ต้องตรวจรูป `^[A-Z]{1,3}-\d{6}$` ก่อน: ผิดรูป = `PosError('DAYO_RECEIPT_NO_INVALID')` (เพิ่มใน `api/errors.ts` · ข้อความไทยใน `ui/th.ts` เป็นงานของ Task 17) · **ไม่เขียน** `dayo.last_receipt_no` และไม่ตั้ง prefix เอง · เพิ่มเทสต์ `last_receipt_no: 'L260924-014'` → error นี้ และไม่มีแถวใน `sync_state` · `probe.pricingMatches` เทียบ `files_sha256` เท่านั้น (`pricing.commit` null ได้)

**Files:**
- Create: `apps/pos/src/api/connect.ts`, `apps/pos/src/api/staff.ts`
- Modify: `apps/pos/src/api/bootstrap.ts`, `apps/pos/src/api/types.ts`, `apps/pos/src/api/pos-api.ts`, `apps/pos/src/api/errors.ts` (รหัสใหม่เท่านั้น — ข้อความไทยของรหัสเหล่านี้เป็นงานของสาย D ใน Task 17), `apps/pos/test/helpers/db.ts`
- Test: `apps/pos/test/connect.test.ts`, `apps/pos/test/staff-pin.test.ts`, `apps/pos/test/helpers/dayo.ts`

**Interfaces:**
- Consumes: Task 10 `writeCatalogAnswer`, `readCatalog`, `staffDisplayName`, `roleOf` · Task 9 `createDayoClient`, `DayoError`, `DAYO_KEYS`, `writeKey` · `API_KEY_RE`, `RECEIPT_NO_RE` (Task 5) · `hashPin`, `requireOwnerPin` (เดิม)
- Produces (Task 14, 17 ใช้):

```ts
export type DayoProbeInput = { baseUrl: string; apiKey: string }
export type DayoProbe = { clientName: string; lastReceiptNo: string | null; requiredPrefix: string | null; catalogVersion: number; owners: { id: string; displayName: string }[]; pricingMatches: boolean }
export type ConnectShopInput = { baseUrl: string; apiKey: string; receiptPrefix: string; ownerStaffId: string; ownerPin: string; promptPayId: string; legacyApproval: { userId: string; pin: string } | null }
export type StaffOptionDto = { id: string; displayName: string; role: UserRole }
export type SetStaffPinInput = { staffId: string; pin: string; approverUserId: string; approverPin: string }
export type ReplaceApiKeyInput = { baseUrl: string; apiKey: string; approverUserId: string; approverPin: string }
export type RecoverOwnerInput = { baseUrl: string; apiKey: string; ownerStaffId: string; ownerPin: string }   // ruling N2 — no approver: the new key is the proof
// PosApi gains: probeDayo(i): Promise<DayoProbe> · connectShop(i): Promise<void> · setStaffPin(i): Promise<UserDto> · replaceApiKey(i): Promise<void>  (spec §6.3: after a 401 the owner sets a new key) · recoverOwner(i): Promise<void>
// BootstrapState gains: legacyDevice: boolean · dayoLinked: boolean · staffNeedingPin: StaffOptionDto[] · ownerRecovery: boolean  (needsSetup = !device || !dayoLinked · ownerRecovery = dayoLinked && recoverOwner is allowed now)
// PosErrorCode gains: 'DAYO_BAD_KEY' | 'DAYO_KEY_NO_SCOPE' | 'DAYO_API_DISABLED' | 'DAYO_UNREACHABLE' | 'DAYO_BAD_RESPONSE' | 'NO_CATALOG' | 'RECOVERY_NOT_ALLOWED' | 'KEY_NOT_NEW' | 'OLD_KEY_STILL_ACTIVE'
export function normalizeBaseUrl(raw: string): string   // https://…/api/v1, or http://localhost|127.0.0.1:<port>/api/v1 (dev + e2e)
// test/helpers/dayo.ts
export async function openConnectedApi(opts?: { now?: string }): Promise<ReadyApi & { mock: MockDayo }> // TungAo (owner, PIN 1111) + DCm (owner, PIN 2222) + open shift
export const STAFF: { TungAo: string; DCm: string; Beam: string; Mint: string; Unnamed: string; Old: string }  // UUIDs of packages/contracts/fixtures/pos-test/e1-catalog-rich.json
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/test/connect.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { createMockDayo, MOCK_API_KEY } from '@dayo/dayo-mock'
import { posErrorCode } from '../src/api/errors'
import { pullCatalog } from '../src/sync/catalog'
import { DAYO_KEYS, readKey, writeKey } from '../src/sync/state'
import { openTestApi, vacuumInto } from './helpers/db'
import { STAFF } from './helpers/dayo'

const INPUT = { baseUrl: 'http://localhost:8787/api/v1/', apiKey: MOCK_API_KEY, receiptPrefix: 'A', ownerStaffId: STAFF.TungAo, ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null }
async function fresh() { const mock = createMockDayo({ now: '2026-09-25T02:00:00.120Z' }); return { mock, t: await openTestApi({ fetch: mock.fetch }) } }
async function codeOf(p: Promise<unknown>) { try { await p; return null } catch (e) { return posErrorCode(e) } }

describe('probeDayo (spec 04 §7 ข้อ 1: test the key with E1 before saving it)', () => {
  it('names the device and lists the owners to choose from', async () => {
    const { t } = await fresh()
    const p = await t.api.probeDayo({ baseUrl: INPUT.baseUrl, apiKey: MOCK_API_KEY })
    expect(p).toMatchObject({ clientName: 'แท็บเล็ตขาย 1', lastReceiptNo: null, requiredPrefix: null, catalogVersion: 42, pricingMatches: true })
    expect(p.owners.map((o) => o.displayName)).toEqual(['TungAo', 'DCm'])
  })
  it.each([
    ['unauthorized', 'DAYO_BAD_KEY'], ['forbidden', 'DAYO_KEY_NO_SCOPE'], ['api_disabled', 'DAYO_API_DISABLED'], ['server_down', 'DAYO_UNREACHABLE'],
  ] as const)('mode %s → %s', async (mode, code) => {
    const { t, mock } = await fresh()
    mock.setMode(mode)
    expect(await codeOf(t.api.probeDayo({ baseUrl: INPUT.baseUrl, apiKey: MOCK_API_KEY }))).toBe(code)
  })
  it.each(['ftp://x/api/v1', 'http://dayo.example.com/api/v1', 'https://dayo.example.com/'])('refuses base URL %s', async (baseUrl) => {
    const { t } = await fresh()
    expect(await codeOf(t.api.probeDayo({ baseUrl, apiKey: MOCK_API_KEY }))).toBe('BAD_INPUT')
  })
})

describe('connectShop', () => {
  it('registers the device from E1 and the chosen owner with a local PIN', async () => {
    const { t } = await fresh()
    await t.api.connectShop(INPUT)
    const boot = await t.api.bootstrap()
    expect(boot).toMatchObject({ needsSetup: false, dayoLinked: true, legacyDevice: false, device: { name: 'แท็บเล็ตขาย 1', receiptPrefix: 'A' } })
    expect(boot.users).toEqual([{ id: STAFF.TungAo, displayName: 'TungAo', role: 'owner' }])
    expect(boot.staffNeedingPin.map((x) => x.displayName)).toEqual(['DCm', 'Beam', 'Mint', 'พนักงาน b2c3'])
    expect(await t.api.login(STAFF.TungAo, '1111')).toMatchObject({ role: 'owner' })
  })
  it('the API key is in the secret store and NOT in the SQLite file a backup exports (spec §6.9, §7)', async () => {
    const { t } = await fresh()
    await t.api.connectShop(INPUT)
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
    expect(Buffer.from(vacuumInto(t.raw)).includes(Buffer.from(MOCK_API_KEY.slice(5)))).toBe(false)
  })
  it('keeps the receipt numbering of a reinstalled device (spec §6.6)', async () => {
    const { t, mock } = await fresh()
    mock.bumpCatalog((c) => { c.client = { ...c.client, last_receipt_no: 'B-000311' } })
    expect(await codeOf(t.api.connectShop(INPUT))).toBe('BAD_INPUT') // prefix A ≠ B
    await t.api.connectShop({ ...INPUT, receiptPrefix: 'B' })
    expect(await t.db.select().from(s.syncState).all()).toContainEqual({ key: 'dayo.last_receipt_no', value: 'B-000311' })
  })
  it('only an active owner from the dayo list may be the first owner', async () => {
    const { t } = await fresh()
    expect(await codeOf(t.api.connectShop({ ...INPUT, ownerStaffId: STAFF.Mint }))).toBe('BAD_INPUT')
  })
  it('a failed save leaves no key behind', async () => {
    const { t } = await fresh()
    expect(await codeOf(t.api.connectShop({ ...INPUT, promptPayId: 'nope' }))).toBe('BAD_INPUT')
    expect(await t.deps.secrets.getApiKey()).toBeNull()
  })
  it('after a 401 the owner sets a new key for the same receipt prefix (spec §6.3 row 401)', async () => {
    let active = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const t = await openTestApi({ fetch: (input, init) => active.fetch(input, init) })
    await t.api.connectShop(INPUT)
    await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized')
    const newKey = `dayo_${'a'.repeat(64)}`
    active = createMockDayo({ apiKey: newKey, now: '2026-09-25T02:00:00.120Z' })
    expect(await codeOf(t.api.replaceApiKey({ baseUrl: INPUT.baseUrl, apiKey: newKey, approverUserId: STAFF.TungAo, approverPin: '0000' }))).toBe('PIN_WRONG')
    await t.api.replaceApiKey({ baseUrl: INPUT.baseUrl, apiKey: newKey, approverUserId: STAFF.TungAo, approverPin: '1111' })
    expect(await t.deps.secrets.getApiKey()).toBe(newKey)
    expect(await readKey(t.db, DAYO_KEYS.apiState)).toBe('ok')
  })
  it('a plan-3/4 device links with an old owner PIN and keeps its prefix (ruling R7)', async () => {
    const { t } = await fresh()
    await t.api.setupShop({ deviceName: 'เครื่องเดิม', receiptPrefix: 'A', owners: [{ displayName: 'TungAo', pin: '9999' }], promptPayId: '0812345678' }) // the old API still exists until Task 22
    const old = (await t.api.bootstrap()).users[0]!
    expect((await t.api.bootstrap())).toMatchObject({ needsSetup: true, legacyDevice: true })
    expect(await codeOf(t.api.connectShop(INPUT))).toBe('ALREADY_SET_UP')
    await t.api.connectShop({ ...INPUT, legacyApproval: { userId: old.id, pin: '9999' } })
    const boot = await t.api.bootstrap()
    expect(boot.users.map((u) => u.id)).toEqual([STAFF.TungAo]) // the random-id plan-3 owner is disabled
    expect(boot.device?.name).toBe('เครื่องเดิม')
  })
  it('replaceApiKey refuses an approver dayo no longer lists as an active owner (ruling N2)', async () => {
    let active = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const t = await openTestApi({ fetch: (input, init) => active.fetch(input, init) })
    await t.api.connectShop(INPUT)
    await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized') // the tablet never saw TungAo's removal: the old key was revoked first
    const newKey = `dayo_${'a'.repeat(64)}`
    active = createMockDayo({ apiKey: newKey, now: '2026-09-25T02:00:00.120Z' })
    active.bumpCatalog((c) => { c.staff = c.staff.map((x) => (x.id === STAFF.TungAo ? { ...x, active: false } : x)) })
    expect(await codeOf(t.api.replaceApiKey({ baseUrl: INPUT.baseUrl, apiKey: newKey, approverUserId: STAFF.TungAo, approverPin: '1111' }))).toBe('NOT_OWNER')
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
    expect((await t.api.bootstrap()).ownerRecovery).toBe(true) // key refused → recovery is offered
  })
})

/**
 * ruling N2: TungAo is the only owner with a PIN; dayo deactivates him. The owner logs in to the dayo web with LINE,
 * issues a new key, revokes the old one, then enters the new key here and gives DCm (an active dayo owner) a PIN.
 */
describe('recoverOwner — "เชื่อมใหม่ด้วยคีย์ใหม่" (ruling N2)', () => {
  const NEW_KEY = `dayo_${'b'.repeat(64)}`
  const REC = { baseUrl: INPUT.baseUrl, apiKey: NEW_KEY, ownerStaffId: STAFF.DCm, ownerPin: '2468' }
  const withoutTungAo = (c: { staff: { id: string; active: boolean }[] }) => { c.staff = c.staff.map((x) => (x.id === STAFF.TungAo ? { ...x, active: false } : x)) }
  /** Two dayo keys: the old one (MOCK_API_KEY) and the new one — requests go to the mock of the key they carry. */
  async function lockedOut() {
    const oldKey = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const newKey = createMockDayo({ apiKey: NEW_KEY, now: '2026-09-25T02:00:00.120Z' })
    const route: typeof fetch = (input, init) => (new Headers(init?.headers).get('Authorization') === `Bearer ${NEW_KEY}` ? newKey : oldKey).fetch(input, init)
    const t = await openTestApi({ fetch: route })
    await t.api.connectShop(INPUT)
    // a bill still waiting to be sent (Task 12 does not exist yet — the row is written directly; recovery must keep it)
    await t.db.insert(s.outbox).values({ id: 'ob-1', tableName: 'order', rowJson: { receipt_no: 'A-000001' }, idempotencyKey: 'order:x', status: 'pending', createdAt: '2026-09-25T02:00:00.000Z', attempts: 0 })
    oldKey.bumpCatalog(withoutTungAo); newKey.bumpCatalog(withoutTungAo)
    await pullCatalog({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    return { t, oldKey, newKey }
  }
  it('is offered once no active owner with a PIN is left', async () => {
    const { t } = await lockedOut()
    const boot = await t.api.bootstrap()
    expect(boot.users.some((u) => u.role === 'owner')).toBe(false)
    expect(boot.ownerRecovery).toBe(true)
    expect(await codeOf(t.api.setStaffPin({ staffId: STAFF.DCm, pin: '2468', approverUserId: STAFF.TungAo, approverPin: '1111' }))).not.toBeNull() // the removed owner approves nothing
  })
  it('refuses while an owner with a PIN can still approve and the key works', async () => {
    const { t } = await fresh()
    await t.api.connectShop(INPUT)
    expect((await t.api.bootstrap()).ownerRecovery).toBe(false)
    expect(await codeOf(t.api.recoverOwner(REC))).toBe('RECOVERY_NOT_ALLOWED')
  })
  it('needs a NEW key, and the old key revoked on the web first', async () => {
    const { t, oldKey } = await lockedOut()
    expect(await codeOf(t.api.recoverOwner({ ...REC, apiKey: MOCK_API_KEY }))).toBe('KEY_NOT_NEW')
    expect(await codeOf(t.api.recoverOwner(REC))).toBe('OLD_KEY_STILL_ACTIVE')
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
    oldKey.setMode('unauthorized') // the owner revoked it on the dayo web
    await t.api.recoverOwner(REC)
    expect(await t.deps.secrets.getApiKey()).toBe(NEW_KEY)
  })
  it('only an active dayo owner can be chosen, and the receipt prefix of the device stays', async () => {
    const { t, oldKey, newKey } = await lockedOut()
    oldKey.setMode('unauthorized')
    expect(await codeOf(t.api.recoverOwner({ ...REC, ownerStaffId: STAFF.TungAo }))).toBe('BAD_INPUT') // deactivated in dayo
    expect(await codeOf(t.api.recoverOwner({ ...REC, ownerStaffId: STAFF.Beam }))).toBe('BAD_INPUT')   // a manager
    newKey.bumpCatalog((c) => { c.client = { ...c.client, last_receipt_no: 'B-000009' } })
    expect(await codeOf(t.api.recoverOwner(REC))).toBe('BAD_INPUT') // this key belongs to a B- device
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
  })
  it('gives the chosen owner a PIN, keeps the device and every queued row, and writes the audit trail without secrets', async () => {
    const { t, oldKey } = await lockedOut()
    const deviceBefore = (await t.api.bootstrap()).device
    const outboxBefore = await t.db.select().from(s.outbox).all()
    oldKey.setMode('unauthorized')
    await t.api.recoverOwner(REC)
    const boot = await t.api.bootstrap()
    expect(boot).toMatchObject({ ownerRecovery: false, needsSetup: false, device: deviceBefore })
    expect(await t.api.login(STAFF.DCm, '2468')).toMatchObject({ role: 'owner' })
    expect(await t.db.select().from(s.outbox).all()).toEqual(outboxBefore)
    expect(await readKey(t.db, DAYO_KEYS.apiState)).toBe('ok')
    const audit = JSON.stringify(t.raw.prepare(`select action, after_json from audit_log where action in ('owner_recovered', 'api_key_replaced')`).all())
    expect(audit).toMatch(/owner_recovered/)
    expect(audit.includes(NEW_KEY.slice(5)) || audit.includes('2468')).toBe(false)
  })
  it('also works when the key was revoked before the tablet saw the owner change (apiState unauthorized)', async () => {
    const { t } = await fresh()
    await t.api.connectShop(INPUT)
    await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized')
    expect((await t.api.bootstrap()).ownerRecovery).toBe(true)
  })
})
```

`apps/pos/test/staff-pin.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { posErrorCode } from '../src/api/errors'
import { openConnectedApi, STAFF } from './helpers/dayo'

describe('setStaffPin (spec 04 §6.5: a new staff member gets a PIN approved by an owner PIN)', () => {
  it('Mint can log in after an owner sets her PIN', async () => {
    const t = await openConnectedApi()
    await t.api.setStaffPin({ staffId: STAFF.Mint, pin: '4321', approverUserId: STAFF.TungAo, approverPin: '1111' })
    expect(await t.api.login(STAFF.Mint, '4321')).toMatchObject({ displayName: 'Mint', role: 'staff' })
    expect((await t.api.bootstrap()).staffNeedingPin.map((x) => x.displayName)).not.toContain('Mint')
  })
  it('needs an owner PIN, not a manager one', async () => {
    const t = await openConnectedApi()
    await t.api.setStaffPin({ staffId: STAFF.Beam, pin: '5555', approverUserId: STAFF.TungAo, approverPin: '1111' })
    try { await t.api.setStaffPin({ staffId: STAFF.Mint, pin: '4321', approverUserId: STAFF.Beam, approverPin: '5555' }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('NOT_OWNER') }
  })
  it('refuses a removed staff member', async () => {
    const t = await openConnectedApi()
    try { await t.api.setStaffPin({ staffId: STAFF.Old, pin: '4321', approverUserId: STAFF.TungAo, approverPin: '1111' }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
  })
  it('the audit row never holds the PIN', async () => {
    const t = await openConnectedApi()
    await t.api.setStaffPin({ staffId: STAFF.Mint, pin: '4321', approverUserId: STAFF.TungAo, approverPin: '1111' })
    const rows = t.raw.prepare(`select after_json from audit_log where entity = 'user' and entity_id = ?`).all(STAFF.Mint) as { after_json: string }[]
    expect(rows.some((r) => r.after_json.includes('4321'))).toBe(false)
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos test -- connect staff-pin` · คาดว่า FAIL

- [ ] **Step 3: เขียนโค้ด** — `apps/pos/src/api/connect.ts`

```ts
import { and, eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { API_KEY_RE, PosOrderCatalog, type PosCatalogData } from '@dayo/contracts'
import { classifyPromptPayId, parseReceiptNo } from '@dayo/domain'
import { hashPin } from '../lib/pin'
import { roleOf, staffDisplayName, writeCatalogAnswer } from '../sync/catalog'
import { createDayoClient, DayoError, type Timed } from '../sync/dayo-client'
import { DAYO_KEYS, deleteKey, readKey, writeKey } from '../sync/state'
import { requireOwnerPin } from './auth'
import { LOCAL_DEVICE_KEY, localDeviceId } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { PROMPTPAY_SETTING_KEY } from './setup'
import type { ConnectShopInput, DayoProbe, DayoProbeInput, RecoverOwnerInput, ReplaceApiKeyInput } from './types'

export function normalizeBaseUrl(raw: string): string {
  let u: URL
  try { u = new URL(raw.trim()) } catch { throw new PosError('BAD_INPUT', 'ที่อยู่ระบบกลางไม่ถูกต้อง') }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local))) throw new PosError('BAD_INPUT', 'ระบบกลางต้องเป็น https')
  const path = u.pathname.replace(/\/+$/, '')
  if (!path.endsWith('/api/v1') || u.search !== '' || u.hash !== '') throw new PosError('BAD_INPUT', 'ที่อยู่ต้องลงท้ายด้วย /api/v1')
  return `${u.origin}${path}`
}

/** E1 with known_version=0 — the only network call of setup; maps failures to setup messages. */
async function fetchFullCatalog(deps: ApiDeps, input: DayoProbeInput): Promise<{ baseUrl: string; answer: Timed<Extract<PosCatalogData, { changed: true }>> }> {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  if (!API_KEY_RE.test(input.apiKey.trim())) throw new PosError('BAD_INPUT', 'กุญแจเครื่องต้องขึ้นต้นด้วย dayo_ และยาว 69 ตัว')
  const client = createDayoClient({ baseUrl, apiKey: input.apiKey.trim(), fetch: deps.fetch, nowMs: () => Date.parse(deps.now()) })
  try {
    const r = await client.getCatalog(0)
    if (!r.value.changed) throw new PosError('DAYO_BAD_RESPONSE', 'known_version=0 answered unchanged')
    // setup needs a catalog the tablet can sell with (R12 lets a running tablet keep its old one — a new one has none)
    const catalog = PosOrderCatalog.safeParse(r.value.catalog)
    if (!catalog.success) throw new PosError('DAYO_BAD_RESPONSE', 'catalog unreadable by this tablet version')
    return { baseUrl, answer: { ...r, value: { ...r.value, catalog: catalog.data } } }
  } catch (e) {
    if (!(e instanceof DayoError)) throw e
    const f = e.failure
    if (f.kind === 'unauthorized') throw new PosError('DAYO_BAD_KEY', 'key refused')
    if (f.kind === 'forbidden') throw new PosError('DAYO_KEY_NO_SCOPE', 'key lacks catalog:read/staff:read')
    if (f.kind === 'api_disabled') throw new PosError('DAYO_API_DISABLED', 'API_V1_ENABLED is off')
    if (f.kind === 'bad_response') throw new PosError('DAYO_BAD_RESPONSE', f.message)
    throw new PosError('DAYO_UNREACHABLE', f.kind)
  }
}

function owners(answer: Extract<PosCatalogData, { changed: true }>): DayoProbe['owners'] {
  return answer.staff.filter((x) => x.active && roleOf(x.role) === 'owner').map((x) => ({ id: x.id, displayName: staffDisplayName(x) }))
}

export async function probeDayo(deps: ApiDeps, input: DayoProbeInput): Promise<DayoProbe> {
  const { answer } = await fetchFullCatalog(deps, input)
  const v = answer.value
  const last = v.client.last_receipt_no
  const vendorFiles = (await import('@dayo/dayo-pricing/VENDOR.json')).default.files as Record<string, string>
  return {
    clientName: v.client.name, lastReceiptNo: last, requiredPrefix: last === null ? null : parseReceiptNo(last).prefix,
    catalogVersion: v.catalog_version, owners: owners(v),
    pricingMatches: JSON.stringify(Object.entries(vendorFiles).sort()) === JSON.stringify(Object.entries(v.pricing.files_sha256).sort()),
  }
}

/**
 * spec 04 §7 ข้อ 1 + ruling R7: a new device, or a plan-3/4 device not linked yet (then an old owner approves with a PIN).
 * Network runs inside the serial queue here on purpose: nothing else runs on an unlinked device.
 */
export async function connectShop(db: RemoteDb, deps: ApiDeps, input: ConnectShopInput): Promise<void> {
  const existingDeviceId = await localDeviceId(db)
  if (existingDeviceId !== null && (await deps.secrets.getApiKey()) !== null) throw new PosError('ALREADY_SET_UP', 'this device is already linked to dayo')
  if (existingDeviceId !== null) {
    if (input.legacyApproval === null) throw new PosError('ALREADY_SET_UP', 'a device set up before block 2 needs an old owner PIN to link')
    await requireOwnerPin(db, deps, input.legacyApproval.userId, input.legacyApproval.pin)
  }
  const prefix = input.receiptPrefix.trim()
  if (!/^[A-Z]{1,3}$/.test(prefix)) throw new PosError('BAD_INPUT', 'receipt prefix must be 1-3 letters A-Z')
  let promptPayDigits: string
  try { promptPayDigits = classifyPromptPayId(input.promptPayId).digits } catch (e) { throw new PosError('BAD_INPUT', e instanceof Error ? e.message : String(e)) }

  const { baseUrl, answer } = await fetchFullCatalog(deps, input)
  const v = answer.value
  const owner = owners(v).find((o) => o.id === input.ownerStaffId)
  if (owner === undefined) throw new PosError('BAD_INPUT', 'เลือกเจ้าของจากรายชื่อระบบกลาง (owner ที่ใช้งานอยู่)')
  const last = v.client.last_receipt_no
  if (last !== null && parseReceiptNo(last).prefix !== prefix) throw new PosError('BAD_INPUT', `กุญแจนี้ใช้เลขใบเสร็จ ${parseReceiptNo(last).prefix} — ใส่ prefix ${parseReceiptNo(last).prefix}`)
  const pinHash = await hashPin(input.ownerPin, deps.pinCost) // slow: outside the transaction

  await deps.secrets.setApiKey(input.apiKey.trim())
  try {
    await db.transaction(async (tx) => {
      const at = deps.now()
      let deviceId = existingDeviceId
      if (deviceId === null) {
        deviceId = deps.newId()
        const device = { id: deviceId, name: v.client.name, receiptPrefix: prefix, isSellingDevice: true, registeredAt: at, version: 1, updatedAt: at } satisfies typeof s.device.$inferInsert
        await tx.insert(s.device).values(device)
        await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'device', entityId: deviceId, action: 'create', beforeJson: null, afterJson: device, actorUserId: null, at })
        await tx.insert(s.syncState).values({ key: LOCAL_DEVICE_KEY, value: deviceId })
      } else {
        const dev = await tx.select().from(s.device).where(eq(s.device.id, deviceId)).get()
        if (dev?.receiptPrefix !== prefix) throw new PosError('BAD_INPUT', `เครื่องนี้ใช้ prefix ${dev?.receiptPrefix ?? '?'} อยู่แล้ว`)
      }
      await tx.insert(s.user).values({ id: owner.id, displayName: owner.displayName, role: 'owner', pinHash, isActive: true, createdAt: at, updatedAt: at, version: 1 })
        .onConflictDoUpdate({ target: s.user.id, set: { pinHash, isActive: true, role: 'owner', displayName: owner.displayName, updatedAt: at } })
      await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'user', entityId: owner.id, action: 'pin_set', beforeJson: null, afterJson: { staffId: owner.id, by: 'connectShop' }, actorUserId: owner.id, at })
      await tx.insert(s.setting).values({ key: PROMPTPAY_SETTING_KEY, valueJson: promptPayDigits, effectiveFrom: at, updatedAt: at, version: 1 })
        .onConflictDoUpdate({ target: [s.setting.key, s.setting.effectiveFrom], set: { valueJson: promptPayDigits, updatedAt: at } })
      await writeKey(tx, DAYO_KEYS.baseUrl, baseUrl)
      if (last !== null) await writeKey(tx, DAYO_KEYS.lastReceiptNo, last)
      await writeCatalogAnswer(tx, deps, v, answer) // catalog + staff (disables plan-3 owners — ruling R7)
    })
  } catch (e) {
    await deps.secrets.clearApiKey() // nothing saved → no key left behind
    throw e
  }
}
```

(`setting` มี PK `(key, effective_from)` — เครื่องเดิมที่ตั้งในวินาทีเดียวกัน (เทสต์ที่นาฬิกาไม่เดิน) จึงใช้ upsert · import แบบ dynamic ของ `VENDOR.json` ใน `probeDayo` เปลี่ยนเป็น import ปกติบนหัวไฟล์ได้ถ้า typecheck ผ่าน)

`replaceApiKey` (ต่อท้าย `connect.ts`):

```ts
/** spec 04 §6.3 row 401 / §7 ข้อ 3: the owner (PIN) replaces a revoked key; the receipt prefix of the device never changes. */
export async function replaceApiKey(db: RemoteDb, deps: ApiDeps, input: ReplaceApiKeyInput): Promise<void> {
  await requireOwnerPin(db, deps, input.approverUserId, input.approverPin)
  const deviceId = await localDeviceId(db)
  if (deviceId === null) throw new PosError('NEEDS_SETUP', 'set the device up first')
  const { baseUrl, answer } = await fetchFullCatalog(deps, input)
  // ruling N2: an owner dayo removed approves nothing, even with a PIN still on this tablet
  if (!owners(answer.value).some((o) => o.id === input.approverUserId)) throw new PosError('NOT_OWNER', 'dayo no longer lists this owner — use "เชื่อมใหม่ด้วยคีย์ใหม่"')
  const dev = await db.select().from(s.device).where(eq(s.device.id, deviceId)).get()
  const last = answer.value.client.last_receipt_no
  if (last !== null && parseReceiptNo(last).prefix !== dev?.receiptPrefix) throw new PosError('BAD_INPUT', `กุญแจนี้เป็นของเครื่องที่ใช้ prefix ${parseReceiptNo(last).prefix}`)
  const previous = await deps.secrets.getApiKey()
  await deps.secrets.setApiKey(input.apiKey.trim())
  try {
    await db.transaction(async (tx) => {
      await writeKey(tx, DAYO_KEYS.baseUrl, baseUrl)
      await deleteKey(tx, DAYO_KEYS.apiRetryAt)
      if (last !== null) await writeKey(tx, DAYO_KEYS.lastReceiptNo, last)
      await writeCatalogAnswer(tx, deps, answer.value, answer) // sets api_state = ok
      await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'device', entityId: deviceId, action: 'api_key_replaced', beforeJson: null, afterJson: { baseUrl }, actorUserId: input.approverUserId, at: deps.now() }) // never the key
    })
  } catch (e) {
    if (previous === null) await deps.secrets.clearApiKey(); else await deps.secrets.setApiKey(previous)
    throw e
  }
  deps.afterWrite?.()
}

/** ruling N2: no active owner with a PIN is left here, or the key is revoked (then nobody here may be trusted to approve). */
export async function ownerRecoveryAllowed(db: RemoteDb): Promise<boolean> {
  const owner = await db.select({ id: s.user.id }).from(s.user).where(and(eq(s.user.isActive, true), eq(s.user.role, 'owner'))).limit(1).get()
  return owner === undefined || (await readKey(db, DAYO_KEYS.apiState)) === 'unauthorized'
}

/**
 * ruling N2 — "เชื่อมใหม่ด้วยคีย์ใหม่". Proof of ownership is dayo's, not the tablet's: the owner signed in to the dayo web
 * with LINE, issued a NEW key and revoked the old one there. So: the key must differ from the stored one, dayo must
 * refuse the old key (401), and the new key must pass E1. Then an active dayo owner gets a PIN, like connectShop.
 * The device, its receipt prefix, the bills and the outbox are untouched.
 */
export async function recoverOwner(db: RemoteDb, deps: ApiDeps, input: RecoverOwnerInput): Promise<void> {
  const deviceId = await localDeviceId(db)
  const oldKey = await deps.secrets.getApiKey()
  const oldBase = await readKey(db, DAYO_KEYS.baseUrl)
  if (deviceId === null || oldKey === null || oldBase === null) throw new PosError('NEEDS_SETUP', 'set the device up first')
  if (!(await ownerRecoveryAllowed(db))) throw new PosError('RECOVERY_NOT_ALLOWED', 'an owner with a PIN can still approve — use replaceApiKey')
  if (input.apiKey.trim() === oldKey) throw new PosError('KEY_NOT_NEW', 'issue a new key on the dayo web')
  const oldClient = createDayoClient({ baseUrl: oldBase, apiKey: oldKey, fetch: deps.fetch, nowMs: () => Date.parse(deps.now()) })
  const oldRefused = await oldClient.getCatalog(0).then(() => false, (e: unknown) => {
    if (e instanceof DayoError && e.failure.kind === 'unauthorized') return true
    if (e instanceof DayoError && e.failure.kind !== 'forbidden') throw new PosError('DAYO_UNREACHABLE', 'could not confirm the old key is revoked')
    return false // forbidden = the key still exists (scope removed), not revoked
  })
  if (!oldRefused) throw new PosError('OLD_KEY_STILL_ACTIVE', 'revoke the old key on the dayo web first')
  const { baseUrl, answer } = await fetchFullCatalog(deps, input)
  const v = answer.value
  const owner = owners(v).find((o) => o.id === input.ownerStaffId)
  if (owner === undefined) throw new PosError('BAD_INPUT', 'เลือกเจ้าของจากรายชื่อระบบกลาง (owner ที่ใช้งานอยู่)')
  const dev = await db.select().from(s.device).where(eq(s.device.id, deviceId)).get()
  const last = v.client.last_receipt_no
  if (last !== null && parseReceiptNo(last).prefix !== dev?.receiptPrefix) throw new PosError('BAD_INPUT', `กุญแจนี้เป็นของเครื่องที่ใช้ prefix ${parseReceiptNo(last).prefix}`)
  const pinHash = await hashPin(input.ownerPin, deps.pinCost) // slow: outside the transaction
  await deps.secrets.setApiKey(input.apiKey.trim())
  try {
    await db.transaction(async (tx) => {
      const at = deps.now()
      await tx.insert(s.user).values({ id: owner.id, displayName: owner.displayName, role: 'owner', pinHash, isActive: true, createdAt: at, updatedAt: at, version: 1 })
        .onConflictDoUpdate({ target: s.user.id, set: { pinHash, isActive: true, role: 'owner', displayName: owner.displayName, updatedAt: at } })
      await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'user', entityId: owner.id, action: 'owner_recovered', beforeJson: null, afterJson: { staffId: owner.id, by: 'recoverOwner' }, actorUserId: owner.id, at })
      await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'device', entityId: deviceId, action: 'api_key_replaced', beforeJson: null, afterJson: { baseUrl, by: 'recoverOwner' }, actorUserId: owner.id, at }) // never the key
      await writeKey(tx, DAYO_KEYS.baseUrl, baseUrl)
      await deleteKey(tx, DAYO_KEYS.apiRetryAt)
      if (last !== null) await writeKey(tx, DAYO_KEYS.lastReceiptNo, last)
      await writeCatalogAnswer(tx, deps, v, answer) // staff from dayo + api_state = ok
    })
  } catch (e) {
    await deps.secrets.setApiKey(oldKey)
    throw e
  }
  deps.afterWrite?.()
}
```

(`pos-api.ts`: `replaceApiKey: (i) => serial(() => replaceApiKey(db, deps, i))` · `recoverOwner: (i) => serial(() => recoverOwner(db, deps, i))` — network ในคิวยอมรับได้ เพราะเจ้าของทำตอนเครื่องส่งไม่ได้อยู่แล้ว · `recoverOwner` ไม่ใช้ PIN ผู้อนุมัติ: หลักฐานคือกุญแจใหม่ที่ออกได้เฉพาะ owner ที่ล็อกอิน LINE บนเว็บ + กุญแจเก่าถูกเพิกถอน)

`apps/pos/src/api/staff.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { hashPin } from '../lib/pin'
import { readCatalog, roleOf, staffDisplayName } from '../sync/catalog'
import { requireOwnerPin } from './auth'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import type { SetStaffPinInput, StaffOptionDto, UserDto } from './types'

/** Staff dayo lists as active with a role the tablet knows, who have no PIN here yet (spec 04 §6.5). */
export async function staffNeedingPin(db: RemoteDb): Promise<StaffOptionDto[]> {
  const c = await readCatalog(db)
  if (c === null) return []
  const withPin = new Set((await db.select({ id: s.user.id }).from(s.user).all()).map((u) => u.id))
  return c.staff.flatMap((x) => { const role = roleOf(x.role); return x.active && role !== null && !withPin.has(x.id) ? [{ id: x.id, displayName: staffDisplayName(x), role }] : [] })
}

/** Q44: only an owner sets another person's PIN, approving with their own PIN (D50 Q3-21 lockout applies). */
export async function setStaffPin(db: RemoteDb, deps: ApiDeps, input: SetStaffPinInput): Promise<UserDto> {
  const approver = await requireOwnerPin(db, deps, input.approverUserId, input.approverPin)
  const c = await readCatalog(db)
  const entry = c?.staff.find((x) => x.id === input.staffId)
  const role = entry === undefined ? null : roleOf(entry.role)
  if (entry === undefined || !entry.active || role === null) throw new PosError('BAD_INPUT', 'พนักงานคนนี้ไม่ได้อยู่ในรายชื่อที่ใช้งานของระบบกลาง')
  const pinHash = await hashPin(input.pin, deps.pinCost)
  const displayName = staffDisplayName(entry)
  await db.transaction(async (tx) => {
    const at = deps.now()
    await tx.insert(s.user).values({ id: entry.id, displayName, role, pinHash, isActive: true, createdAt: at, updatedAt: at, version: 1 })
      .onConflictDoUpdate({ target: s.user.id, set: { pinHash, displayName, role, isActive: true, updatedAt: at } })
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'user', entityId: entry.id, action: 'pin_set', beforeJson: null, afterJson: { staffId: entry.id, approvedBy: approver.id }, actorUserId: approver.id, at })
  })
  const u = await db.select().from(s.user).where(eq(s.user.id, entry.id)).get()
  return { id: u!.id, displayName: u!.displayName, role: u!.role }
}
```

`bootstrap.ts`: `bootstrap()` คืน `legacyDevice = device !== null && !linked`, `dayoLinked = baseUrl !== null && apiKey !== null`, `needsSetup = device === null || !dayoLinked`, `staffNeedingPin = dayoLinked ? await staffNeedingPin(db) : []`, `ownerRecovery = dayoLinked && await ownerRecoveryAllowed(db)` (N2) (bootstrap ต้องรับ `deps` เพิ่มเพื่ออ่าน `secrets` — แก้ `pos-api.ts` ให้ส่ง) · `listActiveUsers` เรียงตามลำดับรายชื่อ E1 เมื่อมีแคตตาล็อก (owner ก่อน) ไม่งั้นตาม `createdAt`

`pos-api.ts`: `probeDayo: (i) => probeDayo(deps, i)` (**ไม่อยู่ใน serial** — ไม่แตะฐาน) · `connectShop: (i) => serial(() => connectShop(db, deps, i))` · `setStaffPin: (i) => serial(() => setStaffPin(db, deps, i))` · `replaceApiKey`, `recoverOwner` ตามข้างบน · เพิ่มชื่อทั้งห้าใน `POS_API_METHODS`

`test/helpers/dayo.ts`:

```ts
import { createMockDayo, type MockDayo } from '@dayo/dayo-mock'
import { MOCK_API_KEY } from '@dayo/dayo-mock'
import { openTestApi, type ReadyApi } from './db'

/** UUIDs of packages/contracts/fixtures/pos-test/e1-catalog-rich.json (Task 6) */
export const STAFF = {
  TungAo: '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f', DCm: '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d', Beam: '2c3d4e5f-6071-4283-94a5-b6c7d8e9f0a1',
  Mint: '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0', Unnamed: '4e5f6071-8293-44a5-b6c7-d8e9f0a1b2c3', Old: '3d4e5f60-7182-4394-a5b6-c7d8e9f0a1b2',
} as const

export async function openConnectedApi(opts: { now?: string } = {}): Promise<ReadyApi & { mock: MockDayo }> {
  const now = opts.now ?? '2026-09-25T03:00:00.000Z'
  const mock = createMockDayo({ now })
  const t = await openTestApi({ fetch: mock.fetch, now })
  await t.api.connectShop({ baseUrl: 'http://localhost:8787/api/v1', apiKey: MOCK_API_KEY, receiptPrefix: 'A', ownerStaffId: STAFF.TungAo, ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null })
  const owner = await t.api.setStaffPin({ staffId: STAFF.DCm, pin: '2222', approverUserId: STAFF.TungAo, approverPin: '1111' })
  const boot = await t.api.bootstrap()
  const shift = await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
  return { ...t, mock, owner: boot.users.find((u) => u.id === STAFF.TungAo)!, other: owner, device: boot.device!, shift }
}
```

(`openTestApi` รับ `now` เพิ่มเพื่อให้ `testClock` เริ่มที่เวลาเดียวกับ mock — ขยาย signature ใน `helpers/db.ts` · `openShift` คืน `ShiftDto` ตามเดิม ถ้าคืนอย่างอื่นให้อ่านจาก `bootstrap().openShift`)

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test` → PASS ทั้งแพ็กเกจ (เทสต์เดิมที่ใช้ `openReadyApi`/`setupShop` เดิมยังผ่าน เพราะ API เดิมยังอยู่) · `pnpm turbo run typecheck` → ผ่าน

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/api/connect.ts apps/pos/src/api/staff.ts apps/pos/src/api/bootstrap.ts apps/pos/src/api/types.ts apps/pos/src/api/pos-api.ts apps/pos/src/api/errors.ts apps/pos/test/helpers/db.ts apps/pos/test/helpers/dayo.ts apps/pos/test/connect.test.ts apps/pos/test/staff-pin.test.ts
git commit -m "feat(pos): set up the tablet with a dayo key and give dayo staff a local pin"
```

---

### Task 12 (12a–12d): ขายและยกเลิกบิลด้วยแคตตาล็อกกลาง + outbox รูป E2

ผู้ทำ: sync-engineer (opus) · สเปก §4.5, §4.7, §5.1, §6.1, §6.6, §7 ข้อ 6, D50 Q3-20/Q3-26/Q3-27, D61 · ruling R5, R6, R11, R13 · รอ Task 3, 11, **A2**

**ปรับตาม dayo (มีผลเหนือโค้ดข้างล่าง · สเปก §4.1, §4.4 ข้อ 2/12, §5.1 · §13.6 S1–S3)**:
- `Size` เป็น `string` (ขนาดตั้งได้) ทุกที่ใน `SellMenuDto`/`RecordSaleInput`/`sellCode` · `SellCatalogDto` เพิ่ม `sizes: { code: string; label: string }[]` = ขนาดใน `catalog.sizes` ที่ `isActive` เรียง `sortOrder`
- `sell-catalog.ts` (12b): `SellMenuDto.sizes` = ขนาดใน `catalog.sizes` ที่ `isActive` **และ** เมนูมีตัวแปร เรียงตาม `sortOrder` ของ `sizes` (**ไม่เรียง `16 oz`, `20 oz` ตายตัว**) · ค่าเริ่มต้น `settings.defaultSize` ถ้าเมนูมี ไม่งั้นขนาดแรกตามลำดับนั้น · `categoryLabel` null → `family`
- `recordSale` (12b): ตัวตรวจขนาดของ A2 ทำงานก่อนเขียนอะไร — ขนาดไม่อยู่ใน `sizes` ที่ active / ไม่มีตัวแปร = error (`CartError` → `BAD_INPUT` ตามการแปลงเดิม) ไม่มีแถวใน `order`/`outbox`
- เพิ่มเทสต์ (`sell-catalog.test.ts`): แคตตาล็อกที่เปิด `22 oz` (sortOrder 2) ให้ Pink Milk → `pink.sizes` = `['16 oz', '20 oz', '22 oz']` · ขนาดที่ปิดไม่ขึ้น · `record-sale.test.ts`: ขาย `22 oz` ที่ปิดอยู่ = error และไม่มีแถว

**แบ่งเป็น 4 งานย่อยตามลำดับ** (review item 16 — แต่ละงานย่อยผ่าน test-runner + code-reviewer และ commit แยก · Interfaces ข้างล่างเป็นของทั้งกลุ่ม):

| งานย่อย | ทำ Step | ไฟล์ | เกณฑ์เสร็จ |
|---|---|---|---|
| **12a** outbox รูป E2 + ผู้เขียนเดิม | 3 | `db/outbox.ts` (เขียนใหม่), `db/events.ts`, `db/stock.ts`, `api/{shift,cash,close,adjust,production,purchase,stock-count}.ts`, `api/bootstrap.ts` (`countPendingSyncItems`, `countSyncProblems`) · เทสต์ `pending-sync.test.ts` + เทสต์เดิมที่ assert แถว outbox | `pnpm --filter @dayo/pos test` ผ่าน · ไม่มีแถว outbox ของสต็อก/บิลเดิมถูกเขียนใหม่ · แถวกะ/เงินสดเป็น `local_only` |
| **12b** ขาย + แคตตาล็อกหน้าขาย + ตัวช่วยเทสต์ | 4, 6 (ส่วน `sell-catalog.ts`), 7 (ส่วน `sellCode`/`openReadyApi`) | `api/sale.ts` (+ `recordSale`), `api/sell-catalog.ts`, `api/types.ts`, `api/pos-api.ts`, `api/errors.ts`, `test/helpers/db.ts` · เทสต์ `record-sale.test.ts`, `sell-catalog.test.ts` | สองไฟล์เทสต์ผ่าน + ทั้งแพ็กเกจผ่าน |
| **12c** ยกเลิกบิล + สถานการณ์ Z | 5, 7 (ส่วน `sellVoidScenario`) | `api/void.ts` (+ `cancelSale`), `test/helpers/shift.ts` · เทสต์ `cancel-sale.test.ts` + close-shift/shift-report/backup/close-shift-screen ผ่านด้วยสถานการณ์ใหม่ | ตัวเลข Z เดิมทุกตัวยังผ่าน |
| **12d** ประวัติ/รายละเอียดบิล | 6 (ส่วน `orders.ts`) | `api/orders.ts`, `api/types.ts` · เทสต์ `orders-central.test.ts` | จำนวนแก้วของบิลก้อน 2 ถูก · สถานะระบบกลางถูก |

**Files:** (รวมทั้งกลุ่ม — ไม่แตะ `apps/pos/src/ui/errors.ts` ซึ่งเป็นของสาย D)
- Modify: `apps/pos/src/db/outbox.ts` (เขียนใหม่), `apps/pos/src/db/events.ts`, `apps/pos/src/db/stock.ts`, `apps/pos/src/api/{shift,cash,close,adjust,production,purchase,stock-count}.ts` · `apps/pos/src/api/sale.ts`, `apps/pos/src/api/void.ts`, `apps/pos/src/api/orders.ts`, `apps/pos/src/api/bootstrap.ts`, `apps/pos/src/api/types.ts`, `apps/pos/src/api/pos-api.ts`, `apps/pos/src/api/errors.ts`
- Create: `apps/pos/src/api/sell-catalog.ts`
- Modify tests: `apps/pos/test/helpers/db.ts`, `apps/pos/test/helpers/shift.ts`, `apps/pos/test/pending-sync.test.ts`, และเทสต์ของหน้าสต็อกที่ assert แถว outbox
- Create tests: `apps/pos/test/record-sale.test.ts`, `apps/pos/test/cancel-sale.test.ts`, `apps/pos/test/sell-catalog.test.ts`, `apps/pos/test/orders-central.test.ts`

**Interfaces:**
- Consumes: `priceCart`, `buildOrderRowData`, `CartError`, `CartDraft`, `PricedCart`, `nextReceiptNo`, `parseReceiptNo`, `cashChangeSatang` (domain) · `OrderRowData`, `OrderVoidRowData`, `rowKey`, `bangkokDateOf`, `Text200` (contracts) · `readCatalog` (Task 10) · `DAYO_KEYS`, `readKey` (Task 9)
- Produces (Task 13–15, 18, 19 ใช้):

```ts
// db/outbox.ts
export type LocalOnlyTable = 'shift' | 'cash_movement' | 'cash_count' | 'z_report'
export async function enqueueLocalOnly(db: RemoteDb, table: LocalOnlyTable, row: { id: string } & Record<string, unknown>, at: string, newId: () => string, keySuffix?: string): Promise<void>
export type PushRowInput = { kind: 'order'; id: string; data: OrderRowData; parentKey: null } | { kind: 'order_void'; id: string; data: OrderVoidRowData; parentKey: string }
export async function enqueuePush(db: RemoteDb, row: PushRowInput, at: string, newId: () => string): Promise<void>
// api
export const PAYMENT_CODE = { CASH: 'cash', PROMPTPAY: 'qr' } as const
export type RecordSaleInput = { orderId: string; actorUserId: string; cart: Omit<CartDraft, 'paymentCode'>; payment: { method: 'CASH'; tenderedSatang: number } | { method: 'PROMPTPAY' }; expectedTotalSatang: number }
export type CancelSaleInput = { orderId: string; actorUserId: string; approverUserId: string; approverPin: string; reason: string; made: boolean; refundReference: string | null }
export type SellMenuDto = { code: string; nameTh: string; categoryLabel: string; sortOrder: number; isMatcha: boolean; sizes: Size[]; sweetnessBySize: Partial<Record<Size, Sweetness[]>>; defaultSize: Size; defaultSweetness: Sweetness }
export type SellCatalogDto = { catalogVersion: number; catalog: PosOrderCatalog; sizes: { code: string; label: string }[]; menus: SellMenuDto[]; categories: string[]; channels: { code: string; name: string }[]; defaultChannelCode: string; payments: { cash: boolean; qr: boolean }; maxQtyPerLine: number; bestSellerCodes: string[] }
export type CentralStateDto = { state: 'legacy' | 'pending' | 'sent' | 'problem' | 'excluded'; orderNo: string | null; computedTotalSatang: number | null; diffSatang: number | null; duplicateOf: string[]; reason: string | null
  voidState: 'none' | 'pending' | 'sent' | 'problem' | 'local_only' } // review item 23: 'local_only' on a voided bill whose order WAS sent = dayo still counts it as a sale
// OrderSummaryDto gains: soldById: string · soldByName: string · central: CentralStateDto
// OrderDetailDto gains: soldAt: string | null · channelCode: string | null · catalogVersion: number | null · promotions: { name: string; discountSatang: number }[]
// OrderLineDto gains: milk: string | null · grade: string | null
// PosApi gains: loadSellCatalog(): Promise<SellCatalogDto> · recordSale(i): Promise<CommitSaleResult> · cancelSale(i): Promise<OrderDetailDto>
// PosErrorCode gains: 'NO_CATALOG' | 'PRICE_NOT_OK' | 'NO_PAYMENT_METHOD' | 'QUEUE_FULL'
export async function countPendingSyncItems(db): Promise<number>   // distinct bills with a pending E2 row (D50 Q3-26)
export async function countSyncProblems(db): Promise<number>        // distinct bills with a dead E2 row
// test helpers
export async function sellCode(t: ReadyApi, lines: { code: string; size?: Size; sweetness?: Sweetness; milk?: MilkCode; grade?: string | null; qty: number }[], payment: RecordSaleInput['payment'], extra?: { billDiscountSatang?: number; reason?: string; channelCode?: string; actorUserId?: string; orderId?: string }): Promise<CommitSaleResult>
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** (12b: `record-sale`, `sell-catalog` · 12c: `cancel-sale` · 12d: `orders-central`) — `apps/pos/test/record-sale.test.ts`

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { OrderRowData } from '@dayo/contracts'
import { posErrorCode } from '../src/api/errors'
import { DAYO_KEYS, writeKey } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

describe('recordSale (spec 04 §4.5, §5.1, §6.1)', () => {
  it('writes the bill, its lines and ONE pending E2 row in one transaction', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Thai Tea', qty: 3 }, { code: 'Matcha Latte', grade: 'Excellent', qty: 1 }], { method: 'CASH', tenderedSatang: 20_000 })
    expect(r).toMatchObject({ receiptNo: 'A-000001', queueNo: 1, totalSatang: 15_500 })
    const rows = await t.db.select().from(s.outbox).where(eq(s.outbox.status, 'pending')).all()
    expect(rows.map((x) => [x.tableName, x.idempotencyKey])).toEqual([['order', `order:${r.orderId}`]])
    const data = OrderRowData.parse(rows[0]!.rowJson)
    expect(data).toMatchObject({ receipt_no: 'A-000001', queue_no: 1, shift_id: null, staff_id: STAFF.TungAo, catalog_version: 42, channel: 'store', payment: 'cash', totals: { total: 155 } })
    const items = await t.db.select().from(s.orderItem).where(eq(s.orderItem.orderId, r.orderId)).all()
    expect(items.map((i) => [i.menuCode, i.qty, i.lineTotalSatang])).toEqual(expect.arrayContaining([['Matcha Latte', 1, 8500]]))
    expect(await t.api.bootstrap()).toMatchObject({ pendingSyncItems: 1 })
  })
  it('writes no stock movement and no plan-3 outbox row (D60, spec §6.1)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    expect(await t.db.select().from(s.stockMovement).all()).toEqual([])
    expect((await t.db.select().from(s.outbox).all()).map((x) => x.tableName)).toEqual(['order'])
  })
  it('re-prices at the payment instant and refuses a changed total (D50 Q3-27)', async () => {
    const t = await openConnectedApi({ now: '2026-09-25T06:59:30.000Z' }) // 13:59:30 Bangkok, Friday
    const cart = { channelCode: 'store', lines: [{ code: 'Matcha Latte', size: '16 oz' as const, sweetness: '50%' as const, milk: 'fresh' as const, grade: 'Excellent', qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null }], billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false }
    t.clock.set('2026-09-25T07:00:30.000Z') // 14:00:30 — the 15% afternoon promotion starts before payment
    try {
      await t.api.recordSale({ orderId: t.deps.newId(), actorUserId: STAFF.TungAo, cart, payment: { method: 'PROMPTPAY' }, expectedTotalSatang: 8_500 })
      expect.unreachable()
    } catch (e) { expect(posErrorCode(e)).toBe('PRICE_CHANGED') }
    expect(await t.db.select().from(s.order).all()).toEqual([])
  })
  it('the same orderId twice returns the first bill; with other lines it is refused (plan 3 M12)', async () => {
    const t = await openConnectedApi()
    const orderId = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21'
    const first = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }, { orderId })
    const again = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }, { orderId })
    expect(again.receiptNo).toBe(first.receiptNo)
    try { await sellCode(t, [{ code: 'Cocoa', qty: 2 }], { method: 'PROMPTPAY' }, { orderId }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
  })
  it('continues after the receipt number dayo last saw for this key (spec §6.6)', async () => {
    const t = await openConnectedApi()
    await writeKey(t.db, DAYO_KEYS.lastReceiptNo, 'A-000311')
    expect((await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })).receiptNo).toBe('A-000312')
  })
  it.each([
    ['a total of 0 (D50 Q3-20)', { billDiscountSatang: 4_500, reason: 'ฟรี' }, 'DISCOUNT_TOO_BIG'],
    ['a code dayo does not know', { channelCode: 'foodpanda' }, 'PRICE_NOT_OK'],
  ] as const)('refuses %s', async (_, extra, code) => {
    const t = await openConnectedApi()
    try { await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 10_000 }, extra); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe(code) }
  })
})
```

`apps/pos/test/cancel-sale.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { OrderVoidRowData } from '@dayo/contracts'
import { posErrorCode } from '../src/api/errors'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

const approve = { approverUserId: STAFF.DCm, approverPin: '2222' }

describe('cancelSale (spec 04 §4.5 order_void, §4.7, D36)', () => {
  it('queues order_void after its order, and the cash refund stays on the tablet (local_only)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 2 }], { method: 'CASH', tenderedSatang: 10_000 })
    t.clock.advanceMs(60_000)
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'กดผิดเมนู', made: false, refundReference: null })
    const rows = await t.db.select().from(s.outbox).all()
    const v = rows.find((x) => x.tableName === 'order_void')!
    expect(v).toMatchObject({ status: 'pending', idempotencyKey: `order_void:${r.orderId}`, parentKey: `order:${r.orderId}` })
    expect(OrderVoidRowData.parse(v.rowJson)).toMatchObject({ staff_id: STAFF.TungAo, approved_by: STAFF.DCm, reason: 'กดผิดเมนู' })
    expect(rows.find((x) => x.tableName === 'cash_movement')?.status).toBe('local_only')
    expect(await t.api.bootstrap()).toMatchObject({ pendingSyncItems: 1 }) // one bill, two rows (D50 Q3-26)
  })
  it('is refused on another Thai day than the sale (spec §4.7)', async () => {
    const t = await openConnectedApi({ now: '2026-09-25T16:50:00.000Z' }) // 23:50 Bangkok
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.clock.set('2026-09-25T17:10:00.000Z') // 00:10 next day, same open shift
    try { await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'ช้า', made: false, refundReference: 'KBANK-9' }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('VOID_NOT_ALLOWED') }
  })
  it.each([['staff', 'Mint', '4321'], ['manager', 'Beam', '5555']] as const)('a %s may cancel only their own bill (Q44, ruling R11)', async (_, who, pin) => {
    const t = await openConnectedApi()
    await t.api.setStaffPin({ staffId: STAFF[who], pin, approverUserId: STAFF.TungAo, approverPin: '1111' })
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }) // sold by TungAo
    try { await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF[who], ...approve, reason: 'x', made: false, refundReference: 'K' }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('VOID_NOT_ALLOWED') }
    const own = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }, { actorUserId: STAFF[who] })
    await t.api.cancelSale({ orderId: own.orderId, actorUserId: STAFF[who], ...approve, reason: 'x', made: false, refundReference: 'K' })
  })
  it('voided_at is never before sold_at, even after the clock was set back (review item 5 — dayo answers INVALID otherwise)', async () => {
    const t = await openConnectedApi({ now: '2026-09-25T03:07:00.000Z' }) // clock 7 minutes fast
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.clock.set('2026-09-25T03:01:00.000Z') // the shop fixed the clock after the D80 banner
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'x', made: false, refundReference: 'K' })
    const v = (await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_void')).get())!
    expect(OrderVoidRowData.parse(v.rowJson).voided_at).toBe('2026-09-25T03:07:00.000Z')
  })
  it('records "made" in the event for the Z void list and writes no stock row (ruling R6)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'ทำผิดสูตร', made: true, refundReference: 'KBANK-1' })
    const ev = await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'VOIDED')).get()
    expect(ev?.payloadJson).toMatchObject({ made: true, waste: true })
    expect(await t.db.select().from(s.stockMovement).all()).toEqual([])
  })
})
```

`apps/pos/test/sell-catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { posErrorCode } from '../src/api/errors'
import { openConnectedApi } from './helpers/dayo'
import { openTestApi, sellCode } from './helpers/db'

describe('loadSellCatalog (spec 04 §4.4 rule 2)', () => {
  it('groups variants into menus in menuSortOrder with the shop defaults', async () => {
    const t = await openConnectedApi()
    const c = await t.api.loadSellCatalog()
    expect(c.menus.map((m) => m.code)).toEqual(['Thai Tea', 'Matcha Latte', 'Cocoa', 'Pink Milk'])
    expect(c.categories).toEqual(['ชา', 'มัตฉะ', 'โกโก้', 'นม'])
    const pink = c.menus.find((m) => m.code === 'Pink Milk')!
    expect([pink.sizes, pink.sweetnessBySize['16 oz']]).toEqual([['16 oz', '20 oz'], ['100%']])
    expect(c.menus.map((m) => `${m.defaultSize}/${m.defaultSweetness}`)).toEqual(['16 oz/100%', '16 oz/100%', '16 oz/100%', '16 oz/100%'])
    expect(c.menus.find((m) => m.code === 'Cocoa')!.sweetnessBySize['16 oz']).toEqual(['50%', '100%'])
    expect(c).toMatchObject({ catalogVersion: 42, defaultChannelCode: 'store', payments: { cash: true, qr: true }, maxQtyPerLine: 99, bestSellerCodes: [] })
    expect(c.channels.map((x) => x.code)).toEqual(['store', 'grab', 'lineman'])
  })
  it('best sellers are the codes with the most cups in the last 7 days (D48 Q3-9)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 3 }], { method: 'PROMPTPAY' })
    await sellCode(t, [{ code: 'Pink Milk', sweetness: '100%', qty: 1 }], { method: 'PROMPTPAY' })
    expect((await t.api.loadSellCatalog()).bestSellerCodes).toEqual(['Cocoa', 'Pink Milk'])
  })
  it('without a catalog from dayo the sell screen cannot open', async () => {
    const t = await openTestApi()
    try { await t.api.loadSellCatalog(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('NO_CATALOG') }
  })
})
```

`apps/pos/test/orders-central.test.ts` (12d):

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

describe('order history for block-2 bills', () => {
  it('counts cups from order_item and names the seller (review item 19, D61)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 2 }, { code: 'Thai Tea', qty: 1 }], { method: 'PROMPTPAY' })
    const [o] = await t.api.listOrders()
    expect(o).toMatchObject({ cups: 3, soldById: STAFF.TungAo, soldByName: 'TungAo', central: { state: 'pending', voidState: 'none', diffSatang: null } })
  })
  it('shows what dayo computed and the difference to the satang (spec §4.3)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.db.update(s.order).set({ centralOrderNo: 'L260925-001', centralComputedTotalSatang: 4_501, centralDuplicateOfJson: ['L260925-000'] }).where(eq(s.order.id, r.orderId))
    await t.db.update(s.outbox).set({ status: 'sent' }).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`))
    expect((await t.api.getOrder(r.orderId)).central).toMatchObject({ state: 'sent', orderNo: 'L260925-001', diffSatang: 1, duplicateOf: ['L260925-000'] })
  })
  it('a sent bill voided only on the tablet is flagged (review item 23)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.db.update(s.outbox).set({ status: 'sent' }).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`))
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'x', made: false, refundReference: 'K' })
    await t.db.update(s.outbox).set({ status: 'local_only' }).where(eq(s.outbox.idempotencyKey, `order_void:${r.orderId}`))
    expect((await t.api.getOrder(r.orderId)).central.voidState).toBe('local_only')
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos test -- record-sale cancel-sale sell-catalog` · คาดว่า FAIL

- [ ] **Step 3: outbox และผู้เขียนเดิม** — `apps/pos/src/db/outbox.ts` (แทนที่ทั้งไฟล์)

```ts
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { OrderRowData, OrderVoidRowData, rowKey } from '@dayo/contracts'

/**
 * spec 04 §6.1 (block 2): shift / cash / count / Z rows are still queued for the tablet's own record but as
 * `local_only` — their shifts never exist in the central database. Stock, production, purchase and plan-3 bill rows
 * are no longer queued at all (spec §6.1, §11).
 */
export type LocalOnlyTable = 'shift' | 'cash_movement' | 'cash_count' | 'z_report'

export async function enqueueLocalOnly(db: RemoteDb, table: LocalOnlyTable, row: { id: string } & Record<string, unknown>, at: string, newId: () => string, keySuffix?: string): Promise<void> {
  const idempotencyKey = keySuffix === undefined ? `${table}:${row.id}` : `${table}:${row.id}:${keySuffix}`
  await db.insert(s.outbox).values({ id: newId(), tableName: table, rowJson: row, idempotencyKey, status: 'local_only', createdAt: at, attempts: 0, lastError: null, sentAt: null, deadAt: null, nextAttemptAt: null, parentKey: null, resultJson: null })
}

export type PushRowInput =
  | { kind: 'order'; id: string; data: OrderRowData; parentKey: null }
  | { kind: 'order_void'; id: string; data: OrderVoidRowData; parentKey: string }

/**
 * One E2 row, written in the caller's transaction (spec §6.1): `row_json` = the E2 `data` ready to send (money already
 * baht), key `<kind>:<pos_order_id>`. Validated here so a malformed row fails the sale, never the queue.
 */
export async function enqueuePush(db: RemoteDb, row: PushRowInput, at: string, newId: () => string): Promise<void> {
  const data = row.kind === 'order' ? OrderRowData.parse(row.data) : OrderVoidRowData.parse(row.data)
  await db.insert(s.outbox).values({ id: newId(), tableName: row.kind, rowJson: data, idempotencyKey: rowKey(row.kind, row.id), status: 'pending', createdAt: at, attempts: 0, lastError: null, sentAt: null, deadAt: null, nextAttemptAt: null, parentKey: row.parentKey, resultJson: null })
}
```

ผู้เรียกเดิม: `shift.ts`, `cash.ts`, `close.ts`, `void.ts` (VOID_REFUND) → `enqueueLocalOnly` (ชื่อใหม่ พารามิเตอร์เดิม) · `adjust.ts`, `production.ts`, `purchase.ts`, `stock-count.ts`, `db/stock.ts` `insertMovements` → **ลบการเรียก outbox** · `db/events.ts` → ลบ `enqueueOutbox(db, 'order_event', …)` (โซ่แฮชอยู่ในเครื่อง — Q23) · `sale.ts` `commitSale` เดิม → ลบการเรียก outbox ทุกจุด (ฟังก์ชันเดิมจะถูกลบใน Task 22) · เทสต์เดิมที่ assert แถว outbox ของสต็อก/บิลเดิม (`outboxKeys` ใน `test/helpers/stock.ts` และผู้ใช้) เปลี่ยนเป็นคาดว่า "ไม่มีแถว" หรือ `local_only` ตามตารางนี้

`bootstrap.ts`:

```ts
/** D50 Q3-26 in block 2: bills (order + its order_void count once) with an E2 row still to send. local_only never counts. */
export async function countPendingSyncItems(db: RemoteDb): Promise<number> {
  const r = await db.values<[number]>(sql`select count(distinct json_extract(row_json, '$.pos_order_id')) from outbox where status = 'pending' and table_name in ('order', 'order_void')`)
  return r[0]?.[0] ?? 0
}
export async function countSyncProblems(db: RemoteDb): Promise<number> {
  const r = await db.values<[number]>(sql`select count(distinct json_extract(row_json, '$.pos_order_id')) from outbox where status = 'dead' and table_name in ('order', 'order_void')`)
  return r[0]?.[0] ?? 0
}
```

- [ ] **Step 4: `recordSale`** — เพิ่มใน `apps/pos/src/api/sale.ts`

```ts
export const PAYMENT_CODE = { CASH: 'cash', PROMPTPAY: 'qr' } as const

function lineSignature(lines: readonly { code: string; size: string; sweetness: string; milk: string; grade: string | null; qty: number }[]): string {
  return lines.map((l) => `${l.code}|${l.size}|${l.sweetness}|${l.milk}|${l.grade ?? ''}|${l.qty}`).sort().join(';')
}

/** plan 3 M12 for block 2: the same orderId must be the same cart (compared on the draft that was priced). */
async function existingCentralResult(db: RemoteDb, input: RecordSaleInput): Promise<CommitSaleResult | null> {
  const o = await db.select().from(s.order).where(eq(s.order.id, input.orderId)).get()
  if (!o) return null
  const pay = await db.select().from(s.payment).where(eq(s.payment.orderId, o.id)).get()
  const stored = (o.pricingJson as { draft?: { lines: { code: string; size: string; sweetness: string; milk: string; grade: string | null; qty: number }[] } } | null)?.draft?.lines
  if (o.receiptNo === null || o.queueNo === null || !pay || stored === undefined) throw new PosError('BAD_INPUT', `order ${o.id} exists but is not a block-2 bill`)
  if (lineSignature(stored) !== lineSignature(input.cart.lines)) throw new PosError('BAD_INPUT', `order ${o.id} already paid with different lines`)
  return { orderId: o.id, receiptNo: o.receiptNo, queueNo: o.queueNo, businessDate: o.businessDate, totalSatang: o.totalSatang, changeSatang: pay.changeSatang, method: pay.method }
}

/** Highest receipt of this prefix seen here or by dayo for this key (spec §6.6: a reinstalled app never reuses a number). */
async function lastReceiptNoOverall(db: RemoteDb, device: DeviceDto): Promise<string | null> {
  const local = await lastReceiptNo(db, device.id)
  const central = await readKey(db, DAYO_KEYS.lastReceiptNo)
  const counter = (r: string | null): number => (r !== null && parseReceiptNo(r).prefix === device.receiptPrefix ? parseReceiptNo(r).counter : 0)
  return counter(central) > counter(local) ? central : local
}

/**
 * spec 04 §4.5, §5.1, §6.1: price with dayo's code at the payment instant (sold_at), refuse a total the customer did
 * not see (PRICE_CHANGED), then write order + order_item + payment (+ discount) + hash-chained events + ONE E2 row in
 * one transaction. No stock rows (D60). shift_id stays local; the E2 row sends null (block 2).
 */
export async function recordSale(db: RemoteDb, deps: ApiDeps, input: RecordSaleInput): Promise<CommitSaleResult> {
  const done = await existingCentralResult(db, input)
  if (done !== null) return done
  if (!Number.isSafeInteger(input.expectedTotalSatang)) throw new PosError('BAD_INPUT', 'expectedTotalSatang must be whole satang')
  const d = input.cart.billDiscount
  if (d !== null && (d.reason === null || !Text200.safeParse(d.reason.trim()).success)) throw new PosError('BAD_INPUT', `a bill discount needs a reason of 1–${REASON_MAX_LENGTH} characters`) // D48 Q3-6
  const device = await requireDevice(db)
  const actor = await db.select().from(s.user).where(eq(s.user.id, input.actorUserId)).get()
  if (!actor || !actor.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${input.actorUserId}`)
  const stored = await readCatalog(db)
  if (stored === null) throw new PosError('NO_CATALOG', 'no catalog from dayo yet')
  const cart: CartDraft = { ...input.cart, paymentCode: PAYMENT_CODE[input.payment.method] }
  if (!stored.catalog.paymentMethods.some((p) => p.code === cart.paymentCode)) throw new PosError('NO_PAYMENT_METHOD', cart.paymentCode)

  const result = await db.transaction(async (tx) => {
    const shift = await currentOpenShift(tx, device.id)
    if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'open a shift before selling')
    const soldAt = deps.now()
    let priced: PricedCart
    try { priced = priceCart(cart, stored.catalog, soldAt) } catch (e) { if (e instanceof CartError) throw new PosError('BAD_INPUT', e.message); throw e }
    if (!priced.ok) throw new PosError('PRICE_NOT_OK', priced.warnings.join(' · '))
    const totalSatang = priced.totalSatang
    if (totalSatang <= 0) throw new PosError('DISCOUNT_TOO_BIG', 'the total must stay above 0') // D50 Q3-20, ruling R5
    if (totalSatang !== input.expectedTotalSatang) throw new PosError('PRICE_CHANGED', `shown ${input.expectedTotalSatang}, now ${totalSatang}`)
    let tenderedSatang: number | null = null
    let changeSatang: number | null = null
    if (input.payment.method === 'CASH') {
      if (!Number.isSafeInteger(input.payment.tenderedSatang)) throw new PosError('BAD_INPUT', 'tendered must be whole satang')
      if (input.payment.tenderedSatang < totalSatang) throw new PosError('TENDER_TOO_LOW', `tendered ${input.payment.tenderedSatang} < total ${totalSatang}`)
      tenderedSatang = input.payment.tenderedSatang
      changeSatang = cashChangeSatang(totalSatang, tenderedSatang)
    }
    const receiptNo = nextReceiptNo(device.receiptPrefix, await lastReceiptNoOverall(tx, device))
    const queueNo = (await lastQueueNo(tx, device.id, shift.businessDate)) + 1
    if (queueNo > 9999) throw new PosError('QUEUE_FULL', 'queue number 9999 reached today') // ruling R13
    const data = buildOrderRowData({ posOrderId: input.orderId, receiptNo, queueNo, staffId: actor.id, catalogVersion: stored.catalogVersion, cart, priced, note: null })
    const discountSatang = priced.discountSatang // items + bill, computed and cross-checked in the domain (review item 18)

    const orderRow = {
      id: input.orderId, origin: 'device', deviceId: device.id, receiptNo, queueNo, businessDate: shift.businessDate, shiftId: shift.id,
      channelId: null, channelCode: cart.channelCode, paymentCode: cart.paymentCode, customerId: null, status: 'paid',
      subtotalSatang: priced.itemsSubtotalSatang, discountSatang, totalSatang, vatSatang: 0, costSatang: 0, note: null,
      createdByType: 'user', createdById: actor.id, createdAt: soldAt, paidAt: soldAt, readyAt: null, voidedAt: null,
      soldAt, catalogVersion: stored.catalogVersion, pricingJson: { draft: priced.draft, priced: { ...priced, draft: undefined } }, excludedAt: null,
      centralOrderNo: null, centralComputedTotalSatang: null, centralAmountMismatch: null, centralDuplicateOfJson: null,
    } satisfies typeof s.order.$inferInsert
    await tx.insert(s.order).values(orderRow)
    for (const [i, l] of priced.lines.entries()) {
      await tx.insert(s.orderItem).values({ id: deps.newId(), orderId: input.orderId, lineNo: i + 1, menuCode: l.code, menuNameTh: l.nameTh, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty, unitPriceSatang: l.unitPriceSatang, discountPerCupSatang: l.discountPerCupSatang, discountReason: l.discountReason, promotionId: l.promotionId, lineTotalSatang: l.lineTotalSatang })
    }
    await tx.insert(s.payment).values({ id: deps.newId(), orderId: input.orderId, method: input.payment.method, amountSatang: totalSatang, tenderedSatang, changeSatang, reference: null, verifyStatus: 'manual', createdBy: actor.id, createdAt: soldAt })
    if (d !== null && priced.billDiscountSatang > 0) {
      await tx.insert(s.discount).values({ id: deps.newId(), orderId: input.orderId, amountSatang: priced.billDiscountSatang, reason: d.reason!.trim(), approvedBy: actor.id })
    }
    const events: NewEvent[] = [{ type: 'CREATED', payload: { origin: 'device', channelCode: cart.channelCode, catalogVersion: stored.catalogVersion, shiftId: shift.id, businessDate: shift.businessDate, soldAt } }]
    priced.lines.forEach((l, i) => events.push({ type: 'LINE_ADDED', payload: { lineNo: i + 1, code: l.code, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty, unitPriceSatang: l.unitPriceSatang, discountPerCupSatang: l.discountPerCupSatang, promotionId: l.promotionId, lineTotalSatang: l.lineTotalSatang } }))
    if (d !== null && priced.billDiscountSatang > 0) events.push({ type: 'DISCOUNT_APPLIED', payload: { amountSatang: priced.billDiscountSatang, reason: d.reason!.trim(), approvedBy: actor.id } })
    events.push({ type: 'PAID', payload: { receiptNo, queueNo, method: input.payment.method, paymentCode: cart.paymentCode, subtotalSatang: priced.itemsSubtotalSatang, discountSatang, totalSatang, tenderedSatang, changeSatang, promotions: priced.promotionsApplied.map((p) => ({ id: p.promotionId, discountSatang: p.discountSatang })) } })
    await appendOrderEvents(tx, { orderId: input.orderId, deviceId: device.id, actorType: 'user', actorId: actor.id, at: soldAt, newId: deps.newId }, events)
    await enqueuePush(tx, { kind: 'order', id: input.orderId, data, parentKey: null }, soldAt, deps.newId)
    return { orderId: input.orderId, receiptNo, queueNo, businessDate: shift.businessDate, totalSatang, changeSatang, method: input.payment.method }
  })
  deps.afterWrite?.() // wake the sender 2 s later (Task 14)
  return result
}
```

(`priced: { ...priced, draft: undefined }` — ใช้ `Omit` จริงในโค้ดแทน `undefined` ถ้า `exactOptionalPropertyTypes` ฟ้อง · `lastReceiptNo`, `lastQueueNo` คือฟังก์ชันเดิมในไฟล์นี้)

- [ ] **Step 5: `cancelSale`** (12c) — เพิ่มใน `apps/pos/src/api/void.ts` (import `sumSatang` จาก `@dayo/domain`)

```ts
/**
 * spec 04 §4.5 order_void + §4.7: same Thai day as the sale only; owner PIN (D50); staff cancels own bills only (Q44,
 * ruling R11). Cash back = local VOID_REFUND (D36 — local_only in block 2). "made" is recorded for the Z void list
 * only (ruling R6); no stock rows. Plan-3 bills (no sold_at) and excluded bills queue no order_void.
 */
export async function cancelSale(db: RemoteDb, deps: ApiDeps, input: CancelSaleInput): Promise<OrderDetailDto> {
  const reason = input.reason.trim()
  if (!Text200.safeParse(reason).success) throw new PosError('BAD_INPUT', `a void needs a reason of 1–${REASON_MAX_LENGTH} characters`)
  const actor = await db.select().from(s.user).where(eq(s.user.id, input.actorUserId)).get()
  if (!actor || !actor.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${input.actorUserId}`)
  const approver = await requireOwnerPin(db, deps, input.approverUserId, input.approverPin)
  const device = await requireDevice(db)
  await db.transaction(async (tx) => {
    const order = await tx.select().from(s.order).where(eq(s.order.id, input.orderId)).get()
    if (!order) throw new PosError('ORDER_NOT_FOUND', input.orderId)
    const shift = await currentOpenShift(tx, device.id)
    if (order.status !== 'paid' || shift === null || order.shiftId !== shift.id || order.deviceId !== device.id) throw new PosError('VOID_NOT_ALLOWED', `order ${order.receiptNo ?? order.id} is ${order.status} or not in the open shift`)
    const at = deps.now()
    if (order.soldAt !== null && bangkokDateOf(at) !== bangkokDateOf(order.soldAt)) throw new PosError('VOID_NOT_ALLOWED', 'SAME_DAY_ONLY: ยกเลิกได้เฉพาะวันเดียวกับวันขาย')
    if (actor.role !== 'owner' && order.createdById !== actor.id) throw new PosError('VOID_NOT_ALLOWED', 'OWN_BILLS_ONLY: staff และ manager ยกเลิกได้เฉพาะบิลที่ตัวเองขาย') // Q44, ruling R11
    const payments = await tx.select().from(s.payment).where(eq(s.payment.orderId, order.id)).all()
    const cashRefundSatang = sumSatang(payments.filter((p) => p.method === 'CASH').map((p) => p.amountSatang))
    const qrRefundSatang = sumSatang(payments.filter((p) => p.method === 'PROMPTPAY').map((p) => p.amountSatang))
    const refundReference = input.refundReference?.trim() ?? ''
    if (qrRefundSatang > 0 && refundReference === '') throw new PosError('BAD_INPUT', 'a PromptPay void needs the refund transfer reference') // D48 Q3-15
    await tx.update(s.order).set({ status: 'voided', voidedAt: at }).where(eq(s.order.id, order.id))
    let cashMovementId: string | null = null
    if (cashRefundSatang > 0) {
      const row = { id: deps.newId(), shiftId: shift.id, kind: 'VOID_REFUND', amountSatang: cashRefundSatang, orderId: order.id, reason: `${order.receiptNo ?? order.id}: ${reason}`, createdBy: actor.id, createdAt: at } satisfies typeof s.cashMovement.$inferInsert
      await tx.insert(s.cashMovement).values(row)
      await enqueueLocalOnly(tx, 'cash_movement', row, at, deps.newId)
      cashMovementId = row.id
    }
    await appendOrderEvents(tx, { orderId: order.id, deviceId: device.id, actorType: 'user', actorId: actor.id, at, newId: deps.newId }, [
      { type: 'VOIDED', payload: { reason, made: input.made, waste: input.made, approvedBy: approver.id, cashRefundSatang, cashMovementId, qrRefundSatang, refundReference: qrRefundSatang > 0 ? refundReference : null } },
    ])
    if (order.soldAt !== null && order.excludedAt === null) {
      // review item 5: dayo refuses voided_at < sold_at (INVALID). A clock set back after the D80 banner must not turn a
      // real cancellation into a row only EXCLUDE can clear — same Thai day is already guaranteed by the check above.
      const voidedAt = Date.parse(at) < Date.parse(order.soldAt) ? order.soldAt : at
      await enqueuePush(tx, { kind: 'order_void', id: order.id, data: { pos_order_id: order.id, voided_at: voidedAt, staff_id: actor.id, approved_by: approver.id, reason }, parentKey: rowKey('order', order.id) }, at, deps.newId)
    }
  })
  deps.afterWrite?.()
  return getOrder(db, input.orderId)
}
```

- [ ] **Step 6: `loadSellCatalog` + `orders.ts`**

`apps/pos/src/api/sell-catalog.ts` — อ่าน `readCatalog`; ไม่มี = `NO_CATALOG` · จัดกลุ่ม `variants` ตาม `menuCode` เรียง `menuSortOrder` แล้วชื่อ · `categories` = `categoryLabel` ไม่ซ้ำตามลำดับเมนู (`categoryLabel` null/ไม่มี = `family`) · `sizes` = ขนาดใน `catalog.sizes` ที่ `isActive` และเมนูมีตัวแปร เรียง `sortOrder` (ADR-0054 — ไม่ตายตัว) · `sweetnessBySize` เรียง 0→100 · ค่าเริ่มต้น: `settings.defaultSize` ถ้าเมนูมี ไม่งั้นขนาดแรก · ความหวาน `settings.defaultSweetness` ถ้าขนาดนั้นมี ไม่งั้นค่าแรก · `payments = { cash: มี 'cash', qr: มี 'qr' }` · `maxQtyPerLine = min(settings.maxQtyPerLine ?? 99, 999)` · `bestSellerCodes` = `select menu_code, sum(qty) from order_item join order … where status='paid' and business_date >= วันเปิดกะ − 6 วัน group by menu_code order by 2 desc limit 8` กรองให้เหลือรหัสที่อยู่ในแคตตาล็อก (D48 Q3-9, D50 Q3-25)

`orders.ts` (12d): `summarize()` เติม `soldById` (= `createdById`), `soldByName` (ชื่อจาก `user`; ไม่พบใช้ `staffDisplayName` จากแคตตาล็อก) · **`cups` รวมจาก `order_item` ด้วย** (review item 19 — `listOrders` อ่าน `order_item` ของบิลในหน้าเดียวกันแบบ `inArray` แล้วรวมกับ `order_line`) · `central` จากแถว outbox `order:<id>` / `order_void:<id>` + คอลัมน์ `central*` ของ `order`:

```ts
type OutboxRow = typeof s.outbox.$inferSelect
function voidStateOf(o: OrderRow, v: OutboxRow | undefined): CentralStateDto['voidState'] {
  if (o.status !== 'voided' || o.soldAt === null) return 'none'
  if (v === undefined || v.status === 'local_only') return 'local_only'
  return v.status === 'sent' ? 'sent' : v.status === 'dead' ? 'problem' : 'pending'
}
function centralState(o: OrderRow, row: OutboxRow | undefined, voidRow: OutboxRow | undefined): CentralStateDto {
  const base = { orderNo: o.centralOrderNo, computedTotalSatang: o.centralComputedTotalSatang,
    diffSatang: centralDiffSatang(o.centralComputedTotalSatang, o.totalSatang), // money math stays in @dayo/domain (review item 18)
    duplicateOf: (o.centralDuplicateOfJson as string[] | null) ?? [], reason: row?.lastError ? decodeLastError(row.lastError).reason : null,
    voidState: voidStateOf(o, voidRow) }
  if (o.soldAt === null) return { ...base, state: 'legacy' }
  if (o.excludedAt !== null) return { ...base, state: 'excluded' }
  if (row?.status === 'sent') return { ...base, state: 'sent' }
  if (row?.status === 'dead') return { ...base, state: 'problem' }
  return { ...base, state: 'pending' }
}
```

`getOrder`: บิลที่มี `order_item` ใช้บรรทัดจาก `order_item` (`productName` = `menuNameTh`, `sizeName` = `size`, `sweetnessName` = `sweetness`, `milk`, `grade`) ไม่งั้นใช้ `order_line` เดิม (`milk`/`grade` = null) · `promotions` จาก `pricingJson.priced.promotionsApplied` · `voidable` เพิ่มเงื่อนไขวันเดียวกัน (บิลที่มี `soldAt`)

`pos-api.ts`: `loadSellCatalog`, `recordSale`, `cancelSale` (ทั้งสามอยู่ใน serial) + ชื่อใน `POS_API_METHODS`

- [ ] **Step 7: ย้ายตัวช่วยเทสต์** — `test/helpers/db.ts`: `openReadyApi = openConnectedApi` (import จาก `./dayo`) · `PINS` คงเดิม (`TungAo: '1111'`, `DCm: '2222'`) · เพิ่ม:

```ts
export async function sellCode(t: ReadyApi, lines: { code: string; size?: Size; sweetness?: Sweetness; milk?: MilkCode; grade?: string | null; qty: number }[], payment: RecordSaleInput['payment'], extra: { billDiscountSatang?: number; reason?: string; channelCode?: string; actorUserId?: string; orderId?: string } = {}): Promise<CommitSaleResult> {
  const cat = await t.api.loadSellCatalog()
  const cart: RecordSaleInput['cart'] = {
    channelCode: extra.channelCode ?? cat.defaultChannelCode, promoCode: null, skipPromotionIds: [], noPromotions: false,
    billDiscount: extra.billDiscountSatang === undefined ? null : { kind: 'satang', satang: extra.billDiscountSatang, reason: extra.reason ?? 'ทดสอบ' },
    lines: lines.map((l) => ({ code: l.code, size: l.size ?? '16 oz', sweetness: l.sweetness ?? '50%', milk: l.milk ?? 'fresh', grade: l.grade ?? (l.code === 'Matcha Latte' ? 'Excellent' : null), qty: l.qty, free: false, discountSatang: null, discountPercent: null, discountReason: null })),
  }
  // the total the screen would show: priceCart at "now" — the same instant recordSale will use (clock does not move)
  const shown = priceCart({ ...cart, paymentCode: payment.method === 'CASH' ? 'cash' : 'qr' }, cat.catalog, t.clock.now())
  return t.api.recordSale({ orderId: extra.orderId ?? t.deps.newId(), actorUserId: extra.actorUserId ?? t.owner.id, cart, payment, expectedTotalSatang: shown.totalSatang })
}
```

`test/helpers/shift.ts` — สถานการณ์ใหม่ที่ **ได้ตัวเลขเดิมทุกตัว** (เทสต์ Z/ปิดกะ/สำรองเดิมจึงไม่ต้องแก้ค่าที่คาด):

```ts
/**
 * One shift of every kind of row (float ฿500), priced with the POS test catalog (e1-catalog-rich):
 * A-000001 Cocoa 16oz ×2 cash ฿90 → voided, not made (VOID_REFUND ฿90)
 * A-000002 Thai Tea 16oz oat ×1 QR ฿50 → voided, made (refund reference KBANK-1, waste)
 * A-000003 Cocoa 16oz ×1 cash ฿45 − ฿5 bill discount = ฿40
 * PAID_OUT ฿20 "ซื้อน้ำแข็ง"
 * → gross 185 · discount 5 · voided 140 · net 40 · cash sales 130 · QR 50 · expected cash 500 + 130 − 90 − 20 = ฿520
 */
export async function sellVoidScenario(t: ReadyApi): Promise<Scenario> {
  const cashVoided = await sellCode(t, [{ code: 'Cocoa', qty: 2 }], { method: 'CASH', tenderedSatang: 10_000 })
  const qrVoided = await sellCode(t, [{ code: 'Thai Tea', milk: 'oat', qty: 1 }], { method: 'PROMPTPAY' })
  const cashKept = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 }, { billDiscountSatang: 500, reason: 'ลูกค้าประจำ' })
  t.clock.advanceMs(60_000)
  const base = { actorUserId: t.owner.id, approverUserId: t.other.id, approverPin: PINS.DCm }
  await t.api.cancelSale({ ...base, orderId: cashVoided.orderId, reason: 'กดผิดเมนู', made: false, refundReference: null })
  await t.api.cancelSale({ ...base, orderId: qrVoided.orderId, reason: 'ทำผิดสูตร', made: true, refundReference: 'KBANK-1' })
  await t.api.recordCashMovement({ actorUserId: t.owner.id, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'ซื้อน้ำแข็ง' })
  return { cashVoided, qrVoided, cashKept }
}
```

(เทสต์เดิมที่ตรวจชื่อสินค้าในบรรทัดบิล (`Original`, `Latte`) หรือการคืนวัตถุดิบ ต้องแก้เป็นชื่อ/พฤติกรรมใหม่ — ทำใน task นี้ · เทสต์ `sale.test.ts`/`void.test.ts` ของ `commitSale`/`voidOrder` เดิมยังใช้ `sellSku` บนแคตตาล็อก Excel ได้จนถึง Task 22)

- [ ] **Step 8: รันให้ผ่าน (ทุกงานย่อย)** — `pnpm --filter @dayo/pos test` → PASS ทั้งแพ็กเกจ (12c: รวม close-shift, shift-report, backup, close-shift-screen ที่ใช้สถานการณ์ใหม่) · `pnpm turbo run typecheck test` → ผ่าน

- [ ] **Step 9: Commit — หนึ่ง commit ต่องานย่อย** (เพิ่มชื่อไฟล์เทสต์เดิมที่แก้ assertion ตาม `git status` · ห้าม `git add -A`)

```bash
# 12a
git add apps/pos/src/db/outbox.ts apps/pos/src/db/events.ts apps/pos/src/db/stock.ts apps/pos/src/api/shift.ts apps/pos/src/api/cash.ts apps/pos/src/api/close.ts apps/pos/src/api/adjust.ts apps/pos/src/api/production.ts apps/pos/src/api/purchase.ts apps/pos/src/api/stock-count.ts apps/pos/src/api/bootstrap.ts apps/pos/test/helpers/stock.ts apps/pos/test/pending-sync.test.ts
git commit -m "feat(pos): queue only dayo push rows and keep shift rows local"
# 12b
git add apps/pos/src/api/sale.ts apps/pos/src/api/sell-catalog.ts apps/pos/src/api/types.ts apps/pos/src/api/pos-api.ts apps/pos/src/api/errors.ts apps/pos/test/helpers/db.ts apps/pos/test/record-sale.test.ts apps/pos/test/sell-catalog.test.ts
git commit -m "feat(pos): sell with dayo's catalog and queue one push row per bill"
# 12c
git add apps/pos/src/api/void.ts apps/pos/src/api/types.ts apps/pos/src/api/pos-api.ts apps/pos/test/helpers/shift.ts apps/pos/test/cancel-sale.test.ts
git commit -m "feat(pos): cancel a bill the same day and queue its void after the bill"
# 12d
git add apps/pos/src/api/orders.ts apps/pos/src/api/types.ts apps/pos/test/orders-central.test.ts
git commit -m "feat(pos): show who sold each bill and how dayo recorded it"
```

---

### Task 13: ตัวส่ง outbox → `POST /v1/pos/push` (คำตัดสินรายแถว)

ผู้ทำ: sync-engineer (opus) · ผู้ตรวจเพิ่ม: **security-reviewer** · สเปก §4.5 (คำตอบ), §6.2, §6.3, §6.7 · ruling R3, R4 · รอ Task 12

**ปรับตาม dayo (สเปก §4.5 · §13.6 S10–S15 · ใช้ mock ของ A3)** — ไม่มีการเปลี่ยนโค้ดตัวส่ง มีแต่เทสต์ที่ต้องเพิ่มให้ครอบพฤติกรรมจริง: (1) key ไม่มี `orders:write` = **403 ทั้งคำขอ** → `apiState = 'forbidden'` หยุดส่งทั้งหมด (ไม่ใช่แถว `FORBIDDEN`) (2) `sale_date` วันพรุ่งนี้ของเซิร์ฟเวอร์ = `deferred CLOCK_AHEAD` → ทำตาม R3 (ไม่นับครั้ง ไม่ตาย) (3) `order_void` เก่ากว่า 60 วัน = `rejected INVALID` → หน้า "ส่งไม่ผ่าน" (4) บิลที่ใช้โปรที่ dayo ปิดก่อน `sold_at` = `accepted` แต่ `central_computed_total_satang ≠ total_satang` → ขึ้นใน `listPriceDiffs` (Task 15) ไม่ใช่ความผิดของตัวส่ง

**Files:**
- Create: `apps/pos/src/sync/push.ts`
- Test: `apps/pos/test/push.test.ts`, `apps/pos/test/push-bytes.test.ts`

**Interfaces:**
- Consumes: `SyncContext`, `readDayoConfig`, `readSupported`, `recordDayoFailure` (Task 10) · `createDayoClient`, `DayoError` (Task 9) · state helpers (Task 9) · `isRowSupported`, `MAX_PUSH_ROWS`, `MAX_PUSH_BODY_BYTES`, `OrderAcceptedData`, `clipCodePoints` (Task 5) · `edgeBahtToSatang` (Task 1)
- Produces:

```ts
export type PushOutcome = { requests: number; sent: number; rejected: number; deferred: number; held: number; noAnswer: number; stopped: null | 'not_linked' | 'no_supported_list' | 'api_blocked' | 'backoff' | DayoFailure['kind'] }
export async function pushOnce(ctx: SyncContext): Promise<PushOutcome>
export async function retryRow(db: RemoteDb, outboxId: string): Promise<void>   // dead → pending, attempts 0, children PARENT_REJECTED → pending (Task 15 uses)
export async function clearFailureBackoff(db: RemoteDb): Promise<void>          // Task 14: online/manual/open/before_close wakes forget network/5xx backoff (never 429's Retry-After)
export const CLOCK_AHEAD_FAR_MS = 86_400_000                                    // R3 + ruling N5: a row more than 24 h ahead stays pending, gets lastError.farAhead and raises the owner-only alert — never dead, never excluded by itself
```

กติกา (ตรงสเปก — ห้ามตีความใหม่):

| สถานการณ์ | ทำอะไร |
|---|---|
| ยังไม่ได้ตั้ง key/base URL · ยังไม่เคยได้ `supported_*` จาก E1 | ไม่ส่ง (`not_linked` / `no_supported_list`) |
| `dayo.api_state` = `unauthorized`/`forbidden` | ไม่ส่งเลยจนเจ้าของตั้ง key ใหม่ (`api_blocked`) |
| `disabled` และยังไม่ถึง `dayo.api_retry_at` | ไม่ส่ง (`api_blocked`) · ถึงเวลาแล้วลองได้ |
| ยังไม่ถึง `dayo.push_backoff_until` | ไม่ส่ง (`backoff`) · **backoff ที่มาจากเน็ตหลุด/5xx (`push_backoff_reason = failure`) ถูกล้างเมื่อปลุกด้วย `online`/`manual` (ปุ่ม "ส่งตอนนี้")/`open`/`before_close`** (Task 14 · review item 2) · backoff ของ 429 (Retry-After) ไม่ถูกล้าง |
| เลือกแถว | `status='pending'` · ชนิด `order`/`order_void` · `next_attempt_at` ว่างหรือ ≤ ตอนนี้ · เรียง `created_at`, `id` · ≤ 20 แถว (หรือ 1 เมื่ออยู่ในโหมดทีละแถว) · body ≤ 262,144 ไบต์ UTF-8 · อ่านทีละหน้า 200 แถวต่อไปเรื่อย ๆ จนได้ก้อนหรือหมดคิว — แถวที่ถูกพักจำนวนมากต้องไม่บังแถวที่ส่งได้ (review item 20 · กฎเหล็กข้อ 5) |
| แถวที่ชนิด/ฟิลด์ไม่อยู่ใน `supported_*` หรือเคยได้ `UNSUPPORTED` ภายใต้รายการเดิม | ข้าม ไม่นับครั้ง (held) |
| `order_void` ที่แถวแม่ยังไม่ `sent` และไม่อยู่ก่อนหน้าในก้อนเดียวกัน | ข้าม (รอ) · แม่ `dead` → ลูก `dead PARENT_REJECTED` ทันที · แม่ `local_only` (ถูกปิดนอกระบบกลาง) → ลูก `local_only` |
| แถวเดียวใหญ่เกิน 256 KB | `dead ENVELOPE` |
| `accepted` / `duplicate` | `sent` + `result_json` · บิล: `central_order_no`, `central_computed_total_satang` (= `edgeBahtToSatang(computed_total)`), `central_amount_mismatch`, `central_duplicate_of_json` |
| `rejected` | `dead` + เหตุผล/`detail` · ลูกที่รออยู่ → `dead PARENT_REJECTED` — **ทำหลังจบลูปคำตัดสินของก้อนนั้น** และทุก update ในธุรกรรมแตะเฉพาะแถวที่ยัง `pending` (ไม่เขียนทับคำตัดสินก่อนหน้าในก้อนเดียวกัน — review item 3) |
| `deferred UNSUPPORTED` | ไม่นับครั้ง · จำ hash ของรายการ `supported` ปัจจุบัน → รอจนรายการเปลี่ยน |
| `deferred CLOCK_AHEAD` | ไม่นับครั้ง (R3) · `dayo.clock_ahead_at` = ตอนนี้ · ลองใหม่อีก 60 วิ · **เวลาในแถวล้ำ `server_time` เกิน 24 ชม.** = ยัง `pending` (ลองทุก 60 วิ) + `lastError.farAhead = true` → แถบเตือน owner `banner-clock-far-ahead` และการ์ด "รอเวลา" ในหน้า "ส่งไม่ผ่าน" ที่ owner กด EXCLUDE เองได้ — **ไม่ตาย ไม่ปิดเอง** (คำตัดสินหัวหน้า N5) |
| `deferred PARENT_PENDING` ของแถวลูกที่แถวแม่ในเครื่องยังไม่ `sent` (เช่น แม่ถูกเลื่อนในก้อนเดียวกัน) | ไม่นับครั้ง · `next_attempt_at` ว่าง (กติกาแถวลูกรอแม่คุมอยู่แล้ว) · ถ้าแม่ในเครื่อง `sent` แล้วแต่ dayo ยังตอบ PARENT_PENDING = นับครั้งตามแถวถัดไป (review item 12) |
| `deferred` อื่น | ครั้ง+1 · ครบ 50 = `dead STUCK` · ไม่งั้น `next_attempt_at` = ตอนนี้ + backoff(ครั้ง) |
| ไม่มีคำตัดสิน / `status` ที่ไม่รู้จัก / key ซ้ำในคำตอบ | ไม่นับครั้ง · `last_error` บอกเหตุ · `next_attempt_at` = +60 วิ |
| เน็ตหลุด/timeout/5xx/200 ที่อ่านไม่ได้ | streak+1 · `push_backoff_until` = ตอนนี้ + backoff(streak) · `push_backoff_reason = failure` · 5xx ติดกันครบ 3 และก้อน > 1 แถว → โหมดทีละแถวจนแถวของก้อนนั้นถูกตัดสินหมด (R4) |
| 422 | ก้อน > 1 → โหมดทีละแถว (R4) · ก้อน 1 แถว → แถวนั้น `dead ENVELOPE` · คิวเดินต่อ |
| 429 | `push_backoff_until` = ตอนนี้ + Retry-After (หรือ 60 วิ) · `push_backoff_reason = rate_limited` |
| 401 / 403 / 404 | `recordDayoFailure` (Task 10) แล้วหยุด |
| คำตอบ 200 | streak = 0 · `api_state = ok` · บันทึกนาฬิกาจาก `server_time` · `last_push_at` |

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/test/push.test.ts`

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { clearFailureBackoff, pushOnce, retryRow } from '../src/sync/push'
import { DAYO_KEYS, readKey } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

async function ready(now?: string) {
  const t = await openConnectedApi(now === undefined ? {} : { now })
  return { t, ctx: { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() } }
}
const cocoa = (t: Awaited<ReturnType<typeof ready>>['t']) => sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
const outbox = async (t: Awaited<ReturnType<typeof ready>>['t']) => t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order')).all()

describe('pushOnce (spec 04 §6.2–6.3)', () => {
  it('sends pending bills and stores dayo order numbers', async () => {
    const { t, ctx } = await ready()
    await cocoa(t); await cocoa(t); await cocoa(t)
    expect(await pushOnce(ctx)).toMatchObject({ requests: 1, sent: 3, stopped: null })
    expect((await t.db.select().from(s.order).all()).map((o) => o.centralOrderNo).sort()).toEqual(['L260925-001', 'L260925-002', 'L260925-003'])
    expect(await t.api.bootstrap()).toMatchObject({ pendingSyncItems: 0 })
  })
  it('25 bills go in requests of 20 and 5', async () => {
    const { t, ctx } = await ready()
    for (let i = 0; i < 25; i++) await cocoa(t)
    await pushOnce(ctx)
    expect(t.mock.requests().filter((r) => r.path === '/api/v1/pos/push').map((r) => r.rows)).toEqual([20, 5])
  })
  it('a bill voided before it was sent goes out first, then its void, in one request', async () => {
    const { t, ctx } = await ready()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'กดผิด', made: false, refundReference: null })
    expect(await pushOnce(ctx)).toMatchObject({ requests: 1, sent: 2 })
    expect(t.mock.orders()).toEqual([expect.objectContaining({ receiptNo: 'A-000001', status: 'cancelled' })])
  })
  it('a void waits while its bill is deferred, then follows it', async () => {
    const { t, ctx } = await ready()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'กดผิด', made: false, refundReference: null })
    t.mock.override({ match: { key: `order:${r.orderId}` }, verdict: { status: 'deferred', reason: 'BUSY', detail: 'lock' }, times: 1 })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 0, deferred: 2 }) // same batch: bill BUSY, void PARENT_PENDING from dayo
    const voidRow = (await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_void')).get())!
    expect(voidRow).toMatchObject({ status: 'pending', attempts: 0, nextAttemptAt: null }) // not counted while its bill is not sent (review item 12)
    t.clock.advanceMs(5_000)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 2 })
  })
  it('a rejected bill goes to "ส่งไม่ผ่าน", its void follows it there, the queue keeps moving', async () => {
    const { t, ctx } = await ready()
    const bad = await cocoa(t)
    await t.api.cancelSale({ orderId: bad.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'x', made: false, refundReference: 'K1' })
    await cocoa(t)
    t.mock.override({ match: { receiptNo: 'A-000001' }, verdict: { status: 'rejected', reason: 'UNKNOWN_CODE', detail: 'ไม่พบรหัสเมนู Cocoa' }, times: 1 })
    const o = await pushOnce(ctx)
    expect(o).toMatchObject({ rejected: 1, sent: 1 })
    const rows = await t.db.select().from(s.outbox).where(eq(s.outbox.status, 'dead')).all()
    // the void was in the SAME batch and got its own PARENT_PENDING verdict — it must still end as PARENT_REJECTED (review item 3)
    expect(rows.map((r) => [r.tableName, JSON.parse(r.lastError!).reason])).toEqual([['order', 'UNKNOWN_CODE'], ['order_void', 'PARENT_REJECTED']])
    await retryRow(t.db, rows[0]!.id) // the owner fixes the bill → both go back to the queue
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.status, 'pending')).all()).map((r) => r.tableName).sort()).toEqual(['order', 'order_void'])
  })
  it('deferred rows back off 5 s, 15 s, … and become STUCK after 50 tries', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.override({ match: { receiptNo: 'A-000001' }, verdict: { status: 'deferred', reason: 'BUSY' }, times: 60 })
    await pushOnce(ctx)
    const first = (await outbox(t))[0]!
    expect(first.attempts).toBe(1)
    expect(Date.parse(first.nextAttemptAt!) - Date.parse(t.clock.now())).toBe(5_000) // random 0.5 → no jitter
    for (let i = 0; i < 49; i++) { t.clock.advanceMs(900_000); await pushOnce(ctx) }
    expect((await outbox(t))[0]).toMatchObject({ status: 'dead', attempts: 50 })
    expect(JSON.parse((await outbox(t))[0]!.lastError!).reason).toBe('STUCK')
  })
  it('CLOCK_AHEAD does not count a try and raises the clock warning (ruling R3, D80)', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.override({ match: { receiptNo: 'A-000001' }, verdict: { status: 'deferred', reason: 'CLOCK_AHEAD' }, times: 1 })
    await pushOnce(ctx)
    expect((await outbox(t))[0]!.attempts).toBe(0)
    expect(await readKey(t.db, DAYO_KEYS.clockAheadAt)).not.toBeNull()
  })
  it('a row more than 24 h ahead stays pending and is only flagged — never dead, never excluded by itself (R3, ruling N5)', async () => {
    const { t, ctx } = await ready('2026-09-27T03:00:00.000Z') // tablet clock 2 days fast
    await cocoa(t)
    t.mock.setNow('2026-09-25T03:00:00.000Z')
    await pushOnce(ctx)
    const [row] = await outbox(t)
    expect(row).toMatchObject({ status: 'pending', attempts: 0 })
    expect(JSON.parse(row!.lastError!)).toMatchObject({ reason: 'CLOCK_AHEAD', farAhead: true })
    t.clock.advanceMs(25 * 3_600_000) // a day later it is still waiting, still pending
    await pushOnce(ctx)
    expect((await outbox(t))[0]).toMatchObject({ status: 'pending' })
  })
  /** Fails `n` requests in a row, waiting out each backoff so the streak really grows (N4). */
  async function buildBackoff(t: Awaited<ReturnType<typeof ready>>['t'], ctx: Parameters<typeof pushOnce>[0], n: number) {
    for (let i = 1; i <= n; i++) {
      const until = await readKey(t.db, DAYO_KEYS.pushBackoffUntil)
      if (until !== null) t.clock.advanceMs(Math.max(0, Date.parse(until) - Date.parse(t.clock.now())) + 1)
      expect((await pushOnce(ctx)).stopped).not.toBe('backoff') // a real attempt
      expect(await readKey(t.db, DAYO_KEYS.pushFailStreak)).toBe(String(i))
    }
  }
  it('after going back online the queue is sent at once, not after the failure backoff (review item 2)', async () => {
    const { t } = await ready()
    for (let i = 0; i < 5; i++) await cocoa(t)
    let online = false
    const f: typeof fetch = async (input, init) => { if (!online) throw new TypeError('Failed to fetch'); return t.mock.fetch(input, init) }
    const ctx = { db: t.db, deps: { ...t.deps, fetch: f }, serial: <T>(fn: () => Promise<T>) => fn() }
    await buildBackoff(t, ctx, 4) // 5 s → 15 s → 1 min → 5 min (N4: a real multi-minute backoff)
    const until = (await readKey(t.db, DAYO_KEYS.pushBackoffUntil))!
    expect(Date.parse(until) - Date.parse(t.clock.now())).toBeGreaterThanOrEqual(240_000) // 5 min − 20 %
    expect((await pushOnce(ctx)).stopped).toBe('backoff')
    online = true
    await clearFailureBackoff(t.db) // what the scheduler does on 'online' (Task 14)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 5 })
  })
  it('clearFailureBackoff keeps a 429 Retry-After', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.setMode('rate_limited')
    await pushOnce(ctx)
    t.mock.setMode('normal')
    await clearFailureBackoff(t.db)
    expect((await pushOnce(ctx)).stopped).toBe('backoff')
  })
  it('rows using a field dayo does not list are held and never counted (spec §4.4 rule 10)', async () => {
    const { t, ctx } = await ready()
    t.mock.bumpCatalog((c) => { c.supported_fields.order = c.supported_fields.order!.filter((f) => f !== 'note') })
    const { pullCatalog } = await import('../src/sync/catalog')
    await pullCatalog(ctx)
    await cocoa(t)
    expect(await pushOnce(ctx)).toMatchObject({ requests: 0, held: 1 })
    t.mock.bumpCatalog((c) => { c.supported_fields.order!.push('note') })
    await pullCatalog(ctx)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('401 stops every later send until a new key (spec §6.3)', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.setMode('unauthorized')
    expect((await pushOnce(ctx)).stopped).toBe('unauthorized')
    t.mock.setMode('normal')
    const before = t.mock.requests().length // the mock logs refused requests too (status 401)
    expect(t.mock.requests().at(-1)?.status).toBe(401)
    expect((await pushOnce(ctx)).stopped).toBe('api_blocked')
    expect(t.mock.requests().length).toBe(before)
  })
  it('404 = API switched off: wait 15 minutes, then try again', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.setMode('api_disabled')
    await pushOnce(ctx)
    t.mock.setMode('normal')
    expect((await pushOnce(ctx)).stopped).toBe('api_blocked')
    t.clock.advanceMs(15 * 60_000)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('429 waits for Retry-After', async () => {
    const { t, ctx } = await ready()
    await cocoa(t)
    t.mock.setMode('rate_limited')
    await pushOnce(ctx)
    t.mock.setMode('normal')
    expect((await pushOnce(ctx)).stopped).toBe('backoff')
    t.clock.advanceMs(30_000)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('three 5xx in a row → one row per request until that batch is decided (ruling R4)', async () => {
    const { t, ctx } = await ready()
    for (let i = 0; i < 3; i++) await cocoa(t)
    t.mock.setMode('server_down')
    for (let i = 0; i < 3; i++) { await pushOnce(ctx); t.clock.advanceMs(900_000) }
    t.mock.setMode('normal')
    await pushOnce(ctx)
    expect(t.mock.requests().filter((r) => r.path === '/api/v1/pos/push').slice(-3).map((r) => r.rows)).toEqual([1, 1, 1])
  })
  it('422 on a batch → one by one; the row that still fails alone goes to ENVELOPE', async () => {
    const { t } = await ready()
    for (let i = 0; i < 3; i++) await cocoa(t)
    const fetch422: typeof fetch = async (input, init) => (String(init?.body).includes('A-000002') ? new Response(JSON.stringify({ ok: false, error: { code: 'DY422', message: 'invalid' } }), { status: 422 }) : t.mock.fetch(input, init))
    const ctx = { db: t.db, deps: { ...t.deps, fetch: fetch422 }, serial: <T>(fn: () => Promise<T>) => fn() }
    await pushOnce(ctx)
    for (let i = 0; i < 3; i++) await pushOnce(ctx)
    const rows = await outbox(t)
    expect(rows.map((r) => [r.status, r.lastError === null ? null : JSON.parse(r.lastError).reason])).toEqual([['sent', null], ['dead', 'ENVELOPE'], ['sent', null]])
  })
  it('a row without a verdict (or with an unknown status) is retried without spending a try (plan 5 H-2/M-2)', async () => {
    const { t } = await ready()
    await cocoa(t)
    const silent: typeof fetch = async (input, init) => { const r = await t.mock.fetch(input, init); const b = await r.json() as { data: { results: unknown[] } }; b.data.results = []; return new Response(JSON.stringify(b), { status: 200 }) }
    const ctx = { db: t.db, deps: { ...t.deps, fetch: silent }, serial: <T>(fn: () => Promise<T>) => fn() }
    expect(await pushOnce(ctx)).toMatchObject({ noAnswer: 1 })
    expect((await outbox(t))[0]).toMatchObject({ status: 'pending', attempts: 0 })
  })
})
```

`apps/pos/test/push-bytes.test.ts` (ขนาด body — spec §6.2 · และหน้าต่างที่ถูกพัก — review item 20):

```ts
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { OrderRowData } from '@dayo/contracts'
import { pushOnce } from '../src/sync/push'
import { openConnectedApi, STAFF } from './helpers/dayo'

const uuid = (n: number): string => `aaaaaaaa-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
function bigRow(n: number): OrderRowData {
  return OrderRowData.parse({
    pos_order_id: uuid(n), receipt_no: `A-${String(n).padStart(6, '0')}`, queue_no: n, sale_date: '2026-09-25', sold_at: '2026-09-25T03:00:00.000Z',
    channel: 'store', payment: 'cash', staff_id: STAFF.TungAo, catalog_version: 42, shift_id: null,
    lines: Array.from({ length: 50 }, () => ({ code: 'ก'.repeat(100), size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1 })), // ~20 KB of Thai per row
    bill_discount: null, promo_code: null, skip_promotion_ids: [], no_promotions: false,
    totals: { items_subtotal: 35, items_discount: 0, bill_discount: 0, total: 35 }, note: null,
  })
}
async function insertRows(t: Awaited<ReturnType<typeof openConnectedApi>>, from: number, count: number, shape: (row: OrderRowData) => Record<string, unknown> = (r) => r) {
  for (let n = from; n < from + count; n++) {
    const createdAt = new Date(Date.parse('2026-09-25T03:00:00.000Z') + n).toISOString() // strictly increasing, FIFO by n
    await t.db.insert(s.outbox).values({ id: uuid(n), tableName: 'order', rowJson: shape(bigRow(n)), idempotencyKey: `order:${uuid(n)}`, status: 'pending', createdAt, attempts: 0, lastError: null, sentAt: null, deadAt: null, nextAttemptAt: null, parentKey: null, resultJson: null })
  }
}

describe('push body size and the pick window', () => {
  it('never sends a body over 262,144 UTF-8 bytes and keeps FIFO order', async () => {
    const t = await openConnectedApi()
    await insertRows(t, 1, 20)
    const sizes: number[] = []
    const keys: string[] = []
    const spy: typeof fetch = async (input, init) => {
      const body = String(init?.body ?? '')
      sizes.push(new TextEncoder().encode(body).length)
      keys.push(...(JSON.parse(body) as { rows: { key: string }[] }).rows.map((r) => r.key))
      return t.mock.fetch(input, init)
    }
    await pushOnce({ db: t.db, deps: { ...t.deps, fetch: spy }, serial: (fn) => fn() })
    expect(sizes.length).toBeGreaterThan(1)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(262_144)
    expect(keys).toEqual(Array.from({ length: 20 }, (_, i) => `order:${uuid(i + 1)}`))
  })
  it('250 rows parked as UNSUPPORTED in front do not hide a sendable row behind them', async () => {
    const t = await openConnectedApi()
    await insertRows(t, 1, 250, (r) => ({ ...r, tip: 5 })) // a field dayo does not list → held by isRowSupported
    await insertRows(t, 251, 1, (r) => ({ ...r, lines: [{ code: 'Cocoa', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1 }] }))
    const o = await pushOnce({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    expect(o).toMatchObject({ requests: 1, sent: 1, held: 250 })
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos test -- push` · คาดว่า FAIL

- [ ] **Step 3: เขียนโค้ด** — `apps/pos/src/sync/push.ts`

```ts
import { and, asc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { clipCodePoints, isRowSupported, MAX_PUSH_BODY_BYTES, MAX_PUSH_ROWS, OrderAcceptedData, type PushRequest, type ReceivedRowResult, type Supported } from '@dayo/contracts'
import { edgeBahtToSatang } from '@dayo/domain'
import type { ApiDeps } from '../api/deps'
import { apiBlocked, readDayoConfig, readSupported, recordDayoFailure, type SyncContext } from './catalog'
import { createDayoClient, DayoError, type DayoFailure, type Timed } from './dayo-client'
import { backoffMs, DAYO_KEYS, decodeLastError, deleteKey, encodeLastError, NO_ANSWER_RETRY_MS, readKey, recordServerTime, STUCK_AFTER_ATTEMPTS, writeKey } from './state'

export type PushOutcome = { requests: number; sent: number; rejected: number; deferred: number; held: number; noAnswer: number; stopped: null | 'not_linked' | 'no_supported_list' | 'api_blocked' | 'backoff' | DayoFailure['kind'] }
type Row = typeof s.outbox.$inferSelect

/** plan 5 fix M-2: only these mean dayo stored the row. */
const KNOWN_SUCCESS = new Set(['accepted', 'duplicate'])
const utf8 = new TextEncoder()
const ENVELOPE_BYTES = 80 // {"device_time":"2026-…Z","rows":[]}
const MAX_ROUNDS_PER_CALL = 15 // ≤ 300 rows per call; the scheduler calls again (bounds the time one call can take)
const rowBytes = (r: Row): number => utf8.encode(JSON.stringify({ key: r.idempotencyKey, kind: r.tableName, data: r.rowJson })).length + 1
const hashOf = (sup: Supported): string => JSON.stringify(sup)
const later = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString()
export const CLOCK_AHEAD_FAR_MS = 86_400_000
const PAGE = 200

async function markDead(db: RemoteDb, r: Row, at: string, reason: string, detail: string, attempts = r.attempts): Promise<void> {
  await db.update(s.outbox).set({ status: 'dead', deadAt: at, attempts, nextAttemptAt: null, lastError: encodeLastError(reason, detail) }).where(eq(s.outbox.id, r.id))
}

/** A parent that became dead takes its waiting children with it (spec §4.5 table: PARENT_REJECTED). */
async function cascadeChildren(db: RemoteDb, parentKey: string, at: string): Promise<void> {
  const kids = await db.select().from(s.outbox).where(and(eq(s.outbox.parentKey, parentKey), eq(s.outbox.status, 'pending'))).all()
  for (const k of kids) await markDead(db, k, at, 'PARENT_REJECTED', `แถวแม่ ${parentKey} ส่งไม่ผ่าน — จะส่งเองเมื่อแถวแม่ผ่าน`)
}

/** ruling R4: stay at one row per request until every row up to the failed batch's last row is decided. */
async function batchSize(db: RemoteDb): Promise<number> {
  const raw = await readKey(db, DAYO_KEYS.pushSingleThrough)
  if (raw === null) return MAX_PUSH_ROWS
  const m = JSON.parse(raw) as { createdAt: string; id: string }
  const left = await db.select({ id: s.outbox.id }).from(s.outbox)
    .where(and(eq(s.outbox.status, 'pending'), inArray(s.outbox.tableName, ['order', 'order_void']), or(lte(s.outbox.createdAt, m.createdAt)))).limit(1).get()
  if (left === undefined) { await deleteKey(db, DAYO_KEYS.pushSingleThrough); return MAX_PUSH_ROWS }
  return 1
}

/** Reads the queue page by page (keyset on created_at, id) until a batch is full or the queue ends (review item 20). */
async function* pendingRows(db: RemoteDb, nowIso: string): AsyncGenerator<Row> {
  let after: { createdAt: string; id: string } | null = null
  for (;;) {
    const page = await db.select().from(s.outbox)
      .where(and(eq(s.outbox.status, 'pending'), inArray(s.outbox.tableName, ['order', 'order_void']), or(isNull(s.outbox.nextAttemptAt), lte(s.outbox.nextAttemptAt, nowIso)),
        after === null ? undefined : or(gt(s.outbox.createdAt, after.createdAt), and(eq(s.outbox.createdAt, after.createdAt), gt(s.outbox.id, after.id)))))
      .orderBy(asc(s.outbox.createdAt), asc(s.outbox.id)).limit(PAGE).all()
    for (const r of page) yield r
    if (page.length < PAGE) return
    after = { createdAt: page.at(-1)!.createdAt, id: page.at(-1)!.id }
  }
}

async function pickBatch(db: RemoteDb, nowIso: string, sup: Supported, size: number, decided: Set<string>): Promise<{ batch: Row[]; held: number }> {
  const batch: Row[] = []
  const inBatch = new Set<string>()
  let bytes = ENVELOPE_BYTES
  let held = 0
  for await (const r of pendingRows(db, nowIso)) {
    if (decided.has(r.id)) continue
    const last = decodeLastError(r.lastError)
    if (!isRowSupported(r.tableName, r.rowJson as Record<string, unknown>, sup) || (last.reason === 'UNSUPPORTED' && last.supportedHash === hashOf(sup))) { held++; continue }
    if (r.parentKey !== null && !inBatch.has(r.parentKey)) {
      const parent = await db.select({ status: s.outbox.status }).from(s.outbox).where(eq(s.outbox.idempotencyKey, r.parentKey)).get()
      if (parent?.status === 'dead') { await markDead(db, r, nowIso, 'PARENT_REJECTED', `แถวแม่ ${r.parentKey} ส่งไม่ผ่าน`); decided.add(r.id); continue }
      if (parent?.status === 'local_only') { await db.update(s.outbox).set({ status: 'local_only' }).where(eq(s.outbox.id, r.id)); decided.add(r.id); continue }
      if (parent !== undefined && parent.status !== 'sent') continue // wait for the parent
    }
    const b = rowBytes(r)
    if (ENVELOPE_BYTES + b > MAX_PUSH_BODY_BYTES) { await markDead(db, r, nowIso, 'ENVELOPE', 'แถวนี้ใหญ่เกิน 256 KB'); decided.add(r.id); continue }
    if (bytes + b > MAX_PUSH_BODY_BYTES) break
    batch.push(r)
    inBatch.add(r.idempotencyKey)
    bytes += b
    if (batch.length >= size) break
  }
  return { batch, held }
}

async function gate(db: RemoteDb, deps: ApiDeps): Promise<{ cfg: { baseUrl: string; apiKey: string } | null; sup: Supported | null; blocked: PushOutcome['stopped'] }> {
  const cfg = await readDayoConfig(db, deps)
  if (cfg === null) return { cfg, sup: null, blocked: 'not_linked' }
  const now = deps.now()
  if (await apiBlocked(db, now)) return { cfg, sup: null, blocked: 'api_blocked' } // same gate as E1/E3 (Task 10)
  if ((await readKey(db, DAYO_KEYS.pushBackoffUntil) ?? '') > now) return { cfg, sup: null, blocked: 'backoff' }
  const sup = await readSupported(db)
  return { cfg, sup, blocked: sup === null ? 'no_supported_list' : null }
}

async function onRequestFailure(db: RemoteDb, deps: ApiDeps, f: DayoFailure, batch: Row[]): Promise<void> {
  const now = deps.now()
  const lastOfBatch = JSON.stringify({ createdAt: batch.at(-1)!.createdAt, id: batch.at(-1)!.id })
  switch (f.kind) {
    case 'unauthorized': case 'forbidden': case 'api_disabled':
      await recordDayoFailure(db, deps, f); return
    case 'rate_limited':
      await writeKey(db, DAYO_KEYS.pushBackoffUntil, later(now, f.retryAfterMs))
      await writeKey(db, DAYO_KEYS.pushBackoffReason, 'rate_limited'); return
    case 'bad_envelope':
      if (batch.length > 1) await writeKey(db, DAYO_KEYS.pushSingleThrough, lastOfBatch)
      else await markDead(db, batch[0]!, now, 'ENVELOPE', f.message) // the queue moves on (spec §6.3 row 422)
      return
    default: { // network, server, bad_response: whole-request retry with backoff (spec §6.3 row 1)
      const streak = Number(await readKey(db, DAYO_KEYS.pushFailStreak) ?? '0') + 1
      await writeKey(db, DAYO_KEYS.pushFailStreak, String(streak))
      await writeKey(db, DAYO_KEYS.pushBackoffUntil, later(now, backoffMs(streak, deps.random)))
      await writeKey(db, DAYO_KEYS.pushBackoffReason, 'failure')
      if (f.kind === 'server' && streak >= 3 && batch.length > 1) await writeKey(db, DAYO_KEYS.pushSingleThrough, lastOfBatch)
    }
  }
}

async function markSent(db: RemoteDb, r: Row, v: ReceivedRowResult, at: string): Promise<void> {
  await db.update(s.outbox).set({ status: 'sent', sentAt: at, attempts: r.attempts + 1, lastError: null, nextAttemptAt: null, resultJson: (v.data ?? null) as never }).where(eq(s.outbox.id, r.id))
  if (r.tableName !== 'order') return
  const d = OrderAcceptedData.safeParse(v.data)
  if (!d.success) return // stored by dayo all the same; the bill just shows no central number
  let computed: number | null = null
  try { computed = edgeBahtToSatang(d.data.computed_total) } catch { computed = null }
  await db.update(s.order).set({ centralOrderNo: d.data.order_no, centralComputedTotalSatang: computed, centralAmountMismatch: d.data.amount_mismatch, centralDuplicateOfJson: d.data.duplicate_of })
    .where(eq(s.order.id, String((r.rowJson as { pos_order_id: string }).pos_order_id)))
}

async function markDeferred(db: RemoteDb, deps: ApiDeps, r: Row, v: ReceivedRowResult, at: string, sup: Supported, serverTime: string): Promise<void> {
  const reason = v.reason ?? 'DEFERRED'
  const detail = v.detail ?? ''
  if (reason === 'PARENT_PENDING' && r.parentKey !== null) {
    const parent = await db.select({ status: s.outbox.status }).from(s.outbox).where(eq(s.outbox.idempotencyKey, r.parentKey)).get()
    if (parent?.status !== 'sent') { // its bill is still on its way here — the child-waits-for-parent rule holds it; no try spent (review item 12)
      await db.update(s.outbox).set({ lastError: encodeLastError(reason, detail), nextAttemptAt: null }).where(eq(s.outbox.id, r.id))
      return
    }
  }
  if (reason === 'UNSUPPORTED') {
    await db.update(s.outbox).set({ lastError: encodeLastError(reason, detail, { supportedHash: hashOf(sup) }), nextAttemptAt: null }).where(eq(s.outbox.id, r.id))
    return
  }
  if (reason === 'CLOCK_AHEAD') { // ruling R3: not counted; the banner is the signal (D80)
    await writeKey(db, DAYO_KEYS.clockAheadAt, at)
    const data = r.rowJson as { sold_at?: string; voided_at?: string }
    const rowTime = Date.parse(data.sold_at ?? data.voided_at ?? at)
    // ruling N5: far ahead (> 24 h) is only FLAGGED — the row stays pending and keeps retrying; EXCLUDE is the owner's manual choice
    const farAhead = rowTime - Date.parse(serverTime) > CLOCK_AHEAD_FAR_MS
    const text = farAhead ? `เวลาในแถวล้ำระบบกลางเกิน 24 ชม. — ${detail}` : detail
    await db.update(s.outbox).set({ lastError: encodeLastError(reason, text, farAhead ? { farAhead: true } : {}), nextAttemptAt: later(at, NO_ANSWER_RETRY_MS) }).where(eq(s.outbox.id, r.id))
    return
  }
  const attempts = r.attempts + 1
  if (attempts >= STUCK_AFTER_ATTEMPTS) { await markDead(db, r, at, 'STUCK', `${reason}: ${detail}`, attempts); return }
  await db.update(s.outbox).set({ attempts, lastError: encodeLastError(reason, detail), nextAttemptAt: later(at, backoffMs(attempts, deps.random)) }).where(eq(s.outbox.id, r.id))
}

async function applyVerdicts(db: RemoteDb, deps: ApiDeps, batch: Row[], answer: Timed<{ server_time: string; results: ReceivedRowResult[] }>, sup: Supported): Promise<Pick<PushOutcome, 'sent' | 'rejected' | 'deferred' | 'noAnswer'>> {
  return db.transaction(async (tx) => {
    const at = deps.now()
    await recordServerTime(tx, answer.value.server_time, answer.sentAtMs, answer.receivedAtMs, at)
    await writeKey(tx, DAYO_KEYS.apiState, 'ok')
    await writeKey(tx, DAYO_KEYS.lastPushAt, at)
    await deleteKey(tx, DAYO_KEYS.pushFailStreak)
    await deleteKey(tx, DAYO_KEYS.pushBackoffUntil)
    await deleteKey(tx, DAYO_KEYS.pushBackoffReason)
    const byKey = new Map<string, ReceivedRowResult>()
    const twice = new Set<string>()
    for (const v of answer.value.results) { if (byKey.has(v.key)) twice.add(v.key); byKey.set(v.key, v) } // match by key, never by position (spec §6.2)
    const t = { sent: 0, rejected: 0, deferred: 0, noAnswer: 0 }
    const rejectedKeys: string[] = []
    for (const r of batch) {
      // review item 3: only a row still pending in THIS transaction is judged — an earlier decision in the batch is never overwritten
      if ((await tx.select({ status: s.outbox.status }).from(s.outbox).where(eq(s.outbox.id, r.id)).get())?.status !== 'pending') continue
      const v = twice.has(r.idempotencyKey) ? undefined : byKey.get(r.idempotencyKey)
      if (v !== undefined && KNOWN_SUCCESS.has(v.status)) { await markSent(tx, r, v, at); t.sent++ }
      else if (v?.status === 'rejected') { await markDead(tx, r, at, v.reason ?? 'REJECTED', v.detail ?? '', r.attempts + 1); rejectedKeys.push(r.idempotencyKey); t.rejected++ }
      else if (v?.status === 'deferred') { await markDeferred(tx, deps, r, v, at, sup, answer.value.server_time); t.deferred++ }
      else {
        const reason = twice.has(r.idempotencyKey) ? 'DUPLICATE_VERDICT' : v === undefined ? 'NO_ANSWER' : `UNKNOWN_STATUS:${clipCodePoints(v.status, 40)}`
        await tx.update(s.outbox).set({ lastError: encodeLastError(reason, v?.detail ?? ''), nextAttemptAt: later(at, NO_ANSWER_RETRY_MS) }).where(eq(s.outbox.id, r.id))
        t.noAnswer++
      }
    }
    // after the loop: children waiting for a rejected parent (including a void in this same batch that got its own
    // PARENT_PENDING verdict above) end as PARENT_REJECTED, so retryRow/requeue can wake them later
    for (const k of rejectedKeys) await cascadeChildren(tx, k, at)
    return t
  })
}

export async function pushOnce(ctx: SyncContext): Promise<PushOutcome> {
  const out: PushOutcome = { requests: 0, sent: 0, rejected: 0, deferred: 0, held: 0, noAnswer: 0, stopped: null }
  const g = await ctx.serial(() => gate(ctx.db, ctx.deps))
  if (g.blocked !== null || g.cfg === null || g.sup === null) return { ...out, stopped: g.blocked ?? 'not_linked' }
  const client = createDayoClient({ ...g.cfg, fetch: ctx.deps.fetch, nowMs: () => Date.parse(ctx.deps.now()) })
  const decided = new Set<string>() // plan 5 fix H-1: judged once per call
  for (let round = 0; round < MAX_ROUNDS_PER_CALL; round++) {
    const nowIso = ctx.deps.now()
    const { batch, held } = await ctx.serial(async () => pickBatch(ctx.db, nowIso, g.sup!, await batchSize(ctx.db), decided))
    out.held = held
    if (batch.length === 0) return out
    for (const r of batch) decided.add(r.id)
    const body = { device_time: nowIso, rows: batch.map((r) => ({ key: r.idempotencyKey, kind: r.tableName, data: r.rowJson })) } as PushRequest
    let answer
    try {
      answer = await client.push(body) // network OUTSIDE the serial queue — sales keep going (plan 5 L-R3)
    } catch (e) {
      if (!(e instanceof DayoError)) throw e
      out.requests++
      await ctx.serial(() => onRequestFailure(ctx.db, ctx.deps, e.failure, batch))
      return { ...out, stopped: e.failure.kind }
    }
    out.requests++
    const t = await ctx.serial(() => applyVerdicts(ctx.db, ctx.deps, batch, answer, g.sup!))
    out.sent += t.sent; out.rejected += t.rejected; out.deferred += t.deferred; out.noAnswer += t.noAnswer
  }
  return out
}

/** Task 14: a wake that means "the network may be back" forgets the network/5xx backoff — never 429's Retry-After (review item 2). */
export async function clearFailureBackoff(db: RemoteDb): Promise<void> {
  if ((await readKey(db, DAYO_KEYS.pushBackoffReason)) === 'rate_limited') return
  await deleteKey(db, DAYO_KEYS.pushBackoffUntil)
  await deleteKey(db, DAYO_KEYS.pushFailStreak)
  await deleteKey(db, DAYO_KEYS.pushBackoffReason)
}

/** Owner's "ลองใหม่" (spec §6.4): dead → pending with a fresh budget; children parked as PARENT_REJECTED come back too. */
export async function retryRow(db: RemoteDb, outboxId: string): Promise<void> {
  const r = await db.select().from(s.outbox).where(eq(s.outbox.id, outboxId)).get()
  if (r === undefined || r.status !== 'dead') return
  await db.update(s.outbox).set({ status: 'pending', attempts: 0, deadAt: null, nextAttemptAt: null }).where(eq(s.outbox.id, r.id))
  const kids = await db.select().from(s.outbox).where(and(eq(s.outbox.parentKey, r.idempotencyKey), eq(s.outbox.status, 'dead'))).all()
  for (const k of kids) if (decodeLastError(k.lastError).reason === 'PARENT_REJECTED') await db.update(s.outbox).set({ status: 'pending', attempts: 0, deadAt: null, nextAttemptAt: null }).where(eq(s.outbox.id, k.id))
}
```

(`markSent`/`markDead`/`markDeferred` ถูกเรียกเฉพาะหลังตรวจว่าแถวยัง `pending` ในธุรกรรมเดียวกัน · `batchSize`: `or(lte(...))` มีเงื่อนไขเดียว — เขียนเป็น `lte(s.outbox.createdAt, m.createdAt)` ตรง ๆ ได้ · แถวที่ `createdAt` เท่ากับ marker แต่ `id` มากกว่าถือว่าอยู่ในช่วง — ยอมรับได้ เพราะแค่ส่งทีละแถวนานขึ้นเล็กน้อย)

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test -- push` → PASS · `pnpm --filter @dayo/pos test` → PASS ทั้งแพ็กเกจ

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/sync/push.ts apps/pos/test/push.test.ts apps/pos/test/push-bytes.test.ts
git commit -m "feat(pos): push queued bills to dayo and act on every row's verdict"
```

---

### Task 14: ตัวตั้งเวลาส่ง + สถานะระบบใน bootstrap + ต่อเข้า Worker

ผู้ทำ: sync-engineer (opus) · สเปก §6.2 (ปลุกเมื่อ …), §6.5, §6.7, §10.5 (ของค้าง > 24 ชม.), D80 · รอ Task 13

**ปรับตาม dayo (สเปก §4.4 ข้อ 9 · §4.6 · §13.6 S5, S17)**: `SyncStatusDto` เพิ่ม `pricingCommit: string | null` (จาก `pricingJson` · null = "ไม่ทราบ" ไม่ใช่ปัญหา) · ตัวตั้งเวลา **ไม่** ดึง E3 เอง — การดึง `dayo_edit` ของบิลตัวเองอยู่ใน Task 15 (ดึงเมื่อเปิดหน้าประวัติบิล/หน้าบิลบอท-เว็บ และทุก 5 นาทีระหว่างหน้าเปิด — จังหวะเดียวกับ E3 ในสเปก §4.6)

**Files:**
- Create: `apps/pos/src/sync/scheduler.ts`
- Modify: `apps/pos/src/api/pos-api.ts`, `apps/pos/src/api/bootstrap.ts`, `apps/pos/src/api/types.ts`, `apps/pos/src/api/shift.ts`, `apps/pos/src/api/close.ts` (ปลุกก่อนเปิด/ปิดกะ), `apps/pos/src/db/worker.ts`
- Test: `apps/pos/test/scheduler.test.ts`, `apps/pos/test/sync-status.test.ts`

**Interfaces:**
- Consumes: `pullCatalog` (Task 10) · `pushOnce`, `clearFailureBackoff` (Task 13) · state helpers
- Produces (สาย D ใช้):

```ts
export type WakeReason = 'open' | 'write' | 'online' | 'timer' | 'manual' | 'before_shift' | 'before_close'
export type SyncCycleResult = { catalog: CatalogPullResult | null; push: PushOutcome }
export type Scheduler = { kick(reason: WakeReason): void; runNow(): Promise<SyncCycleResult>; start(): void; stop(): void }
export function createSyncScheduler(ctx: SyncContext & { timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; setInterval: typeof setInterval; clearInterval: typeof clearInterval }; locks?: { request(name: string, opts: { ifAvailable: true }, cb: (lock: unknown) => Promise<void>): Promise<void> } | undefined }): Scheduler
export const WRITE_DEBOUNCE_MS = 2_000, TICK_MS = 60_000, CATALOG_EVERY_MS = 300_000
export type SyncStatusDto = {
  linked: boolean; apiState: ApiState | null; maskedKey: string | null; baseUrl: string | null
  clockSkewMs: number | null; clockWarning: boolean              // |skew| > 5 min, or CLOCK_AHEAD seen within the last hour (D80)
  pricingMismatch: boolean; catalogVersion: number | null; catalogCheckedAt: string | null; catalogError: string | null
  lastPushAt: string | null; pendingBills: number; problemBills: number; oldestPendingAt: string | null; pendingOver24h: boolean
  priceDiffBills: number                                          // bills whose computed_total − total ≠ 0 (spec §4.3)
  clockFarAheadBills: number                                      // ruling N5: pending rows flagged CLOCK_AHEAD > 24 h (owner-only banner)
}
// PosApi gains: syncNow(): Promise<SyncCycleResult> (NOT on the serial queue) · syncStatus(): Promise<SyncStatusDto>
// BootstrapState gains: sync: SyncStatusDto
// createPosApi(db, deps, opts?: { autoSync?: boolean }) — worker passes { autoSync: true }; tests default to false
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/test/scheduler.test.ts` (fake timers)

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSyncScheduler, MANUAL_CLEAR_GAP_MS } from '../src/sync/scheduler'
import { pushOnce } from '../src/sync/push'
import { DAYO_KEYS, readKey } from '../src/sync/state'
import { openConnectedApi } from './helpers/dayo'
import { sellCode } from './helpers/db'

afterEach(() => { vi.useRealTimers() })
const pushes = (t: Awaited<ReturnType<typeof openConnectedApi>>) => t.mock.requests().filter((r) => r.path === '/api/v1/pos/push').length

describe('sync scheduler (spec 04 §6.2)', () => {
  it('a save wakes the sender 2 seconds later, several saves wake it once', async () => {
    const t = await openConnectedApi()
    vi.useFakeTimers()
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }); sch.kick('write')
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }); sch.kick('write')
    await vi.advanceTimersByTimeAsync(1_999)
    expect(pushes(t)).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(pushes(t)).toBe(1))
  })
  it('pulls the catalog on open and then exactly every 5 minutes (review item 21 — the test clock moves with the timers)', async () => {
    const t = await openConnectedApi()
    vi.useFakeTimers()
    const catalogCalls = () => t.mock.requests().filter((r) => r.path === '/api/v1/pos/catalog').length
    const base = catalogCalls() // connectShop's own call
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    sch.start()
    await vi.waitFor(() => expect(catalogCalls()).toBe(base + 1)) // 'open'
    for (let minute = 1; minute <= 4; minute++) { t.clock.advanceMs(60_000); await vi.advanceTimersByTimeAsync(60_000) }
    expect(catalogCalls()).toBe(base + 1) // 4 ticks, not due yet
    t.clock.advanceMs(60_000); await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(catalogCalls()).toBe(base + 2)) // 5-minute mark
    sch.stop()
  })
  it('an online wake sends at once even after network failures built up a multi-minute backoff (review item 2, N4)', async () => {
    const t = await openConnectedApi()
    let online = false
    const f: typeof fetch = async (input, init) => { if (!online) throw new TypeError('Failed to fetch'); return t.mock.fetch(input, init) }
    const ctx = { db: t.db, deps: { ...t.deps, fetch: f }, serial: <T>(fn: () => Promise<T>) => fn() }
    for (let i = 0; i < 5; i++) await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    for (let i = 1; i <= 4; i++) { // fail 4 times, waiting out each backoff (a manual runNow would clear it — so call pushOnce directly)
      const until = await readKey(t.db, DAYO_KEYS.pushBackoffUntil)
      if (until !== null) t.clock.advanceMs(Math.max(0, Date.parse(until) - Date.parse(t.clock.now())) + 1)
      await pushOnce(ctx)
    }
    expect(await readKey(t.db, DAYO_KEYS.pushFailStreak)).toBe('4')
    expect(Date.parse((await readKey(t.db, DAYO_KEYS.pushBackoffUntil))!) - Date.parse(t.clock.now())).toBeGreaterThanOrEqual(240_000)
    const sch = createSyncScheduler(ctx)
    online = true
    sch.kick('online')
    await vi.waitFor(() => expect(t.mock.orders()).toHaveLength(5))
  })
  it('"ส่งตอนนี้" clears the failure backoff at most once per 30 s (ruling N4)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setMode('server_down')
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    await sch.runNow()
    expect(pushes(t)).toBe(1)                // cleared (nothing to clear), tried, 5xx → backoff
    t.clock.advanceMs(1_000)
    await sch.runNow()
    expect(pushes(t)).toBe(1)                // pressed again 1 s later: the backoff holds, dayo is not hit
    t.clock.advanceMs(MANUAL_CLEAR_GAP_MS)
    await sch.runNow()
    expect(pushes(t)).toBe(2)                // 30 s after the last clear it may clear again
  })
  it('online wakes it at once; a second wake during a cycle runs one more cycle, never two in parallel', async () => {
    const t = await openConnectedApi()
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const a = sch.runNow()
    const b = sch.runNow()
    await Promise.all([a, b])
    expect(pushes(t)).toBe(1)
  })
  it('skips the cycle when another tab holds the dayo-push lock', async () => {
    const t = await openConnectedApi()
    const locks = { request: async (_n: string, _o: { ifAvailable: true }, cb: (lock: unknown) => Promise<void>) => cb(null) } // null = not available
    const sch = createSyncScheduler({ db: t.db, deps: t.deps, serial: (fn) => fn(), locks })
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await sch.runNow()
    expect(pushes(t)).toBe(0)
  })
})
```

เพิ่มใน `scheduler.test.ts` (plan 5 L-R3 — ใช้คิว serial จริงผ่าน `PosApi`):

```ts
it('a sale is not blocked while syncNow waits on a hung request', async () => {
  const t = await openConnectedApi()
  await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
  t.mock.setMode('hang')
  const sync = t.api.syncNow()
  const started = Date.now()
  await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }) // same PosApi = same serial queue
  expect(Date.now() - started).toBeLessThan(2_000)
  void sync.catch(() => undefined)
})
```

`apps/pos/test/sync-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { openConnectedApi } from './helpers/dayo'
import { sellCode } from './helpers/db'

describe('bootstrap().sync (spec 04 §4.3, §6.7, §10.5 · D80)', () => {
  it('is healthy right after setup', async () => {
    const t = await openConnectedApi()
    expect((await t.api.bootstrap()).sync).toMatchObject({ linked: true, apiState: 'ok', maskedKey: 'dayo_…cdef', clockWarning: false, pricingMismatch: false, catalogVersion: 42, pendingBills: 0, problemBills: 0, pendingOver24h: false, priceDiffBills: 0 })
  })
  it('warns when the server clock is 6 minutes ahead', async () => {
    const t = await openConnectedApi()
    t.mock.setNow('2026-09-25T03:06:00.000Z') // tablet clock stays at 03:00
    await t.api.syncNow()
    expect((await t.api.bootstrap()).sync).toMatchObject({ clockWarning: true })
  })
  it('flags a bill waiting more than 24 hours', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.clock.advanceMs(25 * 3_600_000)
    expect((await t.api.bootstrap()).sync).toMatchObject({ pendingBills: 1, pendingOver24h: true })
  })
  it('counts a 1-satang difference from dayo (spec §4.3: every size is visible)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.override({ match: { receiptNo: r.receiptNo }, verdict: { status: 'accepted', data: { order_no: 'L260925-001', version: 1, computed_total: 45.01, amount_mismatch: false, duplicate_of: [], warnings: [] } }, times: 1 })
    await t.api.syncNow()
    expect((await t.api.bootstrap()).sync).toMatchObject({ priceDiffBills: 1 })
  })
  it('counts bills far ahead of the server clock for the owner-only banner (ruling N5)', async () => {
    const t = await openConnectedApi({ now: '2026-09-27T03:00:00.000Z' })
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setNow('2026-09-25T03:00:00.000Z')
    await t.api.syncNow()
    expect((await t.api.bootstrap()).sync).toMatchObject({ clockFarAheadBills: 1, pendingBills: 1, problemBills: 0 })
  })
  it('shows a revoked key', async () => {
    const t = await openConnectedApi()
    t.mock.setMode('unauthorized')
    await t.api.syncNow()
    expect((await t.api.bootstrap()).sync).toMatchObject({ apiState: 'unauthorized' })
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos test -- scheduler sync-status` · คาดว่า FAIL

- [ ] **Step 3: เขียนโค้ด** — `apps/pos/src/sync/scheduler.ts`

```ts
import { and, asc, eq, inArray } from 'drizzle-orm'
import * as s from '@dayo/db-schema/sqlite'
import { pullCatalog, type CatalogPullResult, type SyncContext } from './catalog'
import { clearFailureBackoff, pushOnce, type PushOutcome } from './push'
import { DAYO_KEYS, readKey } from './state'

export type WakeReason = 'open' | 'write' | 'online' | 'timer' | 'manual' | 'before_shift' | 'before_close'
export type SyncCycleResult = { catalog: CatalogPullResult | null; push: PushOutcome }
export type Scheduler = { kick(reason: WakeReason): void; runNow(): Promise<SyncCycleResult>; start(): void; stop(): void }
export const WRITE_DEBOUNCE_MS = 2_000
export const TICK_MS = 60_000
export const CATALOG_EVERY_MS = 300_000
const PULL_FIRST: ReadonlySet<WakeReason> = new Set(['open', 'manual', 'before_shift'])
/** review item 2: these wakes mean "the network may be back / the user is waiting" — forget the network/5xx backoff first. */
const CLEARS_FAILURE_BACKOFF: ReadonlySet<WakeReason> = new Set(['online', 'manual', 'open', 'before_close'])
/** ruling N4: pressing "ส่งตอนนี้" again and again while dayo is down must not hammer it — a manual wake clears the backoff at most once per 30 s. */
export const MANUAL_CLEAR_GAP_MS = 30_000

type Timers = { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; setInterval: typeof setInterval; clearInterval: typeof clearInterval }
type Locks = { request(name: string, opts: { ifAvailable: true }, cb: (lock: unknown) => Promise<void>): Promise<void> }

export function createSyncScheduler(ctx: SyncContext & { timers?: Timers; locks?: Locks | undefined }): Scheduler {
  const timers: Timers = ctx.timers ?? { setTimeout, clearTimeout, setInterval, clearInterval }
  const locks: Locks | undefined = ctx.locks ?? (globalThis.navigator as { locks?: Locks } | undefined)?.locks
  let running: Promise<SyncCycleResult> | null = null
  let again: WakeReason | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let tick: ReturnType<typeof setInterval> | null = null
  let lastManualClearMs = Number.NEGATIVE_INFINITY

  function mayClearBackoff(reason: WakeReason): boolean {
    if (!CLEARS_FAILURE_BACKOFF.has(reason)) return false
    if (reason !== 'manual') return true
    const nowMs = Date.parse(ctx.deps.now())
    if (nowMs - lastManualClearMs < MANUAL_CLEAR_GAP_MS) return false
    lastManualClearMs = nowMs
    return true
  }

  async function catalogDue(reason: WakeReason): Promise<boolean> {
    if (PULL_FIRST.has(reason)) return true
    const last = await ctx.serial(() => readKey(ctx.db, DAYO_KEYS.catalogCheckedAt))
    return last === null || Date.parse(ctx.deps.now()) - Date.parse(last) >= CATALOG_EVERY_MS
  }
  async function hasPending(): Promise<boolean> {
    const r = await ctx.serial(() => ctx.db.select({ id: s.outbox.id }).from(s.outbox).where(and(eq(s.outbox.status, 'pending'), inArray(s.outbox.tableName, ['order', 'order_void']))).orderBy(asc(s.outbox.createdAt)).limit(1).get())
    return r !== undefined
  }
  async function cycle(reason: WakeReason): Promise<SyncCycleResult> {
    let result: SyncCycleResult = { catalog: null, push: { requests: 0, sent: 0, rejected: 0, deferred: 0, held: 0, noAnswer: 0, stopped: null } }
    const body = async (): Promise<void> => {
      if (mayClearBackoff(reason)) await ctx.serial(() => clearFailureBackoff(ctx.db)) // 429's Retry-After is kept · manual ≤ once per 30 s (N4)
      const catalog = (await catalogDue(reason)) ? await pullCatalog(ctx) : null
      result = { catalog, push: await pushOnce(ctx) }
    }
    if (locks === undefined) await body()
    else await locks.request('dayo-push', { ifAvailable: true }, async (lock) => { if (lock !== null) await body() }) // one sender across tabs (spec §6.2)
    return result
  }
  function runNow(reason: WakeReason = 'manual'): Promise<SyncCycleResult> {
    if (running !== null) { again = reason; return running } // at most one request in flight (spec §6.2)
    running = cycle(reason).finally(() => {
      running = null
      if (again !== null) { const r = again; again = null; void runNow(r) }
    })
    return running
  }
  return {
    kick(reason) {
      if (reason === 'write') {
        if (debounce !== null) timers.clearTimeout(debounce)
        debounce = timers.setTimeout(() => { debounce = null; void runNow('write') }, WRITE_DEBOUNCE_MS)
        return
      }
      void runNow(reason)
    },
    runNow: () => runNow('manual'),
    start() {
      void runNow('open')
      tick = timers.setInterval(() => {
        void (async () => { if ((await hasPending()) || (await catalogDue('timer'))) await runNow('timer') })()
      }, TICK_MS)
    },
    stop() {
      if (tick !== null) timers.clearInterval(tick)
      if (debounce !== null) timers.clearTimeout(debounce)
    },
  }
}
```

`pos-api.ts`:

```ts
export function createPosApi(db: RemoteDb, baseDeps: ApiDeps, opts: { autoSync?: boolean } = {}): PosApi {
  const serial = createSerialQueue()
  let scheduler: Scheduler | null = null
  const deps: ApiDeps = { ...baseDeps, afterWrite: () => scheduler?.kick('write') }
  scheduler = createSyncScheduler({ db, deps, serial })
  // … existing methods, now passing `deps` …
  // openShift / quickOpenShift: after success → scheduler.kick('before_shift') · closeShift: before the transaction → scheduler.kick('before_close')
  return {
    // …
    syncNow: () => scheduler!.runNow(),             // network inside: NOT serial
    syncStatus: () => serial(() => syncStatus(db, deps)),
  }
  // at the end: if (opts.autoSync === true) scheduler.start()
}
```

`worker.ts`: `createPosApi(db, deps, { autoSync: true })` · `self.addEventListener('online', () => void api.syncNow())` (WorkerGlobalScope มี event `online`) — เพิ่ม `kickOnline` ภายในถ้าต้องการชื่อชัด

`bootstrap.ts` — `syncStatus(db, deps)`:

```ts
export async function syncStatus(db: RemoteDb, deps: ApiDeps): Promise<SyncStatusDto> {
  const now = Date.parse(deps.now())
  const key = await deps.secrets.getApiKey()
  const baseUrl = await readKey(db, DAYO_KEYS.baseUrl)
  const skewRaw = await readKey(db, DAYO_KEYS.clockSkewMs)
  const skew = skewRaw === null ? null : Number(skewRaw)
  const aheadAt = await readKey(db, DAYO_KEYS.clockAheadAt)
  const oldest = await db.select({ createdAt: s.outbox.createdAt }).from(s.outbox).where(and(eq(s.outbox.status, 'pending'), inArray(s.outbox.tableName, ['order', 'order_void']))).orderBy(asc(s.outbox.createdAt)).limit(1).get()
  const diff = await db.values<[number]>(sql`select count(*) from "order" where central_computed_total_satang is not null and central_computed_total_satang <> total_satang`)
  const catalog = await readCatalog(db)
  return {
    linked: key !== null && baseUrl !== null, apiState: (await readKey(db, DAYO_KEYS.apiState)) as ApiState | null, maskedKey: key === null ? null : maskApiKey(key), baseUrl,
    clockSkewMs: skew, clockWarning: (skew !== null && Math.abs(skew) > CLOCK_WARN_MS) || (aheadAt !== null && now - Date.parse(aheadAt) < 3_600_000),
    pricingMismatch: (await readKey(db, DAYO_KEYS.pricingMismatch)) === '1', catalogVersion: catalog?.catalogVersion ?? null,
    catalogCheckedAt: await readKey(db, DAYO_KEYS.catalogCheckedAt), catalogError: await readKey(db, DAYO_KEYS.catalogError),
    lastPushAt: await readKey(db, DAYO_KEYS.lastPushAt), pendingBills: await countPendingSyncItems(db), problemBills: await countSyncProblems(db),
    oldestPendingAt: oldest?.createdAt ?? null, pendingOver24h: oldest !== undefined && now - Date.parse(oldest.createdAt) > 86_400_000,
    priceDiffBills: diff[0]?.[0] ?? 0,
    clockFarAheadBills: (await db.values<[number]>(sql`select count(*) from outbox where status = 'pending' and json_extract(last_error, '$.farAhead') = 1`))[0]?.[0] ?? 0,
  }
}
```

(ออฟไลน์ไม่รู้เวลาเซิร์ฟเวอร์ = ใช้ความต่างล่าสุดที่วัดได้ — `clockSkewMs` ที่เก็บไว้คือค่านั้นอยู่แล้ว · spec §6.7) · `bootstrap()` ใส่ `sync: await syncStatus(db, deps)`

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test` → PASS · `pnpm turbo run typecheck` → ผ่าน

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/sync/scheduler.ts apps/pos/src/api/pos-api.ts apps/pos/src/api/bootstrap.ts apps/pos/src/api/types.ts apps/pos/src/api/shift.ts apps/pos/src/api/close.ts apps/pos/src/db/worker.ts apps/pos/test/scheduler.test.ts apps/pos/test/sync-status.test.ts
git commit -m "feat(pos): wake the dayo sender on saves, timers and reconnects and report sync health"
```

---

### Task 15: ทางแก้ของ owner (หน้า "ส่งไม่ผ่าน") + บิลบอท/เว็บวันนี้ (E3) + รายการยอดไม่ตรง

ผู้ทำ: sync-engineer (opus) · ผู้ตรวจเพิ่ม: **security-reviewer** (PIN owner, ข้อมูลที่ส่งออก) · สเปก §4.3 (ส่วนต่าง), §4.6, §4.7, §4.8, §6.1 (ข้อยกเว้นทางแก้), §6.4 · ruling R8 · รอ Task 14, **A4**

**ปรับตาม dayo — `dayo_edit` แบบอ่านอย่างเดียว (มีผลเหนือโค้ดข้างล่าง · สเปก §4.6, §4.7 · §13.6 S17–S20 · รอเจ้าของ O1 เฉพาะเรื่องเงิน)**: dayo ship ให้ owner แก้/ยกเลิกบิล POS บนเว็บแล้ว และ E3 ส่ง `dayo_edit` + `pos_order_id` มาแน่ ก้อน 2 จึง **อ่านและแสดง** โดยไม่ตัดสิน O1:
- **E3 ไม่กรองบิล POS ทิ้งทั้งหมดอีกแล้ว**: `listCentralOrdersToday` ยังคืนเฉพาะ `source ≠ 'pos'` สำหรับหน้า "บิลบอท/เว็บวันนี้" (ตามเดิม) แต่ก่อนคืน ส่งแถวที่ `pos_order_id` ไม่ว่างเข้า `applyDayoEdits` ด้วย
- ใหม่ `refreshDayoEdits(ctx): Promise<{ updated: number }>` (PosApi · ทุกบทบาท · network นอก serial): `GET /v1/orders?from=<วันนี้ − 60>&to=<วันนี้>&updated_since=<dayo.dayo_edits_since>` (ค่าเริ่มต้น = เวลาตั้งเครื่อง) → `applyDayoEdits` → เก็บ `dayo.dayo_edits_since` = `updated_at` มากสุดที่เห็น · ได้ครบ 500 แถว (เพดานของ dayo `0052_pos_push.sql:840`) = เขียน `catalogError`-แบบเตือน "บิลที่ระบบกลางแก้มีมากเกินดึงครั้งเดียว" (ไม่เดา) · 401/403/404 ทำแบบเดียวกับ `listCentralOrdersToday` (ไม่เรียกเมื่อ `apiBlocked`)
- `applyDayoEdits(tx, deps, rows)` (ไม่มีธุรกรรมของตัวเอง): จับคู่ `pos_order_id` กับ `order.id` ในเครื่อง · เขียน `order.central_dayo_edit_json` (คอลัมน์ของ A4) = `dayo_edit` ตามที่ได้ (รวม null — owner อาจไม่เคยแก้) เฉพาะเมื่อค่าเปลี่ยน · `audit_log` `entity:'order'`, `action:'dayo_edit_seen'` · **ไม่แตะ** `total_satang`, `payment`, สถานะบิล, outbox, โซ่แฮช, กะ/Z — ใบเสร็จและยอดในเครื่อง = เงินที่เก็บจริง (สเปก §4.6) · `pos_order_id` ที่ไม่มีในเครื่อง = ข้าม
- `OrderDetailDto`/`OrderSummaryDto` (แก้ `api/orders.ts`) เพิ่ม `dayoEdit: { kind: 'edit' | 'cancel' | string; editedAt: string; editedByName: string | null; reason: string | null; version: number } | null` · `voidable` = `false` เมื่อ `dayoEdit.kind === 'cancel'` (ยกเลิกซ้ำไม่ได้ — ตัวส่งจะได้ `duplicate` อยู่แล้วแต่ไม่ควรให้กด)
- เทสต์ใหม่ใน `central-orders.test.ts`: (1) ขาย+ส่ง → `mock.editPosOrder(id, {kind:'edit', reason:'ลูกค้าเปลี่ยนเมนู'})` → `refreshDayoEdits` → `getOrder(id).dayoEdit` มีเหตุผล และ `totalSatang` **เท่าเดิม** (2) `kind:'cancel'` → `voidable=false` · สถานะบิลในเครื่องยัง `paid` (3) key ไม่มี `staff:read` → `editedByName`/`reason` เป็น null แสดงได้ (4) บิล POS ของ key อื่น (`pos_order_id: null`) ไม่ถูกแตะ (5) เทสต์เดิม "without POS bills" ยังผ่าน
- ส่วนที่ **รอเจ้าของ O1** (ไม่ทำในก้อน 2): ปรับยอดกะ/ลิ้นชักตามยอดใหม่ของ dayo · รายการ "ยอดไม่ตรงระบบกลาง" ชนิดใหม่สำหรับบิลที่ owner แก้ (ตอนนี้ `listPriceDiffs` ยังเทียบ `computed_total` ของ E2 ตามเดิม)
- Files เพิ่ม: `apps/pos/src/api/orders.ts` · Interfaces เพิ่ม: `refreshDayoEdits`, `applyDayoEdits`, `DAYO_KEYS.dayoEditsSince`

**Files:**
- Create: `apps/pos/src/api/sync-problems.ts`, `apps/pos/src/api/central-orders.ts`
- Modify: `apps/pos/src/api/pos-api.ts`, `apps/pos/src/api/types.ts`
- Test: `apps/pos/test/sync-problems.test.ts`, `apps/pos/test/central-orders.test.ts`

**Interfaces:**
- Consumes: `retryRow` (Task 13) · `readCatalog` (Task 10) · `appendOrderEvents` · `requireOwnerPin` · `nextReceiptNo` · `OrderRowData`, `OrderVoidRowData`, `bangkokDateOf` · `createDayoClient` · `edgeBahtToSatang`
- Produces (Task 19, 20 ใช้):

```ts
export type Remedy = 'RETRY' | 'RENUMBER' | 'REMAP_CODE' | 'REMAP_STAFF' | 'EXCLUDE'
export type SyncProblemDto = { outboxId: string; key: string; kind: 'order' | 'order_void'; orderId: string; receiptNo: string | null; at: string; reason: string; detail: string; remedies: Remedy[]; children: SyncProblemDto[] }
export type OwnerApproval = { approverUserId: string; approverPin: string; reason: string }
export type RemapCodeInput = OwnerApproval & { outboxId: string; target: { field: 'line'; lineIndex: number; code: string; size: Size; sweetness: Sweetness } | { field: 'channel'; code: string } | { field: 'payment'; code: string } }
export type CentralOrderDto = { orderNo: string; source: 'line' | 'web' | string; sourceLabel: string; createdByName: string | null; soldAt: string | null; totalSatang: number; payment: string | null; status: string; duplicateSuspect: boolean }
export type PriceDiffDto = { kind: 'amount' | 'void_local_only'; orderId: string; receiptNo: string; soldAt: string; totalSatang: number; computedTotalSatang: number | null; diffSatang: number | null; catalogVersion: number | null; amountMismatch: boolean }
// 'void_local_only' (review item 23): the bill reached dayo but its cancellation will never (EXCLUDE on the void row) —
// dayo still counts it as a sale. Shown so the owner knows; block 3 handles the money (cash_movement / order_excluded).
// PosApi gains (owner-only reads check the role at the API, not only in the UI — review item 22):
listSyncProblems(actorUserId: string): Promise<SyncProblemDto[]>          // owner
retrySyncRow(i: OwnerApproval & { outboxId: string }): Promise<void>
renumberReceipt(i: OwnerApproval & { outboxId: string }): Promise<{ oldReceiptNo: string; newReceiptNo: string }>
remapCode(i: RemapCodeInput): Promise<void>
remapStaff(i: OwnerApproval & { outboxId: string; newStaffId: string }): Promise<void>
excludeFromSync(i: OwnerApproval & { outboxId: string }): Promise<void>
exportSyncRow(i: { actorUserId: string; outboxId: string }): Promise<string>   // owner · pretty JSON of {key, kind, data, lastError} — no secrets
listCentralOrdersToday(): Promise<CentralOrderDto[]>   // every role (Q44 — against double entry) · online only (E3); network outside serial
listPriceDiffs(actorUserId: string): Promise<PriceDiffDto[]>             // owner (R11)
// PosErrorCode gains: 'REMEDY_NOT_ALLOWED' | 'OFFLINE'
```

กติกาทางแก้ (spec §6.4 — ล็อก): ทุกทางแก้ = **PIN owner + เหตุผล** · เขียน event ในโซ่แฮช (บิล) เก็บข้อมูลเดิมทั้งก้อน · **ห้ามแก้ยอดเงิน** (`totals` คงเดิม) · ใช้ได้เฉพาะแถว `dead` ที่เหตุผลตรงตามตาราง · ส่งใหม่ด้วย **key เดิม** (สถานะ `pending`, `attempts = 0`)

| เหตุผลของแถว | ทางแก้ที่อนุญาต | ผล |
|---|---|---|
| ทุกเหตุผล | `RETRY` | `retryRow` |
| `CONFLICT` (แถว `order`) | `RENUMBER` | เลขถัดไปของเครื่อง → `order.receipt_no` + `row_json.receipt_no` · event `RECEIPT_RENUMBERED {old, new, reason, approvedBy}` |
| `UNKNOWN_CODE` | `REMAP_CODE` | แทนรหัสบรรทัด (เมนู+ขนาด+ความหวาน ที่มีในแคตตาล็อกล่าสุด) / ช่องทาง / วิธีชำระ ใน `row_json` · event `CODE_REMAPPED {field, before, after, reason, approvedBy}` · `OrderRowData.parse` ต้องผ่าน |
| `UNKNOWN_STAFF` | `REMAP_STAFF` | `staff_id` (หรือ `approved_by` ของ `order_void` ถ้าตัวนั้นที่ไม่รู้จัก) เป็นพนักงาน active ในรายชื่อล่าสุด · event `STAFF_REMAPPED` |
| `INVALID` `FORBIDDEN` `BAD_KEY` · `CLOCK_AHEAD` ที่ `farAhead` (แถวยัง `pending` — ข้อยกเว้นของสเปก §6.4 ตามคำตัดสินหัวหน้า N5 · owner กดเองเท่านั้น ยืนยันสองชั้น + คำเตือน "ยอดนี้จะไม่ถึงระบบกลาง") | `EXCLUDE` | แถว (และลูก) เป็น `local_only` ถาวร · แถว `order`: `order.excluded_at` · event `EXCLUDED_FROM_SYNC` · **ไม่มีแถว `order_excluded` ในก้อน 2** (R8) · ไม่บันทึก PAID_IN/PAID_OUT · แถว `order_void` ที่บิลถึงระบบกลางแล้ว: บิลขึ้นในรายการ "ยอดไม่ตรงระบบกลาง" ชนิด `void_local_only` และชิปบิล "ยกเลิกในเครื่องเท่านั้น" (review item 23 — ให้ก้อน 3 จัดการเงิน) |
| `PARENT_REJECTED` | (ไม่มี — แก้ที่แถวแม่) | — |

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/test/sync-problems.test.ts`

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { posErrorCode } from '../src/api/errors'
import { pushOnce } from '../src/sync/push'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

const owner = { approverUserId: STAFF.TungAo, approverPin: '1111', reason: 'แก้ตามหน้าส่งไม่ผ่าน' }
async function rejectedBill(reason: string, detail = 'x') {
  const t = await openConnectedApi()
  const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
  const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
  t.mock.override({ match: { receiptNo: r.receiptNo }, verdict: { status: 'rejected', reason, detail }, times: 1 })
  await pushOnce(ctx)
  const [p] = await t.api.listSyncProblems(STAFF.TungAo)
  return { t, ctx, r, p: p! }
}

describe('owner remedies (spec 04 §6.4)', () => {
  it('a row far ahead of the server clock is listed as waiting; only the owner\'s EXCLUDE closes it (ruling N5)', async () => {
    const t = await openConnectedApi({ now: '2026-09-27T03:00:00.000Z' }) // tablet clock 2 days fast
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setNow('2026-09-25T03:00:00.000Z')
    await pushOnce(ctx)
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ receiptNo: r.receiptNo, reason: 'CLOCK_AHEAD', remedies: ['EXCLUDE'] })
    try { await t.api.retrySyncRow({ ...owner, outboxId: p!.outboxId }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('REMEDY_NOT_ALLOWED') }
    await t.api.excludeFromSync({ ...owner, outboxId: p!.outboxId })
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.id, p!.outboxId)).get())?.status).toBe('local_only')
  })
  it('lists the problem with the allowed buttons only', async () => {
    const { p } = await rejectedBill('CONFLICT', 'เลขใบเสร็จ A-000001 ถูกใช้แล้ว')
    expect(p).toMatchObject({ kind: 'order', receiptNo: 'A-000001', reason: 'CONFLICT', remedies: ['RETRY', 'RENUMBER'] })
  })
  it('CONFLICT → a new receipt number, same key, then accepted', async () => {
    const { t, ctx, r, p } = await rejectedBill('CONFLICT')
    expect(await t.api.renumberReceipt({ ...owner, outboxId: p.outboxId })).toEqual({ oldReceiptNo: 'A-000001', newReceiptNo: 'A-000002' })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
    const ev = await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'RECEIPT_RENUMBERED')).get()
    expect(ev?.payloadJson).toMatchObject({ old: 'A-000001', new: 'A-000002' })
    expect((await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())?.totalSatang).toBe(4500) // money never changes
  })
  it('a remedy that does not fit the reason is refused', async () => {
    const { t, p } = await rejectedBill('UNKNOWN_STAFF')
    try { await t.api.renumberReceipt({ ...owner, outboxId: p.outboxId }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('REMEDY_NOT_ALLOWED') }
  })
  it('UNKNOWN_STAFF → choose another seller from the latest list', async () => {
    const { t, ctx, p } = await rejectedBill('UNKNOWN_STAFF')
    await t.api.remapStaff({ ...owner, outboxId: p.outboxId, newStaffId: STAFF.DCm })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('UNKNOWN_CODE → map the line to an active menu of the latest catalog', async () => {
    const { t, ctx, p } = await rejectedBill('UNKNOWN_CODE')
    await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'line', lineIndex: 0, code: 'Thai Tea', size: '16 oz', sweetness: '50%' } })
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('INVALID → closed as "นอกระบบกลาง": never sent again, still in the tablet reports (ruling R8)', async () => {
    const { t, ctx, r, p } = await rejectedBill('INVALID')
    await t.api.excludeFromSync({ ...owner, outboxId: p.outboxId })
    expect(await t.api.listSyncProblems(STAFF.TungAo)).toEqual([])
    expect(await pushOnce(ctx)).toMatchObject({ requests: 0 })
    expect((await t.api.getOrder(r.orderId)).central.state).toBe('excluded')
  })
  it('needs an owner PIN', async () => {
    const { t, p } = await rejectedBill('CONFLICT')
    try { await t.api.renumberReceipt({ ...owner, approverPin: '0000', outboxId: p.outboxId }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('PIN_WRONG') }
  })
  it('export JSON holds the row and the reason, never the API key', async () => {
    const { t, p } = await rejectedBill('CONFLICT')
    const json = await t.api.exportSyncRow({ actorUserId: STAFF.TungAo, outboxId: p.outboxId })
    expect(JSON.parse(json)).toMatchObject({ key: p.key, kind: 'order', lastError: { reason: 'CONFLICT' } })
    expect(json).not.toContain('dayo_0123')
  })
  it('only an owner may list, export or read price differences — checked at the API (review item 22)', async () => {
    const { t, p } = await rejectedBill('CONFLICT')
    await t.api.setStaffPin({ staffId: STAFF.Mint, pin: '4321', approverUserId: STAFF.TungAo, approverPin: '1111' })
    for (const call of [() => t.api.listSyncProblems(STAFF.Mint), () => t.api.exportSyncRow({ actorUserId: STAFF.Mint, outboxId: p.outboxId }), () => t.api.listPriceDiffs(STAFF.Mint)]) {
      try { await call(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('NOT_OWNER') }
    }
  })
  it('UNKNOWN_CODE on the channel → map it to an active channel; the charged totals never change', async () => {
    const { t, ctx, r, p } = await rejectedBill('UNKNOWN_CODE')
    const before = (await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get())!.rowJson as { totals: unknown }
    await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'channel', code: 'store' } })
    const after = (await t.db.select().from(s.outbox).where(eq(s.outbox.id, p.outboxId)).get())!.rowJson as { totals: unknown }
    expect(after.totals).toEqual(before.totals)
    expect((await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'CODE_REMAPPED')).get())?.orderId).toBe(r.orderId)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 1 })
  })
  it('remapCode refuses a menu that is not in the latest catalog', async () => {
    const { t, p } = await rejectedBill('UNKNOWN_CODE')
    try { await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'line', lineIndex: 0, code: 'Nope', size: '16 oz', sweetness: '50%' } }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
  })
  it('remapStaff refuses a removed staff member', async () => {
    const { t, p } = await rejectedBill('UNKNOWN_STAFF')
    try { await t.api.remapStaff({ ...owner, outboxId: p.outboxId, newStaffId: STAFF.Old }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
  })
  it('excluding a rejected void of a bill dayo has shows the bill as "void only on the tablet" (review item 23)', async () => {
    const t = await openConnectedApi()
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await pushOnce(ctx) // the bill reaches dayo
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'x', made: false, refundReference: 'K' })
    t.mock.override({ match: { key: `order_void:${r.orderId}` }, verdict: { status: 'rejected', reason: 'FORBIDDEN', detail: 'x' }, times: 1 })
    await pushOnce(ctx)
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    await t.api.excludeFromSync({ ...owner, outboxId: p!.outboxId })
    expect(await t.api.listPriceDiffs(STAFF.TungAo)).toEqual([expect.objectContaining({ kind: 'void_local_only', orderId: r.orderId })])
  })
})
```

`apps/pos/test/central-orders.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import type { CentralOrder } from '@dayo/contracts'
import { posErrorCode } from '../src/api/errors'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

const bill = (o: Partial<CentralOrder> & { order_no: string }): CentralOrder => ({
  sale_date: '2026-09-25', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'store', payment: 'cash',
  totals: { items_subtotal: 45, items_discount: 0, bill_discount: 0, total: 45, fee: 0 }, amount_mismatch: false, updated_at: null,
  sold_at: '2026-09-25T02:50:00+00:00', created_by_name: 'DCm', duplicate_suspect: false, ...o,
})

describe('bot/web bills of today (spec 04 §4.6, §4.7)', () => {
  it('lists today\'s bot and web bills newest first, labelled in Thai, without POS bills or other days', async () => {
    const t = await openConnectedApi()
    t.mock.seedCentralOrders([
      bill({ order_no: 'L260925-013', source: 'line', sold_at: '2026-09-25T02:50:00+00:00', duplicate_suspect: true }),
      bill({ order_no: 'L260925-015', source: 'web', sold_at: '2026-09-25T02:55:00+00:00', created_by_name: 'TungAo' }),
      bill({ order_no: 'L260924-001', sale_date: '2026-09-24', sold_at: '2026-09-24T05:00:00+00:00' }),
      bill({ order_no: 'L260925-016', source: 'pos', pos_receipt_no: 'A-000009' }),
    ])
    const got = await t.api.listCentralOrdersToday()
    expect(got.map((o) => [o.orderNo, o.sourceLabel, o.createdByName, o.totalSatang, o.duplicateSuspect])).toEqual([
      ['L260925-015', 'เว็บ', 'TungAo', 4500, false],
      ['L260925-013', 'บอท', 'DCm', 4500, true],
    ])
  })
  it('offline is a clear error, and a revoked key makes no request at all', async () => {
    const t = await openConnectedApi()
    t.mock.setMode('unauthorized')
    try { await t.api.listCentralOrdersToday(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('OFFLINE') }
    const calls = t.mock.requests().length
    try { await t.api.listCentralOrdersToday(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('OFFLINE') }
    expect(t.mock.requests().length).toBe(calls) // review item 14: 401 stops E3 too
  })
})

describe('price differences (spec 04 §4.3 — every size is visible)', () => {
  it('lists bills whose dayo total differs, even by 1 satang', async () => {
    const t = await openConnectedApi()
    const a = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    const b = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    await t.db.update(s.order).set({ centralComputedTotalSatang: 4_501 }).where(eq(s.order.id, a.orderId))
    await t.db.update(s.order).set({ centralComputedTotalSatang: 4_500 }).where(eq(s.order.id, b.orderId))
    expect(await t.api.listPriceDiffs(STAFF.TungAo)).toEqual([expect.objectContaining({ kind: 'amount', orderId: a.orderId, diffSatang: 1 })])
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos test -- sync-problems central-orders` · คาดว่า FAIL

- [ ] **Step 3: เขียนโค้ด** — `apps/pos/src/api/sync-problems.ts` (ทุกฟังก์ชันเต็ม)

```ts
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { OrderRowData, OrderVoidRowData, Text200, type PushKind } from '@dayo/contracts'
import { centralDiffSatang, nextReceiptNo } from '@dayo/domain'
import { appendOrderEvents } from '../db/events'
import { readCatalog, roleOf } from '../sync/catalog'
import { retryRow } from '../sync/push'
import { decodeLastError } from '../sync/state'
import { requireOwnerPin } from './auth'
import { requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { lastReceiptNoOverall } from './sale'
import type { OwnerApproval, PriceDiffDto, RemapCodeInput, Remedy, SyncProblemDto } from './types'

const REMEDIES: Record<string, Remedy[]> = {
  CONFLICT: ['RETRY', 'RENUMBER'], UNKNOWN_CODE: ['RETRY', 'REMAP_CODE'], UNKNOWN_STAFF: ['RETRY', 'REMAP_STAFF'],
  INVALID: ['RETRY', 'EXCLUDE'], FORBIDDEN: ['RETRY', 'EXCLUDE'], BAD_KEY: ['RETRY', 'EXCLUDE'], CLOCK_AHEAD: ['EXCLUDE'], PARENT_REJECTED: [], // CLOCK_AHEAD rows are pending (N5): no RETRY, they retry by themselves
}
type Row = typeof s.outbox.$inferSelect

/** review item 22: owner-only READS are checked here too (no PIN — the signed-in user id is enough for a read). */
async function requireOwner(db: RemoteDb, actorUserId: string): Promise<void> {
  const u = await db.select().from(s.user).where(eq(s.user.id, actorUserId)).get()
  if (!u || !u.isActive || u.role !== 'owner') throw new PosError('NOT_OWNER', 'owner only')
}
const orderIdOf = (r: Row): string => String((r.rowJson as { pos_order_id: string }).pos_order_id)
const remediesOf = (reason: string, kind: string): Remedy[] =>
  (REMEDIES[reason] ?? ['RETRY']).filter((r) => r !== 'RENUMBER' || kind === 'order') // STUCK, ENVELOPE, unknown → retry only

/** Loads a dead row the remedy may touch, after the owner PIN (checked outside the transaction — argon2 is slow). */
async function remedyRow(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }, remedy: Remedy) {
  const reason = i.reason.trim()
  if (!Text200.safeParse(reason).success) throw new PosError('BAD_INPUT', 'a remedy needs a reason')
  const approver = await requireOwnerPin(db, deps, i.approverUserId, i.approverPin)
  const row = await db.select().from(s.outbox).where(eq(s.outbox.id, i.outboxId)).get()
  const waitingFarAhead = row?.status === 'pending' && decodeLastError(row.lastError).farAhead === true // ruling N5: the owner may close it by hand
  if (row === undefined || !(row.status === 'dead' || (waitingFarAhead && remedy === 'EXCLUDE'))) throw new PosError('REMEDY_NOT_ALLOWED', 'the row is not on the "ส่งไม่ผ่าน" page')
  if (!remediesOf(decodeLastError(row.lastError).reason, row.tableName).includes(remedy)) throw new PosError('REMEDY_NOT_ALLOWED', `${remedy} does not fit ${decodeLastError(row.lastError).reason}`)
  return { row, approver, reason }
}

/** Rewrites a REJECTED row's data and re-queues it under the SAME key (spec §6.1: allowed only because dayo never stores rejected results under a key). */
async function requeue(tx: RemoteDb, row: typeof s.outbox.$inferSelect, data: unknown): Promise<void> {
  const parsed = row.tableName === 'order' ? OrderRowData.parse(data) : OrderVoidRowData.parse(data)
  await tx.update(s.outbox).set({ rowJson: parsed, status: 'pending', attempts: 0, deadAt: null, nextAttemptAt: null, lastError: null }).where(eq(s.outbox.id, row.id))
  const kids = await tx.select().from(s.outbox).where(and(eq(s.outbox.parentKey, row.idempotencyKey), eq(s.outbox.status, 'dead'))).all()
  for (const k of kids) if (decodeLastError(k.lastError).reason === 'PARENT_REJECTED') await tx.update(s.outbox).set({ status: 'pending', attempts: 0, deadAt: null, nextAttemptAt: null, lastError: null }).where(eq(s.outbox.id, k.id))
}

export async function renumberReceipt(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }): Promise<{ oldReceiptNo: string; newReceiptNo: string }> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'RENUMBER')
  const device = await requireDevice(db)
  const out = await db.transaction(async (tx) => {
    const data = OrderRowData.parse(row.rowJson)
    const newReceiptNo = nextReceiptNo(device.receiptPrefix, await lastReceiptNoOverall(tx, device))
    await tx.update(s.order).set({ receiptNo: newReceiptNo }).where(eq(s.order.id, data.pos_order_id))
    await appendOrderEvents(tx, { orderId: data.pos_order_id, deviceId: device.id, actorType: 'user', actorId: approver.id, at: deps.now(), newId: deps.newId },
      [{ type: 'RECEIPT_RENUMBERED', payload: { old: data.receipt_no, new: newReceiptNo, reason, approvedBy: approver.id, before: data } }])
    await requeue(tx, row, { ...data, receipt_no: newReceiptNo })
    return { oldReceiptNo: data.receipt_no, newReceiptNo }
  })
  deps.afterWrite?.()
  return out
}
```

ต่อในไฟล์เดียวกัน:

```ts
async function remapEvent(tx: RemoteDb, deps: ApiDeps, row: Row, approverId: string, type: 'CODE_REMAPPED' | 'STAFF_REMAPPED' | 'EXCLUDED_FROM_SYNC', payload: Record<string, unknown>): Promise<void> {
  const device = await requireDevice(tx)
  await appendOrderEvents(tx, { orderId: orderIdOf(row), deviceId: device.id, actorType: 'user', actorId: approverId, at: deps.now(), newId: deps.newId },
    [{ type, payload: { ...payload, key: row.idempotencyKey, approvedBy: approverId, before: row.rowJson } }]) // the whole old row stays in the hash chain
}

/** UNKNOWN_CODE: replace one code with an ACTIVE entry of the latest catalog. Money (`totals`) never changes (spec §6.4). */
export async function remapCode(db: RemoteDb, deps: ApiDeps, i: RemapCodeInput): Promise<void> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'REMAP_CODE')
  if (row.tableName !== 'order') throw new PosError('REMEDY_NOT_ALLOWED', 'only a bill row has codes')
  const c = await readCatalog(db)
  if (c === null) throw new PosError('NO_CATALOG', 'no catalog')
  const data = OrderRowData.parse(row.rowJson)
  const next = structuredClone(data)
  const tg = i.target
  if (tg.field === 'line') {
    const line = next.lines[tg.lineIndex]
    const v = c.catalog.variants.find((x) => x.menuCode === tg.code && x.size === tg.size && x.sweetness === tg.sweetness)
    if (line === undefined || v === undefined) throw new PosError('BAD_INPUT', 'เลือกเมนู/ขนาด/ความหวานที่มีในแคตตาล็อกล่าสุด')
    const grade = v.isMatcha ? (line.grade ?? c.catalog.gradeOptions.find((g) => g.isDefault)?.code ?? null) : null
    if (v.isMatcha && grade === null) throw new PosError('BAD_INPUT', 'เมนูมัตฉะต้องมีเกรด')
    next.lines[tg.lineIndex] = { ...line, code: tg.code, size: tg.size, sweetness: tg.sweetness, grade }
  } else if (tg.field === 'channel') {
    if (!c.catalog.channels.some((x) => x.code === tg.code)) throw new PosError('BAD_INPUT', 'ไม่มีช่องทางนี้ในแคตตาล็อกล่าสุด')
    next.channel = tg.code
  } else {
    if (!c.catalog.paymentMethods.some((x) => x.code === tg.code)) throw new PosError('BAD_INPUT', 'ไม่มีวิธีชำระนี้ในแคตตาล็อกล่าสุด')
    next.payment = tg.code
  }
  await db.transaction(async (tx) => {
    await remapEvent(tx, deps, row, approver.id, 'CODE_REMAPPED', { field: tg.field, target: tg, reason })
    await requeue(tx, row, next) // OrderRowData.parse inside; totals are the ones charged
  })
  deps.afterWrite?.()
}

/** UNKNOWN_STAFF: the seller (or the void's approver) becomes an ACTIVE staff member of the latest list. */
export async function remapStaff(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string; newStaffId: string }): Promise<void> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'REMAP_STAFF')
  const e = (await readCatalog(db))?.staff.find((x) => x.id === i.newStaffId)
  if (e === undefined || !e.active || roleOf(e.role) === null) throw new PosError('BAD_INPUT', 'เลือกพนักงานที่ใช้งานอยู่ในรายชื่อล่าสุด')
  const staffIds = new Set((await readCatalog(db))!.staff.map((x) => x.id))
  const data = row.rowJson as { staff_id: string; approved_by?: string | null }
  const next = row.tableName === 'order_void' && data.approved_by != null && !staffIds.has(data.approved_by)
    ? { ...data, approved_by: i.newStaffId } : { ...data, staff_id: i.newStaffId }
  await db.transaction(async (tx) => {
    await remapEvent(tx, deps, row, approver.id, 'STAFF_REMAPPED', { newStaffId: i.newStaffId, reason })
    await requeue(tx, row, next)
  })
  deps.afterWrite?.()
}

/** INVALID/FORBIDDEN/BAD_KEY, and a far-ahead CLOCK_AHEAD row by the owner's hand (N5): never sent again (ruling R8) — the row and its waiting children become local_only. */
export async function excludeFromSync(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }): Promise<void> {
  const { row, approver, reason } = await remedyRow(db, deps, i, 'EXCLUDE')
  await db.transaction(async (tx) => {
    await remapEvent(tx, deps, row, approver.id, 'EXCLUDED_FROM_SYNC', { reason })
    await tx.update(s.outbox).set({ status: 'local_only' }).where(eq(s.outbox.id, row.id))
    await tx.update(s.outbox).set({ status: 'local_only' }).where(and(eq(s.outbox.parentKey, row.idempotencyKey), inArray(s.outbox.status, ['pending', 'dead'])))
    if (row.tableName === 'order') await tx.update(s.order).set({ excludedAt: deps.now() }).where(eq(s.order.id, orderIdOf(row)))
  })
}

export async function retrySyncRow(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }): Promise<void> {
  await remedyRow(db, deps, i, 'RETRY')
  await db.transaction((tx) => retryRow(tx, i.outboxId))
  deps.afterWrite?.()
}

export async function listSyncProblems(db: RemoteDb, actorUserId: string): Promise<SyncProblemDto[]> {
  await requireOwner(db, actorUserId)
  // dead rows + pending rows flagged far ahead (ruling N5 — shown as "รอเวลา", EXCLUDE only)
  const dead = (await db.select().from(s.outbox).where(and(inArray(s.outbox.status, ['dead', 'pending']), inArray(s.outbox.tableName, ['order', 'order_void']))).orderBy(asc(s.outbox.createdAt)).all())
    .filter((r) => r.status === 'dead' || decodeLastError(r.lastError).farAhead === true)
  const receipts = new Map((await db.select({ id: s.order.id, receiptNo: s.order.receiptNo }).from(s.order).where(inArray(s.order.id, dead.map(orderIdOf))).all()).map((o) => [o.id, o.receiptNo]))
  const dto = (r: Row): SyncProblemDto => {
    const e = decodeLastError(r.lastError)
    return { outboxId: r.id, key: r.idempotencyKey, kind: r.tableName as PushKind, orderId: orderIdOf(r), receiptNo: receipts.get(orderIdOf(r)) ?? null, at: r.createdAt, reason: e.reason, detail: e.detail, remedies: remediesOf(e.reason, r.tableName), children: [] }
  }
  const byKey = new Map(dead.map((r) => [r.idempotencyKey, dto(r)]))
  const top: SyncProblemDto[] = []
  for (const r of dead) {
    const parent = r.parentKey === null ? undefined : byKey.get(r.parentKey)
    if (parent !== undefined && decodeLastError(r.lastError).reason === 'PARENT_REJECTED') parent.children.push(byKey.get(r.idempotencyKey)!)
    else top.push(byKey.get(r.idempotencyKey)!)
  }
  return top
}

export async function exportSyncRow(db: RemoteDb, i: { actorUserId: string; outboxId: string }): Promise<string> {
  await requireOwner(db, i.actorUserId)
  const r = await db.select().from(s.outbox).where(eq(s.outbox.id, i.outboxId)).get()
  if (r === undefined || (r.tableName !== 'order' && r.tableName !== 'order_void')) throw new PosError('BAD_INPUT', 'no such push row')
  return JSON.stringify({ key: r.idempotencyKey, kind: r.tableName, data: r.rowJson, lastError: decodeLastError(r.lastError), createdAt: r.createdAt }, null, 2) // no key, no PIN, no sync_state
}

/** spec §4.3 + review item 23 — owner only (R11). */
export async function listPriceDiffs(db: RemoteDb, actorUserId: string): Promise<PriceDiffDto[]> {
  await requireOwner(db, actorUserId)
  const bills = await db.select().from(s.order).where(inArray(s.order.status, ['paid', 'voided'])).orderBy(asc(s.order.soldAt)).all()
  const rows = await db.select().from(s.outbox).where(inArray(s.outbox.tableName, ['order', 'order_void'])).all()
  const statusOf = (key: string): string | undefined => rows.find((r) => r.idempotencyKey === key)?.status
  const out: PriceDiffDto[] = []
  for (const o of bills) {
    if (o.soldAt === null || o.receiptNo === null) continue
    const base = { orderId: o.id, receiptNo: o.receiptNo, soldAt: o.soldAt, totalSatang: o.totalSatang, computedTotalSatang: o.centralComputedTotalSatang,
      diffSatang: centralDiffSatang(o.centralComputedTotalSatang, o.totalSatang), catalogVersion: o.catalogVersion, amountMismatch: o.centralAmountMismatch === true }
    if (base.diffSatang !== null && base.diffSatang !== 0) out.push({ ...base, kind: 'amount' })
    if (o.status === 'voided' && statusOf(`order:${o.id}`) === 'sent' && statusOf(`order_void:${o.id}`) === 'local_only') out.push({ ...base, kind: 'void_local_only' })
  }
  return out
}
```

(`lastReceiptNoOverall` เปลี่ยนเป็น export ใน `sale.ts` · ทุกฟังก์ชันที่เขียนเรียก `deps.afterWrite?.()` หลัง commit)

`apps/pos/src/api/central-orders.ts`:

```ts
/** spec 04 §4.6: bot/web bills of today, online only — fetched when the page opens and every 5 minutes while open. */
export async function listCentralOrdersToday(ctx: SyncContext): Promise<CentralOrderDto[]> {
  const cfg = await ctx.serial(() => readDayoConfig(ctx.db, ctx.deps))
  if (cfg === null) throw new PosError('NEEDS_SETUP', 'not linked to dayo')
  if (await ctx.serial(() => apiBlocked(ctx.db, ctx.deps.now()))) throw new PosError('OFFLINE', 'api_blocked') // review item 14: no call with a revoked key
  const today = bangkokDateOf(ctx.deps.now())
  const client = createDayoClient({ ...cfg, fetch: ctx.deps.fetch, nowMs: () => Date.parse(ctx.deps.now()) })
  let rows
  try { rows = (await client.listOrders({ from: today, to: today })).value } catch (e) {
    if (e instanceof DayoError) { await ctx.serial(() => recordDayoFailure(ctx.db, ctx.deps, e.failure)); throw new PosError('OFFLINE', e.failure.kind) }
    throw e
  }
  await ctx.serial(() => ctx.db.transaction((tx) => applyDayoEdits(tx, ctx.deps, rows.filter((o) => o.pos_order_id != null)))) // own POS bills: dayo_edit, read-only (spec §4.6 · O1 pending)
  return rows
    .filter((o) => o.source !== 'pos')
    .map((o) => ({ orderNo: o.order_no, source: o.source, sourceLabel: o.source === 'line' ? 'บอท' : o.source === 'web' ? 'เว็บ' : o.source,
      createdByName: o.created_by_name ?? null, soldAt: o.sold_at ?? null, totalSatang: edgeBahtToSatang(o.totals.total), payment: o.payment, status: o.status, duplicateSuspect: o.duplicate_suspect ?? false }))
    .sort((a, b) => (b.soldAt ?? '').localeCompare(a.soldAt ?? ''))
}
```

`pos-api.ts`: ทางแก้ทุกตัวและ `listSyncProblems`/`exportSyncRow`/`listPriceDiffs` อยู่ใน serial · `listCentralOrdersToday: () => listCentralOrdersToday({ db, deps, serial })` (ไม่ห่อ serial) · ชื่อทั้งหมดใน `POS_API_METHODS` · import ของ `central-orders.ts`: `apiBlocked`, `readDayoConfig`, `recordDayoFailure`, `SyncContext` (Task 10), `createDayoClient`, `DayoError` (Task 9), `bangkokDateOf` (contracts), `edgeBahtToSatang` (domain)

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test` → PASS · `pnpm turbo run typecheck test` → ผ่าน

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/api/sync-problems.ts apps/pos/src/api/central-orders.ts apps/pos/src/api/sale.ts apps/pos/src/api/pos-api.ts apps/pos/src/api/types.ts apps/pos/src/api/errors.ts apps/pos/test/sync-problems.test.ts apps/pos/test/central-orders.test.ts
git commit -m "feat(pos): let the owner fix rejected rows and see today's bot and web bills"
```

---

## 5. สาย D — หน้าจอ

กติกาของสาย D: ใช้ API ผ่าน `useApi()` เท่านั้น (ไม่ import `@dayo/db-schema`) · เงินบนจอมาจาก `priceCart`/DTO เป็นสตางค์ แสดงด้วย `formatBaht` เดิมใน `apps/pos/src/ui/format.ts` · ข้อความใหม่อยู่ใน `apps/pos/src/ui/th.ts` · เทสต์คอมโพเนนต์ใช้ API ปลอม (object ที่ implement เฉพาะเมธอดที่หน้าใช้) และแคตตาล็อกจาก `@dayo/contracts/fixtures/pos-test/e1-catalog-rich.json` ผ่านตัวช่วย `apps/pos/src/test-utils/sell-catalog.ts` (Task 18) · ห้ามคิดเงินเองบนจอ (บวก/ลบสตางค์ในคอมโพเนนต์ = ผิด)

### Task 16: ซ่อนงานสต็อก + ตารางสิทธิ์ตามบทบาท

ผู้ทำ: pos-ui-developer (sonnet) · สเปก §3 (สต็อก), §7 ข้อ 6, §11, §12 Q44 · D60 · ruling R11 · ไม่รอใคร

**Files:**
- Modify: `apps/pos/src/router.tsx` (ลบ route `/stock*` ออกจาก `routeTree` — import คอมโพเนนต์สต็อกออกด้วย ไฟล์คอมโพเนนต์คงไว้), `apps/pos/src/screens/SellScreen.tsx` (ลบ badge สต็อก, แบนเนอร์เบสหมดอายุ, query `stockOverview`, ปุ่ม/ลิงก์ไป `/stock`), `apps/pos/src/app/queries.ts` (ลบ `stockKey` ถ้าไม่มีผู้ใช้)
- Create: `apps/pos/src/app/permissions.ts`, `apps/pos/src/app/permissions.test.ts`
- Move: `apps/pos/e2e/stock-{adjust,count,produce,receive}.spec.ts` → `apps/pos/e2e/hidden-stock/` (ใช้ `git mv`) · Modify: `apps/pos/playwright.config.ts` (`testIgnore: ['**/hidden-stock/**']`)
- Modify tests: `apps/pos/src/screens/SellScreen.test.tsx` (เอา assertion ของ badge สต็อกออก และเพิ่มว่าไม่มีลิงก์สต็อก)

**Interfaces:**
- Produces:

```ts
export type Action = 'sell' | 'void_own' | 'void_any' | 'open_shift' | 'close_shift' | 'cash_move' | 'count_cash' | 'central_orders'
  | 'view_shift_report' | 'price_diffs' | 'system_status' | 'device_setup' | 'set_other_pin' | 'sync_problems' | 'backup'
export function can(role: UserRole, action: Action): boolean
```

| Action | staff | manager | owner |
|---|---|---|---|
| sell · void_own · open_shift · close_shift · cash_move · count_cash · central_orders · system_status | ✓ | ✓ | ✓ |
| view_shift_report (Q44: manager "+ ดูรายงานกะ") | | ✓ | ✓ |
| void_any · price_diffs · device_setup · set_other_pin · sync_problems · backup | | | ✓ |

(Q44 ตรงตัว — ruling R11: manager ยกเลิกได้เฉพาะบิลตัวเองเหมือน staff · "บันทึกค่าใช้จ่าย" ของ manager มาในก้อน 4)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/src/app/permissions.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { can } from './permissions'

describe('Q44 role table', () => {
  it.each([
    ['staff', 'sell', true], ['staff', 'void_own', true], ['staff', 'void_any', false], ['staff', 'sync_problems', false], ['staff', 'central_orders', true],
    ['manager', 'void_own', true], ['manager', 'void_any', false], ['manager', 'price_diffs', false], ['manager', 'view_shift_report', true], ['manager', 'device_setup', false], ['manager', 'set_other_pin', false],
    ['owner', 'void_any', true], ['owner', 'price_diffs', true],
    ['owner', 'device_setup', true], ['owner', 'set_other_pin', true], ['owner', 'sync_problems', true], ['owner', 'backup', true],
  ] as const)('%s may %s: %s', (role, action, ok) => { expect(can(role, action)).toBe(ok) })
})
```

และเพิ่มใน `SellScreen.test.tsx`: `expect(screen.queryByTestId('nav-stock')).toBeNull()` และ `expect(api.stockOverview).not.toHaveBeenCalled()`

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos test -- permissions SellScreen` · FAIL
- [ ] **Step 3: เขียนโค้ด** — `permissions.ts` ตามตาราง (`const TABLE: Record<UserRole, ReadonlySet<Action>>`) · แก้ router/SellScreen/queries · `git mv` e2e สต็อก · `testIgnore`
- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test` → PASS · `pnpm --filter @dayo/pos typecheck` → ผ่าน
- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/router.tsx apps/pos/src/screens/SellScreen.tsx apps/pos/src/screens/SellScreen.test.tsx apps/pos/src/app/queries.ts apps/pos/src/app/permissions.ts apps/pos/src/app/permissions.test.ts apps/pos/playwright.config.ts apps/pos/e2e/hidden-stock/
git commit -m "feat(pos): hide the stock screens and add the role permission table"
```

---

### Task 17: ตั้งเครื่องด้วยกุญแจ · เชื่อมเครื่องเดิม · ล็อกอิน · ตั้ง PIN พนักงาน

ผู้ทำ: pos-ui-developer (sonnet) · ผู้ตรวจเพิ่ม: **security-reviewer** · สเปก §6.5, §6.6, §6.9, §7 ข้อ 1/5 · รอ Task 11 (+ Task 16)

**ปรับตาม dayo (สเปก §4.4 ข้อ 6 · §6.6)**: ข้อความไทยของ `DAYO_RECEIPT_NO_INVALID` (Task 11) ใน `ui/th.ts`/`ui/errors.ts`: "เลขใบเสร็จล่าสุดที่ระบบกลางจำไว้ (<ค่า>) ไม่ใช่รูปแบบของแท็บเล็ต — ให้เจ้าของตรวจกุญแจเครื่องบนเว็บ dayo" · หน้าตั้งเครื่องหยุดที่ขั้นทดสอบกุญแจ (ไม่ให้เลือก prefix เอง) · เพิ่มเทสต์หนึ่งข้อ

**Files:**
- Modify: `apps/pos/src/screens/SetupScreen.tsx` (เขียนใหม่), `apps/pos/src/screens/LoginScreen.tsx`, `apps/pos/src/screens/IndexRedirect.tsx`, `apps/pos/src/ui/th.ts`
- Create: `apps/pos/src/screens/ConnectFields.tsx` (ช่องที่อยู่ + กุญแจ + ปุ่มทดสอบ + สแกน QR — ใช้ซ้ำใน Task 20), `apps/pos/src/screens/StaffPinDialog.tsx`, `apps/pos/src/screens/OwnerRecoveryScreen.tsx` (N2), `apps/pos/src/ui/qr-scan.ts`
- Test: `apps/pos/src/screens/SetupScreen.test.tsx`, `apps/pos/src/screens/StaffPinDialog.test.tsx`, `apps/pos/src/screens/LoginScreen.test.tsx`, `apps/pos/src/screens/OwnerRecoveryScreen.test.tsx`

**Interfaces:**
- Consumes: `api.probeDayo`, `api.connectShop`, `api.setStaffPin`, `api.recoverOwner`, `api.bootstrap` (`needsSetup`, `legacyDevice`, `users`, `staffNeedingPin`, `ownerRecovery`) — Task 11
- Produces: `<ConnectFields value onChange onProbed />` — `value: { baseUrl: string; apiKey: string }` · `onProbed(p: DayoProbe)` · `qrScanSupported(): boolean` · `scanQrOnce(video: HTMLVideoElement): Promise<string>` (ใช้ `BarcodeDetector` ของ Chrome Android — ไม่มี = ซ่อนปุ่มสแกน · spec §7 ข้อ 1 "สแกนหรือวาง")

พฤติกรรมหน้าตั้งเครื่อง (ขั้นเดียว เลื่อนลง):
1. ช่อง `setup-base-url` (ค่าเริ่มต้น `import.meta.env.VITE_DAYO_BASE_URL ?? ''`) · ช่อง `setup-api-key` (`type="password"`, `autocomplete="off"`, `spellcheck=false`) · ปุ่ม `setup-scan` (เมื่อมี `BarcodeDetector`) · ปุ่ม `setup-probe` → `probeDayo` → แสดง `setup-client-name` ("เชื่อมกับ: แท็บเล็ตขาย 1"), เตือนเหลืองเมื่อ `pricingMatches = false`, ข้อความ error ภาษาไทยตามรหัส `DAYO_*`
2. หลังทดสอบผ่าน: ตัวเลือกเจ้าของ `setup-owner-<displayName>` (จาก `owners`) · `setup-prefix` (เติม `requiredPrefix` และล็อกเมื่อมี) · `setup-pin`, `setup-pin2` · `setup-promptpay`
3. เครื่องเดิม (`legacyDevice`): เพิ่ม `setup-legacy-user` (เลือก owner เดิมจาก `users`) + `setup-legacy-pin` · หัวข้อ "เชื่อมเครื่องนี้กับระบบกลาง"
4. `setup-save` → `connectShop` → `navigator.storage?.persist?.()` แล้วแสดงผลที่ `setup-persist-status` ("เก็บข้อมูลถาวร: ได้/ไม่ได้" — spec §6.9) → ไป `/`
5. ห้ามแสดงกุญแจที่พิมพ์แล้วซ้ำที่ใดบนจอหลังบันทึก · ห้าม `console.log` ค่า input

หน้าล็อกอิน: รายชื่อ `users` เดิม (`user-<displayName>`) + หัวข้อ "ต้องตั้ง PIN ก่อนใช้" แสดง `staffNeedingPin` (`needs-pin-<displayName>`) → `StaffPinDialog`: เลือกเจ้าของผู้อนุมัติ (`staff-pin-approver`), PIN เจ้าของ (`staff-pin-approver-pin`), PIN ใหม่ 2 ครั้ง (`staff-pin-new`, `staff-pin-new2`), `staff-pin-save` → `setStaffPin` → กลับหน้าล็อกอิน (ผู้ใช้ใหม่ขึ้นในรายชื่อ) · error `PIN_LOCKED` แสดงเวลารอตาม D50 Q3-21

**กู้สิทธิ์เจ้าของ (N2):** เมื่อ `bootstrap().ownerRecovery` หน้าล็อกอินแสดงแถบ `owner-recovery-banner` "ไม่มีเจ้าของที่ใช้งานได้บนเครื่องนี้" + ปุ่ม `owner-recovery` **"เชื่อมใหม่ด้วยคีย์ใหม่"** → `/owner-recovery` (`OwnerRecoveryScreen` — ไม่ต้องล็อกอิน): ขั้นตอนบนจอ 1) ล็อกอินเว็บ dayo ด้วย LINE ในฐานะเจ้าของ แล้วออกกุญแจใหม่ที่ `/settings/api-clients` 2) **เพิกถอนกุญแจเก่า** ของเครื่องนี้บนเว็บ 3) สแกน/วางกุญแจใหม่ (`ConnectFields`) 4) `probeDayo` แล้วเลือกเจ้าของ `recovery-owner-<displayName>` จาก `owners` 5) PIN 2 ครั้ง `recovery-pin`, `recovery-pin2` → `recovery-save` → `recoverOwner` → กลับหน้าล็อกอิน · `OLD_KEY_STILL_ACTIVE` = "ยังไม่ได้เพิกถอนกุญแจเก่าบนเว็บ — เพิกถอนก่อนแล้วกดอีกครั้ง" · `KEY_NOT_NEW` = "นี่คือกุญแจเดิม — ออกกุญแจใหม่บนเว็บ" · `RECOVERY_NOT_ALLOWED` = "ยังมีเจ้าของที่ใช้ PIN อนุมัติได้ — ใช้ 'เปลี่ยนกุญแจ' ที่หน้าสถานะ" (ข้อความสามรหัสนี้อยู่ใน `ui/errors.ts`)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/src/screens/SetupScreen.test.tsx`

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithApi } from '../test-utils/render'
import { SetupScreen } from './SetupScreen'

const KEY = `dayo_${'0123456789abcdef'.repeat(4)}`
const probe = { clientName: 'แท็บเล็ตขาย 1', lastReceiptNo: 'B-000311', requiredPrefix: 'B', catalogVersion: 42, owners: [{ id: 'o1', displayName: 'TungAo' }, { id: 'o2', displayName: 'DCm' }], pricingMatches: true }

describe('SetupScreen (spec 04 §7 ข้อ 1)', () => {
  it('tests the key with E1, then saves with the chosen owner and the locked prefix', async () => {
    const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: false, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => probe), connectShop: vi.fn(async () => undefined) }
    renderWithApi(<SetupScreen />, api)
    fireEvent.change(screen.getByTestId('setup-base-url'), { target: { value: 'https://dayo.example/api/v1' } })
    fireEvent.change(screen.getByTestId('setup-api-key'), { target: { value: KEY } })
    fireEvent.click(screen.getByTestId('setup-probe'))
    expect(await screen.findByTestId('setup-client-name')).toHaveTextContent('แท็บเล็ตขาย 1')
    expect(screen.getByTestId('setup-prefix')).toHaveValue('B')
    expect(screen.getByTestId('setup-prefix')).toBeDisabled()
    fireEvent.click(screen.getByTestId('setup-owner-TungAo'))
    fireEvent.change(screen.getByTestId('setup-pin'), { target: { value: '1111' } })
    fireEvent.change(screen.getByTestId('setup-pin2'), { target: { value: '1111' } })
    fireEvent.change(screen.getByTestId('setup-promptpay'), { target: { value: '0812345678' } })
    fireEvent.click(screen.getByTestId('setup-save'))
    await waitFor(() => expect(api.connectShop).toHaveBeenCalledWith({ baseUrl: 'https://dayo.example/api/v1', apiKey: KEY, receiptPrefix: 'B', ownerStaffId: 'o1', ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null }))
  })
  it('the key field never echoes the key after saving and is a password field', async () => {
    const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: false, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => probe), connectShop: vi.fn(async () => undefined) }
    renderWithApi(<SetupScreen />, api)
    expect(screen.getByTestId('setup-api-key')).toHaveAttribute('type', 'password')
    expect(screen.getByTestId('setup-api-key')).toHaveAttribute('autocomplete', 'off')
  })
  it('shows a Thai message for a refused key', async () => {
    const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: false, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => { throw new Error('DAYO_BAD_KEY: key refused') }), connectShop: vi.fn() }
    renderWithApi(<SetupScreen />, api)
    fireEvent.change(screen.getByTestId('setup-api-key'), { target: { value: KEY } })
    fireEvent.click(screen.getByTestId('setup-probe'))
    expect(await screen.findByRole('alert')).toHaveTextContent('กุญแจไม่ถูกต้องหรือถูกยกเลิก')
  })
  it('a pre-block-2 device asks for an old owner PIN (ruling R7)', async () => {
    const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: true, users: [{ id: 'old', displayName: 'TungAo', role: 'owner' }], staffNeedingPin: [] })), probeDayo: vi.fn(async () => ({ ...probe, requiredPrefix: null, lastReceiptNo: null })), connectShop: vi.fn(async () => undefined) }
    renderWithApi(<SetupScreen />, api)
    expect(await screen.findByTestId('setup-legacy-pin')).toBeInTheDocument()
  })
})
```

(`apps/pos/src/test-utils/render.tsx` — `renderWithApi(ui, fakeApi)` ห่อด้วย `ApiContext`, `QueryClientProvider`, router memory · ถ้ามีตัวช่วยเดิมใน `screens/*.test.tsx` ให้ย้ายมาใช้ร่วม)

`StaffPinDialog.test.tsx`: ใส่ PIN ใหม่ไม่ตรงกัน = ปุ่มบันทึก disabled · บันทึกเรียก `setStaffPin({ staffId, pin, approverUserId, approverPin })` · `PIN_LOCKED: 30` แสดง "ลองใหม่ใน 30 วินาที"

`LoginScreen.test.tsx`: แสดง `needs-pin-Mint` เมื่อ `staffNeedingPin` มี Mint · กดแล้วเปิด dialog · `ownerRecovery: true` → แสดง `owner-recovery` · `false` → ไม่แสดง

```tsx
// OwnerRecoveryScreen.test.tsx (ruling N2)
it('walks the owner through a new key and a PIN for an active dayo owner', async () => {
  const probe = { clientName: 'แท็บเล็ตขาย 1', lastReceiptNo: 'A-000120', requiredPrefix: 'A', catalogVersion: 43, owners: [{ id: 'dcm', displayName: 'DCm' }], pricingMatches: true }
  const api = { bootstrap: vi.fn(async () => ({ needsSetup: false, ownerRecovery: true, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => probe), recoverOwner: vi.fn(async () => undefined) }
  renderWithApi(<OwnerRecoveryScreen />, api)
  expect(await screen.findByText(/เพิกถอนกุญแจเก่า/)).toBeInTheDocument()
  fireEvent.change(screen.getByTestId('setup-base-url'), { target: { value: 'https://dayo.example/api/v1' } })
  fireEvent.change(screen.getByTestId('setup-api-key'), { target: { value: KEY } })
  fireEvent.click(screen.getByTestId('setup-probe'))
  fireEvent.click(await screen.findByTestId('recovery-owner-DCm'))
  fireEvent.change(screen.getByTestId('recovery-pin'), { target: { value: '2468' } })
  fireEvent.change(screen.getByTestId('recovery-pin2'), { target: { value: '2468' } })
  fireEvent.click(screen.getByTestId('recovery-save'))
  await waitFor(() => expect(api.recoverOwner).toHaveBeenCalledWith({ baseUrl: 'https://dayo.example/api/v1', apiKey: KEY, ownerStaffId: 'dcm', ownerPin: '2468' }))
})
it('says to revoke the old key when dayo still accepts it', async () => {
  const api = { bootstrap: vi.fn(async () => ({ needsSetup: false, ownerRecovery: true, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => ({ clientName: 'x', lastReceiptNo: null, requiredPrefix: null, catalogVersion: 1, owners: [{ id: 'dcm', displayName: 'DCm' }], pricingMatches: true })), recoverOwner: vi.fn(async () => { throw new Error('OLD_KEY_STILL_ACTIVE: revoke') }) }
  renderWithApi(<OwnerRecoveryScreen />, api)
  fireEvent.change(await screen.findByTestId('setup-api-key'), { target: { value: KEY } })
  fireEvent.click(screen.getByTestId('setup-probe'))
  fireEvent.click(await screen.findByTestId('recovery-owner-DCm'))
  fireEvent.change(screen.getByTestId('recovery-pin'), { target: { value: '2468' } })
  fireEvent.change(screen.getByTestId('recovery-pin2'), { target: { value: '2468' } })
  fireEvent.click(screen.getByTestId('recovery-save'))
  expect(await screen.findByText('ยังไม่ได้เพิกถอนกุญแจเก่าบนเว็บ — เพิกถอนก่อนแล้วกดอีกครั้ง')).toBeInTheDocument()
})
```

(`KEY` = ค่าคงที่เดียวกับใน `SetupScreen.test.tsx` · route `/owner-recovery` เพิ่มใน `router.tsx` นอก `RequireSession`)

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos test -- SetupScreen StaffPinDialog LoginScreen OwnerRecoveryScreen` · FAIL
- [ ] **Step 3: เขียนหน้าจอ** ตามพฤติกรรมข้างบน · ข้อความไทยใน `th.ts`: `setupTitle: 'ตั้งเครื่องขาย'`, `setupLinkTitle: 'เชื่อมเครื่องนี้กับระบบกลาง'`, `dayoBadKey: 'กุญแจไม่ถูกต้องหรือถูกยกเลิก'`, `dayoNoScope: 'กุญแจนี้ไม่มีสิทธิ์อ่านเมนู/พนักงาน'`, `dayoApiOff: 'ระบบกลางปิด API อยู่'`, `dayoUnreachable: 'ติดต่อระบบกลางไม่ได้ — ต้องออนไลน์ตอนตั้งเครื่อง'`, `pricingMismatchSetup: 'ตัวคิดราคาในเครื่องไม่ตรงกับระบบกลาง — ขายได้ แต่แจ้งทีม POS'`, `needsPinTitle: 'ต้องตั้ง PIN ก่อนใช้'`, `persistOk: 'เก็บข้อมูลถาวร: ได้'`, `persistNo: 'เก็บข้อมูลถาวร: ไม่ได้ — อย่าล้างข้อมูลเบราว์เซอร์'` · `ui/errors.ts` (ไฟล์ของสาย D — review item 10) แปลง **ทุกรหัสใหม่ของสาย C** เป็นข้อความไทย: `DAYO_BAD_KEY`, `DAYO_KEY_NO_SCOPE`, `DAYO_API_DISABLED`, `DAYO_UNREACHABLE`, `DAYO_BAD_RESPONSE` (ข้อความข้างบน) · `NO_CATALOG` 'ยังไม่มีเมนูจากระบบกลาง — ต่อเน็ตแล้วกด "ส่งตอนนี้"' · `PRICE_NOT_OK` 'คิดราคาไม่ได้: <รายละเอียด>' · `NO_PAYMENT_METHOD` 'ระบบกลางไม่มีวิธีชำระนี้' · `QUEUE_FULL` 'เลขคิววันนี้เต็ม (9999)' · `RECOVERY_NOT_ALLOWED` / `KEY_NOT_NEW` / `OLD_KEY_STILL_ACTIVE` (ข้อความในหัวข้อกู้สิทธิ์เจ้าของ — N2) · `REMEDY_NOT_ALLOWED` 'ทางแก้นี้ใช้กับเหตุผลนี้ไม่ได้' · `OFFLINE` 'ต้องออนไลน์' · `VOID_NOT_ALLOWED` ขึ้นต้น `SAME_DAY_ONLY` 'ยกเลิกได้เฉพาะวันเดียวกับวันขาย' / `OWN_BILLS_ONLY` 'ยกเลิกได้เฉพาะบิลที่ตัวเองขาย' · เทสต์ `ui/errors.test.ts`: ทุกค่าใน `PosErrorCode` มีข้อความไทย (วนทุกรหัส — รหัสที่สาย C เพิ่มภายหลังทำให้เทสต์นี้ล้มจนสาย D เติมข้อความ)
- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test` → PASS · typecheck ผ่าน
- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/screens/OwnerRecoveryScreen.tsx apps/pos/src/screens/OwnerRecoveryScreen.test.tsx apps/pos/src/router.tsx apps/pos/src/screens/SetupScreen.tsx apps/pos/src/screens/SetupScreen.test.tsx apps/pos/src/screens/ConnectFields.tsx apps/pos/src/screens/StaffPinDialog.tsx apps/pos/src/screens/StaffPinDialog.test.tsx apps/pos/src/screens/LoginScreen.tsx apps/pos/src/screens/LoginScreen.test.tsx apps/pos/src/screens/IndexRedirect.tsx apps/pos/src/ui/th.ts apps/pos/src/ui/errors.ts apps/pos/src/ui/qr-scan.ts apps/pos/src/test-utils/render.tsx
git commit -m "feat(pos): set the tablet up with a dayo key and let owners give staff a pin"
```

---

### Task 18 (18a–18b): หน้าขายด้วยแคตตาล็อกกลาง (ตัวเลือก นมโอ๊ต/เกรด · โปร · ช่องทาง)

ผู้ทำ: pos-ui-developer (sonnet) · สเปก §4.4, §5.1, §6.5 (ฉบับเปลี่ยนระหว่างตะกร้า), §9 ก้อน 2 · D50 Q3-7/Q3-8/Q3-9/Q3-20/Q3-27 · รอ Task 12b · **รอ A2** (ห้ามเริ่มก่อน A2 merge)

**ปรับตาม dayo (มีผลเหนือโค้ดข้างล่าง · สเปก §4.4 ข้อ 12 · §5.1 · §13.6 S1–S3)**:
- **ปุ่มขนาดสร้างจาก `SellMenuDto.sizes`** (= `catalog.sizes` ที่ active และเมนูมีตัวแปร เรียง `sortOrder` — Task 12b) · ป้ายปุ่ม = `label` ของขนาด · **ห้ามเขียน `'16 oz'`/`'20 oz'` ตายตัวในหน้าจอ/สถานะตะกร้า** (`grep -rn "'20 oz'" apps/pos/src/screens apps/pos/src/state apps/pos/src/app` → มีได้เฉพาะในเทสต์) · `CartLine.size: string`
- ค่าเริ่มต้นของ `ItemDialog` = `menu.defaultSize` (ไม่ใช่ "16 oz ถ้ามี")
- ก่อนชำระ ตัวตรวจขนาดของ A2 ทำงานใน `usePricedCart`/`useCommitSale` — บรรทัดที่ขนาดถูกปิดหลังแคตตาล็อกใหม่มาถึง (ระหว่างมีตะกร้า) แสดงเป็นบรรทัดผิด "ขนาดนี้ปิดขายแล้ว" และปุ่มชำระกดไม่ได้จนลบ/แก้บรรทัด (ใช้กลไก `PRICE_CHANGED` เดิมไม่ได้ เพราะคิดราคาไม่ได้)
- `categoryLabel` null → ใช้ `family` (มาจาก DTO แล้ว)
- เพิ่มเทสต์: `ItemDialog` กับเมนูที่มี 3 ขนาด (`16 oz`, `20 oz`, `22 oz`) แสดง 3 ปุ่มเรียงตาม `sortOrder` · ขนาดที่ปิดไม่แสดง · ตะกร้าที่มีขนาดที่ถูกปิดทำให้ `pay-cash`/`pay-qr` ถูกปิด

**แบ่งเป็น 2 งานย่อย** (review item 16 — ตรวจและ commit แยก):

| งานย่อย | ไฟล์ | เทสต์ที่ต้องผ่าน |
|---|---|---|
| **18a** สถานะตะกร้า + hook คิดราคา + hook ชำระ | `state/cart.ts`, `app/cart-context.tsx`, `app/use-priced-cart.ts`, `app/use-commit-sale.ts`, `test-utils/sell-catalog.ts` | `cart.test.ts`, `cart-context.test.tsx`, `use-commit-sale.test.tsx` (รวมเคส PRICE_CHANGED) |
| **18b** หน้าจอ (รอ 18a) | `screens/{SellScreen,ItemDialog,CartPanel,DiscountDialog,CashPayScreen,QrPayScreen,PromoPanel}.tsx`, `ui/th.ts` | `SellScreen.test.tsx`, `ItemDialog.test.tsx`, `CartPanel.test.tsx` |

**Files:**
- Modify: `apps/pos/src/state/cart.ts` (เขียนใหม่), `apps/pos/src/state/cart.test.ts`, `apps/pos/src/app/cart-context.tsx`, `apps/pos/src/app/use-commit-sale.ts` (+ test), `apps/pos/src/screens/{SellScreen,ItemDialog,CartPanel,DiscountDialog,CashPayScreen,QrPayScreen}.tsx` (+ tests ที่มี), `apps/pos/src/ui/th.ts`
- Create: `apps/pos/src/screens/PromoPanel.tsx`, `apps/pos/src/app/use-priced-cart.ts`, `apps/pos/src/test-utils/sell-catalog.ts`

**Interfaces:**
- Consumes: `api.loadSellCatalog()` → `SellCatalogDto` · `api.recordSale(RecordSaleInput)` (Task 12) · `priceCart`, `lineOptions`, `menuUnitPriceSatang`, `CartDraft`, `PricedCart` (`@dayo/domain`, Task 3)
- Produces:

```ts
// state/cart.ts
export type CartLine = { key: string; code: string; nameTh: string; size: Size; sweetness: Sweetness; milk: MilkCode; grade: string | null; qty: number }
export type CartState = { orderId: string; lines: CartLine[]; channelCode: string; billDiscount: { satang: number; reason: string } | null; promoCode: string | null; skipPromotionIds: string[]; noPromotions: boolean }
export type CartAction =
  | { type: 'add'; line: Omit<CartLine, 'key' | 'qty'>; maxQty: number }       // same code|size|sweetness|milk|grade → one line (D48 Q3-8)
  | { type: 'inc'; key: string; maxQty: number } | { type: 'dec'; key: string } | { type: 'remove'; key: string }
  | { type: 'setChannel'; channelCode: string } | { type: 'setDiscount'; satang: number; reason: string } | { type: 'clearDiscount' }
  | { type: 'skipPromotion'; id: string } | { type: 'unskipPromotion'; id: string } | { type: 'setNoPromotions'; value: boolean } | { type: 'setPromoCode'; code: string | null }
  | { type: 'reset'; orderId: string; channelCode: string }
export function cartReducer(state: CartState, action: CartAction): CartState
export function toCartDraft(state: CartState): Omit<CartDraft, 'paymentCode'>
// app/use-priced-cart.ts — re-prices on every change and every 30 s (time-window promotions — spec §4.4 rule 4)
export function usePricedCart(state: CartState, catalog: PosOrderCatalog | undefined): { priced: PricedCart | null; error: string | null }
```

พฤติกรรม:
- แท็บหมวดจาก `categories` + แท็บ "ขายดี" (`bestSellerCodes`, ซ่อนเมื่อว่าง — D48 Q3-9) · การ์ดเมนู `menu-<code>` แสดงชื่อไทยและราคาของตัวแปรเริ่มต้นบนช่องทางที่เลือก (`menuUnitPriceSatang`)
- `ItemDialog`: ขนาด `item-size-16oz`/`item-size-20oz` (เฉพาะที่มี) · ความหวาน `item-sweet-<n>` (เฉพาะที่ขนาดนั้นมี) · นม `item-milk-fresh`/`item-milk-oat` (จาก `lineOptions` — ไม่มีนมโอ๊ต = ไม่มีปุ่ม) + ราคาเพิ่ม · เกรด `item-grade-<code>` (เมนูมัตฉะเท่านั้น เลือกค่าเริ่มต้นไว้) · ค่าเริ่มต้นนม = `defaultMilk` · `item-add`
- ตะกร้า: บรรทัด `cart-line-<i>` ตามผล `priced.lines` (ราคาต่อแก้ว ส่วนลดต่อแก้ว รวมบรรทัด) · ปุ่ม +/− จำกัด `maxQtyPerLine` · ช่องทาง `channel-select` (ค่าเริ่มต้น `defaultChannelCode`) · `PromoPanel`: รายการ `promo-<id>` ที่ได้ พร้อมยอดลด และปุ่ม `promo-skip-<id>` ("ไม่ใช้") · สวิตช์ `no-promotions` ("ไม่ใช้โปรทั้งบิล") · ช่อง `promo-code` · ส่วนลดทั้งบิล (DiscountDialog เดิม — จำนวนบาท + เหตุผล) · ยอดรวม `cart-total` · ปุ่ม `pay-cash`, `pay-qr` (ซ่อน `pay-qr` เมื่อ `payments.qr = false`) · `!priced.ok` = แสดงคำเตือนจาก `warnings` และปิดปุ่มชำระ
- ชำระ: `recordSale({ orderId, actorUserId, cart: toCartDraft(state), payment, expectedTotalSatang: priced.totalSatang })` · ได้ `PRICE_CHANGED` → โหลด `loadSellCatalog` ใหม่ แสดง "ยอดเดิม ฿X → ยอดใหม่ ฿Y" ให้กด `price-changed-confirm` แล้วส่งใหม่ด้วยยอดใหม่ (D50 Q3-27) · QR สร้างใหม่จากยอดใหม่
- ฉบับเปลี่ยนระหว่างมีตะกร้า (spec §6.5): `loadSellCatalog` refetch ทุก 60 วิ · เมื่อ `catalogVersion` เปลี่ยน แสดงแถบ "เมนู/ราคาจากระบบกลางเปลี่ยน — คิดราคาใหม่แล้ว" (`catalog-changed`) และคิดราคาด้วยฉบับใหม่ทันที · บรรทัดที่เมนูหายจากฉบับใหม่ขึ้นเตือนและต้องลบก่อนชำระ
- ไม่มีแคตตาล็อก (`NO_CATALOG`) = หน้าแจ้ง "ยังไม่มีเมนูจากระบบกลาง — ต่อเน็ตแล้วกด 'ส่งตอนนี้' ในหน้าสถานะ"

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/src/state/cart.test.ts` (reducer) และ `apps/pos/src/screens/SellScreen.test.tsx`

```ts
// cart.test.ts
import { describe, expect, it } from 'vitest'
import { cartReducer, toCartDraft, type CartState } from './cart'

const empty: CartState = { orderId: 'o1', lines: [], channelCode: 'store', billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false }
const tt = { code: 'Thai Tea', nameTh: 'ชาไทย', size: '16 oz' as const, sweetness: '50%' as const, milk: 'fresh' as const, grade: null }

describe('cart reducer (block 2)', () => {
  it('merges the same drink and options into one line, oat is a different line', () => {
    let s = cartReducer(empty, { type: 'add', line: tt, maxQty: 99 })
    s = cartReducer(s, { type: 'add', line: tt, maxQty: 99 })
    s = cartReducer(s, { type: 'add', line: { ...tt, milk: 'oat' }, maxQty: 99 })
    expect(s.lines.map((l) => [l.milk, l.qty])).toEqual([['fresh', 2], ['oat', 1]])
  })
  it('never goes above maxQtyPerLine (computeOrder would clamp silently)', () => {
    let s = cartReducer(empty, { type: 'add', line: tt, maxQty: 2 })
    s = cartReducer(s, { type: 'inc', key: s.lines[0]!.key, maxQty: 2 })
    s = cartReducer(s, { type: 'inc', key: s.lines[0]!.key, maxQty: 2 })
    expect(s.lines[0]!.qty).toBe(2)
  })
  it('builds the draft the API prices', () => {
    const s = cartReducer(cartReducer(empty, { type: 'add', line: tt, maxQty: 99 }), { type: 'setDiscount', satang: 500, reason: 'ลูกค้าประจำ' })
    expect(toCartDraft(cartReducer(s, { type: 'skipPromotion', id: 'p1' }))).toEqual({
      channelCode: 'store', promoCode: null, skipPromotionIds: ['p1'], noPromotions: false,
      billDiscount: { kind: 'satang', satang: 500, reason: 'ลูกค้าประจำ' },
      lines: [{ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, free: false, discountSatang: null, discountPercent: null, discountReason: null }],
    })
  })
})
```

```tsx
// SellScreen.test.tsx (เพิ่ม)
it('Thai Tea ×3 shows the buy-2-get-1 promotion and ฿70.00; "ไม่ใช้" puts it back to ฿105.00', async () => {
  const { api } = sellApi() // test-utils/sell-catalog.ts: fake api with loadSellCatalog from e1-catalog-rich.json
  renderSell(api)
  for (let i = 0; i < 3; i++) { fireEvent.click(await screen.findByTestId('menu-Thai Tea')); fireEvent.click(screen.getByTestId('item-add')) }
  expect(await screen.findByTestId('cart-total')).toHaveTextContent('70.00')
  fireEvent.click(screen.getByTestId('promo-skip-9f8e0000-0000-4000-8000-000000000001'))
  expect(screen.getByTestId('cart-total')).toHaveTextContent('105.00')
})
it('offers oat for Thai Tea but not for Cocoa; a matcha shows its grades', async () => {
  const { api } = sellApi()
  renderSell(api)
  fireEvent.click(await screen.findByTestId('menu-Thai Tea'))
  expect(screen.getByTestId('item-milk-oat')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('item-cancel'))
  fireEvent.click(screen.getByTestId('menu-Cocoa'))
  expect(screen.queryByTestId('item-milk-oat')).toBeNull()
  fireEvent.click(screen.getByTestId('item-cancel'))
  fireEvent.click(screen.getByTestId('menu-Matcha Latte'))
  expect(screen.getByTestId('item-grade-Premium')).toBeInTheDocument()
})
it('the Grab channel prices Thai Tea 20 oz at ฿59.00 (45 × 1.30 rounded up)', async () => {
  const { api } = sellApi()
  renderSell(api)
  fireEvent.change(await screen.findByTestId('channel-select'), { target: { value: 'grab' } })
  fireEvent.click(screen.getByTestId('menu-Thai Tea'))
  fireEvent.click(screen.getByTestId('item-size-20oz'))
  fireEvent.click(screen.getByTestId('item-add'))
  expect(await screen.findByTestId('cart-total')).toHaveTextContent('59.00')
})
```

```tsx
// use-commit-sale.test.tsx (เพิ่ม — hook เดิมได้สถานะ priceChanged + confirmPriceChange)
it('PRICE_CHANGED keeps the sale unpaid and shows old → new until the cashier confirms (D50 Q3-27)', async () => {
  const RESULT = { orderId: 'o1', receiptNo: 'A-000001', queueNo: 1, businessDate: '2026-09-25', totalSatang: 7_500, changeSatang: null, method: 'PROMPTPAY' as const }
  const recordSale = vi.fn().mockRejectedValueOnce(new Error('PRICE_CHANGED: shown 7000, now 7500')).mockResolvedValueOnce(RESULT)
  const { result } = renderHook(() => useCommitSale(), { wrapper: withApi({ recordSale, loadSellCatalog: async () => testSellCatalog() }) })
  await act(() => result.current.pay({ method: 'PROMPTPAY' }, 7_000))
  expect(result.current.priceChanged).toEqual({ shownSatang: 7_000, nowSatang: 7_500 })
  expect(recordSale).toHaveBeenCalledTimes(1)
  await act(() => result.current.confirmPriceChange())
  expect(recordSale).toHaveBeenLastCalledWith(expect.objectContaining({ expectedTotalSatang: 7_500 }))
})
```

`apps/pos/src/test-utils/sell-catalog.ts`:

```ts
import rich from '@dayo/contracts/fixtures/pos-test/e1-catalog-rich.json' with { type: 'json' }
import { PosCatalogResponse } from '@dayo/contracts'
import { toPricingCatalog } from '@dayo/domain'
import type { SellCatalogDto } from '../api/types'

/** A SellCatalogDto built the way loadSellCatalog builds it, from the POS test catalog — for screen tests only. */
export function testSellCatalog(): SellCatalogDto {
  const d = PosCatalogResponse.parse(rich).data
  if (!d.changed) throw new Error('rich catalog must be changed:true')
  const catalog = toPricingCatalog(d.catalog)
  const codes = [...new Set(catalog.variants.map((v) => v.menuCode))]
  return {
    catalogVersion: d.catalog_version, catalog, categories: ['ชา', 'มัตฉะ', 'โกโก้', 'นม'], channels: catalog.channels.map((c) => ({ code: c.code, name: c.name })),
    defaultChannelCode: 'store', payments: { cash: true, qr: true }, maxQtyPerLine: 99, bestSellerCodes: [],
    sizes: catalog.sizes.filter((z) => z.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map((z) => ({ code: z.code, label: z.label })),
    menus: codes.map((code, i) => {
      const vs = catalog.variants.filter((v) => v.menuCode === code)
      // ADR-0054: sizes come from catalog.sizes (active, sortOrder), never a fixed '16 oz'/'20 oz' list
      const sizes = catalog.sizes.filter((z) => z.isActive && vs.some((v) => v.size === z.code)).sort((a, b) => a.sortOrder - b.sortOrder).map((z) => z.code)
      return { code, nameTh: vs[0]!.menuNameTh, categoryLabel: vs[0]!.categoryLabel ?? vs[0]!.family, sortOrder: vs[0]!.menuSortOrder ?? i, isMatcha: vs[0]!.isMatcha, sizes,
        sweetnessBySize: Object.fromEntries(sizes.map((z) => [z, vs.filter((v) => v.size === z).map((v) => v.sweetness)])),
        defaultSize: sizes.includes(catalog.settings.defaultSize) ? catalog.settings.defaultSize : sizes[0]!, defaultSweetness: vs.some((v) => v.sweetness === '100%') ? '100%' : vs[0]!.sweetness }
    }),
  }
}
```

- [ ] **Step 2 (18a): รันให้ล้ม** — `pnpm --filter @dayo/pos test -- cart use-commit-sale` · FAIL
- [ ] **Step 3 (18a): เขียนโค้ด** — `state/cart.ts`, `use-priced-cart.ts`, `use-commit-sale.ts` (สถานะ `priceChanged` + `confirmPriceChange()`), `test-utils/sell-catalog.ts`
- [ ] **Step 4 (18a): รันให้ผ่าน** — `pnpm --filter @dayo/pos test -- cart use-commit-sale` → PASS · `pnpm --filter @dayo/pos typecheck` → ผ่าน (หน้าจอเดิมยัง compile ได้ถ้ายังใช้ API เดิม — ถ้าไม่ได้ ให้คงชนิดเดิมไว้ชั่วคราวใน `cart.ts` แล้วลบใน 18b)
- [ ] **Step 5 (18a): Commit**

```bash
git add apps/pos/src/state/cart.ts apps/pos/src/state/cart.test.ts apps/pos/src/app/cart-context.tsx apps/pos/src/app/cart-context.test.tsx apps/pos/src/app/use-commit-sale.ts apps/pos/src/app/use-commit-sale.test.tsx apps/pos/src/app/use-priced-cart.ts apps/pos/src/test-utils/sell-catalog.ts
git commit -m "feat(pos): keep the cart as a dayo draft and price it with dayo's code"
```

- [ ] **Step 6 (18b): รันให้ล้ม** — `pnpm --filter @dayo/pos test -- SellScreen ItemDialog CartPanel` · FAIL
- [ ] **Step 7 (18b): เขียนหน้าจอ** ตามพฤติกรรม · ใช้ `usePricedCart` ทุกจุดที่แสดงเงินของตะกร้า (CartPanel, CashPayScreen, QrPayScreen) · `SellScreen` เลิกเรียก `loadMenu`
- [ ] **Step 8 (18b): รันให้ผ่าน** — `pnpm --filter @dayo/pos test` → PASS · typecheck ผ่าน · `grep -rn "loadMenu\|computeTotals" apps/pos/src/screens apps/pos/src/state apps/pos/src/app` → ไม่มีผล
- [ ] **Step 9 (18b): Commit**

```bash
git add apps/pos/src/screens/SellScreen.tsx apps/pos/src/screens/SellScreen.test.tsx apps/pos/src/screens/ItemDialog.tsx apps/pos/src/screens/ItemDialog.test.tsx apps/pos/src/screens/CartPanel.tsx apps/pos/src/screens/CartPanel.test.tsx apps/pos/src/screens/DiscountDialog.tsx apps/pos/src/screens/CashPayScreen.tsx apps/pos/src/screens/QrPayScreen.tsx apps/pos/src/screens/PromoPanel.tsx apps/pos/src/ui/th.ts
git commit -m "feat(pos): sell with dayo's menu, options, promotions and channel prices"
```

---

### Task 19: ใบเสร็จ · ประวัติบิล · รายละเอียดบิล · บิลบอท/เว็บวันนี้ · ยอดไม่ตรงระบบกลาง

ผู้ทำ: pos-ui-developer (sonnet) · สเปก §4.3 (ส่วนต่างทุกขนาด), §4.6, §4.7, §4.8, §6.4 (ป้าย "ยังไม่ถึงระบบกลาง"), §9 ก้อน 2 (ใบเสร็จ + คิว) · D61 · รอ Task 15 (+ Task 18)

**ปรับตาม dayo — แสดง `dayo_edit` แบบอ่านอย่างเดียว (สเปก §4.6, §4.7 · §13.6 S17, S20 · O1 รอเจ้าของเฉพาะเรื่องเงิน)**:
- `OrderDetailScreen`: เมื่อ `dayoEdit` ไม่ null แสดงป้าย `order-dayo-edit` — `kind:'edit'` = "เจ้าของแก้บิลนี้บนเว็บ · <เวลาไทย> · <ชื่อ> · เหตุผล: <reason>" · `kind:'cancel'` = "เจ้าของยกเลิกบิลนี้บนเว็บ · <เวลาไทย> · <ชื่อ> · เหตุผล: <reason>" · ชื่อ/เหตุผลเป็น null = ไม่แสดงส่วนนั้น · ค่า `kind` อื่น = "ระบบกลางเปลี่ยนบิลนี้" · ใต้ป้ายเขียน "ยอดในเครื่องคือเงินที่เก็บจริง" (ไม่แสดงยอดใหม่ของ dayo — รอ O1)
- **ซ่อนปุ่มยกเลิก** (`order-void`) เมื่อ `dayoEdit.kind === 'cancel'` (DTO ตั้ง `voidable=false` แล้ว — หน้าจอเช็กซ้ำ)
- `OrdersScreen`: ชิปเล็ก `order-dayo-edit-chip` "แก้บนเว็บ"/"ยกเลิกบนเว็บ" · ใบเสร็จ (`DoneScreen`) ไม่เปลี่ยน
- หน้าประวัติบิลและ `/central-orders` เรียก `refreshDayoEdits` (Task 15) ตอนเปิดหน้า และทุก 5 นาทีระหว่างเปิด · ออฟไลน์ = แสดงค่าที่เก็บไว้ล่าสุด ไม่ขึ้น error
- ไม่มีปุ่มแก้บิลบนแท็บเล็ต (ADR-0050: API แก้บิลไม่ได้) · เพิ่มเทสต์ 3 ข้อ: ป้าย edit พร้อมเหตุผล · ป้าย cancel + ไม่มี `order-void` · ป้ายที่ชื่อ/เหตุผลเป็น null

**Files:**
- Modify: `apps/pos/src/screens/{DoneScreen,OrdersScreen,OrderDetailScreen,VoidDialog}.tsx` (+ tests), `apps/pos/src/router.tsx`, `apps/pos/src/ui/th.ts`
- Create: `apps/pos/src/screens/CentralOrdersScreen.tsx`, `apps/pos/src/screens/PriceDiffScreen.tsx`, `apps/pos/src/screens/CentralStateChip.tsx` (+ tests)

**Interfaces:**
- Consumes: `getOrder`/`listOrders` (DTO ใหม่ของ Task 12: `soldByName`, `central`, `milk`, `grade`, `promotions`) · `cancelSale` (Task 12) · `listCentralOrdersToday`, `listPriceDiffs` (Task 15) · `can()` (Task 16)
- Produces: route `/central-orders`, `/price-diffs` · `<CentralStateChip central={CentralStateDto} />` (`central-state`)

พฤติกรรม:
- `DoneScreen`: เลขใบเสร็จ `done-receipt` ("A-000312") และเลขคิวตัวใหญ่ `done-queue` ("คิว 12") · "ขายโดย <ชื่อ> · แท็บเล็ต" (`done-sold-by`) — D61
- `CentralStateChip`: `pending` = "ยังไม่ถึงระบบกลาง" (เทา) · `sent` = "ระบบกลาง L260925-014" (เขียว) · `problem` = "ส่งไม่ผ่าน: <เหตุผล>" (แดง) · `excluded` = "นอกระบบกลาง" (ส้ม) · `legacy` = "บิลก่อนเชื่อมระบบกลาง" (เทา) · และเมื่อ `voidState = 'local_only'` เพิ่มชิป `central-void-local` "ยกเลิกในเครื่องเท่านั้น — ระบบกลางยังนับเป็นยอดขาย" (ส้ม — review item 23)
- `OrdersScreen`: แต่ละแถวมี "แท็บเล็ต · <soldByName>" + ชิป · ลิงก์ไป `/central-orders` (`nav-central-orders`)
- `OrderDetailScreen`: บรรทัดแสดงนม/เกรดเมื่อไม่ใช่ค่าปกติ ("นมโอ๊ต", "เกรด Premium") · รายการโปรที่ใช้ · ข้อมูลระบบกลาง: เลข `L…`, ยอดที่ระบบกลางคิด และส่วนต่าง (`order-diff` — แสดงแม้ 1 สตางค์ เช่น "ระบบกลางคิด ฿155.01 (ต่าง +฿0.01)") · ป้าย `order-dup` "อาจซ้ำกับบิลบอท L260925-013" เมื่อ `duplicateOf` ไม่ว่าง (ไม่เด้งกลางการขาย — spec §4.8) · ปุ่มยกเลิกบิลแสดงเมื่อ `voidable` และ (`can(role,'void_any')` (owner เท่านั้น) หรือ บิลของตัวเอง (`soldById` = ผู้ล็อกอิน) และ `can(role,'void_own')`)
- `VoidDialog`: เรียก `cancelSale` (คงคำถาม "ทำเครื่องดื่มไปแล้วหรือยัง" — ruling R6) · error `VOID_NOT_ALLOWED` ที่ขึ้นต้น `SAME_DAY_ONLY`/`OWN_BILLS_ONLY` แสดงข้อความไทยเฉพาะ
- `CentralOrdersScreen` (`/central-orders`): `useQuery({ queryFn: api.listCentralOrdersToday, refetchInterval: 300_000 })` ทำงานเฉพาะตอนหน้าเปิด (spec §4.6) · แถว `central-order-<order_no>`: "บอท · DCm · 10:10 · ฿155.00" + ป้าย "อาจซ้ำ" เมื่อ `duplicateSuspect` · `OFFLINE` = "ต้องออนไลน์เพื่อดูบิลจากบอท/เว็บ" · ปุ่มรีเฟรช
- `PriceDiffScreen` (`/price-diffs`, owner — `can(role,'price_diffs')` · เรียก `listPriceDiffs(user.id)`): รายการ `price-diff-<receiptNo>`: เวลา · ยอดแท็บเล็ต · ยอดระบบกลาง · ส่วนต่าง (สตางค์ละเอียด) · ฉบับแคตตาล็อก · ป้าย `amount_mismatch` เมื่อเกิน ฿1 · แถว `kind = 'void_local_only'` แสดง "ยกเลิกในเครื่องเท่านั้น — ระบบกลางยังนับเป็นยอดขาย (ก้อน 3 จะจัดการเงิน)" 

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — ตัวอย่างหลัก (`OrderDetailScreen.test.tsx`):

```tsx
it('shows the dayo order number, a 1-satang difference and the duplicate label (spec §4.3, §4.8)', async () => {
  const api = fakeOrderApi({ central: { state: 'sent', orderNo: 'L260925-014', computedTotalSatang: 15_501, diffSatang: 1, duplicateOf: ['L260925-013'], reason: null }, totalSatang: 15_500 })
  renderDetail(api)
  expect(await screen.findByTestId('central-state')).toHaveTextContent('L260925-014')
  expect(screen.getByTestId('order-diff')).toHaveTextContent('+฿0.01')
  expect(screen.getByTestId('order-dup')).toHaveTextContent('อาจซ้ำกับบิลบอท L260925-013')
})
it('a staff member sees the cancel button only on their own bill (Q44)', async () => {
  renderDetail(fakeOrderApi({ soldById: 'someone-else', voidable: true }), { id: 'mint', role: 'staff' })
  await screen.findByTestId('central-state')
  expect(screen.queryByTestId('order-void')).toBeNull()
})
```

```tsx
// DoneScreen.test.tsx
it('shows the receipt number, the queue number big, and who sold it (D61, §9 ก้อน 2)', async () => {
  renderDone(fakeOrderApi({ receiptNo: 'A-000312', queueNo: 12, soldByName: 'DCm' }))
  expect(await screen.findByTestId('done-receipt')).toHaveTextContent('A-000312')
  expect(screen.getByTestId('done-queue')).toHaveTextContent('คิว 12')
  expect(screen.getByTestId('done-sold-by')).toHaveTextContent('ขายโดย DCm · แท็บเล็ต')
})
// CentralOrdersScreen.test.tsx
it('lists bot and web bills with the duplicate badge, and says so when offline', async () => {
  const rows = [{ orderNo: 'L260925-013', source: 'line', sourceLabel: 'บอท', createdByName: 'DCm', soldAt: '2026-09-25T03:10:00+00:00', totalSatang: 15_500, payment: 'cash', status: 'ok', duplicateSuspect: true }]
  renderCentral({ listCentralOrdersToday: vi.fn(async () => rows) })
  expect(await screen.findByTestId('central-order-L260925-013')).toHaveTextContent('บอท · DCm · 10:10 · ฿155.00')
  expect(screen.getByTestId('central-order-L260925-013')).toHaveTextContent('อาจซ้ำ')
  renderCentral({ listCentralOrdersToday: vi.fn(async () => { throw new Error('OFFLINE: network') }) })
  expect(await screen.findByText('ต้องออนไลน์เพื่อดูบิลจากบอท/เว็บ')).toBeInTheDocument()
})
// PriceDiffScreen.test.tsx
it('shows a difference to the satang and a void-only-on-the-tablet row', async () => {
  const api = { listPriceDiffs: vi.fn(async () => [
    { kind: 'amount', orderId: 'o1', receiptNo: 'A-000001', soldAt: '2026-09-25T03:00:00.000Z', totalSatang: 4_550, computedTotalSatang: 4_500, diffSatang: -50, catalogVersion: 42, amountMismatch: false },
    { kind: 'void_local_only', orderId: 'o2', receiptNo: 'A-000002', soldAt: '2026-09-25T03:05:00.000Z', totalSatang: 4_500, computedTotalSatang: 4_500, diffSatang: 0, catalogVersion: 42, amountMismatch: false },
  ]) }
  renderDiffs(api, { id: 'owner-1', role: 'owner' })
  expect(await screen.findByTestId('price-diff-A-000001')).toHaveTextContent('-฿0.50')
  expect(screen.getByTestId('price-diff-A-000002')).toHaveTextContent('ยกเลิกในเครื่องเท่านั้น')
  expect(api.listPriceDiffs).toHaveBeenCalledWith('owner-1')
})
```

(`renderDone`/`renderDetail`/`renderCentral`/`renderDiffs` = `renderWithApi` ของ Task 17 ที่ตั้ง route และผู้ล็อกอินให้ · `fakeOrderApi(over)` คืน API ที่ `getOrder` ตอบ `OrderDetailDto` ตัวอย่าง + `over`)

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos test -- DoneScreen OrderDetailScreen CentralOrdersScreen PriceDiffScreen VoidDialog` · คาดว่า FAIL (ยังไม่มีหน้า/testid ใหม่)
- [ ] **Step 3: เขียนหน้าจอ** ตามพฤติกรรมข้างบน · route `/central-orders`, `/price-diffs` ใน `router.tsx` (ห่อ `RequireSession`)
- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test` → PASS ทั้งแพ็กเกจ · `pnpm --filter @dayo/pos typecheck` → ผ่าน
- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/screens/DoneScreen.tsx apps/pos/src/screens/DoneScreen.test.tsx apps/pos/src/screens/OrdersScreen.tsx apps/pos/src/screens/OrderDetailScreen.tsx apps/pos/src/screens/OrderDetailScreen.test.tsx apps/pos/src/screens/VoidDialog.tsx apps/pos/src/screens/VoidDialog.test.tsx apps/pos/src/screens/CentralOrdersScreen.tsx apps/pos/src/screens/CentralOrdersScreen.test.tsx apps/pos/src/screens/PriceDiffScreen.tsx apps/pos/src/screens/PriceDiffScreen.test.tsx apps/pos/src/screens/CentralStateChip.tsx apps/pos/src/router.tsx apps/pos/src/ui/th.ts
git commit -m "feat(pos): show where every bill was recorded, by whom, and how dayo saw it"
```

---

### Task 20: แถบเตือน · หน้าสถานะระบบ · หน้า "ส่งไม่ผ่าน" ของ owner

ผู้ทำ: pos-ui-developer (sonnet) · ผู้ตรวจเพิ่ม: **security-reviewer** · สเปก §4.4 ข้อ 9, §6.3, §6.4, §6.7, §10.5 · D80 · ruling R8 · รอ Task 15 (+ Task 17)

**ปรับตาม dayo (สเปก §4.4 ข้อ 9 · §4.5 · §13.6 S5, S10)**: หน้า `/status` บรรทัดตัวคิดราคาแสดง `pricingCommit` ของ E1 — null = "ไม่ทราบ (ระบบกลางไม่ได้ระบุรุ่น)" **ไม่ขึ้นแถบเตือน** (แถบ `banner-pricing` ขึ้นจาก `files_sha256` ต่างเท่านั้น) · `banner-key-forbidden` คือกรณี dayo ตอบ 403 ทั้งคำขอเมื่อกุญแจไม่มี `orders:write` (ไม่มีการ์ด `FORBIDDEN` รายแถวจากกรณีนี้) · หน้า "ส่งไม่ผ่าน" แสดง `INVALID` ของ `order_void` เก่ากว่า 60 วันตามปกติ · `remedy-remap-code` เลือกขนาดจาก `catalog.sizes` ที่ active (ไม่ตายตัว) · เพิ่มเทสต์: `pricingCommit: null` แสดง "ไม่ทราบ" และไม่มี `banner-pricing`

**Files:**
- Create: `apps/pos/src/screens/StatusBanners.tsx`, `apps/pos/src/screens/SystemStatusScreen.tsx`, `apps/pos/src/screens/SyncProblemsScreen.tsx`, `apps/pos/src/screens/OwnerApprovalDialog.tsx` (+ tests)
- Modify: `apps/pos/src/router.tsx` (root layout แสดง `StatusBanners` ใต้ `BrandBar` · route `/status`, `/sync-problems`), `apps/pos/src/app/queries.ts` (`useBootstrap` refetch ทุก 30 วิ), `apps/pos/src/ui/th.ts`

**Interfaces:**
- Consumes: `bootstrap().sync: SyncStatusDto`, `syncNow`, `replaceApiKey` (Task 11/14) · `listSyncProblems`, `retrySyncRow`, `renumberReceipt`, `remapCode`, `remapStaff`, `excludeFromSync`, `exportSyncRow` (Task 15) · `ConnectFields` (Task 17) · `saveFile` (`apps/pos/src/ui/save-file.ts` เดิม) · `can()`

แถบเตือน (`StatusBanners` — แสดงบนทุกหน้าหลังล็อกอิน · ลำดับความสำคัญจากบนลงล่าง):

| เงื่อนไข | testid | ข้อความ | สี |
|---|---|---|---|
| `apiState = 'unauthorized'` | `banner-key-revoked` | "กุญแจเครื่องถูกยกเลิก — ให้เจ้าของตั้งค่าใหม่" (owner: ลิงก์ไป `/status`) | แดง |
| `apiState = 'forbidden'` | `banner-key-forbidden` | "กุญแจเครื่องไม่มีสิทธิ์ส่งข้อมูล" | แดง |
| `apiState = 'disabled'` | `banner-api-off` | "ระบบกลางปิด API อยู่ — บิลเก็บในเครื่อง จะส่งเมื่อเปิด" | ส้ม |
| `clockWarning` | `banner-clock` | "นาฬิกาเครื่องต่างจากระบบกลาง <N> นาที — ตั้งเวลาเครื่องให้ตรง (ขายต่อได้)" | เหลือง (D80 — ไม่บล็อก) |
| `pricingMismatch` | `banner-pricing` | "ตัวคิดราคาในเครื่องไม่ตรงกับระบบกลาง — ขายได้ แจ้งทีม POS" | เหลือง ถาวร (spec §4.4 ข้อ 9) |
| `catalogError !== null` | `banner-catalog` | "แคตตาล็อกจากระบบกลางอ่านไม่ได้ — ใช้ฉบับเดิมอยู่" | เหลือง (R12) |
| `pendingOver24h` | `banner-stale-queue` | "มีบิลค้างส่งเกิน 24 ชม." | เหลือง (§10.5) |
| `clockFarAheadBills > 0` และ owner | `banner-clock-far-ahead` | "เวลาในบิล <N> รายการล้ำระบบกลางเกิน 24 ชม. — ตั้งนาฬิกาแท็บเล็ตให้ตรง แล้วกด 'ส่งตอนนี้'" → `/sync-problems` | แดง (คำตัดสิน N5 · staff/manager ไม่เห็น) |
| `problemBills > 0` และ owner | `banner-problems` | "ส่งไม่ผ่าน <N> บิล" → `/sync-problems` | แดง |
| `pendingBills > 0` | `badge-pending` | "ยังไม่ส่ง <N> รายการ" (D50 Q3-26 เดิม) | ป้าย |

หน้า `/status` (`SystemStatusScreen`, ทุกบทบาทดูได้ · ปุ่มตั้งค่าเฉพาะ owner): บรรทัด: การเชื่อม (`maskedKey` เช่น `dayo_…cdef`, `baseUrl`) · สถานะ API · ความต่างนาฬิกา (`status-clock` — D80 "บรรทัดในหน้าสถานะระบบ") · ฉบับแคตตาล็อกและเวลาที่เช็กล่าสุด · ตัวคิดราคาตรง/ไม่ตรง · ส่งล่าสุด · ค้างส่ง/ส่งไม่ผ่าน/ยอดไม่ตรง (ลิงก์) · ปุ่ม `status-sync-now` → `syncNow()` · owner: ส่วน "ตั้งกุญแจใหม่" (`ConnectFields` + ผู้อนุมัติ + PIN → `replaceApiKey`)

หน้า `/sync-problems` (`SyncProblemsScreen`, owner เท่านั้น — ไม่ใช่ owner = redirect `/sell`): การ์ด `problem-<receiptNo|key>` แสดงชนิด · เลขใบเสร็จ/เวลา · เหตุผล + `detail` · แถวลูก `PARENT_REJECTED` ย่อหน้าใต้แถวแม่ · ปุ่มตาม `remedies`: `remedy-retry` "ลองใหม่" · `remedy-renumber` "ออกเลขใบเสร็จใหม่" · `remedy-remap-code` "เลือกรหัสแทน" (เลือกเมนู/ขนาด/ความหวาน หรือช่องทาง/วิธีชำระจากแคตตาล็อกล่าสุด) · `remedy-remap-staff` "เลือกผู้ขายแทน" · `remedy-exclude` "ปิดเป็นรายการนอกระบบกลาง" (ยืนยันสองชั้น + คำอธิบายว่าบิลยังอยู่ในรายงานเครื่อง แต่ไม่ถึงระบบกลาง) · ทุกปุ่มยกเว้นลองใหม่เปิด `OwnerApprovalDialog` (เลือก owner + PIN + เหตุผลบังคับ) · ปุ่ม `remedy-export` "ส่งออก JSON" (`saveFile('sync-row-<key>.json', text)`) · **ไม่มีปุ่มลบ** (spec §6.4) · การ์ด `CLOCK_AHEAD` (เวลาในแถวล้ำเกิน 24 ชม. — R3 + คำตัดสิน N5) มีป้าย "รอเวลา — ยังส่งอยู่ทุก 1 นาที" + คำแนะนำ "ตั้งนาฬิกาแท็บเล็ตให้ตรง แล้วกด 'ส่งตอนนี้'" · ปุ่มเดียวคือ `remedy-exclude` (ยืนยันสองชั้น + คำเตือน "บิลนี้จะไม่ถึงระบบกลาง — ยอดขายจริงจะหายจากฐานกลางจนก้อน 3") — ระบบไม่ปิดเอง · ข้อมูลทั้งหน้ามาจาก `listSyncProblems(user.id)`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — ตัวอย่างหลัก:

```tsx
// StatusBanners.test.tsx
it.each([
  [{ apiState: 'unauthorized' }, 'banner-key-revoked'],
  [{ clockWarning: true, clockSkewMs: 7 * 60_000 }, 'banner-clock'],
  [{ pricingMismatch: true }, 'banner-pricing'],
  [{ apiState: 'disabled' }, 'banner-api-off'],
])('%o shows %s', async (sync, id) => {
  renderBanners({ ...BASE_SYNC, ...sync }, 'staff')
  expect(await screen.findByTestId(id)).toBeInTheDocument()
})
it('the clock banner never blocks selling (D80)', async () => {
  renderSellWithSync({ ...BASE_SYNC, clockWarning: true, clockSkewMs: 7 * 60_000 })
  expect(await screen.findByTestId('banner-clock')).toHaveTextContent('7 นาที')
  expect(screen.getByTestId('pay-cash')).not.toBeDisabled()
})
// SyncProblemsScreen.test.tsx
it('CONFLICT offers "ออกเลขใบเสร็จใหม่" behind an owner PIN and a reason, and has no delete button', async () => {
  const api = fakeProblemsApi([{ outboxId: 'x1', key: 'order:…', kind: 'order', orderId: 'o1', receiptNo: 'A-000001', at: '2026-09-25T03:00:00.000Z', reason: 'CONFLICT', detail: 'เลขใบเสร็จ A-000001 ถูกใช้กับบิลอื่นของเครื่องนี้แล้ว', remedies: ['RETRY', 'RENUMBER'], children: [] }])
  renderProblems(api, 'owner')
  fireEvent.click(await screen.findByTestId('remedy-renumber'))
  fireEvent.change(screen.getByTestId('approval-pin'), { target: { value: '1111' } })
  fireEvent.change(screen.getByTestId('approval-reason'), { target: { value: 'เลขชน' } })
  fireEvent.click(screen.getByTestId('approval-ok'))
  await waitFor(() => expect(api.renumberReceipt).toHaveBeenCalledWith({ outboxId: 'x1', approverUserId: 'owner-1', approverPin: '1111', reason: 'เลขชน' }))
  expect(screen.queryByText(/ลบ/)).toBeNull()
})
it('a staff member is sent away from /sync-problems', async () => {
  const { router } = renderProblems(fakeProblemsApi([]), 'staff')
  await waitFor(() => expect(router.state.location.pathname).toBe('/sell'))
})
```

```tsx
// SystemStatusScreen.test.tsx
it('shows the clock line, the masked key and sends now on demand (D80, spec §7 ข้อ 1)', async () => {
  const api = { bootstrap: vi.fn(async () => bootWithSync({ ...BASE_SYNC, clockSkewMs: 7 * 60_000, clockWarning: true, maskedKey: 'dayo_…cdef' })), syncNow: vi.fn(async () => ({ catalog: null, push: { requests: 1, sent: 1, rejected: 0, deferred: 0, held: 0, noAnswer: 0, stopped: null } })) }
  renderStatus(api, 'staff')
  expect(await screen.findByTestId('status-clock')).toHaveTextContent('7 นาที')
  expect(screen.getByTestId('status-key')).toHaveTextContent('dayo_…cdef')
  expect(screen.queryByTestId('status-replace-key')).toBeNull() // owner only
  fireEvent.click(screen.getByTestId('status-sync-now'))
  await waitFor(() => expect(api.syncNow).toHaveBeenCalled())
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos test -- StatusBanners SystemStatusScreen SyncProblemsScreen` · คาดว่า FAIL
- [ ] **Step 3: เขียนหน้าจอ** ตามตารางแถบเตือนและพฤติกรรมข้างบน · `SyncProblemsScreen` เรียก `listSyncProblems(user.id)` และ `exportSyncRow({ actorUserId: user.id, outboxId })` (API ตรวจบทบาทเองด้วย — review item 22)
- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test` → PASS ทั้งแพ็กเกจ · `pnpm --filter @dayo/pos typecheck` → ผ่าน
- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/screens/StatusBanners.tsx apps/pos/src/screens/StatusBanners.test.tsx apps/pos/src/screens/SystemStatusScreen.tsx apps/pos/src/screens/SystemStatusScreen.test.tsx apps/pos/src/screens/SyncProblemsScreen.tsx apps/pos/src/screens/SyncProblemsScreen.test.tsx apps/pos/src/screens/OwnerApprovalDialog.tsx apps/pos/src/router.tsx apps/pos/src/app/queries.ts apps/pos/src/ui/th.ts
git commit -m "feat(pos): warn about key, clock and pricing problems and let the owner fix rejected rows"
```

---

### Task 21: e2e ก้อน 2 กับ mock server (เกณฑ์เสร็จ §9 ก้อน 2 ส่วน mock)

ผู้ทำ: pos-ui-developer (sonnet) · สเปก §9 ก้อน 2 · รอ Task 7, 20, **A3**

**ปรับตาม dayo (สเปก §4.4 ข้อ 12 · §4.6 · §9 ก้อน 2)**: mock server ของ A3 (มี `sizes` · `dayo_edit` · 403 ทั้งคำขอ · `sale_date` พรุ่งนี้ = `CLOCK_AHEAD`) · `mock()` เพิ่ม path `'edit-pos-order'` (ควบคุม `dayo_edit`) · เพิ่ม spec `block2-dayo-edit` และขยาย `block2-sell-options` ตามตาราง (spec รวม 9 ไฟล์)

**Files:**
- Modify: `apps/pos/playwright.config.ts` (webServer สองตัว), `apps/pos/e2e/helpers.ts` (เขียนใหม่), e2e เดิมที่ยังรัน (`first-run`, `sell-cash`, `sell-qr-void`, `offline`, `close-shift`, `shift-x`) ให้ใช้ตัวช่วยใหม่และ testid ใหม่ของหน้าขาย, `apps/pos/package.json` (devDependency `@dayo/dayo-mock` มีแล้วจาก Task 9)
- Create: `apps/pos/e2e/block2-offline-sync.spec.ts`, `block2-void-before-send.spec.ts`, `block2-rejected-row.spec.ts`, `block2-401.spec.ts`, `block2-conflict-renumber.spec.ts`, `block2-clock-banner.spec.ts`, `block2-central-orders.spec.ts`, `block2-sell-options.spec.ts`

**Interfaces:**
- Consumes: mock server (Task 7) ที่ `http://localhost:8787` + ควบคุมผ่าน `/__mock/*` · ทุกหน้าจอของสาย D
- Produces: `e2e/helpers.ts`:

```ts
export const DAYO_BASE = 'http://localhost:8787/api/v1'
export const MOCK_KEY = `dayo_${'0123456789abcdef'.repeat(4)}`
export const OWNER = { name: 'TungAo', pin: '1111' } as const
export const OTHER = { name: 'DCm', pin: '2222' } as const
export async function mock(request: APIRequestContext, path: 'reset' | 'mode' | 'now' | 'override' | 'bump-catalog' | 'seed-orders' | 'edit-pos-order', body?: unknown): Promise<void>
export async function mockState(request: APIRequestContext): Promise<{ orders: { receiptNo: string; orderNo: string; status: string }[]; requests: { path: string; rows: number }[] }>
export async function setupDevice(page: Page): Promise<void>      // base URL + key → probe → owner TungAo → prefix A → PIN 1111 → PromptPay → save
export async function setOtherPin(page: Page): Promise<void>      // DCm gets PIN 2222 approved by TungAo
export async function login(page: Page, user?: { name: string; pin: string }): Promise<void>
export async function openShift(page: Page, floatBaht?: string): Promise<void>
export async function firstRun(page: Page, request: APIRequestContext): Promise<void> // mock reset + setup + DCm PIN + login + open shift
export async function sellOne(page: Page, code: string, payment: 'cash' | 'qr'): Promise<string>  // returns the receipt number on the done screen
export async function syncNow(page: Page): Promise<void>          // /status → status-sync-now
```

`playwright.config.ts`:

```ts
testIgnore: ['**/hidden-stock/**'],
webServer: [
  { command: 'pnpm --filter @dayo/dayo-mock start -- --port 8787 --origin http://localhost:4173', url: 'http://localhost:8787/__mock/state', reuseExistingServer: !process.env['CI'], timeout: 60_000 },
  { command: 'pnpm build && pnpm exec vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env['CI'], timeout: 240_000 },
],
```

สถานการณ์ (ตรงเกณฑ์ §9 ก้อน 2):

| spec | ทำอะไร | ต้องเห็น |
|---|---|---|
| `block2-offline-sync` | `context.setOffline(true)` → ขาย 5 บิล (ตัวส่งล้มหลายครั้ง backoff สะสม) → `setOffline(false)` | ป้าย "ยังไม่ส่ง 5" ระหว่างออฟไลน์ · หลังออนไลน์ **ภายใน 10 วิ** ป้ายเป็น 0 (event `online` ล้าง backoff ของเน็ตหลุด — review item 2) · `mockState().orders` มี 5 บิลพร้อม `L…` · หน้าประวัติบิลทุกแถวขึ้นชิป "ระบบกลาง L…" |
| `block2-void-before-send` | ออฟไลน์ → ขาย → ยกเลิก (PIN owner) → ออนไลน์ | `mockState().orders[0].status = 'cancelled'` · คำขอ push ที่มีบิลนั้นส่งแถว order ก่อน order_void (ใน `requests` แถวเดียวที่ `rows = 2` หรือสองคำขอเรียงกัน) |
| `block2-rejected-row` | override `UNKNOWN_CODE` 1 ครั้งให้ `A-000001` → ขาย 2 บิล → ส่ง | บิล 2 ถึงระบบกลาง · `banner-problems` "ส่งไม่ผ่าน 1 บิล" · หน้า `/sync-problems` มีการ์ด A-000001 |
| `block2-401` | mode `unauthorized` → ขาย → `syncNow` | `banner-key-revoked` ขึ้น (พิสูจน์ว่าเบราว์เซอร์อ่าน 401 ได้เพราะมีหัว CORS — ไม่ใช่ขึ้นว่าเน็ตหลุด) · `mockState().requests` มีคำขอ `status: 401` · กด `syncNow` อีกครั้ง + เปิดหน้าบิลบอท/เว็บ แล้วจำนวนคำขอ **ทุกชนิด** (catalog/push/orders — mock บันทึกคำขอที่ถูกปฏิเสธด้วย) ไม่เพิ่ม |
| `block2-conflict-renumber` | override `CONFLICT` 1 ครั้งให้ `A-000001` → ขาย → ส่ง → `/sync-problems` → "ออกเลขใบเสร็จใหม่" (PIN 1111 + เหตุผล) → ส่ง | `mockState().orders` มีใบเสร็จ `A-000002` · รายละเอียดบิลแสดงเลขใหม่และชิป "ระบบกลาง L…" |
| `block2-clock-banner` | `/__mock/now` = เวลาจริง + 7 นาที → รีโหลด → ขาย | `banner-clock` ขึ้น · ขายสำเร็จ (ไม่บล็อก — D80) |
| `block2-central-orders` | seed บิลบอท `total 45` เวลา = ตอนนี้ − 2 นาที → ขาย Cocoa 16 oz ด้วยเงินสด → ส่ง → เปิดรายละเอียดบิล → เปิด `/central-orders` | รายละเอียดบิล: `order-dup` "อาจซ้ำกับบิลบอท L…" · หน้าบิลบอท/เว็บ: แถว "บอท · …" |
| `block2-sell-options` | ขาย Thai Tea นมโอ๊ต 1 + Matcha Latte Premium 1 · Thai Tea ×3 (โปร 2 แถม 1) · ช่องทาง Grab · **bump แคตตาล็อกเปิด `22 oz` (+ ตัวแปร) → รีโหลด → ขาย 22 oz** | ยอดบนจอตรงกับ `priceCart` (70.00 สำหรับ ×3 · 59.00 สำหรับ Thai Tea 20 oz บน Grab) · ใบเสร็จแสดงเลขใบเสร็จ + คิว · **ปุ่มขนาดขึ้น 3 ปุ่มเรียงตาม `sortOrder` และบิล 22 oz ถึงระบบกลาง** (ADR-0054) |
| `block2-dayo-edit` | ขาย → ส่ง → `mock('edit-pos-order', {kind:'cancel', reason:'ลูกค้ายกเลิก'})` → เปิดรายละเอียดบิล | ป้าย `order-dayo-edit` "เจ้าของยกเลิกบิลนี้บนเว็บ … เหตุผล: ลูกค้ายกเลิก" · ไม่มี `order-void` · ยอดบิลในเครื่องเท่าเดิม (O1 รอเจ้าของ — ก้อน 2 อ่านอย่างเดียว) |

- [ ] **Step 1: เขียน helpers + spec ทั้ง 9** (ตามตาราง · commit ใน Step 4 เพิ่ม `apps/pos/e2e/block2-dayo-edit.spec.ts` · ใช้ `expect.poll` รอ mock แทน `waitForTimeout`)
- [ ] **Step 2: รัน** — `pnpm --filter @dayo/pos e2e` · ที่ยังไม่ผ่าน = บั๊กของหน้าจอ/ตัวส่ง → แก้ใน task เดิมของสายนั้น (หัวหน้าส่งกลับ) ไม่ใช่ปิดเทสต์
- [ ] **Step 3: รันให้ผ่านทั้งหมด** — `pnpm --filter @dayo/pos e2e` → PASS ทุก spec (ไม่นับ `hidden-stock`) · `pnpm turbo run typecheck test` → ผ่าน
- [ ] **Step 4: Commit**

```bash
git add apps/pos/playwright.config.ts apps/pos/e2e/helpers.ts apps/pos/e2e/first-run.spec.ts apps/pos/e2e/sell-cash.spec.ts apps/pos/e2e/sell-qr-void.spec.ts apps/pos/e2e/offline.spec.ts apps/pos/e2e/close-shift.spec.ts apps/pos/e2e/shift-x.spec.ts apps/pos/e2e/block2-offline-sync.spec.ts apps/pos/e2e/block2-void-before-send.spec.ts apps/pos/e2e/block2-rejected-row.spec.ts apps/pos/e2e/block2-401.spec.ts apps/pos/e2e/block2-conflict-renumber.spec.ts apps/pos/e2e/block2-clock-banner.spec.ts apps/pos/e2e/block2-central-orders.spec.ts apps/pos/e2e/block2-sell-options.spec.ts
git commit -m "test(pos): cover offline selling, pushing and owner fixes end to end against the dayo mock"
```

---

## 6. ท้ายก้อน

### Task 22: ลบของเก่าที่ก้อน 2 แทนแล้ว

ผู้ทำ: sync-engineer (sonnet) · สเปก §11 · รอ Task 21 · ทำบน `block-2-pos` หลังทุกสาย merge

**ปรับตาม dayo (ADR-0054)**: Step 2 ตรวจเพิ่ม `grep -rnE "'16 oz' \| '20 oz'|z\.enum\(\['16 oz'|rowSize" apps packages --include=*.ts --include=*.tsx` → ไม่มีชนิด/ตัวกันที่บีบขนาดเป็นสองค่าเหลือในโค้ดขายและสัญญา (โค้ดสต็อกที่ซ่อนและเทสต์ยกเว้น)

**Files:**
- Delete: `packages/domain/src/pricing.ts`, `packages/domain/src/sale.ts`, `packages/domain/test/pricing.test.ts`, `packages/domain/test/sale.test.ts` · `apps/pos/src/api/menu.ts`, `apps/pos/test/menu.test.ts`, `apps/pos/test/sale.test.ts`, `apps/pos/test/void.test.ts`
- Modify: `packages/domain/src/index.ts` (ลบ export สองไฟล์) · `apps/pos/src/api/sale.ts` (ลบ `commitSale` + ตัวช่วยที่ใช้เฉพาะมัน) · `apps/pos/src/api/void.ts` (ลบ `voidOrder`) · `apps/pos/src/api/setup.ts` (ลบ `setupShop` — คง `getSetting`, `PROMPTPAY_SETTING_KEY`) · `apps/pos/src/db/stock.ts` (ลบ `loadSaleContext`) · `apps/pos/src/api/types.ts`, `pos-api.ts` (ลบ `CommitSaleInput`, `MenuDto` และชนิดย่อย, `SetupInput`, `VoidOrderInput`, เมธอด `setupShop`/`loadMenu`/`commitSale`/`voidOrder` และชื่อใน `POS_API_METHODS`) · `apps/pos/test/helpers/db.ts` (ลบ `sellSku`, `shownTotalSatang`, `TEST_SETUP`) · `apps/pos/test/setup-auth.test.ts` (เหลือเฉพาะเทสต์ล็อกอิน/PIN — ย้ายเทสต์ตั้งเครื่องไปแล้วใน Task 11) · `apps/pos/test/connect.test.ts` (เทสต์เครื่องเดิมใช้การ insert แถว `device`/`user` ตรง ๆ แทน `setupShop`)

- [ ] **Step 1: ลบและแก้ตามรายการ**
- [ ] **Step 2: ตรวจว่าไม่มีผู้ใช้เหลือ** — `grep -rnE "computeTotals|priceFor|planSale|requirePrice|loadSaleContext|loadMenu|commitSale|voidOrder|setupShop|sellSku|STORE_CHANNEL_CODE" apps packages --include=*.ts --include=*.tsx` → ไม่มีผล (ยกเว้น `STORE_CHANNEL_CODE` ถ้าโค้ดสต็อกที่ซ่อนยังใช้ — ให้ย้ายค่าคงที่ไปไว้ใน `apps/pos/src/api/stock-common.ts`)
- [ ] **Step 3: รันทั้ง repo** — `pnpm turbo run typecheck test` → ผ่าน · `pnpm --filter @dayo/pos e2e` → ผ่าน
- [ ] **Step 4: Commit**

```bash
git rm packages/domain/src/pricing.ts packages/domain/src/sale.ts packages/domain/test/pricing.test.ts packages/domain/test/sale.test.ts apps/pos/src/api/menu.ts apps/pos/test/menu.test.ts apps/pos/test/sale.test.ts apps/pos/test/void.test.ts
git add packages/domain/src/index.ts apps/pos/src/api/sale.ts apps/pos/src/api/void.ts apps/pos/src/api/setup.ts apps/pos/src/db/stock.ts apps/pos/src/api/types.ts apps/pos/src/api/pos-api.ts apps/pos/test/helpers/db.ts apps/pos/test/setup-auth.test.ts apps/pos/test/connect.test.ts
git commit -m "refactor: drop the plan-3 pricing and sale path replaced by dayo's pricing"
```

(เพิ่มชื่อไฟล์อื่นที่ Step 2 ต้องแก้ตาม `git status` — ห้าม `git add -A`/`-u`)

จากนั้น: ตรวจทั้งก้อน (code-reviewer + security-reviewer, opus สำหรับตรวจทั้งสาย) → แก้ 1 รอบ → ตรวจซ้ำเฉพาะจุด → merge `block-2-pos` เข้า `main` แบบ `--no-ff` → push (ได้รับอนุญาตแล้ว — CLAUDE.md ข้อ 10) · **`API_V1_ENABLED` ใน production ยังปิด** — เปิดหลัง Task 23 เท่านั้น

---

### Task 23: เชื่อมจริงกับ dayo local + ปิดเกณฑ์ parity + แท็บเล็ต (เลื่อนตาม D51)

ผู้ทำ: หัวหน้า + sync-engineer (opus) + **เจ้าของ** (ถือกุญแจและรันฝั่ง dayo) · ผู้ตรวจ: code-reviewer + security-reviewer · สเปก §4.11 ข้อ 2–3, §5.2 ชั้น ข–ค, §9 ก้อน 2 (ส่วนเชื่อมจริง) · **รอ: ก้อน 1 ของ dayo merge แล้ว** — ✅ dayo ship ก้อน 1A แล้ว (main `232bf57` · prod/test · API ยังปิด) · agent ไม่อ่าน `.env*`/`.dev.vars` และไม่เห็นกุญแจจริง

**ปรับตาม dayo (มีผลเหนือขั้นข้างล่าง · สเปก §4.11 · §5.2 · §8 · §13.6)**:
- **Step 1 (fixture — O4 แทน D82)**: dayo ไม่มีชุด fixture จึง **ไม่มีอะไรให้คัดลอกมาทับ** · แทนด้วย: เจ้าของเปิด dayo local/`dayo-test` (Step 4) แล้วเก็บ **คำตอบจริง** ของทุกสถานการณ์ใน `CONTRACT_FIXTURE_NAMES` (E1 changed/unchanged · E2 ทุกคำตัดสิน · E3 · 401/404/429 + หัว CORS) ลง `packages/contracts/fixtures/dayo-api/` (ตัดค่าลับ/กุญแจออก) · ต่างจาก fixture ของ A1 = แก้ fixture ให้ตรงของจริงแล้วแก้โค้ด (ห้ามแก้ของจริงให้ตรง fixture) · `fixtures:hashes` บันทึกลงไฟล์ผล · ส่งโฟลเดอร์นี้ให้ dayo (ก้อน 1B)
- **Step 2**: `pricing.commit` อาจเป็น `null` บน local → ใช้ `git rev-parse HEAD` ของ repo dayo ที่รันอยู่ (อ่านอย่างเดียว) · ไฟล์ที่คัดลอกยังเทียบด้วย `files_sha256`
- **Step 3 (parity)**: สคริปต์ของ dayo ยังเป็น **แคตตาล็อกประกอบเอง + `computeOrder`** ไม่ใช่ชั้น ข จริง (สเปก §5.2) · ไฟล์ที่ได้ (รูปตาม R15 — ไม่มี `--expect-commit` และ `catalog_version`) ใช้ปิดเกณฑ์ "ตัวห่อ+การแปลงต่าง 0 สตางค์" ได้ แต่ **เกณฑ์ SQL = แท็บเล็ต** ปิดด้วย Step 6–7 (ขาย 20 บิลกับ dayo local แล้ว `computed_total − total = 0`) เท่านั้น · บันทึกว่าชั้น ข ยังค้างฝั่ง dayo
- **Step 6 เพิ่มบิล**: 21 = ขายขนาดที่ 3 (เจ้าของเปิด `22 oz` + ตัวแปรบน dayo local ก่อน · §5.3 ข้อ 16) · 22 = เจ้าของปิดโปรบนเว็บ **ก่อน** แท็บเล็ตที่ออฟไลน์ขายด้วยโปรนั้น → คาดว่า `computed_total ≠ total` และขึ้นหน้า "ยอดไม่ตรงระบบกลาง" (§5.3 ข้อ 14 — **ไม่นับเป็นบิลที่ต้องต่าง 0**) · บิล 11–12/18 (โปรจำกัดเวลา): ถ้า dayo ยังส่ง `timeFrom` เป็น `HH:MM:SS` บิลที่ขายในนาทีแรกของช่วงจะต่าง (สเปก §4.4 ข้อ 13) → บันทึกเป็นปัญหาของ dayo ไม่ใช่บั๊กแท็บเล็ต
- **Step 7**: "แก้/ยกเลิกไม่ได้บนเว็บ" → **รอเจ้าของ O1** (dayo ship ให้ owner แก้ได้พร้อมเหตุผล) · ตรวจแทนว่า: owner แก้บิล 1 ใบบนเว็บ → แท็บเล็ตแสดงป้าย `order-dayo-edit` พร้อมเหตุผล และยอดในเครื่องไม่เปลี่ยน
- **Step 10 (เปิด production)**: เงื่อนไขตาม ADR-0048 ข้อ 8 ฉบับที่ dayo แก้ = ผ่าน Step 6–7 + ตั้ง `POS_ORIGINS` เป็น origin production ของแท็บเล็ต (`https://` ตรงตัว ไม่ใช่ preview) + สร้างกุญแจ + **เจ้าของกดสำรองภายใน 24 ชม. และซ้อมกู้ลง `dayo-test` สำเร็จ 1 ครั้ง** (แทน "สำรองอัตโนมัติ 3 คืน") — **รอเจ้าของ O2** ยืนยันว่ายอมรับการเลื่อนสำรองอัตโนมัติ ก่อนเปิดจริง

**Files:**
- Replace: `packages/contracts/fixtures/dayo-api/*.json` ด้วยคำตอบจริงของ dayo local/`dayo-test` (O4 — dayo ไม่มีโฟลเดอร์ `pos-contract/`)
- Create (เจ้าของคัดลอก): `packages/dayo-pricing/fixtures/pos-parity.json` จาก `npm run export-pos-parity` ของ dayo
- Modify (ถ้า dayo เปลี่ยนตัวคิดราคา): `packages/dayo-pricing/VENDOR.json`, `packages/dayo-pricing/src/vendor/*.ts` (ผ่าน `vendor:update` เท่านั้น)
- Create: `docs/superpowers/plans/2026-09-25-07-บันทึกเชื่อมจริงก้อน2.md` (บันทึกผล — ตาม memory "docs in project")

- [ ] **Step 1: fixture สัญญาตรงกัน (~~D82~~ — ใช้ย่อหน้า "ปรับตาม dayo" ข้างบนแทน · O4)** — ข้อความเดิม: เจ้าของคัดลอกโฟลเดอร์ (รวม `.gitattributes`) · รัน `pnpm --filter @dayo/contracts fixtures:hashes > pos.txt` และ `pnpm --filter @dayo/contracts fixtures:hashes D:/TungAo-Project/line-bot/dayo-shop-system/apps/web/test/fixtures/pos-contract > dayo.txt` (อ่าน repo dayo อย่างเดียว · sha256 หลัง CRLF → LF) → `diff pos.txt dayo.txt` ว่าง และไม่มี `MISSING` · ไฟล์ `.json` ใน dayo ที่ไม่อยู่ใน `CONTRACT_FIXTURE_NAMES` (`ls` เทียบกับรายชื่อ) = แผนก้อน 1 เปลี่ยน → แก้รายชื่อ แล้วรันซ้ำ · `pnpm --filter @dayo/contracts test` และ `pnpm --filter @dayo/dayo-mock test` ผ่านกับไฟล์จริง (ไม่ผ่าน = สัญญาไม่ตรงกัน → หยุด แจ้งเจ้าของ ห้ามแก้ fixture)
- [ ] **Step 2: ตัวคิดราคาตรง commit ที่จะ deploy** — อ่าน `pricing.commit` จาก E1 ของ dayo dev (หรือ `npm run version:print` ของ dayo) → `pnpm --filter @dayo/dayo-pricing vendor:update D:/TungAo-Project/line-bot/dayo-shop-system <commit>` → `vendor:check` ผ่าน · ถ้า `src/vendor` เปลี่ยน: `pnpm turbo run typecheck test` ต้องผ่านโดยไม่แก้ไฟล์สำเนา (ไม่ผ่าน = หยุด แจ้งหัวหน้า)
- [ ] **Step 3: parity ชั้น ค ด้วยไฟล์จริง** — เจ้าของรันบน commit เดียวกัน `npm run db:reset && npm run export-pos-parity -- --expect-commit <commit>` แล้ววาง `pos-parity.json` ที่ `packages/dayo-pricing/fixtures/` → `pnpm --filter @dayo/domain test -- parity` → หัว describe ต้องขึ้น `dayo export` และ **ทุกเคสต่าง 0 สตางค์** · เคสที่ล้มเพราะไม่มี `saleTime` → ขอทีม dayo เติม (R15) · เคสที่แท็บเล็ตสร้างไม่ได้จริง (เช่น qty เกินเพดาน) → ใส่ใน `TABLET_UNREACHABLE` พร้อมเหตุผลและให้หัวหน้าอนุมัติ · เคสอื่นที่ต่าง = บั๊ก ห้ามแก้เคส
- [ ] **Step 4: เปิด dayo local** (เจ้าของ) — Supabase local + `npm run dev:web` ของ dayo ด้วย `API_V1_ENABLED=1` และ `POS_ORIGINS=http://localhost:4173` เฉพาะเครื่อง dev · เจ้าของสร้างกุญแจ "แท็บเล็ตขาย 1" ที่ `/settings/api-clients` (scope `catalog:read staff:read orders:read orders:write`) · นำเข้าแคตตาล็อกจริงของร้าน
- [ ] **Step 5: ตั้งแท็บเล็ต (เบราว์เซอร์บนเครื่อง dev)** — `pnpm --filter @dayo/pos build && pnpm --filter @dayo/pos exec vite preview --port 4173` · เจ้าของกรอก base URL `http://localhost:<port ของ dev:web>/api/v1` และวางกุญแจเอง (agent ไม่เห็น) · หน้าตั้งเครื่องต้องไม่เตือน "ตัวคิดราคาไม่ตรง" (= `pricing.files_sha256` ของ E1 เท่ากับ `VENDOR.json` — เกณฑ์ §9)
- [ ] **Step 6: ขาย 20 บิลที่ครอบ §5.3** (เจ้าของหรือหัวหน้าขายตามรายการ — ใช้เมนูจริงที่มีคุณสมบัติตรงเคส):

| # | บิล | ครอบเคส |
|---|---|---|
| 1–2 | ส่วนลดรายแก้ว 15% บนเมนู 35 และ 45 บาท | 1 |
| 3 | ส่วนลด 7% บนเมนู 85 · 33% บนเมนู 65 (2 บรรทัด) | 1 |
| 4 | ช่องทางที่บวก % + ปัดขึ้น + บวกบาท | 2, 3 |
| 5 | ช่องทางที่มีค่าธรรมเนียม % | 3 |
| 6 | ส่วนลดทั้งบิล % หลังส่วนลดรายแก้ว | 4 |
| 7 | โค้ดโปรทั้งบิลที่ชนเพดาน `max_amount` | 4, 8 |
| 8 | โปร bundle | 5 |
| 9 | ซื้อ N แถม M จำนวน 4 แก้ว | 5 |
| 10 | นมโอ๊ต + เกรดผง | 6 |
| 11 | โปรจำกัดเวลา ในช่วง | 7 |
| 12 | โปรจำกัดเวลา นอกช่วง | 7 |
| 13 | กด "ไม่ใช้" โปรหนึ่งตัว | 8 |
| 14 | "ไม่ใช้โปรทั้งบิล" | 8 |
| 15 | จำนวนสูงสุดต่อบรรทัด (`maxQtyPerLine`) | 9 |
| 16 | ร้านตั้งนมเริ่มต้นเป็นโอ๊ต (เจ้าของเปลี่ยนค่าตั้งบนเว็บก่อน · แท็บเล็ตดึงฉบับใหม่) | 11 |
| 17 | โปรเฉพาะบางช่องทาง | 12 |
| 18 | ขายตอน xx:xx:59 ตรงขอบ `timeTo` | 13 |
| 19 | ขายออฟไลน์ แล้วเจ้าของปิดใช้เมนูนั้นบนเว็บก่อนต่อเน็ต | 14 |
| 20 | ขายแล้วยกเลิกในวันเดียวกัน (มี `order_void`) | — |

- [ ] **Step 7: ตรวจผล** — หน้า "ยอดไม่ตรงระบบกลาง" ของแท็บเล็ต **ว่าง** (= `computed_total − total = 0` สตางค์ทุกบิล) · เจ้าของรันใน SQL editor ของ Supabase local: `select external_ref, total_amount, pos_computed_total from orders where source = 'pos' and pos_computed_total <> total_amount;` → 0 แถว · ทุกบิลบนเว็บ dayo แสดง "แท็บเล็ต · <ผู้ขาย> · ใบเสร็จ A-… · คิว …" และแก้/ยกเลิกไม่ได้บนเว็บ · บิลที่ 20 เป็นยกเลิกในฐานกลาง · หน้าสถานะแท็บเล็ต: ไม่มีของค้าง ไม่มี "ส่งไม่ผ่าน"
- [ ] **Step 8: 401 ในเบราว์เซอร์จริง** — เจ้าของเพิกถอนกุญแจบนเว็บ → ขาย 1 บิล → แท็บเล็ตขึ้น "กุญแจเครื่องถูกยกเลิก" (ไม่ใช่เน็ตหลุด) · ตั้งกุญแจใหม่ที่หน้าสถานะ (owner PIN) → บิลค้างถูกส่ง
- [ ] **Step 9: บันทึกผล** ลง `docs/superpowers/plans/2026-09-25-07-บันทึกเชื่อมจริงก้อน2.md` (commit ของ dayo · ผล `fixtures:hashes` ทั้งสองฝั่ง · จำนวนเคส parity ที่ผ่าน · ผล 20 บิล · ปัญหาที่พบ) · commit ไฟล์ fixture/parity/vendor ที่เปลี่ยน + บันทึก (ผ่าน `committing-code`)
- [ ] **Step 10: ส่งต่อ** — หัวหน้าสรุปให้เจ้าของ → **เจ้าของเป็นผู้เปิด `API_V1_ENABLED=1` ใน production** (ไม่ใช่ agent) · deploy POS (Pages) ตามขั้นตอน devops เดิม
- [ ] **Step 11: แท็บเล็ตจริง — เลื่อนตาม D51** — ไม่รันในแผนนี้ · docs-writer เพิ่มรายการของก้อน 2 เข้ารายการทดสอบท้ายสุดของ D51: ตั้งเครื่องด้วยการสแกน QR ของกุญแจ (`BarcodeDetector` บน Chrome Android) · `navigator.storage.persist()` ได้ "ถาวร" · ขายออฟไลน์จริง (ปิด Wi-Fi) 5 บิลแล้วเปิด → ส่งครบ · Web Lock `dayo-push` เมื่อเปิดสองแท็บ · แถบนาฬิกาเมื่อตั้งเวลาเครื่องเร็ว 7 นาที · ใบเสร็จ/คิวอ่านชัดบนจอแท็บเล็ต · ไฟล์สำรองของ POS ไม่มีกุญแจ (ค้นคำว่า `dayo_` ในไฟล์ที่ส่งออก)

---

## 7. ความสอดคล้องกับแผนก้อน 1 (`2026-09-25-06-block1-dayo-api.md`)

**26 ก.ย. 2569: แผนก้อน 1 ถูกแทนด้วยงานที่ dayo ship เอง** (ก้อน 1A · main `232bf57`) · คอลัมน์ "แผนก้อน 1" ข้างล่างอ่านเป็น "ที่ dayo ship จริง" ตามแถวที่แก้ · ที่มา file:line อยู่ในสเปก 04 §13.6

| เรื่อง | แผนก้อน 1 | แผนนี้ |
|---|---|---|
| endpoint | `GET /api/v1/pos/catalog?known_version=` · `POST /api/v1/pos/push` · `GET /api/v1/orders?from=&to=` | `createDayoClient` (Task 9) เรียกสามเส้นทางนี้ตรงตัว |
| fixture สัญญา | ~~ต้นฉบับ dayo `apps/web/test/fixtures/pos-contract/` (D82)~~ **dayo ไม่มีชุด fixture** → **POS เป็นเจ้าของชั่วคราว (O4)** | ต้นฉบับ `packages/contracts/fixtures/dayo-api/` (Task 6 → A1 ตาม SQL ของ dayo → Task 23 แทนด้วยคำตอบจริง) · schema `PosContractFixture` · mock เล่นซ้ำทุกไฟล์ (Task 7, A3) · ส่งให้ dayo ในก้อน 1B |
| ลำดับตรวจแถว E2 | **ที่ ship: `0052_pos_push.sql:560-620`** (สเปก §4.5 ข้อ 6) · key ไม่มี `orders:write` = 403 ทั้งคำขอ (`:725-726`) | `judgeRow` ของ mock ตามโค้ดจริง (A3) · 403 ทั้งคำขอ (A3) |
| ข้อความ `detail`/`message` | ใน fixture | mock ใช้ข้อความเดียวกันตรงตัว · แท็บเล็ตแสดง `detail` ตามที่ได้รับ ไม่ตีความข้อความ |
| sha256 ตัวคิดราคา | หลัง CRLF → LF | `fileSha256` ใน `vendor-lib.ts` (Task 2) |
| `pos-parity.json` | **ที่ ship**: `{dayo_commit, generated_at, pricing_files_sha256, catalog, cases:[{spec, note, draft: OrderDraft, expected: QuoteResult}]}` — ไม่มี `catalog_version`/`id` · ยังไม่ใช่ชั้น ข จริง (`scripts/export-pos-parity.ts:5-11`) · ไฟล์แรก `docs/design/pos-parity.json` | `ParityFile` (A1) · ตัวอ่านชั้น ค (A2 ส่วนต่อของ T4) · R15 |
| `supported_fields` | รายการตามสเปก §4.4 | แท็บเล็ตเทียบด้วย `fieldsUsed` (ชื่อซ้อนแบบจุดเฉพาะอาร์เรย์) — ตรงกับที่ mock/dayo ใช้ตัดสิน `UNSUPPORTED` |
| E3 `updated_at` | **ที่ ship**: ไม่เป็น null (`coalesce`) | `CentralOrder.updated_at` ยัง nullable (Task 5 — ไม่ต้องแก้) |
| E3 `dayo_edit` · `pos_order_id` | **ใหม่** (ADR-0050 · `0052_pos_push.sql:826-831`) | `CentralOrder` (A1) · mock (A3) · `order.central_dayo_edit_json` (A4) · `refreshDayoEdits`/`applyDayoEdits` (Task 15) · ป้ายอ่านอย่างเดียว (Task 19) · O1 รอเจ้าของเรื่องเงิน |
| ขนาดแก้ว | **ตั้งได้** · `catalog.sizes` (ADR-0054 · `0048_cup_sizes.sql:1470-1482`) | `SizeCode` regex + `sizes` (A1) · `priceCart`/`checkCart` (A2) · `sell-catalog.ts` (Task 12b) · ปุ่มขนาด (Task 18) |
| E1 ค่าที่ต่างจากแผนก้อน 1 | `categoryLabel` null ได้ · `timeFrom` `HH:MM:SS` · `pricing.commit` null ได้ · `last_receipt_no` ดิบ | A1 · Task 10, 11, 20 |
| บิล POS ใน E3 | มี (`source:'pos'`) + `pos_order_id` เฉพาะของ key นี้ | กรองออกจากหน้า "บิลบอท/เว็บวันนี้" (Task 15) แต่ **บิลของตัวเองใช้อ่าน `dayo_edit`** (Task 15) |
| จุดตีความ 13 ข้อ | ท้ายแผนก้อน 1 | ข้อที่กระทบแท็บเล็ตรับทั้งหมด (R14) · ข้อ 7 (ธงซ้ำหลุดเมื่อบอทไม่ระบุเกรดมัตฉะ) ไม่มีงานฝั่งแท็บเล็ต · ข้อ 11–13 ไม่กระทบแท็บเล็ต |

## 8. ตรวจแผนเทียบสเปก (self-review)

| สเปก | อยู่ใน task |
|---|---|
| §3 เจ้าของข้อมูล: แคตตาล็อก/พนักงานดึงอย่างเดียว · PIN อยู่ในเครื่อง · บิล/ยกเลิกส่งอย่างเดียว · สต็อกไม่ผ่านแท็บเล็ต | 10, 11, 12, 16 |
| §4.1 CORS/เวลา/เงิน/ข้อความ/ความเข้ากันได้ | 5 (schema), 7 (mock), 9 (client) |
| §4.2 `money-edge.ts` + เทสต์บังคับ | 1 |
| §4.3 `catalog_version` เทียบเท่ากัน/ไม่เท่า · ส่วนต่างทุกขนาดเห็นได้ | 10, 13 (`central_*`), 14 (`priceDiffBills`), 19 (หน้า + ส่วนต่างในรายละเอียดบิล) |
| §4.4 E1 ทุกข้อ (1–10) · ชื่อว่าง → "พนักงาน xxxx" · `last_receipt_no` · `pricing` · `supported_*` | 5, 10, 11, 12 (`lastReceiptNoOverall`), 20 (แถบ) |
| §4.5 E2 แถว `order`/`order_void` · ผลตอบ · ตารางเหตุผล · กันซ้ำ | 3 (`buildOrderRowData`), 5, 7, 12, 13 |
| §4.6 E3 (+ `dayo_edit`/`pos_order_id` อ่านอย่างเดียว — O1) | 9, A1, A3, A4, 15, 19, 21 |
| §4.4 ข้อ 12–13 ขนาดตั้งได้ · เวลาโปร `HH:MM:SS` · §4.4 ข้อ 2/6/9 ค่า null | A1, A2, 10, 11, 12, 18, 20 |
| §13.6 S1–S27 (ปรับตาม dayo) | §0.6 A1–A5 + ย่อหน้า "ปรับตาม dayo" ของ Task 10–15, 17–23 |
| §4.7 แหล่ง/ผู้บันทึก · ยกเลิกวันเดียวกันที่แท็บเล็ต | 12, 19 |
| §4.8 ป้าย "อาจซ้ำ" ในรายละเอียดบิล (ไม่เด้งกลางการขาย) | 13 (`central_duplicate_of_json`), 19 |
| §4.11 zod + fixture + mock | 5, 6, 7, 23 |
| §5.1 สำเนาปักรุ่น · `vendor:check`/`update` · `priceCart` · คิดใหม่ ณ วินาทีชำระ · `no_promotions` | 2, 3, 12, 18 |
| §5.2 parity ชั้น ค | 4, 23 |
| §5.3 เคส 1–15 | 4 (seed 13 กลุ่ม + ของจริงจาก dayo), 23 (20 บิลเชื่อมจริง) |
| §5.4 ต้นทุน 0 · VAT 0 · ห้ามบวกบาท float | 3 (`withZeroCosts`), 12 (`costSatang: 0`, `vatSatang: 0`, เงินเป็นสตางค์ทั้งหมด) |
| §6.1 outbox · `local_only` · ข้อความเดิมทุกไบต์ · ทางแก้ของ owner ข้อยกเว้นเดียว | 8, 12, 13, 15 |
| §6.2 ≤ 20 แถว · Web Lock · ปลุก · คำตัดสินจับด้วย key · แถวลูกรอแม่ · `supported_*` · 5xx×3 | 13, 14 |
| §6.3 ตารางลองใหม่ | 13 (+ R3, R4) |
| §6.4 หน้า "ส่งไม่ผ่าน" + ทางแก้ | 15, 20 |
| §6.5 ดึง E1 เปิดแอป/5 นาที/ก่อนเปิดกะ · ฉบับเปลี่ยนระหว่างตะกร้า · พนักงานใหม่ตั้ง PIN · `active:false` ล็อกอินไม่ได้ | 10, 11, 14, 17, 18 |
| §6.6 เลขใบเสร็จต่อจาก `last_receipt_no` | 11, 12 |
| §6.7 นาฬิกา (D80) | 9, 13, 14, 20 |
| §6.9 `storage.persist()` · สำรองไม่มีกุญแจ | 11 (เทสต์ไฟล์ SQLite), 17, 23 |
| §7 ข้อ 1 (กุญแจ: สแกน/วาง · ทดสอบด้วย E1 · ไม่แสดงอีก) · ข้อ 3 (401 → ตั้งใหม่) · ข้อ 5 (PIN) · ข้อ 6 (บทบาท + manager) · ข้อ 8 (ไม่สะท้อนค่า) | 5, 7, 9, 11, 16, 17, 20 |
| §9 ก้อน 2 เกณฑ์ทั้งหมด | typecheck/test ทุก task · parity 4+23 · vendor:check 2 · property test 1 · e2e mock 21 · เชื่อมจริง 23 |
| §11 ทิ้ง/เก็บ | 16 (ซ่อนสต็อก), 22 (ลบ `pricing.ts`) |
| D51 แท็บเล็ตจริงท้ายสุด | 23 Step 11 |

ตรวจชื่อข้าม task แล้ว: `priceCart`/`PricedCart`/`CartDraft` (3 → 4, 12, 18) · `toPricingCatalog` (3 → 4, 10) · `buildOrderRowData` (3 → 12) · `enqueuePush`/`enqueueLocalOnly` (12 → 13, 15) · `SyncContext`/`readDayoConfig`/`recordDayoFailure` (10 → 13, 14, 15) · `pushOnce`/`retryRow` (13 → 14, 15) · `SyncStatusDto` (14 → 20) · `MOCK_API_KEY`/`createMockDayo` (7 → 9–15, 21) · `STAFF`/`openConnectedApi` (11 → 12–15) · `sellCode` (12 → 13–15)

ตรวจหลังรีวิวอิสระ (plan07-review ทั้ง 23 ข้อ):

| ตรวจ | วิธี / ผล |
|---|---|
| escape ในโค้ดไม่กลายเป็นขึ้นบรรทัดจริง (Critical) | Task 2 ใช้ `'\n'`, `'\r\n'`, `.replace(/\r\n/g, '\n')` ตรงตัว · ตรวจทั้งไฟล์: `grep -nP "\r" <plan>` → ไม่มีผล และ `grep -nE "^'\)?$\|split\('$" <plan>` → ไม่มีสตริงที่ถูกตัดกลางบรรทัด |
| backoff | ล้าง backoff เน็ตหลุด/5xx เมื่อ `online`/`manual`/`open`/`before_close` · 429 `Retry-After` คงไว้ (Task 13, 14, 21) |
| คำตัดสินในก้อนเดียวกัน | update เฉพาะแถวที่ยัง `pending` · ลูกของแม่ที่ถูกปฏิเสธจบเป็น `PARENT_REJECTED` หลังลูป (Task 13 + เทสต์บิลถูกปฏิเสธ + ยกเลิก) |
| id ในเทสต์ | `sequentialIds` เป็น UUID ตัวเล็ก (Task 10) |
| `voided_at` | `max(now, sold_at)` (Task 12) |
| บทบาท (R11 · Q44) | manager = บิลตัวเอง + ดูรายงานกะ · `void_any`/`price_diffs`/`sync_problems` owner เท่านั้น (Task 12, 15, 16, 19, 20) · ไม่มีแถว `['manager','void_any',true]` เหลือในแผน |
| fixture สัญญา (~~D82~~ → O4) | **POS เป็นเจ้าของชั่วคราว** (dayo ไม่มีชุด fixture) · สเปก §4.11 แก้แล้ว (A5) · sha256 หลัง CRLF → LF ใช้เทียบเมื่อ dayo รับไป |
| migration บนเครื่องที่มีบิลจริง | Task 8: บิลครบชุด + VOID_REFUND ก่อน 0003 · จำนวนแถวเท่าเดิม · `foreign_key_check` ว่าง · CHECK ช่องทาง |
| API ฝั่ง owner รับผู้กระทำ | `listSyncProblems(actorUserId)`, `exportSyncRow({actorUserId,outboxId})`, `listPriceDiffs(actorUserId)` — ไม่มีรูปไม่มีอาร์กิวเมนต์เหลือ |
| งานใหญ่แตกย่อย | Task 12 → 12a–12d · Task 18 → 18a/18b · แต่ละงานย่อย commit แยก |
| รอบ 2 N1 fixture | `CONTRACT_FIXTURE_NAMES` ถอดจากแผนก้อน 1 (22 ชื่อ รวม `err-404-unknown-path`) · Task 6/7/23 อ่านจากรายชื่อ ไม่มีจุดใดเขียนจำนวน · `grep -n "21 ไฟล์" <plan>` → ไม่มีผล |
| รอบ 2 N2 owner คนสุดท้าย | `applyStaff` ไม่คงสิทธิ์ owner ที่ dayo ปลด · `recoverOwner` (กุญแจใหม่ + กุญแจเก่าถูกเพิกถอน + owner active ใน dayo) · `replaceApiKey` ปฏิเสธผู้อนุมัติที่ dayo ปลด · เทสต์ Task 10, 11, 17 |
| รอบ 2 N3 | T19 ย้ายไปรอบ 12 (หลัง T15) ต่อด้วย T20 |
| รอบ 2 N4 | ปุ่ม "ส่งตอนนี้" ล้าง backoff ≤ 1 ครั้งต่อ 30 วิ (`MANUAL_CLEAR_GAP_MS`) · เทสต์ online สร้าง backoff จริง ≥ 4 นาทีก่อน (streak 4) |
| รอบ 2 N5 | `CLOCK_AHEAD` ล้ำเกิน 24 ชม. = ยัง `pending` + `farAhead` + แถบเตือน owner · EXCLUDE เป็นการกดเองของ owner เท่านั้น (คำตัดสินหัวหน้า — ข้อยกเว้นของสเปก §6.4) |
| รอบ 2 N6 | sha256 fixture หลัง CRLF → LF (`fixtureSha256`, `fixtures:hashes` — D82) + `.gitattributes` `*.json text eol=lf` ในโฟลเดอร์ fixture ฝั่ง POS |

ข้อจำกัดที่ยอมรับในก้อน 2 (สเปกยอมรับไว้แล้ว): บิลที่ owner ปิดเป็นนอกระบบกลางไม่มีทางส่ง `order_excluded` (R8 · §4.10) · กะ/เงินสดเป็นข้อมูลในเครื่องเท่านั้นจนก้อน 3 · หน้าจอยังไม่มีปุ่มแก้วฟรี/ส่วนลดรายแก้ว (R5 — ตัวคิดราคารองรับแล้ว)
