# ก้อน 3 — POS กะ · เงินเข้า-ออก · นับเงิน (ออนไลน์/ออฟไลน์) · ใบปิดกะส่ง dayo · บิลนอกแคตตาล็อก · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** กะ เงินเข้า-ออก การนับเงิน และใบปิดกะ (Z) ของแท็บเล็ตขึ้นฐานกลาง dayo ผ่าน `POST /v1/pos/push` ชนิดใหม่ 4 ชนิดในช่องกะหนึ่งช่องต่อเครื่อง · เงินที่ควรมีรวมบิลเงินสดจากบอท (E4) และเท่ากับสูตรของ dayo ทุกสตางค์ · นับเงินได้ทั้งออนไลน์และออฟไลน์ (D101) โดย Z ออกเมื่อออนไลน์ · owner ปิดบิลที่ dayo ปฏิเสธถาวรเป็น "บิลนอกแคตตาล็อก" (`order_off_catalog`) ได้จากหน้า "ส่งไม่ผ่าน" · เลข Z และโซ่แฮชต่อจากระบบกลางเมื่อติดตั้งแอปใหม่

**Architecture:** `@dayo/domain` ขยายสูตรเงินที่ควรมี (`botCashSatang`, `drawerExpensesSatang`) · `ZInput` ได้เวลานับ (`countedAt`) ช่วงบิลบอท และรายการบิลบอทที่แช่แข็ง · ตัวสร้าง `data` ของ E2 ทุกชนิดใหม่อยู่ใน domain (แปลงสตางค์→บาทจุดเดียว) · `@dayo/contracts` ได้ zod ของ 5 ชนิด + ผลรับ + คำนำหน้า `detail` + E4 + E1 `last_z_*` + fixture · `@dayo/dayo-mock` ได้ชนิดกะ กติกา `z_no` การคิด Z ซ้ำ (พอสำหรับเทสต์) และบิลนอกแคตตาล็อก แบบเปิดใช้ด้วย `block3: true` · แท็บเล็ต: กะมีสถานะ `open → counting → counted → closed` · "นับเสร็จ" แช่แข็งกะ (`counted_at`) · ยืนยันการนับด้วย PIN owner · ออก Z เมื่อมีบิลบอทจาก E4 · ตัวส่งแยกช่องบิล/ช่องกะ (ช่องกะเข้มตามลำดับ) · แถวลูก `PARENT_REJECTED` กลับคิวเองเมื่อแม่ผ่าน · `FORBIDDEN scope:` รอแบบ deferred

**Tech Stack:** TypeScript 5.9 · pnpm + turbo · zod 4 · vitest 5 + fast-check 4 · React 19 + TanStack Router/Query · SQLite WASM (OPFS) + drizzle-orm 0.45 · Comlink Worker · Playwright 1.63 · Node 22

**Spec:** `docs/design/04-สเปกการเชื่อม-POS-กับ-dayo.md` — **§4.10 ก้อน 3 (ล็อก)** ทั้งหมด · §4.4 ข้อ 6 (`last_z_no`/`last_z_hash`) · §4.5 ข้อ 0 + ข้อ 6 · §6.1 · §6.2 · §6.4 · §6.6 · §6.8 · §9 ก้อน 3 · §13.8 · การตัดสินใจ `docs/design/00-บันทึกการตัดสินใจ.md`: D36 · D47 ข้อ 2, 6 · D50 Q3-21/Q3-22/Q3-26 · D52 · D53 · D54 · D55 · D68 · D84–D102 (สำคัญ: **D101** นับเงินออฟไลน์ · **D102** เกณฑ์ ≥ เดียว) · แผนฝั่ง dayo (เขียนขนานกัน): `docs/superpowers/plans/2026-09-26-08-*.md` (อ้างอิงเท่านั้น) · ร่าง ADR `docs/design/dayo-adr-drafts/P3-shift-cash-z-report.md`

**ต้องมีก่อนเริ่ม (hard dependency):** ก้อน 2 (`docs/superpowers/plans/2026-09-25-07-block2-pos-sell-central.md`) **merge เข้า `main` แล้ว** รวม: Task 12a–12d (`enqueuePush`/`enqueueLocalOnly`/`PushRowInput`, `recordSale`, `cancelSale`, `PAYMENT_CODE`, `countPendingSyncItems`, `countSyncProblems`) · **Task 13** (`pushOnce`, `retryRow`, `clearFailureBackoff`, `CLOCK_AHEAD_FAR_MS`, คิวแบบหน้า 200 แถว) · **Task 14** (`createSyncScheduler`, `SyncStatusDto`, `syncStatus()`, `WakeReason`) · **Task 15** (`sync-problems.ts`: `Remedy`, `SyncProblemDto`, `OwnerApproval`, `listSyncProblems`, `retrySyncRow`, `renumberReceipt`, `remapCode`, `remapStaff`, `excludeFromSync`, `exportSyncRow`) · Task 17 (SetupScreen/OwnerRecovery) · Task 19–20 (`OrderDetailScreen`, `StatusBanners`, `SyncProblemsScreen`) · Task 21 (e2e + `e2e/helpers.ts`) · **Step 0 ของทุก task ที่แตะของก้อน 2 = เปิดไฟล์จริงบน `main` แล้วใช้ชื่อจริง** — ชื่อต่างจากแผนนี้ = บันทึก `Ruling:` ใน ledger แล้วใช้ชื่อจริง (ไม่เปลี่ยนพฤติกรรม)

## Global Constraints

- เงินในแท็บเล็ตเป็น **สตางค์จำนวนเต็ม** · แปลงบาท↔สตางค์ได้เฉพาะ `edgeBahtToSatang`/`edgeSatangToBaht` (`packages/domain/src/money-edge.ts`) · ตัวสร้าง `data` ของ E2 ทุกชนิดอยู่ใน `@dayo/domain` (`order-row.ts`, `shift-rows.ts`, `off-catalog-row.ts`) · `apps/pos/**` ห้าม import `bahtToSatang`/`bahtToUsat` (เทสต์บังคับของก้อน 2 ยังคุมอยู่)
- **ไม่มีเงินติดลบข้ามขอบ** (§4.10 C5): แท็บเล็ตส่งองค์ประกอบ `z_report.cash` ที่ไม่ติดลบ + `counted` · `expected`/`variance` คิดในเครื่องเป็นสตางค์ และ dayo คิดเองจากสูตรเดียวกัน
- สูตร (ล็อก §4.10): `expected = opening_float + pos_cash_sales − void_refunds + paid_in − paid_out − drops − drawer_expenses + bot_cash` · `variance = counted − expected` · **ก้อน 3: `drawer_expenses` = 0 เสมอ**
- เกณฑ์ขอเหตุผล: **|variance| ≥ เกณฑ์** (D102) · เกณฑ์ = ค่าตั้ง `cash.variance_alert_satang` (ค่าเริ่มต้น ฿20) · ส่งไปกับ Z เป็น `z_report.variance_alert`
- ช่องคิว (§6.2): **ช่องกะหนึ่งช่องต่อเครื่อง** = `shift_open` `cash_movement` `cash_count` `shift_close` เรียง `createdAt` เข้มตามลำดับ · **ช่องบิล** = `order` `order_void` `order_off_catalog` · แถวแม่ในเครื่องตามตาราง §4.10
- `rejected FORBIDDEN` ที่ `detail` ขึ้นต้น `scope:` = รอแบบ deferred ทุก **15 นาที** · ไม่นับ 50 ครั้ง · แถบ owner ทันที · **แดงหลัง 24 ชม.** · ปุ่ม "ปิดไว้ในเครื่อง" หลัง **7 วัน**
- แท็บเล็ตตัดสินจาก **คำนำหน้า `detail` เท่านั้น** (`scope:` `role:` `rule:` `exists:` `off_catalog_exists:` `receipt_taken:` `key_changed:` `counted:` `z_no_taken:` `data_conflict:`) · ค่า (`order_no` ฯลฯ) อ่านจาก `data` เท่านั้น ห้ามแยกจากข้อความไทย
- ตัวส่งเดิมของก้อน 2 คงทุกกติกา: ≤ 20 แถว · ≤ 262,144 ไบต์ UTF-8 · timeout 20 วิ · backoff 5 วิ→15 วิ→1 นาที→5 นาที→15 นาที ±20% · 401/403 ทั้งคำขอหยุด · 404 = API ปิด · 5xx×3/422 ทีละแถว · deferred 50 ครั้ง = STUCK · `CLOCK_AHEAD` ไม่นับครั้ง
- ค่าที่บันทึกแล้วแช่แข็ง: `cash_movement` `cash_count` `z_report` append-only (trigger) · `shift.counted_at` ตั้งครั้งเดียว · สถานะกะเดินหน้าอย่างเดียว · ห้ามลบบิล
- ข้อความบนจอภาษาไทย · `apps/pos/src/ui/errors.ts` และ `apps/pos/src/ui/th.ts` = **สาย D เท่านั้น** · `apps/pos/src/api/errors.ts` = Task 1 (สาย D ทำครั้งเดียวก่อนทุกสาย) แล้วเป็นของสาย C · `data-testid` เป็นอังกฤษ
- สิทธิ์ผ่าน `can(role, action)` (`apps/pos/src/app/permissions.ts`) ทั้งหน้าจอและ API ที่เป็นของ owner (API import `can` แบบอ่านอย่างเดียว)
- repo dayo อ่านอย่างเดียว · agent ไม่อ่าน `.env*`/`.dev.vars`/`backups/` ของทั้งสอง repo · ไม่มีค่าลับในเทสต์ (ใช้ `MOCK_API_KEY`)
- ทุก task: `pnpm turbo run typecheck test` ผ่านทั้ง repo · commit ผ่าน skill `committing-code` · stage เป็นชื่อไฟล์ · ไม่มีบรรทัด `Co-Authored-By`/ระบุ AI · ห้าม `git checkout -- <ไฟล์>`/`git reset --hard` · ไฟล์ ledger/`.superpowers/`/`.claude/` ไม่ commit
- ทดสอบบนแท็บเล็ตจริงเก็บไว้ท้ายสุด (D51) — แผนนี้ไม่รันบนแท็บเล็ต

---

## 0. ภาพรวมการตัดสินใจของแผน

### 0.1 ต่อจากก้อน 2 — ใช้/แก้อะไร

| ของก้อน 2 | อยู่ที่ | ก้อน 3 ทำอะไร |
|---|---|---|
| `enqueueLocalOnly` / `enqueuePush` / `PushRowInput` | `apps/pos/src/db/outbox.ts` | `PushRowInput` เพิ่ม 5 ชนิด (Task 9) · กะ `local_only` ยังใช้ `enqueueLocalOnly` |
| `buildOrderRowData` (`shift_id: null` ตายตัว) | `packages/domain/src/order-row.ts` | รับ `shiftId` (Task 3) · บิลของกะ `central` ส่ง `shift_id` (Task 11) |
| `pushOnce` · `retryRow` · ลูกรอแม่ (`order_void`) | `apps/pos/src/sync/push.ts` (T13) | ช่องบิล/ช่องกะ · ลูกรอแม่ทุกชนิดด้วย `parentKey` · `scope:` · `releaseChildren` · ผลรับของชนิดใหม่ (Task 10) |
| `SyncStatusDto` · `syncStatus()` | T14 | เพิ่ม `scopeWait` `shiftDataConflict` `centralMismatchBills` (Task 14) |
| หน้า "ส่งไม่ผ่าน" · `Remedy` · `excludeFromSync` (R8 ก้อน 2) | `apps/pos/src/api/sync-problems.ts` (T15) | ปุ่มตามคำนำหน้า · `CLOSE_OFF_CATALOG` แทนการปิด `order` เป็น "นอกระบบกลาง" (C13) · `ACKNOWLEDGE_ELSEWHERE` · `RECONFIRM_OWNER` · `CODE_REMAPPED` ห้ามสลับเงินสด (Task 14) |
| `closeShift` (นับ + Z ขั้นเดียว · D52) · ตรรกะโซ่ Z (D53–D55) | `apps/pos/src/api/close.ts` | แยกเป็น `finishCount` → `confirmCount` → `issueZ` (D101) · ตรรกะโซ่เดิมย้ายเข้า `writeZ` ไม่เปลี่ยนพฤติกรรม · `closeShift` คงเป็นตัวห่อสำหรับกะ `local_only` (Task 12) |
| `client.last_receipt_no` ตอนตั้งเครื่อง | `apps/pos/src/api/connect.ts` | เพิ่ม `last_z_no`/`last_z_hash`/`last_z_until` + ให้ owner ยืนยันบนหน้าตั้งเครื่อง (Task 13) |
| บิลที่ปิด "นอกระบบกลาง" ช่วงก้อน 2 (`excluded_at`, `local_only`) | — | **คงเป็น `local_only` ไม่แปลง** (D94 · C13) |
| `ALREADY_PRESENT` ใน `KNOWN_REJECT_REASONS` | contracts | **ถอด** (C13 · Task 5) |

### 0.2 จุดที่แผนตัดสินเอง (Ruling — แก้ได้ถ้าเจ้าของสั่ง)

| # | เรื่องที่สเปกไม่ระบุชัด | ตัดสิน | เหตุผล · ถ้าผิดเสียอะไร |
|---|---|---|---|
| R1 | กะไหน "เปิดก่อนก้อน 3 ใช้งานจริง" (§4.10 ข้อ 4) | คอลัมน์ใหม่ `shift.sync_mode`: `central` เมื่อ **ตอนเปิดกะ** เครื่องเชื่อม dayo แล้ว **และ** `supported_kinds` ล่าสุดของ E1 มีครบ 4 ชนิดกะ · ไม่งั้น `local_only` ตลอดไป · **ก่อนตัดสิน ถ้าเชื่อมอยู่ ดึง E1 ใหม่หนึ่งครั้ง (§6.5 "ก่อนเปิดกะ") นอกคิว serial · ล้ม/ออฟไลน์ = ใช้ `supported_*` ล่าสุดที่เก็บไว้** (Task 11) · กะที่มีอยู่ก่อน migration ของก้อน 3 = `local_only` | แท็บเล็ตไม่รู้ `block3_live_from` · ตัดสินจากสิ่งที่เครื่องเห็นเอง · ผิด = กะแรกหลัง dayo deploy อาจเป็น `local_only` ถ้าเครื่องยังไม่ได้ E1 ใหม่ (บิลยังเข้าฐานด้วย `shift_id: null`) |
| R2 | สถานะระหว่าง "นับเสร็จ" กับยืนยันการนับ | `open → counting` (กด "นับเสร็จ" · แช่แข็ง `counted_at`) `→ counted` (owner PIN ยืนยันการนับ · Z รอ) `→ closed` (ออก Z) · **เปิดกะใหม่ไม่ได้ขณะมีกะ `counting`** (`COUNT_PENDING`) · กะ `counted` ไม่บล็อก (D68) | การยืนยันการนับไม่ต้องใช้เน็ต ไม่มีทางค้างนาน · กัน `after` ของ E4 ของกะถัดไปอ้างการนับที่ยังไม่ยืนยัน |
| R3 | `counted_at` เมื่อนาฬิกาถูกตั้งย้อน | `counted_at` = ค่ามากสุดของ (ตอนนี้, `opened_at`, `sold_at` ล่าสุดของกะ, `created_at` ล่าสุดของเงินเข้า-ออกของกะ) | dayo ตรวจ `counted_at ≥ opened_at` และทุกแถวของกะต้อง ≤ `counted_at` · ผิด = เวลานับเลื่อนไม่เกินแถวสุดท้ายของกะ |
| R4 | ค่าตั้งเกณฑ์ = 0 กับกติกา ≥ | เกณฑ์ที่ใช้จริง = `max(1 สตางค์, ค่าตั้ง)` (`effectiveVarianceAlertSatang`) ทั้งตอนขอเหตุผลและค่าที่ส่ง `variance_alert` · **ทางเขียนค่าตั้งนี้ต้องปฏิเสธค่า < 1 สตางค์** — วันนี้แท็บเล็ตไม่มีหน้าจอหรือ API ที่เขียน `cash.variance_alert_satang` (มีแค่ `getSetting`) · หน้าตั้งค่าที่จะเพิ่มในอนาคตต้องปฏิเสธด้วย `BAD_INPUT` "เกณฑ์ต้องอย่างน้อย 0.01 บาท" (บันทึกเป็น D ใน Task 18) · ตัวอ่านยังบีบเป็น 1 สตางค์เสมอ (กันค่าที่มาจากไฟล์สำรอง) | `|0| ≥ 0` จะขอเหตุผลและแจ้ง Discord ทั้งที่นับตรง · ผิด = ไม่มี (ค่าเริ่มต้น ฿20) |
| R5 | §6.8 ข้อ 4 "เพิ่มคอลัมน์บอกว่ารวมบิลบอทหรือไม่" | เพิ่ม `cash_count.includes_bot_cash` + `cash_count.counted_at` · `expected_satang`/`variance_satang` เก็บค่า ณ ตอนยืนยันการนับ (ออฟไลน์ = ไม่รวมบิลบอท) ในเครื่องเท่านั้น | ตัวเลขทางการอยู่ใน Z |
| R6 | Z ของกะ `local_only` | ไม่เรียก E4 · `botWindow = null` · บิลบอท 0 · Z ออกได้ทันทีหลังยืนยันการนับ · แถวทั้งหมด `local_only` | กะก่อนก้อน 3 ไม่ใช่การขายจริง (D94) · ผิด = ส่วนต่างของกะทดลองไม่รวมเงินบอท |
| R7 | หลายกะรอ Z | ออก Z ตามลำดับ `counted_at` · กะที่ใหม่กว่าได้ `Z_NOT_READY` ถ้ากะก่อนยังไม่มี Z | `z_no` และ `prev_hash` ต้องต่อเรียงกัน |
| R8 | บิลบอทที่แสดงกับที่ใส่ใน Z | `fetchBotCash` เก็บผล E4 ไว้ที่ `sync_state` คีย์ `z.bot_cash.<shiftId>` · `confirmCount`/`issueZ` ใช้ค่าที่เก็บ + ตรวจ `shownFingerprint` (ลายนิ้วมือรวมรายการบิลบอท) ไม่ตรง = `SHIFT_CHANGED` | Z ต้องเป็นตัวเลขที่ owner เห็นตอนกรอก PIN · ออก Z ได้แม้เน็ตหลุดหลังดึง E4 แล้ว |
| R9 | ใช้ `last_z_no`/`last_z_hash`/`last_z_until` เมื่อไร | อ่านจาก E1 **เฉพาะตอน** `connectShop`/`replaceApiKey`/`recoverOwner` (เก็บ `dayo.last_z_no`/`dayo.last_z_hash`/`dayo.last_z_until`) ไม่อ่านจาก E1 รอบปกติ · หน้าตั้งเครื่องแสดง "Z ล่าสุดในระบบกลาง" ให้ owner ติ๊กยืนยัน (`confirmedLastZNo`) · Z แรกหลังจากนั้น: ถ้า `last_z_no` > เลข Z ในเครื่อง → `Z_CHAIN_BROKEN` (detail `central`) → owner PIN รับทราบ (ทาง D55) → `zNo = last_z_no + 1` · `prev_hash = last_z_hash` · **`bot_window.after` = `last_z_until`** (§13.8 R5-1 — แทน "การนับก่อนหน้าในเครื่อง") · `chainWarning.centralLastZ` · ยอดสะสม (grand total) **ไม่ต่อ** จากระบบกลาง (ต่อจาก Z ในเครื่องถ้ามี ไม่งั้น 0) | ตามหมายเหตุผู้ตรวจสเปกรอบ 4 · E1 รอบปกติที่ค่ามากกว่าในเครื่อง = มีคนใช้กุญแจเดียวกัน (S5) ไม่ควรกระโดดเลขเอง |
| R10 | รายการของบิลนอกแคตตาล็อกเมื่อส่วนลดโปรหารไม่ลงตัว | ใช้ `discount_per_cup` ของ `order_item` ต่อเมื่อ `(unit − dpc) × qty` = ยอดบรรทัดที่แช่แข็งพอดี · ไม่งั้นบรรทัดนั้นส่วนลด 0 แล้วย้ายผลต่างไปรวมใน `bill_discount` · `items_subtotal` และ `total` **เท่าเดิมเสมอ** | dayo ตรวจ `line_total = (unit − dpc) × qty` ตรงตัว · ห้ามแก้ยอดเงิน · ผิด = สัดส่วนส่วนลดรายการ/ทั้งบิลบนเว็บต่างจากในเครื่อง (ยอดไม่ต่าง) |
| R11 | ปุ่ม "ปิดเป็นบิลนอกแคตตาล็อก" ขึ้นกับแถวไหน | เฉพาะแถว `order` ที่ **dayo** ปฏิเสธ (ไม่ใช่ `STUCK`/`ENVELOPE`/`PARENT_REJECTED` ของเครื่อง) และไม่ใช่ `exists:`/`off_catalog_exists:` · **ทุกแถว `order` ที่ `dead` (ยกเว้น `PARENT_REJECTED`) มี "ปิดไว้ในเครื่อง" เป็นปุ่มสุดท้าย** (ไม่มีทางตันเมื่อปิดนอกแคตตาล็อกไม่ได้ — review item 2) · แถว `pending` นาฬิกาล้ำ > 24 ชม. (N5) = ปิดไว้ในเครื่องเท่านั้น | dayo ต้องมีแถวใน `pos_push_rejections` (S1(ก)) ไม่งั้นได้ `rule:` แน่ |
| R12 | แถบแดง "ข้อมูลกะชนกับระบบกลาง" (S5) | จากคำนำหน้าเท่านั้น: แถวชนิดกะ `CONFLICT` `key_changed:`/`counted:`/`z_no_taken:` และ `INVALID` `data_conflict:` (คำนำหน้าใหม่ §13.8 R5-2 — Z ที่ `counted` ≠ การนับในฐาน · `z_no` > สูงสุด + 50) | ห้ามอ่านข้อความไทย |
| R13 | เก็บช่องคิวที่ไหน | คิดจากชนิด (`laneOf`) ไม่เพิ่มคอลัมน์ · ด่านช่องกะใช้ตอนเลือกแถวเข้าก้อน · แถวในคำขอเดียวกันใช้คำตัดสินของ dayo ตามจริง (dayo ตัดสินด้วยเวลาในแถว) | ไม่ต้อง migrate outbox |
| R14 | `scope:` | แถวยัง `pending` · `next_attempt_at` = +15 นาที (ไม่สุ่มคลาด) · `last_error.scopeSince` = ครั้งแรกที่เห็น · ชื่อ scope จาก `KIND_SCOPE` ของชนิด (ไม่แยกจากข้อความ) | ตามสเปก m1 |
| R15 | mock กับเทสต์ก้อน 2 | ชนิดใหม่ใน mock **เปิดด้วย `block3: true` / `setBlock3(true)`** · ค่าเริ่มต้นปิด (เทสต์ก้อน 2 ไม่เปลี่ยน) · E4 ของ mock ใช้ `sold_at` ของบิลบอทแทน `created_at` | เทสต์ก้อน 2 นับแถว outbox อยู่ |
| R16 | เก็บ `data` ของคำตัดสิน `rejected` | `outbox.result_json` = `data` ของคำตัดสิน (ถ้ามี) ทั้งแถว `sent` และ `dead` | `exists:` ต้องเทียบ `reported_total`/`payment_is_cash` |
| R17 | Task 2 เปลี่ยนชนิด `ZInput` แล้ว `apps/pos` typecheck ไม่ผ่าน | Task 2 แก้ขั้นต่ำใน `apps/pos/src/api/{close,shift-report}.ts` + เทสต์ที่ตรึงกติกา `>` เดิม · รอบ 1 ไม่มีสายอื่นแตะสองไฟล์นี้ | repo ต้องเขียวทุก task |
| R18 | ลูก `PARENT_REJECTED` กลับคิว | `releaseChildren(parentKeys)` เรียกเมื่อแม่ได้ `accepted`/`duplicate` และเมื่อ owner "รับทราบ" (`exists:`) · ลูกกลับ `pending` `attempts = 0` คงลำดับ `created_at` เดิม | §4.10 ลำดับ ข้อ 3 |
| R19 | "ปิดไว้ในเครื่อง" ของ `shift_open` | แถวลูกทุกชั้นเป็น `local_only` · `shift.sync_mode` → `local_only` (แถวต่อจากนี้ของกะนั้นไม่ส่ง · บิลต่อจากนี้ `shift_id: null`) · ช่องกะเดินต่อ | ไม่ปล่อยให้ลูกรอแม่ที่ไม่มีวันมา |
| R20 | E4 ไม่มีการแบ่งหน้า | บิลบอท > 500 · บิล POS ของกะ > 2000 · เงินเข้า-ออก > 500 = `Z_TOO_LARGE` (ออก Z ไม่ได้ แจ้งทีม POS) | เพดาน m4 ของสัญญา · ร้าน 2 คนไม่ถึง |

### 0.3 จุดขัดกับ D / ADR และเรื่องรอเจ้าของ

- **ADR-0056 ของ dayo ยังสถานะ "เลื่อน"** (`dayo-shop-system/docs/adr/0056-pos-shifts-cash-drawer.md`) และขัด **ADR-0024 ข้อ 2** (D92) — ร่าง P3 ครอบแล้ว ไม่ต้องร่าง ADR ใหม่ · เป็นงานของแผน 08 (ฝั่ง dayo) · **ไม่บล็อกโค้ดแผนนี้** (ทำกับ mock) · **บล็อก Task 19** (เชื่อมจริง) จน dayo รับ ADR-0056 และ ship
- **D52 Q3b-3** ถูกแก้โดย **D101** — แผนนี้ทำตาม D101 · **D98** ถูกแก้โดย **D102** — `varianceNeedsReason` เปลี่ยน `>` → `≥`
- D47 ข้อ 6 (กะเปิดละหนึ่งต่อเครื่อง) ยังบังคับในเครื่อง (partial unique index เดิม) · ฐานกลางไม่มี (C3)
- **ช่องว่างที่พบตอนเขียนแผน — ปิดแล้ว (คำวินิจฉัยผู้คุมงาน · สเปก §13.8 R5-1)**: Z ใบแรกหลังตั้งเครื่องใหม่ต้องมี `bot_window.after` = `until` ของ Z ใบก่อนในฐาน (กติกา `z_no` ข้อ 3) แต่แท็บเล็ตไม่รู้ค่านั้น → E1 `client` เพิ่ม **`last_z_until`** (timestamptz หรือ null · มาจาก Z ใบเดียวกับ `last_z_hash` = Z ที่ไม่ถูกกักที่เลขสูงสุด · `last_z_no` นับรวมใบที่ถูกกัก — R5-3) · แท็บเล็ตใช้เป็น `after` ของ Z ใบแรกทางเส้น R9 (Task 13) · แผน 08 เพิ่มฝั่ง dayo
- **รอเจ้าของ (แผนใช้ค่าเริ่มต้นที่แนะนำ)**: **Q72** เพดานบิลนอกแคตตาล็อก ฿3,000 — แท็บเล็ตไม่รู้ค่านี้ แค่แสดงผล `FORBIDDEN rule:` ด้วยปุ่ม "ลองใหม่" (หลังเจ้าของเพิ่มเพดานบนเว็บ) และ "ปิดไว้ในเครื่อง" **(รอ Q72 — ค่าเริ่มต้น)** · **Q73** ไม่มียอดเงินใน Discord — ไม่มีงานบนแท็บเล็ต **(รอ Q73 — ค่าเริ่มต้น)** · **Q74** แจ้งเตือนรอเกิน 48 ชม. — ฝั่ง dayo ไม่มีงานบนแท็บเล็ต **(รอ Q74 — ค่าเริ่มต้น: ไม่ทำ)**

### 0.4 ตารางงานขนาน (สูงสุด 4 agent · สายละ 1 worktree)

integration branch: `block-3-pos` (แตกจาก `main` หลังก้อน 2 merge) · แต่ละสายแตก branch จาก `block-3-pos` · task ที่ผ่านตรวจ merge `--no-ff` เข้า `block-3-pos` · ตรวจทั้งก้อนแล้วจึง merge เข้า `main`

| สาย | worktree / branch | แพ็กเกจ/โฟลเดอร์ที่แตะ | task |
|---|---|---|---|
| D0 เตรียม | `../pos-b3-screens` / `b3-screens` | `apps/pos/src/api/errors.ts`, `apps/pos/src/ui/{errors,th}.ts`, `apps/pos/src/app/permissions.ts` | 1 |
| A domain | `../pos-b3-domain` / `b3-domain` | `packages/domain` (+ R17: `apps/pos/src/api/{close,shift-report}.ts` เฉพาะ Task 2) | 2 → 3 → 4 |
| B contract | `../pos-b3-contract` / `b3-contract` | `packages/contracts`, `packages/dayo-mock` (+ Task 6: `apps/pos/test/helpers/dayo.ts` ตัวเลือก `block3`) | 5 → 6 → 7 → 8 |
| S sync | `../pos-b3-sync` / `b3-sync` | `apps/pos/src/sync/*` + เทสต์ของมัน | 10 |
| C device | `../pos-b3-device` / `b3-device` | `packages/db-schema`, `apps/pos/src/{db,api}`, `apps/pos/test` (ยกเว้นเทสต์ของ S) · **หลัง Task 10 merge สาย C ได้ `apps/pos/src/sync/*` ด้วย** | 9 → 11 → 12 → 13 → 14 |
| D screens | `../pos-b3-screens` / `b3-screens` | `apps/pos/src/{screens,ui,state,app,router.tsx}`, `apps/pos/e2e` | 15 → 16 → 17 |
| ท้าย | `block-3-pos` | ทุกที่ | 18 → 19 |

**ไฟล์ที่มีเจ้าของเดียว**: `apps/pos/src/api/errors.ts` → Task 1 เพิ่มรหัส **ครบทั้งก้อน** แล้วเป็นของสาย C (ไม่มี task ใดเพิ่มรหัสอีก ถ้าจำเป็นต้องเพิ่ม = ทำใน task ของสาย D พร้อมข้อความไทย) · `ui/errors.ts` + `ui/th.ts` = สาย D · `apps/pos/test/helpers/dayo.ts` = Task 6 (ตัวเลือก `block3`) แล้ว Task 13 (`confirmedLastZNo` + `beforeConnect`) · `pnpm-lock.yaml`: ชนตอน merge ห้ามแก้มือ — รับฝั่งหนึ่งแล้ว `pnpm install`

| รอบ | สาย A | สาย B | สาย S | สาย C | สาย D | พร้อมกัน |
|---|---|---|---|---|---|---|
| 1 | T2 | T5 | — | — | T1 | 3 |
| 2 | T3 (รอ T5) | T6 (รอ T5) | — | T9 (รอ T5) | — | 3 |
| 3 | T4 (รอ T3) | T7 (รอ T6) | T10 (รอ T6, T9, T3) | T11 (รอ T3, T6, T9) | — | 4 |
| 4 | — | T8 (รอ T7) | — | T12 (รอ T2, T3, T10, T11) | — | 2 |
| 5 | — | — | — | T13 (รอ T12, T8) | T15 (รอ T12) | 2 |
| 6 | — | — | — | T14 (รอ T8, T10, T13) | — | 1 |
| 7 | — | — | — | — | T16 (รอ T13, T14) | 1 |
| 8 | — | — | — | — | T17 (รอ T8, T15, T16) | 1 |
| 9 | T18 บน `block-3-pos` → ตรวจทั้งก้อน → merge `main` → push | | | | | หัวหน้า + 2 ผู้ตรวจ |
| 10 | T19 (รอแผน 08 ของ dayo ship + deploy dev) | | | | | หัวหน้า + 1 |

### 0.5 ผู้ทำ โมเดล และผู้ตรวจ

| Task | ผู้ทำ | ผู้ตรวจ |
|---|---|---|
| 1 รหัส error + ข้อความ + สิทธิ์ | pos-ui-developer (sonnet) | code-reviewer + **security-reviewer** (สิทธิ์ `close_off_catalog`) |
| 2 สูตรเงิน + Z · 3 ตัวสร้างแถว + บิลนอกแคตตาล็อก | domain-engineer (opus) | code-reviewer + **security-reviewer** (เงิน · บิลนอกแคตตาล็อก) |
| 4 parity เงินที่ควรมี | domain-engineer (opus) | code-reviewer + **security-reviewer** (เงิน) |
| 5 สัญญา · 7 fixture | domain-engineer (opus) | code-reviewer |
| 6, 8 mock | sync-engineer (opus) | code-reviewer |
| 9 ฐานในเครื่อง | sync-engineer (opus) | code-reviewer + **security-reviewer** (trigger แช่แข็ง · `counted_at` ตั้งครั้งเดียว) |
| 10 ตัวส่ง + E4 client | sync-engineer (opus) | code-reviewer + **security-reviewer** (key ในคำขอ E4 · เงินซ้ำ) |
| 11 แถวกะ/เงินสด/บิล | sync-engineer (opus) | code-reviewer + **security-reviewer** (เงิน) |
| 12 นับเงิน + Z | sync-engineer (opus) | code-reviewer + **security-reviewer** (PIN owner · เงิน) |
| 13 เลข Z ต่อจากระบบกลาง | sync-engineer (opus) | code-reviewer + **security-reviewer** (key · ตั้งเครื่อง) |
| 14 ทางแก้ของ owner | sync-engineer (opus) | code-reviewer + **security-reviewer** (PIN · บิลนอกแคตตาล็อก) |
| 15, 16 หน้าจอ | pos-ui-developer (sonnet) | code-reviewer + **security-reviewer** (PIN owner) |
| 17 e2e | pos-ui-developer (sonnet) | code-reviewer |
| 18 ตรวจทั้งก้อน | หัวหน้า | code-reviewer (sonnet) + security-reviewer (opus) ทั้ง diff `main..block-3-pos` |
| 19 เชื่อมจริง | หัวหน้า + sync-engineer (opus) + เจ้าของ | code-reviewer + security-reviewer |

ทุก task: implementer → test-runner (haiku) → ผู้ตรวจ → แก้ ≤ 3 รอบกับ agent ตัวเดิม (รอบ 4–5 โมเดลสูงขึ้น 1 ขั้น) → บันทึก `Task N: complete` ใน `.superpowers/sdd/2026-09-26-09-block3-pos-shift-cash/progress.md` (ไม่ commit)

---

## 1. File Structure

### สร้างใหม่

| ไฟล์ | หน้าที่ |
|---|---|
| `packages/domain/src/shift-rows.ts` | `buildShiftOpenRowData` · `buildCashMovementRowData` · `buildCashCountRowData` · `buildShiftCloseRowData` · `ZPosBill` · `ZTooLargeError` · เพดาน Z |
| `packages/domain/src/off-catalog-row.ts` | `buildOffCatalogRowData` · `OffCatalogItem` · `OffCatalogError` |
| `packages/domain/test/{shift-block3,shift-rows,off-catalog-row,shift-cash-parity}.test.ts` | เทสต์ |
| `packages/contracts/fixtures/parity/pos-shift-cash-parity.json` | fixture parity สูตรเงินที่ควรมี (POS เป็นเจ้าของ — D84 · ชื่อและรูปเดียวกับแผน 08: `{cases:[{name, cash, counted, expected, variance}]}` บาท) · เลขคิดมือ |
| `packages/contracts/fixtures/dayo-api/{e1-catalog-changed-block3,e2-shift-rows-accepted,e2-shift-scope-forbidden,e2-cash-count-counted-conflict,e2-shift-close-accepted,e2-shift-close-z-no-taken,e2-order-off-catalog-accepted,e2-order-off-catalog-exists,e2-order-off-catalog-rule,e2-order-off-catalog-exists-order,e4-shift-cash}.json` | fixture สัญญาก้อน 3 (Task 7) |
| `packages/contracts/test/dayo-api-block3.test.ts` | เทสต์ schema ก้อน 3 |
| `packages/dayo-mock/src/{judge-shift,judge-off-catalog,recompute,shift-cash}.ts` + `test/{shift-kinds,z-chain,recompute,off-catalog}.test.ts` | mock ก้อน 3 |
| `packages/db-schema/drizzle/sqlite/0006_block3_shift_cash.sql` (+ snapshot/journal) · `packages/db-schema/test/block3.test.ts` | ฐานในเครื่อง |
| `apps/pos/src/sync/lanes.ts` · `apps/pos/test/{lanes,push-block3}.test.ts` | ช่องคิว + ตัวส่ง |
| `apps/pos/src/api/{count,bot-cash}.ts` · `apps/pos/test/{shift-central,count-z,z-central-continuity,sync-problems-block3,block3-flow}.test.ts` | กะ/นับเงิน/Z/ทางแก้ |
| `apps/pos/src/screens/{IssueZScreen,CloseOffCatalogDialog,CountReview}.tsx` + `.test.tsx` | หน้าจอใหม่ |
| `apps/pos/e2e/block3-{shift-online,shift-offline,off-catalog,scope-reinstall}.spec.ts` | e2e |

### แก้

| ไฟล์ | เปลี่ยน |
|---|---|
| `packages/domain/src/{shift,order-row,index}.ts` | ตาม Task 2–3 |
| `packages/contracts/src/{dayo-api,enums,dayo-fixture,index}.ts` | ตาม Task 5, 7 |
| `packages/dayo-mock/src/{state,judge,handler,control,server,index}.ts` | ตาม Task 6, 8 |
| `packages/db-schema/src/sqlite/{sales,system}.ts` · `src/browser/sqlite-migrations.gen.ts` · `test/{parity,triggers,migrate}.test.ts` | ตาม Task 9 |
| `apps/pos/src/db/outbox.ts` | `PushRowInput` 7 ชนิด (Task 9) |
| `apps/pos/src/sync/{push,dayo-client,state}.ts` | Task 10 (+ Task 13: `DAYO_KEYS.lastZNo/lastZHash/lastZUntil`) |
| `apps/pos/src/api/{shift,cash,void,sale,bootstrap,shift-report,close,connect,sync-problems,types,pos-api}.ts` | Task 11–14 |
| `apps/pos/src/api/errors.ts` · `ui/{errors,th}.ts` · `app/permissions.ts` | Task 1 (+ th.ts Task 15–16) |
| `apps/pos/src/screens/{CloseShiftScreen,ZReportScreen,ZListScreen,OpenShiftScreen,StatusBanners,SyncProblemsScreen,SetupScreen,OwnerRecoveryScreen,OrderDetailScreen}.tsx` · `router.tsx` | Task 15–16 |
| `apps/pos/test/helpers/{dayo,shift}.ts` | Task 6, 12, 13 |
| `apps/pos/e2e/{helpers,close-shift.spec}.ts` | Task 17 |

---

## 2. สาย D0 — เตรียมรหัส error ข้อความ และสิทธิ์ (ทำก่อนทุกสาย)

### Task 1: รหัส error ของก้อน 3 + ข้อความไทย + สิทธิ์ `close_off_catalog`

ผู้ทำ: pos-ui-developer (sonnet) · ผู้ตรวจเพิ่ม: **security-reviewer** (สิทธิ์ `close_off_catalog`) · สเปก §6.4, §6.8, §7 ข้อ 5–6 · D97 · รอ: ก้อน 2 บน `main`

**Files:**
- Modify: `apps/pos/src/api/errors.ts`, `apps/pos/src/ui/errors.ts`, `apps/pos/src/ui/th.ts`, `apps/pos/src/app/permissions.ts`
- Test: `apps/pos/src/ui/errors.test.ts` (มีอยู่ — เดินทุกคีย์ของ `MESSAGES`), `apps/pos/src/app/permissions.test.ts`

**Interfaces:**
- Consumes: `PosErrorCode`, `MESSAGES`, `TH`, `can` (ก้อน 2)
- Produces (Task 11–17 ใช้ · **ห้ามเพิ่มรหัสที่อื่น**):

```ts
// api/errors.ts — PosErrorCode gains
  | 'COUNT_PENDING'            // R2: a shift of this device is 'counting' (นับเสร็จ แต่ยังไม่ยืนยัน) — confirm it before opening a new one
  | 'SHIFT_NOT_COUNTING'       // confirmCount/countSummary on a shift that is not counting/counted — detail = shiftId
  | 'Z_NOT_READY'              // R7: issueZ while an earlier counted shift has no Z yet, or the count is not confirmed — detail = that shiftId
  | 'BOT_CASH_REQUIRED'        // D68/§6.8: the Z of a central shift needs E4 bot cash (fetchBotCash first, online)
  | 'DAYO_Z_STATE_INVALID'     // §4.4 ข้อ 6: client.last_z_no/last_z_hash/last_z_until unreadable — detail = the raw last_z_no
  | 'Z_TOO_LARGE'              // R20: > 2000 POS bills / > 500 bot bills / > 500 cash movements in one Z
  | 'OFF_CATALOG_NOT_POSSIBLE' // R10/R11: this bill cannot be closed as off-catalog (use "ปิดไว้ในเครื่อง")
// app/permissions.ts — Action gains 'close_off_catalog' (owner only — D97)
```

- [ ] **Step 0: ตรวจชื่อจริงบน `main`** — `PosErrorCode` มี `OFFLINE` และ `REMEDY_NOT_ALLOWED` แล้ว (ก้อน 2 Task 15) · `Action` มี `sync_problems` (owner) · ถ้าไม่ตรง บันทึก Ruling แล้วใช้ชื่อจริง

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — เพิ่มใน `apps/pos/src/app/permissions.test.ts`

```ts
it('only an owner closes a bill as off-catalog (D91 · D97 · spec §4.10 order_off_catalog)', () => {
  expect(can('owner', 'close_off_catalog')).toBe(true)
  expect(can('manager', 'close_off_catalog')).toBe(false)
  expect(can('staff', 'close_off_catalog')).toBe(false)
})
it('everyone may count the drawer and start the Z; the owner PIN is the gate (D52 Q3b-2 · D101)', () => {
  for (const r of ['staff', 'manager', 'owner'] as const) {
    expect(can(r, 'count_cash')).toBe(true)
    expect(can(r, 'close_shift')).toBe(true)
  }
})
```

เพิ่มใน `apps/pos/src/ui/errors.test.ts`:

```ts
it.each(['COUNT_PENDING', 'SHIFT_NOT_COUNTING', 'Z_NOT_READY', 'BOT_CASH_REQUIRED', 'DAYO_Z_STATE_INVALID', 'Z_TOO_LARGE', 'OFF_CATALOG_NOT_POSSIBLE'] as const)('%s has Thai text', (code) => {
  const text = errorMessage(new Error(`${code}: x`))
  expect(text).not.toBe(TH.errUnexpected)
  expect(text).toMatch(/[฀-๿]/)
})
it('DAYO_Z_STATE_INVALID strips control characters from dayo\'s raw value', () => {
  expect(errorMessage(new Error('DAYO_Z_STATE_INVALID: 4‮1'))).toBe(TH.dayoZStateInvalid('41'))
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos exec vitest run src/app/permissions.test.ts src/ui/errors.test.ts` · คาด: FAIL (`close_off_catalog` ไม่ใช่ `Action` · รหัสใหม่ไม่มีใน `PosErrorCode`)

- [ ] **Step 3: ทำ** — `api/errors.ts` เพิ่ม 7 รหัสตาม Interfaces (คอมเมนต์ตามนั้น) · `app/permissions.ts`:

```ts
  | 'close_off_catalog' // D97: only an owner closes a rejected bill as off-catalog (PIN + reason at the API too)
const OWNER_ONLY_ACTIONS: readonly Action[] = ['void_any', 'price_diffs', 'device_setup', 'set_other_pin', 'sync_problems', 'backup', 'close_off_catalog']
```

`ui/th.ts` เพิ่ม:

```ts
  errCountPending: 'กะก่อนหน้านับเงินแล้วแต่ยังไม่ยืนยัน — ยืนยันการนับก่อนเปิดกะใหม่',
  errShiftNotCounting: 'กะนี้ไม่ได้อยู่ระหว่างนับเงิน — กลับไปหน้ากะแล้วลองใหม่',
  errZNotReady: 'ยังออกใบปิดกะนี้ไม่ได้ — ต้องออกใบปิดกะของกะก่อนหน้าก่อน',
  errBotCashRequired: 'ต้องดึงบิลเงินสดจากบอทก่อนออกใบปิดกะ — ต่ออินเทอร์เน็ตแล้วลองใหม่',
  errZTooLarge: 'กะนี้มีรายการมากเกินกว่าที่ใบปิดกะส่งได้ — แจ้งทีม POS',
  errOffCatalogNotPossible: 'บิลนี้ปิดเป็นบิลนอกแคตตาล็อกไม่ได้ — ใช้ "ปิดไว้ในเครื่อง" แทน',
  dayoZStateInvalidGeneric: 'ข้อมูลใบปิดกะล่าสุดจากระบบกลางอ่านไม่ได้ — ให้เจ้าของตรวจกุญแจเครื่องบนเว็บ dayo',
  dayoZStateInvalid: (v: string): string => `ข้อมูลใบปิดกะล่าสุดจากระบบกลางอ่านไม่ได้ (${v}) — ให้เจ้าของตรวจกุญแจเครื่องบนเว็บ dayo`,
```

`ui/errors.ts` เพิ่มใน `MESSAGES` (`COUNT_PENDING: TH.errCountPending` … `DAYO_Z_STATE_INVALID: TH.dayoZStateInvalidGeneric`) และกรณีพิเศษแบบเดียวกับ `DAYO_RECEIPT_NO_INVALID`:

```ts
  if (code === 'DAYO_Z_STATE_INVALID') {
    const value = raw.slice(code.length + 2).replace(/\p{C}/gu, '').slice(0, 32)
    return value === '' ? MESSAGES[code] : TH.dayoZStateInvalid(value)
  }
```

- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม · คาด PASS
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test` · คาด ผ่านทุกแพ็กเกจ
- [ ] **Step 6: commit** — `git add apps/pos/src/api/errors.ts apps/pos/src/ui/errors.ts apps/pos/src/ui/th.ts apps/pos/src/app/permissions.ts apps/pos/src/ui/errors.test.ts apps/pos/src/app/permissions.test.ts` · ข้อความ: `feat(pos): add block 3 error codes, Thai messages and the off-catalog permission`

---

## 3. สาย A — เงินและใบปิดกะใน `@dayo/domain`

### Task 2: สูตรเงินที่ควรมี + บิลบอท + เกณฑ์ ≥ + Z ที่มีเวลานับและช่วงบิลบอท

ผู้ทำ: domain-engineer (opus) · ผู้ตรวจเพิ่ม: **security-reviewer** (เงิน) · สเปก §4.10 (สูตร dayo · `z_report` · R-m1 · R-m2) · §6.8 · D36 · D54 · D101 · D102 · ruling R4, R9 (ส่วน `centralLastZ`), R17 · รอ: —

**Files:**
- Modify: `packages/domain/src/shift.ts`, `packages/domain/src/index.ts`, `packages/domain/test/shift.test.ts` (ตัวอย่างเดิม: `CashInputs` +2 ช่อง, `ZInput` +3 ช่อง, ความคาดหวังของ `varianceNeedsReason` ที่ตรึง `>`)
- Modify (R17 — ขั้นต่ำให้ repo เขียว): `apps/pos/src/api/close.ts` (ส่ง `countedAt: at`, `botWindow: null`, `botBills: []`), `apps/pos/src/api/shift-report.ts` (`varianceAlertSatang` คืน `effectiveVarianceAlertSatang(...)`), เทสต์ `apps/pos` ที่ตรึงว่า "ส่วนต่างเท่าเกณฑ์ไม่ต้องมีเหตุผล" → กลับเป็น "ต้องมีเหตุผล" (D102)
- Create: `packages/domain/test/shift-block3.test.ts`

**Interfaces:**
- Consumes: `assertSafeInt` (money.ts) · ของเดิมใน `shift.ts`
- Produces (Task 3, 4, 12, 13 ใช้):

```ts
export type CashInputs = {
  openingFloatSatang: number; cashSalesSatang: number; voidRefundsSatang: number; paidInSatang: number; paidOutSatang: number; dropsSatang: number
  drawerExpensesSatang: number // spec §4.10 cash.drawer_expenses — always 0 in block 3 (block 4 fills it)
  botCashSatang: number        // Σ bot/web cash bills of the E4 window (after, counted_at] — 0 until the Z is issued (D68)
}
export function expectedCashSatang(x: CashInputs): number   // may be negative (D54 Q3b-14)
export function withBotCash(x: CashInputs, botCashSatang: number): CashInputs
export function cashVarianceSatang(countedSatang: number, expectedSatang: number): number // counted − expected (negative = short) — the ONLY place it is computed (writeZ, confirmCount and the screen call it)
export const MIN_VARIANCE_ALERT_SATANG = 1
export function effectiveVarianceAlertSatang(settingSatang: number): number   // R4: max(1, setting)
export function varianceNeedsReason(varianceSatang: number, alertSatang: number): boolean // D102: |v| ≥ alert · alert < 1 throws
export type ZBotBill = { orderNo: string; version: number; source: string; soldAt: string | null; totalSatang: number; createdByName: string | null }
export type ZBotWindow = { after: string; until: string }
// ZInput gains: countedAt: string · botWindow: ZBotWindow | null · botBills: ZBotBill[]   (ZSnapshot = ZInput & … as before)
// ZChainWarning gains: centralLastZ?: { zNo: number; hash: string }   (R9 — optional: old snapshots keep their shape and hash)
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `packages/domain/test/shift-block3.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  buildZReport, cashInputsFromMovements, effectiveVarianceAlertSatang, expectedCashSatang, summarizeShiftSales,
  varianceNeedsReason, withBotCash, type CashInputs, type ZInput,
} from '../src/shift'

const cash0: CashInputs = { openingFloatSatang: 0, cashSalesSatang: 0, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0, drawerExpensesSatang: 0, botCashSatang: 0 }

describe('expected cash with bot cash and drawer expenses (spec 04 §4.10 · R-m1)', () => {
  it('each new component lands once, with its sign', () => {
    expect(expectedCashSatang({ ...cash0, botCashSatang: 1 })).toBe(1)
    expect(expectedCashSatang({ ...cash0, drawerExpensesSatang: 1 })).toBe(-1)
  })
  it('movements alone never carry bot cash or drawer expenses', () => {
    expect(cashInputsFromMovements(50_000, 13_000, [{ kind: 'PAID_OUT', amountSatang: 2_000 }])).toMatchObject({ botCashSatang: 0, drawerExpensesSatang: 0 })
  })
  it('withBotCash adds the E4 total and refuses a negative or fractional one', () => {
    expect(expectedCashSatang(withBotCash({ ...cash0, openingFloatSatang: 50_000 }, 15_550))).toBe(65_550)
    expect(() => withBotCash(cash0, -1)).toThrow(RangeError)
    expect(() => withBotCash(cash0, 0.5)).toThrow(RangeError)
  })
  it('goes negative when more was paid out than the drawer held (D54 Q3b-14)', () => {
    expect(expectedCashSatang({ ...cash0, paidOutSatang: 30_000 })).toBe(-30_000)
  })
})

describe('varianceNeedsReason uses ≥ (D102)', () => {
  it.each([[2_000, true], [-2_000, true], [1_999, false], [-1_999, false], [0, false]] as const)('variance %i at ฿20 → %s', (v, want) => {
    expect(varianceNeedsReason(v, 2_000)).toBe(want)
  })
  it('an alert below 1 satang is refused; a setting of 0 is used as 1 satang (ruling R4)', () => {
    expect(() => varianceNeedsReason(0, 0)).toThrow(RangeError)
    expect(effectiveVarianceAlertSatang(0)).toBe(1)
    expect(effectiveVarianceAlertSatang(2_000)).toBe(2_000)
    expect(varianceNeedsReason(0, effectiveVarianceAlertSatang(0))).toBe(false)
    expect(varianceNeedsReason(-1, effectiveVarianceAlertSatang(0))).toBe(true)
  })
})

const sales = summarizeShiftSales([{ id: 'o1', status: 'paid', subtotalSatang: 10_000, discountSatang: 0, totalSatang: 10_000, payments: [{ method: 'CASH', amountSatang: 10_000 }] }])
const COUNT_635 = [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 10_000, count: 1 }, { denominationSatang: 2_000, count: 1 }, { denominationSatang: 1_000, count: 1 }, { denominationSatang: 500, count: 1 }]
function zInput(over: Partial<ZInput> = {}): ZInput {
  return {
    shiftId: 's1', businessDate: '2026-09-25', deviceId: 'd1', zNo: 1, openedAt: '2026-09-25T02:00:00.000Z', openedBy: 'u1', openedQuick: false,
    countedAt: '2026-09-25T12:00:00.000Z', closedAt: '2026-09-25T12:05:00.000Z', closedBy: 'u1', countedBy: 'u2',
    sales, cash: withBotCash(cashInputsFromMovements(50_000, sales.cashSalesSatang, []), 3_500),
    countLines: COUNT_635, countedCashSatang: 63_500, varianceAlertSatang: 2_000, varianceReason: null, voids: [], bankQrTotalSatang: null, chainWarning: null,
    botWindow: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:00.000Z' },
    botBills: [{ orderNo: 'L260925-013', version: 1, source: 'line', soldAt: '2026-09-25T05:00:00+00:00', totalSatang: 3_500, createdByName: null }],
    ...over,
  }
}

describe('buildZReport with the count time and the bot window (D101 · spec §4.10 z_report)', () => {
  it('expected cash includes the bot bills; the snapshot freezes them', () => {
    const { snapshot } = buildZReport(zInput(), null)
    expect(snapshot).toMatchObject({ expectedCashSatang: 63_500, cashVarianceSatang: 0, countedAt: '2026-09-25T12:00:00.000Z', botBills: [{ orderNo: 'L260925-013', totalSatang: 3_500 }] })
  })
  it('refuses bot bills that do not add up to cash.botCashSatang', () => {
    expect(() => buildZReport(zInput({ botBills: [] }), null)).toThrow(/botCashSatang/)
  })
  it('refuses a window that does not end at countedAt, or does not move forward', () => {
    expect(() => buildZReport(zInput({ botWindow: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:01.000Z' } }), null)).toThrow(/until/)
    expect(() => buildZReport(zInput({ botWindow: { after: '2026-09-25T12:00:00.000Z', until: '2026-09-25T12:00:00.000Z' } }), null)).toThrow(/after/)
  })
  it('a local-only Z (no window) carries no bot bills (ruling R6)', () => {
    const local = zInput({ botWindow: null, botBills: [], cash: cashInputsFromMovements(50_000, sales.cashSalesSatang, []), countedCashSatang: 60_000, countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 10_000, count: 1 }] })
    expect(buildZReport(local, null).snapshot.botWindow).toBeNull()
    expect(() => buildZReport({ ...local, botBills: zInput().botBills }, null)).toThrow(/window/)
  })
  it('refuses times out of order: counted before opened, closed before counted', () => {
    expect(() => buildZReport(zInput({ countedAt: '2026-09-25T01:59:59.999Z' }), null)).toThrow(/countedAt/)
    expect(() => buildZReport(zInput({ closedAt: '2026-09-25T11:59:59.999Z' }), null)).toThrow(/closedAt/)
  })
  it('refuses the same bot bill twice', () => {
    const b = zInput().botBills[0]!
    expect(() => buildZReport(zInput({ botBills: [{ ...b, totalSatang: 1_500 }, { ...b, totalSatang: 2_000 }] }), null)).toThrow(/twice/)
  })
  it('short exactly ฿20.00 needs a reason (D102)', () => {
    const short = { countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 10_000, count: 1 }, { denominationSatang: 1_000, count: 1 }, { denominationSatang: 500, count: 1 }], countedCashSatang: 61_500 }
    expect(() => buildZReport(zInput(short), null)).toThrow(/reason/)
    expect(buildZReport(zInput({ ...short, varianceReason: 'ทอนผิด' }), null).snapshot.cashVarianceSatang).toBe(-2_000)
  })
  it('refuses an alert below 1 satang', () => {
    expect(() => buildZReport(zInput({ varianceAlertSatang: 0 }), null)).toThrow(RangeError)
  })
  it('a chain warning continuing from the central last Z needs a real hash (ruling R9)', () => {
    const w = { brokenShiftId: 'central', storedGrandTotalSatang: null, recomputedGrandTotalSatang: 0, acknowledgedBy: 'u1', unreadableZs: [], duplicateZNos: [], duplicateZNosTruncated: false, missingZNos: [], missingZNosTruncated: false, deletedShiftIds: [], deletedShiftIdsTruncated: false, zNoGap: 41 }
    const ok = buildZReport(zInput({ zNo: 42, chainWarning: { ...w, centralLastZ: { zNo: 41, hash: 'ab'.repeat(32) } } }), { zNo: 41, grandTotalSatang: 0 })
    expect(ok.snapshot.chainWarning?.centralLastZ).toEqual({ zNo: 41, hash: 'ab'.repeat(32) })
    expect(() => buildZReport(zInput({ zNo: 42, chainWarning: { ...w, centralLastZ: { zNo: 41, hash: 'nothex' } } }), { zNo: 41, grandTotalSatang: 0 })).toThrow(/centralLastZ/)
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/domain exec vitest run test/shift-block3.test.ts` · คาด: FAIL (typecheck/ไม่มี `withBotCash`)

- [ ] **Step 3: ทำ** — `packages/domain/src/shift.ts`:

```ts
// CashInputs: add the two fields of the Interfaces block (doc comment: spec 04 §4.10 R-m1 — dayo's formula, same order)
export function expectedCashSatang(x: CashInputs): number {
  return x.openingFloatSatang + x.cashSalesSatang - x.voidRefundsSatang + x.paidInSatang - x.paidOutSatang - x.dropsSatang - x.drawerExpensesSatang + x.botCashSatang
}

// cashInputsFromMovements: the initial object gains `drawerExpensesSatang: 0, botCashSatang: 0` (nothing else changes)

/** D68 · spec §6.8: the bot/web cash bills E4 returned for (after, counted_at] — added once, when the Z is issued. */
export function withBotCash(x: CashInputs, botCashSatang: number): CashInputs {
  assertNonNegInt(botCashSatang, 'botCashSatang')
  return { ...x, botCashSatang }
}

/** spec §4.10: variance = counted − expected (negative = short). The one formula; buildZReport uses it too. */
export function cashVarianceSatang(countedSatang: number, expectedSatang: number): number {
  assertNonNegInt(countedSatang, 'countedSatang')
  assertSafeInt(expectedSatang, 'expectedSatang') // may be negative (D54 Q3b-14)
  const v = countedSatang - expectedSatang
  assertSafeInt(v, 'cashVarianceSatang')
  return v
}

/** R4: the threshold actually used — a setting of 0 would ask for a reason (and alert dayo) on a perfect count. */
export const MIN_VARIANCE_ALERT_SATANG = 1
export function effectiveVarianceAlertSatang(settingSatang: number): number {
  assertNonNegInt(settingSatang, 'settingSatang')
  return Math.max(MIN_VARIANCE_ALERT_SATANG, settingSatang)
}

/** D102 (amends D98): one rule on the tablet and at dayo — a shortage or overage of at least the threshold needs a reason. */
export function varianceNeedsReason(varianceSatang: number, alertSatang: number): boolean {
  assertSafeInt(varianceSatang, 'varianceSatang')
  assertSafeInt(alertSatang, 'alertSatang')
  if (alertSatang < MIN_VARIANCE_ALERT_SATANG) throw new RangeError(`alertSatang must be >= ${MIN_VARIANCE_ALERT_SATANG}, got ${alertSatang}`)
  return Math.abs(varianceSatang) >= alertSatang
}

export type ZBotBill = { orderNo: string; version: number; source: string; soldAt: string | null; totalSatang: number; createdByName: string | null }
export type ZBotWindow = { after: string; until: string }
// ZChainWarning: add
  /** R9: this Z continues the key's numbering from dayo (E1 client.last_z_no/last_z_hash) after a reinstall. */
  centralLastZ?: { zNo: number; hash: string }
// ZInput: add after `countedBy`
  /** D101: the instant "นับเสร็จ" was pressed — the shift took no bill or cash movement after it. */
  countedAt: string
  /** spec §4.10 E4 window (after, until = countedAt]; null for a local-only shift (ruling R6). */
  botWindow: ZBotWindow | null
  /** The bot/web cash bills of that window, frozen as E4 returned them (spec §4.10 bot_bills). */
  botBills: ZBotBill[]
```

ใน `buildZReport` เพิ่มก่อนบรรทัด `const expected = …` (ข้อความ error ต้องมีคำที่เทสต์จับ):

```ts
  const ms = (iso: string, name: string): number => {
    const t = Date.parse(iso)
    if (Number.isNaN(t)) throw new RangeError(`${name} is not an instant`)
    return t
  }
  if (ms(input.countedAt, 'countedAt') < ms(input.openedAt, 'openedAt')) throw new RangeError('countedAt must not be before openedAt (D101)')
  if (ms(input.closedAt, 'closedAt') < ms(input.countedAt, 'countedAt')) throw new RangeError('closedAt must not be before countedAt (spec §4.10 shift_close)')
  const seenBot = new Set<string>()
  let botSum = 0
  for (const b of input.botBills) {
    if (b.orderNo.trim() === '') throw new RangeError('bot bill needs an orderNo')
    if (seenBot.has(b.orderNo)) throw new RangeError(`bot bill ${b.orderNo} counted twice`)
    seenBot.add(b.orderNo)
    assertNonNegInt(b.totalSatang, `bot bill ${b.orderNo} totalSatang`)
    assertSafeInt(b.version, `bot bill ${b.orderNo} version`)
    botSum += b.totalSatang
  }
  if (input.botWindow === null) {
    if (input.botBills.length > 0 || input.cash.botCashSatang !== 0) throw new RangeError('bot bills need a bot window (ruling R6: a local-only Z has none)')
  } else {
    if (input.botWindow.until !== input.countedAt) throw new RangeError('botWindow.until must equal countedAt (spec §4.10 bot_window)')
    if (ms(input.botWindow.after, 'botWindow.after') >= ms(input.botWindow.until, 'botWindow.until')) throw new RangeError('botWindow.after must be before until')
  }
  if (botSum !== input.cash.botCashSatang) throw new RangeError('Σ botBills.totalSatang must equal cash.botCashSatang (spec §4.10 bot_bills)')
  if (input.varianceAlertSatang < MIN_VARIANCE_ALERT_SATANG) throw new RangeError('varianceAlertSatang must be >= 1 satang (ruling R4)')
  const cz = input.chainWarning?.centralLastZ
  if (cz !== undefined) {
    assertSafeInt(cz.zNo, 'chainWarning.centralLastZ.zNo')
    if (cz.zNo < 1 || !/^[0-9a-f]{64}$/.test(cz.hash)) throw new RangeError('chainWarning.centralLastZ needs zNo >= 1 and a 64-hex hash')
  }
```

`buildZReport` ใช้ `const variance = cashVarianceSatang(input.countedCashSatang, expected)` แทนการลบเอง · เทสต์เพิ่มใน `shift-block3.test.ts`: `expect(cashVarianceSatang(61_500, 63_500)).toBe(-2_000)` · `expect(cashVarianceSatang(0, -30_000)).toBe(30_000)` · `expect(() => cashVarianceSatang(-1, 0)).toThrow(RangeError)` · ข้อความ error ของเหตุผล: `'a cash variance at or above the alert threshold needs a reason (D102)'` · snapshot (รายการฟิลด์ชัดเจน M-5) เพิ่ม `countedAt: input.countedAt, botWindow: input.botWindow, botBills: input.botBills` ต่อจาก `countedBy` · `index.ts` export ของใหม่ทั้งหมด

R17 (ใน `apps/pos` ให้ repo เขียว — **ไม่เปลี่ยนพฤติกรรมอื่น**): `close.ts` ในการเรียก `buildZReport` เพิ่ม `countedAt: at, botWindow: null, botBills: []` · `shift-report.ts`:

```ts
export async function varianceAlertSatang(db: RemoteDb, atIso: string): Promise<number> {
  const v = await getSetting(db, VARIANCE_ALERT_SETTING_KEY, atIso)
  return effectiveVarianceAlertSatang(typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : DEFAULT_VARIANCE_ALERT_SATANG) // R4
}
```

`packages/domain/test/shift.test.ts`: ทุก `CashInputs` เพิ่ม `drawerExpensesSatang: 0, botCashSatang: 0` · ทุก `ZInput` เพิ่ม `countedAt: <closedAt เดิม>, botWindow: null, botBills: []` · บรรทัด 162–167 เปลี่ยนเป็น `(2_000, 2_000) → true`, `(-2_000, 2_000) → true`, `(1_999, 2_000) → false`, `(0, 1) → false`, `(1, 1) → true` และ `varianceNeedsReason(0, 0)` → `toThrow(RangeError)`

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/domain test` · `pnpm --filter @dayo/pos test` · คาด PASS (เทสต์ `apps/pos` ที่ตรึง "เท่าเกณฑ์ไม่ต้องมีเหตุผล" ถูกแก้ตาม D102 ใน step นี้)
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 6: commit** — stage `packages/domain/src/shift.ts packages/domain/src/index.ts packages/domain/test/shift.test.ts packages/domain/test/shift-block3.test.ts apps/pos/src/api/close.ts apps/pos/src/api/shift-report.ts` + เทสต์ `apps/pos` ที่แก้ (ระบุชื่อไฟล์) · ข้อความ: `feat(domain): add bot cash, drawer expenses and the count window to the Z`

### Task 3: ตัวสร้าง `data` ของ E2 ชนิดกะ · `shift_close` + `z_report` · บิลนอกแคตตาล็อก · `shift_id` ของบิล

ผู้ทำ: domain-engineer (opus) · ผู้ตรวจเพิ่ม: **security-reviewer** (เงินข้ามขอบ · บิลนอกแคตตาล็อก) · สเปก §4.2 · §4.10 (ตารางทุกชนิด · `z_report` · `order_off_catalog`) · ruling R10, R20 · รอ: Task 2, **Task 5** (ชนิดของ contracts)

**Files:**
- Create: `packages/domain/src/shift-rows.ts`, `packages/domain/src/off-catalog-row.ts`, `packages/domain/test/shift-rows.test.ts`, `packages/domain/test/off-catalog-row.test.ts`
- Modify: `packages/domain/src/order-row.ts` (`shiftId`), `packages/domain/src/index.ts`, `packages/domain/test/order-row.test.ts` (ตัวอย่างเดิมเพิ่ม `shiftId: null`), `packages/domain/test/money-edge-guard.test.ts` (เพิ่มสองไฟล์ใหม่ในรายการที่ห้าม import `bahtToSatang`)

**Interfaces:**
- Consumes: `edgeSatangToBaht`, `edgeBahtToSatang` · `tallyCashCount`, `CashCountLine`, `CashKind`, `ZSnapshot` (Task 2) · `ShiftOpenRowData`, `CashMovementRowData`, `CashCountRowData`, `ShiftCloseRowData`, `OrderOffCatalogRowData`, `OrderRowData`, `bangkokDateOf`, `clipCodePoints` (Task 5)
- Produces (Task 11, 12, 14 ใช้):

```ts
// shift-rows.ts
export const MAX_Z_POS_BILLS = 2000, MAX_Z_BOT_BILLS = 500, MAX_Z_MOVEMENTS = 500
export class ZTooLargeError extends RangeError {}                       // message starts "Z_TOO_LARGE:"
export const CASH_PAYMENT_CODE = 'cash'                                 // dayo's cash code — the only cash side (spec §4.10 การคิดซ้ำ ข้อ 2)
export type ShiftOpenRowInput = { shiftId: string; businessDate: string; openedAt: string; openedBy: string; openingFloatSatang: number; quickOpen: boolean }
export function buildShiftOpenRowData(i: ShiftOpenRowInput): ShiftOpenRowData
export type CashMovementRowInput = { movementId: string; shiftId: string; kind: CashKind; amountSatang: number; posOrderId: string | null; reason: string | null; createdBy: string; createdAt: string }
export function buildCashMovementRowData(i: CashMovementRowInput): CashMovementRowData
export type CashCountRowInput = { countId: string; shiftId: string; lines: readonly CashCountLine[]; countedBy: string; countedAt: string }
export function buildCashCountRowData(i: CashCountRowInput): CashCountRowData
export type ZPosBill = { posOrderId: string; receiptNo: string; paymentCode: string; totalSatang: number; soldAt: string; voidedAt: string | null }
export type ShiftCloseRowInput = { snapshot: ZSnapshot; hash: string; prevHash: string | null; countId: string; posBills: readonly ZPosBill[]; movementIds: readonly string[] }
export function buildShiftCloseRowData(i: ShiftCloseRowInput): ShiftCloseRowData
// off-catalog-row.ts
export type OffCatalogItem = { menuCode: string; menuNameTh: string; size: string | null; sweetness: string | null; qty: number; unitPriceSatang: number; discountPerCupSatang: number; lineTotalSatang: number }
export type OffCatalogInput = { order: OrderRowData; items: readonly OffCatalogItem[]; closedBy: string; closedAt: string; reason: string; originalReason: string }
export class OffCatalogError extends Error { readonly code: 'UNREPRESENTABLE' | 'BAD_REASON' }
export function buildOffCatalogRowData(i: OffCatalogInput): OrderOffCatalogRowData
// order-row.ts: OrderRowInput gains `shiftId: string | null` → data.shift_id
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `packages/domain/test/shift-rows.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { CashCountRowData, CashMovementRowData, fieldsUsed, BLOCK3_SUPPORTED_FIELDS, ShiftCloseRowData, ShiftOpenRowData } from '@dayo/contracts'
import { buildCashCountRowData, buildCashMovementRowData, buildShiftCloseRowData, buildShiftOpenRowData, ZTooLargeError, type ZPosBill } from '../src/shift-rows'
import { buildZReport, cashInputsFromMovements, summarizeShiftSales, withBotCash } from '../src/shift'

const S = '5a5a5a5a-0000-4000-8000-000000000001'
const U = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'
const O1 = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21'
const M1 = '6b6b6b6b-0000-4000-8000-000000000001'
const C1 = '7c7c7c7c-0000-4000-8000-000000000001'

describe('shift rows (spec 04 §4.10)', () => {
  it('shift_open: baht at the edge, schema-valid, only supported fields', () => {
    const d = buildShiftOpenRowData({ shiftId: S, businessDate: '2026-09-25', openedAt: '2026-09-25T02:00:00.000Z', openedBy: U, openingFloatSatang: 50_050, quickOpen: false })
    expect(ShiftOpenRowData.parse(d)).toEqual({ shift_id: S, business_date: '2026-09-25', opened_at: '2026-09-25T02:00:00.000Z', opened_by: U, opening_float: 500.5, quick_open: false })
    expect(fieldsUsed(d).every((f) => (BLOCK3_SUPPORTED_FIELDS.shift_open as readonly string[]).includes(f))).toBe(true)
  })
  it('cash_movement: VOID_REFUND carries the bill and may have no reason; PAID_OUT needs one', () => {
    const v = buildCashMovementRowData({ movementId: M1, shiftId: S, kind: 'VOID_REFUND', amountSatang: 4_500, posOrderId: O1, reason: null, createdBy: U, createdAt: '2026-09-25T03:00:00.000Z' })
    expect(CashMovementRowData.parse(v)).toMatchObject({ kind: 'VOID_REFUND', amount: 45, pos_order_id: O1, reason: null })
    expect(() => buildCashMovementRowData({ movementId: M1, shiftId: S, kind: 'PAID_OUT', amountSatang: 2_000, posOrderId: null, reason: null, createdBy: U, createdAt: '2026-09-25T03:00:00.000Z' })).toThrow(/reason/)
  })
  it('cash_count: nine lines in baht, counted = Σ', () => {
    const d = buildCashCountRowData({ countId: C1, shiftId: S, lines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 500, count: 3 }], countedBy: U, countedAt: '2026-09-25T12:00:00.000Z' })
    expect(CashCountRowData.parse(d).lines).toHaveLength(9)
    expect(d).toMatchObject({ counted: 515, lines: expect.arrayContaining([{ denomination: 1000, count: 0 }, { denomination: 5, count: 3 }]) })
  })
})

function z(posCashSatang: number, bot = 3_500) {
  const sales = summarizeShiftSales([{ id: O1, status: 'paid', subtotalSatang: posCashSatang, discountSatang: 0, totalSatang: posCashSatang, payments: [{ method: 'CASH', amountSatang: posCashSatang }] }])
  const cash = withBotCash(cashInputsFromMovements(50_000, sales.cashSalesSatang, []), bot)
  const total = 50_000 + posCashSatang + bot
  return buildZReport({
    shiftId: S, businessDate: '2026-09-25', deviceId: 'd1', zNo: 3, openedAt: '2026-09-25T02:00:00.000Z', openedBy: U, openedQuick: false,
    countedAt: '2026-09-25T12:00:00.000Z', closedAt: '2026-09-25T12:05:00.000Z', closedBy: U, countedBy: U, sales, cash,
    countLines: [{ denominationSatang: 100, count: total / 100 }], countedCashSatang: total, varianceAlertSatang: 2_000, varianceReason: null,
    voids: [], bankQrTotalSatang: null, chainWarning: null,
    botWindow: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:00.000Z' },
    botBills: bot === 0 ? [] : [{ orderNo: 'L260925-013', version: 2, source: 'line', soldAt: null, totalSatang: bot, createdByName: null }],
  }, { zNo: 2, grandTotalSatang: 0 })
}
const bill: ZPosBill = { posOrderId: O1, receiptNo: 'A-000312', paymentCode: 'cash', totalSatang: 10_000, soldAt: '2026-09-25T03:00:00.000Z', voidedAt: null }

describe('shift_close (spec 04 §4.10 z_report · R-m2)', () => {
  it('carries the components in baht, the chain and every list', () => {
    const { snapshot, hash } = z(10_000)
    const d = buildShiftCloseRowData({ snapshot, hash, prevHash: 'cd'.repeat(32), countId: C1, posBills: [bill], movementIds: [M1] })
    const parsed = ShiftCloseRowData.parse(d)
    expect(parsed).toMatchObject({ shift_id: S, count_id: C1, closed_by: U, closed_at: '2026-09-25T12:05:00.000Z', variance_reason: null })
    expect(parsed.z_report).toEqual({
      z_no: 3, hash, prev_hash: 'cd'.repeat(32), variance_alert: 20, chain_warning: false,
      cash: { opening_float: 500, pos_cash_sales: 100, void_refunds: 0, paid_in: 0, paid_out: 0, drops: 0, drawer_expenses: 0, bot_cash: 35 },
      counted: 635, bot_window: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:00.000Z' }, movement_ids: [M1],
      bot_bills: [{ order_no: 'L260925-013', version: 2, total: 35 }],
      pos_bills: [{ pos_order_id: O1, receipt_no: 'A-000312', payment: 'cash', total: 100, sold_at: '2026-09-25T03:00:00.000Z', voided_at: null }],
    })
  })
  it('refuses pos_bills whose cash does not equal the Z cash sales', () => {
    const { snapshot, hash } = z(10_000)
    expect(() => buildShiftCloseRowData({ snapshot, hash, prevHash: null, countId: C1, posBills: [{ ...bill, paymentCode: 'qr' }], movementIds: [] })).toThrow(/pos_bills/)
  })
  it('refuses a bill sold after the count, and a local-only Z', () => {
    const { snapshot, hash } = z(10_000)
    expect(() => buildShiftCloseRowData({ snapshot, hash, prevHash: null, countId: C1, posBills: [{ ...bill, soldAt: '2026-09-25T12:00:00.001Z' }], movementIds: [] })).toThrow(/countedAt/)
    expect(() => buildShiftCloseRowData({ snapshot: { ...snapshot, botWindow: null }, hash, prevHash: null, countId: C1, posBills: [bill], movementIds: [] })).toThrow(/window/)
  })
  it('refuses more than 2000 POS bills (ruling R20)', () => {
    const { snapshot, hash } = z(10_000)
    const many = Array.from({ length: 2001 }, () => ({ ...bill, paymentCode: 'qr' }))
    expect(() => buildShiftCloseRowData({ snapshot, hash, prevHash: null, countId: C1, posBills: [...many, bill], movementIds: [] })).toThrow(ZTooLargeError)
  })
})
```

`packages/domain/test/off-catalog-row.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { OrderOffCatalogRowData, type OrderRowData } from '@dayo/contracts'
import { buildOffCatalogRowData, OffCatalogError, type OffCatalogItem } from '../src/off-catalog-row'

const O1 = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21'
const U = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'
const order: OrderRowData = {
  pos_order_id: O1, receipt_no: 'A-000312', queue_no: 12, sale_date: '2026-09-25', sold_at: '2026-09-25T03:15:03.120Z', channel: 'store', payment: 'cash',
  staff_id: U, catalog_version: 42, shift_id: '5a5a5a5a-0000-4000-8000-000000000001',
  lines: [{ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 3 }], bill_discount: null, promo_code: null,
  skip_promotion_ids: [], no_promotions: false, totals: { items_subtotal: 105, items_discount: 35, bill_discount: 0, total: 70 }, note: null,
}
const base = { order, closedBy: U, closedAt: '2026-09-26T02:00:00.000Z', reason: 'เมนูถูกลบในระบบกลาง', originalReason: 'UNKNOWN_CODE' }

describe('order_off_catalog data (spec 04 §4.10 · D97 · ruling R10)', () => {
  it('keeps the frozen money: per-cup discount when it divides exactly', () => {
    const items: OffCatalogItem[] = [{ menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', size: '16 oz', sweetness: '50%', qty: 2, unitPriceSatang: 3_500, discountPerCupSatang: 0, lineTotalSatang: 7_000 },
      { menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', size: '16 oz', sweetness: '50%', qty: 1, unitPriceSatang: 3_500, discountPerCupSatang: 3_500, lineTotalSatang: 0 }]
    const d = OrderOffCatalogRowData.parse(buildOffCatalogRowData({ ...base, items }))
    expect(d.totals).toEqual({ items_subtotal: 105, items_discount: 35, bill_discount: 0, total: 70 })
    expect(d).toMatchObject({ sale_date: '2026-09-25', original_reason: 'UNKNOWN_CODE', closed_by: U, lines: [{ name: 'ชาไทย', line_total: 70 }, { discount_per_cup: 35, line_total: 0 }] })
  })
  it('moves a discount that does not divide per cup into the bill discount; subtotal and total never change', () => {
    const items: OffCatalogItem[] = [{ menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', size: '16 oz', sweetness: '50%', qty: 3, unitPriceSatang: 3_500, discountPerCupSatang: 1_167, lineTotalSatang: 7_000 }]
    const d = OrderOffCatalogRowData.parse(buildOffCatalogRowData({ ...base, items }))
    expect(d.lines[0]).toMatchObject({ unit_price: 35, discount_per_cup: 0, line_total: 105 })
    expect(d.totals).toEqual({ items_subtotal: 105, items_discount: 0, bill_discount: 35, total: 70 })
  })
  it('a menu code longer than 40 goes as null; an empty Thai name falls back to the code', () => {
    const long = 'X'.repeat(41)
    const d = buildOffCatalogRowData({ ...base, order: { ...order, totals: { items_subtotal: 70, items_discount: 0, bill_discount: 0, total: 70 } }, items: [{ menuCode: long, menuNameTh: '', size: null, sweetness: null, qty: 2, unitPriceSatang: 3_500, discountPerCupSatang: 0, lineTotalSatang: 7_000 }] })
    expect(d.lines[0]).toMatchObject({ code: null, name: long.slice(0, 100) })
  })
  it('an empty size or sweetness goes as null, and the row still parses (review item 2)', () => {
    const d = buildOffCatalogRowData({ ...base, order: { ...order, totals: { items_subtotal: 70, items_discount: 0, bill_discount: 0, total: 70 } }, items: [{ menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', size: '', sweetness: '  ', qty: 2, unitPriceSatang: 3_500, discountPerCupSatang: 0, lineTotalSatang: 7_000 }] })
    expect(d.lines[0]).toMatchObject({ size: null, sweetness: null })
    expect(OrderOffCatalogRowData.safeParse(d).success).toBe(true)
  })
  it('refuses when the frozen total is above what the lines can explain (never invents money)', () => {
    const items: OffCatalogItem[] = [{ menuCode: 'Thai Tea', menuNameTh: 'ชาไทย', size: '16 oz', sweetness: '50%', qty: 1, unitPriceSatang: 3_500, discountPerCupSatang: 0, lineTotalSatang: 3_500 }]
    expect(() => buildOffCatalogRowData({ ...base, items })).toThrow(OffCatalogError)
  })
  it('refuses an original reason dayo could not have sent', () => {
    expect(() => buildOffCatalogRowData({ ...base, originalReason: 'STUCK?', items: [] })).toThrow(OffCatalogError)
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/domain exec vitest run test/shift-rows.test.ts test/off-catalog-row.test.ts` · คาด FAIL (ไม่มีโมดูล)

- [ ] **Step 3: ทำ** — `packages/domain/src/shift-rows.ts`

```ts
import type { CashCountRowData, CashMovementRowData, ShiftCloseRowData, ShiftOpenRowData } from '@dayo/contracts'
import { edgeSatangToBaht as b } from './money-edge.js'
import { tallyCashCount, type CashCountLine, type CashKind, type ZSnapshot } from './shift.js'

export const MAX_Z_POS_BILLS = 2000
export const MAX_Z_BOT_BILLS = 500
export const MAX_Z_MOVEMENTS = 500
export const CASH_PAYMENT_CODE = 'cash'

/** Ruling R20 · spec §4.10 m4: dayo refuses a Z over these caps (INVALID) — the tablet refuses first. */
export class ZTooLargeError extends RangeError {
  constructor(what: string, n: number, max: number) {
    super(`Z_TOO_LARGE: ${what} ${n} > ${max}`)
    this.name = 'ZTooLargeError'
  }
}

export type ShiftOpenRowInput = { shiftId: string; businessDate: string; openedAt: string; openedBy: string; openingFloatSatang: number; quickOpen: boolean }
export function buildShiftOpenRowData(i: ShiftOpenRowInput): ShiftOpenRowData {
  return { shift_id: i.shiftId, business_date: i.businessDate, opened_at: i.openedAt, opened_by: i.openedBy, opening_float: b(i.openingFloatSatang), quick_open: i.quickOpen }
}

export type CashMovementRowInput = { movementId: string; shiftId: string; kind: CashKind; amountSatang: number; posOrderId: string | null; reason: string | null; createdBy: string; createdAt: string }
export function buildCashMovementRowData(i: CashMovementRowInput): CashMovementRowData {
  if (!Number.isSafeInteger(i.amountSatang) || i.amountSatang <= 0) throw new RangeError('cash movement amount must be > 0')
  if ((i.kind === 'VOID_REFUND') !== (i.posOrderId !== null)) throw new RangeError('only VOID_REFUND carries pos_order_id (spec §4.10)')
  if (i.kind !== 'VOID_REFUND' && (i.reason === null || i.reason.trim() === '')) throw new RangeError(`${i.kind} needs a reason (D52 Q3b-9)`)
  return { movement_id: i.movementId, shift_id: i.shiftId, kind: i.kind, amount: b(i.amountSatang), pos_order_id: i.posOrderId, reason: i.reason, created_by: i.createdBy, created_at: i.createdAt }
}

export type CashCountRowInput = { countId: string; shiftId: string; lines: readonly CashCountLine[]; countedBy: string; countedAt: string }
export function buildCashCountRowData(i: CashCountRowInput): CashCountRowData {
  const t = tallyCashCount(i.lines)
  return {
    count_id: i.countId, shift_id: i.shiftId,
    lines: t.lines.map((l) => ({ denomination: b(l.denominationSatang), count: l.count })), // satang → baht only at the edge (review item 8) · whole-baht notes/coins (D52 Q3b-1)
    counted: b(t.totalSatang), counted_by: i.countedBy, counted_at: i.countedAt,
  }
}

export type ZPosBill = { posOrderId: string; receiptNo: string; paymentCode: string; totalSatang: number; soldAt: string; voidedAt: string | null }
export type ShiftCloseRowInput = { snapshot: ZSnapshot; hash: string; prevHash: string | null; countId: string; posBills: readonly ZPosBill[]; movementIds: readonly string[] }

/** spec 04 §4.10 shift_close + z_report — built from the frozen snapshot only; the lists are the shift's rows at Z time. */
export function buildShiftCloseRowData(i: ShiftCloseRowInput): ShiftCloseRowData {
  const z = i.snapshot
  if (z.botWindow === null) throw new RangeError('a Z sent to dayo needs its bot window (ruling R6: local-only Zs are never sent)')
  if (i.posBills.length > MAX_Z_POS_BILLS) throw new ZTooLargeError('pos_bills', i.posBills.length, MAX_Z_POS_BILLS)
  if (z.botBills.length > MAX_Z_BOT_BILLS) throw new ZTooLargeError('bot_bills', z.botBills.length, MAX_Z_BOT_BILLS)
  if (i.movementIds.length > MAX_Z_MOVEMENTS) throw new ZTooLargeError('movement_ids', i.movementIds.length, MAX_Z_MOVEMENTS)
  const until = Date.parse(z.countedAt)
  let posCash = 0
  for (const p of i.posBills) {
    if (Date.parse(p.soldAt) > until) throw new RangeError(`bill ${p.receiptNo} sold after countedAt — the shift was frozen (D101)`)
    if (p.paymentCode === CASH_PAYMENT_CODE) posCash += p.totalSatang
  }
  if (posCash !== z.cash.cashSalesSatang) throw new RangeError(`pos_bills cash ${posCash} ≠ cash.cashSalesSatang ${z.cash.cashSalesSatang}`)
  const c = z.cash
  return {
    shift_id: z.shiftId, count_id: i.countId, closed_by: z.closedBy, closed_at: z.closedAt, variance_reason: z.varianceReason,
    z_report: {
      z_no: z.zNo, hash: i.hash, prev_hash: i.prevHash, variance_alert: b(z.varianceAlertSatang), chain_warning: z.chainWarning !== null,
      cash: {
        opening_float: b(c.openingFloatSatang), pos_cash_sales: b(c.cashSalesSatang), void_refunds: b(c.voidRefundsSatang), paid_in: b(c.paidInSatang),
        paid_out: b(c.paidOutSatang), drops: b(c.dropsSatang), drawer_expenses: b(c.drawerExpensesSatang), bot_cash: b(c.botCashSatang),
      },
      counted: b(z.countedCashSatang),
      bot_window: { after: z.botWindow.after, until: z.botWindow.until },
      movement_ids: [...i.movementIds],
      bot_bills: z.botBills.map((x) => ({ order_no: x.orderNo, version: x.version, total: b(x.totalSatang) })),
      pos_bills: i.posBills.map((x) => ({ pos_order_id: x.posOrderId, receipt_no: x.receiptNo, payment: x.paymentCode, total: b(x.totalSatang), sold_at: x.soldAt, voided_at: x.voidedAt })),
    },
  }
}
```

`packages/domain/src/off-catalog-row.ts`:

```ts
import { bangkokDateOf, clipCodePoints, type OrderOffCatalogRowData, type OrderRowData } from '@dayo/contracts'
import { edgeBahtToSatang, edgeSatangToBaht as b } from './money-edge.js'

export type OffCatalogItem = { menuCode: string; menuNameTh: string; size: string | null; sweetness: string | null; qty: number; unitPriceSatang: number; discountPerCupSatang: number; lineTotalSatang: number }
export type OffCatalogInput = { order: OrderRowData; items: readonly OffCatalogItem[]; closedBy: string; closedAt: string; reason: string; originalReason: string }
export class OffCatalogError extends Error {
  readonly code: 'UNREPRESENTABLE' | 'BAD_REASON'
  constructor(code: 'UNREPRESENTABLE' | 'BAD_REASON', detail: string) { super(`${code}: ${detail}`); this.name = 'OffCatalogError'; this.code = code }
}

/** An empty/blank text (or one longer than dayo takes) goes as null — dayo refuses '' for size/sweetness. */
const blankToNull = (v: string | null, max: number): string | null => (v === null || v.trim() === '' || [...v].length > max ? null : v)

/**
 * D91 · D97 · spec §4.10 order_off_catalog: the bill as the tablet froze it — never new money. Ruling R10: a line keeps
 * its per-cup discount only when (unit − dpc) × qty is exactly its frozen total; otherwise the line goes at full price
 * and the difference joins the bill discount. items_subtotal and total are always the frozen ones.
 */
export function buildOffCatalogRowData(i: OffCatalogInput): OrderOffCatalogRowData {
  if (!/^[A-Z_]{1,40}$/.test(i.originalReason)) throw new OffCatalogError('BAD_REASON', i.originalReason)
  const o = i.order
  const total = edgeBahtToSatang(o.totals.total)
  let sub = 0
  let idisc = 0
  const lines = i.items.map((it) => {
    const exact = it.discountPerCupSatang <= it.unitPriceSatang && (it.unitPriceSatang - it.discountPerCupSatang) * it.qty === it.lineTotalSatang
    const dpc = exact ? it.discountPerCupSatang : 0
    sub += it.unitPriceSatang * it.qty
    idisc += dpc * it.qty
    const name = it.menuNameTh.trim() === '' ? it.menuCode : it.menuNameTh
    return {
      code: it.menuCode.trim() !== '' && [...it.menuCode].length <= 40 ? it.menuCode : null, name: clipCodePoints(name, 100),
      size: blankToNull(it.size, 20), sweetness: blankToNull(it.sweetness, 10), qty: it.qty, // dayo: 1–20 / 1–10 or null (review item 2)
      unit_price: b(it.unitPriceSatang), discount_per_cup: b(dpc), line_total: b((it.unitPriceSatang - dpc) * it.qty),
    }
  })
  const bdisc = sub - idisc - total
  if (bdisc < 0) throw new OffCatalogError('UNREPRESENTABLE', `lines give ${sub - idisc}, the bill took ${total}`)
  return {
    pos_order_id: o.pos_order_id, receipt_no: o.receipt_no, queue_no: o.queue_no, sale_date: bangkokDateOf(o.sold_at), sold_at: o.sold_at,
    channel: o.channel, payment: o.payment, staff_id: o.staff_id, catalog_version: o.catalog_version, shift_id: o.shift_id, note: o.note,
    lines, totals: { items_subtotal: b(sub), items_discount: b(idisc), bill_discount: b(bdisc), total: b(total) },
    closed_by: i.closedBy, closed_at: i.closedAt, reason: i.reason, original_reason: i.originalReason,
  }
}
```

`order-row.ts`: `OrderRowInput` เพิ่ม `shiftId: string | null` และ `shift_id: i.shiftId` (คอมเมนต์: `// block 3: the shift id of a central shift, null for a local-only one (spec §4.5 shift_id · §4.10 ข้อ 4)`) · `index.ts` export ทั้งสองโมดูล

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/domain test` · คาด PASS
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test` (ผู้เรียก `buildOrderRowData` ใน `apps/pos/src/api/sale.ts` ส่ง `shiftId: null` ชั่วคราว — Task 11 ใส่ค่าจริง · บรรทัดเดียว R17)
- [ ] **Step 6: commit** — stage ไฟล์ตาม Files + `apps/pos/src/api/sale.ts` · ข้อความ: `feat(domain): build the block 3 push rows and the off-catalog bill`

### Task 4: parity เงินที่ควรมี แท็บเล็ต = สูตร dayo (รวมติดลบ)

ผู้ทำ: domain-engineer (opus) · ผู้ตรวจเพิ่ม: **security-reviewer** (เงิน) · สเปก §4.10 "dayo คิดเอง" + R-m1 · D84 · D102 · รอ: Task 2, **Task 5** (fixture `parity/pos-shift-cash-parity.json` + `ShiftCashParityFile` — **ชื่อและรูปเดียวกับที่แผน 08 ของ dayo ใช้**: `{cases:[{name, cash, counted, expected, variance}]}` เงินเป็นบาท · แท็บเล็ตแปลงที่ขอบ)

**Files:**
- Create: `packages/domain/test/shift-cash-parity.test.ts`

**Interfaces:**
- Consumes: `ShiftCashParityFile` (Task 5) · `expectedCashSatang`, `varianceNeedsReason`, `edgeBahtToSatang`, `edgeSatangToBaht` (Task 2)
- Produces: เกณฑ์ §9 ก้อน 3 ข้อสุดท้าย "parity สูตรเงินที่ควรมีแท็บเล็ต = dayo (รวมติดลบ)"

- [ ] **Step 1: เขียนเทสต์** — `packages/domain/test/shift-cash-parity.test.ts`

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ShiftCashParityFile } from '@dayo/contracts'
import { edgeBahtToSatang, edgeSatangToBaht } from '../src/money-edge'
import { expectedCashSatang, varianceNeedsReason, type CashInputs } from '../src/shift'

const file = ShiftCashParityFile.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../contracts/fixtures/parity/pos-shift-cash-parity.json', import.meta.url)), 'utf8')))
/** D102 at the default ฿20 — tablet-only expectations kept here, not in the shared file (its shape is fixed with dayo). */
const NEEDS_REASON_AT_20: Record<string, boolean> = {
  'ขายเงินสดอย่างเดียว นับตรง': false, 'สถานการณ์แผน 3b + บิลบอท ขาด 0.50': false, 'เงินคืน เงินเข้า จ่ายออก นำออก ขาดพอดี 20.00': true,
  'ขาด 19.99 ไม่ต้องมีเหตุผล': false, 'ติดลบ — จ่ายออกเกินเงินในลิ้นชัก (D54 Q3b-14)': true, 'ติดลบพร้อมบิลบอท': true,
  'ค่าที่ float ชอบพลาด': false, 'ค่าใช้จ่ายจากลิ้นชัก (ก้อน 4)': false,
}
type Wire = (typeof file.cases)[number]['cash']

/** dayo's formula exactly as numeric(10,2): decimal text → integer cents (BigInt), no float on the way (spec §4.10). */
function cents(v: number): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(v.toFixed(2))
  if (m === null) throw new Error(`not money: ${v}`)
  const c = BigInt(m[2]!) * 100n + BigInt((m[3] ?? '').padEnd(2, '0'))
  return m[1] === '-' ? -c : c
}
function dayoExpected(c: Wire): bigint {
  return cents(c.opening_float) + cents(c.pos_cash_sales) - cents(c.void_refunds) + cents(c.paid_in) - cents(c.paid_out) - cents(c.drops) - cents(c.drawer_expenses) + cents(c.bot_cash)
}
function tablet(c: Wire): CashInputs {
  return {
    openingFloatSatang: edgeBahtToSatang(c.opening_float), cashSalesSatang: edgeBahtToSatang(c.pos_cash_sales), voidRefundsSatang: edgeBahtToSatang(c.void_refunds),
    paidInSatang: edgeBahtToSatang(c.paid_in), paidOutSatang: edgeBahtToSatang(c.paid_out), dropsSatang: edgeBahtToSatang(c.drops),
    drawerExpensesSatang: edgeBahtToSatang(c.drawer_expenses), botCashSatang: edgeBahtToSatang(c.bot_cash),
  }
}

describe('expected cash parity with dayo (spec 04 §4.10 · R-m1 · D84 fixture)', () => {
  it.each(file.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const expected = expectedCashSatang(tablet(c.cash))
    expect(BigInt(expected)).toBe(dayoExpected(c.cash))
    expect(BigInt(expected)).toBe(cents(c.expected))                 // hand-computed in the fixture
    const variance = edgeBahtToSatang(c.counted) - expected
    expect(BigInt(variance)).toBe(cents(c.variance))
    if (c.name in NEEDS_REASON_AT_20) expect(varianceNeedsReason(variance, 2_000)).toBe(NEEDS_REASON_AT_20[c.name]) // D102 ≥
  })
  it('every D102 expectation still names a case of the shared file', () => {
    expect(Object.keys(NEEDS_REASON_AT_20).every((n) => file.cases.some((c) => c.name === n))).toBe(true)
  })
  it('the fixture has a negative expected-cash case (D54 Q3b-14)', () => {
    expect(file.cases.some((c) => c.expected < 0)).toBe(true)
  })
  it('property: any non-negative components give the same satang both ways', () => {
    const money = fc.integer({ min: 0, max: 10_000_000 })
    fc.assert(fc.property(fc.tuple(money, money, money, money, money, money, money, money), (v) => {
      const [of, pos, vr, pin, pout, dr, dex, bot] = v
      const x: CashInputs = { openingFloatSatang: of, cashSalesSatang: pos, voidRefundsSatang: vr, paidInSatang: pin, paidOutSatang: pout, dropsSatang: dr, drawerExpensesSatang: dex, botCashSatang: bot }
      const wire = { opening_float: edgeSatangToBaht(of), pos_cash_sales: edgeSatangToBaht(pos), void_refunds: edgeSatangToBaht(vr), paid_in: edgeSatangToBaht(pin), paid_out: edgeSatangToBaht(pout), drops: edgeSatangToBaht(dr), drawer_expenses: edgeSatangToBaht(dex), bot_cash: edgeSatangToBaht(bot) }
      return BigInt(expectedCashSatang(x)) === dayoExpected(wire)
    }), { numRuns: 20_000 })
  })
})
```

- [ ] **Step 2: รัน** — `pnpm --filter @dayo/domain exec vitest run test/shift-cash-parity.test.ts` · คาด PASS ทันที (Task 2 และ 5 ทำแล้ว) · **ถ้าล้ม = ห้ามแก้ fixture ให้ผ่าน** — ตรวจเลขคิดมือใน fixture กับสูตรในสเปกก่อน ถ้า fixture ถูก ให้แก้โค้ด (§4.11 ข้อ 2)
- [ ] **Step 3: ตรวจว่าเทสต์จับผิดได้จริง** — ลองสลับเครื่องหมาย `drawerExpensesSatang` ใน `expectedCashSatang` ชั่วคราว → รันแล้วต้องล้ม → **คืนค่าเดิม** แล้วรันซ้ำให้ผ่าน (`git diff packages/domain/src` ต้องว่าง)
- [ ] **Step 4: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 5: commit** — `git add packages/domain/test/shift-cash-parity.test.ts` · ข้อความ: `test(domain): pin expected cash to dayo's formula, negatives included`

---

## 4. สาย B — สัญญา fixture และ mock

### Task 5: zod ของ 5 ชนิดใหม่ · ผลรับ · คำนำหน้า `detail` · E4 · E1 `last_z_*` · fixture parity

ผู้ทำ: domain-engineer (opus) · สเปก §4.1 (ความเข้ากันได้) · §4.4 ข้อ 6, 10 · §4.5 ข้อ 6 · §4.10 ก้อน 3 ทั้งหมด · §4.11 · C11 · C13 · D84 · รอ: —

**Files:**
- Modify: `packages/contracts/src/dayo-api.ts`, `packages/contracts/src/index.ts` (**ไม่แตะ `enums.ts` และไม่แตะ `apps/pos`** — รอบ 1 Task 2 ถือ `apps/pos/src/api/close.ts` อยู่ · การเปลี่ยน enum ที่ `apps/pos` ใช้ย้ายไป Task 9 รอบ 2)
- Create: `packages/contracts/fixtures/parity/pos-shift-cash-parity.json`, `packages/contracts/test/dayo-api-block3.test.ts`
- Modify tests: `packages/contracts/test/dayo-api.test.ts` (ที่อ้าง `ALREADY_PRESENT` / `PUSH_KINDS` 2 ชนิด)

**Interfaces:**
- Consumes: ของเดิมใน `dayo-api.ts` (`Uuid`, `IsoSent`, `IsoReceived`, `Ymd`, `Baht`, `Text200`, `RECEIPT_NO_RE`, `bangkokDateOf`)
- Produces (ทุกสายใช้):

```ts
export const PUSH_KINDS = ['order', 'order_void', 'shift_open', 'cash_movement', 'cash_count', 'shift_close', 'order_off_catalog'] as const
export type PushKind = (typeof PUSH_KINDS)[number]
export const SHIFT_LANE_KINDS = ['shift_open', 'cash_movement', 'cash_count', 'shift_close'] as const
export type Lane = 'bill' | 'shift'
export function laneOf(kind: string): Lane
export const KIND_ID_FIELD: Record<PushKind, string>
export const KIND_SCOPE: Record<PushKind, 'orders:write' | 'shift:write'>
export const rowKey: (kind: PushKind, id: string) => string
export const KNOWN_REJECT_REASONS = ['INVALID', 'BAD_KEY', 'UNKNOWN_CODE', 'UNKNOWN_STAFF', 'CONFLICT', 'FORBIDDEN'] as const // C13: no ALREADY_PRESENT
export const DETAIL_PREFIXES = ['scope:', 'role:', 'rule:', 'exists:', 'off_catalog_exists:', 'receipt_taken:', 'key_changed:', 'counted:', 'z_no_taken:', 'data_conflict:'] as const // data_conflict: = INVALID of the S5 class (§13.8 R5-2)
export type DetailPrefix = (typeof DETAIL_PREFIXES)[number]
export function detailPrefix(detail: string | null | undefined): DetailPrefix | null
export const CASH_DENOMINATIONS_BAHT = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const
export const Hex64: z.ZodString
export const ShiftOpenRowData, CashMovementRowData, CashCountRowData, ZReportData, ShiftCloseRowData, OrderOffCatalogRowData (+ types)
export const ShiftOpenAcceptedData, CashMovementAcceptedData, CashCountAcceptedData, ShiftCloseAcceptedData, OffCatalogAcceptedData, ExistsConflictData
export const ShiftCashBill, ShiftCashData, ShiftCashResponse (+ types)          // E4
export const BLOCK3_SUPPORTED_FIELDS: Record<'shift_open' | 'cash_movement' | 'cash_count' | 'shift_close' | 'order_off_catalog', readonly string[]>
export const ShiftCashParityFile                                                    // fixtures/parity/pos-shift-cash-parity.json = { cases: [{ name, cash, counted, expected, variance }] } baht (same file plan 08 uses)
// ClientInfo gains last_z_no?: number | null · last_z_hash?: string | null · last_z_until?: string | null (raw — checked where used, Task 13 · §13.8 R5-1)
// PushRow = discriminated union of all 7 kinds; key must be rowKey(kind, data[KIND_ID_FIELD[kind]])
// (enums.ts changes — ShiftStatus 4 values · ShiftSyncMode · OutboxStatus 'closed_off_catalog' · EventType +2 — are Task 9's, round 2)
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `packages/contracts/test/dayo-api-block3.test.ts`

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BLOCK3_SUPPORTED_FIELDS, CashCountRowData, CashMovementRowData, ClientInfo, detailPrefix, ExistsConflictData, fieldsUsed, KNOWN_REJECT_REASONS, laneOf,
  OrderOffCatalogRowData, PushRow, ShiftCashParityFile, ShiftCashResponse, ShiftCloseRowData, ShiftOpenRowData,
} from '../src/dayo-api'

const S = '5a5a5a5a-0000-4000-8000-000000000001'
const U = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'
const O = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21'
const M = '6b6b6b6b-0000-4000-8000-000000000001'
const C = '7c7c7c7c-0000-4000-8000-000000000001'
const H = 'ab'.repeat(32)
export const SAMPLE = {
  shift_open: { shift_id: S, business_date: '2026-09-25', opened_at: '2026-09-25T02:00:00.000Z', opened_by: U, opening_float: 500, quick_open: false },
  cash_movement: { movement_id: M, shift_id: S, kind: 'PAID_OUT', amount: 20, pos_order_id: null, reason: 'ซื้อน้ำแข็ง', created_by: U, created_at: '2026-09-25T04:00:00.000Z' },
  cash_count: { count_id: C, shift_id: S, lines: [1000, 500, 100, 50, 20, 10, 5, 2, 1].map((d) => ({ denomination: d, count: d === 500 ? 1 : d === 100 ? 1 : d === 10 ? 1 : d === 5 ? 1 : 0 })), counted: 615, counted_by: U, counted_at: '2026-09-25T12:00:00.000Z' },
  shift_close: {
    shift_id: S, count_id: C, closed_by: U, closed_at: '2026-09-25T12:05:00.000Z', variance_reason: null,
    z_report: {
      z_no: 1, hash: H, prev_hash: null, variance_alert: 20, chain_warning: false,
      cash: { opening_float: 500, pos_cash_sales: 45, void_refunds: 0, paid_in: 0, paid_out: 0, drops: 0, drawer_expenses: 0, bot_cash: 70 },
      counted: 615, bot_window: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:00.000Z' }, movement_ids: [],
      bot_bills: [{ order_no: 'L260925-901', version: 1, total: 70 }],
      pos_bills: [{ pos_order_id: O, receipt_no: 'A-000001', payment: 'cash', total: 45, sold_at: '2026-09-25T03:00:00.000Z', voided_at: null }],
    },
  },
  order_off_catalog: {
    pos_order_id: O, receipt_no: 'A-000001', queue_no: 1, sale_date: '2026-09-25', sold_at: '2026-09-25T03:00:00.000Z', channel: 'store', payment: 'cash',
    staff_id: U, catalog_version: 42, shift_id: S, note: null,
    lines: [{ code: 'Thai Tea', name: 'ชาไทย', size: '16 oz', sweetness: '50%', qty: 3, unit_price: 35, discount_per_cup: 0, line_total: 105 }],
    totals: { items_subtotal: 105, items_discount: 0, bill_discount: 35, total: 70 }, closed_by: U, closed_at: '2026-09-26T02:00:00.000Z', reason: 'เมนูถูกลบ', original_reason: 'UNKNOWN_CODE',
  },
} as const

describe('block 3 push rows (spec 04 §4.10)', () => {
  it.each(Object.entries(SAMPLE))('%s parses and uses only supported fields', (kind, data) => {
    const idField = { shift_open: 'shift_id', cash_movement: 'movement_id', cash_count: 'count_id', shift_close: 'shift_id', order_off_catalog: 'pos_order_id' }[kind]!
    const row = PushRow.parse({ key: `${kind}:${(data as Record<string, string>)[idField]}`, kind, data })
    expect(row.kind).toBe(kind)
    const allowed = BLOCK3_SUPPORTED_FIELDS[kind as keyof typeof BLOCK3_SUPPORTED_FIELDS] as readonly string[]
    expect(fieldsUsed(data as Record<string, unknown>).filter((f) => !allowed.includes(f))).toEqual([])
  })
  it('the key must carry the kind\'s own id field', () => {
    expect(PushRow.safeParse({ key: `cash_movement:${S}`, kind: 'cash_movement', data: SAMPLE.cash_movement }).success).toBe(false)
  })
  it('shift_open: business_date is the Thai date of opened_at', () => {
    expect(ShiftOpenRowData.safeParse({ ...SAMPLE.shift_open, opened_at: '2026-09-25T17:00:00.000Z' }).success).toBe(false)
  })
  it('cash_movement: VOID_REFUND ⇔ pos_order_id; a reason for the rest; amount > 0', () => {
    expect(CashMovementRowData.safeParse({ ...SAMPLE.cash_movement, kind: 'VOID_REFUND' }).success).toBe(false)
    expect(CashMovementRowData.safeParse({ ...SAMPLE.cash_movement, reason: null }).success).toBe(false)
    expect(CashMovementRowData.safeParse({ ...SAMPLE.cash_movement, kind: 'VOID_REFUND', pos_order_id: O, reason: null }).success).toBe(true)
    expect(CashMovementRowData.safeParse({ ...SAMPLE.cash_movement, amount: 0 }).success).toBe(false)
  })
  it('cash_count: nine denominations once each, counted = Σ', () => {
    expect(CashCountRowData.safeParse({ ...SAMPLE.cash_count, counted: 614 }).success).toBe(false)
    expect(CashCountRowData.safeParse({ ...SAMPLE.cash_count, lines: SAMPLE.cash_count.lines.slice(1) }).success).toBe(false)
  })
  it('shift_close: bot bills add up to bot_cash; unknown sub-keys are refused (S28)', () => {
    const z = SAMPLE.shift_close.z_report
    expect(ShiftCloseRowData.safeParse({ ...SAMPLE.shift_close, z_report: { ...z, cash: { ...z.cash, bot_cash: 71 } } }).success).toBe(false)
    expect(ShiftCloseRowData.safeParse({ ...SAMPLE.shift_close, z_report: { ...z, cash: { ...z.cash, tips: 0 } } }).success).toBe(false)
    expect(ShiftCloseRowData.safeParse({ ...SAMPLE.shift_close, z_report: { ...z, bot_window: { after: z.bot_window.until, until: z.bot_window.until } } }).success).toBe(false)
  })
  it('order_off_catalog: the totals must follow the shared formula', () => {
    const t = SAMPLE.order_off_catalog.totals
    expect(OrderOffCatalogRowData.safeParse({ ...SAMPLE.order_off_catalog, totals: { ...t, total: 71 } }).success).toBe(false)
    expect(OrderOffCatalogRowData.safeParse({ ...SAMPLE.order_off_catalog, totals: { ...t, bill_discount: 106, total: 0 } }).success).toBe(false)
    expect(OrderOffCatalogRowData.safeParse({ ...SAMPLE.order_off_catalog, lines: [{ ...SAMPLE.order_off_catalog.lines[0], line_total: 104 }] }).success).toBe(false)
  })
})

describe('verdicts, prefixes, lanes (spec 04 §4.10 · §6.2)', () => {
  it('reads the machine prefix only', () => {
    expect(detailPrefix('scope: API key ไม่มีสิทธิ์ shift:write')).toBe('scope:')
    expect(detailPrefix('off_catalog_exists: L260925-014 …')).toBe('off_catalog_exists:')
    expect(detailPrefix('exists: L260925-014')).toBe('exists:')
    expect(detailPrefix('data_conflict: ยอดนับในใบปิดกะไม่ตรงกับการนับในระบบกลาง')).toBe('data_conflict:')
    expect(detailPrefix('เลขใบเสร็จ A-000312 ถูกใช้แล้ว')).toBeNull()
    expect(detailPrefix(undefined)).toBeNull()
  })
  it('ALREADY_PRESENT is gone (C13)', () => {
    expect(KNOWN_REJECT_REASONS as readonly string[]).not.toContain('ALREADY_PRESENT')
  })
  it('lanes: shift kinds in one lane, bills in the other', () => {
    expect(['shift_open', 'cash_movement', 'cash_count', 'shift_close'].map(laneOf)).toEqual(['shift', 'shift', 'shift', 'shift'])
    expect(['order', 'order_void', 'order_off_catalog', 'something_new'].map(laneOf)).toEqual(['bill', 'bill', 'bill', 'bill'])
  })
  it('exists: data is read from data, never from detail', () => {
    expect(ExistsConflictData.parse({ order_no: 'L260925-014', version: 2, reported_total: 70, payment_is_cash: true, off_catalog: false })).toMatchObject({ order_no: 'L260925-014' })
  })
  it('E1 client: last_z_* optional, raw (a bad value must not throw E1 away)', () => {
    expect(ClientInfo.parse({ name: 'x', last_receipt_no: null })).toBeTruthy()
    expect(ClientInfo.parse({ name: 'x', last_receipt_no: null, last_z_no: 41, last_z_hash: H, last_z_until: '2026-09-24T12:00:00.000Z' })).toMatchObject({ last_z_no: 41, last_z_until: '2026-09-24T12:00:00.000Z' })
    expect(ClientInfo.parse({ name: 'x', last_receipt_no: null, last_z_no: 41, last_z_hash: 'garbage', last_z_until: 'not a time' }).last_z_hash).toBe('garbage')
  })
  it('E4 answer parses; created_by_name may be null', () => {
    const r = ShiftCashResponse.parse({ ok: true, data: { bills: [{ order_no: 'L260925-901', version: 1, source: 'line', sold_at: '2026-09-25T04:00:00+00:00', total: 70, created_by_name: null }], cash_total: 70 } })
    expect(r.data.cash_total).toBe(70)
  })
  it('the parity fixture parses', () => {
    const f = ShiftCashParityFile.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/parity/pos-shift-cash-parity.json', import.meta.url)), 'utf8')))
    expect(f.cases.length).toBeGreaterThanOrEqual(8)
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/contracts exec vitest run test/dayo-api-block3.test.ts` · คาด FAIL

- [ ] **Step 3: ทำ** — `packages/contracts/src/dayo-api.ts` (เพิ่ม/แก้ · คอมเมนต์อ้างสเปก):

```ts
export const PUSH_KINDS = ['order', 'order_void', 'shift_open', 'cash_movement', 'cash_count', 'shift_close', 'order_off_catalog'] as const
export type PushKind = (typeof PUSH_KINDS)[number]
export const SHIFT_LANE_KINDS = ['shift_open', 'cash_movement', 'cash_count', 'shift_close'] as const
export type ShiftLaneKind = (typeof SHIFT_LANE_KINDS)[number]
export type Lane = 'bill' | 'shift'
/** spec §6.2: one shift lane per device; everything else (and any unknown kind) is the bill lane. */
export const laneOf = (kind: string): Lane => ((SHIFT_LANE_KINDS as readonly string[]).includes(kind) ? 'shift' : 'bill')
export const KIND_ID_FIELD: Record<PushKind, string> = { order: 'pos_order_id', order_void: 'pos_order_id', shift_open: 'shift_id', cash_movement: 'movement_id', cash_count: 'count_id', shift_close: 'shift_id', order_off_catalog: 'pos_order_id' }
export const KIND_SCOPE: Record<PushKind, 'orders:write' | 'shift:write'> = { order: 'orders:write', order_void: 'orders:write', order_off_catalog: 'orders:write', shift_open: 'shift:write', cash_movement: 'shift:write', cash_count: 'shift:write', shift_close: 'shift:write' }
export const rowKey = (kind: PushKind, id: string): string => `${kind}:${id}`
export const KNOWN_REJECT_REASONS = ['INVALID', 'BAD_KEY', 'UNKNOWN_CODE', 'UNKNOWN_STAFF', 'CONFLICT', 'FORBIDDEN'] as const // C13
/** spec §4.10 · §13.8 R5-2: `data_conflict:` prefixes the S5-class INVALID verdicts (Z counted ≠ the count in dayo · z_no above max + 50). */
export const DETAIL_PREFIXES = ['scope:', 'role:', 'rule:', 'exists:', 'off_catalog_exists:', 'receipt_taken:', 'key_changed:', 'counted:', 'z_no_taken:', 'data_conflict:'] as const
export type DetailPrefix = (typeof DETAIL_PREFIXES)[number]
/** spec §4.10: the tablet decides from this fixed prefix only — never from the Thai text after it. */
export function detailPrefix(detail: string | null | undefined): DetailPrefix | null {
  if (typeof detail !== 'string') return null
  return DETAIL_PREFIXES.find((p) => detail.startsWith(p)) ?? null
}
export const CASH_DENOMINATIONS_BAHT = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const
export const Hex64 = z.string().regex(/^[0-9a-f]{64}$/)
const cents = (baht: number): number => Math.round(baht * 100)
const PositiveBaht = Baht.refine((v) => v > 0, 'must be > 0')

export const ShiftOpenRowData = z.strictObject({ shift_id: Uuid, business_date: Ymd, opened_at: IsoSent, opened_by: Uuid, opening_float: Baht, quick_open: z.boolean() })
  .superRefine((d, ctx) => { if (bangkokDateOf(d.opened_at) !== d.business_date) ctx.addIssue({ code: 'custom', path: ['business_date'], message: 'business_date must be the Thai date of opened_at' }) })
export type ShiftOpenRowData = z.infer<typeof ShiftOpenRowData>
export const CashMovementRowData = z.strictObject({
  movement_id: Uuid, shift_id: Uuid, kind: z.enum(['PAID_IN', 'PAID_OUT', 'DROP', 'VOID_REFUND']), amount: PositiveBaht,
  pos_order_id: Uuid.nullable(), reason: Text200.nullable(), created_by: Uuid, created_at: IsoSent,
}).superRefine((d, ctx) => {
  if ((d.kind === 'VOID_REFUND') !== (d.pos_order_id !== null)) ctx.addIssue({ code: 'custom', path: ['pos_order_id'], message: 'pos_order_id only (and always) for VOID_REFUND' })
  if (d.kind !== 'VOID_REFUND' && d.reason === null) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'reason required for PAID_IN/PAID_OUT/DROP' })
})
export type CashMovementRowData = z.infer<typeof CashMovementRowData>
const CashCountLineData = z.strictObject({ denomination: z.number().int().refine((v) => (CASH_DENOMINATIONS_BAHT as readonly number[]).includes(v), 'unknown denomination'), count: z.number().int().min(0).max(99_999) })
export const CashCountRowData = z.strictObject({ count_id: Uuid, shift_id: Uuid, lines: z.array(CashCountLineData).length(9), counted: Baht, counted_by: Uuid, counted_at: IsoSent })
  .superRefine((d, ctx) => {
    if (new Set(d.lines.map((l) => l.denomination)).size !== 9) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'each denomination once' })
    if (cents(d.counted) !== d.lines.reduce((a, l) => a + l.denomination * 100 * l.count, 0)) ctx.addIssue({ code: 'custom', path: ['counted'], message: 'counted must equal Σ denomination × count' })
  })
export type CashCountRowData = z.infer<typeof CashCountRowData>
export const ZReportData = z.strictObject({
  z_no: z.number().int().min(1), hash: Hex64, prev_hash: Hex64.nullable(), variance_alert: Baht, chain_warning: z.boolean(),
  cash: z.strictObject({ opening_float: Baht, pos_cash_sales: Baht, void_refunds: Baht, paid_in: Baht, paid_out: Baht, drops: Baht, drawer_expenses: Baht, bot_cash: Baht }),
  counted: Baht, bot_window: z.strictObject({ after: IsoSent, until: IsoSent }),
  movement_ids: z.array(Uuid).max(500),
  bot_bills: z.array(z.strictObject({ order_no: z.string().min(1).max(40), version: z.number().int().min(1), total: Baht })).max(500),
  pos_bills: z.array(z.strictObject({ pos_order_id: Uuid, receipt_no: z.string().regex(RECEIPT_NO_RE), payment: z.string().min(1).max(100), total: Baht, sold_at: IsoSent, voided_at: IsoSent.nullable() })).max(2000),
}).superRefine((z0, ctx) => {
  if (Date.parse(z0.bot_window.after) >= Date.parse(z0.bot_window.until)) ctx.addIssue({ code: 'custom', path: ['bot_window'], message: 'after must be before until' })
  if (z0.bot_bills.reduce((a, b) => a + cents(b.total), 0) !== cents(z0.cash.bot_cash)) ctx.addIssue({ code: 'custom', path: ['bot_bills'], message: 'Σ bot_bills.total must equal cash.bot_cash' })
})
export const ShiftCloseRowData = z.strictObject({ shift_id: Uuid, count_id: Uuid, closed_by: Uuid, closed_at: IsoSent, variance_reason: Text200.nullable(), z_report: ZReportData })
export type ShiftCloseRowData = z.infer<typeof ShiftCloseRowData>
const OffCatalogLine = z.strictObject({
  code: z.string().min(1).max(40).nullable(), name: z.string().min(1).max(100), size: z.string().min(1).max(20).nullable(), sweetness: z.string().min(1).max(10).nullable(),
  qty: z.number().int().min(1).max(999), unit_price: Baht, discount_per_cup: Baht, line_total: Baht,
}).refine((l) => l.discount_per_cup <= l.unit_price && cents(l.line_total) === (cents(l.unit_price) - cents(l.discount_per_cup)) * l.qty, 'line_total = (unit_price − discount_per_cup) × qty')
export const OrderOffCatalogRowData = z.strictObject({
  pos_order_id: Uuid, receipt_no: z.string().regex(RECEIPT_NO_RE), queue_no: z.number().int().min(1).max(9999), sale_date: Ymd, sold_at: IsoSent,
  channel: z.string().min(1).max(100), payment: z.string().min(1).max(100), staff_id: Uuid, catalog_version: z.number().int().min(1), shift_id: Uuid.nullable(), note: Text200.nullable(),
  lines: z.array(OffCatalogLine).min(1).max(50), totals: z.strictObject({ items_subtotal: Baht, items_discount: Baht, bill_discount: Baht, total: Baht }),
  closed_by: Uuid, closed_at: IsoSent, reason: Text200, original_reason: z.string().regex(/^[A-Z_]{1,40}$/),
}).superRefine((d, ctx) => {
  const issue = (path: string, message: string): void => { ctx.addIssue({ code: 'custom', path: [path], message }) }
  if (bangkokDateOf(d.sold_at) !== d.sale_date) issue('sale_date', 'sale_date must be the Thai date of sold_at')
  if (Date.parse(d.closed_at) < Date.parse(d.sold_at)) issue('closed_at', 'closed_at must not be before sold_at')
  const sub = d.lines.reduce((a, l) => a + cents(l.unit_price) * l.qty, 0)
  const idisc = d.lines.reduce((a, l) => a + cents(l.discount_per_cup) * l.qty, 0)
  const t = d.totals
  if (cents(t.items_subtotal) !== sub) issue('totals', 'items_subtotal = Σ unit_price × qty')
  if (cents(t.items_discount) !== idisc) issue('totals', 'items_discount = Σ discount_per_cup × qty')
  if (cents(t.items_discount) + cents(t.bill_discount) > cents(t.items_subtotal)) issue('totals', 'discounts must not exceed items_subtotal (orders_discount_le_subtotal)')
  if (cents(t.total) !== Math.max(0, cents(t.items_subtotal) - cents(t.items_discount) - cents(t.bill_discount))) issue('totals', 'total = max(0, subtotal − discounts)')
})
export type OrderOffCatalogRowData = z.infer<typeof OrderOffCatalogRowData>

// accepted/duplicate data (spec §4.10 — no negative money, no cost) and the exists: conflict data (m2)
export const ShiftOpenAcceptedData = z.looseObject({ shift_id: Uuid })
export const CashMovementAcceptedData = z.looseObject({ movement_id: Uuid })
export const CashCountAcceptedData = z.looseObject({ count_id: Uuid })
export const ShiftCloseAcceptedData = z.looseObject({ shift_id: Uuid })
export const OffCatalogAcceptedData = z.looseObject({ order_no: z.string(), version: z.number().int() })
export const ExistsConflictData = z.looseObject({ order_no: z.string(), version: z.number().int(), reported_total: z.number().finite().nonnegative(), payment_is_cash: z.boolean(), off_catalog: z.boolean() })
export type ExistsConflictData = z.infer<typeof ExistsConflictData>

// E4 GET /v1/pos/shift-cash (spec §4.10) — tolerant on receive
export const ShiftCashBill = z.looseObject({ order_no: z.string().min(1), version: z.number().int(), source: z.string(), sold_at: IsoReceived.nullable(), total: z.number().finite().nonnegative(), created_by_name: z.string().nullable() })
export type ShiftCashBill = z.infer<typeof ShiftCashBill>
export const ShiftCashData = z.looseObject({ bills: z.array(ShiftCashBill), cash_total: z.number().finite().nonnegative() })
export type ShiftCashData = z.infer<typeof ShiftCashData>
export const ShiftCashResponse = z.looseObject({ ok: z.literal(true), data: ShiftCashData })

/** spec §4.4 rule 10 · §4.10: the field list dayo's E1 must advertise for each new kind (sorted, dotted for lines.*). */
export const BLOCK3_SUPPORTED_FIELDS = {
  shift_open: ['business_date', 'opened_at', 'opened_by', 'opening_float', 'quick_open', 'shift_id'],
  cash_movement: ['amount', 'created_at', 'created_by', 'kind', 'movement_id', 'pos_order_id', 'reason', 'shift_id'],
  cash_count: ['count_id', 'counted', 'counted_at', 'counted_by', 'lines', 'lines.count', 'lines.denomination', 'shift_id'],
  shift_close: ['closed_at', 'closed_by', 'count_id', 'shift_id', 'variance_reason', 'z_report'],
  order_off_catalog: ['catalog_version', 'channel', 'closed_at', 'closed_by', 'lines', 'lines.code', 'lines.discount_per_cup', 'lines.line_total', 'lines.name', 'lines.qty', 'lines.size', 'lines.sweetness', 'lines.unit_price', 'note', 'original_reason', 'payment', 'pos_order_id', 'queue_no', 'reason', 'receipt_no', 'sale_date', 'shift_id', 'sold_at', 'staff_id', 'totals'],
} as const

// fixtures/parity/pos-shift-cash-parity.json (D84 — POS owns it; hand-computed, never edited to make a test pass).
// Name and shape fixed with dayo's plan 08: { cases: [{ name, cash, counted, expected, variance }] }, money in baht, expected/variance may be negative.
const SignedBaht = z.number().finite().refine((v) => Math.abs(v * 100 - Math.round(v * 100)) <= 1e-6, 'at most 2 decimals')
export const ShiftCashParityFile = z.strictObject({
  cases: z.array(z.strictObject({
    name: z.string().min(1), cash: ZReportData.innerType().shape.cash, counted: Baht, expected: SignedBaht, variance: SignedBaht,
  })).min(1),
})
export type ShiftCashParityFile = z.infer<typeof ShiftCashParityFile>
```

(`ZReportData.innerType()` = schema ก่อน `superRefine` ใน zod 4 — ถ้า API ต่าง ให้แยก `const ZCash = z.strictObject({...})` ไว้ใช้ทั้งสองที่)

`ClientInfo` เพิ่ม `last_z_no: z.number().int().nullable().optional(), last_z_hash: z.string().nullable().optional(), last_z_until: z.string().nullable().optional()` (คอมเมนต์: raw like last_receipt_no — Task 13 checks · `last_z_until` = counted_at of the same Z as last_z_hash (highest non-quarantined), §13.8 R5-1/R5-3) · `PushRow`:

```ts
const rowOf = <K extends PushKind, T extends z.ZodType>(kind: K, data: T) => z.strictObject({ key: rowKeyField, kind: z.literal(kind), data })
export const PushRow = z.discriminatedUnion('kind', [
  rowOf('order', OrderRowData), rowOf('order_void', OrderVoidRowData), rowOf('shift_open', ShiftOpenRowData), rowOf('cash_movement', CashMovementRowData),
  rowOf('cash_count', CashCountRowData), rowOf('shift_close', ShiftCloseRowData), rowOf('order_off_catalog', OrderOffCatalogRowData),
]).refine((r) => r.key === rowKey(r.kind, (r.data as Record<string, string>)[KIND_ID_FIELD[r.kind]]!), { message: 'key must be <kind>:<id field of the kind>', path: ['key'] })
```

`index.ts` export ของใหม่ทั้งหมด (enum ไม่อยู่ใน task นี้)

`packages/contracts/fixtures/parity/pos-shift-cash-parity.json` (เลขคิดมือ — ตรวจแล้วในแผน · รูปเดียวกับแผน 08 · ความคาดหวังเรื่องเหตุผล D102 อยู่ในเทสต์ Task 4 ไม่อยู่ในไฟล์ร่วม):

```json
{
  "cases": [
    { "name": "ขายเงินสดอย่างเดียว นับตรง", "cash": { "opening_float": 500, "pos_cash_sales": 130, "void_refunds": 0, "paid_in": 0, "paid_out": 0, "drops": 0, "drawer_expenses": 0, "bot_cash": 0 }, "counted": 630, "expected": 630, "variance": 0 },
    { "name": "สถานการณ์แผน 3b + บิลบอท ขาด 0.50", "cash": { "opening_float": 500, "pos_cash_sales": 130, "void_refunds": 90, "paid_in": 0, "paid_out": 20, "drops": 0, "drawer_expenses": 0, "bot_cash": 155.5 }, "counted": 675, "expected": 675.5, "variance": -0.5 },
    { "name": "เงินคืน เงินเข้า จ่ายออก นำออก ขาดพอดี 20.00", "cash": { "opening_float": 1000, "pos_cash_sales": 2345.75, "void_refunds": 45.25, "paid_in": 100, "paid_out": 250.5, "drops": 2000, "drawer_expenses": 0, "bot_cash": 0 }, "counted": 1130, "expected": 1150, "variance": -20 },
    { "name": "ขาด 19.99 ไม่ต้องมีเหตุผล", "cash": { "opening_float": 500, "pos_cash_sales": 0, "void_refunds": 0, "paid_in": 0, "paid_out": 0, "drops": 0, "drawer_expenses": 0, "bot_cash": 0 }, "counted": 480.01, "expected": 500, "variance": -19.99 },
    { "name": "ติดลบ — จ่ายออกเกินเงินในลิ้นชัก (D54 Q3b-14)", "cash": { "opening_float": 0, "pos_cash_sales": 0, "void_refunds": 0, "paid_in": 0, "paid_out": 300, "drops": 0, "drawer_expenses": 0, "bot_cash": 0 }, "counted": 0, "expected": -300, "variance": 300 },
    { "name": "ติดลบพร้อมบิลบอท", "cash": { "opening_float": 100, "pos_cash_sales": 50, "void_refunds": 50, "paid_in": 0, "paid_out": 120.1, "drops": 200, "drawer_expenses": 0, "bot_cash": 19.99 }, "counted": 0, "expected": -200.11, "variance": 200.11 },
    { "name": "ค่าที่ float ชอบพลาด", "cash": { "opening_float": 0.1, "pos_cash_sales": 0.2, "void_refunds": 0, "paid_in": 59.97, "paid_out": 0, "drops": 0, "drawer_expenses": 0, "bot_cash": 37.45 }, "counted": 97.72, "expected": 97.72, "variance": 0 },
    { "name": "ค่าใช้จ่ายจากลิ้นชัก (ก้อน 4)", "cash": { "opening_float": 500, "pos_cash_sales": 0, "void_refunds": 0, "paid_in": 0, "paid_out": 0, "drops": 0, "drawer_expenses": 120, "bot_cash": 0 }, "counted": 380, "expected": 380, "variance": 0 }
  ]
}
```

(ถ้าแผน 08 ส่งเคสเพิ่มในไฟล์เดียวกันภายหลัง รับเพิ่มได้ทันทีโดยไม่แก้เทสต์ — `NEEDS_REASON_AT_20` ของ Task 4 ตรวจเฉพาะชื่อที่มันรู้จัก)

แก้ `test/dayo-api.test.ts` เดิมที่อ้าง `ALREADY_PRESENT` หรือ `PUSH_KINDS.length === 2`

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/contracts test` · คาด PASS
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test` · ถ้าล้มใน `apps/pos` (เช่นโค้ดก้อน 2 ที่ตรึง `PushKind` สองชนิดแบบ exhaustive หรืออ้าง `'ALREADY_PRESENT'`) **ห้ามแก้ `apps/pos` ใน task นี้** — หยุด บันทึก `Ruling:` แล้วหัวหน้าย้ายการแก้นั้นไป Task 9 (รอบ 2) และ merge Task 5 พร้อม Task 9
- [ ] **Step 6: commit** — stage ไฟล์ตาม Files · ข้อความ: `feat(contracts): add the block 3 push kinds, E4 and the expected-cash parity fixture`

### Task 6: mock — ชนิดกะ · `scope:` · กติกา `z_no` · E4 · E1 `last_z_*` · คำนำหน้าก้อน 3

ผู้ทำ: sync-engineer (opus) · สเปก §4.5 ข้อ 0, 6 · §4.10 (กติการ่วม · ตารางชนิดกะ · ลำดับ `z_no` ข้อ 0–6 · E4) · ruling R15 · รอ: Task 5

**Files:**
- Create: `packages/dayo-mock/src/judge-util.ts` (ตัวช่วยตรวจค่าที่ย้ายออกจาก `judge.ts` ให้ `judge-shift.ts`/`judge-off-catalog.ts` ใช้ร่วม), `packages/dayo-mock/src/judge-shift.ts`, `packages/dayo-mock/src/shift-cash.ts`, `packages/dayo-mock/test/helpers-block3.ts`, `packages/dayo-mock/test/shift-kinds.test.ts`, `packages/dayo-mock/test/z-chain.test.ts`
- Modify: `packages/dayo-mock/src/{state,judge,handler,control,server,index}.ts`
- Modify: `apps/pos/test/helpers/dayo.ts` (ตัวเลือก `block3` และ `openShift` — **ไฟล์นี้เป็นของ Task 6 ในรอบ 2** · Task 10/11 ในรอบ 3 ใช้ ไม่แก้)

**Interfaces:**
- Consumes: Task 5 ทั้งหมด (`KIND_ID_FIELD`, `SHIFT_LANE_KINDS`, `BLOCK3_SUPPORTED_FIELDS`, `CASH_DENOMINATIONS_BAHT`, `detailPrefix`)
- Produces (Task 7, 8, 10–17 ใช้):

```ts
// MockOptions gains block3?: boolean (R15 — default false: block-2 tests keep their supported lists)
// ALL_SCOPES (block3) = [...block-2 scopes, 'shift:write']
export type MockShift = { id: string; businessDate: string; openedAt: number; openedBy: string; openingFloat: number; quickOpen: boolean; status: 'open' | 'counted' | 'closed'; closedBy: string | null; closedAt: number | null; dataConflict: boolean }
export type MockMovement = { id: string; shiftId: string; kind: 'PAID_IN' | 'PAID_OUT' | 'DROP' | 'VOID_REFUND'; amount: number; posOrderId: string | null; reason: string | null; createdBy: string; createdAt: number }
export type MockCount = { id: string; shiftId: string; counted: number; countedBy: string; countedAt: number }
export type MockZ = { shiftId: string; zNo: number; hash: string; prevHash: string | null; after: number; countedAt: number; wire: Record<string, unknown>
  firstOfKey: boolean                                // rule 2: the key had no Z when this one arrived
  quarantined: boolean                               // §13.8 R5-3: failed rule 5 (replay / out-of-order low z_no) — never "the previous Z" of anyone
  chainBreak: boolean; notes: string[]; chainMismatch: string[]; recomputeStatus: 'waiting_bills' | 'matched' | 'mismatch'; detail: string[]
  missing: { posOrderIds: string[]; movementIds: string[]; voidOrderIds: string[] } }
// MockMode gains 'offline': mock.fetch rejects with TypeError('Failed to fetch') — a real network failure for the tablet (review item 9)
// MockDayo gains:
setBlock3(on: boolean): number                     // adds/removes the 5 kinds + BLOCK3_SUPPORTED_FIELDS + shift:write; bumps catalog_version
shifts(): MockShift[]; movements(): MockMovement[]; counts(): MockCount[]; zReports(): MockZ[]
preloadZ(z: { zNo: number; hash: string; countedAt: string }): void   // a Z another install of this key sent (reinstall tests — R9)
conflicts(): string[]                              // S5 flags the mock raised ('key_changed' | 'counted' | 'z_no_taken' | 'z_no_ceiling' | 'counted_mismatch'): shift id
// E1 client (spec 04 R5-3, same rule as plan 08): last_z_no = highest z_no of every Z (quarantined included — the number is used) ·
//   last_z_hash / last_z_until = of the highest NON-quarantined Z (stored or preloaded) · they
//   OVERRIDE catalog.client ONLY WHEN SUCH A Z EXISTS — otherwise whatever bumpCatalog set stays (review item 3) · last_z_until = new Date(countedAt).toISOString() ("2026-09-24T12:00:00.000Z" form, same as plan 08 — review item 10)
// route GET /api/v1/pos/shift-cash?after=&until= (scope orders:read) → { bills, cash_total } from seeded bot/web bills (R15: sold_at stands for created_at)
// test helper (apps/pos/test/helpers/dayo.ts): openConnectedApi(opts: { now?: string; block3?: boolean; openShift?: boolean /* default true; false → t.shift = null */ })
// judge-shift.ts
export function chainOf(s: MockState, z: MockZ): Pick<MockZ, 'chainBreak' | 'notes' | 'chainMismatch'> // rules 2–4 (pure, re-run by Task 8 for rule 6) · reads z.quarantined (set once in zGate at receipt — R5-3 sticky)
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `packages/dayo-mock/test/shift-kinds.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { createMockDayo, MOCK_API_KEY } from '../src/index'

const NOW = '2026-09-25T12:10:00.000Z'
const S = '5a5a5a5a-0000-4000-8000-000000000001'
const U = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'   // TungAo, owner (rich fixture)
const STAFF_ONLY = '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0' // Mint, staff
const M = '6b6b6b6b-0000-4000-8000-000000000001'
const C = '7c7c7c7c-0000-4000-8000-000000000001'
const open = { shift_id: S, business_date: '2026-09-25', opened_at: '2026-09-25T02:00:00.000Z', opened_by: U, opening_float: 500, quick_open: false }
const lines = [1000, 500, 100, 50, 20, 10, 5, 2, 1].map((d) => ({ denomination: d, count: d === 500 ? 1 : 0 }))
const count = { count_id: C, shift_id: S, lines, counted: 500, counted_by: U, counted_at: '2026-09-25T12:00:00.000Z' }

async function push(mock: ReturnType<typeof createMockDayo>, rows: unknown[]) {
  const r = await mock.fetch('http://localhost:8787/api/v1/pos/push', { method: 'POST', headers: { authorization: `Bearer ${MOCK_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ device_time: NOW, rows }) })
  return ((await r.json()) as { data: { results: { key: string; status: string; reason?: string; detail?: string; data?: unknown }[] } }).data.results
}
const row = (kind: string, id: string, data: unknown) => ({ key: `${kind}:${id}`, kind, data })

describe('mock shift kinds (spec 04 §4.10)', () => {
  it('without block3 the kinds are UNSUPPORTED (deferred) — block-2 behaviour kept (R15)', async () => {
    const mock = createMockDayo({ now: NOW })
    expect((await push(mock, [row('shift_open', S, open)]))[0]).toMatchObject({ status: 'deferred', reason: 'UNSUPPORTED' })
  })
  it('shift_open → cash_count in one request are accepted in order; the result data is just the id', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    const r = await push(mock, [row('shift_open', S, open), row('cash_count', C, count)])
    expect(r.map((x) => [x.status, x.data])).toEqual([['accepted', { shift_id: S }], ['accepted', { count_id: C }]])
    expect(mock.shifts()[0]).toMatchObject({ status: 'counted' })
  })
  it('a child before its shift waits (PARENT_PENDING)', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    expect((await push(mock, [row('cash_count', C, count)]))[0]).toMatchObject({ status: 'deferred', reason: 'PARENT_PENDING' })
  })
  it('a key without shift:write: shift rows FORBIDDEN "scope:", a bill in the same request still passes', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    mock.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write'])
    const r = await push(mock, [row('shift_open', S, open)])
    expect(r[0]).toMatchObject({ status: 'rejected', reason: 'FORBIDDEN' })
    expect(r[0]!.detail!.startsWith('scope:')).toBe(true)
  })
  it('a second count of the shift = CONFLICT "counted:" and a data-conflict flag (S5)', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    await push(mock, [row('shift_open', S, open), row('cash_count', C, count)])
    const other = '7c7c7c7c-0000-4000-8000-000000000002'
    const r = await push(mock, [row('cash_count', other, { ...count, count_id: other })])
    expect(r[0]).toMatchObject({ status: 'rejected', reason: 'CONFLICT' })
    expect(r[0]!.detail!.startsWith('counted:')).toBe(true)
    expect(mock.conflicts()).toContain(`counted:${S}`)
  })
  it('the same key with other content = CONFLICT "key_changed:"', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    await push(mock, [row('shift_open', S, open)])
    expect((await push(mock, [row('shift_open', S, { ...open, opening_float: 400 })]))[0]!.detail!.startsWith('key_changed:')).toBe(true)
  })
  it('quick_open by a staff member = FORBIDDEN "role:"; a movement after counted_at = INVALID', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    expect((await push(mock, [row('shift_open', S, { ...open, opened_by: STAFF_ONLY, quick_open: true })]))[0]!.detail!.startsWith('role:')).toBe(true)
    await push(mock, [row('shift_open', S, open), row('cash_count', C, count)])
    const late = { movement_id: M, shift_id: S, kind: 'PAID_OUT', amount: 20, pos_order_id: null, reason: 'x', created_by: U, created_at: '2026-09-25T12:00:00.001Z' }
    expect((await push(mock, [row('cash_movement', M, late)]))[0]).toMatchObject({ status: 'rejected', reason: 'INVALID' })
  })
  it('E4 returns bot/web cash bills in (after, until] only', async () => {
    const mock = createMockDayo({ now: NOW, block3: true })
    const bot = (no: string, total: number, at: string) => ({ order_no: no, sale_date: '2026-09-25', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'line', payment: 'cash', totals: { items_subtotal: total, items_discount: 0, bill_discount: 0, total }, amount_mismatch: false, updated_at: at, sold_at: at })
    mock.seedCentralOrders([bot('L260925-901', 70, '2026-09-25T04:00:00+00:00'), bot('L260925-902', 35, '2026-09-25T12:00:00+00:00'), bot('L260925-903', 50, '2026-09-25T12:00:01+00:00'), { ...bot('L260925-904', 45, '2026-09-25T05:00:00+00:00'), payment: 'qr' }])
    const r = await mock.fetch(`http://localhost:8787/api/v1/pos/shift-cash?after=${encodeURIComponent('2026-09-24T17:00:00.000Z')}&until=${encodeURIComponent('2026-09-25T12:00:00.000Z')}`, { headers: { authorization: `Bearer ${MOCK_API_KEY}` } })
    expect(await r.json()).toMatchObject({ ok: true, data: { cash_total: 105, bills: [{ order_no: 'L260925-901' }, { order_no: 'L260925-902' }] } })
  })
})
```

`packages/dayo-mock/test/helpers-block3.ts` (ตัวช่วยร่วมของเทสต์ mock ก้อน 3 — Task 7, 8 ใช้ต่อ):

```ts
import type { CentralOrder } from '@dayo/contracts'
import { createMockDayo, MOCK_API_KEY, type MockDayo } from '../src/index'

export const NOW = '2026-09-25T12:10:00.000Z'
export const U = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'                   // TungAo, active owner (e1-catalog-rich.json)
export const STAFF_ONLY = '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0'          // Mint, staff
const id = (prefix: string, n: number): string => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`
export const sid = (n: number): string => id('5a5a5a5a', n)             // shift n
export const cid = (n: number): string => id('7c7c7c7c', n)             // its count
export const mid = (n: number): string => id('6b6b6b6b', n)             // a movement
export const oid = (n: number): string => id('0b0b0b0b', n)             // a POS bill
export const H = (n: number): string => (n % 256).toString(16).padStart(2, '0').repeat(32)
export const at = (hour: number, min = 0): string => `2026-09-25T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00.000Z`
export const MIDNIGHT = '2026-09-24T17:00:00.000Z'                       // 00:00 Bangkok of 2026-09-25

export const newMock = (): MockDayo => createMockDayo({ now: NOW, block3: true })
export const row = (kind: string, key: string, data: unknown) => ({ key: `${kind}:${key}`, kind, data })
export async function push(mock: MockDayo, rows: unknown[]) {
  const r = await mock.fetch('http://localhost:8787/api/v1/pos/push', { method: 'POST', headers: { authorization: `Bearer ${MOCK_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ device_time: NOW, rows }) })
  return ((await r.json()) as { data: { results: { key: string; status: string; reason?: string; detail?: string; data?: Record<string, unknown> }[] } }).data.results
}
export const shiftOpen = (n: number, float = 500) => ({ shift_id: sid(n), business_date: '2026-09-25', opened_at: at(0, 30), opened_by: U, opening_float: float, quick_open: false })
export const cashCount = (n: number, countedAt: string, counted: number) => ({
  count_id: cid(n), shift_id: sid(n), lines: [1000, 500, 100, 50, 20, 10, 5, 2, 1].map((d) => ({ denomination: d, count: d === 1 ? counted : 0 })), counted, counted_by: U, counted_at: countedAt,
})
export type PosBill = { pos_order_id: string; receipt_no: string; payment: string; total: number; sold_at: string; voided_at: string | null }
export const posBill = (n: number, o: { total?: number; payment?: string; soldAt?: string; voidedAt?: string | null } = {}): PosBill => ({
  pos_order_id: oid(n), receipt_no: `A-${String(n).padStart(6, '0')}`, payment: o.payment ?? 'cash', total: o.total ?? 35, sold_at: o.soldAt ?? at(1), voided_at: o.voidedAt ?? null,
})
export function shiftClose(n: number, o: { zNo: number; countedAt: string; counted: number; after?: string; prevHash?: string | null; hash?: string
  cash?: Partial<Record<'opening_float' | 'pos_cash_sales' | 'void_refunds' | 'paid_in' | 'paid_out' | 'drops' | 'drawer_expenses' | 'bot_cash', number>>
  posBills?: PosBill[]; movementIds?: string[]; botBills?: { order_no: string; version: number; total: number }[] }) {
  const botBills = o.botBills ?? []
  const cash = { opening_float: 500, pos_cash_sales: 0, void_refunds: 0, paid_in: 0, paid_out: 0, drops: 0, drawer_expenses: 0, bot_cash: botBills.reduce((a, b) => a + b.total, 0), ...o.cash }
  return {
    shift_id: sid(n), count_id: cid(n), closed_by: U, closed_at: new Date(Date.parse(o.countedAt) + 5 * 60_000).toISOString(), variance_reason: null,
    z_report: { z_no: o.zNo, hash: o.hash ?? H(o.zNo), prev_hash: o.prevHash ?? null, variance_alert: 20, chain_warning: false, cash, counted: o.counted,
      bot_window: { after: o.after ?? MIDNIGHT, until: o.countedAt }, movement_ids: o.movementIds ?? [], bot_bills: botBills, pos_bills: o.posBills ?? [] },
  }
}
/** A whole empty shift n (float ฿500, counted ฿500) closed as Z zNo. */
export async function emptyZ(mock: MockDayo, n: number, zNo: number, countedAt: string, o: { after?: string; prevHash?: string | null } = {}) {
  return push(mock, [row('shift_open', sid(n), shiftOpen(n)), row('cash_count', cid(n), cashCount(n, countedAt, 500)), row('shift_close', sid(n), shiftClose(n, { zNo, countedAt, counted: 500, ...o }))])
}
/** A POS `order` row (variant Thai Tea 16 oz 50% of e1-catalog-rich.json — the one the block-2 fixtures use). */
export const orderRow = (n: number, o: { shiftId: string | null; total?: number; payment?: 'cash' | 'qr'; soldAt?: string }) => {
  const total = o.total ?? 35
  return { pos_order_id: oid(n), receipt_no: `A-${String(n).padStart(6, '0')}`, queue_no: n, sale_date: '2026-09-25', sold_at: o.soldAt ?? at(1), channel: 'store', payment: o.payment ?? 'cash',
    staff_id: U, catalog_version: 1, shift_id: o.shiftId, lines: [{ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1 }],
    bill_discount: null, promo_code: null, skip_promotion_ids: [], no_promotions: false, totals: { items_subtotal: total, items_discount: 0, bill_discount: 0, total }, note: null }
}
export const voidRow = (n: number, voidedAt: string) => ({ pos_order_id: oid(n), voided_at: voidedAt, staff_id: U, approved_by: null, reason: 'ลูกค้ายกเลิก' })
export const movementRow = (n: number, shiftN: number, kind: 'PAID_IN' | 'PAID_OUT' | 'DROP' | 'VOID_REFUND', amount: number, createdAt: string, posOrderN: number | null = null) =>
  ({ movement_id: mid(n), shift_id: sid(shiftN), kind, amount, pos_order_id: posOrderN === null ? null : oid(posOrderN), reason: kind === 'VOID_REFUND' ? null : 'ทดสอบ', created_by: U, created_at: createdAt })
export const botBill = (no: string, total: number, soldAt: string): CentralOrder => ({ order_no: no, sale_date: soldAt.slice(0, 10), status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'line', payment: 'cash',
  totals: { items_subtotal: total, items_discount: 0, bill_discount: 0, total }, amount_mismatch: false, updated_at: soldAt, sold_at: soldAt })
```

`packages/dayo-mock/test/z-chain.test.ts` (ลำดับ `z_no` และโซ่ — §4.10 ข้อ 0–6 + R5-3):

```ts
import { describe, expect, it } from 'vitest'
import { MOCK_API_KEY } from '../src/index'
import { at, botBill, cashCount, cid, emptyZ, H, MIDNIGHT, newMock, push, row, shiftClose, shiftOpen, sid } from './helpers-block3'

const zOf = (mock: ReturnType<typeof newMock>, zNo: number) => mock.zReports().find((z) => z.zNo === zNo)!

describe('z_no order and the Z chain (spec 04 §4.10 rules 0–6)', () => {
  it('rule 2: the first Z of the key is not chain-checked', async () => {
    const mock = newMock()
    expect((await emptyZ(mock, 1, 1, at(1), { prevHash: 'ff'.repeat(32) })).at(-1)).toMatchObject({ status: 'accepted' })
    expect(zOf(mock, 1)).toMatchObject({ firstOfKey: true, chainBreak: false, notes: [], chainMismatch: [], quarantined: false })
  })
  it('rule 3: Z n after Z n−1 needs prev_hash = its hash (else chain_break) and after = its until (else mismatch)', async () => {
    const mock = newMock()
    await emptyZ(mock, 1, 1, at(1))
    await emptyZ(mock, 2, 2, at(2), { prevHash: H(1), after: at(1) })
    expect(zOf(mock, 2)).toMatchObject({ chainBreak: false, chainMismatch: [] })
    await emptyZ(mock, 3, 3, at(3), { prevHash: H(9), after: at(2) })
    expect(zOf(mock, 3)).toMatchObject({ chainBreak: true, chainMismatch: [] })
    await emptyZ(mock, 4, 4, at(4), { prevHash: H(3), after: at(3, 30) })
    expect(zOf(mock, 4)).toMatchObject({ chainBreak: false, chainMismatch: ['bot_window.after ≠ until ของ Z ใบก่อน'] })
  })
  it('rule 1: a z_no already used = CONFLICT "z_no_taken:" + the S5 flag, and the Z is not stored', async () => {
    const mock = newMock()
    await emptyZ(mock, 1, 1, at(1))
    const r = await emptyZ(mock, 2, 1, at(2), { prevHash: H(1), after: at(1) })
    expect(r.at(-1)).toMatchObject({ status: 'rejected', reason: 'CONFLICT' })
    expect(r.at(-1)!.detail!.startsWith('z_no_taken:')).toBe(true)
    expect(mock.conflicts()).toContain(`z_no_taken:${sid(2)}`)
    expect(mock.zReports()).toHaveLength(1)
  })
  it('rule 0: z_no above the highest + 50 = INVALID "data_conflict:" + the S5 flag; + 50 itself passes (R5-2)', async () => {
    const mock = newMock()
    await emptyZ(mock, 1, 1, at(1))
    const r = await emptyZ(mock, 2, 52, at(2))
    expect(r.at(-1)).toMatchObject({ status: 'rejected', reason: 'INVALID' })
    expect(r.at(-1)!.detail!.startsWith('data_conflict:')).toBe(true)
    expect(mock.conflicts()).toContain(`z_no_ceiling:${sid(2)}`)
    expect((await emptyZ(mock, 3, 51, at(3))).at(-1)).toMatchObject({ status: 'accepted' })
  })
  it('a Z whose counted ≠ the count in dayo = INVALID "data_conflict:" + the S5 flag (R5-2)', async () => {
    const mock = newMock()
    const r = await push(mock, [row('shift_open', sid(1), shiftOpen(1)), row('cash_count', cid(1), cashCount(1, at(1), 500)), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(1), counted: 600 }))])
    expect(r.at(-1)).toMatchObject({ status: 'rejected', reason: 'INVALID' })
    expect(r.at(-1)!.detail!.startsWith('data_conflict:')).toBe(true)
    expect(mock.conflicts()).toContain(`counted_mismatch:${sid(1)}`)
  })
  it('rules 4–5: Z 6 before Z 5 gets a gap note (no chain_break); Z 5 then fills the gap and chains cleanly', async () => {
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4))
    await push(mock, [row('shift_open', sid(5), shiftOpen(5)), row('cash_count', cid(5), cashCount(5, at(5), 500))]) // shift 5 counted, its Z not sent yet
    await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    expect(zOf(mock, 6)).toMatchObject({ chainBreak: false, chainMismatch: [], notes: ['Z ขาดช่วง / Z ก่อนหน้ายังไม่มี'] })
    await push(mock, [row('shift_close', sid(5), shiftClose(5, { zNo: 5, countedAt: at(5), counted: 500, prevHash: H(4), after: at(4) }))])
    expect(zOf(mock, 5)).toMatchObject({ chainBreak: false, chainMismatch: [], quarantined: false })
  })
  it('rule 4: a gap whose after is not the latest count and the uncovered span has bot cash = mismatch', async () => {
    const mock = newMock()
    await emptyZ(mock, 1, 1, at(1))
    mock.seedCentralOrders([botBill('L260925-901', 70, '2026-09-25T02:30:00+00:00')])
    await push(mock, [row('shift_open', sid(2), shiftOpen(2)), row('cash_count', cid(2), cashCount(2, at(2), 500))]) // Z 2 never comes
    await emptyZ(mock, 3, 3, at(4), { prevHash: H(2), after: at(3) })                   // latest count before it is 02:00, after says 03:00
    expect(zOf(mock, 3).chainMismatch).toEqual(['ช่วงบิลบอทไม่ต่อกับการนับล่าสุด และช่วงนั้นมีบิลเงินสดบอท'])
  })
  it('rule 5: a lower z_no whose counted_at is not between its neighbours is quarantined: chain_break + mismatch on itself', async () => {
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4))
    await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    await emptyZ(mock, 5, 5, at(7), { prevHash: H(4), after: at(4) })                   // a replay: 07:00 is after Z 6's 06:00
    expect(zOf(mock, 5)).toMatchObject({ quarantined: true, chainBreak: true, chainMismatch: ['Z เลขต่ำผิดลำดับเวลา (เล่นซ้ำ)'] })
  })
  it('R5-3: a good Z next to a quarantined one is judged as if it were not there and stays clean', async () => {
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4))
    await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    await emptyZ(mock, 5, 5, at(7), { prevHash: H(4), after: at(4) })                   // quarantined
    await emptyZ(mock, 7, 7, at(8), { prevHash: H(6), after: at(6) })                   // its previous Z is Z 6, not the quarantined Z 5
    expect(zOf(mock, 7)).toMatchObject({ quarantined: false, chainBreak: false, chainMismatch: [], notes: [] })
    expect(zOf(mock, 6)).toMatchObject({ chainBreak: false, chainMismatch: [] })          // never re-judged against Z 5
  })
  it('E1 client: last_z_* come from the highest non-quarantined Z; without any Z the values bumpCatalog set survive (review item 3)', async () => {
    const e1 = async (mock: ReturnType<typeof newMock>) => ((await (await mock.fetch('http://localhost:8787/api/v1/pos/catalog?known_version=0', { headers: { authorization: `Bearer ${MOCK_API_KEY}` } })).json()) as { data: { client: Record<string, unknown> } }).data.client
    const mock = newMock()
    mock.bumpCatalog((c) => { Object.assign(c.client as Record<string, unknown>, { last_z_no: 41, last_z_hash: null, last_z_until: null }) })
    expect(await e1(mock)).toMatchObject({ last_z_no: 41, last_z_hash: null, last_z_until: null })       // no Z → untouched
    mock.preloadZ({ zNo: 41, hash: H(41), countedAt: '2026-09-24T12:00:00.000Z' })
    expect(await e1(mock)).toMatchObject({ last_z_no: 41, last_z_hash: H(41), last_z_until: '2026-09-24T12:00:00.000Z' })
    await emptyZ(mock, 1, 42, at(1), { prevHash: H(41), after: '2026-09-24T12:00:00.000Z' })
    expect(await e1(mock)).toMatchObject({ last_z_no: 42, last_z_hash: H(42), last_z_until: at(1) })
  })
  it('R5-3 scope: a Z above the highest with an OLDER counted_at is not quarantined — rule 3 flags its after instead', async () => {
    const mock = newMock()
    await emptyZ(mock, 2, 1, at(5))
    await emptyZ(mock, 1, 2, at(3), { prevHash: H(1), after: MIDNIGHT })                  // z_no 2 > highest 1, counted before Z 1
    expect(zOf(mock, 2)).toMatchObject({ quarantined: false, chainBreak: false, chainMismatch: ['bot_window.after ≠ until ของ Z ใบก่อน'] })
  })
  it('R5-3 sticky: a later recompute never quarantines or releases a Z', async () => {
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4)); await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    await emptyZ(mock, 5, 5, at(7), { prevHash: H(4), after: at(4) })                     // quarantined at receipt
    await emptyZ(mock, 7, 7, at(8), { prevHash: H(6), after: at(6) })                     // recomputes run again (Task 8 recomputeAll)
    expect([4, 5, 6, 7].map((n) => zOf(mock, n).quarantined)).toEqual([false, true, false, false])
  })
  it('E1 after a quarantine: last_z_no counts every Z, hash/until come from the highest good Z (R5-3 · plan 08 rule)', async () => {
    const e1 = async (mock: ReturnType<typeof newMock>) => ((await (await mock.fetch('http://localhost:8787/api/v1/pos/catalog?known_version=0', { headers: { authorization: `Bearer ${MOCK_API_KEY}` } })).json()) as { data: { client: Record<string, unknown> } }).data.client
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4)); await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    await emptyZ(mock, 5, 5, at(7), { prevHash: H(4), after: at(4) })                     // quarantined
    expect(await e1(mock)).toMatchObject({ last_z_no: 6, last_z_hash: H(6), last_z_until: at(6) })
    // Through pushes a quarantined Z can never be the highest (rule 1 refuses an equal number; rule 5 needs a higher one).
    // Pin the split rule anyway, as plan 08's SQL does: make the quarantined Z the highest by hand (test-only state write).
    const z5 = mock.zReports().find((z) => z.zNo === 5)!
    const z6 = mock.zReports().find((z) => z.zNo === 6)!
    z5.zNo = 7                                                                             // mock.zReports() returns the live state objects
    expect(z6.quarantined).toBe(false)
    expect(await e1(mock)).toMatchObject({ last_z_no: 7, last_z_hash: H(6), last_z_until: at(6) }) // number includes the quarantined Z · hash/until from the good one
  })
})
```

(`mock.zReports()` ต้องคืนอ็อบเจกต์สถานะตัวจริง ไม่ใช่สำเนา — เขียนในคอมเมนต์ของ `zReports()` ว่าใช้แก้สถานะได้เฉพาะในเทสต์)

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/dayo-mock exec vitest run test/shift-kinds.test.ts test/z-chain.test.ts` · คาด FAIL

- [ ] **Step 3: ทำ** — `state.ts`: ชนิดตาม Interfaces · `MockState` เพิ่ม `block3: boolean; shifts: Map<string, MockShift>; movements: Map<string, MockMovement>; counts: Map<string, MockCount>; zReports: Map<string, MockZ>; preloadedZ: { zNo: number; hash: string; countedAt: number } | null; conflicts: string[]` · `ALL_SCOPES` คงสี่ตัว + `BLOCK3_SCOPES = [...ALL_SCOPES, 'shift:write']`

`handler.ts` `init()`: ถ้า `opts.block3` เรียก `enableBlock3(state)` (ฟังก์ชันเดียวกับ `setBlock3(true)` แต่ไม่ bump):

```ts
function enableBlock3(s: MockState, on: boolean): void {
  s.block3 = on
  const kinds = ['shift_open', 'cash_movement', 'cash_count', 'shift_close', 'order_off_catalog']
  s.catalog.supported_kinds = on ? [...new Set([...s.catalog.supported_kinds, ...kinds])] : s.catalog.supported_kinds.filter((k) => !kinds.includes(k))
  for (const k of kinds) { if (on) s.catalog.supported_fields[k] = [...BLOCK3_SUPPORTED_FIELDS[k as keyof typeof BLOCK3_SUPPORTED_FIELDS]]; else delete s.catalog.supported_fields[k] }
  s.scopes = on ? [...new Set([...s.scopes, 'shift:write'])] : s.scopes.filter((x) => x !== 'shift:write')
}
```

E1: `client` ของคำตอบ changed ตามกติกาข้างล่าง (`judgeShiftClose` ท้ายหัวข้อนี้ — ทับเฉพาะเมื่อมี Z) · route ใหม่ใน `route()` ก่อน 404 ท้าย:

```ts
if (req.method === 'GET' && url.pathname === '/api/v1/pos/shift-cash') return shiftCash(s, url, h) // scope orders:read (required list: add this path)
```

`shift-cash.ts`:

```ts
import type { MockState } from './state.js'
/** E4 (spec §4.10): status ok · payment cash · source line/web · created_at in (after, until] — the mock uses sold_at for created_at (R15). */
export function botCashBills(s: MockState, after: number, until: number) {
  return s.seedOrders
    .filter((o) => o.status === 'ok' && o.payment === 'cash' && (o.source === 'line' || o.source === 'web') && o.sold_at != null)
    .filter((o) => { const t = Date.parse(o.sold_at!); return t > after && t <= until })
    .sort((a, b) => Date.parse(a.sold_at!) - Date.parse(b.sold_at!) || (a.order_no < b.order_no ? -1 : 1))
    .map((o) => ({ order_no: o.order_no, version: o.version, source: o.source, sold_at: o.sold_at!, total: o.totals.total, created_by_name: s.scopes.includes('staff:read') ? (o.created_by_name ?? null) : null }))
}
export function shiftCashAnswer(s: MockState, url: URL): { status: number; body: unknown } {
  const after = Date.parse(url.searchParams.get('after') ?? '')
  const until = Date.parse(url.searchParams.get('until') ?? '')
  if (Number.isNaN(after) || Number.isNaN(until) || after >= until) return { status: 422, body: { ok: false, error: { code: 'DY422', message: 'invalid: after < until (ISO)' } } }
  const bills = botCashBills(s, after, until)
  return { status: 200, body: { ok: true, data: { bills, cash_total: Math.round(bills.reduce((a, b) => a + b.total * 100, 0)) / 100 } } }
}
```

`judge.ts` `pushRow` — หลังขั้น `orders:write` (ลำดับ §4.5 ข้อ 6 + §4.10 (ก)(ข)):

```ts
  if (s.block3 && SHIFT_KINDS.has(kind) && !s.scopes.includes('shift:write')) return reject('FORBIDDEN', 'scope: API key ไม่มีสิทธิ์ shift:write')
  const idField = KIND_ID_FIELD[kind as PushKind] ?? 'pos_order_id'
  if (!isUuid(data[idField])) return reject('INVALID', `${idField} ต้องเป็น uuid ตัวเล็ก`)
  if (keyUuid !== data[idField]) return reject('BAD_KEY', `uuid ใน key ไม่ตรงกับ ${idField}`)
  const hash = hashOf(data)
  const seen = s.keys.get(key)
  if (seen !== undefined) {
    if (seen.hash === hash) return { ...seen.result, status: 'duplicate' }
    if (SHIFT_KINDS.has(kind)) flagConflict(s, 'key_changed', String(data['shift_id']))
    return reject('CONFLICT', `${s.block3 ? 'key_changed: ' : ''}key นี้เคยบันทึกสำเร็จด้วยข้อมูลอื่นแล้ว`)
  }
  const result = judgeKind(s, kind, key, data, now) // order | order_void | shift_open | cash_movement | cash_count | shift_close | order_off_catalog (Task 8)
```

`Verdict` ได้ช่อง `data?: unknown` และ `judgeRow` คืน `data` เมื่อมี · `judgeOrder`: เมื่อ `s.block3` ข้อความ CONFLICT ใบเสร็จขึ้นต้น `receipt_taken: ` · `flagConflict(s, kind, shiftId)` = `s.conflicts.push(\`${kind}:${shiftId}\`)` + `shift.dataConflict = true` (S5 — นอก savepoint: เขียนก่อน throw)

`judge-shift.ts` (พอร์ตตามตาราง §4.10 · ใช้ตัวช่วยเดิม `isUuid isText isMoney ts ymd thaiDate minusDays staffOk` — ย้ายไป `judge-util.ts` แล้ว import ทั้งสองไฟล์):

```ts
const FIVE_MIN = 5 * 60_000
const DAY = 86_400_000
/** spec §4.10 เวลา: main time > server + 5 min = CLOCK_AHEAD · older than server − 60 days = INVALID */
function checkTime(t: number, now: number, name: string): void {
  if (t > now + FIVE_MIN) defer('CLOCK_AHEAD', `${name} เกินเวลาเซิร์ฟเวอร์`)
  if (t < now - 60 * DAY) reject('INVALID', `${name} ย้อนหลังเกิน 60 วัน`)
}
const ownerActive = (s: MockState, id: string): boolean => s.catalog.staff.some((x) => x.id === id && x.role === 'owner' && x.active) // m6 simplified: status now, not at the row's time
const countOf = (s: MockState, shiftId: string): MockCount | undefined => [...s.counts.values()].find((c) => c.shiftId === shiftId)

export function judgeShiftOpen(s: MockState, key: string, d: J, now: number): ReceivedRowResult {
  const businessDate = ymd(d['business_date']) ?? reject('INVALID', 'business_date ต้องเป็นวันที่ YYYY-MM-DD')
  const openedAt = ts(d['opened_at']) ?? reject('INVALID', 'opened_at ต้องเป็นเวลา ISO-8601')
  if (!isUuid(d['opened_by'])) reject('INVALID', 'opened_by ต้องเป็น uuid')
  if (!isMoney(d['opening_float'])) reject('INVALID', 'opening_float ต้องเป็นบาท ≥ 0')
  if (typeof d['quick_open'] !== 'boolean') reject('INVALID', 'quick_open ต้องเป็น true/false')
  checkTime(openedAt, now, 'opened_at')
  if (businessDate !== thaiDate(openedAt)) reject('INVALID', `business_date ${businessDate} ไม่ตรงกับวันที่ไทยของ opened_at`)
  if (businessDate > thaiDate(now)) defer('CLOCK_AHEAD', `business_date ${businessDate} เป็นวันพรุ่งนี้ของเซิร์ฟเวอร์`)
  const by = d['opened_by'] as string
  if (!staffOk(s, by)) reject('UNKNOWN_STAFF', 'ไม่พบพนักงานผู้เปิดกะของร้านนี้')
  if (d['quick_open'] === true && !ownerActive(s, by)) reject('FORBIDDEN', 'role: เปิดกะด่วนต้องเป็นเจ้าของที่ใช้งานอยู่')
  const id = d['shift_id'] as string
  if (s.shifts.has(id)) return { key, status: 'duplicate', data: { shift_id: id } }
  s.shifts.set(id, { id, businessDate, openedAt, openedBy: by, openingFloat: d['opening_float'] as number, quickOpen: d['quick_open'] as boolean, status: 'open', closedBy: null, closedAt: null, dataConflict: false })
  if (s.block3LiveFrom === null && businessDate >= minusDays(thaiDate(now), 1)) s.block3LiveFrom = businessDate // D100 · m5 (field added in Task 8; declare it here as null)
  return { key, status: 'accepted', data: { shift_id: id } }
}

export function judgeCashMovement(s: MockState, key: string, d: J, now: number): ReceivedRowResult {
  const kind = d['kind']
  if (kind !== 'PAID_IN' && kind !== 'PAID_OUT' && kind !== 'DROP' && kind !== 'VOID_REFUND') return reject('INVALID', 'kind ต้องเป็น PAID_IN/PAID_OUT/DROP/VOID_REFUND')
  if (!isUuid(d['shift_id'])) reject('INVALID', 'shift_id ต้องเป็น uuid')
  if (!isMoney(d['amount']) || (d['amount'] as number) <= 0) reject('INVALID', 'amount ต้องเป็นบาท > 0')
  const orderId = d['pos_order_id'] ?? null
  if (orderId !== null && !isUuid(orderId)) reject('INVALID', 'pos_order_id ต้องเป็น uuid หรือ null')
  if ((kind === 'VOID_REFUND') !== (orderId !== null)) reject('INVALID', 'pos_order_id มีเฉพาะ VOID_REFUND')
  const reason = d['reason'] ?? null
  if (reason !== null && !isText(reason, 200)) reject('INVALID', 'reason 1–200 ตัวอักษร')
  if (kind !== 'VOID_REFUND' && reason === null) reject('INVALID', 'PAID_IN/PAID_OUT/DROP ต้องมีเหตุผล')
  if (!isUuid(d['created_by'])) reject('INVALID', 'created_by ต้องเป็น uuid')
  const createdAt = ts(d['created_at']) ?? reject('INVALID', 'created_at ต้องเป็นเวลา ISO-8601')
  checkTime(createdAt, now, 'created_at')
  if (!staffOk(s, d['created_by'] as string)) reject('UNKNOWN_STAFF', 'ไม่พบพนักงานผู้บันทึก')
  const shift = s.shifts.get(d['shift_id'] as string) ?? defer('PARENT_PENDING', 'กะยังมาไม่ถึงระบบกลาง')
  if (createdAt < shift.openedAt) reject('INVALID', 'created_at ก่อนเปิดกะ')
  const c = countOf(s, shift.id)
  if (c !== undefined && createdAt > c.countedAt) reject('INVALID', 'created_at หลังเวลานับเงินของกะ')
  const id = d['movement_id'] as string
  if (s.movements.has(id)) return { key, status: 'duplicate', data: { movement_id: id } }
  s.movements.set(id, { id, shiftId: shift.id, kind, amount: d['amount'] as number, posOrderId: orderId as string | null, reason: reason as string | null, createdBy: d['created_by'] as string, createdAt })
  return { key, status: 'accepted', data: { movement_id: id } }
}

export function judgeCashCount(s: MockState, key: string, d: J, now: number): ReceivedRowResult {
  const lines = d['lines']
  if (!Array.isArray(lines) || lines.length !== 9) return reject('INVALID', 'lines ต้องมี 9 แถว')
  const seen = new Set<number>()
  let sum = 0
  for (const l of lines as unknown[]) {
    if (!isObj(l) || !(CASH_DENOMINATIONS_BAHT as readonly unknown[]).includes(l['denomination']) || !isInt(l['count'], 0, 99_999) || seen.has(l['denomination'] as number)) return reject('INVALID', 'lines ต้องเป็นธนบัตร/เหรียญ 9 ชนิด ชนิดละหนึ่งแถว')
    seen.add(l['denomination'] as number)
    sum += (l['denomination'] as number) * 100 * (l['count'] as number)
  }
  if (!isMoney(d['counted']) || Math.round((d['counted'] as number) * 100) !== sum) reject('INVALID', 'counted ต้องเท่ากับผลรวมของ lines')
  if (!isUuid(d['shift_id']) || !isUuid(d['counted_by'])) reject('INVALID', 'shift_id/counted_by ต้องเป็น uuid')
  const countedAt = ts(d['counted_at']) ?? reject('INVALID', 'counted_at ต้องเป็นเวลา ISO-8601')
  checkTime(countedAt, now, 'counted_at')
  if (!staffOk(s, d['counted_by'] as string)) reject('UNKNOWN_STAFF', 'ไม่พบพนักงานผู้นับ')
  const shift = s.shifts.get(d['shift_id'] as string) ?? defer('PARENT_PENDING', 'กะยังมาไม่ถึงระบบกลาง')
  if (countedAt < shift.openedAt) reject('INVALID', 'counted_at ก่อนเปิดกะ')
  const id = d['count_id'] as string
  const existing = countOf(s, shift.id)
  if (existing !== undefined) {
    if (existing.id === id) return { key, status: 'duplicate', data: { count_id: id } }
    flagConflict(s, 'counted', shift.id)
    reject('CONFLICT', 'counted: กะนี้มีการนับเงินอีกใบแล้ว')
  }
  s.counts.set(id, { id, shiftId: shift.id, counted: d['counted'] as number, countedBy: d['counted_by'] as string, countedAt })
  shift.status = 'counted'
  return { key, status: 'accepted', data: { count_id: id } }
}
```

`judgeShiftClose`: ตรวจรูป `shift_id count_id closed_by closed_at variance_reason` + `z_report` แบบ strict (คีย์บน/`cash`/`bot_window`/สมาชิกของรายการ — คีย์ไม่รู้จัก = `INVALID` แบบ S28) · `checkTime(closedAt)` · กะไม่มี = `PARENT_PENDING` · การนับของกะไม่มี = `PARENT_PENDING` · `count_id` ≠ = `INVALID` · `closed_by` ไม่พบ = `UNKNOWN_STAFF` · ไม่ใช่ owner active = `FORBIDDEN 'role: …'` · `closedAt < countedAt` = `INVALID` · `cents(z.counted) ≠ cents(count.counted)` = `flagConflict('counted_mismatch')` + `INVALID 'data_conflict: ยอดนับในใบปิดกะไม่ตรงกับการนับในระบบกลาง'` (§13.8 R5-2) · `bot_window.until ≠ countedAt` หรือ `after ≥ until` = `INVALID` · Σ `bot_bills` ≠ `bot_cash` = `INVALID` · เพดานรายการ (2000/500/500) = `INVALID` · Z ของกะนี้มีแล้ว = `duplicate {shift_id}` · แล้ว `zGate` (ข้อ 0–1 · ปฏิเสธ = ไม่เก็บ) → สร้าง `MockZ` → `chainOf` (ข้อ 2–5 + R5-3):

```ts
type ZPoint = { zNo: number; hash: string; until: number; countedAt: number }
/** Zs that may be "the previous/next Z" of `except`: stored, not quarantined (§13.8 R5-3), plus a preloaded one. */
function points(s: MockState, except: string | null): ZPoint[] {
  const out = [...s.zReports.values()].filter((z) => z.shiftId !== except && !z.quarantined).map((z) => ({ zNo: z.zNo, hash: z.hash, until: z.countedAt, countedAt: z.countedAt }))
  if (s.preloadedZ !== null) out.push({ zNo: s.preloadedZ.zNo, hash: s.preloadedZ.hash, until: s.preloadedZ.countedAt, countedAt: s.preloadedZ.countedAt })
  return out
}

/** Rules 0–1 and the rule-5 quarantine, ONCE, at receipt (spec 04 R5-3: decided once, kept for good). Every stored Z —
 * quarantined ones too — holds its number (unique (api_client_id, z_no)). Only a Z with z_no ≤ the key's highest at
 * receipt can be quarantined (rule 1 already refused an equal one, so it is <); a Z above the highest never is, even with
 * an older counted_at — rule 3 judges its `after` instead. */
function zGate(s: MockState, shiftId: string, zNo: number, countedAt: number): { firstOfKey: boolean; quarantined: boolean } {
  const taken = [...s.zReports.values()].map((z) => z.zNo)
  if (s.preloadedZ !== null) taken.push(s.preloadedZ.zNo)
  const maxZ = taken.reduce((m, n) => Math.max(m, n), 0)
  if (taken.length > 0 && zNo > maxZ + 50) { flagConflict(s, 'z_no_ceiling', shiftId); reject('INVALID', `data_conflict: z_no ${zNo} เกินเลขสูงสุด ${maxZ} + 50`) } // rule 0 · R5-2
  if (taken.includes(zNo)) { flagConflict(s, 'z_no_taken', shiftId); reject('CONFLICT', `z_no_taken: เลขใบปิดกะ ${zNo} ถูกใช้แล้ว`) }                               // rule 1 (before rule 5)
  let quarantined = false
  if (taken.length > 0 && zNo < maxZ) {                                                                                                                              // rule 5
    const all = points(s, shiftId)
    const lower = all.filter((p) => p.zNo < zNo).sort((a, b) => b.zNo - a.zNo)[0]
    const higher = all.filter((p) => p.zNo > zNo).sort((a, b) => a.zNo - b.zNo)[0]
    quarantined = !((lower === undefined || lower.countedAt < countedAt) && (higher === undefined || countedAt < higher.countedAt))
  }
  return { firstOfKey: taken.length === 0, quarantined }                                                                                                             // rule 2
}

/** Rules 2–4 as a pure function of the stored Zs (Task 8 re-runs it for rule 6). The quarantine is read, never set or cleared here. */
export function chainOf(s: MockState, z: MockZ): Pick<MockZ, 'chainBreak' | 'notes' | 'chainMismatch'> {
  const out = { chainBreak: false, notes: [] as string[], chainMismatch: [] as string[] }
  if (z.quarantined) return { chainBreak: true, notes: [], chainMismatch: ['Z เลขต่ำผิดลำดับเวลา (เล่นซ้ำ)'] }                          // rule 5 (sticky, R5-3)
  if (z.firstOfKey) return out                                                                                                   // rule 2
  const all = points(s, z.shiftId)
  const lower = all.filter((p) => p.zNo < z.zNo).sort((a, b) => b.zNo - a.zNo)[0]
  if (lower !== undefined && lower.zNo === z.zNo - 1) {                                                                          // rule 3
    if (z.prevHash !== lower.hash) out.chainBreak = true
    if (z.after !== lower.until) out.chainMismatch.push('bot_window.after ≠ until ของ Z ใบก่อน')
    return out
  }
  out.notes.push('Z ขาดช่วง / Z ก่อนหน้ายังไม่มี')                                                                            // rule 4
  const quarantinedShifts = new Set([...s.zReports.values()].filter((q) => q.quarantined).map((q) => q.shiftId)) // their counts are never "the latest count" (R5-3 · same as plan 08)
  const lastCount = [...s.counts.values()].filter((c) => c.shiftId !== z.shiftId && !quarantinedShifts.has(c.shiftId) && c.countedAt < z.countedAt).sort((a, b) => b.countedAt - a.countedAt)[0]
  if (lastCount !== undefined && lastCount.countedAt !== z.after) {
    const [lo, hi] = lastCount.countedAt < z.after ? [lastCount.countedAt, z.after] : [z.after, lastCount.countedAt]
    if (botCashBills(s, lo, hi).length > 0) out.chainMismatch.push('ช่วงบิลบอทไม่ต่อกับการนับล่าสุด และช่วงนั้นมีบิลเงินสดบอท')
    else out.notes.push('ช่วงบิลบอทไม่ต่อกับการนับล่าสุด (ไม่มีบิลในช่วงนั้น)')
  }
  return out
}
```

ท้าย `judgeShiftClose`: `const { firstOfKey, quarantined } = zGate(s, shiftId, zNo, count.countedAt)` → `const z: MockZ = { shiftId, zNo, hash, prevHash, after: Date.parse(w.bot_window.after), countedAt: count.countedAt, wire: w, firstOfKey, quarantined, chainBreak: false, notes: [], chainMismatch: [], recomputeStatus: 'waiting_bills', detail: [], missing: { posOrderIds: [], movementIds: [], voidOrderIds: [] } }` → `Object.assign(z, chainOf(s, z))` → `s.zReports.set(shiftId, z)` (Task 8 คิด `recomputeStatus` จริง) · `shift.status = 'closed'`, `closedBy`, `closedAt` · คืน `{ key, status: 'accepted', data: { shift_id } }` · E1 (`handler.ts` · สเปก 04 R5-3 — กฎเดียวกับแผน 08): `const maxAll = highest z_no among every stored Z + preloaded (quarantined included)` · `const good = highest z_no among points(s, null)` (non-quarantined) → `client = maxAll === undefined ? c.client : { ...c.client, last_z_no: maxAll, last_z_hash: good?.hash ?? null, last_z_until: good === undefined ? null : new Date(good.until).toISOString() }` (ไม่มี Z = ค่าของ `bumpCatalog` อยู่ต่อ — review item 3) · `fetch` ของ mock: `mode === 'offline'` → `Promise.reject(new TypeError('Failed to fetch'))` · `control.ts`: `/__mock/block3` `{on}` · `/__mock/preload-z` · `/__mock/state` เพิ่ม `shifts`, `zReports`, `conflicts` · `server.ts`: อาร์กิวเมนต์ `--block3` · `index.ts` export ชนิดใหม่ + `chainOf`

`apps/pos/test/helpers/dayo.ts` (ของ Task 6 · รอบ 2):

```ts
type ConnectOpts = { now?: string; block3?: boolean }
type Connected = ReadyApi & { mock: MockDayo }
/** A device linked to the mock dayo: TungAo (owner, PIN 1111) + DCm (owner, PIN 2222) + (unless openShift: false) an open shift with ฿500. */
export async function openConnectedApi(opts?: ConnectOpts & { openShift?: true }): Promise<Connected & { shift: ShiftDto }>
export async function openConnectedApi(opts: ConnectOpts & { openShift: false }): Promise<Connected & { shift: null }>
export async function openConnectedApi(opts: ConnectOpts & { openShift?: boolean } = {}): Promise<Connected & { shift: ShiftDto | null }> {
  const now = opts.now ?? '2026-09-25T03:00:00.000Z'
  const mock = createMockDayo({ now, block3: opts.block3 ?? false })
  const t = await openTestApi({ fetch: mock.fetch, now })
  await t.api.connectShop({ baseUrl: 'http://localhost:8787/api/v1', apiKey: MOCK_API_KEY, receiptPrefix: 'A', ownerStaffId: STAFF.TungAo, ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null })
  const other = await t.api.setStaffPin({ staffId: STAFF.DCm, pin: '2222', approverUserId: STAFF.TungAo, approverPin: '1111' })
  const boot = await t.api.bootstrap()
  const shift = opts.openShift === false ? null : await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
  return { ...t, mock, owner: boot.users.find((u) => u.id === STAFF.TungAo)!, other, device: boot.device!, shift }
}
```

(Task 13 เพิ่ม `beforeConnect` และ `confirmedLastZNo` ในฟังก์ชันนี้ภายหลัง)

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/dayo-mock test` (เทสต์เดิมทั้งหมดยังผ่าน — `block3` ปิด) · `pnpm --filter @dayo/pos test`
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 6: commit** — stage `packages/dayo-mock/src/{judge-util,judge-shift,shift-cash,state,judge,handler,control,server,index}.ts packages/dayo-mock/test/{helpers-block3,shift-kinds,z-chain}.ts apps/pos/test/helpers/dayo.ts` (ชื่อเต็มทีละไฟล์ · `.test.ts` ตามจริง) · ข้อความ: `feat(dayo-mock): judge shift rows, z_no order and E4 shift cash`

### Task 7: fixture สัญญาก้อน 3 (POS เป็นเจ้าของ — D84)

ผู้ทำ: domain-engineer (opus) · สเปก §4.11 ข้อ 2 (fixture ต่อสถานการณ์ · สร้างจากสเปกล็อกก้อน 3 จนกว่าจะมีคำตอบจริงของ dayo ใน Task 19) · รอ: Task 6

**Files:**
- Create: 11 ไฟล์ใน `packages/contracts/fixtures/dayo-api/` (ตารางข้างล่าง)
- Modify: `packages/contracts/src/dayo-fixture.ts` (`CONTRACT_FIXTURE_NAMES` + 11 ชื่อ เรียงตามอักษร), `packages/contracts/test/dayo-fixtures.test.ts` (ถ้านับชื่อไว้ — ห้ามนับเอง อ่านจากรายการ), `packages/dayo-mock/test/fixtures-replay.test.ts` (เล่นซ้ำชุดใหม่ด้วย `createMockDayo({ now, block3: true })`)

**Interfaces:**
- Consumes: `PosContractFixture` · Task 5 schema · Task 6 mock
- Produces: ชุดที่ส่งให้ dayo เป็นเทสต์ Route Handler ก้อน 3 (แผน 08) · Task 19 แทนด้วยคำตอบจริง

รูปทุกไฟล์ = `PosContractFixture` เดิม (`env`, `rpc.api_authenticate` ที่ `scopes` มี `shift:write` ยกเว้นไฟล์ `scope`, `request`, `response` + หัว CORS) · ค่ากลาง: `S`, `U`, `O`, `M`, `C`, `H` ของ Task 5 · `device_time` `2026-09-25T12:10:00.000Z` · `server_time` `2026-09-25T12:10:00.410+00:00`

| ไฟล์ | request `rows` | response `results` |
|---|---|---|
| `e1-catalog-changed-block3` | `GET /api/v1/pos/catalog?known_version=0` | เหมือน `e1-catalog-changed` + `supported_kinds` 7 ชนิด + `supported_fields` ของ 5 ชนิด = `BLOCK3_SUPPORTED_FIELDS` + `client.last_z_no: 41`, `client.last_z_hash: H`, `client.last_z_until: "2026-09-24T12:00:00.000Z"` (รูปเดียวกับแผน 08) |
| `e2-shift-rows-accepted` | `shift_open`, `cash_movement` (PAID_OUT 20 "ซื้อน้ำแข็ง"), `cash_movement` (VOID_REFUND 45 `pos_order_id: O` reason null) ของ `SAMPLE` | `accepted` ×3 · `data` = `{shift_id}` · `{movement_id}` · `{movement_id}` |
| `e2-shift-scope-forbidden` | `order` (ของ `e2-order-accepted`) + `shift_open` · key ไม่มี `shift:write` | `order` `accepted` · `shift_open` `rejected FORBIDDEN` `detail: "scope: API key ไม่มีสิทธิ์ shift:write"` |
| `e2-cash-count-counted-conflict` | `cash_count` id ใหม่ของกะที่มีการนับแล้ว | `rejected CONFLICT` `"counted: กะนี้มีการนับเงินอีกใบแล้ว"` |
| `e2-shift-close-accepted` | `shift_close` ของ `SAMPLE` | `accepted` `data: {shift_id: S}` (ไม่มี `expected`/`variance`/`recompute_status` — R2-N4) |
| `e2-shift-close-z-no-taken` | `shift_close` กะอื่น `z_no: 1` | `rejected CONFLICT` `"z_no_taken: เลขใบปิดกะ 1 ถูกใช้แล้ว"` |
| `e2-order-off-catalog-accepted` | `order_off_catalog` ของ `SAMPLE` | `accepted` `data: {order_no: "L260925-015", version: 1}` |
| `e2-order-off-catalog-exists` | `order_off_catalog` ของบิลที่เป็นบิลปกติแล้ว | `rejected CONFLICT` `"exists: L260925-014 บิลนี้อยู่ในระบบกลางแล้ว"` `data: {order_no: "L260925-014", version: 1, reported_total: 70, payment_is_cash: true, off_catalog: false}` |
| `e2-order-off-catalog-rule` | `order_off_catalog` ที่ `totals.total` 3000.01 | `rejected FORBIDDEN` `"rule: ยอดเกินเพดานบิลนอกแคตตาล็อก"` **(รอ Q72 — ค่าเริ่มต้น ฿3,000)** |
| `e2-order-off-catalog-exists-order` | `order` ของบิลที่เป็นบิลนอกแคตตาล็อกแล้ว | `rejected CONFLICT` `"off_catalog_exists: L260925-015"` `data: {…, off_catalog: true}` |
| `e4-shift-cash` | `GET /api/v1/pos/shift-cash?after=2026-09-24T17:00:00.000Z&until=2026-09-25T12:00:00.000Z` | `{ok:true, data:{bills:[{order_no:"L260925-901",version:1,source:"line",sold_at:"2026-09-25T04:00:00+00:00",total:70,created_by_name:"DCm"}], cash_total:70}}` |

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — เพิ่มใน `packages/dayo-mock/test/fixtures-replay.test.ts`:

```ts
const BLOCK3 = ['e1-catalog-changed-block3', 'e2-cash-count-counted-conflict', 'e2-order-off-catalog-accepted', 'e2-order-off-catalog-exists', 'e2-order-off-catalog-exists-order', 'e2-order-off-catalog-rule', 'e2-shift-close-accepted', 'e2-shift-close-z-no-taken', 'e2-shift-rows-accepted', 'e2-shift-scope-forbidden', 'e4-shift-cash'] as const
it.each(BLOCK3)('block 3 fixture %s: status, verdicts, prefixes and data replay on the mock', async (name) => {
  const f = readFixture(name)                          // existing helper (dayo-fixture-files)
  const mock = createMockDayo({ now: '2026-09-25T12:10:00.410Z', block3: true })
  await arrangeBlock3(mock, name)                      // pre-state per file: shifts/counts/Zs/orders/rejections/scopes/cap/seeded bot bills
  const res = await replay(mock, f)                    // existing helper
  expect(res.status).toBe(f.response.status)
  expect(normalize(res.body)).toEqual(normalize(f.response.body)) // normalize: server_time dropped; Thai text after the prefix ignored (compare detailPrefix only)
})
```

`arrangeBlock3` อยู่ในไฟล์เทสต์เดียวกัน (switch ตามชื่อ · ใช้ API ของ mock: `setScopes`, push แถวตั้งต้น, `preloadZ`, `seedCentralOrders`, และจาก Task 8: `setOffCatalogCap` — ไฟล์ `*-off-catalog-*` จึง **ข้ามด้วย `it.skipIf(!('setOffCatalogCap' in mock))` จนกว่า Task 8 merge แล้วลบ skip ใน Task 8**)

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/dayo-mock exec vitest run test/fixtures-replay.test.ts` · คาด FAIL (ไม่มีไฟล์)
- [ ] **Step 3: ทำ** — เขียน 11 ไฟล์ตามตาราง (JSON ครบรูป · UUID เต็ม · `.gitattributes` เดิมครอบ `*.json text eol=lf`) · เพิ่มชื่อใน `CONTRACT_FIXTURE_NAMES` · `pnpm --filter @dayo/contracts fixtures:hashes` แล้วบันทึกผลใน ledger
- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/contracts test && pnpm --filter @dayo/dayo-mock test` · คาด PASS (ไฟล์บิลนอกแคตตาล็อกข้ามจนถึง Task 8)
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 6: commit** — stage 11 ไฟล์ + `dayo-fixture.ts` + เทสต์ · ข้อความ: `test(contracts): add block 3 contract fixtures for dayo to replay`

### Task 8: mock — คิด Z ซ้ำ (พอสำหรับเทสต์) + บิลนอกแคตตาล็อก + `pos_push_rejections`

ผู้ทำ: sync-engineer (opus) · สเปก §4.10 (การคิดซ้ำข้อ 1–7 · `order_off_catalog` ข้อ 0–3 · `block3_live_from` · `off_catalog_max_total`) · §4.5 ข้อ 0 (R4-2) · ruling R15 · รอ: Task 7

**Files:**
- Create: `packages/dayo-mock/src/recompute.ts`, `packages/dayo-mock/src/judge-off-catalog.ts`, `packages/dayo-mock/test/recompute.test.ts`, `packages/dayo-mock/test/off-catalog.test.ts`
- Modify: `packages/dayo-mock/src/{state,judge,judge-shift,handler,control,index}.ts`, `packages/dayo-mock/test/helpers-block3.ts` (`offCatalogRow`, `rejectOrder`), `packages/dayo-mock/test/fixtures-replay.test.ts` (ลบ skip)

**Interfaces:**
- Produces (Task 10–17 ใช้):

```ts
// StoredOrder gains offCatalog: boolean · MockState gains (block3LiveFrom: string | null is declared in Task 6) offCatalogCap: number (baht, default 3000 — รอ Q72) · rejections: Map<string, Set<string>>
setBlock3LiveFrom(d: string | null): void
setOffCatalogCap(baht: number): void
rejections(): { posOrderId: string; reasons: string[] }[]
recomputeAll(): void                                     // tests; also runs by itself after every accepted row of these kinds
// MockZ.recomputeStatus: 'waiting_bills' | 'matched' | 'mismatch' per spec §4.10 การคิดซ้ำ (checks 1–5, R3-A order)
// control: /__mock/off-catalog-cap {baht} · /__mock/block3-live-from {date}
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — เพิ่มใน `packages/dayo-mock/test/helpers-block3.ts` (Task 8 เป็นเจ้าของไฟล์นี้ต่อจาก Task 6):

```ts
export const offCatalogRow = (n: number, o: { shiftId?: string | null; total?: number; soldAt?: string; closedBy?: string; originalReason?: string } = {}) => {
  const total = o.total ?? 35
  return { pos_order_id: oid(n), receipt_no: `A-${String(n).padStart(6, '0')}`, queue_no: n, sale_date: '2026-09-25', sold_at: o.soldAt ?? at(1), channel: 'store', payment: 'cash',
    staff_id: U, catalog_version: 1, shift_id: o.shiftId ?? null, note: null,
    lines: [{ code: 'Thai Tea', name: 'ชาไทย', size: '16 oz', sweetness: '50%', qty: 1, unit_price: total, discount_per_cup: 0, line_total: total }],
    totals: { items_subtotal: total, items_discount: 0, bill_discount: 0, total }, closed_by: o.closedBy ?? U, closed_at: at(6), reason: 'เมนูถูกลบในระบบกลาง', original_reason: o.originalReason ?? 'UNKNOWN_CODE' }
}
/** dayo rejects the bill's `order` row (and records it in pos_push_rejections — even when a test override decides). */
export async function rejectOrder(mock: MockDayo, n: number, shiftId: string | null = null) {
  mock.override({ match: { key: `order:${oid(n)}` }, verdict: { status: 'rejected', reason: 'UNKNOWN_CODE', detail: 'ไม่พบเมนู' }, times: 1 })
  return push(mock, [row('order', oid(n), orderRow(n, { shiftId }))])
}
```

`packages/dayo-mock/test/recompute.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { at, botBill, cashCount, cid, emptyZ, H, mid, movementRow, newMock, oid, orderRow, posBill, push, row, shiftClose, shiftOpen, sid, voidRow } from './helpers-block3'

const z1 = (mock: ReturnType<typeof newMock>) => mock.zReports().find((z) => z.shiftId === sid(1))!
const zNo = (mock: ReturnType<typeof newMock>, n: number) => mock.zReports().find((z) => z.zNo === n)!
const openAndCount = (counted: number) => [row('shift_open', sid(1), shiftOpen(1)), row('cash_count', cid(1), cashCount(1, at(5), counted))]
const bot70 = { order_no: 'L260925-901', version: 1, total: 70 }

describe('recompute of a Z (spec 04 §4.10 การคิดซ้ำ · R3-A order: row checks always, sums only when nothing is missing)', () => {
  it('every row present and the sums agree → matched', async () => {
    const mock = newMock()
    mock.seedCentralOrders([botBill('L260925-901', 70, '2026-09-25T04:00:00+00:00')])
    await push(mock, [...openAndCount(605), row('order', oid(1), orderRow(1, { shiftId: sid(1) })),
      row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 605, cash: { pos_cash_sales: 35 }, posBills: [posBill(1)], botBills: [bot70] }))])
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'matched', detail: [] })
  })
  it('the Z before its bill → waiting_bills; the bill arrives → matched with nothing more sent (§9)', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(535), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 535, cash: { pos_cash_sales: 35 }, posBills: [posBill(1)] }))])
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'waiting_bills', missing: { posOrderIds: [oid(1)], movementIds: [], voidOrderIds: [] } })
    await push(mock, [row('order', oid(1), orderRow(1, { shiftId: sid(1) }))])
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'matched', missing: { posOrderIds: [] } })
  })
  it('R3-A: a bill that is there but different makes mismatch at once, even while another bill is still missing', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(535), row('order', oid(1), orderRow(1, { shiftId: sid(1), total: 40 })),
      row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 535, cash: { pos_cash_sales: 35 }, posBills: [posBill(1), posBill(2, { payment: 'qr' })] }))])
    expect(z1(mock).recomputeStatus).toBe('mismatch')
    expect(z1(mock).detail).toContain('ยอดบิล A-000001 ต่าง')
    expect(z1(mock).missing.posOrderIds).toEqual([oid(2)])
  })
  it('a movement id of the Z that belongs to another shift → mismatch', async () => {
    const mock = newMock()
    await push(mock, [row('shift_open', sid(2), shiftOpen(2)), row('cash_movement', mid(1), movementRow(1, 2, 'PAID_OUT', 20, at(2))),
      ...openAndCount(480), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 480, cash: { paid_out: 20 }, movementIds: [mid(1)] }))])
    expect(z1(mock).recomputeStatus).toBe('mismatch')
    expect(z1(mock).detail).toContain(`เงินเข้า-ออก ${mid(1)} ไม่ใช่ของกะนี้`)
  })
  it('VOID_REFUND of a bill the same Z says is not voided → mismatch (R3-m9)', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(500), row('order', oid(1), orderRow(1, { shiftId: sid(1) })), row('cash_movement', mid(1), movementRow(1, 1, 'VOID_REFUND', 35, at(2), 1)),
      row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 500, cash: { pos_cash_sales: 35, void_refunds: 35 }, posBills: [posBill(1, { voidedAt: null })], movementIds: [mid(1)] }))])
    expect(z1(mock).recomputeStatus).toBe('mismatch')
    expect(z1(mock).detail).toContain('เงินคืนของบิลที่ Z เดียวกันบอกว่ายังไม่ยกเลิก')
  })
  it('VOID_REFUND waiting for its order_void → waiting_bills (missing void); the void arrives → matched', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(500), row('order', oid(1), orderRow(1, { shiftId: sid(1) })), row('cash_movement', mid(1), movementRow(1, 1, 'VOID_REFUND', 35, at(2), 1)),
      row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 500, cash: { pos_cash_sales: 35, void_refunds: 35 }, posBills: [posBill(1, { voidedAt: at(2) })], movementIds: [mid(1)] }))])
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'waiting_bills', missing: { voidOrderIds: [oid(1)] } })
    await push(mock, [row('order_void', oid(1), voidRow(1, at(2)))])
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'matched', missing: { voidOrderIds: [] } })
  })
  it('a bot bill dayo finds in the window that the Z does not list → mismatch (S2)', async () => {
    const mock = newMock()
    mock.seedCentralOrders([botBill('L260925-901', 70, '2026-09-25T04:00:00+00:00')])
    await push(mock, [...openAndCount(500), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 500 }))])
    expect(z1(mock).detail).toContain('ชุดบิลบอทไม่ตรง')
  })
  it('opening_float of the Z ≠ the shift row → mismatch', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(400), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 400, cash: { opening_float: 400 } }))])
    expect(z1(mock).detail).toEqual(['องค์ประกอบ opening_float ต่าง'])
  })
  it('a different payment code on the same non-cash side is no difference (R-I2)', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(500), row('order', oid(1), orderRow(1, { shiftId: sid(1), payment: 'qr' })),
      row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 500, posBills: [posBill(1, { payment: 'promptpay' })] }))])
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'matched' })
  })
  it('rule 6: when the missing Z 5 arrives, Z 6 is judged again and its gap note goes away', async () => {
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4))
    await push(mock, [row('shift_open', sid(5), shiftOpen(5)), row('cash_count', cid(5), cashCount(5, at(5), 500))])
    await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    expect(zNo(mock, 6).notes).toEqual(['Z ขาดช่วง / Z ก่อนหน้ายังไม่มี'])
    await push(mock, [row('shift_close', sid(5), shiftClose(5, { zNo: 5, countedAt: at(5), counted: 500, prevHash: H(4), after: at(4) }))])
    expect(zNo(mock, 6)).toMatchObject({ notes: [], chainBreak: false, recomputeStatus: 'matched' })
  })
  it('R5-3: a normal Z next to a quarantined one stays matched; only the quarantined Z is mismatch', async () => {
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4))
    await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    await emptyZ(mock, 5, 5, at(7), { prevHash: H(4), after: at(4) })            // replay → quarantined
    await emptyZ(mock, 7, 7, at(8), { prevHash: H(6), after: at(6) })
    expect([4, 5, 6, 7].map((n) => [n, zNo(mock, n).quarantined, zNo(mock, n).recomputeStatus])).toEqual([[4, false, 'matched'], [5, true, 'mismatch'], [6, false, 'matched'], [7, false, 'matched']])
  })
})
```

(`Z 6` ใน rule 6 ยังมีข้อสังเกต "ช่วงบิลบอท…" ไม่ได้ เพราะ `after` ตรงการนับของกะ 5 · Z 6 เปลี่ยนเป็น `matched` แม้ก่อนหน้าเป็น `matched` อยู่แล้ว — ข้อสังเกตไม่ทำให้ต่าง · Z 4 ใบแรกของ key)

`packages/dayo-mock/test/off-catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { at, cashCount, cid, newMock, offCatalogRow, oid, orderRow, posBill, push, rejectOrder, row, shiftClose, shiftOpen, sid, STAFF_ONLY, voidRow } from './helpers-block3'

const ready = () => { const mock = newMock(); mock.setBlock3LiveFrom('2026-09-01'); return mock }
const offCat = (mock: ReturnType<typeof newMock>, o: Parameters<typeof offCatalogRow>[1] = {}) => push(mock, [row('order_off_catalog', oid(1), offCatalogRow(1, o))])
const prefixOf = (r: { detail?: string }) => r.detail?.split(' ')[0]

describe('order_off_catalog in the mock (spec 04 §4.10 · D91 · D97)', () => {
  it('a rejected order closed as off-catalog is accepted with an order_no from the same counter; the rejection is on record', async () => {
    const mock = ready()
    await rejectOrder(mock, 1)
    const [r] = await offCat(mock)
    expect(r).toMatchObject({ status: 'accepted', data: { version: 1 } })
    expect(String(r!.data!['order_no'])).toMatch(/^L260925-\d{3}$/)
    expect(mock.orders()).toEqual([expect.objectContaining({ posOrderId: oid(1), status: 'ok', total: 35 })])
    expect(mock.rejections()).toEqual([{ posOrderId: oid(1), reasons: ['UNKNOWN_CODE'] }])
  })
  it('no rejection on record → FORBIDDEN "rule:"', async () => {
    const [r] = await offCat(ready())
    expect(r).toMatchObject({ status: 'rejected', reason: 'FORBIDDEN' }); expect(prefixOf(r!)).toBe('rule:')
  })
  it('no block3_live_from, or sold_at before it → FORBIDDEN "rule:"', async () => {
    const mock = newMock()
    await rejectOrder(mock, 1)
    expect(prefixOf((await offCat(mock))[0]!)).toBe('rule:')
    mock.setBlock3LiveFrom('2026-09-26')
    expect(prefixOf((await offCat(mock))[0]!)).toBe('rule:')
  })
  it('a total above the cap → FORBIDDEN "rule:"; after the owner raises the cap the same key passes (รอ Q72 — ค่าเริ่มต้น ฿3,000)', async () => {
    const mock = ready()
    await rejectOrder(mock, 1)
    expect(prefixOf((await offCat(mock, { total: 3000.01 }))[0]!)).toBe('rule:')
    mock.setOffCatalogCap(5000)
    expect((await offCat(mock, { total: 3000.01 }))[0]).toMatchObject({ status: 'accepted' })
  })
  it('closed_by not an active owner → FORBIDDEN "role:"', async () => {
    const mock = ready()
    await rejectOrder(mock, 1)
    expect(prefixOf((await offCat(mock, { closedBy: STAFF_ONLY }))[0]!)).toBe('role:')
  })
  it('the bill already in dayo as a normal bill → CONFLICT "exists:" with the data to compare (m2)', async () => {
    const mock = ready()
    const [o] = await push(mock, [row('order', oid(1), orderRow(1, { shiftId: null }))])
    const [r] = await offCat(mock)
    expect(r).toMatchObject({ status: 'rejected', reason: 'CONFLICT', data: { order_no: o!.data!['order_no'], version: 1, reported_total: 35, payment_is_cash: true, off_catalog: false } })
    expect(prefixOf(r!)).toBe('exists:')
  })
  it('an order row of a bill that is off-catalog now → CONFLICT "off_catalog_exists:" (off_catalog: true)', async () => {
    const mock = ready()
    await rejectOrder(mock, 1)
    await offCat(mock)
    const [r] = await push(mock, [row('order', oid(1), orderRow(1, { shiftId: null }))])
    expect(r).toMatchObject({ status: 'rejected', reason: 'CONFLICT', data: { off_catalog: true } }); expect(prefixOf(r!)).toBe('off_catalog_exists:')
  })
  it('order_void of an off-catalog bill cancels it', async () => {
    const mock = ready()
    await rejectOrder(mock, 1); await offCat(mock)
    expect((await push(mock, [row('order_void', oid(1), voidRow(1, at(2)))]))[0]).toMatchObject({ status: 'accepted' })
    expect(mock.orders()[0]).toMatchObject({ status: 'cancelled' })
  })
  it('the same off-catalog row again → duplicate', async () => {
    const mock = ready()
    await rejectOrder(mock, 1); await offCat(mock)
    expect((await offCat(mock))[0]).toMatchObject({ status: 'duplicate' })
  })
  it('a Z listing the off-catalog bill is matched — it is in pos_bills like any bill, no waiting_bills', async () => {
    const mock = ready()
    await push(mock, [row('shift_open', sid(1), shiftOpen(1))])
    await rejectOrder(mock, 1, sid(1))
    await offCat(mock, { shiftId: sid(1) })
    await push(mock, [row('cash_count', cid(1), cashCount(1, at(5), 535)), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 535, cash: { pos_cash_sales: 35 }, posBills: [posBill(1)] }))])
    expect(mock.zReports()[0]).toMatchObject({ recomputeStatus: 'matched' })
  })
})
```

(`rejected` ของแถว `order` ถูกบันทึกลง `rejections` ใน `judgeRow` หลังได้ผล — รวมกรณีที่ override ตัดสิน · `kind` อ่านจาก `raw.kind`)

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/dayo-mock exec vitest run test/recompute.test.ts test/off-catalog.test.ts` · คาด FAIL
- [ ] **Step 3: ทำ** — `recompute.ts`:

```ts
import { chainOf } from './judge-shift.js'
import { botCashBills } from './shift-cash.js'
import type { MockState, MockZ } from './state.js'
const cents = (b: number): number => Math.round(b * 100)
type Wire = { cash: Record<string, number>; counted: number; bot_window: { after: string; until: string }; movement_ids: string[]; bot_bills: { order_no: string; total: number }[]; pos_bills: { pos_order_id: string; receipt_no: string; payment: string; total: number; sold_at: string; voided_at: string | null }[] }

/** spec §4.10 การคิดใบปิดกะซ้ำ (R3-A): row checks always · sums only when nothing is missing · diff → mismatch · missing → waiting_bills · else matched. */
export function recompute(s: MockState, z: MockZ): void {
  const w = z.wire as unknown as Wire
  const shift = s.shifts.get(z.shiftId)!
  const until = z.countedAt
  const diff: string[] = [...z.chainMismatch]
  const missing = { posOrderIds: [] as string[], movementIds: [] as string[], voidOrderIds: [] as string[] }
  let posCash = 0
  for (const b of w.pos_bills) {                                                                  // 1–2
    const o = s.orders.get(b.pos_order_id)
    if (o === undefined) { missing.posOrderIds.push(b.pos_order_id); continue }
    if (o.data?.shift_id !== z.shiftId) diff.push(`บิล ${b.receipt_no} ไม่ได้อยู่ในกะนี้`)
    if (cents(o.total) !== cents(b.total)) diff.push(`ยอดบิล ${b.receipt_no} ต่าง`)
    if (Date.parse(o.soldAt) !== Date.parse(b.sold_at)) diff.push(`เวลาขาย ${b.receipt_no} ต่าง`)
    const payment = o.data?.payment ?? ''
    if ((payment === 'cash') !== (b.payment === 'cash')) diff.push(`วิธีชำระ ${b.receipt_no} คนละฝั่งเงินสด`)
    if (payment === 'cash' && Date.parse(o.soldAt) <= until) posCash += cents(o.total)
  }
  for (const o of s.orders.values()) if (o.data?.shift_id === z.shiftId && !w.pos_bills.some((b) => b.pos_order_id === o.posOrderId)) diff.push(`บิล ${o.receiptNo} ของกะนี้ไม่อยู่ใน Z`) // 3
  const sums = { VOID_REFUND: 0, PAID_IN: 0, PAID_OUT: 0, DROP: 0 }
  for (const id of w.movement_ids) {
    const m = s.movements.get(id)
    if (m === undefined) { missing.movementIds.push(id); continue }
    if (m.shiftId !== z.shiftId || m.createdAt > until) { diff.push(`เงินเข้า-ออก ${id} ไม่ใช่ของกะนี้`); continue }
    sums[m.kind] += cents(m.amount)
    if (m.kind === 'VOID_REFUND') {
      const inZ = w.pos_bills.find((b) => b.pos_order_id === m.posOrderId)
      const o = s.orders.get(m.posOrderId!)
      if (inZ !== undefined && inZ.voided_at === null) diff.push('เงินคืนของบิลที่ Z เดียวกันบอกว่ายังไม่ยกเลิก')
      else if (o === undefined || o.status !== 'cancelled') missing.voidOrderIds.push(m.posOrderId!)
    }
  }
  for (const m of s.movements.values()) if (m.shiftId === z.shiftId && m.createdAt <= until && !w.movement_ids.includes(m.id)) diff.push(`เงินเข้า-ออก ${m.id} ไม่อยู่ใน Z`)
  const found = botCashBills(s, Date.parse(w.bot_window.after), Date.parse(w.bot_window.until))           // 4
  if (JSON.stringify(found.map((b) => b.order_no).sort()) !== JSON.stringify(w.bot_bills.map((b) => b.order_no).sort())) diff.push('ชุดบิลบอทไม่ตรง')
  for (const b of w.bot_bills) { const f = found.find((x) => x.order_no === b.order_no); if (f !== undefined && cents(f.total) !== cents(b.total)) diff.push(`ยอดบิลบอท ${b.order_no} ต่าง`) }
  const isMissing = missing.posOrderIds.length + missing.movementIds.length + missing.voidOrderIds.length > 0
  if (!isMissing && diff.length === 0) {                                                                    // 5
    const c = w.cash
    const want = { opening_float: cents(shift.openingFloat), pos_cash_sales: posCash, void_refunds: sums.VOID_REFUND, paid_in: sums.PAID_IN, paid_out: sums.PAID_OUT, drops: sums.DROP, drawer_expenses: 0, bot_cash: found.reduce((a, b) => a + cents(b.total), 0) }
    for (const [k, v] of Object.entries(want)) if (cents(c[k]!) !== v) diff.push(`องค์ประกอบ ${k} ต่าง`)
  }
  z.detail = diff
  z.missing = missing
  z.recomputeStatus = diff.length > 0 ? 'mismatch' : isMissing ? 'waiting_bills' : 'matched'
}
/** Rule 6: every Z is judged again oldest number first — chain (rules 2–4; the R5-3 quarantine set at receipt is only read), then money. */
export function recomputeAll(s: MockState): void {
  for (const z of [...s.zReports.values()].sort((a, b) => a.zNo - b.zNo)) {
    Object.assign(z, chainOf(s, z))
    recompute(s, z)
  }
}
```

เรียก `recomputeAll(s)` หลังแถว `accepted` ของ `order` `order_void` `order_off_catalog` `cash_movement` `shift_close` (ขนาด mock เล็ก — คิดใหม่ทุก Z) · `judge-off-catalog.ts` ตามกติกา §4.10 `order_off_catalog` ข้อ 0–3 (รูปฟิลด์ → เวลา (`sold_at` ในอนาคต = CLOCK_AHEAD · ไม่มีเพดาน 60 วันกับ `sold_at` · `closed_at` ใช้ `checkTime`) → `staff_id` → รหัสช่องทาง/วิธีชำระ → `closed_by` owner → (2) หาบิล `pos_order_id`: นอกแคตตาล็อก = `duplicate {order_no, version}` · ปกติ = `CONFLICT 'exists: …'` + `data` → (3) ใบเสร็จชน = `CONFLICT 'receipt_taken: …'` → (4) `rejections.has(pos_order_id)` · `sold_at ≥ 00:00 ไทยของ block3LiveFrom` · `cents(total) ≤ cents(offCatalogCap)` ไม่ผ่าน = `FORBIDDEN 'rule: …'` → สร้าง `StoredOrder` `offCatalog: true` เลขจากตัวออกเลขเดิม `data` = `MockOrderData` ที่ `lines: []`) · `judgeOrder` (block3): บิลที่มีอยู่เป็นนอกแคตตาล็อก = `CONFLICT 'off_catalog_exists: …'` + `data { …, off_catalog: true }` · `judgeRow` บันทึก `rejections` เมื่อแถว `order` ได้ `rejected` (รวม override)

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/dayo-mock test` · คาด PASS รวม fixture replay ครบ 11 ไฟล์
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 6: commit** — stage ไฟล์ตาม Files · ข้อความ: `feat(dayo-mock): recompute Z reports and accept off-catalog bills`

---

## 5. สาย C และสาย S — แท็บเล็ต

### Task 9: ฐานในเครื่อง — สถานะกะ 4 ขั้น · `sync_mode` · `counted_at` · การนับกะละครั้ง · trigger แช่แข็ง · `PushRowInput` 7 ชนิด

ผู้ทำ: sync-engineer (opus) · ผู้ตรวจเพิ่ม: **security-reviewer** (trigger แช่แข็ง · `counted_at` ตั้งครั้งเดียว) · สเปก §4.10 ข้อ 4 · §6.1 (`local_only`, `closed_off_catalog`) · §6.8 ข้อ 1, 4 · D47 ข้อ 6–7 · D101 · ruling R1, R2, R5 · รอ: Task 5 (และ Task 2 merge แล้ว — Task 9 เป็นผู้แก้ enum ของ contracts ที่ `apps/pos` ใช้ ดู Step 3)

**Files:**
- Create: `packages/db-schema/drizzle/sqlite/<NNNN>_block3_shift_cash.sql` (เลขจาก Step 0 · + snapshot/journal จาก `pnpm --filter @dayo/db-schema generate` แล้วแก้ SQL ด้วยมือเฉพาะส่วน trigger/UPDATE), `packages/db-schema/test/block3.test.ts`
- Modify: `packages/contracts/src/enums.ts` + `packages/contracts/test/enums.test.ts` (ย้ายมาจาก Task 5 — ข้อ 14 ของรีวิว), `packages/db-schema/src/sqlite/sales.ts`, `packages/db-schema/src/browser/sqlite-migrations.gen.ts` (สร้างด้วย `gen:browser`), `packages/db-schema/test/parity.test.ts` (คอลัมน์ใหม่อยู่ในรายการยกเว้น pg), `apps/pos/src/db/outbox.ts` + ไฟล์ `apps/pos` ที่ enum/`PushKind` ใหม่ทำให้ typecheck ล้ม (ถ้ามี)

**Interfaces:**
- Consumes: `PushRow`, row data types (Task 5)
- Produces (Task 10–14 ใช้):

```ts
// packages/contracts/src/enums.ts (moved here from Task 5 so round 1 never touches apps/pos twice)
export const ShiftStatus = z.enum(['open', 'counting', 'counted', 'closed'])      // R2
export const ShiftSyncMode = z.enum(['central', 'local_only'])                     // R1
// OutboxStatus gains 'closed_off_catalog' (§6.1) · EventType gains 'CLOSED_OFF_CATALOG', 'DELIVERED_ELSEWHERE' (§6.4)
// sqlite schema
shift.countedAt: text('counted_at')                              // D101 — set once (trigger)
shift.syncMode: textEnum('sync_mode', ShiftSyncMode).notNull().default('local_only')   // R1
cashCount.countedAt: text('counted_at') · cashCount.includesBotCash: bool('includes_bot_cash').notNull().default(false) // R5
order.offCatalogAt: text('off_catalog_at')                       // §6.4 badge "นอกแคตตาล็อก"
order.centralMismatchJson: json('central_mismatch_json').$type<CentralMismatch | null>() // m2 red bar
export type CentralMismatch = { orderNo: string; reportedTotalSatang: number; paymentIsCash: boolean; localTotalSatang: number; localPaymentIsCash: boolean }
// apps/pos/src/db/outbox.ts
export type PushRowInput =
  | { kind: 'order'; id: string; data: OrderRowData; parentKey: null }
  | { kind: 'order_void'; id: string; data: OrderVoidRowData; parentKey: string }
  | { kind: 'shift_open'; id: string; data: ShiftOpenRowData; parentKey: null }
  | { kind: 'cash_movement'; id: string; data: CashMovementRowData; parentKey: string }  // shift_open:<shift_id>
  | { kind: 'cash_count'; id: string; data: CashCountRowData; parentKey: string }        // shift_open:<shift_id>
  | { kind: 'shift_close'; id: string; data: ShiftCloseRowData; parentKey: string }      // cash_count:<count_id>
  | { kind: 'order_off_catalog'; id: string; data: OrderOffCatalogRowData; parentKey: null }
export async function enqueuePush(db: RemoteDb, row: PushRowInput, at: string, newId: () => string): Promise<void> // parses with PushRow first — a row the tablet built wrong fails its own save, never the queue
export const shiftParentKey = (shiftId: string): string => `shift_open:${shiftId}`
export const countParentKey = (countId: string): string => `cash_count:${countId}`
```

- [ ] **Step 0: เลือกเลข migration** — `ls packages/db-schema/drizzle/sqlite/*.sql` บน `block-3-pos` · ใช้เลขถัดจากไฟล์ล่าสุด (ก้อน 2 จบที่ `0005` ตามที่เห็นวันนี้ แต่ **ใช้ของจริง**) · ตั้งชื่อ `<NNNN>_block3_shift_cash.sql` · ทุกที่ในแผนที่เขียน "0006" หมายถึงไฟล์นี้ · เทสต์หาไฟล์ก่อนหน้าจาก journal ไม่ตรึงเลข

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `packages/db-schema/test/block3.test.ts` (ตัวช่วยเปิดฐานของเทสต์ migrate เดิม · `seedDevice`/`seedUser` แบบเทสต์ trigger เดิม)

```ts
import journal from '../drizzle/sqlite/meta/_journal.json' with { type: 'json' }
const THIS = journal.entries.find((e) => e.tag.endsWith('_block3_shift_cash'))!
const BEFORE = journal.entries[journal.entries.indexOf(THIS) - 1]!.tag  // never a hardcoded number (review item 14)

describe('block 3 migration (D101 · spec §4.10 ข้อ 4)', () => {
  it('every shift from before it becomes local_only; closed shifts get counted_at from their count', async () => {
    const db = await migratedTo(BEFORE)                                   // existing helper: apply up to a tag
    await seedClosedShiftWithCount(db, { shiftId: 'sh1', countCreatedAt: '2026-09-20T12:00:00.000Z' })
    await seedOpenShift(db, { shiftId: 'sh2' })
    await applyRemaining(db)
    expect(await db.all(`select id, sync_mode, counted_at, status from shift order by id`)).toEqual([
      { id: 'sh1', sync_mode: 'local_only', counted_at: '2026-09-20T12:00:00.000Z', status: 'closed' },
      { id: 'sh2', sync_mode: 'local_only', counted_at: null, status: 'open' },
    ])
    expect(await db.all(`select counted_at, includes_bot_cash from cash_count`)).toEqual([{ counted_at: '2026-09-20T12:00:00.000Z', includes_bot_cash: 0 }])
  })
  it('shift status only moves forward; counted_at is set once', async () => {
    const db = await migratedAll(); await seedOpenShift(db, { shiftId: 's' })
    await db.run(`update shift set status='counting', counted_at='2026-09-25T12:00:00.000Z' where id='s'`)
    await expect(db.run(`update shift set status='open' where id='s'`)).rejects.toThrow(/forward/)
    await expect(db.run(`update shift set counted_at='2026-09-25T13:00:00.000Z' where id='s'`)).rejects.toThrow(/once/)
    await db.run(`update shift set status='counted' where id='s'`)
    await db.run(`update shift set status='closed' where id='s'`)
  })
  it('a counting shift takes no bill and no cash movement (D101)', async () => {
    const db = await migratedAll(); await seedOpenShift(db, { shiftId: 's' })
    await db.run(`update shift set status='counting', counted_at='2026-09-25T12:00:00.000Z' where id='s'`)
    await expect(insertCashMovement(db, { shiftId: 's', kind: 'PAID_OUT' })).rejects.toThrow(/open shift/)
    await expect(insertOrder(db, { shiftId: 's' })).rejects.toThrow(/open shift/)
  })
  it('one count per shift; cash_count is append-only', async () => {
    const db = await migratedAll(); await seedOpenShift(db, { shiftId: 's' })
    await insertCashCount(db, { id: 'c1', shiftId: 's' })
    await expect(insertCashCount(db, { id: 'c2', shiftId: 's' })).rejects.toThrow(/UNIQUE/)
    await expect(db.run(`update cash_count set counted_satang = 1`)).rejects.toThrow(/append-only/)
    await expect(db.run(`delete from cash_count`)).rejects.toThrow(/append-only/)
  })
  it('one counting shift per device (R2)', async () => {
    const db = await migratedAll(); await seedOpenShift(db, { shiftId: 'a' })
    await db.run(`update shift set status='counting', counted_at='2026-09-25T12:00:00.000Z' where id='a'`)
    await seedOpenShift(db, { shiftId: 'b' })
    await expect(db.run(`update shift set status='counting', counted_at='2026-09-25T13:00:00.000Z' where id='b'`)).rejects.toThrow(/UNIQUE/)
  })
  it('foreign_key_check stays empty', async () => { const db = await migratedAll(); expect(await db.all('pragma foreign_key_check')).toEqual([]) })
})
```

(ตัวช่วย `migratedTo/applyRemaining/migratedAll/seed*/insert*` เขียนในไฟล์เทสต์นี้ด้วย SQL ตรงบนตัวรัน migrate ที่ `test/migrate.test.ts` ใช้อยู่)

`packages/contracts/test/enums.test.ts` (ย้ายมาจาก Task 5):

```ts
import { describe, expect, it } from 'vitest'
import { EventType, OutboxStatus, ShiftStatus, ShiftSyncMode } from '../src/enums'
describe('block 3 enums', () => {
  it('shift lifecycle, sync mode, outbox status and events', () => {
    expect(ShiftStatus.options).toEqual(['open', 'counting', 'counted', 'closed'])
    expect(ShiftSyncMode.options).toEqual(['central', 'local_only'])
    expect(OutboxStatus.options).toContain('closed_off_catalog')
    expect(EventType.options).toEqual(expect.arrayContaining(['CLOSED_OFF_CATALOG', 'DELIVERED_ELSEWHERE']))
  })
})
```

เพิ่มใน `apps/pos/test/pending-sync.test.ts` (หรือไฟล์ของ `enqueuePush` บน main):

```ts
it('enqueuePush refuses a row whose key does not match the kind id field (it is a tablet bug — the save fails, the queue does not)', async () => {
  const t = await openTestApi()
  const bad = { kind: 'cash_movement' as const, id: 'wrong-id', data: SAMPLE_MOVEMENT, parentKey: 'shift_open:x' }
  await expect(t.db.transaction((tx) => enqueuePush(tx, bad, t.clock.now(), t.deps.newId))).rejects.toThrow()
  expect(await t.db.select().from(s.outbox).all()).toEqual([])
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/db-schema exec vitest run test/block3.test.ts` · คาด FAIL
- [ ] **Step 3: ทำ** — `packages/contracts/src/enums.ts` ตาม Interfaces (คอมเมนต์ R1/R2/§6.1/§6.4) · ถ้า `apps/pos` typecheck ล้มเพราะ enum ใหม่ (switch แบบ exhaustive บน `ShiftStatus`/`OutboxStatus`) แก้ให้ถือ `counting`/`counted` เหมือน "ไม่เปิด" และ `closed_off_catalog` เหมือน "ไม่ส่งอีก" · `sales.ts` ตาม Interfaces · uniqueIndex `cash_count_shift_uq` บน `cash_count(shift_id)` · uniqueIndex `shift_counting_uq` บน `shift(device_id) where status = 'counting'` · รัน `pnpm --filter @dayo/db-schema generate` แล้วเติม SQL ท้าย `0006_block3_shift_cash.sql`:

```sql
-- block 3 (spec 04 §4.10 rule 4 · ruling R1): every shift from before this migration never reached dayo — local_only for good.
UPDATE `shift` SET `sync_mode` = 'local_only';
--> statement-breakpoint
UPDATE `shift` SET `counted_at` = (SELECT min(`created_at`) FROM `cash_count` WHERE `cash_count`.`shift_id` = `shift`.`id`) WHERE `status` = 'closed';
--> statement-breakpoint
UPDATE `cash_count` SET `counted_at` = `created_at`;
--> statement-breakpoint
CREATE TRIGGER `cash_count_no_update` BEFORE UPDATE ON `cash_count` BEGIN SELECT RAISE(ABORT, 'cash_count is append-only: UPDATE rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `cash_count_no_delete` BEFORE DELETE ON `cash_count` BEGIN SELECT RAISE(ABORT, 'cash_count is append-only: DELETE rejected'); END;
--> statement-breakpoint
CREATE TRIGGER `shift_status_forward_only` BEFORE UPDATE OF `status` ON `shift`
WHEN NEW.`status` NOT IN ('open', 'counting', 'counted', 'closed')
  OR (CASE NEW.`status` WHEN 'open' THEN 0 WHEN 'counting' THEN 1 WHEN 'counted' THEN 2 ELSE 3 END) < (CASE OLD.`status` WHEN 'open' THEN 0 WHEN 'counting' THEN 1 WHEN 'counted' THEN 2 ELSE 3 END)
BEGIN SELECT RAISE(ABORT, 'shift.status only moves forward: open → counting → counted → closed (D101)'); END;
--> statement-breakpoint
CREATE TRIGGER `shift_counted_at_once` BEFORE UPDATE OF `counted_at` ON `shift` WHEN OLD.`counted_at` IS NOT NULL AND NEW.`counted_at` IS NOT OLD.`counted_at`
BEGIN SELECT RAISE(ABORT, 'shift.counted_at is set once (D101)'); END;
--> statement-breakpoint
CREATE TRIGGER `cash_movement_open_shift_only` BEFORE INSERT ON `cash_movement` WHEN (SELECT `status` FROM `shift` WHERE `id` = NEW.`shift_id`) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'cash_movement needs an open shift (D101: a counted shift takes no more cash movements)'); END;
--> statement-breakpoint
CREATE TRIGGER `order_open_shift_only` BEFORE INSERT ON `order` WHEN NEW.`shift_id` IS NOT NULL AND (SELECT `status` FROM `shift` WHERE `id` = NEW.`shift_id`) IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'a bill needs an open shift (D101)'); END;
```

(ADD COLUMN ของ drizzle: `sync_mode text DEFAULT 'local_only' NOT NULL` · `includes_bot_cash integer DEFAULT false NOT NULL` · ถ้า drizzle-kit สร้างเป็นการสร้างตารางใหม่แทน ADD COLUMN ให้เขียน `ALTER TABLE … ADD` เองแบบ 0005 — ห้ามสร้างตาราง `shift`/`order` ใหม่ เพราะ R2-7 ของแผน 3b: `rowid` ต้องคงลำดับ) · `pnpm --filter @dayo/db-schema gen:browser` · `apps/pos/src/db/outbox.ts` ตาม Interfaces (`enqueuePush` เรียก `PushRow.parse({ key: \`${row.kind}:${row.id}\`, kind: row.kind, data: row.data })` ก่อน insert · `tableName = row.kind`) · เทสต์ใน `apps/pos` ที่ใส่บิล/เงินเข้า-ออกลงกะที่ปิดแล้วตรงๆ ด้วย SQL (ถ้ามี) ให้เปิดกะก่อน

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/db-schema test && pnpm --filter @dayo/pos test`
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 6: commit** — stage ไฟล์ตาม Files (รวม `packages/contracts/src/enums.ts`, `packages/contracts/test/enums.test.ts`, snapshot/journal ของ drizzle) · ข้อความ: `feat(db-schema): add the block 3 shift lifecycle, sync mode and count freeze`

### Task 10: ตัวส่ง — ช่องบิล/ช่องกะ · ลูกรอแม่ทุกชนิด · `scope:` · `releaseChildren` · ผลรับชนิดใหม่ · E4 client

ผู้ทำ: sync-engineer (opus) · ผู้ตรวจเพิ่ม: **security-reviewer** (key ในคำขอ E4 · เงินซ้ำเมื่อลูกกลับคิว) · สเปก §4.10 (ลำดับ ช่อง แถวแม่) · §6.2 · §6.3 · §6.4 (`scope:`) · ruling R13, R14, R16, R18 · รอ: Task 3, 6, 9 · **ก้อน 2 Task 13 บน `main`**

**Files:**
- Create: `apps/pos/src/sync/lanes.ts`, `apps/pos/test/lanes.test.ts`, `apps/pos/test/push-block3.test.ts`
- Modify: `apps/pos/src/sync/push.ts`, `apps/pos/src/sync/dayo-client.ts`, `apps/pos/src/sync/state.ts`, `apps/pos/test/dayo-client.test.ts`

**Interfaces:**
- Consumes: `pushOnce`, `retryRow`, `CLOCK_AHEAD_FAR_MS`, คิวแบบหน้า (ก้อน 2 T13) · `laneOf`, `detailPrefix`, `KIND_SCOPE`, `ShiftCashResponse`, `OffCatalogAcceptedData` (Task 5) · `enqueuePush` (Task 9) · builders (Task 3) · `openConnectedApi({ block3 })` (Task 6)
- Produces (Task 12, 14 ใช้):

```ts
// sync/lanes.ts
export type QueueRow = { id: string; kind: string; key: string; createdAt: string; nextAttemptAt: string | null; parentKey: string | null; supported: boolean; bytes: number } // bytes = UTF-8 size of the row in the body
export type ParentState = 'sent' | 'pending' | 'dead' | 'local_only' | 'closed_off_catalog' | 'missing'
export type BatchBudget = { maxRows: number; maxBytes: number }   // pushOnce passes { 20 (or 1 in single-row mode), 262_144 − envelope bytes }
export function createLanePicker(parentState: (key: string) => ParentState, nowIso: string, budget: BatchBudget): { offer(r: QueueRow): boolean; full(): boolean; oversized(): QueueRow[] }
// oversized() = rows that could go now but are bigger than an EMPTY batch (bytes > maxBytes) — pushOnce marks them dead ENVELOPE (round 2 item 4)
// sync/push.ts
export const SCOPE_RETRY_MS = 15 * 60_000, SCOPE_RED_AFTER_MS = 24 * 3_600_000, SCOPE_CLOSABLE_AFTER_MS = 7 * 86_400_000
export async function releaseChildren(tx: RemoteDb, parentKeys: readonly string[]): Promise<number>
// sync/state.ts — encodeLastError extra gains { scopeSince?: string; prefix?: string }; decodeLastError returns them
// sync/dayo-client.ts — DayoClient gains shiftCash(q: { after: string; until: string }): Promise<Timed<ShiftCashData>>
```

กติกาใหม่ของตัวส่ง (เพิ่มจากก้อน 2 — กติกาเดิมทุกข้อคงอยู่):

| สถานการณ์ | ทำอะไร |
|---|---|
| เลือกแถว | `status='pending'` ทุกชนิดใน `PUSH_KINDS` เรียง `created_at, id` ผ่าน `createLanePicker` ต่อหน้า 200 แถว (สถานะด่านช่องกะและงบของก้อนอยู่ข้ามหน้า) · แถวช่องกะแรกที่ "ยังไปไม่ได้" (backoff / `scope:` / นาฬิกาล้ำ / ชนิด-ฟิลด์ไม่รองรับ / แม่ยังไม่ `sent` และไม่ได้ **วางลงก้อนนี้** ก่อนหน้า) **หรือไม่พอที่ในก้อน (จำนวนแถว/ไบต์ — review item 6)** **ปิดช่องกะสำหรับก้อนนี้** · แถวที่ไม่ได้วางลงก้อนไม่นับเป็นแม่ที่ "อยู่ก่อนหน้าในก้อน" · ช่องบิลตามกติกาก้อน 2 (แถวบิลที่ไม่พอที่ = ข้ามไป ไม่ปิดอะไร) · แถวเดียวใหญ่เกินทั้งก้อน = `dead ENVELOPE` ตามก้อน 2 (ตรวจก่อนถึงตัวเลือก) |
| แม่ `dead` | ลูก → `dead PARENT_REJECTED` ทันที (ทุกชนิด ตาม `parent_key`) |
| แม่ `local_only` | ลูก → `local_only` (ทุกชั้น) |
| แม่ `closed_off_catalog` | ลูกรอ (Task 14 ย้าย `parent_key` ไป `order_off_catalog:<id>`) |
| `rejected FORBIDDEN` + `scope:` | `pending` · `attempts` ไม่เพิ่ม · `next_attempt_at` = ตอนนี้ + 15 นาที · `last_error` = `{reason:'FORBIDDEN', detail, prefix:'scope:', scopeSince: <ครั้งแรก>}` · นับใน `deferred` |
| `rejected` อื่น | `dead` · `last_error` เก็บ `prefix` · `result_json` = `data` ของคำตัดสินถ้ามี (R16) |
| `accepted`/`duplicate` | `sent` + `result_json` · `order_off_catalog` → `order.central_order_no` · ชนิดกะ → เก็บผลอย่างเดียว · **หลังจบลูป**: `releaseChildren(keys ที่เพิ่ง sent)` |

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/test/lanes.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { createLanePicker, type QueueRow } from '../src/sync/lanes'

const NOW = '2026-09-25T12:00:00.000Z'
const BIG = { maxRows: 20, maxBytes: 262_144 }
const r = (key: string, over: Partial<QueueRow> = {}): QueueRow => ({ id: key, kind: key.split(':')[0]!, key, createdAt: NOW, nextAttemptAt: null, parentKey: null, supported: true, bytes: 300, ...over })
const pick = (p: ReturnType<typeof createLanePicker>, rows: QueueRow[]) => rows.filter((x) => p.offer(x)).map((x) => x.key)

describe('lanes (spec 04 §6.2)', () => {
  it('a shift-lane row that cannot go holds every later shift-lane row, bills keep going', () => {
    const p = createLanePicker(() => 'sent', NOW, BIG)
    expect(pick(p, [r('shift_open:a', { nextAttemptAt: '2026-09-25T12:00:05.000Z' }), r('order:1'), r('cash_movement:m', { parentKey: 'shift_open:a' }), r('shift_open:b'), r('order:2')])).toEqual(['order:1', 'order:2'])
  })
  it('a child goes in the same batch right after its parent', () => {
    const p = createLanePicker((k) => (k === 'shift_open:a' ? 'pending' : 'sent'), NOW, BIG)
    expect(pick(p, [r('shift_open:a'), r('cash_count:c', { parentKey: 'shift_open:a' }), r('shift_close:a', { parentKey: 'cash_count:c' })])).toEqual(['shift_open:a', 'cash_count:c', 'shift_close:a'])
  })
  it('an order_void waits for an order that is not sent and not earlier in the batch (block 2 rule kept)', () => {
    const p = createLanePicker(() => 'pending', NOW, BIG)
    expect(p.offer(r('order_void:1', { parentKey: 'order:1' }))).toBe(false)
  })
  it('an unsupported shift row also holds the lane (held, never counted)', () => {
    const p = createLanePicker(() => 'sent', NOW, BIG)
    expect(pick(p, [r('shift_open:a', { supported: false }), r('shift_open:b')])).toEqual([])
  })
  it('a large shift_close that does not fit the bytes left closes the shift lane for this batch; later bills still fit (review item 6)', () => {
    const p = createLanePicker((k) => (k === 'shift_open:a' || k === 'cash_count:c' ? 'pending' : 'sent'), NOW, { maxRows: 20, maxBytes: 1_000 })
    expect(pick(p, [r('shift_open:a'), r('cash_count:c', { parentKey: 'shift_open:a' }), r('shift_close:a', { parentKey: 'cash_count:c', bytes: 900 }), r('shift_open:b', { bytes: 10 }), r('order:1')]))
      .toEqual(['shift_open:a', 'cash_count:c', 'order:1'])
  })
  it('the shift lane also closes when the row count is used up; only rows actually placed count as taken parents', () => {
    const p = createLanePicker(() => 'pending', NOW, { maxRows: 1, maxBytes: 262_144 })
    expect(pick(p, [r('order:1'), r('shift_open:a'), r('cash_movement:m', { parentKey: 'shift_open:a' })])).toEqual(['order:1'])
    expect(p.full()).toBe(true)
  })
  it('a row bigger than an EMPTY batch is reported as oversized (→ dead ENVELOPE) and closes the shift lane for this pass (round 2 item 4)', () => {
    const p = createLanePicker(() => 'sent', NOW, BIG)
    expect(pick(p, [r('shift_close:a', { bytes: 300_000 }), r('shift_open:b'), r('order:1')])).toEqual(['order:1'])
    expect(p.oversized().map((x) => x.key)).toEqual(['shift_close:a'])
  })
  it('a bill that does not fit is skipped; a smaller one after it still goes', () => {
    const p = createLanePicker(() => 'sent', NOW, { maxRows: 20, maxBytes: 1_000 })
    expect(pick(p, [r('order:1', { bytes: 800 }), r('order:2', { bytes: 800 }), r('order:3', { bytes: 100 })])).toEqual(['order:1', 'order:3'])
  })
})
```

`apps/pos/test/push-block3.test.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { buildCashMovementRowData, buildShiftOpenRowData } from '@dayo/domain'
import { enqueuePush } from '../src/db/outbox'
import { pushOnce, releaseChildren, SCOPE_RETRY_MS } from '../src/sync/push'
import { decodeLastError } from '../src/sync/state'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

const SH = '5a5a5a5a-0000-4000-8000-000000000001'
const M1 = '6b6b6b6b-0000-4000-8000-000000000001'
/** No shift from the helper (review item 4): Task 11, merged in the same round, makes an opened shift queue its own
 * shift_open — these tests build every shift-lane row themselves and assert by key, never by counting rows. */
async function ready() {
  const t = await openConnectedApi({ block3: true, openShift: false })
  return { t, ctx: { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() } }
}
type T = Awaited<ReturnType<typeof ready>>['t']
/** A bill needs an open shift; opened AFTER the test's own shift rows so it never sits ahead of them in the lane. */
async function sellOne(t: T) {
  if ((await t.api.bootstrap()).openShift === null) await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 0 }) // BootstrapState.openShift (block 2 api/types.ts)
  return sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
}
async function queueShift(t: T, id = SH) {
  const at = t.clock.now()
  await t.db.transaction((tx) => enqueuePush(tx, { kind: 'shift_open', id, data: buildShiftOpenRowData({ shiftId: id, businessDate: '2026-09-25', openedAt: at, openedBy: STAFF.TungAo, openingFloatSatang: 50_000, quickOpen: false }), parentKey: null }, at, t.deps.newId))
}
async function queuePaidOut(t: T, id = M1, shiftId = SH) {
  t.clock.advanceMs(1_000)
  const at = t.clock.now()
  await t.db.transaction((tx) => enqueuePush(tx, { kind: 'cash_movement', id, data: buildCashMovementRowData({ movementId: id, shiftId, kind: 'PAID_OUT', amountSatang: 2_000, posOrderId: null, reason: 'ซื้อน้ำแข็ง', createdBy: STAFF.TungAo, createdAt: at }), parentKey: `shift_open:${shiftId}` }, at, t.deps.newId))
}
const row = async (t: T, key: string) => (await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, key)).get())!

describe('pushOnce — block 3 lanes and verdicts (spec 04 §6.2 · §4.10)', () => {
  it('shift rows go in order and are accepted; the result data is kept', async () => {
    const { t, ctx } = await ready()
    await queueShift(t); await queuePaidOut(t)
    expect(await pushOnce(ctx)).toMatchObject({ sent: 2 })
    expect((await row(t, `cash_movement:${M1}`)).resultJson).toEqual({ movement_id: M1 })
    expect(t.mock.movements()).toHaveLength(1)
  })
  it('a deferred shift row holds the shift lane across requests while bills still go (C3)', async () => {
    const { t, ctx } = await ready()
    await queueShift(t); await queuePaidOut(t)
    t.mock.override({ match: { key: `shift_open:${SH}` }, verdict: { status: 'deferred', reason: 'BUSY', detail: 'lock' }, times: 1 })
    await pushOnce(ctx)                                     // shift_open BUSY; the movement in the same request answers PARENT_PENDING
    t.clock.advanceMs(1_000)                                // shift_open backoff (5 s) not over yet
    const bill = await sellOne(t)
    await pushOnce(ctx)
    expect((await row(t, `order:${bill.orderId}`)).status).toBe('sent')      // the bill lane went
    expect(await row(t, `shift_open:${SH}`)).toMatchObject({ status: 'pending', attempts: 1 })
    expect(await row(t, `cash_movement:${M1}`)).toMatchObject({ status: 'pending' }) // held behind it, by key
    expect(t.mock.movements()).toEqual([])
    t.clock.advanceMs(6_001)                                // past the first backoff even at +20% jitter (5 s × 1.2)
    await pushOnce(ctx)
    expect((await row(t, `cash_movement:${M1}`)).status).toBe('sent')
  })
  it('FORBIDDEN "scope:" waits like a deferred row: pending, not counted, every 15 min, never on the problems page (m1)', async () => {
    const { t, ctx } = await ready()
    t.mock.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write'])
    await queueShift(t)
    await pushOnce(ctx)
    const r1 = await row(t, `shift_open:${SH}`)
    expect(r1).toMatchObject({ status: 'pending', attempts: 0 })
    expect(Date.parse(r1.nextAttemptAt!) - Date.parse(t.clock.now())).toBe(SCOPE_RETRY_MS)
    const since = decodeLastError(r1.lastError).scopeSince
    expect(decodeLastError(r1.lastError)).toMatchObject({ reason: 'FORBIDDEN', prefix: 'scope:', scopeSince: t.clock.now() })
    t.clock.advanceMs(SCOPE_RETRY_MS); await pushOnce(ctx)
    expect(decodeLastError((await row(t, `shift_open:${SH}`)).lastError).scopeSince).toBe(since) // the first time is kept
    t.mock.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write', 'shift:write'])
    t.clock.advanceMs(SCOPE_RETRY_MS); await pushOnce(ctx)
    expect((await row(t, `shift_open:${SH}`)).status).toBe('sent')
  })
  it('a rejected shift_open sends its children to PARENT_REJECTED; once it is accepted they come back by themselves (R-I1 · R18)', async () => {
    const { t, ctx } = await ready()
    await queueShift(t); await queuePaidOut(t)
    t.mock.override({ match: { key: `shift_open:${SH}` }, verdict: { status: 'rejected', reason: 'UNKNOWN_STAFF', detail: 'x' }, times: 1 })
    await pushOnce(ctx)
    expect(decodeLastError((await row(t, `cash_movement:${M1}`)).lastError).reason).toBe('PARENT_REJECTED')
    await t.db.update(s.outbox).set({ status: 'pending', attempts: 0, nextAttemptAt: null }).where(eq(s.outbox.idempotencyKey, `shift_open:${SH}`)) // the owner's fix (Task 14) — children NOT touched here
    await pushOnce(ctx)                                     // parent accepted → children released in the same transaction
    expect((await row(t, `cash_movement:${M1}`)).status).toBe('pending')
    await pushOnce(ctx)
    expect((await row(t, `cash_movement:${M1}`)).status).toBe('sent')
  })
  it('a rejected row keeps the verdict data (exists: comparisons — R16)', async () => {
    const { t, ctx } = await ready()
    const bill = await sellOne(t)
    const data = { order_no: 'L260925-001', version: 1, reported_total: 45, payment_is_cash: false, off_catalog: true }
    t.mock.override({ match: { key: `order:${bill.orderId}` }, verdict: { status: 'rejected', reason: 'CONFLICT', detail: 'off_catalog_exists: L260925-001', data }, times: 1 })
    await pushOnce(ctx)
    expect(await row(t, `order:${bill.orderId}`)).toMatchObject({ status: 'dead', resultJson: data })
    expect(decodeLastError((await row(t, `order:${bill.orderId}`)).lastError).prefix).toBe('off_catalog_exists:')
  })
  it('releaseChildren puts back only the PARENT_REJECTED children of the given parents (review item 13)', async () => {
    const { t, ctx } = await ready()
    const SH2 = '5a5a5a5a-0000-4000-8000-000000000002'
    const M2 = '6b6b6b6b-0000-4000-8000-000000000002'
    await queueShift(t); await queuePaidOut(t); await queueShift(t, SH2); await queuePaidOut(t, M2, SH2)
    t.mock.override({ match: { key: `shift_open:${SH}` }, verdict: { status: 'rejected', reason: 'INVALID', detail: 'x' }, times: 1 })
    t.mock.override({ match: { key: `shift_open:${SH2}` }, verdict: { status: 'rejected', reason: 'INVALID', detail: 'y' }, times: 1 })
    await pushOnce(ctx)
    expect(await t.db.transaction((tx) => releaseChildren(tx, []))).toBe(0)
    expect(await t.db.transaction((tx) => releaseChildren(tx, [`shift_open:${SH}`]))).toBe(1)
    expect(await row(t, `cash_movement:${M1}`)).toMatchObject({ status: 'pending', attempts: 0, lastError: null, nextAttemptAt: null })
    expect(decodeLastError((await row(t, `cash_movement:${M2}`)).lastError).reason).toBe('PARENT_REJECTED') // other parent: untouched
    expect((await row(t, `shift_open:${SH}`)).status).toBe('dead')                                         // the parent itself: untouched
  })
  it('a shift_close near the 2000-bill cap (> 262,144 bytes on its own) becomes dead ENVELOPE; the rows before it still go (round 2 item 4)', async () => {
    const { t, ctx } = await ready()
    await queueShift(t)
    const C = '7c7c7c7c-0000-4000-8000-000000000001'
    const at = t.clock.now()
    const posBills = Array.from({ length: 2000 }, (_, i) => ({ pos_order_id: `0b0b0b0b-0000-4000-8000-${String(i).padStart(12, '0')}`, receipt_no: `A-${String(i + 1).padStart(6, '0')}`, payment: 'qr', total: 35, sold_at: at, voided_at: null }))
    const data = { shift_id: SH, count_id: C, closed_by: STAFF.TungAo, closed_at: at, variance_reason: null, z_report: {
      z_no: 1, hash: 'ab'.repeat(32), prev_hash: null, variance_alert: 20, chain_warning: false,
      cash: { opening_float: 500, pos_cash_sales: 0, void_refunds: 0, paid_in: 0, paid_out: 0, drops: 0, drawer_expenses: 0, bot_cash: 0 },
      counted: 500, bot_window: { after: '2026-09-24T17:00:00.000Z', until: at }, movement_ids: [], bot_bills: [], pos_bills: posBills } }
    expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeGreaterThan(262_144)
    await t.db.transaction((tx) => enqueuePush(tx, { kind: 'shift_close', id: SH, data, parentKey: `shift_open:${SH}` }, at, t.deps.newId))
    await pushOnce(ctx)
    expect((await row(t, `shift_open:${SH}`)).status).toBe('sent')
    expect(await row(t, `shift_close:${SH}`)).toMatchObject({ status: 'dead' })
    expect(decodeLastError((await row(t, `shift_close:${SH}`)).lastError).reason).toBe('ENVELOPE')
  })
  it('without the block 3 kinds in E1 the shift rows are held (not counted, not sent)', async () => {
    const t = await openConnectedApi({ block3: false, openShift: false })
    const ctx = { db: t.db, deps: t.deps, serial: <T2>(fn: () => Promise<T2>) => fn() }
    await queueShift(t as T)
    expect(await pushOnce(ctx)).toMatchObject({ held: 1, requests: 0 })
  })
})
```

เพิ่มใน `apps/pos/test/dayo-client.test.ts`:

```ts
it('shiftCash asks E4 with after/until and parses the bills', async () => {
  const mock = createMockDayo({ now: '2026-09-25T12:10:00.000Z', block3: true })
  mock.seedCentralOrders([{ order_no: 'L260925-901', sale_date: '2026-09-25', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'line', payment: 'cash', totals: { items_subtotal: 70, items_discount: 0, bill_discount: 0, total: 70 }, amount_mismatch: false, updated_at: '2026-09-25T04:00:00+00:00', sold_at: '2026-09-25T04:00:00+00:00' }])
  const c = createDayoClient({ baseUrl: 'http://localhost:8787/api/v1', apiKey: MOCK_API_KEY, fetch: mock.fetch, nowMs: () => Date.parse('2026-09-25T12:10:00.000Z') })
  const r = await c.shiftCash({ after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:00.000Z' })
  expect(r.value).toMatchObject({ cash_total: 70, bills: [{ order_no: 'L260925-901', total: 70 }] })
  expect(mock.requests().at(-1)).toMatchObject({ path: '/api/v1/pos/shift-cash', status: 200 })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos exec vitest run test/lanes.test.ts test/push-block3.test.ts test/dayo-client.test.ts` · คาด FAIL
- [ ] **Step 3: ทำ** — `apps/pos/src/sync/lanes.ts`:

```ts
import { laneOf } from '@dayo/contracts'

export type QueueRow = { id: string; kind: string; key: string; createdAt: string; nextAttemptAt: string | null; parentKey: string | null; supported: boolean; bytes: number }
export type ParentState = 'sent' | 'pending' | 'dead' | 'local_only' | 'closed_off_catalog' | 'missing'
export type BatchBudget = { maxRows: number; maxBytes: number }

/**
 * spec 04 §6.2 · §4.10: rows are offered oldest first (created_at, id). `offer` returns true only when the row is PLACED in
 * this batch. The shift lane is strict: the first shift-lane row that cannot go now — not due, unsupported, parent neither
 * sent nor placed, or no room left (rows/bytes, review item 6) — closes the lane for every later shift-lane row of this
 * batch. The bill lane keeps block 2's rule; a bill with no room is skipped. `taken` holds placed rows only.
 */
export function createLanePicker(parentState: (key: string) => ParentState, nowIso: string, budget: BatchBudget): { offer(r: QueueRow): boolean; full(): boolean; oversized(): QueueRow[] } {
  const taken = new Set<string>()
  const tooBig: QueueRow[] = []
  let shiftClosed = false
  let rows = 0
  let bytes = 0
  return {
    offer(r) {
      const shift = laneOf(r.kind) === 'shift'
      if (shift && shiftClosed) return false
      const due = r.nextAttemptAt === null || r.nextAttemptAt <= nowIso
      const parentOk = r.parentKey === null || taken.has(r.parentKey) || parentState(r.parentKey) === 'sent'
      const ready = due && r.supported && parentOk
      if (ready && r.bytes > budget.maxBytes) {
        // bigger than an empty batch: it can never go — pushOnce turns it into dead ENVELOPE (the owner can then
        // "ปิดไว้ในเครื่อง") instead of it holding the shift lane forever (round 2 item 4)
        tooBig.push(r)
        if (shift) shiftClosed = true
        return false
      }
      const fits = rows + 1 <= budget.maxRows && bytes + r.bytes <= budget.maxBytes
      if (!(ready && fits)) {
        if (shift) shiftClosed = true
        return false
      }
      taken.add(r.key)
      rows += 1
      bytes += r.bytes
      return true
    },
    full: () => rows >= budget.maxRows,
    oversized: () => [...tooBig],
  }
}
```

`push.ts` (ต่อยอดจากก้อน 2 · อธิบายตามตารางกติกาข้างบน):
1. ตัวเลือกแถวเดิมเปลี่ยนจาก "ชนิด `order`/`order_void`" เป็น `PUSH_KINDS` และส่งทุกแถวผ่าน `picker.offer` (สร้างครั้งเดียวต่อ `pushOnce` ด้วย `{ maxRows: โหมดทีละแถว ? 1 : MAX_PUSH_ROWS, maxBytes: MAX_PUSH_BODY_BYTES − ไบต์ของซอง }` · `bytes` ของแถว = ตัวนับไบต์ UTF-8 เดิมของก้อน 2 · หยุดอ่านหน้าถัดไปเมื่อ `picker.full()` · ทุกแถวใน `picker.oversized()` → `dead` `ENVELOPE` ในธุรกรรมเดียวกับการเลือก (ก่อนส่งคำขอ · ไม่นับครั้ง) — ลูกของมันเป็น `PARENT_REJECTED` ในรอบถัดไปตามกติกาเดิม · ตัวนับไบต์ของก้อน 2 ที่เคยตัดสินว่า "ก้อนเต็ม" ย้ายเข้าตัวเลือกนี้ทั้งหมด ไม่มีสองที่) · `parentState(key)` อ่าน `status` ของแถวแม่ใน outbox (ไม่มีแถว = `'missing'` → ลูกรอ) · ขั้น "แม่ `dead` → ลูก `PARENT_REJECTED`" และ "แม่ `local_only` → ลูก `local_only`" ของก้อน 2 ใช้ `parent_key` ของทุกชนิด (ไม่ใช่แค่ `order_void`) และไล่ต่อหลายชั้นในรอบเดียว (`shift_open` → `cash_count` → `shift_close`)
2. ในลูปคำตัดสิน ก่อนกิ่ง `rejected` เดิม:

```ts
if (v.status === 'rejected' && v.reason === 'FORBIDDEN' && detailPrefix(v.detail) === 'scope:') {
  const prev = decodeLastError(r.lastError)
  await tx.update(s.outbox).set({
    status: 'pending', nextAttemptAt: new Date(Date.parse(now) + SCOPE_RETRY_MS).toISOString(),
    lastError: encodeLastError('FORBIDDEN', clipCodePoints(v.detail ?? '', MAX_DETAIL_CODE_POINTS), { prefix: 'scope:', scopeSince: prev.scopeSince ?? now }),
  }).where(and(eq(s.outbox.id, r.id), eq(s.outbox.status, 'pending')))
  outcome.deferred += 1
  continue
}
```

3. กิ่ง `rejected` อื่น: `lastError` = `encodeLastError(v.reason, detail, { ...(prefix ? { prefix } : {}) })` · `resultJson: v.data ?? null`
4. กิ่ง `accepted`/`duplicate`: เพิ่ม `case 'order_off_catalog'` → `OffCatalogAcceptedData.safeParse(v.data)` สำเร็จ = `update order set central_order_no = data.order_no where id = <uuid ใน key>` · ชนิดกะไม่มีผลข้างเคียงนอก `result_json` · เก็บ `key` ลง `sentKeys`
5. หลังจบลูปในธุรกรรมเดียวกัน: `await releaseChildren(tx, sentKeys)`

```ts
/** R18 · spec §4.10: once a parent is accepted (or acknowledged), its PARENT_REJECTED children go back to the queue in their old order. */
export async function releaseChildren(tx: RemoteDb, parentKeys: readonly string[]): Promise<number> {
  if (parentKeys.length === 0) return 0
  const rows = await tx.select({ id: s.outbox.id, lastError: s.outbox.lastError }).from(s.outbox).where(and(inArray(s.outbox.parentKey, [...parentKeys]), eq(s.outbox.status, 'dead'))).all()
  const ids = rows.filter((x) => decodeLastError(x.lastError).reason === 'PARENT_REJECTED').map((x) => x.id)
  if (ids.length > 0) await tx.update(s.outbox).set({ status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null, deadAt: null }).where(inArray(s.outbox.id, ids))
  return ids.length
}
```

`state.ts`: `encodeLastError(reason, detail, extra: { supportedHash?: string; farAhead?: true; scopeSince?: string; prefix?: string } = {})` และ `decodeLastError` คืนช่องเดียวกัน · `dayo-client.ts`:

```ts
  shiftCash: (q) => call(`/pos/shift-cash?after=${encodeURIComponent(q.after)}&until=${encodeURIComponent(q.until)}`, { method: 'GET' }, (b) => ShiftCashResponse.parse(b).data),
```

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test` (เทสต์ `push.test.ts` ของก้อน 2 ต้องผ่านทั้งหมดโดยไม่แก้ความคาดหวัง)
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 6: commit** — stage `apps/pos/src/sync/{lanes,push,dayo-client,state}.ts` + เทสต์สามไฟล์ · ข้อความ: `feat(pos): send shift rows in one strict lane and wait out missing scopes`

### Task 11: กะ `central`/`local_only` · แถว `shift_open` · เงินเข้า-ออกและเงินคืนเข้าช่องกะ · บิลมี `shift_id` · ป้าย "ยังไม่ส่ง"

ผู้ทำ: sync-engineer (opus) · ผู้ตรวจเพิ่ม: **security-reviewer** (เงิน) · สเปก §4.5 `shift_id` · §4.10 ข้อ 4 · ตาราง `shift_open`/`cash_movement` · §6.1 · D36 · D50 Q3-26 · D52 Q3b-9/Q3b-10 · ruling R1 · รอ: Task 3, 6, 9 · ก้อน 2 Task 12

**Files:**
- Modify: `apps/pos/src/api/{shift,cash,void,sale,bootstrap,types}.ts`
- Create: `apps/pos/test/shift-central.test.ts`

**Interfaces:**
- Consumes: `buildShiftOpenRowData`, `buildCashMovementRowData`, `buildOrderRowData({ shiftId })` (Task 3) · `enqueuePush`, `shiftParentKey` (Task 9) · `readSupported` (ก้อน 2 T10) · `isDayoLinked` (ก้อน 2 T11) · `SHIFT_LANE_KINDS`
- Produces (Task 12–14 ใช้):

```ts
// api/shift.ts
export async function shiftSyncMode(db: RemoteDb, deps: ApiDeps): Promise<ShiftSyncMode> // R1: 'central' iff linked AND E1 supported_kinds has all four shift kinds
// ShiftDto gains syncMode: ShiftSyncMode · currentOpenShift returns it
// openShift/quickOpenShift: refuse COUNT_PENDING while a shift of the device is 'counting' (R2) · PosApi pulls E1 first, outside the serial queue, when linked (R1 · §6.5)
// api/cash.ts insertManualCashMovement + api/void.ts VOID_REFUND: central → enqueuePush cash_movement (parent shift_open:<id>) · local_only → enqueueLocalOnly
// api/sale.ts recordSale: shift_id = shift.syncMode === 'central' ? shift.id : null
// api/bootstrap.ts countPendingSyncItems / countSyncProblems: shift-lane rows count 1 per key (D50 Q3-26); closed_off_catalog never counted
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/test/shift-central.test.ts`

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { CashMovementRowData, OrderRowData, ShiftOpenRowData } from '@dayo/contracts'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

const approve = { approverUserId: STAFF.DCm, approverPin: '2222' }
const outboxOf = async (t: Awaited<ReturnType<typeof openConnectedApi>>, kind: string) => t.db.select().from(s.outbox).where(eq(s.outbox.tableName, kind)).all()

describe('central shifts (spec 04 §4.10 ข้อ 4 · ruling R1)', () => {
  it('a shift opened while dayo supports the shift kinds is central and queues shift_open', async () => {
    const t = await openConnectedApi({ block3: true })
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, t.shift.id)).get())?.syncMode).toBe('central')
    const [row] = await outboxOf(t, 'shift_open')
    expect(row).toMatchObject({ status: 'pending', idempotencyKey: `shift_open:${t.shift.id}`, parentKey: null })
    expect(ShiftOpenRowData.parse(row!.rowJson)).toMatchObject({ shift_id: t.shift.id, opening_float: 500, quick_open: false, opened_by: STAFF.TungAo, business_date: '2026-09-25' })
  })
  it('without the shift kinds the shift stays local_only; its rows never queue for push and its bills carry shift_id null', async () => {
    const t = await openConnectedApi({ block3: false })
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, t.shift.id)).get())?.syncMode).toBe('local_only')
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'shift')).get())?.status).toBe('local_only')
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    expect(OrderRowData.parse((await outboxOf(t, 'order')).find((x) => x.idempotencyKey === `order:${r.orderId}`)!.rowJson).shift_id).toBeNull()
  })
  it('a bill of a central shift carries its shift_id', async () => {
    const t = await openConnectedApi({ block3: true })
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    expect(OrderRowData.parse((await outboxOf(t, 'order')).find((x) => x.idempotencyKey === `order:${r.orderId}`)!.rowJson).shift_id).toBe(t.shift.id)
  })
  it('a paid-out goes into the shift lane under its shift_open', async () => {
    const t = await openConnectedApi({ block3: true })
    const m = await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'ซื้อน้ำแข็ง' })
    const [row] = await outboxOf(t, 'cash_movement')
    expect(row).toMatchObject({ status: 'pending', idempotencyKey: `cash_movement:${m.id}`, parentKey: `shift_open:${t.shift.id}` })
    expect(CashMovementRowData.parse(row!.rowJson)).toMatchObject({ kind: 'PAID_OUT', amount: 20, reason: 'ซื้อน้ำแข็ง', pos_order_id: null })
  })
  it('voiding a cash bill queues VOID_REFUND with the bill id and no reason (D36)', async () => {
    const t = await openConnectedApi({ block3: true })
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, ...approve, reason: 'กดผิด', made: false, refundReference: null })
    const [row] = await outboxOf(t, 'cash_movement')
    expect(CashMovementRowData.parse(row!.rowJson)).toMatchObject({ kind: 'VOID_REFUND', amount: 45, pos_order_id: r.orderId, reason: null })
  })
  it('quick open queues quick_open: true (D52 Q3b-10)', async () => {
    const t = await openConnectedApi({ block3: true, openShift: false })                     // helper option from Task 6
    const sh = await t.api.quickOpenShift({ userId: STAFF.TungAo })
    const row = (await outboxOf(t, 'shift_open')).find((x) => x.idempotencyKey === `shift_open:${sh.id}`)!
    expect(ShiftOpenRowData.parse(row.rowJson)).toMatchObject({ quick_open: true, opening_float: 0 })
  })
  it('the "ยังไม่ส่ง" badge counts one per shift-lane row (D50 Q3-26)', async () => {
    const t = await openConnectedApi({ block3: true })
    await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_IN', amountSatang: 1_000, reason: 'แลกเหรียญ' })
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    expect(await t.api.bootstrap()).toMatchObject({ pendingSyncItems: 3 })                    // shift_open + cash_movement + 1 bill
  })
  it('R1: opening a shift pulls E1 first, so a dayo that just started supporting shifts is seen (§6.5 "ก่อนเปิดกะ")', async () => {
    const t = await openConnectedApi({ block3: false, openShift: false })   // linked while dayo had no shift kinds
    t.mock.setBlock3(true)                                                  // dayo deploys block 3; the tablet has not pulled E1 since
    const sh = await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, sh.id)).get())?.syncMode).toBe('central')
  })
  it('R1: offline at opening → decided from the last stored E1, never blocked', async () => {
    const t = await openConnectedApi({ block3: false, openShift: false })
    t.mock.setBlock3(true)
    t.mock.setMode('offline')
    const sh = await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, sh.id)).get())?.syncMode).toBe('local_only')
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos exec vitest run test/shift-central.test.ts` · คาด FAIL
- [ ] **Step 3: ทำ** — `api/shift.ts`:

```ts
/** Ruling R1: a shift reaches dayo only if, when it opens, the tablet is linked and dayo's E1 lists every shift kind. */
export async function shiftSyncMode(db: RemoteDb, deps: ApiDeps): Promise<ShiftSyncMode> {
  if (!(await isDayoLinked(db, deps))) return 'local_only'
  const sup = await readSupported(db)
  return sup !== null && SHIFT_LANE_KINDS.every((k) => sup.kinds.includes(k)) ? 'central' : 'local_only'
}
```

`insertOpenShift(tx, deps, deviceId, userId, openingFloatSatang, syncMode, quickOpen)` — ก่อนตรวจกะเปิด: มีกะของเครื่องสถานะ `counting` → `PosError('COUNT_PENDING', <shiftId>)` · แถว `shift` มี `syncMode` · `central` → `enqueuePush(tx, { kind: 'shift_open', id: row.id, data: buildShiftOpenRowData({ shiftId: row.id, businessDate: row.businessDate, openedAt: at, openedBy: userId, openingFloatSatang, quickOpen }), parentKey: null }, at, deps.newId)` · `local_only` → `enqueueLocalOnly(tx, 'shift', row, at, deps.newId)` (เดิม) · `openShift`/`quickOpenShift` คิด `syncMode` **ก่อน** เปิดธุรกรรม (อ่าน secret store) · `currentOpenShift` คืน `syncMode` · `cash.ts` `insertManualCashMovement` รับ `syncMode` จากกะ (อ่านแถวกะในธุรกรรม) แล้ว `central` → `enqueuePush({ kind: 'cash_movement', id: row.id, data: buildCashMovementRowData({ movementId: row.id, shiftId, kind, amountSatang, posOrderId: null, reason, createdBy: actorId, createdAt: at }), parentKey: shiftParentKey(shiftId) })` · `void.ts` VOID_REFUND แบบเดียวกัน (`posOrderId: order.id`, `reason: null`) · `sale.ts`: `shiftId: shift.syncMode === 'central' ? shift.id : null` · `bootstrap.ts`: ในนิพจน์นับของก้อน 2 เพิ่มกรณี `table_name in ('shift_open','cash_movement','cash_count','shift_close')` → `idempotency_key` · เงื่อนไข `status = 'pending'` เดิมไม่นับ `closed_off_catalog`/`local_only` อยู่แล้ว (เพิ่มเทสต์ยืนยันใน Task 14) · `pos-api.ts` (R1 · §6.5): `openShift`/`quickOpenShift` ของ PosApi เรียก `pullCatalog(ctx)` **ก่อน** และ **นอกคิว serial** เมื่อ `isDayoLinked` (ผลใดก็ได้ — ล้ม/ออฟไลน์/`blocked` ไม่หยุดการเปิดกะ · ไม่รอเกิน timeout 20 วิของตัวคุยเดิม) แล้วจึงเรียกตัวเปิดกะบนคิว serial · Task 11 ไม่แก้ `apps/pos/test/helpers/dayo.ts` (ตัวเลือก `openShift` มาจาก Task 6)

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test`
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 6: commit** — stage `apps/pos/src/api/{shift,cash,void,sale,bootstrap,types,pos-api}.ts apps/pos/test/shift-central.test.ts` · ข้อความ: `feat(pos): queue shift and cash rows of central shifts and tag bills with their shift`

### Task 12: นับเงินออนไลน์/ออฟไลน์ (D101) · E4 · ออก Z ที่ส่ง dayo · Z รอออนไลน์

ผู้ทำ: sync-engineer (opus) · ผู้ตรวจเพิ่ม: **security-reviewer** (PIN owner สองครั้ง · เงิน) · สเปก §4.10 (`cash_count` · `shift_close` · `z_report` · E4 · เงินสดที่ควรมี) · §6.8 ทั้งหมด · D52 · D53–D55 · D68 · D101 · D102 · ruling R2, R3, R5–R8, R20 · รอ: Task 2, 3, 10, 11

**Files:**
- Create: `apps/pos/src/api/count.ts`, `apps/pos/src/api/bot-cash.ts`, `apps/pos/test/count-z.test.ts`
- Modify: `apps/pos/src/api/{close,shift-report,bootstrap,types,pos-api}.ts`, `apps/pos/test/helpers/shift.ts`, เทสต์ปิดกะเดิมที่เรียก `closeShift` (ยังผ่านผ่านตัวห่อ)

**Interfaces:**
- Consumes: Task 2 (`withBotCash`, `ZBotBill`, `buildZReport`, `varianceNeedsReason`, `cashVarianceSatang`) · Task 3 (`buildCashCountRowData`, `buildShiftCloseRowData`, `ZPosBill`, `ZTooLargeError`, `MAX_Z_BOT_BILLS`) · Task 9 (`enqueuePush`, `shiftParentKey`, `countParentKey`) · Task 10 (`shiftCash`) · `readDayoConfig`, `recordDayoFailure`, `SyncContext` (ก้อน 2) · `requireOwnerPin` · `PAYMENT_CODE` (ก้อน 2 T12)
- Produces (Task 13–17 ใช้):

```ts
// api/types.ts
export type BotCashDto = { shiftId: string; after: string; until: string; bills: ZBotBill[]; cashTotalSatang: number; fetchedAt: string }
export type CountSummaryDto = ShiftReportDto & { countedAt: string; syncMode: ShiftSyncMode; includesBotCash: boolean; bot: BotCashDto | null }
export type ZSettle = { varianceReason: string | null; bankQrTotalSatang: number | null; acknowledgeZChainBroken: boolean }
export type ConfirmCountInput = { shiftId: string; actorUserId: string; approverUserId: string; approverPin: string; countLines: CashCountLine[]; shownFingerprint: string; z: ZSettle | null }
export type ConfirmCountResult = { countId: string; z: ZReportDto | null }
export type IssueZInput = ZSettle & { shiftId: string; approverUserId: string; approverPin: string; shownFingerprint: string }
export type WaitingZDto = { shiftId: string; businessDate: string; countedAt: string; syncMode: ShiftSyncMode; countedSatang: number } // countedSatang = the saved cash_count — IssueZScreen shows the variance from it
// PosApi gains
finishCount(i: { actorUserId: string }): Promise<{ shiftId: string; countedAt: string }> // "นับเสร็จ" — freezes the open shift (D101 step 1 · R3)
countSummary(shiftId: string): Promise<CountSummaryDto>                                   // ONE rule shared with confirmCount/issueZ (review item 1): a central shift uses the stored E4 preview when there is one
fetchBotCash(shiftId: string): Promise<BotCashDto>                                         // E4 — NOT on the serial queue · network failure = OFFLINE · 401/403/404 = DAYO_BAD_KEY/DAYO_KEY_NO_SCOPE/DAYO_API_DISABLED · 422 too_large = Z_TOO_LARGE · 5xx/429 = DAYO_UNREACHABLE (review item 9)
// The screen picks the path from summary.includesBotCash (true → z: ZSettle, reason asked; false → z: null), never from whether its own fetchBotCash call failed.
confirmCount(i: ConfirmCountInput): Promise<ConfirmCountResult>                           // owner PIN · z != null: count + Z in one transaction (D101 step 2)
issueZ(i: IssueZInput): Promise<ZReportDto>                                                // owner PIN again (D101 step 3)
// BootstrapState gains countingShift: { shiftId: string; countedAt: string } | null · zWaiting: WaitingZDto[]
// closeShift(input: CloseShiftInput) stays for local_only shifts only = finishCount + confirmCount(z) (central → BOT_CASH_REQUIRED)
// api/bot-cash.ts
export const botPreviewKey = (shiftId: string): string => `z.bot_cash.${shiftId}`
export function thaiMidnightUtc(ymd: string): string                                        // '2026-09-25' → '2026-09-24T17:00:00.000Z'
export async function botWindowFor(db: RemoteDb, shift: { id: string; deviceId: string; businessDate: string; countedAt: string }): Promise<{ after: string; until: string }>
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/test/count-z.test.ts`

```ts
import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { CashCountRowData, ShiftCloseRowData, type CentralOrder } from '@dayo/contracts'
import { posErrorCode } from '../src/api/errors'
import { pushOnce } from '../src/sync/push'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

const owner2 = { approverUserId: STAFF.DCm, approverPin: '2222' }
const settle = { varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: false }
const lines = (baht: number) => [{ denominationSatang: 100, count: baht }] // ฿1 coins — any whole amount
const bot = (no: string, total: number, at: string): CentralOrder => ({ order_no: no, sale_date: at.slice(0, 10), status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'line', payment: 'cash', totals: { items_subtotal: total, items_discount: 0, bill_discount: 0, total }, amount_mismatch: false, updated_at: at, sold_at: at })

async function centralShift(botTotal = 70) {
  const t = await openConnectedApi({ block3: true })                  // 10:00 Bangkok, float ฿500
  const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
  await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 }) // ฿45 cash
  t.mock.seedCentralOrders([bot('L260925-901', botTotal, '2026-09-25T04:00:00+00:00')])
  t.clock.advanceMs(2 * 3_600_000)                                    // 12:00 Bangkok
  return { t, ctx }
}

describe('count and Z (D101 · spec 04 §6.8 · §4.10)', () => {
  it('"นับเสร็จ" freezes the shift: no sale, no cash movement, no second press (D101 step 1)', async () => {
    const { t } = await centralShift()
    const { countedAt } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect(countedAt).toBe(t.clock.now())
    for (const f of [() => sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' }), () => t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_IN', amountSatang: 100, reason: 'x' }), () => t.api.finishCount({ actorUserId: STAFF.TungAo })]) {
      try { await f(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('NO_OPEN_SHIFT') }
    }
    try { await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 0 }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('COUNT_PENDING') } // R2
  })
  it('online: E4 bot cash is in the expected cash; count and Z are written together (D101 step 2)', async () => {
    const { t, ctx } = await centralShift()
    const { shiftId, countedAt } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect(await t.api.fetchBotCash(shiftId)).toMatchObject({ after: '2026-09-24T17:00:00.000Z', until: countedAt, cashTotalSatang: 7_000 })
    const sum = await t.api.countSummary(shiftId)
    expect(sum).toMatchObject({ includesBotCash: true, expectedCashSatang: 61_500, cash: { botCashSatang: 7_000 } })
    const r = await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(615), shownFingerprint: sum.fingerprint, z: settle })
    expect(r.z?.snapshot).toMatchObject({ zNo: 1, countedAt, cashVarianceSatang: 0, botWindow: { until: countedAt }, closedBy: STAFF.DCm, countedBy: STAFF.TungAo })
    const rows = await t.db.select().from(s.outbox).where(inArray(s.outbox.tableName, ['cash_count', 'shift_close'])).all()
    expect(rows.map((x) => [x.tableName, x.parentKey])).toEqual([['cash_count', `shift_open:${shiftId}`], ['shift_close', `cash_count:${r.countId}`]])
    expect(CashCountRowData.parse(rows[0]!.rowJson)).toMatchObject({ counted: 615, counted_at: countedAt, counted_by: STAFF.TungAo })
    const close = ShiftCloseRowData.parse(rows[1]!.rowJson)
    expect(close.z_report).toMatchObject({ z_no: 1, prev_hash: null, hash: r.z!.hash, variance_alert: 20, counted: 615, cash: { opening_float: 500, pos_cash_sales: 45, bot_cash: 70, drawer_expenses: 0 }, bot_bills: [{ order_no: 'L260925-901', version: 1, total: 70 }] })
    expect(close.z_report.pos_bills).toHaveLength(1)
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, shiftId)).get())?.status).toBe('closed')
    await pushOnce(ctx)
    expect(await t.db.select().from(s.outbox).where(inArray(s.outbox.status, ['pending', 'dead'])).all()).toEqual([])
  })
  it('offline: the count is saved without bot cash, the next shift opens, the Z comes when online (D101 step 3 · D68)', async () => {
    const { t, ctx } = await centralShift()
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    t.mock.setMode('offline')                                            // a real network failure (mock.fetch rejects)
    try { await t.api.fetchBotCash(shiftId); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('OFFLINE') }
    const sum = await t.api.countSummary(shiftId)
    expect(sum).toMatchObject({ includesBotCash: false, expectedCashSatang: 54_500 })
    await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(615), shownFingerprint: sum.fingerprint, z: null }) // no reason asked yet
    expect((await t.db.select().from(s.cashCount).get())).toMatchObject({ includesBotCash: false, expectedSatang: 54_500, varianceSatang: 7_000, reason: null })
    expect((await t.api.bootstrap()).zWaiting).toEqual([expect.objectContaining({ shiftId, syncMode: 'central' })])
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    t.mock.setMode('normal')
    await t.api.fetchBotCash(shiftId)
    const s2 = await t.api.countSummary(shiftId)
    const z = await t.api.issueZ({ shiftId, ...owner2, shownFingerprint: s2.fingerprint, ...settle })
    expect(z.snapshot).toMatchObject({ cash: { botCashSatang: 7_000 }, cashVarianceSatang: 0 })
    expect((await t.api.bootstrap()).zWaiting).toEqual([])
    await pushOnce(ctx); await pushOnce(ctx)
    expect(await t.db.select().from(s.outbox).where(inArray(s.outbox.status, ['pending', 'dead'])).all()).toEqual([]) // both shifts' rows accepted, no CONFLICT (§9)
  })
  it('short exactly ฿20.00 needs a reason; ฿19.99 does not (D102)', async () => {
    for (const [botTotal, want] of [[70, 'VARIANCE_REASON_REQUIRED'], [69.99, null]] as const) {
      const { t } = await centralShift(botTotal)
      const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
      await t.api.fetchBotCash(shiftId)
      const sum = await t.api.countSummary(shiftId)
      const call = t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(595), shownFingerprint: sum.fingerprint, z: settle })
      if (want === null) await call
      else { try { await call; expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe(want) } ; expect(await t.db.select().from(s.cashCount).all()).toEqual([]) } // nothing written
    }
  })
  it('E4 fetched, then the app reloads in "counting" and the network drops: confirm uses the stored bot cash — no SHIFT_CHANGED, no offline label (review item 1)', async () => {
    const { t } = await centralShift()
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.fetchBotCash(shiftId)
    t.mock.setMode('offline')
    expect((await t.api.bootstrap()).countingShift).toMatchObject({ shiftId })   // what a reload sees → the screen goes back to the review step
    const sum = await t.api.countSummary(shiftId)
    expect(sum).toMatchObject({ includesBotCash: true, expectedCashSatang: 61_500 }) // the screen shows the online path: bot line, no "ยังไม่รวมบิลเงินสดจากบอท"
    const r = await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(615), shownFingerprint: sum.fingerprint, z: settle })
    expect(r.z?.snapshot).toMatchObject({ cash: { botCashSatang: 7_000 }, cashVarianceSatang: 0 })
    expect(await t.db.select().from(s.cashCount).get()).toMatchObject({ includesBotCash: true })
  })
  it('fetchBotCash maps failures: network = OFFLINE · 401 = DAYO_BAD_KEY · 5xx = DAYO_UNREACHABLE · > 500 bot bills = Z_TOO_LARGE (review item 9)', async () => {
    for (const [mode, code] of [['offline', 'OFFLINE'], ['unauthorized', 'DAYO_BAD_KEY'], ['server_down', 'DAYO_UNREACHABLE']] as const) {
      const { t } = await centralShift()
      const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
      t.mock.setMode(mode)
      try { await t.api.fetchBotCash(shiftId); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe(code) }
    }
    const { t } = await centralShift()
    t.mock.seedCentralOrders(Array.from({ length: 501 }, (_, i) => bot(`L260925-${String(100 + i)}`, 1, '2026-09-25T04:00:00+00:00')))
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    try { await t.api.fetchBotCash(shiftId); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('Z_TOO_LARGE') }
  })
  it('a non-default threshold (฿50) is the one frozen in the Z and sent as z_report.variance_alert (D102 · review item 13)', async () => {
    const { t } = await centralShift()
    await t.db.insert(s.setting).values({ key: 'cash.variance_alert_satang', valueJson: 5_000, effectiveFrom: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', version: 1 })
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.fetchBotCash(shiftId)
    const sum = await t.api.countSummary(shiftId)
    expect(sum.varianceAlertSatang).toBe(5_000)
    const r = await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(585), shownFingerprint: sum.fingerprint, z: settle }) // short ฿30 < ฿50: no reason
    expect(r.z?.snapshot).toMatchObject({ varianceAlertSatang: 5_000, cashVarianceSatang: -3_000 })
    const close = ShiftCloseRowData.parse((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'shift_close')).get())!.rowJson)
    expect(close.z_report.variance_alert).toBe(50)
  })
  it('the Z of a central shift needs the bot cash first (BOT_CASH_REQUIRED)', async () => {
    const { t } = await centralShift()
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    const sum = await t.api.countSummary(shiftId)
    try { await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(615), shownFingerprint: sum.fingerprint, z: settle }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BOT_CASH_REQUIRED') }
  })
  it('a bot bill that appears after the screen was shown → SHIFT_CHANGED (ruling R8)', async () => {
    const { t } = await centralShift()
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    await t.api.fetchBotCash(shiftId)
    const shown = await t.api.countSummary(shiftId)
    t.mock.seedCentralOrders([bot('L260925-902', 35, '2026-09-25T04:30:00+00:00')])
    await t.api.fetchBotCash(shiftId)
    try { await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(650), shownFingerprint: shown.fingerprint, z: settle }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('SHIFT_CHANGED') }
  })
  it('Zs are issued in count order (ruling R7); the second Z chains to the first (R-m2 · E4 after = previous count)', async () => {
    const { t } = await centralShift()
    const a = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    let sum = await t.api.countSummary(a.shiftId)
    await t.api.confirmCount({ shiftId: a.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(545), shownFingerprint: sum.fingerprint, z: null })
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    t.clock.advanceMs(3_600_000)
    const b = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    sum = await t.api.countSummary(b.shiftId)
    await t.api.confirmCount({ shiftId: b.shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: sum.fingerprint, z: null })
    await t.api.fetchBotCash(b.shiftId)
    const sb = await t.api.countSummary(b.shiftId)
    try { await t.api.issueZ({ shiftId: b.shiftId, ...owner2, shownFingerprint: sb.fingerprint, ...settle }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('Z_NOT_READY') }
    await t.api.fetchBotCash(a.shiftId)
    const za = await t.api.issueZ({ shiftId: a.shiftId, ...owner2, shownFingerprint: (await t.api.countSummary(a.shiftId)).fingerprint, ...settle, varianceReason: 'บิลบอทรวมแล้ว' })
    expect(await t.api.fetchBotCash(b.shiftId)).toMatchObject({ after: a.countedAt, until: b.countedAt })
    const zb = await t.api.issueZ({ shiftId: b.shiftId, ...owner2, shownFingerprint: (await t.api.countSummary(b.shiftId)).fingerprint, ...settle })
    const close = ShiftCloseRowData.parse((await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `shift_close:${b.shiftId}`)).get())!.rowJson)
    expect(close.z_report).toMatchObject({ z_no: 2, prev_hash: za.hash, bot_window: { after: a.countedAt } })
    expect(zb.snapshot?.zNo).toBe(2)
  })
  it('a local-only shift: no E4, the Z right after the count, every row local_only (ruling R6)', async () => {
    const t = await openConnectedApi({ block3: false })
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    const sum = await t.api.countSummary(shiftId)
    const r = await t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: lines(500), shownFingerprint: sum.fingerprint, z: settle })
    expect(r.z?.snapshot).toMatchObject({ botWindow: null, botBills: [] })
    expect((await t.db.select().from(s.outbox).where(inArray(s.outbox.tableName, ['cash_count', 'z_report', 'shift_close'])).all()).map((x) => [x.tableName, x.status])).toEqual([['cash_count', 'local_only'], ['z_report', 'local_only']])
  })
})
```

`apps/pos/test/helpers/shift.ts` เพิ่ม:

```ts
/** Test shortcut for a whole close: finishCount → (E4 when central and online) → confirmCount with the Z. */
export async function countAndClose(t: ReadyApi, countLines: CashCountLine[], opts: { approverUserId: string; approverPin: string; varianceReason?: string | null; acknowledgeZChainBroken?: boolean }): Promise<ConfirmCountResult> {
  const { shiftId } = await t.api.finishCount({ actorUserId: t.owner.id })
  if ((await t.api.countSummary(shiftId)).syncMode === 'central') await t.api.fetchBotCash(shiftId)
  const sum = await t.api.countSummary(shiftId)
  return t.api.confirmCount({ shiftId, actorUserId: t.owner.id, approverUserId: opts.approverUserId, approverPin: opts.approverPin, countLines, shownFingerprint: sum.fingerprint, z: { varianceReason: opts.varianceReason ?? null, bankQrTotalSatang: null, acknowledgeZChainBroken: opts.acknowledgeZChainBroken ?? false } })
}
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos exec vitest run test/count-z.test.ts` · คาด FAIL
- [ ] **Step 3: ทำ** — `apps/pos/src/api/bot-cash.ts`:

```ts
import { and, desc, eq, isNotNull, lt } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { edgeBahtToSatang, MAX_Z_BOT_BILLS, type ZBotBill } from '@dayo/domain'
import { readDayoConfig, recordDayoFailure, type SyncContext } from '../sync/catalog'
import { createDayoClient, DayoError, type DayoFailure } from '../sync/dayo-client'
import { readKey, writeKey } from '../sync/state'
import { PosError } from './errors'
import type { BotCashDto } from './types'

export const botPreviewKey = (shiftId: string): string => `z.bot_cash.${shiftId}`
/** 00:00 Bangkok of a business date, as the UTC instant the tablet sends. */
export const thaiMidnightUtc = (ymd: string): string => new Date(Date.parse(`${ymd}T00:00:00.000+07:00`)).toISOString()

/** spec §4.10 E4: after = counted_at of this device's previous count (local-only shifts included), else 00:00 of the business date. */
export async function botWindowFor(db: RemoteDb, shift: { id: string; deviceId: string; businessDate: string; countedAt: string }): Promise<{ after: string; until: string }> {
  const prev = await db.select({ c: s.shift.countedAt }).from(s.shift)
    .where(and(eq(s.shift.deviceId, shift.deviceId), isNotNull(s.shift.countedAt), lt(s.shift.countedAt, shift.countedAt)))
    .orderBy(desc(s.shift.countedAt)).limit(1).get()
  return { after: prev?.c ?? thaiMidnightUtc(shift.businessDate), until: shift.countedAt }
}

/** Review item 9: only a network failure is OFFLINE (the screen then offers the offline count); everything else says what it is. */
export function botCashError(f: DayoFailure): PosError {
  switch (f.kind) {
    case 'network': return new PosError('OFFLINE', 'network')
    case 'unauthorized': return new PosError('DAYO_BAD_KEY', 'E4 401')
    case 'forbidden': return new PosError('DAYO_KEY_NO_SCOPE', 'E4 403 (orders:read)')
    case 'api_disabled': return new PosError('DAYO_API_DISABLED', 'E4 404')
    case 'bad_envelope': return f.message.includes('too_large') ? new PosError('Z_TOO_LARGE', 'E4 422 too_large') : new PosError('DAYO_BAD_RESPONSE', 'E4 422')
    case 'rate_limited': case 'server': return new PosError('DAYO_UNREACHABLE', f.kind)
    case 'bad_response': case 'bad_base_url': return new PosError('DAYO_BAD_RESPONSE', f.kind)
  }
}

/** Network outside the serial queue (block 2 L-R3). */
export async function fetchBotCash(ctx: SyncContext, shiftId: string): Promise<BotCashDto> {
  const { cfg, window } = await ctx.serial(async () => {
    const shift = await ctx.db.select().from(s.shift).where(eq(s.shift.id, shiftId)).get()
    if (shift === undefined || shift.countedAt === null || (shift.status !== 'counting' && shift.status !== 'counted')) throw new PosError('SHIFT_NOT_COUNTING', shiftId)
    if (shift.syncMode !== 'central') throw new PosError('BAD_INPUT', 'a local-only shift has no bot cash (ruling R6)')
    const c = await readDayoConfig(ctx.db, ctx.deps)
    if (c === null) throw new PosError('OFFLINE', 'not linked')
    return { cfg: c, window: await botWindowFor(ctx.db, { id: shift.id, deviceId: shift.deviceId, businessDate: shift.businessDate, countedAt: shift.countedAt }) }
  })
  let data
  try {
    data = (await createDayoClient({ ...cfg, fetch: ctx.deps.fetch, nowMs: () => Date.parse(ctx.deps.now()) }).shiftCash(window)).value
  } catch (e) {
    if (!(e instanceof DayoError)) throw e
    await ctx.serial(() => recordDayoFailure(ctx.db, ctx.deps, e.failure)) // 401/403/404/bad_base_url stop sync like any E1/E2 call (§6.3); the rest record nothing
    throw botCashError(e.failure)
  }
  if (data.bills.length > MAX_Z_BOT_BILLS) throw new PosError('Z_TOO_LARGE', `bot_bills ${data.bills.length}`)
  const bills: ZBotBill[] = data.bills.map((b) => ({ orderNo: b.order_no, version: b.version, source: b.source, soldAt: b.sold_at, totalSatang: edgeBahtToSatang(b.total), createdByName: b.created_by_name }))
  const cashTotalSatang = edgeBahtToSatang(data.cash_total)
  if (bills.reduce((a, b) => a + b.totalSatang, 0) !== cashTotalSatang) throw new PosError('DAYO_BAD_RESPONSE', 'E4 cash_total ≠ Σ bills')
  const dto: BotCashDto = { shiftId, after: window.after, until: window.until, bills, cashTotalSatang, fetchedAt: ctx.deps.now() }
  await ctx.serial(() => writeKey(ctx.db, botPreviewKey(shiftId), JSON.stringify(dto)))
  return dto
}

export async function readBotPreview(db: RemoteDb, shiftId: string): Promise<BotCashDto | null> {
  const raw = await readKey(db, botPreviewKey(shiftId))
  if (raw === null) return null
  const v = JSON.parse(raw) as BotCashDto
  return v.shiftId === shiftId ? v : null
}
```

`buildShiftReport` (แก้ใน `shift-report.ts`): พารามิเตอร์ท้าย `bot: BotCashDto | null = null` · `cash = bot === null ? base : withBotCash(base, bot.cashTotalSatang)` · `shiftReportFingerprint` เพิ่ม `botBills: bot?.bills ?? null, botWindow: bot === null ? null : { after: bot.after, until: bot.until }` (X report ของกะเปิดได้ `null` — ลายนิ้วมือของกะ `local_only` เท่าเดิมทุกไบต์ ยกเว้นคีย์ใหม่สองคีย์ที่เป็น `null`)

`apps/pos/src/api/count.ts` (โค้ดเต็ม):

```ts
import { asc, and, eq, lt, max } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { buildCashCountRowData, cashVarianceSatang, tallyCashCount } from '@dayo/domain'
import { enqueueLocalOnly, enqueuePush, shiftParentKey } from '../db/outbox'
import { requireOwnerPin } from './auth'
import { readBotPreview } from './bot-cash'
import { currentOpenShift, requireDevice } from './bootstrap'
import { writeZ } from './close'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { buildShiftReport } from './shift-report'
import { requireActiveUser } from './shift'
import { REASON_MAX_LENGTH, type ConfirmCountInput, type ConfirmCountResult, type CountSummaryDto, type IssueZInput, type ShiftDto, type ZReportDto, type ZSettle } from './types'

type ShiftRow = typeof s.shift.$inferSelect
const toDto = (r: ShiftRow): ShiftDto => ({ id: r.id, businessDate: r.businessDate, openedAt: r.openedAt, openedBy: r.openedBy, openingFloatSatang: r.openingFloatSatang, syncMode: r.syncMode })
async function shiftById(db: RemoteDb, id: string): Promise<ShiftRow> {
  const r = await db.select().from(s.shift).where(eq(s.shift.id, id)).get()
  if (r === undefined) throw new PosError('SHIFT_NOT_COUNTING', id)
  return r
}
function tallied(lines: ConfirmCountInput['countLines']): ReturnType<typeof tallyCashCount> {
  try { return tallyCashCount(lines) } catch (e) { throw new PosError('BAD_INPUT', e instanceof Error ? e.message : String(e)) }
}
function checkedSettle(z: ZSettle): ZSettle {
  const reason = z.varianceReason?.trim() ?? ''
  if (reason.length > REASON_MAX_LENGTH) throw new PosError('BAD_INPUT', `a reason is at most ${REASON_MAX_LENGTH} characters`)
  if (z.bankQrTotalSatang !== null && (!Number.isSafeInteger(z.bankQrTotalSatang) || z.bankQrTotalSatang < 0)) throw new PosError('BAD_INPUT', 'bankQrTotalSatang must be whole satang >= 0 or null')
  return { varianceReason: reason === '' ? null : reason, bankQrTotalSatang: z.bankQrTotalSatang, acknowledgeZChainBroken: z.acknowledgeZChainBroken }
}

/** Review item 1: the ONE rule the screen and both writes use — a central shift takes the stored E4 preview when there is one. */
async function summarize(db: RemoteDb, shift: ShiftRow): Promise<CountSummaryDto> {
  if (shift.countedAt === null || (shift.status !== 'counting' && shift.status !== 'counted')) throw new PosError('SHIFT_NOT_COUNTING', shift.id)
  const bot = shift.syncMode === 'central' ? await readBotPreview(db, shift.id) : null
  const report = await buildShiftReport(db, toDto(shift), shift.countedAt, bot)
  return { ...report, countedAt: shift.countedAt, syncMode: shift.syncMode, includesBotCash: bot !== null, bot }
}

/** D101 step 1 · R3: "นับเสร็จ" — the open shift stops taking bills and cash movements (status 'counting', counted_at once). */
export async function finishCount(db: RemoteDb, deps: ApiDeps, input: { actorUserId: string }): Promise<{ shiftId: string; countedAt: string }> {
  const actor = await requireActiveUser(db, input.actorUserId)
  const device = await requireDevice(db)
  const r = await db.transaction(async (tx) => {
    const shift = await currentOpenShift(tx, device.id)
    if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'no open shift to count')
    const lastSold = (await tx.select({ v: max(s.order.soldAt) }).from(s.order).where(eq(s.order.shiftId, shift.id)).get())?.v ?? null
    const lastMove = (await tx.select({ v: max(s.cashMovement.createdAt) }).from(s.cashMovement).where(eq(s.cashMovement.shiftId, shift.id)).get())?.v ?? null
    const at = deps.now()
    const countedAt = [shift.openedAt, lastSold, lastMove].reduce<string>((a, b) => (b !== null && Date.parse(b) > Date.parse(a) ? b : a), at)
    await tx.update(s.shift).set({ status: 'counting', countedAt }).where(eq(s.shift.id, shift.id))
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'shift', entityId: shift.id, action: 'count_finished', beforeJson: null, afterJson: { countedAt }, actorUserId: actor.id, at })
    return { shiftId: shift.id, countedAt }
  })
  deps.afterWrite?.()
  return r
}

export async function countSummary(db: RemoteDb, shiftId: string): Promise<CountSummaryDto> {
  return summarize(db, await shiftById(db, shiftId))
}

/** D101 steps 2–3: the owner confirms the count; with `z` the Z is written in the same transaction (a refused Z rolls the count back). */
export async function confirmCount(db: RemoteDb, deps: ApiDeps, i: ConfirmCountInput): Promise<ConfirmCountResult> {
  const tally = tallied(i.countLines)
  const actor = await requireActiveUser(db, i.actorUserId)
  const settle = i.z === null ? null : checkedSettle(i.z)
  const approver = await requireOwnerPin(db, deps, i.approverUserId, i.approverPin) // argon2 is slow — outside the transaction
  const r = await db.transaction(async (tx) => {
    const shift = await shiftById(tx, i.shiftId)
    if (shift.status !== 'counting') throw new PosError('SHIFT_NOT_COUNTING', shift.id)
    const sum = await summarize(tx, shift)
    if (sum.fingerprint !== i.shownFingerprint) throw new PosError('SHIFT_CHANGED', `shown ${i.shownFingerprint.slice(0, 8)}, now ${sum.fingerprint.slice(0, 8)}`)
    if (settle !== null && shift.syncMode === 'central' && sum.bot === null) throw new PosError('BOT_CASH_REQUIRED', shift.id)
    const at = deps.now()
    const countRow = {
      id: deps.newId(), shiftId: shift.id, countedSatang: tally.totalSatang, expectedSatang: sum.expectedCashSatang,
      varianceSatang: cashVarianceSatang(tally.totalSatang, sum.expectedCashSatang), reason: settle?.varianceReason ?? null, linesJson: tally.lines,
      countedBy: actor.id, createdAt: at, countedAt: sum.countedAt, includesBotCash: sum.includesBotCash,
    } satisfies typeof s.cashCount.$inferInsert
    await tx.insert(s.cashCount).values(countRow)
    if (shift.syncMode === 'central') {
      const data = buildCashCountRowData({ countId: countRow.id, shiftId: shift.id, lines: tally.lines, countedBy: actor.id, countedAt: sum.countedAt })
      await enqueuePush(tx, { kind: 'cash_count', id: countRow.id, data, parentKey: shiftParentKey(shift.id) }, at, deps.newId)
    } else {
      await enqueueLocalOnly(tx, 'cash_count', countRow, at, deps.newId)
    }
    await tx.insert(s.auditLog).values({ id: deps.newId(), entity: 'shift', entityId: shift.id, action: 'count_confirmed', beforeJson: null, afterJson: { countId: countRow.id, approvedBy: approver.id, includesBotCash: sum.includesBotCash }, actorUserId: actor.id, at })
    await tx.update(s.shift).set({ status: 'counted' }).where(eq(s.shift.id, shift.id))
    const z = settle === null ? null : await writeZ(tx, deps, { shift: { ...shift, status: 'counted' }, count: countRow, approver, summary: sum, settle })
    return { countId: countRow.id, z }
  })
  deps.afterWrite?.()
  return r
}

/** D101 step 3: the Z of a counted shift, once online (owner PIN again). Zs go out in count order (R7). */
export async function issueZ(db: RemoteDb, deps: ApiDeps, i: IssueZInput): Promise<ZReportDto> {
  const settle = checkedSettle(i)
  const approver = await requireOwnerPin(db, deps, i.approverUserId, i.approverPin)
  const device = await requireDevice(db)
  const z = await db.transaction(async (tx) => {
    const shift = await shiftById(tx, i.shiftId)
    const count = await tx.select().from(s.cashCount).where(eq(s.cashCount.shiftId, shift.id)).get()
    if (shift.status !== 'counted' || count === undefined || shift.countedAt === null) throw new PosError('Z_NOT_READY', shift.id)
    const earlier = await tx.select({ id: s.shift.id }).from(s.shift)
      .where(and(eq(s.shift.deviceId, device.id), eq(s.shift.status, 'counted'), lt(s.shift.countedAt, shift.countedAt)))
      .orderBy(asc(s.shift.countedAt)).limit(1).get()
    if (earlier !== undefined) throw new PosError('Z_NOT_READY', earlier.id)
    const sum = await summarize(tx, shift)
    if (sum.fingerprint !== i.shownFingerprint) throw new PosError('SHIFT_CHANGED', `shown ${i.shownFingerprint.slice(0, 8)}, now ${sum.fingerprint.slice(0, 8)}`)
    if (shift.syncMode === 'central' && sum.bot === null) throw new PosError('BOT_CASH_REQUIRED', shift.id)
    return writeZ(tx, deps, { shift, count, approver, summary: sum, settle })
  })
  deps.afterWrite?.()
  return z
}
```

(`ShiftDto` ได้ `syncMode` ใน Task 11 · `countSummary` ของ PosApi ไม่ต้องรับ `deps`)

`close.ts` — ย้ายเนื้อ `closeShift` ส่วนโซ่ (บรรทัด "Q3b-16 · D54 …" ถึงการ insert audit) มาเป็น:

```ts
/** The Z of a counted shift (D101): chain logic of D53–D55 unchanged; central shifts also queue shift_close (spec §4.10).
 * Uses the caller's summary — the same one the screen showed (review item 1) — never builds its own. */
export async function writeZ(tx: RemoteDb, deps: ApiDeps, a: { shift: typeof s.shift.$inferSelect; count: typeof s.cashCount.$inferSelect; approver: UserDto; summary: CountSummaryDto; settle: ZSettle }): Promise<ZReportDto>
```

ภายใน: `variance = cashVarianceSatang(count.countedSatang, summary.expectedCashSatang)` (domain — review item 8) · `varianceNeedsReason(variance, summary.varianceAlertSatang)` + เหตุผลว่าง → `VARIANCE_REASON_REQUIRED` · ตรรกะ `prev`/`chainWarning` เดิมทุกบรรทัด · `buildZReport({ …เดิม (sales/cash/voids/alert จาก summary), countedAt: summary.countedAt, countedBy: count.countedBy, countLines: count.linesJson, countedCashSatang: count.countedSatang, botWindow: summary.bot === null ? null : { after: summary.bot.after, until: summary.bot.until }, botBills: summary.bot?.bills ?? [] }, prev)` · insert `z_report` · **`prevHash` = คอลัมน์ `hash` ของแถว Z ล่าสุดของเครื่อง (`rows[0]?.hash ?? null`)** (R-m2 — Task 13 เพิ่มกรณีต่อจากระบบกลาง) · `central`: `posBills` = บิลของกะ (`receipt_no` ไม่ว่าง · สถานะ `paid|voided`) → `{ posOrderId: o.id, receiptNo: o.receiptNo, paymentCode: o.paymentCode ?? PAYMENT_CODE[payment.method], totalSatang: o.totalSatang, soldAt: o.soldAt ?? o.paidAt!, voidedAt: o.voidedAt }` · `movementIds` = id เงินเข้า-ออกของกะ · `enqueuePush({ kind: 'shift_close', id: shift.id, data: buildShiftCloseRowData({ snapshot, hash, prevHash, countId: count.id, posBills, movementIds }), parentKey: countParentKey(count.id) })` (`ZTooLargeError` → `Z_TOO_LARGE`) · `local_only`: `enqueueLocalOnly('z_report', zRow)` + `enqueueLocalOnly('shift', …, 'closed')` แบบเดิม · `update shift set status='closed', closed_by, closed_at` · `deleteKey(botPreviewKey(shift.id))`

`closeShift(db, deps, input)` **ย้ายไปอยู่ `count.ts`** (ถ้าอยู่ `close.ts` จะ import วนกับ `count.ts` · `pos-api.ts` import จากที่ใหม่) คงชื่อและชนิดเดิม = `finishCount` → `countSummary` (ถ้ากะ `central` → `BOT_CASH_REQUIRED`) → `confirmCount({ …, shownFingerprint: input.shownReportFingerprint, z: { … } })` · **ตัวเขียนค่าตั้ง `cash.variance_alert_satang`**: ไม่มีในแท็บเล็ตวันนี้ (R4) — ไม่มีงานใน task นี้ — เทสต์ปิดกะเดิมของแผน 3b/ก้อน 2 (กะ `local_only`) ต้องผ่านโดยไม่แก้ความคาดหวังตัวเลข · `bootstrap.ts`: `countingShift` (กะ `counting` ของเครื่อง) · `zWaiting` (กะ `counted` ไม่มี Z เรียง `counted_at`) · `pos-api.ts`: ฟังก์ชันใหม่ห้าตัว · `fetchBotCash` อยู่นอก serial แบบ `syncNow` · หลัง `finishCount`/`confirmCount`/`issueZ` ปลุกตัวส่ง `kick('write')`

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test` (รวม close-shift/shift-report/backup/z เดิม)
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 6: commit** — stage ไฟล์ตาม Files · ข้อความ: `feat(pos): count the drawer offline or online and issue the Z with bot cash`

### Task 13: เลข Z และโซ่ต่อจากระบบกลางเมื่อตั้งเครื่องใหม่ (R4-1 · ทาง D55)

ผู้ทำ: sync-engineer (opus) · ผู้ตรวจเพิ่ม: **security-reviewer** (กุญแจเครื่อง · ตั้งเครื่อง) · สเปก §4.4 ข้อ 6 · §6.6 (เลขใบปิดกะ) · §9 ก้อน 3 (R4-1) · §13.8 **R5-1** (`last_z_until`) · D55 · D88 · ruling R9 · รอ: Task 12, **Task 8** (เทสต์ต้องใช้ `recomputeStatus` จริงของ mock) · หลัง Task 10 merge สาย C ได้ `apps/pos/src/sync/state.ts`

**Files:**
- Modify: `apps/pos/src/api/{connect,close,bot-cash,bootstrap,types}.ts`, `apps/pos/src/sync/state.ts`, `apps/pos/test/helpers/dayo.ts`
- Create: `apps/pos/test/z-central-continuity.test.ts`

**Interfaces:**
- Consumes: `ClientInfo.last_z_no/last_z_hash/last_z_until` (Task 5) · `mock.preloadZ` (Task 6) · `writeZ`, `botWindowFor` (Task 12) · `ZChainWarning.centralLastZ` (Task 2)
- Produces (Task 16, 17 ใช้):

```ts
// sync/state.ts DAYO_KEYS gains lastZNo: 'dayo.last_z_no' · lastZHash: 'dayo.last_z_hash' · lastZUntil: 'dayo.last_z_until'
// api/connect.ts
export type CentralZ = { lastZNo: number; lastZHash: string; lastZUntil: string } // lastZUntil stored as the tablet's own ISO form (toISOString)
export function centralZOf(c: { last_z_no?: number | null; last_z_hash?: string | null; last_z_until?: string | null }): CentralZ | null // all three null → null · anything partial/odd → DAYO_Z_STATE_INVALID
// DayoProbe gains lastZNo: number | null · BootstrapState gains centralLastZNo: number | null (DAYO_KEYS.lastZNo — the close screen names it on Z_CHAIN_BROKEN 'central')
// ConnectShopInput gains confirmedLastZNo: number | null — must equal what E1 says now (the owner saw and ticked it), else BAD_INPUT
// connectShop / replaceApiKey / recoverOwner store (or clear) the three DAYO_KEYS in their transaction — never the periodic E1 (R9)
// api/close.ts
export async function centralContinuation(db: RemoteDb, deviceId: string): Promise<CentralZ | null> // the stored central Z when it is above this device's last Z (the R9 path), else null
// writeZ: centralContinuation ≠ null → Z_CHAIN_BROKEN detail 'central' until acknowledged;
//   then zNo = lastZNo + 1 · prev_hash = lastZHash · chainWarning { brokenShiftId: 'central', centralLastZ, zNoGap, … }
// api/bot-cash.ts botWindowFor: on the R9 path, after = lastZUntil (spec §13.8 R5-1) instead of the previous local count
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/test/z-central-continuity.test.ts`

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { ShiftCloseRowData } from '@dayo/contracts'
import { createMockDayo, MOCK_API_KEY } from '@dayo/dayo-mock'
import { posErrorCode } from '../src/api/errors'
import { pushOnce } from '../src/sync/push'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { openTestApi } from './helpers/db'

const H41 = 'ab'.repeat(32)
const owner2 = { approverUserId: STAFF.DCm, approverPin: '2222' }
type Api = Awaited<ReturnType<typeof openConnectedApi>>
/** "นับเสร็จ" + E4 once; the returned confirm() may be called again after a refusal (a refused Z rolls the count back — the shift stays 'counting'). */
async function countedCentral(t: Api) {
  const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
  await t.api.fetchBotCash(shiftId)
  const sum = await t.api.countSummary(shiftId)
  return (ack: boolean) => t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: [{ denominationSatang: 100, count: 500 }], shownFingerprint: sum.fingerprint, z: { varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: ack } })
}
const closeCentral = async (t: Api, ack: boolean) => (await countedCentral(t))(ack)

describe('Z numbering continues from dayo after a reinstall (spec 04 §6.6 · R4-1 · ruling R9)', () => {
  it('probe shows the last Z dayo holds; connecting needs the owner to confirm that number', async () => {
    const now = '2026-09-25T03:00:00.000Z'
    const mock = createMockDayo({ now, block3: true })
    mock.preloadZ({ zNo: 41, hash: H41, countedAt: '2026-09-24T12:00:00.000Z' })
    const t = await openTestApi({ fetch: mock.fetch, now })
    const target = { baseUrl: 'http://localhost:8787/api/v1', apiKey: MOCK_API_KEY }
    expect((await t.api.probeDayo(target)).lastZNo).toBe(41)
    const input = { ...target, receiptPrefix: 'A', ownerStaffId: STAFF.TungAo, ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null }
    try { await t.api.connectShop({ ...input, confirmedLastZNo: null }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
    await t.api.connectShop({ ...input, confirmedLastZNo: 41 })
  })
  it('the first Z after it asks the owner once (D55 path), is Z 42, chains to dayo\'s hash and window; dayo matches it (R5-1)', async () => {
    const t = await openConnectedApi({ block3: true, beforeConnect: (m) => m.preloadZ({ zNo: 41, hash: H41, countedAt: '2026-09-24T12:00:00.000Z' }) })
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    t.clock.advanceMs(3_600_000)
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect(await t.api.fetchBotCash(shiftId)).toMatchObject({ after: '2026-09-24T12:00:00.000Z' }) // last_z_until, not 00:00 of the business date
    const sum = await t.api.countSummary(shiftId)
    const confirm = (ack: boolean) => t.api.confirmCount({ shiftId, actorUserId: STAFF.TungAo, ...owner2, countLines: [{ denominationSatang: 100, count: 500 }], shownFingerprint: sum.fingerprint, z: { varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: ack } })
    try { await confirm(false); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('Z_CHAIN_BROKEN'); expect(String(e)).toContain('central') }
    const r = await confirm(true) // same shift, still 'counting': the refused Z rolled its count back
    expect(r.z?.snapshot).toMatchObject({ zNo: 42, chainWarning: { brokenShiftId: 'central', centralLastZ: { zNo: 41, hash: H41 }, zNoGap: 41 } })
    const close = ShiftCloseRowData.parse((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'shift_close')).get())!.rowJson)
    expect(close.z_report).toMatchObject({ z_no: 42, prev_hash: H41, chain_warning: true, bot_window: { after: '2026-09-24T12:00:00.000Z' } })
    await pushOnce(ctx); await pushOnce(ctx)
    expect(t.mock.zReports().find((z) => z.zNo === 42)).toMatchObject({ chainBreak: false, chainMismatch: [], recomputeStatus: 'matched' }) // rule 3 holds: after = until of Z 41
    expect(t.mock.conflicts()).toEqual([])
  })
  it('bot bills between Z 41 and this count are in this Z (nothing falls between the two Zs)', async () => {
    const t = await openConnectedApi({ block3: true, beforeConnect: (m) => m.preloadZ({ zNo: 41, hash: H41, countedAt: '2026-09-24T12:00:00.000Z' }) })
    t.mock.seedCentralOrders([{ order_no: 'L260924-950', sale_date: '2026-09-24', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'line', payment: 'cash', totals: { items_subtotal: 70, items_discount: 0, bill_discount: 0, total: 70 }, amount_mismatch: false, updated_at: '2026-09-24T13:00:00+00:00', sold_at: '2026-09-24T13:00:00+00:00' }])
    t.clock.advanceMs(3_600_000)
    const { shiftId } = await t.api.finishCount({ actorUserId: STAFF.TungAo })
    expect((await t.api.fetchBotCash(shiftId)).bills.map((b) => b.orderNo)).toEqual(['L260924-950']) // 20:00 Bangkok the day before — after Z 41, before 00:00
  })
  it('the next Z is normal: 43, no question, prev_hash = hash of 42', async () => {
    const t = await openConnectedApi({ block3: true, beforeConnect: (m) => m.preloadZ({ zNo: 41, hash: H41, countedAt: '2026-09-24T12:00:00.000Z' }) })
    t.clock.advanceMs(3_600_000)
    const z42 = await closeCentral(t, true)
    await t.api.openShift({ userId: STAFF.TungAo, openingFloatSatang: 50_000 })
    t.clock.advanceMs(3_600_000)
    const z43 = await closeCentral(t, false)
    expect(z43.z?.snapshot).toMatchObject({ zNo: 43, chainWarning: null })
    const rows = await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'shift_close')).all()
    expect(ShiftCloseRowData.parse(rows[1]!.rowJson).z_report.prev_hash).toBe(z42.z!.hash)
  })
  it.each([
    ['a missing hash', { last_z_no: 41, last_z_hash: null, last_z_until: '2026-09-24T12:00:00.000Z' }],
    ['a missing until', { last_z_no: 41, last_z_hash: H41, last_z_until: null }],
    ['an until that is not a time', { last_z_no: 41, last_z_hash: H41, last_z_until: 'yesterday' }],
  ])('%s stops the setup with DAYO_Z_STATE_INVALID', async (_, client) => {
    const now = '2026-09-25T03:00:00.000Z'
    const mock = createMockDayo({ now, block3: true })
    mock.bumpCatalog((c) => { Object.assign(c.client as Record<string, unknown>, client) })
    const t = await openTestApi({ fetch: mock.fetch, now })
    try { await t.api.probeDayo({ baseUrl: 'http://localhost:8787/api/v1', apiKey: MOCK_API_KEY }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('DAYO_Z_STATE_INVALID') }
  })
  it('a key with no Z yet clears stale values (a new key starts its own chain — §6.6)', async () => {
    const t = await openConnectedApi({ block3: true })
    const { readKey, DAYO_KEYS } = await import('../src/sync/state')
    expect(await readKey(t.db, DAYO_KEYS.lastZNo)).toBeNull()
  })
})
```

(เทสต์ "ข้อมูลไม่ครบ" อาศัยกติกาของ mock ที่ Task 6 ทำและทดสอบแล้ว: ไม่มี Z = ค่าที่ `bumpCatalog` ตั้งอยู่ต่อ · Task 13 **ไม่แก้ `packages/dayo-mock`**)

`apps/pos/test/helpers/dayo.ts`: เพิ่ม `beforeConnect?: (mock: MockDayo) => void` (เรียกก่อน `connectShop`) · การเชื่อมใช้ `const probe = await t.api.probeDayo(target)` แล้ว `confirmedLastZNo: probe.lastZNo`

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos exec vitest run test/z-central-continuity.test.ts` · คาด FAIL
- [ ] **Step 3: ทำ** — `connect.ts`:

```ts
/** spec §4.4 ข้อ 6 (R4-1 · R5-1): dayo's raw client.last_z_* — checked here, like last_receipt_no; odd values stop the setup, nothing is guessed. */
export type CentralZ = { lastZNo: number; lastZHash: string; lastZUntil: string }
export function centralZOf(c: { last_z_no?: number | null; last_z_hash?: string | null; last_z_until?: string | null }): CentralZ | null {
  const n = c.last_z_no ?? null
  const h = c.last_z_hash ?? null
  const u = c.last_z_until ?? null
  if (n === null && h === null && u === null) return null
  const ok = n !== null && h !== null && u !== null && Number.isSafeInteger(n) && n >= 1 && /^[0-9a-f]{64}$/.test(h) && IsoReceived.safeParse(u).success
  if (!ok) throw new PosError('DAYO_Z_STATE_INVALID', String(n))
  return { lastZNo: n, lastZHash: h, lastZUntil: new Date(Date.parse(u)).toISOString() } // the tablet sends times as …sssZ (§4.1)
}
const CENTRAL_Z_KEYS = [DAYO_KEYS.lastZNo, DAYO_KEYS.lastZHash, DAYO_KEYS.lastZUntil] as const
async function storeCentralZ(tx: RemoteDb, z: CentralZ | null): Promise<void> {
  if (z === null) { for (const k of CENTRAL_Z_KEYS) await deleteKey(tx, k); return }
  await writeKey(tx, DAYO_KEYS.lastZNo, String(z.lastZNo))
  await writeKey(tx, DAYO_KEYS.lastZHash, z.lastZHash)
  await writeKey(tx, DAYO_KEYS.lastZUntil, z.lastZUntil)
}
```

`close.ts`:

```ts
/** Ruling R9: the central last Z stored at setup/relink/recover, when it is above this device's own last Z. */
export async function centralContinuation(db: RemoteDb, deviceId: string): Promise<CentralZ | null> {
  const central = await readCentralZ(db)                                  // the three DAYO_KEYS, all or null
  if (central === null) return null
  const rows = await deviceZRows(db, deviceId)
  const last = rows[0] === undefined ? null : toZReportDto(rows[0])
  const lastZNo = last?.hashOk === true && last.snapshot !== null ? safeIntOrNull(last.snapshot.zNo) : null
  return central.lastZNo > (lastZNo ?? rows.length) ? central : null
}
```

`bot-cash.ts` `botWindowFor` (รับ `deviceId` อยู่แล้ว): ก่อนหา "การนับก่อนหน้าในเครื่อง" — `const c = await centralContinuation(db, shift.deviceId)` · ถ้า `c !== null` และไม่มีกะอื่นของเครื่องที่ `counted` แล้วยังไม่มี Z ก่อนกะนี้ (R7 ทำให้กะนี้เป็นใบแรกของเส้น R9) และ `Date.parse(c.lastZUntil) < Date.parse(shift.countedAt)` → `after = c.lastZUntil` · ไม่งั้นกติกาเดิม (นาฬิกาเพี้ยนจน `last_z_until` ≥ `counted_at` = ใช้กติกาเดิม แล้ว dayo แสดงเป็นข้อสังเกต/ไม่ตรง ไม่เดาค่าเอง)

`probeDayo` คืน `lastZNo: centralZOf(v.client)?.lastZNo ?? null` · `connectShop`: `const cz = centralZOf(v.client)` · `(cz?.lastZNo ?? null) !== input.confirmedLastZNo` → `PosError('BAD_INPUT', 'Z ล่าสุดในระบบกลางเปลี่ยนไปหลังทดสอบกุญแจ — ทดสอบกุญแจใหม่')` · ในธุรกรรม `storeCentralZ(tx, cz)` · `replaceApiKey`/`recoverOwner`: `storeCentralZ(tx, centralZOf(v.client))` ในธุรกรรมเดิม (ไม่ต้องยืนยัน) · `close.ts` `writeZ` ก่อนตรรกะโซ่เดิม:

```ts
const central = await centralContinuation(tx, a.shift.deviceId)          // same test botWindowFor used for this Z's window
if (central !== null) {
  if (!settle.acknowledgeZChainBroken) throw new PosError('Z_CHAIN_BROKEN', 'central')
  const lenient = recomputeZChainLenient(orderForLenientRecompute(rows).map(toLenientEntry))
  const grand = lastHealthy && lastGrand !== null ? lastGrand : lenient.grandTotalSatang   // ruling R9: dayo's grand total is not continued
  prev = { zNo: central.lastZNo, grandTotalSatang: grand }
  chainWarning = {
    brokenShiftId: 'central', storedGrandTotalSatang: lastHealthy ? lastGrand : null, recomputedGrandTotalSatang: grand, acknowledgedBy: approver.id,
    unreadableZs: lenient.unreadable, duplicateZNos: lenient.duplicateZNos, duplicateZNosTruncated: lenient.duplicateZNosTruncated,
    missingZNos: lenient.missingZNos, missingZNosTruncated: lenient.missingZNosTruncated, deletedShiftIds: [], deletedShiftIdsTruncated: false,
    zNoGap: central.lastZNo + 1 - (rows.length + 1), centralLastZ: { zNo: central.lastZNo, hash: central.lastZHash },
  }
  prevHash = central.lastZHash
} else { /* the D53–D55 chain logic of Task 12, unchanged */ }
```

(`audit_log` `z_chain_broken_ack` เดิมเขียนด้วย `afterJson` + `centralLastZNo`)

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test` (เทสต์ connect/replace/recover เดิมผ่าน — mock ไม่มี Z = `null`)
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 6: commit** — stage ไฟล์ตาม Files · ข้อความ: `feat(pos): continue Z numbers, the hash chain and the bot window from dayo after a reinstall`

### Task 14: ทางแก้ของ owner ก้อน 3 · บิลนอกแคตตาล็อก · รับทราบ `exists:` · สถานะระบบ

ผู้ทำ: sync-engineer (opus) · ผู้ตรวจเพิ่ม: **security-reviewer** (PIN owner · บิลนอกแคตตาล็อก · ข้อมูลที่ส่งออก) · สเปก §6.2 (`scope:`) · §6.4 ทั้งหมด (ตารางปุ่ม · ชนิดกะ · ทางตัน ก–ค) · §4.10 `order_off_catalog` · D91 · D97 · ruling R11, R12, R14, R16, R18, R19 · รอ: Task 8, 10, 13 · ก้อน 2 Task 15

**Files:**
- Modify: `apps/pos/src/api/{sync-problems,bootstrap,orders,types,pos-api}.ts`
- Create: `apps/pos/test/sync-problems-block3.test.ts`, `apps/pos/test/block3-flow.test.ts`

**Interfaces:**
- Consumes: ก้อน 2 T15 ทั้งหมด · `releaseChildren`, `SCOPE_*` (Task 10) · `buildOffCatalogRowData`, `OffCatalogError` (Task 3) · `enqueuePush` (Task 9) · `appendOrderEvents` · `requireOwnerPin` · `can` (Task 1) · `ExistsConflictData`, `detailPrefix`, `KIND_SCOPE`, `laneOf` (Task 5)
- Produces (Task 16, 17 ใช้):

```ts
export type Remedy = 'RETRY' | 'RENUMBER' | 'REMAP_CODE' | 'REMAP_STAFF' | 'EXCLUDE' | 'CLOSE_OFF_CATALOG' | 'ACKNOWLEDGE_ELSEWHERE' | 'RECONFIRM_OWNER'
export type SyncProblemDto = {
  outboxId: string; key: string; kind: PushKind; orderId: string | null; shiftId: string | null; receiptNo: string | null; at: string
  reason: string; detail: string; prefix: DetailPrefix | null; remedies: Remedy[]; children: SyncProblemDto[]
  waiting: 'clock' | 'scope' | null                        // pending rows shown as cards (N5 far-ahead · scope ≥ 7 days)
  hint: 'void_rejected' | 'shift_conflict' | null          // §6.4 (ค) · S5 (ruling R12)
  central: { orderNo: string; reportedTotalSatang: number; paymentIsCash: boolean; matchesLocal: boolean } | null // exists: data (R16)
  centralOrderNo: string | null                            // the bill's dayo order_no when it reached dayo (order.central_order_no) — the void_rejected hint names it
}
export function remediesFor(r: { kind: PushKind; pending: boolean; reason: string; prefix: DetailPrefix | null; farAhead: boolean; scopeSince: string | null; nowIso: string }): Remedy[]
closeOffCatalog(i: OwnerApproval & { outboxId: string }): Promise<{ offCatalogKey: string }>   // owner (can 'close_off_catalog') · PIN + reason
acknowledgeElsewhere(i: OwnerApproval & { outboxId: string }): Promise<{ orderNo: string; matchesLocal: boolean }>
reconfirmOwner(i: OwnerApproval & { outboxId: string }): Promise<void>                       // FORBIDDEN role: of shift_close / order_off_catalog
// remapCode: payment may only stay on the same side (cash ↔ cash, non-cash ↔ non-cash) — else REMEDY_NOT_ALLOWED (§4.10 การคิดซ้ำ ข้อ 7)
// remapStaff: also shift kinds — field by kind: shift_open.opened_by · cash_movement.created_by · cash_count.counted_by · shift_close.closed_by (must be an active owner)
// excludeFromSync: also shift-lane rows; children of every level → local_only; shift_open → shift.sync_mode 'local_only' (R19)
// SyncStatusDto gains scopeWait: { scope: string; since: string; red: boolean; closable: boolean } | null · shiftDataConflict: boolean · centralMismatchBills: number
// OrderSummaryDto/OrderDetailDto gain offCatalog: boolean · centralMismatch: CentralMismatch | null
```

ตารางปุ่ม (`remediesFor` — ล็อกตาม §6.4 + R11):

| แถว | เหตุผล/คำนำหน้า | ปุ่ม |
|---|---|---|
| ใดๆ `pending` | `farAhead` (N5) | `EXCLUDE` |
| ใดๆ `pending` | `scope:` และรอ ≥ 7 วัน | `EXCLUDE` (< 7 วัน = ไม่ขึ้นหน้านี้) |
| ใดๆ `dead` | `PARENT_REJECTED` | — |
| `order` | `CONFLICT` `exists:`/`off_catalog_exists:` | `ACKNOWLEDGE_ELSEWHERE` `EXCLUDE` |
| `order` | `CONFLICT` `key_changed:` | `EXCLUDE` |
| `order` | `CONFLICT` `receipt_taken:`/ไม่มีคำนำหน้า | `RETRY` `RENUMBER` `CLOSE_OFF_CATALOG` `EXCLUDE` |
| `order` | `UNKNOWN_CODE` / `UNKNOWN_STAFF` | `RETRY` `REMAP_CODE`/`REMAP_STAFF` `CLOSE_OFF_CATALOG` `EXCLUDE` |
| `order` | `STUCK` `ENVELOPE` (ของเครื่อง) | `RETRY` `EXCLUDE` |
| `order` | อื่นทั้งหมดที่ dayo ส่ง (`INVALID` `FORBIDDEN` `BAD_KEY` ค่าที่ไม่รู้จัก) | `RETRY` `CLOSE_OFF_CATALOG` `EXCLUDE` |
| `order_off_catalog` | `receipt_taken:`/ไม่มีคำนำหน้า · `exists:`/`off_catalog_exists:` · `key_changed:` · `UNKNOWN_CODE` · `UNKNOWN_STAFF` · `FORBIDDEN role:` · `FORBIDDEN rule:` · อื่น | `RETRY RENUMBER` · `ACKNOWLEDGE_ELSEWHERE` · `EXCLUDE` · `RETRY REMAP_CODE` · `RETRY REMAP_STAFF` · `RECONFIRM_OWNER` · `RETRY EXCLUDE` **(rule: เกินเพดาน — รอ Q72)** · `EXCLUDE` |
| `order_void` | `FORBIDDEN rule:` / `INVALID` | `EXCLUDE` + `hint: 'void_rejected'` |
| `order_void` | `UNKNOWN_STAFF` / อื่น | `RETRY REMAP_STAFF` / `RETRY EXCLUDE` |
| ชนิดกะ | `CONFLICT` `key_changed:`/`counted:`/`z_no_taken:` · `INVALID` `data_conflict:` (R5-2) | `EXCLUDE` + `hint: 'shift_conflict'` |
| ชนิดกะ | `UNKNOWN_STAFF` · `FORBIDDEN role:` (`shift_close`) · `FORBIDDEN role:` (`shift_open`) · อื่น | `RETRY REMAP_STAFF` · `RECONFIRM_OWNER` · `REMAP_STAFF` · `RETRY EXCLUDE` |

**ทุกแถว `order` ที่ `dead` (ยกเว้น `PARENT_REJECTED`) มี `EXCLUDE` ("ปิดไว้ในเครื่อง") เป็นปุ่มสุดท้ายเสมอ** (review item 2 — ถ้าปิดเป็นบิลนอกแคตตาล็อกไม่ได้ จะไม่ตัน)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/test/sync-problems-block3.test.ts`

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { OrderOffCatalogRowData } from '@dayo/contracts'
import { posErrorCode } from '../src/api/errors'
import { remediesFor } from '../src/api/sync-problems'
import { pullCatalog } from '../src/sync/catalog'
import { pushOnce, SCOPE_CLOSABLE_AFTER_MS } from '../src/sync/push'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'

const owner = { approverUserId: STAFF.TungAo, approverPin: '1111', reason: 'แก้ตามหน้าส่งไม่ผ่าน' }
async function rejected(reason: string, detail: string, data?: unknown, pay: 'CASH' | 'PROMPTPAY' = 'PROMPTPAY') {
  const t = await openConnectedApi({ block3: true })
  t.mock.setBlock3LiveFrom('2026-09-01')
  const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
  const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], pay === 'CASH' ? { method: 'CASH', tenderedSatang: 5_000 } : { method: 'PROMPTPAY' })
  t.mock.override({ match: { key: `order:${r.orderId}` }, verdict: { status: 'rejected', reason, detail, ...(data === undefined ? {} : { data }) }, times: 1 })
  await pushOnce(ctx)
  const p = (await t.api.listSyncProblems(STAFF.TungAo)).find((x) => x.key === `order:${r.orderId}`)!
  return { t, ctx, r, p }
}

describe('remediesFor (spec 04 §6.4 · ruling R11)', () => {
  const base = { pending: false, farAhead: false, scopeSince: null, nowIso: '2026-09-25T12:00:00.000Z' }
  it.each([
    ['order', 'UNKNOWN_CODE', null, ['RETRY', 'REMAP_CODE', 'CLOSE_OFF_CATALOG', 'EXCLUDE']],
    ['order', 'CONFLICT', 'exists:', ['ACKNOWLEDGE_ELSEWHERE', 'EXCLUDE']],
    ['order', 'CONFLICT', null, ['RETRY', 'RENUMBER', 'CLOSE_OFF_CATALOG', 'EXCLUDE']],
    ['order', 'CONFLICT', 'key_changed:', ['EXCLUDE']],
    ['order', 'STUCK', null, ['RETRY', 'EXCLUDE']],
    ['order', 'INVALID', null, ['RETRY', 'CLOSE_OFF_CATALOG', 'EXCLUDE']],
    ['order', 'PARENT_REJECTED', null, []],
    ['order_off_catalog', 'FORBIDDEN', 'rule:', ['RETRY', 'EXCLUDE']],
    ['order_off_catalog', 'FORBIDDEN', 'role:', ['RECONFIRM_OWNER']],
    ['shift_close', 'CONFLICT', 'z_no_taken:', ['EXCLUDE']],
    ['shift_close', 'INVALID', 'data_conflict:', ['EXCLUDE']],
    ['shift_close', 'FORBIDDEN', 'role:', ['RECONFIRM_OWNER']],
    ['shift_open', 'FORBIDDEN', 'role:', ['REMAP_STAFF']],
    ['cash_movement', 'UNKNOWN_STAFF', null, ['RETRY', 'REMAP_STAFF']],
    ['order_void', 'FORBIDDEN', 'rule:', ['EXCLUDE']],
  ] as const)('%s %s %s → %j', (kind, reason, prefix, want) => {
    expect(remediesFor({ ...base, kind, reason, prefix })).toEqual(want)
  })
  it('a scope wait shows up only after 7 days, with EXCLUDE only', () => {
    const since = '2026-09-18T12:00:00.000Z'
    expect(remediesFor({ ...base, kind: 'shift_open', pending: true, reason: 'FORBIDDEN', prefix: 'scope:', scopeSince: since, nowIso: '2026-09-25T11:59:59.999Z' })).toEqual([])
    expect(remediesFor({ ...base, kind: 'shift_open', pending: true, reason: 'FORBIDDEN', prefix: 'scope:', scopeSince: since, nowIso: new Date(Date.parse(since) + SCOPE_CLOSABLE_AFTER_MS).toISOString() })).toEqual(['EXCLUDE'])
  })
})

describe('owner remedies of block 3 (spec 04 §6.4)', () => {
  it('"ปิดเป็นบิลนอกแคตตาล็อก": the order row stops for good, order_off_catalog is queued with the frozen money, the void follows it', async () => {
    const { t, ctx, r, p } = await rejected('UNKNOWN_CODE', 'ไม่พบเมนู "Cocoa"', undefined, 'CASH')
    await t.api.cancelSale({ orderId: r.orderId, actorUserId: STAFF.TungAo, approverUserId: STAFF.DCm, approverPin: '2222', reason: 'ลูกค้ายกเลิก', made: false, refundReference: null })
    await t.api.closeOffCatalog({ ...owner, outboxId: p.outboxId })
    const rows = await t.db.select().from(s.outbox).all()
    expect(rows.find((x) => x.idempotencyKey === `order:${r.orderId}`)?.status).toBe('closed_off_catalog')
    const oc = rows.find((x) => x.idempotencyKey === `order_off_catalog:${r.orderId}`)!
    expect(OrderOffCatalogRowData.parse(oc.rowJson)).toMatchObject({ totals: { total: 45 }, original_reason: 'UNKNOWN_CODE', closed_by: STAFF.TungAo, reason: owner.reason, shift_id: t.shift!.id })
    expect(rows.find((x) => x.idempotencyKey === `order_void:${r.orderId}`)?.parentKey).toBe(`order_off_catalog:${r.orderId}`)
    expect((await t.db.select().from(s.orderEvent).where(eq(s.orderEvent.type, 'CLOSED_OFF_CATALOG')).get())?.payloadJson).toMatchObject({ originalReason: 'UNKNOWN_CODE' })
    expect((await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())?.offCatalogAt).not.toBeNull()
    expect(await t.db.select().from(s.cashMovement).all()).toHaveLength(1) // only the VOID_REFUND — never a PAID_IN/PAID_OUT "to make up" for it (§4.10)
    await pushOnce(ctx); await pushOnce(ctx)
    expect(t.mock.orders().find((o) => o.posOrderId === r.orderId)).toMatchObject({ status: 'cancelled' })
    expect(await t.api.listSyncProblems(STAFF.TungAo)).toEqual([])
  })
  it('only an owner, only with the PIN (can "close_off_catalog")', async () => {
    const { t, p } = await rejected('INVALID', 'x')
    await t.api.setStaffPin({ staffId: STAFF.Beam, pin: '5555', approverUserId: STAFF.TungAo, approverPin: '1111' })
    for (const bad of [{ ...owner, approverUserId: STAFF.Beam, approverPin: '5555' }, { ...owner, approverPin: '0000' }]) {
      try { await t.api.closeOffCatalog({ ...bad, outboxId: p.outboxId }); expect.unreachable() } catch (e) { expect(['NOT_OWNER', 'PIN_WRONG']).toContain(posErrorCode(e)) }
    }
  })
  it('a row the tablet itself gave up on (STUCK) cannot be closed off-catalog (ruling R11)', async () => {
    const { t, p } = await rejected('INVALID', 'x')
    await t.db.update(s.outbox).set({ lastError: JSON.stringify({ reason: 'STUCK', detail: '' }) }).where(eq(s.outbox.id, p.outboxId))
    try { await t.api.closeOffCatalog({ ...owner, outboxId: p.outboxId }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('REMEDY_NOT_ALLOWED') }
  })
  it('"รับทราบ — บิลอยู่ในระบบกลางแล้ว": marked sent with dayo\'s order_no; a different total raises the red bar (m2)', async () => {
    const data = { order_no: 'L260925-014', version: 2, reported_total: 40, payment_is_cash: false, off_catalog: true }
    const { t, r, p } = await rejected('CONFLICT', 'off_catalog_exists: L260925-014', data)
    expect(p.central).toEqual({ orderNo: 'L260925-014', reportedTotalSatang: 4_000, paymentIsCash: false, matchesLocal: false })
    expect(await t.api.acknowledgeElsewhere({ ...owner, outboxId: p.outboxId })).toEqual({ orderNo: 'L260925-014', matchesLocal: false })
    expect((await t.db.select().from(s.order).where(eq(s.order.id, r.orderId)).get())).toMatchObject({ centralOrderNo: 'L260925-014', centralMismatchJson: { reportedTotalSatang: 4_000, localTotalSatang: 4_500 } })
    expect((await t.api.syncStatus()).centralMismatchBills).toBe(1)
  })
  it('a bill dayo\'s shape rules would refuse as off-catalog (clock set back before sold_at) → OFF_CATALOG_NOT_POSSIBLE, nothing written, "ปิดไว้ในเครื่อง" still offered (review item 2)', async () => {
    const { t, r, p } = await rejected('INVALID', 'x')
    t.clock.set('2026-09-25T02:00:00.000Z')                                       // an hour before the sale (sold 03:00Z)
    try { await t.api.closeOffCatalog({ ...owner, outboxId: p.outboxId }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('OFF_CATALOG_NOT_POSSIBLE') }
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`)).get())?.status).toBe('dead')
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_off_catalog')).all()).toEqual([])
    expect(p.remedies.at(-1)).toBe('EXCLUDE')
    await t.api.excludeFromSync({ ...owner, outboxId: p.outboxId })
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`)).get())?.status).toBe('local_only')
  })
  it('closing off-catalog needs a reason: blank → BAD_INPUT, nothing written (review item 13)', async () => {
    const { t, p } = await rejected('INVALID', 'x')
    try { await t.api.closeOffCatalog({ ...owner, reason: '   ', outboxId: p.outboxId }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
    expect(await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'order_off_catalog')).all()).toEqual([])
  })
  it('CODE_REMAPPED of a payment on the same non-cash side passes and the bill goes (review item 13)', async () => {
    const { t, ctx, r, p } = await rejected('UNKNOWN_CODE', 'ไม่พบวิธีชำระ "qr"')
    t.mock.bumpCatalog((c) => { c.catalog.paymentMethods.push({ code: 'transfer', name: 'โอน', aliases: [] }) })
    await pullCatalog(ctx)
    await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'payment', code: 'transfer' } })
    await pushOnce(ctx)
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.idempotencyKey, `order:${r.orderId}`)).get())?.status).toBe('sent')
  })
  it('CODE_REMAPPED of a payment never flips cash ↔ non-cash (§4.10 ข้อ 7)', async () => {
    const { t, p } = await rejected('UNKNOWN_CODE', 'ไม่พบวิธีชำระ "qr"')
    try { await t.api.remapCode({ ...owner, outboxId: p.outboxId, target: { field: 'payment', code: 'cash' } }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('REMEDY_NOT_ALLOWED') }
  })
  it('a shift conflict (counted:) shows the S5 red bar and "ปิดไว้ในเครื่อง" frees the lane; children follow (R12 · R19)', async () => {
    const t = await openConnectedApi({ block3: true })
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'น้ำแข็ง' })
    t.mock.override({ match: { key: `shift_open:${t.shift!.id}` }, verdict: { status: 'rejected', reason: 'CONFLICT', detail: 'key_changed: x' }, times: 1 })
    await pushOnce(ctx)
    expect((await t.api.syncStatus()).shiftDataConflict).toBe(true)
    const [p] = await t.api.listSyncProblems(STAFF.TungAo)
    expect(p).toMatchObject({ kind: 'shift_open', hint: 'shift_conflict', remedies: ['EXCLUDE'], children: [expect.objectContaining({ kind: 'cash_movement', reason: 'PARENT_REJECTED' })] })
    await t.api.excludeFromSync({ ...owner, outboxId: p!.outboxId })
    expect((await t.db.select().from(s.shift).where(eq(s.shift.id, t.shift!.id)).get())?.syncMode).toBe('local_only')
    expect((await t.db.select().from(s.outbox).where(eq(s.outbox.tableName, 'cash_movement')).get())?.status).toBe('local_only')
  })
  it('scope bar: yellow at once, red after 24 h, closable after 7 days (m1)', async () => {
    const t = await openConnectedApi({ block3: true })
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    t.mock.setScopes(['catalog:read', 'staff:read', 'orders:read', 'orders:write'])
    await pushOnce(ctx)
    expect((await t.api.syncStatus()).scopeWait).toMatchObject({ scope: 'shift:write', red: false, closable: false })
    t.clock.advanceMs(24 * 3_600_000 + 1)
    expect((await t.api.syncStatus()).scopeWait).toMatchObject({ red: true, closable: false })
    t.clock.advanceMs(6 * 86_400_000)
    expect((await t.api.syncStatus()).scopeWait).toMatchObject({ red: true, closable: true })
    expect((await t.api.listSyncProblems(STAFF.TungAo))[0]).toMatchObject({ waiting: 'scope', remedies: ['EXCLUDE'] })
  })
  it('closed_off_catalog and local_only rows are never counted as "ยังไม่ส่ง"', async () => {
    const { t, p } = await rejected('INVALID', 'x')
    await t.api.closeOffCatalog({ ...owner, outboxId: p.outboxId })
    expect((await t.api.bootstrap()).pendingSyncItems).toBe(1) // only the new order_off_catalog row — shift_open went with the first push; the closed order row is not counted
  })
})
```

`apps/pos/test/block3-flow.test.ts` (ครบวงกับ mock — เกณฑ์ §9 ก้อน 3 ฝั่งแท็บเล็ต):

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import type { CentralOrder } from '@dayo/contracts'
import { pushOnce } from '../src/sync/push'
import { openConnectedApi, STAFF } from './helpers/dayo'
import { sellCode } from './helpers/db'
import { countAndClose } from './helpers/shift'

const owner = { approverUserId: STAFF.TungAo, approverPin: '1111', reason: 'แก้ตามหน้าส่งไม่ผ่าน' }
const dcm = { approverUserId: STAFF.DCm, approverPin: '2222' }
const lines = (baht: number) => [{ denominationSatang: 100, count: baht }]
const bot = (no: string, total: number, at: string): CentralOrder => ({ order_no: no, sale_date: '2026-09-25', status: 'ok', source: 'line', external_ref: null, version: 1, channel: 'line', payment: 'cash', totals: { items_subtotal: total, items_discount: 0, bill_discount: 0, total }, amount_mismatch: false, updated_at: at, sold_at: at })
async function ready() {
  const t = await openConnectedApi({ block3: true })          // shift open 10:00 Bangkok, float ฿500
  t.mock.setBlock3LiveFrom('2026-09-01')
  return { t, ctx: { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() } }
}
type T = Awaited<ReturnType<typeof ready>>['t']
const statuses = (t: T) => t.mock.zReports().map((z) => z.recomputeStatus)
const dead = (t: T) => t.db.select().from(s.outbox).where(eq(s.outbox.status, 'dead')).all()
const cashSale = (t: T) => sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'CASH', tenderedSatang: 5_000 })   // ฿45
const qrSale = (t: T) => sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
const problemOf = async (t: T, key: string) => (await t.api.listSyncProblems(STAFF.TungAo)).find((p) => p.key === key)!

describe('block 3 end to end with the mock (spec 04 §9 block 3, tablet side)', () => {
  it('a shift whose bills arrive after the Z: waiting_bills, then matched with nothing more sent (R3-A)', async () => {
    const { t, ctx } = await ready()
    const c1 = await cashSale(t); const c2 = await cashSale(t); const q1 = await qrSale(t)
    await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'น้ำแข็ง' })
    await t.api.cancelSale({ orderId: c1.orderId, actorUserId: STAFF.TungAo, ...dcm, reason: 'ลูกค้ายกเลิก', made: false, refundReference: null }) // VOID_REFUND ฿45
    for (const o of [c1, c2, q1]) t.mock.override({ match: { key: `order:${o.orderId}` }, verdict: { status: 'deferred', reason: 'BUSY', detail: 'lock' }, times: 1 })
    await countAndClose(t, lines(525), dcm)                              // 500 + 90 − 45 − 20
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['waiting_bills'])                      // the Z is in dayo, its bills are not
    t.clock.advanceMs(6_001)                                            // past the first backoff even at +20% jitter (5 s × 1.2)
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['matched'])                            // the bills arrived; the tablet sent nothing extra for the Z
    expect(await dead(t)).toEqual([])
  })
  it('three bot cash bills are in the expected cash and the Z is matched', async () => {
    const { t, ctx } = await ready()
    await cashSale(t)
    t.mock.seedCentralOrders([bot('L260925-901', 70, '2026-09-25T04:00:00+00:00'), bot('L260925-902', 35, '2026-09-25T04:10:00+00:00'), bot('L260925-903', 50, '2026-09-25T04:20:00+00:00')])
    t.clock.advanceMs(2 * 3_600_000)
    const r = await countAndClose(t, lines(700), dcm)                   // 500 + 45 + 155
    expect(r.z?.snapshot).toMatchObject({ cashVarianceSatang: 0, cash: { botCashSatang: 15_500 } })
    expect(r.z?.snapshot?.botBills).toHaveLength(3)
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['matched'])
  })
  it('a rejected bill closed off-catalog is accepted and the Z listing it is matched — never waiting_bills', async () => {
    const { t, ctx } = await ready()
    const c = await cashSale(t)
    t.mock.override({ match: { key: `order:${c.orderId}` }, verdict: { status: 'rejected', reason: 'UNKNOWN_CODE', detail: 'ไม่พบเมนู "Cocoa"' }, times: 1 })
    await pushOnce(ctx)
    await t.api.closeOffCatalog({ ...owner, outboxId: (await problemOf(t, `order:${c.orderId}`)).outboxId })
    await countAndClose(t, lines(545), dcm)
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['matched'])
    expect(t.mock.orders().find((o) => o.posOrderId === c.orderId)).toMatchObject({ status: 'ok', total: 45 })
    expect(await dead(t)).toEqual([])
  })
  it('a rejected cash movement makes the Z wait (missing movement); REMAP_STAFF fixes it → matched', async () => {
    const { t, ctx } = await ready()
    const m = await t.api.recordCashMovement({ actorUserId: STAFF.TungAo, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'น้ำแข็ง' })
    t.mock.override({ match: { key: `cash_movement:${m.id}` }, verdict: { status: 'rejected', reason: 'UNKNOWN_STAFF', detail: 'ไม่พบพนักงาน' }, times: 1 })
    await pushOnce(ctx)
    await countAndClose(t, lines(480), dcm)
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['waiting_bills'])
    expect(t.mock.zReports()[0]!.missing.movementIds).toEqual([m.id])
    await t.api.remapStaff({ ...owner, outboxId: (await problemOf(t, `cash_movement:${m.id}`)).outboxId, newStaffId: STAFF.DCm })
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['matched'])
  })
  it('RECEIPT_RENUMBERED after the Z: the local Z does not change and dayo stays matched (R-I2)', async () => {
    const { t, ctx } = await ready()
    const q = await qrSale(t)
    t.mock.override({ match: { key: `order:${q.orderId}` }, verdict: { status: 'rejected', reason: 'CONFLICT', detail: 'receipt_taken: A-000001' }, times: 1 })
    const r = await countAndClose(t, lines(500), dcm)
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['waiting_bills'])
    await t.api.renumberReceipt({ ...owner, outboxId: (await problemOf(t, `order:${q.orderId}`)).outboxId })
    await pushOnce(ctx)
    expect(statuses(t)).toEqual(['matched'])
    expect((await t.api.getZReport(r.z!.shiftId)).hash).toBe(r.z!.hash)  // the Z in the tablet is never edited
  })
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos exec vitest run test/sync-problems-block3.test.ts test/block3-flow.test.ts` · คาด FAIL
- [ ] **Step 3: ทำ** — `sync-problems.ts` (`import { ZodError } from 'zod'`):

```ts
export async function closeOffCatalog(db: RemoteDb, deps: ApiDeps, i: OwnerApproval & { outboxId: string }): Promise<{ offCatalogKey: string }> {
  const reason = checkedReason(i.reason)                                       // block 2 helper: trimmed, 1–200, no C0
  const approver = await requireOwnerPin(db, deps, i.approverUserId, i.approverPin)
  if (!can(approver.role, 'close_off_catalog')) throw new PosError('NOT_OWNER', approver.displayName)
  const device = await requireDevice(db)
  const at = deps.now()
  const key = await db.transaction(async (tx) => {
    const row = await tx.select().from(s.outbox).where(eq(s.outbox.id, i.outboxId)).get()
    const err = decodeLastError(row?.lastError ?? null)
    const prefix = detailPrefix(err.detail)
    if (row === undefined || row.tableName !== 'order' || row.status !== 'dead' || !remediesFor({ kind: 'order', pending: false, reason: err.reason, prefix, farAhead: false, scopeSince: null, nowIso: at }).includes('CLOSE_OFF_CATALOG')) {
      throw new PosError('REMEDY_NOT_ALLOWED', 'CLOSE_OFF_CATALOG')
    }
    const order = OrderRowData.parse(row.rowJson)
    const items = await tx.select().from(s.orderItem).where(eq(s.orderItem.orderId, order.pos_order_id)).orderBy(asc(s.orderItem.lineNo)).all()
    let data
    try {
      data = buildOffCatalogRowData({ order, closedBy: approver.id, closedAt: at, reason, originalReason: err.reason,
        items: items.map((x) => ({ menuCode: x.menuCode, menuNameTh: x.menuNameTh, size: x.size, sweetness: x.sweetness, qty: x.qty, unitPriceSatang: x.unitPriceSatang, discountPerCupSatang: x.discountPerCupSatang, lineTotalSatang: x.lineTotalSatang })) })
    } catch (e) {
      if (e instanceof OffCatalogError) throw new PosError('OFF_CATALOG_NOT_POSSIBLE', e.message)
      throw e
    }
    try {
      await enqueuePush(tx, { kind: 'order_off_catalog', id: order.pos_order_id, data, parentKey: null }, at, deps.newId) // parses PushRow first
    } catch (e) {
      // review item 2: a row dayo's own shape rules would refuse (e.g. closed_at < sold_at after the clock went back) — the
      // owner gets a clear refusal and still has "ปิดไว้ในเครื่อง"; nothing was written (the throw rolls the transaction back)
      if (e instanceof ZodError) throw new PosError('OFF_CATALOG_NOT_POSSIBLE', e.issues.slice(0, 3).map((x) => x.path.join('.')).join(', '))
      throw e
    }
    await tx.update(s.outbox).set({ status: 'closed_off_catalog' }).where(eq(s.outbox.id, row.id))
    const newKey = `order_off_catalog:${order.pos_order_id}`
    await tx.update(s.outbox).set({ parentKey: newKey }).where(eq(s.outbox.parentKey, row.idempotencyKey))
    await releaseChildren(tx, [newKey])                                        // PARENT_REJECTED children wait for the new parent instead
    await tx.update(s.order).set({ offCatalogAt: at }).where(eq(s.order.id, order.pos_order_id))
    await appendOrderEvents(tx, { orderId: order.pos_order_id, deviceId: device.id, actorType: 'user', actorId: approver.id, at, newId: deps.newId },
      [{ type: 'CLOSED_OFF_CATALOG', payload: { reason, originalReason: err.reason, approvedBy: approver.id, closedAt: at } }])
    return newKey
  })
  deps.afterWrite?.()
  return { offCatalogKey: key }
}
```

`acknowledgeElsewhere`: PIN owner + เหตุผล · แถว `order`/`order_off_catalog` `dead` + `CONFLICT` + คำนำหน้า `exists:`/`off_catalog_exists:` · `ExistsConflictData.parse(row.resultJson)` (อ่านไม่ได้ = `REMEDY_NOT_ALLOWED`) · เทียบ `edgeBahtToSatang(reported_total)` กับ `order.total_satang` และ `payment_is_cash` กับ `order.payment_code === 'cash'` · ธุรกรรม: แถว → `sent` (`sentAt`) · `order.central_order_no = data.order_no` · ต่าง → `order.central_mismatch_json` · `releaseChildren(tx, [row.idempotencyKey])` · event `DELIVERED_ELSEWHERE { order_no, matchesLocal, reason, approvedBy }` · `reconfirmOwner`: แถว `dead` `FORBIDDEN role:` ชนิด `shift_close`/`order_off_catalog` · แก้ `row_json.closed_by = approver.id`, `closed_at = now` (Z ในเครื่องไม่แก้ — `z_report` ไม่มี `closed_by`) · `pending`, `attempts 0` · `audit_log` `sync_row_reconfirmed` (กะ) หรือ event `CLOSED_OFF_CATALOG {reclosedBy}` (บิล) · `remapCode`: `field === 'payment'` และ `(before === 'cash') !== (target.code === 'cash')` → `REMEDY_NOT_ALLOWED` · `remapStaff`/`excludeFromSync` ตาม Interfaces (`exclude` ไล่ลูกทุกชั้นด้วย `parent_key` ซ้ำจนไม่เจอ) · `listSyncProblems`: รวมแถว `pending` ที่ `farAhead` หรือ `scope:` ≥ 7 วัน (`waiting`) · `hint` · `central` จาก `result_json` · `syncStatus` (`bootstrap.ts`): `scopeWait` = แถว `pending` ที่ `prefix === 'scope:'` และ `scopeSince` เก่าสุด → `{ scope: KIND_SCOPE[kind], since, red: now − since > SCOPE_RED_AFTER_MS, closable: now − since ≥ SCOPE_CLOSABLE_AFTER_MS }` · `shiftDataConflict` = มีแถวชนิดกะ `dead` ที่ `CONFLICT` + `key_changed:`/`counted:`/`z_no_taken:` หรือ `INVALID` + `data_conflict:` (R5-2) · `centralMismatchBills` = จำนวน `order.central_mismatch_json is not null` · `orders.ts`: `offCatalog`, `centralMismatch` · `pos-api.ts` ต่อสามฟังก์ชันใหม่ (บน serial) · ทุก API ของหน้านี้ตรวจ `can(role, 'sync_problems')` ที่ API ด้วย

- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test` (`sync-problems.test.ts` ของก้อน 2: รายการปุ่มของแถว `order` ที่คาดไว้แบบก้อน 2 เปลี่ยนตามตารางข้างบน — เพิ่ม `CLOSE_OFF_CATALOG` ตาม C13 และ `EXCLUDE` ท้ายสุด — แก้ความคาดหวังนั้นและเขียนเหตุผลในคอมเมนต์)
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 6: commit** — stage ไฟล์ตาม Files · ข้อความ: `feat(pos): close rejected bills as off-catalog and handle block 3 sync problems`

---

## 6. สาย D — หน้าจอ

### Task 15: หน้านับเงิน (นับเสร็จ → ดูยอด → PIN) · ออกใบปิดกะ · แถบ "ใบปิดกะรอออนไลน์" · Z แสดงบิลบอท

ผู้ทำ: pos-ui-developer (sonnet) · ผู้ตรวจเพิ่ม: **security-reviewer** (PIN owner) · สเปก §6.8 ทั้งหมด · D52 Q3b-2/Q3b-3 (นับแบบไม่เห็นยอด) · D101 · D102 · ruling R2, R6–R8 · รอ: Task 12

**Files:**
- Modify: `apps/pos/src/screens/{CloseShiftScreen,ZReportScreen,ZListScreen,OpenShiftScreen,StatusBanners}.tsx` (+ `.test.tsx`), `apps/pos/src/router.tsx`, `apps/pos/src/app/queries.ts`, `apps/pos/src/ui/th.ts`
- Create: `apps/pos/src/screens/CountReview.tsx`, `apps/pos/src/screens/IssueZScreen.tsx` (+ `.test.tsx`), `apps/pos/src/screens/block3-test-fixtures.ts` (ตัวช่วยเทสต์ — Task 16 ใช้ต่อ)

**Interfaces:**
- Consumes: `finishCount`, `countSummary`, `fetchBotCash`, `confirmCount`, `issueZ`, `BootstrapState.countingShift/zWaiting`, `CountSummaryDto` (Task 12) · `varianceNeedsReason` (`@dayo/domain`) · `can` · ข้อความ error ของ Task 1
- Produces: route `/shift/close` (นับ → ทบทวน) · route `/shift/z/$shiftId` (ออก Z ของกะที่รอ) · `CountReview` (ใช้ทั้งสองหน้า) · แถบ `banner-z-waiting`

ลำดับหน้าจอ (ล็อกตาม D101):
1. `/shift/close`: ตารางนับ 9 ชนิด (`count-input-<บาท>`) **ไม่แสดงยอดที่ควรมี** · ปุ่ม `count-finish` "นับเสร็จ" → `finishCount` (กะหยุดรับขายทันที) → `countSummary` → ถ้า `syncMode === 'central'` และ `!includesBotCash` ลอง `fetchBotCash` แล้ว `countSummary` อีกครั้ง (ผลของ `fetchBotCash` เอง **ไม่ใช้เลือกทาง** — ใช้ `countSummary` ครั้งหลังสุด) · เปิดแอปใหม่ขณะ `counting` = เริ่มที่ `countSummary` เหมือนกัน
2. `CountReview`: **เลือกทางจาก `summary.includesBotCash` เท่านั้น** (review item 1 — แอปที่เปิดใหม่ขณะ `counting` และมีบิลบอทเก็บไว้แล้วต้องได้ทางเดียวกับ API): `online` = `includesBotCash || syncMode === 'local_only'` · เงินที่ควรมี · ส่วนต่าง = `cashVarianceSatang(counted, summary.expectedCashSatang)` (domain — review item 8) · รายการองค์ประกอบ (ทอนตั้งต้น · ขายเงินสด · คืนเงิน · เข้า · ออก · นำออก · **บิลเงินสดบอท/เว็บ N ใบ ฿X** เมื่อ `bot !== null`) · กะ `central` ที่ `!includesBotCash` = ป้าย `count-no-bot-cash` "ยังไม่รวมบิลเงินสดจากบอท" และ **ไม่ถามเหตุผล** · แก้จำนวนนับได้ · `online` และ `varianceNeedsReason(variance, varianceAlertSatang)` = ช่องเหตุผลบังคับ (`count-reason`) · เลือก owner (`count-approver-<ชื่อ>`) + PIN (`PinPad` เดิม `pin-<เลข>` · เลือกตัวเองได้ D52 Q3b-2) · ปุ่ม `count-confirm` = `online`: "ยืนยันและออกใบปิดกะ" (`z: ZSettle`) · ไม่ใช่: "ยืนยันการนับ (ใบปิดกะออกเมื่อออนไลน์)" (`z: null`)
3. `Z_CHAIN_BROKEN` → หน้าจอเดิมของแผน 3b (รับทราบด้วย PIN ซ้ำ) · detail `central` → ข้อความ `zChainCentral(bootstrap.centralLastZNo)` (Task 13 เพิ่มช่องนี้ใน `BootstrapState`)
4. ออฟไลน์สำเร็จ → หน้า "นับแล้ว" + ปุ่มเปิดกะใหม่ · แถบแดง `banner-z-waiting` "ใบปิดกะ <วันที่> รอออนไลน์" (ทุกหน้า จนกว่า Z ออก) + ปุ่ม `z-issue` (เมื่อออนไลน์) → `/shift/z/$shiftId` = `fetchBotCash` → `CountReview` (ไม่แก้จำนวนนับได้ · ถามเหตุผลถ้า ≥ เกณฑ์) → PIN → `issueZ`
5. เปิดแอปขณะมี `countingShift` → พาไป `/shift/close` ขั้นทบทวน (นับค้างไว้) · `OpenShiftScreen` ได้ `COUNT_PENDING` → ปุ่มไปหน้านั้น

ข้อความเพิ่มใน `ui/th.ts`:

```ts
  countFinish: 'นับเสร็จ',
  countExpected: 'เงินสดที่ควรมี',
  countVariance: 'ส่วนต่าง (นับได้ − ที่ควรมี)',
  countNoBotCash: 'ยังไม่รวมบิลเงินสดจากบอท',
  countBotCash: (n: number): string => `บิลเงินสดจากบอท/เว็บ ${n} ใบ`,
  countFrozen: 'กะนี้หยุดรับขายแล้ว — ขายต่อต้องเปิดกะใหม่',
  countConfirmOnline: 'ยืนยันและออกใบปิดกะ',
  countConfirmOffline: 'ยืนยันการนับ (ใบปิดกะออกเมื่อออนไลน์)',
  countSavedOffline: 'บันทึกการนับแล้ว — ใบปิดกะจะออกเมื่อเชื่อมต่อได้',
  zWaitingBanner: (date: string): string => `ใบปิดกะ ${date} รอออนไลน์`,
  zIssue: 'ออกใบปิดกะ',
  zBotWindow: (after: string, until: string): string => `บิลบอทช่วง ${after} – ${until}`,
  zChainCentral: (n: number): string => `ใบปิดกะใบแรกหลังตั้งเครื่องใหม่ จะต่อเลขจาก Z ${n} ในระบบกลาง — เจ้าของกรอก PIN อีกครั้งเพื่อรับทราบ`,
  zLocalOnly: 'ใบปิดกะนี้เก็บในเครื่องเท่านั้น',
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `apps/pos/src/screens/CloseShiftScreen.test.tsx` (แทนเทสต์เดิมที่ใช้ `closeShift`)

ตัวช่วยร่วมของเทสต์หน้าจอก้อน 3: `apps/pos/src/screens/block3-test-fixtures.ts` (ใช้ `render` ของ `apps/pos/src/test-utils` จากก้อน 2 T17 ที่รับ `{ api, session }` — Step 0: ตรวจชื่อจริง)

```ts
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import { summarizeShiftSales } from '@dayo/domain'
import type { BotCashDto, CountSummaryDto } from '../api/types'

export const SALES_45 = summarizeShiftSales([{ id: 'o1', status: 'paid', subtotalSatang: 4_500, discountSatang: 0, totalSatang: 4_500, payments: [{ method: 'CASH', amountSatang: 4_500 }] }])
export const botDto: BotCashDto = { shiftId: 's1', after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T05:00:00.000Z', cashTotalSatang: 7_000, fetchedAt: '2026-09-25T05:00:01.000Z',
  bills: [{ orderNo: 'L260925-901', version: 1, source: 'line', soldAt: '2026-09-25T04:00:00+00:00', totalSatang: 7_000, createdByName: 'DCm' }] }
export function summary(over: Partial<CountSummaryDto> = {}): CountSummaryDto {
  return {
    shift: { id: 's1', businessDate: '2026-09-25', openedAt: '2026-09-25T03:00:00.000Z', openedBy: 'u1', openingFloatSatang: 50_000, syncMode: 'central', openedByName: 'TungAo', openedQuick: false },
    generatedAt: '2026-09-25T05:00:00.000Z', sales: SALES_45,
    cash: { openingFloatSatang: 50_000, cashSalesSatang: 4_500, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0, drawerExpensesSatang: 0, botCashSatang: 7_000 },
    expectedCashSatang: 61_500, varianceAlertSatang: 2_000, cashMovements: [], voids: [], negativeBases: [], pendingSyncItems: 0, fingerprint: 'fp',
    countedAt: '2026-09-25T05:00:00.000Z', syncMode: 'central', includesBotCash: true, bot: botDto, ...over,
  }
}
export const OWNERS = [{ id: 'u1', displayName: 'TungAo', role: 'owner' as const }, { id: 'u2', displayName: 'DCm', role: 'owner' as const }]
export function fakeApi(over: Record<string, unknown> = {}) {
  return {
    bootstrap: vi.fn(async () => ({ users: OWNERS, countingShift: null, zWaiting: [], centralLastZNo: null })),
    finishCount: vi.fn(async () => ({ shiftId: 's1', countedAt: '2026-09-25T05:00:00.000Z' })),
    fetchBotCash: vi.fn(async () => botDto),
    countSummary: vi.fn(async () => summary()),
    confirmCount: vi.fn(async () => ({ countId: 'c1', z: null })),
    issueZ: vi.fn(async () => ({ id: 'z1', shiftId: 's1', createdAt: '2026-09-25T05:10:00.000Z', hash: 'ab'.repeat(32), hashOk: true, snapshot: null })),
    ...over,
  }
}
export const user = userEvent.setup()
export async function countBaht(baht: number): Promise<void> { await user.clear(screen.getByTestId('count-input-1')); await user.type(screen.getByTestId('count-input-1'), String(baht)) }
export async function pickOwnerAndPin(name: string, pin: string): Promise<void> {
  await user.click(screen.getByTestId(`count-approver-${name}`))
  for (const d of pin) await user.click(screen.getByTestId(`pin-${d}`))
}
```

`apps/pos/src/screens/CloseShiftScreen.test.tsx` (แทนเทสต์เดิมที่ใช้ `closeShift`):

```tsx
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '../test-utils'
import { TH } from '../ui/th'
import { countBaht, fakeApi, pickOwnerAndPin, summary, user } from './block3-test-fixtures'
import { CloseShiftScreen } from './CloseShiftScreen'

const session = { userId: 'u1', role: 'owner' as const }

describe('CloseShiftScreen (D52 Q3b-3 · D101 · D102)', () => {
  it('the expected cash is hidden until "นับเสร็จ"', async () => {
    const api = fakeApi()
    render(<CloseShiftScreen />, { api, session })
    expect(screen.queryByTestId('count-expected')).toBeNull()
    await user.click(screen.getByTestId('count-finish'))
    expect(api.finishCount).toHaveBeenCalledOnce()
    expect(await screen.findByTestId('count-expected')).toHaveTextContent('615.00')
  })
  it('online: bot bills listed; a ฿20.00 shortage needs a reason; confirm sends count + Z', async () => {
    const api = fakeApi()
    render(<CloseShiftScreen />, { api, session })
    await countBaht(595); await user.click(screen.getByTestId('count-finish'))
    expect(await screen.findByText(TH.countBotCash(1))).toBeVisible()
    await pickOwnerAndPin('DCm', '2222')
    expect(screen.getByTestId('count-confirm')).toBeDisabled()
    await user.type(screen.getByTestId('count-reason'), 'ทอนผิด')
    await user.click(screen.getByTestId('count-confirm'))
    expect(api.confirmCount).toHaveBeenCalledWith(expect.objectContaining({ shiftId: 's1', approverUserId: 'u2', approverPin: '2222', shownFingerprint: 'fp', z: expect.objectContaining({ varianceReason: 'ทอนผิด' }) }))
  })
  it('the path follows summary.includesBotCash: bot cash already stored (e.g. after a reload, now offline) → online path, E4 not even asked (review item 1)', async () => {
    const api = fakeApi({ fetchBotCash: vi.fn(async () => { throw new Error('OFFLINE: network') }) }) // countSummary says includesBotCash: true
    render(<CloseShiftScreen />, { api, session })
    await countBaht(615); await user.click(screen.getByTestId('count-finish'))
    expect(await screen.findByText(TH.countBotCash(1))).toBeVisible()
    expect(api.fetchBotCash).not.toHaveBeenCalled()
    expect(screen.queryByTestId('count-no-bot-cash')).toBeNull()
    await pickOwnerAndPin('DCm', '2222'); await user.click(screen.getByTestId('count-confirm'))
    expect(api.confirmCount).toHaveBeenCalledWith(expect.objectContaining({ z: expect.objectContaining({ acknowledgeZChainBroken: false }) }))
  })
  it('offline (no stored bot cash): label "ยังไม่รวมบิลเงินสดจากบอท", no reason asked, z: null, then the waiting screen', async () => {
    const api = fakeApi({ fetchBotCash: vi.fn(async () => { throw new Error('OFFLINE: network') }), countSummary: vi.fn(async () => summary({ includesBotCash: false, bot: null, expectedCashSatang: 54_500 })) })
    render(<CloseShiftScreen />, { api, session })
    await countBaht(615); await user.click(screen.getByTestId('count-finish'))
    expect(await screen.findByTestId('count-no-bot-cash')).toHaveTextContent(TH.countNoBotCash)
    expect(screen.queryByTestId('count-reason')).toBeNull()
    await pickOwnerAndPin('DCm', '2222'); await user.click(screen.getByTestId('count-confirm'))
    expect(api.confirmCount).toHaveBeenCalledWith(expect.objectContaining({ z: null }))
    expect(await screen.findByText(TH.countSavedOffline)).toBeVisible()
  })
  it('a local-only shift: no E4 call, no bot line, no offline label, the Z right away (ruling R6)', async () => {
    const api = fakeApi({ countSummary: vi.fn(async () => summary({ syncMode: 'local_only', includesBotCash: false, bot: null, expectedCashSatang: 54_500, cash: { ...summary().cash, botCashSatang: 0 } })) })
    render(<CloseShiftScreen />, { api, session })
    await countBaht(545); await user.click(screen.getByTestId('count-finish'))
    await screen.findByTestId('count-expected')
    expect(api.fetchBotCash).not.toHaveBeenCalled()
    expect(screen.queryByTestId('count-no-bot-cash')).toBeNull()
    expect(screen.queryByText(TH.countBotCash(1))).toBeNull()
    await pickOwnerAndPin('DCm', '2222'); await user.click(screen.getByTestId('count-confirm'))
    expect(api.confirmCount).toHaveBeenCalledWith(expect.objectContaining({ z: expect.objectContaining({ varianceReason: null }) }))
  })
  it('Z_CHAIN_BROKEN "central": explains the central Z number, asks the PIN again, retries with the acknowledgement', async () => {
    const confirmCount = vi.fn().mockRejectedValueOnce(new Error('Z_CHAIN_BROKEN: central')).mockResolvedValueOnce({ countId: 'c1', z: null })
    const api = fakeApi({ confirmCount, bootstrap: vi.fn(async () => ({ users: [{ id: 'u1', displayName: 'TungAo', role: 'owner' }, { id: 'u2', displayName: 'DCm', role: 'owner' }], countingShift: null, zWaiting: [], centralLastZNo: 41 })) })
    render(<CloseShiftScreen />, { api, session })
    await countBaht(615); await user.click(screen.getByTestId('count-finish'))
    await screen.findByTestId('count-expected')
    await pickOwnerAndPin('DCm', '2222'); await user.click(screen.getByTestId('count-confirm'))
    expect(await screen.findByText(TH.zChainCentral(41))).toBeVisible()
    await pickOwnerAndPin('DCm', '2222'); await user.click(screen.getByTestId('count-confirm'))
    await waitFor(() => expect(confirmCount).toHaveBeenLastCalledWith(expect.objectContaining({ z: expect.objectContaining({ acknowledgeZChainBroken: true }) })))
  })
})
```

`apps/pos/src/screens/IssueZScreen.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '../test-utils'
import { TH } from '../ui/th'
import { fakeApi, pickOwnerAndPin, summary, user } from './block3-test-fixtures'
import { IssueZScreen } from './IssueZScreen'

const session = { userId: 'u1', role: 'owner' as const }
describe('IssueZScreen (D101 step 3)', () => {
  it('fetches E4 on open, shows the real variance, the count is read-only, a reason at ≥ ฿20, then issueZ', async () => {
    const api = fakeApi()                                                        // expected ฿615.00 with bot cash; the saved count is ฿595 → −฿20.00
    render(<IssueZScreen shiftId="s1" countedSatang={59_500} />, { api, session })
    expect(await screen.findByTestId('count-expected')).toHaveTextContent('615.00')
    expect(api.fetchBotCash).toHaveBeenCalledWith('s1')
    expect(screen.queryByTestId('count-input-1')).toBeNull()
    await pickOwnerAndPin('TungAo', '1111')
    expect(screen.getByTestId('count-confirm')).toBeDisabled()
    await user.type(screen.getByTestId('count-reason'), 'ทอนผิด')
    await user.click(screen.getByTestId('count-confirm'))
    expect(api.issueZ).toHaveBeenCalledWith(expect.objectContaining({ shiftId: 's1', shownFingerprint: 'fp', varianceReason: 'ทอนผิด', approverUserId: 'u1', approverPin: '1111' }))
    expect(await screen.findByTestId('z-issued')).toBeVisible()
  })
  it('E4 fails: the error text and a retry button — no confirm button', async () => {
    const api = fakeApi({ fetchBotCash: vi.fn(async () => { throw new Error('OFFLINE: network') }), countSummary: vi.fn(async () => summary({ includesBotCash: false, bot: null })) })
    render(<IssueZScreen shiftId="s1" countedSatang={61_500} />, { api, session })
    expect(await screen.findByTestId('z-retry')).toBeVisible()
    expect(screen.queryByTestId('count-confirm')).toBeNull()
    expect(screen.getByText(TH.errBotCashRequired)).toBeVisible()
  })
})
```

`apps/pos/src/screens/StatusBanners.test.tsx` (เพิ่ม):

```tsx
it('a Z waiting to go online shows the red bar with the Thai date and the issue button (§6.8)', async () => {
  render(<StatusBanners />, { api: fakeApi({ bootstrap: vi.fn(async () => ({ users: OWNERS, countingShift: null, centralLastZNo: null, zWaiting: [{ shiftId: 's1', businessDate: '2026-09-25', countedAt: '2026-09-25T05:00:00.000Z', syncMode: 'central' }] })) }), session: { userId: 'u1', role: 'staff' } })
  expect(await screen.findByTestId('banner-z-waiting')).toHaveTextContent(TH.zWaitingBanner('25 ก.ย. 2569'))
  expect(screen.getByTestId('z-issue')).toBeVisible()
})
```

`apps/pos/src/screens/ZReportScreen.test.tsx` (เพิ่ม) · ตัวช่วย `zDto` และ `CHAIN_WARNING` — **ถ้าไฟล์เทสต์เดิมไม่มี ให้สร้างใน `block3-test-fixtures.ts` ตามนี้** (review round 2 item 3):

```ts
import { buildZReport, cashInputsFromMovements, zReportHash, type ZChainWarning, type ZSnapshot } from '@dayo/domain'
import type { ZReportDto } from '../api/types'
export const CHAIN_WARNING: ZChainWarning = {
  brokenShiftId: 's0', storedGrandTotalSatang: null, recomputedGrandTotalSatang: 0, acknowledgedBy: 'u1', unreadableZs: [], duplicateZNos: [], duplicateZNosTruncated: false,
  missingZNos: [], missingZNosTruncated: false, deletedShiftIds: [], deletedShiftIdsTruncated: false, zNoGap: 0,
}
/** A real Z (float ฿500 + one ฿45 cash bill, counted ฿545, local-only shape) with `over` laid on top; the hash matches what is shown. */
export function zDto(over: Partial<ZSnapshot> = {}): ZReportDto {
  const { snapshot } = buildZReport({
    shiftId: 's1', businessDate: '2026-09-25', deviceId: 'd1', zNo: 1, openedAt: '2026-09-25T03:00:00.000Z', openedBy: 'u1', openedQuick: false,
    countedAt: '2026-09-25T05:00:00.000Z', closedAt: '2026-09-25T05:05:00.000Z', closedBy: 'u2', countedBy: 'u1', sales: SALES_45,
    cash: cashInputsFromMovements(50_000, 4_500, []), countLines: [{ denominationSatang: 100, count: 545 }], countedCashSatang: 54_500,
    varianceAlertSatang: 2_000, varianceReason: null, voids: [], bankQrTotalSatang: null, chainWarning: null, botWindow: null, botBills: [],
  }, null)
  const snap: ZSnapshot = { ...snapshot, ...over }
  return { id: 'z1', shiftId: 's1', createdAt: snap.closedAt, hash: zReportHash(snap), hashOk: true, snapshot: snap }
}
```

เทสต์:

```tsx
it('a block 3 Z lists its bot bills and the window', async () => {
  render(<ZReportScreen shiftId="s1" />, { api: { getZReport: vi.fn(async () => zDto({ botWindow: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T05:00:00.000Z' }, botBills: [{ orderNo: 'L260925-901', version: 1, source: 'line', soldAt: null, totalSatang: 7_000, createdByName: null }], cash: { ...zDto().snapshot!.cash, botCashSatang: 7_000 } })) } })
  expect(await screen.findByTestId('z-bot-bill-L260925-901')).toHaveTextContent('70.00')
  expect(screen.getByTestId('z-bot-window')).toHaveTextContent('00:00')
})
it('a Z from before block 3 (no botBills/botWindow/botCashSatang) still renders', async () => {
  const old = zDto(); const snap = { ...old.snapshot! } as Record<string, unknown>
  delete snap['botBills']; delete snap['botWindow']; delete (snap['cash'] as Record<string, unknown>)['botCashSatang']
  render(<ZReportScreen shiftId="s1" />, { api: { getZReport: vi.fn(async () => ({ ...old, snapshot: snap })) } })
  expect(await screen.findByTestId('z-report')).toBeVisible()
  expect(screen.queryByTestId('z-bot-window')).toBeNull()
})
it('a Z continued from dayo names the central Z (R9)', async () => {
  render(<ZReportScreen shiftId="s1" />, { api: { getZReport: vi.fn(async () => zDto({ zNo: 42, chainWarning: { ...CHAIN_WARNING, brokenShiftId: 'central', centralLastZ: { zNo: 41, hash: 'ab'.repeat(32) } } })) } })
  expect(await screen.findByTestId('z-central-continued')).toHaveTextContent('41')
})
```

(`TH.zWaitingBanner` รับวันที่ที่จัดรูปแล้วด้วย `formatThaiDate` ของ `ui/format.ts` — ถ้าไม่มีฟังก์ชันชื่อนี้บน `main` ให้สร้างใน `ui/format.ts`: `'2026-09-25'` → `'25 ก.ย. 2569'` (วัน · เดือนย่อไทย · พ.ศ.) พร้อมเทสต์ใน `ui/format.test.ts`)

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos exec vitest run src/screens/CloseShiftScreen.test.tsx src/screens/IssueZScreen.test.tsx src/screens/StatusBanners.test.tsx src/screens/ZReportScreen.test.tsx`
- [ ] **Step 3: ทำ** — คอมโพเนนต์ตามลำดับหน้าจอข้างบน · เงินแสดงด้วย `formatBaht` เดิม (สตางค์ → ข้อความ) · ไม่คิดเงินเองในหน้าจอ — ส่วนต่างจาก `cashVarianceSatang(counted, summary.expectedCashSatang)` และ `varianceNeedsReason` ของ `@dayo/domain` (review item 8) · route `/shift/z/$shiftId` ส่ง `countedSatang` จาก `bootstrap().zWaiting` · ช่องเหตุผลแสดงเฉพาะเมื่อ `summary.includesBotCash || summary.syncMode === 'local_only'` · `ZReportScreen` อ่านฟิลด์ใหม่แบบ `snapshot.botBills ?? []`, `snapshot.botWindow ?? null`, `snapshot.cash.botCashSatang ?? 0` (Z ก่อนก้อน 3 ไม่มีฟิลด์เหล่านี้)
- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม + `pnpm --filter @dayo/pos test`
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 6: commit** — stage ไฟล์ตาม Files · ข้อความ: `feat(pos): count the drawer blind, then review with bot cash, offline or online`

### Task 16: หน้า "ส่งไม่ผ่าน" ก้อน 3 · ปิดเป็นบิลนอกแคตตาล็อก · แถบ scope/ข้อมูลชน/ไม่ตรง · "Z ล่าสุดในระบบกลาง" ตอนตั้งเครื่อง · ป้ายบนบิล

ผู้ทำ: pos-ui-developer (sonnet) · ผู้ตรวจเพิ่ม: **security-reviewer** (PIN owner · บิลนอกแคตตาล็อก) · สเปก §6.2 (แถบ scope) · §6.4 · §6.6 · §4.10 · D97 · ruling R9, R11, R12, R14 · รอ: Task 13, 14

**Files:**
- Modify: `apps/pos/src/screens/{SyncProblemsScreen,StatusBanners,SetupScreen,OwnerRecoveryScreen,OrderDetailScreen,OrdersScreen}.tsx` (+ `.test.tsx`), `apps/pos/src/ui/th.ts`
- Create: `apps/pos/src/screens/CloseOffCatalogDialog.tsx` (+ `.test.tsx`)

**Interfaces:**
- Consumes: `SyncProblemDto`, `Remedy`, `closeOffCatalog`, `acknowledgeElsewhere`, `reconfirmOwner`, `SyncStatusDto.scopeWait/shiftDataConflict/centralMismatchBills` (Task 14) · `DayoProbe.lastZNo`, `ConnectShopInput.confirmedLastZNo` (Task 13) · `can(role, 'close_off_catalog')` (Task 1)

ข้อความเพิ่มใน `ui/th.ts`:

```ts
  remedyCloseOffCatalog: 'ปิดเป็นบิลนอกแคตตาล็อก',
  remedyAcknowledge: 'รับทราบ — บิลอยู่ในระบบกลางแล้ว',
  remedyReconfirm: 'เจ้าของยืนยันด้วย PIN ใหม่',
  remedyExcludeLocal: 'ปิดไว้ในเครื่อง',
  offCatalogWarning: 'บิลนี้จะเข้าระบบกลางเป็น "บิลนอกแคตตาล็อก": ยอดเงินเท่าเดิม ต้นทุนไม่ทราบ ไม่ตัดสต็อก — ห้ามบันทึกเงินเข้า/ออกเพื่อชดเชย',
  offCatalogBadge: 'นอกแคตตาล็อก',
  offCatalogRuleHint: 'ระบบกลางไม่รับบิลนอกแคตตาล็อกใบนี้ (ไม่มีประวัติถูกปฏิเสธ / ก่อนวันเริ่มใช้กะ / เกินเพดานยอด) — ถ้าเกินเพดาน เจ้าของเพิ่มเพดานบนเว็บ dayo แล้วกด "ลองใหม่"',
  centralMismatchBanner: 'บิลในระบบกลางไม่ตรงกับเครื่อง',
  centralMismatchLine: (orderNo: string, central: string, local: string): string => `${orderNo}: ระบบกลาง ${central} · เครื่อง ${local}`,
  shiftConflictBanner: 'ข้อมูลกะชนกับระบบกลาง — แนะนำให้เจ้าของเปลี่ยนกุญแจเครื่อง',
  scopeBanner: (scope: string): string => `กุญแจเครื่องไม่มีสิทธิ์ ${scope} — เพิ่มสิทธิ์บนเว็บ dayo`,
  voidRejectedHint: (orderNo: string): string => `ให้เจ้าของยกเลิกบิล ${orderNo} บนเว็บ dayo (พร้อมเหตุผล) แล้วกด "ปิดไว้ในเครื่อง"`,
  setupLastZ: (n: number | null): string => (n === null ? 'Z ล่าสุดในระบบกลาง: ยังไม่มี' : `Z ล่าสุดในระบบกลาง: ${n}`),
  setupConfirmLastZ: 'ตรวจแล้ว — ใบปิดกะใบถัดไปของเครื่องนี้จะต่อจากเลขนี้',
```

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — ในไฟล์ `.test.tsx` ที่ระบุ:

`apps/pos/src/screens/SyncProblemsScreen.test.tsx` (เพิ่ม):

```tsx
import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SyncProblemDto } from '../api/types'
import { render } from '../test-utils'
import { TH } from '../ui/th'
import { OWNERS, user } from './block3-test-fixtures'
import { SyncProblemsScreen } from './SyncProblemsScreen'

const problem = (over: Partial<SyncProblemDto> = {}): SyncProblemDto => ({
  outboxId: 'ob1', key: 'order:o1', kind: 'order', orderId: 'o1', shiftId: 's1', receiptNo: 'A-000001', at: '2026-09-25T03:00:00.000Z', reason: 'UNKNOWN_CODE', detail: 'ไม่พบเมนู',
  prefix: null, remedies: ['RETRY', 'REMAP_CODE', 'CLOSE_OFF_CATALOG', 'EXCLUDE'], children: [], waiting: null, hint: null, central: null, centralOrderNo: null, ...over,
})
const apiWith = (rows: SyncProblemDto[]) => ({ listSyncProblems: vi.fn(async () => rows), closeOffCatalog: vi.fn(async () => ({ offCatalogKey: 'order_off_catalog:o1' })), bootstrap: vi.fn(async () => ({ users: OWNERS })) })
const owner = { userId: 'u1', role: 'owner' as const }

describe('SyncProblemsScreen — block 3 (spec 04 §6.4)', () => {
  it('shows exactly the buttons the row carries', async () => {
    render(<SyncProblemsScreen />, { api: apiWith([problem({ reason: 'CONFLICT', prefix: 'exists:', remedies: ['ACKNOWLEDGE_ELSEWHERE', 'EXCLUDE'] })]), session: owner })
    const row = await screen.findByTestId('problem-ob1')
    expect(within(row).getByTestId('remedy-acknowledge')).toHaveTextContent(TH.remedyAcknowledge)
    expect(within(row).getByTestId('remedy-exclude')).toHaveTextContent(TH.remedyExcludeLocal)
    expect(within(row).queryByTestId('remedy-close-off-catalog')).toBeNull()
    expect(within(row).queryByTestId('remedy-retry')).toBeNull()
  })
  it('"ปิดเป็นบิลนอกแคตตาล็อก" warns, needs a reason and the owner PIN, then calls closeOffCatalog', async () => {
    const api = apiWith([problem()])
    render(<SyncProblemsScreen />, { api, session: owner })
    await user.click(await screen.findByTestId('remedy-close-off-catalog'))
    const dialog = await screen.findByTestId('off-catalog-dialog')
    expect(dialog).toHaveTextContent(TH.offCatalogWarning)
    expect(within(dialog).getByTestId('off-catalog-confirm')).toBeDisabled()
    await user.type(within(dialog).getByTestId('off-catalog-reason'), 'เมนูถูกลบในระบบกลาง')
    await user.click(within(dialog).getByTestId('count-approver-TungAo'))
    for (const d of '1111') await user.click(within(dialog).getByTestId(`pin-${d}`))
    await user.click(within(dialog).getByTestId('off-catalog-confirm'))
    expect(api.closeOffCatalog).toHaveBeenCalledWith({ approverUserId: 'u1', approverPin: '1111', reason: 'เมนูถูกลบในระบบกลาง', outboxId: 'ob1' })
  })
  it('a manager never sees "ปิดเป็นบิลนอกแคตตาล็อก", even when the row offers it (can)', async () => {
    render(<SyncProblemsScreen />, { api: apiWith([problem()]), session: { userId: 'm1', role: 'manager' } })
    await screen.findByTestId('problem-ob1')
    expect(screen.queryByTestId('remedy-close-off-catalog')).toBeNull()
  })
  it('an exists: row shows dayo\'s order number and "ไม่ตรง" when the totals differ (m2)', async () => {
    render(<SyncProblemsScreen />, { api: apiWith([problem({ reason: 'CONFLICT', prefix: 'exists:', remedies: ['ACKNOWLEDGE_ELSEWHERE', 'EXCLUDE'], central: { orderNo: 'L260925-014', reportedTotalSatang: 4_000, paymentIsCash: false, matchesLocal: false } })]), session: owner })
    const row = await screen.findByTestId('problem-ob1')
    expect(row).toHaveTextContent('L260925-014')
    expect(within(row).getByTestId('problem-central-mismatch')).toBeVisible()
  })
  it('a rejected void tells the owner which bill to cancel on the web', async () => {
    render(<SyncProblemsScreen />, { api: apiWith([problem({ kind: 'order_void', key: 'order_void:o1', reason: 'FORBIDDEN', prefix: 'rule:', remedies: ['EXCLUDE'], hint: 'void_rejected', centralOrderNo: 'L260925-014' })]), session: owner })
    expect(await screen.findByText(TH.voidRejectedHint('L260925-014'))).toBeVisible()
  })
  it('a scope wait of 7 days shows as a waiting card with "ปิดไว้ในเครื่อง" only', async () => {
    render(<SyncProblemsScreen />, { api: apiWith([problem({ kind: 'shift_open', key: 'shift_open:s1', orderId: null, receiptNo: null, reason: 'FORBIDDEN', prefix: 'scope:', remedies: ['EXCLUDE'], waiting: 'scope' })]), session: owner })
    const row = await screen.findByTestId('problem-ob1')
    expect(within(row).getByTestId('problem-waiting-scope')).toBeVisible()
    expect(within(row).getAllByRole('button').map((b) => b.getAttribute('data-testid'))).toEqual(['remedy-exclude', 'problem-export'])
  })
  it('a shift conflict (CONFLICT counted: or INVALID data_conflict:) shows the change-key card (R12 · R5-2)', async () => {
    render(<SyncProblemsScreen />, { api: apiWith([problem({ kind: 'shift_close', key: 'shift_close:s1', orderId: null, reason: 'INVALID', prefix: 'data_conflict:', remedies: ['EXCLUDE'], hint: 'shift_conflict' })]), session: owner })
    expect(await screen.findByTestId('problem-hint-shift-conflict')).toHaveTextContent(TH.shiftConflictBanner)
  })
})
```

`apps/pos/src/screens/StatusBanners.test.tsx` (เพิ่ม) · ตัวช่วย `status(over)` — **ถ้าไม่มี ให้สร้างใน `block3-test-fixtures.ts` ตามนี้** (ช่องตาม `SyncStatusDto` ของก้อน 2 T14 + Task 14 · ถ้า `main` มีช่องเพิ่ม typecheck จะบอก — ใส่ค่า "ปกติ" ของช่องนั้น):

```ts
import type { SyncStatusDto } from '../api/types'
export function status(over: Partial<SyncStatusDto> = {}): SyncStatusDto {
  return {
    linked: true, apiState: 'ok', maskedKey: 'dayo_…abcd', baseUrl: 'http://localhost:8787/api/v1', clockSkewMs: 0, clockWarning: false,
    pricingMismatch: false, pricingCommit: null, catalogVersion: 42, catalogCheckedAt: '2026-09-25T03:00:00.000Z', catalogError: null,
    lastPushAt: '2026-09-25T03:00:00.000Z', pendingBills: 0, problemBills: 0, oldestPendingAt: null, pendingOver24h: false, priceDiffBills: 0,
    clockFarAheadBills: 0, scopeWait: null, shiftDataConflict: false, centralMismatchBills: 0, ...over,
  }
}
```

เทสต์:

```tsx
it('scope bar: yellow at first, red after 24 h, owner only (m1)', async () => {
  const api = { syncStatus: vi.fn(async () => status({ scopeWait: { scope: 'shift:write', since: '2026-09-25T03:00:00.000Z', red: false, closable: false } })), bootstrap: vi.fn(async () => ({ users: OWNERS, zWaiting: [] })) }
  const { unmount } = render(<StatusBanners />, { api, session: { userId: 'u1', role: 'owner' } })
  expect(await screen.findByTestId('banner-scope')).toHaveAttribute('data-level', 'warn')
  expect(screen.getByTestId('banner-scope')).toHaveTextContent(TH.scopeBanner('shift:write'))
  unmount()
  api.syncStatus.mockResolvedValue(status({ scopeWait: { scope: 'shift:write', since: '2026-09-24T03:00:00.000Z', red: true, closable: false } }))
  render(<StatusBanners />, { api, session: { userId: 'u1', role: 'owner' } })
  expect(await screen.findByTestId('banner-scope')).toHaveAttribute('data-level', 'error')
  render(<StatusBanners />, { api, session: { userId: 's1', role: 'staff' } })
  expect(screen.getAllByTestId('banner-scope')).toHaveLength(1)            // the staff render adds none
})
it('shift data conflict and central mismatch are red bars for the owner (S5 · m2)', async () => {
  render(<StatusBanners />, { api: { syncStatus: vi.fn(async () => status({ shiftDataConflict: true, centralMismatchBills: 2 })), bootstrap: vi.fn(async () => ({ users: OWNERS, zWaiting: [] })) }, session: { userId: 'u1', role: 'owner' } })
  expect(await screen.findByTestId('banner-shift-conflict')).toHaveTextContent(TH.shiftConflictBanner)
  expect(screen.getByTestId('banner-central-mismatch')).toHaveTextContent(TH.centralMismatchBanner)
})
```

`apps/pos/src/screens/SetupScreen.test.tsx` (เพิ่ม · `probe` = ค่าคงที่เดิมของไฟล์):

```tsx
async function fillAndProbe(api: Record<string, unknown>) {
  render(<SetupScreen />, { api })
  await user.type(screen.getByTestId('setup-api-key'), `dayo_${'0'.repeat(64)}`)
  await user.click(screen.getByTestId('setup-probe'))
  await screen.findByTestId('setup-client-name')
  await user.click(screen.getByTestId('setup-owner-TungAo'))
  await user.type(screen.getByTestId('setup-prefix'), 'A')
  await user.type(screen.getByTestId('setup-pin'), '1111'); await user.type(screen.getByTestId('setup-pin2'), '1111')
  await user.type(screen.getByTestId('setup-promptpay'), '0812345678')
}
it('shows "Z ล่าสุดในระบบกลาง" and needs the owner\'s tick before saving (R9)', async () => {
  const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: false, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => ({ ...probe, requiredPrefix: null, lastReceiptNo: null, lastZNo: 41 })), connectShop: vi.fn(async () => undefined) }
  await fillAndProbe(api)
  expect(screen.getByTestId('setup-last-z')).toHaveTextContent(TH.setupLastZ(41))
  expect(screen.getByTestId('setup-save')).toBeDisabled()
  await user.click(screen.getByTestId('setup-last-z-confirm'))
  await user.click(screen.getByTestId('setup-save'))
  expect(api.connectShop).toHaveBeenCalledWith(expect.objectContaining({ confirmedLastZNo: 41 }))
})
it('no Z in dayo: "ยังไม่มี", no tick, confirmedLastZNo: null', async () => {
  const api = { bootstrap: vi.fn(async () => ({ needsSetup: true, legacyDevice: false, users: [], staffNeedingPin: [] })), probeDayo: vi.fn(async () => ({ ...probe, requiredPrefix: null, lastReceiptNo: null, lastZNo: null })), connectShop: vi.fn(async () => undefined) }
  await fillAndProbe(api)
  expect(screen.getByTestId('setup-last-z')).toHaveTextContent(TH.setupLastZ(null))
  expect(screen.queryByTestId('setup-last-z-confirm')).toBeNull()
  await user.click(screen.getByTestId('setup-save'))
  expect(api.connectShop).toHaveBeenCalledWith(expect.objectContaining({ confirmedLastZNo: null }))
})
```

`apps/pos/src/screens/OrderDetailScreen.test.tsx` (เพิ่ม) · ตัวช่วย `detail(over)` — **ถ้าไม่มี ให้สร้างใน `block3-test-fixtures.ts` ตามนี้** (ช่องที่รู้จากแผน 07 T12d/T15 + Task 14 · `as OrderDetailDto` เพราะรูปเต็มของก้อน 2 อยู่บน `main` — ถ้าหน้าจออ่านช่องอื่นที่ไม่มีในนี้ ให้เพิ่มช่องนั้นด้วยค่ากลาง):

```ts
import type { OrderDetailDto } from '../api/types'
export function detail(over: Partial<OrderDetailDto> = {}): OrderDetailDto {
  return {
    id: 'o1', receiptNo: 'A-000001', queueNo: 1, status: 'paid', businessDate: '2026-09-25', soldAt: '2026-09-25T03:00:00.000Z', channelCode: 'store', catalogVersion: 42,
    subtotalSatang: 4_500, discountSatang: 0, totalSatang: 4_500, payments: [{ method: 'PROMPTPAY', amountSatang: 4_500 }], lines: [], promotions: [],
    soldById: 'u1', soldByName: 'TungAo', voidable: true, dayoEdit: null, offCatalog: false, centralMismatch: null,
    central: { state: 'sent', orderNo: 'L260925-014', computedTotalSatang: 4_500, diffSatang: 0, duplicateOf: [], reason: null, voidState: 'none' },
    ...over,
  } as OrderDetailDto
}
```

เทสต์:

```tsx
it('an off-catalog bill carries the badge; a central mismatch is shown read-only', async () => {
  render(<OrderDetailScreen orderId="o1" />, { api: { getOrder: vi.fn(async () => detail({ offCatalog: true, centralMismatch: { orderNo: 'L260925-014', reportedTotalSatang: 4_000, paymentIsCash: false, localTotalSatang: 4_500, localPaymentIsCash: false } })) }, session: { userId: 'u1', role: 'owner' } })
  expect(await screen.findByTestId('order-off-catalog-badge')).toHaveTextContent(TH.offCatalogBadge)
  expect(screen.getByTestId('order-central-mismatch')).toHaveTextContent(TH.centralMismatchLine('L260925-014', '40.00', '45.00'))
  expect(screen.queryByTestId('order-edit')).toBeNull()
})
```

- [ ] **Step 2: รันให้ล้ม** — `pnpm --filter @dayo/pos exec vitest run src/screens`
- [ ] **Step 3: ทำ** — ปุ่มแสดงจาก `problem.remedies` เท่านั้น (หน้าจอไม่ตัดสินเอง) และซ่อน `CLOSE_OFF_CATALOG` เมื่อ `!can(role, 'close_off_catalog')` · ทุกปุ่มที่แก้ข้อมูลเปิด dialog PIN owner + เหตุผลของก้อน 2 · `EXCLUDE` ยืนยันสองชั้น (คำเตือน "ยอดนี้จะไม่ถึงระบบกลาง") แบบก้อน 2 · แถบทั้งหมดแสดงเฉพาะ `can(role, 'sync_problems')` · SetupScreen/OwnerRecoveryScreen: บรรทัด `setup-last-z` หลังทดสอบกุญแจ · checkbox `setup-last-z-confirm` บังคับเมื่อ `lastZNo !== null` · ส่ง `confirmedLastZNo: probe.lastZNo`
- [ ] **Step 4: รันให้ผ่าน** — `pnpm --filter @dayo/pos test`
- [ ] **Step 5: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 6: commit** — stage ไฟล์ตาม Files · ข้อความ: `feat(pos): show block 3 sync remedies, off-catalog closing and central Z on setup`

### Task 17: e2e ก้อน 3 กับ mock (เกณฑ์ §9 ก้อน 3 ฝั่งแท็บเล็ต)

ผู้ทำ: pos-ui-developer (sonnet) · สเปก §9 ก้อน 3 · รอ: Task 8, 15, 16

**Files:**
- Create: `apps/pos/e2e/block3-shift-online.spec.ts`, `apps/pos/e2e/block3-shift-offline.spec.ts`, `apps/pos/e2e/block3-off-catalog.spec.ts`, `apps/pos/e2e/block3-scope-reinstall.spec.ts`
- Modify: `apps/pos/e2e/helpers.ts` (`mockControl(page, path, body)` → `fetch('http://localhost:8787/__mock/…')` · `setupDevice` ติ๊ก `setup-last-z-confirm` เมื่อเห็น · `countAndConfirm(page, baht, { reason?, pin })`), `apps/pos/e2e/close-shift.spec.ts` (ขั้นตอนใหม่ของ Task 15)

**Interfaces:**
- Consumes: mock control `/__mock/{reset,block3,scopes,seed-orders,override,preload-z,off-catalog-cap,block3-live-from,state}` (Task 6, 8) · testid ของ Task 15–16

- [ ] **Step 1: เขียน spec** — แต่ละไฟล์ `test.beforeEach`: `/__mock/reset` แล้ว `/__mock/block3 {on:true}` · `test.afterEach`: `/__mock/reset`

| spec | ขั้นตอน | ตรวจ |
|---|---|---|
| `block3-shift-online` | ตั้งเครื่อง → เปิดกะ ฿500 → ขาย Cocoa เงินสด ×2 → จ่ายออก ฿20 "น้ำแข็ง" → ยกเลิกบิลเงินสด 1 ใบ (คืนเงิน) → seed บิลบอทเงินสด 3 ใบ (฿70, ฿35, ฿50) → นับ 9 ชนิดแบบไม่เห็นยอด → นับเสร็จ | ยอดที่ควรมี = 500 + 90 − 45 − 20 + 155 = ฿680.00 แสดงบิลบอท 3 ใบ · นับ ฿680 → PIN DCm → หน้า Z แสดงบรรทัดบิลบอท · รอส่งเสร็จ → `/__mock/state` `zReports[0].recomputeStatus === 'matched'` และไม่มีแถวค้าง |
| (ต่อในไฟล์เดียวกัน) เกณฑ์ D102 | กะใหม่ ขาดพอดี ฿20.00 | ช่องเหตุผลบังคับ · ขาด ฿19.00 ไม่ถาม |
| `block3-shift-offline` | ขาย → `context.setOffline(true)` → นับเสร็จ | ป้าย "ยังไม่รวมบิลเงินสดจากบอท" · ไม่มีช่องเหตุผล · PIN → "บันทึกการนับแล้ว" · แถบ `banner-z-waiting` · เปิดกะใหม่ได้ · ขาย 1 บิล → `setOffline(false)` → ปุ่ม `z-issue` → ยอดรวมบิลบอท → PIN → Z ออก · แถบหาย · `/__mock/state`: ทุกแถวของทั้งสองกะรับแล้ว ไม่มี `CONFLICT` · Z `matched` |
| `block3-off-catalog` | `/__mock/block3-live-from {date:'2026-09-01'}` · override แถว `order` ของบิลถัดไป `rejected UNKNOWN_CODE` → ขาย → หน้า "ส่งไม่ผ่าน" (owner) | ปุ่ม "ปิดเป็นบิลนอกแคตตาล็อก" → คำเตือน → เหตุผล + PIN → แถวหายจากหน้า · บิลมีป้าย "นอกแคตตาล็อก" · mock มีบิล `off_catalog` · ปิดกะ → Z `matched` · manager ไม่เห็นปุ่ม |
| (ต่อ) `exists:` | override `order_off_catalog` → `CONFLICT exists:` + `data` ยอดต่าง | ปุ่ม "รับทราบ" → PIN → แถบแดง "บิลในระบบกลางไม่ตรงกับเครื่อง" |
| `block3-scope-reinstall` | `/__mock/scopes` ไม่มี `shift:write` → เปิดกะ + ขาย | บิลส่งผ่าน · แถวกะไม่ขึ้นหน้า "ส่งไม่ผ่าน" · แถบ scope (เหลือง) · เพิ่ม scope → รอรอบส่ง (ปุ่ม "ส่งตอนนี้") → แถบหาย · (ส่วน reinstall) `/__mock/preload-z {zNo:41,…}` ก่อนตั้งเครื่อง → หน้าตั้งเครื่องแสดง "Z ล่าสุดในระบบกลาง: 41" + ต้องติ๊ก → ปิดกะแรก → ขอ PIN รับทราบ (`zChainCentral`) → Z เลข 42 · `/__mock/state` ไม่มี `z_no_taken` |

- [ ] **Step 2: รัน** — `pnpm --filter @dayo/pos e2e` · คาด ผ่านทุก spec (รวม spec ก้อน 2 ที่ `block3` ปิด)
- [ ] **Step 3: ทั้ง repo** — `pnpm turbo run typecheck test`
- [ ] **Step 4: commit** — stage ไฟล์ตาม Files · ข้อความ: `test(pos): cover block 3 shifts, offline counts and off-catalog bills end to end`

---

## 7. ท้ายก้อน

### Task 18: ตรวจทั้งก้อน แล้ว merge

ผู้ทำ: หัวหน้า · ผู้ตรวจ: code-reviewer (sonnet) + **security-reviewer (opus)** บน diff `main..block-3-pos` ทั้งก้อน · รอ: Task 1–17

- [ ] **Step 1**: `git status` สะอาดทุก worktree (`../pos-b3-{domain,contract,sync,device,screens}` และ worktree ของ `block-3-pos`) · `pnpm turbo run typecheck test` · `pnpm --filter @dayo/pos e2e` ผ่าน
- [ ] **Step 2**: ผู้ตรวจสองคนได้ package: สเปก §4.10/§6 · แผนนี้ · ledger (Ruling ทั้งหมด) · รายการตรวจบังคับ: (ก) ไม่มีการบวกบาท float ใน `apps/pos` (`grep -rn "edgeSatangToBaht\|edgeBahtToSatang" apps/pos/src` มีแค่ใน `bot-cash.ts`, `sync-problems.ts` (เทียบ exists:), `push.ts`) (ข) ทุกทางแก้ที่เขียนข้อมูลตรวจ PIN owner + `can` ที่ API (ค) `result_json`/`last_error`/ไฟล์ส่งออก ไม่มี API key (ง) แถว `sent` ไม่เคยถูกแก้ `row_json` (จ) trigger แช่แข็งครบ (ฉ) `closed_off_catalog`/`local_only` ไม่ถูกส่ง (ช) Z ในเครื่องไม่ถูกแก้หลังออก (`RECEIPT_RENUMBERED`/`CODE_REMAPPED`)
- [ ] **Step 3**: แก้ 1 รอบ → ตรวจซ้ำเฉพาะจุด → `git merge --no-ff block-3-pos` เข้า `main` (ข้อความ `merge: block 3 shifts, cash counts and off-catalog bills on the tablet`) → `pnpm turbo run typecheck test` บน `main` → push (เจ้าของอนุญาตแล้ว — กฎเหล็ก 10)
- [ ] **Step 4**: docs-writer บันทึกใน `docs/design/00-บันทึกการตัดสินใจ.md`: **D ใหม่หนึ่งข้อสำหรับ R3 (`counted_at` ไม่ย้อนก่อนแถวของกะ) · R4 (เกณฑ์อย่างน้อย 1 สตางค์ · ทางเขียนค่าตั้งต้องปฏิเสธ < 1 สตางค์) · R6 (Z ของกะ `local_only` ไม่รวมบิลบอท)** (review item 11) · Ruling อื่น R1–R20 เป็น D ใหม่ตามที่หัวหน้าเห็นควร (ถามเจ้าของเฉพาะที่เจ้าของต้องตัดสิน) · ปิด/เปิดเรื่องค้าง Q72–Q74 · คำวินิจฉัยผู้คุมงาน R5-1 (`last_z_until`) · R5-2 (`data_conflict:`) · R5-3 (กัก Z ที่ผิดลำดับ)

### Task 19: เชื่อมจริงกับ dayo local (หลังแผน 08 ship)

ผู้ทำ: หัวหน้า + sync-engineer (opus) + เจ้าของ · รอ: แผน 08 ของ dayo merge + deploy dev · dayo รับ ADR-0056

- [ ] **Step 1**: เจ้าของเปิด Supabase local + `npm run dev:web` ของ dayo (`API_V1_ENABLED=1` เฉพาะเครื่อง dev) · สร้างกุญแจที่มี `shift:write` (agent ไม่เห็นค่าลับ)
- [ ] **Step 2**: แทน fixture 11 ไฟล์ของ Task 7 ด้วยคำตอบจริง (ต่าง = แก้ fixture ให้ตรงของจริงแล้วแก้โค้ด · §4.11) · `fixtures:hashes`
- [ ] **Step 3**: รันเกณฑ์ §9 ก้อน 3 ส่วนที่ต้องใช้ dayo จริง: ปิดกะที่มีบิลเงินสดบอท 3 ใบ → `matched` · ขายออฟไลน์ทั้งกะ → `waiting_bills` → `matched` · บิลนอกแคตตาล็อกครบวง · `supported_fields` ของ E1 = `BLOCK3_SUPPORTED_FIELDS` · parity: `pos-shift-cash-parity.json` ผ่านฟังก์ชันคิดซ้ำของ dayo ทุกเคส (แผน 08 รันฝั่งนั้น)
- [ ] **Step 4**: การเปิดใช้แท็บเล็ตขายจริง = แผนเปิดใช้งาน (D94 · D95 · D86 สำรองอัตโนมัติ · D51 แท็บเล็ตจริง) — ไม่อยู่ในแผนนี้

---

## 8. ตรวจแผนเทียบสเปก (self-review)

| สิ่งที่ต้องมี (สเปก/คำสั่ง) | Task |
|---|---|
| zod 5 ชนิดใหม่ · ผลรับ · คำนำหน้า · E1 `last_z_*` · E4 · ถอด `ALREADY_PRESENT` | 5 |
| fixture สัญญาก้อน 3 + parity (D84) | 5 (parity) · 7 |
| mock: ชนิดใหม่ · `scope:` · กติกา `z_no` 0–6 · กัก Z ที่ผิดลำดับ (R5-3) · E4 · คิดซ้ำพอสำหรับเทสต์ · บิลนอกแคตตาล็อก · `pos_push_rejections` | 6 · 8 |
| ทุกแถว `order` ที่ส่งไม่ผ่านมีทางออกเสมอ ("ปิดไว้ในเครื่อง" ท้ายสุด) · ช่องกะปิดเมื่อก้อนเต็ม · สรุปยอดกติกาเดียวทั้งจอและตัวเขียน | 14 · 10 · 12 · 15 |
| ฐานในเครื่อง: สถานะกะ · `sync_mode` · `counted_at` · `includes_bot_cash` · กะละการนับ · trigger · `closed_off_catalog` | 9 (+ enum 5) |
| สูตร `botCash`/`drawerExpenses` (ก้อน 3 = 0) · `≥` · parity รวมติดลบ · `prev_hash`/`chain_warning` | 2 · 3 · 4 · 12 |
| ช่องกะหนึ่งช่อง · ลูกรอแม่ · `PARENT_REJECTED` กลับ `pending` เอง | 10 · 14 (ย้ายแม่ตอนปิดนอกแคตตาล็อก) |
| `scope:` 15 นาที · แดง 24 ชม. · ปิดไว้ในเครื่อง 7 วัน | 10 · 14 · 16 |
| D101: `counted_at` แช่แข็ง · ออนไลน์/ออฟไลน์ · Z เมื่อออนไลน์ · E4 `after` = การนับก่อนในเครื่อง | 12 · 15 |
| เลข Z ต่อจาก E1 + ทาง D55 + หน้าตั้งเครื่องแสดง/ยืนยัน | 13 · 16 |
| `order_off_catalog` จากหน้า "ส่งไม่ผ่าน" (owner · PIN · เหตุผล · รายการแช่แข็ง) | 3 · 14 · 16 |
| ปุ่มตามคำนำหน้า `exists:` `off_catalog_exists:` `receipt_taken:` `key_changed:` `counted:` `z_no_taken:` `data_conflict:` `scope:` `role:` `rule:` · เทียบข้อมูล · แถบแดง | 5 · 6 · 14 · 16 |
| `CODE_REMAPPED` ห้ามสลับเงินสด | 14 |
| `local_only` ของกะก่อนก้อน 3 | 9 (migration) · 11 (R1) · 12 (R6) |
| ข้อความไทย · ความเป็นเจ้าของ `ui/errors.ts`/`th.ts` | 1 · 15 · 16 |
| สิทธิ์ผ่าน `can()` | 1 · 14 · 16 |
| e2e กับ mock · ตรวจทั้งก้อน | 17 · 18 |
| Q72 / Q73 / Q74 ค่าเริ่มต้น | §0.3 · 7 · 8 · 14 (ติดป้าย "รอ Q72") |

**ไม่มีตัวแทนค่า (placeholder)** — ตรวจหลังรีวิวรอบแผน: เทสต์หน่วยและเทสต์หน้าจอทุกข้อเป็นโค้ดเต็ม (`grep ", …)"` ในแผนไม่เจอ) รวม `block3-flow.test.ts` (waiting_bills → matched) · `z-chain.test.ts` ข้อ 0–5 + R5-3 · `recompute.test.ts` (ลำดับ R3-A + ข้อ 6) · `off-catalog.test.ts` · `count.ts` ทั้งไฟล์ · **ส่วนที่แผนกำหนดเป็นตารางค่าที่ตายตัวแทนโค้ด (ตั้งใจ ไม่ใช่ตัวแทนค่า)**: เนื้อ JSON 11 ไฟล์ของ Task 7 (ทุกไฟล์มีคำขอ/คำตัดสิน/คำนำหน้า/`data` ในตาราง) และ `arrangeBlock3` ของไฟล์นั้น · สเปก e2e 4 ไฟล์ของ Task 17 (ขั้นตอนและค่าที่ตรวจทุกข้อในตาราง) · ตัวเลขเงินทุกตัวในแผนคิดจากสถานการณ์ในเทสต์ (ไม่มีตัวเลขที่ไม่มีที่มา) · ค่า ฿3,000 เป็นค่าเริ่มต้นของสเปก (รอ Q72)

**ชื่อสอดคล้องกัน** (เพิ่มหลังรีวิว: `cashVarianceSatang` · `BatchBudget`/`picker.full()` · `botCashError` · `centralContinuation` · `CentralZ.lastZUntil` · `chainOf`/`MockZ.quarantined` · `ShiftCashParityFile` · `WaitingZDto.countedSatang` · `BootstrapState.centralLastZNo` · `SyncProblemDto.centralOrderNo`): `CashInputs.botCashSatang/drawerExpensesSatang` · `ZInput.countedAt/botWindow/botBills` · `ZChainWarning.centralLastZ` · `buildShiftOpenRowData/buildCashMovementRowData/buildCashCountRowData/buildShiftCloseRowData/buildOffCatalogRowData` · `PushRowInput` 7 ชนิด · `shiftParentKey/countParentKey` · `createLanePicker/releaseChildren/SCOPE_*` · `finishCount/countSummary/fetchBotCash/confirmCount/issueZ/writeZ` · `BotCashDto/CountSummaryDto/ZSettle/ConfirmCountInput/IssueZInput/WaitingZDto` · `centralZOf/DAYO_KEYS.lastZNo/lastZHash/confirmedLastZNo` · `Remedy` + `CLOSE_OFF_CATALOG/ACKNOWLEDGE_ELSEWHERE/RECONFIRM_OWNER` · `closeOffCatalog/acknowledgeElsewhere/reconfirmOwner` — ใช้ชื่อเดียวกันทุก task ที่อ้าง

**ความเสี่ยงที่รู้**: (1) ชื่อของก้อน 2 ที่ยังไม่เขียน (T13–T15) อาจต่าง — Step 0 ของแต่ละ task (2) Task 2 แตะ `apps/pos` สองไฟล์ในรอบ 1 (R17) (3) `last_z_until` (§13.8 R5-1) ต้องมาถึงพร้อมแผน 08 — ก่อนหน้านั้น dayo จริงยังไม่ส่งฟิลด์นี้ (`centralZOf` ถือว่าข้อมูลไม่ครบ = `DAYO_Z_STATE_INVALID` เมื่อมี `last_z_no` แต่ไม่มี `last_z_until`)

