import { describe, expect, it } from 'vitest'
import { explodeNeeds, needsCostSatang, standardUnitCostUsat } from '@dayo/domain'
import { buildSeed, seedCatalog } from '../src/build-seed.js'
import { loadFixture } from './workbook.js'

/**
 * Golden test (spec §8): cost per cup computed by the domain package must match the Excel column within
 * ±0.01 baht (1 satang) at most — spec's stated ceiling, never to be loosened further. Cost is rounded ONCE
 * over the full-precision BigInt sum of the recipe's lines (spec §4.2, via `needsCostSatang`), never per
 * line — per-line rounding drifts from Excel on ~1/3 of the 360 recipes. Rounding once this way achieves
 * EXACT equality (diff 0) on all 360 recipes in the current fixture, so the assertion below requires exact
 * equality; GOLDEN_TOLERANCE_SATANG only bounds the explode-path check below, which takes a different route
 * through the BOM and is kept at spec's ≤1 satang ceiling as a safety margin, never exact-equality.
 */
const GOLDEN_TOLERANCE_SATANG = 1

describe('golden: 360 recipe costs vs Excel', () => {
  it('matches every recipe exactly (rounding once over the BigInt sum reproduces Excel to the satang)', async () => {
    const seed = buildSeed(await loadFixture())
    const catalog = seedCatalog(seed)
    const costOf = (itemCode: string) => standardUnitCostUsat(itemCode, catalog)
    const failures: string[] = []
    for (const r of seed.recipes) {
      const needs = new Map<string, number>()
      for (const l of r.lines) needs.set(l.itemCode, (needs.get(l.itemCode) ?? 0) + l.qtyMilli)
      const cost = needsCostSatang(needs, costOf)
      if (cost !== r.excelCostSatang) failures.push(`${r.productCode}|${r.sizeCode}|${r.sweetnessCode}: domain ${cost} vs excel ${r.excelCostSatang}`)
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
    const viaNeeds = needsCostSatang(needs, (id) => standardUnitCostUsat(id, catalog))
    expect(Math.abs(viaNeeds - r.excelCostSatang)).toBeLessThanOrEqual(GOLDEN_TOLERANCE_SATANG)
  })
})
