# ก้อน 3 · POS กะ เงินสด นับเงิน ใบปิดกะ (Z) ขึ้นฐานกลาง และบิลนอกแคตตาล็อก · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แท็บเล็ตส่งกะ เงินเข้า-ออก การนับเงิน และใบปิดกะ (Z) ที่รวมบิลเงินสดจากบอท/เว็บ ขึ้น `POST /v1/pos/push` ของ dayo ด้วยชนิดใหม่ 4 ชนิดในช่องกะ นับเงินได้ตอนออฟไลน์แล้วออก Z เมื่อออนไลน์ (D101) ตัวเลขเงินที่ควรมีบนจอเท่ากับที่ dayo คิดซ้ำทุกสตางค์ (R-m1) และบิลที่ dayo ปฏิเสธถาวรปิดเป็น "บิลนอกแคตตาล็อก" (`order_off_catalog`) ได้โดย owner (D91 · D97)

**Architecture:** ต่อยอดโมดูลของก้อน 2 (แผน 07) ทั้งหมด ไม่สร้างทางส่งใหม่: สัญญา zod ใน `packages/contracts/src/dayo-api.ts` (T5 ของแผน 07) ได้ชนิดใหม่ 5 ชนิด + E4 · mock `packages/dayo-mock` (T7 + A3) ได้ตัวตัดสินชนิดใหม่ · ตัวส่ง `apps/pos/src/sync/push.ts` (T13) ได้ "ช่องกะ" หนึ่งช่องต่อเครื่อง · ทางแก้ของ owner `apps/pos/src/api/sync-problems.ts` (T15) ได้ "ปิดเป็นบิลนอกแคตตาล็อก" · สูตรเงินอยู่ `packages/domain/src/shift.ts` (ขยายตาม R-m1) และตัวแปลงแถวใหม่ `shift-rows.ts` / `off-catalog.ts` (แปลงสตางค์ → บาทด้วย `edgeSatangToBaht` ของ T1 แผน 07 เท่านั้น) · การนับเงินแยกเป็นสองขั้นในเครื่อง (นับเสร็จ → ออก Z) ตาม D101

**Tech Stack:** เหมือนแผน 07 (TypeScript 5.9 · pnpm + turbo · zod 4 · vitest + fast-check · React 19 + TanStack Router/Query · SQLite WASM + drizzle-orm · Comlink Worker · Playwright · Node 22)

**Spec:** `docs/design/04-สเปกการเชื่อม-POS-กับ-dayo.md` §4.10 ก้อน 3 (ทั้งส่วน) · §4.4 ข้อ 6 (`last_z_no`/`last_z_hash` · R4-1) · §6.1 · §6.2 · §6.4 · §6.6 (เลขใบปิดกะ) · §6.8 · §9 ก้อน 3 · §13.8 (O1-O3 · B1 · C1-C13 · R-I1..8 · R-m1..10 · R2-* · R3-* · R4-*) · การตัดสินใจ D90-D102 (สำคัญ: D91 D97 บิลนอกแคตตาล็อก · D93 ยึดเงินที่เก็บจริง · D100 `block3_live_from` · D101 นับเงินออฟไลน์ · D102 เกณฑ์ `≥`) · ร่าง ADR `docs/design/dayo-adr-drafts/P3-shift-cash-z-report.md` · แผนฝั่ง dayo ที่เขียนคู่กัน: `2026-09-28-08d-block3-dayo-side.md` · แผนก้อน 2: `2026-09-25-07-block2-pos-sell-central.md`

> **สถานะฝั่ง dayo (28 ก.ย. 2569):** เจ้าของ **ยอมรับ ADR-0056** (กะ เงินสด นับเงิน Z · ตามร่าง P3) และ **ADR-0051** (สำรองอัตโนมัติ · ยกเลิกการเลื่อนตาม D95) แล้ว · session ของ dayo เริ่มแผน 08d ได้ · สำรองอัตโนมัติเป็นเงื่อนไขเปิดใช้จริง (D86 · D94) ของแผนเปิดใช้งาน ไม่ใช่ของแผนนี้ · คำถาม Q72 Q73 Q74 ยังเปิด (§0.6)

## Global Constraints

- **ทุกข้อใน Global Constraints ของแผน 07 ใช้ต่อ** (เงินสตางค์ · `money-edge.ts` จุดเดียว · เพดาน 20 แถว/262,144 ไบต์ · backoff · นาฬิกา D80 · API key ไม่ออกจาก IndexedDB · repo dayo อ่านอย่างเดียว · ข้อความไทยใน `ui/th.ts` · commit ตามกติกา · ไม่รันบนแท็บเล็ตจริง D51)
- **ไม่มีเงินติดลบข้ามขอบ** (§4.10 C5): แท็บเล็ตส่งองค์ประกอบ `z_report.cash` ที่ไม่ติดลบ + `counted` · ไม่ส่ง `expected`/`variance` · `edgeSatangToBaht` รับเฉพาะ ≥ 0
- **เวลาในแถวมาจากเครื่อง** (ISO UTC มีมิลลิวินาที) · dayo ตัดสินด้วยเวลาในแถว ไม่ใช่ลำดับที่แถวมาถึง
- **กะเปิดละหนึ่งในเครื่อง** (D47 ข้อ 6 · partial unique index `shift_open_uq` เดิม) · ฐานกลางไม่มี unique นี้ (C3)
- **หลังกด "นับเสร็จ" กะไม่รับบิลและเงินเข้า-ออกอีก** (§6.8 ข้อ 1) · `counted_at` ตั้งครั้งเดียว แก้จำนวนทีหลังไม่เปลี่ยนค่า
- **แถวกะ/เงินสดของกะที่เปิดก่อนก้อน 3 ใช้งานจริงเป็น `local_only` ตลอดไป** · บิลของกะนั้นส่ง `shift_id: null` · บิลที่ปิด "นอกระบบกลาง" ในก้อน 2 (แผน 07 R8) คงเป็น `local_only` ไม่แปลง (C13)
- **ห้ามบันทึก `PAID_IN`/`PAID_OUT` เพื่อชดเชยบิลนอกแคตตาล็อก** (§4.10 เงินสดที่ควรมี)
- ค่า `order_no` อ่านจาก `data` ของคำตอบเท่านั้น ห้ามแยกจาก `detail` (R3-m4) · ตัดสินจาก **คำนำหน้า** ของ `detail` เท่านั้น ไม่อ่านข้อความไทย
- ทุก task: `pnpm turbo run typecheck test` ผ่านทั้ง repo · TDD (เทสต์ล้มก่อน) · commit แบบ Conventional Commits สั้น เหตุผลมากกว่ารายละเอียด · stage เป็นชื่อไฟล์ · ไม่มี `Co-Authored-By`/บรรทัดระบุ AI · ห้าม `git checkout -- <ไฟล์>`/`git reset --hard`/`git add -A`
- repo dayo บนเครื่อง Mac อยู่ที่ `/Users/tungao/TungAo-Project/dayo/dayo-shop-system` (เอกสารเก่าเขียน `D:\TungAo-Project\line-bot\...` ให้แปลง path เอง) · อ่านอย่างเดียว

---

## 0. ภาพรวมการตัดสินใจของแผน

### 0.1 ของจากก้อน 2 (แผน 07) ที่แผนนี้ต่อยอด · ต้อง merge แล้วก่อนเริ่มสายที่ใช้

| ของ | อยู่ที่ (แผน 07) | ก้อน 3 ทำอะไร |
|---|---|---|
| `edgeSatangToBaht` / `edgeBahtToSatang` | `packages/domain/src/money-edge.ts` (T1) | ใช้แปลงทุกช่องเงินของชนิดใหม่และ E4 |
| `PUSH_KINDS` · `PushRow` · `rowKey` · `KNOWN_REJECT_REASONS` · `ClientInfo` · `CentralOrder` · `isRowSupported` · `fieldsUsed` | `packages/contracts/src/dayo-api.ts` (T5 + A1) | เพิ่ม 5 ชนิด · `rowKey` ใช้ช่อง id ตามชนิด · **ถอด `ALREADY_PRESENT`** (C13) · `last_z_no`/`last_z_hash` · `off_catalog` |
| `OutboxStatus` · `EventType` · `ShiftStatus` | `packages/contracts/src/enums.ts` (T5) | + `closed_off_catalog` · + `CLOSED_OFF_CATALOG`, `DELIVERED_ELSEWHERE` · + `counted` |
| fixture สัญญา + `CONTRACT_FIXTURE_NAMES` + `fixtures:hashes` | `packages/contracts/fixtures/dayo-api/` (T6 + A1 · POS เป็นเจ้าของตาม D84) | + fixture ของทุกชนิดใหม่และ E4 (§4.11 ข้อ 2) |
| mock `judgeRow` + ตัวควบคุม `/__mock/*` | `packages/dayo-mock/src/{state,judge,handler,server}.ts` (T7 + A3) | ตัวตัดสินชนิดใหม่ · E4 · `pos_push_rejections` · `block3_live_from` · เพดานยอด |
| `outbox.parent_key` · `next_attempt_at` · `result_json` · `order_item` · `order.payment_code` · `order.central_*` | `packages/db-schema` migration `0003`-`0005` (T8 + A4) | migration ใหม่ `0006` |
| `enqueuePush` / `enqueueLocalOnly` · `PushRowInput` | `apps/pos/src/db/outbox.ts` (T12a) | `PushRowInput` ได้ 5 ชนิด · ผู้เขียนกะ/เงินสดเลือก push หรือ local_only ตาม `shift.sync_mode` |
| `createDayoClient` · `DayoError` | `apps/pos/src/sync/dayo-client.ts` (T9) | + `getShiftCash` (E4) |
| `pullCatalog` · `writeCatalogAnswer` · `readCatalog` · `readSupported` | `apps/pos/src/sync/catalog.ts` (T10) | เก็บ `last_z_no`/`last_z_hash` |
| `connect` · `recoverOwner` | `apps/pos/src/api/connect.ts` (T11) | ตั้งพื้นเลข Z จาก E1 (R4-1) |
| `recordSale` · `cancelSale` | `apps/pos/src/api/{sale,void}.ts` (T12b/c) | `shift_id` ของกะกลาง · `VOID_REFUND` เป็นแถว push |
| `pushOnce` · `retryRow` · `cascadeChildren` · `CLOCK_AHEAD_FAR_MS` | `apps/pos/src/sync/push.ts` (T13) | ช่องกะ · `scope:` รอ · R-I1 · ผลตามชนิด |
| `createSyncScheduler` · `SyncStatusDto` | `apps/pos/src/sync/scheduler.ts`, `api/bootstrap.ts` (T14) | สถานะใหม่ (Z รอออนไลน์ · กะชน · scope รอ) |
| `Remedy` · `remedyRow` · `listSyncProblems` · `excludeFromSync` | `apps/pos/src/api/sync-problems.ts` (T15) | + `CLOSE_OFF_CATALOG` · `ACK_DELIVERED` · `RECONFIRM_OWNER` · ทางแก้ของแถวกะ |
| `StatusBanners` · `SyncProblemsScreen` · `OwnerApprovalDialog` | `apps/pos/src/screens/` (T20) | ปุ่มและแถบใหม่ |
| e2e helper + mock ใน Playwright | `apps/pos/e2e/helpers.ts`, `playwright.config.ts` (T21) | spec ก้อน 3 |

### 0.2 ของบน main (แผน 3b) ที่ใช้ต่อ / เปลี่ยน

| ของ | ทำอย่างไร |
|---|---|
| `CashInputs` · `expectedCashSatang` · `cashInputsFromMovements` · `ZInput` · `buildZReport` · `varianceNeedsReason` (`packages/domain/src/shift.ts`) | ขยายตาม R-m1 (`botCashSatang` · `drawerExpensesSatang`) · `>` เป็น `>=` (D102) · `ZInput` ได้กลุ่ม `central` (T1-T2) |
| `closeShift` ธุรกรรมเดียว (`apps/pos/src/api/close.ts`) | แยกเป็น `markCounted` → (`confirmCountOffline`) → `closeShift` ตาม D101 · กติกาโซ่ Z/`chainWarning`/`Z_CHAIN_BROKEN` ของ D53-D55 **คงเดิมทุกข้อ** |
| `buildShiftReport` · `fingerprint` · `SHIFT_CHANGED` (`api/shift-report.ts`) | ใช้ต่อ · fingerprint รวมบิลบอท |
| `cash_count.expected_satang`/`variance_satang` (not null) | เก็บค่า ณ ตอนยืนยันการนับ **ในเครื่องเท่านั้น** + คอลัมน์ใหม่ `bot_cash_included` (§6.8 ข้อ 4 · ruling R4) |
| หน้า `CountScreen` · `CloseShiftScreen` · `ZReportScreen` · `ShiftFigures` | แก้ตามขั้นตอนใหม่ (T15) |

### 0.3 จุดที่แผนตัดสินเอง (Ruling · แก้ได้ถ้าเจ้าของสั่ง)

| # | เรื่องที่สเปกไม่ระบุชัด | ตัดสิน | เหตุผล |
|---|---|---|---|
| R1 | แท็บเล็ตรู้ได้อย่างไรว่ากะนี้ "เปิดหลังก้อน 3 ใช้งานจริง" | ตอนเปิดกะ: `supported_kinds` ล่าสุดที่เก็บจาก E1 มีครบ `shift_open` `cash_movement` `cash_count` `shift_close` → `shift.sync_mode = 'central'` ไม่งั้น `'local_only'` · **แช่แข็งตอนเปิดกะ** (ไม่เปลี่ยนภายหลัง) · กะ `local_only` ส่ง `shift_id: null` ในบิลและไม่ส่งแถวกะใด ๆ | ไม่ต้องมีค่าตั้งให้เจ้าของกรอก (สอดคล้อง D100) · dayo ที่ยังไม่ deploy ก้อน 3 ไม่รายงานชนิดเหล่านี้ · กะที่เปิดตอนออฟไลน์ใช้รายการล่าสุดที่มี |
| R2 | สถานะกะในเครื่องหลังนับเสร็จ | `ShiftStatus` = `open` → `counted` (ตั้ง `counted_at` + `counted_by` ครั้งเดียว) → `closed` (ออก Z แล้ว) · `currentOpenShift` คืนเฉพาะ `open` เดิม จึงขายหรือบันทึกเงินเข้า-ออกในกะที่นับแล้วไม่ได้เอง (`NO_OPEN_SHIFT`) · เปิดกะถัดไปได้ทันทีเพราะ index ดูแค่ `open` | ตรงกับ §6.8 ข้อ 1 และ D68 (เปิดกะถัดไปได้ระหว่าง Z รอออนไลน์) โดยไม่แตะ index เดิม |
| R3 | `counted_at` ของกะเก่าก่อนก้อน 3 (ใช้เป็น `after` ของ E4) | migration `0006` เติม `shift.counted_at` = `cash_count.created_at` ของกะที่ปิดแล้ว · `after` = `counted_at` มากสุดของกะอื่นในเครื่องที่น้อยกว่าของกะนี้ (รวมกะ `local_only`) · ไม่มี = 00:00 ไทยของ `business_date` | §4.10 E4: "การนับครั้งก่อนในเครื่อง รวมการนับของกะ `local_only`" |
| R4 | บอกอย่างไรว่า `cash_count` ในเครื่องรวมบิลบอทหรือไม่ (§6.8 ข้อ 4) | คอลัมน์ใหม่ `cash_count.bot_cash_included` (null = ก่อนก้อน 3 · 0 = นับตอนออฟไลน์ · 1 = รวมแล้ว) · ค่าในเครื่องไม่ส่ง · ค่าทางการอยู่ใน Z | หน้าประวัติกะแสดงป้าย "ยังไม่รวมบิลเงินสดจากบอท" ได้ถูก |
| R5 | กะ `local_only` ที่ยังเปิดอยู่ตอนก้อน 3 ใช้งานจริง ต้องดึง E4 ไหม | **ไม่ดึง** (`botCashSatang = 0`) · ปิดกะแบบเดิมทั้งขั้น | กะก่อนก้อน 3 ไม่เคยขายจริง (D94) · Z ของกะนี้ไม่ถูกส่ง |
| R6 | E4 ดึงสองครั้ง (ตอนแสดงผล และก่อนบันทึก Z) | `closeShift` เรียก E4 อีกครั้งนอกคิว serial แล้วเทียบ fingerprint ของชุดบิลบอทกับที่จอแสดง · ต่าง = `BOT_CASH_CHANGED` (ไม่เขียนอะไร · จอดึงใหม่) | แบบเดียวกับ `SHIFT_CHANGED` ของ D54 · ตัวเลขใน Z ต้องเท่ากับที่ owner เห็นตอนกด PIN |
| R7 | เก็บข้อมูลที่ส่งใน `z_report` ไว้ตรงไหนในเครื่อง | ใน `ZSnapshot` เป็นกลุ่ม `central` (optional · มีเฉพาะกะ `central`): `countedAt` `botWindow` `botBills` `posBills` `movementIds` `centralBase` · ถูกแฮชรวมกับ Z · แถว `shift_close` สร้างจาก snapshot อย่างเดียว | ส่งซ้ำได้ทุกไบต์ (§6.1) · Z เก่าไม่มีกลุ่มนี้ แฮชเดิมยังตรง (ฟิลด์ optional แบบ `zNoGap` ของ D55) |
| R8 | เลข Z หลังติดตั้งใหม่ด้วย key เดิม (R4-1) | เก็บ "พื้นเลข Z" `dayo.z_floor = {zNo, hash}` จาก `client.last_z_no`/`last_z_hash` ของ E1 (ค่ามากสุดที่เคยเห็น) · Z ใบถัดไป = max(Z ล่าสุดในเครื่อง, พื้น) + 1 · ถ้าพื้นมากกว่า: `prev_hash` = `last_z_hash` และ snapshot เก็บ `central.centralBase = {zNo, hash}` · ตัวตรวจช่องว่างเลข Z ของ D55 ถือ `centralBase.zNo` เป็นช่องว่างที่รับทราบแล้ว (ไม่ขึ้น `Z_CHAIN_BROKEN`) · ยอดสะสม (grand total) ของเครื่องใหม่เริ่มที่ 0 | ไม่ได้ `z_no_taken:` ปลอม · ไม่ทำให้ owner ต้องกด PIN รับทราบโซ่ขาดทุกครั้ง · ยอดสะสมเป็นของเครื่อง (D8) ไม่มีในฐานกลาง |
| R9 | แถวบรรทัดของบิลนอกแคตตาล็อกเมื่อส่วนลดต่อแก้วหารไม่ลงตัว | ต่อบรรทัด: `discount_per_cup = floor((unit_price × qty − line_total) ÷ qty)` · เศษที่เหลือย้ายไปรวมใน `bill_discount` · `total` = ยอดที่เก็บจริงเสมอ | สูตรของ dayo บังคับ `line_total = (unit_price − discount_per_cup) × qty` · ไม่แตกบรรทัด (อยู่ใต้ 50 บรรทัดเสมอ) · ยอดรวมไม่เปลี่ยน |
| R10 | `rejected FORBIDDEN scope:` ในช่องกะ | แถวคง `pending` · `last_error.scopeHold = {since}` · ลองทุก 15 นาที ไม่นับครั้ง ไม่เป็น `STUCK` · หยุดแถวหลังในช่องกะ · 24 ชม. = แถบแดง owner · 7 วัน = ขึ้นหน้า "ส่งไม่ผ่าน" พร้อม "ปิดไว้ในเครื่อง" | ตรง §6.2 และ §6.4 (R2-m1) |
| R11 | ทางแก้ `ACK_DELIVERED` ("รับทราบ บิลอยู่ในระบบกลางแล้ว") ต้อง PIN ไหม | ต้อง PIN owner + เหตุผล (เหมือนทางแก้อื่นทุกข้อ §6.4) | กติกาเดียวทั้งหน้า |
| R12 | `EXCLUDE` ("ปิดไว้ในเครื่อง") ของแถวกะ | แถวเป็น `local_only` + **แถวลูกทุกชั้น** (เช่น `shift_open` → `cash_movement`/`cash_count` → `shift_close`) เป็น `local_only` ตาม · ปลดช่องกะให้แถวหลังเดินต่อ | ลูกของแถวที่ไม่ถูกส่งส่งไม่ได้อยู่แล้ว · ไม่ให้ช่องกะค้าง |
| R13 | ลำดับของสาย C/D เทียบกับท้ายก้อน 2 | สาย A (domain) และ B (contracts/mock) ของก้อน 3 เริ่มได้เมื่อสาย A และ B ของก้อน 2 merge เข้า `block-2-pos` แล้ว · **สาย C และ D ของก้อน 3 เริ่มหลัง Task 22 ของแผน 07 merge** (ก้อน 2 ทั้งก้อนอยู่บน `block-2-pos`) | กัน `api/sale.ts` `api/void.ts` `api/types.ts` ชนกับการลบของเก่าใน T22 |

**จุดขัดกับ D หรือ ADR**: ไม่พบ · ทุกข้อใน §0.3 เป็นการตีความที่สเปกเปิดไว้ · คำถามเปิดของเจ้าของอยู่ใน §0.6 (ไม่บล็อกโค้ดของแผนนี้)

### 0.4 ตารางงานขนาน (สูงสุด 4 agent · สายละ 1 worktree)

integration branch: `block-3-pos` (แตกจาก `block-2-pos` หลัง T22 ของแผน 07 merge แล้ว หรือจาก `main` ถ้าก้อน 2 merge เข้า `main` แล้ว · ruling R13) · แต่ละสายแตก branch จาก `block-3-pos` ใน worktree ของตัวเอง · task ที่ผ่านตรวจ merge `--no-ff` เข้า `block-3-pos` · ตรวจทั้งก้อนแล้วจึง merge เข้า `main`

| สาย | worktree / branch | แพ็กเกจที่แตะ (เจ้าของคนเดียว) | task |
|---|---|---|---|
| A domain | `wt-b3-domain` / `b3-domain` | `packages/domain` | 1 → 2 → 3 → 4 |
| B contract | `wt-b3-contract` / `b3-contract` | `packages/contracts`, `packages/dayo-mock` | 5 → 6 → 7 |
| C device | `wt-b3-device` / `b3-device` | `packages/db-schema`, `apps/pos/src/{db,sync,api}`, `apps/pos/test` | 8 → 9 → 10 → 11 → 12 → 13 |
| D screens | `wt-b3-screens` / `b3-screens` | `apps/pos/src/{screens,ui,state,app,router.tsx}`, `apps/pos/e2e`, `apps/pos/playwright.config.ts` | 14 → 15 → 16 |
| ท้าย | `block-3-pos` | ทุกที่ | 17 → 18 |

**ไฟล์เจ้าของคนเดียว** (เหมือนแผน 07): `apps/pos/src/api/errors.ts` = สาย C · `apps/pos/src/ui/errors.ts`, `ui/th.ts` = สาย D (ข้อความไทยของรหัสใหม่ของสาย C ทำใน T14/T15) · `packages/contracts/src/dayo-api.ts`, `enums.ts` = สาย B · `pnpm-lock.yaml` ชนตอน merge ห้ามแก้ด้วยมือ (รับฝั่งหนึ่งแล้ว `pnpm install` ใหม่)

| รอบ | สาย A | สาย B | สาย C | สาย D | agent พร้อมกัน |
|---|---|---|---|---|---|
| 1 | T1 (รอ: ก้อน 2 สาย A merge) | T5 (รอ: ก้อน 2 สาย B merge) · **ล็อกสัญญาก่อนทุกอย่าง** | — | — | 2 |
| 2 | T2 (รอ T1) | T6 (รอ T5) | T8 (รอ T5 · R13) | — | 3 |
| 3 | T3 (รอ T2, T5) | T7 (รอ T6) | T9 (รอ T8 · ใช้ mock ของ T7 ในเทสต์ E4 → เริ่มส่วนที่ไม่ใช้ mock ก่อน) | — | 3 |
| 4 | T4 (รอ T3) | — | T10 (รอ T3, T9) | — | 2 |
| 5 | — | — | T11 (รอ T2, T10) | — | 1 |
| 6 | — | — | T12 (รอ T7, T11) | T14 (รอ T11) | 2 |
| 7 | — | — | T13 (รอ T4, T12) | — | 1 |
| 8 | — | — | — | T15 (รอ T13) | 1 |
| 9 | — | — | — | T16 (รอ T7, T15) | 1 |
| 10 | T17 บน `block-3-pos` → ตรวจทั้งก้อน → merge เข้า `main` | | | | 1 |
| 11 | T18 (รอ: แผน 08d ของ dayo เสร็จบน dayo local + เจ้าของ) | | | | หัวหน้า + 1 |

สาย C เป็นเส้นทางวิกฤต (T8-T13 ต่อกัน 6 task) · สาย A/B ว่างหลังรอบ 4 ใช้เป็นกำลังตรวจงาน

### 0.5 ผู้ทำ โมเดล และผู้ตรวจต่อ task

| Task | ผู้ทำ (โมเดล) | ผู้ตรวจ |
|---|---|---|
| 1 สูตรเงิน R-m1 · 2 Z ก้อน 3 · 3 ตัวแปลงแถวกะ · 4 บิลนอกแคตตาล็อก | domain-engineer (opus) | code-reviewer (sonnet) |
| 5 สัญญา · 6 fixture | domain-engineer (opus) | code-reviewer |
| 7 mock | sync-engineer (opus) | code-reviewer |
| 8 ฐานในเครื่อง | sync-engineer (opus) | code-reviewer |
| 9 E1 พื้นเลข Z + E4 client | sync-engineer (opus) | code-reviewer |
| 10 ผู้เขียนแถวกะ/เงินสด/บิล | sync-engineer (opus) | code-reviewer |
| 11 นับเงิน/ออก Z | sync-engineer (opus) | code-reviewer + **security-reviewer** (PIN owner · เงินซ้ำ) |
| 12 ตัวส่ง ช่องกะ | sync-engineer (opus) | code-reviewer + **security-reviewer** (`scope:` · ข้อมูลกะชน) |
| 13 ทางแก้ของ owner ก้อน 3 | sync-engineer (opus) | code-reviewer + **security-reviewer** (PIN owner · บิลนอกแคตตาล็อก) |
| 14 หน้านับเงิน/ปิดกะ · 15 หน้า "ส่งไม่ผ่าน" ก้อน 3 · 16 e2e | pos-ui-developer (sonnet) | code-reviewer (+ **security-reviewer** สำหรับ 15) |
| 17 ตรวจทั้งก้อน | หัวหน้า | code-reviewer + security-reviewer (opus · ทั้งก้อน) |
| 18 เชื่อมจริง | หัวหน้า + sync-engineer (opus) + **เจ้าของ** | code-reviewer + security-reviewer |

ทุก task: implementer → test-runner (haiku) → ผู้ตรวจ → แก้ ≤ 3 รอบกับ agent ตัวเดิม → บันทึก `Task N: complete` ใน `.superpowers/sdd/block-3/progress.md` (ไม่ commit)

### 0.6 คำถามเปิดของเจ้าของ (ไม่บล็อกโค้ด · ค่าเริ่มต้นเป็นค่าตั้งบรรทัดเดียว)

| # | คำถาม | คำตอบที่แนะนำ | ค่าเริ่มต้นในโค้ดจนกว่าจะตอบ (บรรทัดเดียว) |
|---|---|---|---|
| **Q72** | เพดานยอดต่อ "บิลนอกแคตตาล็อก" (`shop_settings.off_catalog_max_total`) ค่าเริ่มต้นเท่าไร | **฿3,000** · บิลปกติของร้าน ~฿100-300 · เพดานนี้กันกุญแจเครื่องที่หลุดยัดยอดปลอมใบใหญ่ แต่ไม่กันบิลจริงขนาดงานเลี้ยง (~50 แก้ว) · owner เพิ่มบนเว็บได้พร้อม audit แล้วกด "ลองใหม่" | POS: `MOCK_DEFAULTS.offCatalogMaxTotalBaht = 3000` ใน `packages/dayo-mock/src/state.ts` (T7) · dayo: ค่า default ของคอลัมน์ใน migration (แผน 08d Task 3) · แท็บเล็ตไม่มีค่าคงที่นี้ (แสดงข้อความจาก `rule:` เท่านั้น) |
| **Q74** | แจ้ง Discord ครั้งเดียวเมื่อใบปิดกะค้าง "รอบิล" (`waiting_bills`) เกิน 48 ชม. (ผู้ตรวจความปลอดภัยเสนอ · ขัด D98 ที่ว่า "รอบิลไม่แจ้ง") | **แนะนำ (ข) เปิด: แจ้งระดับ WARNING ครั้งเดียวต่อ Z เมื่อรอเกิน 48 ชม. ไม่มียอดเงิน** · เหตุ: id ปลอมหรือแถวที่ "ปิดไว้ในเครื่อง" ทำให้ Z ค้าง "รอ" ตลอดไปและบังความไม่ตรงได้ · ครั้งเดียวต่อ Z เสียงดังน้อยมาก · ถ้าเลือก (ก) คงตาม D98 เว็บยังแสดงอายุการรอทุกกะ | ไม่มีงาน POS · dayo: `WAITING_BILLS_ALERT_HOURS: number \| null = null` (null = ปิด ตาม D98) ที่เดียว (แผน 08d Task 9) · ตอบ (ข) = เปลี่ยนเป็น `48` + บันทึก D ใหม่ที่แก้ D98 |
| Q73 | ข้อความ Discord ของกะไม่มียอดเงิน (S7) | **ไม่มียอดเงิน** (ลิงก์หน้ากะเท่านั้น) · ช่อง Discord ไม่ใช่ที่ปลอดภัยของตัวเลขเงิน | ไม่มีงาน POS · dayo: ตัวสร้างข้อความใน `packages/shared/src/discordMessages.ts` ไม่รับยอดเงิน (แผน 08d Task 9) |

เจ้าของตอบแล้วให้ docs-writer บันทึกเป็น D ใหม่ใน `00-บันทึกการตัดสินใจ.md` และลบออกจาก `02-เรื่องค้างสำหรับเจ้าของ.md` §ง

---

## 1. File Structure

### สร้างใหม่

| ไฟล์ | หน้าที่ |
|---|---|
| `packages/domain/src/shift-rows.ts` | `buildShiftOpenData` · `buildCashMovementData` · `buildCashCountData` · `buildShiftCloseData` (snapshot สตางค์ → `data` บาทของ E2) |
| `packages/domain/src/off-catalog.ts` | `buildOffCatalogData` (บิลแช่แข็งในเครื่อง → `data` ของ `order_off_catalog` · ruling R9) |
| `packages/domain/test/{z-cash-parity,z-report-block3,shift-rows,off-catalog}.test.ts` · `test/fixtures/z-cash-parity.json` | เทสต์ + fixture parity สูตรเงินที่ควรมี (POS เป็นเจ้าของ · D84 · ส่งสำเนาให้ dayo ใช้ในเทสต์ SQL) |
| `packages/contracts/test/dayo-api-block3.test.ts` | เทสต์ schema ชนิดใหม่ |
| `packages/contracts/fixtures/dayo-api/b3-*.json` | fixture สัญญาชนิดใหม่และ E4 (รายชื่อใน T6) |
| `packages/dayo-mock/src/{judge-shift,judge-off-catalog,shift-cash}.ts` · `test/{judge-shift,judge-off-catalog,shift-cash}.test.ts` | ตัวตัดสินชนิดใหม่ · E4 |
| `packages/db-schema/drizzle/sqlite/0006_block3_shift_central.sql` (+ snapshot/journal) · `test/block3.test.ts` | migration |
| `apps/pos/test/{shift-central,count-offline,close-central,push-shift-lane,off-catalog-remedy,z-floor,shift-cash-client}.test.ts` | เทสต์ฝั่งเครื่อง |
| `apps/pos/src/screens/{BotCashPanel,OffCatalogDialog}.tsx` (+ test) | หน้าจอใหม่ |
| `apps/pos/e2e/block3-*.spec.ts` | e2e กับ mock |

### แก้

| ไฟล์ | เปลี่ยน |
|---|---|
| `packages/domain/src/shift.ts`, `src/index.ts`, `test/shift.test.ts` | R-m1 · `>=` · `ZInput.central` |
| `packages/contracts/src/dayo-api.ts`, `src/enums.ts`, `src/dayo-fixture.ts`, `test/dayo-api.test.ts`, `test/dayo-fixtures.test.ts` | ชนิดใหม่ · enum · รายชื่อ fixture |
| `packages/dayo-mock/src/{state,judge,handler,server,index}.ts`, `test/replay.test.ts` | ต่อชนิดใหม่ |
| `packages/db-schema/src/sqlite/sales.ts`, `src/browser/sqlite-migrations.gen.ts`, `test/parity.test.ts` | คอลัมน์ใหม่ |
| `apps/pos/src/db/outbox.ts` | `PushRowInput` 7 ชนิด · `cascadeLocalOnly` |
| `apps/pos/src/sync/{dayo-client,catalog,push,scheduler}.ts` | E4 · พื้นเลข Z · ช่องกะ · สถานะ |
| `apps/pos/src/api/{shift,cash,void,sale,close,shift-report,connect,sync-problems,bootstrap,types,pos-api,errors}.ts` | ตาม task |
| `apps/pos/src/{router.tsx,ui/th.ts,ui/errors.ts,screens/*}` | ตาม task |

---

## 2. สาย A · สูตรเงินและตัวแปลงแถว (`packages/domain`)

### Task 1: สูตรเงินที่ควรมีตาม R-m1 + เกณฑ์ `>=` (D102) + parity กับสูตร dayo

ผู้ทำ: domain-engineer (opus) · สเปก §4.10 "dayo คิดเอง" · "เงินสดที่ควรมี (ล็อก)" · R-m1 · R2-D102 · D36 · D102 · รอ: ก้อน 2 สาย A merge แล้ว

**Files:**
- Modify: `packages/domain/src/shift.ts`, `packages/domain/src/index.ts`, `packages/domain/test/shift.test.ts`
- Create: `packages/domain/test/z-cash-parity.test.ts`, `packages/domain/test/fixtures/z-cash-parity.json`

**Interfaces:**
- Consumes: `edgeSatangToBaht`, `edgeBahtToSatang` (แผน 07 T1)
- Produces:

```ts
export type CashInputs = {
  openingFloatSatang: number; cashSalesSatang: number; voidRefundsSatang: number
  paidInSatang: number; paidOutSatang: number; dropsSatang: number
  drawerExpensesSatang: number // block 3 = 0 always · block 4 uses it
  botCashSatang: number        // Σ bot/web cash bills of E4 (bot_window) · 0 for a local_only shift (ruling R5)
}
// expected = opening + cash_sales − void_refunds + paid_in − paid_out − drops − drawer_expenses + bot_cash
export function expectedCashSatang(x: CashInputs): number
export function cashInputsFromMovements(openingFloatSatang: number, cashSalesSatang: number,
  movements: readonly { kind: CashKind; amountSatang: number }[], extra?: { botCashSatang?: number; drawerExpensesSatang?: number }): CashInputs
export function varianceNeedsReason(varianceSatang: number, alertSatang: number): boolean // |variance| >= alert (D102)
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**
  - `shift.test.ts` แก้/เพิ่ม: `varianceNeedsReason(-2000, 2000) === true` · `varianceNeedsReason(-1999, 2000) === false` · `varianceNeedsReason(2000, 2000) === true` (เทสต์เดิมของแผน 3b ที่คาด `false` ที่ค่าเท่ากับเกณฑ์ ต้องเปลี่ยนเป็น `true` พร้อมคอมเมนต์ `D102`) · `expectedCashSatang` กับ `botCashSatang: 30000, drawerExpensesSatang: 0` บวก 30000 · `drawerExpensesSatang: 12000` ลบ 12000 · `cashInputsFromMovements(…, { botCashSatang: 500 })` ได้ช่องนั้น · ไม่ส่ง `extra` = ทั้งสองช่องเป็น 0 · ค่าติดลบใน `extra` = `RangeError` · property test (fast-check): `expectedCashSatang` = สูตร 8 องค์ประกอบ สำหรับทุกค่า ≥ 0 ที่ไม่ล้น
  - `z-cash-parity.test.ts`: อ่าน `fixtures/z-cash-parity.json` รูป `{ "version": 1, "cases": [{ "id": string, "note": string, "cash": { opening_float, pos_cash_sales, void_refunds, paid_in, paid_out, drops, drawer_expenses, bot_cash }, "counted": baht, "expected": baht, "variance": baht }] }` (บาทเป็นตัวเลขทศนิยม 2 ตำแหน่ง · ติดลบได้เฉพาะ `expected`/`variance`) · ต่อเคส: แปลงองค์ประกอบด้วย `edgeBahtToSatang` → `expectedCashSatang` → เทียบกับ `Math.round(expected * 100)` **ต่าง 0 สตางค์** · `variance` = `counted − expected` เช่นกัน · fixture อย่างน้อย 12 เคส: ศูนย์ทั้งหมด · มีทุกองค์ประกอบ · เศษสตางค์ .01/.99 · เงินที่ควรมีติดลบ (จ่ายออกเกินเงินในลิ้นชัก D54) · ส่วนต่าง −20.00 / −19.99 / +20.00 · บิลบอท 3 ใบ · ขายเงินสด 100 แล้วคืนเงิน 100 (D36: ขายรวมบิลที่ยกเลิก + คืนเงินแยก) · ค่าใหญ่ใกล้เพดาน `9_999_999_999` สตางค์ต่อช่อง
- [ ] **Step 2: รันให้ล้ม** · `pnpm --filter @dayo/domain test -- shift z-cash-parity` · คาดว่า FAIL
- [ ] **Step 3: แก้ `shift.ts`** · เพิ่มสองช่องใน `CashInputs` · สูตรใหม่ · `cashInputsFromMovements` รับ `extra` (ตรวจ ≥ 0 และ safe int) · `varianceNeedsReason` ใช้ `>=` และแก้ doc comment เป็น "D102: ตั้งแต่เกณฑ์ขึ้นไป" · `buildZReport` ตรวจทุกช่องของ `cash` ≥ 0 อยู่แล้ว (ลูปเดิม) · ข้อความ error `'a cash variance at or above the alert threshold needs a reason (D102)'` · export ของใหม่ใน `index.ts`
- [ ] **Step 4: แก้ผู้เรียกเดิมใน domain** · ทุกที่ที่สร้าง `CashInputs` ด้วยมือในเทสต์ domain ใส่ `drawerExpensesSatang: 0, botCashSatang: 0` · **ไม่แตะ `apps/pos`** (สาย C แก้ใน T11 · จนกว่านั้น `apps/pos` typecheck ต้องยังผ่าน: `cashInputsFromMovements` ของ `apps/pos` ไม่ส่ง `extra` จึงได้ 0 · ตรวจด้วย `pnpm turbo run typecheck`)
- [ ] **Step 5: รันให้ผ่าน** · `pnpm --filter @dayo/domain test` แล้ว `pnpm turbo run typecheck test`
- [ ] **Step 6: commit** · `feat(domain): add bot cash and drawer expenses to expected cash (R-m1, D102)`

### Task 2: `ZInput`/`ZSnapshot` กลุ่ม `central` + เลข Z จากพื้นของ E1

ผู้ทำ: domain-engineer (opus) · สเปก §4.10 `z_report` · ลำดับ `z_no` (R3-B) · §6.6 เลขใบปิดกะ (R4-1) · ruling R7, R8 · รอ T1

**Files:**
- Modify: `packages/domain/src/shift.ts`, `packages/domain/src/index.ts`
- Create: `packages/domain/test/z-report-block3.test.ts`

**Interfaces:**
- Produces:

```ts
export type ZBotBill = { orderNo: string; version: number; totalSatang: number }
export type ZPosBill = { posOrderId: string; receiptNo: string; paymentCode: string; totalSatang: number; soldAt: string; voidedAt: string | null }
export type ZCentral = {
  countedAt: string                                  // shift.counted_at (§6.8 step 1) · = botWindow.until
  botWindow: { after: string; until: string }        // ruling R3
  botBills: ZBotBill[]                               // ≤ 500 · Σ totalSatang = cash.botCashSatang
  posBills: ZPosBill[]                               // every POS bill of the shift (voided and off-catalog included) · ≤ 2000
  movementIds: string[]                              // every cash_movement id of the shift with createdAt ≤ countedAt · ≤ 500
  centralBase: { zNo: number; hash: string | null } | null // ruling R8: set only on the first Z chained from E1's last_z_no
}
// ZInput gains: countedAt?: string (local display) · central?: ZCentral  (both optional: a local_only Z has neither)
export const MAX_Z_POS_BILLS = 2000, MAX_Z_BOT_BILLS = 500, MAX_Z_MOVEMENT_IDS = 500
export const CASH_PAYMENT_CODE = 'cash' // dayo payment code of cash (plan 07 PAYMENT_CODE.CASH)
export function nextZNumber(localLast: { zNo: number; hash: string } | null, floor: { zNo: number; hash: string | null } | null):
  { zNo: number; prevHash: string | null; centralBase: { zNo: number; hash: string | null } | null }
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** (`z-report-block3.test.ts`)
  - `buildZReport` กับ `central` ที่ถูกต้อง → snapshot มี `central` ตรงตัว · แฮชเปลี่ยนเมื่อแก้บิลบอทหนึ่งใบ (กลุ่มนี้อยู่ในแฮช)
  - `buildZReport` แบบไม่มี `central` → snapshot **ไม่มีคีย์** `central` (ไม่ใช่ `undefined` ที่ canonicalJson อาจเขียน) · แฮชของ snapshot แบบแผน 3b เดิม (fixture ที่คัดลอกจากเทสต์เดิม) ยังเท่าเดิม
  - ปฏิเสธ (`RangeError`): Σ `botBills.totalSatang` ≠ `cash.botCashSatang` · Σ `posBills.totalSatang` ของ `paymentCode === 'cash'` ≠ `cash.cashSalesSatang` · `botWindow.until` ≠ `countedAt` · `after` ≥ `until` · บิล POS ที่ `soldAt` > `countedAt` · `movementIds` ซ้ำ · เกินเพดานรายการ · `cash.drawerExpensesSatang` ≠ 0 (ก้อน 3 · ข้อความ "block 3: drawer expenses must be 0") · `posOrderId` ซ้ำ
  - `nextZNumber`: ไม่มีทั้งสอง → `{zNo:1, prevHash:null, centralBase:null}` · มีแค่ในเครื่อง `{zNo:4,hash:h4}` → `{5, h4, null}` · มีแค่พื้น `{7, hZ}` → `{8, hZ, {7,hZ}}` · ในเครื่อง 9 พื้น 7 → `{10, h9, null}` · ในเครื่อง 3 พื้น 7 (กู้ไฟล์สำรองเก่า) → `{8, hZ, {7,hZ}}` · พื้น `hash: null` แต่ `zNo` มีค่า → `prevHash: null`
  - `buildZReport(input, prev)` ที่ `input.central.centralBase = {zNo: 7}` และ `prev = {zNo: 7, grandTotalSatang: 0}` ผ่าน (`zNo` = 8)
- [ ] **Step 2: รันให้ล้ม** · `pnpm --filter @dayo/domain test -- z-report-block3`
- [ ] **Step 3: แก้ `shift.ts`** · เพิ่ม type และค่าคงที่ · ใน `buildZReport` ตรวจกลุ่ม `central` เมื่อมี · สร้าง snapshot ด้วยรายการฟิลด์ชัดเจนแบบเดิม (M-5) และใส่ `countedAt`/`central` **เฉพาะเมื่อมี** (spread แบบมีเงื่อนไข) · `nextZNumber` เป็นฟังก์ชันบริสุทธิ์
- [ ] **Step 4: รันให้ผ่าน** · `pnpm --filter @dayo/domain test` · `pnpm turbo run typecheck test`
- [ ] **Step 5: commit** · `feat(domain): freeze central z_report parts into the Z snapshot (R7, R8)`

### Task 3: ตัวแปลงแถวกะ `shift-rows.ts` (สตางค์ → `data` บาทของ E2)

ผู้ทำ: domain-engineer (opus) · สเปก §4.10 ตาราง `shift_open` `cash_movement` `cash_count` `shift_close` + `z_report` · §4.2 · รอ T2 และ T5 (schema)

**Files:**
- Create: `packages/domain/src/shift-rows.ts`, `packages/domain/test/shift-rows.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `ShiftOpenData`, `CashMovementData`, `CashCountData`, `ShiftCloseData` (T5) · `edgeSatangToBaht` · `ZSnapshot` (T2)
- Produces:

```ts
export function buildShiftOpenData(s: { shiftId: string; businessDate: string; openedAt: string; openedBy: string; openingFloatSatang: number; quickOpen: boolean }): ShiftOpenData
export function buildCashMovementData(m: { id: string; shiftId: string; kind: CashKind; amountSatang: number; orderId: string | null; reason: string | null; createdBy: string; createdAt: string }): CashMovementData
export function buildCashCountData(c: { countId: string; shiftId: string; lines: CashCountLine[]; countedSatang: number; countedBy: string; countedAt: string }): CashCountData
export function buildShiftCloseData(z: { snapshot: ZSnapshot; hash: string; prevHash: string | null; countId: string }): ShiftCloseData
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** (`shift-rows.test.ts`) · ทุกผลต้องผ่าน `<Schema>.parse` ของ T5
  - `buildCashCountData`: บรรทัด 9 ชนิดเรียง 1000→1 (`denomination` เป็นบาทจำนวนเต็ม: `100_000` สตางค์ → `1000`) · `counted` = Σ · ขาดบางชนิด = count 0
  - `buildCashMovementData`: `VOID_REFUND` มี `pos_order_id` และ `reason` null ได้ · `PAID_OUT` ไม่มี `reason` = `RangeError`
  - `buildShiftCloseData` จาก snapshot ตัวอย่าง: `z_report.cash` 8 ช่องบาท (`drawer_expenses: 0`) · `counted` = snapshot `countedCashSatang` เป็นบาท · `variance_alert` = บาทของ `varianceAlertSatang` · `chain_warning` = `snapshot.chainWarning !== null` · `bot_window` = `central.botWindow` · `pos_bills[].payment` = `paymentCode` · `bot_bills[].total` บาท · `z_no` · `hash` · `prev_hash` · `closed_by`/`closed_at`/`variance_reason` จาก snapshot · ไม่มี `expected`/`variance` ในผลเลย (`JSON.stringify` ไม่มีคำว่า `"expected"`)
  - snapshot ที่ไม่มี `central` → `RangeError` ("local_only Z cannot be sent")
  - property test: สุ่ม snapshot ที่สอดคล้อง → `ShiftCloseData.parse` ผ่าน และ Σ `bot_bills.total` = `cash.bot_cash` ทุกครั้ง (บาทเทียบเป็นสตางค์ด้วย `edgeBahtToSatang`)
- [ ] **Step 2: รันให้ล้ม**
- [ ] **Step 3: เขียน `shift-rows.ts`** · แปลงเงินด้วย `edgeSatangToBaht` เท่านั้น · ห้าม import `bahtToSatang` (เทสต์ guard ของแผน 07 T1 ครอบ `packages/domain/src/{price-cart,order-row,order-draft}.ts` · **เพิ่ม `shift-rows.ts` และ `off-catalog.ts` เข้ารายการของ `money-edge-guard.test.ts`**)
- [ ] **Step 4: รันให้ผ่าน**
- [ ] **Step 5: commit** · `feat(domain): build block 3 push rows from frozen shift data`

### Task 4: บิลนอกแคตตาล็อก `off-catalog.ts`

ผู้ทำ: domain-engineer (opus) · สเปก §4.10 `order_off_catalog` (ตาราง + กติกา) · R-m3 · D97 · ruling R9 · รอ T3

**Files:**
- Create: `packages/domain/src/off-catalog.ts`, `packages/domain/test/off-catalog.test.ts`
- Modify: `packages/domain/src/index.ts`, `packages/domain/test/money-edge-guard.test.ts`

**Interfaces:**
- Consumes: `OrderOffCatalogData` (T5) · `OrderRowData` (แผน 07 T5) · `bangkokDateOf`
- Produces:

```ts
export type FrozenBillLine = { menuCode: string | null; nameTh: string; size: string | null; sweetness: string | null; qty: number; unitPriceSatang: number; discountPerCupSatang: number; lineTotalSatang: number }
export function buildOffCatalogData(i: {
  orderRow: OrderRowData          // current row_json of the rejected `order` row (after RENUMBER / REMAP if any)
  lines: FrozenBillLine[]         // order_item rows, lineNo order
  totalSatang: number             // order.total_satang = what was collected (never changes)
  closedBy: string; closedAt: string; reason: string; originalReason: string
}): OrderOffCatalogData
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**
  - บิลธรรมดา 2 บรรทัดไม่มีส่วนลด → `totals.total` = ยอดที่เก็บ · `bill_discount: 0`
  - บรรทัดที่ส่วนลดหารไม่ลงตัว (unit 35.00 × 3 แก้ว · line_total 99.25) → `discount_per_cup` = floor · เศษไปที่ `bill_discount` · `line_total = (unit_price − discount_per_cup) × qty` ทุกบรรทัด · `total` = ยอดที่เก็บ
  - โปร bundle/ซื้อ N แถม M ที่ทำให้บรรทัดเป็น 0 → `line_total: 0` ผ่าน
  - `sale_date` = วันที่ไทยของ `sold_at` **เสมอ** แม้ `orderRow.sale_date` ต่าง (ทางตัน (ก) §6.4)
  - `original_reason` ไม่ตรง `^[A-Z_]{1,40}$` = `RangeError` · `reason` ว่าง/เกิน 200 code point = `RangeError` · `closedAt` < `sold_at` = `RangeError`
  - property test: ตะกร้าสุ่มที่คิดราคาด้วย `priceCart` ของแผน 07 → `buildOffCatalogData` → `OrderOffCatalogData.parse` ผ่าน · `total` (บาท → สตางค์) = ยอดที่เก็บ · `items_discount + bill_discount ≤ items_subtotal`
  - `money-edge-guard.test.ts` ครอบ `off-catalog.ts` และ `shift-rows.ts`
- [ ] **Step 2: รันให้ล้ม**
- [ ] **Step 3: เขียน `off-catalog.ts`** · ช่องที่ "ตามแถว `order`" (`receipt_no` `queue_no` `sold_at` `channel` `payment` `staff_id` `catalog_version` `shift_id` `note`) คัดจาก `orderRow` ตรงตัว · `lines[].code` = `menuCode` (≤ 40 · null ได้) · `name` = `nameTh` ตัดเป็น 100 code point ด้วย `clipCodePoints`
- [ ] **Step 4: รันให้ผ่าน** · `pnpm turbo run typecheck test`
- [ ] **Step 5: commit** · `feat(domain): build order_off_catalog rows from frozen bills (D91, D97)`

---

## 3. สาย B · สัญญา fixture mock (`packages/contracts`, `packages/dayo-mock`)

### Task 5: zod ของชนิดใหม่ E2 · E4 · E1 client · enum (ล็อกก่อนทุกสาย)

ผู้ทำ: domain-engineer (opus) · สเปก §4.10 ก้อน 3 ทั้งหมด · §4.4 ข้อ 6 (R4-1) · §4.6 (`off_catalog`) · C11 · C13 · รอ: ก้อน 2 สาย B merge แล้ว

**Files:**
- Modify: `packages/contracts/src/dayo-api.ts` (ส่วนใหม่ "ก้อน 3" ท้ายไฟล์ + แก้ `PUSH_KINDS` `PushRow` `KNOWN_REJECT_REASONS` `ClientInfo` `CentralOrder`), `packages/contracts/src/enums.ts`, `packages/contracts/test/dayo-api.test.ts`
- Create: `packages/contracts/test/dayo-api-block3.test.ts`

**Interfaces:**
- Produces (ทุกสายใช้):

```ts
// enums.ts
OutboxStatus = ['pending', 'sent', 'dead', 'local_only', 'closed_off_catalog']
EventType += 'CLOSED_OFF_CATALOG', 'DELIVERED_ELSEWHERE'
ShiftStatus = ['open', 'counted', 'closed']
// dayo-api.ts
export const BILL_KINDS = ['order', 'order_void', 'order_off_catalog'] as const
export const SHIFT_KINDS = ['shift_open', 'cash_movement', 'cash_count', 'shift_close'] as const
export const PUSH_KINDS = [...BILL_KINDS, ...SHIFT_KINDS] as const
export const ID_FIELD = { order: 'pos_order_id', order_void: 'pos_order_id', order_off_catalog: 'pos_order_id', shift_open: 'shift_id', cash_movement: 'movement_id', cash_count: 'count_id', shift_close: 'shift_id' } as const satisfies Record<PushKind, string>
export function laneOf(kind: PushKind): 'bill' | 'shift'
export const KNOWN_REJECT_REASONS = ['INVALID', 'BAD_KEY', 'UNKNOWN_CODE', 'UNKNOWN_STAFF', 'CONFLICT', 'FORBIDDEN'] as const // C13: ALREADY_PRESENT removed
export const DETAIL_PREFIXES = ['off_catalog_exists:', 'exists:', 'receipt_taken:', 'key_changed:', 'counted:', 'z_no_taken:', 'scope:', 'role:', 'rule:'] as const
export type DetailPrefix = (typeof DETAIL_PREFIXES)[number]
export function detailPrefix(detail: string | undefined | null): DetailPrefix | null // longest match first ('off_catalog_exists:' before 'exists:')
export const DENOMINATIONS_BAHT = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const
export const ShiftOpenData, CashMovementData, CashCountData, ZCashData, ZReportData, ShiftCloseData,
  OffCatalogLine, OffCatalogTotals, OrderOffCatalogData                    // strict (what the tablet SENDS)
export const ShiftOpenAccepted, CashMovementAccepted, CashCountAccepted, ShiftCloseAccepted, OrderOffCatalogAccepted, ExistsConflictData // loose (what it RECEIVES)
export const ShiftCashBill, ShiftCashData, ShiftCashResponse              // E4 · loose
// ClientInfo += last_z_no: int ≥ 1 | null (optional) · last_z_hash: /^[0-9a-f]{64}$/ | null (optional)
// CentralOrder += off_catalog: boolean (optional)
// PushRow = discriminated union of 7 kinds; refine: key === rowKey(kind, data[ID_FIELD[kind]])
```

กติกา schema (ตรงตาราง §4.10 · ห้ามตีความใหม่):
- `ShiftOpenData` strict: `shift_id` Uuid · `business_date` Ymd · `opened_at` IsoSent · `opened_by` Uuid · `opening_float` Baht · `quick_open` bool · refine `business_date === bangkokDateOf(opened_at)`
- `CashMovementData` strict: `movement_id` `shift_id` Uuid · `kind` enum 4 ค่า · `amount` Baht > 0 · `pos_order_id` Uuid | null · `reason` Text200 | null · `created_by` Uuid · `created_at` IsoSent · refine: `pos_order_id !== null` ⇔ `kind === 'VOID_REFUND'` · `reason` บังคับเมื่อไม่ใช่ `VOID_REFUND`
- `CashCountData` strict: `count_id` `shift_id` Uuid · `lines` ยาว 9 `{denomination ∈ DENOMINATIONS_BAHT, count: int 0-99999}` ชนิดละหนึ่ง · `counted` Baht = Σ (ตรวจเป็นสตางค์ด้วย `edgeBahtToSatang` ไม่ใช่ float) · `counted_by` Uuid · `counted_at` IsoSent
- `ZCashData` strict 8 ช่อง Baht (`opening_float` `pos_cash_sales` `void_refunds` `paid_in` `paid_out` `drops` `drawer_expenses` `bot_cash`)
- `ZReportData` strict: `z_no` int ≥ 1 · `hash` hex64 · `prev_hash` hex64 | null · `variance_alert` Baht · `chain_warning` bool · `cash` ZCashData · `counted` Baht · `bot_window` strict `{after, until}` IsoSent (`after < until`) · `movement_ids` Uuid[] ≤ 500 · `bot_bills` strict `[{order_no, version, total}]` ≤ 500 · `pos_bills` strict `[{pos_order_id, receipt_no, payment, total, sold_at, voided_at}]` ≤ 2000 · refine Σ `bot_bills.total` = `cash.bot_cash` (สตางค์)
- `ShiftCloseData` strict: `shift_id` `count_id` `closed_by` Uuid · `closed_at` IsoSent · `variance_reason` Text200 | null · `z_report` ZReportData
- `OrderOffCatalogData` strict: ช่องตามแถว `order` (ชนิดเดียวกับ `OrderRowData` ของแผน 07) + `lines` 1-50 strict `{code ≤ 40 | null, name 1-100, size ≤ 20 | null, sweetness ≤ 10 | null, qty 1-999, unit_price, discount_per_cup, line_total}` + `totals` strict 4 ช่อง + `closed_by` Uuid + `closed_at` IsoSent + `reason` Text200 (1-200) + `original_reason` `^[A-Z_]{1,40}$` · refine: สูตร `line_total` · `items_subtotal` · `items_discount` · `total = max(0, …)` · `items_discount + bill_discount ≤ items_subtotal` · `sale_date === bangkokDateOf(sold_at)` · `closed_at ≥ sold_at`
- `ExistsConflictData` loose: `{order_no: string, version: int, reported_total: number ≥ 0, payment_is_cash: bool, off_catalog: bool}`
- `ShiftCashData` loose: `{bills: [{order_no, version, source, sold_at, total, created_by_name: string | null}], cash_total}`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** (`dayo-api-block3.test.ts` · หนึ่ง `it` ต่อข้อ)
  - ทุก schema: ตัวอย่างถูกต้องผ่าน · ฟิลด์เกินใน strict ไม่ผ่าน · ทุกข้อ refine มีเคสไม่ผ่าน
  - `PushRow`: `shift_open` ที่ key `shift_open:<shift_id>` ผ่าน · key ใช้ uuid อื่น ไม่ผ่าน · `cash_count` ใช้ `count_id` · `order_off_catalog` ใช้ `pos_order_id`
  - `detailPrefix('off_catalog_exists:L260925-3 …') === 'off_catalog_exists:'` · `detailPrefix('exists:L…') === 'exists:'` · `detailPrefix('ใบเสร็จชน')` = null · `detailPrefix(undefined)` = null
  - `KNOWN_REJECT_REASONS` ไม่มี `'ALREADY_PRESENT'`
  - `ClientInfo` ไม่มี `last_z_no` ผ่าน (dayo ก่อนก้อน 3) · `last_z_no: 0` ไม่ผ่าน · `last_z_hash` ตัวใหญ่ไม่ผ่าน
  - `laneOf('cash_count') === 'shift'` · `laneOf('order_off_catalog') === 'bill'`
  - `ShiftCashResponse` รับฟิลด์ไม่รู้จัก · `created_by_name: null` ผ่าน
  - `dayo-api.test.ts` เดิม: เทสต์ที่อ้าง `ALREADY_PRESENT` หรือ `PUSH_KINDS` 2 ชนิด แก้ตาม
- [ ] **Step 2: รันให้ล้ม** · `pnpm --filter @dayo/contracts test`
- [ ] **Step 3: เขียน schema** · เงินรับตัวเลขบาทตาม `Baht` เดิมของแผน 07 · ตรวจผลรวมด้วย `edgeBahtToSatang` จาก `@dayo/domain`? **ไม่ได้** (contracts ต้องไม่ขึ้นกับ domain) → ใช้ตัวช่วยภายใน `bahtCents(x) = Math.round(x * 100)` ที่ใช้เฉพาะเทียบผลรวมใน refine (ค่า `Baht` ถูกตรวจแล้วว่ามีไม่เกิน 2 ตำแหน่ง) พร้อมคอมเมนต์ว่าไม่ใช่ตัวแปลงเงินของแท็บเล็ต
- [ ] **Step 4: รันให้ผ่าน** · `pnpm turbo run typecheck test` (สาย C/D ของก้อน 2 ที่ใช้ `PUSH_KINDS` ต้องยังผ่าน · ถ้า `isRowSupported`/ตัวส่งเดิมวนทุก `PUSH_KINDS` ให้ตรวจว่าชนิดใหม่ยังไม่มีผู้เขียน จึงไม่มีแถวชนิดใหม่ในคิว)
- [ ] **Step 5: commit** · `feat(contracts): lock block 3 push kinds, E4 and detail prefixes (C11, C13)`

### Task 6: fixture สัญญาของชนิดใหม่และ E4 (POS เป็นเจ้าของ · D84)

ผู้ทำ: domain-engineer (opus) · สเปก §4.11 ข้อ 2 ("ก้อน 3 เพิ่ม fixture ของชนิดใหม่ทุกชนิดและ E4") · รอ T5

**Files:**
- Create: `packages/contracts/fixtures/dayo-api/b3-*.json` (รายชื่อด้านล่าง)
- Modify: `packages/contracts/src/dayo-fixture.ts` (`CONTRACT_FIXTURE_NAMES` + ชื่อใหม่), `packages/contracts/test/dayo-fixtures.test.ts`

รายชื่อ (แต่ละไฟล์ = คำขอ + คำตอบตามรูป `PosContractFixture` ของแผน 07 T6 · สร้างจากกติกา §4.10 และจะถูกแทนด้วยคำตอบจริงใน T18):
`b3-e1-client-last-z` · `b3-shift-open-accepted` · `b3-shift-open-duplicate` · `b3-cash-movement-parent-pending` · `b3-cash-movement-void-refund-accepted` · `b3-cash-count-accepted` · `b3-cash-count-counted-conflict` · `b3-shift-close-accepted` · `b3-shift-close-parent-pending` · `b3-shift-close-z-no-taken` · `b3-shift-row-forbidden-scope` (คำขอเดียวมี `order` accepted + `shift_open` `rejected FORBIDDEN scope:`) · `b3-shift-close-role-forbidden` · `b3-off-catalog-accepted` · `b3-off-catalog-rule-forbidden` · `b3-off-catalog-exists-conflict` (มี `data`) · `b3-order-off-catalog-exists-conflict` · `b3-order-receipt-taken-prefix` · `b3-e4-shift-cash` · `b3-e4-shift-cash-empty` · `b3-e3-off-catalog-flag`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** · `dayo-fixtures.test.ts`: ทุกชื่อใหม่มีไฟล์ · ทุกไฟล์ผ่าน schema (คำขอผ่าน `PushRequest` strict · คำตอบผ่าน `PushResponse`/`ShiftCashResponse`/`PosCatalogResponse` และ `data` ของผลผ่าน `*Accepted`/`ExistsConflictData` ตามชนิด) · `detail` ของทุกผล `rejected` ในไฟล์ `b3-*` ขึ้นต้นด้วยคำนำหน้าใน `DETAIL_PREFIXES` · `fixtures:hashes` ครอบไฟล์ใหม่
- [ ] **Step 2: รันให้ล้ม**
- [ ] **Step 3: เขียนไฟล์ JSON** (LF · uuid ตัวเล็ก · เวลามีมิลลิวินาที · บาท 2 ตำแหน่ง) · เพิ่มชื่อใน `CONTRACT_FIXTURE_NAMES`
- [ ] **Step 4: รันให้ผ่าน** · `pnpm --filter @dayo/contracts test` · `pnpm --filter @dayo/contracts fixtures:hashes`
- [ ] **Step 5: commit** · `test(contracts): add block 3 contract fixtures (D84)`

### Task 7: mock รองรับชนิดใหม่ · E4 · พื้นล่าง · เพดาน · scope `shift:write`

ผู้ทำ: sync-engineer (opus) · สเปก §4.10 กติการ่วม · `order_off_catalog` ข้อ 0-2 · E4 · §9 ก้อน 3 (ส่วนที่แท็บเล็ตเห็น) · รอ T6

**Files:**
- Create: `packages/dayo-mock/src/judge-shift.ts`, `packages/dayo-mock/src/judge-off-catalog.ts`, `packages/dayo-mock/src/shift-cash.ts`, `packages/dayo-mock/test/{judge-shift,judge-off-catalog,shift-cash}.test.ts`
- Modify: `packages/dayo-mock/src/{state,judge,handler,server,index}.ts`, `packages/dayo-mock/test/replay.test.ts`

**Interfaces:**
- Produces:

```ts
// state.ts
export const MOCK_DEFAULTS = { offCatalogMaxTotalBaht: 3000 /* Q72 default (owner to confirm) */, block3LiveFrom: null as string | null }
// MockState gains: shifts, cashMovements, cashCounts, zReports (Map by id, owner key) · posPushRejections: Set<`${posOrderId}|${reason}`> (shop-wide · R3-C)
//   · settings { block3LiveFrom: string | null; offCatalogMaxTotalBaht: number } · botCashBills: { orderNo, version, source, soldAt, total, createdByName, createdAt }[]
// controls (tests + HTTP /__mock/*):
mock.setScopes(scopes: string[])                // /__mock/set-scopes · default adds 'shift:write'
mock.addBotCashBill(b)                          // /__mock/add-bot-cash-bill
mock.setBlock3LiveFrom(ymd: string | null)      // /__mock/set-live-from
mock.setOffCatalogMaxTotal(baht: number)        // /__mock/set-off-catalog-max
mock.receivedRows(kind?: PushKind)              // /__mock/state · what the mock stored (e2e asserts the z_report payload)
```

กติกาที่ mock ต้องทำ (ย่อจาก §4.10 · ลำดับตรวจตาม §4.5 ข้อ 6 + (ก)(ข) ของก้อน 3):
1. key regex เดิม · ช่อง id ตาม `ID_FIELD` · ชนิดกะและ key ไม่มี `shift:write` → `rejected FORBIDDEN "scope: …"` (บิลในคำขอเดียวกันยังผ่าน)
2. เวลา: ช่องเวลาหลักเกินเวลา mock + 5 นาที = `deferred CLOCK_AHEAD` · เก่ากว่า − 60 วัน = `rejected INVALID` (ยกเว้น `order_off_catalog` ใช้กับ `closed_at`)
3. แถวแม่ยังไม่มี = `deferred PARENT_PENDING` · แม่เป็นของ key อื่น = `rejected FORBIDDEN "rule: …"` · id เดิม key เดียวกัน = `duplicate` พร้อม `data` เดิม
4. `cash_count` ของกะที่มีการนับแล้ว = `rejected CONFLICT "counted: …"` · `shift_close`: `count_id` ไม่ตรง / `z_report.counted` ≠ การนับ = `rejected INVALID` · `z_no` ซ้ำใน key = `CONFLICT "z_no_taken: …"` · `z_no` > สูงสุด + 50 = `INVALID`
5. `shift_close` owner: `closed_by` ต้องเป็นพนักงาน role owner active = ไม่งั้น `FORBIDDEN "role: …"` · `quick_open: true` ⇒ `opened_by` owner
6. `shift_open` แรกที่ `accepted` และ `business_date` ≥ วันนี้ของ mock − 1 → ตั้ง `block3LiveFrom` (ครั้งเดียว)
7. แถว `order` ที่ได้ `rejected` → เพิ่ม `(pos_order_id, reason)` ใน `posPushRejections`
8. `order_off_catalog` ข้อ 0 ครบ: hash ของ key · บิลปกติมีแล้ว = `CONFLICT "exists:<order_no>"` + `data` · บิลนอกแคตตาล็อกของ key อื่น = `CONFLICT "off_catalog_exists:<order_no>"` · ไม่มีใน `posPushRejections` / `original_reason` ไม่เคยบันทึก / `sold_at` < 00:00 ไทยของ `block3LiveFrom` (หรือยังว่าง) / `totals.total` > เพดาน = `FORBIDDEN "rule: …"` · ผ่าน → `accepted {order_no, version}` ด้วยตัวออกเลขเดียวกับ `order`
9. แถว `order` ของบิลที่เป็นนอกแคตตาล็อกแล้ว = `CONFLICT "off_catalog_exists:<order_no>"` + `data` · `receipt_no` ชน = `CONFLICT "receipt_taken: …"` (ก้อน 3 เติมคำนำหน้าให้ `order`/`order_void` ด้วย)
10. E4 `GET /v1/pos/shift-cash?after=&until=` (scope `orders:read`): บิลใน `botCashBills` ที่ `createdAt ∈ (after, until]` → `{bills, cash_total}` · `created_by_name` null เมื่อไม่มี `staff:read` · ไม่มี scope = 403
11. E1 `client.last_z_no`/`last_z_hash` = Z เลขสูงสุดของ key ที่ mock เก็บ (null ถ้าไม่มี) · `supported_kinds`/`supported_fields` มีชนิดใหม่ครบ (รวม `lines.denomination` `lines.count` และ `lines.*` ของ `order_off_catalog`)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** · หนึ่ง `it` ต่อข้อ 1-11 · เทสต์ลำดับ: แถวกะที่ไม่มี scope และฟิลด์ไม่รู้จักพร้อมกัน = `UNSUPPORTED` (ขั้นฟิลด์มาก่อน) · `replay.test.ts` เล่นซ้ำ fixture `b3-*` ครบ
- [ ] **Step 2: รันให้ล้ม** · `pnpm --filter @dayo/dayo-mock test`
- [ ] **Step 3: เขียนโค้ด** · `judge.ts` เดิมแยกตามชนิดไปที่ `judge-shift.ts`/`judge-off-catalog.ts` · ครอบทุกแถวด้วย try/catch เดิม (A3 ข้อ 9)
- [ ] **Step 4: รันให้ผ่าน** · `pnpm turbo run typecheck test`
- [ ] **Step 5: commit** · `feat(dayo-mock): judge block 3 kinds and serve E4`

---

## 4. สาย C · ฐานในเครื่อง การส่ง และ API ใน Worker

### Task 8: ฐานในเครื่อง migration `0006_block3_shift_central.sql`

ผู้ทำ: sync-engineer (opus) · สเปก §6.1 · §6.8 ข้อ 4 · ruling R1-R4 · รอ T5 (enum) และ R13

**Files:**
- Create: `packages/db-schema/drizzle/sqlite/0006_block3_shift_central.sql` (+ `meta/0006_snapshot.json`, `meta/_journal.json`), `packages/db-schema/test/block3.test.ts`
- Modify: `packages/db-schema/src/sqlite/sales.ts`, `packages/db-schema/src/browser/sqlite-migrations.gen.ts`, `packages/db-schema/test/parity.test.ts` (รายการยกเว้นคอลัมน์ที่ไม่มีใน pg)

**Interfaces:**
- Produces: `s.shift.syncMode` (`'central' | 'local_only'`, not null default `'local_only'`) · `s.shift.countedAt` · `s.shift.countedBy` · `s.cashCount.botCashIncluded` (bool | null) · `s.order.centralOffCatalog` (bool | null) · `s.order.centralElsewhereJson` (json | null)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** (`block3.test.ts`)
  - ฐานที่ migrate ถึง `0005` แล้วมีกะที่ปิดพร้อม `cash_count` → หลัง `0006`: `shift.counted_at` = `cash_count.created_at` · `sync_mode = 'local_only'` · จำนวนแถวทุกตารางเท่าเดิม · `foreign_key_check` ว่าง
  - เปิดกะใหม่ได้ขณะอีกกะเป็น `counted` (index `shift_open_uq` ดูแค่ `open`) · สองกะ `open` ยังชน
  - `sync_mode = 'x'` → CHECK · อัปเดต `order.central_off_catalog` ของบิลที่จ่ายแล้วได้ (trigger ไม่ raise · แบบ `central_order_no`) · `z_report` ยัง append-only
- [ ] **Step 2: รันให้ล้ม** · `pnpm --filter @dayo/db-schema test -- block3`
- [ ] **Step 3: เขียน migration + schema** · `alter table shift add column sync_mode text not null default 'local_only' check (sync_mode in ('central','local_only'))` · `counted_at text` · `counted_by text references user(id)` · `alter table cash_count add column bot_cash_included integer` · `alter table "order" add column central_off_catalog integer` · `central_elsewhere_json text` · backfill `update shift set counted_at = (select c.created_at from cash_count c where c.shift_id = shift.id) where status = 'closed'` · สร้าง `sqlite-migrations.gen.ts` ใหม่ด้วยสคริปต์เดิมของแพ็กเกจ (ห้ามแก้มือ)
- [ ] **Step 4: รันให้ผ่าน** · `pnpm --filter @dayo/db-schema test` · `pnpm turbo run typecheck test`
- [ ] **Step 5: commit** · `feat(db-schema): add block 3 shift sync mode and count columns`

### Task 9: พื้นเลข Z จาก E1 + ตัวคุย E4

ผู้ทำ: sync-engineer (opus) · สเปก §4.4 ข้อ 6 (R4-1) · §6.6 · §4.10 E4 · ruling R8 · รอ T8 (และ T7 สำหรับเทสต์ที่ใช้ mock)

**Files:**
- Modify: `apps/pos/src/sync/dayo-client.ts`, `apps/pos/src/sync/catalog.ts`, `apps/pos/src/sync/state.ts` (`DAYO_KEYS.zFloor`), `apps/pos/src/api/connect.ts`
- Create: `apps/pos/test/z-floor.test.ts`, `apps/pos/test/shift-cash-client.test.ts`

**Interfaces:**
- Produces:

```ts
// dayo-client.ts — DayoClient gains:
getShiftCash(q: { after: string; until: string }): Promise<Timed<ShiftCashData>>   // GET /v1/pos/shift-cash · same errors/timeout as listOrders
// state.ts
DAYO_KEYS.zFloor = 'dayo.z_floor'                                                   // JSON {zNo, hash} · max ever seen
export async function readZFloor(db: RemoteDb): Promise<{ zNo: number; hash: string | null } | null>
export async function raiseZFloor(tx: RemoteDb, client: { last_z_no?: number | null; last_z_hash?: string | null } | null): Promise<void> // keeps the larger zNo
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**
  - `shift-cash-client.test.ts`: mock มีบิลบอทเงินสด 3 ใบ (ใบหนึ่ง `created_at` = `until` พอดี · ใบหนึ่ง = `after` พอดี) → ได้ 2 ใบ (`(after, until]`) · 401/403/404/429/timeout ได้ `DayoError` ชนิดเดิมของแผน 07 T9 · query string ใช้ ISO ที่ encode แล้ว
  - `z-floor.test.ts`: E1 ที่มี `last_z_no: 7, last_z_hash: h` → `readZFloor` = `{7, h}` · E1 ถัดไป `last_z_no: 5` ไม่ลดพื้น · E1 ไม่มีฟิลด์ (dayo ก่อนก้อน 3) = ไม่เปลี่ยน · `connect` (เชื่อมเครื่องเดิม) ตั้งพื้นในธุรกรรมเดียวกับการตั้งเลขใบเสร็จ
- [ ] **Step 2: รันให้ล้ม**
- [ ] **Step 3: เขียนโค้ด** · `writeCatalogAnswer` เรียก `raiseZFloor` ทุกครั้งที่มี `client` · `connect`/`recoverOwner` เรียกด้วย
- [ ] **Step 4: รันให้ผ่าน** · `pnpm --filter @dayo/pos test` · `pnpm turbo run typecheck test`
- [ ] **Step 5: commit** · `feat(pos): keep the central Z floor and fetch bot cash bills (R4-1, E4)`

### Task 10: ผู้เขียนแถวกะ เงินสด และบิล เลือกส่งหรือ `local_only` ตามกะ

ผู้ทำ: sync-engineer (opus) · สเปก §4.10 หลักข้อ 4 · ลำดับ ช่อง และแถวแม่ · §6.1 · ruling R1, R2 · รอ T3, T9

**Files:**
- Modify: `apps/pos/src/db/outbox.ts`, `apps/pos/src/api/shift.ts`, `apps/pos/src/api/cash.ts`, `apps/pos/src/api/void.ts`, `apps/pos/src/api/sale.ts`, `apps/pos/src/api/types.ts`, `apps/pos/src/api/errors.ts`
- Create: `apps/pos/test/shift-central.test.ts`
- Modify tests: `apps/pos/test/{shift,quick-open,cash-movement,cancel-sale,record-sale,pending-sync}.test.ts` (แถวของกะ `central`)

**Interfaces:**
- Consumes: `buildShiftOpenData`, `buildCashMovementData` (T3) · `readSupported` · `SHIFT_KINDS`, `rowKey`
- Produces:

```ts
// db/outbox.ts — PushRowInput gains:
| { kind: 'shift_open'; id: string; data: ShiftOpenData; parentKey: null }
| { kind: 'cash_movement'; id: string; data: CashMovementData; parentKey: `shift_open:${string}` }
| { kind: 'cash_count'; id: string; data: CashCountData; parentKey: `shift_open:${string}` }
| { kind: 'shift_close'; id: string; data: ShiftCloseData; parentKey: `cash_count:${string}` }
| { kind: 'order_off_catalog'; id: string; data: OrderOffCatalogData; parentKey: null }
export async function cascadeLocalOnly(tx: RemoteDb, parentKey: string): Promise<number> // ruling R12: every descendant pending/dead → local_only
// api/shift.ts
export async function shiftSyncMode(db: RemoteDb): Promise<'central' | 'local_only'> // ruling R1
export async function enqueueShiftRow(tx: RemoteDb, deps: ApiDeps, shift: { id: string; syncMode: 'central' | 'local_only' }, row: …): Promise<void> // central → enqueuePush · local_only → enqueueLocalOnly (block 2 tables)
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** (`shift-central.test.ts`)
  - E1 ที่ `supported_kinds` มีชนิดกะครบ → `openShift` ได้ `sync_mode = 'central'` และแถว outbox `shift_open:<id>` `pending` ที่ `rowJson` ผ่าน `ShiftOpenData` (บาท) · `quickOpenShift` ได้ `quick_open: true`
  - E1 เก่า (ไม่มีชนิดกะ) → `local_only` + แถว `shift:<id>` เป็น `local_only` เหมือนก้อน 2
  - กะ `central`: `recordCashMovement` → `cash_movement:<id>` parent `shift_open:<shift_id>` · `cancelSale` เงินสด → `VOID_REFUND` เป็นแถว push มี `pos_order_id` · `recordSale` → `order.row_json.shift_id` = id กะ
  - กะ `local_only`: `recordSale` ส่ง `shift_id: null` (คงเดิม) · `VOID_REFUND` เป็น `local_only`
  - กะที่ `sync_mode` เปลี่ยนไม่ได้หลังเปิด (E1 ใหม่ระหว่างกะไม่มีผล)
  - `cascadeLocalOnly('shift_open:X')` เปลี่ยนลูกและหลาน (`cash_count` → `shift_close`) เป็น `local_only` · ไม่แตะแถว `sent`
  - `countPendingSyncItems` นับแถวชนิดกะที่ `pending` ด้วย (ป้าย "ยังไม่ส่ง" · §6.1) แต่ไม่นับ `local_only`/`closed_off_catalog`
- [ ] **Step 2: รันให้ล้ม**
- [ ] **Step 3: เขียนโค้ด** · ผู้เขียนเรียก `enqueueShiftRow` ทุกจุด · ไม่มีจุดใดเรียก `enqueuePush` ชนิดกะตรง ๆ นอก `enqueueShiftRow`
- [ ] **Step 4: รันให้ผ่าน** · `pnpm turbo run typecheck test`
- [ ] **Step 5: commit** · `feat(pos): queue shift and cash rows for central shifts only (R1)`

### Task 11: นับเงินและออก Z ตาม D101 (ออนไลน์/ออฟไลน์)

ผู้ทำ: sync-engineer (opus) · ผู้ตรวจเพิ่ม **security-reviewer** · สเปก §6.8 ทั้งส่วน · §4.10 E4 · "เงินสดที่ควรมี (ล็อก)" · `z_report` · D101 · D102 · D53-D55 (คงเดิม) · ruling R2-R8 · รอ T2, T10

**Files:**
- Modify: `apps/pos/src/api/close.ts`, `apps/pos/src/api/shift-report.ts`, `apps/pos/src/api/types.ts`, `apps/pos/src/api/pos-api.ts`, `apps/pos/src/api/errors.ts`, `apps/pos/src/sync/scheduler.ts` (ปลุก `before_close` หลังบันทึก)
- Create: `apps/pos/test/count-offline.test.ts`, `apps/pos/test/close-central.test.ts`
- Modify tests: `apps/pos/test/{close-shift,shift-report,backup}.test.ts`, `apps/pos/test/helpers/shift.ts`

**Interfaces:**
- Produces (สาย D ใช้):

```ts
export type MarkCountedInput = { actorUserId: string }
export async function markCounted(db, deps, i: MarkCountedInput): Promise<{ shiftId: string; countedAt: string }> // "นับเสร็จ" · idempotent: second call returns the same countedAt
export type BotCashDto = { online: true; bills: { orderNo: string; source: string; soldAt: string; totalSatang: number; createdByName: string | null }[]; totalSatang: number; window: { after: string; until: string }; fingerprint: string } | { online: false }
export async function botCashForShift(ctx: SyncContext, shiftId: string): Promise<BotCashDto> // network OUTSIDE serial · local_only shift → { online: true, bills: [], totalSatang: 0, … } (R5)
export type CountFiguresDto = ShiftReportDto & { countedAt: string; botCash: BotCashDto; expectedCashSatang: number; botCashIncluded: boolean }
export async function countFigures(ctx: SyncContext, shiftId: string): Promise<CountFiguresDto>
export type ConfirmCountInput = { shiftId: string; actorUserId: string; countLines: CashCountLine[]; approverUserId: string; approverPin: string }
export async function confirmCountOffline(db, deps, i: ConfirmCountInput): Promise<void> // D101 offline: owner PIN, NO reason · writes cash_count (+ push) with bot_cash_included = 0
export type CloseShiftInput = { shiftId: string; actorUserId: string; countLines: CashCountLine[] | null /* null = count already confirmed offline */
  approverUserId: string; approverPin: string; varianceReason: string | null; bankQrTotalSatang: number | null
  shownExpectedCashSatang: number; shownReportFingerprint: string; shownBotFingerprint: string }
export async function closeShift(ctx: SyncContext, i: CloseShiftInput): Promise<ZReportDto>
// PosErrorCode gains: 'NOT_COUNTED' | 'ALREADY_COUNTED' | 'COUNT_CONFIRMED' | 'NEEDS_ONLINE' | 'BOT_CASH_CHANGED'
```

ลำดับใน `closeShift` (กะ `central`):
1. นอกคิว serial: `botCashForShift` (ออฟไลน์ = `NEEDS_ONLINE` ไม่เขียนอะไร) · เทียบ `fingerprint` กับ `shownBotFingerprint` (ต่าง = `BOT_CASH_CHANGED` · R6)
2. ตรวจ PIN owner ก่อนเปิดธุรกรรม (argon2 ช้า · แบบเดิม)
3. ธุรกรรมเดียว: กะต้อง `counted` · `buildShiftReport` + fingerprint เดิม (`SHIFT_CHANGED`) · ถ้า `countLines !== null` และยังไม่มี `cash_count` → เขียน `cash_count` (`bot_cash_included = 1`) + push `cash_count` · ถ้ามีแล้ว (`COUNT_CONFIRMED` เมื่อส่ง `countLines` มาอีก) ใช้ยอดนับเดิม · `cashInputsFromMovements(…, { botCashSatang })` · `varianceNeedsReason` (`>=`) ไม่มีเหตุผล = `VARIANCE_REASON_REQUIRED` · โซ่ Z เดิมทุกข้อ + `nextZNumber(localLast, readZFloor)` (R8) · `buildZReport` กับ `central` (`posBills` จาก `order` ของกะ + `payment_code` · `movementIds` ทุกแถวของกะที่ `created_at ≤ counted_at` · `botBills` · `botWindow`) · เขียน `z_report` + `shift.status = 'closed'` · push `shift_close` (`buildShiftCloseData`, parent `cash_count:<count_id>`)
4. หลังธุรกรรม: `scheduler.kick('before_close')`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**
  - `close-central.test.ts` (mock มีบิลบอทเงินสด 3 ใบ ฿40 ฿55 ฿60): เปิดกะ ฿500 → ขายเงินสด ฿100 และ QR ฿80 → `PAID_OUT` ฿20 → `markCounted` → ขายต่อ = `NO_OPEN_SHIFT` · เงินเข้า-ออก = `NO_OPEN_SHIFT` → `countFigures` เงินที่ควรมี = 500 + 100 − 20 + 155 = ฿735 → นับ ฿735 → `closeShift` → Z `cash.botCashSatang = 15500` · outbox มี `cash_count` + `shift_close` ที่ `rowJson` ผ่าน schema และ `bot_bills` 3 ใบ · `z_report.cash` ไม่มีค่าติดลบ · `pos_bills` มีทั้งบิลเงินสดและ QR (`payment` = รหัส dayo)
  - ส่วนต่าง −฿20.00 ไม่มีเหตุผล = `VARIANCE_REASON_REQUIRED` · −฿19.99 ผ่านโดยไม่มีเหตุผล (D102)
  - ขายเงินสด ฿100 แล้วยกเลิกคืนเงิน → `pos_cash_sales` 100 · `void_refunds` 100 · เงินที่ควรมีไม่หักซ้ำ
  - `markCounted` สองครั้ง = `countedAt` เดิม · บิลบอทที่ mock สร้างหลัง `counted_at` ไม่อยู่ใน Z
  - มีบิลบอทใหม่ระหว่างจอแสดงกับกด PIN → `BOT_CASH_CHANGED` ไม่มีแถวใหม่ในฐาน
  - สองกะในวันเดียว: `after` ของกะที่สอง = `counted_at` ของกะแรก · บิลบอทแต่ละใบอยู่ใน Z เดียว
  - `count-offline.test.ts` (D101): ออฟไลน์ → `countFigures.botCashIncluded = false` · `confirmCountOffline` ด้วย PIN owner (ไม่ถามเหตุผลแม้ส่วนต่าง ฿50) → `cash_count` `bot_cash_included = 0` + push `cash_count` · เปิดกะถัดไปได้ · `closeShift` ตอนยังออฟไลน์ = `NEEDS_ONLINE` · กลับออนไลน์ → `closeShift({countLines: null, varianceReason: 'ทอนผิด'})` ด้วย PIN อีกครั้ง → Z ใช้ยอดนับเดิม · แถว `shift_open` ของกะใหม่อยู่ก่อน `shift_close` ของกะเก่าใน outbox (ลำดับ `createdAt`)
  - R8: ฐานว่าง + พื้น `{7, h}` → Z แรก `z_no` 8 · `prev_hash` = `h` · Z ที่สองไม่ขึ้น `Z_CHAIN_BROKEN`
  - กะ `local_only` ปิดแบบเดิม (ไม่เรียก E4 · R5) · เทสต์เดิมของแผน 3b ทั้งหมดผ่าน (ปรับให้เรียก `markCounted` ก่อน)
- [ ] **Step 2: รันให้ล้ม** · `pnpm --filter @dayo/pos test -- close-central count-offline close-shift`
- [ ] **Step 3: เขียนโค้ด** · ส่วนตัดสินโซ่ Z เดิม (D53-D55) ย้ายเป็นฟังก์ชันภายใน `chainForNewZ(tx, device, floor)` โดยไม่เปลี่ยนพฤติกรรม · เพิ่ม `centralBase.zNo` เป็นช่องว่างที่รับทราบแล้วใน `unacknowledgedZNoGap`
- [ ] **Step 4: รันให้ผ่าน** · `pnpm turbo run typecheck test`
- [ ] **Step 5: commit** · `feat(pos): split counting from Z issue and include bot cash (D101)`

### Task 12: ตัวส่ง · ช่องกะหนึ่งช่องต่อเครื่อง · `scope:` รอ · ผลตามชนิด

ผู้ทำ: sync-engineer (opus) · ผู้ตรวจเพิ่ม **security-reviewer** · สเปก §6.2 (ช่อง) · §6.3 · §4.10 ลำดับ ช่อง และแถวแม่ · คำนำหน้า `detail` · R-I1 · R2-m1 · R2-m2 · R2-S5 · ruling R10 · รอ T7, T11

**Files:**
- Modify: `apps/pos/src/sync/push.ts`, `apps/pos/src/api/bootstrap.ts` (`SyncStatusDto` ใหม่), `apps/pos/src/api/types.ts`
- Create: `apps/pos/test/push-shift-lane.test.ts`
- Modify tests: `apps/pos/test/{push,sync-status}.test.ts`

**Interfaces:**
- Produces:

```ts
export const SCOPE_HOLD_RETRY_MS = 900_000, SCOPE_HOLD_RED_MS = 86_400_000, SCOPE_HOLD_CLOSE_MS = 604_800_000 // 15 min · 24 h · 7 d (spec §6.2)
// last_error JSON gains: scopeHold?: { since: string } · shiftConflict?: true · data?: unknown (verdict data of a rejected row, e.g. exists:)
// SyncStatusDto gains:
pendingZ: { shiftId: string; businessDate: string; countedAt: string }[]   // counted, no Z yet → "ใบปิดกะ <date> รอออนไลน์"
scopeHold: { since: string; red: boolean; canClose: boolean } | null
shiftConflict: boolean                                                     // CONFLICT key_changed:/counted:/z_no_taken: on a shift kind
elsewhereMismatch: number                                                  // ACK_DELIVERED bills whose central total/cash-ness differ (T13)
```

กติกาเพิ่ม (ของเดิมใน T13 แผน 07 คงทุกข้อ):

| สถานการณ์ | ทำอะไร |
|---|---|
| เลือกแถว | ทุกชนิดใน `PUSH_KINDS` · **ช่องกะ** (`laneOf = 'shift'`): เดินตาม `createdAt, id` · แถวแรกของช่องกะที่ยังส่งไม่ได้ตอนนี้ (`next_attempt_at` ในอนาคต · `scopeHold` · ถูกพักเพราะ `UNSUPPORTED`) → แถวกะหลังจากนั้นทั้งหมดไม่ถูกเลือกรอบนี้ · ช่องบิลเดินต่ออิสระ · แถว `dead`/`local_only`/`closed_off_catalog` ไม่หยุดช่อง |
| แถวลูกรอแม่ | ใช้ `parent_key` เดิมกับทุกชนิด (`cash_movement`/`cash_count` → `shift_open` · `shift_close` → `cash_count` · `order_void` → `order` หรือ `order_off_catalog`) |
| `accepted`/`duplicate` ชนิดกะ | `sent` + `result_json` (`{shift_id}` · `{movement_id}` · `{count_id}` · `{shift_id}`) · ถ้า `data` ไม่ผ่าน schema ของชนิด = ยังถือว่าส่งแล้ว (บันทึก `last_error` เตือน ไม่ส่งซ้ำ) |
| `accepted` `order_off_catalog` | `sent` · `order.central_order_no = data.order_no` · `order.central_off_catalog = 1` |
| แถวใดกลายเป็น `sent` | ลูกที่ `dead PARENT_REJECTED` กลับ `pending` เอง (R-I1 · คงลำดับเดิม) |
| `rejected FORBIDDEN` คำนำหน้า `scope:` | ruling R10: คง `pending` · `scopeHold.since` (เก็บค่าแรก) · `next_attempt_at` = +15 นาที · ไม่นับครั้ง |
| `rejected CONFLICT` `exists:`/`off_catalog_exists:` | `dead` + เก็บ `data` (ผ่าน `ExistsConflictData`) ใน `last_error.data` |
| `rejected CONFLICT` `key_changed:`/`counted:`/`z_no_taken:` ของชนิดกะ | `dead` + `last_error.shiftConflict = true` → `SyncStatusDto.shiftConflict` |
| `rejected` อื่น | `dead` ตามเดิม (ลูก → `PARENT_REJECTED`) |

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** (`push-shift-lane.test.ts` กับ mock ของ T7)
  - กะ `central` ครบวงจรออนไลน์ → ทุกแถว `sent` · mock เก็บ `z_report` ตรงกับ snapshot
  - ตั้ง mock ให้ `cash_count` ได้ `deferred BUSY` ครั้งแรก → `shift_close` ไม่ถูกส่งรอบนั้น · บิลในรอบเดียวกันยังถูกส่ง · รอบถัดไปทั้งคู่ `sent`
  - นับออฟไลน์ → เปิดกะถัดไป → ขาย → ออนไลน์ → ออก Z กะแรก → ทุกแถวของทั้งสองกะ `sent` ไม่มี `CONFLICT` (§9)
  - key ไม่มี `shift:write` → แถวกะ `pending` + `scopeHold` · บิลในคำขอเดียวกัน `sent` · หน้า "ส่งไม่ผ่าน" ว่าง · `mock.setScopes([... 'shift:write'])` + เลื่อนเวลา 15 นาที → ผ่านเอง · ค้าง 24 ชม. → `scopeHold.red` · 7 วัน → `canClose`
  - `order` ถูก `rejected UNKNOWN_CODE` → `order_void` ลูกเป็น `PARENT_REJECTED` → owner remap แล้วแม่ `accepted` → ลูก `pending` เองโดยไม่กดลูก (R-I1)
  - `shift_close` ที่ mock ตอบ `CONFLICT z_no_taken:` → `shiftConflict = true`
  - `order` ที่ mock ตอบ `CONFLICT off_catalog_exists:` พร้อม `data` → `last_error.data.order_no` อ่านจาก `data` ไม่ใช่ `detail`
  - แถว `local_only` ของกะก่อนก้อน 3 ไม่ถูกส่งและไม่ขึ้น "ส่งไม่ผ่าน"
  - `pendingZ` มีกะที่ `counted` แต่ไม่มี Z
- [ ] **Step 2: รันให้ล้ม**
- [ ] **Step 3: เขียนโค้ด** · ตัวเลือกแถวยังอ่านทีละหน้า 200 แถว (review item 20 ของแผน 07) และจำสถานะ "ช่องกะหยุดแล้ว" ข้ามหน้า
- [ ] **Step 4: รันให้ผ่าน** · `pnpm turbo run typecheck test`
- [ ] **Step 5: commit** · `feat(pos): push shift rows in one lane per device (spec 6.2)`

### Task 13: ทางแก้ของ owner ก้อน 3 · "ปิดเป็นบิลนอกแคตตาล็อก" · "รับทราบ" · แถวกะ

ผู้ทำ: sync-engineer (opus) · ผู้ตรวจเพิ่ม **security-reviewer** · สเปก §6.4 ทั้งส่วน · §6.1 `closed_off_catalog` · D91 · D97 · C13 · ruling R11, R12 · รอ T4, T12

**Files:**
- Modify: `apps/pos/src/api/sync-problems.ts`, `apps/pos/src/api/pos-api.ts`, `apps/pos/src/api/types.ts`, `apps/pos/src/api/orders.ts` (ป้าย "นอกแคตตาล็อก" · `central.state = 'off_catalog'`), `apps/pos/src/api/errors.ts`
- Create: `apps/pos/test/off-catalog-remedy.test.ts`
- Modify tests: `apps/pos/test/sync-problems.test.ts`

**Interfaces:**
- Produces (สาย D ใช้):

```ts
export type Remedy = 'RETRY' | 'RENUMBER' | 'REMAP_CODE' | 'REMAP_STAFF' | 'EXCLUDE' | 'CLOSE_OFF_CATALOG' | 'ACK_DELIVERED' | 'RECONFIRM_OWNER' | 'EXPORT'
// SyncProblemDto.kind widens to PushKind · gains: prefix: DetailPrefix | null · shiftConflict: boolean · scopeHold: { since: string } | null
closeAsOffCatalog(i: OwnerApproval & { outboxId: string }): Promise<{ posOrderId: string }>
acknowledgeDelivered(i: OwnerApproval & { outboxId: string }): Promise<{ orderNo: string; mismatch: boolean }>
reconfirmOwner(i: OwnerApproval & { outboxId: string }): Promise<void>   // shift_close FORBIDDEN role: → closed_by = approver
// excludeFromSync (plan 07) now also: shift kinds (ruling R12 cascade) · order_off_catalog · scope-hold rows ≥ 7 d
```

ตารางทางแก้ (ตรง §6.4 · `EXPORT` = "ส่งออก JSON" มีทุกแถว · ทุกปุ่มยกเว้น RETRY/EXPORT = PIN owner + เหตุผล):

| ชนิด · เหตุผล/คำนำหน้า | ปุ่ม |
|---|---|
| `order` · `CONFLICT receipt_taken:` หรือไม่มีคำนำหน้า | RETRY · RENUMBER · CLOSE_OFF_CATALOG |
| `order` · `CONFLICT off_catalog_exists:` | ACK_DELIVERED |
| `order` · `CONFLICT key_changed:` | EXPORT · EXCLUDE |
| `order` · `UNKNOWN_CODE` | RETRY · REMAP_CODE (วิธีชำระเลือกได้เฉพาะฝั่งเดียวกับรหัสเดิม: เงินสด ↔ เงินสด) · CLOSE_OFF_CATALOG |
| `order` · `UNKNOWN_STAFF` | RETRY · REMAP_STAFF · CLOSE_OFF_CATALOG |
| `order` · `INVALID`/`FORBIDDEN`/`BAD_KEY`/อื่น | RETRY · CLOSE_OFF_CATALOG |
| `order`/ชนิดใดก็ได้ · `CLOCK_AHEAD` ล้ำเกิน 24 ชม. (แผน 07 R3/N5) | EXCLUDE |
| `order_off_catalog` · `receipt_taken:` / `exists:` / `key_changed:` / `UNKNOWN_CODE` / `UNKNOWN_STAFF` / `role:` / `rule:` / `INVALID` | RENUMBER / ACK_DELIVERED / EXPORT / REMAP_CODE / REMAP_STAFF / RECONFIRM_OWNER (ปิดใหม่โดย owner) / RETRY + EXCLUDE / EXPORT + EXCLUDE |
| `order_void` · `FORBIDDEN rule:` หรือ `INVALID` (ทางตัน (ค)) | EXCLUDE พร้อมข้อความ "ให้เจ้าของยกเลิกบิล <order_no> บนเว็บ dayo" |
| `shift_open` · ถูกปฏิเสธ | REMAP_STAFF (`opened_by`) · EXPORT · EXCLUDE |
| `cash_movement`/`cash_count`/`shift_close` · `UNKNOWN_STAFF` | REMAP_STAFF (`created_by`/`counted_by`) |
| `shift_close` · `FORBIDDEN role:` | RECONFIRM_OWNER |
| ชนิดกะ · `CONFLICT key_changed:`/`counted:`/`z_no_taken:` | ไม่ใช่บั๊ก: แถบแดง "ข้อมูลกะชนกับระบบกลาง แนะนำให้เจ้าของเปลี่ยนกุญแจเครื่อง" · EXCLUDE |
| ชนิดกะ · เหตุผลอื่น | EXPORT · EXCLUDE |
| `PARENT_REJECTED` | ไม่มีปุ่ม (แก้ที่แม่) |

`closeAsOffCatalog` (ธุรกรรมเดียว): แถวต้อง `dead` ชนิด `order` เหตุผลเป็นคำตัดสิน `rejected` ของ dayo (ไม่ใช่ `ENVELOPE`/`STUCK`/`PARENT_REJECTED`) · แถวเดิม → `closed_off_catalog` · `enqueuePush({kind:'order_off_catalog', …, data: buildOffCatalogData({ orderRow: row.rowJson, lines: order_item, totalSatang: order.total_satang, closedBy: approver.id, closedAt: now, reason, originalReason: <เหตุผลเดิม> })})` · ลูก `order_void` ทุกแถว: `parent_key` → `order_off_catalog:<id>` และ `PARENT_REJECTED` → `pending` · `order_event` `CLOSED_OFF_CATALOG {reason, approvedBy, originalReason}` (เข้าโซ่แฮช) · **ไม่มีแถว `cash_movement` ใด ๆ**

`acknowledgeDelivered`: แถวต้องมี `last_error.data` ผ่าน `ExistsConflictData` · แถว → `sent` + `result_json = data` · `order.central_order_no` · `central_off_catalog = data.off_catalog` · เทียบ `edgeBahtToSatang(data.reported_total)` กับ `order.total_satang` และ `data.payment_is_cash` กับ `payment_code === 'cash'` → ต่าง = `central_elsewhere_json.mismatch = true` (แถบแดง "บิลในระบบกลางไม่ตรงกับเครื่อง") · `order_event` `DELIVERED_ELSEWHERE {order_no}` · ลูกกลับ `pending`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** (`off-catalog-remedy.test.ts` กับ mock)
  - `order` ถูกปฏิเสธ `INVALID` → `closeAsOffCatalog` (PIN owner + เหตุผล) → แถวเดิม `closed_off_catalog` · แถวใหม่ `order_off_catalog` ผ่าน schema · `sent` · `order.central_off_catalog = 1` · ไม่นับในป้าย "ยังไม่ส่ง" · ไม่มีแถว `cash_movement` ใหม่ · Z ของกะยังมีบิลนี้ใน `pos_bills`
  - PIN ไม่ใช่ owner = `NOT_OWNER` ไม่มีอะไรเปลี่ยน · เหตุผลว่าง = `BAD_INPUT` · แถว `ENVELOPE` = `REMEDY_NOT_ALLOWED`
  - บิลที่มี `order_void` รออยู่ → หลังปิด `order_void` ส่งตามแม่ใหม่ และยกเลิกได้ (mock `accepted`)
  - mock ตั้ง `block3LiveFrom` เป็นวันพรุ่งนี้ → `order_off_catalog` ได้ `FORBIDDEN rule:` → ปุ่ม RETRY + EXCLUDE · owner ตั้งเพดานสูงขึ้นบน mock แล้ว RETRY ผ่าน (กรณีเกินเพดาน)
  - `order` เกิน 60 วันถูกปฏิเสธ → ปิดเป็นนอกแคตตาล็อกผ่าน (mock ตั้ง `block3LiveFrom` เก่ากว่า 60 วัน · R3-m5)
  - `order_off_catalog` ของบิลปกติที่มีแล้ว → `CONFLICT exists:` → `acknowledgeDelivered` → `sent` · ยอดตรง = ไม่มีแถบ · mock ตั้งยอดต่าง = `mismatch: true`
  - `EXCLUDE` ของ `shift_open` → แถวกะทั้งสายเป็น `local_only` และช่องกะเดินต่อ (R12)
  - `REMAP_CODE` วิธีชำระจาก `cash` ไป `qr` = `BAD_INPUT` (ห้ามสลับฝั่ง)
  - `KNOWN_REJECT_REASONS` ไม่มี `ALREADY_PRESENT` แล้ว · เทสต์เดิมของแผน 07 ที่อ้างมันถูกแก้
- [ ] **Step 2: รันให้ล้ม**
- [ ] **Step 3: เขียนโค้ด** · ทุกทางแก้ใหม่ใช้ `remedyRow` เดิม (ตรวจ PIN นอกธุรกรรม · ตรวจสถานะแถวในธุรกรรม)
- [ ] **Step 4: รันให้ผ่าน** · `pnpm turbo run typecheck test`
- [ ] **Step 5: commit** · `feat(pos): let owners close rejected bills as off-catalog (D91, D97)`

---

## 5. สาย D · หน้าจอและ e2e

### Task 14: หน้านับเงิน / ปิดกะ / Z ตาม D101

ผู้ทำ: pos-ui-developer (sonnet) · สเปก §6.8 · D101 · D102 · รอ T11

**Files:**
- Modify: `apps/pos/src/screens/{CountScreen,CloseShiftScreen,ZReportScreen,ShiftScreen,ShiftFigures,StatusBanners}.tsx` (+ test ที่มีอยู่), `apps/pos/src/app/queries.ts`, `apps/pos/src/ui/th.ts`, `apps/pos/src/ui/errors.ts`, `apps/pos/src/router.tsx`
- Create: `apps/pos/src/screens/BotCashPanel.tsx`, `apps/pos/src/screens/BotCashPanel.test.tsx`

ขั้นบนจอ (data-testid อังกฤษ):
1. `CountScreen`: นับแบบไม่เห็นยอด (เดิม) · ปุ่ม `count-done` "นับเสร็จ" → `markCounted` → จอแสดงคำเตือนว่ากะหยุดรับขายแล้ว
2. `CloseShiftScreen` (ใช้ได้ทั้งกะที่เพิ่งนับและกะใน `pendingZ`): `countFigures` → **ออนไลน์**: `BotCashPanel` (`bot-cash-list` · รายการบิลบอท/เว็บ + ยอด) + เงินที่ควรมี + ส่วนต่าง · แก้จำนวนได้ (ถ้ายังไม่ยืนยันแบบออฟไลน์) · ช่องเหตุผลบังคับเมื่อ `|ส่วนต่าง| >= เกณฑ์` (`variance-reason`) · PIN owner → `closeShift` · **ออฟไลน์**: ป้าย `bot-cash-missing` "ยังไม่รวมบิลเงินสดจากบอท" · ไม่มีช่องเหตุผล · PIN owner → `confirmCountOffline` · กลับไปหน้าขายได้และเปิดกะใหม่ได้
3. `StatusBanners`: แถบแดง `banner-z-pending` "ใบปิดกะ <วันที่> รอออนไลน์" ต่อกะใน `pendingZ` · แตะแล้วไป `CloseShiftScreen` ของกะนั้น
4. `ZReportScreen`: แสดงบรรทัด "เงินสดจากบิลบอท/เว็บ" · "ค่าใช้จ่ายจากลิ้นชัก" (0 · ก้อน 4) · เลข Z · Z เก่าที่ไม่มีช่องใหม่แสดง 0
5. ข้อความ error ใหม่: `NOT_COUNTED` `ALREADY_COUNTED` `COUNT_CONFIRMED` `NEEDS_ONLINE` ("ต้องออนไลน์เพื่อดึงบิลเงินสดจากบอท") `BOT_CASH_CHANGED` ("มีบิลเงินสดจากบอทเพิ่ม ดึงตัวเลขใหม่แล้ว ตรวจอีกครั้ง")

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** (Testing Library + fake api): ออนไลน์แสดงบิลบอท 3 ใบและยอดรวม · ส่วนต่าง ฿20.00 บังคับเหตุผล · ฿19.99 ไม่บังคับ · ออฟไลน์แสดงป้ายและไม่มีช่องเหตุผล · `BOT_CASH_CHANGED` ทำให้จอดึงใหม่ · แถบ `banner-z-pending` แสดงวันที่ไทย
- [ ] **Step 2: รันให้ล้ม** · `pnpm --filter @dayo/pos test -- CountScreen CloseShiftScreen BotCashPanel StatusBanners`
- [ ] **Step 3: เขียนหน้าจอ** · ข้อความทั้งหมดใน `th.ts`
- [ ] **Step 4: รันให้ผ่าน** · `pnpm turbo run typecheck test`
- [ ] **Step 5: commit** · `feat(pos-ui): count then issue Z with bot cash (D101)`

### Task 15: หน้า "ส่งไม่ผ่าน" ก้อน 3 · แถบใหม่ · ป้ายบิลนอกแคตตาล็อก

ผู้ทำ: pos-ui-developer (sonnet) · ผู้ตรวจเพิ่ม **security-reviewer** · สเปก §6.4 · §6.2 (แถบ `scope:`) · รอ T13

**Files:**
- Modify: `apps/pos/src/screens/{SyncProblemsScreen,StatusBanners,SystemStatusScreen,OrdersScreen,OrderDetailScreen,CentralStateChip}.tsx` (+ test), `apps/pos/src/ui/th.ts`, `apps/pos/src/ui/errors.ts`
- Create: `apps/pos/src/screens/OffCatalogDialog.tsx`, `apps/pos/src/screens/OffCatalogDialog.test.tsx`

- ปุ่มใหม่: `remedy-close-off-catalog` "ปิดเป็นบิลนอกแคตตาล็อก" → `OffCatalogDialog` (คำอธิบาย: ยอดขายเข้าระบบกลาง แต่ไม่รู้ต้นทุน ไม่ตัดสต็อก · ยอดเงินไม่เปลี่ยน · **ห้ามบันทึกเงินเข้า-ออกเพื่อชดเชย** · owner + PIN + เหตุผลบังคับ) · `remedy-ack-delivered` "รับทราบ บิลอยู่ในระบบกลางแล้ว" · `remedy-reconfirm-owner` "ยืนยันปิดกะด้วย PIN เจ้าของอีกครั้ง" · `remedy-exclude` เปลี่ยนป้ายเป็น "ปิดไว้ในเครื่อง" (ยืนยันสองชั้นเดิม)
- การ์ดแถว `order_void` ทางตัน (ค): ข้อความ "ให้เจ้าของยกเลิกบิล <order_no> บนเว็บ dayo พร้อมเหตุผล" (`order_no` จาก DTO)
- แถบ: `banner-shift-conflict` แดง "ข้อมูลกะชนกับระบบกลาง แนะนำให้เจ้าของเปลี่ยนกุญแจเครื่อง" · `banner-scope-hold` "กุญแจเครื่องไม่มีสิทธิ์ shift:write เพิ่มสิทธิ์บนเว็บ dayo" (เหลืองก่อน 24 ชม. · แดงหลัง 24 ชม.) · `banner-elsewhere-mismatch` แดง "บิลในระบบกลางไม่ตรงกับเครื่อง N ใบ"
- ป้ายบิล `order-off-catalog` "นอกแคตตาล็อก" ในประวัติและรายละเอียดบิล

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** · ปุ่มตรงตารางทางแก้ของ T13 ต่อชนิด/คำนำหน้า (fake api) · Dialog ไม่ส่งถ้าเหตุผลว่าง · แถบแสดงตาม `SyncStatusDto` · ป้ายบิล
- [ ] **Step 2: รันให้ล้ม**
- [ ] **Step 3: เขียนหน้าจอ**
- [ ] **Step 4: รันให้ผ่าน** · `pnpm turbo run typecheck test`
- [ ] **Step 5: commit** · `feat(pos-ui): off-catalog close and shift conflict banners`

### Task 16: e2e ก้อน 3 กับ mock (ส่วนของเกณฑ์ §9 ก้อน 3 ที่แท็บเล็ตเห็น)

ผู้ทำ: pos-ui-developer (sonnet) · สเปก §9 ก้อน 3 · รอ T7, T15

**Files:**
- Create: `apps/pos/e2e/block3-close-online.spec.ts`, `block3-count-offline.spec.ts`, `block3-off-catalog.spec.ts`, `block3-scope-hold.spec.ts`
- Modify: `apps/pos/e2e/helpers.ts` (ตัวเรียก `/__mock/add-bot-cash-bill` `/__mock/set-scopes` `/__mock/set-live-from` `/__mock/state`)

- `block3-close-online`: เปิดกะ → ขายเงินสด → mock เพิ่มบิลบอทเงินสด 3 ใบ → นับเสร็จ → เห็นบิลบอท 3 ใบ · เงินที่ควรมีรวมบิลบอท → PIN → Z · `/__mock/state` มี `shift_close` ที่ `bot_bills` 3 ใบ
- `block3-count-offline`: `context.setOffline(true)` → นับเสร็จ → ป้าย "ยังไม่รวมบิลเงินสดจากบอท" → PIN → เปิดกะใหม่ → ขาย → `setOffline(false)` → แถบ "รอออนไลน์" → ออก Z → mock ไม่มี `CONFLICT`
- `block3-off-catalog`: mock ตั้ง `block3LiveFrom` วันนี้ → ขายบิลที่ mock ปฏิเสธ (เช่น ปิดเมนูบน mock ก่อนส่ง) → หน้า "ส่งไม่ผ่าน" → ปิดเป็นบิลนอกแคตตาล็อก → mock เก็บ `order_off_catalog` → ป้าย "นอกแคตตาล็อก"
- `block3-scope-hold`: `set-scopes` ไม่มี `shift:write` → เปิดกะ → แถบเหลือง · หน้า "ส่งไม่ผ่าน" ว่าง · เพิ่ม scope → ปุ่ม "ส่งตอนนี้" → แถบหาย

- [ ] **Step 1: เขียน spec** (ล้มก่อน) · **Step 2: รันให้ล้ม** `pnpm --filter @dayo/pos e2e -- block3` · **Step 3: แก้ helper/หน้าจอที่จำเป็น** (ไม่แตะไฟล์ของสาย C) · **Step 4: รันให้ผ่าน** ทั้งชุด e2e · **Step 5: commit** `test(pos-e2e): cover block 3 against the mock`

---

## 6. ท้ายก้อน

### Task 17: ตรวจทั้งก้อน แล้ว merge

ผู้ทำ: หัวหน้า · ผู้ตรวจ code-reviewer + security-reviewer (opus)

- [ ] **Step 1** · `pnpm turbo run typecheck test` + `pnpm --filter @dayo/pos e2e` บน `block-3-pos` ผ่าน
- [ ] **Step 2** · ตรวจทั้งก้อนเทียบ §8 ของแผนนี้ (ทุกเกณฑ์ §9 ที่เป็นของแท็บเล็ตมีเทสต์) · security-reviewer ตรวจ: PIN owner ทุกทางแก้ · ไม่มีเงินติดลบข้ามขอบ · `z_report` ไม่มี `expected`/`variance` · ไม่มีกุญแจใน outbox/ไฟล์ส่งออก · ไม่มีทาง "ชดเชย" บิลนอกแคตตาล็อกด้วย `PAID_IN/OUT`
- [ ] **Step 3** · แก้ 1 รอบ → ตรวจซ้ำเฉพาะจุด → merge `--no-ff` เข้า `main` · push ได้ (CLAUDE.md กฎเหล็กข้อ 10)

### Task 18: เชื่อมจริงกับ dayo local (รอแผน 08d + เจ้าของ)

ผู้ทำ: หัวหน้า + sync-engineer (opus) + **เจ้าของ** · รอ: แผน `2026-09-28-08d-block3-dayo-side.md` ทำเสร็จบน dayo local (ADR-0056 เจ้าของยอมรับแล้ว 28 ก.ย. 2569) · agent ไม่อ่าน `.env*`/`.dev.vars` และไม่เห็นกุญแจจริง

- [ ] **Step 1: fixture ของจริง** · เจ้าของเปิด Supabase local + `npm run dev:web` (`API_V1_ENABLED=1`) · เก็บคำตอบจริงของทุกไฟล์ `b3-*` ลง `packages/contracts/fixtures/dayo-api/` · ต่างจากของ T6 = แก้ fixture ให้ตรงของจริงแล้วแก้โค้ด · `fixtures:hashes`
- [ ] **Step 2: parity สูตรเงิน** · ส่ง `packages/domain/test/fixtures/z-cash-parity.json` ให้ dayo (แผน 08d Task 7 ใช้เป็นเทสต์ SQL) · ผลของ dayo ทุกเคสต้องเท่ากับไฟล์ (ต่าง 0 สตางค์ รวมกรณีติดลบ)
- [ ] **Step 3: กุญแจ** · เจ้าของสร้างกุญแจที่มี `shift:write` เพิ่ม
- [ ] **Step 4: สถานการณ์ §9 ก้อน 3 บน dayo local** (เจ้าของตรวจผลใน SQL editor/หน้าเว็บ): ปิดกะที่มีบิลบอทเงินสด 3 ใบ → `z_reports.recompute_status = 'matched'` · ขายออฟไลน์ทั้งกะแล้ว Z มาก่อนบิล → `waiting_bills` → บิลครบ → `matched` · ส่วนต่าง −฿20.00 → Discord · −฿19.99 → ไม่แจ้ง · owner แก้บิลเงินสด ฿100 → ฿80 บนเว็บหลังปิดกะ → Z ยัง `matched` และหน้ากะแสดง "เจ้าของแก้บิลหลังขาย" · นับออฟไลน์ → เปิดกะถัดไป → ออนไลน์ → ทุกแถว `accepted` · บิลนอกแคตตาล็อก: `off_catalog=true` `cost_total` null ยอดขายของวันรวม · ติดตั้งแอปใหม่ด้วย key เดิม → Z ถัดไป `last_z_no + 1` ไม่มี `z_no_taken:`
- [ ] **Step 5: บันทึกผล** ลง `docs/superpowers/plans/2026-09-28-08-บันทึกเชื่อมจริงก้อน3.md` · commit fixture ที่เปลี่ยน + บันทึก
- [ ] **Step 6: แท็บเล็ตจริง** · เลื่อนตาม D51 · docs-writer เพิ่มรายการก้อน 3 เข้ารายการทดสอบท้ายสุด (นับเงินบนจอแท็บเล็ต · ออฟไลน์จริงตอนปิดกะ)

---

## 7. ความสอดคล้องกับแผนฝั่ง dayo (`2026-09-28-08d-block3-dayo-side.md`)

| ของ | POS (แผนนี้) | dayo (แผน 08d) |
|---|---|---|
| ชนิด push 5 ชนิด + ช่อง id | T5 `ID_FIELD` · T7 mock | Task 5-6 `dayo_pos_push_row` ต่อชนิด |
| คำนำหน้า `detail` | T5 `detailPrefix` · T12/T13 ตัดสินจากคำนำหน้า | Task 5 ทุกคำตัดสินก้อน 3 + `order`/`order_void` |
| E1 `client.last_z_no`/`last_z_hash` · `supported_*` | T9 | Task 5 `api_pos_catalog` · `dayo_pos_supported` |
| E4 | T9 client · T11 | Task 8 `api_pos_shift_cash` + route |
| สูตรเงินที่ควรมี | T1 fixture `z-cash-parity.json` | Task 7 เทสต์ SQL ใช้ไฟล์เดียวกัน |
| บิลนอกแคตตาล็อก | T4 · T13 | Task 6 · Task 10 รายงาน |
| เพดาน Q72 · แจ้ง Q74 | mock `MOCK_DEFAULTS` | Task 3 default คอลัมน์ · Task 9 `WAITING_BILLS_ALERT_HOURS` |
| fixture สัญญา | T6 (POS เป็นเจ้าของ · D84) | Task 11 รับชุด `b3-*` ไปเป็นเทสต์ Route Handler |

## 8. ตรวจแผนเทียบสเปก (self-review)

| สเปก | task |
|---|---|
| §4.10 หลักข้อ 1-4 (กะเฉพาะแท็บเล็ต · D93 · บิลนอกแคตตาล็อก · `local_only`) | T10 (R1) · T11 · T13 |
| ตารางชนิด push + key + ช่อง + แถวแม่ | T5 · T10 · T12 |
| กติการ่วม (ลำดับตรวจ · เวลา · พนักงาน · ขอบเขต key · 23505 · เพดาน · `supported_fields` · ขนาด · คำนำหน้า · `data` ของผล) | T5 · T7 (mock) · T12 |
| `shift_open` `cash_movement` `cash_count` `shift_close` + `z_report` | T3 · T5 · T10 · T11 |
| ลำดับ `z_no` และโซ่ (R3-B · R4-1) | T2 (`nextZNumber`) · T9 · T11 |
| สูตร dayo + parity R-m1 | T1 |
| `order_off_catalog` + กติกาฝั่ง dayo ข้อ 0-3 | T4 · T7 · T13 |
| E4 | T7 · T9 · T11 |
| เงินสดที่ควรมี (ล็อก) | T1 · T11 |
| แจ้งเตือน D98/D102 (`>=`) | T1 · T3 (`variance_alert`) |
| ลำดับ ช่อง แถวแม่ (ช่องกะ · ช่องบิล · R-I1) | T12 |
| §6.1 `local_only` · `closed_off_catalog` | T10 · T13 |
| §6.2 ช่อง · `scope:` | T12 |
| §6.4 ทางแก้ทุกแถว + ทางตัน (ก)(ข)(ค) + ปิดไว้ในเครื่อง | T13 · T15 |
| §6.6 เลขใบปิดกะ | T9 · T11 |
| §6.8 ขั้นตอนนับเงิน ข้อ 1-4 | T11 · T14 |
| §9 ก้อน 3 (ส่วนแท็บเล็ต): นับออฟไลน์ → เปิดกะถัดไป → ออนไลน์ ไม่มี CONFLICT · แถว `local_only` ไม่ถูกส่ง · แถว deferred ในช่องกะหยุดแถวกะหลังจากนั้นแต่บิลยังส่ง · ไม่มี `shift:write` → รอ ไม่ขึ้น "ส่งไม่ผ่าน" · เพิ่ม scope แล้วผ่านเอง · `PARENT_REJECTED` กลับ `pending` เอง · บิลนอกแคตตาล็อก + `exists:` → "รับทราบ" · ติดตั้งใหม่ด้วย key เดิม → Z ต่อเลข · parity สูตรเงิน | T11 · T12 · T13 · T16 · T18 |
| §9 ก้อน 3 (ส่วนฐานกลาง: recompute · Discord · เว็บ · RPC สิทธิ์) | แผน 08d (ตรวจร่วมใน T18) |
| C13 ถอด `ALREADY_PRESENT` | T5 · T13 |

ไม่พบช่องว่างที่ไม่มี task · ไม่มีการเปลี่ยน D ใดในแผนนี้
