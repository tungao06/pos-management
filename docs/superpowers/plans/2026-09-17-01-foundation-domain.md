# แผน 1: Foundation + Domain + Excel Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้าง monorepo, แพ็กเกจ `domain` ที่มีตรรกะเงิน/สต็อก/ต้นทุน/แฮชครบตาม spec §4 พร้อม property test, แพ็กเกจ `contracts`, และตัวนำเข้า `DA-YO_เมนู.xlsx` ที่ผ่าน golden test 360 สูตร

**Architecture:** pnpm workspaces + Turborepo · `packages/domain` เป็น TypeScript ล้วน ไม่มี I/O ใช้ได้ทั้งเบราว์เซอร์และ Node · `packages/contracts` ถือ enum และ Zod schema ที่ทุกแพ็กเกจใช้ร่วม · `packages/excel-import` อ่าน xlsx ด้วย exceljs แล้วผลิต `seed.json` ที่ผ่าน `SeedSchema` · golden test คำนวณต้นทุนต่อแก้วด้วย `domain` แล้วเทียบกับคอลัมน์ต้นทุนใน Excel

**Tech Stack:** Node 22 LTS · pnpm 10 · Turborepo 2 · TypeScript 5.9 (strict) · Vitest 5 · fast-check 4 · Zod 4 · @noble/hashes 2 · exceljs 4

**Spec:** [../specs/2026-09-17-pos-design.md](../specs/2026-09-17-pos-design.md) §2.1, §3 (ชนิดข้อมูล), §4 ทั้งหมด, §8, §9 · ข้อมูล Excel: [../../research/09-เมนูและสูตรจากไฟล์ร้าน.md](../../research/09-เมนูและสูตรจากไฟล์ร้าน.md)

## Global Constraints

- เงินเป็น **สตางค์** (integer) · ปริมาณเป็น **milli** = 1/1000 ของหน่วยใช้ (1 ml = 1000, 1 g = 1000, 1 ชิ้น = 1000) · ต้นทุนต่อหน่วยใช้เป็น **usat** = micro-satang (1 บาท = 100,000,000 usat) (D33) · การคูณปริมาณ×ต้นทุนใช้ BigInt เสมอ
- ปัดเศษแบบ half-away-from-zero ทุกที่ (`roundDivBig`)
- `packages/domain` **ห้าม import** อะไรที่เป็น Node-only (`node:*`, fs, crypto) — ใช้ `@noble/hashes` สำหรับ SHA-256
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, ESM (`"type": "module"`), `moduleResolution: "bundler"`
- **pin `typescript@~5.9`** (npm latest คือ 7.x ซึ่งเป็น native port ใหม่ ยังไม่ใช้กับ tooling นี้) · แพ็กเกจอื่นใช้เวอร์ชันล่าสุด ณ วันติดตั้ง: drizzle-orm ≥ 0.45, zod ≥ 4.6, vitest ≥ 5, fast-check ≥ 4.10, exceljs ≥ 4.4, @noble/hashes ≥ 2.4
- รหัสอ้างอิงจาก Excel (product code เช่น `Original`, item code เช่น `RM-TEA-01`) ต้องคงตัวสะกดเดิม 100%
- ไฟล์ Excel ต้นฉบับ: `C:\Users\chaya\OneDrive\Documents\DAYO\DA-YO_เมนู.xlsx` → คัดลอกเป็น fixture `packages/excel-import/fixtures/DA-YO_เมนู.xlsx` (repo ส่วนตัว เก็บได้)
- **commit:** ใช้ skill `committing-code` ทุกครั้ง · **ห้ามใส่** `Co-Authored-By: Claude…` หรือ trailer ของ AI ใด ๆ · stage เฉพาะไฟล์ที่ระบุชื่อ · เอกสาร `docs/**` ของโปรเจกต์นี้ commit ได้ (ข้อยกเว้นเฉพาะโปรเจกต์นี้ — D45)
- เครื่องพัฒนาเป็น Windows 11 + Git Bash · ใช้ `nvm install 22 && nvm use 22` และ `corepack enable pnpm` ก่อนเริ่ม

---

## File Structure

```
pos-management/
├── package.json                 workspace root: scripts test/typecheck/lint ผ่าน turbo
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json           strict options ที่ทุกแพ็กเกจ extends
├── .nvmrc                       22
├── .gitignore
├── .github/workflows/ci.yml     typecheck + test ทุก push
└── packages/
    ├── domain/
    │   ├── package.json  tsconfig.json  vitest.config.ts
    │   ├── src/
    │   │   ├── index.ts                 re-export ทุกอย่าง
    │   │   ├── money.ts                 หน่วยเงิน/ปริมาณ, roundDivBig, costSatang, splitLargestRemainder
    │   │   ├── pricing.ts               priceFor, computeTotals (VAT พร้อมแต่ปิด)
    │   │   ├── receipt.ts               formatReceiptNo / parseReceiptNo
    │   │   ├── hash.ts                  canonicalJson, sha256Hex, computeEventHash, verifyChain
    │   │   ├── stock/catalog.ts         ชนิด CatalogItem/Bom/Catalog + standardUnitCostUsat
    │   │   ├── stock/explode.ts         explodeNeeds (กฎ §4.2)
    │   │   ├── stock/movements.ts       MovementDraft, saleMovements, voidReturnMovements, lineCostSatang
    │   │   ├── stock/costing.ts         CostState, applyMovement, rebuildCostState, productionMovements
    │   │   ├── stock/count.ts           countLineResult, countAdjustmentMovements
    │   │   └── shift.ts                 expectedCashSatang, buildZReport
    │   └── test/                        1 ไฟล์เทสต์ต่อ 1 โมดูล ชื่อเดียวกัน (.test.ts) + test/arb.ts (fast-check arbitraries)
    ├── contracts/
    │   ├── package.json  tsconfig.json  vitest.config.ts
    │   ├── src/index.ts   src/enums.ts   src/seed.ts
    │   └── test/seed.test.ts
    └── excel-import/
        ├── package.json  tsconfig.json  vitest.config.ts
        ├── fixtures/DA-YO_เมนู.xlsx
        ├── src/
        │   ├── cells.ts                 helper อ่านค่า cell ของ exceljs (formula result / richText)
        │   ├── constants.ts             ขนาด ความหวาน ช่องทาง หมวด alias ชื่อวัตถุดิบ→รหัส อายุเบส ของไม่นับสต็อก
        │   ├── parse-items.ts           ชีต สินค้าและสต็อก → items + purchaseUnits
        │   ├── parse-boms.ts            ชีต ต้นทุนเบส → prepared/packaging items + boms
        │   ├── parse-products.ts        ชีต ต้นทุนและราคา + SOP วิธีชง → products, variants, prices
        │   ├── parse-recipes.ts         ชีต ข้อมูลสูตร → recipes (360) + excelCostSatang
        │   ├── parse-equipment.ts       ชีต ทะเบียนอุปกรณ์
        │   ├── build-seed.ts            รวมทุกอย่าง + validate ด้วย SeedSchema
        │   └── cli.ts                   `pnpm --filter excel-import run import <xlsx> <out.json>`
        ├── seed/dayo-seed.json          ผลลัพธ์ (commit ไว้ ใช้ในแผน 2)
        └── test/                        parse-*.test.ts, build-seed.test.ts, golden.test.ts
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc`, `.gitignore`, `.github/workflows/ci.yml`
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/vitest.config.ts`, `packages/domain/src/index.ts`, `packages/domain/test/smoke.test.ts`

**Interfaces:**
- Produces: คำสั่ง `pnpm test`, `pnpm typecheck` ที่รันทุกแพ็กเกจผ่าน turbo · แพ็กเกจชื่อ `@dayo/domain`

- [ ] **Step 1: เตรียม Node/pnpm**

Run (Git Bash):
```bash
nvm install 22 && nvm use 22 && corepack enable pnpm && node -v && pnpm -v
```
Expected: `v22.x.x` และ pnpm `10.x`

- [ ] **Step 2: สร้างไฟล์ root**

`package.json`
```json
{
  "name": "dayo-pos",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.0.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "build": "turbo run build"
  },
  "devDependencies": {
    "turbo": "^2.10.0",
    "typescript": "~5.9.0"
  }
}
```
(แก้ `packageManager` ให้ตรงกับ `pnpm -v` ที่ได้จริง)

`pnpm-workspace.yaml`
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`turbo.json`
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

`tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`.nvmrc`
```
22
```

`.gitignore`
```
node_modules/
dist/
.turbo/
coverage/
*.log
.env
.env.*
```

`.github/workflows/ci.yml`
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 3: สร้างแพ็กเกจ domain ว่าง ๆ พร้อมเทสต์ smoke**

`packages/domain/package.json`
```json
{
  "name": "@dayo/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@noble/hashes": "^2.4.0"
  },
  "devDependencies": {
    "fast-check": "^4.10.0",
    "typescript": "~5.9.0",
    "vitest": "^5.0.0"
  }
}
```

`packages/domain/tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": [] },
  "include": ["src", "test"]
}
```

`packages/domain/vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
```

`packages/domain/src/index.ts`
```ts
export const DOMAIN_VERSION = 1
```

`packages/domain/test/smoke.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { DOMAIN_VERSION } from '../src/index.js'

describe('domain package', () => {
  it('loads', () => {
    expect(DOMAIN_VERSION).toBe(1)
  })
})
```

- [ ] **Step 4: ติดตั้งและรัน**

Run:
```bash
pnpm install && pnpm typecheck && pnpm test
```
Expected: turbo รัน `@dayo/domain#typecheck` และ `#test` ผ่าน · 1 test passed

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json .nvmrc .gitignore .github packages/domain
git commit -m "chore: scaffold pnpm+turbo monorepo with domain package"
```

---

### Task 2: money.ts — หน่วยเงิน ปริมาณ และการปัดเศษ

**Files:**
- Create: `packages/domain/src/money.ts`, `packages/domain/test/money.test.ts`, `packages/domain/test/arb.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces:
  - `USAT_PER_BAHT = 100_000_000`, `USAT_PER_SATANG = 1_000_000`, `MILLI = 1_000`
  - `assertSafeInt(n: number, name: string): void`
  - `bahtToSatang(baht: number): number`, `bahtToUsat(baht: number): number`
  - `roundDivBig(num: bigint, den: bigint): bigint` — half away from zero
  - `roundDiv(num: number, den: number): number`
  - `costSatang(qtyMilli: number, unitCostUsat: number): number` = round(qty × cost / 1e9)
  - `splitLargestRemainder(total: number, weights: number[]): number[]` — ผลรวม = total เสมอ

- [ ] **Step 1: เขียน arbitraries กลางสำหรับ fast-check**

`packages/domain/test/arb.ts`
```ts
import fc from 'fast-check'

export const satangArb = fc.integer({ min: 0, max: 10_000_000 })          // ถึง 100,000 บาท
export const qtyArb = fc.integer({ min: 1, max: 99 })
export const milliArb = fc.integer({ min: 1, max: 5_000_000 })            // ถึง 5,000 หน่วย
export const usatArb = fc.integer({ min: 0, max: 2_000_000_000 })          // ถึง 20 บาท/หน่วย
export const isoDateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2035-12-31'), noInvalidDate: true }).map((d) => d.toISOString())
export const idArb = fc.uuid()
```

- [ ] **Step 2: เขียนเทสต์ให้ตก**

`packages/domain/test/money.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { bahtToSatang, bahtToUsat, costSatang, roundDiv, roundDivBig, splitLargestRemainder } from '../src/money.js'
import { milliArb, satangArb, usatArb } from './arb.js'

describe('roundDivBig', () => {
  it('rounds half away from zero', () => {
    expect(roundDivBig(5n, 2n)).toBe(3n)
    expect(roundDivBig(-5n, 2n)).toBe(-3n)
    expect(roundDivBig(4n, 2n)).toBe(2n)
    expect(roundDivBig(7n, 3n)).toBe(2n)
    expect(roundDivBig(0n, 3n)).toBe(0n)
  })
  it('throws on zero denominator', () => {
    expect(() => roundDivBig(1n, 0n)).toThrow(RangeError)
  })
  it('matches Math.round for positive numbers', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 1, max: 1e6 }), (a, b) => {
      expect(roundDiv(a, b)).toBe(Math.round(a / b))
    }))
  })
})

describe('baht conversions', () => {
  it('converts prices from the Excel file exactly', () => {
    expect(bahtToSatang(45)).toBe(4500)
    expect(bahtToSatang(69)).toBe(6900)
    expect(bahtToUsat(0.019925)).toBe(1_992_500)
    expect(bahtToUsat(77 / 400)).toBe(19_250_000)
    expect(bahtToUsat(4.4)).toBe(440_000_000)
  })
})

describe('costSatang', () => {
  it('computes cost of 130 ml Thai tea base at 0.019925 baht/ml = 2.59 baht', () => {
    expect(costSatang(130_000, 1_992_500)).toBe(259)
  })
  it('is zero for zero quantity or zero cost', () => {
    expect(costSatang(0, 1_992_500)).toBe(0)
    expect(costSatang(130_000, 0)).toBe(0)
  })
  it('never loses precision in the product (uses BigInt)', () => {
    fc.assert(fc.property(milliArb, usatArb, (q, c) => {
      const exact = (BigInt(q) * BigInt(c))
      const expected = Number(roundDivBig(exact, 1_000_000_000n))
      expect(costSatang(q, c)).toBe(expected)
    }))
  })
  it('rejects non-integers', () => {
    expect(() => costSatang(1.5, 1)).toThrow(RangeError)
  })
})

describe('splitLargestRemainder', () => {
  it('splits exactly with sum preserved', () => {
    expect(splitLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(splitLargestRemainder(7, [50, 50])).toEqual([4, 3])
    expect(splitLargestRemainder(0, [5, 5])).toEqual([0, 0])
  })
  it('returns [] for no weights and gives all to first when weights are all zero', () => {
    expect(splitLargestRemainder(10, [])).toEqual([])
    expect(splitLargestRemainder(10, [0, 0])).toEqual([10, 0])
  })
  it('always sums to total and every part is >= 0', () => {
    fc.assert(fc.property(satangArb, fc.array(satangArb, { minLength: 1, maxLength: 20 }), (total, weights) => {
      const parts = splitLargestRemainder(total, weights)
      expect(parts.length).toBe(weights.length)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
      for (const p of parts) expect(p).toBeGreaterThanOrEqual(0)
    }))
  })
})
```

- [ ] **Step 3: รันให้ตก**

Run: `pnpm --filter @dayo/domain test`
Expected: FAIL — `Failed to resolve import "../src/money.js"`

- [ ] **Step 4: เขียน money.ts**

`packages/domain/src/money.ts`
```ts
export const USAT_PER_BAHT = 100_000_000
export const USAT_PER_SATANG = 1_000_000
export const MILLI = 1_000

export function assertSafeInt(n: number, name: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${name} must be a safe integer, got ${n}`)
}

export function bahtToSatang(baht: number): number {
  return Math.round(baht * 100)
}

export function bahtToUsat(baht: number): number {
  return Math.round(baht * USAT_PER_BAHT)
}

/** Integer division rounding half away from zero. */
export function roundDivBig(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError('division by zero')
  const negative = (num < 0n) !== (den < 0n)
  const a = num < 0n ? -num : num
  const b = den < 0n ? -den : den
  const q = (2n * a + b) / (2n * b)
  return negative ? -q : q
}

export function roundDiv(num: number, den: number): number {
  assertSafeInt(num, 'num')
  assertSafeInt(den, 'den')
  return Number(roundDivBig(BigInt(num), BigInt(den)))
}

/** Cost in satang of `qtyMilli` (1/1000 use-unit) at `unitCostUsat` (micro-satang per use-unit). */
export function costSatang(qtyMilli: number, unitCostUsat: number): number {
  assertSafeInt(qtyMilli, 'qtyMilli')
  assertSafeInt(unitCostUsat, 'unitCostUsat')
  return Number(roundDivBig(BigInt(qtyMilli) * BigInt(unitCostUsat), 1_000_000_000n))
}

/**
 * Split `total` proportionally to `weights` so that parts sum exactly to `total`.
 * Ties on fractional part go to the earlier index. All-zero weights → everything to index 0.
 */
export function splitLargestRemainder(total: number, weights: number[]): number[] {
  assertSafeInt(total, 'total')
  if (weights.length === 0) return []
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0))
  const floors = weights.map((w) => Math.floor((total * w) / sum))
  let remainder = total - floors.reduce((a, b) => a + b, 0)
  const order = weights
    .map((w, i) => ({ i, frac: (total * w) / sum - Math.floor((total * w) / sum) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (remainder === 0) break
    floors[i] = (floors[i] ?? 0) + 1
    remainder -= 1
  }
  return floors
}
```

`packages/domain/src/index.ts` (แทนที่ทั้งไฟล์)
```ts
export const DOMAIN_VERSION = 1
export * from './money.js'
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `pnpm --filter @dayo/domain test && pnpm --filter @dayo/domain typecheck`
Expected: ทุกเทสต์ผ่าน (รวม property 100 รอบต่อข้อ)

- [ ] **Step 6: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): money and quantity primitives with exact rounding"
```

---

### Task 3: pricing.ts — ราคาและยอดบิล (spec §4.1)

**Files:**
- Create: `packages/domain/src/pricing.ts`, `packages/domain/test/pricing.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `roundDiv`, `splitLargestRemainder`, `assertSafeInt` จาก money.ts
- Produces:
  - `type LineInput = { qty: number; unitPriceSatang: number }`
  - `type VatConfig = { enabled: boolean; rateBp: number }` (7% = 700)
  - `type Totals = { lineTotals: number[]; subtotalSatang: number; discountSatang: number; totalSatang: number; vatSatang: number; lineVatSatang: number[] }`
  - `computeTotals(lines: LineInput[], discountSatang: number, vat: VatConfig): Totals` — โยน `RangeError` ถ้า discount > subtotal, qty < 1, ราคาติดลบ
  - `type PriceRow = { variantId: string; channelId: string; priceSatang: number; effectiveFrom: string }`
  - `priceFor(prices: readonly PriceRow[], variantId: string, channelId: string, atIso: string): PriceRow | undefined`
  - `VAT_OFF: VatConfig = { enabled: false, rateBp: 0 }`

- [ ] **Step 1: เขียนเทสต์ให้ตก**

`packages/domain/test/pricing.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { VAT_OFF, computeTotals, priceFor, type LineInput, type PriceRow } from '../src/pricing.js'
import { qtyArb, satangArb } from './arb.js'

const lineArb = fc.record<LineInput>({ qty: qtyArb, unitPriceSatang: satangArb })

describe('computeTotals', () => {
  it('sums lines and subtracts discount with VAT off', () => {
    const t = computeTotals([{ qty: 2, unitPriceSatang: 4500 }, { qty: 1, unitPriceSatang: 8500 }], 500, VAT_OFF)
    expect(t.lineTotals).toEqual([9000, 8500])
    expect(t.subtotalSatang).toBe(17500)
    expect(t.discountSatang).toBe(500)
    expect(t.totalSatang).toBe(17000)
    expect(t.vatSatang).toBe(0)
    expect(t.lineVatSatang).toEqual([0, 0])
  })
  it('handles an empty cart', () => {
    expect(computeTotals([], 0, VAT_OFF).totalSatang).toBe(0)
  })
  it('computes VAT included in price when enabled (107 baht → 7 baht VAT)', () => {
    const t = computeTotals([{ qty: 1, unitPriceSatang: 10700 }], 0, { enabled: true, rateBp: 700 })
    expect(t.vatSatang).toBe(700)
    expect(t.lineVatSatang).toEqual([700])
    expect(t.totalSatang).toBe(10700)
  })
  it('rejects discount larger than subtotal, qty < 1 and negative prices', () => {
    expect(() => computeTotals([{ qty: 1, unitPriceSatang: 100 }], 101, VAT_OFF)).toThrow(RangeError)
    expect(() => computeTotals([{ qty: 0, unitPriceSatang: 100 }], 0, VAT_OFF)).toThrow(RangeError)
    expect(() => computeTotals([{ qty: 1, unitPriceSatang: -1 }], 0, VAT_OFF)).toThrow(RangeError)
  })
  it('invariant: Σ lineTotals − discount = total, and Σ lineVat = vat', () => {
    fc.assert(fc.property(fc.array(lineArb, { maxLength: 30 }), fc.nat(), fc.boolean(), (lines, d, vatOn) => {
      const subtotal = lines.reduce((a, l) => a + l.qty * l.unitPriceSatang, 0)
      const discount = subtotal === 0 ? 0 : d % (subtotal + 1)
      const t = computeTotals(lines, discount, vatOn ? { enabled: true, rateBp: 700 } : VAT_OFF)
      expect(t.lineTotals.reduce((a, b) => a + b, 0) - t.discountSatang).toBe(t.totalSatang)
      expect(t.lineVatSatang.reduce((a, b) => a + b, 0)).toBe(t.vatSatang)
      expect(t.vatSatang).toBeLessThanOrEqual(t.totalSatang)
    }))
  })
})

describe('priceFor', () => {
  const prices: PriceRow[] = [
    { variantId: 'v1', channelId: 'store', priceSatang: 4500, effectiveFrom: '2026-01-01T00:00:00.000Z' },
    { variantId: 'v1', channelId: 'store', priceSatang: 5000, effectiveFrom: '2026-10-01T00:00:00.000Z' },
    { variantId: 'v1', channelId: 'line', priceSatang: 4800, effectiveFrom: '2026-01-01T00:00:00.000Z' },
  ]
  it('picks the latest price effective at the given time', () => {
    expect(priceFor(prices, 'v1', 'store', '2026-09-17T10:00:00.000Z')?.priceSatang).toBe(4500)
    expect(priceFor(prices, 'v1', 'store', '2026-10-01T00:00:00.000Z')?.priceSatang).toBe(5000)
    expect(priceFor(prices, 'v1', 'line', '2026-09-17T10:00:00.000Z')?.priceSatang).toBe(4800)
  })
  it('returns undefined when nothing is effective yet or variant unknown', () => {
    expect(priceFor(prices, 'v1', 'store', '2025-12-31T23:59:59.000Z')).toBeUndefined()
    expect(priceFor(prices, 'v9', 'store', '2026-09-17T10:00:00.000Z')).toBeUndefined()
  })
})
```

- [ ] **Step 2: รันให้ตก**

Run: `pnpm --filter @dayo/domain test`
Expected: FAIL — cannot resolve `../src/pricing.js`

- [ ] **Step 3: เขียน pricing.ts**

`packages/domain/src/pricing.ts`
```ts
import { assertSafeInt, roundDiv, splitLargestRemainder } from './money.js'

export type LineInput = { qty: number; unitPriceSatang: number }
export type VatConfig = { enabled: boolean; rateBp: number }
export type Totals = {
  lineTotals: number[]
  subtotalSatang: number
  discountSatang: number
  totalSatang: number
  vatSatang: number
  lineVatSatang: number[]
}
export const VAT_OFF: VatConfig = { enabled: false, rateBp: 0 }

export function computeTotals(lines: LineInput[], discountSatang: number, vat: VatConfig): Totals {
  assertSafeInt(discountSatang, 'discountSatang')
  if (discountSatang < 0) throw new RangeError('discount must be >= 0')
  const lineTotals = lines.map((l, i) => {
    assertSafeInt(l.qty, `lines[${i}].qty`)
    assertSafeInt(l.unitPriceSatang, `lines[${i}].unitPriceSatang`)
    if (l.qty < 1) throw new RangeError(`lines[${i}].qty must be >= 1`)
    if (l.unitPriceSatang < 0) throw new RangeError(`lines[${i}].unitPriceSatang must be >= 0`)
    return l.qty * l.unitPriceSatang
  })
  const subtotalSatang = lineTotals.reduce((a, b) => a + b, 0)
  if (discountSatang > subtotalSatang) throw new RangeError('discount exceeds subtotal')
  const totalSatang = subtotalSatang - discountSatang
  // VAT-inclusive pricing: vat = total × r / (1 + r)
  const vatSatang = vat.enabled && vat.rateBp > 0 ? roundDiv(totalSatang * vat.rateBp, 10_000 + vat.rateBp) : 0
  const lineVatSatang = splitLargestRemainder(vatSatang, lineTotals)
  return { lineTotals, subtotalSatang, discountSatang, totalSatang, vatSatang, lineVatSatang }
}

export type PriceRow = { variantId: string; channelId: string; priceSatang: number; effectiveFrom: string }

/** Latest price row for (variant, channel) whose effectiveFrom <= atIso. ISO-8601 UTC strings compare lexically. */
export function priceFor(prices: readonly PriceRow[], variantId: string, channelId: string, atIso: string): PriceRow | undefined {
  let best: PriceRow | undefined
  for (const p of prices) {
    if (p.variantId !== variantId || p.channelId !== channelId || p.effectiveFrom > atIso) continue
    if (!best || p.effectiveFrom >= best.effectiveFrom) best = p
  }
  return best
}
```

เพิ่มใน `packages/domain/src/index.ts`:
```ts
export * from './pricing.js'
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `pnpm --filter @dayo/domain test && pnpm --filter @dayo/domain typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): order totals with discount and VAT-inclusive allocation, price lookup"
```

---

### Task 4: receipt.ts + hash.ts — เลขที่บิลและโซ่แฮชของ event (spec §4.7, §4.9)

**Files:**
- Create: `packages/domain/src/receipt.ts`, `packages/domain/src/hash.ts`, `packages/domain/test/receipt.test.ts`, `packages/domain/test/hash.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces:
  - `formatReceiptNo(prefix: string, counter: number): string` → `A-000123` (prefix `/^[A-Z]{1,3}$/`, counter 1..999999)
  - `parseReceiptNo(s: string): { prefix: string; counter: number }`
  - `GENESIS_HASH = '0'.repeat(64)`
  - `canonicalJson(value: unknown): string` — key เรียง, ไม่มีช่องว่าง, ตัด `undefined`, โยนถ้ามี NaN/Infinity/bigint
  - `sha256Hex(s: string): string`
  - `type EventCore = { chainId: string; chainSeq: number; orderId: string; type: string; payload: unknown; actorType: 'user' | 'customer' | 'system'; actorId: string; at: string }`
  - `computeEventHash(prevHash: string, e: EventCore): string`
  - `verifyChain(events: readonly (EventCore & { prevHash: string; hash: string })[]): { ok: true } | { ok: false; brokenAtChainSeq: number; reason: string }`
  - หมายเหตุ: โซ่ต่อ **ต้นทาง** (`chainId` = device id หรือ `'server'`) และ `chainSeq` เรียง 1,2,3… ต่อโซ่ (spec §4.9) · `seq` ต่อบิลเป็นคนละคอลัมน์ ไม่เกี่ยวกับแฮช

- [ ] **Step 1: เขียนเทสต์ให้ตก**

`packages/domain/test/receipt.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { formatReceiptNo, parseReceiptNo } from '../src/receipt.js'

describe('receipt numbers', () => {
  it('formats with device prefix and 6-digit zero padding', () => {
    expect(formatReceiptNo('A', 1)).toBe('A-000001')
    expect(formatReceiptNo('A', 1042)).toBe('A-001042')
    expect(formatReceiptNo('B', 999999)).toBe('B-999999')
  })
  it('rejects bad prefix or counter', () => {
    expect(() => formatReceiptNo('a', 1)).toThrow(RangeError)
    expect(() => formatReceiptNo('ABCD', 1)).toThrow(RangeError)
    expect(() => formatReceiptNo('A', 0)).toThrow(RangeError)
    expect(() => formatReceiptNo('A', 1_000_000)).toThrow(RangeError)
    expect(() => formatReceiptNo('A', 1.5)).toThrow(RangeError)
  })
  it('round-trips and preserves order', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 999_999 }), fc.integer({ min: 1, max: 999_999 }), (a, b) => {
      expect(parseReceiptNo(formatReceiptNo('A', a))).toEqual({ prefix: 'A', counter: a })
      expect(formatReceiptNo('A', a) < formatReceiptNo('A', b)).toBe(a < b)
    }))
  })
})
```

`packages/domain/test/hash.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { GENESIS_HASH, canonicalJson, computeEventHash, sha256Hex, verifyChain, type EventCore } from '../src/hash.js'

describe('canonicalJson', () => {
  it('sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"y":2,"z":1}]},"b":1}')
  })
  it('is stable under key order', () => {
    expect(canonicalJson({ x: 1, y: 'a' })).toBe(canonicalJson({ y: 'a', x: 1 }))
  })
  it('rejects NaN, Infinity and bigint', () => {
    expect(() => canonicalJson({ n: NaN })).toThrow(TypeError)
    expect(() => canonicalJson({ n: Infinity })).toThrow(TypeError)
    expect(() => canonicalJson({ n: 1n })).toThrow(TypeError)
  })
})

describe('sha256Hex', () => {
  it('matches a known vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

function mkEvent(chainSeq: number, type = 'CREATED', payload: unknown = { n: chainSeq }): EventCore {
  return { chainId: 'dev-A', chainSeq, orderId: 'o1', type, payload, actorType: 'user', actorId: 'u1', at: '2026-09-17T10:00:00.000Z' }
}
function chain(n: number) {
  const out: (EventCore & { prevHash: string; hash: string })[] = []
  let prev = GENESIS_HASH
  for (let i = 1; i <= n; i++) {
    const e = mkEvent(i)
    const hash = computeEventHash(prev, e)
    out.push({ ...e, prevHash: prev, hash })
    prev = hash
  }
  return out
}

describe('event chain', () => {
  it('hash depends on prevHash and every field', () => {
    const e = mkEvent(1)
    const h = computeEventHash(GENESIS_HASH, e)
    expect(h).toHaveLength(64)
    expect(computeEventHash('1'.repeat(64), e)).not.toBe(h)
    expect(computeEventHash(GENESIS_HASH, { ...e, type: 'PAID' })).not.toBe(h)
    expect(computeEventHash(GENESIS_HASH, { ...e, payload: { n: 2 } })).not.toBe(h)
  })
  it('verifies a valid chain and an empty chain', () => {
    expect(verifyChain(chain(5))).toEqual({ ok: true })
    expect(verifyChain([])).toEqual({ ok: true })
  })
  it('detects tampering of any event payload', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 20 }), fc.nat(), (n, k) => {
      const c = chain(n)
      const idx = k % n
      const victim = c[idx]!
      c[idx] = { ...victim, payload: { n: -1 } }
      const r = verifyChain(c)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.brokenAtChainSeq).toBe(idx + 1)
    }))
  })
  it('detects a deleted event (gap in chainSeq) and a wrong genesis', () => {
    const c = chain(4)
    expect(verifyChain([c[0]!, c[1]!, c[3]!])).toMatchObject({ ok: false, brokenAtChainSeq: 4 })
    expect(verifyChain([{ ...c[0]!, prevHash: '1'.repeat(64) }])).toMatchObject({ ok: false, brokenAtChainSeq: 1 })
  })
  it('accepts events given out of order (sorts by chainSeq)', () => {
    const c = chain(3)
    expect(verifyChain([c[2]!, c[0]!, c[1]!])).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: รันให้ตก**

Run: `pnpm --filter @dayo/domain test`
Expected: FAIL — cannot resolve `../src/receipt.js` / `../src/hash.js`

- [ ] **Step 3: เขียน receipt.ts**

`packages/domain/src/receipt.ts`
```ts
const PREFIX_RE = /^[A-Z]{1,3}$/
const RECEIPT_RE = /^([A-Z]{1,3})-(\d{6})$/

export function formatReceiptNo(prefix: string, counter: number): string {
  if (!PREFIX_RE.test(prefix)) throw new RangeError(`bad receipt prefix "${prefix}"`)
  if (!Number.isInteger(counter) || counter < 1 || counter > 999_999) throw new RangeError(`bad receipt counter ${counter}`)
  return `${prefix}-${String(counter).padStart(6, '0')}`
}

export function parseReceiptNo(s: string): { prefix: string; counter: number } {
  const m = RECEIPT_RE.exec(s)
  if (!m) throw new RangeError(`bad receipt number "${s}"`)
  return { prefix: m[1]!, counter: Number(m[2]) }
}
```

- [ ] **Step 4: เขียน hash.ts**

`packages/domain/src/hash.ts`
```ts
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export const GENESIS_HASH = '0'.repeat(64)

function canon(v: unknown): unknown {
  if (v === null) return null
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return v
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError('canonicalJson: non-finite number')
      return v
    case 'bigint':
      throw new TypeError('canonicalJson: bigint not allowed')
    case 'undefined':
      return undefined
    case 'object': {
      if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : canon(x)))
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as object).sort()) {
        const c = canon((v as Record<string, unknown>)[k])
        if (c !== undefined) out[k] = c
      }
      return out
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof v}`)
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canon(value))
}

export function sha256Hex(s: string): string {
  return bytesToHex(sha256(utf8ToBytes(s)))
}

export type EventCore = {
  chainId: string
  chainSeq: number
  orderId: string
  type: string
  payload: unknown
  actorType: 'user' | 'customer' | 'system'
  actorId: string
  at: string
}

export function computeEventHash(prevHash: string, e: EventCore): string {
  const body = canonicalJson({
    chainId: e.chainId,
    chainSeq: e.chainSeq,
    orderId: e.orderId,
    type: e.type,
    payload: e.payload,
    actorType: e.actorType,
    actorId: e.actorId,
    at: e.at,
  })
  return sha256Hex(`${prevHash}\n${body}`)
}

export type ChainedEvent = EventCore & { prevHash: string; hash: string }
export type ChainVerdict = { ok: true } | { ok: false; brokenAtChainSeq: number; reason: string }

export function verifyChain(events: readonly ChainedEvent[]): ChainVerdict {
  const sorted = [...events].sort((a, b) => a.chainSeq - b.chainSeq)
  let prev = GENESIS_HASH
  let expectedSeq = 1
  for (const e of sorted) {
    if (e.chainSeq !== expectedSeq) return { ok: false, brokenAtChainSeq: expectedSeq, reason: `missing chainSeq ${expectedSeq}` }
    if (e.prevHash !== prev) return { ok: false, brokenAtChainSeq: e.chainSeq, reason: 'prevHash mismatch' }
    if (computeEventHash(prev, e) !== e.hash) return { ok: false, brokenAtChainSeq: e.chainSeq, reason: 'hash mismatch' }
    prev = e.hash
    expectedSeq += 1
  }
  return { ok: true }
}
```

เพิ่มใน `packages/domain/src/index.ts`:
```ts
export * from './receipt.js'
export * from './hash.js'
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `pnpm --filter @dayo/domain test && pnpm --filter @dayo/domain typecheck`
Expected: PASS (ถ้า import path `@noble/hashes/sha2.js` ไม่พบ ให้ดู `node_modules/@noble/hashes/package.json` → exports; เวอร์ชัน 2.x ใช้ `sha2.js`, เวอร์ชัน 1.x ใช้ `sha256`)

- [ ] **Step 6: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): receipt numbering and hash-chained order events"
```

---

### Task 5: stock/catalog.ts + stock/explode.ts — ระเบิดสูตรและต้นทุนมาตรฐาน (spec §4.2)

**Files:**
- Create: `packages/domain/src/stock/catalog.ts`, `packages/domain/src/stock/explode.ts`, `packages/domain/test/explode.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `roundDivBig`, `assertSafeInt` จาก money.ts
- Produces:
  - `type ItemKind = 'raw' | 'prepared' | 'packaging_set'`
  - `type CatalogItem = { id: string; kind: ItemKind; isTracked: boolean; standardCostUsat: number }`
  - `type BomLine = { itemId: string; qtyMilli: number }`
  - `type Bom = { itemId: string; yieldMilli: number; lines: BomLine[] }`
  - `type Catalog = { items: ReadonlyMap<string, CatalogItem>; boms: ReadonlyMap<string, Bom> }`
  - `buildCatalog(items: CatalogItem[], boms: Bom[]): Catalog`
  - `standardUnitCostUsat(itemId: string, catalog: Catalog): number` — raw → standardCostUsat · prepared/packaging_set → Σ(component qty × cost) ÷ yield (ไม่สนใจ isTracked)
  - `explodeNeeds(lines: readonly BomLine[], multiplier: number, catalog: Catalog): Map<string, number>` — item id → milli ที่ต้องตัด ตามกฎ: raw หยุด · prepared+tracked หยุด · prepared ไม่ tracked หรือ packaging_set → ระเบิดผ่าน BOM (qty × need ÷ yield)
  - ทั้งสองโยน `Error` ถ้าไม่พบ item/BOM หรือมีวงจร (ลึกเกิน 10)

- [ ] **Step 1: เขียนเทสต์ให้ตก**

`packages/domain/test/explode.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { buildCatalog, standardUnitCostUsat, type Bom, type CatalogItem } from '../src/stock/catalog.js'
import { explodeNeeds } from '../src/stock/explode.js'
import { costSatang } from '../src/money.js'

// Thai tea base from the Excel file: 180 g + 120 g tea + 3,300 ml water → 3,000 ml
const items: CatalogItem[] = [
  { id: 'RM-TEA-02', kind: 'raw', isTracked: true, standardCostUsat: 19_000_000 },
  { id: 'RM-TEA-01', kind: 'raw', isTracked: true, standardCostUsat: 19_250_000 },
  { id: 'RM-WTR-02', kind: 'raw', isTracked: false, standardCostUsat: 75_000 },
  { id: 'RM-MLK-02', kind: 'raw', isTracked: true, standardCostUsat: 7_407_407 },
  { id: 'PK-CUP-01', kind: 'raw', isTracked: true, standardCostUsat: 200_000_000 },
  { id: 'PK-LID-01', kind: 'raw', isTracked: true, standardCostUsat: 100_000_000 },
  { id: 'PB-TEA-THAI', kind: 'prepared', isTracked: true, standardCostUsat: 0 },
  { id: 'PB-UNTRACKED', kind: 'prepared', isTracked: false, standardCostUsat: 0 },
  { id: 'PK-SET-16', kind: 'packaging_set', isTracked: false, standardCostUsat: 0 },
]
const boms: Bom[] = [
  { itemId: 'PB-TEA-THAI', yieldMilli: 3_000_000, lines: [{ itemId: 'RM-TEA-02', qtyMilli: 180_000 }, { itemId: 'RM-TEA-01', qtyMilli: 120_000 }, { itemId: 'RM-WTR-02', qtyMilli: 3_300_000 }] },
  { itemId: 'PB-UNTRACKED', yieldMilli: 1_000_000, lines: [{ itemId: 'RM-MLK-02', qtyMilli: 500_000 }, { itemId: 'RM-WTR-02', qtyMilli: 500_000 }] },
  { itemId: 'PK-SET-16', yieldMilli: 1_000, lines: [{ itemId: 'PK-CUP-01', qtyMilli: 1_000 }, { itemId: 'PK-LID-01', qtyMilli: 1_000 }] },
]
const catalog = buildCatalog(items, boms)

describe('standardUnitCostUsat', () => {
  it('returns standard cost for raw items', () => {
    expect(standardUnitCostUsat('RM-TEA-02', catalog)).toBe(19_000_000)
  })
  it('computes Thai tea base cost = 0.019925 baht/ml exactly like the Excel sheet', () => {
    expect(standardUnitCostUsat('PB-TEA-THAI', catalog)).toBe(1_992_500)
  })
  it('computes packaging set cost = 3 baht per set', () => {
    expect(standardUnitCostUsat('PK-SET-16', catalog)).toBe(300_000_000)
  })
  it('throws for unknown item or prepared item without BOM', () => {
    expect(() => standardUnitCostUsat('nope', catalog)).toThrow()
    const c2 = buildCatalog([{ id: 'P', kind: 'prepared', isTracked: true, standardCostUsat: 0 }], [])
    expect(() => standardUnitCostUsat('P', c2)).toThrow()
  })
})

describe('explodeNeeds', () => {
  it('stops at raw and at tracked prepared items', () => {
    const needs = explodeNeeds([{ itemId: 'PB-TEA-THAI', qtyMilli: 130_000 }, { itemId: 'RM-MLK-02', qtyMilli: 46_000 }], 2, catalog)
    expect([...needs.entries()]).toEqual([['PB-TEA-THAI', 260_000], ['RM-MLK-02', 92_000]])
  })
  it('explodes untracked prepared items and packaging sets down to raw', () => {
    const needs = explodeNeeds([{ itemId: 'PB-UNTRACKED', qtyMilli: 200_000 }, { itemId: 'PK-SET-16', qtyMilli: 1_000 }], 1, catalog)
    expect(needs.get('RM-MLK-02')).toBe(100_000)
    expect(needs.get('RM-WTR-02')).toBe(100_000)
    expect(needs.get('PK-CUP-01')).toBe(1_000)
    expect(needs.get('PK-LID-01')).toBe(1_000)
    expect(needs.has('PB-UNTRACKED')).toBe(false)
  })
  it('merges the same raw item reached from different lines', () => {
    const needs = explodeNeeds([{ itemId: 'PB-UNTRACKED', qtyMilli: 1_000_000 }, { itemId: 'RM-WTR-02', qtyMilli: 10_000 }], 1, catalog)
    expect(needs.get('RM-WTR-02')).toBe(510_000)
  })
  it('is linear in the multiplier up to rounding (≤ 1 milli per component)', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 50 }), fc.integer({ min: 1, max: 999_999 }), (k, q) => {
      const one = explodeNeeds([{ itemId: 'PB-UNTRACKED', qtyMilli: q }], 1, catalog)
      const many = explodeNeeds([{ itemId: 'PB-UNTRACKED', qtyMilli: q }], k, catalog)
      for (const [id, n] of many) expect(Math.abs(n - k * (one.get(id) ?? 0))).toBeLessThanOrEqual(k)
    }))
  })
  it('detects cycles', () => {
    const c = buildCatalog(
      [{ id: 'A', kind: 'prepared', isTracked: false, standardCostUsat: 0 }, { id: 'B', kind: 'prepared', isTracked: false, standardCostUsat: 0 }],
      [{ itemId: 'A', yieldMilli: 1000, lines: [{ itemId: 'B', qtyMilli: 1000 }] }, { itemId: 'B', yieldMilli: 1000, lines: [{ itemId: 'A', qtyMilli: 1000 }] }],
    )
    expect(() => explodeNeeds([{ itemId: 'A', qtyMilli: 1000 }], 1, c)).toThrow(/cycle|depth/)
  })
  it('cost of exploded needs at standard cost equals line cost via standardUnitCostUsat (within 1 satang per component)', () => {
    const needs = explodeNeeds([{ itemId: 'PB-UNTRACKED', qtyMilli: 333_000 }], 3, catalog)
    const viaNeeds = [...needs].reduce((a, [id, n]) => a + costSatang(n, standardUnitCostUsat(id, catalog)), 0)
    const viaUnit = costSatang(999_000, standardUnitCostUsat('PB-UNTRACKED', catalog))
    expect(Math.abs(viaNeeds - viaUnit)).toBeLessThanOrEqual(2)
  })
})
```

- [ ] **Step 2: รันให้ตก**

Run: `pnpm --filter @dayo/domain test`
Expected: FAIL — cannot resolve `../src/stock/catalog.js`

- [ ] **Step 3: เขียน catalog.ts**

`packages/domain/src/stock/catalog.ts`
```ts
import { roundDivBig } from '../money.js'

export type ItemKind = 'raw' | 'prepared' | 'packaging_set'
export type CatalogItem = { id: string; kind: ItemKind; isTracked: boolean; standardCostUsat: number }
export type BomLine = { itemId: string; qtyMilli: number }
export type Bom = { itemId: string; yieldMilli: number; lines: BomLine[] }
export type Catalog = { items: ReadonlyMap<string, CatalogItem>; boms: ReadonlyMap<string, Bom> }

export const MAX_BOM_DEPTH = 10

export function buildCatalog(items: readonly CatalogItem[], boms: readonly Bom[]): Catalog {
  return {
    items: new Map(items.map((i) => [i.id, i])),
    boms: new Map(boms.map((b) => [b.itemId, b])),
  }
}

export function requireItem(catalog: Catalog, id: string): CatalogItem {
  const item = catalog.items.get(id)
  if (!item) throw new Error(`unknown item ${id}`)
  return item
}

export function requireBom(catalog: Catalog, id: string): Bom {
  const bom = catalog.boms.get(id)
  if (!bom) throw new Error(`item ${id} has no BOM`)
  if (bom.yieldMilli <= 0) throw new Error(`BOM of ${id} has non-positive yield`)
  return bom
}

/** Standard (pre-purchase) cost per use-unit in usat. Prepared/packaging items roll up through their BOM regardless of tracking. */
export function standardUnitCostUsat(itemId: string, catalog: Catalog, depth = 0): number {
  if (depth > MAX_BOM_DEPTH) throw new Error(`BOM cycle or depth exceeded at ${itemId}`)
  const item = requireItem(catalog, itemId)
  if (item.kind === 'raw') return item.standardCostUsat
  const bom = requireBom(catalog, itemId)
  let total = 0n // milli × usat
  for (const line of bom.lines) {
    total += BigInt(line.qtyMilli) * BigInt(standardUnitCostUsat(line.itemId, catalog, depth + 1))
  }
  return Number(roundDivBig(total, BigInt(bom.yieldMilli)))
}
```

- [ ] **Step 4: เขียน explode.ts**

`packages/domain/src/stock/explode.ts`
```ts
import { assertSafeInt, roundDivBig } from '../money.js'
import { MAX_BOM_DEPTH, requireBom, requireItem, type BomLine, type Catalog } from './catalog.js'

/**
 * Quantities to deduct from stock for `lines` × `multiplier`, following spec §4.2:
 * raw → stop · prepared & tracked → stop · prepared & untracked, packaging_set → explode through BOM.
 * Returns insertion-ordered Map itemId → milli (all > 0).
 */
export function explodeNeeds(lines: readonly BomLine[], multiplier: number, catalog: Catalog): Map<string, number> {
  assertSafeInt(multiplier, 'multiplier')
  if (multiplier < 1) throw new RangeError('multiplier must be >= 1')
  const acc = new Map<string, number>()
  const visit = (itemId: string, needMilli: number, depth: number): void => {
    if (needMilli === 0) return
    if (depth > MAX_BOM_DEPTH) throw new Error(`BOM cycle or depth exceeded at ${itemId}`)
    const item = requireItem(catalog, itemId)
    const stop = item.kind === 'raw' || (item.kind === 'prepared' && item.isTracked)
    if (stop) {
      acc.set(itemId, (acc.get(itemId) ?? 0) + needMilli)
      return
    }
    const bom = requireBom(catalog, itemId)
    for (const c of bom.lines) {
      const componentNeed = Number(roundDivBig(BigInt(c.qtyMilli) * BigInt(needMilli), BigInt(bom.yieldMilli)))
      visit(c.itemId, componentNeed, depth + 1)
    }
  }
  for (const l of lines) {
    assertSafeInt(l.qtyMilli, 'qtyMilli')
    visit(l.itemId, l.qtyMilli * multiplier, 0)
  }
  return acc
}
```

เพิ่มใน `packages/domain/src/index.ts`:
```ts
export * from './stock/catalog.js'
export * from './stock/explode.js'
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `pnpm --filter @dayo/domain test && pnpm --filter @dayo/domain typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): catalog, standard cost roll-up and recipe explosion"
```

---

### Task 6: stock/movements.ts + stock/costing.ts — การเคลื่อนไหว ถัวเฉลี่ยเคลื่อนที่ และการทำเบส (spec §4.2–§4.4)

**Files:**
- Create: `packages/domain/src/stock/movements.ts`, `packages/domain/src/stock/costing.ts`, `packages/domain/test/movements.test.ts`, `packages/domain/test/costing.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `costSatang`, `roundDivBig`, `assertSafeInt` (money.ts) · `Bom`, `Catalog`, `requireBom` (catalog.ts)
- Produces:
  - `type MovementKind = 'OPENING' | 'PURCHASE' | 'SALE' | 'VOID_RETURN' | 'PRODUCE_OUT' | 'PRODUCE_IN' | 'WASTE' | 'EXPIRED' | 'COUNT_ADJ' | 'TRIAL' | 'TRANSFER'`
  - `type MovementDraft = { itemId: string; kind: MovementKind; qtyMilli: number; unitCostUsat: number; refType: string; refId: string }` (qty มีเครื่องหมาย: ออก = ลบ)
  - `type CostOf = (itemId: string) => number` — ต้นทุนปัจจุบันต่อหน่วย (usat)
  - `saleMovements(needs: ReadonlyMap<string, number>, costOf: CostOf, orderId: string): MovementDraft[]` — kind SALE, qty ลบ, refType `'order'`
  - `voidReturnMovements(sale: readonly MovementDraft[], orderId: string): MovementDraft[]` — กระจกเงา kind VOID_RETURN qty บวก ต้นทุนเดิม
  - `needsCostSatang(needs: ReadonlyMap<string, number>, costOf: CostOf): number`
  - `type CostState = { onHandMilli: number; avgCostUsat: number }` · `EMPTY_COST_STATE`
  - `applyMovement(s: CostState, m: { qtyMilli: number; unitCostUsat: number }): CostState` — เข้า (qty > 0): ถัวเฉลี่ยถ่วงน้ำหนัก, ถ้า onHand ≤ 0 ใช้ต้นทุนใหม่ · ออก: avg ไม่เปลี่ยน
  - `rebuildCostState(movements: readonly { qtyMilli: number; unitCostUsat: number }[]): CostState`
  - `productionMovements(bom: Bom, scaleBp: number, yieldActualMilli: number, costOf: CostOf, batchId: string): { outs: MovementDraft[]; inn: MovementDraft; batchCostSatang: number; unitCostUsat: number }` — ส่วนประกอบ qty = round(line × scaleBp / 10000) ออกที่ต้นทุนปัจจุบัน · เบสเข้า yieldActual ที่ unitCost = Σ(qty × cost) ÷ yieldActual · refType `'production_batch'`

- [ ] **Step 1: เขียนเทสต์ให้ตก**

`packages/domain/test/movements.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { needsCostSatang, saleMovements, voidReturnMovements } from '../src/stock/movements.js'

const costOf = (id: string) => ({ 'PB-TEA-THAI': 1_992_500, 'RM-MLK-02': 7_407_407 })[id] ?? 0

describe('saleMovements', () => {
  it('creates one negative SALE movement per need at current cost', () => {
    const needs = new Map([['PB-TEA-THAI', 130_000], ['RM-MLK-02', 46_000]])
    expect(saleMovements(needs, costOf, 'o1')).toEqual([
      { itemId: 'PB-TEA-THAI', kind: 'SALE', qtyMilli: -130_000, unitCostUsat: 1_992_500, refType: 'order', refId: 'o1' },
      { itemId: 'RM-MLK-02', kind: 'SALE', qtyMilli: -46_000, unitCostUsat: 7_407_407, refType: 'order', refId: 'o1' },
    ])
  })
  it('skips zero needs', () => {
    expect(saleMovements(new Map([['RM-MLK-02', 0]]), costOf, 'o1')).toEqual([])
  })
})

describe('voidReturnMovements', () => {
  it('mirrors sale movements with positive qty and the same unit cost', () => {
    const sale = saleMovements(new Map([['PB-TEA-THAI', 130_000]]), costOf, 'o1')
    expect(voidReturnMovements(sale, 'o1')).toEqual([
      { itemId: 'PB-TEA-THAI', kind: 'VOID_RETURN', qtyMilli: 130_000, unitCostUsat: 1_992_500, refType: 'order', refId: 'o1' },
    ])
  })
})

describe('needsCostSatang', () => {
  it('sums cost of needs (130 ml base + 46 ml evaporated milk = 2.59 + 3.41 baht)', () => {
    expect(needsCostSatang(new Map([['PB-TEA-THAI', 130_000], ['RM-MLK-02', 46_000]]), costOf)).toBe(259 + 341)
  })
})
```

`packages/domain/test/costing.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { EMPTY_COST_STATE, applyMovement, productionMovements, rebuildCostState } from '../src/stock/costing.js'
import { costSatang } from '../src/money.js'
import type { Bom } from '../src/stock/catalog.js'
import { milliArb, usatArb } from './arb.js'

describe('applyMovement (moving weighted average)', () => {
  it('first purchase sets the average', () => {
    expect(applyMovement(EMPTY_COST_STATE, { qtyMilli: 400_000, unitCostUsat: 19_250_000 })).toEqual({ onHandMilli: 400_000, avgCostUsat: 19_250_000 })
  })
  it('second purchase at a different price is weighted', () => {
    const s1 = applyMovement(EMPTY_COST_STATE, { qtyMilli: 1_000, unitCostUsat: 100 })
    const s2 = applyMovement(s1, { qtyMilli: 3_000, unitCostUsat: 200 })
    expect(s2).toEqual({ onHandMilli: 4_000, avgCostUsat: 175 })
  })
  it('outbound keeps the average and can go negative (spec: never block a sale)', () => {
    const s1 = applyMovement(EMPTY_COST_STATE, { qtyMilli: 1_000, unitCostUsat: 100 })
    const s2 = applyMovement(s1, { qtyMilli: -1_500, unitCostUsat: 100 })
    expect(s2).toEqual({ onHandMilli: -500, avgCostUsat: 100 })
  })
  it('inbound when on hand <= 0 resets the average to the new cost', () => {
    const s = applyMovement({ onHandMilli: -500, avgCostUsat: 100 }, { qtyMilli: 1_000, unitCostUsat: 300 })
    expect(s).toEqual({ onHandMilli: 500, avgCostUsat: 300 })
  })
  it('average is always between min and max inbound cost and never NaN', () => {
    fc.assert(fc.property(fc.array(fc.record({ qtyMilli: milliArb, unitCostUsat: usatArb }), { minLength: 1, maxLength: 30 }), (ins) => {
      const s = rebuildCostState(ins)
      const costs = ins.map((m) => m.unitCostUsat)
      expect(Number.isSafeInteger(s.avgCostUsat)).toBe(true)
      expect(s.avgCostUsat).toBeGreaterThanOrEqual(Math.min(...costs))
      expect(s.avgCostUsat).toBeLessThanOrEqual(Math.max(...costs))
      expect(s.onHandMilli).toBe(ins.reduce((a, m) => a + m.qtyMilli, 0))
    }))
  })
})

describe('productionMovements', () => {
  const thaiBase: Bom = {
    itemId: 'PB-TEA-THAI',
    yieldMilli: 3_000_000,
    lines: [{ itemId: 'RM-TEA-02', qtyMilli: 180_000 }, { itemId: 'RM-TEA-01', qtyMilli: 120_000 }, { itemId: 'RM-WTR-02', qtyMilli: 3_300_000 }],
  }
  const costOf = (id: string) => ({ 'RM-TEA-02': 19_000_000, 'RM-TEA-01': 19_250_000, 'RM-WTR-02': 75_000 })[id] ?? 0

  it('one standard batch: components out, base in at 0.019925 baht/ml', () => {
    const r = productionMovements(thaiBase, 10_000, 3_000_000, costOf, 'b1')
    expect(r.outs).toEqual([
      { itemId: 'RM-TEA-02', kind: 'PRODUCE_OUT', qtyMilli: -180_000, unitCostUsat: 19_000_000, refType: 'production_batch', refId: 'b1' },
      { itemId: 'RM-TEA-01', kind: 'PRODUCE_OUT', qtyMilli: -120_000, unitCostUsat: 19_250_000, refType: 'production_batch', refId: 'b1' },
      { itemId: 'RM-WTR-02', kind: 'PRODUCE_OUT', qtyMilli: -3_300_000, unitCostUsat: 75_000, refType: 'production_batch', refId: 'b1' },
    ])
    expect(r.inn).toEqual({ itemId: 'PB-TEA-THAI', kind: 'PRODUCE_IN', qtyMilli: 3_000_000, unitCostUsat: 1_992_500, refType: 'production_batch', refId: 'b1' })
    expect(r.batchCostSatang).toBe(5978) // 59.775 baht
  })
  it('scales components by scaleBp (0.2 batch = 600 ml)', () => {
    const r = productionMovements(thaiBase, 2_000, 600_000, costOf, 'b2')
    expect(r.outs.map((m) => m.qtyMilli)).toEqual([-36_000, -24_000, -660_000])
    expect(r.inn.qtyMilli).toBe(600_000)
    expect(r.inn.unitCostUsat).toBe(1_992_500)
  })
  it('lower actual yield raises unit cost (cost is conserved)', () => {
    const r = productionMovements(thaiBase, 10_000, 2_500_000, costOf, 'b3')
    expect(r.inn.unitCostUsat).toBe(2_391_000)
    const outCost = r.outs.reduce((a, m) => a + costSatang(-m.qtyMilli, m.unitCostUsat), 0)
    expect(Math.abs(outCost - costSatang(r.inn.qtyMilli, r.inn.unitCostUsat))).toBeLessThanOrEqual(r.outs.length + 1)
  })
  it('rejects non-positive yield or scale', () => {
    expect(() => productionMovements(thaiBase, 0, 1, costOf, 'b')).toThrow(RangeError)
    expect(() => productionMovements(thaiBase, 10_000, 0, costOf, 'b')).toThrow(RangeError)
  })
})
```

- [ ] **Step 2: รันให้ตก**

Run: `pnpm --filter @dayo/domain test`
Expected: FAIL — cannot resolve `../src/stock/movements.js`

- [ ] **Step 3: เขียน movements.ts**

`packages/domain/src/stock/movements.ts`
```ts
import { costSatang } from '../money.js'

export type MovementKind =
  | 'OPENING' | 'PURCHASE' | 'SALE' | 'VOID_RETURN' | 'PRODUCE_OUT' | 'PRODUCE_IN'
  | 'WASTE' | 'EXPIRED' | 'COUNT_ADJ' | 'TRIAL' | 'TRANSFER'

export type MovementDraft = {
  itemId: string
  kind: MovementKind
  qtyMilli: number
  unitCostUsat: number
  refType: string
  refId: string
}

export type CostOf = (itemId: string) => number

export function saleMovements(needs: ReadonlyMap<string, number>, costOf: CostOf, orderId: string): MovementDraft[] {
  const out: MovementDraft[] = []
  for (const [itemId, need] of needs) {
    if (need === 0) continue
    out.push({ itemId, kind: 'SALE', qtyMilli: -need, unitCostUsat: costOf(itemId), refType: 'order', refId: orderId })
  }
  return out
}

export function voidReturnMovements(sale: readonly MovementDraft[], orderId: string): MovementDraft[] {
  return sale.map((m) => ({ ...m, kind: 'VOID_RETURN', qtyMilli: -m.qtyMilli, refType: 'order', refId: orderId }))
}

export function needsCostSatang(needs: ReadonlyMap<string, number>, costOf: CostOf): number {
  let total = 0
  for (const [itemId, need] of needs) total += costSatang(need, costOf(itemId))
  return total
}
```

- [ ] **Step 4: เขียน costing.ts**

`packages/domain/src/stock/costing.ts`
```ts
import { assertSafeInt, roundDivBig } from '../money.js'
import type { Bom } from './catalog.js'
import type { CostOf, MovementDraft } from './movements.js'

export type CostState = { onHandMilli: number; avgCostUsat: number }
export const EMPTY_COST_STATE: CostState = { onHandMilli: 0, avgCostUsat: 0 }

export function applyMovement(s: CostState, m: { qtyMilli: number; unitCostUsat: number }): CostState {
  assertSafeInt(m.qtyMilli, 'qtyMilli')
  assertSafeInt(m.unitCostUsat, 'unitCostUsat')
  if (m.qtyMilli <= 0) return { onHandMilli: s.onHandMilli + m.qtyMilli, avgCostUsat: s.avgCostUsat }
  if (s.onHandMilli <= 0) return { onHandMilli: s.onHandMilli + m.qtyMilli, avgCostUsat: m.unitCostUsat }
  const num = BigInt(s.onHandMilli) * BigInt(s.avgCostUsat) + BigInt(m.qtyMilli) * BigInt(m.unitCostUsat)
  const den = BigInt(s.onHandMilli + m.qtyMilli)
  return { onHandMilli: s.onHandMilli + m.qtyMilli, avgCostUsat: Number(roundDivBig(num, den)) }
}

export function rebuildCostState(movements: readonly { qtyMilli: number; unitCostUsat: number }[]): CostState {
  return movements.reduce(applyMovement, EMPTY_COST_STATE)
}

export function productionMovements(
  bom: Bom,
  scaleBp: number,
  yieldActualMilli: number,
  costOf: CostOf,
  batchId: string,
): { outs: MovementDraft[]; inn: MovementDraft; batchCostSatang: number; unitCostUsat: number } {
  assertSafeInt(scaleBp, 'scaleBp')
  assertSafeInt(yieldActualMilli, 'yieldActualMilli')
  if (scaleBp <= 0) throw new RangeError('scaleBp must be > 0')
  if (yieldActualMilli <= 0) throw new RangeError('yieldActualMilli must be > 0')
  const ref = { refType: 'production_batch', refId: batchId } as const
  let totalMilliUsat = 0n
  const outs: MovementDraft[] = []
  for (const line of bom.lines) {
    const qty = Number(roundDivBig(BigInt(line.qtyMilli) * BigInt(scaleBp), 10_000n))
    if (qty === 0) continue
    const unitCostUsat = costOf(line.itemId)
    totalMilliUsat += BigInt(qty) * BigInt(unitCostUsat)
    outs.push({ itemId: line.itemId, kind: 'PRODUCE_OUT', qtyMilli: -qty, unitCostUsat, ...ref })
  }
  const unitCostUsat = Number(roundDivBig(totalMilliUsat, BigInt(yieldActualMilli)))
  const inn: MovementDraft = { itemId: bom.itemId, kind: 'PRODUCE_IN', qtyMilli: yieldActualMilli, unitCostUsat, ...ref }
  return { outs, inn, batchCostSatang: Number(roundDivBig(totalMilliUsat, 1_000_000_000n)), unitCostUsat }
}
```

เพิ่มใน `packages/domain/src/index.ts`:
```ts
export * from './stock/movements.js'
export * from './stock/costing.js'
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `pnpm --filter @dayo/domain test && pnpm --filter @dayo/domain typecheck`
Expected: PASS (ค่า 2_391_000 = 5,977,500,000,000 ÷ 2,500,000)

- [ ] **Step 6: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): stock movements, moving-average costing and base production"
```

---

### Task 7: stock/count.ts + shift.ts — นับสต็อกและปิดกะ (spec §4.5, §4.8)

**Files:**
- Create: `packages/domain/src/stock/count.ts`, `packages/domain/src/shift.ts`, `packages/domain/test/count.test.ts`, `packages/domain/test/shift.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: `costSatang`, `roundDiv`, `assertSafeInt` (money.ts) · `canonicalJson`, `sha256Hex` (hash.ts) · `MovementDraft` (movements.ts)
- Produces:
  - `type CountLineInput = { itemId: string; expectedUseMilli: number; countedUnitsMilli: number; qtyPerUnitMilli: number; avgCostUsat: number }`
  - `type CountLineResult = CountLineInput & { countedUseMilli: number; varianceUseMilli: number; varianceSatang: number }`
  - `countLineResult(i: CountLineInput): CountLineResult` — countedUse = round(countedUnits × qtyPerUnit ÷ 1000)
  - `countAdjustmentMovements(lines: readonly CountLineResult[], countId: string): MovementDraft[]` — เฉพาะ variance ≠ 0, kind COUNT_ADJ, refType `'stock_count'`
  - `type CashInputs = { openingFloatSatang: number; cashSalesSatang: number; cashRefundsSatang: number; paidInSatang: number; paidOutSatang: number; dropsSatang: number }`
  - `expectedCashSatang(x: CashInputs): number` = opening + sales − refunds + paidIn − paidOut − drops
  - `type ZInput = { shiftId: string; businessDate: string; deviceId: string; closedAt: string; closedBy: string; orderCount: number; voidCount: number; grossSalesSatang: number; discountSatang: number; netSalesSatang: number; voidedSatang: number; cashSalesSatang: number; qrSalesSatang: number; cash: CashInputs; countedCashSatang: number; varianceReason: string | null }`
  - `buildZReport(input: ZInput, prevGrandTotalSatang: number): { snapshot: ZInput & { expectedCashSatang: number; cashVarianceSatang: number; grandTotalSatang: number }; hash: string }`

- [ ] **Step 1: เขียนเทสต์ให้ตก**

`packages/domain/test/count.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { countAdjustmentMovements, countLineResult } from '../src/stock/count.js'

describe('countLineResult', () => {
  it('converts 3.5 bags of 400 g tea to 1,400 g and prices the shortage', () => {
    const r = countLineResult({ itemId: 'RM-TEA-01', expectedUseMilli: 1_500_000, countedUnitsMilli: 3_500, qtyPerUnitMilli: 400_000, avgCostUsat: 19_250_000 })
    expect(r.countedUseMilli).toBe(1_400_000)
    expect(r.varianceUseMilli).toBe(-100_000)
    expect(r.varianceSatang).toBe(-1925) // −19.25 baht
  })
  it('zero variance when counted equals expected', () => {
    const r = countLineResult({ itemId: 'x', expectedUseMilli: 50_000, countedUnitsMilli: 1_000, qtyPerUnitMilli: 50_000, avgCostUsat: 200_000_000 })
    expect(r.varianceUseMilli).toBe(0)
    expect(r.varianceSatang).toBe(0)
  })
})

describe('countAdjustmentMovements', () => {
  it('emits COUNT_ADJ only for non-zero variances at average cost', () => {
    const lines = [
      countLineResult({ itemId: 'a', expectedUseMilli: 100, countedUnitsMilli: 100_000, qtyPerUnitMilli: 1_000, avgCostUsat: 5 }),
      countLineResult({ itemId: 'b', expectedUseMilli: 100, countedUnitsMilli: 100, qtyPerUnitMilli: 1_000, avgCostUsat: 5 }),
    ]
    expect(countAdjustmentMovements(lines, 'c1')).toEqual([
      { itemId: 'a', kind: 'COUNT_ADJ', qtyMilli: 99_900, unitCostUsat: 5, refType: 'stock_count', refId: 'c1' },
    ])
  })
})
```

หมายเหตุ: บรรทัด `a` counted = 100,000 × 1,000 ÷ 1,000 = 100,000 milli → variance = 99,900 · บรรทัด `b` counted = 100 → variance 0 จึงไม่มี movement

`packages/domain/test/shift.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { buildZReport, expectedCashSatang, type ZInput } from '../src/shift.js'

const cash = { openingFloatSatang: 100_000, cashSalesSatang: 523_000, cashRefundsSatang: 4_500, paidInSatang: 0, paidOutSatang: 20_000, dropsSatang: 300_000 }

describe('expectedCashSatang', () => {
  it('opening + sales − refunds + paid in − paid out − drops', () => {
    expect(expectedCashSatang(cash)).toBe(100_000 + 523_000 - 4_500 - 20_000 - 300_000)
  })
})

describe('buildZReport', () => {
  const input: ZInput = {
    shiftId: 's1', businessDate: '2026-09-17', deviceId: 'dev-A', closedAt: '2026-09-17T13:05:00.000Z', closedBy: 'u1',
    orderCount: 120, voidCount: 2, grossSalesSatang: 700_000, discountSatang: 5_000, netSalesSatang: 695_000, voidedSatang: 9_000,
    cashSalesSatang: 523_000, qrSalesSatang: 172_000, cash, countedCashSatang: 298_000, varianceReason: null,
  }
  it('computes expected cash, variance and running grand total', () => {
    const z = buildZReport(input, 10_000_000)
    expect(z.snapshot.expectedCashSatang).toBe(298_500)
    expect(z.snapshot.cashVarianceSatang).toBe(-500)
    expect(z.snapshot.grandTotalSatang).toBe(10_695_000)
    expect(z.hash).toHaveLength(64)
  })
  it('hash changes when any number changes', () => {
    const a = buildZReport(input, 0).hash
    const b = buildZReport({ ...input, netSalesSatang: 695_001 }, 0).hash
    expect(a).not.toBe(b)
    expect(buildZReport(input, 0).hash).toBe(a)
  })
})
```

- [ ] **Step 2: รันให้ตก**

Run: `pnpm --filter @dayo/domain test`
Expected: FAIL — cannot resolve `../src/stock/count.js` / `../src/shift.js`

- [ ] **Step 3: เขียน count.ts**

`packages/domain/src/stock/count.ts`
```ts
import { assertSafeInt, costSatang, roundDiv } from '../money.js'
import type { MovementDraft } from './movements.js'

export type CountLineInput = {
  itemId: string
  expectedUseMilli: number
  countedUnitsMilli: number   // e.g. 3.5 bags → 3_500
  qtyPerUnitMilli: number     // e.g. 400 g per bag → 400_000
  avgCostUsat: number
}
export type CountLineResult = CountLineInput & { countedUseMilli: number; varianceUseMilli: number; varianceSatang: number }

export function countLineResult(i: CountLineInput): CountLineResult {
  assertSafeInt(i.expectedUseMilli, 'expectedUseMilli')
  assertSafeInt(i.countedUnitsMilli, 'countedUnitsMilli')
  assertSafeInt(i.qtyPerUnitMilli, 'qtyPerUnitMilli')
  const countedUseMilli = roundDiv(i.countedUnitsMilli * i.qtyPerUnitMilli, 1_000)
  const varianceUseMilli = countedUseMilli - i.expectedUseMilli
  return { ...i, countedUseMilli, varianceUseMilli, varianceSatang: costSatang(varianceUseMilli, i.avgCostUsat) }
}

export function countAdjustmentMovements(lines: readonly CountLineResult[], countId: string): MovementDraft[] {
  return lines
    .filter((l) => l.varianceUseMilli !== 0)
    .map((l) => ({ itemId: l.itemId, kind: 'COUNT_ADJ' as const, qtyMilli: l.varianceUseMilli, unitCostUsat: l.avgCostUsat, refType: 'stock_count', refId: countId }))
}
```

- [ ] **Step 4: เขียน shift.ts**

`packages/domain/src/shift.ts`
```ts
import { canonicalJson, sha256Hex } from './hash.js'

export type CashInputs = {
  openingFloatSatang: number
  cashSalesSatang: number
  cashRefundsSatang: number
  paidInSatang: number
  paidOutSatang: number
  dropsSatang: number
}

export function expectedCashSatang(x: CashInputs): number {
  return x.openingFloatSatang + x.cashSalesSatang - x.cashRefundsSatang + x.paidInSatang - x.paidOutSatang - x.dropsSatang
}

export type ZInput = {
  shiftId: string
  businessDate: string
  deviceId: string
  closedAt: string
  closedBy: string
  orderCount: number
  voidCount: number
  grossSalesSatang: number
  discountSatang: number
  netSalesSatang: number
  voidedSatang: number
  cashSalesSatang: number
  qrSalesSatang: number
  cash: CashInputs
  countedCashSatang: number
  varianceReason: string | null
}

export type ZSnapshot = ZInput & { expectedCashSatang: number; cashVarianceSatang: number; grandTotalSatang: number }

/** Frozen Z report: computed once at shift close, never recomputed (spec §4.8). */
export function buildZReport(input: ZInput, prevGrandTotalSatang: number): { snapshot: ZSnapshot; hash: string } {
  const expected = expectedCashSatang(input.cash)
  const snapshot: ZSnapshot = {
    ...input,
    expectedCashSatang: expected,
    cashVarianceSatang: input.countedCashSatang - expected,
    grandTotalSatang: prevGrandTotalSatang + input.netSalesSatang,
  }
  return { snapshot, hash: sha256Hex(canonicalJson(snapshot)) }
}
```

เพิ่มใน `packages/domain/src/index.ts`:
```ts
export * from './stock/count.js'
export * from './shift.js'
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `pnpm --filter @dayo/domain test && pnpm --filter @dayo/domain typecheck`
Expected: PASS · ตอนนี้ `domain` ครบทุกกฎใน spec §4 ยกเว้นการตัดสินใจระดับ workflow (ทำในแอป)

- [ ] **Step 6: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): stock count variance and frozen Z report"
```

---

### Task 8: packages/contracts — enum และ Seed schema

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/vitest.config.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/enums.ts`, `packages/contracts/src/seed.ts`, `packages/contracts/test/seed.test.ts`

**Interfaces:**
- Produces (แพ็กเกจ `@dayo/contracts`):
  - Zod enums + TS types: `ItemKind` (`raw|prepared|packaging_set`), `MovementKind` (11 ค่าเดียวกับ domain), `OrderStatus` (`open|pending_payment|pending_verify|paid|ready|picked_up|cancelled|rejected|voided`), `OrderOrigin` (`device|server`), `PaymentMethod` (`CASH|PROMPTPAY`), `VerifyStatus` (`manual|verified|pending`), `EventType` (14 ค่าใน spec §3.4), `ActorType` (`user|customer|system`), `UserRole` (`owner|staff`), `ShiftStatus` (`open|closed`), `CountStatus` (`open|closed`), `CashMovementKind` (`PAID_IN|PAID_OUT|DROP`), `UseUnit` (`g|ml|ชิ้น|ชุด`)
  - `SeedSchema` และ `type Seed = z.infer<typeof SeedSchema>` (โครงด้านล่าง) · `parseSeed(json: unknown): Seed`

- [ ] **Step 1: สร้างแพ็กเกจ**

`packages/contracts/package.json`
```json
{
  "name": "@dayo/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "zod": "^4.6.0" },
  "devDependencies": { "typescript": "~5.9.0", "vitest": "^5.0.0" }
}
```
`packages/contracts/tsconfig.json` และ `vitest.config.ts` — เนื้อหาเหมือนของ `packages/domain` ทุกตัวอักษร (extends `../../tsconfig.base.json`, include `src` + `test`; vitest include `test/**/*.test.ts`)

- [ ] **Step 2: เขียนเทสต์ให้ตก**

`packages/contracts/test/seed.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { MovementKind, OrderStatus, SeedSchema, parseSeed } from '../src/index.js'

const minimal = {
  categories: [{ code: 'THAI', name: 'ชาไทย', sort: 1 }],
  sizes: [{ code: '16oz', name: '16 oz', sort: 1, packagingItemCode: 'PK-SET-16' }],
  sweetness: [{ code: 'S050', name: '50%', sort: 3, isDefault: true }],
  channels: [{ code: 'STORE', name: 'หน้าร้าน', commissionBp: 0 }],
  items: [
    { code: 'PK-CUP-01', name: 'แก้ว 16 oz', kind: 'raw', category: 'แก้ว', useUnit: 'ชิ้น', isTracked: true, reorderPointMilli: 100_000, standardCostUsat: 200_000_000, shelfLifeHours: null, note: null },
    { code: 'PK-SET-16', name: 'บรรจุภัณฑ์ 16 oz', kind: 'packaging_set', category: 'บรรจุภัณฑ์', useUnit: 'ชุด', isTracked: false, reorderPointMilli: 0, standardCostUsat: 0, shelfLifeHours: null, note: null },
  ],
  purchaseUnits: [{ itemCode: 'PK-CUP-01', name: 'แพ็ค', qtyPerUnitMilli: 50_000, isDefault: true }],
  boms: [{ itemCode: 'PK-SET-16', yieldMilli: 1_000, lines: [{ itemCode: 'PK-CUP-01', qtyMilli: 1_000 }] }],
  products: [{ code: 'Original', nameTh: 'ชาไทยเย็น', nameEn: 'Original', categoryCode: 'THAI', sort: 1, prepGroup: 'เย็นธรรมดา' }],
  variants: [{ productCode: 'Original', sizeCode: '16oz', sku: 'Original-16oz' }],
  prices: [{ productCode: 'Original', sizeCode: '16oz', channelCode: 'STORE', priceSatang: 4500 }],
  recipes: [{ productCode: 'Original', sizeCode: '16oz', sweetnessCode: 'S050', lines: [{ itemCode: 'PK-SET-16', qtyMilli: 1_000 }], excelCostSatang: 400, excelLiquidMilli: 0 }],
  equipment: [{ code: 'EQ-001', name: 'เหยือก', purchasedAt: '2026-08-31', priceSatang: 13_800, qty: 1, supplier: 'Mr. DIY', lifeYears: 3, condition: 'ใช้งานได้', owner: 'TungAo', note: null }],
}

describe('SeedSchema', () => {
  it('accepts a minimal valid seed', () => {
    expect(parseSeed(minimal).items).toHaveLength(2)
  })
  it('rejects unknown item kind, negative money and non-integer milli', () => {
    expect(() => parseSeed({ ...minimal, items: [{ ...minimal.items[0], kind: 'liquid' }] })).toThrow()
    expect(() => parseSeed({ ...minimal, prices: [{ ...minimal.prices[0], priceSatang: -1 }] })).toThrow()
    expect(() => parseSeed({ ...minimal, boms: [{ ...minimal.boms[0], yieldMilli: 1.5 }] })).toThrow()
  })
  it('rejects a recipe line that references an unknown item code (refinement)', () => {
    const bad = { ...minimal, recipes: [{ ...minimal.recipes[0], lines: [{ itemCode: 'NOPE', qtyMilli: 1 }] }] }
    expect(() => parseSeed(bad)).toThrow(/NOPE/)
  })
  it('exposes enums', () => {
    expect(OrderStatus.options).toContain('pending_verify')
    expect(MovementKind.options).toHaveLength(11)
    expect(SeedSchema).toBeDefined()
  })
})
```

- [ ] **Step 3: รันให้ตก**

Run: `pnpm install && pnpm --filter @dayo/contracts test`
Expected: FAIL — cannot resolve `../src/index.js`

- [ ] **Step 4: เขียน enums.ts**

`packages/contracts/src/enums.ts`
```ts
import { z } from 'zod'

export const ItemKind = z.enum(['raw', 'prepared', 'packaging_set'])
export type ItemKind = z.infer<typeof ItemKind>

export const UseUnit = z.enum(['g', 'ml', 'ชิ้น', 'ชุด'])
export type UseUnit = z.infer<typeof UseUnit>

export const MovementKind = z.enum(['OPENING', 'PURCHASE', 'SALE', 'VOID_RETURN', 'PRODUCE_OUT', 'PRODUCE_IN', 'WASTE', 'EXPIRED', 'COUNT_ADJ', 'TRIAL', 'TRANSFER'])
export type MovementKind = z.infer<typeof MovementKind>

export const OrderStatus = z.enum(['open', 'pending_payment', 'pending_verify', 'paid', 'ready', 'picked_up', 'cancelled', 'rejected', 'voided'])
export type OrderStatus = z.infer<typeof OrderStatus>

export const OrderOrigin = z.enum(['device', 'server'])
export type OrderOrigin = z.infer<typeof OrderOrigin>

export const PaymentMethod = z.enum(['CASH', 'PROMPTPAY'])
export type PaymentMethod = z.infer<typeof PaymentMethod>

export const VerifyStatus = z.enum(['manual', 'verified', 'pending'])
export type VerifyStatus = z.infer<typeof VerifyStatus>

export const EventType = z.enum(['CREATED', 'LINE_ADDED', 'LINE_REMOVED', 'DISCOUNT_APPLIED', 'PAYMENT_CLAIMED', 'PAID', 'READY', 'PICKED_UP', 'CANCELLED', 'REJECTED', 'VOIDED', 'STOCK_DEDUCTED', 'STOCK_RETURNED', 'NOTE'])
export type EventType = z.infer<typeof EventType>

export const ActorType = z.enum(['user', 'customer', 'system'])
export type ActorType = z.infer<typeof ActorType>

export const UserRole = z.enum(['owner', 'staff'])
export type UserRole = z.infer<typeof UserRole>

export const ShiftStatus = z.enum(['open', 'closed'])
export type ShiftStatus = z.infer<typeof ShiftStatus>

export const CountStatus = z.enum(['open', 'closed'])
export type CountStatus = z.infer<typeof CountStatus>

export const CashMovementKind = z.enum(['PAID_IN', 'PAID_OUT', 'DROP'])
export type CashMovementKind = z.infer<typeof CashMovementKind>
```

- [ ] **Step 5: เขียน seed.ts และ index.ts**

`packages/contracts/src/seed.ts`
```ts
import { z } from 'zod'
import { ItemKind, UseUnit } from './enums.js'

const int = z.number().int()
const nonneg = int.nonnegative()
const pos = int.positive()
const code = z.string().min(1)

export const SeedCategory = z.object({ code, name: z.string().min(1), sort: nonneg })
export const SeedSize = z.object({ code, name: z.string().min(1), sort: nonneg, packagingItemCode: code })
export const SeedSweetness = z.object({ code, name: z.string().min(1), sort: nonneg, isDefault: z.boolean() })
export const SeedChannel = z.object({ code, name: z.string().min(1), commissionBp: nonneg })
export const SeedItem = z.object({
  code,
  name: z.string().min(1),
  kind: ItemKind,
  category: z.string().min(1),
  useUnit: UseUnit,
  isTracked: z.boolean(),
  reorderPointMilli: nonneg,
  standardCostUsat: nonneg,
  shelfLifeHours: pos.nullable(),
  note: z.string().nullable(),
})
export const SeedPurchaseUnit = z.object({ itemCode: code, name: z.string().min(1), qtyPerUnitMilli: pos, isDefault: z.boolean() })
export const SeedBom = z.object({ itemCode: code, yieldMilli: pos, lines: z.array(z.object({ itemCode: code, qtyMilli: pos })).min(1) })
export const SeedProduct = z.object({ code, nameTh: z.string().min(1), nameEn: z.string().min(1), categoryCode: code, sort: nonneg, prepGroup: z.string().nullable() })
export const SeedVariant = z.object({ productCode: code, sizeCode: code, sku: code })
export const SeedPrice = z.object({ productCode: code, sizeCode: code, channelCode: code, priceSatang: nonneg })
export const SeedRecipe = z.object({
  productCode: code,
  sizeCode: code,
  sweetnessCode: code,
  lines: z.array(z.object({ itemCode: code, qtyMilli: pos })).min(1),
  excelCostSatang: nonneg,
  excelLiquidMilli: nonneg,
})
export const SeedEquipment = z.object({
  code,
  name: z.string().min(1),
  purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  priceSatang: nonneg,
  qty: pos,
  supplier: z.string().nullable(),
  lifeYears: z.number().positive().nullable(),
  condition: z.string().nullable(),
  owner: z.string().nullable(),
  note: z.string().nullable(),
})

export const SeedSchema = z
  .object({
    categories: z.array(SeedCategory).min(1),
    sizes: z.array(SeedSize).min(1),
    sweetness: z.array(SeedSweetness).min(1),
    channels: z.array(SeedChannel).min(1),
    items: z.array(SeedItem).min(1),
    purchaseUnits: z.array(SeedPurchaseUnit),
    boms: z.array(SeedBom),
    products: z.array(SeedProduct).min(1),
    variants: z.array(SeedVariant).min(1),
    prices: z.array(SeedPrice).min(1),
    recipes: z.array(SeedRecipe).min(1),
    equipment: z.array(SeedEquipment),
  })
  .superRefine((s, ctx) => {
    const items = new Set(s.items.map((i) => i.code))
    const products = new Set(s.products.map((p) => p.code))
    const sizes = new Set(s.sizes.map((x) => x.code))
    const sweet = new Set(s.sweetness.map((x) => x.code))
    const channels = new Set(s.channels.map((x) => x.code))
    const cats = new Set(s.categories.map((x) => x.code))
    const need = (ok: boolean, path: (string | number)[], msg: string) => { if (!ok) ctx.addIssue({ code: 'custom', path, message: msg }) }
    s.sizes.forEach((x, i) => need(items.has(x.packagingItemCode), ['sizes', i], `unknown item ${x.packagingItemCode}`))
    s.purchaseUnits.forEach((x, i) => need(items.has(x.itemCode), ['purchaseUnits', i], `unknown item ${x.itemCode}`))
    s.boms.forEach((b, i) => {
      need(items.has(b.itemCode), ['boms', i], `unknown item ${b.itemCode}`)
      b.lines.forEach((l, j) => need(items.has(l.itemCode), ['boms', i, 'lines', j], `unknown item ${l.itemCode}`))
    })
    s.products.forEach((p, i) => need(cats.has(p.categoryCode), ['products', i], `unknown category ${p.categoryCode}`))
    s.variants.forEach((v, i) => need(products.has(v.productCode) && sizes.has(v.sizeCode), ['variants', i], `unknown product/size ${v.productCode}/${v.sizeCode}`))
    s.prices.forEach((p, i) => need(products.has(p.productCode) && sizes.has(p.sizeCode) && channels.has(p.channelCode), ['prices', i], `unknown ref in price ${p.productCode}`))
    s.recipes.forEach((r, i) => {
      need(products.has(r.productCode) && sizes.has(r.sizeCode) && sweet.has(r.sweetnessCode), ['recipes', i], `unknown ref in recipe ${r.productCode}`)
      r.lines.forEach((l, j) => need(items.has(l.itemCode), ['recipes', i, 'lines', j], `unknown item ${l.itemCode}`))
    })
  })

export type Seed = z.infer<typeof SeedSchema>

export function parseSeed(json: unknown): Seed {
  const r = SeedSchema.safeParse(json)
  if (!r.success) throw new Error(`invalid seed: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return r.data
}
```

`packages/contracts/src/index.ts`
```ts
export * from './enums.js'
export * from './seed.js'
```

- [ ] **Step 6: รันให้ผ่าน**

Run: `pnpm --filter @dayo/contracts test && pnpm --filter @dayo/contracts typecheck`
Expected: PASS (ถ้า `ctx.addIssue({ code: 'custom' })` type ไม่ผ่านใน zod เวอร์ชันที่ติดตั้ง ให้ใช้ `z.ZodIssueCode.custom`)

- [ ] **Step 7: Commit**

```bash
git add packages/contracts pnpm-lock.yaml
git commit -m "feat(contracts): shared enums and Excel seed schema"
```

---

### Task 9: excel-import — โครงแพ็กเกจ, helper อ่าน cell, ค่าคงที่, และชีต "สินค้าและสต็อก"

**Files:**
- Create: `packages/excel-import/package.json`, `tsconfig.json`, `vitest.config.ts`, `fixtures/DA-YO_เมนู.xlsx`, `src/cells.ts`, `src/constants.ts`, `src/parse-items.ts`, `test/parse-items.test.ts`, `test/workbook.ts`

**Interfaces:**
- Produces (แพ็กเกจ `@dayo/excel-import`):
  - `openWorkbook(path: string): Promise<ExcelJS.Workbook>` (test/workbook.ts: `loadFixture()` เปิด fixture)
  - `cellValue(ws, row, col): unknown` · `str(ws, row, col): string` (trim, '' ถ้าว่าง) · `num(ws, row, col): number` (0 ถ้าว่าง, โยนถ้าไม่ใช่ตัวเลข) · `findRow(ws, pred: (row: number) => boolean, from = 1): number` (โยนถ้าไม่พบ) · `sheet(wb, name): ExcelJS.Worksheet` (โยนถ้าไม่พบ)
  - `constants.ts`: `SIZES`, `SWEETNESS`, `CHANNELS`, `CATEGORIES`, `PRODUCT_CATEGORY: Record<string, string>`, `RECIPE_INGREDIENT_TO_ITEM: Record<string, string>`, `PREPARED_ITEMS`, `PACKAGING_SETS`, `UNTRACKED_ITEM_CODES`, `SHELF_LIFE_HOURS`
  - `parseItems(wb): { items: SeedItem[]; purchaseUnits: SeedPurchaseUnit[] }` — เฉพาะของดิบ 32 รายการจากชีต

- [ ] **Step 1: สร้างแพ็กเกจและ fixture**

`packages/excel-import/package.json`
```json
{
  "name": "@dayo/excel-import",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "import": "tsx src/cli.ts"
  },
  "dependencies": {
    "@dayo/contracts": "workspace:*",
    "@dayo/domain": "workspace:*",
    "exceljs": "^4.4.0"
  },
  "devDependencies": { "@types/node": "^22.0.0", "tsx": "^4.20.0", "typescript": "~5.9.0", "vitest": "^5.0.0" }
}
```
(ใช้ `tsx` รัน CLI เพราะ import ในโค้ดเขียนเป็น `./x.js` ชี้ไฟล์ `.ts` ตามแบบ ESM ซึ่ง `node --experimental-strip-types` ไม่ resolve ให้ แต่ Vitest กับ tsx ทำได้)

`tsconfig.json`: เหมือน domain แต่ `"types": ["node"]` และ `"lib": ["ES2022"]` · `vitest.config.ts` เหมือน domain

Run:
```bash
mkdir -p packages/excel-import/fixtures && cp "/c/Users/chaya/OneDrive/Documents/DAYO/DA-YO_เมนู.xlsx" "packages/excel-import/fixtures/DA-YO_เมนู.xlsx" && pnpm install
```

- [ ] **Step 2: เขียน helper อ่าน cell และ workbook สำหรับเทสต์**

`packages/excel-import/src/cells.ts`
```ts
import ExcelJS from 'exceljs'

export async function openWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  return wb
}

export function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name)
  if (!ws) throw new Error(`sheet "${name}" not found; sheets: ${wb.worksheets.map((w) => w.name).join(', ')}`)
  return ws
}

/** Unwrap exceljs cell values: formula → cached result, rich text → plain text. */
export function cellValue(ws: ExcelJS.Worksheet, row: number, col: number): unknown {
  const v = ws.getCell(row, col).value as unknown
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return o['result'] ?? null
    if ('richText' in o) return (o['richText'] as { text: string }[]).map((t) => t.text).join('')
    if ('text' in o) return o['text']
    if ('error' in o) return null
  }
  return v
}

export function str(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const v = cellValue(ws, row, col)
  return v === null ? '' : String(v).trim()
}

export function num(ws: ExcelJS.Worksheet, row: number, col: number): number {
  const v = cellValue(ws, row, col)
  if (v === null || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  if (!Number.isFinite(n)) throw new Error(`${ws.name}!R${row}C${col} is not a number: ${String(v)}`)
  return n
}

export function findRow(ws: ExcelJS.Worksheet, pred: (row: number) => boolean, from = 1): number {
  const last = ws.rowCount
  for (let r = from; r <= last; r++) if (pred(r)) return r
  throw new Error(`row not found in sheet "${ws.name}"`)
}

/** Iterate rows from `start` while column `keyCol` is non-empty. */
export function* rowsWhile(ws: ExcelJS.Worksheet, start: number, keyCol: number): Generator<number> {
  for (let r = start; r <= ws.rowCount; r++) {
    if (str(ws, r, keyCol) === '') return
    yield r
  }
}

export function isoDate(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  return null
}
```

`packages/excel-import/test/workbook.ts`
```ts
import { fileURLToPath } from 'node:url'
import { openWorkbook } from '../src/cells.js'
import type ExcelJS from 'exceljs'

let cached: Promise<ExcelJS.Workbook> | undefined
export function loadFixture(): Promise<ExcelJS.Workbook> {
  cached ??= openWorkbook(fileURLToPath(new URL('../fixtures/DA-YO_เมนู.xlsx', import.meta.url)))
  return cached
}
```

- [ ] **Step 3: เขียน constants.ts**

`packages/excel-import/src/constants.ts`
```ts
// Values fixed by decisions D16, D27, D29 and the Excel sheets "Lists", "เบสและซับสูตร".

export const SIZES = [
  { code: '16oz', name: '16 oz', sort: 1, packagingItemCode: 'PK-SET-16', priceCol: 3 }, // ต้นทุนและราคา!C
  { code: '20oz', name: '20 oz', sort: 2, packagingItemCode: 'PK-SET-20', priceCol: 5 }, // ต้นทุนและราคา!E
  { code: '22oz', name: '22 oz', sort: 3, packagingItemCode: 'PK-SET-22', priceCol: 4 }, // ต้นทุนและราคา!D
] as const

export const SWEETNESS = [
  { code: 'S000', name: '0%', sort: 1, isDefault: false },
  { code: 'S025', name: '25%', sort: 2, isDefault: false },
  { code: 'S050', name: '50%', sort: 3, isDefault: true },
  { code: 'S075', name: '75%', sort: 4, isDefault: false },
  { code: 'S100', name: '100%', sort: 5, isDefault: false },
] as const

export const CHANNELS = [
  { code: 'STORE', name: 'หน้าร้าน', commissionBp: 0 },
  { code: 'LINE_OA', name: 'LINE OA', commissionBp: 0 },
  { code: 'GRAB', name: 'Grab', commissionBp: 3000 },
  { code: 'LINE_MAN', name: 'LINE MAN', commissionBp: 3000 },
  { code: 'OTHER', name: 'อื่นๆ', commissionBp: 0 },
] as const

export const CATEGORIES = [
  { code: 'THAI', name: 'ชาไทย', sort: 1 },
  { code: 'GREEN', name: 'ชาเขียว', sort: 2 },
  { code: 'MATCHA', name: 'มัทฉะพรีเมียม', sort: 3 },
] as const

export const PRODUCT_CATEGORY: Record<string, string> = {
  Original: 'THAI', Latte: 'THAI', 'Cream Cheese': 'THAI', 'Whip Cheese': 'THAI', 'Orange Latte': 'THAI', Cocoa: 'THAI',
  'Thai Tea Frappe': 'THAI', 'Coconut Frappe': 'THAI', 'Honey Milk': 'THAI', 'Coconut Tea': 'THAI', 'Lemon Tea': 'THAI',
  'Green Tea': 'GREEN', 'Green Coconut': 'GREEN', 'Green Honey Milk': 'GREEN', 'Green Berry Soda': 'GREEN', 'Green Tea Frappe': 'GREEN',
  'Green Latte': 'GREEN', 'Green Lemon Tea': 'GREEN', 'Green Honey Lemon': 'GREEN', 'Green Cream Cheese': 'GREEN',
  'Pure Matcha Premium': 'MATCHA', 'Matcha Latte Premium': 'MATCHA', 'Matcha Coconut Premium': 'MATCHA', 'Matcha Strawberry Premium': 'MATCHA',
}

/** Prepared items (bases) — code, display name, use unit, shelf life from sheet "เบสและซับสูตร" (null = not stated). */
export const PREPARED_ITEMS = [
  { code: 'PB-TEA-THAI', name: 'ชาไทยเบส', excelName: 'ชาไทยเบส', useUnit: 'ml', shelfLifeHours: 72 },
  { code: 'PB-TEA-GREEN', name: 'ชาเขียวเบส', excelName: 'ชาเขียวเบส', useUnit: 'ml', shelfLifeHours: 24 },
  { code: 'PB-SYRUP', name: 'น้ำเชื่อม 1:1', excelName: 'น้ำเชื่อม 1:1', useUnit: 'ml', shelfLifeHours: 336 },
  { code: 'PB-HONEY', name: 'น้ำผึ้งเจือจาง 2:1', excelName: 'น้ำผึ้งเจือจาง 2:1', useUnit: 'ml', shelfLifeHours: null },
  { code: 'PB-COCONUT', name: 'เบสมะพร้าว', excelName: 'เบสมะพร้าว', useUnit: 'ml', shelfLifeHours: null },
  { code: 'PB-CHEESE-FOAM', name: 'ครีมชีสโฟม / วิปชีส', excelName: 'ครีมชีส/วิปชีสโฟม', useUnit: 'g', shelfLifeHours: 12 },
  { code: 'PB-MATCHA-SHOT', name: 'มัทฉะช็อต (1 g : 10 ml)', excelName: 'มัทฉะช็อต', useUnit: 'ml', shelfLifeHours: 4 },
] as const

export const PACKAGING_SETS = [
  { code: 'PK-SET-16', name: 'บรรจุภัณฑ์ 16 oz', excelName: 'บรรจุภัณฑ์ 16 oz' },
  { code: 'PK-SET-20', name: 'บรรจุภัณฑ์ 20 oz', excelName: 'บรรจุภัณฑ์ 20 oz' },
  { code: 'PK-SET-22', name: 'บรรจุภัณฑ์ 22 oz', excelName: 'บรรจุภัณฑ์ 22 oz' },
] as const

/** Header names in sheet "ข้อมูลสูตร" (unit suffix stripped) → item code. 1:1 aliases point straight at the raw item. */
export const RECIPE_INGREDIENT_TO_ITEM: Record<string, string> = {
  'ชาไทยเบส': 'PB-TEA-THAI',
  'ชาเขียวเบส': 'PB-TEA-GREEN',
  'นมสด': 'RM-MLK-01',
  'นมข้นจืด': 'RM-MLK-02',
  'นมข้นหวาน': 'RM-MLK-03',
  'น้ำเชื่อม': 'PB-SYRUP',
  'น้ำผึ้งเจือจาง': 'PB-HONEY',
  'โกโก้ผง': 'RM-POW-01',
  'น้ำส้มคั้น': 'RM-JUI-01',
  'เบสมะพร้าว': 'PB-COCONUT',
  'ซอสสตรอว์เบอร์รี่': 'RM-SAU-01',
  'น้ำมะนาว': 'RM-JUI-03',
  'โซดา': 'RM-SOD-01',
  'ครีมชีส/วิปชีส': 'PB-CHEESE-FOAM',
  'น้ำแข็ง': 'RM-WTR-01',
  'มัทฉะช็อต': 'PB-MATCHA-SHOT',
  'น้ำดื่ม': 'RM-WTR-03',
}

/** Sheet "ต้นทุนเบส" BOM column B names that are 1:1 aliases of a raw item — no BOM is created for them. */
export const BOM_ALIAS_NAMES = new Set(['นมสด', 'นมข้นจืด', 'นมข้นหวาน', 'โกโก้ผง', 'น้ำส้มคั้น', 'ซอสสตรอว์เบอร์รี่', 'น้ำมะนาว', 'โซดา', 'น้ำแข็ง', 'น้ำดื่ม'])

/** D29: costed but not counted. */
export const UNTRACKED_ITEM_CODES = new Set(['RM-WTR-01', 'RM-WTR-02', 'RM-WTR-03', 'RM-SEA-01'])
```

- [ ] **Step 4: เขียนเทสต์ parse-items ให้ตก**

`packages/excel-import/test/parse-items.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { parseItems } from '../src/parse-items.js'
import { loadFixture } from './workbook.js'

describe('parseItems', () => {
  it('reads all 32 purchasable items with purchase units', async () => {
    const { items, purchaseUnits } = parseItems(await loadFixture())
    expect(items).toHaveLength(32)
    expect(purchaseUnits).toHaveLength(32)
    expect(items.every((i) => i.kind === 'raw')).toBe(true)
  })
  it('maps RM-TEA-01 exactly (400 g bag at 77 baht, reorder 400 g)', async () => {
    const { items, purchaseUnits } = parseItems(await loadFixture())
    const tea = items.find((i) => i.code === 'RM-TEA-01')!
    expect(tea).toMatchObject({ name: 'ชาไทยผงปรุงสำเร็จ ฉลากแดง', category: 'ชา/ผงชา', useUnit: 'g', isTracked: true, reorderPointMilli: 400_000, standardCostUsat: 19_250_000, shelfLifeHours: null })
    expect(purchaseUnits.find((u) => u.itemCode === 'RM-TEA-01')).toEqual({ itemCode: 'RM-TEA-01', name: 'ถุง', qtyPerUnitMilli: 400_000, isDefault: true })
  })
  it('marks ice, water and salt as untracked (D29) but still costed', async () => {
    const { items } = parseItems(await loadFixture())
    const ice = items.find((i) => i.code === 'RM-WTR-01')!
    expect(ice.isTracked).toBe(false)
    expect(ice.standardCostUsat).toBe(1_400_000) // 280 baht / 20,000 g = 0.014 baht/g
    expect(items.find((i) => i.code === 'RM-SEA-01')!.isTracked).toBe(false)
    expect(items.find((i) => i.code === 'PK-STR-01')!.isTracked).toBe(true)
  })
  it('handles the lime special case: bought per kg, yields 250 ml juice', async () => {
    const { items, purchaseUnits } = parseItems(await loadFixture())
    expect(items.find((i) => i.code === 'RM-JUI-03')!.useUnit).toBe('ml')
    expect(purchaseUnits.find((u) => u.itemCode === 'RM-JUI-03')).toMatchObject({ name: 'กิโลกรัม', qtyPerUnitMilli: 250_000 })
  })
})
```

Run: `pnpm --filter @dayo/excel-import test`
Expected: FAIL — cannot resolve `../src/parse-items.js`

- [ ] **Step 5: เขียน parse-items.ts**

`packages/excel-import/src/parse-items.ts`
```ts
import type ExcelJS from 'exceljs'
import type { z } from 'zod'
import { SeedItem, SeedPurchaseUnit, UseUnit } from '@dayo/contracts'
import { bahtToUsat } from '@dayo/domain'
import { num, rowsWhile, sheet, str } from './cells.js'
import { UNTRACKED_ITEM_CODES } from './constants.js'

type Item = z.infer<typeof SeedItem>
type PU = z.infer<typeof SeedPurchaseUnit>

const COL = { code: 1, name: 2, kind: 3, category: 4, purchaseUnit: 5, qtyPerUnit: 6, useUnit: 7, price: 8, reorder: 9, note: 10 } as const
const FIRST_ROW = 6

export function parseItems(wb: ExcelJS.Workbook): { items: Item[]; purchaseUnits: PU[] } {
  const ws = sheet(wb, 'สินค้าและสต็อก')
  if (str(ws, 5, COL.code) !== 'รหัสสินค้า') throw new Error('สินค้าและสต็อก: header row moved')
  const items: Item[] = []
  const purchaseUnits: PU[] = []
  for (const r of rowsWhile(ws, FIRST_ROW, COL.code)) {
    const code = str(ws, r, COL.code)
    const qtyPerUnit = num(ws, r, COL.qtyPerUnit)
    if (qtyPerUnit <= 0) throw new Error(`${code}: ปริมาณต่อหน่วยซื้อ must be > 0`)
    const pricePerUnit = num(ws, r, COL.price)
    const useUnit = UseUnit.parse(str(ws, r, COL.useUnit))
    items.push(
      SeedItem.parse({
        code,
        name: str(ws, r, COL.name),
        kind: 'raw',
        category: str(ws, r, COL.category),
        useUnit,
        isTracked: !UNTRACKED_ITEM_CODES.has(code),
        reorderPointMilli: Math.round(num(ws, r, COL.reorder) * 1000),
        standardCostUsat: bahtToUsat(pricePerUnit / qtyPerUnit),
        shelfLifeHours: null,
        note: str(ws, r, COL.note) || null,
      }),
    )
    purchaseUnits.push(SeedPurchaseUnit.parse({ itemCode: code, name: str(ws, r, COL.purchaseUnit), qtyPerUnitMilli: Math.round(qtyPerUnit * 1000), isDefault: true }))
  }
  return { items, purchaseUnits }
}
```

- [ ] **Step 6: รันให้ผ่าน**

Run: `pnpm --filter @dayo/excel-import test && pnpm --filter @dayo/excel-import typecheck`
Expected: PASS · ถ้า typecheck บ่นเรื่อง `import ExcelJS from 'exceljs'` ให้เพิ่ม `"esModuleInterop": true` ใน `tsconfig.base.json`

- [ ] **Step 7: Commit**

```bash
git add packages/excel-import tsconfig.base.json pnpm-lock.yaml
git commit -m "feat(excel-import): workbook helpers, constants and item sheet parser"
```

---

### Task 10: parse-boms.ts — เบส/ซับสูตร และชุดบรรจุภัณฑ์ จากชีต "ต้นทุนเบส"

**Files:**
- Create: `packages/excel-import/src/parse-boms.ts`, `packages/excel-import/test/parse-boms.test.ts`

**Interfaces:**
- Consumes: `sheet`, `str`, `num`, `findRow`, `rowsWhile` (cells.ts) · `PREPARED_ITEMS`, `PACKAGING_SETS`, `BOM_ALIAS_NAMES` (constants.ts)
- Produces: `parseBoms(wb): { items: SeedItem[]; boms: SeedBom[] }` — items = 7 prepared + 3 packaging_set (kind ตามชนิด, `isTracked: true` สำหรับ prepared, `false` สำหรับ packaging_set, `standardCostUsat: 0` เพราะคำนวณจาก BOM) · boms = 10 รายการ · yield จากตารางบน (คอลัมน์ D "ขนาด batch มาตรฐาน") · บรรทัด qty 0 ถูกข้าม

โครงชีต (ดู research 09 §4): ตารางบน แถว 6–25: A ลำดับ · B ชื่อวัตถุดิบในสูตร · C หน่วย · D batch มาตรฐาน · ตารางล่างเริ่มแถวที่ A = `รหัส BOM` (แถว 33): A รหัส · B ชื่อวัตถุดิบในสูตร · C รหัสสินค้า · E ปริมาณต่อ batch · F หน่วย

- [ ] **Step 1: เขียนเทสต์ให้ตก**

`packages/excel-import/test/parse-boms.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { parseBoms } from '../src/parse-boms.js'
import { loadFixture } from './workbook.js'

describe('parseBoms', () => {
  it('creates 7 prepared items and 3 packaging sets with 10 BOMs', async () => {
    const { items, boms } = parseBoms(await loadFixture())
    expect(items.filter((i) => i.kind === 'prepared')).toHaveLength(7)
    expect(items.filter((i) => i.kind === 'packaging_set')).toHaveLength(3)
    expect(boms).toHaveLength(10)
  })
  it('Thai tea base: 180 g + 120 g tea + 3,300 ml water → 3,000 ml, sugar/salt rows (0) skipped, shelf life 72 h', async () => {
    const { items, boms } = parseBoms(await loadFixture())
    const bom = boms.find((b) => b.itemCode === 'PB-TEA-THAI')!
    expect(bom.yieldMilli).toBe(3_000_000)
    expect(bom.lines).toEqual([
      { itemCode: 'RM-TEA-02', qtyMilli: 180_000 },
      { itemCode: 'RM-TEA-01', qtyMilli: 120_000 },
      { itemCode: 'RM-WTR-02', qtyMilli: 3_300_000 },
    ])
    expect(items.find((i) => i.code === 'PB-TEA-THAI')).toMatchObject({ kind: 'prepared', useUnit: 'ml', isTracked: true, shelfLifeHours: 72, standardCostUsat: 0 })
  })
  it('cheese foam yields 490 g from 5 components', async () => {
    const { boms } = parseBoms(await loadFixture())
    const foam = boms.find((b) => b.itemCode === 'PB-CHEESE-FOAM')!
    expect(foam.yieldMilli).toBe(490_000)
    expect(foam.lines.map((l) => l.itemCode)).toEqual(['RM-CRM-01', 'RM-CRM-02', 'RM-MLK-01', 'RM-MLK-03', 'RM-SEA-01'])
  })
  it('packaging set 16 oz = cup + lid + straw + sticker, 1 set = 1000 milli', async () => {
    const { boms } = parseBoms(await loadFixture())
    const set = boms.find((b) => b.itemCode === 'PK-SET-16')!
    expect(set.yieldMilli).toBe(1_000)
    expect(set.lines).toEqual([
      { itemCode: 'PK-CUP-01', qtyMilli: 1_000 },
      { itemCode: 'PK-LID-01', qtyMilli: 1_000 },
      { itemCode: 'PK-STR-01', qtyMilli: 1_000 },
      { itemCode: 'PK-LBL-01', qtyMilli: 1_000 },
    ])
  })
  it('does not create BOMs for 1:1 aliases such as นมสด', async () => {
    const { boms } = parseBoms(await loadFixture())
    expect(boms.some((b) => b.itemCode === 'RM-MLK-01')).toBe(false)
  })
})
```

Run: `pnpm --filter @dayo/excel-import test`
Expected: FAIL — cannot resolve `../src/parse-boms.js`

- [ ] **Step 2: เขียน parse-boms.ts**

`packages/excel-import/src/parse-boms.ts`
```ts
import type ExcelJS from 'exceljs'
import type { z } from 'zod'
import { SeedBom, SeedItem } from '@dayo/contracts'
import { findRow, num, rowsWhile, sheet, str } from './cells.js'
import { BOM_ALIAS_NAMES, PACKAGING_SETS, PREPARED_ITEMS } from './constants.js'

type Item = z.infer<typeof SeedItem>
type Bom = z.infer<typeof SeedBom>

export function parseBoms(wb: ExcelJS.Workbook): { items: Item[]; boms: Bom[] } {
  const ws = sheet(wb, 'ต้นทุนเบส')

  // Upper table: standard batch size per recipe ingredient name.
  const yieldByName = new Map<string, number>()
  const upperHeader = findRow(ws, (r) => str(ws, r, 1) === 'ลำดับ')
  for (const r of rowsWhile(ws, upperHeader + 1, 1)) {
    yieldByName.set(str(ws, r, 2), num(ws, r, 4))
  }

  // Lower table: BOM lines.
  const bomHeader = findRow(ws, (r) => str(ws, r, 1) === 'รหัส BOM')
  const linesByName = new Map<string, { itemCode: string; qtyMilli: number }[]>()
  for (const r of rowsWhile(ws, bomHeader + 1, 1)) {
    const name = str(ws, r, 2)
    if (BOM_ALIAS_NAMES.has(name)) continue
    const qty = num(ws, r, 5)
    if (qty === 0) continue
    const arr = linesByName.get(name) ?? []
    arr.push({ itemCode: str(ws, r, 3), qtyMilli: Math.round(qty * 1000) })
    linesByName.set(name, arr)
  }

  const items: Item[] = []
  const boms: Bom[] = []
  const takeBom = (code: string, excelName: string): Bom => {
    const yieldUnits = yieldByName.get(excelName)
    const lines = linesByName.get(excelName)
    if (!yieldUnits || yieldUnits <= 0) throw new Error(`no batch size for "${excelName}"`)
    if (!lines || lines.length === 0) throw new Error(`no BOM lines for "${excelName}"`)
    return SeedBom.parse({ itemCode: code, yieldMilli: Math.round(yieldUnits * 1000), lines })
  }

  for (const p of PREPARED_ITEMS) {
    items.push(SeedItem.parse({ code: p.code, name: p.name, kind: 'prepared', category: 'เบส/ซับสูตร', useUnit: p.useUnit, isTracked: true, reorderPointMilli: 0, standardCostUsat: 0, shelfLifeHours: p.shelfLifeHours, note: null }))
    boms.push(takeBom(p.code, p.excelName))
  }
  for (const s of PACKAGING_SETS) {
    items.push(SeedItem.parse({ code: s.code, name: s.name, kind: 'packaging_set', category: 'บรรจุภัณฑ์', useUnit: 'ชุด', isTracked: false, reorderPointMilli: 0, standardCostUsat: 0, shelfLifeHours: null, note: null }))
    boms.push(takeBom(s.code, s.excelName))
  }
  return { items, boms }
}
```

- [ ] **Step 3: รันให้ผ่าน**

Run: `pnpm --filter @dayo/excel-import test`
Expected: PASS · ถ้า `yieldByName` ไม่มี "บรรจุภัณฑ์ 20 oz" แสดงว่าชีตตารางบนมีแถวเพิ่ม/หาย ให้พิมพ์ `[...yieldByName]` ดูแล้วแก้ชื่อใน constants ให้ตรงตัวอักษร (ห้ามแก้ Excel)

- [ ] **Step 4: Commit**

```bash
git add packages/excel-import
git commit -m "feat(excel-import): parse base and packaging BOMs"
```

---

### Task 11: parse-products.ts + parse-recipes.ts + parse-equipment.ts

**Files:**
- Create: `packages/excel-import/src/parse-products.ts`, `src/parse-recipes.ts`, `src/parse-equipment.ts`, `test/parse-products.test.ts`, `test/parse-recipes.test.ts`, `test/parse-equipment.test.ts`

**Interfaces:**
- Produces:
  - `parseProducts(wb): { products: SeedProduct[]; variants: SeedVariant[]; prices: SeedPrice[] }` — 24 / 72 / 72 · sku = `${productCode}-${sizeCode}` · ราคา channel `STORE` · `prepGroup` จากชีต "SOP วิธีชง" คอลัมน์ C (null ถ้าไม่พบ)
  - `parseRecipes(wb): SeedRecipe[]` — 360 รายการ · header แถว 1 · ข้ามค่า 0 · เพิ่มบรรทัดชุดบรรจุภัณฑ์ตามขนาด qty 1000 · `excelCostSatang` จากคอลัมน์ "ต้นทุน/แก้ว (บาท)" · `excelLiquidMilli` จาก "ของเหลวรวม (ml)"
  - `parseEquipment(wb): SeedEquipment[]` — 15 รายการ

- [ ] **Step 1: เขียนเทสต์ให้ตก (3 ไฟล์)**

`packages/excel-import/test/parse-products.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { parseProducts } from '../src/parse-products.js'
import { loadFixture } from './workbook.js'

describe('parseProducts', () => {
  it('reads 24 products × 3 sizes with store prices', async () => {
    const { products, variants, prices } = parseProducts(await loadFixture())
    expect(products).toHaveLength(24)
    expect(variants).toHaveLength(72)
    expect(prices).toHaveLength(72)
    expect(products.map((p) => p.code).slice(0, 3)).toEqual(['Original', 'Latte', 'Cream Cheese'])
  })
  it('maps Original: ชาไทยเย็น, category THAI, 45/50/55 baht, prep group เย็นธรรมดา', async () => {
    const { products, prices } = parseProducts(await loadFixture())
    expect(products.find((p) => p.code === 'Original')).toEqual({ code: 'Original', nameTh: 'ชาไทยเย็น', nameEn: 'Original', categoryCode: 'THAI', sort: 1, prepGroup: 'เย็นธรรมดา' })
    const p = (size: string) => prices.find((x) => x.productCode === 'Original' && x.sizeCode === size)!.priceSatang
    expect([p('16oz'), p('20oz'), p('22oz')]).toEqual([4500, 5000, 5500])
  })
  it('maps Matcha Strawberry Premium prices 95/110/120 (columns C=16, E=20, D=22)', async () => {
    const { prices } = parseProducts(await loadFixture())
    const p = (size: string) => prices.find((x) => x.productCode === 'Matcha Strawberry Premium' && x.sizeCode === size)!.priceSatang
    expect([p('16oz'), p('20oz'), p('22oz')]).toEqual([9500, 11000, 12000])
  })
})
```

`packages/excel-import/test/parse-recipes.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { parseRecipes } from '../src/parse-recipes.js'
import { loadFixture } from './workbook.js'

describe('parseRecipes', () => {
  it('reads 360 recipes = 24 × 3 × 5, each unique', async () => {
    const recipes = parseRecipes(await loadFixture())
    expect(recipes).toHaveLength(360)
    const keys = new Set(recipes.map((r) => `${r.productCode}|${r.sizeCode}|${r.sweetnessCode}`))
    expect(keys.size).toBe(360)
  })
  it('Original 16 oz 50% = base 130 + evap 46 + condensed 16 + syrup 16.6 + ice 240 + packaging; cost 14.74', async () => {
    const r = parseRecipes(await loadFixture()).find((x) => x.productCode === 'Original' && x.sizeCode === '16oz' && x.sweetnessCode === 'S050')!
    expect(r.lines).toEqual([
      { itemCode: 'PB-TEA-THAI', qtyMilli: 130_000 },
      { itemCode: 'RM-MLK-02', qtyMilli: 46_000 },
      { itemCode: 'RM-MLK-03', qtyMilli: 16_000 },
      { itemCode: 'PB-SYRUP', qtyMilli: 16_600 },
      { itemCode: 'RM-WTR-01', qtyMilli: 240_000 },
      { itemCode: 'PK-SET-16', qtyMilli: 1_000 },
    ])
    expect(r.excelCostSatang).toBe(1474)
    expect(r.excelLiquidMilli).toBe(208_600)
  })
  it('Pure Matcha Premium 22 oz uses matcha shot, drinking water and 22 oz packaging', async () => {
    const r = parseRecipes(await loadFixture()).find((x) => x.productCode === 'Pure Matcha Premium' && x.sizeCode === '22oz' && x.sweetnessCode === 'S000')!
    expect(r.lines.map((l) => l.itemCode)).toContain('PB-MATCHA-SHOT')
    expect(r.lines.map((l) => l.itemCode)).toContain('RM-WTR-03')
    expect(r.lines.at(-1)).toEqual({ itemCode: 'PK-SET-22', qtyMilli: 1_000 })
    expect(r.lines.some((l) => l.itemCode === 'PB-SYRUP')).toBe(false)
  })
})
```

`packages/excel-import/test/parse-equipment.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { parseEquipment } from '../src/parse-equipment.js'
import { loadFixture } from './workbook.js'

describe('parseEquipment', () => {
  it('reads 15 registered items', async () => {
    const eq = parseEquipment(await loadFixture())
    expect(eq).toHaveLength(15)
    expect(eq.find((e) => e.code === 'EQ-002')).toEqual({ code: 'EQ-002', name: 'เหยือก 1800 ML', purchasedAt: '2026-08-31', priceSatang: 13_800, qty: 1, supplier: 'Mr. DIY', lifeYears: 3, condition: 'ใช้งานได้', owner: 'TungAo', note: 'ราคาประมาณการ (ยังไม่มีใบเสร็จ)' })
    expect(eq.find((e) => e.code === 'EQ-001')!.purchasedAt).toBeNull()
  })
})
```

Run: `pnpm --filter @dayo/excel-import test`
Expected: FAIL — 3 ไฟล์ resolve ไม่ได้

- [ ] **Step 2: เขียน parse-products.ts**

`packages/excel-import/src/parse-products.ts`
```ts
import type ExcelJS from 'exceljs'
import type { z } from 'zod'
import { SeedPrice, SeedProduct, SeedVariant } from '@dayo/contracts'
import { bahtToSatang } from '@dayo/domain'
import { findRow, num, rowsWhile, sheet, str } from './cells.js'
import { PRODUCT_CATEGORY, SIZES } from './constants.js'

type Product = z.infer<typeof SeedProduct>
type Variant = z.infer<typeof SeedVariant>
type Price = z.infer<typeof SeedPrice>

function prepGroups(wb: ExcelJS.Workbook): Map<string, string> {
  const ws = sheet(wb, 'SOP วิธีชง')
  const header = findRow(ws, (r) => str(ws, r, 1) === 'เมนู' && str(ws, r, 3) === 'กลุ่มเทคนิค')
  const out = new Map<string, string>()
  for (const r of rowsWhile(ws, header + 1, 1)) out.set(str(ws, r, 1), str(ws, r, 3))
  return out
}

export function parseProducts(wb: ExcelJS.Workbook): { products: Product[]; variants: Variant[]; prices: Price[] } {
  const ws = sheet(wb, 'ต้นทุนและราคา')
  const header = findRow(ws, (r) => str(ws, r, 1) === 'เมนู' && str(ws, r, 3) === '16 oz')
  const groups = prepGroups(wb)
  const products: Product[] = []
  const variants: Variant[] = []
  const prices: Price[] = []
  let sort = 0
  for (const r of rowsWhile(ws, header + 1, 1)) {
    const code = str(ws, r, 1)
    const categoryCode = PRODUCT_CATEGORY[code]
    if (!categoryCode) throw new Error(`product "${code}" missing in PRODUCT_CATEGORY`)
    sort += 1
    products.push(SeedProduct.parse({ code, nameTh: str(ws, r, 2), nameEn: code, categoryCode, sort, prepGroup: groups.get(code) ?? null }))
    for (const s of SIZES) {
      variants.push(SeedVariant.parse({ productCode: code, sizeCode: s.code, sku: `${code}-${s.code}` }))
      prices.push(SeedPrice.parse({ productCode: code, sizeCode: s.code, channelCode: 'STORE', priceSatang: bahtToSatang(num(ws, r, s.priceCol)) }))
    }
  }
  return { products, variants, prices }
}
```

- [ ] **Step 3: เขียน parse-recipes.ts**

`packages/excel-import/src/parse-recipes.ts`
```ts
import type ExcelJS from 'exceljs'
import type { z } from 'zod'
import { SeedRecipe } from '@dayo/contracts'
import { bahtToSatang } from '@dayo/domain'
import { num, rowsWhile, sheet, str } from './cells.js'
import { RECIPE_INGREDIENT_TO_ITEM, SIZES, SWEETNESS } from './constants.js'

type Recipe = z.infer<typeof SeedRecipe>

const sizeByName = new Map(SIZES.map((s) => [s.name, s]))
const sweetByName = new Map(SWEETNESS.map((s) => [s.name, s.code]))

export function parseRecipes(wb: ExcelJS.Workbook): Recipe[] {
  const ws = sheet(wb, 'ข้อมูลสูตร')
  // header row 1: Key | เมนู | ขนาด | ความหวาน | <17 ingredient columns "ชื่อ (unit)"> | ของเหลวรวม (ml) | ต้นทุน/แก้ว (บาท) | ...
  const ingredientCols: { col: number; itemCode: string }[] = []
  let liquidCol = 0
  let costCol = 0
  for (let c = 1; c <= ws.columnCount; c++) {
    const h = str(ws, 1, c)
    if (h === 'ของเหลวรวม (ml)') liquidCol = c
    else if (h === 'ต้นทุน/แก้ว (บาท)') costCol = c
    else {
      const name = h.replace(/\s*\((ml|g)\)$/, '')
      const itemCode = RECIPE_INGREDIENT_TO_ITEM[name]
      if (itemCode) ingredientCols.push({ col: c, itemCode })
    }
  }
  if (ingredientCols.length !== 17) throw new Error(`expected 17 ingredient columns, found ${ingredientCols.length}`)
  if (!liquidCol || !costCol) throw new Error('ข้อมูลสูตร: liquid/cost columns not found')

  const recipes: Recipe[] = []
  for (const r of rowsWhile(ws, 2, 1)) {
    const size = sizeByName.get(str(ws, r, 3))
    const sweetnessCode = sweetByName.get(str(ws, r, 4))
    if (!size || !sweetnessCode) throw new Error(`ข้อมูลสูตร row ${r}: unknown size/sweetness "${str(ws, r, 3)}" "${str(ws, r, 4)}"`)
    const lines = ingredientCols
      .map(({ col, itemCode }) => ({ itemCode, qtyMilli: Math.round(num(ws, r, col) * 1000) }))
      .filter((l) => l.qtyMilli > 0)
    lines.push({ itemCode: size.packagingItemCode, qtyMilli: 1000 })
    recipes.push(
      SeedRecipe.parse({
        productCode: str(ws, r, 2),
        sizeCode: size.code,
        sweetnessCode,
        lines,
        excelCostSatang: bahtToSatang(num(ws, r, costCol)),
        excelLiquidMilli: Math.round(num(ws, r, liquidCol) * 1000),
      }),
    )
  }
  return recipes
}
```

- [ ] **Step 4: เขียน parse-equipment.ts**

`packages/excel-import/src/parse-equipment.ts`
```ts
import type ExcelJS from 'exceljs'
import type { z } from 'zod'
import { SeedEquipment } from '@dayo/contracts'
import { bahtToSatang } from '@dayo/domain'
import { cellValue, isoDate, num, rowsWhile, sheet, str } from './cells.js'

type Equipment = z.infer<typeof SeedEquipment>

export function parseEquipment(wb: ExcelJS.Workbook): Equipment[] {
  const ws = sheet(wb, 'ทะเบียนอุปกรณ์')
  if (str(ws, 5, 1) !== 'รหัสอุปกรณ์') throw new Error('ทะเบียนอุปกรณ์: header row moved')
  const out: Equipment[] = []
  for (const r of rowsWhile(ws, 6, 1)) {
    const life = num(ws, r, 7)
    out.push(
      SeedEquipment.parse({
        code: str(ws, r, 1),
        name: str(ws, r, 2),
        purchasedAt: isoDate(cellValue(ws, r, 3)),
        priceSatang: bahtToSatang(num(ws, r, 4)),
        qty: Math.max(1, Math.round(num(ws, r, 5))),
        supplier: str(ws, r, 6) || null,
        lifeYears: life > 0 ? life : null,
        condition: str(ws, r, 9) || null,
        owner: str(ws, r, 10) || null,
        note: str(ws, r, 11) || null,
      }),
    )
  }
  return out
}
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `pnpm --filter @dayo/excel-import test && pnpm --filter @dayo/excel-import typecheck`
Expected: PASS ทั้ง 3 ไฟล์ · ถ้าเทสต์วันที่ EQ-002 ไม่ตรง (เช่น ได้ `2026-08-30` เพราะ timezone) ให้เปลี่ยน `isoDate` เป็นใช้ `getUTCFullYear/Month/Date` แล้วเช็คว่า exceljs อ่าน Date เป็น UTC midnight — ต้องได้ `2026-08-31`

- [ ] **Step 6: Commit**

```bash
git add packages/excel-import
git commit -m "feat(excel-import): parse products, prices, 360 recipes and equipment"
```

---

### Task 12: build-seed.ts + cli.ts + golden test 360 สูตร

**Files:**
- Create: `packages/excel-import/src/build-seed.ts`, `src/cli.ts`, `test/build-seed.test.ts`, `test/golden.test.ts`, `seed/dayo-seed.json` (ผลลัพธ์จาก cli)

**Interfaces:**
- Consumes: parse-* ทั้งหมด · `parseSeed` (contracts) · `buildCatalog`, `standardUnitCostUsat`, `costSatang`, `explodeNeeds` (domain)
- Produces: `buildSeed(wb): Seed` (ผ่าน `parseSeed` แล้ว) · `seedCatalog(seed): Catalog` (helper แปลง seed → Catalog ของ domain ใช้ในเทสต์และแผน 2) · ไฟล์ `seed/dayo-seed.json`

- [ ] **Step 1: เขียนเทสต์ build-seed ให้ตก**

`packages/excel-import/test/build-seed.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { buildSeed } from '../src/build-seed.js'
import { loadFixture } from './workbook.js'

describe('buildSeed', () => {
  it('produces a seed that passes SeedSchema with expected counts', async () => {
    const seed = buildSeed(await loadFixture())
    expect(seed.categories).toHaveLength(3)
    expect(seed.sizes).toHaveLength(3)
    expect(seed.sweetness).toHaveLength(5)
    expect(seed.channels).toHaveLength(5)
    expect(seed.items).toHaveLength(32 + 7 + 3)
    expect(seed.purchaseUnits).toHaveLength(32)
    expect(seed.boms).toHaveLength(10)
    expect(seed.products).toHaveLength(24)
    expect(seed.variants).toHaveLength(72)
    expect(seed.prices).toHaveLength(72)
    expect(seed.recipes).toHaveLength(360)
    expect(seed.equipment).toHaveLength(15)
  })
  it('every recipe line references an item that exists', async () => {
    const seed = buildSeed(await loadFixture())
    const codes = new Set(seed.items.map((i) => i.code))
    for (const r of seed.recipes) for (const l of r.lines) expect(codes.has(l.itemCode), l.itemCode).toBe(true)
  })
  it('is deterministic (same JSON twice)', async () => {
    const wb = await loadFixture()
    expect(JSON.stringify(buildSeed(wb))).toBe(JSON.stringify(buildSeed(wb)))
  })
})
```

- [ ] **Step 2: เขียนเทสต์ golden ให้ตก**

`packages/excel-import/test/golden.test.ts`
```ts
import { describe, expect, it } from 'vitest'
import { costSatang, explodeNeeds, standardUnitCostUsat } from '@dayo/domain'
import { buildSeed, seedCatalog } from '../src/build-seed.js'
import { loadFixture } from './workbook.js'

/** Golden test (spec §8): cost per cup computed by the domain package must match the Excel column within 2 satang. */
describe('golden: 360 recipe costs vs Excel', () => {
  it('matches every recipe', async () => {
    const seed = buildSeed(await loadFixture())
    const catalog = seedCatalog(seed)
    const failures: string[] = []
    for (const r of seed.recipes) {
      const cost = r.lines.reduce((acc, l) => acc + costSatang(l.qtyMilli, standardUnitCostUsat(l.itemCode, catalog)), 0)
      if (Math.abs(cost - r.excelCostSatang) > 2) failures.push(`${r.productCode}|${r.sizeCode}|${r.sweetnessCode}: domain ${cost} vs excel ${r.excelCostSatang}`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
  it('matches the 7 base unit costs in sheet ต้นทุนเบส (usat)', async () => {
    const catalog = seedCatalog(buildSeed(await loadFixture()))
    expect(standardUnitCostUsat('PB-TEA-THAI', catalog)).toBe(1_992_500)
    expect(standardUnitCostUsat('PB-TEA-GREEN', catalog)).toBe(1_849_000)
    expect(standardUnitCostUsat('PB-SYRUP', catalog)).toBe(1_674_375)
    expect(standardUnitCostUsat('PB-HONEY', catalog)).toBe(23_358_333)
    expect(standardUnitCostUsat('PB-COCONUT', catalog)).toBe(7_773_000)
    expect(standardUnitCostUsat('PB-CHEESE-FOAM', catalog)).toBe(15_839_240)
    expect(standardUnitCostUsat('PB-MATCHA-SHOT', catalog)).toBe(44_000_000)
  })
  it('exploding a cup at standard cost gives the same cost as the recipe roll-up (tracked bases stop the explosion)', async () => {
    const seed = buildSeed(await loadFixture())
    const catalog = seedCatalog(seed)
    const r = seed.recipes.find((x) => x.productCode === 'Cream Cheese' && x.sizeCode === '16oz' && x.sweetnessCode === 'S050')!
    const needs = explodeNeeds(r.lines, 1, catalog)
    expect(needs.has('PB-CHEESE-FOAM')).toBe(true) // tracked base, not exploded
    expect(needs.has('PK-SET-16')).toBe(false)      // packaging set exploded to cup/lid/straw/sticker
    const viaNeeds = [...needs].reduce((a, [id, n]) => a + costSatang(n, standardUnitCostUsat(id, catalog)), 0)
    expect(Math.abs(viaNeeds - r.excelCostSatang)).toBeLessThanOrEqual(2)
  })
})
```

Run: `pnpm --filter @dayo/excel-import test`
Expected: FAIL — cannot resolve `../src/build-seed.js`

- [ ] **Step 3: เขียน build-seed.ts และ cli.ts**

`packages/excel-import/src/build-seed.ts`
```ts
import type ExcelJS from 'exceljs'
import { parseSeed, type Seed } from '@dayo/contracts'
import { buildCatalog, type Bom, type Catalog, type CatalogItem } from '@dayo/domain'
import { CATEGORIES, CHANNELS, SIZES, SWEETNESS } from './constants.js'
import { parseBoms } from './parse-boms.js'
import { parseEquipment } from './parse-equipment.js'
import { parseItems } from './parse-items.js'
import { parseProducts } from './parse-products.js'
import { parseRecipes } from './parse-recipes.js'

export function buildSeed(wb: ExcelJS.Workbook): Seed {
  const raw = parseItems(wb)
  const prepared = parseBoms(wb)
  const catalog = parseProducts(wb)
  return parseSeed({
    categories: CATEGORIES.map((c) => ({ ...c })),
    sizes: SIZES.map(({ code, name, sort, packagingItemCode }) => ({ code, name, sort, packagingItemCode })),
    sweetness: SWEETNESS.map((s) => ({ ...s })),
    channels: CHANNELS.map((c) => ({ ...c })),
    items: [...raw.items, ...prepared.items],
    purchaseUnits: raw.purchaseUnits,
    boms: prepared.boms,
    products: catalog.products,
    variants: catalog.variants,
    prices: catalog.prices,
    recipes: parseRecipes(wb),
    equipment: parseEquipment(wb),
  })
}

/** Domain catalog keyed by item code (ids are assigned only when seeding a database — plan 2). */
export function seedCatalog(seed: Seed): Catalog {
  const items: CatalogItem[] = seed.items.map((i) => ({ id: i.code, kind: i.kind, isTracked: i.isTracked, standardCostUsat: i.standardCostUsat }))
  const boms: Bom[] = seed.boms.map((b) => ({ itemId: b.itemCode, yieldMilli: b.yieldMilli, lines: b.lines.map((l) => ({ itemId: l.itemCode, qtyMilli: l.qtyMilli })) }))
  return buildCatalog(items, boms)
}
```

`packages/excel-import/src/cli.ts`
```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildSeed } from './build-seed.js'
import { openWorkbook } from './cells.js'

const [xlsxPath, outPath] = process.argv.slice(2)
if (!xlsxPath || !outPath) {
  console.error('usage: pnpm --filter @dayo/excel-import import <path-to.xlsx> <out.json>')
  process.exit(2)
}
const seed = buildSeed(await openWorkbook(xlsxPath))
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(seed, null, 2) + '\n', 'utf8')
console.log(`wrote ${outPath}: ${seed.items.length} items, ${seed.recipes.length} recipes`)
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `pnpm --filter @dayo/excel-import test`
Expected: PASS ทุกไฟล์ รวม golden 360 แถว · **ถ้า golden ตกบางแถว** ให้ดูข้อความ failure: ถ้าต่างกันคงที่ ~4 บาททุกแถวของขนาดใดขนาดหนึ่ง = ชุดบรรจุภัณฑ์ผิดขนาด · ถ้าต่างเฉพาะเมนูมัทฉะ = อัตราส่วนช็อต · ห้ามขยาย tolerance เกิน 2 สตางค์ โดยไม่บันทึกเหตุผลใน decision log

- [ ] **Step 5: สร้างไฟล์ seed จริงและ commit**

Run:
```bash
pnpm --filter @dayo/excel-import import "packages/excel-import/fixtures/DA-YO_เมนู.xlsx" packages/excel-import/seed/dayo-seed.json && pnpm typecheck && pnpm test
```
Expected: `wrote packages/excel-import/seed/dayo-seed.json: 42 items, 360 recipes` · ทุกแพ็กเกจ typecheck + test ผ่าน (tsx รองรับ top-level await ใน ESM)

```bash
git add packages/excel-import
git commit -m "feat(excel-import): build seed JSON from the shop workbook, golden-tested against Excel costs"
```

---

### Task 13: CI เขียวและปิดแผน

**Files:**
- Modify: `docs/superpowers/plans/README.md` (สถานะแผน 1 → ✅)

- [ ] **Step 1: push แล้วดู GitHub Actions**

Run:
```bash
git push origin main
```
Expected: workflow `ci` ผ่านทั้ง typecheck และ test บน ubuntu (fixture xlsx อยู่ใน repo จึงรันได้)

- [ ] **Step 2: อัปเดตสถานะแผน**

ใน `docs/superpowers/plans/README.md` เปลี่ยนแถวแผน 1 จาก `📝 เขียนแล้ว` เป็น `✅ เสร็จ <วันที่>` แล้ว commit:
```bash
git add docs/superpowers/plans/README.md
git commit -m "docs: mark plan 1 complete"
```

---

## Self-review (ทำแล้วตอนเขียนแผน)

- **Spec coverage:** §4.1 → Task 3 · §4.2 → Task 5–6 · §4.3 (ยกเลิก) → `voidReturnMovements` Task 6 (ตรรกะ "ทำแล้ว/ยังไม่ทำ" อยู่ในแอป แผน 3) · §4.4 → Task 6 · §4.5 → Task 7 · §4.6 (หมดอายุ) → ใช้ `MovementKind.EXPIRED` + shelf life ใน seed (หน้าจอในแผน 4) · §4.7 → Task 4 · §4.8 → Task 7 · §4.9 → Task 4 · §8 golden + property → Task 2–7, 12 · §9 นำเข้า → Task 9–12 · §2.1 monorepo → Task 1
- **ไม่ครอบคลุมในแผนนี้ (ตั้งใจ):** ตาราง DB (แผน 2), spike เบราว์เซอร์ (ต้นแผน 3), modifier tables (ยังไม่สร้างจนกว่าจะใช้ — YAGNI)
- **Type consistency:** `MovementKind` ใน domain (Task 6) และ contracts (Task 8) มี 11 ค่าเดียวกันเรียงเหมือนกัน · `CatalogItem.id` ในแผนนี้ = item code (seedCatalog) ส่วนแผน 2 จะใช้ UUID — ฟังก์ชัน domain ไม่สนใจว่า id เป็นอะไร · `EventCore.chainSeq` ต่างจาก `order_event.seq` ต่อบิล — แผน 2 ต้องมีทั้งสองคอลัมน์
