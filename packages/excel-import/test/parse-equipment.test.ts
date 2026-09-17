import { describe, expect, it } from 'vitest'
import { parseEquipment } from '../src/parse-equipment.js'
import { loadFixture } from './workbook.js'

describe('parseEquipment', () => {
  it('reads 32 registered items', async () => {
    const eq = parseEquipment(await loadFixture())
    expect(eq).toHaveLength(32)
    expect(eq.find((e) => e.code === 'EQ-002')).toEqual({ code: 'EQ-002', name: 'เหยือก 1800 ML', purchasedAt: '2026-08-31', priceSatang: 13_800, qty: 1, supplier: 'Mr. DIY', lifeYears: 3, condition: 'ใช้งานได้', owner: 'TungAo', note: 'ราคาประมาณการ (ยังไม่มีใบเสร็จ)' })
    expect(eq.find((e) => e.code === 'EQ-001')!.purchasedAt).toBeNull()
  })
})
