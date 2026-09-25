# CLAUDE.md — DA-YO POS

> Claude Code อ่านไฟล์นี้ทุกครั้งที่เปิดโปรเจกต์
> การตัดสินใจทั้งหมด: `docs/design/00-บันทึกการตัดสินใจ.md` · สถาปัตยกรรมกับระบบ LINE: `docs/design/03-*`, สเปกการเชื่อมระบบ: `docs/design/04-*` · ทีม agent: `docs/design/05-ทีม-agent-และ-workflow.md` · แผนงาน: `docs/superpowers/plans/`

## ระบบนี้คืออะไร
แอปขายหน้าร้านบนแท็บเล็ต (PWA ออฟไลน์ได้) ของร้าน **DA-YO** ร้านเครื่องดื่มที่เจ้าของทำเองสองคน · ใช้ **ฐานข้อมูลกลางเดียวกับ dayo-shop-system** (Supabase ของระบบ LINE — สถาปัตยกรรม C1) · POS เป็นเครื่องมือเรื่อง **เงินและการบริหารร้าน**: ขาย, กะ/เงินสด/ใบปิดกะ, ค่าใช้จ่าย, ตอกบัตร/เงินเดือน · เมนู สูตร ราคา โปร พนักงาน และสต็อก แก้ที่เว็บของระบบ LINE

| ส่วน | อยู่ที่ | ทำอะไร |
|---|---|---|
| แอปแท็บเล็ต | `apps/pos` | React PWA · SQLite WASM (OPFS) เก็บข้อมูลในเครื่อง · outbox ส่งขึ้น `/api/v1` ของ dayo |
| ตรรกะเงิน | `packages/domain` | สตางค์จำนวนเต็ม · ต้องได้ราคาตรงกับ `@dayo/shared` ทุกสตางค์ |
| สัญญาข้อมูล | `packages/contracts` | zod schema ของข้อมูลที่รับส่งกับ dayo |
| ฐานในเครื่อง | `packages/db-schema` | migration ของ SQLite ในแท็บเล็ต |
| นำเข้า Excel | `packages/excel-import` | ตัวอ่าน `DA-YO_เมนู.xlsx` จากแผน 1 (ใช้อ้างอิงและเทียบตัวเลข) |
| ระบบ LINE (นอก repo) | `D:\TungAo-Project\line-bot\dayo-shop-system` | **อ่านอย่างเดียว** · แก้ใน session ของ repo นั้นเท่านั้น |

## คำสั่ง (รันที่ root · Node 22 · pnpm)
```bash
pnpm install
pnpm turbo run typecheck · pnpm turbo run test      # ต้องผ่านทั้ง repo ก่อน merge
pnpm --filter @dayo/domain test                      # รายแพ็กเกจ: @dayo/pos, @dayo/contracts, @dayo/db-schema, @dayo/excel-import
pnpm --filter @dayo/pos e2e                          # Playwright
```

## กฎเหล็ก
1. **การตัดสินใจที่บันทึกแล้ว (D1…) ห้ามเปลี่ยนเงียบ ๆ** — ขัดกันให้หยุดถามเจ้าของ แล้วบันทึก D ใหม่ · ADR ของ dayo ห้ามแตะ ให้ร่างเป็นเอกสารใน `docs/design/dayo-adr-drafts/`
2. **เงินเป็นสตางค์จำนวนเต็มในแท็บเล็ต** · แปลงเป็นบาทที่ขอบ contract จุดเดียว · สูตรเงินอยู่ใน `@dayo/domain` เท่านั้น · ราคาต้องเท่ากับของ dayo (parity test บังคับ)
3. **ข้อมูลแต่ละอย่างมีผู้เขียนคนเดียว ห้าม sync สองทาง** · เมนู/ราคา/พนักงาน ดึงอย่างเดียว · บิล/กะ/เงินสด/ค่าใช้จ่าย/ตอกบัตร ส่งอย่างเดียว · ทุกแถวมี UUID ที่เครื่องสร้างเป็นคีย์กันซ้ำ
4. **ค่าที่บันทึกแล้วแช่แข็ง** · ledger และ order_event append-only · ห้ามลบบิล · hash chain อยู่บนแท็บเล็ต
5. **ออฟไลน์ก่อน** — เขียนลงเครื่องก่อนเสมอ · แถวเดียวห้ามทำให้คิวค้างทั้งก้อน · วัดขนาดเป็นไบต์ UTF-8
6. **ทุกบิลบอกได้ว่าบันทึกที่ไหน โดยใคร**
7. **Agent ไม่มีสิทธิ์เข้าบัญชีโฮสต์และไม่เห็นค่าลับ** — เจ้าของเปิดบัญชีและถือค่าลับเอง · ห้ามอ่าน `.env*` ของทั้งสอง repo · ฟรีเท่านั้น ไม่ผูกบัตร
8. **ห้าม `git checkout -- <ไฟล์>` / `git reset --hard` เพื่อย้อนงาน** — สำรองไว้นอก repo ก่อน · ผู้ตรวจที่ลองแก้โค้ดต้องคืนค่าเดิมและลบไฟล์ probe
9. **Commit**: ใช้ skill `committing-code` ทุกครั้ง · ไม่มี `Co-Authored-By` หรือบรรทัดระบุ AI · stage เป็นชื่อไฟล์ ห้าม `git add -A` · ห้าม commit `.superpowers/`, `.claude/` · `docs/**` commit ได้ในโปรเจกต์นี้
10. **Merge เข้า main แบบ `--no-ff` หลังผ่านการตรวจทั้งสายเท่านั้น** แล้ว push ได้ (เจ้าของอนุญาตแล้ว)
11. การทดสอบบนแท็บเล็ตจริงเก็บไว้ท้ายสุด (D51)
12. คุยกับเจ้าของเป็น **ภาษาไทย** · รายงานและการตัดสินใจเขียนลง `docs/` · ในแชทมีแค่คำถาม (มีเลขข้อ + คำตอบที่แนะนำ)

## ทีม agent (`docs/design/05-ทีม-agent-และ-workflow.md`)
architect (opus) เขียนแผน → หัวหน้าแบ่งสาย (worktree ละสาย, สูงสุด 4 agent) → domain-engineer / sync-engineer (opus) · pos-ui-developer (sonnet) → test-runner (haiku) → code-reviewer (sonnet) + security-reviewer (opus) → docs-writer (sonnet) → ตรวจทั้งสาย → merge
