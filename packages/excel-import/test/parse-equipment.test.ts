import { describe, expect, it } from 'vitest'
import { lifeMonthsFromYears, parseEquipment } from '../src/parse-equipment.js'
import { loadFixture } from './workbook.js'

describe('lifeMonthsFromYears (D37)', () => {
  it('converts years to whole months exactly', () => {
    expect(lifeMonthsFromYears(3, 'EQ-X')).toBe(36)
    expect(lifeMonthsFromYears(1, 'EQ-X')).toBe(12)
    expect(lifeMonthsFromYears(2.5, 'EQ-X')).toBe(30)
    expect(lifeMonthsFromYears(0.25, 'EQ-X')).toBe(3)
  })
  it('returns null for a blank or zero life', () => {
    expect(lifeMonthsFromYears(0, 'EQ-X')).toBeNull()
    expect(lifeMonthsFromYears(Number.NaN, 'EQ-X')).toBeNull()
  })
  it('throws instead of rounding when years × 12 is not an integer', () => {
    expect(() => lifeMonthsFromYears(1.1, 'EQ-X')).toThrow(/EQ-X/)
    expect(() => lifeMonthsFromYears(0.3, 'EQ-X')).toThrow(/not a whole number of months/)
  })
})

describe('parseEquipment', () => {
  it('reads 32 registered items with life in months', async () => {
    const eq = parseEquipment(await loadFixture())
    expect(eq).toHaveLength(32)
    expect(eq.find((e) => e.code === 'EQ-002')).toEqual({ code: 'EQ-002', name: 'เหยือก 1800 ML', purchasedAt: '2026-08-31', priceSatang: 13_800, qty: 1, supplier: 'Mr. DIY', lifeMonths: 36, condition: 'ใช้งานได้', owner: 'TungAo', note: 'ราคาประมาณการ (ยังไม่มีใบเสร็จ)' })
    expect(eq.find((e) => e.code === 'EQ-001')!.purchasedAt).toBeNull()
    for (const e of eq) if (e.lifeMonths !== null) expect(Number.isInteger(e.lifeMonths) && e.lifeMonths > 0, e.code).toBe(true)
  })
})
