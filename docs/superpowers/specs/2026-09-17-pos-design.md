# DA-YO POS — เอกสารออกแบบ (Design Spec)

วันที่: 17 ก.ย. 2026 · สถานะ: 🟢 **อนุมัติแล้ว 17 ก.ย. 2026** (D1–D33) · **แก้ไขรอบ 5** ตาม D34–D43 · แผนการสร้างอยู่ที่ [../plans/](../plans/)
หมายเหตุหน่วย (D33): ต้นทุนต่อหน่วยใช้ที่เขียนว่า `unit_cost_milli` / `avg_cost_milli` / `standard_cost_milli_per_unit` ในเอกสารนี้ ให้อ่านเป็น **`_usat` = micro-satang ต่อหน่วยใช้** (1 บาท = 100,000,000 usat) · ต้นทุนเป็นสตางค์ = round(qty_milli × usat / 1,000,000,000)
การตัดสินใจที่อ้างถึง (D1–D43): [../../design/00-บันทึกการตัดสินใจ.md](../../design/00-บันทึกการตัดสินใจ.md)

> **แก้ไขรอบ 5 (17 ก.ย. 2026 หลังทำแผน 1)** — ปรับ spec ให้ตรงกับ D34–D40 และโค้ดแผน 1 (ไม่มีการตัดสินใจใหม่ในรอบนี้)
> - D34: ต้นทุนมาตรฐานของของดิบ = ต้นทุนเฉลี่ยจากบันทึกซื้อในไฟล์ · ก่อนมีของเข้าครั้งแรก avg = ต้นทุนมาตรฐาน · เบส/ชุดบรรจุภัณฑ์ใช้ค่า roll-up จาก BOM (§3.3, §4.4, §9)
> - §4.2: ต้นทุนต่อแก้ว **ปัดเศษครั้งเดียวจากผลรวม** ห้ามปัดทีละวัตถุดิบ
> - D36: `cash_movement` kind ใหม่ `VOID_REFUND` · ยกเลิกบิลเงินสดบันทึก VOID_REFUND (ไม่ใช่ PAID_OUT) · สูตรเงินสดคาดหวังใหม่ (§3.5, §4.3, §4.8)
> - D37: `equipment.life_months` จำนวนเต็ม (§3.6)
> - D38: แฮช `order_event` ครอบ order_id · seq ต่อบิล · device_id · chain_id · chain_seq และตารางมีคอลัมน์ครบ (§3.4, §4.9, §6.3)
> - D39: ลบ `VOID_WASTE` · movement kind มี 11 ค่า (§3.3, §4.3)
> - D40: §9 ตามไฟล์ล่าสุด — ของดิบ 35 · อุปกรณ์ 32 · ไม่นับสต็อกตาม D29
> - §8: golden test ต้อง **ตรงเป๊ะ** ทุกสูตร (แผน 1 ทำได้แล้ว)
ข้อมูลประกอบ: [../../research/](../../research/) โดยเฉพาะ 05 (โมเดลข้อมูล), 09 (เมนูจริง), 10 (โฮสติ้ง)

---

## 0. สรุปหนึ่งหน้า

ระบบ POS สำหรับร้าน DA-YO (ชาไทย · ชาเขียว · มัทฉะ) ใช้เอง 2 คน บนแท็บเล็ต/มือถือ ทำงาน **offline-first** (ขายได้ทั้งวันโดยไม่มีเน็ต) และ sync ขึ้นเซิร์ฟเวอร์ฟรีเพื่อรายงานและสำรองข้อมูล

เฟส 1 ครอบคลุม: ขาย (เงินสด + QR ยืนยันเอง) · สูตรและการตัดสต็อกตามสูตรจริง 360 แถวจากไฟล์ร้าน · ทำเบส · รับของเข้า · นับสต็อก · เปิด/ปิดวัน · ตรวจสอบย้อนหลังแบบละเอียด · รายงานหลัก

หลักการ 4 ข้อที่ทุกส่วนต้องยึด
1. **ตรรกะเงินและสต็อกมีชุดเดียว** อยู่ใน `packages/domain` ใช้ทั้งในเครื่องและเซิร์ฟเวอร์
2. **ธุรกรรมเป็น insert อย่างเดียว** ไม่มี UPDATE/DELETE บิล การเคลื่อนไหวสต็อก และเหตุการณ์
3. **ทุกตัวเลขเป็นจำนวนเต็ม** เงินเป็นสตางค์ ปริมาณเป็น 1/1000 ของหน่วยใช้
4. **ทุกการกระทำระบุคนทำ และตรวจย้อนได้** ด้วย event ที่ล่ามแฮชและ audit log ของข้อมูลหลัก

---

## 1. ขอบเขต

### 1.1 อยู่ในเฟส 1
| โมดูล | สิ่งที่ทำ |
|---|---|
| ขาย | ตะกร้า → เลือกเมนู/ขนาด/ความหวาน → ชำระเงินสดหรือ QR PromptPay (สร้าง QR ใส่ยอด, ยืนยันด้วยตา) → เลขที่บิล + เลขคิว |
| ยกเลิก | ยกเลิกบิลพร้อมเหตุผล + ถาม "ทำไปแล้วหรือยัง" |
| สต็อก | ตัดวัตถุดิบตามสูตรตอนชำระเงิน · ทำเบส · รับของเข้า · นับสต็อก · ปรับสต็อก (ของเสีย/หมดอายุ/ทดลอง) · เตือนใกล้หมด |
| ต้นทุน | ถัวเฉลี่ยเคลื่อนที่ต่อของดิบ · ต้นทุนเบสต่อ batch · ต้นทุนต่อแก้ว snapshot ตอนขาย |
| วัน/เงินสด | เปิดวัน (เงินทอน) · ปิดวัน (นับธนบัตร) · X/Z report |
| Audit | ผู้ใช้ + PIN · order_event ล่ามแฮช · audit_log ข้อมูลหลัก · งานตรวจ invariant รายคืน |
| รายงาน | ยอดขายรายวัน/ช่วง · เมนูขายดี · margin ต่อแก้ว/เมนู · ส่วนต่างสต็อก · มูลค่าสต็อก · รายรับสะสม 12 เดือน (เกณฑ์ VAT) |
| จัดการข้อมูล | เมนู/ขนาด/ราคา · สูตร (ตารางต่อเมนู) · สินค้า/หน่วยซื้อ/จุดสั่งซื้อ · BOM เบส · อุปกรณ์ · ผู้ใช้ · ตั้งค่า |
| นำเข้า | สคริปต์นำเข้าจาก `DA-YO_เมนู.xlsx` ครั้งเดียว |
| **สั่งผ่าน LINE** (D25, ขั้น 6) | ลูกค้าสั่งผ่าน LIFF → จ่าย QR → ร้านกด "รับเงินแล้ว" บนแท็บเล็ต → คิว/ตัดสต็อกเหมือนบิลหน้าร้าน → "พร้อมรับ" → "รับแล้ว" · รายละเอียด §13 |

### 1.2 ไม่อยู่ในเฟส 1 (แต่ schema เผื่อไว้)
- ตรวจสลิปอัตโนมัติ (เฟส 2) · พิมพ์ใบเสร็จ/สติกเกอร์ (เฟส 3, print-agent) · เดลิเวอรี (เฟส 4, มี `channel` แล้ว)
- ท็อปปิ้ง/ระดับน้ำแข็ง/เปลี่ยนนม (มีตาราง `modifier_*` ว่างไว้) · ส่วนลด/โปรโมชั่น (มี `discount` แบบง่าย: ระบุจำนวนเงิน + เหตุผล) · สมาชิก · หลายสาขา · VAT (มี config ปิดไว้) · คืนเงิน (refund) ทำเป็น "ยกเลิกบิล" ก่อน

### 1.3 ผู้ใช้
2 เจ้าของ (TungAo, DCm) · บทบาท `owner` ทั้งคู่ · บทบาท `staff` เตรียมไว้ (ห้ามแก้ข้อมูลหลัก ห้ามดูรายงานกำไร ยกเลิกบิลต้องให้ owner ใส่ PIN)

---

## 2. สถาปัตยกรรม

```
┌──────────────── แท็บเล็ต / มือถือ (PWA) ────────────────┐
│ React + Vite + TanStack Router/Query                     │
│ ┌──────────────┐   ┌────────────────────────────────┐   │
│ │ UI           │──▶│ packages/domain (ตรรกะล้วน)     │   │
│ └──────────────┘   └────────────────────────────────┘   │
│         │ Drizzle (sqlite dialect)                       │
│ ┌──────────────────────────────────────────────────┐    │
│ │ Web Worker: SQLite WASM บน OPFS  (แหล่งความจริง)  │    │
│ │  + outbox (ธุรกรรมที่ยังไม่ส่ง)  + sync_state     │    │
│ └──────────────────────────────────────────────────┘    │
└───────────────────────────┬──────────────────────────────┘
                            │ HTTPS  push outbox / pull reference + ออเดอร์ LINE ขาเข้า (เฉพาะเวลาเปิดร้าน)
                            ▼
┌──────── Render free · Singapore (NestJS, ตื่นตลอดด้วย ping) ────────┐
│ SyncModule · ReportModule · AdminModule · JobsModule · LineModule       │
│ ใช้ packages/domain ชุดเดียวกัน ตรวจซ้ำทุกยอดที่รับมา                  │
│ /health และ /sync/inbox-flag ไม่แตะ DB (ให้ Neon หลับได้)              │
│         │ Drizzle (pg dialect)                                          │
└─────────┼──────────────────────────────────────────────────────────────┘
          ▼                                   ▲ LIFF: ลูกค้าสั่ง (PWA โหมดลูกค้า) · webhook จาก LINE
   Neon PostgreSQL (Singapore) ── ทุกคืน: ตรวจ invariant + pg_dump → R2
```

### 2.1 โครง monorepo
```
pos-management/
├── packages/
│   ├── domain/        ตรรกะล้วน: ราคา · ยอดบิล · ตัดสต็อก · ต้นทุน · เลขที่บิล · แฮช event · กฎกะ · invariant
│   ├── contracts/     Zod schema ของทุก payload ที่ข้าม network + enum ที่ใช้ร่วม
│   ├── db-schema/     Drizzle schema 2 dialect (sqlite/, pg/) จาก "ตารางต้นแบบ" เดียว + เทสต์ตรวจความตรงกัน
│   └── excel-import/  แปลง DA-YO_เมนู.xlsx → JSON seed (รันครั้งเดียว)
├── apps/
│   ├── pos/           PWA 3 โหมด: ขาย (แท็บเล็ต) · back office (มือถือเจ้าของ) · ลูกค้า (LIFF)
│   ├── api/           NestJS (รวม LINE webhook + LIFF API)
│   └── print-agent/   (เฟส 3)
└── docs/
```

### 2.2 อุปกรณ์
- เฟส 1 มี **เครื่องขาย 1 เครื่อง** (แท็บเล็ต) · มือถือของอีกคนเปิด PWA เดียวกันใน "โหมดดูรายงาน" (อ่านจากเซิร์ฟเวอร์ ไม่มี DB ในเครื่อง)
- ทุกเครื่องขายมี `device_id` และ **คำนำหน้าเลขที่บิล** (`A`, `B`, …) → รองรับเครื่องที่ 2 ได้โดยไม่ชนเลข

---

## 3. โมเดลข้อมูล

หลักการตั้งชื่อ: snake_case · PK เป็น UUIDv7 ที่เครื่องสร้าง · เงิน `_satang` (integer) · ปริมาณ `_milli` (integer, 1/1000 ของหน่วยใช้: 1 ml = 1000, 1 g = 1000, 1 ชิ้น = 1000) · เวลา `_at` เป็น UTC ISO · วันทำการ `business_date` เป็น `YYYY-MM-DD`

ตารางแบ่ง 3 ประเภท (สำคัญต่อ sync)
- **R = ข้อมูลอ้างอิง** (เซิร์ฟเวอร์เป็นเจ้าของ แก้ได้ มี `version` + `updated_at`) ไหลลงเครื่อง
- **T = ธุรกรรม** (เครื่องเป็นเจ้าของ insert อย่างเดียว) ไหลขึ้นเซิร์ฟเวอร์
- **L = เฉพาะในเครื่อง** ไม่ sync

### 3.1 ผู้ใช้และอุปกรณ์ (R)
| ตาราง | ฟิลด์หลัก |
|---|---|
| `user` | id · display_name · role (`owner`/`staff`) · pin_hash (argon2) · is_active |
| `device` | id · name · receipt_prefix (`A`) · is_selling_device · registered_at |
| `setting` | key · value_json · effective_from — เช่น `vat.enabled=false`, `vat.rate_bp=700`, `shop.name`, `promptpay.id`, `cash.variance_alert_satang=2000`, `gp.pass_bp=6000`, `gp.warn_bp=5500`, `sync.interval_sec=300` |

### 3.2 แคตตาล็อก (R)
| ตาราง | ฟิลด์หลัก | หมายเหตุ |
|---|---|---|
| `category` | id · name · sort | ชาไทย / ชาเขียว / มัทฉะพรีเมียม / ปั่น (ปั่นเป็นหมวดข้าม? ใช้ `tag` แทน — ดูคำถาม Q23) |
| `product` | id · code (`Original`) · name_th · name_en · category_id · sort · is_active · prep_group (`เย็นธรรมดา`/`แยกชั้น`/`โฟมชีส`/`ปั่น`/…) | code = key ในไฟล์ Excel |
| `size` | id · name (`16 oz`) · sort · packaging_item_id | ชุดบรรจุภัณฑ์ต่อขนาด |
| `product_variant` | id · product_id · size_id · sku · is_active | 24 × 3 = 72 |
| `sweetness_level` | id · name (`50%`) · sort · is_default | 5 ระดับ · default 50% |
| `price` | id · variant_id · channel_id · price_satang · effective_from · created_by | ราคาเป็นตัวเลขต่อขนาด ไม่ใช่ +บาท · ประวัติเก็บทุกแถว |
| `channel` | id · name (`หน้าร้าน`, `LINE OA`, `Grab`, `LINE MAN`, `อื่นๆ`) · commission_bp · is_active | เฟส 1 ใช้ `หน้าร้าน` อย่างเดียว |
| `recipe` | id · variant_id · sweetness_id · version · effective_from · created_by · note · **is_current** | 360 แถวต่อ version · แก้สูตร = สร้าง version ใหม่ ไม่แก้ทับ |
| `recipe_line` | id · recipe_id · item_id · qty_milli | อ้าง item ทั้งเบส (prepared) และของดิบ (raw) |
| `modifier_group` / `modifier_option` / `product_modifier_group` | — | เตรียมไว้ ว่างในเฟส 1 |

### 3.3 สินค้าและสต็อก
| ตาราง | ประเภท | ฟิลด์หลัก | หมายเหตุ |
|---|---|---|---|
| `item` | R | id · code (`RM-TEA-01`) · name · kind (`raw`/`prepared`/`packaging_set`) · category · use_unit (`g`/`ml`/`ชิ้น`/`ชุด`) · is_tracked · reorder_point_milli · standard_cost_usat (ต้นทุนมาตรฐาน) · shelf_life_hours (prepared) · is_active · note | ต้นทุนมาตรฐาน (D34): ของดิบ = **ต้นทุนเฉลี่ยจากบันทึกซื้อ** (ชีต "สินค้าและสต็อก" คอลัมน์ "ต้นทุนเฉลี่ยต่อหน่วยซื้อ" ÷ หน่วยใช้) · เบสและชุดบรรจุภัณฑ์ = ค่า roll-up จาก BOM · `is_tracked=false` = ไม่นับสต็อก แต่ยังคิดต้นทุนด้วย standard_cost (D29: น้ำแข็ง น้ำสะอาด น้ำดื่มถัง เกลือ) |
| `purchase_unit` | R | id · item_id · name (`ถุง`) · qty_per_unit_milli (400000) · is_default · barcode | มะนาว: `กิโลกรัม` = 250000 ml (yield) |
| `bom` | R | id · item_id (prepared) · version · yield_milli · is_current · instructions | ชาไทยเบส yield 3,000,000 |
| `bom_line` | R | id · bom_id · component_item_id · qty_milli | |
| `purchase` | T | id · business_date · supplier · total_satang · receipt_image_ref · note · created_by · created_at | 1 ใบเสร็จ |
| `purchase_line` | T | id · purchase_id · item_id · purchase_unit_id · qty_units_milli · qty_use_milli · line_total_satang | ระบบคำนวณ qty_use จาก unit |
| `production_batch` | T | id · bom_id · business_date · scale_bp (10000 = 1 batch) · yield_actual_milli · unit_cost_milli · expires_at · created_by · created_at | "ทำเบส" |
| `stock_count` | T | id · business_date · status (`open`/`closed`) · created_by · closed_at | ใบนับ |
| `stock_count_line` | T | id · count_id · item_id · counted_units_milli · purchase_unit_id · counted_use_milli · expected_use_milli · variance_use_milli · variance_satang | expected = ยอดตามบัญชี ณ เวลานับ |
| `stock_movement` | T | id · item_id · kind · qty_milli (มีเครื่องหมาย) · unit_cost_milli · ref_type · ref_id · business_date · created_by · created_at | **บัญชีแยกประเภท** ห้ามแก้ · kind 11 ค่า (D39): `OPENING` `PURCHASE` `SALE` `VOID_RETURN` `PRODUCE_OUT` `PRODUCE_IN` `WASTE` `EXPIRED` `COUNT_ADJ` `TRIAL` `TRANSFER` · ของที่ทำแล้วโดนยกเลิกไม่มี movement (ดู §4.3) |
| `item_cost_state` | L+server | item_id · on_hand_milli · avg_cost_milli · as_of_movement_id | **แคช** สร้างใหม่จาก movement ได้เสมอ |

### 3.4 การขาย (T)
| ตาราง | ฟิลด์หลัก | หมายเหตุ |
|---|---|---|
| `order` | id · **origin** (`device`/`server`) · device_id (null จนกว่าแท็บเล็ตจะรับ) · receipt_no (`A-000123`, ออกตอน paid) · queue_no · business_date · shift_id · channel_id · **customer_id** (LINE) · status (`open` / `pending_payment` / `pending_verify` / `paid` / `ready` / `picked_up` / `cancelled` / `rejected` / `voided`) · subtotal_satang · discount_satang · total_satang · vat_satang (0) · cost_satang · note · created_by (user หรือ customer) · created_at · paid_at · ready_at · voided_at | ห้ามลบ · บิลหน้าร้านใช้แค่ open→paid(→voided) · บิล LINE ใช้สถานะเต็ม (§13) |
| `customer` | id · line_user_id (unique) · display_name · picture_url · first_seen_at · last_order_at · is_blocked | เก็บขั้นต่ำ (PDPA) · ไม่มีเบอร์/ที่อยู่ |
| `order_payment_intent` | id · order_id · promptpay_payload · amount_satang · expires_at · slip_image_ref · customer_claimed_at | QR ที่แสดงให้ลูกค้า LINE + สลิปที่แนบ (เฟส 2 ตรวจอัตโนมัติ) |
| `order_line` | id · order_id · line_no · variant_id · sweetness_id · recipe_id (version ที่ใช้) · **snapshot:** product_name · size_name · sweetness_name · unit_price_satang · qty · line_total_satang · unit_cost_satang | แก้ราคา/สูตรภายหลังไม่กระทบบิลเก่า |
| `payment` | id · order_id · method (`CASH`/`PROMPTPAY`) · amount_satang · tendered_satang · change_satang · reference (transRef เฟส 2) · verify_status (`manual`/`verified`/`pending`) · created_by · created_at | หลาย payment ต่อบิลได้ (เฟส 1 ใช้ 1) |
| `order_event` | id · order_id · seq (ต่อบิล) · device_id (null เมื่อ server เขียน) · chain_id (device id หรือ `server`) · chain_seq (ต่อโซ่) · type · payload_json · actor_type (`user`/`customer`/`system`) · actor_id · at · prev_hash · hash · **unique (order_id, seq)** · **unique (chain_id, chain_seq)** | type: `CREATED` `LINE_ADDED` `LINE_REMOVED` `DISCOUNT_APPLIED` `PAYMENT_CLAIMED` `PAID` `READY` `PICKED_UP` `CANCELLED` `REJECTED` `VOIDED` `STOCK_DEDUCTED` `STOCK_RETURNED` `NOTE` · โซ่แฮชแยกต่อ **ต้นทาง** (เครื่องขายแต่ละเครื่อง และ server เป็นอีกโซ่หนึ่ง) · แฮชครอบทุกคอลัมน์ตั้งแต่ order_id ถึง at (D38, สูตรใน §4.9) |
| `discount` | id · order_id · amount_satang · reason · approved_by | เฟส 1: ส่วนลดจำนวนเงินระดับบิล มีเหตุผล |

### 3.5 กะและเงินสด (T)
| ตาราง | ฟิลด์หลัก |
|---|---|
| `shift` | id · device_id · business_date · opened_by · opened_at · opening_float_satang · closed_by · closed_at · status |
| `cash_movement` | id · shift_id · kind (`PAID_IN`/`PAID_OUT`/`DROP`/`VOID_REFUND`) · amount_satang · order_id (เฉพาะ VOID_REFUND) · reason · created_by · created_at — `PAID_IN`/`PAID_OUT`/`DROP` คนบันทึกเอง · `VOID_REFUND` ระบบบันทึกอัตโนมัติตอนยกเลิกบิลเงินสด (D36) |
| `cash_count` | id · shift_id · counted_satang · expected_satang · variance_satang · reason · lines_json (ธนบัตร/เหรียญ × จำนวน) · counted_by |
| `z_report` | id · shift_id · snapshot_json · hash · created_at — **สร้างครั้งเดียว ไม่คำนวณใหม่** |

### 3.6 ระบบ
| ตาราง | ประเภท | ฟิลด์หลัก |
|---|---|---|
| `audit_log` | R (server) + L | id · entity · entity_id · action · before_json · after_json · actor_user_id · at — ใช้กับข้อมูลหลัก (ราคา สูตร สินค้า BOM ผู้ใช้ ตั้งค่า) |
| `outbox` | L | id · table · row_json · idempotency_key · created_at · attempts · last_error · sent_at |
| `sync_state` | L | key · value — cursor ล่าสุดของแต่ละตาราง R · เวลา sync ล่าสุด |
| `idempotency_record` | server | key · first_seen_at · result_hash |
| `server_cursor` | server | ทุกตาราง R มีคอลัมน์ `server_seq` (bigserial) สำหรับ pull แบบเพิ่ม |
| `invariant_run` | server | id · ran_at · results_json · has_failure |
| `equipment` | R | id · code · name · purchased_at · price_satang · qty · supplier · life_months (จำนวนเต็ม = ปีในไฟล์ × 12 ไม่ปัดทิ้ง, D37) · condition · owner · note (นำเข้าจากไฟล์ ไม่กระทบต้นทุนต่อแก้ว) |

---

## 4. กฎการคำนวณ (packages/domain)

ทุกฟังก์ชันเป็น pure function รับข้อมูลเข้า คืนผลลัพธ์ ไม่แตะ I/O · ทุกข้อมีเทสต์ property-based

### 4.1 ราคาและยอดบิล
- `priceFor(variant, channel, at)` → แถว `price` ที่ `effective_from ≤ at` ล่าสุด · ไม่พบ → error (ห้ามขายของไม่มีราคา)
- `lineTotal = unit_price × qty` · `subtotal = Σ lineTotal` · `total = subtotal − discount` · `discount ≤ subtotal`
- VAT ปิด: `vat = 0` · เมื่อเปิด (อนาคต): ราคารวม VAT, `vat = round(total × rate / (10000 + rate))` แบ่งตามบรรทัดด้วย largest-remainder
- ทอนเงิน: `change = tendered − total ≥ 0`
- Invariant: `Σ line_total − discount = total` ทุกบิล · `Σ payment.amount = total` เมื่อ status = paid

### 4.2 การตัดสต็อก (ตอน `PAID`)
```
for line in order.lines:
  recipe = recipeFor(line.variant, line.sweetness)      // version ที่ is_current ตอนขาย → บันทึก recipe_id ในบรรทัด
  for rl in recipe.lines:
    need = rl.qty_milli × line.qty
    explode(rl.item, need)

explode(item, need):
  if item.kind == 'packaging_set':          // ชุดแก้ว → ส่วนประกอบ
    for c in bom(item).lines: explode(c.item, c.qty × need / bom.yield)
  else if item.kind == 'prepared' and item.is_tracked:
    movement(SALE, item, −need, avg_cost(item))   // ตัดจากสต็อกเบส (ทำเบสไว้แล้ว)
  else if item.kind == 'prepared' and !item.is_tracked:
    for c in bom(item).lines: explode(c.item, c.qty × need / bom.yield)  // ระเบิดถึงของดิบ
  else:                                      // raw
    movement(SALE, item, −need, item.is_tracked ? avg_cost : standard_cost)
```
- เบส 7 ตัวเป็น `prepared` + `is_tracked=true` → ถ้าลืมบันทึกทำเบส สต็อกเบสจะติดลบ → **อนุญาตให้ติดลบ** แต่ขึ้นเตือนในหน้าสต็อกและรายงานส่วนต่าง (ห้ามบล็อกการขาย)
- ต้นทุนต่อบรรทัด `unit_cost_satang = round(Σ need_milli × cost_usat / 1,000,000,000 / qty)` บันทึกเป็น snapshot · **ปัดเศษครั้งเดียวจากผลรวมเต็มความละเอียด** (BigInt) ห้ามปัดทีละวัตถุดิบแล้วค่อยรวม และห้ามหาร qty ก่อนปัด — การปัดทีละวัตถุดิบทำให้ต่างจาก Excel ~1/3 ของสูตร
- Invariant: ทุกบิล `paid` ต้องมี movement kind `SALE` ref ถึงบิล และ Σ ปริมาณตรงกับ recipe ที่ระบุ (ตรวจย้อนได้เพราะ recipe มี version)

### 4.3 ยกเลิกบิล
- ก่อนชำระ: status `open` → ลบตะกร้าได้ (บันทึก event `LINE_REMOVED`; บิลที่ยังไม่ paid และไม่มีบรรทัดจะไม่ได้เลขที่บิล)
- หลังชำระ: ต้องใส่เหตุผล + owner PIN + ตอบ "ทำเครื่องดื่มไปแล้วหรือยัง"
  - ยังไม่ทำ → movement `VOID_RETURN` (+ปริมาณเดิม ต้นทุนเดิม)
  - ทำแล้ว → **ไม่มี movement เพิ่ม** (ของถูกใช้ไปแล้วตาม SALE เดิม) · event `VOIDED` มี marker `waste` เพื่อรายงานของเสีย (D39)
- เงิน: ยกเลิกเงินสด = คืนเงินสดจากลิ้นชัก → ระบบบันทึก `cash_movement` kind **`VOID_REFUND`** อัตโนมัติ (อ้าง order_id ของบิล · แยกจาก `PAID_OUT` ที่คนบันทึกเอง, D36) · ยกเลิก QR = บันทึกว่าโอนคืนแล้ว (อ้างอิงใส่เอง)
- บิลที่ยกเลิก **ยังคงอยู่ในรายงานยอดขายรวม (gross) และแยกเป็นยอดยกเลิก** ไม่หายไป

### 4.4 ต้นทุนถัวเฉลี่ยเคลื่อนที่
- ของดิบ: เมื่อ `PURCHASE` เข้า `avg = (on_hand × avg + qty × unit_cost) / (on_hand + qty)` (ถ้า on_hand ≤ 0 ให้ avg = unit_cost ใหม่)
- ต้นทุนมาตรฐาน (`standard_cost`) ของของดิบ = **ต้นทุนเฉลี่ยจากบันทึกซื้อในไฟล์ร้าน** (D34 · ตรงกับที่ Excel ใช้คิดทุกสูตร) · ของเบส/ชุดบรรจุภัณฑ์ = roll-up จาก BOM
- **ก่อนมีของเข้าครั้งแรก** (ยังไม่มี movement ใดของ item นั้น): avg = `standard_cost` → ขาย/ทำเบสก่อนรับของก็คิดต้นทุนได้ถูก
- ทำเบส (`production_batch`): `PRODUCE_OUT` ทุกส่วนประกอบที่ราคาเฉลี่ยขณะนั้น → `batch_cost = Σ` → `PRODUCE_IN` เบส qty = yield_actual, unit_cost = batch_cost / yield_actual → เข้าถัวเฉลี่ยของเบส
- `item_cost_state` เป็นแคช · ฟังก์ชัน `rebuild(item)` ไล่ movement ตั้งแต่ต้น (ใช้ตรวจ invariant)

### 4.5 นับสต็อกและส่วนต่าง
- ใบนับบันทึก `expected_use_milli` = on_hand ณ เวลาเปิดใบนับ (freeze) · ผู้นับใส่จำนวนเป็นหน่วยซื้อ (3.5 ถุง) → แปลง
- ปิดใบนับ → สร้าง `COUNT_ADJ` = counted − expected ต่อรายการ ที่ราคาเฉลี่ย · `variance_satang` เก็บไว้เป็นรายงาน
- รายงานส่วนต่าง: ต่อสัปดาห์ ต่อรายการ เป็น % และบาท · จัดอันดับของที่หายมากสุด

### 4.6 หมดอายุของเบส
- `production_batch.expires_at = created_at + shelf_life_hours` · หน้าสต็อกแสดงเบสที่หมดอายุ · ผู้ใช้กด "ทิ้ง" → `EXPIRED` movement เท่ากับยอดคงเหลือของเบสนั้น (เฟส 1 ไม่ทำ FIFO ต่อ batch; คงเหลือของเบสเป็นก้อนเดียว)

### 4.7 เลขที่บิลและเลขคิว
- `receipt_no = prefix + '-' + zeroPad6(counter)` counter ต่อ `device` เพิ่มทีละ 1 ใน transaction เดียวกับการสร้างบิลที่ได้เลข (ตอน `PAID`) · **ไม่มีช่องว่าง ไม่มีซ้ำ** (invariant ตรวจรายคืน)
- `queue_no` รีเซ็ตทุก business_date เริ่ม 1 · แสดงตัวใหญ่หน้าจอ
- `business_date` = วันที่ของ shift ที่เปิดอยู่ (ไม่ใช่นาฬิกา) → ขายหลังเที่ยงคืนยังเป็นวันเดิม

### 4.8 กะ / X / Z
- เปิดกะ: ใส่เงินทอน · ปิดกะ: นับธนบัตร → `expected = opening + cash_sales − void_refunds + paid_in − paid_out − drops` (D36: `cash_sales` = ยอดรับเงินสดของบิลที่ชำระในกะ รวมบิลที่ยกเลิกภายหลัง · `void_refunds` = Σ `VOID_REFUND` · `paid_out` = Σ `PAID_OUT` ที่คนบันทึกเอง — แต่ละแถวนับครั้งเดียว) → variance · เกิน `cash.variance_alert_satang` ต้องใส่เหตุผล
- X = คำนวณสดจากข้อมูลได้ตลอด · Z = snapshot JSON + hash ตอนปิดกะ ห้ามคำนวณใหม่ · Grand total สะสมอยู่ใน Z ถัดไป (Z(n).grand = Z(n−1).grand + ยอดกะนี้)
- ห้ามเปิดกะใหม่ถ้ากะเดิมยังไม่ปิด · ห้ามขายถ้าไม่มีกะเปิด (ยกเว้น owner กด "เปิดกะด่วน" = เปิดด้วยเงินทอน 0 พร้อม event)

### 4.9 แฮชโซ่ของ event
- `hash = sha256hex(prev_hash + "\n" + canonicalJSON({ chain_id, chain_seq, order_id, seq, device_id, type, payload, actor_type, actor_id, at }))` (D38 · canonicalJSON เรียง key · ชื่อ key ในโค้ดเป็น camelCase ตาม `EventCore`) · event แรกของโซ่ใช้ `prev_hash` = `0` × 64
- โซ่แยกตาม `chain_id` (เครื่องขายแต่ละเครื่อง / `server`) · `prev_hash` = hash ของ event ก่อนหน้า **ในโซ่เดียวกัน** (ทุกบิล) · `chain_seq` ต้องต่อเนื่อง 1, 2, 3, … ไม่มีช่องว่าง · `seq` นับต่อบิล
- เซิร์ฟเวอร์ตรวจโซ่ตอนรับ และงานรายคืนตรวจทั้งหมด
- ใครแก้แถวเก่าใน DB ตรง ๆ → โซ่ขาด → invariant fail → แจ้งเตือน

---

## 5. หน้าจอ (apps/pos)

| หน้า | ใคร | รายละเอียดสำคัญ |
|---|---|---|
| **ขาย** | ทุกคน | ซ้าย: กริดเมนูแยกแท็บหมวด (ปุ่มใหญ่ ≥ 64 px) · แตะเมนู → popup เลือกขนาด (ค่าเริ่มต้น 16 oz) และความหวาน (ค่าเริ่มต้น 50%) · ขวา: ตะกร้า + ยอดรวม · ปุ่ม "เงินสด" / "QR" · ทำงานได้ด้วยมือเดียวบนแท็บเล็ตแนวนอนและมือถือแนวตั้ง |
| ชำระเงินสด | | ปุ่มเร็ว: พอดี / 50 / 100 / 500 / 1000 · แสดงเงินทอนตัวใหญ่ |
| ชำระ QR | | สร้าง QR PromptPay (Tag 29 ใส่ยอด) เต็มจอ · ปุ่ม "ได้รับเงินแล้ว" (ยืนยันเอง) · เฟส 2 เพิ่มช่องวางสลิป |
| หลังชำระ | | เลขคิวตัวใหญ่ + รายการ (สำหรับคนทำเครื่องดื่มมองข้าม) · ปิดอัตโนมัติ 5 วิ |
| ประวัติบิล | | รายการวันนี้ · เปิดดู · ยกเลิก (owner PIN) · ดู event timeline |
| **ทำเบส** | ทุกคน | เลือกเบส → ใส่ตัวคูณ/ปริมาณ → แสดงส่วนประกอบที่ต้องใช้ (จาก BOM) → ยืนยัน → ใส่ yield จริง (ค่าเริ่มต้น = มาตรฐาน) · แสดงเบสที่มีอยู่และเวลาหมดอายุ · ปุ่ม "ทิ้ง" |
| **รับของเข้า** | ทุกคน | เลือกสินค้า (ค้นหา/หมวด) · จำนวนหน่วยซื้อ · ราคารวม · ร้าน · ถ่ายรูปใบเสร็จ (เก็บใน OPFS → อัปโหลดตอน sync) |
| **นับสต็อก** | ทุกคน | เลือกชุดนับ ("ของดิบหลัก" 10 รายการ / ทั้งหมด) · กรอกเป็นหน่วยซื้อ + เศษ · ปิดใบนับ → ส่วนต่าง |
| ปรับสต็อก | ทุกคน | ของเสีย / หมดอายุ / ทดลองสูตร / อื่น ๆ + เหตุผล |
| **สต็อก** | ทุกคน | คงเหลือ · สถานะ (ปกติ/ใกล้หมด/หมด/ติดลบ) · มูลค่า · "ต้องสั่งซื้อ" · เบสหมดอายุ |
| เปิด/ปิดวัน | ทุกคน (ปิดวันต้อง owner) | เงินทอน · นับธนบัตร (ตาราง 1000/500/100/50/20/10/5/2/1) · ส่วนต่าง · Z report |
| **รายงาน** | owner | ยอดขาย (วัน/สัปดาห์/เดือน/ช่วง) · ต่อเมนู/ขนาด/ความหวาน · margin · ยกเลิก/ส่วนลด · ส่วนต่างสต็อก · มูลค่าสต็อก · รายรับสะสม 12 เดือนเทียบเกณฑ์ 1.8 ล้าน · export CSV |
| จัดการเมนู | owner | เมนู · ขนาด · ราคาต่อขนาด (มีผลวันที่) · เปิด/ปิดเมนู · แสดงต้นทุน/แก้วและ GP % ปัจจุบัน + เตือนต่ำกว่า 60/55% |
| จัดการสูตร | owner | ตาราง 5 ระดับหวาน × วัตถุดิบ ต่อ (เมนู, ขนาด) · ปุ่ม "สร้าง 20/22 oz จาก 16 oz ด้วยตัวคูณ" · บันทึก = version ใหม่ |
| จัดการสินค้า | owner | สินค้า · หน่วยซื้อ · จุดสั่งซื้อ · is_tracked · ต้นทุนมาตรฐาน (D34) · BOM เบส |
| ผู้ใช้/ตั้งค่า | owner | ผู้ใช้ + PIN · อุปกรณ์ · ตั้งค่า · สถานะ sync (ค้างส่งกี่รายการ · ล่าสุดเมื่อไร · dead-letter) |
| อุปกรณ์ | owner | ทะเบียน + ค่าเสื่อม/เดือน (ข้อมูลประกอบ) |

การล็อกอิน: เลือกชื่อ → ใส่ PIN 4–6 หลัก · ล็อกอัตโนมัติหลังไม่ใช้ 10 นาที (ตั้งได้) · เปลี่ยนคนขายกลางวันได้โดยไม่ปิดกะ

---

## 6. Offline-first และ sync

### 6.1 หลัก
- SQLite ในเครื่องคือแหล่งความจริงของธุรกรรม · ทุกการเขียนเป็น transaction เดียว: แถวธุรกรรม + movement + event + แถว outbox
- **push**: ส่ง outbox เป็นชุด (FIFO, ≤ 200 แถว) ไป `POST /sync/push` พร้อม `idempotency_key` ต่อแถว (= row id) · เซิร์ฟเวอร์ insert-if-absent, ตรวจโซ่แฮช, ตรวจยอดด้วย domain ซ้ำ, ตอบรายการที่รับแล้ว/ปฏิเสธ · ปฏิเสธ (เช่น schema ไม่ตรง) → ย้ายไป dead-letter แสดงในหน้าตั้งค่า **ไม่บล็อกรายการถัดไปที่ไม่เกี่ยวกัน**
- **pull**: `GET /sync/pull?table=…&since=server_seq` ต่อตาราง R · เซิร์ฟเวอร์ชนะเสมอ (ข้อมูลหลักแก้ที่ back office ซึ่งเขียนตรงไปเซิร์ฟเวอร์เมื่อออนไลน์)
- **แก้ข้อมูลหลักตอนออฟไลน์**: ไม่อนุญาตในเฟส 1 (ปุ่มจัดการเมนู/สินค้าต้องออนไลน์) — ตัดปัญหา conflict ทั้งหมด
- ไม่ใช้ CRDT · ไม่มี last-write-wins บนธุรกรรม

### 6.2 จังหวะ sync (ผูกกับโฮสติ้งฟรี D15)
- มีกะเปิด: push ทันทีเมื่อ outbox มีของ (debounce 5 วิ) + pull ตาราง R ทุก `sync.interval_sec` (ค่าเริ่มต้น 300) + **เช็คออเดอร์ LINE ขาเข้าทุก 30 วิ** ผ่าน `GET /sync/inbox-flag` (อ่าน flag ในหน่วยความจำของ API ไม่แตะ DB) → ถ้ามีจึง pull จริง · fallback pull จริงทุก 5 นาทีเผื่อ API restart
- ไม่มีกะเปิด: push ค้างให้หมดหลังปิดกะ แล้ว **หยุด** · เปิดแอปตอนปิดร้าน = pull ครั้งเดียว · LIFF แสดง "ร้านปิด" เมื่อไม่มีกะเปิดหรือกด "หยุดรับออเดอร์ LINE"
- รูปใบเสร็จ/สลิปอัปโหลดแยกหลังแถวข้อมูล (ไม่บล็อกธุรกรรม)

### 6.5 ออเดอร์ที่เซิร์ฟเวอร์เป็นต้นทาง (LINE)
- เซิร์ฟเวอร์สร้าง `order(origin=server, status=pending_payment)` + `order_line` + `order_event CREATED` (โซ่แฮชของ server) · แท็บเล็ต pull ลงมาเป็นแถวธุรกรรมปกติ
- **การเปลี่ยนสถานะทุกครั้งหลังจากนั้นเกิดที่แท็บเล็ต** (paid → ready → picked_up / rejected) แล้ว push ขึ้นเหมือนบิลหน้าร้าน · ยกเว้น `PAYMENT_CLAIMED` (ลูกค้ากด "โอนแล้ว") และ `CANCELLED` อัตโนมัติ (หมดเวลา 15 นาที) ที่เซิร์ฟเวอร์เขียนเอง
- ป้องกันชนกัน: แท็บเล็ตจะรับออเดอร์ที่ status ≥ paid ไม่ได้ถ้าเซิร์ฟเวอร์ยกเลิกไปแล้ว → กด "รับเงินแล้ว" ต้องออนไลน์และให้เซิร์ฟเวอร์ยืนยันก่อน (เป็นข้อยกเว้นเดียวของ offline-first เพราะออเดอร์นี้มาจากเน็ตอยู่แล้ว)

### 6.3 นาฬิกา
- ใช้ `created_at` ของเครื่อง + `server_received_at` ที่เซิร์ฟเวอร์ · ลำดับใช้ `chain_seq` ต่อโซ่ (เครื่อง) และ `seq` ต่อบิล ไม่ใช้เวลาเปรียบเทียบ · เตือนถ้าเวลาเครื่องต่างจากเซิร์ฟเวอร์ > 5 นาที

### 6.4 ติดตั้ง/กู้คืนเครื่องใหม่
- เครื่องใหม่: ล็อกอิน owner → ลงทะเบียน device (prefix ใหม่) → pull ทุกตาราง R + `item_cost_state` ล่าสุด → พร้อมขาย · ไม่ดึงประวัติธุรกรรมทั้งหมดลงเครื่อง (ดึงแค่ 30 วันเพื่อหน้าประวัติ)
- แท็บเล็ตพัง: ข้อมูลที่ยังไม่ push หาย → รายงานให้เห็นชัดว่า sync ล่าสุดเมื่อไร (ความเสี่ยงที่ยอมรับ D6)

---

## 7. เซิร์ฟเวอร์ (apps/api)

| โมดูล | endpoint | หมายเหตุ |
|---|---|---|
| Auth | `POST /auth/device` (device token) · `POST /auth/pin` | token อายุยาวต่อเครื่อง · PIN ตรวจในเครื่องได้ตอนออฟไลน์ (pin_hash sync ลงมา) |
| Sync | `POST /sync/push` · `GET /sync/pull` | ตาม §6 |
| Admin | CRUD ข้อมูลหลัก (เมนู ราคา สูตร สินค้า BOM ผู้ใช้ ตั้งค่า) — ทุกการแก้เขียน `audit_log` | ต้องออนไลน์ |
| Reports | `GET /reports/*` | ใช้ SQL บน Postgres · มือถือแฟนใช้ที่นี่ |
| Jobs | `POST /jobs/nightly` (เรียกจาก scheduler ด้วย secret) · `POST /jobs/expire-orders` (ทุก 5 นาที) | ตรวจ invariant → `invariant_run` → ถ้า fail ส่ง push ถึงเจ้าของผ่าน LINE OA (นับในโควตา 300) หรืออีเมล |
| LINE | `POST /line/webhook` (ตรวจ signature, ตอบ 200 ทันที, ประมวลผล async) · `POST /line/auth` (ID token → verify กับ LINE → customer) · `GET /line/menu` · `POST /line/orders` · `GET /line/orders/:id` · `POST /line/orders/:id/claim-payment` | ใช้ `packages/domain` คำนวณราคา · เขียน flag "มีออเดอร์ใหม่" ในหน่วยความจำ · reply message เท่านั้น (พิมพ์ "เมนู"/"สั่ง" → reply ลิงก์ LIFF) |
| Health | `GET /health` (ไม่แตะ DB) · `GET /sync/inbox-flag` (ไม่แตะ DB) | ถูก ping ทุก 10 นาที |

**Invariant รายคืน** (ทั้งหมดต้องเป็นจริง)
1. ทุกบิล: `Σ line_total − discount = total` · บิล paid: `Σ payment = total`
2. `receipt_no` ต่อ device ต่อเนื่องไม่มีช่องว่าง/ซ้ำ
3. โซ่แฮช `order_event` ต่อ device ครบและถูกต้อง
4. ทุกบิล paid มี movement `SALE` และปริมาณตรง recipe version ที่อ้าง
5. `item_cost_state.on_hand` = Σ movement.qty ต่อ item (rebuild แล้วเทียบ)
6. Z report ของทุกกะที่ปิดแล้ว hash ตรงกับ snapshot
7. ไม่มีธุรกรรม `business_date` ที่ไม่มี shift
8. ทุก recipe ที่ `is_current` มีครบ 5 ระดับหวานต่อ variant ที่ active

---

## 8. การทดสอบ

| ระดับ | เครื่องมือ | ครอบคลุม |
|---|---|---|
| Property-based | Vitest + fast-check | ยอดบิล/ส่วนลด/VAT proration · การตัดสต็อกไม่สร้างหรือทำลายปริมาณ (Σ explode = Σ recipe) · ถัวเฉลี่ยไม่ติดลบ/ไม่ NaN · โซ่แฮชตรวจจับการแก้ 1 ไบต์ · counter เลขที่บิลไม่ซ้ำภายใต้ retry |
| **Golden test จาก Excel** | Vitest | นำเข้า 360 สูตร + ต้นทุนมาตรฐาน (D34) → คำนวณต้นทุน/แก้วทุกแถว **ต้องตรงกับคอลัมน์ในไฟล์เป๊ะทุกสตางค์** (ปัดครั้งเดียวจากผลรวม §4.2 · ห้ามผ่อนเป็น ±) · ต้นทุนเบส 7 ตัวตรงกับชีต "ต้นทุนเบส" เป๊ะระดับ usat · ทำซ้ำหลัง seed ลงฐานข้อมูล (อ่านจาก DB แล้วต้องได้ค่าเดียวกัน) |
| Schema parity | Vitest | Drizzle sqlite vs pg: ชื่อตาราง/คอลัมน์/ชนิด/NOT NULL/FK ตรงกันทุกตัว |
| Unit | Vitest | NestJS services · sync push/pull idempotency (ส่งซ้ำ 3 ครั้งได้ผลเดียว) |
| E2E | Playwright | ขาย → ชำระ → ตัดสต็อก → ยกเลิก → ปิดกะ → Z · ออฟไลน์ (route.abort) → ขายต่อ → ออนไลน์ → sync ครบ |
| Spike (ก่อนเริ่ม) | มือ | SQLite WASM/OPFS ทน reload/ปิดแอปบน Chrome Android + Safari iPad · Drizzle ใน Worker กับ transaction · persistent storage permission |

---

## 9. นำเข้าจาก Excel (packages/excel-import)

| ชีต | → ตาราง | จำนวน | กฎ |
|---|---|---|---|
| Lists | category, size, sweetness_level, channel | — | หมวดหน้าจอกำหนดใหม่: ชาไทย / ชาเขียว / มัทฉะพรีเมียม (ดู Q23) |
| ต้นทุนและราคา (ตารางล่าง) | product, product_variant, price | 24 / 72 / 72 | price channel = หน้าร้าน, effective_from = วันนำเข้า |
| สินค้าและสต็อก | item (raw), purchase_unit | 35 / 35 | standard_cost = คอลัมน์ "ต้นทุนเฉลี่ยต่อหน่วยซื้อ" ÷ หน่วยใช้ (D34) · **is_tracked=false (D29):** RM-WTR-01 น้ำแข็ง · RM-WTR-02 น้ำสะอาด · RM-WTR-03 น้ำดื่มถัง · RM-SEA-01 เกลือ · **นับสต็อก:** PK-STR-01 หลอด · PK-LBL-01 สติกเกอร์ และที่เหลือทั้งหมด รวม OT-SUP-01/02 ถุงมือ/ปากกา (D35) |
| ต้นทุนเบส (tblIng) | item (prepared / packaging_set) | 7 + 3 | ตัวแทน 1:1 (นมสด → RM-MLK-01) **ไม่สร้าง item ใหม่** ให้ recipe อ้างของดิบตรง · เบส 7 ตัว is_tracked=true · ชุดบรรจุภัณฑ์ 3 ชุด is_tracked=false · standard_cost = roll-up จาก BOM (เช่น ชาไทยเบส 2,000,000 usat/ml) |
| ต้นทุนเบส (tblBOM) + เบสและซับสูตร | bom, bom_line | 10 (7 เบส + 3 ชุดบรรจุภัณฑ์) / 33 | yield/อายุจากชีตเบส |
| ข้อมูลสูตร | recipe, recipe_line | 360 / 2,211 | ข้ามค่า 0 · น้ำแข็ง/น้ำเป็น item raw is_tracked=false · บรรจุภัณฑ์อ้าง packaging_set ตามขนาด |
| ทะเบียนอุปกรณ์ | equipment | 32 | life_months = ปี × 12 ต้องเป็นจำนวนเต็ม ไม่งั้นนำเข้าไม่ผ่าน (D37) |
| Dashboard / R&D / SOP / มัทฉะพรีเมียม / เคล็ดลับ | ไม่นำเข้า | | |

สคริปต์ต้อง idempotent (รันซ้ำได้ผลเดิม) และสร้างรายงานความต่างถ้าไฟล์เปลี่ยน

---

## 10. โฮสติ้งและปฏิบัติการ (สรุปจาก research 10 + 11 · ไม่ผูกบัตร)

- PWA: Cloudflare Pages · API: **Render free web service (Singapore)** 1 service · ping `/health` ทุก 10 นาทีจาก cron-job.org หรือ UptimeRobot ⚠️ · DB: Neon free Singapore · secrets ใน Render env
- CI: GitHub Actions — lint · typecheck · test · schema parity · build · deploy (main → Render auto-deploy; ไม่มี staging ในเฟส 1 แต่ใช้ Neon branch ทดสอบ migration)
- Backup: GitHub Actions cron 02:00 ICT → `pg_dump` → R2 เก็บ 30 วัน + ทุกวันที่ 1 เก็บ 12 เดือน · ทดสอบ restore เดือนละครั้ง
- Migration: Drizzle migrations · รันบน Neon branch ก่อน → main · ฝั่งเครื่อง: migration ฝังในแอป รันตอนเปิดแอปก่อน sync
- Monitoring: Render logs · Neon usage alert 80 CU-h · Render instance hours (ต้อง < 750) · หน้า "สถานะระบบ" ในแอปแสดง sync/invariant/ping ล่าสุด
- ทางหนี: ถ้า Render ระงับการ ping → ย้าย `/line/webhook` ไป Cloudflare Workers (ส่งต่อ + ตอบ 200) และยอมให้ API หลับ (LIFF ช้าตอนตื่น) · ถ้ายอมผูกบัตรวันหน้า → Cloud Run

---

## 11. ลำดับการสร้าง (เฟส 1)

| ขั้น | ผลลัพธ์ที่ใช้ได้จริง | ขึ้นกับ |
|---|---|---|
| 0 | Spike 3 ข้อ (§8) ผ่าน · monorepo + CI ว่าง ๆ รันได้ | — |
| 1 | `packages/domain` + เทสต์: ราคา ยอดบิล ตัดสต็อก ถัวเฉลี่ย เลขที่บิล แฮช · `excel-import` + golden test 360 สูตรผ่าน | 0 |
| 2 | `db-schema` 2 dialect + parity test · migration แรก · seed จาก Excel | 1 |
| 3 | `apps/pos` ขายได้ในเครื่อง (ล็อกอิน · เปิดกะ · ขาย · เงินสด/QR · ตัดสต็อก · ประวัติ · ยกเลิก · ปิดกะ/Z) **ยังไม่มีเซิร์ฟเวอร์** — ใช้ได้จริงที่ร้านแล้ว | 2 |
| 4 | สต็อก: ทำเบส · รับของ · นับ · ปรับ · หน้าสต็อก · เตือน | 3 |
| 5 | `apps/api` + sync + admin + deploy Render/Neon + ping + backup | 2 |
| 6 | **สั่งผ่าน LINE**: LIFF โหมดลูกค้า · LineModule · แถบออเดอร์ LINE บนแท็บเล็ต · หมดเวลาอัตโนมัติ | 5 |
| 7 | รายงาน (ในเครื่องสำหรับวันนี้ · เซิร์ฟเวอร์สำหรับช่วงยาว) · โหมดดูรายงานบนมือถือ | 5 |
| 8 | งานตรวจ invariant รายคืน + แจ้งเตือน · หน้าสถานะระบบ · E2E ครบ | 5 |

ขั้น 3 คือจุดที่เริ่มใช้ขายจริงได้ ก่อนมีเซิร์ฟเวอร์ (สำรองข้อมูลด้วย export ไฟล์ SQLite ทุกคืนชั่วคราว)

---

## 12. ความเสี่ยงที่ยอมรับ

| ความเสี่ยง | การรับมือ |
|---|---|
| แท็บเล็ตพังก่อน sync | หน้าจอแสดง "ยังไม่ส่ง N รายการ" ตลอดเวลา · sync ทันทีเมื่อมีของ |
| ลืมบันทึกทำเบส → สต็อกเบสติดลบ | ไม่บล็อกการขาย · แจ้งเตือน · นับสต็อกรายสัปดาห์ปรับ |
| Neon เกิน 100 CU-ชม. | หยุด sync ตอนปิดร้าน · ping/poll ไม่แตะ DB · เตือนที่ 80 · fallback Supabase |
| Render หลับ/ถูกระงับการ ping | ping ทุก 10 นาที · เฝ้า instance hours · ทางหนี Cloudflare Workers สำหรับ webhook |
| ลูกค้า LINE สั่งแล้วไม่จ่าย | ไม่ทำจนกว่าร้านกด "รับเงินแล้ว" · หมดเวลา 15 นาทียกเลิกอัตโนมัติ |
| โควตา push 300/เดือนหมด | ระบบนับเอง ปิด push อัตโนมัติ · ลูกค้าดูสถานะใน LIFF ได้เสมอ |
| QR ยืนยันด้วยตาผิดพลาด | เฟส 2 ตรวจสลิป · ในระหว่างนี้ปิดวันเทียบยอด QR กับแอปธนาคาร |
| schema 2 dialect เพี้ยน | parity test ใน CI |

---

## 13. สั่งผ่าน LINE (D25) — 🟡 รอยืนยัน Q31–Q34

ข้อมูลประกอบ: [../../research/11-สั่งผ่าน-LINE.md](../../research/11-สั่งผ่าน-LINE.md)

### 13.1 ฝั่งลูกค้า (PWA โหมดลูกค้า เปิดใน LINE ผ่าน LIFF)
1. `liff.init` → ID token → `POST /line/auth` → เซิร์ฟเวอร์ verify กับ LINE → สร้าง/อัปเดต `customer` → session cookie/JWT อายุสั้น
2. หน้าเมนู: หมวด/เมนู/ขนาด/ความหวาน ราคาจาก `price` channel LINE OA (เฟส 1 = ราคาเดียวกับหน้าร้าน) · แสดง "ร้านปิด" ถ้าไม่มีกะเปิดหรือปิดรับ · ซ่อนเมนูที่ร้านกด "หมด"
3. ตะกร้า → "สั่งและจ่าย" → `POST /line/orders` → ได้ QR PromptPay ยอดตรงบิล + นับถอยหลัง 15 นาที
4. ลูกค้าโอน → กด "โอนแล้ว" (+ แนบสลิป) → `pending_verify`
5. หน้าสถานะ: รอตรวจเงิน → กำลังทำ (คิว 17) → พร้อมรับ → รับแล้ว · รีเฟรชเองทุก 15 วิ
6. ข้อความในแชท: พิมพ์อะไรก็ได้ → reply ปุ่มเปิด LIFF (ฟรี) · push "พร้อมรับแล้ว" 1 ข้อความ/ออเดอร์ ถ้าเปิดใช้และโควตายังเหลือ

### 13.2 ฝั่งร้าน (แท็บเล็ต)
- แถบ "ออเดอร์ LINE" ด้านบนหน้าขาย แสดงจำนวนรอตรวจ · เสียงเตือนเมื่อมีใหม่
- รายการ: ชื่อลูกค้า · รายการ · ยอด · เวลาที่เหลือ · สลิป (ถ้ามี) · ปุ่ม **รับเงินแล้ว** (ต้องออนไลน์; เซิร์ฟเวอร์ยืนยันว่ายังไม่ถูกยกเลิก) / **ปฏิเสธ** (เหตุผล)
- กด "รับเงินแล้ว" = เหมือนชำระ QR หน้าร้าน: ออก receipt_no · queue_no · ตัดสต็อก · event PAID
- หน้าจอคิว/ประวัติแสดงบิล LINE ปะปนกับหน้าร้าน (ไอคอนต่างกัน) · ปุ่ม "พร้อมรับ" · "รับแล้ว"
- ตั้งค่า: เปิด/ปิดรับออเดอร์ LINE · เวลาหมดอายุ (15 นาที) · เปิด/ปิด push "พร้อมรับ" · เมนูหมดชั่วคราว (`product.sold_out_until`)

### 13.3 กฎ
- ราคา/ต้นทุน/ตัดสต็อกใช้ฟังก์ชันเดียวกับหน้าร้าน (`packages/domain`) · เซิร์ฟเวอร์คำนวณยอดเอง ไม่เชื่อยอดจากเบราว์เซอร์ลูกค้า
- ออเดอร์ที่ไม่ paid ไม่กระทบสต็อกและไม่ได้เลขที่บิล · ยกเลิกอัตโนมัติไม่ต้องมีเหตุผล
- ปฏิเสธหลังจ่าย = บันทึกโอนคืนด้วยมือ (อ้างอิงใส่เอง) เหมือน void QR หน้าร้าน
- รายงานแยกช่องทาง LINE OA vs หน้าร้าน

## 14. คำถามที่ยังเปิด

ไม่มี — Q31–Q34 ตอบแล้ว (D32) · §13 เปลี่ยนเป็น 🟢
