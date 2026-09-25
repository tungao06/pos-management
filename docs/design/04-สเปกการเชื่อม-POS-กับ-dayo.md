# สเปกการเชื่อม POS กับ dayo-shop-system (สถาปัตยกรรม C1)

เขียนเมื่อ 25 ก.ย. 2026 · ผู้เขียน: architect ของ POS
สถานะ: **การตัดสินใจบันทึกแล้วใน D59–D78** (`00-บันทึกการตัดสินใจ.md`) · สเปกแก้ตามรีวิวรอบ 1 แล้ว (§13.2) · **ค้าง 1 ข้อ: Q54** (การพิสูจน์ตัวตน owner ของรายงานกำไร — §7 ข้อ 10) · สัญญาก้อน 1–2 ล็อกเมื่อเจ้าของรับรองฉบับนี้
ที่มา: คำตอบเจ้าของรอบ grilling 1–6 (Q1–Q37, 25 ก.ย. 2026) · `03-ประเมินสถาปัตยกรรม-POS-กับ-LINE-bot.md` §10–11 · โค้ดและ ADR ของ dayo ณ วันที่เขียน (migration ล่าสุด `0047_shop_settings.sql`, ADR ล่าสุด 0047)
ร่าง ADR ที่ต้องส่งให้ session ของ dayo: `dayo-adr-drafts/` (P1–P8)

คำที่ใช้ในเอกสารนี้
- **dayo** = ระบบ LINE bot + เว็บ (`D:\TungAo-Project\line-bot\dayo-shop-system`) · **ฐานกลาง** = Supabase ของ dayo
- **แท็บเล็ต** = แอป POS (`apps/pos`) · **ก้อน** = ก้อนงาน 1–6 ตาม §9
- **ล็อก** = ห้ามเปลี่ยนโดยไม่แก้สเปกนี้ก่อน + บันทึก D ใหม่ + แก้ร่าง ADR ที่เกี่ยวข้อง (ทั้งสองทีมทำตามสเปกนี้)
- ชื่อ ADR ของ dayo เขียนเป็น `ADR-00NN` · ร่างที่เสนอเขียนเป็น `P1`…`P8`

---

## 1. เป้าหมายและขอบเขต

**เป้าหมาย**
1. ยอดขายทุกช่องทาง (แท็บเล็ต บอท เว็บ) อยู่ในตาราง `orders` เดียวกันในฐานกลาง
2. แท็บเล็ตขายได้ตอนเน็ตหลุด แล้วส่งตามทีหลังโดยไม่มีบิลหาย ไม่มีบิลซ้ำจากการส่งซ้ำ
3. ราคาที่แท็บเล็ตคิด **เท่ากับที่ dayo คิดทุกสตางค์** เมื่อใช้แคตตาล็อกฉบับเดียวกัน · ส่วนต่างทุกขนาด (แม้ 1 สตางค์) ต้องมองเห็นได้ ไม่ใช่เฉพาะที่เกิน ฿1 (§4.3)
4. ทุกบิลบอกได้ว่าบันทึกที่ไหน (แหล่ง) และโดยใคร (พนักงาน)
5. POS เป็นเครื่องมือเรื่องเงินและบริหารร้าน: ขาย · กะ/เงินสด/นับเงิน/ใบปิดกะ · ค่าใช้จ่าย · ตอกบัตร/เงินเดือน — ตัวเลขทั้งหมดเก็บในฐานกลาง
6. ค่าโฮสต์ ฿0 ไม่ผูกบัตร (ADR-0036 ของ dayo · D15 ของ POS)

**อยู่ในขอบเขต**: สัญญา API ระหว่างแท็บเล็ตกับ dayo · ตารางใหม่ฝั่ง dayo · กติกาเงิน · ออฟไลน์/outbox · ความปลอดภัยของเครื่อง · สำรองข้อมูลอัตโนมัติ · ลำดับงาน 6 ก้อน

**ไม่อยู่ในขอบเขต**
- ลูกค้าสั่งเอง (LIFF, D25/D32) — เลื่อนออกไป (Q5)
- แท็บเล็ตขายพร้อมกันสองเครื่อง — มีเครื่องขาย 1 เครื่อง เครื่องที่สองเป็นเครื่องสำรอง (Q4)
- งานสต็อกบนแท็บเล็ต (รับของ ทำเบส นับ ปรับ) — ทำบนเว็บ dayo (Q11) · เบสที่ต้มไม่นับเป็นสต็อก (Q12)
- sync สองทางของข้อมูลชิ้นใดก็ตาม
- คำนวณภาษี/ประกันสังคมตามกฎหมาย — กรอกเองเป็นบรรทัด (Q28/Q33)

---

## 2. สถาปัตยกรรม

```
                      ┌──────────────────────── ฐานกลาง: Supabase (Postgres) ของ dayo ────────────────────────┐
                      │ เมนู สูตร ราคา โปร ช่องทาง วิธีชำระ พนักงาน สต็อก (แก้บนเว็บ)                         │
                      │ orders / order_items (ทุกแหล่ง) · ธงบิลซ้ำ · กะ เงินสด นับเงิน ใบปิดกะ · ค่าใช้จ่าย      │
                      │ ตอกบัตร เงินเดือน · audit_log · backup_log                                              │
                      └───────▲───────────────────────▲──────────────────────────────▲──────────────────────────┘
                              │ RPC (secret key)       │ RPC (secret key)             │ pg_dump ทุกคืน (อ่านอย่างเดียว)
              ┌───────────────┴─────────┐   ┌─────────┴──────────┐        ┌───────────┴────────────────┐
              │ Worker เว็บ dayo-web      │   │ Worker บอท          │        │ GitHub Actions (repo dayo) │
              │ /catalog /sales /stock … │   │ dayo-line-bot       │        │ เข้ารหัส → rclone → OneDrive │
              │ /api/v1/* (Bearer key)   │   └─────────▲──────────┘        │ ล้ม → Discord ช่องระบบ       │
              └───────────▲─────────────┘             │ LINE                 └────────────────────────────┘
                          │ HTTPS JSON (CORS)          พนักงานพิมพ์ขายในบอท
                          │  ▲ GET  /v1/pos/catalog   (แคตตาล็อก + พนักงาน + ฉบับ)  — ดึงอย่างเดียว
                          │  │ POST /v1/pos/push      (บิล ยกเลิกบิล · ก้อน 3–6: กะ เงินสด ค่าใช้จ่าย ตอกบัตร)
                          │  │ GET  /v1/orders        (บิลจากบอท/เว็บของวันนี้ ไว้ดูกันซ้ำ)
              ┌───────────┴──┴──────────────────────────────────────┐
              │ แท็บเล็ต POS (PWA บน Cloudflare Pages · Chrome Android)  │
              │ SQLite (OPFS): สำเนาแคตตาล็อก (อ่านอย่างเดียว) + บิล/กะ/เงินสด │
              │ ของตัวเอง + outbox · PIN ในเครื่อง · โซ่แฮชในเครื่อง           │
              │ ตัวคิดราคา = สำเนาโค้ด @dayo/shared ที่ปักรุ่น (§5)            │
              └───────────────────────────────────────────────────────┘
```

หลักการ (ล็อก)
1. **ฐานเซิร์ฟเวอร์เดียว** = Supabase ของ dayo · ไม่มีเซิร์ฟเวอร์ POS (เซิร์ฟเวอร์แผน 5 ไม่เข้า main — §11)
2. **ข้อมูลแต่ละแถวมีผู้เขียนคนเดียว** ที่อื่นอ่านอย่างเดียว · ไม่มี sync สองทาง
3. แท็บเล็ตเขียนลง SQLite ในเครื่องก่อนเสมอ แล้วส่งตามด้วย outbox · ทุกแถวมี UUID ที่เครื่องสร้างเป็นคีย์กันซ้ำ
4. แท็บเล็ตคุยกับ dayo ผ่าน `/api/v1/*` เท่านั้น (ไม่คุย Supabase ตรง — ADR-0035 "ทางเลือกที่ไม่เลือก")
5. งานหนักอยู่ใน RPC ของ Postgres · Route Handler ทำแค่ตรวจ key + เรียก RPC ก้อนเดียว (CPU 10 ms, subrequest ≤ 50 — ADR-0036)

---

## 3. ใครเป็นเจ้าของข้อมูลอะไร

| ข้อมูล | ผู้เขียน (คนเดียว) | ผู้อ่าน | เดินทางอย่างไร |
|---|---|---|---|
| เมนู ตัวแปร สูตร วัตถุดิบ เบส ตัวเลือก | เว็บ dayo (owner/manager — ADR-0034) · นำเข้าเทมเพลต (P8) | บอท เว็บ แท็บเล็ต | แท็บเล็ตดึง `GET /v1/pos/catalog` เมื่อ `catalog_version` เปลี่ยน |
| ราคา โปรโมชั่น ช่องทาง (บวก % / บวกบาท / ปัด / ค่าธรรมเนียม) วิธีชำระ ค่าเริ่มต้นการขาย | เว็บ dayo | บอท เว็บ แท็บเล็ต | เหมือนแถวบน (ก้อนเดียวกัน ฉบับเดียวกัน) |
| พนักงาน + บทบาท (`owner`/`manager`/`staff`) | เว็บ dayo (owner — ADR-0034) | บอท เว็บ แท็บเล็ต | ในก้อนเดียวกับแคตตาล็อก (Q9) |
| PIN ของพนักงาน | แท็บเล็ต | แท็บเล็ตเท่านั้น | ไม่ออกจากเครื่อง |
| สต็อก (รับเข้า นับ ของเสีย) | เว็บ dayo (+ บอท `รับ`) | เว็บ บอท | ไม่ผ่านแท็บเล็ต (Q11) |
| บิลที่ขายที่แท็บเล็ต + การยกเลิก | แท็บเล็ต | เว็บ (อ่านอย่างเดียว) บอท แดชบอร์ด | `POST /v1/pos/push` แถวชนิด `order` / `order_void` |
| บิลที่ขายที่บอท/เว็บ + การแก้/ยกเลิก | บอท/เว็บ (ADR-0029) | แท็บเล็ต (ดูกันซ้ำ + นับเงินสดตอนปิดกะ) | บอท/เว็บเขียนฐานกลางตรง · แท็บเล็ตอ่าน `GET /v1/orders` และ (ก้อน 3) `GET /v1/pos/shift-cash` |
| ธงบิลน่าจะซ้ำ | ฐานกลาง (ตรวจอัตโนมัติ) · owner ปิดธงบนเว็บ | เว็บ แท็บเล็ต | คำตอบของ push + `GET /v1/orders` |
| กะ เงินเข้า-ออกลิ้นชัก นับเงิน ใบปิดกะ (Z) | แท็บเล็ต | เว็บ (อ่าน + สรุป 1 บรรทัดบนแดชบอร์ด — Q20) | push ชนิด `shift_open` `cash_movement` `cash_count` `shift_close` (ก้อน 3) |
| ค่าใช้จ่าย | แท็บเล็ตเท่านั้น (Q46) | เว็บ (อ่าน + รายงานกำไรสุทธิ) | push ชนิด `expense` `expense_void` (ก้อน 4) |
| หมวดค่าใช้จ่าย | เว็บ dayo (owner) | แท็บเล็ต | ในก้อนแคตตาล็อก (ก้อน 4) |
| ต้นทุนเฉลี่ยเคลื่อนที่ของวัตถุดิบ | ฐานกลาง (คิดจากการรับเข้า) · owner ปรับเองได้พร้อมเหตุผล (Q49) | เว็บ | ไม่ส่งออก API รายวัตถุดิบ (ADR-0035 ข้อ 3) |
| รายงานกำไรสุทธิ (ยอดรวม) | ฐานกลาง (RPC คิด) | เว็บ (owner) · แท็บเล็ต **เฉพาะเมื่อผู้ล็อกอินเป็น owner** (Q45) | `POST /v1/pos/profit` (ก้อน 4) · ไม่เก็บในเครื่อง |
| ตอกบัตร อัตราค่าจ้าง ใบเงินเดือน | แท็บเล็ต | เว็บ (อ่าน) | push ชนิด `pay_profile` `time_punch` `time_punch_fix` `pay_sheet` (ก้อน 6) |
| โซ่แฮชของ event บิล (`order_event`) | แท็บเล็ต | แท็บเล็ต | ไม่ส่ง (Q23) · อยู่ในไฟล์สำรองของแท็บเล็ต |
| ไฟล์ `DA-YO_เมนู.xlsx` | — | ตัวนำเข้าครั้งแรกของ dayo | นำเข้าครั้งแรกครั้งเดียว (ADR-0025) · หลังจากนั้นใช้เทมเพลตของระบบ (P8) |

---

## 4. สัญญา API

### 4.1 ข้อกำหนดร่วม (ล็อก — ก้อน 1–2)

| เรื่อง | กติกา |
|---|---|
| ที่อยู่ | `https://<worker dayo-web>.workers.dev/api/v1` · แท็บเล็ตเก็บเป็นค่าตั้ง `dayoBaseUrl` |
| เปิด/ปิด | `/api/v1/**` ตอบ 404 เมื่อ `API_V1_ENABLED` ไม่ใช่ `1` (ADR-0042) · แท็บเล็ตแปลง 404 ที่ `/api/v1/*` เป็นสถานะ "ระบบกลางปิด API อยู่" ไม่ใช่ error ของแถว |
| ยืนยันตัว | `Authorization: Bearer <api_key>` · 1 เครื่อง = 1 key ในตาราง `api_clients` (§7) |
| scope ที่แท็บเล็ตขายต้องมี | `catalog:read` `staff:read` (ใหม่ — P1) `orders:read` `orders:write` · ก้อน 3: `shift:write` · ก้อน 4: `expense:write` · ก้อน 6: `payroll:write` · ไม่บังคับ (owner เปิดเอง): `reports:profit` (ก้อน 4 — Q45) |
| CORS | origin ที่อนุญาต = env `POS_ORIGINS` (คั่นด้วยจุลภาค) · **ทุกคำตอบใต้ `/api/v1/*` รวม error ทุกชนิด** (404 จากสวิตช์ `API_V1_ENABLED`, 401, 403, 422, 429, 5xx) มีหัว `Access-Control-Allow-Origin: <origin ที่ตรง>` + `Vary: Origin` + `Access-Control-Expose-Headers: Retry-After` · `OPTIONS` ตอบ **204 เสมอ** (แม้ API ปิด · ไม่แตะฐานข้อมูล) พร้อม `Access-Control-Allow-Headers: Authorization, Content-Type` · `Access-Control-Allow-Methods: GET, POST, OPTIONS` · `Access-Control-Max-Age: 7200` · origin ที่ไม่อยู่ในรายการ = ไม่มีหัว CORS · ทำที่จุดเดียวใน `apps/web/src/lib/api/response.ts` (`apiHandler` — ที่เดียวกับสวิตช์ 404) (P1) |
| อัตราคำขอ | 60 คำขอ/นาที/key (มีอยู่แล้ว — `api_authenticate`) · เกิน = 429 + `Retry-After` |
| รูปคำตอบ | `{ "ok": true, "data": … }` หรือ `{ "ok": false, "error": { "code": "DY422", "message": "…" } }` (เหมือนเดิม) |
| เวลา (ส่งเข้า) | ISO-8601 UTC มีมิลลิวินาที `2026-09-25T03:15:03.120Z` |
| เวลา (ส่งออก) | ISO-8601 (Postgres `timestamptz` แปลงเป็นข้อความ) · แท็บเล็ตต้อง parse ได้ทั้งแบบ `Z` และ `+00:00` |
| วันขาย | `YYYY-MM-DD` เวลาไทย (Asia/Bangkok) · ร้านปิดก่อนเที่ยงคืน (ADR-0024) |
| เงิน | บาท เป็นเลข JSON ทศนิยมไม่เกิน 2 ตำแหน่ง (`35`, `35.5`, `12.25`) — กติกาแปลงอยู่ §4.2 |
| เปอร์เซ็นต์ | **สองแบบ ห้ามสลับ**: ช่องทาง `priceMarkupPct` / `feePct` เป็น **สัดส่วน** (`0.30` = 30%) · ส่วนลดรายแก้ว/ทั้งบิล/โปร `percent` เป็น **ร้อยละ** (`10` = 10%) — ตามที่ dayo ใช้อยู่ (DATA-CONTRACT §2.4, §4.2–4.3) |
| ขนาด / ความหวาน | ข้อความตรงตัว `"16 oz"` `"20 oz"` / `"0%"` `"25%"` `"50%"` `"75%"` `"100%"` |
| ข้อความ | UTF-8 · ห้ามมีอักขระควบคุม C0 และ DEL · ความยาวนับเป็น code point · `reason`/`note` ≤ 200 · `description` ≤ 200 |
| id | UUID ตัวเล็ก รูป `8-4-4-4-12` · แถวที่แท็บเล็ตสร้าง ใช้ id ที่แท็บเล็ตสร้าง (UUIDv4 หรือ v7) |
| ความเข้ากันได้ | ฝั่งรับต้อง **ยอมรับฟิลด์ที่ไม่รู้จักในคำตอบ** และค่า `status`/`reason` ที่ไม่รู้จัก (ถือเป็นข้อความ — บทเรียนแผน 5 `ReceivedRowResult`) · ฟิลด์หรือชนิดแถวที่ dayo ยังไม่รู้จักในคำขอ = คำตัดสินรายแถว **`deferred UNSUPPORTED`** (ลองใหม่ได้เมื่อ dayo อัปเดต ไม่ใช่ rejected) · กติกาปล่อยรุ่น: **dayo deploy ก่อนเสมอ** แล้ว POS รุ่นที่ใช้ฟิลด์/ชนิดใหม่จึงขึ้นได้ · E1 ส่ง `supported_kinds` และ `supported_fields` (รายชื่อฟิลด์ของ `data` ต่อชนิด) · แท็บเล็ต **เก็บแถวรอ** (ไม่ใช่ rejected) จนกว่าชนิดและทุกฟิลด์ที่แถวใช้จะปรากฏในรายการ |

**endpoint เดิม** (`GET /v1/catalog`, `GET /v1/promotions`, `POST /v1/orders`, `PATCH /v1/orders/{order_no}`, `GET /v1/stock`, `POST /v1/stock/movements`) คงอยู่ไม่เปลี่ยน · **แท็บเล็ตไม่ใช้** ยกเว้น `GET /v1/orders` (ขยายฟิลด์ใน §4.6) · เหตุผล: `GET /v1/catalog` ไม่มีข้อมูลพอให้คิดราคาเอง (ไม่มีสูตร ไม่มีกติกาช่องทาง ไม่มีค่าเริ่มต้นร้าน และ `etag` ครอบแค่เมนู) และ `POST /v1/orders` ส่งได้ทีละบิลไม่มีคำตัดสินรายแถว

### 4.2 เงินที่ขอบสัญญา: สตางค์ ↔ บาท (ล็อก)

ในแท็บเล็ตเงินเป็น **สตางค์จำนวนเต็ม** ทุกจุด (กฎเหล็กข้อ 2 ของ POS) · dayo เก็บ **บาท `numeric(10,2)`** และคิดราคาด้วย float + `round2` (ปัดครึ่งออกจากศูนย์ ที่ 2 ตำแหน่ง — `packages/shared/src/fmt.ts`) ซึ่งตรงกับ `round(numeric, 2)` ของ Postgres

แปลงที่ **สองจุดเท่านั้น** ในโมดูลเดียว `@dayo/domain` → `money-edge.ts` (ชื่อไฟล์และชื่อฟังก์ชันล็อก · ตั้งชื่อ `edge…` เพราะ `packages/domain/src/money.ts` มี `bahtToSatang` แบบปัดเงียบอยู่แล้ว ซึ่งใช้ได้เฉพาะ `packages/excel-import` · เทสต์ของ POS ตรวจว่า `apps/pos` และตัวคิดราคา/ตัวส่งไม่ import ตัวเดิม):

```ts
/** บาทจาก dayo (ทศนิยม ≤ 2 ตำแหน่ง) → สตางค์ ไม่ปัดเศษทางธุรกิจ แค่ลบ noise ของ float */
export function edgeBahtToSatang(baht: number): number
//  1. ต้องเป็น finite และ ≥ 0 ไม่งั้น throw MoneyEdgeError('NOT_A_MONEY_VALUE')
//  2. x = baht * 100 · r = Math.round(x)
//  3. |x − r| > 1e-6 → throw MoneyEdgeError('MORE_THAN_2_DECIMALS')   (dayo ส่งเกิน 2 ตำแหน่ง = บั๊ก ห้ามปัดทิ้งเงียบ)
//  4. r > 9_999_999_999 (เพดาน numeric(10,2)) → throw MoneyEdgeError('OUT_OF_RANGE')
//  5. คืน r

/** สตางค์ → บาทสำหรับส่งเข้า API */
export function edgeSatangToBaht(satang: number): number
//  1. ต้องเป็น Number.isSafeInteger และ 0 ≤ satang ≤ 9_999_999_999 ไม่งั้น throw
//  2. คืน satang / 100   (JSON.stringify ของผลได้ทศนิยม ≤ 2 ตำแหน่งเสมอ เช่น 3550 → 35.5, 1225 → 12.25)
```

กติกาการปัด (ล็อก)
1. **การปัดทางธุรกิจทั้งหมดเกิดในตัวคิดราคาของ dayo เท่านั้น** (`round2` / `Math.ceil` ของ `ceil_baht`) · ขอบสัญญาไม่ปัดเพิ่ม
2. ผลรวมที่แท็บเล็ตคิดเอง (ยอดเงินสดที่ควรมี ยอดรวมกะ ค่าใช้จ่าย ค่าจ้าง) คิดเป็นสตางค์จำนวนเต็มเสมอ **ห้ามบวกเลขบาท float**
3. ค่าจ้างรายชั่วโมง (ก้อน 6) เป็นที่เดียวที่แท็บเล็ตคูณแล้วต้องปัด: ปัดครึ่งออกจากศูนย์ที่ 1 สตางค์ (กติกาเดียวกับ `round2`) — ล็อกตัวอย่างก่อนเริ่มก้อน 6
4. ค่าจาก dayo ที่ไม่ใช่เงิน (`priceMarkupPct`, `feePct`, `percent`, `multiplier`, `qty` วัตถุดิบ) **ไม่ผ่าน** `edgeBahtToSatang`

เทสต์บังคับของขอบ
- property test: ทุก `s` ใน 0…1,000,000 และสุ่ม 100,000 ค่าใน 0…9,999,999,999 → `edgeBahtToSatang(edgeSatangToBaht(s)) === s` และ `JSON.stringify(edgeSatangToBaht(s))` มีทศนิยม ≤ 2 ตำแหน่ง
- ค่าที่ float ชอบพลาด: `0.1+0.2`, `36.675`, `1.005`, `19.99*3`, `35*1.07` (ผลจาก `round2` ของ dayo ต้องแปลงได้ ไม่ throw)
- ค่าที่ต้อง throw: `-0.01`, `35.123`, `NaN`, `Infinity`, `1e11`

### 4.3 ฉบับแคตตาล็อก `catalog_version` (ล็อก)

- ตารางใหม่ `catalog_versions (shop_id uuid pk → shops, version bigint not null default 1, changed_at timestamptz not null)` (P1)
- trigger ระดับแถว `after insert or update or delete` เพิ่ม `version = version + 1, changed_at = now()` ของร้านนั้น เมื่อแถวในตารางเหล่านี้เปลี่ยน:
  `menu_items` · `menu_variants` · `recipe_lines` · `bases` · `base_lines` · `menu_options` · `sales_channels` · `payment_methods` · `promotions` · `shop_settings` · `staff` (เฉพาะเมื่อ `display_name`/`role`/`status` เปลี่ยน) · `ingredients` (เฉพาะเมื่อ `code`/`name`/`use_unit`/`is_active` เปลี่ยน — การรับเข้าที่แก้ `buy_price` ไม่ทำให้ฉบับเปลี่ยน) · ก้อน 4 เพิ่ม `expense_categories`
- ธุรกรรมเดียวอาจเพิ่มหลายครั้ง — แท็บเล็ตเทียบแค่ **เท่ากัน/ไม่เท่ากัน** ห้ามคิดว่าเลขต่อเนื่อง
- ทุกบิลที่แท็บเล็ตส่ง บอก `catalog_version` ที่ใช้คิดราคา (Q17) → เก็บใน `orders.catalog_version` · บิลจากบอท/เว็บเก็บฉบับ ณ ตอนบันทึก (RPC อ่านจาก `catalog_versions`)
- ราคาที่แท็บเล็ตเก็บเงินจริงเป็นยอดที่บันทึก (ADR-0035 ข้อ 3) · ต่างเกิน ฿1 → ธง `amount_mismatch` ตามเดิม
- **ส่วนต่างทุกขนาดต้องเห็นได้** (P2): dayo เก็บยอดที่ตัวเองคิดของ **ทุกบิล POS** ใน `orders.pos_computed_total` (ไม่ใช่แค่ตอนติดธง) และตอบกลับใน E2 เป็น `computed_total` · แท็บเล็ตเก็บ `computed_total − total` ของทุกบิลในเครื่อง และแสดงรายการ "ยอดไม่ตรงระบบกลาง" เมื่อไม่เป็น 0 · แดชบอร์ด dayo แสดงบิล POS ที่ส่วนต่าง ≠ 0 แยกเป็น "ต่างเล็กน้อย (≤ ฿1)" กับ `amount_mismatch` พร้อม `catalog_version` ของบิลเทียบฉบับ ณ ตอนบิลเข้า (บอกว่า "ต่างเพราะเมนูในเครื่องเก่า") และรุ่นตัวคิดราคา (§5.2)

### 4.4 E1 — `GET /v1/pos/catalog?known_version=<int>` (ล็อก)

scope: `catalog:read` **และ** `staff:read` · RPC ใหม่ `api_pos_catalog(p_shop_id, p_api_client_id, p_known_version)` (P1)

| พารามิเตอร์ | ชนิด | ความหมาย |
|---|---|---|
| `known_version` | int ≥ 0 ไม่บังคับ | ฉบับที่เครื่องมีอยู่ · ไม่ส่งหรือ `0` = ขอทั้งก้อน |

คำตอบเมื่อฉบับไม่เปลี่ยน (`known_version` = ฉบับปัจจุบัน):

```json
{ "ok": true, "data": { "changed": false, "catalog_version": 42, "server_time": "2026-09-25T02:00:00.120+00:00",
                        "pricing": { "commit": "3f2a9c1…", "files_sha256": { "…": "…" } }, "supported_kinds": ["order", "order_void"],
                        "supported_fields": { "order": ["…"], "order_void": ["…"] } } }
```

คำตอบเมื่อเปลี่ยน:

```json
{
  "ok": true,
  "data": {
    "changed": true,
    "catalog_version": 42,
    "server_time": "2026-09-25T02:00:00.120+00:00",
    "client": { "name": "แท็บเล็ตขาย 1", "last_receipt_no": "A-000311" },
    "pricing": { "commit": "3f2a9c1…", "files_sha256": { "packages/shared/src/money.ts": "9b1e…", "packages/shared/src/promotions.ts": "c47d…" } },
    "supported_kinds": ["order", "order_void"],
    "supported_fields": { "order": ["pos_order_id", "receipt_no", "queue_no", "sale_date", "sold_at", "channel", "payment", "staff_id", "catalog_version", "shift_id", "lines", "lines.code", "lines.size", "lines.sweetness", "lines.milk", "lines.grade", "lines.qty", "lines.free", "lines.discount_baht", "lines.discount_percent", "lines.discount_reason", "bill_discount", "promo_code", "skip_promotion_ids", "no_promotions", "totals", "note"],
                          "order_void": ["pos_order_id", "voided_at", "staff_id", "approved_by", "reason"] },
    "staff": [
      { "id": "7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f", "display_name": "TungAo", "role": "owner", "active": true },
      { "id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "display_name": "DCm", "role": "staff", "active": true }
    ],
    "catalog": {
      "settings": { "shopName": "DA-YO", "defaultSize": "16 oz", "defaultSweetness": "100%", "defaultChannelCode": "store",
                    "defaultMilk": "fresh", "maxQtyPerLine": 99, "backdateDays": 7, "recentOrdersCount": 5 },
      "variants": [
        { "menuCode": "Thai Tea", "menuNameTh": "ชาไทย", "family": "ชาไทย", "categoryLabel": "ชาไทย", "menuSortOrder": 1,
          "size": "16 oz", "sweetness": "50%", "price": 35, "allowOatMilk": false, "isMatcha": false,
          "recipeLines": [ { "ingredientId": null, "baseId": "5e1f…", "qty": 120, "unit": "ml" },
                           { "ingredientId": "c3d4…", "baseId": null, "qty": 60, "unit": "ml" } ] }
      ],
      "ingredients": { "c3d4…": { "id": "c3d4…", "code": "RM-012", "name": "นมสด", "useUnit": "ml" } },
      "bases": { "5e1f…": { "id": "5e1f…", "code": "BASE-THAI", "name": "ชาไทยเบส", "yieldQty": 1000, "yieldUnit": "ml",
                            "lines": [ { "ingredientId": "a1b2…", "qty": 40 } ] } },
      "milkOptions": [ { "code": "fresh", "ingredientId": "c3d4…", "priceAdd": 0, "aliases": ["นมสด"] },
                       { "code": "oat", "ingredientId": "d4e5…", "priceAdd": 15, "aliases": ["โอ๊ต"] } ],
      "gradeOptions": [ { "code": "Excellent", "ingredientId": "e5f6…", "multiplier": 1, "priceAdd": 0, "isDefault": true, "aliases": [] } ],
      "channels": [ { "code": "store", "name": "หน้าร้าน", "aliases": [], "priceMarkupPct": 0, "priceAddBaht": 0,
                      "rounding": "none", "feePct": 0, "defaultPaymentMethodCode": "cash" } ],
      "paymentMethods": [ { "code": "cash", "name": "เงินสด", "aliases": ["เงินสด", "สด"] },
                          { "code": "qr", "name": "QR", "aliases": ["qr"] } ],
      "promotions": [ { "id": "9f8e…", "code": null, "name": "ชาไทย ซื้อ 2 แถม 1", "kind": "buy_n_get_m",
                        "startsOn": null, "endsOn": null, "daysOfWeek": null, "timeFrom": null, "timeTo": null,
                        "channelCodes": [], "requiresCode": false, "autoApply": true, "priority": 10, "stackable": false,
                        "isActive": true, "params": { "buy_qty": 2, "get_qty": 1, "menu_codes": ["Thai Tea"] } } ]
    }
  }
}
```

id ที่ย่อด้วย `…` ในตัวอย่างของ §4.4–4.5 เป็น UUID เต็มในไฟล์ fixture (§4.11) — ย่อเพื่ออ่านง่ายเท่านั้น

กติกาของ E1 (ล็อก)
1. `catalog` = **รูป `OrderCatalog` ของ `@dayo/shared` ตรงตัว** (ชื่อฟิลด์ camelCase ตาม `packages/shared/src/types.ts`) เพื่อให้ตัวคิดราคาที่แท็บเล็ตใช้ (สำเนา — §5) รับไปได้โดยไม่แปลงชื่อ · สร้างจาก `dayo_impl_get_full_catalog` ตัวเดียวกับที่บอทใช้ แล้ว **ตัดต้นทุนออก**: `ingredients[*]` ไม่มี `costPerUseUnit` (แท็บเล็ตเติม 0 ก่อนส่งเข้าตัวคิดราคา — ต้นทุนไม่มีผลกับราคา) · E1 ไม่มีต้นทุนเสมอ (ADR-0035 ข้อ 3 — ข้อยกเว้นเดียวคือรายงานกำไรของ owner ใน §4.10 ก้อน 4)
2. `variants` มีเฉพาะเมนูและตัวแปรที่ active (เหมือน `get_full_catalog`) เรียงตาม `menuSortOrder`, `menuCode`, ขนาด, ความหวาน · `categoryLabel` และ `menuSortOrder` เป็นฟิลด์เพิ่มสำหรับหน้าขาย (ตัวคิดราคาไม่ใช้)
3. `recipeLines` จำเป็น: ตัวคิดราคาใช้ตัดสินว่าเมนูเปลี่ยนเป็นนมโอ๊ตได้ไหม (สูตรต้องมีวัตถุดิบนมสด) และบรรทัดผงของเกรดมัตจะ (DATA-CONTRACT §4.1)
4. `promotions` = โปรที่ `is_active` ทั้งหมด (รวมที่ยังไม่ถึงวัน/หมดวันแล้ว — ตัวคิดราคาเช็กวันเวลาเอง)
5. `staff` = พนักงานสถานะ `active` (`active: true`) และ `removed` (`active: false` — แท็บเล็ตห้ามล็อกอิน แต่ยังแสดงชื่อในบิลเก่าได้) · **ไม่มี** `pending` · **ไม่มี** `line_user_id` · `display_name` ว่างได้ → แท็บเล็ตแสดง "พนักงาน " + 4 ตัวท้ายของ `id`
6. `client.last_receipt_no` = `external_ref` ของบิลล่าสุดที่ key นี้ส่งเข้ามา (เรียงตาม `created_at`) หรือ `null` · ใช้ตอนตั้งเครื่องใหม่/ติดตั้งแอปใหม่ด้วย key เดิม เพื่อเลขใบเสร็จไม่ซ้ำของเดิม (§6.6)
7. `server_time` มีทุกคำตอบ → กติกานาฬิกา §6.7
8. ขนาดคำตอบประมาณ 150–250 KB (240 ตัวแปร × สูตร ~6 บรรทัด) · Route Handler ส่งต่อข้อความ JSON จาก RPC โดยไม่ parse ซ้ำถ้าวัด CPU แล้วเกิน 5 ms (§10)
9. `pricing` (มีทั้งสองแบบของคำตอบ ทั้ง `changed` true/false): `commit` = commit ของ dayo ที่ deploy อยู่ (ค่าเดียวกับเวอร์ชันระบบ ADR-0045) · `files_sha256` = sha256 ของไฟล์ตัวคิดราคาใน `packages/shared/src/` ที่ build นั้นใช้ (คำนวณตอน build) · แท็บเล็ตเทียบกับ `VENDOR.json` ของตัวเอง: ไฟล์ใดต่าง → แถบเหลือง "ตัวคิดราคาในเครื่องไม่ตรงกับระบบกลาง" ถาวร (ยังขายได้ · ส่วนต่างจะเห็นใน `computed_total`) และแจ้งทีม POS ให้ `vendor:update` + parity ใหม่
10. `supported_kinds` และ `supported_fields` (มีทั้งสองแบบของคำตอบ) = ชนิดแถว E2 ที่ dayo รุ่นนี้รับ (ก้อน 1–2: `order`, `order_void`) และรายชื่อฟิลด์ของ `data` ต่อชนิด (`{"order": ["pos_order_id", "receipt_no", …], "order_void": [...]}` — ฟิลด์ซ้อนเขียนแบบจุด เช่น `lines.milk`) · แท็บเล็ตไม่ส่งแถวที่ชนิดไม่อยู่ในรายการ หรือมีฟิลด์ที่ไม่อยู่ในรายการ (เก็บรอใน outbox ไม่นับเป็นครั้งลองใหม่)
11. ตั้งแต่ก้อน 4: `expense_categories` อยู่ **ระดับเดียวกับ `staff`** (ไม่อยู่ใน `catalog` เพราะ `catalog` ต้องเป็นรูป `OrderCatalog` ตรงตัว)

### 4.5 E2 — `POST /v1/pos/push` (ล็อก)

scope: ตรวจ **ต่อแถว** ตามชนิด (`order`/`order_void` ต้องมี `orders:write`) · key ที่ไม่มี scope ของชนิดใด → แถวนั้น `rejected / FORBIDDEN` แถวอื่นทำต่อ · RPC ใหม่ `api_pos_push(p_shop_id, p_api_client_id, p_scopes, p_rows)` ก้อนเดียว (P2)

**คำขอ**

```json
{
  "device_time": "2026-09-25T03:15:03.120Z",
  "rows": [ { "key": "order:0b6c1e2a-…", "kind": "order", "data": { … } } ]
}
```

| ฟิลด์ | ชนิด | กติกา |
|---|---|---|
| `device_time` | ISO UTC | เวลาเครื่องตอนส่ง (ไว้ log ความต่างนาฬิกา) |
| `rows` | array 1–20 | เรียงตามลำดับที่เกิดในเครื่อง (FIFO) · body ทั้งก้อน ≤ 256 KB |
| `rows[].key` | string 1–200 | รูป `<kind>:<uuid>` · คีย์กันซ้ำ ไม่ซ้ำกันต่อ API key ตลอดไป |
| `rows[].kind` | string | ก้อน 1–2: `order` · `order_void` · ก้อน 3–6 เพิ่มตาม §4.10 |
| `rows[].data` | object | ตามชนิด (ด้านล่าง) |

ปัญหาที่ระดับซอง (ไม่ใช่ JSON, `rows` ไม่ใช่ array, เกิน 20 แถว, เกิน 256 KB) → HTTP 422 `DY422` ทั้งคำขอ · **ปัญหาในแถวใดแถวหนึ่ง (รวม `key`/`kind`/`data` ผิดรูป) เป็นคำตัดสินของแถวนั้นเสมอ** ไม่ทำให้ทั้งก้อนล้ม

**แถวชนิด `order`** — key = `order:<pos_order_id>`

| ฟิลด์ใน `data` | ชนิด | บังคับ | กติกา / ที่เก็บในฐานกลาง |
|---|---|---|---|
| `pos_order_id` | uuid | ✓ | `order.id` ในแท็บเล็ต → `orders.pos_order_id` (unique ต่อ `api_client_id`) |
| `receipt_no` | string `^[A-Z]{1,3}-\d{6}$` | ✓ | เลขใบเสร็จ POS → `orders.external_ref` (unique ต่อ `api_client_id` ตามเดิม) |
| `queue_no` | int 1–9999 | ✓ | เลขคิว → `orders.pos_queue_no` |
| `sale_date` | `YYYY-MM-DD` | ✓ | ต้องเท่ากับวันที่ไทยของ `sold_at` · ≤ วันนี้ · ≥ วันนี้ − 60 วัน |
| `sold_at` | ISO UTC | ✓ | เวลาชำระ → `orders.sold_at` · `sale_time` ของการคิดโปร = `to_char(sold_at at time zone 'Asia/Bangkok', 'HH24:MI')` (ตัดวินาที ไม่ปัด) (เชื่อได้ — ADR-0040 ข้อ 4) · เกินเวลาเซิร์ฟเวอร์ + 5 นาที → `deferred CLOCK_AHEAD` |
| `channel` | string | ✓ | `sales_channels.code` |
| `payment` | string | ✓ | `payment_methods.code` (แท็บเล็ต: `cash` หรือ `qr`) |
| `staff_id` | uuid | ✓ | `staff.id` ของคนที่ล็อกอินขาย → `orders.created_by` (P2 ข้อ 3) |
| `catalog_version` | int ≥ 1 | ✓ | → `orders.catalog_version` |
| `shift_id` | uuid หรือ null | ก้อน 2: **ส่ง null เสมอ** (กะช่วงก้อน 2 ไม่มีในฐานกลาง) · ก้อน 3: บังคับ **ยกเว้นบิลของกะที่เป็น `local_only` (เปิดก่อนก้อน 3 ใช้งานจริง) ส่ง null เสมอ แม้ก้อน 3 ใช้งานแล้ว** | → `orders.pos_shift_id` · **ผูกทีหลังได้**: ไม่มี FK และ dayo ไม่รอกะ — บิลไม่ถูกบล็อกเพราะกะยังไม่มา/ถูกปฏิเสธ (§4.10 ก้อน 3) |
| `lines` | array 1–50 | ✓ | รวม ≤ 500 แก้ว (กติกา `DY422 too_large` เดิม) |
| `lines[].code` | string | ✓ | `menu_items.code` |
| `lines[].size` / `sweetness` | string | ✓ | ค่าตาม §4.1 |
| `lines[].milk` | `"fresh"`/`"oat"` | ✓ | **ห้าม null** — แท็บเล็ตส่งค่าที่ตีความแล้ว ณ ตอนขาย (ค่าเริ่มต้นร้านอาจเปลี่ยนก่อนบิลมาถึง) |
| `lines[].grade` | string/null | ✓ | เมนูมัตจะ (`isMatcha`) ต้องส่งรหัสเกรดที่ตีความแล้ว (ห้าม null) · เมนูอื่นต้องเป็น null |
| `lines[].qty` | int 1–999 | ✓ | บิล POS **ไม่ตรวจ/ไม่บีบ** กับ `maxQtyPerLine` ปัจจุบัน (ค่านั้นใช้ตอนขายบนแท็บเล็ต) · เพดาน 1–999 ตาม check ของ `order_items.qty` |
| `lines[].free` | bool | | ต้องมี `discount_reason` (ADR-0023/0039) |
| `lines[].discount_baht` | บาท/null | | ส่วนลดต่อแก้ว · ส่งคู่กับ `discount_percent` = `INVALID` |
| `lines[].discount_percent` | 0–100/null | | ร้อยละ |
| `lines[].discount_reason` | string/null | | บังคับเมื่อแก้วเหลือ 0 บาท (ADR-0039) |
| `bill_discount` | `{baht?, percent?, reason?}`/null | | ส่วนลดทั้งบิลที่พนักงานกรอก · ต้องมี `baht` **หรือ** `percent` อย่างเดียว · ส่งทั้งคู่ = `INVALID` |
| `promo_code` | string/null | | โค้ดโปรที่ลูกค้าให้ |
| `skip_promotion_ids` | uuid[] | | โปรที่พนักงานกด "ไม่ใช้" (ค่าเริ่มต้น `[]`) |
| `no_promotions` | bool | | ปุ่ม "ไม่ใช้โปรทั้งบิล" (ค่าเริ่มต้น `false`) · ส่งต่อเป็น `no_promotions` ที่ SQL มีอยู่แล้ว · ฝั่งแท็บเล็ต `OrderDraft` ของ shared ไม่มีฟิลด์นี้ → คิดด้วย `skipPromotionIds` = id โปรทุกตัวในแคตตาล็อก (ผลเท่ากัน — มีเคส parity) |
| `totals` | object | ✓ | ยอดที่เก็บเงินจริง (บาท): `items_subtotal`, `items_discount`, `bill_discount`, `total` → `pos_amounts` ของ `create_order` · ต้องมาจากการคิดราคาใหม่ **ณ วินาทีชำระ** ด้วย `now = sold_at` (§5.1) |
| `note` | string/null | | ≤ 200 |

ตัวอย่าง (ตรงกับตัวอย่างเทสต์ใน DATA-CONTRACT §4.2 ข้อ 9):

```json
{
  "key": "order:0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21",
  "kind": "order",
  "data": {
    "pos_order_id": "0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21",
    "receipt_no": "A-000312", "queue_no": 12,
    "sale_date": "2026-09-25", "sold_at": "2026-09-25T03:15:03.120Z",
    "channel": "store", "payment": "cash",
    "staff_id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d",
    "catalog_version": 42, "shift_id": null,
    "lines": [
      { "code": "Thai Tea", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": null, "qty": 3 },
      { "code": "Matcha Latte", "size": "16 oz", "sweetness": "50%", "milk": "fresh", "grade": "Excellent", "qty": 1 }
    ],
    "bill_discount": null, "promo_code": null, "skip_promotion_ids": [], "no_promotions": false,
    "totals": { "items_subtotal": 190, "items_discount": 35, "bill_discount": 0, "total": 155 },
    "note": null
  }
}
```

กติกาฝั่ง dayo ของแถว `order` (ล็อก — รายละเอียดใน P2)
0. **ตรวจก่อนเรียก `create_order` ตามลำดับนี้ (ล็อก)** (ใน `api_pos_push`): **(1) เทียบ hash เนื้อหาของ key กันซ้ำก่อนเสมอ** — มี key นี้ใน `api_idempotency_keys` (ผลที่บันทึกสำเร็จภายใน 30 วัน): hash เท่า → `duplicate` ผลเดิม · hash ต่าง → **`CONFLICT`** แล้วหยุด · ไม่มี key → ไปข้อ (2) · **(2)** (ก) มีบิล `(api_client_id, pos_order_id)` นี้แล้ว → `duplicate` คืนบิลนั้น (ข) มีบิล `(api_client_id, external_ref = receipt_no)` แต่ `pos_order_id` ต่างหรือว่าง → **`CONFLICT` เสมอ ห้ามเป็น `duplicate`** (ค) ไม่พบทั้งคู่ → สร้าง · ทางลัด "external_ref ซ้ำ = คืนบิลเดิม" ภายใน `create_order` (0008) ต้องเทียบ `pos_order_id` ด้วย: ไม่ตรง → raise `DY409 external_ref_taken` → แผนที่เป็น `CONFLICT` (กรณีสองคำขอชนกันพร้อมกัน)
1. เรียก `create_order` ภายใน (quote ซ้ำ · แช่แข็งต้นทุน · หักสต็อก · `amount_mismatch` เมื่อต่าง > ฿1 · เก็บ `pos_computed_total` ทุกบิล) ด้วย actor = `{api_client_id, staff_id}`
2. **บิลจากแท็บเล็ตไม่ถูกปฏิเสธเพราะแคตตาล็อกเปลี่ยนหลังขาย**: เมนู/ตัวแปร/ตัวเลือก/ช่องทาง/วิธีชำระ/โปรที่ถูกปิดใช้แล้วยังใช้คิดได้ (ขยาย `include_inactive` ที่ `dayo_quote` ทำกับเมนูอยู่แล้วให้ครอบตัวเลือก ช่องทาง วิธีชำระ) · ถูกปฏิเสธเฉพาะ **รหัสที่ไม่มีในร้านเลย** (`UNKNOWN_CODE`)
3. ไม่ใช้เพดานบันทึกย้อนหลังตามบทบาท (ADR-0020/0046) กับบิลจากแท็บเล็ต — ใช้ช่วง ≤ 60 วันในตาราง
4. `staff_id` ต้องเป็นพนักงานของร้านสถานะ `active` **หรือ** `removed` (ขายไปก่อนถูกปลด) · `pending`/ไม่พบ → `UNKNOWN_STAFF`
5. ตรวจธงบิลน่าจะซ้ำ (§4.8) หลังบันทึก

**แถวชนิด `order_void`** — key = `order_void:<pos_order_id>` (บิลละครั้งเดียว)

| ฟิลด์ | ชนิด | บังคับ | กติกา |
|---|---|---|---|
| `pos_order_id` | uuid | ✓ | บิลที่ยกเลิก (ต้องเป็นบิลของ API key นี้) |
| `voided_at` | ISO UTC | ✓ | เวลายกเลิกในเครื่อง · วันที่ไทยต้อง **เท่ากับ `sale_date` ของบิล** (ไม่ตรง = `FORBIDDEN`) · ≥ `sold_at` (ไม่ตรง = `INVALID`) · เกินเวลาเซิร์ฟเวอร์ + 5 นาที = **`deferred CLOCK_AHEAD`** (ไม่ใช่ rejected — ส่งซ้ำทีหลังผ่านได้) |
| `staff_id` | uuid | ✓ | คนกดยกเลิก → `orders.cancelled_by` |
| `approved_by` | uuid/null | | owner ที่อนุมัติด้วย PIN (D50 Q3-22) → เก็บใน `audit_log.after` |
| `reason` | string 1–200 | ✓ | → `orders.cancel_reason` |

การคืนเงินสดจากลิ้นชัก **ไม่อยู่ในแถวนี้** — แหล่งความจริงเดียวคือแถว `cash_movement` ชนิด `VOID_REFUND` (ก้อน 3 · D36) · **`VOID_REFUND` และแถวกะ/เงินสดทุกชนิดที่เกิดก่อนก้อน 3 ใช้งานจริง เป็นข้อมูลในเครื่องเท่านั้น (`local_only`) — ไม่ส่งตลอดไป** เพราะกะของมันไม่เคยมีในฐานกลาง (§6.1)

ฝั่ง dayo เรียก `cancel_order` ภายใน · **กติกาวันยกเลิกเปลี่ยนจาก "วันขาย = วันนี้ของเซิร์ฟเวอร์" เป็น "วันขาย = วันที่ไทยของ `voided_at`"** สำหรับแถวนี้ (แก้ ADR-0040 ข้อ 2 — P2) เพื่อให้การยกเลิกที่ทำในวันเดียวกันตอนออฟไลน์แล้วส่งถึงพรุ่งนี้ยังผ่าน · บิลถูกยกเลิกอยู่แล้ว → `duplicate`

**คำตอบ** (HTTP 200 เมื่อซองถูก แม้บางแถวถูกปฏิเสธ)

```json
{
  "ok": true,
  "data": {
    "server_time": "2026-09-25T03:15:04.010+00:00",
    "results": [
      { "key": "order:0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21", "status": "accepted",
        "data": { "order_no": "L260925-014", "version": 1, "computed_total": 155, "amount_mismatch": false, "duplicate_of": [], "warnings": [] } },
      { "key": "order_void:5d4c…", "status": "rejected", "reason": "FORBIDDEN",
        "detail": "ยกเลิกได้เฉพาะวันเดียวกับวันขาย (voided_at 2026-09-26 ≠ sale_date 2026-09-25)" }
    ]
  }
}
```

- `results` เรียงตรงกับ `rows` และมีจำนวนเท่ากันเสมอ · `key` ของคำตอบ = key ที่ส่งมา (ตัดที่ 200 code point) · `detail` ≤ 500 code point ภาษาไทยอ่านได้ · **`detail` สะท้อนค่าที่ส่งมาได้เฉพาะ วันที่/เวลา รหัสเมนู-ช่องทาง-วิธีชำระ เลขใบเสร็จ และ SQLSTATE** · ห้ามสะท้อน id พนักงาน ข้อความอิสระ (`note`/`reason`) หรือข้อความ error ดิบของ Postgres (§7 ข้อ 8)
- `data` ของ `order` ที่ `accepted`/`duplicate`: `order_no` (เลข `L…` ของ dayo), `version`, `computed_total` (บาท — ยอดที่ dayo คิดเอง), `amount_mismatch`, `duplicate_of` (เลข `order_no` ของบิลต่างแหล่งที่ติดธงคู่กัน), `warnings` (จาก quote) · ของ `order_void`: `order_no`, `version`

| status | ความหมาย | แท็บเล็ตทำอะไร |
|---|---|---|
| `accepted` | บันทึกแล้วครั้งนี้ | ทำเครื่องหมายส่งแล้ว เก็บ `order_no` |
| `duplicate` | เคยบันทึกแล้วด้วย key เดิมและเนื้อหาเดิม — คืนผลเดิม | เหมือน `accepted` |
| `rejected` | บันทึกไม่ได้ด้วยข้อมูลนี้ | ย้ายไปหน้า "ส่งไม่ผ่าน" ให้ owner แก้ (§6.4) · แถวลูกของแถวนี้ขึ้นในหน้าเดียวกันทันทีเหตุผล `PARENT_REJECTED` และส่งเองเมื่อแถวแม่ผ่าน |
| `deferred` | ยังบันทึกไม่ได้ตอนนี้ ลองใหม่ได้ | ลองใหม่ตาม backoff (§6.3) |

| reason (`rejected`) | เกิดเมื่อ |
|---|---|
| `INVALID` | รูปข้อมูลผิด ฟิลด์ขาด/เกิน/เกินช่วง · `DY422` จาก RPC (เช่น ส่วนลดเต็มราคาไม่มีหมายเหตุ บิลเกินขนาด) |
| `BAD_KEY` | `key` ไม่ใช่รูป `<kind>:<uuid>` หรือ uuid ใน key ไม่ตรงกับ id ใน `data` |
| `UNKNOWN_CODE` | รหัสเมนู/ขนาด-ความหวาน/ตัวเลือก/ช่องทาง/วิธีชำระ ไม่มีในร้าน (รวมที่ปิดใช้แล้ว) |
| `UNKNOWN_STAFF` | `staff_id`/`approved_by` ไม่ใช่พนักงาน active หรือ removed ของร้าน |
| `CONFLICT` | key เดิมแต่เนื้อหาต่างจากที่เคย **บันทึกสำเร็จ** · `receipt_no` นี้ถูกใช้แล้วกับ `pos_order_id` อื่น (หรือว่าง) ของ API key เดียวกัน |
| `ALREADY_PRESENT` | (ตระกูล `CONFLICT`) `order_excluded` ของบิลที่มีอยู่ในฐานกลางแล้ว — ห้ามกันบิลจริงออก (ก้อน 3) |
| `FORBIDDEN` | key ไม่มี scope ของชนิดนี้ · ยกเลิกบิลที่ไม่ใช่ของ key นี้ · ผิดกติกาวันยกเลิก (`voided_at` คนละวันกับ `sale_date`) |

| reason (`deferred`) | เกิดเมื่อ |
|---|---|
| `PARENT_PENDING` | แถวอ้างบิล/กะที่ยังไม่มีในฐานกลางและไม่อยู่ก่อนหน้าในคำขอเดียวกัน (เช่น `order_void` ของบิลที่ยังมาไม่ถึง) — ฝั่ง dayo ไม่ตอบ "ไม่พบ" แบบถาวรเด็ดขาด เพราะแถวแม่อาจกำลังมา |
| `BUSY` | ล็อกชน / deadlock / serialization / หมดเวลา / คีย์กำลังถูกใช้โดยคำขออื่น |
| `CLOCK_AHEAD` | `sold_at`/`voided_at` เกินเวลาเซิร์ฟเวอร์ + 5 นาที |
| `UNSUPPORTED` | `kind` หรือฟิลด์ที่ dayo รุ่นนี้ยังไม่รู้จัก (§4.1 ความเข้ากันได้) |
| `SERVER_ERROR` | error อื่นทุกชนิดที่ไม่ได้แผนที่ไว้ในตารางด้านล่าง — **เฉพาะแถวนั้น** ไม่ทำให้ทั้งคำขอเป็น 5xx · `detail` = SQLSTATE + รหัส DY (ไม่มีข้อความดิบ) · ฝั่ง dayo `console.error` → Discord (ADR-0044) |

**ตารางแผนที่ error → คำตัดสิน (ล็อก)** — `api_pos_push` จับทุก exception ของแถวใน savepoint แล้วแปลงตามนี้ ไม่มีกรณีใดหลุดเป็น 5xx ของทั้งคำขอ:

| ต้นทาง | ตัวอย่าง | คำตัดสิน |
|---|---|---|
| ตรวจรูปใน `api_pos_push` เอง | ฟิลด์ขาด/ชนิดผิด/เกินช่วง · `milk` null · `bill_discount` สองค่า | `rejected INVALID` |
| ตรวจ key | ไม่ใช่ `<kind>:<uuid>` · uuid ไม่ตรง id ใน `data` | `rejected BAD_KEY` |
| ฟิลด์/ชนิดที่ไม่รู้จัก | | `deferred UNSUPPORTED` |
| `DY422` | ส่วนลดเต็มราคาไม่มีหมายเหตุ · บิลเกินขนาด · วันขายนอกช่วง | `rejected INVALID` |
| `DY422 unknown_code:` / `DY404 not_found:` จากการหาเมนู ตัวแปร ตัวเลือก ช่องทาง วิธีชำระ | P2 ให้ RPC ใช้คำนำหน้า `unknown_code:` | `rejected UNKNOWN_CODE` |
| `DY401` / `DY404` จากการหาพนักงาน | `staff_ref_invalid` | `rejected UNKNOWN_STAFF` |
| `DY403` | scope · บิลของ key อื่น · วันยกเลิกผิด | `rejected FORBIDDEN` |
| `DY404` บิลที่จะยกเลิกไม่พบ | | `deferred PARENT_PENDING` |
| `DY409 external_ref_taken` | ใบเสร็จชน `pos_order_id` อื่น | `rejected CONFLICT` |
| `DY409` บิลถูกยกเลิกแล้ว (`order_void`) | | `duplicate` |
| `DY409 idempotency_in_progress` / `duplicate_event` | อีกคำขอกำลังทำ key เดียวกัน | `deferred BUSY` |
| `DY409` อื่น | | `deferred SERVER_ERROR` |
| SQLSTATE `23505` unique | ชนกันพร้อมกัน | หาใหม่ตามข้อ 0: เจอ `pos_order_id` เดียวกัน = `duplicate` · ไม่งั้น `rejected CONFLICT` |
| SQLSTATE `23502` `23514` `22001` `22003` `22007` `22008` `22021` `22P02` `22P05` | not null · check · ยาวเกิน · ตัวเลขล้น · วันที่ผิด · อักขระผิด | `rejected INVALID` |
| SQLSTATE `40001` `40P01` `55P03` `57014` | serialization · deadlock · lock · statement timeout | `deferred BUSY` |
| SQLSTATE `23503` FK และอื่นทั้งหมด | | `deferred SERVER_ERROR` |

การกันซ้ำ (ล็อก)
- ต่อแถวใช้ตาราง `api_idempotency_keys` เดิม (`endpoint = 'pos_push'`, `idempotency_key = key`, `request_hash = sha256(data::jsonb::text)`) · **เก็บเฉพาะผล `accepted`** (และ `duplicate` ที่คืนผลเดิม) — ผล `rejected`/`deferred` **ไม่ถูกเก็บใต้ key** จึงส่ง key เดิมด้วยข้อมูลที่แก้แล้วได้ (§6.4) · key เดิม + hash เดิม = `duplicate` ผลเดิม · key เดิม + hash ต่างจากที่เคยบันทึกสำเร็จ = `CONFLICT` · **ตรวจ hash นี้ก่อนขั้น (ก)(ข)(ค) ของข้อ 0 เสมอ**
- `heartbeat` ลบ `api_idempotency_keys` ที่เก่ากว่า 30 วัน — หลังจากนั้นกันซ้ำด้วยการตรวจข้อ 0: `pos_order_id` เดิม = `duplicate` · `external_ref` เดิมแต่ `pos_order_id` ต่าง = **`CONFLICT`** (ห้ามเป็น `duplicate` เด็ดขาด — ไม่งั้นบิลใหม่หายเงียบ) · ข้อจำกัดที่ยอมรับ: หลังคีย์ถูกลบ ส่ง `pos_order_id` เดิมด้วยเนื้อหาต่าง = `duplicate` (ไม่ใช่ `CONFLICT`) — ไม่มีเงินหาย เพราะบิลนั้นอยู่ในฐานแล้ว
- แต่ละแถวทำใน savepoint ของตัวเอง (`begin … exception … end` ใน plpgsql) → แถวที่ล้มไม่ย้อนแถวอื่น · แถวถัดไปเห็นแถวก่อนหน้าในคำขอเดียวกัน (บิล + ยกเลิกบิลเดียวกันในก้อนเดียวผ่านได้)

error ทั้งคำขอ (ไม่มี `results`): 401 key ผิด/ถูกเพิกถอน · 403 key ไม่มี scope ใดเลยที่ endpoint นี้ต้องใช้ · 404 API ปิด · 422 ซองผิด · 429 เกินอัตรา · 5xx **เฉพาะเมื่อเรียก RPC ไม่ได้เลย** (ต่อฐานไม่ได้/Worker ล้ม) — error ของแถวไม่เป็น 5xx · ทุกกรณีมีหัว CORS (§4.1) → แท็บเล็ตทำตาม §6.3

### 4.6 E3 — `GET /v1/orders?from=&to=&updated_since=` (มีอยู่แล้ว · ขยายฟิลด์ — ล็อก)

scope `orders:read` · ใช้แสดง "บิลจากบอท/เว็บของวันนี้" บนแท็บเล็ต (กันคนบันทึกซ้ำ — 03 §8 ข้อ 3) · แท็บเล็ตดึงเมื่อเปิดหน้านั้น และทุก 5 นาทีระหว่างที่หน้าเปิดอยู่
เพิ่มฟิลด์ต่อบิล (P2): `sold_at` (ISO หรือ null) · `created_by_name` (ชื่อพนักงาน หรือ null) · `pos_receipt_no` (= `external_ref` เมื่อ `source='pos'`) · `pos_queue_no` · `catalog_version` · `duplicate_suspect` (bool — มีธงเปิดอยู่) · ฟิลด์เดิมคงเดิมทั้งหมด (ไม่มีต้นทุน/กำไร)

### 4.7 แหล่งและผู้บันทึกของบิล · บิลจาก POS อ่านอย่างเดียวบนเว็บ (ล็อก)

- แหล่ง = `orders.source` ค่าเดิมของ dayo: `pos` (แท็บเล็ต) · `line` (บอท — หน้าจอแสดงคำว่า "บอท") · `web` · **ไม่เปลี่ยนชื่อค่า** (brief เรียก `bot` แต่ค่าจริงในฐานคือ `line`)
- ผู้บันทึก = `orders.created_by` → `staff` · บิลจากแท็บเล็ตต้องมีเสมอ (`staff_id` บังคับใน E2) · บิลจากบอท/เว็บมีอยู่แล้ว (ADR-0024 ข้อ 2)
- เว็บและบอทแสดง "แหล่ง · ผู้บันทึก" ทุกที่ที่แสดงบิล · บิลจาก POS แสดง "ใบเสร็จ A-000312 · คิว 12" เพิ่ม
- **บิล `source='pos'` แก้/ยกเลิกไม่ได้จากเว็บและบอท แม้เป็น owner** — RPC `update_order`/`cancel_order` ที่ actor ไม่มี `api_client_id` ตอบ `DY403 pos_bill_read_only` · เว็บซ่อนปุ่มแก้/ยกเลิก · ยกเลิกบิล POS ทำได้ที่แท็บเล็ตเท่านั้น ภายในวันขายเดียวกัน (ADR-0040 ข้อ 2 ตามที่แก้ใน P2) · **บิล POS ของวันที่ปิดแล้วแก้ไม่ได้ทั้งเว็บและแท็บเล็ต** — ส่วนต่างแก้ด้วยการปรับในกะปัจจุบัน (`cash_movement` `PAID_IN`/`PAID_OUT` พร้อมเหตุผลอ้างเลขใบเสร็จ) หรือบันทึกเป็นค่าใช้จ่าย (Q52)

### 4.8 ธงบิลน่าจะซ้ำ (ล็อก)

บิล A กับ B **น่าจะซ้ำ** เมื่อครบทุกข้อ:
1. ร้านเดียวกัน · `status = 'ok'` ทั้งคู่ · `A.source ≠ B.source`
2. `sale_date` เดียวกัน · `sold_at` ไม่ว่างทั้งคู่ และ `|A.sold_at − B.sold_at| ≤ 10 นาที`
3. `total_amount` เท่ากัน
4. `items_signature` เท่ากัน — ข้อความที่สร้างจาก `order_items` หลังบันทึก: รวม `qty` ตามคีย์ `menu_code|size|sweetness|milk_code|grade_code` แล้วเรียงคีย์ตามตัวอักษร ต่อด้วย `;` เช่น `Matcha Latte|16 oz|50%|fresh|Excellent×1;Thai Tea|16 oz|50%|fresh|×3` (ส่วนลดไม่นับ)

`sold_at` ของแต่ละแหล่ง: `pos` = เวลาชำระจากแท็บเล็ต · `line`/`web` = เวลาที่บันทึก เมื่อ `sale_date` = วันนี้ · บันทึกย้อนหลัง = `null` → **ไม่ตรวจ** · บิลเก่าก่อน migration: เติม `sold_at` = `created_at` เมื่อวันที่ไทยของ `created_at` = `sale_date` ไม่งั้น `null`

การทำงาน
- ตรวจใน RPC ทุกครั้งที่บิลถูกสร้าง หรือถูกแก้รายการ (ไม่สนว่าบิลไหนมาถึงก่อน — บิลแท็บเล็ตที่มาถึงช้าก็จับคู่ได้)
- เจอคู่ → แทรก `order_duplicate_flags (id, shop_id, order_a_id, order_b_id, detected_at, status 'open', resolved_by, resolved_at, resolution_note)` · unique คู่ `(least(a,b), greatest(a,b))`
- **ไม่บล็อกการบันทึกเด็ดขาด** · คำตอบ E2 มี `duplicate_of` · แท็บเล็ตแสดงป้าย "อาจซ้ำกับบิลบอท L260925-013" บนหน้ารายละเอียดบิล (ไม่เด้งกลางการขาย)
- ปิดธง: owner บนแดชบอร์ดเว็บ กด "ไม่ซ้ำ" (`resolved_not_duplicate` + หมายเหตุ) หรือยกเลิกบิลใดบิลหนึ่ง → ธงปิดเองเป็น `resolved_cancelled` · บิล POS ยกเลิกที่แท็บเล็ตในวันเดียวกันเท่านั้น (§4.7) จึงแนะนำให้ยกเลิกฝั่งบอท/เว็บ
- แดชบอร์ด owner แสดงจำนวนธงที่เปิดอยู่ · คำตอบ `ยอดวันนี้` ของ owner ในบอทเติม "⚠ บิลที่อาจซ้ำ N ใบ" (reply ไม่เสียโควตา)

### 4.9 สิ่งที่เปลี่ยนในฐานกลางสำหรับก้อน 1–2 (ล็อก — migration ใหม่ของ dayo)

| ตาราง | เปลี่ยน |
|---|---|
| `catalog_versions` | ใหม่ (§4.3) + trigger บน 12 ตาราง |
| `orders` | เพิ่ม `pos_order_id uuid` (unique partial `(api_client_id, pos_order_id)`) · `pos_queue_no integer check (1–9999)` · `pos_shift_id uuid` (**ไม่มี FK** — ผูกทีหลังได้ §4.10 ก้อน 3) · `pos_computed_total numeric(10,2)` (ยอดที่ dayo คิดของทุกบิล POS) · `catalog_version bigint` · `sold_at timestamptz` · `items_signature text` · check: `source='pos'` ⇒ `pos_order_id`, `external_ref`, `created_by` ไม่ว่าง (เฉพาะแถวใหม่ — ใช้ `not valid` กับของเก่า) · ดัชนี `(shop_id, sale_date, total_amount)` สำหรับหาคู่ซ้ำ |
| `order_duplicate_flags` | ใหม่ (§4.8) · RLS เปิดไม่มี policy · ลงไฟล์สำรอง |
| `api_clients` | scope ที่อนุญาตเพิ่ม `staff:read` (ก้อน 1) · `shift:write` `expense:write` `payroll:write` (เพิ่มในก้อนนั้น ๆ) |
| `api_idempotency_keys` | `endpoint` check เพิ่ม `'pos_push'` |
| `menu_items` `sales_channels` `payment_methods` | `code` ที่ถูกบิลอ้างแล้วเปลี่ยนไม่ได้ (`DY422` แบบเดียวกับรหัสตัวเลือกใน 0005 · แก้ `save_menu_item` `save_channel` `save_payment_method` ที่ตอนนี้เปลี่ยน `code` ได้เมื่อส่ง id) — กันบิลออฟไลน์อ้างรหัสที่หายไป (Q51) |
| RPC | ใหม่ `api_pos_catalog` `api_pos_push` · แก้ `create_order` (เติม `sold_at` `catalog_version` `items_signature` + ตรวจซ้ำ) · `update_order` (ตรวจซ้ำใหม่เมื่อแก้รายการ + ห้ามแก้บิล POS จาก staff actor) · `cancel_order` (ปิดธง + ห้ามยกเลิกบิล POS จาก staff actor) · `dashboard_*` (ธงซ้ำ) · `backup_dump_table` (ตารางใหม่) |
| Route Handler | `app/api/v1/pos/catalog/route.ts` · `app/api/v1/pos/push/route.ts` · CORS ใน `lib/api/response.ts` (`apiHandler` — ที่เดียวกับสวิตช์ `API_V1_ENABLED`) + `OPTIONS` ของทุก route · `lib/api/orders.ts` (`listApiOrders` ฟิลด์ใหม่) · build ของเว็บเขียน `pricing.commit` + `files_sha256` |

### 4.10 ก้อน 3–6: โครงข้อมูลและ endpoint ระดับร่าง — **ล็อกก่อนเริ่มก้อนนั้น**

ทุกตารางในส่วนนี้: `id uuid` จากแท็บเล็ต · `shop_id` · `api_client_id` · `created_at` · RLS เปิดไม่มี policy · **append-only** (trigger raise เมื่อ update/delete ยกเว้นคอลัมน์ "ปิด" ที่ตั้งได้ครั้งเดียวจาก null) · ลงไฟล์สำรอง · เงิน `numeric(10,2)` บาท · เข้าทาง `POST /v1/pos/push` ชนิดใหม่ (คำตัดสิน/กันซ้ำแบบเดียวกับ §4.5)

**ก้อน 3 — กะ เงินสด นับเงิน ใบปิดกะ** (P3 · scope `shift:write`)
- `shifts`: `business_date`, `opened_by`, `opened_at`, `opening_float`, `closed_by`, `closed_at` (ตั้งครั้งเดียว), `status` `open` → `counted` (รับนับเงินแล้ว รอ Z — Q43) → `closed` (รับ Z แล้ว) · unique สถานะ `open` ต่อ `api_client_id` (กะถัดไปเปิดได้ขณะกะก่อนเป็น `counted`)
- `cash_movements`: `shift_id`, `kind` (`PAID_IN`/`PAID_OUT`/`DROP`/`VOID_REFUND` — enum เดียวกับ POS), `amount > 0`, `pos_order_id` (เฉพาะ `VOID_REFUND`), `reason`, `created_by`, `created_at` (เวลาเครื่อง) · **`VOID_REFUND` เป็นแหล่งความจริงเดียวของเงินคืนจากบิลที่ยกเลิก** (`order_void` ไม่มีข้อมูลคืนเงิน)
- `cash_counts`: `shift_id`, `lines jsonb [{denomination, count}]` (9 ชนิด 1000…1 บาท — D52), `counted`, `expected`, `variance`, `reason`, `counted_by`, `counted_at` (เวลาเครื่องตอนนับ)
- `z_reports`: `shift_id` unique, `snapshot jsonb`, `hash` (โซ่แฮชของแท็บเล็ต), `recompute_status` (`waiting_bills` / `matched` / `mismatch`), `z_mismatch bool` (= `recompute_status = 'mismatch'`), `missing_pos_order_ids uuid[]`, `recomputed_at`
  - `snapshot` มี: `bot_window: {after, until}` · `bot_bills: [{order_no, version, total}]` (บิลเงินสดบอท/เว็บที่นับ) · **`pos_bills: [{pos_order_id, receipt_no, payment, total, sold_at, voided_at|null, excluded}]` = บิล POS ทุกใบของกะ** (ทุกวิธีชำระ รวมที่ยกเลิก · `excluded=true` = owner ปิดเป็นรายการนอกระบบกลาง — §6.4) · ยอดเงินทุกตัวที่ใช้คิด expected
  - **การคิดซ้ำของ dayo (ล็อก)**: ใช้เฉพาะรายการ id ใน snapshot และเวลาจากเครื่อง (`sold_at`, `voided_at`, `created_at` ของตารางใหม่ของก้อนนี้ซึ่งเป็นเวลาเครื่อง) — **ห้ามใช้ `orders.created_at`** (เวลาที่เซิร์ฟเวอร์รับ) · บิล POS ในรายการที่ยังไม่มีในฐาน (ไม่นับที่ `excluded`) → `recompute_status = 'waiting_bills'` + `missing_pos_order_ids` (**ไม่ใช่ mismatch**) · dayo **คิดซ้ำทุกครั้งที่บิลหรือการยกเลิกของกะนั้นเข้ามา** (และที่ `order_excluded` เข้ามา) · `mismatch` ได้เฉพาะเมื่อบิลในรายการมาครบแล้วตัวเลขยังต่าง · บิลที่ `excluded` ใช้ยอดจาก snapshot (ตรวจกับฐานไม่ได้)
- ชนิด push: `shift_open` · `cash_movement` · `cash_count` · `shift_close` (มี `z_report` ในตัว) · `order_excluded`
- **สัญญา `order_excluded` (ล็อก — ตรงกับ P3 ข้อ 2)**: key = **`order_excluded:<pos_order_id>`** (ตามรูป `<kind>:<uuid>` — `pos_order_id` เป็น UUID · บิลละครั้งเดียว) · `data` = `{pos_order_id, shift_id, total, sold_at, reason, staff_id, created_at_device}` — `total` = ยอดบิลจาก `total_satang` แปลงด้วย `edgeSatangToBaht` · `staff_id` = owner ที่กดกันออกด้วย PIN · `reason` 1–200 · **สร้างบนแท็บเล็ตได้เฉพาะ role owner** · อยู่ในช่องของกะนั้น (§6.2) · ฝั่ง dayo: `shift_close` ของกะนั้นยังไม่มา → `deferred PARENT_PENDING` · มีบิล `pos_order_id` นี้ใน `orders` แล้ว → **`rejected ALREADY_PRESENT`** (ตระกูลเดียวกับ `CONFLICT` — ห้ามกันบิลจริงออก) · ส่งซ้ำเนื้อหาเดิม = `duplicate` · บิลที่ถูกกันออกทุกใบ (ไม่ว่ากันออกก่อนหรือหลัง Z) ส่ง `order_excluded` หลัง `shift_close` · **เงินของบิลที่ถูกกันออก**: เงินสดถูกนับใน Z เดิมแล้ว (จาก snapshot) → **ห้ามบันทึก `PAID_IN`/`PAID_OUT` ในกะปัจจุบันสำหรับกรณีนี้** · รายได้เข้ารายงานกลางจาก `pos_excluded_orders` (ยอด + `sold_at` + เหตุผล) นับครั้งเดียว — ยอดขายรวมและ `dashboard_net_profit` บวกยอดนี้ตามวันที่ไทยของ `sold_at` พร้อมป้าย "บิลนอกระบบกลาง" (ต้นทุนไม่ทราบ = 0 พร้อมป้าย) · ข้อจำกัดที่ยอมรับ: บิลที่ถูกกันออกของกะ `local_only` หรือช่วงก้อน 2 (ไม่มีกะในฐาน) ไม่มีทางส่ง `order_excluded` — รายได้นั้นอยู่เฉพาะในรายงานของแท็บเล็ต
- `GET /v1/pos/shift-cash?after=<ISO>&until=<ISO>` (scope `orders:read`): บิล `status='ok'`, วิธีชำระ `cash`, `source in ('line','web')` ที่ `created_at` อยู่ในช่วง **`(after, until]`** → `{bills:[{order_no, version, source, sold_at, total, created_by_name}], cash_total}` · **บิลบอทแต่ละใบถูกนับได้ครั้งเดียว**: `until` = `counted_at` ของการนับเงินครั้งนี้ · `after` = `counted_at` ของการนับครั้งก่อนของ API key นี้ (ไม่มี = 00:00 เวลาไทยของ `business_date` ของกะนี้) · ช่วงเก็บใน snapshot ของ Z · แท็บเล็ตเรียกตอนออก Z (Q15) · บิลบอทที่ไม่อยู่ใน Z ใดเลย หรือเปลี่ยน/ยกเลิกหลังถูกนับ → แดชบอร์ด "บิลบอทนอกใบปิดกะ"
- **เงินสดที่ควรมี (ล็อก)** = เงินทอนตั้งต้น + ยอดเงินสดของ **บิล POS ทุกใบใน `snapshot.pos_bills` ที่ `sold_at` ≤ `counted_at` รวมใบที่ยกเลิกภายหลัง** − Σ `VOID_REFUND` + Σ `PAID_IN` − Σ `PAID_OUT` − Σ `DROP` − ค่าใช้จ่ายจ่ายจากลิ้นชักของกะ (ก้อน 4) + Σ `snapshot.bot_bills` · แถวเงินสด/ค่าใช้จ่ายนับเฉพาะที่เวลาเครื่อง (`created_at` ของตารางเหล่านั้น) ≤ `counted_at` · ตรงกับ `packages/domain/src/shift.ts` เดิม (D36: ยอดขายรวมบิลที่ยกเลิก แล้วหักเงินคืนแยก)
- **ลำดับและเวลา** (ล็อก): แถวของกะเดียวกัน (`cash_movement`, `cash_count`, `shift_close`, ค่าใช้จ่ายจากลิ้นชัก) เป็น **ช่องเดียวกัน** ในคิวของแท็บเล็ต — แถวใดได้ `deferred` แถวที่ตามมาในช่องนั้นหยุดรอ (§6.2) · กติกาฝั่ง dayo ตัดสินด้วยเวลาในแถว (`created_at`/`counted_at`/`closed_at`) ไม่ใช่สถานะ ณ ตอนแถวมาถึง
- **ผูกทีหลัง** (ล็อก): บิล/ค่าใช้จ่ายที่อ้าง `shift_id` ที่ยังไม่มีในฐาน **บันทึกได้ทันที** (ไม่มี FK) · Z ที่มาถึงก่อนบิลของกะ = `waiting_bills` จนบิลครบ (ข้างบน) · `order_excluded` ตามสัญญาข้างบน · **แถวกะ/เงินสดของกะที่เปิดก่อนก้อน 3 ใช้งานจริงเป็น `local_only` ไม่ส่ง** (§6.1) — กะแรกที่ส่งคือกะที่เปิดหลังก้อน 3 ขึ้น · บิลของกะ `local_only` ส่ง `shift_id: null` · **วันที่เปิดใช้ก้อน 3** เก็บใน `shop_settings.block3_live_from` (date — ตั้งตอนเปิดใช้) · รายการแดชบอร์ด "บิลบอทนอกใบปิดกะ" นับเฉพาะบิลที่ `sale_date` ≥ ค่านี้ · แถวที่เป็นของกะเอง (`cash_movement` `cash_count` `shift_close`) รอกะด้วย `deferred PARENT_PENDING` · กะที่ถูกปฏิเสธขึ้นหน้า "ส่งไม่ผ่าน" พร้อมแถวลูก (§6.4) · แดชบอร์ดแสดงบิลที่ `pos_shift_id` ยังไม่มีกะ
- แดชบอร์ด dayo: 1 บรรทัดต่อกะ "กะ 25 ก.ย. · เปิด 09:02 TungAo · ปิด 20:41 · ขาด ฿20" (Q20)

**ก้อน 4 — ค่าใช้จ่าย + กำไรสุทธิ** (P4 · scope `expense:write`)
- `expense_categories` (แก้บนเว็บ owner · มากับ E1 เป็น `expense_categories: [{id, name, counts_in_profit, active}]` **ระดับเดียวกับ `staff`**): `counts_in_profit = false` สำหรับ "ซื้อวัตถุดิบเข้าสต็อก" (ต้นทุนนับผ่านต้นทุนขายแล้ว — กันนับซ้ำ)
- `expenses`: `spent_on date`, `category_id`, `description`, `amount > 0`, `paid_from` `drawer`/`bank`, `shift_id` (บังคับเมื่อ `drawer`), `pay_sheet_id` (ก้อน 6), `created_by`, `voided_at/voided_by/void_reason` (ตั้งครั้งเดียว)
- ชนิด push: `expense` · `expense_void` (จ่ายจากลิ้นชักยกเลิกได้เมื่อ `voided_at` ≤ `counted_at` ของการนับเงินของกะนั้น หรือกะยังไม่ถูกนับ — ตัดสินด้วยเวลาในแถว · จากธนาคารยกเลิกได้เสมอ)
- กำไรสุทธิ (RPC `dashboard_net_profit`) = Σ `total_amount` บิล ok ทุกแหล่ง + Σ `pos_excluded_orders.total` (ตามวันที่ไทยของ `sold_at` · ป้าย "บิลนอกระบบกลาง" · ก้อน 3) − Σ `channel_fee_amount` − Σ `cost_total` − Σ ค่าใช้จ่ายที่ไม่ถูกยกเลิกและ `counts_in_profit` (ตาม `spent_on`) · แสดงบนแดชบอร์ดเว็บ (owner) และบนแท็บเล็ตเฉพาะ owner (Q45) ผ่าน endpoint ด้านล่าง
- **`POST /v1/pos/profit`** (scope ใหม่ `reports:profit` — **ปิดเป็นค่าเริ่มต้น** owner เปิดให้ key ของเครื่องขายเองบนเว็บ) · body `{staff_id, from, to}` (`YYYY-MM-DD` · ช่วง ≤ 366 วัน) · ใช้ POST เพื่อไม่ให้ `staff_id`/ช่วงวันอยู่ใน URL และ log · RPC `api_pos_net_profit(p_shop_id, p_api_client_id, p_staff_id, p_from, p_to)`:
  0. ⚠ **รอคำตอบเจ้าของ Q54** — การตรวจในข้อ 1 ตรวจ "ข้ออ้าง" `staff_id` ไม่ใช่การพิสูจน์ตัวตน (§7 ข้อ 10) · ยังไม่ออกแบบใหม่จนกว่าเจ้าของตอบ · ก้อน 4 ยังไม่ล็อกข้อนี้
  1. **ตรวจที่เซิร์ฟเวอร์ทุกครั้ง** ไม่เชื่อบทบาทที่แท็บเล็ตอ้าง: `staff_id` ต้องเป็นพนักงานของร้าน `status='active'` และ `role='owner'` ณ ตอนเรียก ไม่งั้น `DY403 owner_only` (ข้อความเดียวกันทุกกรณี ไม่บอกว่าผิดข้อไหน)
  2. คำตอบ `{from, to, bills, revenue, channel_fees, cost_of_goods, gross_profit, expenses_total, expenses_by_category:[{category, amount}], net_profit, generated_at}` (บาท) · **ยอดรวมเท่านั้น** ไม่มีต้นทุนรายเมนู/รายวัตถุดิบ/สูตร/ราคาซื้อ
  3. หัว `Cache-Control: no-store` · ทุกครั้งที่เรียก (สำเร็จหรือถูกปฏิเสธ) เขียน `audit_log` action ใหม่ `profit_view` — **RPC ไม่ raise** เมื่อปฏิเสธ แต่คืน JSON `{ok:false, error:{code:'DY403'}}` (แบบ `api_authenticate`) เพื่อให้แถว audit ถูก commit แล้ว route แปลงเป็น HTTP 403 (`staff_id`, `api_client_id`, ช่วงวัน, ผล) · แดชบอร์ดเว็บแสดง "ดูกำไรจากแท็บเล็ตล่าสุด: <เวลา> โดย <ชื่อ>"
  4. ฝั่งแท็บเล็ต: เมนู "กำไร" แสดงเฉพาะเมื่อผู้ล็อกอินมีบทบาท owner ในสำเนารายชื่อ (ความสะดวกเท่านั้น — สิทธิ์จริงอยู่ข้อ 1) · ก่อนเปิดหน้าต้องใส่ PIN owner ซ้ำ · ผลเก็บใน **หน่วยความจำของหน้าจอเท่านั้น**: ไม่เขียน SQLite/OPFS/IndexedDB/localStorage ไม่เข้า outbox ไม่อยู่ในไฟล์สำรองของ POS · service worker ไม่ cache เส้นทาง `/api/v1/pos/profit` · ล้างทันทีเมื่อออกจากระบบ สลับผู้ใช้ ล็อกจอ (อัตโนมัติหรือกดเอง) หรือออกจากหน้า · ออฟไลน์ = "ต้องออนไลน์เพื่อดูกำไร"
  5. แก้ ADR-0035 ข้อ 3 / ADR-0040 ข้อ 3 (API ไม่มีต้นทุน/กำไร) ด้วยข้อยกเว้นเดียวนี้ (P4) · endpoint อื่นทั้งหมดยังไม่มีต้นทุน/กำไร

**ก้อน 5 — ต้นทุนถัวเฉลี่ยเคลื่อนที่** (P5 · ไม่มี endpoint ใหม่ของ POS)
- `ingredients`: เพิ่ม `avg_cost_per_use_unit numeric(14,6)` (ตั้งต้น = ต้นทุนจาก Excel/ราคาปัจจุบัน) · `buy_price` เดิมเปลี่ยนความหมายเป็น **ราคาอ้างอิง** (นำเข้า/แก้หน้าเว็บเปลี่ยนแค่ค่านี้)
- รับเข้า (เว็บ/บอท) ที่มีราคา: `avg ใหม่ = (คงเหลือ × avg เดิม + จำนวนรับ × ราคาต่อหน่วยใช้ที่จ่ายจริง) ÷ (คงเหลือ + จำนวนรับ)` · คงเหลือก่อนรับ ≤ 0 → avg ใหม่ = ราคาที่รับ · หลายบรรทัดวัตถุดิบเดียวกันในใบเดียวรวมก่อน (D57) · ปัด 6 ตำแหน่งครึ่งออกจากศูนย์
- ขาย: ต้นทุนแช่แข็ง = avg ณ ตอนขาย (`v_variant_cost` ใช้ avg) · นับ/ของเสีย/ปรับ ไม่เปลี่ยน avg · รับเข้าผ่าน API (ADR-0041) ไม่เปลี่ยน avg

**ก้อน 6 — ตอกบัตร + เงินเดือน** (P6 · scope `payroll:write`)
- `staff_pay_profiles`: `staff_id`, `pay_type` `monthly`/`daily`/`hourly`, `rate`, `pay_cycle` `monthly`/`weekly`, `effective_from date`, `created_by` (แถวใหม่ = เปลี่ยนอัตรา)
- `time_punches`: `staff_id`, `kind` `in`/`out`, `at`, `created_by` (= เจ้าตัว ยืนยันด้วย PIN ตัวเอง) · `time_punch_fixes`: `punch_id` หรือแถวใหม่ที่ลืมตอก, `new_at`, `reason`, `approved_by` (owner)
- `pay_sheets`: `staff_id`, `period_from`, `period_to`, `status` `approved`/`void`, `gross`, `net`, `approved_by`, `approved_at` · `pay_sheet_lines`: `kind` (`salary`/`days`/`hours`/`addition`/`deduction`/`social_security`), `description`, `qty`, `rate`, `amount`
- จ่ายเงิน = แถว `expenses` หมวด "เงินเดือน" อ้าง `pay_sheet_id` (จ่ายจากลิ้นชัก → ลดเงินสดที่ควรมีของกะ)
- dayo คิดใบเงินเดือนซ้ำจากตอกบัตร+อัตราในฐาน ต่างกัน → `pay_sheets.calc_mismatch = true` บันทึกตามที่ owner อนุมัติ
- ชนิด push: `pay_profile` · `time_punch` · `time_punch_fix` · `pay_sheet` · `GET /v1/pos/payroll-data?from=` (ดึงกลับเมื่อเปลี่ยนเครื่อง)
- ต้องล็อกก่อนก้อน 6: หน่วยนับเวลา (นาทีเต็ม) · วันทำงานของรายวัน (วันที่มีคู่เข้า-ออกครบ) · ตัวอย่างตัวเลขที่เทสต์ต้องได้

### 4.11 วิธีคุมสัญญาให้สองทีมทำขนานกัน

1. สัญญาข้างบน (§4.1–4.9) เป็น zod schema ใน POS `packages/contracts/src/dayo-api.ts`: `PosCatalogResponse`, `PushRequest`, `PushRow` (ต่อชนิด), `PushResponse` (แบบยอมรับค่าที่ไม่รู้จัก — ลอก `ReceivedRowResult` จากแผน 5), `OrdersListResponse`
2. ตัวอย่าง JSON ในเอกสารนี้เก็บเป็นไฟล์ `packages/contracts/fixtures/dayo-api/*.json` (คำขอ + คำตอบ ต่อสถานการณ์: ใหม่ ซ้ำ ชนใบเสร็จ key เดิมเนื้อหาต่าง ยกเลิกข้ามวัน ยกเลิกนาฬิกาเร็ว รหัสไม่รู้จัก ชนิดไม่รู้จัก error ไม่คาดคิดของแถว ฉบับไม่เปลี่ยน · 401/404/429 พร้อมหัว CORS) · เทสต์ POS: ทุกไฟล์ผ่าน schema · เจ้าของส่งชุดไฟล์เดียวกันให้ session dayo ใช้เป็นเทสต์ของ Route Handler (dayo ไม่ import แพ็กเกจ POS)
3. ก้อน 2 ใช้ **mock server** ที่สร้างจาก schema + fixture (`apps/pos` dev/test) จนก้อน 1 เสร็จ แล้วทดสอบเชื่อมจริงกับ Supabase local + `npm run dev:web` ของ dayo (`API_V1_ENABLED=1` เฉพาะเครื่อง dev) ก่อนเปิดใน production

---

## 5. เงินและราคา

### 5.1 แท็บเล็ตใช้ตัวคิดราคาของ dayo (Q8)

- **สำเนาโค้ดที่ปักรุ่น** (Q48): คัดลอก `packages/shared/src/{money,promotions,cost,fmt,shopSettings,types}.ts` และไฟล์ที่ไฟล์เหล่านี้ import (ไม่รวม `xlsx`) ไปไว้ที่ POS `packages/dayo-pricing/src/vendor/` ไม่แก้แม้แต่บรรทัดเดียว · `packages/dayo-pricing/VENDOR.json` = `{ "repo": "dayo-shop-system", "commit": "<sha>", "files": { "<path>": "<sha256>" } }`
- สคริปต์ `pnpm --filter @dayo/dayo-pricing vendor:check` เทียบ sha256 ของไฟล์ในโฟลเดอร์กับ `VENDOR.json` (รันในเทสต์เสมอ) · `vendor:update <path-to-dayo>` คัดลอกใหม่ + อัปเดต `VENDOR.json` (ทำโดยคนเมื่อ dayo เปลี่ยนตัวคิดราคา)
- ตัวห่อ `@dayo/domain` → `priceCart(cart, catalog, now)` เรียก `computeOrder` แล้วแปลงด้วย `edgeBahtToSatang` (§4.2) **เฉพาะฟิลด์เงินเหล่านี้**: `itemsSubtotal` `itemsDiscount` `billDiscountAmount` `totalAmount` `channelFeeAmount` · `lines[].unitPrice` `lines[].discountPerCup` `lines[].lineTotal` · `promotionsApplied[].discountAmount` · **ไม่แปลง** `costTotal` `grossProfit` `gpPercent` `lines[].unitCost` (ต้นทุนเป็น 0 ในแท็บเล็ต · `gpPercent` ไม่ใช่เงิน) · `packages/domain/src/pricing.ts` เดิมของ POS เลิกใช้ (§11)
- **คิดราคาใหม่ ณ วินาทีชำระ**: ตอนกดชำระ แท็บเล็ตเรียก `priceCart(cart, catalog, sold_at)` ด้วย `sold_at` ตัวเดียวกับที่จะส่ง (`sale_time` ตัดวินาทีตาม §4.5) · ผลต่างจากยอดที่ลูกค้าเห็น → กลไก `PRICE_CHANGED` (D50 Q3-27) · `totals` ของ E2 = ผลของการคิดครั้งนี้เท่านั้น
- ร่างที่ส่งเข้า `computeOrder` ใช้ค่าที่ตีความแล้วเสมอ (`milk`, `grade` ไม่เป็น null ตาม §4.5) · `no_promotions` = ส่ง `skipPromotionIds` เป็น id โปรทุกตัว
- ชื่อแพ็กเกจ: dayo ใช้ `@dayo/shared` · POS ใช้ scope `@dayo/*` เหมือนกัน → ห้ามตั้งชื่อ POS ว่า `@dayo/shared` (สำเนาอยู่ใต้ `@dayo/dayo-pricing` เท่านั้น)

### 5.2 เทสต์เทียบตัวเลขข้ามระบบ (parity) — 3 ชั้น

| ชั้น | อยู่ที่ | ตรวจอะไร |
|---|---|---|
| ก | dayo (มีอยู่แล้ว + เพิ่มเคส) | `computeOrder` ของ shared = `quote_order` ของ SQL (กฎเหล็กข้อ 3 ของ dayo) · P1 เพิ่มเคสในข้อ 5.3 ลงเทสต์ที่มีอยู่ |
| ข | dayo → POS | สคริปต์ dayo `scripts/export-pos-parity.ts` (P1) **รันบน commit ที่ deploy อยู่จริง** (= `pricing.commit` ของ E1 production) · ดึง catalog ด้วย **`api_pos_catalog` จริง** (ไม่ประกอบเอง — จับบั๊กการแปลงชื่อฟิลด์) · รันเคสใน 5.3 กับ `quote_order` บน Supabase local แล้วเขียน `pos-parity.json` = `{dayo_commit, pricing_files_sha256, catalog, cases:[{draft, expected}]}` · เจ้าของคัดลอกไฟล์มา POS `packages/dayo-pricing/fixtures/` |
| ค | POS | ต่อทุกเคสใน `pos-parity.json`: `priceCart` ได้สตางค์ **เท่ากันทุกฟิลด์เงิน** กับ `edgeBahtToSatang(expected.*)` (ต่าง 0 สตางค์) · `pricing_files_sha256` ของ fixture ต้องเท่ากับ `VENDOR.json.files` ไม่งั้นเทสต์ล้มพร้อมข้อความ "ตัวคิดราคาในเครื่องไม่ตรงรุ่นกับ dayo" · ทุกครั้งที่ E1 production รายงาน `files_sha256` ต่างจาก `VENDOR.json` → `vendor:update` + export ใหม่ + รันชั้น ค ก่อน deploy POS |

### 5.3 เคสที่ต้องมีในชุด parity (หลุมจาก 03 §11.4 และจากโค้ดจริง)

1. ส่วนลดเปอร์เซ็นต์ที่ได้เศษครึ่งสตางค์: 15% ของ 35 (5.25) · 15% ของ 45 (6.75) · 7% ของ 85 (5.95) · 33% ของ 65 (21.45)
2. ค่าที่ float ปัดผิดบ่อย: ราคา × `(1 + 0.07)` แล้ว `ceil_baht` · ราคาแบบ 36.675 ที่ `round2` ต้องได้ 36.68
3. ช่องทางบวก % + บวกบาท + ปัดขึ้นบาทเต็ม + ค่าธรรมเนียม % (`round2(total × feePct)`)
4. ส่วนลดทั้งบิลเปอร์เซ็นต์จากยอดหลังส่วนลดรายแก้ว · ส่วนลดทั้งบิลที่ชน `max_amount`
5. `bundle` ที่กระจายส่วนต่างตามสัดส่วนแล้วเศษไปแก้วสุดท้าย · `buy_n_get_m` ที่แตกบรรทัด qty=4 เป็นแก้ว (§4.2 ข้อ 8)
6. นมโอ๊ต + เกรดผง (ตัวอย่าง ฿180 ใน DATA-CONTRACT §4.2 ข้อ 9) · นมโอ๊ตกับเมนูที่ไม่มีนมสดในสูตร (ต้อง `ok=false`)
7. โปรจำกัดเวลา: `sold_at` ก่อน/ในช่วง/หลังช่วง · ข้ามวันในสัปดาห์
8. `skip_promotion_ids` · `no_promotions` (แท็บเล็ตใช้ skip ทุกตัว = SQL `no_promotions`) · `promo_code` ที่ `requires_code`
9. qty สูงสุด (`maxQtyPerLine`) · 50 รายการ · 500 แก้ว
10. แก้วฟรี/ลดจนเหลือ 0 ที่ไม่มีหมายเหตุ (ต้อง `ok=false` ทั้งสองฝั่ง)
11. ร้านตั้ง `defaultMilk = oat` (แท็บเล็ตส่ง `milk` ที่ตีความแล้ว)
12. โปรที่มี `channelCodes` (ใช้ได้เฉพาะบางช่องทาง)
13. ขอบเวลา: `sold_at` นาทีเดียวกับ `timeTo` และ `timeFrom` (เช่น 14:00:59 เทียบ `timeTo` 14:00) · การตัดวินาทีของ `sale_time`
14. ตัวแปร/ตัวเลือก/โปรที่ถูกปิดใช้หลังขาย (ฝั่ง dayo คิดด้วย include_inactive ต้องได้ยอดเดียวกับตอนขาย)
15. `bill_discount` ที่ส่งทั้ง `baht` และ `percent` → แท็บเล็ตไม่สร้างร่างแบบนี้ และ dayo ตอบ `INVALID`

### 5.4 หลุมอื่นที่ต้องระวัง (ล็อก)

- **เปอร์เซ็นต์สองแบบ** (§4.1): ช่องทางเป็นสัดส่วน · ส่วนลด/โปรเป็นร้อยละ
- **ต้นทุนรายบิลไม่มาถึงแท็บเล็ต** (ต้นทุน/กำไรแบบยอดรวมมาได้เฉพาะหน้ากำไรของ owner — §4.10 ก้อน 4): `cost_satang` ของบิลในเครื่องเป็น 0 และไม่แสดง · ต้นทุนจริงอยู่ที่ dayo (แช่แข็งตอนบิลเข้า)
- **ภาษี**: dayo ไม่มี VAT · `vat_satang` ในเครื่องเป็น 0 ไม่ส่ง
- **ยอดที่แท็บเล็ตส่งคือยอดที่เก็บเงินจริง** — ถ้าคิดด้วยแคตตาล็อกฉบับเก่า dayo บันทึกตามที่ส่งและติดธง ไม่แก้ยอดของแท็บเล็ต
- **อย่าคิดราคาซ้ำบนเซิร์ฟเวอร์ด้วยค่าจากแท็บเล็ต**: `pos_amounts` ใช้แค่ยอดระดับบิล · รายการ/ต้นทุน/สต็อกใช้ผลที่ dayo คิด (พฤติกรรม `create_order` เดิม)
- **ห้ามบวกบาท float ในแท็บเล็ต** (Z report, ยอดกะ) — บวกสตางค์

---

## 6. ออฟไลน์และการส่งข้อมูล

### 6.1 outbox (ใช้ของเดิมบน main)
- ทุกการเขียนที่ต้องส่ง (บิล ยกเลิกบิล · ก้อน 3–6: กะ เงินสด ค่าใช้จ่าย ตอกบัตร) เขียนลงตารางของมัน **และ** `outbox` ในธุรกรรมเดียว (`enqueueOutbox` — `apps/pos/src/db/outbox.ts`)
- **`local_only`** (สถานะใหม่ของแถว outbox): แถวกะ/เงินสดทุกชนิด (`shift`, `cash_movement` รวม `VOID_REFUND`, `cash_count`, `z_report`) ของกะที่เปิดก่อนก้อน 3 ใช้งานจริง เขียนเป็น `local_only` และ **ไม่ถูกส่งตลอดไป** (กะเหล่านั้นไม่เคยมีในฐานกลาง) · ไม่นับในป้าย "ยังไม่ส่ง" · ไม่ขึ้นหน้า "ส่งไม่ผ่าน" · ข้อมูลยังอยู่ในรายงานและไฟล์สำรองของเครื่อง
- `outbox.rowJson` = `data` ของ E2 ที่พร้อมส่ง (เงินแปลงเป็นบาทแล้ว ณ ตอนเขียน) · `idempotencyKey` = `<kind>:<uuid>` · **การลองใหม่อัตโนมัติส่งข้อความเดิมทุกไบต์เสมอ** · ข้อยกเว้นเดียว: ทางแก้ของ owner (§6.4) แก้ `rowJson` ของแถวที่ได้ `rejected` แล้วส่งด้วย key เดิมได้ — ทำได้เพราะผล `rejected` ไม่ถูกเก็บใต้ key (§4.5) · ห้ามแก้แถวที่เคย `accepted`/`duplicate` หรือแถวที่ยังรอคำตอบ
- `OutboxTable` เดิม (16 ตาราง) ลดเหลือชนิดของ E2 · แถวสต็อก/ผลิต/ซื้อ ไม่ถูกเขียนอีก (§11)

### 6.2 ตัวส่ง (ใช้แนวคิด Task 9 แผน 5)
- ส่งครั้งละ ≤ 20 แถว เรียงตาม `createdAt` · มีคำขอค้างได้ครั้งละ 1 (Web Locks API `navigator.locks` ชื่อ `dayo-push` กันหลายแท็บ)
- ปลุกเมื่อ: บันทึกเสร็จ (หน่วง 2 วินาที) · ทุก 60 วินาทีเมื่อมีของค้าง · event `online` · เปิดแอป · ก่อนปิดกะ
- อ่านคำตอบด้วย schema แบบยอมรับค่าที่ไม่รู้จัก · จับคู่คำตัดสินด้วย `key` ไม่ใช่ลำดับ · แถวที่ไม่มีคำตัดสินในคำตอบ = ยังไม่รู้ผล (ลองใหม่)
- แถวลูกรอแถวแม่: `order_void` ของบิลที่ยังไม่ `accepted` ไม่ถูกส่ง (ส่งก่อนได้ถ้าอยู่ในก้อนเดียวกันหลังแถวแม่) · แถวแม่ `rejected` → แถวลูกขึ้นหน้า "ส่งไม่ผ่าน" ทันทีด้วยเหตุผล `PARENT_REJECTED`
- **ช่อง (lane)**: แถวของกะเดียวกัน (`cash_movement` `cash_count` `shift_close` ค่าใช้จ่ายจากลิ้นชัก `expense_void`) เรียงกันในช่องของกะนั้น · แถวใดในช่องได้ `deferred` → แถวหลังจากนั้นในช่องเดียวกันไม่ถูกส่งจนแถวนั้นผ่าน · บิล (`order`) ไม่อยู่ในช่องของกะ (ผูกทีหลังได้ — §4.10) · แถวต่างช่องเดินต่อได้
- แถวที่ชนิดไม่อยู่ใน `supported_kinds` หรือใช้ฟิลด์ที่ไม่อยู่ใน `supported_fields` ล่าสุดของ E1 ไม่ถูกส่ง (รอใน outbox ไม่นับเป็นครั้งลองใหม่ ไม่เป็น STUCK) · แถว `local_only` ไม่ถูกส่งเลย
- คำขอทั้งก้อนได้ 5xx ติดกัน 3 ครั้ง → ลดก้อนเหลือ 1 แถวแบบเดียวกับกรณี 422 เพื่อไม่ให้ก้อนใหญ่ค้างทั้งคิว
- ป้าย "ยังไม่ส่ง N รายการ" นับบิลตาม D50 Q3-26 เดิม

### 6.3 ลองใหม่
| ผล | ทำอะไร |
|---|---|
| เน็ตหลุด / timeout 20 วินาที / 5xx | ลองทั้งก้อนใหม่ backoff 5 วิ → 15 วิ → 1 นาที → 5 นาที → 15 นาที (ค้างที่ 15 นาที) + สุ่มคลาด ±20% |
| 429 | รอตาม `Retry-After` (อ่านได้เพราะ `Access-Control-Expose-Headers`) แล้วลองใหม่ · อ่านไม่ได้ = 60 วินาที |
| 401 | หยุดส่งทั้งหมด · จอแดง "กุญแจเครื่องถูกยกเลิก — ให้เจ้าของตั้งค่าใหม่" · ข้อมูลในเครื่องไม่หาย |
| 403 ทั้งคำขอ | หยุดส่ง · "กุญแจเครื่องไม่มีสิทธิ์ส่งข้อมูล" |
| 404 ที่ `/api/v1` | หยุดส่ง ลองทุก 15 นาที · "ระบบกลางปิด API อยู่" |
| 422 ทั้งคำขอ | บั๊กของแท็บเล็ต: ลดก้อนเหลือ 1 แถวเพื่อหาแถวที่ทำให้ล้ม · แถวนั้นไป "ส่งไม่ผ่าน" เหตุผล `ENVELOPE` · ที่เหลือส่งต่อ (คิวไม่ค้าง) |
| แถว `deferred` | แถวนั้น backoff ตามตารางบน (และหยุดแถวหลังจากนั้นในช่องเดียวกัน §6.2) · `CLOCK_AHEAD` → แถบเตือนนาฬิกา (§6.7) แล้วลองใหม่ · `UNSUPPORTED` → เก็บรอจน E1 รายงานชนิดและทุกฟิลด์ที่แถวใช้ (ไม่นับรวมใน 50 ครั้ง) · อื่น ๆ ครบ 50 ครั้ง → "ส่งไม่ผ่าน" เหตุผล `STUCK` (ยังกด "ลองใหม่" ได้) |
| แถว `rejected` | "ส่งไม่ผ่าน" ทันที ไม่ลองเอง · owner แก้ตาม §6.4 · คิวเดินต่อ |

### 6.4 หน้า "ส่งไม่ผ่าน" (owner)
แสดง: ชนิด · เลขใบเสร็จ/เวลา · เหตุผล + `detail` · แถวลูกที่รอ (`PARENT_REJECTED`) อยู่ใต้แถวแม่ · ปุ่ม "ลองใหม่" (กลับเข้าคิว) · ปุ่ม "ส่งออก JSON" · **ไม่มีปุ่มลบ** · บิลที่ส่งไม่ผ่านยังอยู่ในรายงานของแท็บเล็ตพร้อมป้าย "ยังไม่ถึงระบบกลาง"

**ทางแก้ของ owner (ล็อก)** — ทุกการแก้ต้องใส่ PIN owner + เหตุผล · เขียน event ในเครื่อง (`order_event` สำหรับบิล — เข้าโซ่แฮช) เก็บข้อมูลเดิมทั้งก้อน · **ห้ามแก้ยอดเงิน** (ยอดที่เก็บจริงคงเดิม) · ส่งใหม่ด้วย **key เดิม** (ผล rejected ไม่ถูกเก็บใต้ key — §4.5) · นี่คือข้อยกเว้นเดียวของกติกา "ลองใหม่ด้วยข้อความเดิมทุกไบต์" ใน §6.1 และใช้ได้เฉพาะแถว `rejected`:
| เหตุผล | ปุ่ม | ผล |
|---|---|---|
| `CONFLICT` (ใบเสร็จชน) | "ออกเลขใบเสร็จใหม่" | ได้เลขถัดไปของเครื่อง · event `RECEIPT_RENUMBERED {old, new}` · ใบเสร็จพิมพ์ซ้ำได้ |
| `UNKNOWN_CODE` | "เลือกรหัสแทน" | เลือกเมนู/ขนาด-ความหวาน/ตัวเลือก/ช่องทาง/วิธีชำระ ที่ active จากแคตตาล็อกล่าสุด แทนรหัสที่หาย · event `CODE_REMAPPED` |
| `UNKNOWN_STAFF` | "เลือกผู้ขายแทน" | เลือกพนักงานในรายชื่อล่าสุด · event `STAFF_REMAPPED` |
| `INVALID` / `FORBIDDEN` / `BAD_KEY` | "ปิดเป็นรายการนอกระบบกลาง" (owner เท่านั้น) | แถวหยุดส่ง ถาวร · บิลติด `excluded=true` ใน `snapshot.pos_bills` ของ Z · ส่งแถว `order_excluded` หลัง `shift_close` ของกะนั้น (§4.10 ก้อน 3) · **ไม่บันทึก `PAID_IN`/`PAID_OUT` หรือค่าใช้จ่ายสำหรับกรณีนี้** — เงินสดถูกนับใน Z เดิมแล้ว และรายได้เข้ารายงานกลางผ่าน `pos_excluded_orders` (ต่างจากทางแก้ของ Q52 ซึ่งใช้กับบิลที่อยู่ในฐานแล้ว) · บิลยังอยู่ในรายงานเครื่อง · event `EXCLUDED_FROM_SYNC` |
- แถวกะ (`shift_open`) ที่ถูกปฏิเสธ: owner "แก้แล้วส่งใหม่" ได้เฉพาะ `opened_by` (เลือกพนักงานแทน) · บิลของกะไม่ถูกบล็อกอยู่แล้ว (ผูกทีหลัง)

### 6.5 แคตตาล็อกและพนักงาน
- ดึง E1 เมื่อเปิดแอป · ทุก 5 นาที (ส่ง `known_version`) · ก่อนเปิดกะ · หลังได้ 200 ที่มี `changed: true` → เขียนทับสำเนาในเครื่องในธุรกรรมเดียว + เก็บ `catalog_version`
- ออฟไลน์: ขายด้วยสำเนาล่าสุด · บิลบอกฉบับที่ใช้
- ฉบับเปลี่ยนระหว่างมีตะกร้า: ใช้กลไก `PRICE_CHANGED` เดิม (D50 Q3-27) — คิดราคาใหม่ แสดงยอดเดิม → ใหม่ ให้แคชเชียร์ยืนยัน
- พนักงานใหม่ในรายชื่อ → ต้องตั้ง PIN ที่แท็บเล็ต (owner อนุมัติด้วย PIN ตัวเอง) ก่อนล็อกอินได้ · `active: false` → ล็อกอินไม่ได้ทันที

### 6.6 เลขใบเสร็จ
- 1 เครื่อง = 1 prefix (`A`, `B`…) = 1 API key · เลขต่อเนื่องไม่มีช่องว่าง (spec POS §4.7 เดิม)
- ติดตั้งแอปใหม่ด้วย key เดิม: ตั้งเลขถัดไปจาก `client.last_receipt_no` ของ E1 (ต้องออนไลน์ตอนตั้งเครื่อง) · ถ้ายังชนได้ E2 ตอบ `CONFLICT` ไม่ใช่ `duplicate` (เพราะ `pos_order_id` ต่าง) — บิลไม่หายเงียบ

### 6.7 นาฬิกา
- `sold_at`/`voided_at`/`counted_at` มาจากนาฬิกาเครื่องและ dayo เชื่อ (ADR-0040 ข้อ 4) · E1/E2 คืน `server_time` → **ตามหลักเดิมของ D58 ที่ยกมาใช้ต่อ — รอบันทึกเป็น D ใหม่ (D79) พร้อม Q54**: นาฬิกาต่างเกิน 5 นาที = **แถบเตือนบนหน้าขาย + บรรทัดในหน้าสถานะระบบ · ไม่บล็อกการขาย** (ไม่บล็อกการยกเลิก เปิด/ปิดกะ นับเงินด้วย) · ออฟไลน์ไม่รู้เวลาเซิร์ฟเวอร์ = ใช้ความต่างล่าสุดที่วัดได้
- ฝั่ง dayo ยังตอบ `deferred CLOCK_AHEAD` ให้แถวที่เวลาเกินเวลาเซิร์ฟเวอร์ + 5 นาที (§4.5) → แถวนั้นรอในคิวจนเวลาเซิร์ฟเวอร์ตามทัน ไม่หาย · นาฬิกาเครื่องช้า (เวลาในแถวเก่ากว่าจริง) ไม่ถูกปฏิเสธ — ผลคือ `sold_at` คลาดและอาจกระทบโปรจำกัดเวลา/ธงซ้ำ ซึ่งแถบเตือนมีไว้ให้คนแก้นาฬิกา

### 6.8 ออฟไลน์ตอนปิดกะ (ก้อน 3)
ตอนปิดกะต้องดึงบิลเงินสดจากบอท (`GET /v1/pos/shift-cash`) จึงต้องออนไลน์ (Q15) · ถ้าออฟไลน์ (Q43): นับเงินบันทึกได้ตอนออฟไลน์ · ใบปิดกะ (Z) ออกเมื่อออนไลน์และดึงบิลบอทได้ · กะถัดไปเปิดได้ · แถบแดง "ใบปิดกะ <วันที่> รอออนไลน์" จนกว่าใบปิดกะออก

### 6.9 ความทนทานของข้อมูลในเครื่อง
- ขอ `navigator.storage.persist()` ตอนตั้งเครื่อง · แสดงสถานะบนหน้าตั้งค่า
- ไฟล์สำรองในเครื่องของ POS (หน้าสำรองเดิม) ยังใช้ได้ **แต่ต้องไม่มี API key** (§7)

---

## 7. ความปลอดภัย

1. **กุญแจเครื่อง**: owner สร้างที่ `/settings/api-clients` ของ dayo ชื่อ "แท็บเล็ตขาย 1" scope ตาม §4.1 · หน้าแสดงคีย์ครั้งเดียว **เป็นข้อความและ QR** (P1) · แท็บเล็ตหน้าตั้งค่าเครื่อง (owner PIN) สแกนหรือวาง → ทดสอบด้วย E1 → เก็บในค่าตั้งของเครื่อง (ไม่ sync ไม่อยู่ในไฟล์สำรอง ไม่แสดงอีก แสดงแค่ `dayo_` + 4 ตัวท้าย)
2. **เครื่องสำรอง**: มี key ของตัวเอง (prefix ใบเสร็จของตัวเอง) สร้างไว้แต่ **ปิดใช้** (`is_active=false`) จนต้องใช้ · ยกเลิกบิลของอีกเครื่องไม่ได้ (ADR-0040)
3. **เครื่องหาย/ถูกขโมย**: owner เพิกถอน key บนเว็บทันที → คำขอถัดไป 401 · บิลที่ยังไม่ส่งในเครื่องนั้นหาย (ยอมรับ — ลดความเสี่ยงด้วยการส่งทันทีที่ออนไลน์)
4. **สิทธิ์ของคำขอมาจาก key เท่านั้น** (ADR-0040) · `staff_id` = ผู้ทำ ไม่ใช่สิทธิ์ (ข้อยกเว้นเดียว: `POST /v1/pos/profit` ตรวจเพิ่มว่า `staff_id` เป็น owner — ข้อ 10) · ขอบเขตที่ key หลุดทำได้: ส่งบิล/ยกเลิกบิลของเครื่องตัวเองวันเดียวกัน · อ่านเมนู รายชื่อพนักงาน (ไม่มี LINE id) บิล (ไม่มีต้นทุน) · ก้อน 3–6 เพิ่มการส่งกะ/ค่าใช้จ่าย/ตอกบัตร · **ไม่มี** ต้นทุนรายเมนู/รายวัตถุดิบ ราคาซื้อ การแก้แคตตาล็อก · กำไร/ต้นทุนแบบยอดรวมได้เฉพาะ key ที่ owner เปิด scope `reports:profit` (ข้อ 10)
5. **PIN**: อยู่ในเครื่องเท่านั้น (Q9) · แฮชแบบเดิมของ POS · ล็อกเมื่อผิดตาม D50 Q3-21 · ล็อกหน้าจออัตโนมัติ 10 นาที (Q3-24)
6. **บทบาทบนแท็บเล็ต**: มาจาก `staff.role` ของ dayo · enum `UserRole` ของ POS ต้องเพิ่ม `manager` · ตารางสิทธิ์ตาม Q44 (§12)
7. **CORS** จำกัด origin (§4.1) — ไม่ใช่กำแพงความปลอดภัย (คำขอนอกเบราว์เซอร์ไม่สน CORS) แต่กันหน้าเว็บอื่นใช้ key ที่รั่วในเบราว์เซอร์
8. **ข้อความตอบกลับสะท้อนค่าที่ส่งมาได้เฉพาะ** วันที่/เวลา รหัสเมนู-ช่องทาง-วิธีชำระ เลขใบเสร็จ และ SQLSTATE · **ห้าม** สะท้อน id พนักงาน ข้อความอิสระ หรือข้อความ error ดิบของ Postgres (แบบ `resolveStaffRef` เดิม)
9. **ค่าลับทั้งหมดเจ้าของถือ**: API key · Supabase secret · DB URL สำหรับสำรอง · รหัสเข้ารหัสไฟล์สำรอง · token OneDrive · Discord webhook — agent ไม่เห็น ไม่อ่าน `.env*` / `.dev.vars` ของทั้งสอง repo
10. **รายงานกำไรบนแท็บเล็ต (Q45) — จุดที่ security-reviewer ต้องตรวจ**
    - ⚠ **รอคำตอบเจ้าของ Q54**: D69 บันทึกว่า "เซิร์ฟเวอร์เป็นคนตรวจ role จริง" แต่แบบนี้ตรวจแค่ `staff_id` ที่แท็บเล็ตอ้าง (ด้านล่าง) · รีวิวรอบ 1 ข้อ 5 เสนอให้เจ้าของเลือก: ยอมรับข้อจำกัดนี้เป็น D ใหม่ หรือเปลี่ยนเป็นการพิสูจน์ตัวตนจริง (เช่น token อายุสั้นที่ owner ออกจากเว็บ dayo ด้วยการล็อกอิน LINE แล้วสแกนเข้าแท็บเล็ต) · **ยังไม่ออกแบบใหม่** จนกว่าเจ้าของตอบ · endpoint นี้ห้ามเปิดใช้จนกว่า Q54 ปิด
    - การตรวจ `role='owner'` ที่เซิร์ฟเวอร์ตรวจ **ข้ออ้าง** `staff_id` ไม่ใช่การพิสูจน์ตัวตน: `id` ของ owner อยู่ในรายชื่อที่ E1 ส่งให้ทุก key ที่มี `staff:read` ดังนั้นใครถือ key ที่มี `reports:profit` ก็อ้าง `id` ของ owner ได้ · ด่านจริงคือ (ก) scope `reports:profit` ปิดเป็นค่าเริ่มต้น เปิดเฉพาะ key ของเครื่องขาย (ข) PIN owner บนแท็บเล็ต (ค) เพิกถอน key ได้ทันที · การตรวจบทบาทที่เซิร์ฟเวอร์กันกรณีสำเนารายชื่อในแท็บเล็ตเก่า (owner ถูกลดบทบาท/ปลดแล้ว) และกันบั๊กฝั่งแท็บเล็ต
    - ความเสี่ยงที่ยอมรับ: key ที่มี scope นี้รั่ว = ยอดรวมรายได้/ต้นทุนขาย/ค่าใช้จ่าย/กำไรรั่ว (ไม่มีต้นทุนรายเมนูหรือราคาซื้อ) · รับมือ: `audit_log` `profit_view` ทุกครั้ง + บรรทัด "ดูกำไรล่าสุด" บนแดชบอร์ด ให้ owner เห็นการเรียกที่ไม่ได้ทำเอง · อัตรา 60/นาที/key เดิม
    - ห้าม: เก็บผลลง SQLite/OPFS/IndexedDB/localStorage/Cache Storage · ใส่ในไฟล์สำรองหรือ log ของแท็บเล็ต · ส่ง `staff_id` ใน query string · ข้อความ `DY403` ที่บอกว่า `staff_id` นั้นมีอยู่แต่ไม่ใช่ owner
    - เทสต์บังคับ: ตามเกณฑ์ก้อน 4 ใน §9

---

## 8. สำรองข้อมูล (P7 — เพิ่มจาก ADR-0021 ไม่แทนที่)

| เรื่อง | กติกา |
|---|---|
| ทำที่ไหน | GitHub Actions ใน repo dayo `.github/workflows/backup.yml` · ตาราง `0 18 * * *` UTC (01:00 ไทย หลังร้านปิด) + กดเองได้ |
| ดึงข้อมูล | `pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=supabase_migrations` ผ่าน **session pooler** ของ Supabase (IPv4 — runner ของ GitHub ต่อ direct connection ที่เป็น IPv6 ไม่ได้) · ตัว `pg_dump` รุ่นหลักเดียวกับ Postgres ของโปรเจกต์ |
| manifest | จำนวนแถวต่อตาราง · `pg_database_size` · migration ล่าสุด · เวลา · sha256 ของ dump |
| เข้ารหัส | `tar` (dump + manifest) → `gpg --symmetric --cipher-algo AES256` ด้วยรหัสใน secret `BACKUP_PASSPHRASE` (Q42: เก็บเป็น GitHub secret เพื่อให้ซ้อมกู้อัตโนมัติได้ · **เจ้าของต้องเก็บสำเนานอก GitHub ด้วย** เช่นที่เก็บรหัสส่วนตัว — ไม่มีสำเนา = เปิดไฟล์สำรองไม่ได้ถ้าเสียบัญชี GitHub) |
| อัปโหลด | `rclone` ด้วยแอป Microsoft ของ rclone เอง (ไม่ลงทะเบียนแอป ไม่ผูกบัตร) · config ใน secret `RCLONE_CONF` (เจ้าของรัน `rclone config` ครั้งเดียว) · ปลายทาง `onedrive:DAYO/Backups/auto/daily/DA-YO_db_YYYY-MM-DD.tar.gpg` · วันที่ 1 ของเดือนคัดลอกไป `auto/monthly/` |
| เก็บไว้ | daily 30 ไฟล์ล่าสุด · monthly 12 ไฟล์ล่าสุด · ลบเก่าด้วย `rclone delete --min-age` |
| ตรวจหลังอัป | `rclone lsjson` เห็นไฟล์ + ขนาดตรง |
| บันทึกในระบบ | แทรก `backup_log` ชนิดใหม่ `auto` ผ่านฟังก์ชัน `backup_log_auto(p_row_counts, p_bytes)` → หน้าสำรองและคำเตือน "สำรองล่าสุด X วันก่อน" (ADR-0021/0046) นับรวมการสำรองอัตโนมัติ |
| ล้ม | ขั้น `if: failure()` ส่ง 🔴 ERROR + `@here` เข้า Discord ช่องระบบ `#dayo-ระบบ` (ADR-0044 · Q40) · GitHub ส่งอีเมลเมื่อ workflow ล้มอยู่แล้วอีกชั้น |
| ขนาดฐาน | job เดียวกันเตือน 🟡 เมื่อ `pg_database_size` ≥ 60% ของ 500 MB และ 🔴 เมื่อ ≥ 80% (§10.1) |
| ซ้อมกู้ | `.github/workflows/restore-test.yml` วันที่ 2 ของทุกเดือน: ดาวน์โหลดไฟล์ daily ล่าสุด → ถอดรหัส → `pg_restore` ลง service container `postgres:<รุ่นเดียวกัน>` → เทียบจำนวนแถวกับ manifest + ผลรวม `total_amount` รายเดือน → 📊 ผ่าน / 🔴 ไม่ผ่าน เข้า Discord |
| token OneDrive | token ของ Microsoft หมดอายุถ้าไม่ได้ใช้ 90 วัน · **token ที่ rclone ต่ออายุระหว่างรันอยู่ใน runner แล้วหายไปพร้อม runner** — **ขั้นท้ายของ workflow เขียน config ใหม่กลับเข้า secret `RCLONE_CONF` ทุกคืน** ด้วย `gh secret set` และ fine-grained PAT ที่เจ้าของสร้าง (สิทธิ์ "Secrets: read and write" เฉพาะ repo dayo · secret `GH_SECRETS_PAT`) · workflow เตือน 🟡 ใน Discord 14 วันก่อน PAT หมดอายุ (Q41) |
| สิทธิ์ DB | ใช้ role อ่านอย่างเดียว `dayo_backup` (SELECT ทุกตาราง + `BYPASSRLS` เพราะทุกตารางเปิด RLS ไม่มี policy + execute `backup_log_auto`) ถ้า Supabase ให้สร้าง role ที่มี `BYPASSRLS` ได้ · ไม่ได้ = ใช้ role `postgres` ผ่าน pooler และบันทึกความเสี่ยงไว้ใน ADR |
| ปุ่มสำรองเอง | คงเดิม (ADR-0021) |
| ฟรี | GitHub Actions private 2,000 นาที/เดือน — ใช้ราว 3 นาที/คืน + 5 นาที/เดือน ≈ 100 นาที/เดือน · OneDrive ฟรี 5 GB (§10.4) |
| ค่าลับที่เจ้าของตั้งใน GitHub | `SUPABASE_DB_URL` · `BACKUP_PASSPHRASE` · `RCLONE_CONF` · `DISCORD_ALERT_WEBHOOK_URL` · `GH_SECRETS_PAT` |

ข้อมูลในแท็บเล็ต: ส่วนที่ส่งแล้วอยู่ในไฟล์สำรองของฐานกลาง · ส่วนที่มีเฉพาะในเครื่อง (PIN แฮช · โซ่แฮช `order_event` · ของที่ยังไม่ส่ง) ใช้ปุ่มสำรองของ POS เดิม

---

## 9. ลำดับงาน 6 ก้อน

หนึ่งแผนต่อก้อน · ทดสอบบนแท็บเล็ตจริงไว้ท้ายสุด (D51) · ก้อน 1 กับ 2 ทำขนานกันได้เพราะสัญญา §4 ล็อกแล้วและ POS ใช้ mock server · ทุกก้อนที่มีงาน dayo: เจ้าของรับร่าง ADR เข้า repo dayo ก่อน แล้ว session ของ dayo ทำ

| ก้อน | ฝั่ง | ส่งมอบ | เกณฑ์เสร็จ (ตรวจได้) |
|---|---|---|---|
| 1 | dayo | P1 + P2 + P7: `catalog_versions` + trigger · E1 · E2 (ชนิด `order`/`order_void`) · ฟิลด์ใหม่ E3 · CORS · QR ของคีย์ · scope `staff:read` · คอลัมน์ใหม่ `orders` · ธงบิลซ้ำ + แดชบอร์ด · บิล POS อ่านอย่างเดียวบนเว็บ/บอท · รหัสเมนูที่ถูกอ้างเปลี่ยนไม่ได้ · สคริปต์ `export-pos-parity` · สำรองอัตโนมัติ + ซ้อมกู้ | `npm run ci` ผ่าน · ทุกไฟล์ fixture ใน §4.11 ผ่านเทสต์ Route Handler · เทสต์ DB: ส่งแถวเดิมซ้ำ = `duplicate` · key เดิมเนื้อหาต่าง = `CONFLICT` · **`receipt_no` เดิม + `pos_order_id` ใหม่ (ทั้งก่อนและหลังลบคีย์ 30 วัน) = `CONFLICT` ไม่ใช่ `duplicate`** · แถวที่ถูก rejected แล้วส่ง key เดิมด้วยข้อมูลที่แก้ = `accepted` · ทุกแถวในตารางแผนที่ error §4.5 ได้คำตัดสินตามตาราง และ error ที่ไม่ได้แผนที่ (เช่นบังคับ raise `XX000` ในเทสต์) = `deferred SERVER_ERROR` เฉพาะแถวนั้น HTTP 200 · `voided_at` เกินเวลาเซิร์ฟเวอร์ 7 นาที = `deferred CLOCK_AHEAD` · ชนิด/ฟิลด์ไม่รู้จัก = `deferred UNSUPPORTED` · `computed_total` มีทุกบิล · CORS: 401/404 (API ปิด)/429/5xx ทุกตัวมี `Access-Control-Allow-Origin` + `Vary: Origin` + `Access-Control-Expose-Headers: Retry-After` · `OPTIONS` = 204 แม้ API ปิด · E1 มี `pricing` และ `supported_kinds` · เปลี่ยนรหัสช่องทาง/วิธีชำระที่มีบิลอ้าง = `DY422` · ยกเลิกที่ `voided_at` วันเดียวกันแต่ส่งวันถัดไป = ผ่าน · `voided_at` คนละวัน = `FORBIDDEN` · พนักงาน `removed` = ผ่าน · ตัวแปรที่ปิดใช้แล้ว = ผ่าน · รหัสเมนูไม่รู้จัก = `UNKNOWN_CODE` แถวอื่นในก้อนยังผ่าน · แก้ราคาเมนู → ฉบับเพิ่ม · รับเข้าที่แก้ `buy_price` → ฉบับไม่เพิ่ม · บิลบอท + บิล POS รายการ/ยอดเดียวกันห่าง 9 นาที = ติดธง, ห่าง 11 นาที = ไม่ติด, แหล่งเดียวกัน = ไม่ติด · owner แก้บิล POS บนเว็บ = `DY403` · workflow สำรองรันสำเร็จ 3 คืนติด ไฟล์อยู่ใน OneDrive ถอดรหัสได้ · ซ้อมกู้ผ่าน 1 ครั้ง · บังคับให้ล้ม 1 ครั้งแล้ว Discord ได้ข้อความ · `API_V1_ENABLED` ยังปิดใน production |
| 2 | POS | ตารางแคตตาล็อกในเครื่องตามรูป E1 · `@dayo/dayo-pricing` (สำเนา + `VENDOR.json` + parity) · `money-edge.ts` · หน้าขาย: นมโอ๊ต/เกรดผง/โปรอัตโนมัติ/"ไม่ใช้โปร"/ราคาตามช่องทาง · ใบเสร็จแสดงเลขใบเสร็จ + คิว · พนักงานจาก E1 + ตั้ง PIN · ตัวส่ง outbox + คำตัดสินรายแถว + หน้า "ส่งไม่ผ่าน" · หน้าบิลบอท/เว็บวันนี้ (E3) · ตั้งเครื่องด้วยคีย์ · zod schema + fixture + mock server · ซ่อนงานสต็อก | `pnpm turbo run typecheck test` ผ่าน · parity ทุกเคสต่าง 0 สตางค์ · `vendor:check` ผ่าน · property test ของขอบเงินผ่าน · e2e (mock): ขายออฟไลน์ 5 บิล → ออนไลน์ → ส่งครบ ได้ `order_no` · ยกเลิกบิลก่อนส่ง → ส่งทั้งคู่ถูกลำดับ · แถว `rejected` ไม่ทำให้คิวค้าง · 401 หยุดส่ง (ในเบราว์เซอร์จริง ไม่ใช่เห็นเป็นเน็ตหลุด) · แก้แถว `CONFLICT` ด้วย "ออกเลขใบเสร็จใหม่" แล้วผ่าน · เทสต์เชื่อมจริงกับ dayo local บน commit ที่จะ deploy (ก้อน 1 เสร็จแล้ว): ขาย 20 บิลหลายแบบ (ครอบเคส §5.3) **`computed_total − total = 0` สตางค์ทุกบิล** · `pricing.files_sha256` ของ E1 = `VENDOR.json` · จากนั้นเจ้าของเปิด `API_V1_ENABLED=1` ใน production |
| 3 | dayo ∥ POS | P3: ตารางกะ/เงินสด/นับเงิน/Z + ชนิด push + `GET /v1/pos/shift-cash` + บรรทัดสรุปบนแดชบอร์ด ∥ POS: หน้าเปิด/ปิดกะ เงินเข้า-ออก นับเงิน Z ที่รวมบิลเงินสดจากบอท ส่งขึ้นฐานกลาง | ปิดกะที่มีบิลเงินสดจากบอท 3 ใบ → เงินสดที่ควรมีรวมบิลบอท · Z ในฐานกลาง `recompute_status='matched'` · **ขายออฟไลน์ทั้งกะแล้ว Z มาถึงก่อนบิล → `waiting_bills` (ไม่ใช่ mismatch) · บิลทยอยมาครบ → `matched` โดยไม่ต้องส่งอะไรเพิ่ม** · บิลในรายการมาครบแต่ตัวเลขต่าง → `mismatch` · บิลที่ owner ปิดเป็นนอกระบบกลาง (`excluded` / `order_excluded`) ไม่ทำให้ค้าง `waiting_bills` · ขายเงินสด ฿100 แล้วยกเลิกคืนเงิน → expected ไม่หักซ้ำ · สองกะในวันเดียว บิลบอทแต่ละใบอยู่ใน Z เดียว · แถว `local_only` ของกะก่อนก้อน 3 ไม่ถูกส่งและไม่ขึ้นหน้า "ส่งไม่ผ่าน" · ส่งกะซ้ำ = `duplicate` · ออฟไลน์ตอนปิดกะทำตาม Q43 (นับได้ · Z รอออนไลน์ · กะถัดไปเปิดได้) · แดชบอร์ดแสดงบรรทัดกะ · แก้ `cash_movements`/`z_reports` ในฐาน = raise |
| 4 | dayo ∥ POS | P4: `expense_categories` `expenses` + ชนิด push + `dashboard_net_profit` + `POST /v1/pos/profit` (scope `reports:profit`) ∥ POS: หน้าบันทึกค่าใช้จ่าย (ลิ้นชัก/ธนาคาร) · ค่าใช้จ่ายจากลิ้นชักลดเงินสดที่ควรมี · หน้ากำไรเฉพาะ owner | ค่าใช้จ่าย ฿120 จากลิ้นชัก → เงินสดที่ควรมีลด 120.00 ทั้งแท็บเล็ตและ RPC · หมวด "ซื้อวัตถุดิบเข้าสต็อก" ไม่ลดกำไรสุทธิ · กำไรสุทธิของเดือนตัวอย่างตรงกับที่คิดมือ · `/v1/pos/profit` ด้วย `staff_id` ของ manager/staff/owner ที่ถูกปลด/ไม่มีในร้าน = `DY403` ข้อความเดียวกัน · key ไม่มี scope = 403 · ทุกการเรียกมีแถว `audit_log` `profit_view` · e2e แท็บเล็ต: ออกจากระบบ/ล็อกจอแล้วตัวเลขหายจากหน้าจอ และไม่มีใน OPFS/IndexedDB/Cache Storage · security-reviewer ตรวจก้อนนี้ |
| 5 | dayo | P5: ต้นทุนถัวเฉลี่ย · ราคาอ้างอิง · นำเข้าเปลี่ยนแค่ราคาอ้างอิง · บิลแช่แข็งต้นทุน avg | รับ 2 ครั้งราคาต่างกัน → avg ตามสูตร 6 ตำแหน่ง · คงเหลือติดลบแล้วรับ → avg = ราคาที่รับ · นำเข้าเทมเพลตแก้ราคา → avg ไม่เปลี่ยน · บิลเก่าไม่เปลี่ยนต้นทุน · เทสต์ ±0.01 ของ ADR-0026 ปรับตามความหมายใหม่ |
| 6 | dayo ∥ POS | P6: ตารางตอกบัตร/อัตรา/ใบเงินเดือน + ชนิด push ∥ POS: ตอกบัตรด้วย PIN ตัวเอง · owner แก้เวลาที่ลืมตอก · ใบเงินเดือนรายเดือน/รายสัปดาห์ · จ่าย = ค่าใช้จ่าย | ตัวอย่างที่ล็อกก่อนก้อน 6 ได้ตัวเลขตรงทุกสตางค์ · ใบที่มีการตอกไม่ครบคู่อนุมัติไม่ได้ · จ่ายจากลิ้นชักลดเงินสดที่ควรมีของกะ |
| ท้าย | POS | ทดสอบบนแท็บเล็ตจริง (D51) | ตามแผนทดสอบของ D51 |

---

## 10. ความเสี่ยงที่เหลือ

### 10.1 ฐานข้อมูลฟรี 500 MB — ประมาณการจากนิยามตารางจริงของ dayo

สมมติฐาน (150 แก้ว/วัน): 1.5 แก้ว/บิล → **100 บิล/วัน** · 1.3 รายการ/บิล → **130 `order_items`/วัน** · วัตถุดิบต่างชนิดต่อบิลหลังกระจายเบส (รวมแก้ว ฝา หลอด น้ำแข็ง) ≈ 9 → **~900 `stock_movements`/วัน** (`dayo_order_sync_stock` เขียน 1 แถวต่อวัตถุดิบต่อบิล) · แก้/ยกเลิก 3 บิล/วัน

| ตาราง | ขนาดต่อแถว (heap + ดัชนี) โดยประมาณ | ที่มาของตัวเลข | ต่อวัน |
|---|---|---|---|
| `orders` | ~0.8 KB | uuid 7–9 ตัว · เงิน `numeric` 8 ตัว · `pricing_context` jsonb ~150 B · คอลัมน์ใหม่ ~70 B · ดัชนี 8–9 ตัว | 80 KB |
| `order_items` | ~1.15 KB | `cost_snapshot_json` ≈ 6 วัตถุดิบ × ~110 B (uuid ข้อความ 36 + รหัส + ชื่อไทย ~30 B + qty + หน่วย + ต้นทุน) ≈ 0.7 KB · ชื่อเมนูไทย · ดัชนี 4 ตัว | 150 KB |
| `stock_movements` | ~0.3 KB | uuid 5 ตัว · `qty` · `unit_cost_at` · `detail '{}'` · ดัชนี 3 ตัว | 280 KB |
| `audit_log` | ~4 KB ต่อการแก้/ยกเลิก | before/after เป็น snapshot บิลเต็ม | 12 KB |
| อื่น ๆ (โปรในบิล ธงซ้ำ กะ เงินสด ค่าใช้จ่าย ตอกบัตร) | — | แถวน้อย | ~10 KB |
| **รวม** | | + 25% เผื่อแถวตาย (แก้บิล = ลบ/เขียน `order_items` ใหม่) และช่องว่างในหน้า/ดัชนี | **≈ 0.66 MB/วัน ≈ 20 MB/เดือน ≈ 240 MB/ปี** |

ไม่นับ: `api_idempotency_keys` (ลบเมื่อเกิน 30 วัน — คงที่ราว 2 MB) · `processed_events` (ลบเมื่อเกิน 3 วัน)
เผื่อเพิ่ม: `imports` (diff jsonb ทุกครั้งที่นำเข้า) · `audit_log` จากการแก้แคตตาล็อก · schema ระบบของ Supabase (auth/storage) → **สำรองเผื่อ ~5 MB/ปี** (ไม่เปลี่ยนตัวเลขเดือนด้านล่างอย่างมีนัย) · manifest ของงานสำรองทุกคืนเก็บขนาดจริงต่อตารางอยู่แล้ว → **ทบทวนประมาณการนี้หลังใช้งานจริง 1 เดือน**

ผล (ขนาดตั้งต้นสมมติ 50 MB — **ต้องวัดจริง**):
- ถึง 70% (350 MB) ในราว **15 เดือน** · เต็ม 500 MB ในราว **22 เดือน**
- กรณีแย่ (12 วัตถุดิบ/บิล, snapshot ใหญ่ขึ้น 50%, ≈ 28 MB/เดือน): 70% ใน ~11 เดือน · เต็มใน ~16 เดือน
- ตัวกินที่ใหญ่สุด: `stock_movements` (~50%) และ `cost_snapshot_json` (~20%)

วิธีวัดจริง (เจ้าของรันใน SQL editor ของ Supabase):
```sql
select pg_size_pretty(pg_database_size(current_database()));
select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) as total
from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 15;
select avg(pg_column_size(t.*)) from public.stock_movements t;   -- และ orders, order_items
```

รับมือ: เตือนอัตโนมัติ 60%/80% ใน workflow สำรอง (§8) · ก่อนถึง 70% เขียน ADR ใหม่ของ dayo เรื่องย้ายข้อมูลเก่า (เช่น `stock_movements` ที่เก่ากว่า 12 เดือนรวมเป็นยอดรายเดือนต่อวัตถุดิบ หลังสำรองเต็มแล้ว — ต้องมี ADR เพราะขัดกฎ append-only) · ทางเลือกลดขนาด `cost_snapshot_json` (ตัดชื่อวัตถุดิบ เหลือรหัส) ลดได้ราว 30% ของ `order_items`

### 10.2 โควตา Workers 100,000 คำขอ/วัน (รวมทั้งบัญชี)
แท็บเล็ต 1 เครื่อง เปิดร้านวันละ ~13 ชม.: E1 ทุก 5 นาที ~160 · E2 ~100–130 (ส่งหลังบิล + ลองใหม่) · E3 ขณะเปิดหน้า ≤ 160 · preflight CORS (cache 2 ชม.) ~20 · ปิดกะ 2 → **≈ 450–500 คำขอ/วัน ≈ 0.5% ของโควตา** · ทุกคำขอใช้ 2 subrequest (ตรวจ key + RPC) · อัตรา 60/นาที/key: ส่งของค้าง 300 แถว = 15 คำขอ ไม่ชน

### 10.3 CPU 10 ms ต่อคำขอ
E1 ตอนฉบับเปลี่ยนส่ง ~200 KB — `JSON.parse`+`stringify` ใน Worker อาจกิน 2–4 ms · ก้อน 1 ต้องวัด ถ้าเกิน 5 ms ให้ส่งต่อข้อความดิบจาก PostgREST โดยไม่ parse · E2 ก้อน 20 แถว parse ~20 KB ไม่น่ากังวล

### 10.4 OneDrive ฟรี 5 GB
ไฟล์ dump แบบ custom บีบอัดราว 20–30% ของขนาดข้อมูล · ปีแรก (~250 MB) ≈ 60 MB/ไฟล์ × 42 ไฟล์ ≈ 2.5 GB · ปีที่ 2 จะชนเพดานถ้าเก็บ 30+12 เท่าเดิม → workflow รายงานพื้นที่ OneDrive ที่เหลือ (`rclone about`) และเตือนเมื่อเหลือ < 1 GB

### 10.5 อื่น ๆ
| ความเสี่ยง | ทางรับมือ |
|---|---|
| dayo แก้ตัวคิดราคาแล้ว POS ไม่อัปเดตสำเนา | E1 `pricing.files_sha256` ≠ `VENDOR.json` → แถบเหลืองบนแท็บเล็ต · ทุกบิลมี `computed_total` ส่วนต่างแม้ 1 สตางค์เห็นทั้งในแท็บเล็ตและแดชบอร์ด · parity ชั้น ค ล้มจนกว่าจะ `vendor:update` |
| token OneDrive หมดอายุ | เขียน token กลับเข้า secret ทุกคืน (Q41) · PAT ใกล้หมดอายุ Discord เตือน · workflow ล้มแล้ว Discord เตือน |
| key บนแท็บเล็ตรั่ว | ขอบเขตจำกัดตาม §7 ข้อ 4 · เพิกถอนได้ทันที · อัตราจำกัด |
| นาฬิกาเครื่องเพี้ยน → `sold_at` ผิด → โปรจำกัดเวลา/ธงซ้ำผิด | §6.7 |
| ธงซ้ำหลอก (ลูกค้าสองคนสั่งเหมือนกันต่างช่องทางใน 10 นาที) | ไม่บล็อก · owner กด "ไม่ซ้ำ" · วัดจำนวนหลังใช้ 1 เดือน |
| แท็บเล็ตออฟไลน์นานหลายวัน | บิลรอในเครื่อง · เกิน 60 วัน = `INVALID` (ช่วง `sale_date`) — เตือนบนหน้าจอเมื่อมีของค้างเกิน 24 ชม. |
| Supabase ฟรีหยุดโปรเจกต์เมื่อเงียบ 7 วัน | heartbeat 08:00 เดิม (ADR-0011/0044) + การสำรองทุกคืน |
| Supabase ฟรีมีได้ 2 โปรเจกต์ (prod + test ครบแล้ว) | เทสต์เชื่อม POS ใช้ Supabase local ของ dayo (Docker) ไม่สร้างโปรเจกต์เพิ่ม |
| บิลบอทถูกแก้หลังปิดกะ | Z แช่แข็งรายการบิลบอทที่นับ (เลข + version) · แดชบอร์ดแสดงบิลที่เปลี่ยนหลังปิดกะ |

---

## 11. สิ่งที่ POS ทิ้ง / เก็บ

| ของ | ทำอย่างไร |
|---|---|
| เซิร์ฟเวอร์แผน 5 (NestJS `apps/api`, Neon, Render, ลงทะเบียนเครื่อง, pull, inbox flag) | **ไม่ merge เข้า main** · สาขา `plan-5-api-sync` และ `plan-5-draft` เก็บไว้เป็นหลักฐาน ห้ามลบ · D14/D15 (มีเซิร์ฟเวอร์ POS บน Render) ถูกแทนด้วย D59 |
| แนวคิดจากแผน 5 ที่ใช้ต่อ | รูปคำตัดสินรายแถว (`RowResult`/`ReceivedRowResult`/`rowResult` ที่ตัดความยาว) · การยอมรับค่าที่ไม่รู้จักฝั่งรับ · "แถวเสียห้ามทำคิวค้าง" · ตัวส่ง Task 9 · ย้ายเข้า `packages/contracts/src/dayo-api.ts` ตามสัญญา §4 |
| `outbox` + `enqueueOutbox` (main) | ใช้ต่อ · ชนิดลดเหลือชนิดของ E2 |
| งานสต็อกแผน 4 (หน้า Receive, Produce, Count, Adjust, Stock และ `api/*` ที่เกี่ยว) | **ซ่อน** จากเมนูและ router (Q11) · โค้ดคงไว้บน main จนเจ้าของสั่งลบ · ตารางสต็อกในเครื่องไม่ถูกเขียน · ตรรกะต้นทุนถัวเฉลี่ยใน `packages/domain/src/stock/` ใช้เป็นต้นแบบของ P5 |
| `packages/domain/src/pricing.ts` | เลิกใช้ในก้อน 2 (แทนด้วยสำเนาตัวคิดราคาของ dayo) · ลบพร้อมเทสต์ของมันเมื่อก้อน 2 ผ่านตรวจ |
| ตารางแคตตาล็อกในเครื่อง (`product`, `product_variant`, `size`, `sweetness_level`, `price`, `channel`…) | แทนด้วยตารางรูปเดียวกับ E1 (03 §11.1) |
| `packages/excel-import` | **เก็บ** ไว้อ้างอิงและเทียบตัวเลข (ครั้งเดียวตอนเริ่มก้อน 2: ราคาในแคตตาล็อก dayo เทียบกับไฟล์ Excel) · ไม่ใช่ที่มาของเมนูอีก |
| โซ่แฮช `order_event` + Z | อยู่ในแท็บเล็ต (Q23) · `z_reports.hash` ส่งขึ้นฐานกลางในก้อน 3 เป็นหลักฐาน |
| กะ/เงินสด/Z แผน 3b | ใช้ต่อ ปรับให้ส่งขึ้นฐานกลาง (ก้อน 3) และรวมบิลเงินสดจากบอท |
| LIFF สั่งผ่าน LINE (D25/D32) | เลื่อน (Q5) |
| `UserRole` `owner`/`staff` | เพิ่ม `manager` |

---

## 12. ตัดสินแล้ว (รอบ 7, 25 ก.ย. 2026)

Q40–Q53 บันทึกแล้วใน D67–D77 (`00-บันทึกการตัดสินใจ.md`) · เนื้อหาในสเปกและร่าง ADR แก้ตามนี้แล้ว · Q54 ยังรอ

| # | เรื่อง | ตัดสิน | อยู่ที่ |
|---|---|---|---|
| Q40 | แจ้งเตือนสำรองล้ม | Discord ช่องระบบ `#dayo-ระบบ` + `@here` ตาม ADR-0044 · ไม่ใช้ LINE | §8 · P7 |
| Q41 | token OneDrive ที่ rclone ต่ออายุ | เขียนกลับเข้า GitHub secret ทุกคืนด้วย fine-grained PAT ที่เจ้าของสร้าง · เตือนก่อน PAT หมดอายุ 14 วัน | §8 · P7 |
| Q42 | รหัสเข้ารหัสไฟล์สำรอง | เก็บเป็น GitHub secret (ซ้อมกู้รายเดือนอัตโนมัติ) · เจ้าของต้องเก็บสำเนานอก GitHub ด้วย | §8 · P7 |
| Q43 | ออฟไลน์ตอนปิดกะ | นับเงินได้ตอนออฟไลน์ · Z รอออนไลน์ · กะถัดไปเปิดได้ · แถบแดงจนกว่า Z ออก | §6.8 · P3 |
| Q44 | สิทธิ์ตามบทบาทบนแท็บเล็ต | **staff**: ขาย · ยกเลิกบิลตัวเองวันเดียวกัน (PIN owner อนุมัติตาม D50) · เปิด/ปิดกะ · เงินเข้า/ออก · นับเงิน · ตอกบัตรตัวเอง · **manager**: + บันทึกค่าใช้จ่าย · ดูรายงานกะ · **owner**: ทุกอย่าง + ตั้งเครื่อง/คีย์ · ตั้ง PIN คนอื่น · แก้เวลาตอกบัตร · อัตราค่าจ้าง · ใบเงินเดือน · หน้า "ส่งไม่ผ่าน" · หน้ากำไร (Q45) | §7 ข้อ 6 |
| Q45 | กำไรสุทธิบนแท็บเล็ต | **ได้ เฉพาะผู้ล็อกอินที่เป็น owner** (เปลี่ยนจากค่าที่สเปกแนะนำเดิม) · endpoint แยก `POST /v1/pos/profit` scope `reports:profit` · เซิร์ฟเวอร์ตรวจ `staff_id` เป็น owner ที่ active ทุกครั้ง · ไม่เก็บในเครื่อง ล้างเมื่อออกจากระบบ/ล็อกจอ · แก้ ADR-0035 ข้อ 3 / ADR-0040 ข้อ 3 เป็นข้อยกเว้นเดียว | §4.10 ก้อน 4 · §7 ข้อ 10 · P4 |
| Q46 | ใครบันทึกค่าใช้จ่าย | แท็บเล็ตเท่านั้นในตอนนี้ (ทั้งลิ้นชักและธนาคาร) · เว็บอ่านอย่างเดียว | §3 · P4 |
| Q47 | พนักงานรายวัน/รายชั่วโมงต้องอยู่ใน `staff` ของ dayo | ใช่ — ทุกคนเพิ่มบอทแล้ว owner อนุมัติบนเว็บ | P6 |
| Q48 | วิธีใช้ตัวคิดราคาของ dayo | สำเนาไฟล์ปักรุ่นกับ commit ของ dayo + ตรวจ sha256 | §5.1 |
| Q49 | owner ปรับต้นทุนเฉลี่ยเอง | ได้ ต้องใส่เหตุผล มีประวัติใน `audit_log` · ไม่แก้บิลเก่า | §4.10 ก้อน 5 · P5 |
| Q50 | นำเข้าแบบทับทั้งหมดที่ไฟล์ขาดชีต/คอลัมน์ | ปฏิเสธทั้งไฟล์ **ก่อนเขียนอะไร** และบอกเป็นภาษาไทยว่าขาดชีตไหน และชีตไหนขาดคอลัมน์บังคับอะไร | P8 |
| Q51 | รหัสเมนูที่มีบิลอ้างแล้ว | ล็อก เปลี่ยนไม่ได้ (เปลี่ยนชื่อไทย/ชื่อพ้องแทน) · ผู้คุมงานขยายไปถึงรหัสช่องทางและวิธีชำระ (รีวิวข้อ 13) | §4.9 · P2 |
| Q52 | บิล POS ของวันที่ปิดแล้ว | อ่านอย่างเดียวทั้งเว็บและแท็บเล็ต · ส่วนต่างแก้ด้วยการปรับในกะ (`cash_movement` `PAID_IN`/`PAID_OUT` พร้อมเหตุผลอ้างเลขใบเสร็จ) หรือบันทึกเป็นค่าใช้จ่าย · ธงซ้ำให้ยกเลิกฝั่งบอท/เว็บ | §4.7 · §4.8 |
| Q53 | บอทเป็นช่องทางขายเท่ากับ POS | ใช่ ไม่ใช่ทางสำรอง · P2 แก้ข้อความ ADR-0006 และ ADR-0035 ข้อ 5 | P2 |
| **Q54** | **รอคำตอบเจ้าของ** (บันทึกพร้อม D79: กฎนาฬิกาเตือนไม่บล็อก) — รายงานกำไรของ owner ตรวจแค่ `staff_id` ที่อ้าง (รีวิวข้อ 5 · ขัดถ้อยคำ D69) | ยอมรับข้อจำกัดเป็น D ใหม่ หรือเปลี่ยนเป็นการพิสูจน์ตัวตนจริง | §4.10 ก้อน 4 ข้อ 0 · §7 ข้อ 10 · P4 |

---

## 13. จุดที่ต่างจาก brief หรือขัดกับ ADR/โค้ดของ dayo

### 13.1 จากการร่างรอบแรก — แก้แล้วทุกข้อ

1. ✅ **แจ้งเตือนสำรองล้มทาง LINE** ขัด ADR-0036 ข้อ 3 และ ADR-0044 → ใช้ Discord `#dayo-ระบบ` (Q40 · P7)
2. ✅ **"OneDrive token ใช้ทุกคืนแล้วไม่หมดอายุ"** จริงเฉพาะเมื่อเขียน token ใหม่กลับ → workflow เขียนกลับด้วย PAT ทุกคืน (Q41 · P7)
3. ✅ **แหล่งบิล "bot"** ในฐานคือ `line` → คงค่าเดิม หน้าจอแสดง "บอท" (§4.7)
4. ✅ **กติกา "ยกเลิกได้เฉพาะวันนี้" (ADR-0040 ข้อ 2)** กับการยกเลิกออฟไลน์ที่ส่งช้า → เทียบวันที่ของ `voided_at` แทน (§4.5 · P2)
5. ✅ **`resolveStaffRef` รับเฉพาะ active** → การระบุผู้ทำใน push รับ `removed` ด้วย (§4.5 · P2)
6. ✅ **เพดานย้อนหลังตามบทบาทกับบิลออฟไลน์** → บิล POS ใช้ช่วง 60 วัน (§4.5 · P2)
7. ✅ **`GET /v1/catalog` เดิมใช้คิดราคาเองไม่ได้** → E1 ใหม่ + `catalog_version` (§4.3–4.4 · P1)
8. ✅ **กันซ้ำด้วยเลขใบเสร็จทำให้บิลหายเงียบ** → E2 กันซ้ำด้วย `pos_order_id` + `CONFLICT` (§4.5 · P2)
9. ✅ **ไม่มี CORS ใน `/api/v1`** → เพิ่มแบบจำกัด origin (§4.1 · P1)
10. ✅ **รหัสเมนูเปลี่ยนได้** → ล็อกเมื่อมีบิลอ้าง (Q51 · §4.9 · P2)
11. ✅ **ADR-0006 / ADR-0035 ข้อ 5 "บอทเป็นทางสำรอง"** → บอทเป็นช่องทางเท่ากัน (Q53 · P2)
12. ✅ **ADR-0021 เคยตัด GitHub Action** → P7 เพิ่มกลับแบบไม่ใช้ R2 ไม่ผูกบัตร ปุ่มสำรองเองคงเดิม
13. ✅ **นำเข้าแบบ replace มีอยู่แล้วแต่ทับรายชีตและข้ามชีตที่หายเงียบ ๆ** → P8 เพิ่มโหมด `replace_all` ที่ตรวจชีต/คอลัมน์ครบก่อนเขียน (Q50)
14. ✅ **กำไรสุทธิบนแท็บเล็ตขัด ADR-0035 ข้อ 3 / ADR-0040 ข้อ 3** → เจ้าของเลือกให้แสดงได้เฉพาะ owner: P4 แก้สองข้อนั้นด้วยข้อยกเว้นเดียว `POST /v1/pos/profit` (Q45 · §4.10 · §7 ข้อ 10)

### 13.2 จากรีวิวรอบ 1 (code-reviewer + security-reviewer, 25 ก.ย. 2026) — แก้แล้ว ยกเว้นข้อ 5

| # | ความรุนแรง | เรื่อง | แก้อย่างไร | ที่ |
|---|---|---|---|---|
| 1 | สูง | ใบเสร็จชนแล้วได้ `duplicate` บิลใหม่หายเงียบ | ตรวจ `pos_order_id` ก่อน `create_order` · `external_ref` ชนแต่ `pos_order_id` ต่าง = `CONFLICT` เสมอ · ทางลัดใน `create_order` เทียบ `pos_order_id` | §4.5 ข้อ 0 · การกันซ้ำ · P2 |
| 2 | สูง | error ไม่คาดคิดของแถวทำทั้งคิวค้าง | ตารางแผนที่ SQLSTATE/DY → คำตัดสิน · ที่เหลือ = `deferred SERVER_ERROR` เฉพาะแถว ไม่มี 5xx ทั้งก้อน | §4.5 · P2 |
| 3 | สูง | CORS ไม่ครอบคำตอบ error · อ่าน `Retry-After` ไม่ได้ | ทุกคำตอบใต้ `/api/v1` มีหัว CORS + `Vary: Origin` + `Expose-Headers: Retry-After` · `OPTIONS` 204 เสมอ · ทำใน `lib/api/response.ts` | §4.1 · P1 |
| 4 | สูง | ส่วนต่าง ≤ ฿1 มองไม่เห็น | E2 คืน `computed_total` + dayo เก็บ `pos_computed_total` ทุกบิล · E1 คืน `pricing` (commit + sha256) · เกณฑ์ก้อน 2 = ต่าง 0 สตางค์ · parity รันบน commit ที่ deploy จริง | §4.3 · §4.4 · §5.2 · §9 · P1 · P2 |
| 5 | สูง | รายงานกำไร owner ตรวจแค่ `staff_id` ที่อ้าง (ขัดถ้อยคำ D69) | **ยังไม่แก้ — รอคำตอบเจ้าของ Q54** · ใส่หมายเหตุใน §4.10 ก้อน 4 ข้อ 0, §7 ข้อ 10, P4 · ห้ามเปิดใช้ endpoint จนกว่าปิด | §12 Q54 |
| 6 | สูง | เงินคืนบิลที่ยกเลิกถูกหักสองครั้ง | สูตรใหม่ = บิลทุกใบในกะ (รวมที่ยกเลิก) − `VOID_REFUND` · `VOID_REFUND` เป็นแหล่งเดียว · ลบ `refund` ออกจาก `order_void` | §4.5 · §4.10 ก้อน 3 · P2 · P3 |
| 7 | สูง | บิลบอทนับซ้ำหลายกะ/เวลาตัดผิด | ช่วง `(นับครั้งก่อน, นับครั้งนี้]` ด้วย `created_at` · dayo คิดซ้ำจากรายการ id ใน snapshot | §4.10 ก้อน 3 · P3 |
| 8 | สูง | แถว rejected ไม่มีทางแก้ · กะถูกปฏิเสธบล็อกบิลทั้งกะ | ผล rejected/deferred ไม่เก็บใต้ key · ทางแก้ของ owner (ออกเลขใหม่/เลือกรหัสแทน/เลือกผู้ขายแทน/ปิดเป็นรายการนอกระบบ) · แถวลูกขึ้นหน้า "ส่งไม่ผ่าน" ทันที · บิลผูกกะทีหลังได้ (ไม่มี FK) | §4.5 · §6.2 · §6.4 · §4.10 · P2 · P3 |
| 9 | กลาง | ค่าที่ dayo ตีความตอนบิลมาถึง | `milk` ห้าม null · เกรดมัตจะห้าม null · ไม่ตรวจ/บีบ qty กับ `maxQtyPerLine` สำหรับบิล POS · สูตร `sale_time` ล็อก · คิดราคาใหม่ด้วย `sold_at` ตอนชำระ · `no_promotions` = skip ทุกโปร (ใช้ฟิลด์ที่ SQL มีอยู่แล้ว) | §4.5 · §5.1 · P2 |
| 10 | กลาง | เกณฑ์นาฬิกาไม่ตรงกัน | เกณฑ์เดียว 5 นาที · ~~เกินแล้วแท็บเล็ตห้ามขาย/ยกเลิก~~ (ยกเลิกโดย N5 — เตือน ไม่บล็อก ตามหลักเดิมของ D58 · รอ D79) · dayo ตอบ `deferred CLOCK_AHEAD` | §4.5 · §6.7 · P2 |
| 11 | กลาง | แถว deferred ถูกข้ามแล้วลำดับเสีย | ช่อง (lane) ต่อกะ: deferred หยุดแถวหลังในช่องเดียวกัน · กติกาใช้เวลาในแถว | §6.2 · §4.10 ก้อน 3–4 · P3 · P4 |
| 12 | กลาง | รุ่นไม่ตรงกันแล้วบิลถูกปฏิเสธถาวร | **ตัดสินโดยผู้คุมงาน** (รีวิวให้เลือก — เลือกทางที่ปลอดภัยกว่า = ทำทั้งสองอย่าง): ฟิลด์/ชนิดไม่รู้จัก = `deferred UNSUPPORTED` **และ** dayo deploy ก่อนเสมอ + E1 ส่ง `supported_kinds` | §4.1 · §4.4 · §6.2 · P1 · P2 |
| 13 | กลาง | รหัสช่องทาง/วิธีชำระยังเปลี่ยนได้ | ล็อกเหมือนรหัสเมนู | §4.9 · P2 |
| 14 | กลาง | ชื่อ `bahtToSatang` ชนกัน · ไม่ระบุฟิลด์ที่แปลง | ใช้ `edgeBahtToSatang`/`edgeSatangToBaht` · ระบุรายชื่อฟิลด์เงิน · ไม่แปลง `gpPercent`/ต้นทุน | §4.2 · §5.1 |
| 15 | กลาง | `profit_view` ตอนถูกปฏิเสธถูก rollback | RPC คืน JSON error ไม่ raise → audit commit แล้ว route แปลงเป็น 403 | §4.10 ก้อน 4 · P4 |
| 16 | กลาง | ชุด parity ขาดเคส / catalog ไม่ใช่ของจริง | สคริปต์ export เรียก `api_pos_catalog` จริง · เพิ่มเคส 11–15 | §5.2 · §5.3 · P1 |
| 17 | ต่ำ | สถานะเอกสารล้าสมัย | อ้าง D59–D78 · Q54 ค้าง | หัวเอกสาร · §12 · README |
| 18 | ต่ำ | ตัวอย่าง `detail` ขัดกติกาไม่สะท้อนค่า | **ตัดสินโดยผู้คุมงาน**: สะท้อนได้เฉพาะวันที่/เวลา รหัส เลขใบเสร็จ SQLSTATE · ห้าม id พนักงาน ข้อความอิสระ error ดิบ (ตัวอย่างเดิมจึงถูกต้องตามกติกาใหม่) | §4.5 · §7 ข้อ 8 |
| 19 | ต่ำ | ที่อยู่ `expense_categories` · `bill_discount` สองค่า | **ตัดสินโดยผู้คุมงาน**: `expense_categories` ระดับเดียวกับ `staff` · ส่ง `baht` และ `percent` พร้อมกัน = `INVALID` | §4.4 ข้อ 11 · §4.5 · P4 |
| 20 | ต่ำ | ประมาณการขนาดฐานไม่นับบางตาราง | เผื่อ ~5 MB/ปี · ทบทวนหลังใช้จริง 1 เดือนจาก manifest | §10.1 |

### 13.3 จากรีวิวซ้ำ (รอบ 2, 25 ก.ย. 2026) — แก้แล้วทุกข้อ

| # | ความรุนแรง | เรื่อง | แก้อย่างไร (ตามคำตัดสินของผู้คุมงาน) | ที่ |
|---|---|---|---|---|
| N1 | สูง | คิด Z ซ้ำด้วย `orders.created_at` ขัดกับการผูกกะทีหลัง · snapshot ไม่มีบิล POS | snapshot มี id บิล POS **ทุกใบ** ของกะ (+ บิลบอทเดิม) · dayo คิดซ้ำด้วย `sold_at`/`voided_at` (เวลาเครื่อง) ห้ามใช้ `created_at` ของ `orders` · บิลในรายการยังไม่มา = `waiting_bills` ไม่ใช่ mismatch · คิดซ้ำทุกครั้งที่บิลของกะเข้ามา · `z_mismatch` เฉพาะเมื่อบิลครบแล้วยังต่าง · เพิ่มชนิด `order_excluded` | §4.10 ก้อน 3 · §6.4 · §9 · P3 ข้อ 1/4 |
| N2 | กลาง | ไม่ได้บอกลำดับการตรวจ hash กับขั้น (ก) | ล็อก: (1) เทียบ hash ของ key ก่อน (key เดิมเนื้อหาต่าง = `CONFLICT`) → (2) (ก)(ข)(ค) · หลังคีย์หมดอายุ 30 วัน เนื้อหาต่างของ `pos_order_id` เดิม = `duplicate` (ยอมรับ) | §4.5 ข้อ 0 · การกันซ้ำ · P2 ข้อ 5 |
| N3 | กลาง | `VOID_REFUND` ช่วงก้อน 2 ค้างถาวร | แถวกะ/เงินสดทุกชนิดของกะที่เปิดก่อนก้อน 3 ใช้งานจริง = `local_only` ไม่ส่งตลอดไป · ก้อน 2 ส่ง `shift_id: null` เสมอ | §4.5 · §4.10 ก้อน 3 · §6.1 · P2 · P3 |
| N4 | ต่ำ | `UNSUPPORTED` ระดับฟิลด์ไม่มีสัญญาณ | E1 ส่ง `supported_fields` ต่อชนิดคู่กับ `supported_kinds` · แท็บเล็ตเก็บแถวรอ (ไม่ rejected ไม่นับครั้งลองใหม่) จนฟิลด์ปรากฏ | §4.1 · §4.4 ข้อ 10 · §6.2 · §6.3 · P1 · P2 |
| N5 | ต่ำ | เกณฑ์นาฬิกาใหม่ห้ามขาย ขัดการตัดสินเดิมของเจ้าของ | **กลับไปใช้หลักเดิมของ D58 ที่ยกมาใช้ต่อ (รอบันทึกเป็น D79 พร้อม Q54)**: ต่างเกิน 5 นาที = แถบเตือนบนหน้าขาย + บรรทัดในหน้าสถานะระบบ ไม่บล็อกการขาย · dayo ยังตอบ `deferred CLOCK_AHEAD` ให้แถวที่เวลาเกินเซิร์ฟเวอร์ > 5 นาที (แถวรอ ไม่หาย) · ข้อ 10 ของ §13.2 ส่วน "ห้ามขาย/ยกเลิก" ถูกยกเลิกด้วยข้อนี้ | §6.7 · §6.3 · P2 |
| N6 | ต่ำ | §6.1 "ข้อความเดิมทุกไบต์" ขัดกับทางแก้ของ owner | ทั้งสองส่วนเขียนตรงกัน: ลองใหม่อัตโนมัติ = ข้อความเดิมทุกไบต์ · ทางแก้ของ owner แก้แล้วส่ง key เดิมได้เฉพาะแถว `rejected` เพราะผล rejected ไม่ถูกเก็บใต้ key | §6.1 · §6.4 |
| — | ต่ำ | P1 ยังอ้าง `lib/platform.ts` (CORS) · เลขเคส §5.3 สลับ | แก้เป็น `lib/api/response.ts` · เรียงเลขเคส 1–15 | P1 · §5.3 |

### 13.4 จากรีวิวรอบ 3 (25 ก.ย. 2026) — แก้แล้วทุกข้อ

| # | ความรุนแรง | เรื่อง | แก้อย่างไร (ตามคำตัดสินของผู้คุมงาน) | ที่ |
|---|---|---|---|---|
| R1 | สูง | บิลที่ถูกกันออก: `PAID_IN` ทำเงินขาดปลอม และรายได้หายจากรายงานกลาง | ห้าม `PAID_IN`/`PAID_OUT`/ค่าใช้จ่ายสำหรับกรณีนี้ (เงินสดนับใน Z เดิมจาก snapshot แล้ว) · ยอดขาย/กำไรกลางบวกยอดจาก `pos_excluded_orders` ตาม `sold_at` ครั้งเดียว พร้อมป้าย | §4.10 ก้อน 3–4 · §6.4 · P3 · P4 |
| R2 | กลาง | สัญญา `order_excluded` ไม่ครบ | ล็อกเหมือนกันทั้งสเปกและ P3: key `order_excluded:<pos_order_id>` · ฟิลด์ `pos_order_id, shift_id, total, sold_at, reason, staff_id, created_at_device` · owner เท่านั้น · ก่อน `shift_close` = `deferred PARENT_PENDING` · บิลมีในฐานแล้ว = `rejected ALREADY_PRESENT` | §4.5 ตารางเหตุผล · §4.10 ก้อน 3 · P3 ข้อ 1–2 |
| R3 | กลาง | บิลของกะ `local_only` ที่ขายต่อหลังก้อน 3 ขึ้น | ส่ง `shift_id: null` เสมอ แม้ก้อน 3 ใช้งานแล้ว | §4.5 · §4.10 ก้อน 3 · P3 ข้อ 8 |
| R4 | ต่ำ | "บิลบอทนอกใบปิดกะ" แสดงบิลเก่าก่อนก้อน 3 ตลอดไป | นับเฉพาะ `sale_date` ≥ `shop_settings.block3_live_from` | §4.10 ก้อน 3 · P3 ข้อ 8 |
| N5 | ต่ำ | อ้างข้อย่อยของ D58 ซึ่งถูกแทนที่แล้ว | เขียนเป็น "ตามหลักเดิมของ D58 ที่ยกมาใช้ต่อ — รอบันทึกเป็น D ใหม่ (D79) พร้อม Q54" | §6.7 · §12 · §13 · P2 |
