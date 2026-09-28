# ขึ้นระบบแอปแท็บเล็ต POS (D107)

> คู่มือสำหรับเจ้าของ · agent ไม่มีสิทธิ์เข้าบัญชี Cloudflare/GitHub และไม่เห็นค่าลับ (กฎเหล็กข้อ 7) — ทุกขั้นที่มี ⛔ เจ้าของทำเอง
> รูปแบบเดียวกับ `dayo-shop-system` (`docs/SETUP.md` ส่วน 6–7 และ 8.5): Cloudflare **Workers Builds** ต่อกับ GitHub · push เข้า `main` = build + test + deploy เอง · แจ้ง 🚀/❌ เข้าห้อง Discord `#dayo-ระบบ` ห้องเดียวกับ dayo

## ภาพรวม
| อะไร | ที่ไหน |
|---|---|
| แอปแท็บเล็ต (PWA ไฟล์นิ่งล้วน) | Worker `dayo-pos` แบบ static assets เท่านั้น (`apps/pos/wrangler.jsonc`) → `https://dayo-pos.<ชื่อบัญชี>.workers.dev` |
| ตรวจก่อน deploy | `pnpm release:build` = typecheck + test + build ของ `@dayo/pos` และแพ็กเกจที่มันใช้ |
| deploy | `pnpm release:deploy` = `wrangler deploy` ไฟล์ใน `apps/pos/dist` |
| CI (GitHub Actions) | `.github/workflows/ci.yml` — unit + e2e ทุก PR และทุก push เข้า `main` (repo นี้ public = นาที Actions ฟรีไม่จำกัด) |
| ข้อมูลร้าน | ไม่อยู่ที่ Cloudflare เลย — อยู่ในแท็บเล็ต (OPFS) และส่งขึ้น dayo `/api/v1` |

**ทำไมไม่ใช่ Cloudflare Pages (D48 เดิม):** dayo ใช้ Workers Builds อยู่แล้ว ใช้แบบเดียวกันดูแลที่เดียว · Worker ที่ไม่มีโค้ด (มีแต่ไฟล์นิ่ง) ไม่นับเข้าโควตา 100,000 คำขอ/วันที่ใช้ร่วมกับ `dayo-web`/`dayo-line-bot` (คำขอไฟล์นิ่งฟรีไม่จำกัด)

## ครั้งแรก (⛔ เจ้าของทำ · ประมาณ 15 นาที)
ใช้บัญชี Cloudflare **เดียวกับ dayo** (ไม่ต้องสมัครใหม่ · ได้ subdomain `workers.dev` เดียวกัน)

1. ⛔ Cloudflare → **Workers & Pages → Create application → Import a repository** → Connect GitHub → เพิ่มสิทธิ์ repo `pos-management`
2. ⛔ ตั้งค่า (วางตามนี้ทุกตัวอักษร):

   | ช่อง | ค่า |
   |---|---|
   | Project name | `dayo-pos` (**ต้องตรง** `name` ใน `apps/pos/wrangler.jsonc`) |
   | Root directory | `apps/pos` |
   | Build command | `cd ../.. && pnpm install --frozen-lockfile && pnpm release:build` |
   | Deploy command | `cd ../.. && pnpm release:deploy` |
   | Production branch | `main` |
   | Build watch paths | `apps/pos/**`, `packages/**`, `pnpm-lock.yaml` |
   | Builds for non-production branches | **ปิด** (ประหยัดนาที build ที่ใช้ร่วมกับ dayo — PR ตรวจที่ GitHub Actions อยู่แล้ว) |

3. ⛔ **Settings → Build → Variables and secrets** → Add → `DISCORD_ALERT_WEBHOOK_URL` = URL ห้อง `#dayo-ระบบ` (ค่าเดียวกับของ `dayo-web`) · Type **Secret** · ไม่ใส่ = deploy ได้ปกติแต่ไม่แจ้ง
4. ⛔ **Save and Deploy** → รอเขียว → เปิด URL ต้องเห็นหน้าตั้งค่าเครื่องของ DA-YO POS → จด URL ไว้ (ต่อจากนี้เรียก *origin ของ POS* เช่น `https://dayo-pos.xxxx.workers.dev` ไม่มี `/` ท้าย)
5. ⛔ ที่ dayo: Worker **`dayo-web`** → Settings → Variables and Secrets → `POS_ORIGINS` = origin ของ POS จากข้อ 4 (มีหลายค่าคั่นตามที่ dayo `docs/SETUP.md` ส่วน 8.3 บอก) → **Deploy** — ไม่ตั้ง = แท็บเล็ตเรียก `/api/v1` ไม่ได้ (CORS)
6. ⛔ ทำ dayo `docs/SETUP.md` **ส่วน 17** (สร้าง API key พร้อม QR · เงื่อนไขก่อนตั้ง `API_V1_ENABLED=1`)
7. บนแท็บเล็ต: เปิด origin ของ POS ใน Chrome → เมนู ⋮ → **ติดตั้งแอป** → เปิดจากไอคอน → หน้าตั้งค่า ใส่ที่อยู่ dayo + สแกน QR คีย์

## ตรวจว่ากำลังใช้ version ไหน
- ในแอป: มุมขวาบนของแถบแบรนด์ (ทุกจอ) โชว์ย่อ `vX.Y.Z · commit` · หน้า **สถานะระบบ** (`/status`) โชว์เต็ม (version, commit, เวลา build)
- จาก URL (ไม่ต้องเปิดแอป): `https://<origin ของ POS>/version.json` — ไม่ถูกแคช อัปเดตทุก deploy
- **commit ระบุ deploy ที่แน่นอนเสมอ แม้ไม่ได้ขึ้น version ใหม่** — สอง deploy ที่ version เดียวกัน (เช่นแก้บั๊กเล็กแล้ว push โดยไม่ bump) จะแยกกันได้ด้วย commit เท่านั้น

## ขึ้น version ใหม่ก่อน release
1. ⛔/ปกติ ที่ root: `pnpm release:version patch|minor|major` (patch = แก้บั๊ก, minor = ฟีเจอร์ใหม่ที่เข้ากันได้, major = เปลี่ยนที่กระทบผู้ใช้มาก) → แก้แค่ `apps/pos/package.json` เท่านั้น ไม่แตะ git
2. ตรวจ diff แล้ว commit ตามปกติ (กฎเหล็กข้อ 9) → push/merge เข้า `main` ตามขั้นตอนเดิม
3. ไม่ bump ก็ deploy ได้เหมือนกัน — commit hash ยังบอกได้ว่าเป็นรุ่นไหน แค่ตัวเลข version จะซ้ำกับรุ่นก่อน

## ทุกครั้งหลังจากนี้
- merge เข้า `main` (กฎเหล็กข้อ 10) → Cloudflare build + deploy เอง → ห้อง `#dayo-ระบบ` ได้ 🚀 **DEPLOY · POS v…** หรือ ❌ **DEPLOY FAILED** + @here (ระบบยังรันรุ่นเดิม ไม่กระทบร้าน)
- แท็บเล็ตได้รุ่นใหม่เองตอนเปิดแอปครั้งถัดไปที่มีเน็ต (service worker `autoUpdate`) · ไม่ต้องติดตั้งใหม่ · ข้อมูลในเครื่องไม่หาย
- แก้แค่ `docs/**` → ไม่ build (watch paths)
- ย้อนรุ่นด่วน: Cloudflare → `dayo-pos` → **Deployments** → รุ่นก่อนหน้า → **Rollback** (ไม่ต้องแก้โค้ด)

## โควตาฟรีที่เกี่ยวข้อง (ตรวจ 28 ก.ย. 2026)
| บริการ | โควตาฟรี | POS ใช้ | หมายเหตุ |
|---|---|---|---|
| Workers คำขอ | 100,000/วัน **รวมทั้งบัญชี** | 0 (ไฟล์นิ่งไม่นับ) | แต่คำขอที่แท็บเล็ตยิงไป `dayo-web` `/api/v1` **นับ** ในโควตาของ dayo |
| Workers static assets | 20,000 ไฟล์/รุ่น · 25 MiB/ไฟล์ | 19 ไฟล์ · ใหญ่สุดคือ sqlite wasm | |
| Workers Builds | 3,000 นาที/เดือน · build ได้ **ครั้งละ 1** ทั้งบัญชี · หมดเวลา 20 นาที | ~2–3 นาที/ครั้ง | ใช้ร่วมกับ `dayo-web`/`dayo-line-bot`/`dayo-customer-bot` — push พร้อมกันจะเข้าคิว |
| GitHub Actions | public repo ไม่จำกัด | CI + e2e | ถ้าเปลี่ยน repo เป็น private = 2,000 นาที/เดือน **ใช้ร่วมกับ dayo** |
