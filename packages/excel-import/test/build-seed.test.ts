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
})
