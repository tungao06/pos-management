# ส่งมอบให้ทีม POS — กฎโปรแบบทั่วไป (rule v1) + กลุ่มโปร + หลายช่วงเวลา (ADR-0071) + ส่วนลดขั้นบันได + จำกัดจำนวนครั้ง (rule v2, ADR-0072)

> อ้างอิง `docs/adr/0071-promotion-rules.md` (แก้ ADR-0030 ข้อ 1/2/3 · แก้ ADR-0070 ข้อ 3/8/11/14–15 · ขยาย ADR-0048/0049/0062)
> · migration `supabase/migrations/0071_promotion_rules.sql` · `docs/API.md` หัวข้อ 1 ("กฎโปรรูปใหม่ (ADR-0071)") และ
> หัวข้อ 2 อัปเดตแล้ว · `apps/web/openapi.yaml` อัปเดตแล้ว · ไฟล์ตัวคิดราคาเปลี่ยน (`packages/shared/src/{money,
> promotions,types}.ts` และ **ไฟล์ใหม่ `packages/shared/src/promoRule.ts`**) → `npm run pos:parity` ชุดใหม่ —
> **ต้องเทียบก่อนอัปเดตแท็บเล็ต**
> · **เพิ่ม (ADR-0072 ข้อ 1):** ส่วนลดขั้นบันได = `rule.v = 2` — ดูหัวข้อ 9 ด้านล่าง `docs/adr/0072-promotion-rules-phase-2.md`
> · `supabase/migrations/0073_promo_tiers.sql` · ไฟล์ตัวคิดราคาเปลี่ยนอีกครั้ง (`packages/shared/src/{promotions,
> promoRule,types}.ts` — ไม่มีไฟล์ใหม่ รอบนี้) → `npm run pos:parity` ชุดใหม่อีกชุด (เพิ่ม `rules-tiers.json`)
> · **เพิ่ม (ADR-0072 ข้อ 2):** จำกัดจำนวนครั้ง (รวม/ต่อวัน) — ดูหัวข้อ 10 ด้านล่าง · `supabase/migrations/
> 0074_promo_usage_limits.sql` — **ไม่ใช่ตัวคิดราคาที่ POS ต้องคัดลอกใหม่** (เพดานจำนวนครั้งกันที่ฝั่งเซิร์ฟเวอร์เท่านั้น
> ตอน `POST /v1/pos/push`) → `npm run pos:parity` เพิ่ม `rules-fixtures` ชุด `usage-limits.json` ให้เทียบ (ไม่บังคับ
> เทียบ `exhaustedPromotions` — ดูหัวข้อ 10)

## สรุปสั้น ๆ

โปรแต่ละตัวตอนนี้เป็น **กฎทั่วไป** (`rule` — เงื่อนไข + เป้าหมาย + รางวัล) ไม่ใช่แค่ 4 ชนิดตายตัวอีกต่อไป (ซื้อ N แถม M ·
ลดรายเมนู · ลดทั้งบิล · เซ็ตราคาพิเศษ) รองรับเพิ่ม: ลดตามหมวด/ขนาด/ตัวเลือก · ซื้อ A แถม B ข้ามเมนู · แก้วที่ N ลด X% ·
ราคาคงที่ต่อแก้ว · เพดานส่วนลด (`cap_baht`) · ปัดส่วนลดลงเป็นบาท (`floor_baht`) · หลายช่วงเวลาต่อวัน + ข้ามเที่ยงคืน ·
กลุ่มโปร (`promotion_groups` — ซ้อนได้/แยกกัน) · ลดเฉพาะค่าตัวเลือก (`apply_to=option`)

**`kind`/`params` เดิมยังอยู่** เป็นค่าอนุมานอ่านอย่างเดียว (dayo แปลงให้จาก `rule` ทุกครั้งที่บันทึก) — โปรที่แปลงกลับเป็น
รูปเดิมได้ (เป้าหมายมีแค่รหัสเมนู ไม่มีเพดาน/ตัวเลือกขั้นสูง ฯลฯ — เงื่อนไขเต็มใน ADR ข้อ 7) ยังมี `kind` เหมือนเดิมทุก
ประการ **แท็บเล็ตที่ไม่อัปเดตอะไรเลยยังใช้งานได้ปกติ 100%** เห็นเฉพาะโปรกลุ่มนี้ ยอดเงินก็ยังตรงเป๊ะ — แต่โปรที่ใช้
ความสามารถใหม่ (เพดาน ตัวเลือก ฯลฯ) **จะไม่ปรากฏใน catalog ของแท็บเล็ตเก่าเลย** (ไม่ใช่ปรากฏแบบคิดผิด)

## 1) E1 `GET /v1/pos/catalog?known_version=&promo_rule_version=` — พารามิเตอร์ใหม่

**`promo_rule_version`** (จำนวนเต็ม ≥ 0 · ไม่ส่ง = ค่าเริ่มต้น `0` = พฤติกรรมเดิมทุกประการ) บอก dayo ว่าแท็บเล็ตเข้าใจ
กฎโปรรุ่นไหนที่สุด — ตอนนี้มี `1` (กฎทั่วไป ADR-0071) และ `2` (เพิ่มส่วนลดขั้นบันได ADR-0072 — ดูหัวข้อ 9) **อย่าส่ง `2`
จนกว่าจะทำตามเช็กลิสต์หัวข้อ 9 เสร็จ**

```bash
curl -s "https://<โดเมนร้าน>/api/v1/pos/catalog?promo_rule_version=1" \
  -H "Authorization: Bearer dayo_ใส่คีย์จริงตรงนี้"
```

**`supported_fields.promotion_rule_versions`** (เช่น `[1, 2]`) = รุ่นกฎโปรที่ dayo เวอร์ชันนี้เข้าใจ ใช้ตัดสินใจว่าจะส่ง
`promo_rule_version` เท่าไร (ไม่ใช่ scope/rate limit อะไร แค่บอกความสามารถ)

**`catalog.promotionGroups[]`** (ฟิลด์ใหม่ — ส่งมาเสมอไม่ว่า `promo_rule_version` เท่าไร):

```json
{ "code": "main", "name": "ทั่วไป", "sortOrder": 0, "stackMode": "separate" }
```

`stackMode`: **`separate`** = แก้วที่ได้ส่วนลดจากกลุ่มก่อนหน้าแล้วถูกข้ามในกลุ่มนี้ (พฤติกรรมเดิม 1 แก้ว 1 โปร) ·
**`stack`** = ลดต่อจาก "ราคาที่เหลือ" ของแก้ว (ลดซ้อนได้จริง) — โปรที่ไม่มี `groupCode` อยู่กลุ่ม `main` เสมอ (ค่าตั้งต้น
`stackMode=separate` เหมือนพฤติกรรมวันนี้ทุกประการ — ร้านที่ยังไม่ตั้งกลุ่มใหม่ ยอดไม่เปลี่ยน)

**`catalog.promotions[]` แต่ละแถว** เพิ่ม `template` `rule` `timeWindows` `groupCode` `summaryTh` **เมื่อ
`promo_rule_version ≥ rule.v` ของโปรนั้น** (ตอนนี้ `rule.v = 1` เสมอ) ตัวอย่างโปรที่ถูกส่งเต็มรูป:

```json
{
  "id": "…", "code": "SUMMER2", "kind": "buy_n_get_m", "priority": 2, "isActive": true,
  "template": "buy_get",
  "rule": { "v": 1, "scope": "cup", "target": { "menus": ["TT01"] },
            "reward": { "type": "buy_get", "buy": 1, "get": 1, "get_pick": "cheapest" },
            "cap_baht": null, "rounding": "round2", "stop_group": false },
  "timeWindows": [{ "days": [1,2,3,4,5], "from": "14:00", "to": "16:00" }],
  "groupCode": "main",
  "summaryTh": "ทุกวันจันทร์–ศุกร์ 14:00–16:00 ชาไทยทุกขนาด ซื้อ 1 แถม 1 แก้วที่ถูกสุด"
}
```

**สามพฤติกรรมตาม `promo_rule_version` (สำคัญมาก):**

| กรณี | `promo_rule_version` | ผลที่แท็บเล็ตเห็น |
|---|---|---|
| โปรแปลงเป็นรูปเดิมได้ | ไม่ส่ง/ต่ำกว่า `rule.v` | มี `kind`/`params`/`daysOfWeek`/`timeFrom`/`timeTo`/`stackable` เหมือนวันนี้ทุกประการ **ไม่มี** `template`/`rule`/`timeWindows`/`groupCode`/`summaryTh` |
| โปรแปลงเป็นรูปเดิมได้ | ≥ `rule.v` | มีครบทั้งสองชุด — `kind` เดิมก็ยังอยู่ **พร้อมกับ** `template`/`rule`/`timeWindows`/`groupCode`/`summaryTh` |
| **โปรแปลงเป็นรูปเดิมไม่ได้** | ไม่ส่ง/ต่ำกว่า `rule.v` | **ไม่ปรากฏใน `catalog.promotions[]` เลย** (ไม่ส่งมาแบบผิด ๆ ให้เดา) |
| **โปรแปลงเป็นรูปเดิมไม่ได้** | ≥ `rule.v` | ปรากฏ **แต่ไม่มีคีย์ `kind` เลย** (ไม่ใช่ `kind: null` — คีย์หายไปทั้งคีย์) มีเฉพาะ `template`/`rule`/`timeWindows`/`groupCode`/`summaryTh` |

ยอดเงินไม่พึ่งพาฟิลด์เหล่านี้เลย — **dayo คิดโปรจริงซ้ำเสมอตอนบันทึกบิลที่ `POST /v1/pos/push`** แท็บเล็ตที่ไม่ส่ง
`promo_rule_version` ยังได้ยอดถูกต้อง 100% เพียงแต่ตัวอย่างราคาบนหน้าจอจะไม่เห็นโปรที่แปลงไม่ได้ (ถ้าพนักงานลองกดคิด
ราคาเองด้วยไฟล์ vendor เก่า ผลจะต่างจากที่ dayo คิดจริง — เห็นเป็น `amount_mismatch` เท่านั้น ไม่ถูกปฏิเสธบิล)

## 2) ⚠️ จุดที่ทีม POS ต้องแก้ schema ก่อนอัปเดตจริง (`promoCommon`/`Promotion`)

`packages/contracts/src/dayo-api.ts` (`pos-management`) ปัจจุบันเขียน:

```ts
const Promotion = z.discriminatedUnion('kind', [
  z.looseObject({ ...promoCommon, kind: z.literal('buy_n_get_m'), … }),
  z.looseObject({ ...promoCommon, kind: z.literal('item_discount'), … }),
  z.looseObject({ ...promoCommon, kind: z.literal('bill_discount'), … }),
  z.looseObject({ ...promoCommon, kind: z.literal('bundle'), … }),
])
```

**นี่คือ discriminated union ที่บังคับให้คีย์ `kind` ต้องมีอยู่เสมอ** — ตราบใดที่แท็บเล็ตยังไม่ส่ง `promo_rule_version`
(หรือส่งค่าเดิม `0`) โปรทุกตัวที่ dayo ส่งมายังมี `kind` เสมอ (ตารางด้านบนแถวที่ 1) **schema เดิมยังผ่านได้ ไม่ต้องแก้อะไร
ถ้าไม่คิดอัปเดตตอนนี้**

**แต่ทันทีที่แท็บเล็ตเริ่มส่ง `promo_rule_version ≥ 1`** (เพื่อเริ่มใช้ความสามารถใหม่) โปรที่แปลงเป็นรูปเดิมไม่ได้จะมาถึง
โดย**ไม่มีคีย์ `kind` เลย** (ตารางแถวที่ 4) — `z.discriminatedUnion('kind', …)` จะโยน error ทันทีเมื่อเจอแถวแบบนี้
(discriminator ไม่ match กับ literal ใดเลย เพราะคีย์หายไป) **ทำให้ E1 ทั้งก้อนพังหรือ `catalog` ทั้งก้อนถูกทิ้ง** แม้จะ
ผ่านชั้นแรกที่เป็น `PosCatalogLooseData` (catalog: `z.unknown()`) ก็ตาม เพราะชั้นที่สอง (`PosOrderCatalog` ที่ parse
`catalog` จริง) ยังใช้ `Promotion` ตัวนี้อยู่

**ต้องแก้ก่อนส่ง `promo_rule_version ≥ 1`**: เพิ่มสาขาใหม่ให้ `Promotion` ที่ไม่มี `kind` (เช่นแยกเป็น
`z.union([LegacyPromotion, RulePromotion])` แล้ว `LegacyPromotion` ค่อยเป็น discriminated union บน `kind` ต่อไป
ส่วน `RulePromotion` ตรวจด้วย `template`/`rule` แทน — หรือทำ `kind` เป็น `exactOptional()` แล้วแยกด้วย `.refine`) —
**นี่ไม่ใช่จุดขัด ADR** เป็นแค่โค้ด TypeScript ฝั่ง POS ที่ยังเขียนแคบกว่าที่สเปกใหม่ต้องการ ไม่ต้องแก้ ADR/สเปกที่ล็อกไว้
(สเปก `docs/design/04-สเปกการเชื่อม-POS-กับ-dayo.md` ข้อ "ความเข้ากันได้" บอกอยู่แล้วว่า "ฝั่งรับต้องยอมรับฟิลด์ที่ไม่
รู้จักในคำตอบ" — การไม่มีคีย์ `kind` เลยเป็นกรณีเดียวกัน แค่ implementation ปัจจุบันยังไม่ยืดหยุ่นพอ)

## 3) `GET /v1/promotions` — เพิ่มฟิลด์แบบเดียวกัน แต่ **ไม่มีพารามิเตอร์รุ่น**

`template` `rule` `time_windows` `group_code` `summary_th` ส่งมาครบทุกโปรที่เปิดใช้งานเสมอ (ไม่ตัดโปรที่แปลงไม่ได้ออก
เหมือน E1) — endpoint นี้ไม่ใช่เส้นทางหลักของแท็บเล็ต (`docs/API.md` แนะนำใช้ `catalog.promotions` จาก E1 แทน) จึงไม่ต้อง
กันแท็บเล็ตรุ่นเก่าตีความกฎที่อ่านไม่ออก — ถ้าทีม POS มี schema แยกสำหรับ endpoint นี้ก็เจอปัญหาเดียวกับข้อ 2 ถ้าอ่าน
`kind` แบบ discriminator เหมือนกัน แต่ **endpoint นี้ทีม dayo เองก็แนะนำให้เลี่ยงอยู่แล้ว** ผลกระทบต่ำกว่า E1

## 4) `pricing.files_sha256` — ไฟล์ใหม่ `promoRule.ts`

`pricing.files_sha256` (ทั้งใน E1 และ `pos-parity.json`) เพิ่มไฟล์ **`packages/shared/src/promoRule.ts`** (เครื่องคิด
กฎโปร: `validatePromoRule` · `promoFromLegacy` · `promoToLegacy` · `promoWindowMatch` · `promoNeedsOwner`) —
`promotions.ts` (ที่ POS คัดลอกอยู่แล้ว) `import` ไฟล์นี้ตรง ๆ **ทีม POS ต้องคัดลอกไฟล์นี้เพิ่มเข้า
`packages/dayo-pricing/src/vendor/` ด้วย** (`vendor:update`) ไม่งั้น `promotions.ts` เวอร์ชันใหม่จะคอมไพล์ไม่ผ่าน

รายชื่อไฟล์ vendor ที่ต้องอัปเดตครบ: `packages/shared/src/{money,promotions,promoRule,cost,fmt,shopSettings,types,
time}.ts`

## 5) `npm run pos:parity` — ไฟล์ผลลัพธ์เพิ่ม `rule_fixtures[]`

`pos-parity.json` ที่ dayo ส่งให้ยังมี `cases[]` เดิม (ตัวอย่าง §5.3 เดิมทั้งหมด — เลขไม่เปลี่ยน พิสูจน์ว่าโปรรูปเดิมยัง
ได้ผลเท่าเดิมทุกสตางค์หลัง ADR-0071) **และเพิ่มคีย์ใหม่ `rule_fixtures[]`**: อาเรย์ของชุดทดสอบ 5 ชุด (คนละแคตตาล็อก/
ร้านทดสอบ) แต่ละชุดมี `fixture` (ชื่อไฟล์ต้นทาง) `description` `catalog_version` `catalog`
(รูปเดียวกับ `GET /v1/pos/catalog` ที่ `promo_rule_version=1` — มี `template`/`rule`/`timeWindows`/`groupCode`/
`promotionGroups` ครบ) และ `cases[]` (`name`/`draft`/`expected` — `expected` มาจาก `quote_order` จริงของ dayo หลัง
0071 ไม่ใช่ตัวเลขคิดมือ):

| ไฟล์ต้นทาง | ครอบคลุม |
|---|---|
| `rules-cup.json` | รางวัลรายแก้ว: หมวด/ขนาด/ตัวแปร/ตัวเลือก/ยกเว้น × percent/amount/fixed_price × `apply_to=option` (ค่าตัวเลือกที่จ่ายจริงหลังช่องทาง) × `cap_baht` × `floor_baht` |
| `rules-buy-get.json` | `buy_get` รวม: ซื้อ A แถม B ข้ามเมนู (`get_target`) · แก้วที่ N ลด X% · `get_pick` ถูกสุด/แพงสุด · แถมลดบาท/ราคาคงที่ · `max_sets` |
| `rules-groups.json` | กลุ่มโปร `separate`/`stack` · `stop_group` · ส่วนลดทั้งบิลกรอกเอง `yield`/`combine` · `promo_breakdown` |
| `rules-bill.json` | โปรทั้งบิล: `floor_baht` → `cap_baht` → ไม่เกินยอด · ขั้นต่ำเทียบยอดปัจจุบัน |
| `rules-windows.json` | `time_windows` หลายช่วง + ข้ามเที่ยงคืน (เป็นของ "วันเริ่ม") + ช่วงวันที่เทียบกับวันเริ่มของช่วง |

**ทีม POS ควรเทียบทั้ง `cases[]` เดิมและ `rule_fixtures[].cases[]` ใหม่** ด้วย `promotions.ts`/`promoRule.ts` เวอร์ชัน
ที่คัดลอกมา ก่อนปล่อยแท็บเล็ตที่ส่ง `promo_rule_version=1` จริง — เรียกฟังก์ชันเครื่องคิดของ POS เองด้วย
`catalog`+`draft` ของแต่ละเคส แล้วเทียบผลกับ `expected` (คีย์เงินเดิม: `itemsSubtotal`/`itemsDiscount`/
`billDiscountAmount`/`totalAmount`/`channelFeeAmount`/`lines[].unitPrice`/`discountPerCup`/`lineTotal`/
`promotionsApplied[].discountAmount` — ยังไม่มีต้นทุน/กำไรเหมือนเดิม ADR-0040 ข้อ 3)

## 6) สิ่งที่ทีม POS ต้องทำ (สรุปเช็กลิสต์)

- [ ] `vendor:update` ไฟล์ `packages/dayo-pricing/src/vendor/{money,promotions,promoRule,cost,fmt,shopSettings,types,
      time}.ts` เป็นชุดใหม่ (ADR-0071) — ไฟล์ `promoRule.ts` เป็นไฟล์ใหม่ ต้องคัดลอกเพิ่ม ไม่ใช่แก้ไฟล์เดิม
- [ ] **แก้ schema `Promotion`/`promoCommon` ใน `packages/contracts/src/dayo-api.ts`** ให้รับแถวที่ไม่มีคีย์ `kind` เลย
      ได้ (ดูข้อ 2) — ทำก่อนเริ่มส่ง `promo_rule_version ≥ 1` เท่านั้น (ยังไม่ทำก็ยังใช้งานปกติได้ต่อไปเพราะค่าเริ่มต้น
      `promo_rule_version=0`)
- [ ] เพิ่มฟิลด์ `template` `rule` `timeWindows` `groupCode` `summaryTh` (ทั้งหมด `exactOptional()`) เข้า schema โปร
- [ ] เพิ่ม schema `promotionGroups[]` (`code`/`name`/`sortOrder`/`stackMode`) เข้า `PosOrderCatalog`
- [ ] ตัวเรียก E1 (`fetchCatalog`/เทียบเท่า) ส่ง query param `promo_rule_version` (ค่าจาก `PROMO_RULE_VERSIONS` ล่าสุด
      ที่ `promoRule.ts` เวอร์ชันที่คัดลอกมารู้จัก — ตอนนี้คือ `1`) เมื่อพร้อมใช้กฎโปรรูปใหม่จริง
- [ ] ตะกร้า/`computeOrder` ของ POS อ่าน `rule`/`template`/`timeWindows`/`groupCode`/`promotionGroups` แทน `kind`/
      `params`/`daysOfWeek`/`timeFrom`/`timeTo`/`stackable` เมื่อมีครบ (โปรที่มีทั้งสองชุด — ใช้ชุดใหม่เป็นหลัก
      เหมือนที่ `promotions.ts` เวอร์ชันใหม่ทำ)
- [ ] รัน `npm run pos:parity` (ฝั่ง dayo ส่งไฟล์ผลใหม่มาให้) เทียบทั้ง `cases[]` และ `rule_fixtures[].cases[]` ก่อน
      อัปเดตแท็บเล็ตจริง — ตัวเลขต้องตรงทุกสตางค์
- [ ] mock ยิง E1 ด้วย `promo_rule_version=0` (ไม่ส่ง) และ `=1` เทียบว่าโปรที่แปลงไม่ได้หายไป/ปรากฏตามตารางข้อ 1

## 7) เข้ากันได้กับแท็บเล็ตรุ่นเก่า (ไม่อัปเดตทันที)

- **ไม่ต้องทำอะไรเลยก็ยังใช้งานได้ปกติ 100%** — ไม่ส่ง `promo_rule_version` = ได้พฤติกรรมเดิมทุกประการ (โปรรูปเดิมเห็น
  ครบ โปรที่ใช้ความสามารถใหม่ไม่ปรากฏแต่ยอดเงินยังถูกต้องเสมอเพราะ dayo คิดจริงที่ `POST /v1/pos/push`)
- ร้านที่ยังไม่ได้ตั้งกลุ่มโปรใหม่ (ทุกโปรอยู่กลุ่ม `main` ค่าเริ่มต้น `stackMode=separate`) — ยอดไม่เปลี่ยนจากก่อน
  ADR-0071 เลยแม้แท็บเล็ตจะอัปเดต schema ครบแล้วก็ตาม (กลุ่ม `main` behavior = พฤติกรรมเดิมทุกประการ)
- เว็บ dayo แสดงป้าย **"POS รุ่นเก่าไม่เห็นโปรนี้"** บนโปรที่แปลงเป็นรูปเดิมไม่ได้ ให้เจ้าของ/ผู้จัดการรู้ตัวเวลาตั้งโปร
  ที่ใช้ความสามารถใหม่ก่อนแท็บเล็ตทุกเครื่องอัปเดต

## 8) ไม่พบจุดขัดสเปก/ADR ที่ต้องแก้ฝั่งใดฝั่งหนึ่งก่อน

ตรวจ `docs/design/04-สเปกการเชื่อม-POS-กับ-dayo.md` (สเปกปัจจุบันของทีม POS ยังไม่พูดถึง `rule`/`template`/
`timeWindows`/`groupCode`/`promotionGroups`/`promo_rule_version`) เทียบ ADR-0071 + migration `0071` แล้ว **ทุกฟิลด์
ใหม่เป็น additive** (เพิ่มฟิลด์ไม่บังคับ ไม่ลบ/เปลี่ยนความหมายฟิลด์เดิม `kind`/`params`/`daysOfWeek`/`timeFrom`/
`timeTo`/`stackable`/`requiresCode`/`autoApply`/`applyMode` ยังอยู่ครบเหมือนเดิม) และหลักการ "ฝั่งรับต้องยอมรับฟิลด์ที่
ไม่รู้จัก" ในสเปก §4 (ความเข้ากันได้) ก็ครอบคลุมกรณีนี้อยู่แล้ว **ไม่ต้องแก้ ADR หรือสเปกที่ล็อกไว้แล้ว** — ข้อเดียวที่ต้อง
ระวัง (ไม่ใช่จุดขัด แต่เป็นข้อจำกัดของโค้ดปัจจุบันฝั่ง POS) คือ discriminated-union บน `kind` ในข้อ 2 ข้างบน สเปก POS
ต้องอัปเดตเป็นเอกสารใหม่ (ไม่ใช่แก้ทับ `04-สเปกการเชื่อม-POS-กับ-dayo.md`) เมื่อทีม POS เริ่มงานนี้จริง

## 9) rule v2 (ขั้นบันได) — ADR-0072 ข้อ 1

โปร `rule.v = 2` เพิ่มรางวัลใหม่ 2 ชนิด: **`tiered`** (ส่วนลดขั้นบันไดรายแก้ว scope=cup) และ **`bill_tiers`** (ส่วนลดขั้น
บันไดทั้งบิล scope=bill) — ได้ **ขั้นสูงสุดที่ถึงขั้นเดียว ไม่สะสมทีละช่วง** ดูโครง `rule` เต็มใน `docs/API.md` หัวข้อ
"กฎโปรรูปใหม่" และตัวอย่าง JSON ในนั้น

- **โปร `rule.v = 2` แปลงเป็นรูปเดิม (`kind`/`params`) ไม่ได้เสมอ** — เครื่องที่ส่ง `promo_rule_version` ต่ำกว่า 2 จะไม่
  เห็นโปรกลุ่มนี้ใน `catalog.promotions[]` เลย (ไม่ใช่ปรากฏแบบคิดผิด) ยอดเงินยังถูกต้องเสมอเพราะ dayo คิดจริงที่
  `POST /v1/pos/push` — เห็นเป็น `amount_mismatch` เท่านั้นถ้าพนักงานลองกดคิดราคาเองด้วยไฟล์ vendor รุ่นเก่า
- **สิ่งที่ต้องคัดลอกใหม่ (`vendor:update`)**: `packages/shared/src/promotions.ts` (เพิ่มการคิด `tiered`/`bill_tiers`),
  `packages/shared/src/promoRule.ts` (เพิ่ม `checkTiers`/`promoRuleMinVersion` v2/`promoTemplateFits` 2 แม่แบบใหม่ —
  ไฟล์นี้ทีม POS คัดลอกไว้แล้วตั้งแต่ ADR-0071 แก้ไขไฟล์เดิม ไม่ใช่ไฟล์ใหม่), `packages/shared/src/types.ts` (ชนิด
  `PromoCupTier`/`PromoBillTier` ใหม่) — ไม่มีไฟล์ vendor ใหม่รอบนี้ (ต่างจาก ADR-0071 ที่เพิ่ม `promoRule.ts` เป็นไฟล์
  ใหม่)
- **ส่ง `promo_rule_version=2` ได้ก็ต่อเมื่อ**: (1) คัดลอกไฟล์ทั้ง 3 ข้างต้นเข้า `packages/dayo-pricing/src/vendor/`
  แล้ว (2) ตะกร้า/`computeOrder` ของ POS อ่าน `reward.type = tiered/bill_tiers` ได้ถูกต้อง (3) รัน
  `npm run pos:parity` เทียบ `rule_fixtures[].cases[]` ชุดใหม่ผ่านทุกเคส — **ยังไม่ทำตามนี้ให้ส่ง `promo_rule_version=1`
  ต่อไปเหมือนเดิม** (พฤติกรรมปกติ 100% ไม่มีอะไรพัง)
- **เคสเทียบใน `pos-parity.json`**: ไฟล์ใหม่ `rule_fixtures[]` เพิ่มชุด **`rules-tiers.json`** ครอบ `tiered` ×
  `basis=qty`/`amount` × คีย์รางวัล `percent`/`baht`/`fixed_price` × `apply_to=cup`/`option` และ `bill_tiers` ×
  `basis=subtotal`/`qty`(+`target`) × ขอบขั้นพอดี `min` (ถึงขั้น/ไม่ถึงขั้นแรก) × ร่วมกับ `cap_baht`/`floor_baht`/กลุ่ม —
  เทียบเหมือนชุดเดิม (ข้อ 5): เรียกเครื่องคิดของ POS เองด้วย `catalog`+`draft` ของแต่ละเคสแล้วเทียบกับ `expected` จาก
  `quote_order` จริง (คีย์เงินเดิม ยังไม่มีต้นทุน/กำไร — ADR-0040 ข้อ 3)
- **ไม่พบจุดขัดสเปก/ADR** — เหมือนข้อ 8: ฟิลด์ `template`/`rule` ที่มี `tiered`/`bill_tiers` เป็น additive ทั้งหมด (ค่า
  `reward.type` ใหม่ในฟิลด์เดิม) หลักการ "ฝั่งรับต้องยอมรับฟิลด์ที่ไม่รู้จัก" ในสเปก §4 ครอบคลุมอยู่แล้ว — schema
  `Promotion`/`promoCommon` ที่ต้องแก้ตามข้อ 2 (รองรับแถวไม่มี `kind`) ใช้ร่วมกับ `rule.v = 2` ได้เลย ไม่ต้องแก้เพิ่ม

## 10) จำกัดจำนวนครั้ง (ADR-0072 ข้อ 2 · PR-B)

โปรแต่ละตัวตั้งเพดานจำนวนครั้งได้ 2 แบบ (**รวม** และ **ต่อวัน** เลือกได้พร้อมกัน) — เป็น**เงื่อนไขของโปร ไม่ใช่ส่วนของ
`rule`** จึงไม่ยก `rule.v` (เพดานปรากฏได้ทั้ง `rule.v = 1` และ `2`)

- **`catalog.promotions[].usageLimitTotal`/`.usageLimitPerDay`** — ส่งเมื่อ `promo_rule_version ≥ 2` เท่านั้น
  (เหมือน `template`/`rule` — ต่ำกว่า 2 จะไม่มี 2 ฟิลด์นี้แม้โปรนั้นแปลงเป็นรูปเดิมได้) **ไม่มีจำนวนที่ใช้ไปแล้ว/คงเหลือ
  ส่งมาด้วยเลย** — เหตุผล: **แท็บเล็ตขายออฟไลน์ได้ นับจำนวนครั้งข้ามเครื่องไม่ได้** ตัวเลขที่ส่งมาจะเก่าทันทีที่มีเครื่อง
  อื่นขาย และการอัปเดตจำนวนคงเหลือทุกบิลจะทำให้ `catalog_version` ขยับถี่เกินจำเป็น — ใช้ 2 ฟิลด์นี้แสดงผลบนหน้าจอ
  แท็บเล็ตเป็นข้อมูลอ้างอิงเท่านั้น (เช่น "จำกัด 100 แก้ว/วัน") **ห้ามใช้ตัดสินใจว่าจะให้ส่วนลดหรือไม่ที่ฝั่งแท็บเล็ต**
- **`GET /v1/promotions`** เพิ่ม `usage_limit_total`/`usage_limit_per_day` แบบเดียวกัน (ไม่มีพารามิเตอร์รุ่น เหมือนฟิลด์
  อื่นในเอนด์พอยต์นี้ — ดูข้อ 3)
- **ระบบ dayo เป็นคนกันเพดานเองเสมอที่ `POST /v1/pos/push`**: บิลที่ส่งเข้ามาหลังโปรครบจำนวนครั้งแล้ว **ยังถูกรับเสมอ**
  (ไม่ปฏิเสธ) แต่ dayo จะไม่ให้ส่วนลดจากโปรนั้น → ถ้ายอดที่แท็บเล็ตส่งมา (คิดรวมส่วนลดที่คิดว่าจะได้) ต่างจากที่ dayo
  คิดจริงเกิน ฿1 บิลจะติดธง `amount_mismatch` เหมือนกรณี `amount_mismatch` อื่น ๆ — **หน้า dayo `/sales/[order_no]`
  จะโชว์ "โปร ... ครบจำนวนครั้งแล้ว ณ ตอนบิลเข้า"** ให้เจ้าของตรวจทีหลังได้ · บิลที่เข้าก่อนหน้าไม่ถูกคิดใหม่
  (ยึดลำดับที่บิลเข้าระบบ ไม่ใช่ `sold_at`)
- **`exhaustedPromotions` ในผล `pos:parity`**: `rule_fixtures[]` ชุดใหม่ **`usage-limits.json`** มีเคสที่เพดานครบระหว่าง
  จำลองหลายบิลติดกัน — `expected` ของเคสเหล่านี้มี `exhaustedPromotions: [{promotionId, scope: "total"|"day"}]` ประกบ
  `expected` เงินปกติ (ไม่ได้ส่วนลดจากโปรที่ครบ) — **แท็บเล็ตไม่ต้องส่งฟิลด์ `exhaustedPromotions` ไปเอง** (เป็นผลที่
  dayo คิดฝั่งเซิร์ฟเวอร์เท่านั้น) จึงยืนยันแค่ว่าเครื่องคิดของ POS **ไม่ต้องรู้จักเพดานจำนวนครั้งเลยก็ได้** (ปล่อยให้
  dayo กันซ้ำตอนบันทึกบิลเสมอ) — ในเคสทดสอบเหล่านี้ให้ทีม POS ข้ามการเทียบ `exhaustedPromotions` ได้ เทียบแค่ตัวเลข
  เงินที่เหลือ (โปรที่ครบ = ไม่ได้ส่วนลด เหมือนโปรนั้นไม่มีอยู่)
- **ไม่ต้องแก้ schema เพิ่มจากข้อ 2** — `usageLimitTotal`/`usageLimitPerDay` เป็นตัวเลข `exactOptional()` ธรรมดา
  ไม่ใช่ discriminator ใหม่
