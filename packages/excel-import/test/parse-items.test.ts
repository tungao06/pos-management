import { describe, expect, it } from 'vitest'
import { parseItems } from '../src/parse-items.js'
import { loadFixture } from './workbook.js'

describe('parseItems', () => {
  it('reads all 35 purchasable items with purchase units', async () => {
    const { items, purchaseUnits } = parseItems(await loadFixture())
    expect(items).toHaveLength(35)
    expect(purchaseUnits).toHaveLength(35)
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
  it('maps RM-MAT-02 (30 g bag at 287 baht) used by the matcha shot base', async () => {
    const { items } = parseItems(await loadFixture())
    const matcha = items.find((i) => i.code === 'RM-MAT-02')!
    expect(matcha).toMatchObject({ useUnit: 'g', isTracked: true, standardCostUsat: 956_666_667 })
  })
})
