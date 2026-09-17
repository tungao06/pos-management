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
  it('Original 16 oz 50% = base 130 + evap 46 + condensed 16 + syrup 16.6 + ice 240 + packaging; cost 14.75', async () => {
    const r = parseRecipes(await loadFixture()).find((x) => x.productCode === 'Original' && x.sizeCode === '16oz' && x.sweetnessCode === 'S050')!
    expect(r.lines).toEqual([
      { itemCode: 'PB-TEA-THAI', qtyMilli: 130_000 },
      { itemCode: 'RM-MLK-02', qtyMilli: 46_000 },
      { itemCode: 'RM-MLK-03', qtyMilli: 16_000 },
      { itemCode: 'PB-SYRUP', qtyMilli: 16_600 },
      { itemCode: 'RM-WTR-01', qtyMilli: 240_000 },
      { itemCode: 'PK-SET-16', qtyMilli: 1_000 },
    ])
    expect(r.excelCostSatang).toBe(1475)
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
