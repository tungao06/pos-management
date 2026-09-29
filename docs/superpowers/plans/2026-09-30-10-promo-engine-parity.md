# แผน 10 — ราคาโปรบนแท็บเล็ตตรงกับเครื่องคิดโปรใหม่ของ dayo ทุกสตางค์ · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แท็บเล็ตคิดราคาทุกตะกร้าด้วยเครื่องคิดโปรชุดเดียวกับ dayo ปัจจุบัน (กฎโปร `rule` รุ่น 1–2 · กลุ่มโปร · หลายช่วงเวลา/ข้ามเที่ยงคืน · เพดาน/ปัดลง · ลดเฉพาะตัวเลือก · ขั้นบันได · โปรเลือกเอง) ได้ผลเท่ากันทุกสตางค์ มีหลักฐานเป็นเทสต์ที่ผูกกับไฟล์ของ dayo รุ่นที่ตรึงไว้ · ขอแคตตาล็อกด้วย `promo_rule_version` · ส่งบิลที่มีโปรเลือกเองขึ้น E2 · หน้าขายมีโปรเลือกเอง เหตุผลเมื่อเครื่องคิดบังคับ และส่วนลดแยกตามแก้ว

**Architecture:** `@dayo/dayo-pricing` คัดลอกไฟล์คิดราคา 8 ไฟล์ของ dayo (เพิ่ม `promoRule.ts`) และชุดเคสกลาง `promo-rules/*.json` ของ dayo แบบตรึง sha256 ใน `VENDOR.json` · `@dayo/contracts` รับแคตตาล็อกรูปใหม่ (โปรสองรูป · `promotionGroups` · `supported_fields` ที่มีค่าไม่ใช่ข้อความ) และแถว E2 ที่มีฟิลด์โปรเลือกเอง · `@dayo/domain` ส่ง `manualPromotionIds`/`manualPromotionReason` เข้าเครื่องคิด แปลงผลเป็นสตางค์ที่ `pricedFromQuote` จุดเดียว (รวม `promoBreakdown`) · แอปดึง E1 ด้วย `promo_rule_version` และขอใหม่ทั้งก้อนเมื่อรุ่นที่ขอเปลี่ยน · mock ของ dayo เล่นบทรุ่นใหม่และรุ่นเก่าได้

**Tech Stack:** TypeScript 5.9 · pnpm + turbo · zod 4 · vitest 5 · React 19 · SQLite WASM (OPFS) + drizzle-orm · Playwright · Node 22

**อ้างอิง:** รายงานผลกระทบ `docs/design/10-ผลกระทบโปรโมชันใหม่ของ-dayo-ต่อ-POS.md` (มีข้อผิด — ดู §0.1) · สเปก `docs/design/04-สเปกการเชื่อม-POS-กับ-dayo.md` §4.4 §4.5 §5.1–5.3 §6.3 · D21 D48(Q3-6) D50(Q3-20, Q3-27) D60 D61 D63 D72 D82 D84 D121 D122 D123 · dayo (อ่านอย่างเดียว): ADR-0070 · ADR-0071 · **ADR-0072** · `docs/pos-handoff-promo-rules.md` · `docs/API.md` §1–3 · `apps/web/openapi.yaml` (`/pos/catalog`, `/pos/push`) · `supabase/migrations/0069`, `0071`, `0073`, `0074` · `packages/shared/src/{types,promoRule,promotions,money}.ts` · `packages/shared/test/fixtures/promo-rules/` · `scripts/export-pos-parity.ts` · `scripts/version.ts`

**ต้องมีก่อนเริ่ม:** เจ้าของตอบ §0.3 ข้อ Q1–Q6 (อย่างน้อย Q1 ก่อน T6/T8 และ Q5 ก่อน T1) · `main` ที่ `b1b8689` เขียวทั้ง repo

## Global Constraints

- เงินในแท็บเล็ตเป็น **สตางค์จำนวนเต็ม** · บาท↔สตางค์ผ่าน `edgeBahtToSatang`/`edgeSatangToBaht` เท่านั้น · ผลของเครื่องคิด (บาท) แปลงที่ `pricedFromQuote` จุดเดียว · `apps/pos/**` ไม่คิดเงินเอง
- `packages/dayo-pricing/src/vendor/**` และ `fixtures/promo-rules/**` **ห้ามแก้ด้วยมือ** — ได้จาก `vendor:update` (git show ของ commit ที่ตรึง) เท่านั้น · ตรวจด้วย sha256 แบบ CRLF→LF (D72)
- ผู้เขียนคนเดียว (กฎเหล็ก 3): โปร/กลุ่มดึงอย่างเดียว · บิลส่งอย่างเดียว · **แท็บเล็ตไม่นับจำนวนครั้งของโปร** (`exhaustedPromotions` ว่างเสมอ — ADR-0072 ข้อ 2)
- แคตตาล็อกที่เครื่องคิดอ่านไม่ได้ = ปฏิเสธทั้งก้อน เก็บของเดิม (ruling R12 ของก้อน 2) · ไม่ทิ้งโปรทีละตัวเงียบ ๆ
- แถว E2 ที่ไม่มีโปรเลือกเอง **ต้องเหมือนเดิมทุกไบต์** (ไม่ใส่คีย์ใหม่) — กันแถวค้าง `UNSUPPORTED` บน dayo รุ่นเก่า
- repo dayo อ่านอย่างเดียว · ห้ามอ่าน `.env*` `.dev.vars` `backups/` · agent ไม่รัน `pos:parity` ของ dayo (เจ้าของรัน)
- ทุก task: `pnpm turbo run typecheck test` ผ่านทั้ง repo · commit ผ่าน `caveman:caveman-commit` (ระหว่างยังไม่ติดตั้งใช้ `committing-code`) · stage เป็นชื่อไฟล์ · ไม่มีบรรทัดระบุ AI · ห้าม `git checkout -- <ไฟล์>`/`git reset --hard` · `.superpowers/` `.claude/` ไม่ commit
- ไม่ทดสอบบนแท็บเล็ตจริงในแผนนี้ (D51) · เชื่อม dayo จริงเป็น Task 19 ของแผน 09 ทำหลังแผนนี้ (D123)

---

## 0. ภาพรวม

### 0.1 ข้อเท็จจริงที่ตรวจแล้ว (อ่านโค้ด 30 ก.ย.)

| # | ข้อเท็จจริง | ที่มา | ผลต่อแผน |
|---|---|---|---|
| F1 | dayo `main` = **`f4cda56`** (ต่อจาก `dde5ad4` → `d538392` → `f4cda56`) · มี ADR-0072 (ยอมรับ 30 ก.ย.) + migration 0073 ขั้นบันได · 0074 จำกัดจำนวนครั้ง · 0075 จำลอง · `PROMO_RULE_VERSIONS = [1, 2]` | `.git/logs/refs/heads/main` · `promoRule.ts:45` · ADR-0072 | Q5 |
| F2 | **E1 ของ dayo ตั้งแต่ 0071 ใส่ `supported_fields.promotion_rule_versions: [1]` (0073: `[1, 2]`) เป็นตัวเลข ในทุกคำตอบ (changed และ unchanged)** · POS parse ด้วย `z.record(z.string(), z.array(z.string()))` → **E1 ทั้งคำตอบเป็น BAD_RESPONSE**: แคตตาล็อกไม่อัปเดต · รายชื่อพนักงานไม่อัปเดต (คนที่ถูกลบยังเข้าได้) · ตั้งเครื่องใหม่ไม่ได้ | `0071_promotion_rules.sql:3414` · `0073:1715` · `contracts/src/dayo-api.ts:172` · `apps/pos/src/sync/catalog.ts` | T2 ข้อแรก · security-review |
| F3 | โปรที่แปลงเป็นรูปเดิมไม่ได้ (เมื่อขอ `promo_rule_version ≥ rule.v`) มาแบบ **ไม่มีคีย์ `kind` `params` `daysOfWeek` `timeFrom` `timeTo` `stackable`** · `discriminatedUnion('kind')` + `stackable: z.boolean()` ของ POS จะปฏิเสธทั้งแคตตาล็อก | `0074:188-202` (`dayo_pos_promotions_for`) | T2 |
| F4 | ฟิลด์โปรใหม่: `applyMode` `template` `rule` `timeWindows` `groupCode` `summaryTh` (null ได้) · `usageLimitTotal`/`usageLimitPerDay` (เฉพาะรุ่น ≥ 2) · `catalog.promotionGroups[]` = `{code,name,sortOrder,stackMode,isActive}` ส่งเสมอ | `0074:163-185` · `0071:4163` | T2 |
| F5 | E2 `order` รับ `manual_promotion_ids` (uuid[] ≤ 20) + `manual_promotion_reason` (1–200 · null ได้) **เฉพาะเมื่อ `supported_fields.order` มีสองชื่อนี้** · บิล `totals.total = 0` ที่มีโปรเลือกเองให้ส่วนลดแต่ไม่มีเหตุผล = `rejected INVALID` detail `reason_required:` | `0069:1484-1632` · `docs/API.md:193,308,356` | T3 T5 T8 |
| F6 | ไฟล์ตัวคิดราคาปิดตัวเอง 8 ไฟล์: `money promotions promoRule cost fmt shopSettings types time` (`promoRule.ts` import `money.ts` — วงกลม) | import ของ `packages/shared/src/*.ts` | T1 |
| F7 | **`pricing.files_sha256` ของ E1 ยังนับ 7 ไฟล์ (ไม่มี `promoRule.ts`)** แต่ `pos:parity` นับ 8 ไฟล์ · `samePricing` ของ POS เทียบชุดคีย์ตรงตัว → หลัง vendor แถบเหลือง "ตัวคิดราคาไม่ตรงรุ่น" จะขึ้นตลอด และการเปลี่ยน `promoRule.ts` จะไม่ถูกจับตอนใช้งาน | dayo `scripts/version.ts:16` vs `scripts/export-pos-parity.ts:48` | Q6 · แจ้ง dayo |
| F8 | `pos-parity.json` ของ dayo เพิ่ม `rule_fixtures[]` (ทุกไฟล์ `rules-*.json` รวม `rules-tiers` `rules-usage` · แคตตาล็อกจาก `api_pos_catalog` ที่รุ่นสูงสุด) · `rules-usage` มี `exhaustedPromotions` ในร่าง (แท็บเล็ตไม่ส่ง) | `export-pos-parity.ts:433-496` | T4 |
| F9 | ตรึงรุ่นไม่ตรงกัน 3 ที่: `VENDOR.json` + `pos-parity.seed.json` = `4f35932` · `packages/dayo-pricing/fixtures/pos-parity.json` = `12885fe` · `docs/design/pos-parity.json` (ไม่อยู่ใน git) = `a0f76e2` | grep `dayo_commit` | T1 T4 |
| F10 | `recordSale` ปฏิเสธยอด ≤ 0 (`DISCOUNT_TOO_BIG`, D50 Q3-20) · `payment_amount_positive_ck` > 0 · แต่ ADR-0070 ให้บิล ฿0 จากโปรเลือกเอง + เหตุผลได้ (โปร production "ชงผิด" ลด 100%) | `apps/pos/src/api/sale.ts:127` · `db-schema/src/sqlite/sales.ts:189` | Q1 |

### 0.2 สัญญาที่ล็อกในแผนนี้ (เป็นสเปกให้ทุกสาย · T11 ย้ายลงเอกสารสเปก)

| จุด | กติกาฝั่งแท็บเล็ต |
|---|---|
| E1 คำขอ | `GET /pos/catalog?known_version=<v>&promo_rule_version=<TABLET_PROMO_RULE_VERSION>` · ค่า = `Math.max(...PROMO_RULE_VERSIONS)` ของไฟล์ที่ vendor (Q5 แนะนำ = 2) · ส่งเสมอ (dayo รุ่นก่อน 0071 ไม่อ่านพารามิเตอร์นี้) · ถ้ารุ่นที่เคยใช้ดึงแคตตาล็อกที่เก็บไว้ ≠ รุ่นที่จะขอ → ส่ง `known_version=0` (คำตอบขึ้นกับพารามิเตอร์แต่ `catalog_version` ไม่เปลี่ยน) |
| E1 `supported_fields` | อ่านเป็น `record<string, unknown>` · `fields` = เฉพาะค่าที่เป็น string[] (ใช้กับ `isRowSupported` เหมือนเดิม) · `promoRuleVersions` = `promotion_rule_versions` ที่เป็นจำนวนเต็ม (ไม่มี = `[]` = dayo ก่อน 0071) · ค่ารูปแปลกของคีย์อื่นไม่ทำให้ E1 ล้ม |
| E1 โปร | สองรูป: **legacy** (มี `kind`+`params`+`stackable` · อาจมีฟิลด์กฎด้วย) และ **rule** (ไม่มี `kind` · ต้องมี `template` `rule` `timeWindows` `groupCode`) · ตรวจโครง zod ครบทุกชนิดรางวัลของรุ่น 1–2 แล้วตรวจความหมายด้วย `validatePromoRule`/`validateTimeWindows` ของ vendor · `rule.v` > รุ่นของแท็บเล็ต หรือ `groupCode` ที่ไม่มีใน `promotionGroups` (ยกเว้น `main`) = ปฏิเสธแคตตาล็อก |
| dayo รุ่นเก่า | `promoRuleVersions` ว่าง = แคตตาล็อกรูปเดิม เครื่องคิดใหม่ถอดด้วย `promoFromLegacy` (golden `legacy-*.json` พิสูจน์ว่าเท่าเครื่องเดิม) · ไม่มี `manual_promotion_ids` ใน `supported_fields.order` = ซ่อนโปรเลือกเอง (โปรโหมด `manual` ไม่ถูกใช้ ตรงกับ dayo) · `promoRuleVersions` มีค่าสูงกว่ารุ่นแท็บเล็ต = แถบ "ระบบกลางมีโปรรุ่นใหม่กว่าแอปนี้" |
| E2 `order` | เพิ่ม `manual_promotion_ids` (uuid[] ตัดซ้ำ 1–20) + `manual_promotion_reason` (Text200 หรือ null) **เฉพาะเมื่อตะกร้าเลือกโปรเลือกเอง ≥ 1 ตัว** · `promo_code` ส่งรูป `normPromoCode` · ไม่ส่ง `exhaustedPromotions` |
| E2 คำตัดสิน | `rejected INVALID` + คำนำหน้า `reason_required:` = บั๊กเครื่อง (เครื่องบล็อกก่อนรับเงินแล้ว) → ทางแก้เดิมของ `INVALID` |
| parity | (1) ตัวคิดราคาใน vendor = ไฟล์ของ dayo ที่ commit ตรึง (sha256) · (2) ชุดเคสกลางของ dayo (`legacy-*` `rules-*`) ผ่านเครื่องคิดใน vendor ตรงทุกค่า · (3) ชุดเดียวกันผ่านทางขายของแท็บเล็ต (`priceCart`, สตางค์) ต่าง 0 สตางค์ · (4) `pos-parity.json` ที่ dayo export ที่ commit เดียวกัน (`cases` + `rule_fixtures`) ต่าง 0 สตางค์ · (5) สคริปต์ `vendor:drift` ยืนยันว่า commit ที่ตรึงยังเท่ากับ `main` ของ dayo ตอนตรวจทั้งสาย |

### 0.3 จุดขัดกับ D / ADR และคำถามถึงเจ้าของ (ตอบก่อนเริ่ม — มีคำตอบที่แนะนำ)

- **Q1 — บิล ฿0 จากโปร (ขัด D50 Q3-20 + CHECK `payment_amount_positive_ck`)** · ADR-0070 ของ dayo ให้โปรเลือกเองทำบิลเป็น ฿0 ได้เมื่อมีเหตุผล (ตัวอย่างโปร "ชงผิด" ลด 100%) และโปรอัตโนมัติ/ราคาคงที่ ฿0 ก็ทำบิล ฿0 ได้ · แท็บเล็ตวันนี้ปฏิเสธทุกบิล ≤ ฿0
  - (ก) คง D50: แท็บเล็ตปฏิเสธบิล ฿0 ทุกกรณี ให้ไปบันทึกที่เว็บ/บอท · ช่องเหตุผลโปรเลือกเองแทบไม่เคยขึ้น
  - **(ข) แนะนำ:** บิล ฿0 ได้ **เฉพาะเมื่อยอด 0 มาจากโปร** (ไม่มีส่วนลดกรอกเองในบิล) · ถ้าเครื่องคิดขึ้นธง `manualPromotionReasonRequired` ต้องกรอกเหตุผล 1–200 ตัว · ชำระแบบเงินสด ฿0 เท่านั้น (ไม่มี QR) · ส่วนลดที่พนักงานกรอกเองยังต้องน้อยกว่ายอดตาม D50 · ต้องมี migration ผ่อน CHECK เป็น `>= 0` + trigger ให้ ฿0 ได้เฉพาะบิลยอด 0 (T6) · บันทึกเป็น D ใหม่ที่แก้ D50 บางส่วน
- **Q2 — เหตุผลของโปรเลือกเอง (เทียบ D21 "ส่วนลดต้องใส่เหตุผล" / D48 Q3-6)** · dayo บังคับเหตุผลเฉพาะเมื่อบิลเป็น ฿0 (ชื่อโปรคือเหตุผล — ADR-0070 Q-D)
  - **(ก) แนะนำ:** ตาม dayo — บังคับเฉพาะตอนเครื่องคิดขึ้นธง · D21/D48 ยังใช้กับส่วนลดที่กรอกเอง (โปรถูกตั้งโดย owner/manager บนเว็บแล้ว)
  - (ข) แท็บเล็ตบังคับเหตุผลทุกครั้งที่เลือกโปรเลือกเอง (เข้มกว่า dayo ไม่กระทบยอดเงิน)
- **Q3 — โปรที่จำกัดจำนวนครั้ง (ADR-0072 ข้อ 2)** · แท็บเล็ตขายออฟไลน์นับไม่ได้ → อาจให้ส่วนลดเกินเพดาน dayo รับบิลแล้วติด `amount_mismatch`
  - **(ก) แนะนำ:** ยอมรับตาม ADR-0072 D16 · หน้าขายแสดงป้าย "จำกัด n ครั้ง" (ข้อมูลอ่านอย่างเดียว) · แนะนำเจ้าของไม่ตั้งเพดานกับโปรที่ใช้หน้าร้านบ่อย
  - (ข) แท็บเล็ตไม่ใช้โปรที่มีเพดานเลย (ยอดเครื่องสูงกว่าที่ dayo คิดจนกว่าจะครบ — `amount_mismatch` อีกทิศ)
- **Q4 — ยก D122 (งดสร้างโปรแบบใหม่) เมื่อไร** · **แนะนำ:** หลัง Task 19 (D123) ผ่าน parity จริงกับ `pos-parity.json` ที่มี `rule_fixtures` · บันทึก D ใหม่ · ระหว่างนั้น D122 ยังใช้ · ทางเลือก: ยกทันทีหลังแผนนี้ merge
- **Q5 — ตรึงรุ่น dayo (D121 เขียน `dde5ad4`)** · dayo `main` เดินไป `f4cda56` แล้ว (ADR-0072: ขั้นบันได `rule.v=2` · ไฟล์คิดราคาเปลี่ยนอีกรอบ) · ถ้าตรึง `dde5ad4` = parity เทียบกับโค้ดที่ไม่ใช่ปัจจุบัน และแท็บเล็ตไม่เห็นโปรขั้นบันได
  - **(ก) แนะนำ:** T1 ตรึง commit `main` ของ dayo ณ วันเริ่ม T1 (วันนี้ `f4cda56`) ขอ `promo_rule_version=2` · หัวหน้าบันทึก commit จริงใน ledger · แก้ D121 ด้วย D ใหม่
  - (ข) ตรึง `dde5ad4` ตาม D121 ขอรุ่น 1 แล้วทำแผนต่อสำหรับรุ่น 2
- **Q6 — `files_sha256` ของ E1 ไม่มี `promoRule.ts` (F7 · ฝั่ง dayo)** · เป็นบั๊ก implementation เทียบ ADR-0071 ข้อ 5 และ handoff ข้อ 4 ไม่ใช่เรื่อง ADR ใหม่
  - **(ก) แนะนำ:** เจ้าของส่งเรื่องให้ session dayo แก้ `POS_PRICING_FILES` (เพิ่ม `promoRule.ts`) ก่อน Task 19 · POS คงการเทียบแบบเข้ม (ชุดไฟล์ต้องตรง) · T11 เพิ่มแถวใน `docs/design/08-เรื่องที่ต้องแจ้งฝั่ง-dayo.md`
  - (ข) POS ยอมให้ dayo ไม่รายงาน `promoRule.ts` ชั่วคราว (แถบเทาแทนเหลือง) — ตรวจได้น้อยลง
- **สิ่งที่เจ้าของต้องทำระหว่างแผน:** ⛔ ก่อน T4 จบ รัน `npm run pos:parity -- --expect-commit <commit ที่ T1 ตรึง> --out <นอก repo dayo>` แล้ววางไฟล์ที่ `packages/dayo-pricing/fixtures/pos-parity.json` (D84) · ⛔ ส่งเรื่อง Q6 ให้ dayo · `docs/design/pos-parity.json` (ไม่อยู่ใน git, `a0f76e2`) เป็นสำเนาเก่า — แนะนำย้ายออกจาก repo (แผนนี้ไม่แตะ)
- **ไม่ต้องร่าง ADR ให้ dayo** — ทุกอย่างที่แท็บเล็ตใช้เป็นสัญญาที่ dayo ยอมรับแล้ว (ADR-0070/0071/0072) · มีแค่บั๊ก F7

### 0.4 Ruling ของแผน (แก้ได้ถ้าเจ้าของสั่ง)

| # | เรื่อง | ตัดสิน | เหตุผล · ถ้าผิดเสียอะไร |
|---|---|---|---|
| R1 | ชุดเคสกลางของ dayo | vendor `packages/shared/test/fixtures/promo-rules/*.json` + `load.ts` **ทุกไบต์** ไปที่ `packages/dayo-pricing/golden/test/fixtures/promo-rules/` + shim 2 ไฟล์ `golden/src/{types,promotions}.ts` (re-export จาก `src/vendor`) ให้ import เดิมของ `load.ts` ทำงาน · ตรึงใน `VENDOR.json.fixtures` | ไม่เขียนตัวแปลงเองซ้ำ · ผิด = ถ้า dayo ย้าย `load.ts` ต้องแก้ shim |
| R2 | เก็บส่วนลดแยกแก้ว | ไม่เพิ่มคอลัมน์ · อยู่ใน `order.pricing_json.priced.lines[].promoBreakdown` (แช่แข็ง) + payload `LINE_ADDED` (อยู่ใต้ hash) · โปรเลือกเอง/เหตุผลอยู่ใน `pricing_json.cart` + payload `PAID` | ไม่ต้อง migrate ถ้า Q1 = (ก) |
| R3 | `rules-usage.json` / เคสที่มี `exhaustedPromotions` | ชั้นเครื่องคิด (T1) ส่งรายการเข้า engine ตรง ๆ · ชั้นทางขาย (T4) ส่งผ่านตัวเลือก parity `dayoOnlyExhausted` ที่ทางขายไม่มี (เทสต์กันไว้) | แท็บเล็ตไม่นับ · ยังพิสูจน์ว่าเครื่องคิดเท่ากัน |
| R4 | คำเตือนข้อความไทยของเครื่องคิด | ชั้นเครื่องคิดเทียบ `warnings` ทุกตัวอักษร (ตาม golden) · ชั้นทางขายเทียบเงิน + `manualPromotionReasonRequired` + `ok` | dayo บอกว่า parity เทียบเงิน+ธง |
| R5 | จำนวนโปรเลือกเองต่อบิล | > 20 = `CartError('BAD_MANUAL_PROMOTION')` · ตัดซ้ำก่อนส่ง | dayo DY422 เกิน 20 |
| R6 | แคตตาล็อกที่ fetch ด้วยรุ่นอื่น | sync_state `dayo.catalog_rule_version` = รุ่นที่ใช้ขอแคตตาล็อกที่เก็บอยู่ · ไม่ตรง → `known_version=0` · อัปแอปแล้วรุ่นขยับ = ได้แคตตาล็อกใหม่รอบแรก | ไม่งั้นได้ `changed:false` แล้วค้างรูปเก่า |

### 0.5 ตารางงานขนาน (สูงสุด 4 agent · สายละ 1 worktree)

integration branch `plan-10-promo` แตกจาก `main` · สายแตกจาก `plan-10-promo` · task ที่ผ่านตรวจ merge `--no-ff` เข้า `plan-10-promo`

| สาย | worktree / branch | แตะเฉพาะ | task |
|---|---|---|---|
| A pricing | `../pos-p10-pricing` / `p10-pricing` | `packages/dayo-pricing`, `packages/domain` | T1 → T3 → T4 |
| B contract | `../pos-p10-contract` / `p10-contract` | `packages/contracts`, `packages/dayo-mock`, `apps/pos/test/helpers/dayo.ts` | T2 → T5 |
| C device | `../pos-p10-device` / `p10-device` | `packages/db-schema`, `apps/pos/src/{db,api,sync}`, `apps/pos/test` (ยกเว้น helpers/dayo.ts) | T6 → T7 → T8 |
| D screens | `../pos-p10-screens` / `p10-screens` | `apps/pos/src/{screens,ui,state,app}`, `apps/pos/e2e` · T0 แตะ `apps/pos/src/api/errors.ts` ครั้งเดียว | T0 → T9 → T10 |
| ท้าย | `plan-10-promo` | `docs/**` แล้วทุกที่ | T11 ∥ ท้าย → T12 |

| รอบ | A | B | C | D | พร้อมกัน |
|---|---|---|---|---|---|
| 1 | T1 | T2 | T6 (ถ้า Q1=ข) | T0 | 4 |
| 2 | T3 (รอ T1, T2) | T5 (รอ T1, T2) | T7 (รอ T2) | — | 3 |
| 3 | T4 (รอ T3 + ไฟล์ export ของเจ้าของ) | — | T8 (รอ T3, T6, T7) | — | 2 (+T11 docs-writer) |
| 4 | — | — | — | T9 (รอ T0, T3, T8) | 1 |
| 5 | — | — | — | T10 (รอ T5, T9) | 1 |
| 6 | T12 ตรวจทั้งสาย → merge `main` → push | | | | หัวหน้า + 2 ผู้ตรวจ |

**ไฟล์เจ้าของเดียว:** `apps/pos/src/api/errors.ts` = T0 เพิ่มรหัสครบทั้งแผน แล้วเป็นของสาย C · `ui/{errors,th}.ts` = สาย D · `packages/dayo-pricing/VENDOR.json` = T1 เท่านั้น · `pnpm-lock.yaml` ชนตอน merge = รับฝั่งหนึ่งแล้ว `pnpm install`

### 0.6 ผู้ทำ โมเดล ผู้ตรวจ

| Task | ผู้ทำ (โมเดล) | ผู้ตรวจ |
|---|---|---|
| T0 รหัส error + ข้อความไทย | pos-ui-developer (sonnet) | code-reviewer |
| T1 vendor + golden | domain-engineer (opus) | code-reviewer + **security-reviewer** (ความครบของ pin/sha) |
| T2 สัญญา E1/E2/parity | domain-engineer (opus) | code-reviewer + **security-reviewer** (F2: รายชื่อพนักงาน) |
| T3 domain | domain-engineer (opus) | code-reviewer + **security-reviewer** (เงิน) |
| T4 parity | domain-engineer (opus) | code-reviewer + **security-reviewer** (เงิน) |
| T5 mock | sync-engineer (opus) | code-reviewer |
| T6 migration ฿0 | sync-engineer (opus) | code-reviewer + **security-reviewer** (CHECK/trigger เงิน) |
| T7 ดึง E1 | sync-engineer (opus) | code-reviewer + **security-reviewer** (staff/ปฏิเสธแคตตาล็อก) |
| T8 บันทึกขาย/ส่งบิล | sync-engineer (opus) | code-reviewer + **security-reviewer** (เงินซ้ำ · บิล ฿0 · เหตุผล) |
| T9 หน้าขาย | pos-ui-developer (sonnet) | code-reviewer |
| T10 e2e | pos-ui-developer (sonnet) | code-reviewer |
| T11 เอกสาร | docs-writer (sonnet) | หัวหน้า |
| T12 ตรวจทั้งสาย | หัวหน้า (opus) | code-reviewer (sonnet) + security-reviewer (opus) ทั้ง diff `main..plan-10-promo` |

ทุก task: implementer → test-runner (haiku) → ผู้ตรวจ → แก้ ≤ 3 รอบกับ agent เดิม (รอบ 4–5 โมเดลสูงขึ้น 1 ขั้น) → `Task N: complete` ใน `.superpowers/sdd/2026-09-30-10-promo-engine-parity/progress.md` (ไม่ commit)

---

## 1. File Structure

**สร้างใหม่**

| ไฟล์ | หน้าที่ |
|---|---|
| `packages/dayo-pricing/src/vendor/promoRule.ts` | (vendor) |
| `packages/dayo-pricing/golden/test/fixtures/promo-rules/{catalog,legacy-*,rules-*,functions}.json` + `load.ts` | (vendor · R1) |
| `packages/dayo-pricing/golden/src/{types,promotions}.ts` | shim re-export (R1) |
| `packages/dayo-pricing/scripts/vendor-drift.ts` | เทียบ pin กับ ref ของ dayo (ค่าเริ่มต้น `main`) |
| `packages/dayo-pricing/test/golden.test.ts` | ชุดเคสกลางผ่านเครื่องคิดใน vendor |
| `packages/domain/src/promo-catalog.ts` | `checkCatalogRules` · `TABLET_PROMO_RULE_VERSION` · `selectableManualPromotions` · `promoModeOf` |
| `packages/domain/test/{promo-catalog,price-cart-manual,golden-sale-path}.test.ts` | เทสต์ |
| `packages/contracts/fixtures/dayo-api/{e1-catalog-changed-promo-rules,e1-catalog-unchanged-promo-rules,e1-catalog-changed-old-dayo,e2-order-manual-promo-accepted,e2-order-manual-reason-required}.json` | fixture สัญญา (POS เป็นเจ้าของ — D84) |
| `packages/contracts/test/dayo-api-promo-rules.test.ts` | เทสต์ schema |
| `packages/dayo-mock/src/promo-rules.ts` + `test/promo-rules.test.ts` | E1 ตามรุ่น · กติกา `reason_required:` |
| `packages/db-schema/drizzle/sqlite/0007_zero_total_promo_bill.sql` (+ meta) · `test/zero-bill.test.ts` | **เฉพาะ Q1 = (ข)** |
| `apps/pos/test/{catalog-promo-rules,sale-manual-promo}.test.ts` | เทสต์แอป |
| `apps/pos/src/screens/ManualPromoPicker.tsx` (+ `.test.tsx`) | ชิปโปรเลือกเอง + ช่องเหตุผล |
| `apps/pos/e2e/p10-promo-rules.spec.ts` | e2e |

**แก้:** `packages/dayo-pricing/{VENDOR.json,package.json,scripts/vendor-lib.ts,scripts/vendor.ts,src/index.ts,test/vendor.test.ts,fixtures/pos-parity*.json}` · `packages/contracts/src/{dayo-api,index}.ts` · `packages/domain/src/{price-cart,priced-from-quote,order-draft,order-row,parity-support,index}.ts` + `test/parity.test.ts` + `scripts/gen-parity-seed.ts` · `packages/dayo-mock/src/{state,handler,judge,reprice,control}.ts` · `apps/pos/src/sync/{dayo-client,catalog,state}.ts` · `apps/pos/src/api/{connect,sale,void,bootstrap,orders,types,errors}.ts` · `apps/pos/src/{state/cart.ts,app/use-priced-cart.ts,screens/{PromoPanel,CartPanel,CashPayScreen,QrPayScreen,OrderDetailScreen,StatusBanners}.tsx,ui/{th,errors}.ts}` · `apps/pos/test/helpers/dayo.ts`

---

## 2. Tasks

### T0: รหัส error และข้อความไทย (สาย D · pos-ui-developer sonnet)

**Files:** `apps/pos/src/api/errors.ts`, `apps/pos/src/ui/{errors,th}.ts` + เทสต์ที่มีอยู่
**Produces:** รหัส `MANUAL_REASON_REQUIRED` · `MANUAL_PROMO_UNSUPPORTED` · `ZERO_TOTAL_NOT_ALLOWED` (ใช้เมื่อ Q1=ก หรือ ฿0 จากส่วนลดกรอกเอง — ข้อความต่างจาก `DISCOUNT_TOO_BIG`) · ข้อความ `TH.manualPromos` `TH.manualReason` `TH.manualReasonHint` `TH.promoModeAuto/Code/Manual` `TH.promoLimitInfo(n, perDay)` `TH.promoRuleBehind` `TH.promoWarnings` `TH.zeroBillCashOnly`

- [ ] เพิ่มรหัสใน union ของ `PosErrorCode` และข้อความไทยใน `ui/errors.ts` (ทุกรหัสมีข้อความ — เทสต์เดิมบังคับ)
- [ ] เพิ่มคีย์ `th.ts` ตามรายการ · `pnpm --filter @dayo/pos test` ผ่าน · commit

**เสร็จเมื่อ:** typecheck/test เขียว · ไม่มีรหัสไหนไม่มีข้อความ

### T1: vendor ตัวคิดราคา 8 ไฟล์ + ชุดเคสกลาง + ตรึงรุ่นเดียว (สาย A · domain-engineer opus)

**Files:** `packages/dayo-pricing/**` (ตาม §1) · regenerate `fixtures/pos-parity.seed.json` ด้วย `pnpm --filter @dayo/domain parity:seed` เฉพาะถ้า typecheck ของ domain ยังผ่าน (ไม่ผ่าน = ทำใน T3 และบันทึก Ruling)
**Produces:**
```ts
// scripts/vendor-lib.ts
export const VENDORED: readonly string[]            // 8 ไฟล์: money promotions promoRule cost fmt shopSettings types time
export const GOLDEN_DIR = 'packages/shared/test/fixtures/promo-rules'  // ทุก *.json + load.ts ที่ commit
export type VendorJson = { repo: 'dayo-shop-system'; commit: string; files: Record<string, string>; fixtures: Record<string, string> }
export function checkVendor(): string[]             // เช็กทั้ง files และ fixtures
export function driftAgainst(dayoRepo: string, ref?: string): string[]  // ไฟล์ที่ sha ต่างจาก pin ที่ ref (ค่าเริ่มต้น 'main')
// src/index.ts เพิ่ม export
export { normPromoCode, promoApplyMode, selectablePromotions } from './vendor/promotions'
export { PROMO_RULE_VERSIONS, validatePromoRule, validateTimeWindows, promoToLegacy, promoRuleMinVersion } from './vendor/promoRule'
export type { ApplyMode, PromoRule, PromoTemplate, PromotionGroup, TimeWindow, SelectablePromotion, OptionAdds, PromoBreakdownEntry, ExhaustedPromotion, PromoTierHit } from './vendor/types'
```
- [ ] **Step 0:** อ่าน `git -C <dayo> rev-parse main` · ใช้ commit ตามคำตอบ Q5 · บันทึกลง ledger
- [ ] **Step 1 (เทสต์ก่อน):** `vendor.test.ts` คาดชุดไฟล์ 8 ไฟล์ + `VENDOR.json.fixtures` ไม่ว่าง + `load.ts` อยู่ใน pin → FAIL
- [ ] **Step 2:** แก้ `vendor-lib.ts` (รายชื่อ 8 ไฟล์ · คัดลอก golden ด้วย `git ls-tree`+`git show` ของ commit เดียวกัน · `fixtures` ใน VENDOR.json) · เพิ่มคำสั่ง `vendor:drift` ใน `package.json`/`vendor.ts`
- [ ] **Step 3:** `pnpm --filter @dayo/dayo-pricing vendor:update D:\TungAo-Project\line-bot\dayo-shop-system <commit>` → เขียน vendor + golden + VENDOR.json · สร้าง shim `golden/src/{types,promotions}.ts` (`export type * from '../../src/vendor/types'` ฯลฯ)
- [ ] **Step 4:** `golden.test.ts` — ทุกไฟล์ `legacy-*`/`rules-*`: ประกอบแคตตาล็อกด้วย `load.ts` ที่ vendor (`catalogFromPayload` + `legacyPromotion`/`rulePromotion` + `promotionGroups` จาก `groups`) → `computeOrder` ของ vendor → `toExpected(q, form==='rule')` ต้อง `toEqual` `expected` ทั้งก้อน (เงิน · บรรทัด · `optionAdds` · `promoBreakdown` · `promotionsApplied[].tier` · `warnings` · ธง) · เคสที่ไม่มี `expected` = ข้าม **พร้อมนับจำนวนและ assert จำนวน** (ไม่ข้ามเงียบ)
- [ ] **Step 5:** เทสต์ "ปิดตัวเอง" เดิมยังผ่านกับวงกลม `promoRule`↔`money` · `vendor:check` ผ่าน
- [ ] **Step 6:** `pnpm --filter @dayo/dayo-pricing test` (domain อาจแดงชั่วคราว → T3 · บันทึก Ruling ว่า T1 merge เข้า `plan-10-promo` พร้อม T3 เท่านั้น) · commit

**เสร็จเมื่อ:** `vendor:check` = ว่าง · `vendor:drift <dayo> main` = ว่าง ณ วันทำ · golden ทุกเคสผ่านเครื่องคิดใน vendor · `VENDOR.json.commit` = commit ที่ตัดสินใน Q5

### T2: สัญญา E1/E2/parity รูปใหม่ (สาย B · domain-engineer opus)

**Files:** `packages/contracts/src/{dayo-api,index}.ts`, fixtures ตาม §1, `test/dayo-api-promo-rules.test.ts` (+ แก้เทสต์เดิมที่ตรึง `supported_fields`)
**Produces:**
```ts
export const SupportedFieldsRaw = z.record(z.string(), z.unknown())            // แทน record<string,string[]> ใน e1Common
export type Supported = { kinds: readonly string[]; fields: Readonly<Record<string, readonly string[]>>; promoRuleVersions: readonly number[] }
export function supportedOf(kinds: string[], raw: Record<string, unknown>): Supported   // fields = เฉพาะ string[] · promoRuleVersions = จำนวนเต็ม ≥ 0
export const PromoRuleSchema, TimeWindowSchema, PromotionGroupSchema             // โครงครบทุกรางวัลรุ่น 1–2 (types.ts:199-282) · looseObject ไม่ได้ — คีย์แปลกให้ validatePromoRule ตัดสิน
export const Promotion = z.union([RulePromotion /* ไม่มี kind */, LegacyPromotion /* discriminatedUnion kind */])
// PosOrderCatalog += promotionGroups: z.array(PromotionGroupSchema).exactOptional()
// OrderRowData += manual_promotion_ids: z.array(Uuid).min(1).max(20).exactOptional(), manual_promotion_reason: Text200.nullable().exactOptional()
//   + refine: reason มีได้เมื่อมี ids · ids ไม่ซ้ำ
// DETAIL_PREFIXES += 'reason_required:'
// ParityDraft += manualPromotionIds, manualPromotionReason, exhaustedPromotions · ParityMoney += manualPromotionReasonRequired, lines[].promoBreakdown/optionAdds (optional)
// ParityFile += rule_fixtures: z.array(ParityRuleFixture).exactOptional()   // {fixture, description, catalog_version, catalog, cases:[{name, draft, expected}]}
```
- [ ] **Step 1 (regression ก่อน):** เทสต์ parse `PosCatalogLooseResponse` ของคำตอบที่มี `supported_fields.promotion_rule_versions: [1, 2]` ทั้ง changed/unchanged → FAIL วันนี้ (F2)
- [ ] **Step 2:** แก้ `e1Common` + `supportedOf` · แก้ผู้เรียก `Supported` ใน contracts (`isRowSupported` ใช้ `fields` เท่าเดิม)
- [ ] **Step 3 (เทสต์):** โปร rule-only ไม่มี `kind`/`stackable` ผ่าน · legacy+rule ผ่าน · `rule.reward.type` ไม่รู้จัก = ไม่ผ่าน · `timeWindows` `from`/`to` null ผ่าน · `summaryTh: null` ผ่าน · `usageLimitTotal` ผ่าน · `promotionGroups` ผ่าน · แคตตาล็อกเดิม (`e1-catalog-changed.json`, `-block3`) ยังผ่าน
- [ ] **Step 4:** เขียน schema โปรสองรูป · type test: `z.infer<typeof PosOrderCatalog>` assign เข้า `OrderCatalog` ของ vendor ได้โดยไม่ cast (ทำใน T3 ฝั่ง domain · ที่นี่เตรียม type ให้ตรง `types.ts`)
- [ ] **Step 5:** E2 `OrderRowData` + fixture `e2-order-manual-*` · เทสต์: แถวไม่มีโปรเลือกเองไม่มีคีย์ใหม่ · 21 ids = ไม่ผ่าน · reason 201 ตัว = ไม่ผ่าน · reason ไม่มี ids = ไม่ผ่าน
- [ ] **Step 6:** fixture E1 3 ไฟล์ (รุ่นใหม่ changed/unchanged · dayo เก่าไม่มี `promotion_rule_versions` และ `supported_fields.order` ไม่มีฟิลด์โปรเลือกเอง) — ค่าอ้างจาก `0074:163-202` + `docs/API.md:97` · ParityFile รับ `rule_fixtures` · commit

**เสร็จเมื่อ:** E1 ของ dayo ≥ 0071 parse ผ่านทุกรูปใน §0.2 · ไม่มีเทสต์เดิมแดง · security-reviewer ยืนยันว่ารายชื่อพนักงานถูกใช้จากทุกคำตอบของ dayo รุ่นใหม่

### T3: domain — ทางขายส่งโปรเลือกเองเข้าเครื่องคิด (สาย A · domain-engineer opus · รอ T1, T2)

**Files:** `packages/domain/src/{price-cart,priced-from-quote,order-draft,order-row,parity-support,promo-catalog,index}.ts` + เทสต์
**Produces:**
```ts
export type CartDraft = { /* เดิม */ manualPromotionIds: string[]; manualPromotionReason: string | null }
export type PricedLine = { /* เดิม */ promoBreakdown: { promotionId: string; satang: number }[] | null }
export type PricedPromotion = { promotionId: string; code: string | null; name: string; kind: PromoTemplate; mode: ApplyMode; discountSatang: number }
export type PricedCart = { /* เดิม */ manualPromotionReasonRequired: boolean }
export type CartErrorCode = /* เดิม */ | 'BAD_MANUAL_PROMOTION'
export const TABLET_PROMO_RULE_VERSION: number                       // Math.max(...PROMO_RULE_VERSIONS)
export function checkCatalogRules(c: PosOrderCatalog): string[]      // validatePromoRule + validateTimeWindows + rule.v ≤ รุ่นแท็บเล็ต + groupCode มีจริง
export function selectableManualPromotions(cart: CartDraft, c: PosOrderCatalog, soldAtIso: string): { promotionId: string; code: string | null; name: string; usageLimitTotal: number | null; usageLimitPerDay: number | null }[]
export function zeroTotalVerdict(cart: CartDraft, priced: PricedCart): 'ok' | 'MANUAL_REASON_REQUIRED' | 'ZERO_TOTAL_NOT_ALLOWED'  // ตามคำตอบ Q1
```
- [ ] **Step 1 (เทสต์ก่อน):** `price-cart-manual.test.ts` — โปรเลือกเองถูกใช้เมื่อเลือกเท่านั้น · id ซ้ำถูกตัด · 21 ตัว = `BAD_MANUAL_PROMOTION` · `noPromotions` ชนะการเลือก · `promoCode` ส่งผ่าน `normPromoCode` · `toOrderDraft` ไม่มี `exhaustedPromotions` · บิลโปรเลือกเองลด 100% ไม่มีเหตุผล → `ok=false` + ธง · มีเหตุผล → `ok=true`
- [ ] **Step 2:** แก้ `CartDraft`/`checkCart`/`toOrderDraft` · `pricedFromQuote` แปลง `promoBreakdown` (บาท→สตางค์) และ `manualPromotionReasonRequired` · `mode` จาก `promoApplyMode` ของโปรในแคตตาล็อก · ตรวจเดิม `subtotal − discounts = total` คงไว้
- [ ] **Step 3:** `promo-catalog.ts` + เทสต์ (กฎผิด/รุ่นเกิน/กลุ่มหาย = ปัญหา · แคตตาล็อก fixture T2 = ว่าง) · type test ไม่ cast ของ `toPricingCatalog`
- [ ] **Step 4:** `buildOrderRowData` ใส่ `manual_promotion_ids`/`manual_promotion_reason` เฉพาะเมื่อ ids ไม่ว่าง · `orderRowToCart` กลับด้าน · `cartFromOrderDraft` แมป `manualPromotionIds`/`manualPromotionReason` · `priceParityCase` เพิ่มตัวเลือก `dayoOnlyExhausted` (R3) · เทสต์ "ทางขายไม่ import parity-support" เดิมยังผ่าน
- [ ] **Step 5:** `zeroTotalVerdict` ตามคำตอบ Q1 (ข: ฿0 ได้เมื่อไม่มีส่วนลดกรอกเองในบิลและรายการ · ธงบังคับ + ไม่มีเหตุผล = `MANUAL_REASON_REQUIRED`) + เทสต์ property (fast-check): ยอดไม่ติดลบ · `discount ≤ subtotal`
- [ ] **Step 6:** regenerate seed ถ้า T1 ยังไม่ได้ทำ · `pnpm turbo run typecheck test` · commit

**เสร็จเมื่อ:** domain เขียว · ไม่มี float บาทหลุดออกจาก `pricedFromQuote`/`order-row.ts` (เทสต์ money-edge-guard เดิมผ่าน)

### T4: parity ครบทุกความสามารถ + ตรึงรุ่นเดียว (สาย A · domain-engineer opus · รอ T3 + ไฟล์ export ของเจ้าของ)

**Files:** `packages/domain/test/{parity,golden-sale-path}.test.ts`, `packages/domain/scripts/gen-parity-seed.ts`, `packages/dayo-pricing/fixtures/pos-parity{,.seed}.json`
- [ ] **Step 1:** `golden-sale-path.test.ts` — ทุกเคสกลางของ dayo (vendor T1) ผ่าน `priceParityCase` (ทางขาย สตางค์): เงินทุกช่อง + บรรทัด (`unitPrice` `discountPerCup` `lineTotal` · `promoBreakdown` แปลงสตางค์) + `promotionsApplied` + `ok` + ธง = expected (บาท→`edgeBahtToSatang`) · เคส `rules-usage` ใช้ `dayoOnlyExhausted` · เคสที่แท็บเล็ตปฏิเสธโดยตั้งใจอยู่ในรายการ `TABLET_REFUSES` พร้อมเหตุผล (หัวหน้าอนุมัติ) · นับเคสต่อไฟล์และ assert จำนวน
- [ ] **Step 2:** `parity.test.ts` — อ่าน `rule_fixtures` ของไฟล์ export: แคตตาล็อกของแต่ละชุดผ่าน `PosOrderCatalog` + `checkCatalogRules` = ว่าง · ทุกเคสต่าง 0 สตางค์แบบเดียวกับ `cases` · ปรับ `expectedCases` ตามไฟล์จริง
- [ ] **Step 3 (ตรึงรุ่น):** เทสต์ใหม่ "pin เดียว": `VENDOR.commit === seed.dayo_commit === REAL.dayo_commit` และ `REAL.pricing_files_sha256` = `VENDOR.files` (8 คีย์) · ข้อความล้มบอกว่าต้องให้เจ้าของ export ใหม่ที่ commit ไหน
- [ ] **Step 4:** ⛔ รอไฟล์จากเจ้าของ (§0.3) → วาง `packages/dayo-pricing/fixtures/pos-parity.json` · `.gitattributes` คง `-text` · regenerate seed ด้วย commit ใหม่ (ถ้าเคสของ seed ใช้ความสามารถใหม่ไม่ได้ ไม่ต้องเพิ่ม — golden คือชั้นหลัก)
- [ ] **Step 5:** `pnpm --filter @dayo/domain test -- parity golden` → ทุกเคสต่าง 0 สตางค์ · commit

**เสร็จเมื่อ:** ไม่มี pin สองค่าใน `packages/dayo-pricing` · ทุกเคสของ golden และ export ผ่านทั้งชั้นเครื่องคิดและชั้นทางขาย · รายงานจำนวนเคสต่อไฟล์ใน ledger

### T5: mock เล่นบท dayo รุ่นใหม่/รุ่นเก่า (สาย B · sync-engineer opus · รอ T1, T2)

**Files:** `packages/dayo-mock/src/{promo-rules,state,handler,judge,reprice,control}.ts` + `test/promo-rules.test.ts`, `apps/pos/test/helpers/dayo.ts`
**Produces:** `MockOptions.promoRules?: { versions: number[] | null; manualFields: boolean }` (ค่าเริ่มต้น = ปิด → เทสต์ก้อน 2/3 เหมือนเดิม) · `promotionsFor(promos, version)` = `dayo_pos_promotions_for` (แปลงได้/ไม่ได้ ด้วย `promoToLegacy` ของ vendor · ตัด `usageLimit*` เมื่อรุ่น < 2) · `mock.setPromotions(full[])` · ตัวเลือก helper `promoRules` ใน `apps/pos/test/helpers/dayo.ts`
- [ ] **Step 1 (เทสต์ก่อน):** E1 รุ่น 0/1/2 ได้โปรตามตาราง handoff ข้อ 1 · `promo_rule_version=abc` หรือ > 9999 = 422 · `promotionGroups` มาทุกคำตอบ changed · `supported_fields.promotion_rule_versions` ตาม `versions` (null = ไม่มีคีย์)
- [ ] **Step 2:** judge: `manual_promotion_*` เมื่อ `manualFields=false` → `deferred UNSUPPORTED` (กติกาเดิมของฟิลด์ที่ไม่รู้จัก) · `total=0` + โปรเลือกเองที่เครื่องคิดของ vendor บอกว่าให้ส่วนลด + ไม่มีเหตุผล → `rejected INVALID` detail `reason_required: …` · `reprice.ts` ส่ง `manualPromotionIds` เข้าร่าง
- [ ] **Step 3:** เทสต์ก้อน 2/3 ของ mock และแอปยังเขียว · commit

**เสร็จเมื่อ:** mock ตอบรูปเดียวกับ fixture T2 ทุกกรณี · expected ของเทสต์มาจาก fixture/คิดมือ ไม่ใช่ผลของ mock เอง

### T6: migration ฿0 (สาย C · sync-engineer opus · **ทำเฉพาะ Q1 = (ข)**)

**Files:** `packages/db-schema/{src/sqlite/sales.ts,drizzle/sqlite/0007_zero_total_promo_bill.sql,drizzle/sqlite/meta/*,src/browser/sqlite-migrations.gen.ts,test/zero-bill.test.ts}`
- [ ] **Step 1 (เทสต์ก่อน):** payment 0 ของบิลยอด 0 = ผ่าน · payment 0 ของบิลยอด > 0 = ล้ม · payment ติดลบ = ล้ม · ข้อมูลเดิมย้ายครบ · trigger append-only/`sent` ล็อก (D120) ยังทำงาน
- [ ] **Step 2:** สร้างตาราง `payment` ใหม่ด้วย CHECK `amount_satang >= 0` (SQLite ต้อง rebuild) + trigger `payment_zero_only_zero_bill` (BEFORE INSERT/UPDATE: `amount_satang = 0` ต้องมี `order.total_satang = 0`) · regenerate `sqlite-migrations.gen.ts` · เทสต์ migrate จากฐานของแผน 09
- [ ] **Step 3:** `pnpm --filter @dayo/db-schema test` · commit

**เสร็จเมื่อ:** ฐานเดิมอัปเกรดได้ไม่เสียแถว · ไม่มีทาง insert payment ฿0 ให้บิลที่ยอด > 0

### T7: ดึง E1 ด้วย `promo_rule_version` (สาย C · sync-engineer opus · รอ T2 · ใช้ `TABLET_PROMO_RULE_VERSION`/`checkCatalogRules` จาก T3 — ถ้า T3 ยังไม่ merge ให้ stub ค่าคงที่แล้วต่อสายหลัง T3)

**Files:** `apps/pos/src/sync/{dayo-client,catalog,state}.ts`, `apps/pos/src/api/{connect,bootstrap}.ts`, `apps/pos/test/catalog-promo-rules.test.ts`
**Produces:** `getCatalog(known: number, promoRuleVersion: number)` · `DAYO_KEYS.catalogRuleVersion` · `readSupported(): Supported` (มี `promoRuleVersions`) · `BootstrapState.promo = { manualSupported: boolean; ruleBehind: boolean; ruleVersions: number[] }`
- [ ] **Step 1 (เทสต์ก่อน, mock T5 ถ้ามี ไม่งั้น fixture T2):** คำตอบที่มี `promotion_rule_versions` อัปเดตแคตตาล็อก **และ** พนักงาน (F2) · URL มี `promo_rule_version` · เก็บแคตตาล็อกรุ่น 1 แล้วแอปขยับเป็น 2 → ส่ง `known_version=0` · กฎผิด → `CATALOG_UNREADABLE` เก็บของเดิม แต่พนักงานยังอัปเดต (R12) · dayo เก่า → แคตตาล็อกรูปเดิม ใช้ได้ · `ruleBehind` เมื่อ dayo มีรุ่นสูงกว่า
- [ ] **Step 2:** แก้ `dayo-client.getCatalog` · `pullCatalog` (R6) · `writeCatalogAnswer` ใช้ `supportedOf` + `checkCatalogRules` + เขียน `catalogRuleVersion` เฉพาะตอนแคตตาล็อกถูกรับ · `connect.ts` ส่งพารามิเตอร์เดียวกัน · `samePricing` คงแบบเข้ม (Q6)
- [ ] **Step 3:** `pnpm --filter @dayo/pos test` · commit

**เสร็จเมื่อ:** E1 ของ dayo ทุกรุ่น (ก่อน 0071, 0071, 0073+) ไม่ทำให้พนักงาน/แคตตาล็อกค้าง · security-reviewer ผ่าน

### T8: บันทึกขายและส่งบิลที่มีโปรเลือกเอง (สาย C · sync-engineer opus · รอ T3, T6, T7)

**Files:** `apps/pos/src/api/{sale,void,orders,types,bootstrap}.ts`, `apps/pos/test/sale-manual-promo.test.ts` (+ เทสต์ sale/void เดิม)
**Produces:** `RecordSaleInput.cart` มี `manualPromotionIds`/`manualPromotionReason` · `OrderDetailDto.lines[].promoBreakdown` (สตางค์ + ชื่อโปร) · `OrderDetailDto.manualPromotionReason`
- [ ] **Step 1 (เทสต์ก่อน):** โปรเลือกเองส่งถึงแถว outbox · แถวไม่มีโปรเลือกเอง = ไบต์เดิม · เลือกโปรเลือกเองขณะ `manualSupported=false` = `MANUAL_PROMO_UNSUPPORTED` ไม่เขียนอะไร · ธงบังคับ + ไม่มีเหตุผล = `MANUAL_REASON_REQUIRED` ไม่เขียนอะไร · ส่งซ้ำด้วยตะกร้าต่างโปรเลือกเอง ไม่ถือว่าเป็นบิลเดิม (`cartKey` รวม ids+เหตุผล) · `PRICE_CHANGED` ยังทำงานเมื่อโปรเลือกเองหมดช่วงเวลาระหว่างชำระ
- [ ] **Step 2:** `recordSale`: normalize/ตรวจเหตุผล (`checkReason`) · ใช้ `zeroTotalVerdict` แทน `totalSatang <= 0` · Q1=(ข): บิล ฿0 ต้อง `method='CASH'` `tendered=0` `change=0` payment 0 · events `LINE_ADDED.promoBreakdown` และ `PAID.manualPromotionIds/manualPromotionReason` (R2)
- [ ] **Step 3:** `cancelSale`/void บิล ฿0 ไม่สร้าง `VOID_REFUND` (CHECK > 0) · Z/X ไม่เปลี่ยนสูตร (เทสต์ Z เดิมผ่าน + เคสบิล ฿0 นับเป็น 1 บิล ยอด 0)
- [ ] **Step 4:** `orders.ts` DTO ส่วนลดแยกแก้วจาก `pricing_json` · sync-problems: `reason_required:` ใช้ทางแก้ `INVALID` เดิม · commit

**เสร็จเมื่อ:** ทุกเทสต์แอปเขียว · security-reviewer ยืนยันไม่มีทางบันทึกบิล ฿0 จากส่วนลดกรอกเอง และไม่มีบิลที่ยอดในเครื่องต่างจาก `priceCart`

### T9: หน้าขาย — โปรเลือกเอง · เหตุผล · วิธีใช้ · ส่วนลดแยกแก้ว (สาย D · pos-ui-developer sonnet · รอ T0, T3, T8)

**Files:** `apps/pos/src/state/cart.ts`, `app/use-priced-cart.ts`, `screens/{PromoPanel,ManualPromoPicker,CartPanel,CashPayScreen,QrPayScreen,OrderDetailScreen,StatusBanners}.tsx` + เทสต์
- [ ] **Step 1 (เทสต์ก่อน):** reducer `toggleManualPromotion`/`setManualReason` (ล้างเมื่อเริ่มบิลใหม่ · ล้างเหตุผลเมื่อธงหาย) · `toCartDraft` ส่งสองฟิลด์
- [ ] **Step 2:** `ManualPromoPicker` — ชิปจาก `selectableManualPromotions` (ซ่อนทั้งส่วนเมื่อ `manualSupported=false`) · ป้าย "จำกัด n ครั้ง" จาก `usageLimit*` (Q3) · โหมด `code` ไม่แสดงเป็นชิป
- [ ] **Step 3:** `PromoPanel` — แต่ละโปรที่ใช้แสดงชื่อ ยอด และป้ายวิธีใช้ (อัตโนมัติ/ใส่โค้ด/เลือกเอง) · ปุ่ม "ไม่ใช้" เดิม · ช่องโค้ดแสดงรูป `normPromoCode` · รายการคำเตือน "ไม่ใช้โปร …" จาก `priced.warnings`
- [ ] **Step 4:** ช่องเหตุผลบังคับเมื่อ `priced.manualPromotionReasonRequired` · ปุ่มชำระกดไม่ได้จนกรอก 1–200 ตัว · Q1=(ข): ยอด ฿0 ไปหน้าเงินสดแบบยืนยันเลย ไม่มี QR
- [ ] **Step 5:** `CartPanel` ใต้บรรทัด: "ลด ฿x/แก้ว" + รายการโปรเมื่อ `promoBreakdown` มี ≥ 2 · แก้ตรรกะจับคู่บรรทัดที่ถูกแตก (เดิมดู `lineTotalSatang === 0`) ให้รองรับบรรทัดที่แตกตามโปรต่างกัน · `OrderDetailScreen` แสดงเหตุผลเลือกโปร + ส่วนลดแยกแก้ว · `StatusBanners` แถบ `ruleBehind`
- [ ] **Step 6:** `pnpm --filter @dayo/pos test` · commit

**เสร็จเมื่อ:** หน้าจอไม่คิดเงินเอง (ทุกตัวเลขมาจาก `PricedCart`/DTO) · เทสต์หน้าจอเขียว

### T10: e2e กับ mock (สาย D · pos-ui-developer sonnet · รอ T5, T9)

**Files:** `apps/pos/e2e/p10-promo-rules.spec.ts` (+ `e2e/helpers.ts` ถ้าต้อง)
- [ ] เคส (ยอดที่คาด = ค่าจาก golden ของ dayo หรือคิดมือ ไม่ใช่ผลของ mock): (1) โปรตามหมวด/ขนาดใช้อัตโนมัติ ยอดตรง · (2) กดโปรเลือกเอง → ยอดลด → แถวที่ mock ได้มี `manual_promotion_ids` · (3) โปรเลือกเองลด 100% → ขอเหตุผล → Q1=(ข) บันทึกได้ / Q1=(ก) ข้อความ `ZERO_TOTAL_NOT_ALLOWED` · (4) กลุ่ม `stack` แสดงส่วนลดแยกแก้วสองโปร · (5) dayo รุ่นเก่า (ไม่มีรุ่นกฎ ไม่มีฟิลด์โปรเลือกเอง) → ไม่มีชิป ขายได้ · (6) dayo รุ่นใหม่กว่าแอป → แถบเตือน
- [ ] `pnpm --filter @dayo/pos e2e` ผ่านทั้งชุด (รวม spec เดิม) · commit

### T11: เอกสาร (docs-writer sonnet · ขนานรอบ 3–5)

**Files:** `docs/design/00-บันทึกการตัดสินใจ.md` (D ใหม่จากคำตอบ Q1–Q6 + R1–R6 ที่หัวหน้ายืนยัน · D ที่แก้ D121/D50 ระบุว่าแก้ข้อไหน) · `docs/design/04-สเปกการเชื่อม-POS-กับ-dayo.md` ภาคผนวกใหม่ "โปรกฎใหม่" ตาม §0.2 (ไม่เขียนทับข้อเดิม) · `docs/design/08-เรื่องที่ต้องแจ้งฝั่ง-dayo.md` (F7) · `docs/design/10-ผลกระทบ…md` เพิ่มหมายเหตุ "ข้อที่ตรวจแล้วไม่ถูก" (F2, F1, F9) · คู่มือหน้าขายส่วนโปรเลือกเอง
- [ ] ทุกข้อมีที่มา (Q/R/F) · ไม่เปลี่ยนสถานะการตัดสินใจเองนอกจากคำตอบเจ้าของ · commit (`docs/**` commit ได้ — D45)

### T12: ตรวจทั้งสายและ merge (หัวหน้า opus + code-reviewer sonnet + security-reviewer opus)

- [ ] `pnpm install` · `pnpm turbo run typecheck test` · `pnpm --filter @dayo/pos e2e` บน `plan-10-promo` ผ่านทั้งหมด
- [ ] `pnpm --filter @dayo/dayo-pricing vendor:check` = ว่าง · `vendor:drift D:\TungAo-Project\line-bot\dayo-shop-system main` = ว่าง (ไม่ว่าง = dayo เดินต่อ → หยุด ถามเจ้าของว่าจะ vendor ใหม่ก่อน merge หรือไม่)
- [ ] ตรวจ pin: `VENDOR.json.commit` = `pos-parity.json.dayo_commit` = `pos-parity.seed.json.dayo_commit`
- [ ] code-reviewer: สองคำตัดสิน (ตรงแผน + คุณภาพ) ทั้ง diff `main..plan-10-promo` · security-reviewer: F2 พนักงาน · บิล ฿0 · เงินข้ามขอบ · แถว E2 ไม่มีคีย์ใหม่เมื่อไม่ใช้โปรเลือกเอง · ไม่มีค่าลับในเทสต์/fixture
- [ ] แก้ 1 รอบ → ตรวจซ้ำเฉพาะจุด · `git status` ทุก worktree สะอาด (ผู้ตรวจคืนค่า probe)
- [ ] `git merge --no-ff plan-10-promo` เข้า `main` (ข้อความผ่าน `caveman:caveman-commit`) → เทสต์ทั้ง repo อีกรอบ → push
- [ ] แจ้งเจ้าของ: สรุปผล · Task 19 ของแผน 09 เริ่มได้ (D123) โดยใช้ `pos-parity.json` ของ commit เดียวกัน · การยก D122 ตามคำตอบ Q4
