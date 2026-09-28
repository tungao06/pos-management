# สเปกการเชื่อม POS กับ dayo-shop-system (สถาปัตยกรรม C1)

เขียนเมื่อ 25 ก.ย. 2026 · ผู้เขียน: architect ของ POS
สถานะ: **การตัดสินใจบันทึกแล้วใน D59–D100** (`00-บันทึกการตัดสินใจ.md`) · สเปกแก้ตามรีวิวรอบ 1 แล้ว (§13.2) · **เจ้าของรับรองสเปกแล้ว** · ดูกำไรเปลี่ยนเป็นหน้าเว็บ dayo ตาม ADR-0055 (D87 แทน D79 — §4.10 ก้อน 4, §7 ข้อ 10) · สัญญาก้อน 1–2 ล็อก · **สัญญาก้อน 3 ล็อก 26 ก.ย. 2569 (D90–D100 · §4.10 ก้อน 3 · §13.8)**
ที่มา: คำตอบเจ้าของรอบ grilling 1–6 (Q1–Q37, 25 ก.ย. 2026) · `03-ประเมินสถาปัตยกรรม-POS-กับ-LINE-bot.md` §10–11 · โค้ดและ ADR ของ dayo ณ วันที่เขียน (migration ล่าสุด `0047_shop_settings.sql`, ADR ล่าสุด 0047)
ร่าง ADR ที่ต้องส่งให้ session ของ dayo: `dayo-adr-drafts/` (P1–P8)
**ปรับตาม dayo ที่ ship แล้ว (26 ก.ย. 2569)**: dayo ยอมรับ ADR-0048–0055 และทำก้อน 1A เสร็จ (migration 0048–0052 · dayo `main` `232bf57`) · สเปกนี้แก้ให้ตรงกับที่ dayo ทำจริงแล้ว ดูรายการและที่มาใน §13.6 · **ถ้าข้อความในสเปกนี้ขัดกับ SQL ของ dayo ให้ถือ SQL เป็นความจริง** (ไม่ใช่ `docs/API.md` ของ dayo) แล้วแจ้ง architect · จุดที่เคย **รอเจ้าของ O1/O2/O3 ปิดแล้วทั้งหมด** (26 ก.ย. 2569): **O1 → D85** (ยึด ADR-0050: owner แก้บิล POS บนเว็บได้ · แท็บเล็ตแสดง `dayo_edit` อ่านอย่างเดียว และยังแก้บิลย้อนหลังไม่ได้) · **O2 → D86 + D95** (ต้องมีสำรองอัตโนมัติก่อนเปิดใช้แท็บเล็ตขายจริง · dayo เป็นคนทำโดยยกเลิกการเลื่อน ADR-0051) · **O3 → D87** (ดูกำไรบนหน้าเว็บ dayo ด้วย OTP ตาม ADR-0055 แทนการแลกรหัส 6 หลักบนแท็บเล็ต) — รายการที่แก้อยู่ใน §13.8

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
| บิลที่ขายที่แท็บเล็ต + การยกเลิก | แท็บเล็ต · **owner แก้/ยกเลิกบนเว็บได้พร้อมเหตุผล** (ADR-0050 · D85 — §4.7) | เว็บ บอท แดชบอร์ด · แท็บเล็ตอ่านการแก้ของ owner ผ่าน `dayo_edit` ของ E3 แบบอ่านอย่างเดียว (§4.6) | `POST /v1/pos/push` แถวชนิด `order` / `order_void` · บิลที่เข้าฐานไม่ได้: `order_off_catalog` (ก้อน 3 — D91) |
| บิลที่ขายที่บอท/เว็บ + การแก้/ยกเลิก | บอท/เว็บ (ADR-0029) | แท็บเล็ต (ดูกันซ้ำ + นับเงินสดตอนปิดกะ) | บอท/เว็บเขียนฐานกลางตรง · แท็บเล็ตอ่าน `GET /v1/orders` และ (ก้อน 3) `GET /v1/pos/shift-cash` |
| ธงบิลน่าจะซ้ำ | ฐานกลาง (ตรวจอัตโนมัติ) · owner ปิดธงบนเว็บ | เว็บ แท็บเล็ต | คำตอบของ push + `GET /v1/orders` |
| กะ เงินเข้า-ออกลิ้นชัก นับเงิน ใบปิดกะ (Z) | แท็บเล็ตเท่านั้น (บอทไม่มีคำสั่งกะ — D92) | เว็บ owner (สรุป 1 บรรทัดบนแดชบอร์ด + หน้ารายละเอียดกะอ่านอย่างเดียว — Q20 · D99) | push ชนิด `shift_open` `cash_movement` `cash_count` `shift_close` (ก้อน 3) |
| ค่าใช้จ่าย | แท็บเล็ตเท่านั้น (Q46) | เว็บ (อ่าน + รายงานกำไรสุทธิ) | push ชนิด `expense` `expense_void` (ก้อน 4) |
| หมวดค่าใช้จ่าย | เว็บ dayo (owner) | แท็บเล็ต | ในก้อนแคตตาล็อก (ก้อน 4) |
| ต้นทุนเฉลี่ยเคลื่อนที่ของวัตถุดิบ | ฐานกลาง (คิดจากการรับเข้า) · owner ปรับเองได้พร้อมเหตุผล (Q49) | เว็บ | ไม่ส่งออก API รายวัตถุดิบ (ADR-0035 ข้อ 3) |
| รายงานกำไร (ยอดรวม) | ฐานกลาง (RPC คิด) | เว็บ (owner) · จากแท็บเล็ต = **เปิดหน้าเว็บ dayo** ยืนยันด้วย OTP (ADR-0055 · D87) | `POST /v1/pos/profit-view` คืนแค่ลิงก์ (ไม่มีตัวเลข) · ไม่มีกำไรในแท็บเล็ตเลย (§4.10 ก้อน 4) |
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
| scope ที่แท็บเล็ตขายต้องมี | `catalog:read` `staff:read` (ใหม่ — P1) `orders:read` `orders:write` · ก้อน 3: `shift:write` · ก้อน 4: `expense:write` · ก้อน 6: `payroll:write` · ไม่บังคับ (owner เปิดเอง): `reports:profit` (ใช้กับ `POST /v1/pos/profit-view` เท่านั้น — ADR-0055 · D87) |
| CORS | origin ที่อนุญาต = env `POS_ORIGINS` (คั่นด้วยจุลภาค) · **ทุกคำตอบใต้ `/api/v1/*` รวม error ทุกชนิด** (404 จากสวิตช์ `API_V1_ENABLED`, 401, 403, 422, 429, 5xx) มีหัว `Access-Control-Allow-Origin: <origin ที่ตรง>` + `Vary: Origin` + `Access-Control-Expose-Headers: Retry-After` · `OPTIONS` ตอบ **204 เสมอ** (แม้ API ปิด · ไม่แตะฐานข้อมูล) พร้อม `Access-Control-Allow-Headers: Authorization, Content-Type` (dayo ship เพิ่ม `Idempotency-Key` ด้วย — แท็บเล็ตไม่ส่งหัวนี้) · ต้องเป็น origin `https://` ตรงตัว ไม่รับ wildcard/preview ของ Pages (ยกเว้น `http://localhost`/`127.0.0.1`) · `Access-Control-Allow-Methods: GET, POST, OPTIONS` · `Access-Control-Max-Age: 7200` · origin ที่ไม่อยู่ในรายการ = ไม่มีหัว CORS · ทำที่จุดเดียวใน `apps/web/src/lib/api/response.ts` (`apiHandler` — ที่เดียวกับสวิตช์ 404) (P1) |
| อัตราคำขอ | 60 คำขอ/นาที/key (มีอยู่แล้ว — `api_authenticate`) · เกิน = 429 + `Retry-After` |
| รูปคำตอบ | `{ "ok": true, "data": … }` หรือ `{ "ok": false, "error": { "code": "DY422", "message": "…" } }` (เหมือนเดิม) |
| เวลา (ส่งเข้า) | ISO-8601 UTC มีมิลลิวินาที `2026-09-25T03:15:03.120Z` |
| เวลา (ส่งออก) | ISO-8601 (Postgres `timestamptz` แปลงเป็นข้อความ) · แท็บเล็ตต้อง parse ได้ทั้งแบบ `Z` และ `+00:00` |
| วันขาย | `YYYY-MM-DD` เวลาไทย (Asia/Bangkok) · ร้านปิดก่อนเที่ยงคืน (ADR-0024) |
| เงิน | บาท เป็นเลข JSON ทศนิยมไม่เกิน 2 ตำแหน่ง (`35`, `35.5`, `12.25`) — กติกาแปลงอยู่ §4.2 |
| เปอร์เซ็นต์ | **สองแบบ ห้ามสลับ**: ช่องทาง `priceMarkupPct` / `feePct` เป็น **สัดส่วน** (`0.30` = 30%) · ส่วนลดรายแก้ว/ทั้งบิล/โปร `percent` เป็น **ร้อยละ** (`10` = 10%) — ตามที่ dayo ใช้อยู่ (DATA-CONTRACT §2.4, §4.2–4.3) |
| ขนาด / ความหวาน | **ขนาดตั้งได้ (ADR-0054)**: ข้อความรูป `^[1-9][0-9]{0,2} oz$` (เช่น `"16 oz"` `"20 oz"` `"22 oz"`) · รายการขนาดของร้านมากับ E1 ใน `catalog.sizes` (§4.4 ข้อ 12) · **ห้ามตายตัวเป็น 2 ค่า** ทั้งใน schema หน้าจอ และตัวคิดราคา · ตอนนี้ร้านมี `16 oz` `20 oz` · ความหวาน: `"0%"` `"25%"` `"50%"` `"75%"` `"100%"` (คงเดิม) |
| ข้อความ | UTF-8 · ห้ามมีอักขระควบคุม C0 และ DEL · ความยาวนับเป็น code point · `reason`/`note` ≤ 200 · `description` ≤ 200 |
| id | UUID ตัวเล็ก รูป `8-4-4-4-12` · แถวที่แท็บเล็ตสร้าง ใช้ id ที่แท็บเล็ตสร้าง (UUIDv4 หรือ v7) |
| ความเข้ากันได้ | ฝั่งรับต้อง **ยอมรับฟิลด์ที่ไม่รู้จักในคำตอบ** และค่า `status`/`reason` ที่ไม่รู้จัก (ถือเป็นข้อความ — บทเรียนแผน 5 `ReceivedRowResult`) · ฟิลด์หรือชนิดแถวที่ dayo ยังไม่รู้จักในคำขอ = คำตัดสินรายแถว **`deferred UNSUPPORTED`** (ลองใหม่ได้เมื่อ dayo อัปเดต ไม่ใช่ rejected) · กติกาปล่อยรุ่น: **dayo deploy ก่อนเสมอ** แล้ว POS รุ่นที่ใช้ฟิลด์/ชนิดใหม่จึงขึ้นได้ · E1 ส่ง `supported_kinds` และ `supported_fields` (รายชื่อฟิลด์ของ `data` ต่อชนิด) · แท็บเล็ต **เก็บแถวรอ** (ไม่ใช่ rejected) จนกว่าชนิดและทุกฟิลด์ที่แถวใช้จะปรากฏในรายการ |

**endpoint เดิม** (`GET /v1/catalog`, `GET /v1/promotions`, `GET /v1/stock`, `POST /v1/stock/movements`) คงอยู่ไม่เปลี่ยน · **`POST /v1/orders` และ `PATCH /v1/orders/{order_no}` ถูกถอดแล้ว (404 — ADR-0049 ข้อ 8)** · **แท็บเล็ตไม่ใช้** ยกเว้น `GET /v1/orders` (ขยายฟิลด์ใน §4.6) · เหตุผล: `GET /v1/catalog` ไม่มีข้อมูลพอให้คิดราคาเอง (ไม่มีสูตร ไม่มีกติกาช่องทาง ไม่มีค่าเริ่มต้นร้าน และ `etag` ครอบแค่เมนู) และ `POST /v1/orders` ส่งได้ทีละบิลไม่มีคำตัดสินรายแถว

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
- trigger `after insert or update or delete` (dayo ship เป็น **ระดับคำสั่ง** ไม่ใช่ระดับแถว — ADR-0048 ข้อ 1 · ไม่กระทบแท็บเล็ตเพราะเทียบแค่เท่ากัน) เพิ่ม `version = version + 1, changed_at = now()` ของร้านนั้น เมื่อแถวในตารางเหล่านี้เปลี่ยน:
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
    "client": { "name": "แท็บเล็ตขาย 1", "last_receipt_no": "A-000311", "last_z_no": 41, "last_z_hash": "9c1f…" },
    "pricing": { "commit": "3f2a9c1…", "files_sha256": { "packages/shared/src/money.ts": "9b1e…", "packages/shared/src/promotions.ts": "c47d…" } },
    "supported_kinds": ["order", "order_void"],
    "supported_fields": { "order": ["pos_order_id", "receipt_no", "queue_no", "sale_date", "sold_at", "channel", "payment", "staff_id", "catalog_version", "shift_id", "lines", "lines.code", "lines.size", "lines.sweetness", "lines.milk", "lines.grade", "lines.qty", "lines.free", "lines.discount_baht", "lines.discount_percent", "lines.discount_reason", "bill_discount", "promo_code", "skip_promotion_ids", "no_promotions", "totals", "note"],
                          "order_void": ["pos_order_id", "voided_at", "staff_id", "approved_by", "reason"] },
    "staff": [
      { "id": "7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f", "display_name": "TungAo", "role": "owner", "active": true },
      { "id": "0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", "display_name": "DCm", "role": "staff", "active": true }
    ],
    "catalog": {
      "sizes": [ { "code": "16 oz", "label": "16 oz", "sortOrder": 0, "isActive": true },
                 { "code": "20 oz", "label": "20 oz", "sortOrder": 1, "isActive": true },
                 { "code": "22 oz", "label": "22 oz", "sortOrder": 2, "isActive": false } ],
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

id ที่ย่อด้วย `…` ในตัวอย่างของ §4.4–4.5 เป็น UUID เต็มในไฟล์ fixture (§4.11) — ย่อเพื่ออ่านง่ายเท่านั้น · ขนาด `22 oz` ที่ปิดอยู่ในตัวอย่างมีไว้แสดงว่า `sizes` รวมขนาดที่ปิด (ร้านจริงยังไม่มี 22 oz) · ค่าจริงที่ dayo ส่งและตัวอย่างไม่ได้แสดง: `categoryLabel: null` · `timeFrom: "17:00:00"` · `pricing.commit: null` (ข้อ 2, 9, 13)

กติกาของ E1 (ล็อก)
1. `catalog` = **รูป `OrderCatalog` ของ `@dayo/shared` ตรงตัว** (ชื่อฟิลด์ camelCase ตาม `packages/shared/src/types.ts`) เพื่อให้ตัวคิดราคาที่แท็บเล็ตใช้ (สำเนา — §5) รับไปได้โดยไม่แปลงชื่อ · สร้างจาก `dayo_impl_get_full_catalog` ตัวเดียวกับที่บอทใช้ แล้ว **ตัดต้นทุนออก**: `ingredients[*]` ไม่มี `costPerUseUnit` (แท็บเล็ตเติม 0 ก่อนส่งเข้าตัวคิดราคา — ต้นทุนไม่มีผลกับราคา) · E1 ไม่มีต้นทุนเสมอ (ADR-0040 ข้อ 3 — **ไม่มีข้อยกเว้นแล้ว**: กำไรของ owner ดูบนหน้าเว็บ dayo ตาม ADR-0055 · D87)
2. `variants` มีเฉพาะเมนูและตัวแปรที่ active **และขนาดที่ active** (ตัวแปรของขนาดที่ปิดไม่ส่ง) เรียงตาม `menuSortOrder`, `menuCode`, ขนาด (`sortOrder` ของ `sizes`), ความหวาน · `categoryLabel` และ `menuSortOrder` เป็นฟิลด์เพิ่มสำหรับหน้าขาย (ตัวคิดราคาไม่ใช้) · **`categoryLabel` เป็น `null` ได้** (ส่ง `menu_items.category_label` ดิบ ไม่ coalesce) → แท็บเล็ตใช้ `family` แทนเมื่อเป็น null · schema ฝั่งแท็บเล็ตต้องรับ null ไม่งั้นแคตตาล็อกทั้งก้อนถูกปฏิเสธ
3. `recipeLines` จำเป็น: ตัวคิดราคาใช้ตัดสินว่าเมนูเปลี่ยนเป็นนมโอ๊ตได้ไหม (สูตรต้องมีวัตถุดิบนมสด) และบรรทัดผงของเกรดมัตจะ (DATA-CONTRACT §4.1)
4. `promotions` = โปรที่ `is_active` ทั้งหมด (รวมที่ยังไม่ถึงวัน/หมดวันแล้ว — ตัวคิดราคาเช็กวันเวลาเอง)
5. `staff` = พนักงานสถานะ `active` (`active: true`) และ `removed` (`active: false` — แท็บเล็ตห้ามล็อกอิน แต่ยังแสดงชื่อในบิลเก่าได้) · **ไม่มี** `pending` · **ไม่มี** `line_user_id` · `display_name` ว่างได้ → แท็บเล็ตแสดง "พนักงาน " + 4 ตัวท้ายของ `id`
6. `client.last_receipt_no` = `external_ref` ของบิลล่าสุดที่ key นี้ส่งเข้ามา (เรียงตาม `created_at`) หรือ `null` · ใช้ตอนตั้งเครื่องใหม่/ติดตั้งแอปใหม่ด้วย key เดิม เพื่อเลขใบเสร็จไม่ซ้ำของเดิม (§6.6) · schema ฝั่งแท็บเล็ตรับเป็น `string | null` **ไม่ตรวจรูปใน schema** (ค่าเป็น `external_ref` ดิบ — ถ้ารูปผิดแม้ใบเดียว E1 จะใช้ไม่ได้ทั้งก้อน) แล้วตรวจรูป `^[A-Z]{1,3}-\d{6}$` ตอนตั้งเลขใบเสร็จ: รูปผิด = หยุดตั้งเครื่องพร้อมข้อความให้ owner ตรวจ (ไม่เดาเลข) · **ก้อน 3 เพิ่ม (R4-1)**: `client.last_z_no` (int ≥ 1 หรือ `null`) และ `client.last_z_hash` (ข้อความ hex 64 ตัว หรือ `null`) = `z_no` และ `hash` ของ Z ที่ `z_no` สูงสุดของ key นี้ในฐาน (ยังไม่มี Z = `null` ทั้งคู่) · ใช้ตอนตั้งเครื่องใหม่/ติดตั้งแอปใหม่ด้วย key เดิมโดยไม่ได้กู้ไฟล์สำรอง เพื่อต่อเลข Z และโซ่แฮชของเครื่อง (§6.6) · schema ฝั่งแท็บเล็ตรับ null ได้ · ฟิลด์ใหม่ใน `client` ไม่กระทบรุ่นเก่า (ยอมรับฟิลด์ที่ไม่รู้จัก — §4.1)
7. `server_time` มีทุกคำตอบ → กติกานาฬิกา §6.7
8. ขนาดคำตอบประมาณ 150–250 KB (240 ตัวแปร × สูตร ~6 บรรทัด) · Route Handler ส่งต่อข้อความ JSON จาก RPC โดยไม่ parse ซ้ำถ้าวัด CPU แล้วเกิน 5 ms (§10)
9. `pricing` (มีทั้งสองแบบของคำตอบ ทั้ง `changed` true/false): `commit` = commit ของ dayo ที่ deploy อยู่ (ค่าเดียวกับเวอร์ชันระบบ ADR-0045) **หรือ JSON `null` เมื่อ build ไม่ได้ใส่ค่า** (dev/local) → แท็บเล็ตแสดง "ไม่ทราบ" และไม่ถือเป็นความผิด (การเทียบใช้ `files_sha256` เท่านั้น) · `files_sha256` = sha256 ของไฟล์ตัวคิดราคาใน `packages/shared/src/` ที่ build นั้นใช้ (คำนวณตอน build) · แท็บเล็ตเทียบกับ `VENDOR.json` ของตัวเอง: ไฟล์ใดต่าง → แถบเหลือง "ตัวคิดราคาในเครื่องไม่ตรงกับระบบกลาง" ถาวร (ยังขายได้ · ส่วนต่างจะเห็นใน `computed_total`) และแจ้งทีม POS ให้ `vendor:update` + parity ใหม่
10. `supported_kinds` และ `supported_fields` (มีทั้งสองแบบของคำตอบ) = ชนิดแถว E2 ที่ dayo รุ่นนี้รับ (ก้อน 1–2: `order`, `order_void` · ก้อน 3 เพิ่ม `shift_open` `cash_movement` `cash_count` `shift_close` `order_off_catalog` — §4.10) และรายชื่อฟิลด์ของ `data` ต่อชนิด (`{"order": ["pos_order_id", "receipt_no", …], "order_void": [...]}` — ฟิลด์ซ้อนเขียนแบบจุด เช่น `lines.milk`) · แท็บเล็ตไม่ส่งแถวที่ชนิดไม่อยู่ในรายการ หรือมีฟิลด์ที่ไม่อยู่ในรายการ (เก็บรอใน outbox ไม่นับเป็นครั้งลองใหม่)
11. ตั้งแต่ก้อน 4: `expense_categories` อยู่ **ระดับเดียวกับ `staff`** (ไม่อยู่ใน `catalog` เพราะ `catalog` ต้องเป็นรูป `OrderCatalog` ตรงตัว)
12. **`catalog.sizes`** (บังคับ — ADR-0054) = `[{code, label, sortOrder, isActive}]` **ทุกขนาดของร้าน รวมที่ปิด** เรียง `sortOrder` · `settings.defaultSize` เป็นขนาดใดก็ได้ที่ active · ปุ่มขนาดบนหน้าขาย = ขนาดใน `sizes` ที่ `isActive` และเมนูนั้นมีตัวแปร เรียง `sortOrder` · **ก่อนเก็บเงิน** แท็บเล็ตตรวจว่าขนาดของทุกบรรทัดอยู่ใน `sizes` ที่ active และมีตัวแปร (ไม่งั้นปฏิเสธการขายในเครื่อง — ไม่ปล่อยให้ dayo ตอบ `UNKNOWN_CODE` ทีหลัง) · ขนาดที่ไม่ตรงรูป = แคตตาล็อกอ่านไม่ได้ (เก็บฉบับเดิม)
13. **`timeFrom`/`timeTo` ของโปรส่งเป็น `"HH:MM:SS"`** (ชนิด `time` ดิบ) ไม่ใช่ `"HH:MM"` · schema ฝั่งแท็บเล็ตรับทั้งสองรูป · **ห้ามแท็บเล็ตตัด/แปลงค่าเอง** ต้องส่งเข้าตัวคิดราคาตรงตัวเพื่อคิดเหมือน shared ของ dayo ทุกตัวอักษร · ผลข้างเคียงที่รู้แล้ว: shared เทียบสตริง `"17:00" < "17:00:00"` จึงไม่ให้โปรในนาทีแรกของช่วง ขณะที่ SQL (`quote_order`) ให้ → บิลนาทีแรกของโปรจำกัดเวลาจะมี `computed_total ≠ total` · **แจ้ง dayo ให้แก้ที่ต้นทาง** (ส่ง `left(time::text, 5)` แบบ `0020_api_v1.sql:126`) — ไม่แก้ฝั่งแท็บเล็ต

### 4.5 E2 — `POST /v1/pos/push` (ล็อก)

scope: **ที่ dayo ship จริง** — key ที่ไม่มี `orders:write` ได้ **HTTP 403 `DY403` ทั้งคำขอ** ก่อนถึงแถวใด (`0052_pos_push.sql:725-726`) · การตรวจต่อแถว (`rejected / FORBIDDEN`) ยังอยู่ในโค้ดแต่ไปไม่ถึงในก้อน 1–2 (มีชนิดเดียวที่ต้องใช้ scope เดียว) · ก้อน 3–6 ที่มีหลาย scope (ล็อกแล้ว — §4.10 ก้อน 3): 403 ทั้งคำขอยังใช้กับ `orders:write` เหมือนเดิม · scope ของชนิดใหม่ (`shift:write` …) ตรวจ **ต่อแถว** → `rejected FORBIDDEN` · แท็บเล็ตทำกับ 403 ทั้งคำขอตาม §6.3 · RPC ใหม่ `api_pos_push(p_shop_id, p_api_client_id, p_scopes, p_rows)` ก้อนเดียว (P2)

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
| `sale_date` | `YYYY-MM-DD` | ✓ | ต้องเท่ากับวันที่ไทยของ `sold_at` (ไม่ตรง = `INVALID`) · **> วันนี้ของเซิร์ฟเวอร์ = `deferred CLOCK_AHEAD`** (ไม่ใช่ rejected — `0052_pos_push.sql:357-358`) · ≥ วันนี้ − 60 วัน (ไม่ตรง = `INVALID`) |
| `sold_at` | ISO UTC | ✓ | เวลาชำระ → `orders.sold_at` · `sale_time` ของการคิดโปร = `to_char(sold_at at time zone 'Asia/Bangkok', 'HH24:MI')` (ตัดวินาที ไม่ปัด) (เชื่อได้ — ADR-0040 ข้อ 4) · เกินเวลาเซิร์ฟเวอร์ + 5 นาที → `deferred CLOCK_AHEAD` |
| `channel` | string | ✓ | `sales_channels.code` |
| `payment` | string | ✓ | `payment_methods.code` (แท็บเล็ต: `cash` หรือ `qr`) |
| `staff_id` | uuid | ✓ | `staff.id` ของคนที่ล็อกอินขาย → `orders.created_by` (P2 ข้อ 3) |
| `catalog_version` | int ≥ 1 | ✓ | → `orders.catalog_version` |
| `shift_id` | uuid หรือ null | ก้อน 2: **ส่ง null เสมอ** (กะช่วงก้อน 2 ไม่มีในฐานกลาง) · ก้อน 3: บังคับ **ยกเว้นบิลของกะที่เป็น `local_only` (เปิดก่อนก้อน 3 ใช้งานจริง) ส่ง null เสมอ แม้ก้อน 3 ใช้งานแล้ว** | → `orders.pos_shift_id` · **ผูกทีหลังได้**: ไม่มี FK และ dayo ไม่รอกะ — บิลไม่ถูกบล็อกเพราะกะยังไม่มา/ถูกปฏิเสธ (§4.10 ก้อน 3) |
| `lines` | array 1–50 | ✓ | รวม ≤ 500 แก้ว (กติกา `DY422 too_large` เดิม) |
| `lines[].code` | string | ✓ | `menu_items.code` |
| `lines[].size` / `sweetness` | string | ✓ | ค่าตาม §4.1 · dayo ตรวจแค่เป็นข้อความ ≤ 20 / ≤ 10 ตัว แล้วหาตัวแปร `(menu, size, sweetness)` (รวมที่ปิดใช้) · ไม่พบ = `UNKNOWN_CODE` (`0052_pos_push.sql:293, 381-386`) |
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
0. **ตรวจก่อนเรียก `create_order` ตามลำดับนี้ (ล็อก)** (ใน `api_pos_push`): **(1) เทียบ hash เนื้อหาของ key กันซ้ำก่อนเสมอ** — มี key นี้ใน `api_idempotency_keys` (ผลที่บันทึกสำเร็จภายใน 30 วัน): hash เท่า → `duplicate` ผลเดิม · hash ต่าง → **`CONFLICT`** (ก้อน 3: `detail` ขึ้นต้น `key_changed:`) แล้วหยุด · ไม่มี key → ไปข้อ (2) · **(2)** (ก) มีบิล `(api_client_id, pos_order_id)` นี้แล้ว → `duplicate` คืนบิลนั้น · **ก้อน 3 (R4-2): หาด้วย `(shop_id, pos_order_id)` — บิลเดียวกันที่อยู่ใต้ key อื่นของร้าน (ส่งซ้ำหลังเปลี่ยนกุญแจเครื่อง) = `rejected CONFLICT` `exists:<order_no>` พร้อม `data` ไม่ใช่สร้างใหม่** · **ยกเว้นบิลนั้นเป็นบิลนอกแคตตาล็อก (`orders.off_catalog = true`) → `rejected CONFLICT` `off_catalog_exists:<order_no>`** พร้อม `data` = `{order_no, version, reported_total, payment_is_cash, off_catalog: true}` (ก้อน 3 · D91 — แทนขั้น (ก0) `pos_excluded_orders` เดิมที่ยกเลิกแล้ว · บิลเดียวไม่นับรายได้สองครั้ง) (ข) มีบิล `(api_client_id, external_ref = receipt_no)` แต่ `pos_order_id` ต่างหรือว่าง → **`CONFLICT` เสมอ ห้ามเป็น `duplicate`** (ก้อน 3: `receipt_taken:`) (ค) ไม่พบทั้งคู่ → สร้าง · ทางลัด "external_ref ซ้ำ = คืนบิลเดิม" ภายใน `create_order` (0008) ต้องเทียบ `pos_order_id` ด้วย: ไม่ตรง → raise `DY409 external_ref_taken` → แผนที่เป็น `CONFLICT` (กรณีสองคำขอชนกันพร้อมกัน)
1. เรียก `create_order` ภายใน (quote ซ้ำ · แช่แข็งต้นทุน · หักสต็อก · `amount_mismatch` เมื่อต่าง > ฿1 · เก็บ `pos_computed_total` ทุกบิล) ด้วย actor = `{api_client_id, staff_id}`
2. **บิลจากแท็บเล็ตไม่ถูกปฏิเสธเพราะแคตตาล็อกเปลี่ยนหลังขาย**: เมนู/ตัวแปร/ตัวเลือก/ช่องทาง/วิธีชำระที่ถูกปิดใช้แล้วยังใช้คิดได้ (ขยาย `include_inactive` ที่ `dayo_quote` ทำกับเมนูอยู่แล้วให้ครอบตัวเลือก ช่องทาง วิธีชำระ) · ถูกปฏิเสธเฉพาะ **รหัสที่ไม่มีในร้านเลย** (`UNKNOWN_CODE`) · **โปร (แก้ตาม ADR-0049 ข้อ 5 + ADR-0053)**: dayo หาสถานะโปร **ณ `sold_at`** จากประวัติเปิด/ปิด — โปรที่ปิด *หลัง* เวลาขายยังคิดให้ · โปรที่ปิด *ก่อน* เวลาขาย **ไม่ถูกคิด** แม้แท็บเล็ตใช้ (แคตตาล็อกในเครื่องเก่า) → บิลไม่ถูกปฏิเสธ แต่ `computed_total ≠ total` (และ `amount_mismatch` เมื่อต่าง > ฿1) ขึ้นในรายการ "ยอดไม่ตรงระบบกลาง" ของแท็บเล็ต · บิลมีหมายเหตุ `closed_promotions` ฝั่ง dayo (ไม่กระทบเงิน)
3. ไม่ใช้เพดานบันทึกย้อนหลังตามบทบาท (ADR-0020/0046) กับบิลจากแท็บเล็ต — ใช้ช่วง ≤ 60 วันในตาราง
4. `staff_id` ต้องเป็นพนักงานของร้านสถานะ `active` **หรือ** `removed` (ขายไปก่อนถูกปลด) · `pending`/ไม่พบ → `UNKNOWN_STAFF`
5. ตรวจธงบิลน่าจะซ้ำ (§4.8) หลังบันทึก
6. **ลำดับตรวจแถวที่ dayo ship จริง** (`0052_pos_push.sql:560-620` — mock ของ POS ต้องทำตามนี้): แถวไม่ใช่ออบเจกต์ `INVALID` → `key` ผิดรูป `BAD_KEY` → `kind` ไม่ใช่ข้อความ `INVALID` → ชนิดใน key ≠ `kind` `BAD_KEY` → ชนิดไม่รู้จัก `deferred UNSUPPORTED` → `data` ไม่ใช่ออบเจกต์ `INVALID` → ฟิลด์ไม่รู้จัก (รวม `lines.*`) `deferred UNSUPPORTED` → ไม่มี `orders:write` `FORBIDDEN` → `pos_order_id` ไม่ใช่ uuid `INVALID` → uuid ใน key ≠ `pos_order_id` `BAD_KEY` → hash ของ key (ข้อ 0 (1)) → ตรวจตามชนิด (`order`: รูปฟิลด์ → เวลา/`CLOCK_AHEAD` → วันขาย → ผู้ขาย → รหัส · `order_void`: รูปฟิลด์ → ผู้ทำ → `CLOCK_AHEAD` → 60 วัน → หาบิล) · **ก้อน 3 ขยายลำดับนี้** (§4.10 ก้อน 3): หลัง `orders:write` เพิ่ม "ชนิดกะแต่ไม่มี `shift:write` → `FORBIDDEN`" · สองขั้น `pos_order_id` เปลี่ยนเป็น "ช่อง id ของชนิดนั้น" (`shift_id` / `movement_id` / `count_id` / `pos_order_id`)

**แถวชนิด `order_void`** — key = `order_void:<pos_order_id>` (บิลละครั้งเดียว)

| ฟิลด์ | ชนิด | บังคับ | กติกา |
|---|---|---|---|
| `pos_order_id` | uuid | ✓ | บิลที่ยกเลิก (ต้องเป็นบิลของ API key นี้) |
| `voided_at` | ISO UTC | ✓ | เวลายกเลิกในเครื่อง · วันที่ไทยต้อง **เท่ากับ `sale_date` ของบิล** (ไม่ตรง = `FORBIDDEN`) · ≥ `sold_at` (ไม่ตรง = `INVALID`) · เกินเวลาเซิร์ฟเวอร์ + 5 นาที = **`deferred CLOCK_AHEAD`** (ไม่ใช่ rejected — ส่งซ้ำทีหลังผ่านได้) · **เก่ากว่าเวลาเซิร์ฟเวอร์ − 60 วัน = `rejected INVALID`** (ตรวจก่อนหาบิล — `0052_pos_push.sql:491-494`) |
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
| `CONFLICT` | key เดิมแต่เนื้อหาต่างจากที่เคย **บันทึกสำเร็จ** · `receipt_no` นี้ถูกใช้แล้วกับ `pos_order_id` อื่น (หรือว่าง) ของ API key เดียวกัน · (ก้อน 3) `order` ของบิลที่เป็นนอกแคตตาล็อกแล้ว / `order_off_catalog` ของบิลที่อยู่ในฐานแล้ว / กะมีการนับเงินอีกใบแล้ว (§4.10) — **แทน `ALREADY_PRESENT` ของร่างเดิม (ยกเลิก)** |
| `FORBIDDEN` | key ไม่มี scope ของชนิดนี้ (ก้อน 1–2 ไปไม่ถึง — dayo ตอบ 403 ทั้งคำขอก่อน) · ยกเลิกบิลที่ไม่ใช่ของ key นี้ · ผิดกติกาวันยกเลิก (`voided_at` คนละวันกับ `sale_date`) |

| reason (`deferred`) | เกิดเมื่อ |
|---|---|
| `PARENT_PENDING` | แถวอ้างบิล/กะที่ยังไม่มีในฐานกลางและไม่อยู่ก่อนหน้าในคำขอเดียวกัน (เช่น `order_void` ของบิลที่ยังมาไม่ถึง) — ฝั่ง dayo ไม่ตอบ "ไม่พบ" แบบถาวรเด็ดขาด เพราะแถวแม่อาจกำลังมา |
| `BUSY` | ล็อกชน / deadlock / serialization / หมดเวลา / คีย์กำลังถูกใช้โดยคำขออื่น |
| `CLOCK_AHEAD` | `sold_at`/`voided_at` เกินเวลาเซิร์ฟเวอร์ + 5 นาที · `sale_date` เป็นวันพรุ่งนี้ของเซิร์ฟเวอร์ |
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
| `DY404` บิลที่จะยกเลิกไม่พบ · (ก้อน 3) กะ/การนับเงินที่แถวอ้างไม่พบ (`cash_movement` `cash_count` `shift_close`) | | `deferred PARENT_PENDING` |
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

error ทั้งคำขอ (ไม่มี `results`): 401 key ผิด/ถูกเพิกถอน · 403 key ไม่มี `orders:write` (ก้อน 1–2 · ดูบรรทัด scope ต้น §4.5) · 404 API ปิด · 422 ซองผิด · 429 เกินอัตรา · 5xx **เฉพาะเมื่อเรียก RPC ไม่ได้เลย** (ต่อฐานไม่ได้/Worker ล้ม) — error ของแถวไม่เป็น 5xx · ทุกกรณีมีหัว CORS (§4.1) → แท็บเล็ตทำตาม §6.3

### 4.6 E3 — `GET /v1/orders?from=&to=&updated_since=` (มีอยู่แล้ว · ขยายฟิลด์ — ล็อก)

scope `orders:read` · ใช้แสดง "บิลจากบอท/เว็บของวันนี้" บนแท็บเล็ต (กันคนบันทึกซ้ำ — 03 §8 ข้อ 3) · แท็บเล็ตดึงเมื่อเปิดหน้านั้น และทุก 5 นาทีระหว่างที่หน้าเปิดอยู่
เพิ่มฟิลด์ต่อบิล (P2): `sold_at` (ISO หรือ null) · `created_by_name` (ชื่อพนักงาน หรือ null) · `pos_receipt_no` (= `external_ref` เมื่อ `source='pos'`) · `pos_queue_no` · `catalog_version` · `duplicate_suspect` (bool — มีธงเปิดอยู่) · ฟิลด์เดิมคงเดิมทั้งหมด (ไม่มีต้นทุน/กำไร)
**ฟิลด์ที่ dayo ship เพิ่ม (ADR-0050 ข้อ 3/6 · `0052_pos_push.sql:821-831`)**:
- **`dayo_edit`**: `{kind: "edit" | "cancel", edited_at, edited_by_name, reason, version}` หรือ `null` (= บิลไม่เคยถูกแก้/ยกเลิกจากฝั่ง dayo) · เป็นการแก้ล่าสุดที่ **ไม่ได้มาจาก API key** (การยกเลิกของแท็บเล็ตเองไม่นับ) · `edited_by_name` และ `reason` เป็น `null` ถ้า key ไม่มี `staff:read` (เช่นเดียวกับ `created_by_name`)
- **`pos_order_id`**: uuid ของบิลในเครื่อง **เฉพาะบิลของ API key นี้** · บิลอื่น = `null`
- `updated_at` **ไม่เป็น null อีก** (`coalesce(updated_at, created_at)`) — schema ฝั่งแท็บเล็ตยังรับ null ได้
- หลัง owner แก้บิล POS บนเว็บ: `totals`/`status` ใน E3 เป็นยอดที่ dayo คิดใหม่ · ยอดที่ POS รายงานเดิมแช่แข็งใน `orders.pos_reported_amounts` (ไม่ส่งใน E3)

แท็บเล็ตใช้ E3 สองทาง: (1) หน้า "บิลบอท/เว็บวันนี้" = บิลที่ `source ≠ 'pos'` (เดิม) (2) **บิล POS ของตัวเอง** (`pos_order_id` ไม่ว่าง) → เก็บ `dayo_edit` ลงบิลในเครื่อง แล้วแสดง **แบบอ่านอย่างเดียว** บนรายละเอียดบิล ("เจ้าของแก้/ยกเลิกบนเว็บ: <เหตุผล>") · `kind = 'cancel'` → ซ่อนปุ่มยกเลิกบนแท็บเล็ต · **ใบเสร็จ ยอดบิล และยอดกะในเครื่องคงเป็นเงินที่เก็บจริง** ไม่เปลี่ยนตามยอดใหม่ของ dayo · เงินในลิ้นชักและใบปิดกะยึดเงินที่เก็บจริง ส่วนต่างจากการแก้บนเว็บแสดงบนเว็บ dayo เป็นบรรทัด "เจ้าของแก้บิลหลังขาย" (D93 · §4.10 ก้อน 3)

### 4.7 แหล่งและผู้บันทึกของบิล · owner แก้บิล POS บนเว็บ (ล็อก — ข้อสุดท้ายแก้ตาม D85)

- แหล่ง = `orders.source` ค่าเดิมของ dayo: `pos` (แท็บเล็ต) · `line` (บอท — หน้าจอแสดงคำว่า "บอท") · `web` · **ไม่เปลี่ยนชื่อค่า** (brief เรียก `bot` แต่ค่าจริงในฐานคือ `line`)
- ผู้บันทึก = `orders.created_by` → `staff` · บิลจากแท็บเล็ตต้องมีเสมอ (`staff_id` บังคับใน E2) · บิลจากบอท/เว็บมีอยู่แล้ว (ADR-0024 ข้อ 2)
- เว็บและบอทแสดง "แหล่ง · ผู้บันทึก" ทุกที่ที่แสดงบิล · บิลจาก POS แสดง "ใบเสร็จ A-000312 · คิว 12" เพิ่ม
- **บิล `source='pos'` แก้/ยกเลิกบนเว็บได้เฉพาะ owner ต้องกรอกเหตุผล (1–200) ทุกครั้ง** (ADR-0050 ข้อ 3 · **D85 แทน D76 เฉพาะเรื่องเว็บ**) · บอท/manager/staff/API ทำไม่ได้ (`DY403`) · ยอดบิลหลังแก้ = ยอดที่ระบบคิดใหม่ · ยอดที่ POS เก็บจริงแช่แข็งใน `orders.pos_reported_amounts` · **แท็บเล็ต**: แสดงการแก้เป็น `dayo_edit` แบบอ่านอย่างเดียว (§4.6) · ไม่มีฟีเจอร์แก้บิล · ยกเลิกบิลตัวเองได้เฉพาะวันขายเดียวกัน (ADR-0049 ข้อ 6) · **บิลของวันที่ปิดแล้วแก้บนแท็บเล็ตไม่ได้** — ส่วนต่างแก้ด้วยการปรับในกะปัจจุบัน (`cash_movement` `PAID_IN`/`PAID_OUT` พร้อมเหตุผลอ้างเลขใบเสร็จ) หรือบันทึกเป็นค่าใช้จ่าย (D76 ส่วนที่ยังยืน · Q52) · เงินในลิ้นชักไม่ตามการแก้บนเว็บ (D93 · §4.10 ก้อน 3)

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
- ปิดธง: owner บนแดชบอร์ดเว็บ กด "ไม่ซ้ำ" (`resolved_not_duplicate` + หมายเหตุ) หรือยกเลิกบิลใดบิลหนึ่ง → ธงปิดเองเป็น `resolved_cancelled` · บิล POS ยกเลิกที่แท็บเล็ตในวันเดียวกันเท่านั้น (§4.7) จึงแนะนำให้ยกเลิกฝั่งบอท/เว็บ (owner ยกเลิกบิล POS บนเว็บได้ด้วยพร้อมเหตุผล → ธงปิดเป็น `resolved_cancelled` — ADR-0050 · D85)
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
| RPC | ใหม่ `api_pos_catalog` `api_pos_push` · แก้ `create_order` (เติม `sold_at` `catalog_version` `items_signature` + ตรวจซ้ำ) · `update_order` (ตรวจซ้ำใหม่เมื่อแก้รายการ + บิล POS แก้ได้เฉพาะ owner บนเว็บพร้อมเหตุผล — ADR-0050 · D85) · `cancel_order` (ปิดธง + บิล POS ยกเลิกบนเว็บได้เฉพาะ owner พร้อมเหตุผล — เช่นเดียวกัน) · `dashboard_*` (ธงซ้ำ) · `backup_dump_table` (ตารางใหม่) |
| Route Handler | `app/api/v1/pos/catalog/route.ts` · `app/api/v1/pos/push/route.ts` · CORS ใน `lib/api/response.ts` (`apiHandler` — ที่เดียวกับสวิตช์ `API_V1_ENABLED`) + `OPTIONS` ของทุก route · `lib/api/orders.ts` (`listApiOrders` ฟิลด์ใหม่) · build ของเว็บเขียน `pricing.commit` + `files_sha256` |

### 4.10 ก้อน 3–6: โครงข้อมูลและ endpoint ระดับร่าง — **ล็อกก่อนเริ่มก้อนนั้น**

ทุกตารางในส่วนนี้: `id uuid` จากแท็บเล็ต · `shop_id` · `api_client_id` · **เวลาเซิร์ฟเวอร์ = `received_at`** (ตั้งแต่ก้อน 3) · `created_at` เป็น **เวลาเครื่อง** เฉพาะตารางที่ระบุไว้ (เช่น `cash_movements`) · RLS เปิดไม่มี policy · **append-only** (trigger raise เมื่อ update/delete ยกเว้นคอลัมน์ "ปิด" ที่ตั้งได้ครั้งเดียวจาก null) · ลงไฟล์สำรอง · เงิน `numeric(10,2)` บาท · เข้าทาง `POST /v1/pos/push` ชนิดใหม่ (คำตัดสิน/กันซ้ำแบบเดียวกับ §4.5)

**ก้อน 3 — กะ เงินสด นับเงิน ใบปิดกะ** (P3 → ADR-0056 · scope `shift:write`) — **ล็อก 26 ก.ย. 2569 (D90–D100) · พร้อมเขียนแผน** (สองแผน: ฝั่ง dayo และฝั่ง POS — D90) · ส่วนที่เปลี่ยนจากร่างเดิมอยู่ใน §13.8

หลักของก้อนนี้ (ล็อก)
1. **กะมีเฉพาะที่แท็บเล็ต** (D92): เปิด/ปิดกะ นับเงิน ใบปิดกะ ทำบนแท็บเล็ตเท่านั้น · บอทไม่มีคำสั่งกะ · เว็บ dayo อ่านอย่างเดียว (D99) · ขอ dayo แก้ ADR-0024 ข้อ 2 ให้เขียนแบบนี้
2. **เงินในลิ้นชักยึดเงินที่เก็บจริงตอนขาย** (D93): เงินสดที่ควรมีบนแท็บเล็ต และการคิดใบปิดกะซ้ำของ dayo ใช้ยอดและวิธีชำระ **ที่แท็บเล็ตเก็บจริง** (`orders.pos_reported_amounts` ที่แช่แข็งตั้งแต่บิลเข้า) **ไม่ใช่** `total_amount`/วิธีชำระ/สถานะหลังเจ้าของแก้บนเว็บ · การแก้บนเว็บ (D85) แสดงบนเว็บ dayo เป็นบรรทัดแยก **"เจ้าของแก้บิลหลังขาย"** · ไม่เข้าใบปิดกะ · ไม่ทำให้ `mismatch`
3. **บิลที่เข้าฐานกลางไม่ได้ ปิดเป็น "บิลนอกแคตตาล็อก" ใน `orders`** (D91 · D97) — **แทน** ตาราง `pos_excluded_orders` ชนิด `order_excluded` ธง `excluded` ใน snapshot และเหตุผล `ALREADY_PRESENT` ของร่างเดิม (ยกเลิกทั้งหมด) · ยอดขายทุกแหล่งอยู่ใน `orders` ตารางเดียว (ADR-0050 ข้อ 1)
4. แถวกะ/เงินสดของกะที่เปิดก่อนก้อน 3 ใช้งานจริงเป็น `local_only` ไม่ส่งตลอดไป (§6.1 · คงเดิม) · บิลของกะ `local_only` ส่ง `shift_id: null` เสมอ แม้ก้อน 3 ใช้งานแล้ว · บิลที่ถูกปิดเป็น "นอกระบบกลาง" ในก้อน 2 (แผนก้อน 2 R8: `local_only` + `order.excluded_at` + event `EXCLUDED_FROM_SYNC`) **คงเป็น `local_only` ไม่แปลงเป็น `order_off_catalog`** เพราะแท็บเล็ตยังไม่ขายจริงก่อนก้อน 3 (D94) · ก้อน 3 เปลี่ยนปุ่มนั้นเป็น "ปิดเป็นบิลนอกแคตตาล็อก" (§6.4)

**ตาราง/คอลัมน์ใหม่ฝั่ง dayo** (กติการ่วมข้างบนของ §4.10 · ทุกตารางเพิ่ม `received_at timestamptz default now()` = เวลาที่ฐานรับ · เวลาจากเครื่องอยู่ในคอลัมน์ชื่อเฉพาะ · เงิน `numeric(10,2)` บาท)
- `shifts`: `id` (= `shift_id` ของแท็บเล็ต), `business_date`, `opened_by`, `opened_at`, `opening_float`, `quick_open`, `status` (`open` → `counted` เมื่อรับ `cash_count` → `closed` เมื่อรับ `shift_close` — **ใช้แสดงผลเท่านั้น** กติกาตัดสินด้วยเวลาในแถว · trigger ยอมให้เปลี่ยนไปข้างหน้าเท่านั้น), `closed_by`, `closed_at` (ตั้งครั้งเดียวจาก null), `data_conflict bool` (S5 · R3-m7 — ตั้งได้เฉพาะฟังก์ชันตรวจชน) · **ไม่มี unique "กะ `open` ได้ครั้งละหนึ่งต่อ key" ในฐาน** — แท็บเล็ตบังคับเองในเครื่อง (D47 ข้อ 6) · เว็บแสดง "กะซ้อนกัน" แทน (§13.8 C3)
- `cash_movements`: `id`, `shift_id`, `kind` (`PAID_IN`/`PAID_OUT`/`DROP`/`VOID_REFUND` — enum เดียวกับ POS), `amount > 0`, `pos_order_id` (มีเฉพาะ `VOID_REFUND` — check), `reason`, `created_by`, `created_at` (เวลาเครื่อง) · **`VOID_REFUND` เป็นแหล่งความจริงเดียวของเงินคืนจากบิลที่ยกเลิก** (`order_void` ไม่มีข้อมูลคืนเงิน)
- `cash_counts`: `id`, `shift_id` (**unique — นับปิดกะกะละครั้ง**), `lines jsonb [{denomination, count}]` (9 ชนิด 1000…1 บาท — D52), `counted`, `counted_by`, `counted_at` (เวลาเครื่อง) · **ไม่มี `expected`/`variance`/`reason` แล้ว** — ย้ายไป `z_reports` เพราะนับได้ตอนออฟไลน์ แต่เงินที่ควรมีต้องรอบิลบอทตอนออก Z (D68 · §13.8 C4)
- `z_reports`: `shift_id` (unique), `z_no`, `hash`, `prev_hash`, `chain_warning`, `snapshot jsonb` (= `z_report` ที่ส่งมาตรงตัว), `expected` / `variance` (**dayo คิดจาก `snapshot.cash`** · `variance = counted − expected` ติดลบ = ขาด), `counted`, `variance_reason`, `recompute_status` (`waiting_bills`/`matched`/`mismatch` — **`waiting_bills` หมายถึง "รอแถวมาครบ" ทั้งบิลและเงินเข้า-ออก** ไม่เพิ่มสถานะใหม่), `z_mismatch bool` (= `recompute_status='mismatch'`), `recompute_detail jsonb` (องค์ประกอบ/บิลที่ต่าง + ข้อสังเกตที่ไม่ทำให้ต่าง), `missing_pos_order_ids uuid[]`, `missing_movement_ids uuid[]`, `missing_void_order_ids uuid[]` (บิลที่มี `VOID_REFUND` แต่ยังไม่ถูกยกเลิกในฐาน — R3-A), `waiting_since` (เวลาที่เข้า `waiting_bills` ครั้งแรก — แสดงอายุการรอบนเว็บ), `recomputed_at`, `variance_alert` (เกณฑ์จาก `z_report` — D102), `chain_break bool` (S5), `recompute_notes jsonb` (ข้อสังเกตที่ไม่ใช่ mismatch เช่น "Z ขาดช่วง") · **unique `(api_client_id, z_no)`** (R3-B), `alerted_variance_at` / `alerted_mismatch_at` (กันแจ้งซ้ำ) · trigger: แก้ไม่ได้ทุกคอลัมน์ **ยกเว้น** `recompute_status` `z_mismatch` `recompute_detail` `missing_*` `waiting_since` `recomputed_at` `chain_break` `recompute_notes` `alerted_*` ซึ่งตั้งได้เฉพาะฟังก์ชันคิดซ้ำ/แจ้งเตือน
- `pos_push_rejections` (ใหม่ — S1(a) · R3-C): `shop_id`, `api_client_id`, `pos_order_id`, `reason`, `first_at` · **หนึ่งแถวต่อ `(api_client_id, pos_order_id, reason)`** (unique สามคอลัมน์ · เก็บทุกเหตุผลที่เคยเห็น ไม่ใช่แค่เหตุผลแรก) · แทรกเมื่อแถว `order` ได้ `rejected` (ใน `api_pos_push` นอก savepoint ของแถว — ต้องไม่ถูกย้อน · ชนแล้วข้าม) · ดัชนี `(shop_id, pos_order_id)` · RLS เปิดไม่มี policy · ลงไฟล์สำรอง · ใช้ตัดสิน `order_off_catalog`
- `orders`: **เปลี่ยน unique index `orders_api_client_pos_order_key (api_client_id, pos_order_id)` เป็น `(shop_id, pos_order_id)` where `pos_order_id is not null`** (R4-2 · migration ใหม่ทับ index ที่ ship แล้วใน `0051_multi_source_sales.sql:38` ซึ่งใช้ใน `0052`) — บิลหนึ่งใบนับรายได้ครั้งเดียวต่อร้าน แม้ส่งซ้ำด้วย key ใหม่ · ก่อนสร้าง index ต้องตรวจว่าไม่มีคู่ซ้ำในข้อมูลเดิม · ตัวแปลง `23505` ของ `order` หาใหม่ด้วย `(shop_id, pos_order_id)` · เพิ่ม: `off_catalog boolean not null default false` · `off_catalog_lines jsonb` · **`cost_total` เป็น null ได้เฉพาะบิลนอกแคตตาล็อก** (check `off_catalog = (cost_total is null)` · ต้นทุนไม่ทราบ ≠ 0) · **บิล POS ใหม่ทุกใบมีคีย์ `payment`** (รหัสวิธีชำระ ณ ตอนขาย) ใน `pos_reported_amounts` (แช่แข็งด้วย trigger `orders_pos_frozen` เดิม — ใช้กับ D93) · **`orders_pos_frozen` เพิ่ม `pos_shift_id` และ `external_ref` ของบิล POS** (ตอนนี้ไม่อยู่ใน `0051_multi_source_sales.sql:104-108` — Z จับคู่บิลด้วยค่าทั้งสอง) · ชื่อคอลัมน์ dayo เปลี่ยนได้ (P3 คำถาม ค1)
- `shop_settings.block3_live_from date` — **ตั้งเองอัตโนมัติ** = `business_date` ของ `shift_open` แรกที่ `accepted` ของร้าน **เฉพาะเมื่อ `business_date` ≥ วันนี้ − 1** (กะเก่าที่ส่งช้าไม่ตั้งค่า — m5) · ตั้งครั้งเดียวจาก null ในธุรกรรมเดียวกับแถวนั้น · เจ้าของไม่ต้องกรอก (D100) · owner **แก้บนเว็บได้เฉพาะเป็นวันที่เก่ากว่าเดิม** พร้อม `audit_log` (R3-C · ห้ามเลื่อนไปข้างหน้าหรือล้างค่า — ค่านี้เป็นพื้นล่างของบิลนอกแคตตาล็อก)
- `shop_settings.off_catalog_max_total numeric(10,2)` (ใหม่ — S1(c)) — เพดานยอดต่อบิลนอกแคตตาล็อก **ค่าเริ่มต้น ฿3,000 (รอเจ้าของยืนยัน Q72)** · owner แก้บนเว็บ (ตั้งค่าระบบ ADR-0046) พร้อม `audit_log`
- `api_clients` scope เพิ่ม `shift:write`

**ชนิด push ของก้อน 3 (ล็อก — ตอบ ADR-0056 คำถามข้อ 3)** · ซอง คำตัดสิน กันซ้ำ ตารางแผนที่ error ตาม §4.5 · **เงิน**: ทุกช่องเป็นบาท แท็บเล็ตแปลงจากสตางค์ด้วย `edgeSatangToBaht` ตอนเขียน outbox (§4.2 · §6.1) · **ไม่มีเงินติดลบข้ามขอบ** — เงินที่ควรมีและส่วนต่าง dayo คิดเองจากองค์ประกอบที่ไม่ติดลบ · **เวลา**: ISO UTC มีมิลลิวินาทีจากนาฬิกาเครื่อง · **id**: UUID ตัวเล็กที่แท็บเล็ตสร้าง · key รูป `<kind>:<uuid>` (ผ่าน regex เดิม `^[a-z][a-z_]{0,39}:<uuid>$` — `0052_pos_push.sql:564`)

| ชนิด | key | ช่อง id ใน `data` | scope | ช่องในคิว (§6.2) | แถวแม่ในเครื่อง |
|---|---|---|---|---|---|
| `shift_open` | `shift_open:<shift_id>` | `shift_id` | `shift:write` | ช่องกะ | — |
| `cash_movement` | `cash_movement:<movement_id>` | `movement_id` | `shift:write` | ช่องกะ | `shift_open` ของกะ |
| `cash_count` | `cash_count:<count_id>` | `count_id` | `shift:write` | ช่องกะ | `shift_open` ของกะ |
| `shift_close` | `shift_close:<shift_id>` | `shift_id` | `shift:write` | ช่องกะ | `cash_count` ของกะ |
| `order_off_catalog` | `order_off_catalog:<pos_order_id>` | `pos_order_id` | `orders:write` | ช่องบิล | — (ใช้แทนแถว `order` ที่ถูกปฏิเสธ) · เป็นแม่ของ `order_void` ของบิลนั้น |

กติการ่วมของชนิดใหม่ (ล็อก)
- **ลำดับตรวจแถว** = §4.5 ข้อ 6 โดย (ก) หลังขั้น `orders:write` เพิ่ม "ชนิดกะ และ key ไม่มี `shift:write` → `rejected FORBIDDEN`" (บิลในคำขอเดียวกันยังผ่าน) (ข) ขั้น "`pos_order_id` ไม่ใช่ uuid / uuid ใน key ≠ `pos_order_id`" ใช้ **ช่อง id ของชนิดนั้น** ตามตาราง
- **เวลา**: ช่องเวลาหลักของแถว (`opened_at` · `created_at` · `counted_at` · `closed_at`) เกินเวลาเซิร์ฟเวอร์ + 5 นาที = `deferred CLOCK_AHEAD` · เก่ากว่าเวลาเซิร์ฟเวอร์ − 60 วัน = `rejected INVALID`
- **พนักงาน**: ช่อง `*_by` = `staff.id` ของร้าน สถานะ active หรือ removed (ไม่พบ/pending = `UNKNOWN_STAFF`) · ช่องที่ต้องเป็น owner (ระบุในตาราง) ต้องเป็น role owner **และ active ณ เวลาในแถว** (`closed_at` / `opened_at` — m6 · dayo ตรวจจากเวลาเปลี่ยนสถานะของพนักงาน) ไม่งั้น `FORBIDDEN` `role:` · ตรวจแค่เป็นผู้ระบุตัว ไม่ใช่สิทธิ์ (ADR-0040) — ด่านจริงคือ PIN owner บนแท็บเล็ต
- **ขอบเขต key (S4)**: ทุกการหา `shifts` `cash_counts` `cash_movements` `z_reports` ใช้ `(shop_id, api_client_id, id)` เสมอ · แถวแม่ (กะ/การนับ) ที่เป็นของ key อื่น = `rejected FORBIDDEN` `rule:` · "id เดิม = `duplicate`" ใช้เฉพาะเมื่อ `api_client_id` ตรง (id ชนกับ key อื่น = `FORBIDDEN` `rule:`)
- **แถวแม่ยังไม่มีในฐาน** (และไม่อยู่ก่อนหน้าในคำขอเดียวกัน) = `deferred PARENT_PENDING` · id เดิมมีในตารางแล้ว (หลังคีย์กันซ้ำหมดอายุ 30 วัน · key เดียวกัน) = `duplicate`
- **แผนที่ `23505` (m3 · R4-2)**: `order`/`order_off_catalog` หาใหม่ด้วย `(shop_id, pos_order_id)`: บิลเดียวกันของ key เดียวกันและชนิดเดียวกัน = `duplicate` · `order` ชนบิลนอกแคตตาล็อก → `CONFLICT` `off_catalog_exists:<order_no>` · `order_off_catalog` ชนบิลปกติ → `CONFLICT` `exists:<order_no>` · ชนบิลของ key อื่น → `CONFLICT` `exists:`/`off_catalog_exists:` ตามชนิดบิล · ชนิดกะ → หาใหม่ด้วย `(api_client_id, id)`: เจอ = `duplicate` · ไม่เจอ (ชน unique อื่น เช่นการนับของกะ) = `CONFLICT` ตามคำนำหน้าที่ตรง (`counted:`) · กรณีอื่น = `CONFLICT` ไม่มีคำนำหน้า (`detail` = `SQLSTATE 23505` แบบเดิม)
- **เพดานรายการ (m4)**: `pos_bills` ≤ 2000 · `bot_bills` ≤ 500 · `movement_ids` ≤ 500 · เกิน = `rejected INVALID`
- **`supported_fields`** ของ E1 ต้องมีทุกฟิลด์ข้างล่าง · ตัวตรวจฟิลด์ของ dayo ตรวจ `lines.*` ของ **ทุกชนิดที่มี `lines`** (`0052_pos_push.sql:587-591`) จึงต้องมี `lines.denomination` `lines.count` (ของ `cash_count`) และ `lines.*` ของ `order_off_catalog` · คีย์ย่อยที่ไม่รู้จักใน `z_report` (รวม `cash`, `bot_window`, สมาชิกของ `bot_bills`/`pos_bills`) และ `totals` = `rejected INVALID` (แบบ S28)
- ขนาด: `shift_close` ของกะ ~150 บิล ≈ 30 KB อยู่ใต้เพดาน 256 KB ต่อคำขอ · ตัวส่งแบ่งก้อนตามขนาดไบต์ UTF-8 ของ body (กฎเหล็กข้อ 5 ของ POS) ไม่ใช่แค่นับ 20 แถว
- **คำนำหน้า `detail` ที่เครื่องอ่านได้ (ล็อก)** — ขึ้นต้น `detail` ด้วยคำนำหน้าตายตัว ตามด้วยข้อความไทย (แท็บเล็ตตัดสินจากคำนำหน้าเท่านั้น ไม่อ่านข้อความไทย · ไม่มีคำนำหน้า = ทำแบบเดิมของเหตุผลนั้น · **ค่าใด ๆ เช่นเลข `order_no` แท็บเล็ตอ่านจาก `data` เท่านั้น ห้ามแยกจาก `detail`** — `<order_no>` ใน `detail` มีไว้ให้คนอ่าน · R3-m4):
  - `FORBIDDEN`: `scope:` (key ไม่มี scope ของชนิดนี้ — **แก้ได้โดยเจ้าของเพิ่ม scope บนเว็บ** · **มาจากขั้นตรวจ scope ต่อชนิดเท่านั้น** ไม่ใช่จากตัวแปลง `DY403` ทั่วไป — m1 · dayo แจ้ง 🟡 Discord วันละครั้งต่อ key ขณะที่ยังปฏิเสธด้วย `scope:`) · `role:` (ช่องที่ต้องเป็น owner ไม่ใช่ owner active) · `rule:` (ผิดกติกา เช่น วันยกเลิก · แถวแม่เป็นของ key อื่น · บิลนอกแคตตาล็อกไม่ผ่านเงื่อนไข S1)
  - `CONFLICT`: `exists:<order_no>` (`order_off_catalog` ของบิลที่อยู่ในฐานเป็นบิลปกติแล้ว) · `off_catalog_exists:<order_no>` (`order` ของบิลที่อยู่ในฐานเป็นบิลนอกแคตตาล็อกแล้ว) · `receipt_taken:` (`receipt_no` ถูกใช้แล้วกับบิลอื่น) · `key_changed:` (key เดิมเนื้อหาต่างจากที่เคยบันทึกสำเร็จ) · `counted:` (กะมีการนับอีกใบแล้ว) · `z_no_taken:` (เลข Z ซ้ำกับ Z อื่นของ key — R3-B)
  - **`exists:` และ `off_catalog_exists:` มี `data`** = `{order_no, version, reported_total, payment_is_cash, off_catalog}` (m2 · `reported_total` = `pos_reported_amounts.total` บาท ≥ 0) · แท็บเล็ตเทียบกับค่าที่แช่แข็งของบิลในเครื่อง (ยอด · เงินสดหรือไม่) ต่าง = แถบแดง "บิลในระบบกลางไม่ตรงกับเครื่อง"
  - **แถวเงินที่ชนกัน (S5)**: `CONFLICT` `key_changed:` หรือ `counted:` ของชนิดกะ และ `shift_close` ที่ `z_report.counted` ≠ `cash_counts.counted` (ยังเป็น `rejected INVALID`) → dayo เขียน `audit_log` (sha256 ของเนื้อหาทั้งสองชุด) **นอก savepoint ของแถว** (แถวถูกปฏิเสธแล้วบันทึกต้องไม่ถูกย้อน — R3-m7) + 🔴 Discord "ข้อมูลกะชนกัน — ตรวจกุญแจเครื่อง" + ตั้ง `shifts.data_conflict` · **ผู้ส่งคนแรกชนะเสมอ** (ข้อมูลในฐานไม่เปลี่ยน) · แท็บเล็ตแสดงแถบแดง "ข้อมูลกะชนกับระบบกลาง — แนะนำให้เจ้าของเปลี่ยนกุญแจเครื่อง" (**ไม่ใช่** "บั๊ก → ส่งออก JSON")
  - ใช้กับทุกชนิดของก้อน 3 · dayo เพิ่มคำนำหน้าเดียวกันให้แถว `order`/`order_void` ในก้อน 3 ด้วย (ข้อความเดิมไม่มีคำนำหน้า — `0052_pos_push.sql:594, 614`)
- **`data` ของผล `accepted`/`duplicate` (ล็อก)** — ไม่มีเงินติดลบ ไม่มีต้นทุน:
  - `shift_open` → `{shift_id}` · `cash_movement` → `{movement_id}` · `cash_count` → `{count_id}`
  - `shift_close` → `{shift_id}` เท่านั้น — ผลถูกเก็บใต้คีย์กันซ้ำ ค่าที่เปลี่ยนภายหลัง (`recompute_status`) จึงห้ามอยู่ในผล (N4) · ไม่คืน `expected`/`variance` (ค่าเท่ากับบนจอเสมอ และ `variance` ติดลบข้ามขอบ §4.2 ไม่ได้)
  - `order_off_catalog` → `{order_no, version}` · **`order_no` ออกด้วยตัวออกเลขตัวเดียวกับ `create_order`** (รูป `L<yymmdd>-<seq>` ของ `sale_date` ต่อร้าน — check `orders.order_no`) ไม่มีชุดเลขแยก

**`shift_open`**

| ฟิลด์ใน `data` | ชนิด | บังคับ | กติกา / ที่เก็บ |
|---|---|---|---|
| `shift_id` | uuid | ✓ | → `shifts.id` |
| `business_date` | `YYYY-MM-DD` | ✓ | = วันที่ไทยของ `opened_at` (ไม่ตรง = `INVALID`) · > วันนี้ของเซิร์ฟเวอร์ = `deferred CLOCK_AHEAD` |
| `opened_at` | ISO UTC | ✓ | → `shifts.opened_at` |
| `opened_by` | uuid | ✓ | ผู้เปิดกะ |
| `opening_float` | บาท ≥ 0 | ✓ | เงินทอนตั้งต้น (0 ได้ — D48 Q3-12) |
| `quick_open` | bool | ✓ | เปิดกะด่วนของเจ้าของ (D52 Q3b-10) · `true` ⇒ `opened_by` ต้องเป็น owner active ณ `opened_at` (m6) |

หลังรับ: `shop_settings.block3_live_from` ยังว่าง **และ** `business_date` ≥ วันนี้ − 1 → ตั้งเป็น `business_date` ของแถวนี้ (D100 · m5) · key เดียวกันมีกะเกิน 3 กะในวันเดียว → 🟡 Discord (m4)

**`cash_movement`**

| ฟิลด์ใน `data` | ชนิด | บังคับ | กติกา / ที่เก็บ |
|---|---|---|---|
| `movement_id` | uuid | ✓ | → `cash_movements.id` |
| `shift_id` | uuid | ✓ | กะต้องมีแล้ว ไม่งั้น `PARENT_PENDING` |
| `kind` | `PAID_IN`/`PAID_OUT`/`DROP`/`VOID_REFUND` | ✓ | enum เดียวกับ POS (D36) |
| `amount` | บาท > 0 | ✓ | |
| `pos_order_id` | uuid/null | ✓ | ไม่ null **เฉพาะ** `VOID_REFUND` (ไม่ตรง = `INVALID`) · **ไม่รอบิล** (บิลผูกทีหลังได้) |
| `reason` | string 1–200/null | ✓ | บังคับสำหรับ `PAID_IN`/`PAID_OUT`/`DROP` (D52 Q3b-9) · `VOID_REFUND` เป็น null ได้ |
| `created_by` | uuid | ✓ | ผู้บันทึก |
| `created_at` | ISO UTC | ✓ | ≥ `opened_at` ของกะ · ถ้ากะมี `cash_count` ในฐานแล้ว ต้อง ≤ `counted_at` (ไม่ตรง = `INVALID`) |

**`cash_count`** (นับปิดกะ — กะละครั้ง)

| ฟิลด์ใน `data` | ชนิด | บังคับ | กติกา / ที่เก็บ |
|---|---|---|---|
| `count_id` | uuid | ✓ | → `cash_counts.id` |
| `shift_id` | uuid | ✓ | กะต้องมีแล้ว (`PARENT_PENDING`) · กะมีการนับอีกใบแล้ว = `CONFLICT` (`counted:`) |
| `lines` | array 9 แถว | ✓ | `{denomination, count}` · `denomination` ∈ 1000 500 100 50 20 10 5 2 1 (บาท) ชนิดละหนึ่งแถว · `count` int 0–99999 |
| `counted` | บาท ≥ 0 | ✓ | = Σ `denomination × count` (ไม่ตรง = `INVALID`) |
| `counted_by` | uuid | ✓ | คนที่นับ (D52 Q3b-2) |
| `counted_at` | ISO UTC | ✓ | ≥ `opened_at` ของกะ · = `until` ของช่วงบิลบอท · = เวลาที่กด "นับเสร็จ" ครั้งแรก (แก้จำนวนทีหลังไม่เปลี่ยนค่านี้ — §6.8) · หลังเวลานี้กะไม่รับบิลหรือเงินเข้า-ออกอีก |

**`shift_close`** (มีใบปิดกะในตัว)

| ฟิลด์ใน `data` | ชนิด | บังคับ | กติกา / ที่เก็บ |
|---|---|---|---|
| `shift_id` | uuid | ✓ | → `z_reports.shift_id` · กะต้องมี `cash_count` ในฐานแล้ว (`PARENT_PENDING`) |
| `count_id` | uuid | ✓ | = id การนับของกะนั้น (ไม่ตรง = `INVALID`) |
| `closed_by` | uuid | ✓ | **owner active ณ `closed_at`** ที่กรอก PIN ยืนยันปิดกะ (D52 Q3b-2 · m6) → `shifts.closed_by` |
| `closed_at` | ISO UTC | ✓ | ≥ `counted_at` → `shifts.closed_at` |
| `variance_reason` | string 1–200/null | ✓ | เหตุผลของส่วนต่าง (null ได้) |
| `z_report` | object | ✓ | ตามตารางถัดไป → `z_reports.snapshot` |

| ฟิลด์ใน `z_report` | ชนิด | กติกา |
|---|---|---|
| `z_no` | int ≥ 1 | เลขใบปิดกะของเครื่อง · unique `(api_client_id, z_no)` · **ลำดับและโซ่ (R3-B)** ด้านล่างตาราง |
| `hash` / `prev_hash` | hex ตัวเล็ก 64 ตัว / null ได้เฉพาะ `prev_hash` | `hash` = `zReportHash(snapshot)` ของ Z ใบนี้ในเครื่อง · `prev_hash` = `zReportHash` ของ Z ใบก่อนในเครื่อง (ใบแรกของเครื่อง = null) (Q23) · dayo ไม่คิดแฮชซ้ำ แต่ **ตรวจโซ่** ตามกติกาลำดับด้านล่างตาราง |
| `variance_alert` | บาท ≥ 0 | เกณฑ์ขอเหตุผลที่แท็บเล็ตใช้กับ Z นี้ (`cash.variance_alert_satang` ค่าเริ่มต้น ฿20) → `z_reports.variance_alert` · dayo แจ้ง Discord ตามค่านี้ (D102) |
| `chain_warning` | bool | = `snapshot.chainWarning !== null` ของ Z ในเครื่อง (D53/D54) |
| `cash` | object บาท ≥ 0 ทุกช่อง | องค์ประกอบเงินที่ควรมี: `opening_float` · `pos_cash_sales` · `void_refunds` · `paid_in` · `paid_out` · `drops` · `drawer_expenses` (**ก้อน 3 = 0 เสมอ** · ก้อน 4 ใช้) · `bot_cash` |
| `counted` | บาท ≥ 0 | = `cash_counts.counted` ของกะ (ไม่ตรง = `INVALID`) |
| `bot_window` | `{after, until}` ISO UTC | `until` = `counted_at` (ไม่ตรง = `INVALID`) · `after` < `until` · `after` ตามนิยามของ E4 ข้างล่าง |
| `movement_ids` | uuid[] ≤ 500 | id ของ `cash_movement` **ทุกแถวของกะ** ที่ `created_at` ≤ `counted_at` (รวมแถวที่ยังไม่ส่งหรือถูกปฏิเสธ) — ให้ dayo รู้ว่าแถวใดยังไม่มา |
| `bot_bills` | `[{order_no, version, total}]` ≤ 500 | บิลเงินสดบอท/เว็บที่นับ (จาก E4) · Σ `total` = `cash.bot_cash` (ไม่ตรง = `INVALID`) |
| `pos_bills` | `[{pos_order_id, receipt_no, payment, total, sold_at, voided_at}]` ≤ 2000 | **บิล POS ทุกใบของกะ** (ทุกวิธีชำระ รวมที่ยกเลิก รวมที่ปิดเป็นนอกแคตตาล็อก) · `total` = ยอดที่เก็บจริง · `payment` = **รหัสวิธีชำระของ dayo** ค่าเดียวกับ `payment` ของแถว `order`/`order_off_catalog` ของบิลนั้น (บิล POS มีวิธีชำระเดียวเสมอ) · `receipt_no` = เลขใบเสร็จในเครื่อง ณ ตอนออก Z · `voided_at` null ได้ (แสดงผลเท่านั้น) · **ไม่มีธง `excluded` แล้ว** |

**ลำดับ `z_no` และโซ่ Z (ล็อก — R3-B · แทนกติกาโซ่ของรอบ 2)** — "Z ใบก่อน" = Z ของ key เดียวกันในฐานที่ `z_no` มากที่สุดที่ยังน้อยกว่าใบนี้:
0. **เพดานเลข (R4-M-b)**: `z_no` > (`z_no` สูงสุดของ key ในฐาน + 50) = `rejected INVALID` และแจ้งแบบข้อมูลกะชนกัน (S5) · key ยังไม่มี Z ไม่มีเพดานนี้
1. `z_no` ซ้ำกับ Z อื่นของ key = `rejected CONFLICT` `z_no_taken:` และถือเป็นข้อมูลกะชนกัน (S5: `audit_log` + 🔴 + `shifts.data_conflict`) · **ข้อนี้ตรวจก่อนข้อ 5 เสมอ** (เลขที่ถูกใช้แล้วถูกปฏิเสธ ไม่เข้าเงื่อนไขเติมช่อง)
2. **key ยังไม่มี Z ในฐานเลย ณ ตอนรับ** = Z ใบแรก → ไม่ตรวจโซ่และ `after` (ข้อยกเว้นของ Z ใบแรก)
3. Z ใบก่อนมี `z_no` = ใบนี้ − 1 → `prev_hash` ต้องเท่ากับ `hash` ของใบนั้น (ไม่ตรง = `chain_break`) และ `bot_window.after` ต้องเท่ากับ `until` ของใบนั้น (ไม่ตรง = `mismatch`)
4. Z ใบก่อนมี `z_no` < ใบนี้ − 1 หรือไม่มีใบที่เลขน้อยกว่า (ใบ `z_no − 1` ถูก "ปิดไว้ในเครื่อง" หรือถูกปฏิเสธแล้วยังไม่ส่งใหม่) → **ข้อสังเกต "Z ขาดช่วง / Z ก่อนหน้ายังไม่มี"** ใน `recompute_notes` บนเว็บ · **ไม่ใช่ `chain_break`** · ไม่ตรวจ `prev_hash` · **`after` (R4-M-a)**: เทียบกับ `counted_at` ของ `cash_count` ล่าสุดของ key เดียวกันในฐานที่ก่อน `counted_at` ของใบนี้ (ไม่มี = ข้าม) — เท่ากัน = ผ่าน · ไม่เท่าและช่วงที่ไม่ถูกครอบ (ระหว่างสองค่านั้น) มีบิลเงินสดบอท/เว็บ (คำค้นแบบ E4) = `mismatch` · ไม่เท่าแต่ไม่มีบิลในช่วงนั้น = ข้อสังเกต
5. **`z_no` ≤ `z_no` สูงสุดของ key ในฐาน** (มาทีหลังใบที่เลขสูงกว่า · ผ่านข้อ 1 มาแล้ว): ยอมรับเป็นการ **เติมช่องที่ขาด** เฉพาะเมื่อเลขนั้นยังว่าง **และ** `counted_at` ของใบนี้อยู่ระหว่าง `counted_at` ของ Z ใบก่อน (ถ้ามี) กับ Z ใบถัดไปของ key · ไม่เข้าเงื่อนไข (เล่นซ้ำ/เลขต่ำผิดลำดับเวลา) = `mismatch` + `chain_break`
6. เมื่อรับ `shift_close` แล้ว dayo **คิดซ้ำ Z ที่ `z_no` + 1 ของ key เดียวกันด้วย** (ข้อ 3 อาจใช้ได้แล้ว → ล้างข้อสังเกตข้อ 4 หรือพบ `chain_break`/`mismatch`)

dayo คิดเอง: `expected = opening_float + pos_cash_sales − void_refunds + paid_in − paid_out − drops − drawer_expenses + bot_cash` · `variance = counted − expected` → เก็บใน `z_reports` · แท็บเล็ตคิดสูตรเดียวกันเป็นสตางค์ (`packages/domain/src/shift.ts` **หลังขยายตาม R-m1** · D36) ตัวเลขบนจอจึงเท่ากับของ dayo ทุกสตางค์ · **งานของแผน POS**: ขยาย `CashInputs` / `expectedCashSatang` / `ZInput` ด้วย `botCashSatang` และ `drawerExpensesSatang` (ก้อน 3 = 0) + เทสต์ parity ที่ป้อนองค์ประกอบชุดเดียวกันให้สูตรของแท็บเล็ตกับสูตรของ dayo (fixture ที่ POS เป็นเจ้าของ — D84) แล้วได้ `expected`/`variance` เท่ากันทุกสตางค์ รวมกรณีติดลบ

**`order_off_catalog`** — บิลนอกแคตตาล็อก (D91 · D97)
สร้างบนแท็บเล็ตได้ **เฉพาะ owner (PIN + เหตุผล)** จากหน้า "ส่งไม่ผ่าน" สำหรับแถว `order` ที่ถูก `rejected` (§6.4) · ข้อมูลมาจากบิลในเครื่องที่แช่แข็งแล้ว **ห้ามแก้ยอดเงิน**

| ฟิลด์ใน `data` | ชนิด | บังคับ | กติกา / ที่เก็บ |
|---|---|---|---|
| `pos_order_id` | uuid | ✓ | id เดียวกับบิลเดิม → `orders.pos_order_id` |
| `receipt_no` `queue_no` `sale_date` `sold_at` `channel` `payment` `staff_id` `catalog_version` `shift_id` `note` | | ตามแถว `order` | **กติกาเดียวกับแถว `order`** (§4.5) **ยกเว้นเรื่องวัน** · `channel`/`payment` หารวมที่ปิดใช้ ไม่พบ = `UNKNOWN_CODE` · `staff_id` = ผู้ขาย → `orders.created_by` · **วัน (กันทางตัน — §6.4)**: แท็บเล็ตคิด `sale_date` = วันที่ไทยของ `sold_at` เสมอ (ไม่ใช่วันของกะ) · **ไม่ใช้เพดาน 60 วัน** กับ `sale_date`/`sold_at` ของชนิดนี้ (บิลที่ `order` ถูกปฏิเสธเพราะเก่าเกิน 60 วันหรือวันไม่ตรงปิดได้) · **พื้นล่าง (S1(b) · N1 · R3-C)**: `sold_at` ≥ 00:00 ไทยของ `shop_settings.block3_live_from` ไม่งั้น `rejected FORBIDDEN` `rule:` (`block3_live_from` ยังว่าง = ปฏิเสธด้วยเหตุผลเดียวกัน · **ไม่ใช้ `api_clients.created_at` แล้ว** — ให้เปลี่ยนกุญแจเครื่องได้โดยบิลเก่าไม่ติด) · `sold_at`/`sale_date` ในอนาคตยังเป็น `deferred CLOCK_AHEAD` · เพดาน 60 วันใช้กับ `closed_at` แทน |
| `lines` | array 1–50 | ✓ | ชื่อและราคาตามที่แท็บเล็ตคิดตอนขาย → `orders.off_catalog_lines` (**ไม่สร้าง `order_items`**) |
| `lines[].code` | string ≤ 40/null | ✓ | รหัสเมนูในเครื่อง (อาจไม่มีใน dayo) |
| `lines[].name` | string 1–100 | ✓ | ชื่อที่แสดงบนใบเสร็จ |
| `lines[].size` / `lines[].sweetness` | string ≤ 20 / ≤ 10 · null ได้ | ✓ | |
| `lines[].qty` | int 1–999 | ✓ | |
| `lines[].unit_price` `lines[].discount_per_cup` `lines[].line_total` | บาท ≥ 0 | ✓ | `line_total = (unit_price − discount_per_cup) × qty` |
| `totals` | object | ✓ | `items_subtotal` `items_discount` `bill_discount` `total` (บาท) · ต้องได้ `items_subtotal = Σ unit_price × qty` · `items_discount = Σ discount_per_cup × qty` · `total = max(0, items_subtotal − items_discount − bill_discount)` (สูตรเดียวกับ `packages/shared/src/money.ts:284-291`) · `items_discount + bill_discount ≤ items_subtotal` (check `orders_discount_le_subtotal` — `0003_sales.sql:139`) · ไม่ตรง = `INVALID` |
| `closed_by` | uuid | ✓ | **owner active ณ `closed_at`** ที่ปิดด้วย PIN (ไม่ใช่ = `FORBIDDEN` `role:`) |
| `closed_at` | ISO UTC | ✓ | ≥ `sold_at` · กติกา `CLOCK_AHEAD` |
| `reason` | string 1–200 | ✓ | เหตุผลของ owner |
| `original_reason` | `^[A-Z_]{1,40}$` | ✓ | เหตุผลที่แถว `order` เดิมถูกปฏิเสธ (บันทึกไว้ดูเท่านั้น) |

กติกาฝั่ง dayo ของ `order_off_catalog` (ล็อก)
0. กันซ้ำตามลำดับ §4.5 ข้อ 0: (1) hash ของ key (ต่าง = `CONFLICT` `key_changed:`) (2) **หาบิลด้วย `(shop_id, pos_order_id)` ข้ามทุก key ของร้าน (R4-2)**: เป็นบิลนอกแคตตาล็อก**ของ key นี้** = `duplicate` · **บิลนอกแคตตาล็อกของ key อื่น = `rejected CONFLICT` `off_catalog_exists:<order_no>` ไม่ใช่ `duplicate`** · **เป็นบิลปกติ (key ใดก็ได้) = `rejected CONFLICT` `exists:<order_no>`** พร้อม `data` (บิลอยู่ในฐานแล้ว ห้ามนับรายได้ซ้ำหลังเปลี่ยนกุญแจเครื่อง) (3) `external_ref` ชน `pos_order_id` อื่น = `CONFLICT` `receipt_taken:` (4) **ตรวจเงื่อนไขปิด (S1 — ฝั่งเซิร์ฟเวอร์)** ไม่ผ่านข้อใด = `rejected FORBIDDEN` `rule:`: (ก) มีแถวใน `pos_push_rejections` ของ `pos_order_id` นี้ **ในร้านเดียวกัน จาก key POS ใดก็ได้ของร้าน** (หาด้วย `(shop_id, pos_order_id)` — เปลี่ยนกุญแจเครื่องตาม §7 ข้อ 3 แล้วบิลไม่ติด) และ `original_reason` เป็น **เหตุผลใดก็ได้ที่เคยบันทึกไว้** — **ข้อนี้แค่ผูกบิลกับแถว `order` ที่ถูกส่งมาจริง ไม่ใช่ด่านกัน key ที่หลุด** (คนถือ key ส่งแถว `order` ที่ตั้งใจให้ถูกปฏิเสธก่อนได้) · **ด่านจริง** คือ (ข) พื้นล่าง (ค) เพดานต่อบิล และการแจ้ง Discord ทุกใบ (ข) พื้นล่างของ `sold_at` ตามตารางข้างบน (ค) `totals.total` ≤ `shop_settings.off_catalog_max_total` (ค่าเริ่มต้น ฿3,000 — **รอเจ้าของ Q72**) (5) สร้าง · ปุ่มบนแท็บเล็ตต่อคำนำหน้าอยู่ใน §6.4
1. แทรก `orders` 1 แถว: `source='pos'` · `off_catalog=true` · ยอดจาก `totals` · `pos_reported_amounts` = `totals` + `payment` · `pos_computed_total = null` (dayo คิดราคาเองไม่ได้) · `amount_mismatch=false` · `promo_discount_total=0` · **`cost_total = null`** · `channel_fee_pct` จากช่องทาง ณ ตอนรับ และ `channel_fee_amount = round(total × channel_fee_pct, 2)` · `items_signature = null` (ไม่ตรวจธงซ้ำ) · **ไม่มี `order_items`/`order_promotions` · ไม่ตัดสต็อก** · `audit_log` action `order_off_catalog` (after = `closed_by` `closed_at` `reason` `original_reason`) · **ทุกบิลที่ `accepted`: แจ้ง 🟡 Discord "มีบิลนอกแคตตาล็อกใหม่ N ใบ — ดูที่เว็บ" (ไม่มียอดเงิน — S7) + ป้ายนับบนแดชบอร์ด owner** (S1(d))
2. แถว `order` ที่ `pos_order_id` เป็นบิลนอกแคตตาล็อกแล้ว = `rejected CONFLICT` `off_catalog_exists:<order_no>` (§4.5 ข้อ 0)
3. `order_void` ของบิลนอกแคตตาล็อกทำงานแบบบิลปกติ (กติกาวันเดียวกัน) · `cancel_order` ต้องรองรับบิลที่ไม่มี `order_items`
4. **รายงาน** (ทุกที่ที่คิดยอด: แดชบอร์ด · สรุปประจำวัน ADR-0044 · Export · หน้าดูกำไร ADR-0055 · กำไรสุทธิก้อน 4):
   - **ยอดขายและจำนวนบิลรวมบิลนอกแคตตาล็อก** ตามวันขายเหมือนบิลอื่น
   - **ต้นทุนและกำไรขั้นต้นไม่รวมบิลนอกแคตตาล็อก** (ไม่นับทั้งยอด ค่าธรรมเนียม และต้นทุนของบิลนั้น) · แสดงบรรทัดแยก **"บิลไม่รู้ต้นทุน N ใบ · ยอด ฿X"** ให้ตัวเลขบวกลบได้ตรง: ยอดขาย − ยอดบิลไม่รู้ต้นทุน − ค่าธรรมเนียม (ของบิลที่รู้ต้นทุน) − ต้นทุน = กำไรขั้นต้น · **ห้ามถือต้นทุนเป็น 0** (GP สูงเกินจริง — ADR-0056 คำถามข้อ 2)
   - อันดับเมนูไม่รวม (ไม่มีรายการเมนู) · หน้าบิลบนเว็บแสดงป้าย "บิลนอกแคตตาล็อก" + รายการจาก `off_catalog_lines` + ผู้ปิด/เหตุผล
   - **GP%** = กำไรขั้นต้น ÷ (ยอดขาย − ยอดบิลไม่รู้ต้นทุน) · ตัวหารเป็น 0 = แสดง "—"
   - **จำนวนแก้ว** รวม Σ `qty` ของ `off_catalog_lines` (แก้วที่ขายจริง) · ไม่เข้าอันดับเมนู
   - `get_order` ของบิลนี้: `gross_profit` = null · หน้า `OrderDetailClient` แสดงต้นทุนและกำไรเป็น "ไม่ทราบ (บิลนอกแคตตาล็อก)" ไม่ใช่ ฿0
   - E3 (`GET /v1/orders`) เพิ่มฟิลด์ `off_catalog` (bool) ต่อบิล — แท็บเล็ตใช้ยืนยันว่าบิลของตัวเองเข้าฐานเป็นบิลนอกแคตตาล็อก (schema ฝั่งแท็บเล็ตรับฟิลด์ที่ไม่รู้จักอยู่แล้ว)

**E4 — `GET /v1/pos/shift-cash?after=<ISO>&until=<ISO>`** (scope `orders:read` · ล็อก — คงเดิม): บิล `status='ok'`, วิธีชำระ `cash`, `source in ('line','web')` ที่ `created_at` อยู่ในช่วง **`(after, until]`** → `{bills:[{order_no, version, source, sold_at, total, created_by_name}], cash_total}` (บาท → แท็บเล็ตแปลงด้วย `edgeBahtToSatang`) · ไม่มีต้นทุน · `created_by_name` = null เมื่อ key ไม่มี `staff:read` (แบบ E3) · **บิลบอทแต่ละใบถูกนับได้ครั้งเดียว**: `until` = `counted_at` ของการนับครั้งนี้ · `after` = **`counted_at` ของการนับครั้งก่อนในเครื่อง** (แท็บเล็ตรู้แค่ของตัวเอง — รวมการนับของกะ `local_only`) · ไม่มีการนับก่อนหน้าเลย = 00:00 เวลาไทยของ `business_date` ของกะนี้ · ช่วงเก็บใน `z_report.bot_window` · แท็บเล็ตเรียกตอนออก Z (Q15) · **dayo ตรวจช่วง (S2 — แทนกติการอบ 1)**: `until = counted_at` (ไม่ตรง = `INVALID` ตอนรับ) · **`after` ต้องเท่ากับ `until` ของ Z ใบก่อนเมื่อใบนั้นมี `z_no` = ใบนี้ − 1** ไม่ตรง = `mismatch` (ช่องว่างหรือทับกันระหว่าง Z ติดกันของ key เดียวกัน) · Z ใบก่อนขาดช่วงหรือยังไม่มี = เทียบกับการนับล่าสุดของ key แทน (กติกาลำดับ `z_no` ข้อ 4 — R4-M-a) · Z ใบแรกของ key ยกเว้น (R3-B) · บิลบอทที่ไม่อยู่ใน Z ใดเลย (เช่นก่อน Z ใบแรก หรือของ key อื่น) หรือเปลี่ยน/ยกเลิกหลังถูกนับ (เทียบ `version`) → รายการ "บิลบอทนอกใบปิดกะ" / "เปลี่ยนหลังนับ" (Z ไม่เปลี่ยน) · บิลบอทที่เปลี่ยนจากเงินสดเป็นอย่างอื่นหรือถูกยกเลิก **ก่อน** นับ → รายการ "เปลี่ยนจากเงินสดก่อนนับ" (อ่านจาก `audit_log` — m7)

**เงินสดที่ควรมี (ล็อก)** = เงินทอนตั้งต้น + ยอดเงินสดของ **บิล POS ทุกใบใน `pos_bills` ที่ `sold_at` ≤ `counted_at` รวมใบที่ยกเลิกภายหลัง** (ยอดที่เก็บจริง + วิธีชำระตอนขาย — D93) − Σ `VOID_REFUND` + Σ `PAID_IN` − Σ `PAID_OUT` − Σ `DROP` − ค่าใช้จ่ายจ่ายจากลิ้นชักของกะ (ก้อน 4) + Σ `bot_bills` · แถวเงินสด/ค่าใช้จ่ายนับเฉพาะที่เวลาเครื่อง (`created_at`) ≤ `counted_at` · ตรงกับ `packages/domain/src/shift.ts` **หลังขยายตาม R-m1** (D36: ยอดขายรวมบิลที่ยกเลิก แล้วหักเงินคืนแยก) · บิลนอกแคตตาล็อกนับเหมือนบิลอื่น (อยู่ใน `pos_bills` · **ห้ามบันทึก `PAID_IN`/`PAID_OUT` เพื่อ "ชดเชย"** บิลที่ปิดเป็นนอกแคตตาล็อก)

**การคิดใบปิดกะซ้ำของ dayo (ล็อก · ตรวจจริง ไม่เชื่อ snapshot — S2/S3)** — ใช้รายการ id ใน snapshot กับแถวในฐาน (หาด้วย `(shop_id, api_client_id, id)` เสมอ — S4) และเวลาจากเครื่อง (**ห้ามใช้ `orders.created_at`**) · **ความล้มเหลวของการตรวจใดก็ตาม = `mismatch`** (บันทึกใน `recompute_detail`):
**ลำดับ (R3-A)**: **การตรวจรายแถว (ข้อ 2 · ข้อ 3 · ชุดบิลบอทและ `bot_window` ในข้อ 4 · กติกาโซ่ Z) ทำเสมอ** กับแถวที่มีอยู่แล้ว · **การเทียบผลรวมกับ `z_report.cash` (ส่วนผลรวมของข้อ 4 และข้อ 5) ทำเฉพาะเมื่อไม่มีอะไรขาด** · สรุปผล: พบต่าง = `mismatch` (แม้ยังมีแถวขาด) → ไม่พบต่างแต่มีแถวขาด = `waiting_bills` → ไม่ขาดและผลรวมตรง = `matched`
1. หาบิลทุกใบใน `pos_bills` ด้วย `(api_client_id, pos_order_id)` (รวมบิลนอกแคตตาล็อก) และเงินเข้า-ออกทุกแถวใน `movement_ids` · แถวที่ยังไม่มา → `missing_pos_order_ids` / `missing_movement_ids` · `VOID_REFUND` ที่รอ `order_void` → `missing_void_order_ids` (ข้อ 3) · มีช่อง `missing_*` ใดไม่ว่าง = "ขาด" (+ `waiting_since`) · แถวเงินที่ถูกปฏิเสธจึงทำให้ "รอ" ไม่ใช่ "ไม่ตรง" (§6.4) · id ปลอมที่ไม่มีวันมาค้างได้แค่ "รอ" ซึ่งเว็บแสดงอายุและเหตุผลการรอเสมอ (เช่น "เงินคืนของบิลที่ยังไม่ถูกยกเลิก A-000312 · 3 ชม." — นับรวมในการแจ้งที่รอ Q74)
2. ต่อบิล: ต้องมี `pos_shift_id` = กะนี้ (ไม่ใช่ = ต่าง) · ยอด = `pos_reported_amounts.total` · วิธีชำระ = `pos_reported_amounts.payment` (บิลที่ไม่มีคีย์นี้ = บิลก่อน migration → ใช้วิธีชำระปัจจุบัน) · `sold_at` = `orders.sold_at` · **ยอดและ `sold_at` ต่างจาก snapshot = ต่าง** · **วิธีชำระเทียบแค่ "เงินสด (`cash`) หรือไม่ใช่เงินสด"** — รหัสต่างกันแต่ฝั่งเดียวกัน (เช่นหลัง `CODE_REMAPPED` ของวิธีที่ไม่ใช่เงินสด) ไม่ต่าง · **`receipt_no` ≠ `external_ref`** (เช่นหลัง `RECEIPT_RENUMBERED` ที่เกิดหลังออก Z) **บันทึกใน `recompute_detail` อย่างเดียว ไม่ทำให้ต่าง** · **ไม่ดู** `total_amount` ปัจจุบัน สถานะยกเลิก หรือวิธีชำระหลังแก้บนเว็บ (D93)
3. บิลในฐานที่ `pos_shift_id` = กะนี้ แต่ไม่อยู่ใน `pos_bills` = ต่าง · เงินเข้า-ออกในฐานของกะนี้ (`created_at` ≤ `counted_at`) ที่ไม่อยู่ใน `movement_ids` = ต่าง · **ทุกแถวใน `movement_ids` ต้องมี `shift_id` = กะนี้ `api_client_id` เดียวกัน และ `created_at` ≤ `counted_at`** · **`VOID_REFUND`** (R3-m9): `pos_order_id` ต้องเป็นบิลของ key นี้ — **เป็นบิลของ key อื่น (อุปกรณ์อื่นหรือร้านอื่น) = ต่างทันที** · บิลนั้นอยู่ใน `pos_bills` ของ Z นี้โดย `voided_at` เป็น null = **ต่างทันที** · บิลยังไม่มา หรือยัง `ok` เพราะ `order_void` ยังไม่มา = **รอ** (`missing_void_order_ids`) · **Σ `VOID_REFUND` ต่อบิล (ทุกกะ) ≤ `pos_reported_amounts.total` ของบิลนั้น**
4. **บิลบอท (ตรวจรายแถว · S2)**: dayo รันคำค้นเดียวกับ E4 ช่วง `bot_window` เอง → ชุด `order_no` ต้องเท่ากับ `bot_bills` · ความต่างของบิลที่มีการแก้ใน `audit_log` หลัง `counted_at` (เวลาเซิร์ฟเวอร์ · ยอมคลาด 5 นาทีตาม D80) = **ข้อสังเกต "เปลี่ยนหลังนับ"** ไม่ใช่ต่าง · **บิลที่ไม่มีการแก้หลัง `counted_at` ต้องมี `total` ใน snapshot = `total_amount` ปัจจุบัน ไม่งั้นต่าง** (R3-m2) · `order_no` แต่ละใบต้องไม่อยู่ใน Z อื่น · `bot_window.after` ตามกติกาลำดับ `z_no` · **ผลรวม (ทำเมื่อไม่ขาด)**: `opening_float` จาก `shifts` · `pos_cash_sales` จากข้อ 2 (เงินสด · `sold_at` ≤ `counted_at`) · `void_refunds` `paid_in` `paid_out` `drops` จากแถวใน `movement_ids` · `drawer_expenses` = 0 (ก้อน 3) · `bot_cash` = Σ `bot_bills.total` (ยอด ณ ตอนนับ)
5. (ทำเมื่อไม่ขาด) ทุกองค์ประกอบเท่ากับ `z_report.cash` และข้อ 2–4 ไม่ต่าง → `matched` · ไม่งั้น → `mismatch` (`z_mismatch = true`) บันทึกตามที่แท็บเล็ตส่ง (แบบ `amount_mismatch` — ADR-0035 ข้อ 3)
6. คิดซ้ำเมื่อรับ `shift_close` (**และคิดซ้ำ Z ที่ `z_no` + 1 ของ key เดียวกันด้วย** — R3-B) และทุกครั้งที่แถว `order` · `order_off_catalog` · `order_void` · `cash_movement` ที่เกี่ยวกับกะที่มี Z แล้วถูก `accepted` · **และเมื่อ owner ยกเลิกบิล POS ที่อยู่ใน `missing_void_order_ids` บนเว็บ** (ในธุรกรรมของการกระทำนั้น) · แถวมาครบทีหลัง → เปลี่ยนจาก `waiting_bills` เป็น `matched`/`mismatch` เองโดยแท็บเล็ตไม่ต้องส่งอะไรเพิ่ม
7. **กติกาฝั่งแท็บเล็ตที่ทำให้ข้อ 2 ใช้ได้**: `CODE_REMAPPED` ของวิธีชำระ **ห้ามสลับเงินสด ↔ ไม่ใช่เงินสด** (ตัวเลือกแทนมีแค่รหัสฝั่งเดียวกับรหัสเดิม) · แท็บเล็ตไม่แก้ Z ที่ออกแล้วเมื่อมี `RECEIPT_RENUMBERED`/`CODE_REMAPPED` ภายหลัง

**บรรทัด "เจ้าของแก้บิลหลังขาย" (D93)**: บิลใน `pos_bills` ที่ปัจจุบัน `total_amount` / สถานะ / วิธีชำระ ต่างจาก `pos_reported_amounts` (เพราะ owner แก้/ยกเลิกบนเว็บ — D85) · เว็บ dayo แสดงแยกจาก Z: ต่อบิล "ใบเสร็จ A-000312 · เก็บจริง ฿100 เงินสด → ปัจจุบัน ฿80 (แก้โดย … เหตุผล …)" + ผลรวมส่วนต่างของบิลเงินสด · คิดตอนแสดง (ไม่เก็บใน Z) · ไม่เปลี่ยน `recompute_status`

**แจ้งเตือน Discord `#dayo-ระบบ` (D98 · D102 · ADR-0044)** — **ข้อความไม่มียอดเงิน** (S7 · ค่าเริ่มต้น **รอเจ้าของยืนยัน Q73**) ไม่มีชื่อพนักงาน เหตุผลอิสระ หรือ id นอกจากลิงก์หน้ากะ · ระดับของข้อความ: P3 คำถาม ค3:
- รับ `shift_close` แล้ว **|variance| ≥ `z_report.variance_alert`** (กติกาเดียวกับที่แท็บเล็ตขอเหตุผล — D102 · ค่าเริ่มต้น ฿20) → "กะ 25 ก.ย. เงินไม่ตรงเกินเกณฑ์ — ดูที่ /shifts/<id>" ครั้งเดียวต่อ Z (ส่งซ้ำ `duplicate` ไม่แจ้งซ้ำ) · **แผน POS เปลี่ยน `varianceNeedsReason` จาก `>` เป็น `≥`** (D102)
- `recompute_status` **เปลี่ยนเข้า** `mismatch` → "กะ <วันที่> ใบปิดกะไม่ตรงกับระบบกลาง — ดูที่ /shifts/<id>" ครั้งเดียวต่อการเปลี่ยน
- ข้อมูลกะชนกัน (S5) → 🔴 "ข้อมูลกะชนกัน — ตรวจกุญแจเครื่อง" · บิลนอกแคตตาล็อกที่รับ (S1(d)) → 🟡 นับใบ · key ถูกปฏิเสธ `scope:` → 🟡 วันละครั้งต่อ key (m1) · "กะซ้อนกัน" และ key มีกะ > 3 กะต่อวัน → 🟡 (m4)
- **`waiting_bills` ไม่แจ้ง** (D98) · เว็บแสดงอายุการรอทุกกะ · ข้อเสนอของผู้ตรวจความปลอดภัย (S3) ให้แจ้ง 🟡 ครั้งเดียวเมื่อรอเกิน 48 ชม. **ขัดกับ D98 — ยังไม่ทำ รอเจ้าของ Q74**

**เว็บ dayo (Q20 · D99)** — **สิทธิ์ (S6)**: RPC `dashboard_shifts` และ RPC หน้ารายละเอียดกะรับ `p_staff_id` และ raise `DY403` ถ้าไม่ใช่ role owner · `today_mini` คืนแค่สถานะกะ เปิด/ปิด · **ไม่มี API ใด (E3 E4 หรืออื่น) คืน `z_reports` หรือส่วนต่าง** · Export ที่มีข้อมูลกะได้เฉพาะ owner · แดชบอร์ด owner 1 บรรทัดต่อกะ "กะ 25 ก.ย. · เปิด 09:02 TungAo · ปิด 20:41 · ขาด ฿20" + ป้าย "ไม่ตรง" (`mismatch`) / "รอบิล N ชม." (`waiting_bills` + อายุ) / "โซ่ Z ขาด" (`chain_break`) / "Z ขาดช่วง" (`recompute_notes`) / "ข้อมูลชนกัน" (`shifts.data_conflict`) + "เจ้าของแก้ N บิล" + ป้ายนับบิลนอกแคตตาล็อก · หน้ารายละเอียดกะแสดง **เกณฑ์ขอเหตุผลที่ใช้ (`variance_alert`)** และติดป้ายเมื่อเกณฑ์ต่างจาก Z ใบก่อนของ key เดียวกัน (R3-m8 — ค่าตั้งถูกเปลี่ยน) · เหตุผลการรอแต่ละรายการพร้อมอายุ · **กดเข้าไปดูหน้ารายละเอียดกะ (owner เท่านั้น อ่านอย่างเดียว)**: ธนบัตรแต่ละชนิด · เงินเข้า-ออกทุกรายการ · องค์ประกอบเงินที่ควรมี · บิลบอทที่ถูกนับ · บิล POS ของกะ · ส่วนต่าง + เหตุผล · สถานะคิดซ้ำ + บิลที่ยังไม่มา + `recompute_detail` · บรรทัด "เจ้าของแก้บิลหลังขาย" · manager/staff เห็นใน `today_mini` เฉพาะสถานะกะ (เปิด/ปิด) ไม่เห็นยอดขาด/เกิน · รายการเสริม: "บิลบอทนอกใบปิดกะ" / "เปลี่ยนหลังนับ" / "เปลี่ยนจากเงินสดก่อนนับ" (จาก `audit_log` — m7) (นับเฉพาะ `sale_date` ≥ `block3_live_from`) · "บิลที่ `pos_shift_id` ยังไม่มีกะ" · "กะซ้อนกัน" (กะของ key เดียวกันที่ช่วง `[opened_at, counted_at]` ทับกัน — C3)

**ลำดับ ช่อง และแถวแม่ (ล็อก — ADR-0056 คำถามข้อ 3)**:
- แท็บเล็ตมี **ช่องกะหนึ่งช่องต่อเครื่อง**: แถว `shift_open` `cash_movement` `cash_count` `shift_close` ของทุกกะ (ก้อน 4 เพิ่มค่าใช้จ่ายจากลิ้นชักและ `expense_void` ของรายการลิ้นชัก) เรียงตาม `createdAt` ในเครื่อง · แถวใดได้ `deferred` → แถวหลังจากนั้นในช่องกะหยุดรอจนแถวนั้นผ่าน (**แทน "ช่องต่อกะ" เดิม** — §13.8 C3)
- **ช่องบิล** (`order` `order_void` `order_off_catalog`) แยกจากช่องกะ — บิลไม่รอกะ ไม่รอ Z (ผูกทีหลังได้)
- แถวแม่ในเครื่อง: `shift_open` → แถวอื่นของกะนั้น · `cash_count` → `shift_close` ของกะนั้น · `order`/`order_off_catalog` → `order_void` ของบิลนั้น · แถวแม่ `rejected` → แถวลูกไป "ส่งไม่ผ่าน" ด้วย `PARENT_REJECTED` ทันที (ไม่ส่ง) · **เมื่อแถวแม่ที่แก้แล้วได้ `accepted`/`duplicate` แถวลูก `PARENT_REJECTED` ทุกแถวกลับเป็น `pending` เอง** (ไม่ต้องกดทีละแถว · คงลำดับเดิมในช่อง) · แถวแม่ถูกปิด (`closed_off_catalog` → แถวแม่ใหม่คือ `order_off_catalog` · `local_only` → แถวลูกเป็น `local_only` ด้วย) · แถวอื่นในช่องกะเดินต่อ
- `shift_close` เกิดในเครื่องเมื่อออก Z ได้ (ออนไลน์ + ได้บิลบอท — D68) จึงอาจอยู่หลัง `shift_open` ของกะถัดไปในช่องกะ — ถูกต้อง เพราะ dayo ตัดสินด้วยเวลาในแถว (`opened_at`/`created_at`/`counted_at`/`closed_at`) ไม่ใช่สถานะ ณ ตอนแถวมาถึง

**ผูกทีหลัง** (ล็อก — คงเดิม): บิล/ค่าใช้จ่ายที่อ้าง `shift_id` ที่ยังไม่มีในฐาน **บันทึกได้ทันที** (ไม่มี FK) · Z ที่มาถึงก่อนบิลของกะ = `waiting_bills` จนบิลครบ · แถวของกะเอง (`cash_movement` `cash_count` `shift_close`) รอกะด้วย `deferred PARENT_PENDING` · กะที่ถูกปฏิเสธขึ้นหน้า "ส่งไม่ผ่าน" พร้อมแถวลูก (§6.4) · บิลของกะนั้นยังบันทึกได้

**ก้อน 4 — ค่าใช้จ่าย + กำไรสุทธิ** (P4 · scope `expense:write`)

> ระดับร่าง — **ล็อกตอนเริ่มก้อน 4** (D90) · ส่วนดูกำไรแก้ตาม **ADR-0055 · D87 แล้ว** (แทน D79 และกลไกรหัส 6 หลักบนแท็บเล็ตเดิมทั้งหมด) · ADR-0057 (ค่าใช้จ่าย) ยังเลื่อน มีคำถามเปิดว่าเว็บบันทึกค่าใช้จ่ายได้ด้วยหรือไม่ (อาจเปลี่ยน Q46/D70)

- `expense_categories` (แก้บนเว็บ owner · มากับ E1 เป็น `expense_categories: [{id, name, counts_in_profit, active}]` **ระดับเดียวกับ `staff`**): `counts_in_profit = false` สำหรับ "ซื้อวัตถุดิบเข้าสต็อก" (ต้นทุนนับผ่านต้นทุนขายแล้ว — กันนับซ้ำ)
- `expenses`: `spent_on date`, `category_id`, `description`, `amount > 0`, `paid_from` `drawer`/`bank`, `shift_id` (บังคับเมื่อ `drawer`), `pay_sheet_id` (ก้อน 6), `created_by`, `voided_at/voided_by/void_reason` (ตั้งครั้งเดียว)
- ชนิด push: `expense` · `expense_void` (จ่ายจากลิ้นชักยกเลิกได้เมื่อ `voided_at` ≤ `counted_at` ของการนับเงินของกะนั้น หรือกะยังไม่ถูกนับ — ตัดสินด้วยเวลาในแถว · จากธนาคารยกเลิกได้เสมอ)
- กำไรสุทธิ (RPC `dashboard_net_profit`) = กำไรขั้นต้นตามกติกาก้อน 3 (Σ บิล ok ทุกแหล่ง **ที่รู้ต้นทุน**: `total_amount` − `channel_fee_amount` − `cost_total`) − Σ ค่าใช้จ่ายที่ไม่ถูกยกเลิกและ `counts_in_profit` (ตาม `spent_on`) · แสดงบรรทัด "บิลไม่รู้ต้นทุน N ใบ · ยอด ฿X" แยก (บิลนอกแคตตาล็อก — D97) · แสดงบนแดชบอร์ดเว็บ (owner) · จะแสดงบนหน้าดูกำไรของ ADR-0055 ด้วยหรือไม่ ตัดสินพร้อม ADR-0057
- **ดูกำไรจากแท็บเล็ต (ADR-0055 · D87 — ระดับร่าง ล็อกตอนเริ่มก้อน 4)**: dayo ship แล้ว (`0053_profit_view.sql`) · ปุ่ม "ดูกำไร" บนแท็บเล็ต (แสดงเฉพาะผู้ล็อกอินที่เป็น owner — ความสะดวก ไม่ใช่ด่านความปลอดภัย) → `POST /v1/pos/profit-view` (scope `reports:profit` ที่ owner เปิดเองต่อ key) → `{request_id, url, method, expires_at}` → แท็บเล็ตเปิด `url` ในเบราว์เซอร์ → หน้าเว็บ dayo ยืนยันด้วย **OTP ทาง LINE** หรือ **รหัส 6 หลักที่ owner ตั้ง** → session ดูกำไร 15 นาที แบบอ่านอย่างเดียว (ยอดขาย · ต้นทุน · กำไรขั้นต้น · วันนี้/เมื่อวาน/7 วัน · แยกแหล่ง · เมนูอันดับ — ADR-0055 ข้อ 8–10)
  - **API ไม่ส่งตัวเลขกำไร/ต้นทุนเลย** (ADR-0040 ข้อ 3 คงเดิม · ไม่มีข้อยกเว้น) · แท็บเล็ตไม่เก็บ token/ตัวเลขใด ๆ เกี่ยวกับกำไร · ออฟไลน์ = "ต้องออนไลน์เพื่อดูกำไร" · `DY429` (เกินเพดานคำขอ) = ข้อความให้ลองใหม่ภายหลัง
  - **ยกเลิกแล้ว** (ไม่ทำ): รหัส 6 หลักจากหน้า `/settings/api-clients` · `POST /v1/pos/profit-session` · `POST /v1/pos/profit` · ตาราง `profit_unlock_codes`/`profit_sessions` · `session_token` ในหน่วยความจำแท็บเล็ต (แทนด้วยตาราง/RPC ของ `0053_profit_view.sql`)
  - หน้าดูกำไรต้องแสดงบรรทัด "บิลไม่รู้ต้นทุน" ตามกติกาก้อน 3 (บิลนอกแคตตาล็อก — D97) — เป็นงาน dayo ในก้อน 3
  - ต้องล็อกตอนเริ่มก้อน 4: วิธีเปิด `url` จาก PWA (แท็บใหม่/หน้าต่างภายนอก) · ข้อความของ 401/403/429 · e2e ของปุ่ม

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
2. ตัวอย่าง JSON ในเอกสารนี้ (คำขอ + คำตอบ ต่อสถานการณ์: ใหม่ ซ้ำ ชนใบเสร็จ key เดิมเนื้อหาต่าง ยกเลิกข้ามวัน ยกเลิกนาฬิกาเร็ว รหัสไม่รู้จัก ชนิดไม่รู้จัก error ไม่คาดคิดของแถว ฉบับไม่เปลี่ยน · 401/404/429 พร้อมหัว CORS) เป็นไฟล์ fixture สัญญา · **เจ้าของไฟล์ตอนนี้ = POS** (คำวินิจฉัยของผู้คุมงาน O4 · 26 ก.ย. 2569) เพราะ dayo ship ก้อน 1A โดยไม่มีชุด fixture (ไม่มี `apps/web/test/fixtures/pos-contract/` ใน repo dayo) และแท็บเล็ตรอไม่ได้:
   - ต้นฉบับอยู่ที่ POS `packages/contracts/fixtures/dayo-api/*.json` (+ `.gitattributes` `*.json text eol=lf`) · **สร้างจาก SQL ของ dayo `main`** (ไม่ใช่จาก `docs/API.md` ของ dayo) และเมื่อเชื่อมจริงได้ ให้แทนด้วย **คำตอบจริงของ `dayo-test`/Supabase local** · ห้ามแก้เนื้อหาเพื่อให้เทสต์ POS ผ่าน — ต่างจากคำตอบจริง = แก้ fixture ให้ตรงของจริงแล้วแก้โค้ด
   - เทสต์ POS: ทุกไฟล์ผ่าน schema และ mock server เล่นซ้ำได้ครบ · sha256 หลังแปลง CRLF→LF (`fixtures:hashes`) ใช้เทียบเมื่อมีสำเนาอีกฝั่ง
   - ส่งชุดนี้ให้ dayo รับไปเป็นเทสต์ Route Handler ของตัวเองในก้อน 1B · **เมื่อ dayo มีชุดของตัวเองแล้ว** ค่อยตัดสินใหม่ว่าใครเป็นเจ้าของ (dayo ไม่ import แพ็กเกจ POS)
   - **D82** (dayo เป็นเจ้าของ fixture) **ถูกแทนด้วย D84** · ส่วนที่อ้าง D82 ในแผนก้อน 1–2 ให้อ่านตามข้อนี้ · ก้อน 3 เพิ่ม fixture ของชนิดใหม่ทุกชนิดและ E4 (POS เป็นเจ้าของตาม D84)
3. ก้อน 2 ใช้ **mock server** ที่สร้างจาก schema + fixture (`apps/pos` dev/test) จนก้อน 1 เสร็จ แล้วทดสอบเชื่อมจริงกับ Supabase local + `npm run dev:web` ของ dayo (`API_V1_ENABLED=1` เฉพาะเครื่อง dev) ก่อนเปิดใน production

---

## 5. เงินและราคา

### 5.1 แท็บเล็ตใช้ตัวคิดราคาของ dayo (Q8)

- **สำเนาโค้ดที่ปักรุ่น** (Q48): คัดลอก `packages/shared/src/{money,promotions,cost,fmt,shopSettings,types,time}.ts` (`time.ts` เพราะไฟล์อื่น import — ชุดเดียวกับที่ E1 รายงานใน `files_sha256`) · ไม่รวม `xlsx` ไปไว้ที่ POS `packages/dayo-pricing/src/vendor/` ไม่แก้แม้แต่บรรทัดเดียว · `packages/dayo-pricing/VENDOR.json` = `{ "repo": "dayo-shop-system", "commit": "<sha>", "files": { "<path>": "<sha256>" } }`
- สคริปต์ `pnpm --filter @dayo/dayo-pricing vendor:check` เทียบ sha256 ของไฟล์ในโฟลเดอร์กับ `VENDOR.json` (รันในเทสต์เสมอ) · `vendor:update <path-to-dayo>` คัดลอกใหม่ + อัปเดต `VENDOR.json` (ทำโดยคนเมื่อ dayo เปลี่ยนตัวคิดราคา)
- ตัวห่อ `@dayo/domain` → `priceCart(cart, catalog, now)` เรียก `computeOrder` แล้วแปลงด้วย `edgeBahtToSatang` (§4.2) **เฉพาะฟิลด์เงินเหล่านี้**: `itemsSubtotal` `itemsDiscount` `billDiscountAmount` `totalAmount` `channelFeeAmount` · `lines[].unitPrice` `lines[].discountPerCup` `lines[].lineTotal` · `promotionsApplied[].discountAmount` · **ไม่แปลง** `costTotal` `grossProfit` `gpPercent` `lines[].unitCost` (ต้นทุนเป็น 0 ในแท็บเล็ต · `gpPercent` ไม่ใช่เงิน) · `packages/domain/src/pricing.ts` เดิมของ POS เลิกใช้ (§11)
- **คิดราคาใหม่ ณ วินาทีชำระ**: ตอนกดชำระ แท็บเล็ตเรียก `priceCart(cart, catalog, sold_at)` ด้วย `sold_at` ตัวเดียวกับที่จะส่ง (`sale_time` ตัดวินาทีตาม §4.5) · ผลต่างจากยอดที่ลูกค้าเห็น → กลไก `PRICE_CHANGED` (D50 Q3-27) · `totals` ของ E2 = ผลของการคิดครั้งนี้เท่านั้น
- **ขนาดและเวลาโปร (ADR-0054 · §4.4 ข้อ 12–13)**: `size` ในตะกร้าเป็น `string` ตาม `Size` ของตัวที่คัดลอก · `priceCart` ส่ง `catalog.sizes` ต่อให้ `OrderCatalog` ตรงตัว · `timeFrom`/`timeTo` ส่งผ่านตรงตัว (ไม่ตัดวินาที) · ตัวตรวจตะกร้าก่อนเก็บเงินปฏิเสธบรรทัดที่ขนาดไม่อยู่ใน `sizes` ที่ active หรือไม่มีตัวแปร
- ร่างที่ส่งเข้า `computeOrder` ใช้ค่าที่ตีความแล้วเสมอ (`milk`, `grade` ไม่เป็น null ตาม §4.5) · `no_promotions` = ส่ง `skipPromotionIds` เป็น id โปรทุกตัว
- ชื่อแพ็กเกจ: dayo ใช้ `@dayo/shared` · POS ใช้ scope `@dayo/*` เหมือนกัน → ห้ามตั้งชื่อ POS ว่า `@dayo/shared` (สำเนาอยู่ใต้ `@dayo/dayo-pricing` เท่านั้น)

### 5.2 เทสต์เทียบตัวเลขข้ามระบบ (parity) — 3 ชั้น

| ชั้น | อยู่ที่ | ตรวจอะไร |
|---|---|---|
| ก | dayo (มีอยู่แล้ว + เพิ่มเคส) | `computeOrder` ของ shared = `quote_order` ของ SQL (กฎเหล็กข้อ 3 ของ dayo) · P1 เพิ่มเคสในข้อ 5.3 ลงเทสต์ที่มีอยู่ |
| ข | dayo → POS | สคริปต์ dayo `scripts/export-pos-parity.ts` (P1) **รันบน commit ที่ deploy อยู่จริง** (= `pricing.commit` ของ E1 production) · ดึง catalog ด้วย **`api_pos_catalog` จริง** (ไม่ประกอบเอง — จับบั๊กการแปลงชื่อฟิลด์) · รันเคสใน 5.3 กับ `quote_order` บน Supabase local แล้วเขียน `pos-parity.json` · เจ้าของคัดลอกไฟล์มา POS `packages/dayo-pricing/fixtures/` · **ที่ dayo ship จริง (ยังไม่เป็นไปตามชั้นนี้ — แจ้ง dayo แล้ว)**: สคริปต์ **ประกอบแคตตาล็อกเองและคิด `expected` ด้วย `computeOrder` ของ shared** ไม่ใช่ `api_pos_catalog` + `quote_order` (`scripts/export-pos-parity.ts:5-11`) จึงจับบั๊กแบบ `timeFrom` `HH:MM:SS` (§4.4 ข้อ 13) ไม่ได้ · รูปไฟล์จริง = `{dayo_commit, generated_at, pricing_files_sha256, catalog, cases:[{spec, note, draft, expected}]}` — **ไม่มี `catalog_version` และไม่มี `id`** (ใช้ `spec` เป็นตัวระบุเคส) · `expected` เป็น `QuoteResult` เต็ม (มี `lines` `promotionsApplied` `warnings`) · 20 จาก 25 เคสไม่มี `saleTime` · ไฟล์แรกอยู่ที่ `docs/design/pos-parity.json` (dayo `a0f76e2`) · ระหว่างนี้ชั้น ค ของ POS ใช้ไฟล์รูปนี้ได้ (ตรวจตัวห่อ+การแปลง) แต่ **ไม่นับเป็นหลักฐาน SQL = shared** จนกว่าสคริปต์เป็นชั้น ข จริง |
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
13. ขอบเวลา: `sold_at` นาทีเดียวกับ `timeTo` และ `timeFrom` (เช่น 14:00:59 เทียบ `timeTo` 14:00) · การตัดวินาทีของ `sale_time` · **และแคตตาล็อกที่ `timeFrom`/`timeTo` เป็น `HH:MM:SS`** (รูปที่ E1 ส่งจริง — §4.4 ข้อ 13): `sold_at` นาทีแรกของช่วง ต้องเทียบ shared กับ SQL (คาดว่าต่างจนกว่า dayo แก้ต้นทาง)
14. ตัวแปร/ตัวเลือกที่ถูกปิดใช้หลังขาย (ฝั่ง dayo คิดด้วย include_inactive ต้องได้ยอดเดียวกับตอนขาย) · **โปร (แก้ตาม ADR-0049 ข้อ 5 / ADR-0053)**: โปรที่ปิด *หลัง* `sold_at` ยังได้ = ยอดเท่าตอนขาย · โปรที่ปิด *ก่อน* `sold_at` ไม่ได้ = `computed_total` ต่างจากยอดของแท็บเล็ต (คาดไว้ ไม่ใช่บั๊ก — เคสนี้ตรวจที่ชั้นเชื่อมจริง ไม่ใช่ชั้น ค)
15. `bill_discount` ที่ส่งทั้ง `baht` และ `percent` → แท็บเล็ตไม่สร้างร่างแบบนี้ และ dayo ตอบ `INVALID`
16. **ขนาดที่ 3** (ADR-0054): แคตตาล็อกที่มี `sizes` 3 ขนาด (หนึ่งขนาดปิด) · ราคาขนาดใหม่ที่ active · ขนาดที่ปิดไม่มีตัวแปรใน E1

### 5.4 หลุมอื่นที่ต้องระวัง (ล็อก)

- **เปอร์เซ็นต์สองแบบ** (§4.1): ช่องทางเป็นสัดส่วน · ส่วนลด/โปรเป็นร้อยละ
- **ต้นทุนไม่มาถึงแท็บเล็ตเลย** (กำไรดูบนหน้าเว็บ dayo — ADR-0055 · D87 · §4.10 ก้อน 4): `cost_satang` ของบิลในเครื่องเป็น 0 และไม่แสดง · ต้นทุนจริงอยู่ที่ dayo (แช่แข็งตอนบิลเข้า · บิลนอกแคตตาล็อกต้นทุนเป็น null — D97)
- **ภาษี**: dayo ไม่มี VAT · `vat_satang` ในเครื่องเป็น 0 ไม่ส่ง
- **ยอดที่แท็บเล็ตส่งคือยอดที่เก็บเงินจริง** — ถ้าคิดด้วยแคตตาล็อกฉบับเก่า dayo บันทึกตามที่ส่งและติดธง ไม่แก้ยอดของแท็บเล็ต
- **อย่าคิดราคาซ้ำบนเซิร์ฟเวอร์ด้วยค่าจากแท็บเล็ต**: `pos_amounts` ใช้แค่ยอดระดับบิล · รายการ/ต้นทุน/สต็อกใช้ผลที่ dayo คิด (พฤติกรรม `create_order` เดิม)
- **ห้ามบวกบาท float ในแท็บเล็ต** (Z report, ยอดกะ) — บวกสตางค์

---

## 6. ออฟไลน์และการส่งข้อมูล

### 6.1 outbox (ใช้ของเดิมบน main)
- ทุกการเขียนที่ต้องส่ง (บิล ยกเลิกบิล · ก้อน 3–6: กะ เงินสด ค่าใช้จ่าย ตอกบัตร) เขียนลงตารางของมัน **และ** `outbox` ในธุรกรรมเดียว (`enqueueOutbox` — `apps/pos/src/db/outbox.ts`)
- **`local_only`** (สถานะใหม่ของแถว outbox): แถวกะ/เงินสดทุกชนิด (`shift`, `cash_movement` รวม `VOID_REFUND`, `cash_count`, `z_report`) ของกะที่เปิดก่อนก้อน 3 ใช้งานจริง เขียนเป็น `local_only` และ **ไม่ถูกส่งตลอดไป** (กะเหล่านั้นไม่เคยมีในฐานกลาง) · ไม่นับในป้าย "ยังไม่ส่ง" · ไม่ขึ้นหน้า "ส่งไม่ผ่าน" · ข้อมูลยังอยู่ในรายงานและไฟล์สำรองของเครื่อง
- **`closed_off_catalog`** (สถานะใหม่ของแถว outbox — ก้อน 3): แถว `order` ที่ `rejected` แล้ว owner ปิดเป็นบิลนอกแคตตาล็อก (§6.4) · ไม่ถูกส่งอีกตลอดไป · ไม่นับในป้าย "ยังไม่ส่ง" · ออกจากรายการ "ส่งไม่ผ่าน" · แถว `order_off_catalog` ใหม่ของบิลเดียวกันเข้าคิวแทน (ธุรกรรมเดียวกับ event `CLOSED_OFF_CATALOG`)
- `outbox.rowJson` = `data` ของ E2 ที่พร้อมส่ง (เงินแปลงเป็นบาทแล้ว ณ ตอนเขียน) · `idempotencyKey` = `<kind>:<uuid>` · **การลองใหม่อัตโนมัติส่งข้อความเดิมทุกไบต์เสมอ** · ข้อยกเว้นเดียว: ทางแก้ของ owner (§6.4) แก้ `rowJson` ของแถวที่ได้ `rejected` แล้วส่งด้วย key เดิมได้ — ทำได้เพราะผล `rejected` ไม่ถูกเก็บใต้ key (§4.5) · ห้ามแก้แถวที่เคย `accepted`/`duplicate` หรือแถวที่ยังรอคำตอบ
- `OutboxTable` เดิม (16 ตาราง) ลดเหลือชนิดของ E2 · แถวสต็อก/ผลิต/ซื้อ ไม่ถูกเขียนอีก (§11)

### 6.2 ตัวส่ง (ใช้แนวคิด Task 9 แผน 5)
- ส่งครั้งละ ≤ 20 แถว เรียงตาม `createdAt` · มีคำขอค้างได้ครั้งละ 1 (Web Locks API `navigator.locks` ชื่อ `dayo-push` กันหลายแท็บ)
- ปลุกเมื่อ: บันทึกเสร็จ (หน่วง 2 วินาที) · ทุก 60 วินาทีเมื่อมีของค้าง · event `online` · เปิดแอป · ก่อนปิดกะ
- อ่านคำตอบด้วย schema แบบยอมรับค่าที่ไม่รู้จัก · จับคู่คำตัดสินด้วย `key` ไม่ใช่ลำดับ · แถวที่ไม่มีคำตัดสินในคำตอบ = ยังไม่รู้ผล (ลองใหม่)
- แถวลูกรอแถวแม่: `order_void` ของบิลที่ยังไม่ `accepted` ไม่ถูกส่ง (ส่งก่อนได้ถ้าอยู่ในก้อนเดียวกันหลังแถวแม่) · แถวแม่ `rejected` → แถวลูกขึ้นหน้า "ส่งไม่ผ่าน" ทันทีด้วยเหตุผล `PARENT_REJECTED`
- **ช่อง (lane — ล็อกก้อน 3 · §4.10)**: **ช่องกะหนึ่งช่องต่อเครื่อง** = แถว `shift_open` `cash_movement` `cash_count` `shift_close` ของทุกกะ (ก้อน 4: ค่าใช้จ่ายจากลิ้นชัก + `expense_void` ของรายการลิ้นชัก) เรียงตาม `createdAt` · แถวใดในช่องกะได้ `deferred` → แถวหลังจากนั้นในช่องกะไม่ถูกส่งจนแถวนั้นผ่าน · แถว `rejected` ไม่หยุดช่อง (เฉพาะแถวลูกของมันไป `PARENT_REJECTED` · กลับเป็น `pending` เองเมื่อแถวแม่ที่แก้แล้วผ่าน) · **`rejected FORBIDDEN` ที่ `detail` ขึ้นต้น `scope:` ไม่ถือเป็นถาวร**: แถวรอแบบ `deferred` (ลองทุก 15 นาที ไม่นับรวม 50 ครั้ง ไม่เป็น STUCK) + แถบ owner "กุญแจเครื่องไม่มีสิทธิ์ <scope> — เพิ่มสิทธิ์บนเว็บ dayo" · **ค้างเกิน 24 ชม. = แถบแดง** · **ค้างเกิน 7 วัน owner เลือก "ปิดไว้ในเครื่อง" ได้** (m1) · แถวหลังจากนั้นในช่องกะหยุดรอเหมือน `deferred` · **ช่องบิล** (`order` `order_void` `order_off_catalog`) แยกจากช่องกะ — บิลไม่รอกะ (ผูกทีหลังได้) · แถวต่างช่องเดินต่อได้ · แถวแม่–ลูกตามตารางใน §4.10 ก้อน 3
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
| `CONFLICT` `receipt_taken:` (ใบเสร็จชน · แถวที่ไม่มีคำนำหน้าให้ถือแบบนี้) | "ออกเลขใบเสร็จใหม่" | ได้เลขถัดไปของเครื่อง · event `RECEIPT_RENUMBERED {old, new}` · ใบเสร็จพิมพ์ซ้ำได้ · Z ที่ออกไปแล้วไม่แก้ (dayo บันทึกเป็นข้อสังเกต ไม่ใช่ mismatch — §4.10) |
| `CONFLICT` `exists:<order_no>` (`order_off_catalog`) / `off_catalog_exists:<order_no>` (`order`) (ก้อน 3) | "รับทราบ — บิลอยู่ในระบบกลางแล้ว" | บิลถึงฐานแล้วด้วยเลข `order_no` นั้น · แท็บเล็ตเทียบ `data.reported_total` / `data.payment_is_cash` กับค่าแช่แข็งของบิลในเครื่อง — **ต่าง = แถบแดง "บิลในระบบกลางไม่ตรงกับเครื่อง"** (m2) · แถวถูกทำเครื่องหมายว่าส่งแล้ว (เก็บ `order_no`) ไม่ส่งซ้ำ · แถวลูกกลับเป็น `pending` · event `DELIVERED_ELSEWHERE {order_no}` |
| `CONFLICT` `key_changed:` ของบิล | "ส่งออก JSON" (บั๊กของแท็บเล็ต — เนื้อหาใต้ key เดิมเปลี่ยน) | แถวค้างในหน้านี้จนทีม POS แก้ · ยังเลือก "ปิดไว้ในเครื่อง" ได้ (ข้างล่าง) |
| `CONFLICT` `key_changed:` / `counted:` ของ **ชนิดกะ** และ `shift_close` ที่ยอดนับไม่ตรงการนับในฐาน (S5) | ไม่ใช่บั๊ก — **แถบแดง "ข้อมูลกะชนกับระบบกลาง — แนะนำให้เจ้าของเปลี่ยนกุญแจเครื่อง"** | ข้อมูลในฐานคือของผู้ส่งคนแรก (อาจมีคนใช้กุญแจนี้อยู่) · dayo แจ้ง 🔴 แล้ว · owner เปลี่ยนกุญแจ (§7 ข้อ 3) แล้ว "ปิดไว้ในเครื่อง" |
| `UNKNOWN_CODE` | "เลือกรหัสแทน" | เลือกเมนู/ขนาด-ความหวาน/ตัวเลือก/ช่องทาง/วิธีชำระ ที่ active จากแคตตาล็อกล่าสุด แทนรหัสที่หาย · event `CODE_REMAPPED` · **วิธีชำระเลือกได้เฉพาะฝั่งเดียวกับรหัสเดิม (เงินสด ↔ เงินสด · ไม่ใช่เงินสด ↔ ไม่ใช่เงินสด)** — ไม่งั้นเงินในลิ้นชักเพี้ยน (§4.10 การคิดซ้ำข้อ 7) |
| `FORBIDDEN` `scope:` | ไม่มีปุ่ม — ไม่ขึ้นหน้านี้ (จนครบ 7 วัน) | รอแบบ `deferred` จนเจ้าของเพิ่ม scope บนเว็บ · แถบแดงหลัง 24 ชม. · หลัง 7 วัน ขึ้นหน้านี้พร้อมปุ่ม "ปิดไว้ในเครื่อง" (§6.2 · m1) |
| `FORBIDDEN` `rule:` ของ `order_off_catalog` (ไม่มีประวัติถูกปฏิเสธในฐาน · `sold_at` ต่ำกว่าพื้นล่าง · เกินเพดานยอด — S1) | "ปิดไว้ในเครื่อง" | บิลนี้เข้าฐานกลางไม่ได้ · รายได้อยู่ในรายงานเครื่องเท่านั้น · ถ้าเกินเพดาน owner เพิ่มเพดานบนเว็บแล้ว "ลองใหม่" ได้ |
| `UNKNOWN_STAFF` | "เลือกผู้ขายแทน" | เลือกพนักงานในรายชื่อล่าสุด · event `STAFF_REMAPPED` |
| **ทุกเหตุผล** ของแถว `order` ที่ `rejected` (ทางสุดท้าย — ถ้ามีปุ่มเฉพาะข้างบน ให้ลองก่อน · สำหรับ `INVALID`/`FORBIDDEN`/`BAD_KEY` เป็นทางเดียว) | **"ปิดเป็นบิลนอกแคตตาล็อก"** (owner เท่านั้น · PIN + เหตุผล — D91 · D97) | แถว `order` เดิมเป็น `closed_off_catalog` (§6.1) หยุดส่งถาวร · เข้าคิวแถว `order_off_catalog` ของบิลเดียวกัน (ชื่อ/ราคา/ยอดจากบิลในเครื่องที่แช่แข็ง · `original_reason` = เหตุผลเดิม — §4.10 ก้อน 3) · แถวลูก (`order_void`) รอแถวใหม่เป็นแม่ · event `CLOSED_OFF_CATALOG` · บิลอยู่ใน `pos_bills` ของ Z ตามปกติ (ไม่มีธงพิเศษ) · **ไม่บันทึก `PAID_IN`/`PAID_OUT` หรือค่าใช้จ่ายสำหรับกรณีนี้** — เงินสดของบิลอยู่ในเงินที่ควรมีของกะแล้ว และรายได้เข้า `orders` ผ่านแถวใหม่ (ต่างจากทางแก้ของ Q52 ซึ่งใช้กับบิลที่อยู่ในฐานแล้ว) · ป้ายบนบิลในเครื่อง "นอกแคตตาล็อก" |
- แถว `order_off_catalog` ที่ถูกปฏิเสธใช้ปุ่มตามคำนำหน้า: `receipt_taken:` → ออกเลขใหม่ · `exists:` → รับทราบ · `key_changed:` → ส่งออก JSON · `UNKNOWN_CODE` (ช่องทาง/วิธีชำระ) → เลือกรหัสแทน · `UNKNOWN_STAFF` → เลือกผู้ขายแทน · `FORBIDDEN` `role:` (ผู้ปิดไม่ใช่ owner) → ปิดใหม่โดย owner · `INVALID` = บั๊กของแท็บเล็ต → "ส่งออก JSON" (ไม่มีทางปิดซ้ำ) หรือ "ปิดไว้ในเครื่อง"
- **"ปิดไว้ในเครื่อง"** (owner · PIN + เหตุผล · ทางสุดท้ายของแถวที่ไม่มีทางอื่น): แถวเป็น `local_only` ถาวร · แถวลูกเป็น `local_only` ตาม · event `EXCLUDED_FROM_SYNC` (หลักเดียวกับแผนก้อน 2 R8/N5) · ข้อมูลยังอยู่ในรายงานเครื่อง · ถ้าแถวนั้นอยู่ใน Z ที่ส่งไปแล้ว (`pos_bills`/`movement_ids`) Z นั้นจะค้าง `waiting_bills` ถาวร และหน้ารายละเอียดกะบนเว็บแสดงรายการที่ยังไม่มาพร้อมอายุการรอ — **ข้อจำกัดที่ยอมรับ** (ไม่ใช่ mismatch · แจ้ง Discord เมื่อรอเกิน 48 ชม. ยังไม่ทำ — ขัด D98 รอเจ้าของ Q74)
- **ทางตันที่ปิดแล้ว (ล็อก)**:
  - (ก) `order` ถูกปฏิเสธ `INVALID` เพราะเกิน 60 วัน หรือ `sale_date` ≠ วันที่ไทยของ `sold_at` → "ปิดเป็นบิลนอกแคตตาล็อก" ผ่านได้ เพราะชนิดนี้คิด `sale_date` จาก `sold_at` และไม่ใช้เพดาน 60 วัน (§4.10) · ยังต้องผ่านพื้นล่าง `sold_at` ≥ `block3_live_from` — บิลก่อนก้อน 3 ใช้งานจริงปิดได้แค่ "ปิดไว้ในเครื่อง" (owner เลื่อน `block3_live_from` ให้เก่าลงบนเว็บได้ถ้าจำเป็น)
  - (ข) แถวที่เวลาล้ำ `server_time` เกิน 24 ชม. (`deferred CLOCK_AHEAD` — หลัก N5 ของแผนก้อน 2 ใช้ต่อในก้อน 3 ทั้งช่องบิลและช่องกะ): แถวยัง `pending` ลองเองต่อ + แถบเตือน owner + การ์ด "รอเวลา" ในหน้านี้ · owner เลือก **รอ** (แถวผ่านเองเมื่อเวลาเซิร์ฟเวอร์ตามทัน) หรือ **"ปิดไว้ในเครื่อง"** · บิลนอกแคตตาล็อกช่วยไม่ได้เพราะเวลาขายในอนาคตยัง `CLOCK_AHEAD` · แถวในช่องกะที่ปิดไว้ในเครื่องปลดช่องให้แถวหลังเดินต่อ
  - (ค) `order_void` ที่ถูกปฏิเสธ (`FORBIDDEN` `rule:` วันยกเลิกไม่ตรงวันขาย · `INVALID` เกิน 60 วัน / `voided_at` < `sold_at`): บิลในฐานยัง `ok` ขณะที่เครื่องยกเลิกแล้ว → หน้านี้แสดง "ให้เจ้าของยกเลิกบิล <order_no> บนเว็บ dayo (พร้อมเหตุผล — ADR-0050)" แล้วกด **"ปิดไว้ในเครื่อง"** · การยกเลิกบนเว็บขึ้นในบรรทัด "เจ้าของแก้บิลหลังขาย" · **Z ที่มี `VOID_REFUND` ของบิลนี้ค้าง "รอ" (`missing_void_order_ids`) จนเจ้าของยกเลิกบิลบนเว็บ** แล้ว Z คิดซ้ำเองได้ (R3-m1)
- แถวกะ (`shift_open`) ที่ถูกปฏิเสธ: owner "แก้แล้วส่งใหม่" ได้เฉพาะ `opened_by` (เลือกพนักงานแทน) · บิลของกะไม่ถูกบล็อกอยู่แล้ว (ผูกทีหลัง) · แถว `cash_movement`/`cash_count`/`shift_close` ที่ `rejected` ด้วย `UNKNOWN_STAFF` → เลือกพนักงานแทน · `FORBIDDEN` `role:` ของ `shift_close` → owner ยืนยันด้วย PIN ใหม่ · เหตุผลอื่น = บั๊ก → "ส่งออก JSON" หรือ "ปิดไว้ในเครื่อง" · **`cash_movement` ที่ถูกปฏิเสธไม่หยุดช่องกะ** Z ที่ส่งตามมาจะเป็น `waiting_bills` (มี id ใน `missing_movement_ids`) จนแถวนั้นแก้แล้วผ่าน — ไม่ใช่ `mismatch` · Z ของกะยังอยู่ในเครื่องครบ

### 6.5 แคตตาล็อกและพนักงาน
- ดึง E1 เมื่อเปิดแอป · ทุก 5 นาที (ส่ง `known_version`) · ก่อนเปิดกะ · หลังได้ 200 ที่มี `changed: true` → เขียนทับสำเนาในเครื่องในธุรกรรมเดียว + เก็บ `catalog_version`
- ออฟไลน์: ขายด้วยสำเนาล่าสุด · บิลบอกฉบับที่ใช้
- ฉบับเปลี่ยนระหว่างมีตะกร้า: ใช้กลไก `PRICE_CHANGED` เดิม (D50 Q3-27) — คิดราคาใหม่ แสดงยอดเดิม → ใหม่ ให้แคชเชียร์ยืนยัน
- พนักงานใหม่ในรายชื่อ → ต้องตั้ง PIN ที่แท็บเล็ต (owner อนุมัติด้วย PIN ตัวเอง) ก่อนล็อกอินได้ · `active: false` → ล็อกอินไม่ได้ทันที

### 6.6 เลขใบเสร็จ
- 1 เครื่อง = 1 prefix (`A`, `B`…) = 1 API key · เลขต่อเนื่องไม่มีช่องว่าง (spec POS §4.7 เดิม)
- ติดตั้งแอปใหม่ด้วย key เดิม: ตั้งเลขถัดไปจาก `client.last_receipt_no` ของ E1 (ต้องออนไลน์ตอนตั้งเครื่อง · ค่าที่รูปไม่ใช่ `^[A-Z]{1,3}-\d{6}$` = หยุดตั้งเครื่องพร้อมข้อความ ไม่เดาเลข — §4.4 ข้อ 6) · ถ้ายังชนได้ E2 ตอบ `CONFLICT` ไม่ใช่ `duplicate` (เพราะ `pos_order_id` ต่าง) — บิลไม่หายเงียบ
- **เลขใบปิดกะ (ก้อน 3 · R4-1)**: ตั้งเครื่องใหม่/เชื่อมใหม่ด้วย key เดิมโดยไม่ได้กู้ไฟล์สำรอง → เลข Z ในเครื่องต่อจาก `client.last_z_no` ของ E1 (Z ใบถัดไป = `last_z_no + 1`) และ `prev_hash` ของ Z ใบถัดไป = `client.last_z_hash` (ไม่เริ่ม `z_no` 1 ใหม่ — ไม่งั้นได้ `z_no_taken:` และแจ้ง 🔴 S5 ปลอมตลอดไป) · `null` = key นี้ยังไม่มี Z เริ่มที่ 1 · ถ้ากู้ไฟล์สำรองแล้ว เลขในเครื่องน้อยกว่า `last_z_no` → ใช้ค่าจาก E1 (ค่าที่มากกว่า) · key ใหม่ (§7 ข้อ 3) เริ่มโซ่ใหม่ได้ เพราะกติกาโซ่นับต่อ key (Z ใบแรกของ key ได้รับยกเว้น)

### 6.7 นาฬิกา
- `sold_at`/`voided_at`/`counted_at` มาจากนาฬิกาเครื่องและ dayo เชื่อ (ADR-0040 ข้อ 4) · E1/E2 คืน `server_time` → **ตาม D80** (หลักเดิมของ D58 ที่ยกมาใช้ต่อ): นาฬิกาต่างเกิน 5 นาที = **แถบเตือนบนหน้าขาย + บรรทัดในหน้าสถานะระบบ · ไม่บล็อกการขาย** (ไม่บล็อกการยกเลิก เปิด/ปิดกะ นับเงินด้วย) · ออฟไลน์ไม่รู้เวลาเซิร์ฟเวอร์ = ใช้ความต่างล่าสุดที่วัดได้
- ฝั่ง dayo ยังตอบ `deferred CLOCK_AHEAD` ให้แถวที่เวลาเกินเวลาเซิร์ฟเวอร์ + 5 นาที (§4.5) → แถวนั้นรอในคิวจนเวลาเซิร์ฟเวอร์ตามทัน ไม่หาย · นาฬิกาเครื่องช้า (เวลาในแถวเก่ากว่าจริง) ไม่ถูกปฏิเสธ — ผลคือ `sold_at` คลาดและอาจกระทบโปรจำกัดเวลา/ธงซ้ำ ซึ่งแถบเตือนมีไว้ให้คนแก้นาฬิกา

### 6.8 ออฟไลน์ตอนปิดกะ (ก้อน 3)
ตอนปิดกะต้องดึงบิลเงินสดจากบอท (`GET /v1/pos/shift-cash`) จึงต้องออนไลน์ (Q15) · ถ้าออฟไลน์ (Q43 · D68): นับเงินบันทึกได้ · Z ออกเมื่อออนไลน์ · กะถัดไปเปิดได้ (แถว `shift_open` ของกะใหม่อยู่ก่อน `shift_close` ของกะเก่าในช่องกะได้ — §4.10 ก้อน 3) · แถบแดง "ใบปิดกะ <วันที่> รอออนไลน์" จนกว่าใบปิดกะออก

**ขั้นตอนนับเงินปิดกะในก้อน 3 (ล็อก — D101 แก้ D52 Q3b-3 · เกณฑ์ D102)**:
1. นับแบบไม่เห็นยอด (D52 Q3b-3 · คงเดิม) → กด "นับเสร็จ" → **`counted_at` = เวลานี้** (แก้จำนวนทีหลังไม่เปลี่ยน) · **ตั้งแต่นี้กะไม่รับบิลและเงินเข้า-ออกอีก** (ขายต่อต้องเปิดกะใหม่ — ตรงกับที่ D52 รวมนับกับปิดกะเป็นขั้นเดียว)
2. **ออนไลน์**: ดึง E4 ช่วง `(after, counted_at]` → แสดงเงินที่ควรมี **รวมบิลบอท** และส่วนต่าง → แก้จำนวนได้ → ถามเหตุผลถ้า \|variance\| **≥** `cash.variance_alert_satang` (D102) → owner กรอก PIN → บันทึก `cash_count` + `shift_close` ในธุรกรรมเดียว (เหมือน D52)
3. **ออฟไลน์ (D101)**: แสดงเงินที่ควรมีและส่วนต่าง **ติดป้าย "ยังไม่รวมบิลเงินสดจากบอท"** → แก้จำนวนได้ → owner กรอก PIN ยืนยันการนับ (**ยังไม่ถามเหตุผล**) → บันทึก `cash_count` · กะหยุดรับขายทันที → **เมื่อกลับมาออนไลน์** แท็บเล็ตดึง E4 แสดงเงินที่ควรมีและส่วนต่างจริง → ถามเหตุผลถ้า ≥ เกณฑ์ → owner กรอก PIN อีกครั้ง → บันทึก `shift_close` (Z) พร้อม `variance_alert` = ค่าตั้งที่ใช้
4. ตารางนับเงินในเครื่อง (`cash_count.expected_satang`/`variance_satang` เป็น not null): เก็บค่า ณ ตอนยืนยันการนับ (ออฟไลน์ = ไม่รวมบิลบอท) **ไว้ในเครื่องเท่านั้น ไม่ส่ง** · ค่าทางการอยู่ใน Z (D101 · `ZInput.cash` ที่มี `botCashSatang`) · แผน POS ตัดสินว่าจะเพิ่มคอลัมน์บอกว่ารวมบิลบอทหรือไม่

### 6.9 ความทนทานของข้อมูลในเครื่อง
- ขอ `navigator.storage.persist()` ตอนตั้งเครื่อง · แสดงสถานะบนหน้าตั้งค่า
- ไฟล์สำรองในเครื่องของ POS (หน้าสำรองเดิม) ยังใช้ได้ **แต่ต้องไม่มี API key** (§7)

---

## 7. ความปลอดภัย

1. **กุญแจเครื่อง**: owner สร้างที่ `/settings/api-clients` ของ dayo ชื่อ "แท็บเล็ตขาย 1" scope ตาม §4.1 · หน้าแสดงคีย์ครั้งเดียว **เป็นข้อความและ QR** (P1) · แท็บเล็ตหน้าตั้งค่าเครื่อง (owner PIN) สแกนหรือวาง → ทดสอบด้วย E1 → เก็บในค่าตั้งของเครื่อง (ไม่ sync ไม่อยู่ในไฟล์สำรอง ไม่แสดงอีก แสดงแค่ `dayo_` + 4 ตัวท้าย)
2. **เครื่องสำรอง**: มี key ของตัวเอง (prefix ใบเสร็จของตัวเอง) สร้างไว้แต่ **ปิดใช้** (`is_active=false`) จนต้องใช้ · ยกเลิกบิลของอีกเครื่องไม่ได้ (ADR-0040)
3. **เครื่องหาย/ถูกขโมย**: owner เพิกถอน key บนเว็บทันที → คำขอถัดไป 401 · บิลที่ยังไม่ส่งในเครื่องนั้นหาย (ยอมรับ — ลดความเสี่ยงด้วยการส่งทันทีที่ออนไลน์)
4. **สิทธิ์ของคำขอมาจาก key เท่านั้น** (ADR-0040) · `staff_id` = ผู้ทำ ไม่ใช่สิทธิ์ (ช่องที่ต้องเป็น owner ในก้อน 3 เช่น `closed_by` ตรวจแค่ระบุตัว — ด่านจริงคือ PIN owner บนแท็บเล็ต) · ขอบเขตที่ key หลุดทำได้: ส่งบิล/ยกเลิกบิลของเครื่องตัวเองวันเดียวกัน · อ่านเมนู รายชื่อพนักงาน (ไม่มี LINE id) บิล (ไม่มีต้นทุน) · ก้อน 3–6 เพิ่มการส่งกะ/ค่าใช้จ่าย/ตอกบัตร · **บิลนอกแคตตาล็อก (S1 · R3-C)**: ต้องมีแถว `order` ของบิลนั้นที่ถูกปฏิเสธจริงในร้าน (`pos_push_rejections`) — **แต่ข้อนี้แค่ผูกบิลกับแถวที่ถูกส่งมา ไม่กัน key ที่หลุด** (คนถือ key ส่ง `order` ที่ตั้งใจให้ถูกปฏิเสธก่อนแล้วปิดเป็นนอกแคตตาล็อกได้) · **ด่านจริง**: `sold_at` ไม่ต่ำกว่า `block3_live_from` · ยอด ≤ เพดานต่อบิล (ค่าเริ่มต้น ฿3,000 — รอ Q72) · ทุกใบแจ้ง Discord + ป้ายบนแดชบอร์ด · ความเสียหายสูงสุดจึงจำกัดที่เพดานต่อบิลและถูกเห็นทันที · **ไม่มี** ต้นทุน/กำไรใด ๆ ราคาซื้อ การแก้แคตตาล็อก · key ที่มี `reports:profit` ขอได้แค่ "คำขอดูกำไร" — ตัวเลขอยู่หลัง OTP/รหัส owner บนหน้าเว็บ (ข้อ 10)
5. **PIN**: อยู่ในเครื่องเท่านั้น (Q9) · แฮชแบบเดิมของ POS · ล็อกเมื่อผิดตาม D50 Q3-21 · ล็อกหน้าจออัตโนมัติ 10 นาที (Q3-24)
6. **บทบาทบนแท็บเล็ต**: มาจาก `staff.role` ของ dayo · enum `UserRole` ของ POS ต้องเพิ่ม `manager` · ตารางสิทธิ์ตาม Q44 (§12)
7. **CORS** จำกัด origin (§4.1) — ไม่ใช่กำแพงความปลอดภัย (คำขอนอกเบราว์เซอร์ไม่สน CORS) แต่กันหน้าเว็บอื่นใช้ key ที่รั่วในเบราว์เซอร์
8. **ข้อความตอบกลับสะท้อนค่าที่ส่งมาได้เฉพาะ** วันที่/เวลา รหัสเมนู-ช่องทาง-วิธีชำระ เลขใบเสร็จ และ SQLSTATE · **ห้าม** สะท้อน id พนักงาน ข้อความอิสระ หรือข้อความ error ดิบของ Postgres (แบบ `resolveStaffRef` เดิม)
9. **ค่าลับทั้งหมดเจ้าของถือ**: API key · Supabase secret · DB URL สำหรับสำรอง · รหัสเข้ารหัสไฟล์สำรอง · token OneDrive · Discord webhook — agent ไม่เห็น ไม่อ่าน `.env*` / `.dev.vars` ของทั้งสอง repo
10. **ดูกำไรจากแท็บเล็ต (ADR-0055 · D87 — แทน Q54/D79) — จุดที่ security-reviewer ต้องตรวจตอนก้อน 4**
    - หลักฐานว่าเป็น owner อยู่ที่หน้าเว็บ dayo (OTP ทาง LINE หรือรหัส 6 หลักที่ owner ตั้ง · ผิด 5 ครั้งล็อก 15 นาทีต่อเครื่อง · session 15 นาที) — ออกแบบและตรวจฝั่ง dayo แล้ว (`0053_profit_view.sql`) · เซิร์ฟเวอร์ไม่เชื่อ `staff_id` ที่แท็บเล็ตอ้าง (D69)
    - ฝั่งแท็บเล็ต: เก็บแค่การเปิดลิงก์ · **ห้าม** เก็บ `request_id`/URL/ตัวเลขกำไรลง SQLite/OPFS/IndexedDB/localStorage/Cache Storage/log/ไฟล์สำรอง · service worker ไม่ cache `/api/v1/pos/profit-view` และหน้า `/profit-view/*` ของ dayo
    - ความเสี่ยงที่เหลือ (ยอมรับใน ADR-0055): คนหยิบแท็บเล็ตได้ภายใน 15 นาทีหลังยืนยันเห็นกำไร
    - เทสต์บังคับ: ตามเกณฑ์ก้อน 4 ใน §9 (ล็อกตอนเริ่มก้อน 4)

---

## 8. สำรองข้อมูล (P7 — เพิ่มจาก ADR-0021 ไม่แทนที่)

> **ตัดสินแล้ว (O2 → D86 · D95)**: D64/D67 ยังยืน · dayo เลื่อน ADR-0051 ไว้ (dayo `368c00f`) แต่ **POS ไม่เปิดใช้แท็บเล็ตขายจริงจนกว่าการสำรองอัตโนมัติตามตารางนี้ทำงานจริง** (D86) · **ขอ dayo ยกเลิกการเลื่อน ADR-0051 แล้วทำฝั่ง dayo** (D95 · ร่าง P3 ส่วน "สิ่งที่ dayo ต้องตัดสิน") · POS เขียน **แผนเปิดใช้งาน** ที่ตรวจว่าการสำรองทำงานจริง รวมกับการทดสอบบนแท็บเล็ตจริง (D51) และการล็อกที่อยู่ dayo (D89) · เปิดใช้ขายจริงหลังก้อน 3 (D94) · เงื่อนไขเปิด `/api/v1` ของ ADR-0048 ข้อ 8 (สำรองเอง 24 ชม. + ซ้อมกู้) ยังใช้กับการเปิด API ได้ แต่ไม่พอสำหรับการเปิดใช้แท็บเล็ตขายจริง

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
| 1 | dayo | P1 + P2 + P7: `catalog_versions` + trigger · E1 · E2 (ชนิด `order`/`order_void`) · ฟิลด์ใหม่ E3 · CORS · QR ของคีย์ · scope `staff:read` · คอลัมน์ใหม่ `orders` · ธงบิลซ้ำ + แดชบอร์ด · บิล POS อ่านอย่างเดียวบนเว็บ/บอท · รหัสเมนูที่ถูกอ้างเปลี่ยนไม่ได้ · สคริปต์ `export-pos-parity` · สำรองอัตโนมัติ + ซ้อมกู้ | `npm run ci` ผ่าน · ทุกไฟล์ fixture ใน §4.11 ผ่านเทสต์ Route Handler · เทสต์ DB: ส่งแถวเดิมซ้ำ = `duplicate` · key เดิมเนื้อหาต่าง = `CONFLICT` · **`receipt_no` เดิม + `pos_order_id` ใหม่ (ทั้งก่อนและหลังลบคีย์ 30 วัน) = `CONFLICT` ไม่ใช่ `duplicate`** · แถวที่ถูก rejected แล้วส่ง key เดิมด้วยข้อมูลที่แก้ = `accepted` · ทุกแถวในตารางแผนที่ error §4.5 ได้คำตัดสินตามตาราง และ error ที่ไม่ได้แผนที่ (เช่นบังคับ raise `XX000` ในเทสต์) = `deferred SERVER_ERROR` เฉพาะแถวนั้น HTTP 200 · `voided_at` เกินเวลาเซิร์ฟเวอร์ 7 นาที = `deferred CLOCK_AHEAD` · ชนิด/ฟิลด์ไม่รู้จัก = `deferred UNSUPPORTED` · `computed_total` มีทุกบิล · CORS: 401/404 (API ปิด)/429/5xx ทุกตัวมี `Access-Control-Allow-Origin` + `Vary: Origin` + `Access-Control-Expose-Headers: Retry-After` · `OPTIONS` = 204 แม้ API ปิด · E1 มี `pricing` และ `supported_kinds` · เปลี่ยนรหัสช่องทาง/วิธีชำระที่มีบิลอ้าง = `DY422` · ยกเลิกที่ `voided_at` วันเดียวกันแต่ส่งวันถัดไป = ผ่าน · `voided_at` คนละวัน = `FORBIDDEN` · พนักงาน `removed` = ผ่าน · ตัวแปรที่ปิดใช้แล้ว = ผ่าน · รหัสเมนูไม่รู้จัก = `UNKNOWN_CODE` แถวอื่นในก้อนยังผ่าน · แก้ราคาเมนู → ฉบับเพิ่ม · รับเข้าที่แก้ `buy_price` → ฉบับไม่เพิ่ม · บิลบอท + บิล POS รายการ/ยอดเดียวกันห่าง 9 นาที = ติดธง, ห่าง 11 นาที = ไม่ติด, แหล่งเดียวกัน = ไม่ติด · owner แก้บิล POS บนเว็บพร้อมเหตุผล = ผ่าน · manager/บอท = `DY403` (ADR-0050 · D85) · workflow สำรองรันสำเร็จ 3 คืนติด ไฟล์อยู่ใน OneDrive ถอดรหัสได้ · ซ้อมกู้ผ่าน 1 ครั้ง · บังคับให้ล้ม 1 ครั้งแล้ว Discord ได้ข้อความ (D86 · D95: ย้ายเป็นเงื่อนไขของแผนเปิดใช้งาน — dayo ทำหลังยกเลิกการเลื่อน ADR-0051) · `API_V1_ENABLED` ยังปิดใน production · **สถานะจริง 26 ก.ย.**: dayo ทำก้อน 1A เสร็จและขึ้น prod/test แล้ว API ยังปิด · ที่ยังไม่มี: fixture สัญญา (→ POS เป็นเจ้าของตาม O4 §4.11) · parity ชั้น ข จริง (§5.2) · สำรองอัตโนมัติ (D86 · D95) |
| 2 | POS | ตารางแคตตาล็อกในเครื่องตามรูป E1 · `@dayo/dayo-pricing` (สำเนา + `VENDOR.json` + parity) · `money-edge.ts` · หน้าขาย: นมโอ๊ต/เกรดผง/โปรอัตโนมัติ/"ไม่ใช้โปร"/ราคาตามช่องทาง · ใบเสร็จแสดงเลขใบเสร็จ + คิว · พนักงานจาก E1 + ตั้ง PIN · ตัวส่ง outbox + คำตัดสินรายแถว + หน้า "ส่งไม่ผ่าน" · หน้าบิลบอท/เว็บวันนี้ (E3) · ตั้งเครื่องด้วยคีย์ · zod schema + fixture + mock server · ซ่อนงานสต็อก | `pnpm turbo run typecheck test` ผ่าน · parity ทุกเคสต่าง 0 สตางค์ · `vendor:check` ผ่าน · property test ของขอบเงินผ่าน · e2e (mock): ขายออฟไลน์ 5 บิล → ออนไลน์ → ส่งครบ ได้ `order_no` · ยกเลิกบิลก่อนส่ง → ส่งทั้งคู่ถูกลำดับ · แถว `rejected` ไม่ทำให้คิวค้าง · 401 หยุดส่ง (ในเบราว์เซอร์จริง ไม่ใช่เห็นเป็นเน็ตหลุด) · แก้แถว `CONFLICT` ด้วย "ออกเลขใบเสร็จใหม่" แล้วผ่าน · เทสต์เชื่อมจริงกับ dayo local บน commit ที่จะ deploy (ก้อน 1 เสร็จแล้ว): ขาย 20 บิลหลายแบบ (ครอบเคส §5.3) **`computed_total − total = 0` สตางค์ทุกบิล** · `pricing.files_sha256` ของ E1 = `VENDOR.json` · ขนาดจาก `catalog.sizes` (ไม่ตายตัว) · บิล POS ที่ owner แก้บนเว็บแสดง `dayo_edit` แบบอ่านอย่างเดียว · จากนั้นเจ้าของเปิด `API_V1_ENABLED=1` ใน production ได้ตามเงื่อนไข ADR-0048 ข้อ 8 · **การเปิดใช้แท็บเล็ตขายจริงรอหลังก้อน 3 + สำรองอัตโนมัติ** (D94 · D86) |
| 3 | dayo ∥ POS (สองแผน — D90) | ADR-0056 (จาก P3): ตาราง `shifts` `cash_movements` `cash_counts` `z_reports` + คอลัมน์ `orders.off_catalog*` + `pos_reported_amounts.payment` + `block3_live_from` อัตโนมัติ + ชนิด push 5 ชนิด + E4 `GET /v1/pos/shift-cash` + ฟังก์ชันคิดใบปิดกะซ้ำ + รายงานที่รองรับบิลไม่รู้ต้นทุน (รวมหน้าดูกำไร ADR-0055) + แจ้งเตือน Discord + แดชบอร์ด 1 บรรทัดต่อกะ + หน้ารายละเอียดกะ (owner) ∥ POS: หน้าเปิด/ปิดกะ เงินเข้า-ออก นับเงิน Z ที่รวมบิลเงินสดจากบอท · ช่องกะในคิว · ปุ่ม "ปิดเป็นบิลนอกแคตตาล็อก" · zod schema + fixture ของทุกชนิด | ปิดกะที่มีบิลเงินสดจากบอท 3 ใบ → เงินสดที่ควรมีรวมบิลบอท · Z ในฐานกลาง `matched` · **ขายออฟไลน์ทั้งกะแล้ว Z มาถึงก่อนบิล → `waiting_bills` (ไม่ใช่ mismatch · ไม่มี Discord) · บิลทยอยมาครบ → `matched` โดยไม่ต้องส่งอะไรเพิ่ม** · บิลครบแต่องค์ประกอบต่าง → `mismatch` + Discord ครั้งเดียว · ส่วนต่าง −฿20.00 → Discord · −฿19.99 → ไม่แจ้ง · ขายเงินสด ฿100 แล้วยกเลิกคืนเงิน → expected ไม่หักซ้ำ `matched` · **owner แก้บิลเงินสด ฿100 → ฿80 หรือยกเลิกบนเว็บหลังปิดกะ → Z ยัง `matched` และหน้ารายละเอียดกะแสดง "เจ้าของแก้บิลหลังขาย" ส่วนต่าง ฿20 / ฿100** (D93) · สองกะในวันเดียว บิลบอทแต่ละใบอยู่ใน Z เดียว · บิลบอทหลัง `counted_at` ไม่อยู่ใน Z นี้ · **นับออฟไลน์ → เปิดกะถัดไป → ออนไลน์ → Z กะแรกออก: ทุกแถวของทั้งสองกะ `accepted` ไม่มี `CONFLICT`** · บิลนอกแคตตาล็อก: `order` ถูก `rejected` → owner ปิด (PIN + เหตุผล) → `order_off_catalog` `accepted` · `off_catalog=true` · `cost_total` null · ไม่มี `order_items` · ไม่มี stock movement · ยอดขายของวันรวมบิลนี้ · กำไรขั้นต้นไม่รวมและแสดง "บิลไม่รู้ต้นทุน 1 ใบ" (แดชบอร์ดและหน้าดูกำไรตรงกัน) · ไม่ค้าง `waiting_bills` · `closed_by` ไม่ใช่ owner = `FORBIDDEN` · ยอดไม่ตรงสูตร = `INVALID` · มีบิลปกติ `pos_order_id` นี้แล้ว = `CONFLICT` · `order` ของบิลที่เป็นนอกแคตตาล็อกแล้ว = `CONFLICT` · `order_void` ของบิลนอกแคตตาล็อก = ยกเลิกได้ · key ไม่มี `shift:write` → แถวกะ `FORBIDDEN` ขณะบิลในคำขอเดียวกันผ่าน · `block3_live_from` ว่าง → `shift_open` แรกที่ `accepted` ตั้งค่า · แถวถัดไปไม่เปลี่ยน · `shift_open` ที่ `rejected` ไม่ตั้ง · แถว `local_only` ของกะก่อนก้อน 3 ไม่ถูกส่งและไม่ขึ้นหน้า "ส่งไม่ผ่าน" · ส่งกะซ้ำ = `duplicate` · แถว `deferred` ในช่องกะหยุดแถวกะหลังจากนั้นแต่บิลยังส่ง · แก้ `shifts`/`cash_movements`/`cash_counts`/`z_reports.snapshot` ในฐาน = raise · ฟังก์ชันคิดซ้ำอัปเดต `recompute_*` ได้ · หน้ารายละเอียดกะ: owner เห็น · manager/staff ถูกปฏิเสธ · `supported_kinds`/`supported_fields` ตรงกับที่ RPC รับจริง (เทสต์บังคับ ADR-0049 ข้อ 7) · `cash_movement` ถูกปฏิเสธแล้ว `shift_close` มาก่อน → `waiting_bills` (`missing_movement_ids`) → แก้แล้วผ่าน → `matched` · `RECEIPT_RENUMBERED` หลังออก Z → ยัง `matched` (ข้อสังเกตใน `recompute_detail`) · `after` ≠ `until` ของ Z ใบก่อนของ key เดียวกัน (ช่องว่างหรือทับ) → `mismatch` · บิลบอทที่ dayo ค้นได้ในช่วงแต่ไม่อยู่ใน `bot_bills` → `mismatch` · แก้บิลบอทหลังนับ → ข้อสังเกตเท่านั้น · `movement_ids` มี id ของกะอื่น/key อื่น → `mismatch` · `VOID_REFUND` รวมเกินยอดบิล → `mismatch` · มีบิลที่อยู่แล้วแต่ยอดต่าง ขณะบิลอื่นยังไม่มา → `mismatch` ทันที (ไม่ค้าง `waiting_bills`) · แถวแม่ของ key อื่น → `FORBIDDEN rule:` · `order_off_catalog` ของบิลที่ key นี้ไม่เคยถูกปฏิเสธ / `original_reason` ไม่ตรง / `sold_at` ต่ำกว่าพื้นล่าง / เกินเพดาน → `FORBIDDEN rule:` · บิลนอกแคตตาล็อกที่รับ → Discord 1 ข้อความไม่มียอดเงิน · `prev_hash` ไม่ต่อโซ่ → `chain_break` · `shift_close` ชนการนับในฐาน → 🔴 Discord + `data_conflict` · RPC หน้ากะ/`dashboard_shifts` ด้วย staff/manager = `DY403` · ข้อความ Discord ทุกชนิดไม่มียอดเงิน · Discord ส่วนต่างใช้ `variance_alert` ของ Z (ตั้ง ฿50 แล้วส่วนต่าง ฿30 = ไม่แจ้ง) · แถวลูก `PARENT_REJECTED` กลับ `pending` เองเมื่อแม่ผ่าน · key ไม่มี `shift:write` → รอ ไม่ขึ้น "ส่งไม่ผ่าน" · เพิ่ม scope แล้วผ่านเอง · `order_off_catalog` ของบิลปกติที่มีแล้ว = `CONFLICT` `exists:<order_no>` → "รับทราบ" · `order` ที่เกิน 60 วันปิดเป็นนอกแคตตาล็อกได้ (**fixture ตั้ง `block3_live_from` ให้เก่ากว่า 60 วัน** ไม่งั้นติดพื้นล่าง — R3-m5) · **กะขายออฟไลน์ทั้งกะ: `shift_close` มาก่อนบิลและก่อน `order_void` → `waiting_bills` ไม่ใช่ `mismatch` · ไม่มี Discord** (R3-A) · `VOID_REFUND` ของบิลที่อยู่ใน `pos_bills` ของ Z เดียวกันโดย `voided_at` null → `mismatch` ทันที · `VOID_REFUND` ชี้บิลของ key อื่น → `mismatch` · `VOID_REFUND` รอ `order_void` ที่ถูกปฏิเสธ → รอจนเจ้าของยกเลิกบิลบนเว็บ แล้ว `matched` เอง · บิลบอทที่ไม่ถูกแก้หลังนับแต่ยอดใน snapshot ≠ ยอดปัจจุบัน → `mismatch` · **Z ลำดับ (R3-B)**: Z `z_no` 5 ถูก "ปิดไว้ในเครื่อง" แล้ว Z 6 มาถึง → ข้อสังเกต "Z ขาดช่วง" ไม่ใช่ `mismatch`/`chain_break` · Z 5 ถูกปฏิเสธแล้วส่งใหม่หลัง Z 6 → Z 5 รับเป็นการเติมช่อง แล้ว Z 6 ถูกคิดซ้ำ ตรวจ `prev_hash`/`after` กับ Z 5 และล้างข้อสังเกต · Z ที่ `z_no` ซ้ำ → `CONFLICT` `z_no_taken:` + 🔴 · Z เลขต่ำที่ `counted_at` ไม่อยู่ระหว่างใบข้างเคียง (เล่นซ้ำ) → `mismatch` + `chain_break` · Z ใบแรกของ key ไม่ตรวจโซ่ · **ติดตั้งแอปใหม่ด้วย key เดิมโดยไม่กู้ไฟล์สำรอง → E1 ให้ `last_z_no`/`last_z_hash` → Z ใบถัดไปได้ `z_no` = `last_z_no + 1` และโซ่ต่อ ไม่มี `z_no_taken:` ไม่มี 🔴** (R4-1) · **บิลรับแล้วใต้ key เก่า แล้วปิดเป็นนอกแคตตาล็อกจาก key ใหม่ → `CONFLICT` `exists:`** · `order` เดียวกันส่งซ้ำด้วย key ใหม่ → `CONFLICT` `exists:` ไม่สร้างบิลที่สอง · บิลนอกแคตตาล็อกของ key เก่าแล้วปิดซ้ำจาก key ใหม่ → `CONFLICT` `off_catalog_exists:` ไม่ใช่ `duplicate` (R4-2) · Z ที่ `z_no` เกินสูงสุด + 50 → `INVALID` + แจ้ง S5 · Z ขาดช่วงที่ `after` ไม่ตรงการนับล่าสุดและช่วงนั้นมีบิลเงินสดบอท → `mismatch` · ไม่มีบิล → ข้อสังเกต (R4-M) · `order_off_catalog` จาก key ใหม่หลังเปลี่ยนกุญแจ ของบิลที่ key เก่าเคยถูกปฏิเสธ → รับ · `original_reason` เป็นเหตุผลใดก็ได้ที่เคยบันทึก → รับ · owner ตั้ง `block3_live_from` ให้ใหม่กว่าเดิมบนเว็บ → ปฏิเสธ · `data` ของผลทุกชนิดตามที่ล็อก · parity สูตรเงินที่ควรมีแท็บเล็ต = dayo (รวมติดลบ) |
| 4 | dayo ∥ POS (ร่าง — ล็อกตอนเริ่มก้อน 4) | ADR-0057 (จาก P4): `expense_categories` `expenses` + ชนิด push + `dashboard_net_profit` ∥ POS: หน้าบันทึกค่าใช้จ่าย (ลิ้นชัก/ธนาคาร) · ค่าใช้จ่ายจากลิ้นชักลดเงินสดที่ควรมี · ปุ่ม "ดูกำไร" เปิดหน้าเว็บ dayo (ADR-0055 — dayo ship แล้ว) | ค่าใช้จ่าย ฿120 จากลิ้นชัก → เงินสดที่ควรมีลด 120.00 ทั้งแท็บเล็ตและการคิดซ้ำ (`cash.drawer_expenses`) · หมวด "ซื้อวัตถุดิบเข้าสต็อก" ไม่ลดกำไรสุทธิ · กำไรสุทธิของเดือนตัวอย่างตรงกับที่คิดมือ (บิลนอกแคตตาล็อกแยกบรรทัด) · ปุ่มดูกำไร: key ไม่มี `reports:profit` = 403 → ข้อความ · ออฟไลน์ = ข้อความ · ไม่มี URL/ตัวเลขกำไรใน OPFS/IndexedDB/localStorage/Cache Storage · คำตอบ API ไม่มีตัวเลขกำไร/ต้นทุน · security-reviewer ตรวจก้อนนี้ |
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

Q40–Q53 บันทึกแล้วใน D67–D77 (`00-บันทึกการตัดสินใจ.md`) · Q54 ตัดสินแล้ว (ทาง ก — D79 · กฎนาฬิกา D80) **แล้วถูกแทนด้วย D87 (ADR-0055)** · Q52 ถูกแทนบางส่วนด้วย D85 · เนื้อหาในสเปกและร่าง ADR แก้ตามนี้แล้ว

| # | เรื่อง | ตัดสิน | อยู่ที่ |
|---|---|---|---|
| Q40 | แจ้งเตือนสำรองล้ม | Discord ช่องระบบ `#dayo-ระบบ` + `@here` ตาม ADR-0044 · ไม่ใช้ LINE | §8 · P7 |
| Q41 | token OneDrive ที่ rclone ต่ออายุ | เขียนกลับเข้า GitHub secret ทุกคืนด้วย fine-grained PAT ที่เจ้าของสร้าง · เตือนก่อน PAT หมดอายุ 14 วัน | §8 · P7 |
| Q42 | รหัสเข้ารหัสไฟล์สำรอง | เก็บเป็น GitHub secret (ซ้อมกู้รายเดือนอัตโนมัติ) · เจ้าของต้องเก็บสำเนานอก GitHub ด้วย | §8 · P7 |
| Q43 | ออฟไลน์ตอนปิดกะ | นับเงินได้ตอนออฟไลน์ · Z รอออนไลน์ · กะถัดไปเปิดได้ · แถบแดงจนกว่า Z ออก | §6.8 · P3 |
| Q44 | สิทธิ์ตามบทบาทบนแท็บเล็ต | **staff**: ขาย · ยกเลิกบิลตัวเองวันเดียวกัน (PIN owner อนุมัติตาม D50) · เปิด/ปิดกะ · เงินเข้า/ออก · นับเงิน · ตอกบัตรตัวเอง · **manager**: + บันทึกค่าใช้จ่าย · ดูรายงานกะ · **owner**: ทุกอย่าง + ตั้งเครื่อง/คีย์ · ตั้ง PIN คนอื่น · แก้เวลาตอกบัตร · อัตราค่าจ้าง · ใบเงินเดือน · หน้า "ส่งไม่ผ่าน" · หน้ากำไร (Q45) | §7 ข้อ 6 |
| Q45 | กำไรสุทธิบนแท็บเล็ต | **ได้ เฉพาะ owner** — **วิธีเปลี่ยนตาม D87**: ปุ่มบนแท็บเล็ตเปิดหน้าเว็บ dayo (`POST /v1/pos/profit-view` · OTP/รหัส owner บนเว็บ — ADR-0055) · API ไม่ส่งตัวเลขกำไร (ADR-0040 ข้อ 3 คงเดิม ไม่มีข้อยกเว้น) · ไม่เก็บในเครื่อง | §4.10 ก้อน 4 · §7 ข้อ 10 |
| Q46 | ใครบันทึกค่าใช้จ่าย | แท็บเล็ตเท่านั้นในตอนนี้ (ทั้งลิ้นชักและธนาคาร) · เว็บอ่านอย่างเดียว | §3 · P4 |
| Q47 | พนักงานรายวัน/รายชั่วโมงต้องอยู่ใน `staff` ของ dayo | ใช่ — ทุกคนเพิ่มบอทแล้ว owner อนุมัติบนเว็บ | P6 |
| Q48 | วิธีใช้ตัวคิดราคาของ dayo | สำเนาไฟล์ปักรุ่นกับ commit ของ dayo + ตรวจ sha256 | §5.1 |
| Q49 | owner ปรับต้นทุนเฉลี่ยเอง | ได้ ต้องใส่เหตุผล มีประวัติใน `audit_log` · ไม่แก้บิลเก่า | §4.10 ก้อน 5 · P5 |
| Q50 | นำเข้าแบบทับทั้งหมดที่ไฟล์ขาดชีต/คอลัมน์ | ปฏิเสธทั้งไฟล์ **ก่อนเขียนอะไร** และบอกเป็นภาษาไทยว่าขาดชีตไหน และชีตไหนขาดคอลัมน์บังคับอะไร | P8 |
| Q51 | รหัสเมนูที่มีบิลอ้างแล้ว | ล็อก เปลี่ยนไม่ได้ (เปลี่ยนชื่อไทย/ชื่อพ้องแทน) · ผู้คุมงานขยายไปถึงรหัสช่องทางและวิธีชำระ (รีวิวข้อ 13) | §4.9 · P2 |
| Q52 | บิล POS ของวันที่ปิดแล้ว | (**แทนบางส่วนด้วย D85**: owner แก้/ยกเลิกบนเว็บได้พร้อมเหตุผลตาม ADR-0050 · เงินในลิ้นชักไม่ตามการแก้ — D93) แก้บนแท็บเล็ตไม่ได้ · ส่วนต่างแก้ด้วยการปรับในกะ (`cash_movement` `PAID_IN`/`PAID_OUT` พร้อมเหตุผลอ้างเลขใบเสร็จ) หรือบันทึกเป็นค่าใช้จ่าย · ธงซ้ำให้ยกเลิกฝั่งบอท/เว็บ | §4.7 · §4.8 |
| Q53 | บอทเป็นช่องทางขายเท่ากับ POS | ใช่ ไม่ใช่ทางสำรอง · P2 แก้ข้อความ ADR-0006 และ ADR-0035 ข้อ 5 | P2 |
| Q54 | การพิสูจน์ตัวตน owner ของรายงานกำไรบนแท็บเล็ต | (**ถูกแทนด้วย D87** — ดูกำไรบนหน้าเว็บ dayo ด้วย OTP ตาม ADR-0055 · ข้อความต่อไปนี้เป็นประวัติ ไม่ทำ) **ทาง ก**: owner ล็อกอิน LINE บนเว็บ กด "เปิดดูกำไรบนแท็บเล็ต" ได้รหัส 6 หลัก (5 นาที · ครั้งเดียว · ผูก key · ผิด 5 ครั้งเป็นโมฆะ) → แท็บเล็ตแลกเป็นสิทธิ์ชั่วคราวถึงสิ้นวันทำการ (≤ 16 ชม.) เก็บในหน่วยความจำ · เพิกถอนได้จากเว็บ · `staff_id` ที่อ้างไม่ใช่หลักฐานอีกต่อไป · บันทึกเป็น D79 (พร้อมกฎนาฬิกาเตือนไม่บล็อก) | §4.10 ก้อน 4 · §7 ข้อ 10 · §9 · P4 |

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
| 5 | สูง | รายงานกำไร owner ตรวจแค่ `staff_id` ที่อ้าง (ขัดถ้อยคำ D69) | **แก้แล้วหลังเจ้าของตัดสิน Q54 ทาง ก** (รหัสครั้งเดียวจากเว็บ — §13.4 แถว Q54) | §12 Q54 |
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
| Q54 | — | รายงานกำไรของ owner ตรวจแค่ `staff_id` ที่อ้าง (รีวิวรอบ 1 ข้อ 5 · ค้างตั้งแต่รอบ 1) | **เจ้าของเลือกทาง ก**: รหัส 6 หลักครั้งเดียวจากเว็บ (ล็อกอิน LINE) → สิทธิ์ชั่วคราวถึงสิ้นวันทำการ เก็บในหน่วยความจำ เพิกถอนได้ · endpoint เปิดใช้ได้ในก้อน 4 · ความเสี่ยงที่เหลือ = แท็บเล็ตยังปลดล็อกระหว่างวันขณะสิทธิ์ของ owner ยังใช้ได้ (token อยู่รอดการสลับหน้า · ตัวเลขล้างเมื่อออกจากหน้ากำไร — ผู้คุมงานตัดสิน) | §4.10 ก้อน 4 · §7 ข้อ 10 · §9 · §12 · P4 |

### 13.5 จากรีวิวรอบ 4 (25 ก.ย. 2026) — แก้แล้วทุกข้อ

| # | ความรุนแรง | เรื่อง | แก้อย่างไร (ตามคำตัดสินของผู้คุมงาน) | ที่ |
|---|---|---|---|---|
| R5 | กลาง | `order_excluded` เพิ่มรายได้โดย dayo ไม่ตรวจกับข้อมูลที่มี | ตรวจกับ `snapshot.pos_bills` ของ Z (มี id · `excluded=true` · `total`/`sold_at` ตรง) ไม่ตรง = `INVALID` · owner ตรวจฝั่งเซิร์ฟเวอร์ (`staff_id` role owner **และ** snapshot ติด excluded) · บิลที่ยกเลิกใน snapshot นับรายได้ 0 · `order` ของ `pos_order_id` ที่ถูกกันออกแล้ว = `CONFLICT` | §4.5 ข้อ 0 · §4.10 ก้อน 3 · §9 ก้อน 3 · P2 ข้อ 5 · P3 |
| A1 | ต่ำ–กลาง | audit ไม่มีการออกรหัสและการเพิกถอน | เพิ่ม `profit_code_issued` `profit_code_voided` (แทน `profit_code_void`) `profit_session_created` `profit_session_revoke` เข้า `audit_log.action` และเกณฑ์ก้อน 4 | §4.10 ก้อน 4 · §9 ก้อน 4 · P4 |
| L1 | ต่ำ | คำขอพร้อมกันนับรหัสผิดเกิน 5 | นับ `failed_attempts` ใต้ `for update` | §4.10 ก้อน 4 ข้อ 5 · P4 |
| L2 | ต่ำ | ไม่มีสัญญาณเมื่อมีคนเดารหัส | รหัสเป็นโมฆะเพราะผิดครบ 5 ครั้ง → Discord ช่องระบบ | §4.10 ก้อน 4 ข้อ 5 · P4 |
| L3 | ต่ำ | รหัส/token อาจรั่วทาง log หรือข้อความ `22P02` | route ห้าม log body · RPC ตรวจรูปก่อน cast · เทสต์ไม่มี `dps_` ใน log | §4.10 ก้อน 4 ข้อ 5 · P4 |
| L4 | ต่ำ | หมดอายุ "23:59:59" มีช่องว่าง 1 วินาที | ใช้ `< เที่ยงคืนไทยถัดไป` · เซิร์ฟเวอร์ตัดสิน แท็บเล็ตแสดงผลเท่านั้น | §4.10 ก้อน 4 · P4 |

### 13.6 ปรับตาม dayo ที่ ship แล้ว (ADR-0048–0059 · 26 ก.ย. 2569)

ที่มา: รายงานส่วนต่าง `.superpowers/sdd/2026-09-25-07-block2-pos-sell-central/dayo-adr-delta.md` (M7–M8) · หมายเหตุจาก dayo `06-การเปลี่ยนสเปกจากฝั่ง-dayo.md` · อ่าน repo dayo `main` `232bf57` (อ่านอย่างเดียว) · path ของ dayo: SQL = `supabase/migrations/…` · ADR = `docs/adr/…` · "สถานะ" = ✅ แก้แล้วในสเปก · ⏳ รอเจ้าของ (ไม่เลือกข้าง) · 📨 แจ้ง dayo

| # | เรื่อง | เปลี่ยนในสเปก | ที่มาใน dayo (file:line) | สถานะ | ที่ |
|---|---|---|---|---|---|
| S1 | ขนาดแก้วตั้งได้ | ขนาด = ข้อความรูป `^[1-9][0-9]{0,2} oz$` ไม่ใช่ 2 ค่าตายตัว | `packages/shared/src/types.ts:5-11` · `docs/adr/0054-configurable-cup-sizes.md:6-10` | ✅ | §4.1 |
| S2 | `catalog.sizes` | บังคับ · รวมขนาดที่ปิด · ตัวแปรของขนาดที่ปิดไม่ส่ง · ปุ่มขนาดจาก `sizes` · ตรวจขนาดก่อนเก็บเงิน | `0048_cup_sizes.sql:20, 1470-1482` · `packages/shared/src/types.ts:238` | ✅ | §4.4 ตัวอย่าง + ข้อ 2, 12 · §5.1 · §5.3 ข้อ 16 |
| S3 | `categoryLabel` null ได้ | schema รับ null · แท็บเล็ตใช้ `family` แทน | `0048_cup_sizes.sql:1491` | ✅ | §4.4 ข้อ 2 |
| S4 | เวลาโปร `HH:MM:SS` | schema รับสองรูป · ห้ามแปลงเอง · นาทีแรกของโปรต่าง shared/SQL | `0048_cup_sizes.sql:1552` · เทียบ `0020_api_v1.sql:126` · `packages/shared/src/promotions.ts:62-64` | ✅ + 📨 (ขอ dayo ส่ง `left(time::text,5)`) | §4.4 ข้อ 13 · §5.3 ข้อ 13 |
| S5 | `pricing.commit` null ได้ | แสดง "ไม่ทราบ" · เทียบด้วย `files_sha256` เท่านั้น | `0049_pos_catalog.sql:304` | ✅ | §4.4 ข้อ 9 |
| S6 | `last_receipt_no` = `external_ref` ดิบ | schema ไม่ตรวจรูป · ตรวจตอนตั้งเลข | `0049_pos_catalog.sql:321-325` | ✅ | §4.4 ข้อ 6 · §6.6 |
| S7 | trigger ฉบับแคตตาล็อก | ระดับคำสั่ง (ไม่กระทบแท็บเล็ต) | `docs/adr/0048-pos-catalog-endpoint.md:6` | ✅ | §4.3 |
| S8 | ถอด `POST/PATCH /v1/orders` | ไม่คงอยู่อีก | `docs/adr/0049-pos-push-row-verdicts.md:17` | ✅ | §4.1 |
| S9 | CORS | Allow-Headers มี `Idempotency-Key` · origin `https://` ตรงตัว | `06-การเปลี่ยนสเปกจากฝั่ง-dayo.md` §6 (หมายเหตุจาก dayo) | ✅ | §4.1 |
| S10 | 403 ทั้งคำขอ | key ไม่มี `orders:write` = HTTP 403 ก่อนถึงแถว (ไม่ใช่ `FORBIDDEN` ต่อแถว) | `0052_pos_push.sql:725-726` (ต่อแถว `593-594` ไปไม่ถึง) | ✅ | §4.5 scope · ตารางเหตุผล · error ทั้งคำขอ |
| S11 | `sale_date` วันพรุ่งนี้ | `deferred CLOCK_AHEAD` | `0052_pos_push.sql:357-358` | ✅ | §4.5 ตาราง `order` · ตาราง deferred |
| S12 | `order_void` เก่ากว่า 60 วัน | `rejected INVALID` | `0052_pos_push.sql:491-494` | ✅ | §4.5 ตาราง `order_void` |
| S13 | ขนาดไม่พบตัวแปร | `UNKNOWN_CODE` (ตรวจแค่ข้อความ ≤ 20) | `0052_pos_push.sql:293, 381-386` | ✅ | §4.5 ตาราง `order` |
| S14 | ลำดับตรวจแถว | ตามโค้ดจริง (mock ต้องตาม) | `0052_pos_push.sql:560-620` | ✅ | §4.5 ข้อ 6 |
| S15 | โปรที่ปิดก่อน `sold_at` | dayo ไม่คิดให้ → ยอดต่าง ไม่ปฏิเสธ (เดิมสเปกเขียนว่ายังใช้ได้) | `docs/adr/0049-pos-push-row-verdicts.md:14` · `docs/adr/0053-promotion-status-history.md` · `0051_multi_source_sales.sql:435` | ✅ | §4.5 ข้อ 2 · §5.3 ข้อ 14 |
| S16 | (ก0) `pos_excluded_orders` | ยังไม่ทำ (รอ ADR-0056) → **ยกเลิก แทนด้วยบิลนอกแคตตาล็อกใน `orders`** (D91 · §13.8 C1) | `docs/adr/0049-pos-push-row-verdicts.md:8` · `docs/adr/0056-pos-shifts-cash-drawer.md:3` | ✅ | §4.5 ข้อ 0 · §4.10 ก้อน 3 |
| S17 | E3 `dayo_edit` | ฟิลด์ใหม่ · null ได้ · ชื่อ/เหตุผล null เมื่อไม่มี `staff:read` · แท็บเล็ตแสดงแบบอ่านอย่างเดียว | `0052_pos_push.sql:830-831` · `0051_multi_source_sales.sql:1479-1497` · `docs/adr/0050-multi-source-sales-and-pos-bill-edits.md:10` | ✅ | §4.6 |
| S18 | E3 `pos_order_id` | เฉพาะบิลของ key นี้ · แท็บเล็ตใช้จับคู่บิลของตัวเอง | `0052_pos_push.sql:826` | ✅ | §4.6 |
| S19 | E3 `updated_at` | ไม่เป็น null อีก | `0052_pos_push.sql:821` | ✅ | §4.6 |
| S20 | owner แก้/ยกเลิกบิล POS บนเว็บ | ขัด §4.7 ข้อสุดท้าย + D76 + Q52 + เกณฑ์ก้อน 1 "`DY403`" · ติดป้าย ไม่เลือกข้าง | `docs/adr/0050-multi-source-sales-and-pos-bill-edits.md:8-11` | ✅ **D85** (+ D93 เรื่องเงินสด) | §3 · §4.6 · §4.7 · §4.8 · §4.10 ก้อน 3 · §9 · §12 Q52 |
| S21 | สำรองอัตโนมัติเลื่อน | ขัด D64/D67/D65 · เงื่อนไขเปิด API เปลี่ยน · ติดป้าย ไม่เลือกข้าง | `docs/adr/0051-nightly-auto-backup-onedrive.md:3` · `docs/adr/0048-pos-catalog-endpoint.md:18` (dayo `368c00f`) | ✅ **D86 · D95** (ขอ dayo ยกเลิกการเลื่อน) | §8 · §9 |
| S22 | ดูกำไรผ่านหน้าเว็บ dayo | ขัด D79 (Q54 ทาง ก) · endpoint `/profit-session` `/profit` ถูก dayo ยกเลิก · ติดป้าย ไม่เลือกข้าง | `docs/adr/0055-profit-view-from-pos-via-web.md:6-11` | ✅ **D87** | §3 · §4.10 ก้อน 4 · §7 ข้อ 10 · §12 Q54 |
| S23 | เจ้าของ fixture สัญญา | POS เป็นเจ้าของชั่วคราว (คำวินิจฉัยผู้คุมงาน O4) · D82 ถูกแทนจนมี D ใหม่ | dayo ไม่มีโฟลเดอร์ `apps/web/test/fixtures/` เลย (`git ls-files` ที่ `232bf57` ไม่มี `pos-contract`) · งานค้างของ dayo `docs/HANDOFF.md:37-39` ไม่มีรายการ fixture | ✅ | §4.11 ข้อ 2 · §9 ก้อน 1 |
| S24 | parity ชั้น ข ยังไม่จริง · รูปไฟล์ต่าง | สคริปต์ประกอบแคตตาล็อกเอง/คิดด้วย shared · ไม่มี `catalog_version`/`id` · มี `spec`/`note` · 20/25 เคสไม่มี `saleTime` | `scripts/export-pos-parity.ts:5-11, 166-173` · ไฟล์ `docs/design/pos-parity.json` (dayo `a0f76e2`) | ✅ + 📨 | §5.2 ชั้น ข |
| S25 | ไฟล์ตัวคิดราคาที่คัดลอก | เพิ่ม `time.ts` | `06-การเปลี่ยนสเปกจากฝั่ง-dayo.md` §7 | ✅ | §5.1 |
| S26 | ADR-0056 กะ/ลิ้นชัก เลื่อน | ก้อน 3 เขียนใหม่และล็อกแล้ว (บิลนอกแคตตาล็อกใน `orders` แทน `pos_excluded_orders` · ตอบคำถาม 3 ข้อของ ADR-0056) | `docs/adr/0056-pos-shifts-cash-drawer.md:3-9` | ✅ (§13.8) | §4.10 ก้อน 3 |
| S27 | เลข ADR ที่อ้างผิด | กติกา "API ไม่ส่งต้นทุน/กำไร" คือ **ADR-0040 ข้อ 3** + DATA-CONTRACT §8 ไม่ใช่ ADR-0035 ข้อ 3 — ที่อ้าง "ADR-0035 ข้อ 3" ในสเปกนี้ให้อ่านเป็น ADR-0040 ข้อ 3 | `06-การเปลี่ยนสเปกจากฝั่ง-dayo.md` §1 | ✅ (หมายเหตุ ไม่แก้ทุกจุด) | §4.4 ข้อ 1 · §5.4 · §12 Q45 |

เรื่องที่แจ้ง dayo (ไม่ต้องให้เจ้าของ POS ตัดสิน): S4 เวลาโปร `HH:MM:SS` · S24 parity ชั้น ข + ใส่ `catalog_version` + เติม `saleTime` · ตัวอย่างใน `docs/API.md` ของ dayo ยังผิดบางจุด (ให้ถือ SQL เป็นความจริง)

### 13.7 แก้หลังรีวิว A3 (26 ก.ย. 2569)

| # | เรื่อง | แก้เป็น | ที่มาฝั่ง dayo |
|---|---|---|---|
| S28 | คีย์ย่อยที่ไม่รู้จักใน `bill_discount`/`totals` | `rejected INVALID` (ไม่ใช่ `deferred UNSUPPORTED`) | `0052_pos_push.sql:316,339` · ตัวตรวจฟิลด์ `0052:587-591` ดูแค่ชั้นบนกับ `lines.*` |
| S29 | จำนวน fixture สัญญา | ไม่ตายตัว — ตาม `CONTRACT_FIXTURE_NAMES` (27 ไฟล์หลัง A3) · §4.11 ที่เขียน 22 หมายถึงชุดเริ่มต้น | — |
| S30 | `key` ในคำตอบรายแถว | เป็น `null` ได้เมื่อ key ที่ส่งไม่ใช่ข้อความ · แท็บเล็ตถือว่าจับคู่ไม่ได้ ยัง pending | `0052_pos_push.sql:748` |

### 13.8 ล็อกก้อน 3 และปิด O1–O3 (26 ก.ย. 2569 · รอบ 14–15)

ที่มา: D84–D100 · ADR-0056 (เลื่อน · คำถาม 3 ข้อ) · อ่าน dayo SQL `0048`–`0053` (อ่านอย่างเดียว · SQL ถือเป็นความจริง) · ร่าง ADR ที่ตรงกัน: [`dayo-adr-drafts/P3-shift-cash-z-report.md`](dayo-adr-drafts/P3-shift-cash-z-report.md) · แถวใน §13.3 (N1) §13.4 (R1, R2) §13.5 (R5) ที่พูดถึง `order_excluded`/`pos_excluded_orders`/`ALREADY_PRESENT` และ §13.4 แถว Q54 เป็น **ประวัติ** — ถูกแทนด้วย C1 และ O3 ข้างล่าง

| # | เปลี่ยน | D / ที่มา | ที่ |
|---|---|---|---|
| O1 | ปิด "รอเจ้าของ O1": owner แก้/ยกเลิกบิล POS บนเว็บได้พร้อมเหตุผล · แท็บเล็ตแสดง `dayo_edit` อ่านอย่างเดียว ไม่แก้บิล · บิลวันที่ปิดแล้วบนแท็บเล็ตยังแก้ด้วยรายการปรับกะ/ค่าใช้จ่าย | D85 · ADR-0050 ข้อ 3 | หัวเอกสาร · §3 · §4.6 · §4.7 · §4.8 · §4.9 · §9 ก้อน 1 · §12 Q52 · §13.6 S20 |
| O2 | ปิด "รอเจ้าของ O2": สำรองอัตโนมัติต้องมีก่อนเปิดใช้แท็บเล็ตขายจริง · dayo ทำหลังยกเลิกการเลื่อน ADR-0051 · POS เขียนแผนเปิดใช้งาน · เปิดใช้หลังก้อน 3 | D86 · D94 · D95 | หัวเอกสาร · §8 · §9 ก้อน 1–2 · §13.6 S21 |
| O3 | ปิด "รอเจ้าของ O3": ดูกำไร = ปุ่มบนแท็บเล็ตเปิดหน้าเว็บ dayo (OTP/รหัส owner) · ลบกลไกรหัส 6 หลัก + `/profit-session` + `/profit` + `session_token` ออกจากสเปก · API ไม่มีกำไร/ต้นทุนเลย (ADR-0040 ข้อ 3 ไม่มีข้อยกเว้น) · ก้อน 4 เป็นร่าง ล็อกตอนเริ่มก้อน 4 | D87 · ADR-0055 · `0053_profit_view.sql` | หัวเอกสาร · §3 · §4.1 · §4.4 ข้อ 1 · §4.10 ก้อน 4 · §5.4 · §7 ข้อ 4, 10 · §9 ก้อน 4 · §12 Q45, Q54 · §13.6 S22 |
| B1 | ก้อน 3 ล็อกแล้ว พร้อมเขียนแผนสองแผน (dayo / POS) | D90 | §4.10 ก้อน 3 · §9 |
| C1 | **ยกเลิก** `pos_excluded_orders` · ชนิด `order_excluded` · ธง `excluded` ใน `pos_bills` · เหตุผล `ALREADY_PRESENT` · การตรวจกับ snapshot ของ Z · ข้อจำกัด "บิลของกะ `local_only` ส่งไม่ได้" → **แทนด้วยชนิด `order_off_catalog`** ที่สร้างบิลใน `orders` (`off_catalog=true` · ต้นทุน null · ไม่มี `order_items` · ไม่ตัดสต็อก · owner PIN + เหตุผล) · บิลนอกแคตตาล็อกอยู่ใน `pos_bills` ตามปกติ จึงไม่ต้องรอ `shift_close` และไม่ทำให้ค้าง `waiting_bills` · ชนกับบิลในฐาน = `CONFLICT` (ทั้งสองทิศ) | D91 · D97 · ADR-0056 คำถามข้อ 2 | §3 · §4.5 ข้อ 0 · ตารางเหตุผล · §4.10 ก้อน 3–4 · §6.1 · §6.4 · §9 ก้อน 3 |
| C2 | รายงาน: ยอดขายรวมบิลนอกแคตตาล็อก · กำไรขั้นต้น/สุทธิไม่รวม + บรรทัด "บิลไม่รู้ต้นทุน N ใบ · ยอด ฿X" · ห้ามถือต้นทุนเป็น 0 | D97 | §4.10 ก้อน 3–4 |
| C3 | **ช่องกะหนึ่งช่องต่อเครื่อง** (แทน "ช่องต่อกะ") และ **ไม่มี unique "กะ `open` ละหนึ่งต่อ key" ในฐาน** — เหตุ: ของเดิมขัดกันเอง ถ้ากะถัดไปเปิดตอนกะก่อนนับแล้วแต่แถว `cash_count` ยัง `deferred` แถว `shift_open` ใหม่จะชน unique ที่ดู "สถานะ ณ ตอนรับ" ซึ่งขัดกติกาที่ล็อกแล้วว่า "ตัดสินด้วยเวลาในแถว" · แท็บเล็ตยังบังคับกะเปิดละหนึ่งในเครื่อง (D47 ข้อ 6) · เว็บแสดง "กะซ้อนกัน" แทน | ADR-0056 คำถามข้อ 3 · §4.10 เดิม | §4.10 ก้อน 3 · §6.2 |
| C4 | `cash_counts` ไม่มี `expected`/`variance`/`reason` แล้ว (ย้ายไป `z_reports` และแถว `shift_close`) · นับปิดกะกะละครั้ง (unique `shift_id`) — เหตุ: นับได้ตอนออฟไลน์ แต่เงินที่ควรมีต้องรอบิลบอทตอนออก Z | D68 · Q15 | §4.10 ก้อน 3 |
| C5 | **ไม่มีเงินติดลบข้ามขอบ**: แท็บเล็ตส่งองค์ประกอบ `z_report.cash` (ไม่ติดลบ) + `counted` · dayo คิด `expected`/`variance` เอง (`edgeSatangToBaht` รับเฉพาะ ≥ 0 — §4.2 · `expected` อาจติดลบเมื่อจ่ายออกเกินเงินในลิ้นชัก D54 Q3b-14) | §4.2 · D54 | §4.10 ก้อน 3 |
| C6 | กะมีเฉพาะที่แท็บเล็ต · บอทไม่มีคำสั่งกะ · ขอ dayo แก้ ADR-0024 ข้อ 2 | D92 | §3 · §4.10 ก้อน 3 |
| C7 | เงินที่ควรมีและการคิดซ้ำยึด `pos_reported_amounts` (ยอดที่เก็บจริง) + คีย์ใหม่ `payment` (วิธีชำระตอนขาย) · การแก้บนเว็บแสดงเป็นบรรทัด "เจ้าของแก้บิลหลังขาย" ไม่เข้า Z ไม่ทำให้ `mismatch` · ขั้นตอนคิดซ้ำเขียนเป็น 6 ข้อ | D93 | §4.6 · §4.7 · §4.10 ก้อน 3 |
| C8 | แจ้ง Discord เมื่อ \|variance\| ≥ ฿20.00 และเมื่อเปลี่ยนเข้า `mismatch` · `waiting_bills` ไม่แจ้ง | D98 | §4.10 ก้อน 3 · §9 ก้อน 3 |
| C9 | หน้ารายละเอียดกะบนเว็บ dayo (owner อ่านอย่างเดียว) | D99 | §3 · §4.10 ก้อน 3 |
| C10 | `block3_live_from` ตั้งอัตโนมัติจาก `shift_open` แรกที่ `accepted` | D100 | §4.10 ก้อน 3 |
| C11 | ล็อกรูปฟิลด์ key และช่อง id ของ `shift_open` `cash_movement` `cash_count` `shift_close` (+ `z_report`) `order_off_catalog` · scope ต่อแถว `shift:write` · ลำดับตรวจแถวขยายจาก `0052_pos_push.sql:560-620` (ช่อง id ตามชนิด แทน `pos_order_id` ที่ตายตัวอยู่ตอนนี้) · `supported_fields` ต้องมี `lines.*` ของ `cash_count` (ตัวตรวจ `0052:587-591` ตรวจ `lines` ทุกชนิด) | ADR-0056 คำถามข้อ 3 | §4.5 ข้อ 6 · §4.10 ก้อน 3 |
| C12 | อ้างอิงที่ค้าง: D82 → D84 (§4.11) · กฎนาฬิกา "รอ D79" → D80 (§6.7) | D80 · D84 | §4.11 · §6.7 |
| C13 | บิลที่ปิด "นอกระบบกลาง" ในก้อน 2 (แผนก้อน 2 R8) คงเป็น `local_only` ไม่แปลง · ปุ่มในก้อน 3 เปลี่ยนเป็น "ปิดเป็นบิลนอกแคตตาล็อก" · แผนก้อน 3 ต้องถอด `ALREADY_PRESENT` ออกจาก `KNOWN_REJECT_REASONS` ของ contracts | D91 · D94 | §4.10 ก้อน 3 ข้อ 4 · §6.4 |

**แก้ตามรีวิวสเปกก้อน 3 (26 ก.ย. 2569 · 8 Important + 9 Minor)**

| # | เปลี่ยน | ที่ |
|---|---|---|
| R-I1 | แถวลูก `PARENT_REJECTED` กลับ `pending` เองเมื่อแถวแม่ที่แก้แล้วผ่าน · `FORBIDDEN` `scope:` = รอแบบ deferred จนเพิ่ม scope (ไม่ใช่บั๊ก) | §4.10 ลำดับ · §6.2 · §6.4 |
| R-I2 | การคิดซ้ำ: `receipt_no` ต่าง = ข้อสังเกตใน `recompute_detail` เท่านั้น · วิธีชำระเทียบแค่เงินสด/ไม่ใช่เงินสด · `CODE_REMAPPED` ห้ามสลับเงินสด ↔ ไม่ใช่เงินสด | §4.10 การคิดซ้ำข้อ 2, 7 · §6.4 |
| R-I3 | `after` ของ E4 = การนับก่อนหน้าในเครื่อง · dayo ตรวจแค่ `until = counted_at` และช่วงไม่ทับ Z อื่น · ช่องว่าง = "บิลบอทนอกใบปิดกะ" ไม่ใช่ mismatch | §4.10 E4 · การคิดซ้ำข้อ 4 |
| R-I4 | `z_report.movement_ids` · เงินเข้า-ออกที่ยังไม่มา = `waiting_bills` (ใช้สถานะเดิม ความหมาย "รอแถวมาครบ") + `missing_movement_ids` | §4.10 ตาราง · `z_report` · การคิดซ้ำข้อ 1, 3 · §6.4 |
| R-I5 | ล็อก `data` ของผลทุกชนิด · `order_off_catalog` คืน `{order_no, version}` จากตัวออกเลขเดียวกับ `create_order` · `shift_close` คืน `{shift_id, recompute_status}` (ไม่คืนเงินติดลบ) — **แทนด้วย R2-N4 (`{shift_id}` เท่านั้น)** | §4.10 กติการ่วม |
| R-I6 | คำนำหน้า `detail`: `exists:<order_no>` `receipt_taken:` `key_changed:` `counted:` · `scope:` `role:` `rule:` + ปุ่มต่อคำนำหน้า | §4.10 กติการ่วม · §6.4 |
| R-I7 | ขั้นตอนนับเงินปิดกะ (ออนไลน์/ออฟไลน์ · เวลา `counted_at` · หลังนับกะไม่รับบิล/เงินเข้าออก · ค่าในตารางนับในเครื่อง) — ส่วนที่กระทบ D52 **รอเจ้าของ Q70** | §6.8 · §4.10 `cash_count` |
| R-I8 | ทางตัน: (ก) `order_off_catalog` คิด `sale_date` จาก `sold_at` ไม่มีเพดาน 60 วัน (ใช้กับ `closed_at`) (ข) หลัก N5 ของแถวล้ำเวลา > 24 ชม. ใช้ต่อ + "ปิดไว้ในเครื่อง" (ค) `order_void` ที่ถูกปฏิเสธ → owner ยกเลิกบนเว็บ + ปิดไว้ในเครื่อง · ปุ่ม "ปิดไว้ในเครื่อง" ทั่วไป + ข้อจำกัด Z ค้าง `waiting_bills` | §4.10 `order_off_catalog` · §6.4 |
| R-m1 | แผน POS ขยาย `CashInputs`/`expectedCashSatang`/`ZInput` ด้วย `botCashSatang` `drawerExpensesSatang` + เทสต์ parity กับสูตร dayo | §4.10 สูตร dayo |
| R-m2 | `prev_hash` = `zReportHash` ของ Z ใบก่อนในเครื่อง (ใบแรก null) · `chain_warning` = `chainWarning !== null` | `z_report` |
| R-m3 | `order_off_catalog`: `items_discount + bill_discount ≤ items_subtotal` (`orders_discount_le_subtotal`) | `order_off_catalog.totals` |
| R-m4 | `pos_bills.payment` = รหัสวิธีชำระ dayo เดียวกับแถวบิล · บิล POS มีวิธีชำระเดียว | `z_report` |
| R-m5 | Discord ≥ ฿20.00 ตายตัว (D98) ต่างจากเหตุผลในเครื่อง > ค่าตั้งโดยตั้งใจ | §4.10 แจ้งเตือน |
| R-m6 | หัว §4.10: เวลาเซิร์ฟเวอร์ = `received_at` · `created_at` เป็นเวลาเครื่องเฉพาะที่ระบุ | §4.10 |
| R-m7 | E4 `created_by_name` null เมื่อไม่มี `staff:read` · `promo_discount_total = 0` ตรงกันทั้งสเปกและ P3 | §4.10 E4 · P3 |
| R-m8 | ขอ dayo แช่แข็ง `pos_shift_id` และ `external_ref` ของบิล POS ใน `orders_pos_frozen` | §4.10 ตาราง · P3 |
| R-m9 | ผลของบิลนอกแคตตาล็อก: `get_order.gross_profit` null · หน้าบิลแสดง "ไม่ทราบ" · จำนวนแก้วรวม qty จาก `off_catalog_lines` · E3 เพิ่ม `off_catalog` · GP% หารด้วยยอดขายที่รู้ต้นทุน | §4.10 `order_off_catalog` ข้อ 4 |
| R-m10 | แก้เลขบรรทัดอ้างใน P3: `0052_pos_push.sql:596-600` | P3 |

**แก้รอบ 2 (26 ก.ย. 2569 · รีวิวซ้ำ + รีวิวความปลอดภัย + คำตอบเจ้าของ D101–D102)**

| # | เปลี่ยน | ที่ |
|---|---|---|
| R2-D101 | ขั้นนับเงินออฟไลน์ล็อกตาม D101 (ปลดป้าย "รอ Q70") | §6.8 |
| R2-D102 | Discord แจ้งเมื่อ \|variance\| ≥ `z_report.variance_alert` (ค่าตั้งแท็บเล็ต · ส่งไปกับ Z) · แท็บเล็ตขอเหตุผลที่ ≥ เดียวกัน (`varianceNeedsReason` เปลี่ยน `>` → `≥`) · ลบข้อความ "ต่างกันโดยตั้งใจ" | `z_report` · §4.10 แจ้งเตือน · §6.8 |
| R2-N1+S1b | พื้นล่างของ `order_off_catalog`: `sold_at` ≥ max(`api_clients.created_at`, `block3_live_from`) ไม่งั้น `FORBIDDEN rule:` · ทางตัน (ก) ของ §6.4 ยังปิดได้ — **แทนด้วย R3-C (พื้นล่าง = `block3_live_from` อย่างเดียว)** | §4.10 `order_off_catalog` · §6.4 |
| R2-N2 | §4.5 ข้อ 0 ของแถว `order`: `key_changed:` ที่ (1) · `receipt_taken:` ที่ (ข) · ชนบิลนอกแคตตาล็อก = `off_catalog_exists:<order_no>` | §4.5 |
| R2-N3 | ข้อความ "ตรงกับ shift.ts" → "หลังขยายตาม R-m1" | §4.10 |
| R2-N4 | ผลของ `shift_close` = `{shift_id}` เท่านั้น (ผลเก็บใต้คีย์กันซ้ำ) | §4.10 กติการ่วม |
| R2-S1 | ฝั่งเซิร์ฟเวอร์บังคับบิลนอกแคตตาล็อก: ตาราง `pos_push_rejections` + `original_reason` ต้องตรง · พื้นล่าง `sold_at` · เพดาน `shop_settings.off_catalog_max_total` ค่าเริ่มต้น ฿3,000 (**รอ Q72**) · แจ้ง Discord ทุกใบ (นับใบ ไม่มียอด) + ป้ายแดชบอร์ด · แก้ขอบเขต key ใน §7 ข้อ 4 และ P3 | §4.10 ตาราง · `order_off_catalog` · §6.4 · §7 ข้อ 4 · P3 |
| R2-S2 | การคิดซ้ำตรวจจริง: รันคำค้น E4 ช่วงเดียวกันเทียบชุด `order_no` (แก้หลังนับ = ข้อสังเกต) · `after` = `until` ของ Z ใบก่อนของ key เดียวกัน (**แทนกติกา "ช่องว่างไม่ใช่ mismatch" ของรอบ 1** สำหรับ Z ติดกัน) · `movement_ids` ต้องเป็นของกะนี้/key นี้/ก่อน `counted_at` · `pos_bills` ต้องมี `pos_shift_id` = กะนี้ · `VOID_REFUND` ชี้บิลที่ยกเลิกของ key นี้ และรวมต่อบิล ≤ ยอดที่เก็บจริง · พลาดข้อใด = `mismatch` | §4.10 E4 · การคิดซ้ำ ข้อ 1–5 |
| R2-S3 | ตรวจแถวที่มีอยู่แล้วเสมอ (มีแต่ต่าง/เกิน = `mismatch` ทันที) · `waiting_since` + อายุการรอบนเว็บ · แจ้ง 48 ชม. **ขัด D98 → รอเจ้าของ Q74** (ยังไม่ทำ) | §4.10 การคิดซ้ำข้อ 1 · แจ้งเตือน · เว็บ · §6.4 |
| R2-S4 | หากะ/การนับ/เงินเข้าออก/Z ด้วย `(shop_id, api_client_id, id)` · แม่เป็นของ key อื่น = `FORBIDDEN rule:` · id เดิม = `duplicate` เฉพาะ key เดียวกัน | §4.10 กติการ่วม |
| R2-S5 | ข้อมูลกะชนกัน (`key_changed:`/`counted:` ของชนิดกะ · ยอดนับใน Z ไม่ตรงการนับในฐาน) → `audit_log` (แฮชทั้งสองชุด) + 🔴 Discord + `data_conflict` บนเว็บ · แท็บเล็ตแถบแดงแนะนำเปลี่ยนกุญแจ (ไม่ใช่ "บั๊ก → ส่งออก") · ตรวจโซ่ Z: `prev_hash` ≠ `hash` ของ Z ก่อนหน้าของ key = `chain_break` | §4.10 กติการ่วม · `z_report` · §6.4 |
| R2-S6 | สิทธิ์ D99: RPC `dashboard_shifts`/หน้ากะรับ `p_staff_id` raise `DY403` ถ้าไม่ใช่ owner · `today_mini` แค่เปิด/ปิด · ไม่มี API คืน Z/ส่วนต่าง · Export ข้อมูลกะเฉพาะ owner | §4.10 เว็บ |
| R2-S7 | ข้อความ Discord ไม่มียอดเงิน (ค่าเริ่มต้น **รอ Q73**) | §4.10 แจ้งเตือน |
| R2-m1 | `scope:` มาจากขั้นตรวจ scope ต่อชนิดเท่านั้น · dayo 🟡 วันละครั้งต่อ key · แท็บเล็ตแถบแดงหลัง 24 ชม. · หลัง 7 วัน "ปิดไว้ในเครื่อง" ได้ | §4.10 · §6.2 · §6.4 |
| R2-m2 | `exists:`/`off_catalog_exists:` มี `data` `{order_no, version, reported_total, payment_is_cash, off_catalog}` · แท็บเล็ตเทียบค่าแช่แข็ง ต่าง = แถบแดง | §4.10 · §6.4 |
| R2-m3 | ตัวแปลง `23505`: `order` ชนบิลนอกแคตตาล็อก / `order_off_catalog` ชนบิลปกติ / ชนิดกะหาใหม่ด้วย `(api_client_id, id)` | §4.10 กติการ่วม |
| R2-m4 | เพดาน `pos_bills` ≤ 2000 · `bot_bills` ≤ 500 · `movement_ids` ≤ 500 (เกิน = `INVALID`) · แจ้ง "กะซ้อนกัน" และ > 3 กะต่อ key ต่อวัน | §4.10 |
| R2-m5 | `block3_live_from` ตั้งเฉพาะเมื่อ `business_date` ≥ วันนี้ − 1 · owner รีเซ็ตบนเว็บได้พร้อม audit | §4.10 ตาราง · `shift_open` |
| R2-m6 | owner ใน `closed_by`/`quick_open` ต้อง active ณ เวลาในแถว | §4.10 |
| R2-m7 | หน้ากะแสดง "เปลี่ยนจากเงินสดก่อนนับ" จาก `audit_log` | §4.10 E4 · เว็บ |

**แก้รอบ 3 (26 ก.ย. 2569 · ปัญหาใหม่ในส่วนที่เพิ่มรอบ 2)**

| # | เปลี่ยน | ที่ |
|---|---|---|
| R3-A | ลำดับการคิดซ้ำ: ตรวจรายแถว (ข้อ 2 · 3 · ชุดบิลบอท · `bot_window` · โซ่ Z) ทำเสมอ · เทียบผลรวมกับ `z_report.cash` เฉพาะเมื่อไม่มีอะไรขาด · `VOID_REFUND` ที่รอ `order_void` อยู่ในช่อง `missing_void_order_ids` · เกณฑ์ §9: Z มาก่อนบิล = `waiting_bills` ไม่ mismatch | §4.10 ตาราง `z_reports` · การคิดซ้ำ · §9 |
| R3-B | unique `(api_client_id, z_no)` · `z_no` ซ้ำ = `CONFLICT z_no_taken:` + S5 · "Z ใบก่อน" = เลขมากสุดที่น้อยกว่า · ยกเว้นใบแรกเฉพาะเมื่อ key ไม่มี Z ในฐานตอนรับ · ใบก่อนขาดช่วง = ข้อสังเกต (ไม่ mismatch ไม่ chain_break · `after` ตรวจเฉพาะเมื่อใบก่อนเลข = นี้ − 1) · เลข ≤ สูงสุด: รับเป็นการเติมช่องเมื่อเลขว่างและ `counted_at` อยู่ระหว่างใบข้างเคียง ไม่งั้น `mismatch` + `chain_break` · รับ `shift_close` แล้วคิดซ้ำ Z `z_no` + 1 · เกณฑ์ §9 ครบสามกรณี | §4.10 `z_report` · กติกาลำดับ `z_no` · E4 · การคิดซ้ำข้อ 6 · §9 |
| R3-C | `pos_push_rejections` เก็บทุกเหตุผล (แถวละ `(api_client_id, pos_order_id, reason)`) · `original_reason` = เหตุผลใดก็ได้ที่เคยบันทึก · หาด้วย `(shop_id, pos_order_id)` ข้ามทุก key POS ของร้าน · พื้นล่าง = `block3_live_from` อย่างเดียว (ตัด `api_clients.created_at`) · owner แก้ `block3_live_from` บนเว็บได้เฉพาะเป็นวันที่เก่ากว่า (แก้ m5) · ข้อความ (4)(ก), §7 ข้อ 4 และ P3 เขียนใหม่: (ก) แค่ผูกบิลกับแถวที่ส่งมาจริง ไม่ใช่ด่านกัน key หลุด · ด่านจริง = พื้นล่าง + เพดาน + แจ้งทุกใบ | §4.10 ตาราง · `order_off_catalog` · §6.4 · §7 ข้อ 4 · P3 |
| R3-m1 | §6.4 (ค): Z ค้าง "รอ" จนเจ้าของยกเลิกบิลบนเว็บ · การยกเลิกบนเว็บทำให้คิดซ้ำ | §6.4 · การคิดซ้ำข้อ 6 |
| R3-m2 | บิลบอทที่ไม่ถูกแก้หลัง `counted_at` ต้องมี `total` = `total_amount` ปัจจุบัน ไม่งั้น `mismatch` | การคิดซ้ำข้อ 4 |
| R3-m4 | แท็บเล็ตอ่าน `order_no` จาก `data.order_no` เท่านั้น ห้ามแยกจาก `detail` | §4.10 คำนำหน้า |
| R3-m5 | เกณฑ์ §9 "order เกิน 60 วันปิดเป็นนอกแคตตาล็อก" ต้องตั้ง `block3_live_from` เก่ากว่า 60 วันใน fixture | §9 |
| R3-m6 | P3 "ผลที่ตามมา" = 5 ตารางรวม `pos_push_rejections` | P3 |
| R3-m7 | `audit_log` ของ S5 เขียนนอก savepoint ของแถว · `data_conflict` ย้ายไป `shifts` | §4.10 ตาราง · คำนำหน้า |
| R3-m8 | หน้ากะแสดงเกณฑ์ที่ใช้ และติดป้ายเมื่อต่างจาก Z ใบก่อนของ key | §4.10 เว็บ |
| R3-m9 | `VOID_REFUND` รอได้ แต่: บิลอยู่ใน `pos_bills` ของ Z เดียวกันโดย `voided_at` null = ต่างทันที · บิลของ key อื่น (อุปกรณ์/ร้านอื่น) = ต่างทันที · เว็บแสดงเหตุผลการรอ "เงินคืนของบิลที่ยังไม่ถูกยกเลิก <ใบเสร็จ>" + อายุ (นับรวมกับการแจ้งที่รอ Q74) | การคิดซ้ำข้อ 1, 3 · §9 |

**แก้รอบ 4 (26 ก.ย. 2569)**

| # | เปลี่ยน | ที่ |
|---|---|---|
| R4-1 | E1 `client` เพิ่ม `last_z_no`/`last_z_hash` (จาก Z เลขสูงสุดของ key) · ตั้งเครื่องใหม่/เชื่อมใหม่ต่อเลข Z และโซ่จากค่านี้แบบ `last_receipt_no` · เกณฑ์ §9 | §4.4 ข้อ 6 + ตัวอย่าง · §6.6 · §9 |
| R4-2 | `order_off_catalog` (และ `order` ก้อน 3) หาบิลด้วย `(shop_id, pos_order_id)` ข้าม key: บิลปกติ key ใดก็ได้ = `CONFLICT exists:` + `data` · บิลนอกแคตตาล็อกของ key อื่น = `CONFLICT off_catalog_exists:` ไม่ใช่ `duplicate` · ขอ dayo เปลี่ยน unique index `orders` จาก `(api_client_id, pos_order_id)` เป็น `(shop_id, pos_order_id)` (migration ใหม่ทับ index ที่ ship แล้ว) · ตัวแปลง `23505` ตาม · เกณฑ์ §9 (ครอบ reviewer-m3 ด้วย) | §4.5 ข้อ 0 · §4.10 ตาราง `orders` · กติการ่วม · `order_off_catalog` ข้อ 0 · §9 · P3 |
| R4-m | "ข้อยกเว้นเดียว" → "ข้อยกเว้นของ Z ใบแรก" · ข้อ 1 (เลขถูกใช้แล้ว) ตรวจก่อนข้อ 5 (เติมช่อง) · M-a: Z ขาดช่วงเทียบ `after` กับ `counted_at` ของการนับล่าสุดของ key ก่อนใบนี้ (เท่า = ผ่าน · ไม่เท่าและช่วงนั้นมีบิลเงินสดบอท = `mismatch` · ไม่มีบิล = ข้อสังเกต) · M-b: `z_no` > สูงสุด + 50 = `INVALID` + แจ้ง S5 | กติกาลำดับ `z_no` ข้อ 0, 1, 2, 4, 5 · E4 · §9 |
