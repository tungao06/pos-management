# แผน 3b: pos-shift-close — ปิดกะ · นับเงินแยกชนิด · รายงาน X/Z · ปุ่มสำรองไฟล์ฐานข้อมูล · เปิดกะด่วน — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้แอปขายในเครื่อง (แผน 3) ปิดวันได้ครบก่อนใช้ขายจริง (D48 Q3-17): บันทึกเงินเข้า/จ่ายออก/นำเงินไปเก็บ → ดูรายงาน X สดได้ตลอดกะ → ปิดกะโดยนับธนบัตร/เหรียญแยกชนิด → เห็นยอดที่ควรมีและส่วนต่าง (ต้องใส่เหตุผลถ้าเกินเกณฑ์) → เจ้าของยืนยันด้วย PIN → ได้รายงาน Z ที่แช่แข็งด้วยแฮช (มี grand total สะสม + รายการบิลยกเลิกประจำวัน + เบสติดลบ) → กดสำรองไฟล์ฐานข้อมูลทั้งไฟล์ลงเครื่อง · พร้อม "เปิดกะด่วน" สำหรับเจ้าของ และงานส่งต่อจากแผน 3 (เพดานเหตุผล 200 ตัวอักษร)

**Architecture:** ตรรกะเงินทั้งหมดอยู่ใน `packages/domain/src/shift.ts` (สรุปยอดขายของกะ รวมพร้อมเพย์รับ/โอนคืน/สุทธิ · รวมเงินเข้า-ออกเป็น `CashInputs` ตาม D36 · นับเงินแยกชนิด · เกณฑ์ส่วนต่าง · `buildZReport` ที่ตรวจความสัมพันธ์ของตัวเลขทุกตัวก่อนแช่แข็ง · `recomputeZChain` เมื่อ Z ใบก่อนแฮชไม่ตรง) · ฝั่งแอปเพิ่มเมธอดของ `PosApi` ที่รันใน Worker ตามแบบแผน 3 (1 การกด = 1 transaction: แถวธุรกรรม + outbox) — `recordCashMovement`, `shiftReport` (X), `closeShift` (cash_count + z_report + shift closed), `listZReports`/`getZReport`, `quickOpenShift`, `exportBackup` (อ่านไฟล์ด้วย `pool.exportFile` ของ `opfs-sahpool` ที่ spike I3 พิสูจน์แล้ว ผ่าน `ApiDeps.exportDbFile` — ไม่บันทึกอะไร) + `confirmBackupSaved` (บันทึกเมื่อเจ้าของกด "บันทึกไฟล์แล้ว") · หน้าจอใหม่ 5 หน้า (`/shift` X · `/shift/close` · `/z` · `/z/$shiftId` · `/backup`) + หน้าต่างเงินเข้า-ออก บนหน้าขาย · ปุ่ม "ปิดกะ" อยู่บนหน้าขาย ไม่ผ่านหน้า X และหน้า X ไม่แสดงเงินสดที่ควรมี → นับเงินแบบไม่เห็นยอดจริง (Q3b-3) · ไม่แก้ schema (ตาราง `shift`, `cash_movement`, `cash_count`, `z_report`, `audit_log`, `sync_state` มีครบจากแผน 2)

**Tech Stack:** เหมือนแผน 3 ทุกตัว ไม่เพิ่ม dependency — Node 22 (≥ 22.16) · pnpm 10 · TypeScript ~5.9 · React 19.3.0 · Vite 8.3.0 · @tanstack/react-router 1.170.38 · @tanstack/react-query 5.103.1 · @sqlite.org/sqlite-wasm 3.53.4-build1 (`SAHPoolUtil.exportFile(name): Promise<Uint8Array>`) · drizzle-orm 0.45.2 · comlink 4.4.2 · Vitest 5.0.1 + fast-check · jsdom 30.1.0 · @playwright/test 1.63.0

**Spec:** [../specs/2026-09-17-pos-design.md](../specs/2026-09-17-pos-design.md) §3.1 (`cash.variance_alert_satang`), §3.5 (shift / cash_movement / cash_count / z_report), §4.3 (บิลยกเลิกอยู่ใน gross และแยกเป็นยอดยกเลิก), §4.7 (business_date), §4.8 (กะ / X / Z / เปิดกะด่วน), §5 (หน้าเปิด/ปิดวัน: ตาราง 1000/500/100/50/20/10/5/2/1 · ปิดวันต้อง owner), §6.1–6.2 (outbox), §7 invariant 6 (แฮช Z), §8 (e2e "… → ปิดกะ → Z"), §11 (สำรองด้วย export ไฟล์ SQLite) · การตัดสินใจ: [../../design/00-บันทึกการตัดสินใจ.md](../../design/00-บันทึกการตัดสินใจ.md) โดยเฉพาะ D22, D28, D36, D42–D53 · งานส่งต่อ: [บันทึกการทำแผน 3 §5](2026-09-17-03-บันทึกการทำแผน3.md) และ [บันทึกการทำแผน 1 §4](2026-09-17-01-บันทึกการทำแผน1.md) · ผล spike I3: [2026-09-17-03-ผลspike.md](2026-09-17-03-ผลspike.md) · **คำถามก่อนทำ: [2026-09-17-03b-คำถามก่อนทำ.md](2026-09-17-03b-คำถามก่อนทำ.md) — เจ้าของตอบครบ 13 ข้อแล้ว (19 ก.ย. "เห็นด้วย ทำต่อได้เลย" = ค่าแนะนำทุกข้อ): Q3b-1 … Q3b-10 → D52 · Q3b-11 … Q3b-13 (มาจาก review แผน) → D53** · จุดที่ใช้คำตอบอ้างไว้เป็น `Q3b-N · D52` / `Q3b-N · D53` (ตารางท้ายแผน)

## Global Constraints

- **คำตอบของเจ้าของ:** Q3b-1 … Q3b-10 → D52 · Q3b-11 … Q3b-13 → D53 (ค่าแนะนำทุกข้อ 19 ก.ย.) · โค้ดในแผนเขียนตามคำตอบแล้ว (ตารางท้ายแผน) · ถ้าเจ้าของเปลี่ยนคำตอบภายหลัง ให้แก้จุดในตารางนั้นก่อนทำ task ที่เกี่ยวข้อง และจดในบันทึกการทำแผน
- แผน 3 ต้อง merge อยู่ใน `main` แล้ว (commit `4a858d9` หรือใหม่กว่า) · branch ของแผนนี้คือ `plan-3b-shift-close` แตกจาก `plan-3b-draft` (ซึ่งต่อจาก `main` 4a858d9 และมีแผน/คำถาม/D52) (Task 1 Step 0)
- **ต้องเสร็จก่อนใช้ขายจริง (D48 Q3-17)** · การทดสอบบนแท็บเล็ตจริงของแผนนี้ **ไม่ทำในแผนนี้** — รวมไว้ในรอบทดสอบแท็บเล็ตตอนท้ายสุด (D51) ทุกขั้นที่ต้องใช้แท็บเล็ตมีป้าย ⛔ HAND-OFF เจ้าของร้าน · **agent ห้ามกรอกผลแท็บเล็ตแทน และห้ามอ้างว่าผ่าน**
- เงินเป็น **สตางค์** (integer) · ปริมาณเป็น **milli** · ต้นทุนเป็น **usat** (D33) · ห้ามทศนิยมในการคำนวณเงิน — ข้อความบาทแปลงด้วย `parseBahtInput`, จำนวนใบ/เหรียญแปลงด้วย `parseCountInput` เท่านั้น · ผลรวมเงินที่นับอยู่ในช่วง safe integer (≤ 99,999 ใบ × 9 ชนิด)
- ตรรกะเงิน (สรุปยอด, เงินที่ควรมี, ส่วนต่าง, เกณฑ์, แฮช Z) **ต้องเรียกจาก `@dayo/domain`** ห้ามคำนวณซ้ำในแอป (spec §0 ข้อ 1) · ในแอปทำได้แค่รวมแถวที่อ่านมาแล้วส่งให้ domain
- สูตรเงินสด (D36): `expected = opening + cash_sales − void_refunds + paid_in − paid_out − drops` · `cash_sales` = Σ payment CASH ของบิลที่ได้เลขในกะ **รวมบิลที่ยกเลิกภายหลัง** · `void_refunds` = Σ `VOID_REFUND` · แต่ละแถว `cash_movement` นับครั้งเดียว (`cashInputsFromMovements`)
- **1 การกดของผู้ใช้ = 1 transaction** ที่เขียนแถวธุรกรรม + outbox ครบในคราวเดียว (spec §6.1) · PIN (argon2) ตรวจ **ก่อน** เปิด transaction แบบเดียวกับ `voidOrder`
- **insert อย่างเดียว** · `cash_movement` และ `z_report` มี trigger ของแผน 2 ที่ abort ทุก UPDATE/DELETE — ห้ามเขียนโค้ดที่ UPDATE/DELETE สองตารางนี้ · UPDATE ที่อนุญาตเพิ่มในแผนนี้: `shift.status`/`closed_by`/`closed_at` ตอนปิดกะ (T3b-4) พร้อม outbox key `shift:<id>:closed` และ upsert คีย์ local-only ใน `sync_state` (`local.last_backup_at`, `local.last_backup_z_id`) ตอนเจ้าของยืนยันไฟล์สำรอง — ตารางบัญชียังห้าม UPDATE/DELETE · `cash_count` insert อย่างเดียว · Z **สร้างครั้งเดียว ห้ามคำนวณใหม่** (spec §4.8) — หน้าจอ Z อ่าน snapshot ที่เก็บไว้ และตรวจแฮชทุกครั้งที่อ่าน
- **Z ใบก่อนแฮชไม่ตรง (Q3b-11 · D53)** ไม่บล็อกการปิดกะถาวร: `closeShift` ปฏิเสธด้วย `Z_CHAIN_BROKEN` (ไม่ใช่ `BAD_INPUT`) จนกว่าเจ้าของกรอก PIN ซ้ำเพื่อรับทราบ แล้ว Z ใหม่ต่อยอดจาก grand total ที่ **คำนวณใหม่** จาก snapshot ทุกใบเรียงตาม `zNo` (ไม่ใช่ค่าที่เก็บไว้) + ธง `chainWarning` ถาวรใน snapshot + แถว `audit_log` `z_chain_broken_ack`
- **ไฟล์สำรอง (Q3b-13 · D53):** ในไฟล์มี `pin_hash` และหมายเลขพร้อมเพย์ของร้าน — เจ้าของยอมรับ ไม่เข้ารหัส แต่ `exportBackup`/`confirmBackupSaved` ให้เฉพาะเจ้าของ (`NOT_OWNER`) และหน้า `/backup` ไม่แสดงปุ่มดาวน์โหลดให้คนที่ไม่ใช่เจ้าของ · การสำรองนับว่าเสร็จเมื่อเจ้าของกด "บันทึกไฟล์แล้ว" หลังเห็นไฟล์ ไม่ใช่ตอน export (Q3b-7 · review I-4)
- event ของบิลยังเขียนผ่าน `appendOrderEvents` (โซ่แฮช + outbox ใน transaction เดียว — D38) เท่านั้น · แผนนี้ **ไม่เพิ่ม event ของบิล** · การเปิดกะด่วนบันทึกเป็น `audit_log` + ธงใน Z (Q3b-10 · D52)
- CHECK ของแผน 2 ที่แผนนี้ต้องเคารพ: `cash_movement` — `(kind = 'VOID_REFUND') = (order_id is not null)` และ `amount_satang > 0` → `PAID_IN`/`PAID_OUT`/`DROP` ใส่ `orderId: null` และยอด > 0 เสมอ · `z_report.shift_id` unique → ปิดกะเดียวกันซ้ำไม่ได้ · partial unique `shift_open_uq` → เปิดกะได้ครั้งละหนึ่งต่อเครื่อง
- ค่า enum เป็นชนิดแคบ (`textEnum`) → แถวที่สร้างก่อน insert เขียน `satisfies typeof s.<table>.$inferInsert` · ห้าม cast enum ด้วย `as`
- เหตุผลที่คนพิมพ์ (void · ส่วนลด · ส่วนต่างเงินสด · เงินเข้า-ออก) ต้องไม่ว่างหลัง trim และยาว **ไม่เกิน 200 ตัวอักษร** (`REASON_MAX_LENGTH` — งานส่งต่อ Task 13 M-4) ทั้งที่ API และ `maxLength` ของช่อง input
- ข้อความภาษาไทยบนจอทั้งหมดอยู่ใน `apps/pos/src/ui/th.ts` · e2e อ้าง `data-testid` ไม่อ้างข้อความ · error ใหม่ทุกตัวต้องมีข้อความไทยใน `ui/errors.ts` (`Record<PosErrorCode, string>` บังคับด้วย type)
- แบรนด์ (D44/D50 Q3-23): สีทั้งหมดผ่าน token ใน `styles.css` เท่านั้น (ห้ามใส่ hex ใหม่) · ปุ่มแตะสูง ≥ 64 px (ค่าเริ่มต้นของ `button` ใน `styles.css` อยู่แล้ว)
- React Query ใช้ `networkMode: 'always'` (ตั้งไว้แล้วใน providers ของแผน 3) · component ที่อ้างใน router ประกาศ return type `JSX.Element`
- TypeScript strict + `verbatimModuleSyntax` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` · `packages/domain` ห้าม import อะไรที่เป็น Node-only หรือ `@dayo/contracts` (ชนิด `CashKind` ประกาศใน domain เอง)
- เครื่องพัฒนา Windows 11 + Git Bash · Node ≥ 22.16 · ทุกคำสั่งรันที่ root ของ worktree
- **commit (D45):** ใช้ skill `committing-code` ก่อนทุก commit · conventional commit สั้น ๆ · **ห้ามมี trailer ของ AI** (`Co-Authored-By: …` หรืออื่นใด) · `git add` เฉพาะ path ที่ระบุชื่อใน step (ห้าม `git add -A` / `git add .`) · ไฟล์ทำงานชั่วคราว (`.superpowers/`, ledger, review, `.claude/`) ไม่เข้า git · เอกสาร `docs/**` ของโปรเจกต์นี้ commit ได้
- **โมเดล agent (D43):** sonnet เป็นขั้นต่ำสำหรับ implement/review ราย task · task ที่มีป้าย **💰 review: opus** (เงิน/ความถูกต้องของยอด) ต้องให้ opus เป็นคน review · opus สำหรับ final review ทั้ง branch · ไม่ใช้ haiku
- **ห้าม push ทุกกรณี (D49)** · merge เข้า `main` ในเครื่องแบบ `--no-ff` ได้เฉพาะใน Task 12 หลัง final review (opus) ผ่านและไม่มี issue ค้าง (D42)
- ห้ามแตะ `docs/` ยกเว้น: ติ๊ก checkbox ในแผนนี้ · บันทึกการทำแผน 3b + README (Task 12) · เพิ่มคำถามใหม่ในไฟล์คำถาม 3b · เพิ่มบันทึกการตัดสินใจเมื่อเจ้าของตอบ

---

## File Structure

```
packages/domain/src/shift.ts          แก้: + cashInputsFromMovements, CashKind, ShiftOrder, SalesSummary (+ QR รับ/โอนคืน/สุทธิ), summarizeShiftSales,
                                            assertSalesSummary, CASH_DENOMINATIONS_SATANG, MAX_PIECES_PER_DENOMINATION,
                                            CashCountLine, tallyCashCount, DEFAULT_VARIANCE_ALERT_SATANG, varianceNeedsReason,
                                            ZVoid, ZChainWarning, zReportHash, recomputeZChain · ZInput/ZSnapshot รูปใหม่ ·
                                            buildZReport ตรวจความสัมพันธ์ครบ
packages/domain/test/shift.test.ts    แทนทั้งไฟล์ (เคส expectedCash เดิมคงไว้ + property test)

apps/pos/src/api/
├── types.ts           แก้: REASON_MAX_LENGTH · QuickOpenShiftInput · CashMovementInput/Dto · NegativeBaseDto · ShiftReportDto ·
│                           CloseShiftInput · ZReportDto · ZReportSummaryDto · BackupFileDto · ConfirmBackupInput ·
│                           BootstrapState (+lastBackupAt, backupDue) · PosApi + 8 เมธอด · POS_API_METHODS
├── shift.ts           แทนทั้งไฟล์: insertOpenShift (ใช้ร่วม) · openShift · quickOpenShift · wasQuickOpened · QUICK_OPEN_ACTION
├── cash.ts            ใหม่: recordCashMovement · toCashMovementDto · MAX_CASH_MOVEMENT_SATANG
├── shift-report.ts    ใหม่: buildShiftReport (X และข้อมูลของ Z) · shiftReport · varianceAlertSatang · VARIANCE_ALERT_SETTING_KEY
├── close.ts           ใหม่: closeShift · listZReports · getZReport · deviceZRows (export ให้ backup.ts ใช้) · Z_CHAIN_ACK_ACTION
├── backup.ts          ใหม่: exportBackup · confirmBackupSaved · backupFileName · lastBackupAt · lastBackupZId · isBackupDue ·
│                           isSqliteFile · LAST_BACKUP_KEY · LAST_BACKUP_Z_ID_KEY
├── bootstrap.ts       แก้: bootstrap เติม lastBackupAt, backupDue
├── deps.ts            แก้: ApiDeps.exportDbFile
├── errors.ts          แก้: + SHIFT_CHANGED, VARIANCE_REASON_REQUIRED, Z_NOT_FOUND, Z_CHAIN_BROKEN, BACKUP_FAILED
├── pos-api.ts         แก้: ต่อเมธอดใหม่เข้าคิว serial
├── sale.ts, void.ts   แก้: เพดานเหตุผล 200
apps/pos/src/db/outbox.ts    แก้: OutboxTable + 'cash_count' | 'z_report'
apps/pos/src/db/worker.ts    แก้: exportDbFile = pool.exportFile(DB_FILE)
apps/pos/src/lib/clock.ts    แก้: + bangkokStamp, isShiftStale, STALE_SHIFT_CUTOFF_HOURS
apps/pos/src/app/queries.ts  แก้: + zListKey, zKey, shiftReportKey
apps/pos/src/ui/th.ts        แก้: ข้อความใหม่ · ui/errors.ts แก้: ข้อความของ error ใหม่ · ui/format.ts แก้: + parseCountInput
apps/pos/src/ui/save-file.ts ใหม่: downloadBytes
apps/pos/src/styles.css      แก้: + .figures
apps/pos/src/screens/
├── BackupScreen.tsx       ใหม่ (/backup — เจ้าของเท่านั้น · ดาวน์โหลด → "บันทึกไฟล์แล้ว") + BackupScreen.test.tsx
├── ShiftFigures.tsx       ใหม่: SalesTable, QrTable, DrawerTable (hideExpected), VoidList, NegativeBaseList (ใช้ร่วม X / ปิดกะ / Z)
├── ZReportScreen.tsx      ใหม่ (/z/$shiftId) · ZListScreen.tsx ใหม่ (/z)
├── ShiftScreen.tsx        ใหม่ (/shift — รายงาน X ไม่มีเงินสดที่ควรมี ไม่มีปุ่มปิดกะ) · CashMoveDialog.tsx ใหม่
├── CloseShiftScreen.tsx   ใหม่ (/shift/close — นับแบบไม่เห็นยอด · ยอดพร้อมเพย์ในแอปธนาคาร · รับทราบ Z เสีย) + CloseShiftScreen.test.tsx
├── SellScreen.tsx         แก้: ปุ่ม cash-move-open, nav-shift (Task 10) · close-shift-open (Task 11) · แถบ shift-stale
├── OpenShiftScreen.tsx    แทนทั้งไฟล์: + ปุ่มเปิดกะด่วน · แถบ backup-due · ลิงก์ Z ย้อนหลัง/สำรองไฟล์
├── VoidDialog.tsx, DiscountDialog.tsx   แก้: maxLength 200
apps/pos/src/router.tsx      แก้: + 5 route
apps/pos/test/helpers/db.ts  แก้: exportDbFile ในเทสต์ = vacuumInto(raw)
apps/pos/test/helpers/shift.ts ใหม่: sellVoidScenario, COUNT_520
apps/pos/test/  reason-limit · quick-open · cash-movement · shift-report · close-shift · backup (.test.ts) ใหม่ · init.test.ts แก้
apps/pos/src/lib/clock-stamp.test.ts · src/ui/save-file.test.ts · src/ui/count-input.test.ts   ใหม่
apps/pos/e2e/shift-x.spec.ts (Task 10) · apps/pos/e2e/close-shift.spec.ts (Task 11)   ใหม่
docs/superpowers/plans/2026-09-17-03b-บันทึกการทำแผน3b.md   ใหม่ (Task 12) · README.md แก้ (Task 12)
```

ลำดับ task: domain (1) → งานส่งต่อเล็ก (2, 3) → API เงิน/X/ปิดกะ/สำรอง (4–7) → หน้าจอ (8–11 เรียงให้ทุก route ที่ลิงก์ถึงมีอยู่ก่อนเสมอ เพราะ router ของ TanStack ตรวจ path ด้วย type — ปุ่ม `close-shift-open` จึงมาใน Task 11 พร้อม route `/shift/close`) → ตรวจ/บันทึก/review/merge (12)

---

### Task 1: domain — สรุปยอดของกะ · เงินเข้า-ออก · นับเงินแยกชนิด · `buildZReport` ที่ตรวจความถูกต้องครบ 💰 review: opus

**Files:**
- Modify: `packages/domain/src/shift.ts` (แทนทั้งไฟล์)
- Test: `packages/domain/test/shift.test.ts` (แทนทั้งไฟล์)

**Interfaces:**
- Consumes: `canonicalJson`, `sha256Hex` (`hash.ts`) · `assertSafeInt` (`money.ts`) · `CashInputs`, `expectedCashSatang` เดิม (ไม่เปลี่ยน)
- Produces (export จาก `@dayo/domain` ผ่าน `export * from './shift.js'` ที่มีอยู่แล้ว):
  - `type CashKind = 'PAID_IN' | 'PAID_OUT' | 'DROP' | 'VOID_REFUND'`
  - `cashInputsFromMovements(openingFloatSatang: number, cashSalesSatang: number, movements: readonly { kind: CashKind; amountSatang: number }[]): CashInputs`
  - `type ShiftOrder = { id; status: 'paid' | 'voided'; subtotalSatang; discountSatang; totalSatang; payments: readonly { method: 'CASH' | 'PROMPTPAY'; amountSatang }[] }`
  - `type SalesSummary = { orderCount; voidCount; grossSalesSatang; discountSatang; voidedSatang; netSalesSatang; cashSalesSatang; qrSalesSatang; qrRefundedSatang; qrNetSatang }` (number ทุกช่อง · `qrRefundedSatang` = พร้อมเพย์ของบิลที่ยกเลิก = โอนคืน · `qrNetSatang` = qr − โอนคืน — Q3b-12 · D53)
  - `summarizeShiftSales(orders: readonly ShiftOrder[]): SalesSummary` · `assertSalesSummary(s: SalesSummary): void`
  - `CASH_DENOMINATIONS_SATANG: readonly number[]` (9 ชนิด ไม่มีเหรียญสตางค์ — Q3b-1 · D52) · `MAX_PIECES_PER_DENOMINATION = 99_999` · `type CashCountLine = { denominationSatang: number; count: number }` · `tallyCashCount(lines): { lines: CashCountLine[]; totalSatang: number }`
  - `DEFAULT_VARIANCE_ALERT_SATANG = 2_000` · `varianceNeedsReason(varianceSatang: number, alertSatang: number): boolean`
  - `type ZVoid = { orderId; receiptNo; totalSatang; method: 'CASH' | 'PROMPTPAY'; reason; made: boolean; approvedBy; approvedByName; refundReference: string | null; voidedAt }`
  - `type ZChainWarning = { brokenShiftId: string; storedGrandTotalSatang: number | null; recomputedGrandTotalSatang: number; acknowledgedBy: string }` (Q3b-11 · D53)
  - `type ZInput = { shiftId; businessDate; deviceId; zNo: number; openedAt; openedBy; openedQuick: boolean; closedAt; closedBy; countedBy; sales: SalesSummary; cash: CashInputs; countLines: CashCountLine[]; countedCashSatang; varianceAlertSatang; varianceReason: string | null; voids: ZVoid[]; bankQrTotalSatang: number | null; chainWarning: ZChainWarning | null }` · `type ZSnapshot = ZInput & { expectedCashSatang; cashVarianceSatang; qrDifferenceSatang: number | null; grandTotalSatang }` (`qrDifferenceSatang` = แอปธนาคาร − พร้อมเพย์สุทธิ · null เมื่อไม่ได้กรอก — Q3b-12 · D53)
  - `zReportHash(snapshot: unknown): string` · `recomputeZChain(netSalesSatang: readonly number[]): { zNo: number; grandTotalSatang: number }` (จำนวน Z และ Σ net ของ snapshot ทุกใบ — Q3b-11 · D53) · `buildZReport(input: ZInput, prev: { zNo: number; grandTotalSatang: number } | null): { snapshot: ZSnapshot; hash: string }` — throw `RangeError` เมื่อข้อมูลไม่สอดคล้อง (chain บน `zNo` ของ Z ก่อนหน้า ไม่ใช้เวลา — นาฬิกาเครื่องเลื่อนได้ · Σ บิลยกเลิกเงินสด = `VOID_REFUND` · Σ บิลยกเลิกพร้อมเพย์ = `qrRefundedSatang` · มี `chainWarning` แล้ว `prev` ต้องเป็นค่าที่คำนวณใหม่)

ทุกฟังก์ชันใหม่ throw `RangeError` เท่านั้น (ฝั่งแอปแปลงเป็น `BAD_INPUT`) · ไม่มีโค้ดอื่นใน repo ใช้ `ZInput`/`buildZReport` (ตรวจแล้ว: มีแค่คอมเมนต์ใน `db-schema/src/*/sales.ts`) จึงเปลี่ยนรูปได้ (T3b-12)

- [ ] **Step 0: สร้าง branch ของแผนนี้**

```bash
git status --short                       # ต้องว่าง
git log --oneline -1 main                # 4a858d9 หรือใหม่กว่า (แผน 3 merge แล้ว)
git merge-base --is-ancestor main plan-3b-draft && echo OK   # draft ต้องต่อจาก main ล่าสุด (ถ้าไม่ OK: rebase draft ก่อน)
git checkout -b plan-3b-shift-close plan-3b-draft   # แตกจาก draft ที่มีแผน + ไฟล์คำถาม + D52–D53 (ห้าม checkout main ใน worktree นี้ — main ถูก checkout อยู่ที่ D:/TungAo-Project/pos-management)
pnpm install --frozen-lockfile
grep -n "Q3b" docs/design/00-บันทึกการตัดสินใจ.md   # ต้องเจอ D52 และ D53 (คำตอบ Q3b-1 … Q3b-13 commit ไว้บน plan-3b-draft) — ไม่เจอ = หยุด ถามเจ้าของ
```
Expected: branch ใหม่ `plan-3b-shift-close` ต่อจาก `plan-3b-draft` · install ผ่าน · เจอ D52 และ D53 (ตรงกับตาราง "คำตอบของเจ้าของที่แผนนี้ใช้" ท้ายแผน)

- [ ] **Step 1: เขียนเทสต์ให้ตก (แทน `packages/domain/test/shift.test.ts` ทั้งไฟล์)**

```ts
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  assertSalesSummary,
  buildZReport,
  CASH_DENOMINATIONS_SATANG,
  cashInputsFromMovements,
  expectedCashSatang,
  recomputeZChain,
  summarizeShiftSales,
  tallyCashCount,
  varianceNeedsReason,
  zReportHash,
  type CashInputs,
  type SalesSummary,
  type ShiftOrder,
  type ZChainWarning,
  type ZInput,
} from '../src/shift.js'

const cash: CashInputs = { openingFloatSatang: 100_000, cashSalesSatang: 523_000, voidRefundsSatang: 4_500, paidInSatang: 0, paidOutSatang: 20_000, dropsSatang: 300_000 }

describe('expectedCashSatang', () => {
  it('opening + cash sales − void refunds + paid in − paid out − drops (D36)', () => {
    expect(expectedCashSatang(cash)).toBe(100_000 + 523_000 - 4_500 - 20_000 - 300_000)
  })

  it('each input moves expected cash by exactly its own amount, in its own direction', () => {
    const base: CashInputs = { openingFloatSatang: 0, cashSalesSatang: 0, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 }
    expect(expectedCashSatang({ ...base, openingFloatSatang: 1 })).toBe(1)
    expect(expectedCashSatang({ ...base, cashSalesSatang: 1 })).toBe(1)
    expect(expectedCashSatang({ ...base, voidRefundsSatang: 1 })).toBe(-1)
    expect(expectedCashSatang({ ...base, paidInSatang: 1 })).toBe(1)
    expect(expectedCashSatang({ ...base, paidOutSatang: 1 })).toBe(-1)
    expect(expectedCashSatang({ ...base, dropsSatang: 1 })).toBe(-1)
  })

  it('a voided 45-baht cash bill: sale counted in cash sales, refund counted once as VOID_REFUND', () => {
    const x: CashInputs = { openingFloatSatang: 100_000, cashSalesSatang: 4_500, voidRefundsSatang: 4_500, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 }
    expect(expectedCashSatang(x)).toBe(100_000)
  })
})

describe('cashInputsFromMovements', () => {
  it('puts every kind in its own field, each row once (D36)', () => {
    const x = cashInputsFromMovements(50_000, 9_000, [
      { kind: 'VOID_REFUND', amountSatang: 4_500 },
      { kind: 'PAID_IN', amountSatang: 10_000 },
      { kind: 'PAID_OUT', amountSatang: 2_000 },
      { kind: 'PAID_OUT', amountSatang: 500 },
      { kind: 'DROP', amountSatang: 30_000 },
    ])
    expect(x).toEqual({ openingFloatSatang: 50_000, cashSalesSatang: 9_000, voidRefundsSatang: 4_500, paidInSatang: 10_000, paidOutSatang: 2_500, dropsSatang: 30_000 })
  })

  it('refuses a zero, negative or fractional amount', () => {
    expect(() => cashInputsFromMovements(0, 0, [{ kind: 'PAID_IN', amountSatang: 0 }])).toThrow(RangeError)
    expect(() => cashInputsFromMovements(0, 0, [{ kind: 'DROP', amountSatang: -1 }])).toThrow(RangeError)
    expect(() => cashInputsFromMovements(0, 0, [{ kind: 'PAID_OUT', amountSatang: 1.5 }])).toThrow(RangeError)
  })
})

const paid = (id: string, subtotal: number, discount: number, method: 'CASH' | 'PROMPTPAY'): ShiftOrder => ({
  id, status: 'paid', subtotalSatang: subtotal, discountSatang: discount, totalSatang: subtotal - discount, payments: [{ method, amountSatang: subtotal - discount }],
})

describe('summarizeShiftSales', () => {
  it('keeps voided receipts in gross and separates them (spec §4.3); net = gross − discount − voided (Q3b-4 · D52)', () => {
    const s = summarizeShiftSales([
      paid('o1', 10_500, 500, 'CASH'),
      paid('o2', 4_500, 0, 'PROMPTPAY'),
      { ...paid('o3', 9_000, 0, 'CASH'), status: 'voided' },
    ])
    expect(s).toEqual({
      orderCount: 3, voidCount: 1, grossSalesSatang: 24_000, discountSatang: 500, voidedSatang: 9_000, netSalesSatang: 14_500,
      cashSalesSatang: 19_000, qrSalesSatang: 4_500, qrRefundedSatang: 0, qrNetSatang: 4_500,
    })
  })

  it('QR received / refunded / net: a voided PromptPay receipt was transferred back (Q3b-12 · D53)', () => {
    const s = summarizeShiftSales([paid('o1', 4_500, 0, 'PROMPTPAY'), { ...paid('o2', 5_000, 0, 'PROMPTPAY'), status: 'voided' }, { ...paid('o3', 4_000, 0, 'CASH'), status: 'voided' }])
    expect(s).toMatchObject({ qrSalesSatang: 9_500, qrRefundedSatang: 5_000, qrNetSatang: 4_500, voidedSatang: 9_000 })
    expect(() => assertSalesSummary({ ...s, qrNetSatang: 4_501 })).toThrow(RangeError)
    expect(() => assertSalesSummary({ ...s, qrRefundedSatang: 9_501, qrNetSatang: -1 })).toThrow(RangeError)
  })

  it('refuses an order whose payments or totals do not add up (spec §4.1)', () => {
    expect(() => summarizeShiftSales([{ ...paid('o1', 4_500, 0, 'CASH'), payments: [{ method: 'CASH', amountSatang: 4_000 }] }])).toThrow(/payments/)
    expect(() => summarizeShiftSales([{ ...paid('o1', 4_500, 0, 'CASH'), totalSatang: 4_400 }])).toThrow(/total/)
  })

  it('an empty shift is all zeros', () => {
    expect(summarizeShiftSales([])).toEqual({
      orderCount: 0, voidCount: 0, grossSalesSatang: 0, discountSatang: 0, voidedSatang: 0, netSalesSatang: 0,
      cashSalesSatang: 0, qrSalesSatang: 0, qrRefundedSatang: 0, qrNetSatang: 0,
    })
  })

  it('property: the summary always satisfies assertSalesSummary; net and QR net = Σ of the receipts still paid', () => {
    const orderArb = fc
      .record({ subtotal: fc.integer({ min: 1, max: 1_000_000 }), discountPct: fc.integer({ min: 0, max: 99 }), voided: fc.boolean(), cash: fc.boolean(), n: fc.nat() })
      .map(({ subtotal, discountPct, voided, cash, n }): ShiftOrder => {
        const discount = Math.floor((subtotal * discountPct) / 100)
        return { ...paid(`o${n}`, subtotal, discount, cash ? 'CASH' : 'PROMPTPAY'), status: voided ? 'voided' : 'paid' }
      })
    fc.assert(
      fc.property(fc.array(orderArb, { maxLength: 60 }), (orders) => {
        const s = summarizeShiftSales(orders)
        assertSalesSummary(s)
        const kept = orders.filter((o) => o.status === 'paid')
        expect(s.netSalesSatang).toBe(kept.reduce((a, o) => a + o.totalSatang, 0))
        expect(s.qrNetSatang).toBe(kept.filter((o) => o.payments[0]!.method === 'PROMPTPAY').reduce((a, o) => a + o.totalSatang, 0))
      }),
    )
  })
})

describe('tallyCashCount / varianceNeedsReason', () => {
  it('uses the 9 denominations of spec §5, no satang coins (Q3b-1 · D52), largest first, missing = 0', () => {
    expect(CASH_DENOMINATIONS_SATANG).toEqual([100_000, 50_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100])
    const t = tallyCashCount([{ denominationSatang: 100, count: 3 }, { denominationSatang: 100_000, count: 2 }])
    expect(t.totalSatang).toBe(200_300)
    expect(t.lines.map((l) => l.count)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 3])
  })

  it('refuses unknown or repeated denominations and bad counts', () => {
    expect(() => tallyCashCount([{ denominationSatang: 50, count: 1 }])).toThrow(RangeError)
    expect(() => tallyCashCount([{ denominationSatang: 100, count: 1 }, { denominationSatang: 100, count: 2 }])).toThrow(RangeError)
    expect(() => tallyCashCount([{ denominationSatang: 100, count: -1 }])).toThrow(RangeError)
    expect(() => tallyCashCount([{ denominationSatang: 100, count: 1.5 }])).toThrow(RangeError)
    expect(() => tallyCashCount([{ denominationSatang: 100, count: 100_000 }])).toThrow(RangeError)
  })

  it('needs a reason only when the shortage or overage is strictly above the threshold (spec §4.8)', () => {
    expect(varianceNeedsReason(2_000, 2_000)).toBe(false)
    expect(varianceNeedsReason(-2_000, 2_000)).toBe(false)
    expect(varianceNeedsReason(2_001, 2_000)).toBe(true)
    expect(varianceNeedsReason(-2_001, 2_000)).toBe(true)
    expect(varianceNeedsReason(0, 0)).toBe(false)
    expect(varianceNeedsReason(1, 0)).toBe(true)
  })
})

describe('recomputeZChain (Q3b-11 · D53)', () => {
  it('Z count and Σ net of every earlier snapshot', () => {
    expect(recomputeZChain([])).toEqual({ zNo: 0, grandTotalSatang: 0 })
    expect(recomputeZChain([4_000, 0, 10_000])).toEqual({ zNo: 3, grandTotalSatang: 14_000 })
  })

  it('refuses a net that is not a whole, non-negative number', () => {
    expect(() => recomputeZChain([4_000, -1])).toThrow(RangeError)
    expect(() => recomputeZChain([Number.NaN])).toThrow(RangeError)
  })
})

describe('buildZReport', () => {
  const sales: SalesSummary = {
    orderCount: 3, voidCount: 1, grossSalesSatang: 24_000, discountSatang: 500, voidedSatang: 9_000, netSalesSatang: 14_500,
    cashSalesSatang: 19_000, qrSalesSatang: 4_500, qrRefundedSatang: 0, qrNetSatang: 4_500,
  }
  const zCash: CashInputs = { openingFloatSatang: 50_000, cashSalesSatang: 19_000, voidRefundsSatang: 9_000, paidInSatang: 0, paidOutSatang: 2_000, dropsSatang: 0 }
  // expected = 50_000 + 19_000 − 9_000 − 2_000 = 58_000
  const input: ZInput = {
    shiftId: 's1', businessDate: '2026-09-17', deviceId: 'dev-A', zNo: 1, openedAt: '2026-09-17T01:00:00.000Z', openedBy: 'u1', openedQuick: false,
    closedAt: '2026-09-17T13:05:00.000Z', closedBy: 'u1', countedBy: 'u2',
    sales, cash: zCash,
    countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 5_000, count: 1 }, { denominationSatang: 1_000, count: 3 }],
    countedCashSatang: 58_000,
    varianceAlertSatang: 2_000,
    varianceReason: null,
    voids: [{ orderId: 'o3', receiptNo: 'A-000003', totalSatang: 9_000, method: 'CASH', reason: 'กดผิดเมนู', made: false, approvedBy: 'u1', approvedByName: 'TungAo', refundReference: null, voidedAt: '2026-09-17T05:00:00.000Z' }],
    bankQrTotalSatang: null,
    chainWarning: null,
  }

  it('computes expected cash, variance and running grand total; normalizes the count lines', () => {
    const z = buildZReport(input, { zNo: 0, grandTotalSatang: 10_000_000 })
    expect(z.snapshot.expectedCashSatang).toBe(58_000)
    expect(z.snapshot.cashVarianceSatang).toBe(0)
    expect(z.snapshot.grandTotalSatang).toBe(10_014_500)
    expect(z.snapshot.qrDifferenceSatang).toBeNull()
    expect(z.snapshot.countLines).toHaveLength(9)
    expect(z.hash).toBe(zReportHash(z.snapshot))
    expect(z.hash).toHaveLength(64)
  })

  it('hash changes when any number changes, and is stable', () => {
    const a = buildZReport(input, null).hash
    expect(buildZReport({ ...input, cash: { ...zCash, paidOutSatang: 2_001 } }, null).hash).not.toBe(a)
    expect(buildZReport(input, { zNo: 0, grandTotalSatang: 1 }).hash).not.toBe(a)
    expect(buildZReport(input, null).hash).toBe(a)
  })

  it('a variance above the threshold needs a reason; the reason is trimmed (spec §4.8)', () => {
    const short: ZInput = { ...input, countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 5_000, count: 1 }], countedCashSatang: 55_000 }
    expect(() => buildZReport(short, null)).toThrow(/reason/)
    expect(() => buildZReport({ ...short, varianceReason: '   ' }, null)).toThrow(/reason/)
    const z = buildZReport({ ...short, varianceReason: '  ทอนผิด  ' }, null)
    expect(z.snapshot).toMatchObject({ cashVarianceSatang: -3_000, varianceReason: 'ทอนผิด' })
  })

  it('freezes the bank-app QR total and the QR difference = bank − QR net (Q3b-12 · D53)', () => {
    expect(buildZReport({ ...input, bankQrTotalSatang: 4_000 }, null).snapshot).toMatchObject({ bankQrTotalSatang: 4_000, qrDifferenceSatang: -500 })
    expect(buildZReport({ ...input, bankQrTotalSatang: 4_500 }, null).snapshot.qrDifferenceSatang).toBe(0)
    expect(() => buildZReport({ ...input, bankQrTotalSatang: -1 }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, bankQrTotalSatang: 0.5 }, null)).toThrow(RangeError)
  })

  it('a chain warning is frozen into the Z and must match the recomputed chain it chains from (Q3b-11 · D53)', () => {
    const w: ZChainWarning = { brokenShiftId: 's0', storedGrandTotalSatang: 999, recomputedGrandTotalSatang: 4_000, acknowledgedBy: 'u1' }
    const z = buildZReport({ ...input, zNo: 2, chainWarning: w }, { zNo: 1, grandTotalSatang: 4_000 })
    expect(z.snapshot).toMatchObject({ chainWarning: w, grandTotalSatang: 18_500 })
    expect(z.hash).toBe(zReportHash(z.snapshot))
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: w }, { zNo: 1, grandTotalSatang: 999 })).toThrow(RangeError)
    expect(() => buildZReport({ ...input, chainWarning: w }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: { ...w, acknowledgedBy: '' } }, { zNo: 1, grandTotalSatang: 4_000 })).toThrow(RangeError)
  })

  it('refuses inconsistent inputs (Plan 1 notes §4)', () => {
    expect(() => buildZReport({ ...input, sales: { ...sales, netSalesSatang: 14_501 } }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, sales: { ...sales, qrSalesSatang: 4_501 } }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, cash: { ...zCash, cashSalesSatang: 19_001 } }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, countedCashSatang: 58_001 }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, voids: [] }, null)).toThrow(RangeError)
    expect(() => buildZReport(input, { zNo: 0, grandTotalSatang: -1 })).toThrow(RangeError)
    expect(() => buildZReport({ ...input, zNo: 3 }, { zNo: 1, grandTotalSatang: 0 })).toThrow(RangeError)
    // the void list ties to the cash drawer (VOID_REFUND rows) and to the QR refunds
    expect(() => buildZReport({ ...input, cash: { ...zCash, voidRefundsSatang: 8_999 } }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, voids: [{ ...input.voids[0]!, method: 'PROMPTPAY' }] }, null)).toThrow(RangeError)
  })
})
```

Run: `pnpm --filter @dayo/domain exec vitest run shift`
Expected: FAIL — `cashInputsFromMovements is not a function` / `summarizeShiftSales is not a function` / `recomputeZChain is not a function` (ฟังก์ชันยังไม่มี) และเคส `buildZReport` ตกเพราะรูป `ZInput` ใหม่

- [ ] **Step 2: เขียน `packages/domain/src/shift.ts` ใหม่ทั้งไฟล์**

```ts
import { canonicalJson, sha256Hex } from './hash.js'
import { assertSafeInt } from './money.js'

/**
 * Inputs to `expectedCashSatang`, one field per source of shift / order / cash_movement rows (spec §4.3, §4.8, D36).
 * Every cash_movement kind maps to exactly one field, so no row is ever counted twice.
 *
 * - `openingFloatSatang` — `shift.opening_float_satang`, recorded when the shift opens.
 * - `cashSalesSatang` — sum of CASH `payment.amount_satang` for orders paid during the shift, including orders
 *   voided later (the money came in; handing it back is a separate VOID_REFUND row).
 * - `voidRefundsSatang` — sum of `cash_movement` rows of kind VOID_REFUND. The system writes one automatically
 *   when a cash-paid order is voided (the cash handed back from the drawer); a person never enters it.
 * - `paidInSatang` — sum of `cash_movement` rows of kind PAID_IN (entered by a person, e.g. topping up the drawer).
 * - `paidOutSatang` — sum of `cash_movement` rows of kind PAID_OUT (entered by a person, e.g. buying ice).
 *   Void refunds are never PAID_OUT rows (D36), so this is simply every PAID_OUT row of the shift.
 * - `dropsSatang` — sum of `cash_movement` rows of kind DROP (cash removed to the safe).
 *
 * expected = opening + cash_sales − void_refunds + paid_in − paid_out − drops
 */
export type CashInputs = {
  openingFloatSatang: number
  cashSalesSatang: number
  voidRefundsSatang: number
  paidInSatang: number
  paidOutSatang: number
  dropsSatang: number
}

export function expectedCashSatang(x: CashInputs): number {
  return x.openingFloatSatang + x.cashSalesSatang - x.voidRefundsSatang + x.paidInSatang - x.paidOutSatang - x.dropsSatang
}

function assertNonNegInt(n: number, name: string): void {
  assertSafeInt(n, name)
  if (n < 0) throw new RangeError(`${name} must be >= 0, got ${n}`)
}

/** Same values as contracts `CashMovementKind` (spec §3.5, D36) — domain stays free of the contracts package. */
export type CashKind = 'PAID_IN' | 'PAID_OUT' | 'DROP' | 'VOID_REFUND'

/** Sums the shift's cash_movement rows into `CashInputs`; each row lands in exactly one field (D36). */
export function cashInputsFromMovements(
  openingFloatSatang: number,
  cashSalesSatang: number,
  movements: readonly { kind: CashKind; amountSatang: number }[],
): CashInputs {
  assertNonNegInt(openingFloatSatang, 'openingFloatSatang')
  assertNonNegInt(cashSalesSatang, 'cashSalesSatang')
  const x: CashInputs = { openingFloatSatang, cashSalesSatang, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 }
  for (const m of movements) {
    assertSafeInt(m.amountSatang, 'amountSatang')
    if (m.amountSatang <= 0) throw new RangeError(`cash movement amount must be > 0, got ${m.amountSatang}`)
    if (m.kind === 'VOID_REFUND') x.voidRefundsSatang += m.amountSatang
    else if (m.kind === 'PAID_IN') x.paidInSatang += m.amountSatang
    else if (m.kind === 'PAID_OUT') x.paidOutSatang += m.amountSatang
    else x.dropsSatang += m.amountSatang
  }
  return x
}

/** One order of the shift that got a receipt number: paid, or paid and voided later (spec §4.3 keeps it in gross). */
export type ShiftOrder = {
  id: string
  status: 'paid' | 'voided'
  subtotalSatang: number
  discountSatang: number
  totalSatang: number
  payments: readonly { method: 'CASH' | 'PROMPTPAY'; amountSatang: number }[]
}

/**
 * Sales of one shift (spec §4.3, §4.8).
 * - `orderCount` — every receipt of the shift, voided ones included · `voidCount` — the voided ones.
 * - `grossSalesSatang` — Σ subtotal of every receipt (voided included, spec §4.3) · `discountSatang` — Σ discount of the same.
 * - `voidedSatang` — Σ total of the voided receipts.
 * - `netSalesSatang` = gross − discount − voided = Σ total of the receipts still paid (Q3b-4 · D52).
 * - `cashSalesSatang` / `qrSalesSatang` — money received by method, voided receipts included (the refund is a
 *   separate VOID_REFUND / transfer back), so cash + qr = gross − discount.
 * - `qrRefundedSatang` — PromptPay money of the voided receipts, transferred back to the customer (D48 Q3-15) ·
 *   `qrNetSatang` = qr − qr refunded: what the bank app should show for the shift (Q3b-12 · D53).
 */
export type SalesSummary = {
  orderCount: number
  voidCount: number
  grossSalesSatang: number
  discountSatang: number
  voidedSatang: number
  netSalesSatang: number
  cashSalesSatang: number
  qrSalesSatang: number
  qrRefundedSatang: number
  qrNetSatang: number
}

export function summarizeShiftSales(orders: readonly ShiftOrder[]): SalesSummary {
  const s: SalesSummary = {
    orderCount: 0,
    voidCount: 0,
    grossSalesSatang: 0,
    discountSatang: 0,
    voidedSatang: 0,
    netSalesSatang: 0,
    cashSalesSatang: 0,
    qrSalesSatang: 0,
    qrRefundedSatang: 0,
    qrNetSatang: 0,
  }
  for (const o of orders) {
    assertNonNegInt(o.subtotalSatang, 'subtotalSatang')
    assertNonNegInt(o.discountSatang, 'discountSatang')
    assertNonNegInt(o.totalSatang, 'totalSatang')
    if (o.totalSatang !== o.subtotalSatang - o.discountSatang) throw new RangeError(`order ${o.id}: total ≠ subtotal − discount`)
    let paid = 0
    for (const p of o.payments) {
      assertNonNegInt(p.amountSatang, 'payment amountSatang')
      paid += p.amountSatang
      if (p.method === 'CASH') s.cashSalesSatang += p.amountSatang
      else {
        s.qrSalesSatang += p.amountSatang
        if (o.status === 'voided') s.qrRefundedSatang += p.amountSatang
      }
    }
    if (paid !== o.totalSatang) throw new RangeError(`order ${o.id}: payments ${paid} ≠ total ${o.totalSatang} (spec §4.1)`)
    s.orderCount += 1
    s.grossSalesSatang += o.subtotalSatang
    s.discountSatang += o.discountSatang
    if (o.status === 'voided') {
      s.voidCount += 1
      s.voidedSatang += o.totalSatang
    }
  }
  s.netSalesSatang = s.grossSalesSatang - s.discountSatang - s.voidedSatang // Q3b-4 · D52
  s.qrNetSatang = s.qrSalesSatang - s.qrRefundedSatang // Q3b-12 · D53
  return s
}

/** Throws unless the summary is internally consistent — the relations `summarizeShiftSales` guarantees (Plan 1 notes §4). */
export function assertSalesSummary(s: SalesSummary): void {
  for (const [k, v] of Object.entries(s)) assertNonNegInt(v, k)
  if (s.voidCount > s.orderCount) throw new RangeError('voidCount > orderCount')
  if (s.discountSatang > s.grossSalesSatang) throw new RangeError('discount > gross')
  if (s.netSalesSatang !== s.grossSalesSatang - s.discountSatang - s.voidedSatang) throw new RangeError('net ≠ gross − discount − voided') // Q3b-4 · D52
  if (s.cashSalesSatang + s.qrSalesSatang !== s.grossSalesSatang - s.discountSatang) throw new RangeError('cash + qr ≠ gross − discount')
  if (s.qrRefundedSatang > s.qrSalesSatang || s.qrRefundedSatang > s.voidedSatang) throw new RangeError('qr refunded > qr sales or > voided')
  if (s.qrNetSatang !== s.qrSalesSatang - s.qrRefundedSatang) throw new RangeError('qr net ≠ qr − qr refunded') // Q3b-12 · D53
}

/** Notes and coins counted at shift close, largest first, in satang — spec §5 table 1000/500/100/50/20/10/5/2/1, no satang coins (Q3b-1 · D52). */
export const CASH_DENOMINATIONS_SATANG: readonly number[] = [100_000, 50_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100]
export const MAX_PIECES_PER_DENOMINATION = 99_999

export type CashCountLine = { denominationSatang: number; count: number }

/** Normalizes a drawer count to one line per denomination (largest first, missing = 0) and sums it exactly. */
export function tallyCashCount(lines: readonly CashCountLine[]): { lines: CashCountLine[]; totalSatang: number } {
  const counts = new Map<number, number>()
  for (const l of lines) {
    if (!CASH_DENOMINATIONS_SATANG.includes(l.denominationSatang)) throw new RangeError(`unknown denomination ${l.denominationSatang}`)
    if (counts.has(l.denominationSatang)) throw new RangeError(`denomination ${l.denominationSatang} counted twice`)
    if (!Number.isSafeInteger(l.count) || l.count < 0 || l.count > MAX_PIECES_PER_DENOMINATION) {
      throw new RangeError(`count of ${l.denominationSatang} must be a whole number 0–${MAX_PIECES_PER_DENOMINATION}, got ${l.count}`)
    }
    counts.set(l.denominationSatang, l.count)
  }
  const out = CASH_DENOMINATIONS_SATANG.map((d) => ({ denominationSatang: d, count: counts.get(d) ?? 0 }))
  return { lines: out, totalSatang: out.reduce((a, l) => a + l.denominationSatang * l.count, 0) }
}

/** spec §3.1 setting `cash.variance_alert_satang` default (฿20). */
export const DEFAULT_VARIANCE_ALERT_SATANG = 2_000

/** spec §4.8: a shortage or overage strictly greater than the alert threshold needs a reason. */
export function varianceNeedsReason(varianceSatang: number, alertSatang: number): boolean {
  assertSafeInt(varianceSatang, 'varianceSatang')
  assertNonNegInt(alertSatang, 'alertSatang')
  return Math.abs(varianceSatang) > alertSatang
}

/** A voided receipt as frozen into the Z report — the daily void report (D50 Q3-22). Names are frozen too. */
export type ZVoid = {
  orderId: string
  receiptNo: string
  totalSatang: number
  method: 'CASH' | 'PROMPTPAY'
  reason: string
  made: boolean
  approvedBy: string
  approvedByName: string
  refundReference: string | null
  voidedAt: string
}

/**
 * Q3b-11 · D53: the previous Z of this device failed its hash check, and an owner acknowledged it with their PIN.
 * Frozen into the new Z for good (it is part of the hashed snapshot) and shown wherever that Z is shown.
 */
export type ZChainWarning = {
  /** Shift of the previous Z whose snapshot no longer matches its hash. */
  brokenShiftId: string
  /** The grand total that broken snapshot claims (not trusted — null if it is not even a whole number). */
  storedGrandTotalSatang: number | null
  /** Σ net of every earlier Z snapshot of this device, in `zNo` order (`recomputeZChain`) — what this Z chains from. */
  recomputedGrandTotalSatang: number
  /** The owner who acknowledged the broken chain with their PIN. */
  acknowledgedBy: string
}

export type ZInput = {
  shiftId: string
  businessDate: string
  deviceId: string
  /** Z number of this device: previous Z's zNo + 1, starting at 1 — the grand-total chain follows this, never the clock. */
  zNo: number
  openedAt: string
  openedBy: string
  /** "เปิดกะด่วน" (spec §4.8 · Q3b-10 · D52). */
  openedQuick: boolean
  closedAt: string
  /** The owner who confirmed the close with their PIN (Q3b-2 · D52). */
  closedBy: string
  /** The signed-in user who counted the drawer. */
  countedBy: string
  sales: SalesSummary
  cash: CashInputs
  countLines: CashCountLine[]
  countedCashSatang: number
  varianceAlertSatang: number
  varianceReason: string | null
  voids: ZVoid[]
  /** PromptPay total the owner read from the bank app for this shift, or null when not entered (Q3b-12 · D53). */
  bankQrTotalSatang: number | null
  /** Set when the previous Z failed its hash check (Q3b-11 · D53); null otherwise. */
  chainWarning: ZChainWarning | null
}

export type ZSnapshot = ZInput & {
  expectedCashSatang: number
  cashVarianceSatang: number
  /** bank − net QR (Q3b-12 · D53) · null when no bank total was entered. */
  qrDifferenceSatang: number | null
  grandTotalSatang: number
}

/** Hash of a Z snapshot (or of any JSON read back from `z_report.snapshot_json`) — invariant 6 of spec §7. */
export function zReportHash(snapshot: unknown): string {
  return sha256Hex(canonicalJson(snapshot))
}

/**
 * Q3b-11 · D53: when the previous Z fails its hash, the chain is rebuilt from every earlier Z snapshot of the device
 * (in `zNo` order): the Z count and Σ net. A healthy chain gives exactly the stored values of the last Z
 * (Z(n).grand = Σ net of Z1…Zn, Z(n).zNo = n), so this only differs where a snapshot's stored total was edited.
 */
export function recomputeZChain(netSalesSatang: readonly number[]): { zNo: number; grandTotalSatang: number } {
  let grand = 0
  for (const [i, net] of netSalesSatang.entries()) {
    assertNonNegInt(net, `net of Z #${i + 1}`)
    grand += net
  }
  assertSafeInt(grand, 'grandTotalSatang')
  return { zNo: netSalesSatang.length, grandTotalSatang: grand }
}

/**
 * Frozen Z report: computed once at shift close, never recomputed (spec §4.8). Refuses an inconsistent input
 * (Plan 1 notes §4): sales relations, cash sales on both sides, the count total, the void list (count, total, cash
 * voids = VOID_REFUND rows, QR voids = QR refunded), and a missing reason when the variance is above the alert
 * threshold. Z(n).grand = Z(n−1).grand + net of this shift, chained on `zNo` (the previous Z's snapshot), never on the
 * clock — a device clock can be wrong and later corrected. With a `chainWarning`, `prev` is the recomputed chain.
 */
export function buildZReport(input: ZInput, prev: { zNo: number; grandTotalSatang: number } | null): { snapshot: ZSnapshot; hash: string } {
  const prevZNo = prev?.zNo ?? 0
  const prevGrand = prev?.grandTotalSatang ?? 0
  assertNonNegInt(prevZNo, 'prev.zNo')
  assertNonNegInt(prevGrand, 'prev.grandTotalSatang')
  if (input.zNo !== prevZNo + 1) throw new RangeError(`zNo must be ${prevZNo + 1}, got ${input.zNo}`)
  assertSalesSummary(input.sales)
  for (const [k, v] of Object.entries(input.cash)) assertNonNegInt(v, `cash.${k}`)
  if (input.cash.cashSalesSatang !== input.sales.cashSalesSatang) throw new RangeError('cash.cashSalesSatang must equal sales.cashSalesSatang')
  const tally = tallyCashCount(input.countLines)
  if (tally.totalSatang !== input.countedCashSatang) throw new RangeError('countedCashSatang must equal the sum of countLines')
  if (input.voids.length !== input.sales.voidCount) throw new RangeError('voids must list every voided receipt')
  if (input.voids.reduce((a, v) => a + v.totalSatang, 0) !== input.sales.voidedSatang) throw new RangeError('Σ voids.totalSatang must equal sales.voidedSatang')
  const voidSum = (method: ZVoid['method']): number => input.voids.filter((v) => v.method === method).reduce((a, v) => a + v.totalSatang, 0)
  if (voidSum('CASH') !== input.cash.voidRefundsSatang) throw new RangeError('Σ cash voids must equal cash.voidRefundsSatang (D36)')
  if (voidSum('PROMPTPAY') !== input.sales.qrRefundedSatang) throw new RangeError('Σ PromptPay voids must equal sales.qrRefundedSatang')
  if (input.bankQrTotalSatang !== null) assertNonNegInt(input.bankQrTotalSatang, 'bankQrTotalSatang')
  const w = input.chainWarning
  if (w !== null) {
    if (w.brokenShiftId === '' || w.acknowledgedBy === '') throw new RangeError('chainWarning needs the broken shift and the acknowledging owner')
    if (w.storedGrandTotalSatang !== null) assertSafeInt(w.storedGrandTotalSatang, 'chainWarning.storedGrandTotalSatang')
    if (prev === null || w.recomputedGrandTotalSatang !== prevGrand) throw new RangeError('with a chainWarning, prev must be the recomputed chain')
  }
  const expected = expectedCashSatang(input.cash)
  const variance = input.countedCashSatang - expected
  const reason = input.varianceReason?.trim() ?? ''
  if (varianceNeedsReason(variance, input.varianceAlertSatang) && reason === '') {
    throw new RangeError('a cash variance above the alert threshold needs a reason (spec §4.8)')
  }
  const snapshot: ZSnapshot = {
    ...input,
    countLines: tally.lines,
    varianceReason: reason === '' ? null : reason,
    expectedCashSatang: expected,
    cashVarianceSatang: variance,
    qrDifferenceSatang: input.bankQrTotalSatang === null ? null : input.bankQrTotalSatang - input.sales.qrNetSatang,
    grandTotalSatang: prevGrand + input.sales.netSalesSatang,
  }
  return { snapshot, hash: zReportHash(snapshot) }
}
```

- [ ] **Step 3: รันให้ผ่าน**

Run: `pnpm --filter @dayo/domain test && pnpm --filter @dayo/domain typecheck`
Expected: PASS ทุกไฟล์ (เดิม 99 เทสต์ → 115) · typecheck สะอาด

- [ ] **Step 4: Commit**

ใช้ skill `committing-code` แล้ว:
```bash
git add packages/domain/src/shift.ts packages/domain/test/shift.test.ts
git commit -m "feat(domain): shift sales summary, drawer count and a validated z report"
```

---

### Task 2: เพดานเหตุผล 200 ตัวอักษร (void + ส่วนลด) — งานส่งต่อ Task 13 M-4

**Files:**
- Modify: `apps/pos/src/api/types.ts`, `apps/pos/src/api/void.ts`, `apps/pos/src/api/sale.ts`, `apps/pos/src/screens/VoidDialog.tsx`, `apps/pos/src/screens/DiscountDialog.tsx`
- Test: `apps/pos/test/reason-limit.test.ts` (ใหม่)

**Interfaces:**
- Consumes: `voidOrder` (แผน 3 Task 13) · `commitSale` (แผน 3 Task 10) · test helpers `openReadyApi`, `sellSku`, `PINS`
- Produces: `REASON_MAX_LENGTH = 200` (export จาก `apps/pos/src/api/types.ts`) — Task 4, 6, 10, 11 ใช้ต่อ · `voidOrder`/`commitSale` throw `BAD_INPUT` เมื่อเหตุผลหลัง trim ยาวเกิน 200

- [ ] **Step 1: เขียนเทสต์ให้ตก**

`apps/pos/test/reason-limit.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { REASON_MAX_LENGTH } from '../src/api/types'
import { openReadyApi, PINS, sellSku } from './helpers/db'

// Plan 3 Task 13 M-4 (carried to plan 3b): a reason is at most 200 characters — void and discount share the cap.
describe('reason length cap', () => {
  it('is 200 characters', () => {
    expect(REASON_MAX_LENGTH).toBe(200)
  })

  it('a void reason of 201 characters is BAD_INPUT and writes nothing; 200 is accepted', async () => {
    const t = await openReadyApi()
    const sale = await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 })
    const input = { orderId: sale.orderId, actorUserId: t.owner.id, approverUserId: t.other.id, approverPin: PINS.DCm, made: false, refundReference: null }
    await expect(t.api.voidOrder({ ...input, reason: 'ก'.repeat(201) })).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.cashMovement).all()).toEqual([])
    const detail = await t.api.voidOrder({ ...input, reason: `  ${'ก'.repeat(200)}  ` }) // trimmed before counting
    expect(detail.status).toBe('voided')
  })

  it('a discount reason of 201 characters is BAD_INPUT and writes no order', async () => {
    const t = await openReadyApi()
    await expect(sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 }, { amountSatang: 500, reason: 'x'.repeat(201) })).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.order).all()).toEqual([])
    const ok = await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 }, { amountSatang: 500, reason: 'x'.repeat(200) })
    expect(ok.totalSatang).toBe(4000)
  })
})
```

Run: `pnpm --filter @dayo/pos exec vitest run reason-limit`
Expected: FAIL — `REASON_MAX_LENGTH` เป็น `undefined` และเหตุผล 201 ตัวอักษรยังผ่าน

- [ ] **Step 2: เพิ่มค่าคงที่และตรวจที่ API**

แก้ `apps/pos/src/api/types.ts` — ต่อจากบรรทัด `export const PIN_RE = /^\d{4,6}$/` เพิ่ม:
```ts

/** Every free-text reason (void, discount, cash variance, paid-in/out) is at most this many characters (Task 13 M-4 of plan 3). */
export const REASON_MAX_LENGTH = 200
```

แก้ `apps/pos/src/api/void.ts`:
- แทน `import type { OrderDetailDto, VoidOrderInput } from './types'` ด้วย `import { REASON_MAX_LENGTH, type OrderDetailDto, type VoidOrderInput } from './types'`
- ต่อจากบรรทัด `if (reason === '') throw new PosError('BAD_INPUT', 'a void needs a reason')` เพิ่ม:
```ts
  if (reason.length > REASON_MAX_LENGTH) throw new PosError('BAD_INPUT', `a reason is at most ${REASON_MAX_LENGTH} characters`)
```

แก้ `apps/pos/src/api/sale.ts`:
- แทน `import type { CommitSaleInput, CommitSaleResult } from './types'` ด้วย `import { REASON_MAX_LENGTH, type CommitSaleInput, type CommitSaleResult } from './types'`
- ต่อจากบล็อก `if (discount !== null && (!Number.isSafeInteger(discount.amountSatang) || … )) { throw … }` (ก่อน `const device = await requireDevice(db)`) เพิ่ม:
```ts
  if (discount !== null && discount.reason.length > REASON_MAX_LENGTH) throw new PosError('BAD_INPUT', `a reason is at most ${REASON_MAX_LENGTH} characters`)
```

- [ ] **Step 3: `maxLength` ที่ช่องพิมพ์**

แก้ `apps/pos/src/screens/VoidDialog.tsx`:
- แทน `import type { OrderDetailDto } from '../api/types'` ด้วย `import { REASON_MAX_LENGTH, type OrderDetailDto } from '../api/types'`
- แทน `<input data-testid="void-reason" value={reason}` ด้วย `<input data-testid="void-reason" maxLength={REASON_MAX_LENGTH} value={reason}`

แก้ `apps/pos/src/screens/DiscountDialog.tsx`:
- เหนือบรรทัด `import { useCart } from '../app/cart-context'` เพิ่ม `import { REASON_MAX_LENGTH } from '../api/types'`
- แทน `<input data-testid="discount-reason" value={reason}` ด้วย `<input data-testid="discount-reason" maxLength={REASON_MAX_LENGTH} value={reason}`

- [ ] **Step 4: รันให้ผ่าน**

Run: `pnpm --filter @dayo/pos test && pnpm --filter @dayo/pos typecheck`
Expected: PASS ทั้งหมด (เทสต์เดิม 91 + 3)

- [ ] **Step 5: Commit**

ใช้ skill `committing-code` แล้ว:
```bash
git add apps/pos/src/api/types.ts apps/pos/src/api/void.ts apps/pos/src/api/sale.ts apps/pos/src/screens/VoidDialog.tsx apps/pos/src/screens/DiscountDialog.tsx apps/pos/test/reason-limit.test.ts
git commit -m "fix(pos): cap void and discount reasons at 200 characters"
```

---

### Task 3: เปิดกะด่วน — เจ้าของเท่านั้น · เงินทอน 0 · บันทึกแยก (spec §4.8 · M18 · Q3b-10 · D52)

**Files:**
- Modify: `apps/pos/src/api/shift.ts` (แทนทั้งไฟล์), `apps/pos/src/api/types.ts`, `apps/pos/src/api/pos-api.ts`
- Test: `apps/pos/test/quick-open.test.ts` (ใหม่) · `apps/pos/test/shift.test.ts` เดิมต้องผ่านเหมือนเดิม

**Interfaces:**
- Consumes: `currentOpenShift`, `requireDevice` (`bootstrap.ts`) · `enqueueOutbox` · `bangkokDate` · `s.auditLog`
- Produces:
  - `types.ts`: `QuickOpenShiftInput = { userId: string }` · `PosApi.quickOpenShift(input): Promise<ShiftDto>`
  - `shift.ts`: `QUICK_OPEN_ACTION = 'quick_open'` · `openShift` (พฤติกรรมเดิม) · `quickOpenShift(db, deps, input)` — throw `BAD_INPUT` (ผู้ใช้ไม่มี/ปิดใช้) · `NOT_OWNER` · `SHIFT_ALREADY_OPEN` · `NEEDS_SETUP` · `wasQuickOpened(db, shiftId): Promise<boolean>` (Task 5 ใช้)
  - ผลใน DB: แถว `shift` เหมือนเปิดปกติ (`opening_float_satang = 0`) + outbox `shift:<id>` + `audit_log { entity: 'shift', entityId: <shift id>, action: 'quick_open', afterJson: { openingFloatSatang: 0, openedBy }, actorUserId }` ใน transaction เดียวกัน

- [ ] **Step 1: เขียนเทสต์ให้ตก**

`apps/pos/test/quick-open.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { hashPin } from '../src/lib/pin'
import { openTestApi, TEST_PIN_COST, TEST_SETUP } from './helpers/db'

describe('quickOpenShift (spec §4.8 "เปิดกะด่วน" · plan 3 M18 · Q3b-10 · D52)', () => {
  it('an owner opens with a 0 float; a quick_open audit row is written in the same transaction; the shift syncs like any other', async () => {
    const t = await openTestApi()
    await t.api.setupShop(TEST_SETUP)
    const { users } = await t.api.bootstrap()
    const owner = users[0]!
    const shift = await t.api.quickOpenShift({ userId: owner.id })
    expect(shift).toMatchObject({ openingFloatSatang: 0, openedBy: owner.id, businessDate: '2026-09-17' })
    expect((await t.api.bootstrap()).openShift).toEqual(shift)
    const audit = (await t.db.select().from(s.auditLog).all()).filter((a) => a.action === 'quick_open')
    expect(audit).toEqual([
      { id: expect.any(String), entity: 'shift', entityId: shift.id, action: 'quick_open', beforeJson: null, afterJson: { openingFloatSatang: 0, openedBy: owner.id }, actorUserId: owner.id, at: shift.openedAt },
    ])
    expect((await t.db.select().from(s.outbox).all()).map((r) => r.idempotencyKey)).toEqual([`shift:${shift.id}`])
  })

  it('a staff user gets NOT_OWNER and nothing is written; a second open shift is refused', async () => {
    const t = await openTestApi()
    await t.api.setupShop(TEST_SETUP)
    t.raw
      .prepare('insert into "user" (id, display_name, role, pin_hash, is_active, created_at, updated_at, version) values (?, ?, ?, ?, 1, ?, ?, 1)')
      .run('staff-1', 'พนักงาน', 'staff', await hashPin('3333', TEST_PIN_COST), t.clock.now(), t.clock.now())
    await expect(t.api.quickOpenShift({ userId: 'staff-1' })).rejects.toThrow(/^NOT_OWNER: /)
    await expect(t.api.quickOpenShift({ userId: 'nobody' })).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.shift).all()).toEqual([])
    const { users } = await t.api.bootstrap()
    await t.api.openShift({ userId: users[0]!.id, openingFloatSatang: 50_000 })
    await expect(t.api.quickOpenShift({ userId: users[0]!.id })).rejects.toThrow(/^SHIFT_ALREADY_OPEN: /)
    expect((await t.db.select().from(s.auditLog).all()).filter((a) => a.action === 'quick_open')).toEqual([])
  })
})
```

Run: `pnpm --filter @dayo/pos exec vitest run quick-open`
Expected: FAIL — `t.api.quickOpenShift is not a function`

- [ ] **Step 2: เขียน `apps/pos/src/api/shift.ts` ใหม่ทั้งไฟล์ (แยก `insertOpenShift` ให้เปิดกะปกติกับกะด่วนใช้ร่วมกัน)**

```ts
import { and, eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { enqueueOutbox } from '../db/outbox'
import { bangkokDate } from '../lib/clock'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import type { OpenShiftInput, QuickOpenShiftInput, ShiftDto } from './types'

/** audit_log action that marks a "เปิดกะด่วน" (spec §4.8 · plan 3 M18 · Q3b-10 · D52). */
export const QUICK_OPEN_ACTION = 'quick_open'

async function requireActiveUser(db: RemoteDb, userId: string): Promise<typeof s.user.$inferSelect> {
  const user = await db.select().from(s.user).where(eq(s.user.id, userId)).get()
  if (!user || !user.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${userId}`)
  return user
}

/**
 * Inserts the open shift row + its outbox row inside the caller's transaction. spec §4.8: one open shift per
 * device — checked here for a clear error, and enforced by the DB's partial unique index (D47 item 6) as the last
 * line · business_date = Thai calendar date at opening (decision T11).
 */
async function insertOpenShift(tx: RemoteDb, deps: ApiDeps, deviceId: string, userId: string, openingFloatSatang: number): Promise<ShiftDto> {
  if ((await currentOpenShift(tx, deviceId)) !== null) throw new PosError('SHIFT_ALREADY_OPEN', 'close the current shift first')
  const at = deps.now()
  const row = {
    id: deps.newId(),
    deviceId,
    businessDate: bangkokDate(at),
    status: 'open',
    openedBy: userId,
    openedAt: at,
    openingFloatSatang,
    closedBy: null,
    closedAt: null,
  } satisfies typeof s.shift.$inferInsert
  await tx.insert(s.shift).values(row)
  await enqueueOutbox(tx, 'shift', row, at, deps.newId)
  return { id: row.id, businessDate: row.businessDate, openedAt: at, openedBy: userId, openingFloatSatang }
}

export async function openShift(db: RemoteDb, deps: ApiDeps, input: OpenShiftInput): Promise<ShiftDto> {
  const device = await requireDevice(db)
  if (!Number.isSafeInteger(input.openingFloatSatang) || input.openingFloatSatang < 0) {
    throw new PosError('BAD_INPUT', 'opening float must be a whole number of satang >= 0')
  }
  const user = await requireActiveUser(db, input.userId)
  return db.transaction((tx) => insertOpenShift(tx, deps, device.id, user.id, input.openingFloatSatang))
}

/**
 * spec §4.8 "เปิดกะด่วน": an owner opens the shift with a 0 float without counting the drawer. The shift row is the
 * same as a normal one; the separate record is an audit_log row `shift / quick_open` in the same transaction, and the
 * Z report of this shift carries `openedQuick: true` (Q3b-10 · D52).
 */
export async function quickOpenShift(db: RemoteDb, deps: ApiDeps, input: QuickOpenShiftInput): Promise<ShiftDto> {
  const device = await requireDevice(db)
  const user = await requireActiveUser(db, input.userId)
  if (user.role !== 'owner') throw new PosError('NOT_OWNER', `${user.displayName} is not an owner`)
  return db.transaction(async (tx) => {
    const shift = await insertOpenShift(tx, deps, device.id, user.id, 0)
    await tx.insert(s.auditLog).values({
      id: deps.newId(),
      entity: 'shift',
      entityId: shift.id,
      action: QUICK_OPEN_ACTION,
      beforeJson: null,
      afterJson: { openingFloatSatang: 0, openedBy: user.id },
      actorUserId: user.id,
      at: shift.openedAt,
    })
    return shift
  })
}

/** True when the shift was opened with "เปิดกะด่วน". */
export async function wasQuickOpened(db: RemoteDb, shiftId: string): Promise<boolean> {
  const row = await db
    .select({ id: s.auditLog.id })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.entity, 'shift'), eq(s.auditLog.entityId, shiftId), eq(s.auditLog.action, QUICK_OPEN_ACTION)))
    .get()
  return row !== undefined
}
```

- [ ] **Step 3: ต่อเข้า `PosApi`**

แก้ `apps/pos/src/api/types.ts`:
- ต่อจากบรรทัด `export type OpenShiftInput = { userId: string; openingFloatSatang: number }` เพิ่ม:
```ts
/** "เปิดกะด่วน" (spec §4.8): owner only, float 0 (Q3b-10 · D52). */
export type QuickOpenShiftInput = { userId: string }
```
- ใน `interface PosApi` ต่อจาก `voidOrder(input: VoidOrderInput): Promise<OrderDetailDto>` เพิ่ม `quickOpenShift(input: QuickOpenShiftInput): Promise<ShiftDto>`
- แทนบรรทัด `export const POS_API_METHODS = [...] as const` ทั้งบรรทัดด้วย (แตกบรรทัดให้ task ถัดไปต่อท้ายได้ง่าย):
```ts
export const POS_API_METHODS = [
  'bootstrap',
  'setupShop',
  'login',
  'openShift',
  'loadMenu',
  'commitSale',
  'listOrders',
  'getOrder',
  'promptPayForAmount',
  'voidOrder',
  'quickOpenShift',
] as const
```

แก้ `apps/pos/src/api/pos-api.ts`:
- แทน `import { openShift } from './shift'` ด้วย `import { openShift, quickOpenShift } from './shift'`
- ต่อจากบรรทัด `voidOrder: (input) => serial(() => voidOrder(db, deps, input)),` เพิ่ม:
```ts
    quickOpenShift: (input) => serial(() => quickOpenShift(db, deps, input)),
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `pnpm --filter @dayo/pos test && pnpm --filter @dayo/pos typecheck`
Expected: PASS ทั้งหมด (96 เทสต์) รวม `shift.test.ts` เดิม 4 เทสต์ (พฤติกรรม `openShift` ไม่เปลี่ยน)

- [ ] **Step 5: Commit**

ใช้ skill `committing-code` แล้ว:
```bash
git add apps/pos/src/api/shift.ts apps/pos/src/api/types.ts apps/pos/src/api/pos-api.ts apps/pos/test/quick-open.test.ts
git commit -m "feat(pos): quick shift open for owners with a zero float and an audit record"
```

---

### Task 4: บันทึกเงินเข้า / จ่ายออก / นำเงินไปเก็บ (`recordCashMovement` — spec §3.5 · Q3b-9 · D52) 💰 review: opus

**Files:**
- Create: `apps/pos/src/api/cash.ts`
- Modify: `apps/pos/src/api/types.ts`, `apps/pos/src/api/pos-api.ts`
- Test: `apps/pos/test/cash-movement.test.ts` (ใหม่)

**Interfaces:**
- Consumes: `currentOpenShift`, `requireDevice` · `enqueueOutbox` · `REASON_MAX_LENGTH` (Task 2) · `CashMovementKind` (contracts)
- Produces:
  - `types.ts`: `CashMovementInput = { actorUserId: string; kind: 'PAID_IN' | 'PAID_OUT' | 'DROP'; amountSatang: number; reason: string }` · `CashMovementDto = { id; kind: CashMovementKind; amountSatang; orderId: string | null; reason: string | null; createdBy; createdAt }` · `PosApi.recordCashMovement(input): Promise<CashMovementDto>`
  - `cash.ts`: `recordCashMovement(db, deps, input)` — throw `BAD_INPUT` (ชนิด `VOID_REFUND`/อื่น, ยอด ≤ 0 / ไม่ใช่จำนวนเต็ม / เกิน `MAX_CASH_MOVEMENT_SATANG` = 10,000,000, เหตุผลว่างหรือเกิน 200, ผู้ใช้ไม่มี) · `NO_OPEN_SHIFT` · `toCashMovementDto(row)` (Task 5 ใช้) · `MAX_CASH_MOVEMENT_SATANG`
  - ผลใน DB: `cash_movement` (`order_id = null`) + outbox `cash_movement:<id>` ใน transaction เดียว

- [ ] **Step 1: เขียนเทสต์ให้ตก**

`apps/pos/test/cash-movement.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import type { CashMovementInput } from '../src/api/types'
import { openReadyApi, openTestApi, TEST_SETUP, type ReadyApi } from './helpers/db'

const input = (t: ReadyApi, patch: Partial<CashMovementInput> = {}): CashMovementInput => ({ actorUserId: t.owner.id, kind: 'PAID_OUT', amountSatang: 12_000, reason: 'ซื้อน้ำแข็ง', ...patch })

describe('recordCashMovement (spec §3.5 · Q3b-9 · D52)', () => {
  it('writes PAID_IN / PAID_OUT / DROP into the open shift with its outbox row', async () => {
    const t = await openReadyApi()
    const out = await t.api.recordCashMovement(input(t, { reason: '  ซื้อน้ำแข็ง  ' }))
    expect(out).toEqual({ id: expect.any(String), kind: 'PAID_OUT', amountSatang: 12_000, orderId: null, reason: 'ซื้อน้ำแข็ง', createdBy: t.owner.id, createdAt: '2026-09-17T03:00:00.000Z' })
    await t.api.recordCashMovement(input(t, { kind: 'PAID_IN', amountSatang: 50_000, reason: 'เติมเงินทอน' }))
    await t.api.recordCashMovement(input(t, { kind: 'DROP', amountSatang: 30_000, reason: 'เก็บเข้าตู้เซฟ' }))
    const rows = await t.db.select().from(s.cashMovement).all()
    expect(rows.map((r) => [r.kind, r.amountSatang, r.shiftId])).toEqual([
      ['PAID_OUT', 12_000, t.shift.id],
      ['PAID_IN', 50_000, t.shift.id],
      ['DROP', 30_000, t.shift.id],
    ])
    const keys = (await t.db.select().from(s.outbox).all()).map((r) => r.idempotencyKey)
    for (const r of rows) expect(keys).toContain(`cash_movement:${r.id}`)
    expect((await t.api.bootstrap()).pendingSyncItems).toBe(4) // the shift + 3 movements, one each (D50 Q3-26)
  })

  it('refuses VOID_REFUND, bad amounts, no or too long reason, unknown user, and no open shift — writing nothing', async () => {
    const t = await openReadyApi()
    const bad: Partial<CashMovementInput>[] = [
      { kind: 'VOID_REFUND' as CashMovementInput['kind'] },
      { amountSatang: 0 },
      { amountSatang: -100 },
      { amountSatang: 10.5 },
      { amountSatang: 10_000_001 },
      { reason: '   ' },
      { reason: 'ก'.repeat(201) },
      { actorUserId: 'nobody' },
    ]
    for (const patch of bad) await expect(t.api.recordCashMovement(input(t, patch))).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.cashMovement).all()).toEqual([])

    const u = await openTestApi()
    await u.api.setupShop(TEST_SETUP)
    const { users } = await u.api.bootstrap()
    await expect(u.api.recordCashMovement({ actorUserId: users[0]!.id, kind: 'PAID_IN', amountSatang: 100, reason: 'x' })).rejects.toThrow(/^NO_OPEN_SHIFT: /)
  })
})
```

Run: `pnpm --filter @dayo/pos exec vitest run cash-movement`
Expected: FAIL — `t.api.recordCashMovement is not a function`

- [ ] **Step 2: เขียน `apps/pos/src/api/cash.ts`**

```ts
import { eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { enqueueOutbox } from '../db/outbox'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { REASON_MAX_LENGTH, type CashMovementDto, type CashMovementInput } from './types'

const MANUAL_KINDS: readonly string[] = ['PAID_IN', 'PAID_OUT', 'DROP']
/** ฿100,000 — far above any drawer movement of the shop; catches a typo of extra zeros. */
export const MAX_CASH_MOVEMENT_SATANG = 10_000_000

export function toCashMovementDto(r: typeof s.cashMovement.$inferSelect): CashMovementDto {
  return { id: r.id, kind: r.kind, amountSatang: r.amountSatang, orderId: r.orderId, reason: r.reason, createdBy: r.createdBy, createdAt: r.createdAt }
}

/**
 * spec §3.5: PAID_IN / PAID_OUT / DROP are typed in by a person, with a reason, into the open shift (Q3b-9 · D52).
 * VOID_REFUND is never accepted here — voidOrder writes it (D36). One transaction: cash_movement + outbox.
 */
export async function recordCashMovement(db: RemoteDb, deps: ApiDeps, input: CashMovementInput): Promise<CashMovementDto> {
  if (!MANUAL_KINDS.includes(input.kind)) throw new PosError('BAD_INPUT', `kind must be PAID_IN, PAID_OUT or DROP, got ${input.kind}`)
  if (!Number.isSafeInteger(input.amountSatang) || input.amountSatang <= 0 || input.amountSatang > MAX_CASH_MOVEMENT_SATANG) {
    throw new PosError('BAD_INPUT', `amount must be a whole number of satang from 1 to ${MAX_CASH_MOVEMENT_SATANG}`)
  }
  const reason = input.reason.trim()
  if (reason === '') throw new PosError('BAD_INPUT', 'a paid-in / paid-out / drop needs a reason')
  if (reason.length > REASON_MAX_LENGTH) throw new PosError('BAD_INPUT', `a reason is at most ${REASON_MAX_LENGTH} characters`)
  const actor = await db.select().from(s.user).where(eq(s.user.id, input.actorUserId)).get()
  if (!actor || !actor.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${input.actorUserId}`)
  const device = await requireDevice(db)

  return db.transaction(async (tx) => {
    const shift = await currentOpenShift(tx, device.id)
    if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'open a shift first')
    const at = deps.now()
    const row = {
      id: deps.newId(),
      shiftId: shift.id,
      kind: input.kind,
      amountSatang: input.amountSatang,
      orderId: null, // only VOID_REFUND carries an order (D47 item 7 CHECK)
      reason,
      createdBy: actor.id,
      createdAt: at,
    } satisfies typeof s.cashMovement.$inferInsert
    await tx.insert(s.cashMovement).values(row)
    await enqueueOutbox(tx, 'cash_movement', row, at, deps.newId)
    return toCashMovementDto(row)
  })
}
```

- [ ] **Step 3: ต่อเข้า `PosApi`**

แก้ `apps/pos/src/api/types.ts`:
- แทนบรรทัดแรก `import type { UserRole } from '@dayo/contracts'` ด้วย `import type { CashMovementKind, UserRole } from '@dayo/contracts'`
- เหนือคอมเมนต์ `/** Everything the UI may ask of the on-device database. …` เพิ่ม:
```ts
/** A paid-in / paid-out / drop typed in by a person (spec §3.5 · Q3b-9 · D52). VOID_REFUND is written by voidOrder only. */
export type CashMovementInput = { actorUserId: string; kind: 'PAID_IN' | 'PAID_OUT' | 'DROP'; amountSatang: number; reason: string }
export type CashMovementDto = { id: string; kind: CashMovementKind; amountSatang: number; orderId: string | null; reason: string | null; createdBy: string; createdAt: string }

```
- ใน `interface PosApi` ต่อจาก `quickOpenShift(…)` เพิ่ม `recordCashMovement(input: CashMovementInput): Promise<CashMovementDto>`
- ใน `POS_API_METHODS` ต่อจาก `'quickOpenShift',` เพิ่ม `'recordCashMovement',`

แก้ `apps/pos/src/api/pos-api.ts`:
- ต่อจาก `import { bootstrap } from './bootstrap'` เพิ่ม `import { recordCashMovement } from './cash'`
- ต่อจากบรรทัด `quickOpenShift: …` เพิ่ม:
```ts
    recordCashMovement: (input) => serial(() => recordCashMovement(db, deps, input)),
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `pnpm --filter @dayo/pos test && pnpm --filter @dayo/pos typecheck`
Expected: PASS ทั้งหมด (98 เทสต์) · ถ้า insert ตกด้วย CHECK `cash_movement_void_refund_order_ck` แปลว่าส่ง `orderId` ไม่เป็น `null` — แก้โค้ด ห้ามแก้ schema

- [ ] **Step 5: Commit**

ใช้ skill `committing-code` แล้ว:
```bash
git add apps/pos/src/api/cash.ts apps/pos/src/api/types.ts apps/pos/src/api/pos-api.ts apps/pos/test/cash-movement.test.ts
git commit -m "feat(pos): record paid-in, paid-out and drops into the open shift"
```

---

### Task 5: รายงาน X — `shiftReport` (ยอดสดของกะ · เงินในลิ้นชัก · บิลยกเลิกประจำวัน · เบสติดลบ) 💰 review: opus

**Files:**
- Create: `apps/pos/src/api/shift-report.ts`, `apps/pos/test/helpers/shift.ts`
- Modify: `apps/pos/src/api/types.ts`, `apps/pos/src/api/pos-api.ts`
- Test: `apps/pos/test/shift-report.test.ts` (ใหม่)

**Interfaces:**
- Consumes: `summarizeShiftSales`, `cashInputsFromMovements`, `expectedCashSatang`, `DEFAULT_VARIANCE_ALERT_SATANG`, `ShiftOrder`, `ZVoid`, `SalesSummary`, `CashInputs` (Task 1) · `wasQuickOpened` (Task 3) · `toCashMovementDto`, `recordCashMovement` (Task 4) · `countPendingSyncItems`, `currentOpenShift`, `requireDevice` · `getSetting` (`setup.ts`) · payload ของ event `VOIDED` ที่ `voidOrder` เขียน (`reason`, `made`, `approvedBy`, `refundReference`)
- Produces:
  - `types.ts`: `NegativeBaseDto = { itemId; code; name; useUnit; onHandMilli }` · `ShiftReportDto = { shift: ShiftDto & { openedByName: string; openedQuick: boolean }; generatedAt; sales: SalesSummary; cash: CashInputs; expectedCashSatang; varianceAlertSatang; cashMovements: CashMovementDto[]; voids: ZVoid[]; negativeBases: NegativeBaseDto[]; pendingSyncItems }` · `PosApi.shiftReport(): Promise<ShiftReportDto>`
  - `shift-report.ts`: `buildShiftReport(db, shift: ShiftDto, atIso): Promise<ShiftReportDto>` (Task 6 เรียกใน transaction ของ `closeShift`) · `shiftReport(db, deps)` — throw `NO_OPEN_SHIFT` · `varianceAlertSatang(db, atIso): Promise<number>` · `VARIANCE_ALERT_SETTING_KEY = 'cash.variance_alert_satang'`
  - `test/helpers/shift.ts`: `sellVoidScenario(t: ReadyApi): Promise<Scenario>` · `COUNT_520` (Task 6, 7 ใช้)
  - นิยาม (T3b-8, T3b-9): บิลของกะ = `order.shift_id = กะ`, มี `receipt_no`, status `paid`/`voided` · เบสติดลบ = `item.kind = 'prepared'` + `is_tracked` + `on_hand_milli < 0` เรียงตาม code · รายการยกเลิกอ่านจาก event `VOIDED` · ไม่เขียนอะไรลง DB

- [ ] **Step 1: ตัวช่วยเทสต์ + เทสต์ให้ตก**

`apps/pos/test/helpers/shift.ts`
```ts
import type { CommitSaleResult } from '../../src/api/types'
import { PINS, sellSku, type ReadyApi } from './db'

export type Scenario = { cashVoided: CommitSaleResult; qrVoided: CommitSaleResult; cashKept: CommitSaleResult }

/**
 * One shift of every kind of row (float ฿500 from openReadyApi):
 * A-000001 Original 16oz ×2 cash ฿90 → voided, not made (VOID_REFUND ฿90, ingredients back)
 * A-000002 Latte 16oz ×1 PromptPay ฿50 → voided, made (refund reference KBANK-1, waste)
 * A-000003 Original 16oz ×1 cash ฿45 − ฿5 discount = ฿40
 * PAID_OUT ฿20 "ซื้อน้ำแข็ง"
 * → gross 185 · discount 5 · voided 140 · net 40 · cash sales 130 · QR 50 · expected cash 500 + 130 − 90 − 20 = ฿520
 */
export async function sellVoidScenario(t: ReadyApi): Promise<Scenario> {
  const cashVoided = await sellSku(t, 'Original-16oz', 2, { method: 'CASH', tenderedSatang: 10_000 })
  const qrVoided = await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
  const cashKept = await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 5_000 }, { amountSatang: 500, reason: 'ลูกค้าประจำ' })
  t.clock.advanceMs(60_000)
  const base = { actorUserId: t.owner.id, approverUserId: t.other.id, approverPin: PINS.DCm }
  await t.api.voidOrder({ ...base, orderId: cashVoided.orderId, reason: 'กดผิดเมนู', made: false, refundReference: null })
  await t.api.voidOrder({ ...base, orderId: qrVoided.orderId, reason: 'ทำผิดสูตร', made: true, refundReference: 'KBANK-1' })
  await t.api.recordCashMovement({ actorUserId: t.owner.id, kind: 'PAID_OUT', amountSatang: 2_000, reason: 'ซื้อน้ำแข็ง' })
  return { cashVoided, qrVoided, cashKept }
}

/** Notes/coins that add up to exactly ฿520 (the scenario's expected cash). */
export const COUNT_520 = [
  { denominationSatang: 50_000, count: 1 },
  { denominationSatang: 2_000, count: 1 },
]
```

`apps/pos/test/shift-report.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { openReadyApi, openTestApi, TEST_SETUP } from './helpers/db'
import { sellVoidScenario } from './helpers/shift'

describe('shiftReport — X report (spec §4.8: live, any time, writes nothing)', () => {
  it('sums sales, cash and voids of the open shift exactly (D36 · spec §4.3 · Q3b-4 · D52)', async () => {
    const t = await openReadyApi()
    const sc = await sellVoidScenario(t)
    const before = await t.db.select().from(s.outbox).all()
    const x = await t.api.shiftReport()
    expect(await t.db.select().from(s.outbox).all()).toEqual(before) // an X report writes nothing

    expect(x.shift).toMatchObject({ id: t.shift.id, openedByName: 'TungAo', openedQuick: false, openingFloatSatang: 50_000 })
    expect(x.generatedAt).toBe('2026-09-17T03:01:00.000Z')
    expect(x.sales).toEqual({ orderCount: 3, voidCount: 2, grossSalesSatang: 18_500, discountSatang: 500, voidedSatang: 14_000, netSalesSatang: 4_000, cashSalesSatang: 13_000, qrSalesSatang: 5_000, qrRefundedSatang: 5_000, qrNetSatang: 0 })
    expect(x.cash).toEqual({ openingFloatSatang: 50_000, cashSalesSatang: 13_000, voidRefundsSatang: 9_000, paidInSatang: 0, paidOutSatang: 2_000, dropsSatang: 0 })
    expect(x.expectedCashSatang).toBe(52_000)
    expect(x.varianceAlertSatang).toBe(2_000) // spec §3.1 default — no setting row yet
    expect(x.cashMovements.map((m) => [m.kind, m.amountSatang])).toEqual([
      ['VOID_REFUND', 9_000],
      ['PAID_OUT', 2_000],
    ])
    // the daily void report (D50 Q3-22): reason, approver, made/waste, QR refund reference read from the VOIDED event (plan 3 notes §5)
    expect(x.voids).toEqual([
      { orderId: sc.cashVoided.orderId, receiptNo: 'A-000001', totalSatang: 9_000, method: 'CASH', reason: 'กดผิดเมนู', made: false, approvedBy: t.other.id, approvedByName: 'DCm', refundReference: null, voidedAt: '2026-09-17T03:01:00.000Z' },
      { orderId: sc.qrVoided.orderId, receiptNo: 'A-000002', totalSatang: 5_000, method: 'PROMPTPAY', reason: 'ทำผิดสูตร', made: true, approvedBy: t.other.id, approvedByName: 'DCm', refundReference: 'KBANK-1', voidedAt: '2026-09-17T03:01:00.000Z' },
    ])
    // D28: tracked bases below zero only (ice and other untracked items never show)
    expect(x.negativeBases.map((b) => [b.code, b.onHandMilli])).toEqual([
      ['PB-SYRUP', -47_200],
      ['PB-TEA-THAI', -260_000],
    ])
    expect(x.pendingSyncItems).toBe(5) // shift + 3 bills + the PAID_OUT (D50 Q3-26)
  })

  it('an empty shift is all zeros; expected cash = the float', async () => {
    const t = await openReadyApi()
    const x = await t.api.shiftReport()
    expect(x.sales.orderCount).toBe(0)
    expect(x.expectedCashSatang).toBe(50_000)
    expect(x.voids).toEqual([])
  })

  it('shows a quick-opened shift (Q3b-10 · D52) and needs an open shift', async () => {
    const t = await openTestApi()
    await t.api.setupShop(TEST_SETUP)
    const { users } = await t.api.bootstrap()
    await expect(t.api.shiftReport()).rejects.toThrow(/^NO_OPEN_SHIFT: /)
    await t.api.quickOpenShift({ userId: users[0]!.id })
    expect((await t.api.shiftReport()).shift.openedQuick).toBe(true)
  })

  it('uses the cash.variance_alert_satang setting when one is in force (spec §3.1)', async () => {
    const t = await openReadyApi()
    await t.db.insert(s.setting).values({ key: 'cash.variance_alert_satang', valueJson: 5_000, effectiveFrom: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', version: 1 })
    expect((await t.api.shiftReport()).varianceAlertSatang).toBe(5_000)
  })
})
```

Run: `pnpm --filter @dayo/pos exec vitest run shift-report`
Expected: FAIL — `t.api.shiftReport is not a function`

- [ ] **Step 2: เขียน `apps/pos/src/api/shift-report.ts`**

```ts
import { and, asc, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { cashInputsFromMovements, DEFAULT_VARIANCE_ALERT_SATANG, expectedCashSatang, summarizeShiftSales, type ShiftOrder, type ZVoid } from '@dayo/domain'
import { toCashMovementDto } from './cash'
import { countPendingSyncItems, currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { getSetting } from './setup'
import { wasQuickOpened } from './shift'
import type { NegativeBaseDto, ShiftDto, ShiftReportDto } from './types'

/** spec §3.1 setting key; not seeded — the default ฿20 applies until plan 5 syncs a value. */
export const VARIANCE_ALERT_SETTING_KEY = 'cash.variance_alert_satang'

export async function varianceAlertSatang(db: RemoteDb, atIso: string): Promise<number> {
  const v = await getSetting(db, VARIANCE_ALERT_SETTING_KEY, atIso)
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : DEFAULT_VARIANCE_ALERT_SATANG
}

/** The VOIDED event payload written by voidOrder (plan 3 Task 13) — the only place the QR refund reference lives (plan 3 notes §5). */
function voidFromEvent(order: typeof s.order.$inferSelect, method: 'CASH' | 'PROMPTPAY', payload: unknown, names: ReadonlyMap<string, string>): ZVoid {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  if (typeof p['reason'] !== 'string' || typeof p['made'] !== 'boolean' || typeof p['approvedBy'] !== 'string' || order.receiptNo === null || order.voidedAt === null) {
    throw new PosError('BAD_INPUT', `voided order ${order.id} has no readable VOIDED event`)
  }
  const ref = p['refundReference']
  return {
    orderId: order.id,
    receiptNo: order.receiptNo,
    totalSatang: order.totalSatang,
    method,
    reason: p['reason'],
    made: p['made'],
    approvedBy: p['approvedBy'],
    approvedByName: names.get(p['approvedBy']) ?? p['approvedBy'],
    refundReference: typeof ref === 'string' ? ref : null,
    voidedAt: order.voidedAt,
  }
}

async function negativeBases(db: RemoteDb): Promise<NegativeBaseDto[]> {
  const rows = await db
    .select({ itemId: s.item.id, code: s.item.code, name: s.item.name, useUnit: s.item.useUnit, onHandMilli: s.itemCostState.onHandMilli })
    .from(s.itemCostState)
    .innerJoin(s.item, eq(s.item.id, s.itemCostState.itemId))
    // D28: only tracked bases — untracked items keep a meaningless negative on-hand row (plan 3 notes §5 → plan 4)
    .where(and(eq(s.item.kind, 'prepared'), eq(s.item.isTracked, true), lt(s.itemCostState.onHandMilli, 0)))
    .orderBy(asc(s.item.code))
    .all()
  return rows
}

/**
 * Everything the X report shows and the Z report freezes, computed from the rows of one shift (spec §4.8).
 * Only receipts (paid, or paid then voided) count; money math is all in @dayo/domain.
 */
export async function buildShiftReport(db: RemoteDb, shift: ShiftDto, atIso: string): Promise<ShiftReportDto> {
  const users = await db.select({ id: s.user.id, displayName: s.user.displayName }).from(s.user).all()
  const names = new Map(users.map((u) => [u.id, u.displayName]))
  const orders = await db
    .select()
    .from(s.order)
    .where(and(eq(s.order.shiftId, shift.id), isNotNull(s.order.receiptNo), inArray(s.order.status, ['paid', 'voided'])))
    .orderBy(asc(s.order.receiptNo))
    .all()
  const ids = orders.map((o) => o.id)
  const payments = ids.length === 0 ? [] : await db.select().from(s.payment).where(inArray(s.payment.orderId, ids)).all()
  const shiftOrders: ShiftOrder[] = orders.map((o) => ({
    id: o.id,
    status: o.status === 'voided' ? 'voided' : 'paid',
    subtotalSatang: o.subtotalSatang,
    discountSatang: o.discountSatang,
    totalSatang: o.totalSatang,
    payments: payments.filter((p) => p.orderId === o.id).map((p) => ({ method: p.method, amountSatang: p.amountSatang })),
  }))
  let sales
  try {
    sales = summarizeShiftSales(shiftOrders)
  } catch (e) {
    throw new PosError('BAD_INPUT', e instanceof Error ? e.message : String(e))
  }

  const movements = await db.select().from(s.cashMovement).where(eq(s.cashMovement.shiftId, shift.id)).orderBy(asc(s.cashMovement.createdAt), asc(s.cashMovement.id)).all()
  const cash = cashInputsFromMovements(shift.openingFloatSatang, sales.cashSalesSatang, movements)

  const voided = orders.filter((o) => o.status === 'voided')
  const voidEvents =
    voided.length === 0
      ? []
      : await db.select().from(s.orderEvent).where(and(inArray(s.orderEvent.orderId, voided.map((o) => o.id)), eq(s.orderEvent.type, 'VOIDED'))).all()
  const voids = voided.map((o) => {
    const ev = voidEvents.find((e) => e.orderId === o.id)
    const method = payments.find((p) => p.orderId === o.id)?.method === 'PROMPTPAY' ? 'PROMPTPAY' : 'CASH'
    return voidFromEvent(o, method, ev?.payloadJson, names)
  })

  return {
    shift: { ...shift, openedByName: names.get(shift.openedBy) ?? shift.openedBy, openedQuick: await wasQuickOpened(db, shift.id) },
    generatedAt: atIso,
    sales,
    cash,
    expectedCashSatang: expectedCashSatang(cash),
    varianceAlertSatang: await varianceAlertSatang(db, atIso),
    cashMovements: movements.map(toCashMovementDto),
    voids,
    negativeBases: await negativeBases(db),
    pendingSyncItems: await countPendingSyncItems(db),
  }
}

/** X report of the open shift (spec §4.8: computed live, any time, nothing written). */
export async function shiftReport(db: RemoteDb, deps: ApiDeps): Promise<ShiftReportDto> {
  const device = await requireDevice(db)
  const shift = await currentOpenShift(db, device.id)
  if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'no open shift')
  return buildShiftReport(db, shift, deps.now())
}
```

- [ ] **Step 3: ต่อเข้า `PosApi`**

แก้ `apps/pos/src/api/types.ts`:
- ต่อจากบรรทัด `import type { CashMovementKind, UserRole } from '@dayo/contracts'` เพิ่ม `import type { CashInputs, SalesSummary, ZVoid } from '@dayo/domain'`
- ต่อจาก `export type CashMovementDto = …` (ก่อนคอมเมนต์ `/** Everything the UI may ask …`) เพิ่ม:
```ts
/** A tracked base (prepared item) whose stock went negative — shown before closing the shift (D28). */
export type NegativeBaseDto = { itemId: string; code: string; name: string; useUnit: string; onHandMilli: number }

/** X report: the open shift computed live, any time (spec §4.8). */
export type ShiftReportDto = {
  shift: ShiftDto & { openedByName: string; openedQuick: boolean }
  generatedAt: string
  sales: SalesSummary
  cash: CashInputs
  expectedCashSatang: number
  varianceAlertSatang: number
  cashMovements: CashMovementDto[]
  voids: ZVoid[]
  negativeBases: NegativeBaseDto[]
  pendingSyncItems: number
}

```
- ใน `interface PosApi` ต่อจาก `recordCashMovement(…)` เพิ่ม `shiftReport(): Promise<ShiftReportDto>`
- ใน `POS_API_METHODS` ต่อจาก `'recordCashMovement',` เพิ่ม `'shiftReport',`

แก้ `apps/pos/src/api/pos-api.ts`:
- ต่อจาก `import { openShift, quickOpenShift } from './shift'` เพิ่ม `import { shiftReport } from './shift-report'`
- ต่อจากบรรทัด `recordCashMovement: …` เพิ่ม:
```ts
    shiftReport: () => serial(() => shiftReport(db, deps)),
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `pnpm --filter @dayo/pos test && pnpm --filter @dayo/pos typecheck`
Expected: PASS ทั้งหมด (102 เทสต์) · ตัวเลขใน `sellVoidScenario` คิดมือแล้ว: gross 185 · ส่วนลด 5 · ยกเลิก 140 · net 40 · เงินสด 130 · QR 50 (โอนคืน 50 · สุทธิ 0) · ควรมี 500 + 130 − 90 − 20 = ฿520 · ถ้าเบสติดลบไม่ตรง `PB-SYRUP −47200` / `PB-TEA-THAI −260000` ให้ตรวจสูตรใน seed (`Original`/`Latte` 16oz 50%) ก่อนแก้โค้ด

- [ ] **Step 5: Commit**

ใช้ skill `committing-code` แล้ว:
```bash
git add apps/pos/src/api/shift-report.ts apps/pos/src/api/types.ts apps/pos/src/api/pos-api.ts apps/pos/test/helpers/shift.ts apps/pos/test/shift-report.test.ts
git commit -m "feat(pos): live x report with drawer cash, daily voids and negative bases"
```

---

### Task 6: ปิดกะ — `closeShift` (cash_count + Z แช่แข็งด้วยแฮช + shift closed) · `listZReports` · `getZReport` 💰 review: opus

**Files:**
- Create: `apps/pos/src/api/close.ts`
- Modify: `apps/pos/src/api/types.ts`, `apps/pos/src/api/errors.ts`, `apps/pos/src/api/pos-api.ts`, `apps/pos/src/db/outbox.ts`, `apps/pos/src/ui/errors.ts`, `apps/pos/src/ui/th.ts`
- Test: `apps/pos/test/close-shift.test.ts` (ใหม่)

**Interfaces:**
- Consumes: `buildZReport`, `recomputeZChain`, `tallyCashCount`, `varianceNeedsReason`, `zReportHash`, `ZSnapshot`, `ZChainWarning`, `CashCountLine` (Task 1) · `buildShiftReport` (Task 5) · `requireOwnerPin` (แผน 3 — ตัวนับ PIN ผิด D50 Q3-21) · `REASON_MAX_LENGTH` (Task 2) · `enqueueOutbox` · `sellVoidScenario`, `COUNT_520` (Task 5)
- Produces:
  - `types.ts`: `CloseShiftInput = { actorUserId; approverUserId; approverPin; countLines: CashCountLine[]; shownExpectedCashSatang: number; varianceReason: string | null; bankQrTotalSatang: number | null; acknowledgeZChainBroken: boolean }` · `ZReportDto = { id; shiftId; createdAt; hash; hashOk: boolean; snapshot: ZSnapshot }` · `ZReportSummaryDto = { shiftId; businessDate; zNo; closedAt; netSalesSatang; cashVarianceSatang; openedQuick; hashOk; chainWarning: boolean }` · `PosApi.closeShift(input): Promise<ZReportDto>` · `listZReports(): Promise<ZReportSummaryDto[]>` (เรียงตาม `zNo` ไม่ใช้เวลา) · `getZReport(shiftId): Promise<ZReportDto>`
  - `errors.ts`: `SHIFT_CHANGED` (detail `shown <X>, now <Y>`) · `VARIANCE_REASON_REQUIRED` · `Z_NOT_FOUND` · `Z_CHAIN_BROKEN` (detail = shiftId ของ Z ที่แฮชไม่ตรง — Q3b-11 · D53)
  - `close.ts`: `closeShift` · `listZReports` · `getZReport` · `deviceZRows(db, deviceId)` (Task 7 ใช้) · `Z_CHAIN_ACK_ACTION = 'z_chain_broken_ack'`
  - `outbox.ts`: `OutboxTable` + `'cash_count' | 'z_report'`
  - ผลใน DB (1 transaction): `cash_count` + outbox `cash_count:<id>` · `z_report` (snapshot + hash) + outbox `z_report:<id>` · (ถ้ารับทราบ Z เสีย) `audit_log { entity: 'z_report', entityId: <z id>, action: 'z_chain_broken_ack', beforeJson: { brokenShiftId, storedGrandTotalSatang }, afterJson: { zNo, recomputedGrandTotalSatang }, actorUserId: <เจ้าของ> }` · UPDATE `shift` → `closed` + outbox `shift:<id>:closed` · ลำดับตรวจ: นับเงิน → ยอดแอปธนาคาร → ความยาวเหตุผล → ผู้ใช้ → PIN เจ้าของ (นอก transaction) → กะเปิด → `SHIFT_CHANGED` → เหตุผลส่วนต่าง → Z ก่อนหน้า (แฮชไม่ตรงและยังไม่รับทราบ → `Z_CHAIN_BROKEN`) → `buildZReport`

- [ ] **Step 1: เขียนเทสต์ให้ตก**

`apps/pos/test/close-shift.test.ts`
```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { zReportHash } from '@dayo/domain'
import type { CloseShiftInput } from '../src/api/types'
import { hashPin } from '../src/lib/pin'
import { openReadyApi, PINS, sellSku, TEST_PIN_COST, type ReadyApi } from './helpers/db'
import { COUNT_520, sellVoidScenario } from './helpers/shift'

function closeInput(t: ReadyApi, patch: Partial<CloseShiftInput> = {}): CloseShiftInput {
  return { actorUserId: t.owner.id, approverUserId: t.owner.id, approverPin: PINS.TungAo, countLines: COUNT_520, shownExpectedCashSatang: 52_000, varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: false, ...patch }
}

function counts(t: ReadyApi): Record<string, number> {
  const out: Record<string, number> = {}
  for (const table of ['cash_count', 'z_report', 'outbox']) out[table] = (t.raw.prepare(`select count(*) as c from "${table}"`).get() as { c: number }).c
  out['open_shift'] = (t.raw.prepare(`select count(*) as c from shift where status = 'open'`).get() as { c: number }).c
  return out
}

describe('closeShift — count by denomination, frozen Z (spec §4.8, D22, D36)', () => {
  it('writes cash_count + z_report + shift closed in one transaction, each with its outbox row', async () => {
    const t = await openReadyApi()
    const sc = await sellVoidScenario(t)
    t.clock.set('2026-09-17T13:05:00.000Z')
    const z = await t.api.closeShift(closeInput(t, { actorUserId: t.other.id }))

    expect(z.hashOk).toBe(true)
    expect(z.hash).toBe(zReportHash(z.snapshot))
    expect(z.snapshot).toMatchObject({
      shiftId: t.shift.id,
      businessDate: '2026-09-17',
      deviceId: t.device.id,
      zNo: 1,
      openedAt: t.shift.openedAt,
      openedBy: t.owner.id,
      openedQuick: false,
      closedAt: '2026-09-17T13:05:00.000Z',
      closedBy: t.owner.id,
      countedBy: t.other.id,
      sales: { orderCount: 3, voidCount: 2, grossSalesSatang: 18_500, discountSatang: 500, voidedSatang: 14_000, netSalesSatang: 4_000, cashSalesSatang: 13_000, qrSalesSatang: 5_000, qrRefundedSatang: 5_000, qrNetSatang: 0 },
      cash: { openingFloatSatang: 50_000, cashSalesSatang: 13_000, voidRefundsSatang: 9_000, paidInSatang: 0, paidOutSatang: 2_000, dropsSatang: 0 },
      countedCashSatang: 52_000,
      expectedCashSatang: 52_000,
      cashVarianceSatang: 0,
      varianceAlertSatang: 2_000,
      varianceReason: null,
      bankQrTotalSatang: null,
      qrDifferenceSatang: null,
      chainWarning: null,
      grandTotalSatang: 4_000,
    })
    expect(z.snapshot.countLines).toHaveLength(9)
    expect(z.snapshot.voids.map((v) => [v.receiptNo, v.refundReference])).toEqual([['A-000001', null], ['A-000002', 'KBANK-1']])
    expect(z.snapshot.voids[0]!.orderId).toBe(sc.cashVoided.orderId)

    const count = await t.db.select().from(s.cashCount).get()
    expect(count).toMatchObject({ shiftId: t.shift.id, countedSatang: 52_000, expectedSatang: 52_000, varianceSatang: 0, reason: null, countedBy: t.other.id })
    const shift = await t.db.select().from(s.shift).where(eq(s.shift.id, t.shift.id)).get()
    expect(shift).toMatchObject({ status: 'closed', closedBy: t.owner.id, closedAt: '2026-09-17T13:05:00.000Z' })
    const keys = (await t.db.select().from(s.outbox).all()).map((r) => r.idempotencyKey)
    expect(keys).toContain(`cash_count:${count!.id}`)
    expect(keys).toContain(`z_report:${z.id}`)
    expect(keys).toContain(`shift:${t.shift.id}:closed`)

    const boot = await t.api.bootstrap()
    expect(boot.openShift).toBeNull()
    expect(await t.api.getZReport(t.shift.id)).toEqual(z)
    expect(await t.api.listZReports()).toEqual([{ shiftId: t.shift.id, businessDate: '2026-09-17', zNo: 1, closedAt: '2026-09-17T13:05:00.000Z', netSalesSatang: 4_000, cashVarianceSatang: 0, openedQuick: false, hashOk: true, chainWarning: false }])
    // after the close: no selling, no void, no second close (spec §4.8, D47 ข้อ 2)
    await expect(sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 })).rejects.toThrow(/^NO_OPEN_SHIFT: /)
    await expect(t.api.voidOrder({ orderId: sc.cashKept.orderId, actorUserId: t.owner.id, approverUserId: t.owner.id, approverPin: PINS.TungAo, reason: 'x', made: false, refundReference: null })).rejects.toThrow(/^VOID_NOT_ALLOWED: /)
    await expect(t.api.closeShift(closeInput(t))).rejects.toThrow(/^NO_OPEN_SHIFT: /)
  })

  it('a variance above ฿20 needs a reason — without one nothing is written; with one it is kept (spec §4.8)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    // ฿500 counted, ฿520 expected → −฿20, which is not above the ฿20 threshold: no reason needed
    const z0 = await t.api.closeShift(closeInput(t, { countLines: [{ denominationSatang: 50_000, count: 1 }] }))
    expect(z0.snapshot).toMatchObject({ cashVarianceSatang: -2_000, varianceReason: null })

    const u = await openReadyApi()
    await sellVoidScenario(u)
    // ฿470 counted → −฿50
    const shorter = [{ denominationSatang: 10_000, count: 4 }, { denominationSatang: 5_000, count: 1 }, { denominationSatang: 2_000, count: 1 }]
    const before2 = counts(u)
    await expect(u.api.closeShift(closeInput(u, { countLines: shorter }))).rejects.toThrow(/^VARIANCE_REASON_REQUIRED: /)
    await expect(u.api.closeShift(closeInput(u, { countLines: shorter, varianceReason: '   ' }))).rejects.toThrow(/^VARIANCE_REASON_REQUIRED: /)
    expect(counts(u)).toEqual(before2)
    const z = await u.api.closeShift(closeInput(u, { countLines: shorter, varianceReason: ' ทอนเงินผิด ' }))
    expect(z.snapshot).toMatchObject({ countedCashSatang: 47_000, cashVarianceSatang: -5_000, varianceReason: 'ทอนเงินผิด' })
    expect(await u.db.select().from(s.cashCount).get()).toMatchObject({ varianceSatang: -5_000, reason: 'ทอนเงินผิด' })
  })

  it('refuses a stale expected cash (SHIFT_CHANGED), bad counts, a wrong PIN and a staff approver — writing nothing', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    t.raw
      .prepare('insert into "user" (id, display_name, role, pin_hash, is_active, created_at, updated_at, version) values (?, ?, ?, ?, 1, ?, ?, 1)')
      .run('staff-1', 'พนักงาน', 'staff', await hashPin('3333', TEST_PIN_COST), t.clock.now(), t.clock.now())
    const before = counts(t)
    await expect(t.api.closeShift(closeInput(t, { shownExpectedCashSatang: 50_000 }))).rejects.toThrow(/^SHIFT_CHANGED: /)
    await expect(t.api.closeShift(closeInput(t, { countLines: [{ denominationSatang: 2_500, count: 1 }] }))).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.closeShift(closeInput(t, { countLines: [{ denominationSatang: 100, count: -1 }] }))).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.closeShift(closeInput(t, { varianceReason: 'ก'.repeat(201) }))).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.closeShift(closeInput(t, { approverPin: '9999' }))).rejects.toThrow(/^PIN_WRONG: /)
    await expect(t.api.closeShift(closeInput(t, { approverUserId: 'staff-1', approverPin: '3333' }))).rejects.toThrow(/^NOT_OWNER: /)
    expect(counts(t)).toEqual(before)
  })

  it('grand total runs across shifts: Z(n).grand = Z(n−1).grand + net (spec §4.8); a quick-opened shift is marked', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    const z1 = await t.api.closeShift(closeInput(t))
    t.clock.set('2026-09-18T02:00:00.000Z')
    await t.api.quickOpenShift({ userId: t.owner.id })
    await sellSku(t, 'Latte-16oz', 2, { method: 'CASH', tenderedSatang: 10_000 })
    const x = await t.api.shiftReport()
    expect(x.expectedCashSatang).toBe(10_000) // float 0 + ฿100
    const z2 = await t.api.closeShift({ ...closeInput(t), countLines: [{ denominationSatang: 10_000, count: 1 }], shownExpectedCashSatang: 10_000 })
    expect(z2.snapshot).toMatchObject({ businessDate: '2026-09-18', zNo: 2, openedQuick: true, grandTotalSatang: z1.snapshot.grandTotalSatang + 10_000 })
    expect((await t.api.listZReports()).map((z) => z.businessDate)).toEqual(['2026-09-18', '2026-09-17'])
  })

  it('the grand total follows the Z number, not the clock (a clock set back cannot skip a Z)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    t.clock.set('2026-09-18T13:00:00.000Z') // tablet clock a day ahead
    const z1 = await t.api.closeShift(closeInput(t))
    t.clock.set('2026-09-17T14:00:00.000Z') // corrected
    for (const n of [2, 3]) {
      await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
      await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' })
      const z = await t.api.closeShift({ ...closeInput(t), countLines: [], shownExpectedCashSatang: 0 })
      expect(z.snapshot).toMatchObject({ zNo: n, grandTotalSatang: z1.snapshot.grandTotalSatang + 5_000 * (n - 1) })
      t.clock.advanceMs(3_600_000)
    }
  })


  it('freezes the bank-app PromptPay total and the QR difference — optional, never blocks (Q3b-12 · D53)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t) // QR ฿50 received and ฿50 transferred back
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' }) // + ฿50 → received ฿100 · refunded ฿50 · net ฿50
    await expect(t.api.closeShift(closeInput(t, { bankQrTotalSatang: -1 }))).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.closeShift(closeInput(t, { bankQrTotalSatang: 10.5 }))).rejects.toThrow(/^BAD_INPUT: /)
    // acknowledging when nothing is broken changes nothing
    const z = await t.api.closeShift(closeInput(t, { bankQrTotalSatang: 4_500, acknowledgeZChainBroken: true }))
    expect(z.snapshot.sales).toMatchObject({ qrSalesSatang: 10_000, qrRefundedSatang: 5_000, qrNetSatang: 5_000 })
    expect(z.snapshot).toMatchObject({ bankQrTotalSatang: 4_500, qrDifferenceSatang: -500, chainWarning: null })
  })

  it('the Z report is append-only in the DB, and a tampered snapshot fails its hash (spec §7 invariant 6)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    await t.api.closeShift(closeInput(t))
    expect(() => t.raw.prepare('update z_report set hash = ?').run('x')).toThrow(/append-only/)
    expect(() => t.raw.prepare('delete from z_report').run()).toThrow(/append-only/)
    // Simulate someone editing the file by hand (drop the guard first): the hash no longer matches.
    t.raw.exec('DROP TRIGGER z_report_no_update')
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.sales.netSalesSatang', 1)`).run()
    expect((await t.api.getZReport(t.shift.id)).hashOk).toBe(false)
    expect(await t.api.listZReports()).toMatchObject([{ hashOk: false, chainWarning: false }])
  })

  it('a previous Z that fails its hash: Z_CHAIN_BROKEN until an owner acknowledges with their PIN, then the new Z chains from the recomputed total and is flagged for good (Q3b-11 · D53)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    const z1 = await t.api.closeShift(closeInput(t)) // net ฿40 → grand ฿40
    t.raw.exec('DROP TRIGGER z_report_no_update')
    t.raw.prepare(`update z_report set snapshot_json = json_set(snapshot_json, '$.grandTotalSatang', 999)`).run() // the stored total is edited

    t.clock.set('2026-09-18T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    await sellSku(t, 'Latte-16oz', 1, { method: 'PROMPTPAY' }) // net ฿50
    const next = { ...closeInput(t), countLines: [], shownExpectedCashSatang: 0 }
    const before = counts(t)
    await expect(t.api.closeShift(next)).rejects.toThrow(new RegExp(`^Z_CHAIN_BROKEN: ${z1.shiftId}$`))
    await expect(t.api.closeShift({ ...next, acknowledgeZChainBroken: true, approverPin: '9999' })).rejects.toThrow(/^PIN_WRONG: /)
    expect(counts(t)).toEqual(before) // nothing written until the owner acknowledges with a correct PIN

    const z2 = await t.api.closeShift({ ...next, acknowledgeZChainBroken: true })
    expect(z2.hashOk).toBe(true)
    expect(z2.snapshot).toMatchObject({
      zNo: 2,
      grandTotalSatang: 4_000 + 5_000, // recomputed Σ net of the earlier snapshots (฿40), never the edited 999
      chainWarning: { brokenShiftId: z1.shiftId, storedGrandTotalSatang: 999, recomputedGrandTotalSatang: 4_000, acknowledgedBy: t.owner.id },
    })
    const ack = (await t.db.select().from(s.auditLog).all()).filter((a) => a.action === 'z_chain_broken_ack')
    expect(ack).toEqual([
      {
        id: expect.any(String),
        entity: 'z_report',
        entityId: z2.id,
        action: 'z_chain_broken_ack',
        beforeJson: { brokenShiftId: z1.shiftId, storedGrandTotalSatang: 999 },
        afterJson: { zNo: 2, recomputedGrandTotalSatang: 4_000 },
        actorUserId: t.owner.id,
        at: '2026-09-18T02:00:00.000Z',
      },
    ])
    expect((await t.api.listZReports()).map((z) => [z.zNo, z.hashOk, z.chainWarning])).toEqual([
      [2, true, true],
      [1, false, false],
    ])

    // the flagged Z itself is intact, so the next close chains from it normally, without a new warning
    t.clock.set('2026-09-19T02:00:00.000Z')
    await t.api.openShift({ userId: t.owner.id, openingFloatSatang: 0 })
    const z3 = await t.api.closeShift({ ...closeInput(t), countLines: [], shownExpectedCashSatang: 0 })
    expect(z3.snapshot).toMatchObject({ zNo: 3, grandTotalSatang: 9_000, chainWarning: null })
  })
})
```

Run: `pnpm --filter @dayo/pos exec vitest run close-shift`
Expected: FAIL — `t.api.closeShift is not a function`

- [ ] **Step 2: error ใหม่ + ข้อความไทย + ตาราง outbox**

แก้ `apps/pos/src/api/errors.ts` — ต่อจากบรรทัด `  | 'VOID_NOT_ALLOWED'` เพิ่ม:
```ts
  | 'SHIFT_CHANGED' // closeShift: the expected cash moved after the screen showed it — detail "shown <X>, now <Y>"
  | 'VARIANCE_REASON_REQUIRED' // spec §4.8: over/short above cash.variance_alert_satang
  | 'Z_NOT_FOUND'
  | 'Z_CHAIN_BROKEN' // Q3b-11 · D53: the previous Z fails its hash — detail = its shiftId; retry with acknowledgeZChainBroken
```

แก้ `apps/pos/src/ui/th.ts` — ต่อจากบรรทัด `  errRefundRefRequired: 'ต้องใส่เลขอ้างอิงการโอนคืน',` เพิ่ม:
```ts
  errShiftChanged: 'ยอดในกะเปลี่ยนระหว่างนับเงิน — ดูยอดใหม่แล้วยืนยันอีกครั้ง',
  errVarianceReasonRequired: 'เงินขาด/เกินเกินเกณฑ์ ต้องใส่เหตุผล',
  errZNotFound: 'ไม่พบรายงาน Z',
  errZChainBroken: 'รายงาน Z ใบก่อนหน้าถูกแก้ไขหรือไฟล์เสีย (ลายเซ็นไม่ตรง) — เจ้าของกรอก PIN อีกครั้งเพื่อรับทราบ แล้วปิดกะต่อได้ (Z ใบนี้จะมีป้ายเตือนถาวร)',
```

แก้ `apps/pos/src/ui/errors.ts` — ใน `MESSAGES` ต่อจาก `  VOID_NOT_ALLOWED: TH.errVoidNotAllowed,` เพิ่ม:
```ts
  SHIFT_CHANGED: TH.errShiftChanged,
  VARIANCE_REASON_REQUIRED: TH.errVarianceReasonRequired,
  Z_NOT_FOUND: TH.errZNotFound,
  Z_CHAIN_BROKEN: TH.errZChainBroken,
```

แก้ `apps/pos/src/db/outbox.ts` — แทนบรรทัด `export type OutboxTable = …` ด้วย:
```ts
export type OutboxTable = 'order' | 'order_line' | 'payment' | 'discount' | 'order_event' | 'stock_movement' | 'shift' | 'cash_movement' | 'cash_count' | 'z_report'
```

- [ ] **Step 3: เขียน `apps/pos/src/api/close.ts`**

```ts
import { desc, eq, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { buildZReport, recomputeZChain, tallyCashCount, varianceNeedsReason, zReportHash, type ZChainWarning, type ZSnapshot } from '@dayo/domain'
import { enqueueOutbox } from '../db/outbox'
import { requireOwnerPin } from './auth'
import { currentOpenShift, requireDevice } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { buildShiftReport } from './shift-report'
import { REASON_MAX_LENGTH, type CloseShiftInput, type ZReportDto, type ZReportSummaryDto } from './types'

/** audit_log action written when an owner acknowledges a previous Z that fails its hash (Q3b-11 · D53). */
export const Z_CHAIN_ACK_ACTION = 'z_chain_broken_ack'

type ZRow = typeof s.zReport.$inferSelect

/** z_report.snapshot_json is written only by closeShift from buildZReport — read back as that shape; hashOk proves it is untouched. */
function toZReportDto(row: ZRow): ZReportDto {
  return { id: row.id, shiftId: row.shiftId, createdAt: row.createdAt, hash: row.hash, hashOk: zReportHash(row.snapshotJson) === row.hash, snapshot: row.snapshotJson as ZSnapshot }
}

/** Newest first by `zNo` (the frozen snapshot), never by `created_at` — a device clock can be wrong and later
 * corrected, and the grand-total chain must not depend on it (see domain `buildZReport`). Exported for backup.ts. */
export async function deviceZRows(db: RemoteDb, deviceId: string): Promise<ZRow[]> {
  const rows = await db
    .select({ z: s.zReport })
    .from(s.zReport)
    .innerJoin(s.shift, eq(s.shift.id, s.zReport.shiftId))
    .where(eq(s.shift.deviceId, deviceId))
    .orderBy(desc(sql`json_extract(${s.zReport.snapshotJson}, '$.zNo')`), desc(s.zReport.id))
    .all()
  return rows.map((r) => r.z)
}

/** A number read from a snapshot that may have been edited by hand — null unless it is a safe integer. */
function safeIntOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null
}

type ZChain = { prev: { zNo: number; grandTotalSatang: number } | null; broken: { shiftId: string; storedGrandTotalSatang: number | null } | null }

/**
 * Z(n).zNo = Z(n−1).zNo + 1 and Z(n).grand = Z(n−1).grand + net (spec §4.8) — the previous Z of this device, or null
 * for the first one. Q3b-11 · D53: if that Z fails its hash, its stored numbers are not trusted — the chain is
 * recomputed from every snapshot of this device in `zNo` order (`recomputeZChain`) and `broken` says which Z it was.
 */
async function zChain(db: RemoteDb, deviceId: string): Promise<ZChain> {
  const rows = await deviceZRows(db, deviceId)
  const last = rows[0]
  if (last === undefined) return { prev: null, broken: null }
  const dto = toZReportDto(last)
  if (dto.hashOk) return { prev: { zNo: dto.snapshot.zNo, grandTotalSatang: dto.snapshot.grandTotalSatang }, broken: null }
  const nets = [...rows].reverse().map((r) => {
    const snap = r.snapshotJson as { sales?: { netSalesSatang?: unknown } } | null
    return safeIntOrNull(snap?.sales?.netSalesSatang) ?? Number.NaN // NaN → RangeError in recomputeZChain
  })
  const stored = (last.snapshotJson as { grandTotalSatang?: unknown } | null)?.grandTotalSatang
  return { prev: recomputeZChain(nets), broken: { shiftId: last.shiftId, storedGrandTotalSatang: safeIntOrNull(stored) } }
}

/**
 * spec §4.8 + D22 + D36: close the open shift. One transaction writes cash_count, the frozen z_report (snapshot +
 * hash, never recomputed) and the shift status change, each with its outbox row (spec §6.1). The drawer count is by
 * denomination (Q3b-1); a variance above `cash.variance_alert_satang` needs a reason; an owner confirms with their
 * PIN (Q3b-2); if the shift changed after the screen showed the expected cash, nothing is written (SHIFT_CHANGED).
 * The bank-app QR total is optional and frozen with its difference (Q3b-12). A previous Z that fails its hash stops the
 * close with Z_CHAIN_BROKEN until the owner acknowledges it by entering their PIN again (Q3b-11 · D53): the new Z then
 * chains from the recomputed total, carries `chainWarning` for good, and an audit row records the acknowledgement.
 */
export async function closeShift(db: RemoteDb, deps: ApiDeps, input: CloseShiftInput): Promise<ZReportDto> {
  let tally: ReturnType<typeof tallyCashCount>
  try {
    tally = tallyCashCount(input.countLines)
  } catch (e) {
    throw new PosError('BAD_INPUT', e instanceof Error ? e.message : String(e))
  }
  if (!Number.isSafeInteger(input.shownExpectedCashSatang)) throw new PosError('BAD_INPUT', 'shownExpectedCashSatang must be whole satang')
  if (input.bankQrTotalSatang !== null && (!Number.isSafeInteger(input.bankQrTotalSatang) || input.bankQrTotalSatang < 0)) {
    throw new PosError('BAD_INPUT', 'bankQrTotalSatang must be a whole number of satang >= 0, or null')
  }
  const reason = input.varianceReason?.trim() ?? ''
  if (reason.length > REASON_MAX_LENGTH) throw new PosError('BAD_INPUT', `a reason is at most ${REASON_MAX_LENGTH} characters`)
  const actor = await db.select().from(s.user).where(eq(s.user.id, input.actorUserId)).get()
  if (!actor || !actor.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${input.actorUserId}`)
  // argon2 is slow — check the PIN before opening the transaction (same as voidOrder).
  const approver = await requireOwnerPin(db, deps, input.approverUserId, input.approverPin)
  const device = await requireDevice(db)

  return db.transaction(async (tx) => {
    const shift = await currentOpenShift(tx, device.id)
    if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'no open shift to close')
    const at = deps.now()
    const report = await buildShiftReport(tx, shift, at)
    if (report.expectedCashSatang !== input.shownExpectedCashSatang) {
      throw new PosError('SHIFT_CHANGED', `shown ${input.shownExpectedCashSatang}, now ${report.expectedCashSatang}`)
    }
    const variance = tally.totalSatang - report.expectedCashSatang
    if (varianceNeedsReason(variance, report.varianceAlertSatang) && reason === '') {
      throw new PosError('VARIANCE_REASON_REQUIRED', `variance ${variance} is above ${report.varianceAlertSatang}`)
    }

    let chain: ZChain
    try {
      chain = await zChain(tx, device.id)
    } catch (e) {
      if (e instanceof RangeError) throw new PosError('BAD_INPUT', e.message)
      throw e
    }
    if (chain.broken !== null && !input.acknowledgeZChainBroken) throw new PosError('Z_CHAIN_BROKEN', chain.broken.shiftId)
    const chainWarning: ZChainWarning | null =
      chain.broken === null
        ? null
        : {
            brokenShiftId: chain.broken.shiftId,
            storedGrandTotalSatang: chain.broken.storedGrandTotalSatang,
            recomputedGrandTotalSatang: chain.prev?.grandTotalSatang ?? 0,
            acknowledgedBy: approver.id,
          }

    let z: ReturnType<typeof buildZReport>
    try {
      z = buildZReport(
        {
          shiftId: shift.id,
          businessDate: shift.businessDate,
          deviceId: device.id,
          zNo: (chain.prev?.zNo ?? 0) + 1,
          openedAt: shift.openedAt,
          openedBy: shift.openedBy,
          openedQuick: report.shift.openedQuick,
          closedAt: at,
          closedBy: approver.id,
          countedBy: actor.id,
          sales: report.sales,
          cash: report.cash,
          countLines: tally.lines,
          countedCashSatang: tally.totalSatang,
          varianceAlertSatang: report.varianceAlertSatang,
          varianceReason: reason === '' ? null : reason,
          voids: report.voids,
          bankQrTotalSatang: input.bankQrTotalSatang,
          chainWarning,
        },
        chain.prev,
      )
    } catch (e) {
      if (e instanceof RangeError) throw new PosError('BAD_INPUT', e.message)
      throw e
    }

    const countRow = {
      id: deps.newId(),
      shiftId: shift.id,
      countedSatang: tally.totalSatang,
      expectedSatang: report.expectedCashSatang,
      varianceSatang: variance,
      reason: z.snapshot.varianceReason,
      linesJson: tally.lines,
      countedBy: actor.id,
      createdAt: at,
    } satisfies typeof s.cashCount.$inferInsert
    await tx.insert(s.cashCount).values(countRow)
    await enqueueOutbox(tx, 'cash_count', countRow, at, deps.newId)

    // z_report is append-only (trigger) and unique per shift: a second close of the same shift cannot happen.
    const zRow = { id: deps.newId(), shiftId: shift.id, snapshotJson: z.snapshot, hash: z.hash, createdAt: at } satisfies typeof s.zReport.$inferInsert
    await tx.insert(s.zReport).values(zRow)
    await enqueueOutbox(tx, 'z_report', zRow, at, deps.newId)

    if (chainWarning !== null) {
      await tx.insert(s.auditLog).values({
        id: deps.newId(),
        entity: 'z_report',
        entityId: zRow.id,
        action: Z_CHAIN_ACK_ACTION,
        beforeJson: { brokenShiftId: chainWarning.brokenShiftId, storedGrandTotalSatang: chainWarning.storedGrandTotalSatang },
        afterJson: { zNo: z.snapshot.zNo, recomputedGrandTotalSatang: chainWarning.recomputedGrandTotalSatang },
        actorUserId: approver.id,
        at,
      })
    }

    // The only UPDATE of shift in this plan: open → closed (spec §3.5 columns closed_by/closed_at/status; no trigger on shift).
    await tx.update(s.shift).set({ status: 'closed', closedBy: approver.id, closedAt: at }).where(eq(s.shift.id, shift.id))
    const shiftRow = await tx.select().from(s.shift).where(eq(s.shift.id, shift.id)).get()
    if (!shiftRow) throw new PosError('NO_OPEN_SHIFT', shift.id)
    await enqueueOutbox(tx, 'shift', shiftRow, at, deps.newId, 'closed')

    return toZReportDto(zRow)
  })
}

/** Z reports of this device, newest first (Q3b-5: view on screen, no export). */
export async function listZReports(db: RemoteDb): Promise<ZReportSummaryDto[]> {
  const device = await requireDevice(db)
  return (await deviceZRows(db, device.id)).map((row) => {
    const z = toZReportDto(row)
    return {
      shiftId: z.shiftId,
      businessDate: z.snapshot.businessDate,
      zNo: z.snapshot.zNo,
      closedAt: z.snapshot.closedAt,
      netSalesSatang: z.snapshot.sales.netSalesSatang,
      cashVarianceSatang: z.snapshot.cashVarianceSatang,
      openedQuick: z.snapshot.openedQuick,
      hashOk: z.hashOk,
      chainWarning: z.snapshot.chainWarning != null,
    }
  })
}

export async function getZReport(db: RemoteDb, shiftId: string): Promise<ZReportDto> {
  const row = await db.select().from(s.zReport).where(eq(s.zReport.shiftId, shiftId)).get()
  if (!row) throw new PosError('Z_NOT_FOUND', shiftId)
  return toZReportDto(row)
}
```

- [ ] **Step 4: ต่อเข้า `PosApi`**

แก้ `apps/pos/src/api/types.ts`:
- แทน `import type { CashInputs, SalesSummary, ZVoid } from '@dayo/domain'` ด้วย `import type { CashCountLine, CashInputs, SalesSummary, ZSnapshot, ZVoid } from '@dayo/domain'`
- ต่อจาก `export type ShiftReportDto = { … }` (ก่อนคอมเมนต์ `/** Everything the UI may ask …`) เพิ่ม:
```ts
export type CloseShiftInput = {
  /** Signed-in user who counted the drawer. */
  actorUserId: string
  /** Owner who confirms the close with their PIN (spec §5 "ปิดวันต้อง owner" · Q3b-2 · D52). */
  approverUserId: string
  approverPin: string
  countLines: CashCountLine[]
  /** Expected cash the screen showed after the count — refused with SHIFT_CHANGED if the shift moved meanwhile. */
  shownExpectedCashSatang: number
  varianceReason: string | null
  /** PromptPay total read from the bank app for this shift; optional, no threshold (Q3b-12 · D53). */
  bankQrTotalSatang: number | null
  /** true only after a Z_CHAIN_BROKEN refusal, when the owner re-enters their PIN to acknowledge it (Q3b-11 · D53). */
  acknowledgeZChainBroken: boolean
}

export type ZReportDto = { id: string; shiftId: string; createdAt: string; hash: string; hashOk: boolean; snapshot: ZSnapshot }
export type ZReportSummaryDto = {
  shiftId: string
  businessDate: string
  zNo: number
  closedAt: string
  netSalesSatang: number
  cashVarianceSatang: number
  openedQuick: boolean
  hashOk: boolean
  /** This Z was closed after acknowledging a previous Z that failed its hash (Q3b-11 · D53). */
  chainWarning: boolean
}

```
- ใน `interface PosApi` ต่อจาก `shiftReport(): Promise<ShiftReportDto>` เพิ่ม:
```ts
  closeShift(input: CloseShiftInput): Promise<ZReportDto>
  listZReports(): Promise<ZReportSummaryDto[]>
  getZReport(shiftId: string): Promise<ZReportDto>
```
- ใน `POS_API_METHODS` ต่อจาก `'shiftReport',` เพิ่ม `'closeShift',` `'listZReports',` `'getZReport',` (บรรทัดละตัว)

แก้ `apps/pos/src/api/pos-api.ts`:
- ต่อจาก `import { recordCashMovement } from './cash'` เพิ่ม `import { closeShift, getZReport, listZReports } from './close'`
- ต่อจากบรรทัด `shiftReport: …` เพิ่ม:
```ts
    closeShift: (input) => serial(() => closeShift(db, deps, input)),
    listZReports: () => serial(() => listZReports(db)),
    getZReport: (shiftId) => serial(() => getZReport(db, shiftId)),
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `pnpm --filter @dayo/pos test && pnpm --filter @dayo/pos typecheck`
Expected: PASS ทั้งหมด (110 เทสต์ — `close-shift` 8) · เทสต์ "append-only" ยืนยันว่า trigger ของแผน 2 กัน UPDATE/DELETE `z_report` · ถ้า `update shift` ตกด้วย trigger แปลว่ามีคนเพิ่ม trigger ให้ `shift` → หยุดและแจ้ง (T3b-4 ต้องตัดสินใหม่)

- [ ] **Step 6: Commit**

ใช้ skill `committing-code` แล้ว:
```bash
git add apps/pos/src/api/close.ts apps/pos/src/api/types.ts apps/pos/src/api/errors.ts apps/pos/src/api/pos-api.ts apps/pos/src/db/outbox.ts apps/pos/src/ui/errors.ts apps/pos/src/ui/th.ts apps/pos/test/close-shift.test.ts
git commit -m "feat(pos): close the shift with a denomination count, bank qr total and a hash-frozen z report"
```

---

### Task 7: สำรองไฟล์ฐานข้อมูล — `exportBackup` (เจ้าของเท่านั้น) + `confirmBackupSaved` + `backupDue` + เวลาไทยสำหรับชื่อไฟล์/กะค้างข้ามวัน

**Files:**
- Create: `apps/pos/src/api/backup.ts`, `apps/pos/src/lib/clock-stamp.test.ts`, `apps/pos/test/backup.test.ts`
- Modify: `apps/pos/src/api/types.ts`, `apps/pos/src/api/deps.ts`, `apps/pos/src/api/errors.ts`, `apps/pos/src/api/bootstrap.ts`, `apps/pos/src/api/pos-api.ts`, `apps/pos/src/db/worker.ts`, `apps/pos/src/lib/clock.ts`, `apps/pos/src/ui/errors.ts`, `apps/pos/src/ui/th.ts`, `apps/pos/test/helpers/db.ts`, `apps/pos/test/init.test.ts`

**Interfaces:**
- Consumes: `SAHPoolUtil.exportFile(filename): Promise<Uint8Array>` ของ `@sqlite.org/sqlite-wasm` (spike I3 — ได้ 1,531,904 ไบต์บน desktop) · `requireDevice` · `bangkokDate` · `deviceZRows`, `closeShift` (Task 6 — `closeShift` ใช้ในเทสต์) · `COUNT_520`, `sellVoidScenario` (Task 5)
- Produces:
  - `deps.ts`: `ApiDeps.exportDbFile: () => Promise<Uint8Array>` (Worker = `pool.exportFile(DB_FILE)` · เทสต์ = `vacuumInto(raw)`)
  - `types.ts`: `BootstrapState` + `lastBackupAt: string | null` + `backupDue: boolean` · `BackupFileDto = { fileName: string; bytes: Uint8Array; createdAt: string; lastZId: string | null }` · `ConfirmBackupInput = { actorUserId: string; fileName: string; byteLength: number; createdAt: string; lastZId: string | null }` · `PosApi.exportBackup(actorUserId: string): Promise<BackupFileDto>` · `PosApi.confirmBackupSaved(input: ConfirmBackupInput): Promise<void>`
  - `errors.ts`: `BACKUP_FAILED`
  - `backup.ts`: `LAST_BACKUP_KEY = 'local.last_backup_at'` · `LAST_BACKUP_Z_ID_KEY = 'local.last_backup_z_id'` · `isSqliteFile(bytes): boolean` · `backupFileName(device, atIso)` — `dayo-pos-<prefix>-<YYYYMMDD-HHmmss เวลาไทย>.sqlite3` (Q3b-6 · D52) · `lastBackupAt(db)` · `lastBackupZId(db)` · `isBackupDue(db, deviceId, lastBackupZId)` — เทียบ id ของ Z ล่าสุด ไม่ใช้เวลา (Q3b-7 · D52) · `exportBackup(db, deps, actorUserId)` — เจ้าของเท่านั้น (`NOT_OWNER` — Q3b-13 · D53) · คืนไฟล์ + id ของ Z ล่าสุดในไฟล์ · **ไม่บันทึกอะไร** (review I-4) · `confirmBackupSaved(db, deps, input)` — เจ้าของเท่านั้น · ตรวจว่าชื่อไฟล์ตรงกับเครื่องและเวลา export · Z เป็นของเครื่องนี้ · แล้วบันทึก `sync_state` 2 คีย์ + `audit_log` `backup` ใน transaction เดียว
  - `clock.ts`: `bangkokStamp(iso): string` · `STALE_SHIFT_CUTOFF_HOURS = 5` · `isShiftStale(businessDate, nowIso, cutoffHours?): boolean` (Q3b-8 · D52 — Task 10 ใช้)
  - `test/helpers/db.ts`: `vacuumInto(raw: DatabaseSync): Uint8Array`

- [ ] **Step 1: เขียนเทสต์ให้ตก**

`apps/pos/src/lib/clock-stamp.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { bangkokStamp, isShiftStale, STALE_SHIFT_CUTOFF_HOURS } from './clock'

describe('bangkokStamp', () => {
  it('formats the Thai local date and time for file names', () => {
    expect(bangkokStamp('2026-09-17T03:00:00.000Z')).toBe('20260917-100000')
    expect(bangkokStamp('2026-09-17T17:00:00.000Z')).toBe('20260918-000000') // midnight is 00, not 24
  })
})

describe('isShiftStale (Q3b-8 · D52)', () => {
  it('after-midnight sales stay on the same business day until 05:00 Thai time (spec §4.7)', () => {
    expect(STALE_SHIFT_CUTOFF_HOURS).toBe(5)
    expect(isShiftStale('2026-09-17', '2026-09-17T16:59:00.000Z')).toBe(false) // 23:59 on the 17th
    expect(isShiftStale('2026-09-17', '2026-09-17T21:59:00.000Z')).toBe(false) // 04:59 on the 18th
    expect(isShiftStale('2026-09-17', '2026-09-17T22:00:00.000Z')).toBe(true) // 05:00 on the 18th
    expect(isShiftStale('2026-09-17', '2026-09-20T03:00:00.000Z')).toBe(true)
  })
})
```

`apps/pos/test/backup.test.ts`
```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { createPosApi } from '../src/api/pos-api'
import { isSqliteFile } from '../src/api/backup'
import type { BackupFileDto, CloseShiftInput, ConfirmBackupInput } from '../src/api/types'
import { hashPin } from '../src/lib/pin'
import { openReadyApi, PINS, TEST_PIN_COST, type ReadyApi } from './helpers/db'
import { COUNT_520, sellVoidScenario } from './helpers/shift'

const close520 = (t: ReadyApi): CloseShiftInput => ({
  actorUserId: t.owner.id, approverUserId: t.owner.id, approverPin: PINS.TungAo, countLines: COUNT_520, shownExpectedCashSatang: 52_000,
  varianceReason: null, bankQrTotalSatang: null, acknowledgeZChainBroken: false,
})
const confirmOf = (t: ReadyApi, file: BackupFileDto): ConfirmBackupInput => ({ actorUserId: t.owner.id, fileName: file.fileName, byteLength: file.bytes.byteLength, createdAt: file.createdAt, lastZId: file.lastZId })
const backupAudit = async (t: ReadyApi) => (await t.db.select().from(s.auditLog).all()).filter((a) => a.action === 'backup')

describe('exportBackup / confirmBackupSaved (spec §11 · spike I3 · Q3b-6/7 · D52 · review I-4)', () => {
  it('exports a complete SQLite copy named by device and Thai time, and records nothing until the owner confirms it', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    t.clock.set('2026-09-17T13:10:00.000Z')
    const file = await t.api.exportBackup(t.owner.id)
    expect(file.fileName).toBe('dayo-pos-A-20260917-201000.sqlite3')
    expect(file.createdAt).toBe('2026-09-17T13:10:00.000Z')
    expect(file.lastZId).toBeNull() // no Z yet
    expect(isSqliteFile(file.bytes)).toBe(true)

    // the copy opens as a database holding every bill and the hash-chained events
    const path = join(mkdtempSync(join(tmpdir(), 'dayo-restore-')), file.fileName)
    writeFileSync(path, file.bytes)
    const copy = new DatabaseSync(path)
    expect(copy.prepare('select receipt_no, status from "order" order by receipt_no').all().map((r) => ({ ...r }))).toEqual([
      { receipt_no: 'A-000001', status: 'voided' },
      { receipt_no: 'A-000002', status: 'voided' },
      { receipt_no: 'A-000003', status: 'paid' },
    ])
    expect((copy.prepare('select count(*) as c from order_event').get() as { c: number }).c).toBeGreaterThan(0)
    copy.close()

    // I-4: a download gives no success signal — the export alone is not a backup
    expect((await t.api.bootstrap()).lastBackupAt).toBeNull()
    expect(await backupAudit(t)).toEqual([])

    t.clock.set('2026-09-17T13:12:00.000Z')
    await t.api.confirmBackupSaved(confirmOf(t, file))
    expect((await t.api.bootstrap()).lastBackupAt).toBe('2026-09-17T13:10:00.000Z') // the time of the data in the file
    expect(await backupAudit(t)).toEqual([
      {
        id: expect.any(String),
        entity: 'device',
        entityId: t.device.id,
        action: 'backup',
        beforeJson: null,
        afterJson: { fileName: file.fileName, bytes: file.bytes.byteLength, exportedAt: file.createdAt, lastZId: null },
        actorUserId: t.owner.id,
        at: '2026-09-17T13:12:00.000Z',
      },
    ])
  })

  it('backupDue: false before any Z, true after a close, still true after an export alone, false once confirmed (Q3b-7 · D52)', async () => {
    const t = await openReadyApi()
    await sellVoidScenario(t)
    const early = await t.api.exportBackup(t.owner.id) // taken before the close
    expect((await t.api.bootstrap()).backupDue).toBe(false)
    const z = await t.api.closeShift(close520(t))
    expect((await t.api.bootstrap()).backupDue).toBe(true)
    await t.api.confirmBackupSaved(confirmOf(t, early)) // a file without the latest Z does not clear the banner
    expect((await t.api.bootstrap()).backupDue).toBe(true)
    t.clock.advanceMs(1_000)
    const file = await t.api.exportBackup(t.owner.id)
    expect(file.lastZId).toBe(z.id)
    expect((await t.api.bootstrap()).backupDue).toBe(true)
    await t.api.confirmBackupSaved(confirmOf(t, file))
    expect((await t.api.bootstrap()).backupDue).toBe(false)
  })

  it('owner only (Q3b-13 · D53); a failing or non-SQLite export is BACKUP_FAILED; a confirmation must match an export — nothing recorded', async () => {
    const t = await openReadyApi()
    t.raw
      .prepare('insert into "user" (id, display_name, role, pin_hash, is_active, created_at, updated_at, version) values (?, ?, ?, ?, 1, ?, ?, 1)')
      .run('staff-1', 'พนักงาน', 'staff', await hashPin('3333', TEST_PIN_COST), t.clock.now(), t.clock.now())
    await expect(t.api.exportBackup('staff-1')).rejects.toThrow(/^NOT_OWNER: /)
    await expect(t.api.exportBackup('nobody')).rejects.toThrow(/^BAD_INPUT: /)
    const broken = createPosApi(t.db, { ...t.deps, exportDbFile: async () => { throw new Error('NotReadableError') } })
    await expect(broken.exportBackup(t.owner.id)).rejects.toThrow(/^BACKUP_FAILED: /)
    const garbage = createPosApi(t.db, { ...t.deps, exportDbFile: async () => new Uint8Array(4096) })
    await expect(garbage.exportBackup(t.owner.id)).rejects.toThrow(/^BACKUP_FAILED: /)

    const ok = confirmOf(t, await t.api.exportBackup(t.owner.id))
    await expect(t.api.confirmBackupSaved({ ...ok, actorUserId: 'staff-1' })).rejects.toThrow(/^NOT_OWNER: /)
    await expect(t.api.confirmBackupSaved({ ...ok, fileName: 'dayo-pos-B-20260917-100000.sqlite3' })).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.confirmBackupSaved({ ...ok, createdAt: 'yesterday' })).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.confirmBackupSaved({ ...ok, byteLength: 0 })).rejects.toThrow(/^BAD_INPUT: /)
    await expect(t.api.confirmBackupSaved({ ...ok, lastZId: 'no-such-z' })).rejects.toThrow(/^BAD_INPUT: /)
    expect((await t.api.bootstrap()).lastBackupAt).toBeNull()
    expect(await backupAudit(t)).toEqual([])
  })
})
```

แก้ `apps/pos/test/init.test.ts` — แทน
`expect(await api.bootstrap()).toEqual({ needsSetup: true, device: null, users: [], openShift: null, pendingSyncItems: 0 })`
ด้วย
```ts
    expect(await api.bootstrap()).toEqual({ needsSetup: true, device: null, users: [], openShift: null, pendingSyncItems: 0, lastBackupAt: null, backupDue: false })
```

Run: `pnpm --filter @dayo/pos exec vitest run backup clock-stamp init`
Expected: FAIL — `bangkokStamp is not a function` · `t.api.exportBackup is not a function` · `init` ไม่มี `lastBackupAt`

- [ ] **Step 2: เวลาไทยใน `apps/pos/src/lib/clock.ts`**

- ต่อจากบรรทัด `const BANGKOK_DATE = new Intl.DateTimeFormat(…)` เพิ่ม:
```ts
const BANGKOK_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
```
- เหนือคอมเมนต์ `/** Adds whole days to a YYYY-MM-DD date. */` เพิ่ม:
```ts
/** "20260917-100000" (Thai local date and time) for file names. */
export function bangkokStamp(iso: string): string {
  return `${bangkokDate(iso).replaceAll('-', '')}-${BANGKOK_TIME.format(new Date(iso)).replaceAll(':', '')}`
}

/** Q3b-8 · D52: 05:00 Thai time. */
export const STALE_SHIFT_CUTOFF_HOURS = 5

/**
 * Q3b-8 · D52: the open shift is "stale" once the Thai clock, shifted back by `cutoffHours`, is on a later date than the
 * shift's business date — after-midnight sales stay on the same day (spec §4.7) until the cutoff hour.
 */
export function isShiftStale(businessDate: string, nowIso: string, cutoffHours: number = STALE_SHIFT_CUTOFF_HOURS): boolean {
  return bangkokDate(new Date(Date.parse(nowIso) - cutoffHours * 3_600_000).toISOString()) > businessDate
}

```

- [ ] **Step 3: `exportDbFile` ใน deps, Worker และตัวช่วยเทสต์**

แก้ `apps/pos/src/api/deps.ts` — ใน `type ApiDeps` ต่อจาก `pinCost: PinCost` เพิ่ม:
```ts
  /** The whole database file (opfs-sahpool `exportFile` in the Worker · `VACUUM INTO` in tests) — spec §11, spike I3. */
  exportDbFile: () => Promise<Uint8Array>
```

แก้ `apps/pos/src/db/worker.ts` — แทนบรรทัด `return createPosApi(db, { now: () => new Date().toISOString(), newId, pinCost: PROD_PIN_COST })` ด้วย:
```ts
    // spike I3: the pool copies the database file; PosApi calls it inside its serial queue (no open transaction).
    return createPosApi(db, { now: () => new Date().toISOString(), newId, pinCost: PROD_PIN_COST, exportDbFile: () => pool.exportFile(DB_FILE) })
```

แก้ `apps/pos/test/helpers/db.ts`:
- เหนือ `import { DatabaseSync } from 'node:sqlite'` เพิ่ม:
```ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
```
- เหนือ `export type TestApi = …` เพิ่ม:
```ts
/** Test stand-in for opfs-sahpool `exportFile`: a consistent copy of the in-memory database via `VACUUM INTO`. */
export function vacuumInto(raw: DatabaseSync): Uint8Array {
  const file = join(mkdtempSync(join(tmpdir(), 'dayo-backup-')), 'copy.sqlite3')
  raw.prepare('VACUUM INTO ?').run(file)
  return new Uint8Array(readFileSync(file))
}

```
- ใน `openTestApi` แทนบรรทัด `const deps: ApiDeps = { now: clock.now, newId: sequentialIds(), pinCost: { ...TEST_PIN_COST } }` ด้วย:
```ts
  const deps: ApiDeps = { now: clock.now, newId: sequentialIds(), pinCost: { ...TEST_PIN_COST }, exportDbFile: async () => vacuumInto(raw) }
```

- [ ] **Step 4: เขียน `apps/pos/src/api/backup.ts`**

```ts
import { eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { bangkokStamp } from '../lib/clock'
import { requireDevice } from './bootstrap'
import { deviceZRows } from './close'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import type { BackupFileDto, ConfirmBackupInput, DeviceDto } from './types'

/** sync_state key (local only, never synced): when the last backup file the owner confirmed as saved was exported. */
export const LAST_BACKUP_KEY = 'local.last_backup_at'
/** sync_state key (local only) holding the id of the last Z report a confirmed backup covered — `isBackupDue` chains on
 * this id, not on a timestamp, because a device clock can be wrong and later corrected (see domain `buildZReport`). */
export const LAST_BACKUP_Z_ID_KEY = 'local.last_backup_z_id'

/** Every SQLite 3 database file starts with these 16 bytes ("SQLite format 3\0"). */
const SQLITE_HEADER = 'SQLite format 3\u0000'

export function isSqliteFile(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 100) return false
  for (let i = 0; i < SQLITE_HEADER.length; i++) if (bytes[i] !== SQLITE_HEADER.charCodeAt(i)) return false
  return true
}

/** "dayo-pos-A-20260917-201000.sqlite3" — receipt prefix + Thai local time of the export (Q3b-6 · D52). */
export function backupFileName(device: DeviceDto, atIso: string): string {
  return `dayo-pos-${device.receiptPrefix}-${bangkokStamp(atIso)}.sqlite3`
}

export async function lastBackupAt(db: RemoteDb): Promise<string | null> {
  const row = await db.select().from(s.syncState).where(eq(s.syncState.key, LAST_BACKUP_KEY)).get()
  return row?.value ?? null
}

export async function lastBackupZId(db: RemoteDb): Promise<string | null> {
  const row = await db.select().from(s.syncState).where(eq(s.syncState.key, LAST_BACKUP_Z_ID_KEY)).get()
  return row?.value ?? null
}

/** Q3b-7 · D52: a backup is due when a Z report of this device was closed after the last one a confirmed backup
 * covered (or none was ever confirmed). Compares the latest Z's id, not a timestamp — a device clock can be wrong and
 * later corrected, and a Z stamped in the future must not keep this banner on after a real backup. */
export async function isBackupDue(db: RemoteDb, deviceId: string, lastBackupZId: string | null): Promise<boolean> {
  const last = (await deviceZRows(db, deviceId))[0]
  return last !== undefined && last.id !== lastBackupZId
}

/** Q3b-13 · D53: the file holds every PIN hash and the shop's PromptPay id — only an active owner may export or confirm it. */
async function requireActiveOwner(db: RemoteDb, userId: string): Promise<typeof s.user.$inferSelect> {
  const u = await db.select().from(s.user).where(eq(s.user.id, userId)).get()
  if (!u || !u.isActive) throw new PosError('BAD_INPUT', `unknown or inactive user ${userId}`)
  if (u.role !== 'owner') throw new PosError('NOT_OWNER', `${u.displayName} is not an owner`)
  return u
}

/**
 * spec §11 "สำรองข้อมูลด้วย export ไฟล์ SQLite" + spike I3: copies the whole database file (opfs-sahpool `exportFile`
 * in the Worker) and returns it for the UI to download (Q3b-6). Runs inside the PosApi serial queue, so no transaction
 * is half-way when the file is read. Records nothing: the browser gives no signal that the download reached the
 * Downloads folder, so the backup only counts once the owner confirms it (`confirmBackupSaved` — review I-4).
 */
export async function exportBackup(db: RemoteDb, deps: ApiDeps, actorUserId: string): Promise<BackupFileDto> {
  const device = await requireDevice(db)
  await requireActiveOwner(db, actorUserId)
  const lastZ = (await deviceZRows(db, device.id))[0]
  let bytes: Uint8Array
  try {
    bytes = await deps.exportDbFile()
  } catch (e) {
    throw new PosError('BACKUP_FAILED', e instanceof Error ? e.message : String(e))
  }
  if (!isSqliteFile(bytes)) throw new PosError('BACKUP_FAILED', `exported ${bytes.byteLength} bytes that are not an SQLite file`)
  const at = deps.now()
  return { fileName: backupFileName(device, at), bytes, createdAt: at, lastZId: lastZ?.id ?? null }
}

/**
 * Q3b-7 · D52 + review I-4: the owner saw the file in Downloads and tapped "บันทึกไฟล์แล้ว". Records the export time and
 * the Z the file covers in sync_state, and an audit_log `backup` row, in one transaction. The input must describe a
 * file this device could have exported (its name matches the device and export time; the Z belongs to this device).
 */
export async function confirmBackupSaved(db: RemoteDb, deps: ApiDeps, input: ConfirmBackupInput): Promise<void> {
  const device = await requireDevice(db)
  const actor = await requireActiveOwner(db, input.actorUserId)
  if (Number.isNaN(Date.parse(input.createdAt)) || input.fileName !== backupFileName(device, input.createdAt)) {
    throw new PosError('BAD_INPUT', `${input.fileName} is not a backup file name of this device for ${input.createdAt}`)
  }
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength <= 0) throw new PosError('BAD_INPUT', 'byteLength must be a whole number > 0')
  if (input.lastZId !== null && !(await deviceZRows(db, device.id)).some((z) => z.id === input.lastZId)) {
    throw new PosError('BAD_INPUT', `z report ${input.lastZId} is not on this device`)
  }
  const at = deps.now()
  await db.transaction(async (tx) => {
    await tx.insert(s.syncState).values({ key: LAST_BACKUP_KEY, value: input.createdAt }).onConflictDoUpdate({ target: s.syncState.key, set: { value: input.createdAt } })
    if (input.lastZId !== null) {
      await tx.insert(s.syncState).values({ key: LAST_BACKUP_Z_ID_KEY, value: input.lastZId }).onConflictDoUpdate({ target: s.syncState.key, set: { value: input.lastZId } })
    }
    await tx.insert(s.auditLog).values({
      id: deps.newId(),
      entity: 'device',
      entityId: device.id,
      action: 'backup',
      beforeJson: null,
      afterJson: { fileName: input.fileName, bytes: input.byteLength, exportedAt: input.createdAt, lastZId: input.lastZId },
      actorUserId: actor.id,
      at,
    })
  })
}
```

- [ ] **Step 5: bootstrap, error, types, PosApi**

แก้ `apps/pos/src/api/bootstrap.ts`:
- เหนือ `import { PosError } from './errors'` เพิ่ม `import { isBackupDue, lastBackupAt, lastBackupZId } from './backup'`
- ใน `bootstrap` แทนสองบรรทัดแรก
```ts
  if ((await localDeviceId(db)) === null) return { needsSetup: true, device: null, users: [], openShift: null, pendingSyncItems: 0 }
  const device = await requireDevice(db)
```
ด้วย
```ts
  if ((await localDeviceId(db)) === null) return { needsSetup: true, device: null, users: [], openShift: null, pendingSyncItems: 0, lastBackupAt: null, backupDue: false }
  const device = await requireDevice(db)
  const lastAt = await lastBackupAt(db)
  const lastZId = await lastBackupZId(db)
```
- ใน object ที่ return ต่อจาก `pendingSyncItems: await countPendingSyncItems(db),` เพิ่ม:
```ts
    lastBackupAt: lastAt,
    backupDue: await isBackupDue(db, device.id, lastZId),
```

แก้ `apps/pos/src/api/errors.ts` — เหนือบรรทัด `  | 'Z_CHAIN_BROKEN' …` เพิ่ม `  | 'BACKUP_FAILED'`
แก้ `apps/pos/src/ui/th.ts` — ต่อจาก `  errZNotFound: 'ไม่พบรายงาน Z',` เพิ่ม `  errBackupFailed: 'สำรองไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง',`
แก้ `apps/pos/src/ui/errors.ts` — ต่อจาก `  Z_NOT_FOUND: TH.errZNotFound,` เพิ่ม `  BACKUP_FAILED: TH.errBackupFailed,`

แก้ `apps/pos/src/api/types.ts`:
- แทนบรรทัด `export type BootstrapState = { needsSetup: boolean; device: DeviceDto | null; users: UserDto[]; openShift: ShiftDto | null; pendingSyncItems: number }` ด้วย:
```ts
export type BootstrapState = {
  needsSetup: boolean
  device: DeviceDto | null
  users: UserDto[]
  openShift: ShiftDto | null
  pendingSyncItems: number
  /** Export time of the last backup file an owner confirmed as saved (sync_state `local.last_backup_at`), or null. */
  lastBackupAt: string | null
  /** A Z report was closed after the last one a confirmed backup covered — compared by Z id, not time (Q3b-7 · D52). */
  backupDue: boolean
}
```
- ต่อจาก `export type ZReportSummaryDto = { … }` เพิ่ม:
```ts

/** The raw SQLite file of this device (spec §11 · spike I3 `exportFile`) and the latest Z it contains. */
export type BackupFileDto = { fileName: string; bytes: Uint8Array; createdAt: string; lastZId: string | null }
/** The owner saw the exported file in Downloads (review I-4) — echoes the BackupFileDto without its bytes. */
export type ConfirmBackupInput = { actorUserId: string; fileName: string; byteLength: number; createdAt: string; lastZId: string | null }
```
- ใน `interface PosApi` ต่อจาก `getZReport(shiftId: string): Promise<ZReportDto>` เพิ่ม:
```ts
  exportBackup(actorUserId: string): Promise<BackupFileDto>
  confirmBackupSaved(input: ConfirmBackupInput): Promise<void>
```
- ใน `POS_API_METHODS` ต่อจาก `'getZReport',` เพิ่ม `'exportBackup',` และ `'confirmBackupSaved',` (บรรทัดละตัว)

แก้ `apps/pos/src/api/pos-api.ts`:
- ต่อจาก `import { login } from './auth'` เพิ่ม `import { confirmBackupSaved, exportBackup } from './backup'`
- ต่อจากบรรทัด `getZReport: …` เพิ่ม:
```ts
    exportBackup: (actorUserId) => serial(() => exportBackup(db, deps, actorUserId)),
    confirmBackupSaved: (input) => serial(() => confirmBackupSaved(db, deps, input)),
```

- [ ] **Step 6: รันให้ผ่าน**

Run: `pnpm --filter @dayo/pos test && pnpm --filter @dayo/pos typecheck`
Expected: PASS ทั้งหมด (115 เทสต์ — `clock-stamp` 2 + `backup` 3) · เทสต์ backup เปิดไฟล์ที่ได้ด้วย `node:sqlite` แล้วเห็นบิล 3 ใบ (ยืนยันว่าไฟล์สำรองกู้ข้อมูลได้จริง) · export อย่างเดียวไม่บันทึกอะไร ต้อง `confirmBackupSaved` (review I-4) · ของจริงใน Worker ตรวจด้วย e2e (Task 11) บน Chromium + OPFS

- [ ] **Step 7: Commit**

ใช้ skill `committing-code` แล้ว:
```bash
git add apps/pos/src/api/backup.ts apps/pos/src/api/types.ts apps/pos/src/api/deps.ts apps/pos/src/api/errors.ts apps/pos/src/api/bootstrap.ts apps/pos/src/api/pos-api.ts apps/pos/src/db/worker.ts apps/pos/src/lib/clock.ts apps/pos/src/lib/clock-stamp.test.ts apps/pos/src/ui/errors.ts apps/pos/src/ui/th.ts apps/pos/test/helpers/db.ts apps/pos/test/init.test.ts apps/pos/test/backup.test.ts
git commit -m "feat(pos): owner-only database backup that counts once confirmed, and flag when one is due"
```

---

### Task 8: หน้าสำรองไฟล์ (`/backup`) + ข้อความไทยของหน้าจอแผน 3b

**Files:**
- Create: `apps/pos/src/ui/save-file.ts`, `apps/pos/src/ui/save-file.test.ts`, `apps/pos/src/screens/BackupScreen.tsx`, `apps/pos/src/screens/BackupScreen.test.tsx`
- Modify: `apps/pos/src/ui/th.ts`, `apps/pos/src/router.tsx`

**Interfaces:**
- Consumes: `PosApi.exportBackup`, `PosApi.confirmBackupSaved`, `ConfirmBackupInput`, `BackupFileDto` (Task 7) · `BootstrapState.lastBackupAt` · `useApi`, `useBootstrap`, `bootstrapKey`, `useSession` · `errorMessage`
- Produces:
  - `downloadBytes(fileName: string, bytes: Uint8Array, mime?: string): void` — ดาวน์โหลดผ่าน `<a download>` + blob (Q3b-6 · D52)
  - route `/backup` (`BackupScreen`) ภายใต้ `RequireSession` · testid: `backup-last`, `backup-download`, `backup-file`, `backup-confirm`, `backup-done`, `backup-owner-only`, `nav-home` · เจ้าของ: ดาวน์โหลด → เห็นชื่อไฟล์ → กด `backup-confirm` ("บันทึกไฟล์แล้ว") จึงเรียก `confirmBackupSaved` (Q3b-7 · review I-4) · คนที่ไม่ใช่เจ้าของเห็นแค่ `backup-owner-only` (Q3b-13 · D53)
  - `TH` คีย์ใหม่ทั้งหมดของหน้าจอแผน 3b (Task 9–11 ใช้) — ดู Step 2

- [ ] **Step 1: เทสต์ `downloadBytes` ให้ตก**

`apps/pos/src/ui/save-file.test.ts`
```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadBytes } from './save-file'

describe('downloadBytes', () => {
  afterEach(() => vi.restoreAllMocks())

  it('clicks a temporary <a download> pointing at a blob of the bytes', async () => {
    const created: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      created.push(b as Blob)
      return 'blob:test'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const clicked: { download: string; href: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href })
    })
    downloadBytes('dayo-pos-A-20260917-201000.sqlite3', new Uint8Array([83, 81, 76]))
    expect(clicked).toEqual([{ download: 'dayo-pos-A-20260917-201000.sqlite3', href: 'blob:test' }])
    expect(created).toHaveLength(1)
    expect(new Uint8Array(await created[0]!.arrayBuffer())).toEqual(new Uint8Array([83, 81, 76]))
    expect(document.querySelectorAll('a')).toHaveLength(0) // removed again
  })
})
```

`apps/pos/src/screens/BackupScreen.test.tsx`
```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BackupFileDto, PosApi, UserDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { SessionProvider, useSession } from '../app/session'
import { BackupScreen } from './BackupScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))
const downloads = vi.hoisted(() => [] as string[])
vi.mock('../ui/save-file', () => ({ downloadBytes: (name: string) => downloads.push(name) }))

afterEach(() => {
  cleanup()
  downloads.length = 0
})

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }
const STAFF: UserDto = { id: 'u9', displayName: 'พนักงาน', role: 'staff' }
const FILE: BackupFileDto = { fileName: 'dayo-pos-A-20260917-201000.sqlite3', bytes: new Uint8Array(4096), createdAt: '2026-09-17T13:10:00.000Z', lastZId: 'z-1' }

function SignedIn({ user }: { user: UserDto }): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(user), [signIn, user])
  return <BackupScreen />
}

function mount(user: UserDto): PosApi {
  const api = {
    bootstrap: vi.fn(async () => ({ needsSetup: false, device: null, users: [], openShift: null, pendingSyncItems: 0, lastBackupAt: null, backupDue: true })),
    exportBackup: vi.fn(async () => FILE),
    confirmBackupSaved: vi.fn(async () => undefined),
  } as unknown as PosApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <SignedIn user={user} />
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return api
}

describe('BackupScreen', () => {
  it('owner: download, then the backup counts only after "บันทึกไฟล์แล้ว" (review I-4 · Q3b-7)', async () => {
    const api = mount(OWNER)
    act(() => screen.getByTestId('backup-download').click())
    await waitFor(() => expect(screen.getByTestId('backup-file').textContent).toContain(FILE.fileName))
    expect(downloads).toEqual([FILE.fileName])
    expect(api.confirmBackupSaved).not.toHaveBeenCalled()
    act(() => screen.getByTestId('backup-confirm').click())
    await waitFor(() => expect(screen.getByTestId('backup-done')).toBeTruthy())
    expect(api.confirmBackupSaved).toHaveBeenCalledWith({ actorUserId: OWNER.id, fileName: FILE.fileName, byteLength: 4096, createdAt: FILE.createdAt, lastZId: 'z-1' })
    expect(screen.queryByTestId('backup-confirm')).toBeNull()
  })

  it('staff: no download button (Q3b-13 · D53)', async () => {
    const api = mount(STAFF)
    await waitFor(() => expect(screen.getByTestId('backup-owner-only')).toBeTruthy())
    expect(screen.queryByTestId('backup-download')).toBeNull()
    expect(api.exportBackup).not.toHaveBeenCalled()
  })
})
```

Run: `pnpm --filter @dayo/pos exec vitest run save-file BackupScreen`
Expected: FAIL — `Failed to resolve import "./save-file"` และ `Failed to resolve import "./BackupScreen"`

- [ ] **Step 2: `downloadBytes` + ข้อความไทย**

`apps/pos/src/ui/save-file.ts`
```ts
/**
 * Saves bytes as a file through the browser's download (Android Chrome → the Downloads folder) — Q3b-6 · D52.
 * The object URL is revoked a minute later, after the download has surely started.
 */
export function downloadBytes(fileName: string, bytes: Uint8Array, mime = 'application/vnd.sqlite3'): void {
  const blob = new Blob([bytes.slice()], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
```

แก้ `apps/pos/src/ui/th.ts` — ต่อจากบรรทัด `  errBackupFailed: 'สำรองไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง',` เพิ่มทั้งบล็อก (ข้อความของ Task 8–11 รวมไว้ที่เดียว):
```ts
  errCountFormat: 'จำนวนต้องเป็นตัวเลขจำนวนเต็ม 0–99999',
  errCountFirst: 'กด "นับเสร็จ" ก่อน',

  // แผน 3b — กะ / X / Z / เงินเข้า-ออก / สำรองไฟล์
  shiftMenu: 'กะ / รายงาน X',
  xTitle: 'รายงาน X (ยอดสด ณ ตอนนี้)',
  xExpectedHidden: 'เงินสดที่ควรมีแสดงหลังนับเงินตอนปิดกะเท่านั้น (นับแบบไม่เห็นยอด)',
  shiftInfo: (date: string, name: string): string => `วันทำการ ${date} · เปิดกะโดย ${name}`,
  quickOpenBadge: 'เปิดกะด่วน',
  salesTitle: 'ยอดขาย',
  receiptCount: 'จำนวนบิล',
  voidCount: 'บิลยกเลิก',
  grossSales: 'ยอดขายรวม (รวมบิลยกเลิก)',
  discounts: 'ส่วนลดรวม',
  voidedSales: 'ยอดบิลยกเลิก',
  netSales: 'ยอดขายสุทธิ',
  cashSales: 'รับเงินสด',
  qrSummaryTitle: 'พร้อมเพย์ (เทียบกับแอปธนาคาร)',
  qrSales: 'รับพร้อมเพย์',
  qrRefunded: 'โอนคืน (บิลยกเลิก)',
  qrNet: 'พร้อมเพย์สุทธิ',
  bankQrTotal: 'ยอดพร้อมเพย์ในแอปธนาคาร (บาท · ไม่บังคับ)',
  bankQrNotEntered: 'ไม่ได้กรอก',
  qrDifference: 'ส่วนต่าง (แอปธนาคาร − พร้อมเพย์สุทธิ)',
  drawerTitle: 'เงินสดในลิ้นชัก',
  openingFloat: 'เงินทอนตั้งต้น',
  voidRefunds: 'คืนเงินบิลยกเลิก',
  paidIn: 'เงินเข้า',
  paidOut: 'จ่ายออก',
  drops: 'นำเงินออกไปเก็บ',
  expectedCash: 'เงินสดที่ควรมี',
  cashMovesTitle: 'เงินเข้า-ออกที่บันทึก',
  voidListTitle: 'บิลที่ยกเลิก',
  noVoids: 'ไม่มีบิลยกเลิก',
  voidWasMade: 'ทำแล้ว (ของเสีย)',
  voidNotMade: 'ยังไม่ทำ (คืนสต็อก)',
  voidApprovedBy: (name: string): string => `อนุมัติโดย ${name}`,
  negativeBasesTitle: 'เบสติดลบ (ลืมบันทึกทำเบส?)',
  noNegativeBases: 'ไม่มีเบสติดลบ',
  pendingAtClose: (n: number): string => `ยังไม่ส่งขึ้นเซิร์ฟเวอร์ ${n} รายการ — ข้อมูลอยู่ในเครื่องและในไฟล์สำรอง`,
  closeShift: 'ปิดกะ',
  closeTitle: 'ปิดกะ — นับเงินในลิ้นชัก',
  denomination: 'ชนิด',
  pieces: 'จำนวน',
  countedTotal: 'นับได้',
  countDone: 'นับเสร็จ ดูส่วนต่าง',
  countEdit: 'แก้จำนวนที่นับ',
  variance: 'ส่วนต่าง (นับได้ − ควรมี)',
  varianceReason: 'เหตุผลเงินขาด/เกิน',
  varianceReasonHint: (limit: string): string => `ขาดหรือเกินมากกว่า ${limit} ต้องใส่เหตุผล`,
  closeApprover: 'เจ้าของที่ยืนยันปิดกะ',
  cartNotEmpty: 'ยังมีรายการค้างในตะกร้า — ขายหรือล้างตะกร้าก่อนปิดกะ',
  zChainAck: 'Z ใบก่อนหน้าลายเซ็นไม่ตรง — เจ้าของกรอก PIN อีกครั้งเพื่อรับทราบ ระบบจะคิดยอดสะสมใหม่จาก Z ทุกใบ และติดป้ายเตือนถาวรใน Z ใบนี้',
  zTitle: 'รายงาน Z',
  zList: 'Z ย้อนหลัง',
  noZ: 'ยังไม่มีรายงาน Z',
  zClosedAt: (at: string): string => `ปิดกะเมื่อ ${at}`,
  zGrandTotal: 'ยอดขายสุทธิสะสม (grand total)',
  zHashOk: 'ตรวจลายเซ็นแล้ว ข้อมูลไม่ถูกแก้',
  zHashBad: 'ลายเซ็นไม่ตรง — ข้อมูลอาจถูกแก้',
  zChainWarning: 'Z ใบนี้ปิดหลังพบว่า Z ใบก่อนหน้าลายเซ็นไม่ตรง — ยอดสะสมคิดใหม่จาก Z ทุกใบ (เจ้าของรับทราบด้วย PIN แล้ว)',
  zChainWarningShort: 'Z ก่อนหน้าลายเซ็นไม่ตรง',
  zDone: 'เสร็จ',
  backupTitle: 'สำรองไฟล์ฐานข้อมูล',
  backupHint: 'ไฟล์จะลงในโฟลเดอร์ดาวน์โหลดของแท็บเล็ต — ย้ายไปเก็บที่ Google Drive หรือคอมพิวเตอร์ทุกวัน',
  backupNow: 'ดาวน์โหลดไฟล์สำรอง',
  backupNever: 'ยังไม่เคยสำรอง',
  backupLast: (at: string): string => `สำรองล่าสุด ${at}`,
  backupCheckFile: (name: string): string => `ตรวจว่าเห็นไฟล์ ${name} ในโฟลเดอร์ดาวน์โหลดแล้ว จึงกด "บันทึกไฟล์แล้ว"`,
  backupConfirm: 'บันทึกไฟล์แล้ว',
  backupDone: (name: string): string => `ยืนยันไฟล์สำรอง ${name} แล้ว`,
  backupOwnerOnly: 'สำรองไฟล์ได้เฉพาะเจ้าของร้าน (ในไฟล์มี PIN ที่เข้ารหัสแล้วและหมายเลขพร้อมเพย์ของร้าน)',
  backupDue: 'ปิดกะแล้วแต่ยังไม่ได้ยืนยันไฟล์สำรอง — สำรองแล้วกด "บันทึกไฟล์แล้ว" ก่อนปิดเครื่อง',
  shiftStale: (date: string): string => `กะของวันที่ ${date} ยังไม่ปิด — ปิดกะก่อนเริ่มวันใหม่`,
  quickOpen: 'เปิดกะด่วน (เงินทอน 0 · เจ้าของเท่านั้น)',
  cashMove: 'เงินเข้า-ออก',
  cashMoveTitle: 'บันทึกเงินเข้า-ออกลิ้นชัก',
  cashKinds: { PAID_IN: 'เงินเข้า (เติมเงินทอน)', PAID_OUT: 'จ่ายออก (ซื้อของ)', DROP: 'นำเงินออกไปเก็บ' },
  cashMoveAmount: 'จำนวนเงิน (บาท)',
  cashMoveReason: 'เหตุผล / รายการ',
  save: 'บันทึก',
```

- [ ] **Step 3: หน้า `BackupScreen` + route**

`apps/pos/src/screens/BackupScreen.tsx`
```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import type { ConfirmBackupInput } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { downloadBytes } from '../ui/save-file'
import { TH } from '../ui/th'

const DATE_TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })

/**
 * spec §11: back up the whole SQLite file to the tablet's Downloads (Q3b-6 · D52). Owners only (Q3b-13 · D53). The
 * download gives no success signal, so the backup counts only after the owner taps "บันทึกไฟล์แล้ว" (Q3b-7 · review I-4).
 */
export function BackupScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const boot = useBootstrap()
  const { user } = useSession()
  const [pending, setPending] = useState<ConfirmBackupInput | null>(null)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const backup = useMutation({
    mutationFn: () => api.exportBackup(user?.id ?? ''),
    onSuccess: (file) => {
      downloadBytes(file.fileName, file.bytes)
      setConfirmed(null)
      setPending({ actorUserId: user?.id ?? '', fileName: file.fileName, byteLength: file.bytes.byteLength, createdAt: file.createdAt, lastZId: file.lastZId })
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const confirm = useMutation({
    mutationFn: (input: ConfirmBackupInput) => api.confirmBackupSaved(input),
    onSuccess: async (_done, input) => {
      setPending(null)
      setConfirmed(input.fileName)
      await queryClient.invalidateQueries({ queryKey: bootstrapKey })
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const last = boot.data?.lastBackupAt ?? null
  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-home" onClick={() => void navigate({ to: '/' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.backupTitle}</h1>
      <p>{TH.backupHint}</p>
      <p data-testid="backup-last">{last === null ? TH.backupNever : TH.backupLast(DATE_TIME.format(new Date(last)))}</p>
      {user?.role !== 'owner' ? (
        <p role="alert" className="error" data-testid="backup-owner-only">
          {TH.backupOwnerOnly}
        </p>
      ) : (
        <>
          {error !== null && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {confirmed !== null && (
            <p className="badge" data-testid="backup-done">
              {TH.backupDone(confirmed)}
            </p>
          )}
          {pending !== null && (
            <>
              <p data-testid="backup-file">{TH.backupCheckFile(pending.fileName)}</p>
              <button
                type="button"
                className="primary"
                data-testid="backup-confirm"
                disabled={confirm.isPending}
                onClick={() => {
                  setError(null)
                  confirm.mutate(pending)
                }}
              >
                {TH.backupConfirm}
              </button>
            </>
          )}
          <button
            type="button"
            className={pending === null ? 'primary' : undefined}
            data-testid="backup-download"
            disabled={backup.isPending}
            onClick={() => {
              setError(null)
              backup.mutate()
            }}
          >
            {TH.backupNow}
          </button>
        </>
      )}
    </main>
  )
}
```

แก้ `apps/pos/src/router.tsx`:
- ต่อจาก `import { RequireSession } from './app/guards'` เพิ่ม `import { BackupScreen } from './screens/BackupScreen'`
- เหนือบรรทัด `export const routeTree = rootRoute.addChildren([` เพิ่ม:
```tsx
// แผน 3b: X report / close shift / Z / backup
const backupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backup',
  component: () => (
    <RequireSession>
      <BackupScreen />
    </RequireSession>
  ),
})

```
- ใน `rootRoute.addChildren([...])` ต่อจาก `orderDetailRoute,` เพิ่ม `backupRoute,`

- [ ] **Step 4: รันให้ผ่าน**

Run: `pnpm --filter @dayo/pos test && pnpm --filter @dayo/pos typecheck && pnpm --filter @dayo/pos build`
Expected: PASS (118 เทสต์ — `save-file` 1 + `BackupScreen` 2) · build ผ่าน (การดาวน์โหลดจริงตรวจด้วย e2e ใน Task 11 — ต้องเข้าได้จาก Z/หน้าเปิดกะซึ่งมาทีหลัง)

- [ ] **Step 5: Commit**

ใช้ skill `committing-code` แล้ว:
```bash
git add apps/pos/src/ui/save-file.ts apps/pos/src/ui/save-file.test.ts apps/pos/src/ui/th.ts apps/pos/src/screens/BackupScreen.tsx apps/pos/src/screens/BackupScreen.test.tsx apps/pos/src/router.tsx
git commit -m "feat(pos): owner-only backup screen that downloads the database file and confirms it was saved"
```

---

### Task 9: หน้ารายงาน Z (`/z/$shiftId`) + Z ย้อนหลัง (`/z`) + ชิ้นส่วนตัวเลขที่ใช้ร่วม (รวมตารางพร้อมเพย์)

**Files:**
- Create: `apps/pos/src/screens/ShiftFigures.tsx`, `apps/pos/src/screens/ZReportScreen.tsx`, `apps/pos/src/screens/ZListScreen.tsx`
- Modify: `apps/pos/src/app/queries.ts`, `apps/pos/src/styles.css`, `apps/pos/src/router.tsx`

**Interfaces:**
- Consumes: `getZReport`, `listZReports` (Task 6) · `ZVoid`, `SalesSummary`, `CashInputs` (Task 1) · `NegativeBaseDto` (Task 5) · `BootstrapState.backupDue` (Task 7) · route `/backup` (Task 8) · `TH` บล็อกของ Task 8
- Produces:
  - `queries.ts`: `zListKey = ['z-list']` · `zKey(shiftId) = ['z', shiftId]`
  - `ShiftFigures.tsx`: `SalesTable({ sales, p })` · `QrTable({ sales, p, bank? })` (Q3b-12 · D53) · `DrawerTable({ cash, expectedSatang, p, hideExpected? })` (`hideExpected` = หน้า X ไม่แสดงเงินสดที่ควรมี — Q3b-3 · D52) · `VoidList({ voids, p })` · `NegativeBaseList({ items })` — testid ขึ้นต้นด้วย `p` (`x` / `close` / `z`): `<p>-orders`, `-voids`, `-gross`, `-discount`, `-voided`, `-net`, `-cash-sales`, `-qr-sales`, `-qr-refunded`, `-qr-net`, `-bank-qr`, `-qr-diff` (สองตัวหลังเฉพาะเมื่อส่ง `bank`), `-opening`, `-drawer-cash-sales`, `-void-refunds`, `-paid-in`, `-paid-out`, `-drops`, `-expected` (หรือ `-expected-hidden` เมื่อ `hideExpected`), `-void-<receiptNo>` · `neg-base-<code>`
  - route `/z` (`ZListScreen`: testid `z-row-<i>`, `z-warn-<i>` (Z ที่ปิดหลังรับทราบ Z เสีย — Q3b-11 · D53), `nav-home`) · `/z/$shiftId` (`ZReportScreen`: testid `z-hash` มี `data-ok`, `z-chain-warning`, `z-counted`, `z-variance`, `z-reason`, `z-grand`, `backup-due`, `nav-z-list`, `nav-backup`, `z-done` + testid `z-*` ของ `ShiftFigures`)
  - `styles.css`: class `.figures` (ตารางตัวเลข ใช้ token สีเดิม `--line` เท่านั้น)

- [ ] **Step 1: query keys + CSS**

แก้ `apps/pos/src/app/queries.ts` — ต่อจาก `export const orderKey = …` เพิ่ม:
```ts
export const zListKey = ['z-list'] as const
export const zKey = (shiftId: string) => ['z', shiftId] as const
```

แก้ `apps/pos/src/styles.css` — ต่อท้ายไฟล์:
```css

/* แผน 3b: ตารางตัวเลขของรายงาน X/Z และตารางนับเงิน */
.figures { width: 100%; border-collapse: collapse; font-size: 18px; }
.figures th { text-align: left; font-weight: 500; padding: 6px 4px; }
.figures td { text-align: right; font-variant-numeric: tabular-nums; padding: 6px 4px; }
.figures tr + tr { border-top: 1px solid var(--line); }
.figures input { width: 7em; font-size: 20px; text-align: right; }
```

- [ ] **Step 2: ชิ้นส่วนตัวเลข**

`apps/pos/src/screens/ShiftFigures.tsx`
```tsx
import type { JSX } from 'react'
import type { CashInputs, SalesSummary, ZVoid } from '@dayo/domain'
import type { NegativeBaseDto } from '../api/types'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'

const TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })

function Row({ label, value, testId }: { label: string; value: string; testId: string }): JSX.Element {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td data-testid={testId}>{value}</td>
    </tr>
  )
}

/** Sales block shared by the X report and the Z report (`p` = testid prefix: x / z). */
export function SalesTable({ sales, p }: { sales: SalesSummary; p: string }): JSX.Element {
  return (
    <section>
      <h2>{TH.salesTitle}</h2>
      <table className="figures">
        <tbody>
          <Row label={TH.receiptCount} value={String(sales.orderCount)} testId={`${p}-orders`} />
          <Row label={TH.voidCount} value={String(sales.voidCount)} testId={`${p}-voids`} />
          <Row label={TH.grossSales} value={formatBaht(sales.grossSalesSatang)} testId={`${p}-gross`} />
          <Row label={TH.discounts} value={`−${formatBaht(sales.discountSatang)}`} testId={`${p}-discount`} />
          <Row label={TH.voidedSales} value={`−${formatBaht(sales.voidedSatang)}`} testId={`${p}-voided`} />
          <Row label={TH.netSales} value={formatBaht(sales.netSalesSatang)} testId={`${p}-net`} />
          <Row label={TH.cashSales} value={formatBaht(sales.cashSalesSatang)} testId={`${p}-cash-sales`} />
        </tbody>
      </table>
    </section>
  )
}

/**
 * Q3b-12 · D53: PromptPay received / transferred back / net — the figure to compare with the bank app. With `bank`
 * (the Z report) also the bank-app total the owner typed and the frozen difference (bank − net).
 */
export function QrTable({ sales, p, bank }: { sales: SalesSummary; p: string; bank?: { totalSatang: number | null; differenceSatang: number | null } }): JSX.Element {
  return (
    <section>
      <h2>{TH.qrSummaryTitle}</h2>
      <table className="figures">
        <tbody>
          <Row label={TH.qrSales} value={formatBaht(sales.qrSalesSatang)} testId={`${p}-qr-sales`} />
          <Row label={TH.qrRefunded} value={`−${formatBaht(sales.qrRefundedSatang)}`} testId={`${p}-qr-refunded`} />
          <Row label={TH.qrNet} value={formatBaht(sales.qrNetSatang)} testId={`${p}-qr-net`} />
          {bank !== undefined && (
            <>
              <Row label={TH.bankQrTotal} value={bank.totalSatang === null ? TH.bankQrNotEntered : formatBaht(bank.totalSatang)} testId={`${p}-bank-qr`} />
              <Row label={TH.qrDifference} value={bank.differenceSatang === null ? '—' : formatBaht(bank.differenceSatang)} testId={`${p}-qr-diff`} />
            </>
          )}
        </tbody>
      </table>
    </section>
  )
}

/**
 * D36: expected = opening + cash sales − void refunds + paid in − paid out − drops. `hideExpected` (the X report of an
 * open shift) leaves the expected line out so the drawer is counted blind at close (Q3b-3 · D52 · review I-2).
 */
export function DrawerTable({ cash, expectedSatang, p, hideExpected = false }: { cash: CashInputs; expectedSatang: number; p: string; hideExpected?: boolean }): JSX.Element {
  return (
    <section>
      <h2>{TH.drawerTitle}</h2>
      <table className="figures">
        <tbody>
          <Row label={TH.openingFloat} value={formatBaht(cash.openingFloatSatang)} testId={`${p}-opening`} />
          <Row label={TH.cashSales} value={`+${formatBaht(cash.cashSalesSatang)}`} testId={`${p}-drawer-cash-sales`} />
          <Row label={TH.voidRefunds} value={`−${formatBaht(cash.voidRefundsSatang)}`} testId={`${p}-void-refunds`} />
          <Row label={TH.paidIn} value={`+${formatBaht(cash.paidInSatang)}`} testId={`${p}-paid-in`} />
          <Row label={TH.paidOut} value={`−${formatBaht(cash.paidOutSatang)}`} testId={`${p}-paid-out`} />
          <Row label={TH.drops} value={`−${formatBaht(cash.dropsSatang)}`} testId={`${p}-drops`} />
          {!hideExpected && <Row label={TH.expectedCash} value={formatBaht(expectedSatang)} testId={`${p}-expected`} />}
        </tbody>
      </table>
      {hideExpected && <p data-testid={`${p}-expected-hidden`}>{TH.xExpectedHidden}</p>}
    </section>
  )
}

/** The daily void report (D50 Q3-22): who approved, why, made or not, QR refund reference. */
export function VoidList({ voids, p }: { voids: readonly ZVoid[]; p: string }): JSX.Element {
  return (
    <section>
      <h2>{TH.voidListTitle}</h2>
      {voids.length === 0 && <p>{TH.noVoids}</p>}
      <ul className="list">
        {voids.map((v) => (
          <li key={v.orderId} data-testid={`${p}-void-${v.receiptNo}`}>
            <strong>{v.receiptNo}</strong> · {TIME.format(new Date(v.voidedAt))} · {formatBaht(v.totalSatang)} · {v.method === 'CASH' ? TH.methodCash : TH.methodPromptPay} · {v.reason} ·{' '}
            {v.made ? TH.voidWasMade : TH.voidNotMade} · {TH.voidApprovedBy(v.approvedByName)}
            {v.refundReference !== null && ` · ${TH.voidQrRefundRef} ${v.refundReference}`}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** D28: the close screen must show the bases that went negative. */
export function NegativeBaseList({ items }: { items: readonly NegativeBaseDto[] }): JSX.Element {
  return (
    <section>
      <h2>{TH.negativeBasesTitle}</h2>
      {items.length === 0 && <p>{TH.noNegativeBases}</p>}
      <ul className="list">
        {items.map((b) => (
          <li key={b.itemId} className="error" data-testid={`neg-base-${b.code}`}>
            {b.name} ({b.code}) {(b.onHandMilli / 1000).toLocaleString('en-US')} {b.useUnit}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 3: หน้า Z และ Z ย้อนหลัง**

`apps/pos/src/screens/ZReportScreen.tsx`
```tsx
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useApi } from '../app/api-context'
import { useBootstrap, zKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'
import { DrawerTable, QrTable, SalesTable, VoidList } from './ShiftFigures'

const DATE_TIME = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })

/** A frozen Z report exactly as stored (spec §4.8) — shown on screen, never recomputed (Q3b-5 · D52). */
export function ZReportScreen(): JSX.Element {
  const { shiftId } = useParams({ from: '/z/$shiftId' })
  const api = useApi()
  const navigate = useNavigate()
  const boot = useBootstrap()
  const z = useQuery({ queryKey: zKey(shiftId), queryFn: () => api.getZReport(shiftId) })

  if (z.isError) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(z.error)}
        </p>
      </main>
    )
  }
  if (z.data === undefined) return <main className="page">{TH.loading}</main>
  const snap = z.data.snapshot
  return (
    <main className="page">
      <h1>
        {TH.zTitle} · {snap.businessDate}
        {snap.openedQuick && <span className="badge"> · {TH.quickOpenBadge}</span>}
      </h1>
      <p>{TH.zClosedAt(DATE_TIME.format(new Date(snap.closedAt)))}</p>
      <p data-testid="z-hash" data-ok={z.data.hashOk ? 'true' : 'false'} className={z.data.hashOk ? 'badge' : 'error'}>
        {z.data.hashOk ? TH.zHashOk : TH.zHashBad} · {z.data.hash.slice(0, 12)}
      </p>
      {snap.chainWarning != null && (
        <p role="alert" className="error" data-testid="z-chain-warning">
          {TH.zChainWarning}
        </p>
      )}
      {boot.data?.backupDue === true && (
        <p role="alert" className="error" data-testid="backup-due">
          {TH.backupDue}
        </p>
      )}
      <SalesTable sales={snap.sales} p="z" />
      <QrTable sales={snap.sales} p="z" bank={{ totalSatang: snap.bankQrTotalSatang ?? null, differenceSatang: snap.qrDifferenceSatang ?? null }} />
      <DrawerTable cash={snap.cash} expectedSatang={snap.expectedCashSatang} p="z" />
      <table className="figures">
        <tbody>
          {snap.countLines
            .filter((l) => l.count > 0)
            .map((l) => (
              <tr key={l.denominationSatang}>
                <th scope="row">{formatBaht(l.denominationSatang)}</th>
                <td>× {l.count}</td>
              </tr>
            ))}
          <tr>
            <th scope="row">{TH.countedTotal}</th>
            <td data-testid="z-counted">{formatBaht(snap.countedCashSatang)}</td>
          </tr>
          <tr>
            <th scope="row">{TH.variance}</th>
            <td data-testid="z-variance">{formatBaht(snap.cashVarianceSatang)}</td>
          </tr>
          {snap.varianceReason !== null && (
            <tr>
              <th scope="row">{TH.varianceReason}</th>
              <td data-testid="z-reason">{snap.varianceReason}</td>
            </tr>
          )}
          <tr>
            <th scope="row">{TH.zGrandTotal}</th>
            <td data-testid="z-grand">{formatBaht(snap.grandTotalSatang)}</td>
          </tr>
        </tbody>
      </table>
      <VoidList voids={snap.voids} p="z" />
      <div className="actions">
        <button type="button" data-testid="nav-z-list" onClick={() => void navigate({ to: '/z' })}>
          {TH.zList}
        </button>
        <button type="button" className={boot.data?.backupDue === true ? 'primary' : undefined} data-testid="nav-backup" onClick={() => void navigate({ to: '/backup' })}>
          {TH.backupTitle}
        </button>
        <button type="button" data-testid="z-done" onClick={() => void navigate({ to: '/' })}>
          {TH.zDone}
        </button>
      </div>
    </main>
  )
}
```

`apps/pos/src/screens/ZListScreen.tsx`
```tsx
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useApi } from '../app/api-context'
import { zListKey } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'

/** Past Z reports of this device, newest first (Q3b-5 · D52) — hash state and the chain warning on every row (Q3b-11 · D53). */
export function ZListScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const list = useQuery({ queryKey: zListKey, queryFn: () => api.listZReports() })
  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-home" onClick={() => void navigate({ to: '/' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.zList}</h1>
      {list.isError && (
        <p role="alert" className="error">
          {errorMessage(list.error)}
        </p>
      )}
      {list.data?.length === 0 && <p>{TH.noZ}</p>}
      <div className="list">
        {list.data?.map((z, i) => (
          <button key={z.shiftId} type="button" className="row" data-testid={`z-row-${i}`} onClick={() => void navigate({ to: '/z/$shiftId', params: { shiftId: z.shiftId } })}>
            <strong>{z.businessDate}</strong>
            <span>
              {TH.netSales} {formatBaht(z.netSalesSatang)}
              {z.openedQuick && ` · ${TH.quickOpenBadge}`}
            </span>
            <span>
              {TH.variance} {formatBaht(z.cashVarianceSatang)}
            </span>
            <span className={z.hashOk ? 'badge' : 'error'}>{z.hashOk ? TH.zHashOk : TH.zHashBad}</span>
            {z.chainWarning && (
              <span className="error" data-testid={`z-warn-${i}`}>
                {TH.zChainWarningShort}
              </span>
            )}
          </button>
        ))}
      </div>
    </main>
  )
}
```

- [ ] **Step 4: route**

แก้ `apps/pos/src/router.tsx`:
- ต่อจาก `import { SetupScreen } from './screens/SetupScreen'` เพิ่ม:
```tsx
import { ZListScreen } from './screens/ZListScreen'
import { ZReportScreen } from './screens/ZReportScreen'
```
- ต่อจาก `const backupRoute = createRoute({ … })` เพิ่ม:
```tsx
const zListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/z',
  component: () => (
    <RequireSession>
      <ZListScreen />
    </RequireSession>
  ),
})
const zReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/z/$shiftId',
  component: () => (
    <RequireSession>
      <ZReportScreen />
    </RequireSession>
  ),
})
```
- ใน `rootRoute.addChildren([...])` ต่อจาก `backupRoute,` เพิ่ม `zListRoute,` และ `zReportRoute,`

- [ ] **Step 5: ตรวจ**

Run: `pnpm --filter @dayo/pos test && pnpm --filter @dayo/pos typecheck && pnpm --filter @dayo/pos build`
Expected: PASS (118 เทสต์ ไม่เพิ่ม) · `test/brand.test.ts` ยังผ่าน (ไม่มี hex ใหม่ใน `styles.css`) · หน้าจอทั้งสองตรวจด้วย e2e ใน Task 11

- [ ] **Step 6: Commit**

ใช้ skill `committing-code` แล้ว:
```bash
git add apps/pos/src/app/queries.ts apps/pos/src/styles.css apps/pos/src/screens/ShiftFigures.tsx apps/pos/src/screens/ZReportScreen.tsx apps/pos/src/screens/ZListScreen.tsx apps/pos/src/router.tsx
git commit -m "feat(pos): z report and past z screens"
```

---

### Task 10: หน้า X (`/shift`) ที่ไม่แสดงเงินสดที่ควรมี · เงินเข้า-ออกบนหน้าขาย · แถบกะค้างข้ามวัน + e2e รายงาน X

**Files:**
- Create: `apps/pos/e2e/shift-x.spec.ts`, `apps/pos/src/screens/ShiftScreen.tsx`, `apps/pos/src/screens/CashMoveDialog.tsx`
- Modify: `apps/pos/src/app/queries.ts`, `apps/pos/src/screens/SellScreen.tsx`, `apps/pos/src/router.tsx`

**Interfaces:**
- Consumes: `shiftReport`, `recordCashMovement` (Task 4–5) · `isShiftStale` (Task 7) · `SalesTable`, `QrTable`, `DrawerTable`, `VoidList`, `NegativeBaseList` (Task 9) · routes `/z`, `/backup` (Task 8–9) · `REASON_MAX_LENGTH` (Task 2) · `parseBahtInput` (แผน 3) · e2e helpers `addItem`, `firstRun`
- Produces:
  - `queries.ts`: `shiftReportKey = ['shift-report']` (Task 11 ใช้)
  - route `/shift` (`ShiftScreen` — testid `x-*` ของ `ShiftFigures` โดย **ไม่มี `x-expected`** มีแต่ `x-expected-hidden` (Q3b-3 · D52 · review I-2), `x-shift`, `x-quick`, `x-move-<id>`, `nav-z-list`, `nav-backup`, `nav-sell` · **ไม่มีปุ่มปิดกะ** — ปิดกะเริ่มจากหน้าขาย (Task 11))
  - หน้าขาย: `cash-move-open`, `nav-shift`, `shift-stale` (Q3b-8 · D52) · `CashMoveDialog`: `cash-kind-<KIND>`, `cash-amount`, `cash-reason`, `cash-save` (ทุกคนที่ล็อกอิน · บังคับเหตุผล — Q3b-9 · D52)

- [ ] **Step 1: เขียน e2e ให้ตก**

`apps/pos/e2e/shift-x.spec.ts`
```ts
import { expect, test, type Page } from '@playwright/test'
import { addItem, firstRun } from './helpers'

async function sellCash(page: Page, productCode: string): Promise<void> {
  await addItem(page, productCode)
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  await page.getByTestId('done-new-sale').click()
  await expect(page).toHaveURL(/\/sell$/)
}

test('paid-out from the sell screen → X report live, without the expected cash (spec §4.8 · Q3b-3/9 · D52)', async ({ page }) => {
  await firstRun(page) // float ฿500
  await sellCash(page, 'Original') // ฿45
  await sellCash(page, 'Original') // ฿45

  // paid-out ฿20 for ice — anyone signed in, with a reason (Q3b-9)
  await page.getByTestId('cash-move-open').click()
  await page.getByTestId('cash-kind-PAID_OUT').click()
  await page.getByTestId('cash-amount').fill('20')
  await page.getByTestId('cash-save').click()
  await expect(page.getByRole('alert')).toBeVisible() // no reason yet → refused on screen
  await page.getByTestId('cash-reason').fill('ซื้อน้ำแข็ง')
  await page.getByTestId('cash-save').click()
  await expect(page.getByTestId('cash-save')).toHaveCount(0)

  await page.getByTestId('nav-shift').click()
  await expect(page.getByTestId('x-net')).toHaveText('฿90')
  await expect(page.getByTestId('x-opening')).toHaveText('฿500')
  await expect(page.getByTestId('x-drawer-cash-sales')).toHaveText('+฿90')
  await expect(page.getByTestId('x-paid-out')).toHaveText('−฿20')
  await expect(page.getByTestId('x-qr-net')).toHaveText('฿0')
  // blind count (review I-2): the X report never shows the expected cash, and closing is not reached from here
  await expect(page.getByTestId('x-expected')).toHaveCount(0)
  await expect(page.getByTestId('x-expected-hidden')).toBeVisible()
  await expect(page.getByTestId('close-shift-open')).toHaveCount(0)
  await page.getByTestId('nav-sell').click()
  await expect(page).toHaveURL(/\/sell$/)
})
```

Run: `pnpm --filter @dayo/pos exec playwright test shift-x`
Expected: FAIL — หา `getByTestId('cash-move-open')` ไม่เจอ (timeout)

- [ ] **Step 2: query key**

แก้ `apps/pos/src/app/queries.ts` — ต่อจาก `export const zKey = …` เพิ่ม:
```ts
export const shiftReportKey = ['shift-report'] as const
```

- [ ] **Step 3: หน้า X และหน้าต่างเงินเข้า-ออก**

`apps/pos/src/screens/ShiftScreen.tsx`
```tsx
import { useQuery } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import type { JSX } from 'react'
import { useApi } from '../app/api-context'
import { shiftReportKey, useBootstrap } from '../app/queries'
import { errorMessage } from '../ui/errors'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'
import { DrawerTable, NegativeBaseList, QrTable, SalesTable, VoidList } from './ShiftFigures'

/**
 * X report (spec §4.8): the open shift computed live — nothing is written. Viewable any time, but it is not the way to
 * close: "ปิดกะ" lives on the sell screen and the expected cash is left out here, so the drawer is counted blind
 * (Q3b-3 · D52 · review I-2).
 */
export function ShiftScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const boot = useBootstrap()
  const report = useQuery({ queryKey: shiftReportKey, queryFn: () => api.shiftReport() })

  if (boot.data !== undefined && boot.data.openShift === null) return <Navigate to="/shift/open" />
  if (report.isError) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(report.error)}
        </p>
      </main>
    )
  }
  if (report.data === undefined) return <main className="page">{TH.loading}</main>
  const r = report.data
  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-sell" onClick={() => void navigate({ to: '/sell' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.xTitle}</h1>
      <p data-testid="x-shift">
        {TH.shiftInfo(r.shift.businessDate, r.shift.openedByName)}
        {r.shift.openedQuick && (
          <span className="badge" data-testid="x-quick">
            {' '}
            · {TH.quickOpenBadge}
          </span>
        )}
      </p>
      <SalesTable sales={r.sales} p="x" />
      <QrTable sales={r.sales} p="x" />
      <DrawerTable cash={r.cash} expectedSatang={r.expectedCashSatang} p="x" hideExpected />
      <section>
        <h2>{TH.cashMovesTitle}</h2>
        <ul className="list">
          {r.cashMovements.map((m) => (
            <li key={m.id} data-testid={`x-move-${m.id}`}>
              {m.kind === 'VOID_REFUND' ? TH.voidRefunds : TH.cashKinds[m.kind]} · {formatBaht(m.amountSatang)} · {m.reason}
            </li>
          ))}
        </ul>
      </section>
      <VoidList voids={r.voids} p="x" />
      <NegativeBaseList items={r.negativeBases} />
      <p className="badge">{TH.pendingAtClose(r.pendingSyncItems)}</p>
      <div className="actions">
        <button type="button" data-testid="nav-z-list" onClick={() => void navigate({ to: '/z' })}>
          {TH.zList}
        </button>
        <button type="button" data-testid="nav-backup" onClick={() => void navigate({ to: '/backup' })}>
          {TH.backupTitle}
        </button>
      </div>
    </main>
  )
}
```

`apps/pos/src/screens/CashMoveDialog.tsx`
```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type JSX } from 'react'
import { REASON_MAX_LENGTH, type CashMovementInput } from '../api/types'
import { useApi } from '../app/api-context'
import { bootstrapKey, shiftReportKey } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { parseBahtInput } from '../ui/format'
import { TH } from '../ui/th'

const KINDS: CashMovementInput['kind'][] = ['PAID_IN', 'PAID_OUT', 'DROP']

/** spec §3.5: paid-in / paid-out / drop typed in by whoever is signed in, with a reason (Q3b-9 · D52). */
export function CashMoveDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const api = useApi()
  const queryClient = useQueryClient()
  const { user } = useSession()
  const [kind, setKind] = useState<CashMovementInput['kind'] | null>(null)
  const [amountText, setAmountText] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (input: CashMovementInput) => api.recordCashMovement(input),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: bootstrapKey }), queryClient.invalidateQueries({ queryKey: shiftReportKey })])
      onClose()
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const submit = (): void => {
    const amountSatang = parseBahtInput(amountText)
    if (kind === null || amountSatang === null || amountSatang <= 0) return setError(TH.errBadInput)
    if (reason.trim() === '') return setError(TH.errReasonRequired)
    setError(null)
    save.mutate({ actorUserId: user?.id ?? '', kind, amountSatang, reason })
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-label={TH.cashMoveTitle}>
      <div className="dialog">
        <h2>{TH.cashMoveTitle}</h2>
        <div className="choices">
          {KINDS.map((k) => (
            <button key={k} type="button" data-testid={`cash-kind-${k}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {TH.cashKinds[k]}
            </button>
          ))}
        </div>
        <label>
          {TH.cashMoveAmount}
          <input data-testid="cash-amount" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </label>
        <label>
          {TH.cashMoveReason}
          <input data-testid="cash-reason" maxLength={REASON_MAX_LENGTH} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            {TH.cancel}
          </button>
          <button type="button" className="primary" data-testid="cash-save" disabled={save.isPending} onClick={submit}>
            {TH.save}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: หน้าขาย · route**

แก้ `apps/pos/src/screens/SellScreen.tsx`:
- ต่อจาก `import { useSession } from '../app/session'` เพิ่ม `import { isShiftStale } from '../lib/clock'`
- ต่อจาก `import { CartPanel } from './CartPanel'` เพิ่ม `import { CashMoveDialog } from './CashMoveDialog'`
- ต่อจาก `const [discountOpen, setDiscountOpen] = useState(false)` เพิ่ม `const [cashMoveOpen, setCashMoveOpen] = useState(false)`
- ต่อจากปุ่ม `data-testid="nav-orders"` (หลัง `</button>` ของมัน) เพิ่ม:
```tsx
        <button type="button" data-testid="cash-move-open" onClick={() => setCashMoveOpen(true)}>
          {TH.cashMove}
        </button>
        <button type="button" data-testid="nav-shift" onClick={() => void navigate({ to: '/shift' })}>
          {TH.shiftMenu}
        </button>
```
- ระหว่าง `</header>` กับ `<main className="grid">` เพิ่ม (Q3b-8 · D52):
```tsx
      {boot.data?.openShift != null && isShiftStale(boot.data.openShift.businessDate, new Date().toISOString()) && (
        <p role="alert" className="error" data-testid="shift-stale">
          {TH.shiftStale(boot.data.openShift.businessDate)}
        </p>
      )}
```
- ต่อจากบรรทัด `{discountOpen && <DiscountDialog onClose={() => setDiscountOpen(false)} />}` เพิ่ม:
```tsx
      {cashMoveOpen && <CashMoveDialog onClose={() => setCashMoveOpen(false)} />}
```

แก้ `apps/pos/src/router.tsx`:
- ต่อจาก `import { SetupScreen } from './screens/SetupScreen'` เพิ่ม `import { ShiftScreen } from './screens/ShiftScreen'`
- ต่อจาก `const zReportRoute = createRoute({ … })` เพิ่ม:
```tsx
const shiftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shift',
  component: () => (
    <RequireSession>
      <ShiftScreen />
    </RequireSession>
  ),
})
```
- ใน `rootRoute.addChildren([...])` ต่อจาก `zReportRoute,` เพิ่ม `shiftRoute,`

- [ ] **Step 5: รันให้ผ่าน**

Run:
```bash
pnpm --filter @dayo/pos test
pnpm --filter @dayo/pos typecheck
pnpm --filter @dayo/pos e2e
```
Expected: unit/integration 118 ผ่าน (ไม่เพิ่ม) · e2e **7 เทสต์ผ่าน** (6 เดิม + `shift-x`) · ถ้า e2e เดิม (`sell-cash`, `offline`) ตกเพราะหาปุ่มใน topbar ไม่เจอ ให้ตรวจว่าเพิ่มปุ่มใหม่ **หลัง** `nav-orders` ไม่ได้แทนที่ของเดิม

- [ ] **Step 6: Commit**

ใช้ skill `committing-code` แล้ว:
```bash
git add apps/pos/e2e/shift-x.spec.ts apps/pos/src/app/queries.ts apps/pos/src/screens/ShiftScreen.tsx apps/pos/src/screens/CashMoveDialog.tsx apps/pos/src/screens/SellScreen.tsx apps/pos/src/router.tsx
git commit -m "feat(pos): x report without expected cash, cash moves and stale shift banner"
```

---

### Task 11: ปิดกะ (`/shift/close`) นับแบบไม่เห็นยอด · ยอดพร้อมเพย์ในแอปธนาคาร · รับทราบ Z เสีย · ปุ่มปิดกะบนหน้าขาย · เปิดกะด่วน + e2e ปิดกะ 💰 review: opus

**Files:**
- Create: `apps/pos/e2e/close-shift.spec.ts`, `apps/pos/src/ui/count-input.test.ts`, `apps/pos/src/screens/CloseShiftScreen.tsx`, `apps/pos/src/screens/CloseShiftScreen.test.tsx`
- Modify: `apps/pos/src/ui/format.ts`, `apps/pos/src/screens/SellScreen.tsx`, `apps/pos/src/screens/OpenShiftScreen.tsx` (แทนทั้งไฟล์), `apps/pos/src/router.tsx`

**Interfaces:**
- Consumes: `closeShift`, `quickOpenShift`, `shiftReport` (Task 3–6) · `posErrorCode` (`api/errors.ts` แผน 3) · `CASH_DENOMINATIONS_SATANG`, `tallyCashCount`, `varianceNeedsReason`, `CashCountLine` (Task 1) · `QrTable`, `NegativeBaseList`, `zListKey` (Task 9) · `shiftReportKey` (Task 10) · routes `/z`, `/z/$shiftId`, `/backup` · `useCart`, `PinPad`, `parseBahtInput` (แผน 3) · e2e helpers `addItem`, `enterPin`, `firstRun`, `OWNER`
- Produces:
  - `parseCountInput(text): number | null` ใน `ui/format.ts`
  - route `/shift/close` (`CloseShiftScreen` — `count-<denominationSatang>`, `close-counted`, `count-done`, `count-edit`, `close-expected` และ `close-variance` **เฉพาะหลังกด `count-done`** (Q3b-3 · D52), `close-reason`, `close-qr-sales` / `close-qr-refunded` / `close-qr-net` + ช่อง `close-bank-qr` (ไม่บังคับ ไม่มีเกณฑ์ — Q3b-12 · D53), `close-chain-broken` (หลังได้ `Z_CHAIN_BROKEN` — PIN ครั้งถัดไปส่ง `acknowledgeZChainBroken: true` — Q3b-11 · D53), `close-pending`, `close-cart-not-empty`, `close-approver-<displayName>` + PinPad `pin-*`, `nav-sell`)
  - หน้าขาย: `close-shift-open` (ข้าง `nav-shift` — ทางเดียวที่เข้าหน้าปิดกะ) · หน้าเปิดกะ: `shift-quick-open` (เฉพาะ owner — Q3b-10 · D52), `backup-due`, `nav-z-list`, `nav-backup`

- [ ] **Step 1: เขียนเทสต์ให้ตก (component + e2e)**

`apps/pos/src/ui/count-input.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { parseCountInput } from './format'

describe('parseCountInput', () => {
  it('empty is 0; whole numbers up to 99999', () => {
    expect(parseCountInput('')).toBe(0)
    expect(parseCountInput('  ')).toBe(0)
    expect(parseCountInput('7')).toBe(7)
    expect(parseCountInput(' 012 ')).toBe(12)
    expect(parseCountInput('99999')).toBe(99_999)
  })
  it('rejects anything else', () => {
    for (const bad of ['-1', '1.5', 'abc', '100000', '1,000']) expect(parseCountInput(bad)).toBeNull()
  })
})
```

`apps/pos/src/screens/CloseShiftScreen.test.tsx`
```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PosError } from '../api/errors'
import type { CloseShiftInput, PosApi, ShiftReportDto, UserDto, ZReportDto } from '../api/types'
import { ApiProvider } from '../app/api-context'
import { CartProvider } from '../app/cart-context'
import { SessionProvider, useSession } from '../app/session'
import { CloseShiftScreen } from './CloseShiftScreen'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
}))

afterEach(() => cleanup())

const OWNER: UserDto = { id: 'u1', displayName: 'TungAo', role: 'owner' }
const SHIFT = { id: 's1', businessDate: '2026-09-17', openedAt: '2026-09-17T01:00:00.000Z', openedBy: 'u1', openingFloatSatang: 50_000 }
const REPORT: ShiftReportDto = {
  shift: { ...SHIFT, openedByName: 'TungAo', openedQuick: false },
  generatedAt: '2026-09-17T13:00:00.000Z',
  sales: { orderCount: 2, voidCount: 0, grossSalesSatang: 9_500, discountSatang: 0, voidedSatang: 0, netSalesSatang: 9_500, cashSalesSatang: 4_500, qrSalesSatang: 5_000, qrRefundedSatang: 0, qrNetSatang: 5_000 },
  cash: { openingFloatSatang: 50_000, cashSalesSatang: 4_500, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 2_500, dropsSatang: 0 },
  expectedCashSatang: 52_000,
  varianceAlertSatang: 2_000,
  cashMovements: [],
  voids: [],
  negativeBases: [],
  pendingSyncItems: 3,
}

function SignedIn(): JSX.Element {
  const { signIn } = useSession()
  useEffect(() => signIn(OWNER), [signIn])
  return <CloseShiftScreen />
}

function mount(closeShift: (input: CloseShiftInput) => Promise<ZReportDto>): PosApi {
  const api = {
    bootstrap: vi.fn(async () => ({ needsSetup: false, device: null, users: [OWNER], openShift: SHIFT, pendingSyncItems: 3, lastBackupAt: null, backupDue: false })),
    shiftReport: vi.fn(async () => REPORT),
    closeShift: vi.fn(closeShift),
  } as unknown as PosApi
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <SessionProvider>
          <CartProvider initial={{ orderId: 'o', lines: [], discount: null }}>
            <SignedIn />
          </CartProvider>
        </SessionProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return api
}

async function countAndConfirm(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('count-50000')).toBeTruthy())
  fireEvent.change(screen.getByTestId('count-50000'), { target: { value: '1' } })
  fireEvent.change(screen.getByTestId('count-2000'), { target: { value: '1' } })
  act(() => screen.getByTestId('count-done').click())
  act(() => screen.getByTestId('close-approver-TungAo').click())
}

function enterPin(pin: string): void {
  for (const d of pin) act(() => screen.getByTestId(`pin-${d}`).click())
  act(() => screen.getByTestId('pin-ok').click())
}

const inputOf = (api: PosApi, call: number): CloseShiftInput => (api.closeShift as unknown as ReturnType<typeof vi.fn>).mock.calls[call]![0] as CloseShiftInput

describe('CloseShiftScreen', () => {
  it('counts blind: the expected cash appears only after "นับเสร็จ" (Q3b-3 · D52 · review I-2)', async () => {
    mount(async () => ({}) as ZReportDto)
    await waitFor(() => expect(screen.getByTestId('count-50000')).toBeTruthy())
    expect(screen.queryByTestId('close-expected')).toBeNull()
    expect(screen.queryByTestId('close-variance')).toBeNull()
    await countAndConfirm()
    expect(screen.getByTestId('close-counted').textContent).toBe('฿520')
    expect(screen.getByTestId('close-expected').textContent).toBe('฿520')
    expect(screen.getByTestId('close-variance').textContent).toBe('฿0')
    expect(screen.getByTestId('close-qr-net').textContent).toBe('฿50')
  })

  it('sends the bank-app PromptPay total when typed, null when left empty (Q3b-12 · D53)', async () => {
    let calls = 0
    const api = mount(async () => {
      calls += 1
      if (calls === 1) throw new PosError('PIN_WRONG', 'wrong user or PIN') // stay on the screen for a second try
      return { shiftId: 's1' } as ZReportDto
    })
    await countAndConfirm()
    enterPin('1111')
    await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(1))
    expect(inputOf(api, 0)).toMatchObject({ bankQrTotalSatang: null, acknowledgeZChainBroken: false, approverUserId: OWNER.id, shownExpectedCashSatang: 52_000 })
    fireEvent.change(screen.getByTestId('close-bank-qr'), { target: { value: '45.50' } })
    enterPin('1111')
    await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(2))
    expect(inputOf(api, 1).bankQrTotalSatang).toBe(4_550)
  })

  it('after Z_CHAIN_BROKEN the owner enters the PIN again to acknowledge (Q3b-11 · D53)', async () => {
    let calls = 0
    const api = mount(async () => {
      calls += 1
      if (calls === 1) throw new PosError('Z_CHAIN_BROKEN', 's0')
      return { shiftId: 's1' } as ZReportDto
    })
    await countAndConfirm()
    expect(screen.queryByTestId('close-chain-broken')).toBeNull()
    enterPin('1111')
    await waitFor(() => expect(screen.getByTestId('close-chain-broken')).toBeTruthy())
    expect(inputOf(api, 0).acknowledgeZChainBroken).toBe(false)
    enterPin('1111')
    await waitFor(() => expect(api.closeShift).toHaveBeenCalledTimes(2))
    expect(inputOf(api, 1).acknowledgeZChainBroken).toBe(true)
  })
})
```

`apps/pos/e2e/close-shift.spec.ts`
```ts
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { addItem, enterPin, firstRun, OWNER } from './helpers'

async function sellCash(page: Page, productCode: string): Promise<void> {
  await addItem(page, productCode)
  await page.getByTestId('pay-cash').click()
  await page.getByTestId('tender-exact').click()
  await page.getByTestId('confirm-cash').click()
  await page.getByTestId('done-new-sale').click()
  await expect(page).toHaveURL(/\/sell$/)
}

async function sellQr(page: Page, productCode: string): Promise<void> {
  await addItem(page, productCode)
  await page.getByTestId('pay-qr').click()
  await page.getByTestId('qr-received').click()
  await page.getByTestId('done-new-sale').click()
  await expect(page).toHaveURL(/\/sell$/)
}

test('blind count from the sell screen → variance reason → owner PIN → Z with QR vs bank → backup confirmed → next shift (spec §4.8, §11)', async ({ page }) => {
  await firstRun(page) // float ฿500
  await sellCash(page, 'Original') // ฿45
  await sellCash(page, 'Original') // ฿45
  await sellQr(page, 'Latte') // ฿50 PromptPay
  await page.getByTestId('cash-move-open').click() // paid-out ฿20 (Q3b-9)
  await page.getByTestId('cash-kind-PAID_OUT').click()
  await page.getByTestId('cash-amount').fill('20')
  await page.getByTestId('cash-reason').fill('ซื้อน้ำแข็ง')
  await page.getByTestId('cash-save').click()
  await expect(page.getByTestId('cash-save')).toHaveCount(0)

  // close from the sell screen: count first, the expected cash appears only after "นับเสร็จ" (Q3b-3 · D52)
  await page.getByTestId('close-shift-open').click()
  await expect(page.getByTestId('count-50000')).toBeVisible()
  await expect(page.getByTestId('close-expected')).toHaveCount(0)
  await page.getByTestId('count-50000').fill('1') // ฿500
  await page.getByTestId('count-2000').fill('2') // ฿40 → ฿540 counted
  await expect(page.getByTestId('close-counted')).toHaveText('฿540')
  await page.getByTestId('count-done').click()
  await expect(page.getByTestId('close-expected')).toHaveText('฿570') // 500 + 90 − 20
  await expect(page.getByTestId('close-variance')).toHaveText('-฿30')
  await expect(page.getByTestId('close-qr-net')).toHaveText('฿50') // Q3b-12
  await page.getByTestId('close-bank-qr').fill('50')
  await expect(page.getByTestId('neg-base-PB-TEA-THAI')).toBeVisible() // D28

  await enterPin(page, OWNER.pin) // no reason yet → refused on screen, nothing sent
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByTestId('close-reason').fill('ทอนเงินผิด')
  await enterPin(page, OWNER.pin)

  await expect(page).toHaveURL(/\/z\//)
  await expect(page.getByTestId('z-hash')).toHaveAttribute('data-ok', 'true')
  await expect(page.getByTestId('z-chain-warning')).toHaveCount(0)
  await expect(page.getByTestId('z-net')).toHaveText('฿140')
  await expect(page.getByTestId('z-qr-net')).toHaveText('฿50')
  await expect(page.getByTestId('z-bank-qr')).toHaveText('฿50')
  await expect(page.getByTestId('z-qr-diff')).toHaveText('฿0')
  await expect(page.getByTestId('z-expected')).toHaveText('฿570')
  await expect(page.getByTestId('z-counted')).toHaveText('฿540')
  await expect(page.getByTestId('z-variance')).toHaveText('-฿30')
  await expect(page.getByTestId('z-reason')).toHaveText('ทอนเงินผิด')
  await expect(page.getByTestId('backup-due')).toBeVisible()

  // backup: the whole SQLite file lands in Downloads (Q3b-6) and counts only once the owner confirms it (Q3b-7 · I-4)
  await page.getByTestId('nav-backup').click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('backup-download').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^dayo-pos-A-\d{8}-\d{6}\.sqlite3$/)
  const bytes = readFileSync(await download.path())
  expect(bytes.subarray(0, 16).toString('latin1')).toBe('SQLite format 3\u0000')
  await expect(page.getByTestId('backup-file')).toContainText(download.suggestedFilename())
  await expect(page.getByTestId('backup-done')).toHaveCount(0)
  await page.getByTestId('backup-confirm').click()
  await expect(page.getByTestId('backup-done')).toBeVisible()

  // next day: the sell screen needs a new shift; the banner is gone; the past Z is listed
  await page.getByTestId('nav-home').click()
  await expect(page).toHaveURL(/\/shift\/open$/)
  await expect(page.getByTestId('backup-due')).toHaveCount(0)
  await page.getByTestId('nav-z-list').click()
  await expect(page.getByTestId('z-row-0')).toBeVisible()
  await expect(page.getByTestId('z-warn-0')).toHaveCount(0)
})

test('quick open (spec §4.8 · Q3b-10): an owner opens with a 0 float and the X report marks it', async ({ page }) => {
  await firstRun(page)
  // close the first shift with an exact count so we reach the open-shift screen again
  await page.getByTestId('close-shift-open').click()
  await page.getByTestId('count-50000').fill('1')
  await page.getByTestId('count-done').click()
  await enterPin(page, OWNER.pin)
  await expect(page).toHaveURL(/\/z\//)
  await page.getByTestId('z-done').click()

  await page.getByTestId('shift-quick-open').click()
  await expect(page).toHaveURL(/\/sell$/)
  await page.getByTestId('nav-shift').click()
  await expect(page.getByTestId('x-quick')).toBeVisible()
  await expect(page.getByTestId('x-opening')).toHaveText('฿0')
})
```

Run: `pnpm --filter @dayo/pos exec vitest run CloseShiftScreen count-input` แล้ว `pnpm --filter @dayo/pos exec playwright test close-shift`
Expected: FAIL — `Failed to resolve import "./CloseShiftScreen"` / `parseCountInput is not a function` · e2e หา `getByTestId('close-shift-open')` ไม่เจอ (timeout)

- [ ] **Step 2: `parseCountInput`**

แก้ `apps/pos/src/ui/format.ts` — ต่อท้ายไฟล์:
```ts

/** Pieces of one note/coin typed at shift close: "" → 0 · "12" → 12 · anything else (or over 99999) → null. */
export function parseCountInput(text: string): number | null {
  const t = text.trim()
  if (t === '') return 0
  return /^\d{1,5}$/.test(t) ? Number(t) : null
}
```

- [ ] **Step 3: หน้าปิดกะ**

`apps/pos/src/screens/CloseShiftScreen.tsx`
```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import { CASH_DENOMINATIONS_SATANG, tallyCashCount, varianceNeedsReason, type CashCountLine } from '@dayo/domain'
import { posErrorCode } from '../api/errors'
import { REASON_MAX_LENGTH, type CloseShiftInput } from '../api/types'
import { useApi } from '../app/api-context'
import { useCart } from '../app/cart-context'
import { bootstrapKey, ordersKey, shiftReportKey, useBootstrap, zListKey } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { formatBaht, parseBahtInput, parseCountInput } from '../ui/format'
import { TH } from '../ui/th'
import { PinPad } from './PinPad'
import { NegativeBaseList, QrTable } from './ShiftFigures'

/**
 * spec §4.8 / §5 ปิดวัน, reached from the sell screen (not from the X report): count the drawer by denomination
 * (Q3b-1) blind → only after "นับเสร็จ" show expected cash and the variance (Q3b-3 · review I-2) → reason when above the
 * threshold → PromptPay received / refunded / net and the optional bank-app total (Q3b-12) → an owner confirms with
 * their PIN (Q3b-2). If the previous Z fails its hash, the API answers Z_CHAIN_BROKEN and the owner acknowledges it by
 * entering their PIN once more (Q3b-11 · D53).
 */
export function CloseShiftScreen(): JSX.Element {
  const api = useApi()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const boot = useBootstrap()
  const { user } = useSession()
  const cart = useCart()
  const report = useQuery({ queryKey: shiftReportKey, queryFn: () => api.shiftReport() })
  const [texts, setTexts] = useState<Record<number, string>>({})
  const [counted, setCounted] = useState(false)
  const [reason, setReason] = useState('')
  const [bankText, setBankText] = useState('')
  const [chainBroken, setChainBroken] = useState(false)
  const owners = (boot.data?.users ?? []).filter((u) => u.role === 'owner')
  const [approverId, setApproverId] = useState<string | null>(user?.role === 'owner' ? user.id : null)
  const [error, setError] = useState<string | null>(null)

  const close = useMutation({
    mutationFn: (input: CloseShiftInput) => api.closeShift(input),
    onSuccess: async (z) => {
      // navigate first: a refetched bootstrap (openShift null) would otherwise redirect this screen to /shift/open
      void navigate({ to: '/z/$shiftId', params: { shiftId: z.shiftId } })
      queryClient.removeQueries({ queryKey: shiftReportKey })
      await Promise.all([bootstrapKey, zListKey, ordersKey].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
    },
    onError: async (e) => {
      if (posErrorCode(e) === 'Z_CHAIN_BROKEN') setChainBroken(true)
      setError(errorMessage(e))
      await queryClient.invalidateQueries({ queryKey: shiftReportKey }) // SHIFT_CHANGED: show the fresh expected cash
    },
  })

  if (boot.data !== undefined && boot.data.openShift === null) return <Navigate to="/shift/open" />
  if (report.isError) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(report.error)}
        </p>
      </main>
    )
  }
  if (report.data === undefined) return <main className="page">{TH.loading}</main>
  const r = report.data

  const parsed = CASH_DENOMINATIONS_SATANG.map((d) => ({ denominationSatang: d, count: parseCountInput(texts[d] ?? '') }))
  const valid = parsed.every((l) => l.count !== null)
  const lines: CashCountLine[] = parsed.map((l) => ({ denominationSatang: l.denominationSatang, count: l.count ?? 0 }))
  const totalSatang = valid ? tallyCashCount(lines).totalSatang : null
  const variance = totalSatang === null ? null : totalSatang - r.expectedCashSatang
  const needsReason = variance !== null && varianceNeedsReason(variance, r.varianceAlertSatang)

  const submit = (pin: string): void => {
    if (!counted || totalSatang === null) return setError(TH.errCountFirst)
    if (needsReason && reason.trim() === '') return setError(TH.errVarianceReasonRequired)
    if (approverId === null) return setError(TH.errNotOwner)
    const bankQrTotalSatang = bankText.trim() === '' ? null : parseBahtInput(bankText)
    if (bankText.trim() !== '' && bankQrTotalSatang === null) return setError(TH.errBadInput)
    setError(null)
    close.mutate({
      actorUserId: user?.id ?? '',
      approverUserId: approverId,
      approverPin: pin,
      countLines: lines,
      shownExpectedCashSatang: r.expectedCashSatang,
      varianceReason: reason.trim() === '' ? null : reason,
      bankQrTotalSatang,
      acknowledgeZChainBroken: chainBroken,
    })
  }

  return (
    <main className="page">
      <div className="actions">
        <button type="button" data-testid="nav-sell" onClick={() => void navigate({ to: '/sell' })}>
          {TH.back}
        </button>
      </div>
      <h1>{TH.closeTitle}</h1>
      {cart.state.lines.length > 0 && (
        <p role="alert" className="error" data-testid="close-cart-not-empty">
          {TH.cartNotEmpty}
        </p>
      )}
      <table className="figures">
        <thead>
          <tr>
            <th scope="col">{TH.denomination}</th>
            <th scope="col">{TH.pieces}</th>
          </tr>
        </thead>
        <tbody>
          {CASH_DENOMINATIONS_SATANG.map((d) => (
            <tr key={d}>
              <th scope="row">{formatBaht(d)}</th>
              <td>
                <input
                  data-testid={`count-${d}`}
                  inputMode="numeric"
                  disabled={counted}
                  value={texts[d] ?? ''}
                  onChange={(e) => setTexts((t) => ({ ...t, [d]: e.target.value }))}
                />
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row">{TH.countedTotal}</th>
            <td data-testid="close-counted">{totalSatang === null ? TH.errCountFormat : formatBaht(totalSatang)}</td>
          </tr>
        </tbody>
      </table>
      {!counted ? (
        <>
          {error !== null && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="actions">
            <button type="button" className="primary" data-testid="count-done" disabled={totalSatang === null || cart.state.lines.length > 0} onClick={() => setCounted(true)}>
              {TH.countDone}
            </button>
          </div>
        </>
      ) : (
        <>
          <table className="figures">
            <tbody>
              <tr>
                <th scope="row">{TH.expectedCash}</th>
                <td data-testid="close-expected">{formatBaht(r.expectedCashSatang)}</td>
              </tr>
              <tr>
                <th scope="row">{TH.variance}</th>
                <td data-testid="close-variance" className={needsReason ? 'error' : undefined}>
                  {variance === null ? '' : formatBaht(variance)}
                </td>
              </tr>
            </tbody>
          </table>
          <label>
            {TH.varianceReason} {needsReason && `(${TH.varianceReasonHint(formatBaht(r.varianceAlertSatang))})`}
            <input data-testid="close-reason" maxLength={REASON_MAX_LENGTH} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <QrTable sales={r.sales} p="close" />
          <label>
            {TH.bankQrTotal}
            <input data-testid="close-bank-qr" inputMode="decimal" value={bankText} onChange={(e) => setBankText(e.target.value)} />
          </label>
          <NegativeBaseList items={r.negativeBases} />
          <p className="badge" data-testid="close-pending">
            {TH.pendingAtClose(r.pendingSyncItems)}
          </p>
          <div className="actions">
            <button type="button" data-testid="count-edit" onClick={() => setCounted(false)}>
              {TH.countEdit}
            </button>
          </div>
          {chainBroken && (
            <p role="alert" className="error" data-testid="close-chain-broken">
              {TH.zChainAck}
            </p>
          )}
          <h3>{TH.closeApprover}</h3>
          <div className="choices">
            {owners.map((u) => (
              <button key={u.id} type="button" data-testid={`close-approver-${u.displayName}`} aria-pressed={approverId === u.id} onClick={() => setApproverId(u.id)}>
                {u.displayName}
              </button>
            ))}
          </div>
          <PinPad busy={close.isPending} error={error} onSubmit={submit} />
        </>
      )}
    </main>
  )
}
```

- [ ] **Step 4: ปุ่มปิดกะบนหน้าขาย · หน้าเปิดกะ · route**

แก้ `apps/pos/src/screens/SellScreen.tsx` — ต่อจากปุ่ม `data-testid="nav-shift"` (หลัง `</button>` ของมัน) เพิ่ม:
```tsx
        {/* Q3b-3 · D52 (review I-2): closing starts here, not from the X report, so the drawer is counted blind */}
        <button type="button" data-testid="close-shift-open" onClick={() => void navigate({ to: '/shift/close' })}>
          {TH.closeShift}
        </button>
```

แทน `apps/pos/src/screens/OpenShiftScreen.tsx` ทั้งไฟล์:
```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent, type JSX } from 'react'
import { useApi } from '../app/api-context'
import { bootstrapKey, useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import { errorMessage } from '../ui/errors'
import { parseBahtInput } from '../ui/format'
import { TH } from '../ui/th'

export function OpenShiftScreen(): JSX.Element {
  const api = useApi()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const boot = useBootstrap()
  const { user } = useSession()
  const [floatText, setFloatText] = useState('') // no default: count the drawer every morning, 0 allowed (D48 Q3-12)
  const [error, setError] = useState<string | null>(null)

  const onOpened = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: bootstrapKey })
    void navigate({ to: '/sell' })
  }
  const open = useMutation({
    mutationFn: (openingFloatSatang: number) => api.openShift({ userId: user?.id ?? '', openingFloatSatang }),
    onSuccess: onOpened,
    onError: (e) => setError(errorMessage(e)),
  })
  // spec §4.8 "เปิดกะด่วน": owner only, float 0, recorded separately (plan 3 M18 · Q3b-10 · D52)
  const quick = useMutation({
    mutationFn: () => api.quickOpenShift({ userId: user?.id ?? '' }),
    onSuccess: onOpened,
    onError: (e) => setError(errorMessage(e)),
  })

  if (boot.data?.openShift) return <Navigate to="/sell" />

  const submit = (ev: FormEvent): void => {
    ev.preventDefault()
    const satang = parseBahtInput(floatText)
    if (satang === null) return setError(TH.errBadInput)
    setError(null)
    open.mutate(satang)
  }

  return (
    <main className="page">
      <h1>{TH.shiftOpenTitle}</h1>
      {boot.data?.backupDue === true && (
        <p role="alert" className="error" data-testid="backup-due">
          {TH.backupDue}
        </p>
      )}
      <form className="list" onSubmit={submit}>
        <label>
          {TH.shiftOpeningFloat}
          <input data-testid="shift-float" inputMode="decimal" value={floatText} onChange={(e) => setFloatText(e.target.value)} required />
        </label>
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="primary" data-testid="shift-open" disabled={open.isPending || quick.isPending}>
          {TH.shiftOpen}
        </button>
      </form>
      {user?.role === 'owner' && (
        <button type="button" data-testid="shift-quick-open" disabled={open.isPending || quick.isPending} onClick={() => quick.mutate()}>
          {TH.quickOpen}
        </button>
      )}
      <div className="actions">
        <button type="button" data-testid="nav-z-list" onClick={() => void navigate({ to: '/z' })}>
          {TH.zList}
        </button>
        <button type="button" data-testid="nav-backup" onClick={() => void navigate({ to: '/backup' })}>
          {TH.backupTitle}
        </button>
      </div>
    </main>
  )
}
```

แก้ `apps/pos/src/router.tsx`:
- ต่อจาก `import { CashPayScreen } from './screens/CashPayScreen'` เพิ่ม `import { CloseShiftScreen } from './screens/CloseShiftScreen'`
- ต่อจาก `const shiftRoute = createRoute({ … })` เพิ่ม:
```tsx
const closeShiftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shift/close',
  component: () => (
    <RequireSession>
      <CloseShiftScreen />
    </RequireSession>
  ),
})
```
- ใน `rootRoute.addChildren([...])` ต่อจาก `shiftRoute,` เพิ่ม `closeShiftRoute,`

- [ ] **Step 5: รันให้ผ่าน**

Run:
```bash
pnpm --filter @dayo/pos test
pnpm --filter @dayo/pos typecheck
pnpm --filter @dayo/pos e2e
```
Expected: unit/integration **123 ผ่าน** (118 + `count-input` 2 + `CloseShiftScreen` 3) · e2e **9 เทสต์ผ่าน** (7 + `close-shift` ×2) · เทสต์ backup ใน e2e ใช้ `exportFile` ของ `opfs-sahpool` จริงใน Chromium ตรวจ 16 ไบต์แรก `SQLite format 3\0` แล้วกด `backup-confirm` ก่อนแถบ `backup-due` จะหาย · ถ้า `backup-download` ไม่เกิด event `download` ให้ตรวจว่า `downloadBytes` ใส่ `<a>` ลงใน `document.body` ก่อน `click()` · หน้าปิดกะนำทางไปหน้า Z **ก่อน** invalidate `bootstrapKey` (ถ้าสลับ หน้าจะเด้งไป `/shift/open` เพราะกะปิดแล้ว)

- [ ] **Step 6: Commit**

ใช้ skill `committing-code` แล้ว:
```bash
git add apps/pos/e2e/close-shift.spec.ts apps/pos/src/ui/count-input.test.ts apps/pos/src/ui/format.ts apps/pos/src/screens/CloseShiftScreen.tsx apps/pos/src/screens/CloseShiftScreen.test.tsx apps/pos/src/screens/SellScreen.tsx apps/pos/src/screens/OpenShiftScreen.tsx apps/pos/src/router.tsx
git commit -m "feat(pos): blind-count shift close from the sell screen with bank qr total and quick open"
```

---

### Task 12: ตรวจทั้ง repo · บันทึกการทำแผน · ⛔ รายการทดสอบแท็บเล็ต (เลื่อนไปรอบท้ายสุด D51) · final review (opus) · merge ในเครื่อง

**Files:**
- Create: `docs/superpowers/plans/2026-09-17-03b-บันทึกการทำแผน3b.md`
- Modify: `docs/superpowers/plans/README.md`

**Interfaces:**
- Consumes: ทุกอย่างก่อนหน้า · CI job `e2e` ของแผน 3 (รันทุก spec ใน `apps/pos/e2e` อยู่แล้ว ไม่ต้องแก้ `ci.yml`)
- Produces: บันทึกการทำแผน 3b · README แถว 3b = เสร็จ · final review (opus) ผ่าน · merge `--no-ff` เข้า `main` ในเครื่อง (ไม่ push — D49)

- [ ] **Step 1: ตรวจทั้ง repo ในเครื่อง**

Run:
```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm --filter @dayo/pos e2e
git status --short
git log --format=%B main..HEAD | grep -ci "co-authored-by"
```
Expected: ทุกแพ็กเกจผ่าน (domain 115 · pos 123) · e2e 9 ผ่าน · `git status` ไม่มี `test-results/`, `playwright-report/`, `dist/` ค้าง · คำสั่งสุดท้ายพิมพ์ `0`

- [ ] **Step 2: รายการทดสอบบนแท็บเล็ตจริง** ⛔ HAND-OFF เจ้าของร้าน — **เลื่อนไปทำในรอบทดสอบแท็บเล็ตตอนท้ายสุด (D51) ร่วมกับตาราง spike S1–S10 และแผน 3 Task 15 Step 4**

> **agent ห้ามทำแทน ห้ามกรอกผลแทน และห้ามเขียนว่าผ่าน** · agent แค่ใส่ตารางด้านล่างลงในบันทึกการทำแผน (Step 3) แบบช่องผลว่าง แล้วทำ Step 4–7 ต่อได้เลย (D51 ให้ merge ได้โดยยังไม่มีผลแท็บเล็ต) · **ยังห้ามขายจริง** จนกว่ารอบแท็บเล็ตนี้ผ่าน และ deploy Cloudflare Pages แล้ว (D48 Q3-2, Q3-17)

เปิดแอปวิธีเดียวกับแผน 3 Task 15 Step 4 (build + `vite preview --port 4173` + Quick Tunnel / `adb reverse`) แล้วทำ:
1. ขาย 2–3 บิล (มีพร้อมเพย์ 1 บิล) + ยกเลิก 1 บิล + บันทึกจ่ายออก 1 รายการ → เปิด "กะ / รายงาน X" ตัวเลขตรงกับที่ขาย และ **ไม่มี** บรรทัดเงินสดที่ควรมี
2. ปิดกะจากปุ่ม "ปิดกะ" บนหน้าขาย: นับเงินจริงในลิ้นชักลงตาราง 9 ชนิด (ยังไม่เห็นยอดที่ควรมี) → "นับเสร็จ" → เห็นยอดที่ควรมีและส่วนต่าง → กรอกยอดพร้อมเพย์จากแอปธนาคาร → ถ้าเกิน ฿20 ต้องใส่เหตุผล → PIN เจ้าของ → หน้า Z แสดง "ตรวจลายเซ็นแล้ว" และส่วนต่างพร้อมเพย์
3. หน้า Z → "สำรองไฟล์ฐานข้อมูล" → "ดาวน์โหลดไฟล์สำรอง" → **ไฟล์ `dayo-pos-A-….sqlite3` อยู่ในโฟลเดอร์ Download ของแท็บเล็ต** (เปิดจากแอปที่ติดตั้งแล้ว ไม่ใช่แท็บ Chrome ธรรมดา) → เห็นไฟล์แล้วกด "บันทึกไฟล์แล้ว" · จดขนาดไฟล์และเวลาที่ใช้
4. ย้ายไฟล์ไป Google Drive หรือคอม → เปิดด้วย DB Browser for SQLite (หรือ `sqlite3`) → เห็นตาราง `order`, `z_report` มีข้อมูลครบ
5. กด "เสร็จ" → หน้าเปิดกะ → แถบเตือนสำรองหายไปหลังกด "บันทึกไฟล์แล้ว" เท่านั้น → "เปิดกะด่วน" → หน้าขาย → X แสดง "เปิดกะด่วน" และเงินทอน ฿0
6. (ไม่บังคับ) เปิดกะทิ้งไว้ข้ามคืนถึงหลัง 05:00 → หน้าขายขึ้นแถบแดง "กะของวันที่ … ยังไม่ปิด"

**M16 (ย้ำ):** ห้ามจดหมายเลขพร้อมเพย์จริง/PIN จริงลงไฟล์ใด ๆ หรือภาพหน้าจอที่ commit · ไฟล์สำรองมี `pin_hash` และหมายเลขพร้อมเพย์ของร้าน — **ห้าม commit ไฟล์ `.sqlite3` เข้า git และห้ามส่งให้คนนอก**

- [ ] **Step 3: บันทึกการทำแผน + README**

สร้าง `docs/superpowers/plans/2026-09-17-03b-บันทึกการทำแผน3b.md` (กรอกค่าจริง ห้ามเว้นหัวข้อ — ถ้าไม่มีให้เขียน "ไม่มี"):
```markdown
# บันทึกการทำแผน 3b (pos-shift-close) — การตัดสินใจระหว่างทำ และสิ่งที่ส่งต่อ

สถานะ: ✅/⚠️ · จำนวนเทสต์ (unit/integration/e2e) · branch `plan-3b-shift-close` · ยังไม่ push (D49) · ⏸️ ทดสอบแท็บเล็ตรอรอบท้ายสุด (D51)

## 1. ทดสอบบนแท็บเล็ต (⛔ HAND-OFF — รอรอบท้ายสุด D51)
รุ่นแท็บเล็ต / เวอร์ชัน Chrome: _(เจ้าของกรอกเอง)_

| ข้อ | รายการ (Task 12 Step 2) | ผลลัพธ์ | ค่าที่วัดได้ | วิธีเปิด |
|---|---|---|---|---|
| 1 | X ตรงกับที่ขาย | | | |
| 2 | ปิดกะ นับจริง ส่วนต่าง/เหตุผล/PIN/Z | | | |
| 3 | ดาวน์โหลดไฟล์สำรองจากแอปที่ติดตั้ง | | ขนาดไฟล์ · เวลา | |
| 4 | เปิดไฟล์สำรองบนคอม ข้อมูลครบ | | | |
| 5 | แถบเตือนสำรอง · เปิดกะด่วน | | | |
| 6 | (ไม่บังคับ) แถบกะค้างข้ามวันหลัง 05:00 | | | |

## 2. คำตอบของเจ้าของที่ใช้ (Q3b-1 … Q3b-10 → D52 · Q3b-11 … Q3b-13 → D53) และคำถามใหม่ระหว่างทำ

## 3. การตัดสินใจระหว่างทำที่ไม่ได้อยู่ในแผน

## 4. ผล final review (opus) และการแก้

## 5. ส่งต่อแผน 4–8 และงาน deploy
- แผน 5: outbox มีตารางใหม่ `cash_count`, `z_report` และ key `shift:<id>:closed` (แถว `shift` เปลี่ยนสถานะได้ → push handler upsert ตาม id เหมือน `order`) · `audit_log` (`quick_open`, `backup`, `z_chain_broken_ack`) ยังเป็น local-only · ธง `openedQuick`, `chainWarning` และยอด `bankQrTotalSatang`/`qrDifferenceSatang` อยู่ใน snapshot ของ Z · `sync_state` key `local.last_backup_at`, `local.last_backup_z_id` เป็นของเครื่อง ไม่ sync
- แผน 5: setting `cash.variance_alert_satang` ยังไม่มีในเครื่อง (ใช้ค่าเริ่มต้น 2,000) — seed/sync ค่าจริงได้ตามแถว `setting` (D47 ข้อ 9)
- แผน 7: รายงานยอดขายต้องใช้นิยามเดียวกับ `summarizeShiftSales` (net = gross − ส่วนลด − ยอดยกเลิก ตาม Q3b-4) · export CSV ของ Z
- แผน 8: invariant 6 (แฮช Z) ใช้ `zReportHash` ตัวเดียวกัน · invariant 7 (ธุรกรรมต้องมี shift)
- งาน deploy Cloudflare Pages: ข้อ `registerType: 'prompt'` จากบันทึกแผน 3 §5 ยังค้าง
```

แก้แถว 3b ใน `docs/superpowers/plans/README.md` เป็น:
```markdown
| 3b | [2026-09-17-03b-pos-shift-close.md](2026-09-17-03b-pos-shift-close.md) | 3 | ปิดกะ · นับเงินแยกธนบัตร · X/Z report · เงินเข้า-ออก · เปิดกะด่วน · ปุ่มสำรองไฟล์ฐานข้อมูล — **ต้องเสร็จก่อนใช้ขายจริง** (D48 Q3-17) · ก่อนขายจริงต้อง deploy Cloudflare Pages ด้วย (งานเล็กแยก — D48 Q3-2) | ✅ merge เข้า main ในเครื่องแล้ว YYYY-MM-DD · ⏸️ ทดสอบบนแท็บเล็ตทำตอนท้ายสุด (D51) ([คำถาม](2026-09-17-03b-คำถามก่อนทำ.md) · [บันทึก](2026-09-17-03b-บันทึกการทำแผน3b.md)) |
```

- [ ] **Step 4: Commit**

ใช้ skill `committing-code` แล้ว:
```bash
git add docs/superpowers/plans/2026-09-17-03b-บันทึกการทำแผน3b.md docs/superpowers/plans/README.md
git commit -m "docs(plan-3b): execution notes and tablet checklist deferred to the final round (d51)"
```

- [ ] **Step 5: final review ทั้ง branch ด้วย opus (D42, D43)**

ส่ง review ทั้ง branch (`main..plan-3b-shift-close`) ให้ reviewer **opus** · ขอบเขต: spec §3.5, §4.3, §4.7, §4.8, §5, §6.1, §7 invariant 6, §11, §12 (เทียบ QR กับแอปธนาคาร) · D22, D28, D36, D42–D53 · Global Constraints ของแผนนี้ · จุดที่ต้องดูเป็นพิเศษ:
- สูตร D36 และนิยามยอดขาย (Q3b-4) — แต่ละแถว `cash_movement` นับครั้งเดียว · บิลยกเลิกอยู่ใน gross · `cash_sales` รวมบิลที่ยกเลิกภายหลัง
- ไม่มี UPDATE/DELETE ของ `cash_movement`/`z_report`/`stock_movement`/`order_event` · UPDATE ใหม่มีแค่ `shift` ตอนปิดกะ · ทุกการเขียนอยู่ใน transaction เดียวพร้อม outbox · PIN ตรวจนอก transaction
- Z ไม่ถูกคำนวณใหม่หลังปิด · แฮชตรวจทุกครั้งที่อ่าน · Z ใบก่อนแฮชไม่ตรง → `Z_CHAIN_BROKEN` → เจ้าของรับทราบด้วย PIN → grand total ต่อจากค่าคำนวณใหม่ (ไม่ใช่ค่าที่เก็บ) + ธง `chainWarning` ถาวร + audit (Q3b-11 · D53)
- นับแบบไม่เห็นยอดจริง: ไม่มีหน้าใดแสดงเงินสดที่ควรมีของกะที่เปิดอยู่ก่อนกด "นับเสร็จ" (Q3b-3 · D52) · สำรองไฟล์: เจ้าของเท่านั้น และนับว่าสำรองแล้วเมื่อยืนยันเท่านั้น (Q3b-7 · D52, Q3b-13 · D53)
- ปิดกะไม่ได้ถ้าเหตุผลหาย (เกินเกณฑ์) หรือยอดเปลี่ยน (`SHIFT_CHANGED`) — และไม่เขียนอะไรเลยในกรณีนั้น
- ไฟล์สำรองเป็น SQLite ที่เปิดได้ · อ่านในคิว serial · ไม่มีไฟล์ `.sqlite3` ใน git
- ไม่มี trailer ของ AI: `git log --format=%B main..HEAD | grep -ci "co-authored-by"` ต้องได้ `0` · ไม่มีไฟล์ `.superpowers/`/`.claude/` ใน git
ผลเก็บใน `.superpowers/` (ไม่เข้า git — D45) · แก้ทุกข้อ Critical/Important ด้วย commit แยก (skill `committing-code` ทุกครั้ง) แล้วให้ opus ตรวจซ้ำจนไม่มีข้อค้าง · ข้อที่ต้องให้เจ้าของตัดสิน → เพิ่มในไฟล์คำถาม 3b แล้ว **หยุดรอ** · สรุปผลลงหัวข้อ 4 ของบันทึกการทำแผน แล้ว commit (`git add docs/superpowers/plans/2026-09-17-03b-บันทึกการทำแผน3b.md`)

- [ ] **Step 6: merge เข้า main ในเครื่อง — ห้าม push (D49)**

ทำเฉพาะเมื่อ Step 5 ผ่านและไม่มี issue ค้าง (D42):
```bash
git status --short            # ต้องว่าง (ใน worktree ของแผนนี้)
cd D:/TungAo-Project/pos-management   # worktree ที่ checkout main อยู่ — ห้าม `git checkout main` ใน worktree อื่น
git status --short            # ต้องว่าง
git merge --no-ff plan-3b-shift-close
pnpm install --frozen-lockfile && pnpm typecheck && pnpm test
```
ใช้ skill `committing-code` กับ merge commit (ข้อความสั้น เช่น `Merge plan 3b: shift close with denomination count, X and Z reports, cash moves, quick open and database backup` · ไม่มี trailer ของ AI) · **ห้าม `git push` ทุกรูปแบบ** — แจ้งเจ้าของว่า merge ในเครื่องแล้ว พร้อมเตือนว่ายังห้ามขายจริงจนกว่ารอบแท็บเล็ต (D51) และ deploy Pages เสร็จ

---

## คำตอบของเจ้าของที่แผนนี้ใช้ (D52–D53 · 19 ก.ย. "เห็นด้วย ทำต่อได้เลย" = ค่าแนะนำทุกข้อ)

ถ้าเจ้าของเปลี่ยนคำตอบภายหลัง แก้จุดในคอลัมน์ขวาก่อนทำ task นั้น แล้วจดในบันทึกการทำแผน

| คำถาม | คำตอบที่ใช้ | จุดในแผน |
|---|---|---|
| Q3b-1 ชนิดเงินที่นับ (D52) | 9 ชนิดตาม spec §5 ไม่มีเหรียญสตางค์ | Task 1: `CASH_DENOMINATIONS_SATANG` + เทสต์ `uses the 9 denominations` · Task 11: หน้าปิดกะวนตามค่าคงที่นี้ (testid `count-<satang>`) |
| Q3b-2 ใครปิดกะ (D52) | คนที่ล็อกอินนับ + เจ้าของกรอก PIN ซ้ำทุกครั้ง (แบบ void) | Task 6: `closeShift` เรียก `requireOwnerPin` · `closedBy`/`countedBy` · Task 11: ปุ่มเลือกเจ้าของ + PinPad · e2e |
| Q3b-3 นับแบบไม่เห็นยอด (D52 · review I-2) | นับจริงแบบไม่เห็นยอด: ปุ่มปิดกะอยู่บนหน้าขาย ไม่ผ่านหน้า X · หน้าปิดกะแสดงยอดที่ควรมีและส่วนต่างหลังกด "นับเสร็จ" เท่านั้น · หน้า X เปิดดูได้ตลอดแต่ไม่แสดงบรรทัดเงินสดที่ควรมี | Task 9: `DrawerTable hideExpected` · Task 10: `ShiftScreen` ไม่มี `x-expected` / ไม่มีปุ่มปิดกะ · e2e `shift-x` · Task 11: `close-shift-open` บนหน้าขาย · สถานะ `counted` · เทสต์ `CloseShiftScreen` + e2e ตรวจ `close-expected` ยังไม่แสดงก่อน `count-done` |
| Q3b-4 net / grand total (D52) | net = gross − ส่วนลด − ยอดบิลยกเลิก · grand total สะสม net | Task 1: `summarizeShiftSales`, `assertSalesSummary` + เทสต์ · Task 5/6: ตัวเลขคาดหวัง (net ฿40, grand) · e2e `z-net` |
| Q3b-5 แสดง/ส่งออก Z (D52) | แสดงบนจอหลังปิดกะ + Z ย้อนหลังในเครื่อง · ไม่ส่งออกแยก (CSV = แผน 7) | Task 6 `listZReports`/`getZReport` · Task 9 `ZReportScreen`/`ZListScreen` |
| Q3b-6 ปลายทางไฟล์สำรอง (D52) | ไฟล์ SQLite ทั้งไฟล์ลง Downloads ชื่อ `dayo-pos-A-YYYYMMDD-HHmmss.sqlite3` · เจ้าของย้ายไป Google Drive เอง · ไม่มีปุ่มแชร์ | Task 7: `backupFileName` / `exportBackup` · Task 8: `downloadBytes` / `BackupScreen` |
| Q3b-7 ความถี่/บังคับ (D52 · review I-4) | ไม่บังคับ · แถบแดงที่หน้า Z และหน้าเปิดกะจนกว่าจะ **ยืนยัน** ไฟล์สำรองที่ทำหลัง Z ใบล่าสุด · แถบหายเมื่อเจ้าของกด "บันทึกไฟล์แล้ว" หลังดาวน์โหลด ไม่ใช่ตอน export · บันทึก `sync_state` + `audit_log` ตอนยืนยัน | Task 7: `isBackupDue`, `confirmBackupSaved` · Task 8: `backup-confirm` · Task 9/11: แถบ `backup-due` |
| Q3b-8 กะค้างข้ามวัน (D52) | แถบแดงบนหน้าขายตั้งแต่ 05:00 เวลาไทย · ขายต่อได้ | Task 7: `STALE_SHIFT_CUTOFF_HOURS` + เทสต์ · Task 10: แถบ `shift-stale` |
| Q3b-9 เงินเข้า-ออก (D52) | ทำใน 3b · ทุกคนที่ล็อกอินบันทึกได้ · บังคับเหตุผล | Task 4 ทั้ง task · Task 10: `CashMoveDialog` |
| Q3b-10 เปิดกะด่วน (D52) | เจ้าของเท่านั้น · `audit_log quick_open` + ธง `openedQuick` ใน Z · ไม่แก้ schema · ไม่ต้อง PIN ซ้ำ (เปิดกะปกติด้วยเงินทอน 0 ทำได้ทุกคนอยู่แล้ว — D48 Q3-12) | Task 3 ทั้ง task · Task 5 `wasQuickOpened` · Task 11 ปุ่ม `shift-quick-open` |
| Q3b-11 Z ใบก่อนแฮชไม่ตรง (D53 · review I-3) | ปิดกะต่อได้ · รหัส `Z_CHAIN_BROKEN` เฉพาะ · เจ้าของกรอก PIN ซ้ำเพื่อรับทราบ · Z ใหม่มีธง `chainWarning` ถาวร แสดงที่หน้า Z และ Z ย้อนหลัง · grand total ต่อจากค่าที่ **คำนวณใหม่** จาก snapshot ทุกใบเรียงตาม `zNo` · เขียน `audit_log` | Task 1: `ZChainWarning`, `recomputeZChain` · Task 6: `zChain`, `Z_CHAIN_BROKEN`, `acknowledgeZChainBroken`, `Z_CHAIN_ACK_ACTION` + เทสต์ · Task 9: `z-chain-warning`, `z-warn-<i>` · Task 11: `close-chain-broken` + เทสต์ |
| Q3b-12 เทียบพร้อมเพย์กับแอปธนาคาร (D53) | หน้าปิดกะแสดงพร้อมเพย์รับ / โอนคืน / สุทธิ + ช่องกรอกยอดในแอปธนาคาร · ส่วนต่าง (ธนาคาร − สุทธิ) แช่แข็งใน Z · ช่องนี้ **ไม่บังคับ ไม่มีเกณฑ์/เหตุผล** (review ไม่ได้เสนอ — แผนเลือกเอง) | Task 1: `qrRefundedSatang`, `qrNetSatang`, `bankQrTotalSatang`, `qrDifferenceSatang` · Task 6: `CloseShiftInput.bankQrTotalSatang` · Task 9: `QrTable` · Task 11: `close-bank-qr` |
| Q3b-13 ความลับของไฟล์สำรอง (D53) | เจ้าของเท่านั้นที่สำรองได้ (API + หน้าจอ) · ยอมรับว่าในไฟล์มี `pin_hash` และหมายเลขพร้อมเพย์ · ไม่เข้ารหัส | Task 7: `exportBackup`/`confirmBackupSaved` → `NOT_OWNER` · Task 8: `backup-owner-only` + เทสต์ |

---

## Self-review (18–19 ก.ย. 2026 ตอนเขียนแผน · ปรับตามคำตอบ D52–D53 และ review I-2/I-3/I-4 วันที่ 19 ก.ย.)

**1. Spec coverage**

| spec / ข้อกำหนด | ที่ทำ |
|---|---|
| §4.8 ปิดกะ: นับธนบัตร → expected (D36) → variance → เกิน `cash.variance_alert_satang` ต้องใส่เหตุผล | Task 1 (`cashInputsFromMovements`, `tallyCashCount`, `varianceNeedsReason`, `buildZReport`) · Task 6 (`closeShift`) · Task 11 (หน้าปิดกะ) |
| §5 ตาราง 1000/500/100/50/20/10/5/2/1 · ปิดวันต้อง owner | Task 1 (`CASH_DENOMINATIONS_SATANG` — Q3b-1) · Task 6 (`requireOwnerPin` — Q3b-2) |
| §4.8 X = คำนวณสดได้ตลอด · นับแบบไม่เห็นยอด (Q3b-3) | Task 5 (`shiftReport` ไม่เขียนอะไร) · Task 10 (`/shift` ไม่แสดงเงินสดที่ควรมี) · Task 11 (ปิดกะจากหน้าขาย · ยอดหลัง "นับเสร็จ") |
| §4.8 Z = snapshot + hash ห้ามคำนวณใหม่ · grand total ต่อจาก Z ก่อนหน้า · §7 invariant 6 | Task 1 (`zReportHash`, `recomputeZChain`) · Task 6 (insert ครั้งเดียว · `hashOk` ทุกครั้งที่อ่าน · Z ก่อนแฮชไม่ตรง → `Z_CHAIN_BROKEN` → รับทราบด้วย PIN → ต่อจากค่าคำนวณใหม่ + `chainWarning` + audit — Q3b-11 · เทสต์ trigger append-only) · Task 9 (หน้าจอแสดง snapshot + ธงเตือน) |
| §4.3 บิลยกเลิกอยู่ใน gross และแยกเป็นยอดยกเลิก | Task 1 (`summarizeShiftSales` — Q3b-4) · Task 5 |
| spec §12 ความเสี่ยง "QR ยืนยันด้วยตา … ปิดวันเทียบยอด QR กับแอปธนาคาร" (Q3b-12) | Task 1 (QR รับ/โอนคืน/สุทธิ · `qrDifferenceSatang`) · Task 6 (`bankQrTotalSatang`) · Task 9 (`QrTable`) · Task 11 (`close-bank-qr`) |
| §4.8 เปิดกะด่วน (owner · เงินทอน 0 · event) — ส่งต่อ M18 | Task 3 · Task 11 (Q3b-10) |
| §3.5 `PAID_IN`/`PAID_OUT`/`DROP` คนบันทึกเอง | Task 4 · Task 10 (Q3b-9) |
| §11 สำรองด้วย export ไฟล์ SQLite · spike I3 `exportFile` · แผน 3 notes §5 | Task 7 (`exportBackup` + เทสต์เปิดไฟล์คืน · `confirmBackupSaved` — Q3b-7/I-4 · เจ้าของเท่านั้น — Q3b-13) · Task 8 (หน้าสำรอง) · Task 11 e2e (ไฟล์จริงจาก OPFS + ยืนยัน) |
| D28 ปิดกะต้องดูรายการเบสติดลบ | Task 5 (`negativeBases`) · Task 11 (หน้าปิดกะ) |
| D50 Q3-22 รายงาน void ประจำวัน (หน้ารายงานอยู่แผน 3b) · notes §5 เลขอ้างอิงโอนคืนอ่านจาก event | Task 5 (`voids` จาก `VOIDED`) · Task 6 (แช่แข็งใน Z) · Task 9/10 (`VoidList`) |
| Plan 1 notes §4: `buildZReport` ไม่ตรวจ gross/discount/net และไม่บังคับเหตุผล | Task 1 (`assertSalesSummary` + ตรวจทุกความสัมพันธ์ รวม Σ บิลยกเลิกเงินสด = `VOID_REFUND` และ Σ บิลยกเลิกพร้อมเพย์ = โอนคืน + บังคับเหตุผล) |
| ส่งต่อ Task 13 M-4 เหตุผล void ≤ 200 + ใช้เพดานเดียวกับส่วนลด | Task 2 (+ ใช้กับเหตุผลใหม่ใน Task 4, 6) |
| §4.7 ขายหลังเที่ยงคืนยังเป็นวันเดิม / ลืมปิดกะ | Task 7 `isShiftStale` · Task 10 แถบเตือน (Q3b-8) |
| §6.1 1 transaction = ธุรกรรม + outbox · §6.2 push หลังปิดกะ | Task 4, 6 (outbox ทุกแถว) · T3b-3 (ปิดกะไม่รอ sync — แผน 5) |
| §8 e2e "… → ยกเลิก → ปิดกะ → Z" | Task 10 `shift-x.spec.ts` · Task 11 `close-shift.spec.ts` (ส่วน "→ sync ครบ" อยู่แผน 5/8 · บิลยกเลิกใน Z ตรวจด้วยเทสต์ Task 5/6) |
| D51 ทดสอบแท็บเล็ตตอนท้ายสุด | Task 12 Step 2 (⛔ HAND-OFF ตารางว่างในบันทึก) |

**ไม่อยู่ในแผนนี้ (ตั้งใจ):** deploy Cloudflare Pages + `registerType: 'prompt'` (งานเล็กแยก — D48 Q3-2, notes แผน 3 §5) · sync/outbox push และ seed setting `cash.variance_alert_satang` → แผน 5 · export CSV/รายงานช่วงยาว → แผน 7 · invariant รายคืน → แผน 8 · Task 13 M-5 (`actorUserId` เชื่อ UI) ยังไม่มีเจ้าของแผน — แผนนี้ทำตามแบบเดิม (ตรวจว่าผู้ใช้มีอยู่และเปิดใช้) ไม่แก้ · minor ที่พักไว้ของแผน 3 (Task 2, 5, 7, 10, 11) ไม่ได้ถูกส่งมาแผน 3b · minor ของ review แผนนี้ที่ยังไม่ทำ: m-2 ทำแล้วใน Global Constraints · m-1 และ m-3 ทำแล้ว (Task 1 / Task 11) · m-4 ถึง m-13 ยังไม่ได้ใส่ (ให้ final review ตัดสิน)

**2. Placeholder scan:** ค้น `TBD|TODO|implement later|similar to|fill in` แล้วไม่พบ · เครื่องหมาย `(รอ Q3b-N)` เดิมถูกแทนด้วยการอ้างคำตอบ `Q3b-N · D52` / `Q3b-N · D53` ครบทุกจุดแล้ว · ช่องว่างมีเฉพาะแบบฟอร์มบันทึกการทำแผน (ผลแท็บเล็ต — ห้าม agent กรอก) · โค้ดทุกไฟล์ในแผนถูกเขียนและรันจริงบน worktree ชั่วคราว (`git worktree add --detach ../pos-3b-scratch2`) หลังปรับตามคำตอบ แล้วคัดลอกเข้าแผน: domain 115 เทสต์ · pos 123 เทสต์ · typecheck ทุกแพ็กเกจ · build ผ่าน · e2e 9/9 บน Chromium รวม `exportFile` จริง · ตัวเลขคาดหวังคิดมือซ้ำใน `test/helpers/shift.ts`

**3. Type consistency (เทียบกับโค้ดจริงของแผน 1–3):** `RemoteDb` (`@dayo/db-schema/browser`) · ตาราง `s.shift`/`s.cashMovement`/`s.cashCount`/`s.zReport`/`s.auditLog`/`s.syncState`/`s.itemCostState`/`s.item` และคอลัมน์ `snapshotJson`, `linesJson`, `countedSatang`, `expectedSatang`, `varianceSatang`, `countedBy`, `closedBy`, `closedAt`, `onHandMilli`, `isTracked`, `useUnit` ตรงกับ `packages/db-schema/src/sqlite/*.ts` · `currentOpenShift(db, deviceId): ShiftDto | null`, `requireDevice`, `countPendingSyncItems`, `requireOwnerPin(db, deps, userId, pin)`, `getSetting(db, key, atIso)`, `enqueueOutbox(db, table, row, at, newId, keySuffix?)`, `PosError(code, detail)`, `posErrorCode(e)`, `createSerialQueue`, `ApiDeps { now, newId, pinCost, exportDbFile }`, `openReadyApi`/`sellSku`/`PINS`/`TEST_PIN_COST`/`ReadyApi` ตรงกับโค้ดจริง · `CashMovementKind` จาก contracts (`PAID_IN | PAID_OUT | DROP | VOID_REFUND`) ส่งเข้า `CashKind` ของ domain ได้ตรง · `PosApi` มี 18 เมธอด และ `POS_API_METHODS_COMPLETE` ตรวจครบด้วย type · ชื่อข้าม task: `REASON_MAX_LENGTH`, `insertOpenShift`, `quickOpenShift`, `wasQuickOpened`, `QUICK_OPEN_ACTION`, `recordCashMovement`, `toCashMovementDto`, `buildShiftReport`, `shiftReport`, `varianceAlertSatang`, `closeShift`, `listZReports`, `getZReport`, `deviceZRows`, `Z_CHAIN_ACK_ACTION`, `ZChainWarning`, `recomputeZChain`, `exportBackup`, `confirmBackupSaved`, `ConfirmBackupInput`, `BackupFileDto`, `backupFileName`, `lastBackupAt`, `lastBackupZId`, `isBackupDue`, `isSqliteFile`, `LAST_BACKUP_KEY`, `LAST_BACKUP_Z_ID_KEY`, `bangkokStamp`, `isShiftStale`, `STALE_SHIFT_CUTOFF_HOURS`, `vacuumInto`, `sellVoidScenario`, `COUNT_520`, `downloadBytes`, `parseCountInput`, `shiftReportKey`, `zListKey`, `zKey`, `SalesTable`, `QrTable`, `DrawerTable`, `VoidList`, `NegativeBaseList` — ตรงกันทุกจุด

**4. ความเสี่ยงที่รู้อยู่:** ดาวน์โหลดไฟล์จาก blob ใน PWA ที่ติดตั้งแล้วบน Android ยังไม่ได้ทดสอบบนเครื่องจริง (Task 12 Step 2 ข้อ 3 — ถ้าไม่ได้ต้องถามเจ้าของก่อนขายจริง · ปุ่ม "บันทึกไฟล์แล้ว" กันไม่ให้แถบเตือนหายเองถ้าไฟล์ไม่ลง) · `exportFile` ของ `opfs-sahpool` อ่านทั้งไฟล์เข้าหน่วยความจำ (~1.5 MB ตอนนี้ โตตามจำนวนบิล — ยังเล็กมากสำหรับแท็บเล็ต) · `closeShift` คำนวณ X ใหม่ใน transaction ทุกครั้ง (ร้านขายวันละไม่กี่ร้อยบิล — เร็วพอ) · snapshot ของ Z เป็น JSON ที่อ่านกลับมาแล้ว cast เป็น `ZSnapshot` — ป้องกันด้วยการตรวจแฮช (`hashOk`) ไม่ใช่ zod · ถ้า snapshot ที่แฮชไม่ตรงถูกแก้จน `sales.netSalesSatang` ไม่ใช่จำนวนเต็ม `recomputeZChain` คำนวณต่อไม่ได้ → `BAD_INPUT` (ต้องแก้ด้วยมือ — โอกาสต่ำมาก) · ส่วนต่างพร้อมเพย์คิดจากยอดตอนปิดกะจริง (ถ้ามีบิลพร้อมเพย์เข้าระหว่างหน้าจอเปิดอยู่ Z จะใช้ยอดล่าสุด ไม่ปฏิเสธแบบ `SHIFT_CHANGED`) · ไฟล์สำรองมีข้อมูลลับของร้าน (pin_hash, หมายเลขพร้อมเพย์) — เจ้าของยอมรับ (Q3b-13 · D53) · เตือนไว้ใน Task 12 Step 2
