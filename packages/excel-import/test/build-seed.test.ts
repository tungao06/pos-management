import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
    expect(seed.items).toHaveLength(35 + 7 + 3)
    expect(seed.purchaseUnits).toHaveLength(35)
    expect(seed.boms).toHaveLength(10)
    expect(seed.products).toHaveLength(24)
    expect(seed.variants).toHaveLength(72)
    expect(seed.prices).toHaveLength(72)
    expect(seed.recipes).toHaveLength(360)
    expect(seed.equipment).toHaveLength(32)
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
  it('rolls up standard cost through the BOM for prepared and packaging_set items (spec §4.4)', async () => {
    const seed = buildSeed(await loadFixture())
    const item = (code: string) => seed.items.find((i) => i.code === code)!
    expect(item('PB-TEA-THAI').standardCostUsat).toBe(2_000_000)
    expect(item('PK-SET-16').standardCostUsat).toBeGreaterThan(0)
  })
  it('committed seed/dayo-seed.json is exactly what the CLI would (re)write from the fixture (minor 5)', async () => {
    // Plan 2 reads the committed file, not the parser. This guards against the fixture or parser changing
    // without re-running `pnpm --filter @dayo/excel-import import <fixture> seed/dayo-seed.json`.
    const seed = buildSeed(await loadFixture())
    const expected = `${JSON.stringify(seed, null, 2)}\n` // matches cli.ts's exact serialization
    const committedPath = fileURLToPath(new URL('../seed/dayo-seed.json', import.meta.url))
    // Normalize CRLF -> LF: this repo has no .gitattributes and core.autocrlf can rewrite line endings on
    // checkout, which is an OS/git artifact unrelated to the CLI's own (LF-only) serialization.
    const committed = readFileSync(committedPath, 'utf8').replace(/\r\n/g, '\n')
    expect(committed).toBe(expected)
  })
})
