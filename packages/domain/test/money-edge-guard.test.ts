/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
/** spec 04 §4.2: these never use the silent-rounding converters of money.ts (they are for packages/excel-import only). */
const GUARDED = [
  'apps/pos/src',
  'packages/dayo-pricing/src',
  'packages/domain/src/price-cart.ts',
  'packages/domain/src/order-row.ts',
  'packages/domain/src/order-draft.ts',
]

function* sources(path: string): Generator<string> {
  if (!existsSync(path)) return
  if (statSync(path).isFile()) { if (/\.(ts|tsx)$/.test(path)) yield path; return }
  for (const entry of readdirSync(path)) yield* sources(join(path, entry))
}

it('no guarded file names bahtToSatang or bahtToUsat', () => {
  const offenders: string[] = []
  for (const g of GUARDED) for (const f of sources(join(ROOT, g))) if (/\bbahtTo(Satang|Usat)\b/.test(readFileSync(f, 'utf8'))) offenders.push(f)
  expect(offenders).toEqual([])
})

it('the guard can see the repo (a wrong ROOT would pass vacuously)', () => {
  expect(existsSync(join(ROOT, 'apps/pos/src'))).toBe(true)
})
