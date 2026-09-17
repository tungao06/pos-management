import { describe, expect, it } from 'vitest'
import { PACKAGING_SETS, PREPARED_ITEMS } from '../src/constants.js'
import { parseBoms } from '../src/parse-boms.js'
import { parseItems } from '../src/parse-items.js'
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
  it('matcha shot base uses RM-MAT-02, 30 g per batch', async () => {
    const { boms } = parseBoms(await loadFixture())
    const shot = boms.find((b) => b.itemCode === 'PB-MATCHA-SHOT')!
    expect(shot.lines).toContainEqual({ itemCode: 'RM-MAT-02', qtyMilli: 30_000 })
  })
  it('every BOM line references a real item (raw, prepared or packaging_set)', async () => {
    const wb = await loadFixture()
    const { items: rawItems } = parseItems(wb)
    const { boms } = parseBoms(wb)
    const knownCodes = new Set([
      ...rawItems.map((i) => i.code),
      ...PREPARED_ITEMS.map((p) => p.code),
      ...PACKAGING_SETS.map((s) => s.code),
    ])
    for (const bom of boms) {
      for (const line of bom.lines) {
        expect(knownCodes.has(line.itemCode)).toBe(true)
      }
    }
  })
})
