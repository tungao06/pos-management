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
    expect(standardUnitCostUsat('PB-TEA-THAI', catalog)).toBe(2_000_000)
    expect(standardUnitCostUsat('PB-TEA-GREEN', catalog)).toBe(2_433_250)
    expect(standardUnitCostUsat('PB-SYRUP', catalog)).toBe(1_674_375)
    expect(standardUnitCostUsat('PB-HONEY', catalog)).toBe(23_358_333)
    expect(standardUnitCostUsat('PB-COCONUT', catalog)).toBe(7_353_000)
    expect(standardUnitCostUsat('PB-CHEESE-FOAM', catalog)).toBe(15_839_240)
    expect(standardUnitCostUsat('PB-MATCHA-SHOT', catalog)).toBe(95_666_667)
  })
  it('exploding a cup at standard cost gives the same cost as the recipe roll-up (tracked bases stop the explosion)', async () => {
    const seed = buildSeed(await loadFixture())
    const catalog = seedCatalog(seed)
    const r = seed.recipes.find((x) => x.productCode === 'Cream Cheese' && x.sizeCode === '16oz' && x.sweetnessCode === 'S050')!
    const needs = explodeNeeds(
      r.lines.map((l) => ({ itemId: l.itemCode, qtyMilli: l.qtyMilli })),
      1,
      catalog,
    )
    expect(needs.has('PB-CHEESE-FOAM')).toBe(true) // tracked base, not exploded
    expect(needs.has('PK-SET-16')).toBe(false)      // packaging set exploded to cup/lid/straw/sticker
    const viaNeeds = [...needs].reduce((a, [id, n]) => a + costSatang(n, standardUnitCostUsat(id, catalog)), 0)
    expect(Math.abs(viaNeeds - r.excelCostSatang)).toBeLessThanOrEqual(2)
  })
})
